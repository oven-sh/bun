use core::alloc::Layout;
use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::ops::Range;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::rc::Rc;
use std::sync::Arc;

use bun_core::heap;
use bun_dawn_sys::{self as dawn, Chain, MapAsyncStatus, Ref};
use bun_jsc::bindgen::{JsHeap, JsScope, JsWrapper, Result};
use bun_jsc::{
    ArrayBuffer, DOMExceptionCode, DetachKey, JSGlobalObject, JSPromiseStrong, JSType, JSValue,
    JsResult, VM,
};

use super::device::Device;
use super::instance::{Operation, Origin};
use super::{Object, convert, idl};

pub(crate) type GPUBuffer = Object<dawn::Buffer, Rc<Buffer>>;

const MAP_MODE_WRITE: u32 = 0x0002;
const USAGE_MAP_READ: u32 = 0x0001;
const USAGE_MAP_WRITE: u32 = 0x0002;

/// What mapped ranges are views of. Unlike the driver's memory, it stays valid for native code that still uses an unmapped range.
struct Shadow(Box<[AtomicU64]>);

impl Shadow {
    fn zeroed(size: u64) -> Option<Arc<Self>> {
        let words = usize::try_from(size.div_ceil(8).max(1)).ok()?;
        let layout = Layout::array::<AtomicU64>(words).ok()?;
        // SAFETY: the layout is not empty.
        let memory = NonNull::new(unsafe { std::alloc::alloc_zeroed(layout) })?;
        let memory = NonNull::slice_from_raw_parts(memory.cast(), words);
        // SAFETY: allocated as a box of that many words is, and initialized.
        Some(Arc::new(Self(unsafe { heap::take(memory.as_ptr()) })))
    }

    fn size(&self) -> usize {
        size_of_val(&*self.0)
    }

    fn at(&self, offset: u64) -> *mut u8 {
        assert!(offset as usize <= self.size());
        // SAFETY: just checked.
        unsafe { self.0.as_ptr().cast::<u8>().cast_mut().add(offset as usize) }
    }
}

struct View {
    range: Range<u64>,
    key: DetachKey,
}

struct Mapping {
    is_for_writing: bool,
    range: Range<u64>,
    shadow: Arc<Shadow>,
    /// In the order of their ranges.
    views: Vec<View>,
}

#[derive(Default)]
enum MapState {
    #[default]
    Unmapped,
    Pending {
        id: u32,
        promise: JSPromiseStrong,
    },
    Mapped(Mapping),
}

pub(crate) struct Buffer {
    handle: Ref<dawn::Buffer>,
    device: Rc<Device>,
    size: u64,
    usage: u32,
    map_state: RefCell<MapState>,
    last_map_id: Cell<u32>,
    /// Kept from one mapping to the next.
    idle_shadow: Cell<Option<Arc<Shadow>>>,
    /// Only mappings write to a `MAP_WRITE` buffer, so its first shadow has the contents, which are slow to read back.
    has_first_shadow: Cell<bool>,
    pub(super) is_listed_by_device: Cell<bool>,
    shadow_size: AtomicUsize,
    memory_size: AtomicUsize,
}

impl Drop for Buffer {
    fn drop(&mut self) {
        self.will_release_memory();
    }
}

#[derive(Clone, Copy)]
enum Contents {
    Keep,
    Discard,
}

impl Buffer {
    /// <https://gpuweb.github.io/gpuweb/#abstract-opdef-initialize-an-active-buffer-mapping>
    fn initialize_mapping(&self, is_for_writing: bool, range: Range<u64>) -> Option<Mapping> {
        if range.end - range.start > ArrayBuffer::MAX_BYTE_LENGTH {
            return None;
        }
        let shadow = (self.idle_shadow.take()).or_else(|| Shadow::zeroed(self.size))?;
        self.shadow_size.store(shadow.size(), Ordering::Relaxed);
        Some(Mapping {
            is_for_writing,
            range,
            shadow,
            views: Vec::new(),
        })
    }

    fn end_mapping(&self, vm: &VM, mapping: Mapping, contents: Contents) {
        let Mapping { shadow, views, .. } = mapping;
        let keeps_writes = mapping.is_for_writing && matches!(contents, Contents::Keep);
        for View { range, key } in views {
            key.detach(vm);
            if keeps_writes {
                let size = (range.end - range.start) as usize;
                let mapped = self.handle.get_mapped_range(range.start as usize, size);
                if !mapped.is_null() {
                    // SAFETY: both have `size` bytes there.
                    unsafe { mapped.copy_from_nonoverlapping(shadow.at(range.start), size) };
                }
            }
        }

        let maps_again = self.usage & (USAGE_MAP_READ | USAGE_MAP_WRITE) != 0
            && matches!(contents, Contents::Keep);
        let every_view_was_detached = Arc::strong_count(&shadow) == 1;
        if maps_again && every_view_was_detached {
            self.idle_shadow.set(Some(shadow));
        } else {
            self.has_first_shadow.set(false);
            self.shadow_size.store(0, Ordering::Relaxed);
        }
    }

    fn will_release_memory(&self) {
        if self.memory_size.swap(0, Ordering::Relaxed) > 0 {
            self.device.will_release_memory();
        }
    }

    fn unmap(&self, global: &JSGlobalObject, contents: Contents) -> JsResult<()> {
        if !self.is_unmapped() {
            self.device.instance.schedule();
        }
        match self.map_state.take() {
            MapState::Unmapped => Ok(()),
            MapState::Pending { mut promise, .. } => {
                let error = global.create_dom_exception_instance(
                    DOMExceptionCode::AbortError,
                    format_args!("The buffer was unmapped before the mapping was resolved"),
                );
                promise.reject(global, Ok(error))
            }
            MapState::Mapped(mapping) => {
                self.end_mapping(global.vm(), mapping, contents);
                Ok(())
            }
        }
    }

    pub(super) fn unmap_for_destroyed_device(&self, global: &JSGlobalObject) -> JsResult<()> {
        self.unmap(global, Contents::Discard)
    }

    /// As [`unmap_for_destroyed_device`](Self::unmap_for_destroyed_device), but it leaves a pending mapping to fail.
    pub(super) fn detach_views(&self, vm: &VM) {
        match self.map_state.take() {
            MapState::Mapped(mapping) => self.end_mapping(vm, mapping, Contents::Discard),
            other => *self.map_state.borrow_mut() = other,
        }
    }

    pub(super) fn is_unmapped(&self) -> bool {
        matches!(*self.map_state.borrow(), MapState::Unmapped)
    }
}

/// One call of `mapAsync()`. `unmap()` cancels it.
struct MapRequest {
    buffer: Rc<Buffer>,
    id: u32,
    is_for_writing: bool,
    range: Range<u64>,
}

impl MapRequest {
    fn take_promise(&self) -> Option<JSPromiseStrong> {
        let mut state = self.buffer.map_state.borrow_mut();
        match &mut *state {
            MapState::Pending { id, promise } if *id == self.id => {
                let promise = promise.take();
                *state = MapState::Unmapped;
                Some(promise)
            }
            _ => None,
        }
    }

    fn complete(
        self,
        global: &JSGlobalObject,
        status: MapAsyncStatus,
        message: &[u8],
    ) -> JsResult<()> {
        let Some(mut promise) = self.take_promise() else {
            return Ok(());
        };
        let (status, message) = match status {
            MapAsyncStatus::Success if self.buffer.device.dawn.is_destroyed() => (
                MapAsyncStatus::Aborted,
                &b"The device was destroyed before the mapping was resolved"[..],
            ),
            _ => (status, message),
        };
        if status != MapAsyncStatus::Success {
            let code = match status {
                MapAsyncStatus::Error => DOMExceptionCode::OperationError,
                _ => DOMExceptionCode::AbortError,
            };
            let message = format_args!("{}", bun_core::fmt::s(message));
            return promise.reject(
                global,
                Ok(global.create_dom_exception_instance(code, message)),
            );
        }
        let buffer = &self.buffer;
        let Some(mapping) = buffer.initialize_mapping(self.is_for_writing, self.range.clone())
        else {
            buffer.handle.unmap();
            let error = global.create_range_error_instance(format_args!(
                "Failed to allocate memory for the mapped range"
            ));
            return promise.reject_with_async_stack(global, Ok(error));
        };
        *buffer.map_state.borrow_mut() = MapState::Mapped(mapping);
        promise.resolve(global, JSValue::UNDEFINED)
    }
}

impl Drop for MapRequest {
    /// The script that asked is gone.
    fn drop(&mut self) {
        if self.take_promise().is_some() {
            self.buffer.handle.unmap();
        }
    }
}

impl GPUBuffer {
    pub(super) fn create<'a>(
        heap: &JsHeap<'a>,
        device: &Rc<Device>,
        descriptor: &idl::GPUBufferDescriptor,
    ) -> Result<'a, Self> {
        let size = descriptor.size;
        let failed_to_allocate = || {
            heap.range_error(format_args!(
                "Failed to allocate {size} bytes for a buffer that is mapped at creation"
            ))
        };
        if descriptor.mapped_at_creation {
            if !size.is_multiple_of(4) {
                return Err(heap.range_error(format_args!(
                    "The size ({size}) of a buffer that is mapped at creation must be a multiple of 4"
                )));
            }
            if size > ArrayBuffer::MAX_BYTE_LENGTH {
                return Err(failed_to_allocate());
            }
        }
        let handle = device.dawn.create_buffer(&dawn::BufferDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
            usage: dawn::BufferUsage::from_bits(descriptor.usage),
            size,
            mapped_at_creation: descriptor.mapped_at_creation.into(),
        });
        let handle = handle.ok_or_else(failed_to_allocate)?;
        let buffer = Rc::new(Buffer {
            handle: handle.clone(),
            device: Rc::clone(device),
            size,
            usage: descriptor.usage,
            map_state: RefCell::default(),
            last_map_id: Cell::new(0),
            idle_shadow: Cell::new(None),
            has_first_shadow: Cell::new(true),
            is_listed_by_device: Cell::new(false),
            shadow_size: AtomicUsize::new(0),
            memory_size: AtomicUsize::new(handle.memory_size() as usize),
        });
        if descriptor.mapped_at_creation {
            let mapping = buffer.initialize_mapping(true, 0..size);
            let mapping = mapping.ok_or_else(failed_to_allocate)?;
            *buffer.map_state.borrow_mut() = MapState::Mapped(mapping);
            device.add_mapped_buffer(&buffer);
        }
        Ok(Self::with_state(handle, &descriptor.label, buffer))
    }

    pub(crate) fn map_async<'a>(
        &self,
        cx: &mut JsScope<'a>,
        mode: u32,
        offset: u64,
        size: Option<u64>,
    ) -> Result<'a, JSValue> {
        let buffer = &self.state;
        let device = &buffer.device;
        if !buffer.is_unmapped() {
            let message = "The buffer is already mapped, or has a mapping pending";
            (device.dawn).inject_error(dawn::ErrorType::Validation, message.as_bytes().into());
            let code = DOMExceptionCode::OperationError;
            return Err(cx.heap.dom_exception(code, format_args!("{message}")));
        }

        let id = buffer.last_map_id.get().wrapping_add(1);
        buffer.last_map_id.set(id);
        let promise = JSPromiseStrong::init(cx.global());
        let result = promise.value();
        *buffer.map_state.borrow_mut() = MapState::Pending { id, promise };
        device.add_mapped_buffer(buffer);

        let size = size.unwrap_or_else(|| buffer.size.saturating_sub(offset));
        let request = MapRequest {
            buffer: Rc::clone(buffer),
            id,
            is_for_writing: mode == MAP_MODE_WRITE,
            range: offset..offset + size,
        };
        let operation = Operation::new(&device.instance, Origin::of_caller(cx));
        device.wait_for_queue(|wait| {
            let callback = dawn::BufferMapCallbackInfo::new(move |status, message| {
                drop(wait);
                let message = message.as_bytes().to_vec();
                operation.complete(move |global| request.complete(global, status, &message));
            });
            let mode = dawn::MapMode::from_bits(mode);
            (self.handle).map_async(mode, offset as usize, size as usize, callback);
            self.handle.serial_of_last_use()
        });
        Ok(result)
    }

    pub(crate) fn get_mapped_range<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        offset: u64,
        size: Option<u64>,
    ) -> Result<'a, JSValue> {
        unsafe extern "C" fn release(_: *mut c_void, shadow: *mut c_void) {
            // SAFETY: the `Arc` below, given back once.
            drop(unsafe { Arc::from_raw(shadow.cast::<Shadow>()) });
        }

        let fail = |message: core::fmt::Arguments<'_>| {
            Err(heap.dom_exception(DOMExceptionCode::OperationError, message))
        };
        let size = size.unwrap_or_else(|| self.state.size.saturating_sub(offset));
        let end = offset + size;
        let mut state = self.state.map_state.borrow_mut();
        let MapState::Mapped(mapping) = &mut *state else {
            return fail(format_args!("The buffer is not mapped"));
        };
        if !offset.is_multiple_of(8) {
            return fail(format_args!("The offset ({offset}) is not a multiple of 8"));
        }
        if !size.is_multiple_of(4) {
            return fail(format_args!("The size ({size}) is not a multiple of 4"));
        }
        if offset < mapping.range.start || end > mapping.range.end {
            return fail(format_args!(
                "The range [{offset}, {end}) is not inside the mapped range [{}, {})",
                mapping.range.start, mapping.range.end
            ));
        }
        let index = (mapping.views).partition_point(|view| view.range.end <= offset);
        if let Some(View { range: other, .. }) = mapping.views.get(index)
            && other.start < end
        {
            return fail(format_args!(
                "The range [{offset}, {end}) overlaps the range [{}, {}), which was returned before",
                other.start, other.end
            ));
        }

        let size = size as usize;
        let bytes = mapping.shadow.at(offset);
        if !(mapping.is_for_writing && self.state.has_first_shadow.get()) {
            let mapped = self.handle.get_const_mapped_range(offset as usize, size);
            if !mapped.is_null() {
                // SAFETY: both have `size` bytes there.
                unsafe { bytes.copy_from_nonoverlapping(mapped, size) };
            }
        }

        // SAFETY: making an object runs no JavaScript.
        let global = unsafe { heap.global() };
        let view = ArrayBuffer {
            ptr: bytes,
            len: size,
            byte_len: size,
            typed_array_type: JSType::ArrayBuffer,
            ..Default::default()
        };
        let shadow = Arc::into_raw(Arc::clone(&mapping.shadow));
        // SAFETY: the bytes are in `shadow`, which is alive until `release`.
        let array_buffer =
            unsafe { view.to_js_with_context(global, shadow.cast_mut().cast(), Some(release)) }?;
        // SAFETY: an `ArrayBuffer` that was just made, and an object.
        let key = unsafe { DetachKey::new(global.vm(), array_buffer, this_value.to_js()) };
        let range = offset..end;
        mapping.views.insert(index, View { range, key });
        Ok(array_buffer)
    }

    pub(crate) fn unmap<'a>(&self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        let result = self.state.unmap(cx.global(), Contents::Keep);
        self.handle.unmap();
        Ok(result?)
    }

    pub(crate) fn destroy<'a>(&self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        let buffer = &self.state;
        let result = buffer.unmap(cx.global(), Contents::Discard);
        self.handle.destroy();
        buffer.idle_shadow.take();
        buffer.shadow_size.store(0, Ordering::Relaxed);
        buffer.will_release_memory();
        Ok(result?)
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.state.memory_size.load(Ordering::Relaxed)
            + self.state.shadow_size.load(Ordering::Relaxed)
    }

    pub(crate) fn get_size(&self) -> u64 {
        self.state.size
    }

    pub(crate) fn get_usage(&self) -> u32 {
        self.state.usage
    }

    pub(crate) fn get_map_state(&self) -> idl::GPUBufferMapState {
        match *self.state.map_state.borrow() {
            MapState::Unmapped => idl::GPUBufferMapState::Unmapped,
            MapState::Pending { .. } => idl::GPUBufferMapState::Pending,
            MapState::Mapped(_) => idl::GPUBufferMapState::Mapped,
        }
    }
}

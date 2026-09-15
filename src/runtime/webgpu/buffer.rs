//! `GPUBuffer`.
//!
//! `getMappedRange()` hands JS an ordinary ArrayBuffer holding a copy of the
//! mapped bytes, and `unmap()` copies a write mapping back before detaching
//! it. JS never aliases driver-owned memory, so a device loss, which frees
//! that memory at a time of the driver's choosing, cannot leave a live
//! ArrayBuffer pointing at it.
//!
//! A `mapAsync()` completes inside `device_poll` on a pool thread
//! ([`super::wait`]). wgpu-core's `Buffer::map` there and `Buffer::unmap` here
//! both swap the buffer's map state without holding its lock across the swap,
//! so the two must not meet. Hence the rule this file keeps: while a map
//! request is in flight in wgpu-core ([`GPUBuffer::in_flight`]), nothing on
//! the JS thread touches that buffer's wgpu-core map state. `unmap()` of a
//! pending map only settles the JS side; the completion of the stale request
//! does the wgpu-core side, then issues the request that was queued behind it.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

use bun_jsc::{
    ArrayBuffer, CallFrame, JSGlobalObject, JSPromise, JSType, JSValue, JsCell, JsClass, JsResult,
    JsThread, StringJsc as _, Strong,
};
use bun_webgpu::wgc::device::HostMap;
use bun_webgpu::wgc::resource::{BufferAccessError, BufferMapOperation};
use bun_webgpu::{GpuError, error_chain, instance, wgc, wgt};

use super::args::{self, Dict};
use super::detach_array_buffer;
use super::device::DeviceRef;
use super::wait::{Slot, Wait, Waiter};
use crate::generated_classes::js_GPUBuffer as js;

/// `GPUMapMode`.
const MAP_READ: u32 = 1;
const MAP_WRITE: u32 = 2;

/// Every `GPUBufferUsage` bit the spec defines.
const ALL_USAGES: u32 = 0x3FF;

/// The map state script sees (`GPUBuffer.mapState`).
enum MapState {
    Unmapped,
    /// The promise is in the `pendingMap` slot.
    Pending,
    Mapped {
        write: bool,
        /// The mapped byte range of the buffer.
        start: u64,
        end: u64,
        /// `(offset, size)` of every `getMappedRange()` result, in the order
        /// of the `mappedRanges` slot's ArrayBuffers.
        ranges: Vec<(u64, u64)>,
    },
}

#[bun_jsc::JsClass]
pub struct GPUBuffer {
    device: DeviceRef,
    raw: bun_webgpu::Buffer,
    label: JsCell<bun_core::String>,
    size: u64,
    usage: u32,
    map: JsCell<MapState>,
    /// Names the current `mapAsync()`: bumped by every `mapAsync()`, `unmap()`
    /// and `destroy()`, so a completion can tell whether it is still wanted.
    map_generation: Cell<u32>,
    /// A map request was handed to wgpu-core and its completion has not run.
    in_flight: Cell<bool>,
    /// The current `mapAsync()`, held back because an aborted one is still in
    /// flight in wgpu-core.
    queued: Cell<Option<MapRequest>>,
    destroyed: Cell<bool>,
    /// Creation failed validation. wgpu-core has nothing mapped for such a
    /// buffer, so a "mapped at creation" range is plain zeroed memory.
    invalid: bool,
}

super::gpu_object!(GPUBuffer, label);

struct MapWait;

/// What one `mapAsync()` asked for.
#[derive(Copy, Clone)]
struct MapRequest {
    generation: u32,
    write: bool,
    offset: u64,
    size: u64,
}
// SAFETY: plain integers; nothing in it is tied to a thread.
unsafe impl bun_jsc::job::JsAffine for MapRequest {}

#[derive(bun_jsc::JsAffine)]
struct MapWaitJs {
    buffer: Strong,
    request: MapRequest,
}

/// `Err((aborted, message))`: `aborted` picks AbortError over OperationError.
type MapResult = Result<(), (bool, String)>;

fn map_failure(err: &BufferAccessError) -> (bool, String) {
    let aborted = matches!(
        err,
        BufferAccessError::MapAborted
            | BufferAccessError::DestroyedResource(_)
            | BufferAccessError::Device(_)
    );
    (aborted, error_chain(err))
}

fn rejection(global: &JSGlobalObject, aborted: bool, message: &str) -> JSValue {
    use bun_jsc::EncodedSliceJsc as _;
    let code = if aborted {
        bun_jsc::DOMExceptionCode::AbortError
    } else {
        bun_jsc::DOMExceptionCode::OperationError
    };
    bun_core::EncodedSlice::utf8(message.as_bytes()).to_dom_exception_instance(global, code)
}

/// The array in the `mappedRanges` slot. `unmap()` leaves `undefined` there.
fn mapped_ranges(this_value: JSValue) -> Option<JSValue> {
    js::mapped_ranges_get_cached(this_value).filter(|list| list.is_cell())
}

fn range_error(global: &JSGlobalObject, args: core::fmt::Arguments<'_>) -> bun_jsc::JsError {
    global.throw_value(global.create_range_error_instance(args))
}

impl Waiter for MapWait {
    type Result = MapResult;
    type Js = MapWaitJs;

    fn settle(result: Option<MapResult>, js: MapWaitJs, cx: &JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let this_value = js.buffer.get();
        let Some(buffer) = this_value.as_class_ref::<GPUBuffer>() else {
            return Ok(());
        };
        buffer.in_flight.set(false);
        buffer.device.deliver_loss(global)?;
        let result = result
            .unwrap_or_else(|| Err((true, String::from("mapAsync: the map did not complete"))));

        if buffer.is_current(&js.request) {
            match result {
                Ok(()) => {
                    buffer.map.set(MapState::Mapped {
                        write: js.request.write,
                        start: js.request.offset,
                        end: js.request.offset.saturating_add(js.request.size),
                        ranges: Vec::new(),
                    });
                    buffer.settle_pending(global, this_value, Ok(()))?;
                }
                Err((aborted, message)) => {
                    buffer.map.set(MapState::Unmapped);
                    buffer.device.untrack_mapped(this_value);
                    buffer.settle_pending(global, this_value, Err((aborted, &message)))?;
                }
            }
            return Ok(());
        }

        // `unmap()` or `destroy()` gave up on this request while wgpu-core still had it. If it
        // went through anyway, take the mapping down again, now that nothing else is in flight.
        if result.is_ok() && !buffer.destroyed.get() {
            let _ = instance().buffer_unmap(buffer.raw.id());
        }
        if let Some(queued) = buffer.queued.take() {
            if buffer.is_current(&queued) {
                buffer.issue(global, this_value, queued)?;
            }
        }
        Ok(())
    }
}

impl GPUBuffer {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::BufferId {
        self.raw.id()
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::required(global, descriptor, "GPUBufferDescriptor")?;
        let label = d.label()?;
        let size = d.require_u64("size")?;
        let usage = d.require_u32("usage")?;
        let mapped_at_creation = d.bool_or("mappedAtCreation", false)?;
        if mapped_at_creation && size % 4 != 0 {
            return Err(range_error(
                global,
                format_args!(
                    "createBuffer: size {size} is not a multiple of 4 and mappedAtCreation is true"
                ),
            ));
        }

        let mut desc = wgc::resource::BufferDescriptor {
            label: super::wgpu_label(&label),
            size,
            usage: wgt::BufferUsages::from_bits_truncate(usage & ALL_USAGES),
            mapped_at_creation,
        };
        let mut invalid = false;
        if usage & !ALL_USAGES != 0 {
            device.report(
                global,
                GpuError::validation(format!(
                    "createBuffer: usage 0x{usage:x} has bits that are not a GPUBufferUsage"
                )),
            )?;
            // wgpu-core only hands out an invalid buffer as the result of a failed creation, so
            // ask for one that cannot succeed: a buffer with no usage at all.
            invalid = true;
            desc.mapped_at_creation = false;
            desc.usage = wgt::BufferUsages::empty();
        }
        let (id, err) = instance().device_create_buffer(device.id(), &desc, None);
        let raw = bun_webgpu::Buffer::new(id);
        if let (false, Some(err)) = (invalid, err) {
            if mapped_at_creation && matches!(err, wgc::resource::CreateBufferError::Device(_)) {
                // The allocation failed and the caller expects a mapping back: the spec
                // throws instead of returning a buffer that cannot be written.
                return Err(range_error(
                    global,
                    format_args!(
                        "createBuffer: could not allocate {size} bytes to map at creation"
                    ),
                ));
            }
            invalid = true;
            device.report(global, GpuError::from_wgpu(&err))?;
        }

        // An invalid buffer is still "mapped at creation" as far as script can tell: the
        // error reaches it only through the error scopes.
        let mapped = mapped_at_creation;
        let this = GPUBuffer {
            device: Rc::clone(device),
            raw,
            label: JsCell::new(label),
            size,
            usage,
            map: JsCell::new(if mapped {
                MapState::Mapped {
                    write: true,
                    start: 0,
                    end: size,
                    ranges: Vec::new(),
                }
            } else {
                MapState::Unmapped
            }),
            map_generation: Cell::new(0),
            in_flight: Cell::new(false),
            queued: Cell::new(None),
            destroyed: Cell::new(false),
            invalid,
        };
        let value = this.to_js(global);
        if mapped {
            device.track_mapped(global, value);
        }
        Ok(value)
    }

    pub(crate) fn estimated_size(&self) -> usize {
        core::mem::size_of::<Self>()
            .saturating_add(usize::try_from(self.size).unwrap_or(usize::MAX))
    }

    pub(crate) fn get_size(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(self.size)
    }

    pub(crate) fn get_usage(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(u64::from(self.usage))
    }

    pub(crate) fn get_map_state(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let state = match self.map.get() {
            MapState::Unmapped => "unmapped",
            MapState::Pending => "pending",
            MapState::Mapped { .. } => "mapped",
        };
        bun_core::String::static_(state).to_js(global)
    }

    pub(crate) fn map_async(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        JSPromise::wrap(global, |global| {
            self.map_async_impl(global, callframe, this_value)
        })
    }

    fn map_async_impl(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let mode = args::to_u32(global, callframe.argument(0), "mapAsync: mode")?;
        let offset = match callframe.argument(1) {
            v if v.is_undefined() => 0,
            v => args::to_u64(global, v, "mapAsync: offset")?,
        };
        let size = match callframe.argument(2) {
            v if v.is_undefined() => self.size.saturating_sub(offset),
            v => args::to_u64(global, v, "mapAsync: size")?,
        };

        let reject = |aborted: bool, message: &str| -> JsResult<JSValue> {
            Ok(
                JSPromise::rejected_promise(global, rejection(global, aborted, message))
                    .as_value(global),
            )
        };
        if matches!(self.map.get(), MapState::Pending) {
            return reject(false, "mapAsync: a map is already pending on this buffer");
        }
        if mode != MAP_READ && mode != MAP_WRITE {
            let message = "mapAsync: mode has to be exactly GPUMapMode.READ or GPUMapMode.WRITE";
            self.device.report(global, GpuError::validation(message))?;
            return reject(false, message);
        }

        let generation = self.map_generation.get().wrapping_add(1);
        self.map_generation.set(generation);
        let request = MapRequest {
            generation,
            write: mode == MAP_WRITE,
            offset,
            size,
        };

        let promise = JSPromise::create(global).as_value(global);
        js::pending_map_set_cached(this_value, global, promise);
        self.map.set(MapState::Pending);
        self.device.track_mapped(global, this_value);

        if self.in_flight.get() {
            self.queued.set(Some(request));
        } else {
            self.issue(global, this_value, request)?;
        }
        Ok(promise)
    }

    fn is_current(&self, request: &MapRequest) -> bool {
        self.map_generation.get() == request.generation
            && matches!(self.map.get(), MapState::Pending)
    }

    /// Settles the promise in the `pendingMap` slot and empties the slot.
    fn settle_pending(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        result: Result<(), (bool, &str)>,
    ) -> JsResult<()> {
        let Some(promise) = js::pending_map_get_cached(this_value).and_then(JSValue::as_promise)
        else {
            return Ok(());
        };
        js::pending_map_set_cached(this_value, global, JSValue::UNDEFINED);
        // SAFETY: `as_promise` returned a live JSPromise cell; it is on the stack for this call.
        let promise = unsafe { &mut *promise };
        match result {
            Ok(()) => promise.resolve(global, JSValue::UNDEFINED),
            Err((aborted, message)) => {
                promise.reject(global, Ok(rejection(global, aborted, message)))
            }
        }
    }

    /// Hands `request` to wgpu-core. Only called with nothing in flight.
    fn issue(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        request: MapRequest,
    ) -> JsResult<()> {
        debug_assert!(!self.in_flight.get());
        let slot = Slot::<MapResult>::new();
        let callback = {
            let slot = Arc::clone(&slot);
            Box::new(move |result: Result<(), BufferAccessError>| {
                slot.fill(result.map_err(|e| map_failure(&e)));
            })
        };
        let op = BufferMapOperation {
            host: if request.write {
                HostMap::Write
            } else {
                HostMap::Read
            },
            callback: Some(callback),
        };
        let submission = match instance().buffer_map_async(
            self.raw.id(),
            request.offset,
            Some(request.size),
            op,
        ) {
            Ok(submission) => submission,
            Err(err) => {
                // wgpu-core already ran the callback with this error; the slot is not needed.
                let (aborted, message) = map_failure(&err);
                self.map.set(MapState::Unmapped);
                self.device.untrack_mapped(this_value);
                self.settle_pending(global, this_value, Err((aborted, &message)))?;
                return self.device.report(global, GpuError::from_wgpu(&err));
            }
        };
        self.in_flight.set(true);
        Wait::<MapWait>::schedule(
            &global.js_thread(),
            Arc::clone(&self.device.raw),
            submission,
            slot,
            MapWaitJs {
                buffer: Strong::create(this_value, global),
                request,
            },
        );
        Ok(())
    }

    pub(crate) fn get_mapped_range(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let offset = match callframe.argument(0) {
            v if v.is_undefined() => 0,
            v => args::to_u64(global, v, "getMappedRange: offset")?,
        };
        let size = match callframe.argument(1) {
            v if v.is_undefined() => self.size.saturating_sub(offset),
            v => args::to_u64(global, v, "getMappedRange: size")?,
        };
        let operation_error = |message: &str| {
            global.throw_dom_exception(
                bun_jsc::DOMExceptionCode::OperationError,
                format_args!("getMappedRange: {message}"),
            )
        };

        let MapState::Mapped {
            start,
            end: mapped_end,
            ranges,
            ..
        } = self.map.get()
        else {
            return Err(operation_error("the buffer is not mapped"));
        };
        if offset % 8 != 0 {
            return Err(operation_error("offset is not a multiple of 8"));
        }
        if size % 4 != 0 {
            return Err(operation_error("size is not a multiple of 4"));
        }
        let Some(end) = offset
            .checked_add(size)
            .filter(|end| offset >= *start && *end <= *mapped_end)
        else {
            return Err(operation_error("the range is outside the mapped range"));
        };
        if ranges.iter().any(|(o, s)| offset < o + s && *o < end) {
            return Err(operation_error("the range overlaps one returned earlier"));
        }
        let array_buffer = if self.invalid {
            let mut zeroes = Vec::new();
            if usize::try_from(size).is_err() || zeroes.try_reserve_exact(size as usize).is_err() {
                return Err(range_error(
                    global,
                    format_args!("getMappedRange: could not allocate {size} bytes"),
                ));
            }
            zeroes.resize(size as usize, 0u8);
            ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, &zeroes)?
        } else {
            let (ptr, mapped_len) =
                match instance().buffer_get_mapped_range(self.raw.id(), offset, Some(size)) {
                    Ok(range) => range,
                    Err(err) => return Err(operation_error(&error_chain(&err))),
                };
            debug_assert_eq!(mapped_len, size);
            let bytes: &[u8] = if size == 0 {
                &[]
            } else {
                // SAFETY: wgpu-core mapped `size` readable bytes at `ptr` and keeps them mapped
                // until `buffer_unmap`, which cannot run before this function returns.
                unsafe { core::slice::from_raw_parts(ptr.as_ptr(), size as usize) }
            };
            ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, bytes)?
        };

        let list = match mapped_ranges(this_value) {
            Some(list) => list,
            None => {
                let list = JSValue::create_empty_array(global, 0)?;
                js::mapped_ranges_set_cached(this_value, global, list);
                list
            }
        };
        list.push(global, array_buffer)?;
        self.map.with_mut(|state| {
            if let MapState::Mapped { ranges, .. } = state {
                ranges.push((offset, size));
            }
        });
        Ok(array_buffer)
    }

    /// Ends whatever mapping script can see: rejects a pending `mapAsync()`, or copies write
    /// mappings back and detaches every ArrayBuffer handed out. Returns whether wgpu-core has
    /// a mapping to take down, which is never the case while a request is in flight.
    fn release_mapping(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        write_back: bool,
    ) -> JsResult<bool> {
        self.map_generation
            .set(self.map_generation.get().wrapping_add(1));
        self.queued.set(None);
        self.device.untrack_mapped(this_value);
        let (write, ranges) = match self.map.replace(MapState::Unmapped) {
            MapState::Unmapped => return Ok(false),
            MapState::Pending => {
                self.settle_pending(
                    global,
                    this_value,
                    Err((
                        true,
                        "mapAsync: the buffer was unmapped before the map completed",
                    )),
                )?;
                return Ok(false);
            }
            MapState::Mapped { write, ranges, .. } => (write, ranges),
        };
        let Some(list) = mapped_ranges(this_value) else {
            return Ok(true);
        };
        js::mapped_ranges_set_cached(this_value, global, JSValue::UNDEFINED);
        let mut iter = list.array_iterator(global)?;
        let mut index = 0usize;
        while let Some(array_buffer) = iter.next()? {
            let range = ranges.get(index).copied();
            index += 1;
            if let (true, true, Some((offset, size))) = (write, write_back, range) {
                if let Some(view) = array_buffer.as_array_buffer(global) {
                    if let Ok((ptr, _)) =
                        instance().buffer_get_mapped_range(self.raw.id(), offset, Some(size))
                    {
                        let src = view.byte_slice();
                        let n = src.len().min(size as usize);
                        if n != 0 {
                            // SAFETY: wgpu-core keeps `size` writable bytes mapped at `ptr` until
                            // `buffer_unmap`, which the caller runs after this returns; `n <= size`.
                            unsafe {
                                core::ptr::copy_nonoverlapping(src.as_ptr(), ptr.as_ptr(), n)
                            };
                        }
                    }
                }
            }
            detach_array_buffer(global, array_buffer);
        }
        Ok(true)
    }

    pub(crate) fn unmap(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let was_mapped = self.release_mapping(global, this_value, !self.invalid)?;
        if was_mapped && !self.destroyed.get() && !self.invalid {
            let result = instance().buffer_unmap(self.raw.id());
            self.device.check_result(global, result)?;
        }
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn destroy(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        self.release_mapping(global, this_value, false)?;
        if !self.destroyed.replace(true) {
            // Takes wgpu-core's device-wide write lock, so it cannot overlap a poll that is
            // completing a map of this buffer.
            instance().buffer_destroy(self.raw.id());
        }
        Ok(JSValue::UNDEFINED)
    }

    /// `GPUDevice.destroy()` unmaps every buffer of the device. wgpu-core drops
    /// the mappings itself when the device goes.
    pub(crate) fn unmap_for_destroy(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<()> {
        self.release_mapping(global, this_value, false)?;
        Ok(())
    }
}

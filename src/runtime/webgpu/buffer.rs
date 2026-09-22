//! `GPUBuffer`. Mapped ranges are copies, so JS never aliases driver memory.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

use bun_jsc::{
    ArrayBuffer, CallFrame, ContextId, JSGlobalObject, JSPromise, JSType, JSValue, JsCell, JsClass,
    JsResult, JsThread, StringJsc as _, Strong,
};
use bun_webgpu::wgc::device::HostMap;
use bun_webgpu::wgc::resource::{BufferAccessError, BufferMapOperation};
use bun_webgpu::{GpuError, error_chain, instance, wgc, wgt};

use super::args::{self, Dict};
use super::device::DeviceRef;
use super::wait::{self, Waiter};
use super::{detach_array_buffer, pin_array_buffer};
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
        /// `(offset, size)` of each `getMappedRange()` result, in `mappedRanges` slot order.
        ranges: Vec<(u64, u64)>,
    },
}

#[bun_jsc::JsClass]
pub(crate) struct GPUBuffer {
    device: DeviceRef,
    raw: Rc<bun_webgpu::Buffer>,
    label: JsCell<bun_core::String>,
    size: u64,
    usage: u32,
    map: JsCell<MapState>,
    /// Bumped by every `mapAsync()`, `unmap()` and `destroy()`: tells a completion if it is still wanted.
    map_generation: Cell<u32>,
    /// No map request can go to wgpu-core yet: it has one, or it can still act on one that was given up (see `abort_in_flight`).
    in_flight: Cell<bool>,
    /// The current `mapAsync()`, held back while `in_flight`.
    queued: Cell<Option<MapRequest>>,
    destroyed: Cell<bool>,
    /// Creation failed validation: nothing is mapped in wgpu-core, so mapped ranges are zeroed memory.
    invalid: bool,
}

super::gpu_object!(GPUBuffer, label);
super::resource!(GPUBuffer, bun_webgpu::Buffer);

struct MapWait;

/// What one `mapAsync()` asked for.
#[derive(Copy, Clone)]
struct MapRequest {
    generation: u32,
    write: bool,
    offset: u64,
    size: u64,
    /// The script context of the caller: the request is issued and settled in it, whichever wait it had to queue behind.
    context: ContextId,
}

struct MapWaitJs {
    buffer: Strong,
    request: MapRequest,
}

/// `Err((aborted, message))`: `aborted` picks AbortError over OperationError.
type MapResult = Result<(), (bool, String)>;

fn map_failure(err: &BufferAccessError) -> (bool, String) {
    let aborted = matches!(
        err,
        BufferAccessError::MapAborted | BufferAccessError::Device(_)
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
        let result = result
            .unwrap_or_else(|| Err((true, String::from("mapAsync: the map did not complete"))));

        if buffer.is_current(&js.request) {
            buffer.in_flight.set(false);
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

        // `unmap()`, `destroy()` or the end of its script gave up on this request, and `abort_in_flight` took care of the rest.
        Ok(())
    }

    fn stopped(js: &MapWaitJs, global: &JSGlobalObject) -> bool {
        let this_value = js.buffer.get();
        if let Some(buffer) = this_value.as_class_ref::<GPUBuffer>() {
            if buffer.is_current(&js.request) {
                buffer.forget_pending(global, this_value);
                buffer.abort_in_flight(global, this_value);
            }
        }
        false
    }

    fn abandon(_result: Option<MapResult>, js: MapWaitJs, cx: &JsThread<'_>) -> JsResult<()> {
        Self::stopped(&js, cx.global());
        Ok(())
    }
}

/// Ends the hold that [`GPUBuffer::abort_in_flight`] puts on a buffer.
struct MapFence;

impl Waiter for MapFence {
    type Result = ();
    type Js = Strong;

    fn settle(_result: Option<()>, js: Strong, cx: &JsThread<'_>) -> JsResult<()> {
        let this_value = js.get();
        let Some(buffer) = this_value.as_class_ref::<GPUBuffer>() else {
            return Ok(());
        };
        buffer.in_flight.set(false);
        buffer.issue_queued(cx, this_value)
    }
}

impl GPUBuffer {
    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, descriptor, "GPUBufferDescriptor")?;
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
            // wgpu-core hands out an invalid buffer only from a failed creation: ask for one with no usage.
            invalid = true;
            desc.mapped_at_creation = false;
            desc.usage = wgt::BufferUsages::empty();
        }
        let (id, err) = instance().device_create_buffer(device.id(), &desc, None);
        let raw = Rc::new(bun_webgpu::Buffer::new(id));
        if let (false, Some(err)) = (invalid, err) {
            let out_of_memory = matches!(
                err,
                wgc::resource::CreateBufferError::Device(wgc::device::DeviceError::OutOfMemory)
            );
            if mapped_at_creation && out_of_memory {
                // Per spec, a failed allocation with mappedAtCreation throws. A lost device still gets a mapped, invalid buffer.
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

        // An invalid buffer still looks mapped to script: the error only reaches the error scopes.
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
        let value = device.adopt(global, this.to_js(global), js::device_set_cached);
        if mapped {
            device.track_mapped(global, value);
        }
        Ok(value)
    }

    pub(crate) fn estimated_size(&self) -> usize {
        if self.invalid {
            return core::mem::size_of::<Self>();
        }
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
        let offset =
            args::optional_u64(global, callframe.argument(1), "mapAsync: offset")?.unwrap_or(0);
        let size = args::optional_u64(global, callframe.argument(2), "mapAsync: size")?
            .unwrap_or_else(|| self.size.saturating_sub(offset));

        let reject = |aborted: bool, message: &str| -> JsResult<JSValue> {
            Ok(
                JSPromise::rejected_promise(global, rejection(global, aborted, message))
                    .as_value(global),
            )
        };
        match self.map.get() {
            MapState::Unmapped => {}
            MapState::Pending => {
                return reject(false, "mapAsync: a map is already pending on this buffer");
            }
            // The spec makes this a validation error, not an early reject; the existing mapping stays.
            MapState::Mapped { .. } => {
                let message = "mapAsync: the buffer is already mapped";
                self.device.report(global, GpuError::validation(message))?;
                return reject(false, message);
            }
        }
        if mode != MAP_READ && mode != MAP_WRITE {
            let message = "mapAsync: mode has to be exactly GPUMapMode.READ or GPUMapMode.WRITE";
            self.device.report(global, GpuError::validation(message))?;
            return reject(false, message);
        }

        let generation = self.map_generation.get().wrapping_add(1);
        self.map_generation.set(generation);
        let cx = global.js_thread_of_caller(callframe);
        let request = MapRequest {
            generation,
            write: mode == MAP_WRITE,
            offset,
            size,
            context: cx.context().id(),
        };

        let promise = JSPromise::create(global).as_value(global);
        js::pending_map_set_cached(this_value, global, promise);
        self.map.set(MapState::Pending);
        self.device.track_mapped(global, this_value);

        if self.in_flight.get() {
            self.queued.set(Some(request));
        } else {
            self.issue(&cx, this_value, request)?;
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

    /// Ends a pending `mapAsync()` whose caller has stopped (a disposed `Bun.ModuleGraph`). Like `unmap()`, but the promise stays pending, as every promise of that context does.
    fn forget_pending(&self, global: &JSGlobalObject, this_value: JSValue) {
        self.map_generation
            .set(self.map_generation.get().wrapping_add(1));
        self.map.set(MapState::Unmapped);
        self.device.untrack_mapped(this_value);
        js::pending_map_set_cached(this_value, global, JSValue::UNDEFINED);
    }

    /// Takes back the request that wgpu-core has, so that the buffer is unmapped there at once and a submission in the same task can use it. The next `mapAsync()` still has to wait. wgpu-core keeps the buffer on a list of maps to do, and when it gets to that entry it maps whatever request the buffer has by then, which can be before the GPU is done with the buffer. Every entry of now is gone once the work submitted so far is done: that is when the fence ends the hold.
    fn abort_in_flight(&self, global: &JSGlobalObject, this_value: JSValue) {
        debug_assert!(self.in_flight.get());
        if !self.destroyed.get() {
            let device = &self.device.raw;
            let _ = device.exclusive(|| instance().buffer_unmap(self.raw.id()));
        }
        let slot = self.device.waits.slot::<()>();
        {
            let slot = Arc::clone(&slot);
            instance().queue_on_submitted_work_done(
                self.device.raw.queue_id(),
                Box::new(move || slot.fill(())),
            );
        }
        // In the realm's own context: this is no script's wait.
        let cx = global.js_thread(global.bun_vm().root_context());
        wait::wait::<MapFence>(&self.device, &cx, slot, Strong::create(this_value, global));
    }

    /// Issues the `mapAsync()` that had to wait for the one in flight, in the context of its own caller.
    fn issue_queued(&self, cx: &JsThread<'_>, this_value: JSValue) -> JsResult<()> {
        let Some(queued) = self.queued.take() else {
            return Ok(());
        };
        if !self.is_current(&queued) {
            return Ok(());
        }
        let vm = cx.vm();
        if !vm.is_context_live(queued.context) {
            self.forget_pending(cx.global(), this_value);
            return Ok(());
        }
        let _scope = vm.enter_context(queued.context);
        let cx = cx.global().js_thread(vm.context_of(queued.context));
        self.issue(&cx, this_value, queued)
    }

    /// Hands `request` to wgpu-core, for the context `cx` is in. Only called with nothing in flight.
    fn issue(&self, cx: &JsThread<'_>, this_value: JSValue, request: MapRequest) -> JsResult<()> {
        let global = cx.global();
        debug_assert!(!self.in_flight.get());
        let slot = self.device.waits.slot::<MapResult>();
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
        if let Err(err) =
            instance().buffer_map_async(self.raw.id(), request.offset, Some(request.size), op)
        {
            // wgpu-core already ran the callback with this error; the slot is not needed.
            let (aborted, message) = map_failure(&err);
            self.map.set(MapState::Unmapped);
            self.device.untrack_mapped(this_value);
            self.settle_pending(global, this_value, Err((aborted, &message)))?;
            return self.device.report(global, GpuError::from_wgpu(&err));
        }
        self.in_flight.set(true);
        wait::wait::<MapWait>(
            &self.device,
            cx,
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
        let offset = args::optional_u64(global, callframe.argument(0), "getMappedRange: offset")?
            .unwrap_or(0);
        let size = args::optional_u64(global, callframe.argument(1), "getMappedRange: size")?
            .unwrap_or_else(|| self.size.saturating_sub(offset));
        let operation_error = |message: &str| {
            global.throw_dom_exception(
                bun_jsc::DOMExceptionCode::OperationError,
                format_args!("getMappedRange: {message}"),
            )
        };

        let index = {
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
            ranges.len() as u32
        };
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
            self.device.raw.exclusive(|| {
                let (ptr, mapped_len) =
                    match instance().buffer_get_mapped_range(self.raw.id(), offset, Some(size)) {
                        Ok(range) => range,
                        Err(err) => return Err(operation_error(&error_chain(&err))),
                    };
                debug_assert_eq!(mapped_len, size);
                let bytes: &[u8] = if size == 0 {
                    &[]
                } else {
                    // SAFETY: wgpu-core mapped `size` readable bytes at `ptr`. They stay mapped until
                    // `buffer_unmap` or a poll that finds the device lost, and `exclusive` holds both off.
                    unsafe { core::slice::from_raw_parts(ptr.as_ptr(), size as usize) }
                };
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, bytes)
            })?
        };

        let list = match mapped_ranges(this_value) {
            Some(list) => list,
            None => {
                let list = JSValue::create_empty_array(global, 0)?;
                js::mapped_ranges_set_cached(this_value, global, list);
                list
            }
        };
        // A direct index put and get: `push` and iteration would run a setter or getter script put on `Array.prototype`.
        list.put_index(global, index, array_buffer)?;
        pin_array_buffer(array_buffer);
        self.map.with_mut(|state| {
            if let MapState::Mapped { ranges, .. } = state {
                ranges.push((offset, size));
            }
        });
        Ok(array_buffer)
    }

    /// Ends the mapping script can see. Returns whether wgpu-core has a mapping to take down.
    fn release_mapping(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        write_back: bool,
    ) -> JsResult<bool> {
        self.map_generation
            .set(self.map_generation.get().wrapping_add(1));
        // A pending request that was still held back never reached wgpu-core.
        let issued = self.queued.take().is_none();
        self.device.untrack_mapped(this_value);
        let (write, ranges) = match self.map.replace(MapState::Unmapped) {
            MapState::Unmapped => return Ok(false),
            MapState::Pending => {
                if issued {
                    self.abort_in_flight(global, this_value);
                }
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
        for (index, (offset, size)) in ranges.into_iter().enumerate() {
            let array_buffer = list.get_direct_index(global, index as u32)?;
            if !array_buffer.is_cell() {
                continue;
            }
            if write && write_back {
                if let Some(view) = array_buffer.as_array_buffer(global) {
                    self.device.raw.exclusive(|| {
                        let Ok((ptr, _)) =
                            instance().buffer_get_mapped_range(self.raw.id(), offset, Some(size))
                        else {
                            return;
                        };
                        let src = view.byte_slice();
                        let n = src.len().min(size as usize);
                        if n != 0 {
                            // SAFETY: as in `get_mapped_range`, and `n <= size`.
                            unsafe {
                                core::ptr::copy_nonoverlapping(src.as_ptr(), ptr.as_ptr(), n)
                            };
                        }
                    });
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
            let device = &self.device.raw;
            let result = device.exclusive(|| instance().buffer_unmap(self.raw.id()));
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
            // wgpu-core unmaps first: not while a poll on the pool thread completes a map of this buffer.
            let device = &self.device.raw;
            device.exclusive(|| instance().buffer_destroy(self.raw.id()));
        }
        Ok(JSValue::UNDEFINED)
    }

    /// For `GPUDevice.destroy()`: wgpu-core drops the mappings itself when the device goes.
    pub(crate) fn unmap_for_destroy(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<()> {
        self.release_mapping(global, this_value, false)?;
        Ok(())
    }
}

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::bindgen::{self, JsHeap, JsScope, JsWrapper};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    DOMExceptionCode, JSGlobalObject, JSPromise, JSValue, JsClass as _, JsRef, JsResult,
};
use bun_ptr::{JsCell, RefPtr};

use super::adapter::supported_features;
use super::buffer::GPUBuffer;
use super::error::{GPUError, GPUUncapturedErrorEvent};
use super::instance::Instance;
use super::{
    GPUAdapterInfo, GPUQueue, GPUSupportedLimits, WebEnum as _, dom_exception, gpu_object,
    new_object, string_of_view, sys,
};
use crate::generated_bindgen::webgpu::{
    GPUDeviceLostReason, GPUErrorFilter, GPUFeatureName, GPUQueryType, GPUTextureFormat,
    js_GPUDevice,
};

// ───────────────────────────── DeviceState ─────────────────────────────

/// What the callbacks of a device are given, and what its objects share.
///
/// It holds no reference to Dawn's device. Dawn calls the lost callback, which holds a reference to this, once the last
/// reference to the device is gone, and so would never call it.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct DeviceState {
    ref_count: Cell<u32>,
    pub(super) instance: RefPtr<Instance>,
    /// A bit for each `GPUFeatureName` that the device has.
    features: Cell<u32>,
    /// The `GPUDevice`, which this does not keep alive.
    wrapper: JsCell<JsRef>,
    lost: JsCell<Option<GPUDeviceLostInfo>>,
    /// Errors that no error scope caught, for `report_errors`.
    errors: JsCell<Vec<GPUError>>,
    /// `instance` is going to call `report_errors`.
    is_reporting: Cell<bool>,
    /// The buffers that have an `ArrayBuffer` over their memory. Each of those holds a reference to its buffer.
    buffers_with_ranges: JsCell<Vec<NonNull<GPUBuffer>>>,
}

impl DeviceState {
    pub(super) fn new(instance: RefPtr<Instance>) -> RefPtr<Self> {
        RefPtr::new(Self {
            ref_count: Cell::new(1),
            instance,
            features: Cell::new(0),
            wrapper: JsCell::new(JsRef::empty()),
            lost: JsCell::new(None),
            errors: JsCell::new(Vec::new()),
            is_reporting: Cell::new(false),
            buffers_with_ranges: JsCell::new(Vec::new()),
        })
    }

    /// Dawn calls it once, whatever becomes of the device, and none of the device's other callbacks after it.
    ///
    /// It is the one callback that Dawn may call in the middle of any other call, so that a device counts as lost from
    /// the moment that Dawn finds out, and not from the next time somebody waits for something.
    pub(super) fn lost_callback(this: RefPtr<Self>) -> sys::WGPUDeviceLostCallbackInfo {
        sys::WGPUDeviceLostCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            mode: sys::WGPUCallbackMode::AllowSpontaneous,
            callback: Some(on_lost),
            userdata1: this.into_raw().cast(),
            userdata2: core::ptr::null_mut(),
        }
    }

    /// The reference that `lost_callback` holds keeps `this` alive for it.
    pub(super) fn error_callback(this: &RefPtr<Self>) -> sys::WGPUUncapturedErrorCallbackInfo {
        sys::WGPUUncapturedErrorCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            callback: Some(on_uncaptured_error),
            userdata1: this.as_ptr().cast(),
            userdata2: core::ptr::null_mut(),
        }
    }

    /// Dawn is in the middle of a call, so no JavaScript can run. The `GPUDevice` stays until it has heard.
    fn report_later(&self) {
        if self.instance.handle().is_none() || self.is_reporting.replace(true) {
            return;
        }
        if self.wrapper.get().try_get().is_some() {
            self.wrapper
                .with_mut(|wrapper| wrapper.upgrade(self.instance.global()));
        }
        // SAFETY: `self` is live.
        let this = unsafe { RefPtr::init_ref(core::ptr::from_ref(self).cast_mut()) };
        self.instance.report_errors_later(this);
    }

    pub(super) fn is_lost(&self) -> bool {
        self.lost.get().is_some()
    }

    /// Instead of `report_errors`, where there is no script left to tell.
    pub(super) fn forget_errors(&self) {
        self.is_reporting.set(false);
        self.errors.take();
        self.wrapper.with_mut(JsRef::downgrade);
    }

    /// Runs JavaScript.
    pub(super) fn report_errors(&self, vm: &VirtualMachine) {
        let global = self.instance.global();
        self.is_reporting.set(false);
        // Collected already, if one of its objects made the error and nothing else held it.
        let wrapper = self.wrapper.get().try_get();
        self.wrapper.with_mut(JsRef::downgrade);
        for error in self.errors.take() {
            let description = error.describe();
            // SAFETY: the event loop called this to run JavaScript, and `wrapper` is the `GPUDevice`.
            let is_default_prevented = wrapper.is_some_and(|wrapper| unsafe {
                JsScope::with(global.as_mut_ptr(), |cx| {
                    let device = JsWrapper::<GPUDevice>::from_value(wrapper, &cx.heap);
                    let event = GPUUncapturedErrorEvent::create(&cx.heap, error);
                    !bindgen::dispatch_event(cx, device, event)
                })
            });
            if self.instance.is_script_gone(vm) {
                return;
            }
            if !is_default_prevented {
                bun_core::pretty_errorln!("<r><yellow>warn<r><d>:<r> Uncaptured {}", description);
                bun_core::output::flush();
            }
        }
        if let Some(wrapper) = wrapper
            && let Some(promise) = js_GPUDevice::lost_get_cached(wrapper)
            && let Some(promise) = promise.as_promise()
            && let Some(info) = self.lost.get()
        {
            let promise = JSPromise::opaque_mut(promise);
            if promise.status() == bun_jsc::js_promise::Status::Pending {
                // An error is the termination of the VM, which the event loop finds out by itself.
                let _ = promise.resolve(global, info.clone().to_js(global));
            }
        }
    }

    /// A `TypeError` unless the device has `feature`, which `what` takes.
    fn require_feature<'a>(
        &self,
        heap: &JsHeap<'a>,
        feature: GPUFeatureName,
        what: &str,
    ) -> bindgen::Result<'a, ()> {
        if self.features.get() & (1 << feature as u32) != 0 {
            return Ok(());
        }
        Err(heap.type_error(format_args!(
            "\"{what}\" takes the feature \"{}\", which the device was not requested with",
            GPUFeatureName::SPELLINGS[feature as usize]
        )))
    }

    /// "Validate texture format required features", which comes before anything that Dawn validates.
    pub(super) fn validate_format<'a>(
        &self,
        heap: &JsHeap<'a>,
        format: GPUTextureFormat,
    ) -> bindgen::Result<'a, ()> {
        use GPUTextureFormat as Format;
        let name = Format::SPELLINGS[format as usize];
        let feature = match format {
            Format::Depth32floatStencil8 => GPUFeatureName::Depth32floatStencil8,
            Format::R16unorm
            | Format::R16snorm
            | Format::Rg16unorm
            | Format::Rg16snorm
            | Format::Rgba16unorm
            | Format::Rgba16snorm => GPUFeatureName::TextureFormatsTier1,
            _ if name.starts_with("bc") => GPUFeatureName::TextureCompressionBc,
            _ if name.starts_with("etc2") || name.starts_with("eac") => {
                GPUFeatureName::TextureCompressionEtc2
            }
            _ if name.starts_with("astc") => GPUFeatureName::TextureCompressionAstc,
            _ => return Ok(()),
        };
        self.require_feature(heap, feature, name)
    }

    pub(super) fn validate_query_type<'a>(
        &self,
        heap: &JsHeap<'a>,
        query_type: GPUQueryType,
    ) -> bindgen::Result<'a, ()> {
        match query_type {
            GPUQueryType::Occlusion => Ok(()),
            GPUQueryType::Timestamp => {
                self.require_feature(heap, GPUFeatureName::TimestampQuery, "timestamp")
            }
        }
    }

    pub(super) fn add_buffer_with_ranges(&self, buffer: NonNull<GPUBuffer>) {
        self.buffers_with_ranges
            .with_mut(|buffers| buffers.push(buffer));
    }

    pub(super) fn remove_buffer_with_ranges(&self, buffer: NonNull<GPUBuffer>) {
        self.buffers_with_ranges
            .with_mut(|buffers| buffers.retain(|other| *other != buffer));
    }
}

unsafe extern "C" fn on_lost(
    _device: *const sys::WGPUDevice,
    reason: sys::WGPUDeviceLostReason,
    message: sys::WGPUStringView,
    userdata1: *mut c_void,
    _userdata2: *mut c_void,
) {
    // SAFETY: the reference that `lost_callback` gave up. Whoever made the call that Dawn is in holds another, so
    // dropping this one frees nothing while Dawn runs.
    let state = unsafe { RefPtr::<DeviceState>::from_raw(userdata1.cast()) };
    state.lost.set(Some(GPUDeviceLostInfo {
        reason: match reason {
            sys::WGPUDeviceLostReason::Destroyed => GPUDeviceLostReason::Destroyed,
            _ => GPUDeviceLostReason::Unknown,
        },
        // SAFETY: Dawn's, until this returns.
        message: unsafe { string_of_view(message) },
    }));
    // Otherwise nobody can ask. That is so where the collector dropped the last reference to the device.
    if state.wrapper.get().try_get().is_some() {
        state.report_later();
    }
}

unsafe extern "C" fn on_uncaptured_error(
    _device: *const sys::WGPUDevice,
    kind: sys::WGPUErrorType,
    message: sys::WGPUStringView,
    userdata1: *mut c_void,
    _userdata2: *mut c_void,
) {
    // SAFETY: see `error_callback`.
    let state = unsafe { &*userdata1.cast::<DeviceState>() };
    // SAFETY: Dawn's, until this returns.
    let error = unsafe { GPUError::of(kind, message) };
    state.errors.with_mut(|errors| errors.push(error));
    state.report_later();
}

/// A reference to Dawn's device. Dawn destroys a device when the last one goes, whatever is still made of it, so every
/// object of a device and every operation that it has not finished holds one.
pub(super) struct DeviceRef {
    handle: sys::WGPUDevice,
    pub(super) state: RefPtr<DeviceState>,
}

impl Clone for DeviceRef {
    fn clone(&self) -> Self {
        // SAFETY: a live device.
        unsafe { sys::wgpuDeviceAddRef(self.handle) };
        Self {
            handle: self.handle,
            state: self.state.clone(),
        }
    }
}

impl Drop for DeviceRef {
    fn drop(&mut self) {
        // SAFETY: the reference that `GPUDevice::device_ref` added.
        unsafe { sys::wgpuDeviceRelease(self.handle) }
    }
}

// ───────────────────────────── GPUDeviceLostInfo ─────────────────────────────

#[derive(Clone)]
pub(crate) struct GPUDeviceLostInfo {
    reason: GPUDeviceLostReason,
    message: bun_core::String,
}

impl GPUDeviceLostInfo {
    pub(crate) fn get_reason(&self) -> GPUDeviceLostReason {
        self.reason
    }
    pub(crate) fn get_message(&self) -> bun_core::String {
        self.message.clone()
    }
}

// ───────────────────────────── GPUDevice ─────────────────────────────

gpu_object! {
    GPUDevice {
        handle: WGPUDevice,
        release: wgpuDeviceRelease,
        set_label: wgpuDeviceSetLabel,
        state: RefPtr<DeviceState>,
        queue_label: bun_core::String,
    }
}

impl GPUDevice {
    /// Takes over the caller's reference to `handle`.
    pub(super) fn create(
        handle: sys::WGPUDevice,
        label: &bun_core::String,
        state: RefPtr<DeviceState>,
        queue_label: bun_core::String,
    ) -> Self {
        const { assert!(GPUFeatureName::ALL.len() <= 32) };
        let mut features = 0;
        for feature in GPUFeatureName::ALL {
            // SAFETY: a live device.
            if unsafe { sys::wgpuDeviceHasFeature(handle, feature.to_sys()) } != 0 {
                features |= 1 << feature as u32;
            }
        }
        state.features.set(features);
        Self::new(handle, label, state, queue_label)
    }

    pub(super) fn into_js(self, global: &JSGlobalObject) -> JSValue {
        let state = self.state.clone();
        let wrapper = self.to_js(global);
        state.wrapper.set(JsRef::init_weak(wrapper));
        wrapper
    }

    pub(crate) fn finalize(&self) {
        self.state.wrapper.with_mut(JsRef::finalize);
    }

    pub(super) fn device_ref(&self) -> DeviceRef {
        // SAFETY: a live device.
        unsafe { sys::wgpuDeviceAddRef(self.handle) };
        DeviceRef {
            handle: self.handle,
            state: self.state.clone(),
        }
    }

    pub(crate) fn get_features(&self, heap: &JsHeap<'_>) -> JSValue {
        // SAFETY: a live device.
        let features = unsafe {
            supported_features(|features| sys::wgpuDeviceGetFeatures(self.handle, features))
        };
        new_object(heap, features)
    }

    pub(crate) fn get_limits(&self, heap: &JsHeap<'_>) -> JSValue {
        // SAFETY: a live device.
        let limits = GPUSupportedLimits::of(|limits| unsafe {
            sys::wgpuDeviceGetLimits(self.handle, limits)
        });
        new_object(heap, limits)
    }

    pub(crate) fn get_adapter_info(&self, heap: &JsHeap<'_>) -> JSValue {
        // SAFETY: a live device.
        let info =
            unsafe { GPUAdapterInfo::of(|info| sys::wgpuDeviceGetAdapterInfo(self.handle, info)) };
        new_object(heap, info)
    }

    pub(crate) fn get_queue(&self, heap: &JsHeap<'_>) -> JSValue {
        // SAFETY: a live device. The queue takes over the reference.
        let queue = unsafe { sys::wgpuDeviceGetQueue(self.handle) };
        new_object(
            heap,
            GPUQueue::new(queue, &self.queue_label, self.device_ref()),
        )
    }

    pub(crate) fn destroy<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, ()> {
        // Dawn frees the memory that is mapped.
        for buffer in self.state.buffers_with_ranges.get() {
            // SAFETY: an `ArrayBuffer` of its own holds a reference to it.
            unsafe { buffer.as_ref() }.check_ranges_are_free(&cx.heap, "destroy()")?;
        }
        let global = cx.global();
        for buffer in self.state.buffers_with_ranges.take() {
            // SAFETY: as above.
            let buffer = unsafe { RefPtr::init_ref(buffer.as_ptr()) };
            buffer.detach_ranges(global);
        }
        // SAFETY: a live device.
        unsafe { sys::wgpuDeviceDestroy(self.handle) };
        Ok(())
    }

    pub(crate) fn get_lost(&self, cx: &mut JsScope<'_>) -> JSValue {
        let global = cx.global();
        match self.state.lost.get() {
            Some(info) => JSPromise::resolved_promise_value(global, info.clone().to_js(global)),
            None => JSPromise::create(global).to_js(),
        }
    }

    pub(crate) fn push_error_scope(&self, filter: GPUErrorFilter) {
        // SAFETY: a live device.
        unsafe { sys::wgpuDevicePushErrorScope(self.handle, filter.to_sys()) };
    }

    pub(crate) fn pop_error_scope(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let (promise, userdata) = self
            .state
            .instance
            .new_promise(cx.global(), self.device_ref());
        let callback = sys::WGPUPopErrorScopeCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            mode: sys::WGPUCallbackMode::AllowProcessEvents,
            callback: Some(on_error_scope_popped),
            userdata1: userdata,
            userdata2: core::ptr::null_mut(),
        };
        // SAFETY: a live device.
        unsafe { sys::wgpuDevicePopErrorScope(self.handle, callback) };
        Ok(promise)
    }
}

unsafe extern "C" fn on_error_scope_popped(
    status: sys::WGPUPopErrorScopeStatus,
    kind: sys::WGPUErrorType,
    message: sys::WGPUStringView,
    userdata1: *mut c_void,
    _userdata2: *mut c_void,
) {
    // SAFETY: `pop_error_scope` passed what `new_promise` gave it.
    let (settle, _device) = unsafe { Instance::finish::<DeviceRef>(userdata1) };
    settle.with(|global| {
        if status != sys::WGPUPopErrorScopeStatus::Success {
            // SAFETY: Dawn's, until this returns.
            let message = unsafe { super::bytes_of_view(message) };
            return Err(dom_exception(
                global,
                DOMExceptionCode::OperationError,
                message,
            ));
        }
        if kind == sys::WGPUErrorType::NoError {
            return Ok(JSValue::NULL);
        }
        // SAFETY: Dawn's, until this returns.
        Ok(unsafe { GPUError::of(kind, message) }.into_js(global))
    });
}

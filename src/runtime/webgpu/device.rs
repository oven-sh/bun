//! `GPUDevice`'s native half, and the per-device state every object created
//! from a device shares: the error-scope stack and the route to the device's
//! `uncapturederror` event and `lost` promise.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult};
use bun_threading::Guarded;
use bun_webgpu::{ErrorKind, GpuError, instance, wgt};

use super::args::{self, Dict};
use super::{
    GPUBindGroup, GPUBindGroupLayout, GPUBuffer, GPUCommandEncoder, GPUComputePipeline,
    GPUPipelineLayout, GPUQuerySet, GPUQueue, GPURenderBundleEncoder, GPURenderPipeline,
    GPUSampler, GPUShaderModule, GPUTexture, js_module,
};
use crate::generated_classes::js_GPUDeviceHandle as js;

struct ErrorScope {
    filter: ErrorKind,
    error: Option<GpuError>,
}

/// Set by wgpu-core, on whichever thread notices, when the device is lost for a
/// reason other than `destroy()`. The JS thread picks it up at its next visit.
#[derive(Default)]
pub(crate) struct LostSignal(Guarded<Option<String>>);

pub(crate) struct DeviceState {
    pub raw: Arc<bun_webgpu::Device>,
    /// The features the device was created with.
    features: wgt::Features,
    scopes: JsCell<Vec<ErrorScope>>,
    /// The `GPUDeviceHandle` wrapper, weakly: it owns the error handler and the
    /// `lost` promise in GC-visited slots, so holding it strongly from here
    /// would tie a cycle through a root.
    handle: JsCell<bun_jsc::Weak<()>>,
    lost_signal: Arc<LostSignal>,
    /// `destroy()` ran, or the loss was already delivered to `lost`.
    lost: Cell<bool>,
    /// `(reason, message)` of the loss, for a `lost` promise that is first read after it.
    lost_info: JsCell<Option<(&'static str, String)>>,
    /// Every buffer of this device that is mapped or has a pending map, so
    /// `destroy()` can unmap them as the spec requires.
    mapped_buffers: JsCell<Vec<bun_jsc::Weak<()>>>,
}

pub(crate) type DeviceRef = Rc<DeviceState>;

impl DeviceState {
    #[inline]
    pub(crate) fn id(&self) -> bun_webgpu::wgc::id::DeviceId {
        self.raw.id()
    }

    /// WebGPU's "validate texture format required features": naming a format
    /// whose feature the device did not enable is a TypeError at the call, not
    /// a validation error later.
    pub(crate) fn check_format(
        &self,
        global: &JSGlobalObject,
        format: wgt::TextureFormat,
        what: &str,
    ) -> JsResult<()> {
        let required = format.required_features();
        if self.features.contains(required) {
            return Ok(());
        }
        let format = bun_webgpu::names::texture_format_name(format);
        let feature = bun_webgpu::names::FEATURES
            .iter()
            .find(|(_, flag)| *flag == required)
            .map(|(name, _)| *name);
        Err(match feature {
            Some(feature) => global.throw_type_error(format_args!(
                "{what}: format '{format}' requires the feature '{feature}', which this device was not created with"
            )),
            None => global.throw_type_error(format_args!(
                "{what}: format '{format}' requires a feature this device does not have"
            )),
        })
    }

    /// Routes a wgpu-core error the way WebGPU's "dispatch error" does: into
    /// the innermost error scope that filters for its kind, else to the
    /// device's `uncapturederror` event (fired from a microtask).
    pub(crate) fn report(&self, global: &JSGlobalObject, err: GpuError) -> JsResult<()> {
        if err.device_lost || self.lost.get() {
            return Ok(());
        }
        let uncaptured = self.scopes.with_mut(|scopes| {
            for scope in scopes.iter_mut().rev() {
                if scope.filter == err.kind {
                    if scope.error.is_none() {
                        scope.error = Some(err);
                    }
                    return None;
                }
            }
            Some(err)
        });
        let Some(err) = uncaptured else { return Ok(()) };
        let Some(handle) = self.handle.get().get() else {
            return Ok(());
        };
        let Some(handler) = js::error_handler_get_cached(handle) else {
            return Ok(());
        };
        let kind = JSValue::js_number_from_int32(err.kind as i32);
        let message = bun_jsc::bun_string_jsc::create_utf8_for_js(global, err.message.as_bytes())?;
        global.queue_microtask(handler, &[kind, message]);
        Ok(())
    }

    /// [`report`](Self::report) for the common "wgpu-core returned `Some(error)`" shape.
    pub(crate) fn check<E>(&self, global: &JSGlobalObject, err: Option<E>) -> JsResult<()>
    where
        E: wgt::error::WebGpuError + 'static,
    {
        match err {
            Some(e) => self.report(global, GpuError::from_wgpu(&e)),
            None => Ok(()),
        }
    }

    pub(crate) fn check_result<E>(
        &self,
        global: &JSGlobalObject,
        result: Result<(), E>,
    ) -> JsResult<()>
    where
        E: wgt::error::WebGpuError + 'static,
    {
        self.check(global, result.err())
    }

    /// Resolves `lost` if wgpu-core reported a loss since the last visit.
    pub(crate) fn deliver_loss(&self, global: &JSGlobalObject) -> JsResult<()> {
        if self.lost.get() {
            return Ok(());
        }
        let Some(message) = self.lost_signal.0.lock().take() else {
            return Ok(());
        };
        self.resolve_lost(global, "unknown", &message)
    }

    fn resolve_lost(
        &self,
        global: &JSGlobalObject,
        reason: &'static str,
        message: &str,
    ) -> JsResult<()> {
        self.lost.set(true);
        self.lost_info.set(Some((reason, message.to_owned())));
        let Some(handle) = self.handle.get().get() else {
            return Ok(());
        };
        // Nothing read `lost` yet: the getter resolves it from `lost_info` when something does.
        let Some(promise) = js::lost_get_cached(handle).and_then(JSValue::as_promise) else {
            return Ok(());
        };
        let info = lost_info_to_js(global, reason, message)?;
        // SAFETY: `as_promise` returned a live JSPromise cell; it stays alive through `handle`.
        unsafe { &mut *promise }.resolve(global, info)
    }

    pub(crate) fn track_mapped(&self, global: &JSGlobalObject, buffer: JSValue) {
        self.mapped_buffers.with_mut(|list| {
            list.retain(|w| w.get().is_some_and(|v| v != buffer));
            list.push(bun_jsc::Weak::create_passive(buffer, global));
        });
    }

    pub(crate) fn untrack_mapped(&self, buffer: JSValue) {
        self.mapped_buffers
            .with_mut(|list| list.retain(|w| w.get().is_some_and(|v| v != buffer)));
    }
}

/// A `GPUDeviceLostInfo`.
fn lost_info_to_js(
    global: &JSGlobalObject,
    reason: &'static str,
    message: &str,
) -> JsResult<JSValue> {
    use bun_jsc::StringJsc as _;
    js_module(
        global,
        "createDeviceLostInfo",
        &[
            bun_core::String::static_(reason).to_js(global)?,
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, message.as_bytes())?,
        ],
    )
}

#[bun_jsc::JsClass]
pub struct GPUDeviceHandle {
    state: DeviceRef,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUDeviceHandle, label);

impl GPUDeviceHandle {
    /// Wraps a freshly requested device and returns the JS `GPUDevice` around it.
    pub(crate) fn create(
        global: &JSGlobalObject,
        raw: bun_webgpu::Device,
        label: bun_core::String,
    ) -> JsResult<JSValue> {
        let lost_signal = Arc::new(LostSignal::default());
        {
            let signal = Arc::clone(&lost_signal);
            instance().device_set_device_lost_closure(
                raw.id(),
                Box::new(move |reason, message| {
                    if reason != wgt::DeviceLostReason::Destroyed {
                        *signal.0.lock() = Some(message);
                    }
                }),
            );
        }
        let features = instance().device_features(raw.id());
        let state = Rc::new(DeviceState {
            raw: Arc::new(raw),
            features,
            scopes: JsCell::new(Vec::new()),
            handle: JsCell::new(bun_jsc::Weak::default()),
            lost_signal,
            lost: Cell::new(false),
            lost_info: JsCell::new(None),
            mapped_buffers: JsCell::new(Vec::new()),
        });
        let handle = bun_jsc::JsClass::to_js(
            GPUDeviceHandle {
                state: Rc::clone(&state),
                label: JsCell::new(label),
            },
            global,
        );
        state
            .handle
            .set(bun_jsc::Weak::create_passive(handle, global));
        js_module(global, "createDevice", &[handle])
    }

    pub(crate) fn set_error_handler(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let handler = callframe.argument(0);
        if !handler.is_callable() {
            return Err(
                global.throw_type_error(format_args!("setErrorHandler: expected a function"))
            );
        }
        js::error_handler_set_cached(this_value, global, handler);
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn get_features(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        super::adapter::features_to_js(global, instance().device_features(self.state.id()))
    }

    pub(crate) fn get_limits(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        super::adapter::limits_to_js(global, &instance().device_limits(self.state.id()))
    }

    pub(crate) fn get_adapter_info(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        super::adapter::info_to_js(global, &instance().device_adapter_info(self.state.id()))
    }

    pub(crate) fn get_queue(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(GPUQueue::create(global, &self.state))
    }

    /// Runs once: the generated getter keeps the promise in the `lost` slot,
    /// where `resolve_lost` finds it.
    pub(crate) fn get_lost(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self.state.lost_info.get() {
            Some((reason, message)) => {
                let info = lost_info_to_js(global, reason, message)?;
                Ok(JSPromise::resolved_promise_value(global, info))
            }
            None => Ok(JSPromise::create(global).as_value(global)),
        }
    }

    pub(crate) fn destroy(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let state = &self.state;
        if !state.lost.get() {
            let mapped = state.mapped_buffers.take();
            for weak in &mapped {
                if let Some(buffer) = weak.get() {
                    if let Some(b) = buffer.as_class_ref::<GPUBuffer>() {
                        b.unmap_for_destroy(global, buffer)?;
                    }
                }
            }
            state.resolve_lost(global, "destroyed", "device.destroy() was called")?;
        }
        instance().device_destroy(state.id());
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn push_error_scope(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let filter = args::to_enum(
            global,
            callframe.argument(0),
            "pushErrorScope",
            "GPUErrorFilter",
            bun_webgpu::parse_error_filter,
        )?;
        self.state.scopes.with_mut(|scopes| {
            scopes.push(ErrorScope {
                filter,
                error: None,
            })
        });
        Ok(JSValue::UNDEFINED)
    }

    /// Resolves to `null` or to `[kind, message]`; the JS `GPUDevice` turns the
    /// pair into the matching `GPUError` subclass.
    pub(crate) fn pop_error_scope(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        JSPromise::wrap(global, |global| self.pop_error_scope_impl(global))
    }

    fn pop_error_scope_impl(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.state.deliver_loss(global)?;
        // A lost device answers `null` and leaves its stack alone, empty or not.
        if self.state.lost.get() {
            return Ok(JSPromise::resolved_promise_value(global, JSValue::NULL));
        }
        let Some(scope) = self.state.scopes.with_mut(Vec::pop) else {
            use bun_jsc::EncodedSliceJsc as _;
            let err =
                bun_core::EncodedSlice::latin1(b"popErrorScope: the error scope stack is empty")
                    .to_dom_exception_instance(global, bun_jsc::DOMExceptionCode::OperationError);
            return Ok(JSPromise::rejected_promise(global, err).as_value(global));
        };
        let value = match scope.error {
            None => JSValue::NULL,
            Some(err) => JSValue::create_array_from_slice(
                global,
                &[
                    JSValue::js_number_from_int32(err.kind as i32),
                    bun_jsc::bun_string_jsc::create_utf8_for_js(global, err.message.as_bytes())?,
                ],
            )?,
        };
        Ok(JSPromise::resolved_promise_value(global, value))
    }

    pub(crate) fn create_buffer(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUBuffer::create(global, &self.state, callframe.argument(0))
    }

    pub(crate) fn create_texture(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUTexture::create(global, &self.state, callframe.argument(0))
    }

    pub(crate) fn create_sampler(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUSampler::create(global, &self.state, callframe.argument(0))
    }

    pub(crate) fn create_bind_group_layout(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUBindGroupLayout::create(global, &self.state, callframe.argument(0))
    }

    pub(crate) fn create_pipeline_layout(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUPipelineLayout::create(global, &self.state, callframe.argument(0))
    }

    pub(crate) fn create_bind_group(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUBindGroup::create(global, &self.state, callframe.argument(0))
    }

    pub(crate) fn create_shader_module(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUShaderModule::create(global, &self.state, callframe.argument(0))
    }

    pub(crate) fn create_compute_pipeline(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        match GPUComputePipeline::create(global, &self.state, callframe.argument(0))? {
            (pipeline, None) => Ok(pipeline),
            (pipeline, Some(err)) => {
                self.state.report(global, err)?;
                Ok(pipeline)
            }
        }
    }

    pub(crate) fn create_render_pipeline(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        match GPURenderPipeline::create(global, &self.state, callframe.argument(0))? {
            (pipeline, None) => Ok(pipeline),
            (pipeline, Some(err)) => {
                self.state.report(global, err)?;
                Ok(pipeline)
            }
        }
    }

    /// The async forms resolve to the pipeline, or reject with
    /// `[reason, message]`, which the JS `GPUDevice` turns into a
    /// `GPUPipelineError`. A failure here does not reach the error scopes.
    pub(crate) fn create_compute_pipeline_async(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        JSPromise::wrap(global, |global| {
            let created = GPUComputePipeline::create(global, &self.state, callframe.argument(0))?;
            pipeline_promise(global, created)
        })
    }

    pub(crate) fn create_render_pipeline_async(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        JSPromise::wrap(global, |global| {
            let created = GPURenderPipeline::create(global, &self.state, callframe.argument(0))?;
            pipeline_promise(global, created)
        })
    }

    pub(crate) fn create_command_encoder(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUCommandEncoder::create(global, &self.state, callframe.argument(0))
    }

    pub(crate) fn create_render_bundle_encoder(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPURenderBundleEncoder::create(global, &self.state, callframe.argument(0))
    }

    pub(crate) fn create_query_set(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUQuerySet::create(global, &self.state, callframe.argument(0))
    }
}

fn pipeline_promise(
    global: &JSGlobalObject,
    created: (JSValue, Option<GpuError>),
) -> JsResult<JSValue> {
    match created {
        (pipeline, None) => Ok(JSPromise::resolved_promise_value(global, pipeline)),
        (_, Some(err)) => {
            let reason = if err.kind == ErrorKind::Validation {
                "validation"
            } else {
                "internal"
            };
            use bun_jsc::StringJsc as _;
            let pair = JSValue::create_array_from_slice(
                global,
                &[
                    bun_core::String::static_(reason).to_js(global)?,
                    bun_jsc::bun_string_jsc::create_utf8_for_js(global, err.message.as_bytes())?,
                ],
            )?;
            Ok(JSPromise::rejected_promise(global, pair).as_value(global))
        }
    }
}

/// `GPUDeviceDescriptor` → the wgpu descriptor. `Err(message)` is a request the
/// spec rejects with an OperationError or TypeError before any device exists.
pub(crate) enum DescriptorError {
    Type(String),
    Operation(String),
}

pub(crate) fn parse_device_descriptor(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<
    Result<
        (
            wgt::DeviceDescriptor<Option<std::borrow::Cow<'static, str>>>,
            bun_core::String,
        ),
        DescriptorError,
    >,
> {
    let d = Dict::new(global, value, "GPUDeviceDescriptor")?;
    let label = d.label()?;

    let mut features = wgt::Features::empty();
    let mut bad_feature: Option<Vec<u8>> = None;
    d.each("requiredFeatures", |item| {
        let name = args::to_utf8(global, item)?;
        if name.as_ref() == b"core-features-and-limits" {
            return Ok(());
        }
        match bun_webgpu::names::parse_feature(&name) {
            Some(f) => features |= f,
            None => {
                if bad_feature.is_none() {
                    bad_feature = Some(name.to_vec());
                }
            }
        }
        Ok(())
    })?;
    if let Some(name) = bad_feature {
        return Ok(Err(DescriptorError::Type(format!(
            "requiredFeatures: '{}' is not a valid GPUFeatureName",
            bstr::BStr::new(&name)
        ))));
    }

    let mut limits = wgt::Limits::default();
    if let Some(record) = d.get("requiredLimits")? {
        if !record.is_object() {
            return Err(global.throw_type_error(format_args!(
                "GPUDeviceDescriptor.requiredLimits: expected an object"
            )));
        }
        let keys = record.keys(global)?;
        let mut iter = keys.array_iterator(global)?;
        while let Some(key) = iter.next()? {
            let name = args::to_utf8(global, key)?;
            let Some(value) = record.get(global, &*name)? else {
                continue;
            };
            let Some(limit) = bun_webgpu::names::find_limit(&name) else {
                return Ok(Err(DescriptorError::Operation(format!(
                    "requiredLimits: '{}' is not a limit",
                    bstr::BStr::new(&*name)
                ))));
            };
            let value = args::to_u64(global, value, limit.name)?;
            if !(limit.set)(&mut limits, value) {
                return Ok(Err(DescriptorError::Operation(format!(
                    "requiredLimits: {value} is out of range for '{}'",
                    limit.name
                ))));
            }
        }
    }

    let desc = wgt::DeviceDescriptor {
        label: super::wgpu_label(&label),
        required_features: features,
        required_limits: limits,
        experimental_features: wgt::ExperimentalFeatures::disabled(),
        memory_hints: wgt::MemoryHints::default(),
        trace: wgt::Trace::Off,
    };
    Ok(Ok((desc, label)))
}

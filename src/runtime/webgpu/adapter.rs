//! `GPUAdapter`, and the conversions to `GPUSupportedFeatures`,
//! `GPUSupportedLimits` and `GPUAdapterInfo` it shares with `GPUDevice`.

use std::cell::Cell;

use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsClass, JsResult, StringJsc as _};
use bun_webgpu::{error_chain, instance, wgc, wgt};

use super::device::{DescriptorError, parse_device_descriptor};
use super::{GPUDeviceHandle, js_module};

#[bun_jsc::JsClass]
pub struct GPUAdapter {
    raw: bun_webgpu::Adapter,
    /// An adapter hands out one device. After that it is "consumed" and
    /// `requestDevice` rejects.
    consumed: Cell<bool>,
}

super::gpu_object!(GPUAdapter);

impl GPUAdapter {
    pub(crate) fn create(global: &JSGlobalObject, raw: bun_webgpu::Adapter) -> JSValue {
        GPUAdapter {
            raw,
            consumed: Cell::new(false),
        }
        .to_js(global)
    }

    pub(crate) fn get_features(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        features_to_js(global, instance().adapter_features(self.raw.id()))
    }

    pub(crate) fn get_limits(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        limits_to_js(global, &instance().adapter_limits(self.raw.id()))
    }

    pub(crate) fn get_info(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        info_to_js(global, &instance().adapter_get_info(self.raw.id()))
    }

    pub(crate) fn request_device(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        JSPromise::wrap(global, |global| self.request_device_impl(global, callframe))
    }

    fn request_device_impl(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        use bun_jsc::EncodedSliceJsc as _;
        let reject_operation = |message: &str| -> JSValue {
            let err = bun_core::EncodedSlice::utf8(message.as_bytes())
                .to_dom_exception_instance(global, bun_jsc::DOMExceptionCode::OperationError);
            JSPromise::rejected_promise(global, err).as_value(global)
        };

        let (desc, label) = match parse_device_descriptor(global, callframe.argument(0))? {
            Ok(parsed) => parsed,
            Err(DescriptorError::Type(message)) => {
                let err = global.create_type_error_instance(format_args!("{message}"));
                return Ok(JSPromise::rejected_promise(global, err).as_value(global));
            }
            Err(DescriptorError::Operation(message)) => return Ok(reject_operation(&message)),
        };
        if self.consumed.get() {
            return Ok(reject_operation(
                "requestDevice: this adapter already created a device",
            ));
        }

        match instance().adapter_request_device(self.raw.id(), &desc, None, None) {
            Ok((device, queue)) => {
                self.consumed.set(true);
                let device =
                    GPUDeviceHandle::create(global, bun_webgpu::Device::new(device, queue), label)?;
                Ok(JSPromise::resolved_promise_value(global, device))
            }
            Err(err) => {
                let message = error_chain(&err);
                // A feature or limit the adapter does not have is the caller's mistake and
                // leaves the adapter usable; everything else (the driver refused) consumes it.
                match err {
                    wgc::instance::RequestDeviceError::UnsupportedFeature(_) => {
                        let err = global.create_type_error_instance(format_args!("{message}"));
                        Ok(JSPromise::rejected_promise(global, err).as_value(global))
                    }
                    _ => Ok(reject_operation(&message)),
                }
            }
        }
    }
}

/// A `GPUSupportedFeatures` holding the WebGPU names of `features`.
pub(crate) fn features_to_js(
    global: &JSGlobalObject,
    features: wgt::Features,
) -> JsResult<JSValue> {
    let names = JSValue::create_empty_array(global, 0)?;
    names.push(
        global,
        bun_core::String::static_("core-features-and-limits").to_js(global)?,
    )?;
    for (name, flag) in bun_webgpu::names::FEATURES {
        if features.contains(*flag) {
            names.push(global, bun_core::String::static_(name).to_js(global)?)?;
        }
    }
    js_module(global, "createSupportedFeatures", &[names])
}

/// A `GPUSupportedLimits` holding `limits`.
pub(crate) fn limits_to_js(global: &JSGlobalObject, limits: &wgt::Limits) -> JsResult<JSValue> {
    let object = JSValue::create_empty_object(global, bun_webgpu::names::LIMITS.len());
    for limit in bun_webgpu::names::LIMITS {
        object.put(
            global,
            limit.name.as_bytes(),
            JSValue::js_number_from_uint64((limit.get)(limits)),
        );
    }
    js_module(global, "createSupportedLimits", &[object])
}

/// A `GPUAdapterInfo` for `info`.
pub(crate) fn info_to_js(global: &JSGlobalObject, info: &wgt::AdapterInfo) -> JsResult<JSValue> {
    // PCI-SIG vendor ids, plus the Khronos-assigned id Mesa's software drivers report.
    let vendor = match info.vendor {
        0x1002 => "amd",
        0x1010 => "img-tec",
        0x106B => "apple",
        0x10DE => "nvidia",
        0x13B5 => "arm",
        0x1414 => "microsoft",
        0x5143 => "qualcomm",
        0x8086 => "intel",
        0x10005 => "mesa",
        _ => "",
    };
    let device = if info.device == 0 {
        String::new()
    } else {
        format!("0x{:04x}", info.device)
    };
    let object = JSValue::create_empty_object(global, 7);
    object.put(
        global,
        b"vendor".as_slice(),
        bun_core::String::static_(vendor).to_js(global)?,
    );
    object.put(
        global,
        b"architecture".as_slice(),
        JSValue::js_empty_string(global),
    );
    object.put(
        global,
        b"device".as_slice(),
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, device.as_bytes())?,
    );
    object.put(
        global,
        b"description".as_slice(),
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, info.name.as_bytes())?,
    );
    object.put(
        global,
        b"subgroupMinSize".as_slice(),
        JSValue::js_number_from_uint64(u64::from(info.subgroup_min_size)),
    );
    object.put(
        global,
        b"subgroupMaxSize".as_slice(),
        JSValue::js_number_from_uint64(u64::from(info.subgroup_max_size)),
    );
    object.put(
        global,
        b"isFallbackAdapter".as_slice(),
        JSValue::js_boolean(info.device_type == wgt::DeviceType::Cpu),
    );
    js_module(global, "createAdapterInfo", &[object])
}

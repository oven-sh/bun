use std::sync::{Arc, Mutex};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass as _, JsResult};

use super::GPUBindGroup::GPUBindGroup;
use super::GPUComputePipeline::GPUComputePipeline;

pub enum ComputeCommand {
    SetPipeline(Arc<wgpu::ComputePipeline>),
    SetBindGroup {
        index: u32,
        group: Arc<wgpu::BindGroup>,
        dynamic_offsets: Vec<u32>,
    },
    DispatchWorkgroups {
        x: u32,
        y: u32,
        z: u32,
    },
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPUComputePassEncoder {
    // Shared with GPUCommandEncoder so `end()` doesn't need a back-reference
    pub commands: JsCell<Arc<Mutex<Vec<ComputeCommand>>>>,
    pub label: JsCell<String>,
}

impl GPUComputePassEncoder {
    pub fn get_label(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, this.label.get().as_bytes())
    }

    pub fn set_label(this: &Self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        if value.is_string() {
            if let Ok(s) = value.to_bun_string(global) {
                let owned = String::from_utf8_lossy(s.to_utf8().slice()).into_owned();
                this.label.set(owned);
            }
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_pipeline(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let pipeline_val = callframe.argument(0);
        let ptr = GPUComputePipeline::from_js(pipeline_val).ok_or_else(|| {
            global.throw(format_args!(
                "GPUComputePassEncoder.setPipeline: argument must be a GPUComputePipeline"
            ))
        })?;
        let pipeline_ref = unsafe { &*ptr };
        let pipeline = Arc::clone(&pipeline_ref.pipeline);
        this.commands
            .get()
            .lock()
            .unwrap()
            .push(ComputeCommand::SetPipeline(pipeline));
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_bind_group(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let index = callframe.argument(0).as_number() as u32;
        let group_val = callframe.argument(1);

        let ptr = GPUBindGroup::from_js(group_val).ok_or_else(|| {
            global.throw(format_args!(
                "GPUComputePassEncoder.setBindGroup: argument must be a GPUBindGroup"
            ))
        })?;
        let group_ref = unsafe { &*ptr };
        let group = Arc::clone(&group_ref.group);

        let dynamic_offsets: Vec<u32> = if callframe.arguments_count() > 2 {
            let offsets_val = callframe.argument(2);
            if offsets_val.is_object() {
                let len = offsets_val.get_length(global).unwrap_or(0) as u32;
                let mut v = Vec::with_capacity(len as usize);
                for i in 0..len {
                    let elem =
                        JSValue::get_index(offsets_val, global, i).unwrap_or(JSValue::UNDEFINED);
                    v.push(elem.as_number() as u32);
                }
                v
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };

        this.commands
            .get()
            .lock()
            .unwrap()
            .push(ComputeCommand::SetBindGroup {
                index,
                group,
                dynamic_offsets,
            });
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn dispatch_workgroups(
        this: &Self,
        _global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let x = callframe.argument(0).as_number() as u32;
        let y = if callframe.arguments_count() > 1 {
            callframe.argument(1).as_number() as u32
        } else {
            1
        };
        let z = if callframe.arguments_count() > 2 {
            callframe.argument(2).as_number() as u32
        } else {
            1
        };
        this.commands
            .get()
            .lock()
            .unwrap()
            .push(ComputeCommand::DispatchWorkgroups { x, y, z });
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn dispatch_workgroups_indirect(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!(
            "GPUComputePassEncoder.dispatchWorkgroupsIndirect: not yet implemented"
        )))
    }

    #[bun_jsc::host_fn(method)]
    pub fn end(
        _this: &Self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn insert_debug_marker(
        _this: &Self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn push_debug_group(
        _this: &Self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn pop_debug_group(
        _this: &Self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
}

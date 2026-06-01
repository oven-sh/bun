use std::sync::Arc;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass as _, JsResult};

use super::GPUBindGroupLayout::GPUBindGroupLayout;

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPUComputePipeline {
    pub pipeline: Arc<wgpu::ComputePipeline>,
    pub label: JsCell<String>,
}

impl GPUComputePipeline {
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
    pub fn get_bind_group_layout(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let index = callframe.argument(0).as_number() as u32;
        let layout = this.pipeline.get_bind_group_layout(index);
        Ok(GPUBindGroupLayout {
            layout: Arc::new(layout),
            label: JsCell::new(String::new()),
        }
        .to_js(global))
    }
}

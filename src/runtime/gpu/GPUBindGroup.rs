use std::sync::Arc;

use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsResult};

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPUBindGroup {
    pub group: Arc<wgpu::BindGroup>,
    pub label: JsCell<String>,
}

impl GPUBindGroup {
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
}

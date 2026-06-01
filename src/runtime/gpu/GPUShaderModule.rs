use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsResult};

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPUShaderModule {
    pub module: wgpu::ShaderModule,
    pub label: JsCell<String>,
}

impl GPUShaderModule {
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
    pub fn get_compilation_info(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &bun_jsc::CallFrame,
    ) -> JsResult<JSValue> {
        // Return a resolved promise with empty messages array
        let mut promise = bun_jsc::JSPromiseStrong::init(global);
        let value = promise.value();
        let result = JSValue::create_empty_object(global, 1);
        result.put(global, b"messages", JSValue::create_empty_object(global, 0));
        let mut p = promise.swap();
        p.resolve(global, result)?;
        Ok(value)
    }
}

use bun_core::String as BunString;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, bun_string_jsc};

bun_output::declare_scope!(S3Stat, visible);

#[bun_jsc::JsClass]
pub struct S3Stat {
    pub(crate) size: u64,
    pub(crate) etag: BunString,
    pub(crate) content_type: BunString,
    pub(crate) last_modified: f64,
}

impl S3Stat {
    pub(crate) fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<Self>> {
        Err(global.throw_illegal_constructor())
    }

    pub(crate) fn init(
        size: u64,
        etag: &[u8],
        content_type: &[u8],
        last_modified: &[u8],
        global: &JSGlobalObject,
    ) -> JsResult<Box<Self>> {
        let last_modified =
            bun_string_jsc::parse_date(&BunString::from_bytes(last_modified), global)?;

        Ok(Box::new(S3Stat {
            size,
            etag: BunString::clone_utf8(etag),
            content_type: BunString::clone_utf8(content_type),
            last_modified,
        }))
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_size(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(self.size as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_etag(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.etag.to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_content_type(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.content_type.to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_last_modified(&self, global: &JSGlobalObject) -> JSValue {
        JSValue::from_date_number(global, self.last_modified)
    }
}

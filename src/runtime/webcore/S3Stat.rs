use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::{String as BunString, StringJsc as _};

bun_output::declare_scope!(S3Stat, visible);

#[derive(bun_jsc::JsClass)]
pub struct S3Stat {
    pub size: u64,
    pub etag: BunString,
    pub content_type: BunString,
    pub last_modified: f64,
}

impl S3Stat {
    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<Self>> {
        Err(global.throw_invalid_arguments("S3Stat is not constructable", &[]))
    }

    pub fn init(
        size: u64,
        etag: &[u8],
        content_type: &[u8],
        last_modified: &[u8],
        global: &JSGlobalObject,
    ) -> JsResult<Box<Self>> {
        let date_str = BunString::init(last_modified);
        // `date_str` drops (derefs) at end of scope.
        let last_modified = date_str.parse_date(global)?;

        Ok(Box::new(S3Stat {
            size,
            etag: BunString::clone_utf8(etag),
            content_type: BunString::clone_utf8(content_type),
            last_modified,
        }))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_size(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(self.size)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_etag(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.etag.to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_content_type(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.content_type.to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_last_modified(&self, global: &JSGlobalObject) -> JSValue {
        JSValue::from_date_number(global, self.last_modified)
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: `this` was produced by `Box::into_raw` in the codegen'd
        // wrapper; finalize is called exactly once on the mutator thread.
        // Dropping the Box runs `BunString::drop` (deref) on `etag` and
        // `content_type`, matching the Zig `deref()` + `bun.destroy(this)`.
        drop(unsafe { Box::from_raw(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/S3Stat.zig (62 lines)
//   confidence: high
//   todos:      0
//   notes:      .classes.ts payload; toJS/fromJS aliases dropped (JsClass derive wires them)
// ──────────────────────────────────────────────────────────────────────────

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_str::{OwnedString, String as BunString};

bun_output::declare_scope!(S3Stat, visible);

#[bun_jsc::JsClass]
pub struct S3Stat {
    pub size: u64,
    pub etag: BunString,
    pub content_type: BunString,
    pub last_modified: f64,
}

impl S3Stat {
    // NOTE: no `#[bun_jsc::host_fn]` here — that macro expands to a shim calling
    // bare `constructor(..)`, which can't resolve inside an `impl`. The
    // `#[bun_jsc::JsClass]` derive already emits the `<Self>::constructor` shim.
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<Self>> {
        Err(global.throw_invalid_arguments(format_args!("S3Stat is not constructable")))
    }

    pub fn init(
        size: u64,
        etag: &[u8],
        content_type: &[u8],
        last_modified: &[u8],
        global: &JSGlobalObject,
    ) -> JsResult<Box<Self>> {
        // `bun_str::String` is `Copy` (no `Drop`); wrap in `OwnedString` so the
        // Zig `defer date_str.deref()` runs on both the `Ok` and `?`-error paths.
        let mut date_str = OwnedString::new(BunString::init(last_modified));
        let last_modified = bun_jsc::bun_string_jsc::parse_date(&mut date_str, global)?;

        Ok(Box::new(S3Stat {
            size,
            etag: BunString::clone_utf8(etag),
            content_type: BunString::clone_utf8(content_type),
            last_modified,
        }))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_size(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(self.size as f64)
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
        let this = unsafe { Box::from_raw(this) };
        // `bun_str::String` is `#[derive(Copy)]` with NO `Drop` impl
        // (src/string/lib.rs), so dropping the Box alone would leak the +1
        // WTFStringImpl refs taken by `clone_utf8` in `init`. Release them
        // explicitly, mirroring Zig's `this.etag.deref(); this.contentType.deref();`.
        this.etag.deref();
        this.content_type.deref();
        drop(this);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/S3Stat.zig (62 lines)
//   confidence: high
//   todos:      0
//   notes:      .classes.ts payload; toJS/fromJS aliases dropped (JsClass derive wires them)
// ──────────────────────────────────────────────────────────────────────────

use bun_core::{OwnedString, String as BunString};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, Local, Scope};

bun_output::declare_scope!(S3Stat, visible);

#[bun_jsc::JsClass]
pub struct S3Stat {
    pub size: u64,
    pub etag: BunString,
    pub content_type: BunString,
    pub last_modified: f64,
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
        // `bun_core::String` is `Copy` (no `Drop`); wrap in `OwnedString` so the
        // string is deref'd on both the `Ok` and `?`-error paths.
        let mut date_str = OwnedString::new(BunString::init(last_modified));
        let last_modified = bun_jsc::bun_string_jsc::parse_date(&mut date_str, global)?;

        Ok(Box::new(S3Stat {
            size,
            etag: BunString::clone_utf8(etag),
            content_type: BunString::clone_utf8(content_type),
            last_modified,
        }))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_size<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        Ok(scope.number(this.size as f64))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_etag<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        scope.string(&this.etag)
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_content_type<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        scope.string(&this.content_type)
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub(crate) fn get_last_modified<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        let v = JSValue::from_date_number(scope.unscoped_global(), this.last_modified);
        Ok(scope.local(v))
    }
}

impl Drop for S3Stat {
    fn drop(&mut self) {
        // `bun_core::String` is `#[derive(Copy)]` with NO `Drop` impl
        // (src/string/lib.rs), so dropping the Box alone would leak the +1
        // WTFStringImpl refs taken by `clone_utf8` in `init`. Release them
        // explicitly.
        // The default `JsFinalize::finalize` (`drop(self)`) runs this on GC.
        self.etag.deref();
        self.content_type.deref();
    }
}

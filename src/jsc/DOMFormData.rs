use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::ZigString;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to WebCore::DOMFormData (C++ side).
    pub struct DOMFormData;
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    safe fn WebCore__DOMFormData__create(arg0: &JSGlobalObject) -> JSValue;
    safe fn WebCore__DOMFormData__createFromURLQuery(
        arg0: &JSGlobalObject,
        arg1: &ZigString,
    ) -> JSValue;
    // safe: `DOMFormData` is an `opaque_ffi!` ZST handle (`&mut` is ABI-identical
    // to a non-null `*mut`); `arg1` is an opaque round-trip pointer C++ only
    // forwards to `arg2` (synchronous, never retained or dereferenced as Rust data).
    safe fn WebCore__DOMFormData__toQueryString(
        arg0: &mut DOMFormData,
        arg1: *mut c_void,
        arg2: extern "C" fn(arg0: *mut c_void, arg1: *mut ZigString),
    );
    safe fn WebCore__DOMFormData__fromJS(js_value0: JSValue) -> *mut DOMFormData;
    safe fn WebCore__DOMFormData__append(
        arg0: &mut DOMFormData,
        arg1: &ZigString,
        arg2: &ZigString,
    );
    safe fn WebCore__DOMFormData__appendBlob(
        arg0: &mut DOMFormData,
        arg1: &JSGlobalObject,
        arg2: &ZigString,
        arg3: *mut c_void,
        arg4: &ZigString,
    );
    safe fn WebCore__DOMFormData__count(arg0: &mut DOMFormData) -> usize;

    // safe: same opaque-handle/round-trip-ctx contract as `toQueryString` above.
    safe fn DOMFormData__forEach(this: &mut DOMFormData, ctx: *mut c_void, cb: ForEachFunction);
}

impl DOMFormData {
    pub fn create(global: &JSGlobalObject) -> JSValue {
        WebCore__DOMFormData__create(global)
    }

    /// C++ side declares a `THROW_SCOPE` and may throw `ERR_STRING_TOO_LONG`
    /// (returns encoded `JSValue::ZERO` on throw) — wrap in a validation scope
    /// so JSC's `validateExceptionChecks` sees the check before the next scope.
    #[track_caller]
    pub fn create_from_url_query(global: &JSGlobalObject, query: &ZigString) -> JsResult<JSValue> {
        crate::from_js_host_call(global, || {
            WebCore__DOMFormData__createFromURLQuery(global, query)
        })
    }

    // PORT NOTE: Zig's `comptime Ctx: type, ctx: Ctx, comptime callback: fn(Ctx, ZigString)`
    // is Zig's spelling of a monomorphized closure. Reshaped to `FnMut(ZigString)` — the
    // closure environment IS the ctx, and the generic trampoline below is the `Wrapper.run`.
    pub fn to_query_string<F>(&mut self, callback: &mut F)
    where
        F: FnMut(ZigString),
    {
        extern "C" fn run<F: FnMut(ZigString)>(c: *mut c_void, str_: *mut ZigString) {
            // SAFETY: `c` is the `&mut F` passed below.
            let cb = unsafe { bun_ptr::callback_ctx::<F>(c) };
            // SAFETY: `str_` is a valid non-null *ZigString for the synchronous callback scope.
            cb(unsafe { *str_ });
        }

        // `callback` lives for the duration of the call (C++ invokes the fn pointer
        // synchronously, does not retain it).
        WebCore__DOMFormData__toQueryString(
            self,
            std::ptr::from_mut::<F>(callback).cast::<c_void>(),
            run::<F>,
        );
    }

    pub fn from_js<'a>(value: JSValue) -> Option<&'a mut DOMFormData> {
        let p = WebCore__DOMFormData__fromJS(value);
        (!p.is_null()).then(|| DOMFormData::opaque_mut(p))
    }

    pub fn append(&mut self, name_: &ZigString, value_: &ZigString) {
        WebCore__DOMFormData__append(self, name_, value_)
    }

    pub fn append_blob(
        &mut self,
        global: &JSGlobalObject,
        name_: &ZigString,
        blob: *mut c_void,
        filename_: &ZigString,
    ) {
        WebCore__DOMFormData__appendBlob(self, global, name_, blob, filename_);
    }

    pub fn count(&mut self) -> usize {
        WebCore__DOMFormData__count(self)
    }

    pub fn for_each<B, F>(&mut self, callback: &mut F)
    where
        F: FnMut(ZigString, FormDataEntry<'_, B>),
    {
        extern "C" fn for_each_wrapper<B, F>(
            ctx_ptr: *mut c_void,
            name_: *mut ZigString,
            value_ptr: *mut c_void,
            filename: *mut ZigString,
            is_blob: u8,
        ) where
            F: FnMut(ZigString, FormDataEntry<'_, B>),
        {
            // SAFETY: ctx_ptr is the `&mut F` passed below; Zig did `ctx_ptr.?` (unwrap non-null).
            let ctx_ = unsafe { bun_ptr::callback_ctx::<F>(ctx_ptr) };
            let value = if is_blob == 0 {
                // SAFETY: when is_blob == 0, value_ptr points to a ZigString.
                FormDataEntry::String(unsafe { *value_ptr.cast::<ZigString>() })
            } else {
                FormDataEntry::File {
                    // SAFETY: when is_blob != 0, value_ptr points to a webcore
                    // Blob (`bun_runtime::webcore::Blob`) valid for the callback
                    // scope (LIFETIMES.tsv: BORROW_PARAM). Caller picks `B`.
                    blob: unsafe { &*value_ptr.cast::<B>() },
                    filename: if filename.is_null() {
                        ZigString::EMPTY
                    } else {
                        // SAFETY: non-null filename points to a valid ZigString for this call.
                        unsafe { *filename }
                    },
                }
            };

            // SAFETY: name_ is always a valid non-null *ZigString for the callback scope.
            ctx_(unsafe { *name_ }, value);
        }

        // TODO(port): jsc.markBinding(@src()) — debug-only binding tracker; no Rust equivalent yet.
        // C++ invokes the callback synchronously and does not retain `ctx` or the fn
        // pointer past this call.
        DOMFormData__forEach(
            self,
            std::ptr::from_mut::<F>(callback).cast::<c_void>(),
            for_each_wrapper::<B, F>,
        );
    }
}

type ForEachFunction = extern "C" fn(
    ctx_ptr: *mut c_void,
    name: *mut ZigString,
    value_ptr: *mut c_void,
    filename: *mut ZigString, // nullable
    is_blob: u8,
);

/// `B` is the caller's `webcore::Blob` type (lives in `bun_runtime`; see
/// [`DOMFormData::for_each`]).
pub enum FormDataEntry<'a, B> {
    String(ZigString),
    File { blob: &'a B, filename: ZigString },
}

// ported from: src/jsc/DOMFormData.zig

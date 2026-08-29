use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::EncodedSlice;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to WebCore::DOMFormData (C++ side).
    pub struct DOMFormData;
}

unsafe extern "C" {
    safe fn WebCore__DOMFormData__create(arg0: &JSGlobalObject) -> JSValue;
    safe fn WebCore__DOMFormData__createFromURLQuery(
        arg0: &JSGlobalObject,
        arg1: &EncodedSlice,
    ) -> JSValue;
    safe fn WebCore__DOMFormData__fromJS(js_value0: JSValue) -> *mut DOMFormData;
    safe fn WebCore__DOMFormData__append(
        arg0: &mut DOMFormData,
        arg1: &EncodedSlice,
        arg2: &EncodedSlice,
    );
    // safe: `DOMFormData`/`JSGlobalObject` are opaque `UnsafeCell`-backed ZST
    // handles; `&EncodedSlice` is ABI-identical to non-null `*const EncodedSlice` and
    // C++ only reads the named struct via `toStringCopy`. `arg3` is an opaque
    // `*Blob` C++ owns (never dereferenced as Rust data) — same round-trip
    // contract as `Zig__GlobalObject__resetModuleRegistryMap`'s `map` param.
    safe fn WebCore__DOMFormData__appendBlob(
        arg0: &mut DOMFormData,
        arg1: &JSGlobalObject,
        arg2: &EncodedSlice,
        arg3: *mut c_void,
        arg4: &EncodedSlice,
    );
    safe fn WebCore__DOMFormData__count(arg0: &mut DOMFormData) -> usize;
}

impl DOMFormData {
    pub fn create(global: &JSGlobalObject) -> JSValue {
        WebCore__DOMFormData__create(global)
    }

    /// C++ side declares a `THROW_SCOPE` and may throw `ERR_STRING_TOO_LONG`
    /// (returns encoded `JSValue::ZERO` on throw) — wrap in a validation scope
    /// so JSC's `validateExceptionChecks` sees the check before the next scope.
    #[track_caller]
    pub fn create_from_url_query(
        global: &JSGlobalObject,
        query: &EncodedSlice,
    ) -> JsResult<JSValue> {
        crate::from_js_host_call(global, || {
            WebCore__DOMFormData__createFromURLQuery(global, query)
        })
    }

    pub fn from_js<'a>(value: JSValue) -> Option<&'a mut DOMFormData> {
        // Returned pointer is valid while `value` is kept alive on the stack
        // (conservative GC scan). Null → None. `DOMFormData` is an opaque ZST
        // handle, so `opaque_mut` is the centralised zero-byte deref proof.
        // The unbounded `'a` cannot be expressed more tightly: the cell is
        // GC-owned, so the caller must keep `value` stack-rooted for the
        // lifetime of the returned reference.
        let p = WebCore__DOMFormData__fromJS(value);
        (!p.is_null()).then(|| DOMFormData::opaque_mut(p))
    }

    pub fn append(&mut self, name_: &EncodedSlice, value_: &EncodedSlice) {
        WebCore__DOMFormData__append(self, name_, value_)
    }

    pub fn append_blob(
        &mut self,
        global: &JSGlobalObject,
        name_: &EncodedSlice,
        blob: *mut c_void,
        filename_: &EncodedSlice,
    ) {
        WebCore__DOMFormData__appendBlob(self, global, name_, blob, filename_);
    }

    pub fn count(&mut self) -> usize {
        WebCore__DOMFormData__count(self)
    }
}

/// One `FormData` entry as [`DOMFormData::for_each`] presents it. The
/// strings and the blob belong to the `DOMFormData`'s entries.
pub enum FormDataEntry<'a> {
    String(EncodedSlice<'a>),
    File {
        blob: &'a crate::webcore_types::Blob,
        filename: EncodedSlice<'a>,
    },
}

impl DOMFormData {
    /// Call `f(name, entry)` for every entry, in order. C++ walks its own
    /// list synchronously. The names, strings and blobs are the entries' own
    /// and live while `self` stays borrowed and unmodified: neither `f` nor
    /// the holder of `'a` may run JS (which could mutate the `FormData`).
    pub fn for_each<'a, F: FnMut(EncodedSlice<'a>, FormDataEntry<'a>)>(&'a mut self, mut f: F) {
        type Thunk<'a> = extern "C" fn(
            *mut c_void,
            *mut EncodedSlice<'a>,
            *mut c_void,
            *mut EncodedSlice<'a>,
            u8,
        );
        unsafe extern "C" {
            // safe: `this` is the exclusive borrow; `ctx`/`cb` are only used
            // for the duration of the call.
            safe fn DOMFormData__forEach(this: &mut DOMFormData, ctx: *mut c_void, cb: Thunk<'_>);
        }
        extern "C" fn thunk<'a, F: FnMut(EncodedSlice<'a>, FormDataEntry<'a>)>(
            ctx: *mut c_void,
            name: *mut EncodedSlice<'a>,
            value: *mut c_void,
            filename: *mut EncodedSlice<'a>,
            is_blob: u8,
        ) {
            // SAFETY: `ctx` is the `&mut F` passed below, live for this
            // synchronous callback; `name` (and `filename` when non-null) point
            // at stack `EncodedSlice`s in `DOMFormData__forEach`; `value` is a
            // `EncodedSlice*` for string entries and the entry's `JSBlob::m_ctx`
            // (`Blob*`, alive with the entry) for file entries.
            unsafe {
                let f = &mut *ctx.cast::<F>();
                let entry = if is_blob == 0 {
                    FormDataEntry::String(*value.cast::<EncodedSlice<'a>>())
                } else {
                    FormDataEntry::File {
                        blob: &*value.cast::<crate::webcore_types::Blob>(),
                        filename: if filename.is_null() {
                            EncodedSlice::EMPTY
                        } else {
                            *filename
                        },
                    }
                };
                f(*name, entry);
            }
        }
        DOMFormData__forEach(self, (&raw mut f).cast::<c_void>(), thunk::<'a, F>);
    }
}

use core::ffi::c_void;

use crate::webcore_types::Blob;
use crate::{JSGlobalObject, JSValue, JsResult, WrapperGuard};
use bun_core::EncodedSlice;

bun_opaque::sealed_handle! {
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
        arg0: &DOMFormData,
        arg1: &JSGlobalObject,
        arg2: &EncodedSlice,
        arg3: &EncodedSlice,
    ) -> bool;
    fn WebCore__DOMFormData__appendBlob(
        arg0: &DOMFormData,
        arg1: &JSGlobalObject,
        arg2: &EncodedSlice,
        arg3: *const c_void,
        arg4: &EncodedSlice,
    ) -> bool;
    safe fn WebCore__DOMFormData__count(arg0: &DOMFormData) -> usize;
    fn DOMFormData__forEach(
        this: &DOMFormData,
        ctx: *mut c_void,
        cb: unsafe extern "C" fn(
            *mut c_void,
            &EncodedSlice,
            *const c_void,
            Option<&EncodedSlice>,
            u8,
        ),
    );
}

#[derive(Clone, Copy)]
pub enum FormDataEntry<'a> {
    String(EncodedSlice<'a>),
    File {
        blob: &'a Blob,
        filename: EncodedSlice<'a>,
    },
}

impl DOMFormData {
    /// # Safety
    /// The form does not change during this call, or while a name or an entry is in use.
    pub unsafe fn for_each<'a, F: FnMut(EncodedSlice<'a>, FormDataEntry<'a>)>(&'a self, mut f: F) {
        unsafe extern "C" fn call<'a, F: FnMut(EncodedSlice<'a>, FormDataEntry<'a>)>(
            f: &mut F,
            name: &EncodedSlice<'a>,
            value: *const c_void,
            filename: Option<&EncodedSlice<'a>>,
            is_blob: u8,
        ) {
            // SAFETY: `value` is the `Blob` that the entry holds a ref on, or else an `EncodedSlice`.
            let entry = unsafe {
                match is_blob {
                    0 => FormDataEntry::String(*value.cast()),
                    _ => FormDataEntry::File {
                        blob: &*value.cast(),
                        filename: filename.copied().unwrap_or(EncodedSlice::EMPTY),
                    },
                }
            };
            f(*name, entry);
        }
        type Call<'a, F> = unsafe extern "C" fn(
            &mut F,
            &EncodedSlice<'a>,
            *const c_void,
            Option<&EncodedSlice<'a>>,
            u8,
        );
        let call: Call<'a, F> = call::<F>;
        // SAFETY: the caller's contract. C++ only hands `f` back to `call`, one entry at a time, until it returns.
        unsafe { DOMFormData__forEach(self, (&raw mut f).cast(), bun_ptr::cast_fn_ptr(call)) };
    }

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

    pub fn from_js(value: &JSValue) -> Option<WrapperGuard<'_, Self>> {
        // SAFETY: a `JSDOMFormData` holds a ref on what it wraps.
        unsafe { WrapperGuard::new(value, WebCore__DOMFormData__fromJS(*value)) }
    }

    #[track_caller]
    pub fn append(
        &self,
        global: &JSGlobalObject,
        name_: &EncodedSlice,
        value_: &EncodedSlice,
    ) -> JsResult<()> {
        crate::call_false_is_throw(global, || {
            WebCore__DOMFormData__append(self, global, name_, value_)
        })
    }

    #[track_caller]
    pub fn append_blob(
        &self,
        global: &JSGlobalObject,
        name_: &EncodedSlice,
        blob: &Blob,
        filename_: &EncodedSlice,
    ) -> JsResult<()> {
        let blob = core::ptr::from_ref(blob).cast();
        // SAFETY: C++ only hands `blob` to `Blob__dupe`, during the call.
        crate::call_false_is_throw(global, || unsafe {
            WebCore__DOMFormData__appendBlob(self, global, name_, blob, filename_)
        })
    }

    pub fn count(&self) -> usize {
        WebCore__DOMFormData__count(self)
    }
}

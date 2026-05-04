use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use bun_jsc::{JSGlobalObject, JSValue, VM};
use bun_runtime::webcore::Blob;
use bun_str::ZigString;

/// Opaque FFI handle to WebCore::DOMFormData (C++ side).
#[repr(C)]
pub struct DOMFormData {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn WebCore__DOMFormData__cast_(js_value0: JSValue, arg1: *mut VM) -> *mut DOMFormData;
    fn WebCore__DOMFormData__create(arg0: *mut JSGlobalObject) -> JSValue;
    fn WebCore__DOMFormData__createFromURLQuery(
        arg0: *mut JSGlobalObject,
        arg1: *mut ZigString,
    ) -> JSValue;
    fn WebCore__DOMFormData__toQueryString(
        arg0: *mut DOMFormData,
        arg1: *mut c_void,
        arg2: unsafe extern "C" fn(arg0: *mut c_void, arg1: *mut ZigString),
    );
    fn WebCore__DOMFormData__fromJS(js_value0: JSValue) -> *mut DOMFormData;
    fn WebCore__DOMFormData__append(
        arg0: *mut DOMFormData,
        arg1: *mut ZigString,
        arg2: *mut ZigString,
    );
    fn WebCore__DOMFormData__appendBlob(
        arg0: *mut DOMFormData,
        arg1: *mut JSGlobalObject,
        arg2: *mut ZigString,
        arg3: *mut c_void,
        arg4: *mut ZigString,
    );
    fn WebCore__DOMFormData__count(arg0: *mut DOMFormData) -> usize;

    // Declared in the Zig but never called (WebCore__DOMFormData__toQueryString is used instead).
    // Kept for symbol parity.
    #[allow(dead_code)]
    fn DOMFormData__toQueryString(
        this: *mut DOMFormData,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(ctx: *mut c_void, arg1: *mut ZigString),
    );

    fn DOMFormData__forEach(this: *mut DOMFormData, ctx: *mut c_void, cb: ForEachFunction);
}

impl DOMFormData {
    pub fn create(global: &JSGlobalObject) -> JSValue {
        // SAFETY: global is a valid &JSGlobalObject; FFI does not retain the pointer.
        unsafe { WebCore__DOMFormData__create(global as *const _ as *mut JSGlobalObject) }
    }

    pub fn create_from_url_query(global: &JSGlobalObject, query: &ZigString) -> JSValue {
        // SAFETY: both pointers are valid for the duration of the call; C++ reads `query`.
        unsafe {
            WebCore__DOMFormData__createFromURLQuery(
                global as *const _ as *mut JSGlobalObject,
                query as *const _ as *mut ZigString,
            )
        }
    }

    // PORT NOTE: Zig's `comptime Ctx: type, ctx: Ctx, comptime callback: fn(Ctx, ZigString)`
    // is Zig's spelling of a monomorphized closure. Reshaped to `FnMut(ZigString)` — the
    // closure environment IS the ctx, and the generic trampoline below is the `Wrapper.run`.
    pub fn to_query_string<F>(&mut self, callback: &mut F)
    where
        F: FnMut(ZigString),
    {
        unsafe extern "C" fn run<F: FnMut(ZigString)>(c: *mut c_void, str_: *mut ZigString) {
            // SAFETY: `c` is the `&mut F` passed below; `str_` is valid for this call.
            let cb = unsafe { &mut *(c as *mut F) };
            cb(unsafe { *str_ });
        }

        // SAFETY: `self` is a valid opaque handle; `callback` lives for the duration of the call
        // (C++ invokes the fn pointer synchronously, does not retain it).
        unsafe {
            WebCore__DOMFormData__toQueryString(
                self,
                callback as *mut F as *mut c_void,
                run::<F>,
            );
        }
    }

    pub fn from_js<'a>(value: JSValue) -> Option<&'a mut DOMFormData> {
        // SAFETY: returned pointer is valid while `value` is kept alive on the stack
        // (conservative GC scan). Null → None.
        // TODO(port): lifetime — unbounded `'a` is a placeholder; caller must keep `value`
        // stack-rooted for the lifetime of the returned reference.
        unsafe { WebCore__DOMFormData__fromJS(value).as_mut() }
    }

    pub fn append(&mut self, name_: &ZigString, value_: &ZigString) {
        // SAFETY: C++ side reads the ZigString params; does not mutate or retain them.
        unsafe {
            WebCore__DOMFormData__append(
                self,
                name_ as *const _ as *mut ZigString,
                value_ as *const _ as *mut ZigString,
            );
        }
    }

    pub fn append_blob(
        &mut self,
        global: &JSGlobalObject,
        name_: &ZigString,
        blob: *mut c_void,
        filename_: &ZigString,
    ) {
        // SAFETY: all pointers valid for the call; `blob` is an opaque *Blob owned by caller.
        unsafe {
            WebCore__DOMFormData__appendBlob(
                self,
                global as *const _ as *mut JSGlobalObject,
                name_ as *const _ as *mut ZigString,
                blob,
                filename_ as *const _ as *mut ZigString,
            );
        }
    }

    pub fn count(&mut self) -> usize {
        // SAFETY: self is a valid opaque handle.
        unsafe { WebCore__DOMFormData__count(self) }
    }

    // PORT NOTE: Zig's `comptime Context: type, ctx: *Context, comptime callback_wrapper`
    // reshaped to a Rust closure; the generic `extern "C"` trampoline below is `Wrap.forEachWrapper`.
    pub fn for_each<F>(&mut self, callback: &mut F)
    where
        F: FnMut(ZigString, FormDataEntry<'_>),
    {
        unsafe extern "C" fn for_each_wrapper<F>(
            ctx_ptr: *mut c_void,
            name_: *mut ZigString,
            value_ptr: *mut c_void,
            filename: *mut ZigString,
            is_blob: u8,
        ) where
            F: FnMut(ZigString, FormDataEntry<'_>),
        {
            // SAFETY: ctx_ptr is the `&mut F` passed below; Zig did `ctx_ptr.?` (unwrap non-null).
            let ctx_ = unsafe { &mut *(ctx_ptr as *mut F) };
            let value = if is_blob == 0 {
                // SAFETY: when is_blob == 0, value_ptr points to a ZigString.
                FormDataEntry::String(unsafe { *(value_ptr as *mut ZigString) })
            } else {
                FormDataEntry::File {
                    // SAFETY: when is_blob != 0, value_ptr points to a WebCore Blob valid for
                    // the callback scope (LIFETIMES.tsv: BORROW_PARAM).
                    blob: unsafe { &*(value_ptr as *mut Blob) },
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
        // SAFETY: `self` is a valid handle; C++ invokes the callback synchronously and does not
        // retain `ctx` or the fn pointer past this call.
        unsafe {
            DOMFormData__forEach(
                self,
                callback as *mut F as *mut c_void,
                for_each_wrapper::<F>,
            );
        }
    }
}

type ForEachFunction = unsafe extern "C" fn(
    ctx_ptr: *mut c_void,
    name: *mut ZigString,
    value_ptr: *mut c_void,
    filename: *mut ZigString, // nullable
    is_blob: u8,
);

pub enum FormDataEntry<'a> {
    String(ZigString),
    File {
        blob: &'a Blob,
        filename: ZigString,
    },
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/DOMFormData.zig (130 lines)
//   confidence: medium
//   todos:      3
//   notes:      comptime ctx+callback pairs reshaped to FnMut closures with generic extern "C" trampolines; from_js lifetime is unbounded placeholder
// ──────────────────────────────────────────────────────────────────────────

use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use crate::{JSGlobalObject, JSValue, VM};
use bun_string::ZigString;

/// Opaque FFI handle to WebCore::DOMFormData (C++ side).
#[repr(C)]
pub struct DOMFormData {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn WebCore__DOMFormData__cast_(js_value0: JSValue, arg1: *mut VM) -> *mut DOMFormData;
    safe fn WebCore__DOMFormData__create(arg0: &JSGlobalObject) -> JSValue;
    safe fn WebCore__DOMFormData__createFromURLQuery(
        arg0: &JSGlobalObject,
        arg1: &ZigString,
    ) -> JSValue;
    fn WebCore__DOMFormData__toQueryString(
        arg0: *mut DOMFormData,
        arg1: *mut c_void,
        arg2: unsafe extern "C" fn(arg0: *mut c_void, arg1: *mut ZigString),
    );
    fn WebCore__DOMFormData__fromJS(js_value0: JSValue) -> *mut DOMFormData;
    safe fn WebCore__DOMFormData__append(
        arg0: &mut DOMFormData,
        arg1: &ZigString,
        arg2: &ZigString,
    );
    fn WebCore__DOMFormData__appendBlob(
        arg0: *mut DOMFormData,
        arg1: *mut JSGlobalObject,
        arg2: *const ZigString,
        arg3: *mut c_void,
        arg4: *const ZigString,
    );
    safe fn WebCore__DOMFormData__count(arg0: &mut DOMFormData) -> usize;

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
        WebCore__DOMFormData__create(global)
    }

    pub fn create_from_url_query(global: &JSGlobalObject, query: &ZigString) -> JSValue {
        WebCore__DOMFormData__createFromURLQuery(global, query)
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
            let cb = unsafe { &mut *c.cast::<F>() };
            cb(unsafe { *str_ });
        }

        // SAFETY: `self` is a valid opaque handle; `callback` lives for the duration of the call
        // (C++ invokes the fn pointer synchronously, does not retain it).
        unsafe {
            WebCore__DOMFormData__toQueryString(
                self,
                std::ptr::from_mut::<F>(callback).cast::<c_void>(),
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
        WebCore__DOMFormData__append(self, name_, value_)
    }

    pub fn append_blob(
        &mut self,
        global: &JSGlobalObject,
        name_: &ZigString,
        blob: *mut c_void,
        filename_: &ZigString,
    ) {
        // SAFETY: all pointers valid for the call; `blob` is an opaque *Blob owned by caller.
        // C++ only reads the ZigString params via `toStringCopy` (bindings.cpp).
        unsafe {
            WebCore__DOMFormData__appendBlob(self, global.as_ptr(), name_, blob, filename_);
        }
    }

    pub fn count(&mut self) -> usize {
        WebCore__DOMFormData__count(self)
    }

    // PORT NOTE: Zig's `comptime Context: type, ctx: *Context, comptime callback_wrapper`
    // reshaped to a Rust closure; the generic `extern "C"` trampoline below is `Wrap.forEachWrapper`.
    //
    // LAYERING: `FormDataEntry::File::blob` is a `*mut webcore::Blob`, whose
    // layout lives in `bun_runtime` (a dependent of this crate). The C++ side
    // hands it as `*mut c_void`; this fn is generic over `B` so the caller (in
    // `bun_runtime`) names the concrete `Blob` type and gets a typed `&B`
    // borrow without `bun_jsc` ever seeing the layout.
    pub fn for_each<B, F>(&mut self, callback: &mut F)
    where
        F: FnMut(ZigString, FormDataEntry<'_, B>),
    {
        unsafe extern "C" fn for_each_wrapper<B, F>(
            ctx_ptr: *mut c_void,
            name_: *mut ZigString,
            value_ptr: *mut c_void,
            filename: *mut ZigString,
            is_blob: u8,
        ) where
            F: FnMut(ZigString, FormDataEntry<'_, B>),
        {
            // SAFETY: ctx_ptr is the `&mut F` passed below; Zig did `ctx_ptr.?` (unwrap non-null).
            let ctx_ = unsafe { &mut *ctx_ptr.cast::<F>() };
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
        // SAFETY: `self` is a valid handle; C++ invokes the callback synchronously and does not
        // retain `ctx` or the fn pointer past this call.
        unsafe {
            DOMFormData__forEach(
                self,
                std::ptr::from_mut::<F>(callback).cast::<c_void>(),
                for_each_wrapper::<B, F>,
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

/// `B` is the caller's `webcore::Blob` type (lives in `bun_runtime`; see
/// [`DOMFormData::for_each`]).
pub enum FormDataEntry<'a, B> {
    String(ZigString),
    File {
        blob: &'a B,
        filename: ZigString,
    },
}

// ported from: src/jsc/DOMFormData.zig

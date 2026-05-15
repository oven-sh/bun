use core::ffi::c_void;
use core::ptr::NonNull;

use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JSValue, JsResult, VM, host_fn};
use bun_core::{StringPointer, ZigString};
use bun_uws::ResponseKind;

// TODO(port): consider an RAII wrapper that calls `deref` on Drop instead of returning `NonNull<FetchHeaders>` from constructors.
bun_opaque::opaque_ffi! {
    /// Opaque C++ `WebCore::FetchHeaders` handle (ref-counted on the C++ side; see `deref`).
    pub struct FetchHeaders;
}

// TODO(port): move to jsc_sys
//
// `FetchHeaders`/`JSGlobalObject`/`VM` are opaque `UnsafeCell`-backed ZST
// handles, so `&T` is ABI-identical to a non-null `*const T` and C++ mutating
// header storage / VM state through them is interior mutation invisible to
// Rust. `ZigString` is a plain `#[repr(C)]` POD; `&ZigString`/`&mut ZigString`
// at the FFI boundary are sound (C++ reads/writes only the named struct).
// Shims that traffic only in such refs + scalars are declared `safe fn`; those
// that take raw `*mut c_void` / unsized `*mut StringPointer` arrays / `deref`
// (which may free) keep their `unsafe fn` body.
unsafe extern "C" {
    safe fn WebCore__FetchHeaders__append(
        arg0: &FetchHeaders,
        arg1: &ZigString,
        arg2: &ZigString,
        arg3: &JSGlobalObject,
    );
    safe fn WebCore__FetchHeaders__cast_(value0: JSValue, arg1: &VM) -> *mut FetchHeaders;
    safe fn WebCore__FetchHeaders__clone(arg0: &FetchHeaders, arg1: &JSGlobalObject) -> JSValue;
    safe fn WebCore__FetchHeaders__cloneThis(
        arg0: &FetchHeaders,
        arg1: &JSGlobalObject,
    ) -> *mut FetchHeaders;
    fn WebCore__FetchHeaders__copyTo(
        arg0: *mut FetchHeaders,
        arg1: *mut StringPointer,
        arg2: *mut StringPointer,
        arg3: *mut u8,
    );
    safe fn WebCore__FetchHeaders__count(arg0: &FetchHeaders, arg1: &mut u32, arg2: &mut u32);
    safe fn WebCore__FetchHeaders__createEmpty() -> *mut FetchHeaders;
    // safe: `arg0`/`arg1` are opaque handles to C++-owned request structs
    // (PicoHeaders / uWS HttpRequest); never dereferenced as Rust data — same
    // round-trip contract as `Zig__GlobalObject__resetModuleRegistryMap`.
    safe fn WebCore__FetchHeaders__createFromPicoHeaders_(arg0: *const c_void)
    -> *mut FetchHeaders;
    safe fn WebCore__FetchHeaders__createFromUWS(arg1: *mut c_void) -> *mut FetchHeaders;
    fn WebCore__FetchHeaders__createValueNotJS(
        arg0: *const JSGlobalObject,
        arg1: *mut StringPointer,
        arg2: *mut StringPointer,
        arg3: *const ZigString,
        arg4: u32,
    ) -> *mut FetchHeaders;
    fn WebCore__FetchHeaders__createValue(
        arg0: *const JSGlobalObject,
        arg1: *mut StringPointer,
        arg2: *mut StringPointer,
        arg3: *const ZigString,
        arg4: u32,
    ) -> JSValue;
    // safe: `FetchHeaders` is an `opaque_ffi!` ZST handle; `&mut` is ABI-identical
    // to a non-null `*mut` and the C++ refcount decrement is interior to the cell.
    safe fn WebCore__FetchHeaders__deref(arg0: &mut FetchHeaders);
    safe fn WebCore__FetchHeaders__fastGet_(arg0: &FetchHeaders, arg1: u8, arg2: &mut ZigString);
    safe fn WebCore__FetchHeaders__fastHas_(arg0: &FetchHeaders, arg1: u8) -> bool;
    safe fn WebCore__FetchHeaders__fastRemove_(arg0: &FetchHeaders, arg1: u8);
    safe fn WebCore__FetchHeaders__get_(
        arg0: &FetchHeaders,
        arg1: &ZigString,
        arg2: &mut ZigString,
        arg3: &JSGlobalObject,
    );
    safe fn WebCore__FetchHeaders__has(
        arg0: &FetchHeaders,
        arg1: &ZigString,
        arg2: &JSGlobalObject,
    ) -> bool;
    safe fn WebCore__FetchHeaders__isEmpty(arg0: &FetchHeaders) -> bool;
    safe fn WebCore__FetchHeaders__put_(
        arg0: &FetchHeaders,
        arg1: &ZigString,
        arg2: &ZigString,
        arg3: &JSGlobalObject,
    );
    safe fn WebCore__FetchHeaders__remove(
        arg0: &FetchHeaders,
        arg1: &ZigString,
        arg2: &JSGlobalObject,
    );
    safe fn WebCore__FetchHeaders__toJS(arg0: &FetchHeaders, arg1: &JSGlobalObject) -> JSValue;
    // safe: `FetchHeaders` is an opaque ZST handle (`&mut` ≡ non-null `*mut`);
    // `arg2` is an opaque handle to a C++-owned uWS response (never dereferenced
    // as Rust data).
    safe fn WebCore__FetchHeaders__toUWSResponse(
        arg0: &mut FetchHeaders,
        kind: ResponseKind,
        arg2: *mut c_void,
    );
    safe fn WebCore__FetchHeaders__createFromH3(arg0: *mut c_void) -> *mut FetchHeaders;

    safe fn WebCore__FetchHeaders__createFromJS(
        arg0: &JSGlobalObject,
        arg1: JSValue,
    ) -> *mut FetchHeaders;

    safe fn WebCore__FetchHeaders__put(
        this: &FetchHeaders,
        name_: HTTPHeaderName,
        value: &ZigString,
        global: &JSGlobalObject,
    );
}

#[repr(C)]
struct PicoHeaders {
    ptr: *const c_void,
    len: usize,
}

impl FetchHeaders {
    pub fn create_value(
        global: &JSGlobalObject,
        names: *mut StringPointer,
        values: *mut StringPointer,
        buf: &ZigString,
        count_: u32,
    ) -> JSValue {
        // SAFETY: forwarding caller-provided buffers to C++; `global` is an opaque ZST handle
        // passed by address only — C++ never dereferences it as Rust data.
        unsafe { WebCore__FetchHeaders__createValue(global, names, values, buf, count_) }
    }

    /// Construct a `Headers` object from a JSValue.
    ///
    /// This can be:
    /// -  Array<[String, String]>
    /// -  Record<String, String>.
    ///
    /// Throws an exception if invalid.
    ///
    /// If empty, returns null.
    pub fn create_from_js(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<NonNull<FetchHeaders>>> {
        // TODO(port): bun.jsc.fromJSHostCallGeneric — wraps the FFI call and converts a pending VM exception into JsError
        host_fn::from_js_host_call_generic(global, || {
            NonNull::new(WebCore__FetchHeaders__createFromJS(global, value))
        })
    }

    pub fn put_default(
        &mut self,
        name_: HTTPHeaderName,
        value: &[u8],
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        if self.fast_has(name_) {
            return Ok(());
        }

        self.put(name_, value, global)
    }

    pub fn create(
        global: &JSGlobalObject,
        names: *mut StringPointer,
        values: *mut StringPointer,
        buf: &ZigString,
        count_: u32,
    ) -> Option<NonNull<FetchHeaders>> {
        // SAFETY: forwarding caller-provided buffers to C++; `global` is an opaque ZST handle
        // passed by address only.
        let p =
            unsafe { WebCore__FetchHeaders__createValueNotJS(global, names, values, buf, count_) };
        NonNull::new(p)
    }

    pub fn from(
        global: &JSGlobalObject,
        names: *mut StringPointer,
        values: *mut StringPointer,
        buf: &ZigString,
        count_: u32,
    ) -> JSValue {
        // SAFETY: forwarding caller-provided buffers to C++; `global` is an opaque ZST handle
        // passed by address only.
        unsafe { WebCore__FetchHeaders__createValue(global, names, values, buf, count_) }
    }

    pub fn is_empty(&mut self) -> bool {
        WebCore__FetchHeaders__isEmpty(self)
    }

    pub fn create_from_uws(uws_request: *mut c_void) -> NonNull<FetchHeaders> {
        NonNull::new(WebCore__FetchHeaders__createFromUWS(uws_request))
            .expect("WebCore__FetchHeaders__createFromUWS returned null")
    }

    pub fn create_from_h3(h3_request: *mut c_void) -> NonNull<FetchHeaders> {
        NonNull::new(WebCore__FetchHeaders__createFromH3(h3_request))
            .expect("WebCore__FetchHeaders__createFromH3 returned null")
    }

    pub fn to_uws_response(&mut self, kind: ResponseKind, uws_response: *mut c_void) {
        WebCore__FetchHeaders__toUWSResponse(self, kind, uws_response)
    }

    pub fn create_empty() -> NonNull<FetchHeaders> {
        NonNull::new(WebCore__FetchHeaders__createEmpty())
            .expect("WebCore__FetchHeaders__createEmpty returned null")
    }

    // PORT NOTE: reshaped for borrowck — Zig took `pico_headers: anytype` and read
    // `pico_headers.list.ptr` / `.list.len`. In Rust, callers pass the slice directly.
    pub fn create_from_pico_headers<T>(pico_headers_list: &[T]) -> NonNull<FetchHeaders> {
        let out = PicoHeaders {
            ptr: pico_headers_list.as_ptr().cast::<c_void>(),
            len: pico_headers_list.len(),
        };
        // `out` lives across the call; C++ copies the headers synchronously.
        NonNull::new(WebCore__FetchHeaders__createFromPicoHeaders_(
            std::ptr::from_ref(&out).cast::<c_void>(),
        ))
        .expect("WebCore__FetchHeaders__createFromPicoHeaders_ returned null")
    }

    pub fn create_from_pico_headers_(pico_headers: *const c_void) -> NonNull<FetchHeaders> {
        NonNull::new(WebCore__FetchHeaders__createFromPicoHeaders_(pico_headers))
            .expect("WebCore__FetchHeaders__createFromPicoHeaders_ returned null")
    }

    pub fn append(&mut self, name_: &ZigString, value: &ZigString, global: &JSGlobalObject) {
        WebCore__FetchHeaders__append(self, name_, value, global)
    }

    pub fn put(
        &mut self,
        name_: HTTPHeaderName,
        value: &[u8],
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        // TODO(port): bun.jsc.fromJSHostCallGeneric — wraps the FFI call and converts a pending VM exception into JsError
        host_fn::from_js_host_call_generic(global, || {
            let zs = ZigString::init(value);
            WebCore__FetchHeaders__put(self, name_, &zs, global)
        })
    }

    pub fn get_(&mut self, name_: &ZigString, out: &mut ZigString, global: &JSGlobalObject) {
        WebCore__FetchHeaders__get_(self, name_, out, global)
    }

    pub fn get(&mut self, name_: &[u8], global: &JSGlobalObject) -> Option<ZigString> {
        let mut out = ZigString::EMPTY;
        self.get_(&ZigString::init(name_), &mut out, global);
        if out.len > 0 {
            // PORT NOTE: returns the ZigString view (borrows C++-owned header
            // storage); caller may `.slice()` it. Returning `&[u8]` directly
            // would borrow the local `out`, not the underlying buffer.
            return Some(out);
        }

        None
    }

    pub fn has(&mut self, name_: &ZigString, global: &JSGlobalObject) -> bool {
        WebCore__FetchHeaders__has(self, name_, global)
    }

    pub fn fast_has(&mut self, name_: HTTPHeaderName) -> bool {
        self.fast_has_(name_ as u8)
    }

    pub fn fast_get(&mut self, name_: HTTPHeaderName) -> Option<ZigString> {
        let mut str = ZigString::init(b"");
        self.fast_get_(name_ as u8, &mut str);
        if str.len == 0 {
            return None;
        }

        Some(str)
    }

    pub fn fast_has_(&mut self, name_: u8) -> bool {
        WebCore__FetchHeaders__fastHas_(self, name_)
    }

    pub fn fast_get_(&mut self, name_: u8, str: &mut ZigString) {
        WebCore__FetchHeaders__fastGet_(self, name_, str)
    }

    pub fn fast_remove(&mut self, header: HTTPHeaderName) {
        self.fast_remove_(header as u8)
    }

    pub fn fast_remove_(&mut self, header: u8) {
        WebCore__FetchHeaders__fastRemove_(self, header)
    }

    pub fn remove(&mut self, name_: &ZigString, global: &JSGlobalObject) {
        WebCore__FetchHeaders__remove(self, name_, global)
    }

    pub fn cast_(value: JSValue, vm: &VM) -> Option<NonNull<FetchHeaders>> {
        NonNull::new(WebCore__FetchHeaders__cast_(value, vm))
    }

    pub fn cast(value: JSValue) -> Option<NonNull<FetchHeaders>> {
        // SAFETY: `VirtualMachine::get()` is only called from the JS thread, where
        // `global` is a live non-null JSGlobalObject for the VM's lifetime.
        let global = VirtualMachine::get().global();
        Self::cast_(value, global.vm())
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue {
        WebCore__FetchHeaders__toJS(self, global_this)
    }

    pub fn count(&mut self, names: &mut u32, buf_len: &mut u32) {
        WebCore__FetchHeaders__count(self, names, buf_len)
    }

    pub fn clone(&mut self, global: &JSGlobalObject) -> JSValue {
        WebCore__FetchHeaders__clone(self, global)
    }

    pub fn clone_this(
        &mut self,
        global: &JSGlobalObject,
    ) -> JsResult<Option<NonNull<FetchHeaders>>> {
        // TODO(port): bun.jsc.fromJSHostCallGeneric — wraps the FFI call and converts a pending VM exception into JsError
        host_fn::from_js_host_call_generic(global, || {
            NonNull::new(WebCore__FetchHeaders__cloneThis(self, global))
        })
    }

    pub fn deref(&mut self) {
        WebCore__FetchHeaders__deref(self)
    }

    pub fn copy_to(&mut self, names: *mut StringPointer, values: *mut StringPointer, buf: *mut u8) {
        // SAFETY: caller guarantees names/values/buf are sized per a prior `count()` call
        unsafe { WebCore__FetchHeaders__copyTo(self, names, values, buf) }
    }
}

// Canonical enum lives in `bun_http_types::Method::HeaderName` (same 92
// `#[repr(u8)]` discriminants mirroring WebCore's `HTTPHeaderNames.in`). The
// `WebCore__FetchHeaders__put` extern decl above and the `fast_*` methods take
// it by value, so the re-export is ABI-transparent.
pub use bun_http_types::Method::HeaderName as HTTPHeaderName;

// ported from: src/jsc/FetchHeaders.zig

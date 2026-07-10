use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JSValue, JsResult, VM, host_fn};
use bun_core::{String as BunString, StringPointer, ZigString};
use bun_uws::ResponseKind;

/// The C++ object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`FetchHeaders`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// `WebCore::FetchHeaders`. `&Self` is ABI-identical to a non-null
        /// `WebCore::FetchHeaders*`, and carries no `noalias`/`readonly` —
        /// C++ mutates the header storage through it.
        pub struct FetchHeaders;
    }
}

// C++ allocates (`new WebCore::FetchHeaders` + `relaxAdoptionRequirement`) and
// hands back a `+1`. One `FetchHeaders` handle owns exactly that one ref.
bun_opaque::foreign_handle! {
    /// Owned handle to a C++ `WebCore::FetchHeaders`.
    ///
    /// Holds one ref on the C++ intrusive refcount; `Drop` gives it back. Every
    /// method takes `&self`: a refcount is shared by definition, and C++ mutates
    /// the headers through the same pointer, so there is no `&mut self` to have.
    ///
    /// A `FetchHeaders` *borrowed* from a JS `Headers` wrapper (see [`Self::cast`])
    /// is a `ManuallyDrop<FetchHeaders>` — the JS object owns that ref, not us.
    pub struct FetchHeaders(sys::FetchHeaders) via WebCore__FetchHeaders__deref;
}

// `JSGlobalObject`/`VM`/`sys::FetchHeaders` are opaque `UnsafeCell`-backed ZST
// handles, so `&T` is ABI-identical to a non-null `*const T` and C++ mutating
// header storage / VM state through them is interior mutation invisible to
// Rust. `ZigString` and `String` (`BunString`) are plain `#[repr(C)]` PODs;
// `&`/`&mut` refs to them at the FFI boundary are sound (C++ reads/writes
// only the named struct).
// Shims that traffic only in such refs + scalars are declared `safe fn`; those
// that take raw `*mut c_void` / unsized `*mut StringPointer` arrays keep their
// `unsafe fn` body.
unsafe extern "C" {
    safe fn WebCore__FetchHeaders__append(
        arg0: &sys::FetchHeaders,
        arg1: &ZigString,
        arg2: &ZigString,
        arg3: &JSGlobalObject,
    );
    safe fn WebCore__FetchHeaders__cast_(value0: JSValue, arg1: &VM) -> *mut sys::FetchHeaders;
    safe fn WebCore__FetchHeaders__clone(
        arg0: &sys::FetchHeaders,
        arg1: &JSGlobalObject,
    ) -> JSValue;
    safe fn WebCore__FetchHeaders__cloneThis(
        arg0: &sys::FetchHeaders,
        arg1: &JSGlobalObject,
    ) -> *mut sys::FetchHeaders;
    fn WebCore__FetchHeaders__copyTo(
        arg0: &sys::FetchHeaders,
        arg1: *mut StringPointer,
        arg2: *mut StringPointer,
        arg3: *mut u8,
    );
    safe fn WebCore__FetchHeaders__count(arg0: &sys::FetchHeaders, arg1: &mut u32, arg2: &mut u32);
    safe fn WebCore__FetchHeaders__createEmpty() -> *mut sys::FetchHeaders;
    // NOT `safe fn`: C++ does `*reinterpret_cast<PicoHTTPHeaders*>(arg0)` /
    // `*reinterpret_cast<uWS::HttpRequest*>(arg1)`. Safe Rust can forge a
    // `*mut c_void`, so the call itself carries the validity obligation.
    fn WebCore__FetchHeaders__createFromPicoHeaders_(arg0: *const c_void)
    -> *mut sys::FetchHeaders;
    fn WebCore__FetchHeaders__createFromUWS(arg1: *mut c_void) -> *mut sys::FetchHeaders;
    // C++ declares `StringPointer*` but only reads `arg1[i]`/`arg2[i]`, so the
    // Rust side declares `*const` and passes shared slices.
    fn WebCore__FetchHeaders__createValueNotJS(
        arg0: &JSGlobalObject,
        arg1: *const StringPointer,
        arg2: *const StringPointer,
        arg3: &ZigString,
        arg4: u32,
    ) -> *mut sys::FetchHeaders;
    // safe: C++ takes `FetchHeaders*` and calls the intrusive `->deref()`. A
    // refcount decrement is not exclusive access — other refs exist by
    // definition — so the receiver is `&`, not `&mut`.
    safe fn WebCore__FetchHeaders__deref(arg0: &sys::FetchHeaders);
    safe fn WebCore__FetchHeaders__fastGet_(
        arg0: &sys::FetchHeaders,
        arg1: u8,
        arg2: &mut ZigString,
    );
    safe fn WebCore__FetchHeaders__fastHas_(arg0: &sys::FetchHeaders, arg1: u8) -> bool;
    safe fn WebCore__FetchHeaders__fastRemove_(arg0: &sys::FetchHeaders, arg1: u8);
    safe fn WebCore__FetchHeaders__get_(
        arg0: &sys::FetchHeaders,
        arg1: &ZigString,
        arg2: &mut ZigString,
        arg3: &JSGlobalObject,
    );
    safe fn WebCore__FetchHeaders__has(
        arg0: &sys::FetchHeaders,
        arg1: &ZigString,
        arg2: &JSGlobalObject,
    ) -> bool;
    safe fn WebCore__FetchHeaders__isEmpty(arg0: &sys::FetchHeaders) -> bool;
    safe fn WebCore__FetchHeaders__remove(
        arg0: &sys::FetchHeaders,
        arg1: &ZigString,
        arg2: &JSGlobalObject,
    );
    safe fn WebCore__FetchHeaders__toJS(arg0: &sys::FetchHeaders, arg1: &JSGlobalObject)
    -> JSValue;
    // NOT `safe fn`: C++ does `reinterpret_cast<uWS::HttpResponse<..>*>(arg2)` /
    // `reinterpret_cast<uWS::Http3Request*>(arg0)` and dereferences it.
    fn WebCore__FetchHeaders__toUWSResponse(
        arg0: &sys::FetchHeaders,
        kind: ResponseKind,
        arg2: *mut c_void,
    );
    fn WebCore__FetchHeaders__createFromH3(arg0: *mut c_void) -> *mut sys::FetchHeaders;

    safe fn WebCore__FetchHeaders__createFromJS(
        arg0: &JSGlobalObject,
        arg1: JSValue,
    ) -> *mut sys::FetchHeaders;

    safe fn WebCore__FetchHeaders__put(
        this: &sys::FetchHeaders,
        name: HTTPHeaderName,
        value: &BunString,
        global: &JSGlobalObject,
    );
}

#[repr(C)]
struct PicoHeaders {
    ptr: *const c_void,
    len: usize,
}

/// Constructors. C++ allocates; every one of these returns a `+1`.
impl FetchHeaders {
    pub fn create_empty() -> Self {
        // SAFETY: C++ `createEmpty` transfers a fresh `+1`, or returns null.
        unsafe { Self::adopt_ptr(WebCore__FetchHeaders__createEmpty()) }
            .expect("WebCore__FetchHeaders__createEmpty returned null")
    }

    /// # Safety
    /// `uws_request` must be a live `uWS::HttpRequest*`; C++ dereferences it.
    pub unsafe fn create_from_uws(uws_request: *mut c_void) -> Self {
        // SAFETY: caller contract; C++ `createFromUWS` transfers a fresh `+1`, or null.
        unsafe { Self::adopt_ptr(WebCore__FetchHeaders__createFromUWS(uws_request)) }
            .expect("WebCore__FetchHeaders__createFromUWS returned null")
    }

    /// # Safety
    /// `h3_request` must be a live `uWS::Http3Request*`; C++ dereferences it.
    pub unsafe fn create_from_h3(h3_request: *mut c_void) -> Self {
        // SAFETY: caller contract; C++ `createFromH3` transfers a fresh `+1`, or null.
        unsafe { Self::adopt_ptr(WebCore__FetchHeaders__createFromH3(h3_request)) }
            .expect("WebCore__FetchHeaders__createFromH3 returned null")
    }

    pub fn create_from_pico_headers<T>(pico_headers_list: &[T]) -> Self {
        let out = PicoHeaders {
            ptr: pico_headers_list.as_ptr().cast::<c_void>(),
            len: pico_headers_list.len(),
        };
        // SAFETY: `out` is a live `PicoHeaders`, layout-compatible with C++'s
        // `PicoHTTPHeaders`, and lives across the call; C++ copies synchronously.
        unsafe { Self::create_from_pico_headers_(std::ptr::from_ref(&out).cast::<c_void>()) }
    }

    /// # Safety
    /// `pico_headers` must point to a live `PicoHeaders`.
    unsafe fn create_from_pico_headers_(pico_headers: *const c_void) -> Self {
        // SAFETY: caller contract; C++ `createFromPicoHeaders_` transfers a fresh `+1`, or null.
        unsafe { Self::adopt_ptr(WebCore__FetchHeaders__createFromPicoHeaders_(pico_headers)) }
            .expect("WebCore__FetchHeaders__createFromPicoHeaders_ returned null")
    }

    /// Construct from a JSValue: `Array<[String, String]>` or
    /// `Record<String, String>`. Throws on invalid input; `None` if empty.
    pub fn create_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Self>> {
        host_fn::from_js_host_call_generic(global, || {
            // SAFETY: C++ `createFromJS` transfers a fresh `+1`, or returns null.
            unsafe { Self::adopt_ptr(WebCore__FetchHeaders__createFromJS(global, value)) }
        })
    }

    /// `names` and `values` must be parallel: C++ reads `names[i]`/`values[i]`
    /// for `i < names.len()`, resolving each against `buf`.
    pub fn create(
        global: &JSGlobalObject,
        names: &[StringPointer],
        values: &[StringPointer],
        buf: &ZigString,
    ) -> Option<Self> {
        assert_eq!(names.len(), values.len(), "parallel header columns");
        let count = u32::try_from(names.len()).expect("header count exceeds u32");
        // SAFETY: C++ reads exactly `count` entries from each column and does not
        // retain the pointers.
        let p = unsafe {
            WebCore__FetchHeaders__createValueNotJS(
                global,
                names.as_ptr(),
                values.as_ptr(),
                buf,
                count,
            )
        };
        // SAFETY: C++ `createValueNotJS` transfers a fresh `+1`, or returns null.
        unsafe { Self::adopt_ptr(p) }
    }

    /// Deep-copies on the C++ side, so the result is a fresh `+1`.
    pub fn clone_this(&self, global: &JSGlobalObject) -> JsResult<Option<Self>> {
        host_fn::from_js_host_call_generic(global, || {
            // SAFETY: C++ `cloneThis` deep-copies and transfers a fresh `+1`, or returns null.
            unsafe { Self::adopt_ptr(WebCore__FetchHeaders__cloneThis(self.raw(), global)) }
        })
    }

    /// Borrow the `FetchHeaders` inside a JS `Headers` wrapper.
    ///
    /// `WebCoreCast` takes **no ref** — the JS object owns it. Hence
    /// `ManuallyDrop`: dropping this would release a ref we never took.
    pub fn cast_(value: JSValue, vm: &VM) -> Option<ManuallyDrop<Self>> {
        NonNull::new(WebCore__FetchHeaders__cast_(value, vm))
            // SAFETY: wrapped in ManuallyDrop, so the borrowed ref is never released.
            .map(|p| ManuallyDrop::new(unsafe { Self::adopt(p) }))
    }

    pub fn cast(value: JSValue) -> Option<ManuallyDrop<Self>> {
        // SAFETY: `VirtualMachine::get()` is only called from the JS thread, where
        // `global` is a live non-null JSGlobalObject for the VM's lifetime.
        let global = VirtualMachine::get().global();
        Self::cast_(value, global.vm())
    }
}

/// Header access. `&self` throughout: C++ mutates through the same pointer.
impl FetchHeaders {
    pub fn is_empty(&self) -> bool {
        WebCore__FetchHeaders__isEmpty(self.raw())
    }

    pub fn append(&self, name: &ZigString, value: &ZigString, global: &JSGlobalObject) {
        WebCore__FetchHeaders__append(self.raw(), name, value, global)
    }

    /// `value`'s tag carries its encoding, and a `WTFStringImpl`-tagged value
    /// is ref'd by the C++ side instead of copied character-by-character.
    pub fn put(
        &self,
        name: HTTPHeaderName,
        value: &BunString,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || {
            WebCore__FetchHeaders__put(self.raw(), name, value, global)
        })
    }

    pub fn put_default(
        &self,
        name: HTTPHeaderName,
        value: &BunString,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        if self.fast_has(name) {
            return Ok(());
        }
        self.put(name, value, global)
    }

    fn get_(&self, name: &ZigString, out: &mut ZigString, global: &JSGlobalObject) {
        WebCore__FetchHeaders__get_(self.raw(), name, out, global)
    }

    pub fn get(&self, name: &[u8], global: &JSGlobalObject) -> Option<ZigString> {
        let mut out = ZigString::EMPTY;
        self.get_(&ZigString::init(name), &mut out, global);
        if out.len > 0 {
            // Returns the ZigString view (borrows C++-owned header
            // storage); caller may `.slice()` it. Returning `&[u8]` directly
            // would borrow the local `out`, not the underlying buffer.
            return Some(out);
        }
        None
    }

    pub fn has(&self, name: &ZigString, global: &JSGlobalObject) -> bool {
        WebCore__FetchHeaders__has(self.raw(), name, global)
    }

    pub fn remove(&self, name: &ZigString, global: &JSGlobalObject) {
        WebCore__FetchHeaders__remove(self.raw(), name, global)
    }

    pub fn fast_has(&self, name: HTTPHeaderName) -> bool {
        self.fast_has_(name as u8)
    }

    fn fast_has_(&self, name: u8) -> bool {
        WebCore__FetchHeaders__fastHas_(self.raw(), name)
    }

    pub fn fast_get(&self, name: HTTPHeaderName) -> Option<ZigString> {
        let mut out = ZigString::init(b"");
        self.fast_get_(name as u8, &mut out);
        if out.len == 0 {
            return None;
        }
        Some(out)
    }

    fn fast_get_(&self, name: u8, out: &mut ZigString) {
        WebCore__FetchHeaders__fastGet_(self.raw(), name, out)
    }

    pub fn fast_remove(&self, header: HTTPHeaderName) {
        self.fast_remove_(header as u8)
    }

    fn fast_remove_(&self, header: u8) {
        WebCore__FetchHeaders__fastRemove_(self.raw(), header)
    }

    /// `(header_count, buf_len)` — the sizes [`Self::copy_to`] expects.
    pub fn count(&self) -> (u32, u32) {
        let (mut header_count, mut buf_len) = (0u32, 0u32);
        WebCore__FetchHeaders__count(self.raw(), &mut header_count, &mut buf_len);
        (header_count, buf_len)
    }

    /// Writes one `StringPointer` per header into the parallel `names`/`values`
    /// columns and the name/value bytes into `buf`.
    ///
    /// All three must be sized from a prior [`Self::count`]: C++ writes
    /// `header_count` entries with no bounds check. `count` is not re-read here
    /// — it walks the C++ header iterator, and the caller already paid for it.
    pub fn copy_to(
        &self,
        names: &mut [StringPointer],
        values: &mut [StringPointer],
        buf: &mut [u8],
    ) {
        debug_assert_eq!(names.len(), values.len(), "parallel header columns");
        // SAFETY: caller sized all three from `count()`.
        unsafe {
            WebCore__FetchHeaders__copyTo(
                self.raw(),
                names.as_mut_ptr(),
                values.as_mut_ptr(),
                buf.as_mut_ptr(),
            )
        }
    }
}

/// Conversions to JS.
impl FetchHeaders {
    pub fn to_js(&self, global_this: &JSGlobalObject) -> JSValue {
        WebCore__FetchHeaders__toJS(self.raw(), global_this)
    }

    /// Shallow-copies into a new JS `Headers` object; does not clone `self`.
    pub fn clone(&self, global: &JSGlobalObject) -> JSValue {
        WebCore__FetchHeaders__clone(self.raw(), global)
    }

    /// # Safety
    /// `uws_response` must be a live `uWS::HttpResponse<SSL>*` / `uWS::Http3Response*`
    /// matching `kind`; C++ dereferences it.
    pub unsafe fn to_uws_response(&self, kind: ResponseKind, uws_response: *mut c_void) {
        // SAFETY: caller contract.
        unsafe { WebCore__FetchHeaders__toUWSResponse(self.raw(), kind, uws_response) }
    }
}

// Canonical enum lives in `bun_http_types::Method::HeaderName` (same 92
// `#[repr(u8)]` discriminants mirroring WebCore's `HTTPHeaderNames.in`). The
// `WebCore__FetchHeaders__put` extern decl above and the `fast_*` methods take
// it by value, so the re-export is ABI-transparent.
pub use bun_http_types::Method::HeaderName as HTTPHeaderName;

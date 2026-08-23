use core::ffi::c_void;
use core::ptr::NonNull;

use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JSValue, JsResult, VM, host_fn};
use bun_core::{EncodedSlice, String as BunString, StringPointer};
use bun_uws::ResponseKind;

bun_opaque::opaque_ffi! {
    /// Opaque C++ `WebCore::FetchHeaders` handle (ref-counted on the C++ side; see `deref`).
    pub struct FetchHeaders;
}

// `FetchHeaders`/`JSGlobalObject`/`VM` are opaque `UnsafeCell`-backed ZST
// handles, so `&T` is ABI-identical to a non-null `*const T` and C++ mutating
// header storage / VM state through them is interior mutation invisible to
// Rust. `EncodedSlice` and `String` (`BunString`) are plain `#[repr(C)]` structs;
// `&`/`&mut` refs to them at the FFI boundary are sound (C++ reads/writes
// only the named struct).
// Shims that traffic only in such refs + scalars are declared `safe fn`; those
// that take raw `*mut c_void` / unsized `*mut StringPointer` arrays / `deref`
// (which may free) keep their `unsafe fn` body.
unsafe extern "C" {
    safe fn WebCore__FetchHeaders__cast_(value0: JSValue, arg1: &VM) -> *mut FetchHeaders;
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
        arg3: *const EncodedSlice,
        arg4: u32,
    ) -> *mut FetchHeaders;
    fn WebCore__FetchHeaders__createValue(
        arg0: *const JSGlobalObject,
        arg1: *mut StringPointer,
        arg2: *mut StringPointer,
        arg3: *const EncodedSlice,
        arg4: u32,
    ) -> JSValue;
    // safe: `FetchHeaders` is an `opaque_ffi!` ZST handle; `&mut` is ABI-identical
    // to a non-null `*mut` and the C++ refcount decrement is interior to the cell.
    safe fn WebCore__FetchHeaders__deref(arg0: &mut FetchHeaders);
    safe fn WebCore__FetchHeaders__fastGet_(arg0: &FetchHeaders, arg1: u8, arg2: &mut EncodedSlice);
    safe fn WebCore__FetchHeaders__fastHas_(arg0: &FetchHeaders, arg1: u8) -> bool;
    safe fn WebCore__FetchHeaders__fastRemove_(arg0: &FetchHeaders, arg1: u8);
    safe fn WebCore__FetchHeaders__get_(
        arg0: &FetchHeaders,
        arg1: &EncodedSlice,
        arg2: &mut EncodedSlice,
        arg3: &JSGlobalObject,
    );
    safe fn WebCore__FetchHeaders__isEmpty(arg0: &FetchHeaders) -> bool;
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
        value: &BunString,
        global: &JSGlobalObject,
    );
}

#[repr(C)]
struct PicoHeaders {
    ptr: *const c_void,
    len: usize,
}

// The 4 forwarding wrappers below pass *mut StringPointer/*mut u8 straight to
// C++ without dereferencing; clippy::not_unsafe_ptr_arg_deref is a false
// positive on opaque-token forwarding through an unsafe extern call.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
impl FetchHeaders {
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
        host_fn::from_js_host_call_generic(global, || {
            NonNull::new(WebCore__FetchHeaders__createFromJS(global, value))
        })
    }

    pub fn put_default(
        &mut self,
        name_: HTTPHeaderName,
        value: &BunString,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        if self.fast_has(name_) {
            return Ok(());
        }

        self.put(name_, value, global)
    }

    /// `fill` validates every name/value pair and throws on an invalid one.
    pub fn create(
        global: &JSGlobalObject,
        names: *mut StringPointer,
        values: *mut StringPointer,
        buf: &EncodedSlice,
        count_: u32,
    ) -> JsResult<NonNull<FetchHeaders>> {
        // SAFETY: forwarding caller-provided buffers to C++; `global` is an opaque ZST handle
        // passed by address only.
        crate::call_null_is_throw(global, || unsafe {
            WebCore__FetchHeaders__createValueNotJS(global, names, values, buf, count_)
        })
    }

    /// Like [`create`](Self::create) but wrapped as a JS `Headers`. The C++
    /// side returns the wrapper even after `fill` threw, so the exception state
    /// is checked explicitly.
    pub fn from(
        global: &JSGlobalObject,
        names: *mut StringPointer,
        values: *mut StringPointer,
        buf: &EncodedSlice,
        count_: u32,
    ) -> JsResult<JSValue> {
        // SAFETY: forwarding caller-provided buffers to C++; `global` is an opaque ZST handle
        // passed by address only.
        crate::call_check_slow(global, || unsafe {
            WebCore__FetchHeaders__createValue(global, names, values, buf, count_)
        })
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

    /// `value`'s tag carries its encoding, and a `WTFStringImpl`-tagged value
    /// is ref'd by the C++ side instead of copied character-by-character.
    pub fn put(
        &mut self,
        name_: HTTPHeaderName,
        value: &BunString,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || {
            WebCore__FetchHeaders__put(self, name_, value, global)
        })
    }

    pub(crate) fn get_(
        &mut self,
        name_: &EncodedSlice,
        out: &mut EncodedSlice,
        global: &JSGlobalObject,
    ) {
        WebCore__FetchHeaders__get_(self, name_, out, global)
    }

    pub fn get(&mut self, name_: &[u8], global: &JSGlobalObject) -> Option<EncodedSlice<'_>> {
        let mut out = EncodedSlice::EMPTY;
        self.get_(&EncodedSlice::latin1(name_), &mut out, global);
        if !out.is_empty() {
            // Returns the EncodedSlice view (borrows C++-owned header
            // storage); caller may `.slice()` it. Returning `&[u8]` directly
            // would borrow the local `out`, not the underlying buffer.
            return Some(out);
        }

        None
    }

    pub fn fast_has(&mut self, name_: HTTPHeaderName) -> bool {
        self.fast_has_(name_ as u8)
    }

    pub fn fast_get(&mut self, name_: HTTPHeaderName) -> Option<EncodedSlice<'_>> {
        let mut str = EncodedSlice::EMPTY;
        self.fast_get_(name_ as u8, &mut str);
        if str.is_empty() {
            return None;
        }

        Some(str)
    }

    pub fn fast_has_(&mut self, name_: u8) -> bool {
        WebCore__FetchHeaders__fastHas_(self, name_)
    }

    pub(crate) fn fast_get_(&mut self, name_: u8, str: &mut EncodedSlice) {
        WebCore__FetchHeaders__fastGet_(self, name_, str)
    }

    pub fn fast_remove(&mut self, header: HTTPHeaderName) {
        self.fast_remove_(header as u8)
    }

    pub(crate) fn fast_remove_(&mut self, header: u8) {
        WebCore__FetchHeaders__fastRemove_(self, header)
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

    pub fn clone_this(
        &mut self,
        global: &JSGlobalObject,
    ) -> JsResult<Option<NonNull<FetchHeaders>>> {
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

/// RAII handle to a C++-owned `WebCore::FetchHeaders`.
///
/// Holds exactly one ref on the C++ intrusive refcount; `Drop` releases it via
/// `WebCore__FetchHeaders__deref`. NOT a `std::rc::Rc` (the payload lives on
/// the C++ heap and is opaque here).
///
/// Intentionally not `Clone`: the only "share" operation the surface
/// exposes is `clone_this()`, which deep-copies a fresh `FetchHeaders` on the
/// C++ side. Transferring ownership is by-move.
#[repr(transparent)]
pub struct HeadersRef(NonNull<FetchHeaders>);

impl HeadersRef {
    /// Adopt a freshly-created `FetchHeaders*` (refcount already 1).
    ///
    /// # Safety
    /// `ptr` must be a valid `WebCore::FetchHeaders*` and the caller must
    /// transfer ownership of one ref.
    #[inline]
    pub unsafe fn adopt(ptr: NonNull<FetchHeaders>) -> Self {
        Self(ptr)
    }

    #[inline]
    pub fn as_ptr(&self) -> *mut FetchHeaders {
        self.0.as_ptr()
    }

    /// `FetchHeaders.createEmpty()` — fresh C++ allocation, refcount 1.
    #[inline]
    pub fn create_empty() -> Self {
        Self(FetchHeaders::create_empty())
    }

    /// `FetchHeaders.createFromUWS(req)` — fresh C++ allocation, refcount 1.
    #[inline]
    pub fn create_from_uws(uws_request: *mut c_void) -> Self {
        Self(FetchHeaders::create_from_uws(uws_request))
    }

    /// `FetchHeaders.createFromH3(req)` — fresh C++ allocation, refcount 1.
    #[inline]
    pub fn create_from_h3(h3_request: *mut c_void) -> Self {
        Self(FetchHeaders::create_from_h3(h3_request))
    }

    /// `FetchHeaders.createFromJS(global, value)` — may throw, may return null.
    #[inline]
    pub fn create_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Self>> {
        Ok(FetchHeaders::create_from_js(global, value)?.map(Self))
    }

    /// `FetchHeaders.cloneThis(global)` — deep copy on the C++ side.
    #[inline]
    pub fn clone_this(&self, global: &JSGlobalObject) -> JsResult<Option<Self>> {
        bun_opaque::opaque_deref_mut(self.0.as_ptr()).clone_this_ref(global)
    }
}

impl FetchHeaders {
    /// [`clone_this`](Self::clone_this), owning the copy.
    #[inline]
    pub fn clone_this_ref(&mut self, global: &JSGlobalObject) -> JsResult<Option<HeadersRef>> {
        Ok(self.clone_this(global)?.map(HeadersRef))
    }
}

impl core::ops::Deref for HeadersRef {
    type Target = FetchHeaders;
    #[inline]
    fn deref(&self) -> &FetchHeaders {
        // `FetchHeaders` is an opaque ZST FFI handle (S008); `self.0` is live
        // for the lifetime of `self` — safe `*const → &` via `opaque_deref`.
        bun_opaque::opaque_deref(self.0.as_ptr())
    }
}

impl core::ops::DerefMut for HeadersRef {
    #[inline]
    fn deref_mut(&mut self) -> &mut FetchHeaders {
        // `FetchHeaders` is an opaque ZST FFI handle (S008); `self.0` is live
        // for the lifetime of `self` — safe `*mut → &mut` via `opaque_deref_mut`.
        bun_opaque::opaque_deref_mut(self.0.as_ptr())
    }
}

impl Drop for HeadersRef {
    #[inline]
    fn drop(&mut self) {
        // `self.0` is live; releasing our +1 ref via WebCore__FetchHeaders__deref.
        // Explicit UFCS to avoid `core::ops::Deref::deref` resolution ambiguity.
        // `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
        FetchHeaders::deref(bun_opaque::opaque_deref_mut(self.0.as_ptr()));
    }
}

// Canonical enum lives in `bun_http_types::Method::HeaderName` (same 92
// `#[repr(u8)]` discriminants mirroring WebCore's `HTTPHeaderNames.in`). The
// `WebCore__FetchHeaders__put` extern decl above and the `fast_*` methods take
// it by value, so the re-export is ABI-transparent.
pub use bun_http_types::Method::HeaderName as HTTPHeaderName;

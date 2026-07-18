use core::ffi::c_void;

use crate::api::bun_subprocess::Subprocess;
use crate::webcore::streams::{self, Signal};
use bun_core::collections::{TaggedPtrUnion, VecExt};
use bun_core::strings;
use crate::{JSGlobalObject, JSValue};
use bun_sys::{self as sys, Error as SysError};

// Re-export the real ArrayBufferSink so `crate::webcore::sink::ArrayBufferSink`
// resolves to the full type (with `bytes`/`signal`/`destroy`) for Body.rs.
pub use crate::webcore::array_buffer_sink::ArrayBufferSink;

crate::impl_js_sink_abi!(
    ArrayBufferSink,
    "ArrayBufferSink",
    streams::SignalKind::JsSinkArrayBufferSink
);

impl JSSink<ArrayBufferSink> {
    /// Unprotects the controller cell stashed in `signal.ptr`
    /// and tells C++ to drop its back-pointer. Called from
    /// `Body::ValueBufferer` Drop / reject paths.
    // Renamed from `detach` to avoid colliding with the generic
    // `JSSink<T: JsSinkAbi>::detach(signal, global)` associated fn — Rust
    // forbids same-name items across impl blocks for the same type even with
    // different signatures (E0592).
    pub fn detach_self(&mut self, global: &JSGlobalObject) {
        JSSink::<ArrayBufferSink>::detach(&mut self.sink.signal, global);
    }
}

pub use crate::webcore::file_sink::FileSink;

/// A `Sink` is an enum-dispatched writable stream sink.
pub struct Sink<'a> {
    // LIFETIMES.tsv: BORROW_PARAM — init_with_type stores the handler borrow;
    // no deinit, end() only dispatches
    pub ptr: &'a mut (),
    pub kind: SinkKind,
    pub status: Status,
    pub used: bool,
}

impl<'a> Sink<'a> {
    // `ptr` stays `&'a mut ()`: a reference to a
    // zero-sized type only needs a non-null, aligned address, so a dangling
    // pointer is a *valid* `&mut ()` (the same rule `Box<()>` relies on).
    pub fn pending() -> Sink<'static> {
        // SAFETY: `()` is zero-sized, so `NonNull::dangling()` (non-null,
        // aligned) is valid to reborrow as `&mut ()`; nothing is ever read or
        // written through it. status == Closed gates all dispatch so neither
        // `ptr` nor `kind` is used before being overwritten by init_with_type.
        // `SinkKind::Pending` traps on dispatch, turning any accidental use
        // into a loud, deterministic crash.
        unsafe {
            Sink {
                ptr: &mut *core::ptr::NonNull::<()>::dangling().as_ptr(),
                kind: SinkKind::Pending,
                status: Status::Closed,
                used: false,
            }
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ready,
    Closed,
}

pub enum Data {
    Utf16(streams::Result),
    Latin1(streams::Result),
    Bytes(streams::Result),
}

/// Trait capturing the duck-typed methods `SinkKind` dispatch expects on `Wrapped`.
pub trait SinkHandler {
    const KIND: SinkKind;
    fn write(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn end(&mut self, err: Option<SysError>) -> sys::Result<()>;
    fn connect(&mut self, signal: Signal) -> sys::Result<()>;
}

/// Generates the boilerplate `impl SinkHandler for $Ty` that forwards every
/// trait method to the same-named **inherent** method on `$Ty`.
///
/// `connect`: the inherent fn returns `()` (and may take `&self` *or* `&mut self`
/// — `&mut → &` coerces); the trait wants `bun_sys::Result<()>`, so the macro
/// wraps it in `Ok(())`.
///
/// Method resolution: `<$Ty>::name` prefers the inherent item over the trait
/// item being defined, so the forward never recurses.
#[macro_export]
macro_rules! impl_sink_handler {
    // `[...]` arm FIRST: a leading `[` would otherwise feed into the `:ty`
    // arm's fragment parser (which commits and hard-errors on e.g.
    // `[const SSL: bool, …]` instead of backtracking).
    ([$($g:tt)*] $Ty:ty = $kind:expr) => {
        $crate::impl_sink_handler!(@emit [$($g)*] $Ty = $kind);
    };
    ($Ty:ty = $kind:expr) => {
        $crate::impl_sink_handler!(@emit [] $Ty = $kind);
    };
    (@emit [$($g:tt)*] $Ty:ty = $kind:expr) => {
        impl<$($g)*> $crate::webcore::sink::SinkHandler for $Ty {
            const KIND: $crate::webcore::sink::SinkKind = $kind;
            #[inline]
            fn write(
                &mut self,
                data: &$crate::webcore::streams::Result,
            ) -> $crate::webcore::streams::result::Writable {
                <$Ty>::write(self, data)
            }
            #[inline]
            fn write_latin1(
                &mut self,
                data: &$crate::webcore::streams::Result,
            ) -> $crate::webcore::streams::result::Writable {
                <$Ty>::write_latin1(self, data)
            }
            #[inline]
            fn write_utf16(
                &mut self,
                data: &$crate::webcore::streams::Result,
            ) -> $crate::webcore::streams::result::Writable {
                <$Ty>::write_utf16(self, data)
            }
            #[inline]
            fn end(
                &mut self,
                err: ::core::option::Option<::bun_sys::Error>,
            ) -> ::bun_sys::Result<()> {
                <$Ty>::end(self, err)
            }
            #[inline]
            fn connect(
                &mut self,
                signal: $crate::webcore::streams::Signal,
            ) -> ::bun_sys::Result<()> {
                <$Ty>::connect(self, signal);
                ::bun_sys::Result::Ok(())
            }
        }
    };
}

pub fn init_with_type<T: SinkHandler>(handler: &mut T) -> Sink<'_> {
    Sink {
        // SAFETY: type-erased borrow; recovered as *mut T in SinkKind dispatch below.
        ptr: unsafe { &mut *std::ptr::from_mut::<T>(handler).cast::<()>() },
        kind: T::KIND,
        status: Status::Ready,
        used: false,
    }
}

pub fn init<T: SinkHandler>(handler: &mut T) -> Sink<'_> {
    init_with_type(handler)
}

impl<'a> Sink<'a> {
    /// Associated-fn alias of the free `init<T>` so callers can write
    /// `webcore::Sink::init(self)`.
    pub fn init<T: SinkHandler>(handler: &mut T) -> Sink<'_> {
        init_with_type(handler)
    }
}

pub struct UTF8Fallback;

// `Sink::UTF8Fallback` is referenced as `webcore::Sink::UTF8Fallback` by
// html_rewriter. Expose via inherent-impl associated
// type alias once inherent associated types are stable; for now consumers
// should reference `crate::webcore::sink::UTF8Fallback` directly.

impl UTF8Fallback {
    const STACK_SIZE: usize = 1024;

    pub fn write_latin1<Ctx>(
        ctx: &mut Ctx,
        input: &streams::Result,
        write_fn: fn(&mut Ctx, &streams::Result) -> streams::result::Writable,
    ) -> streams::result::Writable {
        let str_ = input.slice();
        if strings::is_all_ascii(str_) {
            return write_fn(ctx, input);
        }

        if Self::STACK_SIZE >= str_.len() {
            let mut buf = [0u8; Self::STACK_SIZE];
            buf[..str_.len()].copy_from_slice(str_);

            strings::replace_latin1_with_utf8(&mut buf[..str_.len()]);
            // Borrowed view is consumed by `write_fn` before `buf` drops.
            let borrowed = bun_core::ptr::RawSlice::new(&buf[..str_.len()]);
            if input.is_done() {
                let result = write_fn(ctx, &streams::Result::TemporaryAndDone(borrowed));
                return result;
            } else {
                let result = write_fn(ctx, &streams::Result::Temporary(borrowed));
                return result;
            }
        }

        {
            // Allocate fallibly so memory pressure surfaces as `.err = oom`
            // instead of aborting the process.
            let mut slice: Vec<u8> = Vec::new();
            if slice.try_reserve_exact(str_.len()).is_err() {
                return streams::result::Writable::Err(SysError::oom());
            }
            slice.extend_from_slice(str_);

            strings::replace_latin1_with_utf8(&mut slice[..]);
            if input.is_done() {
                write_fn(
                    ctx,
                    &streams::Result::OwnedAndDone(Vec::<u8>::from_owned_slice(
                        slice.into_boxed_slice(),
                    )),
                )
            } else {
                write_fn(
                    ctx,
                    &streams::Result::Owned(Vec::<u8>::from_owned_slice(slice.into_boxed_slice())),
                )
            }
        }
    }

    pub fn write_utf16<Ctx>(
        ctx: &mut Ctx,
        input: &streams::Result,
        write_fn: fn(&mut Ctx, &streams::Result) -> streams::result::Writable,
    ) -> streams::result::Writable {
        let bytes = input.slice();
        // input.slice() is guaranteed by caller to be u16-aligned UTF-16 bytes;
        // bytemuck checks alignment + even length at runtime.
        let str_: &[u16] = bytemuck::cast_slice(bytes);

        if Self::STACK_SIZE >= str_.len() * 2 {
            let mut buf = [0u8; Self::STACK_SIZE];
            let copied = strings::copy_utf16_into_utf8_impl::<true>(&mut buf, str_);
            debug_assert!(copied.written as usize <= Self::STACK_SIZE);
            debug_assert!(copied.read as usize <= Self::STACK_SIZE);
            // Borrowed view is consumed by `write_fn` before `buf` drops.
            let borrowed = bun_core::ptr::RawSlice::new(&buf[..copied.written as usize]);
            if input.is_done() {
                let result = write_fn(ctx, &streams::Result::TemporaryAndDone(borrowed));
                return result;
            } else {
                let result = write_fn(ctx, &streams::Result::Temporary(borrowed));
                return result;
            }
        }

        {
            // UTF-8 (and the WTF-8 lone-surrogate fallback) needs at most 3
            // bytes per UTF-16 code unit; reserving that fallibly up front
            // (plus the 16-byte slack `to_utf8_append_to_list` asks for) makes
            // the append below allocation-free, so memory pressure surfaces
            // as `.err = oom` instead of aborting the process.
            let Some(worst_case) = str_.len().checked_mul(3).and_then(|n| n.checked_add(16)) else {
                return streams::result::Writable::Err(SysError::oom());
            };
            let mut allocated: Vec<u8> = Vec::new();
            if allocated.try_reserve_exact(worst_case).is_err() {
                return streams::result::Writable::Err(SysError::oom());
            }
            strings::to_utf8_append_to_list(&mut allocated, str_);
            if input.is_done() {
                write_fn(
                    ctx,
                    &streams::Result::OwnedAndDone(Vec::<u8>::from_owned_slice(
                        allocated.into_boxed_slice(),
                    )),
                )
            } else {
                write_fn(
                    ctx,
                    &streams::Result::Owned(Vec::<u8>::from_owned_slice(
                        allocated.into_boxed_slice(),
                    )),
                )
            }
        }
    }
}

/// Closed-set tag of every concrete `SinkHandler` monomorphization. Replaces
/// the former hand-rolled fn-ptr `VTable`: dispatch is a `match` on this
/// discriminant that casts the erased `ptr` back to the matching type.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SinkKind {
    /// Sentinel for `Sink::pending()`. `status == Closed` gates all dispatch,
    /// so reaching this arm is a logic bug; it traps deterministically.
    Pending,
    FileSink,
    ArrayBufferSink,
    NetworkSink,
    HTTPResponseSink,
    HTTPSResponseSink,
    H3ResponseSink,
}

/// Dispatch helper: match on `$kind`, recover the concrete `&mut T` from the
/// erased `$ptr`, and invoke `SinkHandler::$method`.
macro_rules! sink_dispatch {
    ($kind:expr, $ptr:expr, $method:ident($($arg:expr),*)) => {{
        use crate::webcore::streams::{HTTPResponseSink, HTTPSResponseSink, H3ResponseSink, NetworkSink};
        let ptr: *mut () = $ptr;
        match $kind {
            SinkKind::Pending => {
                unreachable!("Sink dispatched while pending (status == Closed)")
            }
            // SAFETY: `ptr` was erased from `&mut <variant type>` in
            // `init_with_type`; `$kind` was set to `<variant type>::KIND` at
            // the same site, so the tag ↔ type pairing is invariant.
            SinkKind::FileSink => {
                SinkHandler::$method(unsafe { &mut *ptr.cast::<FileSink>() }, $($arg),*)
            }
            SinkKind::ArrayBufferSink => {
                SinkHandler::$method(unsafe { &mut *ptr.cast::<ArrayBufferSink>() }, $($arg),*)
            }
            SinkKind::NetworkSink => {
                SinkHandler::$method(unsafe { &mut *ptr.cast::<NetworkSink>() }, $($arg),*)
            }
            SinkKind::HTTPResponseSink => {
                SinkHandler::$method(unsafe { &mut *ptr.cast::<HTTPResponseSink>() }, $($arg),*)
            }
            SinkKind::HTTPSResponseSink => {
                SinkHandler::$method(unsafe { &mut *ptr.cast::<HTTPSResponseSink>() }, $($arg),*)
            }
            SinkKind::H3ResponseSink => {
                SinkHandler::$method(unsafe { &mut *ptr.cast::<H3ResponseSink>() }, $($arg),*)
            }
        }
    }};
}

impl SinkKind {
    #[inline]
    fn write(self, ptr: *mut (), data: &streams::Result) -> streams::result::Writable {
        sink_dispatch!(self, ptr, write(data))
    }
    #[inline]
    fn write_latin1(self, ptr: *mut (), data: &streams::Result) -> streams::result::Writable {
        sink_dispatch!(self, ptr, write_latin1(data))
    }
    #[inline]
    fn write_utf16(self, ptr: *mut (), data: &streams::Result) -> streams::result::Writable {
        sink_dispatch!(self, ptr, write_utf16(data))
    }
    #[inline]
    fn end(self, ptr: *mut (), err: Option<SysError>) -> sys::Result<()> {
        sink_dispatch!(self, ptr, end(err))
    }
    #[inline]
    #[allow(dead_code)]
    fn connect(self, ptr: *mut (), signal: Signal) -> sys::Result<()> {
        sink_dispatch!(self, ptr, connect(signal))
    }
}

impl<'a> Sink<'a> {
    pub fn end(&mut self, err: Option<SysError>) -> sys::Result<()> {
        if self.status == Status::Closed {
            return Ok(());
        }

        self.status = Status::Closed;
        self.kind.end(std::ptr::from_mut::<()>(self.ptr), err)
    }

    pub fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable {
        if self.status == Status::Closed {
            return streams::result::Writable::Done;
        }

        let res = self.kind.write_latin1(std::ptr::from_mut::<()>(self.ptr), data);
        self.status = if res.is_done() || self.status == Status::Closed {
            Status::Closed
        } else {
            Status::Ready
        };
        self.used = true;
        res
    }

    pub fn write_bytes(&mut self, data: &streams::Result) -> streams::result::Writable {
        if self.status == Status::Closed {
            return streams::result::Writable::Done;
        }

        let res = self.kind.write(std::ptr::from_mut::<()>(self.ptr), data);
        self.status = if res.is_done() || self.status == Status::Closed {
            Status::Closed
        } else {
            Status::Ready
        };
        self.used = true;
        res
    }

    pub fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable {
        if self.status == Status::Closed {
            return streams::result::Writable::Done;
        }

        let res = self.kind.write_utf16(std::ptr::from_mut::<()>(self.ptr), data);
        self.status = if res.is_done() || self.status == Status::Closed {
            Status::Closed
        } else {
            Status::Ready
        };
        self.used = true;
        res
    }

    pub fn write(&mut self, data: &Data) -> streams::result::Writable {
        match data {
            Data::Utf16(str_) => self.write_utf16(str_),
            Data::Latin1(str_) => self.write_latin1(str_),
            Data::Bytes(bytes) => self.write_bytes(bytes),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSSink
//
// Rust cannot pass a `&str` const-generic for symbol-name concatenation in
// `#[link_name]`, so the per-abi extern set is supplied via `JsSinkAbi`
// (populated by `impl_js_sink_abi!`) and the per-abi `#[no_mangle]` exports
// are emitted by `generate-jssink.ts → generated_jssink.rs`. The `@hasDecl` /
// `@hasField` checks become associated consts on `JsSinkType`.
// ──────────────────────────────────────────────────────────────────────────

/// Generic sink-to-JS wrapper: a plain generic over
/// `T: JsSinkType + JsSinkAbi` with host-fn bodies in the `impl` block below.
// `repr(transparent)`: the value is
// allocated as the JSSink wrapper but freed via `this.sink.destroy()` (the
// inner address). With `transparent` the inner and outer share Layout, so
// `heap::take` on the inner pointer (e.g. `HTTPServerWritable::destroy`)
// is sound for an allocation that was `heap::alloc`'d as `Box<JSSink<T>>`.
#[repr(transparent)]
pub struct JSSink<T> {
    pub sink: T,
}

// ─── Canonical JsSinkAbi codegen ────────────────────────────────────────────
// Const-generic `&'static str` cannot drive `#[link_name]`, so the abi name is
// taken as a macro literal and `concat!`-ed.
//
// `decl_js_sink_externs!` emits the 7-fn extern set into a named submodule;
// `impl_js_sink_abi!` wraps it in a 1:1-forwarding `JsSinkAbi` impl. The
// extern-only form is exposed separately so `HTTPServerWritable<SSL,HTTP3>`
// can declare three sets and keep its const-generic 3-way dispatch impl.

/// Declare the codegen-emitted `${abi}__{fromJS,createObject,setDestroyCallback,
/// assignToStream,onClose,onReady,detachPtr}` C externs into `pub mod $m`.
///
/// `safe fn`: `&JSGlobalObject` discharges the only deref'd-param precondition;
/// `*mut c_void` args are stored opaquely in the JS wrapper — module-private,
/// sole callers are the `JsSinkAbi` forwards which pass live pointers.
#[macro_export]
macro_rules! decl_js_sink_externs {
    ($abi:literal as $m:ident) => {
        #[allow(non_snake_case)]
        pub(crate) mod $m {
            use ::bun_jsc::{JSGlobalObject, JSValue};
            use ::core::ffi::c_void;
            unsafe extern "C" {
                #[link_name = concat!($abi, "__fromJS")]
                pub(crate) safe fn from_js(value: JSValue) -> usize;
                #[link_name = concat!($abi, "__createObject")]
                pub(crate) safe fn create_object(
                    g: &JSGlobalObject,
                    o: *mut c_void,
                    d: usize,
                ) -> JSValue;
                #[link_name = concat!($abi, "__setDestroyCallback")]
                pub(crate) safe fn set_destroy_callback(v: JSValue, cb: usize);
                #[link_name = concat!($abi, "__assignToStream")]
                pub(crate) safe fn assign_to_stream(
                    g: &JSGlobalObject,
                    s: JSValue,
                    p: *mut c_void,
                    jp: *mut *mut c_void,
                ) -> JSValue;
                #[link_name = concat!($abi, "__onClose")]
                pub(crate) safe fn on_close(p: JSValue, r: JSValue);
                #[link_name = concat!($abi, "__onReady")]
                pub(crate) safe fn on_ready(p: JSValue, a: JSValue, o: JSValue);
                #[link_name = concat!($abi, "__detachPtr")]
                pub(crate) safe fn detach_ptr(p: JSValue);
            }
        }
    };
}

/// Declare `${abi}__*` externs (via [`decl_js_sink_externs!`]) and emit a
/// 1:1-forwarding `impl JsSinkAbi for $Ty`. Wrapped in an anonymous `const` so
/// the extern submodule does not leak into the caller's namespace.
#[macro_export]
macro_rules! impl_js_sink_abi {
    ($Ty:ty, $abi:literal, $kind:expr) => {
        const _: () = {
            $crate::decl_js_sink_externs!($abi as __abi);
            impl $crate::webcore::sink::JsSinkAbi for $Ty {
                const SIGNAL_KIND: $crate::webcore::streams::SignalKind = $kind;
                fn from_js_extern(value: ::bun_jsc::JSValue) -> usize {
                    __abi::from_js(value)
                }
                fn create_object_extern(
                    global: &::bun_jsc::JSGlobalObject,
                    object: *mut ::core::ffi::c_void,
                    destructor: usize,
                ) -> ::bun_jsc::JSValue {
                    __abi::create_object(global, object, destructor)
                }
                fn set_destroy_callback_extern(value: ::bun_jsc::JSValue, callback: usize) {
                    __abi::set_destroy_callback(value, callback)
                }
                fn assign_to_stream_extern(
                    global: &::bun_jsc::JSGlobalObject,
                    stream: ::bun_jsc::JSValue,
                    ptr: *mut ::core::ffi::c_void,
                    jsvalue_ptr: *mut *mut ::core::ffi::c_void,
                ) -> ::bun_jsc::JSValue {
                    __abi::assign_to_stream(global, stream, ptr, jsvalue_ptr)
                }
                fn on_close_extern(ptr: ::bun_jsc::JSValue, reason: ::bun_jsc::JSValue) {
                    __abi::on_close(ptr, reason)
                }
                fn on_ready_extern(
                    ptr: ::bun_jsc::JSValue,
                    amount: ::bun_jsc::JSValue,
                    offset: ::bun_jsc::JSValue,
                ) {
                    __abi::on_ready(ptr, amount, offset)
                }
                fn detach_ptr_extern(ptr: ::bun_jsc::JSValue) {
                    __abi::detach_ptr(ptr)
                }
            }
        };
    };
}

/// Per-sink C ABI surface. `&str` const-generics can't drive `#[link_name]`,
/// so each `SinkType` provides the resolved `${abi}__*` externs here (normally
/// via `impl_js_sink_abi!`) for the generic `JSSink<T>` host-fn bodies to call.
pub trait JsSinkAbi {
    /// `SignalKind` discriminant stored by `SinkSignal::<Self>::init`.
    const SIGNAL_KIND: streams::SignalKind;
    /// `${abi_name}__fromJS` — encodes `*ThisSink` (or 0/1 sentinel) as `usize`.
    fn from_js_extern(value: crate::webcore::jsc::JSValue) -> usize;
    /// `${abi_name}__createObject`. Safe wrapper: takes `&JSGlobalObject` and
    /// performs the `as_ptr()` projection internally so the FFI call is the
    /// impl body's sole guarded operation.
    fn create_object_extern(
        global: &crate::webcore::jsc::JSGlobalObject,
        object: *mut c_void,
        destructor: usize,
    ) -> crate::webcore::jsc::JSValue;
    /// `${abi_name}__setDestroyCallback`.
    fn set_destroy_callback_extern(value: crate::webcore::jsc::JSValue, callback: usize);
    /// `${abi_name}__assignToStream`. Safe wrapper: takes `&JSGlobalObject` and
    /// performs the `as_ptr()` projection internally so the FFI call is the
    /// impl body's sole guarded operation.
    fn assign_to_stream_extern(
        global: &crate::webcore::jsc::JSGlobalObject,
        stream: crate::webcore::jsc::JSValue,
        ptr: *mut c_void,
        jsvalue_ptr: *mut *mut c_void,
    ) -> crate::webcore::jsc::JSValue;
    /// `${abi_name}__onClose`.
    fn on_close_extern(ptr: crate::webcore::jsc::JSValue, reason: crate::webcore::jsc::JSValue);
    /// `${abi_name}__onReady`.
    fn on_ready_extern(
        ptr: crate::webcore::jsc::JSValue,
        amount: crate::webcore::jsc::JSValue,
        offset: crate::webcore::jsc::JSValue,
    );
    /// `${abi_name}__detachPtr`.
    fn detach_ptr_extern(ptr: crate::webcore::jsc::JSValue);
}

/// `from_js_extern` encodes two distinct failure types using 0 and 1. Any other
/// value is `*ThisSink`.
pub mod from_js_result {
    /// The sink has been closed and the wrapped type is freed.
    pub const DETACHED: usize = 0;
    /// JS exception has not yet been thrown.
    pub const CAST_FAILED: usize = 1;
}

impl<T: JsSinkAbi> JSSink<T> {
    pub fn create_object(
        global: &crate::webcore::jsc::JSGlobalObject,
        object: &mut T,
        destructor: usize,
    ) -> crate::webcore::jsc::JSValue {
        T::create_object_extern(
            global,
            std::ptr::from_mut::<T>(object).cast::<c_void>(),
            destructor,
        )
    }

    pub fn set_destroy_callback(value: crate::webcore::jsc::JSValue, callback: usize) {
        T::set_destroy_callback_extern(value, callback)
    }

    /// `JSSink.fromJS(value)` — recover `*mut JSSink<T>` (= `*mut ThisSink`) from
    /// the JS wrapper, or `None` if detached / wrong type.
    pub fn from_js(value: crate::webcore::jsc::JSValue) -> Option<*mut JSSink<T>> {
        let raw = T::from_js_extern(value);
        match raw {
            from_js_result::DETACHED | from_js_result::CAST_FAILED => None,
            ptr => Some(ptr as *mut JSSink<T>),
        }
    }

    pub fn assign_to_stream(
        global: &crate::webcore::jsc::JSGlobalObject,
        stream: crate::webcore::jsc::JSValue,
        ptr: &mut T,
        jsvalue_ptr: *mut *mut c_void,
    ) -> crate::webcore::jsc::JSValue {
        T::assign_to_stream_extern(
            global,
            stream,
            std::ptr::from_mut::<T>(ptr).cast::<c_void>(),
            jsvalue_ptr,
        )
    }

    /// `JSSink.detach(globalThis)` — disconnect the C++ controller cell stashed
    /// in `signal.ptr` (a JSValue's encoded bits, see `SinkSignal::init`).
    pub fn detach(signal: &mut Signal, _global: &crate::webcore::jsc::JSGlobalObject) {
        use crate::webcore::jsc::JSValue;
        let Some(ptr) = signal.ptr else { return }; // is_dead()
        signal.clear();
        // SAFETY: `signal.ptr` was stored by `SinkSignal::<T>::init` as the
        // encoded JSValue bits (never a real Rust pointer); bitcast back.
        let value = JSValue::from_encoded(ptr.as_ptr() as usize);
        value.unprotect();
        // `${abi}__detachPtr` runs the JS `onClose` callback through the bare
        // `AsyncContextFrame::call` overload (no TopExceptionScope of its own)
        // and RELEASE_AND_RETURNs its ThrowScope, so `m_needExceptionCheck` is
        // left set when it returns into this scope-less thunk. Wrap in a
        // TopExceptionScope so the verifier is satisfied; discard the result.
        // TODO: properly propagate exception upwards.
        let _ = ::bun_jsc::call_check_slow(_global, || T::detach_ptr_extern(value));
    }
}

/// `JSSink.SinkSignal` — wraps a `JSValue` (the C++ sink controller cell) as
/// a `streams::Signal`. The pointer stored in `Signal.ptr` is the encoded
/// JSValue bits, never dereferenced; `SignalKind` dispatch bitcasts back and
/// calls the generated `${abi_name}__onClose` / `__onReady` externs.
// Inherent associated types are unstable, so this is a free generic;
// let each caller alias via `type SinkSignal = sink::SinkSignal<Self>;`.
#[repr(C)]
pub struct SinkSignal<T>(core::marker::PhantomData<T>);

impl<T: JsSinkAbi> SinkSignal<T> {
    pub fn init(cpp: crate::webcore::jsc::JSValue) -> Signal {
        // Bypass `Signal::init_with_type` (which would form a fake
        // `&mut SinkSignal<T>` ref); store the encoded `JSValue` bits directly
        // and tag with `T::SIGNAL_KIND` so `SignalKind::js_sink_{close,ready}`
        // bitcast back and call `${abi}__onClose/onReady`.
        Signal {
            // this one can be null
            ptr: core::ptr::NonNull::new(cpp.encoded() as *mut c_void),
            kind: T::SIGNAL_KIND,
        }
    }
}

/// Trait collecting every method `JSSink` may call on the wrapped `SinkType`.
/// Most of these are optional, modeled with default method bodies and
/// associated `const` gates.
pub trait JsSinkType: Sized {
    const NAME: &'static str;
    /// Mirrors `@hasDecl(SinkType, "construct")`.
    const HAS_CONSTRUCT: bool = false;
    /// Mirrors `@hasField(SinkType, "signal")`.
    const HAS_SIGNAL: bool = false;
    /// Mirrors `@hasField(SinkType, "done")`.
    const HAS_DONE: bool = false;
    /// Mirrors `@hasDecl(SinkType, "flushFromJS")`.
    const HAS_FLUSH_FROM_JS: bool = false;
    /// Mirrors `@hasDecl(SinkType, "protectJSWrapper")`.
    const HAS_PROTECT_JS_WRAPPER: bool = false;
    /// Mirrors `@hasDecl(SinkType, "updateRef")`.
    const HAS_UPDATE_REF: bool = false;
    /// Mirrors `@hasDecl(SinkType, "getFd")`.
    const HAS_GET_FD: bool = false;
    /// Mirrors `@hasField(streams.Start, abi_name)` — selects the
    /// `Start::from_js_with_tag` branch in `JSSink::js_start`.
    const START_TAG: Option<streams::StartTag> = None;

    fn memory_cost(&self) -> usize;
    fn finalize(&mut self);
    fn write_bytes(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn end(&mut self, err: Option<SysError>) -> sys::Result<()>;
    fn end_from_js(&mut self, global: &JSGlobalObject) -> sys::Result<JSValue>;
    fn flush(&mut self) -> sys::Result<()>;
    fn start(&mut self, config: streams::Start) -> sys::Result<()>;

    fn construct(_this: &mut core::mem::MaybeUninit<Self>) {
        // Only reached when `HAS_CONSTRUCT = false` callers misroute; the
        // real `js_construct` short-circuits before this.
        debug_assert!(!Self::HAS_CONSTRUCT, "JsSinkType::construct missing");
    }
    fn get_pending_error(&mut self) -> Option<JSValue> {
        None
    }
    fn signal(&mut self) -> Option<&mut Signal> {
        None
    }
    fn done(&self) -> bool {
        false
    }
    fn flush_from_js(&mut self, _global: &JSGlobalObject, _wait: bool) -> sys::Result<JSValue> {
        // Guarded by `HAS_FLUSH_FROM_JS`; default impl delegates to `flush()`
        // (returning undefined on success) so buffered bytes are
        // still flushed even if a caller bypasses `js_flush`.
        self.flush().map(|()| JSValue::UNDEFINED)
    }
    fn pending_state_is_pending(&self) -> bool {
        false
    }
    fn protect_js_wrapper(&mut self, _global: &JSGlobalObject, _this_value: JSValue) {}
    fn update_ref(&mut self, _value: bool) {}
    fn get_fd(&self) -> i32 {
        -1
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSSink<T> generic host-fn glue
//
// The codegen (`generate-jssink.ts`) emits `#[no_mangle] extern "C"` thunks
// for `${name}__{construct,write,end,flush,start,getInternalFd,memoryCost,
// finalize,close,endWithSink,updateRef}` that call these. Keeping the host-fn
// validation here (instead of on each `SinkType`) avoids the inherent-method
// name collision with the inner `write/end/flush/start`: the JSSink
// wrapper owns the JS-facing surface, the
// SinkType owns the streaming logic.
//
// This is the SOLE implementation. The earlier `macro_rules! js_sink`
// reference port has been deleted — it was never instantiated, half its bodies
// no longer type-checked against the current `bun_jsc` surface, and every fn
// it defined is superseded by this generic `impl` + `decl_js_sink_externs!` /
// `impl_js_sink_abi!`. `write_utf8` is intentionally NOT re-added: it has
// no lut entry and no C++ caller.
// ──────────────────────────────────────────────────────────────────────────

impl<T: JsSinkType + JsSinkAbi> JSSink<T> {
    /// `JSSink.getThis` — recover `&mut JSSink<T>` from `callframe.this()` or
    /// throw the appropriate detached/cast-failed error.
    ///
    /// Returns an unbounded `&'a mut`: the sink lives in the GC heap behind
    /// the JS wrapper cell (allocated in `js_construct`, freed by codegen
    /// `finalize`), so its lifetime is independent of `global`/`frame`. Host
    /// fns are single-threaded and synchronous — only one `&mut JSSink<T>` per
    /// `this` is live for the body of each host call.
    fn get_this<'a>(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<&'a mut JSSink<T>> {
        let raw = T::from_js_extern(frame.this());
        match raw {
            from_js_result::DETACHED => Err(global.throw(format_args!(
                "This {} has already been closed. A \"direct\" ReadableStream terminates its underlying socket once `async pull()` returns.",
                T::NAME,
            ))),
            from_js_result::CAST_FAILED => Err(bun_jsc::ErrorCode::INVALID_THIS
                .throw(global, format_args!("Expected {}", T::NAME))),
            // SAFETY: codegen returns a non-null `*mut JSSink<T>` for live
            // wrappers; see fn doc for the `'a` justification.
            ptr => Ok(unsafe { &mut *(ptr as *mut JSSink<T>) }),
        }
    }

    /// `${abi_name}__construct` host-fn body.
    pub fn js_construct(
        global: &crate::webcore::jsc::JSGlobalObject,
        _frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        bun_core::mark_binding!();

        if !T::HAS_CONSTRUCT {
            return Err(global.throw_illegal_constructor(T::NAME));
        }

        let mut this: Box<core::mem::MaybeUninit<T>> = Box::new(core::mem::MaybeUninit::uninit());
        T::construct(&mut *this);
        // SAFETY: JsSinkType::construct fully initializes `*this` (contract).
        let this: Box<T> = unsafe { this.assume_init() };
        let value = T::create_object_extern(global, bun_core::heap::into_raw(this).cast(), 0);
        Ok(value)
    }

    /// `${abi_name}__write` host-fn body.
    pub fn js_write(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        use crate::webcore::jsc::JSValue;
        bun_core::mark_binding!();
        // SAFETY: get_this returns a live ThisSink* on Ok.
        let this = Self::get_this(global, frame)?;

        if let Some(err) = this.sink.get_pending_error() {
            return Err(global.throw_value(err));
        }

        if frame.arguments_count() == 0 {
            return Err(global.throw_value(global.to_type_error(
                bun_jsc::ErrorCode::MISSING_ARGS,
                format_args!("write() expects a string, ArrayBufferView, or ArrayBuffer"),
            )));
        }

        let arg = frame.argument(0);
        arg.ensure_still_alive();
        let _keep = bun_jsc::EnsureStillAlive(arg);

        if arg.is_empty_or_undefined_or_null() {
            return Err(global.throw_value(global.to_type_error(
                bun_jsc::ErrorCode::STREAM_NULL_VALUES,
                format_args!("write() expects a string, ArrayBufferView, or ArrayBuffer"),
            )));
        }

        if let Some(buffer) = arg.as_array_buffer(global) {
            let slice = buffer.slice();
            if slice.is_empty() {
                return Ok(JSValue::js_number(0.0));
            }
            // Borrowed view over GC-kept buffer for the duration of the call.
            let data = bun_core::ptr::RawSlice::new(slice);
            return Ok(this
                .sink
                .write_bytes(&streams::Result::Temporary(data))
                .to_js(global));
        }

        if !arg.is_string() {
            return Err(global.throw_value(global.to_type_error(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("write() expects a string, ArrayBufferView, or ArrayBuffer"),
            )));
        }

        let str_ = arg.to_js_string(global)?;
        let view = str_.view(global);
        if view.is_empty() {
            return Ok(JSValue::js_number(0.0));
        }

        // Keep the JSString GC-live while we borrow its character buffer.
        let _keep_str = bun_jsc::EnsureStillAlive(str_.to_js());
        if view.is_16bit() {
            let utf16 = view.utf16_slice_aligned();
            let bytes: &[u8] = bytemuck::cast_slice(utf16);
            // Borrowed view over GC-kept JSString.
            let data = bun_core::ptr::RawSlice::new(bytes);
            return Ok(this
                .sink
                .write_utf16(&streams::Result::Temporary(data))
                .to_js(global));
        }

        // Borrowed view over GC-kept JSString (Latin-1 path).
        let data = bun_core::ptr::RawSlice::new(view.slice());
        Ok(this
            .sink
            .write_latin1(&streams::Result::Temporary(data))
            .to_js(global))
    }

    /// `${abi_name}__flush` host-fn body.
    pub fn js_flush(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        use crate::webcore::jsc::JSValue;
        use crate::sys_jsc::ErrorJsc;
        bun_core::mark_binding!();

        let this = Self::get_this(global, frame)?;

        if let Some(err) = this.sink.get_pending_error() {
            return Err(global.throw_value(err));
        }

        if T::HAS_FLUSH_FROM_JS {
            let wait = frame.arguments_count() > 0
                && frame.argument(0).is_boolean()
                && frame.argument(0).as_boolean();
            return match this.sink.flush_from_js(global, wait) {
                sys::Result::Ok(value) => Ok(value),
                sys::Result::Err(err) => Err(global.throw_value(err.to_js(global)?)),
            };
        }

        match this.sink.flush() {
            sys::Result::Ok(()) => Ok(JSValue::UNDEFINED),
            sys::Result::Err(err) => Err(global.throw_value(err.to_js(global)?)),
        }
    }

    /// `${abi_name}__start` host-fn body.
    pub fn js_start(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        use crate::webcore::jsc::JSValue;
        use crate::sys_jsc::ErrorJsc;
        bun_core::mark_binding!();

        // SAFETY: get_this returns a live ThisSink* on Ok.
        let this = Self::get_this(global, frame)?;

        if let Some(err) = this.sink.get_pending_error() {
            return Err(global.throw_value(err));
        }

        let config = if frame.arguments_count() > 0 {
            match T::START_TAG {
                Some(tag) => {
                    streams::Start::from_js_with_runtime_tag(global, frame.argument(0), tag)?
                }
                None => streams::Start::from_js(global, frame.argument(0))?,
            }
        } else {
            streams::Start::Empty
        };

        match this.sink.start(config) {
            sys::Result::Ok(()) => Ok(JSValue::UNDEFINED),
            sys::Result::Err(err) => Err(global.throw_value(err.to_js(global)?)),
        }
    }

    /// `${abi_name}__end` host-fn body.
    pub fn js_end(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        use crate::sys_jsc::ErrorJsc;
        bun_core::mark_binding!();

        // SAFETY: get_this returns a live ThisSink* on Ok.
        let this = Self::get_this(global, frame)?;

        if let Some(err) = this.sink.get_pending_error() {
            return Err(global.throw_value(err));
        }

        let result = match this.sink.end_from_js(global) {
            sys::Result::Ok(value) => Ok(value),
            sys::Result::Err(err) => Err(global.throw_value(err.to_js(global)?)),
        };

        // Protect the JS wrapper from GC while an async operation is pending.
        // The wrapper stays attached so `run_pending` can resolve the Promise;
        // `~JS${name}` → `finalize` releases the per-wrapper +1 once GC
        // sweeps.
        if T::HAS_PROTECT_JS_WRAPPER && this.sink.pending_state_is_pending() {
            this.sink.protect_js_wrapper(global, frame.this());
        }

        result
    }

    /// `${abi_name}__finalize` body.
    #[inline]
    pub fn js_finalize(this: &mut T) {
        this.finalize();
    }

    /// `${abi_name}__controllerDetached` body — called from
    /// `JSReadable*Controller::detach()` (controller `.end()`/`.close()` host
    /// fns) and from the controller's destructor, i.e. whenever the
    /// controller stops being attached to this sink.
    ///
    /// `signal.ptr` stores the controller's encoded JSValue bits (written by
    /// `__assignToStream`) without rooting the cell, so the controller can be
    /// collected while the native sink still has a flush in flight (e.g. a
    /// response stream parked on tryEnd() backpressure). Once the controller
    /// detaches or dies the signal must never fire again: `onClose`/`onReady`
    /// would decode a dead cell. Clear it, but only when it still holds this
    /// controller's bits — `connect()`-style signals store a live native
    /// pointer instead, and a sink re-assigned to a new stream holds the
    /// newer controller's bits.
    pub fn js_controller_detached(this: &mut T, controller: crate::webcore::jsc::JSValue) {
        if let Some(signal) = this.signal() {
            if signal.ptr.map(|p| p.as_ptr() as usize) == Some(controller.encoded()) {
                signal.clear();
            }
        }
    }

    /// `${abi_name}__close` body — called from
    /// `${controller}__close` and `${name}__doClose` in JSSink.cpp with a raw
    /// `m_sinkPtr` (not a host-fn callframe), so exceptions become `.zero`.
    pub fn js_close(
        global: &crate::webcore::jsc::JSGlobalObject,
        this: &mut T,
    ) -> crate::webcore::jsc::JSValue {
        use crate::webcore::jsc::JSValue;
        use crate::sys_jsc::ErrorJsc;
        bun_core::mark_binding!();

        if let Some(err) = this.get_pending_error() {
            // `throw_error` sets the pending JS exception and returns the
            // `JsError` for `?`-propagation; this host fn returns bare
            // `JSValue`, so report and return ZERO (caller checks exception).
            let _ = global.vm().throw_error(global, err);
            return JSValue::ZERO;
        }

        // TODO: properly propagate exception upwards
        match this.end(None) {
            sys::Result::Ok(()) => JSValue::UNDEFINED,
            sys::Result::Err(err) => match err.to_js(global) {
                Ok(v) => {
                    let _ = global.throw_value(v);
                    JSValue::ZERO
                }
                Err(_) => JSValue::ZERO,
            },
        }
    }

    /// `${abi_name}__endWithSink` body —
    /// called from `JSReadable${name}Controller__end` with a raw `m_sinkPtr`.
    pub fn js_end_with_sink(
        this: &mut T,
        global: &crate::webcore::jsc::JSGlobalObject,
    ) -> crate::webcore::jsc::JSValue {
        use crate::webcore::jsc::JSValue;
        use crate::sys_jsc::ErrorJsc;
        bun_core::mark_binding!();

        if let Some(err) = this.get_pending_error() {
            let _ = global.throw_value(err);
            return JSValue::ZERO;
        }

        // TODO: properly propagate exception upwards
        match this.end_from_js(global) {
            sys::Result::Ok(value) => value,
            sys::Result::Err(err) => match err.to_js(global) {
                Ok(v) => {
                    let _ = global.throw_value(v);
                    JSValue::ZERO
                }
                Err(_) => JSValue::ZERO,
            },
        }
    }

    /// `${abi_name}__updateRef` body.
    #[inline]
    pub fn js_update_ref(this: &mut T, value: bool) {
        bun_core::mark_binding!();
        if T::HAS_UPDATE_REF {
            this.update_ref(value);
        }
    }

    /// `${abi_name}__getInternalFd` body.
    #[inline]
    pub fn js_get_internal_fd(this: &mut T) -> crate::webcore::jsc::JSValue {
        use crate::webcore::jsc::JSValue;
        if T::HAS_GET_FD {
            return JSValue::js_number(this.get_fd() as f64);
        }
        JSValue::NULL
    }

    /// `${abi_name}__memoryCost` body.
    #[inline]
    pub fn js_memory_cost(this: &T) -> usize {
        core::mem::size_of::<JSSink<T>>() + this.memory_cost()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DestructorPtr / Bun__onSinkDestroyed
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// Used only as a `TaggedPointerUnion` type-tag.
    pub struct Detached;
}

// `bun_core::impl_tagged_ptr_union!` would impl the foreign
// `TypeList` trait for a tuple type, hitting orphan rules from this crate.
// Hand-roll a local marker struct + impls instead (matches the
// `AnyServerTypes` pattern in server_body.rs). The second variant
// (`Subprocess<'_>`) carries a lifetime so it cannot implement
// `UnionMember`; only `Detached` is a typed member, and the Subprocess arm
// in `Bun__onSinkDestroyed` casts the raw pointer manually.
pub struct DestructorTypes;
impl bun_core::ptr::tagged_pointer::TypeList for DestructorTypes {
    const LEN: usize = 2;
    const MIN_TAG: bun_core::ptr::tagged_pointer::TagType = 1024 - 1;
    fn type_name_from_tag(tag: bun_core::ptr::tagged_pointer::TagType) -> Option<&'static str> {
        match tag {
            1024 => Some("Detached"),
            1023 => Some("Subprocess"),
            _ => None,
        }
    }
}
impl bun_core::ptr::tagged_pointer::UnionMember<DestructorTypes> for Detached {
    const TAG: bun_core::ptr::tagged_pointer::TagType = 1024;
    const NAME: &'static str = "Detached";
}
pub type DestructorPtr = TaggedPtrUnion<DestructorTypes>;

/// Encode a `*Subprocess` as the second `DestructorPtr` tag (1023). Manual
/// re-encoding of `TaggedPtr::init(ptr, 1023)` because `Subprocess<'_>` carries
/// a lifetime and so cannot implement `UnionMember`, and `TaggedPtr`'s raw repr
/// is private. Consumed by `to_js_with_destructor` (which takes the encoded
/// `usize` directly) and round-tripped through C++ back to
/// `Bun__onSinkDestroyed`.
#[inline]
pub fn destructor_ptr_subprocess(ptr: *const c_void) -> usize {
    const ADDR_BITS: u32 = 49;
    const ADDR_MASK: u64 = (1u64 << ADDR_BITS) - 1;
    const SUBPROCESS_TAG: u64 = 1023; // second variant: 1024 - 1
    ((ptr as usize as u64 & ADDR_MASK) | (SUBPROCESS_TAG << ADDR_BITS)) as usize
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__onSinkDestroyed(ptr_value: *mut c_void, sink_ptr: *mut c_void) {
    let _ = sink_ptr; // autofix
    let ptr = DestructorPtr::from(Some(ptr_value));

    if ptr.is_null() {
        return;
    }

    // `is::<Detached>()` covers the typed member and the Subprocess arm is
    // matched by `is_valid()` below.
    if ptr.is::<Detached>() {
        return;
    }
    if ptr.is_valid() {
        // `Subprocess<'_>` cannot implement `UnionMember` (lifetime param), so
        // it isn't part of `DestructorPtr`'s type list — cast the raw pointer
        // directly (see `destructor_ptr_subprocess`, which encodes it).
        //
        // The decoded pointer must be
        // masked to the low 49 address bits. `DestructorPtr::ptr()` is
        // `TaggedPtr::to()` and *preserves* the tag bits (round-trip encoding),
        // so casting that would hand `on_stdin_destroyed` a pointer with
        // `0x07fe…` in the high word and ASAN SEGVs on the first field load.
        // Use the masked address.
        //
        // SAFETY: caller (C++) guarantees a valid non-Detached tag points at a live
        // Subprocess.
        let subprocess: &mut Subprocess<'_> =
            unsafe { &mut *(ptr.as_uintptr() as usize as *mut Subprocess<'_>) };
        subprocess.on_stdin_destroyed();
        return;
    }
    bun_core::debug_warn!("Unknown sink type");
}

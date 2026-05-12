use core::ffi::c_void;

use crate::api::bun_subprocess::Subprocess;
use crate::webcore::streams::{self, Signal};
use bun_collections::{ByteVecExt, TaggedPtrUnion, VecExt};
use bun_core::Output;
use bun_core::strings;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_sys::{self as sys, Error as SysError};

// PORT NOTE: re-export the real ArrayBufferSink so `crate::webcore::sink::ArrayBufferSink`
// resolves to the full type (with `bytes`/`signal`/`destroy`) for Body.rs.
pub use crate::webcore::array_buffer_sink::ArrayBufferSink;

crate::impl_js_sink_abi!(ArrayBufferSink, "ArrayBufferSink");

impl JSSink<ArrayBufferSink> {
    /// Port of Zig `JSSink.detach` (Sink.zig) for the `ArrayBufferSink`
    /// instantiation. Unprotects the controller cell stashed in `signal.ptr`
    /// and tells C++ to drop its back-pointer. Called from
    /// `Body::ValueBufferer` Drop / reject paths.
    // PORT NOTE: renamed from `detach` to avoid colliding with the generic
    // `JSSink<T: JsSinkAbi>::detach(signal, global)` associated fn — Rust
    // forbids same-name items across impl blocks for the same type even with
    // different signatures (E0592).
    pub fn detach_self(&mut self, global: &JSGlobalObject) {
        JSSink::<ArrayBufferSink>::detach(&mut self.sink.signal, global);
    }
}

// Re-export FileSink so gated `streams::Start` references to
// `crate::webcore::sink::{FileSink, FileSinkOptions, FileSinkInputPath}` resolve
// once those callers un-gate. The Options/InputPath types live on FileSink.
pub use crate::webcore::file_sink::FileSink;

/// A `Sink` is a hand-rolled vtable-based writable stream sink.
pub struct Sink<'a> {
    // LIFETIMES.tsv: BORROW_PARAM — Sink.zig:26-28 initWithType stores handler param;
    // no deinit, end() only dispatches
    pub ptr: &'a mut (),
    pub vtable: VTable,
    pub status: Status,
    pub used: bool,
}

impl<'a> Sink<'a> {
    // TODO(port): `pending` uses @ptrFromInt(0xaaaaaaaa) as a sentinel non-null pointer
    // and `vtable: undefined`. Cannot express as `&'a mut ()` safely; Phase B should
    // re-evaluate `ptr` field type (likely `NonNull<c_void>` for the vtable-erased
    // pattern) or provide `Sink::pending()` constructing with a dangling NonNull.
    pub fn pending() -> Sink<'static> {
        // SAFETY: sentinel address never dereferenced; status == Closed gates all dispatch
        // so neither `ptr` nor `vtable` is used before being overwritten by init_with_type.
        //
        // The Zig original used `vtable: undefined`. In Rust, both `zeroed()` and
        // `MaybeUninit::uninit().assume_init()` are immediate UB for a struct of
        // non-nullable `fn` pointers (niche-bearing). Instead we install a *valid*
        // sentinel vtable whose entries unconditionally panic — this keeps the value
        // well-formed at all times and turns any accidental dispatch (the bug Zig's
        // `undefined` would have hidden) into a loud, deterministic crash.
        unsafe {
            Sink {
                ptr: &mut *(0xaaaa_aaaa_usize as *mut ()),
                vtable: VTable::PENDING,
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

/// Trait capturing the duck-typed methods `VTable::wrap` expects on `Wrapped`.
/// Zig used `@hasDecl`/direct method calls; Rust expresses this as a trait bound.
pub trait SinkHandler {
    fn write(&mut self, data: streams::Result) -> streams::result::Writable;
    fn write_latin1(&mut self, data: streams::Result) -> streams::result::Writable;
    fn write_utf16(&mut self, data: streams::Result) -> streams::result::Writable;
    fn end(&mut self, err: Option<SysError>) -> sys::Result<()>;
    fn connect(&mut self, signal: Signal) -> sys::Result<()>;
}

/// Generates the boilerplate `impl SinkHandler for $Ty` that forwards every
/// trait method to the same-named **inherent** method on `$Ty`.
///
/// Mirrors Zig `Sink.VTable.wrap(comptime Wrapped)` (src/runtime/webcore/Sink.zig:105-146),
/// which builds the vtable by comptime duck-typing on `Wrapped.{write,writeLatin1,
/// writeUTF16,end,connect}` — no per-type forwarding shim exists in Zig. The
/// five hand-written Rust impls were pure port artifacts of needing nominal
/// trait impls; this macro restores the single-definition shape.
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
    ([$($g:tt)*] $Ty:ty) => {
        $crate::impl_sink_handler!(@emit [$($g)*] $Ty);
    };
    ($Ty:ty) => {
        $crate::impl_sink_handler!(@emit [] $Ty);
    };
    (@emit [$($g:tt)*] $Ty:ty) => {
        impl<$($g)*> $crate::webcore::sink::SinkHandler for $Ty {
            #[inline]
            fn write(
                &mut self,
                data: $crate::webcore::streams::Result,
            ) -> $crate::webcore::streams::result::Writable {
                <$Ty>::write(self, data)
            }
            #[inline]
            fn write_latin1(
                &mut self,
                data: $crate::webcore::streams::Result,
            ) -> $crate::webcore::streams::result::Writable {
                <$Ty>::write_latin1(self, data)
            }
            #[inline]
            fn write_utf16(
                &mut self,
                data: $crate::webcore::streams::Result,
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
        // SAFETY: type-erased borrow; recovered as *mut T in vtable thunks below.
        ptr: unsafe { &mut *std::ptr::from_mut::<T>(handler).cast::<()>() },
        vtable: VTable::wrap::<T>(),
        status: Status::Ready,
        used: false,
    }
}

pub fn init<T: SinkHandler>(handler: &mut T) -> Sink<'_> {
    // Zig: initWithType(std.meta.Child(@TypeOf(handler)), handler) — Rust generics
    // already name the pointee type, so this collapses to init_with_type.
    init_with_type(handler)
}

impl<'a> Sink<'a> {
    /// Associated-fn alias of the free `init<T>` so callers can write
    /// `webcore::Sink::init(self)` (matches the Zig `Sink.init(self)` shape).
    pub fn init<T: SinkHandler>(handler: &mut T) -> Sink<'_> {
        init_with_type(handler)
    }
}

pub struct UTF8Fallback;

// `Sink::UTF8Fallback` is referenced as `webcore::Sink::UTF8Fallback` by
// html_rewriter (Zig nested-type style). Expose via inherent-impl associated
// type alias once inherent associated types are stable; for now consumers
// should reference `crate::webcore::sink::UTF8Fallback` directly.
// TODO(port): inherent associated type — `impl Sink { pub type UTF8Fallback = UTF8Fallback; }`.

// TODO(b2-blocked): `bun_core::strings::{is_all_ascii, replace_latin1_with_utf8,
// copy_utf16_into_utf8_impl, to_utf8_alloc}` + `Vec::<u8>::from_*` constructors
// are not yet exported with these exact names. Body gated; signatures kept.

impl UTF8Fallback {
    const STACK_SIZE: usize = 1024;

    pub fn write_latin1<Ctx>(
        ctx: &mut Ctx,
        input: streams::Result,
        write_fn: fn(&mut Ctx, streams::Result) -> streams::result::Writable,
    ) -> streams::result::Writable {
        // PERF(port): `write_fn` was `comptime anytype` (monomorphized); now a fn pointer.
        let str_ = input.slice();
        if strings::is_all_ascii(str_) {
            return write_fn(ctx, input);
        }

        if Self::STACK_SIZE >= str_.len() {
            let mut buf = [0u8; Self::STACK_SIZE];
            buf[..str_.len()].copy_from_slice(str_);

            strings::replace_latin1_with_utf8(&mut buf[..str_.len()]);
            // Borrowed view is consumed by `write_fn` before `buf` drops.
            let borrowed = bun_ptr::RawSlice::new(&buf[..str_.len()]);
            if input.is_done() {
                let result = write_fn(ctx, streams::Result::TemporaryAndDone(borrowed));
                return result;
            } else {
                let result = write_fn(ctx, streams::Result::Temporary(borrowed));
                return result;
            }
        }

        {
            // Zig: bun.default_allocator.alloc(u8, str.len) catch return .{ .err = Syscall.Error.oom }
            // TODO(port): allocation-failure handling — Rust Vec aborts on OOM (no unwind);
            // Phase B should route through bun_alloc fallible alloc to preserve `.err = oom`.
            let mut slice = vec![0u8; str_.len()];
            slice[..str_.len()].copy_from_slice(str_);

            strings::replace_latin1_with_utf8(&mut slice[..str_.len()]);
            if input.is_done() {
                write_fn(
                    ctx,
                    streams::Result::OwnedAndDone(Vec::<u8>::from_owned_slice(
                        slice.into_boxed_slice(),
                    )),
                )
            } else {
                write_fn(
                    ctx,
                    streams::Result::Owned(Vec::<u8>::from_owned_slice(slice.into_boxed_slice())),
                )
            }
        }
    }

    pub fn write_utf16<Ctx>(
        ctx: &mut Ctx,
        input: streams::Result,
        write_fn: fn(&mut Ctx, streams::Result) -> streams::result::Writable,
    ) -> streams::result::Writable {
        // PERF(port): `write_fn` was `comptime anytype` (monomorphized); now a fn pointer.
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
            let borrowed = bun_ptr::RawSlice::new(&buf[..copied.written as usize]);
            if input.is_done() {
                let result = write_fn(ctx, streams::Result::TemporaryAndDone(borrowed));
                return result;
            } else {
                let result = write_fn(ctx, streams::Result::Temporary(borrowed));
                return result;
            }
        }

        {
            // TODO(port): allocation-failure handling — `bun_core::strings::to_utf8_alloc`
            // re-exports the bun_core variant which aborts on OOM (returns Vec<u8>, not
            // Result). Phase B should route through a fallible allocator to preserve
            // `.err = oom`.
            let allocated = strings::to_utf8_alloc(str_);
            if input.is_done() {
                write_fn(
                    ctx,
                    streams::Result::OwnedAndDone(Vec::<u8>::from_owned_slice(
                        allocated.into_boxed_slice(),
                    )),
                )
            } else {
                write_fn(
                    ctx,
                    streams::Result::Owned(Vec::<u8>::from_owned_slice(
                        allocated.into_boxed_slice(),
                    )),
                )
            }
        }
    }
}

pub type WriteUtf16Fn = fn(*mut (), streams::Result) -> streams::result::Writable;
pub type WriteUtf8Fn = fn(*mut (), streams::Result) -> streams::result::Writable;
pub type WriteLatin1Fn = fn(*mut (), streams::Result) -> streams::result::Writable;
pub type EndFn = fn(*mut (), Option<SysError>) -> sys::Result<()>;
pub type ConnectFn = fn(*mut (), Signal) -> sys::Result<()>;

#[derive(Clone, Copy)]
pub struct VTable {
    pub connect: ConnectFn,
    pub write: WriteUtf8Fn,
    pub write_latin1: WriteLatin1Fn,
    pub write_utf16: WriteUtf16Fn,
    pub end: EndFn,
}

impl VTable {
    /// Sentinel vtable used for `Sink::pending()` (Zig: `vtable: undefined`).
    ///
    /// VTable's fields are bare `fn(...)` pointers — a niche-bearing non-nullable type — so
    /// producing one via `MaybeUninit::uninit().assume_init()` or `mem::zeroed()` is
    /// library-documented immediate UB regardless of whether the value is later read.
    /// Instead we materialize a fully valid value whose every slot is a trap that panics on
    /// call. `status == Closed` gates all dispatch, so these are unreachable in correct code;
    /// if that invariant is ever violated we get a deterministic panic instead of a wild jump.
    pub const PENDING: VTable = {
        #[cold]
        fn trap_write(_: *mut (), _: streams::Result) -> streams::result::Writable {
            unreachable!("Sink vtable called while pending (status == Closed)")
        }
        #[cold]
        fn trap_end(_: *mut (), _: Option<SysError>) -> sys::Result<()> {
            unreachable!("Sink vtable called while pending (status == Closed)")
        }
        #[cold]
        fn trap_connect(_: *mut (), _: Signal) -> sys::Result<()> {
            unreachable!("Sink vtable called while pending (status == Closed)")
        }
        VTable {
            connect: trap_connect,
            write: trap_write,
            write_latin1: trap_write,
            write_utf16: trap_write,
            end: trap_end,
        }
    };

    pub fn wrap<Wrapped: SinkHandler>() -> VTable {
        fn on_write<W: SinkHandler>(
            this: *mut (),
            data: streams::Result,
        ) -> streams::result::Writable {
            // SAFETY: `this` was erased from `&mut W` in init_with_type.
            unsafe { &mut *this.cast::<W>() }.write(data)
        }
        fn on_connect<W: SinkHandler>(this: *mut (), signal: Signal) -> sys::Result<()> {
            // SAFETY: see on_write
            unsafe { &mut *this.cast::<W>() }.connect(signal)
        }
        fn on_write_latin1<W: SinkHandler>(
            this: *mut (),
            data: streams::Result,
        ) -> streams::result::Writable {
            // SAFETY: see on_write
            unsafe { &mut *this.cast::<W>() }.write_latin1(data)
        }
        fn on_write_utf16<W: SinkHandler>(
            this: *mut (),
            data: streams::Result,
        ) -> streams::result::Writable {
            // SAFETY: see on_write
            unsafe { &mut *this.cast::<W>() }.write_utf16(data)
        }
        fn on_end<W: SinkHandler>(this: *mut (), err: Option<SysError>) -> sys::Result<()> {
            // SAFETY: see on_write
            unsafe { &mut *this.cast::<W>() }.end(err)
        }

        VTable {
            write: on_write::<Wrapped>,
            write_latin1: on_write_latin1::<Wrapped>,
            write_utf16: on_write_utf16::<Wrapped>,
            end: on_end::<Wrapped>,
            connect: on_connect::<Wrapped>,
        }
    }
}

impl<'a> Sink<'a> {
    pub fn end(&mut self, err: Option<SysError>) -> sys::Result<()> {
        if self.status == Status::Closed {
            return Ok(());
        }

        self.status = Status::Closed;
        (self.vtable.end)(std::ptr::from_mut::<()>(self.ptr), err)
    }

    pub fn write_latin1(&mut self, data: streams::Result) -> streams::result::Writable {
        if self.status == Status::Closed {
            return streams::result::Writable::Done;
        }

        let res = (self.vtable.write_latin1)(std::ptr::from_mut::<()>(self.ptr), data);
        self.status = if res.is_done() || self.status == Status::Closed {
            Status::Closed
        } else {
            Status::Ready
        };
        self.used = true;
        res
    }

    pub fn write_bytes(&mut self, data: streams::Result) -> streams::result::Writable {
        if self.status == Status::Closed {
            return streams::result::Writable::Done;
        }

        let res = (self.vtable.write)(std::ptr::from_mut::<()>(self.ptr), data);
        self.status = if res.is_done() || self.status == Status::Closed {
            Status::Closed
        } else {
            Status::Ready
        };
        self.used = true;
        res
    }

    pub fn write_utf16(&mut self, data: streams::Result) -> streams::result::Writable {
        if self.status == Status::Closed {
            return streams::result::Writable::Done;
        }

        let res = (self.vtable.write_utf16)(std::ptr::from_mut::<()>(self.ptr), data);
        self.status = if res.is_done() || self.status == Status::Closed {
            Status::Closed
        } else {
            Status::Ready
        };
        self.used = true;
        res
    }

    pub fn write(&mut self, data: Data) -> streams::result::Writable {
        match data {
            Data::Utf16(str_) => self.write_utf16(str_),
            Data::Latin1(str_) => self.write_latin1(str_),
            Data::Bytes(bytes) => self.write_bytes(bytes),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSSink — Zig: `fn JSSink(comptime SinkType, comptime abi_name) type`
//
// Rust cannot pass a `&str` const-generic for symbol-name concatenation in
// `#[link_name]`, so the per-abi extern set is supplied via `JsSinkAbi`
// (populated by `impl_js_sink_abi!`) and the per-abi `#[no_mangle]` exports
// are emitted by `generate-jssink.ts → generated_jssink.rs`. The `@hasDecl` /
// `@hasField` checks become associated consts on `JsSinkType`.
// ──────────────────────────────────────────────────────────────────────────

/// `Sink.JSSink(SinkType, abi_name)` — generic sink-to-JS wrapper. In Zig this
/// is a comptime type-generator; here it is a plain generic over
/// `T: JsSinkType + JsSinkAbi` with host-fn bodies in the `impl` block below.
// `repr(transparent)`: the Zig `ThisSink = struct { sink: SinkType }` is
// allocated as the JSSink wrapper but freed via `this.sink.destroy()` (the
// inner address). With `transparent` the inner and outer share Layout, so
// `heap::take` on the inner pointer (e.g. `HTTPServerWritable::destroy`)
// is sound for an allocation that was `heap::alloc`'d as `Box<JSSink<T>>`.
#[repr(transparent)]
pub struct JSSink<T> {
    pub sink: T,
}

// ─── Canonical JsSinkAbi codegen ────────────────────────────────────────────
// Rust equivalent of Zig `Sink.JSSink(comptime SinkType, comptime abi_name)`'s
// `@extern(.{ .name = abi_name ++ "__fn" })` block (Sink.zig:253-344). Const-
// generic `&'static str` cannot drive `#[link_name]`, so the abi name is taken
// as a macro literal and `concat!`-ed — exactly mirroring `abi_name ++ "__…"`.
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
        pub mod $m {
            use ::bun_jsc::{JSGlobalObject, JSValue};
            use ::core::ffi::c_void;
            unsafe extern "C" {
                #[link_name = concat!($abi, "__fromJS")]
                pub safe fn from_js(value: JSValue) -> usize;
                #[link_name = concat!($abi, "__createObject")]
                pub safe fn create_object(g: &JSGlobalObject, o: *mut c_void, d: usize) -> JSValue;
                #[link_name = concat!($abi, "__setDestroyCallback")]
                pub safe fn set_destroy_callback(v: JSValue, cb: usize);
                #[link_name = concat!($abi, "__assignToStream")]
                pub safe fn assign_to_stream(
                    g: &JSGlobalObject,
                    s: JSValue,
                    p: *mut c_void,
                    jp: *mut *mut c_void,
                ) -> JSValue;
                #[link_name = concat!($abi, "__onClose")]
                pub safe fn on_close(p: JSValue, r: JSValue);
                #[link_name = concat!($abi, "__onReady")]
                pub safe fn on_ready(p: JSValue, a: JSValue, o: JSValue);
                #[link_name = concat!($abi, "__detachPtr")]
                pub safe fn detach_ptr(p: JSValue);
            }
        }
    };
}

/// Declare `${abi}__*` externs (via [`decl_js_sink_externs!`]) and emit a
/// 1:1-forwarding `impl JsSinkAbi for $Ty`. Wrapped in an anonymous `const` so
/// the extern submodule does not leak into the caller's namespace.
#[macro_export]
macro_rules! impl_js_sink_abi {
    ($Ty:ty, $abi:literal) => {
        const _: () = {
            $crate::decl_js_sink_externs!($abi as __abi);
            impl $crate::webcore::sink::JsSinkAbi for $Ty {
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
/// value is `*ThisSink`. (Zig non-exhaustive `enum(usize)` → matched-by-const.)
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
    /// in `signal.ptr` (a JSValue's encoded bits, see `SinkSignal::init`). Port
    /// of `Sink.JSSink.detach` (Sink.zig) for the `HAS_SIGNAL = true` path; the
    /// `@hasField(SinkType, "signal")` early-return is folded into the caller
    /// by passing the `Signal` directly.
    pub fn detach(signal: &mut Signal, _global: &crate::webcore::jsc::JSGlobalObject) {
        use crate::webcore::jsc::JSValue;
        let Some(ptr) = signal.ptr else { return }; // is_dead()
        signal.clear();
        // SAFETY: `signal.ptr` was stored by `SinkSignal::<T>::init` as the
        // encoded JSValue bits (never a real Rust pointer); bitcast back.
        let value = JSValue::from_encoded(ptr.as_ptr() as usize);
        value.unprotect();
        // Zig: `detachPtr(globalThis, value) catch {}` — `${abi}__detachPtr`
        // calls the JS `onClose` callback via the bare `JSC::call(...)`
        // overload (no NakedPtr/TopExceptionScope of its own), so
        // `executeCallImpl`'s ThrowScope is the outermost scope and its dtor
        // `simulateThrow()` leaves `m_needExceptionCheck` set. Wrap in a
        // TopExceptionScope (matching Zig's `fromJSHostCallGeneric`) so the
        // verifier is satisfied; discard the result like `catch {}`.
        // TODO: properly propagate exception upwards.
        let _ = ::bun_jsc::call_check_slow(_global, || T::detach_ptr_extern(value));
    }
}

/// `JSSink.SinkSignal` — wraps a `JSValue` (the C++ sink controller cell) as
/// a `streams::Signal`. The pointer stored in `Signal.ptr` is the encoded
/// JSValue bits, never dereferenced; vtable thunks bitcast back and call the
/// generated `${abi_name}__onClose` / `__onReady` externs.
// PORT NOTE: Zig nested-type `JSSink(SinkType, abi).SinkSignal` would be an
// inherent associated type in Rust (unstable). Expose as a free generic and
// let each caller alias via `type SinkSignal = sink::SinkSignal<Self>;`.
#[repr(C)]
pub struct SinkSignal<T>(core::marker::PhantomData<T>);

impl<T: JsSinkAbi> SinkSignal<T> {
    pub fn init(cpp: crate::webcore::jsc::JSValue) -> Signal {
        use crate::webcore::jsc::JSValue;
        // PORT NOTE: bypass `Signal::init_with_type` (which would form a fake
        // `&mut SinkSignal<T>` ref); build the vtable directly so `this` stays
        // a raw bit-pattern (`@setRuntimeSafety(false)` in Zig).
        fn close<T: JsSinkAbi>(this: *mut c_void, _err: Option<SysError>) {
            // `this` is the JSValue bits stashed by `init`; bitcast back.
            let cpp = JSValue::from_encoded(this as usize);
            // Zig (Sink.zig:265-268): `onClose` wraps the extern in
            // `fromJSHostCallGeneric` so the C++ ThrowScope's `simulateThrow()`
            // is satisfied; route through the same path here.
            // TODO: this should be got from a parameter / properly propagate exception upwards.
            let global = ::bun_jsc::virtual_machine::VirtualMachine::get().global();
            let _ =
                ::bun_jsc::call_check_slow(global, || T::on_close_extern(cpp, JSValue::UNDEFINED));
        }
        fn ready<T: JsSinkAbi>(
            this: *mut c_void,
            _a: Option<crate::webcore::BlobSizeType>,
            _o: Option<crate::webcore::BlobSizeType>,
        ) {
            let cpp = JSValue::from_encoded(this as usize);
            T::on_ready_extern(cpp, JSValue::UNDEFINED, JSValue::UNDEFINED);
        }
        fn start(_this: *mut c_void) {}
        Signal {
            // this one can be null
            ptr: core::ptr::NonNull::new(cpp.encoded() as *mut c_void),
            vtable: streams::SignalVTable {
                close: close::<T>,
                ready: ready::<T>,
                start,
            },
        }
    }
}

/// Trait collecting every method `JSSink` may call on the wrapped `SinkType`.
/// Zig used `@hasDecl(SinkType, "...")` to make most of these optional; Rust
/// models that with default method bodies. Associated `const`s replace
/// `@hasField` checks.
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
    fn write_bytes(&mut self, data: streams::Result) -> streams::result::Writable;
    fn write_utf16(&mut self, data: streams::Result) -> streams::result::Writable;
    fn write_latin1(&mut self, data: streams::Result) -> streams::result::Writable;
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
        // (returning undefined on success) so the non-override path matches
        // Zig's `!@hasDecl(SinkType, "flushFromJS")` arm — buffered bytes are
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
// JSSink<T> generic host-fn glue (port of Sink.zig `JSSink(SinkType, abi)`)
//
// The codegen (`generate-jssink.ts`) emits `#[no_mangle] extern "C"` thunks
// for `${name}__{construct,write,end,flush,start,getInternalFd,memoryCost,
// finalize,close,endWithSink,updateRef}` that call these. Keeping the host-fn
// validation here (instead of on each `SinkType`) avoids the inherent-method
// name collision with the inner `write/end/flush/start` and matches Zig's
// layering exactly: the JSSink wrapper owns the JS-facing surface, the
// SinkType owns the streaming logic.
//
// This is the SOLE implementation. The earlier Phase-B `macro_rules! js_sink`
// reference port has been deleted — it was never instantiated, half its bodies
// no longer type-checked against the current `bun_jsc` surface, and every fn
// it defined is superseded by this generic `impl` + `decl_js_sink_externs!` /
// `impl_js_sink_abi!`. `write_utf8` is intentionally NOT re-added: it is
// unexported in Zig, has no lut entry, and no C++ caller.
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
        use crate::webcore::jsc::JsError;
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

        // Zig: `bun.new(SinkType, undefined)` then `this.construct(allocator)`.
        let mut this: Box<core::mem::MaybeUninit<T>> = Box::new(core::mem::MaybeUninit::uninit());
        T::construct(&mut *this);
        // SAFETY: JsSinkType::construct fully initializes `*this` (contract).
        let this: Box<T> = unsafe { this.assume_init() };
        let value = T::create_object_extern(global, bun_core::heap::into_raw(this).cast(), 0);
        Ok(value)
    }

    /// `${abi_name}__write` host-fn body. Port of `Sink.zig::JSSink.write`.
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

        let args_list = frame.arguments_old::<4>();
        let args = args_list.slice();

        if args.is_empty() {
            return Err(global.throw_value(global.to_type_error(
                bun_jsc::ErrorCode::MISSING_ARGS,
                format_args!("write() expects a string, ArrayBufferView, or ArrayBuffer"),
            )));
        }

        let arg = args[0];
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
            let data = bun_ptr::RawSlice::new(slice);
            return Ok(this
                .sink
                .write_bytes(streams::Result::Temporary(data))
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
            let data = bun_ptr::RawSlice::new(bytes);
            return Ok(this
                .sink
                .write_utf16(streams::Result::Temporary(data))
                .to_js(global));
        }

        // Borrowed view over GC-kept JSString (Latin-1 path).
        let data = bun_ptr::RawSlice::new(view.slice());
        Ok(this
            .sink
            .write_latin1(streams::Result::Temporary(data))
            .to_js(global))
    }

    /// `${abi_name}__flush` host-fn body. Port of `Sink.zig::JSSink.flush`.
    pub fn js_flush(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        use crate::webcore::jsc::JSValue;
        use bun_sys_jsc::ErrorJsc;
        bun_core::mark_binding!();

        let this = Self::get_this(global, frame)?;

        if let Some(err) = this.sink.get_pending_error() {
            return Err(global.throw_value(err));
        }

        // PORT NOTE: Zig's `defer { if (done) unprotect() }` — `unprotect` is a
        // no-op in the current port, so the guard is folded out.

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

    /// `${abi_name}__start` host-fn body. Port of `Sink.zig::JSSink.start`.
    pub fn js_start(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        use crate::webcore::jsc::JSValue;
        use bun_sys_jsc::ErrorJsc;
        bun_core::mark_binding!();

        // SAFETY: get_this returns a live ThisSink* on Ok.
        let this = Self::get_this(global, frame)?;

        if let Some(err) = this.sink.get_pending_error() {
            return Err(global.throw_value(err));
        }

        // Zig: `if (@hasField(streams.Start, abi_name)) Start.fromJSWithTag(...) else Start.fromJS(...)`
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

    /// `${abi_name}__end` host-fn body. Port of `Sink.zig::JSSink.end`.
    pub fn js_end(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        use bun_sys_jsc::ErrorJsc;
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
        //
        // 13f9cff9 added an eager `detach_ptr_extern + finalize()` in the
        // non-pending else-branch as a #53265 defense. That diverges from Zig
        // (`JSSink.end` host-fn never detaches; only `${name}__doClose` does)
        // and breaks Node `.end()` idempotency: child_process stdin teardown
        // calls `.end()` → eager-detach → subsequent `.ref()`/`.unref()`/
        // `.end()` from the Writable destroy path hit `get_this` → DETACHED →
        // "already been closed" (8+ [new] in #53781). Reverted; the #53265
        // root cause is the missing per-wrapper `ref_()` (df4f2c44) +
        // `Blob::get_writer` leaking init's +1 (now fixed at Blob.rs:1894/
        // 1959), not the lack of eager detach.
        if T::HAS_PROTECT_JS_WRAPPER && this.sink.pending_state_is_pending() {
            this.sink.protect_js_wrapper(global, frame.this());
        }

        result
    }

    /// `${abi_name}__finalize` body. Port of `Sink.zig::JSSink.finalize`.
    #[inline]
    pub fn js_finalize(this: &mut T) {
        this.finalize();
    }

    /// `${abi_name}__close` body. Port of `Sink.zig::JSSink.close` — called from
    /// `${controller}__close` and `${name}__doClose` in JSSink.cpp with a raw
    /// `m_sinkPtr` (not a host-fn callframe), so exceptions become `.zero`.
    pub fn js_close(
        global: &crate::webcore::jsc::JSGlobalObject,
        this: &mut T,
    ) -> crate::webcore::jsc::JSValue {
        use crate::webcore::jsc::JSValue;
        use bun_sys_jsc::ErrorJsc;
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

    /// `${abi_name}__endWithSink` body. Port of `Sink.zig::JSSink.endWithSink` —
    /// called from `JSReadable${name}Controller__end` with a raw `m_sinkPtr`.
    pub fn js_end_with_sink(
        this: &mut T,
        global: &crate::webcore::jsc::JSGlobalObject,
    ) -> crate::webcore::jsc::JSValue {
        use crate::webcore::jsc::JSValue;
        use bun_sys_jsc::ErrorJsc;
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

    /// `${abi_name}__updateRef` body. Port of `Sink.zig::JSSink.updateRef`.
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
    /// Zig: `const Detached = opaque {};` used only as a TaggedPointerUnion type-tag.
    pub struct Detached;
}

// PORT NOTE: `bun_ptr::impl_tagged_ptr_union!` would impl the foreign
// `TypeList` trait for a tuple type, hitting orphan rules from this crate.
// Hand-roll a local marker struct + impls instead (matches the
// `AnyServerTypes` pattern in server_body.rs). The second variant
// (`Subprocess<'_>`) carries a lifetime so it cannot implement
// `UnionMember`; only `Detached` is a typed member, and the Subprocess arm
// in `Bun__onSinkDestroyed` casts the raw pointer manually.
pub struct DestructorTypes;
impl bun_ptr::tagged_pointer::TypeList for DestructorTypes {
    const LEN: usize = 2;
    const MIN_TAG: bun_ptr::tagged_pointer::TagType = 1024 - 1;
    fn type_name_from_tag(tag: bun_ptr::tagged_pointer::TagType) -> Option<&'static str> {
        match tag {
            1024 => Some("Detached"),
            1023 => Some("Subprocess"),
            _ => None,
        }
    }
}
impl bun_ptr::tagged_pointer::UnionMember<DestructorTypes> for Detached {
    const TAG: bun_ptr::tagged_pointer::TagType = 1024;
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

// TODO(b2-blocked): `Subprocess::on_stdin_destroyed` + `Output::debug_warn`.

#[unsafe(no_mangle)]
pub extern "C" fn Bun__onSinkDestroyed(ptr_value: *mut c_void, sink_ptr: *mut c_void) {
    let _ = sink_ptr; // autofix
    let ptr = DestructorPtr::from(Some(ptr_value));

    if ptr.is_null() {
        return;
    }

    // TODO(port): TaggedPtrUnion tag matching — Zig uses `@typeName(Detached)` /
    // `@typeName(Subprocess)` as tag values via `@field(DestructorPtr.Tag, ...)`.
    // bun_collections::TaggedPtrUnion should expose typed `as::<T>() -> Option<&mut T>`.
    if ptr.is::<Detached>() {
        return;
    }
    if ptr.is_valid() {
        // TODO(b2-blocked): `Subprocess<'_>` cannot implement `UnionMember` (lifetime
        // param), so it isn't part of `DestructorPtr`'s type list yet — cast the raw
        // pointer directly until the second variant is restored.
        //
        // Spec Sink.zig:641 `ptr.as(Subprocess)` → `TaggedPointer.get`, which
        // masks to the low 49 address bits. `DestructorPtr::ptr()` is
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
    Output::debug_warn("Unknown sink type");
}

// ported from: src/runtime/webcore/Sink.zig

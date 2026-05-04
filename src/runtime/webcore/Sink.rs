use core::ffi::c_void;
use core::mem::size_of;

use bun_collections::{ByteList, TaggedPtrUnion};
use bun_core::Output;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_runtime::api::Subprocess;
use bun_runtime::webcore::streams::{self, Signal};
use bun_runtime::webcore::Blob;
use bun_str::{self as bunstr, strings};
use bun_sys::{self as sys, Error as SysError};

pub use super::ArrayBufferSink;

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
        // SAFETY: sentinel address never dereferenced; vtable was `undefined` in Zig and is
        // never read before being overwritten (status == Closed gates all dispatch).
        // NOTE: `zeroed()` would be UB here — VTable fields are non-nullable fn pointers.
        unsafe {
            Sink {
                ptr: &mut *(0xaaaa_aaaa_usize as *mut ()),
                #[allow(invalid_value)]
                vtable: core::mem::MaybeUninit::uninit().assume_init(),
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

pub fn init_with_type<T: SinkHandler>(handler: &mut T) -> Sink<'_> {
    Sink {
        // SAFETY: type-erased borrow; recovered as *mut T in vtable thunks below.
        ptr: unsafe { &mut *(handler as *mut T as *mut ()) },
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

pub struct UTF8Fallback;

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
            if input.is_done() {
                let result = write_fn(
                    ctx,
                    streams::Result::TemporaryAndDone(ByteList::from_borrowed_slice_dangerous(
                        &buf[..str_.len()],
                    )),
                );
                return result;
            } else {
                let result = write_fn(
                    ctx,
                    streams::Result::Temporary(ByteList::from_borrowed_slice_dangerous(
                        &buf[..str_.len()],
                    )),
                );
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
                    streams::Result::OwnedAndDone(ByteList::from_owned_slice(slice)),
                )
            } else {
                write_fn(ctx, streams::Result::Owned(ByteList::from_owned_slice(slice)))
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
        // SAFETY: input.slice() is guaranteed by caller to be u16-aligned UTF-16 bytes.
        let str_: &[u16] = unsafe {
            core::slice::from_raw_parts(bytes.as_ptr().cast::<u16>(), bytes.len() / 2)
        };

        if Self::STACK_SIZE >= str_.len() * 2 {
            let mut buf = [0u8; Self::STACK_SIZE];
            let copied = strings::copy_utf16_into_utf8_impl(&mut buf, str_, true);
            debug_assert!(copied.written <= Self::STACK_SIZE);
            debug_assert!(copied.read <= Self::STACK_SIZE);
            if input.is_done() {
                let result = write_fn(
                    ctx,
                    streams::Result::TemporaryAndDone(ByteList::from_borrowed_slice_dangerous(
                        &buf[..copied.written],
                    )),
                );
                return result;
            } else {
                let result = write_fn(
                    ctx,
                    streams::Result::Temporary(ByteList::from_borrowed_slice_dangerous(
                        &buf[..copied.written],
                    )),
                );
                return result;
            }
        }

        {
            let allocated = match strings::to_utf8_alloc(str_) {
                Ok(v) => v,
                Err(_) => return streams::result::Writable::Err(SysError::oom()),
            };
            if input.is_done() {
                write_fn(
                    ctx,
                    streams::Result::OwnedAndDone(ByteList::from_owned_slice(allocated)),
                )
            } else {
                write_fn(
                    ctx,
                    streams::Result::Owned(ByteList::from_owned_slice(allocated)),
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
    pub fn wrap<Wrapped: SinkHandler>() -> VTable {
        fn on_write<W: SinkHandler>(this: *mut (), data: streams::Result) -> streams::result::Writable {
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
            return sys::Result::success();
        }

        self.status = Status::Closed;
        (self.vtable.end)(self.ptr as *mut (), err)
    }

    pub fn write_latin1(&mut self, data: streams::Result) -> streams::result::Writable {
        if self.status == Status::Closed {
            return streams::result::Writable::Done;
        }

        let res = (self.vtable.write_latin1)(self.ptr as *mut (), data);
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

        let res = (self.vtable.write)(self.ptr as *mut (), data);
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

        let res = (self.vtable.write_utf16)(self.ptr as *mut (), data);
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
// `#[link_name]` / `#[export_name]`. `JSSink` is therefore a macro that expands
// per (SinkType, abi_name) pair. The `@hasDecl` / `@hasField` checks become
// trait methods with default impls on `JsSinkType`.
// ──────────────────────────────────────────────────────────────────────────

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
    /// Mirrors `@hasField(streams.Start, abi_name)` — set per-instantiation in the macro.
    // (Handled in the macro body, not here.)

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
        unreachable!("construct() called but HAS_CONSTRUCT = false")
    }
    fn get_pending_error(&mut self) -> Option<JSValue> {
        None
    }
    fn signal(&mut self) -> &mut Signal {
        unreachable!("signal() called but HAS_SIGNAL = false")
    }
    fn done(&self) -> bool {
        false
    }
    fn flush_from_js(&mut self, _global: &JSGlobalObject, _wait: bool) -> sys::Result<JSValue> {
        unreachable!("flush_from_js() called but HAS_FLUSH_FROM_JS = false")
    }
    fn pending_state_is_pending(&self) -> bool {
        false
    }
    fn protect_js_wrapper(&mut self, _global: &JSGlobalObject, _this_value: JSValue) {}
    fn update_ref(&mut self, _value: bool) {}
    fn get_fd(&self) -> i32 {
        unreachable!("get_fd() called but HAS_GET_FD = false")
    }
}

#[macro_export]
macro_rules! js_sink {
    ($SinkType:ty, $abi_name:literal, $mod_name:ident) => {
        pub mod $mod_name {
            use super::*;
            use $crate::sink::JsSinkType;
            use ::core::ffi::c_void;
            use ::bun_jsc::{JSGlobalObject, JSValue, CallFrame, JsResult};
            use ::bun_runtime::webcore::{streams, Blob};
            use ::bun_sys::{self as sys, Error as SysError};
            use ::bun_collections::ByteList;

            #[repr(C)]
            pub struct ThisSink {
                pub sink: $SinkType,
            }

            // This attaches it to JS
            #[repr(C)]
            pub struct SinkSignal {
                pub cpp: JSValue,
            }

            impl SinkSignal {
                pub fn init(cpp: JSValue) -> streams::Signal {
                    // this one can be null
                    // SAFETY: @setRuntimeSafety(false) in Zig — the JSValue's bits are
                    // reinterpreted as a *SinkSignal pointer; never dereferenced as such,
                    // only round-tripped back to JSValue in close()/ready().
                    let raw = cpp.encoded() as usize;
                    unsafe { streams::Signal::init_with_type::<SinkSignal>(raw as *mut SinkSignal) }
                }

                pub fn close(this: *mut Self, _err: Option<SysError>) {
                    // SAFETY: `this` is the JSValue bits stashed by `init`; bitcast back.
                    let cpp = JSValue::from_encoded((this as usize) as i64);
                    on_close(cpp, JSValue::UNDEFINED);
                }

                pub fn ready(this: *mut Self, _amt: Option<Blob::SizeType>, _off: Option<Blob::SizeType>) {
                    // SAFETY: see close()
                    let cpp = JSValue::from_encoded((this as usize) as i64);
                    on_ready(cpp, JSValue::UNDEFINED, JSValue::UNDEFINED);
                }

                pub fn start(_this: *mut Self) {}
            }

            #[unsafe(no_mangle)]
            #[export_name = concat!($abi_name, "__memoryCost")]
            pub extern "C" fn memory_cost(this: *mut ThisSink) -> usize {
                // SAFETY: called from C++ with a valid ThisSink*.
                let this = unsafe { &*this };
                ::core::mem::size_of::<ThisSink>() + <$SinkType as JsSinkType>::memory_cost(&this.sink)
            }

            type AssignToStreamFn =
                unsafe extern "C" fn(*mut JSGlobalObject, JSValue, *mut c_void, *mut *mut c_void) -> JSValue;
            type OnCloseFn = unsafe extern "C" fn(JSValue, JSValue);
            type OnReadyFn = unsafe extern "C" fn(JSValue, JSValue, JSValue);
            type OnStartFn = unsafe extern "C" fn(JSValue, *mut JSGlobalObject);
            type CreateObjectFn =
                unsafe extern "C" fn(*mut JSGlobalObject, *mut c_void, usize) -> JSValue;
            type SetDestroyCallbackFn = unsafe extern "C" fn(JSValue, usize);
            type DetachPtrFn = unsafe extern "C" fn(JSValue);
            type FromJsFn = unsafe extern "C" fn(JSValue) -> usize;

            // TODO(port): move to <area>_sys
            unsafe extern "C" {
                #[link_name = concat!($abi_name, "__assignToStream")]
                fn assign_to_stream_extern(
                    global: *mut JSGlobalObject,
                    stream: JSValue,
                    ptr: *mut c_void,
                    jsvalue_ptr: *mut *mut c_void,
                ) -> JSValue;
                #[link_name = concat!($abi_name, "__onClose")]
                fn on_close_extern(ptr: JSValue, reason: JSValue);
                #[link_name = concat!($abi_name, "__onReady")]
                fn on_ready_extern(ptr: JSValue, amount: JSValue, offset: JSValue);
                #[link_name = concat!($abi_name, "__onStart")]
                fn on_start_extern(ptr: JSValue, global: *mut JSGlobalObject);
                #[link_name = concat!($abi_name, "__createObject")]
                fn create_object_extern(
                    global: *mut JSGlobalObject,
                    object: *mut c_void,
                    destructor: usize,
                ) -> JSValue;
                #[link_name = concat!($abi_name, "__setDestroyCallback")]
                fn set_destroy_callback_extern(value: JSValue, callback: usize);
                #[link_name = concat!($abi_name, "__detachPtr")]
                fn detach_ptr_extern(ptr: JSValue);
                #[link_name = concat!($abi_name, "__fromJS")]
                fn from_js_extern(value: JSValue) -> usize;
            }

            pub fn assign_to_stream(
                global: &JSGlobalObject,
                stream: JSValue,
                ptr: *mut c_void,
                jsvalue_ptr: *mut *mut c_void,
            ) -> JSValue {
                // SAFETY: FFI call into generated C++ sink glue.
                unsafe { assign_to_stream_extern(global as *const _ as *mut _, stream, ptr, jsvalue_ptr) }
            }

            pub fn on_close(ptr: JSValue, reason: JSValue) {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());
                // TODO: this should be got from a parameter
                let global = ::bun_jsc::VirtualMachine::get().global();
                // TODO: properly propagate exception upwards
                let _ = ::bun_jsc::from_js_host_call_generic(global, || {
                    // SAFETY: FFI call into generated C++ sink glue.
                    unsafe { on_close_extern(ptr, reason) }
                });
            }

            pub fn on_ready(ptr: JSValue, amount: JSValue, offset: JSValue) {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());
                // SAFETY: FFI call into generated C++ sink glue.
                unsafe { on_ready_extern(ptr, amount, offset) }
            }

            pub fn on_start(ptr: JSValue, global: &JSGlobalObject) {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());
                // SAFETY: FFI call into generated C++ sink glue.
                unsafe { on_start_extern(ptr, global as *const _ as *mut _) }
            }

            pub fn create_object(global: &JSGlobalObject, object: *mut c_void, destructor: usize) -> JSValue {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());
                // SAFETY: FFI call into generated C++ sink glue.
                unsafe { create_object_extern(global as *const _ as *mut _, object, destructor) }
            }

            pub fn set_destroy_callback(value: JSValue, callback: usize) {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());
                // SAFETY: FFI call into generated C++ sink glue.
                unsafe { set_destroy_callback_extern(value, callback) }
            }

            pub fn detach_ptr(global: &JSGlobalObject, ptr: JSValue) -> JsResult<()> {
                ::bun_jsc::from_js_host_call_generic(global, || {
                    // SAFETY: FFI call into generated C++ sink glue.
                    unsafe { detach_ptr_extern(ptr) }
                })
            }

            #[bun_jsc::host_fn]
            pub fn construct(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());

                if !<$SinkType as JsSinkType>::HAS_CONSTRUCT {
                    const MESSAGE: &str =
                        ::const_format::formatcp!("{} is not constructable", <$SinkType as JsSinkType>::NAME);
                    let err = ::bun_jsc::SystemError {
                        message: ::bun_str::String::static_(MESSAGE),
                        code: ::bun_str::String::static_("ERR_ILLEGAL_CONSTRUCTOR"),
                        ..Default::default()
                    };
                    return global.throw_value(err.to_error_instance(global));
                }

                // Zig: bun.new(SinkType, undefined) then this.construct(bun.default_allocator)
                // TODO(port): in-place init — `construct` in Zig is an out-param initializer
                // taking allocator; it must fully write `*this` before assume_init.
                let mut this: Box<::core::mem::MaybeUninit<$SinkType>> = Box::new_uninit();
                <$SinkType as JsSinkType>::construct(&mut *this);
                // SAFETY: JsSinkType::construct fully initializes `*this`.
                let this: Box<$SinkType> = unsafe { this.assume_init() };
                Ok(create_object(global, Box::into_raw(this).cast(), 0))
            }

            #[unsafe(no_mangle)]
            #[export_name = concat!($abi_name, "__finalize")]
            pub extern "C" fn finalize(ptr: *mut c_void) {
                // SAFETY: ptr is a ThisSink* allocated by us (create_object).
                let this = unsafe { &mut *ptr.cast::<ThisSink>() };
                this.sink.finalize();
            }

            pub fn detach(this: &mut ThisSink, global: &JSGlobalObject) {
                if !<$SinkType as JsSinkType>::HAS_SIGNAL {
                    return;
                }

                let signal = this.sink.signal();
                let ptr = signal.ptr();
                if signal.is_dead() {
                    return;
                }
                signal.clear();
                // SAFETY: ptr is the JSValue bits stashed by SinkSignal::init.
                let value = JSValue::from_encoded((ptr as usize) as i64);
                value.unprotect();
                // TODO: properly propagate exception upwards
                let _ = detach_ptr(global, value);
            }

            // The code generator encodes two distinct failure types using 0 and 1.
            // Zig's non-exhaustive `enum(usize)` with `_` arm has no direct Rust
            // equivalent (receiving an out-of-range discriminant into a Rust enum is UB),
            // so the FFI returns `usize` and we match on the named consts below.
            pub mod from_js_result {
                /// The sink has been closed and the wrapped type is freed.
                pub const DETACHED: usize = 0;
                /// JS exception has not yet been thrown
                pub const CAST_FAILED: usize = 1;
                // any other value => *ThisSink
            }

            pub fn from_js(value: JSValue) -> Option<*mut ThisSink> {
                // SAFETY: FFI call.
                let raw = unsafe { from_js_extern(value) };
                match raw {
                    from_js_result::DETACHED | from_js_result::CAST_FAILED => None,
                    ptr => Some(ptr as *mut ThisSink),
                }
            }

            fn get_this(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<*mut ThisSink> {
                // SAFETY: FFI call.
                let raw = unsafe { from_js_extern(frame.this()) };
                match raw {
                    from_js_result::DETACHED => global.throw(
                        concat!(
                            "This ",
                            $abi_name,
                            " has already been closed. A \"direct\" ReadableStream terminates its underlying socket once `async pull()` returns."
                        ),
                    ),
                    from_js_result::CAST_FAILED => global
                        .err(::bun_jsc::ErrorCode::INVALID_THIS, concat!("Expected ", $abi_name))
                        .throw(),
                    ptr => Ok(ptr as *mut ThisSink),
                }
            }

            pub fn unprotect(_this: &mut ThisSink) {}

            #[bun_jsc::host_fn]
            pub fn write(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());
                // SAFETY: get_this returns a live ThisSink* on Ok.
                let this = unsafe { &mut *get_this(global, frame)? };

                if let Some(err) = this.sink.get_pending_error() {
                    return global.throw_value(err);
                }

                let args_list = frame.arguments_old(4);
                let args = &args_list.ptr[..args_list.len];

                if args.is_empty() {
                    return global.throw_value(global.to_type_error(
                        ::bun_jsc::ErrorCode::MISSING_ARGS,
                        "write() expects a string, ArrayBufferView, or ArrayBuffer",
                    ));
                }

                let arg = args[0];
                arg.ensure_still_alive();
                let _keep = ::bun_jsc::EnsureStillAlive(arg);

                if arg.is_empty_or_undefined_or_null() {
                    return global.throw_value(global.to_type_error(
                        ::bun_jsc::ErrorCode::STREAM_NULL_VALUES,
                        "write() expects a string, ArrayBufferView, or ArrayBuffer",
                    ));
                }

                if let Some(buffer) = arg.as_array_buffer(global) {
                    let slice = buffer.slice();
                    if slice.is_empty() {
                        return Ok(JSValue::js_number(0));
                    }

                    return this
                        .sink
                        .write_bytes(streams::Result::Temporary(
                            ByteList::from_borrowed_slice_dangerous(slice),
                        ))
                        .to_js(global);
                }

                if !arg.is_string() {
                    return global.throw_value(global.to_type_error(
                        ::bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                        "write() expects a string, ArrayBufferView, or ArrayBuffer",
                    ));
                }

                let str_ = arg.to_js_string(global)?;

                let view = str_.view(global);

                if view.is_empty() {
                    return Ok(JSValue::js_number(0));
                }

                let _keep_str = ::bun_jsc::EnsureStillAlive(str_.as_value());
                if view.is_16bit() {
                    let utf16 = view.utf16_slice_aligned();
                    // SAFETY: reinterpreting &[u16] as &[u8] of double length.
                    let bytes = unsafe {
                        ::core::slice::from_raw_parts(utf16.as_ptr().cast::<u8>(), utf16.len() * 2)
                    };
                    return this
                        .sink
                        .write_utf16(streams::Result::Temporary(
                            ByteList::from_borrowed_slice_dangerous(bytes),
                        ))
                        .to_js(global);
                }

                this.sink
                    .write_latin1(streams::Result::Temporary(
                        ByteList::from_borrowed_slice_dangerous(view.slice()),
                    ))
                    .to_js(global)
            }

            #[bun_jsc::host_fn]
            pub fn write_utf8(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());

                // SAFETY: get_this returns a live ThisSink* on Ok.
                let this = unsafe { &mut *get_this(global, frame)? };

                if let Some(err) = this.sink.get_pending_error() {
                    return global.throw_value(err);
                }

                let args_list = frame.arguments_old(4);
                let args = &args_list.ptr[..args_list.len];
                if args.is_empty() || !args[0].is_string() {
                    let err = global.to_type_error(
                        if args.is_empty() {
                            ::bun_jsc::ErrorCode::MISSING_ARGS
                        } else {
                            ::bun_jsc::ErrorCode::INVALID_ARG_TYPE
                        },
                        "writeUTF8() expects a string",
                    );
                    return global.throw_value(err);
                }

                let arg = args[0];

                let str_ = arg.to_string(global);
                if global.has_exception() {
                    return Ok(JSValue::ZERO);
                }

                let view = str_.view(global);
                if view.is_empty() {
                    return Ok(JSValue::js_number(0));
                }

                let _keep_str = ::bun_jsc::EnsureStillAlive(str_.as_value());
                if str_.is_16bit() {
                    // TODO(port): Zig passed `view.utf16SliceAligned()` directly into
                    // `.temporary` (a ByteList) — relying on implicit slice coercion.
                    let utf16 = view.utf16_slice_aligned();
                    // SAFETY: reinterpreting &[u16] as &[u8] of double length.
                    let bytes = unsafe {
                        ::core::slice::from_raw_parts(utf16.as_ptr().cast::<u8>(), utf16.len() * 2)
                    };
                    return this
                        .sink
                        .write_utf16(streams::Result::Temporary(
                            ByteList::from_borrowed_slice_dangerous(bytes),
                        ))
                        .to_js(global);
                }

                this.sink
                    .write_latin1(streams::Result::Temporary(
                        ByteList::from_borrowed_slice_dangerous(view.slice()),
                    ))
                    .to_js(global)
            }

            #[unsafe(no_mangle)]
            #[export_name = concat!($abi_name, "__close")]
            pub extern "C" fn close(global: *mut JSGlobalObject, sink_ptr: *mut c_void) -> JSValue {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());
                let Some(sink_ptr) = ::core::ptr::NonNull::new(sink_ptr) else {
                    return JSValue::UNDEFINED;
                };
                // SAFETY: sink_ptr is a ThisSink* from C++.
                let this = unsafe { &mut *sink_ptr.as_ptr().cast::<ThisSink>() };
                // SAFETY: global is a valid JSGlobalObject*.
                let global = unsafe { &*global };

                if let Some(err) = this.sink.get_pending_error() {
                    return global.vm().throw_error(global, err).unwrap_or(JSValue::ZERO);
                }

                // TODO: properly propagate exception upwards
                this.sink.end(None).to_js(global).unwrap_or(JSValue::ZERO)
            }

            #[bun_jsc::host_fn]
            pub fn flush(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());

                // SAFETY: get_this returns a live ThisSink* on Ok.
                let this = unsafe { &mut *get_this(global, frame)? };

                if let Some(err) = this.sink.get_pending_error() {
                    return global.throw_value(err);
                }

                let _guard = ::scopeguard::guard((), |_| {
                    if <$SinkType as JsSinkType>::HAS_DONE && this.sink.done() {
                        unprotect(this);
                    }
                });
                // PORT NOTE: reshaped for borrowck — `defer` capturing `this` while body
                // also uses `this`; scopeguard closure may need raw-ptr capture in Phase B.
                // TODO(port): errdefer — overlapping &mut borrow of `this` in guard + body.

                if <$SinkType as JsSinkType>::HAS_FLUSH_FROM_JS {
                    let wait = frame.arguments_count() > 0
                        && frame.argument(0).is_boolean()
                        && frame.argument(0).as_boolean();
                    let maybe_value: sys::Result<JSValue> = this.sink.flush_from_js(global, wait);
                    return match maybe_value {
                        sys::Result::Ok(value) => Ok(value),
                        sys::Result::Err(err) => global.throw_value(err.to_js(global)?),
                    };
                }

                this.sink.flush().to_js(global)
            }

            #[bun_jsc::host_fn]
            pub fn start(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());

                // SAFETY: get_this returns a live ThisSink* on Ok.
                let this = unsafe { &mut *get_this(global, frame)? };

                if let Some(err) = this.sink.get_pending_error() {
                    return global.throw_value(err);
                }

                // TODO(port): `@hasField(streams.Start, abi_name)` + `@field(streams.Start, abi_name)`
                // selects a tagged variant of `streams::Start` by the literal abi_name. Rust
                // cannot reflect on enum variant names; Phase B should add an associated
                // const `START_TAG: Option<streams::StartTag>` on JsSinkType and dispatch
                // to `streams::Start::from_js_with_tag` when Some.
                let config = if frame.arguments_count() > 0 {
                    streams::Start::from_js(global, frame.argument(0))?
                } else {
                    streams::Start::Empty
                };
                this.sink.start(config).to_js(global)
            }

            #[bun_jsc::host_fn]
            pub fn end(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());

                // SAFETY: get_this returns a live ThisSink* on Ok.
                let this = unsafe { &mut *get_this(global, frame)? };

                if let Some(err) = this.sink.get_pending_error() {
                    return global.throw_value(err);
                }

                let result = this.sink.end_from_js(global).to_js(global);

                // Protect the JS wrapper from GC while an async operation is pending.
                // This prevents the JS wrapper from being collected before the Promise resolves.
                if <$SinkType as JsSinkType>::HAS_PROTECT_JS_WRAPPER {
                    if this.sink.pending_state_is_pending() {
                        this.sink.protect_js_wrapper(global, frame.this());
                    }
                }

                result
            }

            // TODO(port): callconv(jsc.conv) — #[bun_jsc::host_call] emits the right ABI.
            #[bun_jsc::host_call]
            #[export_name = concat!($abi_name, "__endWithSink")]
            pub extern fn end_with_sink(ptr: *mut c_void, global: *mut JSGlobalObject) -> JSValue {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());

                // SAFETY: ptr is a ThisSink*, global is valid.
                let this = unsafe { &mut *ptr.cast::<ThisSink>() };
                let global = unsafe { &*global };

                if let Some(err) = this.sink.get_pending_error() {
                    return match global.throw_value(err) {
                        Ok(v) => v,
                        Err(_) => JSValue::ZERO,
                    };
                }

                // TODO: properly propagate exception upwards
                this.sink.end_from_js(global).to_js(global).unwrap_or(JSValue::ZERO)
            }

            #[unsafe(no_mangle)]
            #[export_name = concat!($abi_name, "__updateRef")]
            pub extern "C" fn update_ref(ptr: *mut c_void, value: bool) {
                ::bun_jsc::mark_binding(::core::panic::Location::caller());
                // SAFETY: ptr is a ThisSink*.
                let this = unsafe { &mut *ptr.cast::<ThisSink>() };
                if <$SinkType as JsSinkType>::HAS_UPDATE_REF {
                    this.sink.update_ref(value);
                }
            }

            // Zig: `const jsWrite = jsc.toJSHostFn(@This().write);` etc.
            // In Rust the #[bun_jsc::host_fn] attribute on write/flush/start/end above
            // already emits the raw-ABI shim; the `@export` block below maps via
            // #[export_name] on those shims. Phase B: ensure the macro emits the shim
            // under the concatenated symbol name.
            // TODO(port): proc-macro — host_fn attribute must accept
            // `#[export_name = concat!($abi_name, "__write")]` for js_write/js_flush/js_start/js_end/js_construct.

            #[unsafe(no_mangle)]
            #[export_name = concat!($abi_name, "__getInternalFd")]
            extern "C" fn js_get_internal_fd(ptr: *mut c_void) -> JSValue {
                // SAFETY: ptr is a ThisSink*.
                let this = unsafe { &mut *ptr.cast::<ThisSink>() };
                if <$SinkType as JsSinkType>::HAS_GET_FD {
                    return JSValue::js_number(this.sink.get_fd());
                }
                JSValue::NULL
            }

            // Zig `comptime { @export(...) }` block is replaced by the
            // #[export_name = concat!($abi_name, "__...")] attributes above, gated by
            // bun.Environment.export_cpp_apis → handled by cfg in Phase B.
            // TODO(port): gate exports on cfg(feature = "export_cpp_apis").
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// DestructorPtr / Bun__onSinkDestroyed
// ──────────────────────────────────────────────────────────────────────────

/// Zig: `const Detached = opaque {};` used only as a TaggedPointerUnion type-tag.
#[repr(C)]
pub struct Detached {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

pub type DestructorPtr = TaggedPtrUnion<(Detached, Subprocess)>;

#[unsafe(no_mangle)]
pub extern "C" fn Bun__onSinkDestroyed(ptr_value: *mut c_void, sink_ptr: *mut c_void) {
    let _ = sink_ptr; // autofix
    let ptr = DestructorPtr::from(ptr_value);

    if ptr.is_null() {
        return;
    }

    // TODO(port): TaggedPtrUnion tag matching — Zig uses `@typeName(Detached)` /
    // `@typeName(Subprocess)` as tag values via `@field(DestructorPtr.Tag, ...)`.
    // bun_collections::TaggedPtrUnion should expose typed `as::<T>() -> Option<&mut T>`.
    if let Some(_detached) = ptr.as_ref::<Detached>() {
        return;
    }
    if let Some(subprocess) = ptr.as_mut::<Subprocess>() {
        subprocess.on_stdin_destroyed();
        return;
    }
    Output::debug_warn("Unknown sink type");
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/Sink.zig (663 lines)
//   confidence: medium
//   todos:      11
//   notes:      JSSink became macro_rules! (abi_name in link/export names); @hasDecl/@hasField → JsSinkType trait consts; start() @field(streams.Start, abi_name) reflection deferred; Sink.ptr kept as &'a mut () per LIFETIMES.tsv but pending() sentinel suggests NonNull<c_void> in Phase B; FromJsResult non-exhaustive enum → usize+consts (Rust enum would be UB on ptr values).
// ──────────────────────────────────────────────────────────────────────────

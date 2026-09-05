use core::ffi::c_void;
use core::ptr::NonNull;

use crate::api::bun_subprocess::Subprocess;
use crate::webcore::streams::{self, SourceHandle};
use bun_collections::TaggedPtrUnion;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_sys::{self as sys, Error as SysError};

// Re-export the real ArrayBufferSink so `crate::webcore::sink::ArrayBufferSink`
// resolves to the full type (with `bytes`/`source`/`destroy`) for Body.rs.
pub use crate::webcore::array_buffer_sink::ArrayBufferSink;

crate::impl_js_sink_abi!(ArrayBufferSink, "ArrayBufferSink");

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
// `decl_js_sink_externs!` emits the codegen `${abi}__*` externs into a named
// submodule; `impl_js_sink_abi!` wraps them in a 1:1-forwarding `JsSinkAbi`
// impl. The extern-only form is exposed separately so
// `HTTPServerWritable<SSL,HTTP3>` can declare three sets and keep its
// const-generic 3-way dispatch impl.

/// Declare the codegen-emitted `${abi}__*` C externs into `pub(crate) mod $m`.
///
/// `safe fn`: `&JSGlobalObject` discharges the only deref'd-param precondition;
/// `*mut c_void` args are stored opaquely in the JS wrapper — module-private,
/// sole callers are the `JsSinkAbi` forwards which pass live pointers.
#[macro_export]
macro_rules! decl_js_sink_externs {
    ($abi:literal as $m:ident) => {
        #[allow(non_snake_case)]
        pub(crate) mod $m {
            unsafe extern "C" {
                #[link_name = concat!($abi, "__fromJS")]
                pub(crate) safe fn from_js(value: ::bun_jsc::JSValue) -> usize;
                #[link_name = concat!($abi, "__createObject")]
                pub(crate) safe fn create_object(
                    g: &::bun_jsc::JSGlobalObject,
                    o: *mut ::core::ffi::c_void,
                    d: usize,
                ) -> ::bun_jsc::JSValue;
                #[link_name = concat!($abi, "__setDestroyCallback")]
                pub(crate) safe fn set_destroy_callback(v: ::bun_jsc::JSValue, cb: usize);
                #[link_name = concat!($abi, "__createController")]
                pub(crate) safe fn create_controller(
                    g: &::bun_jsc::JSGlobalObject,
                    p: *mut ::core::ffi::c_void,
                ) -> ::bun_jsc::JSValue;
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
                fn create_controller_extern(
                    global: &::bun_jsc::JSGlobalObject,
                    ptr: *mut ::core::ffi::c_void,
                ) -> ::bun_jsc::JSValue {
                    __abi::create_controller(global, ptr)
                }
            }
        };
    };
}

/// Emits the `JsSinkType` items that every sink forwards 1:1 to an inherent
/// method of the same name (`memory_cost`, `write_bytes` -> `write`,
/// `write_utf16`, `write_latin1`, `end`, `flush`, `flush_from_js`, `start`).
/// Invoke inside the `impl JsSinkType for T` block; `Self::name` resolves to
/// the inherent method ahead of the trait item being defined, so the forward
/// does not recurse. Items whose bodies differ per sink (`finalize`,
/// `construct`, `end_from_js`, `source`, the `HAS_*` consts) stay
/// hand-written.
#[macro_export]
macro_rules! impl_js_sink_forwarders {
    () => {
        fn memory_cost(&self) -> usize {
            Self::memory_cost(self)
        }
        fn write_bytes(
            &mut self,
            data: &$crate::webcore::streams::Result,
        ) -> $crate::webcore::streams::result::Writable {
            Self::write(self, data)
        }
        fn write_utf16(
            &mut self,
            data: &$crate::webcore::streams::Result,
        ) -> $crate::webcore::streams::result::Writable {
            Self::write_utf16(self, data)
        }
        fn write_latin1(
            &mut self,
            data: &$crate::webcore::streams::Result,
        ) -> $crate::webcore::streams::result::Writable {
            Self::write_latin1(self, data)
        }
        fn end(&mut self, err: ::core::option::Option<::bun_sys::Error>) -> ::bun_sys::Result<()> {
            Self::end(self, err)
        }
        fn flush(&mut self) -> ::bun_sys::Result<()> {
            Self::flush(self)
        }
        fn flush_from_js(
            &mut self,
            global: &::bun_jsc::JSGlobalObject,
            wait: bool,
        ) -> ::bun_sys::Result<::bun_jsc::JSValue> {
            Self::flush_from_js(self, global, wait)
        }
        fn start(&mut self, config: $crate::webcore::streams::Start) -> ::bun_sys::Result<()> {
            Self::start(self, &config)
        }
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
    /// `${abi_name}__createController`: a `JSReadable*SinkController` with
    /// `m_sinkPtr = ptr`.
    fn create_controller_extern(
        global: &crate::webcore::jsc::JSGlobalObject,
        ptr: *mut c_void,
    ) -> crate::webcore::jsc::JSValue;
}

/// `from_js_extern` encodes two distinct failure types using 0 and 1. Any other
/// value is `*ThisSink`.
pub(crate) mod from_js_result {
    /// The sink has been closed and the wrapped type is freed.
    pub(crate) const DETACHED: usize = 0;
    /// JS exception has not yet been thrown.
    pub(crate) const CAST_FAILED: usize = 1;
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

    /// Pump `stream` into the sink through a new `JSReadable*SinkController`,
    /// kept as the sink's `source()`. It is installed before the pump starts
    /// because the pump drains whatever the stream already holds (user code
    /// included) before returning, and a sink failing in there detaches its
    /// `source()`.
    pub fn assign_to_stream(
        global: &crate::webcore::jsc::JSGlobalObject,
        stream: crate::webcore::jsc::JSValue,
        mut ptr: NonNull<T>,
    ) -> crate::webcore::jsc::JSValue
    where
        T: JsSinkType,
    {
        // SAFETY: `ptr` is a live sink owned by the caller for this synchronous
        // call; the pointer is only stashed in C++ `m_sinkPtr`.
        let ptr = unsafe { ptr.as_mut() };
        let controller =
            T::create_controller_extern(global, std::ptr::from_mut::<T>(ptr).cast::<c_void>());
        if let Some(src) = ptr.source() {
            *src = streams::SourceHandle::JSController(controller);
        }
        let result = streams::controller_abi::assign_to_stream(global, stream, controller);
        // Setup threw (e.g. a direct stream's `pull` getter): nothing will ever
        // end()/close() the controller, and its destructor would otherwise run
        // `${name}__finalize` on the sink after the caller has freed it. Detach
        // it while `ptr` is live; that reaches `js_controller_detached`, which
        // drops it from `source()` (a no-op if it already detached in the call).
        if result.to_error().is_some() {
            let _ = ::bun_jsc::call_check_slow(global, || {
                streams::controller_abi::detach_ptr(controller)
            });
        }
        result
    }

    /// Disconnect the upstream source: JSController → detachPtr; ByteStream → clear its SinkHandle.
    pub(crate) fn detach(source: &mut SourceHandle, _global: &crate::webcore::jsc::JSGlobalObject) {
        match *source {
            SourceHandle::JSController(value) => {
                source.clear();
                // detachPtr leaves m_needExceptionCheck set; wrap to satisfy the verifier.
                let _ = ::bun_jsc::call_check_slow(_global, || {
                    streams::controller_abi::detach_ptr(value)
                });
            }
            SourceHandle::ByteStream(bs) => {
                bs.unpipe_without_deref();
                source.clear();
            }
            SourceHandle::FileReader(fr) => {
                fr.unpipe_without_deref();
                source.clear();
            }
            _ => {}
        }
    }
}

/// Trait collecting every method `JSSink` may call on the wrapped `SinkType`.
/// Most of these are optional, modeled with default method bodies and
/// associated `const` gates.
pub trait JsSinkType: Sized + JsSinkAbi {
    const NAME: &'static str;
    /// Mirrors `@hasDecl(SinkType, "construct")`.
    const HAS_CONSTRUCT: bool = false;
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
    /// `${abi}__finalize`: the JS cell holding `this` as `m_sinkPtr` is giving
    /// up its claim on the sink. Raw pointer, not `&mut self`: for
    /// `ArrayBufferSink`, `FileSink` and `FetchRequestBodySink` that releases
    /// the allocation, and freeing under a live reference argument is UB.
    ///
    /// # Safety
    /// `this` is the cell's live sink and must not be used after the call.
    unsafe fn finalize(this: *mut Self);
    fn write_bytes(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable;
    fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable;
    /// `bufs` borrow JS buffers; a sink whose `write_bytes` runs JS must copy them first.
    fn writev_bytes(&mut self, bufs: &[&[u8]]) -> streams::result::Writable {
        use streams::result::Writable;
        let mut total: u64 = 0;
        let mut backpressure = false;
        // A sink that parks every write still takes the next chunk.
        let mut pending = None;
        for b in bufs {
            if b.is_empty() {
                continue;
            }
            let data = bun_ptr::RawSlice::new(b);
            match self.write_bytes(&streams::Result::Temporary(data)) {
                Writable::Owned(n) | Writable::Temporary(n) => total += n,
                Writable::Backpressure(n) => {
                    total += n;
                    backpressure = true;
                }
                Writable::OwnedAndDone(n) => return Writable::OwnedAndDone(total + n),
                Writable::Done => return Writable::OwnedAndDone(total),
                slot @ Writable::Pending(_) => pending = Some(slot),
                err @ Writable::Err(_) => return err,
            }
        }
        if let Some(slot) = pending {
            return slot;
        }
        if backpressure {
            Writable::Backpressure(total)
        } else {
            Writable::Owned(total)
        }
    }
    fn end(&mut self, err: Option<SysError>) -> sys::Result<()>;
    fn end_from_js(&mut self, global: &JSGlobalObject) -> sys::Result<JSValue>;
    fn flush(&mut self) -> sys::Result<()>;
    fn start(&mut self, config: streams::Start) -> sys::Result<()>;
    /// The source failed, so the bytes written so far are a truncated body:
    /// `controller.close(error)` with a truthy argument, or the pump's close
    /// for an errored stream, whose `reason` may be nullish. The default keeps
    /// the clean end for sinks whose owner handles the pump promise rejection.
    ///
    /// Raw pointer: failing can re-enter the sink through its owner and may
    /// free it.
    ///
    /// # Safety
    /// `this` is the cell's live sink.
    unsafe fn close_with_error(
        this: *mut Self,
        _global: &JSGlobalObject,
        _reason: JSValue,
    ) -> sys::Result<()> {
        // SAFETY: caller contract; `end` does not free the sink.
        unsafe { (*this).end(None) }
    }

    fn construct(_this: &mut core::mem::MaybeUninit<Self>) {
        // Only reached when `HAS_CONSTRUCT = false` callers misroute; the
        // real `js_construct` short-circuits before this.
        debug_assert!(!Self::HAS_CONSTRUCT, "JsSinkType::construct missing");
    }
    fn get_pending_error(&mut self) -> Option<JSValue> {
        None
    }
    fn source(&mut self) -> Option<&mut SourceHandle> {
        None
    }
    /// Called from `js_controller_detached`: once per JS-pump controller, on
    /// every detach path including its GC destructor. A sink co-owned by
    /// another GC cell releases the controller's claim here (sweep order
    /// between the two cells is unspecified, so neither destructor alone may
    /// free it). Never free the allocation inline: the caller holds
    /// `&mut Self` and the C++ dispatcher keeps using `m_sinkPtr` in the
    /// same frame; defer a last-owner free to the event loop.
    fn controller_detached(&mut self) {}
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

impl<T: JsSinkType> JSSink<T> {
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
    pub(crate) fn js_construct(
        global: &crate::webcore::jsc::JSGlobalObject,
        _frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        bun_core::mark_binding!();

        if !T::HAS_CONSTRUCT {
            return Err(global.throw_illegal_constructor());
        }

        let mut this: Box<core::mem::MaybeUninit<T>> = Box::new(core::mem::MaybeUninit::uninit());
        T::construct(&mut *this);
        // SAFETY: JsSinkType::construct fully initializes `*this` (contract).
        let this: Box<T> = unsafe { this.assume_init() };
        let value = T::create_object_extern(global, bun_core::heap::into_raw(this).cast(), 0);
        Ok(value)
    }

    /// `${abi_name}__write` host-fn body.
    pub(crate) fn js_write(
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
            let data = bun_ptr::RawSlice::new(slice);
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

        let view = arg.to_js_string_view(global)?;
        if view.is_empty() {
            return Ok(JSValue::js_number(0.0));
        }

        if view.is_utf16() {
            let utf16 = view.utf16();
            let bytes: &[u8] = bytemuck::cast_slice(utf16);
            let data = bun_ptr::RawSlice::new(bytes);
            return Ok(this
                .sink
                .write_utf16(&streams::Result::Temporary(data))
                .to_js(global));
        }

        let data = bun_ptr::RawSlice::new(view.latin1());
        Ok(this
            .sink
            .write_latin1(&streams::Result::Temporary(data))
            .to_js(global))
    }

    /// `${abi_name}__writev` host-fn body.
    pub fn js_writev(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        use crate::webcore::jsc::JSValue;
        bun_core::mark_binding!();

        let arg = frame.argument(0);
        arg.ensure_still_alive();
        let _keep = bun_jsc::EnsureStillAlive(arg);
        if !arg.is_array() {
            return Err(global.throw_value(global.to_type_error(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("writev() expects an array of ArrayBufferView"),
            )));
        }

        let len = arg.get_length(global)? as usize;
        if len == 0 {
            return Ok(JSValue::js_number(0.0));
        }
        const MAX_CHUNKS: usize = 1 << 20;
        if len > MAX_CHUNKS {
            return Err(global.throw_value(global.to_type_error(
                bun_jsc::ErrorCode::OUT_OF_RANGE,
                format_args!("writev() chunk count {} exceeds {}", len, MAX_CHUNKS),
            )));
        }

        bun_jsc::MarkedArgumentBuffer::new(|roots| {
            let mut items: Vec<JSValue> = Vec::with_capacity(len);
            for i in 0..len {
                let item = arg.get_index(global, i as u32)?;
                roots.append(item);
                items.push(item);
            }
            let mut slices: Vec<&[u8]> = Vec::with_capacity(len);
            for item in &items {
                let Some(buffer) = item.as_array_buffer(global) else {
                    return Err(global.throw_value(global.to_type_error(
                        bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                        format_args!("writev() expects an array of ArrayBufferView"),
                    )));
                };
                let slice = buffer.slice();
                // SAFETY: `roots` keeps every cell GC-live. No JS runs before
                // `writev_bytes`, and a sink whose write runs JS (RewriterPipe)
                // copies every chunk before its first write, so no slice is
                // read after a detach could happen.
                slices.push(unsafe { core::slice::from_raw_parts(slice.as_ptr(), slice.len()) });
            }
            // Acquire `&mut sink` only after all accessor JS has run.
            let this = Self::get_this(global, frame)?;
            if let Some(err) = this.sink.get_pending_error() {
                return Err(global.throw_value(err));
            }
            Ok(this.sink.writev_bytes(&slices).to_js(global))
        })
    }

    /// `${abi_name}__flush` host-fn body.
    pub(crate) fn js_flush(
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
    pub(crate) fn js_start(
        global: &crate::webcore::jsc::JSGlobalObject,
        frame: &crate::webcore::jsc::CallFrame,
    ) -> crate::webcore::jsc::JsResult<crate::webcore::jsc::JSValue> {
        use crate::webcore::jsc::JSValue;
        use bun_sys_jsc::ErrorJsc;
        bun_core::mark_binding!();

        // Option getters can run user JS that closes the sink, so read them
        // before resolving `this`.
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

        let this = Self::get_this(global, frame)?;

        if let Some(err) = this.sink.get_pending_error() {
            return Err(global.throw_value(err));
        }

        match this.sink.start(config) {
            sys::Result::Ok(()) => Ok(JSValue::UNDEFINED),
            sys::Result::Err(err) => Err(global.throw_value(err.to_js(global)?)),
        }
    }

    /// `${abi_name}__end` host-fn body.
    pub(crate) fn js_end(
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
        if T::HAS_PROTECT_JS_WRAPPER && this.sink.pending_state_is_pending() {
            this.sink.protect_js_wrapper(global, frame.this());
        }

        result
    }

    /// `${abi_name}__finalize` body.
    ///
    /// # Safety
    /// As [`JsSinkType::finalize`].
    #[inline]
    pub(crate) unsafe fn js_finalize(this: *mut T) {
        debug_assert!(!this.is_null());
        // SAFETY: the caller's contract is the same one.
        unsafe { T::finalize(this) }
    }

    /// `${abi_name}__controllerDetached` body — called from
    /// `JSReadable*Controller::detach()` (controller `.end()`/`.close()` host
    /// fns) and from the controller's destructor, i.e. whenever the
    /// controller stops being attached to this sink.
    ///
    /// `SourceHandle::JSController` stores the controller's encoded JSValue
    /// bits (set by `assign_to_stream`) without rooting the cell, so the
    /// controller can be collected while the native sink still has a flush in
    /// flight. Once the controller detaches or dies the source must never
    /// fire again: `onClose`/`onReady` would decode a dead cell. Clear it,
    /// but only when it still holds this controller's bits — a sink
    /// re-assigned to a new stream holds the newer controller's bits.
    pub(crate) fn js_controller_detached(this: &mut T, controller: crate::webcore::jsc::JSValue) {
        if let Some(src) = this.source() {
            if matches!(*src, SourceHandle::JSController(held) if held == controller) {
                src.clear();
            }
        }
        this.controller_detached();
    }

    /// `${abi_name}__close` body — called from
    /// `${controller}__closeWithReason` and `${name}__doClose` in JSSink.cpp
    /// with a raw `m_sinkPtr` (not a host-fn callframe), so exceptions become
    /// `.zero`. `reason` is the empty value for a clean close (`close()`, a
    /// falsy `close(reason)` argument, or the sink's own `close()`), otherwise
    /// the failed source's reason, which the pump may pass as `undefined`.
    ///
    /// # Safety
    /// `this` is the cell's live sink.
    pub(crate) unsafe fn js_close(
        global: &crate::webcore::jsc::JSGlobalObject,
        this: *mut T,
        reason: crate::webcore::jsc::JSValue,
    ) -> crate::webcore::jsc::JSValue {
        use crate::webcore::jsc::JSValue;
        use bun_sys_jsc::ErrorJsc;
        bun_core::mark_binding!();

        // SAFETY: caller contract; the borrow ends before `close_with_error`,
        // which may re-enter or free the sink.
        if let Some(err) = unsafe { (*this).get_pending_error() } {
            // `throw_error` sets the pending JS exception and returns the
            // `JsError` for `?`-propagation; this host fn returns bare
            // `JSValue`, so report and return ZERO (caller checks exception).
            let _ = global.vm().throw_error(global, err);
            return JSValue::ZERO;
        }

        let result = if reason.is_empty() {
            // SAFETY: as above; `end` does not free the sink.
            unsafe { (*this).end(None) }
        } else {
            // SAFETY: caller contract.
            unsafe { T::close_with_error(this, global, reason) }
        };

        // TODO: properly propagate exception upwards
        match result {
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
    pub(crate) fn js_end_with_sink(
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

    /// `${abi_name}__updateRef` body.
    #[inline]
    pub(crate) fn js_update_ref(this: &mut T, value: bool) {
        bun_core::mark_binding!();
        if T::HAS_UPDATE_REF {
            this.update_ref(value);
        }
    }

    /// `${abi_name}__getInternalFd` body.
    #[inline]
    pub(crate) fn js_get_internal_fd(this: &mut T) -> crate::webcore::jsc::JSValue {
        use crate::webcore::jsc::JSValue;
        if T::HAS_GET_FD {
            return JSValue::js_number(this.get_fd() as f64);
        }
        JSValue::NULL
    }

    /// `${abi_name}__memoryCost` body.
    #[inline]
    pub(crate) fn js_memory_cost(this: &T) -> usize {
        core::mem::size_of::<JSSink<T>>() + this.memory_cost()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Native-transform → native-sink byte-write dispatch
//
// Replaces the generated per-sink `${name}__writeBytes` thunks + the C++
// `JSSink__writeBytes` SinkID switch with a single Rust entry point that
// routes through `SinkHandle::write`.
// ──────────────────────────────────────────────────────────────────────────

/// Map a C++ `WebCore::SinkID` + erased `m_sinkPtr` to a [`SinkHandle`].
///
/// `ptr` is the `m_sinkPtr` stored on the JS wrapper (a `*mut JSSink<T>` for
/// the `T` selected by `id`); `JSSink<T>` is `#[repr(transparent)]` over `T`,
/// so the cast to `*mut T` is an address-preserving no-op.
///
/// # Safety
/// `ptr` must be a live, properly-aligned pointer to the concrete sink type
/// that `id` names (the same pointer the generated `${name}__*` thunks
/// receive), valid for the lifetime of the returned handle.
pub(crate) unsafe fn sink_handle_from_id(
    id: u8,
    ptr: NonNull<c_void>,
) -> crate::webcore::SinkHandle {
    use crate::webcore::SinkHandle;
    // Mirrors `enum SinkID` in src/jsc/bindings/Sink.h.
    const ARRAY_BUFFER_SINK: u8 = 0;
    const FILE_SINK: u8 = 2;
    const HTML_REWRITER_SINK: u8 = 3;
    const HTTP_RESPONSE_SINK: u8 = 4;
    const HTTPS_RESPONSE_SINK: u8 = 5;
    const NETWORK_SINK: u8 = 6;
    const FETCH_REQUEST_BODY_SINK: u8 = 7;

    let raw = ptr.as_ptr();
    match id {
        // SAFETY: caller contract — `raw` is a live `*mut ArrayBufferSink`.
        ARRAY_BUFFER_SINK => SinkHandle::ArrayBuffer(unsafe {
            bun_ptr::BackRef::from_raw_mut(raw.cast::<ArrayBufferSink>())
        }),
        // SAFETY: caller contract — `raw` is a live `*mut FileSink`.
        FILE_SINK => SinkHandle::FileSink(unsafe {
            bun_ptr::BackRef::from_raw(raw.cast::<crate::webcore::file_sink::FileSink>())
        }),
        // SAFETY: caller contract — `raw` is a live `*mut RewriterPipe`.
        HTML_REWRITER_SINK => SinkHandle::HTMLRewriter(unsafe {
            bun_ptr::BackRef::from_raw(raw.cast::<crate::api::html_rewriter::RewriterPipe>())
        }),
        // SAFETY: caller contract — `raw` is a live `*mut HTTPResponseSink`.
        HTTP_RESPONSE_SINK => SinkHandle::HttpResponse(unsafe {
            bun_ptr::BackRef::from_raw_mut(raw.cast::<streams::HTTPResponseSink>())
        }),
        // SAFETY: caller contract — `raw` is a live `*mut HTTPSResponseSink`.
        HTTPS_RESPONSE_SINK => SinkHandle::HttpsResponse(unsafe {
            bun_ptr::BackRef::from_raw_mut(raw.cast::<streams::HTTPSResponseSink>())
        }),
        // SAFETY: caller contract — `raw` is a live `*mut NetworkSink`.
        NETWORK_SINK => SinkHandle::S3Upload(unsafe {
            bun_ptr::BackRef::from_raw_mut(raw.cast::<streams::NetworkSink>())
        }),
        // SAFETY: caller contract — `raw` is a live `*mut FetchRequestBodySink`.
        FETCH_REQUEST_BODY_SINK => SinkHandle::FetchRequestBody(unsafe {
            bun_ptr::BackRef::from_raw_mut(
                raw.cast::<crate::webcore::fetch::FetchRequestBodySink>(),
            )
        }),
        // 1 (TextSink) and any unknown id → no native sink.
        _ => SinkHandle::None,
    }
}

/// Route a borrowed byte chunk from a native transform (`JSTransformStream`
/// with `m_nativeSinkPtr` attached) into the concrete sink via
/// [`SinkHandle::write`].
///
/// Return shape matches [`streams::result::Writable::to_js`] so
/// `nativeSinkWriteIsBackpressure` reads a negative number / pending promise
/// exactly as the previous `js_write_bytes` path produced. No
/// [`JsSinkType::get_pending_error`] guard: every sink uses the trait-default
/// `None`, so omitting it is behavior-preserving.
#[unsafe(no_mangle)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn Bun__NativeTransformSink__writeBytes(
    sink_id: u8,
    sink_ptr: *mut c_void,
    global: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) -> JSValue {
    bun_core::mark_binding!();
    let Some(sink_ptr) = NonNull::new(sink_ptr) else {
        return JSValue::js_number(0.0);
    };
    if len == 0 || ptr.is_null() {
        return JSValue::js_number(0.0);
    }
    // SAFETY: C++ caller passes a live `m_sinkPtr` of the type `sink_id`
    // names, valid for the duration of this synchronous call.
    let handle = unsafe { sink_handle_from_id(sink_id, sink_ptr) };
    if handle.is_none() {
        return JSValue::UNDEFINED;
    }
    // SAFETY: caller guarantees `[ptr, ptr+len)` is a live readable byte
    // buffer for the duration of this call (a GC-kept `JSArrayBufferView` or
    // a caller-owned scratch buffer).
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    handle
        .write(&streams::Result::Temporary(bun_ptr::RawSlice::new(slice)))
        .to_js(global)
}

// ──────────────────────────────────────────────────────────────────────────
// DestructorPtr / Bun__onSinkDestroyed
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// Used only as a `TaggedPointerUnion` type-tag.
    pub struct Detached;
}

// `bun_ptr::impl_tagged_ptr_union!` would impl the foreign
// `TypeList` trait for a tuple type, hitting orphan rules from this crate.
// Hand-roll a local marker struct + impls instead (matches the
// `AnyServerTypes` pattern in server_body.rs). The second variant
// (`Subprocess<'_>`) carries a lifetime so it cannot implement
// `UnionMember`; only `Detached` is a typed member, and the Subprocess arm
// in `Bun__onSinkDestroyed` casts the raw pointer manually.
pub(crate) struct DestructorTypes;
impl bun_ptr::tagged_pointer::TypeList for DestructorTypes {
    const MIN_TAG: bun_ptr::tagged_pointer::TagType = 1024 - 1;
}
impl bun_ptr::tagged_pointer::UnionMember<DestructorTypes> for Detached {
    const TAG: bun_ptr::tagged_pointer::TagType = 1024;
}
pub(crate) type DestructorPtr = TaggedPtrUnion<DestructorTypes>;

/// Encode a `*Subprocess` as the second `DestructorPtr` tag (1023). Manual
/// re-encoding of `TaggedPtr::init(ptr, 1023)` because `Subprocess<'_>` carries
/// a lifetime and so cannot implement `UnionMember`, and `TaggedPtr`'s raw repr
/// is private. Consumed by `to_js_with_destructor` (which takes the encoded
/// `usize` directly) and round-tripped through C++ back to
/// `Bun__onSinkDestroyed`.
#[inline]
pub(crate) fn destructor_ptr_subprocess(ptr: *const c_void) -> usize {
    const ADDR_BITS: u32 = 49;
    const ADDR_MASK: u64 = (1u64 << ADDR_BITS) - 1;
    const SUBPROCESS_TAG: u64 = 1023; // second variant: 1024 - 1
    ((ptr as usize as u64 & ADDR_MASK) | (SUBPROCESS_TAG << ADDR_BITS)) as usize
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__onSinkDestroyed(ptr_value: *mut c_void, sink_ptr: *mut c_void) {
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

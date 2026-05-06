use core::ffi::{c_int, c_void};
use core::ptr::{self, NonNull};

use bun_brotli::c;
type Op = c::BrotliEncoderOperation;
// TODO(port): exact path — Zig: bun.brotli.c.BrotliEncoder.Operation

// ─── type defs (real) ─────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy)]
pub union LastResult {
    pub e: c_int,
    pub d: c::BrotliDecoderResult,
}

pub struct Context {
    pub mode: bun_zlib::NodeMode,
    pub state: Option<NonNull<c_void>>,

    pub next_in: *const u8,
    pub next_out: *mut u8,
    pub avail_in: usize,
    pub avail_out: usize,

    pub flush: Op,

    pub last_result: LastResult,
    pub error_: c::BrotliDecoderErrorCode2,
}

impl Default for Context {
    fn default() -> Self {
        Self {
            mode: bun_zlib::NodeMode::NONE,
            state: None,
            next_in: ptr::null(),
            next_out: ptr::null_mut(),
            avail_in: 0,
            avail_out: 0,
            flush: Op::process,
            // SAFETY: all-zero is a valid LastResult (c_int 0 / enum 0).
            last_result: unsafe { core::mem::zeroed() },
            error_: c::BrotliDecoderErrorCode2::NO_ERROR,
        }
    }
}

// ─── gated: JsClass payload + host fns + Context method bodies ────────────
// `NativeBrotli` carries `#[bun_jsc::JsClass]`; `impl Context` calls
// `Error::init(&str, ..)` and uses brotli-C variant names that diverge from
// `bun_brotli_sys` (e.g. `BrotliDecoderResult::Error` vs `::err`). Unblocking
// requires aligning those signatures — Phase B.
// TODO(b2-blocked): un-gate once bun_jsc JsClass + Error::init str overload + brotli_c variant names settle.

mod _impl {
use super::*;
use core::cell::Cell;
use core::ffi::c_uint;

use bun_jsc::{CallFrame, ErrorCode, JSGlobalObject, JSValue, JsResult, RangeErrorOptions, StrongOptional, WorkPoolTask};

use crate::node::node_zlib_binding::{CompressionContext, CompressionStream, CompressionStreamImpl, CountedKeepAlive, Error};
use crate::node::util::validators;

// Intrusive refcount: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`.
// In Rust the handle type is `bun_ptr::IntrusiveRc<NativeBrotli>`; the
// `ref_count` field below is read/written by that wrapper, and `deinit` is the
// drop body invoked when the count reaches zero.
// TODO(port): wire `ref`/`deref` via `bun_ptr::IntrusiveRc` impl.

// `.classes.ts`-backed: the C++ JSCell wrapper (JSNativeBrotli) is generated;
// this struct is the `m_ctx` payload. Codegen provides toJS/fromJS/fromJSDirect.
#[bun_jsc::JsClass]
pub struct NativeBrotli {
    pub ref_count: Cell<u32>,
    // TODO(port): lifetime — JSC_BORROW backref; global outlives this m_ctx payload.
    pub global_this: *mut JSGlobalObject,
    pub stream: Context,
    /// Points into a JS `Uint32Array` (`this._writeState`). Kept alive because
    /// the JS object is tied to the native handle as `_handle[owner_symbol]`.
    pub write_result: Option<NonNull<u32>>,
    pub poll_ref: CountedKeepAlive,
    // TODO(port): Strong on m_ctx self-ref → JsRef per PORTING.md §JSC (Strong back-ref to own wrapper leaks)
    pub this_value: StrongOptional, // Strong.Optional — empty-initialised
    pub write_in_progress: bool,
    pub pending_close: bool,
    pub pending_reset: bool,
    pub closed: bool,
    pub task: WorkPoolTask,
}

// `const impl = CompressionStream(@This())` — Zig mixin that provides
// write / runFromJSThread / writeSync / reset / close / setOnError /
// getOnError / finalize / emitError. In Rust these are generic associated
// fns on `CompressionStream::<NativeBrotli>` (see node_zlib_binding.rs).
// TODO(port): expose via inherent-looking methods so .classes.ts codegen can resolve them.

impl NativeBrotli {
    // PORT NOTE: no `#[bun_jsc::host_fn]` — the free-fn shim it emits calls
    // a bare `constructor(...)` which cannot resolve inside an `impl` block.
    // The `#[bun_jsc::JsClass]` derive already emits the construct shim that
    // calls `<Self>::constructor(__g, __f)`.
    pub fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<Self>> {
        let arguments = callframe.arguments_undef::<1>();

        let mode = arguments.ptr[0];
        if !mode.is_number() {
            return Err(global_this.throw_invalid_argument_type_value("mode", "number", mode));
        }
        let mode_double = mode.as_number();
        if mode_double % 1.0 != 0.0 {
            return Err(global_this.throw_invalid_argument_type_value("mode", "integer", mode));
        }
        let mode_int: i64 = mode_double as i64;
        if mode_int < 8 || mode_int > 9 {
            return Err(global_this.throw_range_error(mode_int, RangeErrorOptions {
                field_name: b"mode",
                min: 8,
                max: 9,
                ..Default::default()
            }));
        }

        let mut ptr = Box::new(Self {
            ref_count: Cell::new(1),
            // SAFETY: JSGlobalObject is an opaque FFI handle; `as_ptr()` derives `*mut`
            // via UnsafeCell so the stored pointer carries write provenance. The global
            // outlives this m_ctx payload (JSC_BORROW backref).
            global_this: global_this.as_ptr(),
            stream: Context::default(),
            write_result: None,
            poll_ref: CountedKeepAlive::default(),
            this_value: StrongOptional::empty(),
            write_in_progress: false,
            pending_close: false,
            pending_reset: false,
            closed: false,
            // .callback = undefined — overwritten before WorkPool::schedule()
            task: WorkPoolTask { node: Default::default(), callback: noop_task_callback },
        });
        // SAFETY: mode_int is 8 or 9, both valid NodeMode discriminants.
        ptr.stream.mode = unsafe {
            core::mem::transmute::<u8, bun_zlib::NodeMode>(u8::try_from(mode_int).unwrap())
        };
        // TODO(port): NodeMode repr width — confirm #[repr(u8)] vs wider.
        Ok(ptr)
    }

    pub fn estimated_size(&self) -> usize {
        const ENCODER_STATE_SIZE: usize = 5143; // sizeof(BrotliEncoderStateStruct)
        const DECODER_STATE_SIZE: usize = 855; // sizeof(BrotliDecoderStateStruct)
        core::mem::size_of::<Self>()
            + match self.stream.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => ENCODER_STATE_SIZE,
                bun_zlib::NodeMode::BROTLI_DECODE => DECODER_STATE_SIZE,
                _ => 0,
            }
    }

    #[bun_jsc::host_fn(method)]
    pub fn init(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_undef::<3>();
        let this_value = callframe.this();
        if arguments.len != 3 {
            return Err(global_this
                .err(ErrorCode::MISSING_ARGS, format_args!("init(params, writeResult, writeCallback)"))
                .throw());
        }

        // this does not get gc'd because it is stored in the JS object's
        // `this._writeState`. and the JS object is tied to the native handle
        // as `_handle[owner_symbol]`.
        let write_result = arguments.ptr[1]
            .as_array_buffer(global_this)
            .unwrap()
            .as_u32()
            .as_mut_ptr();
        let write_callback =
            validators::validate_function(global_this, "writeCallback", arguments.ptr[2])?;

        this.write_result = NonNull::new(write_result);

        js::write_callback_set_cached(
            this_value,
            global_this,
            with_async_context_if_needed(write_callback, global_this),
        );

        let mut err = this.stream.init();
        if err.is_error() {
            CompressionStream::<Self>::emit_error(this, global_this, this_value, err);
            return Ok(JSValue::FALSE);
        }

        let mut params_buf = arguments.ptr[0].as_array_buffer(global_this).unwrap();
        let params_ = params_buf.as_u32();

        for (i, &d) in params_.iter().enumerate() {
            // (d == -1) {
            if d == u32::MAX {
                continue;
            }
            err = this
                .stream
                .set_params(u32::try_from(i).unwrap() as c_uint, d);
            if err.is_error() {
                // impl.emitError(this, globalThis, this_value, err); //XXX: onerror isn't set yet
                this.stream.close();
                return Ok(JSValue::FALSE);
            }
        }
        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn params(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let _ = this;
        let _ = global_this;
        let _ = callframe;
        // intentionally left empty
        Ok(JSValue::UNDEFINED)
    }

    /// RefCount destructor body (called when ref_count → 0).
    fn deinit(&mut self) {
        // this_value / poll_ref have Drop impls; explicit calls kept for
        // ordering parity with Zig.
        // TODO(port): confirm Strong/CountedKeepAlive Drop ordering is benign
        // and remove explicit deinit calls.
        self.this_value = StrongOptional::empty();
        drop(core::mem::take(&mut self.poll_ref));
        match self.stream.mode {
            bun_zlib::NodeMode::BROTLI_ENCODE | bun_zlib::NodeMode::BROTLI_DECODE => {
                self.stream.close()
            }
            _ => {}
        }
        // bun.destroy(this) — freeing self is handled by IntrusiveRc / Box::from_raw.
    }
}

impl Context {
    pub fn init(&mut self) -> Error {
        match self.mode {
            bun_zlib::NodeMode::BROTLI_ENCODE => {
                let alloc = bun_brotli::BrotliAllocator::alloc;
                let free = bun_brotli::BrotliAllocator::free;
                // SAFETY: FFI — alloc/free are valid fn ptrs, opaque arg unused.
                let state =
                    unsafe { c::BrotliEncoderCreateInstance(Some(alloc), Some(free), ptr::null_mut()) };
                if state.is_null() {
                    return Error::init(
                        c"Could not initialize Brotli instance".as_ptr(),
                        -1,
                        c"ERR_ZLIB_INITIALIZATION_FAILED".as_ptr(),
                    );
                }
                self.state = NonNull::new(state.cast::<c_void>());
                Error::ok()
            }
            bun_zlib::NodeMode::BROTLI_DECODE => {
                let alloc = bun_brotli::BrotliAllocator::alloc;
                let free = bun_brotli::BrotliAllocator::free;
                // SAFETY: FFI — alloc/free are valid fn ptrs, opaque arg unused.
                let state =
                    unsafe { c::BrotliDecoderCreateInstance(Some(alloc), Some(free), ptr::null_mut()) };
                if state.is_null() {
                    return Error::init(
                        c"Could not initialize Brotli instance".as_ptr(),
                        -1,
                        c"ERR_ZLIB_INITIALIZATION_FAILED".as_ptr(),
                    );
                }
                self.state = NonNull::new(state.cast::<c_void>());
                Error::ok()
            }
            _ => unreachable!(),
        }
    }

    pub fn set_params(&mut self, key: c_uint, value: u32) -> Error {
        match self.mode {
            bun_zlib::NodeMode::BROTLI_ENCODE => {
                // SAFETY: state was created by BrotliEncoderCreateInstance.
                if unsafe { c::BrotliEncoderSetParameter(self.state_ptr().cast(), key, value) } == 0
                {
                    return Error::init(
                        c"Setting parameter failed".as_ptr(),
                        -1,
                        c"ERR_BROTLI_PARAM_SET_FAILED".as_ptr(),
                    );
                }
                Error::ok()
            }
            bun_zlib::NodeMode::BROTLI_DECODE => {
                // SAFETY: state was created by BrotliDecoderCreateInstance.
                if unsafe { c::BrotliDecoderSetParameter(self.state_ptr().cast(), key, value) } == 0
                {
                    return Error::init(
                        c"Setting parameter failed".as_ptr(),
                        -1,
                        c"ERR_BROTLI_PARAM_SET_FAILED".as_ptr(),
                    );
                }
                Error::ok()
            }
            _ => unreachable!(),
        }
    }

    pub fn reset(&mut self) -> Error {
        if self.state.is_some() {
            self.deinit_state();
        }
        self.init()
    }

    /// Frees the Brotli encoder/decoder state without changing mode.
    /// Use close() for full cleanup that also sets mode to NONE.
    fn deinit_state(&mut self) {
        match self.mode {
            bun_zlib::NodeMode::BROTLI_ENCODE => unsafe {
                // SAFETY: state was created by BrotliEncoderCreateInstance.
                c::BrotliEncoderDestroyInstance(self.state_ptr().cast())
            },
            bun_zlib::NodeMode::BROTLI_DECODE => unsafe {
                // SAFETY: state was created by BrotliDecoderCreateInstance.
                c::BrotliDecoderDestroyInstance(self.state_ptr().cast())
            },
            _ => unreachable!(),
        }
        self.state = None;
    }

    pub fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) {
        self.next_in = in_.map_or(ptr::null(), |p| p.as_ptr());
        self.avail_in = in_.map_or(0, |p| p.len());
        // PORT NOTE: reshaped for borrowck — compute ptr/len before consuming `out`.
        match out {
            Some(p) => {
                self.avail_out = p.len();
                self.next_out = p.as_mut_ptr();
            }
            None => {
                self.avail_out = 0;
                self.next_out = ptr::null_mut();
            }
        }
    }

    pub fn set_flush(&mut self, flush: c_int) {
        // SAFETY: caller passes a valid BrotliEncoderOperation discriminant.
        self.flush = unsafe { core::mem::transmute::<c_int, Op>(flush) };
        // TODO(port): Op repr width — confirm #[repr(c_int)].
    }

    pub fn do_work(&mut self) {
        match self.mode {
            bun_zlib::NodeMode::BROTLI_ENCODE => {
                let mut next_in = self.next_in;
                // SAFETY: state is a live encoder; next_in/next_out point into
                // caller-provided buffers sized by avail_in/avail_out.
                self.last_result.e = unsafe {
                    c::BrotliEncoderCompressStream(
                        self.state_ptr().cast(),
                        self.flush,
                        &mut self.avail_in,
                        &mut next_in,
                        &mut self.avail_out,
                        &mut self.next_out,
                        ptr::null_mut(),
                    )
                };
                // self.next_in += (next_in - self.next_in)
                // SAFETY: next_in advanced within the same allocation; offset = bytes consumed by brotli.
                self.next_in = unsafe {
                    self.next_in
                        .add((next_in as usize) - (self.next_in as usize))
                };
            }
            bun_zlib::NodeMode::BROTLI_DECODE => {
                let mut next_in = self.next_in;
                // SAFETY: state is a live decoder; buffers as above.
                self.last_result.d = unsafe {
                    c::BrotliDecoderDecompressStream(
                        self.state_ptr().cast(),
                        &mut self.avail_in,
                        &mut next_in,
                        &mut self.avail_out,
                        &mut self.next_out,
                        ptr::null_mut(),
                    )
                };
                // SAFETY: next_in advanced within the same allocation; offset = bytes consumed by brotli.
                self.next_in = unsafe {
                    self.next_in
                        .add((next_in as usize) - (self.next_in as usize))
                };
                // SAFETY: d was just written by the line above.
                if unsafe { self.last_result.d } == c::BrotliDecoderResult::err {
                    // SAFETY: state is a live decoder.
                    self.error_ = unsafe { c::BrotliDecoderGetErrorCode(self.state_ptr().cast()) };
                }
            }
            _ => unreachable!(),
        }
    }

    pub fn update_write_result(&self, avail_in: &mut u32, avail_out: &mut u32) {
        *avail_in = u32::try_from(self.avail_in).unwrap();
        *avail_out = u32::try_from(self.avail_out).unwrap();
    }

    pub fn get_error_info(&self) -> Error {
        match self.mode {
            bun_zlib::NodeMode::BROTLI_ENCODE => {
                // SAFETY: e is the active field after an encode do_work().
                if unsafe { self.last_result.e } == 0 {
                    return Error::init(
                        c"Compression failed".as_ptr(),
                        -1,
                        c"ERR_BROTLI_COMPRESSION_FAILED".as_ptr(),
                    );
                }
                Error::ok()
            }
            bun_zlib::NodeMode::BROTLI_DECODE => {
                if self.error_ != c::BrotliDecoderErrorCode2::NO_ERROR {
                    return Error::init(
                        c"Decompression failed".as_ptr(),
                        self.error_ as i32,
                        code_for_error(self.error_),
                    );
                } else if self.flush == Op::finish
                    // SAFETY: d is the active field after a decode do_work().
                    && unsafe { self.last_result.d } == c::BrotliDecoderResult::needs_more_input
                {
                    return Error::init(
                        c"unexpected end of file".as_ptr(),
                        bun_zlib::ReturnCode::BufError as i32,
                        c"Z_BUF_ERROR".as_ptr(),
                    );
                }
                Error::ok()
            }
            _ => unreachable!(),
        }
    }

    pub fn close(&mut self) {
        self.deinit_state();
        self.mode = bun_zlib::NodeMode::NONE;
    }

    #[inline]
    fn state_ptr(&self) -> *mut c_void {
        self.state.map_or(ptr::null_mut(), |p| p.as_ptr())
    }
}

// ─── CompressionStream mixin glue ─────────────────────────────────────────

impl CompressionContext for Context {
    #[inline]
    fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) {
        Context::set_buffers(self, in_, out)
    }
    #[inline]
    fn set_flush(&mut self, flush: i32) {
        Context::set_flush(self, flush as c_int)
    }
    #[inline]
    fn do_work(&mut self) {
        Context::do_work(self)
    }
    #[inline]
    fn reset(&mut self) -> Error {
        Context::reset(self)
    }
    #[inline]
    fn close(&mut self) {
        Context::close(self)
    }
    #[inline]
    fn get_error_info(&mut self) -> Error {
        Context::get_error_info(self)
    }
    #[inline]
    fn update_write_result(&mut self, avail_in: &mut u32, avail_out: &mut u32) {
        Context::update_write_result(&*self, avail_in, avail_out)
    }
}

impl bun_event_loop::Taskable for NativeBrotli {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::NativeBrotli;
}

impl CompressionStreamImpl for NativeBrotli {
    type Stream = Context;

    #[inline]
    fn global_this(&self) -> *mut JSGlobalObject {
        self.global_this
    }
    #[inline]
    fn stream_mut(&mut self) -> &mut Self::Stream {
        &mut self.stream
    }
    #[inline]
    fn write_result_ptr(&mut self) -> Option<*mut u32> {
        self.write_result.map(|p| p.as_ptr())
    }
    #[inline]
    fn poll_ref_mut(&mut self) -> &mut CountedKeepAlive {
        &mut self.poll_ref
    }
    #[inline]
    fn this_value_mut(&mut self) -> &mut StrongOptional {
        &mut self.this_value
    }
    #[inline]
    fn task_mut(&mut self) -> &mut WorkPoolTask {
        &mut self.task
    }
    #[inline]
    fn write_in_progress_mut(&mut self) -> &mut bool {
        &mut self.write_in_progress
    }
    #[inline]
    fn pending_close_mut(&mut self) -> &mut bool {
        &mut self.pending_close
    }
    #[inline]
    fn pending_reset_mut(&mut self) -> &mut bool {
        &mut self.pending_reset
    }
    #[inline]
    fn closed_mut(&mut self) -> &mut bool {
        &mut self.closed
    }

    unsafe fn from_task(task: *mut WorkPoolTask) -> *mut Self {
        // Zig `@fieldParentPtr("task", task)` — recover the owning NativeBrotli.
        // SAFETY: caller guarantees `task` points at the `task` field of a live `Self`.
        unsafe {
            task.byte_sub(core::mem::offset_of!(NativeBrotli, task))
                .cast::<Self>()
        }
    }

    fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: `self` was allocated via `Box::new` in `constructor`; the
            // intrusive refcount has reached zero so no other references remain.
            // Mirrors Zig `bun.ptr.RefCount(..).deref()` → `deinit()` + `bun.destroy(this)`.
            unsafe {
                let this = self as *const Self as *mut Self;
                (*this).deinit();
                drop(Box::from_raw(this));
            }
        }
    }

    fn write_callback_get_cached(this_value: JSValue) -> Option<JSValue> {
        js::write_callback_get_cached(this_value)
    }
    fn error_callback_get_cached(this_value: JSValue) -> Option<JSValue> {
        js::error_callback_get_cached(this_value)
    }
    fn error_callback_set_cached(this_value: JSValue, global: &JSGlobalObject, cb: JSValue) {
        js::error_callback_set_cached(this_value, global, cb)
    }
}

fn code_for_error(err: c::BrotliDecoderErrorCode2) -> *const core::ffi::c_char {
    // Zig: `inline for (std.meta.fieldNames(E), std.enums.values(E)) |n, v|
    //          if (err == v) return "ERR_BROTLI_DECODER_" ++ n;`
    // Rust has no enum reflection — expand the table by hand. Keep in sync
    // with `bun_brotli::c::BrotliDecoderErrorCode2`.
    use c::BrotliDecoderErrorCode2 as E;
    let s: &core::ffi::CStr = match err {
        E::NO_ERROR => c"ERR_BROTLI_DECODER_NO_ERROR",
        E::SUCCESS => c"ERR_BROTLI_DECODER_SUCCESS",
        E::NEEDS_MORE_INPUT => c"ERR_BROTLI_DECODER_NEEDS_MORE_INPUT",
        E::NEEDS_MORE_OUTPUT => c"ERR_BROTLI_DECODER_NEEDS_MORE_OUTPUT",
        E::ERROR_FORMAT_EXUBERANT_NIBBLE => c"ERR_BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE",
        E::ERROR_FORMAT_RESERVED => c"ERR_BROTLI_DECODER_ERROR_FORMAT_RESERVED",
        E::ERROR_FORMAT_EXUBERANT_META_NIBBLE => c"ERR_BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE",
        E::ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET => c"ERR_BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET",
        E::ERROR_FORMAT_SIMPLE_HUFFMAN_SAME => c"ERR_BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME",
        E::ERROR_FORMAT_CL_SPACE => c"ERR_BROTLI_DECODER_ERROR_FORMAT_CL_SPACE",
        E::ERROR_FORMAT_HUFFMAN_SPACE => c"ERR_BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE",
        E::ERROR_FORMAT_CONTEXT_MAP_REPEAT => c"ERR_BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT",
        E::ERROR_FORMAT_BLOCK_LENGTH_1 => c"ERR_BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1",
        E::ERROR_FORMAT_BLOCK_LENGTH_2 => c"ERR_BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2",
        E::ERROR_FORMAT_TRANSFORM => c"ERR_BROTLI_DECODER_ERROR_FORMAT_TRANSFORM",
        E::ERROR_FORMAT_DICTIONARY => c"ERR_BROTLI_DECODER_ERROR_FORMAT_DICTIONARY",
        E::ERROR_FORMAT_WINDOW_BITS => c"ERR_BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS",
        E::ERROR_FORMAT_PADDING_1 => c"ERR_BROTLI_DECODER_ERROR_FORMAT_PADDING_1",
        E::ERROR_FORMAT_PADDING_2 => c"ERR_BROTLI_DECODER_ERROR_FORMAT_PADDING_2",
        E::ERROR_FORMAT_DISTANCE => c"ERR_BROTLI_DECODER_ERROR_FORMAT_DISTANCE",
        E::ERROR_COMPOUND_DICTIONARY => c"ERR_BROTLI_DECODER_ERROR_COMPOUND_DICTIONARY",
        E::ERROR_DICTIONARY_NOT_SET => c"ERR_BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET",
        E::ERROR_INVALID_ARGUMENTS => c"ERR_BROTLI_DECODER_ERROR_INVALID_ARGUMENTS",
        E::ERROR_ALLOC_CONTEXT_MODES => c"ERR_BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES",
        E::ERROR_ALLOC_TREE_GROUPS => c"ERR_BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS",
        E::ERROR_ALLOC_CONTEXT_MAP => c"ERR_BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP",
        E::ERROR_ALLOC_RING_BUFFER_1 => c"ERR_BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1",
        E::ERROR_ALLOC_RING_BUFFER_2 => c"ERR_BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2",
        E::ERROR_ALLOC_BLOCK_TYPE_TREES => c"ERR_BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES",
        E::ERROR_UNREACHABLE => c"ERR_BROTLI_DECODER_ERROR_UNREACHABLE",
    };
    s.as_ptr()
}

/// Placeholder for `WorkPoolTask.callback` — overwritten before scheduling
/// (see `CompressionStream::write` in node_zlib_binding.rs). Zig: `.callback = undefined`.
unsafe fn noop_task_callback(_task: *mut WorkPoolTask) {}

/// Local shim for `JSValue::withAsyncContextIfNeeded` (not yet on `bun_jsc::JSValue`).
/// Wraps a callback so it restores the current AsyncLocalStorage context when invoked.
fn with_async_context_if_needed(callback: JSValue, global: &JSGlobalObject) -> JSValue {
    unsafe extern "C" {
        fn AsyncContextFrame__withAsyncContextIfNeeded(
            global: *const JSGlobalObject,
            callback: JSValue,
        ) -> JSValue;
    }
    // SAFETY: FFI to JSC binding; global is a valid live JSGlobalObject.
    unsafe { AsyncContextFrame__withAsyncContextIfNeeded(global.as_ptr().cast_const(), callback) }
}

// Codegen accessor namespace (JSNativeBrotli generated bindings).
// In Zig this is `jsc.Codegen.JSNativeBrotli`; the C++ side
// (`NativeBrotliPrototype__*CachedValue`) is emitted by generate-classes.ts.
// We call those externs directly so behavior matches the Zig 1:1.
mod js {
    use bun_jsc::{JSGlobalObject, JSValue};

    unsafe extern "C" {
        fn NativeBrotliPrototype__writeCallbackSetCachedValue(
            this_value: JSValue,
            global: *mut JSGlobalObject,
            value: JSValue,
        );
        fn NativeBrotliPrototype__writeCallbackGetCachedValue(this_value: JSValue) -> JSValue;
        fn NativeBrotliPrototype__errorCallbackSetCachedValue(
            this_value: JSValue,
            global: *mut JSGlobalObject,
            value: JSValue,
        );
        fn NativeBrotliPrototype__errorCallbackGetCachedValue(this_value: JSValue) -> JSValue;
    }

    #[inline]
    pub fn write_callback_set_cached(this_value: JSValue, global: &JSGlobalObject, cb: JSValue) {
        // SAFETY: FFI into generated C++ JSNativeBrotli; `this_value` is a live
        // JSNativeBrotli wrapper and `global` outlives this call.
        unsafe {
            NativeBrotliPrototype__writeCallbackSetCachedValue(this_value, global.as_mut_ptr(), cb)
        }
    }
    #[inline]
    pub fn write_callback_get_cached(this_value: JSValue) -> Option<JSValue> {
        // SAFETY: FFI into generated C++ JSNativeBrotli; `this_value` is a live wrapper.
        let v = unsafe { NativeBrotliPrototype__writeCallbackGetCachedValue(this_value) };
        if v.is_empty() { None } else { Some(v) }
    }
    #[inline]
    pub fn error_callback_get_cached(this_value: JSValue) -> Option<JSValue> {
        // SAFETY: FFI into generated C++ JSNativeBrotli; `this_value` is a live wrapper.
        let v = unsafe { NativeBrotliPrototype__errorCallbackGetCachedValue(this_value) };
        if v.is_empty() { None } else { Some(v) }
    }
    #[inline]
    pub fn error_callback_set_cached(this_value: JSValue, global: &JSGlobalObject, cb: JSValue) {
        // SAFETY: FFI into generated C++ JSNativeBrotli; `this_value` is a live wrapper.
        unsafe {
            NativeBrotliPrototype__errorCallbackSetCachedValue(this_value, global.as_mut_ptr(), cb)
        }
    }
}

} // mod _impl

pub use _impl::NativeBrotli;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/zlib/NativeBrotli.zig (282 lines)
//   confidence: medium
//   todos:      10
//   notes:      CompressionStream mixin → trait impl; code_for_error needs generated static table; brotli C fn signatures/enum reprs need verification in bun_brotli
// ──────────────────────────────────────────────────────────────────────────

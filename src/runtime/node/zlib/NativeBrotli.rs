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
            last_result: unsafe { bun_core::ffi::zeroed_unchecked() },
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

    use bun_jsc::{
        CallFrame, ErrorCode, JSGlobalObject, JSValue, JsCell, JsResult, RangeErrorOptions,
        StrongOptional, WorkPoolTask,
    };

    use crate::node::node_zlib_binding::{CompressionStream, CountedKeepAlive, Error};
    use crate::node::util::validators;

    // Intrusive refcount: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`.
    // In Rust the handle type is `bun_ptr::IntrusiveRc<NativeBrotli>`; the
    // `ref_count` field below is read/written by that wrapper, and `deinit` is the
    // drop body invoked when the count reaches zero.
    // TODO(port): wire `ref`/`deref` via `bun_ptr::IntrusiveRc` impl.

    // `.classes.ts`-backed: the C++ JSCell wrapper (JSNativeBrotli) is generated;
    // this struct is the `m_ctx` payload. Codegen provides toJS/fromJS/fromJSDirect.
    // R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
    // interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
    #[bun_jsc::JsClass]
    #[derive(bun_ptr::CellRefCounted)]
    #[ref_count(destroy = Self::destroy_on_zero)]
    pub struct NativeBrotli {
        pub ref_count: Cell<u32>,
        // JSC_BORROW backref; global outlives this m_ctx payload. `BackRef`
        // centralises the single unsafe deref so the trait impl is safe.
        pub global_this: bun_ptr::BackRef<JSGlobalObject>,
        pub stream: JsCell<Context>,
        /// Points into a JS `Uint32Array` (`this._writeState`). Kept alive because
        /// the JS object is tied to the native handle as `_handle[owner_symbol]`.
        pub write_result: Cell<Option<*mut u32>>,
        pub poll_ref: JsCell<CountedKeepAlive>,
        // TODO(port): Strong on m_ctx self-ref → JsRef per PORTING.md §JSC (Strong back-ref to own wrapper leaks)
        pub this_value: JsCell<StrongOptional>, // Strong.Optional — empty-initialised
        pub write_in_progress: Cell<bool>,
        pub pending_close: Cell<bool>,
        pub pending_reset: Cell<bool>,
        pub closed: Cell<bool>,
        pub task: JsCell<WorkPoolTask>,
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
                return Err(global_this.throw_range_error(
                    mode_int,
                    RangeErrorOptions {
                        field_name: b"mode",
                        min: 8,
                        max: 9,
                        ..Default::default()
                    },
                ));
            }

            let mut stream = Context::default();
            stream.mode = bun_zlib::NodeMode::from_int(mode_int as u8);
            Ok(Box::new(Self {
                ref_count: Cell::new(1),
                // JSC_BORROW backref — the global outlives this m_ctx payload.
                global_this: bun_ptr::BackRef::new(global_this),
                stream: JsCell::new(stream),
                write_result: Cell::new(None),
                poll_ref: JsCell::new(CountedKeepAlive::default()),
                this_value: JsCell::new(StrongOptional::empty()),
                write_in_progress: Cell::new(false),
                pending_close: Cell::new(false),
                pending_reset: Cell::new(false),
                closed: Cell::new(false),
                // .callback = undefined — overwritten before WorkPool::schedule()
                task: JsCell::new(WorkPoolTask {
                    node: Default::default(),
                    callback: noop_task_callback,
                }),
            }))
        }

        pub fn estimated_size(&self) -> usize {
            const ENCODER_STATE_SIZE: usize = 5143; // sizeof(BrotliEncoderStateStruct)
            const DECODER_STATE_SIZE: usize = 855; // sizeof(BrotliDecoderStateStruct)
            core::mem::size_of::<Self>()
                + match self.stream.get().mode {
                    bun_zlib::NodeMode::BROTLI_ENCODE => ENCODER_STATE_SIZE,
                    bun_zlib::NodeMode::BROTLI_DECODE => DECODER_STATE_SIZE,
                    _ => 0,
                }
        }

        #[bun_jsc::host_fn(method)]
        pub fn init(
            &self,
            global_this: &JSGlobalObject,
            callframe: &CallFrame,
        ) -> JsResult<JSValue> {
            let arguments = callframe.arguments_undef::<3>();
            let this_value = callframe.this();
            if arguments.len != 3 {
                return Err(global_this
                    .err(
                        ErrorCode::MISSING_ARGS,
                        format_args!("init(params, writeResult, writeCallback)"),
                    )
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

            self.write_result.set(Some(write_result));

            js::write_callback_set_cached(
                this_value,
                global_this,
                write_callback.with_async_context_if_needed(global_this),
            );

            let mut err = self.stream.with_mut(|s| s.init());
            if err.is_error() {
                CompressionStream::<Self>::emit_error(self, global_this, this_value, err);
                return Ok(JSValue::FALSE);
            }

            let mut params_buf = arguments.ptr[0].as_array_buffer(global_this).unwrap();
            let params_ = params_buf.as_u32();

            for (i, &d) in params_.iter().enumerate() {
                // (d == -1) {
                if d == u32::MAX {
                    continue;
                }
                err = self
                    .stream
                    .with_mut(|s| s.set_params(u32::try_from(i).expect("int cast") as c_uint, d));
                if err.is_error() {
                    // impl.emitError(this, globalThis, this_value, err); //XXX: onerror isn't set yet
                    self.stream.with_mut(|s| s.close());
                    return Ok(JSValue::FALSE);
                }
            }
            Ok(JSValue::TRUE)
        }

        #[bun_jsc::host_fn(method)]
        pub fn params(
            &self,
            _global_this: &JSGlobalObject,
            _callframe: &CallFrame,
        ) -> JsResult<JSValue> {
            // intentionally left empty
            Ok(JSValue::UNDEFINED)
        }

        /// `CellRefCounted::destroy` target (refcount hit zero). Runs `deinit`
        /// then frees the Box-allocated payload — matches Zig
        /// `bun.ptr.RefCount(.., deinit, .{}).deref()` → `deinit()` + `bun.destroy(this)`.
        ///
        /// Safe fn: only reachable via the `#[ref_count(destroy = …)]` derive,
        /// whose generated trait `destroy` upholds the sole-owner contract.
        fn destroy_on_zero(this: *mut Self) {
            // SAFETY: refcount hit zero ⇒ no other borrow remains.
            unsafe { (*this).deinit() };
            // SAFETY: allocated via `Box::new` in `constructor`.
            drop(unsafe { bun_core::heap::take(this) });
        }

        /// RefCount destructor body (called when ref_count → 0).
        fn deinit(&mut self) {
            // this_value / poll_ref have Drop impls; explicit calls kept for
            // ordering parity with Zig.
            // TODO(port): confirm Strong/CountedKeepAlive Drop ordering is benign
            // and remove explicit deinit calls.
            self.this_value.set(StrongOptional::empty());
            drop(self.poll_ref.replace(CountedKeepAlive::default()));
            self.stream.with_mut(|s| match s.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE | bun_zlib::NodeMode::BROTLI_DECODE => s.close(),
                _ => {}
            });
            // bun.destroy(this) — freeing self is handled by IntrusiveRc / heap::take.
        }
    }

    impl Context {
        pub fn init(&mut self) -> Error {
            match self.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => {
                    let alloc = bun_brotli::BrotliAllocator::alloc;
                    let free = bun_brotli::BrotliAllocator::free;
                    // SAFETY: FFI — alloc/free are valid fn ptrs, opaque arg unused.
                    let state = unsafe {
                        c::BrotliEncoderCreateInstance(Some(alloc), Some(free), ptr::null_mut())
                    };
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
                    let state = unsafe {
                        c::BrotliDecoderCreateInstance(Some(alloc), Some(free), ptr::null_mut())
                    };
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
                    if c::BrotliEncoderSetParameter(self.encoder_mut(), key, value) == 0 {
                        return Error::init(
                            c"Setting parameter failed".as_ptr(),
                            -1,
                            c"ERR_BROTLI_PARAM_SET_FAILED".as_ptr(),
                        );
                    }
                    Error::ok()
                }
                bun_zlib::NodeMode::BROTLI_DECODE => {
                    if c::BrotliDecoderSetParameter(self.decoder_mut(), key, value) == 0 {
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
                bun_zlib::NodeMode::BROTLI_ENCODE => {
                    c::BrotliEncoder::destroy_instance(self.encoder_mut())
                }
                bun_zlib::NodeMode::BROTLI_DECODE => {
                    c::BrotliDecoder::destroy_instance(self.decoder_mut())
                }
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
            // Caller passes a valid BrotliEncoderOperation discriminant (Node
            // zlib constants 0..=3). Exhaustive match — `Op` is `#[repr(u32)]`
            // so the prior `c_int` bit-cast was a width hazard anyway. Out-of-
            // range traps to match Zig `this.flush = @enumFromInt(flush)`.
            self.flush = match flush {
                0 => Op::process,
                1 => Op::flush,
                2 => Op::finish,
                3 => Op::emit_metadata,
                n => unreachable!("invalid BrotliEncoderOperation {n}"),
            };
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
                            &raw mut self.avail_in,
                            &raw mut next_in,
                            &raw mut self.avail_out,
                            &raw mut self.next_out,
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
                            &raw mut self.avail_in,
                            &raw mut next_in,
                            &raw mut self.avail_out,
                            &raw mut self.next_out,
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
                        self.error_ = c::BrotliDecoderGetErrorCode(self.decoder_mut());
                    }
                }
                _ => unreachable!(),
            }
        }

        pub fn update_write_result(&self, avail_in: &mut u32, avail_out: &mut u32) {
            *avail_in = u32::try_from(self.avail_in).expect("int cast");
            *avail_out = u32::try_from(self.avail_out).expect("int cast");
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

        /// `&mut` to the live encoder state. Single unsafe deref site for the
        /// set-once `state: Option<NonNull<c_void>>` (encode mode) so callers
        /// hitting the `pub safe fn` brotli FFI surface stay safe.
        #[inline]
        fn encoder_mut(&mut self) -> &mut c::BrotliEncoder {
            debug_assert!(matches!(self.mode, bun_zlib::NodeMode::BROTLI_ENCODE));
            // SAFETY: callers branch on `mode == BROTLI_ENCODE`, so `state` was
            // populated by `BrotliEncoderCreateInstance` in `init()` and is not
            // yet freed (`deinit_state` clears it after destroy).
            unsafe { &mut *self.state.unwrap().as_ptr().cast() }
        }

        /// `&mut` to the live decoder state. Single unsafe deref site for the
        /// set-once `state: Option<NonNull<c_void>>` (decode mode).
        #[inline]
        fn decoder_mut(&mut self) -> &mut c::BrotliDecoder {
            debug_assert!(matches!(self.mode, bun_zlib::NodeMode::BROTLI_DECODE));
            // SAFETY: callers branch on `mode == BROTLI_DECODE`, so `state` was
            // populated by `BrotliDecoderCreateInstance` in `init()` and is not
            // yet freed.
            unsafe { &mut *self.state.unwrap().as_ptr().cast() }
        }
    }

    // ─── CompressionStream mixin glue ─────────────────────────────────────────
    // Stamps `impl CompressionContext for Context`, `impl Taskable`/
    // `CompressionStreamImpl for NativeBrotli`, and `pub mod js { … }` (the
    // `NativeBrotliPrototype__*CachedValue` accessors).
    crate::__impl_compression_stream!(NativeBrotli, Context, "NativeBrotli");

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
            E::ERROR_FORMAT_EXUBERANT_META_NIBBLE => {
                c"ERR_BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE"
            }
            E::ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET => {
                c"ERR_BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET"
            }
            E::ERROR_FORMAT_SIMPLE_HUFFMAN_SAME => {
                c"ERR_BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME"
            }
            E::ERROR_FORMAT_CL_SPACE => c"ERR_BROTLI_DECODER_ERROR_FORMAT_CL_SPACE",
            E::ERROR_FORMAT_HUFFMAN_SPACE => c"ERR_BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE",
            E::ERROR_FORMAT_CONTEXT_MAP_REPEAT => {
                c"ERR_BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT"
            }
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
    /// Safe fn: coerces to the `WorkPoolTask.callback` field type at the
    /// struct-init site; the body never dereferences the pointer.
    fn noop_task_callback(_task: *mut WorkPoolTask) {}

    crate::__compression_stream_mixin_reexports!(NativeBrotli);
} // mod _impl

pub use _impl::NativeBrotli;

// ported from: src/runtime/node/zlib/NativeBrotli.zig

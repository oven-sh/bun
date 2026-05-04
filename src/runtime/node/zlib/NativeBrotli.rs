use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void};
use core::ptr::{self, NonNull};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, Strong};
use bun_str::ZStr;
use bun_threading::WorkPoolTask;

use crate::node::node_zlib_binding::{CompressionStream, CountedKeepAlive, Error};
use crate::node::util::validators;

// Intrusive refcount: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`.
// In Rust the handle type is `bun_ptr::IntrusiveRc<NativeBrotli>`; the
// `ref_count` field below is read/written by that wrapper, and `deinit` is the
// drop body invoked when the count reaches zero.
// TODO(port): wire `ref`/`deref` via `bun_ptr::IntrusiveRc` impl.

// `.classes.ts`-backed: the C++ JSCell wrapper (JSNativeBrotli) is generated;
// this struct is the `m_ctx` payload. Codegen provides toJS/fromJS/fromJSDirect.
#[bun_jsc::JsClass]
pub struct NativeBrotli<'a> {
    pub ref_count: Cell<u32>,
    pub global_this: &'a JSGlobalObject,
    pub stream: Context,
    /// Points into a JS `Uint32Array` (`this._writeState`). Kept alive because
    /// the JS object is tied to the native handle as `_handle[owner_symbol]`.
    pub write_result: Option<NonNull<u32>>,
    pub poll_ref: CountedKeepAlive,
    // TODO(port): Strong on m_ctx self-ref → JsRef per PORTING.md §JSC (Strong back-ref to own wrapper leaks)
    pub this_value: Strong, // Strong.Optional — empty-initialised
    pub write_in_progress: bool,
    pub pending_close: bool,
    pub pending_reset: bool,
    pub closed: bool,
    pub task: WorkPoolTask,
}

// `const impl = CompressionStream(@This())` — Zig mixin that provides
// write / runFromJSThread / writeSync / reset / close / setOnError /
// getOnError / finalize / emitError. In Rust this is a generic trait impl:
impl<'a> CompressionStream for NativeBrotli<'a> {}
// TODO(port): CompressionStream trait surface (see node_zlib_binding.rs).

impl<'a> NativeBrotli<'a> {
    #[bun_jsc::host_fn]
    pub fn constructor(
        global_this: &'a JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<Self>> {
        let arguments = callframe.arguments_undef::<1>();

        let mode = arguments[0];
        if !mode.is_number() {
            return global_this.throw_invalid_argument_type_value("mode", "number", mode);
        }
        let mode_double = mode.as_number();
        if mode_double % 1.0 != 0.0 {
            return global_this.throw_invalid_argument_type_value("mode", "integer", mode);
        }
        let mode_int: i64 = mode_double as i64;
        if mode_int < 8 || mode_int > 9 {
            return global_this.throw_range_error(mode_int, "mode", 8, 9);
            // TODO(port): RangeErrorOptions { field_name, min, max } shape
        }

        let mut ptr = Box::new(Self {
            ref_count: Cell::new(1),
            global_this,
            stream: Context::default(),
            write_result: None,
            poll_ref: CountedKeepAlive::default(),
            this_value: Strong::empty(),
            write_in_progress: false,
            pending_close: false,
            pending_reset: false,
            closed: false,
            task: WorkPoolTask::default(), // .callback = undefined
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
        if arguments.len() != 3 {
            return global_this
                .err(ErrorCode::MISSING_ARGS, "init(params, writeResult, writeCallback)")
                .throw();
            // TODO(port): globalThis.ERR(.MISSING_ARGS, fmt, args) macro shape
        }

        // this does not get gc'd because it is stored in the JS object's
        // `this._writeState`. and the JS object is tied to the native handle
        // as `_handle[owner_symbol]`.
        let write_result = arguments[1]
            .as_array_buffer(global_this)
            .unwrap()
            .as_u32()
            .as_mut_ptr();
        let write_callback =
            validators::validate_function(global_this, "writeCallback", arguments[2])?;

        this.write_result = NonNull::new(write_result);

        js::write_callback_set_cached(
            this_value,
            global_this,
            write_callback.with_async_context_if_needed(global_this),
        );

        let mut err = this.stream.init();
        if err.is_error() {
            <Self as CompressionStream>::emit_error(this, global_this, this_value, err);
            return Ok(JSValue::FALSE);
        }

        let params_ = arguments[0].as_array_buffer(global_this).unwrap().as_u32();

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
        self.this_value = Strong::empty();
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
            flush: Op::Process,
            // SAFETY: all-zero is a valid LastResult (c_int 0 / enum 0).
            last_result: unsafe { core::mem::zeroed() },
            error_: c::BrotliDecoderErrorCode2::NO_ERROR,
        }
    }
}

use bun_brotli::c;
type Op = c::BrotliEncoderOperation;
// TODO(port): exact path — Zig: bun.brotli.c.BrotliEncoder.Operation

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
                        "Could not initialize Brotli instance",
                        -1,
                        "ERR_ZLIB_INITIALIZATION_FAILED",
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
                        "Could not initialize Brotli instance",
                        -1,
                        "ERR_ZLIB_INITIALIZATION_FAILED",
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
                        "Setting parameter failed",
                        -1,
                        "ERR_BROTLI_PARAM_SET_FAILED",
                    );
                }
                Error::ok()
            }
            bun_zlib::NodeMode::BROTLI_DECODE => {
                // SAFETY: state was created by BrotliDecoderCreateInstance.
                if unsafe { c::BrotliDecoderSetParameter(self.state_ptr().cast(), key, value) } == 0
                {
                    return Error::init(
                        "Setting parameter failed",
                        -1,
                        "ERR_BROTLI_PARAM_SET_FAILED",
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
                if unsafe { self.last_result.d } == c::BrotliDecoderResult::Error {
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
                        "Compression failed",
                        -1,
                        "ERR_BROTLI_COMPRESSION_FAILED",
                    );
                }
                Error::ok()
            }
            bun_zlib::NodeMode::BROTLI_DECODE => {
                if self.error_ != c::BrotliDecoderErrorCode2::NO_ERROR {
                    return Error::init(
                        "Decompression failed",
                        self.error_ as i32,
                        code_for_error(self.error_),
                    );
                } else if self.flush == Op::Finish
                    // SAFETY: d is the active field after a decode do_work().
                    && unsafe { self.last_result.d } == c::BrotliDecoderResult::NeedsMoreInput
                {
                    return Error::init(
                        "unexpected end of file",
                        bun_zlib::ReturnCode::BufError as i32,
                        "Z_BUF_ERROR",
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

fn code_for_error(err: c::BrotliDecoderErrorCode2) -> &'static ZStr {
    // Zig: `inline for (std.meta.fieldNames(E), std.enums.values(E)) |n, v|
    //          if (err == v) return "ERR_BROTLI_DECODER_" ++ n;`
    // TODO(port): comptime reflection over enum variants. Generate a static
    // match (or phf table) in bun_brotli mapping each BrotliDecoderErrorCode2
    // variant to const_format::concatcp!("ERR_BROTLI_DECODER_", name, "\0").
    let _ = err;
    unreachable!("ERR_BROTLI_DECODER_* table not yet generated")
}

// Codegen accessor namespace (JSNativeBrotli generated bindings).
// TODO(port): generated by `src/codegen/generate-classes.ts`; Phase B wires this.
mod js {
    use bun_jsc::{JSGlobalObject, JSValue};
    pub fn write_callback_set_cached(
        _this_value: JSValue,
        _global: &JSGlobalObject,
        _cb: JSValue,
    ) {
        // generated: JSNativeBrotli.writeCallbackSetCached
    }
}

// TODO(port): ErrorCode enum location (globalThis.ERR namespace).
use bun_jsc::ErrorCode;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/zlib/NativeBrotli.zig (282 lines)
//   confidence: medium
//   todos:      10
//   notes:      CompressionStream mixin → trait impl; code_for_error needs generated static table; brotli C fn signatures/enum reprs need verification in bun_brotli
// ──────────────────────────────────────────────────────────────────────────

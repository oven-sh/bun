use core::cell::Cell;

use bun_jsc::any_task_job::{AnyTaskJob, AnyTaskJobCtx};
use bun_jsc::{
    CallFrame, JSGlobalObject, JSPromiseStrong, JSUint8Array, JSValue, JsCell, JsResult,
    StringJsc as _, Strong,
};
use bun_zlib::NodeMode;

use crate::node::node_zlib_binding::{CompressionContext, Error};

bun_output::declare_scope!(CompressionStreamTransformer, hidden);

/// Streaming compression/decompression engine for `CompressionStream` /
/// `DecompressionStream`. One zlib/brotli/zstd context driven on the JS thread
/// for small chunks, or on a work-pool worker for large ones via
/// `transformAsync` — the builtins call `transform`/`transformAsync` per chunk
/// with no node:zlib stream object, Duplex machinery, or per-16KB threadpool
/// round-trips behind it.
pub(crate) enum Engine {
    Zlib(crate::node::native_zlib_impl::Context),
    Brotli(crate::node::native_brotli_impl::Context),
    Zstd(crate::node::native_zstd_impl::Context),
    /// Context released (explicit `close()` or post-flush teardown).
    Closed,
}

impl Engine {
    fn ctx(&mut self) -> Option<&mut dyn CompressionContext> {
        match self {
            Engine::Zlib(ctx) => Some(ctx),
            Engine::Brotli(ctx) => Some(ctx),
            Engine::Zstd(ctx) => Some(ctx),
            Engine::Closed => None,
        }
    }

    fn finish_flush(&self) -> i32 {
        match self {
            // Z_FINISH
            Engine::Zlib(_) => 4,
            // BROTLI_OPERATION_FINISH / ZSTD_e_end
            Engine::Brotli(_) | Engine::Zstd(_) => 2,
            Engine::Closed => 0,
        }
    }

    fn close(&mut self) {
        if let Some(ctx) = self.ctx() {
            ctx.close();
        }
        // The replaced variant drops only its Rust-side fields (e.g. the
        // zlib dictionary Vec) — the C state was just released above, and
        // Engine deliberately has no Drop impl so this assignment cannot
        // double-close it.
        *self = Engine::Closed;
    }
}

impl Drop for CompressionStreamTransformer {
    fn drop(&mut self) {
        // GC'd without flush/cancel (stream abandoned) — release the native
        // context here instead of leaking it. Idempotent for explicitly
        // closed engines.
        self.engine.with_mut(Engine::close);
    }
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; the
// engine lives in a `JsCell` and no JS is invoked while it is borrowed.
#[bun_jsc::JsClass]
pub struct CompressionStreamTransformer {
    engine: JsCell<Engine>,
    /// Set while an `AsyncTransformCtx` is in flight on the work pool.
    /// Serializes engine access between the JS thread and the worker — same
    /// pattern as `NativeZlib::write_in_progress`. The TransformStream gates
    /// the next write on the returned promise, so a second
    /// `transform`/`transformAsync` while set is misuse and throws.
    write_in_progress: Cell<bool>,
    /// `close()` was called while an async transform was in flight; the
    /// engine is closed in `then()` once the worker returns.
    pending_close: Cell<bool>,
    /// Per-mode native context footprint, fixed at construction. Kept outside
    /// the `JsCell`: `estimated_size` runs on the GC marking thread, which
    /// must not touch the JS-thread-owned cell.
    context_size: usize,
}

/// node:zlib's Z_DEFAULT_CHUNK — the per-output-buffer granularity.
const CHUNK: usize = 16384;

/// The processChunkSync loop from node:zlib: run the context until it stops
/// filling the output window. Pure native — no JS is touched, so it is safe to
/// call off the JS thread once `write_in_progress` guarantees exclusive access
/// to the engine.
fn drive_loop(engine: &mut Engine, input: &[u8], is_finish: bool) -> Result<Vec<Box<[u8]>>, Error> {
    let finish_flush = engine.finish_flush();
    let Some(ctx) = engine.ctx() else {
        return Err(Error::init(
            c"transform after close".as_ptr(),
            -1,
            c"ERR_INVALID_STATE".as_ptr(),
        ));
    };
    let flush = if is_finish { finish_flush } else { 0 };

    let mut input: &[u8] = input;
    let mut outputs: Vec<Box<[u8]>> = Vec::new();

    // avail_out == 0 means more output is pending (regardless of input);
    // avail_out > 0 means the engine consumed the input it was given and
    // drained its output.
    loop {
        // The engine counters are u32, but the chunk length is user
        // controlled and JSC allows >4GiB typed arrays on 64-bit:
        // feed at most one u32 window per iteration instead of
        // overflowing the casts.
        let window_len = input.len().min(u32::MAX as usize);
        let window = &input[..window_len];

        // Zero-initialized so the window handed to the C engine is
        // fully defined; full windows are adopted as-is below with no
        // copy (len == capacity).
        let mut out_vec = vec![0u8; CHUNK];
        ctx.set_buffers(Some(window), Some(&mut out_vec));
        ctx.set_flush(flush);
        ctx.do_work();

        #[expect(clippy::cast_possible_truncation)] // window_len <= u32::MAX
        let mut avail_in = window_len as u32;
        let mut avail_out = u32::try_from(CHUNK).expect("constant");
        ctx.update_write_result(&mut avail_in, &mut avail_out);
        let err = ctx.get_error_info();
        if err.is_error() {
            return Err(err);
        }

        let written = CHUNK - avail_out as usize;
        if written == CHUNK {
            outputs.push(out_vec.into());
        } else if written > 0 {
            outputs.push(out_vec[..written].into());
        }

        let consumed = window_len - avail_in as usize;
        input = &input[consumed..];

        if avail_out == 0 || (avail_in == 0 && !input.is_empty()) {
            // Output window exhausted before the engine finished, or
            // the engine consumed the whole u32 window and input it
            // has not seen remains past it — keep driving. If the
            // engine instead stopped mid-window with spare output, it
            // reached stream end: node's drive loop ends the stream
            // there and discards the trailing bytes (lib/zlib.js
            // processCallback), and re-feeding them would spin
            // forever on input the engine refuses to consume.
            continue;
        }
        break;
    }

    Ok(outputs)
}

fn build_outputs_array(global: &JSGlobalObject, outputs: Vec<Box<[u8]>>) -> JsResult<JSValue> {
    JSValue::create_array_from_iter(global, outputs.into_iter(), |bytes| {
        // `from_bytes` reaches `JSC::JSUint8Array::create`, which opens a
        // throw scope (allocation can throw). Observe the exception here,
        // before `put_index` opens the next scope — same pattern as
        // `BunString::to_jsdomurl`.
        bun_jsc::from_js_host_call(global, || JSUint8Array::from_bytes(global, bytes))
    })
}

/// `AnyTaskJob` payload for `transformAsync`: copies the input bytes, runs the
/// drive loop on the work pool against the transformer's in-place engine
/// (the zlib `z_stream` is self-referential and must not move), and `then`
/// settles the promise with the same `Array<Uint8Array>` shape as the
/// synchronous path.
struct AsyncTransformCtx {
    /// Roots the JS wrapper so `transformer` stays live until `then`.
    _this_value: Strong,
    transformer: *const CompressionStreamTransformer,
    input: Box<[u8]>,
    is_finish: bool,
    promise: JSPromiseStrong,
    result: Result<Vec<Box<[u8]>>, Error>,
}

// SAFETY: `run` is the only off-thread access; it touches the engine through
// `transformer` while `write_in_progress` guarantees the JS thread does not.
// The C engine state is thread-agnostic; the JS-tied fields (`this_value`,
// `promise`) are not touched until `then` on the JS thread.
unsafe impl Send for AsyncTransformCtx {}

impl AnyTaskJobCtx for AsyncTransformCtx {
    fn run(&mut self, _global: *mut JSGlobalObject) {
        // SAFETY: `this_value` roots the JS wrapper, which owns
        // `*transformer`; `write_in_progress` is the only access to the
        // engine cell while set, so the worker's borrow is exclusive — same
        // pattern as `CompressionStream::<T>::async_job_run_task`.
        let transformer = unsafe { &*self.transformer };
        self.result = transformer
            .engine
            .with_mut(|engine| drive_loop(engine, &self.input, self.is_finish));
    }

    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        // SAFETY: as in `run`; `then` runs on the JS thread.
        let transformer = unsafe { &*self.transformer };
        transformer.write_in_progress.set(false);
        if transformer.pending_close.replace(false) {
            transformer.engine.with_mut(Engine::close);
        }

        let result = core::mem::replace(&mut self.result, Ok(Vec::new()));
        match result {
            Ok(outputs) => {
                let array = build_outputs_array(global, outputs)?;
                self.promise.resolve(global, array)?;
            }
            Err(err) => {
                let error = build_engine_error(global, err);
                self.promise.reject(global, Ok(error))?;
            }
        }
        Ok(())
    }
}

impl CompressionStreamTransformer {
    /// Native context footprint for the GC, mirroring the per-mode constants
    /// the `NativeZlib`/`NativeBrotli`/`NativeZstd` handles report.
    /// Called from any thread (concurrent GC marking).
    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<Self>() + self.context_size
    }

    fn check_not_in_flight(&self, global: &JSGlobalObject) -> JsResult<()> {
        if self.write_in_progress.get() {
            return Err(throw_engine_error(
                global,
                Error::init(
                    c"transform already in progress".as_ptr(),
                    -1,
                    c"ERR_INVALID_STATE".as_ptr(),
                ),
            ));
        }
        Ok(())
    }

    // PORT NOTE: no `#[bun_jsc::host_fn]` — the `#[bun_jsc::JsClass]` derive
    // already emits the construct shim that calls `<Self>::constructor`.
    pub(crate) fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Self>> {
        let [mode_value] = frame.arguments_as_array::<1>();
        if !mode_value.is_number() {
            return Err(global.throw_invalid_argument_type_value("mode", "number", mode_value));
        }
        let mode_double = mode_value.as_number();
        if mode_double % 1.0 != 0.0 || !(1.0..=11.0).contains(&mode_double) {
            return Err(global.throw_invalid_argument_type_value("mode", "integer", mode_value));
        }
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let mode = NodeMode::from_int(mode_double as u8);

        let context_size: usize = match mode {
            // deflate internal_state @ cloudflare/zlib (see NativeZlib)
            NodeMode::DEFLATE
            | NodeMode::INFLATE
            | NodeMode::GZIP
            | NodeMode::GUNZIP
            | NodeMode::DEFLATERAW
            | NodeMode::INFLATERAW
            | NodeMode::UNZIP => 3309,
            NodeMode::BROTLI_ENCODE => 5143, // sizeof(BrotliEncoderStateStruct)
            NodeMode::BROTLI_DECODE => 855,  // sizeof(BrotliDecoderStateStruct)
            NodeMode::ZSTD_COMPRESS => 5272, // ZSTD_sizeof_CCtx estimate
            NodeMode::ZSTD_DECOMPRESS => 95968, // ZSTD_sizeof_DCtx estimate
            NodeMode::NONE => unreachable!("range-checked above"),
        };

        let engine = match mode {
            NodeMode::DEFLATE
            | NodeMode::INFLATE
            | NodeMode::GZIP
            | NodeMode::GUNZIP
            | NodeMode::DEFLATERAW
            | NodeMode::INFLATERAW
            | NodeMode::UNZIP => Engine::Zlib(crate::node::native_zlib_impl::Context {
                mode,
                ..Default::default()
            }),
            NodeMode::BROTLI_ENCODE | NodeMode::BROTLI_DECODE => {
                Engine::Brotli(crate::node::native_brotli_impl::Context {
                    mode,
                    ..Default::default()
                })
            }
            NodeMode::ZSTD_COMPRESS | NodeMode::ZSTD_DECOMPRESS => {
                Engine::Zstd(crate::node::native_zstd_impl::Context {
                    mode,
                    ..Default::default()
                })
            }
            NodeMode::NONE => unreachable!("range-checked above"),
        };

        // Initialize only after the engine reaches its final heap address:
        // zlib's z_stream is self-referential (deflateInit stores a
        // state→strm back-pointer), so init-then-move leaves the stream
        // "inconsistent" and every subsequent call fails with
        // Z_STREAM_ERROR. node:zlib has the same invariant — its handles
        // init() as a separate call on the already-boxed object.
        let transformer = Box::new(CompressionStreamTransformer {
            engine: JsCell::new(engine),
            write_in_progress: Cell::new(false),
            pending_close: Cell::new(false),
            context_size,
        });
        let err = transformer.engine.with_mut(|engine| {
            let err = match engine {
                Engine::Zlib(ctx) => {
                    // node:zlib defaults (zlib.ts): level Z_DEFAULT_COMPRESSION,
                    // windowBits 15, memLevel 8, strategy Z_DEFAULT_STRATEGY —
                    // CompressionStream exposes no options, so output bytes
                    // match the previous node:zlib-backed implementation.
                    ctx.init(-1, 15, 8, 0, None);
                    if ctx.mode == NodeMode::NONE {
                        Error::init(
                            c"Failed to initialize zlib stream".as_ptr(),
                            -1,
                            c"ERR_ZLIB_INITIALIZATION_FAILED".as_ptr(),
                        )
                    } else {
                        Error::OK
                    }
                }
                Engine::Brotli(ctx) => ctx.init(),
                // ZSTD_CONTENTSIZE_UNKNOWN — same as node:zlib with no
                // pledgedSrcSize option.
                Engine::Zstd(ctx) => ctx.init(u64::MAX),
                Engine::Closed => unreachable!("just constructed"),
            };
            if err.is_error() {
                // An init-failed brotli/zstd context has `state: None`, and
                // their `close()` doesn't tolerate that (brotli unwraps,
                // zstd calls reset on null). Transition to Closed so the
                // Drop this error-return is about to trigger is a no-op.
                *engine = Engine::Closed;
            }
            err
        });
        if err.is_error() {
            return Err(throw_engine_error(global, err));
        }

        Ok(transformer)
    }

    /// `transform(chunk, isFinish)` — run the full consume-input /
    /// produce-output loop for one stream chunk and return a JS `Array` of
    /// `Uint8Array`s, each its own exact-size allocation adopted without
    /// copying. `isFinish` selects the family's finish operation (zlib
    /// `Z_FINISH`, brotli `BROTLI_OPERATION_FINISH`, zstd `ZSTD_e_end`) for
    /// the stream-end drain. Engine errors throw synchronously carrying
    /// `message`/`code`/`errno`; the context stays open — the stream
    /// teardown path (`cancel`/`close`) releases it.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn transform(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if frame.arguments_count() < 2 {
            return Err(global.throw_value(
                bun_core::String::static_(b"transform(chunk, isFinish)").to_error_instance(global),
            ));
        }
        let [chunk_value, is_finish_value] = frame.arguments_as_array::<2>();

        let Some(in_buf) = chunk_value.as_array_buffer(global) else {
            return Err(global.throw_invalid_argument_type_value(
                "chunk",
                "TypedArray or DataView",
                chunk_value,
            ));
        };
        let is_finish = is_finish_value.to_boolean();

        self.check_not_in_flight(global)?;

        // No JS runs while the engine is borrowed: the whole drive is pure
        // native work; the output `Uint8Array`s and any error object are
        // built after the borrow ends.
        // `byte_slice` views the JS-owned backing store rooted via the
        // argument value on the call stack.
        let result = self
            .engine
            .with_mut(|engine| drive_loop(engine, in_buf.byte_slice(), is_finish));

        match result {
            Ok(outputs) => build_outputs_array(global, outputs),
            Err(err) => Err(throw_engine_error(global, err)),
        }
    }

    /// `transformAsync(chunk, isFinish)` — same loop as `transform`, run on the
    /// work pool. The input bytes are copied (the JS buffer is not pinned), the
    /// engine stays in place (it is self-referential and must not move), and
    /// the returned Promise resolves with the same `Array<Uint8Array>` shape
    /// (or rejects carrying `message`/`code`/`errno`). The TransformStream
    /// gates the next write on this promise, so at most one job is in flight
    /// per transformer.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn transform_async(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if frame.arguments_count() < 2 {
            return Err(global.throw_value(
                bun_core::String::static_(b"transformAsync(chunk, isFinish)")
                    .to_error_instance(global),
            ));
        }
        let [chunk_value, is_finish_value] = frame.arguments_as_array::<2>();

        let Some(in_buf) = chunk_value.as_array_buffer(global) else {
            return Err(global.throw_invalid_argument_type_value(
                "chunk",
                "TypedArray or DataView",
                chunk_value,
            ));
        };
        let is_finish = is_finish_value.to_boolean();

        self.check_not_in_flight(global)?;
        self.write_in_progress.set(true);

        let promise = JSPromiseStrong::init(global);
        let promise_value = promise.value();

        let ctx = AsyncTransformCtx {
            _this_value: Strong::create(frame.this(), global),
            transformer: core::ptr::from_ref(self),
            input: Box::from(in_buf.byte_slice()),
            is_finish,
            promise,
            result: Ok(Vec::new()),
        };

        match AnyTaskJob::create(global, ctx) {
            Ok(job) => {
                // SAFETY: `job` is the freshly-created live pointer.
                unsafe { AnyTaskJob::schedule(job) };
                Ok(promise_value)
            }
            Err(e) => {
                self.write_in_progress.set(false);
                Err(e)
            }
        }
    }

    /// Release the native context. Deferred when an async transform is in
    /// flight (the returning `then()` closes it); otherwise idempotent.
    /// Later `transform`/`transformAsync` calls throw.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn close(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if self.write_in_progress.get() {
            self.pending_close.set(true);
        } else {
            self.engine.with_mut(Engine::close);
        }
        Ok(JSValue::UNDEFINED)
    }
}

/// Build a JS `Error` carrying the engine's `message`/`code`/`errno` (the
/// node:zlib error triple).
fn build_engine_error(global: &JSGlobalObject, err: Error) -> JSValue {
    let msg_bytes: &[u8] = if err.msg.is_null() {
        b"Zlib error"
    } else {
        // SAFETY: non-null `Error::msg` points at a NUL-terminated C string
        // (static literal or zlib/zstd-owned buffer valid for this call).
        unsafe { bun_core::ffi::cstr(err.msg) }.to_bytes()
    };
    let error_value = bun_core::String::clone_utf8(msg_bytes).to_error_instance(global);

    if !err.code.is_null() {
        // SAFETY: same contract as `msg` above.
        let code_bytes = unsafe { bun_core::ffi::cstr(err.code) }.to_bytes();
        if let Ok(code_value) = bun_core::String::clone_utf8(code_bytes).to_js(global) {
            error_value.put(global, b"code", code_value);
        }
    }
    error_value.put(global, b"errno", JSValue::js_number(f64::from(err.err)));

    error_value
}

fn throw_engine_error(global: &JSGlobalObject, err: Error) -> bun_jsc::JsError {
    global.throw_value(build_engine_error(global, err))
}

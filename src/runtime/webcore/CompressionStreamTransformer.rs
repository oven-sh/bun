use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsCell, JsResult, StringJsc as _};
use bun_zlib::NodeMode;

use crate::node::node_zlib_binding::{CompressionContext, Error};

bun_output::declare_scope!(CompressionStreamTransformer, hidden);

/// Streaming compression/decompression engine for `CompressionStream` /
/// `DecompressionStream`. One zlib/brotli/zstd context driven synchronously
/// on the JS thread — the builtins call `write` per chunk with the same
/// argument shape as node:zlib's `writeSync`, but with no node:zlib stream
/// object, Duplex machinery, or threadpool round-trips behind it.
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
}

impl CompressionStreamTransformer {
    // PORT NOTE: no `#[bun_jsc::host_fn]` — the `#[bun_jsc::JsClass]` derive
    // already emits the construct shim that calls `<Self>::constructor`.
    pub(crate) fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Self>> {
        let arguments = frame.arguments_undef::<1>();
        let mode_value = arguments.ptr[0];
        if !mode_value.is_number() {
            return Err(global.throw_invalid_argument_type_value("mode", "number", mode_value));
        }
        let mode_double = mode_value.as_number();
        if mode_double % 1.0 != 0.0 || !(1.0..=11.0).contains(&mode_double) {
            return Err(global.throw_invalid_argument_type_value("mode", "integer", mode_value));
        }
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let mode = NodeMode::from_int(mode_double as u8);

        let engine = match mode {
            NodeMode::DEFLATE
            | NodeMode::INFLATE
            | NodeMode::GZIP
            | NodeMode::GUNZIP
            | NodeMode::DEFLATERAW
            | NodeMode::INFLATERAW
            | NodeMode::UNZIP => {
                let mut ctx = crate::node::native_zlib_impl::Context::default();
                ctx.mode = mode;
                Engine::Zlib(ctx)
            }
            NodeMode::BROTLI_ENCODE | NodeMode::BROTLI_DECODE => {
                let mut ctx = crate::node::native_brotli_impl::Context::default();
                ctx.mode = mode;
                Engine::Brotli(ctx)
            }
            NodeMode::ZSTD_COMPRESS | NodeMode::ZSTD_DECOMPRESS => {
                let mut ctx = crate::node::native_zstd_impl::Context::default();
                ctx.mode = mode;
                Engine::Zstd(ctx)
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
        });
        let err = transformer.engine.with_mut(|engine| match engine {
            Engine::Zlib(ctx) => {
                // node:zlib defaults (zlib.ts): level Z_DEFAULT_COMPRESSION,
                // windowBits 15, memLevel 8, strategy Z_DEFAULT_STRATEGY —
                // CompressionStream exposes no options, so output bytes match
                // the previous node:zlib-backed implementation.
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
        /// node:zlib's Z_DEFAULT_CHUNK — the per-output-buffer granularity.
        const CHUNK: usize = 16384;

        let args = frame.arguments_undef::<2>();
        let arguments = args.slice();
        if arguments.len() != 2 {
            return Err(global.throw_value(
                bun_core::String::static_(b"transform(chunk, isFinish)").to_error_instance(global),
            ));
        }

        let Some(in_buf) = arguments[0].as_array_buffer(global) else {
            return Err(global.throw_invalid_argument_type_value(
                "chunk",
                "TypedArray or DataView",
                arguments[0],
            ));
        };
        let is_finish = arguments[1].to_boolean();

        // No JS runs while the engine is borrowed: the whole drive is pure
        // native work; the output `Uint8Array`s and any error object are
        // built after the borrow ends.
        let result: Result<Vec<Box<[u8]>>, Error> = self.engine.with_mut(|engine| {
            let finish_flush: i32 = match engine {
                // Z_FINISH
                Engine::Zlib(_) => 4,
                // BROTLI_OPERATION_FINISH / ZSTD_e_end
                Engine::Brotli(_) | Engine::Zstd(_) => 2,
                Engine::Closed => 0,
            };
            let Some(ctx) = engine.ctx() else {
                return Err(Error::init(
                    c"transform after close".as_ptr(),
                    -1,
                    c"ERR_INVALID_STATE".as_ptr(),
                ));
            };
            let flush = if is_finish { finish_flush } else { 0 };

            // `byte_slice` views the JS-owned backing store rooted via the
            // argument value on the call stack.
            let mut input: &[u8] = in_buf.byte_slice();
            let mut outputs: Vec<Box<[u8]>> = Vec::new();

            // The processChunkSync loop from node:zlib: run the context until
            // it stops filling the output window — avail_out == 0 means more
            // output is pending (regardless of input), avail_out > 0 means
            // the engine consumed the input and drained its output.
            loop {
                // Zero-initialized so the window handed to the C engine is
                // fully defined; full windows are adopted as-is below with no
                // copy (len == capacity).
                let mut out_vec = vec![0u8; CHUNK];
                ctx.set_buffers(Some(input), Some(&mut out_vec));
                ctx.set_flush(flush);
                ctx.do_work();

                let mut avail_in = u32::try_from(input.len()).expect("chunk fits u32");
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

                let consumed = input.len() - avail_in as usize;
                input = &input[consumed..];

                if avail_out == 0 {
                    // Output window exhausted before the engine finished —
                    // keep draining (input may already be empty).
                    continue;
                }
                break;
            }

            Ok(outputs)
        });

        let outputs = match result {
            Ok(outputs) => outputs,
            Err(err) => return Err(throw_engine_error(global, err)),
        };

        JSValue::create_array_from_iter(global, outputs.into_iter(), |bytes| {
            Ok(JSUint8Array::from_bytes(global, bytes))
        })
    }

    /// Release the native context. Idempotent; later `transform` calls throw.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn close(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        self.engine.with_mut(Engine::close);
        Ok(JSValue::UNDEFINED)
    }
}

/// Build a JS `Error` carrying the engine's `message`/`code`/`errno` (the
/// node:zlib error triple) and throw it.
fn throw_engine_error(global: &JSGlobalObject, err: Error) -> bun_jsc::JsError {
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

    global.throw_value(error_value)
}

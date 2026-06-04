use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsResult, StringJsc as _};
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
    pub(crate) fn constructor(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<Box<Self>> {
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

    /// `write(flush, in, inOff, inLen, out, outOff, outLen, state)` — the
    /// node:zlib `writeSync` argument shape plus the `Uint32Array(2)` result
    /// state as a trailing argument (node caches it on the handle at init
    /// time instead). Runs the context synchronously and stores
    /// `[availOut, availIn]` into `state`. Errors throw synchronously.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn write(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let args = frame.arguments_undef::<8>();
        let arguments = args.slice();
        if arguments.len() != 8 {
            return Err(global.throw_value(
                bun_core::String::static_(
                    b"write(flush, in, in_off, in_len, out, out_off, out_len, state)",
                )
                .to_error_instance(global),
            ));
        }

        // Internal callers ($createCompressionTransform) always pass plain
        // number arguments; mirror node_zlib_binding's `jsv_to_u32` casts.
        #[expect(clippy::cast_possible_truncation)]
        let flush = arguments[0].as_number() as i32;

        let Some(in_buf) = arguments[1].as_array_buffer(global) else {
            return Err(global.throw_invalid_argument_type_value(
                "in",
                "TypedArray or DataView",
                arguments[1],
            ));
        };
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let in_off = arguments[2].as_number() as u32 as usize;
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let in_len = arguments[3].as_number() as u32 as usize;
        if in_buf.byte_len < in_off + in_len {
            return Err(global.throw_invalid_argument_type_value(
                "in_len",
                "within input bounds",
                arguments[3],
            ));
        }

        let Some(mut out_buf) = arguments[4].as_array_buffer(global) else {
            return Err(global.throw_invalid_argument_type_value(
                "out",
                "TypedArray or DataView",
                arguments[4],
            ));
        };
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let out_off = arguments[5].as_number() as u32 as usize;
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let out_len = arguments[6].as_number() as u32 as usize;
        if out_buf.byte_len < out_off + out_len {
            return Err(global.throw_invalid_argument_type_value(
                "out_len",
                "within output bounds",
                arguments[6],
            ));
        }

        let state_value = arguments[7];
        let Some(mut state_buf) = state_value.as_array_buffer(global) else {
            return Err(global.throw_invalid_argument_type_value(
                "state",
                "Uint32Array",
                state_value,
            ));
        };
        if state_buf.typed_array_type != bun_jsc::JSType::Uint32Array
            || state_buf.as_u32().len() < 2
        {
            return Err(global.throw_invalid_argument_type_value(
                "state",
                "Uint32Array with at least 2 elements",
                state_value,
            ));
        }

        let mut avail_in = u32::try_from(in_len).expect("bounds-checked above");
        let mut avail_out = u32::try_from(out_len).expect("bounds-checked above");

        // No JS runs while the engine is borrowed: the whole drive is pure
        // native work, and the error object is built after the borrow ends.
        let result: Result<(), Error> = self.engine.with_mut(|engine| {
            let Some(ctx) = engine.ctx() else {
                return Err(Error::init(
                    c"write after close".as_ptr(),
                    -1,
                    c"ERR_INVALID_STATE".as_ptr(),
                ));
            };
            // Bounds checked above; `byte_slice` accessors view the JS-owned
            // backing stores rooted via the argument values on the call stack.
            let in_ = &in_buf.byte_slice()[in_off..in_off + in_len];
            let out = &mut out_buf.byte_slice_mut()[out_off..out_off + out_len];
            ctx.set_buffers(Some(in_), Some(out));
            ctx.set_flush(flush);
            ctx.do_work();
            ctx.update_write_result(&mut avail_in, &mut avail_out);
            let err = ctx.get_error_info();
            if err.is_error() {
                // A failed write leaves the context in an undefined state —
                // release it now (mirrors node's zlibOnError destroying the
                // engine) so a buggy caller loops on ERR_INVALID_STATE
                // instead of corrupt native state.
                engine.close();
                return Err(err);
            }
            Ok(())
        });

        if let Err(err) = result {
            return Err(throw_engine_error(global, err));
        }

        let state = state_buf.as_u32();
        state[0] = avail_out;
        state[1] = avail_in;

        Ok(JSValue::UNDEFINED)
    }

    /// Release the native context. Idempotent; later `write` calls throw.
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

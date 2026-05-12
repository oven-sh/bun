use core::ffi::{c_char, c_int};
use core::mem;

use bun_zlib as c; // bun.zlib — C zlib FFI (NodeMode, z_stream, ReturnCode, FlushValue, deflate*, inflate*)

use crate::node::node_zlib_binding::Error;

// ─── gated: JsClass payload + host fns ────────────────────────────────────
// `NativeZlib` carries `#[bun_jsc::JsClass]` and its methods are
// `#[bun_jsc::host_fn]`s; field types (`Strong`, `WorkPoolTask`) are not yet
// exported with the expected shapes. The pure-FFI `Context` (zlib state
// machine) is hoisted below as the non-JSC body.
// TODO(b2-blocked): un-gate once bun_jsc Strong/JsClass + bun_threading::WorkPoolTask land.

mod _impl {
    use super::*;
    use core::cell::Cell;

    use bun_jsc::{
        CallFrame, JSGlobalObject, JSValue, JsCell, JsResult, StrongOptional, WorkPoolTask,
    };

    use crate::node::node_zlib_binding::{CompressionStream, CountedKeepAlive};
    use crate::node::util::validators;

    /// Placeholder for `WorkPoolTask.callback` — overwritten before scheduling
    /// (see `CompressionStream::write` in node_zlib_binding.rs). Zig: `.callback = undefined`.
    /// Safe fn: coerces to the `WorkPoolTask.callback` field type at the
    /// struct-init site; the body never dereferences the pointer.
    fn noop_task_callback(_task: *mut WorkPoolTask) {}

    // `mod js { write_callback_*, error_callback_*, dictionary_* }` is emitted by
    // `__impl_compression_stream!` below (wraps `bun_jsc::codegen_cached_accessors!`).

    /// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive single-thread refcount.
    /// `ref`/`deref` are provided by `bun_ptr::IntrusiveRc<NativeZlib>`; when the count hits
    /// zero it invokes [`NativeZlib::deinit`].
    #[bun_jsc::JsClass]
    #[derive(bun_ptr::CellRefCounted)]
    #[ref_count(destroy = Self::deinit)]
    pub struct NativeZlib {
        pub ref_count: Cell<u32>,
        // JSC_BORROW backref; global outlives this m_ctx payload. `BackRef`
        // centralises the single unsafe deref so the trait impl is safe.
        pub global_this: bun_ptr::BackRef<JSGlobalObject>,
        pub stream: JsCell<Context>,
        pub write_result: Cell<Option<*mut u32>>,
        pub poll_ref: JsCell<CountedKeepAlive>,
        pub this_value: JsCell<StrongOptional>, // jsc.Strong.Optional
        pub write_in_progress: Cell<bool>,
        pub pending_close: Cell<bool>,
        pub pending_reset: Cell<bool>,
        pub closed: Cell<bool>,
        pub task: JsCell<WorkPoolTask>,
    }

    // `const impl = CompressionStream(@This())` — Zig comptime mixin that injects
    // write / runFromJSThread / writeSync / reset / close / setOnError / getOnError /
    // finalize onto this type. In Rust these are provided as inherent methods on
    // `CompressionStream::<NativeZlib>` in node_zlib_binding.rs (a generic mixin
    // struct, not a trait).
    // TODO(port): verify CompressionStream<T> surface matches the Zig mixin re-exports.

    impl NativeZlib {
        // NB: no `#[bun_jsc::host_fn]` here — the `#[bun_jsc::JsClass]` derive emits
        // the constructor shim that calls `<NativeZlib>::constructor(g, f)` directly.
        pub fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Self>> {
            let arguments = frame.arguments_undef::<4>();

            let mode = arguments.ptr[0];
            if !mode.is_number() {
                return Err(global.throw_invalid_argument_type_value("mode", "number", mode));
            }
            let mode_double = mode.as_number();
            if mode_double % 1.0 != 0.0 {
                return Err(global.throw_invalid_argument_type_value("mode", "integer", mode));
            }
            let mode_int: i64 = mode_double as i64;
            if mode_int < 1 || mode_int > 7 {
                return Err(global.throw_range_error(
                    mode_int,
                    bun_jsc::RangeErrorOptions {
                        field_name: b"mode",
                        min: 1,
                        max: 7,
                        msg: b"",
                    },
                ));
            }

            let mut stream = Context::default();
            stream.mode = c::NodeMode::from_int(mode_int as u8);
            Ok(Box::new(Self {
                ref_count: Cell::new(1),
                // JSC_BORROW backref — the global outlives this m_ctx payload.
                global_this: bun_ptr::BackRef::new(global),
                stream: JsCell::new(stream),
                write_result: Cell::new(None),
                poll_ref: JsCell::new(CountedKeepAlive::default()),
                this_value: JsCell::new(StrongOptional::empty()),
                write_in_progress: Cell::new(false),
                pending_close: Cell::new(false),
                pending_reset: Cell::new(false),
                closed: Cell::new(false),
                task: JsCell::new(WorkPoolTask {
                    node: Default::default(),
                    callback: noop_task_callback,
                }),
            }))
        }

        //// adding this didnt help much but leaving it here to compare the number with later
        pub fn estimated_size(&self) -> usize {
            // @sizeOf(@cImport(@cInclude("deflate.h")).internal_state) @ cloudflare/zlib @ 92530568d2c128b4432467b76a3b54d93d6350bd
            const INTERNAL_STATE_SIZE: usize = 3309;
            mem::size_of::<Self>() + INTERNAL_STATE_SIZE
        }

        #[bun_jsc::host_fn(method)]
        pub fn init(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
            let arguments = frame.arguments_undef::<7>();
            let this_value = frame.this();

            if arguments.len != 7 {
                return Err(global
                .err(
                    bun_jsc::ErrorCode::MISSING_ARGS,
                    format_args!(
                        "init(windowBits, level, memLevel, strategy, writeResult, writeCallback, dictionary)"
                    ),
                )
                .throw());
            }

            let window_bits =
                validators::validate_int32(global, arguments.ptr[0], "windowBits", None, None)?;
            let level = validators::validate_int32(global, arguments.ptr[1], "level", None, None)?;
            let mem_level =
                validators::validate_int32(global, arguments.ptr[2], "memLevel", None, None)?;
            let strategy =
                validators::validate_int32(global, arguments.ptr[3], "strategy", None, None)?;
            // this does not get gc'd because it is stored in the JS object's `this._writeState`. and the JS object is tied to the native handle as `_handle[owner_symbol]`.
            let write_result = arguments.ptr[4]
                .as_array_buffer(global)
                .unwrap()
                .as_u32()
                .as_mut_ptr();
            let write_callback =
                validators::validate_function(global, "writeCallback", arguments.ptr[5])?;
            // Bind the ArrayBuffer view to a local so the borrowed byte_slice() outlives
            // the call to `stream.init` below (E0716 otherwise).
            let dictionary_buf;
            let dictionary = if arguments.ptr[6].is_undefined() {
                None
            } else {
                dictionary_buf = arguments.ptr[6].as_array_buffer(global).unwrap();
                Some(dictionary_buf.byte_slice())
            };

            self.write_result.set(Some(write_result));
            js::write_callback_set_cached(
                this_value,
                global,
                write_callback.with_async_context_if_needed(global),
            );

            // Keep the dictionary alive by keeping a reference to it in the JS object.
            if dictionary.is_some() {
                js::dictionary_set_cached(this_value, global, arguments.ptr[6]);
            }

            self.stream
                .with_mut(|s| s.init(level, window_bits, mem_level, strategy, dictionary));

            Ok(JSValue::UNDEFINED)
        }

        #[bun_jsc::host_fn(method)]
        pub fn params(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
            let arguments = frame.arguments_undef::<2>();

            if arguments.len != 2 {
                return Err(global
                    .err(
                        bun_jsc::ErrorCode::MISSING_ARGS,
                        format_args!("params(level, strategy)"),
                    )
                    .throw());
            }

            let level = validators::validate_int32(global, arguments.ptr[0], "level", None, None)?;
            let strategy =
                validators::validate_int32(global, arguments.ptr[1], "strategy", None, None)?;

            let err = self.stream.with_mut(|s| s.set_params(level, strategy));
            if err.is_error() {
                // R-2: `&self` over `Cell`/`JsCell` fields — `emit_error` →
                // `run_callback` may re-enter `close()`/`reset()` via a fresh
                // `&Self` from `m_ctx`; interior mutability makes that sound.
                CompressionStream::<Self>::emit_error(self, global, frame.this(), err);
            }
            Ok(JSValue::UNDEFINED)
        }

        /// RefCount destroy callback. Invoked when `ref_count` reaches zero.
        /// Not `Drop` because this is an intrusive-refcounted `m_ctx` payload whose
        /// box is freed here (`bun.destroy(this)` in Zig).
        fn deinit(this: *mut Self) {
            // SAFETY: called exactly once by IntrusiveRc when refcount hits 0; `this`
            // is the heap::alloc pointer produced at construction. `this_value`
            // (Strong) and `poll_ref` (CountedKeepAlive) are Drop types — freed by
            // heap::take below.
            unsafe {
                (*this).stream.with_mut(|s| s.close());
                drop(bun_core::heap::take(this));
            }
        }
    }

    crate::__impl_compression_stream!(NativeZlib, super::Context, "NativeZlib");
    crate::__compression_stream_mixin_reexports!(NativeZlib);
} // mod _impl

pub use _impl::NativeZlib;

// ─── non-JSC body (real): zlib stream Context ─────────────────────────────

pub struct Context {
    pub mode: c::NodeMode,
    pub state: c::z_stream,
    pub err: c::ReturnCode,
    pub flush: c::FlushValue,
    // Borrows a JS ArrayBuffer kept alive via `js::dictionary_set_cached`
    // (BACKREF/FFI class) for the lifetime of the JS wrapper, which strictly
    // outlives this Context — `RawSlice` invariant. Default is `EMPTY`.
    pub dictionary: bun_ptr::RawSlice<u8>,
    pub gzip_id_bytes_read: u8,
}

impl Default for Context {
    fn default() -> Self {
        Self {
            mode: c::NodeMode::NONE,
            state: bun_core::ffi::zeroed::<c::z_stream>(),
            err: c::ReturnCode::Ok,
            flush: c::FlushValue::NoFlush,
            dictionary: bun_ptr::RawSlice::EMPTY,
            gzip_id_bytes_read: 0,
        }
    }
}

impl Context {
    const GZIP_HEADER_ID1: u8 = 0x1f;
    const GZIP_HEADER_ID2: u8 = 0x8b;

    #[inline]
    fn dictionary(&self) -> &[u8] {
        self.dictionary.slice()
    }

    pub fn init(
        &mut self,
        level: c_int,
        window_bits: c_int,
        mem_level: c_int,
        strategy: c_int,
        dictionary: Option<&[u8]>,
    ) {
        use c::NodeMode::*;
        self.flush = c::FlushValue::NoFlush;
        self.err = c::ReturnCode::Ok;

        let window_bits_actual = match self.mode {
            NONE => unreachable!(),
            DEFLATE | INFLATE => window_bits,
            GZIP | GUNZIP => window_bits + 16,
            UNZIP => window_bits + 32,
            DEFLATERAW | INFLATERAW => window_bits * -1,
            BROTLI_DECODE | BROTLI_ENCODE => unreachable!(),
            ZSTD_COMPRESS | ZSTD_DECOMPRESS => unreachable!(),
        };

        // See field comment on `dictionary` — `RawSlice` invariant.
        self.dictionary = match dictionary {
            Some(d) => bun_ptr::RawSlice::new(d),
            None => bun_ptr::RawSlice::EMPTY,
        };

        // SAFETY: FFI — `state` is a valid #[repr(C)] z_stream; zlibVersion()
        // returns a static C string.
        match self.mode {
            NONE => unreachable!(),
            DEFLATE | GZIP | DEFLATERAW => unsafe {
                self.err = c::deflateInit2_(
                    &raw mut self.state,
                    level,
                    8,
                    window_bits_actual,
                    mem_level,
                    strategy,
                    c::zlibVersion().cast(),
                    c_int::try_from(mem::size_of::<c::z_stream>()).expect("int cast"),
                );
            },
            INFLATE | GUNZIP | UNZIP | INFLATERAW => unsafe {
                self.err = c::inflateInit2_(
                    &raw mut self.state,
                    window_bits_actual,
                    c::zlibVersion().cast(),
                    c_int::try_from(mem::size_of::<c::z_stream>()).expect("int cast"),
                );
            },
            BROTLI_DECODE | BROTLI_ENCODE => unreachable!(),
            ZSTD_COMPRESS | ZSTD_DECOMPRESS => unreachable!(),
        }
        if self.err != c::ReturnCode::Ok {
            self.mode = NONE;
            return;
        }

        let _ = self.set_dictionary();
    }

    pub fn set_dictionary(&mut self) -> Error {
        use c::NodeMode::*;
        // PORT NOTE: reshaped for borrowck — capture raw ptr/len before
        // re-borrowing `self.state` mutably.
        let (dict_ptr, dict_len) = {
            let dict = self.dictionary();
            if dict.is_empty() {
                return Error::ok();
            }
            (dict.as_ptr(), u32::try_from(dict.len()).expect("int cast"))
        };
        self.err = c::ReturnCode::Ok;
        // SAFETY: FFI — state is initialized; dict points into a rooted ArrayBuffer.
        match self.mode {
            DEFLATE | DEFLATERAW => unsafe {
                self.err = c::deflateSetDictionary(&raw mut self.state, dict_ptr, dict_len);
            },
            INFLATERAW => unsafe {
                self.err = c::inflateSetDictionary(&raw mut self.state, dict_ptr, dict_len);
            },
            _ => {}
        }
        if self.err != c::ReturnCode::Ok {
            return self.error_for_message(c"Failed to set dictionary");
        }
        Error::ok()
    }

    pub fn set_params(&mut self, level: c_int, strategy: c_int) -> Error {
        use c::NodeMode::*;
        self.err = c::ReturnCode::Ok;
        // SAFETY: FFI — state is an initialized deflate stream.
        match self.mode {
            DEFLATE | DEFLATERAW => unsafe {
                self.err = c::deflateParams(&raw mut self.state, level, strategy);
            },
            _ => {}
        }
        if self.err != c::ReturnCode::Ok && self.err != c::ReturnCode::BufError {
            return self.error_for_message(c"Failed to set parameters");
        }
        Error::ok()
    }

    fn error_for_message(&self, default: &'static core::ffi::CStr) -> Error {
        let mut message: *const c_char = default.as_ptr();
        if !self.state.err_msg.is_null() {
            message = self.state.err_msg;
        }
        Error {
            msg: message,
            err: self.err as c_int,
            code: match self.err {
                c::ReturnCode::Ok => c"Z_OK",
                c::ReturnCode::StreamEnd => c"Z_STREAM_END",
                c::ReturnCode::NeedDict => c"Z_NEED_DICT",
                c::ReturnCode::ErrNo => c"Z_ERRNO",
                c::ReturnCode::StreamError => c"Z_STREAM_ERROR",
                c::ReturnCode::DataError => c"Z_DATA_ERROR",
                c::ReturnCode::MemError => c"Z_MEM_ERROR",
                c::ReturnCode::BufError => c"Z_BUF_ERROR",
                c::ReturnCode::VersionError => c"Z_VERSION_ERROR",
            }
            .as_ptr(),
        }
    }

    pub fn reset(&mut self) -> Error {
        use c::NodeMode::*;
        self.err = c::ReturnCode::Ok;
        // SAFETY: FFI — state is an initialized stream for the given mode.
        match self.mode {
            DEFLATE | DEFLATERAW | GZIP => unsafe {
                self.err = c::deflateReset(&raw mut self.state);
            },
            INFLATE | INFLATERAW | GUNZIP => unsafe {
                self.err = c::inflateReset(&raw mut self.state);
            },
            _ => {}
        }
        if self.err != c::ReturnCode::Ok {
            return self.error_for_message(c"Failed to reset stream");
        }
        self.set_dictionary()
    }

    pub fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) {
        self.state.avail_in = match &in_ {
            Some(p) => u32::try_from(p.len()).expect("int cast"),
            None => 0,
        };
        self.state.next_in = match in_ {
            Some(p) => p.as_ptr(),
            None => core::ptr::null(),
        };
        self.state.avail_out = match &out {
            Some(p) => u32::try_from(p.len()).expect("int cast"),
            None => 0,
        };
        self.state.next_out = match out {
            Some(p) => p.as_mut_ptr(),
            None => core::ptr::null_mut(),
        };
    }

    pub fn set_flush(&mut self, flush: c_int) {
        // Checked conversion (mirrors Zig debug-mode `@enumFromInt` panic on
        // out-of-range); transmuting an arbitrary c_int into a Rust enum is UB.
        self.flush = match flush {
            0 => c::FlushValue::NoFlush,
            1 => c::FlushValue::PartialFlush,
            2 => c::FlushValue::SyncFlush,
            3 => c::FlushValue::FullFlush,
            4 => c::FlushValue::Finish,
            5 => c::FlushValue::Block,
            6 => c::FlushValue::Trees,
            _ => unreachable!("invalid zlib flush value: {flush}"),
        };
    }

    pub fn do_work(&mut self) {
        use c::NodeMode::*;
        let mut next_expected_header_byte: Option<*const u8> = None;

        // If the avail_out is left at 0, then it means that it ran out
        // of room.  If there was avail_out left over, then it means
        // that all of the input was consumed.
        match self.mode {
            DEFLATE | GZIP | DEFLATERAW => {
                return self.do_work_deflate();
            }
            UNZIP => {
                if self.state.avail_in > 0 {
                    next_expected_header_byte = Some(self.state.next_in.cast::<u8>());
                }
                if self.gzip_id_bytes_read == 0 {
                    let Some(p) = next_expected_header_byte else {
                        return self.do_work_inflate();
                    };
                    // SAFETY: avail_in > 0 was checked above, so next_in points to ≥1 byte.
                    if unsafe { *p } == Self::GZIP_HEADER_ID1 {
                        self.gzip_id_bytes_read = 1;
                        // SAFETY: advancing within the input buffer; only dereferenced
                        // below after confirming avail_in > 1.
                        next_expected_header_byte = Some(unsafe { p.add(1) });
                        if self.state.avail_in == 1 {
                            // The only available byte was already read.
                            return self.do_work_inflate();
                        }
                    } else {
                        self.mode = INFLATE;
                        return self.do_work_inflate();
                    }
                }
                if self.gzip_id_bytes_read == 1 {
                    let Some(p) = next_expected_header_byte else {
                        return self.do_work_inflate();
                    };
                    // SAFETY: either avail_in > 1 (fallthrough above) or avail_in > 0
                    // on a fresh call with gzip_id_bytes_read == 1.
                    if unsafe { *p } == Self::GZIP_HEADER_ID2 {
                        self.gzip_id_bytes_read = 2;
                        self.mode = GUNZIP;
                    } else {
                        self.mode = INFLATE;
                    }
                    return self.do_work_inflate();
                }
                debug_assert!(false); // invalid number of gzip magic number bytes read
            }
            INFLATE | GUNZIP | INFLATERAW => {
                return self.do_work_inflate();
            }
            NONE => {}
            BROTLI_ENCODE | BROTLI_DECODE => {}
            ZSTD_COMPRESS | ZSTD_DECOMPRESS => {}
        }
    }

    fn do_work_deflate(&mut self) {
        // SAFETY: FFI — state is an initialized deflate stream.
        self.err = unsafe { c::deflate(&raw mut self.state, self.flush) };
    }

    fn do_work_inflate(&mut self) {
        // SAFETY: FFI — state is an initialized inflate stream.
        self.err = unsafe { c::inflate(&raw mut self.state, self.flush) };

        if self.mode != c::NodeMode::INFLATERAW
            && self.err == c::ReturnCode::NeedDict
            && !self.dictionary().is_empty()
        {
            // PORT NOTE: reshaped for borrowck — capture raw ptr/len before
            // re-borrowing `self.state` mutably.
            let (dict_ptr, dict_len) = {
                let dict = self.dictionary();
                (dict.as_ptr(), u32::try_from(dict.len()).expect("int cast"))
            };
            // SAFETY: FFI — state is an initialized inflate stream; dict is rooted.
            self.err = unsafe { c::inflateSetDictionary(&raw mut self.state, dict_ptr, dict_len) };

            if self.err == c::ReturnCode::Ok {
                // SAFETY: FFI — state is an initialized inflate stream.
                self.err = unsafe { c::inflate(&raw mut self.state, self.flush) };
            } else if self.err == c::ReturnCode::DataError {
                self.err = c::ReturnCode::NeedDict;
            }
        }
        while self.state.avail_in > 0
            && self.mode == c::NodeMode::GUNZIP
            && self.err == c::ReturnCode::StreamEnd
            // SAFETY: avail_in > 0 ⇒ next_in points to ≥1 readable byte.
            && unsafe { *self.state.next_in } != 0
        {
            // Bytes remain in input buffer. Perhaps this is another compressed member in the same archive, or just trailing garbage.
            // Trailing zero bytes are okay, though, since they are frequently used for padding.
            let _ = self.reset();
            // SAFETY: FFI — state was just re-initialized by reset().
            self.err = unsafe { c::inflate(&raw mut self.state, self.flush) };
        }
    }

    pub fn update_write_result(&self, avail_in: &mut u32, avail_out: &mut u32) {
        *avail_in = self.state.avail_in;
        *avail_out = self.state.avail_out;
    }

    pub fn get_error_info(&self) -> Error {
        match self.err {
            c::ReturnCode::Ok | c::ReturnCode::BufError => {
                if self.state.avail_out != 0 && self.flush == c::FlushValue::Finish {
                    return self.error_for_message(c"unexpected end of file");
                }
            }
            c::ReturnCode::StreamEnd => {}
            c::ReturnCode::NeedDict => {
                if self.dictionary().is_empty() {
                    return self.error_for_message(c"Missing dictionary");
                } else {
                    return self.error_for_message(c"Bad dictionary");
                }
            }
            _ => {
                return self.error_for_message(c"Zlib error");
            }
        }
        Error::ok()
    }

    pub fn close(&mut self) {
        use c::NodeMode::*;
        let mut status = c::ReturnCode::Ok;
        // SAFETY: FFI — state is an initialized stream for the given mode.
        match self.mode {
            DEFLATE | DEFLATERAW | GZIP => unsafe {
                status = c::deflateEnd(&raw mut self.state);
            },
            INFLATE | INFLATERAW | GUNZIP | UNZIP => unsafe {
                status = c::inflateEnd(&raw mut self.state);
            },
            NONE => {}
            BROTLI_ENCODE | BROTLI_DECODE => {}
            ZSTD_COMPRESS | ZSTD_DECOMPRESS => {}
        }
        debug_assert!(status == c::ReturnCode::Ok || status == c::ReturnCode::DataError);
        self.mode = NONE;
    }
}

// ported from: src/runtime/node/zlib/NativeZlib.zig

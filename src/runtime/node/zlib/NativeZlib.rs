use core::ffi::c_int;

use bun_core::vec::BorrowedCursor;
use bun_zlib::deflate::{self, Flush};
use bun_zlib::{Deflater, GZIP_ID, Inflater, inflate};

use crate::node::node_zlib_binding::{
    CompressionContext, Error, NodeMode, SpareCodecMemory, Unseen, Z_BUF_ERROR,
};

mod _impl {
    use super::*;
    use core::cell::Cell;

    use bun_jsc::JsResult;
    use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};

    use crate::node::node_zlib_binding::{CompressionStreamImpl as _, Stream};
    use crate::node::util::validators;

    pub(crate) struct NativeZlib {
        stream: Cell<Option<Box<Stream<Context>>>>,
        pending_close: Cell<bool>,
        closed: Cell<bool>,
    }

    // `CompressionStreamImpl` (node_zlib_binding.rs) has write, writeSync, reset, close and onerror.

    impl NativeZlib {
        pub(crate) fn constructor(mode: u8) -> Self {
            Self {
                stream: Cell::new(Some(Stream::new(Context::new(NodeMode::from_int(mode))))),
                pending_close: Cell::new(false),
                closed: Cell::new(false),
            }
        }

        //// adding this didnt help much but leaving it here to compare the number with later
        pub(crate) fn estimated_size(&self) -> usize {
            // @sizeOf(@cImport(@cInclude("deflate.h")).internal_state) @ cloudflare/zlib @ 92530568d2c128b4432467b76a3b54d93d6350bd
            const INTERNAL_STATE_SIZE: usize = 3309;
            INTERNAL_STATE_SIZE
        }

        pub(crate) fn init(
            &self,
            this_value: JsWrapper<'_, Self>,
            cx: &mut JsScope<'_>,
            window_bits: i32,
            level: i32,
            mem_level: i32,
            strategy: i32,
            write_state: JsLocal<'_>,
            process_callback: JsLocal<'_>,
            dictionary: JsLocal<'_>,
        ) -> JsResult<()> {
            let global = cx.global();
            let this_value = this_value.to_js();
            self.throw_unless_idle(global)?;

            // `flush_write_result` writes two u32s into this array, so the
            // caller-supplied array must hold at least 2 elements.
            let write_result_value = write_state.to_js();
            let Some(mut write_result_buf) = write_result_value.as_array_buffer(global) else {
                return Err(global.throw_invalid_argument_type_value(
                    "writeResult",
                    "Uint32Array",
                    write_result_value,
                ));
            };
            if write_result_buf.typed_array_type != bun_jsc::JSType::Uint32Array {
                return Err(global.throw_invalid_argument_type_value(
                    "writeResult",
                    "Uint32Array",
                    write_result_value,
                ));
            }
            let write_result_slice = write_result_buf.as_u32();
            if write_result_slice.len() < 2 {
                return Err(global
                    .err(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("writeResult must be a Uint32Array with at least 2 elements"),
                    )
                    .throw());
            }
            let write_callback =
                validators::validate_function(global, "writeCallback", process_callback.to_js())?;
            // Bind the ArrayBuffer view to a local so the borrowed byte_slice() outlives
            // the call to `Context::init` below (E0716 otherwise).
            let dictionary_buf;
            let dictionary = if dictionary.is_undefined() {
                &[]
            } else {
                let dictionary_value = dictionary.to_js();
                dictionary_buf = match dictionary_value.as_array_buffer(global) {
                    Some(buf) => buf,
                    None => {
                        return Err(global.throw_invalid_argument_type_value(
                            "dictionary",
                            "Buffer, TypedArray, or DataView",
                            dictionary_value,
                        ));
                    }
                };
                // As for zlib, which takes the length in 32 bits.
                if dictionary_buf.byte_len > u32::MAX as usize {
                    return Err(global.throw_range_error(
                        dictionary_buf.byte_len as i64,
                        bun_jsc::RangeErrorOptions {
                            field_name: b"dictionary.byteLength",
                            max: i64::from(u32::MAX),
                            ..Default::default()
                        },
                    ));
                }
                dictionary_buf.byte_slice()
            };

            js::write_result_set_cached(this_value, global, write_result_value);
            js::write_callback_set_cached(
                this_value,
                global,
                write_callback.with_async_context_if_needed(global),
            );

            let result = self.borrow_idle_stream(global)?.context_to_init().init(
                level,
                window_bits,
                mem_level,
                strategy,
                dictionary,
            );
            if result.is_err() {
                self.close();
            }

            Ok(())
        }

        pub(crate) fn params(
            &self,
            this_value: JsWrapper<'_, Self>,
            cx: &mut JsScope<'_>,
            level: i32,
            strategy: i32,
        ) -> JsResult<()> {
            let global = cx.global();
            let result = self
                .borrow_idle_stream(global)?
                .context
                .set_params(level, strategy);
            if let Err(err) = result {
                self.emit_error(global, this_value.to_js(), &err);
            }
            Ok(())
        }
    }

    crate::__impl_compression_stream!(NativeZlib, super::Context, js_NativeZlib);
} // mod _impl

pub(crate) use _impl::NativeZlib;

// ─── non-JSC body (real): zlib stream Context ─────────────────────────────

enum State {
    Deflate(Box<Deflater>),
    Inflate(Box<Inflater>),
}

pub(crate) struct Context {
    mode: NodeMode,
    /// `None` until `init()`: what needs it fails with `Z_STREAM_ERROR`.
    state: Option<State>,
    flush: Flush,
    level: c_int,
    /// With a smaller one, it depends on the room that a call has how far back a match may reach.
    has_largest_window: bool,
    dictionary: Vec<u8>,
    gzip_id_bytes_read: u8,
    write_result: Result<[usize; 2], Error>,
}

const Z_MEM_ERROR: c_int = -4;

/// `default` is for what zlib has no message of its own for.
fn zlib_error(error: bun_zlib::Error, default: &'static str) -> Error {
    use bun_zlib::Error::*;
    let (err, code) = match error {
        InvalidParameter | InvalidState | Internal => (-2, c"Z_STREAM_ERROR"),
        Damaged(_) | WrongDictionary => (-3, c"Z_DATA_ERROR"),
        Alloc(_) => (Z_MEM_ERROR, c"Z_MEM_ERROR"),
        InputAfterFinish => (Z_BUF_ERROR, c"Z_BUF_ERROR"),
    };
    let msg = match error {
        Damaged(damage) => damage.message(),
        InvalidState => "stream error",
        InputAfterFinish => "buffer error",
        _ => default,
    };
    Error {
        msg: msg.as_bytes(),
        err,
        code,
    }
}

impl Context {
    fn new(mode: NodeMode) -> Self {
        Self {
            mode,
            state: None,
            flush: Flush::None,
            level: 0,
            has_largest_window: false,
            dictionary: Vec::new(),
            gzip_id_bytes_read: 0,
            write_result: Ok([0, 0]),
        }
    }

    fn init(
        &mut self,
        level: c_int,
        window_bits: c_int,
        mem_level: c_int,
        strategy: c_int,
        dictionary: &[u8],
    ) -> bun_zlib::Result<()> {
        use NodeMode::*;
        self.flush = Flush::None;
        self.level = level;
        self.has_largest_window = matches!(window_bits, 0 | 15);
        self.dictionary = dictionary.to_vec();

        let window_bits = match self.mode {
            GZIP | GUNZIP => window_bits.saturating_add(16),
            UNZIP => window_bits.saturating_add(32),
            DEFLATERAW | INFLATERAW => window_bits.saturating_neg(),
            _ => window_bits,
        };

        // `init` is JS-reachable twice on one handle: free the previous state first.
        self.state = None;
        self.state = Some(match self.mode {
            DEFLATE | GZIP | DEFLATERAW => {
                let (container, window_bits) = match window_bits {
                    ..0 => (deflate::Container::Raw, window_bits.saturating_neg()),
                    0..16 => (deflate::Container::Zlib, window_bits),
                    16.. => (deflate::Container::Gzip, window_bits - 16),
                };
                let small = |n| u8::try_from(n).map_err(|_| bun_zlib::Error::InvalidParameter);
                let options = deflate::Options {
                    level: level.try_into()?,
                    strategy: strategy.try_into()?,
                    window_bits: small(window_bits)?,
                    memory_level: small(mem_level)?,
                };
                State::Deflate(Deflater::new(container, options)?)
            }
            _ => State::Inflate(Box::new(Inflater::from_zlib_window_bits(window_bits)?)),
        });

        match self.set_dictionary() {
            Err(Error {
                err: Z_MEM_ERROR, ..
            }) => Err(bun_alloc::AllocError.into()),
            _ => Ok(()),
        }
    }

    fn is_gzip(&self, input: &[u8]) -> bool {
        matches!(self.mode, NodeMode::GUNZIP | NodeMode::UNZIP) && input.starts_with(&GZIP_ID)
    }

    fn set_dictionary(&mut self) -> Result<(), Error> {
        use NodeMode::*;
        if self.dictionary.is_empty() {
            return Ok(());
        }
        match (self.mode, &mut self.state) {
            (DEFLATE | DEFLATERAW, Some(State::Deflate(deflater))) => {
                deflater.set_dictionary(&self.dictionary)
            }
            (INFLATERAW, Some(State::Inflate(inflater))) => {
                inflater.set_dictionary(&self.dictionary)
            }
            _ => Ok(()),
        }
        .map_err(|error| Error {
            msg: b"Failed to set dictionary",
            ..zlib_error(error, "")
        })
    }

    fn set_params(&mut self, level: c_int, strategy: c_int) -> Result<(), Error> {
        if !matches!(self.mode, NodeMode::DEFLATE | NodeMode::DEFLATERAW) {
            return Ok(());
        }
        self.level = level;
        let mut set = || match &mut self.state {
            // Like Node, it keeps quiet about parameters that cannot change in the middle of a block.
            Some(State::Deflate(deflater)) => deflater
                .set_params(level.try_into()?, strategy.try_into()?)
                .map(drop),
            _ => Err(bun_zlib::Error::Internal),
        };
        set().map_err(|error| zlib_error(error, "Failed to set parameters"))
    }

    /// Resolves `UNZIP` to `GUNZIP` or `INFLATE` once the first bytes tell which it is.
    fn detect_gzip_header(&mut self, input: &[u8]) {
        let mut header = input.iter().copied();
        if self.gzip_id_bytes_read == 0 {
            match header.next() {
                Some(byte) if byte == GZIP_ID[0] => self.gzip_id_bytes_read = 1,
                Some(_) => {
                    self.mode = NodeMode::INFLATE;
                    return;
                }
                None => return,
            }
        }
        match header.next() {
            Some(byte) if byte == GZIP_ID[1] => self.mode = NodeMode::GUNZIP,
            Some(_) => self.mode = NodeMode::INFLATE,
            None => {}
        }
    }

    fn step(&mut self, input: &mut &[u8], mut out: BorrowedCursor<'_, u8>) -> Result<(), Error> {
        const Z_NEED_DICT: c_int = 2;
        let failed = |error| zlib_error(error, "Zlib error");
        let inflater = match &mut self.state {
            None => return Err(failed(bun_zlib::Error::Internal)),
            Some(State::Deflate(deflater)) => {
                let status = deflater.deflate(input, out, self.flush);
                return status.map(drop).map_err(failed);
            }
            Some(State::Inflate(inflater)) => inflater,
        };
        let mut gives_dictionary = self.mode != NodeMode::INFLATERAW;
        loop {
            let status = if self.flush == Flush::Block {
                inflater.inflate_block(input, out.reborrow())
            } else {
                inflater.inflate(input, out.reborrow())
            };
            match status.map_err(failed)? {
                inflate::Status::NeedsDictionary => {
                    let needs = |message| Error::init(message, Z_NEED_DICT, c"Z_NEED_DICT");
                    if self.dictionary.is_empty() {
                        return Err(needs(c"Missing dictionary"));
                    }
                    let result = if gives_dictionary {
                        inflater.set_dictionary(&self.dictionary)
                    } else {
                        Err(bun_zlib::Error::WrongDictionary)
                    };
                    result.map_err(|error| match error {
                        bun_zlib::Error::WrongDictionary => needs(c"Bad dictionary"),
                        error => failed(error),
                    })?;
                }
                // Another member of the archive, or trailing garbage. Trailing zero bytes are padding.
                inflate::Status::StreamEnd
                    if self.mode == NodeMode::GUNZIP
                        && input.first().is_some_and(|&byte| byte != 0) =>
                {
                    inflater.reset();
                    gives_dictionary = false;
                }
                inflate::Status::NeedsInput
                    if self.flush == Flush::Finish && out.capacity() != 0 =>
                {
                    let message = c"unexpected end of file";
                    return Err(Error::init(message, Z_BUF_ERROR, c"Z_BUF_ERROR"));
                }
                _ => return Ok(()),
            }
        }
    }
}

/// Returns what is left of `input`.
fn inflate_all(
    inflater: &mut Inflater,
    mut input: &[u8],
    out: &mut Vec<u8>,
    max: usize,
    is_gzip: bool,
    mut dictionary: &[u8],
) -> Option<usize> {
    inflate::reserve_for(input, is_gzip, out, max).ok()?;
    loop {
        match inflater
            .inflate_to_vec(&mut input, out, max - out.len())
            .ok()?
        {
            inflate::Status::NeedsDictionary if !dictionary.is_empty() => {
                inflater.set_dictionary(dictionary).ok()?;
            }
            inflate::Status::StreamEnd if is_gzip && input.first().is_some_and(|&it| it != 0) => {
                inflater.reset();
                dictionary = &[];
            }
            inflate::Status::StreamEnd => return Some(input.len()),
            _ => return None,
        }
    }
}

impl CompressionContext for Context {
    const SWAPS_MEMORY: bool = false;

    fn can_do_all_work(&self, _: usize) -> bool {
        match self.is_encoder() {
            // Stored blocks end where the chunks do.
            true => self.level != 0,
            false => self.has_largest_window,
        }
    }

    fn announced_len(&self, input: &[u8]) -> usize {
        let trailer = input.last_chunk().filter(|_| self.is_gzip(input));
        trailer.map_or(0, |&len| u32::from_le_bytes(len) as usize)
    }

    fn do_all_work(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        max: usize,
    ) -> Option<Result<usize, Error>> {
        let is_gzip = self.is_gzip(input);
        match self.state.as_mut()? {
            State::Deflate(deflater) => Some(match deflater.deflate_whole(input, out) {
                Ok(()) => Ok(0),
                Err(error) => Err(zlib_error(error, "Zlib error")),
            }),
            State::Inflate(inflater) => {
                let left = inflate_all(inflater, input, out, max, is_gzip, &self.dictionary);
                if left.is_none() {
                    inflater.reset();
                    return self.set_dictionary().err().map(Err);
                }
                left.map(Ok)
            }
        }
    }

    fn quick_input_len(&self) -> Option<usize> {
        match self.level {
            7.. if self.is_encoder() => Some(2048),
            _ => Some(4096),
        }
    }

    fn is_encoder(&self) -> bool {
        matches!(self.state, Some(State::Deflate(_)))
    }

    fn swap_memory(&mut self, _: &mut SpareCodecMemory) {}

    fn free_state(&mut self) {
        (self.state, self.dictionary) = (None, Vec::new());
    }

    fn reset(&mut self, _: Unseen) -> Result<(), Error> {
        match (self.mode, &mut self.state) {
            (NodeMode::UNZIP, _) => {}
            (_, Some(State::Deflate(deflater))) => deflater.reset(),
            (_, Some(State::Inflate(inflater))) => inflater.reset(),
            (_, None) => {
                return Err(zlib_error(
                    bun_zlib::Error::Internal,
                    "Failed to reset stream",
                ));
            }
        }
        self.set_dictionary()
    }

    fn flush_value_is_valid(flush: u32) -> bool {
        flush <= 5
    }

    fn set_flush(&mut self, flush: c_int) {
        self.flush = match flush {
            0 => Flush::None,
            1 => Flush::Partial,
            2 => Flush::Sync,
            3 => Flush::Full,
            4 => Flush::Finish,
            5 => Flush::Block,
            _ => unreachable!("invalid zlib flush value: {flush}"),
        };
    }

    fn do_work(&mut self, mut input: &[u8], mut out: BorrowedCursor<'_, u8>) {
        if self.mode == NodeMode::UNZIP {
            self.detect_gzip_header(input);
        }
        self.write_result = self
            .step(&mut input, out.reborrow())
            .map(|()| [out.capacity(), input.len()]);
    }

    fn write_result(&self) -> Result<[usize; 2], Error> {
        self.write_result
    }
}

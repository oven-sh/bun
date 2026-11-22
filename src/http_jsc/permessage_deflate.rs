//! The payloads of compressed WebSocket messages (RFC 7692 §7.2), also for packages/bun-uws/src/PerMessageDeflate.h.

use bun_zlib::{Deflater, Inflater, deflate, inflate};

/// The end of an empty stored block, which every message ends with and which is not sent.
const TAIL: [u8; 4] = [0x00, 0x00, 0xff, 0xff];

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum InflateError {
    Corrupt = 1,
    TooLarge,
    OutOfMemory,
}

/// Appends to `out`. After an error the peer expects nothing but another message, which may be this one uncompressed.
pub(crate) fn deflate_message(
    deflater: &mut Deflater,
    message: &[u8],
    out: &mut Vec<u8>,
) -> Result<(), bun_zlib::Error> {
    let start = out.len();
    deflater
        .deflate_to_vec(message, out, deflate::Flush::Sync)
        .inspect_err(|_| deflater.reset())?;
    // An empty message behind another leaves nothing to flush.
    let payload = out[start..].strip_suffix(&TAIL);
    let len = payload.ok_or(bun_zlib::Error::InvalidState)?.len();
    out.truncate(start + len);
    Ok(())
}

/// Appends to `out`.
pub(crate) fn inflate_message(
    inflater: &mut Inflater,
    mut payload: &[u8],
    out: &mut Vec<u8>,
    max_len: usize,
) -> Result<(), InflateError> {
    let too_long = out.len().saturating_add(max_len).saturating_add(1);
    let mut status = inflater.inflate_to_vec(&mut payload, out, too_long - out.len());
    if status == Ok(inflate::Status::NeedsInput) && out.len() < too_long {
        status = inflater.inflate_to_vec_and_wait(&mut &TAIL[..], out, too_long - out.len());
    }
    match status {
        _ if out.len() == too_long => Err(InflateError::TooLarge),
        Ok(inflate::Status::NeedsInput) => Ok(()),
        // RFC 7692 §7.2.3.4: a message may end with a final block. The next one starts another stream.
        Ok(inflate::Status::StreamEnd) => {
            inflater.reset_and_wait();
            Ok(())
        }
        Err(bun_zlib::Error::Alloc(_)) => Err(InflateError::OutOfMemory),
        _ => Err(InflateError::Corrupt),
    }
}

/// Only without context takeover. `None` if it fails, or takes more than `limit` bytes.
pub(crate) fn inflate_message_at_once(
    payload: &[u8],
    out: &mut Vec<u8>,
    limit: usize,
    max_len: usize,
) -> Option<Result<(), InflateError>> {
    let output = bun_deflate::Output::Vec { vec: out, limit };
    let written = bun_deflate::inflate_message(payload, output).ok()?.written;
    Some(if written > max_len {
        Err(InflateError::TooLarge)
    } else {
        Ok(())
    })
}

/// What the result of a call points into, until the next call.
#[derive(Default)]
struct DeflateBuffer(Vec<u8>);

impl DeflateBuffer {
    fn inflate(
        &mut self,
        inflater: &mut Inflater,
        payload: &[u8],
        max_len: usize,
        reset: bool,
    ) -> Result<(), InflateError> {
        const AT_ONCE: usize = 16 * 1024;
        if !reset {
            // After an error the connection reads no more.
            return inflate_message(inflater, payload, &mut self.0, max_len)
                .inspect_err(|_| inflater.reset_and_wait());
        }
        self.0
            .try_reserve(AT_ONCE)
            .map_err(|_| InflateError::OutOfMemory)?;
        inflate_message_at_once(payload, &mut self.0, AT_ONCE, max_len).unwrap_or_else(|| {
            let result = inflate_message(inflater, payload, &mut self.0, max_len);
            inflater.reset();
            result
        })
    }
}

#[repr(C)]
struct Output {
    bytes: *const u8,
    len: usize,
    /// An `InflateError`, or 0.
    error: u8,
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DeflateBuffer__create() -> Box<DeflateBuffer> {
    Box::default()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DeflateBuffer__destroy(_: Box<DeflateBuffer>) {}

#[unsafe(no_mangle)]
extern "C" fn Bun__Deflater__create(window_bits: u8, memory_level: u8) -> Option<Box<Deflater>> {
    let options = deflate::Options {
        window_bits,
        memory_level,
        ..Default::default()
    };
    Deflater::new(deflate::Container::Raw, options).ok()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Deflater__destroy(_: Box<Deflater>) {}

/// # Safety
/// `message` points to `*len` bytes, which are not in `buffer`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Deflater__deflateMessage(
    deflater: &mut Deflater,
    buffer: &mut DeflateBuffer,
    message: *const u8,
    len: &mut usize,
    reset: bool,
) -> *const u8 {
    // SAFETY: the contract of this function.
    let message = unsafe { bun_core::ffi::slice(message, *len) };
    buffer.0.clear();
    if deflate_message(deflater, message, &mut buffer.0).is_err() {
        buffer.0 = Vec::new();
        return core::ptr::null();
    }
    if reset {
        deflater.reset();
    }
    *len = buffer.0.len();
    buffer.0.as_ptr()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Inflater__create(window_bits: u8) -> Option<Box<Inflater>> {
    let inflater = Inflater::with_window_bits(inflate::Container::Raw, window_bits);
    inflater.ok().map(Box::new)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Inflater__destroy(_: Box<Inflater>) {}

/// # Safety
/// `payload` points to `len` bytes, which are not in `buffer`. It may be null if there are none.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Inflater__inflateMessage(
    inflater: &mut Inflater,
    buffer: &mut DeflateBuffer,
    payload: *const u8,
    len: usize,
    max_len: usize,
    reset: bool,
) -> Output {
    // SAFETY: the contract of this function.
    let payload = unsafe { bun_core::ffi::slice(payload, len) };
    buffer.0.clear();
    let error = buffer.inflate(inflater, payload, max_len, reset).err();
    if error == Some(InflateError::OutOfMemory) {
        // Every connection on the loop shares it.
        buffer.0 = Vec::new();
    }
    Output {
        bytes: buffer.0.as_ptr(),
        len: buffer.0.len(),
        error: error.map_or(0, |error| error as u8),
    }
}

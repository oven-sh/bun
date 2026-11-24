//! The payloads of compressed messages (RFC 7692 §7.2).

use bun_zlib::{Deflater, Inflater, deflate, inflate};

/// What was negotiated (RFC 7692 §7.1). `PerMessageDeflateParams` in WebSocketDeflate.h.
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Params {
    pub server_max_window_bits: u8,
    pub client_max_window_bits: u8,
    pub server_no_context_takeover: u8,
    pub client_no_context_takeover: u8,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            server_max_window_bits: 15,
            client_max_window_bits: 15,
            server_no_context_takeover: 0,
            client_no_context_takeover: 0,
        }
    }
}

impl Params {
    pub const MAX_WINDOW_BITS: u8 = 15;
    pub const MIN_WINDOW_BITS: u8 = 8;
}

/// Also for a peer that negotiated 8 bits: match distances stay <= 512 - MIN_LOOKAHEAD = 250.
pub const MIN_RAW_DEFLATE_WINDOW_BITS: u8 = 9;

/// The end of an empty stored block, which every message ends with and which is not sent.
const TAIL: [u8; 4] = [0x00, 0x00, 0xff, 0xff];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InflateError {
    Corrupt,
    TooLarge,
    OutOfMemory,
}

/// Appends to `out`. After an error the peer expects nothing but another message, which may be this one uncompressed.
pub fn deflate_message(
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
pub fn inflate_message(
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
pub fn inflate_message_at_once(
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

/// The compressor of a server.
pub struct Compressor {
    /// `None` for want of memory.
    deflater: Option<Box<Deflater>>,
    no_context_takeover: bool,
}

impl Compressor {
    fn new(window_bits: u8, memory_level: u8, no_context_takeover: bool) -> Self {
        let options = deflate::Options {
            window_bits,
            memory_level,
            ..Default::default()
        };
        Self {
            deflater: Deflater::new(deflate::Container::Raw, options).ok(),
            no_context_takeover,
        }
    }

    /// For any number of connections.
    pub fn shared() -> Self {
        Self::new(Params::MAX_WINDOW_BITS, 8, true)
    }

    /// `None` if the shared one does it.
    pub fn dedicated(params: Params, is_smallest: bool) -> Option<Self> {
        let window_bits = params
            .server_max_window_bits
            .clamp(MIN_RAW_DEFLATE_WINDOW_BITS, Params::MAX_WINDOW_BITS);
        let no_context_takeover = params.server_no_context_takeover != 0;
        let memory_level = if is_smallest { 1 } else { window_bits - 7 };
        (!no_context_takeover || window_bits < Params::MAX_WINDOW_BITS)
            .then(|| Self::new(window_bits, memory_level, no_context_takeover))
    }

    /// Replaces `out`. False if the message has to be sent as it is.
    pub fn compress(&mut self, message: &[u8], out: &mut Vec<u8>) -> bool {
        let Some(deflater) = &mut self.deflater else {
            return false;
        };
        out.clear();
        if deflate_message(deflater, message, out).is_err() {
            *out = Vec::new();
            return false;
        }
        if self.no_context_takeover {
            deflater.reset();
        }
        true
    }
}

/// The decompressor of a server.
pub struct Decompressor {
    inflater: Box<Inflater>,
    no_context_takeover: bool,
}

impl Decompressor {
    /// For any number of connections: its window fits what any smaller one produced.
    pub fn shared() -> Self {
        Self {
            inflater: Box::new(Inflater::new(inflate::Container::Raw)),
            no_context_takeover: true,
        }
    }

    /// `None` if the shared one does it.
    pub fn dedicated(params: Params) -> Option<Self> {
        let window_bits = params
            .client_max_window_bits
            .clamp(Params::MIN_WINDOW_BITS, Params::MAX_WINDOW_BITS);
        (params.client_no_context_takeover == 0).then(|| {
            let inflater = Inflater::with_window_bits(inflate::Container::Raw, window_bits);
            Self {
                inflater: Box::new(inflater.expect("a window in range")),
                no_context_takeover: false,
            }
        })
    }

    /// Replaces `out`.
    pub fn decompress(
        &mut self,
        payload: &[u8],
        out: &mut Vec<u8>,
        max_len: usize,
    ) -> Result<(), InflateError> {
        const AT_ONCE: usize = 16 * 1024;
        let inflater = &mut *self.inflater;
        out.clear();
        if !self.no_context_takeover {
            // After an error the connection reads no more.
            return inflate_message(inflater, payload, out, max_len)
                .inspect_err(|_| inflater.reset_and_wait());
        }
        out.try_reserve(AT_ONCE)
            .map_err(|_| InflateError::OutOfMemory)?;
        inflate_message_at_once(payload, out, AT_ONCE, max_len).unwrap_or_else(|| {
            let result = inflate_message(inflater, payload, out, max_len);
            inflater.reset();
            result
        })
    }
}

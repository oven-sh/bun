//! Manages the DEFLATE compression and decompression streams for a WebSocket connection.

use core::ffi::c_int;

use bun_core::{feature_flag, handle_oom};
use bun_zlib as zlib;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Params {
    pub(crate) server_max_window_bits: u8,
    pub(crate) client_max_window_bits: u8,
    pub(crate) server_no_context_takeover: u8,
    pub(crate) client_no_context_takeover: u8,
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
    pub(crate) const MAX_WINDOW_BITS: u8 = 15;
    pub(crate) const MIN_WINDOW_BITS: u8 = 8;
}

/// Parent module references this type as `WebSocketDeflate`.
pub type WebSocketDeflate = PerMessageDeflate;
/// Parent module matches `websocket_deflate::Error::*` against `decompress()`'s
/// error type.
pub(crate) type Error = DecompressError;

/// The zlib streams are per connection: with context takeover (the default)
/// each message's back-references reach into the previous message's window.
/// The libdeflate fast path is stateless and lives in the VM's
/// `bun_jsc::RareData`, shared by every client on the thread.
pub struct PerMessageDeflate {
    pub(crate) compress_stream: zlib::DeflateEncoder,
    pub(crate) decompress_stream: zlib::InflateDecoder,
    compress_no_context_takeover: bool,
    decompress_no_context_takeover: bool,
}

// Constants from zlib.h
const Z_DEFAULT_COMPRESSION: c_int = 6;
const Z_DEFAULT_STRATEGY: c_int = 0;
const Z_DEFAULT_MEM_LEVEL: c_int = 8;

/// zlib rejects an 8-bit window for raw deflate. A peer that negotiated 8 bits can still decode
/// 9-bit output, because match distances stay <= 512 - MIN_LOOKAHEAD = 250.
const ZLIB_MIN_RAW_DEFLATE_WINDOW_BITS: u8 = 9;

// Buffer size for compression/decompression operations
const COMPRESSION_BUFFER_SIZE: usize = 4096;

/// Output space reserved up front for one message. The one-shot libdeflate
/// path gets exactly that space, so it is skipped for compressed inputs at
/// least this large: their output would not fit either.
const INFLATE_BUFFER_SIZE: usize = 128 * 1024;

// DEFLATE trailer bytes added by Z_SYNC_FLUSH
const DEFLATE_TRAILER: [u8; 4] = [0x00, 0x00, 0xff, 0xff];
/// An empty stored block with BFINAL set.
const FINAL_EMPTY_BLOCK: [u8; 5] = [0x01, 0x00, 0x00, 0xff, 0xff];

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum DecompressError {
    #[error("InflateFailed")]
    InflateFailed,
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("TooLarge")]
    TooLarge,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum CompressError {
    #[error("DeflateFailed")]
    DeflateFailed,
    #[error("OutOfMemory")]
    OutOfMemory,
}

impl PerMessageDeflate {
    /// RFC 7692 names each parameter after the side whose compressor it limits: `server_*`
    /// configures the server's compressor and the client's decompressor.
    pub(crate) fn init(params: Params, is_server: bool) -> Box<Self> {
        let server = (
            params.server_max_window_bits,
            params.server_no_context_takeover == 1,
        );
        let client = (
            params.client_max_window_bits,
            params.client_no_context_takeover == 1,
        );
        let (ours, theirs) = if is_server {
            (server, client)
        } else {
            (client, server)
        };

        // Negative window bits select raw DEFLATE, as required by RFC 7692.
        let compress_window_bits = ours
            .0
            .clamp(ZLIB_MIN_RAW_DEFLATE_WINDOW_BITS, Params::MAX_WINDOW_BITS);
        let decompress_window_bits = theirs
            .0
            .clamp(Params::MIN_WINDOW_BITS, Params::MAX_WINDOW_BITS);
        let compress_stream = handle_oom(zlib::DeflateEncoder::new(
            Z_DEFAULT_COMPRESSION,
            -(compress_window_bits as c_int),
            Z_DEFAULT_MEM_LEVEL,
            Z_DEFAULT_STRATEGY,
        ));
        let decompress_stream = handle_oom(zlib::InflateDecoder::new(
            -(decompress_window_bits as c_int),
        ));

        Box::new(Self {
            compress_stream,
            decompress_stream,
            compress_no_context_takeover: ours.1,
            decompress_no_context_takeover: theirs.1,
        })
    }

    fn can_use_libdeflate(len: usize) -> bool {
        if feature_flag::BUN_FEATURE_FLAG_NO_LIBDEFLATE.get() == Some(true) {
            return false;
        }

        len < INFLATE_BUFFER_SIZE
    }

    /// Inflate one message onto `out`, failing if it exceeds `max_len` bytes.
    pub(crate) fn decompress(
        &mut self,
        decompressor: &mut bun_libdeflate::Decompressor,
        in_buf: &[u8],
        out: &mut Vec<u8>,
        max_len: usize,
    ) -> Result<(), DecompressError> {
        let initial_len = out.len();
        out.try_reserve_exact(INFLATE_BUFFER_SIZE)
            .map_err(|_| DecompressError::OutOfMemory)?;

        let mut in_with_trailer: Vec<u8> = Vec::new();
        in_with_trailer
            .try_reserve_exact(in_buf.len() + DEFLATE_TRAILER.len() + FINAL_EMPTY_BLOCK.len())
            .map_err(|_| DecompressError::OutOfMemory)?;
        in_with_trailer.extend_from_slice(in_buf);
        in_with_trailer.extend_from_slice(&DEFLATE_TRAILER);

        // libdeflate is faster than zlib, but it only inflates a finished stream, so it needs a final
        // block. It also can't see earlier messages, so it only works without context takeover.
        if self.decompress_no_context_takeover && Self::can_use_libdeflate(in_buf.len()) {
            in_with_trailer.extend_from_slice(&FINAL_EMPTY_BLOCK);
            let result = decompressor.decompress_to_vec(
                &in_with_trailer,
                out,
                bun_libdeflate::Decoding::Deflate,
            );
            if let Ok(counts) = result {
                // Stopping before the appended block means the peer sent a final block of its own. That is left to zlib.
                if counts.read == in_with_trailer.len() {
                    if out.len() - initial_len > max_len {
                        return Err(DecompressError::TooLarge);
                    }
                    return Ok(());
                }
                out.truncate(initial_len);
            }
            in_with_trailer.truncate(in_buf.len() + DEFLATE_TRAILER.len());
        }

        let mut remaining = in_with_trailer.as_slice();
        let mut saw_stream_end = false;
        loop {
            let (consumed, rc) = self.decompress_stream.step(
                remaining,
                out,
                COMPRESSION_BUFFER_SIZE,
                zlib::FlushValue::NoFlush,
            );
            remaining = &remaining[consumed..];

            // Check for decompression bomb
            if out.len() - initial_len > max_len {
                return Err(DecompressError::TooLarge);
            }

            if rc == zlib::ReturnCode::StreamEnd {
                saw_stream_end = true;
                break;
            }
            if rc == zlib::ReturnCode::MemError {
                return Err(DecompressError::OutOfMemory);
            }
            if rc != zlib::ReturnCode::Ok {
                return Err(DecompressError::InflateFailed);
            }
            if self.decompress_stream.avail_out() == 0 && !remaining.is_empty() {
                // Need more output buffer space, continue loop
                continue;
            }
            if remaining.is_empty() {
                // This shouldn't happen with the trailer, but as a safeguard.
                break;
            }
        }

        // RFC 7692 §7.2.3: a sender may end a DEFLATE stream with BFINAL=1 and
        // begin a fresh one for the next message. Without a reset here the
        // finished inflater returns Z_STREAM_END with 0 bytes on every later
        // message, silently delivering empty payloads.
        if saw_stream_end || self.decompress_no_context_takeover {
            self.decompress_stream.reset();
        }

        Ok(())
    }

    pub(crate) fn compress(
        &mut self,
        in_buf: &[u8],
        out: &mut Vec<u8>,
    ) -> Result<(), CompressError> {
        let mut remaining = in_buf;
        loop {
            let (consumed, rc) = self.compress_stream.step(
                remaining,
                out,
                COMPRESSION_BUFFER_SIZE,
                zlib::FlushValue::SyncFlush,
            );
            remaining = &remaining[consumed..];
            if rc == zlib::ReturnCode::MemError {
                return Err(CompressError::OutOfMemory);
            }
            if rc != zlib::ReturnCode::Ok {
                return Err(CompressError::DeflateFailed);
            }

            // exit only when zlib is truly finished
            if remaining.is_empty() && self.compress_stream.avail_out() != 0 {
                break;
            }
        }

        // Remove the 4-byte trailer (00 00 FF FF) added by Z_SYNC_FLUSH
        if out.len() >= 4 && out[out.len() - 4..] == DEFLATE_TRAILER {
            out.truncate(out.len() - 4);
        }

        if self.compress_no_context_takeover {
            self.compress_stream.reset();
        }

        Ok(())
    }
}

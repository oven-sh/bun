//! Manages the DEFLATE compression and decompression streams for a WebSocket connection.

use core::ffi::c_int;

use bun_core::feature_flag;
use bun_jsc::rare_data::RareData as JscRareData;
use bun_libdeflate_sys::libdeflate as libdeflate_sys;
use bun_zlib as zlib;

#[repr(C)]
#[derive(Clone, Copy)]
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

pub const STACK_BUFFER_SIZE: usize = 128 * 1024;

/// Lazy-init the per-VM pooled libdeflate decompressor in `slot`.
fn decompressor(
    slot: &mut Option<libdeflate_sys::OwnedDecompressor>,
) -> Option<&mut libdeflate_sys::Decompressor> {
    if slot.is_none() {
        *slot = libdeflate_sys::OwnedDecompressor::new();
    }
    slot.as_deref_mut()
}

/// Parent module references this type as `WebSocketDeflate`.
pub type WebSocketDeflate = PerMessageDeflate;
/// Parent module matches `websocket_deflate::Error::*` against `decompress()`'s
/// error type.
pub type Error = DecompressError;

pub struct PerMessageDeflate {
    pub compress_stream: zlib::DeflateEncoder,
    pub decompress_stream: zlib::InflateDecoder,
    pub params: Params,
    // Per-VM pooled libdeflate state: its own heap allocation owned (and
    // freed) by `bun_jsc::RareData`, so this pointer stays valid across
    // later `&mut RareData` borrows and outlives every connection on this VM.
    pub pool: core::ptr::NonNull<bun_jsc::rare_data::WebSocketDeflateSlot>,
}

// Constants from zlib.h
const Z_DEFAULT_COMPRESSION: c_int = 6;
const Z_DEFAULT_STRATEGY: c_int = 0;
const Z_DEFAULT_MEM_LEVEL: c_int = 8;

// Buffer size for compression/decompression operations
const COMPRESSION_BUFFER_SIZE: usize = 4096;

// Maximum decompressed message size (128 MB)
const MAX_DECOMPRESSED_SIZE: usize = 128 * 1024 * 1024;

// DEFLATE trailer bytes added by Z_SYNC_FLUSH
const DEFLATE_TRAILER: [u8; 4] = [0x00, 0x00, 0xff, 0xff];

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

bun_core::named_error_set!(DecompressError, CompressError);

impl PerMessageDeflate {
    pub(crate) fn init(
        params: Params,
        rare_data: &mut JscRareData,
    ) -> Result<Box<Self>, bun_core::Error> {
        // Initialize compressor (deflate)
        // We use negative window bits for raw DEFLATE, as required by RFC 7692.
        let compress_stream = zlib::DeflateEncoder::new(
            Z_DEFAULT_COMPRESSION,
            -(params.client_max_window_bits as c_int),
            Z_DEFAULT_MEM_LEVEL,
            Z_DEFAULT_STRATEGY,
        )
        .map_err(|_| bun_core::err!("DeflateInitFailed"))?;

        // Initialize decompressor (inflate)
        let decompress_stream =
            zlib::InflateDecoder::new(-(params.server_max_window_bits as c_int))
                .map_err(|_| bun_core::err!("InflateInitFailed"))?;

        Ok(Box::new(Self {
            params,
            compress_stream,
            decompress_stream,
            pool: rare_data.websocket_deflate_slot(),
        }))
    }

    fn can_use_libdeflate(len: usize) -> bool {
        if feature_flag::BUN_FEATURE_FLAG_NO_LIBDEFLATE.get() {
            return false;
        }

        len < STACK_BUFFER_SIZE
    }

    pub(crate) fn decompress(
        &mut self,
        in_buf: &[u8],
        out: &mut Vec<u8>,
    ) -> Result<(), DecompressError> {
        let initial_len = out.len();

        // First we try with libdeflate, which is both faster and doesn't need the trailing deflate bytes
        if Self::can_use_libdeflate(in_buf.len()) {
            // SAFETY: single JS thread; the pool lives in the VM's RareData which outlives
            // every open connection (connections are torn down by close_all_socket_groups
            // before RareData drops).
            if let Some(decompressor) = decompressor(unsafe { self.pool.as_mut() }) {
                let result =
                    decompressor.decompress_to_vec(in_buf, out, libdeflate_sys::Encoding::Deflate);
                if result.status == libdeflate_sys::Status::Success {
                    if out.len() - initial_len > MAX_DECOMPRESSED_SIZE {
                        return Err(DecompressError::TooLarge);
                    }
                    return Ok(());
                }
            }
        }

        let mut in_with_trailer: Vec<u8> = Vec::with_capacity(in_buf.len() + DEFLATE_TRAILER.len());
        in_with_trailer.extend_from_slice(in_buf);
        in_with_trailer.extend_from_slice(&DEFLATE_TRAILER);

        let mut remaining = in_with_trailer.as_slice();
        loop {
            let (consumed, rc) = self.decompress_stream.step(
                remaining,
                out,
                COMPRESSION_BUFFER_SIZE,
                zlib::FlushValue::NoFlush,
            );
            remaining = &remaining[consumed..];

            // Check for decompression bomb
            if out.len() - initial_len > MAX_DECOMPRESSED_SIZE {
                return Err(DecompressError::TooLarge);
            }

            if rc == zlib::ReturnCode::StreamEnd {
                break;
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

        if self.params.server_no_context_takeover == 1 {
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

        if self.params.client_no_context_takeover == 1 {
            self.compress_stream.reset();
        }

        Ok(())
    }
}

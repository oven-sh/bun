//! Manages the DEFLATE compression and decompression streams for a WebSocket connection.

use bun_core::{feature_flag, handle_oom};
use bun_libdeflate_sys::libdeflate as libdeflate_sys;
use bun_uws_sys::permessage_deflate::{InflateError, TAIL, deflate_message, inflate_message};
use bun_zlib::{Deflater, Inflater, deflate, inflate};

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
pub(crate) type Error = InflateError;

/// The streams are per connection: with context takeover (the default)
/// each message's back-references reach into the previous message's window.
/// The libdeflate fast path is stateless and lives in the VM's
/// `bun_jsc::RareData`, shared by every client on the thread.
pub struct PerMessageDeflate {
    deflater: Box<Deflater>,
    inflater: Inflater,
    compress_no_context_takeover: bool,
    decompress_no_context_takeover: bool,
}

/// There is no 8-bit window for raw deflate. A peer that negotiated 8 bits can still decode
/// 9-bit output, because match distances stay <= 512 - MIN_LOOKAHEAD = 250.
const MIN_RAW_DEFLATE_WINDOW_BITS: u8 = 9;

/// Output space reserved up front for one message. The one-shot libdeflate
/// path gets exactly that space, so it is skipped for compressed inputs at
/// least this large: their output would not fit either.
const INFLATE_BUFFER_SIZE: usize = 128 * 1024;

/// An empty stored block with BFINAL set.
const FINAL_EMPTY_BLOCK: [u8; 5] = [0x01, 0x00, 0x00, 0xff, 0xff];

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

        let compress_window_bits = ours
            .0
            .clamp(MIN_RAW_DEFLATE_WINDOW_BITS, Params::MAX_WINDOW_BITS);
        let decompress_window_bits = theirs
            .0
            .clamp(Params::MIN_WINDOW_BITS, Params::MAX_WINDOW_BITS);
        let options = deflate::Options {
            window_bits: compress_window_bits,
            ..Default::default()
        };

        Box::new(Self {
            deflater: handle_oom(Deflater::new(deflate::Container::Raw, options)),
            inflater: handle_oom(Inflater::with_window_bits(
                inflate::Container::Raw,
                decompress_window_bits,
            )),
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

    /// Inflate one message onto `out`, failing if it exceeds `max_len` bytes. `decompressor`
    /// is the thread's shared libdeflate handle (`None` when it could not be allocated).
    pub(crate) fn decompress(
        &mut self,
        decompressor: Option<&libdeflate_sys::OwnedDecompressor>,
        in_buf: &[u8],
        out: &mut Vec<u8>,
        max_len: usize,
    ) -> Result<(), InflateError> {
        let initial_len = out.len();
        out.try_reserve_exact(INFLATE_BUFFER_SIZE)
            .map_err(|_| InflateError::OutOfMemory)?;

        // libdeflate only inflates a finished stream, so it needs a final block. It also can't see
        // earlier messages, so it only works without context takeover.
        if self.decompress_no_context_takeover
            && Self::can_use_libdeflate(in_buf.len())
            && let Some(decompressor) = decompressor
        {
            let mut finished: Vec<u8> = Vec::new();
            finished
                .try_reserve_exact(in_buf.len() + TAIL.len() + FINAL_EMPTY_BLOCK.len())
                .map_err(|_| InflateError::OutOfMemory)?;
            finished.extend_from_slice(in_buf);
            finished.extend_from_slice(&TAIL);
            finished.extend_from_slice(&FINAL_EMPTY_BLOCK);
            let result =
                decompressor.decompress_to_vec(&finished, out, libdeflate_sys::Encoding::Deflate);
            if result.status == libdeflate_sys::Status::Success {
                // Stopping before the appended block means the peer sent a final block of its own.
                if result.read == finished.len() {
                    if out.len() - initial_len > max_len {
                        return Err(InflateError::TooLarge);
                    }
                    return Ok(());
                }
                out.truncate(initial_len);
            }
        }

        inflate_message(&mut self.inflater, in_buf, out, max_len)?;
        if self.decompress_no_context_takeover {
            self.inflater.reset();
        }
        Ok(())
    }

    pub(crate) fn compress(&mut self, in_buf: &[u8], out: &mut Vec<u8>) -> bun_zlib::Result<()> {
        deflate_message(&mut self.deflater, in_buf, out)?;
        if self.compress_no_context_takeover {
            self.deflater.reset();
        }
        Ok(())
    }
}

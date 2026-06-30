//! The libuv IPC frame codec for Windows `NODE_CHANNEL_FD` interop.
//!
//! Node children frame every IPC byte with libuv's `uv__ipc_frame_header_t`
//! (libuv 1.51 win/pipe.c): 4 little-endian u32s — `flags, reserved1,
//! data_length, reserved2` — optionally followed by a 632-byte
//! socket-transfer record, then `data_length` payload bytes. Our end no
//! longer rides libuv, so this module speaks the frame protocol itself.
//!
//! Dependency-free on purpose: `rustc --test src/jsc/ipc_frame.rs` runs the
//! known-answer tests directly (the bun_jsc cargo test target does not link
//! without the full native build).

/// `sizeof(uv__ipc_frame_header_t)` (STATIC_ASSERT'd to 16 in libuv).
pub(crate) const IPC_FRAME_HEADER_LEN: usize = 16;
/// `sizeof(uv__ipc_socket_xfer_info_t)` (WSAPROTOCOL_INFOW + delayed_error;
/// STATIC_ASSERT'd to 632 in libuv).
const IPC_XFER_INFO_LEN: u32 = 632;
/// `UV__IPC_FRAME_HAS_DATA`.
const IPC_FRAME_HAS_DATA: u32 = 0x01;
/// `UV__IPC_FRAME_HAS_SOCKET_XFER`.
const IPC_FRAME_HAS_SOCKET_XFER: u32 = 0x02;
/// `UV__IPC_FRAME_VALID_FLAGS` (HAS_DATA | HAS_SOCKET_XFER | XFER_IS_TCP_CONNECTION).
const IPC_FRAME_VALID_FLAGS: u32 = 0x07;

/// Encode the 16-byte data-frame header for `payload_len` bytes, exactly as
/// `uv__pipe_write_ipc` does (flags carries HAS_DATA only when nonzero).
pub(crate) fn encode_ipc_frame_header(payload_len: u32) -> [u8; IPC_FRAME_HEADER_LEN] {
    let mut h = [0u8; IPC_FRAME_HEADER_LEN];
    if payload_len > 0 {
        h[0..4].copy_from_slice(&IPC_FRAME_HAS_DATA.to_le_bytes());
        h[8..12].copy_from_slice(&payload_len.to_le_bytes());
    }
    h
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct IpcFrameError;

/// Streaming decoder for the libuv IPC frame protocol. Mirrors
/// `uv__pipe_read_ipc`'s state machine, but over arbitrary read boundaries:
/// partial headers and partial xfer records are accumulated across calls.
#[derive(Default)]
pub(crate) struct IpcFrameDecoder {
    header: [u8; IPC_FRAME_HEADER_LEN],
    header_len: u8,
    /// Payload bytes of the current data frame not yet delivered. No
    /// allocation derives from this — bytes are forwarded as they arrive, so
    /// an adversarial `data_length` cannot amplify (u32 is the wire bound,
    /// same as libuv; the message layer applies its own per-message limits).
    payload_remaining: u32,
    /// Socket-transfer bytes still to skip (handle passing is not accepted;
    /// see `step` for the disposition rationale).
    xfer_remaining: u32,
}

impl IpcFrameDecoder {
    /// Consume a prefix of `chunk`; returns `(payload_run, bytes_consumed)`.
    /// `payload_run` is a (possibly empty) sub-slice of `chunk` holding
    /// message-layer bytes. Errors mirror libuv's `invalid:` paths
    /// (WSAECONNABORTED → caller closes the channel).
    pub(crate) fn step<'a>(&mut self, chunk: &'a [u8]) -> Result<(&'a [u8], usize), IpcFrameError> {
        debug_assert!(!chunk.is_empty());
        // Wire order within one frame is header, xfer record, payload —
        // drain any pending xfer record before payload bytes.
        if self.xfer_remaining > 0 {
            let take = (self.xfer_remaining as usize).min(chunk.len());
            // Skipped, not imported: shipping Bun (libuv ipc=1) queued the
            // record internally and never accepted it, then NACK'd the
            // NODE_HANDLE message — the sender keeps the handle. Same
            // observable protocol behavior, no channel teardown.
            self.xfer_remaining -= take as u32;
            return Ok((&[], take));
        }
        if self.payload_remaining > 0 {
            let take = (self.payload_remaining as usize).min(chunk.len());
            self.payload_remaining -= take as u32;
            return Ok((&chunk[..take], take));
        }
        let need = IPC_FRAME_HEADER_LEN - self.header_len as usize;
        let take = need.min(chunk.len());
        self.header[self.header_len as usize..][..take].copy_from_slice(&chunk[..take]);
        self.header_len += take as u8;
        if self.header_len as usize == IPC_FRAME_HEADER_LEN {
            self.header_len = 0;
            let flags = u32::from_le_bytes(self.header[0..4].try_into().unwrap());
            let data_length = u32::from_le_bytes(self.header[8..12].try_into().unwrap());
            let reserved2 = u32::from_le_bytes(self.header[12..16].try_into().unwrap());
            if flags & !IPC_FRAME_VALID_FLAGS != 0 || reserved2 != 0 {
                return Err(IpcFrameError);
            }
            if flags & IPC_FRAME_HAS_DATA != 0 {
                self.payload_remaining = data_length;
            } else if data_length != 0 {
                return Err(IpcFrameError);
            }
            if flags & IPC_FRAME_HAS_SOCKET_XFER != 0 {
                self.xfer_remaining = IPC_XFER_INFO_LEN;
            }
        }
        Ok((&[], take))
    }
}

/// Known-answer tests. Reference: libuv 1.51 win/pipe.c
/// (`uv__ipc_frame_header_t`, `uv__pipe_write_ipc`, `uv__pipe_read_ipc`).
#[cfg(test)]
mod tests {
    use super::*;

    /// Run `bytes` through the decoder in `chunk`-sized reads, concatenating
    /// delivered payload runs.
    fn decode_chunked(
        dec: &mut IpcFrameDecoder,
        bytes: &[u8],
        chunk: usize,
    ) -> Result<Vec<u8>, IpcFrameError> {
        let mut out = Vec::new();
        for piece in bytes.chunks(chunk.max(1)) {
            let mut rest = piece;
            while !rest.is_empty() {
                let (payload, used) = dec.step(rest)?;
                out.extend_from_slice(payload);
                rest = &rest[used..];
            }
        }
        Ok(out)
    }

    fn frame(payload: &[u8]) -> Vec<u8> {
        let mut v = encode_ipc_frame_header(payload.len() as u32).to_vec();
        v.extend_from_slice(payload);
        v
    }

    #[test]
    fn encode_matches_libuv_layout() {
        // flags=HAS_DATA, reserved1=0, data_length=5, reserved2=0 (all LE).
        assert_eq!(
            encode_ipc_frame_header(5),
            [1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0]
        );
        // Zero payload: flags must be 0 and data_length 0 (libuv asserts
        // data_length == 0 when HAS_DATA is unset).
        assert_eq!(encode_ipc_frame_header(0), [0u8; 16]);
        assert_eq!(
            encode_ipc_frame_header(u32::MAX),
            [1, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, 0, 0, 0, 0]
        );
    }

    #[test]
    fn decode_round_trip_at_every_split() {
        let msgs: [&[u8]; 3] = [b"hello", b"{\"cmd\":\"NODE_HANDLE_ACK\"}\n", &[0u8; 300]];
        let mut wire = Vec::new();
        let mut expect = Vec::new();
        for m in msgs {
            wire.extend_from_slice(&frame(m));
            expect.extend_from_slice(m);
        }
        // Every chunk size from 1 byte (worst-case splits inside header,
        // length field and payload) up to the whole stream.
        for chunk in 1..=wire.len() {
            let mut dec = IpcFrameDecoder::default();
            assert_eq!(
                decode_chunked(&mut dec, &wire, chunk).unwrap(),
                expect,
                "chunk={chunk}"
            );
            assert_eq!(dec.payload_remaining, 0);
            assert_eq!(dec.header_len, 0);
        }
    }

    #[test]
    fn decode_empty_data_frames_are_noops() {
        // flags=0,len=0 (our encoder's empty shape) and flags=HAS_DATA,len=0
        // (libuv accepts it: payload_remaining stays 0).
        let mut wire = encode_ipc_frame_header(0).to_vec();
        wire.extend_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        wire.extend_from_slice(&frame(b"after"));
        let mut dec = IpcFrameDecoder::default();
        assert_eq!(decode_chunked(&mut dec, &wire, 7).unwrap(), b"after");
    }

    #[test]
    fn decode_skips_socket_xfer_frames() {
        // HAS_SOCKET_XFER | XFER_IS_TCP_CONNECTION, no data: header + 632
        // bytes of xfer info are consumed without delivery or error.
        let mut wire = vec![0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        wire.extend_from_slice(&[0xAB; 632]);
        // Combined HAS_DATA | HAS_SOCKET_XFER (TCP server): wire order is
        // header, xfer info, payload.
        wire.extend_from_slice(&[0x03, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0]);
        wire.extend_from_slice(&[0xCD; 632]);
        wire.extend_from_slice(b"data");
        wire.extend_from_slice(&frame(b"tail"));
        for chunk in [1usize, 5, 631, 632, 633, wire.len()] {
            let mut dec = IpcFrameDecoder::default();
            assert_eq!(
                decode_chunked(&mut dec, &wire, chunk).unwrap(),
                b"datatail",
                "chunk={chunk}"
            );
        }
    }

    #[test]
    fn decode_rejects_malformed_headers() {
        // Invalid flag bit (0x08) — libuv: flags & ~VALID_FLAGS → invalid.
        let bad_flags = [0x08u8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert!(decode_chunked(&mut IpcFrameDecoder::default(), &bad_flags, 16).is_err());
        // reserved2 != 0 → invalid.
        let bad_reserved2 = [1u8, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 9, 0, 0, 0];
        assert!(decode_chunked(&mut IpcFrameDecoder::default(), &bad_reserved2, 16).is_err());
        // data_length nonzero without HAS_DATA → invalid.
        let bad_len = [0u8, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0];
        assert!(decode_chunked(&mut IpcFrameDecoder::default(), &bad_len, 16).is_err());
        // Malformed header split across reads still rejects.
        assert!(decode_chunked(&mut IpcFrameDecoder::default(), &bad_flags, 3).is_err());
    }

    #[test]
    fn decode_adversarial_data_length_does_not_allocate() {
        // data_length = u32::MAX: the decoder must accept the header (wire
        // bound is u32, same as libuv), deliver only bytes actually received,
        // and keep exact remaining-count state. No allocation derives from
        // the header.
        let header = encode_ipc_frame_header(u32::MAX);
        let mut dec = IpcFrameDecoder::default();
        let (p, used) = dec.step(&header).unwrap();
        assert!(p.is_empty());
        assert_eq!(used, 16);
        assert_eq!(dec.payload_remaining, u32::MAX);
        let body = [0x55u8; 1000];
        let (p, used) = dec.step(&body).unwrap();
        assert_eq!(p, &body[..]);
        assert_eq!(used, 1000);
        assert_eq!(dec.payload_remaining, u32::MAX - 1000);
    }
}

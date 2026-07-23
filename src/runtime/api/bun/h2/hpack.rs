//! HPACK coder (RFC 7541) over the lshpack binding — the only reused piece in the rewrite.
//!
//! Centralizes the dynamic-table-size-update handling: when the peer changes
//! SETTINGS_HEADER_TABLE_SIZE, the encoder capacity is lowered AND a §6.3 Dynamic Table Size
//! Update opcode is emitted at the start of the next header block so the peer's decoder evicts in
//! lockstep. Decode results alias a shared buffer and MUST be copied before the next call
//! (see lshpack.rs).

#![allow(dead_code)]

use bun_http::lshpack::{DecodeResult, HpackError, HpackHandle};

/// RFC 7541 §6.3: a Dynamic Table Size Update integer never needs more than 6 bytes for a u32.
pub const MAX_SIZE_UPDATE_BYTES: usize = 6;

pub struct Coder {
    hpack: HpackHandle,
    enc_capacity: u32,
    /// A capacity change requested by the peer's SETTINGS_HEADER_TABLE_SIZE, applied + announced at
    /// the start of the next encoded header block. `None` = nothing pending.
    pending_enc_capacity: Option<u32>,
}

impl Coder {
    pub fn new(max_capacity: u32) -> Self {
        Coder {
            hpack: HpackHandle::new(max_capacity),
            enc_capacity: max_capacity,
            pending_enc_capacity: None,
        }
    }

    /// Schedule an encoder capacity change from a received SETTINGS_HEADER_TABLE_SIZE. Applied
    /// lazily so the §6.3 size-update opcode is emitted inside the next header block.
    pub fn queue_encoder_capacity(&mut self, capacity: u32) {
        if capacity == self.enc_capacity && self.pending_enc_capacity.is_none() {
            return;
        }
        self.pending_enc_capacity = Some(capacity);
    }

    /// If a capacity change is pending, apply it and write the §6.3 size-update opcode into `dst` at
    /// `offset`. Returns bytes written (0 if none). `dst[offset..]` needs >= MAX_SIZE_UPDATE_BYTES.
    pub fn take_pending_size_update(&mut self, dst: &mut [u8], offset: usize) -> usize {
        let Some(cap) = self.pending_enc_capacity.take() else {
            return 0;
        };
        self.hpack.set_encoder_max_capacity(cap);
        self.enc_capacity = cap;
        write_table_size_update(dst, offset, cap)
    }

    #[inline]
    pub fn encode(
        &mut self,
        name: &[u8],
        value: &[u8],
        never_index: bool,
        dst: &mut [u8],
        offset: usize,
    ) -> Result<usize, HpackError> {
        self.hpack.encode(name, value, never_index, dst, offset)
    }

    /// Decode one header. Result aliases a shared buffer; copy before the next call.
    #[inline]
    pub fn decode(&mut self, src: &[u8]) -> Result<DecodeResult, HpackError> {
        self.hpack.decode(src)
    }
}

/// RFC 7541 §5.1 + §6.3: encode `value` as a 5-bit-prefix integer with the `001` pattern (0x20)
/// into `dst[offset..]`. Returns bytes written.
pub fn write_table_size_update(dst: &mut [u8], offset: usize, value: u32) -> usize {
    let mut i = offset;
    if value < 31 {
        dst[i] = 0x20 | value as u8;
        return 1;
    }
    dst[i] = 0x20 | 31;
    i += 1;
    let mut rest = value - 31;
    while rest >= 128 {
        dst[i] = (rest as u8) | 0x80;
        i += 1;
        rest >>= 7;
    }
    dst[i] = rest as u8;
    i += 1;
    i - offset
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_update_small() {
        let mut buf = [0u8; 6];
        assert_eq!(write_table_size_update(&mut buf, 0, 30), 1);
        assert_eq!(buf[0], 0x20 | 30);
    }

    #[test]
    fn size_update_large() {
        let mut buf = [0u8; 6];
        // 4096 = 31 + 4065; 4065 = 0b111_1110_0001 -> 0xE1, 0x1F
        let n = write_table_size_update(&mut buf, 0, 4096);
        assert_eq!(buf[0], 0x3f); // 0x20 | 31
        assert!(n >= 2);
    }
}

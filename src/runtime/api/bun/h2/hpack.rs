//! HPACK coder (RFC 7541) over the lshpack binding — the only reused piece in the rewrite.
//!
//! Centralizes the dynamic-table-size-update handling: when the peer changes
//! SETTINGS_HEADER_TABLE_SIZE, the encoder capacity is lowered AND a §6.3 Dynamic Table Size
//! Update opcode is emitted at the start of the next header block so the peer's decoder evicts in
//! lockstep. Decode results alias a shared buffer and MUST be copied before the next call
//! (see lshpack.rs).

#![allow(dead_code)]

use bun_http::lshpack::{DecodeResult, HeaderBlock, HpackError, HpackHandle};

/// Two RFC 7541 §6.3 updates (the minimum, then the final size) of up to 6 bytes each.
pub(crate) const MAX_SIZE_UPDATE_BYTES: usize = 12;

/// RFC 9113 §6.5.2: both sides start at this SETTINGS_HEADER_TABLE_SIZE.
const DEFAULT_HEADER_TABLE_SIZE: u32 = 4096;

/// Node's default `maxDeflateDynamicTableSize`, so a peer can't make us retain more header history.
const MAX_ENCODER_TABLE_SIZE: u32 = 4096;

pub(crate) struct Coder {
    hpack: HpackHandle,
    enc_capacity: u32,
    /// The smallest encoder capacity since the last header block, until a block announces it (RFC 7541 §4.2).
    unannounced_min: Option<u32>,
}

impl Coder {
    pub(crate) fn new() -> Self {
        Coder {
            hpack: HpackHandle::new(DEFAULT_HEADER_TABLE_SIZE),
            enc_capacity: DEFAULT_HEADER_TABLE_SIZE,
            unannounced_min: None,
        }
    }

    /// Call for every SETTINGS_HEADER_TABLE_SIZE entry the peer sends, in wire order.
    pub(crate) fn set_peer_header_table_size(&mut self, size: u32) {
        let capacity = size.min(MAX_ENCODER_TABLE_SIZE);
        if capacity == self.enc_capacity && self.unannounced_min.is_none() {
            return;
        }
        self.hpack.set_encoder_max_capacity(capacity);
        self.enc_capacity = capacity;
        self.unannounced_min = Some(
            self.unannounced_min
                .map_or(capacity, |min| min.min(capacity)),
        );
    }

    /// Call when the peer ACKs our SETTINGS. Until then its encoder still uses the previous size.
    pub(crate) fn set_acked_header_table_size(&mut self, size: u32) {
        self.hpack.set_decoder_max_capacity(size);
    }

    /// Appends the pending §6.3 size updates to `block`, which must be the start of a header block.
    pub(crate) fn take_pending_size_update(&mut self, block: &mut Vec<u8>) {
        let Some(min) = self.unannounced_min.take() else {
            return;
        };
        if min < self.enc_capacity {
            write_table_size_update(block, min);
        }
        write_table_size_update(block, self.enc_capacity);
    }

    /// Appends one whole header block to `dst`. `Err` appends nothing and leaves the encoder unchanged.
    pub(crate) fn encode_block(
        &mut self,
        block: &HeaderBlock,
        dst: &mut Vec<u8>,
    ) -> Result<(), HpackError> {
        let start = dst.len();
        let unannounced_min = self.unannounced_min;
        self.take_pending_size_update(dst);
        let result = self.hpack.encode_block(block, dst);
        if result.is_err() {
            dst.truncate(start);
            self.unannounced_min = unannounced_min;
        }
        result
    }

    #[inline]
    pub(crate) fn encode(
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
    pub(crate) fn decode<'a>(&'a mut self, src: &[u8]) -> Result<DecodeResult<'a>, HpackError> {
        self.hpack.decode(src)
    }
}

/// RFC 7541 §5.1 + §6.3: append `value` as a 5-bit-prefix integer with the `001` pattern (0x20).
fn write_table_size_update(block: &mut Vec<u8>, value: u32) {
    if value < 31 {
        block.push(0x20 | value as u8);
        return;
    }
    block.push(0x20 | 31);
    let mut rest = value - 31;
    while rest >= 128 {
        block.push((rest as u8) | 0x80);
        rest >>= 7;
    }
    block.push(rest as u8);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_update_small() {
        let mut block = Vec::new();
        write_table_size_update(&mut block, 30);
        assert_eq!(block, [0x20 | 30]);
    }

    #[test]
    fn size_update_large() {
        let mut block = Vec::new();
        // 4096 = 31 + 4065; 4065 = 0b11111_1100001 -> 0xE1, 0x1F
        write_table_size_update(&mut block, 4096);
        assert_eq!(block, [0x3f, 0xe1, 0x1f]);
    }
}

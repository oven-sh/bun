//! HPACK coder (RFC 7541) over the lshpack binding — the only reused piece in the rewrite.
//!
//! Centralizes the dynamic-table-size handling: the encoder follows the PEER's
//! SETTINGS_HEADER_TABLE_SIZE and announces each change with a §6.3 Dynamic Table Size Update at
//! the start of the next header block. The decoder follows OUR setting once the peer ACKs it.
//! Decode results alias a shared buffer and MUST be copied before the next call (see lshpack.rs).

#![allow(dead_code)]

use bun_http::lshpack::{DecodeResult, HpackError, HpackHandle};

/// RFC 9113 §6.5.2: the initial SETTINGS_HEADER_TABLE_SIZE of both sides.
pub const DEFAULT_HEADER_TABLE_SIZE: u32 = 4096;

/// A peer must not decide how much header history this side retains. Node's default
/// `maxDeflateDynamicTableSize`.
pub const MAX_ENCODER_TABLE_SIZE: u32 = 4096;

pub struct Coder {
    hpack: HpackHandle,
    enc_capacity: u32,
    /// `Some` while a capacity change is not announced: the smallest capacity since the last
    /// block that was sent. RFC 7541 §4.2 wants that minimum signaled before the final value.
    unannounced_min: Option<u32>,
    /// Our SETTINGS_HEADER_TABLE_SIZE that the peer ACKed last.
    dec_capacity: u32,
}

impl Coder {
    pub fn new() -> Self {
        Coder {
            hpack: HpackHandle::new(DEFAULT_HEADER_TABLE_SIZE),
            enc_capacity: DEFAULT_HEADER_TABLE_SIZE,
            unannounced_min: None,
            dec_capacity: DEFAULT_HEADER_TABLE_SIZE,
        }
    }

    /// Call on the SETTINGS ACK, not when the SETTINGS frame is sent: until the ACK the peer's
    /// encoder still works against the previous value.
    pub fn set_acked_header_table_size(&mut self, size: u32) {
        if size == self.dec_capacity {
            return;
        }
        self.hpack.set_decoder_max_capacity(size);
        self.dec_capacity = size;
    }

    pub fn encoder_capacity(&self) -> u32 {
        self.enc_capacity
    }

    /// Call for every SETTINGS_HEADER_TABLE_SIZE entry of the peer, in wire order.
    pub fn set_peer_header_table_size(&mut self, size: u32) {
        let capacity = size.min(MAX_ENCODER_TABLE_SIZE);
        if capacity == self.enc_capacity && self.unannounced_min.is_none() {
            return;
        }
        self.hpack.set_encoder_max_capacity(capacity);
        self.enc_capacity = capacity;
        self.unannounced_min = Some(match self.unannounced_min {
            Some(min) => min.min(capacity),
            None => capacity,
        });
    }

    /// Call at the start of every outbound header block. The update stays pending until
    /// [`Self::size_update_committed`], so a block that is built but never sent does not lose it.
    pub fn write_pending_size_update(&self, block: &mut Vec<u8>) {
        let Some(min) = self.unannounced_min else {
            return;
        };
        if min < self.enc_capacity {
            write_table_size_update(block, min);
        }
        write_table_size_update(block, self.enc_capacity);
    }

    pub fn size_update_committed(&mut self) {
        self.unannounced_min = None;
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

    /// True when `block` is only §6.3 size updates within the ACKed limit: a valid block with no
    /// field. lshpack applies such updates and then fails [`Self::decode`] because no field
    /// follows, so ask this after that failure.
    pub fn is_size_update_only(&self, block: &[u8]) -> bool {
        let mut rest = block;
        if rest.is_empty() {
            return false;
        }
        while let Some((&first, tail)) = rest.split_first() {
            if first & 0xe0 != 0x20 {
                return false;
            }
            rest = tail;
            let mut value = u64::from(first & 0x1f);
            if value == 0x1f {
                // Up to 4 continuation bytes: the range lshpack accepts without further checks.
                let mut shift = 0;
                loop {
                    let Some((&byte, tail)) = rest.split_first() else {
                        return false;
                    };
                    rest = tail;
                    if shift > 21 {
                        return false;
                    }
                    value += u64::from(byte & 0x7f) << shift;
                    shift += 7;
                    if byte & 0x80 == 0 {
                        break;
                    }
                }
            }
            if value > u64::from(self.dec_capacity) {
                return false;
            }
        }
        true
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

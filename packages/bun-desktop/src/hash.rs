//! A hash that is quick for small keys, and that does not resist an attacker.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

pub type FastMap<K, V> = HashMap<K, V, BuildHasherDefault<FastHasher>>;

#[derive(Clone, Default)]
pub struct FastHasher(u64);

const ODD: u64 = 0x9e37_79b9_7f4a_7c15;

fn fold(a: u64, b: u64) -> u64 {
    let product = u128::from(a) * u128::from(b);
    product as u64 ^ (product >> 64) as u64
}

impl Hasher for FastHasher {
    fn write(&mut self, bytes: &[u8]) {
        let (blocks, rest) = bytes.as_chunks::<16>();
        let mut lanes = [0x243f_6a88_85a3_08d3, 0x1319_8a2e_0370_7344];
        let last = match (
            rest.first_chunk().zip(rest.last_chunk()),
            rest.first_chunk().zip(rest.last_chunk()),
        ) {
            (Some((a, b)), _) => {
                u128::from(u64::from_le_bytes(*a)) << 64 | u128::from(u64::from_le_bytes(*b))
            }
            (_, Some((a, b))) => {
                u128::from(u32::from_le_bytes(*a)) << 32 | u128::from(u32::from_le_bytes(*b))
            }
            _ => rest.iter().fold(0, |all, it| all << 8 | u128::from(*it)),
        };
        for block in blocks
            .iter()
            .map(|it| u128::from_le_bytes(*it))
            .chain([last])
        {
            lanes = [
                lanes[1],
                fold(lanes[0] ^ block as u64, ODD ^ (block >> 64) as u64),
            ];
        }
        self.write_u64(fold(lanes[0] ^ ODD, lanes[1] ^ bytes.len() as u64) ^ lanes[1]);
    }

    fn write_u8(&mut self, value: u8) {
        self.write_u64(value.into());
    }

    fn write_u16(&mut self, value: u16) {
        self.write_u64(value.into());
    }

    fn write_u32(&mut self, value: u32) {
        self.write_u64(value.into());
    }

    fn write_u64(&mut self, value: u64) {
        self.0 = self.0.wrapping_add(value).wrapping_mul(ODD);
    }

    fn write_usize(&mut self, value: usize) {
        self.write_u64(value as u64);
    }

    fn finish(&self) -> u64 {
        self.0.rotate_left(26)
    }
}

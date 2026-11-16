//! Loads, hashes and compares bytes.

pub(super) const HASH_MULTIPLIER_32: u32 = 0x1E35_A7BD;
pub(super) const HASH_MULTIPLIER_64: u64 = 0x1FE3_5A7B_D357_9BD3;

/// The top `bits` bits.
#[inline(always)]
pub(super) const fn hash_of_four(four: u32, bits: u32) -> usize {
    (four.wrapping_mul(HASH_MULTIPLIER_32) >> (32 - bits)) as usize
}

#[inline(always)]
pub(super) fn bytes_at<const N: usize>(data: &[u8], at: usize) -> [u8; N] {
    *data[at..at + N].as_array().unwrap_or(&[0; N])
}

#[inline(always)]
pub(super) fn put_bytes<const N: usize>(data: &mut [u8], at: usize, bytes: [u8; N]) {
    if let Some(target) = data[at..at + N].as_mut_array() {
        *target = bytes;
    }
}

#[inline(always)]
pub(super) fn load32(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes_at(data, at))
}

#[inline(always)]
pub(super) fn load64(data: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(bytes_at(data, at))
}

/// The length of the common prefix.
#[inline(always)]
pub(super) fn match_length(a: &[u8], b: &[u8]) -> usize {
    let mut matched = 0;
    for (a, b) in a.as_chunks().0.iter().zip(b.as_chunks().0) {
        let difference = u128::from_le_bytes(*a) ^ u128::from_le_bytes(*b);
        if difference != 0 {
            return matched + (difference.trailing_zeros() / 8) as usize;
        }
        matched += size_of::<u128>();
    }
    let rest = a[matched..].iter().zip(&b[matched..]);
    matched + rest.take_while(|(a, b)| a == b).count()
}

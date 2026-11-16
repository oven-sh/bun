//! Adler-32 checksum.
//!
//! Follows https://tools.ietf.org/html/rfc1950#section-9.
//!
//! `HashObject.rs` exposes the single-argument `hash(input)`: Adler32 takes no seed.

pub struct Adler32;

const BASE: u32 = 65521;
/// With as many, the compiler vectorizes [`sum_rows`].
const COLUMNS: usize = 32;
/// Sums of sums of as many bytes fit in 16 bits.
const ROWS_IN_GROUP: usize = 16;
/// The same for 32 bits.
const MAX_ROWS: usize = 4096;
/// Fewer are faster byte by byte.
const MIN_ROWS: usize = 4;

/// The sum of all bytes, and the sum in which each counts as often as it is far from the end.
fn sum_rows(rows: &[[u8; COLUMNS]]) -> (u64, u64) {
    // For each column, and the sum of what that was before each row.
    let (mut sums, mut earlier) = ([0u32; COLUMNS], [0u32; COLUMNS]);
    for group in rows.chunks(ROWS_IN_GROUP) {
        let (mut new_sums, mut new_earlier) = ([0u16; COLUMNS], [0u16; COLUMNS]);
        for row in group {
            for column in 0..COLUMNS {
                new_earlier[column] = new_earlier[column].wrapping_add(new_sums[column]);
                new_sums[column] = new_sums[column].wrapping_add(row[column].into());
            }
        }
        for column in 0..COLUMNS {
            earlier[column] += group.len() as u32 * sums[column] + u32::from(new_earlier[column]);
            sums[column] += u32::from(new_sums[column]);
        }
    }
    let (mut plain, mut weighted) = (0, 0);
    for column in 0..COLUMNS {
        let (sum, earlier) = (u64::from(sums[column]), u64::from(earlier[column]));
        plain += sum;
        weighted += COLUMNS as u64 * earlier + (COLUMNS - column) as u64 * sum;
    }
    (plain, weighted)
}

impl Adler32 {
    pub fn hash(mut input: &[u8]) -> u32 {
        let (mut low, mut high) = (1u32, 0u32);
        while input.len() >= MIN_ROWS * COLUMNS {
            let len = (input.len() / COLUMNS).min(MAX_ROWS) * COLUMNS;
            let (rows, rest) = input.split_at(len);
            let (plain, weighted) = sum_rows(rows.as_chunks().0);
            let reduce = |sum: u64| (sum % u64::from(BASE)) as u32;
            high = reduce(u64::from(high) + u64::from(low) * len as u64 + weighted);
            low = reduce(u64::from(low) + plain);
            input = rest;
        }
        for &byte in input {
            low = low.wrapping_add(byte.into());
            high = high.wrapping_add(low);
        }
        ((high % BASE) << 16) | (low % BASE)
    }
}

#[cfg(test)]
mod tests {
    use super::Adler32;

    #[test]
    fn sanity() {
        assert_eq!(Adler32::hash(b"a"), 0x620062);
        assert_eq!(Adler32::hash(b"example"), 0xbc002ed);
    }

    #[test]
    fn long() {
        let long1 = [1u8; 1024];
        assert_eq!(Adler32::hash(&long1), 0x06780401);
        let long2 = [1u8; 1025];
        assert_eq!(Adler32::hash(&long2), 0x0a7a0402);
    }

    #[test]
    fn very_long() {
        let long = [1u8; 5553];
        assert_eq!(Adler32::hash(&long), 0x707f15b2);
    }

    #[test]
    fn very_long_with_variation() {
        let mut long = [0u8; 6000];
        for (i, b) in long.iter_mut().enumerate() {
            *b = i as u8; // @truncate
        }
        assert_eq!(Adler32::hash(&long), 0x5af38d6e);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn each_length_and_the_largest_sums() {
        let varied: Vec<u8> = (0..300_000u32).map(|i| ((i * 7919) >> 5) as u8).collect();
        for input in [varied, vec![255; 300_000]] {
            let (mut low, mut high) = (1, 0);
            for (len, &byte) in input.iter().enumerate() {
                if len < 700 || len % 9973 == 0 || (len + 1) % 131_072 < 3 {
                    assert_eq!(Adler32::hash(&input[..len]), (high << 16) | low);
                }
                low = (low + u32::from(byte)) % 65521;
                high = (high + low) % 65521;
            }
        }
    }
}

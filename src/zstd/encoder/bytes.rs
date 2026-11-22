//! Reads, writes and comparisons of bytes that cannot panic.

use bun_zstd_decoder::array::At;

/// Tells the compiler which loops are worth its registers.
#[inline(always)]
pub(crate) fn likely<T>(found: Option<T>) -> Option<T> {
    if found.is_none() {
        core::hint::cold_path();
    }
    found
}

/// With 32 bits, the end cannot overflow, which leaves one comparison.
#[inline(always)]
pub(crate) fn chunk_at<const N: usize>(bytes: &[u8], at: u32) -> Option<&[u8; N]> {
    bytes.get(at as usize..at as usize + N)?.as_array()
}

/// At least `N` bytes. The compiler sees their number as `last + N`, and compares positions with `last`.
#[derive(Clone, Copy)]
pub(crate) struct AtLeast<'a, const N: usize> {
    pub(crate) bytes: &'a [u8],
    last: usize,
}

impl<'a, const N: usize> AtLeast<'a, N> {
    #[inline(always)]
    pub(crate) fn new(bytes: &'a [u8]) -> Option<Self> {
        let last = bytes.len().checked_sub(N)? as u32 as usize;
        let bytes = bytes.get(..last + N)?;
        Some(Self { bytes, last })
    }

    #[inline(always)]
    pub(crate) fn chunk(self, at: usize) -> Option<&'a [u8; N]> {
        if at > self.last {
            return None;
        }
        self.bytes.get(at..)?.first_chunk()
    }

    #[inline(always)]
    pub(crate) fn word(self, at: usize) -> Option<u64> {
        if at > self.last + (N - 8) {
            return None;
        }
        Some(u64::from_le_bytes(*self.bytes.get(at..)?.first_chunk()?))
    }

    /// Whether there is a chunk at `at`, which may be hard to predict, and `is_match` holds for its first word.
    #[inline(always)]
    pub(crate) fn matches_at<const IS_BRANCHLESS: bool>(
        self,
        at: usize,
        is_match: impl FnOnce(u64) -> bool,
    ) -> bool {
        let is_match = |chunk| is_match(word_in::<0, N>(chunk));
        if !IS_BRANCHLESS {
            return self.chunk(at).is_some_and(is_match);
        }
        self.chunk(at.min(self.last)).is_some_and(is_match) && {
            // Keeps the compiler from testing this first.
            core::hint::black_box(());
            at <= self.last
        }
    }
}

#[inline(always)]
pub(crate) fn chunk_at_mut<const N: usize>(bytes: &mut [u8], at: u32) -> Option<&mut [u8; N]> {
    bytes.get_mut(at as usize..at as usize + N)?.as_mut_array()
}

#[inline(always)]
pub(crate) fn u32_at(bytes: &[u8], at: u32) -> Option<u32> {
    chunk_at(bytes, at).copied().map(u32::from_le_bytes)
}

#[inline(always)]
pub(crate) fn u64_at(bytes: &[u8], at: u32) -> Option<u64> {
    chunk_at(bytes, at).copied().map(u64::from_le_bytes)
}

#[inline(always)]
pub(crate) fn word_in<const AT: usize, const N: usize>(chunk: &[u8; N]) -> u64 {
    const { assert!(AT + 8 <= N) };
    u64_at(chunk, AT as u32).unwrap_or_default()
}

/// Copies `bytes` to the start of `out` if they fit.
#[inline]
pub(crate) fn put(out: &mut [u8], bytes: &[u8]) -> Option<()> {
    out.get_mut(..bytes.len())?.copy_from_slice(bytes);
    Some(())
}

/// How many bytes `a` and `b` start with in common, and whether the next one of `b` is below that of `a`.
#[inline]
pub(crate) fn compare(a: &[u8], b: &[u8]) -> (usize, bool) {
    let len = a.len().min(b.len());
    let (Some(a), Some(b)) = (a.get(..len), b.get(..len)) else {
        return (0, false);
    };
    let ((a_words, a_rest), (b_words, b_rest)) = (a.as_chunks(), b.as_chunks());
    for (index, (a, b)) in a_words.iter().zip(b_words).enumerate() {
        if a != b {
            let difference = u64::from_le_bytes(*a) ^ u64::from_le_bytes(*b);
            let len = index * 8 + (difference.trailing_zeros() / 8) as usize;
            return (len, u64::from_be_bytes(*b) < u64::from_be_bytes(*a));
        }
    }
    let mut rest = a_rest.iter().zip(b_rest).enumerate();
    match rest.find(|(_, (a, b))| a != b) {
        Some((index, (a, b))) => (len - a_rest.len() + index, b < a),
        None => (len, false),
    }
}

/// One bit for each byte, from the lowest up. Compiles to vector instructions, which `zip()` prevents in hardened builds.
#[inline(always)]
pub(crate) fn equal_bytes(a: &[u8; 16], b: &[u8; 16]) -> u16 {
    let mut bits = 0;
    for index in 0..16 {
        bits |= u16::from(a.at(index) == b.at(index)) << index;
    }
    bits
}

#[inline(always)]
pub(crate) fn first_difference(a: &[u8; 16], b: &[u8; 16]) -> Option<u32> {
    if cfg!(target_arch = "x86_64") {
        let different = !equal_bytes(a, b);
        (different != 0).then(|| different.trailing_zeros())
    } else {
        let different = u128::from_le_bytes(*a) ^ u128::from_le_bytes(*b);
        (different != 0).then(|| different.trailing_zeros() / 8)
    }
}

/// How many bytes `a` and `b` end with in common.
#[inline]
pub(crate) fn common_suffix(a: &[u8], b: &[u8]) -> usize {
    let pairs = a.iter().rev().zip(b.iter().rev());
    pairs.take_while(|(a, b)| a == b).count()
}

pub(crate) fn is_one_byte_repeated(bytes: &[u8]) -> bool {
    let first = bytes.first().copied().unwrap_or_default();
    let (chunks, rest) = bytes.as_chunks();
    chunks.iter().all(|chunk| *chunk == [first; 32]) && rest.iter().all(|&byte| byte == first)
}

/// The position of the highest bit that is set. 63 if there is none.
#[inline(always)]
pub(crate) const fn highest_bit(value: u32) -> u32 {
    value.leading_zeros() ^ 31
}

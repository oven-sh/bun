//! For `node:path`.

use bun_simd::Isa;

pub use simd::{
    count_slashes, index_of_untidy_slash, index_of_untidy_slash_or_non_ascii, last_index_of_slash,
    last_index_of_slash_or_dot,
};

/// The lowest bit of `all` that is not in `others`.
#[inline(always)]
fn first_but(all: u64, others: u64) -> Option<u32> {
    let first = all.lowest_one()?;
    // With a branch, the result need not wait for `others`.
    if all.isolate_lowest_one() & others == 0 {
        return Some(first);
    }
    core::hint::cold_path();
    (all & !others).lowest_one()
}

/// Where parts start that are not empty, `.` or `..`. `goes_on` has the lanes inside of parts.
#[inline(always)]
fn names(goes_on: u64, dots: u64, lane: usize) -> u64 {
    goes_on & goes_on >> lane & !(dots >> lane & !(goes_on >> (2 * lane)))
}

#[bun_simd::foreach_target]
mod simd {
    use isa::{I8, U8};

    #[inline(always)]
    fn index_of_untidy<const OR_NON_ASCII: bool>(path: &[u8]) -> Option<usize> {
        let bits = |mask| isa::Isa::movemask(mask).0;
        let is_high = |v: U8| match OR_NON_ASCII {
            true => v.bitcast::<I8>().simd_lt(0).cast(),
            false => v.simd_ne(v),
        };
        // The lanes after `both` count as the end of the path.
        let first_in = |both: &[u8; U8::LEN + 1]| {
            let [v, next] = [U8::from_slice(both), U8::from_slice(&both[1..])];
            let is_suspect = v.simd_eq(b'/') & (next | 1).simd_eq(b'/');
            let (suspects, lane) = isa::Isa::movemask(is_suspect | is_high(v));
            if suspects == 0 {
                return None;
            }
            let names = names(bits(next.simd_ne(b'/')), bits(next.simd_eq(b'.')), lane);
            Some(first_but(suspects, names & !bits(is_high(v)))? as usize / lane)
        };
        let mut rest = path;
        while let Some((both, [_, ..])) = rest.split_first_chunk() {
            rest = match first_in(both) {
                Some(at) if at + 2 < U8::LEN => return Some(path.len() - rest.len() + at),
                Some(_) => &rest[U8::LEN - 2..],
                None => &rest[U8::LEN..],
            };
        }
        if let Some((before, both)) = path.split_last_chunk() {
            let found = first_in(both).map(|at| before.len() + at);
            let is_last = OR_NON_ASCII && !both[U8::LEN].is_ascii();
            return found.or_else(|| is_last.then_some(before.len() + U8::LEN));
        }
        let [v] = U8::load_or_zero(path);
        let before = v.shift_elements_right::<1>(0);
        if (before.simd_eq(b'/') & (v | 1).simd_eq(b'/') | is_high(v)).none() {
            return None;
        }
        let ((slashes, lane), dots) = (isa::Isa::movemask(v.simd_eq(b'/')), bits(v.simd_eq(b'.')));
        let (suspects, high) = (slashes & (slashes | dots) >> lane, bits(is_high(v)));
        let goes_on = !slashes & u64::MAX >> (64 - path.len() * lane);
        let names = names(goes_on, dots, lane) >> lane;
        Some(first_but(suspects | high, names & !high)? as usize / lane)
    }

    /// The first `/` before a part that is empty, `.` or `..`
    #[export(up_to = avx2)]
    pub fn index_of_untidy_slash(path: &[u8]) -> Option<usize> {
        index_of_untidy::<false>(path)
    }

    #[export(up_to = avx2)]
    pub fn index_of_untidy_slash_or_non_ascii(path: &[u8]) -> Option<usize> {
        index_of_untidy::<true>(path)
    }

    // These are for a few dozen bytes. Nothing is dispatched, and they are inlined into plain code.

    #[export(baseline)]
    #[inline]
    pub fn last_index_of_slash(path: &[u8]) -> Option<usize> {
        U8::rposition_near([path], |[v]| v.simd_eq(b'/'))
    }

    #[export(baseline)]
    #[inline]
    pub fn last_index_of_slash_or_dot(path: &[u8]) -> Option<usize> {
        U8::rposition_near([path], |[v]| (v | 1).simd_eq(b'/'))
    }

    #[export(baseline)]
    #[inline]
    pub fn count_slashes(path: &[u8]) -> usize {
        U8::count(path, |v| v.simd_eq(b'/'))
    }
}

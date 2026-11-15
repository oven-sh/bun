//! Port of highway_strings.cpp: a text in a text.
use core::hint::cold_path;

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::U8;

    /// `a` and `b` are the two places in the needle to look for.
    #[inline(always)]
    fn memmem_by(haystack: &[u8], needle: &[u8], a: usize, b: usize) -> Option<usize> {
        let end = haystack.len().checked_sub(needle.len())? + 1;
        let (at_a, at_b) = (
            haystack.get(a..)?.get(..end)?,
            haystack.get(b..)?.get(..end)?,
        );
        let (va, vb) = (U8::splat(*needle.get(a)?), U8::splat(*needle.get(b)?));
        let both = |a: U8, b: U8| a.simd_eq(va) & b.simd_eq(vb);
        let mut budget = haystack.len() * 2 + needle.len() * 32;

        let (Some((_, last_a)), Some((_, last_b))) =
            (at_a.split_last_chunk(), at_b.split_last_chunk())
        else {
            let (short_a, short_b) = (U8::load_partial(at_a)?, U8::load_partial(at_b)?);
            let bits = short_a.to_bitmask(both(short_a.lanes, short_b.lanes));
            return if bits == 0 {
                None
            } else {
                candidates(bits, 0, haystack, needle, &mut budget)?
            };
        };
        let (mut from_a, mut from_b) = (at_a, at_b);
        if let (Some(first_a), Some(first_b)) = (
            at_a.first_chunk::<{ 4 * U8::LEN }>(),
            at_b.first_chunk::<{ 4 * U8::LEN }>(),
        ) {
            let bits = both(U8::from_slice(first_a), U8::from_slice(first_b)).to_bitmask();
            if bits != 0
                && let Some(result) = candidates(bits, 0, haystack, needle, &mut budget)
            {
                return result;
            }
            let from = U8::LEN - at_a.as_ptr().addr() % U8::LEN;
            (from_a, from_b) = (&at_a[from..], &at_b[from..]);
        }
        let ((pairs_a, rest_a), (pairs_b, rest_b)) = (
            from_a.as_chunks::<{ 2 * U8::LEN }>(),
            from_b.as_chunks::<{ 2 * U8::LEN }>(),
        );
        for (pair_a, pair_b) in pairs_a.iter().zip(pairs_b) {
            let both =
                |at: usize| both(U8::from_slice(&pair_a[at..]), U8::from_slice(&pair_b[at..]));
            let (low, high) = (both(0), both(U8::LEN));
            if (low | high).any() {
                cold_path();
                let at = pair_a.as_ptr().addr() - at_a.as_ptr().addr();
                for (both, at) in [(low, at), (high, at + U8::LEN)] {
                    if let Some(result) =
                        candidates(both.to_bitmask(), at, haystack, needle, &mut budget)
                    {
                        return result;
                    }
                }
            }
        }
        for (ca, cb) in rest_a.as_chunks().0.iter().zip(rest_b.as_chunks().0) {
            let both = both(U8::load(ca), U8::load(cb));
            if both.any() {
                cold_path();
                let at = ca.as_ptr().addr() - at_a.as_ptr().addr();
                if let Some(result) =
                    candidates(both.to_bitmask(), at, haystack, needle, &mut budget)
                {
                    return result;
                }
            }
        }
        let left = rest_a.len() % U8::LEN;
        let bits =
            both(U8::load(last_a), U8::load(last_b)).to_bitmask() >> (U8::LEN - 1 - left) >> 1;
        if bits == 0 {
            None
        } else {
            candidates(bits, end - left, haystack, needle, &mut budget)?
        }
    }

    #[inline(never)]
    fn memmem_long(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        let [a, b] = rarest_bytes(needle);
        memmem_by(haystack, needle, a, b)
    }

    #[export]
    pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        match needle.len() {
            0 => Some(0),
            17.. => memmem_long(haystack, needle),
            len => memmem_by(haystack, needle, 0, len - 1),
        }
    }
}

#[inline(never)]
fn rarest_bytes(needle: &[u8]) -> [usize; 2] {
    let mut histogram = [0u32; 256];
    for &b in needle {
        histogram[usize::from(b)] += 1;
    }
    let count = |i: usize| histogram[usize::from(needle[i])];
    let mut p0 = 0;
    for i in 1..needle.len() {
        if count(i) < count(p0) {
            p0 = i;
        }
    }
    let mut p1 = if p0 == needle.len() - 1 {
        0
    } else {
        needle.len() - 1
    };
    for i in 0..needle.len() {
        if i != p0 && (count(i) < count(p1) || (count(i) == count(p1) && i > p1)) {
            p1 = i;
        }
    }
    [p0.min(p1), p0.max(p1)]
}

#[inline(always)]
fn ends_eq<const N: usize>(a: &[u8], b: &[u8]) -> bool {
    a.first_chunk::<N>() == b.first_chunk::<N>() && a.last_chunk::<N>() == b.last_chunk::<N>()
}

#[inline(always)]
fn verify(candidate: &[u8], needle: &[u8]) -> bool {
    match needle.len() {
        32.. => candidate == needle,
        16.. => ends_eq::<16>(candidate, needle),
        8.. => ends_eq::<8>(candidate, needle),
        4.. => ends_eq::<4>(candidate, needle),
        2.. => ends_eq::<2>(candidate, needle),
        _ => candidate == needle,
    }
}

/// The result, once it is known.
#[inline(never)]
fn candidates(
    mut bits: u64,
    at: usize,
    haystack: &[u8],
    needle: &[u8],
    budget: &mut usize,
) -> Option<Option<usize>> {
    while bits != 0 {
        let pos = at + bits.trailing_zeros() as usize;
        if verify(haystack.get(pos..)?.get(..needle.len())?, needle) {
            return Some(Some(pos));
        }
        if *budget <= needle.len() {
            cold_path();
            return Some(two_way(haystack, needle, pos + 1));
        }
        *budget -= needle.len();
        bits &= bits - 1;
    }
    None
}

fn maximal_suffix(needle: &[u8], order: bool) -> (usize, usize) {
    let (mut ms, mut j, mut k, mut p) = (usize::MAX, 0usize, 1usize, 1usize);
    while j + k < needle.len() {
        let (a, b) = (needle[j + k], needle[ms.wrapping_add(k)]);
        if a == b {
            if k == p {
                j += p;
                k = 1;
            } else {
                k += 1;
            }
        } else if (a > b) == order {
            j += k;
            k = 1;
            p = j.wrapping_sub(ms);
        } else {
            ms = j;
            j += 1;
            k = 1;
            p = 1;
        }
    }
    (ms, p)
}

#[inline(never)]
fn two_way(haystack: &[u8], needle: &[u8], start: usize) -> Option<usize> {
    let m = needle.len();
    let ((ms0, p0), (ms1, p1)) = (maximal_suffix(needle, true), maximal_suffix(needle, false));
    let (ms, mut p) = if ms0.wrapping_add(1) > ms1.wrapping_add(1) {
        (ms0, p0)
    } else {
        (ms1, p1)
    };
    let left = ms.wrapping_add(1);
    let mem0 = if needle[..left] == needle[p..p + left] {
        m - p
    } else {
        p = left.max(m - left) + 1;
        0
    };
    let (mut pos, mut mem) = (start, 0);
    while let Some(window) = haystack.get(pos..pos + m) {
        let mut k = left.max(mem);
        while k < m && needle[k] == window[k] {
            k += 1;
        }
        if k < m {
            pos += k.wrapping_sub(ms);
            mem = 0;
            continue;
        }
        k = left;
        while k > mem && needle[k - 1] == window[k - 1] {
            k -= 1;
        }
        if k <= mem {
            return Some(pos);
        }
        pos += p;
        mem = mem0;
    }
    None
}

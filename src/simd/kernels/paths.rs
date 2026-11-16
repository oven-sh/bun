//! Ports of highway_strings.cpp, for `node:path`.

/// Whether the part at `at`, which starts with `/` or `.`, is empty, `.` or `..`
#[inline(always)]
fn is_untidy_part(path: &[u8], at: usize) -> bool {
    let ends_at = |at: usize| path.get(at).is_none_or(|&byte| byte == b'/');
    ends_at(at) || ends_at(at + 1) || path[at + 1] == b'.' && ends_at(at + 2)
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I8, U8};

    #[inline(always)]
    fn index_of_untidy<const OR_NON_ASCII: bool>(path: &[u8]) -> Option<usize> {
        let test = |[v, next]: [U8; 2]| {
            let or_non_ascii = |is_suspect| match OR_NON_ASCII {
                true => is_suspect | v.bitcast::<I8>().simd_lt(0).cast(),
                false => is_suspect,
            };
            let is_suspect = v.simd_eq(b'/') & (next | 1).simd_eq(b'/');
            if or_non_ascii(is_suspect).none() {
                return U8::zero().simd_eq(1);
            }
            let may_end = |v: U8| v.simd_eq(b'/') | v.simd_eq(0);
            let second = U8::zero().shift_in::<{ U8::LEN - 1 }>(next);
            let third = U8::zero().shift_in::<{ U8::LEN - 2 }>(next);
            let is_short = may_end(second) | second.simd_eq(b'.') & may_end(third);
            or_non_ascii(is_suspect & (next.simd_eq(b'/') | is_short))
        };
        let mut rest = path;
        loop {
            let suspect = if rest.len() > U8::LEN {
                U8::position_near::<_, 2, true>([rest, &rest[1..]], test)
            } else {
                let [next] = U8::load_or_zero(rest);
                let lane = test([next.shift_elements_right::<1>(0), next]).first_set();
                lane.map(|lane| lane - 1)
            };
            let Some(at) = suspect else {
                let is_last = OR_NON_ASCII && matches!(rest, [.., 0x80..=0xFF]);
                return is_last.then(|| path.len() - 1);
            };
            if OR_NON_ASCII && *rest.get(at)? != b'/' || is_untidy_part(rest, at + 1) {
                return Some(path.len() - rest.len() + at);
            }
            rest = rest.get(at + 1..)?;
        }
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
        U8::position_near::<_, 1, false>([path], |[v]| v.simd_eq(b'/'))
    }

    #[export(baseline)]
    #[inline]
    pub fn last_index_of_slash_or_dot(path: &[u8]) -> Option<usize> {
        U8::position_near::<_, 1, false>([path], |[v]| (v | 1).simd_eq(b'/'))
    }

    #[export(baseline)]
    #[inline]
    pub fn common_prefix_length(a: &[u8], b: &[u8]) -> usize {
        let differs = U8::position_near::<_, 2, true>([a, b], |[a, b]| a.simd_ne(b));
        differs.unwrap_or_else(|| a.len().min(b.len()))
    }

    #[export(baseline)]
    #[inline]
    pub fn count_slashes(path: &[u8]) -> usize {
        U8::count(path, |v| v.simd_eq(b'/'))
    }
}

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
        let (last, after_first) = (path.split_last()?.0, &path[1..]);
        let found = U8::zip_find_map_near(
            path,
            after_first,
            |v, next| {
                let is_suspect = v.simd_eq(b'/') & (next | 1).simd_eq(b'/');
                match OR_NON_ASCII {
                    true => is_suspect | v.bitcast::<I8>().simd_lt(0).cast(),
                    false => is_suspect,
                }
            },
            |mut suspects| {
                suspects
                    .find(|&at| OR_NON_ASCII && path[at] != b'/' || is_untidy_part(path, at + 1))
            },
        );
        found.or_else(|| (OR_NON_ASCII && !last.is_ascii()).then_some(after_first.len()))
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
        U8::rposition_near(path, |v| v.simd_eq(b'/'))
    }

    #[export(baseline)]
    #[inline]
    pub fn last_index_of_slash_or_dot(path: &[u8]) -> Option<usize> {
        U8::rposition_near(path, |v| (v | 1).simd_eq(b'/'))
    }

    #[export(baseline)]
    #[inline]
    pub fn common_prefix_length(a: &[u8], b: &[u8]) -> usize {
        let differs =
            U8::zip_find_map_near(a, b, |a, b| a.simd_ne(b), |mut matches| matches.next());
        differs.unwrap_or_else(|| a.len().min(b.len()))
    }

    #[export(baseline)]
    #[inline]
    pub fn count_slashes(path: &[u8]) -> usize {
        U8::count(path, |v| v.simd_eq(b'/'))
    }
}

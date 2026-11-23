//! node:path and bun_paths. These look at one or two vectors of 16 bytes: the name at the end of a path, what two paths
//! start with, the folders to leave. A dispatch would double that, so they are for the target that the build is compiled for.

use bun_simd::prelude::{Baseline, Simd, mask8x16, u8x8, u8x16, u8x32};

/// Index of the last byte with `byte | ignored == b'/'`.
#[inline(always)]
fn last_near_end(path: &[u8], ignored: u8) -> Option<usize> {
    let last = |v: u8x16<Baseline>| (v | ignored).simd_eq(b'/').last_set();
    if let Some((mut rest, &block)) = path.split_last_chunk::<16>() {
        // A branch of its own is predicted better.
        if let Some(lane) = last(block.into()) {
            return Some(rest.len() + lane);
        }
        while let Some((before, &block)) = rest.split_last_chunk::<16>() {
            if let Some(lane) = last(block.into()) {
                return Some(before.len() + lane);
            }
            rest = before;
        }
        return last(Simd::load(path));
    }
    if path.len() >= 8 {
        let lane = last(u8x8::<Baseline>::load(path).concat(Simd::load_last(path)))?;
        return Some(if lane < 8 {
            lane
        } else {
            path.len() + lane - 16
        });
    }
    path.iter().rposition(|&byte| byte | ignored == b'/')
}

/// Index of the last `/` of a path, which is expected within a few dozen bytes of the end.
/// [`last_index_of_char`](super::text::last_index_of_char) is for a byte that can be anywhere in a long text.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn last_index_of_slash(path: &[u8]) -> Option<usize> {
    last_near_end(path, 0)
}

/// [`last_index_of_slash`] for a `/` or a `.`, whichever is last.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn last_index_of_slash_or_dot(path: &[u8]) -> Option<usize> {
    last_near_end(path, b'/' ^ b'.')
}

/// How many bytes `a` and `b` start with in common.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn common_prefix_length(a: &[u8], b: &[u8]) -> usize {
    let len = a.len().min(b.len());
    let (a, b) = (&a[..len], &b[..len]);
    if len > 16 {
        let mut at = 0;
        while at < len - 16 {
            let differs = u8x16::<Baseline>::load_at(a, at).simd_ne(Simd::load_at(b, at));
            if let Some(lane) = differs.first_set() {
                return at + lane;
            }
            at += 16;
        }
        let differs = u8x16::<Baseline>::load_last(a).simd_ne(Simd::load_last(b));
        if differs.none() {
            return len;
        }
        return len - 16 + differs.count_before_first();
    }
    if len >= 8 {
        let ends = |it: &[u8]| u8x8::<Baseline>::load(it).concat(Simd::load_last(it));
        let lane = ends(a).simd_ne(ends(b)).count_before_first();
        return if lane < 8 { lane } else { len + lane - 16 };
    }
    a.iter().zip(b).take_while(|(a, b)| a == b).count()
}

/// [`count_char`](super::text::count_char) of `/` for a path of a few dozen bytes.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn count_slashes(path: &[u8]) -> usize {
    if path.len() < 16 {
        return u8x16::<Baseline>::load_or_default(path)
            .simd_eq(b'/')
            .count();
    }
    let (vectors, rest) = u8x16::<Baseline>::over(path).exact();
    let last = u8x16::<Baseline>::load_last(path).simd_eq(b'/');
    let mut count = (!mask8x16::<Baseline>::first_n(16 - rest.len()) & last).count();
    for v in vectors {
        count += v.simd_eq(b'/').count();
    }
    count
}

/// `<[u8]>::is_ascii` for a path or a part of one: a few characters or a few dozen.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn is_ascii_path(path: &[u8]) -> bool {
    if path.len() > 32 {
        let mut seen = u8x32::<Baseline>::load(path) | Simd::load_last(path);
        let mut rest = &path[32..];
        while rest.len() > 32 {
            seen |= Simd::load(rest);
            rest = &rest[32..];
        }
        return seen.cast_signed().is_negative().none();
    }
    if path.len() >= 16 {
        let seen = u8x16::<Baseline>::load(path) | Simd::load_last(path);
        return seen.cast_signed().is_negative().none();
    }
    if let (Some(&first), Some(&last)) = (path.first_chunk(), path.last_chunk()) {
        return (u64::from_ne_bytes(first) | u64::from_ne_bytes(last)) & 0x8080_8080_8080_8080 == 0;
    }
    if let (Some(&first), Some(&last)) = (path.first_chunk(), path.last_chunk()) {
        return (u32::from_ne_bytes(first) | u32::from_ne_bytes(last)) & 0x8080_8080 == 0;
    }
    path.is_empty() || (path[0] | path[path.len() / 2] | path[path.len() - 1]).is_ascii()
}

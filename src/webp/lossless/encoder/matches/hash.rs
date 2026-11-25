//! Which positions are likely to start with the same pixels.

use super::{MAX_LEN, Match, common_len};
use crate::array::At;
use crate::error::Result;
use crate::lossless::Argb;
use crate::slice::InBounds;
use crate::vec;

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.h#L110
const BITS: u32 = 18;
pub(super) const HASHES: usize = 1 << BITS;

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.c#L227
#[inline(always)]
const fn hash(first: u32, second: u32) -> usize {
    let sum = first
        .wrapping_mul(0x5bd1_e996)
        .wrapping_add(second.wrapping_mul(0xc6a4_a793));
    (sum >> (32 - BITS)) as usize
}

/// Calls `found` with each position that can be copied from or to, the hash of what starts there and the pixel that
/// follows what the hash covers. May stop anywhere from `end` on.
#[inline(always)]
pub(super) fn for_each(pixels: &[Argb], end: usize, mut found: impl FnMut(usize, usize, Argb)) {
    let mut at = 0;
    while at < end
        && let Some([first, from_second @ ..]) = pixels.get(at..)
        && let [second, rest @ ..] = from_second
    {
        let third = rest.first();
        if first != second || third != Some(first) {
            found(at, hash(*first, *second), third.copied().unwrap_or(0));
            at += 1;
            continue;
        }
        // In a run all pairs are the same, so how much of it is left takes the place of the second pixel.
        let run = common_len(from_second, rest);
        let next = rest.get(run).copied().unwrap_or(0);
        at += run.saturating_sub(MAX_LEN);
        for left in (1..=run.min(MAX_LEN)).rev() {
            found(at, hash(*first, left as u32), next);
            at += 1;
        }
    }
}

/// For each position, one more than the last position before it with the same hash, or 0.
pub(super) fn links(pixels: &[Argb]) -> Result<Vec<Match>> {
    let mut links = vec::filled(Match::NONE, pixels.len())?;
    if !link_few(pixels, &mut links)? {
        let mut last = vec::array::<_, HASHES>(0)?;
        for_each(pixels, pixels.len(), |at, hash, _| {
            let link = core::mem::replace(last.at_mut(hash), at as u32 + 1);
            links.set(at, Match(link));
        });
    }
    Ok(links)
}

/// It takes longer to clear a table for all hashes than to look for free room in one with the hashes that there are.
/// Returns whether all have found room nearby.
fn link_few(pixels: &[Argb], links: &mut [Match]) -> Result<bool> {
    const LINK_BITS: u32 = 12;
    const NEARBY: usize = 64;
    if pixels.len() >= 1 << LINK_BITS {
        return Ok(false);
    }
    let homes = 2 * pixels.len();
    let mut last = vec::filled(0, homes + NEARBY)?;
    let mut is_complete = true;
    for_each(pixels, pixels.len(), |at, hash, _| {
        let mut nearby = last.iter_mut().skip((hash * homes) >> BITS).take(NEARBY);
        let entry = nearby.find(|it| **it == 0 || **it >> LINK_BITS == hash as u32);
        if let (Some(entry), Some(to)) = (entry, links.get_mut(at)) {
            *to = Match(*entry % (1 << LINK_BITS));
            *entry = (hash as u32) << LINK_BITS | (at as u32 + 1);
        } else {
            is_complete = false;
        }
    });
    Ok(is_complete)
}

//! Matches from so near that the distance is cheap to store.

use core::hint::select_unpredictable;

use super::super::prefix::distance_code;
use super::{MAX_LEN, MIN_LEN, Match, common_len};
use crate::error::Result;
use crate::lossless::{Argb, NEIGHBORS};
use crate::slice::{InBounds, known};
use crate::vec;

const WINDOW: usize = u64::BITS as usize;

struct Near {
    distance: usize,
    /// Whether what is at this distance is at none of the distances from the pixel before.
    is_new: bool,
    /// The end of the last match.
    reach: usize,
    /// Where in the window there is a match of more than `MIN_LEN` pixels, unless the image ends first.
    matches: u64,
    /// Where one starts, if `is_new`. From further on, it is no longer than the best one for the pixel before.
    new_matches: u64,
}

fn distances(width: usize) -> Result<Vec<Near>> {
    const CODES: usize = 32;
    let mut by_code = [0; CODES];
    for &(left, up) in NEIGHBORS.iter().take(CODES) {
        // In a narrow image, several neighbors are the same pixel.
        if let Some(distance @ 1..) = (up as usize * width).checked_add_signed(left.into())
            && let Some(to) = by_code.get_mut(distance_code(distance, width) as usize - 1)
        {
            *to = distance;
        }
    }
    let mut all = vec::with_room(CODES)?;
    let used = by_code.into_iter().filter(|&distance| distance != 0);
    all.extend(used.map(|distance| Near {
        distance,
        is_new: distance == 1 || !by_code.contains(&(distance - 1)),
        reach: 0,
        matches: 0,
        new_matches: 0,
    }));
    Ok(all)
}

// Once it is inlined, the bits may not be collected with vector instructions any more.
#[inline(never)]
fn equal(a: &[u8; WINDOW], b: &[u8; WINDOW]) -> u64 {
    let (a, b) = (a.as_chunks::<16>().0, b.as_chunks::<16>().0);
    let mut all = 0;
    for (shift, (a, b)) in (0..).step_by(16).zip(a.iter().zip(b)) {
        let mut equal = 0u16;
        for (i, (a, b)) in a.iter().zip(b).enumerate() {
            equal |= u16::from(a == b) << i;
        }
        all |= u64::from(equal) << shift;
    }
    all
}

/// A bit for each pixel from the one before `first` on.
#[derive(Default)]
struct Window {
    first: usize,
    end: usize,
    /// At any distance.
    matches: u64,
    new_matches: u64,
}

impl Window {
    /// `greens` has `WINDOW` more bytes on either side.
    fn new(first: usize, greens: &[u8], all: &mut [Near]) -> Self {
        let from = |start: usize| greens.part(start..).first_chunk::<WINDOW>();
        let start = WINDOW + first - 1;
        let here = known(from(start));
        let mut window = Self {
            first,
            end: first + WINDOW - 1 - MIN_LEN,
            ..Self::default()
        };
        for near in all {
            let source = start.checked_sub(near.distance).and_then(from);
            let Some((here, source)) = here.zip(source) else {
                continue;
            };
            let before_image = (near.distance + 1).saturating_sub(first);
            let equal = equal(here, source) & u64::MAX.unbounded_shl(before_image as u32);
            near.matches = (1..=MIN_LEN).fold(equal, |all, ahead| all & equal >> ahead);
            window.matches |= near.matches;
            if near.is_new {
                near.new_matches = near.matches & !(equal << 1);
                window.new_matches |= near.new_matches;
            }
        }
        window
    }
}

/// Replaces `matches`. For pixels that differ in nothing but green.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.c#L586
pub(in super::super) fn keep_near(
    matches: &mut [Match],
    pixels: &[Argb],
    width: usize,
) -> Result<()> {
    let mut all = distances(width)?;
    let mut greens = vec::with_room(pixels.len() + 2 * WINDOW)?;
    greens.extend([0; WINDOW]);
    greens.extend(pixels.iter().map(|&pixel| (pixel >> 8) as u8));
    greens.extend([0; WINDOW]);

    let mut window = Window::default();
    let mut previous = Match::NONE;
    for (at, found) in matches.iter_mut().enumerate() {
        let is_near = |found: Match| all.iter().any(|near| near.distance == found.distance());
        if found.len() == MAX_LEN && (*found == previous || is_near(*found)) {
            previous = *found;
            continue;
        }
        if at >= window.end {
            window = Window::new(at, &greens, &mut all);
        }
        let bit = 1 << (1 + at - window.first);
        let goes_on = !matches!(previous.len(), 0 | MAX_LEN);
        let (mut best, candidates) = if goes_on {
            let rest = Match::new(previous.distance(), previous.len() - 1);
            (rest, window.new_matches)
        } else {
            (Match::NONE, window.matches)
        };
        if candidates & bit != 0 {
            let end = pixels.len().min(at + MAX_LEN);
            for near in &mut all {
                let matches = select_unpredictable(goes_on, near.new_matches, near.matches);
                let behind_best = WINDOW + at + best.len();
                if matches & bit == 0
                    || greens.get(behind_best) != greens.get(behind_best - near.distance)
                {
                    continue;
                }
                let start = near.reach.max(at);
                let source = pixels.part(start - near.distance..);
                near.reach = start + common_len(source, pixels.part(start..end));
                if near.reach - at > best.len() {
                    best = Match::new(near.distance, near.reach - at);
                    if best.len() == MAX_LEN {
                        break;
                    }
                }
            }
        }
        *found = if best.len() > MIN_LEN {
            best
        } else {
            Match::NONE
        };
        previous = *found;
    }
    Ok(())
}

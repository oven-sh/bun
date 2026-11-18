//! What the code units around a position tell about boundaries.

use core::ops::Range;

use bun_engine_text::Text;

use super::Granularity;

const CR: u16 = 0x0d;
const LF: u16 = 0x0a;

/// The grapheme cluster around `index`, which is inside `text`.
pub(super) fn grapheme_around(text: Text<'_>, index: usize) -> Option<Range<usize>> {
    let start = match index.checked_sub(1).map(|before| text.at(before)) {
        Some(CR) if text.at(index) == LF => index - 1,
        Some(before) if !stands_alone(before) || !stands_alone(text.at(index)) => return None,
        _ => index,
    };
    Some(start..grapheme_end(text, start)?)
}

/// Of the cluster that starts at `start`, which is inside `text`.
#[inline]
pub(super) fn grapheme_end(text: Text<'_>, start: usize) -> Option<usize> {
    match (text.at(start), text.get(start + 1)) {
        (CR, Some(LF)) => Some(start + 2),
        (first, Some(next)) if !stands_alone(first) || !stands_alone(next) => None,
        _ => Some(start + 1),
    }
}

/// No rule of UAX #29 but the one for CR LF joins two of these.
fn stands_alone(unit: u16) -> bool {
    matches!(
        unit,
        0..0x300 | 0x370..0x483 | 0x48a..0x591 | 0x3041..0x3099 | 0x309b..0xa000 | 0xac00..0xd7a4
    )
}

/// Whether a segment starts not far before `index`. It can be false all the same.
pub(super) fn follows_boundary_closely(
    text: Text<'_>,
    index: usize,
    granularity: Granularity,
) -> bool {
    let reach = match granularity {
        Granularity::Grapheme => 64,
        Granularity::Word => 256,
        Granularity::Sentence => 1024,
    };
    index
        .checked_sub(reach)
        .is_none_or(|start| last_boundary(text, start..index, granularity).is_some())
}

/// The last evident one that has two units of `before` behind it, or is at its end.
pub(super) fn last_boundary(
    text: Text<'_>,
    before: Range<usize>,
    granularity: Granularity,
) -> Option<usize> {
    (before.start + 2..=before.end).rfind(|&at| {
        let (before, after) = (text.at(at - 1), text.at(at));
        before == LF
            || match granularity {
                Granularity::Grapheme => stands_alone(after),
                Granularity::Word => {
                    matches!(after, 0x3001 | 0x3002) || (after == 0x20 && !is_space(before))
                }
                Granularity::Sentence => starts_sentence(text.at(at - 2), before, after),
            }
    })
}

/// Word_Break=WSegSpace, and a few more.
fn is_space(unit: u16) -> bool {
    matches!(unit, 0x20 | 0x1680 | 0x2000..=0x200a | 0x205f | 0x3000)
}

fn starts_sentence(second_before: u16, before: u16, after: u16) -> bool {
    matches!(
        (second_before, before, after),
        (0x21 | 0x2e | 0x3f, 0x20, 0x41..=0x5a | 0x391..=0x3a9 | 0x410..=0x42f)
            | (_, 0x3002, 0x3041..0x3099 | 0x30a1..0x30fb | 0x4e00..0xa000)
    )
}

//! The source as bytes, whichever width it has.

use core::ops::Range;

use bun_engine_text::Text;
use bun_engine_unicode::{is_line_terminator, is_white_space};

/// Stands for any unit above 0xff that is neither white space nor the end of a line, and for itself.
pub(crate) const WIDE_UNIT: u8 = 0x80;
const NO_BREAK_SPACE: u8 = 0xa0;

#[derive(Clone, Copy)]
pub(crate) struct Source<'a> {
    pub(crate) text: Text<'a>,
    /// One for each unit of `text`, as [`narrow`] makes them.
    pub(crate) bytes: &'a [u8],
}

impl<'a> Source<'a> {
    #[inline]
    pub(crate) fn slice(self, start: u32, end: u32) -> Text<'a> {
        self.text.slice(start as usize..end as usize)
    }
}

/// Writes `range` of `bytes`. A unit above 0xff becomes a byte that takes the same part in the lexical grammar.
pub(crate) fn narrow(units: &[u16], range: Range<usize>, bytes: &mut Vec<u8>) {
    const BLOCK: usize = 64;
    if bytes.len() < range.end {
        bytes.resize(range.end, 0);
    }
    let targets = bytes[range.clone()].chunks_mut(BLOCK);
    for (target, block) in targets.zip(units[range].chunks(BLOCK)) {
        let mut all = 0;
        for (byte, &unit) in target.iter_mut().zip(block) {
            *byte = unit as u8;
            all |= unit;
        }
        if all > 0xff {
            narrow_wide_units(block, target);
        }
    }
}

fn narrow_wide_units(units: &[u16], bytes: &mut [u8]) {
    for (byte, &unit) in bytes.iter_mut().zip(units) {
        if unit > 0xff {
            *byte = if is_line_terminator(u32::from(unit)) {
                b'\n'
            } else if is_white_space(u32::from(unit)) {
                NO_BREAK_SPACE
            } else {
                WIDE_UNIT
            };
        }
    }
}

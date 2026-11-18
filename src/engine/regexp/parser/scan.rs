//! Looks ahead of the parser.

use bun_engine_text::CodeUnit;

use super::cursor;

const MAX_SIZE: usize = 1 << 20;
const MAX_SIZE_WITH_PLAIN_CLASSES: usize = 1 << 22;

#[inline]
pub(super) fn is_too_large<C: CodeUnit>(units: &[C], has_class_sets: bool) -> bool {
    units.len() > MAX_SIZE
        && (units.len() > MAX_SIZE_WITH_PLAIN_CLASSES
            || units.len() - units_in_plain_classes(units, has_class_sets) > MAX_SIZE)
}

/// After the left bracket of classes that have nothing but characters and ranges: such a class is one sorted list.
#[cold]
fn units_in_plain_classes<C: CodeUnit>(units: &[C], has_class_sets: bool) -> usize {
    let ascii = |at: usize| units.get(at).map_or(0, |unit| cursor::ascii(unit.to_u32()));
    let (mut total, mut depth, mut contents, mut is_plain) = (0, 0usize, 0, true);
    let mut at = 0;
    while at < units.len() {
        match ascii(at) {
            b'\\' => {
                at += 1;
                is_plain &=
                    !matches!(ascii(at) | 0x20, b'd' | b's' | b'w' | b'p') && ascii(at) != b'q';
            }
            b'[' if depth == 0 => (depth, contents, is_plain) = (1, at + 1, true),
            b']' if depth > 0 => {
                depth -= 1;
                if depth == 0 && is_plain {
                    total += at + 1 - contents;
                }
            }
            b'[' if has_class_sets => (depth, is_plain) = (depth + 1, false),
            operator @ (b'-' | b'&') if has_class_sets => is_plain &= ascii(at + 1) != operator,
            _ => {}
        }
        at += 1;
    }
    if depth > 0 && is_plain {
        total += units.len() - contents;
    }
    total
}

#[derive(Clone, Copy)]
pub(super) struct GroupTotals {
    pub(super) count: u32,
    pub(super) has_names: bool,
}

/// Of a pattern without `u` and `v`.
#[cold]
pub(super) fn group_totals<C: CodeUnit>(units: &[C]) -> GroupTotals {
    let is = |at: usize, ascii: u8| units.get(at).is_some_and(|unit| unit.is(ascii));
    let mut totals = GroupTotals {
        count: 0,
        has_names: false,
    };
    let (mut at, mut is_in_class) = (0, false);
    while let Some(unit) = units.get(at) {
        at += 1;
        if unit.is(b'\\') {
            at += 1;
        } else if is_in_class {
            is_in_class = !unit.is(b']');
        } else if unit.is(b'[') {
            is_in_class = true;
        } else if unit.is(b'(') {
            let is_named =
                is(at, b'?') && is(at + 1, b'<') && !is(at + 2, b'=') && !is(at + 2, b'!');
            totals.has_names |= is_named;
            totals.count += u32::from(is_named || !is(at, b'?'));
        }
    }
    totals
}

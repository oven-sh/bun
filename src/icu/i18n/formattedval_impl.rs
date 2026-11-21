//! A text with a field for each code unit, and spans for the numbers of a range. ICU4C: formattedval_sbimpl.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::slice_ext::{SliceExt, to_length};
use crate::common::ubidi_props::ubidi_is_bidi_control;
use crate::common::uchar::{is_variation_selector, u_char_type};
use crate::common::unicode::uchar::U_SPACE_SEPARATOR;
use crate::common::utf16;
use crate::common::utypes::*;
use crate::i18n::formatted_string_builder::{Field, FormattedStringBuilder, UNDEFINED_FIELD};
use crate::i18n::formattedvalue::{ConstrainedFieldPosition, FormattedValue};
use crate::i18n::unicode::uformattedvalue::UFIELD_CATEGORY_NUMBER_RANGE_SPAN;
use crate::i18n::unicode::unum::{UNUM_GROUPING_SEPARATOR_FIELD, UNUM_INTEGER_FIELD};

#[derive(Clone, Copy, Default)]
struct Span {
    start: usize,
    length: usize,
}

pub(crate) struct FormattedValueStringBuilderImpl {
    string: FormattedStringBuilder,
    /// The field reported for a whole number in addition to its parts, or `UNDEFINED_FIELD` for none.
    numeric_field: Field,
    /// The index of a span is its field.
    spans: ArrayVec<Span, 2>,
}

const INTEGER: Field = Field::number(UNUM_INTEGER_FIELD);
const GROUPING_SEPARATOR: Field = Field::number(UNUM_GROUPING_SEPARATOR_FIELD);

fn is_int_or_group(field: Field) -> bool {
    field == INTEGER || field == GROUPING_SEPARATOR
}

/// `[[:Zs:][\u0009][:Bidi_Control:][:Variation_Selector:]]`. ICU4C: static_unicode_sets.cpp
fn is_default_ignorable(c: u32) -> bool {
    u_char_type(c) == U_SPACE_SEPARATOR
        || c == 9
        || ubidi_is_bidi_control(c)
        || is_variation_selector(c)
}

/// Skips the property lookup for printable ASCII, which covers most digits and signs.
fn is_ignorable(c: u32) -> bool {
    !u8::try_from(c).is_ok_and(|c| c.is_ascii_graphic()) && is_default_ignorable(c)
}

fn is_current(cfpos: &ConstrainedFieldPosition, field: Field) -> bool {
    cfpos.category() == field.get_category() && cfpos.field() == field.get_field()
}

/// Sets `cfpos` to the field and returns true. The casts are lossless: a text has fewer than 2^31 code units.
fn set_found(
    cfpos: &mut ConstrainedFieldPosition,
    field: Field,
    start: usize,
    limit: usize,
) -> bool {
    cfpos.set_state(
        field.get_category(),
        field.get_field(),
        start as i32,
        limit as i32,
    );
    true
}

impl FormattedValueStringBuilderImpl {
    pub(crate) fn new(numeric_field: Field) -> Self {
        Self {
            string: FormattedStringBuilder::new(),
            numeric_field,
            spans: ArrayVec::new(),
        }
    }

    pub(crate) fn get_string_ref(&mut self) -> &mut FormattedStringBuilder {
        &mut self.string
    }

    pub(crate) fn string(&self) -> &FormattedStringBuilder {
        &self.string
    }

    pub(crate) fn reset_string(&mut self) {
        self.string.clear();
        self.spans = ArrayVec::new();
    }

    /// Terminates the text at the end of a formatting call. Returns the failure in `outcome`, else the string's.
    pub(crate) fn finish(&mut self, outcome: Result<(), UErrorCode>) -> Result<(), UErrorCode> {
        self.string.write_terminator();
        outcome.and_then(|()| self.string.outcome())
    }

    pub(crate) fn append_span(&mut self, start: usize, length: usize) {
        self.spans.push(Span { start, length });
    }

    /// Calls `add(field, start, limit)` for each field.
    pub(crate) fn get_all_field_positions(&self, mut add: impl FnMut(i32, i32, i32)) {
        let mut cfpos = ConstrainedFieldPosition::default();
        while self.next_field(&mut cfpos) {
            add(cfpos.field(), cfpos.start(), cfpos.limit());
        }
    }

    fn span(&self, context: i64) -> Option<Span> {
        self.spans.get(usize::try_from(context).ok()?).copied()
    }

    /// Reports a span before its fields, and the integer and `numeric_field` after their parts.
    fn next_field(&self, cfpos: &mut ConstrainedFieldPosition) -> bool {
        let (fields, numeric_field) = (self.string.fields(), self.numeric_field);
        let field_at = |i: usize| fields.get(i).copied().unwrap_or(UNDEFINED_FIELD);
        let start_of = |end: usize, is_part: fn(Field) -> bool| {
            end - fields
                .slice(..end)
                .iter()
                .rev()
                .take_while(|&&field| is_part(field))
                .count()
        };
        // The iteration context is the number of spans passed.
        let mut next_span = self.span(cfpos.iteration_context());
        let mut prev_is_span = cfpos.category() == UFIELD_CATEGORY_NUMBER_RANGE_SPAN;
        let mut i = to_length(if prev_is_span {
            cfpos.start()
        } else {
            cfpos.limit()
        });

        // Visits only the positions at which a field or a span starts.
        let has_numeric = numeric_field != UNDEFINED_FIELD;
        let mut is_first = true;
        while let Some(rest) = fields.get(i..) {
            let (before, field) = (field_at(i.wrapping_sub(1)), field_at(i));
            let was_reported = |field| is_first && is_current(cfpos, field);
            if before.is_numeric() && !(has_numeric && was_reported(numeric_field)) {
                if is_int_or_group(before) && !is_int_or_group(field) && !was_reported(INTEGER) {
                    return set_found(cfpos, INTEGER, start_of(i, is_int_or_group), i);
                }
                if has_numeric && !field.is_numeric() {
                    return set_found(cfpos, numeric_field, start_of(i, Field::is_numeric), i);
                }
            }
            is_first = false;
            while let Some(span) = next_span.filter(|span| !prev_is_span && span.start == i) {
                let context = cfpos.iteration_context();
                cfpos.set_iteration_context(context + 1);
                if span.length != 0 {
                    let (start, limit) = (i as i32, (i + span.length) as i32);
                    let category = UFIELD_CATEGORY_NUMBER_RANGE_SPAN;
                    cfpos.set_state(category, context as i32, start, limit);
                    return true;
                }
                // An empty last span ends the iteration.
                next_span = self.span(context + 1);
                if next_span.is_none() {
                    return false;
                }
            }
            if rest.is_empty() {
                break;
            }
            let mut next = i + rest.iter().take_while(|&&other| other == field).count();
            if field != INTEGER && !field.is_undefined() {
                // Not trimmed: a grouping separator may be white space.
                if field == GROUPING_SEPARATOR {
                    return set_found(cfpos, field, i, next);
                }
                if let Some((start, end)) = self.trim(i, next) {
                    return set_found(cfpos, field, start, end);
                }
            } else if let Some(span) = next_span.filter(|span| span.start > i) {
                next = next.min(span.start);
            }
            (i, prev_is_span) = (next, false);
        }
        false
    }

    /// Trims ignorable characters from both ends of the range. Returns `None` if nothing is left.
    #[inline(never)]
    fn trim(&self, start: usize, mut end: usize) -> Option<(usize, usize)> {
        let chars = self.string.chars();
        let mut before = end;
        while is_ignorable(utf16::prev(chars, &mut before)) {
            end = before;
            if end <= start {
                return None;
            }
        }
        let front = utf16::code_points(chars.slice(start..end)).take_while(|&c| is_ignorable(c));
        Some((start + front.map(utf16::length).sum::<usize>(), end))
    }
}

impl FormattedValue for FormattedValueStringBuilderImpl {
    fn terminated_text(&self) -> &[u16] {
        self.string.chars_with_nul()
    }

    fn next_position(&self, cfpos: &mut ConstrainedFieldPosition) -> bool {
        // No supported constraint matches a field of numbers or relative times.
        let is_found = !cfpos.is_constrained() && self.next_field(cfpos);
        if !is_found {
            cfpos.set_to_end(self.string.len());
        }
        is_found
    }
}

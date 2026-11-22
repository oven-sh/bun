//! The text and the fields of a formatted date interval. ICU4C: formattedval_iterimpl.cpp

use crate::common::memory::{try_extend_from_slice, try_push};
use crate::common::slice_ext::to_length;
use crate::common::sorting::sort_in_place_by;
use crate::common::utypes::UErrorCode;
use crate::i18n::formattedvalue::{ConstrainedFieldPosition, FormattedValue};
use crate::i18n::fphdlimp::Attribute;
use crate::i18n::unicode::udat::{UDAT_MONTH_FIELD, UDAT_STANDALONE_MONTH_FIELD};
use crate::i18n::unicode::uformattedvalue::UFIELD_CATEGORY_DATE_INTERVAL_SPAN;

pub(crate) struct FormattedDateInterval {
    /// Includes the terminating NUL.
    string: Vec<u16>,
    fields: Vec<Attribute>,
}

impl FormattedDateInterval {
    /// `later_date_first` is `None` for a single date.
    pub(crate) fn new(
        mut string: Vec<u16>,
        fields: Vec<Attribute>,
        later_date_first: Option<bool>,
    ) -> Result<Self, UErrorCode> {
        try_push(&mut string, 0)?;
        let mut value = Self { string, fields };
        if let Some(later_date_first) = later_date_first {
            value.add_overlap_spans(later_date_first.into())?;
            sort_in_place_by(&mut value.fields, |a, b| {
                (a.start, b.limit, b.category, a.field)
                    .cmp(&(b.start, a.limit, a.category, b.field))
            });
        }
        Ok(value)
    }

    /// Adds two spans that cover the first and the second occurrences of repeated fields: `..a.[b.c].d.[b.e.c]..`
    fn add_overlap_spans(&mut self, first_index: i32) -> Result<(), UErrorCode> {
        // A stand-alone month counts as a month, unless that makes the spans overlap.
        let mut spans = self.overlap_spans(first_index, UDAT_MONTH_FIELD);
        if spans[0].limit > spans[1].start {
            spans = self.overlap_spans(first_index, UDAT_STANDALONE_MONTH_FIELD);
        }
        if spans[0].start == i32::MAX {
            return Ok(());
        }
        try_extend_from_slice(&mut self.fields, &spans)
    }

    /// Treats a stand-alone month as the field `month`.
    fn overlap_spans(&self, first_index: i32, month: i32) -> [Attribute; 2] {
        let kind = |field| {
            if field == UDAT_STANDALONE_MONTH_FIELD {
                month
            } else {
                field
            }
        };
        let mut spans = [first_index, 1 - first_index].map(|field| Attribute {
            category: UFIELD_CATEGORY_DATE_INTERVAL_SPAN,
            field,
            start: i32::MAX,
            limit: 0,
        });
        let mut rest = self.fields.iter();
        while let Some(first) = rest.next() {
            if let Some(second) = rest
                .clone()
                .find(|second| kind(second.field) == kind(first.field))
            {
                for (span, part) in spans.iter_mut().zip([first, second]) {
                    (span.start, span.limit) =
                        (span.start.min(part.start), span.limit.max(part.limit));
                }
            }
        }
        spans
    }
}

impl FormattedValue for FormattedDateInterval {
    fn terminated_text(&self) -> &[u16] {
        &self.string
    }

    /// The iteration context is the index of the next field to check.
    fn next_position(&self, cfpos: &mut ConstrainedFieldPosition) -> bool {
        let first = cfpos.iteration_context() as i32;
        let mut rest = self.fields.iter().enumerate().skip(to_length(first));
        let found = rest.find(|(_, field)| cfpos.matches_category(field.category));
        let next = match found {
            Some((i, field)) => {
                cfpos.set_state(field.category, field.field, field.start, field.limit);
                i as i32 + 1
            }
            None => first.max(self.fields.len() as i32),
        };
        cfpos.set_iteration_context(next.into());
        found.is_some()
    }
}

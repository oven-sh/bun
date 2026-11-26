//! The plural parts of rules for numerals: "$(cardinal,one{day}other{days})$". ICU4C: plurfmt.cpp

use crate::common::memory::Appendable;
use crate::common::messagepattern::{
    Cases, Message, MessagePattern, OTHER, Piece, append_reduced_apostrophes,
};
use crate::common::sink::MAX_STRING_CAPACITY;
use crate::common::slice_ext::SoftUnwrap;
use crate::common::utypes::*;
use crate::i18n::decimfmt::DecimalFormat;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_fluent::UFormattedNumberData;
use crate::i18n::plurrule::PluralRules;

// ICU4C: plurfmt.cpp, PluralFormat::findSubMessage
fn find_sub_message<'a>(cases: Cases<'a>, number: f64, keyword: &[u8]) -> Message<'a> {
    let (mut keyword_message, mut other_message) = (None, None);
    let keyword = keyword.iter().map(|&c| u16::from(c));
    for case in cases {
        match case.value {
            Some(value) if value == number => return case.message,
            Some(_) => {}
            None if case.selector == OTHER => other_message = other_message.or(Some(case.message)),
            None if case.selector.iter().copied().eq(keyword.clone()) => {
                keyword_message = keyword_message.or(Some(case.message))
            }
            None => {}
        }
    }
    keyword_message.or(other_message).soft_unwrap()
}

pub(crate) struct PluralFormat {
    plural_rules: PluralRules,
    pattern: MessagePattern,
    case_count: usize,
}

impl PluralFormat {
    pub(crate) fn new(plural_rules: PluralRules, pattern: &[u16]) -> Result<Self, UErrorCode> {
        let pattern = MessagePattern::from_plural_style(pattern)?;
        Ok(Self {
            plural_rules,
            case_count: pattern.cases().count(),
            pattern,
        })
    }

    /// The number as `number_format` rounds it selects the message. Returns the cost of the call.
    pub(crate) fn format(
        &self,
        number_format: &DecimalFormat,
        number: i64,
        append_to: &mut Vec<u16>,
    ) -> Result<usize, UErrorCode> {
        let mut cases = self.pattern.cases();
        let (offset, mut shown) = (cases.take_offset(), UFormattedNumberData::new());
        if offset == 0.0 {
            shown.quantity = DecimalQuantity::from_long(number);
        } else {
            shown.quantity.set_to_double(number as f64 - offset);
        }
        number_format.formatter.format(&mut shown)?;
        let keyword = self.plural_rules.select_keyword(&shown.quantity);
        let message = find_sub_message(cases, number as f64, keyword.to_bytes());
        let piece_count = append_message(message, shown.text(), append_to);
        Ok(shown.text().len() / 2 + self.case_count / 3 + piece_count / 8)
    }
}

/// Keeps quoting apostrophes and does not format arguments. Returns the number of pieces.
fn append_message(message: Message<'_>, number: &[u16], append_to: &mut Vec<u16>) -> usize {
    let mut count = 0;
    for (literal, piece) in message {
        count += 1;
        append_to.add_all(literal);
        match piece {
            Piece::SkipSyntax => append_to.add(u16::from(b'\'')),
            Piece::ReplaceNumber if append_to.len() <= MAX_STRING_CAPACITY => {
                append_to.add_all(number)
            }
            Piece::Arg(text) => append_reduced_apostrophes(text, append_to),
            Piece::ReplaceNumber | Piece::InsertCharOrLimit => {}
        }
    }
    if append_to.len() > MAX_STRING_CAPACITY {
        *append_to = Vec::new();
    }
    count
}

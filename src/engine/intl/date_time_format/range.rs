use bun_engine_text::StringRef;
use bun_icu::formatted_value::{Category, FormattedValue};

use super::text::{DateText, PartSplitter, use_plain_spaces};
use crate::error::IcuResult;
use crate::parts::new_string;
use crate::{Parts, Result, Source};

pub(super) const RANGE_FAILURE: &str = "Failed to format date interval";

pub(super) fn shows_both_ends(range: FormattedValue<'_>) -> Result<bool> {
    (range.fields_in(Category::DATE_INTERVAL_SPAN))
        .and_then(|mut spans| spans.next())
        .map(|span| span.is_some())
        .or_type_error(RANGE_FAILURE)
}

fn text(range: FormattedValue<'_>) -> Result<DateText> {
    let mut text = DateText::from_slice(range.text().or_type_error(RANGE_FAILURE)?);
    use_plain_spaces(&mut text);
    Ok(text)
}

pub(super) fn string(range: FormattedValue<'_>) -> Result<StringRef> {
    new_string(&text(range)?)
}

pub(super) fn parts(range: FormattedValue<'_>) -> Result<Parts> {
    let text = text(range)?;
    let mut splitter = PartSplitter::new(&text);
    let mut spans = [(Source::StartRange, 0..0), (Source::EndRange, 0..0)];
    let mut fields = range.fields().or_type_error(RANGE_FAILURE)?;
    loop {
        let field = fields.next().or_type_error(RANGE_FAILURE)?;
        let source_at = |index| {
            let span = spans.iter().find(|(_, span)| span.contains(&index));
            Some(span.map_or(Source::Shared, |&(source, _)| source))
        };
        let end_of_literal = field.as_ref().map_or(text.len(), |it| it.range.start);
        splitter.push_literal_until(end_of_literal, source_at(splitter.position()))?;
        let Some(field) = field else {
            return Ok(splitter.finish());
        };
        if field.category == Category::DATE_INTERVAL_SPAN {
            spans[usize::from(field.field != 0)].1 = field.range;
        } else {
            let source = source_at(field.range.start);
            splitter.push_field(field.field, field.range, None, source)?;
        }
    }
}

use bun_engine_temporal::Unit;
use bun_icu::formatted_value::FormattedValue;
use smallvec::SmallVec;

use super::NUMBER_FAILURE;
use super::elements::Element;
use crate::error::IcuResult;
use crate::number_format::parts::{FieldContext, push_number_parts};
use crate::{Part, PartKind, Parts, Result, TimeUnit};

/// Takes the elements of a duration, one after the other.
pub(super) trait Output {
    fn push_separator(&mut self, separator: &[u16]) -> Result<()>;

    fn push_number(&mut self, element: &Element, number: FormattedValue<'_>) -> Result<()>;

    fn text(&self) -> &[u16];
}

impl Output for SmallVec<[u16; 128]> {
    fn push_separator(&mut self, separator: &[u16]) -> Result<()> {
        self.extend_from_slice(separator);
        Ok(())
    }

    fn push_number(&mut self, _: &Element, number: FormattedValue<'_>) -> Result<()> {
        self.extend_from_slice(number.text().or_type_error(NUMBER_FAILURE)?);
        Ok(())
    }

    fn text(&self) -> &[u16] {
        self
    }
}

impl Output for Parts {
    fn push_separator(&mut self, separator: &[u16]) -> Result<()> {
        self.push(PartKind::Literal, separator)
    }

    fn push_number(&mut self, element: &Element, number: FormattedValue<'_>) -> Result<()> {
        let context = FieldContext {
            is_negative: element.shows_minus_sign,
            is_infinite: false,
            is_nan: false,
            is_unit_style: true,
        };
        push_number_parts(self, number, context, |kind| Part {
            kind,
            unit: Some(time_unit(element.unit)),
            source: None,
        })
    }

    fn text(&self) -> &[u16] {
        Parts::text(self)
    }
}

fn time_unit(unit: Unit) -> TimeUnit {
    match unit {
        Unit::Year => TimeUnit::Year,
        Unit::Month => TimeUnit::Month,
        Unit::Week => TimeUnit::Week,
        Unit::Day => TimeUnit::Day,
        Unit::Hour => TimeUnit::Hour,
        Unit::Minute => TimeUnit::Minute,
        Unit::Second => TimeUnit::Second,
        Unit::Millisecond => TimeUnit::Millisecond,
        Unit::Microsecond => TimeUnit::Microsecond,
        Unit::Nanosecond => TimeUnit::Nanosecond,
    }
}

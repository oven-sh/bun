//! The settings of a decimal format besides its affixes. -1 means that a value is not set. ICU4C: number_decimfmtprops.cpp

use crate::i18n::number_padding::Padder;

#[derive(Clone, Copy)]
pub(crate) struct DecimalFormatProperties {
    pub(crate) decimal_separator_always_shown: bool,
    pub(crate) exponent_sign_always_shown: bool,
    pub(crate) grouping_size: i32,
    pub(crate) grouping_used: bool,
    /// The power of ten for a percent or per mille sign.
    pub(crate) magnitude_multiplier: i32,
    pub(crate) maximum_fraction_digits: i32,
    pub(crate) maximum_integer_digits: i32,
    pub(crate) maximum_significant_digits: i32,
    pub(crate) minimum_exponent_digits: i32,
    pub(crate) minimum_fraction_digits: i32,
    pub(crate) minimum_grouping_digits: i32,
    pub(crate) minimum_integer_digits: i32,
    pub(crate) minimum_significant_digits: i32,
    pub(crate) padder: Option<Padder>,
    pub(crate) rounding_increment: f64,
    pub(crate) secondary_grouping_size: i32,
}

impl Default for DecimalFormatProperties {
    fn default() -> Self {
        Self {
            decimal_separator_always_shown: false,
            exponent_sign_always_shown: false,
            grouping_size: -1,
            grouping_used: true,
            magnitude_multiplier: 0,
            maximum_fraction_digits: -1,
            maximum_integer_digits: -1,
            maximum_significant_digits: -1,
            minimum_exponent_digits: -1,
            minimum_fraction_digits: -1,
            minimum_grouping_digits: -1,
            minimum_integer_digits: -1,
            minimum_significant_digits: -1,
            padder: None,
            rounding_increment: 0.0,
            secondary_grouping_size: -1,
        }
    }
}

fn set_min(min: &mut i32, max: &mut i32, value: i32) {
    if value != *min {
        if *max >= 0 {
            *max = value.max(*max);
        }
        *min = value;
    }
}

fn set_max(min: &mut i32, max: &mut i32, value: i32) {
    if value != *max {
        if *min >= 0 {
            *min = value.min(*min);
        }
        *max = value;
    }
}

// ICU4C: decimfmt.cpp
impl DecimalFormatProperties {
    pub(crate) fn set_minimum_integer_digits(&mut self, value: i32) {
        let max = &mut self.maximum_integer_digits;
        set_min(&mut self.minimum_integer_digits, max, value);
    }

    pub(crate) fn set_maximum_integer_digits(&mut self, value: i32) {
        let max = &mut self.maximum_integer_digits;
        set_max(&mut self.minimum_integer_digits, max, value);
    }

    pub(crate) fn set_minimum_fraction_digits(&mut self, value: i32) {
        let max = &mut self.maximum_fraction_digits;
        set_min(&mut self.minimum_fraction_digits, max, value);
    }

    pub(crate) fn set_maximum_fraction_digits(&mut self, value: i32) {
        let max = &mut self.maximum_fraction_digits;
        set_max(&mut self.minimum_fraction_digits, max, value);
    }

    /// Ignores primary grouping, and integer and fraction digits.
    pub(crate) fn equals_default_except_fast_format(&self) -> bool {
        !self.decimal_separator_always_shown
            && self.magnitude_multiplier == 0
            && self.maximum_significant_digits == -1
            && self.minimum_exponent_digits == -1
            && self.minimum_grouping_digits == -1
            && self.padder.is_none()
            && self.rounding_increment == 0.0
            && self.secondary_grouping_size == -1
    }
}

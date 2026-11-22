//! Padding to a width, as in the pattern "*x#,##0". ICU4C: number_padding.cpp

use crate::i18n::formatted_string_builder::{FormattedStringBuilder, UNDEFINED_FIELD};
use crate::i18n::number_modifiers::{ConstantMultiFieldModifier, Modifier};

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum PadPosition {
    BeforePrefix,
    AfterPrefix,
    BeforeSuffix,
    AfterSuffix,
}

#[derive(Clone, Copy)]
pub(crate) struct Padder {
    pub(crate) width: usize,
    pub(crate) code_point: u32,
    pub(crate) position: PadPosition,
}

impl Padder {
    /// Applies `affixes` and the padding to `string`, which holds a single number and has the length `end`.
    #[cold]
    pub(crate) fn pad_and_apply(
        &self,
        affixes: &ConstantMultiFieldModifier,
        string: &mut FormattedStringBuilder,
        mut end: usize,
    ) {
        let length = affixes.code_point_count() + string.code_point_count();
        let required = self.width.saturating_sub(length);
        let pad = |string: &mut FormattedStringBuilder, position, index| {
            if self.position == position {
                string.insert_code_point_repeated(index, self.code_point, UNDEFINED_FIELD, required)
            } else {
                0
            }
        };
        end += pad(string, PadPosition::AfterPrefix, 0);
        end += pad(string, PadPosition::BeforeSuffix, end);
        end = affixes.apply(string, 0, end);
        pad(string, PadPosition::BeforePrefix, 0);
        pad(string, PadPosition::AfterSuffix, end);
    }
}

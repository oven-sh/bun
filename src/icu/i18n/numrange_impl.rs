//! Number ranges: "3–5 m", "$3 – $5", "~5". ICU4C: numrange_impl.cpp

use crate::common::memory::{TryClone, get_or_try_init, try_concat};
use crate::common::patternprops;
use crate::common::resource::ResourceValue;
use crate::common::simpleformatter::{ARG_NUM_LIMIT, SimpleFormatter};
use crate::common::unistr::{UStr, ustr};
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::formatted_string_builder::{FormattedStringBuilder, UNDEFINED_FIELD};
use crate::i18n::formattedval_impl::FormattedValueStringBuilderImpl;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_fluent::MacroProps;
use crate::i18n::number_formatimpl::{BuildMode, Modifiers, NumberFormatterImpl};
use crate::i18n::number_modifiers::{Modifier, OuterModifier};
use crate::i18n::pluralranges::StandardPluralRanges;
use std::sync::OnceLock;

pub(crate) struct UFormattedNumberRangeData {
    pub(crate) base: FormattedValueStringBuilderImpl,
    pub(crate) quantity1: DecimalQuantity,
    pub(crate) quantity2: DecimalQuantity,
}

impl UFormattedNumberRangeData {
    pub(crate) fn new() -> Self {
        Self {
            base: FormattedValueStringBuilderImpl::new(UNDEFINED_FIELD),
            quantity1: DecimalQuantity::new(),
            quantity2: DecimalQuantity::new(),
        }
    }

    pub(crate) fn reset(&mut self) {
        self.base.reset_string();
        self.quantity1.clear();
        self.quantity2.clear();
    }
}

fn compile(pattern: &[u16]) -> Result<SimpleFormatter, UErrorCode> {
    SimpleFormatter::with_pattern_min_max_arguments(pattern, 0, usize::MAX)
}

/// Takes the first pattern that has an argument. ICU4C: numrange_impl.cpp, getNumberRangeData
fn load_range_pattern(locale_name: &[u8], ns_name: &[u8]) -> Result<SimpleFormatter, UErrorCode> {
    let bundle = &ures_open(None, locale_name)?;
    let mut found = SimpleFormatter::new();
    for ns_name in [ns_name, b"latn"] {
        let mut sink = |patterns: &ResourceValue| {
            for (key, value) in patterns.get_table()?.iter() {
                if key == b"range" && found.get_argument_limit() == 0 {
                    found = compile(&value.get_unicode_string()?)?;
                }
            }
            Ok(())
        };
        let path = try_concat(&[b"NumberElements/", ns_name, b"/miscPatterns"])?;
        match ures_get_all_items_with_fallback(bundle, &path, &mut sink) {
            Ok(()) | Err(U_MISSING_RESOURCE_ERROR) => {}
            Err(code) => return Err(code),
        }
        if found.get_argument_limit() != 0 {
            return Ok(found);
        }
    }
    compile(&ustr("{0}–{1}"))
}

/// The text of a pattern without its arguments.
struct RangePattern {
    text: Vec<u16>,
    prefix_length: usize,
    infix_length: usize,
}

impl RangePattern {
    /// It does not matter which arguments separate the pieces. Returns `None` if the pattern is of no use.
    fn new(compiled: &SimpleFormatter) -> Result<Option<Self>, UErrorCode> {
        let (pattern, mut offset) = (compiled.compiled_pattern(), 1);
        // Also skips the argument that follows.
        let next_literal = |offset: &mut usize| {
            let length = usize::from(pattern.char_at(*offset)).checked_sub(ARG_NUM_LIMIT);
            *offset += 1;
            let (start, length) = (*offset, length?);
            *offset += length + 1;
            Some(pattern.temp_sub_string(start, length))
        };
        let prefix = next_literal(&mut offset).unwrap_or_default();
        let infix = next_literal(&mut offset).unwrap_or_default();
        let suffix = if offset == pattern.len() {
            Some(&[][..])
        } else {
            next_literal(&mut offset)
        };
        let Some(suffix) = suffix.filter(|_| compiled.get_argument_limit() == 2) else {
            return Ok(None);
        };
        Ok(Some(Self {
            text: try_concat(&[prefix, infix, suffix])?,
            prefix_length: prefix.len(),
            infix_length: infix.len(),
        }))
    }
}

/// A modifier that replaces its text ("mille") can make `second` or `suffix` negative. The sum of all five stays right.
struct RangeLengths {
    prefix: usize,
    first: usize,
    infix: usize,
    second: isize,
    suffix: isize,
}

impl RangeLengths {
    fn first_end(&self) -> usize {
        self.prefix + self.first
    }

    fn second_start(&self) -> usize {
        self.first_end() + self.infix
    }

    fn end(&self) -> usize {
        self.second_start()
            .saturating_add_signed(self.second + self.suffix)
    }

    fn apply_to_both(
        &mut self,
        string: &mut FormattedStringBuilder,
        modifier: &dyn Modifier,
        prefix_length: usize,
    ) {
        let end = modifier.apply(string, self.prefix, self.end());
        self.prefix += prefix_length;
        self.suffix += end as isize - self.end() as isize;
    }

    fn apply_to_each(
        &mut self,
        string: &mut FormattedStringBuilder,
        first: &dyn Modifier,
        second: &dyn Modifier,
    ) {
        self.first = first.apply(string, self.prefix, self.first_end()) - self.prefix;
        let end = second.apply(string, self.second_start(), self.end());
        self.second += end as isize - self.end() as isize;
    }
}

struct NumberRangeFormatterImpl {
    formatter: NumberFormatterImpl,
    /// `None` if nothing is collapsed.
    approximately_formatter: Option<NumberFormatterImpl>,
    /// Only two different numbers need it.
    range_pattern: Option<RangePattern>,
    plural_ranges: StandardPluralRanges,
}

impl NumberRangeFormatterImpl {
    fn new(macros: &MacroProps, collapses: bool) -> Result<Self, UErrorCode> {
        let locale = &macros.locale;
        let formatter = NumberFormatterImpl::new(macros, BuildMode::Reusable)?;
        let range_pattern = load_range_pattern(locale.get_name(), &formatter.ns_name)?;
        let this = Self {
            range_pattern: RangePattern::new(&range_pattern)?,
            approximately_formatter: collapses
                .then(|| NumberFormatterImpl::new(macros, BuildMode::ReusableApproximately))
                .transpose()?,
            plural_ranges: StandardPluralRanges::for_language(locale.get_language())?,
            formatter,
        };
        match macros.unit.as_mixed() {
            Some(_) => Err(U_UNSUPPORTED_ERROR),
            None => Ok(this),
        }
    }

    fn format(
        &self,
        data: &mut UFormattedNumberRangeData,
        equal_before_rounding: bool,
    ) -> Result<(), UErrorCode> {
        let mut unrounded = data.quantity1.try_clone()?;
        let first = self.formatter.pre_process(&mut data.quantity1, None)?;
        let second = self.formatter.pre_process(&mut data.quantity2, None)?;
        let exponent = |modifiers: &Modifiers| Some(modifiers.inner.as_ref()?.exponent);
        match &self.approximately_formatter {
            Some(formatter)
                if exponent(&first) == exponent(&second)
                    && first.middle.strict_equals(&second.middle)
                    && (equal_before_rounding || data.quantity1 == data.quantity2) =>
            {
                formatter.format_to(&mut unrounded, data.base.get_string_ref())
            }
            _ => self.format_range(data, &first, &second),
        }
    }

    fn format_range(
        &self,
        data: &mut UFormattedNumberRangeData,
        first: &Modifiers,
        second: &Modifiers,
    ) -> Result<(), UErrorCode> {
        let (middle, middle_length) = (&*first.middle, first.middle.code_point_count());
        let collapse_middle = self.approximately_formatter.is_some()
            && middle_length > 1
            && middle.strict_equals(&second.middle);

        let string = data.base.get_string_ref();
        let pattern = (self.range_pattern.as_ref()).ok_or(U_INTERNAL_PROGRAM_ERROR)?;
        string.add_all(&pattern.text, UNDEFINED_FIELD);
        let mut lengths = RangeLengths {
            prefix: pattern.prefix_length,
            first: 0,
            infix: pattern.infix_length,
            second: 0,
            suffix: (pattern.text.len() - pattern.prefix_length - pattern.infix_length) as isize,
        };

        // A repeated modifier adds spaces around the separator: "$3 – $5".
        if first.inner.is_some() || (!collapse_middle && middle_length > 0) {
            let is_white_space = |string: &FormattedStringBuilder, index: usize| {
                string
                    .chars()
                    .get(index)
                    .is_some_and(|&c| patternprops::is_white_space(c.into()))
            };
            if !is_white_space(string, lengths.first_end()) {
                lengths.infix +=
                    string.insert_code_point(lengths.first_end(), 0x20, UNDEFINED_FIELD);
            }
            if !is_white_space(string, lengths.second_start().wrapping_sub(1)) {
                lengths.infix +=
                    string.insert_code_point(lengths.second_start(), 0x20, UNDEFINED_FIELD);
            }
        }

        let writer = &self.formatter.writer;
        lengths.first += writer.write(&data.quantity1, string, lengths.prefix)?;
        let mut number = FormattedStringBuilder::new();
        writer.write(&data.quantity2, &mut number, 0)?;
        lengths.second += string.insert_builder(lengths.second_start(), &number) as isize;

        lengths.apply_to_each(string, &first.inner, &second.inner);
        let mut spacing = 0;
        if collapse_middle {
            spacing = middle.spacing_after_prefix(string, lengths.prefix);
            lengths.apply_to_both(string, middle, middle.prefix.len());
        } else {
            lengths.apply_to_each(string, middle, &*second.middle);
        }
        if let Some((first, second)) = first.outer.zip(second.outer) {
            let plural = self.plural_ranges.resolve(first.plural, second.plural);
            if let Some(outer) = (OuterModifier { plural, ..first }).get() {
                lengths.apply_to_both(string, outer, outer.prefix().len());
            }
        }

        let end = string.len() as isize;
        for (start, length) in [
            (lengths.prefix, lengths.first as isize),
            (lengths.second_start(), lengths.second),
        ] {
            let start = start + spacing;
            let is_inside = (0..=end - start as isize).contains(&length);
            let length = if is_inside { length as usize } else { 0 };
            data.base.append_span(start, length);
        }
        Ok(())
    }
}

/// Loads its data at the first use.
pub(crate) struct LocalizedNumberRangeFormatter {
    macros: MacroProps,
    collapses: bool,
    formatter: OnceLock<NumberRangeFormatterImpl>,
}

impl LocalizedNumberRangeFormatter {
    /// `collapses` makes "3–5 EUR" of "3 EUR – 5 EUR" and "~5" of "5–5". Without it `macros` must have no unit.
    pub(crate) fn new(macros: MacroProps, collapses: bool) -> Self {
        Self {
            macros,
            collapses,
            formatter: OnceLock::new(),
        }
    }

    /// Formats the quantities of `results`, modifying them, into its string, which must be empty.
    pub(crate) fn format(
        &self,
        results: &mut UFormattedNumberRangeData,
        equal_before_rounding: bool,
    ) -> Result<(), UErrorCode> {
        let build = || NumberRangeFormatterImpl::new(&self.macros, self.collapses);
        let formatter = get_or_try_init(&self.formatter, build)?;
        let outcome = formatter.format(results, equal_before_rounding);
        results.base.finish(outcome)
    }
}

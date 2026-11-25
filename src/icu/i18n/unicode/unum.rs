//! `unicode/unum.h`

pub(crate) type UNumberFormatFields = i32;
pub(crate) const UNUM_INTEGER_FIELD: UNumberFormatFields = 0;
pub(crate) const UNUM_FRACTION_FIELD: UNumberFormatFields = 1;
pub(crate) const UNUM_DECIMAL_SEPARATOR_FIELD: UNumberFormatFields = 2;
pub(crate) const UNUM_EXPONENT_SYMBOL_FIELD: UNumberFormatFields = 3;
pub(crate) const UNUM_EXPONENT_SIGN_FIELD: UNumberFormatFields = 4;
pub(crate) const UNUM_EXPONENT_FIELD: UNumberFormatFields = 5;
pub(crate) const UNUM_GROUPING_SEPARATOR_FIELD: UNumberFormatFields = 6;
pub(crate) const UNUM_CURRENCY_FIELD: UNumberFormatFields = 7;
pub(crate) const UNUM_PERCENT_FIELD: UNumberFormatFields = 8;
pub(crate) const UNUM_PERMILL_FIELD: UNumberFormatFields = 9;
pub(crate) const UNUM_SIGN_FIELD: UNumberFormatFields = 10;
pub(crate) const UNUM_MEASURE_UNIT_FIELD: UNumberFormatFields = 11;
pub(crate) const UNUM_COMPACT_FIELD: UNumberFormatFields = 12;
pub(crate) const UNUM_APPROXIMATELY_SIGN_FIELD: UNumberFormatFields = 13;

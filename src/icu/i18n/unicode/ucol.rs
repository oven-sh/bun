//! `unicode/ucol.h`

pub(crate) type UCollationResult = i32;
pub(crate) const UCOL_EQUAL: UCollationResult = 0;

pub(crate) type UColAttributeValue = i32;
pub(crate) const UCOL_DEFAULT: UColAttributeValue = -1;
pub(crate) const UCOL_PRIMARY: UColAttributeValue = 0;
pub(crate) const UCOL_SECONDARY: UColAttributeValue = 1;
pub(crate) const UCOL_TERTIARY: UColAttributeValue = 2;
pub(crate) const UCOL_QUATERNARY: UColAttributeValue = 3;
pub(crate) const UCOL_IDENTICAL: UColAttributeValue = 15;
pub(crate) const UCOL_OFF: UColAttributeValue = 16;
pub(crate) const UCOL_ON: UColAttributeValue = 17;
pub(crate) const UCOL_SHIFTED: UColAttributeValue = 20;
pub(crate) const UCOL_NON_IGNORABLE: UColAttributeValue = 21;
pub(crate) const UCOL_LOWER_FIRST: UColAttributeValue = 24;
pub(crate) const UCOL_UPPER_FIRST: UColAttributeValue = 25;

pub(crate) type UColReorderCode = i32;
pub(crate) const UCOL_REORDER_CODE_FIRST: UColReorderCode = 4096;
pub(crate) const UCOL_REORDER_CODE_CURRENCY: UColReorderCode = 4099;
pub(crate) const UCOL_REORDER_CODE_DIGIT: UColReorderCode = 4100;

pub(crate) type UColAttribute = i32;
pub(crate) const UCOL_FRENCH_COLLATION: UColAttribute = 0;
pub(crate) const UCOL_ALTERNATE_HANDLING: UColAttribute = 1;
pub(crate) const UCOL_CASE_FIRST: UColAttribute = 2;
pub(crate) const UCOL_CASE_LEVEL: UColAttribute = 3;
pub(crate) const UCOL_NORMALIZATION_MODE: UColAttribute = 4;
pub(crate) const UCOL_STRENGTH: UColAttribute = 5;
pub(crate) const UCOL_NUMERIC_COLLATION: UColAttribute = 7;

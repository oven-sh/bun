//! `unicode/uformattedvalue.h`

pub(crate) type UFieldCategory = i32;
pub(crate) const UFIELD_CATEGORY_UNDEFINED: UFieldCategory = 0;
pub(crate) const UFIELD_CATEGORY_DATE: UFieldCategory = 1;
pub(crate) const UFIELD_CATEGORY_NUMBER: UFieldCategory = 2;
pub(crate) const UFIELD_CATEGORY_LIST: UFieldCategory = 3;
pub(crate) const UFIELD_CATEGORY_RELATIVE_DATETIME: UFieldCategory = 4;
pub(crate) const UFIELD_CATEGORY_DATE_INTERVAL_SPAN: UFieldCategory = 4101;
pub(crate) const UFIELD_CATEGORY_NUMBER_RANGE_SPAN: UFieldCategory = 4098;

//! `unicode/ures.h`

pub(crate) type UResType = i32;
pub(crate) const URES_STRING: UResType = 0;
pub(crate) const URES_BINARY: UResType = 1;
pub(crate) const URES_TABLE: UResType = 2;
pub(crate) const URES_ALIAS: UResType = 3;
pub(crate) const URES_INT: UResType = 7;
pub(crate) const URES_ARRAY: UResType = 8;
pub(crate) const URES_INT_VECTOR: UResType = 14;

//! The views that read a bundle in place. Their methods are in `uresdata.rs`. ICU4C: resource.h

pub(crate) use crate::common::uresdata::ResourceValue;
use crate::common::uresdata::{Items, Keys};
use crate::common::utypes::UErrorCode;

#[derive(Clone, Copy)]
pub(crate) struct ResourceArray {
    pub(crate) origin: ResourceValue,
    pub(crate) items: Items,
}

#[derive(Clone, Copy)]
pub(crate) struct ResourceTable {
    pub(crate) origin: ResourceValue,
    pub(crate) keys: Keys,
    pub(crate) items: Items,
}

pub(crate) trait ResourceSink {
    /// Called for each bundle from the child up to root.
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode>;
}

impl<F: FnMut(&ResourceValue) -> Result<(), UErrorCode>> ResourceSink for F {
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        self(value)
    }
}

//! Collects the field positions that a formatter reports. ICU4C: fphdlimp.cpp, fpositer.cpp

use crate::common::memory::{Appendable, oom_checked};
use crate::common::utypes::UErrorCode;
use crate::i18n::unicode::uformattedvalue::{UFIELD_CATEGORY_UNDEFINED, UFieldCategory};

#[derive(Clone, Copy)]
pub(crate) struct Attribute {
    pub(crate) category: UFieldCategory,
    pub(crate) field: i32,
    pub(crate) start: i32,
    pub(crate) limit: i32,
}

pub(crate) type FieldPositionIterator = std::vec::IntoIter<Attribute>;

/// Collects the non-empty fields.
pub(crate) struct FieldPositionIteratorHandler {
    attributes: Vec<Attribute>,
    category: UFieldCategory,
}

impl FieldPositionIteratorHandler {
    pub(crate) const fn new() -> Self {
        Self::with_category(UFIELD_CATEGORY_UNDEFINED)
    }

    pub(crate) const fn with_category(category: UFieldCategory) -> Self {
        Self {
            attributes: Vec::new(),
            category,
        }
    }

    /// Reserves capacity for the fields of most numbers and dates.
    #[inline(never)]
    fn add_first(&mut self, attribute: Attribute) {
        _ = self.attributes.reserve_append(8);
        self.attributes.add(attribute);
    }

    pub(crate) fn finish(self) -> Result<Vec<Attribute>, UErrorCode> {
        oom_checked(self.attributes)
    }

    pub(crate) fn finish_into(self, iter: &mut FieldPositionIterator) -> Result<(), UErrorCode> {
        self.finish().map(|all| *iter = all.into_iter())
    }

    pub(crate) fn add_attribute(&mut self, id: i32, start: i32, limit: i32) {
        if start < limit {
            let attribute = Attribute {
                category: self.category,
                field: id,
                start,
                limit,
            };
            if self.attributes.is_empty() {
                self.add_first(attribute)
            } else {
                self.attributes.add(attribute)
            }
        }
    }
}

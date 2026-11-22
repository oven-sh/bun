//! Formatted text with field positions. ICU4C: formattedvalue.cpp

use crate::common::slice_ext::to_int32;

#[derive(Default)]
pub(crate) struct ConstrainedFieldPosition {
    context: i64,
    field: i32,
    start: i32,
    limit: i32,
    category: i32,
    /// Whether only fields of `category` match.
    is_constrained: bool,
}

impl ConstrainedFieldPosition {
    pub(crate) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(crate) fn constrain_category(&mut self, category: i32) {
        self.is_constrained = true;
        self.category = category;
    }

    /// `field` is the only field of `category` that is reported.
    pub(crate) fn constrain_field(&mut self, category: i32, field: i32) {
        self.constrain_category(category);
        self.field = field;
    }

    pub(crate) fn is_constrained(&self) -> bool {
        self.is_constrained
    }

    pub(crate) fn category(&self) -> i32 {
        self.category
    }

    pub(crate) fn field(&self) -> i32 {
        self.field
    }

    pub(crate) fn start(&self) -> i32 {
        self.start
    }

    pub(crate) fn limit(&self) -> i32 {
        self.limit
    }

    pub(crate) fn iteration_context(&self) -> i64 {
        self.context
    }

    pub(crate) fn set_iteration_context(&mut self, context: i64) {
        self.context = context;
    }

    pub(crate) fn matches_category(&self, category: i32) -> bool {
        !self.is_constrained || self.category == category
    }

    pub(crate) fn set_to_end(&mut self, length: usize) {
        (self.start, self.limit) = (to_int32(length), to_int32(length));
    }

    pub(crate) fn set_state(&mut self, category: i32, field: i32, start: i32, limit: i32) {
        self.category = category;
        self.field = field;
        self.start = start;
        self.limit = limit;
    }
}

pub(crate) trait FormattedValue {
    fn terminated_text(&self) -> &[u16];

    /// Moves `cfpos` to the next field that matches its constraint. Returns false if there is none.
    fn next_position(&self, cfpos: &mut ConstrainedFieldPosition) -> bool;
}

use bun_jsc::{JSArrayIterator, JSGlobalObject, JSValue, JsResult};

use super::object_iterator::ObjectIterator;

pub enum QueryBindingIterator {
    Array(JSArrayIterator),
    Objects(ObjectIterator),
}

impl QueryBindingIterator {
    pub fn init(
        array: JSValue,
        columns: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<QueryBindingIterator> {
        if columns.is_empty_or_undefined_or_null() {
            return Ok(Self::Array(JSArrayIterator::init(array, global)?));
        }

        Ok(Self::Objects(ObjectIterator {
            array,
            columns,
            global_object: global,
            columns_count: columns.get_length(global)?,
            array_length: array.get_length(global)?,
            ..Default::default()
        }))
    }

    pub fn next(&mut self) -> JsResult<Option<JSValue>> {
        match self {
            Self::Array(iter) => iter.next(),
            Self::Objects(iter) => iter.next(),
        }
    }

    pub fn any_failed(&self) -> bool {
        match self {
            Self::Array(_) => false,
            Self::Objects(iter) => iter.any_failed,
        }
    }

    pub fn to(&mut self, index: u32) {
        match self {
            Self::Array(iter) => iter.i = index,
            Self::Objects(iter) => {
                iter.cell_i = index % iter.columns_count;
                iter.row_i = index / iter.columns_count;
                iter.current_row = JSValue::ZERO;
            }
        }
    }

    pub fn reset(&mut self) {
        match self {
            Self::Array(iter) => {
                iter.i = 0;
            }
            Self::Objects(iter) => {
                iter.cell_i = 0;
                iter.row_i = 0;
                iter.current_row = JSValue::ZERO;
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/shared/QueryBindingIterator.zig (64 lines)
//   confidence: medium
//   todos:      0
//   notes:      ObjectIterator field types/lifetime (global_object, index widths) deferred to Phase B; JSArrayIterator.next() return type assumed JsResult<Option<JSValue>>
// ──────────────────────────────────────────────────────────────────────────

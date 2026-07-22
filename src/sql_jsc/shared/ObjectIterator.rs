use crate::jsc::{JSGlobalObject, JSObject, JSValue, JsResult};

// Note: this iterator holds bare `JSValue` fields and a borrowed
// `&JSGlobalObject`; it is only sound when constructed on the stack for the
// duration of a single bind/iteration pass (conservative GC stack scan keeps
// `array`/`columns`/`current_row` alive). Never `Box` this.
pub struct ObjectIterator<'a> {
    pub(crate) array: JSValue,
    pub(crate) columns: JSValue,
    pub(crate) global_object: &'a JSGlobalObject,
    pub(crate) cell_i: u32,
    pub(crate) row_i: u32,
    pub(crate) current_row: JSValue,
    pub(crate) columns_count: u32,
    pub(crate) array_length: u32,
    pub(crate) any_failed: bool,
}

impl<'a> ObjectIterator<'a> {
    pub(crate) fn next(&mut self) -> JsResult<Option<JSValue>> {
        if self.array.is_empty_or_undefined_or_null()
            || self.columns.is_empty_or_undefined_or_null()
        {
            self.any_failed = true;
            return Ok(None);
        }
        if self.row_i >= self.array_length {
            return Ok(None);
        }

        let cell_i = self.cell_i;
        self.cell_i += 1;
        let row_i = self.row_i;

        let global_object = self.global_object;

        if self.current_row.is_empty() {
            self.current_row = match JSObject::get_index(self.array, global_object, row_i) {
                Ok(v) => v,
                Err(_) => {
                    self.any_failed = true;
                    return Ok(None);
                }
            };
            if self.current_row.is_empty_or_undefined_or_null() {
                return Err(global_object.throw(format_args!(
                    "Expected a row to be returned at index {}",
                    row_i
                )));
            }
        }

        // The labeled block computes the result first, then the bookkeeping
        // below runs exactly once before returning.
        let result: JsResult<Option<JSValue>> = 'out: {
            let property = match JSObject::get_index(self.columns, global_object, cell_i) {
                Ok(v) => v,
                Err(_) => {
                    self.any_failed = true;
                    break 'out Ok(None);
                }
            };
            if property.is_undefined() {
                break 'out Err(global_object.throw(format_args!(
                    "Expected a column at index {} in row {}",
                    cell_i, row_i
                )));
            }

            // `get_own_by_value` maps the C++ empty (zero) return to `None`,
            // so the `Some(JSValue::ZERO)` comparison below is defensively dead
            // (an unwrapped value is never zero).
            let value: Option<JSValue> = self.current_row.get_own_by_value(global_object, property);
            if value == Some(JSValue::ZERO) || value.is_some_and(|v| v.is_undefined()) {
                if !global_object.has_exception() {
                    break 'out Err(global_object.throw(format_args!(
                        "Expected a value at index {} in row {}",
                        cell_i, row_i
                    )));
                }
                self.any_failed = true;
                break 'out Ok(None);
            }
            Ok(value)
        };

        if self.cell_i >= self.columns_count {
            self.cell_i = 0;
            self.current_row = JSValue::ZERO;
            self.row_i += 1;
        }

        result
    }
}

use crate::jsc::{JSGlobalObject, JSObject, JSValue, JsResult};

// Note: this iterator holds bare `JSValue` fields and a borrowed
// `&JSGlobalObject`; it is only sound when constructed on the stack for the
// duration of a single bind/iteration pass (conservative GC stack scan keeps
// `array`/`columns`/`current_row` alive). Never `Box` this.
pub(crate) struct ObjectIterator<'a> {
    pub(crate) array: JSValue,
    pub(crate) columns: JSValue,
    pub(crate) global_object: &'a JSGlobalObject,
    pub(crate) cell_i: u32,
    pub(crate) row_i: u32,
    pub(crate) current_row: JSValue,
    pub(crate) columns_count: u32,
    pub(crate) array_length: u32,
}

impl<'a> ObjectIterator<'a> {
    /// The next cell value (row `row_i`, column `cell_i`), `Ok(None)` once every row has been visited.
    pub(crate) fn next(&mut self) -> JsResult<Option<JSValue>> {
        if self.row_i >= self.array_length {
            return Ok(None);
        }

        let cell_i = self.cell_i;
        self.cell_i += 1;
        let row_i = self.row_i;

        let global_object = self.global_object;

        if self.current_row.is_empty() {
            self.current_row = JSObject::get_index(self.array, global_object, row_i)?;
            if !self.current_row.is_object() {
                return Err(
                    global_object.throw(format_args!("Expected a row object at index {}", row_i))
                );
            }
        }

        let property = JSObject::get_index(self.columns, global_object, cell_i)?;
        if property.is_undefined() {
            return Err(global_object.throw(format_args!(
                "Expected a column at index {} in row {}",
                cell_i, row_i
            )));
        }
        let value = self.current_row.get_own_by_value(global_object, property)?;
        let result = if value.is_undefined() {
            Err(global_object.throw(format_args!(
                "Expected a value at index {} in row {}",
                cell_i, row_i
            )))
        } else {
            Ok(Some(value))
        };

        if self.cell_i >= self.columns_count {
            self.cell_i = 0;
            self.current_row = JSValue::ZERO;
            self.row_i += 1;
        }

        result
    }
}

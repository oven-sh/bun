use bun_jsc::{JSGlobalObject, JSObject, JSValue};

// PORT NOTE: this iterator holds bare `JSValue` fields and a borrowed
// `&JSGlobalObject`; it is only sound when constructed on the stack for the
// duration of a single bind/iteration pass (conservative GC stack scan keeps
// `array`/`columns`/`current_row` alive). Never `Box` this.
pub struct ObjectIterator<'a> {
    pub array: JSValue,
    pub columns: JSValue,
    pub global_object: &'a JSGlobalObject,
    pub cell_i: usize,
    pub row_i: usize,
    pub current_row: JSValue,
    pub columns_count: usize,
    pub array_length: usize,
    pub any_failed: bool,
}

impl<'a> ObjectIterator<'a> {
    pub fn next(&mut self) -> Option<JSValue> {
        if self.array.is_empty_or_undefined_or_null() || self.columns.is_empty_or_undefined_or_null()
        {
            self.any_failed = true;
            return None;
        }
        if self.row_i >= self.array_length {
            return None;
        }

        let cell_i = self.cell_i;
        self.cell_i += 1;
        let row_i = self.row_i;

        let global_object = self.global_object;

        if self.current_row.is_empty() {
            self.current_row = match JSObject::get_index(
                self.array,
                global_object,
                u32::try_from(row_i).unwrap(),
            ) {
                Ok(v) => v,
                Err(_) => {
                    self.any_failed = true;
                    return None;
                }
            };
            if self.current_row.is_empty_or_undefined_or_null() {
                let _ = global_object.throw(format_args!(
                    "Expected a row to be returned at index {}",
                    row_i
                ));
                return None;
            }
        }

        // PORT NOTE: Zig `defer { if (cell_i >= columns_count) { ... } }` is
        // lowered to a labeled block whose result is computed first, then the
        // deferred bookkeeping runs exactly once before returning.
        let result: Option<JSValue> = 'out: {
            let property = match JSObject::get_index(
                self.columns,
                global_object,
                u32::try_from(cell_i).unwrap(),
            ) {
                Ok(v) => v,
                Err(_) => {
                    self.any_failed = true;
                    break 'out None;
                }
            };
            if property.is_undefined() {
                let _ = global_object.throw(format_args!(
                    "Expected a column at index {} in row {}",
                    cell_i, row_i
                ));
                break 'out None;
            }

            // TODO(port): verify `get_own_by_value` return type — Zig site treats it
            // as `?JSValue` (compares against `.zero` and `null` separately).
            let value: Option<JSValue> = self.current_row.get_own_by_value(global_object, property);
            if value == Some(JSValue::ZERO) || value.map_or(false, |v| v.is_undefined()) {
                if !global_object.has_exception() {
                    let _ = global_object.throw(format_args!(
                        "Expected a value at index {} in row {}",
                        cell_i, row_i
                    ));
                    break 'out None;
                }
                self.any_failed = true;
                break 'out None;
            }
            value
        };

        if self.cell_i >= self.columns_count {
            self.cell_i = 0;
            self.current_row = JSValue::ZERO;
            self.row_i += 1;
        }

        result
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/shared/ObjectIterator.zig (67 lines)
//   confidence: medium
//   todos:      1
//   notes:      Zig field defaults dropped (no Default — global_object has none); defer lowered to labeled block; verify JSObject::get_index / get_own_by_value signatures in bun_jsc.
// ──────────────────────────────────────────────────────────────────────────

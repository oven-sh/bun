use core::ffi::c_void;
use core::ptr;

use crate::jsc::{
    JSGlobalObject, JSValue, JsError, JsResult, MarkedArgumentBuffer, bun_string_jsc,
};
use crate::postgres::types::date;

const INLINE_COLUMN_CAPACITY: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum WireFormat {
    Int32,
    Float32,
    Float64,
    Boolean,
    Text,
    TimestampMicroseconds,
}

pub(crate) struct RowColumn {
    pub(crate) name: *const u8,
    pub(crate) name_length: u32,
    pub(crate) format: WireFormat,
}

pub(crate) struct RowDecoder {
    row_type: u32,
    plan: *mut c_void,
    formats: Box<[WireFormat]>,
}

impl Default for RowDecoder {
    fn default() -> Self {
        Self {
            row_type: 0,
            plan: ptr::null_mut(),
            formats: Box::default(),
        }
    }
}

impl RowDecoder {
    pub(crate) fn expected_row_type(global_object: &JSGlobalObject, query: JSValue) -> u32 {
        JSC__AOT__expectedResultType(global_object, query)
    }

    pub(crate) fn is_for(&self, row_type: u32) -> bool {
        self.row_type == row_type
    }

    pub(crate) fn new(
        global_object: &JSGlobalObject,
        row_type: u32,
        columns: Option<&[RowColumn]>,
    ) -> Self {
        let Some(columns) = columns.filter(|columns| !columns.is_empty()) else {
            return Self {
                row_type,
                plan: ptr::null_mut(),
                formats: Box::default(),
            };
        };
        let names: Vec<Name> = columns
            .iter()
            .map(|column| Name {
                utf8: column.name,
                length: column.name_length,
            })
            .collect();
        // SAFETY: `names` and the bytes it points to outlive the call, and C++ copies what it retains.
        let plan = unsafe {
            JSC__AOT__ObjectBuilderPlan__create(
                global_object,
                row_type,
                names.as_ptr(),
                names.len() as u32,
            )
        };
        Self {
            row_type,
            plan,
            formats: columns.iter().map(|column| column.format).collect(),
        }
    }

    /// `None`: nothing was appended, and the caller decodes the row itself.
    pub(crate) fn append_row(
        &self,
        global_object: &JSGlobalObject,
        row: &[u8],
        rows: JSValue,
    ) -> JsResult<Option<JSValue>> {
        if self.plan.is_null() || !(rows.is_empty() || rows.js_type().is_array()) {
            return Ok(None);
        }
        let object = if self.formats.len() <= INLINE_COLUMN_CAPACITY {
            // The collector scans the stack, so the cells in this array need no other root.
            let mut values = [FieldValue::Boxed(JSValue::UNDEFINED); INLINE_COLUMN_CAPACITY];
            self.create_object(global_object, row, &mut values, |_| {})
        } else {
            MarkedArgumentBuffer::new(|roots| {
                let mut values = vec![FieldValue::Boxed(JSValue::UNDEFINED); self.formats.len()];
                self.create_object(global_object, row, &mut values, |boxed| roots.append(boxed))
            })
        };
        let Some(object) = object? else {
            return Ok(None);
        };
        if rows.is_empty() {
            let array = JSValue::create_empty_array(global_object, 0)?;
            array.push(global_object, object)?;
            return Ok(Some(array));
        }
        rows.push(global_object, object)?;
        Ok(Some(rows))
    }

    fn create_object(
        &self,
        global_object: &JSGlobalObject,
        row: &[u8],
        values: &mut [FieldValue],
        mut root: impl FnMut(JSValue),
    ) -> JsResult<Option<JSValue>> {
        let mut thrown = None;
        let is_decoded = decode_row(
            row,
            &self.formats,
            &mut |index, cell| match create_field_value(global_object, cell) {
                Ok(value) => {
                    if let FieldValue::Boxed(boxed) = value {
                        root(boxed);
                    }
                    values[index] = value;
                    true
                }
                Err(error) => {
                    thrown = Some(error);
                    false
                }
            },
        );
        if let Some(error) = thrown {
            return Err(error);
        }
        if !is_decoded {
            return Ok(None);
        }
        // SAFETY: the plan was created with `formats.len()` names, and `values` has at least that many.
        let object = unsafe {
            JSC__AOT__ObjectBuilderPlan__createObject(global_object, self.plan, values.as_ptr())
        };
        Ok((!object.is_empty()).then_some(object))
    }
}

impl Drop for RowDecoder {
    fn drop(&mut self) {
        if !self.plan.is_null() {
            // SAFETY: `plan` came from `__create` and is destroyed only here.
            unsafe { JSC__AOT__ObjectBuilderPlan__destroy(self.plan) };
        }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Cell<'a> {
    Null,
    Int32(i32),
    Number(f64),
    Boolean(bool),
    Text(&'a str),
    Date { milliseconds: f64 },
}

fn decode_row<'a>(
    row: &'a [u8],
    formats: &[WireFormat],
    each: &mut dyn FnMut(usize, Cell<'a>) -> bool,
) -> bool {
    let Some((column_count, mut rest)) = row.split_first_chunk::<2>() else {
        return false;
    };
    if usize::from(u16::from_be_bytes(*column_count)) != formats.len() {
        return false;
    }
    for (index, &format) in formats.iter().enumerate() {
        let Some((length, after_length)) = rest.split_first_chunk::<4>() else {
            return false;
        };
        rest = after_length;
        let length = u32::from_be_bytes(*length);
        let cell = if length == u32::MAX {
            Cell::Null
        } else {
            let Some((bytes, after_bytes)) = rest.split_at_checked(length as usize) else {
                return false;
            };
            rest = after_bytes;
            let Some(cell) = decode_cell(format, bytes) else {
                return false;
            };
            cell
        };
        if !each(index, cell) {
            return false;
        }
    }
    rest.is_empty()
}

fn decode_cell(format: WireFormat, bytes: &[u8]) -> Option<Cell<'_>> {
    match format {
        WireFormat::Int32 => Some(Cell::Int32(i32::from_be_bytes(bytes.try_into().ok()?))),
        WireFormat::Float32 => Some(Cell::Number(f32::from_bits(u32::from_be_bytes(
            bytes.try_into().ok()?,
        )) as f64)),
        WireFormat::Float64 => Some(Cell::Number(f64::from_bits(u64::from_be_bytes(
            bytes.try_into().ok()?,
        )))),
        WireFormat::Boolean => {
            let [byte] = bytes else {
                return None;
            };
            Some(Cell::Boolean(*byte == 1))
        }
        WireFormat::Text => core::str::from_utf8(bytes).ok().map(Cell::Text),
        WireFormat::TimestampMicroseconds => {
            if bytes.len() != 8 {
                return None;
            }
            let milliseconds = date::from_binary(bytes);
            milliseconds
                .is_finite()
                .then_some(Cell::Date { milliseconds })
        }
    }
}

fn create_field_value(global_object: &JSGlobalObject, cell: Cell<'_>) -> JsResult<FieldValue> {
    Ok(match cell {
        Cell::Null => FieldValue::Boxed(JSValue::NULL),
        Cell::Int32(value) => FieldValue::Int32(value),
        Cell::Number(value) => FieldValue::Double(value),
        Cell::Boolean(value) => FieldValue::Boolean(value),
        Cell::Text(text) => FieldValue::Boxed(bun_string_jsc::create_utf8_for_js(
            global_object,
            text.as_bytes(),
        )?),
        Cell::Date { milliseconds } => {
            let date = JSValue::from_date_number(global_object, milliseconds);
            if date.is_empty() {
                return Err(JsError::Thrown);
            }
            FieldValue::Boxed(date)
        }
    })
}

#[repr(C)]
struct Name {
    utf8: *const u8,
    length: u32,
}

#[repr(C, u32)]
#[derive(Clone, Copy)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "JSC__AOT__ObjectBuilderPlan__createObject reads the payloads"
    )
)]
enum FieldValue {
    Boxed(JSValue),
    Int32(i32),
    Double(f64),
    Boolean(bool),
}

const _: () = assert!(size_of::<FieldValue>() == 16 && align_of::<FieldValue>() == 8);

unsafe extern "C" {
    safe fn JSC__AOT__expectedResultType(global_object: &JSGlobalObject, target: JSValue) -> u32;
    fn JSC__AOT__ObjectBuilderPlan__create(
        global_object: &JSGlobalObject,
        expected_result_type: u32,
        names: *const Name,
        count: u32,
    ) -> *mut c_void;
    fn JSC__AOT__ObjectBuilderPlan__destroy(plan: *mut c_void);
    fn JSC__AOT__ObjectBuilderPlan__createObject(
        global_object: &JSGlobalObject,
        plan: *const c_void,
        field_values: *const FieldValue,
    ) -> JSValue;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_row(cells: &[Option<&[u8]>]) -> Vec<u8> {
        let mut row = (cells.len() as u16).to_be_bytes().to_vec();
        for cell in cells {
            match cell {
                Some(bytes) => {
                    row.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
                    row.extend_from_slice(bytes);
                }
                None => row.extend_from_slice(&u32::MAX.to_be_bytes()),
            }
        }
        row
    }

    fn decode_cells<'a>(row: &'a [u8], formats: &[WireFormat]) -> Option<Vec<Cell<'a>>> {
        let mut cells = Vec::new();
        let is_decoded = decode_row(row, formats, &mut |index, cell| {
            assert_eq!(index, cells.len());
            cells.push(cell);
            true
        });
        is_decoded.then_some(cells)
    }

    #[test]
    fn decodes_every_format_and_null() {
        let row = encode_row(&[
            Some(&(-7i32).to_be_bytes()),
            Some(&1.5f32.to_bits().to_be_bytes()),
            Some(&2.25f64.to_bits().to_be_bytes()),
            Some(&[1]),
            Some(b"text"),
            Some(&0i64.to_be_bytes()),
            None,
        ]);
        let formats = [
            WireFormat::Int32,
            WireFormat::Float32,
            WireFormat::Float64,
            WireFormat::Boolean,
            WireFormat::Text,
            WireFormat::TimestampMicroseconds,
            WireFormat::Int32,
        ];
        let expected = vec![
            Cell::Int32(-7),
            Cell::Number(1.5),
            Cell::Number(2.25),
            Cell::Boolean(true),
            Cell::Text("text"),
            Cell::Date {
                milliseconds: 946_684_800_000.0,
            },
            Cell::Null,
        ];
        assert_eq!(decode_cells(&row, &formats), Some(expected));
    }

    #[test]
    fn timestamp_floors_before_year_2000() {
        let row = encode_row(&[Some(&(-1i64).to_be_bytes())]);
        let expected = vec![Cell::Date {
            milliseconds: 946_684_799_999.0,
        }];
        assert_eq!(
            decode_cells(&row, &[WireFormat::TimestampMicroseconds]),
            Some(expected)
        );
    }

    #[test]
    fn empty_text_is_text() {
        let row = encode_row(&[Some(b"")]);
        assert_eq!(
            decode_cells(&row, &[WireFormat::Text]),
            Some(vec![Cell::Text("")])
        );
    }

    #[test]
    fn rejects_extra_column() {
        let row = encode_row(&[Some(b"a"), Some(b"b")]);
        assert_eq!(decode_cells(&row, &[WireFormat::Text]), None);
    }

    #[test]
    fn rejects_length_past_end() {
        let mut row = encode_row(&[Some(b"abc")]);
        row.pop();
        assert_eq!(decode_cells(&row, &[WireFormat::Text]), None);
    }

    #[test]
    fn rejects_wrong_fixed_length() {
        let row = encode_row(&[Some(&0i64.to_be_bytes())]);
        assert_eq!(decode_cells(&row, &[WireFormat::Int32]), None);
    }

    #[test]
    fn rejects_trailing_byte() {
        let mut row = encode_row(&[Some(b"a")]);
        row.push(0);
        assert_eq!(decode_cells(&row, &[WireFormat::Text]), None);
    }

    #[test]
    fn rejects_invalid_utf8() {
        let row = encode_row(&[Some(&[0xff, 0xfe])]);
        assert_eq!(decode_cells(&row, &[WireFormat::Text]), None);
    }

    #[test]
    fn rejects_infinite_timestamps() {
        for microseconds in [i64::MAX, i64::MIN] {
            let row = encode_row(&[Some(&microseconds.to_be_bytes())]);
            assert_eq!(
                decode_cells(&row, &[WireFormat::TimestampMicroseconds]),
                None
            );
        }
    }

    #[test]
    fn field_value_is_tag_then_payload() {
        let values = [
            FieldValue::Boxed(JSValue::NULL),
            FieldValue::Int32(-7),
            FieldValue::Double(1.5),
            FieldValue::Boolean(true),
        ];
        for (kind, value) in values.iter().enumerate() {
            // SAFETY: `#[repr(C, u32)]` puts the `u32` tag first.
            let tag = unsafe { *ptr::from_ref(value).cast::<u32>() };
            assert_eq!(tag as usize, kind);
            let payload = match value {
                FieldValue::Boxed(boxed) => ptr::from_ref(boxed).addr(),
                FieldValue::Int32(number) => ptr::from_ref(number).addr(),
                FieldValue::Double(number) => ptr::from_ref(number).addr(),
                FieldValue::Boolean(boolean) => ptr::from_ref(boolean).addr(),
            };
            assert_eq!(payload - ptr::from_ref(value).addr(), 8);
        }
    }

    #[test]
    fn stops_when_callback_answers_false() {
        let row = encode_row(&[Some(b"a"), Some(b"b"), Some(b"c")]);
        let mut calls = 0;
        let is_decoded = decode_row(&row, &[WireFormat::Text; 3], &mut |_, _| {
            calls += 1;
            calls < 2
        });
        assert!(!is_decoded);
        assert_eq!(calls, 2);
    }
}

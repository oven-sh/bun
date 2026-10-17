use core::ffi::c_void;
use core::ptr;

use crate::jsc::{JSGlobalObject, JSValue};

#[repr(u8)]
#[derive(Clone, Copy)]
pub(crate) enum WireFormat {
    Int32,
    Float32,
    Float64,
    Boolean,
    Text,
    TimestampMicroseconds,
}

#[repr(C)]
pub(crate) struct RowColumn {
    pub(crate) name: *const u8,
    pub(crate) name_length: u32,
    pub(crate) format: WireFormat,
}

pub(crate) struct RowDecoder {
    row_type: u32,
    handle: *mut c_void,
}

impl Default for RowDecoder {
    fn default() -> Self {
        Self { row_type: 0, handle: ptr::null_mut() }
    }
}

impl RowDecoder {
    pub(crate) fn expected_row_type(global_object: &JSGlobalObject, query: JSValue) -> u32 {
        JSC__AOT__expectedRowType(global_object, query)
    }

    pub(crate) fn convert_last_row(global_object: &JSGlobalObject, row_type: u32, rows: JSValue) {
        JSC__AOT__convertLastRow(global_object, row_type, rows);
    }

    pub(crate) fn is_for(&self, row_type: u32) -> bool {
        self.row_type == row_type
    }

    pub(crate) fn new(global_object: &JSGlobalObject, row_type: u32, columns: Option<&[RowColumn]>) -> Self {
        Self {
            row_type,
            handle: columns.map_or(ptr::null_mut(), |columns| JSC__AOT__RowDecoder__create(global_object, row_type, columns.as_ptr(), columns.len() as u32)),
        }
    }

    pub(crate) fn append_row(&self, global_object: &JSGlobalObject, row: &[u8], rows: JSValue) -> Option<JSValue> {
        if self.handle.is_null() {
            return None;
        }
        let appended_to = JSC__AOT__RowDecoder__appendRow(global_object, self.handle, row.as_ptr(), row.len(), rows);
        (!appended_to.is_empty()).then_some(appended_to)
    }
}

impl Drop for RowDecoder {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            JSC__AOT__RowDecoder__destroy(self.handle);
        }
    }
}

unsafe extern "C" {
    safe fn JSC__AOT__expectedRowType(global_object: &JSGlobalObject, query: JSValue) -> u32;
    safe fn JSC__AOT__convertLastRow(global_object: &JSGlobalObject, row_type: u32, rows: JSValue);
    safe fn JSC__AOT__RowDecoder__create(global_object: &JSGlobalObject, row_type: u32, columns: *const RowColumn, column_count: u32) -> *mut c_void;
    safe fn JSC__AOT__RowDecoder__destroy(decoder: *mut c_void);
    safe fn JSC__AOT__RowDecoder__appendRow(global_object: &JSGlobalObject, decoder: *const c_void, bytes: *const u8, size: usize, rows: JSValue) -> JSValue;
}

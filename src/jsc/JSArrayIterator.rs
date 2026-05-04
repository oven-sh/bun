use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsResult};

pub struct JSArrayIterator<'a> {
    pub i: u32,
    pub len: u32,
    pub array: JSValue,
    pub global: &'a JSGlobalObject,
    /// Direct pointer into the JSArray butterfly when the array has Int32 or
    /// Contiguous storage and a sane prototype chain. Holes are encoded as 0.
    pub fast: Option<*const JSValue>,
}

impl<'a> JSArrayIterator<'a> {
    pub fn init(value: JSValue, global: &'a JSGlobalObject) -> JsResult<JSArrayIterator<'a>> {
        let mut length: u32 = 0;
        // SAFETY: FFI call into JSC; `value` is a valid JSValue on the stack,
        // `length` is a valid out-param.
        let elements = unsafe { Bun__JSArray__getContiguousVector(value, &mut length) };
        if !elements.is_null() {
            return Ok(JSArrayIterator {
                i: 0,
                len: length,
                array: value,
                global,
                fast: Some(elements),
            });
        }
        Ok(JSArrayIterator {
            i: 0,
            len: value.get_length(global)? as u32,
            array: value,
            global,
            fast: None,
        })
    }

    pub fn next(&mut self) -> JsResult<Option<JSValue>> {
        if !(self.i < self.len) {
            return Ok(None);
        }
        let i = self.i;
        self.i += 1;
        if let Some(elements) = self.fast {
            // SAFETY: FFI call into JSC; `elements` was obtained from
            // Bun__JSArray__getContiguousVector for `self.array` and `self.len`.
            if unsafe { Bun__JSArray__contiguousVectorIsStillValid(self.array, elements, self.len) }
            {
                // SAFETY: validity check above guarantees `elements[0..self.len]`
                // still backs the array's butterfly; `i < self.len`.
                let val = unsafe { *elements.add(i as usize) };
                return Ok(Some(if val.is_empty() {
                    JSValue::UNDEFINED
                } else {
                    val
                }));
            }
            self.fast = None;
        }
        Ok(Some(JSObject::get_index(self.array, self.global, i)?))
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__JSArray__getContiguousVector(value: JSValue, out_len: *mut u32) -> *const JSValue;
    fn Bun__JSArray__contiguousVectorIsStillValid(
        value: JSValue,
        elements: *const JSValue,
        len: u32,
    ) -> bool;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSArrayIterator.zig (52 lines)
//   confidence: high
//   todos:      1
//   notes:      stack-only iterator (bare JSValue field OK); externs to jsc_sys
// ──────────────────────────────────────────────────────────────────────────

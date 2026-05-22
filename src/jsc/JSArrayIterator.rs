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
        let elements = Bun__JSArray__getContiguousVector(value, &mut length);
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
            if Bun__JSArray__contiguousVectorIsStillValid(self.array, elements, self.len) {
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
    safe fn Bun__JSArray__getContiguousVector(value: JSValue, out_len: &mut u32) -> *const JSValue;
    // safe: by-value `JSValue`/`u32`; `elements` is only pointer-compared against
    // the array's current butterfly storage (bindings.cpp `== expected`), never
    // dereferenced — no validity precondition.
    safe fn Bun__JSArray__contiguousVectorIsStillValid(
        value: JSValue,
        elements: *const JSValue,
        len: u32,
    ) -> bool;
}

// ported from: src/jsc/JSArrayIterator.zig

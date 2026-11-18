use bun_core::String;
use bun_engine_number::NumberText;

use crate::{JSGlobalObject, JSValue, JsResult, StringJsc as _};

/// Builds a JS string. Running out of memory or of length is recorded, and thrown by [`Self::to_string`].
pub struct StringBuilder(bun_engine_text::StringBuilder);

impl StringBuilder {
    #[inline]
    pub fn init() -> StringBuilder {
        StringBuilder(bun_engine_text::StringBuilder::new())
    }

    #[inline]
    pub fn append_latin1(&mut self, value: &[u8]) {
        self.0.push_latin1_slice(value)
    }

    pub fn append_double(&mut self, value: f64) {
        self.append_latin1(&NumberText::from(value))
    }

    pub fn append_int(&mut self, value: i32) {
        self.append_latin1(&NumberText::from(value))
    }

    pub fn append_usize(&mut self, value: usize) {
        self.append_latin1(&NumberText::from(value as u64))
    }

    pub fn append_string(&mut self, value: &String) {
        match value.text() {
            Some(text) => self.0.push_text(text),
            None => self.0.push_utf8_lossy(value.byte_slice()),
        }
    }

    #[inline]
    pub fn append_lchar(&mut self, value: u8) {
        self.0.push_latin1(value)
    }

    #[inline]
    pub fn append_uchar(&mut self, value: u16) {
        self.0.push_unit(value)
    }

    /// The builder is empty afterwards.
    pub fn to_string(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self.0.take() {
            Ok(string) => String::from(string).into_js(global),
            Err(_) => Err(global.throw_out_of_memory()),
        }
    }

    pub fn ensure_unused_capacity(&mut self, additional: usize) {
        self.0.reserve(additional)
    }
}

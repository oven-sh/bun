//! JSON that is written once, from start to end, and may not fit in memory.

use bun_engine_number::{NUMBER_TEXT_CAPACITY, NumberText, write_u64};
use bun_engine_text::{AllocError, StringBuilder, StringRef, Text};

pub(crate) trait JsonWriter: Default {
    type Output;

    fn raw(&mut self, ascii: &[u8]);

    fn string(&mut self, text: Text<'_>);

    fn finish(self) -> Result<Self::Output, AllocError>;

    fn integer(&mut self, integer: u64) {
        let mut digits = [0; NUMBER_TEXT_CAPACITY];
        let length = write_u64(integer, &mut digits);
        self.raw(&digits[..length]);
    }

    fn number(&mut self, number: f64) {
        self.raw(&NumberText::from(number));
    }

    /// With commas between them.
    fn integers(&mut self, integers: &[u64]) {
        self.separated(integers, |out, &integer| out.integer(integer));
    }

    fn separated<T>(
        &mut self,
        items: impl IntoIterator<Item = T>,
        mut write: impl FnMut(&mut Self, T),
    ) {
        for (index, item) in items.into_iter().enumerate() {
            if index != 0 {
                self.raw(b",");
            }
            write(self, item);
        }
    }
}

impl JsonWriter for StringBuilder {
    type Output = StringRef;

    fn raw(&mut self, ascii: &[u8]) {
        self.push_latin1_slice(ascii);
    }

    fn string(&mut self, text: Text<'_>) {
        self.push_json_quoted(text);
    }

    fn finish(self) -> Result<StringRef, AllocError> {
        StringBuilder::finish(self)
    }
}

#[derive(Default)]
pub(crate) struct Utf8Writer {
    bytes: Vec<u8>,
    quoted: StringBuilder,
    has_overflowed: bool,
}

impl Utf8Writer {
    /// As for a string.
    const MAX_LENGTH: usize = bun_engine_text::MAX_LENGTH;

    fn reserve(&mut self, count: usize) -> bool {
        self.has_overflowed |=
            count > Self::MAX_LENGTH - self.bytes.len() || self.bytes.try_reserve(count).is_err();
        !self.has_overflowed
    }
}

impl JsonWriter for Utf8Writer {
    type Output = Vec<u8>;

    fn raw(&mut self, ascii: &[u8]) {
        if self.reserve(ascii.len()) {
            self.bytes.extend_from_slice(ascii);
        }
    }

    fn string(&mut self, text: Text<'_>) {
        self.quoted.truncate(0);
        self.quoted.push_json_quoted(text);
        self.has_overflowed |= self.quoted.has_overflowed();
        let (start, length) = (self.bytes.len(), self.quoted.text().utf8_len());
        if self.reserve(length) {
            self.bytes.resize(start + length, 0);
            (self.quoted.text()).encode_utf8_into(&mut self.bytes[start..]);
        }
    }

    fn finish(self) -> Result<Vec<u8>, AllocError> {
        if self.has_overflowed {
            return Err(AllocError);
        }
        Ok(self.bytes)
    }
}

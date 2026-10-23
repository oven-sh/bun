use bun_core::fmt::{ItoaBuf, itoa};
use bun_core::printer::json_stringify;

pub(super) struct JsonWriter {
    bytes: Vec<u8>,
    needs_comma: bool,
}

impl JsonWriter {
    pub(super) fn object() -> JsonWriter {
        JsonWriter {
            bytes: vec![b'{'],
            needs_comma: false,
        }
    }

    pub(super) fn string(&mut self, key: &str, value: &[u8]) {
        self.write_key(key);
        self.write_string(value);
    }

    pub(super) fn number(&mut self, key: &str, value: u64) {
        self.write_key(key);
        self.write_decimal(value);
    }

    pub(super) fn boolean(&mut self, key: &str, value: bool) {
        let text: &[u8] = if value { b"true" } else { b"false" };
        self.write_key(key);
        self.bytes.extend_from_slice(text);
    }

    pub(super) fn strings<'a>(&mut self, key: &str, values: impl Iterator<Item = &'a [u8]>) {
        self.write_key(key);
        self.bytes.push(b'[');
        for (index, value) in values.enumerate() {
            if index > 0 {
                self.bytes.push(b',');
            }
            self.write_string(value);
        }
        self.bytes.push(b']');
    }

    pub(super) fn null(&mut self, key: &str) {
        self.write_key(key);
        self.bytes.extend_from_slice(b"null");
    }

    pub(super) fn optional_string(&mut self, key: &str, value: Option<&[u8]>) {
        match value {
            Some(value) => self.string(key, value),
            None => self.null(key),
        }
    }

    pub(super) fn optional_number(&mut self, key: &str, value: Option<u64>) {
        match value {
            Some(value) => self.number(key, value),
            None => self.null(key),
        }
    }

    pub(super) fn begin_array(&mut self, key: &str) {
        self.write_key(key);
        self.bytes.push(b'[');
        self.needs_comma = false;
    }

    pub(super) fn end_array(&mut self) {
        self.bytes.push(b']');
        self.needs_comma = true;
    }

    pub(super) fn begin_element(&mut self) {
        if self.needs_comma {
            self.bytes.push(b',');
        }
        self.bytes.push(b'{');
        self.needs_comma = false;
    }

    pub(super) fn begin_object(&mut self, key: &str) {
        self.write_key(key);
        self.bytes.push(b'{');
        self.needs_comma = false;
    }

    pub(super) fn end_object(&mut self) {
        self.bytes.push(b'}');
        self.needs_comma = true;
    }

    pub(super) fn finish(mut self) -> Vec<u8> {
        self.bytes.push(b'}');
        self.bytes
    }

    fn write_key(&mut self, key: &str) {
        if self.needs_comma {
            self.bytes.push(b',');
        }
        self.needs_comma = true;
        self.bytes.push(b'"');
        self.bytes.extend_from_slice(key.as_bytes());
        self.bytes.extend_from_slice(b"\":");
    }

    fn write_decimal(&mut self, value: u64) {
        let mut buffer = ItoaBuf::new();
        self.bytes.extend_from_slice(itoa(&mut buffer, value));
    }

    fn write_string(&mut self, value: &[u8]) {
        json_stringify(value, &mut self.bytes);
    }
}

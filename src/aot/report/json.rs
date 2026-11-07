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
        json_stringify(value, &mut self.bytes);
    }

    pub(super) fn number(&mut self, key: &str, value: u64) {
        self.write_key(key);
        self.write_decimal(value);
    }

    pub(super) fn tenths(&mut self, key: &str, tenths: u32) {
        self.write_key(key);
        self.write_decimal(u64::from(tenths / 10));
        self.bytes.push(b'.');
        self.write_decimal(u64::from(tenths % 10));
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
            json_stringify(value, &mut self.bytes);
        }
        self.bytes.push(b']');
    }

    pub(super) fn optional_strings<'a>(
        &mut self,
        key: &str,
        values: impl Iterator<Item = Option<&'a [u8]>>,
    ) {
        self.write_key(key);
        self.bytes.push(b'[');
        for (index, value) in values.enumerate() {
            if index > 0 {
                self.bytes.push(b',');
            }
            match value {
                Some(value) => json_stringify(value, &mut self.bytes),
                None => self.bytes.extend_from_slice(b"null"),
            }
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

    pub(super) fn objects<T>(
        &mut self,
        key: &str,
        items: impl IntoIterator<Item = T>,
        mut write_members: impl FnMut(&mut JsonWriter, T),
    ) {
        self.begin_array(key);
        for item in items {
            self.begin_element();
            write_members(self, item);
            self.end_object();
        }
        self.end_array();
    }

    pub(super) fn begin_element(&mut self) {
        if self.needs_comma {
            self.bytes.push(b',');
        }
        self.bytes.push(b'{');
        self.needs_comma = false;
    }

    pub(super) fn begin_array_element(&mut self) {
        if self.needs_comma {
            self.bytes.push(b',');
        }
        self.bytes.push(b'[');
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
}

#[cfg(test)]
mod tests {
    use bstr::BString;

    use super::*;

    fn object_with(write: impl FnOnce(&mut JsonWriter)) -> BString {
        let mut json = JsonWriter::object();
        write(&mut json);
        BString::from(json.finish())
    }

    fn escaped(value: &[u8]) -> BString {
        let object = object_with(|json| json.string("s", value));
        let member = object.strip_prefix(b"{\"s\":");
        let token = member.and_then(|member| member.strip_suffix(b"}"));
        BString::from(token.expect("an object with one member"))
    }

    #[test]
    fn empty_object() {
        assert_eq!(object_with(|_| {}), "{}");
    }

    #[test]
    fn commas_separate_members() {
        let object = object_with(|json| {
            json.string("reason", b"unknown-object");
            json.number("rank", 1);
            json.number("largest", u64::MAX);
            json.boolean("inDependency", true);
            json.boolean("isLast", false);
        });
        let expected = concat!(
            r#"{"reason":"unknown-object","rank":1,"largest":18446744073709551615,"#,
            r#""inDependency":true,"isLast":false}"#,
        );
        assert_eq!(object, expected);
    }

    #[test]
    fn escapes_quote_and_backslash() {
        assert_eq!(escaped(b""), r#""""#);
        assert_eq!(escaped(br#"a"b\c"#), r#""a\"b\\c""#);
    }

    #[test]
    fn escapes_newline_return_tab() {
        assert_eq!(escaped(b"a\nb\rc\td"), r#""a\nb\rc\td""#);
    }

    #[test]
    fn escapes_other_controls() {
        let token = escaped(b"\x00\x08\x0b\x0c\x1f");
        assert_eq!(token, r#""\u0000\b\u000b\f\u001f""#);
        for byte in 0x00..0x20 {
            let token = escaped(&[byte]);
            assert!(token.iter().all(|&written| written >= 0x20), "{byte:#x}");
        }
    }

    #[test]
    fn copies_printable_bytes() {
        assert_eq!(escaped(b" /'<>&\x7f"), "\" /'<>&\x7f\"");
    }

    #[test]
    fn copies_valid_utf8() {
        let text = "\u{e9}\u{20ac}\u{1f600}\u{2028}\u{fffd}";
        assert_eq!(escaped(text.as_bytes()), format!("\"{text}\""));
    }

    #[test]
    fn output_is_utf8() {
        for byte in 0x80..=0xff {
            let token = escaped(&[b'a', byte, b'"']);
            assert_eq!(token, "\"a\u{fffd}\\\"\"", "{byte:#x}");
        }
        assert_eq!(escaped(b"\xe2\x82"), "\"\u{fffd}\u{fffd}\"");
        assert_eq!(escaped(b"\xed\xa0\x80"), r#""\ud800""#);
    }

    #[test]
    fn strings_form_array() {
        let values: [&[u8]; 3] = [b"Item", b"\"a\"", b""];
        let object = object_with(|json| {
            json.strings("types", values.into_iter());
            json.number("next", 1);
        });
        assert_eq!(object, r#"{"types":["Item","\"a\"",""],"next":1}"#);
    }

    #[test]
    fn absent_strings_are_null_in_array() {
        let values: [Option<&[u8]>; 3] = [Some(b"a"), None, Some(b"")];
        let object = object_with(|json| {
            json.optional_strings("texts", values.into_iter());
            json.number("next", 1);
        });
        assert_eq!(object, r#"{"texts":["a",null,""],"next":1}"#);
    }

    #[test]
    fn arrays_nest() {
        let object = object_with(|json| {
            json.begin_array("lists");
            json.begin_array_element();
            json.begin_element();
            json.number("a", 1);
            json.end_object();
            json.end_array();
            json.begin_array_element();
            json.end_array();
            json.end_array();
            json.number("next", 2);
        });
        assert_eq!(object, r#"{"lists":[[{"a":1}],[]],"next":2}"#);
    }

    #[test]
    fn empty_strings_form_empty_array() {
        let object = object_with(|json| {
            json.number("previous", 1);
            json.strings("types", core::iter::empty());
            json.number("next", 2);
        });
        assert_eq!(object, r#"{"previous":1,"types":[],"next":2}"#);
    }

    #[test]
    fn objects_nest() {
        let object = object_with(|json| {
            json.number("a", 1);
            json.begin_object("b");
            json.begin_object("c");
            json.end_object();
            json.boolean("d", true);
            json.begin_object("e");
            json.string("f", b"g");
            json.end_object();
            json.end_object();
            json.number("h", 2);
        });
        let expected = r#"{"a":1,"b":{"c":{},"d":true,"e":{"f":"g"}},"h":2}"#;
        assert_eq!(object, expected);
    }

    #[test]
    fn absent_values_are_null() {
        let object = object_with(|json| {
            json.null("a");
            json.optional_string("b", None);
            json.optional_string("c", Some(b"x"));
            json.optional_number("d", None);
            json.optional_number("e", Some(7));
        });
        assert_eq!(object, r#"{"a":null,"b":null,"c":"x","d":null,"e":7}"#);
    }

    #[test]
    fn arrays_hold_objects() {
        let object = object_with(|json| {
            json.begin_array("empty");
            json.end_array();
            json.begin_array("sites");
            json.begin_element();
            json.number("line", 1);
            json.end_object();
            json.begin_element();
            json.end_object();
            json.end_array();
            json.number("next", 2);
        });
        assert_eq!(object, r#"{"empty":[],"sites":[{"line":1},{}],"next":2}"#);
    }

    #[test]
    fn nested_object_can_be_first() {
        let object = object_with(|json| {
            json.begin_object("type");
            json.number("line", 1);
            json.end_object();
        });
        assert_eq!(object, r#"{"type":{"line":1}}"#);
    }
}

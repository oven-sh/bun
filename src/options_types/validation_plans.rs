//! `JSON.parse<T>(text)` and `validate<T>(value)` in a program that is not compiled ahead of time: the transpiler erases `T`,
//! so it asks for the JSON Schema of `T` and writes `new Bun.Validator(schema)` into the call.

use std::io::Write;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ValidatingFunction {
    Parse,
    Validate,
}

/// A JSON value. The members of an object keep their order.
#[derive(Clone, PartialEq, Debug)]
pub enum Json {
    Null,
    Boolean(bool),
    /// Finite.
    Number(f64),
    /// WTF-8: a lone surrogate takes three bytes.
    String(Box<[u8]>),
    Array(Vec<Json>),
    Object(Vec<(Box<[u8]>, Json)>),
}

impl Json {
    pub fn to_text(&self) -> Vec<u8> {
        let mut text = Vec::new();
        self.write_text(&mut text);
        text
    }

    fn write_text(&self, text: &mut Vec<u8>) {
        match self {
            Json::Null => text.extend_from_slice(b"null"),
            Json::Boolean(true) => text.extend_from_slice(b"true"),
            Json::Boolean(false) => text.extend_from_slice(b"false"),
            Json::Number(number) => write_number(text, *number),
            Json::String(string) => write_string(text, string),
            Json::Array(items) => {
                text.push(b'[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        text.push(b',');
                    }
                    item.write_text(text);
                }
                text.push(b']');
            }
            Json::Object(members) => {
                text.push(b'{');
                for (index, (key, value)) in members.iter().enumerate() {
                    if index > 0 {
                        text.push(b',');
                    }
                    write_string(text, key);
                    text.push(b':');
                    value.write_text(text);
                }
                text.push(b'}');
            }
        }
    }
}

/// The shortest text that reads back as the same number.
fn write_number(text: &mut Vec<u8>, number: f64) {
    debug_assert!(number.is_finite(), "JSON has no text for {number}");
    let plain = format!("{number}");
    let scientific = format!("{number:e}");
    let shorter = if scientific.len() < plain.len() {
        scientific
    } else {
        plain
    };
    text.extend_from_slice(shorter.as_bytes());
}

fn write_string(text: &mut Vec<u8>, string: &[u8]) {
    text.push(b'"');
    let mut rest = string;
    while let [byte, tail @ ..] = rest {
        rest = tail;
        match (*byte, tail) {
            (b'"', _) => text.extend_from_slice(b"\\\""),
            (b'\\', _) => text.extend_from_slice(b"\\\\"),
            (b'\n', _) => text.extend_from_slice(b"\\n"),
            (b'\r', _) => text.extend_from_slice(b"\\r"),
            (b'\t', _) => text.extend_from_slice(b"\\t"),
            (0x00..=0x1F, _) => write_escape(text, u32::from(*byte)),
            // Only a lone surrogate begins like this.
            (0xED, &[second @ 0xA0..=0xBF, third, ref tail @ ..]) => {
                rest = tail;
                let low_bits = (u32::from(second & 0x3F) << 6) | u32::from(third & 0x3F);
                write_escape(text, 0xD000 | low_bits);
            }
            _ => text.push(*byte),
        }
    }
    text.push(b'"');
}

fn write_escape(text: &mut Vec<u8>, code_unit: u32) {
    write!(text, "\\u{code_unit:04X}").expect("writing to a Vec never fails");
}

#[derive(Clone, PartialEq, Debug)]
pub struct PlannedValidation {
    /// Where the first type argument of the call begins in the text of the file.
    pub type_argument: u32,
    pub function: ValidatingFunction,
    /// The JSON Schema of `T`.
    pub schema: Json,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RefusedValidation {
    /// In the text of the file.
    pub position: u32,
    pub message: Vec<u8>,
}

/// Of one file. A call that is in neither list has no type to validate against.
#[derive(Clone, PartialEq, Debug, Default)]
pub struct ValidationPlans {
    /// Ascending by `type_argument`.
    pub calls: Vec<PlannedValidation>,
    pub refused: Vec<RefusedValidation>,
}

impl ValidationPlans {
    pub fn find(&self, type_argument: u32) -> Option<&PlannedValidation> {
        let index = self
            .calls
            .binary_search_by_key(&type_argument, |call| call.type_argument);
        index.ok().map(|index| &self.calls[index])
    }
}

/// Where the first token at or behind `at` begins. The transpiler and the checker name a call by the place of its first type
/// argument, and each of them gets there with this.
pub fn skip_blanks_and_comments(text: &[u8], at: u32) -> u32 {
    let mut at = at as usize;
    loop {
        let rest = text.get(at..).unwrap_or_default();
        let blank = rest.len() - rest.trim_ascii_start().len();
        let comment = match &rest[blank..] {
            [b'/', b'/', line @ ..] => {
                let end = bun_core::strings::index_of_char_usize(line, b'\n');
                2 + end.unwrap_or(line.len())
            }
            [b'/', b'*', block @ ..] => {
                let end = bun_core::strings::index_of(block, b"*/");
                2 + end.map_or(block.len(), |end| end + 2)
            }
            _ => 0,
        };
        if blank + comment == 0 {
            return at as u32;
        }
        at += blank + comment;
    }
}

/// Whom the transpiler asks. It knows nothing of types.
#[derive(Copy, Clone)]
pub struct ValidationPlanSource {
    /// Handed to `find`. It outlives the parse.
    pub context: *const core::ffi::c_void,
    /// `None`: the file or what it imports could not be loaded, and the log says why.
    pub find: fn(
        context: *const core::ffi::c_void,
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
    ) -> Option<ValidationPlans>,
}

#[cfg(test)]
mod tests {
    use super::Json;

    fn text_of(value: &Json) -> String {
        String::from_utf8(value.to_text()).expect("the text of a JSON value is UTF-8")
    }

    fn string(bytes: &[u8]) -> Json {
        Json::String(bytes.into())
    }

    #[test]
    fn writes_every_kind_of_value() {
        let value = Json::Object(vec![
            (b"a".as_slice().into(), Json::Null),
            (
                b"b".as_slice().into(),
                Json::Array(vec![Json::Boolean(true), Json::Boolean(false)]),
            ),
            (b"c".as_slice().into(), Json::Object(Vec::new())),
            (b"d".as_slice().into(), Json::Array(Vec::new())),
            (b"e".as_slice().into(), string(b"text")),
            (b"f".as_slice().into(), Json::Number(1.5)),
        ]);
        assert_eq!(
            text_of(&value),
            r#"{"a":null,"b":[true,false],"c":{},"d":[],"e":"text","f":1.5}"#
        );
    }

    #[test]
    fn writes_the_shortest_number_that_reads_back() {
        let cases = [
            (0.0, "0"),
            (-0.0, "-0"),
            (5.0, "5"),
            (-2147483648.0, "-2147483648"),
            (0.1, "0.1"),
            (1e21, "1e21"),
            (1e300, "1e300"),
            (1.5e-9, "1.5e-9"),
            (100000.0, "1e5"),
            (1234.0, "1234"),
            (f64::MAX, "1.7976931348623157e308"),
            (5e-324, "5e-324"),
        ];
        for (number, expected) in cases {
            assert_eq!(text_of(&Json::Number(number)), expected);
            let read_back = expected.parse::<f64>().map(f64::to_bits);
            assert_eq!(read_back, Ok(number.to_bits()));
        }
    }

    #[test]
    fn escapes_quotes_backslashes_and_control_characters() {
        assert_eq!(
            text_of(&string(b"a\"b\\c\n\r\t\x00\x1F")),
            r#""a\"b\\c\n\r\t\u0000\u001F""#
        );
    }

    #[test]
    fn keeps_other_characters_as_they_are() {
        assert_eq!(
            text_of(&string("é€😀\u{D7FF}\u{E000}".as_bytes())),
            "\"é€😀\u{D7FF}\u{E000}\""
        );
    }

    #[test]
    fn escapes_lone_surrogates() {
        assert_eq!(text_of(&string(b"\xED\xA0\x80")), r#""\uD800""#);
        assert_eq!(text_of(&string(b"a\xED\xBF\xBFb")), r#""a\uDFFFb""#);
        assert_eq!(
            text_of(&string(b"\xED\xB0\x80\xED\xA0\x80")),
            r#""\uDC00\uD800""#
        );
    }

    #[test]
    fn escapes_keys_like_strings() {
        let value = Json::Object(vec![(b"\"\xED\xA0\x80".as_slice().into(), Json::Null)]);
        assert_eq!(text_of(&value), r#"{"\"\uD800":null}"#);
    }
}

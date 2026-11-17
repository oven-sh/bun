//! https://mimesniff.spec.whatwg.org/

use bun_core::strings;

use crate::Bytes;
use crate::headers::{collect_quoted, is_token, split, trim_http_whitespace};

#[derive(Clone)]
pub struct Mime {
    essence: Bytes,
    parameters: Vec<(Bytes, Bytes)>,
}

fn trim_end(text: &[u8]) -> &[u8] {
    &text[..text.len()
        - text
            .iter()
            .rev()
            .take_while(|it| matches!(it, b'\t' | b'\n' | b'\r' | b' '))
            .count()]
}

impl Mime {
    /// `text` is isomorphic encoded.
    pub fn parse(text: &[u8]) -> Option<Mime> {
        let text = trim_http_whitespace(text);
        let until = |text: &[u8], stops| strings::index_of_any(text, stops).unwrap_or(text.len());
        let (essence, mut rest) = text.split_at(until(text, b";"));
        let essence = trim_end(essence);
        strings::split_once_char(essence, b'/').filter(|it| is_token(it.0) && is_token(it.1))?;
        let mut mime = Mime {
            essence: essence.to_ascii_lowercase().into(),
            parameters: Vec::new(),
        };
        while let [_, after @ ..] = rest {
            let after = &after[after
                .iter()
                .take_while(|it| matches!(it, b'\t' | b'\n' | b'\r' | b' '))
                .count()..];
            let name;
            (name, rest) = after.split_at(until(after, b";="));
            let [b'=', given @ ..] = rest else { continue };
            let value = if given.starts_with(b"\"") {
                let (value, after) = collect_quoted(given);
                rest = &after[until(after, b";")..];
                value
            } else {
                let value;
                (value, rest) = given.split_at(until(given, b";"));
                if trim_end(value).is_empty() {
                    continue;
                }
                trim_end(value).to_vec()
            };
            let name = name.to_ascii_lowercase();
            if is_token(&name)
                && value
                    .iter()
                    .all(|it| matches!(it, b'\t' | b' '..=b'~' | 0x80..))
                && mime.parameter(&name).is_none()
            {
                mime.parameters.push((name.into(), value.into()));
            }
        }
        Some(mime)
    }

    /// https://fetch.spec.whatwg.org/#concept-header-extract-mime-type, from the value of `Content-Type`.
    pub fn extract(header: &[u8]) -> Option<Mime> {
        let (mut charset, mut found) = (None::<Bytes>, None::<Mime>);
        for mut mime in split(header, b',')
            .filter_map(Mime::parse)
            .filter(|it| it.essence() != b"*/*")
        {
            if found.is_none_or(|it| it.essence != mime.essence) {
                charset = mime.parameter(b"charset").map(Into::into);
            } else if let (Some(charset), None) = (&charset, mime.parameter(b"charset")) {
                mime.set_parameter(b"charset", charset);
            }
            found = Some(mime);
        }
        found
    }

    pub fn essence(&self) -> &[u8] {
        &self.essence
    }

    pub fn parameter(&self, name: &[u8]) -> Option<&[u8]> {
        self.parameters
            .iter()
            .find(|it| *it.0 == *name)
            .map(|it| &*it.1)
    }

    pub fn set_parameter(&mut self, name: &[u8], value: &[u8]) {
        match self.parameters.iter_mut().find(|it| *it.0 == *name) {
            Some(known) => known.1 = value.into(),
            None => self.parameters.push((name.into(), value.into())),
        }
    }

    pub fn serialize(&self) -> Vec<u8> {
        let mut out = self.essence.to_vec();
        for (name, value) in &self.parameters {
            out.extend([b";", &**name, b"="].concat());
            if is_token(value) {
                out.extend_from_slice(value);
                continue;
            }
            out.push(b'"');
            for byte in value {
                out.extend(
                    matches!(byte, b'"' | b'\\')
                        .then_some(b'\\')
                        .into_iter()
                        .chain([*byte]),
                );
            }
            out.push(b'"');
        }
        out
    }
}

pub fn is_javascript(essence: &[u8]) -> bool {
    match strings::split_once_char(essence, b'/') {
        Some((
            b"application" | b"text",
            b"ecmascript" | b"javascript" | b"x-ecmascript" | b"x-javascript",
        )) => true,
        Some((b"text", subtype)) => {
            matches!(subtype, b"jscript" | b"livescript")
                || matches!(subtype.strip_prefix(b"javascript1."), Some([b'0'..=b'5']))
        }
        _ => false,
    }
}

pub fn is_xml(essence: &[u8]) -> bool {
    matches!(essence, b"text/xml" | b"application/xml") || essence.ends_with(b"+xml")
}

pub fn is_json(essence: &[u8]) -> bool {
    matches!(essence, b"text/json" | b"application/json") || essence.ends_with(b"+json")
}

pub(crate) fn type_of(essence: &[u8]) -> &[u8] {
    strings::split_once_char(essence, b'/').map_or(b"", |it| it.0)
}

/// https://mimesniff.spec.whatwg.org/#minimize-a-supported-mime-type
pub fn minimize(essence: &[u8]) -> &[u8] {
    match essence {
        _ if is_javascript(essence) => b"text/javascript",
        _ if is_json(essence) => b"application/json",
        b"image/svg+xml" | b"application/pdf" | b"application/wasm" => essence,
        _ if is_xml(essence) => b"application/xml",
        _ if matches!(
            type_of(essence),
            b"audio" | b"font" | b"image" | b"text" | b"video"
        ) =>
        {
            essence
        }
        _ => b"",
    }
}

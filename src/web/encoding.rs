//! <https://encoding.spec.whatwg.org/>, and how a document, a URL or a form comes to its encoding.

use core::ops::Range;
use std::borrow::Cow;
use std::io::Write as _;

use bun_core::strings;
use encoding_rs::{CoderResult, EncoderResult};

use crate::url::Url;

const WHITESPACE: &[u8] = b"\t\n\x0c\r ";
const PRESCAN_LEN: usize = 1024;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Encoding(&'static encoding_rs::Encoding);

impl Default for Encoding {
    fn default() -> Encoding {
        Encoding(encoding_rs::UTF_8)
    }
}

/// An entry of a form.
pub struct Entry<'e> {
    pub name: &'e str,
    /// The name, of a file.
    pub value: &'e str,
    pub file_type: Option<&'e [u8]>,
}

impl Encoding {
    pub fn for_label(label: &[u8]) -> Option<Encoding> {
        encoding_rs::Encoding::for_label(label).map(Encoding)
    }

    pub fn for_bom(bytes: &[u8]) -> Option<Encoding> {
        encoding_rs::Encoding::for_bom(bytes).map(|it| Encoding(it.0))
    }

    /// As in `document.characterSet`.
    pub fn name(self) -> &'static str {
        self.0.name()
    }

    pub fn is_utf8(self) -> bool {
        self == Encoding::default()
    }

    /// What says in ASCII that it is UTF-16 is not.
    fn as_declared(self) -> Encoding {
        match self.0 == encoding_rs::UTF_16LE || self.0 == encoding_rs::UTF_16BE {
            true => Encoding::default(),
            false => self,
        }
    }

    pub fn declared_in_xml(bytes: &[u8]) -> Option<Encoding> {
        let start = bytes.strip_prefix(b"<?xml")?;
        let declaration = &start[..strings::index_of_char_usize(start, b'>')?];
        let skip_spaces = |it| skip_while(it, |byte| byte <= b' ');
        let after_name = strings::split_once(declaration, b"encoding")?.1;
        let [quote @ (b'"' | b'\''), value @ ..] =
            skip_spaces(skip_spaces(after_name).strip_prefix(b"=")?)
        else {
            return None;
        };
        let label = &value[..strings::index_of_char_usize(value, *quote)?];
        Encoding::for_label(label)
            .filter(|_| label.iter().all(|it| *it > b' '))
            .map(Encoding::as_declared)
    }

    /// <https://drafts.csswg.org/css-syntax/#determine-the-fallback-encoding>
    pub fn declared_in_css(bytes: &[u8]) -> Option<Encoding> {
        let value = bytes[..bytes.len().min(PRESCAN_LEN)].strip_prefix(b"@charset \"")?;
        let (label, rest) = value.split_at(strings::index_of_char_usize(value, b'"')?);
        Encoding::for_label(label)
            .filter(|_| rest.starts_with(b"\";"))
            .map(Encoding::as_declared)
    }

    /// By the `<meta>` that the parser would change the encoding for: in the first kilobyte, or in the head.
    pub fn declared_in_html(bytes: &[u8]) -> Option<Encoding> {
        if bytes.starts_with(b"<\0?\0x\0") {
            return Some(Encoding(encoding_rs::UTF_16LE));
        }
        if bytes.starts_with(b"\0<\0?\0x") {
            return Some(Encoding(encoding_rs::UTF_16BE));
        }
        (MetaScan::default().resume(bytes).flatten()).or_else(|| Encoding::declared_in_xml(bytes))
    }

    pub fn decoder(self) -> Decoder {
        Decoder(self.0.new_decoder())
    }

    /// For what is not the start.
    pub fn decoder_of_rest(self) -> Decoder {
        Decoder(self.0.new_decoder_without_bom_handling())
    }

    /// A byte order mark goes first. What `is_partial` loses a character that it has only the start of.
    pub fn decode(self, bytes: &[u8], is_partial: bool) -> Cow<'_, str> {
        if !is_partial {
            return self.0.decode(bytes).0;
        }
        self.decoder().decode(bytes, false).into()
    }

    /// `around` is for the number of a character that the encoding does not have.
    fn encode_into(self, out: &mut Vec<u8>, mut text: &str, around: [&str; 2]) {
        let mut encoder = self.0.output_encoding().new_encoder();
        loop {
            out.reserve(text.len() + 16);
            let (result, read) =
                encoder.encode_from_utf8_to_vec_without_replacement(text, out, true);
            text = &text[read..];
            match result {
                EncoderResult::InputEmpty => return,
                EncoderResult::OutputFull => {}
                EncoderResult::Unmappable(it) => {
                    _ = write!(out, "{}{}{}", around[0], it as u32, around[1]);
                }
            }
        }
    }

    fn encode_for_form(self, out: &mut Vec<u8>, text: &str) {
        self.encode_into(out, text, ["&#", ";"]);
    }

    /// <https://html.spec.whatwg.org/#encoding-parsing-a-url>
    pub fn parse_url(self, input: &str, base: &Url) -> Option<Url> {
        let url = base.join(input.as_bytes())?;
        if self.0.output_encoding() == encoding_rs::UTF_8
            || !matches!(url.scheme(), b"http" | b"https" | b"ftp" | b"file")
        {
            return Some(url);
        }
        let input = input.trim_end_matches(|it| it <= ' ');
        let end = strings::index_of_char_usize(input.as_bytes(), b'#').unwrap_or(input.len());
        let Some(start) = strings::index_of_char_usize(&input.as_bytes()[..end], b'?') else {
            return Some(url);
        };
        let query = input[start..end]
            .chars()
            .filter(|it| !matches!(it, '\t' | '\n' | '\r'));
        let (mut encoded, mut escaped) = (Vec::new(), input.as_bytes()[..start].to_vec());
        self.encode_into(&mut encoded, &query.collect::<String>(), ["%26%23", "%3B"]);
        for byte in encoded {
            match byte {
                b'!' | b'"' | b'$'..=b'~' => escaped.push(byte),
                _ => push_escaped(&mut escaped, byte),
            }
        }
        escaped.extend_from_slice(&input.as_bytes()[end..]);
        base.join(&escaped)
    }

    /// <https://html.spec.whatwg.org/#picking-an-encoding-for-the-form>, for a form in a document that has this one.
    pub fn for_form(self, accept_charset: Option<&[u8]>) -> Encoding {
        let picked = accept_charset.map_or(self, |it| {
            strings::tokenize_any(it, WHITESPACE)
                .find_map(Encoding::for_label)
                .unwrap_or_default()
        });
        Encoding(picked.0.output_encoding())
    }

    /// `application/x-www-form-urlencoded`
    pub fn url_encoded<'e>(self, entries: impl IntoIterator<Item = Entry<'e>>) -> Vec<u8> {
        let (mut out, mut encoded) = (Vec::new(), Vec::new());
        for (index, entry) in entries.into_iter().enumerate() {
            let separator: &[u8] = if index == 0 { b"" } else { b"&" };
            for (before, text) in [(separator, entry.name), (b"=", entry.value)] {
                out.extend_from_slice(before);
                encoded.clear();
                self.encode_for_form(&mut encoded, &with_crlf(text));
                for byte in encoded.iter().copied() {
                    match byte {
                        b' ' => out.push(b'+'),
                        b'*' | b'-' | b'.' | b'_' => out.push(byte),
                        _ if byte.is_ascii_alphanumeric() => out.push(byte),
                        _ => push_escaped(&mut out, byte),
                    }
                }
            }
        }
        out
    }

    /// `text/plain`
    pub fn plain_text<'e>(self, entries: impl IntoIterator<Item = Entry<'e>>) -> Vec<u8> {
        let (mut text, mut out) = (String::new(), Vec::new());
        for entry in entries {
            text.extend([
                &*with_crlf(entry.name),
                "=",
                &*with_crlf(entry.value),
                "\r\n",
            ]);
        }
        self.encode_for_form(&mut out, &text);
        out
    }

    /// `multipart/form-data`: all but the contents of the files, and where those go.
    pub fn multipart<'e>(
        self,
        entries: impl IntoIterator<Item = Entry<'e>>,
        boundary: &[u8],
    ) -> (Vec<u8>, Vec<usize>) {
        let (mut out, mut gaps) = (Vec::new(), Vec::new());
        for entry in entries {
            out.extend(
                [
                    b"--",
                    boundary,
                    b"\r\nContent-Disposition: form-data; name=",
                ]
                .concat(),
            );
            self.push_quoted(&mut out, &with_crlf(entry.name));
            match entry.file_type {
                None => {
                    out.extend_from_slice(b"\r\n\r\n");
                    self.encode_for_form(&mut out, &with_crlf(entry.value));
                }
                Some(given) => {
                    let known: &[u8] = match given {
                        b"" => b"application/octet-stream",
                        _ => given,
                    };
                    out.extend_from_slice(b"; filename=");
                    self.push_quoted(&mut out, entry.value);
                    out.extend([b"\r\nContent-Type: ", known, b"\r\n\r\n"].concat());
                    gaps.push(out.len());
                }
            }
            out.extend_from_slice(b"\r\n");
        }
        out.extend([b"--", boundary, b"--\r\n"].concat());
        (out, gaps)
    }

    fn push_quoted(self, out: &mut Vec<u8>, text: &str) {
        let mut escaped = String::with_capacity(text.len());
        for character in text.chars() {
            match character {
                '\n' => escaped.push_str("%0A"),
                '\r' => escaped.push_str("%0D"),
                '"' => escaped.push_str("%22"),
                _ => escaped.push(character),
            }
        }
        out.push(b'"');
        self.encode_for_form(out, &escaped);
        out.push(b'"');
    }
}

fn push_escaped(out: &mut Vec<u8>, byte: u8) {
    _ = write!(out, "%{byte:02X}");
}

fn with_crlf(text: &str) -> Cow<'_, str> {
    if strings::index_of_any(text.as_bytes(), b"\r\n").is_none() {
        return text.into();
    }
    let (mut out, mut last) = (String::with_capacity(text.len() + 8), '\0');
    for character in text.chars() {
        match character {
            '\n' if last == '\r' => {}
            '\n' | '\r' => out.push_str("\r\n"),
            _ => out.push(character),
        }
        last = character;
    }
    out.into()
}

fn skip_while(bytes: &[u8], test: impl Fn(u8) -> bool) -> &[u8] {
    &bytes[bytes.iter().take_while(|it| test(**it)).count()..]
}

fn split_at_any<'b>(bytes: &'b [u8], ends: &[u8]) -> (&'b [u8], &'b [u8]) {
    bytes.split_at(strings::index_of_any(bytes, ends).unwrap_or(bytes.len()))
}

fn skip_whitespace(bytes: &[u8]) -> &[u8] {
    skip_while(bytes, |it| it.is_ascii_whitespace())
}

/// The name, the value and what follows.
fn next_attribute(bytes: &[u8]) -> Option<[&[u8]; 3]> {
    let bytes = skip_while(bytes, |it| it.is_ascii_whitespace() || it == b'/');
    bytes.first().filter(|it| **it != b'>')?;
    let rest = split_at_any(&bytes[1..], b"\t\n\x0c\r /=>").1;
    let name = &bytes[..bytes.len() - rest.len()];
    let Some(value) = skip_whitespace(rest)
        .strip_prefix(b"=")
        .map(skip_whitespace)
    else {
        return Some([name, &rest[..0], rest]);
    };
    if let [quote @ (b'"' | b'\''), quoted @ ..] = value {
        let (value, rest) = split_at_any(quoted, &[*quote]);
        return Some([name, value, rest.get(1..).unwrap_or(rest)]);
    }
    let (value, rest) = split_at_any(value, b"\t\n\x0c\r >");
    Some([name, value, rest])
}

fn is_one_of(name: &[u8], names: &[&str]) -> bool {
    names
        .iter()
        .any(|it| name.eq_ignore_ascii_case(it.as_bytes()))
}

/// Or else from where to look when there is more.
fn index_of_end_tag(bytes: &[u8], name: &[u8]) -> Result<usize, usize> {
    let mut at = 0;
    loop {
        at +=
            strings::index_of(&bytes[at..], b"</").ok_or_else(|| bytes.len().saturating_sub(1))?;
        let (found, rest) = bytes[at + 2..].split_at_checked(name.len()).ok_or(at)?;
        if found.eq_ignore_ascii_case(name)
            && strings::contains_char(b"\t\n\x0c\r />", *rest.first().ok_or(at)?)
        {
            return Ok(at);
        }
        at += 2;
    }
}

pub struct Decoder(encoding_rs::Decoder);

impl Decoder {
    pub fn decode(&mut self, mut bytes: &[u8], is_last: bool) -> String {
        let mut text = String::new();
        loop {
            text.reserve(bytes.len() + 16);
            let (result, read, _) = self.0.decode_to_string(bytes, &mut text, is_last);
            bytes = &bytes[read..];
            if result == CoderResult::InputEmpty {
                return text;
            }
        }
    }
}

#[derive(Default)]
enum Within {
    #[default]
    Text,
    /// It ends with that.
    Comment(&'static [u8]),
    Tag {
        name: Range<usize>,
        is_end: bool,
        found: [Option<Range<usize>>; 3],
    },
    /// Of an element with that name.
    RawText(Range<usize>),
}

/// Looks for a `<meta>` that has an encoding, in what is still arriving.
#[derive(Default)]
pub struct MetaScan {
    at: usize,
    within: Within,
    has_left_head: bool,
    result: Option<Option<Encoding>>,
}

impl MetaScan {
    /// Whatever follows does not change what [`Encoding::declared_in_html`] says. `bytes` start with those of the last time.
    pub fn is_settled_by(&mut self, bytes: &[u8]) -> bool {
        self.resume(bytes).is_some()
    }

    /// `None` if there can be one in what follows.
    fn resume(&mut self, bytes: &[u8]) -> Option<Option<Encoding>> {
        while self.result.is_none() {
            self.step(bytes)?;
        }
        self.result
    }

    fn step(&mut self, bytes: &[u8]) -> Option<()> {
        let rest = &bytes[self.at..];
        let range_of = |part: &[u8]| {
            let start = part.as_ptr().addr() - bytes.as_ptr().addr();
            start..start + part.len()
        };
        match &mut self.within {
            Within::Text => {
                let (text, rest) = split_at_any(rest, b"<");
                self.at += text.len();
                if self.has_left_head && self.at >= PRESCAN_LEN {
                    self.result = Some(None);
                    return Some(());
                }
                let is_end = rest.starts_with(b"</");
                let tag = rest.get(1 + usize::from(is_end)..)?;
                if tag.first()?.is_ascii_alphabetic() {
                    let (name, rest) = split_at_any(tag, b"\t\n\x0c\r />");
                    rest.first()?;
                    self.at = bytes.len() - rest.len();
                    self.within = Within::Tag {
                        name: range_of(name),
                        is_end,
                        found: Default::default(),
                    };
                    return Some(());
                }
                match rest {
                    [_, b'!'] | [_, b'!', b'-'] => return None,
                    [_, b'!', b'-', b'-', ..] => self.within = Within::Comment(b"-->"),
                    [_, b'!' | b'/' | b'?', ..] => self.within = Within::Comment(b">"),
                    _ => {}
                }
                self.at += if matches!(self.within, Within::Text) {
                    1
                } else {
                    2
                };
            }
            Within::Comment(end) => {
                let Some(index) = strings::index_of(rest, end) else {
                    self.at += rest.len().saturating_sub(end.len() - 1);
                    return None;
                };
                self.at += index + end.len();
                self.within = Within::Text;
            }
            Within::RawText(name) => match index_of_end_tag(rest, &bytes[name.clone()]) {
                Ok(index) => (self.at, self.within) = (self.at + index, Within::Text),
                Err(index) => {
                    self.at += index;
                    return None;
                }
            },
            Within::Tag { found, .. }
                if let Some([attribute, value, after]) = next_attribute(rest) =>
            {
                // What follows the spaces may be a value.
                skip_whitespace(after).first()?;
                self.at = bytes.len() - after.len();
                for (known, slot) in ["charset", "http-equiv", "content"].iter().zip(found) {
                    if is_one_of(attribute, &[known]) {
                        slot.get_or_insert_with(|| range_of(value));
                    }
                }
            }
            Within::Tag {
                name: range,
                is_end,
                found,
            } => {
                self.at += strings::index_of_char_usize(rest, b'>')?;
                let name = &bytes[range.clone()];
                let is_in_head = is_one_of(
                    name,
                    &[
                        "base", "link", "meta", "noscript", "object", "script", "style", "title",
                    ],
                ) || !*is_end && is_one_of(name, &["html", "head"]);
                self.has_left_head |= !is_in_head;
                let is_start_of = |names| !*is_end && is_one_of(name, names);
                if is_start_of(&["meta"]) {
                    self.result = of_meta(found.clone().map(|it| Some(&bytes[it?]))).map(Some);
                } else if is_start_of(&["plaintext"]) {
                    self.result = Some(None);
                }
                self.within = match is_start_of(&[
                    "iframe", "noembed", "noframes", "script", "style", "textarea", "title", "xmp",
                ]) {
                    true => Within::RawText(range.clone()),
                    false => Within::Text,
                };
            }
        }
        Some(())
    }
}

fn of_meta([charset, http_equiv, content]: [Option<&[u8]>; 3]) -> Option<Encoding> {
    let is_pragma = http_equiv.is_some_and(|it| is_one_of(it, &["content-type"]));
    let label = charset.or_else(|| charset_in_content(content.filter(|_| is_pragma)?))?;
    let encoding = Encoding::for_label(&with_numeric_references(label))?.as_declared();
    Some(match encoding.0 == encoding_rs::X_USER_DEFINED {
        true => Encoding(encoding_rs::WINDOWS_1252),
        false => encoding,
    })
}

/// <https://html.spec.whatwg.org/#extracting-character-encodings-from-meta-elements>
fn charset_in_content(mut content: &[u8]) -> Option<&[u8]> {
    const CHARSET: &[u8] = b"charset";
    loop {
        let at = strings::index_of(&content.to_ascii_lowercase(), CHARSET)?;
        content = skip_whitespace(&content[at + CHARSET.len()..]);
        match content.strip_prefix(b"=").map(skip_whitespace) {
            None => {}
            Some([quote @ (b'"' | b'\''), quoted @ ..]) => {
                return Some(&quoted[..strings::index_of_char_usize(quoted, *quote)?]);
            }
            Some(value) => return Some(split_at_any(value, b"\t\n\x0c\r ;").0),
        }
    }
}

fn with_numeric_references(mut label: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(label.len());
    while let [first, after @ ..] = label {
        let (radix, digits) = match label {
            [b'&', b'#', b'x' | b'X', digits @ ..] => (16, digits),
            [b'&', b'#', digits @ ..] => (10, digits),
            _ => (10, &[][..]),
        };
        let values = digits
            .iter()
            .map_while(|it| char::from(*it).to_digit(radix));
        let (count, number) = values.fold((0, 0u32), |(count, number), digit| {
            (
                count + 1,
                number.saturating_mul(radix).saturating_add(digit),
            )
        });
        if count == 0 {
            out.push(*first);
            label = after;
        } else {
            out.push(u8::try_from(number).unwrap_or(0));
            let rest = &digits[count..];
            label = rest.strip_prefix(b";").unwrap_or(rest);
        }
    }
    out
}

pub fn new_multipart_boundary() -> Vec<u8> {
    format!("----WebKitFormBoundary{:016x}", crate::random()).into_bytes()
}

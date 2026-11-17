use super::{
    Cursor, Flags, Lenient, MessageParser, ParseError, State, Step, Stop, fail, is_blank,
    is_newline,
};
use crate::byte_sets::{LIST_ELEMENT, TOKEN};

/// What the next byte belongs to.
#[derive(Clone, Copy)]
pub(super) enum FieldPart {
    SectionStart,
    LineStart,
    Name,
    SpacesInName,
    BeforeValue,
    EmptyValueLf,
    AfterEmptyValue,
    ValueStart,
    Length,
    AfterLength,
    ElementStart,
    Word,
    AfterWord,
    OtherElement,
    Value,
    ValueLf,
    AfterValue,
    SectionLf,
}

/// How to read the value, or the next line of it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Field {
    Other,
    Connection,
    ContentLength,
    TransferEncoding,
    Upgrade,
}

impl Field {
    #[inline(always)]
    fn named(name: &[u8]) -> Self {
        if is_word(name, b"connection") || is_word(name, b"proxy-connection") {
            Self::Connection
        } else if is_word(name, b"content-length") {
            Self::ContentLength
        } else if is_word(name, b"transfer-encoding") {
            Self::TransferEncoding
        } else if is_word(name, b"upgrade") {
            Self::Upgrade
        } else {
            Self::Other
        }
    }
}

/// `eq_ignore_ascii_case` without a loop. `word` has lowercase letters and hyphens.
#[inline(always)]
fn is_word<const N: usize>(bytes: &[u8], word: &[u8; N]) -> bool {
    let difference = |(&byte, &expected): (&u8, &u8)| {
        (byte | if expected == b'-' { 0 } else { 0x20 }) ^ expected
    };
    bytes.len() == N && bytes.iter().zip(word).map(difference).fold(0, |a, b| a | b) == 0
}

impl MessageParser {
    #[inline(never)]
    pub(super) fn parse_fields(&mut self, input: &[u8], mut part: FieldPart) -> Step<()> {
        use FieldPart::*;

        let mut cursor = Cursor::new(input, self.consumed);
        let mut step = self.parse_field_parts(&mut cursor, &mut part);
        if let Err(Stop::Short) = step {
            step = match part {
                Name | SpacesInName => self.keep_name(&mut cursor, 0),
                Length | AfterLength | ElementStart | Word | AfterWord | OtherElement | Value => {
                    self.keep_value(&mut cursor, 0)
                }
                _ => Ok(()),
            }
            .and(step);
        }
        self.consumed = cursor.pos;
        self.state = match step {
            Err(Stop::FieldsFull) => State::AfterFieldsFull,
            _ => State::Fields(part),
        };
        step
    }

    #[inline(always)]
    fn parse_field_parts(&mut self, cursor: &mut Cursor<'_>, part: &mut FieldPart) -> Step<()> {
        use FieldPart::*;

        run_parts!(match *part {
            SectionStart => {
                if cursor.peek()? == b' ' {
                    cursor.bump();
                    self.tolerate(Lenient::HEADERS, ParseError::SpaceAfterStartLine)?;
                }
                LineStart
            }
            LineStart => match cursor.peek()? {
                b'\r' => {
                    cursor.bump();
                    SectionLf
                }
                b'\n' => return self.skip_lone_lf(cursor, ParseError::WhitespaceInName),
                b':' => return fail(ParseError::NameByte),
                _ => {
                    cursor.set_mark();
                    Name
                }
            },
            Name => match cursor.skip(&TOKEN)? {
                b':' => {
                    self.field = self.field_named_so_far(cursor);
                    self.keep_name(cursor, 1)?;
                    self.check_name()?;
                    BeforeValue
                }
                b' ' => {
                    self.field = self.field_named_so_far(cursor);
                    if self.field == Field::Other {
                        return fail(ParseError::NameByte);
                    }
                    if !self.allows(Lenient::HEADERS) {
                        self.keep_name(cursor, 1)?;
                        return fail(ParseError::WhitespaceInName);
                    }
                    SpacesInName
                }
                _ => return fail(ParseError::NameByte),
            },
            SpacesInName => match cursor.skip_while(|byte| byte == b' ')? {
                b':' => {
                    self.keep_name(cursor, 1)?;
                    self.check_name()?;
                    BeforeValue
                }
                _ => Name,
            },
            BeforeValue => match cursor.skip_while(is_blank)? {
                b'\r' => {
                    cursor.bump();
                    EmptyValueLf
                }
                b'\n' => {
                    self.skip_lone_lf(cursor, ParseError::ValueByte)?;
                    AfterEmptyValue
                }
                _ => ValueStart,
            },
            EmptyValueLf => {
                self.expect_lf(cursor, Lenient::HEADERS, ParseError::NoLfAfterCr)?;
                AfterEmptyValue
            }
            AfterEmptyValue => {
                if is_blank(cursor.peek()?) {
                    cursor.bump();
                    self.tolerate(Lenient::HEADERS, ParseError::ValueByte)?;
                    BeforeValue
                } else {
                    match self.field {
                        Field::ContentLength => return fail(ParseError::EmptyContentLength),
                        Field::TransferEncoding => {
                            return fail(ParseError::EmptyTransferEncoding);
                        }
                        _ => self.texts.push(Default::default()),
                    };
                    LineStart
                }
            }
            ValueStart => {
                cursor.set_mark();
                match self.field {
                    Field::Other => Value,
                    Field::Connection => {
                        self.lists_codings = false;
                        ElementStart
                    }
                    Field::ContentLength => {
                        if self.flags.contains(Flags::CONTENT_LENGTH) {
                            return fail(ParseError::DuplicateContentLength);
                        }
                        Length
                    }
                    Field::TransferEncoding => {
                        if self.flags.contains(Flags::CHUNKED) {
                            self.check_coding_after_chunked(cursor)?;
                        }
                        self.flags |= Flags::TRANSFER_ENCODING;
                        self.flags -= Flags::CHUNKED;
                        self.field = Field::Other;
                        self.lists_codings = true;
                        ElementStart
                    }
                    Field::Upgrade => {
                        self.flags |= Flags::UPGRADE;
                        Value
                    }
                }
            }
            Length => loop {
                let byte = cursor.peek()?;
                if !byte.is_ascii_digit() {
                    break AfterLength;
                }
                cursor.bump();
                let length = self.remaining.checked_mul(10);
                match length.and_then(|length| length.checked_add(u64::from(byte - b'0'))) {
                    Some(length) => self.remaining = length,
                    None => {
                        let error = ParseError::ContentLengthOverflow;
                        return self.fail_in_value(cursor, 0, error);
                    }
                }
            },
            AfterLength => {
                if !is_newline(cursor.skip_while(is_blank)?) {
                    return self.fail_in_value(cursor, 0, ParseError::ContentLengthByte);
                }
                self.flags |= Flags::CONTENT_LENGTH;
                Value
            }
            ElementStart => {
                let initial = cursor.skip_while(is_blank)?.to_ascii_lowercase();
                match (self.lists_codings, initial) {
                    (false, b'k') => {
                        self.begin_word(cursor, b"keep-alive", Flags::CONNECTION_KEEP_ALIVE);
                        Word
                    }
                    (false, b'c') => {
                        self.begin_word(cursor, b"close", Flags::CONNECTION_CLOSE);
                        Word
                    }
                    (false, b'u') => {
                        self.begin_word(cursor, b"upgrade", Flags::CONNECTION_UPGRADE);
                        Word
                    }
                    (true, b'c') => {
                        self.begin_word(cursor, b"chunked", Flags::CHUNKED);
                        Word
                    }
                    _ => OtherElement,
                }
            }
            Word => {
                if self.match_word(cursor, |byte| byte.to_ascii_lowercase())? {
                    self.field = Field::Other;
                    AfterWord
                } else {
                    self.flag_of_word = Flags::empty();
                    OtherElement
                }
            }
            AfterWord => match cursor.skip_while(is_blank)? {
                b'\r' | b'\n' => Value,
                b',' => {
                    if self.lists_codings {
                        self.check_coding_after_chunked(cursor)?;
                        self.flag_of_word = Flags::empty();
                    } else {
                        self.apply_word();
                        self.field = Field::Connection;
                    }
                    cursor.bump();
                    ElementStart
                }
                _ => {
                    self.flag_of_word = Flags::empty();
                    OtherElement
                }
            },
            OtherElement => match cursor.skip(&LIST_ELEMENT)? {
                b',' => {
                    cursor.bump();
                    ElementStart
                }
                _ => Value,
            },
            Value => match cursor.skip(self.value_bytes)? {
                b'\r' => {
                    self.keep_value(cursor, 1)?;
                    ValueLf
                }
                b'\n' => {
                    self.keep_value(cursor, 0)?;
                    let error = ParseError::NoCrAfterValue;
                    self.tolerate(Lenient::OPTIONAL_CR_BEFORE_LF, error)?;
                    ValueLf
                }
                _ => return self.fail_in_value(cursor, 0, ParseError::ValueByte),
            },
            ValueLf => {
                if cursor.peek()? != b'\n' {
                    return fail(ParseError::NoLfAfterValue);
                }
                cursor.bump();
                AfterValue
            }
            AfterValue => {
                if is_blank(cursor.peek()?) {
                    self.tolerate(Lenient::HEADERS, ParseError::FoldedValue)?;
                    self.flag_of_word -= Flags::CHUNKED;
                    self.texts.save(cursor.input);
                    ValueStart
                } else {
                    self.apply_word();
                    LineStart
                }
            }
            SectionLf => {
                let error = ParseError::NoLfAfterFields;
                return self.expect_lf(cursor, Lenient::OPTIONAL_LF_AFTER_CR, error);
            }
        })
    }

    /// Adds what is marked to the name, then skips the `skipped` bytes that end it. After an event, the name is parsed again.
    #[inline(always)]
    fn keep_name(&mut self, cursor: &mut Cursor<'_>, skipped: usize) -> Step<()> {
        if self.texts.last_is_name() {
            let marked = self.take_marked(cursor, skipped)?;
            self.texts.extend(cursor.input, marked);
            return Ok(());
        }
        if self.has_room(cursor) {
            match self.fields_left {
                None => {
                    self.fields_left = Some(u64::MAX);
                    cursor.pos = cursor.mark;
                    return Err(Stop::FieldLimitNeeded);
                }
                Some(0) => {
                    cursor.pos += skipped;
                    return fail(ParseError::SectionTooLong);
                }
                Some(fields_left) => {
                    if !self.texts.push(cursor.marked()) {
                        cursor.pos = cursor.mark;
                        return Err(Stop::FieldsFull);
                    }
                    self.fields_left = Some(fields_left - 1);
                }
            }
        }
        self.take_marked(cursor, skipped).map(drop)
    }

    /// As [`keep_name`](Self::keep_name).
    #[inline(always)]
    fn keep_value(&mut self, cursor: &mut Cursor<'_>, skipped: usize) -> Step<()> {
        let marked = self.take_marked(cursor, skipped)?;
        if self.texts.last_is_name() {
            self.texts.push(marked);
        } else {
            self.texts.extend(cursor.input, marked);
        }
        Ok(())
    }

    #[inline(always)]
    fn field_named_so_far(&self, cursor: &Cursor<'_>) -> Field {
        if self.texts.last_is_name() {
            return self.field_named_in_two_parts(*cursor);
        }
        Field::named(cursor.marked_bytes())
    }

    #[inline(never)]
    fn field_named_in_two_parts(&self, cursor: Cursor<'_>) -> Field {
        Field::named(&[self.texts.last(cursor.input), cursor.marked_bytes()].concat())
    }

    #[inline(always)]
    fn check_name(&self) -> Step<()> {
        let (other, error) = match self.field {
            Field::ContentLength => (
                Flags::TRANSFER_ENCODING,
                ParseError::ContentLengthAfterTransferEncoding,
            ),
            Field::TransferEncoding => (
                Flags::CONTENT_LENGTH,
                ParseError::TransferEncodingAfterContentLength,
            ),
            _ => return Ok(()),
        };
        if self.flags.contains(other) {
            self.tolerate(Lenient::CHUNKED_LENGTH, error)?;
        }
        Ok(())
    }

    #[inline(always)]
    fn begin_word<const N: usize>(
        &mut self,
        cursor: &mut Cursor<'_>,
        word: &'static [u8; N],
        flag: Flags,
    ) {
        self.flag_of_word = flag;
        self.word = match cursor.rest().first_chunk::<N>() {
            Some(bytes) if is_word(bytes, word) => {
                cursor.pos += N;
                &[]
            }
            _ => word,
        };
    }

    #[inline(always)]
    fn apply_word(&mut self) {
        self.flags |= core::mem::replace(&mut self.flag_of_word, Flags::empty());
    }

    /// RFC 9112 §6.1
    #[inline(always)]
    fn check_coding_after_chunked(&mut self, cursor: &mut Cursor<'_>) -> Step<()> {
        if self.is_request() && !self.allows(Lenient::TRANSFER_ENCODING) {
            return self.fail_in_value(cursor, 1, ParseError::CodingAfterChunked);
        }
        Ok(())
    }

    /// A value that is too long is reported as that.
    #[inline(always)]
    fn fail_in_value<T>(
        &mut self,
        cursor: &mut Cursor<'_>,
        skipped: usize,
        error: ParseError,
    ) -> Step<T> {
        self.take_marked(cursor, skipped)?;
        fail(error)
    }
}

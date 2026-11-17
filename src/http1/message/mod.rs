//! The parser of `node:http`. Its grammar and its errors derive from llhttp (LICENSE.md).

/// `loop { *part = match *part { .. } }`, but the step to a later arm compiles to a direct jump.
macro_rules! run_parts {
    (match *$part:ident { $($arms:tt)* }) => {
        run_parts!(@parse $part [] $($arms)*)
    };
    (@parse $part:ident [$($parsed:tt)*] $pattern:pat => $next:expr, $($arms:tt)*) => {
        run_parts!(@parse $part [$($parsed)* ($pattern, $next)] $($arms)*)
    };
    (@parse $part:ident [$($parsed:tt)*] $pattern:pat => $next:block $($arms:tt)*) => {
        run_parts!(@parse $part [$($parsed)* ($pattern, $next)] $($arms)*)
    };
    (@parse $part:ident [$(($pattern:pat, $next:expr))*]) => {{
        let ($($pattern)|*) = *$part;
        loop {
            $(*$part = match *$part {
                $pattern => $next,
                other => other,
            };)*
        }
    }};
}

mod chunks;
mod error;
mod fields;
mod method;
mod start_line;
mod texts;

use core::range::Range;

use bun_core::strings::ByteSet;

use crate::byte_sets::{CONTENT, LINE, RELAXED_CONTENT};
use chunks::{ChunkPart, MAX_EXTENSIONS_LEN};
use fields::{Field, FieldPart};
use start_line::StartLinePart;
use texts::Texts;

pub use error::ParseError;
pub use method::{is_http1_method, method_names};

bitflags::bitflags! {
    /// What to accept in spite of RFC 9112.
    #[derive(Clone, Copy)]
    pub struct Lenient: u32 {
        const HEADERS = 1 << 0;
        const CHUNKED_LENGTH = 1 << 1;
        const KEEP_ALIVE = 1 << 2;
        const TRANSFER_ENCODING = 1 << 3;
        const VERSION = 1 << 4;
        const DATA_AFTER_CLOSE = 1 << 5;
        const OPTIONAL_LF_AFTER_CR = 1 << 6;
        const OPTIONAL_CRLF_AFTER_CHUNK = 1 << 7;
        const OPTIONAL_CR_BEFORE_LF = 1 << 8;
        const SPACES_AFTER_CHUNK_SIZE = 1 << 9;
        const HEADER_VALUE_RELAXED = 1 << 10;
    }
}

bitflags::bitflags! {
    /// What is known of the current message.
    #[derive(Clone, Copy)]
    struct Flags: u16 {
        const CONNECTION_KEEP_ALIVE = 1 << 0;
        const CONNECTION_CLOSE = 1 << 1;
        const CONNECTION_UPGRADE = 1 << 2;
        const UPGRADE = 1 << 3;
        const CONTENT_LENGTH = 1 << 4;
        const TRANSFER_ENCODING = 1 << 5;
        const CHUNKED = 1 << 6;
        const IN_TRAILERS = 1 << 7;
        const SKIP_BODY = 1 << 8;
        /// Lasts until the next head is complete.
        const SWITCHES_PROTOCOL = 1 << 9;
        const IS_LAST = 1 << 10;
        const MALFORMED_STATUS_TEXT = 1 << 11;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageKind {
    Request,
    Response,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    MessageBegin,
    /// A section of a request has a field. There is no limit without [`MessageParser::set_max_fields`].
    FieldLimitNeeded,
    /// The next call drops the fields so far to make room for more.
    FieldsFull,
    HeadComplete,
    Body(Range<usize>),
    /// The read is over. It is a part of the body after so many bytes.
    DoneInBody(usize),
    MessageComplete,
    /// The read is over, after so many bytes. Any others belong to another protocol.
    Done(usize),
    /// The read is over, after so many bytes.
    Failed(ParseError, usize),
}

/// What the end of the connection means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eof {
    Ignored,
    CompletesMessage,
    CutsMessageShort,
}

#[derive(Clone, Copy)]
#[repr(u8)]
enum State {
    Start,
    StartLine(StartLinePart),
    Fields(FieldPart),
    AfterFieldsFull,
    AfterHead,
    /// A body with a length, or the data of a chunk.
    SizedBody,
    BodyUntilEof,
    Chunks(ChunkPart),
    MessageDone,
    AfterMessage,
    Closed,
}

/// Why a step is not complete.
enum Stop {
    Short,
    Failed(ParseError),
    FieldLimitNeeded,
    FieldsFull,
}

type Step<T> = Result<T, Stop>;

#[derive(Clone, Copy)]
struct Cursor<'a> {
    input: &'a [u8],
    pos: usize,
    /// Where the text that `pos` is in starts, as far as it is in this read.
    mark: usize,
}

impl<'a> Cursor<'a> {
    #[inline(always)]
    fn new(input: &'a [u8], pos: usize) -> Self {
        Self {
            input,
            pos,
            mark: pos,
        }
    }

    #[inline(always)]
    fn peek(&self) -> Step<u8> {
        self.input.get(self.pos).copied().ok_or(Stop::Short)
    }

    #[inline(always)]
    fn bump(&mut self) {
        self.pos += 1;
    }

    #[inline(always)]
    fn rest(&self) -> &'a [u8] {
        self.input.get(self.pos..).unwrap_or_default()
    }

    /// Returns the byte after the run.
    #[inline(always)]
    fn skip(&mut self, set: &ByteSet) -> Step<u8> {
        self.peek()?;
        self.pos += set.prefix_len(self.rest());
        self.peek()
    }

    /// As [`skip`](Self::skip), for a run that is too short for a vector.
    #[inline(always)]
    fn skip_while(&mut self, is_member: impl Fn(u8) -> bool) -> Step<u8> {
        loop {
            let byte = self.peek()?;
            if !is_member(byte) {
                return Ok(byte);
            }
            self.bump();
        }
    }

    /// With the next byte consumed.
    #[inline(always)]
    fn fail_after<T>(&mut self, error: ParseError) -> Step<T> {
        self.bump();
        fail(error)
    }

    #[inline(always)]
    fn set_mark(&mut self) {
        self.mark = self.pos;
    }

    #[inline(always)]
    fn marked(&self) -> Range<usize> {
        (self.mark..self.pos).into()
    }

    #[inline(always)]
    fn marked_len(&self) -> u64 {
        (self.pos - self.mark) as u64
    }

    #[inline(always)]
    fn marked_bytes(&self) -> &'a [u8] {
        self.input.get(self.marked()).unwrap_or_default()
    }
}

/// Parses the requests or the responses of a connection, read by read.
pub struct MessageParser {
    kind: MessageKind,
    lenient: Lenient,
    /// What the value of a field is made of.
    value_bytes: &'static ByteSet,
    max_section_len: u64,

    state: State,
    error: Option<ParseError>,
    /// How much of the current read is parsed.
    consumed: usize,

    method: u8,
    major_version: u8,
    minor_version: u8,
    status_code: u16,
    flags: Flags,
    /// What is left of the body or of the chunk.
    remaining: u64,

    /// What is left to match of a word, or what has matched of a method.
    word: &'static [u8],
    protocol_initial: u8,
    field: Field,
    /// Whether the list has transfer codings or connection options.
    lists_codings: bool,
    /// What the element of a list means, if nothing is added to it.
    flag_of_word: Flags,
    texts: Texts,

    /// What is left of `max_section_len`.
    section_room: u64,
    extensions_len: u64,
    /// Where the last head, piece of a body or message ends, from the start of the current read.
    delivered: i64,
    fields_left: Option<u64>,
}

impl MessageParser {
    /// The texts of a head, or of a trailer section, are shorter than `max_section_len` together.
    #[inline]
    pub fn new(kind: MessageKind, lenient: Lenient, max_section_len: u64) -> Self {
        Self {
            kind,
            lenient,
            value_bytes: if lenient.contains(Lenient::HEADERS) {
                &LINE
            } else if lenient.contains(Lenient::HEADER_VALUE_RELAXED) {
                &RELAXED_CONTENT
            } else {
                &CONTENT
            },
            max_section_len,
            state: State::Start,
            error: None,
            consumed: 0,
            method: 0,
            major_version: 0,
            minor_version: 0,
            status_code: 0,
            flags: Flags::empty(),
            remaining: 0,
            word: &[],
            protocol_initial: 0,
            field: Field::Other,
            lists_codings: false,
            flag_of_word: Flags::empty(),
            texts: Texts::default(),
            section_room: 0,
            extensions_len: 0,
            delivered: 0,
            fields_left: None,
        }
    }

    /// Call it with the same `input` until the read is over. No read starts while there is an [`error`](Self::error).
    #[inline(always)]
    pub fn advance(&mut self, input: &[u8]) -> Event {
        match self.next_event(input) {
            Ok(event) => event,
            Err(Stop::Short) => self.complete_read(input),
            Err(Stop::Failed(error)) => Event::Failed(error, self.abort(input, error)),
            Err(Stop::FieldLimitNeeded) => Event::FieldLimitNeeded,
            Err(Stop::FieldsFull) => Event::FieldsFull,
        }
    }

    #[inline(always)]
    fn next_event(&mut self, input: &[u8]) -> Step<Event> {
        loop {
            self.state = match self.state {
                State::Start => {
                    self.skip_newlines(input)?;
                    return Ok(self.begin_message());
                }
                State::StartLine(part) => {
                    self.parse_start_line(input, part)?;
                    State::Fields(FieldPart::SectionStart)
                }
                State::Fields(part) => {
                    self.parse_fields(input, part)?;
                    if !self.flags.contains(Flags::IN_TRAILERS) {
                        return Ok(self.complete_head());
                    }
                    State::MessageDone
                }
                State::AfterFieldsFull => {
                    self.texts.clear_fields();
                    State::Fields(FieldPart::LineStart)
                }
                State::AfterHead => self.begin_body()?,
                State::SizedBody | State::BodyUntilEof => return self.take_body(input),
                State::Chunks(part) => {
                    self.parse_chunk_head(input, part)?;
                    if self.remaining > 0 {
                        self.state = State::SizedBody;
                        return self.take_body(input);
                    }
                    self.flags |= Flags::IN_TRAILERS;
                    self.section_room = self.max_section_len;
                    State::Fields(FieldPart::LineStart)
                }
                State::MessageDone => {
                    self.state = State::AfterMessage;
                    return Ok(self.deliver(Event::MessageComplete));
                }
                State::AfterMessage => self.end_message()?,
                State::Closed => return self.skip_after_close(input),
            };
        }
    }

    #[inline(always)]
    fn deliver(&mut self, event: Event) -> Event {
        self.delivered = self.consumed as i64;
        event
    }

    /// What can be read between two deliveries leaves room for the delimiters of the longest section and extensions.
    #[inline]
    fn complete_read(&mut self, input: &[u8]) -> Event {
        let undelivered_len = (self.consumed as i64 - self.delivered) as u64;
        let error = match self.state {
            _ if undelivered_len / 8 < self.max_section_len.saturating_add(MAX_EXTENSIONS_LEN) => {
                return Event::Done(self.end_read(input));
            }
            State::Closed => return Event::Done(self.end_read(input)),
            State::Chunks(_) | State::SizedBody => ParseError::ExtensionsTooLong,
            _ => ParseError::SectionTooLong,
        };
        Event::Failed(error, self.abort(input, error))
    }

    /// Ends the read with `error`. Returns how much of it was consumed.
    pub fn abort(&mut self, input: &[u8], error: ParseError) -> usize {
        self.error = Some(error);
        self.end_read(input)
    }

    #[inline]
    fn end_read(&mut self, input: &[u8]) -> usize {
        self.texts.save(input);
        self.delivered -= self.consumed as i64;
        core::mem::take(&mut self.consumed)
    }

    pub fn error(&self) -> Option<ParseError> {
        self.error
    }

    /// Takes effect with the next read, unless this one ends with a switch of protocols.
    pub fn pause(&mut self) {
        self.error.get_or_insert(ParseError::Paused);
    }

    pub fn resume(&mut self) {
        self.error
            .take_if(|error| matches!(error, ParseError::Paused | ParseError::PausedAfterHead));
    }

    /// The connection has ended.
    pub fn finish(&mut self) -> Eof {
        match self.state {
            _ if self.error.is_some() => Eof::Ignored,
            State::Start | State::Closed => Eof::Ignored,
            State::BodyUntilEof => {
                self.state = State::Closed;
                Eof::CompletesMessage
            }
            _ => Eof::CutsMessageShort,
        }
    }

    pub fn kind(&self) -> MessageKind {
        self.kind
    }

    /// A position in [`method_names`].
    pub fn method(&self) -> u8 {
        self.method
    }

    pub fn version(&self) -> (u8, u8) {
        (self.major_version, self.minor_version)
    }

    pub fn status_code(&self) -> u16 {
        self.status_code
    }

    /// The URL, or until the body the status text if it is well-formed.
    pub fn start_line_text<'a>(&'a self, input: &'a [u8]) -> &'a [u8] {
        if self.flags.contains(Flags::MALFORMED_STATUS_TEXT) {
            return &[];
        }
        self.texts.first(input)
    }

    pub fn clear_url(&mut self) {
        if self.is_request() {
            self.texts.clear_first();
        }
    }

    /// Names and values.
    #[inline]
    pub fn fields<'a>(
        &'a self,
        input: &'a [u8],
    ) -> impl ExactSizeIterator<Item = (&'a [u8], &'a [u8])> {
        self.texts.fields(input).map(|(name, mut value)| {
            while let [rest @ .., b' ' | b'\t'] = value {
                value = rest;
            }
            (name, value)
        })
    }

    /// Drops the fields of the head, so that those of the trailer section are counted apart.
    pub fn clear_fields(&mut self) {
        self.texts.clear_fields();
        self.forget_field_limit();
    }

    fn forget_field_limit(&mut self) {
        self.fields_left = (!self.is_request()).then_some(u64::MAX);
    }

    /// After [`Event::FieldLimitNeeded`].
    pub fn set_max_fields(&mut self, max_fields: u64) {
        self.fields_left = Some(max_fields);
    }

    /// Whether another protocol follows the message of the last complete head.
    pub fn is_upgrade(&self) -> bool {
        self.flags.contains(Flags::SWITCHES_PROTOCOL)
    }

    pub fn should_keep_alive(&self) -> bool {
        self.is_persistent() && self.can_be_followed()
    }

    /// RFC 9112 §9.3
    #[inline]
    fn is_persistent(&self) -> bool {
        !self.flags.contains(Flags::CONNECTION_CLOSE)
            && (self.is_http_1_1() || self.flags.contains(Flags::CONNECTION_KEEP_ALIVE))
    }

    fn is_http_1_1(&self) -> bool {
        self.major_version > 0 && self.minor_version > 0
    }

    /// RFC 9110 §8.6 and RFC 9112 §6.1
    #[inline]
    fn can_be_followed(&self) -> bool {
        let has_codings = self.flags.contains(Flags::TRANSFER_ENCODING);
        !self.ends_with_connection()
            && match self.status_code {
                101 => false,
                100..=199 => true,
                204 => !has_codings && self.remaining == 0,
                _ => !has_codings || self.is_http_1_1(),
            }
    }

    /// After [`Event::HeadComplete`]: the message has no body, whatever its head says.
    pub fn skip_body(&mut self) {
        self.flags |= Flags::SKIP_BODY;
    }

    /// After [`Event::HeadComplete`]: another protocol follows the head.
    pub fn switch_protocol(&mut self) {
        self.flags |= Flags::SKIP_BODY | Flags::SWITCHES_PROTOCOL;
    }

    #[inline(always)]
    fn skip_newlines(&mut self, input: &[u8]) -> Step<u8> {
        let mut cursor = Cursor::new(input, self.consumed);
        let step = cursor.skip_while(is_newline);
        self.consumed = cursor.pos;
        step
    }

    #[inline(always)]
    fn begin_message(&mut self) -> Event {
        self.section_room = self.max_section_len;
        self.forget_field_limit();
        self.state = State::StartLine(match self.kind {
            MessageKind::Request => StartLinePart::MethodStart,
            MessageKind::Response => StartLinePart::BeforeProtocol,
        });
        Event::MessageBegin
    }

    #[inline(always)]
    fn complete_head(&mut self) -> Event {
        let switches_protocol = if self
            .flags
            .contains(Flags::UPGRADE | Flags::CONNECTION_UPGRADE)
        {
            self.is_request() || self.status_code == 101
        } else {
            self.method == method::CONNECT
        };
        self.flags.set(Flags::SWITCHES_PROTOCOL, switches_protocol);
        self.state = State::AfterHead;
        self.deliver(Event::HeadComplete)
    }

    /// RFC 9112 §6.3
    #[inline(always)]
    fn begin_body(&mut self) -> Step<State> {
        let is_persistent = self.is_persistent() || self.allows(Lenient::KEEP_ALIVE);
        self.flags
            .set(Flags::IS_LAST, !(is_persistent && self.can_be_followed()));

        let is_chunked = self.flags.contains(Flags::CHUNKED);
        let has_length = is_chunked || self.remaining > 0;
        if self.is_bodiless()
            || (self.is_upgrade() && (self.method == method::CONNECT || !has_length))
        {
            return Ok(State::MessageDone);
        }
        if !self.is_request() {
            self.texts.clear_first();
        }
        if is_chunked {
            return Ok(State::Chunks(ChunkPart::SizeStart));
        }
        if !self.ends_with_connection() {
            return Ok(match has_length {
                true => State::SizedBody,
                false => State::MessageDone,
            });
        }
        if self.is_request() && !self.allows(Lenient::CHUNKED_LENGTH) {
            self.tolerate(Lenient::TRANSFER_ENCODING, ParseError::RequestNotChunked)?;
        }
        self.remaining = u64::MAX;
        Ok(State::BodyUntilEof)
    }

    fn is_bodiless(&self) -> bool {
        self.flags.contains(Flags::SKIP_BODY) || matches!(self.status_code, 100..=199 | 204 | 304)
    }

    fn ends_with_connection(&self) -> bool {
        !self.is_bodiless()
            && !self.flags.contains(Flags::CHUNKED)
            && (self.flags.contains(Flags::TRANSFER_ENCODING)
                || !(self.is_request() || self.flags.contains(Flags::CONTENT_LENGTH)))
    }

    #[inline(always)]
    fn take_body(&mut self, input: &[u8]) -> Step<Event> {
        let start = self.consumed;
        if start >= input.len() {
            return Err(Stop::Short);
        }
        let len = self.remaining.min((input.len() - start) as u64);
        self.consumed += len as usize;
        self.remaining -= len;
        let event = self.deliver(Event::Body((start..self.consumed).into()));
        if self.remaining > 0 {
            self.end_read(input);
            return Ok(Event::DoneInBody(start));
        }
        self.state = match self.flags.contains(Flags::CHUNKED) {
            true => State::Chunks(ChunkPart::DataCr),
            false => State::MessageDone,
        };
        Ok(event)
    }

    #[inline(always)]
    fn end_message(&mut self) -> Step<State> {
        let switches_protocol = self.is_upgrade() || self.status_code == 101;
        let next = match self.flags.contains(Flags::IS_LAST) {
            true => State::Closed,
            false => State::Start,
        };
        self.flags &= Flags::SWITCHES_PROTOCOL;
        self.remaining = 0;
        self.texts.clear();
        if switches_protocol {
            self.resume();
            self.state = next;
            // The rest of the input is not HTTP.
            return Err(Stop::Short);
        }
        Ok(next)
    }

    #[inline(always)]
    fn skip_after_close(&mut self, input: &[u8]) -> Step<Event> {
        if self.allows(Lenient::DATA_AFTER_CLOSE) {
            self.consumed = input.len();
        }
        self.skip_newlines(input)?;
        self.consumed += 1;
        fail(ParseError::DataAfterClose)
    }

    fn is_request(&self) -> bool {
        self.kind == MessageKind::Request
    }

    fn allows(&self, leniency: Lenient) -> bool {
        self.lenient.contains(leniency)
    }

    /// Whether the rest of `word` is next. `fold` is applied to the input.
    #[inline(always)]
    fn match_word(&mut self, cursor: &mut Cursor<'_>, fold: impl Fn(u8) -> u8) -> Step<bool> {
        while let [expected, rest @ ..] = self.word {
            if fold(cursor.peek()?) != *expected {
                return Ok(false);
            }
            cursor.bump();
            self.word = rest;
        }
        Ok(true)
    }

    /// For the LF after a CR.
    #[inline(always)]
    fn expect_lf(
        &self,
        cursor: &mut Cursor<'_>,
        optional_with: Lenient,
        error: ParseError,
    ) -> Step<()> {
        if cursor.peek()? == b'\n' {
            cursor.bump();
            return Ok(());
        }
        self.tolerate(optional_with, error)
    }

    #[inline(always)]
    fn skip_lone_lf(&self, cursor: &mut Cursor<'_>, error: ParseError) -> Step<()> {
        cursor.bump();
        self.tolerate(Lenient::OPTIONAL_CR_BEFORE_LF, error)
    }

    #[inline(always)]
    fn tolerate(&self, leniency: Lenient, error: ParseError) -> Step<()> {
        if self.allows(leniency) {
            return Ok(());
        }
        fail(error)
    }

    /// Whether the section has room for what is marked.
    #[inline(always)]
    fn has_room(&self, cursor: &Cursor<'_>) -> bool {
        cursor.marked_len() < self.section_room
    }

    /// Counts what is marked as a part of the section, then skips the `skipped` bytes that end it.
    #[inline(always)]
    fn take_marked(&mut self, cursor: &mut Cursor<'_>, skipped: usize) -> Step<Range<usize>> {
        let (has_room, marked) = (self.has_room(cursor), cursor.marked());
        cursor.pos += skipped;
        if !has_room {
            return fail(ParseError::SectionTooLong);
        }
        self.section_room -= (marked.end - marked.start) as u64;
        Ok(marked)
    }
}

#[cold]
fn fail<T>(error: ParseError) -> Step<T> {
    Err(Stop::Failed(error))
}

fn is_newline(byte: u8) -> bool {
    matches!(byte, b'\r' | b'\n')
}

fn is_blank(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t')
}

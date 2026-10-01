#![deny(warnings)]
#![allow(dead_code)]
// Scratch model of syntax_errors.rs after B2: stand-ins of bun_ast::{Log, Msg, Metadata}, the table as specified.
use std::borrow::Cow;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Kind { Err, Warn }
#[derive(Clone, Debug)]
pub struct Location { pub offset: usize, pub length: usize }
#[derive(Clone, Debug)]
pub struct Data { pub text: Cow<'static, [u8]>, pub location: Option<Location> }
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Metadata { Build, Resolve(u8), Code(u32) }
#[derive(Debug)]
pub struct Msg { pub kind: Kind, pub data: Data, pub metadata: Metadata }
impl Msg {
    pub fn code(&self) -> Option<u32> { match self.metadata { Metadata::Code(c) => Some(c), _ => None } }
}
#[derive(Default)]
pub struct Log { pub msgs: Vec<Msg>, pub errors: u32 }
impl Log {
    fn add_static(&mut self, offset: usize, length: usize, text: &'static [u8]) {
        self.errors += 1;
        self.msgs.push(Msg { kind: Kind::Err, data: Data { text: Cow::Borrowed(text), location: Some(Location { offset, length }) }, metadata: Metadata::Build });
    }
    fn add_owned(&mut self, offset: usize, length: usize, text: &[u8]) {
        self.errors += 1;
        self.msgs.push(Msg { kind: Kind::Err, data: Data { text: Cow::Owned(text.to_vec()), location: Some(Location { offset, length }) }, metadata: Metadata::Build });
    }
    fn add_range_error_with_code(&mut self, offset: usize, length: usize, code: u32, text: Cow<'static, [u8]>) {
        self.errors += 1;
        self.msgs.push(Msg { kind: Kind::Err, data: Data { text, location: Some(Location { offset, length }) }, metadata: Metadata::Code(code) });
    }
}
fn hash(bytes: &[u8]) -> u64 { bytes.iter().fold(1469598103934665603u64, |h, b| (h ^ *b as u64).wrapping_mul(1099511628211)) }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Message { code: u32, text: &'static [u8] }
impl Message {
    const fn new(code: u32, text: &'static [u8]) -> Message { Message { code, text } }
    fn format(self, argument: &[u8]) -> Cow<'static, [u8]> {
        match self.text.windows(3).position(|w| w == b"{0}") {
            None => Cow::Borrowed(self.text),
            Some(at) => Cow::Owned([&self.text[..at], argument, &self.text[at + 3..]].concat()),
        }
    }
}
const UNTERMINATED_STRING_LITERAL: Message = Message::new(1002, b"Unterminated string literal.");
const IDENTIFIER_EXPECTED: Message = Message::new(1003, b"Identifier expected.");
const X_0_EXPECTED: Message = Message::new(1005, b"'{0}' expected.");
const EXPRESSION_EXPECTED: Message = Message::new(1109, b"Expression expected.");
const TYPE_EXPECTED: Message = Message::new(1110, b"Type expected.");
const FN_IN_UNION: Message = Message::new(1385, b"Function type notation must be parenthesized when used in a union type.");

/// The range and the text of the reference for one message. The number is on the message.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SyntaxError { pub msg: u32, pub start: u32, pub end: u32, pub text: Cow<'static, [u8]> }
impl SyntaxError {
    fn new(msg: usize, message: Message, argument: &[u8], start: usize, end: usize) -> Option<Self> {
        Some(SyntaxError { msg: u32::try_from(msg).ok()?, start: u32::try_from(start).ok()?, end: u32::try_from(end).ok()?, text: message.format(argument) })
    }
}

/// A record of a running parse and what tells its message: the code on it, its offset, a hash of its text.
struct Recorded { error: SyntaxError, code: u32, at: usize, said: u64 }
fn place_of(msg: &Msg) -> (usize, u64) {
    (msg.data.location.as_ref().map_or(usize::MAX, |location| location.offset), hash(&msg.data.text))
}
impl Recorded {
    fn is_of(&self, msg: &Msg) -> bool { msg.code() == Some(self.code) && place_of(msg) == (self.at, self.said) }
}

#[derive(Default)]
pub struct SyntaxErrors { list: Vec<SyntaxError>, recorded: Vec<Recorded>, first: usize }
impl SyntaxErrors {
    fn starting_at(first: usize) -> SyntaxErrors { SyntaxErrors { first, ..Default::default() } }
    pub fn entries(&self) -> &[SyntaxError] { &self.list }
    pub fn get(&self, msg: usize) -> Option<&SyntaxError> {
        let index = self.list.binary_search_by(|entry| (entry.msg as usize).cmp(&msg)).ok()?;
        self.list.get(index)
    }
    /// What `Parser::init_for_lint` left when it failed.
    pub fn of_failed_init(log: &Log, first: usize, source: &[u8]) -> SyntaxErrors {
        let mut errors = SyntaxErrors::starting_at(first);
        for (index, msg) in log.msgs.iter().enumerate().skip(first) {
            if let Some((_, entry)) = of_lexer_message(index, msg, source) { errors.list.push(entry); }
        }
        errors
    }
    fn record(&mut self, log: &mut Log, msgs_len: usize, message: Message, argument: &[u8], start: usize, end: usize) {
        let Some(index) = log.msgs.len().checked_sub(1) else { return };
        if index < msgs_len { return; }
        let Some(msg) = log.msgs.get_mut(index) else { return };
        if matches!(msg.metadata, Metadata::Resolve(_)) { return; }
        let Some(error) = SyntaxError::new(index, message, argument, start, end) else { return };
        msg.metadata = Metadata::Code(message.code);
        let (at, said) = place_of(msg);
        self.recorded.push(Recorded { error, code: message.code, at, said });
    }
    fn refine(&mut self, log: &mut Log, start: usize, from: Message, to: Message, argument: &[u8]) {
        let Some(last) = self.recorded.last_mut() else { return };
        let Some(msg) = log.msgs.get_mut(last.error.msg as usize) else { return };
        if last.code != from.code || last.error.start as usize != start || !last.is_of(msg) { return; }
        last.code = to.code;
        last.error.text = to.format(argument);
        msg.metadata = Metadata::Code(to.code);
    }
    fn finish(&mut self, log: &mut Log, source: &[u8]) {
        let first = self.first;
        let count = log.msgs.len().saturating_sub(first);
        let mut slots: Vec<Option<SyntaxError>> = Vec::new();
        slots.resize_with(count, || None);
        for record in core::mem::take(&mut self.recorded) {
            let index = record.error.msg as usize;
            if !log.msgs.get(index).is_some_and(|msg| record.is_of(msg)) { continue; }
            if let Some(slot) = index.checked_sub(first).and_then(|offset| slots.get_mut(offset)) { *slot = Some(record.error); }
        }
        self.list.clear();
        for (offset, slot) in slots.into_iter().enumerate() {
            let index = first + offset;
            if let Some(entry) = slot { self.list.push(entry); continue; }
            let Some(msg) = log.msgs.get_mut(index) else { continue };
            if let Some((code, entry)) = of_lexer_message(index, msg, source) {
                msg.metadata = Metadata::Code(code);
                self.list.push(entry);
            }
        }
    }
}
/// Stamps what `of_lexer_message` tells: `Parser::init_for_lint` where the priming token fails.
fn stamp_lexer_messages(log: &mut Log, first: usize, source: &[u8]) {
    for (index, msg) in log.msgs.iter_mut().enumerate().skip(first) {
        if let Some((code, _)) = of_lexer_message(index, msg, source) { msg.metadata = Metadata::Code(code); }
    }
}
fn of_lexer_message(index: usize, msg: &Msg, _source: &[u8]) -> Option<(u32, SyntaxError)> {
    if msg.kind != Kind::Err || matches!(msg.metadata, Metadata::Resolve(_)) { return None; }
    let location = msg.data.location.as_ref()?;
    let text: &[u8] = &msg.data.text;
    if text == b"Unterminated string literal" {
        let at = _source.len();
        return Some((UNTERMINATED_STRING_LITERAL.code, SyntaxError::new(index, UNTERMINATED_STRING_LITERAL, b"", at, at)?));
    }
    let rest = text.strip_prefix(b"Expected ")?;
    let at = rest.windows(11).position(|w| w == b" but found ")?;
    let expected = &rest[..at];
    let (message, argument): (Message, &[u8]) = if expected == b"identifier" { (IDENTIFIER_EXPECTED, b"") } else { (X_0_EXPECTED, expected.strip_prefix(b"\"")?.strip_suffix(b"\"")?) };
    Some((message.code, SyntaxError::new(index, message, argument, location.offset, location.offset + location.length)?))
}

/// The helper of a new coded error: the message has the text and the range of the reference.
fn syntax_error_as(log: &mut Log, errors: &mut SyntaxErrors, start: usize, len: usize, message: Message, argument: &[u8]) {
    let msgs_len = log.msgs.len();
    log.add_range_error_with_code(start, len, message.code, message.format(argument));
    errors.record(log, msgs_len, message, argument, start, start + len);
}

fn invariant(log: &Log, errors: &SyntaxErrors, first: usize) {
    for (index, msg) in log.msgs.iter().enumerate().skip(first) {
        assert_eq!(msg.code().is_some(), errors.get(index).is_some(), "message {index}");
    }
}

fn main() {
    // 1. A stale record does not follow an unrecorded message at the same index, whatever its text.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add_static(7, 1, b"Unexpected ;");
    errors.record(&mut log, 0, TYPE_EXPECTED, b"", 7, 8);
    assert_eq!(log.msgs[0].code(), Some(1110));
    log.msgs.clear();
    log.add_static(7, 1, b"Unexpected ;");
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), None);
    assert!(errors.entries().is_empty());
    invariant(&log, &errors, 0);

    // 2. The same, and the message that stays is one of the lexer.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add_owned(7, 1, b"Unexpected ;");
    errors.record(&mut log, 0, TYPE_EXPECTED, b"", 7, 8);
    log.msgs.clear();
    log.add_owned(18, 1, b"Expected identifier but found \"(\"");
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), Some(1003));
    assert_eq!(errors.entries(), &[SyntaxError { msg: 0, start: 18, end: 19, text: Cow::Borrowed(b"Identifier expected.") }][..]);
    invariant(&log, &errors, 0);

    // 3. Set aside and put back, the other reading records another code for the same text at the same index.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add_static(7, 1, b"Unexpected ;");
    errors.record(&mut log, 0, TYPE_EXPECTED, b"", 7, 8);
    let aside = log.msgs.split_off(0);
    log.add_static(7, 1, b"Unexpected ;");
    errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", 7, 8);
    log.msgs.clear();
    log.msgs.extend(aside);
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), Some(1110));
    assert_eq!(&*errors.entries()[0].text, b"Type expected.");
    invariant(&log, &errors, 0);

    // 4. Set aside and put back, the other reading records the same static text and code at another place.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add_static(8, 11, FN_IN_UNION.text);
    errors.record(&mut log, 0, FN_IN_UNION, b"", 8, 19);
    let aside = log.msgs.split_off(0);
    log.add_static(30, 5, FN_IN_UNION.text);
    errors.record(&mut log, 0, FN_IN_UNION, b"", 30, 35);
    log.msgs.clear();
    log.msgs.extend(aside);
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), Some(1385));
    assert_eq!((errors.entries()[0].start, errors.entries()[0].end), (8, 19));

    // 5. refine changes the code on the message too, and a record for no new message is none.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add_owned(0, 7, b"Unexpected default");
    errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", 0, 7);
    errors.refine(&mut log, 0, EXPRESSION_EXPECTED, X_0_EXPECTED, b"export");
    assert_eq!(log.msgs[0].code(), Some(1005));
    errors.record(&mut log, 1, TYPE_EXPECTED, b"", 0, 7);
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), Some(1005));
    assert_eq!(&*errors.get(0).unwrap().text, b"'export' expected.");
    invariant(&log, &errors, 0);

    // 6. refine leaves a record whose message went.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add_owned(0, 7, b"Unexpected default");
    errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", 0, 7);
    log.msgs.clear();
    log.add_owned(0, 7, b"Expected \";\" but found \"default\"");
    errors.refine(&mut log, 0, EXPRESSION_EXPECTED, X_0_EXPECTED, b"export");
    assert_eq!(log.msgs[0].code(), None);
    errors.finish(&mut log, b"");
    assert_eq!(&*errors.get(0).unwrap().text, b"';' expected.");

    // 7. A failed init: the lexer's message alone. Stamping once and reading the entries after it agree.
    let mut log = Log::default();
    log.add_owned(0, 0, b"Unterminated string literal");
    stamp_lexer_messages(&mut log, 0, b"\"abc");
    assert_eq!(log.msgs[0].code(), Some(1002));
    let errors = SyntaxErrors::of_failed_init(&log, 0, b"\"abc");
    assert_eq!(errors.entries(), &[SyntaxError { msg: 0, start: 4, end: 4, text: Cow::Borrowed(b"Unterminated string literal.") }][..]);
    invariant(&log, &errors, 0);

    // 8. finish twice gives the same: a message of the lexer that has its code already keeps it and its entry.
    let mut log = Log::default();
    log.add_owned(9, 1, b"Expected \";\" but found \"x\"");
    let mut errors = SyntaxErrors::starting_at(0);
    errors.finish(&mut log, b"");
    let once: Vec<SyntaxError> = errors.entries().to_vec();
    errors.finish(&mut log, b"");
    assert_eq!(errors.entries(), &once[..]);
    assert_eq!(log.msgs[0].code(), Some(1005));

    // 9. The helper: the message is the diagnostic, and its entry says the same.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    syntax_error_as(&mut log, &mut errors, 6, 1, X_0_EXPECTED, b";");
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), Some(1005));
    assert_eq!(&*log.msgs[0].data.text, b"';' expected.");
    assert_eq!(errors.entries(), &[SyntaxError { msg: 0, start: 6, end: 7, text: Cow::Owned(b"';' expected.".to_vec()) }][..]);
    invariant(&log, &errors, 0);

    // 10. The message of a resolve error keeps its metadata, and the messages before `first` are not read.
    let mut log = Log::default();
    log.add_owned(9, 1, b"Expected \";\" but found \"x\"");
    log.add_owned(3, 1, b"Expected \")\" but found \"y\"");
    log.msgs[1].metadata = Metadata::Resolve(1);
    let mut errors = SyntaxErrors::starting_at(1);
    errors.record(&mut log, 1, TYPE_EXPECTED, b"", 3, 4);
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), None);
    assert_eq!(log.msgs[1].metadata, Metadata::Resolve(1));
    assert!(errors.entries().is_empty());

    // 11. Two records with one key have one entry: which of them is taken does not matter.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    for _ in 0..3 {
        log.msgs.clear();
        log.add_owned(7, 1, b"Unexpected ;");
        errors.record(&mut log, 0, TYPE_EXPECTED, b"", 7, 8);
    }
    assert_eq!(errors.recorded.len(), 3);
    errors.finish(&mut log, b"");
    assert_eq!(errors.entries().len(), 1);
    assert!(errors.recorded.is_empty());
    println!("model ok: size_of Recorded = {}, SyntaxError = {}", core::mem::size_of::<Recorded>(), core::mem::size_of::<SyntaxError>());
}

#![deny(warnings)]
#![allow(dead_code)]
use std::borrow::Cow;

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Kind { Err, Warn }
pub struct Location { pub offset: usize, pub length: usize }
pub struct Data { pub text: Cow<'static, [u8]>, pub location: Option<Location> }
#[derive(Copy, Clone)]
pub enum Metadata { Build, Resolve(u8), Code(u32) }
pub struct Msg { pub kind: Kind, pub data: Data, pub metadata: Metadata }
impl Msg {
    pub fn code(&self) -> Option<u32> { match self.metadata { Metadata::Code(c) => Some(c), _ => None } }
}
#[derive(Default)]
pub struct Log { pub msgs: Vec<Msg>, pub errors: u32 }
impl Log {
    fn add(&mut self, offset: usize, length: usize, text: &'static [u8]) {
        self.errors += 1;
        self.msgs.push(Msg { kind: Kind::Err, data: Data { text: Cow::Borrowed(text), location: Some(Location { offset, length }) }, metadata: Metadata::Build });
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
const IDENTIFIER_EXPECTED: Message = Message::new(1003, b"Identifier expected.");
const X_0_EXPECTED: Message = Message::new(1005, b"'{0}' expected.");
const EXPRESSION_EXPECTED: Message = Message::new(1109, b"Expression expected.");
const TYPE_EXPECTED: Message = Message::new(1110, b"Type expected.");

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SyntaxError { pub msg: u32, pub start: u32, pub end: u32, pub text: Cow<'static, [u8]> }
impl SyntaxError {
    fn new(msg: usize, message: Message, argument: &[u8], start: usize, end: usize) -> Option<Self> {
        Some(SyntaxError { msg: u32::try_from(msg).ok()?, start: u32::try_from(start).ok()?, end: u32::try_from(end).ok()?, text: message.format(argument) })
    }
}

struct Recorded { msg: usize, at: usize, said: u64, reference: Option<(u32, SyntaxError)> }
fn place_of(msg: &Msg) -> (usize, u64) {
    (msg.data.location.as_ref().map_or(usize::MAX, |location| location.offset), hash(&msg.data.text))
}
impl Recorded {
    fn is_of(&self, msg: &Msg) -> bool {
        msg.code() == self.reference.as_ref().map(|(code, _)| *code) && place_of(msg) == (self.at, self.said)
    }
}
enum Slot { Unrecorded, Uncoded, Coded(SyntaxError) }

#[derive(Default)]
pub struct SyntaxErrors { list: Vec<SyntaxError>, recorded: Vec<Recorded>, first: usize }
impl SyntaxErrors {
    fn starting_at(first: usize) -> SyntaxErrors { SyntaxErrors { first, ..Default::default() } }
    pub fn entries(&self) -> &[SyntaxError] { &self.list }
    pub fn get(&self, msg: usize) -> Option<&SyntaxError> {
        let index = self.list.binary_search_by(|entry| (entry.msg as usize).cmp(&msg)).ok()?;
        self.list.get(index)
    }
    fn record(&mut self, log: &mut Log, msgs_len: usize, message: Message, argument: &[u8], start: usize, end: usize) {
        let Some(index) = log.msgs.len().checked_sub(1) else { return };
        if index < msgs_len { return; }
        let Some(msg) = log.msgs.get_mut(index) else { return };
        if matches!(msg.metadata, Metadata::Resolve(_)) { return; }
        let Some(error) = SyntaxError::new(index, message, argument, start, end) else { return };
        msg.metadata = Metadata::Code(message.code);
        let (at, said) = place_of(msg);
        self.recorded.push(Recorded { msg: index, at, said, reference: Some((message.code, error)) });
    }
    fn keep_uncoded(&mut self, log: &Log, msgs_len: usize) {
        let Some(index) = log.msgs.len().checked_sub(1) else { return };
        if index < msgs_len { return; }
        let Some(msg) = log.msgs.get(index) else { return };
        let (at, said) = place_of(msg);
        self.recorded.push(Recorded { msg: index, at, said, reference: None });
    }
    fn refine(&mut self, log: &mut Log, start: usize, from: Message, to: Message, argument: &[u8]) {
        let Some(last) = self.recorded.last_mut() else { return };
        let Some(msg) = log.msgs.get_mut(last.msg) else { return };
        if !last.is_of(msg) { return; }
        let Some((code, entry)) = &mut last.reference else { return };
        if *code != from.code || entry.start as usize != start { return; }
        *code = to.code;
        entry.text = to.format(argument);
        msg.metadata = Metadata::Code(to.code);
    }
    fn finish(&mut self, log: &mut Log, source: &[u8]) {
        let first = self.first;
        let count = log.msgs.len().saturating_sub(first);
        let mut slots: Vec<Slot> = Vec::new();
        slots.resize_with(count, || Slot::Unrecorded);
        for record in core::mem::take(&mut self.recorded) {
            let Some(msg) = log.msgs.get(record.msg) else { continue };
            if !record.is_of(msg) { continue; }
            let Some(slot) = record.msg.checked_sub(first).and_then(|offset| slots.get_mut(offset)) else { continue };
            *slot = match record.reference { Some((_, entry)) => Slot::Coded(entry), None => Slot::Uncoded };
        }
        self.list.clear();
        for (offset, slot) in slots.into_iter().enumerate() {
            let index = first + offset;
            let Some(msg) = log.msgs.get_mut(index) else { continue };
            match slot {
                Slot::Coded(entry) => self.list.push(entry),
                Slot::Uncoded => {}
                Slot::Unrecorded => match msg.code() {
                    Some(_) => msg.metadata = Metadata::Build,
                    None => {
                        if let Some((code, entry)) = of_lexer_message(index, msg, source) {
                            msg.metadata = Metadata::Code(code);
                            self.list.push(entry);
                        }
                    }
                },
            }
        }
    }
    fn of_failed_init(log: &mut Log, first: usize, source: &[u8]) -> SyntaxErrors {
        let mut errors = SyntaxErrors::starting_at(first);
        errors.finish(log, source);
        errors
    }
}
fn of_lexer_message(index: usize, msg: &Msg, _source: &[u8]) -> Option<(u32, SyntaxError)> {
    if msg.kind != Kind::Err { return None; }
    let location = msg.data.location.as_ref()?;
    let text: &[u8] = &msg.data.text;
    let rest = text.strip_prefix(b"Expected ")?;
    let at = rest.windows(11).position(|w| w == b" but found ")?;
    let expected = &rest[..at];
    let (message, argument): (Message, &[u8]) = if expected == b"identifier" { (IDENTIFIER_EXPECTED, b"") } else { (X_0_EXPECTED, expected.strip_prefix(b"\"")?.strip_suffix(b"\"")?) };
    Some((message.code, SyntaxError::new(index, message, argument, location.offset, location.offset + location.length)?))
}

fn main() {
    // A stale record does not follow a message of the lexer at the same index.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add(7, 1, b"Unexpected ;");
    errors.record(&mut log, 0, TYPE_EXPECTED, b"", 7, 8);
    assert_eq!(log.msgs[0].code(), Some(1110));
    log.msgs.clear();
    log.add(18, 1, b"Expected identifier but found \"(\"");
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), Some(1003));
    assert_eq!(errors.entries(), &[SyntaxError { msg: 0, start: 18, end: 19, text: Cow::Borrowed(b"Identifier expected.") }][..]);

    // Set aside and put back: the record of the message that comes back counts, not the later one of the other reading.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add(7, 1, b"Unexpected ;");
    errors.record(&mut log, 0, TYPE_EXPECTED, b"", 7, 8);
    let aside = log.msgs.split_off(0);
    log.add(7, 1, b"Unexpected ;");
    errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", 7, 8);
    log.msgs.clear();
    log.msgs.extend(aside);
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), Some(1110));
    assert_eq!(&*errors.entries()[0].text, b"Type expected.");

    // refine changes the code on the message too.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add(0, 7, b"Unexpected default");
    errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", 0, 7);
    errors.refine(&mut log, 0, EXPRESSION_EXPECTED, X_0_EXPECTED, b"export");
    assert_eq!(log.msgs[0].code(), Some(1005));
    errors.record(&mut log, 1, TYPE_EXPECTED, b"", 0, 7);
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), Some(1005));
    assert_eq!(&*errors.get(0).unwrap().text, b"'export' expected.");

    // A message in the words of the lexer that a site keeps without a code.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add(15, 1, b"Expected \")\" but found \",\"");
    errors.keep_uncoded(&log, 0);
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), None);
    assert!(errors.entries().is_empty());

    // A failed init: the lexer's message alone.
    let mut log = Log::default();
    log.add(9, 1, b"Expected \";\" but found \"x\"");
    let errors = SyntaxErrors::of_failed_init(&mut log, 0, b"");
    assert_eq!(log.msgs[0].code(), Some(1005));
    assert_eq!(&*errors.get(0).unwrap().text, b"';' expected.");

    // A coded message whose record is gone loses its code.
    let mut log = Log::default();
    let mut errors = SyntaxErrors::starting_at(0);
    log.add(7, 1, b"Unexpected ;");
    errors.record(&mut log, 0, TYPE_EXPECTED, b"", 7, 8);
    errors.recorded.clear();
    errors.finish(&mut log, b"");
    assert_eq!(log.msgs[0].code(), None);
    assert!(errors.entries().is_empty());
    println!("shape ok");
}

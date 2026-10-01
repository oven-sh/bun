//! Scratch model of the table of syntax errors once the code is on the message. Stand-ins for bun_ast at the top; the rest is the shape for syntax_errors.rs.
#![deny(warnings)]
#![allow(dead_code)]
use std::borrow::Cow;
use std::collections::HashMap;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Kind { Err, Warn }
#[derive(Clone, Debug)]
pub struct Location { pub offset: usize, pub length: usize }
pub struct Data { pub text: Cow<'static, [u8]>, pub location: Option<Location> }
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Metadata { Build, Resolve(u8), Code(u32) }
pub struct Msg { pub kind: Kind, pub data: Data, pub metadata: Metadata }
impl Msg {
    pub fn code(&self) -> Option<u32> { match self.metadata { Metadata::Code(c) => Some(c), _ => None } }
}
#[derive(Default)]
pub struct Log { pub msgs: Vec<Msg>, pub errors: u32, pub warnings: u32 }
#[derive(Copy, Clone)]
pub struct Range { start: i32, len: i32 }
fn range(start: i32, len: i32) -> Range { Range { start, len } }
impl Log {
    fn add_range_error(&mut self, r: Range, text: Cow<'static, [u8]>) {
        self.errors += 1;
        self.msgs.push(Msg { kind: Kind::Err, data: Data { text, location: Some(Location { offset: r.start as usize, length: r.len as usize }) }, metadata: Metadata::Build });
    }
    fn add_range_warning(&mut self, r: Range, text: &'static [u8]) {
        self.warnings += 1;
        self.msgs.push(Msg { kind: Kind::Warn, data: Data { text: Cow::Borrowed(text), location: Some(Location { offset: r.start as usize, length: r.len as usize }) }, metadata: Metadata::Build });
    }
    fn add_range_error_with_code(&mut self, r: Range, code: u32, text: Cow<'static, [u8]>) {
        self.errors += 1;
        self.msgs.push(Msg { kind: Kind::Err, data: Data { text, location: Some(Location { offset: r.start as usize, length: r.len as usize }) }, metadata: Metadata::Code(code) });
    }
}
fn hash(bytes: &[u8]) -> u64 { bytes.iter().fold(1469598103934665603u64, |h, b| (h ^ *b as u64).wrapping_mul(1099511628211)) }
fn split_once<'a>(text: &'a [u8], at: &[u8]) -> Option<(&'a [u8], &'a [u8])> {
    let i = text.windows(at.len()).position(|w| w == at)?;
    Some((&text[..i], &text[i + at.len()..]))
}
fn is_keyword(word: &[u8]) -> bool { matches!(word, b"class" | b"default" | b"catch" | b"function") }

// ───────────── the shape ─────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Message { code: u32, text: &'static [u8] }
impl Message {
    const fn new(code: u32, text: &'static [u8]) -> Message { Message { code, text } }
    fn format(self, argument: &[u8]) -> Cow<'static, [u8]> {
        match split_once(self.text, b"{0}") {
            None => Cow::Borrowed(self.text),
            Some((before, after)) => Cow::Owned([before, argument, after].concat()),
        }
    }
}
const UNTERMINATED_STRING_LITERAL: Message = Message::new(1002, b"Unterminated string literal.");
const IDENTIFIER_EXPECTED: Message = Message::new(1003, b"Identifier expected.");
const X_0_EXPECTED: Message = Message::new(1005, b"'{0}' expected.");
const ASTERISK_SLASH_EXPECTED: Message = Message::new(1010, b"'*/' expected.");
const EXPRESSION_EXPECTED: Message = Message::new(1109, b"Expression expected.");
const TYPE_EXPECTED: Message = Message::new(1110, b"Type expected.");
const DECLARATION_OR_STATEMENT_EXPECTED: Message = Message::new(1128, b"Declaration or statement expected.");
const UNTERMINATED_TEMPLATE_LITERAL: Message = Message::new(1160, b"Unterminated template literal.");
const IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE: Message =
    Message::new(1359, b"Identifier expected. '{0}' is a reserved word that cannot be used here.");
const FUNCTION_TYPE_NOTATION_UNION: Message = Message::new(1385, b"Function type notation must be parenthesized when used in a union type.");

/// The range and the text that the reference has for one message with a code that a lint parse left in the log.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SyntaxError {
    /// The index of the message in `Log::msgs`.
    pub msg: u32,
    pub start: u32,
    pub end: u32,
    pub text: Cow<'static, [u8]>,
}
impl SyntaxError {
    fn new(msg: usize, start: usize, end: usize, text: Cow<'static, [u8]>) -> Option<Self> {
        Some(SyntaxError { msg: u32::try_from(msg).ok()?, start: u32::try_from(start).ok()?, end: u32::try_from(end).ok()?, text })
    }
}

/// What tells a message that a site gave a code: the code, and the range and the text that the message has in the log.
#[derive(PartialEq, Eq, Hash, Clone, Copy, Debug)]
struct Coded { code: u32, offset: usize, length: usize, said: u64 }
impl Coded {
    fn of(msg: &Msg) -> Option<Coded> {
        let code = msg.code()?;
        let location = msg.data.location.as_ref()?;
        Some(Coded { code, offset: location.offset, length: location.length, said: hash(&msg.data.text) })
    }
}

/// The range and the text of the reference for the messages that are `Coded` alike.
struct Reference { start: usize, end: usize, text: Cow<'static, [u8]> }

#[derive(Default)]
pub struct SyntaxErrors {
    list: Vec<SyntaxError>,
    recorded: HashMap<Coded, Reference>,
    first: usize,
}

impl SyntaxErrors {
    fn starting_at(first: usize) -> SyntaxErrors { SyntaxErrors { first, ..Default::default() } }
    pub fn entries(&self) -> &[SyntaxError] { &self.list }
    pub fn get(&self, msg: usize) -> Option<&SyntaxError> {
        let index = self.list.binary_search_by(|entry| (entry.msg as usize).cmp(&msg)).ok()?;
        self.list.get(index)
    }

    /// Gives the message that `log` got since it had `msgs_len` of them the code of `message`, and keeps the range and the text of the reference for it.
    fn record(&mut self, log: &mut Log, msgs_len: usize, message: Message, argument: &[u8], r: Range) {
        let Some(index) = log.msgs.len().checked_sub(1) else { return };
        if index < msgs_len { return; }
        let Some(msg) = log.msgs.get_mut(index) else { return };
        if matches!(msg.metadata, Metadata::Resolve(_)) || msg.data.location.is_none() { return; }
        let start = usize::try_from(r.start).unwrap_or(0);
        let end = start + usize::try_from(r.len).unwrap_or(0);
        msg.metadata = Metadata::Code(message.code);
        if let Some(coded) = Coded::of(msg) {
            self.recorded.insert(coded, Reference { start, end, text: message.format(argument) });
        }
    }

    /// Gives the last message of `log` the diagnostic `to` where a site gave it `from` at `start`.
    fn refine(&mut self, log: &mut Log, start: usize, from: Message, to: Message, argument: &[u8]) {
        let Some(msg) = log.msgs.last_mut() else { return };
        let Some(coded) = Coded::of(msg) else { return };
        if coded.code != from.code || coded.offset != start { return; }
        let Some(reference) = self.recorded.get(&coded) else { return };
        let reference = Reference { start: reference.start, end: reference.end, text: to.format(argument) };
        msg.metadata = Metadata::Code(to.code);
        self.recorded.insert(Coded { code: to.code, ..coded }, reference);
    }

    /// Ends the parse: an entry for each message of the parse that has a code, and the code and an entry for each that the lexer logged in words the reference has a diagnostic for.
    fn finish(&mut self, log: &mut Log, source: &[u8]) {
        let recorded = core::mem::take(&mut self.recorded);
        self.list.clear();
        for (index, msg) in log.msgs.iter_mut().enumerate().skip(self.first) {
            let entry = match msg.metadata {
                Metadata::Code(_) => match Coded::of(msg).and_then(|coded| recorded.get(&coded)) {
                    Some(reference) => SyntaxError::new(index, reference.start, reference.end, reference.text.clone()),
                    // `lint_error` logged it: it says what the reference says.
                    None => of_own_text(index, msg),
                },
                Metadata::Build => match of_lexer_message(msg, source) {
                    Some((code, reference)) => {
                        msg.metadata = Metadata::Code(code);
                        SyntaxError::new(index, reference.start, reference.end, reference.text)
                    }
                    None => None,
                },
                Metadata::Resolve(_) => None,
            };
            if let Some(entry) = entry { self.list.push(entry); }
        }
    }

    /// The table of a lint parse whose first token failed: only the lexer logged, from index `first` on.
    fn of_first_token(log: &mut Log, first: usize, source: &[u8]) -> SyntaxErrors {
        let mut errors = SyntaxErrors::starting_at(first);
        errors.finish(log, source);
        errors
    }
}

fn of_own_text(index: usize, msg: &Msg) -> Option<SyntaxError> {
    let location = msg.data.location.as_ref()?;
    SyntaxError::new(index, location.offset, location.offset + location.length, msg.data.text.clone())
}

fn unquote(quoted: &[u8]) -> Option<&[u8]> { quoted.strip_prefix(b"\"")?.strip_suffix(b"\"") }
fn end_of_unterminated_string(source: &[u8], start: usize) -> usize {
    let mut at = start + 1;
    while let Some(&byte) = source.get(at) {
        match byte {
            b'\n' | b'\r' => break,
            b'\\' if source.get(at + 1) == Some(&b'\r') && source.get(at + 2) == Some(&b'\n') => at += 3,
            b'\\' => at += 2,
            _ => at += 1,
        }
    }
    at.min(source.len())
}

impl Reference {
    fn new(message: Message, argument: &[u8], start: usize, end: usize) -> Option<(u32, Reference)> {
        Some((message.code, Reference { start, end, text: message.format(argument) }))
    }
}

/// The diagnostic of a message of the lexer that no site gave a code, read from its text: its code, and its range and text.
fn of_lexer_message(msg: &Msg, source: &[u8]) -> Option<(u32, Reference)> {
    if msg.kind != Kind::Err { return None; }
    let location = msg.data.location.as_ref()?;
    let start = location.offset;
    let end = start + location.length;
    let text: &[u8] = &msg.data.text;
    if text == b"Unterminated string literal" {
        return match source.get(start) {
            Some(b'"' | b'\'') => { let at = end_of_unterminated_string(source, start); Reference::new(UNTERMINATED_STRING_LITERAL, b"", at, at) }
            Some(b'`' | b'}') => Reference::new(UNTERMINATED_TEMPLATE_LITERAL, b"", source.len(), source.len()),
            _ => None,
        };
    }
    if text == b"Expected \"*/\" to terminate multi-line comment" { return Reference::new(ASTERISK_SLASH_EXPECTED, b"", start, end); }
    let (expected, found) = split_once(text.strip_prefix(b"Expected ")?, b" but found ")?;
    if expected == b"identifier" {
        return match unquote(found).filter(|word| is_keyword(word)) {
            Some(word) => Reference::new(IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE, word, start, end),
            None => Reference::new(IDENTIFIER_EXPECTED, b"", start, end),
        };
    }
    Reference::new(X_0_EXPECTED, unquote(expected)?, start, end)
}

// ───────────── what the sites do (P::...) ─────────────
struct P { log: Log, errors: SyntaxErrors, is_lint: bool, prev_error_loc: i32 }
impl P {
    fn lint(first: usize, log: Log) -> P { P { log, errors: SyntaxErrors::starting_at(first), is_lint: true, prev_error_loc: -1 } }
    /// `Lexer::unexpected` + code_syntax_error
    fn unexpected_as(&mut self, r: Range, found: &str, message: Message) {
        let msgs_len = self.log.msgs.len();
        self.log.add_range_error(r, Cow::Owned(format!("Unexpected {found}").into_bytes()));
        if self.is_lint { self.errors.record(&mut self.log, msgs_len, message, b"", r); }
    }
    /// The helper of item 5.
    fn lint_error(&mut self, r: Range, message: Message, argument: &[u8]) -> bool {
        if !self.is_lint { return false; }
        if self.prev_error_loc != r.start {
            self.log.add_range_error_with_code(r, message.code, message.format(argument));
            self.prev_error_loc = r.start;
        }
        true
    }
    fn finish(&mut self, source: &[u8]) { self.errors.finish(&mut self.log, source); }
}

fn text(entry: Option<&SyntaxError>) -> String { entry.map_or("-".into(), |e| format!("{}..{} {}", e.start, e.end, String::from_utf8_lossy(&e.text))) }

fn main() {
    // 1. A message that an attempt drops takes its code along; the message of the lexer at the same index gets its own.
    let mut p = P::lint(0, Log::default());
    p.unexpected_as(range(7, 1), ";", TYPE_EXPECTED);
    assert_eq!(p.log.msgs[0].code(), Some(1110));
    p.log.msgs.truncate(0); p.log.errors = 0;
    p.log.add_range_error(range(18, 1), Cow::Borrowed(b"Expected identifier but found \"(\""));
    p.finish(b"");
    assert_eq!(p.log.msgs[0].code(), Some(1003));
    assert_eq!(text(p.errors.get(0)), "18..19 Identifier expected.");
    assert_eq!(p.errors.entries().len(), 1);

    // 2. Set aside and put back, while the other reading logs the same words at the same place with another code (`{ [: string]: b }`).
    let mut p = P::lint(0, Log::default());
    p.unexpected_as(range(12, 1), ":", TYPE_EXPECTED);
    let aside = p.log.msgs.split_off(0);
    p.unexpected_as(range(12, 1), ":", EXPRESSION_EXPECTED);
    assert_eq!(p.log.msgs[0].code(), Some(1109));
    p.log.msgs.truncate(0);
    p.log.msgs.extend(aside);
    p.finish(b"");
    assert_eq!(p.log.msgs[0].code(), Some(1110));
    assert_eq!(text(p.errors.get(0)), "12..13 Type expected.");

    // 3. The same with two errors of `lint_error` that differ in the argument only.
    let mut p = P::lint(0, Log::default());
    assert!(p.lint_error(range(6, 1), X_0_EXPECTED, b")"));
    let aside = p.log.msgs.split_off(0);
    p.prev_error_loc = -1;
    assert!(p.lint_error(range(6, 1), X_0_EXPECTED, b";"));
    p.log.msgs.truncate(0);
    p.log.msgs.extend(aside);
    p.finish(b"");
    assert_eq!(p.log.msgs[0].code(), Some(1005));
    assert_eq!(text(p.errors.get(0)), "6..7 ')' expected.");

    // 4. A stale record of a site and a later error of `lint_error` with the same code at the same place.
    let mut p = P::lint(0, Log::default());
    p.unexpected_as(range(0, 7), "default", EXPRESSION_EXPECTED);
    p.errors.refine(&mut p.log, 0, EXPRESSION_EXPECTED, X_0_EXPECTED, b"export");
    assert_eq!(p.log.msgs[0].code(), Some(1005));
    p.log.msgs.truncate(0); p.log.errors = 0; p.prev_error_loc = -1;
    assert!(p.lint_error(range(0, 7), X_0_EXPECTED, b";"));
    p.finish(b"");
    assert_eq!(text(p.errors.get(0)), "0..7 ';' expected.");

    // 5. refine: the code on the message follows, and a record for a message that was not logged is none.
    let mut p = P::lint(0, Log::default());
    p.unexpected_as(range(0, 7), "default", EXPRESSION_EXPECTED);
    p.errors.refine(&mut p.log, 0, EXPRESSION_EXPECTED, X_0_EXPECTED, b"export");
    p.errors.record(&mut p.log, 1, TYPE_EXPECTED, b"", range(0, 7));
    let aside = p.log.msgs.split_off(0);
    p.log.msgs.extend(aside);
    p.finish(b"");
    assert_eq!(p.log.msgs[0].code(), Some(1005));
    assert_eq!(text(p.errors.get(0)), "0..7 'export' expected.");
    // refine twice is once: the message no longer carries `from`.
    let mut p = P::lint(0, Log::default());
    p.unexpected_as(range(2, 1), ")", EXPRESSION_EXPECTED);
    p.errors.refine(&mut p.log, 2, EXPRESSION_EXPECTED, DECLARATION_OR_STATEMENT_EXPECTED, b"");
    p.errors.refine(&mut p.log, 2, EXPRESSION_EXPECTED, X_0_EXPECTED, b"try");
    p.finish(b"");
    assert_eq!(p.log.msgs[0].code(), Some(1128));
    assert_eq!(text(p.errors.get(0)), "2..3 Declaration or statement expected.");
    // refine leaves a message at another place, and one that `lint_error` logged.
    let mut p = P::lint(0, Log::default());
    p.unexpected_as(range(2, 1), ")", EXPRESSION_EXPECTED);
    p.errors.refine(&mut p.log, 0, EXPRESSION_EXPECTED, DECLARATION_OR_STATEMENT_EXPECTED, b"");
    assert_eq!(p.log.msgs[0].code(), Some(1109));
    assert!(p.lint_error(range(9, 1), EXPRESSION_EXPECTED, b""));
    p.errors.refine(&mut p.log, 9, EXPRESSION_EXPECTED, DECLARATION_OR_STATEMENT_EXPECTED, b"");
    p.finish(b"");
    assert_eq!(p.log.msgs[1].code(), Some(1109));
    assert_eq!(text(p.errors.get(1)), "9..10 Expression expected.");

    // 6. The first token fails: only the lexer logged, after a warning.
    let source = b"-->\n\"abc";
    let mut log = Log::default();
    log.add_range_warning(range(0, 3), b"Treating \"-->\" as the start of a legacy HTML single-line comment");
    log.add_range_error(range(4, 0), Cow::Borrowed(b"Unterminated string literal"));
    let errors = SyntaxErrors::of_first_token(&mut log, 0, source);
    assert_eq!(log.msgs[0].code(), None);
    assert_eq!(log.msgs[1].code(), Some(1002));
    assert_eq!(errors.get(0), None);
    assert_eq!(text(errors.get(1)), "8..8 Unterminated string literal.");
    let mut log = Log::default();
    log.add_range_error(range(6, 0), Cow::Borrowed(b"Expected \"*/\" to terminate multi-line comment"));
    let errors = SyntaxErrors::of_first_token(&mut log, 0, b"/* abc");
    assert_eq!((log.msgs[0].code(), text(errors.get(0))), (Some(1010), "6..6 '*/' expected.".to_string()));
    let mut log = Log::default();
    log.add_range_error(range(0, 0), Cow::Borrowed(b"Unterminated string literal"));
    let errors = SyntaxErrors::of_first_token(&mut log, 0, b"`abc ");
    assert_eq!((log.msgs[0].code(), text(errors.get(0))), (Some(1160), "5..5 Unterminated template literal.".to_string()));
    let mut log = Log::default();
    log.add_range_error(range(0, 0), Cow::Borrowed(b"Syntax Error"));
    let errors = SyntaxErrors::of_first_token(&mut log, 0, b"0b2");
    assert_eq!((log.msgs[0].code(), errors.entries().len()), (None, 0));

    // 7. Messages from before the parse are not touched, and the index of an entry is the one in the log.
    let mut log = Log::default();
    log.add_range_error(range(1, 1), Cow::Borrowed(b"Expected \";\" but found \"x\""));
    let mut p = P::lint(1, log);
    p.log.add_range_error(range(10, 1), Cow::Borrowed(b"Expected \";\" but found \"1\""));
    p.finish(b"");
    assert_eq!(p.log.msgs[0].code(), None);
    assert_eq!(p.log.msgs[1].code(), Some(1005));
    assert_eq!(p.errors.get(0), None);
    assert_eq!(text(p.errors.get(1)), "10..11 ';' expected.");

    // 8. A parse without lint: no code, no entry, `lint_error` logs nothing.
    let mut p = P { log: Log::default(), errors: SyntaxErrors::default(), is_lint: false, prev_error_loc: -1 };
    p.unexpected_as(range(7, 1), ";", TYPE_EXPECTED);
    assert!(!p.lint_error(range(7, 1), TYPE_EXPECTED, b""));
    assert_eq!((p.log.msgs.len(), p.log.msgs[0].code()), (1, None));

    // 9. A resolve error keeps its metadata; a warning gets no code.
    let mut p = P::lint(0, Log::default());
    p.log.add_range_error(range(3, 1), Cow::Borrowed(b"Cannot find module"));
    p.log.msgs[0].metadata = Metadata::Resolve(1);
    p.errors.record(&mut p.log, 0, TYPE_EXPECTED, b"", range(3, 1));
    p.finish(b"");
    assert_eq!(p.log.msgs[0].metadata, Metadata::Resolve(1));
    assert!(p.errors.entries().is_empty());

    // 10. Every message with a code has an entry, and no other has one.
    let mut p = P::lint(0, Log::default());
    p.unexpected_as(range(7, 1), ";", TYPE_EXPECTED);
    assert!(p.lint_error(range(9, 2), FUNCTION_TYPE_NOTATION_UNION, b""));
    p.log.add_range_error(range(12, 1), Cow::Borrowed(b"Expected \")\" but found \"}\""));
    p.log.add_range_error(range(14, 1), Cow::Borrowed(b"Syntax Error"));
    p.finish(b"");
    for (index, msg) in p.log.msgs.iter().enumerate() {
        assert_eq!(msg.code().is_some(), p.errors.get(index).is_some(), "{index}");
    }
    assert_eq!(p.log.msgs.iter().map(Msg::code).collect::<Vec<_>>(), [Some(1110), Some(1385), Some(1005), None]);
    assert_eq!(text(p.errors.get(1)), "9..11 Function type notation must be parenthesized when used in a union type.");
    println!("size_of SyntaxError = {}, Coded = {}, Reference = {}", std::mem::size_of::<SyntaxError>(), std::mem::size_of::<Coded>(), std::mem::size_of::<Reference>());
    println!("model ok");
}

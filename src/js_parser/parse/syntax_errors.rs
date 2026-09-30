//! The diagnostics of typescript-go's parser and scanner for the syntax errors of a lint parse.

use std::borrow::Cow;

use bun_ast::ts;
use bun_ast::{Kind, Loc, Log, Msg, Range};
use bun_core::strings;

use crate::Error;
use crate::lexer::{self as js_lexer, T};
use crate::p::P;
use crate::typescript::{SkipTypeOptions, SkipTypeOptionsBitset};

/// A diagnostic of the reference: the number after "TS", and its text with `{0}` where the argument goes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Message {
    code: u32,
    text: &'static [u8],
}

impl Message {
    const fn new(code: u32, text: &'static [u8]) -> Message {
        Message { code, text }
    }

    /// The text with `argument` in the place of `{0}`.
    fn format(self, argument: &[u8]) -> Cow<'static, [u8]> {
        match strings::split_once(self.text, b"{0}") {
            None => Cow::Borrowed(self.text),
            Some((before, after)) => Cow::Owned([before, argument, after].concat()),
        }
    }
}

/// `Unterminated_string_literal`
const UNTERMINATED_STRING_LITERAL: Message = Message::new(1002, b"Unterminated string literal.");
/// `Identifier_expected`
const IDENTIFIER_EXPECTED: Message = Message::new(1003, b"Identifier expected.");
/// `X_0_expected`
const X_0_EXPECTED: Message = Message::new(1005, b"'{0}' expected.");
/// `Asterisk_Slash_expected`
const ASTERISK_SLASH_EXPECTED: Message = Message::new(1010, b"'*/' expected.");
/// `Expression_expected`
pub(crate) const EXPRESSION_EXPECTED: Message = Message::new(1109, b"Expression expected.");
/// `Type_expected`
const TYPE_EXPECTED: Message = Message::new(1110, b"Type expected.");
/// `Declaration_or_statement_expected`
const DECLARATION_OR_STATEMENT_EXPECTED: Message =
    Message::new(1128, b"Declaration or statement expected.");
/// `Unterminated_template_literal`
const UNTERMINATED_TEMPLATE_LITERAL: Message =
    Message::new(1160, b"Unterminated template literal.");
/// `Identifier_expected_0_is_a_reserved_word_that_cannot_be_used_here`
const IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE: Message = Message::new(
    1359,
    b"Identifier expected. '{0}' is a reserved word that cannot be used here.",
);
/// `Function_type_notation_must_be_parenthesized_when_used_in_a_union_type`
const FUNCTION_TYPE_NOTATION_MUST_BE_PARENTHESIZED_WHEN_USED_IN_A_UNION_TYPE: Message =
    Message::new(
        1385,
        b"Function type notation must be parenthesized when used in a union type.",
    );
/// `Constructor_type_notation_must_be_parenthesized_when_used_in_a_union_type`
const CONSTRUCTOR_TYPE_NOTATION_MUST_BE_PARENTHESIZED_WHEN_USED_IN_A_UNION_TYPE: Message =
    Message::new(
        1386,
        b"Constructor type notation must be parenthesized when used in a union type.",
    );
/// `Function_type_notation_must_be_parenthesized_when_used_in_an_intersection_type`
const FUNCTION_TYPE_NOTATION_MUST_BE_PARENTHESIZED_WHEN_USED_IN_AN_INTERSECTION_TYPE: Message =
    Message::new(
        1387,
        b"Function type notation must be parenthesized when used in an intersection type.",
    );
/// `Constructor_type_notation_must_be_parenthesized_when_used_in_an_intersection_type`
const CONSTRUCTOR_TYPE_NOTATION_MUST_BE_PARENTHESIZED_WHEN_USED_IN_AN_INTERSECTION_TYPE: Message =
    Message::new(
        1388,
        b"Constructor type notation must be parenthesized when used in an intersection type.",
    );

/// What the reference reports for one message that a lint parse left in the log.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SyntaxError {
    /// The index of the message in `Log::msgs`.
    pub msg: u32,
    /// The number of the diagnostic: 1005 is TS1005.
    pub code: u32,
    /// The offset of the first byte that the diagnostic marks.
    pub start: u32,
    /// The offset after the last byte that it marks: `start` where it marks a position.
    pub end: u32,
    /// The text of the diagnostic, its argument filled in.
    pub text: Cow<'static, [u8]>,
}

impl SyntaxError {
    fn new(
        msg: usize,
        message: Message,
        argument: &[u8],
        start: usize,
        end: usize,
    ) -> Option<Self> {
        Some(SyntaxError {
            msg: u32::try_from(msg).ok()?,
            code: message.code,
            start: u32::try_from(start).ok()?,
            end: u32::try_from(end).ok()?,
            text: message.format(argument),
        })
    }
}

/// A record of a running parse, and the address and length of the text of the message it was made for.
struct Recorded {
    error: SyntaxError,
    text: (usize, usize),
}

/// Where the text of `msg` is and how long it is: a message that the log drops takes its text with it.
fn text_of(msg: &Msg) -> (usize, usize) {
    (msg.data.text.as_ptr() as usize, msg.data.text.len())
}

/// The count of records above which those of dropped messages are thrown away.
const RECORDED_MIN: usize = 64;

/// The diagnostics of the reference for the messages that a lint parse left in the log.
#[derive(Default)]
pub struct SyntaxErrors {
    /// One entry for each message that has one, by rising `msg`. Empty while the parse runs.
    list: Vec<SyntaxError>,
    /// Every record of the running parse, oldest first: the parser drops and restores messages while it backtracks.
    recorded: Vec<Recorded>,
    /// The count of records at which `record` looks for those of dropped messages.
    sweep_at: usize,
    /// The index in the log of the first message of the parse.
    first: usize,
}

impl SyntaxErrors {
    /// The table of a parse whose messages start at index `first` of the log.
    fn starting_at(first: usize) -> SyntaxErrors {
        SyntaxErrors {
            first,
            ..Default::default()
        }
    }

    /// Every entry, by rising `msg`.
    pub fn entries(&self) -> &[SyntaxError] {
        &self.list
    }

    /// The entry of the message at index `msg` of the log.
    pub fn get(&self, msg: usize) -> Option<&SyntaxError> {
        let index = self
            .list
            .binary_search_by(|entry| (entry.msg as usize).cmp(&msg))
            .ok()?;
        self.list.get(index)
    }

    /// Records `message` for the message that `log` got since it had `msgs_len` of them, if it got one.
    fn record(
        &mut self,
        log: &Log,
        msgs_len: usize,
        message: Message,
        argument: &[u8],
        range: Range,
    ) {
        let Some(index) = log.msgs.len().checked_sub(1) else {
            return;
        };
        let Some(msg) = log.msgs.get(index) else {
            return;
        };
        if index < msgs_len {
            return;
        }
        let start = usize::try_from(range.loc.start).unwrap_or(0);
        let end = start + usize::try_from(range.len).unwrap_or(0);
        let Some(error) = SyntaxError::new(index, message, argument, start, end) else {
            return;
        };
        if self.recorded.len() >= self.sweep_at.max(RECORDED_MIN) {
            self.recorded.retain(|record| record.is_live(log));
            self.sweep_at = self.recorded.len() * 2;
        }
        self.recorded.push(Recorded {
            error,
            text: text_of(msg),
        });
    }

    /// Replaces the last record with `to` if it is `from` at `start`.
    fn refine(&mut self, start: usize, from: Message, to: Message, argument: &[u8]) {
        let Some(last) = self.recorded.last_mut() else {
            return;
        };
        if last.error.code == from.code && last.error.start as usize == start {
            last.error.code = to.code;
            last.error.text = to.format(argument);
        }
    }

    /// Ends the parse: keeps the last record of each message that `log` still has, and reads what the lexer expected from the text of the others.
    fn finish(&mut self, log: &Log, source: &[u8]) {
        let first = self.first;
        let count = log.msgs.len().saturating_sub(first);
        let mut slots: Vec<Option<SyntaxError>> = Vec::new();
        slots.resize_with(count, || None);
        for record in core::mem::take(&mut self.recorded) {
            if !record.is_live(log) {
                continue;
            }
            let slot = (record.error.msg as usize)
                .checked_sub(first)
                .and_then(|offset| slots.get_mut(offset));
            if let Some(slot) = slot {
                *slot = Some(record.error);
            }
        }
        self.sweep_at = 0;
        self.list.clear();
        for (offset, slot) in slots.into_iter().enumerate() {
            let index = first + offset;
            let entry = slot.or_else(|| {
                log.msgs
                    .get(index)
                    .and_then(|msg| of_lexer_message(index, msg, source))
            });
            if let Some(entry) = entry {
                self.list.push(entry);
            }
        }
    }
}

impl Recorded {
    /// Whether `log` still has the message that the record was made for.
    fn is_live(&self, log: &Log) -> bool {
        log.msgs
            .get(self.error.msg as usize)
            .is_some_and(|msg| text_of(msg) == self.text)
    }
}

/// The entry of a message of the lexer that no site recorded, read from its text: `Lexer::expected_string` says what it expected.
fn of_lexer_message(index: usize, msg: &Msg, source: &[u8]) -> Option<SyntaxError> {
    if msg.kind != Kind::Err {
        return None;
    }
    let location = msg.data.location.as_ref()?;
    let start = location.offset;
    let end = start + location.length;
    let text: &[u8] = &msg.data.text;
    if text == b"Unterminated string literal" {
        // The scanner of the reference reports where the line or the file ends.
        return match source.get(start) {
            Some(b'"' | b'\'') => {
                let at = end_of_unterminated_string(source, start);
                SyntaxError::new(index, UNTERMINATED_STRING_LITERAL, b"", at, at)
            }
            Some(b'`' | b'}') => {
                let at = source.len();
                SyntaxError::new(index, UNTERMINATED_TEMPLATE_LITERAL, b"", at, at)
            }
            _ => None,
        };
    }
    if text == b"Expected \"*/\" to terminate multi-line comment" {
        return SyntaxError::new(index, ASTERISK_SLASH_EXPECTED, b"", start, end);
    }
    let (expected, found) = split_expected(text)?;
    if expected == b"identifier" {
        // createIdentifierWithDiagnostic
        return match unquote(found).filter(|word| js_lexer::keyword(word).is_some()) {
            Some(word) => SyntaxError::new(
                index,
                IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE,
                word,
                start,
                end,
            ),
            None => SyntaxError::new(index, IDENTIFIER_EXPECTED, b"", start, end),
        };
    }
    // parseExpected
    let token = unquote(expected)?;
    SyntaxError::new(index, X_0_EXPECTED, token, start, end)
}

/// `Expected a but found b`: `a` and `b`.
fn split_expected(text: &[u8]) -> Option<(&[u8], &[u8])> {
    strings::split_once(text.strip_prefix(b"Expected ")?, b" but found ")
}

/// The text between the two quotes of `quoted`.
fn unquote(quoted: &[u8]) -> Option<&[u8]> {
    quoted.strip_prefix(b"\"")?.strip_suffix(b"\"")
}

/// Where the string that starts at `start` and has no closing quote ends: at the end of its line or of `source`.
fn end_of_unterminated_string(source: &[u8], start: usize) -> usize {
    let mut at = start + 1;
    while let Some(&byte) = source.get(at) {
        match byte {
            b'\n' | b'\r' => break,
            // An escaped line break continues the string.
            b'\\' if source.get(at + 1) == Some(&b'\r') && source.get(at + 2) == Some(&b'\n') => {
                at += 3;
            }
            b'\\' => at += 2,
            _ => at += 1,
        }
    }
    at.min(source.len())
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Records, in a lint parse, that the reference reports `message` where the log got a message since it had `msgs_len` of them.
    #[cold]
    #[inline(never)]
    fn code_syntax_error(
        &mut self,
        msgs_len: usize,
        message: Message,
        argument: &[u8],
        range: Range,
    ) {
        let Some(starts) = &mut self.starts_for_parse_only else {
            return;
        };
        if !starts.is_lint {
            return;
        }
        let mut errors = core::mem::take(&mut starts.syntax_errors);
        errors.record(self.log(), msgs_len, message, argument, range);
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.syntax_errors = errors;
        }
    }

    /// Starts the table of a lint parse. The errors that the log got since it had `orig_error_count` of them are its last messages.
    #[cold]
    pub(crate) fn start_syntax_errors(&mut self, orig_error_count: u32) {
        let log = self.log();
        let logged = log.errors.saturating_sub(orig_error_count) as usize;
        let first = log.msgs.len().saturating_sub(logged);
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.syntax_errors = SyntaxErrors::starting_at(first);
        }
    }

    /// Hands `errors` the entries of the messages that the lint parse, which failed, left in the log.
    #[cold]
    pub(crate) fn finish_syntax_errors(&mut self, errors: &mut SyntaxErrors) {
        if let Some(starts) = &mut self.starts_for_parse_only {
            *errors = core::mem::take(&mut starts.syntax_errors);
        }
        errors.finish(self.log(), self.lexer.contents);
    }

    /// `Lexer::unexpected`, where the reference reports `message` for the same token.
    #[cold]
    #[inline(never)]
    pub(crate) fn unexpected_as(&mut self, message: Message) -> Result<(), Error> {
        let msgs_len = self.log().msgs.len();
        self.lexer.unexpected()?;
        let range = self.lexer.range();
        self.code_syntax_error(msgs_len, message, b"", range);
        Ok(())
    }

    /// At a token that starts no type. True where a type is missing: parseEntityNameOfTypeReference reports Type_expected.
    #[cold]
    #[inline(never)]
    pub(crate) fn type_expected(&mut self, opts: SkipTypeOptionsBitset) -> Result<bool, Error> {
        if !self.is_lint_parse() {
            self.lexer.unexpected()?;
            return Ok(true);
        }
        // isListTerminator of PCTypeArguments: every token but "," ends the list, so `f<>()` misses no type
        if opts.contains(SkipTypeOptions::IsTypeArgument)
            && self.lexer.token != T::TComma
            && matches!(self.byte_before_token(), Some(b'<' | b','))
        {
            return Ok(false);
        }
        let msgs_len = self.log().msgs.len();
        if self.lexer.is_log_disabled {
            // typeHasArrowFunctionBlockingParseError: an arrow function whose return type is missing is none
            if opts.contains(SkipTypeOptions::IsReturnType)
                && self.lexer.token == T::TEqualsGreaterThan
                && matches!(self.byte_before_token(), Some(b':' | b'>'))
            {
                return Err(Error::Backtrack);
            }
            // The reference reports a missing type inside an attempt too, and keeps it if it keeps the attempt.
            self.log_unexpected_in_attempt();
        } else {
            self.lexer.unexpected()?;
        }
        let range = self.lexer.range();
        self.code_syntax_error(msgs_len, TYPE_EXPECTED, b"", range);
        Ok(true)
    }

    /// The last character of the token before the one the lexer is on: "<" or "," before an element of a list, ":" or "=>" before a return type.
    fn byte_before_token(&self) -> Option<u8> {
        let lexer = &self.lexer;
        let start = u32::try_from(lexer.start).unwrap_or(u32::MAX);
        let before = ts::full_start(lexer.contents, &lexer.all_comments, start) as usize;
        let last = before.checked_sub(1)?;
        lexer.contents.get(last).copied()
    }

    /// `Lexer::unexpected` for an attempt, which turns the log of the lexer off: what the attempt logs goes if the attempt does.
    fn log_unexpected_in_attempt(&mut self) {
        self.lexer.start = self.lexer.start.min(self.lexer.end);
        let range = self.lexer.range();
        if self.lexer.prev_error_loc.eql(range.loc) {
            return;
        }
        let lexer = &self.lexer;
        let found: &[u8] = if lexer.start >= lexer.contents.len() {
            b"end of file"
        } else {
            lexer.contents.get(lexer.start..lexer.end).unwrap_or(b"")
        };
        self.log().add_range_error_fmt(
            Some(self.source),
            range,
            format_args!("Unexpected {}", bstr::BStr::new(found)),
        );
        self.lexer.prev_error_loc = range.loc;
    }

    /// The expression that starts the statement at `loc` failed. Where its first token starts none, the reference asks for a statement.
    #[cold]
    #[inline(never)]
    pub(crate) fn statement_expected(
        &mut self,
        loc: Loc,
        is_in_list: bool,
        is_at_top_level: bool,
        err: Error,
    ) -> Error {
        if !is_in_list || self.lexer.start != usize::try_from(loc.start).unwrap_or(usize::MAX) {
            return err;
        }
        let (message, argument): (Message, &[u8]) = match self.lexer.token {
            // isStartOfExpression: a binary operator starts an expression whose left operand is missing
            T::TQuestionQuestion
            | T::TBarBar
            | T::TAmpersandAmpersand
            | T::TBar
            | T::TCaret
            | T::TAmpersand
            | T::TEqualsEquals
            | T::TExclamationEquals
            | T::TEqualsEqualsEquals
            | T::TExclamationEqualsEquals
            | T::TGreaterThan
            | T::TLessThanEquals
            | T::TGreaterThanEquals
            | T::TInstanceof
            | T::TIn
            | T::TLessThanLessThan
            | T::TGreaterThanGreaterThan
            | T::TGreaterThanGreaterThanGreaterThan
            | T::TAsterisk
            | T::TPercent
            | T::TAsteriskAsterisk => return err,
            // parsingContextErrors of PCSourceElements
            T::TDefault if is_at_top_level => (X_0_EXPECTED, b"export".as_slice()),
            // isStartOfStatement takes "catch" and "finally", and parseTryStatement expects "try"
            T::TCatch | T::TFinally => (X_0_EXPECTED, b"try".as_slice()),
            _ => (DECLARATION_OR_STATEMENT_EXPECTED, b"".as_slice()),
        };
        let start = self.lexer.start;
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts
                .syntax_errors
                .refine(start, EXPRESSION_EXPECTED, message, argument);
        }
        err
    }

    /// parseFunctionOrConstructorTypeToError: `node` is what a sink that builds read as an operand of "|" or "&". A function or constructor type there needs parentheses.
    #[cold]
    #[inline(never)]
    pub(crate) fn function_or_constructor_type_to_error(
        &mut self,
        node: Option<ts::Type>,
        is_union: bool,
    ) {
        let Some(node) = node else {
            return;
        };
        let message = match (node.data, is_union) {
            (ts::TypeData::Function(_), true) => {
                FUNCTION_TYPE_NOTATION_MUST_BE_PARENTHESIZED_WHEN_USED_IN_A_UNION_TYPE
            }
            (ts::TypeData::Function(_), false) => {
                FUNCTION_TYPE_NOTATION_MUST_BE_PARENTHESIZED_WHEN_USED_IN_AN_INTERSECTION_TYPE
            }
            (ts::TypeData::Constructor(_), true) => {
                CONSTRUCTOR_TYPE_NOTATION_MUST_BE_PARENTHESIZED_WHEN_USED_IN_A_UNION_TYPE
            }
            (ts::TypeData::Constructor(_), false) => {
                CONSTRUCTOR_TYPE_NOTATION_MUST_BE_PARENTHESIZED_WHEN_USED_IN_AN_INTERSECTION_TYPE
            }
            _ => return,
        };
        // The reference marks the node from the end of the token before it.
        let start = ts::full_start(self.lexer.contents, &self.lexer.all_comments, node.start);
        let range = ts::range(start, node.end);
        if self.lexer.prev_error_loc.eql(range.loc) {
            return;
        }
        let msgs_len = self.log().msgs.len();
        self.log()
            .add_range_error(Some(self.source), range, message.text);
        self.lexer.prev_error_loc = range.loc;
        self.code_syntax_error(msgs_len, message, b"", range);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defines::Define;
    use crate::parse::parse_entry::{Options, Parser};
    use bun_alloc::Arena;
    use bun_ast::{Loader, Source};

    /// The entry of the first message that the lint parse of `text` left, as code, start, end and text. `None`: it parses.
    fn first_error(
        path: &'static [u8],
        text: &'static [u8],
        loader: Loader,
    ) -> Option<(u32, u32, u32, Vec<u8>)> {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = Source::init_path_string(path, text);
        let mut options = Options::init(Default::default(), loader);
        options.features.no_macros = true;
        options.features.dont_bundle_twice = true;
        let define = Define::default();
        let mut log = Log::init();
        let mut errors = SyntaxErrors::default();
        let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
        if parser
            .parse_for_lint_with_codes(&mut errors, |_| ())
            .is_ok()
        {
            return None;
        }
        let first = log.msgs.iter().position(|msg| msg.kind == Kind::Err)?;
        let Some(entry) = errors.get(first) else {
            return Some((0, 0, 0, Vec::new()));
        };
        Some((entry.code, entry.start, entry.end, entry.text.to_vec()))
    }

    fn range(start: i32, len: i32) -> Range {
        Range {
            loc: Loc { start },
            len,
        }
    }

    #[test]
    fn a_message_takes_its_argument() {
        assert_eq!(&*X_0_EXPECTED.format(b";"), b"';' expected.");
        assert_eq!(&*TYPE_EXPECTED.format(b""), b"Type expected.");
        assert_eq!(
            &*IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE.format(b"class"),
            b"Identifier expected. 'class' is a reserved word that cannot be used here."
        );
    }

    #[test]
    fn the_text_of_the_lexer_says_what_it_expected() {
        let parts = split_expected(b"Expected \";\" but found \"x but found y\"");
        assert_eq!(parts, Some((&b"\";\""[..], &b"\"x but found y\""[..])));
        let parts = split_expected(b"Expected identifier but found end of file");
        assert_eq!(parts, Some((&b"identifier"[..], &b"end of file"[..])));
        assert_eq!(split_expected(b"Unexpected ;"), None);
        assert_eq!(unquote(b"\"=>\""), Some(&b"=>"[..]));
        assert_eq!(unquote(b"identifier"), None);
    }

    #[test]
    fn an_unterminated_string_ends_with_its_line() {
        assert_eq!(end_of_unterminated_string(b"x = \"abc", 4), 8);
        assert_eq!(end_of_unterminated_string(b"x = \"abc\ny", 4), 8);
        assert_eq!(end_of_unterminated_string(b"x = 'a\\\nb\nc", 4), 9);
        assert_eq!(end_of_unterminated_string(b"x = 'a\\", 4), 7);
    }

    #[test]
    fn a_record_goes_with_the_message_that_the_log_drops() {
        let source = Source::init_path_string(&b"/a.ts"[..], &b"let x: ;\nfunction () {}\n"[..]);
        let mut log = Log::init();
        let mut errors = SyntaxErrors::starting_at(0);

        // What an attempt logs and takes back.
        log.add_range_error(Some(&source), range(7, 1), b"Unexpected ;");
        errors.record(&log, 0, TYPE_EXPECTED, b"", range(7, 1));
        log.msgs.clear();
        log.errors = 0;

        // What stays: the lexer logged it and no site recorded it.
        log.add_range_error_fmt(
            Some(&source),
            range(18, 1),
            format_args!("Expected identifier but found \"{}\"", "("),
        );
        errors.finish(&log, source.contents());

        let expected = SyntaxError {
            msg: 0,
            code: 1003,
            start: 18,
            end: 19,
            text: Cow::Borrowed(b"Identifier expected."),
        };
        assert_eq!(errors.entries(), &[expected.clone()][..]);
        assert_eq!(errors.get(0), Some(&expected));
        assert_eq!(errors.get(1), None);
    }

    #[test]
    fn a_record_stays_with_the_message_that_the_log_keeps() {
        let source = Source::init_path_string(&b"/a.ts"[..], &b"let x: ;\n"[..]);
        let mut log = Log::init();
        let mut errors = SyntaxErrors::starting_at(0);

        log.add_range_error(Some(&source), range(7, 1), b"Unexpected ;");
        errors.record(&log, 0, EXPRESSION_EXPECTED, b"", range(7, 1));
        errors.refine(7, EXPRESSION_EXPECTED, X_0_EXPECTED, b"export");
        // A record for a message that was not logged is none.
        errors.record(&log, 1, TYPE_EXPECTED, b"", range(7, 1));
        // The parser sets the message aside and puts it back.
        let aside = log.msgs.split_off(0);
        log.msgs.extend(aside);
        errors.finish(&log, source.contents());

        let expected = SyntaxError {
            msg: 0,
            code: 1005,
            start: 7,
            end: 8,
            text: Cow::Borrowed(b"'export' expected."),
        };
        assert_eq!(errors.entries(), &[expected][..]);
    }

    #[test]
    fn a_syntax_error_of_a_lint_parse_has_the_code_of_the_reference() {
        let cases: [(&'static [u8], Loader, u32, u32, u32, &str); 19] = [
            (b"x = a ? b", Loader::Ts, 1005, 9, 9, "':' expected."),
            (b"f(1;", Loader::Ts, 1005, 3, 4, "')' expected."),
            (
                b"function (",
                Loader::Ts,
                1003,
                9,
                10,
                "Identifier expected.",
            ),
            (
                b"function class() {}",
                Loader::Ts,
                1359,
                9,
                14,
                "Identifier expected. 'class' is a reserved word that cannot be used here.",
            ),
            (
                b"x = \"abc",
                Loader::Ts,
                1002,
                8,
                8,
                "Unterminated string literal.",
            ),
            (
                b"x = `abc",
                Loader::Ts,
                1160,
                8,
                8,
                "Unterminated template literal.",
            ),
            (b"let x = ;", Loader::Ts, 1109, 8, 9, "Expression expected."),
            (b"let x = ;", Loader::Js, 1109, 8, 9, "Expression expected."),
            (b"x = 1 +", Loader::Ts, 1109, 7, 7, "Expression expected."),
            (b"if (x) )", Loader::Ts, 1109, 7, 8, "Expression expected."),
            (b"in x", Loader::Ts, 1109, 0, 2, "Expression expected."),
            (
                b")",
                Loader::Ts,
                1128,
                0,
                1,
                "Declaration or statement expected.",
            ),
            (
                b"{ ) }",
                Loader::Js,
                1128,
                2,
                3,
                "Declaration or statement expected.",
            ),
            (
                b"function f() { default }",
                Loader::Ts,
                1128,
                15,
                22,
                "Declaration or statement expected.",
            ),
            (b"default", Loader::Ts, 1005, 0, 7, "'export' expected."),
            (b"catch (e) {}", Loader::Ts, 1005, 0, 5, "'try' expected."),
            (b"let x: ;", Loader::Ts, 1110, 7, 8, "Type expected."),
            (
                b"function f(a: ) {}",
                Loader::Ts,
                1110,
                14,
                15,
                "Type expected.",
            ),
            (b"let x: A<;", Loader::Ts, 1005, 9, 10, "'>' expected."),
        ];
        for (text, loader, code, start, end, message) in cases {
            let path: &'static [u8] = if loader == Loader::Js {
                b"/a.js"
            } else {
                b"/a.ts"
            };
            assert_eq!(
                first_error(path, text, loader),
                Some((code, start, end, message.as_bytes().to_vec())),
                "{}",
                bstr::BStr::new(text)
            );
        }
    }

    #[test]
    fn a_lint_parse_rejects_what_an_attempt_lets_pass() {
        let cases: [(&'static [u8], u32, u32, u32, &str); 5] = [
            (b"let x: (a: ) => void", 1110, 11, 12, "Type expected."),
            (b"f<A | >(x)", 1110, 6, 7, "Type expected."),
            (b"f<,>;", 1110, 2, 3, "Type expected."),
            (b"new A<B | >()", 1110, 10, 11, "Type expected."),
            (b"let f = (a): => a", 1005, 11, 12, "';' expected."),
        ];
        for (text, code, start, end, message) in cases {
            assert_eq!(
                first_error(b"/a.ts", text, Loader::Ts),
                Some((code, start, end, message.as_bytes().to_vec())),
                "{}",
                bstr::BStr::new(text)
            );
        }
    }

    #[test]
    fn a_lint_parse_takes_what_the_reference_parses() {
        let cases: [&'static [u8]; 6] = [
            b"f<>()",
            b"new A<>()",
            b"f<A,>(x)",
            b"let y = a < b > (c)",
            b"let f = (a): (b) => c => a",
            b"class C { #y = 1; m(x: C) { let a: typeof x.#y; } }",
        ];
        for text in cases {
            assert_eq!(
                first_error(b"/a.ts", text, Loader::Ts),
                None,
                "{}",
                bstr::BStr::new(text)
            );
        }
    }
}

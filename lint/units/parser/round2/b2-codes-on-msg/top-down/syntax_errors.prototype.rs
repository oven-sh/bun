//! The diagnostics of typescript-go's parser and scanner for the syntax errors of a lint parse.

use std::borrow::Cow;

use bun_ast::ts;
use bun_ast::{Kind, Loc, Log, Metadata, Msg, Range};
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
/// `Property_or_signature_expected`
const PROPERTY_OR_SIGNATURE_EXPECTED: Message =
    Message::new(1131, b"Property or signature expected.");
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

/// The range and the text that the reference reports for one message that a lint parse left in the log: `Msg::code` is its number.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SyntaxError {
    /// The index of the message in `Log::msgs`.
    pub msg: u32,
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
            start: u32::try_from(start).ok()?,
            end: u32::try_from(end).ok()?,
            text: message.format(argument),
        })
    }
}

/// A record of a running parse, and what tells its message: the code that the record put on it, its offset and a hash of its text.
struct Recorded {
    error: SyntaxError,
    code: u32,
    at: usize,
    said: u64,
}

/// The offset of `msg` and a hash of its text.
fn place_of(msg: &Msg) -> (usize, u64) {
    let at = msg
        .data
        .location
        .as_ref()
        .map_or(usize::MAX, |location| location.offset);
    (at, bun_wyhash::hash(&msg.data.text))
}

/// The diagnostics of the reference for the messages that a lint parse left in the log.
#[derive(Default)]
pub struct SyntaxErrors {
    /// One entry for each message that has one, by rising `msg`. Empty while the parse runs.
    list: Vec<SyntaxError>,
    /// Every record of the running parse, oldest first: the parser drops and restores messages while it backtracks.
    recorded: Vec<Recorded>,
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

    /// The table of a lint parse whose first token failed: the lexer alone logged, from index `first` of `log` on, and its messages get their codes.
    pub(crate) fn of_first_token(log: &mut Log, first: usize, source: &[u8]) -> SyntaxErrors {
        let mut errors = SyntaxErrors::starting_at(first);
        errors.finish(log, source);
        errors
    }

    /// Puts the code of `message` on the message that `log` got since it had `msgs_len` of them, if it got one, and records the range and the text.
    fn record(
        &mut self,
        log: &mut Log,
        msgs_len: usize,
        message: Message,
        argument: &[u8],
        range: Range,
    ) {
        let Some(index) = log.msgs.len().checked_sub(1) else {
            return;
        };
        if index < msgs_len {
            return;
        }
        let Some(msg) = log.msgs.get_mut(index) else {
            return;
        };
        // Only an error has a diagnostic, and a resolve error keeps its metadata.
        if msg.kind != Kind::Err || matches!(msg.metadata, Metadata::Resolve(_)) {
            return;
        }
        let start = usize::try_from(range.loc.start).unwrap_or(0);
        let end = start + usize::try_from(range.len).unwrap_or(0);
        let Some(error) = SyntaxError::new(index, message, argument, start, end) else {
            return;
        };
        msg.metadata = Metadata::Code(message.code);
        let (at, said) = place_of(msg);
        self.recorded.push(Recorded {
            error,
            code: message.code,
            at,
            said,
        });
    }

    /// Replaces the last record with `to`, on its message too, if it is `from` at `start` and `log` still has its message.
    fn refine(&mut self, log: &mut Log, start: usize, from: Message, to: Message, argument: &[u8]) {
        let Some(last) = self.recorded.last_mut() else {
            return;
        };
        let Some(msg) = log.msgs.get_mut(last.error.msg as usize) else {
            return;
        };
        if last.code != from.code || last.error.start as usize != start || !last.is_of(msg) {
            return;
        }
        last.code = to.code;
        last.error.text = to.format(argument);
        msg.metadata = Metadata::Code(to.code);
    }

    /// Ends the parse: the last record of each message that `log` still has, a code and an entry where the text of the lexer tells them, and for any other message with a code its own range and text.
    fn finish(&mut self, log: &mut Log, source: &[u8]) {
        let first = self.first;
        let count = log.msgs.len().saturating_sub(first);
        let mut slots: Vec<Option<SyntaxError>> = Vec::new();
        slots.resize_with(count, || None);
        for record in core::mem::take(&mut self.recorded) {
            let index = record.error.msg as usize;
            if !log.msgs.get(index).is_some_and(|msg| record.is_of(msg)) {
                continue;
            }
            let slot = index
                .checked_sub(first)
                .and_then(|offset| slots.get_mut(offset));
            if let Some(slot) = slot {
                *slot = Some(record.error);
            }
        }
        self.list.clear();
        for (offset, slot) in slots.into_iter().enumerate() {
            let index = first + offset;
            if let Some(entry) = slot {
                self.list.push(entry);
                continue;
            }
            let Some(msg) = log.msgs.get_mut(index) else {
                continue;
            };
            if let Some((code, entry)) = of_lexer_message(index, msg, source) {
                msg.metadata = Metadata::Code(code);
                self.list.push(entry);
            } else if let Some(entry) = of_own_text(index, msg) {
                self.list.push(entry);
            }
        }
    }
}

impl Recorded {
    /// Whether `msg` is the message that the record was made for, or one that says the same at the same place.
    fn is_of(&self, msg: &Msg) -> bool {
        msg.code() == Some(self.code) && place_of(msg) == (self.at, self.said)
    }
}

/// The entry of a message with a code that no record is for: `P::lint_error` logged it with the range and the text of the reference.
fn of_own_text(index: usize, msg: &Msg) -> Option<SyntaxError> {
    msg.code()?;
    let location = msg.data.location.as_ref()?;
    Some(SyntaxError {
        msg: u32::try_from(index).ok()?,
        start: u32::try_from(location.offset).ok()?,
        end: u32::try_from(location.offset + location.length).ok()?,
        text: msg.data.text.clone(),
    })
}

/// The code and the entry of a message of the lexer that no site recorded, read from its text: `Lexer::expected_string` says what it expected.
fn of_lexer_message(index: usize, msg: &Msg, source: &[u8]) -> Option<(u32, SyntaxError)> {
    if msg.kind != Kind::Err || matches!(msg.metadata, Metadata::Resolve(_)) {
        return None;
    }
    let location = msg.data.location.as_ref()?;
    let start = location.offset;
    let end = start + location.length;
    let text: &[u8] = &msg.data.text;
    let (message, argument, start, end): (Message, &[u8], usize, usize) =
        if text == b"Unterminated string literal" {
            // The scanner of the reference reports where the line or the file ends.
            match source.get(start) {
                Some(b'"' | b'\'') => {
                    let at = end_of_unterminated_string(source, start);
                    (UNTERMINATED_STRING_LITERAL, b"".as_slice(), at, at)
                }
                Some(b'`' | b'}') => {
                    let at = source.len();
                    (UNTERMINATED_TEMPLATE_LITERAL, b"".as_slice(), at, at)
                }
                _ => return None,
            }
        } else if text == b"Expected \"*/\" to terminate multi-line comment" {
            (ASTERISK_SLASH_EXPECTED, b"".as_slice(), start, end)
        } else {
            let (expected, found) = split_expected(text)?;
            if expected == b"identifier" {
                // createIdentifierWithDiagnostic
                match unquote(found).filter(|word| js_lexer::keyword(word).is_some()) {
                    Some(word) => (
                        IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE,
                        word,
                        start,
                        end,
                    ),
                    None => (IDENTIFIER_EXPECTED, b"".as_slice(), start, end),
                }
            } else {
                // parseExpected
                (X_0_EXPECTED, unquote(expected)?, start, end)
            }
        };
    let entry = SyntaxError::new(index, message, argument, start, end)?;
    Some((message.code, entry))
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
    /// Puts, in a lint parse, the code of `message` on the message that the log got since it had `msgs_len` of them, and records what the reference reports there.
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

    /// At a token that starts no type, where parseEntityNameOfTypeReference reports Type_expected. False where a sink that builds goes on: a list of type arguments ends here, or an attempt runs.
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
        let is_in_attempt = self.lexer.is_log_disabled;
        if is_in_attempt {
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
        Ok(!is_in_attempt)
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

    /// isListElement of PCTypeMembers: whether a member of an object type starts at the token the lexer is on.
    pub(crate) fn is_start_of_type_member(&mut self) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let is_start = self.scan_type_member_start().unwrap_or(false);
        self.lexer.restore(&old_lexer);
        is_start
    }

    /// scanTypeMemberStart
    fn scan_type_member_start(&mut self) -> Result<bool, Error> {
        if matches!(self.lexer.token, T::TOpenParen | T::TLessThan)
            || self.lexer.is_contextual_keyword(b"get")
            || self.lexer.is_contextual_keyword(b"set")
        {
            return Ok(true);
        }
        let mut is_id_token = false;
        // Every modifier is passed: the last one may be the name of the member.
        while self.is_token_of_modifier() {
            is_id_token = true;
            self.lexer.next()?;
        }
        if self.lexer.token == T::TOpenBracket {
            return Ok(true);
        }
        // isLiteralPropertyName, which takes a private name
        if self.lexer.is_identifier_or_keyword()
            || matches!(
                self.lexer.token,
                T::TPrivateIdentifier
                    | T::TStringLiteral
                    | T::TNumericLiteral
                    | T::TBigIntegerLiteral
            )
        {
            is_id_token = true;
            self.lexer.next()?;
        }
        // canParseSemicolon: ";", "}", the end of the file or a line break
        Ok(is_id_token
            && (self.lexer.has_newline_before
                || matches!(
                    self.lexer.token,
                    T::TOpenParen
                        | T::TLessThan
                        | T::TQuestion
                        | T::TColon
                        | T::TComma
                        | T::TSemicolon
                        | T::TCloseBrace
                        | T::TEndOfFile
                )))
    }

    /// IsModifierKind for the token the lexer is on.
    fn is_token_of_modifier(&self) -> bool {
        match self.lexer.token {
            T::TConst | T::TDefault | T::TExport | T::TIn => true,
            T::TIdentifier => matches!(
                self.lexer.raw(),
                b"abstract"
                    | b"accessor"
                    | b"async"
                    | b"declare"
                    | b"out"
                    | b"override"
                    | b"private"
                    | b"protected"
                    | b"public"
                    | b"readonly"
                    | b"static"
            ),
            _ => false,
        }
    }

    /// parsingContextErrors of PCTypeMembers: the token the lexer is on starts no member of an object type.
    #[cold]
    pub(crate) fn property_or_signature_expected(&mut self) -> Error {
        match self.unexpected_as(PROPERTY_OR_SIGNATURE_EXPECTED) {
            Ok(()) => Error::SyntaxError,
            Err(err) => err,
        }
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
        if let Some(starts) = &mut self.starts_for_parse_only
            && starts.is_lint
        {
            let mut errors = core::mem::take(&mut starts.syntax_errors);
            errors.refine(self.log(), start, EXPRESSION_EXPECTED, message, argument);
            if let Some(starts) = &mut self.starts_for_parse_only {
                starts.syntax_errors = errors;
            }
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
        self.lint_error(ts::range(start, node.end), message, b"");
    }

    /// Logs, in a lint parse only, the diagnostic `message` of the reference at `range`, `argument` in its text, past the lexer. True in a lint parse: an error is in the log at `range`.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_error(&mut self, range: Range, message: Message, argument: &[u8]) -> bool {
        if !self.is_lint_parse() {
            return false;
        }
        // One error for one place, as the lexer reports.
        if self.lexer.prev_error_loc.eql(range.loc) {
            return true;
        }
        self.log().add_range_error_with_code(
            Some(self.source),
            range,
            message.code,
            message.format(argument),
            Box::default(),
        );
        self.lexer.prev_error_loc = range.loc;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defines::Define;
    use crate::parse::parse_entry::{Options, Parser};
    use crate::parser::{ParseStatementOptions, StatementScope};
    use bun_alloc::Arena;
    use bun_ast::{Loader, Source};
    use core::mem::MaybeUninit;

    /// How a test makes the parser of a lint parse.
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Init {
        /// `Parser::init_for_lint`
        ForLint,
        /// `Parser::init`
        Plain,
    }

    fn options_of(loader: Loader) -> Options<'static> {
        let mut options = Options::init(Default::default(), loader);
        options.features.no_macros = true;
        options.features.dont_bundle_twice = true;
        options
    }

    /// The first error that the lint parse of `text` left: the code on its message, and the start, the end and the text of its entry. `None`: it parses.
    fn first_error_after(
        init: Init,
        path: &'static [u8],
        text: &'static [u8],
        loader: Loader,
    ) -> Option<(u32, u32, u32, Vec<u8>)> {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = Source::init_path_string(path, text);
        let define = Define::default();
        let mut log = Log::init();
        let mut errors = SyntaxErrors::default();
        let options = options_of(loader);
        let parser = match init {
            Init::ForLint => Parser::init_for_lint_with_codes(
                options,
                &mut log,
                &source,
                &define,
                &arena,
                &mut errors,
            ),
            // `Parser::init` puts no code on what the lexer logged.
            Init::Plain => Parser::init(options, &mut log, &source, &define, &arena),
        };
        if let Ok(parser) = parser
            && parser
                .parse_for_lint_with_codes(&mut errors, |_| ())
                .is_ok()
        {
            return None;
        }
        // A message has an entry where it has a code, and nowhere else.
        for (index, msg) in log.msgs.iter().enumerate() {
            assert_eq!(
                msg.code().is_some(),
                errors.get(index).is_some(),
                "{}",
                bstr::BStr::new(text)
            );
        }
        let first = log.msgs.iter().position(|msg| msg.kind == Kind::Err)?;
        let code = log.msgs.get(first).and_then(Msg::code).unwrap_or(0);
        let Some(entry) = errors.get(first) else {
            return Some((code, 0, 0, Vec::new()));
        };
        Some((code, entry.start, entry.end, entry.text.to_vec()))
    }

    fn first_error(
        path: &'static [u8],
        text: &'static [u8],
        loader: Loader,
    ) -> Option<(u32, u32, u32, Vec<u8>)> {
        first_error_after(Init::ForLint, path, text, loader)
    }

    /// The code of each message that the parse pass of a parse without lint leaves for `text`, which has no side table.
    fn codes_without_lint<const TS: bool>(text: &'static [u8]) -> Vec<Option<u32>> {
        let path: &'static [u8] = if TS { b"/a.ts" } else { b"/a.js" };
        let loader = if TS { Loader::Ts } else { Loader::Js };
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = Source::init_path_string(path, text);
        let define = Define::default();
        let mut log = Log::init();
        if let Ok(parser) = Parser::init(options_of(loader), &mut log, &source, &define, &arena) {
            let mut slot = MaybeUninit::<P<'_, TS, false>>::uninit();
            let made = P::init(
                &mut slot,
                parser.bump,
                parser.log,
                parser.source,
                parser.define,
                parser.lexer,
                parser.options,
            );
            if made.is_ok() {
                // SAFETY: `init` returned `Ok`, so the slot holds a parser.
                let p = unsafe { slot.assume_init_mut() };
                let mut opts = ParseStatementOptions {
                    scope: StatementScope::Module,
                    ..Default::default()
                };
                let _ = p.parse_stmts_up_to(T::TEndOfFile, &mut opts);
                // SAFETY: the slot holds the parser that `init` made, and nothing reads it after this.
                unsafe { slot.assume_init_drop() };
            }
        }
        log.msgs.iter().map(Msg::code).collect()
    }

    /// The code of each message that `Parser::init_for_lint` leaves for `text` where it fails. Empty: it made a parser.
    fn codes_of_init_for_lint(text: &'static [u8], loader: Loader) -> Vec<Option<u32>> {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = Source::init_path_string(&b"/a.ts"[..], text);
        let define = Define::default();
        let mut log = Log::init();
        if Parser::init_for_lint(options_of(loader), &mut log, &source, &define, &arena).is_ok() {
            return Vec::new();
        }
        log.msgs.iter().map(Msg::code).collect()
    }

    /// The code of each message that `Parser::parse_only` leaves for `text`: its side table is not the one of a lint parse.
    fn codes_of_parse_only(text: &'static [u8]) -> Vec<Option<u32>> {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = Source::init_path_string(&b"/a.js"[..], text);
        let define = Define::default();
        let mut log = Log::init();
        if let Ok(parser) = Parser::init(options_of(Loader::Js), &mut log, &source, &define, &arena)
        {
            let _ = parser.parse_only(|_| ());
        }
        log.msgs.iter().map(Msg::code).collect()
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
        errors.record(&mut log, 0, TYPE_EXPECTED, b"", range(7, 1));
        assert_eq!(log.msgs.first().and_then(Msg::code), Some(1110));
        log.msgs.clear();
        log.errors = 0;

        // What stays: the lexer logged it and no site recorded it.
        log.add_range_error_fmt(
            Some(&source),
            range(18, 1),
            format_args!("Expected identifier but found \"{}\"", "("),
        );
        errors.finish(&mut log, source.contents());

        let expected = SyntaxError {
            msg: 0,
            start: 18,
            end: 19,
            text: Cow::Borrowed(b"Identifier expected."),
        };
        assert_eq!(log.msgs.first().and_then(Msg::code), Some(1003));
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
        errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", range(7, 1));
        errors.refine(&mut log, 7, EXPRESSION_EXPECTED, X_0_EXPECTED, b"export");
        // A record for a message that was not logged is none.
        errors.record(&mut log, 1, TYPE_EXPECTED, b"", range(7, 1));
        // The parser sets the message aside and puts it back.
        let aside = log.msgs.split_off(0);
        log.msgs.extend(aside);
        errors.finish(&mut log, source.contents());

        let expected = SyntaxError {
            msg: 0,
            start: 7,
            end: 8,
            text: Cow::Borrowed(b"'export' expected."),
        };
        assert_eq!(log.msgs.first().and_then(Msg::code), Some(1005));
        assert_eq!(errors.entries(), &[expected][..]);
    }

    #[test]
    fn a_message_set_aside_and_put_back_keeps_its_code() {
        let source = Source::init_path_string(&b"/a.ts"[..], &b"let x: ;\n"[..]);
        let mut log = Log::init();
        let mut errors = SyntaxErrors::starting_at(0);

        log.add_range_error(Some(&source), range(7, 1), b"Unexpected ;");
        errors.record(&mut log, 0, TYPE_EXPECTED, b"", range(7, 1));
        // Another reading of the same tokens logs the same text at the same index and is recorded with another code.
        let aside = log.msgs.split_off(0);
        log.add_range_error(Some(&source), range(7, 1), b"Unexpected ;");
        errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", range(7, 1));
        assert_eq!(log.msgs.first().and_then(Msg::code), Some(1109));
        // It fails too: its message goes and the first one comes back.
        log.msgs.clear();
        log.msgs.extend(aside);
        errors.finish(&mut log, source.contents());

        let expected = SyntaxError {
            msg: 0,
            start: 7,
            end: 8,
            text: Cow::Borrowed(b"Type expected."),
        };
        assert_eq!(log.msgs.first().and_then(Msg::code), Some(1110));
        assert_eq!(errors.entries(), &[expected][..]);
    }

    #[test]
    fn a_message_that_no_site_recorded_takes_no_code_of_a_record() {
        let source = Source::init_path_string(&b"/a.ts"[..], &b"let x: ;\n"[..]);
        let mut log = Log::init();
        let mut errors = SyntaxErrors::starting_at(0);

        log.add_range_error(Some(&source), range(7, 1), b"Unexpected ;");
        errors.record(&mut log, 0, TYPE_EXPECTED, b"", range(7, 1));
        log.msgs.clear();
        // The same text at the same index, logged where no site records.
        log.add_range_error(Some(&source), range(7, 1), b"Unexpected ;");
        errors.finish(&mut log, source.contents());

        assert_eq!(log.msgs.first().and_then(Msg::code), None);
        assert_eq!(errors.entries(), &[][..]);
    }

    #[test]
    fn an_error_in_the_first_token_has_its_code() {
        let cases: [(&'static [u8], Loader, u32, u32, u32, &str); 5] = [
            (
                b"\"abc",
                Loader::Ts,
                1002,
                4,
                4,
                "Unterminated string literal.",
            ),
            (
                b"'abc\n x",
                Loader::Ts,
                1002,
                4,
                4,
                "Unterminated string literal.",
            ),
            (
                b"`abc ",
                Loader::Ts,
                1160,
                5,
                5,
                "Unterminated template literal.",
            ),
            (b"/* abc", Loader::Ts, 1010, 6, 6, "'*/' expected."),
            (b"// c\n/* abc", Loader::Js, 1010, 11, 11, "'*/' expected."),
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
            // After `Parser::init` the message of the lexer is as it was.
            assert_eq!(
                first_error_after(Init::Plain, path, text, loader),
                Some((0, 0, 0, Vec::new())),
                "{}",
                bstr::BStr::new(text)
            );
            let codes = if loader == Loader::Js {
                codes_without_lint::<false>(text)
            } else {
                codes_without_lint::<true>(text)
            };
            assert_eq!(codes, [None], "{}", bstr::BStr::new(text));
            assert_eq!(
                codes_of_init_for_lint(text, loader),
                [Some(code)],
                "{}",
                bstr::BStr::new(text)
            );
        }
    }

    #[test]
    fn a_message_with_a_code_and_no_record_is_its_own_entry() {
        let source = Source::init_path_string(&b"/a.ts"[..], &b"a + b = c;\n"[..]);
        let mut log = Log::init();
        let mut errors = SyntaxErrors::starting_at(0);

        // What `P::lint_error` logs: the text and the range of the reference.
        log.add_range_error_with_code(
            Some(&source),
            range(6, 1),
            X_0_EXPECTED.code,
            X_0_EXPECTED.format(b";"),
            Box::default(),
        );
        errors.finish(&mut log, source.contents());

        let expected = SyntaxError {
            msg: 0,
            start: 6,
            end: 7,
            text: Cow::Owned(b"';' expected.".to_vec()),
        };
        assert_eq!(log.msgs.first().and_then(Msg::code), Some(1005));
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
            let expected = Some((code, start, end, message.as_bytes().to_vec()));
            assert_eq!(
                first_error(path, text, loader),
                expected,
                "{}",
                bstr::BStr::new(text)
            );
            // A parser that `Parser::init` made parses for lint all the same.
            assert_eq!(
                first_error_after(Init::Plain, path, text, loader),
                expected,
                "{}",
                bstr::BStr::new(text)
            );
            // A parse without lint rejects the source too, and none of its messages has a code.
            let codes = if loader == Loader::Js {
                codes_without_lint::<false>(text)
            } else {
                codes_without_lint::<true>(text)
            };
            assert!(!codes.is_empty(), "{}", bstr::BStr::new(text));
            assert!(
                codes.iter().all(Option::is_none),
                "{}",
                bstr::BStr::new(text)
            );
            if loader == Loader::Js {
                let codes = codes_of_parse_only(text);
                assert!(!codes.is_empty(), "{}", bstr::BStr::new(text));
                assert!(
                    codes.iter().all(Option::is_none),
                    "{}",
                    bstr::BStr::new(text)
                );
            }
        }
    }

    #[test]
    fn a_message_that_the_parser_sets_aside_and_puts_back_has_its_code() {
        // The type in parentheses fails at "|", the reading as a function type fails at "&", and the first error stays.
        assert_eq!(
            first_error(b"/a.ts", b"let x: (A & | B);", Loader::Ts),
            Some((1110, 12, 13, b"Type expected.".to_vec()))
        );
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
    fn a_type_that_is_built_is_read_as_the_reference_reads_it() {
        let cases: [(&'static [u8], u32, u32, u32, &str); 7] = [
            (
                b"x as A | () => void;",
                1385,
                8,
                19,
                "Function type notation must be parenthesized when used in a union type.",
            ),
            (
                b"x as | () => void;",
                1385,
                6,
                17,
                "Function type notation must be parenthesized when used in a union type.",
            ),
            (
                b"x as A & new () => B;",
                1388,
                8,
                20,
                "Constructor type notation must be parenthesized when used in an intersection type.",
            ),
            (b"x as A & | B;", 1110, 9, 10, "Type expected."),
            (b"x as { a: };", 1110, 10, 11, "Type expected."),
            (
                b"x as { a A };",
                1131,
                7,
                8,
                "Property or signature expected.",
            ),
            (
                b"x as { a: string b: number };",
                1005,
                17,
                18,
                "';' expected.",
            ),
        ];
        for (text, code, start, end, message) in cases {
            assert_eq!(
                first_error(b"/a.ts", text, Loader::Ts),
                Some((code, start, end, message.as_bytes().to_vec())),
                "{}",
                bstr::BStr::new(text)
            );
        }
        let parsed: [&'static [u8]; 4] = [
            b"x as A<>;",
            b"x as A<B,>;",
            b"x as A | (() => void);",
            b"x as { readonly a: string; b?(): void; [k: string]: unknown; new (): A; get c(): number };",
        ];
        for text in parsed {
            assert_eq!(
                first_error(b"/a.ts", text, Loader::Ts),
                None,
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

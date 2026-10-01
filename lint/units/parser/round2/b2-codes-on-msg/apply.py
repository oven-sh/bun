#!/usr/bin/env python3
"""Applies the prototype of "the code on the message" to a COPY of src/js_parser (never to the worktree).
usage: apply.py <copy of src/js_parser>
Every replacement must match exactly once: the script stops where the copy is not be1ebe5295."""
import sys, pathlib

root = pathlib.Path(sys.argv[1])

def patch(path, pairs):
    p = root / path
    s = p.read_text()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            sys.exit(f"{path}: {n} matches for:\n{old[:200]}")
        s = s.replace(old, new)
    p.write_text(s)

SE = "parse/syntax_errors.rs"
patch(SE, [
# imports
("use bun_ast::{Kind, Loc, Log, Msg, Range};", "use bun_ast::{Kind, Loc, Log, Metadata, Msg, Range};"),
# the entry, the records and the table
('''/// What the reference reports for one message that a lint parse left in the log.
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
''',
'''/// The range and the text that the reference has for one message with a code that a lint parse left in the log.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SyntaxError {
    /// The index of the message in `Log::msgs`: `Msg::code` of that message is the number of the diagnostic.
    pub msg: u32,
    /// The offset of the first byte that the diagnostic marks.
    pub start: u32,
    /// The offset after the last byte that it marks: `start` where it marks a position.
    pub end: u32,
    /// The text of the diagnostic, its argument filled in.
    pub text: Cow<'static, [u8]>,
}

impl SyntaxError {
    fn new(msg: usize, start: usize, end: usize, text: Cow<'static, [u8]>) -> Option<Self> {
        Some(SyntaxError {
            msg: u32::try_from(msg).ok()?,
            start: u32::try_from(start).ok()?,
            end: u32::try_from(end).ok()?,
            text,
        })
    }
}

/// The range and the text of the reference for a message that a site gave a code.
struct Reference {
    start: usize,
    end: usize,
    text: Cow<'static, [u8]>,
}

/// What a message with a code carries in the log: the code, its range and its text.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Coded {
    code: u32,
    offset: usize,
    length: usize,
    said: u64,
}

impl Coded {
    /// `None`: `msg` has no code or no place.
    fn of(msg: &Msg) -> Option<Coded> {
        let code = msg.code()?;
        let location = msg.data.location.as_ref()?;
        Some(Coded {
            code,
            offset: location.offset,
            length: location.length,
            said: bun_wyhash::hash(&msg.data.text),
        })
    }
}

/// The range and the text of the reference for each message with a code that a lint parse left in the log.
#[derive(Default)]
pub struct SyntaxErrors {
    /// One entry for each message with a code, by rising `msg`. Empty while the parse runs.
    list: Vec<SyntaxError>,
    /// What the reference reports for the messages that a site gave a code, dropped ones too: a message finds its record by what it carries.
    recorded: bun_collections::HashMap<Coded, Reference>,
    /// The index in the log of the first message of the parse.
    first: usize,
}
'''),
# record, refine, finish
('''    /// Records `message` for the message that `log` got since it had `msgs_len` of them, if it got one.
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
            Some(b'"' | b'\\'') => {
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
    if text == b"Expected \\"*/\\" to terminate multi-line comment" {
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
''',
'''    /// Gives the message that `log` got since it had `msgs_len` of them the code of `message`, and keeps the range and the text of the reference for it.
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
        let before = msg.metadata;
        msg.metadata = Metadata::Code(message.code);
        let Some(coded) = Coded::of(msg) else {
            msg.metadata = before;
            return;
        };
        let start = usize::try_from(range.loc.start).unwrap_or(0);
        let end = start + usize::try_from(range.len).unwrap_or(0);
        let text = message.format(argument);
        self.recorded.insert(coded, Reference { start, end, text });
    }

    /// Gives the last message of `log` the diagnostic `to` where a site gave it `from` at `start`.
    fn refine(
        &mut self,
        log: &mut Log,
        start: usize,
        from: Message,
        to: Message,
        argument: &[u8],
    ) {
        let Some(msg) = log.msgs.last_mut() else {
            return;
        };
        let Some(coded) = Coded::of(msg) else {
            return;
        };
        if coded.code != from.code || coded.offset != start {
            return;
        }
        let Some(reference) = self.recorded.get(&coded) else {
            return;
        };
        let reference = Reference {
            start: reference.start,
            end: reference.end,
            text: to.format(argument),
        };
        msg.metadata = Metadata::Code(to.code);
        let coded = Coded {
            code: to.code,
            ..coded
        };
        self.recorded.insert(coded, reference);
    }

    /// Ends the parse: an entry for each message of the parse with a code, and a code and an entry for each that the lexer logged in words the reference has a diagnostic for.
    fn finish(&mut self, log: &mut Log, source: &[u8]) {
        let recorded = core::mem::take(&mut self.recorded);
        self.list.clear();
        for (index, msg) in log.msgs.iter_mut().enumerate().skip(self.first) {
            let entry = match msg.metadata {
                Metadata::Code(_) => match Coded::of(msg).and_then(|coded| recorded.get(&coded)) {
                    Some(reference) => SyntaxError::new(
                        index,
                        reference.start,
                        reference.end,
                        reference.text.clone(),
                    ),
                    // `P::lint_error` logged it in the words of the reference.
                    None => of_own_text(index, msg),
                },
                Metadata::Build => of_lexer_message(msg, source).and_then(|(code, reference)| {
                    let entry =
                        SyntaxError::new(index, reference.start, reference.end, reference.text)?;
                    msg.metadata = Metadata::Code(code);
                    Some(entry)
                }),
                Metadata::Resolve(_) => None,
            };
            if let Some(entry) = entry {
                self.list.push(entry);
            }
        }
    }

    /// The table of a lint parse whose first token failed: the lexer alone logged, from index `first` of `log` on.
    pub(crate) fn of_first_token(log: &mut Log, first: usize, source: &[u8]) -> SyntaxErrors {
        let mut errors = SyntaxErrors::starting_at(first);
        errors.finish(log, source);
        errors
    }
}

/// The entry of a message that says what the reference says: its own range and text.
fn of_own_text(index: usize, msg: &Msg) -> Option<SyntaxError> {
    let location = msg.data.location.as_ref()?;
    let start = location.offset;
    SyntaxError::new(index, start, start + location.length, msg.data.text.clone())
}

/// The code of `message`, and its text with `argument` for the range from `start` to `end`.
fn diagnostic(message: Message, argument: &[u8], start: usize, end: usize) -> (u32, Reference) {
    let text = message.format(argument);
    (message.code, Reference { start, end, text })
}

/// The diagnostic of a message of the lexer that no site gave a code, read from its text: `Lexer::expected_string` says what it expected.
fn of_lexer_message(msg: &Msg, source: &[u8]) -> Option<(u32, Reference)> {
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
            Some(b'"' | b'\\'') => {
                let at = end_of_unterminated_string(source, start);
                Some(diagnostic(UNTERMINATED_STRING_LITERAL, b"", at, at))
            }
            Some(b'`' | b'}') => {
                let at = source.len();
                Some(diagnostic(UNTERMINATED_TEMPLATE_LITERAL, b"", at, at))
            }
            _ => None,
        };
    }
    if text == b"Expected \\"*/\\" to terminate multi-line comment" {
        return Some(diagnostic(ASTERISK_SLASH_EXPECTED, b"", start, end));
    }
    let (expected, found) = split_expected(text)?;
    if expected == b"identifier" {
        // createIdentifierWithDiagnostic
        return match unquote(found).filter(|word| js_lexer::keyword(word).is_some()) {
            Some(word) => Some(diagnostic(
                IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE,
                word,
                start,
                end,
            )),
            None => Some(diagnostic(IDENTIFIER_EXPECTED, b"", start, end)),
        };
    }
    // parseExpected
    let token = unquote(expected)?;
    Some(diagnostic(X_0_EXPECTED, token, start, end))
}
'''),
# the helper for a new error, after unexpected_as
('''    /// `Lexer::unexpected`, where the reference reports `message` for the same token.
    #[cold]
    #[inline(never)]
    pub(crate) fn unexpected_as(&mut self, message: Message) -> Result<(), Error> {
        let msgs_len = self.log().msgs.len();
        self.lexer.unexpected()?;
        let range = self.lexer.range();
        self.code_syntax_error(msgs_len, message, b"", range);
        Ok(())
    }
''',
'''    /// `Lexer::unexpected`, where the reference reports `message` for the same token.
    #[cold]
    #[inline(never)]
    pub(crate) fn unexpected_as(&mut self, message: Message) -> Result<(), Error> {
        let msgs_len = self.log().msgs.len();
        self.lexer.unexpected()?;
        let range = self.lexer.range();
        self.code_syntax_error(msgs_len, message, b"", range);
        Ok(())
    }

    /// Logs, in a lint parse only, the diagnostic `message` of the reference at `range`, past the lexer. True in a lint parse: an error is in the log at `range`.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_error(&mut self, range: Range, message: Message, argument: &[u8]) -> bool {
        if !self.is_lint_parse() {
            return false;
        }
        // As the lexer: one error for one place.
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
'''),
# statement_expected
('''        let start = self.lexer.start;
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts
                .syntax_errors
                .refine(start, EXPRESSION_EXPECTED, message, argument);
        }
        err
''',
'''        let start = self.lexer.start;
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
'''),
# function_or_constructor_type_to_error
('''        let range = ts::range(start, node.end);
        if self.lexer.prev_error_loc.eql(range.loc) {
            return;
        }
        let msgs_len = self.log().msgs.len();
        self.log()
            .add_range_error(Some(self.source), range, message.text);
        self.lexer.prev_error_loc = range.loc;
        self.code_syntax_error(msgs_len, message, b"", range);
    }
''',
'''        let range = ts::range(start, node.end);
        self.lint_error(range, message, b"");
    }
'''),
])

PE = "parse/parse_entry.rs"
patch(PE, [
('''        let log_ptr = lexer.log;
        Ok(Parser {
            options,
            bump,
            lexer,
            define,
            source,
            log: log_ptr,
            orig_error_count,
        })
    }
}

// ── live `Parser::parse` / `Parser::scan_imports` symbols ────────────────
''',
'''        let log_ptr = lexer.log;
        Ok(Parser {
            options,
            bump,
            lexer,
            define,
            source,
            log: log_ptr,
            orig_error_count,
        })
    }

    /// `init` for a lint parse: the comments before the first token are kept, and a first token that fails has the code of the reference.
    #[cold]
    pub fn init_for_lint(
        options: Options<'a>,
        log: &mut bun_ast::Log,
        source: &'a bun_ast::Source,
        define: &'a Define,
        bump: &'a Arena,
    ) -> Result<Parser<'a>, Error> {
        let mut errors = SyntaxErrors::default();
        Self::init_for_lint_with_codes(options, log, source, define, bump, &mut errors)
    }

    /// `init_for_lint`. Where the first token fails, `errors` gets the range and the text of the reference for the messages that it logged.
    #[cold]
    pub fn init_for_lint_with_codes(
        options: Options<'a>,
        log: &mut bun_ast::Log,
        source: &'a bun_ast::Source,
        define: &'a Define,
        bump: &'a Arena,
        errors: &mut SyntaxErrors,
    ) -> Result<Parser<'a>, Error> {
        source.check_parseable_len(log, "File")?;
        let orig_error_count = log.errors;
        let first = log.msgs.len();
        let mut lexer = js_lexer::Lexer::init_without_reading(log, source, bump);
        // Set before the first token is read: the comments in front of it are kept.
        lexer.track_comments = true;
        lexer.track_react_suppressions = options.features.react_compiler.is_enabled();
        lexer.jsc_builtin_syntax = options.jsc_builtin_syntax;
        lexer.step();
        if let Err(err) = lexer.next() {
            *errors = SyntaxErrors::of_first_token(lexer.log(), first, source.contents());
            return Err(err.into());
        }
        let log_ptr = lexer.log;
        Ok(Parser {
            options,
            bump,
            lexer,
            define,
            source,
            log: log_ptr,
            orig_error_count,
        })
    }
}

// ── live `Parser::parse` / `Parser::scan_imports` symbols ────────────────
'''),
('''    /// `parse_for_lint`. Where the parse fails, `errors` gets what the reference reports for the messages that it logged.
    #[cold]
    pub fn parse_for_lint_with_codes<R>(''',
'''    /// `parse_for_lint`. Where the parse fails, its messages have their codes either way, and `errors` gets the range and the text of the reference for each.
    #[cold]
    pub fn parse_for_lint_with_codes<R>('''),
('''                // The codes of the reference for what the parse logged go to the caller.
                p.finish_syntax_errors(errors);''',
'''                // The messages get the codes of the reference, and the caller its ranges and texts.
                p.finish_syntax_errors(errors);'''),
])
print("patched", root)

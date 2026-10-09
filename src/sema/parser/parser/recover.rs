//! Going on after a syntax error, as TypeScript's parser does: `parseErrorAt`, `parseList`,
//! `parseDelimitedList`, `abortParsingListOrMoveToNextToken`, `isInSomeParsingContext`,
//! `parsingContextErrors`, `isListElement`, `isListTerminator`.
//!
//! Only with `Options::recovers`. Without it the first error ends the file, or the speculative parse
//! that is going on: a text without errors pays one test of a flag at each list.

use super::Parser;
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

/// `GetViableKeywordSuggestions`: TypeScript's keywords of more than two letters.
const KEYWORD_SUGGESTIONS: &[&[u8]] = &[
    b"abstract",
    b"accessor",
    b"any",
    b"asserts",
    b"assert",
    b"bigint",
    b"boolean",
    b"break",
    b"case",
    b"catch",
    b"class",
    b"continue",
    b"const",
    b"constructor",
    b"debugger",
    b"declare",
    b"default",
    b"defer",
    b"delete",
    b"else",
    b"enum",
    b"export",
    b"extends",
    b"false",
    b"finally",
    b"for",
    b"from",
    b"function",
    b"get",
    b"immediate",
    b"implements",
    b"import",
    b"infer",
    b"instanceof",
    b"interface",
    b"intrinsic",
    b"keyof",
    b"let",
    b"module",
    b"namespace",
    b"never",
    b"new",
    b"null",
    b"number",
    b"object",
    b"package",
    b"private",
    b"protected",
    b"public",
    b"override",
    b"out",
    b"readonly",
    b"require",
    b"global",
    b"return",
    b"satisfies",
    b"set",
    b"static",
    b"string",
    b"super",
    b"switch",
    b"symbol",
    b"this",
    b"throw",
    b"true",
    b"try",
    b"type",
    b"typeof",
    b"undefined",
    b"unique",
    b"unknown",
    b"using",
    b"var",
    b"void",
    b"while",
    b"with",
    b"yield",
    b"async",
    b"await",
];

/// The suggestion of `parseErrorForMissingSemicolonAfter` for `word`
/// (`GetSpellingSuggestionForStrings`, `getSpaceSuggestion`).
#[cold]
#[inline(never)]
pub fn keyword_suggestion(word: &[u8]) -> Option<Vec<u8>> {
    let keywords = KEYWORD_SUGGESTIONS.iter().copied();
    match bun_sema::check::get_spelling_suggestion(word, keywords, |c| c, |a, b| a.cmp(b)) {
        Some(keyword) => Some(keyword.to_vec()),
        None => KEYWORD_SUGGESTIONS
            .iter()
            .find(|keyword| word.len() > keyword.len() + 2 && word.starts_with(keyword))
            .map(|keyword| [keyword, &b" "[..], &word[keyword.len()..]].concat()),
    }
}

/// `ParsingContext`
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ListKind {
    SourceElements,
    BlockStatements,
    SwitchClauses,
    SwitchClauseStatements,
    TypeMembers,
    ClassMembers,
    EnumMembers,
    HeritageClauseElement,
    VariableDeclarations,
    ObjectBindingElements,
    ArrayBindingElements,
    ArgumentExpressions,
    ObjectLiteralMembers,
    ArrayLiteralMembers,
    Parameters,
    TypeParameters,
    TypeArguments,
    TupleElementTypes,
    HeritageClauses,
    ImportOrExportSpecifiers,
    ImportAttributes,
    JsxAttributes,
    JsxChildren,
}

const ALL_LISTS: [ListKind; 23] = [
    ListKind::SourceElements,
    ListKind::BlockStatements,
    ListKind::SwitchClauses,
    ListKind::SwitchClauseStatements,
    ListKind::TypeMembers,
    ListKind::ClassMembers,
    ListKind::EnumMembers,
    ListKind::HeritageClauseElement,
    ListKind::VariableDeclarations,
    ListKind::ObjectBindingElements,
    ListKind::ArrayBindingElements,
    ListKind::ArgumentExpressions,
    ListKind::ObjectLiteralMembers,
    ListKind::ArrayLiteralMembers,
    ListKind::Parameters,
    ListKind::TypeParameters,
    ListKind::TypeArguments,
    ListKind::TupleElementTypes,
    ListKind::HeritageClauses,
    ListKind::ImportOrExportSpecifiers,
    ListKind::ImportAttributes,
    ListKind::JsxAttributes,
    ListKind::JsxChildren,
];

/// What the token at the top of the loop of a list is to the list.
#[derive(Copy, Clone, PartialEq, Eq)]
enum ListStep {
    /// It starts an element.
    Element,
    /// It was reported and skipped. The next one is looked at.
    Skipped,
    /// The list ends before it.
    Over,
}

impl Parser<'_> {
    /// `parseErrorAtRange`. Without recovery: `fail`.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn error(&mut self, code: u32, at: (u32, u32), args: &[&[u8]]) {
        if !self.recovers {
            return self.fail();
        }
        // A loop that is not written for recovery yet can stay at a token for ever.
        match self.errors_at.0 == self.lx.start {
            true => self.errors_at.1 += 1,
            false => self.errors_at = (self.lx.start, 0),
        }
        if self.errors_at.1 > 64 {
            return self.refuse(Refusal::Unsupported);
        }
        self.take_errors_of_scanner();
        self.add_error(Diagnostic::new(DiagnosticKind::Parse, at, code, args));
    }

    /// The end of `parseErrorAtRange`.
    fn add_error(&mut self, error: Diagnostic) {
        // "Don't report another error if it would just be at the same location as the last error"
        let is_of_parser = |it: &&Diagnostic| it.kind == DiagnosticKind::Parse;
        let last = self.f.diagnostics.iter().rfind(is_of_parser);
        if last.is_none_or(|last| last.start != error.start) {
            self.f.diagnostics.push(error);
        }
    }

    /// `scanError`: what the scanner has reported goes where the errors of the parser go, before
    /// the next of them.
    #[inline(always)]
    pub(crate) fn take_errors_of_scanner(&mut self) {
        if !self.lx.errors.is_empty() {
            self.take_errors_of_scanner_slowly();
        }
    }

    #[cold]
    #[inline(never)]
    fn take_errors_of_scanner_slowly(&mut self) {
        for error in std::mem::take(&mut self.lx.errors) {
            self.add_error(error);
        }
    }

    /// `parseErrorAtCurrentToken`
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn error_at_token(&mut self, code: u32, args: &[&[u8]]) {
        self.error(code, self.range_of_token(), args);
    }

    /// `TokenRange()`, as the range of a diagnostic.
    pub(crate) fn range_of_token(&self) -> (u32, u32) {
        match self.lx.start == self.lx.end {
            true => (self.lx.start, Diagnostic::NO_LENGTH),
            false => (self.lx.start, self.lx.end),
        }
    }

    /// `parseExpected`, at another token.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn expected(&mut self, token: T) {
        self.error_at_token(1005, &[token.text()]);
    }

    /// `parseExpectedMatchingBrackets`, at another token than `close`.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn unmatched(&mut self, (open, close): (T, T), open_at: Option<u32>) {
        let before = self.f.diagnostics.len();
        self.expected(close);
        if let Some(open_at) = open_at
            && self.f.diagnostics.len() > before
            && let Some(error) = self.f.diagnostics.last_mut()
        {
            let at = (open_at, Diagnostic::NO_LENGTH);
            let texts = [open.text(), close.text()];
            error
                .related
                .push(Diagnostic::new(DiagnosticKind::Parse, at, 1007, &texts));
        }
    }

    /// Where TypeScript's parser reports nothing and leaves the token to its caller. Without recovery
    /// the token is an error wherever it is left, and the parse ends here.
    #[inline]
    #[track_caller]
    pub(crate) fn fail_unless_recovering(&mut self) {
        if !self.recovers {
            self.fail();
        }
    }

    /// `parseErrorAtRange`, about what is parsed all the same. Without recovery: `report`.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn error_and_go_on(&mut self, code: u32, at: (u32, u32), args: &[&[u8]]) {
        match self.recovers {
            true => self.error(code, at, args),
            false => self.report(),
        }
    }

    /// `createIdentifierWithDiagnostic`, at a token that is no identifier for the caller: the name
    /// that stands for it, and the start of the token. `code`: `diagnosticMessage`, or 0.
    /// `code_of_private_name`: `privateIdentifierDiagnosticMessage`, or 0.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn missing_identifier(
        &mut self,
        code: u32,
        code_of_private_name: u32,
    ) -> (Atom, u32) {
        if !self.recovers {
            self.fail();
            return (Atom::NONE, self.pos());
        }
        if self.token() == T::PrivateIdentifier {
            let code = match code_of_private_name {
                0 => 18016,
                code => code,
            };
            self.error_at_token(code, &[]);
            let name = (self.lx.atom, self.pos());
            self.next();
            return name;
        }
        // "Only for end of file because the error gets reported incorrectly on embedded script tags."
        let at = match self.token() {
            T::Eof => (self.full_start(), Diagnostic::NO_LENGTH),
            _ => self.range_of_token(),
        };
        let word = self.lx.text();
        match code {
            0 if self.token().is_reserved_word() => self.error(1359, at, &[word]),
            0 => self.error(1003, at, &[]),
            code => self.error(code, at, &[]),
        }
        (known::empty, self.pos())
    }

    /// `parseIdentifierWithDiagnostic(code)` as an expression, at a token that is no identifier.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn missing_expression(&mut self, code: u32) -> ExprId {
        self.missing_identifier(code, 0);
        match self.recovers {
            true => self.add_expr(ExprKind::Missing, self.pos(), self.full_start()),
            false => ExprId::NONE,
        }
    }

    /// `TokenValue()`. `previous`: the one of the token before, which a punctuator leaves.
    fn token_value(&self, previous: &[u8]) -> Vec<u8> {
        match self.token() {
            T::Number => bun_sema::atom::number_to_string(self.lx.number),
            T::BigInt => bun_sema::json::bigint_token_value(self.lx.text()),
            T::String | T::NoSubstitutionTemplate | T::TemplateHead => {
                self.lx.text_of(self.lx.atom).to_vec()
            }
            token if token.is_identifier_or_keyword() => self.lx.text_of(self.lx.atom).to_vec(),
            _ => previous.to_vec(),
        }
    }

    /// `parseErrorForMissingSemicolonAfter`
    #[cold]
    #[inline(never)]
    pub(crate) fn missing_semicolon_after(&mut self, expression: ExprId) {
        let Some(&Expr { kind, pos, end }) = self.f.exprs.get(expression.idx()) else {
            return self.expected(T::Semicolon);
        };
        let is_parenthesized = self.is_parenthesized(expression);
        match kind {
            ExprKind::TaggedTemplate(call) if !is_parenthesized => {
                let template = self.f[call].template;
                let from = self.f.exprs.get(template.idx()).map_or(pos, |it| it.pos);
                self.error(1443, (from, end), &[]);
            }
            ExprKind::Ident(name) if !is_parenthesized => {
                self.missing_semicolon_after_identifier(name, (pos, end));
            }
            _ => self.expected(T::Semicolon),
        }
    }

    /// `parseErrorForMissingSemicolonAfter`, of the identifier `name` from `pos` to `end`.
    fn missing_semicolon_after_identifier(&mut self, name: Atom, (pos, end): (u32, u32)) {
        let word = self.lx.text_of(name).to_vec();
        let (here, token) = (self.range_of_token(), self.token());
        // `parseErrorForInvalidName`
        let invalid_name = |blank: T, code_if_blank: u32, code: u32| match token == blank {
            true => (here, code_if_blank),
            false => (here, code),
        };
        let mut suggestion = None;
        let (at, code) = match &word[..] {
            b"" => return self.expected(T::Semicolon),
            b"const" | b"let" | b"var" => ((pos, end), 1440),
            // "If a declared node failed to parse, it would have emitted a diagnostic already."
            b"declare" => return,
            b"interface" => invalid_name(T::OpenBrace, 1438, 2427),
            b"is" => ((pos, self.pos()), 1228),
            b"module" | b"namespace" => invalid_name(T::OpenBrace, 1437, 2819),
            b"type" => invalid_name(T::Equals, 1439, 2457),
            _ => {
                suggestion = keyword_suggestion(&word);
                match suggestion {
                    Some(_) => ((pos, end), 1435),
                    None => ((pos, end), 1434),
                }
            }
        };
        match suggestion {
            Some(suggestion) => self.error(code, at, &[&suggestion]),
            None if matches!(code, 2427 | 2457 | 2819) => {
                let value = self.token_value(&word);
                self.error(code, at, &[&value]);
            }
            None => self.error(code, at, &[]),
        }
    }

    /// `parseSemicolonAfterPropertyName`. `name`: the name and its range, if it is an identifier.
    #[cold]
    #[inline(never)]
    pub(crate) fn missing_semicolon_after_property(
        &mut self,
        name: Option<(Atom, (u32, u32))>,
        has_type: bool,
        has_initializer: bool,
    ) {
        if !self.recovers {
            return self.fail();
        }
        if self.token() == T::At && !self.newline_before() {
            return self.error_at_token(1436, &[]);
        }
        if self.token() == T::OpenParen {
            self.error_at_token(1441, &[]);
            return self.next();
        }
        match (has_initializer, has_type, name) {
            (true, ..) => self.expected(T::Semicolon),
            (false, true, _) => self.error_at_token(1442, &[]),
            (false, false, Some((name, at))) => self.missing_semicolon_after_identifier(name, at),
            (false, false, None) => self.expected(T::Semicolon),
        }
    }

    /// The condition of the loop of `parseHeritageClauses`, which is a list only from the first
    /// clause on.
    pub(crate) fn is_at_heritage_clause(&mut self, is_first: bool) -> bool {
        if is_first || !self.recovers {
            return matches!(self.token(), T::Extends | T::Implements);
        }
        self.skip_to_element(ListKind::HeritageClauses)
    }

    /// The condition of the loops of `parseList` and `parseDelimitedList`, before each element:
    /// whether the list of `kind` goes on, after the tokens that are reported and skipped. Only
    /// recovery asks: without it, what is no element is an error where it is parsed.
    #[inline(always)]
    pub(crate) fn is_at_element(&mut self, kind: ListKind) -> bool {
        !self.recovers || self.skip_to_element(kind)
    }

    #[cold]
    #[inline(never)]
    fn skip_to_element(&mut self, kind: ListKind) -> bool {
        loop {
            match self.list_step(kind) {
                ListStep::Element => return true,
                ListStep::Skipped => {}
                ListStep::Over => return false,
            }
        }
    }

    /// `recover_missing_comma`, which only recovery needs.
    #[inline(always)]
    pub(crate) fn goes_on_without_comma(&mut self, kind: ListKind, element: u32) -> bool {
        self.recovers && self.recover_missing_comma(kind, element)
    }

    /// A list of `kind` is open from here on. Returns `lists` as the caller restores it after the
    /// list.
    #[inline(always)]
    pub(crate) fn enter_list(&mut self, kind: ListKind) -> u32 {
        let saved = self.lists;
        self.lists = saved | 1 << kind as u32;
        saved
    }

    /// What the token is to the list of `kind`, which the loop of the list is at the top of.
    fn list_step(&mut self, kind: ListKind) -> ListStep {
        if self.is_list_element(kind, false) {
            return ListStep::Element;
        }
        if self.is_list_terminator(kind) || self.abort_list_or_skip(kind) {
            return ListStep::Over;
        }
        ListStep::Skipped
    }

    /// The end of the loop of `parseDelimitedList`, after an element that starts at the full start
    /// `element` and that no comma follows. Whether the list goes on.
    #[cold]
    #[inline(never)]
    fn recover_missing_comma(&mut self, kind: ListKind, element: u32) -> bool {
        if self.is_list_terminator(kind) {
            return false;
        }
        match kind {
            ListKind::EnumMembers => self.error_at_token(1357, &[]),
            _ => self.expected(T::Comma),
        }
        // `{ a; b }`
        if matches!(
            kind,
            ListKind::ObjectLiteralMembers | ListKind::ImportAttributes
        ) && self.token() == T::Semicolon
            && !self.newline_before()
        {
            self.next();
        }
        // "Consume a token to advance the parser in some way and avoid an infinite loop"
        if self.full_start() == element {
            self.next();
        }
        true
    }

    /// `abortParsingListOrMoveToNextToken`, at a token that neither starts an element of `kind` nor
    /// ends the list. Whether the list ends, because a list around it has a use for the token.
    fn abort_list_or_skip(&mut self, kind: ListKind) -> bool {
        self.parsing_context_error(kind);
        if self.is_in_some_parsing_context() {
            return true;
        }
        self.next();
        self.f.after_skipped.push(self.pos());
        false
    }

    /// `isInSomeParsingContext`
    fn is_in_some_parsing_context(&mut self) -> bool {
        let open = self.lists;
        ALL_LISTS.iter().any(|&kind| {
            open & 1 << kind as u32 != 0
                && (self.is_list_element(kind, true) || self.is_list_terminator(kind))
        })
    }

    /// `IsKeyword`
    fn is_at_keyword(&self) -> bool {
        self.token() > T::PrivateIdentifier
    }

    /// `parsingContextErrors`
    fn parsing_context_error(&mut self, kind: ListKind) {
        let word = self.lx.text();
        let code = match kind {
            ListKind::SourceElements if self.token() == T::Default => {
                return self.error_at_token(1005, &[b"export"]);
            }
            ListKind::SourceElements | ListKind::BlockStatements => 1128,
            ListKind::SwitchClauses => 1130,
            ListKind::SwitchClauseStatements => 1129,
            ListKind::TypeMembers => 1131,
            ListKind::ClassMembers => 1068,
            ListKind::EnumMembers => 1132,
            ListKind::HeritageClauseElement => 1109,
            ListKind::VariableDeclarations if self.is_at_keyword() => {
                return self.error_at_token(1389, &[word]);
            }
            ListKind::VariableDeclarations => 1134,
            ListKind::ObjectBindingElements => 1180,
            ListKind::ArrayBindingElements => 1181,
            ListKind::ArgumentExpressions => 1135,
            ListKind::ObjectLiteralMembers => 1136,
            ListKind::ArrayLiteralMembers => 1137,
            ListKind::Parameters if self.is_at_keyword() => {
                return self.error_at_token(1390, &[word]);
            }
            ListKind::Parameters => 1138,
            ListKind::TypeParameters => 1139,
            ListKind::TypeArguments => 1140,
            ListKind::TupleElementTypes => 1110,
            ListKind::HeritageClauses => 1179,
            ListKind::ImportOrExportSpecifiers if self.token() == T::From => {
                return self.error_at_token(1005, &[b"}"]);
            }
            ListKind::ImportOrExportSpecifiers => 1003,
            ListKind::ImportAttributes => 1478,
            ListKind::JsxAttributes | ListKind::JsxChildren => 1003,
        };
        self.error_at_token(code, &[]);
    }

    /// `isBindingIdentifierOrPrivateIdentifierOrPattern`
    fn is_binding_identifier_or_pattern(&self) -> bool {
        matches!(
            self.token(),
            T::OpenBrace | T::OpenBracket | T::PrivateIdentifier
        ) || self.is_binding_identifier()
    }

    /// `isStartOfStatement`
    pub(crate) fn is_start_of_statement(&mut self) -> bool {
        match self.token() {
            T::At
            | T::Semicolon
            | T::OpenBrace
            | T::Var
            | T::Let
            | T::Using
            | T::Function
            | T::Class
            | T::Enum
            | T::If
            | T::Do
            | T::While
            | T::For
            | T::Continue
            | T::Break
            | T::Return
            | T::With
            | T::Switch
            | T::Throw
            | T::Try
            | T::Debugger
            | T::Catch
            | T::Finally => true,
            T::Import => {
                self.is_start_of_declaration()
                    || matches!(self.peek(), T::OpenParen | T::LessThan | T::Dot)
            }
            T::Const | T::Export => self.is_start_of_declaration(),
            T::Async
            | T::Declare
            | T::Interface
            | T::Module
            | T::Namespace
            | T::Type
            | T::Global
            | T::Defer => true,
            T::Accessor | T::Public | T::Private | T::Protected | T::Static | T::Readonly => {
                self.is_start_of_declaration()
                    || !self.look_ahead(|p| {
                        p.next();
                        p.token().is_identifier_or_keyword() && !p.newline_before()
                    })
            }
            _ => self.is_start_of_expression(),
        }
    }

    /// `scanClassMemberStart`, in a `lookAhead`.
    fn is_class_member_start(&mut self) -> bool {
        if self.token() == T::At {
            return true;
        }
        self.look_ahead(|p| {
            let mut name = None;
            while p.token().is_modifier() {
                name = Some(p.token());
                // `IsClassMemberModifier`
                if matches!(
                    p.token(),
                    T::Public
                        | T::Private
                        | T::Protected
                        | T::Readonly
                        | T::Override
                        | T::Static
                        | T::Accessor
                ) {
                    return true;
                }
                p.next();
            }
            if p.token() == T::Asterisk {
                return true;
            }
            if p.is_literal_property_name() {
                name = Some(p.token());
                p.next();
            }
            if p.token() == T::OpenBracket {
                return true;
            }
            let Some(name) = name else {
                return false;
            };
            name <= T::PrivateIdentifier
                || matches!(name, T::Get | T::Set)
                || matches!(
                    p.token(),
                    T::OpenParen
                        | T::LessThan
                        | T::Exclamation
                        | T::Colon
                        | T::Equals
                        | T::Question
                )
                || p.can_parse_semicolon()
        })
    }

    /// `scanTypeMemberStart`, in a `lookAhead`.
    fn is_type_member_start(&mut self) -> bool {
        if matches!(self.token(), T::OpenParen | T::LessThan | T::Get | T::Set) {
            return true;
        }
        self.look_ahead(|p| {
            let mut has_name = false;
            while p.token().is_modifier() {
                has_name = true;
                p.next();
            }
            if p.token() == T::OpenBracket {
                return true;
            }
            if p.is_literal_property_name() {
                has_name = true;
                p.next();
            }
            has_name
                && (matches!(
                    p.token(),
                    T::OpenParen | T::LessThan | T::Question | T::Colon | T::Comma
                ) || p.can_parse_semicolon())
        })
    }

    /// `isListElement`
    fn is_list_element(&mut self, kind: ListKind, is_recovering: bool) -> bool {
        let token = self.token();
        match kind {
            ListKind::SourceElements
            | ListKind::BlockStatements
            | ListKind::SwitchClauseStatements => {
                !(token == T::Semicolon && is_recovering) && self.is_start_of_statement()
            }
            ListKind::SwitchClauses => matches!(token, T::Case | T::Default),
            ListKind::TypeMembers => self.is_type_member_start(),
            ListKind::ClassMembers => {
                self.is_class_member_start() || token == T::Semicolon && !is_recovering
            }
            ListKind::EnumMembers => token == T::OpenBracket || self.is_literal_property_name(),
            ListKind::ObjectLiteralMembers => {
                matches!(token, T::OpenBracket | T::Asterisk | T::DotDotDot | T::Dot)
                    || self.is_literal_property_name()
            }
            ListKind::ObjectBindingElements => {
                matches!(token, T::OpenBracket | T::DotDotDot) || self.is_literal_property_name()
            }
            ListKind::ImportAttributes => token.is_identifier_or_keyword() || token == T::String,
            ListKind::JsxAttributes => token.is_identifier_or_keyword() || token == T::OpenBrace,
            ListKind::JsxChildren => true,
            ListKind::HeritageClauseElement if is_recovering && token != T::OpenBrace => {
                self.is_identifier() && self.is_heritage_element()
            }
            ListKind::HeritageClauseElement => self.is_heritage_element(),
            ListKind::VariableDeclarations => self.is_binding_identifier_or_pattern(),
            ListKind::ArrayBindingElements => {
                matches!(token, T::Comma | T::DotDotDot) || self.is_binding_identifier_or_pattern()
            }
            ListKind::TypeParameters => matches!(token, T::In | T::Const) || self.is_identifier(),
            ListKind::ArrayLiteralMembers => {
                matches!(token, T::Comma | T::Dot | T::DotDotDot) || self.is_start_of_expression()
            }
            ListKind::ArgumentExpressions => token == T::DotDotDot || self.is_start_of_expression(),
            ListKind::Parameters => self.is_start_of_parameter(),
            ListKind::TypeArguments | ListKind::TupleElementTypes => {
                token == T::Comma || self.is_start_of_type(false)
            }
            ListKind::HeritageClauses => matches!(token, T::Extends | T::Implements),
            ListKind::ImportOrExportSpecifiers => {
                if token == T::From && self.peek() == T::String {
                    return false;
                }
                token == T::String || token.is_identifier_or_keyword()
            }
        }
    }

    /// `isListTerminator`
    fn is_list_terminator(&mut self, kind: ListKind) -> bool {
        let token = self.token();
        if token == T::Eof {
            return true;
        }
        match kind {
            ListKind::SourceElements => false,
            ListKind::BlockStatements
            | ListKind::SwitchClauses
            | ListKind::TypeMembers
            | ListKind::ClassMembers
            | ListKind::EnumMembers
            | ListKind::ObjectLiteralMembers
            | ListKind::ObjectBindingElements
            | ListKind::ImportOrExportSpecifiers
            | ListKind::ImportAttributes => token == T::CloseBrace,
            ListKind::SwitchClauseStatements => {
                matches!(token, T::CloseBrace | T::Case | T::Default)
            }
            ListKind::HeritageClauseElement => {
                matches!(token, T::OpenBrace | T::Extends | T::Implements)
            }
            ListKind::VariableDeclarations => {
                self.can_parse_semicolon() || matches!(token, T::In | T::Of | T::EqualsGreaterThan)
            }
            ListKind::TypeParameters => matches!(
                token,
                T::GreaterThan | T::OpenParen | T::OpenBrace | T::Extends | T::Implements
            ),
            ListKind::ArgumentExpressions => matches!(token, T::CloseParen | T::Semicolon),
            ListKind::ArrayLiteralMembers
            | ListKind::TupleElementTypes
            | ListKind::ArrayBindingElements => token == T::CloseBracket,
            ListKind::Parameters => matches!(token, T::CloseParen | T::CloseBracket),
            ListKind::TypeArguments => token != T::Comma,
            ListKind::HeritageClauses => matches!(token, T::OpenBrace | T::CloseBrace),
            ListKind::JsxAttributes => matches!(token, T::GreaterThan | T::Slash),
            ListKind::JsxChildren => token == T::LessThan && self.peek() == T::Slash,
        }
    }
}

//! Error recovery for lists, ported from TypeScript's parser.
//!
//! Tracks which lists are currently being parsed, which tokens can start or end an element of each kind, and whether an unexpected
//! token should be skipped or should end the list.
//!
//! Ported from `parseList`, `parseDelimitedList`, `abortParsingListOrMoveToNextToken`, `isInSomeParsingContext`,
//! `parsingContextErrors`, `isListElement`, `isListTerminator` and the `isStartOf*` functions in TypeScript 7.0.2's parser.go.
//!
//! Only used in tolerant mode. Ordinary builds only pay for the `tolerant` check in `enter_list` and `classify_list_token`.

use crate::Error;
use crate::lexer::{PropertyModifierKeyword as Modifier, T, TypescriptStmtKeyword as Statement};
use crate::p::P;
use crate::parser::AwaitOrYield;

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

/// How the token at the top of a list's loop relates to the list.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ListStep {
    /// The token starts an element.
    Element,
    /// The token was reported and skipped. Check the next one.
    Skipped,
    /// The list ends here. The token was not consumed.
    Over,
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

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    /// Marks a list of `kind` as open. Returns the previous `lexer.list_contexts`, which the caller restores after the list.
    #[inline]
    pub(crate) fn enter_list(&mut self, kind: ListKind) -> u32 {
        let saved = self.lexer.list_contexts;
        if self.is_tolerant() {
            self.lexer.list_contexts = saved | 1 << kind as u32;
        }
        saved
    }

    /// Call before parsing each element. Ports the loop condition of `parseList` and `parseDelimitedList`.
    #[inline]
    pub(crate) fn classify_list_token(&mut self, kind: ListKind) -> Result<ListStep, Error> {
        // A speculative parse must still fail on errors. The type member parser accepts any run of
        // words as modifiers and a name, so for that list the check is done here: a token that
        // cannot start a member ends the list, and `expect("}")` fails the speculative parse.
        if !self.is_tolerant() || self.lexer.is_log_disabled && kind != ListKind::TypeMembers {
            return Ok(ListStep::Element);
        }
        self.classify_list_token_slow(kind)
    }

    /// `classify_list_token`, past the tokens it skips. Returns false where the list ends.
    #[inline]
    pub(crate) fn skip_to_list_element(&mut self, kind: ListKind) -> Result<bool, Error> {
        loop {
            match self.classify_list_token(kind)? {
                ListStep::Element => return Ok(true),
                ListStep::Skipped => {}
                ListStep::Over => return Ok(false),
            }
        }
    }

    #[cold]
    #[inline(never)]
    fn classify_list_token_slow(&mut self, kind: ListKind) -> Result<ListStep, Error> {
        // The lists in which `is_list_element` accepts any name, whatever follows it.
        const TAKE_ANY_NAME: u32 = 1 << ListKind::EnumMembers as u32
            | 1 << ListKind::VariableDeclarations as u32
            | 1 << ListKind::ObjectBindingElements as u32
            | 1 << ListKind::ArrayBindingElements as u32
            | 1 << ListKind::ArgumentExpressions as u32
            | 1 << ListKind::ObjectLiteralMembers as u32
            | 1 << ListKind::ArrayLiteralMembers as u32
            | 1 << ListKind::Parameters as u32
            | 1 << ListKind::ImportAttributes as u32
            | 1 << ListKind::JsxAttributes as u32;
        if self.lexer.token == T::TIdentifier && TAKE_ANY_NAME & 1 << kind as u32 != 0 {
            return Ok(ListStep::Element);
        }
        if self.is_list_element(kind, false) {
            return Ok(ListStep::Element);
        }
        if self.is_list_terminator(kind) || self.abort_list_or_skip(kind)? {
            return Ok(ListStep::Over);
        }
        Ok(ListStep::Skipped)
    }

    /// Call after an element that is not followed by a comma. Returns true if the error was reported and the list should continue.
    /// Ports the end of the loop in `parseDelimitedList`.
    #[inline]
    pub(crate) fn recover_missing_comma(
        &mut self,
        kind: ListKind,
        element_start: bun_ast::Loc,
    ) -> Result<bool, Error> {
        if !self.is_tolerant() || self.lexer.is_log_disabled || self.is_list_terminator(kind) {
            return Ok(false);
        }
        self.report_missing_comma(kind, element_start)?;
        Ok(true)
    }

    /// `for (let of x)` has no declarations, and `of` is the keyword (`parseVariableDeclarationList`).
    #[cold]
    #[inline(never)]
    pub(crate) fn is_for_of_without_declarations(&mut self) -> bool {
        self.word() == b"of"
            && self.look_ahead(|p| {
                p.step()
                    && p.is_identifier_in_context()
                    && p.step()
                    && p.lexer.token == T::TCloseParen
            })
    }

    /// `lookAhead`
    #[cold]
    #[inline(never)]
    pub(crate) fn look_ahead(&mut self, scan: impl FnOnce(&mut Self) -> bool) -> bool {
        let here = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let found = scan(self);
        self.lexer.restore(&here);
        found
    }

    /// `nextToken` during lookahead. Returns false on a lexer error, which ends the lookahead.
    pub(crate) fn step(&mut self) -> bool {
        self.lexer.next().is_ok()
    }

    /// The text of the current token if it is an identifier, otherwise empty.
    fn word(&self) -> &'a [u8] {
        if self.lexer.token == T::TIdentifier {
            self.lexer.raw()
        } else {
            b""
        }
    }

    /// `IsKeyword`
    fn is_keyword(&self) -> bool {
        self.lexer.token.is_reserved_word()
            || crate::typescript::identifier::is_contextual_keyword(self.word())
    }

    /// `tokenIsIdentifierOrKeyword`. In TypeScript this is `token >= KindIdentifier`, which includes private identifiers.
    fn is_identifier_or_keyword(&self) -> bool {
        matches!(
            self.lexer.token,
            T::TIdentifier | T::TPrivateIdentifier | T::TEscapedKeyword
        ) || self.lexer.token.is_reserved_word()
    }

    /// `isLiteralPropertyName`
    fn is_literal_property_name(&self) -> bool {
        self.is_identifier_or_keyword()
            || matches!(
                self.lexer.token,
                T::TStringLiteral | T::TNumericLiteral | T::TBigIntegerLiteral
            )
    }

    /// `IsModifierKind`
    pub(crate) fn is_modifier_kind(&self) -> bool {
        match self.lexer.token {
            T::TConst | T::TDefault | T::TExport | T::TIn => true,
            T::TIdentifier => match Modifier::find(self.word()) {
                Some(Modifier::PGet | Modifier::PSet) => false,
                Some(_) => true,
                None => self.word() == b"out",
            },
            _ => false,
        }
    }

    /// `IsClassMemberModifier`
    fn is_class_member_modifier(&self) -> bool {
        use Modifier::*;
        matches!(
            Modifier::find(self.word()),
            Some(PPublic | PPrivate | PProtected | PReadonly | POverride | PStatic | PAccessor)
        )
    }

    /// `canParseSemicolon`
    pub(crate) fn can_parse_semicolon(&self) -> bool {
        matches!(
            self.lexer.token,
            T::TSemicolon | T::TCloseBrace | T::TEndOfFile
        ) || self.lexer.has_newline_before
    }

    /// `isBindingIdentifierOrPrivateIdentifierOrPattern`
    fn is_binding_identifier_or_pattern(&self) -> bool {
        matches!(
            self.lexer.token,
            T::TOpenBrace | T::TOpenBracket | T::TPrivateIdentifier | T::TIdentifier
        )
    }

    /// `isStartOfExpression`. TypeScript's scanner always produces `>` first and only rescans on request, so `>>=` and `>>>=` count as
    /// binary operators, and a binary operator counts as the start of an expression with a missing left operand.
    #[cold]
    #[inline(never)]
    pub(crate) fn is_start_of_expression_or_shift_assign(&mut self) -> bool {
        if self.is_at_less_than_slash_token() {
            return false;
        }
        self.is_start_of_expression()
            || matches!(
                self.lexer.token,
                T::TGreaterThanGreaterThanEquals | T::TGreaterThanGreaterThanGreaterThanEquals
            )
    }

    /// `KindLessThanSlashToken`: `</` is one token in a file with JSX. It starts nothing.
    fn is_at_less_than_slash_token(&self) -> bool {
        self.lexer.token == T::TLessThan && self.is_jsx_enabled() && self.lexer.is_less_than_slash()
    }

    /// `isStartOfDeclaration` (lookahead with `scanStartOfDeclaration`).
    #[cold]
    #[inline(never)]
    pub(crate) fn is_start_of_declaration(&mut self) -> bool {
        self.look_ahead(|p| {
            loop {
                match p.lexer.token {
                    T::TVar | T::TConst | T::TFunction | T::TClass | T::TEnum => return true,
                    T::TImport => {
                        return p.step()
                            && (matches!(
                                p.lexer.token,
                                T::TStringLiteral | T::TAsterisk | T::TOpenBrace
                            ) || p.is_identifier_or_keyword());
                    }
                    T::TExport => {
                        if !p.step() {
                            return false;
                        }
                        if matches!(
                            p.lexer.token,
                            T::TEquals | T::TAsterisk | T::TOpenBrace | T::TDefault | T::TAt
                        ) || p.word() == b"as"
                        {
                            return true;
                        }
                        if p.word() == b"type" {
                            return p.step()
                                && (matches!(p.lexer.token, T::TAsterisk | T::TOpenBrace)
                                    || p.is_identifier_in_context()
                                        && !p.lexer.has_newline_before);
                        }
                    }
                    T::TIdentifier => {
                        let word = p.word();
                        // A modifier starts a declaration only if the declaration continues on the same line.
                        let mut is_modifier = false;
                        match (Statement::from_bytes(word), Modifier::find(word)) {
                            (Some(Statement::TsStmtInterface | Statement::TsStmtType), _) => {
                                return p.step()
                                    && p.is_identifier_in_context()
                                    && !p.lexer.has_newline_before;
                            }
                            (Some(Statement::TsStmtModule | Statement::TsStmtNamespace), _) => {
                                return p.step()
                                    && (p.is_identifier_in_context()
                                        || p.lexer.token == T::TStringLiteral)
                                    && !p.lexer.has_newline_before;
                            }
                            (Some(Statement::TsStmtGlobal), _) => {
                                return p.step()
                                    && matches!(
                                        p.lexer.token,
                                        T::TOpenBrace | T::TIdentifier | T::TExport
                                    );
                            }
                            (Some(Statement::TsStmtAbstract | Statement::TsStmtDeclare), _) => {
                                is_modifier = true
                            }
                            (None, Some(Modifier::PStatic)) => {
                                if !p.step() {
                                    return false;
                                }
                            }
                            (None, Some(Modifier::PGet | Modifier::PSet | Modifier::POverride)) => {
                                return false;
                            }
                            (None, Some(_)) => is_modifier = true,
                            (None, None) => match word {
                                b"let" => return true,
                                b"defer" => {
                                    return p.step()
                                        && p.is_identifier_in_context()
                                        && !p.lexer.has_newline_before;
                                }
                                // `isUsingDeclaration`: an identifier or a pattern must follow on the same line.
                                b"using" => {
                                    return p.step()
                                        && !p.lexer.has_newline_before
                                        && matches!(p.lexer.token, T::TIdentifier | T::TOpenBrace);
                                }
                                // `isAwaitUsingDeclaration`
                                b"await" => {
                                    return p.step()
                                        && p.word() == b"using"
                                        && !p.lexer.has_newline_before
                                        && p.step()
                                        && !p.lexer.has_newline_before
                                        && matches!(p.lexer.token, T::TIdentifier | T::TOpenBrace);
                                }
                                _ => return false,
                            },
                        }
                        if is_modifier {
                            if !p.step() || p.lexer.has_newline_before {
                                return false;
                            }
                            if word == b"declare" && p.word() == b"type" {
                                return true;
                            }
                        }
                    }
                    _ => return false,
                }
            }
        })
    }

    /// `isStartOfStatement`
    #[cold]
    #[inline(never)]
    pub(crate) fn is_start_of_statement(&mut self) -> bool {
        match self.lexer.token {
            T::TAt
            | T::TSemicolon
            | T::TOpenBrace
            | T::TVar
            | T::TFunction
            | T::TClass
            | T::TEnum
            | T::TIf
            | T::TDo
            | T::TWhile
            | T::TFor
            | T::TContinue
            | T::TBreak
            | T::TReturn
            | T::TWith
            | T::TSwitch
            | T::TThrow
            | T::TTry
            | T::TDebugger
            | T::TCatch
            | T::TFinally
            // TypeScript scans an escaped keyword as that keyword. Let the statement parser handle it.
            | T::TEscapedKeyword => true,
            T::TImport => {
                self.is_start_of_declaration()
                    || self.look_ahead(|p| p.step() && matches!(p.lexer.token, T::TOpenParen | T::TLessThan | T::TDot))
            }
            // `is_start_of_declaration` does not look ahead past this token.
            T::TConst => true,
            T::TExport => self.is_start_of_declaration(),
            T::TIdentifier => {
                use Modifier::*;
                match Modifier::find(self.word()) {
                    Some(PAccessor | PPublic | PPrivate | PProtected | PStatic | PReadonly) => {
                        self.is_start_of_declaration()
                            || !self.look_ahead(|p| p.step() && p.is_identifier_or_keyword() && !p.lexer.has_newline_before)
                    }
                    // Any other identifier starts an expression.
                    _ => true,
                }
            }
            _ => self.is_start_of_expression_or_shift_assign(),
        }
    }

    /// Lookahead with `scanClassMemberStart`.
    #[cold]
    #[inline(never)]
    pub(crate) fn is_class_member_start(&mut self) -> bool {
        if self.lexer.token == T::TAt {
            return true;
        }
        self.look_ahead(|p| {
            // The last token that could be the member's name, as (is a keyword, is `get` or `set`).
            let mut name: Option<(bool, bool)> = None;
            while p.is_modifier_kind() {
                if p.is_class_member_modifier() {
                    return true;
                }
                name = Some((p.is_keyword(), false));
                if !p.step() {
                    return false;
                }
            }
            if p.lexer.token == T::TAsterisk {
                return true;
            }
            if p.is_literal_property_name() {
                name = Some((p.is_keyword(), matches!(p.word(), b"get" | b"set")));
                if !p.step() {
                    return false;
                }
            }
            if p.lexer.token == T::TOpenBracket {
                return true;
            }
            match name {
                None => false,
                Some((is_keyword, is_accessor)) => {
                    !is_keyword
                        || is_accessor
                        || matches!(
                            p.lexer.token,
                            T::TOpenParen
                                | T::TLessThan
                                | T::TExclamation
                                | T::TColon
                                | T::TEquals
                                | T::TQuestion
                        )
                        || p.can_parse_semicolon()
                }
            }
        })
    }

    /// Lookahead with `scanTypeMemberStart`.
    #[cold]
    #[inline(never)]
    pub(crate) fn is_type_member_start(&mut self) -> bool {
        if matches!(self.lexer.token, T::TOpenParen | T::TLessThan)
            || matches!(self.word(), b"get" | b"set")
        {
            return true;
        }
        self.look_ahead(|p| {
            let mut has_name = false;
            while p.is_modifier_kind() {
                has_name = true;
                if !p.step() {
                    return false;
                }
            }
            if p.lexer.token == T::TOpenBracket {
                return true;
            }
            if p.is_literal_property_name() {
                has_name = true;
                if !p.step() {
                    return false;
                }
            }
            has_name
                && (matches!(
                    p.lexer.token,
                    T::TOpenParen | T::TLessThan | T::TQuestion | T::TColon | T::TComma
                ) || p.can_parse_semicolon())
        })
    }

    /// `isStartOfType`
    #[cold]
    #[inline(never)]
    pub(crate) fn is_start_of_type(&mut self, in_start_of_parameter: bool) -> bool {
        match self.lexer.token {
            T::TVoid
            | T::TNull
            | T::TThis
            | T::TTypeof
            | T::TOpenBrace
            | T::TOpenBracket
            | T::TLessThan
            | T::TBar
            | T::TAmpersand
            | T::TNew
            | T::TStringLiteral
            | T::TNumericLiteral
            | T::TBigIntegerLiteral
            | T::TTrue
            | T::TFalse
            | T::TAsterisk
            | T::TQuestion
            | T::TExclamation
            | T::TDotDotDot
            | T::TImport
            | T::TNoSubstitutionTemplateLiteral
            | T::TTemplateHead => true,
            T::TFunction => !in_start_of_parameter,
            T::TMinus => {
                !in_start_of_parameter
                    && self.look_ahead(|p| {
                        p.step()
                            && matches!(p.lexer.token, T::TNumericLiteral | T::TBigIntegerLiteral)
                    })
            }
            T::TOpenParen => {
                !in_start_of_parameter
                    && self.look_ahead(|p| {
                        p.step()
                            && (p.lexer.token == T::TCloseParen
                                || p.is_start_of_parameter()
                                || p.is_start_of_type(false))
                    })
            }
            // Type keywords such as `string` are identifiers in this lexer.
            _ => self.is_identifier_in_context(),
        }
    }

    /// `isStartOfParameter`
    #[cold]
    #[inline(never)]
    pub(crate) fn is_start_of_parameter(&mut self) -> bool {
        self.lexer.token == T::TDotDotDot
            || self.is_binding_identifier_or_pattern()
            || self.is_modifier_kind()
            || self.lexer.token == T::TAt
            || self.is_start_of_type(true)
    }

    /// `isHeritageClause`
    fn is_heritage_clause(&self) -> bool {
        self.lexer.token == T::TExtends || self.word() == b"implements"
    }

    /// `isHeritageClauseExtendsOrImplementsKeyword`
    fn is_heritage_clause_keyword(&mut self) -> bool {
        self.is_heritage_clause()
            && self.look_ahead(|p| p.step() && p.is_start_of_expression_or_shift_assign())
    }

    /// `isListElement`
    #[cold]
    #[inline(never)]
    pub(crate) fn is_list_element(&mut self, kind: ListKind, recovering: bool) -> bool {
        let token = self.lexer.token;
        match kind {
            ListKind::SourceElements
            | ListKind::BlockStatements
            | ListKind::SwitchClauseStatements => {
                !(token == T::TSemicolon && recovering) && self.is_start_of_statement()
            }
            ListKind::SwitchClauses => matches!(token, T::TCase | T::TDefault),
            ListKind::TypeMembers => self.is_type_member_start(),
            ListKind::ClassMembers => {
                self.is_class_member_start() || token == T::TSemicolon && !recovering
            }
            ListKind::EnumMembers => token == T::TOpenBracket || self.is_literal_property_name(),
            // `.` is not a member, but it should not end the object literal either.
            ListKind::ObjectLiteralMembers => {
                matches!(
                    token,
                    T::TOpenBracket | T::TAsterisk | T::TDotDotDot | T::TDot
                ) || self.is_literal_property_name()
            }
            ListKind::ObjectBindingElements => {
                matches!(token, T::TOpenBracket | T::TDotDotDot) || self.is_literal_property_name()
            }
            ListKind::ImportAttributes => {
                self.is_identifier_or_keyword() || token == T::TStringLiteral
            }
            ListKind::JsxAttributes => self.is_identifier_or_keyword() || token == T::TOpenBrace,
            ListKind::JsxChildren => true,
            ListKind::HeritageClauseElement => {
                if token == T::TOpenBrace {
                    // `isValidHeritageClauseObjectLiteral`
                    return self.look_ahead(|p| {
                        if !p.step() {
                            return false;
                        }
                        if p.lexer.token != T::TCloseBrace {
                            return true;
                        }
                        p.step()
                            && (matches!(p.lexer.token, T::TComma | T::TOpenBrace | T::TExtends)
                                || p.word() == b"implements")
                    });
                }
                let starts = if recovering {
                    self.is_identifier_in_context()
                } else {
                    self.is_start_of_left_hand_side_expression()
                };
                starts && !self.is_await_keyword() && !self.is_heritage_clause_keyword()
            }
            ListKind::VariableDeclarations => self.is_binding_identifier_or_pattern(),
            ListKind::ArrayBindingElements => {
                matches!(token, T::TComma | T::TDotDotDot)
                    || self.is_binding_identifier_or_pattern()
            }
            ListKind::TypeParameters => {
                matches!(token, T::TIn | T::TConst) || self.is_identifier_in_context()
            }
            ListKind::ArrayLiteralMembers => {
                matches!(token, T::TComma | T::TDot | T::TDotDotDot)
                    || self.is_start_of_expression_or_shift_assign()
            }
            ListKind::ArgumentExpressions => {
                token == T::TDotDotDot || self.is_start_of_expression_or_shift_assign()
            }
            ListKind::Parameters => self.is_start_of_parameter(),
            ListKind::TypeArguments | ListKind::TupleElementTypes => {
                token == T::TComma || self.is_start_of_type(false)
            }
            ListKind::HeritageClauses => self.is_heritage_clause(),
            ListKind::ImportOrExportSpecifiers => {
                if self.word() == b"from"
                    && self.look_ahead(|p| p.step() && p.lexer.token == T::TStringLiteral)
                {
                    return false;
                }
                token == T::TStringLiteral || self.is_identifier_or_keyword()
            }
        }
    }

    /// `isListTerminator`
    #[cold]
    #[inline(never)]
    pub(crate) fn is_list_terminator(&self, kind: ListKind) -> bool {
        let token = self.lexer.token;
        if token == T::TEndOfFile {
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
            | ListKind::ImportAttributes => token == T::TCloseBrace,
            ListKind::SwitchClauseStatements => {
                matches!(token, T::TCloseBrace | T::TCase | T::TDefault)
            }
            ListKind::HeritageClauseElement => {
                matches!(token, T::TOpenBrace | T::TExtends) || self.word() == b"implements"
            }
            ListKind::VariableDeclarations => {
                self.can_parse_semicolon()
                    || matches!(token, T::TIn | T::TEqualsGreaterThan)
                    || self.word() == b"of"
            }
            ListKind::TypeParameters => {
                matches!(
                    token,
                    T::TGreaterThan | T::TOpenParen | T::TOpenBrace | T::TExtends
                ) || self.word() == b"implements"
            }
            ListKind::ArgumentExpressions => matches!(token, T::TCloseParen | T::TSemicolon),
            ListKind::ArrayLiteralMembers
            | ListKind::TupleElementTypes
            | ListKind::ArrayBindingElements => token == T::TCloseBracket,
            ListKind::Parameters => matches!(token, T::TCloseParen | T::TCloseBracket),
            ListKind::TypeArguments => token != T::TComma,
            ListKind::HeritageClauses => matches!(token, T::TOpenBrace | T::TCloseBrace),
            ListKind::JsxAttributes => matches!(token, T::TGreaterThan | T::TSlash),
            // Never reached: every token is an element of this list.
            ListKind::JsxChildren => false,
        }
    }

    /// `isInSomeParsingContext`: whether any open list can start an element with, or end at, the current token.
    #[cold]
    #[inline(never)]
    pub(crate) fn is_in_some_parsing_context(&mut self) -> bool {
        let mut open = self.lexer.list_contexts;
        // `reparseTopLevelAwait` reparses a top-level statement that uses `await` as an identifier,
        // with no statement list open.
        if self.fn_or_arrow_data_parse.is_top_level && self.is_await_keyword() {
            self.lexer.await_name_seen = true;
            self.await_was_refused = true;
            // `parse_for_sema` reparses a script, with `await` as an identifier, if this is set.
            self.top_level_await_keyword = self.lexer.range();
        }
        if self.lexer.await_name_seen {
            open &= !(1 << ListKind::SourceElements as u32);
        }
        let found = ALL_LISTS.iter().any(|&kind| {
            open & 1 << kind as u32 != 0
                && (self.is_list_element(kind, true) || self.is_list_terminator(kind))
        });
        // The first parse ended its statement at this token. The reparse continues past it, into
        // the next statement.
        if !found
            && open != self.lexer.list_contexts
            && !self.await_was_refused
            && self.is_list_element(ListKind::SourceElements, true)
        {
            self.reparses_rest_of_file = true;
        }
        found
    }

    /// `await` where it is not an identifier (`isIdentifier`): in an [Await] context, which the top
    /// level of a module is when TypeScript reparses the statement.
    fn is_await_keyword(&self) -> bool {
        self.word() == b"await"
            && self.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
    }

    /// `parsingContextErrors`
    fn parsing_context_error(&self, kind: ListKind) -> u32 {
        match kind {
            // 'export' expected.
            ListKind::SourceElements if self.lexer.token == T::TDefault => 1005,
            ListKind::SourceElements | ListKind::BlockStatements => 1128,
            ListKind::SwitchClauses => 1130,
            ListKind::SwitchClauseStatements => 1129,
            ListKind::TypeMembers => 1131,
            ListKind::ClassMembers => 1068,
            ListKind::EnumMembers => 1132,
            ListKind::HeritageClauseElement => 1109,
            ListKind::VariableDeclarations => {
                if self.is_keyword() {
                    1389
                } else {
                    1134
                }
            }
            ListKind::ObjectBindingElements => 1180,
            ListKind::ArrayBindingElements => 1181,
            ListKind::ArgumentExpressions => 1135,
            ListKind::ObjectLiteralMembers => 1136,
            ListKind::ArrayLiteralMembers => 1137,
            ListKind::Parameters => {
                if self.is_keyword() {
                    1390
                } else {
                    1138
                }
            }
            ListKind::TypeParameters => 1139,
            ListKind::TypeArguments => 1140,
            ListKind::TupleElementTypes => 1110,
            ListKind::HeritageClauses => 1179,
            // '}' expected.
            ListKind::ImportOrExportSpecifiers if self.word() == b"from" => 1005,
            ListKind::ImportOrExportSpecifiers => 1003,
            ListKind::ImportAttributes => 1478,
            ListKind::JsxAttributes | ListKind::JsxChildren => 1003,
        }
    }

    /// `abortParsingListOrMoveToNextToken`. Call on a token that neither starts an element of `kind` nor ends the list. Reports the error,
    /// then returns true if an enclosing list can use the token, which ends this list without consuming it. Otherwise skips the token.
    #[cold]
    #[inline(never)]
    pub(crate) fn abort_list_or_skip(&mut self, kind: ListKind) -> Result<bool, Error> {
        let before = self.lexer.prev_error_loc;
        let range = self.lexer.range();
        match self.parsing_context_error(kind) {
            1005 if kind == ListKind::SourceElements => self.lexer.ts_expected(range, "export"),
            1005 => self.lexer.ts_expected(range, "}"),
            code => self.lexer.ts_error(range, code),
        }
        if self.is_in_some_parsing_context() {
            self.lexer.put_up_with(before)?;
            return Ok(true);
        }
        let is_less_than_slash = self.is_at_less_than_slash_token();
        self.lexer.next()?;
        // The `/` of `</`, unless this lexer scanned it as the start of a comment.
        if is_less_than_slash
            && self.lexer.token == T::TSlash
            && self.lexer.loc().start == range.loc.start + 1
        {
            self.lexer.next()?;
        }
        if !self.lexer.is_log_disabled {
            let next = self.lexer.loc();
            if SEMA && let Some(syntax) = &mut self.type_syntax {
                syntax.after_skipped.push(next);
            }
        }
        Ok(false)
    }

    /// Reports the missing comma after the element that started at `element_start` (end of the loop in `parseDelimitedList`).
    #[cold]
    #[inline(never)]
    fn report_missing_comma(
        &mut self,
        kind: ListKind,
        element_start: bun_ast::Loc,
    ) -> Result<(), Error> {
        if kind == ListKind::EnumMembers {
            // An enum member name must be followed by a ',', '=', or '}'.
            let range = self.lexer.range();
            self.lexer.ts_error(range, 1357);
        } else {
            self.lexer.expect(T::TComma)?;
        }
        // `{ a; b }`: treat the semicolon as the intended comma.
        if matches!(
            kind,
            ListKind::ObjectLiteralMembers | ListKind::ImportAttributes
        ) && self.lexer.token == T::TSemicolon
            && !self.lexer.has_newline_before
        {
            self.lexer.next()?;
        }
        // Skip a token if the element consumed nothing, to guarantee progress.
        if self.lexer.loc() == element_start {
            self.lexer.next()?;
        }
        Ok(())
    }
}

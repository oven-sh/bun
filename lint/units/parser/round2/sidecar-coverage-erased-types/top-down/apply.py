#!/usr/bin/env python3
"""Applies the prototype "payloads of erased interfaces, type aliases and class index signatures" to a COPY of src/js_parser.

usage: apply.py <copy of src/js_parser>      (never the worktree: see build-scratch.sh)
Every edit is an exact, single replacement against be1ebe5295: a text that is not found once stops the script.
The tests of the prototype are applied by apply_tests.py.
"""
import sys
from pathlib import Path

root = Path(sys.argv[1])


def edit(rel, old, new, count=1):
    path = root / rel
    text = path.read_text()
    found = text.count(old)
    if found != count:
        sys.exit(f"{rel}: expected {count} of {old[:70]!r}, found {found}")
    path.write_text(text.replace(old, new))


# ───────────────────────── parse/erased.rs: the payloads ─────────────────────────
E = "parse/erased.rs"
edit(E, """use bun_alloc::Arena;
use bun_ast::{
    ClauseItem, Expr, ExprData, G, Loc, Range, Scope, Source, Stmt, StmtData, StoreRef, StoreSlice,
    StoreStr,
};

use crate::lexer::{self as js_lexer, Lexer};
use crate::parser::{ParsedPath, ScopeOrder};
""", """use bun_alloc::Arena;
use bun_ast::op::Level;
use bun_ast::ts;
use bun_ast::{
    ClauseItem, Expr, ExprData, G, Loc, Range, Scope, Source, Stmt, StmtData, StoreRef, StoreSlice,
    StoreStr,
};

use crate::Error;
use crate::lexer::{self as js_lexer, Lexer, T};
use crate::p::P;
use crate::parser::{ParseStatementOptions, ParsedPath, ScopeOrder};
""")
edit(E, """pub enum ErasedData {
    Interface(Name),
    TypeAlias(Name),
""", """pub enum ErasedData {
    Interface(StoreRef<InterfaceDeclaration>),
    TypeAlias(StoreRef<TypeAliasDeclaration>),
""")
edit(E, """/// A string literal: the range holds the quotes, `value` is what it says.
#[derive(Clone, Copy)]
pub struct StringLiteral {""", """/// `interface name<T> extends A { .. }`: its type parameters are `Generics::type_parameters_of(&name)`.
#[derive(Clone, Copy)]
pub struct InterfaceDeclaration {
    pub name: Name,
    /// The clauses in the order of the source: an entry of `extends` is a `TypeReference` where a name stands alone, else an `ExpressionWithTypeArguments`.
    pub heritage_clauses: StoreSlice<ts::HeritageClause>,
    /// From the offset after the `{` to the end of the last member.
    pub members: ts::List<ts::Member>,
}

/// `type name<T> = type_node`: its type parameters are `Generics::type_parameters_of(&name)`.
#[derive(Clone, Copy)]
pub struct TypeAliasDeclaration {
    pub name: Name,
    /// `KeywordKind::Intrinsic` for `intrinsic` alone.
    pub type_node: ts::Type,
}

/// A string literal: the range holds the quotes, `value` is what it says.
#[derive(Clone, Copy)]
pub struct StringLiteral {""")
edit(E, """    /// An index signature: the parse pass builds nothing of it.
    IndexSignature,
}""", """    /// An index signature: its decorators and modifier keywords, its parameters from the offset after the `[`, and its type.
    IndexSignature(StoreRef<ts::IndexSignature>),
}""")
edit(E, """    /// Records what `skip_type_script_type_stmt` read: what it held, or else the type alias `name`.
    #[cold]
    #[inline(never)]
    pub(crate) fn statement_after_type(
        &mut self,
        cursor: Cursor<'_>,
        loc: Loc,
        flags: ErasedFlags,
        exported: Exported,
        name: Name,
    ) {
        match self.held.take() {
            Some(data) => {
                self.statement(
                    cursor,
                    loc,
                    flags | ErasedFlags::TYPE_ONLY,
                    Exported::No,
                    data,
                );
            }
            None => self.statement(cursor, loc, flags, exported, ErasedData::TypeAlias(name)),
        }
    }
""", """    /// Records what was read after `type`: what `skip_type_script_type_stmt` held of an export clause, or else the type alias.
    #[cold]
    #[inline(never)]
    pub(crate) fn statement_after_type(
        &mut self,
        cursor: Cursor<'_>,
        loc: Loc,
        flags: ErasedFlags,
        exported: Exported,
        alias: Option<StoreRef<TypeAliasDeclaration>>,
    ) {
        match (self.held.take(), alias) {
            (Some(data), _) => {
                self.statement(
                    cursor,
                    loc,
                    flags | ErasedFlags::TYPE_ONLY,
                    Exported::No,
                    data,
                );
            }
            (None, Some(alias)) => {
                self.statement(cursor, loc, flags, exported, ErasedData::TypeAlias(alias));
            }
            (None, None) => {}
        }
    }
""")
edit(E, """    /// Adds `flags` to the member that `parse_property` left out and `parse_class` has not placed yet.
    #[cold]
    pub(crate) fn member_modifier(&mut self, flags: ErasedFlags) {
        match self.members.last_mut() {
            Some(member) if member.class_body == UNPLACED => member.flags |= flags,
            // Nothing was built of the member: it is an index signature.
            _ => self.member(flags, ErasedMemberData::IndexSignature),
        }
    }

    /// Places the member that `parse_property` left out: it starts at `first`, after `index` members of the body at `body`.
    #[cold]
    #[inline(never)]
    pub(crate) fn member_read(
        &mut self,
        cursor: Cursor<'_>,
        first: Loc,
        body: Loc,
        index: usize,
        is_static: bool,
    ) {
        let is_recorded = self
            .members
            .last()
            .is_some_and(|member| member.class_body == UNPLACED);
        if !is_recorded {
            // Nothing was built of the member: it is an index signature.
            self.member(ErasedFlags::empty(), ErasedMemberData::IndexSignature);
        }
        if let Some(member) = self.members.last_mut() {
            member.start = offset(first);
            member.end = cursor.end();
            member.class_body = offset(body);
            member.index = offset_of(index);
            member.flags |= ErasedFlags::member(is_static);
        }
    }
""", """    /// Records the index signature of a class that the parser read: `member_read` places it and finds its modifiers.
    #[cold]
    #[inline(never)]
    pub(crate) fn member_index_signature(&mut self, arena: &Arena, signature: ts::IndexSignature) {
        let signature = StoreRef::from_bump(arena.alloc(signature));
        self.member(
            ErasedFlags::empty(),
            ErasedMemberData::IndexSignature(signature),
        );
    }

    /// Adds `flags` to the member that `parse_property` left out and `parse_class` has not placed yet.
    #[cold]
    pub(crate) fn member_modifier(&mut self, flags: ErasedFlags) {
        if let Some(member) = self.unplaced() {
            member.flags |= flags;
        }
    }

    /// Places the member that `parse_property` left out: it starts at `first`, where `decorators` start, after `index` members of the body at `body`.
    #[cold]
    #[inline(never)]
    pub(crate) fn member_read(
        &mut self,
        cursor: Cursor<'_>,
        arena: &Arena,
        first: Loc,
        body: Loc,
        index: usize,
        is_static: bool,
        decorators: &[Expr],
    ) {
        let Some(member) = self.unplaced() else {
            return;
        };
        member.start = offset(first);
        member.end = cursor.end();
        member.class_body = offset(body);
        member.index = offset_of(index);
        member.flags |= ErasedFlags::member(is_static);
        if let ErasedMemberData::IndexSignature(mut signature) = member.data {
            // The words between the decorators and the `[` are the modifiers that `parse_property` read past.
            let open_bracket = signature.parameters.start.saturating_sub(1);
            let modifiers =
                modifiers_of_index_signature(cursor, member.start, open_bracket, decorators);
            signature.modifiers = StoreSlice::new_mut(arena.alloc_slice_copy(&modifiers));
        }
    }

    /// The member that `parse_property` recorded and `parse_class` has not placed yet.
    fn unplaced(&mut self) -> Option<&mut ErasedMember> {
        self.members
            .last_mut()
            .filter(|member| member.class_body == UNPLACED)
    }
""")
edit(E, """fn offset(loc: Loc) -> u32 {
    u32::try_from(loc.start).unwrap_or(0)
}

fn offset_of(at: usize) -> u32 {
    u32::try_from(at).unwrap_or(u32::MAX)
}
""", """/// What a site of a lint parse calls where a parse without lint skips a statement or a class member that leaves no node: it is built and recorded.
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// The lexer is after `type`: reads what `skip_type_script_type_stmt` reads, with the type of an alias built, and records the statement at `loc`.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_type_stmt(
        &mut self,
        opts: &mut ParseStatementOptions,
        loc: Loc,
        flags: ErasedFlags,
        exported: Exported,
    ) -> Result<(), Error> {
        // `export type { a }` and `export type * from "m"` have no type: their clause and path are held.
        let is_export_clause =
            opts.is_export && matches!(self.lexer.token, T::TOpenBrace | T::TAsterisk);
        let alias = if is_export_clause {
            self.skip_type_script_type_stmt(opts)?;
            None
        } else {
            Some(self.lint_type_alias_declaration(opts)?)
        };
        if let Some(starts) = &mut self.starts_for_parse_only {
            let cursor = Cursor::at(&self.lexer);
            starts
                .erased
                .statement_after_type(cursor, loc, flags, exported, alias);
        }
        Ok(())
    }

    /// parseTypeAliasDeclaration, after `type`.
    fn lint_type_alias_declaration(
        &mut self,
        opts: &ParseStatementOptions,
    ) -> Result<StoreRef<TypeAliasDeclaration>, Error> {
        let name = Name::at(&self.lexer);
        let text = self.lexer.identifier;
        self.lexer.expect(T::TIdentifier)?;
        if opts.scope.is_module() {
            self.local_type_names.put(text, true)?;
        }
        self.lint_declaration_type_parameters(name.end)?;
        self.lexer.expect(T::TEquals)?;
        // `intrinsic` alone is the keyword: before a `.` it is a name.
        let is_intrinsic =
            self.lexer.is_contextual_keyword(b"intrinsic") && !self.build_next_token_is(T::TDot);
        let type_node = if is_intrinsic {
            let (start, end) = (offset_of(self.lexer.start), offset_of(self.lexer.end));
            self.lexer.next()?;
            ts::Type::keyword(ts::KeywordKind::Intrinsic, start, end)
        } else {
            self.build_type_script_type(Level::Lowest)?
        };
        self.lexer.expect_or_insert_semicolon()?;
        let alias = self.arena.alloc(TypeAliasDeclaration { name, type_node });
        Ok(StoreRef::from_bump(alias))
    }

    /// parseInterfaceDeclaration, after `interface`: builds the clauses and the members and records the statement at `loc`.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_interface_stmt(
        &mut self,
        opts: &mut ParseStatementOptions,
        loc: Loc,
        flags: ErasedFlags,
        exported: Exported,
    ) -> Result<(), Error> {
        let name = Name::at(&self.lexer);
        let text = self.lexer.identifier;
        self.lexer.expect(T::TIdentifier)?;
        if opts.scope.is_module() {
            self.local_type_names.put(text, true)?;
        }
        self.lint_declaration_type_parameters(name.end)?;
        let heritage_clauses = self.lint_interface_heritage_clauses()?;
        // parseObjectTypeMembers
        let members_start = offset_of(self.lexer.end);
        self.lexer.expect(T::TOpenBrace)?;
        let members = self.build_type_member_list(members_start)?;
        self.lexer.expect(T::TCloseBrace)?;
        let interface = self.arena.alloc(InterfaceDeclaration {
            name,
            heritage_clauses,
            members,
        });
        let data = ErasedData::Interface(StoreRef::from_bump(interface));
        if let Some(starts) = &mut self.starts_for_parse_only {
            let cursor = Cursor::at(&self.lexer);
            starts
                .erased
                .statement(cursor, loc, flags, exported, data);
        }
        Ok(())
    }

    /// parseIndexSignatureDeclaration of a class element: the lexer is after the `[` at `open_bracket`. Builds it and records it for `member_read`.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_class_index_signature(&mut self, open_bracket: Loc) -> Result<(), Error> {
        let list_start = offset(open_bracket).saturating_add(1);
        let (parameters, mut end) = self.build_parameter_list_rest(list_start, T::TCloseBracket)?;
        let mut type_node = None;
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            let annotation = self.build_type_script_type(Level::Lowest)?;
            end = annotation.end;
            type_node = Some(annotation);
        }
        self.build_type_member_semicolon(end)?;
        let signature = ts::IndexSignature {
            modifiers: StoreSlice::EMPTY,
            parameters,
            type_node,
        };
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.erased.member_index_signature(self.arena, signature);
        }
        Ok(())
    }
}

fn offset(loc: Loc) -> u32 {
    u32::try_from(loc.start).unwrap_or(0)
}

fn offset_of(at: usize) -> u32 {
    u32::try_from(at).unwrap_or(u32::MAX)
}

/// The decorators and the modifier keywords of the index signature that starts at `first` and whose `[` is at `open_bracket`, in the order of the source.
fn modifiers_of_index_signature(
    cursor: Cursor<'_>,
    first: u32,
    open_bracket: u32,
    decorators: &[Expr],
) -> Vec<ts::Modifier> {
    let (source, comments) = (cursor.source, cursor.comments);
    let keywords = modifiers_before(source, comments, first, open_bracket);
    let after_decorators = keywords
        .first()
        .map_or(open_bracket, |keyword| keyword.start);
    let starts: Vec<u32> = decorators
        .iter()
        .map(|decorator| at_sign_before(source, comments, offset(decorator.loc)))
        .collect();
    let mut modifiers = Vec::with_capacity(decorators.len() + keywords.len());
    for (at, (decorator, &start)) in decorators.iter().zip(&starts).enumerate() {
        // A decorator ends where the token before the next decorator, the first keyword or the `[` ends.
        let next = starts.get(at + 1).copied().unwrap_or(after_decorators);
        let end = token_end_before(source, comments, next);
        modifiers.push(ts::Modifier::decorator(*decorator, start, end));
    }
    modifiers.extend(keywords);
    modifiers
}

/// The modifier keywords that stand directly before `at` and not before `floor`, in the order of the source.
fn modifiers_before(source: &[u8], comments: &[Range], floor: u32, at: u32) -> Vec<ts::Modifier> {
    let mut modifiers = Vec::new();
    let mut end = token_end_before(source, comments, at) as usize;
    loop {
        let start = word_start(source, end);
        if start == end || offset_of(start) < floor {
            break;
        }
        let Some(kind) = source.get(start..end).and_then(modifier_kind) else {
            break;
        };
        // After `.`, `#` or `@` the word is a name inside a decorator.
        let before = token_end_before(source, comments, offset_of(start)) as usize;
        if before > 0 && matches!(source.get(before - 1), Some(&(b'.' | b'#' | b'@'))) {
            break;
        }
        modifiers.push(ts::Modifier::keyword(
            kind,
            offset_of(start),
            offset_of(end),
        ));
        end = before;
    }
    modifiers.reverse();
    modifiers
}

/// The modifier that `word` spells where `parse_property` reads past it before a class element.
fn modifier_kind(word: &[u8]) -> Option<ts::ModifierKind> {
    Some(match word {
        b"abstract" => ts::ModifierKind::Abstract,
        b"accessor" => ts::ModifierKind::Accessor,
        b"async" => ts::ModifierKind::Async,
        b"declare" => ts::ModifierKind::Declare,
        b"override" => ts::ModifierKind::Override,
        b"private" => ts::ModifierKind::Private,
        b"protected" => ts::ModifierKind::Protected,
        b"public" => ts::ModifierKind::Public,
        b"readonly" => ts::ModifierKind::Readonly,
        b"static" => ts::ModifierKind::Static,
        _ => return None,
    })
}
""")

# ───────────────────────── parse/generics.rs: heritage of an interface ─────────────────────────
G = "parse/generics.rs"
edit(G, """use bun_ast::{Expr, ExprData, Loc};
""", """use bun_ast::{Expr, ExprData, Loc, StoreSlice};
""")
edit(G, """use crate::parse::erased;
use crate::parse::wrappers::ExprId;
""", """use crate::parse::erased;
use crate::parse::syntax_errors::EXPRESSION_EXPECTED;
use crate::parse::wrappers::ExprId;
""")
edit(G, """        let mut entries: Vec<ts::Type> = Vec::new();
        let end;
        loop {
            let entry = self.lint_class_implements_entry()?;
            entries.push(entry);""", """        let mut entries: Vec<ts::Type> = Vec::new();
        let end;
        loop {
            let entry = self.lint_heritage_entry(true)?;
            entries.push(entry);""")
edit(G, """    /// An entry of `implements`: a type reference where one stands there, else an expression with its type arguments.
    fn lint_class_implements_entry(&mut self) -> Result<ts::Type, Error> {
        let start = self.lexer.snapshot();
        let logged = self.lint_logged();
        let recorded = self.sidecar_mark();
        self.lexer.is_log_disabled = true;
        let as_type = self.build_type_script_type(Level::Lowest);
        self.lexer.is_log_disabled = start.is_log_disabled;
        match as_type {
            Ok(type_node)
                if matches!(type_node.data, ts::TypeData::TypeReference(_))
                    && self.log().errors == logged.1
                    && matches!(self.lexer.token, T::TComma | T::TOpenBrace) =>
            {
                return Ok(type_node);
            }
            Err(err @ (Error::StackOverflow | Error::Alloc(_))) => return Err(err),
            _ => {}
        }
""", """    /// parseHeritageClauses of an interface, at `extends` or `implements` or where no clause stands: builds the clauses.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_interface_heritage_clauses(
        &mut self,
    ) -> Result<StoreSlice<ts::HeritageClause>, Error> {
        let mut clauses: Vec<ts::HeritageClause> = Vec::new();
        while self.lexer.token == T::TExtends || self.lexer.is_contextual_keyword(b"implements") {
            let is_extends = self.lexer.token == T::TExtends;
            let keyword = offset_of(self.lexer.start);
            // A clause without an entry ends with its keyword.
            let mut end = offset_of(self.lexer.end);
            self.lexer.next()?;
            let start = offset_of(self.lexer.start);
            let mut entries: Vec<ts::Type> = Vec::new();
            loop {
                // isListElement of PCHeritageClauseElement: braces that are no object literal hold the members.
                let is_entry = if self.lexer.token == T::TOpenBrace {
                    self.is_valid_heritage_clause_object_literal()
                } else {
                    self.is_start_of_left_hand_side_expression()
                        && !self.is_heritage_clause_keyword()
                };
                if !is_entry {
                    if self.is_end_of_heritage_clause() {
                        break;
                    }
                    self.unexpected_as(EXPRESSION_EXPECTED)?;
                    return Err(Error::SyntaxError);
                }
                // isTypeHeritageClause: only an entry of `extends` is read as a type reference.
                let entry = self.lint_heritage_entry(is_extends)?;
                entries.push(entry);
                end = entry.end;
                if self.lexer.token == T::TComma {
                    end = offset_of(self.lexer.end);
                    self.lexer.next()?;
                    continue;
                }
                if self.is_end_of_heritage_clause() {
                    break;
                }
                self.lexer.expected(T::TComma)?;
                return Err(Error::SyntaxError);
            }
            clauses.push(ts::HeritageClause {
                start: keyword,
                end,
                token: if is_extends {
                    ts::HeritageToken::Extends
                } else {
                    ts::HeritageToken::Implements
                },
                types: ts::List::from_slice(self.arena, &entries, start, end.max(start)),
            });
        }
        Ok(StoreSlice::new_mut(self.arena.alloc_slice_copy(&clauses)))
    }

    /// isListTerminator of PCHeritageClauseElement: the members, another clause, or the end of the file.
    fn is_end_of_heritage_clause(&self) -> bool {
        matches!(
            self.lexer.token,
            T::TOpenBrace | T::TExtends | T::TEndOfFile
        ) || self.lexer.is_contextual_keyword(b"implements")
    }

    /// isHeritageClauseExtendsOrImplementsKeyword: `extends` or `implements` before what starts an expression.
    fn is_heritage_clause_keyword(&mut self) -> bool {
        if self.lexer.token != T::TExtends && !self.lexer.is_contextual_keyword(b"implements") {
            return false;
        }
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let is_keyword = self.lexer.next().is_ok() && self.is_start_of_expression();
        self.lexer.restore(&old_lexer);
        is_keyword
    }

    /// An entry of a heritage clause. `reads_type`: a type reference where one stands there, else an expression with its type arguments.
    fn lint_heritage_entry(&mut self, reads_type: bool) -> Result<ts::Type, Error> {
        let start = self.lexer.snapshot();
        let logged = self.lint_logged();
        let recorded = self.sidecar_mark();
        if reads_type {
            self.lexer.is_log_disabled = true;
            let as_type = self.build_heritage_type();
            self.lexer.is_log_disabled = start.is_log_disabled;
            match as_type {
                Ok(type_node)
                    if self.log().errors == logged.1
                        && self.is_end_of_heritage_clause_element() =>
                {
                    if let Some(reference) = self.build_heritage_type_reference(type_node) {
                        return Ok(reference);
                    }
                }
                Err(err @ (Error::StackOverflow | Error::Alloc(_))) => return Err(err),
                _ => {}
            }
        }
""")
edit(G, """    /// The lexer is on the `<` after the name of an interface or of a type alias: reads the type parameters and records them.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_declaration_type_parameters(&mut self) -> Result<(), Error> {
        let less_than = self.lexer.loc();
        let name_end = ts::full_start(
            self.lexer.contents,
            &self.lexer.all_comments,
            offset_of(self.lexer.start),
        );
        if let Some((list, end)) = self.build_type_script_type_parameters()?""", """    /// Reads the type parameters of the interface or of the type alias whose name ends at `name_end`, if `<` starts them here, and records them.
    pub(crate) fn lint_declaration_type_parameters(&mut self, name_end: u32) -> Result<(), Error> {
        let less_than = self.lexer.loc();
        if let Some((list, end)) = self.build_type_script_type_parameters()?""")

# ───────────────────────── parse/type_sink.rs: entries that the readers above call ─────────────────────────
S = "parse/type_sink.rs"
edit(S, """    /// The parameters between `open` and `close`, and the offset after `close`.
    fn build_parameter_list(
        &mut self,
        open: T,
        close: T,
    ) -> Result<(ts::List<ts::Parameter>, u32), Error> {
        let start = self.lexer.end as u32;
        let mut items = Vec::new();
        let mut end = start;
        self.lexer.expect(open)?;
        while self.lexer.token != close {""", """    /// The parameters between `open` and `close`, and the offset after `close`.
    fn build_parameter_list(
        &mut self,
        open: T,
        close: T,
    ) -> Result<(ts::List<ts::Parameter>, u32), Error> {
        let start = self.lexer.end as u32;
        self.lexer.expect(open)?;
        self.build_parameter_list_rest(start, close)
    }

    /// The parameters up to `close`, in a list that starts at `start`, and the offset after `close`.
    pub(crate) fn build_parameter_list_rest(
        &mut self,
        start: u32,
        close: T,
    ) -> Result<(ts::List<ts::Parameter>, u32), Error> {
        let mut items = Vec::new();
        let mut end = start;
        while self.lexer.token != close {""")
edit(S, """    /// The members up to "}", in a list that starts at `start`.
    fn build_type_member_list(&mut self, start: u32) -> Result<ts::List<ts::Member>, Error> {""", """    /// The members up to "}", in a list that starts at `start`.
    pub(crate) fn build_type_member_list(
        &mut self,
        start: u32,
    ) -> Result<ts::List<ts::Member>, Error> {""")
edit(S, """    fn build_type_member_semicolon(&mut self, end: u32) -> Result<u32, Error> {""",
     """    pub(crate) fn build_type_member_semicolon(&mut self, end: u32) -> Result<u32, Error> {""")
edit(S, """    /// Whether `test` holds from the token the lexer is on. Nothing moves.""", """    /// Reads the type that an entry of a heritage clause starts with: the `extends` after it starts another clause and no conditional type.
    pub(crate) fn build_heritage_type(&mut self) -> Result<ts::Type, Error> {
        self.build_type_with_opts(
            Level::Lowest,
            SkipTypeOptionsBitset::only(SkipTypeOptions::DisallowConditionalTypes),
        )
    }

    /// The entry of a heritage clause that `node` is where the reference reads a name: a type reference, also for the name of a keyword type.
    pub(crate) fn build_heritage_type_reference(&self, node: ts::Type) -> Option<ts::Type> {
        match node.data {
            ts::TypeData::TypeReference(_) => Some(node),
            ts::TypeData::Keyword(kind)
                if !matches!(kind, ts::KeywordKind::Void | ts::KeywordKind::Intrinsic) =>
            {
                let name = ts::Name::new(keyword_text(kind), node.start, node.end);
                let payload = ts::TypeReference {
                    type_name: ts::EntityName::Identifier(name),
                    type_arguments: None,
                };
                Some(ts::Type::alloc(self.arena, payload, node.start, node.end))
            }
            _ => None,
        }
    }

    /// Whether `test` holds from the token the lexer is on. Nothing moves.""")

# ───────────────────────── parse/parse_skip_typescript.rs: the readers that skip no longer record ─────────────────────────
K = "parse/parse_skip_typescript.rs"
edit(K, """        if self.lexer.token == T::TLessThan {
            if self.starts_for_parse_only.is_some() {
                self.lint_declaration_type_parameters()?;
            } else {
                let _ = self.skip_type_script_type_parameters(
                    TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                        | TypeParameterFlag::ALLOW_EMPTY_TYPE_PARAMETERS,
                )?;
            }
        }
""", """        if self.lexer.token == T::TLessThan {
            let _ = self.skip_type_script_type_parameters(
                TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                    | TypeParameterFlag::ALLOW_EMPTY_TYPE_PARAMETERS,
            )?;
        }
""", count=2)
edit(K, """    /// isValidHeritageClauseObjectLiteral
    fn is_valid_heritage_clause_object_literal(&mut self) -> bool {""", """    /// isValidHeritageClauseObjectLiteral
    pub(crate) fn is_valid_heritage_clause_object_literal(&mut self) -> bool {""")
edit(K, """    fn is_end_of_heritage_clause_element(&self) -> bool {""",
     """    pub(crate) fn is_end_of_heritage_clause_element(&self) -> bool {""")

# ───────────────────────── the block of an accessor of a type: the sink that builds reads it too ─────────────────────────
edit(K, """    /// parseFunctionBlock of an accessor of a type, at "{".
    fn parse_function_block_of_accessor(&mut self) -> Result<(), Error> {""", """    /// parseFunctionBlock of an accessor of a type, at "{": the statements of the block.
    pub(crate) fn parse_function_block_of_accessor(
        &mut self,
    ) -> Result<bun_ast::StoreSlice<bun_ast::Stmt>, Error> {""")
edit(K, """        self.parse_fn_body(&mut data).map(|_| ())
    }""", """        Ok(self.parse_fn_body(&mut data)?.stmts)
    }""")
edit(K, """            Dropped::FunctionBlock => self.parse_function_block_of_accessor(),""",
     """            Dropped::FunctionBlock => self.parse_function_block_of_accessor().map(|_| ()),""")
edit(S, """        let name = self.build_property_name()?;
        let (type_parameters, parameters, type_node, end) = self.build_signature()?;
        let end = self.build_type_member_semicolon(end)?;
        Ok(if is_get {""", """        let name = self.build_property_name()?;
        let (type_parameters, parameters, type_node, end) = self.build_signature()?;
        // parseFunctionBlockOrSemicolon: the reference reads a block here, and its checker rejects it.
        let mut body = None;
        let end = if self.lexer.token == T::TOpenBrace {
            let block_start = self.lexer.start as u32;
            let (stmts, block_end) = self.build_in_type(Self::parse_function_block_of_accessor)?;
            body = Some(ts::Body {
                start: block_start,
                end: block_end,
                stmts,
            });
            block_end
        } else {
            self.build_type_member_semicolon(end)?
        };
        Ok(if is_get {""")
edit(S, """                type_node,
                body: None,
            };""", """                type_node,
                body,
            };""", count=2)

# ───────────────────────── typescript.rs: the predicates of the reference, for the heritage reader ─────────────────────────
Y = "typescript.rs"
edit(Y, """    fn is_start_of_left_hand_side_expression(&mut self) -> bool {""",
     """    pub(crate) fn is_start_of_left_hand_side_expression(&mut self) -> bool {""")
edit(Y, """    fn is_start_of_expression(&mut self) -> bool {""",
     """    pub(crate) fn is_start_of_expression(&mut self) -> bool {""")

# ───────────────────────── parse/parse_stmt.rs: the three statements ─────────────────────────
T_ = "parse/parse_stmt.rs"
edit(T_, """                                let name = p
                                    .starts_for_parse_only
                                    .is_some()
                                    .then(|| erased::Name::at(&p.lexer));
                                p.skip_type_script_type_stmt(&mut skipper)?;
                                if let Some(name) = name
                                    && let Some(starts) = &mut p.starts_for_parse_only
                                {
                                    starts.erased.statement_after_type(
                                        erased::Cursor::at(&p.lexer),
                                        loc,
                                        erased::ErasedFlags::ambient(opts.is_typescript_declare),
                                        erased::Exported::Here,
                                        name,
                                    );
                                }
                                return Ok(p.s(S::TypeScript {}, loc));""", """                                if p.starts_for_parse_only.is_some() {
                                    p.lint_type_stmt(
                                        &mut skipper,
                                        loc,
                                        erased::ErasedFlags::ambient(opts.is_typescript_declare),
                                        erased::Exported::Here,
                                    )?;
                                } else {
                                    p.skip_type_script_type_stmt(&mut skipper)?;
                                }
                                return Ok(p.s(S::TypeScript {}, loc));""")
edit(T_, """                    let name = p
                        .starts_for_parse_only
                        .is_some()
                        .then(|| erased::Name::at(&p.lexer));
                    p.skip_type_script_type_stmt(&mut stmt_opts)?;
                    if let Some(name) = name
                        && let Some(starts) = &mut p.starts_for_parse_only
                    {
                        starts.erased.statement_after_type(
                            erased::Cursor::at(&p.lexer),
                            loc,
                            erased::ErasedFlags::ambient(opts.is_typescript_declare),
                            erased::Exported::before(opts.is_export),
                            name,
                        );
                    }
                    return Ok(Some(p.s(S::TypeScript {}, loc)));""", """                    if p.starts_for_parse_only.is_some() {
                        p.lint_type_stmt(
                            &mut stmt_opts,
                            loc,
                            erased::ErasedFlags::ambient(opts.is_typescript_declare),
                            erased::Exported::before(opts.is_export),
                        )?;
                    } else {
                        p.skip_type_script_type_stmt(&mut stmt_opts)?;
                    }
                    return Ok(Some(p.s(S::TypeScript {}, loc)));""")
edit(T_, """                    let name = p
                        .starts_for_parse_only
                        .is_some()
                        .then(|| erased::Name::at(&p.lexer));
                    p.skip_type_script_interface_stmt(&mut stmt_opts)?;
                    if let Some(name) = name
                        && let Some(starts) = &mut p.starts_for_parse_only
                    {
                        starts.erased.statement(
                            erased::Cursor::at(&p.lexer),
                            loc,
                            erased::ErasedFlags::ambient(opts.is_typescript_declare),
                            erased::Exported::before(opts.is_export),
                            erased::ErasedData::Interface(name),
                        );
                    }
                    return Ok(Some(p.s(S::TypeScript {}, loc)));""", """                    if p.starts_for_parse_only.is_some() {
                        p.lint_interface_stmt(
                            &mut stmt_opts,
                            loc,
                            erased::ErasedFlags::ambient(opts.is_typescript_declare),
                            erased::Exported::before(opts.is_export),
                        )?;
                    } else {
                        p.skip_type_script_interface_stmt(&mut stmt_opts)?;
                    }
                    return Ok(Some(p.s(S::TypeScript {}, loc)));""")

# ───────────────────────── parse/parse_property.rs: the index signature of a class ─────────────────────────
R = "parse/parse_property.rs"
edit(R, """                    if Self::IS_TYPESCRIPT_ENABLED && opts.is_class && p.is_class_index_signature()
                    {
                        p.skip_class_index_signature()?;

                        // Skip this property entirely
                        return Ok(None);
                    }
""", """                    if Self::IS_TYPESCRIPT_ENABLED && opts.is_class && p.is_class_index_signature()
                    {
                        if p.starts_for_parse_only.is_none() {
                            p.skip_class_index_signature()?;

                            // Skip this property entirely
                            return Ok(None);
                        }
                        // After `get`, `set` or `*` the reference reads a name in brackets: a lint parse reads no index signature there.
                        if !matches!(kind, PropertyKind::Get | PropertyKind::Set) && !opts.is_generator {
                            p.lint_class_index_signature(key_range.loc)?;
                            return Ok(None);
                        }
                    }
""")
edit(R, """                        // Handle index signatures
                        if p.lexer.token == T::TColon && was_identifier && opts.is_class {""",
     """                        // Handle index signatures: `[a!: T]: U` is none for the reference, so a lint parse asks for the "]"
                        if p.lexer.token == T::TColon
                            && was_identifier
                            && opts.is_class
                            && !p.is_lint_parse()
                        {""")

# ───────────────────────── parse/mod.rs: parse_class hands the arena to member_read ─────────────────────────
M = "parse/mod.rs"
edit(M, """                        starts.erased.member_read(
                            erased::Cursor::at(&p.lexer),
                            first_decorator_loc,
                            body_loc,
                            properties.len(),
                            opts.is_static,
                        );""", """                        starts.erased.member_read(
                            erased::Cursor::at(&p.lexer),
                            p.arena,
                            first_decorator_loc,
                            body_loc,
                            properties.len(),
                            opts.is_static,
                            &opts.ts_decorators,
                        );""")
print("applied")

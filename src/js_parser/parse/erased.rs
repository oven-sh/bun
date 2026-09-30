//! Statements and class members that the parse pass leaves out of the tree, kept for a lint parse.

use bun_alloc::Arena;
use bun_ast::ts::Metadata;
use bun_ast::{
    ClauseItem, Expr, ExprData, G, Loc, Range, Scope, Source, Stmt, StmtData, StoreRef, StoreSlice,
    StoreStr,
};

use crate::lexer::{self as js_lexer, Lexer};
use crate::parser::{ParsedPath, ScopeOrder};

/// Where an erased statement stood.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Place {
    /// Before the statement at `index` of the statements of the file.
    Module { index: u32 },
    /// Before the statement at `index` of the list whose scope the parse pass pushed at `scope`.
    Scope { scope: u32, index: u32 },
    /// Before the statement at `index` of the statements of the erased statement that starts at `parent`.
    Erased { parent: u32, index: u32 },
    /// Not in a list: the tree has a statement at `loc` in its place.
    InTree { loc: u32 },
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
    pub struct ErasedFlags: u16 {
        const EXPORT = 1 << 0;
        const DEFAULT = 1 << 1;
        const DECLARE = 1 << 2;
        /// `declare`, or inside a `declare` block.
        const AMBIENT = 1 << 3;
        const ABSTRACT = 1 << 4;
        /// `import type`, `export type`.
        const TYPE_ONLY = 1 << 5;
        /// The inner part of a dotted namespace name.
        const NESTED = 1 << 6;
        /// `export declare var` in a namespace: the tree has an `S::Local` of the names at `Place::InTree`.
        const STAND_IN = 1 << 7;
        const NO_BODY = 1 << 8;
        const STATIC = 1 << 9;
    }
}

impl ErasedFlags {
    /// `AMBIENT` for a statement that a `declare` block holds.
    #[inline]
    pub(crate) fn ambient(is_ambient: bool) -> ErasedFlags {
        if is_ambient {
            ErasedFlags::AMBIENT
        } else {
            ErasedFlags::empty()
        }
    }

    /// `STATIC` for a class member after `static`.
    fn member(is_static: bool) -> ErasedFlags {
        if is_static {
            ErasedFlags::STATIC
        } else {
            ErasedFlags::empty()
        }
    }
}

/// A statement that the parse pass leaves out of the statement list.
#[derive(Clone, Copy)]
pub struct Erased {
    /// Offset of its first token: a decorator, `export`, `declare`, or its keyword.
    pub start: u32,
    /// Offset after its last token, the `;` included.
    pub end: u32,
    pub place: Place,
    pub flags: ErasedFlags,
    pub data: ErasedData,
}

#[derive(Clone, Copy)]
pub enum ErasedData {
    Interface(Name),
    TypeAlias(Name),
    /// A function without a body, or what follows `declare`: a function, class, variable statement, enum or `;`.
    Declaration(Stmt),
    Module(StoreRef<ModuleDeclaration>),
    /// `export as namespace name`.
    NamespaceExport(Name),
    Import(StoreRef<ImportDeclaration>),
    ImportEquals(StoreRef<ImportEqualsDeclaration>),
    Export(StoreRef<ExportDeclaration>),
}

/// An identifier, or a keyword read as a name.
#[derive(Clone, Copy)]
pub struct Name {
    pub start: u32,
    pub end: u32,
    /// The name without escapes.
    pub text: StoreStr,
}

/// A string literal: the range holds the quotes, `value` is what it says.
#[derive(Clone, Copy)]
pub struct StringLiteral {
    pub start: u32,
    pub end: u32,
    pub value: StoreStr,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModuleKeyword {
    Namespace,
    Module,
    Global,
}

#[derive(Clone, Copy)]
pub enum ModuleName {
    Identifier(Name),
    /// `declare module "name"`, a wildcard pattern included.
    String(StringLiteral),
}

/// A namespace or module that leaves no statement. The inner part of a dotted name is a record of its own.
#[derive(Clone, Copy)]
pub struct ModuleDeclaration {
    pub keyword: ModuleKeyword,
    pub name: ModuleName,
    /// The statements that the parse pass keeps of the body. `None`: `declare module "m";`.
    pub body: Option<StoreSlice<Stmt>>,
}

#[derive(Clone, Copy)]
pub enum ImportClause {
    /// `import type name from "m"`.
    Default(Name),
    /// `import type * as name from "m"`.
    Namespace(Name),
    /// The names in braces that are not marked `type`.
    Named(StoreSlice<ClauseItem>),
}

#[derive(Clone, Copy)]
pub struct ImportDeclaration {
    /// Offset of the `type` after `import`.
    pub type_keyword: Option<u32>,
    pub clause: ImportClause,
    pub module_specifier: StringLiteral,
}

#[derive(Clone, Copy)]
pub enum ModuleReference {
    /// `require("m")`: the string, as the parse pass built it.
    External(Expr),
    /// A name or a dotted name, as the parse pass built it.
    Entity(Expr),
}

#[derive(Clone, Copy)]
pub struct ImportEqualsDeclaration {
    pub name: Name,
    pub module_reference: ModuleReference,
}

#[derive(Clone, Copy)]
pub enum ExportClause {
    /// `export type * from "m"`.
    Star,
    /// `export type * as name from "m"`: the range of a name in quotes holds the quotes.
    Namespace(Name),
    /// The names in braces that are not marked `type`.
    Named(StoreSlice<ClauseItem>),
}

#[derive(Clone, Copy)]
pub struct ExportDeclaration {
    pub clause: ExportClause,
    pub module_specifier: Option<StringLiteral>,
}

/// A class member that the parse pass leaves out of `G::Class::properties`.
#[derive(Clone, Copy)]
pub struct ErasedMember {
    /// Offset of its first token: a decorator, a modifier, or its name.
    pub start: u32,
    /// Offset after its last token, the `;` included.
    pub end: u32,
    /// `G::Class::body_loc`.
    pub class_body: u32,
    /// How many members `G::Class::properties` has before it.
    pub index: u32,
    pub flags: ErasedFlags,
    pub data: ErasedMemberData,
}

#[derive(Clone, Copy)]
pub enum ErasedMemberData {
    /// An overload, or an abstract or declared member, as the parse pass built it.
    Property(StoreRef<G::Property>),
    /// An index signature: the parse pass builds nothing of it.
    IndexSignature,
}

/// The `class_body` of a member that `parse_class` has not placed yet.
const UNPLACED: u32 = u32::MAX;

/// The statements and class members that a lint parse reads and the tree does not hold.
#[derive(Default)]
pub struct ErasedTables {
    /// In the order the parse pass finishes them: a statement follows the statements inside it.
    pub statements: Vec<Erased>,
    /// In the order the parse pass finishes them.
    pub members: Vec<ErasedMember>,
    /// The clause and path of `export type`, from `skip_type_script_type_stmt` to the caller that records them.
    held: Option<ErasedData>,
    /// The lists around the statement being read that a record asked for, outermost first.
    lists: Vec<ListFrame>,
}

/// How many records a parse had made at one point.
#[derive(Clone, Copy)]
pub(crate) struct ErasedMark {
    statements: u32,
    members: u32,
}

/// What the offsets of a record are read from: the source, its comments, and where the next token starts.
#[derive(Clone, Copy)]
pub(crate) struct Cursor<'s> {
    source: &'s [u8],
    comments: &'s [Range],
    next: u32,
}

impl<'s> Cursor<'s> {
    #[inline]
    pub(crate) fn at(lexer: &'s Lexer<'_>) -> Cursor<'s> {
        Cursor {
            source: lexer.contents,
            comments: &lexer.all_comments,
            next: offset_of(lexer.start),
        }
    }

    /// The end of the last token that the lexer read past.
    fn end(self) -> u32 {
        token_end_before(self.source, self.comments, self.next)
    }
}

/// Whether `export` belongs to a statement.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Exported {
    No,
    /// The placeholder of the statement is at its `export`.
    Here,
    /// The options say so: the keyword stands before the statement, or before a block around it.
    Before,
}

impl Exported {
    #[inline]
    pub(crate) fn before(is_export: bool) -> Exported {
        if is_export {
            Exported::Before
        } else {
            Exported::No
        }
    }
}

/// The scopes that say which statement list the parser is in.
#[derive(Clone, Copy)]
pub(crate) struct Scopes<'s, 'a> {
    pub(crate) current: StoreRef<Scope>,
    pub(crate) module: StoreRef<Scope>,
    pub(crate) in_order: &'s [Option<ScopeOrder<'a>>],
}

/// A statement list: the one of the file, or the one whose scope the parse pass pushed at an offset.
#[derive(Clone, Copy, PartialEq, Eq)]
enum List {
    Module,
    Scope(u32),
}

impl List {
    fn place(self, index: u32) -> Place {
        match self {
            List::Module => Place::Module { index },
            List::Scope(scope) => Place::Scope { scope, index },
        }
    }

    /// The index of `place` when it is in this list.
    fn index_of(self, place: Place) -> Option<u32> {
        match (self, place) {
            (List::Module, Place::Module { index }) => Some(index),
            (List::Scope(list), Place::Scope { scope, index }) if list == scope => Some(index),
            _ => None,
        }
    }
}

/// A scope with a statement list, where `scopes_in_order` has it, and the offset it was pushed at.
struct ListFrame {
    scope: usize,
    loc: u32,
    order: u32,
}

impl Name {
    /// The identifier or keyword that the lexer is on.
    #[inline]
    pub(crate) fn at(lexer: &Lexer<'_>) -> Name {
        Name::here(lexer, lexer.identifier)
    }

    /// The token that the lexer is on, read as the name `text`.
    #[inline]
    pub(crate) fn here(lexer: &Lexer<'_>, text: &[u8]) -> Name {
        Name {
            start: offset_of(lexer.start),
            end: offset_of(lexer.end),
            text: StoreStr::new(text),
        }
    }

    /// The identifier or keyword at `loc`, which the lexer read as `text`.
    pub(crate) fn of(source: &Source, loc: Loc, text: &[u8]) -> Name {
        let range = js_lexer::range_of_identifier(source, loc);
        Name {
            start: offset(range.loc),
            end: offset(range.end()),
            text: StoreStr::new(text),
        }
    }
}

impl StringLiteral {
    /// The string literal that the lexer is on, which says `value`.
    #[inline]
    pub(crate) fn at(lexer: &Lexer<'_>, value: &[u8]) -> StringLiteral {
        StringLiteral {
            start: offset_of(lexer.start),
            end: offset_of(lexer.end),
            value: StoreStr::new(value),
        }
    }

    /// The module path that `parse_path` read.
    fn of_path(source: &[u8], path: ParsedPath<'_>) -> StringLiteral {
        let start = offset(path.loc);
        StringLiteral {
            start,
            end: string_literal_end(source, start),
            value: StoreStr::new(path.text),
        }
    }
}

impl ErasedData {
    /// An export statement that exports only types.
    pub(crate) fn export(
        cursor: Cursor<'_>,
        arena: &Arena,
        clause: ExportClause,
        path: Option<ParsedPath<'_>>,
    ) -> ErasedData {
        ErasedData::Export(StoreRef::from_bump(arena.alloc(ExportDeclaration {
            clause,
            module_specifier: path.map(|path| StringLiteral::of_path(cursor.source, path)),
        })))
    }
}

impl ErasedTables {
    pub(crate) fn mark(&self) -> ErasedMark {
        ErasedMark {
            statements: offset_of(self.statements.len()),
            members: offset_of(self.members.len()),
        }
    }

    /// Drops every record made since `mark`.
    pub(crate) fn rewind(&mut self, mark: ErasedMark) {
        self.statements.truncate(mark.statements as usize);
        self.members.truncate(mark.members as usize);
        self.held = None;
    }

    /// Keeps the clause and path of `export type` for `statement_after_type`.
    #[cold]
    pub(crate) fn hold(&mut self, data: ErasedData) {
        self.held = Some(data);
    }

    /// Records the statement whose placeholder is at `loc`.
    #[cold]
    #[inline(never)]
    pub(crate) fn statement(
        &mut self,
        cursor: Cursor<'_>,
        loc: Loc,
        flags: ErasedFlags,
        exported: Exported,
        data: ErasedData,
    ) {
        self.push(cursor, offset(loc), None, flags, exported, data);
    }

    /// Records what `skip_type_script_type_stmt` read: what it held, or else the type alias `name`.
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

    /// Records an import statement that binds only types: `type_keyword` is where the `type` after `import` is.
    #[cold]
    #[inline(never)]
    pub(crate) fn import(
        &mut self,
        cursor: Cursor<'_>,
        arena: &Arena,
        loc: Loc,
        is_ambient: bool,
        type_keyword: Option<Loc>,
        clause: ImportClause,
        path: ParsedPath<'_>,
    ) {
        let mut flags = ErasedFlags::ambient(is_ambient);
        if type_keyword.is_some() {
            flags |= ErasedFlags::TYPE_ONLY;
        }
        let import = arena.alloc(ImportDeclaration {
            type_keyword: type_keyword.map(offset),
            clause,
            module_specifier: StringLiteral::of_path(cursor.source, path),
        });
        let data = ErasedData::Import(StoreRef::from_bump(import));
        self.statement(cursor, loc, flags, Exported::No, data);
    }

    /// Records an export statement whose names are all marked `type`.
    #[cold]
    #[inline(never)]
    pub(crate) fn export(
        &mut self,
        cursor: Cursor<'_>,
        arena: &Arena,
        loc: Loc,
        is_ambient: bool,
        path: Option<ParsedPath<'_>>,
    ) {
        let clause = ExportClause::Named(StoreSlice::EMPTY);
        let data = ErasedData::export(cursor, arena, clause, path);
        let flags = ErasedFlags::ambient(is_ambient);
        self.statement(cursor, loc, flags, Exported::No, data);
    }

    /// Records `import name = value` in a `declare` block: `value` is the string of `require("m")`, or a dotted name.
    #[cold]
    #[inline(never)]
    pub(crate) fn import_equals(
        &mut self,
        cursor: Cursor<'_>,
        arena: &Arena,
        loc: Loc,
        exported: Exported,
        name: Name,
        value: Expr,
    ) {
        let module_reference = match value.data {
            ExprData::EString(_) => ModuleReference::External(value),
            _ => ModuleReference::Entity(value),
        };
        let import = arena.alloc(ImportEqualsDeclaration {
            name,
            module_reference,
        });
        let data = ErasedData::ImportEquals(StoreRef::from_bump(import));
        self.statement(cursor, loc, ErasedFlags::AMBIENT, exported, data);
    }

    /// Records a declared class: `first_decorator` is where the expression of its first decorator starts.
    #[cold]
    #[inline(never)]
    pub(crate) fn class(
        &mut self,
        cursor: Cursor<'_>,
        loc: Loc,
        first_decorator: Option<Loc>,
        flags: ErasedFlags,
        exported: Exported,
        class: Stmt,
    ) {
        let first_decorator = first_decorator.map(offset);
        let data = ErasedData::Declaration(class);
        self.push(cursor, offset(loc), first_decorator, flags, exported, data);
    }

    /// Records a namespace or module that leaves no statement: `loc` is where its scope was pushed.
    #[cold]
    #[inline(never)]
    pub(crate) fn namespace(
        &mut self,
        cursor: Cursor<'_>,
        arena: &Arena,
        loc: Loc,
        mut flags: ErasedFlags,
        exported: Exported,
        name: ModuleName,
        body: StoreSlice<Stmt>,
    ) {
        let at = offset(loc);
        let (name_start, name_end) = match name {
            ModuleName::Identifier(name) => (name.start, name.end),
            ModuleName::String(name) => (name.start, name.end),
        };
        let is_nested = cursor.source.get(at as usize) == Some(&b'.');
        let (start, is_exported) = if is_nested {
            flags |= ErasedFlags::NESTED;
            (name_start, false)
        } else {
            first_token(cursor, at, None, exported == Exported::Before)
        };
        if is_exported {
            flags |= ErasedFlags::EXPORT;
        }
        let end = cursor.end();
        let has_body = end_before_semicolon(cursor, end) != name_end;
        if !has_body {
            flags |= ErasedFlags::NO_BODY;
        }
        self.adopt(at, List::Scope(at), start);
        let module = arena.alloc(ModuleDeclaration {
            keyword: module_keyword(cursor.source, cursor.comments, at),
            name,
            body: has_body.then_some(body),
        });
        self.statements.push(Erased {
            start,
            end,
            place: Place::InTree { loc: at },
            flags,
            data: ErasedData::Module(StoreRef::from_bump(module)),
        });
    }

    /// Records a `global` block, whose statements were read in the list of `scopes`.
    #[cold]
    #[inline(never)]
    pub(crate) fn global(
        &mut self,
        cursor: Cursor<'_>,
        arena: &Arena,
        loc: Loc,
        mut flags: ErasedFlags,
        exported: Exported,
        name: Name,
        body: StoreSlice<Stmt>,
        scopes: Scopes<'_, '_>,
    ) {
        let at = offset(loc);
        let (start, is_exported) = first_token(cursor, at, None, exported == Exported::Before);
        if is_exported {
            flags |= ErasedFlags::EXPORT;
        }
        if let Some(list) = self.list_of(scopes) {
            self.adopt(at, list, start);
        }
        let module = arena.alloc(ModuleDeclaration {
            keyword: ModuleKeyword::Global,
            name: ModuleName::Identifier(name),
            body: Some(body),
        });
        self.statements.push(Erased {
            start,
            end: cursor.end(),
            place: Place::InTree { loc: at },
            flags,
            data: ErasedData::Module(StoreRef::from_bump(module)),
        });
    }

    /// Records what follows the `declare` at `loc`: `stmt` is what the parse pass read there.
    #[cold]
    #[inline(never)]
    pub(crate) fn declared(
        &mut self,
        cursor: Cursor<'_>,
        loc: Loc,
        first_decorator: Option<Loc>,
        is_export: bool,
        stmt: Stmt,
    ) {
        let at = offset(loc);
        let (first, mut is_exported) =
            first_token(cursor, at, first_decorator.map(offset), is_export);
        let declared = ErasedFlags::DECLARE | ErasedFlags::AMBIENT;
        if matches!(stmt.data, StmtData::STypeScript(_)) {
            let inner = Place::InTree {
                loc: offset(stmt.loc),
            };
            let Some((record, before)) = self.statements.split_last_mut() else {
                return;
            };
            if record.place != inner {
                return;
            }
            let was = record.start;
            record.start = was.min(first);
            record.place = Place::InTree { loc: at };
            record.flags |= declared;
            if is_exported {
                record.flags |= ErasedFlags::EXPORT;
            }
            if record.start != was {
                let start = record.start;
                for child in before.iter_mut().rev() {
                    if child.start < was {
                        break;
                    }
                    if let Place::Erased { parent, index } = child.place
                        && parent == was
                    {
                        child.place = Place::Erased {
                            parent: start,
                            index,
                        };
                    }
                }
            }
            return;
        }
        if is_export && !is_exported && !stmt.loc.is_empty() {
            let keyword = offset(stmt.loc);
            is_exported =
                keyword_before(cursor.source, cursor.comments, keyword, b"export").is_some();
        }
        let mut flags = declared;
        if is_exported {
            flags |= ErasedFlags::EXPORT;
        }
        self.statements.push(Erased {
            start: first,
            end: cursor.end(),
            place: Place::InTree { loc: at },
            flags,
            data: ErasedData::Declaration(stmt),
        });
    }

    /// The record at the placeholder `loc` is of `export declare var` in a namespace: a statement stays there.
    #[cold]
    pub(crate) fn stands_in(&mut self, loc: Loc) {
        if let Some(record) = self.last_at(loc) {
            record.flags |= ErasedFlags::STAND_IN;
        }
    }

    /// The statement whose placeholder is at `loc` follows `export default`, and `export` is at `export`.
    #[cold]
    pub(crate) fn exported_by_default(&mut self, export: Loc, loc: Loc) {
        if let Some(record) = self.last_at(loc) {
            record.start = record.start.min(offset(export));
            record.flags |= ErasedFlags::EXPORT | ErasedFlags::DEFAULT;
        }
    }

    /// The import assignment whose placeholder is at `loc` follows `import type`, in a `declare` block or not.
    #[cold]
    pub(crate) fn import_equals_is_type(&mut self, loc: Loc, is_ambient: bool) {
        if let Some(record) = self.last_at(loc) {
            record.flags |= ErasedFlags::TYPE_ONLY;
            if !is_ambient {
                record.flags.remove(ErasedFlags::AMBIENT);
            }
        }
    }

    /// Gives the record of the placeholder at `loc`, which a statement list leaves out, its place in that list.
    #[cold]
    #[inline(never)]
    pub(crate) fn dropped(&mut self, loc: Loc, index: usize, scopes: Scopes<'_, '_>) {
        if self.last_at(loc).is_none() {
            return;
        }
        let Some(list) = self.list_of(scopes) else {
            return;
        };
        if let Some(record) = self.statements.last_mut() {
            record.place = list.place(offset_of(index));
        }
    }

    /// Records a class member that the parse pass built and leaves out.
    #[cold]
    #[inline(never)]
    pub(crate) fn member_property(
        &mut self,
        arena: &Arena,
        mut property: G::Property,
        flags: ErasedFlags,
    ) {
        // This tag owns memory of the global heap, which an arena does not free.
        if matches!(property.ts_metadata, Metadata::MDot(_)) {
            property.ts_metadata = Metadata::MNone;
        }
        let property = StoreRef::from_bump(arena.alloc(property));
        self.member(flags, ErasedMemberData::Property(property));
    }

    /// Adds `flags` to the member that `parse_property` left out and `parse_class` has not placed yet.
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

    fn member(&mut self, flags: ErasedFlags, data: ErasedMemberData) {
        self.members.push(ErasedMember {
            start: 0,
            end: 0,
            class_body: UNPLACED,
            index: 0,
            flags,
            data,
        });
    }

    fn push(
        &mut self,
        cursor: Cursor<'_>,
        at: u32,
        first_decorator: Option<u32>,
        mut flags: ErasedFlags,
        exported: Exported,
        data: ErasedData,
    ) {
        let (start, is_exported) =
            first_token(cursor, at, first_decorator, exported == Exported::Before);
        if is_exported || exported == Exported::Here {
            flags |= ErasedFlags::EXPORT;
        }
        self.statements.push(Erased {
            start,
            end: cursor.end(),
            place: Place::InTree { loc: at },
            flags,
            data,
        });
    }

    /// The last record, when its placeholder is at `loc` and no list has taken it.
    fn last_at(&mut self, loc: Loc) -> Option<&mut Erased> {
        let placeholder = Place::InTree { loc: offset(loc) };
        self.statements
            .last_mut()
            .filter(|record| record.place == placeholder)
    }

    /// Makes the records that stand in `list` since the offset `from` statements of the erased statement at `parent`.
    fn adopt(&mut self, from: u32, list: List, parent: u32) {
        for record in self.statements.iter_mut().rev() {
            if record.start < from {
                break;
            }
            if let Some(index) = list.index_of(record.place) {
                record.place = Place::Erased { parent, index };
            }
        }
    }

    /// The list that the current scope holds the statements of.
    fn list_of(&mut self, scopes: Scopes<'_, '_>) -> Option<List> {
        let scope = scopes.current.as_ptr() as usize;
        if scope == scopes.module.as_ptr() as usize {
            return Some(List::Module);
        }
        while let Some(&ListFrame {
            scope: open,
            loc,
            order,
        }) = self.lists.last()
        {
            if open == scope {
                if scope_in_order(scopes.in_order, order as usize) == Some(scope) {
                    return Some(List::Scope(loc));
                }
            } else if is_ancestor(open, scopes.current) {
                break;
            }
            self.lists.pop();
        }
        let floor = self
            .lists
            .last()
            .map_or(0, |frame| frame.order as usize + 1);
        let mut order = scopes.in_order.len();
        while order > floor {
            order -= 1;
            if scope_in_order(scopes.in_order, order) == Some(scope) {
                let loc = scopes
                    .in_order
                    .get(order)
                    .and_then(Option::as_ref)
                    .map_or(0, |entry| offset(entry.loc));
                self.lists.push(ListFrame {
                    scope,
                    loc,
                    order: offset_of(order),
                });
                return Some(List::Scope(loc));
            }
        }
        None
    }
}

fn offset(loc: Loc) -> u32 {
    u32::try_from(loc.start).unwrap_or(0)
}

fn offset_of(at: usize) -> u32 {
    u32::try_from(at).unwrap_or(u32::MAX)
}

/// The address of the scope that `in_order` has at `order`.
fn scope_in_order(in_order: &[Option<ScopeOrder<'_>>], order: usize) -> Option<usize> {
    let entry = in_order.get(order)?.as_ref()?;
    Some(entry.scope as usize)
}

/// Whether the scope at the address `ancestor` is around `scope`.
fn is_ancestor(ancestor: usize, scope: StoreRef<Scope>) -> bool {
    let mut parent = scope.parent;
    while let Some(next) = parent {
        if next.as_ptr() as usize == ancestor {
            return true;
        }
        parent = next.parent;
    }
    false
}

/// The first token of the statement at `at`, and whether `export` is one of its tokens.
fn first_token(
    cursor: Cursor<'_>,
    at: u32,
    first_decorator: Option<u32>,
    is_export: bool,
) -> (u32, bool) {
    let (source, comments) = (cursor.source, cursor.comments);
    let mut start = at;
    let mut is_exported = false;
    if is_export && let Some(export) = keyword_before(source, comments, at, b"export") {
        start = export;
        is_exported = true;
    }
    if let Some(expression) = first_decorator {
        let at_sign = at_sign_before(source, comments, expression);
        if at_sign < start {
            start = at_sign;
            if is_export
                && !is_exported
                && let Some(export) = keyword_before(source, comments, start, b"export")
            {
                start = export;
                is_exported = true;
            }
        }
    }
    (start, is_exported)
}

/// The `@` of the decorator whose expression starts at `expression`: a parenthesis there leaves no node.
fn at_sign_before(source: &[u8], comments: &[Range], expression: u32) -> u32 {
    let mut end = token_end_before(source, comments, expression);
    while end > 0 && source.get(end as usize - 1) == Some(&b'(') {
        end = token_end_before(source, comments, end - 1);
    }
    if end > 0 && source.get(end as usize - 1) == Some(&b'@') {
        end - 1
    } else {
        expression
    }
}

/// Where `keyword` starts when it is the token before `at` and not the name of a property.
fn keyword_before(source: &[u8], comments: &[Range], at: u32, keyword: &[u8]) -> Option<u32> {
    let end = token_end_before(source, comments, at) as usize;
    let start = end.checked_sub(keyword.len())?;
    if source.get(start..end)? != keyword || word_start(source, end) != start {
        return None;
    }
    let before = token_end_before(source, comments, offset_of(start)) as usize;
    if before > 0 && matches!(source.get(before - 1), Some(&(b'.' | b'#'))) {
        return None;
    }
    Some(offset_of(start))
}

/// `namespace`, or `module`: for the part of a dotted name after the dot at `at`, the keyword before the name.
fn module_keyword(source: &[u8], comments: &[Range], at: u32) -> ModuleKeyword {
    let mut keyword = at as usize;
    while source.get(keyword) == Some(&b'.') {
        let name_end = token_end_before(source, comments, offset_of(keyword)) as usize;
        let name_start = word_start(source, name_end);
        if name_start == name_end {
            return ModuleKeyword::Namespace;
        }
        let before = token_end_before(source, comments, offset_of(name_start)) as usize;
        if before > 0 && source.get(before - 1) == Some(&b'.') {
            keyword = before - 1;
        } else {
            keyword = word_start(source, before);
        }
    }
    let is_module = source
        .get(keyword..)
        .is_some_and(|word| word.starts_with(b"module"));
    if is_module {
        ModuleKeyword::Module
    } else {
        ModuleKeyword::Namespace
    }
}

/// `end`, or the end of the token before the `;` that ends there.
fn end_before_semicolon(cursor: Cursor<'_>, end: u32) -> u32 {
    if end > 0 && cursor.source.get(end as usize - 1) == Some(&b';') {
        token_end_before(cursor.source, cursor.comments, end - 1)
    } else {
        end
    }
}

/// The offset after the closing quote of the string literal, or of the template without `${`, at `start`.
fn string_literal_end(source: &[u8], start: u32) -> u32 {
    let Some(&quote) = source.get(start as usize) else {
        return start;
    };
    let mut at = start as usize + 1;
    while let Some(&byte) = source.get(at) {
        at += 1;
        if byte == b'\\' {
            at += 1;
        } else if byte == quote {
            break;
        }
    }
    offset_of(at.min(source.len()))
}

/// The end of the token before `at`: white space and comments are passed over.
fn token_end_before(source: &[u8], comments: &[Range], at: u32) -> u32 {
    let mut end = (at as usize).min(source.len());
    loop {
        loop {
            let width = white_space_before(source, end);
            if width == 0 {
                break;
            }
            end -= width;
        }
        let after = comments.partition_point(|comment| comment.end_i() <= end);
        match after.checked_sub(1).and_then(|last| comments.get(last)) {
            Some(comment) if comment.end_i() == end && comment.loc.i() < end => {
                end = comment.loc.i();
            }
            _ => break,
        }
    }
    offset_of(end)
}

/// How many bytes the white space or line terminator that ends at `end` has, or 0.
fn white_space_before(source: &[u8], end: usize) -> usize {
    let Some(&last) = end.checked_sub(1).and_then(|at| source.get(at)) else {
        return 0;
    };
    if matches!(last, b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C) {
        return 1;
    }
    if last < 0x80 {
        return 0;
    }
    if matches!(source.get(end.wrapping_sub(2)..end), Some(&[0xC2, 0xA0])) {
        return 2;
    }
    let Some(&[first, second, third]) = source.get(end.wrapping_sub(3)..end) else {
        return 0;
    };
    if first & 0xF0 != 0xE0 || second & 0xC0 != 0x80 || third & 0xC0 != 0x80 {
        return 0;
    }
    let code_point =
        (u32::from(first & 0x0F) << 12) | (u32::from(second & 0x3F) << 6) | u32::from(third & 0x3F);
    let is_white_space = matches!(code_point, 0x2028 | 0x2029 | 0xFEFF)
        || bun_core::strings::is_unicode_space_separator(code_point);
    if is_white_space { 3 } else { 0 }
}

/// Where the identifier or keyword that ends at `end` starts.
fn word_start(source: &[u8], end: usize) -> usize {
    let mut start = end.min(source.len());
    while start > 0
        && source
            .get(start - 1)
            .is_some_and(|&byte| is_name_byte(byte))
    {
        start -= 1;
    }
    start
}

fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | b'\\') || byte >= 0x80
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_ast::S;

    fn range(start: i32, len: i32) -> Range {
        Range {
            loc: Loc { start },
            len,
        }
    }

    fn cursor<'s>(source: &'s [u8], comments: &'s [Range], next: u32) -> Cursor<'s> {
        Cursor {
            source,
            comments,
            next,
        }
    }

    fn name(text: &'static [u8], start: u32) -> Name {
        Name {
            start,
            end: start + text.len() as u32,
            text: StoreStr::new(text),
        }
    }

    fn placeholder(start: i32) -> Stmt {
        Stmt {
            loc: Loc { start },
            data: StmtData::STypeScript(S::TypeScript {}),
        }
    }

    #[test]
    fn token_end_passes_white_space_and_comments() {
        let source = b"type A = 1 /* c */ // d\n\xE2\x80\xA8 next";
        let comments = [range(11, 7), range(19, 4)];
        assert_eq!(token_end_before(source, &comments, 28), 10);
        assert_eq!(token_end_before(source, &[], 28), 23);
        assert_eq!(token_end_before(source, &comments, 0), 0);
        assert_eq!(token_end_before(b"a\xC2\xA0\xEF\xBB\xBF\t", &[], 7), 1);
    }

    #[test]
    fn export_is_found_only_as_a_keyword() {
        let source =
            b"export\ninterface D {}\nfoo.export\ninterface E {}\nthis.#export\ntype F = 1";
        assert_eq!(keyword_before(source, &[], 7, b"export"), Some(0));
        assert_eq!(keyword_before(source, &[], 33, b"export"), None);
        assert_eq!(keyword_before(source, &[], 61, b"export"), None);
        assert_eq!(keyword_before(b"reexport class", &[], 9, b"export"), None);
    }

    #[test]
    fn first_token_is_a_decorator_or_export() {
        let source = b"@(d) export declare class B {} export @e declare class C {}";
        let at = cursor(source, &[], 0);
        assert_eq!(first_token(at, 12, Some(2), true), (0, true));
        assert_eq!(first_token(at, 20, Some(2), true), (0, false));
        assert_eq!(first_token(at, 41, Some(39), true), (31, true));
        assert_eq!(first_token(at, 49, Some(39), true), (31, true));
        assert_eq!(first_token(at, 49, None, false), (49, false));
    }

    #[test]
    fn string_literal_ends_after_its_quote() {
        assert_eq!(string_literal_end(b"from 'a\\'b' with", 5), 11);
        assert_eq!(string_literal_end(b"`m`;", 0), 3);
        assert_eq!(string_literal_end(b"'open", 0), 5);
    }

    #[test]
    fn module_keyword_of_a_dotted_part() {
        assert_eq!(
            module_keyword(b"module F.G {}", &[], 8),
            ModuleKeyword::Module
        );
        assert_eq!(
            module_keyword(b"namespace A.B.C {}", &[], 13),
            ModuleKeyword::Namespace
        );
        assert_eq!(
            module_keyword(b"module A . B . C {}", &[], 13),
            ModuleKeyword::Module
        );
        assert_eq!(
            module_keyword(b"module X {}", &[], 0),
            ModuleKeyword::Module
        );
        assert_eq!(
            module_keyword(b"namespace X {}", &[], 0),
            ModuleKeyword::Namespace
        );
    }

    #[test]
    fn statement_takes_its_place_in_the_list_that_drops_it() {
        let source = b"export interface A {}\nfoo.export\ninterface E {}";
        let mut module = Box::new(Scope::EMPTY);
        let module = StoreRef::from_bump(&mut *module);
        let scopes = Scopes {
            current: module,
            module,
            in_order: &[],
        };
        let mut tables = ErasedTables::default();
        let interface = ErasedData::Interface(name(b"A", 17));
        let empty = ErasedFlags::empty();
        tables.statement(
            cursor(source, &[], 22),
            Loc { start: 7 },
            empty,
            Exported::Before,
            interface,
        );
        tables.dropped(Loc { start: 7 }, 0, scopes);
        let interface = ErasedData::Interface(name(b"E", 43));
        tables.statement(
            cursor(source, &[], 47),
            Loc { start: 33 },
            empty,
            Exported::Before,
            interface,
        );
        tables.dropped(Loc { start: 99 }, 1, scopes);
        let [first, second] = tables.statements.as_slice() else {
            panic!("two records");
        };
        assert_eq!(
            (first.start, first.end, first.place),
            (0, 21, Place::Module { index: 0 })
        );
        assert_eq!(first.flags, ErasedFlags::EXPORT);
        assert_eq!(
            (second.start, second.end, second.place),
            (33, 47, Place::InTree { loc: 33 })
        );
        assert_eq!(second.flags, empty);
    }

    #[test]
    fn list_is_the_scope_in_order() {
        let mut module = Box::new(Scope::EMPTY);
        let module = StoreRef::from_bump(&mut *module);
        let mut body = Box::new(Scope {
            parent: Some(module),
            ..Scope::EMPTY
        });
        let body = StoreRef::from_bump(&mut *body);
        let mut block = Box::new(Scope {
            parent: Some(body),
            ..Scope::EMPTY
        });
        let block = StoreRef::from_bump(&mut *block);
        let in_order = [
            Some(ScopeOrder::new(Loc { start: 13 }, body.as_ptr())),
            None,
            Some(ScopeOrder::new(Loc { start: 40 }, block.as_ptr())),
        ];
        let scopes = |current| Scopes {
            current,
            module,
            in_order: &in_order,
        };
        let mut tables = ErasedTables::default();
        assert!(tables.list_of(scopes(module)) == Some(List::Module));
        assert!(tables.list_of(scopes(block)) == Some(List::Scope(40)));
        assert!(tables.list_of(scopes(body)) == Some(List::Scope(13)));
        assert!(tables.list_of(scopes(block)) == Some(List::Scope(40)));
        assert_eq!(tables.lists.len(), 2);
        assert!(tables.list_of(scopes(body)) == Some(List::Scope(13)));
        assert_eq!(tables.lists.len(), 1);
        let scopes = Scopes {
            current: block,
            module,
            in_order: &in_order[..1],
        };
        assert!(tables.list_of(scopes).is_none());
    }

    #[test]
    fn declare_takes_the_record_and_its_statements() {
        let source = b"declare namespace N { type A = 1 }";
        let mut tables = ErasedTables::default();
        let alias = ErasedData::TypeAlias(name(b"A", 27));
        let ambient = ErasedFlags::AMBIENT;
        tables.statement(
            cursor(source, &[], 33),
            Loc { start: 22 },
            ambient,
            Exported::No,
            alias,
        );
        tables.statements[0].place = Place::Scope { scope: 8, index: 0 };
        tables.adopt(8, List::Scope(8), 8);
        assert_eq!(
            tables.statements[0].place,
            Place::Erased {
                parent: 8,
                index: 0
            }
        );
        tables.statement(
            cursor(source, &[], 34),
            Loc { start: 8 },
            ambient,
            Exported::No,
            alias,
        );
        tables.declared(
            cursor(source, &[], 34),
            Loc { start: 0 },
            None,
            false,
            placeholder(8),
        );
        let [inner, outer] = tables.statements.as_slice() else {
            panic!("two records");
        };
        assert_eq!(
            inner.place,
            Place::Erased {
                parent: 0,
                index: 0
            }
        );
        assert_eq!(
            (outer.start, outer.end, outer.place),
            (0, 34, Place::InTree { loc: 0 })
        );
        assert_eq!(outer.flags, ErasedFlags::DECLARE | ErasedFlags::AMBIENT);
    }

    #[test]
    fn declare_records_what_leaves_a_statement() {
        let source = b"export declare const a: number;\ndeclare;";
        let mut tables = ErasedTables::default();
        let local = Stmt {
            loc: Loc { start: 15 },
            ..Stmt::empty()
        };
        tables.declared(cursor(source, &[], 32), Loc { start: 7 }, None, true, local);
        tables.stands_in(Loc { start: 7 });
        tables.declared(
            cursor(source, &[], 40),
            Loc { start: 32 },
            None,
            false,
            Stmt::empty(),
        );
        let [first, second] = tables.statements.as_slice() else {
            panic!("two records");
        };
        assert_eq!(
            (first.start, first.end, first.place),
            (0, 31, Place::InTree { loc: 7 })
        );
        let declared = ErasedFlags::DECLARE | ErasedFlags::AMBIENT;
        assert_eq!(
            first.flags,
            declared | ErasedFlags::EXPORT | ErasedFlags::STAND_IN
        );
        assert_eq!((second.start, second.end, second.flags), (32, 40, declared));
    }

    #[test]
    fn rewind_drops_the_records_since_the_mark() {
        let source = b"type A = 1; type B = 2;";
        let mut tables = ErasedTables::default();
        let empty = ErasedFlags::empty();
        let alias = ErasedData::TypeAlias(name(b"A", 5));
        tables.statement(
            cursor(source, &[], 12),
            Loc { start: 0 },
            empty,
            Exported::No,
            alias,
        );
        let mark = tables.mark();
        tables.statement(
            cursor(source, &[], 23),
            Loc { start: 12 },
            empty,
            Exported::No,
            alias,
        );
        tables.member_modifier(ErasedFlags::DECLARE);
        tables.hold(alias);
        tables.rewind(mark);
        assert_eq!((tables.statements.len(), tables.members.len()), (1, 0));
        assert!(tables.held.is_none());
    }

    #[test]
    fn member_without_a_record_is_an_index_signature() {
        let source = b"class C { declare static [k: string]: any; [n: number]: 1; x = 1 }";
        let mut tables = ErasedTables::default();
        tables.member_modifier(ErasedFlags::DECLARE);
        tables.member_read(
            cursor(source, &[], 43),
            Loc { start: 10 },
            Loc { start: 8 },
            0,
            true,
        );
        tables.member_read(
            cursor(source, &[], 59),
            Loc { start: 43 },
            Loc { start: 8 },
            0,
            false,
        );
        let [first, second] = tables.members.as_slice() else {
            panic!("two records");
        };
        assert!(matches!(first.data, ErasedMemberData::IndexSignature));
        assert_eq!((first.start, first.end), (10, 42));
        assert_eq!((first.class_body, first.index), (8, 0));
        assert_eq!(first.flags, ErasedFlags::STATIC | ErasedFlags::DECLARE);
        assert!(matches!(second.data, ErasedMemberData::IndexSignature));
        assert_eq!(
            (second.start, second.end, second.flags),
            (43, 58, ErasedFlags::empty())
        );
    }
}

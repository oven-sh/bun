//! What a lint parse keeps, beside the tree, of the syntax that the parse pass drops.

use crate::{Expr, G, Loc, Range, Stmt, StoreRef, StoreSlice, StoreStr};

use super::{
    HeritageClause, ImportAttributes, IndexSignature, List, Literal, Member, ModifierKind, Name,
    Type, TypeParameter,
};

/// The tables of one lint parse. A list grows in parse order and is cut back to a [`Mark`] when the parser backtracks.
#[derive(Default)]
pub struct Sidecar {
    /// Every comment, sorted by start.
    pub comments: Vec<Range>,
    pub header: Header,
    pub annotations: Vec<Annotation>,
    pub this_parameters: Vec<ThisParameter>,
    pub type_parameters: Vec<TypeParameters>,
    pub return_types: Vec<ReturnType>,
    pub heritage: Vec<Heritage>,
    pub wrappers: Vec<Wrapper>,
    pub jsx_type_arguments: Vec<JsxTypeArguments>,
    pub erased: Vec<Erased>,
    pub erased_members: Vec<ErasedMember>,
    pub keywords: Vec<Keyword>,
    pub specifiers: Vec<TypeOnlySpecifier>,
    /// The file name says that every statement is ambient.
    pub is_declaration_file: bool,
}

/// The length of every list of a [`Sidecar`] that the parse pass fills.
#[derive(Clone, Copy)]
pub struct Mark {
    lens: [u32; 11],
}

impl Sidecar {
    pub fn mark(&self) -> Mark {
        Mark {
            lens: [
                self.annotations.len() as u32,
                self.this_parameters.len() as u32,
                self.type_parameters.len() as u32,
                self.return_types.len() as u32,
                self.heritage.len() as u32,
                self.wrappers.len() as u32,
                self.jsx_type_arguments.len() as u32,
                self.erased.len() as u32,
                self.erased_members.len() as u32,
                self.keywords.len() as u32,
                self.specifiers.len() as u32,
            ],
        }
    }

    /// Drops every record made since `mark`.
    pub fn rewind(&mut self, mark: &Mark) {
        let [a, b, c, d, e, f, g, h, i, j, k] = mark.lens;
        self.annotations.truncate(a as usize);
        self.this_parameters.truncate(b as usize);
        self.type_parameters.truncate(c as usize);
        self.return_types.truncate(d as usize);
        self.heritage.truncate(e as usize);
        self.wrappers.truncate(f as usize);
        self.jsx_type_arguments.truncate(g as usize);
        self.erased.truncate(h as usize);
        self.erased_members.truncate(i as usize);
        self.keywords.truncate(j as usize);
        self.specifiers.truncate(k as usize);
    }

    /// How many records the parse pass made since `mark`.
    pub fn len_since(&self, mark: &Mark) -> usize {
        let now = self.mark();
        let mut total = 0usize;
        for (after, before) in now.lens.iter().zip(mark.lens.iter()) {
            total += after.saturating_sub(*before) as usize;
        }
        total
    }

    /// Puts every list but `wrappers` in the order of its key or of `start`. The parse entry calls it once.
    pub fn sort(&mut self) {
        self.annotations.sort_by_key(|record| record.owner);
        self.this_parameters.sort_by_key(|record| record.owner);
        self.type_parameters.sort_by_key(|record| record.owner);
        self.return_types.sort_by_key(|record| record.owner);
        self.heritage.sort_by_key(|record| record.class);
        self.jsx_type_arguments.sort_by_key(|record| record.element);
        self.keywords.sort_by_key(|record| record.owner);
        self.erased.sort_by_key(|record| record.start);
        self.erased_members.sort_by_key(|record| record.start);
        self.specifiers
            .sort_by_key(|record| (record.statement, record.index));
    }

    /// The `?`, `!` and type of the binding at `owner`, or of the class member whose key is at `owner`.
    pub fn annotation(&self, owner: Loc) -> Option<&Annotation> {
        let owner = u32::try_from(owner.start).ok()?;
        let at = self
            .annotations
            .binary_search_by_key(&owner, |record| record.owner)
            .ok()?;
        self.annotations.get(at)
    }

    pub fn type_parameters_of(&self, owner: Owner) -> Option<&TypeParameters> {
        let at = self
            .type_parameters
            .binary_search_by_key(&owner, |record| record.owner)
            .ok()?;
        self.type_parameters.get(at)
    }

    pub fn return_type_of(&self, owner: Owner) -> Option<&ReturnType> {
        let at = self
            .return_types
            .binary_search_by_key(&owner, |record| record.owner)
            .ok()?;
        self.return_types.get(at)
    }

    pub fn this_parameter_of(&self, owner: Owner) -> Option<&ThisParameter> {
        let at = self
            .this_parameters
            .binary_search_by_key(&owner, |record| record.owner)
            .ok()?;
        self.this_parameters.get(at)
    }

    /// The clauses of the class whose `class` keyword is at `class`, in source order.
    pub fn heritage_of(&self, class: Loc) -> &[Heritage] {
        let Ok(class) = u32::try_from(class.start) else {
            return &[];
        };
        let from = self.heritage.partition_point(|record| record.class < class);
        let to = self
            .heritage
            .partition_point(|record| record.class <= class);
        self.heritage.get(from..to).unwrap_or(&[])
    }

    pub fn jsx_type_arguments_of(&self, element: Loc) -> Option<&JsxTypeArguments> {
        let element = u32::try_from(element.start).ok()?;
        let at = self
            .jsx_type_arguments
            .binary_search_by_key(&element, |record| record.element)
            .ok()?;
        self.jsx_type_arguments.get(at)
    }

    /// The keywords recorded for the class or enum at `owner`, in source order.
    pub fn keywords_of(&self, owner: Loc) -> &[Keyword] {
        let Ok(owner) = u32::try_from(owner.start) else {
            return &[];
        };
        let from = self.keywords.partition_point(|record| record.owner < owner);
        let to = self
            .keywords
            .partition_point(|record| record.owner <= owner);
        self.keywords.get(from..to).unwrap_or(&[])
    }
}

/// What a record of a function, of an arrow function or of a class belongs to.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Owner {
    /// `G::Fn::open_parens_loc` of a function, method, accessor or constructor.
    Fn(u32),
    /// `Expr::loc` of an `E::Arrow`.
    Arrow(u32),
    /// `G::Class::class_keyword.loc`.
    Class(u32),
}

/// The `?`, the `!` and the type after a binding or after the name of a class member.
#[derive(Clone, Copy)]
pub struct Annotation {
    /// `Binding::loc` of the binding, or `Expr::loc` of the key of the class member.
    pub owner: u32,
    /// Offset of the `?`.
    pub question: Option<u32>,
    /// Offset of the `!`.
    pub exclamation: Option<u32>,
    pub type_node: Option<Type>,
}

/// A `this` parameter: the tree has no argument for it.
#[derive(Clone, Copy)]
pub struct ThisParameter {
    pub owner: Owner,
    /// How many arguments the tree has before it.
    pub index: u32,
    pub start: u32,
    /// Offset after `this`.
    pub end: u32,
    pub type_node: Option<Type>,
}

#[derive(Clone, Copy)]
pub struct TypeParameters {
    pub owner: Owner,
    /// Offset of `<`.
    pub lt: u32,
    /// Offset after `>`.
    pub end: u32,
    pub list: List<TypeParameter>,
}

/// The type after the `:` that follows a parameter list: a return type or a type predicate.
#[derive(Clone, Copy)]
pub struct ReturnType {
    pub owner: Owner,
    pub type_node: Type,
}

/// One `extends` or `implements` clause of a class.
#[derive(Clone, Copy)]
pub struct Heritage {
    /// `G::Class::class_keyword.loc`.
    pub class: u32,
    pub clause: HeritageClause,
}

/// Syntax around an expression that leaves no node: the tree holds `operand` where the source has the wrapper.
#[derive(Clone, Copy)]
pub struct Wrapper {
    pub operand: Expr,
    /// Offset of `as`, of `satisfies`, of `!` or of `<`.
    pub op: u32,
    /// Offset after the type, after `!` or after `>`.
    pub end: u32,
    pub data: WrapperData,
}

#[derive(Clone, Copy)]
pub enum WrapperData {
    /// `operand as T`. `as const` has a `TypeReference` to the name `const`.
    As(Type),
    /// `operand satisfies T`.
    Satisfies(Type),
    /// `operand!`.
    NonNull,
    /// `<T>operand`: the operand is the whole unary expression after `>`.
    TypeAssertion(Type),
    /// `operand<T>` before call arguments, before a template, after `new`, or alone as an instantiation expression.
    TypeArguments(List<Type>),
}

impl Wrapper {
    /// Whether `expr` is the node that the record wraps.
    pub fn wraps(&self, expr: &Expr) -> bool {
        ExprId::of(&self.operand) == ExprId::of(expr)
    }
}

/// The identity of an expression node: where it starts, its kind, and the address of its payload when it has one.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ExprId {
    pub loc: i32,
    pub tag: crate::expr::Tag,
    pub payload: usize,
}

impl ExprId {
    pub fn of(expr: &Expr) -> ExprId {
        use crate::expr::Data;
        let payload = match &expr.data {
            Data::EArray(node) => node.as_ptr() as usize,
            Data::EUnary(node) => node.as_ptr() as usize,
            Data::EBinary(node) => node.as_ptr() as usize,
            Data::EClass(node) => node.as_ptr() as usize,
            Data::ENew(node) => node.as_ptr() as usize,
            Data::EFunction(node) => node.as_ptr() as usize,
            Data::ECall(node) => node.as_ptr() as usize,
            Data::EDot(node) => node.as_ptr() as usize,
            Data::EIndex(node) => node.as_ptr() as usize,
            Data::EArrow(node) => node.as_ptr() as usize,
            Data::EJsxElement(node) => node.as_ptr() as usize,
            Data::EObject(node) => node.as_ptr() as usize,
            Data::ESpread(node) => node.as_ptr() as usize,
            Data::ETemplate(node) => node.as_ptr() as usize,
            Data::ERegExp(node) => node.as_ptr() as usize,
            Data::EAwait(node) => node.as_ptr() as usize,
            Data::EYield(node) => node.as_ptr() as usize,
            Data::EIf(node) => node.as_ptr() as usize,
            Data::EImport(node) => node.as_ptr() as usize,
            Data::EBigInt(node) => node.as_ptr() as usize,
            Data::EString(node) => node.as_ptr() as usize,
            _ => 0,
        };
        ExprId {
            loc: expr.loc.start,
            tag: expr.data.tag(),
            payload,
        }
    }
}

/// The type arguments after the name of a JSX element.
#[derive(Clone, Copy)]
pub struct JsxTypeArguments {
    /// `Expr::loc` of the `E::JSXElement`.
    pub element: u32,
    /// Offset of `<`.
    pub lt: u32,
    /// Offset after `>`.
    pub end: u32,
    pub list: List<Type>,
}

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
        /// `declare`, or inside a `declare` block, or in a declaration file.
        const AMBIENT = 1 << 3;
        const ABSTRACT = 1 << 4;
        /// `import type`, `export type`.
        const TYPE_ONLY = 1 << 5;
        /// The inner part of a dotted namespace name.
        const NESTED = 1 << 6;
        /// `export declare var` in a namespace: the tree has an `S::Local` of the names at `Place::InTree`.
        const STAND_IN = 1 << 7;
        const NO_BODY = 1 << 8;
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
    Interface(StoreRef<InterfaceDeclaration>),
    TypeAlias(StoreRef<TypeAliasDeclaration>),
    /// A function without a body, or a declared function, class, variable statement or enum, as the parse pass built it.
    Declaration(Stmt),
    Module(StoreRef<ModuleDeclaration>),
    /// `export as namespace name`.
    NamespaceExport(Name),
    Import(StoreRef<ImportDeclaration>),
    ImportEquals(StoreRef<ImportEqualsDeclaration>),
    Export(StoreRef<ExportDeclaration>),
}

#[derive(Clone, Copy)]
pub struct InterfaceDeclaration {
    pub name: Name,
    pub type_parameters: Option<List<TypeParameter>>,
    pub heritage_clauses: List<HeritageClause>,
    pub members: List<Member>,
}

#[derive(Clone, Copy)]
pub struct TypeAliasDeclaration {
    pub name: Name,
    pub type_parameters: Option<List<TypeParameter>>,
    pub type_node: Type,
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
    String(Literal),
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
pub enum ModuleExportName {
    Identifier(Name),
    String(Literal),
}

/// One name of the clause of an import or export statement.
#[derive(Clone, Copy)]
pub struct Specifier {
    pub start: u32,
    pub end: u32,
    /// Offset of `type`.
    pub type_keyword: Option<u32>,
    /// The name before `as`.
    pub property_name: Option<ModuleExportName>,
    pub name: ModuleExportName,
}

#[derive(Clone, Copy)]
pub struct ImportDeclaration {
    /// Offset of the `type` after `import`.
    pub type_keyword: Option<u32>,
    pub default_name: Option<Name>,
    /// The name after `* as`.
    pub namespace_name: Option<Name>,
    pub named: Option<List<Specifier>>,
    pub module_specifier: Literal,
    pub attributes: Option<StoreRef<ImportAttributes>>,
}

#[derive(Clone, Copy)]
pub enum ModuleReference {
    /// `require("m")`: the string.
    External(Literal),
    /// A name or a dotted name, as the parse pass built it.
    Entity(Expr),
}

#[derive(Clone, Copy)]
pub struct ImportEqualsDeclaration {
    /// Offset of the `type` after `import`.
    pub type_keyword: Option<u32>,
    pub name: Name,
    pub module_reference: ModuleReference,
}

#[derive(Clone, Copy)]
pub enum ExportClause {
    /// `export type * from "m"`.
    Star,
    /// `export type * as name from "m"`.
    Namespace(ModuleExportName),
    Named(List<Specifier>),
}

#[derive(Clone, Copy)]
pub struct ExportDeclaration {
    /// Offset of the `type` after `export`.
    pub type_keyword: Option<u32>,
    pub clause: ExportClause,
    pub module_specifier: Option<Literal>,
    pub attributes: Option<StoreRef<ImportAttributes>>,
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
    pub data: ErasedMemberData,
}

#[derive(Clone, Copy)]
pub enum ErasedMemberData {
    /// An overload, or an abstract or declared member, as the parse pass built it.
    Property(StoreRef<G::Property>),
    IndexSignature(StoreRef<IndexSignature>),
}

/// A modifier that the tree keeps no trace of: `abstract` before `class`, `const` before `enum`.
#[derive(Clone, Copy)]
pub struct Keyword {
    /// `G::Class::class_keyword.loc` of the class, or `S::Enum::name.loc` of the enum.
    pub owner: u32,
    pub start: u32,
    pub end: u32,
    pub kind: ModifierKind,
}

/// A name with `type` in the clause of an import or export statement that stays in the tree.
#[derive(Clone, Copy)]
pub struct TypeOnlySpecifier {
    /// `Stmt::loc` of the `S::Import`, `S::ExportClause` or `S::ExportFrom`.
    pub statement: u32,
    /// How many names the clause has before it in the source.
    pub index: u32,
    pub specifier: Specifier,
}

/// What the comments before the first token say about the file.
#[derive(Default)]
pub struct Header {
    /// The `#!` line, without its line terminator.
    pub hashbang: Option<Range>,
    pub pragmas: Vec<Pragma>,
    /// The last `@ts-check` or `@ts-nocheck`.
    pub check_js_directive: Option<CheckJsDirective>,
    pub referenced_files: Vec<FileReference>,
    pub type_reference_directives: Vec<FileReference>,
    pub lib_reference_directives: Vec<FileReference>,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommentKind {
    SingleLine,
    MultiLine,
}

#[derive(Clone, Copy)]
pub struct CommentRange {
    pub start: u32,
    pub end: u32,
    pub kind: CommentKind,
    pub has_trailing_new_line: bool,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PragmaName {
    Reference,
    TsCheck,
    TsNoCheck,
    Jsx,
    JsxFrag,
    JsxImportSource,
    JsxRuntime,
}

#[derive(Clone, Copy)]
pub struct PragmaArgument {
    /// The range of `value`.
    pub start: u32,
    pub end: u32,
    pub name: StoreStr,
    pub value: StoreStr,
}

pub struct Pragma {
    pub comment: CommentRange,
    pub name: PragmaName,
    pub args: Vec<PragmaArgument>,
}

#[derive(Clone, Copy)]
pub struct CheckJsDirective {
    pub enabled: bool,
    pub comment: CommentRange,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ResolutionMode {
    None,
    CommonJs,
    EsNext,
}

#[derive(Clone, Copy)]
pub struct FileReference {
    /// The range of `file_name`.
    pub start: u32,
    pub end: u32,
    pub file_name: StoreStr,
    pub resolution_mode: ResolutionMode,
    pub preserve: bool,
}

/// `SingleLine` for `//`, `MultiLine` for `/*`.
pub fn comment_kind(source: &[u8], comment: Range) -> CommentKind {
    let start = comment.loc.i();
    if source.get(start + 1) == Some(&b'/') {
        CommentKind::SingleLine
    } else {
        CommentKind::MultiLine
    }
}

/// A `/**` comment that is more than `/**/`: the comments that a JSDoc reader takes.
pub fn is_jsdoc_comment(source: &[u8], comment: Range) -> bool {
    let start = comment.loc.i();
    comment.len >= 5
        && source.get(start + 1) == Some(&b'*')
        && source.get(start + 2) == Some(&b'*')
        && source.get(start + 3) != Some(&b'/')
}

const _: () = assert!(core::mem::size_of::<Owner>() == 8);
const _: () = assert!(core::mem::size_of::<Annotation>() == 40);
const _: () = assert!(core::mem::size_of::<ThisParameter>() == 40);
const _: () = assert!(core::mem::size_of::<TypeParameters>() == 36);
const _: () = assert!(core::mem::size_of::<ReturnType>() == 28);
const _: () = assert!(core::mem::size_of::<Heritage>() == 36);
const _: () = assert!(core::mem::size_of::<WrapperData>() == 24);
const _: () = assert!(core::mem::size_of::<Wrapper>() == 48);
const _: () = assert!(core::mem::size_of::<ExprId>() == 16);
const _: () = assert!(core::mem::size_of::<JsxTypeArguments>() == 32);
const _: () = assert!(core::mem::size_of::<Place>() == 12);
const _: () = assert!(core::mem::size_of::<ErasedData>() == 24);
const _: () = assert!(core::mem::size_of::<Erased>() == 48);
const _: () = assert!(core::mem::size_of::<InterfaceDeclaration>() == 80);
const _: () = assert!(core::mem::size_of::<TypeAliasDeclaration>() == 60);
const _: () = assert!(core::mem::size_of::<ModuleDeclaration>() == 40);
const _: () = assert!(core::mem::size_of::<Specifier>() == 64);
const _: () = assert!(core::mem::size_of::<ImportDeclaration>() == 96);
const _: () = assert!(core::mem::size_of::<ImportEqualsDeclaration>() == 48);
const _: () = assert!(core::mem::size_of::<ExportDeclaration>() == 60);
const _: () = assert!(core::mem::size_of::<ErasedMember>() == 28);
const _: () = assert!(core::mem::size_of::<Keyword>() == 16);
const _: () = assert!(core::mem::size_of::<TypeOnlySpecifier>() == 72);
const _: () = assert!(core::mem::size_of::<Mark>() == 44);
const _: () = assert!(core::mem::size_of::<CommentRange>() == 12);
const _: () = assert!(core::mem::size_of::<PragmaArgument>() == 32);
const _: () = assert!(core::mem::size_of::<FileReference>() == 24);
const _: () = assert!(core::mem::size_of::<ModuleReference>() == 20);
const _: () = assert!(core::mem::size_of::<ModuleExportName>() == 24);
const _: () = assert!(core::mem::size_of::<ExportClause>() == 24);
const _: () = assert!(core::mem::size_of::<ErasedMemberData>() == 12);
const _: () = assert!(core::mem::size_of::<Sidecar>() == 424);
const _: () = assert!(core::mem::size_of::<Header>() == 128);

/// The offset of the first token at or after `pos`: the whitespace and the comments from `pos` on are skipped.
pub fn token_start_at_or_after(source: &[u8], comments: &[Range], pos: u32) -> u32 {
    let mut pos = (pos as usize).min(source.len());
    let mut next = comments.partition_point(|comment| comment.loc.i() < pos);
    loop {
        pos = skip_whitespace_after(source, pos);
        match comments.get(next) {
            Some(comment) if comment.loc.i() == pos => {
                pos = comment.end_i().min(source.len());
                next += 1;
            }
            _ => break,
        }
    }
    pos as u32
}

fn skip_whitespace_after(source: &[u8], mut pos: usize) -> usize {
    while let Some(&first) = source.get(pos) {
        let len = (bun_core::strings::wtf8_byte_sequence_length(first) as usize).clamp(1, 4);
        let Some(bytes) = source.get(pos..pos + len) else {
            break;
        };
        let mut buffer = [0u8; 4];
        buffer[..len].copy_from_slice(bytes);
        let is_space =
            match bun_core::strings::decode_wtf8_rune_t::<u32>(buffer, len as u8, u32::MAX) {
                0x09 | 0x0A | 0x0B | 0x0C | 0x0D | 0x2028 | 0x2029 | 0xFEFF => true,
                rune => bun_core::strings::is_unicode_space_separator(rune),
            };
        if !is_space {
            break;
        }
        pos += len;
    }
    pos
}

/// A modifier keyword, `get`, `set` or `*` before the name of a class member or of a parameter.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct HeaderToken {
    pub start: u32,
    pub end: u32,
    pub kind: HeaderTokenKind,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HeaderTokenKind {
    Abstract,
    Accessor,
    Async,
    Declare,
    Get,
    Override,
    Private,
    Protected,
    Public,
    Readonly,
    Set,
    Static,
    Asterisk,
}

/// Whose header [`header_tokens`] reads.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HeaderOf {
    /// Every keyword of [`HeaderTokenKind`], and `*`.
    ClassMember,
    /// `public`, `private`, `protected`, `readonly` and `override`.
    Parameter,
}

/// The keywords and `*` that stand between `floor` and `anchor`, in source order: the walk goes back from `anchor`.
pub fn header_tokens(
    source: &[u8],
    comments: &[Range],
    of: HeaderOf,
    floor: u32,
    anchor: u32,
    out: &mut Vec<HeaderToken>,
) {
    let first = out.len();
    let floor = floor as usize;
    let mut at = (anchor as usize).min(source.len());
    loop {
        let end = super::full_start(source, comments, at as u32) as usize;
        if end <= floor || end > at {
            break;
        }
        if of == HeaderOf::ClassMember && source.get(end - 1) == Some(&b'*') {
            out.push(HeaderToken {
                start: (end - 1) as u32,
                end: end as u32,
                kind: HeaderTokenKind::Asterisk,
            });
            at = end - 1;
            continue;
        }
        let mut start = end;
        while start > floor && source.get(start - 1).is_some_and(u8::is_ascii_alphabetic) {
            start -= 1;
        }
        if start == end {
            break;
        }
        if start > 0
            && source
                .get(start - 1)
                .is_some_and(|&before| is_name_byte(before))
        {
            break;
        }
        let Some(kind) = source
            .get(start..end)
            .and_then(|word| header_word(word, of))
        else {
            break;
        };
        let before = super::full_start(source, comments, start as u32) as usize;
        if before > 0 && matches!(source.get(before - 1), Some(&(b'@' | b'.'))) {
            break;
        }
        out.push(HeaderToken {
            start: start as u32,
            end: end as u32,
            kind,
        });
        at = start;
    }
    if let Some(found) = out.get_mut(first..) {
        found.reverse();
    }
}

fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | b'\\') || byte >= 0x80
}

fn header_word(word: &[u8], of: HeaderOf) -> Option<HeaderTokenKind> {
    let kind = match word {
        b"abstract" => HeaderTokenKind::Abstract,
        b"accessor" => HeaderTokenKind::Accessor,
        b"async" => HeaderTokenKind::Async,
        b"declare" => HeaderTokenKind::Declare,
        b"get" => HeaderTokenKind::Get,
        b"override" => HeaderTokenKind::Override,
        b"private" => HeaderTokenKind::Private,
        b"protected" => HeaderTokenKind::Protected,
        b"public" => HeaderTokenKind::Public,
        b"readonly" => HeaderTokenKind::Readonly,
        b"set" => HeaderTokenKind::Set,
        b"static" => HeaderTokenKind::Static,
        _ => return None,
    };
    let is_parameter_word = matches!(
        kind,
        HeaderTokenKind::Override
            | HeaderTokenKind::Private
            | HeaderTokenKind::Protected
            | HeaderTokenKind::Public
            | HeaderTokenKind::Readonly
    );
    (of == HeaderOf::ClassMember || is_parameter_word).then_some(kind)
}

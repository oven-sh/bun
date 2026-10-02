//! What the parser hands over of the TypeScript syntax it reads, in keep mode, for rows of the type checker's tree to be made of
//! (`clone_types.rs`): what the arguments of `NewParameterDeclaration` and its like are to TypeScript's parser. Names are slices of the
//! source. Expressions and statements written inside types are ordinary `Expr` and `Stmt` values.
//!
//! What `bun_ast` has a statement, an element or a note for is kept until the lowering comes to that, in the arrays of [`Syntax`],
//! which are allocated with `AstAlloc` like the rest of the AST. An attempt at parsing that is abandoned leaves something behind
//! there. Nothing iterates over the arrays, so that is harmless.

use core::marker::PhantomData;

use bun_alloc::{AstAlloc, AstVec};

use bun_ast::{Expr, Loc, Stmt, StoreSlice, StoreStr};

/// A 4-byte handle to a node in one of the arrays of [`Syntax`].
#[repr(transparent)]
pub(crate) struct Id<T>(u32, PhantomData<fn() -> T>);

impl<T> Id<T> {
    pub(crate) const NONE: Self = Id(u32::MAX, PhantomData);

    #[inline]
    pub(crate) const fn index(self) -> usize {
        self.0 as usize
    }

    #[inline]
    pub(crate) const fn from_index(index: u32) -> Self {
        Id(index, PhantomData)
    }
}

impl<T> Copy for Id<T> {}
impl<T> Clone for Id<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> PartialEq for Id<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
impl<T> Eq for Id<T> {}
impl<T> Default for Id<T> {
    #[inline]
    fn default() -> Self {
        Self::NONE
    }
}

/// Consecutive nodes in the array that holds `T`.
pub(crate) struct Span<T> {
    start: u32,
    len: u32,
    marker: PhantomData<fn() -> T>,
}

impl<T> Span<T> {
    pub(crate) const EMPTY: Self = Span {
        start: 0,
        len: 0,
        marker: PhantomData,
    };

    #[inline]
    pub(crate) const fn len(self) -> usize {
        self.len as usize
    }

    #[inline]
    pub(crate) const fn is_empty(self) -> bool {
        self.len == 0
    }

    #[inline]
    pub(crate) fn iter(self) -> impl ExactSizeIterator<Item = Id<T>> {
        (self.start..self.start + self.len).map(|index| Id(index, PhantomData))
    }

    /// Where it starts, and how long it is.
    #[inline]
    pub(crate) const fn parts(self) -> [u32; 2] {
        [self.start, self.len]
    }

    #[inline]
    pub(crate) const fn from_parts([start, len]: [u32; 2]) -> Self {
        Span {
            start,
            len,
            marker: PhantomData,
        }
    }
}

impl<T> Copy for Span<T> {}
impl<T> Clone for Span<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Default for Span<T> {
    #[inline]
    fn default() -> Self {
        Self::EMPTY
    }
}

pub(crate) use bun_sema::hir::{
    Flags, FnId as SignatureId, FnKind as SignatureKind, Keyword, MappedModifier, MemberKind,
    PatId as PatternId, ResolutionMode, TypeNodeId as TypeId, TypeParamId,
};
/// Rows of the type checker's tree, which are made as soon as what they are of has been read (`clone_types.rs`).
pub(crate) type Types = bun_sema::hir::IdList<TypeId>;
pub(crate) type Names = bun_sema::hir::Span<bun_sema::hir::NameId>;
pub(crate) type Members = bun_sema::hir::Span<bun_sema::hir::MemberId>;
pub(crate) type Params = bun_sema::hir::Span<bun_sema::hir::ParamId>;
pub(crate) type TypeParams = bun_sema::hir::Span<TypeParamId>;
pub(crate) type StatementId = Id<Statement>;
pub(crate) type JsxId = Id<Jsx>;

#[derive(Copy, Clone)]
pub(crate) struct Name {
    pub(crate) text: StoreStr,
    pub(crate) loc: Loc,
}

/// `with { .. }` after a module specifier.
#[derive(Copy, Clone)]
pub(crate) struct ImportAttributes {
    /// Of `with`, or of what is written instead.
    pub(crate) keyword_loc: Loc,
    /// The attributes, as an object literal.
    pub(crate) object: Expr,
}

#[derive(Copy, Clone)]
pub(crate) struct TupleElement {
    pub(crate) ty: TypeId,
    pub(crate) label: Option<StoreStr>,
    pub(crate) is_optional: bool,
    pub(crate) is_rest: bool,
    pub(crate) loc: Loc,
    /// `node.End()`
    pub(crate) end: Loc,
}

/// `{ readonly [K in T as N]?: X }`
#[derive(Copy, Clone)]
pub(crate) struct MappedType {
    pub(crate) param: TypeParamId,
    pub(crate) name_type: TypeId,
    pub(crate) ty: TypeId,
    pub(crate) readonly: MappedModifier,
    pub(crate) optional: MappedModifier,
    /// Where the first member after `[K in T]: X` is reported.
    pub(crate) extra_member_loc: Option<Loc>,
    /// The members after `[K in T]: X`, which are an error.
    pub(crate) members: Members,
}

#[derive(Copy, Clone)]
pub(crate) struct TypeParam {
    pub(crate) name: StoreStr,
    pub(crate) loc: Loc,
    /// Of its first token: a modifier, or the name.
    pub(crate) start: Loc,
    /// `node.End()`
    pub(crate) end: Loc,
    pub(crate) constraint: TypeId,
    pub(crate) default: TypeId,
    /// `const`, `in`, `out`
    pub(crate) flags: Flags,
    /// `node.Modifiers()`
    pub(crate) modifiers: Span<Modifier>,
}

#[derive(Copy, Clone)]
pub(crate) enum PropertyKey {
    None,
    /// An identifier, a keyword or a string.
    Name(StoreStr),
    /// An index into [`Syntax::numbers`].
    Number(f64),
    /// `1n`, which is an error. It names nothing.
    BigInt,
    Private(StoreStr),
    /// `[expression]`
    Computed(Expr),
}

#[derive(Copy, Clone)]
pub(crate) struct Modifier {
    /// Exactly one flag. None for a decorator.
    pub(crate) flag: Flags,
    /// Of a decorator: where its `@` is.
    pub(crate) loc: Loc,
    /// The expression of a decorator.
    pub(crate) decorator: Option<Expr>,
}

/// A member of an object type or an interface.
#[derive(Copy, Clone)]
pub(crate) struct Member {
    pub(crate) kind: MemberKind,
    pub(crate) key: PropertyKey,
    pub(crate) flags: Flags,
    /// In source order.
    pub(crate) modifiers: Span<Modifier>,
    pub(crate) ty: TypeId,
    /// `name: T = expression`, which is an error.
    pub(crate) initializer: Option<Expr>,
    /// `[key: K,]: T`: where the comma is, which is an error.
    pub(crate) index_signature_errors: [Option<(u32, u32)>; 2],
    pub(crate) signature: SignatureId,
    pub(crate) loc: Loc,
    /// Of its first token: a modifier, `get`, `set`, or `loc`.
    pub(crate) start: Loc,
    /// `node.Pos()`
    pub(crate) full_start: Loc,
    /// `node.End()`
    pub(crate) end: Loc,
}

#[derive(Copy, Clone)]
pub(crate) struct FunctionBody {
    /// Of the `{`.
    pub(crate) loc: Loc,
    /// `node.End()`
    pub(crate) end: Loc,
    pub(crate) stmts: StoreSlice<Stmt>,
}

/// `<T>(this: A, b: B): R`
#[derive(Copy, Clone)]
pub(crate) struct Signature {
    pub(crate) kind: SignatureKind,
    pub(crate) flags: Flags,
    pub(crate) type_params: TypeParams,
    pub(crate) params: Params,
    pub(crate) return_type: TypeId,
    /// `get name() { .. }` in a type, which is an error.
    pub(crate) body: Option<FunctionBody>,
    pub(crate) open_paren_loc: Loc,
    pub(crate) loc: Loc,
}

#[derive(Copy, Clone)]
pub(crate) struct Param {
    pub(crate) pattern: PatternId,
    pub(crate) ty: TypeId,
    /// `name = expression`, which is an error in a signature without a body.
    pub(crate) default: Option<Expr>,
    /// `?`, `...`, and the modifiers.
    pub(crate) flags: Flags,
    /// `public name`, which is an error outside a constructor. In source order.
    pub(crate) modifiers: Span<Modifier>,
    /// Of the `...` and of the `?`, if `flags` has them. Only error messages need them.
    pub(crate) rest_loc: Loc,
    pub(crate) question_loc: Loc,
    pub(crate) loc: Loc,
    /// `node.Pos()`
    pub(crate) full_start: Loc,
    /// `node.End()`
    pub(crate) end: Loc,
}

impl Param {
    /// The parameter whose first token is at `loc`, before anything of it is read.
    pub(crate) fn at(loc: Loc) -> Param {
        Param {
            pattern: PatternId::NONE,
            ty: TypeId::NONE,
            default: None,
            flags: Flags::empty(),
            modifiers: Span::EMPTY,
            rest_loc: Loc::EMPTY,
            question_loc: Loc::EMPTY,
            loc,
            full_start: Loc::EMPTY,
            end: Loc::EMPTY,
        }
    }
}

#[derive(Copy, Clone)]
pub(crate) struct PatternProperty {
    pub(crate) key: PropertyKey,
    pub(crate) value: PatternId,
    pub(crate) default: Option<Expr>,
    pub(crate) is_rest: bool,
    pub(crate) loc: Loc,
    /// `node.End()`
    pub(crate) end: Loc,
}

#[derive(Copy, Clone)]
pub(crate) struct PatternElement {
    pub(crate) pattern: PatternId,
    pub(crate) default: Option<Expr>,
    pub(crate) is_rest: bool,
    /// Of its first token: the `...`, or the pattern.
    pub(crate) loc: Loc,
    /// `node.End()`
    pub(crate) end: Loc,
}

/// A statement that only exists in TypeScript. The parser leaves an `S::TypeScript` placeholder in the statement list, which refers to
/// this node.
#[derive(Copy, Clone)]
pub(crate) struct Statement {
    pub(crate) data: StatementData,
    /// `export`, `default`, `declare`, in source order.
    pub(crate) modifiers: Span<Modifier>,
    /// Of the keyword after the modifiers.
    pub(crate) loc: Loc,
}

#[derive(Copy, Clone)]
pub(crate) enum StatementData {
    Interface(Id<Interface>),
    TypeAlias(Id<TypeAlias>),
    Import(Id<Import>),
    ImportEquals(Id<ImportEquals>),
    Export(Id<Export>),
    /// `export as namespace name`
    ExportAsNamespace(Name),
}

#[derive(Copy, Clone)]
pub(crate) struct Interface {
    pub(crate) name: Name,
    pub(crate) type_params: TypeParams,
    /// The types of the first `extends` clause.
    pub(crate) extends: Types,
    /// The types of its other heritage clauses.
    pub(crate) other_heritage: Types,
    /// Where the heritage clauses break a grammar rule, and TypeScript's error code: an empty list or a trailing comma in the first
    /// `extends` clause, then a second `extends` clause.
    pub(crate) heritage_errors: [Option<(Loc, u32)>; 2],
    pub(crate) members: Members,
}

#[derive(Copy, Clone)]
pub(crate) struct TypeAlias {
    pub(crate) name: Name,
    pub(crate) type_params: TypeParams,
    pub(crate) ty: TypeId,
}

/// `parseModuleSpecifier`, and what the import attributes after it say.
#[derive(Copy, Clone)]
pub(crate) struct ModuleSpecifier {
    /// The value of the string. `None` for any other expression, which is an error.
    pub(crate) text: Option<StoreStr>,
    pub(crate) loc: Loc,
    /// From `with { "resolution-mode": "import" }`.
    pub(crate) mode: ResolutionMode,
    /// What is written, if it is no string.
    pub(crate) expression: Option<Expr>,
    pub(crate) attributes: Option<ImportAttributes>,
}

/// `parseModuleExportName`: a word or a string. A name that is missing is empty, and is where the token before it ends.
#[derive(Copy, Clone)]
pub(crate) struct ModuleExportName {
    pub(crate) text: StoreStr,
    pub(crate) loc: Loc,
    /// `node.End()`
    pub(crate) end: Loc,
    pub(crate) is_string: bool,
}

/// `name`, `property_name as name`, with or without `type` before it.
#[derive(Copy, Clone)]
pub(crate) struct Specifier {
    /// Of its first token: `type`, or the first name.
    pub(crate) loc: Loc,
    pub(crate) is_type_only: bool,
    pub(crate) property_name: Option<ModuleExportName>,
    pub(crate) name: ModuleExportName,
    /// `node.End()`
    pub(crate) end: Loc,
}

/// `* as name`
#[derive(Copy, Clone)]
pub(crate) struct NamespaceImport {
    pub(crate) star_loc: Loc,
    /// Empty if it is missing, and then where the token before it ends.
    pub(crate) name: Name,
}

/// `import default_name, * as namespace from "module"`, `import { specifiers } from "module"`, `import "module"`
#[derive(Copy, Clone)]
pub(crate) struct Import {
    /// Of the token after `import`.
    pub(crate) clause_loc: Loc,
    /// `importClause.End()`
    pub(crate) clause_end: Loc,
    pub(crate) is_type_only: bool,
    /// `import defer ..`
    pub(crate) is_deferred: bool,
    pub(crate) default_name: Option<Name>,
    pub(crate) namespace: Option<NamespaceImport>,
    /// `None` without `{ }`.
    pub(crate) specifiers: Option<Span<Specifier>>,
    pub(crate) module: ModuleSpecifier,
    /// It is a statement of the body of a module that is ambient.
    pub(crate) is_in_ambient_module: bool,
}

#[derive(Copy, Clone)]
pub(crate) enum ModuleReference {
    /// `a.b.c`. A name that is missing is empty.
    EntityName(Names),
    /// `require("module")`. `expression`: the argument if it is no string, which is an error. With neither, there is no argument.
    External {
        text: Option<StoreStr>,
        loc: Loc,
        expression: Option<Expr>,
    },
}

/// `import name = reference`
#[derive(Copy, Clone)]
pub(crate) struct ImportEquals {
    pub(crate) name: Name,
    pub(crate) is_type_only: bool,
    pub(crate) reference: ModuleReference,
    /// It is a statement of the body of a module that is ambient.
    pub(crate) is_in_ambient_module: bool,
}

#[derive(Copy, Clone)]
pub(crate) enum ExportClause {
    /// `*`, `* as alias`. `alias_loc`: of the token after `*`, or after `as`.
    Star {
        star_loc: Loc,
        alias: Option<ModuleExportName>,
        alias_loc: Loc,
    },
    /// `{ specifiers }`
    Named(Span<Specifier>),
}

/// `export clause`, `export clause from "module"`
#[derive(Copy, Clone)]
pub(crate) struct Export {
    pub(crate) is_type_only: bool,
    pub(crate) clause: ExportClause,
    pub(crate) module: Option<ModuleSpecifier>,
}

/// What `E::JSXElement` has no place for.
#[derive(Copy, Clone)]
pub(crate) struct Jsx {
    /// The name in `</tag>`, missing or not. `E::JSXElement::tag` is the name in the opening tag. `None` for `<tag />` and for a
    /// fragment.
    pub(crate) closing_tag: Option<Expr>,
    /// Where `<tag attributes>`, `<>` or all of `<tag attributes />` ends.
    pub(crate) opening_end: Loc,
    /// The `<` of `</tag>` or `</>`, or where that is missed. `EMPTY` for `<tag />`.
    pub(crate) closing_start: Loc,
    /// Where the element ends.
    pub(crate) end: Loc,
    /// `<tag<T>>`
    pub(crate) type_arguments: Types,
}

macro_rules! define_syntax {
    (@add $array:ident: $node:ty, $add:ident one) => {
        #[inline]
        pub(crate) fn $add(&mut self, node: $node) -> Id<$node> {
            self.$array.push(node);
            Id((self.$array.len() - 1) as u32, PhantomData)
        }
    };
    (@add $array:ident: $node:ty, $add:ident many) => {
        #[inline]
        pub(crate) fn $add(&mut self, nodes: &[$node]) -> Span<$node> {
            let start = self.$array.len() as u32;
            self.$array.extend_from_slice(nodes);
            Span { start, len: nodes.len() as u32, marker: PhantomData }
        }
    };
    ($($array:ident: $node:ty, $add:ident $many:tt;)*) => {
        /// Every TypeScript syntax node of one file.
        pub(crate) struct Syntax {
            $(pub(crate) $array: AstVec<$node>,)*
        }

        impl Syntax {
            pub(crate) fn new() -> Self {
                Syntax { $($array: AstAlloc::vec(),)* }
            }

            $(define_syntax!(@add $array: $node, $add $many);)*
        }

        $(
            impl core::ops::Index<Id<$node>> for Syntax {
                type Output = $node;
                #[inline]
                fn index(&self, id: Id<$node>) -> &$node {
                    &self.$array[id.index()]
                }
            }

            impl core::ops::IndexMut<Id<$node>> for Syntax {
                #[inline]
                fn index_mut(&mut self, id: Id<$node>) -> &mut $node {
                    &mut self.$array[id.index()]
                }
            }

            impl core::ops::Index<Span<$node>> for Syntax {
                type Output = [$node];
                #[inline]
                fn index(&self, span: Span<$node>) -> &[$node] {
                    &self.$array[span.start as usize..(span.start + span.len) as usize]
                }
            }
        )*
    };
}

define_syntax! {
    modifiers: Modifier, add_modifiers many;
    statements: Statement, add_statement one;
    interfaces: Interface, add_interface one;
    type_aliases: TypeAlias, add_type_alias one;
    specifiers: Specifier, add_specifiers many;
    imports: Import, add_import one;
    import_equals: ImportEquals, add_import_equals one;
    exports: Export, add_export one;
    jsx: Jsx, add_jsx one;
    expressions: Expr, add_expression one;
}

impl Default for Syntax {
    fn default() -> Self {
        Self::new()
    }
}

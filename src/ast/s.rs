//! Statement node payloads (`S.*`).
//!
//! All slice fields in this module are arena-owned by the parser's
//! `Stmt.Data.Store` / AST arena and are bulk-freed; they are represented as
//! `StoreSlice<T>` / `StoreStr` (lifetime-erased arena slice newtypes — see
//! `crate::StoreSlice` doc).

use crate::g as G;
use crate::{
    Case, Catch, ClauseItem, EnumValue, ExprNodeIndex, Finally, LocRef, Ref, StmtData,
    StmtNodeIndex, StmtNodeList, StmtOrExpr,
};
use crate::{StoreSlice, StoreStr};

pub struct Block<'arena> {
    pub stmts: StmtNodeList<'arena>,
    pub close_brace_loc: crate::Loc, // = crate::Loc::EMPTY
}

impl<'arena> Default for Block<'arena> {
    fn default() -> Self {
        Self {
            stmts: StmtNodeList::EMPTY,
            close_brace_loc: crate::Loc::EMPTY,
        }
    }
}

#[derive(Default)]
pub struct SExpr<'arena> {
    pub value: ExprNodeIndex<'arena>,

    /// This is set to true for automatically-generated expressions that should
    /// not affect tree shaking. For example, calling a function from the runtime
    /// that doesn't have externally-visible side effects.
    pub does_not_affect_tree_shaking: bool, // = false
}

pub struct Comment<'arena> {
    pub text: StoreStr<'arena>, // arena-owned
}

pub struct Directive<'arena> {
    pub value: StoreStr<'arena>, // arena-owned
}

#[derive(Default)]
pub struct ExportClause<'arena> {
    pub items: StoreSlice<'arena, ClauseItem<'arena>>, // arena-owned
    pub is_single_line: bool,
}

#[derive(Clone, Copy, Default)]
pub struct Empty {}

pub struct ExportStar<'arena> {
    pub namespace_ref: Ref,
    pub alias: Option<G::ExportStarAlias<'arena>>, // = None
    pub import_record_index: u32,
}

/// This is an "export = value;" statement in TypeScript
pub struct ExportEquals<'arena> {
    pub value: ExprNodeIndex<'arena>,
}

pub struct Label<'arena> {
    pub name: LocRef,
    pub stmt: StmtNodeIndex<'arena>,
}

/// This is a stand-in for a TypeScript type declaration
#[derive(Clone, Copy, Default)]
pub struct TypeScript {}

#[derive(Clone, Copy, Default)]
pub struct Debugger {}

pub struct ExportFrom<'arena> {
    pub items: StoreSlice<'arena, ClauseItem<'arena>>, // arena-owned
    pub namespace_ref: Ref,
    pub import_record_index: u32,
    pub is_single_line: bool,
}

pub struct ExportDefault<'arena> {
    pub default_name: LocRef, // value may be a SFunction or SClass
    pub value: StmtOrExpr<'arena>,
}

impl<'arena> ExportDefault<'arena> {
    pub fn can_be_moved(&self) -> bool {
        match &self.value {
            StmtOrExpr::Expr(e) => e.can_be_moved(),
            StmtOrExpr::Stmt(s) => match &s.data {
                StmtData::SClass(class) => class.class.can_be_moved(),
                StmtData::SFunction(_) => true,
                _ => false,
            },
        }
    }
}

pub struct Enum<'arena> {
    pub name: LocRef,
    pub arg: Ref,
    pub values: StoreSlice<'arena, EnumValue<'arena>>, // arena-owned
    pub is_export: bool,
}

pub struct Namespace<'arena> {
    pub name: LocRef,
    pub arg: Ref,
    pub stmts: StmtNodeList<'arena>,
    pub is_export: bool,
}

pub struct Function<'arena> {
    pub func: G::Fn<'arena>,
}

#[derive(Default)]
pub struct Class<'arena> {
    pub class: G::Class<'arena>,
    pub is_export: bool, // = false
}

pub struct If<'arena> {
    pub test_: ExprNodeIndex<'arena>,
    pub yes: StmtNodeIndex<'arena>,
    pub no: Option<StmtNodeIndex<'arena>>,
}

pub struct For<'arena> {
    /// May be a SConst, SLet, SVar, or SExpr
    pub init: Option<StmtNodeIndex<'arena>>, // = None
    pub test_: Option<ExprNodeIndex<'arena>>,  // = None
    pub update: Option<ExprNodeIndex<'arena>>, // = None
    pub body: StmtNodeIndex<'arena>,
}

pub struct ForIn<'arena> {
    /// May be a SConst, SLet, SVar, or SExpr
    pub init: StmtNodeIndex<'arena>,
    pub value: ExprNodeIndex<'arena>,
    pub body: StmtNodeIndex<'arena>,
}

pub struct ForOf<'arena> {
    pub is_await: bool, // = false
    /// May be a SConst, SLet, SVar, or SExpr
    pub init: StmtNodeIndex<'arena>,
    pub value: ExprNodeIndex<'arena>,
    pub body: StmtNodeIndex<'arena>,
}

pub struct DoWhile<'arena> {
    pub body: StmtNodeIndex<'arena>,
    pub test_: ExprNodeIndex<'arena>,
}

pub struct While<'arena> {
    pub test_: ExprNodeIndex<'arena>,
    pub body: StmtNodeIndex<'arena>,
}

pub struct With<'arena> {
    pub value: ExprNodeIndex<'arena>,
    pub body: StmtNodeIndex<'arena>,
    pub body_loc: crate::Loc, // = crate::Loc::EMPTY
}

pub struct Try<'arena> {
    pub body_loc: crate::Loc,
    pub body: StmtNodeList<'arena>,

    pub catch_: Option<Catch<'arena>>,    // = None
    pub finally: Option<Finally<'arena>>, // = None
}

pub struct Switch<'arena> {
    pub test_: ExprNodeIndex<'arena>,
    pub body_loc: crate::Loc,
    pub cases: StoreSlice<'arena, Case<'arena>>, // arena-owned
}

/// This object represents all of these types of import statements:
///
///    import 'path'
///    import {item1, item2} from 'path'
///    import * as ns from 'path'
///    import defaultItem, {item1, item2} from 'path'
///    import defaultItem, * as ns from 'path'
///
/// Many parts are optional and can be combined in different ways. The only
/// restriction is that you cannot have both a clause and a star namespace.
pub struct Import<'arena> {
    /// If this is a star import: This is a Ref for the namespace symbol. The Loc
    /// for the symbol is StarLoc.
    ///
    /// Otherwise: This is an auto-generated Ref for the namespace representing
    /// the imported file. In this case StarLoc is nil. The NamespaceRef is used
    /// when converting this module to a CommonJS module.
    pub namespace_ref: Ref,
    pub default_name: Option<LocRef>,      // = None
    pub items: StoreSlice<'arena, ClauseItem<'arena>>,     // arena-owned; = &[]
    pub star_name_loc: Option<crate::Loc>, // = None
    pub import_record_index: u32,
    pub is_single_line: bool, // = false
}

impl<'arena> Default for Import<'arena> {
    fn default() -> Self {
        Self {
            namespace_ref: Ref::NONE,
            default_name: None,
            items: StoreSlice::EMPTY,
            star_name_loc: None,
            import_record_index: u32::MAX,
            is_single_line: false,
        }
    }
}

#[derive(Default)]
pub struct Return<'arena> {
    pub value: Option<ExprNodeIndex<'arena>>, // = None
}

pub struct Throw<'arena> {
    pub value: ExprNodeIndex<'arena>,
}

pub struct Local<'arena> {
    pub kind: Kind,         // = Kind::KVar
    pub decls: G::DeclList<'arena>, // = .{}
    pub is_export: bool,    // = false
    /// The TypeScript compiler doesn't generate code for "import foo = bar"
    /// statements where the import is never used.
    pub was_ts_import_equals: bool, // = false

    pub was_commonjs_export: bool, // = false
}

impl<'arena> Default for Local<'arena> {
    fn default() -> Self {
        Self {
            kind: Kind::default(),
            decls: bun_alloc::AstAlloc::vec(),
            is_export: false,
            was_ts_import_equals: false,
            was_commonjs_export: false,
        }
    }
}

impl<'arena> Local<'arena> {
    pub fn can_merge_with(&self, other: &Local) -> bool {
        // Don't merge "using" / "await using" declarations. Merging them is
        // spec-compliant but matches esbuild's behavior of keeping them
        // separate, and avoids any downstream pass assuming one decl per
        // `using` statement.
        if self.kind.is_using() {
            return false;
        }
        self.kind == other.kind
            && self.is_export == other.is_export
            && self.was_commonjs_export == other.was_commonjs_export
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, strum::IntoStaticStr)]
pub enum Kind {
    #[default]
    #[strum(serialize = "k_var")]
    KVar,
    #[strum(serialize = "k_let")]
    KLet,
    #[strum(serialize = "k_const")]
    KConst,
    #[strum(serialize = "k_using")]
    KUsing,
    #[strum(serialize = "k_await_using")]
    KAwaitUsing,
}

impl Kind {
    // TODO(port): Zig `jsonStringify` hooks into std.json; wire to whatever
    // JSON-serialize trait the AST uses in Rust (serde::Serialize or custom).
    pub fn json_stringify(self, writer: &mut impl core::fmt::Write) -> core::fmt::Result {
        // TODO(port): narrow error set
        writer.write_str(<&'static str>::from(self))
    }

    pub fn is_using(self) -> bool {
        matches!(self, Kind::KUsing | Kind::KAwaitUsing)
    }

    pub fn is_reassignable(self) -> bool {
        matches!(self, Kind::KVar | Kind::KLet)
    }
}

#[derive(Default)]
pub struct Break {
    pub label: Option<LocRef>, // = None
}

#[derive(Default)]
pub struct Continue {
    pub label: Option<LocRef>, // = None
}

// ported from: src/js_parser/ast/S.zig

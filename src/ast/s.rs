//! Statement node payloads (`S.*`).
//!
//! All slice fields in this module are arena-owned by the parser's
//! AST arena and are bulk-freed; they are represented as
//! `StoreSlice<T>` / `StoreStr`.

use crate::g as G;
use crate::{
    AstVec, Case, Catch, ClauseItem, EnumValue, ExprNodeIndex, Finally, LocRef, Ref, StmtData,
    StmtNodeIndex, StmtNodeList, StmtOrExpr,
};
use crate::{StoreSlice, StoreStr};

pub struct Block<'a> {
    pub stmts: StmtNodeList<'a>,
    pub close_brace_loc: crate::Loc, // = crate::Loc::EMPTY
}

impl Default for Block<'_> {
    fn default() -> Self {
        Self {
            stmts: StmtNodeList::EMPTY,
            close_brace_loc: crate::Loc::EMPTY,
        }
    }
}

#[derive(Default)]
pub struct SExpr<'a> {
    pub value: ExprNodeIndex<'a>,

    /// This is set to true for automatically-generated expressions that should
    /// not affect tree shaking. For example, calling a function from the runtime
    /// that doesn't have externally-visible side effects.
    pub does_not_affect_tree_shaking: bool, // = false
}

pub struct Comment<'a> {
    pub text: StoreStr<'a>,
}

pub struct Directive<'a> {
    pub value: StoreStr<'a>,
}

#[derive(Default)]
pub struct ExportClause<'a> {
    pub items: StoreSlice<'a, ClauseItem<'a>>,
    pub is_single_line: bool,
}

#[derive(Clone, Copy, Default)]
pub struct Empty {}

pub struct ExportStar<'a> {
    pub namespace_ref: Ref,
    pub alias: Option<G::ExportStarAlias<'a>>, // = None
    pub import_record_index: u32,
}

/// This is an "export = value;" statement in TypeScript
pub struct ExportEquals<'a> {
    pub value: ExprNodeIndex<'a>,
}

pub struct Label<'a> {
    pub name: LocRef,
    pub stmt: StmtNodeIndex<'a>,
}

/// This is a stand-in for a TypeScript type declaration
#[derive(Clone, Copy, Default)]
pub struct TypeScript {}

#[derive(Clone, Copy, Default)]
pub struct Debugger {}

pub struct ExportFrom<'a> {
    pub items: StoreSlice<'a, ClauseItem<'a>>,
    pub namespace_ref: Ref,
    pub import_record_index: u32,
    pub is_single_line: bool,
}

pub struct ExportDefault<'a> {
    pub default_name: LocRef, // value may be a SFunction or SClass
    pub value: StmtOrExpr<'a>,
}

impl ExportDefault<'_> {
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

pub struct Enum<'a> {
    pub name: LocRef,
    pub arg: Ref,
    pub values: StoreSlice<'a, EnumValue<'a>>,
    pub is_export: bool,
}

pub struct Namespace<'a> {
    pub name: LocRef,
    pub arg: Ref,
    pub stmts: StmtNodeList<'a>,
    pub is_export: bool,
}

pub struct Function<'a> {
    pub func: G::Fn<'a>,
}

#[derive(Default)]
pub struct Class<'a> {
    pub class: G::Class<'a>,
    pub is_export: bool, // = false
}

pub struct If<'a> {
    pub test: ExprNodeIndex<'a>,
    pub yes: StmtNodeIndex<'a>,
    pub no: Option<StmtNodeIndex<'a>>,
    /// Where the `else` of `no` is. `Loc::EMPTY` in an `if` that the parser did not make.
    pub else_loc: crate::Loc,
}

pub struct For<'a> {
    /// May be a SConst, SLet, SVar, or SExpr
    pub init: Option<StmtNodeIndex<'a>>, // = None
    pub test: Option<ExprNodeIndex<'a>>,   // = None
    pub update: Option<ExprNodeIndex<'a>>, // = None
    pub body: StmtNodeIndex<'a>,
}

pub struct ForIn<'a> {
    /// May be a SConst, SLet, SVar, or SExpr
    pub init: StmtNodeIndex<'a>,
    pub value: ExprNodeIndex<'a>,
    pub body: StmtNodeIndex<'a>,
}

pub struct ForOf<'a> {
    pub is_await: bool, // = false
    /// May be a SConst, SLet, SVar, or SExpr
    pub init: StmtNodeIndex<'a>,
    pub value: ExprNodeIndex<'a>,
    pub body: StmtNodeIndex<'a>,
}

pub struct DoWhile<'a> {
    pub body: StmtNodeIndex<'a>,
    pub test: ExprNodeIndex<'a>,
}

pub struct While<'a> {
    pub test: ExprNodeIndex<'a>,
    pub body: StmtNodeIndex<'a>,
}

pub struct With<'a> {
    pub value: ExprNodeIndex<'a>,
    pub body: StmtNodeIndex<'a>,
    pub body_loc: crate::Loc, // = crate::Loc::EMPTY
}

pub struct Try<'a> {
    pub body_loc: crate::Loc,
    pub body: StmtNodeList<'a>,

    pub catch: Option<Catch<'a>>,     // = None
    pub finally: Option<Finally<'a>>, // = None
}

pub struct Switch<'a> {
    pub test: ExprNodeIndex<'a>,
    pub body_loc: crate::Loc,
    pub cases: StoreSlice<'a, Case<'a>>,
}

/// This object represents all of these types of import statements:
///
///    import 'path'
///    import {item1, item2} from 'path'
///    import * as ns from 'path'
///    import defaultItem, {item1, item2} from 'path'
///    import defaultItem, * as ns from 'path'
///    import defer * as ns from 'path'
///
/// Many parts are optional and can be combined in different ways. The only
/// restriction is that you cannot have both a clause and a star namespace.
pub struct Import<'a> {
    /// If this is a star import: This is a Ref for the namespace symbol. The Loc
    /// for the symbol is StarLoc.
    ///
    /// Otherwise: This is an auto-generated Ref for the namespace representing
    /// the imported file. In this case StarLoc is nil. The NamespaceRef is used
    /// when converting this module to a CommonJS module.
    pub namespace_ref: Ref,
    pub default_name: Option<LocRef>, // = None
    pub items: StoreSlice<'a, ClauseItem<'a>>,
    pub star_name_loc: crate::Loc, // = Loc::EMPTY
    pub import_record_index: u32,
    pub is_single_line: bool, // = false
    /// "import defer * as ns from 'path'" — the TC39 Deferred Module Evaluation
    /// proposal. Only valid with a namespace import (`star_name_loc` is set,
    /// `default_name`/`items` are empty).
    pub phase_defer: bool, // = false
}

impl Default for Import<'_> {
    fn default() -> Self {
        Self {
            namespace_ref: Ref::NONE,
            default_name: None,
            items: StoreSlice::EMPTY,
            star_name_loc: crate::Loc::EMPTY,
            import_record_index: u32::MAX,
            is_single_line: false,
            phase_defer: false,
        }
    }
}

#[derive(Default)]
pub struct Return<'a> {
    pub value: Option<ExprNodeIndex<'a>>, // = None
}

pub struct Throw<'a> {
    pub value: ExprNodeIndex<'a>,
}

pub struct Local<'a> {
    pub kind: Kind,             // = Kind::KVar
    pub decls: G::DeclList<'a>, // = .{}
    pub is_export: bool,        // = false
    pub origin: LocalOrigin,
}

impl Default for Local<'_> {
    fn default() -> Self {
        Self {
            kind: Kind::default(),
            decls: AstVec::new(),
            is_export: false,
            origin: LocalOrigin::Normal,
        }
    }
}

impl Local<'_> {
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
            && self.origin.is_commonjs_export() == other.origin.is_commonjs_export()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum LocalOrigin {
    #[default]
    Normal,
    /// From TS `import x = ...`; dropped if unused (matches tsc).
    TsImportEquals,
    /// From rewritten `exports.x = ...`.
    CommonJsExport,
}

impl LocalOrigin {
    #[inline]
    pub fn is_ts_import_equals(self) -> bool {
        matches!(self, Self::TsImportEquals)
    }
    #[inline]
    pub fn is_commonjs_export(self) -> bool {
        matches!(self, Self::CommonJsExport)
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
    pub fn is_using(self) -> bool {
        matches!(self, Kind::KUsing | Kind::KAwaitUsing)
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

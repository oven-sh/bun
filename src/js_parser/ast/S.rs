//! Statement node payloads (`S.*`).
//!
//! All slice fields in this module are arena-owned by the parser's
//! `Stmt.Data.Store` / AST arena and are bulk-freed; they are represented as
//! raw fat pointers per PORTING.md (arena-owned struct field → raw `*const [T]`).
// TODO(port): once the AST arena type (`StoreRef` / `&'bump [T]`) is settled,
// replace every `*const [T]` / `*mut [T]` field below with it in one pass.

use crate::ast::{
    Case, Catch, ClauseItem, EnumValue, ExprNodeIndex, Finally, LocRef, Ref, StmtData,
    StmtNodeIndex, StmtNodeList, StmtOrExpr,
};
use crate::ast::g as G;
use bun_logger as logger;

pub struct Block {
    pub stmts: StmtNodeList,
    pub close_brace_loc: logger::Loc, // = logger::Loc::EMPTY
}

pub struct SExpr {
    pub value: ExprNodeIndex,

    /// This is set to true for automatically-generated expressions that should
    /// not affect tree shaking. For example, calling a function from the runtime
    /// that doesn't have externally-visible side effects.
    pub does_not_affect_tree_shaking: bool, // = false
}

pub struct Comment {
    pub text: *const [u8], // arena-owned
}

pub struct Directive {
    pub value: *const [u8], // arena-owned
}

pub struct ExportClause {
    pub items: *mut [ClauseItem], // arena-owned
    pub is_single_line: bool,
}

pub struct Empty {}

pub struct ExportStar {
    pub namespace_ref: Ref,
    pub alias: Option<G::ExportStarAlias>, // = None
    pub import_record_index: u32,
}

/// This is an "export = value;" statement in TypeScript
pub struct ExportEquals {
    pub value: ExprNodeIndex,
}

pub struct Label {
    pub name: LocRef,
    pub stmt: StmtNodeIndex,
}

/// This is a stand-in for a TypeScript type declaration
pub struct TypeScript {}

pub struct Debugger {}

pub struct ExportFrom {
    pub items: *mut [ClauseItem], // arena-owned
    pub namespace_ref: Ref,
    pub import_record_index: u32,
    pub is_single_line: bool,
}

pub struct ExportDefault {
    pub default_name: LocRef, // value may be a SFunction or SClass
    pub value: StmtOrExpr,
}

impl ExportDefault {
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

pub struct Enum {
    pub name: LocRef,
    pub arg: Ref,
    pub values: *mut [EnumValue], // arena-owned
    pub is_export: bool,
}

pub struct Namespace {
    pub name: LocRef,
    pub arg: Ref,
    pub stmts: StmtNodeList,
    pub is_export: bool,
}

pub struct Function {
    pub func: G::Fn,
}

pub struct Class {
    pub class: G::Class,
    pub is_export: bool, // = false
}

pub struct If {
    pub test_: ExprNodeIndex,
    pub yes: StmtNodeIndex,
    pub no: Option<StmtNodeIndex>,
}

pub struct For {
    /// May be a SConst, SLet, SVar, or SExpr
    pub init: Option<StmtNodeIndex>, // = None
    pub test_: Option<ExprNodeIndex>, // = None
    pub update: Option<ExprNodeIndex>, // = None
    pub body: StmtNodeIndex,
}

pub struct ForIn {
    /// May be a SConst, SLet, SVar, or SExpr
    pub init: StmtNodeIndex,
    pub value: ExprNodeIndex,
    pub body: StmtNodeIndex,
}

pub struct ForOf {
    pub is_await: bool, // = false
    /// May be a SConst, SLet, SVar, or SExpr
    pub init: StmtNodeIndex,
    pub value: ExprNodeIndex,
    pub body: StmtNodeIndex,
}

pub struct DoWhile {
    pub body: StmtNodeIndex,
    pub test_: ExprNodeIndex,
}

pub struct While {
    pub test_: ExprNodeIndex,
    pub body: StmtNodeIndex,
}

pub struct With {
    pub value: ExprNodeIndex,
    pub body: StmtNodeIndex,
    pub body_loc: logger::Loc, // = logger::Loc::EMPTY
}

pub struct Try {
    pub body_loc: logger::Loc,
    pub body: StmtNodeList,

    pub catch_: Option<Catch>, // = None
    pub finally: Option<Finally>, // = None
}

pub struct Switch {
    pub test_: ExprNodeIndex,
    pub body_loc: logger::Loc,
    pub cases: *mut [Case], // arena-owned
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
pub struct Import {
    /// If this is a star import: This is a Ref for the namespace symbol. The Loc
    /// for the symbol is StarLoc.
    ///
    /// Otherwise: This is an auto-generated Ref for the namespace representing
    /// the imported file. In this case StarLoc is nil. The NamespaceRef is used
    /// when converting this module to a CommonJS module.
    pub namespace_ref: Ref,
    pub default_name: Option<LocRef>, // = None
    pub items: *mut [ClauseItem], // arena-owned; = &[]
    pub star_name_loc: Option<logger::Loc>, // = None
    pub import_record_index: u32,
    pub is_single_line: bool, // = false
}

#[derive(Default)]
pub struct Return {
    pub value: Option<ExprNodeIndex>, // = None
}

pub struct Throw {
    pub value: ExprNodeIndex,
}

#[derive(Default)]
pub struct Local {
    pub kind: Kind, // = Kind::KVar
    pub decls: G::decl::List, // = .{}
    pub is_export: bool, // = false
    /// The TypeScript compiler doesn't generate code for "import foo = bar"
    /// statements where the import is never used.
    pub was_ts_import_equals: bool, // = false

    pub was_commonjs_export: bool, // = false
}

impl Local {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/S.zig (237 lines)
//   confidence: medium
//   todos:      3
//   notes:      arena-owned slice fields use raw *const/*mut [T]; swap to the
//               settled arena slice type in one pass. Zig per-field defaults on
//               structs with required fields are noted inline (Rust has no
//               partial-Default); callers must spell them out.
// ──────────────────────────────────────────────────────────────────────────

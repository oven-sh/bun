//! `js_parser/ast/` — AST type definitions.
//!
//! B-2 round B: node enums (E/Expr/S/Stmt/Ast) + Store. Round A's stub
//! `e/s/expr/stmt/ast` modules are replaced with the real Phase-A drafts.
//!
//! Arena convention: Phase A keeps node types lifetime-free. Slice fields are
//! `*mut [T]` / `*const [u8]`; pointer payloads are `StoreRef<T>` (a thin
//! `NonNull<T>` into the thread-local `Expr.Data.Store` / `Stmt.Data.Store`).
//! Phase B may thread a crate-wide `'bump` and rewrite to `&'bump`.
#![allow(non_snake_case, dead_code, unused, clippy::all)]

// ── REAL (un-gated Phase-A drafts) ─────────────────────────────────────────
#[path = "base.rs"]
pub mod base;
#[path = "Op.rs"]
pub mod op;
#[path = "UseDirective.rs"]
pub mod use_directive;
#[path = "CharFreq.rs"]
pub mod char_freq;
#[path = "Symbol.rs"]
pub mod symbol;
#[path = "Scope.rs"]
pub mod scope;
#[path = "TS.rs"]
pub mod ts;
#[path = "G.rs"]
pub mod g;
#[path = "B.rs"]
pub mod b;
#[path = "Binding.rs"]
pub mod binding;

// Round B: node enums + Store infrastructure.
#[path = "NewStore.rs"]
pub mod new_store;
#[path = "ASTMemoryAllocator.rs"]
pub mod ast_memory_allocator;
#[path = "S.rs"]
pub mod s;
#[path = "E.rs"]
pub mod e;
#[path = "Stmt.rs"]
pub mod stmt;
#[path = "Expr.rs"]
pub mod expr;
#[path = "Ast.rs"]
pub mod ast;
// `Part` lives in `lib.rs` (file-struct split); re-exported below.
pub mod part {
    pub use crate::{Part, PartList as List};
}

// ── Shared infrastructure for the AST tree ─────────────────────────────────

/// Arena-owned pointer into a `NewStore` block (or `bumpalo::Bump`).
///
/// MOVE_DOWN: canonical definition lives in `bun_logger::js_ast` (T2) so
/// `bun_interchange`/`bun_ini` can name `StoreRef<E::EString>` without a T4
/// dep. Re-exported here unchanged.
pub use bun_logger::js_ast::StoreRef;

/// `bun.DebugOnlyDisabler(T)` — debug-build re-entrancy guard around Store
/// access. No-op in release; in debug, asserts `!disabled`. Phase A keeps
/// only the `assert()` surface.
pub struct DebugOnlyDisabler<T>(core::marker::PhantomData<T>);
impl<T> DebugOnlyDisabler<T> {
    #[inline]
    pub fn assert() {
        // TODO(port): wire to a thread-local `disabled: bool` if any caller
        // actually toggles it; Zig sites only call `assert()`.
    }
    /// Zig: `disable()` flips a thread-local `disabled = true` so any
    /// subsequent `assert()` panics. Phase-A surface keeps the call shape
    /// (LinkerContext brackets store mutation with `disable()`/`enable()`)
    /// but the guard itself is a no-op until the thread-local is wired.
    #[inline]
    pub fn disable() {
        // TODO(port): set thread-local `disabled = true` (debug builds only).
    }
    #[inline]
    pub fn enable() {
        // TODO(port): set thread-local `disabled = false` (debug builds only).
    }
}

/// RAII guard that resets the thread-local `Stmt.Data.Store` and
/// `Expr.Data.Store` slabs on scope exit. Replaces the Zig idiom
/// `defer { Stmt.Data.Store.reset(); Expr.Data.Store.reset(); }` so callers
/// don't hand-roll a `scopeguard::guard((), |_| ...)` per PORTING.md.
#[must_use = "store reset runs on drop; bind to a named local"]
pub struct StoreResetGuard(());
impl StoreResetGuard {
    #[inline]
    pub fn new() -> Self {
        Self(())
    }
}
impl Drop for StoreResetGuard {
    #[inline]
    fn drop(&mut self) {
        stmt::data::Store::reset();
        expr::data::Store::reset();
    }
}

// ── flat re-exports (the rest of lib.rs/ast/ expects these at `crate::ast::X`) ──

pub use ast::Ast;
pub use ast_memory_allocator::ASTMemoryAllocator;
pub use b as B;
pub use base::{Index, Ref};
pub use binding::Binding;
pub use char_freq::CharFreq;
pub use e as E;
pub use expr::{Data as ExprData, Expr, Tag as ExprTag};
pub use g as G;
pub use op as Op;
pub use op::Code as OpCode;
pub use s as S;
pub use s::Kind as LocalKind;
pub use scope::Scope;
pub use stmt::{Data as StmtData, Stmt, Tag as StmtTag};
pub use symbol::Symbol;
pub use crate::{
    AssignTarget, BindingNodeList, Case, Catch, ClauseItem, EnumValue, ExportsKind, ExprNodeIndex,
    ExprNodeList, Finally, Flags, InlinedEnumValue, JsonWriter, LocRef, NamedExport, NamedImport,
    NewBatcher, OptionalChain, Part, SlotCounts, StmtNodeIndex, StmtNodeList, StmtOrExpr,
};
pub type BindingNodeIndex = Binding;

// ── round-C re-exports so `js_ast::X` resolves for P.rs ───────────────────
pub use crate::{DeclaredSymbol, DeclaredSymbolList, StrictModeKind, Result as result, Macro};
pub use e::CallUnwrap as CanBeUnwrapped;
pub use expr::PrimitiveType as KnownPrimitive;
pub use g::NamespaceAlias;
pub use ts::{TSNamespaceMember, TSNamespaceMemberMap, TSNamespaceScope};
pub use crate::NAMESPACE_EXPORT_PART_INDEX;
// `Op::BinAssign` etc. — Zig flattens enum members at the type level; in Rust
// they're at `op::Code::*`. Re-export the variants under the `Op` mod alias.
pub use op::Code::*;
// `ArenaStr`/helpers are `pub(crate)`; surface them for the ast/ submodules.
pub(crate) use crate::{empty_arena_slice_mut, empty_arena_str, ArenaStr};

/// `crate::runtime` is gated until round C; `Ast` only needs the `Imports`
/// shape. Provide an opaque stand-in so the field stays present.
pub mod runtime_stub {
    #[derive(Default)]
    pub struct Imports;
}

// `expr::Query` is needed by the lib.rs re-export.
pub use expr::Query;

/// Minimal `TypeScript` namespace surface for the AST type-def files.
/// `ast/TypeScript.rs` (494L) holds `Metadata` plus parser-state predicates that
/// depend on `P`; only the data enum is hoisted here. Full file un-gates with the
/// parser round.
#[allow(non_snake_case)]
// TypeScript module: full file un-gated in round-D (replaces former inline Metadata-only stub).
pub use typescript_full as TypeScript;

// ── round-C: P.rs / Parser.rs (parser state + entry point) ─────────────────
// Real files; declared here so `crate::ast::p::P` / `crate::ast::p::Parser`
// resolve. Heavy parse_*/visit_* method bodies stay -gated inside.
#[path = "P.rs"]
pub mod p;
pub use p::P;
#[path = "Parser.rs"]
pub mod parser_entry;
pub use parser_entry::{Parser, Options as ParserOptions};

// `ast::Result` is the variant the public `Parser::parse` returns
// (defined at crate root in lib.rs, re-exported here for `js_ast::Result`).
pub use crate::Result;

// ── round-D batch 1 ────────────────────────────────────────────────────────
#[path = "ServerComponentBoundary.rs"]
pub mod server_component_boundary;
#[path = "symbols.rs"]
pub mod symbols;
#[path = "foldStringAddition.rs"]
pub mod fold_string_addition;
#[path = "BundledAst.rs"]
pub mod bundled_ast;
#[path = "parseJSXElement.rs"]
pub mod parse_jsx_element;
pub use bundled_ast::BundledAst;
pub use server_component_boundary::ServerComponentBoundary;

// ── round-D batch 2 ────────────────────────────────────────────────────────
#[path = "KnownGlobal.rs"]
pub mod known_global;
#[path = "TypeScript.rs"]
pub mod typescript_full;
pub use typescript_full as typescript;
#[path = "parseImportExport.rs"]
pub mod parse_import_export;
#[path = "parseFn.rs"]
pub mod parse_fn;
#[path = "repl_transforms.rs"]
pub mod repl_transforms;
pub use known_global::KnownGlobal;

// ── round-D batch 3 / E / F (16 files) ─────────────────────────────────────
// Each file is a parse*/visit*/transform method-body mixin on `P`. The Phase-A
// drafts have 30-200 path/shape errors each against the round-A/B/C type
// surface. They are declared here behind `` so:
//   (a) the module tree is complete (`crate::ast::parse_stmt::*` is addressable);
//   (b) the draft bodies are preserved verbatim on disk for the body-un-gate
//       follow-up rounds (each file needs the same mixin→impl-P conversion as
//       D1/D2 applied to parseJSXElement/parseFn/etc.).
//
// TODO(b2-ast-D3..F): un-cfg each module and apply the conversion:
//   1. replace `JSXTransformType` const-generic + `NewParser_` alias with
//      `impl<'a, const TYPESCRIPT: bool, J: JsxT, const SCAN_ONLY: bool> P<'a, ...>`
//   2. `pub fn foo(p: &mut P<...>, ...)` → `pub fn foo(&mut self, ...)`; `let p = self;`
//   3. fix path names: `js_ast::Data` → `js_ast::expr::Data`, `js_ast::SymbolKind` →
//      `js_ast::symbol::Kind`, `crate::Prefill` → `crate::parser::prefill`, etc.
//   4. gate fn bodies that hit deeper blockers (Lexer snapshot, BabyList::len method,
//      E::String rope ops, Scope adapted-API)
#[path = "parseTypescript.rs"] pub mod parse_typescript;
#[path = "ImportScanner.rs"] pub mod import_scanner;
#[path = "ConvertESMExportsForHmr.rs"] pub mod convert_esm_exports_for_hmr;
#[path = "visitBinaryExpression.rs"] pub mod visit_binary_expression;
#[path = "parseProperty.rs"] pub mod parse_property;
#[path = "maybe.rs"] pub mod maybe;
#[path = "SideEffects.rs"] pub mod side_effects;
#[path = "parsePrefix.rs"] pub mod parse_prefix;
#[path = "skipTypescript.rs"] pub mod skip_typescript;
#[path = "parseSuffix.rs"] pub mod parse_suffix;
#[path = "parseStmt.rs"] pub mod parse_stmt;
#[path = "parse.rs"] pub mod parse;
#[path = "visit.rs"] pub mod visit;
#[path = "visitStmt.rs"] pub mod visit_stmt;
#[path = "lowerDecorators.rs"] pub mod lower_decorators;
#[path = "visitExpr.rs"] pub mod visit_expr;

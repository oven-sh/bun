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

use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

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
/// Thin `NonNull<T>` newtype — `Copy`, `Deref`/`DerefMut`. The pointee lives
/// until the owning Store/arena is `reset()`/`destroy()`d; callers must not
/// hold a `StoreRef` across that boundary. This matches Zig's `*T` payloads
/// in `Expr.Data` / `Stmt.Data`.
#[repr(transparent)]
pub struct StoreRef<T>(NonNull<T>);

impl<T> StoreRef<T> {
    #[inline]
    pub const fn from_non_null(p: NonNull<T>) -> Self {
        StoreRef(p)
    }
    /// SAFETY: `p` must be non-null, aligned, and outlive the next Store reset.
    #[inline]
    pub const unsafe fn from_raw(p: *mut T) -> Self {
        // SAFETY: caller contract.
        StoreRef(unsafe { NonNull::new_unchecked(p) })
    }
    /// Wrap a `bumpalo::Bump::alloc` result.
    #[inline]
    pub fn from_bump(r: &mut T) -> Self {
        StoreRef(NonNull::from(r))
    }
    #[inline]
    pub const fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }
    /// Wrap a `&'static T` (compile-time/global singleton — e.g. Prefill
    /// constants). The pointee is never freed, so the StoreRef is valid for
    /// the program lifetime. Mutation through the resulting `StoreRef` is UB;
    /// callers must treat it as read-only.
    #[inline]
    pub const fn from_static(r: &'static T) -> Self {
        // SAFETY: `r` is a non-null aligned `'static` reference.
        StoreRef(unsafe { NonNull::new_unchecked(r as *const T as *mut T) })
    }
    /// Borrow the pointee (explicit form of `Deref`). Mirrors Zig's `.*` deref
    /// in chained-option contexts (`next.map(|r| r.get())`).
    #[inline]
    pub fn get(&self) -> &T {
        // SAFETY: StoreRef invariant — points into a live Store/arena block.
        unsafe { self.0.as_ref() }
    }
}
impl<T> Clone for StoreRef<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for StoreRef<T> {}
impl<T> Deref for StoreRef<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: StoreRef invariant — points into a live Store/arena block.
        unsafe { self.0.as_ref() }
    }
}
impl<T> DerefMut for StoreRef<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: StoreRef invariant. AST nodes are mutated in-place during
        // visiting; Zig held `*T` and freely mutated. No two `StoreRef` to the
        // same node are deref'd `&mut` simultaneously in single-threaded
        // parser/visitor passes — same as the Zig contract.
        unsafe { self.0.as_mut() }
    }
}
impl<T> From<NonNull<T>> for StoreRef<T> {
    #[inline]
    fn from(p: NonNull<T>) -> Self {
        StoreRef(p)
    }
}

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
// resolve. Heavy parse_*/visit_* method bodies stay #[cfg(any())]-gated inside.
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
// surface. They are declared here behind `#[cfg(any())]` so:
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
#[cfg(any())] #[path = "parseTypescript.rs"] pub mod parse_typescript;
#[cfg(any())] #[path = "ImportScanner.rs"] pub mod import_scanner;
#[cfg(any())] #[path = "ConvertESMExportsForHmr.rs"] pub mod convert_esm_exports_for_hmr;
#[cfg(any())] #[path = "visitBinaryExpression.rs"] pub mod visit_binary_expression;
#[cfg(any())] #[path = "parseProperty.rs"] pub mod parse_property;
#[cfg(any())] #[path = "maybe.rs"] pub mod maybe;
#[cfg(any())] #[path = "SideEffects.rs"] pub mod side_effects;
#[cfg(any())] #[path = "parsePrefix.rs"] pub mod parse_prefix;
#[cfg(any())] #[path = "skipTypescript.rs"] pub mod skip_typescript;
#[cfg(any())] #[path = "parseSuffix.rs"] pub mod parse_suffix;
#[cfg(any())] #[path = "parseStmt.rs"] pub mod parse_stmt;
#[cfg(any())] #[path = "parse.rs"] pub mod parse;
#[cfg(any())] #[path = "visit.rs"] pub mod visit;
#[cfg(any())] #[path = "visitStmt.rs"] pub mod visit_stmt;
#[cfg(any())] #[path = "lowerDecorators.rs"] pub mod lower_decorators;
#[cfg(any())] #[path = "visitExpr.rs"] pub mod visit_expr;

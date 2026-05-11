//! `js_parser/ast/` — AST type definitions.
//!
//! B-2 round B: node enums (E/Expr/S/Stmt/Ast) + Store. Round A's stub
//! `e/s/expr/stmt/ast` modules are replaced with the real Phase-A drafts.
//!
//! Arena convention: Phase A keeps node types lifetime-free. Slice fields are
//! `StoreSlice<T>` / `StoreStr`; pointer payloads are `StoreRef<T>` (a thin
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
pub use crate::{StoreSlice, StoreStr};

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
    /// RAII scope: `disable()` now, `enable()` on drop. Replaces the Zig idiom
    /// `Disabler.disable(); defer Disabler.enable();` so callers don't
    /// hand-roll a unit-state `scopeguard` defer (banned per PORTING.md).
    #[inline]
    pub fn scope() -> DebugOnlyDisablerScope<T> {
        Self::disable();
        DebugOnlyDisablerScope(core::marker::PhantomData)
    }
}

/// Guard returned by [`DebugOnlyDisabler::scope`]; re-enables on drop.
#[must_use = "disabler is re-enabled on drop; bind to a named local"]
pub struct DebugOnlyDisablerScope<T>(core::marker::PhantomData<T>);
impl<T> Drop for DebugOnlyDisablerScope<T> {
    #[inline]
    fn drop(&mut self) {
        DebugOnlyDisabler::<T>::enable();
    }
}

/// Per-thread side `MimallocArena` that backs `AstAlloc` while the bundler's
/// `Stmt.Data.Store` / `Expr.Data.Store` block-store is active and **no**
/// `ASTMemoryAllocator` scope is in effect.
///
/// The runtime-transpiler path already routes `AstAlloc` into
/// `ASTMemoryAllocator.arena` (see `ASTMemoryAllocator::push` /
/// `Scope::enter`). The bundler does *not* use `ASTMemoryAllocator` — AST
/// nodes go into the thread-local `NewStore` block list — so prior to this
/// module `AST_HEAP` was null on that path and every embedded
/// `Vec<_, AstAlloc>` (e.g. `G::PropertyList` inside an `E::Object`) fell
/// back to global mimalloc. `NewStore::reset()` does not run `Drop` on stored
/// nodes (it just rewinds each block's bump pointer), so those global-heap
/// `Vec` buffers leaked one-AST-per-bundled-file (bun-build-api LSan: ~40 MB
/// of `Vec<Property>` across 8 builds).
///
/// This side arena gives `AstAlloc` an `mi_heap` whose lifetime is exactly
/// `NewStore`'s: created in `Store::create`, `mi_heap_destroy`+rebuilt in
/// `Store::reset`/`begin`, torn down in `Store::deinit`. The buffers are then
/// bulk-freed alongside the AST nodes, with no per-element `Drop` — the same
/// invariant `Expr::Data::clone_in`'s `ptr::read` relies on.
///
/// **Not** wired into `Stmt::data::Store` itself: that is also called from
/// `bun install` / `--define` JSON parsing, which (unlike the bundler) holds
/// `StoreRef`s across `Store::reset()` — a pre-existing UAF that was masked
/// by `Backing::reset` only resetting the bump pointer (block bytes survive
/// until overwritten) and the embedded `Vec<Property>` buffers leaking on the
/// global heap. With the side-arena, those buffers would be `mi_heap_destroy`d
/// on the next reset → real UAF. Callers that want this scoping use
/// [`StoreAstAllocHeap`] explicitly (transpiler / linker post-process).
pub mod store_ast_alloc_heap {
    use core::cell::Cell;
    use core::ptr;

    use bun_alloc::MimallocArena;

    thread_local! {
        /// `Box<MimallocArena>` leaked to a raw pointer so the arena's
        /// address (and therefore its `heap_ptr()`) is stable across the
        /// thread's lifetime. Null until `enter()` runs once on this thread.
        static ARENA: Cell<*mut MimallocArena> = const { Cell::new(ptr::null_mut()) };
    }

    /// Idempotently create the side arena and point `AST_HEAP` at it.
    ///
    /// Called from `Stmt::data::Store::create` after the block-store
    /// `INSTANCE` is set. The caller's existing `memory_allocator().is_null()`
    /// early-return guarantees no `ASTMemoryAllocator` scope is active, so we
    /// own `AST_HEAP` here; `ASTMemoryAllocator::{push, Scope::enter}` save
    /// the current heap before overwriting and restore it on pop/exit, so a
    /// later nested ASTMemoryAllocator scope round-trips back to this heap.
    pub fn enter() {
        // A/B kill-switch for measuring the fix; remove after CI confirms.
        if std::env::var_os("BUN_DISABLE_STORE_AST_HEAP").is_some() {
            return;
        }
        let arena = ARENA.with(|c| {
            let p = c.get();
            if !p.is_null() {
                return p;
            }
            // Stable heap address for the thread's lifetime; freed in `exit()`.
            let p = Box::into_raw(Box::new(MimallocArena::new()));
            c.set(p);
            p
        });
        // SAFETY: `arena` is a live `Box::into_raw` allocation owned by this
        // thread; only `exit()` (on this thread) frees it.
        bun_alloc::ast_alloc::set_thread_heap(unsafe { (*arena).heap_ptr() });
    }

    /// Destroy + rebuild the side arena's heap and re-publish the new
    /// `heap_ptr()` to `AST_HEAP`.
    ///
    /// Called from `Stmt::data::Store::reset` / the reset arm of `begin`
    /// after `Backing::reset`. Those callers already early-return when
    /// `disable_reset` is set or an `ASTMemoryAllocator` is active, so the
    /// heap-destroy here has the same lifetime as the block-store reset and
    /// `AST_HEAP` is ours to write.
    pub fn reset() {
        let arena = ARENA.with(|c| c.get());
        if arena.is_null() {
            // `reset()` reached before `create()` — caller contract violation
            // in the block-store API, but be defensive: just create.
            enter();
            return;
        }
        // SAFETY: `arena` is the live `Box::into_raw` allocation from
        // `enter()`; this thread is its only mutator. `MimallocArena::reset`
        // does `mi_heap_destroy` + `mi_heap_new`, so re-publish the new heap.
        unsafe {
            (*arena).reset();
            bun_alloc::ast_alloc::set_thread_heap((*arena).heap_ptr());
        }
    }

    /// Current `mi_heap_t*` of this thread's side arena, or null if `enter()`
    /// has not run on this thread. Used by `ASTMemoryAllocator::Scope::exit`
    /// when returning into the raw block-store: it cannot trust its
    /// `previous_heap` snapshot (a `Store::begin()` reset inside the scope may
    /// have rebuilt the heap), so it re-reads the live pointer here.
    #[inline]
    pub fn current_heap() -> *mut bun_alloc::mimalloc::Heap {
        let arena = ARENA.with(|c| c.get());
        if arena.is_null() {
            return ptr::null_mut();
        }
        // SAFETY: `arena` is the live `Box::into_raw` allocation from
        // `enter()`; this thread is its only mutator and `heap_ptr()` is a
        // read-only accessor.
        unsafe { (*arena).heap_ptr() }
    }

    /// Clear `AST_HEAP` and drop the side arena.
    ///
    /// Called from `Stmt::data::Store::deinit` after the block-store
    /// `INSTANCE` is destroyed.
    pub fn exit() {
        let arena = ARENA.with(|c| c.replace(ptr::null_mut()));
        // `deinit()`'s caller has already early-returned if an
        // `ASTMemoryAllocator` is active, so `AST_HEAP` is ours to clear.
        bun_alloc::ast_alloc::set_thread_heap(ptr::null_mut());
        if !arena.is_null() {
            // SAFETY: `arena` was `Box::into_raw`'d in `enter()` on this
            // thread and is now being reclaimed exactly once.
            drop(unsafe { Box::from_raw(arena) });
        }
    }
}

/// RAII scope for [`store_ast_alloc_heap`]: `enter()` on construction,
/// `reset()` via [`Self::reset`], `exit()` on drop. Hold one for the lifetime
/// of a bundler/transpiler thread's block-store to route `AstAlloc` buffers
/// into the side arena. **Do not** use from `bun install` / `--define` JSON
/// parsing — see the [`store_ast_alloc_heap`] module doc for the UAF that
/// surfaces there.
#[must_use = "side-arena heap lives until this guard drops"]
pub struct StoreAstAllocHeap(());
impl StoreAstAllocHeap {
    #[inline]
    pub fn new() -> Self {
        store_ast_alloc_heap::enter();
        Self(())
    }
    /// Reset the side arena (bulk-free `AstVec` buffers) alongside a
    /// `Stmt/Expr::data::Store::reset()` pair.
    #[inline]
    pub fn reset(&self) {
        store_ast_alloc_heap::reset();
    }
}
impl Drop for StoreAstAllocHeap {
    #[inline]
    fn drop(&mut self) {
        store_ast_alloc_heap::exit();
    }
}

/// RAII guard that resets the thread-local `Stmt.Data.Store` and
/// `Expr.Data.Store` slabs on scope exit. Replaces the Zig idiom
/// `defer { Stmt.Data.Store.reset(); Expr.Data.Store.reset(); }` so callers
/// don't hand-roll a unit-state `scopeguard` defer (banned per PORTING.md).
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

/// RAII guard that pins the thread-local `disable_reset` flag on both AST
/// `Store`s for its scope. Replaces the Zig idiom (Macro.zig)
/// `Expr.Data.Store.disable_reset = true; defer Expr.Data.Store.disable_reset = false;`
/// (and the paired `Stmt` toggle) so callers don't hand-roll a `scopeguard`
/// per PORTING.md.
#[must_use = "disable_reset is cleared on drop; bind to a named local"]
pub struct DisableStoreReset(());
impl DisableStoreReset {
    #[inline]
    pub fn new() -> Self {
        expr::data::Store::set_disable_reset(true);
        stmt::data::Store::set_disable_reset(true);
        Self(())
    }
}
impl Drop for DisableStoreReset {
    #[inline]
    fn drop(&mut self) {
        expr::data::Store::set_disable_reset(false);
        stmt::data::Store::set_disable_reset(false);
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
pub(crate) use crate::{empty_arena_str, ArenaStr};

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
//   4. gate fn bodies that hit deeper blockers (Lexer snapshot, Vec::len method,
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

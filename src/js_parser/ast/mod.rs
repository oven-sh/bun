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
pub mod TypeScript {
    use super::base::Ref;

    #[derive(Clone, Default)]
    pub enum Metadata {
        #[default]
        MNone,
        MNever,
        MUnknown,
        MAny,
        MVoid,
        MNull,
        MUndefined,
        MFunction,
        MArray,
        MBoolean,
        MString,
        MObject,
        MNumber,
        MBigint,
        MSymbol,
        MPromise,
        MIdentifier(Ref),
        // TODO(port): arena-backed `bumpalo::collections::Vec<'bump, Ref>` in Phase B.
        MDot(Vec<Ref>),
    }
}

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

// ── STUB (round-D+ targets) ────────────────────────────────────────────────

pub mod bundled_ast {
    #[derive(Default)]
    pub struct BundledAst;
}
pub mod server_component_boundary {
    use bun_collections::MultiArrayList;
    #[derive(Default)]
    pub struct ServerComponentBoundary;
    /// Zig: `ServerComponentBoundary.List = struct { list: MultiArrayList(SCB), map: Map }`
    /// where `Map = std.ArrayHashMapUnmanaged(void, void, …)`.
    #[derive(Default)]
    pub struct List {
        pub list: MultiArrayList<ServerComponentBoundary>,
        // TODO(b1): `map: ArrayHashMap<(), ()>` — bun_collections::ArrayHashMap currently
        // requires `K: Hash + Eq`; revisit once the void-key adapter pattern is ported.
    }
}

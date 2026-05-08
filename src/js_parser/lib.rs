//! Port of `src/js_parser/js_parser.zig`.
//!
//! NOTE on arena slices: this is the AST crate. Nearly every `[]const u8` /
//! `[]T` struct field in the Zig points into either the source text or the
//! parser arena and is bulk-freed at end-of-parse. Per PORTING.md, Phase A
//! does **not** add lifetime params to structs; arena-owned slices are typed
//! as `StoreSlice<T>` / `StoreStr` here. Phase B threads a crate-wide
//! `'bump` and rewrites these to `&'bump [T]` / `&'bump mut [T]`.

// `lexer::NewLexer<J: JsonOptionsT>` projects trait associated consts into
// eight `const bool` slots (Zig: `NewLexer(comptime json_options)`). Field
// access on a `const J: JSONOptions` param is rejected by nightly-2025-12-10
// ("overly complex generic constant"); assoc-const projection on a *type*
// param works under `generic_const_exprs`. `adt_const_params` keeps
// `JSONOptions: ConstParamTy` for value-level reification.
#![feature(adt_const_params, generic_const_exprs, allocator_api)]
#![allow(incomplete_features)]

use core::fmt;

use bun_collections::{ArrayHashMap, MultiArrayList, StringHashMap};
pub use bun_collections::VecExt as _VecExtReexport;
use bun_core::Output;
use bun_logger as logger;

// ─── re-exports (see bottom-of-file `@import` block in the .zig) ────────────
// Zig file-structs `@import("./ast/Foo.zig")` become `pub use` of the module's
// primary type. Module path segments are snake_cased per PORTING.md.
// TODO(port): verify module names once ast/*.rs land in Phase B.
//
// B-2 round A: `ast/mod.rs` now declares real type-def modules incrementally;
// remaining un-gated files keep inline stubs there. `parser.rs` stays gated
// until ast types + P.rs land.
pub mod ast;
#[path = "parser.rs"]
pub mod parser;
// Re-export parser-helper types at crate root so P.rs can `use crate::{...}`.
pub use parser::*;

// ── round-C stubs for gated modules P.rs/Parser.rs reference ────────────
pub mod repl_transforms {
    pub type ReplPrelude = ();
}
/// Zig: `Part.SymbolUseMap` / `Part.SymbolPropertyUseMap` — module-style alias
/// so `crate::part::{SymbolUseMap, SymbolPropertyUseMap}` resolves.
pub mod part {
    pub use crate::{PartSymbolPropertyUseMap as SymbolPropertyUseMap, PartSymbolUseMap as SymbolUseMap};
}
// `generated_symbol_name!` is `#[macro_export]` in parser.rs → already at crate root.
#[path = "lexer.rs"]
pub mod lexer;
// `bun_js_parser::js_lexer` is re-exported via `pub use parser::*` (parser.rs:140).
#[path = "lexer_tables.rs"]
pub mod lexer_tables;
// TODO(b2-blocked): bun_collections::StringSet
// TODO(b2-blocked): bun_core::Output::debug
// TODO(b2-blocked): bun_core::runtime_embed_file
// TODO(b2-blocked): bun_core::EmbedKind
// TODO(b2-blocked): bun_options_types::schema::api (or bun_schema crate)

#[path = "runtime.rs"]
pub mod runtime_full;
/// `runtime.rs` is gated until its `bun_core`/`bun_options` deps land. Surface
/// the stub `Runtime` namespace (defined in `parser.rs`) at the path downstream
/// crates expect (`bun_js_parser::runtime::Runtime::Imports` / `::Features`).
pub mod runtime {
    pub use crate::Runtime;
    pub use crate::Runtime::{Features, Imports, Names, ReplaceableExport, ServerComponentsMode};
}

pub use crate::ast::ast_memory_allocator::ASTMemoryAllocator;
pub use crate::ast::ast::Ast;
pub use crate::ast::binding::Binding;
pub type BindingNodeIndex = Binding;
pub use crate::ast::bundled_ast::BundledAst;
pub use crate::ast::e as E;
pub use crate::ast::expr::Expr;
pub use crate::ast::expr::Data as ExprData;
pub use crate::ast::expr::Query as ExprQuery;
pub type ExprNodeIndex = Expr;
pub use crate::ast::g as G;
// `pub const Macro = @import("../js_parser_jsc/Macro.zig");`
// Full impl lives in *_jsc; this stub re-exposes the JSC-free constants and a
// placeholder `MacroContext` so lower-tier crates (bundler, transpiler) that
// only need the namespace strings / a context handle stay unblocked.
#[allow(non_snake_case)]
pub mod Macro {
    /// Zig: `pub const namespace: string = "macro";`
    pub const NAMESPACE: &[u8] = b"macro";
    /// Zig: `pub const namespaceWithColon: string = namespace ++ ":";`
    pub const NAMESPACE_WITH_COLON: &[u8] = b"macro:";

    #[inline]
    pub fn is_macro_path(str_: &[u8]) -> bool {
        str_.starts_with(NAMESPACE_WITH_COLON)
    }

    /// Spec `bundler_jsc/PluginRunner.zig:MacroJSCtx` (= `JSC.JSValue`).
    ///
    /// `JSValue` is `#[repr(transparent)] i64` (PORTING.md §JSC types). This
    /// newtype carries the encoded bits at the lowest tier that needs them so
    /// `Transpiler::ParseOptions.macro_js_ctx` and `MacroContext.javascript_object`
    /// share one canonical type without `bun_js_parser` / `bun_bundler` taking a
    /// `bun_jsc` dep. Higher tiers convert with `JSValue(ctx.0)` / `MacroJSCtx(v.0)`.
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub struct MacroJSCtx(pub i64);
    impl MacroJSCtx {
        /// Spec `default_macro_js_value` = `JSValue.zero`.
        pub const ZERO: Self = MacroJSCtx(0);
    }
    impl Default for MacroJSCtx {
        #[inline]
        fn default() -> Self {
            Self::ZERO
        }
    }

    /// Lower-tier handle for `js_parser_jsc::Macro::MacroContext`.
    ///
    /// Real fields (`env`, `macros`, `remap`, `resolver`, `bump`) reference
    /// `Transpiler` and JSC types that live in crates which depend on
    /// `bun_js_parser`. To break the dep cycle the higher-tier `_jsc` crate
    /// owns that state behind `data`; the visit pass reaches it via
    /// link-time-resolved `extern "Rust"` fns so `visitExpr.rs` stays a
    /// faithful port of `visitExpr.zig:415` / `:1443` without an upward
    /// import. `javascript_object` is surfaced here so `Transpiler::parse` can
    /// thread `this_parse.macro_js_ctx` through (spec transpiler.zig:938-940)
    /// without this crate depending on `bun_jsc::JSValue`.
    pub struct MacroContext {
        /// Encoded `JSC.JSValue` (the caller-supplied macro JS context).
        /// `bun_js_parser_jsc` reinterprets the bits as a `JSValue`.
        pub javascript_object: MacroJSCtx,
        /// Opaque pointer to the higher-tier macro-runner state
        /// (resolver/env/macros/remap/bump). Allocated by `init` and leaked
        /// (matches Zig's process-lifetime `default_allocator`);
        /// `bun_js_parser` never dereferences it.
        pub data: *mut core::ffi::c_void,
    }
    impl Default for MacroContext {
        #[inline]
        fn default() -> Self {
            Self { javascript_object: MacroJSCtx::ZERO, data: core::ptr::null_mut() }
        }
    }
    unsafe extern "Rust" {
        /// Defined `#[no_mangle]` in `bun_js_parser_jsc::Macro`. `transpiler`
        /// is `*mut bun_bundler::Transpiler<'_>` — erased because this crate
        /// cannot name it (dep-cycle).
        fn __bun_macro_context_init(transpiler: *mut core::ffi::c_void) -> MacroContext;
        fn __bun_macro_context_call(
            ctx: &mut MacroContext,
            import_record_path: &[u8],
            source_dir: &[u8],
            log: &mut bun_logger::Log,
            source: &bun_logger::Source,
            import_range: bun_logger::Range,
            caller: crate::Expr,
            function_name: &[u8],
        ) -> Result<crate::Expr, bun_core::Error>;
        fn __bun_macro_context_get_remap(
            data: *mut core::ffi::c_void,
            path: &[u8],
        ) -> Option<&'static MacroRemapEntry>;
    }
    impl MacroContext {
        /// Zig: `pub fn call(self: *MacroContext, import_record_path, source_dir,
        /// log, source, import_range, caller, function_name) !Expr`.
        #[inline]
        pub fn call(
            &mut self,
            import_record_path: &[u8],
            source_dir: &[u8],
            log: &mut bun_logger::Log,
            source: &bun_logger::Source,
            import_range: bun_logger::Range,
            caller: crate::Expr,
            function_name: &[u8],
        ) -> Result<crate::Expr, bun_core::Error> {
            // SAFETY: link-time-resolved Rust-ABI fn.
            unsafe {
                __bun_macro_context_call(
                    self,
                    import_record_path,
                    source_dir,
                    log,
                    source,
                    import_range,
                    caller,
                    function_name,
                )
            }
        }
        /// Zig: `pub fn init(transpiler: *Transpiler) MacroContext`.
        ///
        /// `T` is always `bun_bundler::Transpiler<'_>`; generic so callers in
        /// `bun_bundler`/`bun_runtime` compile without `bun_js_parser` taking
        /// an upward dep on the bundler. The `_jsc` crate reads the concrete
        /// type back inside `__bun_macro_context_init`.
        #[inline]
        pub fn init<T>(transpiler: &mut T) -> Self {
            // SAFETY: link-time-resolved Rust-ABI fn; pointer is valid for the
            // duration of the call.
            unsafe { __bun_macro_context_init(transpiler as *mut T as *mut core::ffi::c_void) }
        }
        /// Zig: `pub fn getRemap(self: *MacroContext, path: []const u8) ?MacroRemapEntry`.
        /// Returns `'static` so callers can keep the result across `&mut self`
        /// parser calls without a borrowck conflict; the table lives in
        /// `Transpiler.options` which outlives every parse.
        #[inline]
        pub fn get_remap(&self, path: &[u8]) -> Option<&'static MacroRemapEntry> {
            if self.data.is_null() {
                return None;
            }
            // SAFETY: link-time-resolved Rust-ABI fn; `data` is non-null.
            unsafe { __bun_macro_context_get_remap(self.data, path) }
        }
    }

    /// Zig: `MacroImportReplacementMap` — `bun.StringArrayHashMap([]const u8)`.
    /// Values are owned (`Box<[u8]>`) so callers can populate without `unsafe`
    /// lifetime-extension casts; matches `bun_resolver::package_json::MacroImportReplacementMap`.
    pub type MacroRemapEntry = bun_collections::StringArrayHashMap<Box<[u8]>>;
}
pub use crate::ast::op as Op;
pub use crate::ast::s as S;
pub use crate::ast::scope::Scope;
pub use crate::ast::server_component_boundary::ServerComponentBoundary;
pub use crate::ast::stmt::Stmt;
pub use crate::ast::stmt::Data as StmtData;
pub type StmtNodeIndex = Stmt;
pub use crate::ast::symbol::Symbol;
pub use crate::ast::b::B;
// `NewStore` is a Zig comptime type-generator; in Rust it's the
// `crate::new_store!` macro (see ast/NewStore.rs). No type to re-export.
pub use crate::ast::use_directive::UseDirective;

pub use crate::ast::char_freq as CharFreq;
use crate::ast::char_freq::CHAR_FREQ_COUNT;

pub use crate::ast::ts as TS;
pub use crate::ast::ts::{TSNamespaceMember, TSNamespaceMemberMap, TSNamespaceScope};

pub use crate::ast::base::{Index, Ref, RefCtx, RefFields, RefHashCtx, RefTag};


use crate::ast::symbol; // for symbol::Use, symbol::SlotNamespace

// ─── arena-slice helpers ────────────────────────────────────────────────────
// Legacy alias: AST string fields now uniformly use `StoreStr` (safe `Deref`
// wrapper around an arena `[u8]`). Kept as a type alias so existing field
// declarations / call sites that spell `ArenaStr` continue to compile.
pub(crate) type ArenaStr = StoreStr;
#[inline]
pub(crate) const fn empty_arena_str() -> ArenaStr {
    StoreStr::EMPTY
}
// (former `empty_arena_slice_mut<T>()` removed — use `StoreSlice::<T>::EMPTY`.)

// ─── StoreStr — arena-owned string slice (StoreRef's [u8] sibling) ──────────
//
// AST string fields (`E::Dot.name`, `E::String.data`, …) borrow from the parse
// arena and are bulk-freed at `Store::reset()`. `StoreStr` mirrors
// `StoreRef<T>` (raw `NonNull<T>`) and `StmtNodeList` (`StoreSlice<Stmt>`): a
// thin lifetime-erased pointer with safe construction and `Deref<Target=[u8]>`
// under the same callers-must-not-outlive-the-arena contract that `StoreRef`
// already imposes. Avoids cascading `<'arena>` through `Expr`/`Stmt`/`Data`
// (~100 types, 12 downstream crates) — that cascade is the follow-up round
// once `StoreRef` itself carries `'arena`.
#[derive(Copy, Clone)]
#[repr(C)]
pub struct StoreStr {
    ptr: core::ptr::NonNull<u8>,
    len: usize,
}

// SAFETY: same rationale as `StoreRef` — points into a single-threaded bump
// arena (Zig `[]const u8`). Asserted Send/Sync so payload types can sit in
// `static` Prefill tables; callers must not actually share a Store across
// threads (unchanged contract).
unsafe impl Send for StoreStr {}
unsafe impl Sync for StoreStr {}

impl StoreStr {
    pub const EMPTY: StoreStr =
        StoreStr { ptr: core::ptr::NonNull::<u8>::dangling(), len: 0 };

    /// Wrap an arena-owned (or `'static`) slice. Safe: no lifetime is forged;
    /// the pointer is stored raw and re-borrowed under the `StoreRef` contract
    /// (valid until the owning arena resets).
    #[inline]
    pub const fn new(s: &[u8]) -> Self {
        match core::ptr::NonNull::new(s.as_ptr().cast_mut()) {
            Some(ptr) => StoreStr { ptr, len: s.len() },
            // Only the (ptr=null, len=0) empty-slice edge needs this; Rust
            // `&[u8]` never has a null ptr, but be defensive for const-eval.
            None => StoreStr::EMPTY,
        }
    }

    #[inline]
    pub const fn as_ptr(self) -> *const u8 {
        self.ptr.as_ptr()
    }

    #[inline]
    pub const fn raw_len(self) -> usize {
        self.len
    }

    /// Re-borrow as `&[u8]`. Same safety contract as `StoreRef::get`: the
    /// pointee lives until arena reset, which the caller must not cross.
    /// Takes `self` by value (it's `Copy`) so the returned borrow is not tied
    /// to a stack temporary — mirrors `StoreRef::Deref`'s arena contract.
    #[inline]
    pub fn slice<'a>(self) -> &'a [u8] {
        // SAFETY: StoreStr invariant — `ptr` is non-null, points at `len`
        // initialized bytes valid for the arena lifetime (or `'static`); caller
        // must not outlive the owning arena (same as `StoreRef`).
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len) }
    }

    #[inline]
    pub fn as_raw(self) -> *const [u8] {
        core::ptr::slice_from_raw_parts(self.ptr.as_ptr(), self.len)
    }

    /// Reconstruct from a raw fat pointer (inverse of `as_raw`). Exists only
    /// for the handful of callers that still hold a `*const [u8]`
    /// (e.g. `js_printer::renamer::NameStr`) during the StoreSlice migration.
    ///
    /// # Safety
    /// `p` must satisfy the `StoreStr` invariant: either null (yielding
    /// `EMPTY`) or pointing at `p.len()` initialized bytes valid for the
    /// owning arena's lifetime. The result auto-`Deref`s, so a garbage fat
    /// pointer here is immediate UB at the first read.
    #[inline]
    pub unsafe fn from_raw(p: *const [u8]) -> Self {
        match core::ptr::NonNull::new(p.cast_mut()) {
            Some(nn) => StoreStr { ptr: nn.cast::<u8>(), len: p.len() },
            None => StoreStr::EMPTY,
        }
    }
}

impl Default for StoreStr {
    #[inline]
    fn default() -> Self {
        StoreStr::EMPTY
    }
}

impl core::ops::Deref for StoreStr {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        self.slice()
    }
}

impl AsRef<[u8]> for StoreStr {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.slice()
    }
}
impl core::borrow::Borrow<[u8]> for StoreStr {
    #[inline]
    fn borrow(&self) -> &[u8] {
        self.slice()
    }
}

impl<const N: usize> From<&[u8; N]> for StoreStr {
    #[inline]
    fn from(s: &[u8; N]) -> Self {
        StoreStr::new(s)
    }
}
impl From<&[u8]> for StoreStr {
    #[inline]
    fn from(s: &[u8]) -> Self {
        StoreStr::new(s)
    }
}
impl From<&str> for StoreStr {
    #[inline]
    fn from(s: &str) -> Self {
        StoreStr::new(s.as_bytes())
    }
}

impl PartialEq for StoreStr {
    #[inline]
    fn eq(&self, other: &StoreStr) -> bool {
        self.slice() == other.slice()
    }
}
impl Eq for StoreStr {}
impl PartialEq<[u8]> for StoreStr {
    #[inline]
    fn eq(&self, other: &[u8]) -> bool {
        self.slice() == other
    }
}
impl<const N: usize> PartialEq<&[u8; N]> for StoreStr {
    #[inline]
    fn eq(&self, other: &&[u8; N]) -> bool {
        self.slice() == *other
    }
}
impl<const N: usize> PartialEq<[u8; N]> for StoreStr {
    #[inline]
    fn eq(&self, other: &[u8; N]) -> bool {
        self.slice() == other
    }
}
impl PartialEq<&[u8]> for StoreStr {
    #[inline]
    fn eq(&self, other: &&[u8]) -> bool {
        self.slice() == *other
    }
}
impl core::hash::Hash for StoreStr {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, h: &mut H) {
        self.slice().hash(h)
    }
}
impl core::fmt::Debug for StoreStr {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        bstr::BStr::new(self.slice()).fmt(f)
    }
}

// ─── StoreSlice<T> — arena-owned typed slice (StoreStr's generic sibling) ───
//
// Generalizes `StoreStr` to `[T]` for AST list fields (`E::Arrow.args`,
// per-node `[Stmt]`/`[Expr]` views, …) that borrow from the parse arena.
// Same contract as `StoreRef`/`StoreStr`: safe `::new`,
// raw `NonNull<T>` + `u32` length, `Deref<Target=[T]>`, valid until the
// owning arena resets. The `u32` length matches Zig's `[]T` (`u32` len under
// `-Dwasm32` and the AST's practical bounds) and keeps the field at 12 bytes
// on 64-bit instead of 16 — relevant for hot AST nodes.
#[repr(C)]
pub struct StoreSlice<T> {
    ptr: core::ptr::NonNull<T>,
    len: u32,
}

// Manual Copy/Clone: derive would add a spurious `T: Copy` bound.
impl<T> Copy for StoreSlice<T> {}
impl<T> Clone for StoreSlice<T> {
    #[inline]
    fn clone(&self) -> Self { *self }
}

// SAFETY: same rationale as `StoreStr` — points into a single-threaded bump
// arena. Asserted Send/Sync so payload types can sit in `static` Prefill
// tables; callers must not actually share a Store across threads.
unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}

impl<T> StoreSlice<T> {
    pub const EMPTY: StoreSlice<T> =
        StoreSlice { ptr: core::ptr::NonNull::<T>::dangling(), len: 0 };

    /// Wrap an arena-owned (or `'static`) slice. Safe: no lifetime is forged;
    /// the pointer is stored raw and re-borrowed under the `StoreRef` contract
    /// (valid until the owning arena resets).
    #[inline]
    pub const fn new(s: &[T]) -> Self {
        debug_assert!(s.len() <= u32::MAX as usize);
        match core::ptr::NonNull::new(s.as_ptr().cast_mut()) {
            Some(ptr) => StoreSlice { ptr, len: s.len() as u32 },
            None => StoreSlice::EMPTY,
        }
    }

    /// Wrap an arena-owned mutable slice (e.g. `bump.alloc_slice_*`). Same
    /// contract as `new`; provided so callers don't need a `&mut → &` reborrow
    /// at every site.
    #[inline]
    pub fn new_mut(s: &mut [T]) -> Self {
        debug_assert!(s.len() <= u32::MAX as usize);
        match core::ptr::NonNull::new(s.as_mut_ptr()) {
            Some(ptr) => StoreSlice { ptr, len: s.len() as u32 },
            None => StoreSlice::EMPTY,
        }
    }

    #[inline]
    pub const fn as_ptr(self) -> *const T {
        self.ptr.as_ptr()
    }

    #[inline]
    pub const fn raw_len(self) -> u32 {
        self.len
    }

    /// Re-borrow as `&[T]`. Same safety contract as `StoreStr::slice` /
    /// `StoreRef::get`: the pointee lives until arena reset, which the caller
    /// must not cross. Takes `self` by value (Copy) so the returned borrow is
    /// not tied to a stack temporary.
    #[inline]
    pub fn slice<'a>(self) -> &'a [T] {
        // SAFETY: StoreSlice invariant — `ptr` is non-null, points at `len`
        // initialized `T` valid for the arena lifetime (or `'static`); caller
        // must not outlive the owning arena (same as `StoreRef`).
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }

    /// Re-borrow as `&mut [T]`. Unsafe: caller must guarantee no aliasing
    /// `&`/`&mut` is outstanding for this slice (the arena hands out unique
    /// allocations, but `StoreSlice` is `Copy`, so this cannot be checked).
    /// Mirrors the pre-existing `from_raw_parts_mut` pattern at visit sites.
    #[inline]
    pub unsafe fn slice_mut<'a>(self) -> &'a mut [T] {
        unsafe { core::slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len as usize) }
    }

    /// Shorten the slice in place. Panics if `new_len > len` (mirrors Zig
    /// `slice[0..new_len]` bounds check). The arena still owns the trailing
    /// elements; they are simply no longer reachable through this view.
    #[inline]
    pub fn truncate(&mut self, new_len: usize) {
        assert!(new_len <= self.len as usize);
        self.len = new_len as u32;
    }

    /// Construct from a `BumpVec`/`ArenaVec` by leaking it into the bump arena
    /// (Zig: `list.items` after `toOwnedSlice`). Convenience for the common
    /// `StoreSlice::new_mut(v.into_bump_slice_mut())` pattern.
    #[inline]
    pub fn from_bump<'b>(v: bun_alloc::ArenaVec<'b, T>) -> Self {
        use bun_alloc::ArenaVecExt as _;
        StoreSlice::new_mut(v.into_bump_slice_mut())
    }
}

impl<'a, T> From<bun_alloc::ArenaVec<'a, T>> for StoreSlice<T> {
    #[inline]
    fn from(v: bun_alloc::ArenaVec<'a, T>) -> Self { StoreSlice::from_bump(v) }
}

impl<T> Default for StoreSlice<T> {
    #[inline]
    fn default() -> Self {
        StoreSlice::EMPTY
    }
}

impl<T> core::ops::Deref for StoreSlice<T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        self.slice()
    }
}

impl<T> AsRef<[T]> for StoreSlice<T> {
    #[inline]
    fn as_ref(&self) -> &[T] {
        self.slice()
    }
}

impl<T> From<&[T]> for StoreSlice<T> {
    #[inline]
    fn from(s: &[T]) -> Self {
        StoreSlice::new(s)
    }
}
impl<T> From<&mut [T]> for StoreSlice<T> {
    #[inline]
    fn from(s: &mut [T]) -> Self {
        StoreSlice::new_mut(s)
    }
}

impl<T: core::fmt::Debug> core::fmt::Debug for StoreSlice<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.slice().fmt(f)
    }
}

// ─────────────────────────────────────────────────────────────────────────────

/// This is the index to the automatically-generated part containing code that
/// calls "__export(exports, { ... getters ... })". This is used to generate
/// getters on an exports object for ES6 export statements, and is both for
/// ES6 star imports and CommonJS-style modules. All files have one of these,
/// although it may contain no statements if there is nothing to export.
pub const NAMESPACE_EXPORT_PART_INDEX: u32 = 0;

// There are three types.
// 1. Expr (expression)
// 2. Stmt (statement)
// 3. Binding
// Q: "What's the difference between an expression and a statement?"
// A:  > Expression: Something which evaluates to a value. Example: 1+2/x
//     > Statement: A line of code which does something. Example: GOTO 100
//     > https://stackoverflow.com/questions/19132/expression-versus-statement/19224#19224

// Expr, Binding, and Stmt each wrap a Data:
// Data is where the actual data where the node lives.
// There are four possible versions of this structure:
// [ ] 1.  *Expr, *Stmt, *Binding
// [ ] 1a. *Expr, *Stmt, *Binding something something dynamic dispatch
// [ ] 2.  *Data
// [x] 3.  Data.(*) (The union value in Data is a pointer)
// I chose #3 mostly for code simplification -- sometimes, the data is modified in-place.
// But also it uses the least memory.
// Since Data is a union, the size in bytes of Data is the max of all types
// So with #1 or #2, if S.Function consumes 768 bits, that means Data must be >= 768 bits
// Which means "true" in code now takes up over 768 bits, probably more than what v8 spends
// Instead, this approach means Data is the size of a pointer.
// It's not really clear which approach is best without benchmarking it.
// The downside with this approach is potentially worse memory locality, since the data for the node is somewhere else.
// But it could also be better memory locality due to smaller in-memory size (more likely to hit the cache)
// only benchmarks will provide an answer!
// But we must have pointers somewhere in here because can't have types that contain themselves

/// Slice that stores capacity and length in the same space as a regular slice.
pub type ExprNodeList = Vec<Expr>;

// Arena-owned `[Stmt]` / `[Binding]` views — see `StoreSlice<T>` doc above.
// A `PhantomData<&'arena ()>` can be added to `StoreSlice` later as a
// one-struct change once `'arena` is threaded through `Expr`/`Stmt`/`Data`.
pub type StmtNodeList = StoreSlice<Stmt>;
pub type BindingNodeList = StoreSlice<Binding>;

#[repr(u8)] // Zig: enum(u2)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ImportItemStatus {
    None,
    /// The linker doesn't report import/export mismatch errors
    Generated,
    /// The printer will replace this import with "undefined"
    Missing,
}

impl ImportItemStatus {
    // TODO(port): narrow error set
    pub fn json_stringify(self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

#[repr(u8)] // Zig: enum(u2)
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum AssignTarget {
    #[default]
    None = 0,
    /// "a = b"
    Replace = 1,
    /// "a += b"
    Update = 2,
}

impl AssignTarget {
    // TODO(port): narrow error set
    pub fn json_stringify(&self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(*self))
    }
}

#[derive(Copy, Clone)]
pub struct LocRef {
    pub loc: logger::Loc,

    // TODO: remove this optional and make Ref a function getter
    // That will make this struct 128 bits instead of 192 bits and we can remove some heap allocations
    pub ref_: Option<Ref>,
}

impl Default for LocRef {
    fn default() -> Self {
        Self { loc: logger::Loc::EMPTY, ref_: None }
    }
}

pub mod flags {
    use enumset::{EnumSet, EnumSetType};

    #[derive(EnumSetType, Debug)]
    pub enum JSXElement {
        IsKeyAfterSpread,
        HasAnyDynamic,
    }
    pub type JSXElementBitset = EnumSet<JSXElement>;

    #[derive(EnumSetType, Debug)]
    pub enum Property {
        IsComputed,
        IsMethod,
        IsStatic,
        WasShorthand,
        IsSpread,
    }
    pub type PropertySet = EnumSet<Property>;
    pub const PROPERTY_NONE: PropertySet = EnumSet::empty();
    // Zig `Fields = std.enums.EnumFieldStruct(Property, bool, false)` + `init(fields)`:
    // in Rust, construct directly via `Property::IsComputed | Property::IsMethod` etc.
    // TODO(port): if many call sites use the struct-init form, add a builder macro.

    #[derive(EnumSetType, Debug)]
    pub enum Function {
        IsAsync,
        IsGenerator,
        HasRestArg,
        HasIfScope,

        IsForwardDeclaration,

        /// This is true if the function is a method
        IsUniqueFormalParameters,

        /// Only applicable to function statements.
        IsExport,
    }
    pub type FunctionSet = EnumSet<Function>;
    pub const FUNCTION_NONE: FunctionSet = EnumSet::empty();
}
pub use flags as Flags;

pub struct ClauseItem {
    /// The local alias used for the imported/exported symbol in the current module.
    /// For imports: `import { foo as bar }` - "bar" is the alias
    /// For exports: `export { foo as bar }` - "bar" is the alias
    /// For re-exports: `export { foo as bar } from 'path'` - "bar" is the alias
    pub alias: ArenaStr,
    pub alias_loc: logger::Loc,
    /// Reference to the actual symbol being imported/exported.
    /// For imports: `import { foo as bar }` - ref to the symbol representing "foo" from the source module
    /// For exports: `export { foo as bar }` - ref to the local symbol "foo"
    /// For re-exports: `export { foo as bar } from 'path'` - ref to an intermediate symbol
    pub name: LocRef,

    /// This is the original name of the symbol stored in "Name". It's needed for
    /// "SExportClause" statements such as this:
    ///
    ///   export {foo as bar} from 'path'
    ///
    /// In this case both "foo" and "bar" are aliases because it's a re-export.
    /// We need to preserve both aliases in case the symbol is renamed. In this
    /// example, "foo" is "OriginalName" and "bar" is "Alias".
    pub original_name: ArenaStr,
}

impl ClauseItem {
    pub const DEFAULT_ALIAS: &'static [u8] = b"default";
}

impl Default for ClauseItem {
    fn default() -> Self {
        Self {
            alias: empty_arena_str(),
            alias_loc: logger::Loc::EMPTY,
            name: LocRef::default(),
            original_name: empty_arena_str(),
        }
    }
}

#[derive(Clone)]
pub struct SlotCounts {
    pub slots: symbol::SlotNamespaceCountsArray,
}

impl Default for SlotCounts {
    fn default() -> Self {
        // EnumMap<_, u32>::default() zero-fills (Zig: SlotNamespace.CountsArray.initFill(0)).
        Self { slots: symbol::SlotNamespaceCountsArray::default() }
    }
}

impl SlotCounts {
    pub fn union_max(&mut self, other: SlotCounts) {
        // TODO(port): `enum_map::EnumMap` exposes `.values()`; the Zig iterates raw arrays.
        for (a, b) in self.slots.values_mut().zip(other.slots.values()) {
            if *a < *b {
                *a = *b;
            }
        }
    }
}

pub struct NameMinifier {
    pub head: Vec<u8>,
    pub tail: Vec<u8>,
}

impl NameMinifier {
    pub const DEFAULT_HEAD: &'static [u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
    pub const DEFAULT_TAIL: &'static [u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$";

    pub fn init() -> NameMinifier {
        NameMinifier { head: Vec::new(), tail: Vec::new() }
    }

    pub fn number_to_minified_name(
        &self,
        name: &mut Vec<u8>,
        i_: isize,
    ) -> core::result::Result<(), bun_alloc::AllocError> {
        name.clear();
        let mut i = i_;
        let mut j = usize::try_from(i.rem_euclid(54)).expect("int cast");
        name.extend_from_slice(&self.head[j..j + 1]);
        i = i.div_euclid(54);

        while i > 0 {
            i -= 1;
            j = usize::try_from(i.rem_euclid(CHAR_FREQ_COUNT as isize)).expect("int cast");
            name.extend_from_slice(&self.tail[j..j + 1]);
            i = i.div_euclid(CHAR_FREQ_COUNT as isize);
        }
        Ok(())
    }

    pub fn default_number_to_minified_name(i_: isize) -> core::result::Result<Vec<u8>, bun_alloc::AllocError> {
        let mut i = i_;
        let mut j = usize::try_from(i.rem_euclid(54)).expect("int cast");
        let mut name: Vec<u8> = Vec::new();
        name.extend_from_slice(&Self::DEFAULT_HEAD[j..j + 1]);
        i = i.div_euclid(54);

        while i > 0 {
            i -= 1;
            j = usize::try_from(i.rem_euclid(CHAR_FREQ_COUNT as isize)).expect("int cast");
            name.extend_from_slice(&Self::DEFAULT_TAIL[j..j + 1]);
            i = i.div_euclid(CHAR_FREQ_COUNT as isize);
        }

        Ok(name)
    }
}

#[repr(u8)] // Zig: enum(u1)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum OptionalChain {
    /// "a?.b"
    Start,

    /// "a?.b.c" => ".c" is OptionalChain::Continuation
    /// "(a?.b).c" => ".c" is None
    Continuation,
}

impl OptionalChain {
    // TODO(port): narrow error set
    pub fn json_stringify(self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

pub struct EnumValue {
    pub loc: logger::Loc,
    pub ref_: Ref,
    pub name: ArenaStr,
    pub value: Option<ExprNodeIndex>,
}

impl EnumValue {
    pub fn name_as_e_string(&self, bump: &bun_alloc::Arena) -> E::String {
        E::String::init_re_encode_utf8(self.name.slice(), bump)
    }
}

pub struct Catch {
    pub loc: logger::Loc,
    pub binding: Option<BindingNodeIndex>,
    pub body: StmtNodeList,
    pub body_loc: logger::Loc,
}

pub struct Finally {
    pub loc: logger::Loc,
    pub stmts: StmtNodeList,
}

pub struct Case {
    pub loc: logger::Loc,
    pub value: Option<ExprNodeIndex>,
    pub body: StmtNodeList,
}

pub struct ArrayBinding {
    pub binding: BindingNodeIndex,
    pub default_value: Option<ExprNodeIndex>,
}

/// TLA => Top Level Await
#[derive(Copy, Clone)]
pub struct TlaCheck {
    pub depth: u32,
    pub parent: <Index as crate::ast::base::IndexExt>::Int, // Index.Int
    pub import_record_index: <Index as crate::ast::base::IndexExt>::Int,
}
// TODO(port): `Index.Int` — assumed associated type/alias on Index; adjust to concrete `u32` if simpler.

impl Default for TlaCheck {
    fn default() -> Self {
        Self {
            depth: 0,
            parent: Index::INVALID.get(),
            import_record_index: Index::INVALID.get(),
        }
    }
}

#[derive(Copy, Clone)]
pub struct Span {
    pub text: ArenaStr,
    pub range: logger::Range,
}

impl Default for Span {
    fn default() -> Self {
        Self { text: empty_arena_str(), range: logger::Range::default() }
    }
}

/// Inlined enum values can only be numbers and strings
/// This type special cases an encoding similar to JSValue, where nan-boxing is used
/// to encode both a 64-bit pointer or a 64-bit float using 64 bits.
#[derive(Copy, Clone)]
pub struct InlinedEnumValue {
    pub raw_data: u64,
}

#[derive(Copy, Clone)]
pub enum InlinedEnumValueDecoded {
    // LIFETIMES.tsv: ARENA → *const e::String
    String(*const E::String),
    Number(f64),
}

impl InlinedEnumValue {
    /// See JSCJSValue.h in WebKit for more details
    const DOUBLE_ENCODE_OFFSET: u64 = 1 << 49;
    /// See PureNaN.h in WebKit for more details
    const PURE_NAN: f64 = f64::from_bits(0x7ff8000000000000);

    fn purify_nan(value: f64) -> f64 {
        if value.is_nan() { Self::PURE_NAN } else { value }
    }

    pub fn encode(decoded: InlinedEnumValueDecoded) -> InlinedEnumValue {
        let encoded = InlinedEnumValue {
            raw_data: match decoded {
                InlinedEnumValueDecoded::String(ptr) => (ptr as usize as u64) & 0x0000_FFFF_FFFF_FFFF, // @truncate to u48
                InlinedEnumValueDecoded::Number(num) => {
                    Self::purify_nan(num).to_bits() + Self::DOUBLE_ENCODE_OFFSET
                }
            },
        };
        if cfg!(debug_assertions) {
            debug_assert!(match encoded.decode() {
                InlinedEnumValueDecoded::String(str_) => match decoded {
                    InlinedEnumValueDecoded::String(orig) => core::ptr::eq(str_, orig),
                    _ => false,
                },
                InlinedEnumValueDecoded::Number(num) => match decoded {
                    InlinedEnumValueDecoded::Number(orig) =>
                        num.to_bits() == Self::purify_nan(orig).to_bits(),
                    _ => false,
                },
            });
        }
        encoded
    }

    pub fn decode(self) -> InlinedEnumValueDecoded {
        if self.raw_data > 0x0000_FFFF_FFFF_FFFF {
            InlinedEnumValueDecoded::Number(f64::from_bits(self.raw_data - Self::DOUBLE_ENCODE_OFFSET))
        } else {
            // SAFETY: encoded from a valid arena `*const E::String` (see `encode`); low 48 bits hold the address.
            InlinedEnumValueDecoded::String(self.raw_data as usize as *const E::String)
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ExportsKind {
    // This file doesn't have any kind of export, so it's impossible to say what
    // kind of file this is. An empty file is in this category, for example.
    None,

    // The exports are stored on "module" and/or "exports". Calling "require()"
    // on this module returns "module.exports". All imports to this module are
    // allowed but may return undefined.
    Cjs,

    // All export names are known explicitly. Calling "require()" on this module
    // generates an exports object (stored in "exports") with getters for the
    // export names. Named imports to this module are only allowed if they are
    // in the set of export names.
    Esm,

    // Some export names are known explicitly, but others fall back to a dynamic
    // run-time object. This is necessary when using the "export * from" syntax
    // with either a CommonJS module or an external module (i.e. a module whose
    // export names are not known at compile-time).
    //
    // Calling "require()" on this module generates an exports object (stored in
    // "exports") with getters for the export names. All named imports to this
    // module are allowed. Direct named imports reference the corresponding export
    // directly. Other imports go through property accesses on "exports".
    EsmWithDynamicFallback,

    // Like "EsmWithDynamicFallback", but the module was originally a CommonJS
    // module.
    EsmWithDynamicFallbackFromCjs,
}

impl ExportsKind {
    pub fn is_dynamic(self) -> bool {
        matches!(
            self,
            Self::Cjs | Self::EsmWithDynamicFallback | Self::EsmWithDynamicFallbackFromCjs
        )
    }

    pub fn is_esm_with_dynamic_fallback(self) -> bool {
        matches!(self, Self::EsmWithDynamicFallback | Self::EsmWithDynamicFallbackFromCjs)
    }

    // TODO(port): narrow error set
    pub fn json_stringify(self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }

    pub fn to_module_type(self) -> bun_options_types::BundleEnums::ModuleType {
        use bun_options_types::BundleEnums::ModuleType;
        match self {
            Self::None => ModuleType::Unknown,
            Self::Cjs => ModuleType::Cjs,
            Self::EsmWithDynamicFallback
            | Self::EsmWithDynamicFallbackFromCjs
            | Self::Esm => ModuleType::Esm,
        }
    }
}

#[derive(Copy, Clone)]
pub struct DeclaredSymbol {
    pub ref_: Ref,
    pub is_top_level: bool,
}

pub struct DeclaredSymbolList {
    pub entries: MultiArrayList<DeclaredSymbol>,
}

impl Default for DeclaredSymbolList {
    fn default() -> Self {
        Self { entries: MultiArrayList::default() }
    }
}

impl DeclaredSymbolList {
    pub fn refs(&self) -> &[Ref] {
        self.entries.items::<"ref_", Ref>()
    }

    pub fn to_owned_slice(&mut self) -> DeclaredSymbolList {
        core::mem::take(self)
    }

    pub fn clone(&self) -> core::result::Result<DeclaredSymbolList, bun_alloc::AllocError> {
        Ok(DeclaredSymbolList { entries: self.entries.clone()? })
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn append(&mut self, entry: DeclaredSymbol) -> core::result::Result<(), bun_alloc::AllocError> {
        self.ensure_unused_capacity(1)?;
        self.append_assume_capacity(entry);
        Ok(())
    }

    pub fn append_list(&mut self, other: DeclaredSymbolList) -> core::result::Result<(), bun_alloc::AllocError> {
        self.ensure_unused_capacity(other.len())?;
        self.append_list_assume_capacity(other);
        Ok(())
    }

    pub fn append_list_assume_capacity(&mut self, other: DeclaredSymbolList) {
        // PERF(port): was assume_capacity
        self.entries.append_list_assume_capacity(&other.entries);
    }

    pub fn append_assume_capacity(&mut self, entry: DeclaredSymbol) {
        // PERF(port): was assume_capacity
        self.entries.append_assume_capacity(entry);
    }

    pub fn ensure_total_capacity(&mut self, count: usize) -> core::result::Result<(), bun_alloc::AllocError> {
        self.entries.ensure_total_capacity(count)
    }

    pub fn ensure_unused_capacity(&mut self, count: usize) -> core::result::Result<(), bun_alloc::AllocError> {
        self.entries.ensure_unused_capacity(count)
    }

    pub fn clear_retaining_capacity(&mut self) {
        self.entries.clear_retaining_capacity();
    }

    // `deinit` → Drop on MultiArrayList; no explicit body needed.

    pub fn init_capacity(capacity: usize) -> core::result::Result<DeclaredSymbolList, bun_alloc::AllocError> {
        let mut entries = MultiArrayList::<DeclaredSymbol>::default();
        entries.ensure_unused_capacity(capacity)?;
        Ok(DeclaredSymbolList { entries })
    }

    pub fn from_slice(entries: &[DeclaredSymbol]) -> core::result::Result<DeclaredSymbolList, bun_alloc::AllocError> {
        let mut this = Self::init_capacity(entries.len())?;
        // errdefer this.deinit() → Drop handles it
        for entry in entries {
            this.append_assume_capacity(*entry);
        }
        Ok(this)
    }
}
// TODO(port): arena threading — Zig passes `std.mem.Allocator` to every
// MultiArrayList op. bun_collections::MultiArrayList owns its arena (global
// mimalloc); if Phase B needs arena-backed SoA storage, add a `&'bump Bump`
// param here.

impl DeclaredSymbol {
    fn for_each_top_level_symbol_with_type<C>(
        decls: &DeclaredSymbolList,
        ctx: &mut C,
        f: impl Fn(&mut C, Ref),
    ) {
        let entries = decls.entries.slice();
        let is_top_level: &[bool] = entries.items::<"is_top_level", bool>();
        let refs: &[Ref] = entries.items::<"ref_", Ref>();

        // TODO: SIMD
        debug_assert_eq!(is_top_level.len(), refs.len());
        for (top, ref_) in is_top_level.iter().zip(refs.iter()) {
            if *top {
                // PERF(port): was @call(bun.callmod_inline, ...) — relies on inlining.
                f(ctx, *ref_);
            }
        }
    }

    pub fn for_each_top_level_symbol<C>(
        decls: &DeclaredSymbolList,
        ctx: &mut C,
        f: impl Fn(&mut C, Ref),
    ) {
        Self::for_each_top_level_symbol_with_type(decls, ctx, f);
    }
}

#[derive(Copy, Clone)]
pub struct Dependency {
    pub source_index: Index,
    pub part_index: u32, // Index.Int
}

impl Default for Dependency {
    fn default() -> Self {
        Self { source_index: Index::INVALID, part_index: 0 }
    }
}

pub type DependencyList = Vec<Dependency>;

pub type ExprList = Vec<Expr>;
pub type StmtList = Vec<Stmt>;
pub type BindingList = Vec<Binding>;
// PERF(port): Zig `std.array_list.Managed` — these may be arena-backed in
// callers; revisit with bumpalo::collections::Vec if profiling shows churn.

/// Each file is made up of multiple parts, and each part consists of one or
/// more top-level statements. Parts are used for tree shaking and code
/// splitting analysis. Individual parts of a file can be discarded by tree
/// shaking and can be assigned to separate chunks (i.e. output files) by code
/// splitting.
pub struct Part {
    pub stmts: StoreSlice<Stmt>,
    pub scopes: StoreSlice<*mut Scope>, // TODO(port): &'bump mut [&'bump mut Scope]

    /// Each is an index into the file-level import record list
    pub import_record_indices: PartImportRecordIndices,

    /// All symbols that are declared in this part. Note that a given symbol may
    /// have multiple declarations, and so may end up being declared in multiple
    /// parts (e.g. multiple "var" declarations with the same name). Also note
    /// that this list isn't deduplicated and may contain duplicates.
    pub declared_symbols: DeclaredSymbolList,

    /// An estimate of the number of uses of all symbols used within this part.
    pub symbol_uses: PartSymbolUseMap,

    /// This tracks property accesses off of imported symbols. We don't know
    /// during parsing if an imported symbol is going to be an inlined enum
    /// value or not. This is only known during linking. So we defer adding
    /// a dependency on these imported symbols until we know whether the
    /// property access is an inlined enum value or not.
    pub import_symbol_property_uses: PartSymbolPropertyUseMap,

    /// The indices of the other parts in this file that are needed if this part
    /// is needed.
    pub dependencies: DependencyList,

    /// If true, this part can be removed if none of the declared symbols are
    /// used. If the file containing this part is imported, then all parts that
    /// don't have this flag enabled must be included.
    pub can_be_removed_if_unused: bool,

    /// This is used for generated parts that we don't want to be present if they
    /// aren't needed. This enables tree shaking for these parts even if global
    /// tree shaking isn't enabled.
    pub force_tree_shaking: bool,

    /// This is true if this file has been marked as live by the tree shaking
    /// algorithm.
    pub is_live: bool,

    pub tag: PartTag,
}

pub type PartImportRecordIndices = Vec<u32>;
pub type PartList = Vec<Part>;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PartTag {
    None,
    JsxImport,
    Runtime,
    CjsImports,
    ReactFastRefresh,
    DirnameFilename,
    BunTest,
    DeadDueToInlining,
    CommonjsNamedExport,
    ImportToConvertFromRequire,
}

// Zig: std.ArrayHashMapUnmanaged(Ref, Symbol.Use, RefHashCtx, false)
// TODO(port): bun_collections::ArrayHashMap must accept a custom hasher ctx (RefHashCtx).
pub type PartSymbolUseMap = ArrayHashMap<Ref, symbol::Use>;
pub type PartSymbolPropertyUseMap = ArrayHashMap<Ref, StringHashMap<symbol::Use>>;

impl Default for Part {
    fn default() -> Self {
        Self {
            stmts: StoreSlice::EMPTY,
            scopes: StoreSlice::EMPTY,
            import_record_indices: PartImportRecordIndices::default(),
            declared_symbols: DeclaredSymbolList::default(),
            symbol_uses: PartSymbolUseMap::default(),
            import_symbol_property_uses: PartSymbolPropertyUseMap::default(),
            dependencies: DependencyList::default(),
            can_be_removed_if_unused: false,
            force_tree_shaking: false,
            is_live: false,
            tag: PartTag::None,
        }
    }
}

impl Part {
    // TODO(port): narrow error set
    pub fn json_stringify(&self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(self.stmts.slice())
    }
}

// NOTE: shadows the prelude `Result` for this module — all error-union return
// types in this file are spelled `core::result::Result<T, E>` to disambiguate.
pub enum Result {
    AlreadyBundled(AlreadyBundled),
    Cached,
    Ast(Ast),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AlreadyBundled {
    Bun,
    BunCjs,
    Bytecode,
    BytecodeCjs,
}

pub enum StmtOrExpr {
    Stmt(Stmt),
    Expr(Expr),
}

impl Default for StmtOrExpr {
    fn default() -> Self {
        StmtOrExpr::Expr(Expr::default())
    }
}

impl StmtOrExpr {
    pub fn to_expr(self) -> Expr {
        match self {
            StmtOrExpr::Expr(expr) => expr,
            StmtOrExpr::Stmt(stmt) => match stmt.data {
                crate::ast::stmt::Data::SFunction(mut s) => {
                    // PORT NOTE: Zig moved `func.func` out by value; StoreRef arena
                    // slot is never individually dropped, so `take` (replace with
                    // Default) is the safe Rust equivalent.
                    let func = core::mem::take(&mut s.func);
                    Expr::init(E::Function { func }, stmt.loc)
                }
                crate::ast::stmt::Data::SClass(mut s) => {
                    let class = core::mem::take(&mut s.class);
                    Expr::init::<E::Class>(class, stmt.loc)
                }
                other => Output::panic(format_args!(
                    "Unexpected statement type in default export: .{}",
                    <&'static str>::from(other.tag())
                )),
            },
        }
    }
}

pub struct NamedImport {
    /// Parts within this file that use this import
    pub local_parts_with_uses: Vec<u32>,

    /// The original export name from the source module being imported.
    /// Examples:
    /// - `import { foo } from 'module'` → alias = "foo"
    /// - `import { foo as bar } from 'module'` → alias = "foo" (original export name)
    /// - `import * as ns from 'module'` → alias_is_star = true, alias = ""
    /// This field is used by the bundler to match imports with their corresponding
    /// exports and for error reporting when imports can't be resolved.
    pub alias: Option<ArenaStr>,
    pub alias_loc: Option<logger::Loc>,
    pub namespace_ref: Option<Ref>,
    pub import_record_index: u32,

    /// If true, the alias refers to the entire export namespace object of a
    /// module. This is no longer represented as an alias called "*" because of
    /// the upcoming "Arbitrary module namespace identifier names" feature:
    /// https://github.com/tc39/ecma262/pull/2154
    pub alias_is_star: bool,

    /// It's useful to flag exported imports because if they are in a TypeScript
    /// file, we can't tell if they are a type or a value.
    pub is_exported: bool,
}

#[derive(Copy, Clone)]
pub struct NamedExport {
    pub ref_: Ref,
    pub alias_loc: logger::Loc,
}

#[repr(u8)] // Zig: enum(u4)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum StrictModeKind {
    SloppyMode,
    ExplicitStrictMode,
    ImplicitStrictModeImport,
    ImplicitStrictModeExport,
    ImplicitStrictModeTopLevelAwait,
    ImplicitStrictModeClass,
}

impl StrictModeKind {
    // TODO(port): narrow error set
    pub fn json_stringify(self, writer: &mut impl JsonWriter) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

pub fn printmem(args: fmt::Arguments<'_>) {
    // `defer Output.flush()` → executes after print; emulate ordering explicitly.
    Output::init_test();
    Output::print(args);
    Output::flush();
}

// TODO(b1): `thiserror` not in this crate's deps; hand-roll Display/Error.
#[derive(Debug, Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ToJSError {
    #[strum(serialize = "Cannot convert argument type to JS")]
    CannotConvertArgumentTypeToJS,
    #[strum(serialize = "Cannot convert identifier to JS. Try a statically-known value")]
    CannotConvertIdentifierToJS,
    MacroError,
    OutOfMemory,
    JSError,
    JSTerminated,
}
impl fmt::Display for ToJSError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str(<&'static str>::from(*self)) }
}
impl core::error::Error for ToJSError {}

impl From<ToJSError> for bun_core::Error {
    fn from(e: ToJSError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
        // TODO(port): bun_core::Error construction API (interned tag).
    }
}

/// Say you need to allocate a bunch of tiny arrays
/// You could just do separate allocations for each, but that is slow
/// With std.ArrayList, pointers invalidate on resize and that means it will crash.
/// So a better idea is to batch up your allocations into one larger allocation
/// and then just make all the arrays point to different parts of the larger allocation
pub struct Batcher<T> {
    pub head: StoreSlice<T>,
}

impl<T> Batcher<T> {
    pub fn init(bump: &bun_alloc::Arena, count: usize) -> core::result::Result<Self, bun_alloc::AllocError>
    where
        T: Default,
    {
        // TODO(port): bumpalo alloc_slice for uninit T — Zig `arena.alloc(Type, count)`.
        // PERF(port): Zig left the slice uninitialized; bumpalo requires Default fill.
        let all = bump.alloc_slice_fill_default(count);
        Ok(Self { head: StoreSlice::new_mut(all) })
    }

    pub fn done(&mut self) {
        debug_assert!(self.head.is_empty()); // count to init() was too large, overallocation
    }

    pub fn eat(&mut self, value: T) -> *mut T {
        // PORT NOTE: Zig source `@ptrCast(&this.head.eat1(value).ptr)` appears to
        // intend `this.eat1(value).ptr` cast to *T. Porting the apparent intent.
        self.eat1(value).as_ptr().cast_mut()
    }

    pub fn eat1(&mut self, value: T) -> StoreSlice<T> {
        // SAFETY: `head` is a valid arena slice with at least 1 element remaining
        // (caller contract — Zig would panic on bounds); `Batcher` holds the
        // unique view of the underlying arena allocation.
        let head = unsafe { self.head.slice_mut() };
        let (prev, rest) = head.split_at_mut(1);
        prev[0] = value;
        self.head = StoreSlice::new_mut(rest);
        StoreSlice::new_mut(prev)
    }

    pub fn next<const N: usize>(&mut self, values: [T; N]) -> StoreSlice<T> {
        // SAFETY: `head` is a valid arena slice with at least N elements remaining;
        // see `eat1` for the uniqueness invariant.
        let head = unsafe { self.head.slice_mut() };
        let (prev, rest) = head.split_at_mut(N);
        for (dst, src) in prev.iter_mut().zip(values) {
            *dst = src;
        }
        self.head = StoreSlice::new_mut(rest);
        StoreSlice::new_mut(prev)
    }
}
// Zig: `pub fn NewBatcher(comptime Type: type) type` → Rust generic struct above.
pub type NewBatcher<T> = Batcher<T>;

// ─── helper trait for jsonStringify (Zig `writer: anytype` with `.write`) ───
// TODO(port): replace with the actual JSON writer protocol once ported.
pub trait JsonWriter {
    fn write<V: ?Sized>(&mut self, value: &V) -> core::result::Result<(), bun_core::Error>;
}

// ═════════════════════════════════════════════════════════════════════════
// Symbols pulled DOWN from higher-tier
// crates so lower-tier callers (css, interchange, js_parser itself) can
// resolve them here without forming a cycle. Ground truth for each port is
// the named .zig file, NOT the sibling .rs (which may already forward-ref).
// ═════════════════════════════════════════════════════════════════════════

// ─── from bun_jsc::math (src/jsc/jsc.zig) ───────────────────────────────────
pub mod math {
    /// `Number.MAX_SAFE_INTEGER` (2^53 - 1)
    pub const MAX_SAFE_INTEGER: f64 = 9007199254740991.0;
    /// `Number.MIN_SAFE_INTEGER` (-(2^53 - 1))
    pub const MIN_SAFE_INTEGER: f64 = -9007199254740991.0;

    unsafe extern "C" {
        // Zig: `extern "c" fn Bun__JSC__operationMathPow(f64, f64) f64;`
        fn Bun__JSC__operationMathPow(x: f64, y: f64) -> f64;
    }

    /// JSC-compatible `Math.pow` (matches WebKit's `operationMathPow` corner-case
    /// handling for NaN/±∞/±0 — `std::powf` differs on a handful of inputs).
    #[inline]
    pub fn pow(x: f64, y: f64) -> f64 {
        // SAFETY: pure FFI, no pointers, no errno.
        unsafe { Bun__JSC__operationMathPow(x, y) }
    }
}

// ─── from bun_js_printer::Options::Indentation (src/js_printer/js_printer.zig) ─
#[derive(Copy, Clone, Debug)]
pub struct Indentation {
    pub scalar: usize,
    pub count: usize,
    pub character: IndentationCharacter,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum IndentationCharacter {
    Tab,
    Space,
}

// Zig nests `Character` inside the struct; Rust callers that wrote
// `Indentation::Character::Space` use the top-level enum directly.
// TODO(port): inherent associated types are unstable — if many call sites
// need the nested path, gate behind `#![feature(inherent_associated_types)]`.

impl Default for Indentation {
    fn default() -> Self {
        Self { scalar: 2, count: 0, character: IndentationCharacter::Space }
    }
}

// ─── from bun_bundler::v2::MangledProps (src/bundler/bundle_v2.zig) ─────────
// Zig: `std.AutoArrayHashMapUnmanaged(Ref, []const u8)`
// LIFETIMES.tsv: value slices point into the parser arena → `StoreStr`
// (arena-owned, no `'bump` cascade).
pub type MangledProps = ArrayHashMap<Ref, StoreStr>;

// ─── from bun_jsc::RuntimeTranspilerCache (src/jsc/RuntimeTranspilerCache.zig) ─
// B-3 UNIFIED: this is the single canonical struct. `bun_bundler::cache`
// re-exports it and adds disk-I/O / `js_printer` dispatch via an extension
// trait (those need `bun_js_printer` / `bun_sys` which sit a tier above
// js_parser). The parser writes `input_hash` / `features_hash` / `exports_kind`
// and calls `get()` through the vtable; the bundler/jsc tier owns `entry` and
// the on-disk encode/decode (`Metadata` / `Entry` live in `bun_bundler::cache`
// and are stored here type-erased as `*mut ()`).
pub struct RuntimeTranspilerCache {
    pub input_hash: Option<u64>,
    pub input_byte_length: Option<u64>,
    pub features_hash: Option<u64>,
    pub exports_kind: ExportsKind,
    /// Set by `put()` / `get()` when a cache hit returns transpiled output.
    /// Zig: `?bun.String` — bundler/parser only store/read the bytes; T6 owns
    /// the `bun.String` wrapper when surfacing to JS.
    pub output_code: Option<Box<[u8]>>,
    /// Opaque storage for `bun_bundler::cache::RuntimeTranspilerCacheEntry` —
    /// the concrete type lives a tier up and is round-tripped via cast.
    pub entry: Option<*mut ()>,

    /// Dispatch slot — `bun_jsc` writes `&JSC_TRANSPILER_CACHE_VTABLE` at init.
    /// `None` ⇒ caching disabled (e.g. wasm builds, `--no-transpiler-cache`).
    pub vtable: Option<&'static RuntimeTranspilerCacheVTable>,
}

impl Default for RuntimeTranspilerCache {
    fn default() -> Self {
        Self {
            input_hash: None,
            input_byte_length: None,
            features_hash: None,
            exports_kind: ExportsKind::None,
            output_code: None,
            entry: None,
            vtable: None,
        }
    }
}

/// Manual vtable per PORTING.md §Dispatch (cold path: at most twice per parse).
/// Low tier (`js_parser`) names no `bun_jsc` types; high tier owns the impls.
// PERF(port): was direct call into bun.jsc — acceptable, callee does file I/O.
pub struct RuntimeTranspilerCacheVTable {
    /// Zig `RuntimeTranspilerCache.get(source, parser_options, used_jsx) bool`.
    /// `parser_options` is passed as `*const ()` because `parser::Options`
    /// would be a forward edge here; the jsc impl casts it back.
    pub get: unsafe fn(
        this: *mut RuntimeTranspilerCache,
        source: *const logger::Source,
        parser_options: *const (),
        used_jsx: bool,
    ) -> bool,
    /// Zig `RuntimeTranspilerCache.put(output_code, sourcemap, esm_record)` —
    /// writes the cache entry to disk and stores `output_code` on `this`.
    pub put: unsafe fn(
        this: *mut RuntimeTranspilerCache,
        output_code: &[u8],
        sourcemap: &[u8],
        esm_record: &[u8],
    ),
    /// Zig `RuntimeTranspilerCache.is_disabled` — runtime flag, not const.
    pub is_disabled: fn() -> bool,
}

impl RuntimeTranspilerCache {
    #[inline]
    pub fn get(
        &mut self,
        source: &logger::Source,
        parser_options: *const (),
        used_jsx: bool,
    ) -> bool {
        match self.vtable {
            // SAFETY: `self` is a valid &mut; vtable contract per §Dispatch.
            Some(vt) => unsafe { (vt.get)(std::ptr::from_mut(self), std::ptr::from_ref(source), parser_options, used_jsx) },
            None => false,
        }
    }

    #[inline]
    pub fn is_disabled(&self) -> bool {
        self.vtable.map_or(true, |vt| (vt.is_disabled)())
    }
}

pub mod defines_table;

// ─── from bun_bundler::defines (src/bundler/defines.zig) ────────────────────
// B-3 UNIFIED: canonical `Define` / `DefineData` / `DotDefine` live here so the
// parser (`P.define: &'a Define`) and the bundler (`BundleOptions.define:
// Box<Define>`) share one nominal type. `bun_bundler::defines` re-exports these
// and layers the json-parse / dotenv `init` on top via an extension trait. The
// pure-global fallback table also lives at this tier (`defines_table`) so
// `for_identifier` reads its own const — no cross-crate hook.
pub mod defines {
    use bun_collections::{StringArrayHashMap, StringHashMap};
    use bun_string::strings;

    use crate::ast::expr::Data as ExprData;
    use crate::ast::StoreRef;
    use crate::E;

    // Zig: `bun.StringArrayHashMap(string)` / `bun.StringArrayHashMap(DefineData)`.
    pub type RawDefines = StringArrayHashMap<Box<[u8]>>;
    pub type UserDefines = StringHashMap<DefineData>;
    pub type UserDefinesArray = StringArrayHashMap<DefineData>;

    pub type IdentifierDefine = DefineData;

    #[derive(Clone)]
    pub struct DotDefine {
        // Zig stored borrowed `[][]const u8` into static tables / user-define
        // key strings; the Rust port owns the part strings (small, allocated
        // once at startup). PERF(port): tiny copies.
        pub parts: Vec<Box<[u8]>>,
        pub data: DefineData,
    }

    /// Zig: `packed struct(u8)` — `_padding: u3, valueless: bool,
    /// can_be_removed_if_unused: bool, call_can_be_unwrapped_if_unused:
    /// E.CallUnwrap (u2), method_call_must_be_replaced_with_undefined: bool`.
    /// Packed LSB-first → bit positions below match the Zig layout exactly.
    #[repr(transparent)]
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub struct Flags(u8);

    impl Flags {
        const VALUELESS_SHIFT: u8 = 3;
        const CAN_BE_REMOVED_SHIFT: u8 = 4;
        const CALL_UNWRAP_SHIFT: u8 = 5;
        const CALL_UNWRAP_MASK: u8 = 0b11 << Self::CALL_UNWRAP_SHIFT;
        const METHOD_CALL_UNDEF_SHIFT: u8 = 7;

        #[inline]
        pub const fn valueless(self) -> bool {
            (self.0 >> Self::VALUELESS_SHIFT) & 1 != 0
        }
        #[inline]
        pub fn set_valueless(&mut self, v: bool) {
            self.0 = (self.0 & !(1 << Self::VALUELESS_SHIFT)) | ((v as u8) << Self::VALUELESS_SHIFT);
        }
        #[inline]
        pub const fn can_be_removed_if_unused(self) -> bool {
            (self.0 >> Self::CAN_BE_REMOVED_SHIFT) & 1 != 0
        }
        #[inline]
        pub fn set_can_be_removed_if_unused(&mut self, v: bool) {
            self.0 = (self.0 & !(1 << Self::CAN_BE_REMOVED_SHIFT))
                | ((v as u8) << Self::CAN_BE_REMOVED_SHIFT);
        }
        #[inline]
        pub fn call_can_be_unwrapped_if_unused(self) -> E::CallUnwrap {
            // 2-bit field; `E::CallUnwrap` only has discriminants 0/1/2, so
            // an explicit match keeps bit-pattern 3 sound.
            match (self.0 & Self::CALL_UNWRAP_MASK) >> Self::CALL_UNWRAP_SHIFT {
                1 => E::CallUnwrap::IfUnused,
                2 => E::CallUnwrap::IfUnusedAndToStringSafe,
                _ => E::CallUnwrap::Never,
            }
        }
        #[inline]
        pub fn set_call_can_be_unwrapped_if_unused(&mut self, v: E::CallUnwrap) {
            self.0 =
                (self.0 & !Self::CALL_UNWRAP_MASK) | (((v as u8) & 0b11) << Self::CALL_UNWRAP_SHIFT);
        }
        #[inline]
        pub const fn method_call_must_be_replaced_with_undefined(self) -> bool {
            (self.0 >> Self::METHOD_CALL_UNDEF_SHIFT) & 1 != 0
        }
        #[inline]
        pub fn set_method_call_must_be_replaced_with_undefined(&mut self, v: bool) {
            self.0 = (self.0 & !(1 << Self::METHOD_CALL_UNDEF_SHIFT))
                | ((v as u8) << Self::METHOD_CALL_UNDEF_SHIFT);
        }
        pub fn new(
            valueless: bool,
            can_be_removed_if_unused: bool,
            call_can_be_unwrapped_if_unused: E::CallUnwrap,
            method_call_must_be_replaced_with_undefined: bool,
        ) -> Self {
            let mut f = Flags(0);
            f.set_valueless(valueless);
            f.set_can_be_removed_if_unused(can_be_removed_if_unused);
            f.set_call_can_be_unwrapped_if_unused(call_can_be_unwrapped_if_unused);
            f.set_method_call_must_be_replaced_with_undefined(
                method_call_must_be_replaced_with_undefined,
            );
            f
        }
    }

    #[derive(Clone)]
    pub struct DefineData {
        pub value: ExprData,
        // Zig stored `original_name_ptr: ?[*]const u8` + `original_name_len: u32`
        // borrowing into caller-owned strings (defines.zig:24-25 — the 48→40-byte
        // packing trick). The Rust port owns the `RawDefines` value bytes
        // (`Box<[u8]>`), so borrowing would be a use-after-free once the
        // `RawDefines` map is dropped after `Define::init`. Own the bytes here
        // instead — these are tiny startup-time copies.
        // Kept `pub` so the bundler-side `parse`/`from_input` (which live a
        // tier up for json-parser access) can construct directly.
        pub original_name: Option<Box<[u8]>>,
        pub flags: Flags,
    }

    // SAFETY: `ExprData` contains `StoreRef` raw pointers into immutable,
    // process-lifetime AST stores. `DefineData` is only shared across threads
    // via the read-only `Box<Define>` after init. Never written through.
    unsafe impl Send for DefineData {}
    unsafe impl Sync for DefineData {}

    impl Default for DefineData {
        fn default() -> Self {
            Self {
                // Zig: `.e_missing = .{}`
                value: ExprData::EMissing(E::Missing),
                original_name: None,
                flags: Flags::default(),
            }
        }
    }

    /// Named-init shim (mirrors Zig anonymous-struct init).
    pub struct Options<'a> {
        pub original_name: Option<&'a [u8]>,
        pub value: ExprData,
        pub valueless: bool,
        pub can_be_removed_if_unused: bool,
        pub call_can_be_unwrapped_if_unused: E::CallUnwrap,
        pub method_call_must_be_replaced_with_undefined: bool,
    }
    impl<'a> Default for Options<'a> {
        fn default() -> Self {
            Self {
                original_name: None,
                value: ExprData::EMissing(E::Missing),
                valueless: false,
                can_be_removed_if_unused: false,
                call_can_be_unwrapped_if_unused: E::CallUnwrap::Never,
                method_call_must_be_replaced_with_undefined: false,
            }
        }
    }

    impl DefineData {
        pub fn init(options: Options<'_>) -> DefineData {
            DefineData {
                value: options.value,
                flags: Flags::new(
                    options.valueless,
                    options.can_be_removed_if_unused,
                    options.call_can_be_unwrapped_if_unused,
                    options.method_call_must_be_replaced_with_undefined,
                ),
                original_name: options.original_name.map(Box::<[u8]>::from),
            }
        }

        #[inline]
        pub fn original_name(&self) -> Option<&[u8]> {
            match &self.original_name {
                Some(name) if !name.is_empty() => Some(name.as_ref()),
                _ => None,
            }
        }

        /// True if accessing this value is known to not have any side effects.
        #[inline]
        pub fn can_be_removed_if_unused(&self) -> bool {
            self.flags.can_be_removed_if_unused()
        }
        /// True if a call to this value is known to not have any side effects.
        #[inline]
        pub fn call_can_be_unwrapped_if_unused(&self) -> E::CallUnwrap {
            self.flags.call_can_be_unwrapped_if_unused()
        }
        #[inline]
        pub fn method_call_must_be_replaced_with_undefined(&self) -> bool {
            self.flags.method_call_must_be_replaced_with_undefined()
        }
        #[inline]
        pub fn valueless(&self) -> bool {
            self.flags.valueless()
        }

        pub fn init_boolean(value: bool) -> DefineData {
            let mut flags = Flags::default();
            flags.set_can_be_removed_if_unused(true);
            DefineData { value: ExprData::EBoolean(E::Boolean { value }), flags, ..Default::default() }
        }

        pub fn init_static_string(str: &'static E::EString) -> DefineData {
            let mut flags = Flags::default();
            flags.set_can_be_removed_if_unused(true);
            DefineData {
                // Zig: @constCast(str) — Expr.Data.e_string stores *E.String.
                value: ExprData::EString(StoreRef::from_static(str)),
                flags,
                ..Default::default()
            }
        }

        pub fn merge(a: DefineData, b: DefineData) -> DefineData {
            DefineData {
                value: b.value,
                flags: Flags::new(
                    // TODO: investigate if this is correct. This is what it was before.
                    a.method_call_must_be_replaced_with_undefined()
                        || b.method_call_must_be_replaced_with_undefined(),
                    a.can_be_removed_if_unused(),
                    a.call_can_be_unwrapped_if_unused(),
                    a.method_call_must_be_replaced_with_undefined()
                        || b.method_call_must_be_replaced_with_undefined(),
                ),
                original_name: b.original_name,
            }
        }
    }

    pub struct Define {
        pub identifiers: StringHashMap<IdentifierDefine>,
        pub dots: StringHashMap<Vec<DotDefine>>,
        pub drop_debugger: bool,
    }

    impl Default for Define {
        fn default() -> Self {
            Self {
                identifiers: StringHashMap::default(),
                dots: StringHashMap::default(),
                drop_debugger: false,
            }
        }
    }

    impl Define {
        pub fn for_identifier(&self, name: &[u8]) -> Option<&IdentifierDefine> {
            if let Some(data) = self.identifiers.get(name) {
                return Some(data);
            }
            // Pure-global fallback — table lives at this tier (no hook).
            crate::defines_table::PURE_GLOBAL_IDENTIFIER_MAP
                .get(name)
                .map(|v| v.value())
        }

        // Zig: `comptime Iterator: type, iter: Iterator` — type param dropped.
        pub fn insert_from_iterator<'a, I>(&mut self, iter: I) -> Result<(), bun_alloc::AllocError>
        where
            I: Iterator<Item = (&'a [u8], &'a DefineData)>,
        {
            for (key, value) in iter {
                self.insert(key, value.clone())?;
            }
            Ok(())
        }

        pub fn insert(
            &mut self,
            key: &[u8],
            value: DefineData,
        ) -> Result<(), bun_alloc::AllocError> {
            // If it has a dot, then it's a DotDefine. e.g. process.env.NODE_ENV
            if let Some(last_dot) = strings::last_index_of_char(key, b'.') {
                let tail = &key[last_dot + 1..key.len()];
                let remainder = &key[0..last_dot];
                let count = remainder.iter().filter(|&&b| b == b'.').count() + 1;
                let mut parts: Vec<Box<[u8]>> = Vec::with_capacity(count + 1);
                for split in remainder.split(|b| *b == b'.') {
                    parts.push(Box::from(split));
                }
                parts.push(Box::from(tail));

                let mut initial_values: &[DotDefine] = &[];
                // PORT NOTE: reshaped for borrowck — getOrPut split into get/insert.
                if let Some(existing) = self.dots.get_mut(tail) {
                    for part in existing.iter_mut() {
                        if are_parts_equal(&part.parts, &parts) {
                            part.data = DefineData::merge(part.data.clone(), value);
                            return Ok(());
                        }
                    }
                    initial_values = existing.as_slice();
                }

                let mut list: Vec<DotDefine> = Vec::with_capacity(initial_values.len() + 1);
                if !initial_values.is_empty() {
                    list.extend_from_slice(initial_values);
                }
                list.push(DotDefine { data: value, parts });
                self.dots.insert(tail.into(), list);
            } else {
                // e.g. IS_BROWSER
                self.identifiers.insert(key.into(), value);
            }
            Ok(())
        }
    }

    pub fn are_parts_equal(a: &[Box<[u8]>], b: &[Box<[u8]>]) -> bool {
        if a.len() != b.len() {
            return false;
        }
        for i in 0..a.len() {
            if !strings::eql(&a[i], &b[i]) {
                return false;
            }
        }
        true
    }
}
pub use defines::{Define, DefineData};

pub mod defines_full_draft {
    use bstr::BStr;
    use bun_collections::{ArrayHashMap, StringHashMap, VecExt};
    use bun_logger as logger;
    use bun_string::strings;

    use crate::ast::base::Ref;
    use crate::ast::e as E;
    use crate::ast::expr;
    use crate::ast::g as G;
    use crate::ast::StoreRef;
    use crate::lexer as js_lexer;

    // Zig: `bun.StringArrayHashMap(string)` / `bun.StringHashMap(DefineData)`
    pub type RawDefines = ArrayHashMap<Box<[u8]>, Box<[u8]>>;
    pub type UserDefines = StringHashMap<DefineData>;
    pub type UserDefinesArray = ArrayHashMap<Box<[u8]>, DefineData>;

    pub type IdentifierDefine = DefineData;

    #[derive(Clone)]
    pub struct DotDefine {
        // Zig stored borrowed `[][]const u8` into the user-define key strings;
        // the Rust port owns the part bytes (small, allocated once at startup)
        // so the `RawDefines` map can be dropped after `Define::init`.
        pub parts: Vec<Box<[u8]>>,
        pub data: DefineData,
    }

    bitflags::bitflags! {
        // Zig: `packed struct(u8) { _padding: u3, valueless, can_be_removed_if_unused,
        //        call_can_be_unwrapped_if_unused: E.CallUnwrap (u2), method_call_must_be_replaced_with_undefined }`
        // Packed LSB-first → bit positions below match the Zig layout exactly.
        #[derive(Copy, Clone, Default)]
        pub struct DefineDataFlags: u8 {
            const VALUELESS                                  = 1 << 3;
            const CAN_BE_REMOVED_IF_UNUSED                   = 1 << 4;
            // bits 5..7 hold `E::CallUnwrap` (2 bits) — read via accessor below.
            const METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED = 1 << 7;
        }
    }
    const CALL_UNWRAP_SHIFT: u8 = 5;
    const CALL_UNWRAP_MASK: u8 = 0b11 << CALL_UNWRAP_SHIFT;

    #[derive(Clone)]
    pub struct DefineData {
        pub value: expr::Data,
        // Zig stored `original_name_ptr: ?[*]const u8` + `original_name_len: u32`
        // borrowing into caller-owned strings (defines.zig:24-25 — the 48→40-byte
        // packing trick). The Rust port owns the `RawDefines` value bytes
        // (`Box<[u8]>`), so borrowing would be a use-after-free once the
        // `RawDefines` map is dropped after `Define::init`. Own the bytes here
        // instead — these are tiny startup-time copies.
        pub original_name: Option<Box<[u8]>>,
        pub flags: DefineDataFlags,
    }

    impl Default for DefineData {
        fn default() -> Self {
            Self {
                value: expr::Data::EUndefined(E::Undefined {}),
                original_name: None,
                flags: DefineDataFlags::empty(),
            }
        }
    }

    impl DefineData {
        #[inline]
        pub fn original_name(&self) -> Option<&[u8]> {
            match &self.original_name {
                Some(name) if !name.is_empty() => Some(name.as_ref()),
                _ => None,
            }
        }

        /// True if accessing this value is known to not have any side effects. For
        /// example, a bare reference to "Object.create" can be removed because it
        /// does not have any observable side effects.
        #[inline]
        pub fn can_be_removed_if_unused(&self) -> bool {
            self.flags.contains(DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED)
        }

        /// True if a call to this value is known to not have any side effects. For
        /// example, a bare call to "Object()" can be removed because it does not
        /// have any observable side effects.
        #[inline]
        pub fn call_can_be_unwrapped_if_unused(&self) -> E::CallUnwrap {
            // 2-bit field; explicit match keeps bit-pattern 3 sound.
            match (self.flags.bits() & CALL_UNWRAP_MASK) >> CALL_UNWRAP_SHIFT {
                0 => E::CallUnwrap::Never,
                1 => E::CallUnwrap::IfUnused,
                2 => E::CallUnwrap::IfUnusedAndToStringSafe,
                _ => E::CallUnwrap::Never,
            }
        }

        #[inline]
        pub fn method_call_must_be_replaced_with_undefined(&self) -> bool {
            self.flags.contains(DefineDataFlags::METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED)
        }

        #[inline]
        pub fn valueless(&self) -> bool {
            self.flags.contains(DefineDataFlags::VALUELESS)
        }

        pub fn init_boolean(value: bool) -> DefineData {
            DefineData {
                value: expr::Data::EBoolean(E::Boolean { value }),
                flags: DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED,
                ..Default::default()
            }
        }

        pub fn init_static_string(str_: &'static E::String) -> DefineData {
            DefineData {
                // Zig `@constCast` — Expr.Data stores StoreRef (NonNull); the static is never mutated.
                value: expr::Data::EString(StoreRef::from_static(str_)),
                flags: DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED,
                ..Default::default()
            }
        }

        pub fn merge(a: &DefineData, b: &DefineData) -> DefineData {
            let mut flags = DefineDataFlags::empty();
            if a.can_be_removed_if_unused() {
                flags |= DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED;
            }
            flags = DefineDataFlags::from_bits_retain(
                flags.bits() | ((a.call_can_be_unwrapped_if_unused() as u8) << CALL_UNWRAP_SHIFT),
            );
            // TODO: investigate if this is correct. This is what it was before. But that looks strange.
            if a.method_call_must_be_replaced_with_undefined()
                || b.method_call_must_be_replaced_with_undefined()
            {
                flags |= DefineDataFlags::VALUELESS;
                flags |= DefineDataFlags::METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED;
            }
            DefineData {
                value: b.value.clone(),
                flags,
                original_name: b.original_name.clone(),
            }
        }

        pub fn parse(
            key: &[u8],
            value_str: &[u8],
            value_is_undefined: bool,
            method_call_must_be_replaced_with_undefined: bool,
            log: &mut logger::Log,
            bump: &bun_alloc::Arena,
        ) -> core::result::Result<DefineData, bun_core::Error> {
            for part in key.split(|&c| c == b'.') {
                if !js_lexer::is_identifier(part) {
                    if strings::eql(part, key) {
                        log.add_error_fmt(
                            None,
                            logger::Loc::default(),
                            format_args!("define key \"{}\" must be a valid identifier", BStr::new(key)),
                        )?;
                    } else {
                        log.add_error_fmt(
                            None,
                            logger::Loc::default(),
                            format_args!(
                                "define key \"{}\" contains invalid identifier \"{}\"",
                                BStr::new(part),
                                BStr::new(value_str)
                            ),
                        )?;
                    }
                    break;
                }
            }

            // check for nested identifiers
            let mut is_ident = true;
            for part in value_str.split(|&c| c == b'.') {
                if !js_lexer::is_identifier(part) || js_lexer::keyword(part).is_some() {
                    is_ident = false;
                    break;
                }
            }

            let mut flags = DefineDataFlags::empty();
            if value_is_undefined {
                flags |= DefineDataFlags::VALUELESS;
            }
            if method_call_must_be_replaced_with_undefined {
                flags |= DefineDataFlags::METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED;
            }

            if is_ident {
                // Special-case undefined. it's not an identifier here
                // https://github.com/evanw/esbuild/issues/1407
                let value = if value_is_undefined || value_str == b"undefined" {
                    expr::Data::EUndefined(E::Undefined {})
                } else {
                    expr::Data::EIdentifier(
                        E::Identifier::init(Ref::NONE).with_can_be_removed_if_unused(true),
                    )
                };
                flags |= DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED;
                return Ok(DefineData {
                    value,
                    original_name: if value_str.is_empty() { None } else { Some(Box::<[u8]>::from(value_str)) },
                    flags,
                });
            }

            // Value is JSON — round-trip through the env-JSON parser.
            let source = logger::Source {
                contents: std::borrow::Cow::Owned(value_str.to_vec()),
                path: logger::fs::Path::init_with_namespace(b"defines.json", b"internal"),
                ..Default::default()
            };
            // TODO(b0-genuine): same-tier T4 dep on bun_interchange::json — direct call.
            let expr = bun_interchange::json::parse_env_json(&source, log, bump)?;
            // Zig: `expr.data.deepClone(arena)` followed by `expr.isPrimitiveLiteral()`.
            // The JSON parser returns the cycle-broken `bun_logger::js_ast::Expr`
            // subset; convert into the full `expr::Data` here (re-allocating
            // payloads in `bump` — this *is* the deep clone).
            let cloned = json_data_to_expr_data(expr.data, bump)?;
            if json_data_is_primitive_literal(expr.data) {
                flags |= DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED;
            }
            Ok(DefineData {
                value: cloned,
                original_name: if value_str.is_empty() { None } else { Some(Box::<[u8]>::from(value_str)) },
                flags,
            })
        }
    }

    /// Zig: `Expr.isPrimitiveLiteral` — restricted to the JSON-value subset.
    fn json_data_is_primitive_literal(data: bun_logger::js_ast::expr::Data) -> bool {
        use bun_logger::js_ast::expr::Data as J;
        matches!(
            data,
            J::ENull(_) | J::EUndefined(_) | J::EString(_) | J::EBoolean(_) | J::ENumber(_)
        )
    }

    /// Zig: `Expr.Data.deepClone` — restricted to the JSON-value subset, mapping
    /// the cycle-broken `bun_logger::js_ast` payloads onto the full parser
    /// `expr::Data`. Recurses through arrays/objects.
    pub fn json_data_to_expr_data(
        data: bun_logger::js_ast::expr::Data,
        bump: &bun_alloc::Arena,
    ) -> core::result::Result<expr::Data, bun_core::Error> {
        use bun_logger::js_ast::expr::Data as J;
        Ok(match data {
            J::EBoolean(b) => expr::Data::EBoolean(E::Boolean { value: b.value }),
            J::ENumber(n) => expr::Data::ENumber(E::Number { value: n.value }),
            J::ENull(_) => expr::Data::ENull(E::Null {}),
            J::EUndefined(_) => expr::Data::EUndefined(E::Undefined {}),
            J::EMissing(_) => expr::Data::EMissing(E::Missing {}),
            J::EString(s) => {
                let src = s.get();
                let item = bump.alloc(E::String {
                    data: src.data.into(),
                    is_utf16: src.is_utf16,
                    ..Default::default()
                });
                expr::Data::EString(StoreRef::from_bump(item))
            }
            J::EArray(a) => {
                let src = a.get();
                let mut items =
                    Vec::<expr::Expr>::init_capacity(src.items.len_u32() as usize)?;
                for it in src.items.slice() {
                    VecExt::append(&mut items, expr::Expr {
                        loc: it.loc,
                        data: json_data_to_expr_data(it.data, bump)?,
                    })?;
                }
                let item = bump.alloc(E::Array {
                    items,
                    comma_after_spread: src.comma_after_spread,
                    is_single_line: src.is_single_line,
                    is_parenthesized: src.is_parenthesized,
                    was_originally_macro: src.was_originally_macro,
                    close_bracket_loc: src.close_bracket_loc,
                });
                expr::Data::EArray(StoreRef::from_bump(item))
            }
            J::EObject(o) => {
                let src = o.get();
                let mut properties = Vec::<G::Property>::init_capacity(
                    src.properties.len_u32() as usize,
                )?;
                for prop in src.properties.slice() {
                    let key = match &prop.key {
                        Some(k) => Some(expr::Expr {
                            loc: k.loc,
                            data: json_data_to_expr_data(k.data, bump)?,
                        }),
                        None => None,
                    };
                    let value = match &prop.value {
                        Some(v) => Some(expr::Expr {
                            loc: v.loc,
                            data: json_data_to_expr_data(v.data, bump)?,
                        }),
                        None => None,
                    };
                    properties.push(G::Property { key, value, ..Default::default() });
                }
                let item = bump.alloc(E::Object {
                    properties,
                    comma_after_spread: src.comma_after_spread,
                    is_single_line: src.is_single_line,
                    is_parenthesized: src.is_parenthesized,
                    was_originally_macro: src.was_originally_macro,
                    close_brace_loc: src.close_brace_loc,
                });
                expr::Data::EObject(StoreRef::from_bump(item))
            }
        })
    }

    pub struct Define {
        pub identifiers: StringHashMap<IdentifierDefine>,
        pub dots: StringHashMap<Vec<DotDefine>>,
        pub drop_debugger: bool,
    }

    impl Define {
        // Zig: `pub const Data = DefineData;` — Rust callers import `DefineData` directly.

        pub fn for_identifier(&self, name: &[u8]) -> Option<&IdentifierDefine> {
            if let Some(data) = self.identifiers.get(name) {
                return Some(data);
            }
            // Draft module — pure-global table is wired into the canonical
            // `crate::defines::Define` (this draft type is unused).
            None
        }

        pub fn insert(
            &mut self,
            bump: &bun_alloc::Arena,
            key: &[u8],
            value: DefineData,
        ) -> core::result::Result<(), bun_alloc::AllocError> {
            let _ = bump;
            // If it has a dot, then it's a DotDefine.
            // e.g. process.env.NODE_ENV
            if let Some(last_dot) = strings::last_index_of_char(key, b'.') {
                let tail = &key[last_dot + 1..];
                let remainder = &key[..last_dot];
                let count = remainder.iter().filter(|&&c| c == b'.').count() + 1;
                // Zig allocated `[][]const u8` borrowing the input key; the Rust
                // port owns the part bytes (tiny startup-time copies) so the
                // caller can drop `key` after `Define::init`.
                let mut parts: Vec<Box<[u8]>> = Vec::with_capacity(count + 1);
                for split in remainder.split(|&c| c == b'.') {
                    parts.push(Box::from(split));
                }
                parts.push(Box::from(tail));

                // "NODE_ENV"
                let entry = self.dots.entry(tail.into()).or_default();
                for part in entry.iter_mut() {
                    // ["process", "env"] === ["process", "env"]
                    if are_parts_equal(&part.parts, &parts) {
                        part.data = DefineData::merge(&part.data, &value);
                        return Ok(());
                    }
                }
                entry.push(DotDefine { data: value, parts });
            } else {
                // e.g. IS_BROWSER
                self.identifiers.insert(key.into(), value);
            }
            Ok(())
        }

        pub fn init(
            user_defines: Option<UserDefines>,
            string_defines: Option<UserDefinesArray>,
            drop_debugger: bool,
            omit_unused_global_calls: bool,
            bump: &bun_alloc::Arena,
        ) -> core::result::Result<Box<Define>, bun_alloc::AllocError> {
            let _ = omit_unused_global_calls;
            let mut define = Box::new(Define {
                identifiers: StringHashMap::default(),
                dots: StringHashMap::default(),
                drop_debugger,
            });
            // TODO(port): Step 1/2 — load global_no_side_effect_* tables from
            // bun_bundler::defines_table once that table moves down. Omitting
            // here is safe-ish: only affects pure-annotation tree shaking.

            // Step 3. Load user data into hash tables
            // (Zig: `iter.next()` over `StringHashMap` — consume the inner map.)
            if let Some(mut user_defines) = user_defines {
                for (k, v) in core::mem::take(&mut *user_defines).into_iter() {
                    define.insert(bump, &k, v)?;
                }
            }
            // Step 4. Load environment data into hash tables.
            // (Zig: `it.next()` over `StringArrayHashMap` — `ArrayHashMap` has
            // no `IntoIterator`; walk insertion-order entries.)
            if let Some(mut string_defines) = string_defines {
                let mut it = string_defines.iterator();
                while let Some(entry) = it.next() {
                    define.insert(bump, &**entry.key_ptr, entry.value_ptr.clone())?;
                }
            }
            Ok(define)
        }
    }

    fn are_parts_equal(a: &[Box<[u8]>], b: &[Box<[u8]>]) -> bool {
        if a.len() != b.len() {
            return false;
        }
        for i in 0..a.len() {
            if !strings::eql(&a[i], &b[i]) {
                return false;
            }
        }
        true
    }
}

// ─── from bun_js_printer::renamer (src/js_printer/renamer.zig) ──────────────
// Only the slot-assignment helpers the parser calls (`P.rs:6658`) live here;
// the full `NumberRenamer`/`MinifyRenamer` machinery stays in `bun_js_printer`
// (it depends on the printer's name-buffer and reserved-names tables).
pub mod renamer {
    use bun_collections::VecExt;
    use crate::ast::base::Ref;
    use crate::ast::scope::Scope;
    use crate::ast::symbol::{self, Symbol, SlotNamespace, INVALID_NESTED_SCOPE_SLOT};
    use crate::SlotCounts;

    // Round-C alias kept for P.rs/Parser.rs callers.
    pub type SymbolMap = crate::ast::symbol::Map;

    pub fn assign_nested_scope_slots(
        _arena: &bun_alloc::Arena,
        module_scope: &mut Scope,
        symbols: &mut [Symbol],
    ) -> SlotCounts {
        let mut slot_counts = SlotCounts::default();
        let mut sorted_members: Vec<u32> = Vec::new();

        // Temporarily set the nested scope slots of top-level symbols to valid so
        // they aren't renamed in nested scopes. This prevents us from accidentally
        // assigning nested scope slots to variables declared using "var" in a nested
        // scope that are actually hoisted up to the module scope to become a top-
        // level symbol.
        const VALID_SLOT: u32 = 0;
        for member in module_scope.members.values() {
            symbols[member.ref_.inner_index() as usize].nested_scope_slot = VALID_SLOT;
        }
        for ref_ in module_scope.generated.slice() {
            symbols[ref_.inner_index() as usize].nested_scope_slot = VALID_SLOT;
        }

        for child in module_scope.children.slice() {
            // SAFETY: child scopes are arena-allocated and live for the parse.
            let child = unsafe { &mut *child.as_ptr() };
            slot_counts.union_max(assign_nested_scope_slots_helper(
                &mut sorted_members,
                child,
                symbols,
                SlotCounts::default(),
            ));
        }

        // Then set the nested scope slots of top-level symbols back to zero. Top-
        // level symbols are not supposed to have nested scope slots.
        for member in module_scope.members.values() {
            symbols[member.ref_.inner_index() as usize].nested_scope_slot = INVALID_NESTED_SCOPE_SLOT;
        }
        for ref_ in module_scope.generated.slice() {
            symbols[ref_.inner_index() as usize].nested_scope_slot = INVALID_NESTED_SCOPE_SLOT;
        }

        slot_counts
    }

    pub fn assign_nested_scope_slots_helper(
        sorted_members: &mut Vec<u32>,
        scope: &mut Scope,
        symbols: &mut [Symbol],
        slot_to_copy: SlotCounts,
    ) -> SlotCounts {
        let mut slot = slot_to_copy;

        // Sort member map keys for determinism
        {
            sorted_members.clear();
            sorted_members.reserve(scope.members.len());
            for member in scope.members.values() {
                sorted_members.push(member.ref_.inner_index());
            }
            sorted_members.sort_unstable();

            // Assign slots for this scope's symbols. Only do this if the slot is
            // not already assigned. Nested scopes have copies of symbols from parent
            // scopes and we want to use the slot from the parent scope, not child scopes.
            for &inner_index in sorted_members.iter() {
                let symbol = &mut symbols[inner_index as usize];
                let ns = symbol.slot_namespace();
                if ns != SlotNamespace::MustNotBeRenamed && symbol.nested_scope_slot().is_none() {
                    symbol.nested_scope_slot = slot.slots[ns];
                    slot.slots[ns] += 1;
                }
            }
        }

        for ref_ in scope.generated.slice() {
            let symbol = &mut symbols[ref_.inner_index() as usize];
            let ns = symbol.slot_namespace();
            if ns != SlotNamespace::MustNotBeRenamed && symbol.nested_scope_slot().is_none() {
                symbol.nested_scope_slot = slot.slots[ns];
                slot.slots[ns] += 1;
            }
        }

        // Labels are always declared in a nested scope, so we don't need to check.
        if let Some(ref_) = scope.label_ref {
            let symbol = &mut symbols[ref_.inner_index() as usize];
            let ns = SlotNamespace::Label;
            symbol.nested_scope_slot = slot.slots[ns];
            slot.slots[ns] += 1;
        }

        // Assign slots for the symbols of child scopes
        let mut slot_counts = slot.clone();
        for child in scope.children.slice() {
            // SAFETY: child scopes are arena-allocated and live for the parse.
            let child = unsafe { &mut *child.as_ptr() };
            slot_counts.union_max(assign_nested_scope_slots_helper(
                sorted_members,
                child,
                symbols,
                slot.clone(),
            ));
        }

        slot_counts
    }

    #[derive(Copy, Clone)]
    pub struct StableSymbolCount {
        pub stable_source_index: u32,
        pub ref_: Ref,
        pub count: u32,
    }

    pub type StableSymbolCountArray = Vec<StableSymbolCount>;

    impl StableSymbolCount {
        pub fn less_than(i: &StableSymbolCount, j: &StableSymbolCount) -> bool {
            if i.count > j.count { return true; }
            if i.count < j.count { return false; }
            if i.stable_source_index < j.stable_source_index { return true; }
            if i.stable_source_index > j.stable_source_index { return false; }
            i.ref_.inner_index() < j.ref_.inner_index()
        }
    }

    // Zig: `js_parser.renamer` re-exports the printer module wholesale; the
    // remaining types (`NoOpRenamer`, `NumberRenamer`, `MinifyRenamer`,
    // `SymbolSlot`, `Renamer` union) are only consumed by the printer and
    // bundler — they stay in `bun_js_printer` and import the helpers above.
    // TODO(port): if Phase B shows another js_parser caller, hoist further.
    #[allow(unused_imports)]
    use symbol as _;
}

// ported from: src/js_parser/js_parser.zig

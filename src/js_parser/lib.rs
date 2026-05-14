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

pub use bun_collections::VecExt as _VecExtReexport;

// ─── module layout (see docs/REFACTOR_BUN_AST.md) ───────────────────────────
pub mod parser;
// Re-export parser-helper types at crate root so p.rs can `use crate::{...}`.
pub use parser::*;
pub mod lexer;

pub mod fold;
pub mod lower;
pub mod p;
pub mod parse;
pub mod repl_transforms;
pub mod scan;
pub mod typescript;
pub mod visit;

pub use p::P;
pub use parse::parse_entry::{Options as ParserOptions, Parser};

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
            Self {
                javascript_object: MacroJSCtx::ZERO,
                data: core::ptr::null_mut(),
            }
        }
    }
    unsafe extern "Rust" {
        /// Defined `#[no_mangle]` in `bun_js_parser_jsc::Macro`. `transpiler`
        /// is `*mut bun_bundler::Transpiler<'_>` — erased because this crate
        /// cannot name it (dep-cycle).
        // NOT `safe fn`: callee derefs `transpiler` as `&mut Transpiler<'_>` —
        // caller must guarantee it is non-null, exclusively borrowed, and of
        // that exact concrete type.
        fn __bun_macro_context_init(transpiler: *mut core::ffi::c_void) -> MacroContext;
        // NOT `safe fn`: when non-null, `data` must be the exact `Box::into_raw`
        // value produced by `__bun_macro_context_init` and uniquely owned
        // (callee `Box::from_raw`s it → double-free / aliasing UB otherwise).
        fn __bun_macro_context_deinit(data: *mut core::ffi::c_void);
        // All args are safe Rust-ABI types (refs/slices/by-value); the only
        // raw pointer involved is `ctx.data`, which is a struct invariant
        // maintained by `init`/`Default` — not a caller precondition. The
        // `#[no_mangle]` body in `bun_js_parser_jsc` is itself a safe `pub fn`.
        safe fn __bun_macro_context_call(
            ctx: &mut MacroContext,
            import_record_path: &[u8],
            source_dir: &[u8],
            log: &mut bun_ast::Log,
            source: &bun_ast::Source,
            import_range: bun_ast::Range,
            caller: bun_ast::Expr,
            function_name: &[u8],
        ) -> Result<bun_ast::Expr, bun_core::Error>;
        // NOT `safe fn`: callee derefs `data` unconditionally as
        // `&MacroContext` — caller must guarantee non-null + produced by
        // `__bun_macro_context_init` + the backing `Transpiler.options` table
        // outlives the returned `'static` borrow.
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
            log: &mut bun_ast::Log,
            source: &bun_ast::Source,
            import_range: bun_ast::Range,
            caller: bun_ast::Expr,
            function_name: &[u8],
        ) -> Result<bun_ast::Expr, bun_core::Error> {
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
        /// Zig: `pub fn init(transpiler: *Transpiler) MacroContext`.
        ///
        /// `T` is always `bun_bundler::Transpiler<'_>`; generic so callers in
        /// `bun_bundler`/`bun_runtime` compile without `bun_js_parser` taking
        /// an upward dep on the bundler. The `_jsc` crate reads the concrete
        /// type back inside `__bun_macro_context_init`.
        #[inline]
        pub fn init<T>(transpiler: &mut T) -> Self {
            // SAFETY: `transpiler` is a live `&mut T` (exclusive, non-null,
            // aligned) for the duration of the call; the callee casts it back to
            // `&mut Transpiler<'_>` and only reads/borrows fields — it does not
            // retain the pointer past return (the boxed state it allocates owns
            // its own data).
            unsafe { __bun_macro_context_init(transpiler as *mut T as *mut core::ffi::c_void) }
        }
        /// Free the boxed higher-tier state behind `data`. Only call when the
        /// owning `Transpiler` is a short-lived bytewise clone (e.g. the
        /// off-thread `RuntimeTranspilerStore` worker) — the long-lived
        /// `vm.transpiler` instance leaks it intentionally (process-lifetime).
        #[inline]
        pub fn deinit(self) {
            // SAFETY: `self.data` is either null (callee no-ops) or the exact
            // `Box::into_raw` produced by `__bun_macro_context_init`; `self` is
            // taken by value so this is the unique owner and no double-free is
            // possible.
            unsafe { __bun_macro_context_deinit(self.data) }
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
            // SAFETY: `self.data` is non-null (checked above) and was produced by
            // `__bun_macro_context_init`, so it points at a live `Macro::Data`
            // whose remap table the callee borrows. The table is owned by
            // `Transpiler.options` (process-lifetime), justifying the `'static`
            // return.
            unsafe { __bun_macro_context_get_remap(self.data, path) }
        }
    }

    /// Zig: `MacroImportReplacementMap` — `bun.StringArrayHashMap([]const u8)`.
    /// Values are owned (`Box<[u8]>`) so callers can populate without `unsafe`
    /// lifetime-extension casts; matches `bun_resolver::package_json::MacroImportReplacementMap`.
    pub type MacroRemapEntry = bun_collections::StringArrayHashMap<Box<[u8]>>;
}
use bun_ast::{Ast, Ref};

// NOTE: shadows the prelude `Result` for this module — all error-union return
// types in this file are spelled `core::result::Result<T, E>` to disambiguate.
//
// PERF NOTE: `bun_ast::Ast` is ~1 KB (40+ fields incl. Scope, NamedImports,
// NamedExports, CharFreq, several HashMaps). Storing it inline made this enum
// ~1 KB and forced a ~1 KB memmove at every layer of the return chain
// `P::to_ast → _parse → parse → cache::JavaScript::parse → Transpiler::parse_*`
// (Zig sidesteps this via result-location semantics; Rust does not). Boxing the
// `Ast` variant collapses `Result` to 16 B so only a thin pointer is moved up
// the stack — one mimalloc-arena alloc per parsed module is far cheaper than
// 4+ kilobyte memmoves. The other variants are already tiny.
pub enum Result {
    AlreadyBundled(AlreadyBundled),
    Cached,
    Ast(Box<Ast>),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AlreadyBundled {
    Bun,
    BunCjs,
    Bytecode,
    BytecodeCjs,
}

pub type BindingList = Vec<Binding>;

/// `impl EqlParser for P` — moved out of `bun_ast::expr` (next to `P`).
impl<'a, const IS_TS: bool, const SCAN: bool> bun_ast::expr::EqlParser
    for crate::p::P<'a, IS_TS, SCAN>
{
    #[inline]
    fn arena(&self) -> &bun_alloc::Arena {
        self.arena
    }
    #[inline]
    fn module_ref(&self) -> Ref {
        self.module_ref
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
    use bun_core::strings;

    use bun_ast::E;
    use bun_ast::StoreRef;
    use bun_ast::expr::Data as ExprData;

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
            self.0 =
                (self.0 & !(1 << Self::VALUELESS_SHIFT)) | ((v as u8) << Self::VALUELESS_SHIFT);
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
            self.0 = (self.0 & !Self::CALL_UNWRAP_MASK)
                | (((v as u8) & 0b11) << Self::CALL_UNWRAP_SHIFT);
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
            DefineData {
                value: ExprData::EBoolean(E::Boolean { value }),
                flags,
                ..Default::default()
            }
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
            crate::defines_table::lookup_pure_global_identifier(name).map(|v| v.value())
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
                self.dots.put_assume_capacity(tail, list);
            } else {
                // e.g. IS_BROWSER
                self.identifiers.put_assume_capacity(key, value);
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
    use bun_collections::{ArrayHashMap, StringHashMap};
    use bun_core::strings;

    use bun_ast::base::Ref;
    use bun_ast::e as E;
    use bun_ast::expr;

    use crate::lexer as js_lexer;
    use bun_ast::StoreRef;

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
            self.flags
                .contains(DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED)
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
            self.flags
                .contains(DefineDataFlags::METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED)
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

        // REFACTOR_BUN_AST: `bun_js_parser` is a sibling of `bun_parsers`, so the
        // JSON-value branch takes a parser callback (the bundler passes
        // `bun_parsers::json::parse_env_json`). With the unified `Expr` type,
        // the result is the same `bun_ast::Expr` the rest of the parser uses —
        // the former `json_data_to_expr_data` lift is gone.
        pub fn parse(
            key: &[u8],
            value_str: &[u8],
            value_is_undefined: bool,
            method_call_must_be_replaced_with_undefined: bool,
            log: &mut bun_ast::Log,
            bump: &bun_alloc::Arena,
            parse_json: &dyn Fn(
                &bun_ast::Source,
                &mut bun_ast::Log,
                &bun_alloc::Arena,
            )
                -> core::result::Result<bun_ast::Expr, bun_core::Error>,
        ) -> core::result::Result<DefineData, bun_core::Error> {
            for part in key.split(|&c| c == b'.') {
                if !js_lexer::is_identifier(part) {
                    if strings::eql(part, key) {
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::default(),
                            format_args!(
                                "define key \"{}\" must be a valid identifier",
                                BStr::new(key)
                            ),
                        );
                    } else {
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::default(),
                            format_args!(
                                "define key \"{}\" contains invalid identifier \"{}\"",
                                BStr::new(part),
                                BStr::new(value_str)
                            ),
                        );
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
                    original_name: if value_str.is_empty() {
                        None
                    } else {
                        Some(Box::<[u8]>::from(value_str))
                    },
                    flags,
                });
            }

            // Value is JSON — round-trip through the env-JSON parser.
            let source = bun_ast::Source {
                contents: std::borrow::Cow::Owned(value_str.to_vec()),
                path: bun_paths::fs::Path::init_with_namespace(b"defines.json", b"internal"),
                ..Default::default()
            };
            let expr = parse_json(&source, log, bump)?;
            // Zig: `expr.data.deepClone(arena)` followed by `expr.isPrimitiveLiteral()`.
            // With one `Expr` type the parser result is already in the target
            // shape; `deep_clone` re-roots payloads in `bump`.
            let cloned = expr.data.deep_clone(bump)?;
            if expr.is_primitive_literal() {
                flags |= DefineDataFlags::CAN_BE_REMOVED_IF_UNUSED;
            }
            Ok(DefineData {
                value: cloned,
                original_name: if value_str.is_empty() {
                    None
                } else {
                    Some(Box::<[u8]>::from(value_str))
                },
                flags,
            })
        }
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
                let entry = self.dots.get_or_put(tail).unwrap().value_ptr;
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
                self.identifiers.put_assume_capacity(key, value);
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
    use bun_ast::SlotCounts;
    use bun_ast::base::Ref;
    use bun_ast::scope::Scope;
    use bun_ast::symbol::{self, INVALID_NESTED_SCOPE_SLOT, SlotNamespace, Symbol};
    use bun_collections::VecExt;

    // Round-C alias kept for P.rs/Parser.rs callers.
    pub type SymbolMap = bun_ast::symbol::Map;

    pub fn assign_nested_scope_slots(
        _arena: &bun_alloc::Arena,
        module_scope: &Scope,
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
            // `StoreRef<Scope>: Deref<Target = Scope>` — safe arena-backed deref.
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
            symbols[member.ref_.inner_index() as usize].nested_scope_slot =
                INVALID_NESTED_SCOPE_SLOT;
        }
        for ref_ in module_scope.generated.slice() {
            symbols[ref_.inner_index() as usize].nested_scope_slot = INVALID_NESTED_SCOPE_SLOT;
        }

        slot_counts
    }

    pub fn assign_nested_scope_slots_helper(
        sorted_members: &mut Vec<u32>,
        scope: &Scope,
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
            // `StoreRef<Scope>: Deref<Target = Scope>` — safe arena-backed deref.
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
            if i.count > j.count {
                return true;
            }
            if i.count < j.count {
                return false;
            }
            if i.stable_source_index < j.stable_source_index {
                return true;
            }
            if i.stable_source_index > j.stable_source_index {
                return false;
            }
            i.ref_.inner_index() < j.ref_.inner_index()
        }
    }

    // The remaining renamer types are only consumed by the printer and bundler
    // — they live in `bun_js_printer`.
    #[allow(unused_imports)]
    use symbol as _;
}

// ported from: src/js_parser/js_parser.zig

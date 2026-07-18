//! NOTE on arena slices: this is the AST crate. Nearly every slice-typed
//! struct field points into either the source text or the
//! parser arena and is bulk-freed at end-of-parse. Per PORTING.md, lifetime
//! params are not added to AST structs; arena-owned slices are typed as
//! `StoreSlice<T>` / `StoreStr` here. A future refactor could thread a
//! crate-wide `'bump` and rewrite these to `&'bump [T]` / `&'bump mut [T]`.

// `lexer::NewLexer<J: JsonOptionsT>` projects trait associated consts into
// eight `const bool` slots. Field
// access on a `const J: JSONOptions` param is rejected by nightly-2025-12-10
// ("overly complex generic constant"); assoc-const projection on a *type*
// param works under `generic_const_exprs`. `adt_const_params` keeps
// `JSONOptions: ConstParamTy` for value-level reification.
// (crate-level `#![feature(...)]` lives in `src/js/lib.rs` after the mount.)

pub use bun_core::collections::VecExt as _VecExtReexport;

pub mod error;
pub use error::Error;
pub use error::Result as CrateResult;

// ─── module layout (see docs/REFACTOR_BUN_AST.md) ───────────────────────────
pub mod parser;
// Re-export parser-helper types at crate root so p.rs can `use crate::{...}`.
pub use parser::*;
pub mod lexer;

pub mod fold;
pub mod lower;
pub mod p;
pub mod parse;
pub mod react_compiler_host;
pub mod repl_transforms;
pub mod scan;
pub mod typescript;
pub mod visit;

pub use p::P;
pub use parse::parse_entry::{Options as ParserOptions, Parser};

// Full impl lives in *_jsc; this stub re-exposes the JSC-free constants and a
// placeholder `MacroContext` so lower-tier crates (bundler, transpiler) that
// only need the namespace strings / a context handle stay unblocked.
#[allow(non_snake_case)]
pub mod Macro {
    pub const NAMESPACE: &[u8] = b"macro";
    pub const NAMESPACE_WITH_COLON: &[u8] = b"macro:";

    #[inline]
    pub fn is_macro_path(str_: &[u8]) -> bool {
        str_.starts_with(NAMESPACE_WITH_COLON)
    }

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

    /// Higher-tier macro-runner dispatch. Implemented in `bun_runtime` (moved
    /// from `js_parser_jsc::Macro`); the visit pass reaches it via dynamic
    /// dispatch so `visitExpr.rs` avoids an upward import.
    pub trait MacroRunner {
        #[allow(clippy::too_many_arguments)]
        fn call(
            &mut self,
            javascript_object: MacroJSCtx,
            import_record_path: &[u8],
            source_dir: &[u8],
            log: &mut bun_ast::Log,
            source: &bun_ast::Source,
            import_range: bun_ast::Range,
            caller: bun_ast::Expr,
            function_name: &[u8],
        ) -> core::result::Result<bun_ast::Expr, crate::js_parser::Error>;
        /// Returns `'static` so callers can keep the result across `&mut self`
        /// parser calls; the table lives in `Transpiler.options` which outlives
        /// every parse.
        fn get_remap(&self, path: &[u8]) -> Option<&'static MacroRemapEntry>;
    }

    /// Lower-tier handle for the higher-tier macro-runner state.
    ///
    /// Real fields (`env`, `macros`, `remap`, `resolver`, `bump`) reference
    /// `Transpiler` and JSC types that live in crates which depend on
    /// `bun_js`. To break the dep cycle the higher-tier crate owns that state
    /// behind `runner`. `javascript_object` is surfaced here so
    /// `Transpiler::parse` can thread `this_parse.macro_js_ctx` through
    /// without this crate depending on `bun_jsc::JSValue`.
    #[derive(Default)]
    pub struct MacroContext {
        /// Encoded `JSC.JSValue` (the caller-supplied macro JS context).
        pub javascript_object: MacroJSCtx,
        /// Boxed higher-tier macro-runner state (resolver/env/macros/remap/bump).
        /// `None` ⇒ `call` falls through and `get_remap` returns `None`.
        pub runner: Option<Box<dyn MacroRunner>>,
    }

    /// Sweep this thread's bundler-macro VM so JS-wrapper-owned native boxes
    /// (e.g. a `new Bun.Transpiler()` constructed inside a macro body) are
    /// finalized before the worker thread's TLS root vanishes. Only call from
    /// `bun_bundler::ThreadPool::Worker::deinit` after both per-worker
    /// `MacroContext` boxes are freed — every other `MacroContext` drop path
    /// is either inside JS execution or inside a GC sweep, where re-entering
    /// `run_gc(true)` is unsound.
    #[inline]
    pub fn collect_vm_garbage() {
        crate::collect_vm_garbage();
    }
    impl MacroContext {
        #[inline]
        #[allow(clippy::too_many_arguments)]
        pub fn call(
            &mut self,
            import_record_path: &[u8],
            source_dir: &[u8],
            log: &mut bun_ast::Log,
            source: &bun_ast::Source,
            import_range: bun_ast::Range,
            caller: bun_ast::Expr,
            function_name: &[u8],
        ) -> core::result::Result<bun_ast::Expr, crate::js_parser::Error> {
            match self.runner.as_deref_mut() {
                Some(r) => r.call(
                    self.javascript_object,
                    import_record_path,
                    source_dir,
                    log,
                    source,
                    import_range,
                    caller,
                    function_name,
                ),
                None => Ok(caller),
            }
        }
        /// Drop the boxed higher-tier state behind `runner`. Only call when the
        /// owning `Transpiler` is a short-lived bytewise clone — the long-lived
        /// `vm.transpiler` instance leaks it intentionally (process-lifetime).
        #[inline]
        pub fn deinit(self) {
            drop(self);
        }
        /// Returns `'static` so callers can keep the result across `&mut self`
        /// parser calls without a borrowck conflict; the table lives in
        /// `Transpiler.options` which outlives every parse.
        #[inline]
        pub fn get_remap(&self, path: &[u8]) -> Option<&'static MacroRemapEntry> {
            self.runner.as_deref()?.get_remap(path)
        }
    }

    /// Values are owned (`Box<[u8]>`) so callers can populate without `unsafe`
    /// lifetime-extension casts; matches `bun_resolver::package_json::MacroImportReplacementMap`.
    pub type MacroRemapEntry = bun_core::collections::StringArrayHashMap<Box<[u8]>>;
}
use bun_ast::{Ast, Ref};

// NOTE: shadows the prelude `Result` for this module — all error-union return
// types in this file are spelled `core::result::Result<T, E>` to disambiguate.
//
// PERF NOTE: `bun_ast::Ast` is ~1 KB (40+ fields incl. Scope, NamedImports,
// NamedExports, CharFreq, several HashMaps). Storing it inline made this enum
// ~1 KB and forced a ~1 KB memmove at every layer of the return chain
// `P::to_ast → _parse → parse → cache::JavaScript::parse → Transpiler::parse_*`.
// Boxing the
// `Ast` variant collapses `Result` to 16 B so only a thin pointer is moved up
// the stack — one mimalloc-arena alloc per parsed module is far cheaper than
// 4+ kilobyte memmoves. The other variants are already tiny.
pub enum Result<'a> {
    AlreadyBundled(AlreadyBundled),
    Cached,
    Ast(Box<Ast<'a>>),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AlreadyBundled {
    Bun,
    BunCjs,
    Bytecode,
    BytecodeCjs,
}

/// `impl EqlParser for P` — moved out of `bun_ast::expr` (next to `P`).
impl<'a, const IS_TS: bool, const SCAN: bool> bun_ast::expr::EqlParser
    for crate::p::P<'a, IS_TS, SCAN>
{
    #[inline]
    fn arena(&self) -> &bun_core::alloc_impl::Arena {
        self.arena
    }
    #[inline]
    fn module_ref(&self) -> Ref {
        self.module_ref
    }
}

pub mod defines_table;

// ─── from bun_bundler::defines ───────────────────────────────────────────────
// B-3 UNIFIED: canonical `Define` / `DefineData` / `DotDefine` live here so the
// parser (`P.define: &'a Define`) and the bundler (`BundleOptions.define:
// Box<Define>`) share one nominal type. `bun_bundler::defines` re-exports these
// and layers the json-parse / dotenv `init` on top via an extension trait. The
// pure-global fallback table also lives at this tier (`defines_table`) so
// `for_identifier` reads its own const — no cross-crate hook.
pub mod defines {
    use bun_core::collections::{StringArrayHashMap, StringHashMap};
    use bun_core::strings;

    use bun_ast::E;
    use bun_ast::StoreRef;
    use bun_ast::expr::Data as ExprData;

    pub type RawDefines = StringArrayHashMap<Box<[u8]>>;
    pub type UserDefines = StringHashMap<DefineData>;
    pub type UserDefinesArray = StringArrayHashMap<DefineData>;

    pub type IdentifierDefine = DefineData;

    #[derive(Clone)]
    pub struct DotDefine {
        // Owned part strings (small, allocated once at startup).
        pub parts: Vec<Box<[u8]>>,
        pub data: DefineData,
    }

    /// Bit-packed flags (LSB-first): 3 padding bits, `valueless`,
    /// `can_be_removed_if_unused`, `call_can_be_unwrapped_if_unused`
    /// (`E.CallUnwrap`, 2 bits), `method_call_must_be_replaced_with_undefined`.
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
        // The `RawDefines` value bytes are owned (`Box<[u8]>`), so borrowing
        // would be a use-after-free once the `RawDefines` map is dropped after
        // `Define::init`. Own the bytes here instead — these are tiny
        // startup-time copies.
        // Kept `pub` so the bundler-side `parse`/`from_input` (which live a
        // tier up for json-parser access) can construct directly.
        pub original_name: Option<Box<[u8]>>,
        pub flags: Flags,
    }

    // SAFETY: `ExprData` contains `StoreRef` raw pointers into immutable,
    // process-lifetime AST stores. `DefineData` is only shared across threads
    // via the read-only `Box<Define>` after init. Never written through.
    unsafe impl Send for DefineData {}
    // SAFETY: see `Send` impl above — the `StoreRef` targets are immutable and
    // process-lifetime, and `DefineData` is read-only after init.
    unsafe impl Sync for DefineData {}

    impl Default for DefineData {
        fn default() -> Self {
            Self {
                value: ExprData::EMissing(E::Missing),
                original_name: None,
                flags: Flags::default(),
            }
        }
    }

    /// Named-init shim.
    #[derive(Clone, Copy)]
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
                value: ExprData::EString(StoreRef::from_static(str)),
                flags,
                ..Default::default()
            }
        }

        pub fn merge(a: &DefineData, b: DefineData) -> DefineData {
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

    #[derive(Default)]
    pub struct Define {
        pub identifiers: StringHashMap<IdentifierDefine>,
        pub dots: StringHashMap<Vec<DotDefine>>,
        pub drop_debugger: bool,
    }

    impl Define {
        pub fn for_identifier(&self, name: &[u8]) -> Option<&IdentifierDefine> {
            if let Some(data) = self.identifiers.get(name) {
                return Some(data);
            }
            crate::defines_table::lookup_pure_global_identifier(name).map(|v| v.value())
        }

        pub fn insert_from_iterator<'a, I>(&mut self, iter: I) -> Result<(), bun_core::alloc_impl::AllocError>
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
        ) -> Result<(), bun_core::alloc_impl::AllocError> {
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
                // Note: reshaped for borrowck — getOrPut split into get/insert.
                if let Some(existing) = self.dots.get_mut(tail) {
                    for part in existing.iter_mut() {
                        if are_parts_equal(&part.parts, &parts) {
                            part.data = DefineData::merge(&part.data, value);
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

// ─── from bun_js_printer::renamer ────────────────────────────────────────────
// Only the slot-assignment helpers the parser calls (`P.rs:6658`) live here;
// the full `NumberRenamer`/`MinifyRenamer` machinery stays in `bun_js_printer`
// (it depends on the printer's name-buffer and reserved-names tables).
pub mod renamer {
    use bun_ast::SlotCounts;
    use bun_ast::base::Ref;
    use bun_ast::scope::Scope;
    use bun_ast::symbol::{INVALID_NESTED_SCOPE_SLOT, SlotNamespace, Symbol};
    use bun_core::collections::VecExt;

    pub(crate) fn assign_nested_scope_slots(
        _arena: &bun_core::alloc_impl::Arena,
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

    pub(crate) fn assign_nested_scope_slots_helper(
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
        if let Some(ref_) = scope.label_ref.to_nullable() {
            let symbol = &mut symbols[ref_.inner_index() as usize];
            let ns = SlotNamespace::Label;
            symbol.nested_scope_slot = slot.slots[ns];
            slot.slots[ns] += 1;
        }

        // Assign slots for the symbols of child scopes
        let mut slot_counts = slot;
        for child in scope.children.slice() {
            // `StoreRef<Scope>: Deref<Target = Scope>` — safe arena-backed deref.
            slot_counts.union_max(assign_nested_scope_slots_helper(
                sorted_members,
                child,
                symbols,
                slot,
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
}

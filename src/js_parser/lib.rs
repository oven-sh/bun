//! NOTE on arena slices: this is the AST crate. Nearly every slice-typed
//! struct field points into either the source text or the
//! parser arena and is bulk-freed at end-of-parse. Per PORTING.md, lifetime
//! params are not added to AST structs; arena-owned slices are typed as
//! `StoreSlice<T>` / `StoreStr` here. A future refactor could thread a
//! crate-wide `'bump` and rewrite these to `&'bump [T]` / `&'bump mut [T]`.

pub mod error;
pub mod function_identities;
pub use error::Error;
pub use error::Result as CrateResult;

// ─── module layout (see docs/REFACTOR_BUN_AST.md) ───────────────────────────
pub mod parser;
// Re-export parser-helper types at crate root so p.rs can `use crate::{...}`.
pub use parser::*;
pub mod lexer;

pub(crate) mod fold;
pub mod lower;
pub mod p;
pub mod parse;
pub mod react_compiler_host;
pub(crate) mod repl_transforms;
pub mod scan;
pub mod typescript;
pub mod visit;

pub use lower::import_meta_glob::*;
pub use p::P;
pub use parse::parse_entry::{
    CacheLookup, Options as ParserOptions, ParsedForCache, Parser, TranspilerCache,
};

// The part of macros that needs no JSC. The rest is in `bun_js_parser_jsc::Macro`.
#[allow(non_snake_case)]
pub mod Macro {
    use bun_collections::{ArrayHashMap, StringArrayHashMap};
    use core::cell::RefCell;

    pub const NAMESPACE: &[u8] = b"macro";
    pub const NAMESPACE_WITH_COLON: &[u8] = b"macro:";

    #[inline]
    pub fn is_macro_path(str_: &[u8]) -> bool {
        str_.starts_with(NAMESPACE_WITH_COLON)
    }

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

    #[derive(Clone, Copy)]
    pub enum MacroLoadState {
        /// The load failed or has not finished.
        Disabled,
        Loaded,
    }

    /// Keyed by `MacroEntryPoint::generate_id`. A macro can start a nested parse that uses the same table.
    #[derive(Default)]
    pub struct MacroLoadStates(RefCell<ArrayHashMap<i32, MacroLoadState>>);
    impl MacroLoadStates {
        pub fn get(&self, id: i32) -> Option<MacroLoadState> {
            self.0.borrow().get(&id).copied()
        }

        pub fn set(&self, id: i32, state: MacroLoadState) {
            self.0.borrow_mut().insert(id, state);
        }

        pub fn clear(&self) {
            self.0.borrow_mut().clear();
        }

        pub fn replace(&self, states: Self) -> Self {
            self.0.swap(&states.0);
            states
        }
    }

    #[derive(Clone, Copy)]
    pub struct MacroContext<'a> {
        /// A `bun_bundler::Transpiler`, which this crate cannot name.
        transpiler: *mut (),
        pub macro_load_states: &'a MacroLoadStates,
        /// Encoded `JSC.JSValue` (the caller-supplied macro JS context).
        /// `bun_js_parser_jsc` reinterprets the bits as a `JSValue`.
        pub javascript_object: MacroJSCtx,
    }

    // Defined `#[no_mangle]` in `bun_js_parser_jsc::Macro`.
    unsafe extern "Rust" {
        safe fn __bun_macro_context_call(
            ctx: MacroContext<'_>,
            arena: &bun_alloc::Arena,
            import_record_path: &[u8],
            source_dir: &[u8],
            log: &mut bun_ast::Log,
            source: &bun_ast::Source,
            import_range: bun_ast::Range,
            caller: bun_ast::Expr,
            function_name: &[u8],
        ) -> Result<bun_ast::Expr, crate::Error>;
        // See [`collect_vm_garbage`] for the call-site contract.
        safe fn __bun_macro_collect_vm_garbage();
    }

    /// Sweep this thread's bundler-macro VM so JS-wrapper-owned native boxes
    /// (e.g. a `new Bun.Transpiler()` constructed inside a macro body) are
    /// finalized before the worker thread's TLS root vanishes. Only call from
    /// `bun_bundler::ThreadPool::Worker::drop`, not inside JS execution or a
    /// GC sweep, where re-entering `run_gc(true)` is unsound.
    #[inline]
    pub fn collect_vm_garbage() {
        __bun_macro_collect_vm_garbage();
    }
    impl<'a> MacroContext<'a> {
        /// # Safety
        /// `transpiler` is a `bun_bundler::Transpiler` that is live for `'a`, and nothing else
        /// uses its resolver, or writes to its options, at the time the parser calls a macro.
        pub unsafe fn new(
            transpiler: *mut (),
            macro_load_states: &'a MacroLoadStates,
            javascript_object: MacroJSCtx,
        ) -> Self {
            Self {
                transpiler,
                macro_load_states,
                javascript_object,
            }
        }

        pub fn transpiler(self) -> *mut () {
            self.transpiler
        }

        /// The strings of the result are in `arena`.
        #[inline]
        pub(crate) fn call(
            self,
            arena: &'a bun_alloc::Arena,
            import_record_path: &[u8],
            source_dir: &[u8],
            log: &mut bun_ast::Log,
            source: &bun_ast::Source,
            import_range: bun_ast::Range,
            caller: bun_ast::Expr,
            function_name: &[u8],
        ) -> Result<bun_ast::Expr, crate::Error> {
            __bun_macro_context_call(
                self,
                arena,
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

    /// Matches `bun_resolver::package_json::MacroMap`.
    pub type MacroRemap = StringArrayHashMap<StringArrayHashMap<Box<[u8]>>>;
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
    fn arena(&self) -> &bun_alloc::Arena {
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
    use bun_collections::{StringArrayHashMap, StringHashMap};
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
        pub(crate) const fn valueless(self) -> bool {
            (self.0 >> Self::VALUELESS_SHIFT) & 1 != 0
        }
        #[inline]
        pub(crate) fn set_valueless(&mut self, v: bool) {
            self.0 =
                (self.0 & !(1 << Self::VALUELESS_SHIFT)) | ((v as u8) << Self::VALUELESS_SHIFT);
        }
        #[inline]
        pub(crate) const fn can_be_removed_if_unused(self) -> bool {
            (self.0 >> Self::CAN_BE_REMOVED_SHIFT) & 1 != 0
        }
        #[inline]
        pub(crate) fn set_can_be_removed_if_unused(&mut self, v: bool) {
            self.0 = (self.0 & !(1 << Self::CAN_BE_REMOVED_SHIFT))
                | ((v as u8) << Self::CAN_BE_REMOVED_SHIFT);
        }
        #[inline]
        pub(crate) fn call_can_be_unwrapped_if_unused(self) -> E::CallUnwrap {
            // 2-bit field; `E::CallUnwrap` only has discriminants 0/1/2, so
            // an explicit match keeps bit-pattern 3 sound.
            match (self.0 & Self::CALL_UNWRAP_MASK) >> Self::CALL_UNWRAP_SHIFT {
                1 => E::CallUnwrap::IfUnused,
                2 => E::CallUnwrap::IfUnusedAndToStringSafe,
                _ => E::CallUnwrap::Never,
            }
        }
        #[inline]
        pub(crate) fn set_call_can_be_unwrapped_if_unused(&mut self, v: E::CallUnwrap) {
            self.0 = (self.0 & !Self::CALL_UNWRAP_MASK)
                | (((v as u8) & 0b11) << Self::CALL_UNWRAP_SHIFT);
        }
        #[inline]
        pub(crate) const fn method_call_must_be_replaced_with_undefined(self) -> bool {
            (self.0 >> Self::METHOD_CALL_UNDEF_SHIFT) & 1 != 0
        }
        #[inline]
        pub(crate) fn set_method_call_must_be_replaced_with_undefined(&mut self, v: bool) {
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

    /// Threads share it only through the read-only `Box<Define>`, and the `StoreRef`s in `value` point into immutable, process-lifetime AST stores.
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
        pub(crate) fn original_name(&self) -> Option<&[u8]> {
            match &self.original_name {
                Some(name) if !name.is_empty() => Some(name.as_ref()),
                _ => None,
            }
        }

        /// True if accessing this value is known to not have any side effects.
        #[inline]
        pub(crate) fn can_be_removed_if_unused(&self) -> bool {
            self.flags.can_be_removed_if_unused()
        }
        /// True if a call to this value is known to not have any side effects.
        #[inline]
        pub(crate) fn call_can_be_unwrapped_if_unused(&self) -> E::CallUnwrap {
            self.flags.call_can_be_unwrapped_if_unused()
        }
        #[inline]
        pub(crate) fn method_call_must_be_replaced_with_undefined(&self) -> bool {
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

        pub(crate) fn merge(a: &DefineData, b: DefineData) -> DefineData {
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
        /// Which `DotFilter::bit`s the keys of `dots` set. The visitor asks
        /// about every property access; nearly all miss, and this says so
        /// without hashing the name.
        pub dots_filter: DotFilter,
        pub drop_debugger: bool,
        /// `hash_user_inputs` of this table's inputs, for the runtime transpiler cache key.
        pub user_hash: Option<u64>,
    }

    #[derive(Clone)]
    pub struct DotFilter([u64; 64]);

    impl Default for DotFilter {
        fn default() -> Self {
            DotFilter([0; 64])
        }
    }

    impl DotFilter {
        #[inline]
        fn bit(name: &[u8]) -> usize {
            let (first, last) = match name {
                [] => (0, 0),
                [first, .., last] | [first @ last] => (*first as usize, *last as usize),
            };
            (name.len().wrapping_mul(131) ^ first.wrapping_mul(31) ^ last.wrapping_mul(7)) & 4095
        }

        #[inline]
        pub fn insert(&mut self, name: &[u8]) {
            let bit = Self::bit(name);
            self.0[bit / 64] |= 1 << (bit % 64);
        }

        #[inline]
        pub fn may_contain(&self, name: &[u8]) -> bool {
            let bit = Self::bit(name);
            self.0[bit / 64] & (1 << (bit % 64)) != 0
        }
    }

    impl Define {
        /// A table with only the globals that are known to have no side effects.
        pub fn with_pure_globals(
            drop_debugger: bool,
            omit_unused_global_calls: bool,
        ) -> Box<Define> {
            use crate::defines_table::{
                GLOBAL_NO_SIDE_EFFECT_FUNCTION_CALLS_SAFE_FOR_TO_STRING,
                GLOBAL_NO_SIDE_EFFECT_PROPERTY_ACCESSES,
            };
            let mut define = Box::new(Define {
                drop_debugger,
                ..Default::default()
            });
            define.dots.reserve(124);

            let value_define = DefineData::init(Options {
                value: ExprData::EUndefined(E::Undefined),
                valueless: true,
                can_be_removed_if_unused: true,
                ..Default::default()
            });
            for global in GLOBAL_NO_SIDE_EFFECT_PROPERTY_ACCESSES.iter() {
                define.insert_global(global, &value_define);
            }

            let to_string_safe = DefineData::init(Options {
                value: ExprData::EUndefined(E::Undefined),
                valueless: true,
                can_be_removed_if_unused: true,
                call_can_be_unwrapped_if_unused: E::CallUnwrap::IfUnusedAndToStringSafe,
                ..Default::default()
            });
            let call_define = if omit_unused_global_calls {
                &to_string_safe
            } else {
                &value_define
            };
            for global in GLOBAL_NO_SIDE_EFFECT_FUNCTION_CALLS_SAFE_FOR_TO_STRING.iter() {
                define.insert_global(global, call_define);
            }
            define
        }

        fn insert_global(&mut self, global: &[&[u8]], value_define: &DefineData) {
            let key = global[global.len() - 1];
            let parts: Vec<Box<[u8]>> = global.iter().map(|p| Box::<[u8]>::from(*p)).collect();
            self.dots_filter.insert(key);
            let dot_define = DotDefine {
                parts,
                data: value_define.clone(),
            };
            if let Some(existing) = self.dots.get_mut(key) {
                existing.push(dot_define);
            } else {
                self.dots.put_assume_capacity(key, vec![dot_define]);
            }
        }

        /// The dot defines whose last part is `name` (`NODE_ENV` for
        /// `process.env.NODE_ENV`).
        #[inline]
        pub fn dots_for(&self, name: &[u8]) -> Option<&Vec<DotDefine>> {
            if !self.dots_filter.may_contain(name) {
                return None;
            }
            self.dots.get(name)
        }

        /// Order-independent, length-prefixed hash of the three inputs. `None` when all are empty.
        pub fn hash_user_inputs<'i>(
            defines: impl IntoIterator<Item = (&'i [u8], &'i [u8])>,
            env_defines: impl IntoIterator<Item = (&'i [u8], &'i [u8])>,
            drop: impl IntoIterator<Item = &'i [u8]>,
        ) -> Option<u64> {
            let mut defines: Vec<(&[u8], &[u8])> = defines.into_iter().collect();
            let mut env_defines: Vec<(&[u8], &[u8])> = env_defines.into_iter().collect();
            let mut drop: Vec<&[u8]> = drop.into_iter().filter(|item| !item.is_empty()).collect();
            if defines.is_empty() && env_defines.is_empty() && drop.is_empty() {
                return None;
            }
            defines.sort_unstable();
            env_defines.sort_unstable();
            drop.sort_unstable();
            drop.dedup();

            let mut hasher = bun_wyhash::Wyhash::init(0);
            let mut update = |bytes: &[u8]| {
                hasher.update(&(bytes.len() as u64).to_le_bytes());
                hasher.update(bytes);
            };
            // Separate sections: `init` lets a later env pair override a user pair.
            for pairs in [defines, env_defines] {
                update(&(pairs.len() as u64).to_le_bytes());
                for (key, value) in pairs {
                    update(key);
                    update(value);
                }
            }
            update(&(drop.len() as u64).to_le_bytes());
            for item in drop {
                update(item);
            }
            Some(hasher.final_())
        }

        pub(crate) fn for_identifier(&self, name: &[u8]) -> Option<&IdentifierDefine> {
            if let Some(data) = self.identifiers.get(name) {
                return Some(data);
            }
            crate::defines_table::lookup_pure_global_identifier(name).map(|v| v.value())
        }

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
                let count = strings::count_char(remainder, b'.') + 1;
                let mut parts: Vec<Box<[u8]>> = Vec::with_capacity(count + 1);
                for split in strings::split(remainder, b".") {
                    parts.push(Box::from(split));
                }
                parts.push(Box::from(tail));

                self.dots_filter.insert(tail);
                if let Some(existing) = self.dots.get_mut(tail) {
                    for part in existing.iter_mut() {
                        if are_parts_equal(&part.parts, &parts) {
                            part.data = DefineData::merge(&part.data, value);
                            return Ok(());
                        }
                    }
                    existing.push(DotDefine { data: value, parts });
                    return Ok(());
                }

                self.dots
                    .put_assume_capacity(tail, vec![DotDefine { data: value, parts }]);
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
    use bun_ast::ast_result::{ScopeUse, ScopeUsePoints, ScopeUseSpan};
    use bun_ast::scope::Scope;
    use bun_ast::symbol::{INVALID_NESTED_SCOPE_SLOT, Kind as SymbolKind, SlotNamespace, Symbol};
    use bun_collections::VecExt;

    /// The symbols that `stmt` declares with `let`, `const`, `using` or `class`.
    pub(crate) fn lexical_declarations(stmt: &bun_ast::Stmt, mut each: impl FnMut(u32)) {
        fn identifiers(binding: bun_ast::Binding, each: &mut impl FnMut(u32)) {
            use bun_ast::binding::Data;
            match binding.data {
                Data::BIdentifier(it) => each(it.r#ref.inner_index()),
                Data::BArray(it) => {
                    for item in it.items.slice() {
                        identifiers(item.binding, each);
                    }
                }
                Data::BObject(it) => {
                    for property in it.properties.slice() {
                        identifiers(property.value, each);
                    }
                }
                Data::BMissing(_) => {}
            }
        }
        match stmt.data {
            bun_ast::StmtData::SLocal(local) if local.kind != bun_ast::s::Kind::KVar => {
                for decl in local.decls.slice() {
                    identifiers(decl.binding, &mut each);
                }
            }
            bun_ast::StmtData::SClass(class) => {
                if let Some(name) = class.class.class_name {
                    each(name.ref_.inner_index());
                }
            }
            _ => {}
        }
    }

    /// Which symbols need a slot that no enclosing scope holds: their name can be printed where no declaration binds it.
    #[derive(Default)]
    pub(crate) struct SlotNotes {
        unique: Vec<u32>,
    }

    /// A mark is a `ScopeUse` whose scope has one of these above the bits of the scope being visited.
    pub(crate) mod slot_mark {
        pub(crate) const SHIFT: u32 = 29;
        /// A `return`, `throw`, `break` or `continue`. A folded test can make it a statement of a list around it.
        pub(crate) const JUMP: u32 = 1 << SHIFT;
        /// A statement starts that declares `ScopeUse::symbol` with `let`, `const`, `using` or `class`.
        pub(crate) const DECLARED: u32 = 2 << SHIFT;
        /// A function declaration starts.
        pub(crate) const FUNCTION: u32 = 3 << SHIFT;
        pub(crate) const FUNCTION_END: u32 = 4 << SHIFT;
    }

    impl SlotNotes {
        pub(crate) fn unique(&mut self, symbol: u32) {
            self.unique.push(symbol);
        }

        /// Takes the marks out of `uses`. Returns, by symbol, which need a slot that no enclosing scope holds.
        fn finish(
            &self,
            uses: &mut Vec<ScopeUse>,
            spans: &[ScopeUseSpan],
            symbol_count: usize,
            scopes: &ScopeTree,
        ) -> Vec<bool> {
            let mut unique = vec![false; symbol_count];
            for &symbol in &self.unique {
                unique[symbol as usize] = true;
            }
            // By symbol: `READ`, `DECLARED`, and above them one more than the declaring scope if that is behind a jump.
            const READ: u32 = 1 << 0;
            const DECLARED: u32 = 1 << 1;
            const SCOPE_SHIFT: u32 = 2;
            let mut notes = vec![0u32; symbol_count];
            // By scope: a statement of one of its lists has a jump in it.
            let mut has_jump = vec![false; scopes.parent_of.len()];
            // The scopes of the function declarations being passed.
            let mut functions: Vec<u32> = Vec::new();
            uses.retain(|it| {
                let scope = it.scope & ((1 << slot_mark::SHIFT) - 1);
                match it.scope & !((1 << slot_mark::SHIFT) - 1) {
                    0 => {
                        let note = &mut notes[it.symbol as usize];
                        if *note & DECLARED == 0 {
                            *note |= READ;
                        } else if *note >> SCOPE_SHIFT != 0
                            && functions.contains(&((*note >> SCOPE_SHIFT) - 1))
                        {
                            // A function declaration of the same list is hoisted, and kept behind a jump.
                            unique[it.symbol as usize] = true;
                        }
                        return true;
                    }
                    slot_mark::JUMP => {
                        let function = scopes.function_of[scope as usize];
                        let mut at = scope;
                        while !core::mem::replace(&mut has_jump[at as usize], true) {
                            at = scopes.parent_of[at as usize];
                            if scopes.function_of.get(at as usize) != Some(&function) {
                                break;
                            }
                        }
                    }
                    slot_mark::DECLARED => {
                        let note = &mut notes[it.symbol as usize];
                        // Dead code removal takes out a declaration behind a jump and keeps the reads that still run.
                        if has_jump[scope as usize] {
                            if *note & READ != 0 {
                                unique[it.symbol as usize] = true;
                            }
                            *note |= (scope + 1) << SCOPE_SHIFT;
                        }
                        *note |= DECLARED;
                    }
                    slot_mark::FUNCTION => functions.push(scope),
                    _ => {
                        functions.pop();
                    }
                }
                false
            });
            // A reference in a class body is a span, not a point: it can come before the declaration.
            for span in spans {
                if notes[span.symbol as usize] >> SCOPE_SHIFT != 0 {
                    unique[span.symbol as usize] = true;
                }
            }
            unique
        }
    }

    /// By scope (the index of `Scope::visit_span`).
    struct ScopeTree {
        /// `u32::MAX` for the module scope.
        parent_of: Vec<u32>,
        /// The scope of the function, static block or TypeScript closure around it.
        function_of: Vec<u32>,
    }

    impl ScopeTree {
        fn new(module_scope: &Scope) -> ScopeTree {
            let scope_count = module_scope
                .visit_span()
                .map_or(0, |(_, last)| last as usize + 1);
            let mut tree = ScopeTree {
                parent_of: vec![u32::MAX; scope_count],
                function_of: vec![0; scope_count],
            };
            fn fill(scope: &Scope, mut parent: u32, mut function: u32, tree: &mut ScopeTree) {
                if let Some((first, _)) = scope.visit_span() {
                    use bun_ast::scope::Kind;
                    if matches!(
                        scope.kind,
                        Kind::FunctionArgs | Kind::ClassStaticInit | Kind::Entry
                    ) {
                        function = first;
                    }
                    if (first as usize) < tree.parent_of.len() {
                        tree.parent_of[first as usize] = parent;
                        tree.function_of[first as usize] = function;
                    }
                    parent = first;
                }
                for child in scope.children.slice() {
                    fill(child, parent, function, tree);
                }
            }
            fill(module_scope, u32::MAX, 0, &mut tree);
            tree
        }
    }

    /// Where the file references each symbol, by the symbol that is printed for the reference.
    pub(crate) struct ScopeLiveness {
        points: ScopeUsePoints,
        /// From `ScopeUseSpan::merge`.
        spans: Vec<ScopeUseSpan>,
        /// By symbol, from `SlotNotes::finish`.
        unique: Vec<bool>,
        scopes: ScopeTree,
    }

    impl ScopeLiveness {
        /// Leaves in `points` the symbol that is printed for each.
        pub(crate) fn new(
            points: &mut Vec<ScopeUse>,
            spans: &[ScopeUseSpan],
            notes: &SlotNotes,
            module_scope: &Scope,
            symbols: &[Symbol],
        ) -> ScopeLiveness {
            let scopes = ScopeTree::new(module_scope);
            let unique = notes.finish(points, spans, symbols.len(), &scopes);
            // `symbol::Map::follow_printed` for one file. A TypeScript enum member read from another block prints as a property of the closure argument.
            let printed = |symbol: u32| -> u32 {
                let mut symbol = printed_in_place_of(symbols, symbol);
                while let Some(alias) = &symbols[symbol as usize].namespace_alias {
                    let next = printed_in_place_of(symbols, alias.namespace_ref.inner_index());
                    if next == symbol {
                        break;
                    }
                    symbol = next;
                }
                symbol
            };
            let mut spans: Vec<ScopeUseSpan> = spans
                .iter()
                .map(|span| ScopeUseSpan {
                    symbol: printed(span.symbol),
                    ..*span
                })
                .collect();
            ScopeUseSpan::merge(&mut spans);
            for point in points.iter_mut() {
                point.symbol = printed(point.symbol);
            }
            ScopeLiveness {
                points: ScopeUsePoints::build(points, symbols.len()),
                spans,
                unique,
                scopes,
            }
        }

        /// Whether the scopes `span` reference `symbol`. `None`: a scope the visit pass did not number, which may reference anything.
        fn is_live(&self, symbol: u32, span: Option<(u32, u32)>) -> bool {
            let Some((first, last)) = span else {
                return true;
            };
            self.points.any_in(symbol, first, last)
                || ScopeUseSpan::any_in(&self.spans, symbol, first, last)
        }

        fn is_unique(&self, symbol: u32) -> bool {
            self.unique[symbol as usize]
        }

        /// Whether a function other than the one of `scope`, which declares `symbol`, can reference it.
        fn is_captured(&self, symbol: u32, scope: &Scope) -> bool {
            let function_of = |at: u32| self.scopes.function_of.get(at as usize).copied();
            let Some(own) = function_of(scope.visit_span[0]) else {
                return true;
            };
            ScopeUseSpan::any_in(&self.spans, symbol, 0, u32::MAX)
                || self
                    .points
                    .scopes_of(symbol)
                    .iter()
                    .any(|&at| function_of(at) != Some(own))
        }
    }

    /// With `liveness`, a scope may take the slot of an enclosing symbol that nothing in it references. Without, slots count on as in esbuild.
    pub(crate) fn assign_nested_scope_slots(
        _arena: &bun_alloc::Arena,
        module_scope: &Scope,
        symbols: &mut [Symbol],
        liveness: Option<&ScopeLiveness>,
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

        if let Some(liveness) = liveness {
            let mut reuse = SlotReuse {
                liveness,
                holders: Vec::new(),
                displaced: Vec::new(),
                clear: Vec::new(),
                max_holders: 0,
                scopes: 0,
            };
            for child in module_scope.children.slice() {
                slot_counts.union_max(reuse.assign(
                    &mut sorted_members,
                    child,
                    symbols,
                    SlotCounts::default(),
                ));
            }
            slot_counts.slots[SlotNamespace::Default] = reuse.max_holders;
        } else {
            for child in module_scope.children.slice() {
                // `StoreRef<Scope>: Deref<Target = Scope>` — safe arena-backed deref.
                slot_counts.union_max(assign_nested_scope_slots_helper(
                    &mut sorted_members,
                    child,
                    symbols,
                    SlotCounts::default(),
                ));
            }
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

    fn assign_nested_scope_slots_helper(
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

    /// `symbol::Map::follow` for one file. A parameter that the body redeclares with `var` links to the symbol of the body.
    fn printed_in_place_of(symbols: &[Symbol], mut symbol: u32) -> u32 {
        while symbols[symbol as usize].has_link() {
            symbol = symbols[symbol as usize].link.get().inner_index();
        }
        symbol
    }

    #[derive(Clone, Copy)]
    struct SlotHolder {
        symbol: u32,
        /// How many of the holders of this slot in the enclosing scopes have a temporal dead zone.
        dead_zones: u32,
        /// `SlotReuse::scopes` of the scope that gave the slot to `symbol`.
        scope: u32,
    }

    /// Unlike esbuild's `AssignNestedScopeSlots`: a member takes the lowest slot that no symbol referenced in its scope holds.
    struct SlotReuse<'a> {
        liveness: &'a ScopeLiveness,
        /// Default namespace slot -> the symbol that holds it in the innermost enclosing scope.
        holders: Vec<SlotHolder>,
        /// `(slot, the holder a scope took it from)`, put back when the scope is left.
        displaced: Vec<(u32, SlotHolder)>,
        /// Slots with no `SlotHolder::dead_zones` when added, ascending. A scope further in can have given one a dead zone since.
        clear: Vec<u32>,
        max_holders: u32,
        /// How many scopes `assign` has entered.
        scopes: u32,
    }

    /// Whether a read can run before the declaration: `let`, `const`, a class, and a function in a block (printed as a `let`).
    fn has_dead_zone(kind: SymbolKind, scope: &Scope) -> bool {
        match kind {
            SymbolKind::Other
            | SymbolKind::Constant
            | SymbolKind::Class
            | SymbolKind::TsEnum
            | SymbolKind::TsNamespace => true,
            SymbolKind::HoistedFunction | SymbolKind::GeneratorOrAsyncFunction => {
                !scope.kind_stops_hoisting()
            }
            _ => false,
        }
    }

    impl SlotReuse<'_> {
        /// `slot`: the label and private name counts of the enclosing scopes.
        fn assign(
            &mut self,
            sorted_members: &mut Vec<u32>,
            scope: &Scope,
            symbols: &mut [Symbol],
            mut slot: SlotCounts,
        ) -> SlotCounts {
            let holders_len = self.holders.len();
            let displaced_len = self.displaced.len();
            let span = scope.capture_span();
            self.scopes += 1;
            let this_scope = self.scopes;

            sorted_members.clear();
            sorted_members.reserve(scope.members.len());
            for member in scope.members.values() {
                sorted_members.push(member.ref_.inner_index());
            }
            sorted_members.sort_unstable();

            // Slots below `next`, and slots of `clear` below `next_clear`, are held by symbols this scope references or declares.
            let mut next = 0;
            let mut next_clear = 0;
            let clear_len = self.clear.len();
            for &member in sorted_members.iter() {
                let inner_index = printed_in_place_of(symbols, member);
                let symbol = &mut symbols[inner_index as usize];
                let ns = symbol.slot_namespace();
                if ns == SlotNamespace::MustNotBeRenamed || symbol.nested_scope_slot().is_some() {
                    continue;
                }
                if ns != SlotNamespace::Default {
                    symbol.nested_scope_slot = slot.slots[ns];
                    slot.slots[ns] += 1;
                    continue;
                }
                let kind = symbol.kind;
                // A `var` here is held only by a catch binding of its name, but binds in the function. An enum's name can print before its declaration.
                let unique = (kind == SymbolKind::Hoisted && !scope.kind_stops_hoisting())
                    || kind == SymbolKind::TsEnum
                    || self.liveness.is_unique(member)
                    || self.liveness.is_unique(inner_index);
                let mut found = None;
                if !unique {
                    // JavaScriptCore checks the dead zone by name: a parameter, `var`, function or captured binding takes no slot of an outer `let`.
                    let mut pays_dead_zone_check = scope.kind_stops_hoisting()
                        && matches!(
                            kind,
                            SymbolKind::Hoisted
                                | SymbolKind::HoistedFunction
                                | SymbolKind::GeneratorOrAsyncFunction
                        );
                    while !pays_dead_zone_check {
                        let Some(holder) = self.holders.get(next) else {
                            break;
                        };
                        if holder.scope != this_scope && !self.liveness.is_live(holder.symbol, span)
                        {
                            if holder.dead_zones != 0
                                && self.liveness.is_captured(inner_index, scope)
                            {
                                pays_dead_zone_check = true;
                                break;
                            }
                            found = Some(next);
                        }
                        next += 1;
                        if found.is_some() {
                            break;
                        }
                    }
                    while pays_dead_zone_check && found.is_none() {
                        let Some(&at) = self.clear.get(next_clear) else {
                            break;
                        };
                        next_clear += 1;
                        let holder = self.holders[at as usize];
                        if holder.dead_zones == 0
                            && holder.scope != this_scope
                            && !self.liveness.is_live(holder.symbol, span)
                        {
                            found = Some(at as usize);
                        }
                    }
                }
                let mut holder = SlotHolder {
                    symbol: inner_index,
                    dead_zones: u32::from(has_dead_zone(kind, scope)),
                    scope: this_scope,
                };
                let at = found.unwrap_or(self.holders.len());
                if let Some(outer) = self.holders.get_mut(at) {
                    self.displaced.push((at as u32, *outer));
                    holder.dead_zones += outer.dead_zones;
                    *outer = holder;
                } else {
                    if holder.dead_zones == 0 {
                        self.clear.push(at as u32);
                    }
                    self.holders.push(holder);
                }
                symbols[inner_index as usize].nested_scope_slot = at as u32;
            }

            // A generated symbol may be declared further out than this scope: it takes a slot that no enclosing scope holds.
            for ref_ in scope.generated.slice() {
                let inner_index = printed_in_place_of(symbols, ref_.inner_index());
                let symbol = &mut symbols[inner_index as usize];
                let ns = symbol.slot_namespace();
                if ns == SlotNamespace::MustNotBeRenamed || symbol.nested_scope_slot().is_some() {
                    continue;
                }
                if ns != SlotNamespace::Default {
                    symbol.nested_scope_slot = slot.slots[ns];
                    slot.slots[ns] += 1;
                    continue;
                }
                symbol.nested_scope_slot = self.holders.len() as u32;
                let dead_zones = u32::from(has_dead_zone(symbol.kind, scope));
                if dead_zones == 0 {
                    self.clear.push(self.holders.len() as u32);
                }
                self.holders.push(SlotHolder {
                    symbol: inner_index,
                    dead_zones,
                    scope: this_scope,
                });
            }
            self.max_holders = self.max_holders.max(self.holders.len() as u32);

            // Labels are always declared in a nested scope, so we don't need to check.
            if let Some(ref_) = scope.label_ref.to_nullable() {
                let symbol = &mut symbols[ref_.inner_index() as usize];
                let ns = SlotNamespace::Label;
                symbol.nested_scope_slot = slot.slots[ns];
                slot.slots[ns] += 1;
            }

            let mut slot_counts = slot;
            for child in scope.children.slice() {
                slot_counts.union_max(self.assign(sorted_members, child, symbols, slot));
            }

            for &(at, holder) in self.displaced[displaced_len..].iter().rev() {
                self.holders[at as usize] = holder;
            }
            self.displaced.truncate(displaced_len);
            self.holders.truncate(holders_len);
            self.clear.truncate(clear_len);
            slot_counts
        }
    }

    // The remaining renamer types are only consumed by the printer and bundler
    // — they live in `bun_js_printer`.
}

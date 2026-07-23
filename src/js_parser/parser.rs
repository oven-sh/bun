//! ** IMPORTANT **
//! ** When making changes to the JavaScript Parser that impact runtime behavior or fix bugs **
//! ** you must also increment the `expected_version` in RuntimeTranspilerCache **
//! ** IMPORTANT **

use bun_ast::ImportRecord;
use bun_collections::{ArrayHashMap, HashMap, StringArrayHashMap, StringHashMap};
// `bun_wyhash::Wyhash` (wyhash final-4) — used by `hash_for_runtime_transpiler`
// and `ReactRefresh.HookContext`. NOT interchangeable with `bun_wyhash::Wyhash11`.
use bun_wyhash::Wyhash;

pub use bun_paths::fs;

/// `bun_options_types` is missing several items P.rs/Parser.rs reference
/// (`JSX`, `ServerComponents`, `ModuleType`, etc.); provide a local
/// `options` mod that re-exports the real crate plus stand-ins.
pub mod options {
    pub use bun_options_types::*;
    use std::borrow::Cow;
    // `Loader`/`Target`/`ImportKind`/`SideEffects` are now canonical in `bun_ast`;
    // re-exported here so the `options::Loader`/`options::Target` spelling used
    // throughout `P.rs`/`Parser.rs` keeps resolving without per-site churn.
    pub(crate) use bun_ast::Loader;
    pub use bun_options_types::bundle_enums::ModuleType;
    // D042: canonical `JSX::{Pragma, Runtime, ImportSource, Defaults, ...}`
    // lives in `bun_options_types::jsx`. The glob above already brings in
    // `jsx`/`JSX`; explicit re-export keeps the path stable for callers.
    /// Same enum surface as `Runtime.Features.ServerComponentsMode`.
    /// Aliased so call sites that
    /// spell it as either `options::ServerComponents` (P.rs) or
    /// `RuntimeFeatures.server_components` resolve to one type.
    pub(crate) use crate::parser::Runtime::ServerComponentsMode as ServerComponents;
    pub use JSX::Runtime as JSXRuntime;
    pub use bun_options_types::jsx as JSX;
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub enum Format {
        #[default]
        Esm,
        Iife,
        Cjs,
        InternalBakeDev,
    }
    impl Format {
        #[inline]
        pub const fn is_esm(self) -> bool {
            matches!(self, Format::Esm)
        }
    }
    /// Canonical home is here (the parser is the consumer
    /// — `P::should_allow_unresolved_dynamic_specifier`). `bun_bundler::options`
    /// re-exports this so `BundleOptions.allow_unresolved` and
    /// `Parser.Options.allow_unresolved` are the SAME nominal type and
    /// `ParseTask::run_with_source_code` can hand `&transpiler.options.allow_unresolved`
    /// straight through.
    /// Glob matcher for the `Patterns` arm. `bun_js_parser` cannot depend on
    /// `bun_glob` (sibling-tier per REFACTOR_BUN_AST.md); the bundler supplies
    /// `|pattern, shape| bun_glob::r#match(pattern, shape).matches()` when
    /// constructing `Patterns`. Function pointer (not closure) since no state
    /// is captured.
    pub(crate) type AllowUnresolvedMatcher = fn(pattern: &[u8], shape: &[u8]) -> bool;

    #[derive(Debug, Clone, Default)]
    pub enum AllowUnresolved {
        /// Default. Skip all checks — current behavior.
        #[default]
        All,
        /// Always error on dynamic specifiers.
        None,
        /// Glob patterns; at least one must match the extracted shape.
        Patterns(Box<[Box<[u8]>]>, AllowUnresolvedMatcher),
    }
    impl AllowUnresolved {
        // Taken by address from `Options::init` (`&options::AllowUnresolved::DEFAULT`); rvalue
        // static promotion gives the borrow `'static` lifetime.
        pub const DEFAULT: AllowUnresolved = AllowUnresolved::All;

        /// Normalize from raw CLI/JS input.
        /// [] → .none, contains "*" → .all, else → .patterns
        /// `matcher` supplies the glob predicate (typically `bun_glob::r#match`).
        pub fn from_strings(
            strs: Box<[Box<[u8]>]>,
            matcher: AllowUnresolvedMatcher,
        ) -> AllowUnresolved {
            if strs.is_empty() {
                return AllowUnresolved::None;
            }
            for s in strs.iter() {
                if &**s == b"*" {
                    return AllowUnresolved::All;
                }
            }
            AllowUnresolved::Patterns(strs, matcher)
        }

        /// shape is the extracted template representation (may be "").
        pub fn allows(&self, shape: &[u8]) -> bool {
            match self {
                AllowUnresolved::All => true,
                AllowUnresolved::None => false,
                AllowUnresolved::Patterns(pats, matcher) => {
                    for p in pats.iter() {
                        if matcher(p, shape) {
                            return true;
                        }
                    }
                    false
                }
            }
        }
    }
    /// Port of `bake.Framework` (src/runtime/bake/mod.rs:129) — TYPE_ONLY
    /// parser-side mirror. The full struct lives in `bun_runtime::bake` (a
    /// higher tier we cannot depend on here); the parser only consumes the
    /// two nested option fields below (see `Parser._parse`),
    /// so `file_system_router_types`/`built_in_modules`
    /// are intentionally elided.
    ///
    /// String fields are `Cow<'static, [u8]>` to match `bake/mod.rs`
    /// (they are user-configured via `fromJS`, rewritten by
    /// `Framework.resolve`, and freed on teardown). The parser only *borrows* them
    /// for `'a` (parse lifetime), not `'static`, so `&'static [u8]` would
    /// wrongly restrict callers to literal defaults — see PORTING.md
    /// §Forbidden re: `&'static [T]` for arena-freed data.
    #[derive(Clone, Default)]
    pub struct Framework {
        pub is_built_in_react: bool,
        pub server_components: Option<FrameworkServerComponents>,
        pub react_fast_refresh: Option<ReactFastRefresh>,
    }
    /// Mirror of `bake.Framework.ServerComponents` (bake/mod.rs:69). Named
    /// `FrameworkServerComponents` here because `options::ServerComponents`
    /// is already the `Runtime.Features.ServerComponentsMode` enum alias
    /// (see re-export above).
    #[derive(Clone)]
    pub struct FrameworkServerComponents {
        pub separate_ssr_graph: bool,
        /// REQUIRED — no default; `fromJS` throws
        /// if `serverRuntimeImportSource` is absent.
        pub server_runtime_import: Cow<'static, [u8]>,
        pub server_register_client_reference: Cow<'static, [u8]>,
        pub server_register_server_reference: Cow<'static, [u8]>,
        pub client_register_server_reference: Cow<'static, [u8]>,
    }
    /// Port of `bake.Framework.ReactFastRefresh` (bake/mod.rs:101).
    #[derive(Clone)]
    pub struct ReactFastRefresh {
        pub import_source: Cow<'static, [u8]>,
    }
    impl Default for ReactFastRefresh {
        fn default() -> Self {
            Self {
                import_source: Cow::Borrowed(b"react-refresh/runtime"),
            }
        }
    }
}
pub use crate::parse::parse_entry::{Options as ParserOptions, Parser};
pub use crate::renamer;
pub use crate::scan::scan_side_effects::SideEffects;

pub(crate) use bun_ast::base::Ref;

// `runtime.rs` (full port) is path-gated in lib.rs as `runtime_full`. Until
// its bun_core/bun_schema deps are wired, the *real* type surface — the parts
// `P`/`visitStmt`/`visitExpr` actually consume — lives here so dependents can
// drop their bool-placeholder guards.
#[allow(non_snake_case)]
pub mod Runtime {
    use bun_collections::StringSet;
    use bun_core::strings;
    use bun_wyhash::Wyhash;

    use bun_ast::RuntimeTranspilerCache;

    // ─────────────────────────── Runtime.Features ───────────────────────────

    pub struct Features {
        /// Enable the React Fast Refresh transform. What this does exactly
        /// is documented in js_parser, search for `const ReactRefresh`
        pub react_fast_refresh: bool,
        /// Run the React Compiler (auto-memoization) over the parsed AST
        /// before the visit pass.
        pub react_compiler: ReactCompilerMode,
        /// Test-only: have the React Compiler read leading `// @key value`
        /// fixture pragmas from the source. Set by the fixture runner.
        pub react_compiler_parse_test_pragmas: bool,
        /// `hot_module_reloading` is specific to if we are using bun.bake.DevServer.
        /// It can be enabled on the command line with --format=internal_bake_dev
        ///
        /// Standalone usage of this flag / usage of this flag
        /// without '--format' set is an unsupported use case.
        pub hot_module_reloading: bool,
        /// Control how the parser handles server components and server functions.
        pub server_components: ServerComponentsMode,

        pub is_macro_runtime: bool,
        pub top_level_await: bool,
        pub auto_import_jsx: bool,
        pub allow_runtime: bool,
        pub inlining: bool,

        pub inject_jest_globals: bool,

        pub no_macros: bool,

        pub commonjs_named_exports: bool,

        pub minify_syntax: bool,
        pub minify_identifiers: bool,
        /// Preserve function/class names during minification (CLI: --keep-names)
        pub minify_keep_names: bool,
        pub minify_whitespace: bool,
        pub dead_code_elimination: bool,

        pub set_breakpoint_on_first_line: bool,

        pub trim_unused_imports: bool,

        /// Allow runtime usage of require(), converting `require` into `__require`
        pub auto_polyfill_require: bool,

        pub replace_exports: ReplaceableExportMap,

        /// Scan for '// @bun' at the top of this file, halting a parse if it is
        /// seen. This is used in `bun run` after a `bun build --target=bun`,
        /// and you know the contents is already correct.
        ///
        /// This comment must never be used manually.
        pub dont_bundle_twice: bool,

        /// This is a list of packages which even when require() is used, we will
        /// instead convert to ESM import statements.
        ///
        /// This is not normally a safe transformation.
        ///
        /// So we have a list of packages which we know are safe to do this with.
        pub unwrap_commonjs_packages: &'static [&'static [u8]],

        pub commonjs_at_runtime: bool,
        pub unwrap_commonjs_to_esm: bool,

        pub emit_decorator_metadata: bool,
        pub standard_decorators: bool,

        /// If true and if the source is transpiled as cjs, don't wrap the module.
        /// This is used for `--print` entry points so we can get the result.
        pub remove_cjs_module_wrapper: bool,

        // `?*bun.jsc.RuntimeTranspilerCache` — raw `*mut` (not `&'a mut`)
        // so `Features` stays `'static`-bounded inside `Parser::Options` and avoids
        // the borrowck self-borrow that `&'a mut` would induce while `P` holds
        // `&mut Options`.
        pub runtime_transpiler_cache: Option<*mut RuntimeTranspilerCache>,

        // TODO: make this a bitset of all unsupported features
        pub lower_using: bool,

        /// Feature flags for dead-code elimination via `import { feature } from "bun:bundle"`
        /// When `feature("FLAG_NAME")` is called, it returns true if FLAG_NAME is in this set.
        ///
        /// `None` ≡ the empty static set (contributes nothing to the hash).
        /// Owned `Box` (not `&'static`) — freed on `BundleOptions` teardown.
        /// Leaking to satisfy a `&'static` would be an unbounded leak
        /// in watch/dev-server mode.
        pub bundler_feature_flags: Option<Box<StringSet>>,

        /// REPL mode: transforms code for interactive evaluation
        /// - Wraps lone object literals `{...}` in parentheses
        /// - Hoists variable declarations for REPL persistence
        /// - Wraps last expression in { value: expr } for result capture
        /// - Assigns functions to context for persistence
        pub repl_mode: bool,

        // Vestigial bool stub retained until its last reader (parseJSXElement.rs)
        // is ported to the real predicate; defaults false and is otherwise inert.
        pub jsx_optimization_inline: bool,
    }

    impl Default for Features {
        fn default() -> Self {
            Self {
                react_fast_refresh: false,
                react_compiler: ReactCompilerMode::Disabled,
                react_compiler_parse_test_pragmas: false,
                hot_module_reloading: false,
                server_components: ServerComponentsMode::None,
                is_macro_runtime: false,
                top_level_await: false,
                auto_import_jsx: false,
                allow_runtime: true,
                inlining: false,
                inject_jest_globals: false,
                no_macros: false,
                commonjs_named_exports: true,
                minify_syntax: false,
                minify_identifiers: false,
                minify_keep_names: false,
                minify_whitespace: false,
                dead_code_elimination: true,
                set_breakpoint_on_first_line: false,
                trim_unused_imports: false,
                auto_polyfill_require: false,
                replace_exports: ReplaceableExportMap::default(),
                dont_bundle_twice: false,
                unwrap_commonjs_packages: &[],
                commonjs_at_runtime: false,
                unwrap_commonjs_to_esm: false,
                emit_decorator_metadata: false,
                standard_decorators: false,
                remove_cjs_module_wrapper: false,
                runtime_transpiler_cache: None,
                lower_using: true,
                bundler_feature_flags: None,
                repl_mode: false,
                jsx_optimization_inline: false,
            }
        }
    }

    impl Features {
        /// Reborrow the optional `RuntimeTranspilerCache` back-pointer.
        ///
        /// `&self` receiver (not `&mut`) so call sites may hold other shared
        /// borrows of `p.options.*` across the returned `&mut` (e.g.
        /// `cache.get(p.source, &raw const p.options, p.options.jsx.parse)`).
        /// Callers must not hold two results live at once. Centralises the raw
        /// deref so the four parse-entry use sites stay safe.
        #[inline]
        #[allow(clippy::mut_from_ref)]
        pub fn runtime_transpiler_cache_mut(&self) -> Option<&mut RuntimeTranspilerCache> {
            // SAFETY: `runtime_transpiler_cache` is `Option<*mut _>` (see PORT
            // NOTE on the field) — the caller that populated it guarantees the
            // pointee is unique to this parse and outlives `Features`.
            self.runtime_transpiler_cache.map(|p| unsafe { &mut *p })
        }

        /// Initialize bundler feature flags for dead-code elimination via `import { feature } from "bun:bundle"`.
        /// Returns an owned `Box<StringSet>`, or `None` if no flags are provided.
        /// Keys are kept sorted so iteration order is deterministic (for RuntimeTranspilerCache hashing).
        pub fn init_bundler_feature_flags(feature_flags: &[&[u8]]) -> Option<Box<StringSet>> {
            // Empty path returns `None` (≡ static empty). Owned `Box` per
            // PORTING.md §Forbidden — never leak.
            if feature_flags.is_empty() {
                return None;
            }
            // `StringSet` preserves insertion order and has no in-place key sort,
            // so sort the inputs first; the resulting `keys()` iteration order
            // is then byte-lexicographic.
            let mut sorted: Vec<&[u8]> = feature_flags.to_vec();
            sorted.sort_unstable();
            let mut set = StringSet::new();
            for flag in sorted {
                let _ = set.insert(flag);
            }
            Some(Box::new(set))
        }

        // The hashed field list is maintained by hand — keep it in sync with
        // the feature fields that affect transpiled output.
        //
        // Takes `Wyhash` (NOT `Wyhash11`).
        pub fn hash_for_runtime_transpiler(&self, hasher: &mut Wyhash) {
            debug_assert!(self.runtime_transpiler_cache.is_some());

            let bools: [bool; 17] = [
                self.top_level_await,
                self.auto_import_jsx,
                self.allow_runtime,
                self.inlining,
                self.commonjs_named_exports,
                self.minify_syntax,
                self.minify_identifiers,
                self.minify_keep_names,
                self.dead_code_elimination,
                self.set_breakpoint_on_first_line,
                self.trim_unused_imports,
                self.dont_bundle_twice,
                self.commonjs_at_runtime,
                self.emit_decorator_metadata,
                self.standard_decorators,
                self.lower_using,
                self.repl_mode,
                // `inject_jest_globals` is deliberately absent: parses with it
                // set are keyed to a different cache *filename* instead (see
                // `RuntimeTranspilerCache::get`), so plain-run and `bun test`
                // entries coexist rather than evicting each other.
            ];

            // `[bool; N]` is N bytes of 0x00/0x01.
            // `bool: NoUninit`, `u8: AnyBitPattern` → `cast_slice` is statically sound.
            hasher.update(bytemuck::cast_slice::<bool, u8>(&bools));
            hasher.update(&[self.react_compiler as u8]);

            // Hash --feature flags. These directly affect transpiled output via
            // feature("NAME") replacement in visit_expr.rs. When empty, we add
            // nothing to the hash so existing cache entries remain valid.
            // Keys are sorted in init_bundler_feature_flags so flag order on the CLI doesn't matter.
            if let Some(flags) = self.bundler_feature_flags.as_deref() {
                for flag in flags.keys() {
                    hasher.update(flag);
                    hasher.update(b"\x00");
                }
            }
        }

        pub fn should_unwrap_require(&self, package_name: &[u8]) -> bool {
            !package_name.is_empty()
                && strings::index_equal_any(self.unwrap_commonjs_packages, package_name).is_some()
        }
    }

    // Data-shaped Runtime types are canonical in `bun_ast::runtime` so the
    // printer (and any non-parser caller) sees one definition. Re-exported
    // here so `parser::Runtime::{Imports, ReplaceableExport, ...}` and
    // `bun_ast::runtime::{...}` are the same nominal types.
    pub(crate) use bun_ast::runtime::{
        Imports, ReactCompilerMode, ReplaceableExport, ReplaceableExportMap, ServerComponentsMode,
    };

    // ───────────────────────────── Runtime / Fallback ─────────────────────

    // ───────────────────────────── Fallback ───────────────────────────────
    // REFACTOR_BUN_AST: moved here from `bun_ast::runtime` — needs
    // `bun_options_types::schema`, `bun_io`, `bun_base64`, all of which would
    // form a cycle inside `bun_ast`.

    use bun_options_types::schema;
    use bun_options_types::schema::api;
    use core::fmt;

    pub struct Fallback;

    impl Fallback {
        pub const HTML_BACKEND_TEMPLATE: &'static [u8] = include_bytes!("../fallback-backend.html");

        #[inline]
        pub fn error_js() -> &'static [u8] {
            bun_core::runtime_embed_file!(Codegen, "bun-error/index.js").as_bytes()
        }

        #[inline]
        pub fn error_css() -> &'static [u8] {
            bun_core::runtime_embed_file!(Codegen, "bun-error/bun-error.css").as_bytes()
        }

        #[inline]
        pub fn fallback_decoder_js() -> &'static [u8] {
            bun_core::runtime_embed_file!(Codegen, "fallback-decoder.js").as_bytes()
        }

        pub fn render_backend(
            msg: &api::FallbackMessageContainer,
            writer: &mut impl bun_io::Write,
        ) -> bun_io::Result<()> {
            let blob = Base64FallbackMessage { msg };
            let bun_error_css = Self::error_css();
            let bun_error = Self::error_js();
            let bun_error_page_css: &[u8] = b"";
            let fallback = Self::fallback_decoder_js();
            render_named_template(
                writer,
                Self::HTML_BACKEND_TEMPLATE,
                &mut |w, name| match name {
                    b"blob" => w.write_fmt(format_args!("{}", blob)),
                    b"bun_error_css" => w.write_all(bun_error_css),
                    b"bun_error" => w.write_all(bun_error),
                    b"bun_error_page_css" => w.write_all(bun_error_page_css),
                    b"fallback" => w.write_all(fallback),
                    _ => Ok(()),
                },
            )
        }
    }

    /// Tiny substitutor for `{[name]s}` / `{[name]f}` named placeholders
    /// (the only specifiers used in fallback.html / fallback-backend.html).
    fn render_named_template<W: bun_io::Write>(
        writer: &mut W,
        template: &'static [u8],
        subst: &mut dyn FnMut(&mut W, &[u8]) -> bun_io::Result<()>,
    ) -> bun_io::Result<()> {
        let mut i = 0usize;
        let mut last = 0usize;
        let bytes = template;
        while i + 1 < bytes.len() {
            if bytes[i] == b'{' && bytes[i + 1] == b'[' {
                let mut j = i + 2;
                while j < bytes.len() && bytes[j] != b']' {
                    j += 1;
                }
                if j + 2 < bytes.len() && bytes[j] == b']' && bytes[j + 2] == b'}' {
                    writer.write_all(&bytes[last..i])?;
                    let name = &bytes[i + 2..j];
                    subst(writer, name)?;
                    i = j + 3;
                    last = i;
                    continue;
                }
            }
            i += 1;
        }
        writer.write_all(&bytes[last..])
    }

    pub(crate) struct Base64FallbackMessage<'a> {
        pub msg: &'a api::FallbackMessageContainer,
    }

    impl fmt::Display for Base64FallbackMessage<'_> {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            let mut bb: Vec<u8> = Vec::new();
            let mut encoder = schema::Writer::new(&mut bb);
            self.msg.encode(&mut encoder); // catch {}
            // Standard alphabet, no '=' padding.
            let enc = &bun_base64::zig_base64::STANDARD_NO_PAD.encoder;
            let mut out = vec![0u8; enc.calc_size(bb.len())];
            let s = enc.encode(&mut out, &bb); // catch {}
            // SAFETY: STANDARD_ALPHABET_CHARS is pure ASCII; encoder output contains only those bytes.
            f.write_str(unsafe { core::str::from_utf8_unchecked(s) })
        }
    }
}
pub type RuntimeFeatures = Runtime::Features;
pub(crate) type RuntimeImports = Runtime::Imports;

pub use crate::p::P;

// NOTE(b0): `pub use bun_js_printer as js_printer;` removed — js_printer is same-tier mutual
// (js_printer depends on js_parser). Downstream callers import bun_js_printer directly.

pub use bun_ast as js_ast;
use js_ast::G;
pub use js_ast::{
    B, Binding, BindingNodeIndex, BindingNodeList, E, Expr, ExprNodeIndex, ExprNodeList, LocRef, S,
    Scope, Stmt, StmtNodeIndex, StmtNodeList, Symbol,
};

pub use js_ast::Op;
pub use js_ast::Op::Level;

pub use crate::lexer as js_lexer;
pub use js_lexer::T;

use crate::defines::Define;

// ──────────────────────────────────────────────────────────────────────────

pub struct ExprListLoc {
    pub list: ExprNodeList,
    pub loc: bun_ast::Loc,
}

pub(crate) const LOC_MODULE_SCOPE: bun_ast::Loc = bun_ast::Loc { start: -100 };

pub struct DeferredImportNamespace {
    pub namespace: LocRef,
    pub import_record_id: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SkipTypeParameterResult {
    DidNotSkipAnything,
    CouldBeTypeCast,
    DefinitelyTypeParameters,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct TypeParameterFlag: u8 {
        /// TypeScript 4.7
        const ALLOW_IN_OUT_VARIANCE_ANNOTATIONS = 1 << 0;
        /// TypeScript 5.0
        const ALLOW_CONST_MODIFIER = 1 << 1;
        /// Allow "<>" without any type parameters
        const ALLOW_EMPTY_TYPE_PARAMETERS = 1 << 2;
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum JSXImport {
    #[strum(serialize = "jsx")]
    Jsx,
    #[strum(serialize = "jsxDEV")]
    JsxDEV,
    #[strum(serialize = "jsxs")]
    Jsxs,
    #[strum(serialize = "Fragment")]
    Fragment,
    #[strum(serialize = "createElement")]
    CreateElement,
}

impl JSXImport {
    /// The import-clause name as it appears in source.
    #[inline]
    pub(crate) fn tag_name(self) -> &'static [u8] {
        let s: &'static str = self.into();
        s.as_bytes()
    }
}

#[derive(Default)]
pub struct JSXImportSymbols {
    pub jsx: Option<LocRef>,
    pub jsx_dev: Option<LocRef>,
    pub jsxs: Option<LocRef>,
    pub fragment: Option<LocRef>,
    pub create_element: Option<LocRef>,
}

impl JSXImportSymbols {
    pub(crate) fn get(&self, name: &[u8]) -> Option<Ref> {
        if name == b"jsx" {
            return self.jsx.map(|jsx| jsx.ref_);
        }
        if name == b"jsxDEV" {
            return self.jsx_dev.map(|jsx| jsx.ref_);
        }
        if name == b"jsxs" {
            return self.jsxs.map(|jsxs| jsxs.ref_);
        }
        if name == b"Fragment" {
            return self.fragment.map(|f| f.ref_);
        }
        if name == b"createElement" {
            return self.create_element.map(|c| c.ref_);
        }
        None
    }

    pub(crate) fn get_with_tag(&self, tag: JSXImport) -> Option<Ref> {
        match tag {
            JSXImport::Jsx => self.jsx.map(|jsx| jsx.ref_),
            JSXImport::JsxDEV => self.jsx_dev.map(|jsx| jsx.ref_),
            JSXImport::Jsxs => self.jsxs.map(|jsxs| jsxs.ref_),
            JSXImport::Fragment => self.fragment.map(|f| f.ref_),
            JSXImport::CreateElement => self.create_element.map(|c| c.ref_),
        }
    }

    pub(crate) fn set(&mut self, tag: JSXImport, loc_ref: LocRef) {
        match tag {
            JSXImport::Jsx => self.jsx = Some(loc_ref),
            JSXImport::JsxDEV => self.jsx_dev = Some(loc_ref),
            JSXImport::Jsxs => self.jsxs = Some(loc_ref),
            JSXImport::Fragment => self.fragment = Some(loc_ref),
            JSXImport::CreateElement => self.create_element = Some(loc_ref),
        }
    }

    pub(crate) fn runtime_import_names<'b>(
        &self,
        buf: &'b mut [&'static [u8]; 3],
    ) -> &'b [&'static [u8]] {
        let mut i: usize = 0;
        if self.jsx_dev.is_some() {
            debug_assert!(self.jsx.is_none()); // we should never end up with this in the same file
            buf[0] = b"jsxDEV";
            i += 1;
        }

        if self.jsx.is_some() {
            debug_assert!(self.jsx_dev.is_none()); // we should never end up with this in the same file
            buf[0] = b"jsx";
            i += 1;
        }

        if self.jsxs.is_some() {
            buf[i] = b"jsxs";
            i += 1;
        }

        if self.fragment.is_some() {
            buf[i] = b"Fragment";
            i += 1;
        }

        &buf[0..i]
    }

    pub(crate) fn source_import_names(&self) -> &'static [&'static [u8]] {
        if self.create_element.is_some() {
            &[b"createElement"]
        } else {
            &[]
        }
    }
}

// ─── GenerateImportSymbols impls (for `P::generate_import_stmt`) ───
// `generate_import_stmt` maps a key to its string name via this trait, with
// `Key = u8` (index into `ALL`) for `RuntimeImports` and
// `Key = &'static [u8]` (the alias string itself) for `JSXImportSymbols`.

impl crate::p::GenerateImportSymbols for RuntimeImports {
    /// Index into [`RuntimeImports::ALL`].
    type Key = u8;

    #[inline]
    fn get(&self, key: &u8) -> Option<Ref> {
        // Disambiguate from the trait method: call the inherent `get(usize)`.
        RuntimeImports::get(self, *key as usize)
    }

    #[inline]
    fn alias_name(&self, key: &u8) -> &'static [u8] {
        RuntimeImports::ALL[*key as usize]
    }
}

impl crate::p::GenerateImportSymbols for JSXImportSymbols {
    type Key = &'static [u8];

    #[inline]
    fn get(&self, key: &&'static [u8]) -> Option<Ref> {
        // Disambiguate from the trait method: call the inherent `get(&[u8])`.
        JSXImportSymbols::get(self, *key)
    }

    #[inline]
    fn alias_name(&self, key: &&'static [u8]) -> &'static [u8] {
        *key
    }
}

pub(crate) const ARGUMENTS_STR: &[u8] = b"arguments";

// Dear reader,
// There are some things you should know about this file to make it easier for humans to read
// "P" is the internal parts of the parser
// "p.e" allocates a new Expr
// "p.b" allocates a new Binding
// "p.s" allocates a new Stmt
// We do it this way so if we want to refactor how these are allocated in the future, we only have to modify one function to change it everywhere
// Everything in JavaScript is either an Expression, a Binding, or a Statement.
//   Expression:  foo(1)
//    Statement:  let a = 1;
//      Binding:  a
// While the names for Expr, Binding, and Stmt are directly copied from esbuild, those were likely inspired by Go's parser.
// which is another example of a very fast parser.

pub(crate) type ScopeOrderList<'bump> = bun_alloc::ArenaVec<'bump, Option<ScopeOrder<'bump>>>;

// kept as a static reference
pub(crate) const EXPORTS_STRING_NAME: &[u8] = b"exports";

#[derive(Clone, Copy)]
pub struct MacroRefData<'a> {
    pub import_record_id: u32,
    /// if name is None the macro is imported as a namespace import
    /// import * as macros from "./macros.js" with {type: "macro"};
    pub name: Option<&'a [u8]>,
}

type MacroRefs<'a> = ArrayHashMap<Ref, MacroRefData<'a>>;

pub enum Substitution {
    Success(Expr),
    Failure(Expr),
    Continue(Expr),
}

/// If we are currently in a hoisted child of the module scope, relocate these
/// declarations to the top level and return an equivalent assignment statement.
/// Make sure to check that the declaration kind is "var" before calling this.
/// And make sure to check that the returned statement is not the zero value.
///
/// This is done to make some transformations non-destructive
/// Without relocating vars to the top level, simplifying this:
/// if (false) var foo = 1;
/// to nothing is unsafe
/// Because "foo" was defined. And now it's not.
#[derive(Default)]
pub struct RelocateVars {
    pub stmt: Option<Stmt>,
    pub ok: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RelocateVarsMode {
    Normal,
    ForInOrForOf,
}

#[derive(Default)]
pub struct VisitArgsOpts<'a> {
    pub body: &'a [Stmt],
    pub has_rest_arg: bool,
    /// This is true if the function is an arrow function or a method
    pub is_unique_formal_parameters: bool,
}

#[derive(Clone, Copy)]
pub struct TransposeState {
    pub is_await_target: bool,
    pub is_then_catch_target: bool,
    pub is_require_immediately_assigned_to_decl: bool,
    pub loc: bun_ast::Loc,
    pub import_record_tag: Option<bun_ast::ImportRecordTag>,
    pub import_loader: Option<bun_ast::Loader>,
    pub import_options: Expr,
}

impl Default for TransposeState {
    fn default() -> Self {
        Self {
            is_await_target: false,
            is_then_catch_target: false,
            is_require_immediately_assigned_to_decl: false,
            loc: bun_ast::Loc::EMPTY,
            import_record_tag: None,
            import_loader: None,
            import_options: Expr::EMPTY,
        }
    }
}

pub enum JSXTagData {
    Fragment(u8),
    Tag(Expr),
}

impl JSXTagData {
    pub fn as_expr(&self) -> Option<ExprNodeIndex> {
        match self {
            JSXTagData::Tag(tag) => Some(*tag),
            _ => None,
        }
    }
}

pub(crate) struct JSXTag<'a> {
    pub data: JSXTagData,
    pub range: bun_ast::Range,
    /// Empty string for fragments.
    pub name: &'a [u8],
}

impl<'a> JSXTag<'a> {
    pub(crate) fn parse<P>(p: &mut P) -> crate::CrateResult<JSXTag<'a>>
    where
        P: crate::p::ParserLike<'a>,
    {
        use bun_core::strings;

        let loc = p.lexer().loc();

        // A missing tag is a fragment
        if p.lexer().token == T::TGreaterThan {
            return Ok(JSXTag {
                range: bun_ast::Range { loc, len: 0 },
                data: JSXTagData::Fragment(1),
                name: b"",
            });
        }

        // The tag is an identifier
        let mut name: &'a [u8] = p.lexer().identifier;
        let mut tag_range = p.lexer().range();
        p.lexer()
            .expect_inside_jsx_element_with_name(T::TIdentifier, b"JSX element name")?;

        // Certain identifiers are strings
        // <div
        // <button
        // <Hello-:Button
        if strings::contains_comptime(name, b"-:")
            || (p.lexer().token != T::TDot && name[0] >= b'a' && name[0] <= b'z')
        {
            return Ok(JSXTag {
                data: JSXTagData::Tag(p.new_expr(E::String::init(name), loc)),
                range: tag_range,
                name,
            });
        }

        // Otherwise, this is an identifier
        // <Button>
        let ref_ = p.store_name_in_ref(name);
        let mut tag = p.new_expr(
            E::Identifier {
                ref_,
                ..Default::default()
            },
            loc,
        );

        // Parse a member expression chain
        // <Button.Red>
        while p.lexer().token == T::TDot {
            p.lexer().next_inside_jsx_element()?;
            let member_range = p.lexer().range();
            let member: &'a [u8] = p.lexer().identifier;
            p.lexer().expect_inside_jsx_element(T::TIdentifier)?;

            if let Some(index) = strings::index_of_char(member, b'-') {
                let source = p.source();
                // SAFETY: `log_ptr()` returns the externally-lent `&mut Log`;
                // sole live alias while `P` lives.
                unsafe { p.log_ptr().as_mut() }.add_error(
                    Some(source),
                    bun_ast::Loc {
                        start: member_range.loc.start + i32::try_from(index).expect("int cast"),
                    },
                    b"Unexpected \"-\"",
                );
                return Err(crate::Error::SyntaxError);
            }

            let new_name: &'a mut [u8] = p
                .bump()
                .alloc_slice_fill_default::<u8>(name.len() + 1 + member.len());
            new_name[..name.len()].copy_from_slice(name);
            new_name[name.len()] = b'.';
            new_name[name.len() + 1..].copy_from_slice(member);
            name = new_name;
            tag_range.len = member_range.loc.start + member_range.len - tag_range.loc.start;
            tag = p.new_expr(
                E::Dot {
                    target: tag,
                    name: member.into(),
                    name_loc: member_range.loc,
                    ..Default::default()
                },
                loc,
            );
        }

        Ok(JSXTag {
            data: JSXTagData::Tag(tag),
            range: tag_range,
            name,
        })
    }
}

pub struct ExprOrLetStmt {
    pub stmt_or_expr: js_ast::StmtOrExpr,
    // `decls` borrows the heap buffer that was just moved into `S::Local`.
    // The buffer pointer is stable across
    // the move, but borrowck can't see that — store as `RawSlice` to record the
    // outlives-holder invariant without a per-site unsafe cast. Read by the
    // for-loop parser so for-in/for-of heads can validate "let"/"using" decls.
    pub decls: bun_collections::RawSlice<G::Decl>,
}

impl Default for ExprOrLetStmt {
    fn default() -> Self {
        Self {
            stmt_or_expr: js_ast::StmtOrExpr::default(),
            decls: bun_collections::RawSlice::EMPTY,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FunctionKind {
    Stmt,
    Expr,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum AsyncPrefixExpression {
    None = 0,
    IsYield = 1,
    IsAsync = 2,
    IsAwait = 3,
}

impl AsyncPrefixExpression {
    /// Hot path: called once for *every* identifier-prefix expression in
    /// `pfx_t_identifier`, i.e. once per non-keyword identifier token in the
    /// source. The previous `phf::phf_map!` lookup was the dominant caller of
    /// `phf_shared::hash` (SipHash) in the three.js bundle profile (~1.3%
    /// self time, mis-attributed to `bun_resolver` after ICF folded the
    /// duplicate `hash<[u8]>` bodies). All three keywords are exactly 5 ASCII
    /// bytes and start with 'a'/'y', so a length gate plus one fixed-array
    /// match rejects the overwhelming majority of identifiers in a single
    /// branch with no hashing.
    #[inline]
    pub(crate) fn find(ident: &[u8]) -> AsyncPrefixExpression {
        if ident.len() != 5 {
            return AsyncPrefixExpression::None;
        }
        // `try_into().unwrap()` folds away — len just checked.
        let arr: &[u8; 5] = ident.try_into().unwrap();
        match arr {
            b"async" => AsyncPrefixExpression::IsAsync,
            b"await" => AsyncPrefixExpression::IsAwait,
            b"yield" => AsyncPrefixExpression::IsYield,
            _ => AsyncPrefixExpression::None,
        }
    }
}

// Packed u8 — assign_target:u2, is_delete_target:b1,
// was_originally_identifier:b1, is_call_target:b1, _padding:u3 (LSB-first).
// Not all-bool (assign_target is a 2-bit enum), so per PORTING.md we use a
// transparent u8 with manual shift accessors.
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct IdentifierOpts(u8);

impl IdentifierOpts {
    const ASSIGN_TARGET_MASK: u8 = 0b0000_0011; // bits 0-1
    const IS_DELETE_TARGET: u8 = 1 << 2;
    const WAS_ORIGINALLY_IDENTIFIER: u8 = 1 << 3;
    const IS_CALL_TARGET: u8 = 1 << 4;

    #[inline]
    pub(crate) const fn assign_target(self) -> js_ast::AssignTarget {
        // AssignTarget is #[repr(u8)] with discriminants 0/1/2 only; the 2-bit
        // mask admits `3`, which would be UB to transmute. Exhaustive match
        // keeps the packed-u8 layout without the hazard. bits 0-1 are always
        // written via set_assign_target from a valid variant, so the `_` arm
        // is unreachable by construction.
        match self.0 & Self::ASSIGN_TARGET_MASK {
            0 => js_ast::AssignTarget::None,
            1 => js_ast::AssignTarget::Replace,
            2 => js_ast::AssignTarget::Update,
            _ => unreachable!(),
        }
    }
    #[inline]
    pub(crate) const fn is_delete_target(self) -> bool {
        self.0 & Self::IS_DELETE_TARGET != 0
    }
    #[inline]
    pub(crate) const fn was_originally_identifier(self) -> bool {
        self.0 & Self::WAS_ORIGINALLY_IDENTIFIER != 0
    }
    #[inline]
    pub(crate) const fn is_call_target(self) -> bool {
        self.0 & Self::IS_CALL_TARGET != 0
    }

    // Builder-style helpers (this stays a packed u8 rather than a
    // named-field struct).
    #[inline]
    pub(crate) const fn new() -> Self {
        Self(0)
    }
    #[inline]
    pub(crate) const fn with_assign_target(mut self, v: js_ast::AssignTarget) -> Self {
        self.0 = (self.0 & !Self::ASSIGN_TARGET_MASK) | (v as u8 & Self::ASSIGN_TARGET_MASK);
        self
    }
    #[inline]
    pub(crate) const fn with_is_delete_target(mut self, v: bool) -> Self {
        self.0 = (self.0 & !Self::IS_DELETE_TARGET) | ((v as u8) << 2);
        self
    }
    #[inline]
    pub(crate) const fn with_was_originally_identifier(mut self, v: bool) -> Self {
        self.0 = (self.0 & !Self::WAS_ORIGINALLY_IDENTIFIER) | ((v as u8) << 3);
        self
    }
    #[inline]
    pub(crate) const fn with_is_call_target(mut self, v: bool) -> Self {
        self.0 = (self.0 & !Self::IS_CALL_TARGET) | ((v as u8) << 4);
        self
    }
}

pub(crate) fn statement_cares_about_scope(stmt: &Stmt) -> bool {
    use js_ast::StmtData::*;
    match stmt.data {
        SBlock(_) | SEmpty(_) | SDebugger(_) | SExpr(_) | SIf(_) | SFor(_) | SForIn(_)
        | SForOf(_) | SDoWhile(_) | SWhile(_) | SWith(_) | STry(_) | SSwitch(_) | SReturn(_)
        | SThrow(_) | SBreak(_) | SContinue(_) | SDirective(_) | SLabel(_) => false,

        SLocal(ref local) => local.kind != js_ast::LocalKind::KVar,
        _ => true,
    }
}

#[derive(Clone, Copy, Default)]
pub struct ExprIn {
    /// This tells us if there are optional chain expressions (EDot, EIndex, or
    /// ECall) that are chained on to this expression. Because of the way the AST
    /// works, chaining expressions on to this expression means they are our
    /// parent expressions.
    ///
    /// Some examples:
    ///
    ///   a?.b.c  // EDot
    ///   a?.b[c] // EIndex
    ///   a?.b()  // ECall
    ///
    /// Note that this is false if our parent is a node with a OptionalChain
    /// value of OptionalChainStart. That means it's the start of a new chain, so
    /// it's not considered part of this one.
    ///
    /// Some examples:
    ///
    ///   a?.b?.c   // EDot
    ///   a?.b?.[c] // EIndex
    ///   a?.b?.()  // ECall
    ///
    /// Also note that this is false if our parent is a node with a OptionalChain
    /// value of OptionalChainNone. That means it's outside parentheses, which
    /// means it's no longer part of the chain.
    ///
    /// Some examples:
    ///
    /// Certain substitutions of identifiers are disallowed for assignment targets.
    /// For example, we shouldn't transform "undefined = 1" into "void 0 = 1". This
    /// isn't something real-world code would do but it matters for conformance
    /// tests.
    pub assign_target: js_ast::AssignTarget,

    /// Currently this is only used when unwrapping a call to `require()`
    /// with `__toESM()`.
    pub is_immediately_assigned_to_decl: bool,

    pub property_access_for_method_call_maybe_should_replace_with_undefined: bool,
}

/// This function exists to tie all of these checks together in one place
/// This can sometimes show up on benchmarks as a small thing.
#[inline]
pub(crate) fn is_eval_or_arguments(name: &[u8]) -> bool {
    name == b"eval" || name == b"arguments"
}

#[derive(Clone, Copy, Default)]
pub struct PrependTempRefsOpts {
    pub kind: StmtsKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum StmtsKind {
    #[default]
    None,
    LoopBody,
    SwitchStmt,
    FnBody,
}

#[derive(Default)]
pub struct ExprBindingTuple {
    pub expr: Option<ExprNodeIndex>,
    pub binding: Option<Binding>,
}

#[derive(Default)]
pub struct TempRef {
    pub r#ref: Ref,
    pub value: Option<Expr>,
}

pub struct ThenCatchChain {
    pub next_target: js_ast::ExprData,
    pub has_multiple_args: bool,
    pub has_catch: bool,
}
impl Default for ThenCatchChain {
    fn default() -> Self {
        Self {
            next_target: js_ast::ExprData::EMissing(E::Missing {}),
            has_multiple_args: false,
            has_catch: false,
        }
    }
}

#[derive(Clone, Copy)]
pub struct ParsedPath<'a> {
    pub loc: bun_ast::Loc,
    pub text: &'a [u8],
    pub is_macro: bool,
    pub import_tag: bun_ast::ImportRecordTag,
    pub loader: Option<bun_ast::Loader>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StrictModeFeature {
    WithStatement,
    DeleteBareName,
    ForInVarInit,
    EvalOrArguments,
    ReservedWord,
    LegacyOctalLiteral,
    LegacyOctalEscape,
    IfElseFunctionStmt,
}

#[derive(Clone, Copy)]
pub struct InvalidLoc {
    pub loc: bun_ast::Loc,
    pub kind: InvalidLocTag,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum InvalidLocTag {
    Spread,
    Parentheses,
    Getter,
    Setter,
    Method,
    #[default]
    Unknown,
}

impl InvalidLoc {
    #[cold]
    pub(crate) fn add_error(self, log: &mut bun_ast::Log, source: &bun_ast::Source) {
        let text: &'static [u8] = match self.kind {
            InvalidLocTag::Spread => b"Unexpected trailing comma after rest element",
            InvalidLocTag::Parentheses => b"Unexpected parentheses in binding pattern",
            InvalidLocTag::Getter => b"Unexpected getter in binding pattern",
            InvalidLocTag::Setter => b"Unexpected setter in binding pattern",
            InvalidLocTag::Method => b"Unexpected method in binding pattern",
            InvalidLocTag::Unknown => b"Invalid binding pattern",
        };
        log.add_error(Some(source), self.loc, text);
    }
}

pub(crate) type LocList<'bump> = bun_alloc::ArenaVec<'bump, InvalidLoc>;
pub type StmtList<'bump> = bun_alloc::ArenaVec<'bump, Stmt>;

/// This hash table is used every time we parse function args
/// Rather than allocating a new hash table each time, we can just reuse the previous allocation
pub struct StringVoidMap {
    map: StringHashMap<()>,
}

impl StringVoidMap {
    /// Returns true if the map already contained the given key.
    pub(crate) fn get_or_put_contains(&mut self, key: &[u8]) -> bool {
        // StringHashMap copies keys into owned heap allocations on insert,
        // so the pooled map outliving any one source is fine.
        let entry = self.map.get_or_put(key).expect("unreachable");
        entry.found_existing
    }

    fn init() -> Result<StringVoidMap, bun_core::Error> {
        Ok(StringVoidMap {
            map: StringHashMap::default(),
        })
    }

    pub(crate) fn reset(&mut self) {
        // We must reset or the hash table will contain invalid pointers
        self.map.clear();
    }

    /// Returns an RAII guard that derefs to `&mut StringVoidMap` and is
    /// returned to the pool on `Drop`.
    #[inline]
    pub(crate) fn get() -> bun_collections::pool::PoolGuard<'static, StringVoidMap> {
        StringVoidMapPool::get()
    }
}

impl bun_collections::pool::ObjectPoolType for StringVoidMap {
    const INIT: Option<fn() -> Result<Self, bun_core::Error>> = Some(StringVoidMap::init);
    #[inline]
    fn reset(&mut self) {
        StringVoidMap::reset(self)
    }
}

bun_collections::object_pool!(pub StringVoidMapPool: StringVoidMap, threadsafe, 32);

pub(crate) type StringBoolMap = StringHashMap<bool>;
pub(crate) type RefMap = HashMap<Ref, ()>;
pub(crate) type RefRefMap = HashMap<Ref, Ref>;

// `scope` is `*mut` (not `&'arena`) because the visit pass writes
// through it (push_scope_for_visit_pass assigns it to `current_scope: *mut`)
// and the parse pass needs Copy for the BumpVec<Option<ScopeOrder>> to be
// indexable + truncatable. The Scope itself is arena-owned for `'arena`.
#[derive(Clone, Copy)]
pub struct ScopeOrder<'arena> {
    pub loc: bun_ast::Loc,
    pub scope: *mut Scope,
    _phantom: core::marker::PhantomData<&'arena Scope>,
}
impl<'arena> ScopeOrder<'arena> {
    #[inline]
    pub fn new(loc: bun_ast::Loc, scope: *mut Scope) -> Self {
        Self {
            loc,
            scope,
            _phantom: core::marker::PhantomData,
        }
    }
    /// Arena-backed handle to the scope. `StoreRef` has safe `Deref`/`DerefMut`,
    /// so callers read `order.scope_ref().kind` instead of open-coding
    /// `unsafe { &*order.scope }` at every visit-pass check.
    #[inline]
    pub fn scope_ref(&self) -> js_ast::StoreRef<Scope> {
        // `scope` is always set from a live arena allocation in
        // `push_scope_for_parse_pass`; never null in practice.
        js_ast::StoreRef::from(
            core::ptr::NonNull::new(self.scope).expect("ScopeOrder.scope non-null"),
        )
    }
}

#[derive(Clone, Copy)]
pub struct ParenExprOpts {
    pub async_range: bun_ast::Range,
    pub is_async: bool,
    pub force_arrow_fn: bool,
}

impl Default for ParenExprOpts {
    fn default() -> Self {
        Self {
            async_range: bun_ast::Range::NONE,
            is_async: false,
            force_arrow_fn: false,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum AwaitOrYield {
    #[default]
    AllowIdent = 0,
    AllowExpr = 1,
    ForbidAll = 2,
}

/// This is function-specific information used during parsing. It is saved and
/// restored on the call stack around code that parses nested functions and
/// arrow expressions.
#[derive(Clone)]
pub struct FnOrArrowDataParse {
    pub async_range: bun_ast::Range,
    pub needs_async_loc: bun_ast::Loc,
    pub allow_await: AwaitOrYield,
    pub allow_yield: AwaitOrYield,
    pub allow_super_call: bool,
    pub allow_super_property: bool,
    pub is_top_level: bool,
    pub is_constructor: bool,
    pub is_typescript_declare: bool,

    pub has_argument_decorators: bool,
    pub has_decorators: bool,

    pub is_return_disallowed: bool,
    pub is_this_disallowed: bool,

    pub arrow_arg_errors: DeferredArrowArgErrors,
    pub track_arrow_arg_errors: bool,

    /// In TypeScript, forward declarations of functions have no bodies
    pub allow_missing_body_for_type_script: bool,

    /// Allow TypeScript decorators in function arguments
    pub allow_ts_decorators: bool,
}

impl Default for FnOrArrowDataParse {
    fn default() -> Self {
        Self {
            async_range: bun_ast::Range::NONE,
            needs_async_loc: bun_ast::Loc::EMPTY,
            allow_await: AwaitOrYield::AllowIdent,
            allow_yield: AwaitOrYield::AllowIdent,
            allow_super_call: false,
            allow_super_property: false,
            is_top_level: false,
            is_constructor: false,
            is_typescript_declare: false,
            has_argument_decorators: false,
            has_decorators: false,
            is_return_disallowed: false,
            is_this_disallowed: false,
            arrow_arg_errors: DeferredArrowArgErrors::default(),
            track_arrow_arg_errors: false,
            allow_missing_body_for_type_script: false,
            allow_ts_decorators: false,
        }
    }
}

/// This is function-specific information used during visiting. It is saved and
/// restored on the call stack around code that parses nested functions and
/// arrow expressions.
#[derive(Clone, Copy, Default)]
pub struct FnOrArrowDataVisit {
    pub is_async: bool,
    pub is_inside_loop: bool,
    pub is_inside_switch: bool,
    pub is_outside_fn_or_arrow: bool,

    /// This is used to silence unresolvable imports due to "require" calls inside
    /// a try/catch statement. The assumption is that the try/catch statement is
    /// there to handle the case where the reference to "require" crashes.
    pub try_body_count: i32,
}

/// This is function-specific information used during visiting. It is saved and
/// restored on the call stack around code that parses nested functions (but not
/// nested arrow functions).
#[derive(Default)]
pub struct FnOnlyDataVisit<'a> {
    /// This is a reference to the magic "arguments" variable that exists inside
    /// functions in JavaScript. It will be non-nil inside functions and nil
    /// otherwise.
    pub arguments_ref: Option<Ref>,

    /// This is a reference to the enclosing class name if there is one. It's used
    /// to implement "this" and "super" references. A name is automatically generated
    /// if one is missing so this will always be present inside a class body.
    ///
    /// `&Cell<Ref>` (not `&mut Ref`): the visit pass needs to
    /// both share this slot into nested `fn_only_data_visit` frames *and* read/write
    /// it from the enclosing `visit_class` frame. `Cell` gives shared interior
    /// mutability for the `Copy` `Ref` payload with zero `unsafe`.
    pub class_name_ref: Option<&'a core::cell::Cell<Ref>>,

    /// If true, we're inside a static class context where "this" expressions
    /// should be replaced with the class name.
    pub should_replace_this_with_class_name_ref: bool,

    /// If we're inside an async arrow function and async functions are not
    /// supported, then we will have to convert that arrow function to a generator
    /// function. That means references to "arguments" inside the arrow function
    /// will have to reference a captured variable instead of the real variable.
    pub is_inside_async_arrow_fn: bool,

    /// If false, the value for "this" is the top-level module scope "this" value.
    /// That means it's "undefined" for ECMAScript modules and "exports" for
    /// CommonJS modules. We track this information so that we can substitute the
    /// correct value for these top-level "this" references at compile time instead
    /// of passing the "this" expression through to the output and leaving the
    /// interpretation up to the run-time behavior of the generated code.
    ///
    /// If true, the value for "this" is nested inside something (either a function
    /// or a class declaration). That means the top-level module scope "this" value
    /// has been shadowed and is now inaccessible.
    pub is_this_nested: bool,
}

/// Due to ES6 destructuring patterns, there are many cases where it's
/// impossible to distinguish between an array or object literal and a
/// destructuring assignment until we hit the "=" operator later on.
/// This object defers errors about being in one state or the other
/// until we discover which state we're in.
#[derive(Clone, Copy, Default)]
pub struct DeferredErrors {
    /// These are errors for expressions
    pub invalid_expr_default_value: Option<bun_ast::Range>,
    pub invalid_expr_after_question: Option<bun_ast::Range>,
}

impl DeferredErrors {
    pub(crate) fn merge_into(&self, to: &mut DeferredErrors) {
        to.invalid_expr_default_value = self
            .invalid_expr_default_value
            .or(to.invalid_expr_default_value);
        to.invalid_expr_after_question = self
            .invalid_expr_after_question
            .or(to.invalid_expr_after_question);
    }
}

pub struct ImportClause<'a> {
    /// Arena-owned. `&mut` (not `&`) so callers can hand it to AST nodes
    /// (`S::Import.items: StoreSlice<ClauseItem>`).
    pub items: &'a mut [js_ast::ClauseItem],
    pub is_single_line: bool,
    pub had_type_only_imports: bool,
}

pub struct PropertyOpts {
    pub async_range: bun_ast::Range,
    pub declare_range: bun_ast::Range,
    pub is_async: bool,
    pub is_generator: bool,

    // Class-related options
    pub is_static: bool,
    pub is_class: bool,
    pub class_has_extends: bool,
    pub allow_ts_decorators: bool,
    pub is_ts_abstract: bool,
    pub ts_decorators: ExprNodeList,
    pub has_argument_decorators: bool,
    pub has_class_decorators: bool,
}

impl Default for PropertyOpts {
    fn default() -> Self {
        Self {
            async_range: bun_ast::Range::NONE,
            declare_range: bun_ast::Range::NONE,
            is_async: false,
            is_generator: false,
            is_static: false,
            is_class: false,
            class_has_extends: false,
            allow_ts_decorators: false,
            is_ts_abstract: false,
            ts_decorators: bun_alloc::AstAlloc::vec(),
            has_argument_decorators: false,
            has_class_decorators: false,
        }
    }
}

pub struct ScanPassResult {
    pub import_records: Vec<ImportRecord>,
    pub named_imports: bun_ast::ast_result::NamedImports,
    pub used_symbols: ParsePassSymbolUsageMap,
    pub approximate_newline_count: usize,
}

#[derive(Clone, Copy)]
pub struct ParsePassSymbolUse {
    pub r#ref: Ref,
    pub used: bool,
    pub import_record_index: u32,
}

pub(crate) type ParsePassSymbolUsageMap = StringArrayHashMap<ParsePassSymbolUse>;

impl ScanPassResult {
    pub fn init() -> ScanPassResult {
        ScanPassResult {
            import_records: Vec::new(),
            named_imports: Default::default(),
            used_symbols: ParsePassSymbolUsageMap::default(),
            approximate_newline_count: 0,
        }
    }

    pub fn reset(&mut self) {
        self.named_imports.clear_retaining_capacity();
        self.import_records.clear();
        self.used_symbols.clear_retaining_capacity();
        self.approximate_newline_count = 0;
    }
}

#[derive(Clone, Copy)]
pub struct FindLabelSymbolResult {
    pub r#ref: Ref,
    pub is_loop: bool,
    pub found: bool,
}

#[derive(Clone, Copy, Default)]
pub struct FindSymbolResult {
    pub r#ref: Ref,
    pub declare_loc: Option<bun_ast::Loc>,
    pub is_inside_with_scope: bool,
}

pub struct ExportClauseResult<'a> {
    /// Arena-owned. `&mut` (not `&`) so callers can hand it to AST nodes
    /// (`S::Export{From,Clause}.items: StoreSlice<ClauseItem>`).
    pub clauses: &'a mut [js_ast::ClauseItem],
    pub is_single_line: bool,
    pub had_type_only_exports: bool,
}

#[derive(Clone, Copy)]
pub struct DeferredTsDecorators<'a> {
    pub values: &'a [js_ast::Expr],

    /// If this turns out to be a "declare class" statement, we need to undo the
    /// scopes that were potentially pushed while parsing the decorator arguments.
    pub scope_index: usize,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum LexicalDecl {
    #[default]
    Forbid = 0,
    AllowAll = 1,
    AllowFnInsideIf = 2,
    AllowFnInsideLabel = 3,
}

#[derive(Default)]
pub struct ParseClassOptions<'a> {
    pub ts_decorators: &'a [Expr],
    pub allow_ts_decorators: bool,
    pub is_type_script_declare: bool,
}

#[derive(Default, Clone, Copy)]
pub struct ParseStatementOptions<'a> {
    pub ts_decorators: Option<DeferredTsDecorators<'a>>,
    pub lexical_decl: LexicalDecl,
    pub is_module_scope: bool,
    pub is_namespace_scope: bool,
    pub is_export: bool,
    pub is_using_statement: bool,
    /// For "export default" pseudo-statements,
    pub is_name_optional: bool,
    pub is_typescript_declare: bool,
    pub is_for_loop_init: bool,
}

impl<'a> ParseStatementOptions<'a> {
    pub(crate) fn has_decorators(&self) -> bool {
        let Some(decs) = &self.ts_decorators else {
            return false;
        };
        !decs.values.is_empty()
    }
}

// Only const-able AST node singletons live here. Callers needing the rest
// (missing nodes, empty statements, the HMR helper exprs) construct them
// directly — they are cheap value types, so a shared-singleton optimization
// isn't worth `static mut`/`LazyLock` plumbing.
pub mod prefill {
    use super::*;

    pub mod value {
        use super::*;
        pub(crate) const ZERO: E::Number = E::Number::new(0.0);
    }

    pub mod string {
        use super::*;
        pub(crate) const CHILDREN: E::String = E::String::from_static(b"children");
    }

    pub mod data {
        use super::*;
        pub const THIS: js_ast::ExprData = js_ast::ExprData::EThis(E::This {});
        pub(crate) const ZERO: js_ast::ExprData = js_ast::ExprData::ENumber(value::ZERO);
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum JSXTransformType {
    #[default]
    None,
    React,
}

impl JSXTransformType {
    /// Was the `JsxT::ENABLED` associated const back when JSX was a
    /// `<J: JsxT>` type parameter. The parser is no longer monomorphized on
    /// JSX (it only affects a handful of expr arms — see the `bun .` startup
    /// note in `p.rs`), so this is now a plain runtime predicate.
    #[inline]
    pub(crate) const fn is_enabled(self) -> bool {
        matches!(self, JSXTransformType::React)
    }

    /// Derive the transform mode from parser options.
    #[inline]
    pub(crate) const fn from_parse_flag(parse: bool) -> JSXTransformType {
        if parse {
            JSXTransformType::React
        } else {
            JSXTransformType::None
        }
    }
}

pub type ImportItemForNamespaceMap = StringArrayHashMap<LocRef>;

pub struct MacroState<'a> {
    pub refs: MacroRefs<'a>,
}

impl<'a> MacroState<'a> {
    pub fn init() -> MacroState<'a> {
        MacroState {
            refs: MacroRefs::default(),
        }
    }
}

pub struct Jest {
    pub test: Ref,
    pub it: Ref,
    pub describe: Ref,
    pub expect: Ref,
    pub expect_type_of: Ref,
    pub before_all: Ref,
    pub before_each: Ref,
    pub after_each: Ref,
    pub after_all: Ref,
    pub jest: Ref,
    pub vi: Ref,
    pub xit: Ref,
    pub xtest: Ref,
    pub xdescribe: Ref,
}

impl Jest {
    /// `_parse` iterates this static table. The `&str` is the *JavaScript*
    /// global name, and the fn-ptr projects the corresponding `Ref` out of
    /// the struct. The table order determines the emitted import-clause /
    /// binding property order.
    pub(crate) const FIELDS: &'static [(&'static str, fn(&Jest) -> Ref)] = &[
        ("test", |j| j.test),
        ("it", |j| j.it),
        ("describe", |j| j.describe),
        ("expect", |j| j.expect),
        ("expectTypeOf", |j| j.expect_type_of),
        ("beforeAll", |j| j.before_all),
        ("beforeEach", |j| j.before_each),
        ("afterEach", |j| j.after_each),
        ("afterAll", |j| j.after_all),
        ("jest", |j| j.jest),
        ("vi", |j| j.vi),
        ("xit", |j| j.xit),
        ("xtest", |j| j.xtest),
        ("xdescribe", |j| j.xdescribe),
    ];
}

impl Default for Jest {
    fn default() -> Self {
        Self {
            test: Ref::NONE,
            it: Ref::NONE,
            describe: Ref::NONE,
            expect: Ref::NONE,
            expect_type_of: Ref::NONE,
            before_all: Ref::NONE,
            before_each: Ref::NONE,
            after_each: Ref::NONE,
            after_all: Ref::NONE,
            jest: Ref::NONE,
            vi: Ref::NONE,
            xit: Ref::NONE,
            xtest: Ref::NONE,
            xdescribe: Ref::NONE,
        }
    }
}

// Named parser aliases live in `ast/Parser.rs` (where the JsxT ZSTs are
// in scope). Re-export here.
pub use crate::parse::parse_entry::{JavaScriptParser, TSXParser};

/// The "await" and "yield" expressions are never allowed in argument lists but
/// may or may not be allowed otherwise depending on the details of the enclosing
/// function or module. This needs to be handled when parsing an arrow function
/// argument list because we don't know if these expressions are not allowed until
/// we reach the "=>" token (or discover the absence of one).
///
/// Specifically, for await:
///
///   // This is ok
///   async function foo() { (x = await y) }
///
///   // This is an error
///   async function foo() { (x = await y) => {} }
///
/// And for yield:
///
///   // This is ok
///   function* foo() { (x = yield y) }
///
///   // This is an error
///   function* foo() { (x = yield y) => {} }
#[derive(Clone, Copy)]
pub struct DeferredArrowArgErrors {
    pub invalid_expr_await: bun_ast::Range,
    pub invalid_expr_yield: bun_ast::Range,
}

impl Default for DeferredArrowArgErrors {
    fn default() -> Self {
        Self {
            invalid_expr_await: bun_ast::Range::NONE,
            invalid_expr_yield: bun_ast::Range::NONE,
        }
    }
}

pub fn new_lazy_export_ast<'bump>(
    bump: &'bump bun_alloc::Arena,
    define: &'bump mut Define,
    opts: ParserOptions<'bump>,
    log_to_copy_into: &mut bun_ast::Log,
    expr: Expr,
    source: &'bump bun_ast::Source,
    runtime_api_call: &'static [u8],
) -> crate::CrateResult<Option<js_ast::Ast<'bump>>> {
    new_lazy_export_ast_impl(
        bump,
        define,
        opts,
        log_to_copy_into,
        expr,
        source,
        runtime_api_call,
        js_ast::symbol::List::new_in(bump),
    )
}

pub fn new_lazy_export_ast_impl<'bump>(
    bump: &'bump bun_alloc::Arena,
    define: &'bump mut Define,
    opts: ParserOptions<'bump>,
    log_to_copy_into: &mut bun_ast::Log,
    expr: Expr,
    source: &'bump bun_ast::Source,
    runtime_api_call: &'static [u8],
    symbols: js_ast::symbol::List<'bump>,
) -> crate::CrateResult<Option<js_ast::Ast<'bump>>> {
    let mut temp_log = bun_ast::Log::init();
    // parser.log and lexer.log both store `NonNull<Log>`; copy the lexer's
    // pointer so they share one provenance chain. See `Parser::init` for the
    // same pattern.
    let lexer = js_lexer::Lexer::init_without_reading(&mut temp_log, source, bump);
    let log_ptr = lexer.log;
    let mut parser = Parser {
        options: opts,
        bump,
        lexer,
        define,
        source,
        log: log_ptr,
    };
    let result = match parser.to_lazy_export_ast(expr, runtime_api_call, symbols) {
        Ok(r) => r,
        Err(err) => {
            let range = parser.lexer.range();
            drop(parser);
            if temp_log.errors == 0 {
                log_to_copy_into.add_range_error(Some(source), range, err.name().as_bytes());
            }
            let _ = temp_log.append_to_maybe_recycled(log_to_copy_into, source);
            return Ok(None);
        }
    };
    drop(parser);

    let _ = temp_log.append_to_maybe_recycled(log_to_copy_into, source);
    match result {
        crate::Result::Ast(mut ast) => {
            ast.has_lazy_export = true;
            Ok(Some(*ast))
        }
        // `to_lazy_export_ast` always returns `Result::Ast` (no parse pass runs).
        _ => unreachable!("to_lazy_export_ast returns Result::Ast"),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum WrapMode {
    #[default]
    None,
    BunCommonjs,
}

/// "Fast Refresh" is React's solution for hot-module-reloading in the context of the UI framework
/// user guide: https://reactnative.dev/docs/fast-refresh (applies to react-dom and native)
///
/// This depends on performing a couple extra transformations at bundle time, as well as
/// including the `react-refresh` NPM package, which is able to do the heavy lifting,
/// integrating with `react` and `react-dom`.
///
/// Prior implementations:
///  [1]: https://github.com/facebook/react/blob/main/packages/react-refresh/src/ReactFreshBabelPlugin.js
///  [2]: https://github.com/swc-project/swc/blob/main/crates/swc_ecma_transforms_react/src/refresh/mod.rs
///
/// Additional reading:
///  [3] https://github.com/facebook/react/issues/16604#issuecomment-528663101
///  [4] https://github.com/facebook/react/blob/master/packages/react-refresh/src/__tests__/ReactFreshIntegration-test.js
///
/// Instead of a plugin which visits the tree separately, Bun's implementation of fast refresh
/// happens in tandem with the visit pass. The responsibilities of the transform are as follows:
///
/// 1. For all Components (which is defined as any top-level function/function variable, that is
///    named with a capital letter; see `isComponentishName`), register them to the runtime using
///    `$RefreshReg$(ComponentFunction, "Component");`. Implemented in `p.handleReactRefreshRegister`
///    HOC components are also registered, but only through a special case for `export default`
///
/// 2. For all functions which call a Hook (a hook is an identifier matching /^use[A-Z]/):
///     a. Outside of the function, create a signature function `const _s = $RefreshSig$();`
///     b. At the start of the function, call `_s()`
///     c. Record all of the hooks called, the variables they are assigned to, and
///        arguments depending on which hook has been used. `useState` and `useReducer`,
///        for example, are special-cased.
///     d. Directly after the function, call `_s(hook, "<hash>", forceReset)`
///         - If a user-defined hook is called, the alterate form is used:
///           `_s(hook, "<hash>", forceReset, () => [useCustom1, useCustom2])`
///
/// The upstream transforms do not declare `$RefreshReg$` or `$RefreshSig$`. A typical
/// implementation might look like this, prepending this data to the module start:
///
///     import * as Refresh from 'react-refresh/runtime';
///     const $RefreshReg$ = (type, id) => Refresh.register(type, "<file id here>" + id);
///     const $RefreshSig$ = Refresh.createSignatureFunctionForTransform;
///
/// Since Bun is a transpiler *and* bundler, we take a slightly different approach. Aside
/// from including the link to the refresh runtime, our notation of $RefreshReg$ is just
/// pointing at `Refresh.register`, which means when we call it, the second argument has
/// to be a string containing the filepath, not just the component name.
pub struct ReactRefresh<'a> {
    /// Set if this JSX/TSX file uses the refresh runtime. If so,
    /// we must insert an import statement to it.
    pub register_used: bool,
    pub signature_used: bool,

    /// $RefreshReg$ is called on all top-level variables that are
    /// components, as well as HOCs found in the `export default` clause.
    pub register_ref: Ref,

    /// $RefreshSig$ is called to create a signature function, which is
    /// used by the refresh runtime to perform smart hook tracking.
    pub create_signature_ref: Ref,

    /// If a comment with '@refresh reset' is seen, we will forward a
    /// force refresh to the refresh runtime. This lets you reset the
    /// state of hooks on an update on a per-component basis.
    // TODO: this is never set
    pub force_reset: bool,

    /// The last hook that was scanned. This is used when visiting
    /// `.s_local`, as we must hash the variable destructure if the
    /// hook's result is assigned directly to a local.
    // ARENA: identity-compared against Store-allocated AST node.
    pub last_hook_seen: Option<*const E::Call>,

    /// Every function sets up stack memory to hold data related to it's
    /// hook tracking. This is a pointer to that ?HookContext, where an
    /// inner null means there are no hook calls.
    ///
    /// The inner value is initialized when the first hook .e_call is
    /// visited, where the '_s' symbol is reserved. Additional hook calls
    /// append to the `hasher` and `user_hooks` as needed.
    ///
    /// When a function is done visiting, the stack location is checked,
    /// and then it will insert `var _s = ...`, add the `_s()` call at
    /// the start of the function, and then add the call to `_s(func, ...)`.
    ///
    /// A raw nullable pointer to stack storage on the visiting fn frame,
    /// modeled as `Option<NonNull<_>>`
    /// (Copy) so the save/set/restore dance in visitStmt/visitExpr can take a
    /// stack-local address without the `'a` borrow the visitor cannot satisfy.
    pub hook_ctx_storage: Option<core::ptr::NonNull<Option<HookContext>>>,

    /// This is the most recently generated `_s` call. This is used to compare
    /// against seen calls to plain identifiers when in "export default" and in
    /// "const Component =" to know if an expression had been wrapped in a hook
    /// signature function.
    pub latest_signature_ref: Ref,

    _phantom: core::marker::PhantomData<&'a ()>,
}

impl<'a> Default for ReactRefresh<'a> {
    fn default() -> Self {
        Self {
            register_used: false,
            signature_used: false,
            register_ref: Ref::NONE,
            create_signature_ref: Ref::NONE,
            force_reset: false,
            last_hook_seen: None,
            hook_ctx_storage: None,
            latest_signature_ref: Ref::NONE,
            _phantom: core::marker::PhantomData,
        }
    }
}

pub struct HookContext {
    pub hasher: Wyhash,
    pub signature_cb: Ref,
    pub user_hooks: ArrayHashMap<Ref, Expr>,
}

impl ReactRefresh<'_> {
    /// Reborrow the stack-allocated `Option<HookContext>` that
    /// `hook_ctx_storage` points at. The returned
    /// borrow is detached from `self` because the storage lives on a *caller*
    /// stack frame (set/restored around each visit), disjoint from the parser
    /// struct. Centralises the one `unsafe` so call sites in `p.rs` /
    /// `visit/mod.rs` stay safe; callers must not hold two results live at
    /// once (same uniqueness contract as `P::log()`).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn hook_ctx_mut<'s>(&self) -> Option<&'s mut Option<HookContext>> {
        // SAFETY: `hook_ctx_storage` is `Some` only while a `visit_*` frame
        // higher on the stack has installed `&mut react_hook_data` (a stack
        // local) and will restore the previous value before returning, so the
        // pointee is live and at a stable address for any `'s` not outlasting
        // that frame. The storage is disjoint from `*self`, so `&mut self`
        // calls between accessor uses do not invalidate the returned borrow.
        self.hook_ctx_storage.map(|p| unsafe { &mut *p.as_ptr() })
    }

    /// https://github.com/facebook/react/blob/d1afcb43fd506297109c32ff462f6f659f9110ae/packages/react-refresh/src/ReactFreshBabelPlugin.js#L42
    pub(crate) fn is_componentish_name(id: &[u8]) -> bool {
        if id.is_empty() {
            return false;
        }
        id[0].is_ascii_uppercase()
    }

    /// https://github.com/facebook/react/blob/d1afcb43fd506297109c32ff462f6f659f9110ae/packages/react-refresh/src/ReactFreshBabelPlugin.js#L408
    pub(crate) fn is_hook_name(id: &[u8]) -> bool {
        id.len() >= 4 && id.starts_with(b"use") && id[3].is_ascii_uppercase()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
#[allow(non_camel_case_types)]
pub(crate) enum BuiltInHook {
    useState,
    useReducer,
    useEffect,
    useLayoutEffect,
    useMemo,
    useCallback,
    useRef,
    useContext,
    useImperativeHandle,
    useDebugValue,
    useId,
    useDeferredValue,
    useTransition,
    useInsertionEffect,
    useSyncExternalStore,
    useFormStatus,
    useFormState,
    useActionState,
    useOptimistic,
}

// PERF: all 19 keys share the `b"use"` prefix, so a perfect hash spends most
// of its work mixing identical leading bytes. The length dispatch yields a
// unique bucket for 13 of the 15 occupied lengths; the two collisions
// (len 10 → 2 keys, len 13 → 4 keys) resolve via the constant-length compare
// tree.
bun_core::comptime_string_map! {
    static BUILT_IN_HOOK_MAP: BuiltInHook = {
        b"useId" => BuiltInHook::useId,
        b"useRef" => BuiltInHook::useRef,
        b"useMemo" => BuiltInHook::useMemo,
        b"useState" => BuiltInHook::useState,
        b"useEffect" => BuiltInHook::useEffect,
        b"useReducer" => BuiltInHook::useReducer,
        b"useContext" => BuiltInHook::useContext,
        b"useCallback" => BuiltInHook::useCallback,
        b"useFormState" => BuiltInHook::useFormState,
        b"useDebugValue" => BuiltInHook::useDebugValue,
        b"useTransition" => BuiltInHook::useTransition,
        b"useFormStatus" => BuiltInHook::useFormStatus,
        b"useOptimistic" => BuiltInHook::useOptimistic,
        b"useActionState" => BuiltInHook::useActionState,
        b"useLayoutEffect" => BuiltInHook::useLayoutEffect,
        b"useDeferredValue" => BuiltInHook::useDeferredValue,
        b"useInsertionEffect" => BuiltInHook::useInsertionEffect,
        b"useImperativeHandle" => BuiltInHook::useImperativeHandle,
        b"useSyncExternalStore" => BuiltInHook::useSyncExternalStore,
    };
}

impl BuiltInHook {
    #[inline]
    pub(crate) fn from_bytes(id: &[u8]) -> Option<Self> {
        BUILT_IN_HOOK_MAP.get(id).copied()
    }
}

/// Equivalent of esbuild's js_ast_helpers.ToInt32
pub(crate) fn float_to_int32(f: f64) -> i32 {
    // Special-case non-finite numbers
    if !f.is_finite() {
        return 0;
    }

    // The `%` keeps the value in [0, u32::MAX], so the `as u32` cast is exact
    // (and would saturate rather than be UB if it weren't).
    let uint: u32 = (f.abs() % (u32::MAX as f64 + 1.0)) as u32;
    let int: i32 = uint as i32; // bitcast (same-width int cast reinterprets bits)
    if f < 0.0 { 0i32.wrapping_sub(int) } else { int }
}

#[derive(Clone, Copy, Default)]
pub struct ParseBindingOptions {
    /// This will prevent parsing of destructuring patterns, as using statement
    /// is only allowed to be `using name, name2, name3`, nothing special.
    pub is_using_statement: bool,
}

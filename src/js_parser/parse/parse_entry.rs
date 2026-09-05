use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt;
use core::mem::MaybeUninit;

use crate::Error;
use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_core;
use bun_core::strings;
use bun_wyhash::Wyhash;

use crate::parser::options;
use bun_ast::import_record::{Flags as ImportRecordFlags, ImportRecord};

use crate::defines::Define;
use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::{
    Jest, ParseStatementOptions, RuntimeFeatures, RuntimeImports, ScanPassResult, StatementScope,
    WrapMode,
};
use bun_ast as js_ast;
use bun_ast::DeclaredSymbol;
use bun_ast::{B, E, Expr, G, S, Stmt};

// Named instantiations of `P<'_, TS>`.
pub type JavaScriptParser<'a> = P<'a, false>;
pub type TSXParser<'a> = P<'a, true>;

// In AST crates, ListManaged(T) backed by the arena → bumpalo Vec.
type BumpVec<'bump, T> = bun_alloc::ArenaVec<'bump, T>;

/// Stack-local in-place `P` constructor. `P` is ~5 KiB; the previous
/// `let mut p = P::init(..)?` shape forced 2-3 by-value moves of the whole
/// struct (ASM-verified: `_scan_imports` 14168-B frame, 5× `memcpy`). This
/// macro reserves an uninitialized slot on the caller's stack, has `P::init`
/// write to it directly, and yields a `&mut P` borrow that runs `P::drop` via
/// `scopeguard` on scope exit — no `Self`-sized moves, no heap.
///
/// On `init` `Err`, the slot is still uninitialized so the guard's
/// `assume_init_drop` would be UB; the macro `?`-returns *before* arming the
/// guard. (`P::init` itself only fails before `out.write` — see its doc.)
macro_rules! init_p {
    ($ty:ty; $($arg:expr),* $(,)?) => {{
        let mut __slot = MaybeUninit::<$ty>::uninit();
        // `P::init` takes `&mut MaybeUninit<Self>` and writes a
        // fully-initialized value on `Ok` (safe call; type guarantees align).
        <$ty>::init(&mut __slot, $($arg),*)?;
        // SAFETY: `init` returned `Ok`, so `*__slot` is initialized; the
        // guard's drop closure is the sole owner of the slot from here.
        scopeguard::guard(__slot, |mut s| unsafe { s.assume_init_drop() })
    }};
}

pub struct Parser<'a> {
    pub(crate) options: Options<'a>,
    pub(crate) lexer: js_lexer::Lexer<'a>,
    /// Raw pointer alias of `lexer.log`. Rust
    /// cannot hold two live `&'a mut Log`, so both the parser- and lexer-side
    /// handles are `NonNull` and dereferenced at use sites (see `log_mut` /
    /// `Lexer::log()`). The pointee outlives `'a` (see `init`).
    pub(crate) log: core::ptr::NonNull<bun_ast::Log>,
    pub(crate) source: &'a bun_ast::Source,
    pub(crate) define: &'a Define,
    pub(crate) bump: &'a Arena,
    /// `log.errors` before the priming `lexer.next()` in `init`.
    pub(crate) orig_error_count: u32,
}

pub struct Options<'a> {
    pub jsx: options::JSX::Pragma,
    pub ts: bool,
    pub keep_names: bool,
    pub ignore_dce_annotations: bool,
    pub preserve_unused_imports_ts: bool,
    pub use_define_for_class_fields: bool,
    pub suppress_warnings_about_weird_code: bool,
    pub features: RuntimeFeatures,

    pub tree_shaking: bool,
    pub bundle: bool,
    pub code_splitting: bool,
    pub package_version: &'a [u8],

    pub macro_context: Option<&'a mut MacroContext>,

    pub warn_about_unbundled_modules: bool,

    pub allow_unresolved: &'a options::AllowUnresolved,

    pub module_type: options::ModuleType,
    pub output_format: options::Format,

    pub transform_only: bool,

    /// Used for inlining the state of import.meta.main during visiting
    pub import_meta_main_value: Option<bool>,
    pub lower_import_meta_main_for_node_js: bool,

    /// When using react fast refresh or server components, the framework is
    /// able to customize what import sources are used.
    pub framework: Option<&'a options::Framework>, // TYPE_ONLY: was bun_runtime::bake::Framework

    /// REPL mode: transforms code for interactive evaluation
    /// - Wraps lone object literals `{...}` in parentheses
    /// - Hoists variable declarations for REPL persistence
    /// - Wraps last expression in { value: expr } for result capture
    /// - Wraps code with await in async IIFE
    pub repl_mode: bool,

    /// Lower `toml_datetime`-tagged strings in a lazy-export AST to `Temporal.*.from` calls.
    pub lower_toml_datetimes: bool,

    /// A bundle entry point: its own output is needed, so a `module.exports = require(...)`-only file stays a real
    /// module rather than becoming a redirect to what it re-exports.
    pub is_entry_point: bool,
}

impl<'a> Default for Options<'a> {
    fn default() -> Self {
        // `macro_context` is `None`; caller must set
        // before use. This impl exists so `_parse` can `core::mem::take` the
        // real options out of `Parser` (moving the heap-owning `jsx: Pragma`
        // by value) instead of bitwise-copying it and double-freeing on drop.
        Options {
            jsx: options::JSX::Pragma::default(),
            ts: false,
            keep_names: true,
            ignore_dce_annotations: false,
            preserve_unused_imports_ts: false,
            use_define_for_class_fields: true,
            suppress_warnings_about_weird_code: true,
            features: RuntimeFeatures::default(),
            tree_shaking: false,
            bundle: false,
            code_splitting: false,
            package_version: b"",
            macro_context: None,
            warn_about_unbundled_modules: true,
            allow_unresolved: &options::AllowUnresolved::DEFAULT,
            module_type: options::ModuleType::Unknown,
            output_format: options::Format::Esm,
            transform_only: false,
            import_meta_main_value: None,
            lower_import_meta_main_for_node_js: false,
            framework: None,
            repl_mode: false,
            lower_toml_datetimes: false,
            is_entry_point: false,
        }
    }
}

impl<'a> Options<'a> {
    /// Field-by-field clone for the bundler's empty-file fallback
    /// (`getEmptyAST(..., opts, ...)` after `caches.js.parse(..., opts, ...)`
    /// returned null). `parse()` consumes `opts`,
    /// and `Options` is not `Clone` because `macro_context` is `&'a mut`.
    ///
    /// Co-located with the struct so adding a field is a hard error here —
    /// the struct-literal below has no `..Default::default()` tail. Callers
    /// take this snapshot *before* moving `opts` into `parse()`.
    ///
    /// Intentionally NOT carried over (lazy-export / `to_lazy_export_ast` does
    /// not consult them; carrying them would alias or double-own):
    /// - `macro_context` (`&'a mut`) — macro evaluation runs only on the full
    ///   parse path.
    /// - `features.replace_exports` — visit-pass-only; the lazy stub has no
    ///   user statements to rewrite.
    /// - `features.bundler_feature_flags` — `import { feature } from
    ///   "bun:bundle"` cannot appear in a synthetic single-expr AST.
    /// - `features.runtime_transpiler_cache` — full-parse cache hook only.
    pub fn clone_for_lazy_export(&self) -> Options<'a> {
        let f = &self.features;
        Options {
            jsx: self.jsx.clone(),
            ts: self.ts,
            keep_names: self.keep_names,
            ignore_dce_annotations: self.ignore_dce_annotations,
            preserve_unused_imports_ts: self.preserve_unused_imports_ts,
            use_define_for_class_fields: self.use_define_for_class_fields,
            suppress_warnings_about_weird_code: self.suppress_warnings_about_weird_code,
            features: RuntimeFeatures {
                react_fast_refresh: f.react_fast_refresh,
                react_compiler: f.react_compiler,
                react_compiler_parse_test_pragmas: f.react_compiler_parse_test_pragmas,
                hot_module_reloading: f.hot_module_reloading,
                server_components: f.server_components,
                is_macro_runtime: f.is_macro_runtime,
                top_level_await: f.top_level_await,
                auto_import_jsx: f.auto_import_jsx,
                allow_runtime: f.allow_runtime,
                inlining: f.inlining,
                inject_jest_globals: f.inject_jest_globals,
                no_macros: f.no_macros,
                commonjs_named_exports: f.commonjs_named_exports,
                minify_syntax: f.minify_syntax,
                minify_identifiers: f.minify_identifiers,
                minify_keep_names: f.minify_keep_names,
                minify_whitespace: f.minify_whitespace,
                dead_code_elimination: f.dead_code_elimination,
                set_breakpoint_on_first_line: f.set_breakpoint_on_first_line,
                trim_unused_imports: f.trim_unused_imports,
                auto_polyfill_require: f.auto_polyfill_require,
                replace_exports: Default::default(),
                dont_bundle_twice: f.dont_bundle_twice,
                unwrap_commonjs_packages: f.unwrap_commonjs_packages,
                commonjs_at_runtime: f.commonjs_at_runtime,
                unwrap_commonjs_to_esm: f.unwrap_commonjs_to_esm,
                emit_decorator_metadata: f.emit_decorator_metadata,
                standard_decorators: f.standard_decorators,
                remove_cjs_module_wrapper: f.remove_cjs_module_wrapper,
                runtime_transpiler_cache: None,
                lower_using: f.lower_using,
                bundler_feature_flags: None,
                define_hash: f.define_hash,
                repl_mode: f.repl_mode,
                jsx_optimization_inline: f.jsx_optimization_inline,
            },
            tree_shaking: self.tree_shaking,
            bundle: self.bundle,
            code_splitting: self.code_splitting,
            package_version: self.package_version,
            macro_context: None,
            warn_about_unbundled_modules: self.warn_about_unbundled_modules,
            allow_unresolved: self.allow_unresolved,
            module_type: self.module_type,
            output_format: self.output_format,
            transform_only: self.transform_only,
            import_meta_main_value: self.import_meta_main_value,
            lower_import_meta_main_for_node_js: self.lower_import_meta_main_for_node_js,
            framework: self.framework,
            repl_mode: self.repl_mode,
            lower_toml_datetimes: self.lower_toml_datetimes,
            is_entry_point: self.is_entry_point,
        }
    }

    pub fn hash_for_runtime_transpiler(&self, hasher: &mut Wyhash, did_use_jsx: bool) {
        debug_assert!(!self.bundle);

        if did_use_jsx {
            if self.jsx.parse {
                self.jsx.hash_for_runtime_transpiler(hasher);
                // this holds the values for the jsx optimizaiton flags, which have both been removed
                // as the optimizations break newer versions of react, see https://github.com/oven-sh/bun/issues/11025
                let jsx_optimizations: [bool; 2] = [false, false];
                // `bool: NoUninit`, `u8: AnyBitPattern`.
                hasher.update(bytemuck::cast_slice::<bool, u8>(&jsx_optimizations));
            } else {
                hasher.update(b"NO_JSX");
            }
        }

        if self.ts {
            hasher.update(b"TS");
        } else {
            hasher.update(b"NO_TS");
        }

        if self.ignore_dce_annotations {
            hasher.update(b"no_dce");
        }

        if !self.use_define_for_class_fields {
            hasher.update(b"udfcf=0");
        }

        self.features.hash_for_runtime_transpiler(hasher);
    }

    // Used to determine if `joinWithComma` should be called in `visitStmts`. We do this
    // to avoid changing line numbers too much to make source mapping more readable
    pub(crate) fn runtime_merge_adjacent_expression_statements(&self) -> bool {
        self.bundle
    }

    pub fn init(jsx: options::JSX::Pragma, loader: options::Loader) -> Options<'static> {
        // `macro_context` is `None`
        // (see field comment); caller overwrites before use.
        let mut opts = Options {
            ts: loader.is_typescript(),
            jsx,
            keep_names: true,
            ignore_dce_annotations: false,
            preserve_unused_imports_ts: false,
            use_define_for_class_fields: true,
            suppress_warnings_about_weird_code: true,
            features: RuntimeFeatures::default(),
            tree_shaking: false,
            bundle: false,
            code_splitting: false,
            package_version: b"",
            // Materializing an invalid `&mut T` is immediate UB regardless of
            // use, so model "not yet set" as `None`; callers must assign `Some(_)`
            // before any read site `.unwrap()`s it.
            macro_context: None,
            warn_about_unbundled_modules: true,
            allow_unresolved: &options::AllowUnresolved::DEFAULT,
            module_type: options::ModuleType::Unknown,
            output_format: options::Format::Esm,
            transform_only: false,
            import_meta_main_value: None,
            lower_import_meta_main_for_node_js: false,
            framework: None,
            repl_mode: false,
            lower_toml_datetimes: loader == options::Loader::Toml,
            is_entry_point: false,
        };
        opts.jsx.parse = loader.is_jsx();
        opts
    }
}

// ── live `Parser::init` ───────────────────────────────────────────────────
// The two aliasing `Log` handles (parser + lexer) are modeled as
// `NonNull<Log>` on both sides — neither stores a long-lived `&mut`, so no
// Stacked-Borrows tag is invalidated when accesses interleave.
impl<'a> Parser<'a> {
    pub fn init(
        options: Options<'a>,
        log: &mut bun_ast::Log,
        source: &'a bun_ast::Source,
        define: &'a Define,
        bump: &'a Arena,
    ) -> Result<Parser<'a>, Error> {
        source.check_parseable_len(log, "File")?;
        let orig_error_count = log.errors;
        let mut lexer = js_lexer::Lexer::init_without_reading(log, source, bump);
        // Must be set before the priming `next()` so leading comments are seen.
        lexer.track_comments = options.features.minify_identifiers;
        lexer.track_react_suppressions = options.features.react_compiler.is_enabled();
        lexer.step();
        lexer.next()?;
        // Copy the lexer's `NonNull<Log>` so both handles share one provenance
        // chain (the `&'a mut Log` was consumed by `Lexer::init`).
        let log_ptr = lexer.log;
        Ok(Parser {
            options,
            bump,
            lexer,
            define,
            source,
            log: log_ptr,
            orig_error_count,
        })
    }
}

// ── live `Parser::parse` / `Parser::scan_imports` symbols ────────────────
// `parse()` is the real const-generic dispatcher. `_parse` carries the correct `<const TS, JX>`
// shape but its body is blocked on `P::{init, prepare_for_visit_pass,
// append_part, to_ast, …}` (gated in P.rs); the full ported body is preserved
// per-method-gated in the impl block below and replaces this stub once that
// surface lands.
impl<'a> Parser<'a> {
    #[cfg_attr(not(target_arch = "wasm32"), allow(unused_mut))]
    pub fn parse(mut self) -> Result<crate::Result<'a>, Error> {
        #[cfg(target_arch = "wasm32")]
        {
            self.options.ts = true;
            self.options.jsx.parse = true;
            return self._parse::<true>();
        }

        // JSX is no longer part of the parser's monomorphization (it only
        // affects a few expr arms — see `parser.rs`); `P::init` reads the
        // transform mode off `options.jsx.parse` at runtime, so the only
        // remaining compile-time split is TypeScript.
        #[cfg(not(target_arch = "wasm32"))]
        {
            if self.options.ts {
                self._parse::<true>()
            } else {
                self._parse::<false>()
            }
        }
    }

    /// Bundler-only scan pass (see `bundler/cache.rs`). Never reached from
    /// `bun run`, so keep the `_scan_imports` monomorphizations out of the hot
    /// `.text` between the lexer and the live `_parse` bodies.
    #[cold]
    pub fn scan_imports(&mut self, scan_pass: &'a mut ScanPassResult) -> Result<(), Error> {
        if self.options.ts {
            self._scan_imports::<true>(scan_pass)
        } else {
            self._scan_imports::<false>(scan_pass)
        }
    }

    #[cold]
    fn _scan_imports<const TS: bool>(
        &mut self,
        scan_pass: &'a mut ScanPassResult,
    ) -> Result<(), Error> {
        type Pi<'a, const TS: bool> = P<'a, TS>;
        // `Lexer` owns `Vec`s and `Options` owns
        // `jsx: Pragma` boxes, so a bitwise `ptr::read` would double-free
        // when `self` later drops. Move them out, leaving inert placeholders.
        //
        // The inert placeholder lexer is given its *own* arena-allocated `Log`
        // so it does not alias `self.log` at all — keeps the placeholder fully
        // disjoint from the real `Log` handed to `P` and never read again.
        let lexer = core::mem::replace(
            &mut self.lexer,
            js_lexer::Lexer::init_without_reading(
                // Disjoint dummy `Log` (empty `Vec`, arena-leaked); the
                // placeholder is never read after this point.
                self.bump.alloc(bun_ast::Log::default()),
                self.source,
                self.bump,
            ),
        );
        let options = core::mem::take(&mut self.options);
        // `P.log` and `Lexer.log` are both `NonNull<Log>` (see P.rs / lexer.rs
        // field docs), so handing the same raw pointer to both is defined —
        // no `&mut` is materialized.
        let mut __p = init_p!(Pi<'_, TS>;
            self.bump, self.log, self.source, self.define, lexer, options, true);
        // SAFETY: `init_p!` only yields after `init` succeeded.
        let p: &mut Pi<'_, TS> = unsafe { __p.assume_init_mut() };
        p.import_records = crate::p::ImportRecordList::Borrowed(&mut scan_pass.import_records);
        p.named_imports = crate::p::NamedImportsType::Borrowed(&mut scan_pass.named_imports);

        // The problem with our scan pass approach is type-only imports.
        // We don't have accurate symbol counts.
        // So we don't have a good way to distinguish between a type-only import and not.
        if TS {
            // Pre-size the name-keyed usage map so the scan pass doesn't
            // re-hash it one identifier reference at a time (≈ one tracked
            // symbol per 16 source bytes). `ensure_total_capacity` is a no-op
            // when the map already retains enough capacity from a prior file.
            let _ = scan_pass
                .used_symbols
                .ensure_total_capacity(self.source.contents.len() / 16);
            p.parse_pass_symbol_uses = Some(&mut scan_pass.used_symbols);
        }

        // Parse the file in the first pass, but do not bind symbols
        let mut opts = ParseStatementOptions {
            scope: StatementScope::Module,
            ..Default::default()
        };

        // Parsing seems to take around 2x as much time as visiting.
        // Which makes sense.
        // June 4: "Parsing took: 18028000"
        // June 4: "Rest of this took: 8003000"
        match p.parse_stmts_up_to(js_lexer::T::TEndOfFile, &mut opts) {
            Ok(_) => {}
            Err(e) => {
                if e == crate::Error::StackOverflow {
                    // The lexer location won't be totally accurate, but it's kind of helpful.
                    p.log().add_error(
                        Some(p.source),
                        p.lexer.loc(),
                        b"Maximum call stack size exceeded",
                    );
                    return Ok(());
                }
                return Err(e);
            }
        }

        //
        if TS {
            for import_record in p.import_records.items_mut() {
                // Mark everything as unused
                // Except:
                // - export * as ns from 'foo';
                // - export * from 'foo';
                // - import 'foo';
                // - import("foo")
                // - require("foo")
                let new_unused = import_record.flags.contains(ImportRecordFlags::IS_UNUSED)
                    || (import_record.kind == bun_ast::ImportKind::Stmt
                        && !import_record
                            .flags
                            .contains(ImportRecordFlags::WAS_ORIGINALLY_BARE_IMPORT)
                        && !import_record
                            .flags
                            .contains(ImportRecordFlags::CALLS_RUNTIME_RE_EXPORT_FN));
                import_record
                    .flags
                    .set(ImportRecordFlags::IS_UNUSED, new_unused);
            }

            // `scan_pass.used_symbols`/`import_records` are still
            // exclusively borrowed inside `p`; route through `p`'s fields so the
            // borrow checker sees disjoint field access on the same struct.
            let import_records = p.import_records.items_mut();
            let mut iter = p
                .parse_pass_symbol_uses
                .as_mut()
                .expect("set above for TS")
                .iterator();
            while let Some(entry) = iter.next() {
                let val = entry.value_ptr;
                if val.used {
                    import_records[val.import_record_index as usize]
                        .flags
                        .remove(ImportRecordFlags::IS_UNUSED);
                }
            }
        }

        // Symbol use counts are unavailable
        // So we say "did we parse any JSX?"
        // if yes, just automatically add the import so that .bun knows to include the file.
        if p.options.jsx.parse && p.needs_jsx_import {
            // `add_import_record` requires `&'a [u8]`, but borrowing
            // `p.options` would conflict with `&mut p`, so copy into the arena.
            let arena = p.arena;
            let import_source: &'a [u8] = arena.alloc_slice_copy(p.options.jsx.import_source());
            let classic_import_source: &'a [u8] =
                arena.alloc_slice_copy(&p.options.jsx.classic_import_source);
            let _ = p.add_import_record(
                bun_ast::ImportKind::Require,
                bun_ast::Loc { start: 0 },
                import_source,
            );
            // Ensure we have both classic and automatic
            // This is to handle cases where they use fragments in the automatic runtime
            let _ = p.add_import_record(
                bun_ast::ImportKind::Require,
                bun_ast::Loc { start: 0 },
                classic_import_source,
            );
        }

        scan_pass.approximate_newline_count = p.lexer.approximate_newline_count;
        Ok(())
    }

    pub(crate) fn to_lazy_export_ast(
        &mut self,
        expr: Expr,
        runtime_api_call: &'static [u8],
        symbols: js_ast::symbol::List<'a>,
    ) -> Result<crate::Result<'a>, Error> {
        // Move lexer/options out and leave inert
        // placeholders so `self` may drop without double-free.
        //
        // The placeholder lexer gets its own arena `Log` so it does not alias
        // `self.log` (see `_scan_imports`).
        let lexer = core::mem::replace(
            &mut self.lexer,
            js_lexer::Lexer::init_without_reading(
                // Disjoint dummy `Log` (empty `Vec`, arena-leaked); the
                // placeholder is never read after this point.
                self.bump.alloc(bun_ast::Log::default()),
                self.source,
                self.bump,
            ),
        );
        let options = core::mem::take(&mut self.options);
        // `P.log` and `Lexer.log` are both `NonNull<Log>` (see P.rs / lexer.rs
        // field docs), so handing the same raw pointer to both is defined —
        // no `&mut` is materialized.
        let mut __p = init_p!(JavaScriptParser<'_>;
            self.bump, self.log, self.source, self.define, lexer, options, false);
        // SAFETY: `init_p!` only yields after `init` succeeded.
        let p: &mut JavaScriptParser<'_> = unsafe { __p.assume_init_mut() };

        // Instead of doing "should_fold_typescript_constant_expressions or features.minify_syntax"
        // Let's enable this flag file-wide
        if p.options.features.minify_syntax || p.options.features.inlining {
            p.should_fold_typescript_constant_expressions = true;
        }

        // If we added to `p.symbols` it's going to fuck up all the indices
        // in the `symbols` array.
        debug_assert!(p.symbols.len() == 0);
        // The buffer is already arena-backed, so this is a plain move.
        p.symbols = symbols;

        p.prepare_for_visit_pass()?;

        let mut final_expr = expr;

        // TOML date/time literals become `Temporal.*.from("...")` calls over
        // a real unbound symbol, so the chunk renamer reserves the name
        // instead of letting a user `Temporal` binding capture it.
        if p.options.lower_toml_datetimes {
            let mut temporal_ref: Option<js_ast::Ref> = None;
            lower_date_time_literals(p, &mut final_expr, &mut temporal_ref)?;
        }

        // Optionally call a runtime API function to transform the expression
        if !runtime_api_call.is_empty() {
            let args_slice: &mut [Expr] = p.arena.alloc_slice_fill_with(1, |_| expr);
            let args = Vec::from_arena_slice(args_slice);
            final_expr = p.call_runtime(expr.loc, runtime_api_call, args);
        }

        let ns_export_part = js_ast::Part {
            can_be_removed_if_unused: true,
            ..Default::default()
        };

        let lazy_data = js_ast::StoreRef::from_bump(p.arena.alloc(final_expr.data));
        let stmts: &mut [Stmt] = p.arena.alloc_slice_fill_with(1, |_| Stmt {
            data: js_ast::StmtData::SLazyExport(lazy_data),
            loc: expr.loc,
        });
        let part = js_ast::Part {
            stmts: stmts.into(),
            symbol_uses: p.take_symbol_uses()?,
            ..Default::default()
        };
        let mut parts = BumpVec::with_capacity_in(2, p.arena);
        parts.push(ns_export_part);
        parts.push(part);

        let exports_kind: js_ast::ExportsKind = 'brk: {
            if matches!(expr.data, js_ast::ExprData::EUndefined(_)) {
                let ext = self.source.path.name().ext;
                if ext == b".cjs" {
                    break 'brk js_ast::ExportsKind::Cjs;
                }
                if ext == b".mjs" {
                    break 'brk js_ast::ExportsKind::Esm;
                }
            }
            js_ast::ExportsKind::None
        };
        Ok(crate::Result::Ast(p.to_ast(
            &mut parts,
            exports_kind,
            WrapMode::None,
            b"",
        )?))
    }
}

/// A container queued by `lower_date_time_literals`' worklist.
enum DateTimeLowerContainer {
    Object(js_ast::StoreRef<E::Object>),
    Array(js_ast::StoreRef<E::Array>),
}

/// Rewrites every `toml_datetime`-tagged `E::String` in `expr` (in place)
/// into a `Temporal.<Class>.from("<text>")` call, declaring the unbound
/// `Temporal` symbol on first use. The calls are pure-annotated so tree
/// shaking may drop unused exports. Iterative: deep dotted TOML headers nest
/// objects far beyond safe recursion depth.
fn lower_date_time_literals<'a>(
    p: &mut JavaScriptParser<'a>,
    expr: &mut Expr,
    temporal_ref: &mut Option<js_ast::Ref>,
) -> Result<(), Error> {
    let mut work: Vec<DateTimeLowerContainer> = Vec::new();
    lower_one_date_time_literal(p, expr, temporal_ref, &mut work)?;
    while let Some(container) = work.pop() {
        match container {
            DateTimeLowerContainer::Object(mut obj) => {
                for property in obj.properties.slice_mut() {
                    if let Some(value) = &mut property.value {
                        lower_one_date_time_literal(p, value, temporal_ref, &mut work)?;
                    }
                }
            }
            DateTimeLowerContainer::Array(mut arr) => {
                for item in arr.items.slice_mut() {
                    lower_one_date_time_literal(p, item, temporal_ref, &mut work)?;
                }
            }
        }
    }
    Ok(())
}

fn lower_one_date_time_literal<'a>(
    p: &mut JavaScriptParser<'a>,
    expr: &mut Expr,
    temporal_ref: &mut Option<js_ast::Ref>,
    work: &mut Vec<DateTimeLowerContainer>,
) -> Result<(), Error> {
    match expr.data {
        js_ast::ExprData::EString(str) if str.toml_datetime.is_some() => {
            let ref_ = match *temporal_ref {
                Some(ref_) => ref_,
                None => {
                    let ref_ =
                        p.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"Temporal")?;
                    *temporal_ref = Some(ref_);
                    ref_
                }
            };
            let (class, text) = {
                let str = str.get();
                let kind = str.toml_datetime.expect("infallible: guard checked");
                (kind.temporal_class(), str.slice8())
            };
            let loc = expr.loc;
            p.record_usage(ref_);
            let namespace = p.new_expr(E::Identifier::init(ref_), loc);
            let class_dot = p.new_expr(
                E::Dot {
                    target: namespace,
                    name: E::Str::new(class),
                    name_loc: loc,
                    can_be_removed_if_unused: true,
                    ..Default::default()
                },
                loc,
            );
            let from_dot = p.new_expr(
                E::Dot {
                    target: class_dot,
                    name: E::Str::new(b"from"),
                    name_loc: loc,
                    can_be_removed_if_unused: true,
                    ..Default::default()
                },
                loc,
            );
            let arg = p.new_expr(E::String::init(text), loc);
            let args_slice: &mut [Expr] = p.arena.alloc_slice_fill_with(1, |_| arg);
            *expr = p.new_expr(
                E::Call {
                    target: from_dot,
                    args: Vec::from_arena_slice(args_slice),
                    can_be_unwrapped_if_unused: E::CallUnwrap::IfUnused,
                    ..Default::default()
                },
                loc,
            );
        }
        js_ast::ExprData::EArray(arr) => work.push(DateTimeLowerContainer::Array(arr)),
        js_ast::ExprData::EObject(obj) => work.push(DateTimeLowerContainer::Object(obj)),
        _ => {}
    }
    Ok(())
}

impl<'a> Parser<'a> {
    fn _parse<const TS: bool>(self) -> Result<crate::Result<'a>, Error> {
        // `Source.path` is `Path<'static>`, so
        // `path.text` satisfies `Action::Parse(&'static [u8])` directly.
        let _action_guard = bun_crash_handler::scoped_action(bun_crash_handler::Action::Parse(
            self.source.path.text,
        ));

        // `parse()` consumes `self` by value, so we
        // destructure here and hand the owned `lexer`/`options` straight to
        // `P::init` — no `ptr::read`/`mem::replace` placeholder dance, no
        // double-free hazard.
        let Parser {
            options,
            lexer,
            log,
            source,
            define,
            bump,
            orig_error_count,
        } = self;

        // `P.log` and `Lexer.log` are both `NonNull<Log>` (see P.rs / lexer.rs
        // field docs), so handing the same raw pointer to both is defined —
        // no `&mut` is materialized.
        let mut __p = init_p!(P<'_, TS>;
            bump, log, source, define, lexer, options, false);
        // SAFETY: `init_p!` only yields after `init` succeeded.
        let p: &mut P<'_, TS> = unsafe { __p.assume_init_mut() };

        if p.options.features.hot_module_reloading {
            debug_assert!(!p.options.tree_shaking);
        }

        // Instead of doing "should_fold_typescript_constant_expressions or features.minify_syntax"
        // Let's enable this flag file-wide
        if p.options.features.minify_syntax || p.options.features.inlining {
            p.should_fold_typescript_constant_expressions = true;
        }

        // Pre-sized to typical worst-case binary-expression nesting depth.
        p.binary_expression_stack = BumpVec::with_capacity_in(41, p.arena);
        p.binary_expression_simplify_stack = BumpVec::with_capacity_in(47, p.arena);

        // Consume a leading hashbang comment
        let mut hashbang: &[u8] = b"";
        if p.lexer.token == js_lexer::T::THashbang {
            hashbang = p.lexer.identifier;
            p.lexer.next()?;
        }

        // The first token may already have logged an error; halt before the early returns below.
        if p.log().errors > orig_error_count {
            return Err(crate::Error::SyntaxError);
        }

        // Detect a leading "// @bun" pragma
        if p.options.features.dont_bundle_twice {
            if let Some(pragma) = Self::has_bun_pragma(&source.contents, !hashbang.is_empty()) {
                return Ok(crate::Result::AlreadyBundled(pragma));
            }
        }

        // We must check the cache only after we've consumed the hashbang and leading // @bun pragma
        // We don't want to ever put files with `// @bun` into this cache, as that would be wasteful.
        #[cfg(not(target_arch = "wasm32"))]
        if bun_core::feature_flags::RUNTIME_TRANSPILER_CACHE {
            if let Some(cache) = p.options.features.runtime_transpiler_cache_mut() {
                // `Path::is_node_module`/`is_jsx_file` live on the resolver
                // `fs::Path` (not the logger stub) — their bodies are inlined here.
                let path = &p.source.path;
                #[cfg(windows)]
                const NM: &[u8] = b"\\node_modules\\";
                #[cfg(not(windows))]
                const NM: &[u8] = b"/node_modules/";
                let name = path.name();
                let is_node_module = strings::last_index_of(name.dir, NM).is_some();
                let is_jsx_file = strings::has_suffix_comptime(name.filename, b".jsx")
                    || strings::has_suffix_comptime(name.filename, b".tsx");
                if cache.get(
                    p.source,
                    core::ptr::NonNull::from(&p.options).cast::<()>(),
                    p.options.jsx.parse && (!is_node_module || is_jsx_file),
                ) {
                    return Ok(crate::Result::Cached);
                }
            }
        }

        // Parse the file in the first pass, but do not bind symbols
        let mut opts = ParseStatementOptions {
            scope: StatementScope::Module,
            ..Default::default()
        };
        let mut parse_tracer = bun_core::perf::trace("JSParser::parse");

        // Parsing seems to take around 2x as much time as visiting.
        // Which makes sense.
        // June 4: "Parsing took: 18028000"
        // June 4: "Rest of this took: 8003000"
        let stmts: &'a mut [Stmt] = match p.parse_stmts_up_to(js_lexer::T::TEndOfFile, &mut opts) {
            Ok(s) => s.into_bump_slice_mut(),
            Err(e) => {
                parse_tracer.end();
                if e == crate::Error::StackOverflow {
                    // The lexer location won't be totally accurate, but it's kind of helpful.
                    p.log().add_error(
                        Some(p.source),
                        p.lexer.loc(),
                        b"Maximum call stack size exceeded",
                    );

                    // Return a SyntaxError so that we reuse existing code for handling errors.
                    return Err(crate::Error::SyntaxError);
                }

                return Err(e);
            }
        };

        parse_tracer.end();

        // Halt parsing right here if there were any errors
        // This fixes various conditions that would cause crashes due to the AST being in an invalid state while visiting
        // In a number of situations, we continue to parsing despite errors so that we can report more errors to the user
        //   Example where NOT halting causes a crash: A TS enum with a number literal as a member name
        //     https://discord.com/channels/876711213126520882/876711213126520885/1039325382488371280
        if p.log().errors > orig_error_count {
            return Err(crate::Error::SyntaxError);
        }

        // A second guard dropped at end of `_parse` restores the previous action.
        let _visit_action_guard =
            bun_crash_handler::scoped_action(bun_crash_handler::Action::Visit(source.path.text));

        let mut visit_tracer = bun_core::perf::trace("JSParser::visit");
        p.prepare_for_visit_pass()?;

        if p.options.features.react_compiler.is_enabled() {
            let rc_options = bun_react_compiler::ReactCompilerOptions {
                enabled: true,
                is_dev: p.options.jsx.development,
                parse_test_pragmas: p.options.features.react_compiler_parse_test_pragmas,
                output_mode: p
                    .options
                    .features
                    .react_compiler
                    .is_ssr()
                    .then(|| "ssr".to_owned()),
                ..Default::default()
            };
            let opt_out = bun_react_compiler::has_module_scope_opt_out(stmts);
            let import_bindings = bun_react_compiler::collect_import_bindings(
                stmts,
                p.import_records.items(),
                p.symbols.as_slice(),
            );
            p.react_compiler = Some(Box::new(bun_react_compiler::ReactCompilerState::new(
                rc_options,
                opt_out,
                import_bindings,
            )));
        }

        let mut before = BumpVec::<js_ast::Part>::new_in(p.arena);
        let mut after = BumpVec::<js_ast::Part>::new_in(p.arena);
        let mut parts = BumpVec::<js_ast::Part>::with_capacity_in(stmts.len() + 2, p.arena);
        // (Element ownership is transferred into `parts` below via bitwise copy + set_len(0).)

        if p.options.bundle {
            // The bundler requires a part for generated module wrappers. This
            // part must be at the start as it is referred to by index.
            before.push(js_ast::Part::default());
        }

        // --inspect-brk
        if p.options.features.set_breakpoint_on_first_line {
            let debugger_stmts = p.arena.alloc_slice_fill_with(1, |_| Stmt {
                data: js_ast::StmtData::SDebugger(Default::default()),
                loc: bun_ast::Loc::EMPTY,
            });
            before.push(js_ast::Part {
                stmts: debugger_stmts.into(),
                ..Default::default()
            });
        }

        // When "using" declarations appear at the top level, we change all TDZ
        // variables in the top-level scope into "var" so that they aren't harmed
        // when they are moved into the try/catch statement that lowering will
        // generate.
        //
        // This is necessary because exported function declarations must be hoisted
        // outside of the try/catch statement because they can be evaluated before
        // this module is evaluated due to ESM cross-file function hoisting. And
        // these function bodies might reference anything else in this scope, which
        // must still work when those things are moved inside a try/catch statement.
        //
        // Before:
        //
        //   using foo = get()
        //   export function fn() {
        //     return [foo, new Bar]
        //   }
        //   class Bar {}
        //
        // After ("fn" is hoisted, "Bar" is converted to "var"):
        //
        //   export function fn() {
        //     return [foo, new Bar]
        //   }
        //   try {
        //     var foo = get();
        //     var Bar = class {};
        //   } catch (_) {
        //     ...
        //   } finally {
        //     ...
        //   }
        //
        // This is also necessary because other code might be appended to the code
        // that we're processing and expect to be able to access top-level variables.
        p.will_wrap_module_in_try_catch_for_using = p.should_lower_using_declarations(stmts);

        // Bind symbols in a second pass over the AST. I started off doing this in a
        // single pass, but it turns out it's pretty much impossible to do this
        // correctly while handling arrow functions because of the grammar
        // ambiguities.
        //
        // Note that top-level lowered "using" declarations disable tree-shaking
        // because we only do tree-shaking on top-level statements and lowering
        // a top-level "using" declaration moves all top-level statements into a
        // nested scope.
        if !p.options.tree_shaking || p.will_wrap_module_in_try_catch_for_using {
            // When tree shaking is disabled, everything comes in a single part
            p.append_part(&mut parts, stmts)?;
        } else {
            // Preprocess TypeScript enums to improve code generation. Otherwise
            // uses of an enum before that enum has been declared won't be inlined:
            //
            //   console.log(Foo.FOO) // We want "FOO" to be inlined here
            //   const enum Foo { FOO = 0 }
            //
            // The TypeScript compiler itself contains code with this pattern, so
            // it's important to implement this optimization.

            // `Loc` lacks `Hash` (logger crate), so the
            // `scopes_in_order_for_enum` lookups linear-scan `keys()` —
            // fine at small N (one
            // entry per top-level `enum`). `scope_order_to_visit` is
            // `&'a [_]` (a `Copy` cursor) so save/restore is a plain value
            // copy.
            let arena = p.arena;
            let mut preprocessed_enums: BumpVec<BumpVec<'a, js_ast::Part>> = BumpVec::new_in(arena);
            let mut preprocessed_enum_i: usize = 0;
            if p.scopes_in_order_for_enum.count() > 0 {
                for stmt in stmts.iter_mut() {
                    if matches!(stmt.data, js_ast::StmtData::SEnum(_)) {
                        let old_scopes_in_order = p.scope_order_to_visit;
                        let idx = p
                            .scopes_in_order_for_enum
                            .keys()
                            .iter()
                            .position(|k| *k == stmt.loc)
                            .expect("enum scope-order entry recorded during parse");
                        // Map stores `&'a [ScopeOrder]`; shared borrow may freely alias the inner
                        // re-lookup performed by `append_part → visit_stmts`.
                        p.scope_order_to_visit = p.scopes_in_order_for_enum.values()[idx];

                        let mut enum_parts = BumpVec::<js_ast::Part>::new_in(arena);
                        let sliced = arena.alloc_slice_copy(&[*stmt]);
                        p.append_part(&mut enum_parts, sliced)?;
                        preprocessed_enums.push(enum_parts);

                        p.scope_order_to_visit = old_scopes_in_order;
                    }
                }
            }

            // When tree shaking is enabled, each top-level statement is potentially a separate part.
            for stmt in stmts.iter() {
                match &stmt.data {
                    js_ast::StmtData::SLocal(local) => {
                        if (local.decls.len_u32() as usize) > 1 {
                            for decl in local.decls.slice() {
                                // `S::Local`/`Decl` are not `Copy`;
                                // rebuild the struct instead of `**local`.
                                let _local = S::Local {
                                    kind: local.kind,
                                    is_export: local.is_export,
                                    origin: local.origin,
                                    decls: G::DeclList::init_one(G::Decl {
                                        binding: decl.binding,
                                        value: decl.value,
                                    }),
                                };
                                let new_stmt = p.s(_local, stmt.loc);
                                let sliced = arena.alloc_slice_copy(&[new_stmt]);
                                p.append_part(&mut parts, sliced)?;
                            }
                        } else {
                            let sliced = arena.alloc_slice_copy(&[*stmt]);
                            p.append_part(&mut parts, sliced)?;
                        }
                    }
                    js_ast::StmtData::SImport(_)
                    | js_ast::StmtData::SExportFrom(_)
                    | js_ast::StmtData::SExportStar(_) => {
                        let parts_list = if p.options.bundle {
                            // Move imports (and import-like exports) to the top of the file to
                            // ensure that if they are converted to a require() call, the effects
                            // will take place before any other statements are evaluated.
                            &mut before
                        } else {
                            // If we aren't doing any format conversion, just keep these statements
                            // inline where they were. Exports are sorted so order doesn't matter:
                            // https://262.ecma-international.org/6.0/#sec-module-namespace-exotic-objects.
                            // However, this is likely an aesthetic issue that some people will
                            // complain about. In addition, there are code transformation tools
                            // such as TypeScript and Babel with bugs where the order of exports
                            // in the file is incorrectly preserved instead of sorted, so preserving
                            // the order of exports ourselves here may be preferable.
                            &mut parts
                        };

                        let sliced = arena.alloc_slice_copy(&[*stmt]);
                        p.append_part(parts_list, sliced)?;
                    }

                    js_ast::StmtData::SClass(class) => {
                        // Move class export statements to the top of the file if we can
                        // This automatically resolves some cyclical import issues
                        // https://github.com/kysely-org/kysely/issues/412
                        let should_move = !p.options.bundle && class.class.can_be_moved();

                        let sliced = arena.alloc_slice_copy(&[*stmt]);
                        p.append_part(&mut parts, sliced)?;

                        if should_move {
                            // `Part` isn't `Copy`; pop+push instead of last+truncate.
                            before.push(parts.pop().expect("unreachable"));
                        }
                    }
                    js_ast::StmtData::SExportDefault(value) => {
                        // We move export default statements when we can
                        // This automatically resolves some cyclical import issues in packages like luxon
                        // https://github.com/oven-sh/bun/issues/1961
                        let should_move = !p.options.bundle && value.can_be_moved();
                        let sliced = arena.alloc_slice_copy(&[*stmt]);
                        p.append_part(&mut parts, sliced)?;

                        if should_move {
                            before.push(parts.pop().expect("unreachable"));
                        }
                    }
                    js_ast::StmtData::SEnum(_) => {
                        // `Part` isn't `Clone`; move out the
                        // pre-visited parts instead of `appendSlice`.
                        let enum_parts = core::mem::replace(
                            &mut preprocessed_enums[preprocessed_enum_i],
                            BumpVec::new_in(arena),
                        );
                        for part in enum_parts {
                            parts.push(part);
                        }
                        preprocessed_enum_i += 1;

                        let idx = p
                            .scopes_in_order_for_enum
                            .keys()
                            .iter()
                            .position(|k| *k == stmt.loc)
                            .expect("enum scope-order entry");
                        let enum_scope_count = p.scopes_in_order_for_enum.values()[idx].len();
                        // Advance the shared-slice cursor past this enum's scopes.
                        p.scope_order_to_visit = &p.scope_order_to_visit[enum_scope_count..];
                    }
                    _ => {
                        let sliced = arena.alloc_slice_copy(&[*stmt]);
                        p.append_part(&mut parts, sliced)?;
                    }
                }
            }
        }

        visit_tracer.end();

        // If there were errors while visiting, also halt here
        if p.log().errors > orig_error_count {
            return Err(crate::Error::SyntaxError);
        }

        // `perf::Ctx` ends the span in its `Drop` impl — bind it for the rest of `_parse`.
        let _postvisit_tracer = bun_core::perf::trace("JSParser::postvisit");

        let mut uses_dirname =
            p.symbols.as_slice()[p.dirname_ref.inner_index() as usize].use_count_estimate > 0;
        let mut uses_filename =
            p.symbols.as_slice()[p.filename_ref.inner_index() as usize].use_count_estimate > 0;

        // Handle dirname and filename at bundle-time
        // We always inject it at the top of the module
        //
        // This inlines
        //
        //    var __dirname = "foo/bar"
        //    var __filename = "foo/bar/baz.js"
        //
        if p.options.bundle || !p.options.features.commonjs_at_runtime {
            if uses_dirname || uses_filename {
                let count = (uses_dirname as usize) + (uses_filename as usize);
                let mut declared_symbols =
                    bun_ast::DeclaredSymbolList::init_capacity(count).expect("unreachable");
                let decls = p
                    .arena
                    .alloc_slice_fill_with::<G::Decl, _>(count, |_| G::Decl::default());
                if uses_dirname {
                    decls[0] = G::Decl {
                        binding: p.b(
                            B::Identifier {
                                r#ref: p.dirname_ref,
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                        value: Some(p.new_expr(
                            E::String {
                                data: p.source.path.name().dir.into(),
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        )),
                    };
                    declared_symbols.append_assume_capacity(DeclaredSymbol {
                        ref_: p.dirname_ref,
                        is_top_level: true,
                    });
                }
                if uses_filename {
                    decls[uses_dirname as usize] = G::Decl {
                        binding: p.b(
                            B::Identifier {
                                r#ref: p.filename_ref,
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                        value: Some(p.new_expr(
                            E::String {
                                data: p.source.path.text.into(),
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        )),
                    };
                    declared_symbols.append_assume_capacity(DeclaredSymbol {
                        ref_: p.filename_ref,
                        is_top_level: true,
                    });
                }

                let part_stmts = p.arena.alloc_slice_fill_with(1, |_| {
                    p.s(
                        S::Local {
                            kind: js_ast::LocalKind::KVar,
                            decls: {
                                let mut dl = G::DeclList::init_capacity(decls.len());
                                for d in decls.iter_mut() {
                                    dl.append_assume_capacity(core::mem::take(d));
                                }
                                dl
                            },
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    )
                });
                before.push(js_ast::Part {
                    stmts: part_stmts.into(),
                    declared_symbols,
                    tag: bun_ast::PartTag::DirnameFilename,
                    ..Default::default()
                });
                uses_dirname = false;
                uses_filename = false;
            }
        }

        // Finalize referenced-export tracking for `import("str")` /
        // `require("str")`. Several namespace refs may exist for one import
        // record (the synthetic ref from `transpose_import` plus a
        // `const ns = …` / `.then(ns => …)` / `{...rest}` local). A record is
        // fully tracked only when *every* such ref had all its uses accounted
        // for (`use_count_estimate == 0`); the alias set is the union across
        // them. Untracked records get no entry and keep every export.
        if !p
            .imports_to_convert_from_dynamic_import
            .as_slice()
            .is_empty()
        {
            #[derive(Default)]
            struct PerRecord {
                escaped: bool,
                aliases: Vec<bun_ast::StoreStr>,
                items: Vec<bun_ast::ast_result::DynamicImportItem>,
                /// A name is read some other way (a `{...rest}` copy, a local
                /// that stays one), so the call's value must hold it.
                needs_value: bool,
            }
            let mut by_record: bun_collections::ArrayHashMap<u32, PerRecord> = Default::default();
            // A namespace ref is listed once per registration and once per
            // destructure of it; its alias map only needs one walk.
            let mut seen_namespace: bun_collections::HashMap<(bun_ast::Ref, u32), ()> =
                Default::default();
            let arena = p.arena;
            for i in 0..p.imports_to_convert_from_dynamic_import.len() {
                let (ns_ref, import_record_id, scope) = {
                    let d = &p.imports_to_convert_from_dynamic_import[i];
                    (d.namespace.ref_, d.import_record_id, d.scope)
                };
                let escaped = {
                    let symbol = &p.symbols[ns_ref.inner_index() as usize];
                    // `must_not_be_renamed` / `contains_direct_eval` cover
                    // direct `eval()` (or `with`) in scope, which can read the
                    // namespace by name without a tracked property access. A
                    // linked symbol was merged with another declaration (a
                    // hoisted `var`, a parameter), so its own use count says
                    // nothing.
                    let tracked = p.namespace_tracked_uses.get(&ns_ref).copied().unwrap_or(0);
                    // A source-visible local escapes when it has uses nobody
                    // accounted for; the synthetic per-`import()` ref (never
                    // referenced in source) escapes when its one consumer did not.
                    (if p.dynamic_import_namespace_locals.contains_key(&ns_ref) {
                        symbol.use_count_estimate > tracked || tracked == u32::MAX
                    } else {
                        tracked == 0
                    }) || symbol.must_not_be_renamed()
                        || symbol.has_link()
                        || scope.is_some_and(|s| s.contains_direct_eval)
                        || p.dynamic_import_escaped_records
                            .contains_key(&import_record_id)
                };
                let entry = bun_core::handle_oom(by_record.get_or_put(import_record_id));
                if !entry.found_existing {
                    *entry.value_ptr = PerRecord::default();
                }
                let rec = entry.value_ptr;
                rec.escaped |= escaped;
                if rec.escaped
                    || seen_namespace
                        .insert((ns_ref, import_record_id), ())
                        .is_some()
                {
                    continue;
                }
                let Some(map) = p.import_items_for_namespace.get(&ns_ref) else {
                    continue;
                };
                for (key, loc_ref) in map.keys().iter().zip(map.values().iter()) {
                    let local = loc_ref.ref_;
                    // A destructured local that is never read does not keep
                    // its export alive — unless it was merged with another
                    // declaration or a direct `eval` can read it by name.
                    if local.is_valid() {
                        let symbol = &p.symbols[local.inner_index() as usize];
                        if symbol.use_count_estimate == 0
                            && !symbol.has_link()
                            && !symbol.must_not_be_renamed()
                        {
                            continue;
                        }
                    }
                    let alias = bun_ast::StoreStr::new(arena.alloc_slice_copy(key));
                    rec.aliases.push(alias);
                    let is_require_marker = p
                        .import_records
                        .items()
                        .get(import_record_id as usize)
                        .is_some_and(|record| crate::p::is_require_marker(record, key));
                    // A read off `ns` (an item already), or a local a pattern
                    // binds. Assigning to either, or reaching the local through
                    // a hoisting merge or a direct `eval`, keeps the read as
                    // written.
                    let is_item = local.is_valid()
                        && !is_require_marker
                        && (p.is_import_item.contains_key(&local)
                            || p.dynamic_import_destructured_locals.contains_key(&local))
                        && !p.symbols[ns_ref.inner_index() as usize].has_been_assigned_to()
                        && p.dynamic_import_namespace_locals
                            .get(&ns_ref)
                            .is_none_or(|records| records.len() == 1)
                        && {
                            let symbol = &p.symbols[local.inner_index() as usize];
                            !symbol.has_been_assigned_to()
                                && !symbol.has_link()
                                && !symbol.must_not_be_renamed()
                                && !p.named_imports.contains(&local)
                        };
                    if is_item {
                        rec.items.push(bun_ast::ast_result::DynamicImportItem {
                            local,
                            alias,
                            namespace_ref: ns_ref,
                        });
                    } else {
                        rec.needs_value = true;
                    }
                }
            }

            for i in 0..by_record.len() {
                let import_record_id = by_record.keys()[i];
                let rec = &mut by_record.values_mut()[i];
                if rec.escaped {
                    continue;
                }
                rec.aliases.sort_by(|a, b| a.slice().cmp(b.slice()));
                rec.aliases.dedup_by(|a, b| a.slice() == b.slice());
                let aliases = arena.alloc_slice_copy(&rec.aliases);
                let items = arena.alloc_slice_copy(&rec.items);
                bun_core::handle_oom(
                    p.dynamic_import_aliases.put(
                        import_record_id,
                        bun_ast::ast_result::DynamicImportUse {
                            aliases: bun_ast::StoreSlice::new(aliases),
                            items: bun_ast::StoreSlice::new(items),
                            needs_namespace_object: rec.needs_value
                                || p.dynamic_import_needs_object
                                    .contains_key(&import_record_id),
                        },
                    ),
                );
            }
        }

        // This is a workaround for broken module environment checks in packages like lodash-es
        // https://github.com/lodash/lodash/issues/5660
        let mut force_esm = false;

        if p.should_unwrap_commonjs_to_esm() {
            if !p.imports_to_convert_from_require.as_slice().is_empty() {
                let all_stmts = p.arena.alloc_slice_fill_with::<Stmt, _>(
                    p.imports_to_convert_from_require.len(),
                    |_| Stmt {
                        loc: bun_ast::Loc::EMPTY,
                        data: js_ast::StmtData::SEmpty(S::Empty {}),
                    },
                );
                before.reserve(p.imports_to_convert_from_require.len());

                let mut remaining_stmts: &mut [Stmt] = all_stmts;

                for i in 0..p.imports_to_convert_from_require.len() {
                    // borrowck — copy out the three Copy fields so the
                    // immutable borrow of `p.imports_to_convert_from_require`
                    // ends before `p.module_scope_mut()` takes `&mut self`.
                    let (ns_ref, ns_loc, import_record_id) = {
                        let deferred_import = &p.imports_to_convert_from_require[i];
                        (
                            deferred_import.namespace.ref_,
                            deferred_import.namespace.loc,
                            deferred_import.import_record_id,
                        )
                    };
                    let (import_part_stmts, rest) = remaining_stmts.split_at_mut(1);
                    remaining_stmts = rest;

                    VecExt::append(&mut p.module_scope_mut().generated, ns_ref);

                    import_part_stmts[0] = Stmt::alloc(
                        S::Import {
                            star_name_loc: ns_loc,
                            import_record_index: import_record_id,
                            namespace_ref: ns_ref,
                            default_name: None,
                            items: bun_ast::StoreSlice::EMPTY,
                            is_single_line: false,
                            phase_defer: false,
                        },
                        ns_loc,
                    );
                    let mut declared_symbols =
                        bun_ast::DeclaredSymbolList::init_capacity(1).expect("unreachable");
                    declared_symbols.append_assume_capacity(DeclaredSymbol {
                        ref_: ns_ref,
                        is_top_level: true,
                    });
                    before.push(js_ast::Part {
                        stmts: import_part_stmts.into(),
                        declared_symbols,
                        tag: bun_ast::PartTag::ImportToConvertFromRequire,
                        // This part has a single symbol, so it may be removed if unused.
                        can_be_removed_if_unused: true,
                        ..Default::default()
                    });
                }
                debug_assert!(remaining_stmts.is_empty());
            }

            if p.commonjs_named_exports.count() > 0 {
                // borrowck — `deoptimize_commonjs_named_exports` mut-borrows
                // `self`, so the `values()`/`keys()` slices are read once into locals.
                let export_names_len = p.commonjs_named_exports.keys().len();
                let first_export_ref_loc = p.commonjs_named_exports.values()[0].loc_ref.loc;
                let export_refs_len = p.commonjs_named_exports.values().len();

                'break_optimize: {
                    if !p.commonjs_named_exports_deoptimized {
                        let mut needs_decl_count: usize = 0;
                        for export_ref in p.commonjs_named_exports.values().iter() {
                            needs_decl_count += export_ref.needs_decl as usize;
                        }
                        // This is a workaround for packages which have broken ESM checks
                        // If they never actually assign to exports.foo, only check for it
                        // and the package specifies type "module"
                        // and the package uses ESM syntax
                        // We should just say
                        // You're ESM and lying about it.
                        if p.options.module_type == options::ModuleType::Esm
                            || p.has_es_module_syntax
                        {
                            if needs_decl_count == export_names_len {
                                force_esm = true;
                                break 'break_optimize;
                            }
                        }

                        if needs_decl_count > 0 || p.has_top_level_function_merged_with_var {
                            p.symbols.as_mut_slice()[p.exports_ref.inner_index() as usize]
                                .use_count_estimate += export_refs_len as u32;
                            p.deoptimize_commonjs_named_exports();
                        } else if p.symbols.as_slice()[p.module_ref.inner_index() as usize]
                            .use_count_estimate
                            > p.module_exports_rewrite_count
                        {
                            // `module.constructor` and other uses of `module` need the wrapper.
                            p.deoptimize_commonjs_named_exports();
                        }
                    }
                }

                if !p.commonjs_named_exports_deoptimized && p.esm_export_keyword.len == 0 {
                    p.esm_export_keyword.loc = first_export_ref_loc;
                    p.esm_export_keyword.len = 5;
                }
            }
        }

        if parts.len() < 4 && parts.len() > 0 && p.options.features.unwrap_commonjs_to_esm {
            // Specially handle modules shaped like this:
            //
            //   CommonJS:
            //
            //    if (process.env.NODE_ENV === 'production')
            //         module.exports = require('./foo.prod.js')
            //     else
            //         module.exports = require('./foo.dev.js')
            //
            // Find the part containing the actual module.exports = require() statement,
            // skipping over parts that only contain comments, directives, and empty statements.
            // This handles files like:
            //
            //    /*!
            //     * express
            //     * MIT Licensed
            //     */
            //    'use strict';
            //    module.exports = require('./lib/express');
            //
            // When tree-shaking is enabled, each statement becomes its own part, so we need
            // to look across all parts to find the single meaningful statement.
            struct StmtAndPart {
                stmt: Stmt,
                part_idx: usize,
            }
            let stmt_and_part: Option<StmtAndPart> = 'brk: {
                let mut found: Option<StmtAndPart> = None;
                for (part_idx, part) in parts.iter().enumerate() {
                    // `Part.stmts` is a `StoreSlice<Stmt>` (arena-owned). It is
                    // only ever populated from bump-allocated slices in this fn.
                    for s in part.stmts.iter() {
                        match s.data {
                            js_ast::StmtData::SComment(_)
                            | js_ast::StmtData::SDirective(_)
                            | js_ast::StmtData::SEmpty(_) => continue,
                            _ => {
                                // If we already found a non-trivial statement, there's more than one
                                if found.is_some() {
                                    break 'brk None;
                                }
                                found = Some(StmtAndPart { stmt: *s, part_idx });
                            }
                        }
                    }
                }
                found
            };
            if let Some(found) = stmt_and_part {
                let stmt = found.stmt;
                let part = &mut parts[found.part_idx];
                if p.symbols.as_slice()[p.module_ref.inner_index() as usize].use_count_estimate == 1
                {
                    if let js_ast::StmtData::SExpr(s_expr) = &stmt.data {
                        let value: Expr = s_expr.value;

                        if let js_ast::ExprData::EBinary(bin) = &value.data {
                            let left = bin.left;
                            let right = bin.right;
                            if bin.op == js_ast::op::Code::BinAssign
                                && matches!(&left.data, js_ast::ExprData::EDot(d)
                                    if d.name == b"exports"
                                        && matches!(&d.target.data, js_ast::ExprData::EIdentifier(id)
                                            if id.ref_.eql(p.module_ref)))
                            {
                                let redirect_import_record_index: Option<u32> = 'inner_brk: {
                                    // general case:
                                    //
                                    //      module.exports = require("foo");
                                    //
                                    if let js_ast::ExprData::ERequireString(req) = &right.data {
                                        break 'inner_brk Some(req.import_record_index);
                                    }

                                    // special case: a module for us to unwrap
                                    //
                                    //      module.exports = require("react/jsx-runtime")
                                    //                       ^ was converted into:
                                    //
                                    //      import * as Foo from 'bar';
                                    //      module.exports = Foo;
                                    //
                                    // This is what fixes #3537
                                    if let js_ast::ExprData::EIdentifier(id) = &right.data {
                                        if p.import_records.len() == 1
                                            && p.imports_to_convert_from_require.len() == 1
                                            && p.imports_to_convert_from_require.as_slice()[0]
                                                .namespace
                                                .ref_
                                                .eql(id.ref_)
                                        {
                                            // We know it's 0 because there is only one import in the whole file
                                            // so that one import must be the one we're looking for
                                            break 'inner_brk Some(0);
                                        }
                                    }

                                    None
                                };
                                if let Some(id) = redirect_import_record_index
                                    && !p.options.is_entry_point
                                {
                                    part.symbol_uses = Default::default();
                                    return Ok(crate::Result::Ast(Box::new(js_ast::Ast {
                                        import_records: p.import_records.move_to_baby_list(p.arena),
                                        redirect_import_record_index: Some(id),
                                        named_imports: core::mem::take(&mut *p.named_imports),
                                        named_exports: core::mem::take(&mut p.named_exports),
                                        ..js_ast::Ast::empty_in(p.arena)
                                    })));
                                }
                            }
                        }
                    }
                }
            }
        }

        // `checkDCE(); module.exports = require('./cjs/...')` (react-dom/index.js in production).
        // The unwrapped require() is already an `import * as ns`, so `export * from` replaces
        // the assignment and the file needs no wrapper (`convert_stmts_for_chunk` undoes it).
        if p.options.features.unwrap_commonjs_to_esm
            && p.unwrap_all_requires
            && !p.options.is_entry_point
            && !p.has_es_module_syntax
            && p.commonjs_named_exports.count() == 0
            && !p.has_top_level_return
            && !p.has_with_scope
            && !p.has_top_level_function_merged_with_var
            && p.symbols.as_slice()[p.module_ref.inner_index() as usize].use_count_estimate == 1
            && p.symbols.as_slice()[p.exports_ref.inner_index() as usize].use_count_estimate == 0
        {
            struct ModuleExportsOfNamespace {
                part_idx: usize,
                stmt_idx: usize,
                /// `checkDCE(), module.exports = ns` (the `if` block folded by
                /// minification): the operand before the assignment.
                leading: Option<Expr>,
                assign_loc: bun_ast::Loc,
                namespace_ref: js_ast::Ref,
                import_record_index: u32,
            }

            let found: Option<ModuleExportsOfNamespace> = 'search: {
                for (part_idx, part) in parts.iter().enumerate() {
                    for (stmt_idx, stmt) in part.stmts.iter().enumerate() {
                        let js_ast::StmtData::SExpr(s_expr) = &stmt.data else {
                            continue;
                        };
                        let value: Expr = s_expr.value;
                        let (leading, assign): (Option<Expr>, Expr) = match value.data {
                            js_ast::ExprData::EBinary(bin)
                                if bin.op == js_ast::op::Code::BinComma =>
                            {
                                (Some(bin.left), bin.right)
                            }
                            _ => (None, value),
                        };
                        let js_ast::ExprData::EBinary(bin) = assign.data else {
                            continue;
                        };
                        if bin.op != js_ast::op::Code::BinAssign
                            || !matches!(&bin.left.data, js_ast::ExprData::EDot(d)
                                if d.name == b"exports"
                                    && matches!(&d.target.data, js_ast::ExprData::EIdentifier(id)
                                        if id.ref_.eql(p.module_ref)))
                        {
                            continue;
                        }
                        let js_ast::ExprData::EIdentifier(id) = &bin.right.data else {
                            continue;
                        };
                        let Some(deferred) = p
                            .imports_to_convert_from_require
                            .iter()
                            .find(|deferred| deferred.namespace.ref_.eql(id.ref_))
                        else {
                            continue;
                        };
                        break 'search Some(ModuleExportsOfNamespace {
                            part_idx,
                            stmt_idx,
                            leading,
                            assign_loc: assign.loc,
                            namespace_ref: id.ref_,
                            import_record_index: deferred.import_record_id,
                        });
                    }
                }
                None
            };

            if let Some(found) = found {
                let part = &mut parts[found.part_idx];
                let stmt_loc = part.stmts.slice()[found.stmt_idx].loc;

                // Like `s_export_star`: the export star declares its own namespace symbol.
                let name = p.load_name_from_ref(found.namespace_ref);
                let export_star_ref = p.new_symbol(js_ast::symbol::Kind::Other, name);
                VecExt::append(&mut p.module_scope_mut().generated, export_star_ref);
                part.declared_symbols.append(DeclaredSymbol {
                    ref_: export_star_ref,
                    is_top_level: true,
                })?;

                part.stmts = {
                    let old_stmts: &[Stmt] = part.stmts.slice();
                    let mut new_stmts =
                        BumpVec::<Stmt>::with_capacity_in(old_stmts.len() + 1, p.arena);
                    new_stmts.extend_from_slice(&old_stmts[..found.stmt_idx]);
                    if let Some(leading) = found.leading {
                        new_stmts.push(Stmt::alloc(
                            S::SExpr {
                                value: leading,
                                does_not_affect_tree_shaking: false,
                            },
                            stmt_loc,
                        ));
                    }
                    new_stmts.push(Stmt::alloc(
                        S::ExportStar {
                            import_record_index: found.import_record_index,
                            namespace_ref: export_star_ref,
                            alias: None,
                        },
                        found.assign_loc,
                    ));
                    new_stmts.extend_from_slice(&old_stmts[found.stmt_idx + 1..]);
                    bun_ast::StoreSlice::from_bump(new_stmts)
                };

                // The assignment was the only use of `module` and one use of `ns`.
                let _ = part.symbol_uses.swap_remove(&p.module_ref);
                p.symbols.as_mut_slice()[p.module_ref.inner_index() as usize].use_count_estimate =
                    0;
                match part.symbol_uses.get_mut(&found.namespace_ref) {
                    Some(uses) if uses.count_estimate() > 1 => uses.subtract(1),
                    _ => {
                        let _ = part.symbol_uses.swap_remove(&found.namespace_ref);
                    }
                }
                let ns_symbol =
                    &mut p.symbols.as_mut_slice()[found.namespace_ref.inner_index() as usize];
                ns_symbol.use_count_estimate = ns_symbol.use_count_estimate.saturating_sub(1);
                let ns_is_unused = ns_symbol.use_count_estimate == 0
                    && !p
                        .import_items_for_namespace
                        .get(&found.namespace_ref)
                        .is_some_and(|items| items.count() > 0);
                if ns_is_unused {
                    // Drop the unused `import * as ns` part, keeping the other imports in order.
                    if let Some(i) = before.iter().position(|before_part| {
                        before_part.tag == bun_ast::PartTag::ImportToConvertFromRequire
                            && before_part
                                .declared_symbols
                                .refs()
                                .iter()
                                .any(|declared| declared.eql(found.namespace_ref))
                    }) {
                        let _ = before.remove(i);
                    }
                }

                if p.esm_export_keyword.len == 0 {
                    p.esm_export_keyword.loc = stmt_loc;
                    p.esm_export_keyword.len = 5;
                }
            }
        }

        // Analyze cross-part dependencies for tree shaking and code splitting.
        // The if/else-if/else-match below exhaustively assigns this on every path.
        let mut exports_kind: js_ast::ExportsKind;
        let exports_ref_usage_count =
            p.symbols.as_slice()[p.exports_ref.inner_index() as usize].use_count_estimate;
        let uses_exports_ref = exports_ref_usage_count > 0;

        if uses_exports_ref && p.commonjs_named_exports.count() > 0 && !force_esm {
            p.deoptimize_commonjs_named_exports();
        }

        let uses_module_ref =
            p.symbols.as_slice()[p.module_ref.inner_index() as usize].use_count_estimate > 0;

        let mut wrap_mode: WrapMode = WrapMode::None;
        // Checked after `to_ast`, which marks TypeScript type-only imports unused.
        let mut reject_import_statements = false;

        if p.is_deoptimized_commonjs() {
            exports_kind = js_ast::ExportsKind::Cjs;
        } else if p.esm_export_keyword.len > 0 || p.top_level_await_keyword.len > 0 {
            exports_kind = js_ast::ExportsKind::Esm;
        } else if uses_exports_ref || uses_module_ref || p.has_top_level_return || p.has_with_scope
        {
            exports_kind = js_ast::ExportsKind::Cjs;
            if p.options.features.commonjs_at_runtime {
                wrap_mode = WrapMode::BunCommonjs;
                reject_import_statements = true;
            }
        } else {
            match p.options.module_type {
                // ".cjs" or ".cts" or ("type: commonjs" and (".js" or ".jsx" or ".ts" or ".tsx"))
                options::ModuleType::Cjs => {
                    // There are no commonjs-only features used (require is allowed in ESM)
                    debug_assert!(
                        !uses_exports_ref
                            && !uses_module_ref
                            && !p.has_top_level_return
                            && !p.has_with_scope
                    );
                    // Use ESM if the file has ES module syntax (import)
                    exports_kind = if p.has_es_module_syntax {
                        js_ast::ExportsKind::Esm
                    } else {
                        js_ast::ExportsKind::Cjs
                    };
                }
                options::ModuleType::Esm => {
                    exports_kind = js_ast::ExportsKind::Esm;
                }
                options::ModuleType::Unknown => {
                    // Divergence from esbuild and Node.js: we default to ESM
                    // when there are no exports.
                    //
                    // However, this breaks certain packages.
                    // For example, the checkpoint-client used by
                    // Prisma does an eval("__dirname") but does not export
                    // anything.
                    //
                    // If they use an import statement, we say it's ESM because that's not allowed in CommonJS files.
                    let uses_any_import_statements = 'brk: {
                        for import_record in p.import_records.items() {
                            if import_record.flags.intersects(
                                ImportRecordFlags::IS_INTERNAL | ImportRecordFlags::IS_UNUSED,
                            ) {
                                continue;
                            }
                            if import_record.kind == bun_ast::ImportKind::Stmt {
                                break 'brk true;
                            }
                        }

                        false
                    };

                    if uses_any_import_statements {
                        exports_kind = js_ast::ExportsKind::Esm;
                    }
                    // Otherwise, if they use CommonJS features its CommonJS.
                    // If you add a 'use strict'; at the top, you probably meant CommonJS because "use strict"; does nothing in ESM.
                    else if p.symbols.as_slice()[p.require_ref.inner_index() as usize]
                        .use_count_estimate
                        > 0
                        || uses_dirname
                        || uses_filename
                        || (!p.options.bundle
                            // SAFETY: `module_scope` is non-null after `prepare_for_visit_pass`.
                            && p.module_scope().strict_mode
                                == bun_ast::StrictModeKind::ExplicitStrictMode)
                    {
                        exports_kind = js_ast::ExportsKind::Cjs;
                    } else {
                        // If unknown, we default to ESM
                        exports_kind = js_ast::ExportsKind::Esm;
                    }
                }
            }

            if exports_kind == js_ast::ExportsKind::Cjs && p.options.features.commonjs_at_runtime {
                wrap_mode = WrapMode::BunCommonjs;
            }
        }

        // Handle dirname and filename at runtime.
        //
        // If we reach this point, it means:
        //
        // 1) we are building an ESM file that uses __dirname or __filename
        // 2) we are targeting bun's runtime.
        // 3) we are not bundling.
        //
        if exports_kind == js_ast::ExportsKind::Esm && (uses_dirname || uses_filename) {
            debug_assert!(!p.options.bundle);
            let count = (uses_dirname as usize) + (uses_filename as usize);
            let mut declared_symbols =
                bun_ast::DeclaredSymbolList::init_capacity(count).expect("unreachable");
            let decls = p
                .arena
                .alloc_slice_fill_with::<G::Decl, _>(count, |_| G::Decl::default());
            if uses_dirname {
                // var __dirname = import.meta
                let import_meta = p.new_expr(E::ImportMeta {}, bun_ast::Loc::EMPTY);
                decls[0] = G::Decl {
                    binding: p.b(
                        B::Identifier {
                            r#ref: p.dirname_ref,
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                    value: Some(p.new_expr(
                        E::Dot {
                            name: b"dir".into(),
                            name_loc: bun_ast::Loc::EMPTY,
                            target: import_meta,
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    )),
                };
                declared_symbols.append_assume_capacity(DeclaredSymbol {
                    ref_: p.dirname_ref,
                    is_top_level: true,
                });
            }
            if uses_filename {
                // var __filename = import.meta.path
                let import_meta = p.new_expr(E::ImportMeta {}, bun_ast::Loc::EMPTY);
                decls[uses_dirname as usize] = G::Decl {
                    binding: p.b(
                        B::Identifier {
                            r#ref: p.filename_ref,
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                    value: Some(p.new_expr(
                        E::Dot {
                            name: b"path".into(),
                            name_loc: bun_ast::Loc::EMPTY,
                            target: import_meta,
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    )),
                };
                declared_symbols.append_assume_capacity(DeclaredSymbol {
                    ref_: p.filename_ref,
                    is_top_level: true,
                });
            }

            let part_stmts = p.arena.alloc_slice_fill_with(1, |_| {
                p.s(
                    S::Local {
                        kind: js_ast::LocalKind::KVar,
                        decls: {
                            let mut dl = G::DeclList::init_capacity(decls.len());
                            for d in decls.iter_mut() {
                                dl.append_assume_capacity(core::mem::take(d));
                            }
                            dl
                        },
                        ..Default::default()
                    },
                    bun_ast::Loc::EMPTY,
                )
            });
            before.push(js_ast::Part {
                stmts: part_stmts.into(),
                declared_symbols,
                tag: bun_ast::PartTag::DirnameFilename,
                ..Default::default()
            });
        }

        if exports_kind == js_ast::ExportsKind::Esm
            && p.commonjs_named_exports.count() > 0
            && !p.unwrap_all_requires
            && !force_esm
        {
            exports_kind = js_ast::ExportsKind::EsmWithDynamicFallbackFromCjs;
        }

        // Auto inject jest globals into the test file
        'outer: {
            if !p.options.features.inject_jest_globals {
                break 'outer;
            }

            for item in p.import_records.items() {
                // skip if they did import it
                if item.path.text == b"bun:test"
                    || item.path.text == b"@jest/globals"
                    || item.path.text == b"vitest"
                {
                    if let Some(cache) = p.options.features.runtime_transpiler_cache_mut() {
                        // If we rewrote import paths, we need to disable the runtime transpiler cache
                        if item.path.text != b"bun:test" {
                            cache.input_hash = None;
                        }
                    }

                    break 'outer;
                }
            }

            // if they didn't use any of the jest globals, don't inject it, I guess.
            // Iterates the static `Jest::FIELDS`
            // table (`&[(&'static str, fn(&Jest) -> Ref)]`); declaration order
            // determines the emitted clause/property order.
            let items_count: usize = {
                let mut count: usize = 0;
                for (_name, get_ref) in Jest::FIELDS {
                    count += (p.symbols.as_slice()[get_ref(&p.jest).inner_index() as usize]
                        .use_count_estimate
                        > 0) as usize;
                }
                count
            };
            if items_count == 0 {
                break 'outer;
            }

            let mut declared_symbols = bun_ast::DeclaredSymbolList::default();
            declared_symbols.ensure_total_capacity(items_count)?;

            // For CommonJS modules, use require instead of import
            if exports_kind == js_ast::ExportsKind::Cjs {
                let import_record_id = p.add_import_record(
                    bun_ast::ImportKind::Require,
                    bun_ast::Loc::EMPTY,
                    b"bun:test",
                );

                // Create object binding pattern for destructuring
                let mut properties = BumpVec::<B::Property>::with_capacity_in(items_count, p.arena);
                for (symbol_name, get_ref) in Jest::FIELDS {
                    let r = get_ref(&p.jest);
                    if p.symbols.as_slice()[r.inner_index() as usize].use_count_estimate > 0 {
                        let key = p.new_expr(
                            E::String {
                                data: symbol_name.as_bytes().into(),
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        );
                        let value = p.b(B::Identifier { r#ref: r }, bun_ast::Loc::EMPTY);
                        properties.push(B::Property {
                            flags: bun_ast::flags::PROPERTY_NONE,
                            key,
                            value,
                            default_value: None,
                        });
                        declared_symbols.append_assume_capacity(DeclaredSymbol {
                            ref_: r,
                            is_top_level: true,
                        });
                    }
                }
                let properties = bun_ast::StoreSlice::from_bump(properties);

                // Create: const { test, expect, ... } = require("bun:test")
                let binding = p.b(
                    B::Object {
                        properties,
                        is_single_line: false,
                    },
                    bun_ast::Loc::EMPTY,
                );
                let value = p.new_expr(
                    E::RequireString {
                        import_record_index: import_record_id,
                        ..Default::default()
                    },
                    bun_ast::Loc::EMPTY,
                );
                let mut decls = G::DeclList::init_capacity(1);
                decls.append_assume_capacity(G::Decl {
                    binding,
                    value: Some(value),
                });

                let local_stmt = p.s(
                    S::Local {
                        kind: js_ast::LocalKind::KConst,
                        decls,
                        ..Default::default()
                    },
                    bun_ast::Loc::EMPTY,
                );
                let part_stmts = p.arena.alloc_slice_fill_with(1, |_| local_stmt);

                before.push(js_ast::Part {
                    stmts: part_stmts.into(),
                    declared_symbols,
                    import_record_indices: js_ast::PartImportRecordIndices::init_one(
                        import_record_id,
                    ),
                    tag: bun_ast::PartTag::BunTest,
                    ..Default::default()
                });
            } else {
                let import_record_id = p.add_import_record(
                    bun_ast::ImportKind::Stmt,
                    bun_ast::Loc::EMPTY,
                    b"bun:test",
                );

                // For ESM modules, use import statement
                let mut clauses =
                    BumpVec::<js_ast::ClauseItem>::with_capacity_in(items_count, p.arena);
                for (symbol_name, get_ref) in Jest::FIELDS {
                    let r = get_ref(&p.jest);
                    if p.symbols.as_slice()[r.inner_index() as usize].use_count_estimate > 0 {
                        clauses.push(js_ast::ClauseItem {
                            name: js_ast::LocRef {
                                ref_: r,
                                loc: bun_ast::Loc::EMPTY,
                            },
                            alias: js_ast::StoreStr::new(symbol_name.as_bytes()),
                            alias_loc: bun_ast::Loc::EMPTY,
                            original_name: js_ast::StoreStr::new(b""),
                        });
                        declared_symbols.append_assume_capacity(DeclaredSymbol {
                            ref_: r,
                            is_top_level: true,
                        });
                    }
                }
                let clauses = bun_ast::StoreSlice::from_bump(clauses);

                let namespace_ref = p
                    .declare_symbol(
                        js_ast::symbol::Kind::Unbound,
                        bun_ast::Loc::EMPTY,
                        b"bun_test_import_namespace_for_internal_use_only",
                    )
                    .expect("unreachable");
                let import_stmt = p.s(
                    S::Import {
                        namespace_ref,
                        items: clauses,
                        import_record_index: import_record_id,
                        default_name: None,
                        star_name_loc: bun_ast::Loc::EMPTY,
                        is_single_line: false,
                        phase_defer: false,
                    },
                    bun_ast::Loc::EMPTY,
                );

                let part_stmts = p.arena.alloc_slice_fill_with(1, |_| import_stmt);
                before.push(js_ast::Part {
                    stmts: part_stmts.into(),
                    declared_symbols,
                    import_record_indices: js_ast::PartImportRecordIndices::init_one(
                        import_record_id,
                    ),
                    tag: bun_ast::PartTag::BunTest,
                    ..Default::default()
                });
            }

            // If we injected jest globals, we need to disable the runtime transpiler cache
            if let Some(cache) = p.options.features.runtime_transpiler_cache_mut() {
                cache.input_hash = None;
            }
        }

        if p.has_called_runtime {
            let mut runtime_imports: [u8; RuntimeImports::ALL.len()] =
                [0; RuntimeImports::ALL.len()];
            let mut iter = p.runtime_imports.iter();
            let mut i: usize = 0;
            while let Some(entry) = iter.next() {
                runtime_imports[i] = u8::try_from(entry.key).expect("int cast");
                i += 1;
            }

            bun_collections::index_sort::sort_slice_unstable_by(
                &mut runtime_imports[0..i],
                |a, b| {
                    RuntimeImports::ALL_SORTED_INDEX[*a as usize]
                        .cmp(&RuntimeImports::ALL_SORTED_INDEX[*b as usize])
                },
            );

            if i > 0 {
                // snapshot to break the `&mut self` ↔ `&self.runtime_imports`
                // borrow overlap in `generate_import_stmt(symbols: &Sym)`; the callee
                // never touches `self.runtime_imports`, so the clone is purely a
                // borrow-checker workaround.
                let symbols = p.runtime_imports.clone();
                p.generate_import_stmt(
                    RuntimeImports::NAME,
                    &runtime_imports[0..i],
                    &mut before,
                    &symbols,
                    None,
                    b"import_",
                    true,
                    js_ast::PartTag::Runtime,
                )
                .expect("unreachable");
            }
        }

        // handle new way to do automatic JSX imports which fixes symbol collision issues
        if p.options.jsx.parse
            && p.options.features.auto_import_jsx
            && p.options.jsx.runtime == options::JSX::Runtime::Automatic
        {
            // `generate_import_stmt` takes `&mut self` plus `import_path: &'a [u8]`
            // and `symbols: &Sym`, so the Pragma-owned `Box<[u8]>` paths are copied into the
            // bump arena (giving them the required `'a` lifetime) and `jsx_imports` is moved
            // out via `take` (it is `Default`) to avoid an overlapping `&self.jsx_imports`
            // borrow. The callee never reads `self.jsx_imports`, so the take/restore is
            // semantically a no-op.
            let import_source: &'a [u8] = p.arena.alloc_slice_copy(p.options.jsx.import_source());
            let package_name: &'a [u8] = p.arena.alloc_slice_copy(&p.options.jsx.package_name);
            let jsx_imports = core::mem::take(&mut p.jsx_imports);

            let mut buf: [&'static [u8]; 3] = [b"", b"", b""];
            let runtime_import_names = jsx_imports.runtime_import_names(&mut buf);

            if !runtime_import_names.is_empty() {
                p.generate_import_stmt(
                    import_source,
                    runtime_import_names,
                    &mut before,
                    &jsx_imports,
                    None,
                    b"",
                    false,
                    js_ast::PartTag::JsxImport,
                )
                .expect("unreachable");
            }

            let source_import_names = jsx_imports.source_import_names();
            if !source_import_names.is_empty() {
                p.generate_import_stmt(
                    package_name,
                    source_import_names,
                    &mut before,
                    &jsx_imports,
                    None,
                    b"",
                    false,
                    js_ast::PartTag::JsxImport,
                )
                .expect("unreachable");
            }

            p.jsx_imports = jsx_imports;
        }

        if p.server_components_wrap_ref.is_valid() {
            let fw = p.options.framework.unwrap_or_else(|| {
                panic!("server components requires a framework configured, but none was set")
            });
            let sc = fw.server_components.as_ref().unwrap();
            p.generate_react_refresh_import(
                &mut before,
                &sc.server_runtime_import[..],
                &[crate::p::ReactRefreshImportClause {
                    name: &sc.server_register_client_reference[..],
                    r#ref: p.server_components_wrap_ref,
                    enabled: true,
                }],
            )?;
        }

        if let Some(rc_state) = p.react_compiler.take() {
            let mut rc_stmts: Vec<Stmt> = Vec::new();
            let result = bun_react_compiler::finish(
                *rc_state,
                &mut crate::react_compiler_host::ReactCompilerHost::new(p),
                &mut rc_stmts,
            );
            if let bun_react_compiler::CompileOutput::Error { error, .. } = result {
                p.log().add_range_error_fmt(
                    Some(p.source),
                    bun_ast::Range::NONE,
                    format_args!("React Compiler: {error}"),
                );
            }
            if !rc_stmts.is_empty() {
                let mut declared_symbols = bun_ast::DeclaredSymbolList::default();
                let mut import_record_indices: js_ast::PartImportRecordIndices =
                    bun_alloc::AstAlloc::vec();
                for stmt in &rc_stmts {
                    match &stmt.data {
                        js_ast::StmtData::SImport(import) => {
                            import_record_indices.push(import.import_record_index);
                            declared_symbols.append(DeclaredSymbol {
                                ref_: import.namespace_ref,
                                is_top_level: true,
                            })?;
                            for item in import.items.iter() {
                                declared_symbols.append(DeclaredSymbol {
                                    ref_: item.name.ref_,
                                    is_top_level: true,
                                })?;
                                p.is_import_item.insert(item.name.ref_, ());
                                p.named_imports.put(
                                    item.name.ref_,
                                    js_ast::NamedImport {
                                        alias: Some(item.alias),
                                        alias_loc: item.alias_loc,
                                        namespace_ref: import.namespace_ref,
                                        import_record_index: import.import_record_index,
                                        local_parts_with_uses: bun_alloc::AstAlloc::vec(),
                                        alias_is_star: false,
                                        is_exported: false,
                                    },
                                )?;
                            }
                        }
                        js_ast::StmtData::SFunction(func) => {
                            if let Some(ref_) = func.func.name.map(|n| n.ref_) {
                                declared_symbols.append(DeclaredSymbol {
                                    ref_,
                                    is_top_level: true,
                                })?;
                            }
                        }
                        _ => {}
                    }
                }
                before.push(js_ast::Part {
                    stmts: p.arena.alloc_slice_copy(&rc_stmts).into(),
                    tag: js_ast::PartTag::ReactCompiler,
                    declared_symbols,
                    import_record_indices,
                    can_be_removed_if_unused: true,
                    ..Default::default()
                });
            }
        }

        if p.react_refresh.register_used || p.react_refresh.signature_used {
            p.generate_react_refresh_import(
                &mut before,
                match p.options.framework {
                    Some(fw) => &fw.react_fast_refresh.as_ref().unwrap().import_source[..],
                    None => b"react-refresh/runtime",
                },
                &[
                    crate::p::ReactRefreshImportClause {
                        name: b"register",
                        enabled: p.react_refresh.register_used,
                        r#ref: p.react_refresh.register_ref,
                    },
                    crate::p::ReactRefreshImportClause {
                        name: b"createSignatureFunctionForTransform",
                        enabled: p.react_refresh.signature_used,
                        r#ref: p.react_refresh.create_signature_ref,
                    },
                ],
            )?;
        }

        // Bake: transform global `Response` to use `import { Response } from 'bun:app'`
        #[allow(deprecated)]
        if !p.response_ref.is_null()
            && p.symbols.as_slice()[p.response_ref.inner_index() as usize].use_count_estimate > 0
        {
            p.generate_import_stmt_for_bake_response(&mut before)?;
        }

        if !before.is_empty() || !after.is_empty() {
            // Single up-front reserve; the inner
            // reserve() calls in prepend_from / append become no-ops.
            parts.reserve(before.len() + after.len());
            parts.prepend_from(&mut before);
            parts.append(&mut after);
        }

        // Pop the module scope to apply the "ContainsDirectEval" rules
        // p.popScope();

        #[cfg(not(target_arch = "wasm32"))]
        if bun_core::feature_flags::RUNTIME_TRANSPILER_CACHE {
            if let Some(cache) = p.options.features.runtime_transpiler_cache_mut() {
                if p.macro_call_count != 0 {
                    // disable this for:
                    // - macros
                    cache.input_hash = None;
                } else {
                    cache.exports_kind = exports_kind;
                }
            }
        }

        let ast = p.to_ast(&mut parts, exports_kind, wrap_mode, hashbang)?;

        if reject_import_statements {
            // An empty range marks a parser-generated record, like the JSX runtime import.
            let import_record: Option<&ImportRecord> =
                ast.import_records.as_slice().iter().find(|import_record| {
                    !import_record
                        .flags
                        .intersects(ImportRecordFlags::IS_INTERNAL | ImportRecordFlags::IS_UNUSED)
                        && import_record.kind == bun_ast::ImportKind::Stmt
                        && !import_record.range.is_empty()
                });

            if let Some(record) = import_record {
                let mut notes = BumpVec::<bun_ast::Data>::new_in(p.arena);

                notes.push(bun_ast::Data {
                    text: {
                        use std::io::Write;
                        let mut v = Vec::<u8>::new();
                        let _ = write!(
                            &mut v,
                            "Try require({}) instead",
                            bun_core::fmt::QuotedFormatter {
                                text: record.path.text
                            }
                        );
                        std::borrow::Cow::Owned(v)
                    },
                    ..Default::default()
                });

                if uses_module_ref {
                    notes.push(bun_ast::Data {
                        text: std::borrow::Cow::Borrowed(
                            b"This file is CommonJS because 'module' was used",
                        ),
                        ..Default::default()
                    });
                }

                if uses_exports_ref {
                    notes.push(bun_ast::Data {
                        text: std::borrow::Cow::Borrowed(
                            b"This file is CommonJS because 'exports' was used",
                        ),
                        ..Default::default()
                    });
                }

                if p.has_top_level_return {
                    notes.push(bun_ast::Data {
                        text: std::borrow::Cow::Borrowed(
                            b"This file is CommonJS because top-level return was used",
                        ),
                        ..Default::default()
                    });
                }

                if p.has_with_scope {
                    notes.push(bun_ast::Data {
                        text: std::borrow::Cow::Borrowed(
                            b"This file is CommonJS because a \"with\" statement is used",
                        ),
                        ..Default::default()
                    });
                }

                p.log().add_range_error_with_notes(
                    Some(p.source),
                    record.range,
                    b"Cannot use import statement with CommonJS-only features".as_slice(),
                    notes.into_iter().collect::<Vec<_>>().into_boxed_slice(),
                );
            }
        }

        // If there were errors during to_ast, also halt here
        if p.log().errors > orig_error_count {
            return Err(crate::Error::SyntaxError);
        }

        Ok(crate::Result::Ast(ast))
    }

    // associated fn (was `&self` reading `self.lexer.source.contents`)
    // because `_parse` consumes `self` by value and destructures it before this
    // call site; the source contents are passed explicitly.
    // called from gated `_parse` body above
    fn has_bun_pragma(contents: &[u8], has_hashbang: bool) -> Option<crate::AlreadyBundled> {
        const BUN_PRAGMA: &[u8] = b"// @bun";
        let end = contents.len();

        // pragmas may appear after a hashbang comment
        //
        //   ```js
        //   #!/usr/bin/env bun
        //   // @bun
        //   const myCode = 1;
        //   ```
        let mut cursor: usize = 0;
        if has_hashbang {
            while contents[cursor] != b'\n' {
                cursor += 1;
                if cursor >= end {
                    return None;
                }
            }

            // eat the last newline
            // NOTE: in windows, \n comes after \r so no extra work needs to be done
            cursor += 1;
        }

        if !contents[cursor..].starts_with(BUN_PRAGMA) {
            return None;
        }
        cursor += BUN_PRAGMA.len();

        let mut state = PragmaState::default();

        while cursor < end {
            match contents[cursor] {
                b'\n' => break,
                b'@' => {
                    cursor += 1;
                    if cursor >= contents.len() {
                        break;
                    }
                    if contents[cursor] != b'b' {
                        cursor += 1;
                        continue;
                    }
                    let slice = &contents[cursor..];
                    if slice.starts_with(b"bun-cjs") {
                        state.seen_cjs = true;
                        cursor += b"bun-cjs".len();
                    } else if slice.starts_with(b"bytecode") {
                        state.seen_bytecode = true;
                        cursor += b"bytecode".len();
                    }
                }
                _ => {}
            }
            cursor += 1;
        }

        if state.seen_cjs {
            Some(if state.seen_bytecode {
                crate::AlreadyBundled::BytecodeCjs
            } else {
                crate::AlreadyBundled::BunCjs
            })
        } else {
            Some(if state.seen_bytecode {
                crate::AlreadyBundled::Bytecode
            } else {
                crate::AlreadyBundled::Bun
            })
        }
    }
}

#[derive(Default)]
struct PragmaState {
    seen_cjs: bool,
    seen_bytecode: bool,
}

#[cfg(target_arch = "wasm32")]
pub type MacroContext = Option<*mut c_void>;
#[cfg(not(target_arch = "wasm32"))]
pub type MacroContext = crate::Macro::MacroContext;

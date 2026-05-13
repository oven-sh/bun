use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt;
use core::ffi::c_void;
use core::mem::MaybeUninit;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_core::strings;
use bun_core::{self, Error, Output, err};
use bun_wyhash::Wyhash;

use crate::parser::options;
use bun_ast::import_record::{Flags as ImportRecordFlags, ImportRecord};

use crate as js_parser;
use crate::defines::Define;
use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::{
    Jest, ParseStatementOptions, Runtime, RuntimeFeatures, RuntimeImports,
    ScanPassResult, SideEffects, WrapMode,
};
use bun_ast as js_ast;
use bun_ast::g::Decl;
use bun_ast::{B, E, Expr, G, S, Stmt, Symbol};
use bun_ast::{DeclaredSymbol, StmtList};

// Named instantiations of `P<'_, TS, SCAN>` matching the Zig
// `JavaScriptParser`/`TypeScriptParser`/etc. comptime aliases.
pub type JavaScriptParser<'a> = P<'a, false, false>;
pub type JSXParser<'a> = P<'a, false, false>;
pub type TypeScriptParser<'a> = P<'a, true, false>;
pub type TSXParser<'a> = P<'a, true, false>;
pub type JavaScriptImportScanner<'a> = P<'a, false, true>;
pub type JSXImportScanner<'a> = P<'a, false, true>;
pub type TypeScriptImportScanner<'a> = P<'a, true, true>;
pub type TSXImportScanner<'a> = P<'a, true, true>;

// In AST crates, ListManaged(T) backed by the arena → bumpalo Vec.
type BumpVec<'bump, T> = bun_alloc::ArenaVec<'bump, T>;

/// Stack-local in-place `P` constructor (Zig: `var p: ParserType = undefined;
/// try ParserType.init(.., &p)`). `P` is ~5 KiB; the previous
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
    pub options: Options<'a>,
    pub lexer: js_lexer::Lexer<'a>,
    /// Raw pointer alias of `lexer.log`. Zig held two `*Log` pointers; Rust
    /// cannot hold two live `&'a mut Log`, so both the parser- and lexer-side
    /// handles are `NonNull` and dereferenced at use sites (see `log_mut` /
    /// `Lexer::log()`). The pointee outlives `'a` (see `init`).
    pub log: core::ptr::NonNull<bun_ast::Log>,
    pub source: &'a bun_ast::Source,
    pub define: &'a Define,
    pub bump: &'a Arena,
}

pub struct Options<'a> {
    pub jsx: options::JSX::Pragma,
    pub ts: bool,
    pub keep_names: bool,
    pub ignore_dce_annotations: bool,
    pub preserve_unused_imports_ts: bool,
    pub use_define_for_class_fields: bool,
    pub suppress_warnings_about_weird_code: bool,
    pub filepath_hash_for_hmr: u32,
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
}

impl<'a> Default for Options<'a> {
    fn default() -> Self {
        // Zig: `macro_context = undefined` — modeled as `None`; caller must set
        // before use. This impl exists so `_parse` can `core::mem::take` the
        // real options out of `Parser` (moving the heap-owning `jsx: Pragma`
        // by value) instead of bitwise-copying it and double-freeing on drop.
        Options {
            jsx: options::JSX::Pragma::default(),
            ts: false,
            keep_names: true,
            ignore_dce_annotations: false,
            preserve_unused_imports_ts: false,
            use_define_for_class_fields: false,
            suppress_warnings_about_weird_code: true,
            filepath_hash_for_hmr: 0,
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
        }
    }
}

impl<'a> Options<'a> {
    /// Field-by-field clone for the bundler's empty-file fallback
    /// (ParseTask.zig:335-342: `getEmptyAST(..., opts, ...)` after
    /// `caches.js.parse(..., opts, ...)` returned null). Zig passed `opts` by
    /// value (bitwise copy) to *both* calls; in Rust `parse()` consumes `opts`,
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
            filepath_hash_for_hmr: self.filepath_hash_for_hmr,
            features: RuntimeFeatures {
                react_fast_refresh: f.react_fast_refresh,
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
                repl_mode: f.repl_mode,
                jsx_optimization_inline: f.jsx_optimization_inline,
                dynamic_require: f.dynamic_require,
                remove_whitespace: f.remove_whitespace,
                use_import_meta_require: f.use_import_meta_require,
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
                // `bool: NoUninit`, `u8: AnyBitPattern`; matches Zig `std.mem.asBytes`.
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

        self.features.hash_for_runtime_transpiler(hasher);
    }

    // Used to determine if `joinWithComma` should be called in `visitStmts`. We do this
    // to avoid changing line numbers too much to make source mapping more readable
    pub fn runtime_merge_adjacent_expression_statements(&self) -> bool {
        self.bundle
    }

    pub fn init(jsx: options::JSX::Pragma, loader: options::Loader) -> Options<'static> {
        // Zig left `macro_context` as `undefined` and the rest of the fields at
        // their declared defaults. Rust models the undefined pointer as `None`
        // (see field comment); caller overwrites before use.
        let mut opts = Options {
            ts: loader.is_typescript(),
            jsx,
            keep_names: true,
            ignore_dce_annotations: false,
            preserve_unused_imports_ts: false,
            use_define_for_class_fields: false,
            suppress_warnings_about_weird_code: true,
            filepath_hash_for_hmr: 0,
            features: RuntimeFeatures::default(),
            tree_shaking: false,
            bundle: false,
            code_splitting: false,
            package_version: b"",
            // Zig: `macro_context: *MacroContextType() = undefined` — uninitialized
            // raw pointer the caller overwrites before any read. In Rust,
            // materializing an invalid `&mut T` is immediate UB regardless of
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
        };
        opts.jsx.parse = loader.is_jsx();
        opts
    }
}

// ── live `Parser::init` (round-E unblock) ─────────────────────────────────
// Zig held two aliasing `*Log` pointers (parser + lexer). Rust models this as
// `NonNull<Log>` on both sides — neither stores a long-lived `&mut`, so no
// Stacked-Borrows tag is invalidated when accesses interleave.
impl<'a> Parser<'a> {
    pub fn init(
        options: Options<'a>,
        log: &'a mut bun_ast::Log,
        source: &'a bun_ast::Source,
        define: &'a Define,
        bump: &'a Arena,
    ) -> Result<Parser<'a>, Error> {
        let lexer = js_lexer::Lexer::init(log, source, bump)?;
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
        })
    }

    /// Reborrow the shared `Log`. Callers must not hold two results live at
    /// once (or alongside `self.lexer.log()`).
    #[inline]
    pub fn log_mut(&mut self) -> &mut bun_ast::Log {
        // SAFETY: `log` was created from the `&'a mut Log` passed to `init`,
        // which outlives `'a` (and therefore `self`). `self.lexer.log` aliases
        // the same allocation as a `NonNull` (not `&mut`), so this transient
        // reborrow does not invalidate it.
        unsafe { self.log.as_mut() }
    }
}

// ── live `Parser::parse` / `Parser::scan_imports` symbols ────────────────
// `parse()` is the real const-generic dispatcher (Zig: `if (ts && jsx.parse)
// _parse(TSXParser) else …`). `_parse` carries the correct `<const TS, JX>`
// shape but its body is blocked on `P::{init, prepare_for_visit_pass,
// append_part, to_ast, …}` (gated in P.rs); the full ported body is preserved
// per-method-gated in the impl block below and replaces this stub once that
// surface lands.
impl<'a> Parser<'a> {
    #[cfg_attr(not(target_arch = "wasm32"), allow(unused_mut))]
    pub fn parse(mut self) -> Result<crate::Result, Error> {
        // TODO(port): narrow error set
        #[cfg(target_arch = "wasm32")]
        {
            self.options.ts = true;
            self.options.jsx.parse = true;
            return self._parse::<true>();
        }

        // JSX is no longer part of the parser's monomorphization (it only
        // affects a few expr arms — see `parser.rs`); `P::init` reads the
        // transform mode off `options.jsx.parse` at runtime, so the only
        // remaining comptime split is TypeScript.
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
        type Pi<'a, const TS: bool> = P<'a, TS, true>;
        // Zig moves lexer/options by value into `P` (Parser.zig) and only
        // `defer p.lexer.deinit()` cleans up — Zig has no implicit destructor
        // on `Parser.lexer`. In Rust, `Lexer` owns `Vec`s and `Options` owns
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
        // matches Zig's two-aliasing-`*Log` model with no `&mut` materialized.
        let mut __p = init_p!(Pi<'_, TS>;
            self.bump, self.log, self.source, self.define, lexer, options);
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
            is_module_scope: true,
            ..Default::default()
        };

        // Parsing seems to take around 2x as much time as visiting.
        // Which makes sense.
        // June 4: "Parsing took: 18028000"
        // June 4: "Rest of this took: 8003000"
        match p.parse_stmts_up_to(js_lexer::T::TEndOfFile, &mut opts) {
            Ok(_) => {}
            Err(e) => {
                if e == err!("StackOverflow") {
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

            // PORT NOTE: `scan_pass.used_symbols`/`import_records` are still
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
            // PORT NOTE: Zig's `string` aliased the long-lived option storage
            // directly. `add_import_record` requires `&'a [u8]`, but borrowing
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

    pub fn to_lazy_export_ast(
        &mut self,
        expr: Expr,
        runtime_api_call: &'static [u8],
        symbols: js_ast::symbol::List,
    ) -> Result<crate::Result, Error> {
        // TODO(port): narrow error set
        // Zig moves lexer/options by value into `P` (Parser.zig) and only
        // `defer p.lexer.deinit()` cleans up — Zig has no implicit destructor
        // on `Parser.lexer`. In Rust we move them out and leave inert
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
        // matches Zig's two-aliasing-`*Log` model with no `&mut` materialized.
        let mut __p = init_p!(JavaScriptParser<'_>;
            self.bump, self.log, self.source, self.define, lexer, options);
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
        let mut symbols_ = symbols;
        // PORT NOTE: Zig `moveToListManaged(arena)` rebinds the same
        // backing storage to an `ArrayList(arena)`. The Rust Vec
        // adapter returns a `std::Vec`; `p.symbols` is a bump-backed Vec, so
        // copy elements into the arena. Phase B may grow a zero-copy adapter.
        p.symbols =
            bun_alloc::vec_from_iter_in(symbols_.move_to_list_managed().into_iter(), p.arena);

        p.prepare_for_visit_pass()?;

        let mut final_expr = expr;

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
            symbol_uses: core::mem::take(&mut p.symbol_uses),
            ..Default::default()
        };
        let mut parts = BumpVec::with_capacity_in(2, p.arena);
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
        parts.push(ns_export_part);
        parts.push(part);

        let exports_kind: js_ast::ExportsKind = 'brk: {
            if matches!(expr.data, js_ast::ExprData::EUndefined(_)) {
                if self.source.path.name.ext == b".cjs" {
                    break 'brk js_ast::ExportsKind::Cjs;
                }
                if self.source.path.name.ext == b".mjs" {
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

    pub fn analyze(
        &mut self,
        context: *mut c_void,
        callback: &dyn Fn(*mut c_void, &mut TSXParser, &mut [js_ast::Part]) -> Result<(), Error>,
    ) -> Result<(), Error> {
        // See `_scan_imports`: move lexer/options out, leaving inert
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
        // matches Zig's two-aliasing-`*Log` model with no `&mut` materialized.
        let mut __p = init_p!(TSXParser<'_>;
            self.bump, self.log, self.source, self.define, lexer, options);
        // SAFETY: `init_p!` only yields after `init` succeeded.
        let p: &mut TSXParser<'_> = unsafe { __p.assume_init_mut() };

        // Consume a leading hashbang comment
        let mut hashbang: &[u8] = b"";
        if p.lexer.token == js_lexer::T::THashbang {
            hashbang = p.lexer.identifier;
            p.lexer.next()?;
        }
        let _ = hashbang;

        // Parse the file in the first pass, but do not bind symbols
        let mut opts = ParseStatementOptions {
            is_module_scope: true,
            ..Default::default()
        };
        let mut parse_tracer = bun_core::perf::trace("JSParser.parse");

        let stmts = match p.parse_stmts_up_to(js_lexer::T::TEndOfFile, &mut opts) {
            Ok(s) => s,
            Err(e) => {
                #[cfg(target_arch = "wasm32")]
                {
                    Output::print(format_args!(
                        "JSParser.parse: caught error {} at location: {}\n",
                        e.name(),
                        p.lexer.loc().start
                    ));
                    let _ = p.log().print(Output::writer());
                }
                return Err(e);
            }
        };

        parse_tracer.end();

        // Zig spec (Parser.zig:292) reads `self.log.errors`; `p.log` and
        // `self.log` alias the same `NonNull<Log>` so either is fine — route
        // through `p` for clarity.
        if p.log().errors > 0 {
            #[cfg(target_arch = "wasm32")]
            {
                // If the logger is backed by console.log, every print appends a newline.
                // so buffering is kind of mandatory here
                // TODO(port): Zig builds a custom GenericWriter wrapping Output::print and a
                // buffered writer over it. Phase B should provide a `bun_core::Output::buffered()`
                // that returns an `impl core::fmt::Write` flushed on drop.
                for msg in p.log().msgs.as_slice() {
                    let mut m: bun_ast::Msg = *msg;
                    let _ = m.write_format(Output::writer(), true);
                }
            }
            return Err(err!("SyntaxError"));
        }

        let mut visit_tracer = bun_core::perf::trace("JSParser.visit");
        p.prepare_for_visit_pass()?;

        let mut parts = BumpVec::new_in(p.arena);

        p.append_part(&mut parts, stmts.into_bump_slice_mut())?;
        visit_tracer.end();

        let mut analyze_tracer = bun_core::perf::trace("JSParser.analyze");
        callback(context, p, parts.as_mut_slice())?;
        analyze_tracer.end();
        Ok(())
    }

    fn _parse<const TS: bool>(self) -> Result<crate::Result, Error> {
        // TODO(port): narrow error set
        // TODO(b2-blocked): bun_crash_handler::current_action — `Action` stores
        // `&'static [u8]` but `self.source.path.text` is `'a`; Phase B widens
        // the lifetime on `Action` (Zig held the same pointer). Once unblocked:
        //   let _restore = bun_crash_handler::scoped_action(Action::Parse(self.source.path.text));
        // (`ActionGuard` restores the previous action on Drop — no scopeguard.)

        // Zig moves lexer/options by value into `P` (Parser.zig:339) and only
        // `defer p.lexer.deinit()` cleans up — Zig has no implicit destructor
        // on `Parser.lexer`. `parse()` consumes `self` by value, so we
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
        } = self;

        // `lexer.log` aliases `log`; route through the centralised
        // `Lexer::log()` accessor so this site stays safe.
        let orig_error_count = lexer.log().errors;
        // `P.log` and `Lexer.log` are both `NonNull<Log>` (see P.rs / lexer.rs
        // field docs), so handing the same raw pointer to both is defined —
        // matches Zig's two-aliasing-`*Log` model with no `&mut` materialized.
        let mut __p = init_p!(P<'_, TS, false>;
            bump, log, source, define, lexer, options);
        // SAFETY: `init_p!` only yields after `init` succeeded.
        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };

        if p.options.features.hot_module_reloading {
            debug_assert!(!p.options.tree_shaking);
        }

        // Instead of doing "should_fold_typescript_constant_expressions or features.minify_syntax"
        // Let's enable this flag file-wide
        if p.options.features.minify_syntax || p.options.features.inlining {
            p.should_fold_typescript_constant_expressions = true;
        }

        // PERF(port): was stack-fallback arena (42 * sizeof(BinaryExpressionVisitor)) — profile in Phase B
        p.binary_expression_stack = BumpVec::with_capacity_in(41, p.arena);
        // PERF(port): was stack-fallback arena (48 * sizeof(BinaryExpressionSimplifyVisitor)) — profile in Phase B
        p.binary_expression_simplify_stack = BumpVec::with_capacity_in(47, p.arena);

        // (Zig asserted the stack-fallback arena owns the buffer; not applicable here.)

        // defer {
        //     if (p.allocated_names_pool) |pool| {
        //         pool.data = p.allocated_names;
        //         pool.release();
        //         p.allocated_names_pool = null;
        //     }
        // }

        // Consume a leading hashbang comment
        let mut hashbang: &[u8] = b"";
        if p.lexer.token == js_lexer::T::THashbang {
            hashbang = p.lexer.identifier;
            p.lexer.next()?;
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
        if true
        /* TODO(b2-blocked): feature_flag */
        {
            if let Some(cache) = p.options.features.runtime_transpiler_cache_mut() {
                // TODO(port): `Path::is_node_module`/`is_jsx_file` live on the
                // resolver `fs::Path` (not the logger stub) — inline their
                // bodies until the logger Path grows them.
                let path = &p.source.path;
                #[cfg(windows)]
                const NM: &[u8] = b"\\node_modules\\";
                #[cfg(not(windows))]
                const NM: &[u8] = b"/node_modules/";
                let is_node_module = strings::last_index_of(path.name.dir, NM).is_some();
                let is_jsx_file = strings::has_suffix_comptime(path.name.filename, b".jsx")
                    || strings::has_suffix_comptime(path.name.filename, b".tsx");
                if cache.get(
                    p.source,
                    (&raw const p.options).cast::<()>(),
                    p.options.jsx.parse && (!is_node_module || is_jsx_file),
                ) {
                    return Ok(crate::Result::Cached);
                }
            }
        }

        // Parse the file in the first pass, but do not bind symbols
        let mut opts = ParseStatementOptions {
            is_module_scope: true,
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
                if e == err!("StackOverflow") {
                    // The lexer location won't be totally accurate, but it's kind of helpful.
                    p.log().add_error(
                        Some(p.source),
                        p.lexer.loc(),
                        b"Maximum call stack size exceeded",
                    );

                    // Return a SyntaxError so that we reuse existing code for handling errors.
                    return Err(err!("SyntaxError"));
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
            return Err(err!("SyntaxError"));
        }

        // TODO(b2-blocked): bun_crash_handler::CURRENT_ACTION.set(Action::Visit(self.source.path.text))
        // — see lifetime note at top of fn.

        let mut visit_tracer = bun_core::perf::trace("JSParser::visit");
        p.prepare_for_visit_pass()?;

        let mut before = BumpVec::<js_ast::Part>::new_in(p.arena);
        let mut after = BumpVec::<js_ast::Part>::new_in(p.arena);
        let mut parts = BumpVec::<js_ast::Part>::new_in(p.arena);
        // (defer after.deinit()/before.deinit() — Zig only frees the backing buffer; element
        // ownership is transferred into `parts` below via bitwise copy + set_len(0).)

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

            // PORT NOTE: `Loc` lacks `Hash` (logger crate), so the
            // `scopes_in_order_for_enum` lookups linear-scan `keys()` —
            // matches Zig's ArrayHashMap linear behaviour at small N (one
            // entry per top-level `enum`). `scope_order_to_visit` is
            // `&'a [_]` (a `Copy` cursor) so save/restore is a plain value
            // copy, mirroring the Zig `[]ScopeOrder` slice value.
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
                        // Map stores `&'a [ScopeOrder]` (Zig `[]ScopeOrder` slice
                        // value); shared borrow may freely alias the inner
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
                                // PORT NOTE: `S::Local`/`Decl` are not `Copy`;
                                // rebuild the struct instead of `**local`.
                                let _local = S::Local {
                                    kind: local.kind,
                                    is_export: local.is_export,
                                    was_ts_import_equals: local.was_ts_import_equals,
                                    was_commonjs_export: local.was_commonjs_export,
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
                            // PORT NOTE: `Part` isn't `Copy`; pop+push instead of last+truncate.
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
                        // PORT NOTE: `Part` isn't `Clone`; move out the
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
            return Err(err!("SyntaxError"));
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
                                data: p.source.path.name.dir.into(),
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        )),
                    };
                    // PERF(port): was assume_capacity
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
                    // PORT NOTE: borrowck — copy out the three Copy fields so the
                    // immutable borrow of `p.imports_to_convert_from_require`
                    // ends before `p.module_scope_mut()` takes `&mut self`.
                    let (ns_ref, ns_loc, import_record_id) = {
                        let deferred_import = &p.imports_to_convert_from_require[i];
                        (
                            deferred_import
                                .namespace
                                .ref_
                                .expect("infallible: ref bound"),
                            deferred_import.namespace.loc,
                            deferred_import.import_record_id,
                        )
                    };
                    let (import_part_stmts, rest) = remaining_stmts.split_at_mut(1);
                    remaining_stmts = rest;

                    VecExt::append(&mut p.module_scope_mut().generated, ns_ref);

                    import_part_stmts[0] = Stmt::alloc(
                        S::Import {
                            star_name_loc: Some(ns_loc),
                            import_record_index: import_record_id,
                            namespace_ref: ns_ref,
                            default_name: None,
                            items: bun_ast::StoreSlice::EMPTY,
                            is_single_line: false,
                        },
                        ns_loc,
                    );
                    let mut declared_symbols =
                        bun_ast::DeclaredSymbolList::init_capacity(1).expect("unreachable");
                    declared_symbols.append_assume_capacity(DeclaredSymbol {
                        ref_: ns_ref,
                        is_top_level: true,
                    });
                    // PERF(port): was assume_capacity
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
                // PORT NOTE: borrowck — `deoptimize_commonjs_named_exports` mut-borrows
                // `self`, so the `values()`/`keys()` slices are read once into locals
                // (Zig kept slice handles across the call).
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

                        if needs_decl_count > 0 {
                            p.symbols.as_mut_slice()[p.exports_ref.inner_index() as usize]
                                .use_count_estimate += export_refs_len as u32;
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
                                                .unwrap()
                                                .eql(id.ref_)
                                        {
                                            // We know it's 0 because there is only one import in the whole file
                                            // so that one import must be the one we're looking for
                                            break 'inner_brk Some(0);
                                        }
                                    }

                                    None
                                };
                                if let Some(id) = redirect_import_record_index {
                                    part.symbol_uses = Default::default();
                                    return Ok(crate::Result::Ast(Box::new(js_ast::Ast {
                                        // Borrow the arena/Vec-backed records as a Vec view
                                        // (matches `P::to_ast`); `p` is dropped immediately
                                        // after this return so no double-ownership.
                                        import_records: unsafe {
                                            Vec::from_bump_slice(p.import_records.items_mut())
                                        },
                                        redirect_import_record_index: Some(id),
                                        named_imports: core::mem::take(&mut *p.named_imports),
                                        named_exports: core::mem::take(&mut p.named_exports),
                                        ..Default::default()
                                    })));
                                }
                            }
                        }
                    }
                }
            }

            if p.commonjs_named_exports_deoptimized
                && p.options.features.unwrap_commonjs_to_esm
                && p.unwrap_all_requires
                && p.imports_to_convert_from_require.len() == 1
                && p.import_records.len() == 1
                && p.symbols.as_slice()[p.module_ref.inner_index() as usize].use_count_estimate == 1
            {
                'outer_part_loop: for part in parts.iter_mut() {
                    // Specially handle modules shaped like this:
                    //
                    //    doSomeStuff();
                    //    module.exports = require('./foo.js');
                    //
                    // An example is react-dom/index.js, which does a DCE check.
                    // Snapshot the StoreSlice (Copy) so the `&mut` borrow over the
                    // arena slice doesn't conflict with the `part.stmts = …` rewrite
                    // below.
                    let part_stmts_ss = part.stmts;
                    let part_stmts: &mut [Stmt] = part_stmts_ss.slice_mut();
                    if part_stmts.len() > 1 {
                        break;
                    }

                    for j in 0..part_stmts.len() {
                        let stmt = &mut part_stmts[j];
                        if let js_ast::StmtData::SExpr(s_expr) = &stmt.data {
                            let value: Expr = s_expr.value;

                            if let js_ast::ExprData::EBinary(mut bin_ptr) = value.data {
                                let mut bin = bin_ptr;
                                loop {
                                    let left = bin.left;
                                    let right = bin.right;

                                    if bin.op == js_ast::op::Code::BinAssign
                                        && matches!(right.data, js_ast::ExprData::ERequireString(_))
                                        && matches!(&left.data, js_ast::ExprData::EDot(d)
                                            if d.name == b"exports"
                                                && matches!(&d.target.data, js_ast::ExprData::EIdentifier(id)
                                                    if id.ref_.eql(p.module_ref)))
                                    {
                                        let req = match &right.data {
                                            js_ast::ExprData::ERequireString(r) => r,
                                            _ => unreachable!(),
                                        };
                                        p.export_star_import_records.push(req.import_record_index);
                                        let namespace_ref =
                                            p.imports_to_convert_from_require.as_slice()
                                                [req.unwrapped_id as usize]
                                                .namespace
                                                .ref_
                                                .unwrap();

                                        let stmt_loc = stmt.loc;
                                        part.stmts = {
                                            let mut new_stmts = BumpVec::<Stmt>::with_capacity_in(
                                                part.stmts.len() + 1,
                                                p.arena,
                                            );
                                            // PERF(port): was appendSliceAssumeCapacity
                                            new_stmts.extend_from_slice(&part_stmts[0..j]);

                                            new_stmts.push(Stmt::alloc(
                                                S::ExportStar {
                                                    import_record_index: req.import_record_index,
                                                    namespace_ref,
                                                    alias: None,
                                                },
                                                stmt_loc,
                                            ));
                                            new_stmts.extend_from_slice(&part_stmts[j + 1..]);
                                            bun_ast::StoreSlice::from_bump(new_stmts)
                                        };

                                        part.import_record_indices.push(req.import_record_index);
                                        p.symbols.as_mut_slice()
                                            [p.module_ref.inner_index() as usize]
                                            .use_count_estimate = 0;
                                        let ns_idx = namespace_ref.inner_index() as usize;
                                        p.symbols.as_mut_slice()[ns_idx].use_count_estimate =
                                            p.symbols.as_slice()[ns_idx]
                                                .use_count_estimate
                                                .saturating_sub(1);
                                        let _ = part.symbol_uses.swap_remove(&namespace_ref);

                                        for (i, before_part) in before.iter().enumerate() {
                                            if before_part.tag
                                                == bun_ast::PartTag::ImportToConvertFromRequire
                                            {
                                                let _ = before.swap_remove(i);
                                                break;
                                            }
                                        }

                                        if p.esm_export_keyword.len == 0 {
                                            p.esm_export_keyword.loc = stmt_loc;
                                            p.esm_export_keyword.len = 5;
                                        }
                                        p.commonjs_named_exports_deoptimized = false;
                                        break;
                                    }

                                    if let js_ast::ExprData::EBinary(rb) = right.data {
                                        bin = rb;
                                        continue;
                                    }

                                    break;
                                }
                                let _ = bin_ptr;
                            }
                        }
                    }
                    let _ = &mut *part;
                    // PORT NOTE: Zig had no explicit continue/break here; loop continues
                    continue 'outer_part_loop;
                }
            }
        } else if p.options.bundle && parts.is_empty() {
            // This flag is disabled because it breaks circular export * as from
            //
            //  entry.js:
            //
            //    export * from './foo';
            //
            //  foo.js:
            //
            //    export const foo = 123
            //    export * as ns from './foo'
            //
            if false
            /* TODO(b2-blocked): feature_flag — Zig gates with comptime FeatureFlags.export_star_redirect (false) */
            {
                // If the file only contains "export * from './blah'
                // we pretend the file never existed in the first place.
                // the semantic difference here is in export default statements
                // note: export_star_import_records are not filled in yet

                if !before.is_empty() && p.import_records.len() == 1 {
                    let export_star_redirect: Option<&S::ExportStar> = 'brk: {
                        let mut export_star: Option<&S::ExportStar> = None;
                        for part in before.iter() {
                            for stmt in part.stmts.iter() {
                                match &stmt.data {
                                    js_ast::StmtData::SExportStar(star) => {
                                        if star.alias.is_some() {
                                            break 'brk None;
                                        }

                                        if export_star.is_some() {
                                            break 'brk None;
                                        }

                                        export_star = Some(&**star);
                                    }
                                    js_ast::StmtData::SEmpty(_) | js_ast::StmtData::SComment(_) => {
                                    }
                                    _ => {
                                        break 'brk None;
                                    }
                                }
                            }
                        }
                        export_star
                    };

                    if let Some(star) = export_star_redirect {
                        return Ok(crate::Result::Ast(Box::new(js_ast::Ast {
                            // TODO(port): Zig set `.arena = p.arena`; arena ownership tracked elsewhere in Rust
                            // See note on the matching arm above re double-ownership.
                            import_records: unsafe {
                                Vec::from_bump_slice(p.import_records.items_mut())
                            },
                            redirect_import_record_index: Some(star.import_record_index),
                            named_imports: core::mem::take(&mut *p.named_imports),
                            named_exports: core::mem::take(&mut p.named_exports),
                            ..Default::default()
                        })));
                    }
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

        if p.is_deoptimized_commonjs() {
            exports_kind = js_ast::ExportsKind::Cjs;
        } else if p.esm_export_keyword.len > 0 || p.top_level_await_keyword.len > 0 {
            exports_kind = js_ast::ExportsKind::Esm;
        } else if uses_exports_ref || uses_module_ref || p.has_top_level_return || p.has_with_scope
        {
            exports_kind = js_ast::ExportsKind::Cjs;
            if p.options.features.commonjs_at_runtime {
                wrap_mode = WrapMode::BunCommonjs;

                let import_record: Option<&ImportRecord> = 'brk: {
                    for import_record in p.import_records.items() {
                        if import_record.flags.intersects(
                            ImportRecordFlags::IS_INTERNAL | ImportRecordFlags::IS_UNUSED,
                        ) {
                            continue;
                        }
                        if import_record.kind == bun_ast::ImportKind::Stmt {
                            break 'brk Some(import_record);
                        }
                    }

                    None
                };

                // make it an error to use an import statement with a commonjs exports usage
                if let Some(record) = import_record {
                    // find the usage of the export symbol

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
            // PORT NOTE: Zig used `inline for (comptime std.meta.fieldNames(Jest))` — comptime
            // reflection over Jest's Ref fields. Rust iterates the static `Jest::FIELDS`
            // table (`&[(&'static str, fn(&Jest) -> Ref)]`) instead; declaration order
            // matches the Zig struct so emitted clause/property order is identical.
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
                    import_record_indices: vec![import_record_id],
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
                                ref_: Some(r),
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
                        star_name_loc: None,
                        is_single_line: false,
                    },
                    bun_ast::Loc::EMPTY,
                );

                let part_stmts = p.arena.alloc_slice_fill_with(1, |_| import_stmt);
                before.push(js_ast::Part {
                    stmts: part_stmts.into(),
                    declared_symbols,
                    import_record_indices: vec![import_record_id],
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

            runtime_imports[0..i].sort_unstable_by(|a, b| {
                RuntimeImports::ALL_SORTED_INDEX[*a as usize]
                    .cmp(&RuntimeImports::ALL_SORTED_INDEX[*b as usize])
            });

            if i > 0 {
                // PORT NOTE: snapshot to break the `&mut self` ↔ `&self.runtime_imports`
                // borrow overlap in `generate_import_stmt(symbols: &Sym)`; the callee
                // never touches `self.runtime_imports`, so the clone is purely a
                // borrow-checker workaround (Zig passed by value here).
                let symbols = p.runtime_imports.clone();
                p.generate_import_stmt(
                    RuntimeImports::NAME,
                    &runtime_imports[0..i],
                    &mut before,
                    &symbols,
                    None,
                    b"import_",
                    true,
                )
                .expect("unreachable");
            }
        }

        // handle new way to do automatic JSX imports which fixes symbol collision issues
        if p.options.jsx.parse
            && p.options.features.auto_import_jsx
            && p.options.jsx.runtime == options::JSX::Runtime::Automatic
        {
            // PORT NOTE: `generate_import_stmt` takes `&mut self` plus `import_path: &'a [u8]`
            // and `symbols: &Sym`, so the Pragma-owned `Box<[u8]>` paths are copied into the
            // bump arena (giving them the required `'a` lifetime) and `jsx_imports` is moved
            // out via `take` (it is `Default`) to avoid an overlapping `&self.jsx_imports`
            // borrow. The callee never reads `self.jsx_imports`, so the take/restore is
            // semantically a no-op vs. the Zig.
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
        if !p.response_ref.is_null() && {
            // We only want to do this if the symbol is used and didn't get
            // bound to some other value
            let symbol: &Symbol = &p.symbols.as_slice()[p.response_ref.inner_index() as usize];
            !symbol.has_link() && symbol.use_count_estimate > 0
        } {
            p.generate_import_stmt_for_bake_response(&mut before)?;
        }

        if !before.is_empty() || !after.is_empty() {
            // Single up-front reserve preserves the Zig fused-growth; the inner
            // reserve() calls in prepend_from / append become no-ops.
            parts.reserve(before.len() + after.len());
            bun_collections::prepend_from(&mut parts, &mut before);
            parts.append(&mut after); // std Vec::append: bitwise-move tail, same allocator
        }

        // Pop the module scope to apply the "ContainsDirectEval" rules
        // p.popScope();

        #[cfg(not(target_arch = "wasm32"))]
        if true
        /* TODO(b2-blocked): feature_flag */
        {
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

        Ok(crate::Result::Ast(p.to_ast(
            &mut parts,
            exports_kind,
            wrap_mode,
            hashbang,
        )?))
    }

    // PORT NOTE: associated fn (was `&self` reading `self.lexer.source.contents`)
    // because `_parse` consumes `self` by value and destructures it before this
    // call site; the source contents are passed explicitly.
    #[allow(dead_code)] // called from gated `_parse` body above
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

// ported from: src/js_parser/ast/Parser.zig

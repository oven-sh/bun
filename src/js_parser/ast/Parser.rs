use core::ffi::c_void;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::BabyList;
use bun_core::{self, err, Error, Output};
use bun_logger as logger;
use bun_str::strings;
use bun_wyhash::Wyhash;

use bun_bundler::options;
use bun_bundler::defines::Define;
use bun_options_types::import_record::ImportRecord;

use bun_js_parser as js_parser;
use bun_js_parser::js_lexer;
use bun_js_parser::ast as js_ast;
use bun_js_parser::ast::{B, DeclaredSymbol, E, Expr, G, S, Stmt, StmtList, Symbol};
use bun_js_parser::ast::G::Decl;
use bun_js_parser::runtime::Runtime;

use js_parser::{
    JSXImportScanner, JSXParser, JavaScriptImportScanner, JavaScriptParser, Jest,
    ParseStatementOptions, ScanPassResult, SideEffects, TSXImportScanner, TSXParser,
    TypeScriptImportScanner, TypeScriptParser, WrapMode,
};

type RuntimeFeatures = Runtime::Features;
type RuntimeImports = Runtime::Imports;

// In AST crates, ListManaged(T) backed by the arena → bumpalo Vec.
type BumpVec<'bump, T> = bumpalo::collections::Vec<'bump, T>;

pub struct Parser<'a> {
    pub options: Options<'a>,
    pub lexer: js_lexer::Lexer<'a>,
    pub log: &'a mut logger::Log,
    pub source: &'a logger::Source,
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

    pub macro_context: &'a mut MacroContext,

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
    pub framework: Option<&'a bun_bake::Framework>,

    /// REPL mode: transforms code for interactive evaluation
    /// - Wraps lone object literals `{...}` in parentheses
    /// - Hoists variable declarations for REPL persistence
    /// - Wraps last expression in { value: expr } for result capture
    /// - Wraps code with await in async IIFE
    pub repl_mode: bool,
}

impl<'a> Default for Options<'a> {
    fn default() -> Self {
        // TODO(port): macro_context default was `undefined` in Zig — caller must set before use.
        // Using a dangling reference is UB in Rust; Phase B should make this Option<&'a mut ...>
        // or require it in a constructor.
        unimplemented!("Options::default() requires macro_context; use Options::init()")
    }
}

impl<'a> Options<'a> {
    pub fn hash_for_runtime_transpiler(&self, hasher: &mut Wyhash, did_use_jsx: bool) {
        debug_assert!(!self.bundle);

        if did_use_jsx {
            if self.jsx.parse {
                self.jsx.hash_for_runtime_transpiler(hasher);
                // this holds the values for the jsx optimizaiton flags, which have both been removed
                // as the optimizations break newer versions of react, see https://github.com/oven-sh/bun/issues/11025
                let jsx_optimizations: [bool; 2] = [false, false];
                // SAFETY: [bool; 2] is POD; asBytes in Zig is a byte view of the value.
                hasher.update(unsafe {
                    core::slice::from_raw_parts(
                        jsx_optimizations.as_ptr().cast::<u8>(),
                        core::mem::size_of::<[bool; 2]>(),
                    )
                });
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
        // TODO(port): Zig left `macro_context` as `undefined` and the rest of the fields at
        // their declared defaults. Rust cannot express an undefined &mut field. Phase B must
        // restructure: either pass macro_context here, or make it Option<&mut MacroContext>.
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
            // TODO(port): was `undefined` in Zig
            macro_context: unsafe {
                // SAFETY: matches Zig's `undefined`; caller must overwrite before any read.
                core::mem::transmute::<usize, &'static mut MacroContext>(usize::MAX)
                // TODO(port): replace with Option<&mut MacroContext> in Phase B
            },
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

impl<'a> Parser<'a> {
    pub fn scan_imports(&mut self, scan_pass: &mut ScanPassResult) -> Result<(), Error> {
        if self.options.ts && self.options.jsx.parse {
            self._scan_imports::<TSXImportScanner>(scan_pass)
        } else if self.options.ts {
            self._scan_imports::<TypeScriptImportScanner>(scan_pass)
        } else if self.options.jsx.parse {
            self._scan_imports::<JSXImportScanner>(scan_pass)
        } else {
            self._scan_imports::<JavaScriptImportScanner>(scan_pass)
        }
    }

    // TODO(port): `P` needs a trait bound covering init/parse_stmts_up_to/add_import_record/etc.
    // In Zig these are the NewParser(...) instantiations; Phase B should define `trait ParserImpl`.
    fn _scan_imports<P>(&mut self, scan_pass: &mut ScanPassResult) -> Result<(), Error> {
        let mut p = P::init(
            self.bump,
            self.log,
            self.source,
            self.define,
            self.lexer,
            self.options,
        )?;
        p.import_records = &mut scan_pass.import_records;
        p.named_imports = &mut scan_pass.named_imports;

        // The problem with our scan pass approach is type-only imports.
        // We don't have accurate symbol counts.
        // So we don't have a good way to distinguish between a type-only import and not.
        if P::PARSER_FEATURES.typescript {
            p.parse_pass_symbol_uses = &mut scan_pass.used_symbols;
        }

        // Parse the file in the first pass, but do not bind symbols
        let mut opts = ParseStatementOptions { is_module_scope: true, ..Default::default() };

        // Parsing seems to take around 2x as much time as visiting.
        // Which makes sense.
        // June 4: "Parsing took: 18028000"
        // June 4: "Rest of this took: 8003000"
        match p.parse_stmts_up_to(js_lexer::T::TEndOfFile, &mut opts) {
            Ok(_) => {}
            Err(e) => {
                if e == err!("StackOverflow") {
                    // The lexer location won't be totally accurate, but it's kind of helpful.
                    p.log.add_error(p.source, p.lexer.loc(), b"Maximum call stack size exceeded")?;
                    return Ok(());
                }
                return Err(e);
            }
        }

        //
        if P::PARSER_FEATURES.typescript {
            for import_record in scan_pass.import_records.as_mut_slice() {
                // Mark everything as unused
                // Except:
                // - export * as ns from 'foo';
                // - export * from 'foo';
                // - import 'foo';
                // - import("foo")
                // - require("foo")
                import_record.flags.is_unused = import_record.flags.is_unused
                    || (import_record.kind == bun_options_types::ImportKind::Stmt
                        && !import_record.flags.was_originally_bare_import
                        && !import_record.flags.calls_runtime_re_export_fn);
            }

            let mut iter = scan_pass.used_symbols.iterator();
            while let Some(entry) = iter.next() {
                let val = entry.value_ptr;
                if val.used {
                    scan_pass.import_records.as_mut_slice()[val.import_record_index as usize]
                        .flags
                        .is_unused = false;
                }
            }
        }

        // Symbol use counts are unavailable
        // So we say "did we parse any JSX?"
        // if yes, just automatically add the import so that .bun knows to include the file.
        if self.options.jsx.parse && p.needs_jsx_import {
            let _ = p.add_import_record(
                bun_options_types::ImportKind::Require,
                logger::Loc { start: 0 },
                p.options.jsx.import_source(),
            );
            // Ensure we have both classic and automatic
            // This is to handle cases where they use fragments in the automatic runtime
            let _ = p.add_import_record(
                bun_options_types::ImportKind::Require,
                logger::Loc { start: 0 },
                p.options.jsx.classic_import_source,
            );
        }

        scan_pass.approximate_newline_count = p.lexer.approximate_newline_count;
        Ok(())
    }

    pub fn to_lazy_export_ast(
        &mut self,
        expr: Expr,
        runtime_api_call: &'static [u8],
        symbols: Symbol::List,
    ) -> Result<js_ast::Result, Error> {
        // TODO(port): narrow error set
        let mut p = JavaScriptParser::init(
            self.bump,
            self.log,
            self.source,
            self.define,
            self.lexer,
            self.options,
        )?;

        p.lexer.track_comments = self.options.features.minify_identifiers;
        // Instead of doing "should_fold_typescript_constant_expressions or features.minify_syntax"
        // Let's enable this flag file-wide
        if p.options.features.minify_syntax || p.options.features.inlining {
            p.should_fold_typescript_constant_expressions = true;
        }

        // If we added to `p.symbols` it's going to fuck up all the indices
        // in the `symbols` array.
        debug_assert!(p.symbols.len() == 0);
        let mut symbols_ = symbols;
        p.symbols = symbols_.move_to_list_managed(p.bump);

        p.prepare_for_visit_pass()?;

        let mut final_expr = expr;

        // Optionally call a runtime API function to transform the expression
        if !runtime_api_call.is_empty() {
            let args = p.bump.alloc_slice_fill_with(1, |_| expr);
            final_expr = p.call_runtime(expr.loc, runtime_api_call, args);
        }

        let ns_export_part = js_ast::Part {
            can_be_removed_if_unused: true,
            ..Default::default()
        };

        let stmts = p.bump.alloc_slice_fill_with(1, |_| Stmt {
            data: js_ast::Stmt::Data::SLazyExport({
                let data = p.bump.alloc(final_expr.data);
                data
            }),
            loc: expr.loc,
        });
        let part = js_ast::Part {
            stmts,
            symbol_uses: p.symbol_uses,
            ..Default::default()
        };
        p.symbol_uses = Default::default();
        let mut parts = BumpVec::with_capacity_in(2, p.bump);
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
        parts.extend_from_slice(&[ns_export_part, part]);

        let exports_kind: js_ast::ExportsKind = 'brk: {
            if matches!(expr.data, js_ast::Expr::Data::EUndefined) {
                if self.source.path.name.ext == b".cjs" {
                    break 'brk js_ast::ExportsKind::Cjs;
                }
                if self.source.path.name.ext == b".mjs" {
                    break 'brk js_ast::ExportsKind::Esm;
                }
            }
            js_ast::ExportsKind::None
        };
        Ok(js_ast::Result::Ast(p.to_ast(&mut parts, exports_kind, WrapMode::None, b"")?))
    }

    pub fn parse(&mut self) -> Result<js_ast::Result, Error> {
        // TODO(port): narrow error set
        #[cfg(target_arch = "wasm32")]
        {
            self.options.ts = true;
            self.options.jsx.parse = true;
            return self._parse::<TSXParser>();
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            if self.options.ts && self.options.jsx.parse {
                self._parse::<TSXParser>()
            } else if self.options.ts {
                self._parse::<TypeScriptParser>()
            } else if self.options.jsx.parse {
                self._parse::<JSXParser>()
            } else {
                self._parse::<JavaScriptParser>()
            }
        }
    }

    pub fn analyze(
        &mut self,
        context: *mut c_void,
        callback: &dyn Fn(*mut c_void, &mut TSXParser, &mut [js_ast::Part]) -> Result<(), Error>,
    ) -> Result<(), Error> {
        let mut p = TSXParser::init(
            self.bump,
            self.log,
            self.source,
            self.define,
            self.lexer,
            self.options,
        )?;

        // Consume a leading hashbang comment
        let mut hashbang: &[u8] = b"";
        if p.lexer.token == js_lexer::T::THashbang {
            hashbang = p.lexer.identifier;
            p.lexer.next()?;
        }
        let _ = hashbang;

        // Parse the file in the first pass, but do not bind symbols
        let mut opts = ParseStatementOptions { is_module_scope: true, ..Default::default() };
        let parse_tracer = bun_core::perf::trace("JSParser.parse");

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
                    let _ = p.log.print(Output::writer());
                }
                return Err(e);
            }
        };

        parse_tracer.end();

        if self.log.errors > 0 {
            #[cfg(target_arch = "wasm32")]
            {
                // If the logger is backed by console.log, every print appends a newline.
                // so buffering is kind of mandatory here
                // TODO(port): Zig builds a custom GenericWriter wrapping Output::print and a
                // buffered writer over it. Phase B should provide a `bun_core::Output::buffered()`
                // that returns an `impl core::fmt::Write` flushed on drop.
                for msg in self.log.msgs.as_slice() {
                    let mut m: logger::Msg = *msg;
                    let _ = m.write_format(Output::writer(), true);
                }
            }
            return Err(err!("SyntaxError"));
        }

        let visit_tracer = bun_core::perf::trace("JSParser.visit");
        p.prepare_for_visit_pass()?;

        let mut parts = BumpVec::new_in(p.bump);

        p.append_part(&mut parts, stmts)?;
        visit_tracer.end();

        let analyze_tracer = bun_core::perf::trace("JSParser.analyze");
        callback(context, &mut p, parts.as_mut_slice())?;
        analyze_tracer.end();
        Ok(())
    }

    // TODO(port): `P` needs a trait bound; see _scan_imports note.
    fn _parse<P>(&mut self) -> Result<js_ast::Result, Error> {
        // TODO(port): narrow error set
        let prev_action = bun_crash_handler::current_action();
        let _restore = scopeguard::guard((), |_| {
            bun_crash_handler::set_current_action(prev_action);
        });
        bun_crash_handler::set_current_action(bun_crash_handler::Action::Parse(
            self.source.path.text,
        ));

        let orig_error_count = self.log.errors;
        let mut p = P::init(
            self.bump,
            self.log,
            self.source,
            self.define,
            self.lexer,
            self.options,
        )?;

        if p.options.features.hot_module_reloading {
            debug_assert!(!p.options.tree_shaking);
        }

        // Instead of doing "should_fold_typescript_constant_expressions or features.minify_syntax"
        // Let's enable this flag file-wide
        if p.options.features.minify_syntax || p.options.features.inlining {
            p.should_fold_typescript_constant_expressions = true;
        }

        // PERF(port): was stack-fallback allocator (42 * sizeof(BinaryExpressionVisitor)) — profile in Phase B
        p.binary_expression_stack = Vec::with_capacity(41);
        // PERF(port): was stack-fallback allocator (48 * sizeof(BinaryExpressionSimplifyVisitor)) — profile in Phase B
        p.binary_expression_simplify_stack = Vec::with_capacity(47);

        // (Zig asserted the stack-fallback allocator owns the buffer; not applicable here.)

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
        if self.options.features.dont_bundle_twice {
            if let Some(pragma) = self.has_bun_pragma(!hashbang.is_empty()) {
                return Ok(js_ast::Result::AlreadyBundled(pragma));
            }
        }

        // We must check the cache only after we've consumed the hashbang and leading // @bun pragma
        // We don't want to ever put files with `// @bun` into this cache, as that would be wasteful.
        #[cfg(not(target_arch = "wasm32"))]
        if bun_core::FeatureFlags::RUNTIME_TRANSPILER_CACHE {
            let runtime_transpiler_cache: Option<&mut bun_jsc::RuntimeTranspilerCache> =
                p.options.features.runtime_transpiler_cache;
            if let Some(cache) = runtime_transpiler_cache {
                if cache.get(
                    p.source,
                    &p.options,
                    p.options.jsx.parse
                        && (!p.source.path.is_node_module() || p.source.path.is_jsx_file()),
                ) {
                    return Ok(js_ast::Result::Cached);
                }
            }
        }

        // Parse the file in the first pass, but do not bind symbols
        let mut opts = ParseStatementOptions { is_module_scope: true, ..Default::default() };
        let parse_tracer = bun_core::perf::trace("JSParser.parse");

        // Parsing seems to take around 2x as much time as visiting.
        // Which makes sense.
        // June 4: "Parsing took: 18028000"
        // June 4: "Rest of this took: 8003000"
        let stmts = match p.parse_stmts_up_to(js_lexer::T::TEndOfFile, &mut opts) {
            Ok(s) => s,
            Err(e) => {
                parse_tracer.end();
                if e == err!("StackOverflow") {
                    // The lexer location won't be totally accurate, but it's kind of helpful.
                    p.log.add_error(p.source, p.lexer.loc(), b"Maximum call stack size exceeded")?;

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
        if self.log.errors > orig_error_count {
            return Err(err!("SyntaxError"));
        }

        bun_crash_handler::set_current_action(bun_crash_handler::Action::Visit(
            self.source.path.text,
        ));

        let visit_tracer = bun_core::perf::trace("JSParser.visit");
        p.prepare_for_visit_pass()?;

        let mut before = BumpVec::<js_ast::Part>::new_in(p.bump);
        let mut after = BumpVec::<js_ast::Part>::new_in(p.bump);
        let mut parts = BumpVec::<js_ast::Part>::new_in(p.bump);
        // (defer after.deinit()/before.deinit() — handled by Drop on bumpalo Vec, which is a no-op)

        if p.options.bundle {
            // The bundler requires a part for generated module wrappers. This
            // part must be at the start as it is referred to by index.
            before.push(js_ast::Part::default());
        }

        // --inspect-brk
        if p.options.features.set_breakpoint_on_first_line {
            let debugger_stmts = p.bump.alloc_slice_fill_with(1, |_| Stmt {
                data: js_ast::Stmt::Data::SDebugger(Default::default()),
                loc: logger::Loc::EMPTY,
            });
            before.push(js_ast::Part {
                stmts: debugger_stmts,
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

            let mut preprocessed_enums: BumpVec<&[js_ast::Part]> = BumpVec::new_in(p.bump);
            let mut preprocessed_enum_i: usize = 0;
            if p.scopes_in_order_for_enum.count() > 0 {
                for stmt in stmts.iter_mut() {
                    if matches!(stmt.data, js_ast::Stmt::Data::SEnum(_)) {
                        let old_scopes_in_order = p.scope_order_to_visit;
                        // PORT NOTE: reshaped for borrowck — restore after the block instead of `defer`
                        p.scope_order_to_visit =
                            p.scopes_in_order_for_enum.get(stmt.loc).unwrap();

                        let mut enum_parts = BumpVec::<js_ast::Part>::new_in(p.bump);
                        let mut sliced = BumpVec::<Stmt>::with_capacity_in(1, p.bump);
                        // PERF(port): was assume_capacity
                        sliced.push(*stmt);
                        p.append_part(&mut enum_parts, sliced.as_mut_slice())?;
                        preprocessed_enums.push(enum_parts.into_bump_slice());

                        p.scope_order_to_visit = old_scopes_in_order;
                    }
                }
            }

            // When tree shaking is enabled, each top-level statement is potentially a separate part.
            for stmt in stmts.iter() {
                match &stmt.data {
                    js_ast::Stmt::Data::SLocal(local) => {
                        if local.decls.len() > 1 {
                            for decl in local.decls.slice() {
                                let mut sliced = BumpVec::<Stmt>::with_capacity_in(1, p.bump);
                                // SAFETY: capacity reserved above
                                unsafe { sliced.set_len(1) };
                                let mut _local = **local;
                                _local.decls = G::Decl::List::init_one(p.bump, *decl)?;
                                sliced[0] = p.s(_local, stmt.loc);
                                p.append_part(&mut parts, sliced.as_mut_slice())?;
                            }
                        } else {
                            let mut sliced = BumpVec::<Stmt>::with_capacity_in(1, p.bump);
                            // SAFETY: capacity for 1 reserved by with_capacity_in above; element written immediately below before any read.
                            unsafe { sliced.set_len(1) };
                            sliced[0] = *stmt;
                            p.append_part(&mut parts, sliced.as_mut_slice())?;
                        }
                    }
                    js_ast::Stmt::Data::SImport(_)
                    | js_ast::Stmt::Data::SExportFrom(_)
                    | js_ast::Stmt::Data::SExportStar(_) => {
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

                        let mut sliced = BumpVec::<Stmt>::with_capacity_in(1, p.bump);
                        // SAFETY: capacity for 1 reserved by with_capacity_in above; element written immediately below before any read.
                        unsafe { sliced.set_len(1) };
                        sliced[0] = *stmt;
                        p.append_part(parts_list, sliced.as_mut_slice())?;
                    }

                    js_ast::Stmt::Data::SClass(class) => {
                        // Move class export statements to the top of the file if we can
                        // This automatically resolves some cyclical import issues
                        // https://github.com/kysely-org/kysely/issues/412
                        let should_move = !p.options.bundle && class.class.can_be_moved();

                        let mut sliced = BumpVec::<Stmt>::with_capacity_in(1, p.bump);
                        // SAFETY: capacity for 1 reserved by with_capacity_in above; element written immediately below before any read.
                        unsafe { sliced.set_len(1) };
                        sliced[0] = *stmt;
                        p.append_part(&mut parts, sliced.as_mut_slice())?;

                        if should_move {
                            before.push(*parts.last().expect("unreachable"));
                            // PORT NOTE: reshaped for borrowck
                            let new_len = parts.len() - 1;
                            parts.truncate(new_len);
                        }
                    }
                    js_ast::Stmt::Data::SExportDefault(value) => {
                        // We move export default statements when we can
                        // This automatically resolves some cyclical import issues in packages like luxon
                        // https://github.com/oven-sh/bun/issues/1961
                        let should_move = !p.options.bundle && value.can_be_moved();
                        let mut sliced = BumpVec::<Stmt>::with_capacity_in(1, p.bump);
                        // SAFETY: capacity for 1 reserved by with_capacity_in above; element written immediately below before any read.
                        unsafe { sliced.set_len(1) };
                        sliced[0] = *stmt;
                        p.append_part(&mut parts, sliced.as_mut_slice())?;

                        if should_move {
                            before.push(*parts.last().expect("unreachable"));
                            let new_len = parts.len() - 1;
                            parts.truncate(new_len);
                        }
                    }
                    js_ast::Stmt::Data::SEnum(_) => {
                        parts.extend_from_slice(preprocessed_enums[preprocessed_enum_i]);
                        preprocessed_enum_i += 1;

                        let enum_scope_count =
                            p.scopes_in_order_for_enum.get(stmt.loc).unwrap().len();
                        p.scope_order_to_visit = &p.scope_order_to_visit[enum_scope_count..];
                    }
                    _ => {
                        let mut sliced = BumpVec::<Stmt>::with_capacity_in(1, p.bump);
                        // PERF(port): was assume_capacity
                        sliced.push(*stmt);
                        p.append_part(&mut parts, sliced.as_mut_slice())?;
                    }
                }
            }
        }

        visit_tracer.end();

        // If there were errors while visiting, also halt here
        if self.log.errors > orig_error_count {
            return Err(err!("SyntaxError"));
        }

        let postvisit_tracer = bun_core::perf::trace("JSParser.postvisit");
        let _postvisit_guard = scopeguard::guard((), move |_| postvisit_tracer.end());

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
                    DeclaredSymbol::List::init_capacity(p.bump, count).expect("unreachable");
                let decls = p.bump.alloc_slice_fill_default::<G::Decl>(count);
                if uses_dirname {
                    decls[0] = G::Decl {
                        binding: p.b(B::Identifier { ref_: p.dirname_ref }, logger::Loc::EMPTY),
                        value: Some(p.new_expr(
                            E::String { data: p.source.path.name.dir, ..Default::default() },
                            logger::Loc::EMPTY,
                        )),
                    };
                    // PERF(port): was assume_capacity
                    declared_symbols.push(DeclaredSymbol { ref_: p.dirname_ref, is_top_level: true });
                }
                if uses_filename {
                    decls[uses_dirname as usize] = G::Decl {
                        binding: p.b(B::Identifier { ref_: p.filename_ref }, logger::Loc::EMPTY),
                        value: Some(p.new_expr(
                            E::String { data: p.source.path.text, ..Default::default() },
                            logger::Loc::EMPTY,
                        )),
                    };
                    declared_symbols.push(DeclaredSymbol { ref_: p.filename_ref, is_top_level: true });
                }

                let part_stmts = p.bump.alloc_slice_fill_with(1, |_| {
                    p.s(
                        S::Local {
                            kind: S::Local::Kind::KVar,
                            decls: Decl::List::from_owned_slice(decls),
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    )
                });
                before.push(js_ast::Part {
                    stmts: part_stmts,
                    declared_symbols,
                    tag: js_ast::Part::Tag::DirnameFilename,
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
                let all_stmts = p
                    .bump
                    .alloc_slice_fill_default::<Stmt>(p.imports_to_convert_from_require.len());
                before.reserve(p.imports_to_convert_from_require.len());

                let mut remaining_stmts: &mut [Stmt] = all_stmts;

                for deferred_import in p.imports_to_convert_from_require.as_slice() {
                    let (import_part_stmts, rest) = remaining_stmts.split_at_mut(1);
                    remaining_stmts = rest;

                    p.module_scope
                        .generated
                        .push(p.bump, deferred_import.namespace.ref_.unwrap());

                    import_part_stmts[0] = Stmt::alloc(
                        S::Import {
                            star_name_loc: Some(deferred_import.namespace.loc),
                            import_record_index: deferred_import.import_record_id,
                            namespace_ref: deferred_import.namespace.ref_.unwrap(),
                            ..Default::default()
                        },
                        deferred_import.namespace.loc,
                    );
                    let mut declared_symbols =
                        DeclaredSymbol::List::init_capacity(p.bump, 1).expect("unreachable");
                    declared_symbols.push(DeclaredSymbol {
                        ref_: deferred_import.namespace.ref_.unwrap(),
                        is_top_level: true,
                    });
                    // PERF(port): was assume_capacity
                    before.push(js_ast::Part {
                        stmts: import_part_stmts,
                        declared_symbols,
                        tag: js_ast::Part::Tag::ImportToConvertFromRequire,
                        // This part has a single symbol, so it may be removed if unused.
                        can_be_removed_if_unused: true,
                        ..Default::default()
                    });
                }
                debug_assert!(remaining_stmts.is_empty());
            }

            if p.commonjs_named_exports.count() > 0 {
                let export_refs = p.commonjs_named_exports.values();
                let export_names = p.commonjs_named_exports.keys();

                'break_optimize: {
                    if !p.commonjs_named_exports_deoptimized {
                        let mut needs_decl_count: usize = 0;
                        for export_ref in export_refs.iter() {
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
                            if needs_decl_count == export_names.len() {
                                force_esm = true;
                                break 'break_optimize;
                            }
                        }

                        if needs_decl_count > 0 {
                            p.symbols.as_mut_slice()[p.exports_ref.inner_index() as usize]
                                .use_count_estimate += export_refs.len() as u32;
                            p.deoptimize_commonjs_named_exports();
                        }
                    }
                }

                if !p.commonjs_named_exports_deoptimized && p.esm_export_keyword.len == 0 {
                    p.esm_export_keyword.loc = export_refs[0].loc_ref.loc;
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
                    for s in part.stmts.iter() {
                        match s.data {
                            js_ast::Stmt::Data::SComment(_)
                            | js_ast::Stmt::Data::SDirective(_)
                            | js_ast::Stmt::Data::SEmpty(_) => continue,
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
                    if let js_ast::Stmt::Data::SExpr(s_expr) = &stmt.data {
                        let value: Expr = s_expr.value;

                        if let js_ast::Expr::Data::EBinary(bin) = &value.data {
                            let left = bin.left;
                            let right = bin.right;
                            if bin.op == js_ast::Op::BinAssign
                                && matches!(&left.data, js_ast::Expr::Data::EDot(d)
                                    if d.name == b"exports"
                                        && matches!(&d.target.data, js_ast::Expr::Data::EIdentifier(id)
                                            if id.ref_.eql(p.module_ref)))
                            {
                                let redirect_import_record_index: Option<u32> = 'inner_brk: {
                                    // general case:
                                    //
                                    //      module.exports = require("foo");
                                    //
                                    if let js_ast::Expr::Data::ERequireString(req) = &right.data {
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
                                    if let js_ast::Expr::Data::EIdentifier(id) = &right.data {
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
                                    return Ok(js_ast::Result::Ast(js_ast::Ast {
                                        import_records: ImportRecord::List::move_from_list(
                                            &mut p.import_records,
                                        ),
                                        redirect_import_record_index: id,
                                        named_imports: p.named_imports,
                                        named_exports: p.named_exports,
                                        ..Default::default()
                                    }));
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
                    if part.stmts.len() > 1 {
                        break;
                    }

                    for j in 0..part.stmts.len() {
                        let stmt = &mut part.stmts[j];
                        if let js_ast::Stmt::Data::SExpr(s_expr) = &stmt.data {
                            let value: Expr = s_expr.value;

                            if let js_ast::Expr::Data::EBinary(mut bin_ptr) = value.data {
                                let mut bin = bin_ptr;
                                loop {
                                    let left = bin.left;
                                    let right = bin.right;

                                    if bin.op == js_ast::Op::BinAssign
                                        && matches!(right.data, js_ast::Expr::Data::ERequireString(_))
                                        && matches!(&left.data, js_ast::Expr::Data::EDot(d)
                                            if d.name == b"exports"
                                                && matches!(&d.target.data, js_ast::Expr::Data::EIdentifier(id)
                                                    if id.ref_.eql(p.module_ref)))
                                    {
                                        let req = match &right.data {
                                            js_ast::Expr::Data::ERequireString(r) => r,
                                            _ => unreachable!(),
                                        };
                                        p.export_star_import_records
                                            .push(p.bump, req.import_record_index);
                                        let namespace_ref = p
                                            .imports_to_convert_from_require
                                            .as_slice()[req.unwrapped_id as usize]
                                            .namespace
                                            .ref_
                                            .unwrap();

                                        let stmt_loc = stmt.loc;
                                        part.stmts = {
                                            let mut new_stmts = BumpVec::<Stmt>::with_capacity_in(
                                                part.stmts.len() + 1,
                                                p.bump,
                                            );
                                            // PERF(port): was appendSliceAssumeCapacity
                                            new_stmts.extend_from_slice(&part.stmts[0..j]);

                                            new_stmts.push(Stmt::alloc(
                                                S::ExportStar {
                                                    import_record_index: req.import_record_index,
                                                    namespace_ref,
                                                    ..Default::default()
                                                },
                                                stmt_loc,
                                            ));
                                            new_stmts.extend_from_slice(&part.stmts[j + 1..]);
                                            new_stmts.into_bump_slice_mut()
                                        };

                                        part.import_record_indices
                                            .push(p.bump, req.import_record_index);
                                        p.symbols.as_mut_slice()
                                            [p.module_ref.inner_index() as usize]
                                            .use_count_estimate = 0;
                                        let ns_idx = namespace_ref.inner_index() as usize;
                                        p.symbols.as_mut_slice()[ns_idx].use_count_estimate =
                                            p.symbols.as_slice()[ns_idx]
                                                .use_count_estimate
                                                .saturating_sub(1);
                                        let _ = part.symbol_uses.swap_remove(namespace_ref);

                                        for (i, before_part) in before.iter().enumerate() {
                                            if before_part.tag
                                                == js_ast::Part::Tag::ImportToConvertFromRequire
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

                                    if let js_ast::Expr::Data::EBinary(rb) = right.data {
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
            if bun_core::FeatureFlags::EXPORT_STAR_REDIRECT {
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
                                    js_ast::Stmt::Data::SExportStar(star) => {
                                        if star.alias.is_some() {
                                            break 'brk None;
                                        }

                                        if export_star.is_some() {
                                            break 'brk None;
                                        }

                                        export_star = Some(star);
                                    }
                                    js_ast::Stmt::Data::SEmpty(_)
                                    | js_ast::Stmt::Data::SComment(_) => {}
                                    _ => {
                                        break 'brk None;
                                    }
                                }
                            }
                        }
                        export_star
                    };

                    if let Some(star) = export_star_redirect {
                        return Ok(js_ast::Result::Ast(js_ast::Ast {
                            // TODO(port): Zig set `.allocator = p.allocator`; arena ownership tracked elsewhere in Rust
                            import_records: ImportRecord::List::init(p.import_records.as_slice()),
                            redirect_import_record_index: star.import_record_index,
                            named_imports: p.named_imports,
                            named_exports: p.named_exports,
                            ..Default::default()
                        }));
                    }
                }
            }
        }

        // Analyze cross-part dependencies for tree shaking and code splitting
        let mut exports_kind = js_ast::ExportsKind::None;
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
                    for import_record in p.import_records.as_slice() {
                        if import_record.flags.is_internal || import_record.flags.is_unused {
                            continue;
                        }
                        if import_record.kind == bun_options_types::ImportKind::Stmt {
                            break 'brk Some(import_record);
                        }
                    }

                    None
                };

                // make it an error to use an import statement with a commonjs exports usage
                if let Some(record) = import_record {
                    // find the usage of the export symbol

                    let mut notes = BumpVec::<logger::Data>::new_in(p.bump);

                    notes.push(logger::Data {
                        text: {
                            use std::io::Write;
                            let mut v = Vec::<u8>::new();
                            let _ = write!(
                                &mut v,
                                "Try require({}) instead",
                                bun_core::fmt::QuotedFormatter { text: record.path.text }
                            );
                            // TODO(port): allocate in arena instead of global heap
                            v.into_boxed_slice()
                        },
                        ..Default::default()
                    });

                    if uses_module_ref {
                        notes.push(logger::Data {
                            text: b"This file is CommonJS because 'module' was used".as_slice().into(),
                            ..Default::default()
                        });
                    }

                    if uses_exports_ref {
                        notes.push(logger::Data {
                            text: b"This file is CommonJS because 'exports' was used".as_slice().into(),
                            ..Default::default()
                        });
                    }

                    if p.has_top_level_return {
                        notes.push(logger::Data {
                            text: b"This file is CommonJS because top-level return was used"
                                .as_slice()
                                .into(),
                            ..Default::default()
                        });
                    }

                    if p.has_with_scope {
                        notes.push(logger::Data {
                            text: b"This file is CommonJS because a \"with\" statement is used"
                                .as_slice()
                                .into(),
                            ..Default::default()
                        });
                    }

                    p.log.add_range_error_with_notes(
                        p.source,
                        record.range,
                        b"Cannot use import statement with CommonJS-only features",
                        notes.into_bump_slice(),
                    )?;
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
                        for import_record in p.import_records.as_slice() {
                            if import_record.flags.is_internal || import_record.flags.is_unused {
                                continue;
                            }
                            if import_record.kind == bun_options_types::ImportKind::Stmt {
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
                            && p.module_scope.strict_mode
                                == js_ast::StrictMode::ExplicitStrictMode)
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
                DeclaredSymbol::List::init_capacity(p.bump, count).expect("unreachable");
            let decls = p.bump.alloc_slice_fill_default::<G::Decl>(count);
            if uses_dirname {
                // var __dirname = import.meta
                decls[0] = G::Decl {
                    binding: p.b(B::Identifier { ref_: p.dirname_ref }, logger::Loc::EMPTY),
                    value: Some(p.new_expr(
                        E::Dot {
                            name: b"dir",
                            name_loc: logger::Loc::EMPTY,
                            target: p.new_expr(E::ImportMeta {}, logger::Loc::EMPTY),
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    )),
                };
                declared_symbols.push(DeclaredSymbol { ref_: p.dirname_ref, is_top_level: true });
            }
            if uses_filename {
                // var __filename = import.meta.path
                decls[uses_dirname as usize] = G::Decl {
                    binding: p.b(B::Identifier { ref_: p.filename_ref }, logger::Loc::EMPTY),
                    value: Some(p.new_expr(
                        E::Dot {
                            name: b"path",
                            name_loc: logger::Loc::EMPTY,
                            target: p.new_expr(E::ImportMeta {}, logger::Loc::EMPTY),
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    )),
                };
                declared_symbols.push(DeclaredSymbol { ref_: p.filename_ref, is_top_level: true });
            }

            let part_stmts = p.bump.alloc_slice_fill_with(1, |_| {
                p.s(
                    S::Local {
                        kind: S::Local::Kind::KVar,
                        decls: Decl::List::from_owned_slice(decls),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                )
            });
            before.push(js_ast::Part {
                stmts: part_stmts,
                declared_symbols,
                tag: js_ast::Part::Tag::DirnameFilename,
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
            let jest: &mut Jest = &mut p.jest;

            for item in p.import_records.as_slice() {
                // skip if they did import it
                if item.path.text == b"bun:test"
                    || item.path.text == b"@jest/globals"
                    || item.path.text == b"vitest"
                {
                    if let Some(cache) = p.options.features.runtime_transpiler_cache {
                        // If we rewrote import paths, we need to disable the runtime transpiler cache
                        if item.path.text != b"bun:test" {
                            cache.input_hash = None;
                        }
                    }

                    break 'outer;
                }
            }

            // if they didn't use any of the jest globals, don't inject it, I guess.
            // TODO(port): Zig used `inline for (comptime std.meta.fieldNames(Jest))` — comptime
            // reflection over Jest's Ref fields. Phase B should provide `Jest::FIELDS: &[(&'static str, fn(&Jest) -> Ref)]`
            // or a derive. Using a placeholder iterator here.
            let items_count: usize = {
                let mut count: usize = 0;
                for (_name, get_ref) in Jest::FIELDS {
                    count += (p.symbols.as_slice()[get_ref(jest).inner_index() as usize]
                        .use_count_estimate
                        > 0) as usize;
                }
                count
            };
            if items_count == 0 {
                break 'outer;
            }

            let mut declared_symbols = js_ast::DeclaredSymbol::List::default();
            declared_symbols.ensure_total_capacity(p.bump, items_count)?;

            // For CommonJS modules, use require instead of import
            if exports_kind == js_ast::ExportsKind::Cjs {
                let import_record_indices = p.bump.alloc_slice_fill_default::<u32>(1);
                let import_record_id = p.add_import_record(
                    bun_options_types::ImportKind::Require,
                    logger::Loc::EMPTY,
                    b"bun:test",
                );
                import_record_indices[0] = import_record_id;

                // Create object binding pattern for destructuring
                let properties = p.bump.alloc_slice_fill_default::<B::Property>(items_count);
                let mut prop_i: usize = 0;
                // TODO(port): comptime field reflection on Jest
                for (symbol_name, get_ref) in Jest::FIELDS {
                    let r = get_ref(jest);
                    if p.symbols.as_slice()[r.inner_index() as usize].use_count_estimate > 0 {
                        properties[prop_i] = B::Property {
                            key: p.new_expr(
                                E::String { data: symbol_name.as_bytes(), ..Default::default() },
                                logger::Loc::EMPTY,
                            ),
                            value: p.b(B::Identifier { ref_: r }, logger::Loc::EMPTY),
                            ..Default::default()
                        };
                        declared_symbols.push(DeclaredSymbol { ref_: r, is_top_level: true });
                        prop_i += 1;
                    }
                }

                // Create: const { test, expect, ... } = require("bun:test")
                let decls = p.bump.alloc_slice_fill_default::<G::Decl>(1);
                decls[0] = G::Decl {
                    binding: p.b(B::Object { properties, ..Default::default() }, logger::Loc::EMPTY),
                    value: Some(p.new_expr(
                        E::RequireString { import_record_index: import_record_id, ..Default::default() },
                        logger::Loc::EMPTY,
                    )),
                };

                let part_stmts = p.bump.alloc_slice_fill_with(1, |_| {
                    p.s(
                        S::Local {
                            kind: S::Local::Kind::KConst,
                            decls: Decl::List::from_owned_slice(decls),
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    )
                });

                before.push(js_ast::Part {
                    stmts: part_stmts,
                    declared_symbols,
                    import_record_indices: BabyList::<u32>::from_owned_slice(import_record_indices),
                    tag: js_ast::Part::Tag::BunTest,
                    ..Default::default()
                });
            } else {
                let import_record_indices = p.bump.alloc_slice_fill_default::<u32>(1);
                let import_record_id = p.add_import_record(
                    bun_options_types::ImportKind::Stmt,
                    logger::Loc::EMPTY,
                    b"bun:test",
                );
                import_record_indices[0] = import_record_id;

                // For ESM modules, use import statement
                let clauses = p
                    .bump
                    .alloc_slice_fill_default::<js_ast::ClauseItem>(items_count);
                let mut clause_i: usize = 0;
                // TODO(port): comptime field reflection on Jest
                for (symbol_name, get_ref) in Jest::FIELDS {
                    let r = get_ref(jest);
                    if p.symbols.as_slice()[r.inner_index() as usize].use_count_estimate > 0 {
                        clauses[clause_i] = js_ast::ClauseItem {
                            name: js_ast::LocRef { ref_: r, loc: logger::Loc::EMPTY },
                            alias: symbol_name.as_bytes(),
                            alias_loc: logger::Loc::EMPTY,
                            original_name: b"",
                        };
                        declared_symbols.push(DeclaredSymbol { ref_: r, is_top_level: true });
                        clause_i += 1;
                    }
                }

                let import_stmt = p.s(
                    S::Import {
                        namespace_ref: p
                            .declare_symbol(
                                Symbol::Kind::Unbound,
                                logger::Loc::EMPTY,
                                b"bun_test_import_namespace_for_internal_use_only",
                            )
                            .expect("unreachable"),
                        items: clauses,
                        import_record_index: import_record_id,
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                );

                let part_stmts = p.bump.alloc_slice_fill_with(1, |_| import_stmt);
                before.push(js_ast::Part {
                    stmts: part_stmts,
                    declared_symbols,
                    import_record_indices: BabyList::<u32>::from_owned_slice(import_record_indices),
                    tag: js_ast::Part::Tag::BunTest,
                    ..Default::default()
                });
            }

            // If we injected jest globals, we need to disable the runtime transpiler cache
            if let Some(cache) = p.options.features.runtime_transpiler_cache {
                cache.input_hash = None;
            }
        }

        if p.has_called_runtime {
            let mut runtime_imports: [u8; RuntimeImports::ALL.len()] =
                [0; RuntimeImports::ALL.len()];
            let mut iter = p.runtime_imports.iter();
            let mut i: usize = 0;
            while let Some(entry) = iter.next() {
                runtime_imports[i] = u8::try_from(entry.key).unwrap();
                i += 1;
            }

            runtime_imports[0..i].sort_unstable_by(|a, b| {
                RuntimeImports::ALL_SORTED_INDEX[*a as usize]
                    .cmp(&RuntimeImports::ALL_SORTED_INDEX[*b as usize])
            });

            if i > 0 {
                p.generate_import_stmt(
                    RuntimeImports::NAME,
                    &runtime_imports[0..i],
                    &mut before,
                    p.runtime_imports,
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
            let mut buf: [&[u8]; 3] = [b"", b"", b""];
            let runtime_import_names = p.jsx_imports.runtime_import_names(&mut buf);

            if !runtime_import_names.is_empty() {
                p.generate_import_stmt(
                    p.options.jsx.import_source(),
                    runtime_import_names,
                    &mut before,
                    &p.jsx_imports,
                    None,
                    b"",
                    false,
                )
                .expect("unreachable");
            }

            let source_import_names = p.jsx_imports.source_import_names();
            if !source_import_names.is_empty() {
                p.generate_import_stmt(
                    p.options.jsx.package_name,
                    source_import_names,
                    &mut before,
                    &p.jsx_imports,
                    None,
                    b"",
                    false,
                )
                .expect("unreachable");
            }
        }

        if p.server_components_wrap_ref.is_valid() {
            let fw = p
                .options
                .framework
                .unwrap_or_else(|| panic!("server components requires a framework configured, but none was set"));
            let sc = fw.server_components.as_ref().unwrap();
            p.generate_react_refresh_import(
                &mut before,
                sc.server_runtime_import,
                &[js_parser::ReactRefreshImportItem {
                    name: sc.server_register_client_reference,
                    ref_: p.server_components_wrap_ref,
                    enabled: true,
                }],
            )?;
        }

        if p.react_refresh.register_used || p.react_refresh.signature_used {
            p.generate_react_refresh_import(
                &mut before,
                if let Some(fw) = p.options.framework {
                    fw.react_fast_refresh.as_ref().unwrap().import_source
                } else {
                    b"react-refresh/runtime"
                },
                &[
                    js_parser::ReactRefreshImportItem {
                        name: b"register",
                        enabled: p.react_refresh.register_used,
                        ref_: p.react_refresh.register_ref,
                    },
                    js_parser::ReactRefreshImportItem {
                        name: b"createSignatureFunctionForTransform",
                        enabled: p.react_refresh.signature_used,
                        ref_: p.react_refresh.create_signature_ref,
                    },
                ],
            )?;
        }

        // Bake: transform global `Response` to use `import { Response } from 'bun:app'`
        if !p.response_ref.is_null() && {
            // We only want to do this if the symbol is used and didn't get
            // bound to some other value
            let symbol: &Symbol = &p.symbols.as_slice()[p.response_ref.inner_index() as usize];
            !symbol.has_link() && symbol.use_count_estimate > 0
        } {
            p.generate_import_stmt_for_bake_response(&mut before)?;
        }

        if !before.is_empty() || !after.is_empty() {
            let before_len = before.len();
            let after_len = after.len();
            let parts_len = parts.len();
            parts.reserve(before_len + after_len);
            // SAFETY: capacity reserved above; we fully initialize the new range below.
            unsafe { parts.set_len(parts_len + before_len + after_len) };

            if before_len > 0 {
                if parts_len > 0 {
                    // first copy parts to the middle if before exists
                    // PORT NOTE: src/dst overlap → use ptr::copy (memmove semantics)
                    unsafe {
                        // SAFETY: ranges are within `parts`; ptr::copy handles overlap.
                        let base = parts.as_mut_ptr();
                        core::ptr::copy(base, base.add(before_len), parts_len);
                    }
                }
                unsafe {
                    // SAFETY: non-overlapping; `before` is a separate buffer.
                    core::ptr::copy_nonoverlapping(
                        before.as_ptr(),
                        parts.as_mut_ptr(),
                        before_len,
                    );
                }
            }
            if after_len > 0 {
                unsafe {
                    // SAFETY: non-overlapping; `after` is a separate buffer.
                    core::ptr::copy_nonoverlapping(
                        after.as_ptr(),
                        parts.as_mut_ptr().add(parts_len + before_len),
                        after_len,
                    );
                }
            }
        }

        // Pop the module scope to apply the "ContainsDirectEval" rules
        // p.popScope();

        #[cfg(not(target_arch = "wasm32"))]
        if bun_core::FeatureFlags::RUNTIME_TRANSPILER_CACHE {
            let runtime_transpiler_cache: Option<&mut bun_jsc::RuntimeTranspilerCache> =
                p.options.features.runtime_transpiler_cache;
            if let Some(cache) = runtime_transpiler_cache {
                if p.macro_call_count != 0 {
                    // disable this for:
                    // - macros
                    cache.input_hash = None;
                } else {
                    cache.exports_kind = exports_kind;
                }
            }
        }

        Ok(js_ast::Result::Ast(p.to_ast(&mut parts, exports_kind, wrap_mode, hashbang)?))
    }

    pub fn init(
        _options: Options<'a>,
        log: &'a mut logger::Log,
        source: &'a logger::Source,
        define: &'a Define,
        bump: &'a Arena,
    ) -> Result<Parser<'a>, Error> {
        // TODO(port): narrow error set
        Ok(Parser {
            options: _options,
            bump,
            lexer: js_lexer::Lexer::init(log, source, bump)?,
            define,
            source,
            log,
        })
    }

    fn has_bun_pragma(&self, has_hashbang: bool) -> Option<js_ast::result::AlreadyBundled> {
        const BUN_PRAGMA: &[u8] = b"// @bun";
        let contents = self.lexer.source.contents;
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
                js_ast::result::AlreadyBundled::BytecodeCjs
            } else {
                js_ast::result::AlreadyBundled::BunCjs
            })
        } else {
            Some(if state.seen_bytecode {
                js_ast::result::AlreadyBundled::Bytecode
            } else {
                js_ast::result::AlreadyBundled::Bun
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
pub type MacroContext = js_ast::macro_::MacroContext;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Parser.zig (1627 lines)
//   confidence: medium
//   todos:      11
//   notes:      Generic <P> needs ParserImpl trait; Jest field reflection stubbed via Jest::FIELDS; Options::macro_context default is unsound (was `undefined` in Zig).
// ──────────────────────────────────────────────────────────────────────────

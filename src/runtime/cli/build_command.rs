use std::io::Write as _;

use crate::cli::command::{Context, HotReload};
use bun_bundler::bundle_v2::{self, BundleV2};
use bun_bundler::linker_context::metafile_builder as MetafileBuilder;
use bun_bundler::options;
use bun_bundler::transpiler;
use bun_core::env::OperatingSystem;
use bun_core::strings;
use bun_core::{Global, Output, fmt as bun_fmt};
use bun_js_parser::parser::Runtime;
#[allow(unused_imports)]
use bun_options_types::compile_target;
use bun_options_types::context::MacroOptions;
use bun_options_types::schema::api;
use bun_paths::{PathBuffer, resolve_path};
use bun_sys::{self, Fd, FdExt as _};

extern crate bun_standalone_graph as bun_standalone_module_graph;

/// `bun.cli.start_time` accessor — Zig had a mutable global; Rust keeps the
/// single backing `OnceLock` in `bun_core` (written once in `Cli::start`).
#[inline]
fn cli_start_time() -> i128 {
    crate::cli::start_time()
}

/// Local shim for `writer.splatByteAll(b, n)` — `bun_core::io::Writer` has no
/// such method yet; loop on `write_all`.
#[inline]
fn splat_byte_all(
    writer: &mut bun_core::io::Writer,
    byte: u8,
    count: usize,
) -> Result<(), bun_core::Error> {
    let buf = [byte; 64];
    let mut remaining = count;
    while remaining > 0 {
        let n = remaining.min(buf.len());
        writer.write_all(&buf[..n])?;
        remaining -= n;
    }
    Ok(())
}

pub struct BuildCommand;

impl BuildCommand {
    /// `bun build` subcommand entry point.
    ///
    /// Marked `#[cold]` + `#[inline(never)]` so the linker keeps this large
    /// body out of the hot run of `.text` that the cold-start arg-parse /
    /// dispatch working set lives in. `bun .` (the default `run` command)
    /// never reaches here, so paging this in on startup is pure waste; this
    /// finishes what `perf(clap): mark cold-command param tables cold` started
    /// (those moved the tables, not the bodies).
    #[cold]
    #[inline(never)]
    pub fn exec(
        ctx: Context,
        fetcher: Option<&mut bundle_v2::DependenciesScanner>,
    ) -> Result<(), bun_core::Error> {
        Global::configure_allocator(Global::AllocatorConfiguration {
            long_running: true,
            ..Default::default()
        });
        // PERF(port): allocator param dropped — global mimalloc
        let log = ctx.log;
        // SAFETY: `ctx.log` is a long-lived `*mut Log` set up during CLI init
        // and never freed for the duration of the command body.
        let log_ref: &mut bun_ast::Log = unsafe { &mut *log };
        let user_requested_browser_target =
            ctx.args.target.is_some() && ctx.args.target.unwrap() == api::Target::Browser;
        if ctx.bundler_options.compile || ctx.bundler_options.bytecode {
            // set this early so that externals are set up correctly and define is right
            ctx.args.target = Some(api::Target::Bun);
        }

        if ctx.bundler_options.bake {
            return crate::bake::production::build_command(ctx);
        }

        if fetcher.is_some() {
            ctx.args.packages = Some(api::PackagesMode::External);
            ctx.bundler_options.compile = false;
        }

        let compile_target = &ctx.bundler_options.compile_target;

        if ctx.bundler_options.compile {
            let compile_define_keys = compile_target.define_keys();
            let compile_define_values = compile_target.define_values();

            if let Some(define) = ctx.args.define.as_mut() {
                let mut keys: Vec<Box<[u8]>> =
                    Vec::with_capacity(compile_define_keys.len() + define.keys.len());
                keys.extend(compile_define_keys.iter().map(|s| Box::<[u8]>::from(*s)));
                keys.extend(define.keys.drain(..));
                // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                let mut values: Vec<Box<[u8]>> =
                    Vec::with_capacity(compile_define_values.len() + define.values.len());
                values.extend(compile_define_values.iter().map(|s| Box::<[u8]>::from(*s)));
                values.extend(define.values.drain(..));

                define.keys = keys;
                define.values = values;
            } else {
                ctx.args.define = Some(api::StringMap {
                    keys: compile_define_keys
                        .iter()
                        .map(|s| Box::<[u8]>::from(*s))
                        .collect(),
                    values: compile_define_values
                        .iter()
                        .map(|s| Box::<[u8]>::from(*s))
                        .collect(),
                });
            }
        }

        // PORT NOTE: `Transpiler::init` now takes an arena. Process-lifetime —
        // `exec` never returns until process exit (`exit_or_watch` diverges),
        // so use the shared CLI arena instead of allocating a fresh one.
        let arena: &'static bun_alloc::Arena = crate::cli::cli_arena();
        // PORT NOTE: `generate_from_cli` takes `&'a mut Transpiler<'a>`, which
        // borrows the transpiler for its full lifetime — dropck then rejects a
        // stack local because the borrow would still be live in its destructor.
        // Allocate in the process-lifetime arena (same rationale as `arena`;
        // `exec` diverges so this is never dropped).
        let this_transpiler: &mut transpiler::Transpiler<'static> = arena.alloc(
            transpiler::Transpiler::init(arena, log, ctx.args.clone(), None)?,
        );
        if let Some(fetch) = fetcher.as_deref() {
            this_transpiler.options.entry_points = fetch.entry_points.clone();
            // resolver.opts is a distinct subset type; entry_points / IMRE live
            // only on the bundler-side options struct (resolver never reads them).
            this_transpiler.options.ignore_module_resolution_errors = true;
        }

        // PORT NOTE: clone the first entry point so `outfile` can borrow owned
        // storage instead of `this_transpiler.options.entry_points[0]`, which
        // would otherwise hold an immutable borrow of `this_transpiler` across
        // later `&mut self` calls (`configure_defines`, `generate_from_cli`).
        let first_entry_point: Box<[u8]> = this_transpiler
            .options
            .entry_points
            .first()
            .cloned()
            .unwrap_or_default();

        this_transpiler.options.source_map =
            options::SourceMapOption::from_api(ctx.args.source_map);

        this_transpiler.options.compile = ctx.bundler_options.compile;

        if this_transpiler.options.source_map == options::SourceMapOption::External
            && ctx.bundler_options.outdir.is_empty()
            && !ctx.bundler_options.compile
        {
            Output::pretty_errorln(
                "<r><red>error<r><d>:<r> cannot use an external source map without --outdir",
            );
            Global::exit(1);
        }

        let mut outfile: &[u8] = &ctx.bundler_options.outfile;
        let output_to_stdout = !ctx.bundler_options.compile
            && outfile.is_empty()
            && ctx.bundler_options.outdir.is_empty();

        this_transpiler.options.supports_multiple_outputs =
            !(output_to_stdout || !outfile.is_empty());

        this_transpiler.options.public_path = ctx.bundler_options.public_path.clone();
        this_transpiler.options.entry_naming = ctx.bundler_options.entry_naming.clone();
        this_transpiler.options.chunk_naming = ctx.bundler_options.chunk_naming.clone();
        this_transpiler.options.asset_naming = ctx.bundler_options.asset_naming.clone();
        this_transpiler.options.server_components = ctx.bundler_options.server_components;
        this_transpiler.options.react_fast_refresh = ctx.bundler_options.react_fast_refresh;
        this_transpiler.options.inline_entrypoint_import_meta_main =
            ctx.bundler_options.inline_entrypoint_import_meta_main;
        this_transpiler.options.code_splitting = ctx.bundler_options.code_splitting;
        this_transpiler.options.minify_syntax = ctx.bundler_options.minify_syntax;
        this_transpiler.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        this_transpiler.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        this_transpiler.options.keep_names = ctx.bundler_options.keep_names;
        this_transpiler.options.emit_dce_annotations = ctx.bundler_options.emit_dce_annotations;
        this_transpiler.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;

        this_transpiler.options.banner =
            std::borrow::Cow::Owned(ctx.bundler_options.banner.clone().into_vec());
        this_transpiler.options.footer =
            std::borrow::Cow::Owned(ctx.bundler_options.footer.clone().into_vec());
        this_transpiler.options.drop = ctx.args.drop.clone().into();
        {
            let flags: Vec<&[u8]> = ctx.args.feature_flags.iter().map(|s| &**s).collect();
            this_transpiler.options.bundler_feature_flags =
                Runtime::Features::init_bundler_feature_flags(&flags);
        }

        this_transpiler.options.allow_unresolved =
            if let Some(a) = ctx.bundler_options.allow_unresolved.as_ref() {
                options::AllowUnresolved::from_strings(a.clone().into_boxed_slice(), |p, s| {
                    bun_glob::r#match(p, s).matches()
                })
            } else {
                options::AllowUnresolved::All
            };
        this_transpiler.options.css_chunking = ctx.bundler_options.css_chunking;
        this_transpiler.options.metafile =
            !ctx.bundler_options.metafile.is_empty() || !ctx.bundler_options.metafile_md.is_empty();

        this_transpiler.options.output_dir = ctx.bundler_options.outdir.clone();
        this_transpiler.options.output_format = ctx.bundler_options.output_format;

        if ctx.bundler_options.output_format == options::OutputFormat::InternalBakeDev {
            this_transpiler.options.tree_shaking = false;
        }

        this_transpiler.options.bytecode = ctx.bundler_options.bytecode;
        let mut was_renamed_from_index = false;

        if ctx.bundler_options.compile {
            if ctx.bundler_options.transform_only {
                Output::pretty_errorln(
                    "<r><red>error<r><d>:<r> --compile does not support --no-bundle",
                );
                Global::exit(1);
            }

            // Check if all entrypoints are HTML files for standalone HTML mode
            let has_all_html_entrypoints = 'brk: {
                if this_transpiler.options.entry_points.is_empty() {
                    break 'brk false;
                }
                for entry_point in this_transpiler.options.entry_points.iter() {
                    if !strings::has_suffix_comptime(entry_point, b".html") {
                        break 'brk false;
                    }
                }
                true
            };

            if user_requested_browser_target && has_all_html_entrypoints {
                // --compile --target=browser with all HTML entrypoints: produce self-contained HTML
                ctx.args.target = Some(api::Target::Browser);
                if ctx.bundler_options.code_splitting {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> cannot use --compile --target browser with --splitting",
                    );
                    Global::exit(1);
                }

                this_transpiler.options.compile_to_standalone_html = true;
                // This is not a bun executable compile - clear compile flags
                this_transpiler.options.compile = false;
                ctx.bundler_options.compile = false;

                if ctx.bundler_options.outdir.is_empty() && outfile.is_empty() {
                    outfile = bun_paths::basename(&first_entry_point);
                }

                this_transpiler.options.supports_multiple_outputs =
                    !ctx.bundler_options.outdir.is_empty();
            } else {
                // Standard --compile: produce standalone bun executable
                if !ctx.bundler_options.outdir.is_empty() {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> cannot use --compile with --outdir",
                    );
                    Global::exit(1);
                }

                let base_public_path =
                    bun_standalone_module_graph::StandaloneModuleGraph::target_base_public_path(
                        compile_target.os,
                        b"root/",
                    );

                this_transpiler.options.public_path = base_public_path.into();

                if outfile.is_empty() {
                    outfile = bun_paths::basename(&first_entry_point);
                    let ext = bun_paths::extension(outfile);
                    if !ext.is_empty() {
                        outfile = &outfile[0..outfile.len() - ext.len()];
                    }

                    if outfile == b"index" {
                        outfile = bun_paths::basename(
                            bun_core::dirname(&first_entry_point).unwrap_or(b"index"),
                        );
                        was_renamed_from_index = outfile != b"index";
                    }

                    if outfile == b"bun" {
                        outfile = bun_paths::basename(
                            bun_core::dirname(&first_entry_point).unwrap_or(b"bun"),
                        );
                    }
                }

                // If argv[0] is "bun" or "bunx", we don't check if the binary is standalone
                if outfile == b"bun" || outfile == b"bunx" {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> cannot use --compile with an output file named 'bun' because bun won't realize it's a standalone executable. Please choose a different name for --outfile",
                    );
                    Global::exit(1);
                }
            }
        }

        if ctx.bundler_options.transform_only {
            // Check if any entry point is an HTML file
            for entry_point in this_transpiler.options.entry_points.iter() {
                if strings::has_suffix_comptime(entry_point, b".html") {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> HTML imports are only supported when bundling",
                    );
                    Global::exit(1);
                }
            }
        }

        if ctx.bundler_options.outdir.is_empty()
            && !ctx.bundler_options.compile
            && fetcher.is_none()
        {
            if this_transpiler.options.entry_points.len() > 1 {
                Output::pretty_errorln(
                    "<r><red>error<r><d>:<r> Must use <b>--outdir<r> when specifying more than one entry point.",
                );
                Global::exit(1);
            }
            if this_transpiler.options.code_splitting {
                Output::pretty_errorln(
                    "<r><red>error<r><d>:<r> Must use <b>--outdir<r> when code splitting is enabled",
                );
                Global::exit(1);
            }
        }

        let mut src_root_dir_buf = PathBuffer::uninit();
        let src_root_dir: &[u8] = 'brk1: {
            let path: &[u8] = 'brk2: {
                if !ctx.bundler_options.root_dir.is_empty() {
                    break 'brk2 &ctx.bundler_options.root_dir;
                }

                if this_transpiler.options.entry_points.len() == 1 {
                    break 'brk2 bun_core::dirname(&this_transpiler.options.entry_points[0])
                        .unwrap_or(b".");
                }

                let entries: Vec<&[u8]> = this_transpiler
                    .options
                    .entry_points
                    .iter()
                    .map(|s| &**s)
                    .collect();
                resolve_path::get_if_exists_longest_common_path(&entries).unwrap_or(b".")
            };

            // TODO(port): std.posix.toPosixPath — NUL-terminate path into a stack buffer
            let dir = match bun_sys::open_dir_at(Fd::cwd(), path) {
                Ok(d) => d,
                Err(err) => {
                    Output::pretty_errorln(format_args!(
                        "<r><red>{}<r> opening root directory {}",
                        bstr::BStr::new(err.name()),
                        bun_fmt::quote(path),
                    ));
                    Global::exit(1);
                }
            };
            // TODO(port): defer dir.close() — using explicit close after use; consider RAII guard in Phase B

            let result = match bun_sys::get_fd_path(dir, &mut src_root_dir_buf) {
                Ok(p) => p,
                Err(err) => {
                    Output::pretty_errorln(format_args!(
                        "<r><red>{}<r> resolving root directory {}",
                        bstr::BStr::new(err.name()),
                        bun_fmt::quote(path),
                    ));
                    Global::exit(1);
                }
            };
            dir.close();
            break 'brk1 &*result;
        };

        this_transpiler.options.root_dir = src_root_dir.into();
        this_transpiler.options.code_splitting = ctx.bundler_options.code_splitting;
        this_transpiler.options.transform_only = ctx.bundler_options.transform_only;

        this_transpiler.options.env.behavior = ctx.bundler_options.env_behavior;
        this_transpiler.options.env.prefix = ctx.bundler_options.env_prefix.clone();

        if ctx.bundler_options.production {
            // SAFETY: `env` is a process-lifetime singleton set in `Transpiler::init`.
            unsafe { (*this_transpiler.env).map.put(b"NODE_ENV", b"production")? };
        }

        this_transpiler.configure_defines()?;
        this_transpiler.configure_linker();

        if !this_transpiler.options.production {
            this_transpiler
                .options
                .conditions
                .append_slice(&[b"development" as &[u8]])?;
        }

        // PORT NOTE: `resolver.opts` is the canonical
        // `bun_resolver::options::BundleOptions` subset, distinct from the
        // bundler-side `BundleOptions<'a>`; re-project the mutated options.
        this_transpiler.sync_resolver_opts();
        this_transpiler.resolver.env_loader = core::ptr::NonNull::new(this_transpiler.env);

        // Allow tsconfig.json overriding, but always set it to false if --production is passed.
        if ctx.bundler_options.production {
            this_transpiler.options.jsx.development = false;
            this_transpiler.resolver.opts.jsx.development = false;
        }

        match &ctx.debug.macros {
            MacroOptions::Disable => {
                this_transpiler.options.no_macros = true;
            }
            MacroOptions::Map(macros) => {
                // PORT NOTE: `MacroOptions::Map` carries the
                // `bun_options_types::context::MacroMap` redeclaration; the
                // bundler-side `options.macro_remap` is the resolver crate's
                // `StringArrayHashMap` shape. Re-key into that shape here.
                use bun_resolver::package_json::{
                    MacroImportReplacementMap as ResolverInner, MacroMap as ResolverMacroMap,
                };
                let mut remap = ResolverMacroMap::default();
                for (pkg, imports) in macros.iter() {
                    let mut inner = ResolverInner::default();
                    for (name, path) in imports.iter() {
                        inner.insert(name, Box::<[u8]>::from(path.as_ref()));
                    }
                    remap.insert(pkg, inner);
                }
                this_transpiler.options.macro_remap = remap;
            }
            MacroOptions::Unspecified => {}
        }

        // TODO(port): client_transpiler is left uninitialized in Zig until needed; using Option here
        let mut client_transpiler: Option<transpiler::Transpiler> = None;
        if this_transpiler.options.server_components {
            let mut ct = transpiler::Transpiler::init(arena, log, ctx.args.clone(), None)?;
            // PORT NOTE: Zig assigned `client_transpiler.options = this_transpiler.options`
            // (struct copy). `BundleOptions<'a>` is non-`Clone` in Rust; instead
            // `Transpiler::init` above rebuilds options from the same `ctx.args`,
            // and the divergent fields are set explicitly below. `client_transpiler`
            // is currently unused after this block (matching the Zig), so a
            // perfect field-wise copy is not load-bearing.
            ct.options.target = bun_ast::Target::Browser;
            ct.options.server_components = true;
            ct.options.conditions = this_transpiler.options.conditions.clone()?;
            // TODO(port): narrow error set
            this_transpiler
                .options
                .conditions
                .append_slice(&[b"react-server" as &[u8]])?;
            this_transpiler.options.react_fast_refresh = false;
            this_transpiler.options.minify_syntax = true;
            ct.options.minify_syntax = true;
            {
                use bun_bundler::DefineExt as _;
                ct.options.define = options::Define::init(
                    None, // TODO(port): user_defines from ctx.args.define — RawDefines builder pending
                    None,
                    this_transpiler.options.define.drop_debugger,
                    this_transpiler.options.dead_code_elimination
                        && this_transpiler.options.minify_syntax,
                )?;
            }

            crate::bake::bake_body::add_import_meta_defines(
                &mut this_transpiler.options.define,
                crate::bake::Mode::Development,
                crate::bake::Side::Server,
            )?;
            crate::bake::bake_body::add_import_meta_defines(
                &mut ct.options.define,
                crate::bake::Mode::Development,
                crate::bake::Side::Client,
            )?;

            this_transpiler.sync_resolver_opts();
            this_transpiler.resolver.env_loader = core::ptr::NonNull::new(this_transpiler.env);
            ct.sync_resolver_opts();
            ct.resolver.env_loader = core::ptr::NonNull::new(ct.env);
            client_transpiler = Some(ct);
        }
        let _ = client_transpiler;

        // var env_loader = this_transpiler.env;

        if ctx.debug.dump_environment_variables {
            this_transpiler.dump_environment_variables();
            return Ok(());
        }

        let mut reachable_file_count: usize = 0;
        let mut minify_duration: u64 = 0;
        let mut input_code_length: u64 = 0;

        // PORT NOTE: `BundleV2::generate_from_cli` takes `&'a mut Transpiler<'a>`,
        // which (with `'a = 'static` from the leaked arena) borrows
        // `this_transpiler` for the rest of its life. Snapshot every options
        // field read after that point so the borrow checker is satisfied.
        let opt_output_dir: Box<[u8]> = this_transpiler.options.output_dir.clone();
        let opt_minify_identifiers = this_transpiler.options.minify_identifiers;
        let opt_minify_whitespace = this_transpiler.options.minify_whitespace;
        let opt_minify_syntax = this_transpiler.options.minify_syntax;
        let opt_public_path: Box<[u8]> = this_transpiler.options.public_path.clone();
        let opt_output_format = this_transpiler.options.output_format;
        let opt_source_map = this_transpiler.options.source_map;
        let opt_transform_only = this_transpiler.options.transform_only;
        let env_ptr = this_transpiler.env;

        let mut output_files: Vec<options::OutputFile> = 'brk: {
            if ctx.bundler_options.transform_only {
                this_transpiler.options.import_path_format = options::ImportPathFormat::Relative;
                this_transpiler.options.allow_runtime = false;
                this_transpiler.resolver.opts.allow_runtime = false;

                // TODO: refactor this .transform function
                let result = this_transpiler.transform(ctx.log, ctx.args.clone())?;

                if log_ref.has_errors() {
                    log_ref.print(std::ptr::from_mut::<bun_core::io::Writer>(
                        Output::error_writer(),
                    ))?;

                    if !result.errors.is_empty() || result.output_files.is_empty() {
                        Output::flush();
                        exit_or_watch(1, ctx.debug.hot_reload == HotReload::Watch);
                    }
                }

                break 'brk result.output_files.into_vec();
            }

            if ctx.bundler_options.outdir.is_empty()
                && !outfile.is_empty()
                && !ctx.bundler_options.compile
            {
                let mut entry_naming = Vec::<u8>::new();
                write!(
                    &mut entry_naming,
                    "./{}",
                    bstr::BStr::new(bun_paths::basename(outfile))
                )
                .expect("unreachable");
                this_transpiler.options.entry_naming = entry_naming.into_boxed_slice();
                if let Some(dir) = bun_core::dirname(outfile) {
                    ctx.bundler_options.outdir = dir.into();
                }
                // resolver.opts.entry_naming — field does not exist on the
                // resolver subset; bundler-side `entry_naming` is sufficient.
            }

            // Zig: `bun.jsc.AnyEventLoop.init(ctx.allocator)` — a Mini event loop
            // owned by the arena. `generate_from_cli` → `wait_for_parse` derefs
            // this via `r#loop()` to drain parse tasks; passing `None` panics.
            let event_loop = arena.alloc(bun_event_loop::AnyEventLoop::init());

            let build_result = match BundleV2::generate_from_cli(
                this_transpiler,
                arena,
                Some(core::ptr::NonNull::from(event_loop)),
                ctx.debug.hot_reload == HotReload::Watch,
                &mut reachable_file_count,
                &mut minify_duration,
                &mut input_code_length,
                fetcher.as_deref(),
            ) {
                Ok(r) => r,
                Err(err) => {
                    if !log_ref.msgs.is_empty() {
                        log_ref.print(std::ptr::from_mut::<bun_core::io::Writer>(
                            Output::error_writer(),
                        ))?;
                    } else {
                        write!(Output::error_writer(), "error: {}", err.name())?;
                    }

                    Output::flush();
                    exit_or_watch(1, ctx.debug.hot_reload == HotReload::Watch);
                }
            };

            // Write metafile if requested
            if let Some(metafile_json) = build_result.metafile.as_deref() {
                if !ctx.bundler_options.metafile.is_empty() {
                    // Use makeOpen which auto-creates parent directories on failure
                    let file = match bun_sys::File::make_open(
                        &ctx.bundler_options.metafile,
                        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                        0o664,
                    ) {
                        Ok(f) => f,
                        Err(err) => {
                            Output::err(
                                err,
                                "could not open metafile {}",
                                (bun_fmt::quote(&ctx.bundler_options.metafile),),
                            );
                            exit_or_watch(1, ctx.debug.hot_reload == HotReload::Watch);
                        }
                    };

                    match file.write_all(metafile_json) {
                        Ok(()) => {}
                        Err(err) => {
                            Output::err(
                                err,
                                "could not write metafile {}",
                                (bun_fmt::quote(&ctx.bundler_options.metafile),),
                            );
                            exit_or_watch(1, ctx.debug.hot_reload == HotReload::Watch);
                        }
                    }
                    drop(file);
                }

                // Write markdown metafile if requested
                if !ctx.bundler_options.metafile_md.is_empty() {
                    let metafile_md = match MetafileBuilder::generate_markdown(metafile_json) {
                        Ok(md) => Some(md),
                        Err(err) => {
                            Output::warn(format_args!(
                                "Failed to generate markdown metafile: {}",
                                err.name(),
                            ));
                            None
                        }
                    };
                    if let Some(md_content) = metafile_md {
                        let file = match bun_sys::File::make_open(
                            &ctx.bundler_options.metafile_md,
                            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                            0o664,
                        ) {
                            Ok(f) => f,
                            Err(err) => {
                                Output::err(
                                    err,
                                    "could not open metafile-md {}",
                                    (bun_fmt::quote(&ctx.bundler_options.metafile_md),),
                                );
                                exit_or_watch(1, ctx.debug.hot_reload == HotReload::Watch);
                            }
                        };

                        match file.write_all(&md_content) {
                            Ok(()) => {}
                            Err(err) => {
                                Output::err(
                                    err,
                                    "could not write metafile-md {}",
                                    (bun_fmt::quote(&ctx.bundler_options.metafile_md),),
                                );
                                exit_or_watch(1, ctx.debug.hot_reload == HotReload::Watch);
                            }
                        }
                        drop(file);
                        // md_content dropped at scope exit
                    }
                }
            }

            break 'brk build_result.output_files;
        };
        let output_files: &mut [options::OutputFile] = &mut output_files;
        let bundled_end = bun_core::time::nano_timestamp();

        let mut had_err = false;
        'dump: {
            // Output::flush() runs at end of this block (defer in Zig); see explicit calls below
            let writer = Output::writer_buffered();
            let mut output_dir: &[u8] = &opt_output_dir;

            let will_be_one_file =
                // --outdir is not supported with --compile
                // but you can still use --outfile
                // in which case, we should set the output dir to the dirname of the outfile
                // https://github.com/oven-sh/bun/issues/8697
                ctx.bundler_options.compile
                    || (output_files.len() == 1
                        && matches!(output_files[0].value, options::OutputFileValue::Buffer { .. }));

            if output_dir.is_empty() && !outfile.is_empty() && will_be_one_file {
                output_dir = bun_core::dirname(outfile).unwrap_or(b".");
                if ctx.bundler_options.compile {
                    // If the first output file happens to be a client-side chunk imported server-side
                    // then don't rename it to something else, since an HTML
                    // import manifest might depend on the file path being the
                    // one we think it should be.
                    for f in output_files.iter_mut() {
                        if f.output_kind == options::OutputKind::EntryPoint
                            && f.side.unwrap_or(options::Side::Server) == options::Side::Server
                        {
                            f.dest_path = bun_paths::basename(outfile).into();
                            break;
                        }
                    }
                } else {
                    output_files[0].dest_path = bun_paths::basename(outfile).into();
                }
            }

            if !ctx.bundler_options.compile {
                if outfile.is_empty()
                    && output_files.len() == 1
                    && ctx.bundler_options.outdir.is_empty()
                {
                    // if --no-bundle is passed, it won't have an output dir
                    if let options::OutputFileValue::Buffer { bytes } = &output_files[0].value {
                        writer.write_all(bytes)?;
                    }
                    Output::flush();
                    break 'dump;
                }
            }

            let mut root_path: &[u8] = output_dir;
            if root_path.is_empty() && ctx.args.entry_points.len() == 1 {
                root_path = bun_core::dirname(&ctx.args.entry_points[0]).unwrap_or(b".");
            }

            let root_dir = if root_path.is_empty() || root_path == b"." {
                bun_sys::Dir::cwd()
            } else {
                match bun_sys::Dir::cwd().make_open_path(root_path, Default::default()) {
                    Ok(d) => d,
                    Err(err) => {
                        Output::err(
                            err,
                            "could not open output directory {}",
                            (bun_fmt::quote(root_path),),
                        );
                        exit_or_watch(1, ctx.debug.hot_reload == HotReload::Watch);
                    }
                }
            };

            let mut all_paths: Vec<&[u8]> = vec![&[] as &[u8]; output_files.len()];
            let mut max_path_len: usize = 0;
            for (dest, src) in all_paths.iter_mut().zip(output_files.iter()) {
                *dest = &src.dest_path;
            }
            debug_assert_eq!(all_paths.len(), output_files.len());

            let from_path = resolve_path::longest_common_path(&all_paths);

            let mut size_padding: usize = 0;

            for f in output_files.iter() {
                max_path_len =
                    max_path_len.max(from_path.len().max(f.dest_path.len()) + 2 - from_path.len());
                size_padding = size_padding.max(bun_fmt::count(format_args!(
                    "{}",
                    bun_fmt::size(f.size, Default::default())
                )));
            }

            if ctx.bundler_options.compile {
                print_summary(
                    bundled_end,
                    minify_duration,
                    opt_minify_identifiers || opt_minify_whitespace || opt_minify_syntax,
                    input_code_length as usize,
                    reachable_file_count,
                    output_files,
                );

                Output::flush();

                let is_cross_compile = !compile_target.is_default();

                if outfile.is_empty() || outfile == b"." || outfile == b".." || outfile == b"../" {
                    outfile = b"index";
                }

                // TODO(port): outfile may need owned storage when reassigned to allocated buffer below
                #[allow(unused_assignments)]
                let mut outfile_owned: Vec<u8>;
                if compile_target.os == OperatingSystem::Windows
                    && !strings::has_suffix_comptime(outfile, b".exe")
                {
                    outfile_owned = Vec::new();
                    write!(&mut outfile_owned, "{}.exe", bstr::BStr::new(outfile))
                        .expect("unreachable");
                    outfile = &outfile_owned;
                } else if was_renamed_from_index && outfile != b"index" {
                    // If we're going to fail due to EISDIR, we should instead pick a different name.
                    let mut zbuf = PathBuffer::uninit();
                    let n = outfile.len().min(zbuf.0.len() - 1);
                    zbuf.0[..n].copy_from_slice(&outfile[..n]);
                    zbuf.0[n] = 0;
                    // SAFETY: NUL-terminated above.
                    let z = bun_core::ZStr::from_buf(&zbuf.0[..], n);
                    if bun_sys::directory_exists_at(root_dir.fd, z).unwrap_or(false) {
                        outfile = b"index";
                    }
                }

                let result = match bun_standalone_module_graph::StandaloneModuleGraph::to_executable(
                    compile_target,
                    output_files,
                    root_dir.fd,
                    &opt_public_path,
                    outfile,
                    // SAFETY: `env` is a process-lifetime singleton.
                    unsafe { &mut *env_ptr },
                    opt_output_format,
                    std::mem::take(&mut ctx.bundler_options.windows),
                    ctx.bundler_options
                        .compile_exec_argv
                        .as_deref()
                        .unwrap_or(b""),
                    ctx.bundler_options.compile_executable_path.as_deref(),
                    {
                        use bun_standalone_module_graph::StandaloneModuleGraph::Flags;
                        let mut flags = Flags::default();
                        if !ctx.bundler_options.compile_autoload_dotenv {
                            flags |= Flags::DISABLE_DEFAULT_ENV_FILES;
                        }
                        if !ctx.bundler_options.compile_autoload_bunfig {
                            flags |= Flags::DISABLE_AUTOLOAD_BUNFIG;
                        }
                        if !ctx.bundler_options.compile_autoload_tsconfig {
                            flags |= Flags::DISABLE_AUTOLOAD_TSCONFIG;
                        }
                        if !ctx.bundler_options.compile_autoload_package_json {
                            flags |= Flags::DISABLE_AUTOLOAD_PACKAGE_JSON;
                        }
                        flags
                    },
                ) {
                    Ok(r) => r,
                    Err(err) => {
                        Output::print_errorln(format_args!(
                            "failed to create executable: {}",
                            err.name()
                        ));
                        Global::exit(1);
                    }
                };

                if let bun_standalone_module_graph::StandaloneModuleGraph::CompileResult::Err(err) =
                    &result
                {
                    Output::print_errorln(format_args!("{}", bstr::BStr::new(err.slice())));
                    Global::exit(1);
                }

                // Write external sourcemap files next to the compiled executable.
                // With --splitting, there can be multiple .map files (one per chunk).
                if opt_source_map == options::SourceMapOption::External {
                    for f in output_files.iter() {
                        if f.output_kind == options::OutputKind::Sourcemap
                            && matches!(f.value, options::OutputFileValue::Buffer { .. })
                        {
                            let options::OutputFileValue::Buffer { bytes } = &f.value else {
                                continue;
                            };
                            let sourcemap_bytes: &[u8] = bytes;
                            if sourcemap_bytes.is_empty() {
                                continue;
                            }

                            // Use the sourcemap's own dest_path basename if available,
                            // otherwise fall back to {outfile}.map
                            #[allow(unused_assignments)]
                            let mut map_basename_owned: Vec<u8>;
                            let map_basename: &[u8] = if !f.dest_path.is_empty() {
                                bun_paths::basename(&f.dest_path)
                            } else {
                                let exe_base = bun_paths::basename(outfile);
                                map_basename_owned = Vec::new();
                                if compile_target.os == OperatingSystem::Windows
                                    && !strings::has_suffix_comptime(exe_base, b".exe")
                                {
                                    write!(
                                        &mut map_basename_owned,
                                        "{}.exe.map",
                                        bstr::BStr::new(exe_base)
                                    )
                                    .expect("unreachable");
                                } else {
                                    write!(
                                        &mut map_basename_owned,
                                        "{}.map",
                                        bstr::BStr::new(exe_base)
                                    )
                                    .expect("unreachable");
                                }
                                &map_basename_owned
                            };

                            // root_dir already points to the outfile's parent directory,
                            // so use map_basename (not a path with directory components)
                            // to avoid writing to a doubled directory path.
                            let mut pathbuf = PathBuffer::uninit();
                            match bun_sys::write_file_with_path_buffer(
                                &mut pathbuf,
                                bun_sys::WriteFileArgs {
                                    data: bun_sys::WriteFileData::Buffer {
                                        buffer: sourcemap_bytes,
                                    },
                                    encoding: bun_sys::WriteFileEncoding::Buffer,
                                    dirfd: root_dir.fd,
                                    file: bun_sys::PathOrFileDescriptor::Path(
                                        bun_core::PathString::init(map_basename),
                                    ),
                                    ..Default::default()
                                },
                            ) {
                                Err(err) => {
                                    Output::err(
                                        err,
                                        "failed to write sourcemap file '{}'",
                                        (bstr::BStr::new(map_basename),),
                                    );
                                    had_err = true;
                                }
                                Ok(_) => {}
                            }
                        }
                    }
                }

                let compiled_elapsed = ((bun_core::time::nano_timestamp() - bundled_end) as i64)
                    / (bun_core::time::NS_PER_MS as i64);
                let compiled_elapsed_digit_count =
                    4usize.saturating_sub(bun_fmt::digit_count(compiled_elapsed.max(0)));
                let padding_buf = [b' '; 16];
                let padding_ = &padding_buf[0..compiled_elapsed_digit_count];
                Output::pretty(format_args!("{}", bstr::BStr::new(padding_)));

                Output::print_elapsed_stdout_trim(compiled_elapsed as f64);

                Output::pretty(format_args!(
                    " <green>compile<r>  <b><blue>{}{}<r>",
                    bstr::BStr::new(outfile),
                    if compile_target.os == OperatingSystem::Windows
                        && !strings::has_suffix_comptime(outfile, b".exe")
                    {
                        ".exe"
                    } else {
                        ""
                    }
                ));

                if is_cross_compile {
                    Output::pretty(format_args!(" <r><d>{}<r>\n", compile_target));
                } else {
                    Output::pretty(format_args!("\n"));
                }

                Output::flush();
                break 'dump;
            }

            if log_ref.errors == 0 {
                if opt_transform_only {
                    Output::prettyln(format_args!(
                        "<green>Transpiled file in {}ms<r>",
                        (bun_core::time::nano_timestamp() - cli_start_time())
                            / (bun_core::time::NS_PER_MS as i128)
                    ));
                } else {
                    Output::prettyln(format_args!(
                        "<green>Bundled {} module{} in {}ms<r>",
                        reachable_file_count,
                        if reachable_file_count == 1 { "" } else { "s" },
                        (bun_core::time::nano_timestamp() - cli_start_time())
                            / (bun_core::time::NS_PER_MS as i128)
                    ));
                }
                Output::prettyln(format_args!("\n"));
                Output::flush();
            }

            for f in output_files.iter() {
                size_padding = size_padding.max(bun_fmt::count(format_args!(
                    "{}",
                    bun_fmt::size(f.size, Default::default())
                )));
            }

            for f in output_files.iter() {
                if let Err(err) = f.write_to_disk(root_dir.fd, from_path) {
                    Output::err(
                        err,
                        "failed to write file '{}'",
                        (bun_fmt::quote(&f.dest_path),),
                    );
                    had_err = true;
                    continue;
                }

                debug_assert!(!bun_paths::is_absolute(&f.dest_path));

                let rel_path = strings::trim_prefix(&f.dest_path, b"./");

                // Print summary
                let padding_count = 2usize.max(rel_path.len().max(max_path_len) - rel_path.len());
                splat_byte_all(writer, b' ', 2)?;

                if Output::enable_ansi_colors_stdout() {
                    writer.write_all(&Output::pretty_fmt::<true>(match f.output_kind {
                        options::OutputKind::EntryPoint => "<blue>",
                        options::OutputKind::Chunk => "<cyan>",
                        options::OutputKind::Asset => "<magenta>",
                        options::OutputKind::Sourcemap => "<d>",
                        options::OutputKind::Bytecode => "<d>",
                        options::OutputKind::ModuleInfo => "<d>",
                        options::OutputKind::MetafileJson
                        | options::OutputKind::MetafileMarkdown => "<green>",
                    }))?;
                }

                writer.write_all(rel_path)?;
                if Output::enable_ansi_colors_stdout() {
                    // highlight big files
                    let warn_threshold: usize = match f.output_kind {
                        options::OutputKind::EntryPoint | options::OutputKind::Chunk => 128 * 1024,
                        options::OutputKind::Asset => 16 * 1024 * 1024,
                        _ => usize::MAX,
                    };
                    if f.size > warn_threshold {
                        writer.write_all(&Output::pretty_fmt::<true>("<yellow>"))?;
                    } else {
                        writer.write_all(b"\x1b[0m")?;
                    }
                }

                splat_byte_all(writer, b' ', padding_count)?;
                write!(writer, "{}  ", bun_fmt::size(f.size, Default::default()))?;
                splat_byte_all(
                    writer,
                    b' ',
                    size_padding
                        - bun_fmt::count(format_args!(
                            "{}",
                            bun_fmt::size(f.size, Default::default())
                        )),
                )?;

                if Output::enable_ansi_colors_stdout() {
                    writer.write_all(b"\x1b[2m")?;
                }
                write!(
                    writer,
                    "({})",
                    match f.output_kind {
                        options::OutputKind::EntryPoint => "entry point",
                        options::OutputKind::Chunk => "chunk",
                        options::OutputKind::Asset => "asset",
                        options::OutputKind::Sourcemap => "source map",
                        options::OutputKind::Bytecode => "bytecode",
                        options::OutputKind::ModuleInfo => "module info",
                        options::OutputKind::MetafileJson => "metafile json",
                        options::OutputKind::MetafileMarkdown => "metafile markdown",
                    }
                )?;
                if Output::enable_ansi_colors_stdout() {
                    writer.write_all(b"\x1b[0m")?;
                }
                writer.write_all(b"\n")?;
            }

            Output::prettyln(format_args!("\n"));
            Output::flush();
        }

        log_ref.print(std::ptr::from_mut::<bun_core::io::Writer>(
            Output::error_writer(),
        ))?;
        exit_or_watch(
            if had_err { 1 } else { 0 },
            ctx.debug.hot_reload == HotReload::Watch,
        );
    }
}

fn exit_or_watch(code: u8, watch: bool) -> ! {
    if watch {
        // the watcher thread will exit the process
        // TODO(port): std.Thread.sleep(maxInt(u64)-1) — verify cross-platform sleep-forever
        std::thread::sleep(std::time::Duration::from_secs(u64::MAX / 1_000_000_000));
    }
    Global::exit(u32::from(code));
}

fn print_summary(
    bundled_end: i128,
    minify_duration: u64,
    minified: bool,
    input_code_length: usize,
    reachable_file_count: usize,
    output_files: &[options::OutputFile],
) {
    let padding_buf = [b' '; 16];

    let bundle_until_now =
        ((bundled_end - cli_start_time()) as i64) / (bun_core::time::NS_PER_MS as i64);

    let bundle_elapsed = if minified {
        bundle_until_now - i64::try_from((minify_duration as u64) & ((1u64 << 63) - 1)).unwrap()
        // TODO(port): @as(u63, @truncate(minify_duration)) — masked to 63 bits above
    } else {
        bundle_until_now
    };

    let minified_digit_count: usize =
        4usize.saturating_sub(bun_fmt::digit_count(minify_duration));
    if minified {
        Output::pretty(format_args!(
            "{}",
            bstr::BStr::new(&padding_buf[0..minified_digit_count])
        ));
        Output::print_elapsed_stdout_trim(minify_duration as f64);
        let output_size = {
            let mut total_size: u64 = 0;
            for f in output_files.iter() {
                if f.loader == bun_ast::Loader::Js {
                    total_size += f.size_without_sourcemap as u64;
                }
            }
            total_size
        };
        // this isn't an exact size
        // we may inject sourcemaps or comments or import paths
        let delta: i64 = ((input_code_length as i128) - (output_size as i128)) as i64;
        if delta > 1024 {
            Output::prettyln(format_args!(
                "  <green>minify<r>  -{} <d>(estimate)<r>",
                bun_fmt::size(
                    usize::try_from(delta).expect("int cast"),
                    Default::default()
                )
            ));
        } else if -delta > 1024 {
            Output::prettyln(format_args!(
                "  <b>minify<r>   +{} <d>(estimate)<r>",
                bun_fmt::size(
                    usize::try_from(-delta).expect("int cast"),
                    Default::default()
                )
            ));
        } else {
            Output::prettyln(format_args!("  <b>minify<r>"));
        }
    }

    let bundle_elapsed_digit_count: usize =
        4usize.saturating_sub(bun_fmt::digit_count(bundle_elapsed.max(0)));

    Output::pretty(format_args!(
        "{}",
        bstr::BStr::new(&padding_buf[0..bundle_elapsed_digit_count])
    ));
    Output::print_elapsed_stdout_trim(bundle_elapsed as f64);
    Output::prettyln(format_args!(
        "  <green>bundle<r>  {} modules",
        reachable_file_count
    ));
}

// ported from: src/cli/build_command.zig

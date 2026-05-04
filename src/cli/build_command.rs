use std::io::Write as _;

use bun_bundler::bundle_v2::BundleV2;
use bun_bundler::linker_context::metafile_builder as MetafileBuilder;
use bun_bundler::options;
use bun_bundler::transpiler;
use bun_cli::Command;
use bun_core::{fmt as bun_fmt, Global, Output};
use bun_js_parser::runtime::Runtime;
use bun_paths::{self as resolve_path, PathBuffer};
use bun_str::strings;
use bun_sys::{self, Fd};

pub struct BuildCommand;

impl BuildCommand {
    pub fn exec(
        ctx: &mut Command::Context,
        fetcher: Option<&mut BundleV2::DependenciesScanner>,
    ) -> Result<(), bun_core::Error> {
        Global::configure_allocator(Global::AllocatorConfig { long_running: true });
        // PERF(port): allocator param dropped — global mimalloc
        let log = ctx.log;
        let user_requested_browser_target =
            ctx.args.target.is_some() && ctx.args.target.unwrap() == options::Target::Browser;
        if ctx.bundler_options.compile || ctx.bundler_options.bytecode {
            // set this early so that externals are set up correctly and define is right
            ctx.args.target = Some(options::Target::Bun);
        }

        if ctx.bundler_options.bake {
            return bun_bake::production::build_command(ctx);
        }

        if fetcher.is_some() {
            ctx.args.packages = options::Packages::External;
            ctx.bundler_options.compile = false;
        }

        let compile_target = &ctx.bundler_options.compile_target;

        if ctx.bundler_options.compile {
            let compile_define_keys = compile_target.define_keys();
            let compile_define_values = compile_target.define_values();

            if let Some(define) = ctx.args.define.as_mut() {
                let mut keys: Vec<&[u8]> =
                    Vec::with_capacity(compile_define_keys.len() + define.keys.len());
                keys.extend_from_slice(compile_define_keys);
                keys.extend_from_slice(&define.keys);
                // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                let mut values: Vec<&[u8]> =
                    Vec::with_capacity(compile_define_values.len() + define.values.len());
                values.extend_from_slice(compile_define_values);
                values.extend_from_slice(&define.values);

                define.keys = keys.into_boxed_slice();
                define.values = values.into_boxed_slice();
            } else {
                ctx.args.define = Some(options::api::StringMap {
                    keys: Box::from(compile_define_keys),
                    values: Box::from(compile_define_values),
                });
            }
        }

        let mut this_transpiler = transpiler::Transpiler::init(log, ctx.args.clone(), None)?;
        if let Some(fetch) = fetcher.as_deref() {
            this_transpiler.options.entry_points = fetch.entry_points.clone();
            this_transpiler.resolver.opts.entry_points = fetch.entry_points.clone();
            this_transpiler.options.ignore_module_resolution_errors = true;
            this_transpiler.resolver.opts.ignore_module_resolution_errors = true;
        }

        this_transpiler.options.source_map =
            options::SourceMapOption::from_api(ctx.args.source_map);

        this_transpiler.options.compile = ctx.bundler_options.compile;

        if this_transpiler.options.source_map == options::SourceMapOption::External
            && ctx.bundler_options.outdir.is_empty()
            && !ctx.bundler_options.compile
        {
            Output::pretty_errorln(
                "<r><red>error<r><d>:<r> cannot use an external source map without --outdir",
                format_args!(""),
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

        this_transpiler.options.banner = ctx.bundler_options.banner.clone();
        this_transpiler.options.footer = ctx.bundler_options.footer.clone();
        this_transpiler.options.drop = ctx.args.drop.clone();
        this_transpiler.options.bundler_feature_flags =
            Runtime::Features::init_bundler_feature_flags(&ctx.args.feature_flags);

        this_transpiler.options.allow_unresolved =
            if let Some(a) = ctx.bundler_options.allow_unresolved.as_ref() {
                options::AllowUnresolved::from_strings(a)
            } else {
                options::AllowUnresolved::All
            };
        this_transpiler.options.css_chunking = ctx.bundler_options.css_chunking;
        this_transpiler.options.metafile = !ctx.bundler_options.metafile.is_empty()
            || !ctx.bundler_options.metafile_md.is_empty();

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
                    format_args!(""),
                );
                Global::exit(1);
            }

            // Check if all entrypoints are HTML files for standalone HTML mode
            let has_all_html_entrypoints = 'brk: {
                if this_transpiler.options.entry_points.is_empty() {
                    break 'brk false;
                }
                for entry_point in this_transpiler.options.entry_points.iter() {
                    if !strings::has_suffix(entry_point, b".html") {
                        break 'brk false;
                    }
                }
                true
            };

            if user_requested_browser_target && has_all_html_entrypoints {
                // --compile --target=browser with all HTML entrypoints: produce self-contained HTML
                ctx.args.target = Some(options::Target::Browser);
                if ctx.bundler_options.code_splitting {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> cannot use --compile --target browser with --splitting",
                        format_args!(""),
                    );
                    Global::exit(1);
                }

                this_transpiler.options.compile_to_standalone_html = true;
                // This is not a bun executable compile - clear compile flags
                this_transpiler.options.compile = false;
                ctx.bundler_options.compile = false;

                if ctx.bundler_options.outdir.is_empty() && outfile.is_empty() {
                    outfile = bun_paths::basename(&this_transpiler.options.entry_points[0]);
                }

                this_transpiler.options.supports_multiple_outputs =
                    !ctx.bundler_options.outdir.is_empty();
            } else {
                // Standard --compile: produce standalone bun executable
                if !ctx.bundler_options.outdir.is_empty() {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> cannot use --compile with --outdir",
                        format_args!(""),
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
                    outfile = bun_paths::basename(&this_transpiler.options.entry_points[0]);
                    let ext = bun_paths::extension(outfile);
                    if !ext.is_empty() {
                        outfile = &outfile[0..outfile.len() - ext.len()];
                    }

                    if outfile == b"index" {
                        outfile = bun_paths::basename(
                            bun_paths::dirname(&this_transpiler.options.entry_points[0])
                                .unwrap_or(b"index"),
                        );
                        was_renamed_from_index = outfile != b"index";
                    }

                    if outfile == b"bun" {
                        outfile = bun_paths::basename(
                            bun_paths::dirname(&this_transpiler.options.entry_points[0])
                                .unwrap_or(b"bun"),
                        );
                    }
                }

                // If argv[0] is "bun" or "bunx", we don't check if the binary is standalone
                if outfile == b"bun" || outfile == b"bunx" {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> cannot use --compile with an output file named 'bun' because bun won't realize it's a standalone executable. Please choose a different name for --outfile",
                        format_args!(""),
                    );
                    Global::exit(1);
                }
            }
        }

        if ctx.bundler_options.transform_only {
            // Check if any entry point is an HTML file
            for entry_point in this_transpiler.options.entry_points.iter() {
                if strings::has_suffix(entry_point, b".html") {
                    Output::pretty_errorln(
                        "<r><red>error<r><d>:<r> HTML imports are only supported when bundling",
                        format_args!(""),
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
                    format_args!(""),
                );
                Global::exit(1);
            }
            if this_transpiler.options.code_splitting {
                Output::pretty_errorln(
                    "<r><red>error<r><d>:<r> Must use <b>--outdir<r> when code splitting is enabled",
                    format_args!(""),
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
                    break 'brk2 bun_paths::dirname(&this_transpiler.options.entry_points[0])
                        .unwrap_or(b".");
                }

                resolve_path::get_if_exists_longest_common_path(
                    &this_transpiler.options.entry_points,
                )
                .unwrap_or(b".")
            };

            // TODO(port): std.posix.toPosixPath — NUL-terminate path into a stack buffer
            let dir = match bun_sys::open_dir_for_path(path) {
                Ok(d) => Fd::from_std_dir(d),
                Err(err) => {
                    Output::pretty_errorln(
                        "<r><red>{}<r> opening root directory {}",
                        format_args!("{} {}", err.name(), bun_fmt::quote(path)),
                    );
                    Global::exit(1);
                }
            };
            // TODO(port): defer dir.close() — using explicit close after use; consider RAII guard in Phase B

            let result = match dir.get_fd_path(&mut src_root_dir_buf) {
                Ok(p) => p,
                Err(err) => {
                    Output::pretty_errorln(
                        "<r><red>{}<r> resolving root directory {}",
                        format_args!("{} {}", err.name(), bun_fmt::quote(path)),
                    );
                    Global::exit(1);
                }
            };
            dir.close();
            break 'brk1 result;
        };

        this_transpiler.options.root_dir = src_root_dir.into();
        this_transpiler.options.code_splitting = ctx.bundler_options.code_splitting;
        this_transpiler.options.transform_only = ctx.bundler_options.transform_only;

        this_transpiler.options.env.behavior = ctx.bundler_options.env_behavior;
        this_transpiler.options.env.prefix = ctx.bundler_options.env_prefix.clone();

        if ctx.bundler_options.production {
            this_transpiler.env.map.put(b"NODE_ENV", b"production")?;
        }

        this_transpiler.configure_defines()?;
        this_transpiler.configure_linker();

        if !this_transpiler.options.production {
            this_transpiler
                .options
                .conditions
                .append_slice(&[b"development" as &[u8]])?;
        }

        this_transpiler.resolver.opts = this_transpiler.options.clone();
        this_transpiler.resolver.env_loader = this_transpiler.env.clone();

        // Allow tsconfig.json overriding, but always set it to false if --production is passed.
        if ctx.bundler_options.production {
            this_transpiler.options.jsx.development = false;
            this_transpiler.resolver.opts.jsx.development = false;
        }

        match &ctx.debug.macros {
            Command::MacroOptions::Disable => {
                this_transpiler.options.no_macros = true;
            }
            Command::MacroOptions::Map(macros) => {
                this_transpiler.options.macro_remap = macros.clone();
            }
            Command::MacroOptions::Unspecified => {}
        }

        // TODO(port): client_transpiler is left uninitialized in Zig until needed; using Option here
        let mut client_transpiler: Option<transpiler::Transpiler> = None;
        if this_transpiler.options.server_components {
            let mut ct = transpiler::Transpiler::init(log, ctx.args.clone(), None)?;
            ct.options = this_transpiler.options.clone();
            ct.options.target = options::Target::Browser;
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
            ct.options.define = options::Define::init(
                if let Some(user_defines) = ctx.args.define.as_ref() {
                    Some(options::Define::Data::from_input(
                        options::string_hash_map_from_arrays::<options::defines::RawDefines>(
                            user_defines.keys.len() + 4,
                            &user_defines.keys,
                            &user_defines.values,
                        )?,
                        &ctx.args.drop,
                        log,
                    )?)
                } else {
                    None
                },
                None,
                this_transpiler.options.define.drop_debugger,
                this_transpiler.options.dead_code_elimination
                    && this_transpiler.options.minify_syntax,
            )?;

            bun_bake::add_import_meta_defines(
                &mut this_transpiler.options.define,
                bun_bake::Mode::Development,
                bun_bake::Side::Server,
            )?;
            bun_bake::add_import_meta_defines(
                &mut ct.options.define,
                bun_bake::Mode::Development,
                bun_bake::Side::Client,
            )?;

            this_transpiler.resolver.opts = this_transpiler.options.clone();
            this_transpiler.resolver.env_loader = this_transpiler.env.clone();
            ct.resolver.opts = ct.options.clone();
            ct.resolver.env_loader = ct.env.clone();
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

        let output_files: &mut [options::OutputFile] = 'brk: {
            if ctx.bundler_options.transform_only {
                this_transpiler.options.import_path_format =
                    options::ImportPathFormat::Relative;
                this_transpiler.options.allow_runtime = false;
                this_transpiler.resolver.opts.allow_runtime = false;

                // TODO: refactor this .transform function
                let result = this_transpiler.transform(ctx.log, ctx.args.clone())?;

                if log.has_errors() {
                    log.print(Output::error_writer())?;

                    if !result.errors.is_empty() || result.output_files.is_empty() {
                        Output::flush();
                        exit_or_watch(1, ctx.debug.hot_reload == Command::HotReload::Watch);
                    }
                }

                break 'brk result.output_files;
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
                if let Some(dir) = bun_paths::dirname(outfile) {
                    ctx.bundler_options.outdir = dir.into();
                }
                this_transpiler.resolver.opts.entry_naming =
                    this_transpiler.options.entry_naming.clone();
            }

            let build_result = match BundleV2::generate_from_cli(
                &mut this_transpiler,
                bun_jsc::AnyEventLoop::init(),
                ctx.debug.hot_reload == Command::HotReload::Watch,
                &mut reachable_file_count,
                &mut minify_duration,
                &mut input_code_length,
                fetcher,
            ) {
                Ok(r) => r,
                Err(err) => {
                    if !log.msgs.is_empty() {
                        log.print(Output::error_writer())?;
                    } else {
                        write!(Output::error_writer(), "error: {}", err.name())?;
                    }

                    Output::flush();
                    exit_or_watch(1, ctx.debug.hot_reload == Command::HotReload::Watch);
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
                        bun_sys::Result::Ok(f) => f,
                        bun_sys::Result::Err(err) => {
                            Output::err(
                                err,
                                "could not open metafile {}",
                                format_args!("{}", bun_fmt::quote(&ctx.bundler_options.metafile)),
                            );
                            exit_or_watch(1, ctx.debug.hot_reload == Command::HotReload::Watch);
                        }
                    };

                    match file.write_all(metafile_json) {
                        bun_sys::Result::Ok(()) => {}
                        bun_sys::Result::Err(err) => {
                            Output::err(
                                err,
                                "could not write metafile {}",
                                format_args!("{}", bun_fmt::quote(&ctx.bundler_options.metafile)),
                            );
                            exit_or_watch(1, ctx.debug.hot_reload == Command::HotReload::Watch);
                        }
                    }
                    drop(file);
                }

                // Write markdown metafile if requested
                if !ctx.bundler_options.metafile_md.is_empty() {
                    let metafile_md = match MetafileBuilder::generate_markdown(metafile_json) {
                        Ok(md) => Some(md),
                        Err(err) => {
                            Output::warn(
                                "Failed to generate markdown metafile: {}",
                                format_args!("{}", err.name()),
                            );
                            None
                        }
                    };
                    if let Some(md_content) = metafile_md {
                        let file = match bun_sys::File::make_open(
                            &ctx.bundler_options.metafile_md,
                            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                            0o664,
                        ) {
                            bun_sys::Result::Ok(f) => f,
                            bun_sys::Result::Err(err) => {
                                Output::err(
                                    err,
                                    "could not open metafile-md {}",
                                    format_args!(
                                        "{}",
                                        bun_fmt::quote(&ctx.bundler_options.metafile_md)
                                    ),
                                );
                                exit_or_watch(
                                    1,
                                    ctx.debug.hot_reload == Command::HotReload::Watch,
                                );
                            }
                        };

                        match file.write_all(&md_content) {
                            bun_sys::Result::Ok(()) => {}
                            bun_sys::Result::Err(err) => {
                                Output::err(
                                    err,
                                    "could not write metafile-md {}",
                                    format_args!(
                                        "{}",
                                        bun_fmt::quote(&ctx.bundler_options.metafile_md)
                                    ),
                                );
                                exit_or_watch(
                                    1,
                                    ctx.debug.hot_reload == Command::HotReload::Watch,
                                );
                            }
                        }
                        drop(file);
                        // md_content dropped at scope exit
                    }
                }
            }

            break 'brk build_result.output_files.as_mut_slice();
            // TODO(port): lifetime — build_result must outlive this borrow; Phase B may need to restructure ownership
        };
        let bundled_end = bun_core::time::nano_timestamp();

        let mut had_err = false;
        'dump: {
            // Output::flush() runs at end of this block (defer in Zig); see explicit calls below
            let mut writer = Output::writer_buffered();
            let mut output_dir: &[u8] = &this_transpiler.options.output_dir;

            let will_be_one_file =
                // --outdir is not supported with --compile
                // but you can still use --outfile
                // in which case, we should set the output dir to the dirname of the outfile
                // https://github.com/oven-sh/bun/issues/8697
                ctx.bundler_options.compile
                    || (output_files.len() == 1
                        && matches!(output_files[0].value, options::OutputFileValue::Buffer { .. }));

            if output_dir.is_empty() && !outfile.is_empty() && will_be_one_file {
                output_dir = bun_paths::dirname(outfile).unwrap_or(b".");
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
                    if let options::OutputFileValue::Buffer(buffer) = &output_files[0].value {
                        writer.write_all(&buffer.bytes)?;
                    }
                    Output::flush();
                    break 'dump;
                }
            }

            let mut root_path: &[u8] = output_dir;
            if root_path.is_empty() && ctx.args.entry_points.len() == 1 {
                root_path = bun_paths::dirname(&ctx.args.entry_points[0]).unwrap_or(b".");
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
                            format_args!("{}", bun_fmt::quote(root_path)),
                        );
                        exit_or_watch(1, ctx.debug.hot_reload == Command::HotReload::Watch);
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
                max_path_len = max_path_len.max(
                    from_path.len().max(f.dest_path.len()) + 2 - from_path.len(),
                );
                size_padding = size_padding.max(bun_fmt::count(format_args!(
                    "{}",
                    bun_fmt::size(f.size, Default::default())
                )));
            }

            if ctx.bundler_options.compile {
                print_summary(
                    bundled_end,
                    minify_duration,
                    this_transpiler.options.minify_identifiers
                        || this_transpiler.options.minify_whitespace
                        || this_transpiler.options.minify_syntax,
                    input_code_length as usize,
                    reachable_file_count,
                    output_files,
                );

                Output::flush();

                let is_cross_compile = !compile_target.is_default();

                if outfile.is_empty()
                    || outfile == b"."
                    || outfile == b".."
                    || outfile == b"../"
                {
                    outfile = b"index";
                }

                // TODO(port): outfile may need owned storage when reassigned to allocated buffer below
                let mut outfile_owned: Vec<u8>;
                if compile_target.os == bun_cli::CompileTarget::Os::Windows
                    && !strings::has_suffix(outfile, b".exe")
                {
                    outfile_owned = Vec::new();
                    write!(&mut outfile_owned, "{}.exe", bstr::BStr::new(outfile))
                        .expect("unreachable");
                    outfile = &outfile_owned;
                } else if was_renamed_from_index && outfile != b"index" {
                    // If we're going to fail due to EISDIR, we should instead pick a different name.
                    if bun_sys::directory_exists_at(Fd::from_std_dir(root_dir), outfile)
                        .as_value()
                        .unwrap_or(false)
                    {
                        outfile = b"index";
                    }
                }

                let result =
                    match bun_standalone_module_graph::StandaloneModuleGraph::to_executable(
                        compile_target,
                        output_files,
                        root_dir,
                        &this_transpiler.options.public_path,
                        outfile,
                        &this_transpiler.env,
                        this_transpiler.options.output_format,
                        ctx.bundler_options.windows,
                        ctx.bundler_options.compile_exec_argv.as_deref().unwrap_or(b""),
                        &ctx.bundler_options.compile_executable_path,
                        bun_standalone_module_graph::ExecutableOptions {
                            disable_default_env_files: !ctx
                                .bundler_options
                                .compile_autoload_dotenv,
                            disable_autoload_bunfig: !ctx.bundler_options.compile_autoload_bunfig,
                            disable_autoload_tsconfig: !ctx
                                .bundler_options
                                .compile_autoload_tsconfig,
                            disable_autoload_package_json: !ctx
                                .bundler_options
                                .compile_autoload_package_json,
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

                if !matches!(
                    result,
                    bun_standalone_module_graph::ToExecutableResult::Success
                ) {
                    Output::print_errorln(format_args!(
                        "{}",
                        bstr::BStr::new(result.err().slice())
                    ));
                    Global::exit(1);
                }

                // Write external sourcemap files next to the compiled executable.
                // With --splitting, there can be multiple .map files (one per chunk).
                if this_transpiler.options.source_map == options::SourceMapOption::External {
                    for f in output_files.iter() {
                        if f.output_kind == options::OutputKind::Sourcemap
                            && matches!(f.value, options::OutputFileValue::Buffer { .. })
                        {
                            let options::OutputFileValue::Buffer(buffer) = &f.value else {
                                continue;
                            };
                            let sourcemap_bytes = &buffer.bytes;
                            if sourcemap_bytes.is_empty() {
                                continue;
                            }

                            // Use the sourcemap's own dest_path basename if available,
                            // otherwise fall back to {outfile}.map
                            let mut map_basename_owned: Vec<u8>;
                            let map_basename: &[u8] = if !f.dest_path.is_empty() {
                                bun_paths::basename(&f.dest_path)
                            } else {
                                let exe_base = bun_paths::basename(outfile);
                                map_basename_owned = Vec::new();
                                if compile_target.os == bun_cli::CompileTarget::Os::Windows
                                    && !strings::has_suffix(exe_base, b".exe")
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
                            match bun_runtime::node::fs::NodeFS::write_file_with_path_buffer(
                                &mut pathbuf,
                                bun_runtime::node::fs::WriteFileArgs {
                                    data: bun_runtime::node::fs::WriteFileData::Buffer(
                                        bun_runtime::node::Buffer {
                                            buffer: bun_runtime::node::ArrayBuffer {
                                                ptr: sourcemap_bytes.as_ptr() as *mut u8,
                                                len: sourcemap_bytes.len() as u32,
                                                byte_len: sourcemap_bytes.len() as u32,
                                            },
                                        },
                                    ),
                                    encoding: bun_runtime::node::Encoding::Buffer,
                                    dirfd: Fd::from_std_dir(root_dir),
                                    file: bun_runtime::node::fs::PathOrFileDescriptor::Path(
                                        bun_runtime::node::PathLike {
                                            string: bun_str::PathString::init(map_basename),
                                        },
                                    ),
                                    ..Default::default()
                                },
                            ) {
                                bun_sys::Result::Err(err) => {
                                    Output::err(
                                        err,
                                        "failed to write sourcemap file '{}'",
                                        format_args!("{}", bstr::BStr::new(map_basename)),
                                    );
                                    had_err = true;
                                }
                                bun_sys::Result::Ok(_) => {}
                            }
                        }
                    }
                }

                let compiled_elapsed = ((bun_core::time::nano_timestamp() - bundled_end) as i64)
                    / (bun_core::time::NS_PER_MS as i64);
                let compiled_elapsed_digit_count: isize = match compiled_elapsed {
                    0..=9 => 3,
                    10..=99 => 2,
                    100..=999 => 1,
                    1000..=9999 => 0,
                    _ => 0,
                };
                let padding_buf = [b' '; 16];
                let padding_ =
                    &padding_buf[0..usize::try_from(compiled_elapsed_digit_count).unwrap()];
                Output::pretty("{}", format_args!("{}", bstr::BStr::new(padding_)));

                Output::print_elapsed_stdout_trim(compiled_elapsed as f64);

                Output::pretty(
                    " <green>compile<r>  <b><blue>{}{}<r>",
                    format_args!(
                        "{}{}",
                        bstr::BStr::new(outfile),
                        if compile_target.os == bun_cli::CompileTarget::Os::Windows
                            && !strings::has_suffix(outfile, b".exe")
                        {
                            ".exe"
                        } else {
                            ""
                        }
                    ),
                );

                if is_cross_compile {
                    Output::pretty(" <r><d>{}<r>\n", format_args!("{}", compile_target));
                } else {
                    Output::pretty("\n", format_args!(""));
                }

                Output::flush();
                break 'dump;
            }

            if log.errors == 0 {
                if this_transpiler.options.transform_only {
                    Output::prettyln(
                        "<green>Transpiled file in {}ms<r>",
                        format_args!(
                            "{}",
                            (bun_core::time::nano_timestamp() - bun_cli::start_time())
                                / (bun_core::time::NS_PER_MS as i128)
                        ),
                    );
                } else {
                    Output::prettyln(
                        "<green>Bundled {} module{} in {}ms<r>",
                        format_args!(
                            "{} {} {}",
                            reachable_file_count,
                            if reachable_file_count == 1 { "" } else { "s" },
                            (bun_core::time::nano_timestamp() - bun_cli::start_time())
                                / (bun_core::time::NS_PER_MS as i128)
                        ),
                    );
                }
                Output::prettyln("\n", format_args!(""));
                Output::flush();
            }

            for f in output_files.iter() {
                size_padding = size_padding.max(bun_fmt::count(format_args!(
                    "{}",
                    bun_fmt::size(f.size, Default::default())
                )));
            }

            for f in output_files.iter() {
                if let Err(err) = f.write_to_disk(root_dir, from_path) {
                    Output::err(
                        err,
                        "failed to write file '{}'",
                        format_args!("{}", bun_fmt::quote(&f.dest_path)),
                    );
                    had_err = true;
                    continue;
                }

                debug_assert!(!bun_paths::is_absolute(&f.dest_path));

                let rel_path = strings::trim_prefix(&f.dest_path, b"./");

                // Print summary
                let padding_count = 2usize.max(rel_path.len().max(max_path_len) - rel_path.len());
                writer.splat_byte_all(b' ', 2)?;

                if Output::enable_ansi_colors_stdout() {
                    writer.write_all(match f.output_kind {
                        options::OutputKind::EntryPoint => Output::pretty_fmt("<blue>", true),
                        options::OutputKind::Chunk => Output::pretty_fmt("<cyan>", true),
                        options::OutputKind::Asset => Output::pretty_fmt("<magenta>", true),
                        options::OutputKind::Sourcemap => Output::pretty_fmt("<d>", true),
                        options::OutputKind::Bytecode => Output::pretty_fmt("<d>", true),
                        options::OutputKind::ModuleInfo => Output::pretty_fmt("<d>", true),
                        options::OutputKind::MetafileJson
                        | options::OutputKind::MetafileMarkdown => {
                            Output::pretty_fmt("<green>", true)
                        }
                    })?;
                }

                writer.write_all(rel_path)?;
                if Output::enable_ansi_colors_stdout() {
                    // highlight big files
                    let warn_threshold: usize = match f.output_kind {
                        options::OutputKind::EntryPoint | options::OutputKind::Chunk => {
                            128 * 1024
                        }
                        options::OutputKind::Asset => 16 * 1024 * 1024,
                        _ => usize::MAX,
                    };
                    if f.size > warn_threshold {
                        writer.write_all(Output::pretty_fmt("<yellow>", true))?;
                    } else {
                        writer.write_all(b"\x1b[0m")?;
                    }
                }

                writer.splat_byte_all(b' ', padding_count)?;
                write!(writer, "{}  ", bun_fmt::size(f.size, Default::default()))?;
                writer.splat_byte_all(
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

            Output::prettyln("\n", format_args!(""));
            Output::flush();
        }

        log.print(Output::error_writer())?;
        exit_or_watch(
            if had_err { 1 } else { 0 },
            ctx.debug.hot_reload == Command::HotReload::Watch,
        );
    }
}

fn exit_or_watch(code: u8, watch: bool) -> ! {
    if watch {
        // the watcher thread will exit the process
        // TODO(port): std.Thread.sleep(maxInt(u64)-1) — verify cross-platform sleep-forever
        std::thread::sleep(std::time::Duration::from_secs(u64::MAX / 1_000_000_000));
    }
    Global::exit(code);
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
        ((bundled_end - bun_cli::start_time()) as i64) / (bun_core::time::NS_PER_MS as i64);

    let bundle_elapsed = if minified {
        bundle_until_now - i64::try_from((minify_duration as u64) & ((1u64 << 63) - 1)).unwrap()
        // TODO(port): @as(u63, @truncate(minify_duration)) — masked to 63 bits above
    } else {
        bundle_until_now
    };

    let minified_digit_count: usize = match minify_duration {
        0..=9 => 3,
        10..=99 => 2,
        100..=999 => 1,
        1000..=9999 => 0,
        _ => 0,
    };
    if minified {
        Output::pretty(
            "{}",
            format_args!(
                "{}",
                bstr::BStr::new(&padding_buf[0..usize::try_from(minified_digit_count).unwrap()])
            ),
        );
        Output::print_elapsed_stdout_trim(minify_duration as f64);
        let output_size = {
            let mut total_size: u64 = 0;
            for f in output_files.iter() {
                if f.loader == options::Loader::Js {
                    total_size += f.size_without_sourcemap;
                }
            }
            total_size
        };
        // this isn't an exact size
        // we may inject sourcemaps or comments or import paths
        let delta: i64 = ((input_code_length as i128) - (output_size as i128)) as i64;
        if delta > 1024 {
            Output::prettyln(
                "  <green>minify<r>  -{} <d>(estimate)<r>",
                format_args!(
                    "{}",
                    bun_fmt::size(usize::try_from(delta).unwrap(), Default::default())
                ),
            );
        } else if -delta > 1024 {
            Output::prettyln(
                "  <b>minify<r>   +{} <d>(estimate)<r>",
                format_args!(
                    "{}",
                    bun_fmt::size(usize::try_from(-delta).unwrap(), Default::default())
                ),
            );
        } else {
            Output::prettyln("  <b>minify<r>", format_args!(""));
        }
    }

    let bundle_elapsed_digit_count: usize = match bundle_elapsed {
        0..=9 => 3,
        10..=99 => 2,
        100..=999 => 1,
        1000..=9999 => 0,
        _ => 0,
    };

    Output::pretty(
        "{}",
        format_args!(
            "{}",
            bstr::BStr::new(
                &padding_buf[0..usize::try_from(bundle_elapsed_digit_count).unwrap()]
            )
        ),
    );
    Output::print_elapsed_stdout_trim(bundle_elapsed as f64);
    Output::prettyln(
        "  <green>bundle<r>  {} modules",
        format_args!("{}", reachable_file_count),
    );
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/build_command.zig (813 lines)
//   confidence: medium
//   todos:      6
//   notes:      Output::pretty* fmt-string + format_args! shape is a guess; output_files lifetime from labeled block needs restructuring; NodeFS::write_file_with_path_buffer arg struct shape guessed; std.fs.cwd()/makeOpenPath mapped to bun_sys::Dir; bun.cli.start_time mapped to bun_cli::start_time().
// ──────────────────────────────────────────────────────────────────────────

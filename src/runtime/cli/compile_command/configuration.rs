use core::ptr::NonNull;
use std::io::Write as _;

use super::entry_points::find_default_entry_point;
use super::library::find_default_library_entry_points;
use super::{BundlerInputs, CompileProduct, CompileRequest, ExecutableSettings, RequestOrigin};
pub(super) use crate::cli::build_command::compile_outfile;
use crate::cli::command::Context;
use bun_bundler::aot::expand_entry_points;
use bun_bundler::options;
use bun_bundler::transpiler::Transpiler;
use bun_core::env::OperatingSystem;
use bun_core::strings;
use bun_core::{Global, Output, fmt as bun_fmt};
use bun_event_loop::AnyEventLoop;
use bun_js_parser::parser::Runtime;
use bun_options_types::compile_target::CompileTarget;
use bun_options_types::context::{ContextData, MacroOptions};
use bun_options_types::schema::api;
use bun_resolver::fs::FileSystem;
use bun_standalone_graph::StandaloneModuleGraph::{Flags, RuntimeOptions, target_base_public_path};
use bun_sys::Fd;

pub(crate) const DEFAULT_LIBRARY_OUTDIR: &[u8] = b"dist";

pub(super) struct Configuration {
    pub(super) transpiler: &'static mut Transpiler<'static>,
    pub(super) arena: &'static bun_alloc::Arena,
    pub(super) outfile: Box<[u8]>,
    pub(super) was_renamed_from_index: bool,
}

pub(super) struct OutputLocation {
    pub(super) root_dir: bun_sys::Dir,
    pub(super) outfile: Vec<u8>,
}

struct ExecutableName {
    outfile: Box<[u8]>,
    was_renamed_from_index: bool,
}

pub(super) fn use_default_entry_point(ctx: &mut ContextData) {
    if !ctx.args.entry_points.is_empty() {
        return;
    }
    let working_directory = ctx
        .args
        .absolute_working_dir
        .as_deref()
        .expect("Arguments::parse sets the working directory");
    if ctx.bundler_options.library {
        let found =
            find_default_library_entry_points(working_directory, &ctx.bundler_options.outdir);
        ctx.args.entry_points = found.unwrap_or_else(|error| error.exit());
        return;
    }
    match find_default_entry_point(working_directory) {
        Ok(found) => {
            ctx.args.entry_points = vec![found.path];
            if ctx.bundler_options.outfile.is_empty() {
                ctx.bundler_options.outfile = found.executable_name;
            }
        }
        Err(error) => {
            let mut message = Vec::new();
            error.write_message(&mut message);
            exit_without_entry_point(&message);
        }
    }
}

#[cold]
pub(super) fn exit_without_entry_point(message: &[u8]) -> ! {
    Output::err_generic("{}", (bstr::BStr::new(message),));
    bun_core::pretty_error!(
        "\nUsage:\n  <d>$<r> <b><green>bun compile<r> \\<entrypoint\\> <cyan>[...flags]<r>\n\nTo see full documentation:\n  <d>$<r> <b><green>bun compile<r> --help\n"
    );
    Output::flush();
    Global::exit(1);
}

fn add_target_defines(ctx: &mut ContextData) {
    let compile_target = &ctx.bundler_options.compile_target;
    let compile_define_keys = compile_target.define_keys();
    let compile_define_values = compile_target.define_values();

    if let Some(define) = ctx.args.define.as_mut() {
        let mut keys: Vec<Box<[u8]>> =
            Vec::with_capacity(compile_define_keys.len() + define.keys.len());
        keys.extend(compile_define_keys.iter().map(|s| Box::<[u8]>::from(*s)));
        keys.append(&mut define.keys);
        let mut values: Vec<Box<[u8]>> =
            Vec::with_capacity(compile_define_values.len() + define.values.len());
        values.extend(compile_define_values.iter().map(|s| Box::<[u8]>::from(*s)));
        values.append(&mut define.values);

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

pub(super) fn configure(ctx: Context<'_>) -> Result<Configuration, crate::Error> {
    add_target_defines(ctx);

    let arena: &'static bun_alloc::Arena = crate::cli::cli_arena();
    // In the arena: the build takes `&'a mut Transpiler<'a>`, which no stack local satisfies.
    let this_transpiler: &'static mut Transpiler<'static> =
        arena.alloc(Transpiler::init(arena, ctx.log, ctx.args.clone(), None)?);
    bun_core::asan::register_root_region(
        std::ptr::from_ref::<Transpiler>(this_transpiler).cast(),
        core::mem::size_of::<Transpiler>(),
    );

    expand_entry_patterns(this_transpiler);
    add_addons_among_assets(ctx, this_transpiler);
    let first_entry_point: Box<[u8]> = this_transpiler
        .options
        .entry_points
        .first()
        .cloned()
        .unwrap_or_default();

    apply_bundler_options(ctx, this_transpiler);
    let name = name_executable(ctx, this_transpiler, &first_entry_point);
    resolve_root_directory(ctx, this_transpiler);
    finish(ctx, this_transpiler)?;

    Ok(Configuration {
        transpiler: this_transpiler,
        arena,
        outfile: name.outfile,
        was_renamed_from_index: name.was_renamed_from_index,
    })
}

fn expand_entry_patterns(this_transpiler: &mut Transpiler<'static>) {
    // After a failure the patterns stay as written: the build expands them again and reports it.
    let mut unreported = bun_ast::Log::init();
    let expanded = expand_entry_points(
        &this_transpiler.options.entry_points,
        FileSystem::get().top_level_dir(),
        None,
        &mut unreported,
    );
    if let Some(expanded) = expanded {
        this_transpiler.options.entry_points =
            expanded.into_iter().map(Vec::into_boxed_slice).collect();
    }
}

/// A native addon among the assets is a further entry point.
fn add_addons_among_assets(ctx: &ContextData, this_transpiler: &mut Transpiler<'static>) {
    let working_directory = FileSystem::get().top_level_dir();
    let mut unreported = bun_ast::Log::init();
    let mut addons: Vec<Vec<u8>> = Vec::new();
    for asset in &ctx.bundler_options.compile_assets {
        let asset = super::build::trim_trailing_separators(asset);
        if asset.ends_with(b".node") {
            addons.push(asset.to_vec());
            continue;
        }
        let in_folder = [[asset, b"/**/*.node"].concat()];
        let found = expand_entry_points(&in_folder, working_directory, None, &mut unreported);
        addons.extend(found.unwrap_or_default());
    }
    if addons.is_empty() {
        return;
    }
    let written = this_transpiler
        .options
        .entry_points
        .iter()
        .map(|path| path.to_vec());
    let all: Vec<Vec<u8>> = written.chain(addons).collect();
    if let Some(distinct) = expand_entry_points(&all, working_directory, None, &mut unreported) {
        this_transpiler.options.entry_points =
            distinct.into_iter().map(Vec::into_boxed_slice).collect();
    }
}

fn apply_bundler_options(ctx: &ContextData, this_transpiler: &mut Transpiler<'static>) {
    this_transpiler.options.source_map = options::SourceMapOption::from_api(ctx.args.source_map);

    this_transpiler.options.compile_mode = options::CompileMode::Executable;

    let outfile: &[u8] = &ctx.bundler_options.outfile;

    this_transpiler.options.supports_multiple_outputs = outfile.is_empty();

    this_transpiler
        .options
        .public_path
        .clone_from(&ctx.bundler_options.public_path);
    this_transpiler
        .options
        .entry_naming
        .clone_from(&ctx.bundler_options.entry_naming);
    this_transpiler
        .options
        .chunk_naming
        .clone_from(&ctx.bundler_options.chunk_naming);
    this_transpiler
        .options
        .asset_naming
        .clone_from(&ctx.bundler_options.asset_naming);
    this_transpiler.options.react_fast_refresh = ctx.bundler_options.react_fast_refresh;
    this_transpiler.options.react_compiler = if ctx.bundler_options.react_compiler {
        if this_transpiler.options.target.is_server_side() {
            bun_ast::runtime::ReactCompilerMode::Ssr
        } else {
            bun_ast::runtime::ReactCompilerMode::Client
        }
    } else {
        bun_ast::runtime::ReactCompilerMode::Disabled
    };
    this_transpiler.options.inline_entrypoint_import_meta_main =
        ctx.bundler_options.inline_entrypoint_import_meta_main;
    this_transpiler.options.code_splitting = ctx.bundler_options.code_splitting;
    this_transpiler.options.split_require = ctx.bundler_options.split_require;
    this_transpiler.options.minify_syntax = ctx.bundler_options.minify_syntax;
    this_transpiler.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
    this_transpiler.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
    this_transpiler.options.keep_names = ctx.bundler_options.keep_names;
    this_transpiler.options.emit_dce_annotations = ctx.bundler_options.emit_dce_annotations;
    this_transpiler.options.deprecated_namespace_object_setters =
        ctx.bundler_options.deprecated_namespace_object_setters;
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
    this_transpiler.options.min_chunk_size = ctx.bundler_options.min_chunk_size;
    this_transpiler.options.module_preload = ctx.bundler_options.module_preload;
    this_transpiler.options.metafile =
        !ctx.bundler_options.metafile.is_empty() || !ctx.bundler_options.metafile_md.is_empty();

    this_transpiler
        .options
        .output_dir
        .clone_from(&ctx.bundler_options.outdir);
    this_transpiler.options.output_format = ctx.bundler_options.output_format;

    if ctx.bundler_options.output_format == options::OutputFormat::InternalBakeDev {
        this_transpiler.options.tree_shaking = false;
    }

    this_transpiler.options.bytecode = false;
}

fn name_executable(
    ctx: &ContextData,
    this_transpiler: &mut Transpiler<'static>,
    first_entry_point: &[u8],
) -> ExecutableName {
    let compile_target = &ctx.bundler_options.compile_target;
    let mut outfile: &[u8] = &ctx.bundler_options.outfile;
    let mut was_renamed_from_index = false;

    if ctx.bundler_options.transform_only {
        bun_core::pretty_errorln!("<r><red>error<r><d>:<r> --compile does not support --no-bundle");
        Global::exit(1);
    }

    if !ctx.bundler_options.outdir.is_empty() {
        bun_core::pretty_errorln!("<r><red>error<r><d>:<r> cannot use --compile with --outdir");
        Global::exit(1);
    }

    // The runtime does not read the source map comment, so every kind of map becomes `external`.
    if this_transpiler.options.source_map != options::SourceMapOption::None {
        this_transpiler.options.source_map = options::SourceMapOption::External;
    }

    let base_public_path = target_base_public_path(compile_target.os, b"root/");

    this_transpiler.options.public_path = base_public_path.into();

    if outfile.is_empty() {
        outfile = bun_paths::basename(first_entry_point);
        let ext = bun_paths::extension(outfile);
        if !ext.is_empty() {
            outfile = &outfile[0..outfile.len() - ext.len()];
        }

        if outfile == b"index" {
            outfile = bun_paths::basename(bun_core::dirname(first_entry_point).unwrap_or(b"index"));
            was_renamed_from_index = outfile != b"index";
        }

        if outfile == b"bun" {
            outfile = bun_paths::basename(bun_core::dirname(first_entry_point).unwrap_or(b"bun"));
        }
    }

    if outfile == b"bun" || outfile == b"bunx" {
        bun_core::pretty_errorln!(
            "<r><red>error<r><d>:<r> cannot use --compile with an output file named 'bun' because bun won't realize it's a standalone executable. Please choose a different name for --outfile"
        );
        Global::exit(1);
    }

    this_transpiler.options.compile_entry_point_name =
        bun_paths::basename(compile_outfile(outfile)).into();

    ExecutableName {
        outfile: outfile.into(),
        was_renamed_from_index,
    }
}

fn resolve_root_directory(ctx: &ContextData, this_transpiler: &mut Transpiler<'static>) {
    let path: &[u8] = &ctx.bundler_options.root_dir;
    if path.is_empty() {
        // The build derives it from the entry points, once their patterns are expanded.
        this_transpiler.options.root_dir = Box::default();
        return;
    }

    let dir = match bun_sys::open_dir_at(Fd::cwd(), path) {
        Ok(d) => bun_sys::Dir { fd: d },
        Err(err) => {
            bun_core::pretty_errorln!(
                "<r><red>{}<r> opening root directory {}",
                bstr::BStr::new(err.name()),
                bun_fmt::quote(path),
            );
            Global::exit(1);
        }
    };

    let mut src_root_dir_buf = bun_paths::path_buffer_pool::get();
    let src_root_dir: &[u8] = match bun_sys::get_fd_path(dir.fd, &mut src_root_dir_buf) {
        Ok(p) => &*p,
        Err(err) => {
            bun_core::pretty_errorln!(
                "<r><red>{}<r> resolving root directory {}",
                bstr::BStr::new(err.name()),
                bun_fmt::quote(path),
            );
            Global::exit(1);
        }
    };

    this_transpiler.options.root_dir = src_root_dir.into();
}

fn finish(
    ctx: &ContextData,
    this_transpiler: &mut Transpiler<'static>,
) -> Result<(), crate::Error> {
    this_transpiler.options.code_splitting = ctx.bundler_options.code_splitting;

    this_transpiler.options.env.behavior = ctx.bundler_options.env_behavior;
    this_transpiler
        .options
        .env
        .prefix
        .clone_from(&ctx.bundler_options.env_prefix);

    if ctx.bundler_options.production {
        // SAFETY: `env` is a process-lifetime singleton set in `Transpiler::init`.
        unsafe { (*this_transpiler.env).map.put(b"NODE_ENV", b"production")? };
    }

    this_transpiler.configure_defines()?;
    this_transpiler.configure_linker();

    this_transpiler.options.compile_target_builtins = options::CompileTargetBuiltins::Host;

    if !this_transpiler.options.production {
        this_transpiler
            .options
            .conditions
            .append_slice(&[b"development" as &[u8]])?;
    }

    this_transpiler.sync_resolver_opts();
    this_transpiler.resolver.env_loader = NonNull::new(this_transpiler.env);

    if ctx.bundler_options.production {
        this_transpiler.options.jsx.development = false;
        this_transpiler.resolver.opts.jsx.development = false;
    }

    match &ctx.debug.macros {
        MacroOptions::Disable => {
            this_transpiler.options.no_macros = true;
        }
        MacroOptions::Map(macros) => {
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

    Ok(())
}

pub(super) fn request_from_context<'r>(
    ctx: &'r mut ContextData,
    configuration: Configuration,
    event_loop: &'r mut AnyEventLoop,
    product: CompileProduct<'r>,
    root_dir: Fd,
    origin: RequestOrigin,
) -> CompileRequest<'r, 'static> {
    let Configuration {
        transpiler, arena, ..
    } = configuration;
    let entry_points = transpiler.options.entry_points.iter();
    let entry_points: &'static [&'static [u8]] = arena.alloc_slice_fill_iter(
        entry_points.map(|path| -> &'static [u8] { arena.alloc_slice_copy(&path[..]) }),
    );
    let embeds_source_maps = transpiler.options.source_map != options::SourceMapOption::None;
    // SAFETY: `env` is a process-lifetime singleton set in `Transpiler::init`.
    let env = unsafe { &mut *transpiler.env };
    // SAFETY: `create_context_data` set `ctx.log`, which lives as long as the process. The build
    // writes to it through this reference or through the transpiler's pointer, never both at once.
    let log = unsafe { &mut *ctx.log };

    CompileRequest {
        origin,
        product,
        options: ctx
            .bundler_options
            .aot
            .as_deref()
            .expect("the caller compiles ahead of time"),
        entry_points,
        bundler: Some(BundlerInputs {
            transpiler,
            arena,
            event_loop: Some(NonNull::from(event_loop)),
            worker_pool: None,
            plugins: None,
            file_map: None,
        }),
        executable: ExecutableSettings {
            target: &ctx.bundler_options.compile_target,
            executable_path: ctx.bundler_options.compile_executable_path.as_deref(),
            root_dir,
            env,
            windows: &ctx.bundler_options.windows,
            exec_argv: ctx
                .bundler_options
                .compile_exec_argv
                .as_deref()
                .unwrap_or(b""),
            flags: {
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
                // An executable compiled in place looks on the disk for a name that is put together at run time, as `bun run` does: by the package.json of the package.
                let runs_in_place = ctx
                    .bundler_options
                    .aot
                    .as_ref()
                    .is_some_and(|aot| aot.runs_in_place);
                if !ctx.bundler_options.compile_autoload_package_json && !runs_in_place {
                    flags |= Flags::DISABLE_AUTOLOAD_PACKAGE_JSON;
                }
                flags
            },
            runtime_options: RuntimeOptions {
                jit_policy: ctx.bundler_options.compile_jit_policy,
            },
            assets: &ctx.bundler_options.compile_assets,
            embeds_source_maps,
        },
        log,
    }
}

pub(super) fn output_location(
    target: &CompileTarget,
    outfile: &[u8],
    was_renamed_from_index: bool,
) -> OutputLocation {
    let mut output_dir: &[u8] = b"";
    if !outfile.is_empty() {
        output_dir = bun_core::dirname(outfile).unwrap_or(b".");
    }

    let root_path: &[u8] = output_dir;

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
                Global::exit(1);
            }
        }
    };

    let mut outfile = compile_outfile(outfile);

    let mut outfile_owned: Vec<u8>;
    if target.os == OperatingSystem::Windows && !strings::has_suffix_comptime(outfile, b".exe") {
        outfile_owned = Vec::new();
        write!(&mut outfile_owned, "{}.exe", bstr::BStr::new(outfile)).expect("unreachable");
        outfile = &outfile_owned;
    } else if was_renamed_from_index && outfile != b"index" {
        // A directory of that name would fail the write with EISDIR.
        let mut zbuf = bun_paths::path_buffer_pool::get();
        let n = outfile.len().min(zbuf.0.len() - 1);
        zbuf.0[..n].copy_from_slice(&outfile[..n]);
        zbuf.0[n] = 0;
        let z = bun_core::ZStr::from_buf(&zbuf.0[..], n);
        if bun_sys::directory_exists_at(root_dir.fd, z).unwrap_or(false) {
            outfile = b"index";
        }
    }

    OutputLocation {
        outfile: outfile.to_vec(),
        root_dir,
    }
}

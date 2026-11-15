use core::sync::atomic::Ordering;

use bun_aot::engine::has_compiler;
use bun_core::Global;
use bun_event_loop::AnyEventLoop;
use bun_options_types::aot_options::Preload;
use bun_options_types::bundle_enums::Format;
use bun_options_types::compile_target::CompileTarget;
use bun_options_types::schema::api;
use bun_sys::Fd;

use super::build::compile_to_executable;
use super::configuration::{self, request_from_context};
use super::printing::{exit_with_failure, print_outcome};
use super::reports::write_metafiles;
use super::{CompileCommand, CompileFailure, CompileOutcome, CompileProduct, RequestOrigin};
use crate::cli::build_command::{BuildCommand, has_only_html_entry_points};
use crate::cli::command::{Context, ContextData};
use crate::cli::compile_options;

impl CompileCommand {
    #[cold]
    #[inline(never)]
    pub(crate) fn exec(ctx: Context<'_>) -> Result<(), crate::Error> {
        run(ctx, RequestOrigin::BuildFlag)
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn exec_command(ctx: Context<'_>) -> Result<(), crate::Error> {
        configuration::use_installed_executable(ctx);
        if ctx.bundler_options.aot.is_none() || ctx.args.target == Some(api::Target::Browser) {
            configuration::use_default_entry_point(ctx);
            if ctx.bundler_options.aot.is_none()
                || has_only_html_entry_points(&ctx.args.entry_points)
            {
                ctx.bundler_options.aot = None;
                ctx.bundler_options.keeps_entry_points = true;
                configuration::load_script_as_code(ctx);
                return BuildCommand::exec(ctx, None);
            }
        }
        run(ctx, RequestOrigin::CompileCommand)
    }
}

fn run(ctx: Context<'_>, origin: RequestOrigin) -> Result<(), crate::Error> {
    Global::configure_allocator(Global::AllocatorConfiguration {
        long_running: true,
        ..Default::default()
    });
    ctx.args.target = Some(api::Target::Bun);
    compile_options::check_build_conflicts(&ctx, origin);
    compile_options::note_options_without_effect(&ctx);
    ctx.bundler_options.bytecode = false;
    ctx.bundler_options.output_format = Format::Esm;
    ctx.bundler_options.compile_target = CompileTarget::default();

    if !has_compiler() {
        exit_with_failure(
            ctx.log_ref(),
            origin,
            &ctx.bundler_options.compile_target,
            &CompileFailure::NoCompiler,
        );
    }
    configuration::use_default_entry_point(ctx);
    #[cfg(all(bun_fuzzilli, unix))]
    if crate::cli::fuzzilli_compile_loop::is_started_by_fuzzilli() {
        crate::cli::fuzzilli_compile_loop::compile_programs(ctx);
    }

    let configuration = configuration::configure(&mut *ctx)?;
    let location = configuration::output_location(
        &ctx.bundler_options.compile_target,
        &configuration.outfile,
        configuration.was_renamed_from_index,
    );
    let metafile_path = ctx.bundler_options.metafile.clone();
    let metafile_markdown_path = ctx.bundler_options.metafile_md.clone();
    let event_loop = AnyEventLoop::init();
    let mut request = request_from_context(
        ctx,
        configuration,
        &event_loop,
        CompileProduct::Executable {
            outfile: &location.outfile,
        },
        location.root_dir.fd,
        origin,
    );
    let result = compile_to_executable(&mut request).and_then(move |outcome| {
        write_metafiles(&outcome, &metafile_path, &metafile_markdown_path)?;
        Ok(outcome)
    });
    let finished = bun_core::time::nano_timestamp();
    // SAFETY: the log outlives the request, and the build, which writes to it, has ended.
    let log = unsafe { &mut *request.log };
    match result {
        Ok(outcome) => print_outcome(log, outcome, &location.outfile, finished),
        Err(failure) => exit_with_failure(log, request.origin, request.executable.target, &failure),
    }
}

fn preload_of(ctx: &ContextData) -> Option<&Preload> {
    if !bun_core::env::ENABLE_FUZZILLI {
        return None;
    }
    ctx.bundler_options.aot.as_deref()?.preload.as_ref()
}

// For a caller that wants no executable: run in place, `bun check --aot`. The outer `Err`: the transpiler could not be set up.
pub(crate) fn compile_from_context(
    ctx: Context<'_>,
    product: CompileProduct<'_>,
) -> Result<Result<CompileOutcome, CompileFailure>, crate::Error> {
    debug_assert!(!matches!(product, CompileProduct::Executable { .. }));
    Global::configure_allocator(Global::AllocatorConfiguration {
        long_running: true,
        ..Default::default()
    });
    ctx.args.target = Some(api::Target::Bun);
    // `on_loaded` writes the entry point's file, so nothing that reads an entry point may run before it.
    if let Some(preload) = preload_of(ctx)
        && !preload.is_loaded.swap(true, Ordering::Relaxed)
    {
        (preload.on_loaded)();
    }
    let configuration = configuration::configure(&mut *ctx)?;
    let event_loop = AnyEventLoop::init();
    let mut request = request_from_context(
        ctx,
        configuration,
        &event_loop,
        product,
        Fd::cwd(),
        RequestOrigin::BuildFlag,
    );
    Ok(compile_to_executable(&mut request))
}

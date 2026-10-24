use bun_aot::engine::has_compiler;
use bun_core::Global;
use bun_event_loop::AnyEventLoop;
use bun_options_types::schema::api;
use bun_sys::Fd;

use super::build::compile_to_executable;
use super::configuration::{self, request_from_context};
use super::printing::{exit_with_failure, print_outcome};
use super::reports::write_metafiles;
use super::{CompileCommand, CompileFailure, CompileOutcome, CompileProduct, RequestOrigin};
use crate::cli::build_command::BuildCommand;
use crate::cli::command::Context;

impl CompileCommand {
    #[cold]
    #[inline(never)]
    pub(crate) fn exec(ctx: Context<'_>) -> Result<(), crate::Error> {
        run(ctx, RequestOrigin::BuildFlag)
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn exec_command(ctx: Context<'_>) -> Result<(), crate::Error> {
        if ctx.bundler_options.aot.is_none() || ctx.args.target == Some(api::Target::Browser) {
            configuration::use_default_entry_point(ctx);
            ctx.bundler_options.aot = None;
            return BuildCommand::exec(ctx, None);
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

    if !has_compiler() {
        exit_with_failure(
            ctx.log_ref(),
            origin,
            &ctx.bundler_options.compile_target,
            &CompileFailure::NoCompiler,
        );
    }
    configuration::use_default_entry_point(ctx);

    let configuration = configuration::configure(&mut *ctx)?;
    let location = configuration::output_location(
        &ctx.bundler_options.compile_target,
        &configuration.outfile,
        configuration.was_renamed_from_index,
    );
    let metafile_path = ctx.bundler_options.metafile.clone();
    let metafile_markdown_path = ctx.bundler_options.metafile_md.clone();
    let mut event_loop = AnyEventLoop::init();
    let mut request = request_from_context(
        ctx,
        configuration,
        &mut event_loop,
        CompileProduct::Executable {
            outfile: &location.outfile,
        },
        location.root_dir.fd,
        origin,
    );
    let result = compile_to_executable(&mut request).and_then(|outcome| {
        write_metafiles(&outcome, &metafile_path, &metafile_markdown_path)?;
        Ok(outcome)
    });
    let finished = bun_core::time::nano_timestamp();
    match result {
        Ok(outcome) => print_outcome(request.log, outcome, &location.outfile, finished),
        Err(failure) => exit_with_failure(
            request.log,
            request.origin,
            request.executable.target,
            &failure,
        ),
    }
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
    let configuration = configuration::configure(&mut *ctx)?;
    let mut event_loop = AnyEventLoop::init();
    let mut request = request_from_context(
        ctx,
        configuration,
        &mut event_loop,
        product,
        Fd::cwd(),
        RequestOrigin::BuildFlag,
    );
    Ok(compile_to_executable(&mut request))
}

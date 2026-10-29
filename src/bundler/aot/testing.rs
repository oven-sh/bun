//! For tests of the front end that stop behind a stage of their own: what `build` hands `bun_aot::compile`.

use super::options::{OptionsInput, options_from_bundler};
use super::services::BundlerServices;
use crate::Transpiler;
use crate::bundle_v2::BundleV2;
use bun_alloc::Arena;
use bun_aot::engine::ExecutableIdentity;
use bun_aot::{Options, SourceProvider};
use bun_ast::Log;
use bun_dotenv::Loader;
use bun_options_types::aot_options::AotOptions;
use bun_options_types::schema::api;
use bun_resolver::fs::{DirnameStore, FileSystem};
use bun_sema_driver::Libs;
use core::ptr::NonNull;
use std::sync::OnceLock;

const MODULE_PREFIX: &[u8] = if cfg!(windows) {
    b"B:/~BUN/root/"
} else {
    b"/$bunfs/root/"
};

pub struct FrontEndInputs<'r> {
    /// Of the process from here on: builds that run side by side have the same one.
    pub working_directory: &'r [u8],
    pub entry_points: &'r [&'r [u8]],
    pub options: &'r AotOptions,
    pub typescript_libs: Libs<'r>,
}

/// What `main` does once in Bun, before there is a second thread.
fn set_up_process(directory: &'static [u8]) -> bool {
    static IS_SET_UP: OnceLock<bool> = OnceLock::new();
    *IS_SET_UP.get_or_init(|| {
        // `Transpiler::init` takes the first loader it is handed for the one of the process, which outlives every build.
        bun_dotenv::set_instance(bun_core::heap::into_raw(Box::new(Loader::init())));
        // The file system of the resolver is made once, with the folder of the first build.
        FileSystem::init(Some(directory)).is_ok()
    })
}

/// The options and the services of `bun build --compile --aot <entry points>` in that folder. `None`: the build ends before the
/// front end starts, and `log` says why.
pub fn with_front_end_inputs<R>(
    inputs: &FrontEndInputs<'_>,
    log: &mut Log,
    then: impl FnOnce(&Options<'_>, &dyn SourceProvider, &mut Log) -> R,
) -> Option<R> {
    // A build fills the loader it is handed, so each has its own, as in `Bun.build`.
    let mut environment = Loader::init();
    let mut event_loop = bun_event_loop::AnyEventLoop::default();
    let arena = Arena::new();
    let transform_options = crate::options::TransformOptions {
        absolute_working_dir: Some(Box::from(inputs.working_directory)),
        target: Some(api::Target::Bun),
        ..Default::default()
    };
    let directory = DirnameStore::instance().append_slice(inputs.working_directory);
    let directory = directory.ok()?;
    if !set_up_process(directory) {
        return None;
    }
    FileSystem::get().set_top_level_dir(directory);
    let environment = Some(&raw mut environment);
    let transpiler = Transpiler::init(&arena, &raw mut *log, transform_options, environment);
    let transpiler = arena.alloc(transpiler.ok()?);
    transpiler.options.compile_mode = crate::options::CompileMode::Executable;
    // As the command line has it without `--env`.
    transpiler.options.env.behavior = api::DotEnvBehavior::disable;
    transpiler.configure_defines().ok()?;
    transpiler.configure_linker();
    let input = OptionsInput {
        bundle_options: &transpiler.options,
        entry_points: inputs.entry_points,
        assets: &[],
        aot: inputs.options,
        executable_identity: ExecutableIdentity([0; 16]),
        image_form: None,
        module_prefix: MODULE_PREFIX,
        typescript_libs: inputs.typescript_libs,
        file_map: None,
        working_directory: crate::bun_fs::FileSystem::get().top_level_dir(),
        node_path: transpiler.env().get(b"NODE_PATH"),
    };
    let options = options_from_bundler(&input, log)?;
    transpiler.options.root_dir = Box::from(&options.paths.root_directory[..]);
    transpiler
        .resolver
        .opts
        .root_dir
        .clone_from(&transpiler.options.root_dir);
    let event_loop = Some(NonNull::from(&mut event_loop));
    let started = BundleV2::init_without_starting_threads(
        transpiler, None, &arena, event_loop, false, None, &arena,
    );
    let mut bundle = started.ok()?;
    let services = BundlerServices::new(NonNull::from(&mut *bundle).cast(), MODULE_PREFIX);
    let result = then(&options, &services, log);
    drop(services.shut_down());
    bundle.deinit_without_freeing_arena();
    bun_sema_driver::wake_idle_region_threads();
    drop(bundle);
    Some(result)
}

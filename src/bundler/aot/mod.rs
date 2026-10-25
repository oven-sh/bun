pub mod plugins;

mod assets;
mod data_loaders;
mod data_values;
mod defines;
mod macros;
mod metafile;
mod native_plugins;
mod options;
mod output;
mod page_bundles;
mod paths;
mod services;

use crate::bundle_v2::{BundleV2, FileMap, JSBundlerPlugin, dispatch};
use crate::{EventLoop, OutputFile, Transpiler};
use bun_aot::engine::{EngineResult, ExecutableIdentity, TargetImageForm};
use bun_aot::link::ProgramNames;
use bun_aot::module_list::ModuleList;
use bun_aot::report::SourceTexts;
use bun_aot::statistics::{Stage, Statistics};
use bun_aot::{BuildFailed, Compilation};
use bun_ast::{Loc, Log};
use bun_options_types::aot_options::AotOptions;
use bun_resolver::package_names::{BuildPaths, PackageName};
use bun_sema_driver::Libs;
use core::ptr::NonNull;
pub use metafile::{MetafileFiles, MetafileOutput, write_metafile, write_metafile_files};
pub use options::expand_entry_points;
use options::{OptionsInput, embedded_entry_point_names, options_from_bundler};
use services::BundlerServices;
pub use services::FileFinder;

pub struct PluginSetup {
    pub plugins: NonNull<JSBundlerPlugin>,
    pub context: bun_event_loop::ContextId,
    pub completion: dispatch::CompletionHandle,
}

pub struct AotBuildRequest<'r, 'a> {
    pub transpiler: &'a mut Transpiler<'a>,
    pub entry_points: &'r [&'r [u8]],
    pub assets: &'r [Box<[u8]>],
    pub options: &'r AotOptions,
    pub executable_identity: ExecutableIdentity,
    pub image_form: Option<TargetImageForm>,
    pub module_prefix: &'r [u8],
    pub log: &'r mut Log,
    pub arena: &'a bun_alloc::Arena,
    pub event_loop: EventLoop,
    pub worker_pool: Option<NonNull<bun_threading::ThreadPool>>,
    pub plugins: Option<PluginSetup>,
    pub file_map: Option<&'a FileMap>,
    pub typescript_libs: Libs<'r>,
}

pub struct AotEntryPoint {
    pub source_path: Vec<u8>,
    pub module_path: Vec<u8>,
}

pub struct AotBuild {
    pub output_files: Vec<OutputFile>,
    pub engine: EngineResult,
    /// `Compilation::further_programs`
    pub further_programs: Vec<EngineResult>,
    pub entry_points: Vec<AotEntryPoint>,
    pub root_directory: Vec<u8>,
    /// The names of packages that lead to entry points. The positions are those in `entry_points`.
    pub package_names: Vec<PackageName>,
    pub names: ProgramNames,
    pub texts: SourceTexts,
    pub statistics: Statistics,
    /// For a build that writes a metafile.
    pub modules: Option<ModuleList>,
}

pub struct AotBuildFailure {
    pub stage: Option<Stage>,
    pub is_internal_error: bool,
    pub statistics: Statistics,
    pub compilation: Option<Box<Compilation>>,
    pub refused_entry_points: Option<Vec<u32>>,
}

pub fn build(request: AotBuildRequest<'_, '_>) -> Result<AotBuild, AotBuildFailure> {
    let AotBuildRequest {
        transpiler,
        entry_points,
        assets,
        options: aot,
        executable_identity,
        image_form,
        module_prefix,
        log,
        arena,
        event_loop,
        worker_pool,
        plugins,
        file_map,
        typescript_libs,
    } = request;

    let input = OptionsInput {
        bundle_options: &transpiler.options,
        entry_points,
        assets,
        aot,
        executable_identity,
        image_form,
        module_prefix,
        typescript_libs,
        file_map,
        working_directory: transpiler.fs().top_level_dir(),
        node_path: transpiler.env().get(b"NODE_PATH"),
    };
    let Some(options) = options_from_bundler(&input, log) else {
        return Err(failure_before_pipeline(false));
    };
    // A program that runs in place has the paths of its files on disk, and no other names.
    let embedded_names = match aot.runs_in_place {
        true => Some(Vec::new()),
        false => embedded_entry_point_names(
            &transpiler.options,
            input.working_directory,
            &options.entry_points,
            &options.paths.root_directory,
            log,
        ),
    };
    let Some(embedded_names) = embedded_names else {
        return Err(failure_before_pipeline(false));
    };
    transpiler.options.root_dir = Box::from(&options.paths.root_directory[..]);
    transpiler
        .resolver
        .opts
        .root_dir
        .clone_from(&transpiler.options.root_dir);

    let started = BundleV2::init_without_starting_threads(
        transpiler,
        None,
        arena,
        event_loop,
        false,
        worker_pool,
        arena,
    );
    let mut bundle = match started {
        Ok(bundle) => bundle,
        Err(error) => {
            log.add_error_fmt(
                None,
                Loc::EMPTY,
                format_args!("{} while starting the build", error.name()),
            );
            return Err(failure_before_pipeline(true));
        }
    };
    bundle.file_map = file_map;
    if let Some(setup) = plugins {
        bundle.plugins = Some(setup.plugins);
        bundle.plugin_context = setup.context;
        bundle.completion = Some(setup.completion);
    }

    let services = BundlerServices::new(NonNull::from(&mut *bundle).cast(), module_prefix);
    let result = bun_aot::compile(&options, &services, log);

    let embedded = services.shut_down();
    let package_names = match &result {
        // A program that runs in place asks the disk, and one entry point is loaded by nobody.
        Ok(compilation) if !aot.runs_in_place && compilation.summary.entry_points.len() > 1 => {
            let summary = &compilation.summary;
            let paths = |source_path, public_path| BuildPaths {
                source_path,
                public_path,
            };
            let entry_points = summary.entry_points.iter();
            let entry_points: Vec<BuildPaths<'_>> = entry_points
                .map(|it| paths(&it.source_path, &it.public_path))
                .collect();
            let folders = summary.folders.iter();
            let folders: Vec<BuildPaths<'_>> = folders
                .map(|it| paths(&it.source_path, &it.public_path))
                .collect();
            bundle
                .transpiler
                .resolver
                .find_package_names(&entry_points, &folders)
        }
        Ok(_) | Err(_) => Vec::new(),
    };
    bundle.deinit_without_freeing_arena();
    bun_sema_driver::wake_idle_region_threads();
    drop(bundle);

    match result {
        Ok(compilation) => {
            let names = output::EntryPointNames {
                module_prefix,
                shown: &options.paths.entry_point_names,
                embedded: &embedded_names,
            };
            let mut build = output::finish_build(compilation, &names, embedded);
            build.package_names = package_names;
            build.root_directory = options.paths.root_directory;
            Ok(build)
        }
        Err(BuildFailed {
            stage,
            is_internal_error,
            statistics,
            compilation,
            refused_entry_points,
        }) => Err(AotBuildFailure {
            stage: Some(stage),
            is_internal_error,
            statistics,
            compilation,
            refused_entry_points,
        }),
    }
}

fn failure_before_pipeline(is_internal_error: bool) -> AotBuildFailure {
    AotBuildFailure {
        stage: None,
        is_internal_error,
        statistics: Statistics::default(),
        compilation: None,
        refused_entry_points: None,
    }
}

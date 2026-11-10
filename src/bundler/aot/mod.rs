pub mod plugins;

mod assets;
mod components;
mod css_modules;
mod data_loaders;
mod data_values;
mod defines;
mod metafile;
mod native_plugins;
mod options;
mod output;
mod page_bundles;
mod paths;
mod services;
#[cfg(feature = "test_support")]
pub mod testing;

use crate::bundle_v2::{BundleV2, FileMap, JSBundlerPlugin, dispatch};
use crate::{EventLoop, OutputFile, Transpiler};
use bun_aot::BuildFailed;
use bun_aot::engine::{EngineResult, ExecutableIdentity, TargetImageForm};
use bun_aot::module_list::ModuleList;
use bun_aot::report::SourceTexts;
use bun_aot::statistics::{Stage, Statistics};
use bun_ast::{Loc, Log};
use bun_options_types::aot_options::AotOptions;
use bun_paths::string_paths::without_trailing_slash_windows_path;
use bun_resolver::package_names::{
    BuildPaths, FurtherPackageName, PackageName, PathAlias, add_hidden_names, add_written_names,
};
use bun_sema_driver::Libs;
use core::ptr::NonNull;
pub use metafile::{MetafileFiles, MetafileOutput, write_metafile, write_metafile_files};
pub use options::expand_entry_points;
use options::{OptionsInput, options_from_bundler};
pub use paths::FileIdentity;
pub use services::FileFinder;
pub use services::FilesForFileSystem;
use services::{BundlerServices, NamesWanted, is_at_or_below};

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
    /// The absolute path of the executable that the build writes.
    pub outfile: Option<&'r [u8]>,
    /// `transpiler.log`. The resolver and the bundler write through that pointer while the build
    /// runs, so no reference to the log is held across a call that may reach them.
    pub log: *mut Log,
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
    /// `Compilation::root_folders_spelled`
    pub root_folders_spelled: Vec<u8>,
    /// `Compilation::levels_above_root`
    pub levels_above_root: usize,
    /// `Compilation::holds_source_paths`
    pub holds_source_paths: bool,
    pub names_plugin: bool,
    /// `Compilation::names_added_to_builtins`
    pub names_added_to_builtins: Vec<(u32, Vec<u8>)>,
    /// `Resolver::find_further_package_names`
    pub further_package_names: Vec<FurtherPackageName>,
    /// `CompiledProgram::refused_data`
    pub refused_data: Vec<u8>,
    pub files_for_file_system: FilesForFileSystem,
    /// `CompiledProgram::loaders_given_to_build`
    pub loaders_given_to_build: Vec<u8>,
    pub output_files: Vec<OutputFile>,
    pub engine: EngineResult,
    /// `Compilation::starts_workers_from_unseen_code`
    pub starts_workers_from_unseen_code: bool,
    pub entry_points: Vec<AotEntryPoint>,
    pub root_directory: Vec<u8>,
    /// The names of packages that lead to entry points. The positions are those in `entry_points`.
    pub package_names: Vec<PackageName>,
    /// "paths" and "baseUrl" of the tsconfig.json files of the program.
    pub path_aliases: Vec<PathAlias>,
    pub texts: SourceTexts,
    pub statistics: Statistics,
    /// For a build that writes a metafile.
    pub modules: Option<ModuleList>,
}

pub struct AotBuildFailure {
    pub stage: Option<Stage>,
    pub is_internal_error: bool,
    pub statistics: Statistics,
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
        outfile,
        log,
        arena,
        event_loop,
        worker_pool,
        plugins,
        file_map,
        typescript_libs,
    } = request;

    if let Some(outfile) = outfile {
        transpiler.resolver.pass_over_outfile(outfile);
    }
    let is_root_written = !transpiler.options.root_dir.is_empty();
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
        working_directory: crate::bun_fs::FileSystem::get().top_level_dir(),
        node_path: transpiler.env().get(b"NODE_PATH"),
    };
    // SAFETY: the log outlives the build, and nothing below this call reaches the transpiler.
    let Some(options) = options_from_bundler(&input, unsafe { &mut *log }) else {
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
            // SAFETY: the log outlives the build, and the reference ends with the statement.
            unsafe { &mut *log }.add_error_fmt(
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

    let working_directory = crate::bun_fs::FileSystem::get().top_level_dir();
    let working_directory = without_trailing_slash_windows_path(working_directory);
    let assets_by_absolute_paths = assets
        .iter()
        .map(|asset| {
            let path = paths::absolute_path(working_directory, asset);
            without_trailing_slash_windows_path(&path).to_vec()
        })
        .collect();
    // `options::root_directory` widens a root that nobody wrote to the assets below the working directory.
    let root_directory = &options.paths.root_directory[..];
    let is_root_widened = !is_root_written && is_at_or_below(root_directory, working_directory);
    let assets_root = match is_root_widened {
        true => working_directory.to_vec(),
        false => root_directory.to_vec(),
    };
    let services = BundlerServices::new(
        NonNull::from(&mut *bundle).cast(),
        module_prefix,
        &aot.user_defined_names,
        NamesWanted {
            runs_in_place: aot.runs_in_place,
            loads_code_from_disk: aot.loads_code_from_disk,
            root_directory: Box::from(&options.paths.root_directory[..]),
        },
    )
    .with_assets(assets_by_absolute_paths, assets_root);
    let mut said_by_compiler = Log::init();
    let result = bun_aot::compile(&options, &services, &mut said_by_compiler);
    // SAFETY: the log outlives the build, and the reference ends with the statement.
    said_by_compiler.append_to(unsafe { &mut *log });

    let levels_above_root = match &result {
        Ok(compilation) => compilation.levels_above_root,
        Err(_) => 0,
    };
    let refused_names = services.take_refused_names();
    let refused_data = services.take_refused_data();
    let files_for_file_system = services.take_files_for_file_system();
    let found_beside_engine = services.take_names_of_packages();
    let embedded = services.shut_down();
    let (package_names, path_aliases) = match &result {
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
            let written = compilation.names_of_worker_files.iter();
            let written: Vec<BuildPaths<'_>> = written
                .map(|it| paths(&it.source_path, &it.public_path))
                .collect();
            let names = found_beside_engine.of_entry_points_and_folders;
            let names = add_written_names(names, &written, &entry_points);
            (names, found_beside_engine.path_aliases)
        }
        Ok(_) | Err(_) => (Vec::new(), Vec::new()),
    };
    let package_names = match &result {
        Ok(_) if !aot.runs_in_place => {
            let names = add_hidden_names(package_names, found_beside_engine.nearer);
            add_hidden_names(names, found_beside_engine.that_lead_outside)
        }
        Ok(_) | Err(_) => package_names,
    };
    // A program that runs in place reads the package.json files itself.
    let package_names = match result.is_ok() && !aot.runs_in_place && !refused_names.is_empty() {
        true => {
            let root = BuildPaths {
                source_path: &options.paths.root_directory,
                public_path: module_prefix,
            };
            let resolver = &mut bundle.transpiler.resolver;
            add_hidden_names(
                package_names,
                resolver.find_hidden_names(&refused_names, root, levels_above_root),
            )
        }
        false => package_names,
    };
    let further_package_names = match &result {
        Ok(_) => found_beside_engine.further,
        Err(_) => Vec::new(),
    };
    let mut further_package_names = further_package_names;
    if let Ok(compilation) = &result {
        let followed = compilation.names_followed.iter();
        further_package_names.extend(followed.map(|name| FurtherPackageName {
            path: name.folder_and_name_as_written.clone(),
            required: name.public_path_for_require.clone(),
            imported: name.public_path_for_import.clone(),
            hides_other_paths: false,
        }));
        further_package_names.sort_by(|a, b| a.path.cmp(&b.path));
    }
    bundle.deinit_without_freeing_arena();
    bun_sema_driver::wake_idle_region_threads();
    drop(bundle);

    match result {
        Ok(compilation) => {
            let names = output::EntryPointNames {
                module_prefix,
                levels_above_root,
                shown: &options.paths.entry_point_names,
                embedded: &options.paths.entry_point_file_names,
            };
            let mut build = output::finish_build(compilation, &names, embedded);
            build.package_names = package_names;
            build.further_package_names = further_package_names;
            build.refused_data = refused_data;
            build.files_for_file_system = files_for_file_system;
            build.loaders_given_to_build =
                bun_aot::module_keys::encode_loaders_given_to_build(&options.load.loaders);
            build.path_aliases = path_aliases;
            build.root_directory = options.paths.root_directory;
            Ok(build)
        }
        Err(BuildFailed {
            stage,
            is_internal_error,
            statistics,
        }) => Err(AotBuildFailure {
            stage: Some(stage),
            is_internal_error,
            statistics,
        }),
    }
}

fn failure_before_pipeline(is_internal_error: bool) -> AotBuildFailure {
    AotBuildFailure {
        stage: None,
        is_internal_error,
        statistics: Statistics::default(),
    }
}

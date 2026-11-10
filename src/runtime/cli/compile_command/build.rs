use bun_aot::engine::{
    EngineModuleId, ExecutableIdentity, TargetImageForm, describe_difference_of_runtime,
    has_compiler, image_alignment, used_features,
};
use bun_aot::statistics::{log_part_outside_stages, log_time_outside_stages};
use bun_ast::Loader;
use bun_bundler::aot::{
    AotBuild, AotBuildFailure, AotBuildRequest, AotEntryPoint, FileIdentity, FilesForFileSystem,
};
use bun_bundler::options::{self, OutputFile};
use bun_core::{CodeGenerationFromStrings, ZBox};
use bun_exe_format::identity::{
    HostDescription, LeftOutOfBuild, RuntimeDescription, find_file_identity, find_process_identity,
    read_stamp_of_builtin_modules,
};
use bun_options_types::Format;
use bun_options_types::aot_options::AotOptions;
use bun_paths::resolve_path::{self, platform};
use bun_resolver::compiled_program::{
    PathForFileSystemAlone, encode_files_for_file_system_alone, folders_up_to,
};
use bun_sema::util::FxHashSet;
use bun_standalone_graph::StandaloneModuleGraph::{
    CompileResult, ExecutableRequest, Flags, GraphRequest, target_base_public_path, to_graph_bytes,
    write_executable,
};
use bun_standalone_graph::executable_request::ExecutableDetails;
use bun_standalone_graph::{
    CompiledEntryPointInput, CompiledPackageNameInput, CompiledPathAliasInput,
    CompiledProgramInput, with_executable_image,
};
use bun_sys::{Fd, FdExt};
use bun_trim::TrimPlan;

use super::{
    AssetError, BundlerInputs, CompileFailure, CompileOutcome, CompileProduct, CompileRequest,
    RequestOrigin, configuration, reports, trimming,
};
use crate::cli::build_command::{collect_compile_assets, to_embedded_name};

unsafe extern "C" {
    fn Bun__AOT__describeWhereThisThreadStopped(buffer: *mut u8, capacity: usize) -> usize;
    fn Bun__AOT__describeWhatThreadsAreCompiling(buffer: *mut u8, capacity: usize) -> usize;
}

struct ProductInputs<'p> {
    module_prefix: &'p [u8],
    outfile: Option<&'p [u8]>,
    plan: Option<&'p TrimPlan>,
    /// `BUN_DEBUG_TEST_UNTRIMMED_OUTFILE`, and what that executable leaves out.
    untrimmed: Option<(&'p [u8], Option<&'p TrimPlan>)>,
}

#[inline(never)]
pub(crate) fn compile_to_executable(
    request: &mut CompileRequest<'_, '_>,
) -> Result<CompileOutcome, CompileFailure> {
    if !has_compiler() {
        return Err(CompileFailure::NoCompiler);
    }
    log_time_outside_stages("before the build");
    let bundler = request.bundler.take().expect("one call per request");
    let target = check_request(request)?;
    // Code from disk finds what it imports as under `bun run`: by the package.json and tsconfig.json files that lie there.
    if request.options.loads_code_from_disk {
        let disabled = Flags::DISABLE_AUTOLOAD_PACKAGE_JSON | Flags::DISABLE_AUTOLOAD_TSCONFIG;
        request.executable.flags.remove(disabled);
    }
    let _reports_where_it_stops =
        bun_crash_handler::report_stopped_builds(bun_crash_handler::BuildDescribers {
            where_this_thread_stopped: Bun__AOT__describeWhereThisThreadStopped,
            what_threads_are_compiling: Bun__AOT__describeWhatThreadsAreCompiling,
        });
    bun_jsc::initialize(bun_jsc::InitializeOptions {
        is_compiler: true,
        ..Default::default()
    });

    let options = request.options;
    let module_prefix: &[u8] = if options.runs_in_place {
        b""
    } else {
        target_base_public_path(request.executable.target.os, b"root/")
    };
    let compiler_called_at = bun_core::time::nano_timestamp();
    let mut build = match build_program(request, bundler, target, module_prefix) {
        Ok(build) => build,
        Err(failure) => {
            return Err(CompileFailure::Build {
                files_checked: reports::count_modules(&failure.statistics),
            });
        }
    };
    log_part_outside_stages("behind the engine: end of the build");
    let mut used = used_features(&build.engine);
    // With =strict a Worker runs nothing but compiled code.
    used.starts_workers_from_unseen_code = build.starts_workers_from_unseen_code
        && options.code_generation_from_strings != CodeGenerationFromStrings::Strict;
    let trimming = trimming::decide_trimming(request, &used)?;
    let untrimmed_outfile = bun_core::env_var::BUN_DEBUG_TEST_UNTRIMMED_OUTFILE
        .get_not_empty()
        .filter(|_| options.trim.removes_unused);
    let untrimmed = match untrimmed_outfile {
        Some(outfile) => Some((outfile, trimming::plan_without_trim_flag(request, &used)?)),
        None => None,
    };
    log_part_outside_stages("behind the engine: used features, trimming");
    let mut outcome =
        reports::collect_reports(&build, options, &used, &trimming, compiler_called_at);
    log_part_outside_stages("behind the engine: reports");

    let outfile = match request.product {
        CompileProduct::ReportsOnly => None,
        CompileProduct::Executable { .. } if options.writes_no_executable => None,
        CompileProduct::GraphBytes => Some(None),
        #[cfg(unix)]
        CompileProduct::UnnamedFile => Some(None),
        CompileProduct::Executable { outfile } => Some(Some(outfile)),
    };
    if let Some(outfile) = outfile {
        if let Some(outfile) = outfile
            && request.origin == RequestOrigin::CompileCommand
        {
            let written = request.entry_points.iter().copied();
            let sources = build.entry_points.iter().map(|it| &it.source_path[..]);
            check_entry_points_are_kept(outfile, written, sources)?;
        }
        let product = ProductInputs {
            module_prefix,
            outfile,
            plan: trimming.plan(),
            untrimmed: (untrimmed.as_ref()).map(|(outfile, plan)| (*outfile, plan.as_ref())),
        };
        write_product(request, &mut build, product, &mut outcome)?;
        if outfile.is_some() {
            log_part_outside_stages("behind the engine: the file");
        }
        outcome.metafile = outfile.and_then(|outfile| reports::collect_metafile(&build, outfile));
        log_part_outside_stages("behind the engine: metafile");
    }
    drop(build);
    log_part_outside_stages("behind the engine: drop the build");
    log_time_outside_stages("behind the engine");
    Ok(outcome)
}

/// Letter case and `./` spell one place in several ways, so the files themselves are compared. The executable replaces what
/// is at `outfile`: a link to an entry point is another place, unless it is the entry point as it was `written`.
pub(crate) fn check_entry_points_are_kept<'a>(
    outfile: &[u8],
    mut written: impl Iterator<Item = &'a [u8]>,
    mut sources: impl Iterator<Item = &'a [u8]>,
) -> Result<(), CompileFailure> {
    let path = ZBox::from_bytes(outfile);
    let (Ok(place), Ok(target)) = (bun_sys::lstat(&path), bun_sys::stat(&path)) else {
        return Ok(());
    };
    let target_identity = identify(&target, || real_path(outfile));
    let source = sources.find(|path| {
        bun_sys::stat(&ZBox::from_bytes(path))
            .is_ok_and(|found| identify(&found, || real_path(path)).is_same_file(&target_identity))
    });
    let Some(source) = source else {
        return Ok(());
    };
    let is_overwritten = match bun_sys::S::ISLNK(place.st_mode as _) {
        // Of a file with several hard links, one is replaced and the others stay.
        false => target.st_nlink == 1 || real_path(outfile) == real_path(source),
        true => {
            let link = identify(&place, || real_path_of_link(outfile));
            written.any(|path| {
                bun_sys::lstat(&ZBox::from_bytes(path)).is_ok_and(|found| {
                    identify(&found, || real_path_of_link(path)).is_same_file(&link)
                })
            })
        }
    };
    match is_overwritten {
        true => Err(CompileFailure::OverwritesEntryPoint {
            outfile: outfile.to_vec(),
        }),
        false => Ok(()),
    }
}

fn identify(stat: &bun_sys::Stat, find_path: impl FnOnce() -> Option<Vec<u8>>) -> FileIdentity {
    FileIdentity::new(stat.st_dev as u64, stat.st_ino as u64, find_path)
}

/// The path of the link itself.
fn real_path_of_link(path: &[u8]) -> Option<Vec<u8>> {
    let folder = bun_paths::dirname(path).filter(|folder| !folder.is_empty());
    let folder = real_path(folder.unwrap_or(b"."))?;
    Some([&folder[..], b"/", bun_paths::basename(path)].concat())
}
fn real_path(path: &[u8]) -> Option<Vec<u8>> {
    let mut buffer = bun_paths::path_buffer_pool::get();
    let found = bun_sys::realpath(&ZBox::from_bytes(path), &mut buffer).ok()?;
    Some(found.to_vec())
}

#[allow(clippy::needless_pass_by_value)] // made for this call
fn write_product(
    request: &mut CompileRequest<'_, '_>,
    build: &mut AotBuild,
    product: ProductInputs<'_>,
    outcome: &mut CompileOutcome,
) -> Result<(), CompileFailure> {
    let options = request.options;
    let (assets_named_at_root, files_for_file_system_alone) = add_assets(
        request,
        product.outfile,
        &build.root_directory,
        &build.files_for_file_system,
        &mut build.output_files,
    )?;
    let mut entry_points = pair_entry_points(
        &build.entry_points,
        build.engine.entry_module_ids(),
        options.runs_in_place,
    )?;
    // In place a file that is embedded keeps the path of its source, which names the entry point already.
    if !options.runs_in_place {
        pair_embedded_copies(
            &mut entry_points,
            &build.entry_points,
            &mut build.output_files,
        )?;
    }
    let package_names: Vec<CompiledPackageNameInput<'_>> = build
        .package_names
        .iter()
        .map(|name| CompiledPackageNameInput {
            path: &name.public_path,
            required: name.required,
            imported: name.imported,
            hides_other_paths: name.hides_other_paths,
            is_hidden_from_require: name.is_hidden_from_require,
            is_hidden_from_import: name.is_hidden_from_import,
        })
        .collect();
    let path_aliases: Vec<CompiledPathAliasInput<'_>> = build
        .path_aliases
        .iter()
        .map(|alias| CompiledPathAliasInput {
            folder: &alias.folder,
            key: &alias.key,
            target: &alias.target,
            is_base_url: alias.is_base_url,
        })
        .collect();
    let knows_places = options.loads_code_from_disk && !options.runs_in_place;
    let root_below_working_directory = match knows_places {
        true => find_root_below_working_directory(&build.root_directory),
        false => None,
    };
    let root_from_executable = match &request.product {
        CompileProduct::Executable { outfile } if knows_places => {
            find_root_from_executable(&build.root_directory, outfile)
        }
        _ => None,
    };
    #[cfg(unix)]
    let writes_unnamed_file = matches!(request.product, CompileProduct::UnnamedFile);
    let settings = &mut request.executable;
    let (image, symbols) = build.engine.image_mut_and_symbols();
    let graph = GraphRequest {
        target: settings.target,
        output_files: &build.output_files,
        module_prefix: product.module_prefix,
        output_format: Format::Esm,
        exec_argv: settings.exec_argv,
        flags: settings.flags,
        runtime_options: settings.runtime_options,
        compiled_program: Some(CompiledProgramInput {
            image: image.ok_or_else(corrupted_program)?,
            image_alignment: image_alignment(),
            entry_points: &entry_points,
            package_names: &package_names,
            path_aliases: &path_aliases,
            root_below_working_directory: root_below_working_directory.as_deref(),
            root_from_executable: root_from_executable.as_deref(),
            // The program holds `__dirname` or the like, so it tells the folder itself, and asks for its own modules by paths below it.
            root_on_build_machine: (build.holds_source_paths && !options.runs_in_place)
                .then(|| trim_trailing_separators(&build.root_directory)),
            assets_named_at_root: &assets_named_at_root,
            refused_data: &build.refused_data,
            files_for_file_system_alone: &files_for_file_system_alone,
            loaders_given_to_build: &build.loaders_given_to_build,
            levels_above_root: build.levels_above_root as u32,
            further_package_names: &build.further_package_names,
            root_folders_spelled: match options.runs_in_place {
                true => b"",
                false => &build.root_folders_spelled,
            },
            allows_code_from_disk: options.loads_code_from_disk,
            names_plugin: build.names_plugin,
            preserves_source_paths: options.runs_in_place,
            symbols,
        }),
    };
    let Some(outfile) = product.outfile else {
        #[cfg(unix)]
        if writes_unnamed_file {
            use bun_standalone_graph::StandaloneModuleGraph::with_graph_slices;
            let write = crate::cli::run_compiled::write_program_or_exit;
            let written = with_graph_slices(&graph, write).map_err(CompileFailure::Graph)?;
            outcome.unnamed_file = Some(written);
        }
        #[cfg(unix)]
        let length_of_file = outcome.unnamed_file.map(|written| written.length);
        #[cfg(not(unix))]
        let length_of_file = None;
        let length = match length_of_file {
            Some(length) => length,
            None => {
                let bytes = to_graph_bytes(&graph).map_err(CompileFailure::Graph)?;
                outcome.graph_bytes.insert(bytes).len()
            }
        };
        log_part_outside_stages("behind the engine: the payload");
        if bun_core::env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
            bun_core::print_errorln!("AOT test build | program bytes {}", length);
        }
        return Ok(());
    };

    // What is asked of the file itself wants the file.
    let asks_for_this_bun_as_it_is = settings.target.is_this_bun()
        && settings.executable_path.is_none()
        && !options.trim.is_enabled()
        && product.untrimmed.is_none()
        && !options.obfuscates
        && !options.emits_symbols;
    if asks_for_this_bun_as_it_is && crate::cli::run_compiled::writes_program_alone() {
        let bytes = to_graph_bytes(&graph).map_err(CompileFailure::Graph)?;
        log_part_outside_stages("behind the engine: the payload");
        let (directory, path) = executable_location(settings.root_dir, outfile);
        let build_id = bun_exe_format::build_id::compute(&bytes);
        crate::cli::run_compiled::write_program_alone(directory, path, &bytes, &build_id).map_err(
            |error| CompileFailure::FileNotWritten {
                path: path.to_vec(),
                error,
            },
        )?;
        outcome.executable = Some(ExecutableDetails {
            size: bytes.len() as u64,
            build_id: Some(build_id),
            ..Default::default()
        });
        build.output_files.truncate(1);
        outcome.output_files = core::mem::take(&mut build.output_files);
        return Ok(());
    }

    // SAFETY: the loader outlives the request, and the build, which reads it, has ended.
    let env = unsafe { &mut *settings.env };
    let mut executable_request = ExecutableRequest {
        graph,
        root_dir: settings.root_dir,
        outfile,
        env,
        windows: settings.windows,
        executable_path: settings.executable_path,
        trim: product.plan,
        info_plist: settings.info_plist,
    };
    let written = write_executable(&mut executable_request).map_err(CompileFailure::Graph)?;
    if let CompileResult::Err(error) = written.result {
        return Err(CompileFailure::Executable(error));
    }
    if let Some((untrimmed_outfile, plan)) = product.untrimmed {
        executable_request.outfile = untrimmed_outfile;
        executable_request.trim = plan;
        let untrimmed = write_executable(&mut executable_request).map_err(CompileFailure::Graph)?;
        if let CompileResult::Err(error) = untrimmed.result {
            return Err(CompileFailure::Executable(error));
        }
    }
    if options.obfuscates {
        let (directory, path) = executable_location(settings.root_dir, outfile);
        let build_id = written.details.as_ref().and_then(|it| it.build_id.as_ref());
        reports::write_obfuscation_map(build, directory, path, build_id)?;
    }
    let mut details = written.details;
    // Nobody asked for what every executable leaves out, so the build says nothing about it.
    if !options.trim.is_enabled()
        && let Some(details) = &mut details
    {
        details.trim_summary = None;
    }
    if let Some(details) = &details
        && let Some(summary) = &details.trim_summary
    {
        let write_lines = match options.trim.logs {
            true => bun_trim::write_log_lines,
            false => bun_trim::write_warning_lines,
        };
        write_lines(summary, &mut outcome.trim_log_lines);
    }
    outcome.executable = details;
    // The main entry point's file stands for the executable among the artifacts.
    build.output_files.truncate(1);
    outcome.output_files = core::mem::take(&mut build.output_files);
    Ok(())
}

// `to_executable` resolves `outfile` in the working directory on Windows, and puts its last component in `root_dir` elsewhere.
pub(super) fn executable_location(root_dir: Fd, outfile: &[u8]) -> (Fd, &[u8]) {
    if cfg!(windows) {
        (Fd::cwd(), outfile)
    } else {
        (root_dir, bun_paths::basename(outfile))
    }
}

pub(super) fn corrupted_program() -> CompileFailure {
    CompileFailure::Graph(bun_standalone_graph::Error::CorruptedCompiledProgram)
}

#[derive(Copy, Clone)]
struct Target {
    identity: ExecutableIdentity,
    image_form: Option<TargetImageForm>,
    left_out: LeftOutOfBuild,
}

fn check_request(request: &CompileRequest<'_, '_>) -> Result<Target, CompileFailure> {
    if !has_compiler() {
        return Err(CompileFailure::NoCompiler);
    }
    if !request.executable.target.is_default() {
        return Err(CompileFailure::CrossCompilation);
    }
    if let CompileProduct::Executable { .. } = request.product {
        if let Some(path) = request.executable.executable_path {
            return check_template(path);
        }
    }
    find_process_identity()
        .map(|identity| Target {
            identity: ExecutableIdentity(identity),
            image_form: None,
            left_out: LeftOutOfBuild(Bun__AOT__whatThisBuildLeavesOut()),
        })
        .map_err(CompileFailure::NoIdentity)
}

struct Template {
    identity: [u8; 16],
    description: RuntimeDescription,
    stamp_of_builtin_modules: u32,
}

#[repr(C)]
struct BuiltinModulesHeader {
    magic: [u8; 8],
    version: u32,
    source_stamp: u32,
}

unsafe extern "C" {
    /// The header of the section with the modules, which nothing writes.
    safe static bun_internal_modules_header: BuiltinModulesHeader;
    safe fn Bun__AOT__whatThisBuildLeavesOut() -> u32;
}

const OFFSET_OF_IMAGE_FORM_IN_DESCRIPTION: usize = 26;

fn image_form_of(template: &Template) -> Option<TargetImageForm> {
    let engine = template.description.record(RuntimeDescription::ENGINE)?;
    match engine.get(OFFSET_OF_IMAGE_FORM_IN_DESCRIPTION)? {
        0 => Some(TargetImageForm::Absolute),
        1 => Some(TargetImageForm::PositionIndependent),
        _ => None,
    }
}

fn left_out_of(template: &Template) -> LeftOutOfBuild {
    let record = template.description.record(RuntimeDescription::LEFT_OUT);
    record.and_then(LeftOutOfBuild::read).unwrap_or_default()
}

fn check_template(path: &[u8]) -> Result<Target, CompileFailure> {
    let read = with_executable_image(&ZBox::from_bytes(path), |file| {
        Some(Template {
            identity: find_file_identity(file).ok()?,
            description: RuntimeDescription::read(file).ok()?,
            stamp_of_builtin_modules: read_stamp_of_builtin_modules(file).ok()?,
        })
    });
    let template = match read {
        Err(error) => return Err(CompileFailure::TemplateUnreadable { error }),
        Ok(None) => {
            return Err(CompileFailure::TemplateIsNotBun {
                path: path.to_vec(),
            });
        }
        Ok(Some(template)) => template,
    };
    match find_difference(&template) {
        Some(difference) => Err(CompileFailure::TemplateDiffers {
            path: path.to_vec(),
            difference,
        }),
        None => Ok(Target {
            identity: ExecutableIdentity(template.identity),
            image_form: image_form_of(&template),
            left_out: left_out_of(&template),
        }),
    }
}

fn find_difference(template: &Template) -> Option<Vec<u8>> {
    let unreadable = || Some(b"its description of the run time can't be read".to_vec());
    let Some(revision) = template
        .description
        .record(RuntimeDescription::HOST)
        .and_then(HostDescription::revision_in)
    else {
        return unreadable();
    };
    let own_revision = bun_core::env::GIT_SHA.as_bytes();
    if revision != own_revision {
        let mut sentence = b"it is revision ".to_vec();
        sentence.extend_from_slice(revision);
        sentence.extend_from_slice(b" of Bun and this is ");
        sentence.extend_from_slice(own_revision);
        return Some(sentence);
    }
    let own_stamp = bun_internal_modules_header.source_stamp;
    if template.stamp_of_builtin_modules != own_stamp {
        return Some(b"its built-in modules have another text".to_vec());
    }
    let Some(engine) = template.description.record(RuntimeDescription::ENGINE) else {
        return unreadable();
    };
    let Some(table) = template
        .description
        .record(RuntimeDescription::BUILTIN_TABLE)
    else {
        return unreadable();
    };
    describe_difference_of_runtime(engine).or_else(|| describe_difference_of_runtime(table))
}

fn build_program(
    request: &mut CompileRequest<'_, '_>,
    bundler: BundlerInputs<'_>,
    target: Target,
    module_prefix: &[u8],
) -> Result<AotBuild, Box<AotBuildFailure>> {
    let working_directory = bun_sys::getcwd_alloc().ok();
    let to_absolute = |path: &[u8]| {
        let folder = working_directory.as_ref()?.as_bytes();
        Some(resolve_path::join_abs_string::<platform::Auto>(folder, &[path]).to_vec())
    };
    let outfile = match request.product {
        CompileProduct::Executable { outfile } => to_absolute(outfile),
        _ => None,
    };
    let maps = outfile
        .iter()
        .flat_map(|outfile| [&b".map"[..], b".map.js"].map(|end| [&outfile[..], end].concat()));
    let metafiles = request.executable.metafiles.into_iter();
    let metafiles = metafiles.filter(|path| !path.is_empty());
    let options = AotOptions {
        omits_foreign_calls: !target.left_out.has_foreign_calls(),
        code_generation_from_strings: match target.left_out.has_code_from_strings() {
            true => request.options.code_generation_from_strings,
            false => CodeGenerationFromStrings::Strict,
        },
        other_products: maps.chain(metafiles.filter_map(to_absolute)).collect(),
        ..request.options.clone()
    };
    // Anything but an executable at that path is a file of the user's, which the program may name.
    let outfile = outfile.filter(|path| {
        let path = ZBox::from_bytes(path);
        with_executable_image(&path, |file| find_file_identity(file).is_ok()).unwrap_or(false)
    });
    let built = bun_bundler::aot::build(AotBuildRequest {
        transpiler: bundler.transpiler,
        entry_points: request.entry_points,
        assets: request.executable.assets,
        options: &options,
        executable_identity: target.identity,
        image_form: target.image_form,
        module_prefix,
        outfile: outfile.as_deref(),
        log: request.log,
        arena: bundler.arena,
        event_loop: bundler.event_loop,
        worker_pool: bundler.worker_pool,
        plugins: bundler.plugins,
        file_map: bundler.file_map,
        typescript_libs: bun_sema_driver::Libs::Bundled(crate::cli::typescript_libs::BUNDLED),
    });
    built.map_err(|failure| {
        // SAFETY: the log outlives the request, and the build, which writes to it, has ended.
        let log = unsafe { &mut *request.log };
        if !log.has_errors() {
            log.add_error_fmt(None, bun_ast::Loc::EMPTY, format_args!("the build failed"));
        }
        Box::new(failure)
    })
}

/// Returns `CompiledProgram::assets_named_at_root` and `CompiledProgram::files_for_file_system_alone`.
fn add_assets(
    request: &CompileRequest<'_, '_>,
    outfile: Option<&[u8]>,
    root_directory: &[u8],
    files_for_file_system: &FilesForFileSystem,
    output_files: &mut Vec<OutputFile>,
) -> Result<(Vec<u8>, Vec<u8>), CompileFailure> {
    let assets = request.executable.assets;
    if request.options.runs_in_place {
        let added = match assets {
            [] => Ok(()),
            assets => add_assets_in_place(assets, output_files),
        };
        return added
            .map(|()| (Vec::new(), Vec::new()))
            .map_err(CompileFailure::Assets);
    }
    let entry_name = outfile.map_or(&b""[..], configuration::compile_outfile);
    let named_at_root = match assets {
        [] => Vec::new(),
        assets => add_assets_under_root(assets, entry_name, root_directory, output_files)
            .map_err(CompileFailure::Assets)?,
    };
    let laid = add_data_files_under_root(
        files_for_file_system,
        entry_name,
        root_directory,
        output_files,
    );
    // SAFETY: the log outlives the request, and the build, which writes to it, has ended.
    let log = unsafe { &mut *request.log };
    warn_about_shared_asset_names(&named_at_root, output_files, log);
    emit_not_embedded_warnings(
        files_for_file_system,
        root_directory,
        &laid,
        output_files,
        log,
    );
    Ok((named_at_root, encode_files_for_file_system_alone(laid)))
}

/// `named_at_root` is `CompiledProgram::assets_named_at_root`: the executable tries its folders in that order, so the first one that holds a name hides the others.
fn warn_about_shared_asset_names(
    named_at_root: &[u8],
    output_files: &[OutputFile],
    log: &mut bun_ast::Log,
) {
    let mut paths_by_name: std::collections::BTreeMap<Vec<u8>, Vec<&[u8]>> = Default::default();
    let folders = bun_core::strings::split(named_at_root, b"\0");
    for folder in folders.filter(|it| !it.is_empty()) {
        for file in output_files {
            let path = bun_core::strings::remove_leading_dot_slash(&file.dest_path);
            if let Some(below @ [b'/', ..]) = path.strip_prefix(folder) {
                let name = [bun_paths::basename(folder), below].concat();
                paths_by_name.entry(name).or_default().push(path);
            }
        }
    }
    for (name, paths) in paths_by_name.iter().filter(|it| it.1.len() > 1) {
        let quoted: Vec<String> = paths
            .iter()
            .map(|path| bun_core::fmt::quote(path).to_string())
            .collect();
        log.add_warning_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "assets {} share the path {} in the executable. That path reads {}. Each asset is also at its own path",
                quoted.join(" and "),
                bun_core::fmt::quote(name),
                quoted[0],
            ),
        );
    }
}

fn emit_not_embedded_warnings(
    files_for_file_system: &FilesForFileSystem,
    root_directory: &[u8],
    laid: &[PathForFileSystemAlone],
    output_files: &[OutputFile],
    log: &mut bun_ast::Log,
) {
    let root = with_forward_slashes(trim_trailing_separators(root_directory));
    let laid = laid.iter().filter(|it| !it.is_folder);
    let laid = laid.map(|it| &it.path_below_root[..]);
    let is_file = |file: &&OutputFile| file.output_kind.is_file_in_standalone_mode();
    let with_text = output_files.iter().filter(is_file);
    let with_text = with_text.filter(|file| !has_no_text(file));
    let with_text = with_text.map(|it| bun_core::strings::remove_leading_dot_slash(&it.dest_path));
    let found: std::collections::BTreeSet<&[u8]> = laid.chain(with_text).collect();
    for (path, warning) in &files_for_file_system.warnings_if_not_embedded {
        let spelled = with_forward_slashes(path);
        if !found.contains(spelled.get(root.len() + 1..).unwrap_or_default()) {
            log.warnings += 1;
            log.add_msg(warning.clone());
        }
    }
}

fn with_forward_slashes(path: &[u8]) -> Vec<u8> {
    let slash = |byte: &u8| match *byte {
        b'\\' if cfg!(windows) => b'/',
        byte => byte,
    };
    path.iter().map(slash).collect()
}

fn holds_path_below(paths: &std::collections::BTreeSet<Vec<u8>>, folder: &[u8]) -> bool {
    let start = [folder, b"/"].concat();
    let mut from_start = paths.range(start.clone()..);
    from_start
        .next()
        .is_some_and(|path| path.starts_with(&start))
}

/// The files and the folders below `folder` on the disk of the build, by their paths from it. `None`: it cannot be listed, or holds what is neither.
fn list_below(folder: &[u8]) -> Option<(Vec<Vec<u8>>, Vec<Vec<u8>>)> {
    let directory = bun_sys::open_dir_for_iteration(Fd::cwd(), folder).ok()?;
    let _close = scopeguard::guard(directory, |descriptor| descriptor.close());
    let mut walker = bun_sys::walker_skippable::walk(directory, &[], &[]).ok()?;
    walker.resolve_unknown_entry_types = true;
    let (mut files, mut folders) = (Vec::new(), Vec::new());
    while let Some(entry) = walker.next().ok()? {
        #[cfg(windows)]
        let path = {
            let mut buffer = bun_paths::path_buffer_pool::get();
            let path = bun_paths::string_paths::from_w_path(&mut buffer[..], entry.path.as_slice());
            with_forward_slashes(path.as_bytes())
        };
        #[cfg(not(windows))]
        let path = entry.path.as_bytes().to_vec();
        match entry.kind {
            bun_sys::EntryKind::File => files.push(path),
            bun_sys::EntryKind::Directory => folders.push(path),
            _ => return None,
        }
    }
    Some((files, folders))
}

/// The same for what lies in `folder` itself.
fn list_in(folder: &[u8]) -> Option<(Vec<Vec<u8>>, Vec<Vec<u8>>)> {
    let directory = bun_sys::open_dir_for_iteration(Fd::cwd(), folder).ok()?;
    let _close = scopeguard::guard(directory, |descriptor| descriptor.close());
    let mut entries = bun_sys::dir_iterator::iterate(directory);
    let (mut files, mut folders) = (Vec::new(), Vec::new());
    while let Some(entry) = entries.next().ok()? {
        let name = entry.name.slice_u8().to_vec();
        match entry.kind {
            bun_sys::EntryKind::File => files.push(name),
            bun_sys::EntryKind::Directory => folders.push(name),
            _ => return None,
        }
    }
    Some((files, folders))
}

fn modified_at(path: &[u8]) -> Option<i64> {
    let stat = bun_sys::stat(&ZBox::from_bytes(path)).ok()?;
    #[cfg(not(windows))]
    let (seconds, nanoseconds) = (stat.st_mtime as i64, stat.st_mtime_nsec as i64);
    #[cfg(windows)]
    let (seconds, nanoseconds) = (stat.mtim.sec as i64, stat.mtim.nsec as i64);
    Some(seconds * 1000 + nanoseconds / 1_000_000)
}

/// What `require()` finds by a path made at run time, `node:fs` lists, stats and opens under the same path.
/// A listing is whole or it is what it was: a folder gets these files only if the executable then holds all that lay in it when the program was built;
/// for a folder that only they would bring into sight that goes for all that lay below the highest such folder.
fn add_data_files_under_root(
    files_for_file_system: &FilesForFileSystem,
    entry_name: &[u8],
    root_directory: &[u8],
    output_files: &mut Vec<OutputFile>,
) -> Vec<PathForFileSystemAlone> {
    type Paths = std::collections::BTreeSet<Vec<u8>>;
    let data_files = &files_for_file_system.data_found_by_patterns;
    if data_files.is_empty() {
        return Vec::new();
    }
    let root = with_forward_slashes(trim_trailing_separators(root_directory));
    let code = files_for_file_system.code_seen.iter();
    let code: Paths = code.map(|it| with_forward_slashes(it)).collect();
    let mut modules_without_text = modules_without_text(output_files);
    let taken: Paths = output_files
        .iter()
        .filter(|file| !has_no_text(file) && file.output_kind.is_file_in_standalone_mode())
        .map(|file| bun_core::strings::remove_leading_dot_slash(&file.dest_path).to_vec())
        .collect();
    let below_root = |path: &'_ [u8]| path.get(root.len() + 1..).unwrap_or_default().to_vec();
    let is_in_sight = |folder: &[u8]| {
        folder.len() == root.len()
            || holds_path_below(&code, folder)
            || holds_path_below(&taken, &below_root(folder))
    };
    let folder_of = |path: &'_ [u8]| path.len() - bun_paths::basename(path).len() - 1;
    // What an earlier build left where this one writes its executable is no file of the program.
    let outfile = bun_sys::getcwd_alloc().ok().map(|working_directory| {
        let folder = working_directory.as_bytes();
        with_forward_slashes(resolve_path::join_abs_string::<platform::Auto>(
            folder,
            &[entry_name],
        ))
    });
    let is_outfile = |path: &[u8]| {
        outfile.as_deref().is_some_and(|outfile| {
            path == outfile || (cfg!(windows) && path.strip_suffix(b".exe") == Some(outfile))
        })
    };
    // `bun run` refuses a `.json` file without a byte in it, and the build reads it as an empty object.
    let is_read_as_by_bun_run =
        |file: &OutputFile| file.size > 0 || !file.dest_path.ends_with(b".json");

    let mut data: std::collections::BTreeMap<Vec<u8>, OutputFile> = Default::default();
    for data_file in data_files {
        let spelled = with_forward_slashes(data_file);
        let is_below_root = spelled.starts_with(&root) && spelled.get(root.len()) == Some(&b'/');
        let under_root = path_from_root(root_directory, b"/", data_file);
        if !is_below_root || under_root.is_none_or(|it| it != below_root(&spelled)) {
            continue;
        }
        let mut files = Vec::new();
        if collect_compile_assets(core::slice::from_ref(data_file), b"", &mut files).is_err() {
            continue;
        }
        if let Some(file) = files.pop().filter(is_read_as_by_bun_run) {
            data.insert(spelled, file);
        }
    }

    let mut brought_into_sight: std::collections::BTreeMap<Vec<u8>, bool> = Default::default();
    let mut length_of_top: std::collections::BTreeMap<Vec<u8>, usize> = Default::default();
    for spelled in data.keys() {
        let mut highest_out_of_sight: Option<&[u8]> = None;
        let mut folder = &spelled[..folder_of(spelled)];
        while !is_in_sight(folder) {
            highest_out_of_sight = Some(folder);
            folder = &folder[..folder_of(folder)];
        }
        let Some(folder) = highest_out_of_sight else {
            continue;
        };
        length_of_top.insert(spelled.clone(), folder.len());
        if brought_into_sight.contains_key(folder) {
            continue;
        }
        let is_whole = list_below(folder).is_some_and(|(files, folders)| {
            let mut with_files: Paths = Paths::new();
            for file in &files {
                let mut inner = &file[..];
                while let Some(end) = bun_core::strings::last_index_of_char(inner, b'/') {
                    inner = &inner[..end];
                    if !with_files.insert(inner.to_vec()) {
                        break;
                    }
                }
            }
            let is_data = |file: &Vec<u8>| {
                let path = [folder, b"/", file].concat();
                data.contains_key(&path) || is_outfile(&path)
            };
            files.iter().all(is_data) && folders.iter().all(|inner| with_files.contains(inner))
        });
        brought_into_sight.insert(folder.to_vec(), is_whole);
    }
    let comes_into_sight = |folder: &[u8]| brought_into_sight.get(folder) == Some(&true);

    let mut is_held_whole: std::collections::BTreeMap<Vec<u8>, bool> = Default::default();
    let mut laid = Vec::new();
    let first_name =
        |path: &'_ [u8]| bun_core::strings::index_of_char_usize(path, b'/').unwrap_or(path.len());
    let spelled_paths: Vec<Vec<u8>> = data.keys().cloned().collect();
    for spelled in spelled_paths {
        let under_root = below_root(&spelled);
        if &under_root[..first_name(&under_root)] == bun_paths::basename(entry_name)
            || taken.contains(&under_root)
        {
            continue;
        }
        let folder = &spelled[..folder_of(&spelled)];
        let is_whole = match is_in_sight(folder) {
            true => *is_held_whole.entry(folder.to_vec()).or_insert_with(|| {
                list_in(folder).is_some_and(|(files, folders)| {
                    let whole_path = |name: &Vec<u8>| [folder, b"/", name].concat();
                    let is_held = |name: &Vec<u8>| {
                        let path = whole_path(name);
                        data.contains_key(&path)
                            || is_outfile(&path)
                            || code.contains(&path)
                            || taken.contains(&below_root(&path))
                    };
                    let is_seen = |name: &Vec<u8>| {
                        let path = whole_path(name);
                        is_in_sight(&path) || comes_into_sight(&path)
                    };
                    files.iter().all(is_held) && folders.iter().all(is_seen)
                })
            }),
            false => length_of_top
                .get(&spelled)
                .is_some_and(|&length| comes_into_sight(&spelled[..length])),
        };
        let (Some(mut file), true) = (data.remove(&spelled), is_whole) else {
            continue;
        };
        laid.push(PathForFileSystemAlone {
            path_below_root: under_root.clone(),
            modified_at: modified_at(&spelled).unwrap_or(0),
            is_folder: false,
        });
        file.dest_path = under_root.into_boxed_slice();
        add_asset(file, &mut modules_without_text, output_files);
    }
    let mut folders: Paths = Paths::new();
    for file in &laid {
        let spelled = [&root[..], b"/", &file.path_below_root].concat();
        let Some(&length) = length_of_top.get(&spelled) else {
            continue;
        };
        for folder in folders_up_to(&file.path_below_root, length - root.len() - 1) {
            if !folders.insert(folder.to_vec()) {
                break;
            }
        }
    }
    laid.extend(folders.into_iter().map(|folder| PathForFileSystemAlone {
        modified_at: modified_at(&[&root[..], b"/", &folder].concat()).unwrap_or(0),
        path_below_root: folder,
        is_folder: true,
    }));
    laid
}

/// The file of a compiled module is empty: `require()` and `import()` find the code.
fn has_no_text(file: &OutputFile) -> bool {
    file.size == 0 && file.output_kind.is_file_in_standalone_mode()
}

type ModulesWithoutText = std::collections::BTreeMap<Box<[u8]>, usize>;

fn modules_without_text(output_files: &[OutputFile]) -> ModulesWithoutText {
    output_files
        .iter()
        .enumerate()
        .filter(|(_, file)| has_no_text(file))
        .map(|(index, file)| {
            let path = bun_core::strings::remove_leading_dot_slash(&file.dest_path);
            (path.into(), index)
        })
        .collect()
}

/// An asset at the path of a compiled module gives the module's file its bytes, which `node:fs` and `Bun.file()` read, and its loader: the bytes are stored as they are, not as text that the executable runs.
fn add_asset(
    asset: OutputFile,
    modules_without_text: &mut ModulesWithoutText,
    output_files: &mut Vec<OutputFile>,
) -> usize {
    match modules_without_text.remove(&asset.dest_path) {
        Some(index) => {
            let module = &mut output_files[index];
            module.loader = asset.loader;
            module.size = asset.size;
            module.size_without_sourcemap = asset.size_without_sourcemap;
            module.value = asset.value;
            index
        }
        None => {
            output_files.push(asset);
            output_files.len() - 1
        }
    }
}

fn add_assets_under_root(
    assets: &[Box<[u8]>],
    entry_name: &[u8],
    root_directory: &[u8],
    output_files: &mut Vec<OutputFile>,
) -> Result<Vec<u8>, AssetError> {
    let working_directory =
        bun_sys::getcwd_alloc().map_err(AssetError::WorkingDirectoryUnreadable)?;
    let mut modules_without_text = modules_without_text(output_files);
    let mut paths_of_files_given: Vec<Box<[u8]>> = Vec::new();
    let mut outside_folders: Vec<Box<[u8]>> = Vec::new();
    let mut taken: std::collections::BTreeMap<Box<[u8]>, Option<usize>> = output_files
        .iter()
        .enumerate()
        .filter(|(_, file)| !has_no_text(file) && file.output_kind.is_file_in_standalone_mode())
        .map(|(index, file)| {
            (
                bun_core::strings::remove_leading_dot_slash(&file.dest_path).into(),
                Some(index),
            )
        })
        .collect();
    for asset in assets {
        let mut files = Vec::new();
        collect_compile_assets(core::slice::from_ref(asset), b"", &mut files)
            .map_err(AssetError::NotCollected)?;

        let asset_path = trim_trailing_separators(asset);
        let asset_name = to_embedded_name(bun_paths::basename(asset_path));
        let from_root = path_from_root(root_directory, working_directory.as_bytes(), asset_path);
        let embedded_path = from_root.as_deref().unwrap_or(&asset_name);
        let first_name_length = bun_core::strings::index_of_char_usize(embedded_path, b'/')
            .unwrap_or(embedded_path.len());
        if &embedded_path[..first_name_length] == bun_paths::basename(entry_name) {
            return Err(AssetError::EmbedsAtEntryPoint {
                asset: asset.clone(),
            });
        }
        // A folder outside the root directory was embedded under its base name before it kept its path.
        let folder_given = from_root.as_deref().map(|it| graph_path(it, b""));
        let is_folder = !files.is_empty()
            && files
                .iter()
                .all(|file| file.dest_path[..] != asset_name[..]);
        if let Some(folder) = folder_given.filter(|it| is_folder && it.starts_with(b"../")) {
            outside_folders.push(folder.into_boxed_slice());
        }
        for mut file in files {
            let is_file_given = file.dest_path[..] == asset_name[..];
            if let Some(from_root) = &from_root {
                let path_in_asset = file
                    .dest_path
                    .strip_prefix(&asset_name[..])
                    .expect("collect_compile_assets names files under the asset's name");
                file.dest_path = graph_path(from_root, path_in_asset).into_boxed_slice();
            }
            if is_file_given {
                paths_of_files_given.push(file.dest_path.clone());
            }
            let Some(earlier) = taken.insert(file.dest_path.clone(), None) else {
                add_asset(file, &mut modules_without_text, output_files);
                continue;
            };
            // A native addon that a module has embedded stands at the path of its source already.
            let is_same_file = earlier
                .is_some_and(|index| output_files[index].value.as_slice() == file.value.as_slice());
            if !is_same_file {
                return Err(AssetError::Collides {
                    asset: asset.clone(),
                    path: file.dest_path,
                });
            }
        }
    }
    Ok(find_assets_named_at_root(
        &paths_of_files_given,
        &outside_folders,
        output_files,
    ))
}

/// Folders may share a base name: the executable tries each.
fn find_assets_named_at_root(
    paths_of_files_given: &[Box<[u8]>],
    outside_folders: &[Box<[u8]>],
    output_files: &[OutputFile],
) -> Vec<u8> {
    let is_taken = |base_name: &[u8]| {
        output_files
            .iter()
            .filter(|file| file.output_kind.is_file_in_standalone_mode())
            .filter_map(|file| {
                bun_core::strings::remove_leading_dot_slash(&file.dest_path).strip_prefix(base_name)
            })
            .any(|rest| matches!(rest, [] | [b'/', ..]))
    };
    let is_shared = |base_name: &[u8]| {
        let base_names = paths_of_files_given
            .iter()
            .map(|path| bun_paths::basename(path));
        base_names.filter(|&name| name == base_name).count() > 1
    };
    let files = paths_of_files_given.iter().filter(|path| {
        let base_name = bun_paths::basename(path);
        !is_shared(base_name) && !is_taken(base_name)
    });
    let folders = outside_folders
        .iter()
        .filter(|path| !is_taken(bun_paths::basename(path)));
    files
        .chain(folders)
        .flat_map(|path| path.iter().copied().chain([0]))
        .collect()
}

/// `None` if no relative path leads there, as on another Windows drive.
fn path_from_root(
    root_directory: &[u8],
    working_directory: &[u8],
    asset_path: &[u8],
) -> Option<Vec<u8>> {
    let written_path = join_file_path(working_directory, asset_path);
    let written_folder = bun_paths::dirname(&written_path)?;
    let mut real_path_buffer = bun_paths::path_buffer_pool::get();
    let real_folder =
        bun_sys::realpath(&ZBox::from_bytes(written_folder), &mut real_path_buffer).ok();

    let root_directory = trim_trailing_separators(root_directory);
    let folders_below_root = |folder: &'_ [u8]| match folder.strip_prefix(root_directory)? {
        [] => Some(Vec::new()),
        [b'/' | b'\\', folders @ ..] => Some([folders, b"/"].concat()),
        _ => None,
    };
    let folders_above_root = |folder: &'_ [u8]| {
        let relative = relative_file_path(root_directory, folder);
        relative
            .starts_with(b"..")
            .then(|| [&relative[..], b"/"].concat())
    };
    let folders = real_folder
        .and_then(folders_below_root)
        .or_else(|| folders_below_root(written_folder))
        .or_else(|| folders_above_root(real_folder.unwrap_or(written_folder)))?;
    Some([&folders[..], bun_paths::basename(&written_path)].concat())
}

fn split_file_path(path: &[u8]) -> impl Iterator<Item = &[u8]> {
    bun_core::strings::split(path, b"/").filter(|name| !name.is_empty() && *name != b".")
}

/// `path.resolve(folder, path)`. `resolve_path` takes a backslash for a separator on every host; off Windows it is part of a file's name.
fn join_file_path(folder: &[u8], path: &[u8]) -> Vec<u8> {
    if cfg!(windows) {
        return resolve_path::join_abs_string::<platform::Auto>(folder, &[path]).to_vec();
    }
    let folder = split_file_path(folder).filter(|_| !path.starts_with(b"/"));
    let mut names: Vec<&[u8]> = Vec::new();
    for name in folder.chain(split_file_path(path)) {
        match name {
            b".." => drop(names.pop()),
            _ => names.push(name),
        }
    }
    [b"/", &names.join(&b"/"[..])[..]].concat()
}

/// `path.relative(from, to)` of two absolute paths, by the same rule.
fn relative_file_path(from: &[u8], to: &[u8]) -> Vec<u8> {
    if cfg!(windows) {
        return resolve_path::relative(from, to).to_vec();
    }
    let from: Vec<&[u8]> = split_file_path(from).collect();
    let to: Vec<&[u8]> = split_file_path(to).collect();
    let shared = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let up = core::iter::repeat_n(&b".."[..], from.len() - shared);
    let names: Vec<&[u8]> = up.chain(to[shared..].iter().copied()).collect();
    names.join(&b"/"[..])
}

fn add_assets_in_place(
    assets: &[Box<[u8]>],
    output_files: &mut Vec<OutputFile>,
) -> Result<(), AssetError> {
    let working_directory =
        bun_sys::getcwd_alloc().map_err(AssetError::WorkingDirectoryUnreadable)?;
    let mut real_path_buffer = bun_paths::path_buffer_pool::get();
    // What a module has embedded stands at the path of its source already.
    let embedded: std::collections::BTreeSet<Box<[u8]>> = output_files
        .iter()
        .filter(|file| file.size > 0)
        .map(|file| file.dest_path.clone())
        .collect();
    let mut modules_without_text = modules_without_text(output_files);
    let mut added: std::collections::BTreeMap<Box<[u8]>, usize> = Default::default();
    for asset in assets {
        let mut files = Vec::new();
        collect_compile_assets(core::slice::from_ref(asset), b"", &mut files)
            .map_err(AssetError::NotCollected)?;

        let asset_path = trim_trailing_separators(asset);
        let asset_name = to_embedded_name(bun_paths::basename(asset_path));
        let written_path = resolve_path::join_abs_string::<platform::Auto>(
            working_directory.as_bytes(),
            &[asset_path],
        )
        .to_vec();
        let real_path = bun_sys::realpath(&ZBox::from_bytes(&written_path), &mut real_path_buffer)
            .map_err(|error| AssetError::Unreadable {
                asset: asset.clone(),
                error,
            })?;

        for mut file in files {
            let path_in_asset = file
                .dest_path
                .strip_prefix(&asset_name[..])
                .expect("collect_compile_assets names files under the asset's name");
            let written_dest = graph_path(&written_path, path_in_asset);
            if embedded.contains(&written_dest[..]) {
                continue;
            }
            let at_real_path = (real_path != written_path.as_slice()).then(|| {
                let real_dest = graph_path(real_path, path_in_asset);
                asset_output_file(real_dest, file.value.as_slice().to_vec())
            });
            file.dest_path = written_dest.into_boxed_slice();
            for file in at_real_path.into_iter().chain([file]) {
                let Some(&earlier) = added.get(&file.dest_path) else {
                    let path = file.dest_path.clone();
                    added.insert(
                        path,
                        add_asset(file, &mut modules_without_text, output_files),
                    );
                    continue;
                };
                if output_files[earlier].value.as_slice() != file.value.as_slice() {
                    return Err(AssetError::Collides {
                        asset: asset.clone(),
                        path: file.dest_path,
                    });
                }
            }
        }
    }
    Ok(())
}

pub(super) fn trim_trailing_separators(mut path: &[u8]) -> &[u8] {
    while let [rest @ .., b'/' | b'\\'] = path {
        path = rest;
    }
    path
}

pub(super) fn graph_path(asset_path: &[u8], path_in_asset: &[u8]) -> Vec<u8> {
    let mut path = to_embedded_name(&[asset_path, path_in_asset].concat());
    resolve_path::platform_to_posix_in_place(&mut path[..]);
    path
}

pub(super) fn asset_output_file(dest: Vec<u8>, bytes: Vec<u8>) -> OutputFile {
    OutputFile {
        loader: Loader::File,
        input_loader: Loader::File,
        output_kind: options::OutputKind::Asset,
        dest_path: dest.into_boxed_slice(),
        size: bytes.len(),
        size_without_sourcemap: bytes.len(),
        value: options::OutputFileValue::Buffer {
            bytes: bytes.into_boxed_slice(),
        },
        side: Some(options::Side::Client),
        ..OutputFile::zero_value()
    }
}

/// Where the root directory of the build lies, seen from the working directory: below it, the same folder, or above it.
/// An executable that is shipped tells nobody the folders of the machine that built it, so a root that lies elsewhere is not written down.
fn find_root_below_working_directory(root_directory: &[u8]) -> Option<Vec<u8>> {
    let working_directory = bun_sys::getcwd_alloc().ok()?;
    let root = resolve_path::relative(
        working_directory.as_bytes(),
        trim_trailing_separators(root_directory),
    );
    let mut names = root.split(|&byte| bun_paths::is_sep_native(byte));
    let goes_up = names.next() == Some(b"..");
    (!goes_up || names.all(|name| name == b"..")).then(|| root.to_vec())
}

/// Where the root directory lies, seen from the folder of the executable: the folders of an installed program keep their places. Nothing is recorded
/// where the two have no folder in common but the root of the disk, or where the way there names more than two folders: that tells where the program was built.
fn find_root_from_executable(root_directory: &[u8], outfile: &[u8]) -> Option<Vec<u8>> {
    let working_directory = bun_sys::getcwd_alloc().ok()?;
    let outfile =
        resolve_path::join_abs_string::<platform::Auto>(working_directory.as_bytes(), &[outfile]);
    let folder = resolve_path::dirname::<platform::Auto>(outfile);
    let root = resolve_path::relative(folder, trim_trailing_separators(root_directory));
    if bun_paths::is_absolute(root) {
        return None;
    }
    let is_sep = |&byte: &u8| bun_paths::is_sep_native(byte);
    let ups = root.split(is_sep).take_while(|name| *name == b"..").count();
    let names = root.split(is_sep).filter(|name| !name.is_empty()).count() - ups;
    let depth = folder.split(is_sep).filter(|name| !name.is_empty()).count();
    (ups < depth && names <= 2).then(|| root.to_vec())
}

pub(super) fn pair_entry_points<'b>(
    entry_points: &'b [AotEntryPoint],
    module_ids: &[EngineModuleId],
    runs_in_place: bool,
) -> Result<Vec<CompiledEntryPointInput<'b>>, CompileFailure> {
    if entry_points.len() != module_ids.len() {
        return Err(corrupted_program());
    }
    let pairs = entry_points.iter().zip(module_ids);
    Ok(pairs
        .map(|(entry_point, &module_id)| CompiledEntryPointInput {
            module_id,
            // An executable that is shipped tells nobody the folders of the machine that built it.
            source_path: match runs_in_place {
                true => &entry_point.source_path,
                false => &entry_point.module_path,
            },
            module_path: &entry_point.module_path,
        })
        .collect())
}

/// A file can be an entry point and be embedded with the `file` loader as well. Whoever starts the embedded copy by its
/// path, as a Worker does, gets the compiled program.
pub(super) fn pair_embedded_copies<'b>(
    pairs: &mut Vec<CompiledEntryPointInput<'b>>,
    entry_points: &[AotEntryPoint],
    output_files: &mut [OutputFile],
) -> Result<(), CompileFailure> {
    // Of the files with one path the executable holds the first, and a pair needs a file.
    let mut paths: FxHashSet<Vec<u8>> = FxHashSet::default();
    for copy in output_files.iter_mut() {
        let path = bun_core::strings::remove_leading_dot_slash(&copy.dest_path);
        let is_first = paths.insert(path.to_vec());
        let is_held = matches!(copy.value, options::OutputFileValue::Buffer { .. });
        let is_copy =
            copy.entry_point_index.is_none() && copy.output_kind == options::OutputKind::Asset;
        if !is_first || !is_held || !is_copy {
            continue;
        }
        let is_source = |entry_point: &AotEntryPoint| entry_point.is_source_of(copy, cfg!(windows));
        let Some(position) = entry_points.iter().position(is_source) else {
            continue;
        };
        let compiled = pairs.get(position).ok_or_else(corrupted_program)?;
        let pair = CompiledEntryPointInput {
            module_id: compiled.module_id,
            source_path: compiled.source_path,
            module_path: compiled.module_path,
        };
        copy.entry_point_index = Some(u32::try_from(pairs.len()).map_err(|_| corrupted_program())?);
        pairs.push(pair);
    }
    Ok(())
}

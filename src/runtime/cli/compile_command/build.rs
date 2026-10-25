use std::time::Instant;

use bun_aot::engine::{
    EngineModuleId, EngineResult, ExecutableIdentity, TargetImageForm,
    describe_difference_of_runtime, has_compiler, image_alignment, used_features,
};
use bun_ast::Loader;
use bun_bundler::aot::{AotBuild, AotBuildFailure, AotBuildRequest, AotEntryPoint};
use bun_bundler::options::{self, OutputFile};
use bun_core::{ZBox, fmt as bun_fmt};
use bun_exe_format::identity::{
    HostDescription, RuntimeDescription, find_file_identity, find_process_identity,
    read_stamp_of_builtin_modules,
};
use bun_options_types::Format;
use bun_paths::resolve_path::{self, platform};
use bun_sema::util::FxHashSet;
use bun_standalone_graph::StandaloneModuleGraph::{
    CompileResult, ExecutableRequest, Flags, GraphRequest, target_base_public_path, to_graph_bytes,
    write_executable,
};
use bun_standalone_graph::{
    CompiledEntryPointInput, CompiledPackageNameInput, CompiledProgramInput, with_executable_image,
};
use bun_sys::Fd;
use bun_trim::{Feature, TrimPlan, UnseenCode, UsedFeature, UsedFeatures, UsedLocales};

use super::{
    BundlerInputs, CompileFailure, CompileOutcome, CompileProduct, CompileRequest, configuration,
    reports, trimming,
};
use crate::cli::build_command::collect_compile_assets;

unsafe extern "C" {
    fn Bun__AOT__describeWhereThisThreadStopped(buffer: *mut u8, capacity: usize) -> usize;
    fn Bun__AOT__describeWhatThreadsAreCompiling(buffer: *mut u8, capacity: usize) -> usize;
}

struct ProductInputs<'p> {
    module_prefix: &'p [u8],
    outfile: Option<&'p [u8]>,
    plan: Option<&'p TrimPlan>,
}

#[inline(never)]
pub(crate) fn compile_to_executable(
    request: &mut CompileRequest<'_, '_>,
) -> Result<CompileOutcome, CompileFailure> {
    if !has_compiler() {
        return Err(CompileFailure::NoCompiler);
    }
    let bundler = request.bundler.take().expect("one call per request");
    let target = check_request(request)?;
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
    let mut build = match build_program(request, bundler, target, module_prefix) {
        Ok(build) => build,
        Err(failure) => {
            reports::write_failed_build_report(options, &failure, request.log);
            return Err(CompileFailure::Build {
                files_checked: reports::count_modules(&failure.statistics),
                refused_entry_points: failure.refused_entry_points,
            });
        }
    };
    let mut used = used_features(&build.engine);
    for program in &build.further_programs {
        add_used_features(&mut used, used_features(program));
    }
    if (used.features.iter()).any(|used| used.feature == Feature::SystemCaCertificates) {
        request.executable.flags |= Flags::NAMES_SYSTEM_CA_CERTIFICATES;
    }
    let trimming = trimming::decide_trimming(request, &used)?;
    let mut outcome = reports::collect_reports(&build, options, &used, &trimming);

    let outfile = match request.product {
        CompileProduct::ReportsOnly => None,
        CompileProduct::GraphBytes => Some(None),
        CompileProduct::Executable { outfile } => Some(Some(outfile)),
    };
    let written = outfile.map_or(Ok(()), |outfile| {
        let product = ProductInputs {
            module_prefix,
            outfile,
            plan: trimming.plan(),
        };
        write_product(request, &mut build, product, &mut outcome)?;
        outcome.metafile = outfile.and_then(|outfile| reports::collect_metafile(&build, outfile));
        Ok(())
    });
    // The report names the executable, so it comes last. A build that could not write one still reports.
    reports::write_build_report(&build, options, &used, &trimming, &outcome)?;
    written?;
    Ok(outcome)
}

#[allow(clippy::needless_pass_by_value)] // made for this call
fn write_product(
    request: &mut CompileRequest<'_, '_>,
    build: &mut AotBuild,
    product: ProductInputs<'_>,
    outcome: &mut CompileOutcome,
) -> Result<(), CompileFailure> {
    let started = Instant::now();
    let options = request.options;
    add_assets(
        request,
        product.outfile,
        &build.root_directory,
        &mut build.output_files,
    )?;
    // A program behind the first begins at one entry point. The first holds all the others.
    let first_module_id = |program: &EngineResult| program.entry_module_ids().first().copied();
    let count_of_first = (build.entry_points.len())
        .checked_sub(build.further_programs.len())
        .ok_or_else(corrupted_program)?;
    let ids_of_first = build.engine.entry_module_ids();
    let ids_of_first = match build.further_programs.len() {
        0 => Some(ids_of_first),
        _ => ids_of_first.get(..count_of_first),
    };
    let mut module_ids: Vec<EngineModuleId> = ids_of_first.ok_or_else(corrupted_program)?.to_vec();
    for program in &build.further_programs {
        module_ids.push(first_module_id(program).ok_or_else(corrupted_program)?);
    }
    let mut entry_points =
        pair_entry_points(&build.entry_points, &module_ids, options.runs_in_place)?;
    for (index, entry_point) in (1..).zip(entry_points.iter_mut().skip(count_of_first)) {
        entry_point.image_index = index;
    }
    // In place a file that is embedded keeps the path of its source, which names the entry point already.
    if !options.runs_in_place {
        pair_embedded_copies(
            &mut entry_points,
            &build.entry_points,
            &mut build.output_files,
        )?;
    }
    let further_images: Vec<&[u8]> = build
        .further_programs
        .iter()
        .map(|program| program.image().ok_or_else(corrupted_program))
        .collect::<Result<_, _>>()?;
    let package_names: Vec<CompiledPackageNameInput<'_>> = build
        .package_names
        .iter()
        .map(|name| CompiledPackageNameInput {
            path: &name.public_path,
            required: name.required,
            imported: name.imported,
            hides_other_paths: name.hides_other_paths,
        })
        .collect();
    let settings = &mut request.executable;
    let graph = GraphRequest {
        target: settings.target,
        output_files: &build.output_files,
        module_prefix: product.module_prefix,
        output_format: Format::Esm,
        exec_argv: settings.exec_argv,
        flags: settings.flags,
        runtime_options: settings.runtime_options,
        compiled_program: Some(CompiledProgramInput {
            image: build.engine.image().ok_or_else(corrupted_program)?,
            further_images: &further_images,
            image_alignment: image_alignment(),
            entry_points: &entry_points,
            package_names: &package_names,
            preserves_source_paths: options.runs_in_place,
            symbols: build.engine.symbols(),
        }),
    };
    let Some(outfile) = product.outfile else {
        outcome.graph_bytes = Some(to_graph_bytes(&graph).map_err(CompileFailure::Graph)?);
        outcome.executable_time = started.elapsed();
        return Ok(());
    };

    let mut executable_request = ExecutableRequest {
        graph,
        root_dir: settings.root_dir,
        outfile,
        env: &mut *settings.env,
        windows: settings.windows,
        executable_path: settings.executable_path,
        trim: product.plan,
    };
    let written = write_executable(&mut executable_request).map_err(CompileFailure::Graph)?;
    if let CompileResult::Err(error) = written.result {
        return Err(CompileFailure::Executable(error));
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
    outcome.executable_time = started.elapsed();
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
    static bun_internal_modules_header: BuiltinModulesHeader;
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
    // SAFETY: the header of the section with the modules, which nothing writes.
    let own_stamp = unsafe { bun_internal_modules_header.source_stamp };
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
    let built = bun_bundler::aot::build(AotBuildRequest {
        transpiler: bundler.transpiler,
        entry_points: request.entry_points,
        assets: request.executable.assets,
        options: request.options,
        executable_identity: target.identity,
        image_form: target.image_form,
        module_prefix,
        log: &mut *request.log,
        arena: bundler.arena,
        event_loop: bundler.event_loop,
        worker_pool: bundler.worker_pool,
        plugins: bundler.plugins,
        file_map: bundler.file_map,
        typescript_libs: bun_sema_driver::Libs::Bundled(crate::cli::typescript_libs::BUNDLED),
    });
    built.map_err(|failure| {
        if !request.log.has_errors() {
            request
                .log
                .add_error_fmt(None, bun_ast::Loc::EMPTY, format_args!("the build failed"));
        }
        Box::new(failure)
    })
}

fn add_assets(
    request: &CompileRequest<'_, '_>,
    outfile: Option<&[u8]>,
    root_directory: &[u8],
    output_files: &mut Vec<OutputFile>,
) -> Result<(), CompileFailure> {
    let assets = request.executable.assets;
    if assets.is_empty() {
        return Ok(());
    }
    let added = if request.options.runs_in_place {
        add_assets_in_place(assets, output_files)
    } else {
        let entry_name = outfile.map_or(&b""[..], configuration::compile_outfile);
        add_assets_under_root(assets, entry_name, root_directory, output_files)
    };
    added.map_err(CompileFailure::Assets)
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
) {
    match modules_without_text.remove(&asset.dest_path) {
        Some(index) => {
            let module = &mut output_files[index];
            module.loader = asset.loader;
            module.size = asset.size;
            module.size_without_sourcemap = asset.size_without_sourcemap;
            module.value = asset.value;
        }
        None => output_files.push(asset),
    }
}

fn add_assets_under_root(
    assets: &[Box<[u8]>],
    entry_name: &[u8],
    root_directory: &[u8],
    output_files: &mut Vec<OutputFile>,
) -> Result<(), String> {
    let working_directory = bun_sys::getcwd_alloc()
        .map_err(|error| format!("failed to read the working directory: {error}"))?;
    let mut modules_without_text = modules_without_text(output_files);
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
        collect_compile_assets(core::slice::from_ref(asset), b"", &mut files)?;

        let asset_path = trim_trailing_separators(asset);
        let asset_name = bun_paths::basename(asset_path);
        let under_root = path_under_root(root_directory, working_directory.as_bytes(), asset_path);
        let embedded_path = under_root.as_deref().unwrap_or(asset_name);
        let first_name_length = bun_core::strings::index_of_char_usize(embedded_path, b'/')
            .unwrap_or(embedded_path.len());
        if &embedded_path[..first_name_length] == bun_paths::basename(entry_name) {
            return Err(format!(
                "asset {} would embed at the same path as the entry point; use a different outfile",
                bun_fmt::quote(asset),
            ));
        }
        for mut file in files {
            if let Some(under_root) = &under_root {
                let path_in_asset = file
                    .dest_path
                    .strip_prefix(asset_name)
                    .expect("collect_compile_assets names files under the asset's name");
                file.dest_path = graph_path(under_root, path_in_asset).into_boxed_slice();
            }
            let Some(earlier) = taken.insert(file.dest_path.clone(), None) else {
                add_asset(file, &mut modules_without_text, output_files);
                continue;
            };
            // A native addon that a module has embedded stands at the path of its source already.
            let is_same_file = earlier
                .is_some_and(|index| output_files[index].value.as_slice() == file.value.as_slice());
            if !is_same_file {
                return Err(format!(
                    "asset {} collides with another embedded file at {}",
                    bun_fmt::quote(asset),
                    bun_fmt::quote(&file.dest_path),
                ));
            }
        }
    }
    Ok(())
}

fn path_under_root(
    root_directory: &[u8],
    working_directory: &[u8],
    asset_path: &[u8],
) -> Option<Vec<u8>> {
    let written_path =
        resolve_path::join_abs_string::<platform::Auto>(working_directory, &[asset_path]).to_vec();
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
    let folders = real_folder
        .and_then(folders_below_root)
        .or_else(|| folders_below_root(written_folder))?;
    Some([&folders[..], bun_paths::basename(&written_path)].concat())
}

fn add_assets_in_place(
    assets: &[Box<[u8]>],
    output_files: &mut Vec<OutputFile>,
) -> Result<(), String> {
    let working_directory = bun_sys::getcwd_alloc()
        .map_err(|error| format!("failed to read the working directory: {error}"))?;
    let mut real_path_buffer = bun_paths::path_buffer_pool::get();
    // What a module has embedded stands at the path of its source already.
    let embedded: std::collections::BTreeSet<Box<[u8]>> = output_files
        .iter()
        .filter(|file| file.size > 0)
        .map(|file| file.dest_path.clone())
        .collect();
    let mut modules_without_text = modules_without_text(output_files);
    for asset in assets {
        let mut files = Vec::new();
        collect_compile_assets(core::slice::from_ref(asset), b"", &mut files)?;

        let asset_path = trim_trailing_separators(asset);
        let asset_name = bun_paths::basename(asset_path);
        let written_path = resolve_path::join_abs_string::<platform::Auto>(
            working_directory.as_bytes(),
            &[asset_path],
        )
        .to_vec();
        let real_path = bun_sys::realpath(&ZBox::from_bytes(&written_path), &mut real_path_buffer)
            .map_err(|error| format!("failed to read asset {}: {error}", bun_fmt::quote(asset)))?;

        for mut file in files {
            let path_in_asset = file
                .dest_path
                .strip_prefix(asset_name)
                .expect("collect_compile_assets names files under the asset's name");
            let written_dest = graph_path(&written_path, path_in_asset);
            if embedded.contains(&written_dest[..]) {
                continue;
            }
            if real_path != written_path.as_slice() {
                let real_dest = graph_path(real_path, path_in_asset);
                let at_real_path = asset_output_file(real_dest, file.value.as_slice().to_vec());
                add_asset(at_real_path, &mut modules_without_text, output_files);
            }
            file.dest_path = written_dest.into_boxed_slice();
            add_asset(file, &mut modules_without_text, output_files);
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
    let mut path = [asset_path, path_in_asset].concat();
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
            image_index: 0,
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
            image_index: compiled.image_index,
        };
        copy.entry_point_index = Some(u32::try_from(pairs.len()).map_err(|_| corrupted_program())?);
        pairs.push(pair);
    }
    Ok(())
}

/// The run time holds what any program of the executable uses. A witness is a position in the records of the first program.
fn add_used_features(used: &mut UsedFeatures, further: UsedFeatures) {
    for feature in further.features {
        if !(used.features.iter()).any(|known| known.feature == feature.feature) {
            used.features.push(UsedFeature {
                feature: feature.feature,
                witness: None,
            });
        }
    }
    used.causes
        .extend(further.causes.into_iter().map(|unseen| UnseenCode {
            cause: unseen.cause,
            witness: None,
        }));
    match (&mut used.locales, further.locales) {
        (UsedLocales::Unknown(_), _) => {}
        (locales, UsedLocales::Unknown(_)) => *locales = UsedLocales::Unknown(None),
        (UsedLocales::Listed(listed), UsedLocales::Listed(more)) => {
            listed.extend(more);
            listed.sort_unstable();
            listed.dedup();
        }
    }
}

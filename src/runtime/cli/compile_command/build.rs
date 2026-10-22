use std::time::Instant;

use bun_aot::engine::{
    EngineModuleId, ExecutableIdentity, has_compiler, image_alignment, used_features,
};
use bun_ast::Loader;
use bun_bundler::aot::{AotBuild, AotBuildFailure, AotBuildRequest, AotEntryPoint};
use bun_bundler::options::{self, OutputFile};
use bun_core::{ZBox, fmt as bun_fmt};
use bun_exe_format::identity::{find_file_identity, find_process_identity};
use bun_options_types::Format;
use bun_paths::resolve_path::{self, platform};
use bun_standalone_graph::StandaloneModuleGraph::{
    CompileResult, ExecutableRequest, GraphRequest, target_base_public_path, to_graph_bytes,
    write_executable,
};
use bun_standalone_graph::{
    CompiledEntryPointInput, CompiledPackageNameInput, CompiledProgramInput, with_executable_image,
};
use bun_sys::Fd;
use bun_trim::TrimPlan;

use super::failure::log_payload_reference;
use super::{
    BundlerInputs, CompileFailure, CompileOutcome, CompileProduct, CompileRequest, configuration,
    reports, trimming,
};
use crate::cli::build_command::collect_compile_assets;

struct ProductInputs<'p> {
    module_prefix: &'p [u8],
    outfile: Option<&'p [u8]>,
    plan: Option<&'p TrimPlan>,
}

#[inline(never)]
pub(crate) fn compile_to_executable(
    request: &mut CompileRequest<'_, '_>,
) -> Result<CompileOutcome, CompileFailure> {
    let bundler = request.bundler.take().expect("one call per request");
    let identity = check_request(request)?;
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
    let mut build = match build_program(request, bundler, identity, module_prefix) {
        Ok(build) => build,
        Err(failure) => {
            reports::write_failed_build_report(options, &failure, request.log);
            return Err(CompileFailure::Build {
                files_checked: reports::count_modules(&failure.statistics),
                refused_entry_points: failure.refused_entry_points,
            });
        }
    };
    let used = used_features(&build.engine);
    let trimming = trimming::decide_trimming(request, &used)?;
    let mut outcome = reports::collect_reports(&build, options, &used, &trimming);

    let outfile = match request.product {
        CompileProduct::ReportsOnly => None,
        CompileProduct::GraphBytesIfSourceCannotRun if !build.validates_by_type => None,
        CompileProduct::GraphBytes | CompileProduct::GraphBytesIfSourceCannotRun => Some(None),
        CompileProduct::Executable { outfile } => Some(Some(outfile)),
    };
    let written = outfile.map_or(Ok(()), |outfile| {
        let product = ProductInputs {
            module_prefix,
            outfile,
            plan: trimming.plan(),
        };
        write_product(request, &mut build, product, &mut outcome)
    });
    // The report names the executable, so it comes last. A build that could not write one still reports.
    reports::write_build_report(&build, options, &used, &trimming, &outcome)?;
    written?;
    Ok(outcome)
}

fn write_product(
    request: &mut CompileRequest<'_, '_>,
    build: &mut AotBuild,
    product: ProductInputs<'_>,
    outcome: &mut CompileOutcome,
) -> Result<(), CompileFailure> {
    let started = Instant::now();
    let options = request.options;
    add_assets(request, product.outfile, &mut build.output_files)?;
    let module_ids = build.engine.entry_module_ids();
    let entry_points = pair_entry_points(&build.entry_points, module_ids, options.runs_in_place)?;
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
    if let Some(error) = written
        .details
        .as_ref()
        .and_then(|it| it.payload_reference_error)
    {
        let (directory, path) = executable_location(settings.root_dir, outfile);
        let _ = bun_sys::unlinkat(directory, &ZBox::from_bytes(path));
        log_payload_reference(request.log, error);
        return Err(CompileFailure::Build {
            refused_entry_points: None,
            files_checked: 0,
        });
    }
    if options.obfuscates {
        let (directory, path) = executable_location(settings.root_dir, outfile);
        reports::write_obfuscation_map(build, directory, path)?;
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

fn check_request(request: &CompileRequest<'_, '_>) -> Result<ExecutableIdentity, CompileFailure> {
    if !has_compiler() {
        return Err(CompileFailure::NoCompiler);
    }
    if !request.executable.target.is_default() {
        return Err(CompileFailure::CrossCompilation);
    }
    let identity = ExecutableIdentity(find_process_identity().map_err(CompileFailure::NoIdentity)?);
    if let CompileProduct::Executable { .. } = request.product {
        if let Some(path) = request.executable.executable_path {
            check_template(path, identity)?;
        }
    }
    Ok(identity)
}

fn check_template(path: &[u8], identity: ExecutableIdentity) -> Result<(), CompileFailure> {
    match with_executable_image(&ZBox::from_bytes(path), find_file_identity) {
        Err(error) => Err(CompileFailure::TemplateUnreadable { error }),
        Ok(Err(_)) => Err(CompileFailure::TemplateIsNotBun {
            path: path.to_vec(),
        }),
        Ok(Ok(found)) if ExecutableIdentity(found) != identity => {
            Err(CompileFailure::TemplateIsAnotherBuild {
                path: path.to_vec(),
            })
        }
        Ok(Ok(_)) => Ok(()),
    }
}

fn build_program(
    request: &mut CompileRequest<'_, '_>,
    bundler: BundlerInputs<'_>,
    identity: ExecutableIdentity,
    module_prefix: &[u8],
) -> Result<AotBuild, Box<AotBuildFailure>> {
    let built = bun_bundler::aot::build(AotBuildRequest {
        transpiler: bundler.transpiler,
        entry_points: request.entry_points,
        options: request.options,
        executable_identity: identity,
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
        add_assets_under_root(assets, entry_name, output_files)
    };
    added.map_err(CompileFailure::Assets)
}

/// The file of a compiled module is empty: `require()` and `import()` find the code.
fn has_no_text(file: &OutputFile) -> bool {
    file.size == 0 && file.output_kind.is_file_in_standalone_mode()
}

type ModulesWithoutText = std::collections::HashMap<Box<[u8]>, usize>;

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

/// An asset at the path of a compiled module gives the module's file its bytes, which `node:fs` and `Bun.file()` read, and its
/// loader: the bytes are stored as they are, not as text that the executable runs.
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
    output_files: &mut Vec<OutputFile>,
) -> Result<(), String> {
    let mut modules_without_text = modules_without_text(output_files);
    let mut others: Vec<OutputFile> = output_files
        .iter()
        .filter(|file| !has_no_text(file))
        .map(|file| OutputFile {
            dest_path: file.dest_path.clone(),
            output_kind: file.output_kind,
            ..OutputFile::zero_value()
        })
        .collect();
    let number_of_others = others.len();
    collect_compile_assets(assets, entry_name, &mut others)?;
    for asset in others.drain(number_of_others..) {
        add_asset(asset, &mut modules_without_text, output_files);
    }
    Ok(())
}

fn add_assets_in_place(
    assets: &[Box<[u8]>],
    output_files: &mut Vec<OutputFile>,
) -> Result<(), String> {
    let working_directory = bun_sys::getcwd_alloc()
        .map_err(|error| format!("failed to read the working directory: {error}"))?;
    let mut real_path_buffer = bun_paths::path_buffer_pool::get();
    // What a module has embedded stands at the path of its source already.
    let embedded: std::collections::HashSet<Box<[u8]>> = output_files
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
        })
        .collect())
}

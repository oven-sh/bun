use std::collections::BTreeMap;

use bun_aot::diagnostic_codes::Code;
use bun_aot::diagnostics::log_diagnostic;
use bun_aot::engine::{ExecutableIdentity, TargetImageForm};
use bun_aot::options::{Externals, LoadOptions, Options, PathOptions, RemovableOptions};
use bun_ast::{Loc, Log};
use bun_core::strings;
use bun_glob::{BunGlobWalker, detect_glob_syntax, walk};
use bun_options_types::aot_options::AotOptions;
use bun_paths::MAX_PATH_BYTES;
use bun_paths::resolve_path;
use bun_paths::string_paths::without_trailing_slash_windows_path;
use bun_sema::resolve::{CodeOptions, JsxRuntime, JsxSettings};
use bun_sema_driver::Libs;
use bun_sema_driver::host::{from_argument, from_native, to_native};

use super::paths::{absolute_path, relative_path, report_long_path};
use crate::bun_fs::PathName;
use crate::bundle_v2::FileMap;
use crate::options::{
    AllowUnresolved, BundleOptions, DEFAULT_WILDCARD_PATTERNS, Format, PackagesOption,
    PathTemplate, PlaceholderField, Target, jsx,
};

pub(crate) struct OptionsInput<'r, 'i, 'a> {
    pub bundle_options: &'i BundleOptions<'a>,
    pub entry_points: &'i [&'i [u8]],
    pub assets: &'i [Box<[u8]>],
    pub aot: &'r AotOptions,
    pub executable_identity: ExecutableIdentity,
    pub image_form: Option<TargetImageForm>,
    pub module_prefix: &'i [u8],
    pub typescript_libs: Libs<'r>,
    pub file_map: Option<&'i FileMap>,
    pub working_directory: &'i [u8],
    pub node_path: Option<&'i [u8]>,
}

pub(crate) fn options_from_bundler<'r>(
    input: &OptionsInput<'r, '_, '_>,
    log: &mut Log,
) -> Option<Options<'r>> {
    let is_supported = report_unsupported_options(input.bundle_options, log);
    let entry_points = expand_entry_points(
        input.entry_points,
        input.working_directory,
        input.file_map,
        log,
    );
    let entry_points = entry_points.map(|list| follow_links(input, list));
    let paths = (entry_points.as_ref()).and_then(|list| path_options(input, list, log));
    let (true, Some(entry_points), Some(paths)) = (is_supported, entry_points, paths) else {
        return None;
    };
    Some(Options {
        aot: input.aot,
        executable_identity: input.executable_identity,
        image_form: input.image_form,
        entry_points,
        code: code_options(input),
        typescript_libs: input.typescript_libs,
        load: load_options(input),
        paths,
        removable: RemovableOptions {
            ignores_pure_annotations: input.bundle_options.ignore_dce_annotations,
            jsx_has_side_effects: input.bundle_options.jsx.side_effects,
            minifies_syntax: input.bundle_options.minify_syntax,
        },
        lists_modules: input.bundle_options.metafile,
        // An obfuscated executable shows no name, and its source map has the names as they are written.
        minifies_identifiers: input.bundle_options.minify_identifiers
            && !input.bundle_options.keep_names
            && !input.aot.obfuscates,
    })
}

#[rustfmt::skip]
fn report_unsupported_options(options: &BundleOptions<'_>, log: &mut Log) -> bool {
    // Every field is named: a new bundler option must not compile until it is classified here.
    let BundleOptions {
        banner, footer, output_format, target, bytecode, transform_only,
        server_components, allow_unresolved, macro_remap, inject, framework, dev_server,
        hot_module_reloading, ignore_module_resolution_errors, disable_transpilation, repl_mode,
        react_compiler_parse_test_pragmas,
        loaders: _, jsx: _, react_compiler: _, root_dir: _, preserve_symlinks: _,
        tsconfig_override: _, main_fields: _, transform_options: _, external: _, packages: _,
        extension_order: _, main_field_extension_order: _, no_macros: _, custom_conditions: _,
        entry_naming: _, compile_entry_point_name: _, force_node_env: _,
        emit_decorator_metadata: _, experimental_decorators: _, use_define_for_class_fields: _,
        define: _, drop: _, bundler_feature_flags: _, asset_naming: _,
        auto_import_jsx: _, allow_runtime: _,
        trim_unused_imports: _, ignore_dce_annotations: _, public_path: _, chunk_naming: _,
        source_map: _, minify_whitespace: _, minify_syntax: _, is_library: _, minify_identifiers: _,
        keep_names: _, css_chunking: _, code_splitting: _, split_require: _, min_chunk_size: _,
        fold_chunks: _, module_preload: _, react_fast_refresh: _, emit_dce_annotations: _,
        tree_shaking: _, tree_shaking_override: _, dead_code_elimination: _, inlining: _,
        optimize_imports: _, out_extensions: _, compile_mode: _, production: _, env: _,
        log: _, origin: _, output_dir: _, output_dir_handle: _, write: _, preserve_extensions: _,
        entry_points: _, import_path_format: _, defines_loaded: _, mark_builtins_as_external: _,
        polyfill_node_globals: _, load_tsconfig_json: _, load_package_json: _, conditions: _,
        extra_cjs_extensions: _, global_cache: _, install_preference: _, install: _,
        inline_entrypoint_import_meta_main: _, type_check: _,
        deprecated_namespace_object_setters: _, bytecode_depth: _, optimize_bytecode: _,
        bytecode_order: _, compile_target_builtins: _, metafile: _, metafile_json_path: _,
        metafile_markdown_path: _, serve_plugins: _, bunfig_path: _, unwrap_commonjs_packages: _,
        supports_multiple_outputs: _, rewrite_jest_for_tests: _, code_coverage: _, debugger: _,
    } = options;

    let is_development_server = framework.is_some() || !dev_server.is_null() || *hot_module_reloading;
    let is_other_command = *ignore_module_resolution_errors || *disable_transpilation || *repl_mode;
    let unsupported = [
        has_code(banner).then_some("--banner with code"),
        has_code(footer).then_some("--footer with code"),
        format_argument(*output_format),
        target_argument(*target),
        bytecode.then_some("--bytecode"),
        transform_only.then_some("--no-bundle"),
        server_components.then_some("--server-components"),
        (!matches!(allow_unresolved, AllowUnresolved::All)).then_some("--allow-unresolved"),
        (!macro_remap.is_empty()).then_some("the \"macros\" map of bunfig.toml"),
        inject.as_ref().is_some_and(|list| !list.is_empty()).then_some("inject"),
        react_compiler_parse_test_pragmas.then_some("reactCompilerParseTestPragmas"),
        is_development_server.then_some("a development server"),
        is_other_command.then_some("this command"),
    ];

    let mut reported: Vec<&str> = Vec::new();
    for argument in unsupported.into_iter().flatten() {
        if !reported.contains(&argument) {
            log_diagnostic(log, Code::UnsupportedOption, &[argument.as_bytes()]);
            reported.push(argument);
        }
    }
    reported.is_empty()
}

fn format_argument(format: Format) -> Option<&'static str> {
    match format {
        Format::Esm => None,
        Format::Cjs => Some("--format=cjs"),
        Format::Iife => Some("--format=iife"),
        Format::InternalBakeDev => Some("a development server"),
    }
}

fn target_argument(target: Target) -> Option<&'static str> {
    match target {
        Target::Bun => None,
        Target::Browser => Some("--target=browser"),
        Target::Node => Some("--target=node"),
        Target::BunMacro | Target::ServerComponentsSsr => Some("this target"),
    }
}

fn has_code(text: &[u8]) -> bool {
    let mut rest = match text.starts_with(b"#!") {
        true => skip_line(text),
        false => text,
    };
    loop {
        rest = rest.trim_ascii_start();
        if let Some(after_mark) = rest.strip_prefix("\u{FEFF}".as_bytes()) {
            rest = after_mark;
        } else if rest.starts_with(b"//") {
            rest = skip_line(rest);
        } else if let Some(comment) = rest.strip_prefix(b"/*") {
            let Some(end) = strings::index_of(comment, b"*/") else {
                return true;
            };
            rest = &comment[end + 2..];
        } else {
            return !rest.is_empty();
        }
    }
}

fn skip_line(text: &[u8]) -> &[u8] {
    for (index, &byte) in text.iter().enumerate() {
        match byte {
            b'\n' | b'\r' => return &text[index + 1..],
            // U+2028 and U+2029 are line terminators in ECMAScript.
            0xE2 if matches!(text[index + 1..], [0x80, 0xA8 | 0xA9, ..]) => {
                return &text[index + 3..];
            }
            _ => {}
        }
    }
    b""
}

fn code_options(input: &OptionsInput<'_, '_, '_>) -> CodeOptions {
    let options = input.bundle_options;
    let mut code = CodeOptions::bun_run(&from_native(input.working_directory));

    for condition in &options.custom_conditions {
        code.add_custom_condition(condition);
    }
    if options.transform_options.allow_addons == Some(false) {
        code.conditions
            .retain(|condition| condition != b"node-addons");
    }

    // An executable holds the file of a package that a bundle holds. `bun run` takes "main" where a package has both.
    code.prefers_module_field = !input.aot.runs_in_place;
    code.preserves_symlinks = options.preserve_symlinks;
    code.transpiles_by_working_directory = input.aot.checks_only;
    code.tsconfig_override = (options.tsconfig_override.as_ref())
        .map(|path| from_argument(&code.working_directory, path));

    let orders = &options.extension_order;
    code.extension_orders.import = owned_list(&orders.default.esm);
    code.extension_orders.require = owned_list(&orders.default.default);
    code.extension_orders.node_modules_import = owned_list(&orders.node_modules.esm);
    code.extension_orders.node_modules_require = owned_list(&orders.node_modules.default);

    let delimiter = if cfg!(windows) { b';' } else { b':' };
    code.node_paths = (input
        .node_path
        .unwrap_or_default()
        .split(|&byte| byte == delimiter))
    .filter(|entry| !entry.is_empty())
    .map(|entry| from_argument(&code.working_directory, entry))
    .collect();

    code.jsx = jsx_settings(&options.jsx);
    code.forced_jsx_development = Some(options.forced_jsx_development());
    code
}

fn jsx_settings(pragma: &jsx::Pragma) -> JsxSettings {
    JsxSettings {
        runtime: match pragma.runtime {
            jsx::Runtime::Classic => JsxRuntime::Classic,
            jsx::Runtime::Automatic | jsx::Runtime::_None => JsxRuntime::Automatic,
        },
        is_development: pragma.development,
        factory: pragma.factory.iter().map(<[u8]>::to_vec).collect(),
        fragment: pragma.fragment.iter().map(<[u8]>::to_vec).collect(),
        import_source: pragma.package_name.to_vec(),
    }
}

fn owned_list<T: AsRef<[u8]>>(list: &[T]) -> Vec<Vec<u8>> {
    list.iter().map(|item| item.as_ref().to_vec()).collect()
}

fn load_options(input: &OptionsInput<'_, '_, '_>) -> LoadOptions {
    let options = input.bundle_options;
    let mut loaders: Vec<_> = (options.loaders.keys().iter())
        .zip(options.loaders.values())
        .map(|(extension, &loader)| (extension.to_vec(), loader))
        .collect();
    loaders.sort_unstable_by(|a, b| a.0.cmp(&b.0));
    LoadOptions {
        project_root: without_trailing_slash_windows_path(input.working_directory).to_vec(),
        loaders,
        externals: externals(options),
        react_compiler: options.react_compiler,
        runs_macros: !options.no_macros,
        in_memory_files: in_memory_files(input),
        in_memory_file_keys: in_memory_file_keys(input),
        omits_builtin_modules: input.aot.omits_builtin_modules,
        runs_tests: input.aot.runs_tests,
        takes_runtime_as_any: false,
    }
}

fn in_memory_files(input: &OptionsInput<'_, '_, '_>) -> Vec<(Vec<u8>, Vec<u8>)> {
    let Some(file_map) = input.file_map else {
        return Vec::new();
    };
    let by_path = in_memory_files_by_path(file_map, input.working_directory);
    let files = by_path.into_iter();
    files
        .map(|(path, (_, contents))| (path, contents.to_vec()))
        .collect()
}

fn in_memory_file_keys(input: &OptionsInput<'_, '_, '_>) -> Vec<(Vec<u8>, Vec<u8>)> {
    let Some(file_map) = input.file_map else {
        return Vec::new();
    };
    let by_path = in_memory_files_by_path(file_map, input.working_directory);
    let mut keys: Vec<_> = (by_path.into_iter())
        .map(|(path, (key, _))| (key.to_vec(), path))
        .collect();
    keys.sort_unstable();
    keys
}

/// For the path of each file of `files`, its key as it is written and its contents. Of two keys for one path the later one counts.
pub(crate) fn in_memory_files_by_path<'f>(
    file_map: &'f FileMap,
    working_directory: &[u8],
) -> BTreeMap<Vec<u8>, (&'f [u8], &'f [u8])> {
    let working_directory = from_native(working_directory);
    let mut files: Vec<_> = file_map.map.iter().collect();
    files.sort_unstable_by(|a, b| a.0[..].cmp(&b.0[..]));
    (files.into_iter())
        .map(|(key, contents)| {
            (
                in_memory_path(&working_directory, key),
                (&key[..], &contents[..]),
            )
        })
        .collect()
}

// Unlike elsewhere in this file, `working_directory` is in the checker's format.
fn in_memory_path(working_directory: &[u8], key: &[u8]) -> Vec<u8> {
    to_native(&from_argument(working_directory, key)).to_vec()
}

// The bundler's own patterns are addresses of a development server.
fn externals(options: &BundleOptions<'_>) -> Externals {
    let external = &options.external;
    let patterns = external
        .patterns
        .iter()
        .map(|pattern| (&pattern.prefix[..], &pattern.suffix[..]));
    let marked_patterns = patterns.filter(|pattern| !DEFAULT_WILDCARD_PATTERNS.contains(pattern));
    Externals {
        are_all_packages: options.packages == PackagesOption::External,
        packages: sorted_unique(external.node_modules.keys().iter().map(|key| key.to_vec())),
        paths: sorted_unique(external.abs_paths.keys().iter().map(|key| key.to_vec())),
        patterns: sorted_unique(
            marked_patterns.map(|(prefix, suffix)| (prefix.to_vec(), suffix.to_vec())),
        ),
    }
}

fn sorted_unique<T: Ord>(list: impl Iterator<Item = T>) -> Vec<T> {
    let mut sorted: Vec<T> = list.collect();
    sorted.sort_unstable();
    sorted.dedup();
    sorted
}

fn path_options(
    input: &OptionsInput<'_, '_, '_>,
    entry_points: &[Vec<u8>],
    log: &mut Log,
) -> Option<PathOptions> {
    let root_directory = root_directory(input, entry_points, log)?;
    let entry_point_names = entry_point_names(input, entry_points, &root_directory, log)?;
    Some(PathOptions {
        module_prefix: input.module_prefix.to_vec(),
        root_directory,
        entry_point_names,
    })
}

fn root_directory(
    input: &OptionsInput<'_, '_, '_>,
    entry_points: &[Vec<u8>],
    log: &mut Log,
) -> Option<Vec<u8>> {
    let written = &input.bundle_options.root_dir[..];
    if written.is_empty() {
        let directory = common_entry_directory(input.working_directory, entry_points);
        let assets = if input.aot.runs_in_place {
            &[][..]
        } else {
            input.assets
        };
        let directory = widen_to_assets(input.working_directory, directory, assets);
        return Some(real_directory_path(&directory).unwrap_or(directory));
    }
    let root_directory = absolute_path(input.working_directory, written);
    if root_directory.len() >= MAX_PATH_BYTES {
        report_long_path(log, "root directory", written);
        return None;
    }
    Some(root_directory)
}

fn common_entry_directory(working_directory: &[u8], entry_points: &[Vec<u8>]) -> Vec<u8> {
    let paths: Vec<Vec<u8>> = entry_points
        .iter()
        .map(|entry| absolute_path(working_directory, entry))
        .collect();
    let first_directory = paths
        .first()
        .map(|first| bun_core::dirname(first).unwrap_or(&first[..]));
    let all: Vec<&[u8]> = first_directory
        .into_iter()
        .chain(paths.iter().map(|path| &path[..]))
        .collect();
    let common = absolute_path(working_directory, longest_common_path_of(&all));
    without_trailing_slash_windows_path(&common).to_vec()
}

/// Never above the working directory: the executable would name the folders of the machine that built it.
fn widen_to_assets(
    working_directory: &[u8],
    entry_directory: Vec<u8>,
    assets: &[Box<[u8]>],
) -> Vec<u8> {
    let working_directory = absolute_path(working_directory, b"");
    let is_inside = |path: &[u8]| {
        path.strip_prefix(without_trailing_slash_windows_path(&working_directory))
            .is_some_and(|rest| rest.first().is_none_or(|&byte| bun_paths::is_sep_any(byte)))
    };
    if !is_inside(&entry_directory) {
        return entry_directory;
    }
    let paths = assets
        .iter()
        .map(|asset| absolute_path(&working_directory, asset));
    let inside = paths.filter(|path| is_inside(path) && path.len() > working_directory.len());
    let folders = inside.filter_map(|path| bun_core::dirname(&path).map(<[u8]>::to_vec));
    // Each ends with a separator: of two equal paths without one `longest_common_path` answers the folder that holds them.
    let all: Vec<Vec<u8>> = core::iter::once(entry_directory)
        .chain(folders)
        .map(|folder| [&folder[..], b"/"].concat())
        .collect();
    let all: Vec<&[u8]> = all.iter().map(|folder| &folder[..]).collect();
    let common = absolute_path(&working_directory, longest_common_path_of(&all));
    without_trailing_slash_windows_path(&common).to_vec()
}

/// `resolve_path::longest_common_path` has a second rule for more than eight paths, which can answer a folder that does not hold all of them.
fn longest_common_path_of<'a>(paths: &[&'a [u8]]) -> &'a [u8] {
    let Some((&first, rest)) = paths.split_first() else {
        return b"";
    };
    rest.iter().fold(first, |common, &path| {
        resolve_path::longest_common_path(&[common, path])
    })
}

/// `bun run` starts a file under its real path, and so `node_modules/.bin/tool` finds what lies beside the file that the link names.
fn follow_links(input: &OptionsInput<'_, '_, '_>, entry_points: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    let mut followed: Vec<Vec<u8>> = Vec::with_capacity(entry_points.len());
    for entry in entry_points {
        let is_in_memory = input.file_map.is_some_and(|files| files.contains(&entry));
        let absolute = absolute_path(input.working_directory, &entry);
        let real = match is_in_memory {
            true => None,
            false => real_file_path(&absolute).filter(|real| *real != absolute),
        };
        let entry = real.unwrap_or(entry);
        if !followed.contains(&entry) {
            followed.push(entry);
        }
    }
    followed
}

fn real_file_path(path: &[u8]) -> Option<Vec<u8>> {
    let mut name = bun_paths::path_buffer_pool::get();
    if path.len() >= name.len() {
        return None;
    }
    name[..path.len()].copy_from_slice(path);
    name[path.len()] = 0;
    let name = bun_core::ZStr::from_buf(&name[..], path.len());
    let mut buffer = bun_paths::path_buffer_pool::get();
    Some(bun_sys::realpath(name, &mut buffer).ok()?.to_vec())
}

fn real_directory_path(directory: &[u8]) -> Option<Vec<u8>> {
    let opened = bun_sys::Dir::open(directory).ok()?;
    let mut buffer = bun_paths::path_buffer_pool::get();
    let real_path = opened.get_fd_path(&mut buffer).ok()?;
    Some(real_path.to_vec())
}

fn entry_point_names(
    input: &OptionsInput<'_, '_, '_>,
    entry_points: &[Vec<u8>],
    root_directory: &[u8],
    log: &mut Log,
) -> Option<Vec<Vec<u8>>> {
    let mut template = entry_name_template(&input.bundle_options.entry_naming);
    if template
        .as_ref()
        .is_some_and(|template| template.needs(PlaceholderField::Hash))
    {
        log_diagnostic(log, Code::UnsupportedOption, &[b"[hash] in --entry-naming"]);
        return None;
    }

    let names: Vec<Option<Vec<u8>>> = (entry_points.iter())
        .map(|entry| {
            let relative = relative_path(input.working_directory, root_directory, entry)?;
            Some(entry_name(template.as_mut(), relative))
        })
        .collect();
    for (entry, _) in entry_points
        .iter()
        .zip(&names)
        .filter(|(_, name)| name.is_none())
    {
        report_long_path(log, "entry point", entry);
    }
    without_equal_names(names.into_iter().collect::<Option<_>>()?, log)
}

/// The names of the entry points' files in the executable, which are those that `bun build --compile` gives them: the resolver looks for an entry point under `.js` whatever the extension of its source was, and tools read the list.
pub(crate) fn embedded_entry_point_names(
    options: &BundleOptions<'_>,
    working_directory: &[u8],
    entry_points: &[Vec<u8>],
    root_directory: &[u8],
    log: &mut Log,
) -> Option<Vec<Vec<u8>>> {
    let compile_name = Some(&options.compile_entry_point_name[..]).filter(|name| !name.is_empty());
    let mut template = output_name_template(&options.entry_naming);
    let names = entry_points
        .iter()
        .enumerate()
        .map(|(index, entry)| match compile_name {
            Some(name) if index == 0 => Some(name.to_vec()),
            _ => {
                let relative = relative_path(working_directory, root_directory, entry)?;
                Some(entry_name(Some(&mut template), relative))
            }
        });
    without_equal_names(names.collect::<Option<_>>()?, log)
}

fn without_equal_names(names: Vec<Vec<u8>>, log: &mut Log) -> Option<Vec<Vec<u8>>> {
    let mut sorted: Vec<&Vec<u8>> = names.iter().collect();
    sorted.sort_unstable();
    let mut has_duplicate = false;
    for group in sorted
        .chunk_by(|a, b| a == b)
        .filter(|group| group.len() > 1)
    {
        has_duplicate = true;
        log.add_error_fmt(
            None,
            Loc::EMPTY,
            format_args!(
                "Multiple files share the same output path: {}",
                bstr::BStr::new(group[0])
            ),
        );
    }
    (!has_duplicate).then_some(names)
}

fn entry_name_template(entry_naming: &[u8]) -> Option<PathTemplate> {
    let is_default = entry_naming.is_empty() || entry_naming == PathTemplate::FILE.data;
    (!is_default).then(|| output_name_template(entry_naming))
}

fn output_name_template(entry_naming: &[u8]) -> PathTemplate {
    let mut template: PathTemplate = PathTemplate::FILE.into();
    if !entry_naming.is_empty() {
        template.data = entry_naming.into();
    }
    template.placeholder.ext = b"js".as_slice().into();
    if template.needs(PlaceholderField::Target) {
        template.placeholder.target = Target::Bun.naming_placeholder().into();
    }
    template
}

// Without a template of the user's the module of an entry point is named like any other module, after its source file: the name is what `Bun.main`, `import.meta.path` and stack frames show.
fn entry_name(template: Option<&mut PathTemplate>, relative: Vec<u8>) -> Vec<u8> {
    let mut name = match template {
        None => relative,
        Some(template) => {
            let pathname = PathName::init(&relative);
            let directory: &[u8] = match pathname.dir.is_empty() {
                true => b".",
                false => pathname.dir,
            };
            template.placeholder.name = pathname.base.into();
            template.placeholder.dir = directory.into();

            let mut name: Vec<u8> = Vec::new();
            template.print(&mut name, false).expect("oom");
            name
        }
    };
    resolve_path::platform_to_posix_in_place(name.as_mut_slice());
    strings::remove_leading_dot_slash(&name).to_vec()
}

pub fn expand_entry_points<T: AsRef<[u8]>>(
    entry_points: &[T],
    working_directory: &[u8],
    file_map: Option<&FileMap>,
    log: &mut Log,
) -> Option<Vec<Vec<u8>>> {
    let mut expanded = Vec::new();
    let mut absolute_paths = bun_collections::StringSet::new();
    let mut has_failed = false;
    for entry in entry_points.iter().map(T::as_ref) {
        let absolute_entry = absolute_path(working_directory, entry);
        if absolute_entry.len() >= MAX_PATH_BYTES {
            has_failed = true;
            report_long_path(log, "entry point", entry);
            continue;
        }
        let files = match is_entry_pattern(file_map, entry, &absolute_entry) {
            false => vec![entry.to_vec()],
            true => glob_matches(entry, working_directory).unwrap_or_default(),
        };
        if files.is_empty() {
            has_failed = true;
            log.add_error_fmt(
                None,
                Loc::EMPTY,
                format_args!(
                    "no file matches the entry point \"{}\"",
                    bstr::BStr::new(entry)
                ),
            );
        }
        for file in files {
            let path = absolute_path(working_directory, &file);
            if !absolute_paths.contains(&path) {
                bun_core::handle_oom(absolute_paths.insert(&path));
                expanded.push(file);
            }
        }
    }
    (!has_failed).then_some(expanded)
}

fn is_entry_pattern(file_map: Option<&FileMap>, entry: &[u8], absolute_entry: &[u8]) -> bool {
    detect_glob_syntax(entry)
        && !file_map.is_some_and(|file_map| file_map.contains(entry))
        && !bun_sys::exists(absolute_entry)
}

fn glob_matches(pattern: &[u8], working_directory: &[u8]) -> Option<Vec<Vec<u8>>> {
    let Ok(Ok(mut walker)) = BunGlobWalker::init_with_cwd(
        pattern,
        working_directory,
        false,
        false,
        true,
        false,
        true,
        None,
    ) else {
        return None;
    };
    let mut iterator = walk::Iterator::new(&mut walker);
    if !matches!(iterator.init(), Ok(Ok(()))) {
        return None;
    }
    let mut matches = Vec::new();
    loop {
        match iterator.next() {
            Ok(Ok(Some(path))) => matches.push(path.into_vec()),
            Ok(Ok(None)) => break,
            Ok(Err(_)) | Err(_) => return None,
        }
    }
    matches.sort_unstable();
    Some(matches)
}

#[cfg(all(test, not(windows)))]
mod tests;

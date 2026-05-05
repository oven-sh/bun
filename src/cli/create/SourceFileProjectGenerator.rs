//! Port of src/cli/create/SourceFileProjectGenerator.zig

use bun_bundler::bundle_v2::{BundleV2, DependenciesScannerResult, ResolvedExports};
use bun_cli::create_command::Example;
use bun_cli::Command;
use bun_collections::StringSet;
use bun_core::{Global, Output};
use bun_js_parser::ast as js_ast;
use bun_js_parser::js_lexer;
use bun_logger::Source as LoggerSource;
use bun_paths as path;
use bun_str::strings;
use bun_str::MutableString;
use bun_sys::{self, Fd};

// Generate project files based on the entry point and dependencies
pub fn generate(
    _ctx: &Command::Context,
    _example: Example::Tag,
    entry_point: &[u8],
    result: &mut DependenciesScannerResult,
) -> Result<(), bun_core::Error> {
    let Some(react_component_export) = find_react_component_export(result.bundle_v2) else {
        Output::err_generic(format_args!(
            "No component export found in <b>{}<r>",
            bun_core::fmt::quote(entry_point)
        ));
        Output::flush();
        let writer = Output::error_writer_buffered();
        writer.write_all(
            b"\n\
              Please add an export to your file. For example:\n\
              \n\
              \x20  export default function MyApp() {{\n\
              \x20    return <div>Hello World</div>;\n\
              \x20  }};\n\
              \n",
        )?;

        Output::flush();
        Global::crash();
    };

    // Check if Tailwind is already in dependencies
    let has_tailwind_in_dependencies = result.dependencies.contains(b"tailwindcss")
        || result.dependencies.contains(b"bun-plugin-tailwind");
    let mut needs_to_inject_tailwind = false;
    if !has_tailwind_in_dependencies {
        // Scan source files for Tailwind classes if not already in dependencies
        needs_to_inject_tailwind =
            has_any_tailwind_classes_in_source_files(result.bundle_v2, &result.reachable_files);
    }

    // Get any shadcn components used in the project
    let shadcn = if ENABLE_SHADCN_UI {
        get_shadcn_components(result.bundle_v2, &result.reachable_files)?
    } else {
        StringSet::new()
    };
    let needs_to_inject_shadcn_ui = !shadcn.keys().is_empty();

    // Add Tailwind dependencies if needed
    if needs_to_inject_tailwind {
        result.dependencies.insert(b"tailwindcss")?;
        result.dependencies.insert(b"bun-plugin-tailwind")?;
    }

    // Add shadcn-ui dependencies if needed
    if needs_to_inject_shadcn_ui {
        // https://ui.shadcn.com/docs/installation/manual
        // This will probably be tricky to keep updated.
        // but hopefully the dependency scanning will just handle it for us.
        result.dependencies.insert(b"tw-animate-css")?;
        result.dependencies.insert(b"class-variance-authority")?;
        result.dependencies.insert(b"clsx")?;
        result.dependencies.insert(b"tailwind-merge")?;
        result.dependencies.insert(b"lucide-react")?;
    }

    let uses_tailwind = has_tailwind_in_dependencies || needs_to_inject_tailwind;

    // We are JSX-only for now.
    // The versions of react & react-dom need to match up, and it's SO easy to mess that up.
    // So we have to be a little opinionated here.
    // Add react-dom if react is used
    let _ = result.dependencies.swap_remove(b"react");
    let _ = result.dependencies.swap_remove(b"react-dom");
    result.dependencies.insert(b"react-dom@19")?;
    result.dependencies.insert(b"react@19")?;

    let dev_dependencies: &[&[u8]] = &[
        b"@types/bun",
        b"@types/react@19",
        b"@types/react-dom@19",
    ];

    // Choose template based on dependencies and example type
    let template: Template = 'brk: {
        if needs_to_inject_shadcn_ui {
            break 'brk Template::ReactShadcnSpa { components: shadcn };
        } else if uses_tailwind {
            break 'brk Template::ReactTailwindSpa;
        } else {
            break 'brk Template::ReactSpa;
        }
    };

    // Generate project files from template
    generate_files(
        entry_point,
        result.dependencies.keys(),
        dev_dependencies,
        template,
        react_component_export,
    )?;

    Global::exit(0);
}

// Create a file with given contents, returns if file was newly created
fn create_file(filename: &[u8], contents: &[u8]) -> bun_sys::Result<bool> {
    // Check if file exists and has same contents
    if let Some(source_contents) = bun_sys::File::read_from(Fd::cwd(), filename).as_value() {
        // `source_contents` is a Vec<u8>; freed on drop.
        if strings::eql_long(&source_contents, contents, true) {
            return bun_sys::Result::Ok(false);
        }
    }

    // Create parent directories if needed
    if let Some(dirname) = path::dirname(filename) {
        let _ = bun_sys::make_path(Fd::cwd(), dirname);
    }

    // Open file for writing
    let fd = match bun_sys::openat_a(
        Fd::cwd(),
        filename,
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
        0o644,
    ) {
        bun_sys::Result::Ok(fd) => fd,
        bun_sys::Result::Err(err) => return bun_sys::Result::Err(err),
    };
    // TODO(port): RAII fd guard — `defer fd.close()` semantics
    let close_guard = scopeguard::guard(fd, |fd| fd.close());

    // Write contents
    match bun_sys::File::from_handle(*close_guard).write_all(contents) {
        bun_sys::Result::Ok(()) => bun_sys::Result::Ok(true),
        bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
    }
}

// Count number of occurrences to calculate buffer size
fn count_replace_all_occurrences(input: &[u8], needle: &[u8], replacement: &[u8]) -> usize {
    let mut remaining = input;
    let mut count: usize = 0;
    while !remaining.is_empty() {
        if let Some(index) = bun_str::strings::index_of(remaining, needle) {
            remaining = &remaining[index + needle.len()..];
            count += 1;
        } else {
            break;
        }
    }

    input.len() + (count * (replacement.len().saturating_sub(needle.len())))
}

// Replace all occurrences of needle with replacement
fn replace_all_occurrences_of_string(
    input: &[u8],
    needle: &[u8],
    replacement: &[u8],
) -> Result<Vec<u8>, bun_alloc::AllocError> {
    let mut result: Vec<u8> =
        Vec::with_capacity(count_replace_all_occurrences(input, needle, replacement));
    let mut remaining = input;
    while !remaining.is_empty() {
        if let Some(index) = bun_str::strings::index_of(remaining, needle) {
            let new_remaining = &remaining[index + needle.len()..];
            result.extend_from_slice(&remaining[0..index]);
            result.extend_from_slice(replacement);
            remaining = new_remaining;
        } else {
            result.extend_from_slice(remaining);
            break;
        }
    }

    Ok(result)
}

// Replace template placeholders with actual values
fn string_with_replacements(
    original_input: &[u8],
    basename: &[u8],
    relative_name: &[u8],
    react_component_export: &[u8],
) -> Result<Vec<u8>, bun_alloc::AllocError> {
    // PORT NOTE: Zig threaded an allocator and reassigned `input` to leaked
    // intermediate slices. In Rust we own `Vec<u8>` and rebind it; intermediates
    // are dropped automatically.
    let mut input: Vec<u8> = original_input.to_vec();

    if strings::contains(&input, b"REPLACE_ME_WITH_YOUR_REACT_COMPONENT_EXPORT") {
        input = replace_all_occurrences_of_string(
            &input,
            b"REPLACE_ME_WITH_YOUR_REACT_COMPONENT_EXPORT",
            react_component_export,
        )?;
    }

    if strings::contains(&input, b"REPLACE_ME_WITH_YOUR_APP_BASE_NAME") {
        input = replace_all_occurrences_of_string(
            &input,
            b"REPLACE_ME_WITH_YOUR_APP_BASE_NAME",
            basename,
        )?;
    }

    if strings::contains(&input, b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME") {
        input = replace_all_occurrences_of_string(
            &input,
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME",
            relative_name,
        )?;
    }

    Ok(input)
}

fn run_install(argv: &mut Vec<&[u8]>) -> Result<(), bun_core::Error> {
    Output::command_out(argv);
    Output::flush();

    argv[0] = bun_core::self_exe_path()?;

    // TODO(port): bun.spawnSync — confirm crate path (bun_runtime::process::spawn_sync)
    let process = match bun_runtime::process::spawn_sync(&bun_runtime::process::SpawnOptions {
        argv,
        envp: None,
        cwd: bun_fs::FileSystem::instance().top_level_dir,
        stderr: bun_runtime::process::Stdio::Inherit,
        stdout: bun_runtime::process::Stdio::Inherit,
        stdin: bun_runtime::process::Stdio::Inherit,

        #[cfg(windows)]
        windows: bun_runtime::process::WindowsOptions {
            loop_: bun_jsc::EventLoopHandle::init(bun_event_loop::MiniEventLoop::init_global(None, None)),
        },
    }) {
        Ok(p) => p,
        Err(err) => {
            Output::err(err, format_args!("failed to install dependencies"));
            Global::crash();
        }
    };

    match process {
        bun_sys::Result::Err(err) => {
            Output::err(err, format_args!("failed to install dependencies"));
            Global::crash();
        }
        bun_sys::Result::Ok(spawn_result) => {
            if !spawn_result.status.is_ok() {
                if let Some(signal) = spawn_result.status.signal_code() {
                    if let Some(exit_code) = signal.to_exit_code() {
                        Global::exit(exit_code);
                    }
                }

                if let bun_runtime::process::Status::Exited { code, .. } = spawn_result.status {
                    Global::exit(code);
                }

                Global::crash();
            }
        }
    }

    Ok(())
}

// Generate all project files from template
pub fn generate_files(
    entry_point: &[u8],
    dependencies: &[&[u8]],
    dev_dependencies: &[&[u8]],
    template: Template,
    react_component_export: &[u8],
) -> Result<(), bun_core::Error> {
    let mut log = template.logger();
    let mut basename = path::basename(entry_point);
    let extension = path::extension(basename);
    if !extension.is_empty() {
        basename = &basename[0..basename.len() - extension.len()];
    }

    // Normalize file paths
    let mut normalized_buf = bun_paths::PathBuffer::uninit();
    let mut normalized_name: &[u8] = if bun_paths::is_absolute(entry_point) {
        path::relative_normalized_buf(
            &mut normalized_buf,
            bun_fs::FileSystem::instance().top_level_dir,
            entry_point,
            path::Platform::Loose,
            true,
        )
    } else {
        path::normalize_buf(entry_point, &mut normalized_buf, path::Platform::Loose)
    };

    if !extension.is_empty() {
        normalized_name = &normalized_name[0..normalized_name.len() - extension.len()];
    }

    // Generate files based on template type
    // PORT NOTE: Zig used `switch (tag) { inline else => |active| @field(Self, @tagName(active)) }`
    // to comptime-dispatch to the per-template `files` const and stack-size the
    // `filenames`/`created_files` arrays. Rust cannot reflect on decl names, so
    // we route through `Tag::files()` and use heap Vecs sized at runtime.
    // PERF(port): was comptime monomorphization + stack arrays — profile in Phase B
    {
        let files: &'static [TemplateFile] = template.tag().files();

        let mut max_filename_len: usize = 0;
        // PORT NOTE: reshaped for borrowck — Zig kept parallel `[N][]const u8 filenames`
        // + `[N]bool created_files` arrays of arena-backed slices. Here a single
        // Vec<Option<Vec<u8>>> owns the names; Some(_) doubles as the created flag.
        let mut filenames: Vec<Option<Vec<u8>>> = vec![None; files.len()];

        // Create all template files
        for index in 0..files.len() {
            let file = &files[index];
            let file_name =
                string_with_replacements(file.name, basename, normalized_name, react_component_export)?;
            if file.overwrite || !bun_sys::exists(&file_name) {
                let content = string_with_replacements(
                    file.content,
                    basename,
                    normalized_name,
                    react_component_export,
                )?;
                match create_file(&file_name, &content) {
                    bun_sys::Result::Ok(new) => {
                        if new {
                            max_filename_len = max_filename_len.max(file_name.len());
                            filenames[index] = Some(file_name);
                        }
                    }
                    bun_sys::Result::Err(err) => {
                        Output::err(
                            err,
                            format_args!("failed to create {}", bstr::BStr::new(&file_name)),
                        );
                        Global::crash();
                    }
                }
            }
        }

        debug_assert_eq!(files.len(), filenames.len());
        for (file, filename) in files.iter().zip(filenames.iter()) {
            if let Some(filename) = filename {
                log.file(file, filename, max_filename_len);
            }
        }
    }

    if !dependencies.is_empty() || !dev_dependencies.is_empty() {
        if log.has_written_initial_message {
            Output::print(format_args!("\n"));
        }
        Output::pretty(format_args!(
            "<r>📦 <b>Auto-installing {} detected dependencies<r>\n",
            dependencies.len() + dev_dependencies.len()
        ));
    }

    if !dependencies.is_empty() {
        let mut argv: Vec<&[u8]> = Vec::new();
        argv.push(b"bun");
        argv.push(b"--only-missing");
        argv.push(b"install");
        argv.extend_from_slice(dependencies);
        run_install(&mut argv)?;
    }

    if !dev_dependencies.is_empty() {
        let mut argv: Vec<&[u8]> = Vec::new();
        argv.push(b"bun");
        argv.push(b"--only-missing");
        argv.push(b"add");
        argv.push(b"-d");
        argv.extend_from_slice(dev_dependencies);
        run_install(&mut argv)?;
    }

    // Show success message and start dev server

    match &template {
        Template::ReactShadcnSpa { components } => {
            if !components.keys().is_empty() {
                // Add shadcn components
                let mut shadcn_argv: Vec<&[u8]> = Vec::with_capacity(10);
                shadcn_argv.push(b"bun");
                shadcn_argv.push(b"x");
                shadcn_argv.push(b"shadcn@canary");
                shadcn_argv.push(b"add");
                if strings::contains(normalized_name, b"/src") {
                    shadcn_argv.push(b"--src-dir");
                }
                shadcn_argv.push(b"-y");
                shadcn_argv.extend_from_slice(components.keys());

                // print "bun" but use bun.selfExePath()
                Output::prettyln(format_args!(
                    "\n<r>😎 <b>Setting up shadcn/ui components<r>"
                ));
                Output::command_out(&shadcn_argv);
                Output::flush();
                shadcn_argv[0] = bun_core::self_exe_path()?;

                // Now we need to run shadcn to add the components to the project
                // TODO(port): bun.spawnSync — confirm crate path
                let shadcn_process =
                    match bun_runtime::process::spawn_sync(&bun_runtime::process::SpawnOptions {
                        argv: &shadcn_argv,
                        envp: None,
                        cwd: bun_fs::FileSystem::instance().top_level_dir,
                        stderr: bun_runtime::process::Stdio::Inherit,
                        stdout: bun_runtime::process::Stdio::Inherit,
                        stdin: bun_runtime::process::Stdio::Inherit,
                        // TODO(port): Zig omits `.windows` here (unlike runInstall / dev-server spawns) — likely upstream bug; mirroring source exactly for now.
                    }) {
                        Ok(p) => p,
                        Err(err) => {
                            Output::err(err, format_args!("failed to add shadcn components"));
                            Global::crash();
                        }
                    };

                match shadcn_process {
                    bun_sys::Result::Err(err) => {
                        Output::err(err, format_args!("failed to add shadcn components"));
                        Global::crash();
                    }
                    bun_sys::Result::Ok(spawn_result) => {
                        if !spawn_result.status.is_ok() {
                            if let Some(signal) = spawn_result.status.signal_code() {
                                if let Some(exit_code) = signal.to_exit_code() {
                                    Global::exit(exit_code);
                                }
                            }

                            if let bun_runtime::process::Status::Exited { code, .. } =
                                spawn_result.status
                            {
                                Global::exit(code);
                            }

                            Global::crash();
                        }
                    }
                }

                Output::print(format_args!("\n"));

                log.if_new();
            }
        }
        Template::ReactSpa | Template::ReactTailwindSpa => {
            log.if_new();
        }
    }

    Output::flush();

    // Start dev server
    // TODO(port): bun.spawnSync — confirm crate path
    let start = match bun_runtime::process::spawn_sync(&bun_runtime::process::SpawnOptions {
        argv: &[bun_core::self_exe_path()?, b"dev"],
        envp: None,
        cwd: bun_fs::FileSystem::instance().top_level_dir,
        stderr: bun_runtime::process::Stdio::Inherit,
        stdout: bun_runtime::process::Stdio::Inherit,
        stdin: bun_runtime::process::Stdio::Inherit,

        #[cfg(windows)]
        windows: bun_runtime::process::WindowsOptions {
            loop_: bun_jsc::EventLoopHandle::init(bun_event_loop::MiniEventLoop::init_global(None, None)),
        },
    }) {
        Ok(p) => p,
        Err(err) => {
            Output::err(err, format_args!("failed to start app"));
            Global::crash();
        }
    };

    match start {
        bun_sys::Result::Err(err) => {
            Output::err(err, format_args!("failed to start app"));
            Global::crash();
        }
        bun_sys::Result::Ok(spawn_result) => {
            if !spawn_result.status.is_ok() {
                if let Some(signal) = spawn_result.status.signal_code() {
                    if let Some(exit_code) = signal.to_exit_code() {
                        Global::exit(exit_code);
                    }
                }

                if let bun_runtime::process::Status::Exited { code, .. } = spawn_result.status {
                    Global::exit(code);
                }

                Global::crash();
            }
        }
    }

    Global::exit(0);
}

// Check if any source files contain Tailwind classes
fn has_any_tailwind_classes_in_source_files(
    bundler: &BundleV2,
    reachable_files: &[js_ast::Index],
) -> bool {
    let input_files = bundler.graph.input_files.slice();
    let sources = input_files.items_source();
    let loaders = input_files.items_loader();

    // Common Tailwind class patterns to look for
    const COMMON_TAILWIND_PATTERNS: &[&[u8]] = &[
        b"bg-", b"text-", b"p-", b"m-", b"flex", b"grid", b"border", b"rounded", b"shadow",
        b"hover:", b"focus:", b"dark:", b"sm:", b"md:", b"lg:", b"xl:", b"w-", b"h-", b"space-",
        b"gap-", b"items-", b"justify-", b"font-",
    ];

    for file in reachable_files {
        match loaders[file.get()] {
            bun_bundler::options::Loader::Tsx | bun_bundler::options::Loader::Jsx => {
                let source: &LoggerSource = &sources[file.get()];
                let mut source_code: &[u8] = &source.contents;

                // First check for className=" or className='
                while let Some(index) = strings::index_of(source_code, b"className=") {
                    source_code = &source_code[index + b"className=".len()..];
                    if source_code.len() < 1 {
                        return false;
                    }
                    match source_code[0] {
                        quote @ (b'\'' | b'"') => {
                            source_code = &source_code[1..];
                            let Some(end_quote) = strings::index_of_char(source_code, quote) else {
                                continue;
                            };
                            let class_name = &source_code[0..end_quote as usize];
                            // search for tailwind patterns
                            for pattern in COMMON_TAILWIND_PATTERNS {
                                if bun_str::strings::index_of(class_name, pattern).is_some() {
                                    return true;
                                }
                            }
                        }
                        _ => {
                            source_code = &source_code[1..];
                        }
                    }
                }
            }
            bun_bundler::options::Loader::Html => {
                let source: &LoggerSource = &sources[file.get()];
                let source_code: &[u8] = &source.contents;

                // Look for class=" or class='
                let mut i: usize = 0;
                while i < source_code.len() {
                    if i + 7 >= source_code.len() {
                        break;
                    }

                    if source_code.starts_with(b"class") {
                        // Skip whitespace
                        let mut j = i + 5;
                        while j < source_code.len()
                            && (source_code[j] == b' ' || source_code[j] == b'=')
                        {
                            j += 1;
                        }
                        if j < source_code.len()
                            && (source_code[j] == b'"' || source_code[j] == b'\'')
                        {
                            // Found a class attribute, now check for Tailwind patterns
                            for pattern in COMMON_TAILWIND_PATTERNS {
                                if bun_str::strings::index_of(
                                    &source_code[j..(j + 1000).min(source_code.len())],
                                    pattern,
                                )
                                .is_some()
                                {
                                    return true;
                                }
                            }
                        }
                        i = j;
                    }
                    i += 1;
                }
            }
            _ => {}
        }
    }

    false
}

// Get list of shadcn components used in source files
fn get_shadcn_components(
    bundler: &BundleV2,
    reachable_files: &[js_ast::Index],
) -> Result<StringSet, bun_alloc::AllocError> {
    let input_files = bundler.graph.input_files.slice();
    let loaders = input_files.items_loader();
    let all = bundler.graph.ast.items_import_records();
    let mut icons = StringSet::new();
    for file in reachable_files {
        match loaders[file.get()] {
            bun_bundler::options::Loader::Tsx | bun_bundler::options::Loader::Jsx => {
                let import_records = &all[file.get()];
                for import_record in import_records.slice() {
                    if import_record.path.text.starts_with(b"@/components/ui/") {
                        icons.insert(&import_record.path.text[b"@/components/ui/".len()..])?;
                    }
                }
            }
            _ => {}
        }
    }

    Ok(icons)
}

fn find_react_component_export(bundler: &BundleV2) -> Option<&[u8]> {
    let input_files = bundler.graph.input_files.slice();
    let loaders = input_files.items_loader();
    let resolved_exports: &[ResolvedExports] = bundler.linker.graph.meta.items_resolved_exports();
    let sources = input_files.items_source();

    let entry_point_ids = bundler.graph.entry_points.as_slice();
    for entry_point_id in entry_point_ids {
        let loader = loaders[entry_point_id.get()];
        if matches!(
            loader,
            bun_bundler::options::Loader::Jsx | bun_bundler::options::Loader::Tsx
        ) {
            let source: &LoggerSource = &sources[entry_point_id.get()];
            let exports = &resolved_exports[entry_point_id.get()];

            // 1. Prioritize the default export
            if exports.contains(b"default") {
                return Some(b"default");
            }

            let export_names = exports.keys();
            if export_names.len() == 1 {
                // If there's only one export it can only be this.
                return Some(export_names[0]);
            }

            if export_names.is_empty() {
                // If there are no exports, we can't determine the component name.
                continue;
            }

            let filename = source.path.name.non_unique_name_string_base();
            if filename.is_empty() {
                #[cold]
                fn cold() {}
                cold();
                continue;
            }

            // 2. Prioritize the export matching the filename with an uppercase first letter
            // such as export const App = () => { ... }
            if filename[0] >= b'A' && filename[0] <= b'Z' {
                if js_lexer::is_identifier(filename) {
                    if exports.contains(filename) {
                        return Some(filename);
                    }
                }
            }

            if filename[0] >= b'a' && filename[0] <= b'z' {
                // PORT NOTE: Zig leaked `duped` on the success returns below
                // (only freed on the fall-through). We Box::leak to match the
                // returned-slice lifetime; the fall-through `free` is dropped.
                let duped: &mut [u8] = Box::leak(Box::<[u8]>::from(filename));
                duped[0] = duped[0] - 32;
                if js_lexer::is_identifier(duped) {
                    if exports.contains(duped) {
                        return Some(duped);
                    }
                }

                {
                    // Extremely naive pascal case conversion
                    // - Does not handle unicode.
                    let mut input_index: usize = 0;
                    let mut output_index: usize = 0;
                    let mut capitalize_next = false;
                    while input_index < duped.len() {
                        if duped[input_index] == b' '
                            || duped[input_index] == b'-'
                            || duped[input_index] == b'_'
                            || (output_index == 0
                                && !js_lexer::is_identifier_start(duped[input_index] as u32))
                        {
                            capitalize_next = true;
                            input_index += 1;
                            continue;
                        }
                        if output_index == 0 || capitalize_next {
                            if duped[input_index] >= b'a' && duped[input_index] <= b'z' {
                                duped[output_index] = duped[input_index] - 32;
                            } else {
                                duped[output_index] = duped[input_index];
                            }
                            capitalize_next = false;
                            output_index += 1;
                        } else {
                            duped[output_index] = duped[input_index];
                            output_index += 1;
                        }
                        input_index += 1;
                    }

                    // Try the pascal case version
                    // - "my-app" -> "MyApp"
                    // - "my_app" -> "MyApp"
                    // - "My-App" -> "MyApp"
                    if exports.contains(&duped[0..output_index]) {
                        return Some(&duped[0..output_index]);
                    }

                    // Okay that didn't work. Try the version that's the current
                    // filename with the first letter capitalized
                    // - "my-app" -> "Myapp"
                    // - "My-App" -> "Myapp"
                    if output_index > 1 {
                        for c in &mut duped[1..output_index] {
                            match *c {
                                b'A'..=b'Z' => {
                                    *c = *c + 32;
                                }
                                _ => {}
                            }
                        }
                    }

                    if exports.contains(&duped[0..output_index]) {
                        return Some(&duped[0..output_index]);
                    }
                }

                // Zig: default_allocator.free(duped) — intentionally leaked above; see PORT NOTE.
            }

            let Ok(name_to_try) = MutableString::ensure_valid_identifier(filename) else {
                return None;
            };
            if exports.contains(&name_to_try) {
                // TODO(port): lifetime — Zig returns an allocator-owned slice; we leak to match.
                return Some(Box::leak(name_to_try.into_boxed_slice()));
            }

            // Okay we really have no idea now.
            // Let's just pick one that looks like a react component I guess.
            for export_name in export_names {
                if !export_name.is_empty() && export_name[0] >= b'A' && export_name[0] <= b'Z' {
                    return Some(export_name);
                }
            }

            // Okay now we just have to pick one.
            if !export_names.is_empty() {
                return Some(export_names[0]);
            }
        }
    }

    None
}

// Disabled until Tailwind v4 is supported.
const ENABLE_SHADCN_UI: bool = true;

pub struct TemplateFile {
    pub name: &'static [u8],
    pub content: &'static [u8],
    pub reason: Reason,
    pub overwrite: bool,
}

impl TemplateFile {
    const fn new(name: &'static [u8], content: &'static [u8], reason: Reason) -> Self {
        Self { name, content, reason, overwrite: true }
    }
    const fn new_no_overwrite(
        name: &'static [u8],
        content: &'static [u8],
        reason: Reason,
    ) -> Self {
        Self { name, content, reason, overwrite: false }
    }
}

#[derive(Clone, Copy, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum Reason {
    Shadcn,
    Bun,
    Css,
    Tsc,
    Build,
    Html,
    Npm,
}

// Template for React + Tailwind project
pub mod react_tailwind_spa {
    use super::*;

    pub const FILES: &[TemplateFile] = &[
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts",
            SHARED_BUILD_TS,
            Reason::Build,
        ),
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css",
            include_bytes!("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
            Reason::Css,
        ),
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html",
            SHARED_HTML,
            Reason::Html,
        ),
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx",
            SHARED_CLIENT_TSX,
            Reason::Bun,
        ),
        TemplateFile::new_no_overwrite(b"bunfig.toml", SHARED_BUNFIG_TOML, Reason::Bun),
        TemplateFile::new_no_overwrite(b"package.json", SHARED_PACKAGE_JSON, Reason::Npm),
    ];

    pub const INIT_FILES: &[TemplateFile] = &[];
}

const SHARED_BUILD_TS: &[u8] =
    include_bytes!("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts");
const SHARED_CLIENT_TSX: &[u8] =
    include_bytes!("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx");
const SHARED_HTML: &[u8] =
    include_bytes!("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html");
const SHARED_PACKAGE_JSON: &[u8] = include_bytes!("projects/react-shadcn-spa/package.json");
const SHARED_BUNFIG_TOML: &[u8] = include_bytes!("projects/react-shadcn-spa/bunfig.toml");

// Template for basic React project
pub mod react_spa {
    use super::*;

    pub const FILES: &[TemplateFile] = &[
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts",
            SHARED_BUILD_TS,
            Reason::Build,
        ),
        TemplateFile::new_no_overwrite(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css",
            include_bytes!("projects/react-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
            Reason::Css,
        ),
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html",
            SHARED_HTML,
            Reason::Html,
        ),
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx",
            SHARED_CLIENT_TSX,
            Reason::Bun,
        ),
        TemplateFile::new_no_overwrite(
            b"package.json",
            include_bytes!("projects/react-spa/package.json"),
            Reason::Npm,
        ),
    ];
}

// Template for React + Shadcn project
pub mod react_shadcn_spa {
    use super::*;

    pub const FILES: &[TemplateFile] = &[
        TemplateFile::new(
            b"lib/utils.ts",
            include_bytes!("projects/react-shadcn-spa/lib/utils.ts"),
            Reason::Shadcn,
        ),
        TemplateFile::new(
            b"index.css",
            include_bytes!("projects/react-shadcn-spa/styles/index.css"),
            Reason::Shadcn,
        ),
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts",
            SHARED_BUILD_TS,
            Reason::Bun,
        ),
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx",
            SHARED_CLIENT_TSX,
            Reason::Bun,
        ),
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css",
            include_bytes!("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
            Reason::Css,
        ),
        TemplateFile::new(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html",
            SHARED_HTML,
            Reason::Html,
        ),
        TemplateFile::new(
            b"styles/globals.css",
            include_bytes!("projects/react-shadcn-spa/styles/globals.css"),
            Reason::Shadcn,
        ),
        TemplateFile::new_no_overwrite(b"bunfig.toml", SHARED_BUNFIG_TOML, Reason::Bun),
        TemplateFile::new_no_overwrite(b"package.json", SHARED_PACKAGE_JSON, Reason::Npm),
        TemplateFile::new_no_overwrite(
            b"tsconfig.json",
            include_bytes!("projects/react-shadcn-spa/tsconfig.json"),
            Reason::Tsc,
        ),
        TemplateFile::new_no_overwrite(
            b"components.json",
            include_bytes!("projects/react-shadcn-spa/components.json"),
            Reason::Shadcn,
        ),
    ];
}

// Template type to handle different project types
pub enum Template {
    ReactTailwindSpa,
    ReactSpa,
    ReactShadcnSpa { components: StringSet },
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tag {
    ReactTailwindSpa,
    ReactSpa,
    ReactShadcnSpa,
}

impl Tag {
    pub fn logger(self) -> Logger {
        Logger { template: self, has_written_initial_message: false }
    }

    pub fn label(self) -> &'static [u8] {
        match self {
            Tag::ReactTailwindSpa => b"React + Tailwind",
            Tag::ReactSpa => b"React",
            Tag::ReactShadcnSpa => b"React + shadcn/ui + Tailwind",
        }
    }

    /// Replaces Zig's `@field(SourceFileProjectGenerator, @tagName(active)).files`.
    pub fn files(self) -> &'static [TemplateFile] {
        match self {
            Tag::ReactTailwindSpa => react_tailwind_spa::FILES,
            Tag::ReactSpa => react_spa::FILES,
            Tag::ReactShadcnSpa => react_shadcn_spa::FILES,
        }
    }
}

impl Template {
    pub fn tag(&self) -> Tag {
        match self {
            Template::ReactTailwindSpa => Tag::ReactTailwindSpa,
            Template::ReactSpa => Tag::ReactSpa,
            Template::ReactShadcnSpa { .. } => Tag::ReactShadcnSpa,
        }
    }

    pub fn logger(&self) -> Logger {
        Logger { template: self.tag(), has_written_initial_message: false }
    }
}

pub struct Logger {
    pub has_written_initial_message: bool,
    pub template: Tag,
}

impl Logger {
    pub fn file(&mut self, template_file: &TemplateFile, name: &[u8], max_name_len: usize) {
        self.has_written_initial_message = true;
        Output::pretty(format_args!(" <green>create<r>  "));
        Output::pretty(format_args!("{}", bstr::BStr::new(name)));
        let name_len = name.len();
        let mut padding: usize = max_name_len - name_len;
        while padding > 0 {
            Output::pretty(format_args!(" "));
            padding -= 1;
        }
        Output::prettyln(format_args!(
            "   <d>{}<r>",
            <&'static str>::from(template_file.reason)
        ));
    }

    pub fn if_new(&mut self) {
        if !self.has_written_initial_message {
            return;
        }

        Output::prettyln(format_args!(
            "<r><d>--------------------------------<r>\n\
             ✨ <b>{}<r> project configured\n\
             \n\
             <b><cyan>Development<r><d> - frontend dev server with hot reload<r>\n\
             \n\
             \x20 <cyan><b>bun dev<r>\n\
             \n\
             <b><green>Production<r><d> - build optimized assets<r>\n\
             \n\
             \x20 <green><b>bun run build<r>\n\
             \n\
             <blue>Happy bunning! 🐇<r>",
            bstr::BStr::new(self.template.label())
        ));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/create/SourceFileProjectGenerator.zig (887 lines)
//   confidence: medium
//   todos:      6
//   notes:      spawn_sync crate path + MultiArrayList .items(.field) accessors guessed; comptime @field dispatch reshaped to Tag::files(); duped-filename slices intentionally Box::leak'd to match Zig lifetime
// ──────────────────────────────────────────────────────────────────────────

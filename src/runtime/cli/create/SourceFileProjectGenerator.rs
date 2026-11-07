use crate::api::bun::process as bun_process;
use crate::api::bun::process::sync as spawn_sync;
use bun_ast::Source as LoggerSource;
use bun_bundler::ResolvedExports;
use bun_bundler::bundle_v2::BundleV2;
use bun_bundler::bundle_v2::DependenciesScannerResult;
use bun_bundler::mal_prelude::*;
use bun_collections::StringSet;
use bun_core::MutableString;
use bun_core::strings;
use bun_core::{Global, Output};
use bun_js_parser::js_lexer;
use bun_paths as path;
use bun_paths::fs::FileSystem;
use bun_paths::resolve_path;
use bun_sys::{self, Fd};

// Generate project files based on the entry point and dependencies
pub(crate) fn generate(
    overwrite: bool,
    entry_point: &[u8],
    result: &mut DependenciesScannerResult,
) -> Result<(), crate::Error> {
    let Some(react_component_export) = find_react_component_export(result.bundle_v2) else {
        Output::err_generic(
            "No component export found in <b>{}<r>",
            (bun_core::fmt::quote(entry_point),),
        );
        Output::flush();
        let writer = Output::error_writer_buffered();
        writer.write_all(
            b"\n\
              Please add an export to your file. For example:\n\
              \n\
              \x20  export default function MyApp() {\n\
              \x20    return <div>Hello World</div>;\n\
              \x20  }\n\
              \n",
        )?;

        Output::flush();
        Global::crash();
    };

    let has_tailwind_in_dependencies = result.dependencies.contains(b"tailwindcss")
        || result.dependencies.contains(b"bun-plugin-tailwind");
    let needs_to_inject_tailwind = !has_tailwind_in_dependencies
        && has_any_tailwind_classes_in_source_files(result.bundle_v2, result.reachable_files);

    let shadcn = get_shadcn_components(result.bundle_v2, result.reachable_files)?;
    let needs_to_inject_shadcn_ui = !shadcn.keys().is_empty();

    if needs_to_inject_tailwind {
        result.dependencies.insert(b"tailwindcss")?;
        result.dependencies.insert(b"bun-plugin-tailwind")?;
    }

    if needs_to_inject_shadcn_ui {
        // https://ui.shadcn.com/docs/installation/manual
        result.dependencies.insert(b"tw-animate-css")?;
        result.dependencies.insert(b"class-variance-authority")?;
        result.dependencies.insert(b"clsx")?;
        result.dependencies.insert(b"tailwind-merge")?;
        result.dependencies.insert(b"lucide-react")?;
    }

    let uses_tailwind = has_tailwind_in_dependencies || needs_to_inject_tailwind;

    // JSX-only for now. The versions of react & react-dom need to match up.
    let _ = result.dependencies.swap_remove(b"react");
    let _ = result.dependencies.swap_remove(b"react-dom");
    result.dependencies.insert(b"react-dom@19")?;
    result.dependencies.insert(b"react@19")?;

    let dev_dependencies: &[&[u8]] = &[b"@types/bun", b"@types/react@19", b"@types/react-dom@19"];

    let template = if needs_to_inject_shadcn_ui {
        Template::ReactShadcnSpa { components: shadcn }
    } else if uses_tailwind {
        Template::ReactTailwindSpa
    } else {
        Template::ReactSpa
    };

    generate_files(
        entry_point,
        result.dependencies.keys(),
        dev_dependencies,
        &template,
        react_component_export,
        overwrite,
    )?;

    Global::exit(0);
}

enum Written {
    Yes,
    AlreadyThere,
    /// Something else is at that path and `Existing` says it stays.
    Kept,
}

fn create_file(filename: &[u8], contents: &[u8], existing: Existing) -> bun_sys::Result<Written> {
    let flags = match bun_sys::File::read_from(Fd::cwd(), filename) {
        Ok(on_disk) => {
            let holds = |body: &[u8]| strings::eql_long(&on_disk, body, true);
            if holds(contents) {
                return Ok(Written::AlreadyThere);
            }
            let replace = match existing {
                Existing::Keep => false,
                Existing::ReplaceOwn(own_bodies) => own_bodies.iter().any(|body| holds(body)),
                Existing::Regenerate => true,
            };
            if !replace {
                return Ok(Written::Kept);
            }
            bun_sys::O::WRONLY | bun_sys::O::TRUNC
        }
        Err(err) if matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::EXCL
        }
        Err(err) => return Err(err),
    };

    // Create parent directories if needed
    let dirname = resolve_path::dirname::<path::platform::Auto>(filename);
    if !dirname.is_empty() {
        let _ = bun_sys::Dir::cwd().make_path(dirname);
    }

    match bun_sys::File::openat(Fd::cwd(), filename, flags, 0o644) {
        Ok(file) => {
            file.write_all(contents)?;
            Ok(Written::Yes)
        }
        // The read saw nothing, yet something is there: a dangling symlink.
        Err(err) if err.get_errno() == bun_sys::E::EEXIST => Ok(Written::Kept),
        Err(err) => Err(err),
    }
}

// Replace template placeholders with actual values
fn string_with_replacements(
    original_input: &[u8],
    basename: &[u8],
    relative_name: &[u8],
    react_component_export: &[u8],
) -> Vec<u8> {
    let mut input: Vec<u8> = original_input.to_vec();
    for (placeholder, value) in [
        (
            b"REPLACE_ME_WITH_YOUR_REACT_COMPONENT_EXPORT".as_slice(),
            react_component_export,
        ),
        (b"REPLACE_ME_WITH_YOUR_APP_BASE_NAME".as_slice(), basename),
        (
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME".as_slice(),
            relative_name,
        ),
    ] {
        input = strings::replace_owned(&input, placeholder, value);
    }
    input
}

fn print_and_run_bun(argv: &mut Vec<&[u8]>, failure: &str) -> Result<(), crate::Error> {
    if let Some(flag) = Global::ca_store_flag() {
        argv.insert(1, flag.as_bytes());
    }
    Output::command_out(Output::CommandArgv::List(argv));
    Output::flush();
    run_bun(argv, failure)
}

/// Runs `argv` with this executable as `argv[0]`. When that fails, exits the way it did.
fn run_bun(argv: &mut [&[u8]], failure: &str) -> Result<(), crate::Error> {
    argv[0] = bun_core::self_exe_path()?;

    let status = match spawn_sync::spawn(&spawn_sync::Options {
        argv: argv.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
        envp: None,
        cwd: Box::<[u8]>::from(FileSystem::instance().top_level_dir()),
        stderr: spawn_sync::SyncStdio::Inherit,
        stdout: spawn_sync::SyncStdio::Inherit,
        stdin: spawn_sync::SyncStdio::Inherit,

        #[cfg(windows)]
        windows: bun_process::WindowsOptions {
            loop_: bun_jsc::EventLoopHandle::init_mini(bun_event_loop::MiniEventLoop::init_global(
                None, None,
            )),
            ..Default::default()
        },
        ..Default::default()
    }) {
        Ok(Ok(spawn_result)) => spawn_result.status,
        Ok(Err(err)) => {
            Output::err(err, failure, ());
            Global::crash();
        }
        Err(err) => {
            Output::err(err, failure, ());
            Global::crash();
        }
    };

    if !status.is_ok() {
        if let Some(signal) = status.signal() {
            Global::exit(signal.to_exit_code() as u32);
        }
        if let bun_process::Status::Exited(exited) = status {
            Global::exit(exited.code as u32);
        }
        Global::crash();
    }

    Ok(())
}

fn generate_files(
    entry_point: &[u8],
    dependencies: &[Box<[u8]>],
    dev_dependencies: &[&[u8]],
    template: &Template,
    react_component_export: &[u8],
    overwrite: bool,
) -> Result<(), crate::Error> {
    let mut log = Logger {
        template: template.tag(),
        has_written_initial_message: false,
    };
    let basename = path::basename(entry_point);
    let extension = path::extension(basename);
    let basename = &basename[0..basename.len() - extension.len()];

    let mut normalized_buf = bun_paths::path_buffer_pool::get();
    let normalized_name: &[u8] = if bun_paths::is_absolute(entry_point) {
        resolve_path::relative_normalized_buf::<path::platform::Loose, true>(
            &mut normalized_buf,
            FileSystem::instance().top_level_dir(),
            entry_point,
        )
    } else {
        resolve_path::normalize_buf::<path::platform::Loose>(entry_point, &mut normalized_buf)
    };
    let normalized_name = &normalized_name[0..normalized_name.len() - extension.len()];

    let mut max_filename_len: usize = 0;
    let mut created: Vec<(&TemplateFile, Vec<u8>)> = Vec::new();
    let mut kept: Vec<Vec<u8>> = Vec::new();

    for file in template.tag().files() {
        let replaced = |input: &[u8]| {
            string_with_replacements(input, basename, normalized_name, react_component_export)
        };
        let file_name = replaced(file.name);
        let existing = if overwrite {
            Existing::Regenerate
        } else {
            file.existing
        };
        match create_file(&file_name, &replaced(file.content), existing) {
            // Two rows of a template can name one path.
            Ok(Written::Yes) => {
                kept.retain(|name| *name != file_name);
                max_filename_len = max_filename_len.max(file_name.len());
                created.push((file, file_name));
            }
            Ok(Written::AlreadyThere) => {}
            Ok(Written::Kept) => {
                if !kept.contains(&file_name) {
                    kept.push(file_name);
                }
            }
            Err(err) => {
                Output::err(err, "failed to create {}", (bstr::BStr::new(&file_name),));
                Global::crash();
            }
        }
    }

    for (file, filename) in &created {
        log.file(file, filename, max_filename_len);
    }
    for filename in &kept {
        bun_core::prettyln!(
            " ○ <r><yellow>{}<r> (already exists, skipping)",
            bstr::BStr::new(filename),
        );
    }

    if !dependencies.is_empty() || !dev_dependencies.is_empty() {
        if log.has_written_initial_message {
            Output::print(format_args!("\n"));
        }
        bun_core::pretty!(
            "<r>📦 <b>Auto-installing {} detected dependencies<r>\n",
            dependencies.len() + dev_dependencies.len()
        );
    }

    if !dependencies.is_empty() {
        let mut argv: Vec<&[u8]> = vec![b"bun", b"--only-missing", b"install", b"--"];
        argv.extend(dependencies.iter().map(|d| &d[..]));
        print_and_run_bun(&mut argv, "failed to install dependencies")?;
    }

    if !dev_dependencies.is_empty() {
        let mut argv: Vec<&[u8]> = vec![b"bun", b"--only-missing", b"add", b"-d"];
        argv.extend_from_slice(dev_dependencies);
        print_and_run_bun(&mut argv, "failed to install dependencies")?;
    }

    match &template {
        Template::ReactShadcnSpa { components } => {
            if !components.keys().is_empty() {
                let mut shadcn_argv: Vec<&[u8]> = vec![b"bun", b"x", b"shadcn@canary", b"add"];
                if strings::contains(normalized_name, b"/src") {
                    shadcn_argv.push(b"--src-dir");
                }
                shadcn_argv.push(b"-y");
                shadcn_argv.push(b"--");
                shadcn_argv.extend(components.keys().iter().map(|k| &k[..]));

                bun_core::prettyln!("\n<r>😎 <b>Setting up shadcn/ui components<r>");
                print_and_run_bun(&mut shadcn_argv, "failed to add shadcn components")?;

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
    run_bun(&mut [b"bun".as_slice(), b"dev"], "failed to start app")?;

    Global::exit(0);
}

// Check if any source files contain Tailwind classes
fn has_any_tailwind_classes_in_source_files(
    bundler: &BundleV2,
    reachable_files: &[bun_ast::Index],
) -> bool {
    let input_files = bundler.graph.input_files.slice();
    let sources = input_files.items_source();
    let loaders = input_files.items_loader();

    // Common Tailwind class patterns to look for
    const COMMON_TAILWIND_PATTERNS: &[&[u8]] = &[
        b"bg-",
        b"text-",
        b"p-",
        b"m-",
        b"flex",
        b"grid",
        b"border",
        b"rounded",
        b"shadow",
        b"hover:",
        b"focus:",
        b"dark:",
        b"sm:",
        b"md:",
        b"lg:",
        b"xl:",
        b"w-",
        b"h-",
        b"space-",
        b"gap-",
        b"items-",
        b"justify-",
        b"font-",
    ];

    for file in reachable_files {
        match loaders[file.get() as usize] {
            bun_ast::Loader::Tsx | bun_ast::Loader::Jsx => {
                let source: &LoggerSource = &sources[file.get() as usize];
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
                            for pattern in COMMON_TAILWIND_PATTERNS {
                                if bun_core::index_of(class_name, pattern).is_some() {
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
            _ => {}
        }
    }

    false
}

// Get list of shadcn components used in source files
fn get_shadcn_components(
    bundler: &BundleV2,
    reachable_files: &[bun_ast::Index],
) -> Result<StringSet, bun_alloc::AllocError> {
    let input_files = bundler.graph.input_files.slice();
    let loaders = input_files.items_loader();
    let all = bundler.graph.ast.items_import_records();
    let mut icons = StringSet::new();
    for file in reachable_files {
        if !matches!(
            loaders[file.get() as usize],
            bun_ast::Loader::Tsx | bun_ast::Loader::Jsx
        ) {
            continue;
        }
        for import_record in all[file.get() as usize].as_slice() {
            if import_record.path.text.starts_with(b"@/components/ui/") {
                icons.insert(&import_record.path.text[b"@/components/ui/".len()..])?;
            }
        }
    }

    Ok(icons)
}

fn find_react_component_export<'r>(bundler: &'r BundleV2<'_>) -> Option<&'r [u8]> {
    let input_files = bundler.graph.input_files.slice();
    let loaders = input_files.items_loader();
    let resolved_exports: &[ResolvedExports] = bundler.linker.graph.meta.items_resolved_exports();
    let sources = input_files.items_source();

    let entry_point_ids = bundler.graph.entry_points.as_slice();
    for entry_point_id in entry_point_ids {
        let loader = loaders[entry_point_id.get() as usize];
        if matches!(loader, bun_ast::Loader::Jsx | bun_ast::Loader::Tsx) {
            let source: &LoggerSource = &sources[entry_point_id.get() as usize];
            let exports = &resolved_exports[entry_point_id.get() as usize];

            // 1. Prioritize the default export
            if exports.contains(b"default") {
                return Some(b"default");
            }

            let export_names = exports.keys();
            if export_names.len() == 1 {
                // If there's only one export it can only be this.
                return Some(&export_names[0][..]);
            }

            if export_names.is_empty() {
                // If there are no exports, we can't determine the component name.
                continue;
            }

            let filename = source.path.name().non_unique_name_string_base();
            if filename.is_empty() {
                bun_core::hint::cold();
                continue;
            }

            // 2. Prioritize the export matching the filename with an uppercase first letter
            // such as export const App = () => { ... }
            if filename[0].is_ascii_uppercase()
                && js_lexer::is_identifier(filename)
                && exports.contains(filename)
            {
                return Some(filename);
            }

            if filename[0].is_ascii_lowercase() {
                let duped: &'static mut [u8] = crate::cli::cli_arena().alloc_slice_copy(filename);
                duped[0] -= 32;
                if js_lexer::is_identifier(duped) && exports.contains(duped) {
                    return Some(duped);
                }

                // Extremely naive pascal case conversion: does not handle unicode.
                let mut output_index: usize = 0;
                let mut capitalize_next = false;
                for input_index in 0..duped.len() {
                    if matches!(duped[input_index], b' ' | b'-' | b'_')
                        || (output_index == 0
                            && !js_lexer::is_identifier_start(duped[input_index] as i32))
                    {
                        capitalize_next = true;
                        continue;
                    }
                    duped[output_index] = if output_index == 0 || capitalize_next {
                        duped[input_index].to_ascii_uppercase()
                    } else {
                        duped[input_index]
                    };
                    capitalize_next = false;
                    output_index += 1;
                }

                // "my-app", "my_app", "My-App" -> "MyApp"
                if exports.contains(&duped[0..output_index]) {
                    return Some(&duped[0..output_index]);
                }

                // "my-app", "My-App" -> "Myapp"
                if output_index > 1 {
                    duped[1..output_index].make_ascii_lowercase();
                }

                if exports.contains(&duped[0..output_index]) {
                    return Some(&duped[0..output_index]);
                }
            }

            let Ok(name_to_try) = MutableString::ensure_valid_identifier(filename) else {
                return None;
            };
            if exports.contains(&name_to_try) {
                return Some(crate::cli::cli_dupe(&name_to_try));
            }

            // No idea now: one that looks like a react component, else the first one.
            for export_name in export_names {
                if !export_name.is_empty() && export_name[0].is_ascii_uppercase() {
                    return Some(&export_name[..]);
                }
            }
            return Some(&export_names[0][..]);
        }
    }

    None
}

/// What a template row does when another file is already at its path. `--force` regenerates every row.
#[derive(Clone, Copy)]
pub(crate) enum Existing {
    Keep,
    /// Replaced only when it holds one of these bodies, each of which `bun create` itself writes.
    ReplaceOwn(&'static [&'static [u8]]),
    Regenerate,
}

pub(crate) struct TemplateFile {
    pub name: &'static [u8],
    pub(crate) content: &'static [u8],
    pub reason: Reason,
    pub(crate) existing: Existing,
}

impl TemplateFile {
    const fn keep(name: &'static [u8], content: &'static [u8], reason: Reason) -> Self {
        Self {
            name,
            content,
            reason,
            existing: Existing::Keep,
        }
    }
    const fn replace_own(
        name: &'static [u8],
        content: &'static [u8],
        reason: Reason,
        own_bodies: &'static [&'static [u8]],
    ) -> Self {
        Self {
            name,
            content,
            reason,
            existing: Existing::ReplaceOwn(own_bodies),
        }
    }
    const fn regenerate(name: &'static [u8], content: &'static [u8], reason: Reason) -> Self {
        Self {
            name,
            content,
            reason,
            existing: Existing::Regenerate,
        }
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
pub(crate) mod react_tailwind_spa {
    use super::*;

    pub(crate) const FILES: &[TemplateFile] = &[
        TemplateFile::regenerate(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts",
            SHARED_BUILD_TS,
            Reason::Build,
        ),
        // SHADCN_CSS stays out: after `shadcn add`, later runs pick this template and must keep that stylesheet.
        TemplateFile::replace_own(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css",
            TAILWIND_CSS,
            Reason::Css,
            &[REACT_CSS, SHADCN_INDEX_CSS],
        ),
        TemplateFile::regenerate(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html",
            SHARED_HTML,
            Reason::Html,
        ),
        TemplateFile::regenerate(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx",
            SHARED_CLIENT_TSX,
            Reason::Bun,
        ),
        TemplateFile::keep(b"bunfig.toml", SHARED_BUNFIG_TOML, Reason::Bun),
        TemplateFile::keep(b"package.json", SHARED_PACKAGE_JSON, Reason::Npm),
    ];
}

const REACT_CSS: &[u8] =
    include_bytes!("projects/react-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css");
const TAILWIND_CSS: &[u8] =
    include_bytes!("projects/react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css");
const SHADCN_CSS: &[u8] =
    include_bytes!("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css");
const SHADCN_INDEX_CSS: &[u8] = include_bytes!("projects/react-shadcn-spa/styles/index.css");

const SHARED_BUILD_TS: &[u8] =
    include_bytes!("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts");
const SHARED_CLIENT_TSX: &[u8] =
    include_bytes!("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx");
const SHARED_HTML: &[u8] =
    include_bytes!("projects/react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html");
const SHARED_PACKAGE_JSON: &[u8] = include_bytes!("projects/react-shadcn-spa/package.json");
const SHARED_BUNFIG_TOML: &[u8] = include_bytes!("projects/react-shadcn-spa/bunfig.toml");

// Template for basic React project
pub(crate) mod react_spa {
    use super::*;

    pub(crate) const FILES: &[TemplateFile] = &[
        TemplateFile::regenerate(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts",
            SHARED_BUILD_TS,
            Reason::Build,
        ),
        TemplateFile::keep(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css",
            REACT_CSS,
            Reason::Css,
        ),
        TemplateFile::regenerate(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html",
            SHARED_HTML,
            Reason::Html,
        ),
        TemplateFile::regenerate(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx",
            SHARED_CLIENT_TSX,
            Reason::Bun,
        ),
        TemplateFile::keep(
            b"package.json",
            include_bytes!("projects/react-spa/package.json"),
            Reason::Npm,
        ),
    ];
}

// Template for React + Shadcn project
pub(crate) mod react_shadcn_spa {
    use super::*;

    pub(crate) const FILES: &[TemplateFile] = &[
        TemplateFile::keep(
            b"lib/utils.ts",
            include_bytes!("projects/react-shadcn-spa/lib/utils.ts"),
            Reason::Shadcn,
        ),
        // For `./index.tsx` this is also the path of the `.css` rows, which therefore list SHADCN_INDEX_CSS.
        TemplateFile::keep(b"index.css", SHADCN_INDEX_CSS, Reason::Shadcn),
        TemplateFile::regenerate(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts",
            SHARED_BUILD_TS,
            Reason::Bun,
        ),
        TemplateFile::regenerate(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.client.tsx",
            SHARED_CLIENT_TSX,
            Reason::Bun,
        ),
        TemplateFile::replace_own(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css",
            SHADCN_CSS,
            Reason::Css,
            &[REACT_CSS, TAILWIND_CSS, SHADCN_INDEX_CSS],
        ),
        TemplateFile::regenerate(
            b"REPLACE_ME_WITH_YOUR_APP_FILE_NAME.html",
            SHARED_HTML,
            Reason::Html,
        ),
        // For `./styles/globals.tsx` the `.css` row above has just written SHADCN_CSS to this path.
        TemplateFile::replace_own(
            b"styles/globals.css",
            include_bytes!("projects/react-shadcn-spa/styles/globals.css"),
            Reason::Shadcn,
            &[SHADCN_CSS],
        ),
        TemplateFile::keep(b"bunfig.toml", SHARED_BUNFIG_TOML, Reason::Bun),
        TemplateFile::keep(b"package.json", SHARED_PACKAGE_JSON, Reason::Npm),
        TemplateFile::keep(
            b"tsconfig.json",
            include_bytes!("projects/react-shadcn-spa/tsconfig.json"),
            Reason::Tsc,
        ),
        TemplateFile::keep(
            b"components.json",
            include_bytes!("projects/react-shadcn-spa/components.json"),
            Reason::Shadcn,
        ),
    ];
}

// Template type to handle different project types
#[derive(bun_core::EnumTag)]
#[enum_tag(existing = Tag)]
pub(crate) enum Template {
    ReactTailwindSpa,
    ReactSpa,
    ReactShadcnSpa { components: StringSet },
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tag {
    ReactTailwindSpa,
    ReactSpa,
    ReactShadcnSpa,
}

impl Tag {
    pub(crate) fn label(self) -> &'static [u8] {
        match self {
            Tag::ReactTailwindSpa => b"React + Tailwind",
            Tag::ReactSpa => b"React",
            Tag::ReactShadcnSpa => b"React + shadcn/ui + Tailwind",
        }
    }

    pub(crate) fn files(self) -> &'static [TemplateFile] {
        match self {
            Tag::ReactTailwindSpa => react_tailwind_spa::FILES,
            Tag::ReactSpa => react_spa::FILES,
            Tag::ReactShadcnSpa => react_shadcn_spa::FILES,
        }
    }
}

pub(crate) struct Logger {
    pub(crate) has_written_initial_message: bool,
    pub(crate) template: Tag,
}

impl Logger {
    pub(crate) fn file(&mut self, template_file: &TemplateFile, name: &[u8], max_name_len: usize) {
        self.has_written_initial_message = true;
        bun_core::pretty!(" <green>create<r>  ");
        bun_core::pretty!("{}", bstr::BStr::new(name));
        for _ in name.len()..max_name_len {
            bun_core::pretty!(" ");
        }
        bun_core::prettyln!("   <d>{}<r>", <&'static str>::from(template_file.reason));
    }

    pub(crate) fn if_new(&mut self) {
        if !self.has_written_initial_message {
            return;
        }

        bun_core::prettyln!(
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
        );
    }
}

use bstr::BStr;
use bun_ast::{E, Expr, ExprData, Loc};
use bun_bundler::options::{OutputFile, OutputFileValue, OutputKind};
use bun_collections::VecExt;
use bun_core::{Global, Output, UnwrapOrOom, ZBox};
use bun_paths::platform::Auto;
use bun_paths::resolve_path::join_abs_string;

use super::command::ContextData;
use super::script_or_command::nearest_package_json;

pub(crate) const TRIMS_RUNTIME_BY_DEFAULT: bool = false;

const INDEX_FILES: [&[u8]; 4] = [b"index.ts", b"index.tsx", b"index.mts", b"index.js"];

pub(crate) struct EntryPoint {
    pub(crate) path: Box<[u8]>,
    pub(crate) executable_name: Box<[u8]>,
}

fn file_in(dir: &[u8], path: &[u8]) -> Option<Box<[u8]>> {
    let joined = ZBox::from_bytes(join_abs_string::<Auto>(dir, &[path]));
    let kind = bun_sys::exists_at_type(bun_core::Fd::cwd(), &joined).ok()?;
    (kind == bun_sys::ExistsAtType::File).then(|| Box::from(joined.as_bytes()))
}

fn without_scope(package_name: &[u8]) -> &[u8] {
    match bun_core::strings::last_index_of_char(package_name, b'/') {
        Some(slash) if package_name.starts_with(b"@") => &package_name[slash + 1..],
        _ => package_name,
    }
}

fn find_library_entry_point(cwd: &[u8], outdir: &[u8]) -> Result<EntryPoint, String> {
    const TYPESCRIPT: [&[u8]; 6] = [b"index.ts", b"index.tsx", b"index.mts", b"src/index.ts", b"src/index.tsx", b"src/index.mts"];
    const JAVASCRIPT: [&[u8]; 4] = [b"index.js", b"index.mjs", b"src/index.js", b"src/index.mjs"];
    let project = nearest_package_json(cwd);
    let dir = project.as_ref().map_or(cwd, |found| found.0);
    let package_json = project.as_ref().and_then(|(_, path, contents)| parse_package_json(path, contents));
    let named: Vec<&[u8]> = [&b"module"[..], b"main"].iter().filter_map(|field| package_json.as_ref()?.get(field)?.as_utf8_string_literal().map(|path| &*crate::cli::cli_arena().alloc_slice_copy(path))).collect();
    let is_typescript = |path: &&[u8]| [&b".ts"[..], b".tsx", b".mts"].iter().any(|extension| path.ends_with(extension));
    let outdir = [join_abs_string::<Auto>(cwd, &[outdir]), bun_paths::SEP_STR.as_bytes()].concat();
    let candidates = (named.iter().copied().filter(is_typescript).chain(TYPESCRIPT)).chain(named.iter().copied().filter(|path| !is_typescript(path)).chain(JAVASCRIPT));
    match candidates.filter_map(|path| file_in(dir, path)).find(|path| !path.starts_with(&outdir)) {
        Some(path) => Ok(EntryPoint { path, executable_name: Box::default() }),
        None => Err(format!("No entry point. There is no \"module\" or \"main\" in package.json that is a source file, and no index.ts, index.tsx, index.mts or index.js in {} or in its src folder", BStr::new(dir))),
    }
}

fn find_entry_point(cwd: &[u8]) -> Result<EntryPoint, String> {
    let index_file_in = |dir: &[u8]| INDEX_FILES.iter().find_map(|name| file_in(dir, name));
    let index_files = "index.ts, index.tsx, index.mts or index.js";
    let project = nearest_package_json(cwd);
    let has_own_package_json = project.as_ref().is_some_and(|found| found.0 == bun_core::strings::without_trailing_slash(cwd));
    if !has_own_package_json && let Some(path) = index_file_in(cwd) {
        return Ok(EntryPoint { path, executable_name: Box::from(bun_paths::basename(cwd)) });
    }
    let Some((dir, package_json_path, contents)) = project else {
        return Err(format!("No entry point. There is no package.json and no {index_files} in {}", BStr::new(cwd)));
    };
    let shown = BStr::new(&package_json_path);
    bun_ast::initialize_store();
    let source = bun_ast::Source::init_path_string(&package_json_path[..], &contents[..]);
    let (mut log, bump) = (bun_ast::Log::init(), bun_alloc::Arena::new());
    let Ok(json) = bun_parsers::json::parse_package_json_utf8(&source, &mut log, &bump) else {
        return Err(format!("No entry point, and {shown} could not be parsed"));
    };
    let text_of = |field: &[u8]| json.get(field).and_then(|value| value.as_string(&bump)).filter(|text| !text.is_empty());
    let package_name = text_of(b"name").map_or(bun_paths::basename(dir), without_scope);
    let named_by = |field: &str, path: &[u8], executable_name: &[u8]| match file_in(dir, path) {
        Some(path) => Ok(EntryPoint { path, executable_name: Box::from(executable_name) }),
        None => Err(format!("\"{field}\" in {shown} is \"{}\", which is not a file", BStr::new(path))),
    };
    if let Some(path) = text_of(b"bin") {
        return named_by("bin", path, package_name);
    }
    if let Some(bun_ast::ExprData::EObject(bin)) = json.get(b"bin").map(|bin| bin.data) {
        let executables: Vec<(&[u8], &[u8])> = (bin.properties.slice().iter())
            .filter_map(|property| Some((property.key.as_ref()?.as_string(&bump)?, property.value.as_ref()?.as_string(&bump)?)))
            .collect();
        match executables.iter().find(|(name, _)| executables.len() == 1 || *name == package_name) {
            Some((name, path)) => return named_by("bin", path, name),
            None if executables.is_empty() => {}
            None => {
                let mut message = format!("\"bin\" in {shown} has {} entries, and none is named \"{}\". Choose one:", executables.len(), BStr::new(package_name));
                for (name, path) in executables {
                    message.push_str(&format!("\n  bun compile {} --outfile {}", BStr::new(path), BStr::new(name)));
                }
                return Err(message);
            }
        }
    }
    for field in ["module", "main"] {
        if let Some(path) = text_of(field.as_bytes()) {
            return named_by(field, path, package_name);
        }
    }
    match index_file_in(dir) {
        Some(path) => Ok(EntryPoint { path, executable_name: Box::from(package_name) }),
        None => Err(format!("No entry point. {shown} has no \"bin\", \"module\" or \"main\", and there is no {index_files} beside it")),
    }
}

#[cold]
pub(crate) fn find_entry_point_or_exit(cwd: &[u8], library_outdir: Option<&[u8]>) -> EntryPoint {
    match library_outdir.map_or_else(|| find_entry_point(cwd), |outdir| find_library_entry_point(cwd, outdir)) {
        Ok(entry_point) => entry_point,
        Err(message) => {
            Output::err_generic("{}", (message.as_str(),));
            bun_core::pretty_error!(
                "\nUsage:\n  <d>$<r> <b><green>bun compile<r> \\<entrypoint\\> <cyan>[...flags]<r>\n\nTo see full documentation:\n  <d>$<r> <b><green>bun compile<r> --help\n"
            );
            Output::flush();
            Global::exit(1);
        }
    }
}

pub(crate) const DEFAULT_LIBRARY_OUTDIR: &[u8] = b"dist";
const FIELDS_OF_EXTERNAL_PACKAGES: [&[u8]; 3] = [b"dependencies", b"peerDependencies", b"optionalDependencies"];
const FIELDS_COPIED_FIRST: [&[u8]; 11] =
    [b"name", b"version", b"description", b"keywords", b"homepage", b"bugs", b"license", b"author", b"contributors", b"funding", b"repository"];
const FIELDS_COPIED_LAST: [&[u8]; 8] =
    [b"engines", b"os", b"cpu", b"dependencies", b"peerDependencies", b"peerDependenciesMeta", b"optionalDependencies", b"publishConfig"];
const FILES_COPIED: [&[u8]; 3] = [b"README", b"LICENSE", b"LICENCE"];

fn parse_package_json(path: &[u8], contents: &[u8]) -> Option<Expr> {
    bun_ast::initialize_store();
    let arena = crate::cli::cli_arena();
    let source = bun_ast::Source::init_path_string(&*arena.alloc_slice_copy(path), &*arena.alloc_slice_copy(contents));
    bun_parsers::json::parse_package_json_utf8(&source, &mut bun_ast::Log::init(), arena).ok()
}

fn fail(message: &str) -> ! {
    Output::err_generic("{}", (message,));
    Global::exit(1);
}

#[cold]
pub(crate) fn configure_library(ctx: &mut ContextData) {
    let cwd = ctx.args.absolute_working_dir.clone().unwrap_or_default();
    let outdir = join_abs_string::<Auto>(&cwd, &[&ctx.bundler_options.outdir]).to_vec();
    let project = nearest_package_json(&cwd);
    let project_directory = project.as_ref().map_or(bun_core::strings::without_trailing_slash(&cwd), |found| found.0);
    let holds_the_project = project_directory.strip_prefix(&outdir[..]).is_some_and(|below| below.is_empty() || bun_paths::is_sep_any(below[0]));
    if holds_the_project {
        fail(&format!("--library writes a package.json into --outdir, and {} is the project's own folder. Choose a folder inside it, such as --outdir=dist", BStr::new(&outdir)));
    }
    let Some((_, path, contents)) = project else { return };
    let Some(package_json) = parse_package_json(&path, &contents) else {
        fail(&format!("{} could not be parsed", BStr::new(&path)));
    };
    for field in FIELDS_OF_EXTERNAL_PACKAGES {
        let Some(ExprData::EObject(packages)) = package_json.get(field).map(|packages| packages.data) else { continue };
        let names = packages.properties.slice().iter().filter_map(|package| package.key.as_ref()?.as_utf8_string_literal());
        ctx.args.external.extend(names.map(Box::from));
    }
}

struct Exported {
    subpath: Vec<u8>,
    source: Box<[u8]>,
    javascript: Vec<u8>,
    declarations: Option<Vec<u8>>,
    typed: Option<Vec<u8>>,
}

fn exported_files(output_files: &[OutputFile], kind_of_entry_points: OutputKind) -> Vec<Exported> {
    use bun_sema_driver::typed_packages::{declarations_path_beside, typed_path_beside};
    let path_of = |file: &OutputFile| {
        let mut path = bun_core::strings::remove_leading_dot_slash(&file.dest_path).to_vec();
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(&mut path);
        path
    };
    let written = |kind: OutputKind, path: Option<Vec<u8>>| path.filter(|path| output_files.iter().any(|file| file.output_kind == kind && path_of(file) == *path));
    let mut exported: Vec<Exported> = (output_files.iter())
        .filter(|file| file.output_kind == kind_of_entry_points && file.loader.is_javascript_like())
        .map(|file| {
            let javascript = path_of(file);
            let stem = &javascript[..javascript.len() - bun_paths::extension(&javascript).len()];
            let subpath = match stem.strip_suffix(b"index") {
                Some(b"") => b".".to_vec(),
                Some(folder) if folder.ends_with(b"/") => [&b"./"[..], &folder[..folder.len() - 1]].concat(),
                _ => [&b"./"[..], stem].concat(),
            };
            Exported {
                subpath,
                source: Box::from(file.src_path.text),
                declarations: written(OutputKind::Declaration, declarations_path_beside(&javascript)),
                typed: written(OutputKind::Sound, typed_path_beside(&javascript)),
                javascript,
            }
        })
        .collect();
    if let [only] = &mut exported[..] {
        only.subpath = b".".to_vec();
    }
    exported.sort_by(|a, b| a.subpath.cmp(&b.subpath));
    exported
}

fn valid_package_name(folder: &[u8]) -> Vec<u8> {
    let mut name: Vec<u8> = (folder.iter())
        .map(|byte| match byte.to_ascii_lowercase() {
            byte @ (b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.') => byte,
            _ => b'-',
        })
        .skip_while(|byte| matches!(byte, b'.' | b'_' | b'-'))
        .collect();
    name.truncate(214);
    if name.is_empty() { b"package".to_vec() } else { name }
}

fn asset(path: &[u8], bytes: Vec<u8>) -> OutputFile {
    OutputFile {
        loader: bun_ast::Loader::File,
        input_loader: bun_ast::Loader::File,
        output_kind: OutputKind::Asset,
        dest_path: Box::from(path),
        size: bytes.len(),
        size_without_sourcemap: bytes.len(),
        value: OutputFileValue::Buffer { bytes: bytes.into_boxed_slice() },
        ..OutputFile::zero_value()
    }
}

#[cold]
pub(crate) fn add_package_files(ctx: &ContextData, output_files: &mut Vec<OutputFile>) {
    let arena = crate::cli::cli_arena();
    let cwd = ctx.args.absolute_working_dir.as_deref().unwrap_or_default();
    let outdir = join_abs_string::<Auto>(cwd, &[&ctx.bundler_options.outdir]).to_vec();
    let project = nearest_package_json(cwd);
    let project_directory = project.as_ref().map_or(bun_core::strings::without_trailing_slash(cwd), |found| found.0);
    let existing = project.as_ref().and_then(|(_, path, contents)| parse_package_json(path, contents));

    let text = |value: &[u8]| Expr::init(E::String::init(&*arena.alloc_slice_copy(value)), Loc::EMPTY);
    let relative = |path: &[u8]| text(&[&b"./"[..], path].concat());
    let put = |object: &mut E::Object, key: &[u8], value: Expr| object.put(arena, arena.alloc_slice_copy(key), value).unwrap_or_oom();
    let copy = |package: &mut E::Object, fields: &[&[u8]]| {
        for &field in fields {
            if let Some(value) = existing.as_ref().and_then(|existing| existing.get(field)) {
                put(package, field, value);
            }
        }
    };

    let exported = exported_files(output_files, if ctx.bundler_options.transform_only { OutputKind::Chunk } else { OutputKind::EntryPoint });
    let mut package = E::Object::default();
    copy(&mut package, &FIELDS_COPIED_FIRST[..]);
    if !package.has_property(b"name") {
        put(&mut package, b"name", text(&valid_package_name(bun_paths::basename(project_directory))[..]));
    }
    if !package.has_property(b"version") {
        put(&mut package, b"version", text(b"0.0.0"));
    }
    put(&mut package, b"type", text(b"module"));
    if let Some(main) = exported.iter().find(|file| file.subpath == b".").or(exported.first()) {
        put(&mut package, b"main", relative(&main.javascript[..]));
        put(&mut package, b"module", relative(&main.javascript[..]));
        if let Some(declarations) = &main.declarations {
            put(&mut package, b"types", relative(&declarations[..]));
        }
    }
    let mut exports = E::Object::default();
    for file in &exported {
        let mut conditions = E::Object::default();
        if let Some(declarations) = &file.declarations {
            put(&mut conditions, b"types", relative(&declarations[..]));
        }
        if let Some(typed) = &file.typed {
            put(&mut conditions, bun_sema_driver::typed_packages::CONDITION, relative(&typed[..]));
        }
        put(&mut conditions, b"default", relative(&file.javascript[..]));
        put(&mut exports, &file.subpath[..], Expr::init(conditions, Loc::EMPTY));
    }
    put(&mut exports, b"./package.json", text(b"./package.json"));
    put(&mut package, b"exports", Expr::init(exports, Loc::EMPTY));

    let emitted_as = |path: &[u8]| {
        let path = join_abs_string::<Auto>(project_directory, &[path]).to_vec();
        let found = exported.iter().find(|file| *file.source == path[..] || join_abs_string::<Auto>(&outdir, &[&file.javascript[..]]) == &path[..])?;
        Some(relative(&found.javascript[..]))
    };
    let existing_bin = existing.as_ref().and_then(|existing| existing.get(b"bin"));
    if let Some(path) = existing_bin.as_ref().and_then(|bin| emitted_as(bin.as_utf8_string_literal()?)) {
        put(&mut package, b"bin", path);
    } else if let Some(ExprData::EObject(executables)) = existing_bin.map(|bin| bin.data) {
        let mut bin = E::Object::default();
        for executable in executables.properties.slice() {
            let (Some(name), Some(path)) = (&executable.key, &executable.value) else { continue };
            if let (Some(name), Some(path)) = (name.as_utf8_string_literal(), path.as_utf8_string_literal().and_then(|path| emitted_as(path))) {
                put(&mut bin, name, path);
            }
        }
        if !bin.properties.is_empty() {
            put(&mut package, b"bin", Expr::init(bin, Loc::EMPTY));
        }
    }

    if let Ok(fd) = bun_sys::open_dir_for_iteration(bun_core::Fd::cwd(), project_directory) {
        let directory = bun_sys::Dir { fd };
        let mut entries = bun_sys::dir_iterator::iterate(directory.fd());
        let mut copied: Vec<Vec<u8>> = Vec::new();
        while let Ok(Some(entry)) = entries.next() {
            let name = entry.name.slice_u8();
            let is_copied = FILES_COPIED.iter().any(|stem| {
                name.split_at_checked(stem.len()).is_some_and(|(start, extension)| start.eq_ignore_ascii_case(stem) && (extension.is_empty() || extension[0] == b'.'))
            });
            if is_copied && entry.kind == bun_sys::FileKind::File {
                copied.push(name.to_vec());
            }
        }
        copied.sort();
        for name in copied {
            if let Ok(bytes) = bun_sys::File::read_from(directory.fd(), &name[..]) {
                output_files.push(asset(&name[..], bytes));
            }
        }
    }

    let mut files = E::Array::default();
    let mut paths: Vec<Vec<u8>> = output_files.iter().map(|file| bun_core::strings::remove_leading_dot_slash(&file.dest_path).to_vec()).collect();
    paths.iter_mut().for_each(|path| bun_paths::resolve_path::platform_to_posix_in_place::<u8>(path));
    paths.sort();
    for path in &paths {
        files.push(arena, text(&path[..])).unwrap_or_oom();
    }
    put(&mut package, b"files", Expr::init(files, Loc::EMPTY));
    if let Some(side_effects) = existing.as_ref().and_then(|existing| existing.get(b"sideEffects")).filter(|value| value.as_bool().is_some()) {
        put(&mut package, b"sideEffects", side_effects);
    }
    copy(&mut package, &FIELDS_COPIED_LAST[..]);

    let mut buffer = bun_js_printer::BufferWriter::init();
    buffer.append_newline = true;
    let mut writer = bun_js_printer::BufferPrinter::init(buffer);
    let source = bun_ast::Source::init_path_string(&b"package.json"[..], &b""[..]);
    if let Err(error) = bun_js_printer::print_json(&mut writer, Expr::init(package, Loc::EMPTY), &source, Default::default()) {
        fail(&format!("failed to write package.json: {}", error.name()));
    }
    output_files.push(asset(b"package.json", writer.ctx.written_without_trailing_zero().to_vec()));
}

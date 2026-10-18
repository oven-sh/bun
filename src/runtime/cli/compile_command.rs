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
    pub(crate) more_of_a_library: Vec<Box<[u8]>>,
    pub(crate) executable_name: Box<[u8]>,
}

impl EntryPoint {
    fn of_executable(path: Box<[u8]>, executable_name: &[u8]) -> EntryPoint {
        EntryPoint { path, more_of_a_library: Vec::new(), executable_name: Box::from(executable_name) }
    }
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

fn targets_of(exports: &Expr, found: &mut Vec<Vec<u8>>) {
    match &exports.data {
        ExprData::EObject(conditions) => conditions.properties.slice().iter().filter_map(|condition| condition.value.as_ref()).for_each(|inner| targets_of(inner, found)),
        ExprData::EArray(fallbacks) => fallbacks.items.slice().iter().for_each(|inner| targets_of(inner, found)),
        _ => found.extend(exports.as_utf8_string_literal().map(<[u8]>::to_vec)),
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
    let mut exported = Vec::new();
    package_json.as_ref().and_then(|package_json| package_json.get(b"exports")).iter().for_each(|exports| targets_of(exports, &mut exported));
    let is_declaration_file = |path: &[u8]| path.ends_with(b".d.ts") || path.ends_with(b".d.mts");
    let mut sources: Vec<Box<[u8]>> = Vec::new();
    for path in exported.iter().filter(|path| is_typescript(&&path[..]) && !is_declaration_file(path)).filter_map(|path| file_in(dir, path)) {
        if !path.starts_with(&outdir) && !sources.contains(&path) {
            sources.push(path);
        }
    }
    if !sources.is_empty() {
        return Ok(EntryPoint { path: sources.remove(0), more_of_a_library: sources, executable_name: Box::default() });
    }
    let candidates = (named.iter().copied().filter(is_typescript).chain(TYPESCRIPT)).chain(named.iter().copied().filter(|path| !is_typescript(path)).chain(JAVASCRIPT));
    match candidates.filter_map(|path| file_in(dir, path)).find(|path| !path.starts_with(&outdir)) {
        Some(path) => Ok(EntryPoint::of_executable(path, b"")),
        None => Err(format!("No entry point. There is no \"exports\", \"module\" or \"main\" in package.json that is a source file, and no index.ts, index.tsx, index.mts or index.js in {} or in its src folder", BStr::new(dir))),
    }
}

fn find_entry_point(cwd: &[u8]) -> Result<EntryPoint, String> {
    let index_file_in = |dir: &[u8]| INDEX_FILES.iter().find_map(|name| file_in(dir, name));
    let index_files = "index.ts, index.tsx, index.mts or index.js";
    let project = nearest_package_json(cwd);
    let has_own_package_json = project.as_ref().is_some_and(|found| found.0 == bun_core::strings::without_trailing_slash(cwd));
    if !has_own_package_json && let Some(path) = index_file_in(cwd) {
        return Ok(EntryPoint::of_executable(path, bun_paths::basename(cwd)));
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
    let package_name = text_of(b"name").map_or_else(|| bun_paths::basename(dir), without_scope);
    let named_by = |field: &str, path: &[u8], executable_name: &[u8]| match file_in(dir, path) {
        Some(path) => Ok(EntryPoint::of_executable(path, executable_name)),
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
        Some(path) => Ok(EntryPoint::of_executable(path, package_name)),
        None => Err(format!("No entry point. {shown} has no \"bin\", \"module\" or \"main\", and there is no {index_files} beside it")),
    }
}

#[cold]
pub(crate) fn find_entry_point_or_exit(cwd: &[u8], library_outdir: Option<&[u8]>) -> EntryPoint {
    if let Some(outdir) = library_outdir {
        refuse_outdir_that_holds_the_project(cwd, outdir);
    }
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

fn refuse_outdir_that_holds_the_project(cwd: &[u8], outdir: &[u8]) {
    let outdir = join_abs_string::<Auto>(cwd, &[outdir]).to_vec();
    let project = nearest_package_json(cwd);
    let project_directory = project.as_ref().map_or_else(|| bun_core::strings::without_trailing_slash(cwd), |found| found.0);
    let holds_the_project = project_directory.strip_prefix(&outdir[..]).is_some_and(|below| below.is_empty() || bun_paths::is_sep_any(below[0]));
    if holds_the_project {
        fail(&format!("--library writes a package.json into --outdir, and {} is the project's own folder. Choose a folder inside it, such as --outdir=dist", BStr::new(&outdir)));
    }
}

#[cold]
pub(crate) fn configure_library(ctx: &mut ContextData) {
    let cwd = ctx.args.absolute_working_dir.clone().unwrap_or_default();
    refuse_outdir_that_holds_the_project(&cwd, &ctx.bundler_options.outdir);
    let outdir = join_abs_string::<Auto>(&cwd, &[&ctx.bundler_options.outdir]).to_vec();
    let project = nearest_package_json(&cwd);
    let inside_outdir = [&outdir[..], bun_paths::SEP_STR.as_bytes()].concat();
    if let Some(entry_point) = ctx.args.entry_points.iter().find(|entry_point| join_abs_string::<Auto>(&cwd, &[&entry_point[..]]).starts_with(&inside_outdir)) {
        fail(&format!("the entry point {} is inside --outdir, where it would be overwritten. Choose another --outdir", BStr::new(entry_point)));
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

fn text(value: &[u8]) -> Expr {
    Expr::init(E::String::init(&*crate::cli::cli_arena().alloc_slice_copy(value)), Loc::EMPTY)
}

fn relative(path: &[u8]) -> Expr {
    text(&[&b"./"[..], path].concat())
}

fn put(object: &mut E::Object, key: &[u8], value: Expr) {
    let arena = crate::cli::cli_arena();
    object.put(arena, arena.alloc_slice_copy(key), value).unwrap_or_oom();
}

struct Written<'a> {
    exported: &'a [Exported],
    project_directory: &'a [u8],
    outdir: &'a [u8],
}

struct Kept {
    files: Vec<usize>,
    conditions: Option<Expr>,
}

struct LeftOut {
    conditions: Vec<Vec<u8>>,
    target: Vec<u8>,
}

impl Written<'_> {
    fn at(&self, path: &[u8]) -> Option<usize> {
        let path = join_abs_string::<Auto>(self.project_directory, &[path]).to_vec();
        self.exported.iter().position(|file| *file.source == path[..] || join_abs_string::<Auto>(self.outdir, &[&file.javascript[..]]) == &path[..])
    }

    fn conditions_of(&self, file: usize) -> Expr {
        let file = &self.exported[file];
        let mut conditions = E::Object::default();
        if let Some(declarations) = &file.declarations {
            put(&mut conditions, b"types", relative(&declarations[..]));
        }
        if let Some(typed) = &file.typed {
            put(&mut conditions, bun_sema_driver::typed_packages::CONDITION, relative(&typed[..]));
        }
        put(&mut conditions, b"default", relative(&file.javascript[..]));
        Expr::init(conditions, Loc::EMPTY)
    }

    fn written_as(&self, kept: &Kept) -> Expr {
        kept.conditions.unwrap_or_else(|| self.conditions_of(kept.files[0]))
    }

    fn keep(&self, authored: &Expr, under: &mut Vec<Vec<u8>>, left_out: &mut Vec<LeftOut>) -> Option<Kept> {
        if let Some(target) = authored.as_utf8_string_literal() {
            let file = self.at(target);
            if file.is_none() {
                left_out.push(LeftOut { conditions: under.clone(), target: target.to_vec() });
            }
            return Some(Kept { files: vec![file?], conditions: None });
        }
        match &authored.data {
            ExprData::EArray(fallbacks) => fallbacks.items.slice().iter().find_map(|fallback| self.keep(fallback, under, left_out)),
            ExprData::EObject(conditions) => {
                let mut kept: Vec<(&[u8], Kept)> = Vec::new();
                for condition in conditions.properties.slice() {
                    let (Some(name), Some(inner)) = (condition.key.as_ref().and_then(Expr::as_utf8_string_literal), &condition.value) else { continue };
                    if name == b"types" && inner.as_utf8_string_literal().is_some() {
                        continue;
                    }
                    under.push(name.to_vec());
                    kept.extend(self.keep(inner, under, left_out).map(|inner| (name, inner)));
                    under.pop();
                }
                let files: Vec<usize> = kept.iter().flat_map(|(_, inner)| inner.files.iter().copied()).collect();
                let &first = files.first()?;
                if files.iter().all(|&file| file == first) {
                    return Some(Kept { files: vec![first], conditions: None });
                }
                let mut written = E::Object::default();
                for (name, inner) in &kept {
                    put(&mut written, name, self.written_as(inner));
                }
                Some(Kept { files, conditions: Some(Expr::init(written, Loc::EMPTY)) })
            }
            _ => None,
        }
    }
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
pub(crate) fn add_package_files(ctx: &ContextData, log: &mut bun_ast::Log, output_files: &mut Vec<OutputFile>) {
    let cwd = ctx.args.absolute_working_dir.as_deref().unwrap_or_default();
    let outdir = join_abs_string::<Auto>(cwd, &[&ctx.bundler_options.outdir]).to_vec();
    let project = nearest_package_json(cwd);
    let project_directory = project.as_ref().map_or_else(|| bun_core::strings::without_trailing_slash(cwd), |found| found.0);
    let existing = project.as_ref().and_then(|(_, path, contents)| parse_package_json(path, contents));

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
    let written = Written { exported: &exported[..], project_directory, outdir: &outdir[..] };
    let written_package_json = [&ctx.bundler_options.outdir[..], b"/package.json"].concat();
    let written_package_json = BStr::new(&written_package_json);
    let mut exports = E::Object::default();
    let mut is_in_exports = vec![false; exported.len()];
    let mut main = None;
    let authored = existing.as_ref().and_then(|existing| existing.get(b"exports"));
    let subpaths = authored.as_ref().and_then(|authored| match &authored.data {
        ExprData::EObject(subpaths) if subpaths.properties.slice().iter().all(|entry| entry.key.as_ref().and_then(Expr::as_utf8_string_literal).is_some_and(|subpath| subpath.starts_with(b"."))) => Some(subpaths),
        _ => None,
    });
    let authored: Vec<(&[u8], &Expr)> = match (subpaths, &authored) {
        (Some(subpaths), _) => subpaths.properties.slice().iter().filter_map(|entry| Some((entry.key.as_ref()?.as_utf8_string_literal()?, entry.value.as_ref()?))).collect(),
        (None, Some(only)) => vec![(&b"."[..], only)],
        (None, None) => Vec::new(),
    };
    let mut wholly_left_out: Vec<&[u8]> = Vec::new();
    for (subpath, authored) in authored.into_iter().filter(|entry| entry.0 != b"./package.json") {
        let mut left_out = Vec::new();
        let Some(kept) = written.keep(authored, &mut Vec::new(), &mut left_out) else {
            wholly_left_out.push(subpath);
            continue;
        };
        left_out.retain(|left_out| !left_out.conditions.is_empty());
        if let Some(LeftOut { conditions, target }) = left_out.first() {
            let (conditions, subpath, target) = (conditions.join(&b"\" > \""[..]), BStr::new(subpath), BStr::new(target));
            let conditions = BStr::new(&conditions);
            match left_out.len() {
                1 => log.add_warning_fmt(None, Loc::EMPTY, format_args!("\"{conditions}\" of \"{subpath}\" in \"exports\" of package.json is left out of {written_package_json}: this build does not write {target}")),
                count => log.add_warning_fmt(None, Loc::EMPTY, format_args!("{count} conditions of \"{subpath}\" in \"exports\" of package.json are left out of {written_package_json}, the first \"{conditions}\": this build does not write {target}")),
            }
        }
        kept.files.iter().for_each(|&file| is_in_exports[file] = true);
        if subpath == b"." {
            main = kept.files.last().copied();
        }
        put(&mut exports, subpath, written.written_as(&kept));
    }
    for (index, file) in exported.iter().enumerate().filter(|(index, _)| !is_in_exports[*index]) {
        if !exports.has_property(&file.subpath[..]) {
            if file.subpath == b"." {
                main = Some(index);
            }
            put(&mut exports, &file.subpath[..], written.conditions_of(index));
        }
    }
    for subpath in wholly_left_out.into_iter().filter(|subpath| !exports.has_property(subpath)) {
        log.add_warning_fmt(None, Loc::EMPTY, format_args!("\"{}\" in \"exports\" of package.json is left out of {written_package_json}: no entry point of this build is written there", BStr::new(subpath)));
    }
    put(&mut exports, b"./package.json", text(b"./package.json"));

    let is_commonjs = ctx.bundler_options.output_format == bun_bundler::options::Format::Cjs;
    put(&mut package, b"type", text(if is_commonjs { &b"commonjs"[..] } else { &b"module"[..] }));
    if let Some(main) = main.map(|main| &exported[main]).or_else(|| exported.first()) {
        put(&mut package, b"main", relative(&main.javascript[..]));
        if !is_commonjs {
            put(&mut package, b"module", relative(&main.javascript[..]));
        }
        if let Some(declarations) = &main.declarations {
            put(&mut package, b"types", relative(&declarations[..]));
        }
    }
    put(&mut package, b"exports", Expr::init(exports, Loc::EMPTY));

    let mut warn_about_executable = |name: &[u8], path: &[u8]| {
        log.add_warning_fmt(None, Loc::EMPTY, format_args!("\"{}\" in \"bin\" of package.json is left out of {written_package_json}: {} is not an entry point of this build", BStr::new(name), BStr::new(path)));
    };
    let emitted_as = |path: &[u8]| Some(relative(&exported[written.at(path)?].javascript[..]));
    let existing_bin = existing.as_ref().and_then(|existing| existing.get(b"bin"));
    if let Some(path) = existing_bin.as_ref().and_then(Expr::as_utf8_string_literal) {
        match emitted_as(path) {
            Some(path) => put(&mut package, b"bin", path),
            None => {
                let name = existing.as_ref().and_then(|existing| existing.get(b"name"));
                warn_about_executable(name.as_ref().and_then(Expr::as_utf8_string_literal).map_or(&b""[..], without_scope), path);
            }
        }
    } else if let Some(ExprData::EObject(executables)) = existing_bin.map(|bin| bin.data) {
        let mut bin = E::Object::default();
        for executable in executables.properties.slice() {
            let (Some(name), Some(path)) = (&executable.key, &executable.value) else { continue };
            let (Some(name), Some(path)) = (name.as_utf8_string_literal(), path.as_utf8_string_literal()) else { continue };
            match emitted_as(path) {
                Some(path) => put(&mut bin, name, path),
                None => warn_about_executable(name, path),
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
        files.push(crate::cli::cli_arena(), text(&path[..])).unwrap_or_oom();
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

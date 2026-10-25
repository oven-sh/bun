use core::fmt;

use bstr::BStr;
use bun_alloc::Arena;
use bun_ast::{E, Expr, Loc, Log};
use bun_bundler::options::{OutputFile, OutputKind};
use bun_core::{Global, Output, UnwrapOrOom};
use bun_options_types::Format;
use bun_options_types::context::ContextData;
use bun_paths::resolve_path::platform_to_posix_in_place;
use bun_sema::json::Json;
use bun_sema::resolve::AOT_CONDITION;
use bun_sema_driver::sound_files::typed_path_beside;

use super::declarations::{declaration_path, is_declaration_file};
use super::typed_files::is_typed_file;
use super::{Project, absolute_path};
use crate::cli::check_command::CompilerOptions;
use crate::cli::compile_command::build::asset_output_file;

const FIELDS_COPIED_FIRST: [&[u8]; 11] = [
    b"name",
    b"version",
    b"description",
    b"keywords",
    b"homepage",
    b"bugs",
    b"license",
    b"author",
    b"contributors",
    b"funding",
    b"repository",
];
const FIELDS_COPIED_LAST: [&[u8]; 8] = [
    b"engines",
    b"os",
    b"cpu",
    b"dependencies",
    b"peerDependencies",
    b"peerDependenciesMeta",
    b"optionalDependencies",
    b"publishConfig",
];
const DOCUMENT_NAMES: [&[u8]; 3] = [b"README", b"LICENSE", b"LICENCE"];
const MAX_PACKAGE_NAME_LENGTH: usize = 214;

pub(super) struct PackageRequest<'a> {
    pub(super) project: &'a Project,
    pub(super) outdir: &'a [u8],
    pub(super) outdir_as_written: &'a [u8],
    pub(super) root_directory: &'a [u8],
    pub(super) entry_point_kind: OutputKind,
    pub(super) is_commonjs: bool,
    pub(super) compiler_options: &'a CompilerOptions,
}

#[cold]
pub(crate) fn add_package_files(
    ctx: &ContextData,
    root_directory: &[u8],
    compiler_options: &CompilerOptions,
    log: &mut Log,
    output_files: &mut Vec<OutputFile>,
) {
    let working_directory = ctx.args.absolute_working_dir.as_deref().unwrap_or_default();
    let project = Project::find(working_directory);
    let outdir = absolute_path(working_directory, &ctx.bundler_options.outdir);
    add_documents(&project.directory, output_files);
    let request = PackageRequest {
        project: &project,
        outdir: &outdir,
        outdir_as_written: &ctx.bundler_options.outdir,
        root_directory,
        entry_point_kind: match ctx.bundler_options.transform_only {
            true => OutputKind::Chunk,
            false => OutputKind::EntryPoint,
        },
        is_commonjs: ctx.bundler_options.output_format == Format::Cjs,
        compiler_options,
    };
    match write_package_json(&request, output_files, log) {
        Ok(text) => output_files.push(asset_output_file(b"package.json".to_vec(), text)),
        Err(error) => {
            Output::err_generic("failed to write package.json: {}", (error.name(),));
            Global::exit(1);
        }
    }
}

fn add_documents(project_directory: &[u8], output_files: &mut Vec<OutputFile>) {
    let Ok(fd) = bun_sys::open_dir_for_iteration(bun_core::Fd::cwd(), project_directory) else {
        return;
    };
    let directory = bun_sys::Dir { fd };
    let mut entries = bun_sys::dir_iterator::iterate(directory.fd);
    let mut names: Vec<Vec<u8>> = Vec::new();
    while let Ok(Some(entry)) = entries.next() {
        let name = entry.name.slice_u8();
        if entry.kind == bun_sys::FileKind::File && is_document(name) {
            names.push(name.to_vec());
        }
    }
    names.sort();
    for name in names {
        if let Ok(bytes) = bun_sys::File::read_from(directory.fd, &name) {
            output_files.push(asset_output_file(name, bytes));
        }
    }
}

pub(super) fn is_document(file_name: &[u8]) -> bool {
    DOCUMENT_NAMES.iter().any(|name| {
        let Some((start, extension)) = file_name.split_at_checked(name.len()) else {
            return false;
        };
        start.eq_ignore_ascii_case(name) && matches!(extension, [] | [b'.', ..])
    })
}

struct ExportedFile {
    subpath: Vec<u8>,
    source: Vec<u8>,
    javascript: Vec<u8>,
    declarations: Option<Vec<u8>>,
    typed: Option<Vec<u8>>,
}

fn posix_dest_path(file: &OutputFile) -> Vec<u8> {
    let mut path = bun_core::strings::remove_leading_dot_slash(&file.dest_path).to_vec();
    platform_to_posix_in_place::<u8>(&mut path);
    path
}

pub(super) fn subpath_of(javascript: &[u8]) -> Vec<u8> {
    let stem = &javascript[..javascript.len() - bun_paths::extension(javascript).len()];
    match stem.strip_suffix(b"index") {
        Some([]) => b".".to_vec(),
        Some([folder @ .., b'/']) => [&b"./"[..], folder].concat(),
        _ => [&b"./"[..], stem].concat(),
    }
}

fn find_exported_files(
    request: &PackageRequest<'_>,
    output_files: &[OutputFile],
) -> Vec<ExportedFile> {
    let declarations = output_files.iter().filter(|file| is_declaration_file(file));
    let declarations: Vec<Vec<u8>> = declarations.map(posix_dest_path).collect();
    let typed_files = output_files.iter().filter(|file| is_typed_file(file));
    let typed_files: Vec<Vec<u8>> = typed_files.map(posix_dest_path).collect();
    let entry_points = output_files.iter().filter(|file| {
        file.output_kind == request.entry_point_kind && file.loader.is_javascript_like()
    });
    let mut exported: Vec<ExportedFile> = entry_points
        .map(|file| {
            let (javascript, source) = (posix_dest_path(file), file.src_path.text);
            ExportedFile {
                subpath: subpath_of(&javascript),
                source: source.to_vec(),
                declarations: declaration_path(request.root_directory, source)
                    .filter(|path| declarations.contains(path)),
                typed: typed_path_beside(&javascript).filter(|path| typed_files.contains(path)),
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

#[derive(Copy, Clone)]
struct JsonBuilder<'a> {
    arena: &'a Arena,
}

impl JsonBuilder<'_> {
    fn string(self, value: &[u8]) -> Expr {
        let value = E::String::init(self.arena.alloc_slice_copy(value));
        Expr::init(value, Loc::EMPTY)
    }

    fn relative_path(self, path: &[u8]) -> Expr {
        self.string(&[&b"./"[..], path].concat())
    }

    fn object(self, object: E::Object) -> Expr {
        Expr::init(object, Loc::EMPTY)
    }

    fn compiler_option(self, value: &Json) -> Expr {
        match value {
            Json::Bool(value) => Expr::init(E::Boolean { value: *value }, Loc::EMPTY),
            Json::Array(items) => {
                let mut array = E::Array::default();
                for item in items {
                    let item = self.compiler_option(item);
                    array.push(self.arena, item).unwrap_or_oom();
                }
                Expr::init(array, Loc::EMPTY)
            }
            _ => self.string(value.as_str().unwrap_or_default()),
        }
    }

    fn put(self, object: &mut E::Object, key: &[u8], value: Expr) {
        let key = self.arena.alloc_slice_copy(key);
        object.put(self.arena, key, value).unwrap_or_oom();
    }

    fn copy_fields(self, from: Option<&Expr>, fields: &[&[u8]], to: &mut E::Object) {
        for &field in fields {
            if let Some(value) = from.and_then(|from| from.get(field)) {
                self.put(to, field, value);
            }
        }
    }
}

struct Warnings<'a> {
    log: &'a mut Log,
    package_json: Vec<u8>,
}

impl Warnings<'_> {
    fn add(&mut self, what_is_missing: fmt::Arguments<'_>) {
        let package_json = BStr::new(&self.package_json);
        self.log.add_warning_fmt(
            None,
            Loc::EMPTY,
            format_args!("{package_json} {what_is_missing}"),
        );
    }

    fn add_omitted_conditions(&mut self, subpath: &[u8], omitted: &[OmittedTarget]) {
        let Some(first) = omitted.first() else {
            return;
        };
        let conditions = first.conditions.join(&b"\" > \""[..]);
        let (conditions, subpath) = (BStr::new(&conditions), BStr::new(subpath));
        let target = BStr::new(&first.target);
        match omitted.len() {
            1 => self.add(format_args!(
                "has no \"{conditions}\" condition for \"{subpath}\", because this build doesn't write {target}"
            )),
            count => self.add(format_args!(
                "is missing {count} conditions for \"{subpath}\" (the first is \"{conditions}\"), because this build doesn't write {target}"
            )),
        }
    }

    fn add_omitted_export(&mut self, subpath: &[u8]) {
        self.add(format_args!(
            "has no \"{}\" export, because no entry point builds it",
            BStr::new(subpath)
        ));
    }

    fn add_omitted_executable(&mut self, name: &[u8], written: &[u8]) {
        self.add(format_args!(
            "has no \"{}\" bin, because {} is not an entry point",
            BStr::new(name),
            BStr::new(written)
        ));
    }
}

struct KeptExport {
    files: Vec<usize>,
    // `None`: the conditions of its one file.
    conditions: Option<Expr>,
}

struct OmittedTarget {
    conditions: Vec<Vec<u8>>,
    target: Vec<u8>,
}

struct WrittenExports {
    exports: E::Object,
    main: Option<usize>,
}

struct WrittenFiles<'a> {
    json: JsonBuilder<'a>,
    exported: &'a [ExportedFile],
    project_directory: &'a [u8],
    outdir: &'a [u8],
}

impl WrittenFiles<'_> {
    // The project's package.json names a source file, or what this build makes of it.
    fn find(&self, written: &[u8]) -> Option<usize> {
        let path = absolute_path(self.project_directory, written);
        self.exported.iter().position(|file| {
            file.source == path || absolute_path(self.outdir, &file.javascript) == path
        })
    }

    fn conditions_of(&self, file: usize) -> Expr {
        let file = &self.exported[file];
        let mut conditions = E::Object::default();
        if let Some(typed) = &file.typed {
            let typed = self.json.relative_path(typed);
            self.json.put(&mut conditions, AOT_CONDITION, typed);
        }
        if let Some(declarations) = &file.declarations {
            let declarations = self.json.relative_path(declarations);
            self.json.put(&mut conditions, b"types", declarations);
        }
        let javascript = self.json.relative_path(&file.javascript);
        self.json.put(&mut conditions, b"default", javascript);
        self.json.object(conditions)
    }

    fn written_as(&self, kept: &KeptExport) -> Expr {
        kept.conditions
            .unwrap_or_else(|| self.conditions_of(kept.files[0]))
    }

    fn keep(
        &self,
        authored: &Expr,
        under: &mut Vec<Vec<u8>>,
        omitted: &mut Vec<OmittedTarget>,
    ) -> Option<KeptExport> {
        if let Some(target) = authored.as_utf8_string_literal() {
            let Some(file) = self.find(target) else {
                omitted.push(OmittedTarget {
                    conditions: under.clone(),
                    target: target.to_vec(),
                });
                return None;
            };
            return Some(KeptExport {
                files: vec![file],
                conditions: None,
            });
        }
        if let Some(mut fallbacks) = authored.as_array() {
            while let Some(fallback) = fallbacks.next() {
                if let Some(kept) = self.keep(&fallback, under, omitted) {
                    return Some(kept);
                }
            }
            return None;
        }
        let mut kept: Vec<(Vec<u8>, KeptExport)> = Vec::new();
        authored.for_each_property(|condition, _, inner| {
            if condition == b"types" && inner.is_string() {
                return;
            }
            under.push(condition.to_vec());
            if let Some(inner) = self.keep(&inner, under, omitted) {
                kept.push((condition.to_vec(), inner));
            }
            under.pop();
        });
        let files = kept.iter().flat_map(|(_, inner)| &inner.files);
        let files: Vec<usize> = files.copied().collect();
        let &first = files.first()?;
        if files.iter().all(|&file| file == first) {
            return Some(KeptExport {
                files: vec![first],
                conditions: None,
            });
        }
        let mut conditions = E::Object::default();
        for (condition, inner) in &kept {
            self.json
                .put(&mut conditions, condition, self.written_as(inner));
        }
        Some(KeptExport {
            files,
            conditions: Some(self.json.object(conditions)),
        })
    }

    fn write_exports(&self, authored: Option<Expr>, warnings: &mut Warnings<'_>) -> WrittenExports {
        let mut exports = E::Object::default();
        let mut is_in_exports = vec![false; self.exported.len()];
        let mut main = None;
        let mut omitted_subpaths: Vec<Vec<u8>> = Vec::new();
        for (subpath, authored) in authored_subpaths(authored) {
            if subpath == b"./package.json" {
                continue;
            }
            let mut omitted = Vec::new();
            let Some(kept) = self.keep(&authored, &mut Vec::new(), &mut omitted) else {
                omitted_subpaths.push(subpath);
                continue;
            };
            omitted.retain(|target| !target.conditions.is_empty());
            warnings.add_omitted_conditions(&subpath, &omitted);
            for &file in &kept.files {
                is_in_exports[file] = true;
            }
            if subpath == b"." {
                main = kept.files.last().copied();
            }
            self.json
                .put(&mut exports, &subpath, self.written_as(&kept));
        }
        for (index, file) in self.exported.iter().enumerate() {
            if is_in_exports[index] || exports.has_property(&file.subpath) {
                continue;
            }
            if file.subpath == b"." {
                main = Some(index);
            }
            self.json
                .put(&mut exports, &file.subpath, self.conditions_of(index));
        }
        for subpath in &omitted_subpaths {
            if !exports.has_property(subpath) {
                warnings.add_omitted_export(subpath);
            }
        }
        let package_json = self.json.string(b"./package.json");
        self.json.put(&mut exports, b"./package.json", package_json);
        WrittenExports { exports, main }
    }

    fn write_executables(
        &self,
        existing: &Expr,
        package: &mut E::Object,
        warnings: &mut Warnings<'_>,
    ) {
        let Some(bin) = existing.get(b"bin") else {
            return;
        };
        let built_from = |written: &[u8]| -> Option<Expr> {
            let file = &self.exported[self.find(written)?];
            Some(self.json.relative_path(&file.javascript))
        };
        if let Some(written) = bin.as_utf8_string_literal() {
            match built_from(written) {
                Some(javascript) => self.json.put(package, b"bin", javascript),
                None => {
                    let name = existing.get(b"name");
                    let name = name.as_ref().and_then(Expr::as_utf8_string_literal);
                    let name = name.map_or(&b""[..], without_scope);
                    warnings.add_omitted_executable(name, written);
                }
            }
            return;
        }
        let mut executables = E::Object::default();
        bin.for_each_property(|name, _, written| {
            let Some(written) = written.as_utf8_string_literal() else {
                return;
            };
            match built_from(written) {
                Some(javascript) => self.json.put(&mut executables, name, javascript),
                None => warnings.add_omitted_executable(name, written),
            }
        });
        let executables = self.json.object(executables);
        if executables.property_count() > 0 {
            self.json.put(package, b"bin", executables);
        }
    }
}

// `"exports"` is a map of subpaths, or else what `"."` stands for.
fn authored_subpaths(authored: Option<Expr>) -> Vec<(Vec<u8>, Expr)> {
    let Some(authored) = authored else {
        return Vec::new();
    };
    let mut members: Vec<(Vec<u8>, Expr)> = Vec::new();
    authored.for_each_property(|key, _, value| members.push((key.to_vec(), value)));
    let has_subpaths = authored.is_object() && members.iter().all(|it| it.0.starts_with(b"."));
    match has_subpaths {
        true => members,
        false => vec![(b".".to_vec(), authored)],
    }
}

fn without_scope(package_name: &[u8]) -> &[u8] {
    match bun_core::strings::last_index_of_char(package_name, b'/') {
        Some(slash) if package_name.starts_with(b"@") => &package_name[slash + 1..],
        _ => package_name,
    }
}

pub(super) fn valid_package_name(folder: &[u8]) -> Vec<u8> {
    let mut name: Vec<u8> = folder
        .iter()
        .map(|byte| match byte.to_ascii_lowercase() {
            byte @ (b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.') => byte,
            _ => b'-',
        })
        .skip_while(|byte| matches!(byte, b'.' | b'_' | b'-'))
        .collect();
    name.truncate(MAX_PACKAGE_NAME_LENGTH);
    match name.is_empty() {
        true => b"package".to_vec(),
        false => name,
    }
}

pub(super) fn write_package_json(
    request: &PackageRequest<'_>,
    output_files: &[OutputFile],
    log: &mut Log,
) -> Result<Vec<u8>, bun_js_printer::Error> {
    bun_ast::initialize_store();
    let arena = Arena::new();
    let json = JsonBuilder { arena: &arena };
    let existing = request.project.parse_package_json(&arena).ok().flatten();
    let exported = find_exported_files(request, output_files);
    let written = WrittenFiles {
        json,
        exported: &exported,
        project_directory: &request.project.directory,
        outdir: request.outdir,
    };
    let mut warnings = Warnings {
        log,
        package_json: [request.outdir_as_written, b"/package.json"].concat(),
    };

    let mut package = E::Object::default();
    json.copy_fields(existing.as_ref(), &FIELDS_COPIED_FIRST, &mut package);
    if !package.has_property(b"name") {
        let folder = bun_paths::basename(&request.project.directory);
        json.put(
            &mut package,
            b"name",
            json.string(&valid_package_name(folder)),
        );
    }
    if !package.has_property(b"version") {
        json.put(&mut package, b"version", json.string(b"0.0.0"));
    }

    let module_type: &[u8] = match request.is_commonjs {
        true => b"commonjs",
        false => b"module",
    };
    json.put(&mut package, b"type", json.string(module_type));
    let authored_exports = existing.as_ref().and_then(|it| it.get(b"exports"));
    let WrittenExports { exports, main } = written.write_exports(authored_exports, &mut warnings);
    if let Some(main) = main
        .map(|main| &exported[main])
        .or_else(|| exported.first())
    {
        let javascript = json.relative_path(&main.javascript);
        json.put(&mut package, b"main", javascript);
        if !request.is_commonjs {
            json.put(&mut package, b"module", javascript);
        }
        if let Some(declarations) = &main.declarations {
            json.put(&mut package, b"types", json.relative_path(declarations));
        }
    }
    json.put(&mut package, b"exports", json.object(exports));
    if !request.compiler_options.is_empty() {
        let mut compiler_options = E::Object::default();
        for (name, value) in request.compiler_options {
            json.put(&mut compiler_options, name, json.compiler_option(value));
        }
        let compiler_options = json.object(compiler_options);
        json.put(&mut package, b"compilerOptions", compiler_options);
    }
    if let Some(existing) = &existing {
        written.write_executables(existing, &mut package, &mut warnings);
    }

    let mut paths: Vec<Vec<u8>> = output_files.iter().map(posix_dest_path).collect();
    paths.sort();
    let mut files = E::Array::default();
    for path in &paths {
        files.push(&arena, json.string(path)).unwrap_or_oom();
    }
    json.put(&mut package, b"files", Expr::init(files, Loc::EMPTY));
    let side_effects = existing.as_ref().and_then(|it| it.get(b"sideEffects"));
    if let Some(side_effects) = side_effects.filter(|value| value.as_bool().is_some()) {
        json.put(&mut package, b"sideEffects", side_effects);
    }
    json.copy_fields(existing.as_ref(), &FIELDS_COPIED_LAST, &mut package);

    let mut buffer = bun_js_printer::BufferWriter::init();
    buffer.append_newline = true;
    let mut writer = bun_js_printer::BufferPrinter::init(buffer);
    let source = bun_ast::Source::init_path_string(&b"package.json"[..], &b""[..]);
    bun_js_printer::print_json(
        &mut writer,
        json.object(package),
        &source,
        Default::default(),
    )?;
    Ok(writer.ctx.written_without_trailing_zero().to_vec())
}

use super::computed::{installed_name, rewritten_extensions, written_package_name};
use super::manifest::{ExportsEntry, ExportsMap, build_exports_entry};
use super::*;
use crate::module_format::DeclaredModuleType;
use crate::program::HostModuleId;
use bun_paths::MAX_PATH_BYTES;
use bun_paths::resolve_path::join_string_buf;
use std::cell::OnceCell;
use std::sync::LazyLock;

impl<'h> Resolver<'h> {
    pub fn resolve_code(&self, request: &CodeRequest<'_>) -> CodeResolution<'h> {
        let options = self.code_options();
        let (specifier, kind) = (request.specifier, request.kind);
        if specifier.is_empty() {
            return CodeResolution::NotFound(CodeFailure::ModuleNotFound);
        }
        if let Some(answer) = self.resolve_claim(self.code_host().resolve_code(request)) {
            return answer;
        }
        if let Some(answer) = self.resolve_non_path_specifier(specifier, kind) {
            return answer;
        }
        let directory = match request.directory.starts_with(b"/") {
            true => request.directory,
            false => options.working_directory.as_slice(),
        };
        let directory = strings::without_trailing_slash(directory);
        let key = code_resolution_key(directory, kind, specifier);
        let resolutions = &self.code_state().resolutions;
        if let Some(&known) = resolutions.get_ref(key.as_slice()) {
            return known;
        }
        let key = self.keep(&key);
        let search = FileSearch {
            directory,
            specifier: &key[key.len() - specifier.len()..],
            kind,
            prefers_module_field: options.prefers_module_field,
        };
        let answer = match self.find_code_file(&search) {
            // What "imports" names is a module of the host, or else a package.
            FoundCode::External(target) => {
                self.resolve_runtime_module(&target).unwrap_or_else(|| {
                    let package = FileSearch {
                        specifier: self.keep(&target),
                        ..search
                    };
                    self.answer_search(&search, self.code_host().find_code_file(&package))
                })
            }
            found @ (FoundCode::File {
                path: _,
                required: _,
            }
            | FoundCode::NotFound(_)) => self.answer_search(&search, found),
        };
        *resolutions.insert_ref(key, answer)
    }

    fn answer_search(&self, search: &FileSearch<'_>, found: FoundCode) -> CodeResolution<'h> {
        let failure = match found {
            FoundCode::File { path, required } => {
                let path = self.module_path(&path);
                let required = required.map(|required| self.module_path(&required));
                if let Some(required) = required.filter(|required| *required != path) {
                    let required_files = &self.code_state().required_files;
                    required_files.insert_ref(self.keep(&path), self.keep(&required));
                }
                return CodeResolution::File(self.code_file(&path, None));
            }
            FoundCode::External(_) => CodeFailure::ModuleNotFound,
            FoundCode::NotFound(failure) => failure,
        };
        CodeResolution::NotFound(refine_failure(failure, search.specifier, search.kind))
    }

    fn resolve_runtime_module(&self, specifier: &[u8]) -> Option<CodeResolution<'h>> {
        match self.code_host().resolve_runtime_module(specifier) {
            HostResolution::Unclaimed | HostResolution::Path(_) | HostResolution::Erased => None,
            claim @ (HostResolution::ModuleSource { module: _, path: _ }
            | HostResolution::Module(_)
            | HostResolution::External {
                specifier: _,
                kind: _,
            }) => self.resolve_claim(claim),
        }
    }

    // An entry point that is written like the name of a package may be a path from the working directory.
    fn find_code_file(&self, search: &FileSearch<'_>) -> FoundCode {
        let host = self.code_host();
        let found = host.find_code_file(search);
        let is_written_like_package = search.kind == CodeImportKind::EntryPoint
            && !bun_paths::is_absolute(search.specifier)
            && bun_paths::is_package_path_not_absolute(search.specifier);
        if !is_written_like_package {
            return found;
        }
        let found = match found {
            file @ FoundCode::File {
                path: _,
                required: _,
            } => return file,
            found @ (FoundCode::External(_) | FoundCode::NotFound(_)) => found,
        };
        let specifier = self.keep(&[b"./", search.specifier].concat());
        match host.find_code_file(&FileSearch {
            specifier,
            ..*search
        }) {
            file @ FoundCode::File {
                path: _,
                required: _,
            } => file,
            FoundCode::External(_) | FoundCode::NotFound(_) => found,
        }
    }

    pub fn declared_module_type(&self, path: &[u8]) -> DeclaredModuleType {
        module_type_from_extension(path, self.package_module_type(path))
    }

    pub fn loader_request<'a>(
        &'a self,
        path: &'a [u8],
        kind: CodeImportKind,
        type_attribute: Option<&'a [u8]>,
        embed_attribute: Option<&'a [u8]>,
    ) -> LoaderRequest<'a> {
        LoaderRequest {
            path,
            kind,
            type_attribute,
            embed_attribute,
            settings: self.transpile_settings(path),
            declared_module_type: self.declared_module_type(path),
        }
    }

    pub fn is_package_type_module(&self, path: &[u8]) -> bool {
        self.package_module_type(path) == DeclaredModuleType::Esm
    }

    pub(crate) fn package_module_type(&self, path: &[u8]) -> DeclaredModuleType {
        if !path.starts_with(b"/") {
            return DeclaredModuleType::Unknown;
        }
        match self.module_type_manifest(dirname::<Posix>(path)) {
            Some(manifest) => manifest.module_type,
            None => DeclaredModuleType::Unknown,
        }
    }

    pub(super) fn find_node_modules(&self, directory: &[u8]) -> Option<Vec<u8>> {
        if strings::basename_posix(directory) == b"node_modules" {
            return None;
        }
        Some(inside(directory, b"node_modules")).filter(|it| self.is_dir(it))
    }

    pub(super) fn module_path(&self, found: &[u8]) -> Vec<u8> {
        let real = self.host.realpath(found);
        if !self.code_options().preserves_symlinks {
            return real;
        }
        let real_directory = self.host.realpath(dirname::<Posix>(found));
        let expected = inside(&real_directory, strings::basename_posix(found));
        match is_same_path(&real, &expected, self.host.is_case_sensitive()) {
            true => found.to_vec(),
            false => real,
        }
    }

    pub(super) fn code_file(&self, path: &[u8], host_module: Option<HostModuleId>) -> CodeFile<'h> {
        CodeFile {
            path: self.keep(path),
            host_module,
        }
    }

    pub(super) fn resolve_claim(&self, claim: HostResolution) -> Option<CodeResolution<'h>> {
        Some(match claim {
            HostResolution::Unclaimed => return None,
            HostResolution::Path(path) => CodeResolution::File(self.code_file(&path, None)),
            HostResolution::ModuleSource { module, path } => {
                CodeResolution::File(self.code_file(&path, Some(module)))
            }
            HostResolution::Module(module) => CodeResolution::HostModule(module),
            HostResolution::External { specifier, kind } => CodeResolution::External {
                specifier: self.keep(&specifier),
                kind,
            },
            HostResolution::Erased => CodeResolution::Erased,
        })
    }

    fn resolve_non_path_specifier(
        &self,
        specifier: &[u8],
        kind: CodeImportKind,
    ) -> Option<CodeResolution<'h>> {
        let is_entry_point = kind == CodeImportKind::EntryPoint;
        let has_prefix = |prefix: &[u8]| specifier.starts_with(prefix);
        let is_url = has_prefix(b"http://") || has_prefix(b"https://") || has_prefix(b"//");
        if (is_url && !is_entry_point) || has_prefix(b"data:") {
            return Some(CodeResolution::External {
                specifier: self.keep(specifier),
                kind: ExternalKind::UncompiledCode,
            });
        }
        if !is_entry_point && strings::contains_char(specifier, b'?') {
            return Some(CodeResolution::NotFound(CodeFailure::QueryString));
        }
        if strings::contains_char(specifier, 0) {
            return Some(CodeResolution::NotFound(CodeFailure::ModuleNotFound));
        }
        None
    }
}

fn code_resolution_key(directory: &[u8], kind: CodeImportKind, specifier: &[u8]) -> Vec<u8> {
    let separator: &[u8] = match kind {
        CodeImportKind::EntryPoint => b"//0",
        CodeImportKind::Import => b"//1",
        CodeImportKind::Require => b"//2",
    };
    [directory, separator, specifier].concat()
}

fn refine_failure(failure: CodeFailure, specifier: &[u8], kind: CodeImportKind) -> CodeFailure {
    if failure != CodeFailure::ModuleNotFound {
        return failure;
    }
    if specifier.starts_with(b"node:") {
        return CodeFailure::BuiltinModuleNotFound;
    }
    let is_package_name = kind != CodeImportKind::EntryPoint
        && bun_paths::is_package_path(specifier)
        && !strings::contains_char(specifier, b'/');
    match is_package_name {
        true => CodeFailure::PackageNotFound,
        false => CodeFailure::ModuleNotFound,
    }
}

fn module_type_from_extension(
    path: &[u8],
    package_module_type: DeclaredModuleType,
) -> DeclaredModuleType {
    let name = strings::basename_posix(path);
    let dot = strings::last_index_of_char(name, b'.').unwrap_or(name.len());
    match &name[dot..] {
        b".mjs" | b".mts" => DeclaredModuleType::Esm,
        b".cjs" | b".cts" => DeclaredModuleType::CommonJs,
        b".js" | b".ts" => package_module_type,
        _ => DeclaredModuleType::Unknown,
    }
}

pub(super) fn join_unrooted(base: &[u8], rest: &[u8]) -> Vec<u8> {
    preserve_trailing_slash(join(b"/", &inside(base, rest)), rest)
}

pub(super) fn preserve_trailing_slash(mut joined: Vec<u8>, written: &[u8]) -> Vec<u8> {
    if written.ends_with(b"/") && !joined.ends_with(b"/") {
        joined.push(b'/');
    }
    joined
}

pub(super) fn is_in_node_modules(path: &[u8]) -> bool {
    strings::contains(path, b"/node_modules/")
}

fn is_directory_specifier(specifier: &[u8]) -> bool {
    if has_trailing_directory_separator(specifier) {
        return true;
    }
    let before_dots = specifier
        .strip_suffix(b"..")
        .or_else(|| specifier.strip_suffix(b"."));
    before_dots.is_some_and(|it| it.is_empty() || has_trailing_directory_separator(it))
}

fn restore_directory_separator(mut joined: Vec<u8>, specifier: &[u8]) -> Vec<u8> {
    if is_directory_specifier(specifier) && !joined.ends_with(b"/") {
        joined.push(b'/');
    }
    joined
}

const PACKAGE_URL: &[u8] = b"/";
const SEPARATORS: &[u8] = b"/\\";
const ENCODED_SLASHES: [&[u8]; 4] = [b"%2f", b"%2F", b"%5c", b"%5C"];
const JOIN_HEADROOM: usize = 8;
// `bun run` copies a subpath into a buffer of this size. A longer one becomes the empty subpath, which no key matches.
const SUBPATH_CAPACITY: usize = 512;
const MAIN_FIELDS: [&[u8]; 3] = [b"module", b"main", b"jsnext:main"];
const MAIN_FIELD_EXTENSIONS: [&[u8]; 7] =
    [b".js", b".cjs", b".cts", b".tsx", b".ts", b".jsx", b".json"];

static BUN_RUN: LazyLock<CodeOptions> = LazyLock::new(|| CodeOptions::bun_run(b""));

/// For a host without Bun's resolver: a file, with an extension, or a folder, beside the importer or in `node_modules`. Of a `package.json` it reads "exports" and the main fields, under the conditions and in the orders of `bun run`.
pub fn find_file_plainly<H: Host + ?Sized>(host: &H, search: &FileSearch<'_>) -> FoundCode {
    BUN_RUN.find_file(host, H::parse_package_json, search)
}

impl CodeOptions {
    /// `find_file_plainly` under the conditions and in the orders of a build, for files that only its host has.
    pub fn find_file_plainly<H: CodeHost + ?Sized>(
        &self,
        host: &H,
        search: &FileSearch<'_>,
    ) -> FoundCode {
        self.find_file(host, H::parse_runtime_package_json, search)
    }

    fn find_file<H: Host + ?Sized>(
        &self,
        host: &H,
        parse_manifest: fn(&H, &Arena, &[u8]) -> Option<Json>,
        search: &FileSearch<'_>,
    ) -> FoundCode {
        let plain = PlainSearch {
            host,
            parse_manifest,
            orders: &self.extension_orders,
            kind: search.kind,
            prefers_module_field: search.prefers_module_field,
            holds: &|condition| self.matches_condition(condition, search.kind),
            arena: OnceCell::new(),
        };
        plain.find(search.specifier, search.directory)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum KeyKind {
    Exact,
    Directory,
    Pattern,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum TargetKind {
    Exact,
    Wildcard,
}

struct PackageWalk<'a> {
    specifier: &'a [u8],
    /// The folder of the package in `node_modules`, and the key of its "exports".
    parsed: Option<(&'a [u8], Vec<u8>)>,
    is_self_reference: bool,
}

/// One search without Bun's resolver.
struct PlainSearch<'a, H: Host + ?Sized> {
    host: &'a H,
    parse_manifest: fn(&H, &Arena, &[u8]) -> Option<Json>,
    orders: &'a ExtensionOrders,
    kind: CodeImportKind,
    prefers_module_field: bool,
    /// Whether a condition of "exports" holds.
    holds: &'a dyn Fn(&[u8]) -> bool,
    /// Made for the first `package.json` that the search reads.
    arena: OnceCell<Arena>,
}

impl<H: Host + ?Sized> PlainSearch<'_, H> {
    fn find(&self, specifier: &[u8], directory: &[u8]) -> FoundCode {
        let order = |is_in_node_modules| self.orders.for_kind(self.kind, is_in_node_modules);
        let found = if bun_paths::is_absolute(specifier) {
            let candidate = restore_directory_separator(join(b"/", specifier), specifier);
            self.load_as_file_or_directory(&candidate, order(false))
        } else if !bun_paths::is_package_path_not_absolute(specifier) {
            let joined = join(directory, specifier);
            let order = order(is_in_node_modules(&joined));
            let candidate = restore_directory_separator(joined, specifier);
            self.load_as_file_or_directory(&candidate, order)
        } else {
            return self.load_node_modules(specifier, directory);
        };
        found.unwrap_or_else(FoundCode::not_found)
    }

    fn load_node_modules(&self, specifier: &[u8], directory: &[u8]) -> FoundCode {
        let Some(start) = ancestors(directory).find(|it| self.host.is_dir(it)) else {
            return FoundCode::not_found();
        };
        let self_reference = ancestors(start)
            .find_map(|ancestor| Some((ancestor, self.read_manifest(ancestor)?)))
            .filter(|(_, manifest)| {
                let name = text_property(manifest, b"name").unwrap_or_default();
                self.read_exports(manifest).is_some()
                    && written_package_name(specifier) == Some(name)
            });
        let walk = PackageWalk {
            specifier,
            parsed: parse_package_specifier(specifier),
            is_self_reference: self_reference.is_some(),
        };
        ancestors(self_reference.map_or(start, |it| it.0))
            .find_map(|ancestor| self.load_from_package_directory(&walk, ancestor))
            .unwrap_or_else(FoundCode::not_found)
    }

    fn load_from_package_directory(
        &self,
        walk: &PackageWalk<'_>,
        directory: &[u8],
    ) -> Option<FoundCode> {
        let node_modules = match walk.is_self_reference {
            true => None,
            false => Some(self.find_node_modules(directory)?),
        };
        let package = walk.parsed.as_ref().and_then(|(name, subpath)| {
            let package_directory = match &node_modules {
                Some(node_modules) => join_unrooted(node_modules, name),
                None => directory.to_vec(),
            };
            (self.host.is_dir(&package_directory)).then_some((subpath, package_directory))
        });
        if let Some((subpath, package_directory)) = &package
            && let Some(manifest) = self.read_manifest(package_directory)
            && let Some(exports) = self.read_exports(&manifest)
        {
            return Some(self.find_in_exports(package_directory, &exports, subpath));
        }
        let candidate = match &node_modules {
            Some(node_modules) => join_unrooted(node_modules, walk.specifier),
            None => directory.to_vec(),
        };
        let order = self.orders.for_kind(self.kind, package.is_some());
        self.load_as_file_or_directory(&candidate, order)
    }

    fn find_node_modules(&self, directory: &[u8]) -> Option<Vec<u8>> {
        if strings::basename_posix(directory) == b"node_modules" {
            return None;
        }
        Some(inside(directory, b"node_modules")).filter(|it| self.host.is_dir(it))
    }

    fn read_manifest(&self, directory: &[u8]) -> Option<Json> {
        let path = inside(directory, b"package.json");
        if !self.host.is_file(&path) {
            return None;
        }
        let arena = self.arena.get_or_init(Arena::new);
        let manifest = (self.parse_manifest)(self.host, arena, &self.host.read(&path)?)?;
        manifest.as_object().is_some().then_some(manifest)
    }

    fn read_exports(&self, manifest: &Json) -> Option<ExportsEntry<'_>> {
        let arena = self.arena.get_or_init(Arena::new);
        match build_exports_entry(arena, get_first(manifest, b"exports")?) {
            ExportsEntry::Null => None,
            root @ (ExportsEntry::Invalid
            | ExportsEntry::Target(_)
            | ExportsEntry::Array(_)
            | ExportsEntry::Map(_)) => Some(root),
        }
    }

    /// The file that `exports`, of the `package.json` in `directory`, names for `subpath`, which is `.` or starts with `./`.
    fn find_in_exports(
        &self,
        directory: &[u8],
        exports: &ExportsEntry<'_>,
        subpath: &[u8],
    ) -> FoundCode {
        let load = |subpath: &[u8]| self.load_exported(directory, exports, subpath);
        let failure = match load(subpath) {
            Ok(file) => return file,
            Err(failure) => failure,
        };
        if bun_paths::extension(subpath) == b".js"
            && subpath.len() > 3
            && let Ok(file) = load(&subpath[..subpath.len() - 3])
        {
            return file;
        }
        if subpath == b"./package.json" {
            return found_file(inside(directory, b"package.json"));
        }
        failure
    }

    fn load_exported(
        &self,
        directory: &[u8],
        exports: &ExportsEntry<'_>,
        subpath: &[u8],
    ) -> Result<FoundCode, FoundCode> {
        let (key, path) =
            resolve_exports(exports, subpath, self.holds).map_err(FoundCode::NotFound)?;
        let Some(relative) = path.strip_prefix(PACKAGE_URL) else {
            return Err(FoundCode::not_found());
        };
        let target = join_unrooted(directory, relative);
        let kind = match key {
            KeyKind::Exact => TargetKind::Exact,
            KeyKind::Pattern => TargetKind::Wildcard,
            KeyKind::Directory => {
                let order = self.orders.for_kind(self.kind, true);
                let found = self.load_as_file_or_directory(&target, order);
                return found.ok_or_else(FoundCode::not_found);
            }
        };
        self.load_target_file(&target, kind)
            .map(found_file)
            .map_err(FoundCode::NotFound)
    }

    fn load_target_file(&self, target: &[u8], kind: TargetKind) -> Result<Vec<u8>, CodeFailure> {
        let directory = dirname::<Posix>(target);
        if !self.host.is_dir(directory) {
            return Err(CodeFailure::ModuleNotFound);
        }
        if self.host.is_file(target) {
            return Ok(target.to_vec());
        }
        let order = (self.orders).for_kind(self.kind, is_in_node_modules(directory));
        let probe = || self.probe_target_extensions(target, order, kind);
        match (self.host.is_dir(target), kind) {
            (true, TargetKind::Exact) => Err(CodeFailure::UnsupportedDirectoryImport),
            (true, TargetKind::Wildcard) => probe().ok_or(CodeFailure::UnsupportedDirectoryImport),
            (false, TargetKind::Exact | TargetKind::Wildcard) => {
                probe().ok_or(CodeFailure::ModuleNotFound)
            }
        }
    }

    fn probe_target_extensions(
        &self,
        path: &[u8],
        extensions: &[Vec<u8>],
        target: TargetKind,
    ) -> Option<Vec<u8>> {
        let with_extension = match target {
            TargetKind::Wildcard if bun_paths::extension(path).is_empty() => {
                self.find_file_with_extension(path, extensions)
            }
            TargetKind::Wildcard | TargetKind::Exact => None,
        };
        with_extension.or_else(|| self.find_rewritten_file(path))
    }

    fn load_as_file_or_directory(&self, path: &[u8], extensions: &[Vec<u8>]) -> Option<FoundCode> {
        if let Some(file) = self.load_as_file(path, extensions) {
            return Some(found_file(file));
        }
        let directory = strings::without_trailing_slash(path);
        if !self.host.is_dir(directory) {
            return None;
        }
        self.read_manifest(directory)
            .and_then(|manifest| self.load_from_main_fields(directory, &manifest, extensions))
            .or_else(|| self.load_as_index(directory, extensions).map(found_file))
    }

    fn load_as_file<E: AsRef<[u8]>>(&self, path: &[u8], extensions: &[E]) -> Option<Vec<u8>> {
        let trimmed = strings::without_trailing_slash(path);
        if trimmed.is_empty() || trimmed.ends_with(b"/") {
            return None;
        }
        if !self.host.is_dir(dirname::<Posix>(trimmed)) {
            return None;
        }
        if self.host.is_file(trimmed) {
            return Some(trimmed.to_vec());
        }
        let has_trailing_separator = trimmed.len() != path.len();
        let with_extension = match has_trailing_separator {
            true => None,
            false => self.find_file_with_extension(trimmed, extensions),
        };
        with_extension
            .or_else(|| self.find_rewritten_file(trimmed))
            .or_else(|| self.find_file_in_another_case(trimmed))
    }

    // `bun run` looks a name up in the listing of its directory without regard to case, and opens the file under the name that is listed.
    fn find_file_in_another_case(&self, path: &[u8]) -> Option<Vec<u8>> {
        let directory = dirname::<Posix>(path);
        let name = &path[strings::last_index_of_char(path, b'/')? + 1..];
        let (files, _) = self.host.entries(directory);
        let listed = files.iter().find(|file| file.eq_ignore_ascii_case(name))?;
        Some(inside(directory, listed))
    }

    fn load_as_index<E: AsRef<[u8]>>(&self, directory: &[u8], extensions: &[E]) -> Option<Vec<u8>> {
        self.find_file_with_extension(&inside(directory, b"index"), extensions)
    }

    fn load_from_main_fields(
        &self,
        directory: &[u8],
        manifest: &Json,
        extensions: &[Vec<u8>],
    ) -> Option<FoundCode> {
        let prefers_main = !(self.prefers_module_field && self.kind != CodeImportKind::Require);
        let load_main = |value| self.load_from_main_field(directory, value, &MAIN_FIELD_EXTENSIONS);
        for field in MAIN_FIELDS {
            let Some(value) = text_property(manifest, field) else {
                continue;
            };
            let is_main = field == b"main";
            let found = match is_main {
                true => load_main(value),
                false => self.load_from_main_field(directory, value, extensions),
            };
            let Some(found) = found else {
                continue;
            };
            if is_main {
                return Some(found_file(found));
            }
            let main = match text_property(manifest, b"main") {
                Some(main_value) => load_main(main_value),
                None => self.load_as_index(directory, &MAIN_FIELD_EXTENSIONS),
            };
            return Some(match prefers_main {
                true => found_file(main.unwrap_or(found)),
                false => FoundCode::File {
                    path: found,
                    required: main,
                },
            });
        }
        None
    }

    fn load_from_main_field<E: AsRef<[u8]>>(
        &self,
        directory: &[u8],
        value: &[u8],
        extensions: &[E],
    ) -> Option<Vec<u8>> {
        let target = preserve_trailing_slash(join(directory, value), value);
        if let Some(file) = self.load_as_file(&target, extensions) {
            return Some(file);
        }
        if !self.host.is_dir(&target) {
            return None;
        }
        self.load_as_index(&target, extensions)
    }

    fn find_rewritten_file(&self, path: &[u8]) -> Option<Vec<u8>> {
        let base_start = strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1);
        let dot = base_start + strings::last_index_of_char(&path[base_start..], b'.')?;
        let (stem, extension) = path.split_at(dot);
        // Under the "aot" condition `x.mts` is found for "./x.mjs" in a package too.
        let keeps_module_extensions = is_in_node_modules(path) && !(self.holds)(AOT_CONDITION);
        match (extension, keeps_module_extensions) {
            (b".mjs" | b".cjs", true) => None,
            _ => self.find_file_with_extension(stem, rewritten_extensions(extension)),
        }
    }

    fn find_file_with_extension<E: AsRef<[u8]>>(
        &self,
        stem: &[u8],
        extensions: &[E],
    ) -> Option<Vec<u8>> {
        let longest = extensions.iter().map(|it| it.as_ref().len()).max()?;
        let mut candidate = Vec::with_capacity(stem.len() + longest);
        candidate.extend_from_slice(stem);
        for extension in extensions {
            candidate.extend_from_slice(extension.as_ref());
            if self.host.is_file(&candidate) {
                return Some(candidate);
            }
            candidate.truncate(stem.len());
        }
        None
    }
}

fn found_file(path: Vec<u8>) -> FoundCode {
    FoundCode::File {
        path,
        required: None,
    }
}

fn text_property<'j>(manifest: &'j Json, key: &[u8]) -> Option<&'j [u8]> {
    let text = get_first(manifest, key)?.as_str()?;
    (!text.is_empty()).then_some(text)
}

fn parse_package_specifier(specifier: &[u8]) -> Option<(&[u8], Vec<u8>)> {
    let name = installed_name(specifier)?;
    let rest = &specifier[name.len()..];
    let rest = match rest.strip_prefix(b"@") {
        None => rest,
        Some(versioned) => match strings::index_of_char_usize(versioned, b'/') {
            Some(0) | None => b"".as_slice(),
            Some(slash) => &versioned[slash..],
        },
    };
    if rest.len() + 1 > SUBPATH_CAPACITY {
        return Some((name, Vec::new()));
    }
    Some((name, [b".".as_slice(), rest].concat()))
}

/// The path that `exports` names for `subpath`, from the directory of the package and with a `/` in front.
fn resolve_exports(
    exports: &ExportsEntry<'_>,
    subpath: &[u8],
    holds: &dyn Fn(&[u8]) -> bool,
) -> Result<(KeyKind, Vec<u8>), CodeFailure> {
    if matches!(exports, ExportsEntry::Invalid) {
        return Err(CodeFailure::InvalidPackageConfiguration);
    }
    let entry = match (subpath, *exports) {
        (b".", _) => main_export(exports).map(|main| (*main, KeyKind::Exact, b"".as_slice())),
        (_, ExportsEntry::Map(map)) if keys_start_with_dot(map) => find_table_entry(subpath, map),
        (
            _,
            ExportsEntry::Map(_)
            | ExportsEntry::Target(_)
            | ExportsEntry::Array(_)
            | ExportsEntry::Null
            | ExportsEntry::Invalid,
        ) => None,
    };
    let Some((value, key, matched)) = entry else {
        return Err(CodeFailure::PackagePathNotExported);
    };
    let target = pick_target(value, holds).unwrap_or(Err(CodeFailure::PackagePathNotExported))?;
    let path = decode_target_path(resolve_target_text(target, key, matched)?)?;
    Ok((key, path))
}

fn main_export<'e, 'h>(exports: &'e ExportsEntry<'h>) -> Option<&'e ExportsEntry<'h>> {
    match *exports {
        ExportsEntry::Target(_) | ExportsEntry::Array(_) => Some(exports),
        ExportsEntry::Map(map) if keys_start_with_dot(map) => value_for_key(map, b"."),
        ExportsEntry::Map(_) => Some(exports),
        ExportsEntry::Null | ExportsEntry::Invalid => None,
    }
}

fn keys_start_with_dot(map: &ExportsMap<'_>) -> bool {
    let first = map.entries.first();
    first.is_some_and(|entry| entry.0.starts_with(b"."))
}

fn value_for_key<'h>(map: &ExportsMap<'h>, key: &[u8]) -> Option<&'h ExportsEntry<'h>> {
    let entry = map.entries.iter().find(|entry| entry.0 == key)?;
    Some(&entry.1)
}

fn find_table_entry<'h, 'k>(
    match_key: &'k [u8],
    map: &ExportsMap<'h>,
) -> Option<(ExportsEntry<'h>, KeyKind, &'k [u8])> {
    if !match_key.ends_with(b"/")
        && !strings::contains_char(match_key, b'*')
        && let Some(target) = value_for_key(map, match_key)
    {
        return Some((*target, KeyKind::Exact, b"".as_slice()));
    }
    map.expansion_keys.iter().find_map(|(key, target)| {
        let (kind, subpath) = match_expansion_key(key, match_key)?;
        Some((*target, kind, subpath))
    })
}

fn match_expansion_key<'k>(key: &[u8], match_key: &'k [u8]) -> Option<(KeyKind, &'k [u8])> {
    let Some(star) = strings::index_of_char_usize(key, b'*') else {
        return Some((KeyKind::Directory, match_key.strip_prefix(key)?));
    };
    let (base, trailer) = (&key[..star], &key[star + 1..]);
    let subpath = match_key.strip_prefix(base)?.strip_suffix(trailer)?;
    (trailer.is_empty() || !subpath.is_empty()).then_some((KeyKind::Pattern, subpath))
}

/// `None` where no condition holds: the search goes on with what stands behind `value`. An error ends it.
fn pick_target<'h>(
    value: ExportsEntry<'h>,
    holds: &dyn Fn(&[u8]) -> bool,
) -> Option<Result<&'h [u8], CodeFailure>> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return Some(Err(CodeFailure::InvalidPackageConfiguration));
    }
    match value {
        ExportsEntry::Target(target) => Some(Ok(target)),
        ExportsEntry::Null | ExportsEntry::Array([]) => {
            Some(Err(CodeFailure::PackagePathNotExported))
        }
        ExportsEntry::Invalid => Some(Err(CodeFailure::InvalidPackageTarget)),
        ExportsEntry::Map(map) => (map.entries.iter().filter(|entry| holds(entry.0)))
            .find_map(|entry| pick_target(entry.1, holds)),
        // Node continues past an invalid target or `null`. `bun run` stops at either.
        ExportsEntry::Array(items) => items.iter().find_map(|&item| pick_target(item, holds)),
    }
}

fn resolve_target_text(
    target: &[u8],
    key: KeyKind,
    subpath: &[u8],
) -> Result<Vec<u8>, CodeFailure> {
    if PACKAGE_URL.len() + target.len() + subpath.len() + JOIN_HEADROOM > MAX_PATH_BYTES {
        return Err(CodeFailure::InvalidPackageTarget);
    }
    if key != KeyKind::Pattern && !subpath.is_empty() && !target.ends_with(b"/") {
        return Err(CodeFailure::InvalidModuleSpecifier);
    }
    if has_invalid_subpath_segment(subpath) {
        return Err(CodeFailure::InvalidModuleSpecifier);
    }
    if !target.starts_with(b"./") || has_invalid_segment(target) {
        return Err(CodeFailure::InvalidPackageTarget);
    }
    let resolved = join_posix(&[PACKAGE_URL, target]);
    if has_invalid_segment(&resolved) {
        return Err(CodeFailure::InvalidModuleSpecifier);
    }
    match key {
        KeyKind::Exact | KeyKind::Directory => Ok(join_posix(&[PACKAGE_URL, target, subpath])),
        KeyKind::Pattern => substitute_subpath(&resolved, subpath)
            .filter(|path| !has_invalid_segment(path))
            .ok_or(CodeFailure::InvalidModuleSpecifier),
    }
}

fn substitute_subpath(pattern: &[u8], subpath: &[u8]) -> Option<Vec<u8>> {
    (strings::replacement_size(pattern, b"*", subpath) <= MAX_PATH_BYTES)
        .then(|| strings::replace_owned(pattern, b"*", subpath))
}

fn decode_target_path(path: Vec<u8>) -> Result<Vec<u8>, CodeFailure> {
    let path = match strings::contains_char(&path, b'%') {
        true => decode_path(&path).ok_or(CodeFailure::InvalidModuleSpecifier)?,
        false => path,
    };
    if matches!(path.last(), Some(b'/' | b'\\')) {
        return Err(CodeFailure::UnsupportedDirectoryImport);
    }
    Ok(path)
}

fn decode_path(path: &[u8]) -> Option<Vec<u8>> {
    if ENCODED_SLASHES.iter().any(|it| strings::contains(path, it)) {
        return None;
    }
    decode_percent(path)
}

fn has_invalid_segment(path: &[u8]) -> bool {
    match strings::index_of_any(path, SEPARATORS) {
        Some(separator) => has_invalid_subpath_segment(&path[separator + 1..]),
        None => true,
    }
}

fn has_invalid_subpath_segment(path: &[u8]) -> bool {
    strings::split_any(path, SEPARATORS).any(is_invalid_segment)
}

fn is_invalid_segment(segment: &[u8]) -> bool {
    let mut decoded = [0u8; b"node_modules".len()];
    let mut len = 0;
    let mut rest = segment;
    while let [first, after @ ..] = rest {
        if len == decoded.len() {
            return false;
        }
        let escaped = match rest {
            [b'%', high, low, ..] => bun_core::fmt::hex_pair_value(*high, *low),
            _ => None,
        };
        decoded[len] = escaped.unwrap_or(*first).to_ascii_lowercase();
        len += 1;
        rest = if escaped.is_some() { &rest[3..] } else { after };
    }
    matches!(&decoded[..len], b"." | b".." | b"node_modules")
}

fn decode_percent(text: &[u8]) -> Option<Vec<u8>> {
    let mut decoded = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(percent) = strings::index_of_char_usize(rest, b'%') {
        let [high, low, after @ ..] = &rest[percent + 1..] else {
            return None;
        };
        decoded.extend_from_slice(&rest[..percent]);
        decoded.push(bun_core::fmt::hex_pair_value(*high, *low)?);
        rest = after;
    }
    decoded.extend_from_slice(rest);
    Some(decoded)
}

fn join_posix(parts: &[&[u8]]) -> Vec<u8> {
    join_string_buf::<Posix>(&mut path_buffer_pool::get()[..], parts).to_vec()
}

#[cfg(test)]
mod tests;

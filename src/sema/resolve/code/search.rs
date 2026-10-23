use super::config::CodeConfig;
use super::*;
use crate::module_format::DeclaredModuleType;
use crate::program::HostModuleId;

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
        let search = CodeSearch {
            kind,
            extensions: options.extension_orders.for_kind(kind, false),
            uses_typed_condition: false,
        };
        let answer = match self.search_code(specifier, directory, search) {
            SearchResult::File(found) => {
                CodeResolution::File(self.code_file(&self.module_path(&found), None))
            }
            SearchResult::Claimed(claim) => match self.resolve_claim(claim) {
                Some(answer) => answer,
                None => unreachable!("`SearchResult::Claimed` never holds `Unclaimed`"),
            },
            SearchResult::NotFound(failure) => {
                CodeResolution::NotFound(refine_failure(failure, specifier, kind))
            }
        };
        *resolutions.insert_ref(self.keep(&key), answer)
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

    pub(super) fn search_code(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> SearchResult {
        let found = if bun_paths::is_absolute(specifier) {
            self.load_absolute_path(specifier, directory, search)
        } else if !bun_paths::is_package_path_not_absolute(specifier) {
            self.load_relative_path(specifier, directory, search)
        } else {
            return self.load_bare_specifier(specifier, directory, search);
        };
        match found {
            Some(path) => SearchResult::File(path),
            None => SearchResult::NotFound(CodeFailure::ModuleNotFound),
        }
    }

    fn load_bare_specifier(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> SearchResult {
        let as_package = self.load_package_path(specifier, directory, search);
        let is_entry_point = search.kind == CodeImportKind::EntryPoint;
        if !is_entry_point || matches!(as_package, SearchResult::File(_)) {
            return as_package;
        }
        match self.load_relative_path(specifier, directory, search) {
            Some(path) => SearchResult::File(path),
            None => as_package,
        }
    }

    fn load_absolute_path(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> Option<Vec<u8>> {
        let candidate = restore_directory_separator(join(b"/", specifier), specifier);
        if self.is_dir(directory)
            && let Some(config) = self.enclosing_code_config(directory)
            && config.has_paths()
        {
            let text = match strings::contains(specifier, b"..") {
                true => candidate.as_slice(),
                false => specifier,
            };
            if let Some(found) = self.load_through_paths(config, text, search) {
                return Some(found);
            }
        }
        self.load_as_file_or_directory(&candidate, search)
    }

    fn load_relative_path(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> Option<Vec<u8>> {
        let joined = join(directory, specifier);
        let orders = &self.code_options().extension_orders;
        let extensions = match files::is_in_node_modules(&joined) {
            true => orders.for_kind(search.kind, true),
            false => search.extensions,
        };
        let search = CodeSearch {
            extensions,
            ..search
        };
        let candidate = restore_directory_separator(joined, specifier);
        self.load_as_file_or_directory(&candidate, search)
    }

    pub(super) fn load_through_paths(
        &self,
        config: &CodeConfig<'h>,
        specifier: &[u8],
        search: CodeSearch<'_>,
    ) -> Option<Vec<u8>> {
        config
            .path_candidates(specifier)
            .iter()
            .find_map(|candidate| self.load_as_file_or_directory(candidate, search))
            .map(normalize_path)
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

    pub(super) fn find_other_file(&self, result: SearchResult, path: &[u8]) -> Option<Vec<u8>> {
        let SearchResult::File(found) = result else {
            return None;
        };
        Some(self.module_path(&found)).filter(|other| other.as_slice() != path)
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

pub(super) fn is_directory_specifier(specifier: &[u8]) -> bool {
    if has_trailing_directory_separator(specifier) {
        return true;
    }
    let before_dots = specifier
        .strip_suffix(b"..")
        .or_else(|| specifier.strip_suffix(b"."));
    before_dots.is_some_and(|it| it.is_empty() || has_trailing_directory_separator(it))
}

pub(super) fn restore_directory_separator(mut joined: Vec<u8>, specifier: &[u8]) -> Vec<u8> {
    if is_directory_specifier(specifier) && !joined.ends_with(b"/") {
        joined.push(b'/');
    }
    joined
}

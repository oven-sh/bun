use super::exports::{
    ExportsStatus, PackageSpecifier, TargetResolution, resolve_exports, resolve_imports,
};
use super::files::{TargetKind, is_in_node_modules};
use super::manifest::ExportsEntry;
use super::search::join_unrooted;
use super::*;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum SubpathImports {
    Allowed,
    Forbidden,
}

struct PackageWalk<'a> {
    specifier: &'a [u8],
    parsed: Option<PackageSpecifier<'a>>,
    is_self_reference: bool,
}

impl<'h> Resolver<'h> {
    pub(super) fn load_package_path(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> SearchResult {
        let Some(start) = ancestors(directory).find(|it| self.is_dir(it)) else {
            return SearchResult::NotFound(CodeFailure::ModuleNotFound);
        };
        self.load_node_modules(specifier, start, search, SubpathImports::Allowed)
    }

    fn load_node_modules(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
        imports: SubpathImports,
    ) -> SearchResult {
        if let Some(found) = self.load_through_config(specifier, directory, search) {
            return SearchResult::File(found);
        }
        let manifest = self.nearest_code_manifest(directory);
        if imports == SubpathImports::Allowed
            && specifier.starts_with(b"#")
            && let Some(manifest) = manifest
            && let Some(table) = &manifest.imports
        {
            return self.load_package_imports(specifier, manifest, table, search);
        }
        let self_reference = manifest.filter(|it| {
            it.exports.is_some() && PackageSpecifier::parse_name(specifier) == Some(it.name)
        });
        let walk = PackageWalk {
            specifier,
            parsed: PackageSpecifier::parse(specifier),
            is_self_reference: self_reference.is_some(),
        };
        let start = self_reference.map_or(directory, |it| it.directory);
        for ancestor in ancestors(start) {
            if let Some(answer) = self.load_from_package_directory(&walk, ancestor, search) {
                return answer;
            }
        }
        for path in &self.code_options().node_paths {
            let candidate = join_unrooted(path, specifier);
            if let Some(found) = self.load_as_file_or_directory(&candidate, search) {
                return SearchResult::File(found);
            }
        }
        SearchResult::NotFound(CodeFailure::ModuleNotFound)
    }

    fn load_through_config(
        &self,
        specifier: &[u8],
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> Option<Vec<u8>> {
        let config = self.enclosing_code_config(directory)?;
        if config.has_paths()
            && let Some(found) = self.load_through_paths(config, specifier, search)
        {
            return Some(found);
        }
        self.load_as_file_or_directory(&join_unrooted(config.base_url?, specifier), search)
    }

    fn load_from_package_directory(
        &self,
        walk: &PackageWalk<'_>,
        directory: &[u8],
        search: CodeSearch<'_>,
    ) -> Option<SearchResult> {
        let node_modules = match walk.is_self_reference {
            true => None,
            false => Some(self.find_node_modules(directory)?),
        };
        let package = walk.parsed.as_ref().and_then(|parsed| {
            let package_directory = match &node_modules {
                Some(node_modules) => join_unrooted(node_modules, parsed.name),
                None => directory.to_vec(),
            };
            self.is_dir(&package_directory)
                .then_some((parsed, package_directory))
        });
        let orders = &self.code_options().extension_orders;
        let extensions = match &package {
            Some(_) => orders.for_kind(search.kind, true),
            None => search.extensions,
        };
        let search = CodeSearch {
            extensions,
            ..search
        };
        if let Some((parsed, package_directory)) = &package
            && let Some(manifest) = self.code_manifest(package_directory)
            && let Some(exports) = &manifest.exports
        {
            return Some(self.load_package_exports(manifest, exports, &parsed.subpath, search));
        }
        let candidate = match &node_modules {
            Some(node_modules) => join_unrooted(node_modules, walk.specifier),
            None => directory.to_vec(),
        };
        self.load_as_file_or_directory(&candidate, search)
            .map(SearchResult::File)
    }

    pub(super) fn find_node_modules(&self, directory: &[u8]) -> Option<Vec<u8>> {
        if strings::basename_posix(directory) == b"node_modules" {
            return None;
        }
        Some(inside(directory, b"node_modules")).filter(|it| self.is_dir(it))
    }

    pub(super) fn load_package_exports(
        &self,
        manifest: &CodeManifest<'h>,
        exports: &ExportsEntry<'h>,
        subpath: &[u8],
        search: CodeSearch<'_>,
    ) -> SearchResult {
        let options = self.code_options();
        let matches = |condition: &[u8]| options.matches_condition(condition, search);
        let load = |subpath: &[u8]| {
            let resolution = resolve_exports(exports, subpath, &matches);
            self.load_target(&resolution, manifest.directory, search)
        };
        let failure = match load(subpath) {
            Ok(path) => return SearchResult::File(path),
            Err(failure) => failure,
        };
        if bun_paths::extension(subpath) == b".js"
            && subpath.len() > 3
            && let Ok(path) = load(&subpath[..subpath.len() - 3])
        {
            return SearchResult::File(path);
        }
        if subpath == b"./package.json" {
            return SearchResult::File(manifest.path.to_vec());
        }
        SearchResult::NotFound(failure)
    }

    fn load_package_imports(
        &self,
        specifier: &[u8],
        manifest: &CodeManifest<'h>,
        imports: &ExportsEntry<'h>,
        search: CodeSearch<'_>,
    ) -> SearchResult {
        if specifier.len() == 1 || specifier.starts_with(b"#/") {
            return SearchResult::NotFound(CodeFailure::InvalidModuleSpecifier);
        }
        let options = self.code_options();
        let matches = |condition: &[u8]| options.matches_condition(condition, search);
        let resolution = resolve_imports(imports, specifier, &matches);
        let directory = manifest.directory;
        if resolution.status != ExportsStatus::PackageResolve {
            return match self.load_target(&resolution, directory, search) {
                Ok(path) => SearchResult::File(path),
                Err(failure) => SearchResult::NotFound(failure),
            };
        }
        let target = &resolution.path;
        let claim = self.code_host().resolve_runtime_module(target);
        if is_runtime_module(&claim) {
            return SearchResult::Claimed(claim);
        }
        self.load_node_modules(target, directory, search, SubpathImports::Forbidden)
    }

    fn load_target(
        &self,
        resolution: &TargetResolution,
        package_directory: &[u8],
        search: CodeSearch<'_>,
    ) -> Result<Vec<u8>, CodeFailure> {
        let Some(relative) = resolution.path.strip_prefix(b"/") else {
            return Err(resolution.status.failure());
        };
        let target = join_unrooted(package_directory, relative);
        match resolution.status {
            ExportsStatus::Exact => self.load_target_file(target, TargetKind::Exact, search),
            ExportsStatus::ExactEndsWithStar => {
                self.load_target_file(target, TargetKind::Wildcard, search)
            }
            ExportsStatus::Inexact => self
                .load_as_file_or_directory(&target, search)
                .ok_or(CodeFailure::ModuleNotFound),
            _ => Err(resolution.status.failure()),
        }
    }

    fn load_target_file(
        &self,
        target: Vec<u8>,
        kind: TargetKind,
        search: CodeSearch<'_>,
    ) -> Result<Vec<u8>, CodeFailure> {
        let directory = dirname::<Posix>(&target);
        if !self.is_dir(directory) {
            return Err(CodeFailure::ModuleNotFound);
        }
        if self.is_file(&target) {
            return Ok(target);
        }
        let orders = &self.code_options().extension_orders;
        let order = orders.for_kind(search.kind, is_in_node_modules(directory));
        let base = strings::basename_posix(&target);
        let probe = || self.probe_target_extensions(directory, base, order, kind);
        match (self.is_dir(&target), kind) {
            (true, TargetKind::Exact) => Err(CodeFailure::UnsupportedDirectoryImport),
            (true, TargetKind::Wildcard) => probe().ok_or(CodeFailure::UnsupportedDirectoryImport),
            (false, TargetKind::Exact | TargetKind::Wildcard) => {
                probe().ok_or(CodeFailure::ModuleNotFound)
            }
        }
    }
}

fn is_runtime_module(claim: &HostResolution) -> bool {
    match claim {
        HostResolution::Unclaimed | HostResolution::Path(_) | HostResolution::Erased => false,
        _ => true,
    }
}

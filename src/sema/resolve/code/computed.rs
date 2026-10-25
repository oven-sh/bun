use super::manifest::ExportsEntry;
use super::search::join_unrooted;
use super::*;
use crate::fold::slice_in;

const URL_PREFIXES: [&[u8]; 4] = [b"http://", b"https://", b"//", b"data:"];
const HOST_SCHEMES: [&[u8]; 2] = [b"node:", b"bun:"];
const REWRITABLE_EXTENSIONS: [&[u8]; 4] = [b".js", b".jsx", b".mjs", b".cjs"];
const PLACEHOLDER_SUBPATH: &[u8] = b"_";

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum PrefixKind<'a> {
    Empty,
    Path,
    HostScheme,
    Package { name: &'a [u8] },
    IncompletePackageName,
    PackageImports,
    Url,
    NeverResolves,
    Unclear,
}

#[derive(Copy, Clone)]
enum SpecifierForm {
    Path,
    ExportedSubpath,
}

enum WalkStep {
    Enter {
        directory: Vec<u8>,
        relative: Vec<u8>,
    },
    Leave,
}

enum WalkedEntry {
    File(Vec<u8>),
    Directory(Vec<u8>),
}

struct CandidateSearch<'a, 'h> {
    resolver: &'a Resolver<'h>,
    request: ComputedCodeRequest<'a>,
    directory: &'a [u8],
    extensions: Vec<Vec<u8>>,
    limit: usize,
    visited_files: usize,
    visited_directories: usize,
    tried: FxHashSet<Vec<u8>>,
    runtime_modules: Vec<ComputedCandidate<'h>>,
    candidates: Vec<ComputedCandidate<'h>>,
    spellings: Vec<(Vec<u8>, ComputedCandidate<'h>)>,
}

impl<'h> Resolver<'h> {
    pub fn resolve_computed_code(
        &self,
        request: &ComputedCodeRequest<'_>,
    ) -> ComputedResolution<'h> {
        debug_assert!(
            request.kind != CodeImportKind::EntryPoint,
            "an entry point has a constant specifier"
        );
        let mut search = CandidateSearch::new(self, *request);
        let outcome = search.find_candidates();
        search.finish(outcome)
    }
}

impl<'a, 'h> CandidateSearch<'a, 'h> {
    #[allow(clippy::large_types_passed_by_value)] // kept in the search
    fn new(
        resolver: &'a Resolver<'h>,
        request: ComputedCodeRequest<'a>,
    ) -> CandidateSearch<'a, 'h> {
        let options = resolver.code_options();
        let directory = match request.directory.starts_with(b"/") {
            true => request.directory,
            false => options.working_directory.as_slice(),
        };
        let orders = &options.extension_orders;
        let extensions = [
            orders.for_kind(request.kind, false),
            orders.for_kind(request.kind, true),
        ];
        CandidateSearch {
            resolver,
            request,
            directory: strings::without_trailing_slash(directory),
            extensions: extensions.concat(),
            limit: options.max_computed_candidates as usize,
            visited_files: 0,
            visited_directories: 0,
            tried: FxHashSet::default(),
            runtime_modules: Vec::new(),
            candidates: Vec::new(),
            spellings: Vec::new(),
        }
    }

    fn find_candidates(&mut self) -> Result<(), ComputedUnknown> {
        self.add_runtime_modules()?;
        match classify_prefix(self.request.prefix, self.request.suffix) {
            PrefixKind::NeverResolves | PrefixKind::HostScheme => Ok(()),
            PrefixKind::Empty | PrefixKind::Unclear => Err(ComputedUnknown::NoConstantPrefix),
            PrefixKind::IncompletePackageName => Err(ComputedUnknown::IncompletePackageName),
            PrefixKind::PackageImports => Err(ComputedUnknown::PackageImports),
            PrefixKind::Url => Err(ComputedUnknown::ExternalCandidate),
            PrefixKind::Path => self.add_path_candidates(),
            PrefixKind::Package { name } => self.add_package_candidates(name),
        }
    }

    fn finish(mut self, outcome: Result<(), ComputedUnknown>) -> ComputedResolution<'h> {
        let session: &'h Session = self.resolver.session;
        let arena = session.arena();
        match outcome {
            Ok(()) => {
                self.candidates.append(&mut self.runtime_modules);
                let candidates = sorted_candidates_in(self.candidates, arena);
                ComputedResolution::Candidates {
                    candidates,
                    spellings: sorted_spellings_in(self.spellings, candidates, arena),
                }
            }
            Err(cause) => ComputedResolution::All {
                cause,
                host_modules: sorted_candidates_in(self.runtime_modules, arena),
            },
        }
    }

    fn add_runtime_modules(&mut self) -> Result<(), ComputedUnknown> {
        let resolver = self.resolver;
        let ComputedCodeRequest { prefix, suffix, .. } = self.request;
        let mut outcome = Ok(());
        for answer in resolver.code_host().find_runtime_modules(prefix, suffix) {
            match answer {
                HostResolution::Module(module) => {
                    let candidate = ComputedCandidate::HostModule(module);
                    self.runtime_modules.push(candidate);
                }
                HostResolution::ModuleSource { module, path } => {
                    let file = resolver.code_file(&path, Some(module));
                    self.runtime_modules.push(ComputedCandidate::File(file));
                }
                HostResolution::External {
                    kind: ExternalKind::UncompiledCode,
                    ..
                } => outcome = Err(ComputedUnknown::ExternalCandidate),
                HostResolution::External {
                    kind: ExternalKind::HostValue,
                    ..
                }
                | HostResolution::Path(_)
                | HostResolution::Erased
                | HostResolution::Unclaimed => {}
            }
        }
        outcome
    }

    fn add_path_candidates(&mut self) -> Result<(), ComputedUnknown> {
        let prefix = self.request.prefix;
        let (written_directory, name_prefix) = split_after_last_slash(prefix);
        let root = join(self.directory, written_directory);
        if bun_paths::is_absolute(prefix)
            && let Some(config) = self.resolver.enclosing_code_config(self.directory)
            && (config.can_match_prefix(prefix)
                || config.can_match_prefix(&inside(&root, name_prefix)))
        {
            return Err(ComputedUnknown::ConfigPaths);
        }
        self.try_empty_middle()?;
        self.walk_directory(&root, written_directory, name_prefix, SpecifierForm::Path)
    }

    fn add_package_candidates(&mut self, name: &[u8]) -> Result<(), ComputedUnknown> {
        let (resolver, prefix) = (self.resolver, self.request.prefix);
        let config = resolver.enclosing_code_config(self.directory);
        if config.is_some_and(|it| it.base_url.is_some() || it.can_match_prefix(prefix)) {
            return Err(ComputedUnknown::ConfigPaths);
        }
        self.try_empty_middle()?;
        let Some(start) = ancestors(self.directory).find(|it| resolver.is_dir(it)) else {
            return Ok(());
        };
        if let Some(manifest) = resolver.nearest_code_manifest(start)
            && let Some(exports) = &manifest.exports
            && manifest.name == name
        {
            self.add_exported_candidates(manifest, exports, name)?;
        }
        for ancestor in ancestors(start) {
            if let Some(node_modules) = resolver.find_node_modules(ancestor) {
                self.add_installed_candidates(&node_modules, name)?;
            }
        }
        for node_path in &resolver.code_options().node_paths {
            self.walk_below(node_path, b"", SpecifierForm::Path)?;
        }
        Ok(())
    }

    fn add_installed_candidates(
        &mut self,
        node_modules: &[u8],
        name: &[u8],
    ) -> Result<(), ComputedUnknown> {
        let resolver = self.resolver;
        let manifest = installed_name(name)
            .map(|installed| join_unrooted(node_modules, installed))
            .filter(|package_directory| resolver.is_dir(package_directory))
            .and_then(|package_directory| resolver.code_manifest(&package_directory));
        match manifest.and_then(|manifest| Some((manifest, manifest.exports.as_ref()?))) {
            Some((manifest, exports)) => self.add_exported_candidates(manifest, exports, name),
            None => self.walk_below(node_modules, b"", SpecifierForm::Path),
        }
    }

    fn add_exported_candidates(
        &mut self,
        manifest: &CodeManifest<'h>,
        exports: &ExportsEntry<'h>,
        name: &[u8],
    ) -> Result<(), ComputedUnknown> {
        self.try_specifier(&[name, b"/package.json"].concat())?;
        let map = match *exports {
            ExportsEntry::Map(map) => map,
            _ => return Ok(()),
        };
        let subpath_entries = map.entries.iter().filter(|it| it.0.starts_with(b"./"));
        for &(key, entry) in subpath_entries {
            let written = [name, &key[1..]].concat();
            if let Some(star) = strings::index_of_char_usize(&key[1..], b'*') {
                let (base, trailer) = written.split_at(name.len() + star);
                for target in entry.targets() {
                    self.add_pattern_candidates(manifest.directory, target, base, &trailer[1..])?;
                }
            } else if key.ends_with(b"/") {
                self.try_exported_specifier(&written)?;
                let is_directory = |it: &&[u8]| it.starts_with(b"./") && it.ends_with(b"/");
                for target in entry.targets().into_iter().filter(is_directory) {
                    let directory = join_unrooted(manifest.directory, target);
                    self.walk_below(&directory, &written, SpecifierForm::ExportedSubpath)?;
                }
            } else {
                self.try_exported_specifier(&written)?;
            }
        }
        Ok(())
    }

    fn add_pattern_candidates(
        &mut self,
        package_directory: &[u8],
        target: &[u8],
        written_base: &[u8],
        written_trailer: &[u8],
    ) -> Result<(), ComputedUnknown> {
        let ComputedCodeRequest { prefix, suffix, .. } = self.request;
        let can_match_prefix = written_base.starts_with(prefix) || prefix.starts_with(written_base);
        if !can_match_prefix || !target.starts_with(b"./") {
            return Ok(());
        }
        let Some(star) = strings::index_of_char_usize(target, b'*') else {
            let start = std::cmp::max_by_key(prefix, written_base, |it| it.len());
            let end = std::cmp::max_by_key(suffix, written_trailer, |it| it.len());
            return self.try_exported_specifier(&[start, PLACEHOLDER_SUBPATH, end].concat());
        };
        let (target_directory, name_prefix) = split_after_last_slash(&target[..star]);
        let root = join_unrooted(package_directory, target_directory);
        for entry in self.list_entries(&root, name_prefix)? {
            let relative = match entry {
                WalkedEntry::File(relative) => relative,
                WalkedEntry::Directory(_) => continue,
            };
            let path = [target_directory, relative.as_slice()].concat();
            for spelling in specifier_spellings(&path, &self.extensions) {
                if let Some(matched) = match_target(target, &spelling) {
                    let written = [written_base, matched, written_trailer].concat();
                    self.try_exported_specifier(&written)?;
                }
            }
        }
        Ok(())
    }

    fn walk_below(
        &mut self,
        directory: &[u8],
        written: &[u8],
        form: SpecifierForm,
    ) -> Result<(), ComputedUnknown> {
        let prefix = self.request.prefix;
        let remaining: &[u8] = match prefix.strip_prefix(written) {
            Some(remaining) => remaining,
            None if written.starts_with(prefix) => &[],
            None => return Ok(()),
        };
        let (subdirectory, name_prefix) = split_after_last_slash(remaining);
        let root = join_unrooted(directory, subdirectory);
        let written_root = [written, subdirectory].concat();
        self.walk_directory(&root, &written_root, name_prefix, form)
    }

    fn walk_directory(
        &mut self,
        root: &[u8],
        written_root: &[u8],
        name_prefix: &[u8],
        form: SpecifierForm,
    ) -> Result<(), ComputedUnknown> {
        for entry in self.list_entries(root, name_prefix)? {
            match entry {
                WalkedEntry::File(relative) => {
                    self.try_file(&[written_root, relative.as_slice()].concat(), form)?;
                }
                WalkedEntry::Directory(relative) => {
                    let written = [written_root, relative.as_slice()].concat();
                    self.try_spelling(&written, form)?;
                    self.try_spelling(strings::without_trailing_slash(&written), form)?;
                }
            }
        }
        Ok(())
    }

    fn list_entries(
        &mut self,
        root: &[u8],
        name_prefix: &[u8],
    ) -> Result<Vec<WalkedEntry>, ComputedUnknown> {
        let (resolver, extensions) = (self.resolver, &self.extensions);
        let mut entries = Vec::new();
        if !resolver.is_dir(root) {
            return Ok(entries);
        }
        let has_matching_spelling = |name: &[u8]| {
            let spellings = specifier_spellings(name, extensions);
            spellings.iter().any(|it| it.starts_with(name_prefix))
        };
        let mut open_directories: Vec<Vec<u8>> = Vec::new();
        let mut steps = vec![WalkStep::Enter {
            directory: strings::without_trailing_slash(root).to_vec(),
            relative: Vec::new(),
        }];
        while let Some(step) = steps.pop() {
            let (directory, relative) = match step {
                WalkStep::Enter {
                    directory,
                    relative,
                } => (directory, relative),
                WalkStep::Leave => {
                    open_directories.pop();
                    continue;
                }
            };
            let real_directory = resolver.host.realpath(&directory);
            if open_directories.contains(&real_directory) {
                continue;
            }
            self.visited_directories += 1;
            if self.visited_directories > self.limit {
                return Err(ComputedUnknown::TooManyCandidates);
            }
            open_directories.push(real_directory);
            steps.push(WalkStep::Leave);
            let is_root = relative.is_empty();
            let (files, directories) = resolver.host.entries(&directory);
            for name in files {
                if is_root && !name.starts_with(name_prefix) && !has_matching_spelling(&name) {
                    continue;
                }
                // LICENSE, Makefile, a lock file.
                if !has_extension(&name) {
                    continue;
                }
                self.visited_files += 1;
                if self.visited_files > self.limit {
                    return Err(ComputedUnknown::TooManyCandidates);
                }
                entries.push(WalkedEntry::File(
                    [relative.as_slice(), name.as_slice()].concat(),
                ));
            }
            for name in directories {
                let is_excluded = name == b"node_modules" || name.starts_with(b".");
                if is_excluded || (is_root && !name.starts_with(name_prefix)) {
                    continue;
                }
                steps.push(WalkStep::Enter {
                    directory: inside(&directory, &name),
                    relative: [relative.as_slice(), name.as_slice(), b"/"].concat(),
                });
            }
            entries.push(WalkedEntry::Directory(relative));
        }
        Ok(entries)
    }

    fn try_file(&mut self, written: &[u8], form: SpecifierForm) -> Result<(), ComputedUnknown> {
        let ends_with_separator = self.request.suffix.ends_with(b"/");
        for mut spelling in specifier_spellings(written, &self.extensions) {
            if ends_with_separator {
                spelling.push(b'/');
            }
            self.try_spelling(&spelling, form)?;
        }
        Ok(())
    }

    fn try_empty_middle(&mut self) -> Result<(), ComputedUnknown> {
        let ComputedCodeRequest { prefix, suffix, .. } = self.request;
        self.try_specifier(&[prefix, suffix].concat())
    }

    fn try_spelling(&mut self, text: &[u8], form: SpecifierForm) -> Result<(), ComputedUnknown> {
        match form {
            SpecifierForm::Path => self.try_specifier(text),
            SpecifierForm::ExportedSubpath => self.try_exported_specifier(text),
        }
    }

    fn try_exported_specifier(&mut self, text: &[u8]) -> Result<(), ComputedUnknown> {
        self.try_specifier(text)?;
        self.try_specifier(&[text, b".js"].concat())
    }

    fn try_specifier(&mut self, text: &[u8]) -> Result<(), ComputedUnknown> {
        let request = self.request;
        if !matches_pattern(text, request.prefix, request.suffix)
            || !self.tried.insert(text.to_vec())
        {
            return Ok(());
        }
        let resolution = self.resolver.resolve_code(&CodeRequest {
            specifier: text,
            importer: request.importer,
            directory: request.directory,
            kind: request.kind,
            form: request.form,
        });
        let candidate = match resolution {
            CodeResolution::File(file) => ComputedCandidate::File(file),
            CodeResolution::HostModule(module) => ComputedCandidate::HostModule(module),
            CodeResolution::External {
                kind: ExternalKind::UncompiledCode,
                ..
            } => return Err(ComputedUnknown::ExternalCandidate),
            CodeResolution::External {
                kind: ExternalKind::HostValue,
                ..
            }
            | CodeResolution::Erased
            | CodeResolution::NotFound(_) => return Ok(()),
        };
        self.candidates.push(candidate);
        self.spellings.push((text.to_vec(), candidate));
        Ok(())
    }
}

fn has_extension(name: &[u8]) -> bool {
    name.iter().skip(1).any(|&byte| byte == b'.')
}

fn classify_prefix<'a>(prefix: &'a [u8], suffix: &[u8]) -> PrefixKind<'a> {
    let contains =
        |byte: u8| strings::contains_char(prefix, byte) || strings::contains_char(suffix, byte);
    if prefix.is_empty() {
        PrefixKind::Empty
    } else if URL_PREFIXES.iter().any(|url| prefix.starts_with(url)) {
        PrefixKind::Url
    } else if URL_PREFIXES.iter().any(|url| url.starts_with(prefix)) {
        PrefixKind::Unclear
    } else if contains(b'?') || contains(0) {
        PrefixKind::NeverResolves
    } else if contains(b'\\')
        || is_dot_segment(split_after_last_slash(prefix).1)
        || strings::split(suffix, b"/").any(is_dot_segment)
    {
        PrefixKind::Unclear
    } else if prefix.starts_with(b"#") {
        PrefixKind::PackageImports
    } else if bun_paths::is_absolute(prefix)
        || prefix.starts_with(b"./")
        || prefix.starts_with(b"../")
    {
        PrefixKind::Path
    } else if prefix.starts_with(b".") {
        PrefixKind::Unclear
    } else if HOST_SCHEMES.iter().any(|scheme| prefix.starts_with(scheme)) {
        PrefixKind::HostScheme
    } else {
        match written_package_name(prefix) {
            Some(name) if name.len() < prefix.len() => PrefixKind::Package { name },
            Some(_) | None => PrefixKind::IncompletePackageName,
        }
    }
}

fn is_dot_segment(segment: &[u8]) -> bool {
    matches!(segment, b"." | b"..")
}

fn matches_pattern(text: &[u8], prefix: &[u8], suffix: &[u8]) -> bool {
    text.len() >= prefix.len() + suffix.len() && text.starts_with(prefix) && text.ends_with(suffix)
}

fn specifier_spellings(written: &[u8], extensions: &[Vec<u8>]) -> Vec<Vec<u8>> {
    let mut spellings = vec![written.to_vec()];
    let (directory, name) = split_after_last_slash(written);
    let Some(dot) = strings::last_index_of_char(name, b'.') else {
        return spellings;
    };
    let (stem, extension) = written.split_at(directory.len() + dot);
    if extensions.iter().any(|it| it == extension) {
        spellings.push(stem.to_vec());
    }
    let is_rewritten_to_extension = |written_extension: &&[u8]| {
        let rewritten = rewritten_extensions(written_extension);
        rewritten.contains(&extension)
    };
    let written_extensions = REWRITABLE_EXTENSIONS.iter().copied();
    let written_extensions = written_extensions.filter(is_rewritten_to_extension);
    spellings.extend(written_extensions.map(|it| [stem, it].concat()));
    spellings
}

fn match_target<'p>(target: &[u8], path: &'p [u8]) -> Option<&'p [u8]> {
    let first_star = strings::index_of_char_usize(target, b'*')?;
    let star_count = strings::count_char(target, b'*');
    let matched_len = path.len().checked_sub(target.len() - star_count)? / star_count;
    let matched = path.get(first_star..first_star + matched_len)?;
    (strings::replace_owned(target, b"*", matched) == path).then_some(matched)
}

fn split_after_last_slash(text: &[u8]) -> (&[u8], &[u8]) {
    text.split_at(strings::last_index_of_char(text, b'/').map_or(0, |slash| slash + 1))
}

fn sorted_candidates_in<'h>(
    mut candidates: Vec<ComputedCandidate<'h>>,
    arena: &'h Arena,
) -> &'h [ComputedCandidate<'h>] {
    candidates.shared_sort_unstable_by(compare_candidates);
    candidates.dedup();
    slice_in(&candidates, arena)
}

fn sorted_spellings_in<'h>(
    mut spellings: Vec<(Vec<u8>, ComputedCandidate<'h>)>,
    candidates: &[ComputedCandidate<'h>],
    arena: &'h Arena,
) -> &'h [ComputedSpelling<'h>] {
    spellings.shared_sort_unstable_by(|a, b| a.0.cmp(&b.0));
    let spellings: Vec<ComputedSpelling<'h>> = spellings
        .iter()
        .map(|(text, candidate)| {
            let index = candidates.binary_search_by(|it| compare_candidates(it, candidate));
            ComputedSpelling {
                text: slice_in(text, arena),
                candidate: index.expect("a spelled candidate is listed") as u32,
            }
        })
        .collect();
    slice_in(&spellings, arena)
}

fn compare_candidates(a: &ComputedCandidate<'_>, b: &ComputedCandidate<'_>) -> Ordering {
    match (a, b) {
        (ComputedCandidate::File(a), ComputedCandidate::File(b)) => {
            (a.path, a.host_module).cmp(&(b.path, b.host_module))
        }
        (ComputedCandidate::File(_), ComputedCandidate::HostModule(_)) => Ordering::Less,
        (ComputedCandidate::HostModule(_), ComputedCandidate::File(_)) => Ordering::Greater,
        (ComputedCandidate::HostModule(a), ComputedCandidate::HostModule(b)) => a.cmp(b),
    }
}

// `@scope/name` or `name`, up to the slash behind it.
pub(super) fn written_package_name(specifier: &[u8]) -> Option<&[u8]> {
    let slash = strings::index_of_char_usize(specifier, b'/');
    if !specifier.starts_with(b"@") {
        return Some(&specifier[..slash.unwrap_or(specifier.len())]);
    }
    let scope_len = slash? + 1;
    let slash = strings::index_of_char_usize(&specifier[scope_len..], b'/');
    let name_len = slash.map_or(specifier.len(), |slash| scope_len + slash);
    Some(&specifier[..name_len])
}

// The folder of a package in `node_modules`: its written name without a version, `name` of `name@1.0.0`.
pub(super) fn installed_name(specifier: &[u8]) -> Option<&[u8]> {
    if specifier.is_empty() {
        return None;
    }
    let name = written_package_name(specifier)?;
    if name.starts_with(b".") || strings::index_of_any(name, b"\\%").is_some() {
        return None;
    }
    let scope_marker_len = usize::from(name.starts_with(b"@"));
    let at = strings::index_of_char_usize(&name[scope_marker_len..], b'@');
    Some(at.map_or(name, |at| &name[..scope_marker_len + at]))
}

pub(super) fn rewritten_extensions(extension: &[u8]) -> &'static [&'static [u8]] {
    match extension {
        b".js" | b".jsx" => &[b".ts", b".tsx", b".mts"],
        b".mjs" => &[b".mts"],
        b".cjs" => &[b".cts"],
        _ => &[],
    }
}

#[cfg(test)]
mod tests;

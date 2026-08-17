use std::borrow::Cow;

use crate::{Error, Features, GetJsonResult};
use bun_collections::StringHashMap;
use bun_install::bin::Bin;
use bun_install::dependency::{self, Dependency, DependencyExt as _, Tag as DepTag, TagExt as _};
use bun_install::install::{self, PackageID, PackageManager};
use bun_install::integrity::Integrity;
// `bun_install::lockfile` is the column-accessor stub used by the
// audit/why CLI walkers; the yarn migrator needs the real Lockfile/Tree/
// LoadResult enum, so import from `lockfile_real` and alias it back to
// `lockfile` so the qualified `lockfile::DependencySlice` etc. paths below
// resolve against the ported types.
use crate::Origin;
use crate::lockfile_real::package::meta::HasInstallScript;
use crate::lockfile_real::package::{
    Meta as PackageMeta, Package as LockfilePackage, PackageColumns as _,
};
use crate::lockfile_real::{self as lockfile, LoadResult, Lockfile};
use bun_install::npm;
// `Package.resolution` is the file-backed `resolution_real::ResolutionType<u64>`
// (tag + zero-padded `Value` union), constructed via `init(TaggedValue::*)`; the
// `bun_install::resolution` stub keeps `Value` as a struct-of-fields and has no `init`.
use crate::repository::Repository;
use crate::resolution_real::{Resolution, TaggedValue as ResolutionValue};
use crate::versioned_url::VersionedURL;
use bun_core::strings;
use bun_paths::AutoAbsPath;
use bun_semver::{self as Semver, SlicedString, String as SemverString};

// Entry/YarnLock borrow from the input `data: &[u8]` passed to `migrate_yarn_lockfile`;
// `resolved` may instead own a rewritten URL (see `Cow` below) and `git_repo_name` is
// always owned.

pub(crate) struct YarnLock<'a> {
    pub(crate) entries: Vec<Entry<'a>>,
}

#[derive(Default)]
pub struct Entry<'a> {
    pub(crate) specs: Vec<&'a [u8]>,
    /// Name of the package the entry resolves to; see `package_name_of`.
    pub(crate) name: &'a [u8],
    pub(crate) version: &'a [u8],
    // Usually borrows from the input; owned when `set_git_source` rewrites a
    // `github:` spec to a `https://github.com/...` URL.
    pub(crate) resolved: Option<Cow<'a, [u8]>>,
    pub(crate) integrity: Option<&'a [u8]>,
    /// In `DEPENDENCY_SECTIONS` order.
    pub(crate) dependencies: [Option<StringHashMap<&'a [u8]>>; 4],
    pub(crate) commit: Option<&'a [u8]>,
    pub(crate) workspace: bool,
    pub(crate) file: Option<&'a [u8]>,
    pub(crate) os: npm::Negatable<npm::OperatingSystem>,
    pub(crate) cpu: npm::Negatable<npm::Architecture>,
    // Owned heap allocation (unlike the borrowed fields above); created in parse()
    pub(crate) git_repo_name: Option<Box<[u8]>>,
}

const DEPENDENCY_SECTIONS: [(&[u8], dependency::Behavior); 4] = [
    (b"dependencies:", dependency::Behavior::PROD),
    (b"optionalDependencies:", dependency::Behavior::OPTIONAL),
    (b"peerDependencies:", dependency::Behavior::PEER),
    (b"devDependencies:", dependency::Behavior::DEV),
];

pub(crate) struct ParsedNpmAlias<'a> {
    pub(crate) name: &'a [u8],
    pub(crate) version: &'a [u8],
}

impl<'a> Entry<'a> {
    /// The alias spec may follow plain specs of the same package on yarn's shared key line.
    pub(crate) fn package_name_of(specs: &[&'a [u8]]) -> &'a [u8] {
        let first = specs
            .first()
            .map_or(b"".as_slice(), |spec| Self::get_name_from_spec(spec));
        specs
            .iter()
            .find_map(|spec| Self::npm_alias_target(spec))
            .unwrap_or(first)
    }

    /// `alias@npm:<name>@<range>` -> `<name>`; `None` for every other kind of spec.
    pub(crate) fn npm_alias_target(spec: &[u8]) -> Option<&[u8]> {
        let alias_end = strings::index_of(spec, b"@npm:")?;
        let name = Self::parse_npm_alias(&spec[alias_end + 1..]).name;
        (!name.is_empty()).then_some(name)
    }

    /// Whether the dependency was declared as a tarball URL (`name@https://...`).
    pub(crate) fn has_direct_url_spec(&self) -> bool {
        self.specs.iter().any(|spec| {
            strings::index_of(spec, b"@https://").is_some()
                || strings::index_of(spec, b"@http://").is_some()
        })
    }

    /// Identity shared by consolidation and the package-id pass; git entries go by repository.
    pub(crate) fn dedupe_name(&self) -> &[u8] {
        match &self.git_repo_name {
            Some(repo_name) if !self.has_direct_url_spec() => repo_name,
            _ => self.name,
        }
    }

    pub(crate) fn get_name_from_spec(spec: &[u8]) -> &[u8] {
        let unquoted = if spec[0] == b'"' && spec[spec.len() - 1] == b'"' {
            &spec[1..spec.len() - 1]
        } else {
            spec
        };

        if unquoted[0] == b'@' {
            if let Some(second_at) = strings::index_of(&unquoted[1..], b"@") {
                let end_idx = second_at + 1;
                return &unquoted[0..end_idx];
            }
            return unquoted;
        }

        if let Some(npm_idx) = strings::index_of(unquoted, b"@npm:") {
            return &unquoted[0..npm_idx];
        } else if let Some(url_idx) = strings::index_of(unquoted, b"@https://") {
            return &unquoted[0..url_idx];
        } else if let Some(git_idx) = strings::index_of(unquoted, b"@git+") {
            return &unquoted[0..git_idx];
        } else if let Some(gh_idx) = strings::index_of(unquoted, b"@github:") {
            return &unquoted[0..gh_idx];
        } else if let Some(file_idx) = strings::index_of(unquoted, b"@file:") {
            return &unquoted[0..file_idx];
        } else if let Some(idx) = strings::index_of(unquoted, b"@") {
            return &unquoted[0..idx];
        }
        unquoted
    }

    pub(crate) fn is_git_dependency(version: &[u8]) -> bool {
        if let Some(github_path) = version.strip_prefix(b"https://github.com/") {
            // An archive download's `#` is yarn's tarball hash, not a commit.
            return !dependency::is_github_tarball_path(Entry::url_without_hash(github_path));
        }
        version.starts_with(b"git+")
            || version.starts_with(b"git://")
            || version.starts_with(b"github:")
    }

    pub(crate) fn is_npm_alias(version: &[u8]) -> bool {
        version.starts_with(b"npm:")
    }

    /// A spec asked a registry for this entry (a semver range, a dist-tag, or an `npm:` alias of one).
    pub(crate) fn is_registry_entry(&self) -> bool {
        self.specs.iter().any(|spec| {
            let name = Entry::get_name_from_spec(spec);
            let range = spec.get(name.len() + 1..).unwrap_or(b"");
            let alias = range.strip_prefix(b"npm:");
            DepTag::infer(alias.map_or(range, |alias| Entry::parse_npm_alias(alias).version))
                .is_npm()
        })
    }

    pub(crate) fn is_remote_tarball(version: &[u8]) -> bool {
        version.starts_with(b"https://") && version.ends_with(b".tgz")
    }

    /// yarn v1 writes tarball `resolved` fields as `<url>#<sha1 of the tarball>`.
    pub(crate) fn url_without_hash(resolved: &[u8]) -> &[u8] {
        strings::split_once_char(resolved, b'#').map_or(resolved, |(url, _)| url)
    }

    pub(crate) fn is_workspace_dependency(version: &[u8]) -> bool {
        version.starts_with(b"workspace:") || version == b"*"
    }

    pub(crate) fn is_file_dependency(version: &[u8]) -> bool {
        version.starts_with(b"file:") || version.starts_with(b"./") || version.starts_with(b"../")
    }

    pub(crate) fn file_path_from_spec(spec: &[u8]) -> &[u8] {
        let mut path = spec.strip_prefix(b"file:").unwrap_or(spec);
        while let Some(rest) = path.strip_prefix(b"./") {
            path = rest;
        }
        strings::without_trailing_slash(path)
    }

    /// `https://registry.npmjs.org/@scope/name/-/name-1.0.0.tgz` -> `@scope/name`
    pub(crate) fn get_package_name_from_default_registry_url(url: &[u8]) -> Option<&[u8]> {
        let host_and_path = url
            .strip_prefix(b"https://")
            .or_else(|| url.strip_prefix(b"http://"))?;
        let path = host_and_path
            .strip_prefix(b"registry.npmjs.org/")
            .or_else(|| host_and_path.strip_prefix(b"registry.yarnpkg.com/"))?;
        let name = &path[..strings::index_of(path, b"/-/")?];
        (!name.is_empty()).then_some(name)
    }

    /// `commit`, `git_repo_name` and `resolved` of a git `version`/`resolved` value; a `github:`
    /// shorthand resolves to its `https://github.com/` URL.
    fn set_git_source(&mut self, version: &'a [u8]) {
        let url = version.strip_prefix(b"git+").unwrap_or(version);
        self.commit = strings::split_once_char(url, b'#').map(|(_, commit)| commit);
        let url = Entry::url_without_hash(url);
        if let Some(github_path) = version.strip_prefix(b"github:") {
            let path = Entry::url_without_hash(github_path);
            if let Some((_, repo)) = strings::split_once_char(path, b'/') {
                self.git_repo_name = Some(Box::from(repo));
            }
            self.resolved = Some(Cow::Owned([b"https://github.com/", path].concat()));
            return;
        }
        if strings::index_of(url, b"github.com").is_some() {
            let remaining = match strings::index_of(url, b"github.com/") {
                Some(idx) => &url[idx + b"github.com/".len()..],
                None => url,
            };
            if let Some((_, repo)) = strings::split_once_char(remaining, b'/') {
                self.git_repo_name = Some(Box::from(repo.strip_suffix(b".git").unwrap_or(repo)));
            }
        }
        self.resolved = Some(Cow::Borrowed(url));
    }

    /// Splits `npm:<name>@<range>`; the `@` of a scoped `<name>` is not the separator.
    pub(crate) fn parse_npm_alias(version: &[u8]) -> ParsedNpmAlias<'_> {
        let target = version.strip_prefix(b"npm:").unwrap_or(version);
        let scope_len = usize::from(target.starts_with(b"@"));
        let Some(at_idx) = strings::index_of_char_usize(&target[scope_len..], b'@') else {
            return ParsedNpmAlias {
                name: target,
                version: b"*",
            };
        };
        let (name, range) = target.split_at(scope_len + at_idx);
        let range = &range[b"@".len()..];
        ParsedNpmAlias {
            name,
            version: if range.is_empty() { b"*" } else { range },
        }
    }
}

impl<'a> YarnLock<'a> {
    fn init() -> YarnLock<'a> {
        YarnLock {
            entries: Vec::new(),
        }
    }

    fn parse(&mut self, content: &'a [u8]) -> Result<(), Error> {
        let mut lines = strings::split(content, b"\n");
        let mut current_entry: Option<Entry<'a>> = None;
        let mut current_specs: Vec<&'a [u8]> = Vec::new();

        let mut current_dep_type: Option<usize> = None;

        while let Some(line_) = lines.next() {
            let line = bun_core::trim_right(line_, b" \r\t");
            if line.is_empty() || line[0] == b'#' {
                continue;
            }

            let mut indent: usize = 0;
            while indent < line.len() && line[indent] == b' ' {
                indent += 1;
            }

            let trimmed = strings::trim(&line[indent..], b" \r\t");
            if trimmed.is_empty() {
                continue;
            }

            if indent == 0 && trimmed.ends_with(b":") {
                if let Some(entry) = current_entry.take() {
                    self.consolidate_and_append_entry(entry)?;
                }

                current_specs.clear();
                let specs_str = &trimmed[0..trimmed.len() - 1];
                let mut specs_it = strings::split(specs_str, b",");
                while let Some(spec) = specs_it.next() {
                    let spec_trimmed = strings::trim(spec, b" \"");
                    if spec_trimmed.is_empty() {
                        continue;
                    }
                    current_specs.push(spec_trimmed);
                }

                let mut new_entry = Entry::<'a> {
                    specs: current_specs.clone(),
                    name: Entry::package_name_of(&current_specs),
                    version: b"", // assigned below when "version" key is parsed
                    ..Default::default()
                };

                for spec in &current_specs {
                    if let Some(at_index) = strings::index_of(spec, b"@file:") {
                        new_entry.file = Some(Entry::file_path_from_spec(&spec[at_index + 1..]));
                        break;
                    }
                }

                current_entry = Some(new_entry);
                current_dep_type = None;
                continue;
            }

            let Some(entry) = current_entry.as_mut() else {
                continue;
            };

            if indent > 0 {
                if let Some(i) = DEPENDENCY_SECTIONS.iter().position(|s| s.0 == trimmed) {
                    current_dep_type = Some(i);
                    entry.dependencies[i] = Some(StringHashMap::new());
                    continue;
                }

                if let Some(dep_type) = current_dep_type {
                    if let Some(space_idx) = strings::index_of(trimmed, b" ") {
                        let key = strings::trim(&trimmed[0..space_idx], b" \"");
                        let value = strings::trim(&trimmed[space_idx + 1..], b" \"");
                        let map = entry.dependencies[dep_type].get_or_insert_default();
                        map.put(key, value)?;
                    }
                    continue;
                }

                if let Some(space_idx) = strings::index_of(trimmed, b" ") {
                    let key = strings::trim(&trimmed[0..space_idx], b" ");
                    let value = strings::trim(&trimmed[space_idx + 1..], b" \"");

                    if key == b"version" {
                        entry.version = value;

                        if Entry::is_workspace_dependency(value) {
                            entry.workspace = true;
                        } else if Entry::is_file_dependency(value) {
                            entry.file = Some(Entry::file_path_from_spec(value));
                        } else if Entry::is_git_dependency(value) {
                            entry.set_git_source(value);
                        } else if Entry::is_npm_alias(value) {
                            entry.version = Entry::parse_npm_alias(value).version;
                        } else if Entry::is_remote_tarball(value) {
                            entry.resolved = Some(Cow::Borrowed(value));
                        }
                    } else if key == b"resolved" {
                        entry.resolved = Some(Cow::Borrowed(value));
                        if Entry::is_git_dependency(value) {
                            entry.set_git_source(value);
                        }
                    } else if key == b"integrity" {
                        entry.integrity = Some(value);
                    } else if (key == b"os" || key == b"cpu")
                        && value.starts_with(b"[")
                        && value.ends_with(b"]")
                    {
                        for item in strings::split(&value[1..value.len() - 1], b",") {
                            let item = strings::trim(item, b" \"");
                            if key == b"os" {
                                entry.os.apply(item);
                            } else {
                                entry.cpu.apply(item);
                            }
                        }
                    }
                }
            }
        }

        if let Some(entry) = current_entry.take() {
            self.consolidate_and_append_entry(entry)?;
        }

        Ok(())
    }

    fn consolidate_and_append_entry(&mut self, new_entry: Entry<'a>) -> Result<(), Error> {
        if new_entry.specs.is_empty() {
            return Ok(());
        }
        let dedupe_name = new_entry.dedupe_name();

        for existing_entry in self.entries.iter_mut() {
            if dedupe_name == existing_entry.dedupe_name()
                && new_entry.version == existing_entry.version
            {
                let old_len = existing_entry.specs.len();
                let mut combined_specs: Vec<&'a [u8]> =
                    Vec::with_capacity(old_len + new_entry.specs.len());
                combined_specs.extend_from_slice(&existing_entry.specs);
                combined_specs.extend_from_slice(&new_entry.specs);

                existing_entry.specs = combined_specs;
                // new_entry.specs dropped here
                return Ok(());
            }
        }

        self.entries.push(new_entry);
        Ok(())
    }
}

/// Parses `<workspace_path>/package.json` (the root's for `None`) the way `bun install` does and appends it.
fn append_package_json(
    this: &mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    workspace_path: Option<SemverString>,
) -> Result<LockfilePackage, Error> {
    let mut path = AutoAbsPath::init_top_level_dir();
    let _ = path.append(match &workspace_path {
        Some(workspace_path) => workspace_path.slice(this.buffers.string_bytes.as_slice()),
        None => b"",
    });
    let _ = path.append(b"package.json");
    let (source, json) = match manager.workspace_package_json_cache.get_with_path(
        log,
        path.slice(),
        Default::default(),
    ) {
        // Cloned because parsing the root's `workspaces` grows the cache holding this entry.
        GetJsonResult::Entry(entry) => (entry.source.clone(), entry.root),
        GetJsonResult::ReadErr(err) => {
            let path = bstr::BStr::new(path.slice());
            let loc = bun_ast::Loc::EMPTY;
            log.add_error_fmt(
                None,
                loc,
                format_args!("{} reading \"{}\"", err.name(), path),
            );
            return Err(err);
        }
        // The parse diagnostics are already in `log`.
        GetJsonResult::ParseErr(_) => return Err(crate::Error::InvalidPackageJSON),
    };
    let mut package = LockfilePackage::default();
    let features = workspace_path.map_or(Features::main(), |_| Features::WORKSPACE);
    package.parse_with_json(this, manager, log, &source, json, &mut (), features)?;
    if let Some(workspace_path) = workspace_path {
        package.resolution = Resolution::init(ResolutionValue::Workspace(workspace_path));
    }
    Ok(this.append_package(&package)?)
}

/// Only the exact `name@range` key binds; an entry that merely satisfies it is another resolution.
fn bind_importer_dependency(
    this: &Lockfile,
    dep: &Dependency,
    spec_to_package_id: &StringHashMap<PackageID>,
    workspace_id_by_path: &StringHashMap<PackageID>,
    spec: &mut Vec<u8>,
) -> Option<PackageID> {
    let string_bytes = this.buffers.string_bytes.as_slice();
    if dep.version.tag == dependency::Tag::Workspace {
        let path = dep.version.workspace().slice(string_bytes);
        return workspace_id_by_path.get(path).copied();
    }
    // yarn never locked these peers; bind them the way loading a bun.lock does.
    if dep.behavior.is_peer() {
        if dep.behavior.is_optional_peer() {
            // Bound by the hoister, as after a fresh resolve.
            return Some(install::INVALID_PACKAGE_ID);
        }
        // Overrides are not consulted: yarn applied them to the entries the candidates come from.
        let range = this.catalogs.resolve_range(string_bytes, dep);
        let name_hash = lockfile::bun_lock::peer_candidate_name_hash(dep, range, string_bytes);
        let resolutions = this.packages.items_resolution();
        let index = &this.package_index;
        // Nothing satisfies it: the highest version there is, as a fresh install's peer pass picks.
        let newest = || index.get(&name_hash)?.as_slice().first().copied();
        return lockfile::bun_lock::resolve_peer_dep_by_range(
            range,
            name_hash,
            index,
            resolutions,
            string_bytes,
            |_| true,
        )
        .or_else(newest);
    }
    spec.clear();
    spec.extend_from_slice(dep.name.slice(string_bytes));
    spec.push(b'@');
    spec.extend_from_slice(dep.version.literal.slice(string_bytes));
    spec_to_package_id.get(spec.as_slice()).copied()
}

/// Packages `0..importer_count` (root, then workspaces) own every row in the buffers so far.
fn bind_importer_dependencies(
    this: &mut Lockfile,
    importer_count: usize,
    spec_to_package_id: &StringHashMap<PackageID>,
    workspace_id_by_path: &StringHashMap<PackageID>,
) {
    debug_assert_eq!(
        this.buffers.dependencies.len(),
        this.buffers.resolutions.len()
    );
    let mut declared = core::mem::take(&mut this.buffers.dependencies).into_iter();
    this.buffers.resolutions.clear();

    let mut spec: Vec<u8> = Vec::new();
    let mut consumed: u32 = 0;
    for package_id in 0..importer_count {
        let declared_slice = this.packages.items_dependencies()[package_id];
        debug_assert_eq!(declared_slice.off, consumed);
        consumed += declared_slice.len;

        let off = u32::try_from(this.buffers.dependencies.len()).expect("int cast");
        for dep in declared.by_ref().take(declared_slice.len as usize) {
            let bound = bind_importer_dependency(
                this,
                &dep,
                spec_to_package_id,
                workspace_id_by_path,
                &mut spec,
            );
            let Some(resolution) = bound else {
                // `bun install` resolves it, like a dependency added after yarn.lock was written.
                continue;
            };
            this.buffers.dependencies.push(dep);
            this.buffers.resolutions.push(resolution);
        }
        let len = u32::try_from(this.buffers.dependencies.len()).expect("int cast") - off;
        this.packages.items_dependencies_mut()[package_id] =
            lockfile::DependencySlice::new(off, len);
        this.packages.items_resolutions_mut()[package_id] = lockfile::PackageIDSlice::new(off, len);
    }
    debug_assert!(declared.next().is_none());
}

pub(crate) fn migrate_yarn_lockfile<'a>(
    this: &'a mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
) -> Result<LoadResult<'a>, Error> {
    // yarn v2+ (berry) lockfiles are not supported; only the v1 format migrates.
    if !strings::index_of(data, b"# yarn lockfile v1").is_some() {
        return Err(crate::Error::UnsupportedYarnLockfileVersion);
    }

    let mut yarn_lock = YarnLock::init();
    yarn_lock.parse(data)?;

    this.init_empty();
    install::initialize_store();
    bun_core::analytics::Features::yarn_migration_inc(1);

    // A single `Buf` for the whole function would hold
    // `&mut this.buffers.string_bytes` + `&mut this.string_pool` for the
    // function's lifetime and lock out every other `this.*` access. Instead,
    // construct a fresh `Buf` per append via this macro so the mutable borrow
    // ends immediately after each call.
    macro_rules! sbuf {
        () => {
            Semver::string::Buf {
                bytes: &mut this.buffers.string_bytes,
                pool: &mut this.string_pool,
            }
        };
    }

    let root = append_package_json(this, manager, log, None)?;
    debug_assert_eq!(root.meta.id, 0);

    let mut workspace_id_by_path: StringHashMap<PackageID> = StringHashMap::new();
    for dep_id in root.dependencies.begin()..root.dependencies.end() {
        let dep = &this.buffers.dependencies[dep_id as usize];
        if !dep.behavior.is_workspace() {
            continue;
        }
        let workspace_path = *dep.version.workspace();
        let workspace = append_package_json(this, manager, log, Some(workspace_path))?;
        workspace_id_by_path.put(
            workspace_path.slice(this.buffers.string_bytes.as_slice()),
            workspace.meta.id,
        )?;
    }
    let importer_count = this.packages.len();

    // One id per distinct (dedupe name, version), in order of first appearance.
    let mut yarn_entry_to_package_id: Vec<PackageID> = Vec::with_capacity(yarn_lock.entries.len());
    let mut package_id_by_name_version: StringHashMap<PackageID> = StringHashMap::new();
    let mut next_package_id: PackageID = PackageID::try_from(importer_count).expect("int cast");
    let mut key: Vec<u8> = Vec::new();
    for entry in &yarn_lock.entries {
        key.clear();
        key.extend_from_slice(entry.dedupe_name());
        key.push(b'\n');
        key.extend_from_slice(entry.version);
        let package_id = *package_id_by_name_version.get_or_put_value(&key, next_package_id)?;
        if package_id == next_package_id {
            next_package_id += 1;
        }
        yarn_entry_to_package_id.push(package_id);
    }

    // A package's id is its index in `this.packages`, and an entry whose resolution cannot be built is
    // not appended; it stays `INVALID_PACKAGE_ID` here, an unresolved edge like a spec missing from yarn.lock.
    let mut appended_package_ids: Vec<PackageID> =
        vec![install::INVALID_PACKAGE_ID; next_package_id as usize];
    let mut seen_package_ids = vec![false; next_package_id as usize];
    let silent = manager.options.log_level.is_silent();

    for (entry, &package_id) in yarn_lock.entries.iter().zip(&yarn_entry_to_package_id) {
        let is_direct_url_dep = entry.has_direct_url_spec();
        let base_name: &[u8] = entry.name;
        if core::mem::replace(&mut seen_package_ids[package_id as usize], true) {
            continue;
        }

        let resolved_url: Option<&[u8]> = entry.resolved.as_deref().map(Entry::url_without_hash);
        let name_to_use: &[u8] = match (entry.commit, entry.git_repo_name.as_deref()) {
            (Some(_), Some(repo_name)) => repo_name,
            _ => resolved_url
                .filter(|_| is_direct_url_dep)
                .and_then(Entry::get_package_name_from_default_registry_url)
                .unwrap_or(base_name),
        };

        let name_hash = string_hash(name_to_use);

        // reshaped for borrowck — compute the resolution before the
        // `this.packages.append(...)` call so the per-field `sbuf!()` borrows of
        // `this.buffers.string_bytes` don't overlap the two-phase reservation
        // on `this.packages`.
        let pkg_name = sbuf!().append_with_hash(name_to_use, name_hash)?;
        let resolution = 'blk: {
            if entry.workspace {
                break 'blk Resolution::init(ResolutionValue::Workspace(
                    sbuf!().append(base_name)?,
                ));
            } else if let Some(file) = entry.file {
                if file.ends_with(b".tgz") || file.ends_with(b".tar.gz") {
                    break 'blk Resolution::init(ResolutionValue::LocalTarball(
                        sbuf!().append(file)?,
                    ));
                } else {
                    break 'blk Resolution::init(ResolutionValue::Folder(sbuf!().append(file)?));
                }
            } else if let Some(commit) = entry.commit {
                let Some(resolved) = entry.resolved.as_deref() else {
                    break 'blk Resolution::default();
                };
                let mut owner_str: &[u8] = b"";
                let mut repo_str: &[u8] = resolved;
                if let Some(idx) = strings::index_of(resolved, b"github.com/") {
                    let after_github = &resolved[idx + b"github.com/".len()..];
                    if let Some((owner, repo)) = strings::split_once_char(after_github, b'/') {
                        owner_str = owner;
                        repo_str = repo.strip_suffix(b".git").unwrap_or(repo);
                    }
                }
                let is_github = !owner_str.is_empty() && !repo_str.is_empty();
                let committish = if is_github {
                    &commit[..7.min(commit.len())]
                } else {
                    commit
                };
                let package_name = entry.git_repo_name.as_deref().unwrap_or(repo_str);
                let repository = Repository {
                    owner: sbuf!().append(owner_str)?,
                    repo: sbuf!().append(repo_str)?,
                    committish: sbuf!().append(committish)?,
                    resolved: SemverString::default(),
                    package_name: sbuf!().append(package_name)?,
                };
                let value = if is_github {
                    ResolutionValue::Github
                } else {
                    ResolutionValue::Git
                };
                break 'blk Resolution::init(value(repository));
            } else {
                match resolved_url {
                    Some(resolved) if is_direct_url_dep => {
                        break 'blk Resolution::init(ResolutionValue::RemoteTarball(
                            sbuf!().append(resolved)?,
                        ));
                    }
                    None if !entry.is_registry_entry() => break 'blk Resolution::default(),
                    _ => {}
                }

                let version = sbuf!().append(entry.version)?;
                let result =
                    Semver::Version::parse(version.sliced(this.buffers.string_bytes.as_slice()));
                if !result.valid {
                    // An off-registry tarball (codeload and the like) installs from its URL.
                    if let Some(resolved) = resolved_url
                        && Entry::is_remote_tarball(resolved)
                        && Entry::get_package_name_from_default_registry_url(resolved).is_none()
                        && !resolved.starts_with(strings::without_trailing_slash(
                            manager.options.scope.url.href(),
                        ))
                    {
                        break 'blk Resolution::init(ResolutionValue::RemoteTarball(
                            sbuf!().append(resolved)?,
                        ));
                    }
                    break 'blk Resolution::default();
                }

                // The bare URL a fresh install records (`has_trusted_dependency` compares it); empty means the configured registry.
                let url = match resolved_url {
                    Some(resolved)
                        if !(resolved.starts_with(b"https://registry.yarnpkg.com/")
                            || resolved.starts_with(b"https://registry.npmjs.org/")) =>
                    {
                        sbuf!().append(resolved)?
                    }
                    _ => SemverString::default(),
                };
                break 'blk Resolution::init(ResolutionValue::Npm(VersionedURL {
                    url,
                    version: result.version.min(),
                }));
            }
        };

        if resolution.tag == crate::resolution::Tag::Uninitialized {
            if !silent {
                let reason: Cow<str> = if entry.version.is_empty() {
                    "missing \"version\" field".into()
                } else if !Semver::Version::parse_utf8(entry.version).valid {
                    format!("invalid version \"{}\"", bstr::BStr::new(entry.version)).into()
                } else {
                    "missing \"resolved\" field".into()
                };
                let specs = bstr::join(", ", &entry.specs);
                bun_core::warn!(
                    "skipped \"{}\" from yarn.lock: {}",
                    bstr::BStr::new(&specs),
                    reason
                );
            }
            continue;
        }

        let appended_id = PackageID::try_from(this.packages.len()).expect("int cast");
        appended_package_ids[package_id as usize] = appended_id;

        this.packages.append(LockfilePackage {
            name: pkg_name,
            name_hash,
            resolution,
            dependencies: Default::default(),
            resolutions: Default::default(),
            meta: PackageMeta {
                id: appended_id,
                origin: Origin::Npm,
                arch: entry.cpu.combine(),
                os: entry.os.combine(),
                man_dir: SemverString::default(),
                has_install_script: HasInstallScript::False,
                integrity: entry
                    .integrity
                    .map_or_else(Integrity::default, Integrity::parse),
                ..Default::default()
            },
            bin: Bin::init(),
            scripts: Default::default(),
        })?;
        this.get_or_put_id(appended_id, name_hash)?;
    }

    for package_id in yarn_entry_to_package_id.iter_mut() {
        *package_id = appended_package_ids[*package_id as usize];
    }

    let mut spec_to_package_id: StringHashMap<PackageID> = StringHashMap::new();
    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        for spec in entry.specs.iter() {
            spec_to_package_id.put(spec, yarn_entry_to_package_id[yarn_idx])?;
        }
    }

    bind_importer_dependencies(
        this,
        importer_count,
        &spec_to_package_id,
        &workspace_id_by_path,
    );

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let package_id = yarn_entry_to_package_id[yarn_idx];
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }

        let deps_off = u32::try_from(this.buffers.dependencies.len()).expect("int cast");
        for (deps, (_, behavior)) in entry.dependencies.iter().zip(DEPENDENCY_SECTIONS) {
            let Some(deps) = deps else {
                continue;
            };
            for (dep_name_key, dep_version_ref) in deps.iter() {
                let dep_name: &[u8] = dep_name_key.as_ref();
                let dep_version_literal: &[u8] = *dep_version_ref;

                let name_hash = string_hash(dep_name);
                let dep_name_string = sbuf!().append_with_hash(dep_name, name_hash)?;
                let dep_version_string = sbuf!().append(dep_version_literal)?;
                let version_bytes = dep_version_string.slice(this.buffers.string_bytes.as_slice());
                let sliced_string = SlicedString::init(version_bytes, version_bytes);
                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    Some(name_hash),
                    version_bytes,
                    &sliced_string,
                    Some(&mut *log),
                    Some(&mut *manager),
                )
                .unwrap_or_default();
                parsed_version.literal = dep_version_string;

                this.buffers.dependencies.push(Dependency {
                    name: dep_name_string,
                    name_hash,
                    version: parsed_version,
                    behavior,
                });

                key.clear();
                key.extend_from_slice(dep_name);
                key.push(b'@');
                key.extend_from_slice(dep_version_literal);
                let resolution = spec_to_package_id.get(key.as_slice()).copied();
                this.buffers
                    .resolutions
                    .push(resolution.unwrap_or(install::INVALID_PACKAGE_ID));
            }
        }
        let dep_count =
            u32::try_from(this.buffers.dependencies.len()).expect("int cast") - deps_off;

        this.packages.items_dependencies_mut()[package_id as usize] =
            lockfile::DependencySlice::new(deps_off, dep_count);
        this.packages.items_resolutions_mut()[package_id as usize] =
            lockfile::DependencyIDSlice::new(deps_off, dep_count);
    }

    // `Lockfile::resolve` returns `Result<(), tree::SubtreeError>`; surface as
    // a tagged error until `From<SubtreeError>` lands.
    if let Err(_e) = this.resolve(log) {
        return Err(crate::Error::LockfileResolveFailed);
    }

    this.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration::<true>(manager)?;

    if cfg!(debug_assertions) {
        this.verify_data()?;
    }

    this.meta_hash = this.generate_meta_hash(false, this.packages.len())?;

    let result = LoadResult::Ok(lockfile::LoadResultOk {
        lockfile: this,
        migrated: lockfile::Migrated::Yarn,
        serializer_result: Default::default(),
        format: lockfile::LockfileFormat::Binary,
    });

    Ok(result)
}

#[inline]
fn string_hash(s: &[u8]) -> u64 {
    Semver::string::Builder::string_hash(s)
}

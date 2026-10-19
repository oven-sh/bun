use std::borrow::Cow;

use crate::Origin;
use crate::lockfile_real::package::meta::HasInstallScript;
use crate::lockfile_real::package::{
    Meta as PackageMeta, Package as LockfilePackage, PackageColumns as _,
};
use crate::lockfile_real::{self as lockfile, LoadResult, Lockfile};
use crate::migration::{sbuf, string_hash};
use crate::repository::{Repository, github_tarball_tag};
use crate::resolution_real::{Resolution, TaggedValue as ResolutionValue};
use crate::versioned_url::VersionedURL;
use crate::{Error, Features, GetJsonResult};
use bun_collections::StringHashMap;
use bun_core::strings;
use bun_install::bin::Bin;
use bun_install::dependency::{self, Dependency, DependencyExt as _, Tag as DepTag, TagExt as _};
use bun_install::install::{self, PackageID, PackageManager};
use bun_install::integrity::Integrity;
use bun_install::npm;
use bun_paths::AutoAbsPath;
use bun_semver::{self as Semver, String as SemverString};

#[derive(Default)]
pub(crate) struct YarnLock<'a> {
    pub(crate) entries: Vec<Entry<'a>>,
    /// Maps the key that `consolidate_and_append_entry` builds to an index in `entries`.
    entry_by_name_version: StringHashMap<usize>,
}

#[derive(Default)]
pub struct Entry<'a> {
    pub(crate) specs: Vec<&'a [u8]>,
    /// The name of the package that the entry resolves to. See `package_name_of`.
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
    /// The directory that a `link:` spec points to. yarn writes it relative to yarn.lock, even when
    /// the dependency is declared in a workspace.
    pub(crate) link: Option<Cow<'a, [u8]>>,
    pub(crate) os: npm::Negatable<npm::OperatingSystem>,
    pub(crate) cpu: npm::Negatable<npm::Architecture>,
    pub(crate) git_repo_name: Option<Box<[u8]>>,
}

const DEPENDENCY_SECTIONS: [(&[u8], dependency::Behavior); 4] = [
    (b"dependencies:", dependency::Behavior::PROD),
    (b"optionalDependencies:", dependency::Behavior::OPTIONAL),
    (b"peerDependencies:", dependency::Behavior::PEER),
    (b"devDependencies:", dependency::Behavior::DEV),
];

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

    /// Returns `<name>` for `alias@npm:<name>@<range>`, and `None` for every other kind of
    /// specifier.
    pub(crate) fn npm_alias_target(spec: &[u8]) -> Option<&[u8]> {
        let alias_end = strings::index_of(spec, b"@npm:")?;
        let range = dependency::without_npm_protocol(&spec[alias_end + 1..]);
        let (name, _) = Self::parse_npm_alias(range.strip_prefix(b"npm:")?);
        (!name.is_empty()).then_some(name)
    }

    pub(crate) fn has_direct_url_spec(&self) -> bool {
        self.specs.iter().any(|spec| {
            strings::index_of(spec, b"@https://").is_some()
                || strings::index_of(spec, b"@http://").is_some()
        })
    }

    /// The identity that consolidation and the package-id pass both use. Git entries are identified
    /// by repository.
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

    /// Did a spec (a semver range, a dist-tag, or an `npm:` alias of one) ask a registry for it?
    pub(crate) fn is_registry_entry(&self) -> bool {
        self.specs.iter().any(|spec| {
            let name = Entry::get_name_from_spec(spec);
            let range = spec.get(name.len() + 1..).unwrap_or(b"");
            let alias = range.strip_prefix(b"npm:");
            DepTag::infer(alias.map_or(range, |alias| Entry::parse_npm_alias(alias).1)).is_npm()
        })
    }

    pub(crate) fn is_remote_tarball(version: &[u8]) -> bool {
        version.starts_with(b"https://") && version.ends_with(b".tgz")
    }

    /// yarn v1 writes tarball `resolved` fields as `<url>#<sha1 of the tarball>`.
    pub(crate) fn url_without_hash(resolved: &[u8]) -> &[u8] {
        strings::split_once_char(resolved, b'#').map_or(resolved, |(url, _)| url)
    }

    /// The `integrity` line or, without one, the sha1 after the `#` in a tarball's `resolved`.
    fn tarball_integrity(&self) -> Integrity {
        let integrity = self
            .integrity
            .map_or_else(Integrity::default, Integrity::parse);
        // In a git entry, the `#` in `resolved` is followed by a commit, not by the tarball's sha1.
        if integrity.tag.is_supported() || self.commit.is_some() {
            return integrity;
        }
        let resolved = self.resolved.as_deref().unwrap_or(b"");
        match strings::split_once_char(resolved, b'#') {
            Some((_, sha1)) if sha1.len() == 40 => {
                Integrity::parse_sha_sum(sha1).unwrap_or(integrity)
            }
            _ => integrity,
        }
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
        // `-` is a valid package name, so the first "/-/" can be inside `@scope/-`.
        let scope_len = if path.starts_with(b"@") {
            let scope_end = strings::index_of_char_usize(path, b'/')?;
            if scope_end == b"@".len() {
                return None;
            }
            scope_end + 1
        } else {
            0
        };
        let name_len = scope_len + strings::index_of_char_usize(&path[scope_len..], b'/')?;
        let (name, rest) = path.split_at(name_len);
        (rest.starts_with(b"/-/") && dependency::is_safe_install_folder_name(name)).then_some(name)
    }

    /// A `github:` shorthand resolves to its `https://github.com/` URL.
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

    /// Splits `npm:<name>@<range>` into (name, range). The `@` of a scoped `<name>` isn't the
    /// separator.
    pub(crate) fn parse_npm_alias(version: &[u8]) -> (&[u8], &[u8]) {
        let target = version.strip_prefix(b"npm:").unwrap_or(version);
        let scope_len = usize::from(target.starts_with(b"@"));
        let Some(at_idx) = strings::index_of_char_usize(&target[scope_len..], b'@') else {
            return (target, b"*");
        };
        let (name, range) = target.split_at(scope_len + at_idx);
        let range = &range[b"@".len()..];
        (name, if range.is_empty() { b"*" } else { range })
    }
}

impl<'a> YarnLock<'a> {
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

                for &spec in &current_specs {
                    let name = Entry::get_name_from_spec(spec);
                    let range = spec.get(name.len() + 1..).unwrap_or(b"");
                    if let Some(path) = range.strip_prefix(b"link:") {
                        new_entry.link = Some(dependency::link_path_for_lockfile(path));
                        break;
                    }
                    // yarn treats a bare relative path the same as a `file:` path.
                    if range.starts_with(b"file:")
                        || range.starts_with(b"./")
                        || range.starts_with(b"../")
                    {
                        new_entry.file = Some(Entry::file_path_from_spec(range));
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

                        if value.starts_with(b"workspace:") || value == b"*" {
                            entry.workspace = true;
                        } else if value.starts_with(b"file:")
                            || value.starts_with(b"./")
                            || value.starts_with(b"../")
                        {
                            entry.file = Some(Entry::file_path_from_spec(value));
                        } else if Entry::is_git_dependency(value) {
                            entry.set_git_source(value);
                        } else if value.starts_with(b"npm:") {
                            entry.version = Entry::parse_npm_alias(value).1;
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
        // Every `link:` entry has version 0.0.0, so the key needs the path to tell them apart.
        let link = new_entry.link.as_deref().unwrap_or(b"");
        // A name and a version only identify a package when it comes from a registry.
        let (file, resolved, commit) = if new_entry.is_registry_entry() {
            Default::default()
        } else {
            (
                new_entry.file.unwrap_or_default(),
                new_entry.resolved.as_deref().unwrap_or_default(),
                new_entry.commit.unwrap_or_default(),
            )
        };
        let key = [
            new_entry.dedupe_name(),
            b"\n",
            new_entry.version,
            b"\n",
            link,
            b"\n",
            file,
            b"\n",
            resolved,
            b"\n",
            commit,
        ]
        .concat();
        let index = *self
            .entry_by_name_version
            .get_or_put_value(&key, self.entries.len())?;
        match self.entries.get_mut(index) {
            Some(existing_entry) => existing_entry.specs.extend_from_slice(&new_entry.specs),
            None => self.entries.push(new_entry),
        }
        Ok(())
    }
}

/// Parses `<workspace_path>/package.json` (the root's for `None`) the way `bun install` does.
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

/// Only the exact `name@range` key binds. An entry that merely satisfies the range is a different
/// resolution.
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
    // Yarn never locked these peers, so bind them the way loading a bun.lock does.
    if dep.behavior.is_peer() {
        if dep.behavior.is_optional_peer() {
            // Bound by the hoister, as after a fresh resolve.
            return Some(install::INVALID_PACKAGE_ID);
        }
        // Overrides aren't consulted, because Yarn already applied them to the entries that the
        // candidates come from.
        let range = this.catalogs.resolve_range(string_bytes, dep);
        let name_hash = lockfile::bun_lock::peer_candidate_name_hash(dep, range, string_bytes);
        let resolutions = this.packages.items_resolution();
        let index = &this.package_index;
        // Nothing satisfies it, so use the highest version there is, like the peer pass of a fresh
        // install.
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
    // yarn.lock spells a `file:` or `link:` path relative to yarn.lock. The parsed path matches
    // that; the literal in a workspace's package.json is relative to the workspace.
    let (protocol, range) = match dep.version.tag {
        dependency::Tag::Folder => (b"file:".as_slice(), dep.version.folder()),
        dependency::Tag::Symlink => (b"link:".as_slice(), dep.version.symlink()),
        _ => (b"".as_slice(), &dep.version.literal),
    };
    spec.clear();
    spec.extend_from_slice(dep.name.slice(string_bytes));
    spec.push(b'@');
    spec.extend_from_slice(protocol);
    spec.extend_from_slice(range.slice(string_bytes));
    spec_to_package_id.get(spec.as_slice()).copied()
}

/// Packages `0..importer_count` (root, then workspaces) own every row in the buffers so far. Returns those without an entry.
fn bind_importer_dependencies(
    this: &mut Lockfile,
    importer_count: usize,
    spec_to_package_id: &StringHashMap<PackageID>,
    workspace_id_by_path: &StringHashMap<PackageID>,
    frozen: bool,
) -> Vec<Dependency> {
    debug_assert_eq!(
        this.buffers.dependencies.len(),
        this.buffers.resolutions.len()
    );
    let mut declared = core::mem::take(&mut this.buffers.dependencies).into_iter();
    this.buffers.resolutions.clear();

    let mut spec: Vec<u8> = Vec::new();
    let mut unlocked = Vec::new();
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
            // yarn.lock never lists the project's own peer dependencies, so a frozen install leaves
            // this one unresolved.
            let unbound = (frozen && dep.behavior.is_peer()).then_some(install::INVALID_PACKAGE_ID);
            let Some(resolution) = bound.or(unbound) else {
                // `bun install` resolves it, like a dependency added after yarn.lock was written.
                unlocked.push(dep);
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
    unlocked
}

pub(crate) fn migrate_yarn_lockfile<'a>(
    this: &'a mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
) -> Result<LoadResult<'a>, Error> {
    // Yarn reads a file as v1 only when the marker is in the comment lines at its top.
    let is_berry = strings::contains(data, b"\n__metadata:") || data.starts_with(b"__metadata:");
    let has_v1_marker = match strings::index_of(data, b"# yarn lockfile v1") {
        Some(at) if is_berry => strings::split(&data[..at], b"\n")
            .all(|line| line.is_empty() || line.starts_with(b"#") || line == b"\r"),
        Some(_) => true,
        None => false,
    };
    if !has_v1_marker {
        if is_berry {
            return crate::yarn_berry::migrate_yarn_berry_lockfile(this, manager, log, data);
        }
        return Err(crate::Error::UnsupportedYarnLockfileVersion);
    }

    let mut yarn_lock = YarnLock::default();
    yarn_lock.parse(data)?;

    this.init_empty();
    install::initialize_store();
    bun_core::analytics::Features::yarn_migration_inc(1);

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

    // An entry whose resolution cannot be built keeps `INVALID_PACKAGE_ID`. Its specs are then
    // treated as if yarn.lock had no entry for them.
    let mut yarn_entry_to_package_id = vec![install::INVALID_PACKAGE_ID; yarn_lock.entries.len()];
    let verbose = manager.options.log_level.is_verbose();

    for (entry, package_id) in yarn_lock.entries.iter().zip(&mut yarn_entry_to_package_id) {
        let is_direct_url_dep = entry.has_direct_url_spec();
        let base_name: &[u8] = entry.name;

        let resolved_url: Option<&[u8]> = entry.resolved.as_deref().map(Entry::url_without_hash);
        let name_to_use: &[u8] = match (entry.commit, entry.git_repo_name.as_deref()) {
            (Some(_), Some(repo_name)) => repo_name,
            _ => resolved_url
                .filter(|_| is_direct_url_dep)
                .and_then(Entry::get_package_name_from_default_registry_url)
                .unwrap_or(base_name),
        };

        let name_hash = string_hash(name_to_use);

        let pkg_name = sbuf!(this).append_with_hash(name_to_use, name_hash)?;
        let resolution = 'blk: {
            if entry.workspace {
                break 'blk Resolution::init(ResolutionValue::Workspace(
                    sbuf!(this).append(base_name)?,
                ));
            } else if let Some(file) = entry.file {
                if file.ends_with(b".tgz") || file.ends_with(b".tar.gz") {
                    break 'blk Resolution::init(ResolutionValue::LocalTarball(
                        sbuf!(this).append(file)?,
                    ));
                } else {
                    break 'blk Resolution::init(ResolutionValue::Folder(
                        sbuf!(this).append(file)?,
                    ));
                }
            } else if let Some(link) = entry.link.as_deref() {
                break 'blk Resolution::init(ResolutionValue::Symlink(sbuf!(this).append(link)?));
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
                let mut repository = Repository {
                    owner: sbuf!(this).append(owner_str)?,
                    repo: sbuf!(this).append(repo_str)?,
                    committish: sbuf!(this).append(committish)?,
                    resolved: SemverString::default(),
                    package_name: sbuf!(this).append(package_name)?,
                };
                // `resolved` names the cache folder, and is the commit that a git checkout uses.
                let value = if is_github {
                    if let Some(tag) = github_tarball_tag(owner_str, repo_str, commit) {
                        repository.resolved = sbuf!(this).append(&tag)?;
                    }
                    ResolutionValue::Github
                } else {
                    repository.resolved = repository.committish;
                    ResolutionValue::Git
                };
                break 'blk Resolution::init(value(repository));
            } else {
                // yarn locks a spec like `owner/repo` to the host's tarball URL for the commit.
                let is_registry_entry = entry.is_registry_entry();
                match resolved_url {
                    Some(resolved) if is_direct_url_dep || !is_registry_entry => {
                        break 'blk Resolution::init(ResolutionValue::RemoteTarball(
                            sbuf!(this).append(resolved)?,
                        ));
                    }
                    None if !is_registry_entry => break 'blk Resolution::default(),
                    _ => {}
                }

                let version = sbuf!(this).append(entry.version)?;
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
                            sbuf!(this).append(resolved)?,
                        ));
                    }
                    break 'blk Resolution::default();
                }

                // The bare URL that a fresh install records. Empty means the configured registry.
                let url = match resolved_url {
                    Some(resolved)
                        if !(resolved.starts_with(b"https://registry.yarnpkg.com/")
                            || resolved.starts_with(b"https://registry.npmjs.org/")) =>
                    {
                        sbuf!(this).append(resolved)?
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
            if verbose {
                let reason: Cow<str> = if entry.version.is_empty() {
                    "missing \"version\" field".into()
                } else if !Semver::Version::parse_utf8(entry.version).valid {
                    format!(
                        "invalid version \"{}\"",
                        bun_core::fmt::escape_control_chars(entry.version)
                    )
                    .into()
                } else {
                    "missing \"resolved\" field".into()
                };
                let specs = bstr::join(", ", &entry.specs);
                bun_core::warn!(
                    "skipping \"{}\" from yarn.lock: {}",
                    bun_core::fmt::for_terminal(bstr::BStr::new(&specs)),
                    reason
                );
            }
            continue;
        }

        let appended_id = PackageID::try_from(this.packages.len()).expect("int cast");
        *package_id = appended_id;

        let mut package = LockfilePackage {
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
                integrity: entry.tarball_integrity(),
                ..Default::default()
            },
            bin: Bin::init(),
            scripts: Default::default(),
        };
        // yarn.lock does not record bins. For a `file:` folder or a `link:`, they are read from the
        // package.json on disk.
        if matches!(
            resolution.tag,
            crate::resolution::Tag::Folder | crate::resolution::Tag::Symlink
        ) && let Some(folder) = entry.file.or(entry.link.as_deref())
            && let Some(path) = lockfile::join_top_level_dir(&[folder, b"package.json"])
            && let GetJsonResult::Entry(json) = manager.workspace_package_json_cache.get_with_path(
                log,
                path.slice(),
                Default::default(),
            )
        {
            let manifest = json.root;
            crate::migration::parse_manifest_bin(this, &mut package, &manifest)?;
        }
        this.packages.append(package)?;
        this.get_or_put_id(appended_id, name_hash)?;
    }

    let mut spec_to_package_id: StringHashMap<PackageID> = StringHashMap::new();
    for (entry, &package_id) in yarn_lock.entries.iter().zip(&yarn_entry_to_package_id) {
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }
        for spec in entry.specs.iter() {
            spec_to_package_id.put(spec, package_id)?;
        }
        // yarn.lock spells the path as package.json does, with or without `./`.
        // `bind_importer_dependency` looks it up in normalized form, so that form is added too.
        if let Some(file) = entry.file {
            spec_to_package_id.put(&[entry.name, b"@file:", file].concat(), package_id)?;
        } else if let Some(link) = entry.link.as_deref() {
            spec_to_package_id.put(&[entry.name, b"@link:", link].concat(), package_id)?;
        }
    }

    let unlocked = bind_importer_dependencies(
        this,
        importer_count,
        &spec_to_package_id,
        &workspace_id_by_path,
        manager.options.enable.frozen_lockfile(),
    );

    let mut key: Vec<u8> = Vec::new();
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
                let dep_name_string = sbuf!(this).append_with_hash(dep_name, name_hash)?;
                let dep_version_string = sbuf!(this).append(dep_version_literal)?;
                let string_bytes = this.buffers.string_bytes.as_slice();
                let sliced_string = dep_version_string.sliced(string_bytes);
                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    Some(name_hash),
                    sliced_string.slice,
                    &sliced_string,
                    Some(&mut *log),
                    None,
                )
                .unwrap_or_default();
                parsed_version.literal = dep_version_string;

                key.clear();
                key.extend_from_slice(dep_name);
                key.push(b'@');
                key.extend_from_slice(dep_version_literal);
                let locked = spec_to_package_id.get(key.as_slice()).copied();
                // When a workspace's version satisfies the range, yarn links the workspace and
                // writes no yarn.lock entry for it.
                let resolution = locked.or_else(|| {
                    let npm = parsed_version.try_npm().filter(|_| !behavior.is_peer())?;
                    let path = lockfile::linked_workspace_path(
                        manager.options.link_workspace_packages,
                        &this.workspace_paths,
                        &this.workspace_versions,
                        string_hash(npm.name.slice(string_bytes)),
                        &npm.version,
                        string_bytes,
                    )?;
                    workspace_id_by_path.get(path.slice(string_bytes)).copied()
                });

                this.buffers.dependencies.push(Dependency {
                    name: dep_name_string,
                    name_hash,
                    version: parsed_version,
                    behavior,
                });
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

    crate::migration::warn_unlocked_dependencies(this, manager, "yarn.lock", &unlocked);

    this.tag_workspace_links(manager.options.link_workspace_packages);
    if this.resolve(log).is_err() {
        return Err(crate::Error::LockfileResolveFailed);
    }

    this.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration(
        manager, true,  // update_os_cpu
        false, // fill_integrity
        None,
    )?;

    Ok(LoadResult::Ok(lockfile::LoadResultOk {
        lockfile: this,
        migrated: lockfile::Migrated::Yarn,
        serializer_result: Default::default(),
        format: lockfile::LockfileFormat::Binary,
    }))
}

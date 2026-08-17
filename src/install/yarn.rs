use std::borrow::Cow;
use std::io::Write as _;

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

pub struct Entry<'a> {
    pub(crate) specs: Vec<&'a [u8]>,
    /// Name of the package the entry resolves to; see `package_name_of`.
    pub(crate) name: &'a [u8],
    pub(crate) version: &'a [u8],
    // Usually borrows from the input; owned when `parse_git_url` rewrites a
    // `github:` spec to a `https://github.com/...` URL.
    pub(crate) resolved: Option<Cow<'a, [u8]>>,
    pub(crate) integrity: Option<&'a [u8]>,
    pub(crate) dependencies: Option<StringHashMap<&'a [u8]>>,
    pub(crate) optional_dependencies: Option<StringHashMap<&'a [u8]>>,
    pub(crate) peer_dependencies: Option<StringHashMap<&'a [u8]>>,
    pub(crate) dev_dependencies: Option<StringHashMap<&'a [u8]>>,
    pub(crate) commit: Option<&'a [u8]>,
    pub(crate) workspace: bool,
    pub(crate) file: Option<&'a [u8]>,
    pub(crate) os: Option<Vec<&'a [u8]>>,
    pub(crate) cpu: Option<Vec<&'a [u8]>>,
    // Owned heap allocation (unlike the borrowed fields above); created in parse()
    pub(crate) git_repo_name: Option<Box<[u8]>>,
}

impl<'a> Default for Entry<'a> {
    fn default() -> Self {
        Self {
            specs: Vec::new(),
            name: b"",
            version: b"",
            resolved: None,
            integrity: None,
            dependencies: None,
            optional_dependencies: None,
            peer_dependencies: None,
            dev_dependencies: None,
            commit: None,
            workspace: false,
            file: None,
            os: None,
            cpu: None,
            git_repo_name: None,
        }
    }
}

pub(crate) struct ParsedGitUrl<'a> {
    pub(crate) url: &'a [u8],
    pub(crate) commit: Option<&'a [u8]>,
    pub(crate) repo: Option<&'a [u8]>,
    // Optional owned "https://github.com/{path}" buffer so the borrow
    // case stays zero-copy. Callers must check `owned_url` first: when it is `Some`,
    // it supersedes `url` (see `into_resolved`).
    pub(crate) owned_url: Option<Vec<u8>>,
}

pub(crate) struct ParsedNpmAlias<'a> {
    pub(crate) name: &'a [u8],
    pub(crate) version: &'a [u8],
}

impl<'a> Entry<'a> {
    /// The alias spec may follow plain specs of the same package on yarn's shared key line.
    pub(crate) fn package_name_of(specs: &[&'a [u8]]) -> &'a [u8] {
        if let Some(name) = specs.iter().find_map(|spec| Self::npm_alias_target(spec)) {
            return name;
        }
        match specs.first() {
            Some(spec) => Self::get_name_from_spec(spec),
            None => b"",
        }
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
            let range = if Entry::is_npm_alias(range) {
                Entry::parse_npm_alias(range).version
            } else {
                range
            };
            DepTag::infer(range).is_npm()
        })
    }

    pub(crate) fn is_remote_tarball(version: &[u8]) -> bool {
        version.starts_with(b"https://") && version.ends_with(b".tgz")
    }

    /// yarn v1 writes tarball `resolved` fields as `<url>#<sha1 of the tarball>`.
    pub(crate) fn url_without_hash(resolved: &[u8]) -> &[u8] {
        match strings::index_of_char_usize(resolved, b'#') {
            Some(hash_idx) => &resolved[..hash_idx],
            None => resolved,
        }
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

    pub(crate) fn parse_git_url(
        _yarn_lock: &YarnLock<'a>,
        version: &'a [u8],
    ) -> Result<ParsedGitUrl<'a>, Error> {
        let mut url: &[u8] = version;
        let mut commit: Option<&[u8]> = None;
        let mut repo: Option<&[u8]> = None;
        let mut owned_url: Option<Vec<u8>> = None;

        if url.starts_with(b"git+") {
            url = &url[4..];
        }

        if let Some(hash_idx) = strings::index_of(url, b"#") {
            commit = Some(&url[hash_idx + 1..]);
            url = &url[0..hash_idx];
        }

        if version.starts_with(b"github:") {
            let github_path = &version[b"github:".len()..];
            let path_without_commit = if let Some(idx) = strings::index_of(github_path, b"#") {
                &github_path[0..idx]
            } else {
                github_path
            };

            if let Some(slash_idx) = strings::index_of(path_without_commit, b"/") {
                repo = Some(&path_without_commit[slash_idx + 1..]);
            }
            let mut buf =
                Vec::with_capacity(b"https://github.com/".len() + path_without_commit.len());
            buf.extend_from_slice(b"https://github.com/");
            buf.extend_from_slice(path_without_commit);
            owned_url = Some(buf);
            // `url` still borrows the stripped input; callers must prefer
            // `owned_url` when it is Some.
        } else if strings::index_of(url, b"github.com").is_some() {
            let mut remaining = url;
            if let Some(idx) = strings::index_of(remaining, b"github.com/") {
                remaining = &remaining[idx + b"github.com/".len()..];
            }
            if let Some(slash_idx) = strings::index_of(remaining, b"/") {
                let after_owner = &remaining[slash_idx + 1..];
                if after_owner.ends_with(b".git") {
                    repo = Some(&after_owner[0..after_owner.len() - b".git".len()]);
                } else {
                    repo = Some(after_owner);
                }
            }
        }

        Ok(ParsedGitUrl {
            url,
            commit,
            repo,
            owned_url,
        })
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

        let mut current_deps: Option<StringHashMap<&'a [u8]>> = None;
        let mut current_optional_deps: Option<StringHashMap<&'a [u8]>> = None;
        let mut current_peer_deps: Option<StringHashMap<&'a [u8]>> = None;
        let mut current_dev_deps: Option<StringHashMap<&'a [u8]>> = None;
        let mut current_dep_type: Option<DependencyType> = None;

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
                if let Some(mut entry) = current_entry.take() {
                    entry.dependencies = current_deps.take();
                    entry.optional_dependencies = current_optional_deps.take();
                    entry.peer_dependencies = current_peer_deps.take();
                    entry.dev_dependencies = current_dev_deps.take();
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

                current_deps = None;
                current_optional_deps = None;
                current_peer_deps = None;
                current_dev_deps = None;
                current_dep_type = None;
                continue;
            }

            let Some(entry) = current_entry.as_mut() else {
                continue;
            };

            if indent > 0 {
                if trimmed == b"dependencies:" {
                    current_dep_type = Some(DependencyType::Production);
                    current_deps = Some(StringHashMap::new());
                    continue;
                }

                if trimmed == b"optionalDependencies:" {
                    current_dep_type = Some(DependencyType::Optional);
                    current_optional_deps = Some(StringHashMap::new());
                    continue;
                }

                if trimmed == b"peerDependencies:" {
                    current_dep_type = Some(DependencyType::Peer);
                    current_peer_deps = Some(StringHashMap::new());
                    continue;
                }

                if trimmed == b"devDependencies:" {
                    current_dep_type = Some(DependencyType::Development);
                    current_dev_deps = Some(StringHashMap::new());
                    continue;
                }

                if let Some(dep_type) = current_dep_type {
                    if let Some(space_idx) = strings::index_of(trimmed, b" ") {
                        let key = strings::trim(&trimmed[0..space_idx], b" \"");
                        let value = strings::trim(&trimmed[space_idx + 1..], b" \"");
                        let map = match dep_type {
                            DependencyType::Production => current_deps.as_mut().unwrap(),
                            DependencyType::Optional => current_optional_deps.as_mut().unwrap(),
                            DependencyType::Peer => current_peer_deps.as_mut().unwrap(),
                            DependencyType::Development => current_dev_deps.as_mut().unwrap(),
                        };
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
                            let git_info = Entry::parse_git_url(self, value)?;
                            entry.commit = git_info.commit;
                            if let Some(repo_name) = git_info.repo {
                                entry.git_repo_name = Some(Box::<[u8]>::from(repo_name));
                            }
                            // For the `github:` branch the resolved URL is the
                            // owned `https://github.com/{path}` buffer.
                            entry.resolved = Some(match git_info.owned_url {
                                Some(owned) => Cow::Owned(owned),
                                None => Cow::Borrowed(git_info.url),
                            });
                        } else if Entry::is_npm_alias(value) {
                            let alias_info = Entry::parse_npm_alias(value);
                            entry.version = alias_info.version;
                        } else if Entry::is_remote_tarball(value) {
                            entry.resolved = Some(Cow::Borrowed(value));
                        }
                    } else if key == b"resolved" {
                        entry.resolved = Some(Cow::Borrowed(value));
                        if Entry::is_git_dependency(value) {
                            let git_info = Entry::parse_git_url(self, value)?;
                            entry.commit = git_info.commit;
                            if let Some(repo_name) = git_info.repo {
                                entry.git_repo_name = Some(Box::<[u8]>::from(repo_name));
                            }
                            // As in the `version` branch: prefer the rewritten
                            // `https://github.com/...` buffer for `github:` specs.
                            entry.resolved = Some(match git_info.owned_url {
                                Some(owned) => Cow::Owned(owned),
                                None => Cow::Borrowed(git_info.url),
                            });
                        }
                    } else if key == b"integrity" {
                        entry.integrity = Some(value);
                    } else if key == b"os" && value.starts_with(b"[") && value.ends_with(b"]") {
                        let mut os_list: Vec<&'a [u8]> = Vec::new();
                        let mut os_it = strings::split(&value[1..value.len() - 1], b",");
                        while let Some(os) = os_it.next() {
                            let trimmed_os = strings::trim(os, b" \"");
                            os_list.push(trimmed_os);
                        }
                        entry.os = Some(os_list);
                    } else if key == b"cpu" && value.starts_with(b"[") && value.ends_with(b"]") {
                        let mut cpu_list: Vec<&'a [u8]> = Vec::new();
                        let mut cpu_it = strings::split(&value[1..value.len() - 1], b",");
                        while let Some(cpu) = cpu_it.next() {
                            let trimmed_cpu = strings::trim(cpu, b" \"");
                            cpu_list.push(trimmed_cpu);
                        }
                        entry.cpu = Some(cpu_list);
                    }
                }
            }
        }

        if let Some(mut entry) = current_entry.take() {
            entry.dependencies = current_deps.take();
            entry.optional_dependencies = current_optional_deps.take();
            entry.peer_dependencies = current_peer_deps.take();
            entry.dev_dependencies = current_dev_deps.take();
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum DependencyType {
    Production,
    Development,
    Optional,
    Peer,
}

fn read_package_json(
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    abs_package_json_path: &[u8],
) -> Result<(bun_ast::Source, bun_ast::Expr), Error> {
    match manager.workspace_package_json_cache.get_with_path(
        log,
        abs_package_json_path,
        Default::default(),
    ) {
        // Cloned because parsing the root's `workspaces` grows the cache holding this entry.
        GetJsonResult::Entry(entry) => Ok((entry.source.clone(), entry.root)),
        GetJsonResult::ReadErr(err) => {
            log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "{} reading \"{}\"",
                    err.name(),
                    bstr::BStr::new(abs_package_json_path)
                ),
            );
            Err(err)
        }
        // The parse diagnostics are already in `log`.
        GetJsonResult::ParseErr(_) => Err(crate::Error::InvalidPackageJSON),
    }
}

struct Binder<'a> {
    spec_to_package_id: &'a StringHashMap<PackageID>,
    workspace_id_by_path: &'a StringHashMap<PackageID>,
    spec: Vec<u8>,
}

impl Binder<'_> {
    /// Only the exact `name@range` key binds; an entry that merely satisfies it is another resolution.
    fn bind(&mut self, this: &Lockfile, dep: &Dependency) -> Option<PackageID> {
        let string_bytes = this.buffers.string_bytes.as_slice();
        if dep.version.tag == dependency::Tag::Workspace {
            return self
                .workspace_id_by_path
                .get(dep.version.workspace().slice(string_bytes))
                .copied();
        }
        // yarn never locked these peers; bind them the way loading a bun.lock does.
        if dep.behavior.is_peer() {
            if dep.behavior.is_optional_peer() {
                // Bound by the hoister, as after a fresh resolve.
                return Some(install::INVALID_PACKAGE_ID);
            }
            // Overrides are not consulted: yarn applied them to the entries the candidates come from.
            let range = this.catalogs.resolve_range(string_bytes, dep);
            return lockfile::bun_lock::resolve_peer_dep_by_range(
                range,
                lockfile::bun_lock::peer_candidate_name_hash(dep, range, string_bytes),
                &this.package_index,
                this.packages.items_resolution(),
                string_bytes,
            );
        }
        self.spec.clear();
        self.spec.extend_from_slice(dep.name.slice(string_bytes));
        self.spec.push(b'@');
        self.spec
            .extend_from_slice(dep.version.literal.slice(string_bytes));
        self.spec_to_package_id.get(self.spec.as_slice()).copied()
    }
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

    let mut binder = Binder {
        spec_to_package_id,
        workspace_id_by_path,
        spec: Vec::new(),
    };
    let mut consumed: u32 = 0;
    for package_id in 0..importer_count {
        let declared_slice = this.packages.items_dependencies()[package_id];
        debug_assert_eq!(declared_slice.off, consumed);
        consumed += declared_slice.len;

        let off = u32::try_from(this.buffers.dependencies.len()).expect("int cast");
        for dep in declared.by_ref().take(declared_slice.len as usize) {
            let Some(resolution) = binder.bind(this, &dep) else {
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

#[derive(Clone)]
struct VersionInfo {
    // Owned Vec<u8> (rather than a borrow from the input) avoids a second
    // lifetime on the local map.
    version: Vec<u8>,
    package_id: PackageID,
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

    let root = {
        let mut package_json_path = AutoAbsPath::init_top_level_dir();
        let _ = package_json_path.append(b"package.json");
        let (source, json) = read_package_json(manager, log, package_json_path.slice())?;
        let mut root = LockfilePackage::default();
        let mut resolver: () = ();
        root.parse_with_json(
            this,
            manager,
            log,
            &source,
            json,
            &mut resolver,
            Features::main(),
        )?;
        this.append_package(&root)?
    };
    debug_assert_eq!(root.meta.id, 0);

    let mut workspace_id_by_path: StringHashMap<PackageID> = StringHashMap::new();
    for dep_id in root.dependencies.begin()..root.dependencies.end() {
        let dep = &this.buffers.dependencies[dep_id as usize];
        if !dep.behavior.is_workspace() {
            continue;
        }
        let workspace_path = *dep.version.workspace();

        let mut package_json_path = AutoAbsPath::init_top_level_dir();
        let _ =
            package_json_path.append(workspace_path.slice(this.buffers.string_bytes.as_slice()));
        let _ = package_json_path.append(b"package.json");
        let (source, json) = read_package_json(manager, log, package_json_path.slice())?;

        let mut workspace = LockfilePackage::default();
        let mut resolver: () = ();
        workspace.parse_with_json(
            this,
            manager,
            log,
            &source,
            json,
            &mut resolver,
            Features::WORKSPACE,
        )?;
        workspace.resolution = Resolution::init(ResolutionValue::Workspace(workspace_path));
        let workspace = this.append_package(&workspace)?;
        workspace_id_by_path.put(
            workspace_path.slice(this.buffers.string_bytes.as_slice()),
            workspace.meta.id,
        )?;
    }
    let importer_count = this.packages.len();

    let mut yarn_entry_to_package_id: Vec<PackageID> = vec![0; yarn_lock.entries.len()];

    let mut package_versions: StringHashMap<VersionInfo> = StringHashMap::new();

    let mut scoped_packages: StringHashMap<Vec<VersionInfo>> = StringHashMap::new();

    let mut next_package_id: PackageID = PackageID::try_from(importer_count).expect("int cast");

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let name: &[u8] = entry.dedupe_name();
        let version = entry.version;

        if let Some(existing) = package_versions.get(name).cloned() {
            if existing.version.as_slice() != version {
                let mut list = scoped_packages.get(name).cloned().unwrap_or_default();

                let mut found_existing = false;
                let mut found_new = false;
                for item in list.iter() {
                    if item.version.as_slice() == existing.version.as_slice() {
                        found_existing = true;
                    }
                    if item.version.as_slice() == version {
                        found_new = true;
                    }
                }

                if !found_existing {
                    list.push(existing);
                }

                if !found_new {
                    let package_id = next_package_id;
                    next_package_id += 1;
                    list.push(VersionInfo {
                        version: version.to_vec(),
                        package_id,
                    });
                    yarn_entry_to_package_id[yarn_idx] = package_id;
                } else {
                    for item in list.iter() {
                        if item.version.as_slice() == version {
                            yarn_entry_to_package_id[yarn_idx] = item.package_id;
                            break;
                        }
                    }
                }

                scoped_packages.put(name, list)?;
            } else {
                yarn_entry_to_package_id[yarn_idx] = existing.package_id;
            }
        } else {
            let package_id = next_package_id;
            next_package_id += 1;
            yarn_entry_to_package_id[yarn_idx] = package_id;
            package_versions.put(
                name,
                VersionInfo {
                    version: version.to_vec(),
                    package_id,
                },
            )?;
        }
    }

    let mut package_id_to_yarn_idx: Vec<usize> = vec![usize::MAX; next_package_id as usize];

    // The ids handed out above count every distinct name@version, but an entry
    // whose resolution cannot be built is not appended below, and a package's id
    // has to be its index in `this.packages`. Maps the ids above to the appended
    // ones; a skipped entry stays `INVALID_PACKAGE_ID`, which gives its dependents
    // the same unresolved edge as a spec with no yarn.lock entry at all.
    let mut appended_package_ids: Vec<PackageID> =
        vec![install::INVALID_PACKAGE_ID; next_package_id as usize];
    let silent = manager.options.log_level.is_silent();

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let is_direct_url_dep = entry.has_direct_url_spec();
        let base_name: &[u8] = entry.name;
        let package_id = yarn_entry_to_package_id[yarn_idx];

        if (package_id as usize) < package_id_to_yarn_idx.len()
            && package_id_to_yarn_idx[package_id as usize] != usize::MAX
        {
            continue;
        }

        package_id_to_yarn_idx[package_id as usize] = yarn_idx;

        let resolved_url: Option<&[u8]> = entry.resolved.as_deref().map(Entry::url_without_hash);

        let name_to_use: &[u8] = 'blk: {
            if entry.commit.is_some() && entry.git_repo_name.is_some() {
                break 'blk entry.git_repo_name.as_deref().unwrap();
            } else if let (true, Some(resolved)) = (is_direct_url_dep, resolved_url) {
                if let Some(name) = Entry::get_package_name_from_default_registry_url(resolved) {
                    break 'blk name;
                }
            }
            break 'blk base_name;
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
                if let Some(resolved) = entry.resolved.as_deref() {
                    let mut owner_str: &[u8] = b"";
                    let mut repo_str: &[u8] = resolved;

                    if strings::index_of(resolved, b"github.com/").is_some() {
                        if let Some(idx) = strings::index_of(resolved, b"github.com/") {
                            let after_github = &resolved[idx + b"github.com/".len()..];
                            if let Some(slash_idx) = strings::index_of(after_github, b"/") {
                                owner_str = &after_github[0..slash_idx];
                                repo_str = &after_github[slash_idx + 1..];
                                if repo_str.ends_with(b".git") {
                                    repo_str = &repo_str[0..repo_str.len() - 4];
                                }
                            }
                        }
                    }

                    let actual_name: &[u8] = if let Some(repo_name) = &entry.git_repo_name {
                        repo_name
                    } else {
                        repo_str
                    };

                    if !owner_str.is_empty() && !repo_str.is_empty() {
                        break 'blk Resolution::init(ResolutionValue::Github(Repository {
                            owner: sbuf!().append(owner_str)?,
                            repo: sbuf!().append(repo_str)?,
                            committish: sbuf!()
                                .append(&commit[0..b"github:".len().min(commit.len())])?,
                            resolved: SemverString::default(),
                            package_name: sbuf!().append(actual_name)?,
                        }));
                    } else {
                        break 'blk Resolution::init(ResolutionValue::Git(Repository {
                            owner: sbuf!().append(owner_str)?,
                            repo: sbuf!().append(repo_str)?,
                            committish: sbuf!().append(commit)?,
                            resolved: SemverString::default(),
                            package_name: sbuf!().append(actual_name)?,
                        }));
                    }
                }
                break 'blk Resolution::default();
            } else {
                if let Some(resolved) = resolved_url {
                    if is_direct_url_dep {
                        break 'blk Resolution::init(ResolutionValue::RemoteTarball(
                            sbuf!().append(resolved)?,
                        ));
                    }
                } else if !entry.is_registry_entry() {
                    break 'blk Resolution::default();
                }

                let version = sbuf!().append(entry.version)?;
                let result =
                    Semver::Version::parse(version.sliced(this.buffers.string_bytes.as_slice()));
                if !result.valid {
                    // Yarn v1 lockfiles legitimately contain entries without an integrity field
                    // (workspace deps, file:, codeload tarballs), so migration intentionally
                    // accepts off-registry tarball URLs without integrity instead of failing.
                    if let Some(resolved) = resolved_url
                        && (Entry::is_remote_tarball(resolved) || resolved.ends_with(b".tgz"))
                    {
                        break 'blk Resolution::init(ResolutionValue::RemoteTarball(
                            sbuf!().append(resolved)?,
                        ));
                    }
                    break 'blk Resolution::default();
                }

                // `has_trusted_dependency` compares this URL with the canonical registry
                // tarball URL, so it must be the bare URL a fresh install records: no
                // `#sha1`, and no RemoteTarball just because the URL ends in `.tgz`.
                // An empty url is fetched by name@version from the configured registry.
                let is_default_registry = |resolved: &[u8]| {
                    resolved.starts_with(b"https://registry.yarnpkg.com/")
                        || resolved.starts_with(b"https://registry.npmjs.org/")
                };
                let url = match resolved_url {
                    Some(resolved) if !is_default_registry(resolved) => sbuf!().append(resolved)?,
                    _ => SemverString::default(),
                };

                break 'blk Resolution::init(ResolutionValue::Npm(VersionedURL {
                    url,
                    version: result.version.min(),
                }));
            }
        };

        if resolution.tag == ResolutionTag::Uninitialized {
            if !silent {
                let specs = bstr::join(", ", &entry.specs);
                let specs = bstr::BStr::new(&specs);
                if entry.version.is_empty() {
                    bun_core::warn!(
                        "skipped \"{}\" from yarn.lock: missing \"version\" field",
                        specs
                    );
                } else if !Semver::Version::parse_utf8(entry.version).valid {
                    bun_core::warn!(
                        "skipped \"{}\" from yarn.lock: invalid version \"{}\"",
                        specs,
                        bstr::BStr::new(entry.version)
                    );
                } else {
                    bun_core::warn!(
                        "skipped \"{}\" from yarn.lock: missing \"resolved\" field",
                        specs
                    );
                }
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
                arch: if let Some(cpu_list) = &entry.cpu {
                    let mut arch = npm::Architecture::NONE.negatable();
                    for cpu in cpu_list.iter() {
                        arch.apply(cpu);
                    }
                    arch.combine()
                } else {
                    npm::Architecture::ALL
                },
                os: if let Some(os_list) = &entry.os {
                    let mut os = npm::OperatingSystem::NONE.negatable();
                    for os_str in os_list.iter() {
                        os.apply(os_str);
                    }
                    os.combine()
                } else {
                    npm::OperatingSystem::ALL
                },
                man_dir: SemverString::default(),
                has_install_script: HasInstallScript::False,
                integrity: if let Some(integrity) = entry.integrity {
                    Integrity::parse(integrity)
                } else {
                    Integrity::default()
                },
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

        let mut dep_count: u32 = 0;
        let deps_off = u32::try_from(this.buffers.dependencies.len()).expect("int cast");
        let resolutions_off = u32::try_from(this.buffers.resolutions.len()).expect("int cast");

        if let Some(deps) = &entry.dependencies {
            for (dep_name_key, dep_version_ref) in deps.iter() {
                let dep_name: &[u8] = dep_name_key.as_ref();
                let dep_version_literal: &[u8] = *dep_version_ref;

                let name_hash = string_hash(dep_name);
                let dep_name_string = sbuf!().append_with_hash(dep_name, name_hash)?;
                let dep_version_string = sbuf!().append(dep_version_literal)?;
                let sliced_string = SlicedString::init(
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                );

                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    Some(name_hash),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
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
                    behavior: dependency::Behavior::PROD,
                });

                let mut dep_spec = Vec::new();
                write!(
                    &mut dep_spec,
                    "{}@{}",
                    bstr::BStr::new(dep_name),
                    bstr::BStr::new(dep_version_literal)
                )
                .expect("unreachable");

                if let Some(res_pkg_id) = spec_to_package_id.get(dep_spec.as_slice()).copied() {
                    this.buffers.resolutions.push(res_pkg_id);
                } else {
                    this.buffers.resolutions.push(install::INVALID_PACKAGE_ID);
                }

                dep_count += 1;
            }
        }

        if let Some(optional_deps) = &entry.optional_dependencies {
            for (dep_name_key, dep_version_ref) in optional_deps.iter() {
                let dep_name: &[u8] = dep_name_key.as_ref();
                let dep_version_literal: &[u8] = *dep_version_ref;

                let name_hash = string_hash(dep_name);
                let dep_name_string = sbuf!().append_with_hash(dep_name, name_hash)?;

                let dep_version_string = sbuf!().append(dep_version_literal)?;
                let sliced_string = SlicedString::init(
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                );

                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    Some(name_hash),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
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
                    behavior: dependency::Behavior::OPTIONAL,
                });

                let mut dep_spec = Vec::new();
                write!(
                    &mut dep_spec,
                    "{}@{}",
                    bstr::BStr::new(dep_name),
                    bstr::BStr::new(dep_version_literal)
                )
                .expect("unreachable");

                if let Some(res_pkg_id) = spec_to_package_id.get(dep_spec.as_slice()).copied() {
                    this.buffers.resolutions.push(res_pkg_id);
                } else {
                    this.buffers.resolutions.push(install::INVALID_PACKAGE_ID);
                }

                dep_count += 1;
            }
        }

        if let Some(peer_deps) = &entry.peer_dependencies {
            for (dep_name_key, dep_version_ref) in peer_deps.iter() {
                let dep_name: &[u8] = dep_name_key.as_ref();
                let dep_version_literal: &[u8] = *dep_version_ref;

                let name_hash = string_hash(dep_name);
                let dep_name_string = sbuf!().append_with_hash(dep_name, name_hash)?;

                let dep_version_string = sbuf!().append(dep_version_literal)?;
                let sliced_string = SlicedString::init(
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                );

                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    Some(name_hash),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
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
                    behavior: dependency::Behavior::PEER,
                });

                let mut dep_spec = Vec::new();
                write!(
                    &mut dep_spec,
                    "{}@{}",
                    bstr::BStr::new(dep_name),
                    bstr::BStr::new(dep_version_literal)
                )
                .expect("unreachable");

                if let Some(res_pkg_id) = spec_to_package_id.get(dep_spec.as_slice()).copied() {
                    this.buffers.resolutions.push(res_pkg_id);
                } else {
                    this.buffers.resolutions.push(install::INVALID_PACKAGE_ID);
                }

                dep_count += 1;
            }
        }

        if let Some(dev_deps) = &entry.dev_dependencies {
            for (dep_name_key, dep_version_ref) in dev_deps.iter() {
                let dep_name: &[u8] = dep_name_key.as_ref();
                let dep_version_literal: &[u8] = *dep_version_ref;

                let name_hash = string_hash(dep_name);
                let dep_name_string = sbuf!().append_with_hash(dep_name, name_hash)?;

                let dep_version_string = sbuf!().append(dep_version_literal)?;
                let sliced_string = SlicedString::init(
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                );

                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    Some(name_hash),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
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
                    behavior: dependency::Behavior::DEV,
                });

                let mut dep_spec = Vec::new();
                write!(
                    &mut dep_spec,
                    "{}@{}",
                    bstr::BStr::new(dep_name),
                    bstr::BStr::new(dep_version_literal)
                )
                .expect("unreachable");

                if let Some(res_pkg_id) = spec_to_package_id.get(dep_spec.as_slice()).copied() {
                    this.buffers.resolutions.push(res_pkg_id);
                } else {
                    this.buffers.resolutions.push(install::INVALID_PACKAGE_ID);
                }

                dep_count += 1;
            }
        }

        this.packages.items_dependencies_mut()[package_id as usize] =
            lockfile::DependencySlice::new(deps_off, dep_count);

        this.packages.items_resolutions_mut()[package_id as usize] =
            lockfile::DependencyIDSlice::new(resolutions_off, dep_count);
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

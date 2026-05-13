use bun_collections::VecExt;
use std::io::Write as _;

use bun_collections::{HashMap, StringHashMap};
use bun_core::Error;
use bun_install::bin::Bin;
use bun_install::dependency::{self, Dependency, DependencyExt as _};
use bun_install::install::{self, DependencyID, PackageID, PackageManager};
use bun_install::integrity::Integrity;
// PORT NOTE: `bun_install::lockfile` is the column-accessor stub used by the
// audit/why CLI walkers; the yarn migrator needs the real Lockfile/Tree/
// LoadResult enum, so import from `lockfile_real` and alias it back to
// `lockfile` so the qualified `lockfile::DependencySlice` etc. paths below
// resolve against the ported types.
use crate::Origin;
use crate::lockfile_real::package::meta::HasInstallScript;
use crate::lockfile_real::package::{
    Meta as PackageMeta, Package as LockfilePackage, PackageColumns as _,
};
use crate::lockfile_real::{self as lockfile, LoadResult, Lockfile, tree, tree::Tree};
use bun_install::npm;
// PORT NOTE: `Package.resolution` is the file-backed `resolution_real::ResolutionType<u64>`
// (tag + zero-padded `Value` union), constructed via `init(TaggedValue::*)`; the
// `bun_install::resolution` stub keeps `Value` as a struct-of-fields and has no `init`.
use crate::bun_json;
use crate::repository::Repository;
use crate::resolution_real::{Resolution, Tag as ResolutionTag, TaggedValue as ResolutionValue};
use crate::versioned_url::VersionedURL;
use bun_core::strings;
use bun_paths::PathBuffer;
use bun_semver::{self as Semver, SlicedString, String as SemverString};
use bun_sys::Fd;

// TODO(port): lifetime — Entry/YarnLock borrow from the input `data: &[u8]` passed to
// `migrate_yarn_lockfile`. LIFETIMES.tsv had no rows for this file (no *T fields), so
// `'a` here is the BORROW_PARAM classification applied to slice fields. Phase B should
// verify the few owned slices (specs inner strings, file, git_repo_name) don't need
// `Box<[u8]>` instead.

pub struct YarnLock<'a> {
    pub entries: Vec<Entry<'a>>,
}

pub struct Entry<'a> {
    pub specs: Vec<&'a [u8]>,
    pub version: &'a [u8],
    pub resolved: Option<&'a [u8]>,
    pub integrity: Option<&'a [u8]>,
    pub dependencies: Option<StringHashMap<&'a [u8]>>,
    pub optional_dependencies: Option<StringHashMap<&'a [u8]>>,
    pub peer_dependencies: Option<StringHashMap<&'a [u8]>>,
    pub dev_dependencies: Option<StringHashMap<&'a [u8]>>,
    pub commit: Option<&'a [u8]>,
    pub workspace: bool,
    pub file: Option<&'a [u8]>,
    pub os: Option<Vec<&'a [u8]>>,
    pub cpu: Option<Vec<&'a [u8]>>,
    // Owned: allocated via allocPrint/dupe in parse(); freed in deinit
    pub git_repo_name: Option<Box<[u8]>>,
}

impl<'a> Default for Entry<'a> {
    fn default() -> Self {
        Self {
            specs: Vec::new(),
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

pub struct ParsedGitUrl<'a> {
    pub url: &'a [u8],
    pub commit: Option<&'a [u8]>,
    pub owner: Option<&'a [u8]>,
    pub repo: Option<&'a [u8]>,
    // TODO(port): in Zig, `url` may be either a borrow into `version` or a freshly
    // allocPrint'd "https://github.com/{path}". Here we keep an optional owned buffer
    // so the borrow case stays zero-copy. Callers must check `owned_url` first.
    pub owned_url: Option<Vec<u8>>,
}

pub struct ParsedNpmAlias<'a> {
    pub package: &'a [u8],
    pub version: &'a [u8],
}

impl<'a> Entry<'a> {
    pub fn get_name_from_spec(spec: &[u8]) -> &[u8] {
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

    pub fn get_version_from_spec(spec: &[u8]) -> Option<&[u8]> {
        let unquoted = if spec[0] == b'"' && spec[spec.len() - 1] == b'"' {
            &spec[1..spec.len() - 1]
        } else {
            spec
        };

        if unquoted[0] == b'@' {
            if let Some(second_at_pos) = strings::index_of_char(&unquoted[1..], b'@') {
                let version_start = second_at_pos as usize + b"@".len() + 1;
                let version_part = &unquoted[version_start..];

                if version_part.starts_with(b"npm:") && version_part.len() > 4 {
                    return Some(&version_part[b"npm:".len()..]);
                }
                return Some(version_part);
            }
            return None;
        } else if let Some(npm_idx) = strings::index_of(unquoted, b"@npm:") {
            let after_npm = npm_idx + b"npm:".len() + 1;
            if after_npm < unquoted.len() {
                return Some(&unquoted[after_npm..]);
            }
            return None;
        } else if let Some(url_idx) = strings::index_of(unquoted, b"@https://") {
            let after_at = url_idx + 1;
            if after_at < unquoted.len() {
                return Some(&unquoted[after_at..]);
            }
            return None;
        } else if let Some(git_idx) = strings::index_of(unquoted, b"@git+") {
            let after_at = git_idx + 1;
            if after_at < unquoted.len() {
                return Some(&unquoted[after_at..]);
            }
            return None;
        } else if let Some(gh_idx) = strings::index_of(unquoted, b"@github:") {
            let after_at = gh_idx + 1;
            if after_at < unquoted.len() {
                return Some(&unquoted[after_at..]);
            }
            return None;
        } else if let Some(file_idx) = strings::index_of(unquoted, b"@file:") {
            let after_at = file_idx + 1;
            if after_at < unquoted.len() {
                return Some(&unquoted[after_at..]);
            }
            return None;
        } else if let Some(idx) = strings::index_of(unquoted, b"@") {
            let after_at = idx + 1;
            if after_at < unquoted.len() {
                return Some(&unquoted[after_at..]);
            }
            return None;
        }
        None
    }

    pub fn is_git_dependency(version: &[u8]) -> bool {
        version.starts_with(b"git+")
            || version.starts_with(b"git://")
            || version.starts_with(b"github:")
            || version.starts_with(b"https://github.com/")
    }

    pub fn is_npm_alias(version: &[u8]) -> bool {
        version.starts_with(b"npm:")
    }

    pub fn is_remote_tarball(version: &[u8]) -> bool {
        version.starts_with(b"https://") && version.ends_with(b".tgz")
    }

    pub fn is_workspace_dependency(version: &[u8]) -> bool {
        version.starts_with(b"workspace:") || version == b"*"
    }

    pub fn is_file_dependency(version: &[u8]) -> bool {
        version.starts_with(b"file:") || version.starts_with(b"./") || version.starts_with(b"../")
    }

    pub fn parse_git_url(
        _yarn_lock: &YarnLock<'a>,
        version: &'a [u8],
    ) -> Result<ParsedGitUrl<'a>, Error> {
        // TODO(port): narrow error set
        let mut url: &[u8] = version;
        let mut commit: Option<&[u8]> = None;
        let mut owner: Option<&[u8]> = None;
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
                owner = Some(&path_without_commit[0..slash_idx]);
                repo = Some(&path_without_commit[slash_idx + 1..]);
            }
            let mut buf =
                Vec::with_capacity(b"https://github.com/".len() + path_without_commit.len());
            buf.extend_from_slice(b"https://github.com/");
            buf.extend_from_slice(path_without_commit);
            owned_url = Some(buf);
            // url now points into owned_url; callers must read owned_url when Some
        } else if strings::index_of(url, b"github.com").is_some() {
            let mut remaining = url;
            if let Some(idx) = strings::index_of(remaining, b"github.com/") {
                remaining = &remaining[idx + b"github.com/".len()..];
            }
            if let Some(slash_idx) = strings::index_of(remaining, b"/") {
                owner = Some(&remaining[0..slash_idx]);
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
            owner,
            repo,
            owned_url,
        })
    }

    pub fn parse_npm_alias(version: &[u8]) -> ParsedNpmAlias<'_> {
        if version.len() <= 4 {
            return ParsedNpmAlias {
                package: b"",
                version: b"*",
            };
        }

        let npm_part = &version[4..];
        if let Some(at_idx) = strings::index_of(npm_part, b"@") {
            return ParsedNpmAlias {
                package: &npm_part[0..at_idx],
                version: if at_idx + 1 < npm_part.len() {
                    &npm_part[at_idx + 1..]
                } else {
                    b"*"
                },
            };
        }
        ParsedNpmAlias {
            package: npm_part,
            version: b"*",
        }
    }

    pub fn get_package_name_from_resolved_url(url: &[u8]) -> Option<&[u8]> {
        if let Some(dash_idx) = strings::index_of(url, b"/-/") {
            let mut slash_count: usize = 0;
            let mut last_slash: usize = 0;
            let mut second_last_slash: usize = 0;

            let mut i = dash_idx;
            while i > 0 {
                if url[i - 1] == b'/' {
                    slash_count += 1;
                    if slash_count == 1 {
                        last_slash = i - 1;
                    } else if slash_count == 2 {
                        second_last_slash = i - 1;
                        break;
                    }
                }
                i -= 1;
            }

            if last_slash < dash_idx && url[last_slash + 1] == b'@' {
                return Some(&url[second_last_slash + 1..dash_idx]);
            } else if last_slash < dash_idx {
                return Some(&url[last_slash + 1..dash_idx]);
            }
        }

        None
    }
}

impl<'a> YarnLock<'a> {
    pub fn init() -> YarnLock<'a> {
        YarnLock {
            entries: Vec::new(),
        }
    }

    pub fn parse(&mut self, content: &'a [u8]) -> Result<(), Error> {
        // TODO(port): narrow error set
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
                    // TODO(port): Zig dupes here; we borrow from `content` directly since
                    // spec_trimmed is a subslice of `content` and outlives YarnLock<'a>.
                    current_specs.push(spec_trimmed);
                }

                let mut new_entry = Entry::<'a> {
                    specs: current_specs.clone(),
                    version: b"", // assigned below when "version" key is parsed
                    ..Default::default()
                };

                for spec in &current_specs {
                    if let Some(at_index) = strings::index_of(spec, b"@file:") {
                        let file_path = &spec[at_index + 6..];
                        // TODO(port): Zig dupes here; borrow from content instead.
                        new_entry.file = Some(file_path);
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
                            entry.file = Some(
                                if value.starts_with(b"file:") && value.len() > b"file:".len() {
                                    &value[b"file:".len()..]
                                } else {
                                    value
                                },
                            );
                        } else if Entry::is_git_dependency(value) {
                            let git_info = Entry::parse_git_url(self, value)?;
                            // TODO(port): dropped logic — Zig reassigns `url` to the
                            // allocPrint'd `https://github.com/{path}` buffer for the
                            // `github:` branch and stores that as `resolved`. Here
                            // `git_info.url` still borrows the stripped input slice and
                            // `owned_url` is discarded, so github: URLs resolve INCORRECTLY.
                            // Phase B must change Entry.resolved to Cow<'a, [u8]> (or store
                            // the owned buffer on Entry) so `owned_url` can be assigned here.
                            entry.resolved = Some(git_info.url);
                            entry.commit = git_info.commit;
                            if let Some(repo_name) = git_info.repo {
                                entry.git_repo_name = Some(Box::<[u8]>::from(repo_name));
                            }
                        } else if Entry::is_npm_alias(value) {
                            let alias_info = Entry::parse_npm_alias(value);
                            entry.version = alias_info.version;
                        } else if Entry::is_remote_tarball(value) {
                            entry.resolved = Some(value);
                        }
                    } else if key == b"resolved" {
                        entry.resolved = Some(value);
                        if Entry::is_git_dependency(value) {
                            let git_info = Entry::parse_git_url(self, value)?;
                            // TODO(port): same github: owned_url issue as the `version` branch
                            // above — Entry.resolved needs Cow<'a, [u8]> to hold the rewritten
                            // `https://github.com/...` buffer.
                            entry.resolved = Some(git_info.url);
                            entry.commit = git_info.commit;
                            if let Some(repo_name) = git_info.repo {
                                entry.git_repo_name = Some(Box::<[u8]>::from(repo_name));
                            }
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

    fn find_entry_by_spec(&self, spec: &[u8]) -> Option<&Entry<'a>> {
        // PORT NOTE: Zig returns `?*Entry` (mutable ptr) but every caller only
        // reads `.workspace` / `.specs`, so `&self` suffices and avoids the
        // borrowck conflict with the outer `entries.iter()` loops.
        for entry in self.entries.iter() {
            for entry_spec in entry.specs.iter() {
                if *entry_spec == spec {
                    return Some(entry);
                }
            }
        }
        None
    }

    fn consolidate_and_append_entry(&mut self, new_entry: Entry<'a>) -> Result<(), Error> {
        if new_entry.specs.is_empty() {
            return Ok(());
        }
        let package_name = Entry::get_name_from_spec(new_entry.specs[0]);

        for existing_entry in self.entries.iter_mut() {
            if existing_entry.specs.is_empty() {
                continue;
            }
            let existing_name = Entry::get_name_from_spec(existing_entry.specs[0]);

            if package_name == existing_name && new_entry.version == existing_entry.version {
                let old_len = existing_entry.specs.len();
                let mut combined_specs: Vec<&'a [u8]> =
                    Vec::with_capacity(old_len + new_entry.specs.len());
                combined_specs.extend_from_slice(&existing_entry.specs);
                combined_specs.extend_from_slice(&new_entry.specs);

                existing_entry.specs = combined_specs;
                // new_entry.specs dropped here (Zig: allocator.free)
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

fn process_deps(
    deps: &StringHashMap<&[u8]>,
    dep_type: DependencyType,
    yarn_lock_: &YarnLock<'_>,
    string_buf_: &mut Semver::string::Buf,
    deps_buf: &mut [Dependency],
    res_buf: &mut [PackageID],
    log: &mut bun_ast::Log,
    manager: &mut PackageManager,
    yarn_entry_to_package_id: &[PackageID],
) -> Result<usize, Error> {
    // TODO(port): narrow error set
    // PORT NOTE: returns count instead of slice to avoid borrowck conflict with caller's bufs
    let mut count: usize = 0;
    // PERF(port): was stack-fallback alloc (1024 bytes) — profile in Phase B

    for (dep_name_key, dep_version_ref) in deps.iter() {
        let dep_name: &[u8] = dep_name_key.as_ref();
        let dep_version: &[u8] = *dep_version_ref;
        let mut dep_spec = Vec::new();
        write!(
            &mut dep_spec,
            "{}@{}",
            bstr::BStr::new(dep_name),
            bstr::BStr::new(dep_version)
        )
        .expect("unreachable");

        if let Some(dep_entry) = yarn_lock_.find_entry_by_spec(&dep_spec) {
            let dep_entry_workspace = dep_entry.workspace;
            let dep_name_hash = string_hash(dep_name);
            let dep_name_str = string_buf_.append_with_hash(dep_name, dep_name_hash)?;

            let parsed_version = if Entry::is_npm_alias(dep_version) {
                let alias_info = Entry::parse_npm_alias(dep_version);
                alias_info.version
            } else {
                dep_version
            };

            deps_buf[count] = Dependency {
                name: dep_name_str,
                name_hash: dep_name_hash,
                version: Dependency::parse(
                    dep_name_str,
                    Some(dep_name_hash),
                    parsed_version,
                    &SlicedString::init(parsed_version, parsed_version),
                    Some(&mut *log),
                    Some(&mut *manager),
                )
                .unwrap_or_default(),
                behavior: behavior_for(dep_type, dep_entry_workspace),
            };
            let mut found_package_id: Option<PackageID> = None;
            'outer: for (yarn_idx, entry_) in yarn_lock_.entries.iter().enumerate() {
                for entry_spec in entry_.specs.iter() {
                    if *entry_spec == dep_spec.as_slice() {
                        found_package_id = Some(yarn_entry_to_package_id[yarn_idx]);
                        break 'outer;
                    }
                }
            }

            if let Some(pkg_id) = found_package_id {
                res_buf[count] = pkg_id;
                count += 1;
            }
        }
    }
    Ok(count)
}

struct RootDep {
    name: Vec<u8>,
    version: Vec<u8>,
    dep_type: DependencyType,
}

#[derive(Clone)]
struct VersionInfo {
    version: Vec<u8>,
    // TODO(port): Zig stores `string` (borrow from input). Using Vec<u8> here to avoid
    // a second lifetime on the local map; Phase B can switch to &'a [u8].
    package_id: PackageID,
    yarn_idx: usize,
}

pub fn migrate_yarn_lockfile<'a>(
    this: &'a mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    data: &[u8],
    dir: Fd,
) -> Result<LoadResult<'a>, Error> {
    // TODO(port): narrow error set
    // todo yarn v2+ support
    if !strings::index_of(data, b"# yarn lockfile v1").is_some() {
        return Err(bun_core::err!("UnsupportedYarnLockfileVersion"));
    }

    let mut yarn_lock = YarnLock::init();
    yarn_lock.parse(data)?;

    this.init_empty();
    install::initialize_store();
    bun_core::analytics::Features::yarn_migration_inc(1);

    // PORT NOTE: reshaped for borrowck. Zig keeps a single `var string_buf =
    // this.stringBuf()` for the whole function, but in Rust that would hold
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

    let mut num_deps: u32 = 0;
    let mut root_dep_count: u32;
    let mut root_dep_count_from_package_json: u32 = 0;

    let mut root_dependencies: Vec<RootDep> = Vec::new();

    {
        // read package.json to get specified dependencies
        let Ok(package_json_fd) =
            bun_sys::File::openat(dir, b"package.json", bun_sys::O::RDONLY, 0)
        else {
            return Err(bun_core::err!("InvalidPackageJSON"));
        };
        // Zig: `defer package_json_fd.close()` — guard so every early-return
        // below (read_to_end / get_fd_path failure) still closes the fd.
        let package_json_fd = scopeguard::guard(package_json_fd, |f| {
            let _ = f.close(); // close error is non-actionable (Zig parity: discarded)
        });
        let Ok(package_json_contents) = package_json_fd.read_to_end() else {
            return Err(bun_core::err!("InvalidPackageJSON"));
        };

        // The path buffer must outlive `package_json_source`: `Source.path.text`
        // borrows into it (lifetime-erased) and is read when `parse_append`
        // emits a warning (`Location::clone` deep-copies the file path).
        let mut package_json_path_buf = PathBuffer::uninit();
        let package_json_source = {
            let Ok(package_json_path) =
                bun_sys::get_fd_path(package_json_fd.handle(), &mut package_json_path_buf)
            else {
                return Err(bun_core::err!("InvalidPackageJSON"));
            };
            bun_ast::Source::init_path_string(&*package_json_path, package_json_contents.as_slice())
        };
        drop(package_json_fd); // close now; fd no longer needed past path resolution

        // PORT NOTE: Zig passes `comptime opts: js_lexer.JSONOptions`; the Rust
        // port spells the 8 option flags out as const generics (stable Rust has
        // no struct const-generics). Unspecified Zig fields default to false.
        let json_bump = bun_alloc::Arena::new();
        let Ok(package_json_expr) = bun_json::parse_package_json_utf8_with_opts::<
            true,  // IS_JSON
            true,  // ALLOW_COMMENTS
            true,  // ALLOW_TRAILING_COMMAS
            false, // IGNORE_LEADING_ESCAPE_SEQUENCES
            false, // IGNORE_TRAILING_ESCAPE_SEQUENCES
            false, // JSON_WARN_DUPLICATE_KEYS
            false, // WAS_ORIGINALLY_MACRO
            true,  // GUESS_INDENTATION
        >(&package_json_source, log, &json_bump) else {
            return Err(bun_core::err!("InvalidPackageJSON"));
        };

        let package_json = package_json_expr.root;

        let package_name: Option<Vec<u8>> = 'blk: {
            if let Some(name_prop) = package_json.as_property(b"name") {
                if let bun_ast::ExprData::EString(e_string) = &name_prop.expr.data {
                    let name_slice = e_string.string(&json_bump).unwrap_or(b"");
                    if !name_slice.is_empty() {
                        break 'blk Some(name_slice.to_vec());
                    }
                }
            }
            break 'blk None;
        };
        let package_name_hash = if let Some(name) = &package_name {
            Semver::string::Builder::string_hash(name)
        } else {
            0
        };

        use bun_install_types::DependencyGroup;
        // prop literals come from canonical; DependencyType retained as yarn-lexer-local discriminant
        for (group, dep_type) in [
            (DependencyGroup::DEPENDENCIES, DependencyType::Production),
            (DependencyGroup::DEV, DependencyType::Development),
            (DependencyGroup::OPTIONAL, DependencyType::Optional),
            (DependencyGroup::PEER, DependencyType::Peer),
        ] {
            let Some(prop) = package_json.as_property(group.prop) else {
                continue;
            };
            let bun_ast::ExprData::EObject(e_object) = &prop.expr.data else {
                continue;
            };

            for p in e_object.properties.slice() {
                let Some(key) = &p.key else { continue };
                let bun_ast::ExprData::EString(key_str) = &key.data else {
                    continue;
                };

                let Ok(name_slice) = key_str.string(&json_bump) else {
                    continue;
                };
                let Some(value) = &p.value else { continue };
                let bun_ast::ExprData::EString(value_str) = &value.data else {
                    continue;
                };

                let Ok(version_slice) = value_str.string(&json_bump) else {
                    continue;
                };
                if version_slice.is_empty() {
                    continue;
                }

                let name = name_slice.to_vec();
                let version = version_slice.to_vec();
                root_dependencies.push(RootDep {
                    name,
                    version,
                    dep_type,
                });
                root_dep_count_from_package_json += 1;
            }
        }

        root_dep_count = root_dep_count_from_package_json.max(10);
        num_deps += root_dep_count;

        for entry in yarn_lock.entries.iter() {
            if let Some(deps) = &entry.dependencies {
                num_deps += u32::try_from(deps.count()).expect("int cast");
            }
            if let Some(deps) = &entry.optional_dependencies {
                num_deps += u32::try_from(deps.count()).expect("int cast");
            }
            if let Some(deps) = &entry.peer_dependencies {
                num_deps += u32::try_from(deps.count()).expect("int cast");
            }
            if let Some(deps) = &entry.dev_dependencies {
                num_deps += u32::try_from(deps.count()).expect("int cast");
            }
        }

        let num_packages = u32::try_from(yarn_lock.entries.len() + 1).expect("int cast");

        this.buffers
            .dependencies
            .reserve((num_deps as usize).saturating_sub(this.buffers.dependencies.len()));
        this.buffers
            .resolutions
            .reserve((num_deps as usize).saturating_sub(this.buffers.resolutions.len()));
        this.packages.ensure_total_capacity(num_packages as usize)?;
        this.package_index
            .ensure_total_capacity(num_packages as usize)?;

        let root_name = if let Some(name) = &package_name {
            sbuf!().append_with_hash(name, package_name_hash)?
        } else {
            sbuf!().append(b"")?
        };

        this.packages.append(LockfilePackage {
            name: root_name,
            name_hash: package_name_hash,
            resolution: Resolution::init(ResolutionValue::Root),
            dependencies: Default::default(),
            resolutions: Default::default(),
            meta: PackageMeta {
                id: 0,
                origin: Origin::Local,
                arch: npm::Architecture::ALL,
                os: npm::OperatingSystem::ALL,
                man_dir: SemverString::default(),
                has_install_script: HasInstallScript::False,
                integrity: Integrity::default(),
                ..Default::default()
            },
            bin: Bin::init(),
            scripts: Default::default(),
        })?;

        if let Some(resolutions) = package_json.as_property(b"resolutions") {
            let root_package = *this.packages.get(0);
            let (mut string_builder, lf) = this.string_builder_split();

            if let bun_ast::ExprData::EObject(e_object) = &resolutions.expr.data {
                string_builder.cap += e_object.properties.len_u32() as usize * 128;
            }
            if string_builder.cap > 0 {
                string_builder.allocate()?;
            }
            lf.overrides.parse_append(
                manager,
                lf.dependencies.as_slice(),
                &root_package,
                log,
                &package_json_source,
                package_json,
                &mut string_builder,
            )?;
            this.packages.set(0, root_package);
        }
    }

    // SAFETY: capacity reserved above to num_deps; Zig writes into items.ptr[0..num_deps]
    // beyond len. We mirror with raw pointers and set len at the end.
    let dependencies_base_ptr = this.buffers.dependencies.as_mut_ptr();
    let resolutions_base_ptr = this.buffers.resolutions.as_mut_ptr();
    let mut dependencies_buf: &mut [Dependency] = unsafe {
        // SAFETY: capacity >= num_deps reserved above
        bun_core::ffi::slice_mut(dependencies_base_ptr, num_deps as usize)
    };
    let mut resolutions_buf: &mut [PackageID] = unsafe {
        // SAFETY: capacity >= num_deps reserved above
        bun_core::ffi::slice_mut(resolutions_base_ptr, num_deps as usize)
    };

    let mut yarn_entry_to_package_id: Vec<PackageID> = vec![0; yarn_lock.entries.len()];

    let mut package_versions: StringHashMap<VersionInfo> = StringHashMap::new();

    let mut scoped_packages: StringHashMap<Vec<VersionInfo>> = StringHashMap::new();

    let mut next_package_id: PackageID = 1; // 0 is root

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let mut is_npm_alias = false;
        let mut is_direct_url = false;
        for spec in entry.specs.iter() {
            if strings::index_of(spec, b"@npm:").is_some() {
                is_npm_alias = true;
                break;
            }
            if strings::index_of(spec, b"@https://").is_some()
                || strings::index_of(spec, b"@http://").is_some()
            {
                is_direct_url = true;
            }
        }

        let name: &[u8] = if is_npm_alias && entry.resolved.is_some() {
            Entry::get_package_name_from_resolved_url(entry.resolved.unwrap())
                .unwrap_or_else(|| Entry::get_name_from_spec(entry.specs[0]))
        } else if is_direct_url {
            Entry::get_name_from_spec(entry.specs[0])
        } else if let Some(repo_name) = &entry.git_repo_name {
            repo_name
        } else {
            Entry::get_name_from_spec(entry.specs[0])
        };
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
                    list.push(VersionInfo {
                        yarn_idx: existing.yarn_idx,
                        version: existing.version.clone(),
                        package_id: existing.package_id,
                    });
                }

                if !found_new {
                    let package_id = next_package_id;
                    next_package_id += 1;
                    list.push(VersionInfo {
                        yarn_idx,
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
                    yarn_idx,
                },
            )?;
        }
    }

    let mut package_id_to_yarn_idx: Vec<usize> = vec![usize::MAX; next_package_id as usize];

    let mut created_packages: StringHashMap<bool> = StringHashMap::new();
    let _ = &created_packages; // unused in Zig too (only init/deinit)

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let mut is_npm_alias = false;
        for spec in entry.specs.iter() {
            if strings::index_of(spec, b"@npm:").is_some() {
                is_npm_alias = true;
                break;
            }
        }

        let mut is_direct_url_dep = false;
        for spec in entry.specs.iter() {
            if strings::index_of(spec, b"@https://").is_some()
                || strings::index_of(spec, b"@http://").is_some()
            {
                is_direct_url_dep = true;
                break;
            }
        }

        let base_name: &[u8] = if is_npm_alias && entry.resolved.is_some() {
            Entry::get_package_name_from_resolved_url(entry.resolved.unwrap())
                .unwrap_or_else(|| Entry::get_name_from_spec(entry.specs[0]))
        } else {
            Entry::get_name_from_spec(entry.specs[0])
        };
        let package_id = yarn_entry_to_package_id[yarn_idx];

        if (package_id as usize) < package_id_to_yarn_idx.len()
            && package_id_to_yarn_idx[package_id as usize] != usize::MAX
        {
            continue;
        }

        package_id_to_yarn_idx[package_id as usize] = yarn_idx;

        let name_to_use: &[u8] = 'blk: {
            if entry.commit.is_some() && entry.git_repo_name.is_some() {
                break 'blk entry.git_repo_name.as_deref().unwrap();
            } else if let Some(resolved) = entry.resolved {
                if is_direct_url_dep
                    || Entry::is_remote_tarball(resolved)
                    || resolved.ends_with(b".tgz")
                {
                    // https://registry.npmjs.org/package/-/package-version.tgz
                    if strings::index_of(resolved, b"registry.npmjs.org/").is_some()
                        || strings::index_of(resolved, b"registry.yarnpkg.com/").is_some()
                    {
                        if let Some(separator_idx) = strings::index_of(resolved, b"/-/") {
                            if let Some(registry_idx) = strings::index_of(resolved, b"registry.") {
                                let after_registry = &resolved[registry_idx..];
                                if let Some(domain_slash) = strings::index_of(after_registry, b"/")
                                {
                                    let package_start = registry_idx + domain_slash + 1;
                                    let extracted_name = &resolved[package_start..separator_idx];
                                    break 'blk extracted_name;
                                }
                            }
                        }
                    }
                    break 'blk base_name;
                }
            }
            break 'blk base_name;
        };

        let name_hash = string_hash(name_to_use);

        // PORT NOTE: reshaped for borrowck — compute the resolution before the
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
                if let Some(resolved) = entry.resolved {
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
            } else if let Some(resolved) = entry.resolved {
                if is_direct_url_dep {
                    break 'blk Resolution::init(ResolutionValue::RemoteTarball(
                        sbuf!().append(resolved)?,
                    ));
                }

                if Entry::is_remote_tarball(resolved) {
                    break 'blk Resolution::init(ResolutionValue::RemoteTarball(
                        sbuf!().append(resolved)?,
                    ));
                } else if resolved.ends_with(b".tgz") {
                    break 'blk Resolution::init(ResolutionValue::RemoteTarball(
                        sbuf!().append(resolved)?,
                    ));
                }

                let version = sbuf!().append(entry.version)?;
                let result =
                    Semver::Version::parse(version.sliced(this.buffers.string_bytes.as_slice()));
                if !result.valid {
                    break 'blk Resolution::default();
                }

                let is_default_registry = resolved.starts_with(b"https://registry.yarnpkg.com/")
                    || resolved.starts_with(b"https://registry.npmjs.org/");

                let url = if is_default_registry {
                    SemverString::default()
                } else {
                    sbuf!().append(resolved)?
                };

                break 'blk Resolution::init(ResolutionValue::Npm(VersionedURL {
                    url,
                    version: result.version.min(),
                }));
            } else {
                break 'blk Resolution::default();
            }
        };

        this.packages.append(LockfilePackage {
            name: pkg_name,
            name_hash,
            resolution,
            dependencies: Default::default(),
            resolutions: Default::default(),
            meta: PackageMeta {
                id: package_id,
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
    }

    // PORT NOTE: Zig holds two `items(.field)` slices simultaneously; the
    // derive's `&mut self` accessors can't alias, so we re-borrow per write
    // below via `this.packages.items_*_mut()[idx] = …` instead of caching.

    let mut actual_root_dep_count: u32 = 0;

    if !root_dependencies.is_empty() {
        for dep in root_dependencies.iter() {
            let mut dep_spec = Vec::new();
            write!(
                &mut dep_spec,
                "{}@{}",
                bstr::BStr::new(&dep.name),
                bstr::BStr::new(&dep.version)
            )
            .expect("unreachable");

            let mut found_idx: Option<usize> = None;
            for (idx, entry) in yarn_lock.entries.iter().enumerate() {
                for spec in entry.specs.iter() {
                    if *spec == dep_spec.as_slice() {
                        found_idx = Some(idx);
                        break;
                    }
                }
                if found_idx.is_some() {
                    break;
                }
            }

            if let Some(idx) = found_idx {
                let name_hash = string_hash(&dep.name);
                let dep_name_string = sbuf!().append_with_hash(&dep.name, name_hash)?;
                let version_string = sbuf!().append(&dep.version)?;

                dependencies_buf[actual_root_dep_count as usize] = Dependency {
                    name: dep_name_string,
                    name_hash,
                    version: Dependency::parse(
                        dep_name_string,
                        Some(name_hash),
                        version_string.slice(this.buffers.string_bytes.as_slice()),
                        &version_string.sliced(this.buffers.string_bytes.as_slice()),
                        Some(&mut *log),
                        Some(&mut *manager),
                    )
                    .unwrap_or_default(),
                    behavior: behavior_for(dep.dep_type, false),
                };

                resolutions_buf[actual_root_dep_count as usize] = yarn_entry_to_package_id[idx];
                actual_root_dep_count += 1;
            }
        }
    }

    this.packages.items_dependencies_mut()[0] =
        lockfile::DependencySlice::new(0, actual_root_dep_count);
    this.packages.items_resolutions_mut()[0] =
        lockfile::DependencyIDSlice::new(0, actual_root_dep_count);

    dependencies_buf = &mut dependencies_buf[actual_root_dep_count as usize..];
    resolutions_buf = &mut resolutions_buf[actual_root_dep_count as usize..];

    for yarn_idx in 0..yarn_lock.entries.len() {
        let package_id = yarn_entry_to_package_id[yarn_idx];
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }

        let dependencies_start = dependencies_buf.as_mut_ptr();
        let resolutions_start = resolutions_buf.as_mut_ptr();

        // PORT NOTE: reshaped for borrowck — iterate by index and re-borrow
        // `yarn_lock.entries[yarn_idx]` for each map so the shared borrow of
        // `yarn_lock` passed into `process_deps` doesn't overlap an iterator.
        if let Some(deps) = yarn_lock.entries[yarn_idx].dependencies.as_ref() {
            let processed = process_deps(
                deps,
                DependencyType::Production,
                &yarn_lock,
                &mut sbuf!(),
                dependencies_buf,
                resolutions_buf,
                &mut *log,
                &mut *manager,
                &yarn_entry_to_package_id,
            )?;
            dependencies_buf = &mut dependencies_buf[processed..];
            resolutions_buf = &mut resolutions_buf[processed..];
        }

        if let Some(deps) = yarn_lock.entries[yarn_idx].optional_dependencies.as_ref() {
            let processed = process_deps(
                deps,
                DependencyType::Optional,
                &yarn_lock,
                &mut sbuf!(),
                dependencies_buf,
                resolutions_buf,
                &mut *log,
                &mut *manager,
                &yarn_entry_to_package_id,
            )?;
            dependencies_buf = &mut dependencies_buf[processed..];
            resolutions_buf = &mut resolutions_buf[processed..];
        }

        if let Some(deps) = yarn_lock.entries[yarn_idx].peer_dependencies.as_ref() {
            let processed = process_deps(
                deps,
                DependencyType::Peer,
                &yarn_lock,
                &mut sbuf!(),
                dependencies_buf,
                resolutions_buf,
                &mut *log,
                &mut *manager,
                &yarn_entry_to_package_id,
            )?;
            dependencies_buf = &mut dependencies_buf[processed..];
            resolutions_buf = &mut resolutions_buf[processed..];
        }

        if let Some(deps) = yarn_lock.entries[yarn_idx].dev_dependencies.as_ref() {
            let processed = process_deps(
                deps,
                DependencyType::Development,
                &yarn_lock,
                &mut sbuf!(),
                dependencies_buf,
                resolutions_buf,
                &mut *log,
                &mut *manager,
                &yarn_entry_to_package_id,
            )?;
            dependencies_buf = &mut dependencies_buf[processed..];
            resolutions_buf = &mut resolutions_buf[processed..];
        }

        // dependencies_start/dependencies_buf.as_ptr() are within the same allocation
        let deps_len = (dependencies_buf.as_mut_ptr() as usize) - (dependencies_start as usize);
        let deps_off = (dependencies_start as usize) - (dependencies_base_ptr as usize);
        this.packages.items_dependencies_mut()[package_id as usize] =
            lockfile::DependencySlice::new(
                u32::try_from(deps_off / core::mem::size_of::<Dependency>()).expect("int cast"),
                u32::try_from(deps_len / core::mem::size_of::<Dependency>()).expect("int cast"),
            );
        let res_off = (resolutions_start as usize) - (resolutions_base_ptr as usize);
        let res_len = (resolutions_buf.as_mut_ptr() as usize) - (resolutions_start as usize);
        this.packages.items_resolutions_mut()[package_id as usize] =
            lockfile::DependencyIDSlice::new(
                u32::try_from(res_off / core::mem::size_of::<PackageID>()).expect("int cast"),
                u32::try_from(res_len / core::mem::size_of::<PackageID>()).expect("int cast"),
            );
    }

    let final_deps_len = ((dependencies_buf.as_mut_ptr() as usize)
        - (dependencies_base_ptr as usize))
        / core::mem::size_of::<Dependency>();
    unsafe {
        // SAFETY: all elements in 0..final_deps_len initialized above; capacity >= num_deps
        this.buffers.dependencies.set_len(final_deps_len);
        this.buffers.resolutions.set_len(final_deps_len);
    }

    this.buffers.hoisted_dependencies.reserve(
        (this.buffers.dependencies.len() * 2)
            .saturating_sub(this.buffers.hoisted_dependencies.len()),
    );

    this.buffers.trees.push(Tree {
        id: 0,
        parent: tree::INVALID_ID,
        dependency_id: tree::ROOT_DEP_ID,
        dependencies: lockfile::DependencyIDSlice::new(0, 0),
    });

    let mut package_dependents: Vec<Vec<PackageID>> =
        (0..next_package_id).map(|_| Vec::new()).collect();

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let parent_package_id = yarn_entry_to_package_id[yarn_idx];

        let dep_maps: [Option<&StringHashMap<&[u8]>>; 4] = [
            entry.dependencies.as_ref(),
            entry.optional_dependencies.as_ref(),
            entry.peer_dependencies.as_ref(),
            entry.dev_dependencies.as_ref(),
        ];

        for maybe_deps in dep_maps.iter() {
            if let Some(deps) = maybe_deps {
                for (dep_name_key, dep_version_ref) in deps.iter() {
                    let dep_name: &[u8] = dep_name_key.as_ref();
                    let dep_version: &[u8] = *dep_version_ref;
                    let mut dep_spec = Vec::new();
                    write!(
                        &mut dep_spec,
                        "{}@{}",
                        bstr::BStr::new(dep_name),
                        bstr::BStr::new(dep_version)
                    )
                    .expect("unreachable");

                    // PORT NOTE: reshaped for borrowck — find_entry_by_spec via index search
                    // instead of returning &mut to avoid overlapping borrow with the loop below.
                    let dep_entry_specs: Option<Vec<&[u8]>> = {
                        let mut found: Option<Vec<&[u8]>> = None;
                        for e in yarn_lock.entries.iter() {
                            for entry_spec in e.specs.iter() {
                                if *entry_spec == dep_spec.as_slice() {
                                    found = Some(e.specs.clone());
                                    break;
                                }
                            }
                            if found.is_some() {
                                break;
                            }
                        }
                        found
                    };

                    if let Some(dep_entry_specs) = dep_entry_specs {
                        for (idx, e) in yarn_lock.entries.iter().enumerate() {
                            let mut found = false;
                            for spec in e.specs.iter() {
                                for dep_spec_item in dep_entry_specs.iter() {
                                    if *spec == *dep_spec_item {
                                        found = true;
                                        break;
                                    }
                                }
                                if found {
                                    break;
                                }
                            }

                            if found {
                                let dep_package_id = yarn_entry_to_package_id[idx];
                                package_dependents[dep_package_id as usize].push(parent_package_id);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    for dep in root_dependencies.iter() {
        let mut dep_spec = Vec::new();
        write!(
            &mut dep_spec,
            "{}@{}",
            bstr::BStr::new(&dep.name),
            bstr::BStr::new(&dep.version)
        )
        .expect("unreachable");

        for (idx, entry) in yarn_lock.entries.iter().enumerate() {
            for spec in entry.specs.iter() {
                if *spec == dep_spec.as_slice() {
                    let dep_package_id = yarn_entry_to_package_id[idx];
                    package_dependents[dep_package_id as usize].push(0); // 0 is root package
                    break;
                }
            }
        }
    }

    for (base_name, versions) in scoped_packages.iter_mut() {
        let base_name: &[u8] = base_name.as_ref();

        versions.sort_by(|a, b| a.package_id.cmp(&b.package_id));

        let original_name_hash = string_hash(base_name);
        // PORT NOTE: reshaped for borrowck — Zig matches on the entry only to
        // call `existing_ids.deinit()` before `remove`; Rust's `remove` drops
        // the value (and thus the `Ids` Vec) automatically, so the match is
        // unnecessary and we avoid the overlapping `get_mut`/`remove` borrow.
        let _ = this.package_index.remove(&original_name_hash);
    }

    for (base_name, versions) in scoped_packages.iter() {
        let base_name: &[u8] = base_name.as_ref();

        for version_info in versions.iter() {
            let package_id = version_info.package_id;

            let mut found_in_index = false;
            for (_, index_value) in this.package_index.iter() {
                match index_value {
                    lockfile::PackageIndexEntry::Id(id) => {
                        if *id == package_id {
                            found_in_index = true;
                            break;
                        }
                    }
                    lockfile::PackageIndexEntry::Ids(ids) => {
                        for id in ids.iter() {
                            if *id == package_id {
                                found_in_index = true;
                                break;
                            }
                        }
                        if found_in_index {
                            break;
                        }
                    }
                }
            }

            if !found_in_index {
                let mut fallback_name = Vec::new();
                write!(
                    &mut fallback_name,
                    "{}#{}",
                    bstr::BStr::new(base_name),
                    package_id
                )
                .expect("unreachable");

                let fallback_hash = string_hash(&fallback_name);
                this.get_or_put_id(package_id, fallback_hash)?;
            }
        }
    }

    let mut package_names: Vec<&[u8]> = vec![b"".as_slice(); next_package_id as usize];

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let package_id = yarn_entry_to_package_id[yarn_idx];
        if package_names[package_id as usize].is_empty() {
            package_names[package_id as usize] = Entry::get_name_from_spec(entry.specs[0]);
        }
    }

    let mut root_packages: StringHashMap<PackageID> = StringHashMap::new();

    let mut usage_count: StringHashMap<u32> = StringHashMap::new();
    for entry_idx in 0..yarn_lock.entries.len() {
        let package_id = yarn_entry_to_package_id[entry_idx];
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }
        let base_name = package_names[package_id as usize];

        for dep_entry in yarn_lock.entries.iter() {
            if let Some(deps) = &dep_entry.dependencies {
                for (dep_name_key, _) in deps.iter() {
                    if dep_name_key.as_ref() == base_name {
                        let count = usage_count.get(base_name).copied().unwrap_or(0);
                        usage_count.put(base_name, count + 1)?;
                    }
                }
            }
        }
    }

    for entry_idx in 0..yarn_lock.entries.len() {
        let package_id = yarn_entry_to_package_id[entry_idx];
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }
        let base_name = package_names[package_id as usize];

        if root_packages.get(base_name).is_none() {
            root_packages.put(base_name, package_id)?;
            let name_hash = string_hash(base_name);
            this.get_or_put_id(package_id, name_hash)?;
        }
    }

    let mut scoped_names: HashMap<PackageID, Vec<u8>> = HashMap::new();
    let mut scoped_count: u32 = 0;
    for entry_idx in 0..yarn_lock.entries.len() {
        let package_id = yarn_entry_to_package_id[entry_idx];
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }
        let base_name = package_names[package_id as usize];

        if let Some(root_pkg_id) = root_packages.get(base_name).copied() {
            if root_pkg_id == package_id {
                continue;
            }
        } else {
            continue;
        }

        let mut scoped_name: Option<Vec<u8>> = None;
        for (dep_entry_idx, dep_entry) in yarn_lock.entries.iter().enumerate() {
            let dep_package_id = yarn_entry_to_package_id[dep_entry_idx];
            if dep_package_id == install::INVALID_PACKAGE_ID {
                continue;
            }

            if let Some(deps) = &dep_entry.dependencies {
                for (dep_name_key, _) in deps.iter() {
                    if dep_name_key.as_ref() == base_name {
                        if dep_package_id != package_id {
                            let parent_name = package_names[dep_package_id as usize];

                            let mut potential_name = Vec::new();
                            write!(
                                &mut potential_name,
                                "{}/{}",
                                bstr::BStr::new(parent_name),
                                bstr::BStr::new(base_name)
                            )
                            .expect("unreachable");

                            let mut name_already_used = false;
                            for existing_name in scoped_names.values() {
                                if existing_name.as_slice() == potential_name.as_slice() {
                                    name_already_used = true;
                                    break;
                                }
                            }

                            if !name_already_used {
                                scoped_name = Some(potential_name);
                                break;
                            }
                            // else: potential_name dropped
                        }
                    }
                }
                if scoped_name.is_some() {
                    break;
                }
            }
        }

        if scoped_name.is_none() {
            let pkg_resolution = this.packages.get(package_id as usize).resolution;
            let version_str: Vec<u8> = match pkg_resolution.tag {
                ResolutionTag::Npm => 'brk: {
                    let mut version_buf = [0u8; 64];
                    let mut cursor = &mut version_buf[..];
                    let npm_version = pkg_resolution.npm().version;
                    let _ = write!(
                        &mut cursor,
                        "{}",
                        npm_version.fmt(this.buffers.string_bytes.as_slice())
                    );
                    let written = 64 - cursor.len();
                    break 'brk version_buf[..written].to_vec();
                }
                _ => b"unknown".to_vec(),
            };
            let mut name = Vec::new();
            write!(
                &mut name,
                "{}@{}",
                bstr::BStr::new(base_name),
                bstr::BStr::new(&version_str)
            )
            .expect("unreachable");
            scoped_name = Some(name);
        }

        if let Some(final_scoped_name) = scoped_name {
            let name_hash = string_hash(&final_scoped_name);
            this.get_or_put_id(package_id, name_hash)?;
            scoped_names.put(package_id, final_scoped_name)?;
            scoped_count += 1;
        }
    }
    let _ = scoped_count;

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let package_id = yarn_entry_to_package_id[yarn_idx];
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }

        if let Some(resolved) = entry.resolved {
            if let Some(real_name) = Entry::get_package_name_from_resolved_url(resolved) {
                for spec in entry.specs.iter() {
                    let alias_name = Entry::get_name_from_spec(spec);

                    if alias_name != real_name {
                        let alias_hash = string_hash(alias_name);
                        this.get_or_put_id(package_id, alias_hash)?;
                    }
                }
            }
        }
    }

    this.buffers.trees[0].dependencies = lockfile::DependencyIDSlice::new(0, 0);

    let mut spec_to_package_id: StringHashMap<PackageID> = StringHashMap::new();

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let package_id = yarn_entry_to_package_id[yarn_idx];
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }

        for spec in entry.specs.iter() {
            spec_to_package_id.put(*spec, package_id)?;
        }
    }

    let root_deps_off = u32::try_from(this.buffers.dependencies.len()).expect("int cast");
    let root_resolutions_off = u32::try_from(this.buffers.resolutions.len()).expect("int cast");

    if !root_dependencies.is_empty() {
        for root_dep in root_dependencies.iter() {
            let _ = DependencyID::try_from(this.buffers.dependencies.len()).expect("int cast");

            let name_hash = string_hash(&root_dep.name);
            let dep_name_string = sbuf!().append_with_hash(&root_dep.name, name_hash)?;
            let dep_version_string = sbuf!().append(&root_dep.version)?;
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

            let dep = Dependency {
                name_hash,
                name: dep_name_string,
                version: parsed_version,
                behavior: behavior_for(root_dep.dep_type, false),
            };

            this.buffers.dependencies.push(dep);

            let mut dep_spec = Vec::new();
            write!(
                &mut dep_spec,
                "{}@{}",
                bstr::BStr::new(&root_dep.name),
                bstr::BStr::new(&root_dep.version)
            )
            .expect("unreachable");

            if let Some(pkg_id) = spec_to_package_id.get(dep_spec.as_slice()).copied() {
                this.buffers.resolutions.push(pkg_id);
            } else {
                this.buffers.resolutions.push(install::INVALID_PACKAGE_ID);
            }
        }
    }

    this.packages.items_dependencies_mut()[0] = lockfile::DependencySlice::new(
        root_deps_off,
        u32::try_from(root_dependencies.len()).expect("int cast"),
    );
    this.packages.items_resolutions_mut()[0] = lockfile::DependencyIDSlice::new(
        root_resolutions_off,
        u32::try_from(root_dependencies.len()).expect("int cast"),
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
    // a tagged `bun_core::Error` until `From<SubtreeError>` lands.
    if let Err(_e) = this.resolve(log) {
        return Err(bun_core::err!("LockfileResolveFailed"));
    }

    this.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration::<true>(manager)?;

    if cfg!(debug_assertions) {
        // TODO(port): Environment.allow_assert maps to debug_assertions
        this.verify_data()?;
    }

    this.meta_hash = this.generate_meta_hash(false, this.packages.len())?;

    let result = LoadResult::Ok(lockfile::LoadResultOk {
        lockfile: this,
        // TODO(port): LoadResult.ok stores *Lockfile; lifetime/ownership to be resolved in Phase B
        migrated: lockfile::Migrated::Yarn,
        loaded_from_binary_lockfile: false,
        serializer_result: Default::default(),
        format: lockfile::LockfileFormat::Binary,
    });

    Ok(result)
}

#[inline]
fn string_hash(s: &[u8]) -> u64 {
    Semver::string::Builder::string_hash(s)
}

/// Port of Zig's packed-struct `Behavior { .prod = …, .dev = … }` literal.
/// Rust's bitflags-backed `Behavior` has no named fields, so build via
/// `with(FLAG, cond)` chaining instead.
#[inline]
fn behavior_for(dep_type: DependencyType, workspace: bool) -> dependency::Behavior {
    dependency::Behavior::default()
        .with(
            dependency::Behavior::PROD,
            dep_type == DependencyType::Production,
        )
        .with(
            dependency::Behavior::OPTIONAL,
            dep_type == DependencyType::Optional,
        )
        .with(
            dependency::Behavior::DEV,
            dep_type == DependencyType::Development,
        )
        .with(dependency::Behavior::PEER, dep_type == DependencyType::Peer)
        .with(dependency::Behavior::WORKSPACE, workspace)
}

// ported from: src/install/yarn.zig

use std::io::Write as _;

use bun_collections::{HashMap, StringHashMap};
use bun_core::Error;
use bun_install::bin::Bin;
use bun_install::dependency::{self, Dependency};
use bun_install::install::{self, DependencyID, PackageID, PackageManager};
use bun_install::integrity::Integrity;
use bun_install::lockfile::{self, LoadResult, Lockfile, Tree};
use bun_install::npm::{self, Npm};
use bun_install::resolution::Resolution;
use bun_logger as logger;
use bun_paths::PathBuffer;
use bun_semver::{self as Semver, SlicedString, String as SemverString};
use bun_str::strings;
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
        version.starts_with(b"file:")
            || version.starts_with(b"./")
            || version.starts_with(b"../")
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
            let mut buf = Vec::with_capacity(b"https://github.com/".len() + path_without_commit.len());
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

        Ok(ParsedGitUrl { url, commit, owner, repo, owned_url })
    }

    pub fn parse_npm_alias(version: &[u8]) -> ParsedNpmAlias<'_> {
        if version.len() <= 4 {
            return ParsedNpmAlias { package: b"", version: b"*" };
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
        ParsedNpmAlias { package: npm_part, version: b"*" }
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
            } else {
                return Some(&url[last_slash + 1..dash_idx]);
            }
        }

        None
    }
}

impl<'a> YarnLock<'a> {
    pub fn init() -> YarnLock<'a> {
        YarnLock { entries: Vec::new() }
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
            let line = bun_str::strings::trim_right(line_, b" \r\t");
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
                    } else if key == b"os" {
                        let mut os_list: Vec<&'a [u8]> = Vec::new();
                        let mut os_it = strings::split(&value[1..value.len() - 1], b",");
                        while let Some(os) = os_it.next() {
                            let trimmed_os = strings::trim(os, b" \"");
                            os_list.push(trimmed_os);
                        }
                        entry.os = Some(os_list);
                    } else if key == b"cpu" {
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

    fn find_entry_by_spec(&mut self, spec: &[u8]) -> Option<&mut Entry<'a>> {
        for entry in self.entries.iter_mut() {
            for entry_spec in entry.specs.iter() {
                if *entry_spec == spec {
                    // PORT NOTE: reshaped for borrowck — return after inner loop matched
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
    yarn_lock_: &mut YarnLock<'_>,
    string_buf_: &mut Semver::string::Buf,
    deps_buf: &mut [Dependency],
    res_buf: &mut [PackageID],
    log: &mut logger::Log,
    manager: &mut PackageManager,
    yarn_entry_to_package_id: &[PackageID],
) -> Result<usize, Error> {
    // TODO(port): narrow error set
    // PORT NOTE: returns count instead of slice to avoid borrowck conflict with caller's bufs
    let mut count: usize = 0;
    // PERF(port): was stack-fallback alloc (1024 bytes) — profile in Phase B

    let mut deps_it = deps.iterator();
    while let Some(dep) = deps_it.next() {
        let dep_name = *dep.key_ptr;
        let dep_version = *dep.value_ptr;
        let mut dep_spec = Vec::new();
        write!(&mut dep_spec, "{}@{}", bstr::BStr::new(dep_name), bstr::BStr::new(dep_version))
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
                    dep_name_hash,
                    parsed_version,
                    &SlicedString::init(parsed_version, parsed_version),
                    log,
                    manager,
                )
                .unwrap_or_default(),
                behavior: dependency::Behavior {
                    prod: dep_type == DependencyType::Production,
                    optional: dep_type == DependencyType::Optional,
                    dev: dep_type == DependencyType::Development,
                    peer: dep_type == DependencyType::Peer,
                    workspace: dep_entry_workspace,
                    ..Default::default()
                },
            };
            let mut found_package_id: Option<PackageID> = None;
            'outer: for (yarn_idx, entry_) in yarn_lock_.entries.iter().enumerate() {
                for entry_spec in entry_.specs.iter() {
                    if entry_spec.as_ref() == dep_spec.as_slice() {
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

struct Section {
    key: &'static [u8],
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

pub fn migrate_yarn_lockfile(
    this: &mut Lockfile,
    manager: &mut PackageManager,
    log: &mut logger::Log,
    data: &[u8],
    dir: Fd,
) -> Result<LoadResult, Error> {
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
    // TODO(port): analytics counter API

    let mut string_buf = this.string_buf();

    let mut num_deps: u32 = 0;
    let mut root_dep_count: u32;
    let mut root_dep_count_from_package_json: u32 = 0;

    let mut root_dependencies: Vec<RootDep> = Vec::new();

    {
        // read package.json to get specified dependencies
        let Ok(package_json_fd) =
            bun_sys::File::openat(dir, b"package.json", bun_sys::O::RDONLY, 0).unwrap_result()
        else {
            return Err(bun_core::err!("InvalidPackageJSON"));
        };
        let package_json_contents = match package_json_fd.read_to_end() {
            Ok(c) => c,
            Err(_) => {
                package_json_fd.close();
                return Err(bun_core::err!("InvalidPackageJSON"));
            }
        };
        // package_json_fd closed on drop / explicit close below
        // TODO(port): explicit close ordering — Zig closes fd via defer after readToEnd

        let package_json_source = 'brk: {
            let mut package_json_path_buf = PathBuffer::uninit();
            let Ok(package_json_path) =
                bun_sys::get_fd_path(package_json_fd.handle(), &mut package_json_path_buf)
            else {
                return Err(bun_core::err!("InvalidPackageJSON"));
            };
            break 'brk logger::Source::init_path_string(package_json_path, &package_json_contents);
        };
        package_json_fd.close();

        let Ok(package_json_expr) = bun_json::parse_package_json_utf8_with_opts(
            &package_json_source,
            log,
            bun_json::ParseOptions {
                is_json: true,
                allow_comments: true,
                allow_trailing_commas: true,
                guess_indentation: true,
                ..Default::default()
            },
        ) else {
            return Err(bun_core::err!("InvalidPackageJSON"));
        };

        let package_json = package_json_expr.root;

        let package_name: Option<Vec<u8>> = 'blk: {
            if let Some(name_prop) = package_json.as_property(b"name") {
                if let bun_js_parser::ExprData::EString(e_string) = &name_prop.expr.data {
                    let name_slice = e_string.string().unwrap_or(b"");
                    if !name_slice.is_empty() {
                        break 'blk Some(name_slice.to_vec());
                    }
                }
            }
            break 'blk None;
        };
        let package_name_hash = if let Some(name) = &package_name {
            SemverString::Builder::string_hash(name)
        } else {
            0
        };

        let sections: [Section; 4] = [
            Section { key: b"dependencies", dep_type: DependencyType::Production },
            Section { key: b"devDependencies", dep_type: DependencyType::Development },
            Section { key: b"optionalDependencies", dep_type: DependencyType::Optional },
            Section { key: b"peerDependencies", dep_type: DependencyType::Peer },
        ];
        for section_info in sections.iter() {
            let Some(prop) = package_json.as_property(section_info.key) else {
                continue;
            };
            let bun_js_parser::ExprData::EObject(e_object) = &prop.expr.data else {
                continue;
            };

            for p in e_object.properties.slice() {
                let Some(key) = &p.key else { continue };
                let bun_js_parser::ExprData::EString(key_str) = &key.data else {
                    continue;
                };

                let Ok(name_slice) = key_str.string() else { continue };
                let Some(value) = &p.value else { continue };
                let bun_js_parser::ExprData::EString(value_str) = &value.data else {
                    continue;
                };

                let Ok(version_slice) = value_str.string() else { continue };
                if version_slice.is_empty() {
                    continue;
                }

                let name = name_slice.to_vec();
                let version = version_slice.to_vec();
                root_dependencies.push(RootDep {
                    name,
                    version,
                    dep_type: section_info.dep_type,
                });
                root_dep_count_from_package_json += 1;
            }
        }

        root_dep_count = root_dep_count_from_package_json.max(10);
        num_deps += root_dep_count;

        for entry in yarn_lock.entries.iter() {
            if let Some(deps) = &entry.dependencies {
                num_deps += u32::try_from(deps.count()).unwrap();
            }
            if let Some(deps) = &entry.optional_dependencies {
                num_deps += u32::try_from(deps.count()).unwrap();
            }
            if let Some(deps) = &entry.peer_dependencies {
                num_deps += u32::try_from(deps.count()).unwrap();
            }
            if let Some(deps) = &entry.dev_dependencies {
                num_deps += u32::try_from(deps.count()).unwrap();
            }
        }

        let num_packages = u32::try_from(yarn_lock.entries.len() + 1).unwrap();

        this.buffers.dependencies.reserve((num_deps as usize).saturating_sub(this.buffers.dependencies.len()));
        this.buffers.resolutions.reserve((num_deps as usize).saturating_sub(this.buffers.resolutions.len()));
        this.packages.ensure_total_capacity(num_packages as usize)?;
        this.package_index.ensure_total_capacity(num_packages as usize)?;

        let root_name = if let Some(name) = &package_name {
            string_buf.append_with_hash(name, package_name_hash)?
        } else {
            string_buf.append(b"")?
        };

        this.packages.append(lockfile::Package {
            name: root_name,
            name_hash: package_name_hash,
            resolution: Resolution::init(Resolution::Value::Root(())),
            dependencies: Default::default(),
            resolutions: Default::default(),
            meta: lockfile::Meta {
                id: 0,
                origin: lockfile::Origin::Local,
                arch: npm::Architecture::All,
                os: npm::OperatingSystem::All,
                man_dir: SemverString::default(),
                has_install_script: lockfile::HasInstallScript::False,
                integrity: Integrity::default(),
                ..Default::default()
            },
            bin: Bin::init(),
            scripts: Default::default(),
        })?;

        if let Some(resolutions) = package_json.as_property(b"resolutions") {
            let mut root_package = this.packages.get(0);
            let mut string_builder = this.string_builder();

            if let bun_js_parser::ExprData::EObject(e_object) = &resolutions.expr.data {
                string_builder.cap += e_object.properties.len() * 128;
            }
            if string_builder.cap > 0 {
                string_builder.allocate()?;
            }
            this.overrides.parse_append(
                manager,
                this,
                &mut root_package,
                log,
                &package_json_source,
                &package_json,
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
        core::slice::from_raw_parts_mut(dependencies_base_ptr, num_deps as usize)
    };
    let mut resolutions_buf: &mut [PackageID] = unsafe {
        // SAFETY: capacity >= num_deps reserved above
        core::slice::from_raw_parts_mut(resolutions_base_ptr, num_deps as usize)
    };

    let mut yarn_entry_to_package_id: Vec<PackageID> =
        vec![0; yarn_lock.entries.len()];

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
                                if let Some(domain_slash) = strings::index_of(after_registry, b"/") {
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

        this.packages.append(lockfile::Package {
            name: string_buf.append_with_hash(name_to_use, name_hash)?,
            name_hash,
            resolution: 'blk: {
                if entry.workspace {
                    break 'blk Resolution::init(Resolution::Value::Workspace(
                        string_buf.append(base_name)?,
                    ));
                } else if let Some(file) = entry.file {
                    if file.ends_with(b".tgz") || file.ends_with(b".tar.gz") {
                        break 'blk Resolution::init(Resolution::Value::LocalTarball(
                            string_buf.append(file)?,
                        ));
                    } else {
                        break 'blk Resolution::init(Resolution::Value::Folder(
                            string_buf.append(file)?,
                        ));
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
                            break 'blk Resolution::init(Resolution::Value::Github(
                                Resolution::Repository {
                                    owner: string_buf.append(owner_str)?,
                                    repo: string_buf.append(repo_str)?,
                                    committish: string_buf
                                        .append(&commit[0..b"github:".len().min(commit.len())])?,
                                    resolved: SemverString::default(),
                                    package_name: string_buf.append(actual_name)?,
                                },
                            ));
                        } else {
                            break 'blk Resolution::init(Resolution::Value::Git(
                                Resolution::Repository {
                                    owner: string_buf.append(owner_str)?,
                                    repo: string_buf.append(repo_str)?,
                                    committish: string_buf.append(commit)?,
                                    resolved: SemverString::default(),
                                    package_name: string_buf.append(actual_name)?,
                                },
                            ));
                        }
                    }
                    break 'blk Resolution::default();
                } else if let Some(resolved) = entry.resolved {
                    if is_direct_url_dep {
                        break 'blk Resolution::init(Resolution::Value::RemoteTarball(
                            string_buf.append(resolved)?,
                        ));
                    }

                    if Entry::is_remote_tarball(resolved) {
                        break 'blk Resolution::init(Resolution::Value::RemoteTarball(
                            string_buf.append(resolved)?,
                        ));
                    } else if resolved.ends_with(b".tgz") {
                        break 'blk Resolution::init(Resolution::Value::RemoteTarball(
                            string_buf.append(resolved)?,
                        ));
                    }

                    let version = string_buf.append(entry.version)?;
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
                        string_buf.append(resolved)?
                    };

                    break 'blk Resolution::init(Resolution::Value::Npm(Resolution::Npm {
                        url,
                        version: result.version.min(),
                    }));
                } else {
                    break 'blk Resolution::default();
                }
            },
            dependencies: Default::default(),
            resolutions: Default::default(),
            meta: lockfile::Meta {
                id: package_id,
                origin: lockfile::Origin::Npm,
                arch: if let Some(cpu_list) = &entry.cpu {
                    let mut arch = npm::Architecture::None.negatable();
                    for cpu in cpu_list.iter() {
                        arch.apply(cpu);
                    }
                    arch.combine()
                } else {
                    npm::Architecture::All
                },
                os: if let Some(os_list) = &entry.os {
                    let mut os = npm::OperatingSystem::None.negatable();
                    for os_str in os_list.iter() {
                        os.apply(os_str);
                    }
                    os.combine()
                } else {
                    npm::OperatingSystem::All
                },
                man_dir: SemverString::default(),
                has_install_script: lockfile::HasInstallScript::False,
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

    let mut dependencies_list = this.packages.items_dependencies_mut();
    let mut resolution_list = this.packages.items_resolutions_mut();
    // TODO(port): MultiArrayList column accessor names

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
                let dep_name_string = string_buf.append_with_hash(&dep.name, name_hash)?;
                let version_string = string_buf.append(&dep.version)?;

                dependencies_buf[actual_root_dep_count as usize] = Dependency {
                    name: dep_name_string,
                    name_hash,
                    version: Dependency::parse(
                        dep_name_string,
                        name_hash,
                        version_string.slice(this.buffers.string_bytes.as_slice()),
                        &version_string.sliced(this.buffers.string_bytes.as_slice()),
                        log,
                        manager,
                    )
                    .unwrap_or_default(),
                    behavior: dependency::Behavior {
                        prod: dep.dep_type == DependencyType::Production,
                        dev: dep.dep_type == DependencyType::Development,
                        optional: dep.dep_type == DependencyType::Optional,
                        peer: dep.dep_type == DependencyType::Peer,
                        workspace: false,
                        ..Default::default()
                    },
                };

                resolutions_buf[actual_root_dep_count as usize] = yarn_entry_to_package_id[idx];
                actual_root_dep_count += 1;
            }
        }
    }

    dependencies_list[0] = lockfile::DependencySlice { off: 0, len: actual_root_dep_count };
    resolution_list[0] = lockfile::DependencyIDSlice { off: 0, len: actual_root_dep_count };

    dependencies_buf = &mut dependencies_buf[actual_root_dep_count as usize..];
    resolutions_buf = &mut resolutions_buf[actual_root_dep_count as usize..];

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let package_id = yarn_entry_to_package_id[yarn_idx];
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }

        let dependencies_start = dependencies_buf.as_mut_ptr();
        let resolutions_start = resolutions_buf.as_mut_ptr();
        if let Some(deps) = &entry.dependencies {
            let processed = process_deps(
                deps,
                DependencyType::Production,
                &mut yarn_lock,
                &mut string_buf,
                dependencies_buf,
                resolutions_buf,
                log,
                manager,
                &yarn_entry_to_package_id,
            )?;
            // TODO(port): borrowck — iterating yarn_lock.entries while passing &mut yarn_lock
            // to process_deps. Phase B: make find_entry_by_spec take &self or restructure.
            dependencies_buf = &mut dependencies_buf[processed..];
            resolutions_buf = &mut resolutions_buf[processed..];
        }

        if let Some(deps) = &entry.optional_dependencies {
            let processed = process_deps(
                deps,
                DependencyType::Optional,
                &mut yarn_lock,
                &mut string_buf,
                dependencies_buf,
                resolutions_buf,
                log,
                manager,
                &yarn_entry_to_package_id,
            )?;
            dependencies_buf = &mut dependencies_buf[processed..];
            resolutions_buf = &mut resolutions_buf[processed..];
        }

        if let Some(deps) = &entry.peer_dependencies {
            let processed = process_deps(
                deps,
                DependencyType::Peer,
                &mut yarn_lock,
                &mut string_buf,
                dependencies_buf,
                resolutions_buf,
                log,
                manager,
                &yarn_entry_to_package_id,
            )?;
            dependencies_buf = &mut dependencies_buf[processed..];
            resolutions_buf = &mut resolutions_buf[processed..];
        }

        if let Some(deps) = &entry.dev_dependencies {
            let processed = process_deps(
                deps,
                DependencyType::Development,
                &mut yarn_lock,
                &mut string_buf,
                dependencies_buf,
                resolutions_buf,
                log,
                manager,
                &yarn_entry_to_package_id,
            )?;
            dependencies_buf = &mut dependencies_buf[processed..];
            resolutions_buf = &mut resolutions_buf[processed..];
        }

        // SAFETY: dependencies_start/dependencies_buf.as_ptr() are within the same allocation
        let deps_len = unsafe {
            (dependencies_buf.as_mut_ptr() as usize) - (dependencies_start as usize)
        };
        let deps_off = unsafe { (dependencies_start as usize) - (dependencies_base_ptr as usize) };
        dependencies_list[package_id as usize] = lockfile::DependencySlice {
            off: u32::try_from(deps_off / core::mem::size_of::<Dependency>()).unwrap(),
            len: u32::try_from(deps_len / core::mem::size_of::<Dependency>()).unwrap(),
        };
        let res_off =
            unsafe { (resolutions_start as usize) - (resolutions_base_ptr as usize) };
        let res_len = unsafe {
            (resolutions_buf.as_mut_ptr() as usize) - (resolutions_start as usize)
        };
        resolution_list[package_id as usize] = lockfile::DependencyIDSlice {
            off: u32::try_from(res_off / core::mem::size_of::<PackageID>()).unwrap(),
            len: u32::try_from(res_len / core::mem::size_of::<PackageID>()).unwrap(),
        };
    }

    let final_deps_len = unsafe {
        // SAFETY: same allocation
        ((dependencies_buf.as_mut_ptr() as usize) - (dependencies_base_ptr as usize))
            / core::mem::size_of::<Dependency>()
    };
    unsafe {
        // SAFETY: all elements in 0..final_deps_len initialized above; capacity >= num_deps
        this.buffers.dependencies.set_len(final_deps_len);
        this.buffers.resolutions.set_len(final_deps_len);
    }

    this.buffers
        .hoisted_dependencies
        .reserve((this.buffers.dependencies.len() * 2).saturating_sub(this.buffers.hoisted_dependencies.len()));

    this.buffers.trees.push(Tree {
        id: 0,
        parent: Tree::INVALID_ID,
        dependency_id: Tree::ROOT_DEP_ID,
        dependencies: lockfile::DependencyIDSlice { off: 0, len: 0 },
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
                let mut deps_it = deps.iterator();
                while let Some(dep) = deps_it.next() {
                    let dep_name = *dep.key_ptr;
                    let dep_version = *dep.value_ptr;
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
                                package_dependents[dep_package_id as usize]
                                    .push(parent_package_id);
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

    let mut packages_slice = this.packages.slice();

    let mut scoped_it = scoped_packages.iterator();
    while let Some(entry) = scoped_it.next() {
        let base_name = entry.key_ptr;
        let versions = entry.value_ptr;

        versions.sort_by(|a, b| a.package_id.cmp(&b.package_id));

        let original_name_hash = string_hash(base_name);
        if let Some(original_entry) = this.package_index.get_ptr(original_name_hash) {
            match original_entry {
                lockfile::PackageIndexEntry::Id(_) => {
                    let _ = this.package_index.remove(original_name_hash);
                }
                lockfile::PackageIndexEntry::Ids(existing_ids) => {
                    drop(core::mem::take(existing_ids));
                    let _ = this.package_index.remove(original_name_hash);
                }
            }
        } else {
        }
    }

    let mut final_check_it = scoped_packages.iterator();
    while let Some(entry) = final_check_it.next() {
        let base_name = entry.key_ptr;
        let versions = entry.value_ptr;

        for version_info in versions.iter() {
            let package_id = version_info.package_id;

            let mut found_in_index = false;
            let mut check_it = this.package_index.iterator();
            while let Some(index_entry) = check_it.next() {
                match index_entry.value_ptr {
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
                let mut deps_iter = deps.iterator();
                while let Some(dep) = deps_iter.next() {
                    if *dep.key_ptr == base_name {
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
                let mut deps_iter = deps.iterator();
                while let Some(dep) = deps_iter.next() {
                    if *dep.key_ptr == base_name {
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
                            let mut value_iter = scoped_names.value_iterator();
                            while let Some(existing_name) = value_iter.next() {
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
            let version_str: Vec<u8> = match this.packages.get(package_id as usize).resolution.tag {
                Resolution::Tag::Npm => 'brk: {
                    let mut version_buf = [0u8; 64];
                    let mut cursor = &mut version_buf[..];
                    let _ = write!(
                        &mut cursor,
                        "{}",
                        this.packages
                            .get(package_id as usize)
                            .resolution
                            .value
                            .npm
                            .version
                            .fmt(this.buffers.string_bytes.as_slice())
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

    this.buffers.trees[0].dependencies = lockfile::DependencyIDSlice { off: 0, len: 0 };

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

    let root_deps_off = u32::try_from(this.buffers.dependencies.len()).unwrap();
    let root_resolutions_off = u32::try_from(this.buffers.resolutions.len()).unwrap();

    if !root_dependencies.is_empty() {
        for root_dep in root_dependencies.iter() {
            let _ = DependencyID::try_from(this.buffers.dependencies.len()).unwrap();

            let name_hash = string_hash(&root_dep.name);
            let dep_name_string = string_buf.append_with_hash(&root_dep.name, name_hash)?;
            let dep_version_string = string_buf.append(&root_dep.version)?;
            let sliced_string = SlicedString::init(
                dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                dep_version_string.slice(this.buffers.string_bytes.as_slice()),
            );

            let mut parsed_version = Dependency::parse(
                dep_name_string,
                name_hash,
                dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                &sliced_string,
                log,
                manager,
            )
            .unwrap_or_default();

            parsed_version.literal = dep_version_string;

            let dep = Dependency {
                name_hash,
                name: dep_name_string,
                version: parsed_version,
                behavior: dependency::Behavior {
                    prod: root_dep.dep_type == DependencyType::Production,
                    dev: root_dep.dep_type == DependencyType::Development,
                    optional: root_dep.dep_type == DependencyType::Optional,
                    peer: root_dep.dep_type == DependencyType::Peer,
                    workspace: false,
                    ..Default::default()
                },
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

    packages_slice.items_dependencies_mut()[0] = lockfile::DependencySlice {
        off: root_deps_off,
        len: u32::try_from(root_dependencies.len()).unwrap(),
    };
    packages_slice.items_resolutions_mut()[0] = lockfile::DependencyIDSlice {
        off: root_resolutions_off,
        len: u32::try_from(root_dependencies.len()).unwrap(),
    };

    for (yarn_idx, entry) in yarn_lock.entries.iter().enumerate() {
        let package_id = yarn_entry_to_package_id[yarn_idx];
        if package_id == install::INVALID_PACKAGE_ID {
            continue;
        }

        let mut dep_count: u32 = 0;
        let deps_off = u32::try_from(this.buffers.dependencies.len()).unwrap();
        let resolutions_off = u32::try_from(this.buffers.resolutions.len()).unwrap();

        if let Some(deps) = &entry.dependencies {
            let mut dep_iter = deps.iterator();
            while let Some(dep_entry) = dep_iter.next() {
                let dep_name = *dep_entry.key_ptr;
                let dep_version_literal = *dep_entry.value_ptr;

                let name_hash = string_hash(dep_name);
                let dep_name_string = string_buf.append_with_hash(dep_name, name_hash)?;
                let dep_version_string = string_buf.append(dep_version_literal)?;
                let sliced_string = SlicedString::init(
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                );

                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    name_hash,
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    &sliced_string,
                    log,
                    manager,
                )
                .unwrap_or_default();

                parsed_version.literal = dep_version_string;

                this.buffers.dependencies.push(Dependency {
                    name: dep_name_string,
                    name_hash,
                    version: parsed_version,
                    behavior: dependency::Behavior { prod: true, ..Default::default() },
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
            let mut opt_dep_iter = optional_deps.iterator();
            while let Some(dep_entry) = opt_dep_iter.next() {
                let dep_name = *dep_entry.key_ptr;
                let dep_version_literal = *dep_entry.value_ptr;

                let name_hash = string_hash(dep_name);
                let dep_name_string = string_buf.append_with_hash(dep_name, name_hash)?;

                let dep_version_string = string_buf.append(dep_version_literal)?;
                let sliced_string = SlicedString::init(
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                );

                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    name_hash,
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    &sliced_string,
                    log,
                    manager,
                )
                .unwrap_or_default();

                parsed_version.literal = dep_version_string;

                this.buffers.dependencies.push(Dependency {
                    name: dep_name_string,
                    name_hash,
                    version: parsed_version,
                    behavior: dependency::Behavior { optional: true, ..Default::default() },
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
            let mut peer_dep_iter = peer_deps.iterator();
            while let Some(dep_entry) = peer_dep_iter.next() {
                let dep_name = *dep_entry.key_ptr;
                let dep_version_literal = *dep_entry.value_ptr;

                let name_hash = string_hash(dep_name);
                let dep_name_string = string_buf.append_with_hash(dep_name, name_hash)?;

                let dep_version_string = string_buf.append(dep_version_literal)?;
                let sliced_string = SlicedString::init(
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                );

                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    name_hash,
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    &sliced_string,
                    log,
                    manager,
                )
                .unwrap_or_default();

                parsed_version.literal = dep_version_string;

                this.buffers.dependencies.push(Dependency {
                    name: dep_name_string,
                    name_hash,
                    version: parsed_version,
                    behavior: dependency::Behavior { peer: true, ..Default::default() },
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
            let mut dev_dep_iter = dev_deps.iterator();
            while let Some(dep_entry) = dev_dep_iter.next() {
                let dep_name = *dep_entry.key_ptr;
                let dep_version_literal = *dep_entry.value_ptr;

                let name_hash = string_hash(dep_name);
                let dep_name_string = string_buf.append_with_hash(dep_name, name_hash)?;

                let dep_version_string = string_buf.append(dep_version_literal)?;
                let sliced_string = SlicedString::init(
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                );

                let mut parsed_version = Dependency::parse(
                    dep_name_string,
                    name_hash,
                    dep_version_string.slice(this.buffers.string_bytes.as_slice()),
                    &sliced_string,
                    log,
                    manager,
                )
                .unwrap_or_default();

                parsed_version.literal = dep_version_string;

                this.buffers.dependencies.push(Dependency {
                    name: dep_name_string,
                    name_hash,
                    version: parsed_version,
                    behavior: dependency::Behavior { dev: true, ..Default::default() },
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

        packages_slice.items_dependencies_mut()[package_id as usize] = lockfile::DependencySlice {
            off: deps_off,
            len: dep_count,
        };

        packages_slice.items_resolutions_mut()[package_id as usize] = lockfile::DependencyIDSlice {
            off: resolutions_off,
            len: dep_count,
        };
    }

    this.resolve(log)?;

    this.fetch_necessary_package_metadata_after_yarn_or_pnpm_migration(manager, true)?;

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
        format: lockfile::Format::Binary,
    });

    Ok(result)
}

#[inline]
fn string_hash(s: &[u8]) -> u64 {
    SemverString::Builder::string_hash(s)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/yarn.zig (1719 lines)
//   confidence: medium
//   todos:      13
//   notes:      Entry/YarnLock given <'a> borrowing input data (no LIFETIMES.tsv rows); ParsedGitUrl.owned_url ownership and process_deps borrowck conflict need Phase B rework; Lockfile/MultiArrayList/JSON AST accessor names guessed.
// ──────────────────────────────────────────────────────────────────────────

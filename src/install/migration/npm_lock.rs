use std::fmt::Write as _;

use bun_ast::E;
use bun_collections::{DynamicBitSet, StringArrayHashMap, StringHashMap};
use bun_core::strings;
use bun_install_types::DependencyGroup;
use bun_paths::resolve_path;
use bun_semver::{self as Semver, String as SemverString};
use bun_sys::{Fd, File, O};

use super::{package_name_from_path, pkg_flag_is_true, string_hash};
use crate::Error;
use crate::bin::{self, Bin};
use crate::bun_json;
use crate::dependency::{
    self, Behavior, Dependency, DependencyExt as _, Tag as DepTag, TagExt as _, Value as DepValue,
    Version as DepVersion,
};
use crate::external_slice::ExternalSlice;
use crate::hosted_git_info::{HostProvider, HostedGitInfo};
use crate::integrity::Integrity;
use crate::lockfile::{self, Lockfile, PackageListEntry};
use crate::lockfile_real::package::PackageColumns as _;
use crate::lockfile_real::package::workspace_map::WorkspaceMap;
use crate::npm as Npm;
use crate::repository::{Repository, RepositoryExt as _, is_safe_resolved_tag};
use crate::resolution::{self, Resolution, TaggedValue as ResTagged};
use crate::versioned_url::VersionedURLType;
use crate::{ExternalStringList, INVALID_PACKAGE_ID, PackageID, PackageManager};

macro_rules! debug {
    ($($args:tt)*) => { bun_output::scoped_log!(super::migrate, $($args)*) };
}

const DEPENDENCY_GROUPS: [DependencyGroup; 4] = [
    DependencyGroup::DEPENDENCIES,
    DependencyGroup::DEV,
    DependencyGroup::OPTIONAL,
    DependencyGroup::PEER,
];

enum Bundle {
    None,
    All,
    Names(StringArrayHashMap<()>),
}

impl Bundle {
    fn contains(&self, name: &[u8]) -> bool {
        match self {
            Bundle::None => false,
            Bundle::All => true,
            Bundle::Names(names) => names.contains_key(name),
        }
    }
}

fn parse_bundle(pkg: &E::ObjectJSON) -> Result<Bundle, Error> {
    let Some(expr) = pkg
        .get(b"bundleDependencies")
        .or_else(|| pkg.get(b"bundledDependencies"))
    else {
        return Ok(Bundle::None);
    };
    match expr {
        E::JsonValue::Boolean(true) => Ok(Bundle::All),
        E::JsonValue::Boolean(false) => Ok(Bundle::None),
        _ => {
            let Some(arr) = expr.as_array() else {
                return Err(Error::InvalidNPMLockfile);
            };
            let items = arr.items();
            let mut names = StringArrayHashMap::<()>::with_capacity(items.len());
            for item in items {
                let name = item.as_str().ok_or(Error::InvalidNPMLockfile)?;
                names.put_assume_capacity(name, ());
            }
            Ok(Bundle::Names(names))
        }
    }
}

fn entry_object(entry: &E::PropertyJSON) -> &E::ObjectJSON {
    let Some(pkg) = entry.value.as_object() else {
        unreachable!("npm lockfile: build_index rejected non-object entries")
    };
    pkg
}

fn parent_dir(dir: &[u8]) -> &[u8] {
    if let Some(i) = strings::last_index_of(dir, b"node_modules/") {
        let enclosing = &dir[..i];
        return enclosing.strip_suffix(b"/").unwrap_or(enclosing);
    }
    match strings::last_index_of_char(dir, b'/') {
        Some(i) => &dir[..i],
        None => b"",
    }
}

/// The part of package-lock key `path` below key `dir`, if it is strictly inside it.
fn path_inside<'k>(dir: &[u8], path: &'k [u8]) -> Option<&'k [u8]> {
    path.strip_prefix(dir)?
        .strip_prefix(b"/")
        .filter(|rest| !rest.is_empty())
}

/// Folder inside a cache-installed dependent; the installer reads its row relative to the package.
#[derive(Clone, Copy)]
struct FolderInDependent<'k> {
    path: &'k [u8],
    /// Fallback name, as in a fresh resolve; npm writes these entries without one.
    alias: &'k [u8],
}

struct Migrator<'a> {
    this: &'a mut Lockfile,
    manager: &'a mut PackageManager,
    entries: &'a [E::PropertyJSON],
    workspace_map: Option<&'a WorkspaceMap>,
    index: StringHashMap<u32>,
    link_entries: DynamicBitSet,
    shadowed: DynamicBitSet,
    skipped_external: DynamicBitSet,
    entry_package_ids: Vec<PackageID>,
    queue: Vec<(u32, PackageID)>,
    probe: Vec<u8>,
    url: Vec<u8>,
    patched: String,
    silent: bool,
}

pub(super) fn migrate_packages(
    this: &mut Lockfile,
    manager: &mut PackageManager,
    _log: &mut bun_ast::Log,
    packages_properties: &[E::PropertyJSON],
    workspace_map: Option<&WorkspaceMap>,
) -> Result<(), Error> {
    debug_assert!(!packages_properties.is_empty() && packages_properties[0].key.slice().is_empty());

    let entry_count = packages_properties.len();
    this.packages.ensure_total_capacity(entry_count)?;
    this.package_index.reserve(entry_count);

    let mut index = StringHashMap::<u32>::default();
    index.reserve(entry_count);

    let silent = manager.options.log_level.is_silent();
    let mut migrator = Migrator {
        this,
        manager,
        entries: packages_properties,
        workspace_map,
        index,
        link_entries: DynamicBitSet::init_empty(entry_count)?,
        shadowed: DynamicBitSet::init_empty(entry_count)?,
        skipped_external: DynamicBitSet::init_empty(entry_count)?,
        entry_package_ids: vec![INVALID_PACKAGE_ID; entry_count],
        queue: Vec::new(),
        probe: Vec::new(),
        url: Vec::new(),
        patched: String::new(),
        silent,
    };

    migrator.build_index()?;

    let root_id = migrator.build_package(0, false, DepTag::Npm, None)?;
    debug_assert_eq!(root_id, 0);

    let mut cursor = 0;
    while cursor < migrator.queue.len() {
        let (j, id) = migrator.queue[cursor];
        cursor += 1;
        if id == INVALID_PACKAGE_ID {
            migrator.shadow_dependencies(j);
        } else {
            migrator.link_package(j, id)?;
        }
    }

    migrator.warn_unreachable();

    if !migrator.patched.is_empty() {
        bun_core::warn!(
            "skipped npm patches for {} from package-lock.json",
            migrator.patched,
        );
        bun_core::note!("bun patch \\<pkg\\>");
    }

    #[cfg(debug_assertions)]
    {
        let this = &*migrator.this;
        debug_assert_eq!(
            this.buffers.dependencies.len(),
            this.buffers.resolutions.len()
        );
        let resolutions = this.packages.items_resolution();
        let name_hashes = this.packages.items_name_hash();
        for (res, &name_hash) in resolutions.iter().zip(name_hashes) {
            debug_assert!(res.tag != resolution::Tag::Uninitialized);
            debug_assert!(this.get_package_id(name_hash, None, res).is_some());
        }
    }

    Ok(())
}

impl<'a> Migrator<'a> {
    fn build_index(&mut self) -> Result<(), Error> {
        let entries = self.entries;
        for (j, entry) in entries.iter().enumerate() {
            let Some(pkg) = entry.value.as_object() else {
                return Err(Error::InvalidNPMLockfile);
            };
            let key = entry.key.slice();

            if pkg.get(b"link").is_some() {
                self.link_entries.set(j);
                self.index.put(key, j as u32)?;
                continue;
            }
            if pkg_flag_is_true(pkg, b"extraneous") {
                continue;
            }
            self.index.put(key, j as u32)?;
        }

        if self.link_entries.is_set(0) || self.index.get(&b""[..]).copied() != Some(0) {
            return Err(Error::InvalidNPMLockfile);
        }
        Ok(())
    }

    fn build_or_get(&mut self, j: u32, via_link: bool, hint: DepTag) -> Result<PackageID, Error> {
        let existing = self.entry_package_ids[j as usize];
        if existing != INVALID_PACKAGE_ID {
            return Ok(existing);
        }
        self.build_package(j, via_link, hint, None)
    }

    fn build_package(
        &mut self,
        j: u32,
        via_link: bool,
        hint: DepTag,
        folder_in_dependent: Option<FolderInDependent<'_>>,
    ) -> Result<PackageID, Error> {
        let entries = self.entries;
        let entry = &entries[j as usize];
        let pkg = entry_object(entry);
        let key = entry.key.slice();
        let workspace_entry = if j == 0 {
            None
        } else {
            self.workspace_map.and_then(|m| m.get(key))
        };

        let name: &[u8] = if let Some(ws) = workspace_entry {
            &ws.name
        } else if let Some(set_name) = pkg.get(b"name").and_then(|n| n.as_str()) {
            set_name
        } else if let Some(folder) = folder_in_dependent {
            folder.alias
        } else {
            package_name_from_path(key)
        };
        let name_hash = string_hash(name);
        let name_string = self.this.string_buf().append_with_hash(name, name_hash)?;

        if !self.silent
            && matches!(pkg.get(b"patched"), Some(p) if !matches!(p, E::JsonValue::Boolean(false)))
        {
            if !self.patched.is_empty() {
                self.patched.push_str(", ");
            }
            let _ = write!(self.patched, "\"{}\"", bstr::BStr::new(name));
        }

        let mut meta = lockfile::Meta {
            id: INVALID_PACKAGE_ID,

            origin: if j == 0 {
                lockfile::Origin::Local
            } else {
                lockfile::Origin::Npm
            },

            arch: if let Some(cpu_array) = pkg.get(b"cpu") {
                'arch: {
                    let mut arch = Npm::Architecture::NONE.negatable();
                    let Some(arr) = cpu_array.as_array() else {
                        return Err(Error::InvalidNPMLockfile);
                    };
                    let items = arr.items();
                    if items.is_empty() {
                        break 'arch arch.combine();
                    }
                    for item in items {
                        let Some(s) = item.as_str() else {
                            return Err(Error::InvalidNPMLockfile);
                        };
                        arch.apply(s);
                    }
                    break 'arch arch.combine();
                }
            } else {
                Npm::Architecture::ALL
            },

            os: if let Some(os_array) = pkg.get(b"os") {
                'os: {
                    let mut os = Npm::OperatingSystem::NONE.negatable();
                    let Some(arr) = os_array.as_array() else {
                        return Err(Error::InvalidNPMLockfile);
                    };
                    let items = arr.items();
                    if items.is_empty() {
                        break 'os Npm::OperatingSystem::ALL;
                    }
                    for item in items {
                        let Some(s) = item.as_str() else {
                            return Err(Error::InvalidNPMLockfile);
                        };
                        os.apply(s);
                    }
                    break 'os os.combine();
                }
            } else {
                Npm::OperatingSystem::ALL
            },

            man_dir: SemverString::default(),

            has_install_script: if let Some(h) = pkg.get(b"hasInstallScript") {
                let E::JsonValue::Boolean(b) = h else {
                    return Err(Error::InvalidNPMLockfile);
                };
                if *b {
                    lockfile::HasInstallScript::True
                } else {
                    lockfile::HasInstallScript::False
                }
            } else {
                lockfile::HasInstallScript::False
            },

            integrity: if let Some(integrity) = pkg.get(b"integrity") {
                Integrity::parse(integrity.as_str().ok_or(Error::InvalidNPMLockfile)?)
            } else {
                Integrity::default()
            },

            ..lockfile::Meta::default()
        };

        let res = self.entry_resolution(
            j,
            pkg,
            key,
            name,
            name_string,
            name_hash,
            workspace_entry.is_some(),
            via_link,
            hint,
            folder_in_dependent.map(|folder| folder.path),
        )?;
        debug!(
            "{} -> {}",
            bstr::BStr::new(key),
            res.fmt_for_debug(self.this.buffers.string_bytes.as_slice())
        );

        if res.tag == resolution::Tag::Npm {
            let buf = self.this.buffers.string_bytes.as_slice();
            let url = res.npm().url.slice(buf);
            let configured_registry = self.manager.scope_for_package_name(name).url.href();
            if !lockfile::bun_lock::url_is_under_registry(url, configured_registry)
                && !lockfile::bun_lock::url_is_under_registry(
                    url,
                    Npm::Registry::DEFAULT_URL.as_bytes(),
                )
                && !meta.integrity.tag.is_supported()
            {
                return Err(Error::InvalidNPMLockfile);
            }
        }

        if j != 0 {
            if let Some(existing) = self.this.get_package_id(name_hash, None, &res) {
                debug!(
                    "deduplicated {} -> package {}",
                    bstr::BStr::new(key),
                    existing
                );
                // A bundled copy carries no `resolved`/`integrity`; a registry copy of the same version does.
                if res.tag == resolution::Tag::Npm && meta.integrity.tag.is_supported() {
                    let existing_meta = &mut self.this.packages.items_meta_mut()[existing as usize];
                    if !existing_meta.integrity.tag.is_supported() {
                        existing_meta.integrity = meta.integrity;
                        self.this.packages.items_resolution_mut()[existing as usize] = res;
                    }
                }
                if folder_in_dependent.is_none() {
                    self.entry_package_ids[j as usize] = existing;
                }
                self.shadow(j);
                return Ok(existing);
            }
        }

        let id = self.this.packages.len() as PackageID;
        meta.id = id;
        let bin_value = Self::parse_bin(self.this, pkg, name)?;

        self.this.packages.append(PackageListEntry {
            name: name_string,
            name_hash,
            resolution: res,
            dependencies: ExternalSlice::default(),
            resolutions: ExternalSlice::default(),
            meta,
            bin: bin_value,
            scripts: Default::default(),
        })?;
        self.this.get_or_put_id(id, name_hash)?;
        self.queue.push((j, id));
        // `build_or_get` must keep handing other dependents the entry-key build.
        match folder_in_dependent {
            None => self.entry_package_ids[j as usize] = id,
            Some(_) => self.shadowed.set(j as usize),
        }
        Ok(id)
    }

    fn parse_bin(this: &mut Lockfile, pkg: &E::ObjectJSON, name: &[u8]) -> Result<Bin, Error> {
        let Some(bin) = pkg.get(b"bin") else {
            return Ok(Bin::init());
        };
        let Some(bin_obj) = bin.as_object() else {
            return Err(Error::InvalidNPMLockfile);
        };
        let bin_props = bin_obj.properties();
        let mut sb = bun_semver::semver_string::Buf {
            bytes: &mut this.buffers.string_bytes,
            pool: &mut this.string_pool,
        };

        match bin_props {
            [] => Ok(Bin::init()),
            [prop] => {
                let key = prop.key.slice();
                let script_value = prop.value.as_str().ok_or(Error::InvalidNPMLockfile)?;
                if strings::eql(key, name) {
                    return Ok(Bin {
                        tag: bin::Tag::File,
                        _padding_tag: [0; 3],
                        value: bin::Value::init_file(sb.append(script_value)?),
                    });
                }
                Ok(Bin {
                    tag: bin::Tag::NamedFile,
                    _padding_tag: [0; 3],
                    value: bin::Value::init_named_file([sb.append(key)?, sb.append(script_value)?]),
                })
            }
            _ => {
                let off = this.buffers.extern_strings.len() as u32;
                let len = bin_props.len() as u32 * 2;
                this.buffers.extern_strings.reserve(len as usize);
                for bin_entry in bin_props {
                    let key = bin_entry.key.slice();
                    let script_value = bin_entry.value.as_str().ok_or(Error::InvalidNPMLockfile)?;
                    let ek = sb.append_external(key)?;
                    let ev = sb.append_external(script_value)?;
                    this.buffers.extern_strings.push(ek);
                    this.buffers.extern_strings.push(ev);
                }
                debug_assert_eq!(this.buffers.extern_strings.len(), (off + len) as usize);
                Ok(Bin {
                    tag: bin::Tag::Map,
                    _padding_tag: [0; 3],
                    value: bin::Value::init_map(ExternalStringList::new(off, len)),
                })
            }
        }
    }

    fn entry_resolution(
        &mut self,
        j: u32,
        pkg: &E::ObjectJSON,
        key: &[u8],
        name: &[u8],
        name_string: SemverString,
        name_hash: u64,
        is_workspace: bool,
        via_link: bool,
        hint: DepTag,
        path_in_dependent: Option<&[u8]>,
    ) -> Result<Resolution, Error> {
        if j == 0 {
            return Ok(Resolution::init(ResTagged::Root));
        }
        if is_workspace {
            let path = self.this.string_buf().append(key)?;
            return Ok(Resolution::init(ResTagged::Workspace(path)));
        }

        if let Some(resolved) = pkg.get(b"resolved") {
            let Some(r) = resolved.as_str() else {
                return Err(Error::InvalidNPMLockfile);
            };

            let tag = DepTag::infer(r);
            if tag == DepTag::Git || tag == DepTag::Github {
                return self.git_resolution(r, tag, name_string, name_hash, hint);
            }

            if let Some(local) = r.strip_prefix(b"file:") {
                let path = self.this.string_buf().append(local)?;
                return Ok(Resolution::init(ResTagged::LocalTarball(path)));
            }

            let version = if hint == DepTag::Tarball {
                None
            } else {
                match pkg.get(b"version") {
                    None => None,
                    Some(v) => Some(v.as_str().ok_or(Error::InvalidNPMLockfile)?),
                }
            };
            let Some(version) = version else {
                let url = self.this.string_buf().append(r)?;
                return Ok(Resolution::init(ResTagged::RemoteTarball(url)));
            };
            return Self::npm_resolution(self.this, r, version);
        }

        if !via_link && strings::index_of(key, b"node_modules/").is_some() && !name.is_empty() {
            if let Some(version) = pkg.get(b"version").and_then(|v| v.as_str()) {
                self.synthesize_registry_url(name, version)?;
                return Self::npm_resolution(self.this, &self.url, version);
            }
        }

        let path = self
            .this
            .string_buf()
            .append(path_in_dependent.unwrap_or(key))?;
        Ok(Resolution::init(ResTagged::Folder(path)))
    }

    fn npm_resolution(
        this: &mut Lockfile,
        url: &[u8],
        version: &[u8],
    ) -> Result<Resolution, Error> {
        let mut sb = this.string_buf();
        let version_string = sb.append(version)?;
        let url = sb.append(url)?;
        let version = Semver::Version::parse(version_string.sliced(sb.bytes.as_slice()))
            .version
            .min();
        Ok(Resolution::init(ResTagged::Npm(VersionedURLType {
            url,
            version,
        })))
    }

    fn synthesize_registry_url(&mut self, name: &[u8], version: &[u8]) -> Result<(), Error> {
        let unscoped: &[u8] = if name[0] == b'@' {
            let Some(slash) = strings::index_of_char_usize(name, b'/') else {
                return Err(Error::InvalidNPMLockfile);
            };
            if slash >= name.len() - 1 {
                return Err(Error::InvalidNPMLockfile);
            }
            &name[slash + 1..]
        } else {
            name
        };
        let href: &[u8] = self.manager.scope_for_package_name(name).url.href();
        let url = &mut self.url;
        url.clear();
        url.reserve(
            href.len()
                + name.len()
                + b"/-/".len()
                + unscoped.len()
                + 1
                + version.len()
                + b".tgz".len(),
        );
        url.extend_from_slice(href);
        url.extend_from_slice(name);
        url.extend_from_slice(b"/-/");
        url.extend_from_slice(unscoped);
        url.push(b'-');
        url.extend_from_slice(version);
        url.extend_from_slice(b".tgz");
        Ok(())
    }

    fn git_resolution(
        &mut self,
        r: &[u8],
        tag: DepTag,
        name_string: SemverString,
        name_hash: u64,
        hint: DepTag,
    ) -> Result<Resolution, Error> {
        let use_github = tag == DepTag::Github
            || (hint == DepTag::Github
                && matches!(HostedGitInfo::from_url(r), Ok(Some(info)) if info.host_provider == HostProvider::Github));

        let github_repo: Option<Repository> = if use_github {
            let this = &mut *self.this;
            let mut sb = this.string_buf();
            let appended = sb.append(r)?;
            let sliced = appended.sliced(sb.bytes.as_slice());
            dependency::parse_with_tag(
                name_string,
                Some(name_hash),
                sliced.slice,
                DepTag::Github,
                &sliced,
                None,
                Some(&mut *self.manager as &mut dyn dependency::NpmAliasRegistry),
            )
            .map(|v| *v.github())
        } else {
            None
        };
        let is_github = github_repo.is_some();
        let mut repo = match github_repo {
            Some(repo) => repo,
            None => Repository::parse_append_git(r, &mut self.this.string_buf())?,
        };

        {
            let buf = self.this.buffers.string_bytes.as_slice();
            let committish = repo.committish.slice(buf);
            if committish.is_empty() || !is_safe_resolved_tag(committish) {
                return Err(Error::InvalidNPMLockfile);
            }
        }
        repo.resolved = repo.committish;
        repo.package_name = name_string;

        Ok(Resolution::init(if is_github {
            ResTagged::Github(repo)
        } else {
            ResTagged::Git(repo)
        }))
    }

    fn link_package(&mut self, j: u32, id: PackageID) -> Result<(), Error> {
        let entries = self.entries;
        let entry = &entries[j as usize];
        let pkg = entry_object(entry);
        let key = entry.key.slice();

        let start = self.this.buffers.dependencies.len();
        debug_assert_eq!(start, self.this.buffers.resolutions.len());

        let res_tag = self.this.packages.items_resolution()[id as usize].tag;
        let is_local = matches!(res_tag, resolution::Tag::Root | resolution::Tag::Workspace);
        let bundle = if is_local {
            Bundle::None
        } else {
            parse_bundle(pkg)?
        };
        let replace_optional_dups = matches!(res_tag, resolution::Tag::Root | resolution::Tag::Npm);
        let skip_peer_dups = res_tag == resolution::Tag::Npm;
        let installed_from_cache = res_tag.can_enqueue_install_task();

        if j == 0 {
            self.link_workspaces()?;
        }

        let peer_meta: Option<&E::ObjectJSON> =
            pkg.get(b"peerDependenciesMeta").and_then(|m| m.as_object());

        for group in DEPENDENCY_GROUPS {
            let Some(deps) = pkg.get(group.prop) else {
                continue;
            };
            let Some(deps_obj) = deps.as_object() else {
                return Err(Error::InvalidNPMLockfile);
            };
            let is_peer_group = group.behavior == Behavior::PEER;
            let is_optional_group = group.behavior == Behavior::OPTIONAL;

            for prop in deps_obj.properties() {
                let name = prop.key.slice();
                let Some(spec) = prop.value.as_str() else {
                    return Err(Error::InvalidNPMLockfile);
                };
                let name_hash = string_hash(name);

                let version = {
                    let this = &mut *self.this;
                    let mut sb = this.string_buf();
                    let dep_name = sb.append_with_hash(name, name_hash)?;
                    let dep_version = sb.append(spec)?;
                    let sliced = dep_version.sliced(sb.bytes.as_slice());
                    Dependency::parse(
                        dep_name,
                        Some(name_hash),
                        sliced.slice,
                        &sliced,
                        None,
                        Some(&mut *self.manager),
                    )
                    .map(|version| (dep_name, version))
                };
                let Some((dep_name, version)) = version.filter(|(_, v)| v.tag != DepTag::Catalog)
                else {
                    if !self.silent {
                        bun_core::warn!(
                            "skipped \"{}@{}\" from package-lock.json: unsupported version specifier",
                            bstr::BStr::new(name),
                            bstr::BStr::new(spec),
                        );
                    }
                    continue;
                };

                let mut behavior = group.behavior;
                if is_peer_group
                    && peer_meta
                        .and_then(|m| m.get(name))
                        .and_then(|m| m.as_object())
                        .is_some_and(|m| pkg_flag_is_true(m, b"optional"))
                {
                    behavior |= Behavior::OPTIONAL;
                }
                if bundle.contains(name) {
                    behavior |= Behavior::BUNDLED;
                }

                let duplicate_of = if (is_peer_group && skip_peer_dups)
                    || (is_optional_group && replace_optional_dups)
                {
                    self.this.buffers.dependencies[start..]
                        .iter()
                        .position(|d| d.name_hash == name_hash)
                        .map(|k| start + k)
                } else {
                    None
                };
                if is_peer_group && duplicate_of.is_some() {
                    continue;
                }

                let version_tag = version.tag;
                let mut found = self.find_target(key, name);
                let mut folder_in_dependent: Option<FolderInDependent<'_>> = None;
                if let Some((t, through_link)) = found
                    && !is_local
                {
                    if through_link && installed_from_cache {
                        folder_in_dependent = path_inside(key, entries[t as usize].key.slice())
                            .map(|path| FolderInDependent { path, alias: name });
                    }
                    if folder_in_dependent.is_none() && self.is_external_folder(t, through_link) {
                        self.skip_external(t, name);
                        found = None;
                    }
                }
                let target = match found {
                    Some((t, through_link)) => match folder_in_dependent {
                        Some(folder) => {
                            self.build_package(t, through_link, version_tag, Some(folder))?
                        }
                        None => self.build_or_get(t, through_link, version_tag)?,
                    },
                    None if behavior.is_peer() || behavior.contains(Behavior::OPTIONAL) => {
                        INVALID_PACKAGE_ID
                    }
                    None => {
                        debug!(
                            "could not find package '{}' from '{}'",
                            bstr::BStr::new(name),
                            bstr::BStr::new(key)
                        );
                        continue;
                    }
                };

                let edge = Dependency {
                    name: dep_name,
                    name_hash,
                    version,
                    behavior,
                };
                let buffers = &mut self.this.buffers;
                match duplicate_of {
                    Some(k) => {
                        buffers.dependencies[k] = edge;
                        buffers.resolutions[k] = target;
                    }
                    None => {
                        buffers.dependencies.push(edge);
                        buffers.resolutions.push(target);
                    }
                }
            }
        }

        let len = self.this.buffers.dependencies.len() - start;
        debug_assert_eq!(len, self.this.buffers.resolutions.len() - start);
        let (deps_slice, res_slice) = if len == 0 {
            (ExternalSlice::default(), ExternalSlice::default())
        } else {
            (
                ExternalSlice::new(start as u32, len as u32),
                ExternalSlice::new(start as u32, len as u32),
            )
        };
        self.this.packages.items_dependencies_mut()[id as usize] = deps_slice;
        self.this.packages.items_resolutions_mut()[id as usize] = res_slice;
        Ok(())
    }

    fn link_workspaces(&mut self) -> Result<(), Error> {
        let Some(wksp) = self.workspace_map else {
            return Ok(());
        };
        debug_assert_eq!(wksp.keys().len(), wksp.values().len());
        for (path, ws) in wksp.keys().iter().zip(wksp.values()) {
            let target = self
                .index
                .get(&path[..])
                .copied()
                .filter(|&t| !self.link_entries.is_set(t as usize));
            let Some(t) = target else {
                if !self.silent {
                    bun_core::warn!(
                        "workspace \"{}\" ({}) is not in package-lock.json; resolving it from package.json",
                        bstr::BStr::new(&ws.name),
                        bstr::BStr::new(path),
                    );
                }
                continue;
            };
            let wid = self.build_or_get(t, false, DepTag::Workspace)?;
            let name_hash = string_hash(&ws.name);
            let mut sb = self.this.string_buf();
            let wksp_name = sb.append(&ws.name)?;
            let wksp_path = sb.append(path)?;
            self.this.buffers.dependencies.push(Dependency {
                name: wksp_name,
                name_hash,
                version: DepVersion {
                    tag: DepTag::Workspace,
                    literal: wksp_path,
                    value: DepValue {
                        workspace: wksp_path,
                    },
                },
                behavior: Behavior::WORKSPACE,
            });
            self.this.buffers.resolutions.push(wid);
        }
        Ok(())
    }

    fn find_target(&mut self, from_key: &[u8], name: &[u8]) -> Option<(u32, bool)> {
        let mut dir = from_key;
        loop {
            self.probe.clear();
            if !dir.is_empty() {
                self.probe.extend_from_slice(dir);
                self.probe.push(b'/');
            }
            self.probe.extend_from_slice(b"node_modules/");
            self.probe.extend_from_slice(name);
            if let Some(&t) = self.index.get(&self.probe[..]) {
                return if self.link_entries.is_set(t as usize) {
                    self.link_target(t).map(|x| (x, true))
                } else {
                    Some((t, false))
                };
            }
            if dir.is_empty() {
                return None;
            }
            dir = parent_dir(dir);
        }
    }

    fn link_target(&self, t: u32) -> Option<u32> {
        let entry = &self.entries[t as usize];
        let Some(resolved) = entry_object(entry)
            .get(b"resolved")
            .and_then(|r| r.as_str())
        else {
            debug!(
                "link '{}' has no usable resolved",
                bstr::BStr::new(entry.key.slice())
            );
            return None;
        };
        self.index
            .get(resolved)
            .copied()
            .filter(|&x| !self.link_entries.is_set(x as usize))
    }

    fn is_external_folder(&self, t: u32, through_link: bool) -> bool {
        let entry = &self.entries[t as usize];
        let key = entry.key.slice();
        if !bin::bin_target_escapes_package_dir(key) {
            return false;
        }
        let id = self.entry_package_ids[t as usize];
        if id != INVALID_PACKAGE_ID {
            return self.this.packages.items_resolution()[id as usize].tag
                == resolution::Tag::Folder;
        }
        let pkg = entry_object(entry);
        if pkg.get(b"resolved").is_some()
            || self.workspace_map.is_some_and(|m| m.get(key).is_some())
        {
            return false;
        }
        through_link
            || pkg.get(b"version").is_none()
            || strings::index_of(key, b"node_modules/").is_none()
    }

    fn skip_external(&mut self, t: u32, name: &[u8]) {
        if self.skipped_external.is_set(t as usize) {
            return;
        }
        self.skipped_external.set(t as usize);
        if !self.silent {
            bun_core::warn!(
                "skipped \"{}\" from package-lock.json: transitive folder dependency \"{}\" is outside the project",
                bstr::BStr::new(name),
                bstr::BStr::new(self.entries[t as usize].key.slice()),
            );
        }
        self.shadow(t);
    }

    fn shadow(&mut self, j: u32) {
        if self.shadowed.is_set(j as usize) {
            return;
        }
        self.shadowed.set(j as usize);
        self.queue.push((j, INVALID_PACKAGE_ID));
    }

    fn shadow_dependencies(&mut self, j: u32) {
        let entries = self.entries;
        let entry = &entries[j as usize];
        let pkg = entry_object(entry);
        let key = entry.key.slice();
        for group in DEPENDENCY_GROUPS {
            let Some(deps) = pkg.get(group.prop).and_then(|d| d.as_object()) else {
                continue;
            };
            for prop in deps.properties() {
                if let Some((t, _)) = self.find_target(key, prop.key.slice())
                    && self.entry_package_ids[t as usize] == INVALID_PACKAGE_ID
                {
                    self.shadow(t);
                }
            }
        }
    }

    fn warn_unreachable(&self) {
        if self.silent {
            return;
        }
        let mut count: usize = 0;
        let mut list = String::new();
        for (j, entry) in self.entries.iter().enumerate() {
            if self.link_entries.is_set(j)
                || self.entry_package_ids[j] != INVALID_PACKAGE_ID
                || self.shadowed.is_set(j)
                || pkg_flag_is_true(entry_object(entry), b"extraneous")
            {
                continue;
            }
            count += 1;
            if count <= 5 {
                if count > 1 {
                    list.push_str(", ");
                }
                let _ = write!(list, "\"{}\"", bstr::BStr::new(entry.key.slice()));
            }
        }
        if count == 0 {
            return;
        }
        if count > 5 {
            let _ = write!(list, " and {} more", count - 5);
        }
        bun_core::warn!(
            "skipped {} package-lock.json {} not depended on by any package: {}",
            count,
            if count == 1 { "entry" } else { "entries" },
            list,
        );
    }
}

pub(super) fn apply_root_overrides(
    this: &mut Lockfile,
    manager: &mut PackageManager,
    log: &mut bun_ast::Log,
    dir: Fd,
    workspace_map: Option<&WorkspaceMap>,
    abs_lockfile_path: &[u8],
) -> Result<(), Error> {
    let Ok(file) = File::openat(dir, b"package.json", O::RDONLY, 0) else {
        return Ok(());
    };
    let Ok(contents) = file.read_to_end() else {
        return Ok(());
    };
    drop(file);

    let mut package_json_path_buf = bun_paths::path_buffer_pool::get();
    let package_json_path = resolve_path::join_string_buf::<bun_paths::platform::Auto>(
        &mut package_json_path_buf[..],
        &[
            bun_paths::dirname(abs_lockfile_path).unwrap_or_default(),
            b"package.json",
        ],
    );
    let source = bun_ast::Source::init_path_string(package_json_path, contents.as_slice());
    let arena = bun_alloc::Arena::new();
    let Ok(parsed) = bun_json::parse_package_json_utf8_with_opts(
        bun_json::JSONOptions {
            json_warn_duplicate_keys: false,
            guess_indentation: true,
            ..bun_json::PACKAGE_JSON_OPTS
        },
        &source,
        log,
        &arena,
    ) else {
        return Err(Error::InvalidPackageJSON);
    };
    let json = parsed.root;
    if json.as_property(b"overrides").is_none() && json.as_property(b"resolutions").is_none() {
        return Ok(());
    }

    let empty = WorkspaceMap::init();
    let names = workspace_map.unwrap_or(&empty);
    let root_package = *this.packages.get(0);
    let (mut builder, lf) = this.string_builder_split();
    lf.overrides
        .parse_count(manager, log, &source, names, json, &mut builder);
    builder.allocate()?;
    lf.overrides.parse_append(
        manager,
        lf.dependencies.as_slice(),
        &root_package,
        log,
        &source,
        names,
        json,
        &mut builder,
    )?;
    builder.clamp();
    Ok(())
}

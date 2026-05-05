use core::mem;

use bun_collections::{ArrayHashMap, ArrayIdentityContext, MultiArrayList};
use bun_core::{Global, Output, StringSet};
use bun_js_parser::ast::Expr;
use bun_logger as logger;
use bun_paths::{self as path, AbsPath, PathBuffer, MAX_PATH_BYTES};
// MOVE_DOWN(b0): bun_resolver::fs → bun_sys::fs
use bun_sys::fs::FileSystem;
use bun_semver::{self as semver, ExternalString, String, Version as SemverVersion};
use bun_str::strings;
use bun_sys::File;

use bun_install::{
    self as install, default_trusted_dependencies, initialize_store, invalid_package_id, Aligner,
    Bin, Dependency, ExternalStringList, ExternalStringMap, Features, Npm, PackageID, PackageJSON,
    PackageManager, PackageNameHash, Repository, TruncatedPackageNameHash,
};
use bun_install::dependency::Behavior;
use bun_install::lockfile::{
    self, assert_no_uninitialized_padding, Cloner, DependencySlice, Lockfile, PackageIDSlice,
    Stream, StringBuilder, TrustedDependenciesSet,
};
use bun_install::resolution::ResolutionType;

pub use super::package::scripts::Scripts;
pub use super::package::meta::Meta;
pub use super::package::workspace_map as WorkspaceMap;

bun_output::declare_scope!(Lockfile, hidden);

// Zig: `pub fn Package(comptime SemverIntType: type) type { return extern struct { ... } }`
#[repr(C)]
pub struct Package<SemverIntType> {
    pub name: String,
    pub name_hash: PackageNameHash,

    /// How this package has been resolved
    /// When .tag is uninitialized, that means the package is not resolved yet.
    pub resolution: ResolutionType<SemverIntType>,

    /// dependencies & resolutions must be the same length
    /// resolutions[i] is the resolved package ID for dependencies[i]
    /// if resolutions[i] is an invalid package ID, then dependencies[i] is not resolved
    pub dependencies: DependencySlice,

    /// The resolved package IDs for this package's dependencies. Instead of storing this
    /// on the `Dependency` struct within `.dependencies`, it is stored on the package itself
    /// so we can access it faster.
    ///
    /// Each index in this array corresponds to the same index in dependencies.
    /// Each value in this array corresponds to the resolved package ID for that dependency.
    ///
    /// So this is how you say "what package ID for lodash does this package actually resolve to?"
    ///
    /// By default, the underlying buffer is filled with "invalid_id" to indicate this package ID
    /// was not resolved
    pub resolutions: PackageIDSlice,

    pub meta: Meta,
    pub bin: Bin,

    /// If any of these scripts run, they will run in order:
    /// 1. preinstall
    /// 2. install
    /// 3. postinstall
    /// 4. preprepare
    /// 5. prepare
    /// 6. postprepare
    pub scripts: Scripts,
}

type Resolution<SemverIntType> = ResolutionType<SemverIntType>;

impl<SemverIntType> Default for Package<SemverIntType> {
    fn default() -> Self {
        Self {
            name: String::default(),
            name_hash: 0,
            resolution: Resolution::<SemverIntType>::default(),
            dependencies: DependencySlice::default(),
            resolutions: PackageIDSlice::default(),
            meta: Meta::init(),
            bin: Bin::default(),
            scripts: Scripts::default(),
        }
    }
}

pub struct DependencyGroup {
    pub prop: &'static [u8],
    pub field: &'static [u8],
    pub behavior: Behavior,
}

impl DependencyGroup {
    pub const DEPENDENCIES: DependencyGroup = DependencyGroup {
        prop: b"dependencies",
        field: b"dependencies",
        behavior: Behavior { prod: true, ..Behavior::EMPTY },
    };
    pub const DEV: DependencyGroup = DependencyGroup {
        prop: b"devDependencies",
        field: b"dev_dependencies",
        behavior: Behavior { dev: true, ..Behavior::EMPTY },
    };
    pub const OPTIONAL: DependencyGroup = DependencyGroup {
        prop: b"optionalDependencies",
        field: b"optional_dependencies",
        behavior: Behavior { optional: true, ..Behavior::EMPTY },
    };
    pub const PEER: DependencyGroup = DependencyGroup {
        prop: b"peerDependencies",
        field: b"peer_dependencies",
        behavior: Behavior { peer: true, ..Behavior::EMPTY },
    };
    pub const WORKSPACES: DependencyGroup = DependencyGroup {
        prop: b"workspaces",
        field: b"workspaces",
        behavior: Behavior { workspace: true, ..Behavior::EMPTY },
    };
}

// TODO(port): lifetime — Phase A forbids lifetime params on structs; these are
// borrows into lockfile.packages SoA columns + string_bytes (no LIFETIMES.tsv entry).
pub struct Alphabetizer<SemverIntType> {
    pub names: *const [String],
    pub buf: *const [u8],
    pub resolutions: *const [Resolution<SemverIntType>],
}

impl<SemverIntType> Alphabetizer<SemverIntType> {
    pub fn is_alphabetical(&self, lhs: PackageID, rhs: PackageID) -> bool {
        // SAFETY: caller constructs Alphabetizer with slices that outlive the sort call.
        let (names, buf, resolutions) = unsafe { (&*self.names, &*self.buf, &*self.resolutions) };
        match names[lhs as usize].order(&names[rhs as usize], buf, buf) {
            core::cmp::Ordering::Equal => {
                resolutions[lhs as usize].order(&resolutions[rhs as usize], buf, buf)
                    == core::cmp::Ordering::Less
            }
            core::cmp::Ordering::Less => true,
            core::cmp::Ordering::Greater => false,
        }
    }
}

impl<SemverIntType> Package<SemverIntType> {
    #[inline]
    pub fn is_disabled(&self, cpu: Npm::Architecture, os: Npm::OperatingSystem) -> bool {
        self.meta.is_disabled(cpu, os)
    }

    pub fn clone(
        &self,
        pm: &mut PackageManager,
        old: &mut Lockfile,
        new: &mut Lockfile,
        package_id_mapping: &mut [PackageID],
        cloner: &mut Cloner,
    ) -> Result<PackageID, bun_core::Error> {
        // TODO(port): narrow error set
        let old_string_buf = old.buffers.string_bytes.as_slice();
        let old_extern_string_buf = old.buffers.extern_strings.as_slice();
        let mut builder_ = new.string_builder();
        let builder = &mut builder_;
        bun_output::scoped_log!(
            Lockfile,
            "Clone: {}@{} ({}, {} dependencies)",
            bstr::BStr::new(self.name.slice(old_string_buf)),
            self.resolution.fmt(old_string_buf, lockfile::FmtMode::Auto),
            <&'static str>::from(self.resolution.tag),
            self.dependencies.len,
        );

        builder.count(self.name.slice(old_string_buf));
        self.resolution.count(old_string_buf, builder);
        self.meta.count(old_string_buf, builder);
        self.scripts.count(old_string_buf, builder);
        for patched_dep in old.patched_dependencies.values() {
            builder.count(patched_dep.path.slice(old.buffers.string_bytes.as_slice()));
        }
        let new_extern_string_count =
            self.bin.count(old_string_buf, old_extern_string_buf, builder);
        let old_dependencies: &[Dependency] =
            self.dependencies.get(old.buffers.dependencies.as_slice());
        let old_resolutions: &[PackageID] =
            self.resolutions.get(old.buffers.resolutions.as_slice());

        for dependency in old_dependencies {
            dependency.count(old_string_buf, builder);
        }

        builder.allocate()?;

        // should be unnecessary, but Just In Case
        new.buffers.dependencies.reserve(old_dependencies.len());
        new.buffers.resolutions.reserve(old_dependencies.len());
        new.buffers.extern_strings.reserve(new_extern_string_count);

        let prev_len = new.buffers.dependencies.len() as u32;
        let end = prev_len + (old_dependencies.len() as u32);
        let max_package_id = old.packages.len() as PackageID;

        // SAFETY: capacity reserved above; setting len to expose uninitialized slots that are written below.
        unsafe {
            new.buffers.dependencies.set_len(end as usize);
            new.buffers.resolutions.set_len(end as usize);
        }

        let extern_strings_old_len = new.buffers.extern_strings.len();
        // SAFETY: capacity reserved above; written by `bin.clone` below.
        unsafe {
            new.buffers
                .extern_strings
                .set_len(extern_strings_old_len + new_extern_string_count);
        }
        // PORT NOTE: reshaped for borrowck — split extern_strings buffer into full slice + tail slice
        let new_extern_strings_start = new.buffers.extern_strings.len() - new_extern_string_count;
        let (extern_strings_all, _) = new.buffers.extern_strings.split_at_mut(0);
        // TODO(port): the Zig passes both `new.buffers.extern_strings.items` and a tail slice into
        // `bin.clone`. Rust borrowck won't allow two overlapping &mut. Phase B should rework
        // `Bin::clone` to take base+offset.
        let new_extern_strings = &mut new.buffers.extern_strings[new_extern_strings_start..];
        let _ = extern_strings_all;

        let dependencies: &mut [Dependency] =
            &mut new.buffers.dependencies[prev_len as usize..end as usize];
        let resolutions: &mut [PackageID] =
            &mut new.buffers.resolutions[prev_len as usize..end as usize];

        let id = new.packages.len() as PackageID;
        let new_package = new.append_package_with_id(
            Package::<SemverIntType> {
                name: builder.append_with_hash::<String>(
                    self.name.slice(old_string_buf),
                    self.name_hash,
                ),
                bin: self.bin.clone_into(
                    old_string_buf,
                    old_extern_string_buf,
                    new.buffers.extern_strings.as_slice(),
                    new_extern_strings,
                    builder,
                ),
                name_hash: self.name_hash,
                meta: self.meta.clone_into(id, old_string_buf, builder),
                resolution: self.resolution.clone_into(old_string_buf, builder),
                scripts: self.scripts.clone_into(old_string_buf, builder),
                dependencies: DependencySlice { off: prev_len, len: end - prev_len },
                resolutions: PackageIDSlice { off: prev_len, len: end - prev_len },
            },
            id,
        )?;

        package_id_mapping[self.meta.id as usize] = new_package.meta.id;

        if cloner.manager.preinstall_state.len() > 0 {
            cloner.manager.preinstall_state[new_package.meta.id as usize] =
                cloner.old_preinstall_state[self.meta.id as usize];
        }

        debug_assert_eq!(old_dependencies.len(), dependencies.len());
        for (old_dep, new_dep) in old_dependencies.iter().zip(dependencies.iter_mut()) {
            *new_dep = old_dep.clone_into(pm, old_string_buf, builder)?;
        }

        builder.clamp();

        cloner.trees_count += (old_resolutions.len() > 0) as u32;

        debug_assert_eq!(old_resolutions.len(), resolutions.len());
        for (i, (old_resolution, resolution)) in
            old_resolutions.iter().zip(resolutions.iter_mut()).enumerate()
        {
            if *old_resolution >= max_package_id {
                *resolution = invalid_package_id;
                continue;
            }

            let mapped = package_id_mapping[*old_resolution as usize];
            if mapped < max_package_id {
                *resolution = mapped;
            } else {
                cloner.clone_queue.push(lockfile::CloneQueueItem {
                    old_resolution: *old_resolution,
                    parent: new_package.meta.id,
                    resolve_id: new_package.resolutions.off
                        + PackageID::try_from(i).unwrap(),
                });
            }
        }

        Ok(new_package.meta.id)
    }

    pub fn from_package_json<const FEATURES: Features>(
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        package_json: &mut PackageJSON,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let mut package = Self::default();

        // var string_buf = package_json;

        let mut string_builder = lockfile.string_builder();

        let mut total_dependencies_count: u32 = 0;
        // var bin_extern_strings_count: u32 = 0;

        // --- Counting
        {
            string_builder.count(&package_json.name);
            string_builder.count(&package_json.version);
            let dependencies = package_json.dependencies.map.values();
            for dep in dependencies {
                if dep.behavior.is_enabled(FEATURES) {
                    dep.count(&package_json.dependencies.source_buf, &mut string_builder);
                    total_dependencies_count += 1;
                }
            }
        }

        // string_builder.count(manifest.str(&package_version_ptr.tarball_url));

        string_builder.allocate()?;
        // defer string_builder.clamp(); — handled at end of scope below
        // var extern_strings_list = &lockfile.buffers.extern_strings;
        let dependencies_list = &mut lockfile.buffers.dependencies;
        let resolutions_list = &mut lockfile.buffers.resolutions;
        dependencies_list.reserve(total_dependencies_count as usize);
        resolutions_list.reserve(total_dependencies_count as usize);
        // try extern_strings_list.ensureUnusedCapacity(lockfile.allocator, bin_extern_strings_count);
        // extern_strings_list.items.len += bin_extern_strings_count;

        // -- Cloning
        {
            let package_name: ExternalString =
                string_builder.append::<ExternalString>(&package_json.name);
            package.name_hash = package_name.hash;
            package.name = package_name.value;

            package.resolution = Resolution::<SemverIntType> {
                tag: lockfile::ResolutionTag::Root,
                value: lockfile::ResolutionValue::root(),
            };

            let total_len = dependencies_list.len() + total_dependencies_count as usize;
            if cfg!(debug_assertions) {
                debug_assert!(dependencies_list.len() == resolutions_list.len());
            }

            // SAFETY: capacity reserved above; slots are filled by @memset/loop below.
            let dep_start = dependencies_list.len();
            unsafe { dependencies_list.set_len(total_len) };
            let mut dependencies: &mut [Dependency] =
                &mut dependencies_list[dep_start..total_len];
            dependencies.fill(Dependency::default());

            let package_dependencies = package_json.dependencies.map.values();
            let source_buf = &package_json.dependencies.source_buf;
            for dep in package_dependencies {
                if !dep.behavior.is_enabled(FEATURES) {
                    continue;
                }

                dependencies[0] = dep.clone_into(pm, source_buf, &mut string_builder)?;
                dependencies = &mut dependencies[1..];
                if dependencies.is_empty() {
                    break;
                }
            }

            // We lose the bin info here
            // package.bin = package_version.bin.clone(string_buf, manifest.extern_strings_bin_entries, extern_strings_list.items, extern_strings_slice, @TypeOf(&string_builder), &string_builder);
            // and the integriy hash
            // package.meta.integrity = package_version.integrity;

            package.meta.arch = package_json.arch;
            package.meta.os = package_json.os;

            package.dependencies.off = dep_start as u32;
            package.dependencies.len =
                total_dependencies_count - (dependencies.len() as u32);
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            let new_length = package.dependencies.len as usize + dep_start;

            // SAFETY: capacity reserved above; slots are filled by fill() below.
            unsafe { resolutions_list.set_len(new_length) };
            resolutions_list[package.dependencies.off as usize
                ..(package.dependencies.off + package.dependencies.len) as usize]
                .fill(invalid_package_id);

            // SAFETY: shrink dependencies_list to actual filled length
            unsafe { dependencies_list.set_len(new_length) };

            string_builder.clamp();
            return Ok(package);
        }
    }

    pub fn from_npm<const FEATURES: Features>(
        pm: &mut PackageManager,
        lockfile: &mut Lockfile,
        log: &mut logger::Log,
        manifest: &Npm::PackageManifest,
        version: SemverVersion,
        package_version_ptr: &Npm::PackageVersion,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let mut package = Self::default();

        let package_version = *package_version_ptr;

        // PERF(port): was comptime-computed array — profile in Phase B
        let dependency_groups: &[DependencyGroup] = &{
            let mut out: Vec<DependencyGroup> = Vec::with_capacity(4);
            if FEATURES.dependencies {
                out.push(DependencyGroup::DEPENDENCIES);
            }
            if FEATURES.dev_dependencies {
                out.push(DependencyGroup::DEV);
            }
            if FEATURES.optional_dependencies {
                out.push(DependencyGroup::OPTIONAL);
            }
            if FEATURES.peer_dependencies {
                out.push(DependencyGroup::PEER);
            }
            out
        };

        let mut string_builder = lockfile.string_builder();

        let mut total_dependencies_count: u32 = 0;
        let mut bin_extern_strings_count: u32 = 0;

        // --- Counting
        {
            string_builder.count(manifest.name());
            version.count(manifest.string_buf, &mut string_builder);

            // PERF(port): was `inline for` — profile in Phase B
            for group in dependency_groups {
                // TODO(port): Zig uses `@field(package_version, group.field)` reflection.
                // Phase B: add `PackageVersion::dep_group(field: &[u8]) -> ExternalStringMap`.
                let map: ExternalStringMap = package_version.dep_group(group.field);
                let keys = map.name.get(manifest.external_strings);
                let version_strings = map.value.get(manifest.external_strings_for_versions);
                total_dependencies_count += map.value.len;

                if cfg!(debug_assertions) {
                    debug_assert!(keys.len() == version_strings.len());
                }

                debug_assert_eq!(keys.len(), version_strings.len());
                for (key, ver) in keys.iter().zip(version_strings.iter()) {
                    string_builder.count(key.slice(manifest.string_buf));
                    string_builder.count(ver.slice(manifest.string_buf));
                }
            }

            bin_extern_strings_count = package_version.bin.count(
                manifest.string_buf,
                manifest.extern_strings_bin_entries,
                &mut string_builder,
            );
        }

        string_builder.count(manifest.str(&package_version_ptr.tarball_url));

        string_builder.allocate()?;
        // defer string_builder.clamp(); — handled at end of scope
        let extern_strings_list = &mut lockfile.buffers.extern_strings;
        let dependencies_list = &mut lockfile.buffers.dependencies;
        let resolutions_list = &mut lockfile.buffers.resolutions;
        dependencies_list.reserve(total_dependencies_count as usize);
        resolutions_list.reserve(total_dependencies_count as usize);
        extern_strings_list.reserve(bin_extern_strings_count as usize);
        let extern_old_len = extern_strings_list.len();
        // SAFETY: capacity reserved above; written by bin.clone below.
        unsafe {
            extern_strings_list.set_len(extern_old_len + bin_extern_strings_count as usize);
        }
        let extern_strings_slice =
            &mut extern_strings_list[extern_old_len..];

        // -- Cloning
        {
            let package_name: ExternalString = string_builder
                .append_with_hash::<ExternalString>(manifest.name(), manifest.pkg.name.hash);
            package.name_hash = package_name.hash;
            package.name = package_name.value;
            package.resolution = Resolution::<SemverIntType> {
                value: lockfile::ResolutionValue::npm(lockfile::NpmResolution {
                    version: version.append(manifest.string_buf, &mut string_builder),
                    url: string_builder
                        .append::<String>(manifest.str(&package_version_ptr.tarball_url)),
                }),
                tag: lockfile::ResolutionTag::Npm,
            };

            let total_len = dependencies_list.len() + total_dependencies_count as usize;
            if cfg!(debug_assertions) {
                debug_assert!(dependencies_list.len() == resolutions_list.len());
            }

            let dep_start = dependencies_list.len();
            // SAFETY: capacity reserved above; slots are filled below.
            unsafe { dependencies_list.set_len(total_len) };
            let dependencies = &mut dependencies_list[dep_start..total_len];
            dependencies.fill(Dependency::default());

            total_dependencies_count = 0;
            // PERF(port): was `inline for` — profile in Phase B
            for group in dependency_groups {
                // TODO(port): @field reflection — see note above
                let map: ExternalStringMap = package_version.dep_group(group.field);
                let keys = map.name.get(manifest.external_strings);
                let version_strings = map.value.get(manifest.external_strings_for_versions);

                if cfg!(debug_assertions) {
                    debug_assert!(keys.len() == version_strings.len());
                }
                let is_peer = group.field == b"peer_dependencies";

                debug_assert_eq!(keys.len(), version_strings.len());
                'list: for (i, (key, version_string_)) in
                    keys.iter().zip(version_strings.iter()).enumerate()
                {
                    // Duplicate peer & dev dependencies are promoted to whichever appeared first
                    // In practice, npm validates this so it shouldn't happen
                    let mut duplicate_at: Option<usize> = None;
                    if group.behavior.is_peer()
                        || group.behavior.is_dev()
                        || group.behavior.is_optional()
                    {
                        for (j, dependency) in
                            dependencies[0..total_dependencies_count as usize].iter().enumerate()
                        {
                            if dependency.name_hash == key.hash {
                                if group.behavior.is_optional() {
                                    duplicate_at = Some(j);
                                    break;
                                }

                                continue 'list;
                            }
                        }
                    }

                    let name: ExternalString = string_builder
                        .append_with_hash::<ExternalString>(
                            key.slice(manifest.string_buf),
                            key.hash,
                        );
                    let dep_version = string_builder.append_with_hash::<String>(
                        version_string_.slice(manifest.string_buf),
                        version_string_.hash,
                    );
                    let sliced = dep_version.sliced(lockfile.buffers.string_bytes.as_slice());

                    let mut behavior = group.behavior;
                    if is_peer {
                        behavior.optional =
                            i < usize::from(package_version.non_optional_peer_dependencies_start);
                    }
                    if package_version_ptr.all_dependencies_bundled() {
                        behavior.bundled = true;
                    } else {
                        for bundled_dep_name_hash in package_version
                            .bundled_dependencies
                            .get(manifest.bundled_deps_buf)
                        {
                            if *bundled_dep_name_hash == name.hash {
                                behavior.bundled = true;
                                break;
                            }
                        }
                    }

                    let dependency = Dependency {
                        name: name.value,
                        name_hash: name.hash,
                        behavior,
                        version: Dependency::parse(
                            name.value,
                            name.hash,
                            sliced.slice,
                            &sliced,
                            log,
                            pm,
                        )
                        .unwrap_or_default(),
                    };

                    // If a dependency appears in both "dependencies" and "optionalDependencies", it is considered optional!
                    if group.behavior.is_optional() {
                        if let Some(j) = duplicate_at {
                            // need to shift dependencies after the duplicate to maintain sort order
                            for k in (j + 1)..(total_dependencies_count as usize) {
                                dependencies[k - 1] = dependencies[k];
                            }

                            // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies
                            // > Entries in optionalDependencies will override entries of the same name in dependencies, so it's usually best to only put in one place.
                            dependencies[total_dependencies_count as usize - 1] = dependency;
                            continue 'list;
                        }
                    }

                    dependencies[total_dependencies_count as usize] = dependency;
                    total_dependencies_count += 1;
                }
            }

            package.bin = package_version.bin.clone_into(
                manifest.string_buf,
                manifest.extern_strings_bin_entries,
                extern_strings_list.as_slice(),
                extern_strings_slice,
                &mut string_builder,
            );

            package.meta.arch = package_version.cpu;
            package.meta.os = package_version.os;
            package.meta.integrity = package_version.integrity;
            package.meta.set_has_install_script(package_version.has_install_script);

            package.dependencies.off = dep_start as u32;
            package.dependencies.len = total_dependencies_count;
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            let new_length = package.dependencies.len as usize + dep_start;

            // SAFETY: capacity reserved above; filled below.
            unsafe { resolutions_list.set_len(new_length) };
            resolutions_list[package.dependencies.off as usize
                ..(package.dependencies.off + package.dependencies.len) as usize]
                .fill(invalid_package_id);

            // SAFETY: shrink to filled length.
            unsafe { dependencies_list.set_len(new_length) };

            #[cfg(debug_assertions)]
            {
                if package.resolution.value.npm().url.is_empty() {
                    Output::panic(format_args!(
                        "tarball_url is empty for package {}@{}",
                        bstr::BStr::new(manifest.name()),
                        version
                    ));
                }
            }

            string_builder.clamp();
            return Ok(package);
        }
    }
}

// ─── Diff ────────────────────────────────────────────────────────────────────

pub struct Diff;

#[repr(u8)]
pub enum DiffOp {
    Add,
    Remove,
    Update,
    Unlink,
    Link,
}

#[derive(Default)]
pub struct DiffSummary {
    pub add: u32,
    pub remove: u32,
    pub update: u32,
    pub overrides_changed: bool,
    pub catalogs_changed: bool,

    /// bool for if this dependency should be added to lockfile trusted dependencies.
    /// it is false when the new trusted dependency is coming from the default list.
    pub added_trusted_dependencies:
        ArrayHashMap<TruncatedPackageNameHash, bool, ArrayIdentityContext>,
    pub removed_trusted_dependencies: TrustedDependenciesSet,

    pub patched_dependencies_changed: bool,
}

impl DiffSummary {
    #[inline]
    pub fn sum(&mut self, that: &DiffSummary) {
        self.add += that.add;
        self.remove += that.remove;
        self.update += that.update;
    }

    #[inline]
    pub fn has_diffs(&self) -> bool {
        self.add > 0
            || self.remove > 0
            || self.update > 0
            || self.overrides_changed
            || self.catalogs_changed
            || self.added_trusted_dependencies.count() > 0
            || self.removed_trusted_dependencies.count() > 0
            || self.patched_dependencies_changed
    }
}

impl Diff {
    pub fn generate<SemverIntType>(
        pm: &mut PackageManager,
        log: &mut logger::Log,
        from_lockfile: &mut Lockfile,
        to_lockfile: &mut Lockfile,
        from: &mut Package<SemverIntType>,
        to: &mut Package<SemverIntType>,
        update_requests: Option<&[PackageManager::UpdateRequest]>,
        id_mapping: Option<&mut [PackageID]>,
    ) -> Result<DiffSummary, bun_core::Error> {
        // TODO(port): narrow error set
        let mut summary = DiffSummary::default();
        let is_root = id_mapping.is_some();
        let mut to_deps = to.dependencies.get(to_lockfile.buffers.dependencies.as_slice());
        let from_deps = from.dependencies.get(from_lockfile.buffers.dependencies.as_slice());
        let from_resolutions = from.resolutions.get(from_lockfile.buffers.resolutions.as_slice());
        let mut to_i: usize = 0;

        if from_lockfile.overrides.map.count() != to_lockfile.overrides.map.count() {
            summary.overrides_changed = true;

            if PackageManager::verbose_install() {
                Output::pretty_errorln(format_args!("Overrides changed since last install"));
            }
        } else {
            from_lockfile.overrides.sort(from_lockfile);
            to_lockfile.overrides.sort(to_lockfile);
            debug_assert_eq!(
                from_lockfile.overrides.map.keys().len(),
                to_lockfile.overrides.map.keys().len()
            );
            for (((from_k, from_override), to_k), to_override) in from_lockfile
                .overrides
                .map
                .keys()
                .iter()
                .zip(from_lockfile.overrides.map.values())
                .zip(to_lockfile.overrides.map.keys())
                .zip(to_lockfile.overrides.map.values())
            {
                if (from_k != to_k)
                    || (!from_override.eql(
                        to_override,
                        from_lockfile.buffers.string_bytes.as_slice(),
                        to_lockfile.buffers.string_bytes.as_slice(),
                    ))
                {
                    summary.overrides_changed = true;
                    if PackageManager::verbose_install() {
                        Output::pretty_errorln(format_args!(
                            "Overrides changed since last install"
                        ));
                    }
                    break;
                }
            }
        }

        if is_root {
            'catalogs: {
                // don't sort if lengths are different
                if from_lockfile.catalogs.default.count() != to_lockfile.catalogs.default.count() {
                    summary.catalogs_changed = true;
                    break 'catalogs;
                }

                if from_lockfile.catalogs.groups.count() != to_lockfile.catalogs.groups.count() {
                    summary.catalogs_changed = true;
                    break 'catalogs;
                }

                from_lockfile.catalogs.sort(from_lockfile);
                to_lockfile.catalogs.sort(to_lockfile);

                for (((from_dep_name, from_dep), to_dep_name), to_dep) in from_lockfile
                    .catalogs
                    .default
                    .keys()
                    .iter()
                    .zip(from_lockfile.catalogs.default.values())
                    .zip(to_lockfile.catalogs.default.keys())
                    .zip(to_lockfile.catalogs.default.values())
                {
                    if !from_dep_name.eql(
                        to_dep_name,
                        from_lockfile.buffers.string_bytes.as_slice(),
                        to_lockfile.buffers.string_bytes.as_slice(),
                    ) {
                        summary.catalogs_changed = true;
                        break 'catalogs;
                    }

                    if !from_dep.eql(
                        to_dep,
                        from_lockfile.buffers.string_bytes.as_slice(),
                        to_lockfile.buffers.string_bytes.as_slice(),
                    ) {
                        summary.catalogs_changed = true;
                        break 'catalogs;
                    }
                }

                for (((from_catalog_name, from_catalog_deps), to_catalog_name), to_catalog_deps) in
                    from_lockfile
                        .catalogs
                        .groups
                        .keys()
                        .iter()
                        .zip(from_lockfile.catalogs.groups.values())
                        .zip(to_lockfile.catalogs.groups.keys())
                        .zip(to_lockfile.catalogs.groups.values())
                {
                    if !from_catalog_name.eql(
                        to_catalog_name,
                        from_lockfile.buffers.string_bytes.as_slice(),
                        to_lockfile.buffers.string_bytes.as_slice(),
                    ) {
                        summary.catalogs_changed = true;
                        break 'catalogs;
                    }

                    if from_catalog_deps.count() != to_catalog_deps.count() {
                        summary.catalogs_changed = true;
                        break 'catalogs;
                    }

                    for (((from_dep_name, from_dep), to_dep_name), to_dep) in from_catalog_deps
                        .keys()
                        .iter()
                        .zip(from_catalog_deps.values())
                        .zip(to_catalog_deps.keys())
                        .zip(to_catalog_deps.values())
                    {
                        if !from_dep_name.eql(
                            to_dep_name,
                            from_lockfile.buffers.string_bytes.as_slice(),
                            to_lockfile.buffers.string_bytes.as_slice(),
                        ) {
                            summary.catalogs_changed = true;
                            break 'catalogs;
                        }

                        if !from_dep.eql(
                            to_dep,
                            from_lockfile.buffers.string_bytes.as_slice(),
                            to_lockfile.buffers.string_bytes.as_slice(),
                        ) {
                            summary.catalogs_changed = true;
                            break 'catalogs;
                        }
                    }
                }
            }
        }

        'trusted_dependencies: {
            // trusted dependency diff
            //
            // situations:
            // 1 - Both old lockfile and new lockfile use default trusted dependencies, no diffs
            // 2 - Both exist, only diffs are from additions and removals
            //
            // 3 - Old lockfile has trusted dependencies, new lockfile does not. Added are dependencies
            //     from default list that didn't exist previously. We need to be careful not to add these
            //     to the new lockfile. Removed are dependencies from old list that
            //     don't exist in the default list.
            //
            // 4 - Old lockfile used the default list, new lockfile has trusted dependencies. Added
            //     are dependencies are all from the new lockfile. Removed is empty because the default
            //     list isn't appended to the lockfile.

            // 1
            if from_lockfile.trusted_dependencies.is_none()
                && to_lockfile.trusted_dependencies.is_none()
            {
                break 'trusted_dependencies;
            }

            // 2
            if from_lockfile.trusted_dependencies.is_some()
                && to_lockfile.trusted_dependencies.is_some()
            {
                let from_trusted_dependencies =
                    from_lockfile.trusted_dependencies.as_ref().unwrap();
                let to_trusted_dependencies = to_lockfile.trusted_dependencies.as_ref().unwrap();

                {
                    // added
                    let mut to_trusted_iter = to_trusted_dependencies.iterator();
                    while let Some(entry) = to_trusted_iter.next() {
                        let to_trusted = *entry.key_ptr;
                        if !from_trusted_dependencies.contains(to_trusted) {
                            summary.added_trusted_dependencies.put(to_trusted, true)?;
                        }
                    }
                }

                {
                    // removed
                    let mut from_trusted_iter = from_trusted_dependencies.iterator();
                    while let Some(entry) = from_trusted_iter.next() {
                        let from_trusted = *entry.key_ptr;
                        if !to_trusted_dependencies.contains(from_trusted) {
                            summary.removed_trusted_dependencies.put(from_trusted, ())?;
                        }
                    }
                }

                break 'trusted_dependencies;
            }

            // 3
            if from_lockfile.trusted_dependencies.is_some()
                && to_lockfile.trusted_dependencies.is_none()
            {
                let from_trusted_dependencies =
                    from_lockfile.trusted_dependencies.as_ref().unwrap();

                {
                    // added
                    for entry in default_trusted_dependencies::entries() {
                        if !from_trusted_dependencies
                            .contains(entry.hash as TruncatedPackageNameHash)
                        {
                            // although this is a new trusted dependency, it is from the default
                            // list so it shouldn't be added to the lockfile
                            summary
                                .added_trusted_dependencies
                                .put(entry.hash as TruncatedPackageNameHash, false)?;
                        }
                    }
                }

                {
                    // removed
                    let mut from_trusted_iter = from_trusted_dependencies.iterator();
                    while let Some(entry) = from_trusted_iter.next() {
                        let from_trusted = *entry.key_ptr;
                        if !default_trusted_dependencies::has_with_hash(
                            u64::try_from(from_trusted).unwrap(),
                        ) {
                            summary.removed_trusted_dependencies.put(from_trusted, ())?;
                        }
                    }
                }

                break 'trusted_dependencies;
            }

            // 4
            if from_lockfile.trusted_dependencies.is_none()
                && to_lockfile.trusted_dependencies.is_some()
            {
                let to_trusted_dependencies = to_lockfile.trusted_dependencies.as_ref().unwrap();

                {
                    // add all to trusted dependencies, even if they exist in default because they weren't in the
                    // lockfile originally
                    let mut to_trusted_iter = to_trusted_dependencies.iterator();
                    while let Some(entry) = to_trusted_iter.next() {
                        let to_trusted = *entry.key_ptr;
                        summary.added_trusted_dependencies.put(to_trusted, true)?;
                    }
                }

                {
                    // removed
                    // none
                }

                break 'trusted_dependencies;
            }
        }

        summary.patched_dependencies_changed = 'patched_dependencies_changed: {
            if from_lockfile.patched_dependencies.entries.len()
                != to_lockfile.patched_dependencies.entries.len()
            {
                break 'patched_dependencies_changed true;
            }
            let mut iter = to_lockfile.patched_dependencies.iterator();
            while let Some(entry) = iter.next() {
                if let Some(val) = from_lockfile.patched_dependencies.get(*entry.key_ptr) {
                    if val.path.slice(from_lockfile.buffers.string_bytes.as_slice())
                        != entry
                            .value_ptr
                            .path
                            .slice(to_lockfile.buffers.string_bytes.as_slice())
                    {
                        break 'patched_dependencies_changed true;
                    }
                } else {
                    break 'patched_dependencies_changed true;
                }
            }
            let mut iter = from_lockfile.patched_dependencies.iterator();
            while let Some(entry) = iter.next() {
                if !to_lockfile.patched_dependencies.contains(*entry.key_ptr) {
                    break 'patched_dependencies_changed true;
                }
            }
            false
        };

        for (i, from_dep) in from_deps.iter().enumerate() {
            let found = 'found: {
                let prev_i = to_i;

                // common case, dependency is present in both versions:
                // - in the same position
                // - shifted by a constant offset
                while to_i < to_deps.len() {
                    if from_dep.name_hash == to_deps[to_i].name_hash {
                        let from_behavior = from_dep.behavior;
                        let to_behavior = to_deps[to_i].behavior;

                        if from_behavior != to_behavior {
                            to_i += 1;
                            continue;
                        }

                        break 'found true;
                    }
                    to_i += 1;
                }

                // less common, o(n^2) case
                to_i = 0;
                while to_i < prev_i {
                    if from_dep.name_hash == to_deps[to_i].name_hash {
                        let from_behavior = from_dep.behavior;
                        let to_behavior = to_deps[to_i].behavior;

                        if from_behavior != to_behavior {
                            to_i += 1;
                            continue;
                        }

                        break 'found true;
                    }
                    to_i += 1;
                }

                false
            };

            if !found {
                // We found a removed dependency!
                // We don't need to remove it
                // It will be cleaned up later
                summary.remove += 1;
                continue;
            }
            // defer to_i += 1; — applied at end of iteration body
            let cur_to_i = to_i;
            to_i += 1;

            if to_deps[cur_to_i].eql(
                from_dep,
                to_lockfile.buffers.string_bytes.as_slice(),
                from_lockfile.buffers.string_bytes.as_slice(),
            ) {
                if let Some(updates) = update_requests {
                    if updates.is_empty()
                        || 'brk: {
                            for request in updates {
                                if from_dep.name_hash == request.name_hash {
                                    break 'brk true;
                                }
                            }
                            false
                        }
                    {
                        // Listed as to be updated
                        summary.update += 1;
                        continue;
                    }
                }

                if let Some(mapping) = id_mapping.as_deref_mut() {
                    let update_mapping = 'update_mapping: {
                        if !is_root || !from_dep.behavior.is_workspace() {
                            break 'update_mapping true;
                        }

                        let Some(workspace_path) =
                            to_lockfile.workspace_paths.get_ptr(from_dep.name_hash)
                        else {
                            break 'update_mapping false;
                        };

                        let mut package_json_path: AbsPath =
                            AbsPath::init_top_level_dir(path::Sep::Auto);
                        // defer package_json_path.deinit(); — Drop handles it

                        package_json_path.append(
                            workspace_path
                                .slice(to_lockfile.buffers.string_bytes.as_slice()),
                        );
                        package_json_path.append(b"package.json");

                        let Ok(source_owned) =
                            File::to_source(package_json_path.slice_z(), Default::default())
                                .unwrap_result()
                        else {
                            break 'update_mapping false;
                        };
                        let source = &source_owned;

                        let mut workspace_pkg = Package::<SemverIntType>::default();

                        let Ok(json) = pm
                            .workspace_package_json_cache
                            .get_with_source(log, source, Default::default())
                            .unwrap_result()
                        else {
                            break 'update_mapping false;
                        };

                        let mut resolver: () = ();
                        workspace_pkg.parse_with_json::<(), { Features::WORKSPACE }>(
                            to_lockfile,
                            pm,
                            log,
                            source,
                            json.root,
                            &mut resolver,
                        )?;

                        to_deps =
                            to.dependencies.get(to_lockfile.buffers.dependencies.as_slice());

                        let mut from_pkg = from_lockfile.packages.get(from_resolutions[i]);
                        let diff = Self::generate(
                            pm,
                            log,
                            from_lockfile,
                            to_lockfile,
                            &mut from_pkg,
                            &mut workspace_pkg,
                            update_requests,
                            None,
                        )?;

                        if pm.options.log_level.is_verbose()
                            && (diff.add + diff.remove + diff.update) > 0
                        {
                            Output::pretty_errorln(format_args!(
                                "Workspace package \"{}\" has added <green>{}<r> dependencies, removed <red>{}<r> dependencies, and updated <cyan>{}<r> dependencies",
                                bstr::BStr::new(workspace_path.slice(to_lockfile.buffers.string_bytes.as_slice())),
                                diff.add,
                                diff.remove,
                                diff.update,
                            ));
                        }

                        !diff.has_diffs()
                    };

                    if update_mapping {
                        mapping[cur_to_i] = i as PackageID;
                        continue;
                    }
                } else {
                    continue;
                }
            }

            // We found a changed dependency!
            summary.update += 1;
        }

        // Use saturating arithmetic here because a migrated
        // package-lock.json could be out of sync with the package.json, so the
        // number of from_deps could be greater than to_deps.
        summary.add = (to_deps
            .len()
            .saturating_sub(from_deps.len().saturating_sub(summary.remove as usize)))
            as u32;

        if from.resolution.tag != lockfile::ResolutionTag::Root {
            // PERF(port): was `inline for` over Lockfile.Scripts.names — profile in Phase B
            for hook in lockfile::Scripts::NAMES {
                // TODO(port): @field reflection. Phase B: add `Scripts::field(name) -> &String`.
                if !to.scripts.field(hook).eql(
                    from.scripts.field(hook),
                    to_lockfile.buffers.string_bytes.as_slice(),
                    from_lockfile.buffers.string_bytes.as_slice(),
                ) {
                    // We found a changed life-cycle script
                    summary.update += 1;
                }
            }
        }

        Ok(summary)
    }
}

impl<SemverIntType> Package<SemverIntType> {
    pub fn hash(name: &[u8], version: SemverVersion) -> u64 {
        let mut hasher = bun_wyhash::Wyhash::init(0);
        hasher.update(name);
        // SAFETY: Semver.Version is POD; reading its raw bytes is sound.
        hasher.update(unsafe {
            core::slice::from_raw_parts(
                &version as *const _ as *const u8,
                mem::size_of::<SemverVersion>(),
            )
        });
        hasher.final_()
    }

    pub fn parse<R, const FEATURES: Features>(
        &mut self,
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        log: &mut logger::Log,
        source: &logger::Source,
        resolver: &mut R,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        initialize_store();
        let json = match bun_json::parse_package_json_utf8(source, log) {
            Ok(j) => j,
            Err(err) => {
                let _ = log.print(Output::error_writer());
                Output::pretty_errorln(format_args!(
                    "<r><red>{}<r> parsing package.json in <b>\"{}\"<r>",
                    err.name(),
                    bstr::BStr::new(source.path.pretty_dir()),
                ));
                Global::crash();
            }
        };

        self.parse_with_json::<R, FEATURES>(lockfile, pm, log, source, json, resolver)
    }

    // Zig: `comptime group: DependencyGroup`, `comptime features: Features`, `comptime tag: ?Dependency.Version.Tag`
    // PERF(port): was comptime monomorphization on `group`/`tag` — profile in Phase B
    fn parse_dependency<const FEATURES: Features>(
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        log: &mut logger::Log,
        source: &logger::Source,
        group: &DependencyGroup,
        string_builder: &mut StringBuilder,
        package_dependencies: &mut [Dependency],
        dependencies_count: u32,
        tag: Option<Dependency::version::Tag>,
        workspace_ver: Option<SemverVersion>,
        external_alias: ExternalString,
        version: &[u8],
        key_loc: logger::Loc,
        value_loc: logger::Loc,
    ) -> Result<Option<Dependency>, bun_core::Error> {
        // TODO(port): narrow error set
        let external_version = 'brk: {
            #[cfg(windows)]
            {
                match tag.unwrap_or_else(|| Dependency::version::Tag::infer(version)) {
                    Dependency::version::Tag::Workspace
                    | Dependency::version::Tag::Folder
                    | Dependency::version::Tag::Symlink
                    | Dependency::version::Tag::Tarball => {
                        if String::can_inline(version) {
                            let mut copy = string_builder.append::<String>(version);
                            path::dangerously_convert_path_to_posix_in_place::<u8>(
                                &mut copy.bytes,
                            );
                            break 'brk copy;
                        } else {
                            let str_ = string_builder.append::<String>(version);
                            let ptr = str_.ptr();
                            path::dangerously_convert_path_to_posix_in_place::<u8>(
                                &mut lockfile.buffers.string_bytes
                                    [ptr.off as usize..(ptr.off + ptr.len) as usize],
                            );
                            break 'brk str_;
                        }
                    }
                    _ => {}
                }
            }

            string_builder.append::<String>(version)
        };

        let buf = lockfile.buffers.string_bytes.as_slice();
        let sliced = external_version.sliced(buf);

        let mut dependency_version = Dependency::parse_with_optional_tag(
            external_alias.value,
            external_alias.hash,
            sliced.slice,
            tag,
            &sliced,
            log,
            pm,
        )
        .unwrap_or_default();
        let mut workspace_range: Option<semver::query::Group> = None;
        let name_hash = match dependency_version.tag {
            Dependency::version::Tag::Npm => {
                String::Builder::string_hash(dependency_version.value.npm.name.slice(buf))
            }
            Dependency::version::Tag::Workspace => {
                if strings::has_prefix(sliced.slice, b"workspace:") {
                    'brk: {
                        let input = &sliced.slice[b"workspace:".len()..];
                        let trimmed = strings::trim(input, strings::WHITESPACE_CHARS);
                        if trimmed.len() != 1
                            || (trimmed[0] != b'*' && trimmed[0] != b'^' && trimmed[0] != b'~')
                        {
                            let at = strings::last_index_of_char(input, b'@').unwrap_or(0);
                            if at > 0 {
                                workspace_range = Some(
                                    semver::query::parse(&input[at + 1..], sliced)
                                        .unwrap_or_else(|_| bun_core::out_of_memory()),
                                );
                                break 'brk String::Builder::string_hash(&input[0..at]);
                            }
                            workspace_range = Some(
                                semver::query::parse(input, sliced)
                                    .unwrap_or_else(|_| bun_core::out_of_memory()),
                            );
                        }
                        external_alias.hash
                    }
                } else {
                    external_alias.hash
                }
            }
            _ => external_alias.hash,
        };

        let mut workspace_path: Option<String> = None;
        let mut workspace_version = workspace_ver;
        if tag.is_none() {
            workspace_path = lockfile.workspace_paths.get(name_hash);
            workspace_version = lockfile.workspace_versions.get(name_hash);
        }

        if tag.is_some() {
            debug_assert!(
                dependency_version.tag != Dependency::version::Tag::Npm
                    && dependency_version.tag != Dependency::version::Tag::DistTag
            );
        }

        match dependency_version.tag {
            Dependency::version::Tag::Folder => {
                let relative = path::relative(
                    FileSystem::instance().top_level_dir,
                    path::join_abs_string(
                        FileSystem::instance().top_level_dir,
                        &[
                            source.path.name.dir,
                            dependency_version.value.folder.slice(buf),
                        ],
                        path::Platform::Auto,
                    ),
                );
                // if relative is empty, we are linking the package to itself
                dependency_version.value.folder = string_builder
                    .append::<String>(if relative.is_empty() { b"." } else { relative });
            }
            Dependency::version::Tag::Npm => {
                let npm = dependency_version.value.npm;
                if workspace_version.is_some() {
                    if pm.options.link_workspace_packages
                        && npm.version.satisfies(workspace_version.unwrap(), buf, buf)
                    {
                        let path = workspace_path.unwrap().sliced(buf);
                        if let Some(dep) = Dependency::parse_with_tag(
                            external_alias.value,
                            external_alias.hash,
                            path.slice,
                            Dependency::version::Tag::Workspace,
                            &path,
                            log,
                            pm,
                        ) {
                            dependency_version.tag = dep.tag;
                            dependency_version.value = dep.value;
                        }
                    } else {
                        // It doesn't satisfy, but a workspace shares the same name. Override the workspace with the other dependency
                        for dep in &mut package_dependencies[0..dependencies_count as usize] {
                            if dep.name_hash == name_hash && dep.behavior.is_workspace() {
                                *dep = Dependency {
                                    behavior: group.behavior,
                                    name: external_alias.value,
                                    name_hash: external_alias.hash,
                                    version: dependency_version,
                                };
                                return Ok(None);
                            }
                        }
                    }
                }
            }
            Dependency::version::Tag::Workspace => 'workspace: {
                if let Some(path) = workspace_path {
                    if let Some(range) = &workspace_range {
                        if let Some(ver) = workspace_version {
                            if range.satisfies(ver, buf, buf) {
                                dependency_version.value.workspace = path;
                                break 'workspace;
                            }
                        }

                        // important to trim before len == 0 check. `workspace:foo@      ` should install successfully
                        let version_literal =
                            strings::trim(range.input, strings::WHITESPACE_CHARS);
                        if version_literal.is_empty()
                            || range.is_star()
                            || SemverVersion::is_tagged_version_only(version_literal)
                        {
                            dependency_version.value.workspace = path;
                            break 'workspace;
                        }

                        // workspace is not required to have a version, but if it does
                        // and this version doesn't match it, fail to install
                        log.add_error_fmt(
                            source,
                            logger::Loc::EMPTY,
                            format_args!(
                                "No matching version for workspace dependency \"{}\". Version: \"{}\"",
                                bstr::BStr::new(external_alias.slice(buf)),
                                bstr::BStr::new(dependency_version.literal.slice(buf)),
                            ),
                        )?;
                        return Err(bun_core::err!("InstallFailed"));
                    }

                    dependency_version.value.workspace = path;
                } else {
                    let workspace = dependency_version.value.workspace.slice(buf);
                    let path = string_builder.append::<String>(if workspace == b"*" {
                        b"*"
                    } else {
                        'brk: {
                            let mut buf2 = PathBuffer::uninit();
                            let rel = path::relative_platform(
                                FileSystem::instance().top_level_dir,
                                path::join_abs_string_buf(
                                    FileSystem::instance().top_level_dir,
                                    &mut buf2,
                                    &[source.path.name.dir, workspace],
                                    path::Platform::Auto,
                                ),
                                path::Platform::Auto,
                                false,
                            );
                            #[cfg(windows)]
                            {
                                path::dangerously_convert_path_to_posix_in_place::<u8>(
                                    &mut path::relative_to_common_path_buf()[0..rel.len()],
                                );
                            }
                            break 'brk rel;
                        }
                    });
                    if cfg!(debug_assertions) {
                        debug_assert!(path.len() > 0);
                        debug_assert!(!bun_paths::is_absolute(path.slice(buf)));
                    }
                    dependency_version.value.workspace = path;

                    let workspace_entry = lockfile.workspace_paths.get_or_put(name_hash)?;
                    let found_matching_workspace = workspace_entry.found_existing;

                    if let Some(ver) = workspace_version {
                        lockfile.workspace_versions.put(name_hash, ver)?;
                        for package_dep in
                            &mut package_dependencies[0..dependencies_count as usize]
                        {
                            if match package_dep.version.tag {
                                // `dependencies` & `workspaces` defined within the same `package.json`
                                Dependency::version::Tag::Npm => {
                                    String::Builder::string_hash(
                                        package_dep.realname().slice(buf),
                                    ) == name_hash
                                        && package_dep
                                            .version
                                            .value
                                            .npm
                                            .version
                                            .satisfies(ver, buf, buf)
                                }
                                // `workspace:*`
                                Dependency::version::Tag::Workspace => {
                                    found_matching_workspace
                                        && String::Builder::string_hash(
                                            package_dep.realname().slice(buf),
                                        ) == name_hash
                                }
                                _ => false,
                            } {
                                package_dep.version = dependency_version;
                                *workspace_entry.value_ptr = path;
                                return Ok(None);
                            }
                        }
                    } else if workspace_entry.found_existing {
                        for package_dep in
                            &mut package_dependencies[0..dependencies_count as usize]
                        {
                            if package_dep.version.tag == Dependency::version::Tag::Workspace
                                && String::Builder::string_hash(
                                    package_dep.realname().slice(buf),
                                ) == name_hash
                            {
                                package_dep.version = dependency_version;
                                return Ok(None);
                            }
                        }
                        return Err(bun_core::err!("InstallFailed"));
                    }

                    *workspace_entry.value_ptr = path;
                }
            }
            _ => {}
        }

        let this_dep = Dependency {
            behavior: group.behavior,
            name: external_alias.value,
            name_hash: external_alias.hash,
            version: dependency_version,
        };

        // `peerDependencies` may be specified on existing dependencies. Packages in `workspaces` are deduplicated when
        // the array is processed
        if FEATURES.check_for_duplicate_dependencies
            && !group.behavior.is_peer()
            && !group.behavior.is_workspace()
        {
            // PERF(port): was assume_capacity
            let entry = lockfile
                .scratch
                .duplicate_checker_map
                .get_or_put_assume_capacity(external_alias.hash);
            if entry.found_existing {
                // duplicate dependencies are allowed in optionalDependencies
                if group.behavior.is_optional() {
                    for package_dep in &mut package_dependencies[0..dependencies_count as usize]
                    {
                        if package_dep.name_hash == this_dep.name_hash {
                            *package_dep = this_dep;
                            break;
                        }
                    }
                    return Ok(None);
                } else {
                    let mut notes: Vec<logger::Data> = Vec::with_capacity(1);

                    let mut text = Vec::new();
                    {
                        use std::io::Write;
                        let _ = write!(
                            &mut text,
                            "\"{}\" originally specified here",
                            bstr::BStr::new(external_alias.slice(buf))
                        );
                    }
                    notes.push(logger::Data {
                        text: text.into_boxed_slice(),
                        location: logger::Location::init_or_null(
                            source,
                            source.range_of_string(*entry.value_ptr),
                        ),
                    });

                    log.add_range_warning_fmt_with_notes(
                        source,
                        source.range_of_string(key_loc),
                        notes,
                        format_args!(
                            "Duplicate dependency: \"{}\" specified in package.json",
                            bstr::BStr::new(external_alias.slice(buf))
                        ),
                    )?;
                }
            }

            *entry.value_ptr = value_loc;
        }

        Ok(Some(this_dep))
    }

    pub fn parse_with_json<R, const FEATURES: Features>(
        &mut self,
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        log: &mut logger::Log,
        source: &logger::Source,
        json: Expr,
        resolver: &mut R,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // TODO(port): `R` needs a trait covering `count`, `resolve`, `check_bundled_dependencies`,
        // and the `GitResolver`-specific fields. Zig used `comptime ResolverContext: type` +
        // `@hasDecl`-style structural checks. Phase B should define `trait ResolverContext`.
        let mut string_builder = lockfile.string_builder();
        let mut total_dependencies_count: u32 = 0;

        self.meta.origin = if FEATURES.is_main {
            install::Origin::Local
        } else {
            install::Origin::Npm
        };
        self.name = String::default();
        self.name_hash = 0;

        // -- Count the sizes
        'name: {
            if let Some(name_q) = json.as_property(b"name") {
                if let Some(name) = name_q.expr.as_string() {
                    if !name.is_empty() {
                        string_builder.count(name);
                        break 'name;
                    }
                }
            }

            // name is not validated by npm, so fallback to creating a new from the version literal
            // TODO(port): Zig checks `if (ResolverContext == PackageManager.GitResolver)`.
            // Phase B: gate via trait `R::IS_GIT_RESOLVER` const or downcast.
            if R::IS_GIT_RESOLVER {
                let resolution: &Resolution<SemverIntType> = resolver.resolution();
                let repo = match resolution.tag {
                    lockfile::ResolutionTag::Git => resolution.value.git,
                    lockfile::ResolutionTag::Github => resolution.value.github,
                    _ => break 'name,
                };

                resolver.set_new_name(Repository::create_dependency_name_from_version_literal(
                    &repo,
                    lockfile,
                    resolver.dep_id(),
                ));

                string_builder.count(resolver.new_name());
            }
        }

        if let Some(patched_deps) = json.as_property(b"patchedDependencies") {
            let obj = patched_deps.expr.data.e_object();
            for prop in obj.properties.slice() {
                let key = prop.key.unwrap();
                let value = prop.value.unwrap();
                if key.is_string() && value.is_string() {
                    string_builder.count(value.as_string().unwrap());
                }
            }
        }

        if !FEATURES.is_main {
            if let Some(version_q) = json.as_property(b"version") {
                if let Some(version_str) = version_q.expr.as_string() {
                    string_builder.count(version_str);
                }
            }
        }
        'bin: {
            if let Some(bin) = json.as_property(b"bin") {
                match &bin.expr.data {
                    bun_js_parser::ast::ExprData::EObject(obj) => {
                        for bin_prop in obj.properties.slice() {
                            let Some(k) = bin_prop.key.unwrap().as_string() else {
                                break 'bin;
                            };
                            string_builder.count(k);
                            let Some(v) = bin_prop.value.unwrap().as_string() else {
                                break 'bin;
                            };
                            string_builder.count(v);
                        }
                        break 'bin;
                    }
                    bun_js_parser::ast::ExprData::EString(_) => {
                        if let Some(str_) = bin.expr.as_string() {
                            string_builder.count(str_);
                            break 'bin;
                        }
                    }
                    _ => {}
                }
            }

            if let Some(dirs) = json.as_property(b"directories") {
                if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                    if let Some(str_) = bin_prop.expr.as_string() {
                        string_builder.count(str_);
                        break 'bin;
                    }
                }
            }
        }

        Scripts::parse_count(&mut string_builder, &json);

        // TODO(port): Zig `if (comptime ResolverContext != void)`. Phase B: trait method
        // with default no-op so `()` doesn't call it.
        if !R::IS_VOID {
            resolver.count(&mut string_builder, &json);
        }

        // PERF(port): was comptime-computed array — profile in Phase B
        let dependency_groups: Vec<DependencyGroup> = {
            let mut out: Vec<DependencyGroup> = Vec::with_capacity(5);
            if FEATURES.workspaces {
                out.push(DependencyGroup::WORKSPACES);
            }
            if FEATURES.dependencies {
                out.push(DependencyGroup::DEPENDENCIES);
            }
            if FEATURES.dev_dependencies {
                out.push(DependencyGroup::DEV);
            }
            if FEATURES.optional_dependencies {
                out.push(DependencyGroup::OPTIONAL);
            }
            if FEATURES.peer_dependencies {
                out.push(DependencyGroup::PEER);
            }
            out
        };

        let mut workspace_names = WorkspaceMap::init();
        // defer workspace_names.deinit(); — Drop handles it

        // pnpm/yarn synthesise an implicit `"*"` optional peer for entries
        // that appear in `peerDependenciesMeta` but not in
        // `peerDependencies`. Track the original key string so the
        // post-build pass can emit a real `Dependency` for any meta-only
        // names that nothing in the build loop consumed.
        let mut optional_peer_dependencies: ArrayHashMap<
            PackageNameHash,
            &[u8],
            ArrayIdentityContext::U64,
        > = ArrayHashMap::default();
        // defer optional_peer_dependencies.deinit(); — Drop handles it

        if FEATURES.peer_dependencies {
            if let Some(peer_dependencies_meta) = json.as_property(b"peerDependenciesMeta") {
                if let bun_js_parser::ast::ExprData::EObject(obj) =
                    &peer_dependencies_meta.expr.data
                {
                    let props = obj.properties.slice();
                    optional_peer_dependencies.ensure_unused_capacity(props.len())?;
                    for prop in props {
                        if let Some(optional) = prop.value.unwrap().as_property(b"optional") {
                            if !matches!(
                                &optional.expr.data,
                                bun_js_parser::ast::ExprData::EBoolean(b) if b.value
                            ) {
                                continue;
                            }

                            let key = prop.key.unwrap().as_string().expect("unreachable");
                            // PERF(port): was assume_capacity
                            optional_peer_dependencies.put_assume_capacity(
                                String::Builder::string_hash(key),
                                key,
                            );
                            // Reserve space for a synthesised entry. If the
                            // matching name later appears in `peerDependencies`
                            // the slot just goes unused.
                            string_builder.count(key);
                            string_builder.count(b"*");
                            total_dependencies_count += 1;
                        }
                    }
                }
            }
        }

        // PERF(port): was `inline for` — profile in Phase B
        for group in &dependency_groups {
            if let Some(dependencies_q) = json.as_property(group.prop) {
                'brk: {
                    match &dependencies_q.expr.data {
                        bun_js_parser::ast::ExprData::EArray(arr) => {
                            if !group.behavior.is_workspace() {
                                let _ = log.add_error_fmt(
                                    source,
                                    dependencies_q.loc,
                                    format_args!(
                                        "{0} expects a map of specifiers, e.g.\n  <r><green>\"{0}\"<r>: {{\n    <green>\"bun\"<r>: <green>\"latest\"<r>\n  }}",
                                        bstr::BStr::new(group.prop)
                                    ),
                                );
                                return Err(bun_core::err!("InvalidPackageJSON"));
                            }
                            total_dependencies_count += workspace_names.process_names_array(
                                &mut pm.workspace_package_json_cache,
                                log,
                                arr,
                                source,
                                dependencies_q.loc,
                                &mut string_builder,
                            )?;
                        }
                        bun_js_parser::ast::ExprData::EObject(obj) => {
                            if group.behavior.is_workspace() {
                                // yarn workspaces expects a "workspaces" property shaped like this:
                                //
                                //    "workspaces": {
                                //        "packages": [
                                //           "path/to/package"
                                //        ]
                                //    }
                                //
                                if let Some(packages_query) = obj.get(b"packages") {
                                    if !matches!(
                                        packages_query.data,
                                        bun_js_parser::ast::ExprData::EArray(_)
                                    ) {
                                        let _ = log.add_error_fmt(
                                            source,
                                            packages_query.loc,
                                            // TODO: what if we could comptime call the syntax highlighter
                                            format_args!(
                                                "\"workspaces.packages\" expects an array of strings, e.g.\n  \"workspaces\": {{\n    \"packages\": [\n      \"path/to/package\"\n    ]\n  }}"
                                            ),
                                        );
                                        return Err(bun_core::err!("InvalidPackageJSON"));
                                    }
                                    total_dependencies_count += workspace_names
                                        .process_names_array(
                                            &mut pm.workspace_package_json_cache,
                                            log,
                                            packages_query.data.e_array(),
                                            source,
                                            packages_query.loc,
                                            &mut string_builder,
                                        )?;
                                }

                                break 'brk;
                            }
                            for item in obj.properties.slice() {
                                let key = item.key.unwrap().as_string().unwrap();
                                let Some(value) = item.value.unwrap().as_string() else {
                                    let _ = log.add_error_fmt(
                                        source,
                                        item.value.unwrap().loc,
                                        // TODO: what if we could comptime call the syntax highlighter
                                        format_args!(
                                            "{0} expects a map of specifiers, e.g.\n  <r><green>\"{0}\"<r>: {{\n    <green>\"bun\"<r>: <green>\"latest\"<r>\n  }}",
                                            bstr::BStr::new(group.prop)
                                        ),
                                    );
                                    return Err(bun_core::err!("InvalidPackageJSON"));
                                };

                                string_builder.count(key);
                                string_builder.count(value);

                                // If it's a folder or workspace, pessimistically assume we will need a maximum path
                                match Dependency::version::Tag::infer(value) {
                                    Dependency::version::Tag::Folder
                                    | Dependency::version::Tag::Workspace => {
                                        string_builder.cap += MAX_PATH_BYTES;
                                    }
                                    _ => {}
                                }
                            }
                            total_dependencies_count += obj.properties.len as u32;
                        }
                        _ => {
                            if group.behavior.is_workspace() {
                                let _ = log.add_error_fmt(
                                    source,
                                    dependencies_q.loc,
                                    // TODO: what if we could comptime call the syntax highlighter
                                    format_args!(
                                        "\"workspaces\" expects an array of strings, e.g.\n  <r><green>\"workspaces\"<r>: [\n    <green>\"path/to/package\"<r>\n  ]"
                                    ),
                                );
                            } else {
                                let _ = log.add_error_fmt(
                                    source,
                                    dependencies_q.loc,
                                    format_args!(
                                        "{0} expects a map of specifiers, e.g.\n  <r><green>\"{0}\"<r>: {{\n    <green>\"bun\"<r>: <green>\"latest\"<r>\n  }}",
                                        bstr::BStr::new(group.prop)
                                    ),
                                );
                            }
                            return Err(bun_core::err!("InvalidPackageJSON"));
                        }
                    }
                }
            }
        }

        if FEATURES.trusted_dependencies {
            if let Some(q) = json.as_property(b"trustedDependencies") {
                match &q.expr.data {
                    bun_js_parser::ast::ExprData::EArray(arr) => {
                        if lockfile.trusted_dependencies.is_none() {
                            lockfile.trusted_dependencies = Some(Default::default());
                        }
                        lockfile
                            .trusted_dependencies
                            .as_mut()
                            .unwrap()
                            .ensure_unused_capacity(arr.items.len())?;
                        for item in arr.slice() {
                            let Some(name) = item.as_string() else {
                                let _ = log.add_error_fmt(
                                    source,
                                    q.loc,
                                    format_args!(
                                        "trustedDependencies expects an array of strings, e.g.\n  <r><green>\"trustedDependencies\"<r>: [\n    <green>\"package_name\"<r>\n  ]"
                                    ),
                                );
                                return Err(bun_core::err!("InvalidPackageJSON"));
                            };
                            // PERF(port): was assume_capacity
                            lockfile
                                .trusted_dependencies
                                .as_mut()
                                .unwrap()
                                .put_assume_capacity(
                                    String::Builder::string_hash(name)
                                        as TruncatedPackageNameHash,
                                    (),
                                );
                        }
                    }
                    _ => {
                        let _ = log.add_error_fmt(
                            source,
                            q.loc,
                            format_args!(
                                "trustedDependencies expects an array of strings, e.g.\n  <r><green>\"trustedDependencies\"<r>: [\n    <green>\"package_name\"<r>\n  ]"
                            ),
                        );
                        return Err(bun_core::err!("InvalidPackageJSON"));
                    }
                }
            }
        }

        if FEATURES.is_main {
            lockfile.overrides.parse_count(lockfile, &json, &mut string_builder);

            if let Some(workspaces_expr) = json.get(b"workspaces") {
                lockfile
                    .catalogs
                    .parse_count(lockfile, &workspaces_expr, &mut string_builder);
            }

            // Count catalog strings in top-level package.json as well, since parseAppend
            // might process them later if no catalogs were found in workspaces
            lockfile.catalogs.parse_count(lockfile, &json, &mut string_builder);

            install::PostinstallOptimizer::from_package_json(
                &mut pm.postinstall_optimizer,
                &json,
            )?;
        }

        string_builder.allocate()?;
        lockfile
            .buffers
            .dependencies
            .reserve(total_dependencies_count as usize);
        lockfile
            .buffers
            .resolutions
            .reserve(total_dependencies_count as usize);

        let off = lockfile.buffers.dependencies.len();
        let total_len = off + total_dependencies_count as usize;
        if cfg!(debug_assertions) {
            debug_assert!(
                lockfile.buffers.dependencies.len() == lockfile.buffers.resolutions.len()
            );
        }

        // SAFETY: capacity reserved above; slots are written before read.
        unsafe { lockfile.buffers.dependencies.set_len(total_len) };
        let package_dependencies = &mut lockfile.buffers.dependencies[off..total_len];
        // PORT NOTE: reshaped for borrowck — `package_dependencies` borrows
        // `lockfile.buffers.dependencies` mutably; subsequent uses of `lockfile` below
        // re-borrow as needed.
        // TODO(port): the original Zig holds `package_dependencies` as a raw slice into the
        // dependencies buffer while also mutating `lockfile.buffers.string_bytes` etc. Phase B
        // may need to thread raw pointers here for borrowck.

        'name: {
            if R::IS_GIT_RESOLVER {
                if !resolver.new_name().is_empty() {
                    let new_name = resolver.take_new_name();
                    let external_string =
                        string_builder.append::<ExternalString>(&new_name);
                    self.name = external_string.value;
                    self.name_hash = external_string.hash;
                    break 'name;
                }
            }

            if let Some(name_q) = json.as_property(b"name") {
                if let Some(name) = name_q.expr.as_string() {
                    if !name.is_empty() {
                        let external_string = string_builder.append::<ExternalString>(name);

                        self.name = external_string.value;
                        self.name_hash = external_string.hash;
                        break 'name;
                    }
                }
            }
        }

        if !FEATURES.is_main {
            if !R::IS_VOID {
                self.resolution = resolver.resolve(&mut string_builder, &json)?;
            }
        } else {
            self.resolution = Resolution::<SemverIntType> {
                tag: lockfile::ResolutionTag::Root,
                value: lockfile::ResolutionValue::root(),
            };
        }

        if let Some(patched_deps) = json.as_property(b"patchedDependencies") {
            let obj = patched_deps.expr.data.e_object();
            lockfile
                .patched_dependencies
                .ensure_total_capacity(obj.properties.len)
                .expect("unreachable");
            for prop in obj.properties.slice() {
                let key = prop.key.unwrap();
                let value = prop.value.unwrap();
                if key.is_string() && value.is_string() {
                    // PERF(port): was stack-fallback
                    let keyhash = key
                        .as_string_hash(String::Builder::string_hash)?
                        .expect("unreachable");
                    let patch_path =
                        string_builder.append::<String>(value.as_string().unwrap());
                    lockfile
                        .patched_dependencies
                        .put(keyhash, lockfile::PatchedDependency { path: patch_path })
                        .expect("unreachable");
                }
            }
        }

        'bin: {
            if let Some(bin) = json.as_property(b"bin") {
                match &bin.expr.data {
                    bun_js_parser::ast::ExprData::EObject(obj) => {
                        match obj.properties.len {
                            0 => {}
                            1 => {
                                let Some(bin_name) =
                                    obj.properties.ptr[0].key.unwrap().as_string()
                                else {
                                    break 'bin;
                                };
                                let Some(value) =
                                    obj.properties.ptr[0].value.unwrap().as_string()
                                else {
                                    break 'bin;
                                };

                                self.bin = Bin {
                                    tag: Bin::Tag::NamedFile,
                                    value: Bin::Value::named_file([
                                        string_builder.append::<String>(bin_name),
                                        string_builder.append::<String>(value),
                                    ]),
                                };
                            }
                            _ => {
                                let current_len = lockfile.buffers.extern_strings.len();
                                let count = obj.properties.len as usize * 2;
                                lockfile
                                    .buffers
                                    .extern_strings
                                    .reserve_exact(count);
                                // SAFETY: capacity reserved above; slots written in loop below.
                                unsafe {
                                    lockfile
                                        .buffers
                                        .extern_strings
                                        .set_len(current_len + count);
                                }
                                let extern_strings = &mut lockfile.buffers.extern_strings
                                    [current_len..current_len + count];

                                let mut i: usize = 0;
                                for bin_prop in obj.properties.slice() {
                                    let Some(k) = bin_prop.key.unwrap().as_string() else {
                                        break 'bin;
                                    };
                                    extern_strings[i] =
                                        string_builder.append::<ExternalString>(k);
                                    i += 1;
                                    let Some(v) = bin_prop.value.unwrap().as_string() else {
                                        break 'bin;
                                    };
                                    extern_strings[i] =
                                        string_builder.append::<ExternalString>(v);
                                    i += 1;
                                }
                                if cfg!(debug_assertions) {
                                    debug_assert!(i == extern_strings.len());
                                }
                                self.bin = Bin {
                                    tag: Bin::Tag::Map,
                                    value: Bin::Value::map(ExternalStringList::init(
                                        lockfile.buffers.extern_strings.as_slice(),
                                        extern_strings,
                                    )),
                                };
                            }
                        }

                        break 'bin;
                    }
                    bun_js_parser::ast::ExprData::EString(stri) => {
                        if !stri.data.is_empty() {
                            self.bin = Bin {
                                tag: Bin::Tag::File,
                                value: Bin::Value::file(
                                    string_builder.append::<String>(&stri.data),
                                ),
                            };
                            break 'bin;
                        }
                    }
                    _ => {}
                }
            }

            if let Some(dirs) = json.as_property(b"directories") {
                // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                // Because of the way the bin directive works,
                // specifying both a bin path and setting
                // directories.bin is an error. If you want to
                // specify individual files, use bin, and for all
                // the files in an existing bin directory, use
                // directories.bin.
                if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                    if let Some(str_) = bin_prop.expr.as_string() {
                        if !str_.is_empty() {
                            self.bin = Bin {
                                tag: Bin::Tag::Dir,
                                value: Bin::Value::dir(
                                    string_builder.append::<String>(str_),
                                ),
                            };
                            break 'bin;
                        }
                    }
                }
            }
        }

        self.scripts.parse_alloc(&mut string_builder, &json);
        self.scripts.filled = true;

        // It is allowed for duplicate dependencies to exist in optionalDependencies and regular dependencies
        if FEATURES.check_for_duplicate_dependencies {
            lockfile.scratch.duplicate_checker_map.clear();
            lockfile
                .scratch
                .duplicate_checker_map
                .ensure_total_capacity(total_dependencies_count as usize)?;
        }

        let mut bundled_deps = StringSet::init();
        // defer bundled_deps.deinit(); — Drop handles it
        let mut bundle_all_deps = false;
        if !R::IS_VOID && R::check_bundled_dependencies() {
            if let Some(bundled_deps_expr) = json
                .get(b"bundleDependencies")
                .or_else(|| json.get(b"bundledDependencies"))
            {
                match &bundled_deps_expr.data {
                    bun_js_parser::ast::ExprData::EBoolean(boolean) => {
                        bundle_all_deps = boolean.value;
                    }
                    bun_js_parser::ast::ExprData::EArray(arr) => {
                        for item in arr.slice() {
                            let Some(s) = item.as_string() else { continue };
                            bundled_deps.insert(s)?;
                        }
                    }
                    _ => {}
                }
            }
        }

        total_dependencies_count = 0;

        // PERF(port): was `inline for` — profile in Phase B
        for group in &dependency_groups {
            if group.behavior.is_workspace() {
                let mut seen_workspace_names = TrustedDependenciesSet::default();
                // defer seen_workspace_names.deinit(allocator); — Drop handles it
                for (entry, path_) in workspace_names
                    .values()
                    .iter()
                    .zip(workspace_names.keys().iter())
                {
                    // workspace names from their package jsons. duplicates not allowed
                    let gop = seen_workspace_names.get_or_put(
                        String::Builder::string_hash(&entry.name)
                            as TruncatedPackageNameHash,
                    )?;
                    if gop.found_existing {
                        // this path does alot of extra work to format the error message
                        // but this is ok because the install is going to fail anyways, so this
                        // has zero effect on the happy path.
                        let mut cwd_buf = PathBuffer::uninit();
                        let cwd = bun_sys::getcwd(&mut cwd_buf)?;

                        let num_notes = 'count: {
                            let mut i: usize = 0;
                            for value in workspace_names.values() {
                                if strings::eql_long(&value.name, &entry.name, true) {
                                    i += 1;
                                }
                            }
                            break 'count i;
                        };
                        let notes = 'notes: {
                            let mut notes: Vec<logger::Data> =
                                Vec::with_capacity(num_notes);
                            let mut i: usize = 0;
                            for (value, note_path) in workspace_names
                                .values()
                                .iter()
                                .zip(workspace_names.keys().iter())
                            {
                                if note_path.as_ptr() == path_.as_ptr() {
                                    continue;
                                }
                                if strings::eql_long(&value.name, &entry.name, true) {
                                    let note_abs_path = path::join_abs_string_z(
                                        cwd,
                                        &[note_path, b"package.json"],
                                        path::Platform::Auto,
                                    )
                                    .to_vec()
                                    .into_boxed_slice();

                                    let note_src = File::to_source(
                                        &note_abs_path,
                                        Default::default(),
                                    )
                                    .unwrap_result()
                                    .unwrap_or_else(|_| {
                                        logger::Source::init_empty_file(&note_abs_path)
                                    });

                                    notes.push(logger::Data {
                                        text: b"Package name is also declared here"
                                            .to_vec()
                                            .into_boxed_slice(),
                                        location: logger::Location::init_or_null(
                                            &note_src,
                                            note_src.range_of_string(value.name_loc),
                                        ),
                                    });
                                    i += 1;
                                }
                            }
                            notes.truncate(i);
                            break 'notes notes;
                        };

                        let abs_path = path::join_abs_string_z(
                            cwd,
                            &[path_, b"package.json"],
                            path::Platform::Auto,
                        );

                        let src = File::to_source(abs_path, Default::default())
                            .unwrap_result()
                            .unwrap_or_else(|_| logger::Source::init_empty_file(abs_path));

                        let _ = log.add_range_error_fmt_with_notes(
                            &src,
                            src.range_of_string(entry.name_loc),
                            notes,
                            format_args!(
                                "Workspace name \"{}\" already exists",
                                bstr::BStr::new(&entry.name),
                            ),
                        );
                        return Err(bun_core::err!("InstallFailed"));
                    }

                    let external_name =
                        string_builder.append::<ExternalString>(&entry.name);

                    let workspace_version = 'brk: {
                        if let Some(version_string) = &entry.version {
                            let external_version =
                                string_builder.append::<ExternalString>(version_string);
                            // allocator.free(version_string); — Drop handles it (Box<[u8]>)
                            let sliced = external_version
                                .value
                                .sliced(lockfile.buffers.string_bytes.as_slice());
                            let result = SemverVersion::parse(sliced);
                            if result.valid && result.wildcard == semver::Wildcard::None {
                                break 'brk Some(result.version.min());
                            }
                        }

                        None
                    };

                    if let Some(dep_) = Self::parse_dependency::<FEATURES>(
                        lockfile,
                        pm,
                        log,
                        source,
                        group,
                        &mut string_builder,
                        package_dependencies,
                        total_dependencies_count,
                        Some(Dependency::version::Tag::Workspace),
                        workspace_version,
                        external_name,
                        path_,
                        logger::Loc::EMPTY,
                        logger::Loc::EMPTY,
                    )? {
                        let mut dep = dep_;
                        if group.behavior.is_peer()
                            && optional_peer_dependencies.swap_remove(external_name.hash)
                        {
                            dep.behavior = dep.behavior.add(Behavior::OPTIONAL);
                        }

                        package_dependencies[total_dependencies_count as usize] = dep;
                        total_dependencies_count += 1;

                        lockfile
                            .workspace_paths
                            .put(external_name.hash, dep.version.value.workspace)?;
                        if let Some(version) = workspace_version {
                            lockfile
                                .workspace_versions
                                .put(external_name.hash, version)?;
                        }
                    }
                }
            } else {
                if let Some(dependencies_q) = json.as_property(group.prop) {
                    match &dependencies_q.expr.data {
                        bun_js_parser::ast::ExprData::EObject(obj) => {
                            for item in obj.properties.slice() {
                                let key = item.key.unwrap();
                                let value = item.value.unwrap();
                                let external_name = string_builder
                                    .append::<ExternalString>(key.as_string().unwrap());
                                let version = value.as_string().unwrap_or(b"");

                                if let Some(dep_) = Self::parse_dependency::<FEATURES>(
                                    lockfile,
                                    pm,
                                    log,
                                    source,
                                    group,
                                    &mut string_builder,
                                    package_dependencies,
                                    total_dependencies_count,
                                    None,
                                    None,
                                    external_name,
                                    version,
                                    key.loc,
                                    value.loc,
                                )? {
                                    let mut dep = dep_;
                                    // swapRemove (not contains): drain names that
                                    // have a real `peerDependencies` entry so the
                                    // meta-only synthesis pass below only sees
                                    // names that appear *only* in
                                    // `peerDependenciesMeta`.
                                    if group.behavior.is_peer()
                                        && optional_peer_dependencies
                                            .swap_remove(external_name.hash)
                                    {
                                        dep.behavior.optional = true;
                                    }

                                    if bundle_all_deps
                                        || bundled_deps.contains(dep.name.slice(
                                            lockfile.buffers.string_bytes.as_slice(),
                                        ))
                                    {
                                        dep.behavior.bundled = true;
                                    }

                                    package_dependencies
                                        [total_dependencies_count as usize] = dep;
                                    total_dependencies_count += 1;
                                }
                            }
                        }
                        _ => unreachable!(),
                    }
                }
            }
        }

        // Anything left in `optional_peer_dependencies` was listed only in
        // `peerDependenciesMeta`. Synthesise an optional peer dep with
        // version `"*"` so resolution can pick up a sibling install when
        // one exists (matching pnpm/yarn). Webpack relies on this for
        // `webpack-cli`, which it lists in meta but not in
        // `peerDependencies`.
        let mut meta_only = optional_peer_dependencies.iterator();
        while let Some(entry) = meta_only.next() {
            let external_name = string_builder.append::<ExternalString>(*entry.value_ptr);
            if let Some(dep_) = Self::parse_dependency::<FEATURES>(
                lockfile,
                pm,
                log,
                source,
                &DependencyGroup::PEER,
                &mut string_builder,
                package_dependencies,
                total_dependencies_count,
                None,
                None,
                external_name,
                b"*",
                logger::Loc::EMPTY,
                logger::Loc::EMPTY,
            )? {
                let mut dep = dep_;
                dep.behavior.optional = true;
                package_dependencies[total_dependencies_count as usize] = dep;
                total_dependencies_count += 1;
            }
        }

        {
            let buf = lockfile.buffers.string_bytes.as_slice();
            package_dependencies[0..total_dependencies_count as usize]
                .sort_by(|a, b| {
                    if Dependency::is_less_than(buf, a, b) {
                        core::cmp::Ordering::Less
                    } else {
                        core::cmp::Ordering::Greater
                    }
                });
        }

        self.dependencies.off = off as u32;
        self.dependencies.len = total_dependencies_count as u32;

        // SAFETY: PackageIDSlice and DependencySlice are both #[repr(C)] {off: u32, len: u32}.
        self.resolutions = unsafe { mem::transmute_copy(&self.dependencies) };

        // SAFETY: capacity reserved above.
        unsafe { lockfile.buffers.resolutions.set_len(total_len) };
        lockfile.buffers.resolutions[off..total_len].fill(invalid_package_id);

        let new_len = off + total_dependencies_count as usize;
        // SAFETY: shrink to actually-filled length.
        unsafe {
            lockfile.buffers.dependencies.set_len(new_len);
            lockfile.buffers.resolutions.set_len(new_len);
        }

        // This function depends on package.dependencies being set, so it is done at the very end.
        if FEATURES.is_main {
            lockfile
                .overrides
                .parse_append(pm, lockfile, self, log, source, &json, &mut string_builder)?;

            let mut found_any_catalog_or_catalog_object = false;
            let mut has_workspaces = false;
            if let Some(workspaces_expr) = json.get(b"workspaces") {
                found_any_catalog_or_catalog_object = lockfile.catalogs.parse_append(
                    pm,
                    lockfile,
                    log,
                    source,
                    &workspaces_expr,
                    &mut string_builder,
                )?;
                has_workspaces = true;
            }

            // `"workspaces"` being an object instead of an array is sometimes
            // unexpected to people. therefore if you also are using workspaces,
            // allow "catalog" and "catalogs" in top-level "package.json"
            // so it's easier to guess.
            if !found_any_catalog_or_catalog_object && has_workspaces {
                let _ = lockfile.catalogs.parse_append(
                    pm,
                    lockfile,
                    log,
                    source,
                    &json,
                    &mut string_builder,
                )?;
            }
        }

        string_builder.clamp();
        Ok(())
    }
}

pub type List<SemverIntType> = MultiArrayList<Package<SemverIntType>>;

// ─── Serializer ──────────────────────────────────────────────────────────────

pub mod serializer {
    use super::*;

    // Zig: comptime block computing per-field sizes/indices/types sorted by alignment
    // (descending). This relies on `@typeInfo`/`std.meta.fields` reflection that has
    // no Rust equivalent.
    // TODO(port): proc-macro or hand-written const arrays. The Package<SemverIntType>
    // struct has exactly 8 fields: name, name_hash, resolution, dependencies,
    // resolutions, meta, bin, scripts. Phase B should expand this manually with
    // `core::mem::{size_of, align_of}` once concrete `SemverIntType` instantiations
    // are known (u32 and the canonical type).
    pub struct Sizes {
        pub bytes: &'static [usize],
        pub fields: &'static [usize],
        // Types: omitted (Rust cannot store a `[type; N]` array).
    }
    // TODO(port): compute SIZES at const time per-SemverIntType.
    pub const SIZES: Sizes = Sizes { bytes: &[], fields: &[] };

    // Zig: `const FieldsEnum = @typeInfo(List.Field).@"enum";`
    // TODO(port): MultiArrayList<T>::Field enum reflection. Phase B: expose
    // `List::<T>::FIELDS: &[Field]` from bun_collections.

    pub fn byte_size<SemverIntType>(list: &List<SemverIntType>) -> usize {
        // Zig used SIMD @Vector reduction; equivalent scalar loop:
        let mut sum: usize = 0;
        for &sz in SIZES.bytes {
            sum += sz * list.len();
        }
        sum
    }

    // Zig: `const AlignmentType = sizes.Types[sizes.fields[0]];`
    // TODO(port): depends on SIZES.Types — Phase B.

    pub fn save<SemverIntType, S, W>(
        list: &List<SemverIntType>,
        stream: &mut S,
        writer: &mut W,
    ) -> Result<(), bun_core::Error>
    where
        S: lockfile::SeekablePwrite,
        W: bun_io::Write,
    {
        // TODO(port): narrow error set
        writer.write_int_le::<u64>(list.len() as u64)?;
        // TODO(port): @alignOf(@TypeOf(list.bytes)) — needs concrete type from MultiArrayList.
        writer.write_int_le::<u64>(mem::align_of::<*mut u8>() as u64)?;
        writer.write_int_le::<u64>(SIZES.bytes.len() as u64)?;
        let begin_at = stream.get_pos()?;
        writer.write_int_le::<u64>(0)?;
        let end_at = stream.get_pos()?;
        writer.write_int_le::<u64>(0)?;

        // TODO(port): Aligner.write needs the bytes-pointer alignment type.
        let _ = Aligner::write::<*mut u8, _>(writer, stream.get_pos()?)?;

        let really_begin_at = stream.get_pos()?;
        let sliced = list.slice();

        // PERF(port): was `inline for (FieldsEnum.fields)` — profile in Phase B
        // TODO(port): `@field(List.Field, field.name)` reflection. Phase B: iterate
        // `List::<T>::FIELDS` and use `sliced.items(field)` accessor.
        for field in List::<SemverIntType>::FIELDS {
            let value = sliced.items(*field);
            #[cfg(debug_assertions)]
            {
                bun_output::scoped_log!(
                    Lockfile,
                    "save(\"{}\") = {} bytes",
                    bstr::BStr::new(field.name()),
                    value.as_bytes().len(),
                );
                if field.name() == b"meta" {
                    // TODO(port): typed iteration over `value` as &[Meta]
                    for meta in value.cast::<Meta>() {
                        debug_assert!(meta.has_install_script != Meta::HasInstallScript::Old);
                    }
                }
            }
            assert_no_uninitialized_padding(value.element_type());
            if field.name() == b"resolution" {
                // copy each resolution to make sure the union is zero initialized
                for val in value.cast::<Resolution<SemverIntType>>() {
                    let copy = val.copy();
                    // SAFETY: Resolution is #[repr(C)] POD; reading raw bytes is sound.
                    writer.write_all(unsafe {
                        core::slice::from_raw_parts(
                            &copy as *const _ as *const u8,
                            mem::size_of_val(&copy),
                        )
                    })?;
                }
            } else {
                writer.write_all(value.as_bytes())?;
            }
        }

        let really_end_at = stream.get_pos()?;

        let _ = stream.pwrite(&really_begin_at.to_ne_bytes(), begin_at);
        let _ = stream.pwrite(&really_end_at.to_ne_bytes(), end_at);
        Ok(())
    }

    #[derive(Default)]
    pub struct PackagesLoadResult<SemverIntType> {
        pub list: List<SemverIntType>,
        pub needs_update: bool,
    }

    pub fn load<SemverIntType>(
        stream: &mut Stream,
        end: usize,
        migrate_from_v2: bool,
    ) -> Result<PackagesLoadResult<SemverIntType>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut reader = stream.reader();

        let list_len = reader.read_int_le::<u64>()?;
        if list_len > u32::MAX as u64 - 1 {
            return Err(bun_core::err!(
                "Lockfile validation failed: list is impossibly long"
            ));
        }

        let input_alignment = reader.read_int_le::<u64>()?;

        let mut list = List::<SemverIntType>::default();

        // TODO(port): @alignOf(@TypeOf(list.bytes)) — needs MultiArrayList bytes ptr type.
        let expected_alignment = mem::align_of::<*mut u8>() as u64;
        if expected_alignment != input_alignment {
            return Err(bun_core::err!(
                "Lockfile validation failed: alignment mismatch"
            ));
        }

        let field_count = reader.read_int_le::<u64>()?;
        match field_count {
            n if n == SIZES.bytes.len() as u64 => {}
            // "scripts" field is absent before v0.6.8
            // we will back-fill from each package.json
            n if n == SIZES.bytes.len() as u64 - 1 => {}
            _ => {
                return Err(bun_core::err!(
                    "Lockfile validation failed: unexpected number of package fields"
                ));
            }
        }

        let begin_at = reader.read_int_le::<u64>()? as usize;
        let end_at = reader.read_int_le::<u64>()? as usize;
        if begin_at > end || end_at > end || begin_at > end_at {
            return Err(bun_core::err!(
                "Lockfile validation failed: invalid package list range"
            ));
        }
        stream.pos = begin_at;
        list.ensure_total_capacity(list_len as usize)?;

        let mut needs_update = false;
        if migrate_from_v2 {
            type OldPackageV2 = Package<u32>;
            let mut list_for_migrating_from_v2 = <List<u32>>::default();
            // defer list_for_migrating_from_v2.deinit(allocator); — Drop handles it

            list_for_migrating_from_v2.ensure_total_capacity(list_len as usize)?;
            list_for_migrating_from_v2.set_len(list_len as usize);

            load_fields::<u32>(
                stream,
                end_at as u64,
                &mut list_for_migrating_from_v2,
                &mut needs_update,
            )?;

            for pkg_id_ in 0..list_for_migrating_from_v2.len() {
                let pkg_id: PackageID = PackageID::try_from(pkg_id_).unwrap();
                let old: OldPackageV2 = list_for_migrating_from_v2.get(pkg_id);
                let new = Package::<SemverIntType> {
                    name: old.name,
                    name_hash: old.name_hash,
                    meta: old.meta,
                    bin: old.bin,
                    dependencies: old.dependencies,
                    resolutions: old.resolutions,
                    scripts: old.scripts,
                    resolution: match old.resolution.tag {
                        lockfile::ResolutionTag::Uninitialized => {
                            Resolution::init(lockfile::ResolutionValue::uninitialized())
                        }
                        lockfile::ResolutionTag::Root => {
                            Resolution::init(lockfile::ResolutionValue::root())
                        }
                        lockfile::ResolutionTag::Npm => Resolution::init(
                            lockfile::ResolutionValue::npm(old.resolution.value.npm.migrate()),
                        ),
                        lockfile::ResolutionTag::Folder => Resolution::init(
                            lockfile::ResolutionValue::folder(old.resolution.value.folder),
                        ),
                        lockfile::ResolutionTag::LocalTarball => {
                            Resolution::init(lockfile::ResolutionValue::local_tarball(
                                old.resolution.value.local_tarball,
                            ))
                        }
                        lockfile::ResolutionTag::Github => Resolution::init(
                            lockfile::ResolutionValue::github(old.resolution.value.github),
                        ),
                        lockfile::ResolutionTag::Git => Resolution::init(
                            lockfile::ResolutionValue::git(old.resolution.value.git),
                        ),
                        lockfile::ResolutionTag::Symlink => Resolution::init(
                            lockfile::ResolutionValue::symlink(old.resolution.value.symlink),
                        ),
                        lockfile::ResolutionTag::Workspace => Resolution::init(
                            lockfile::ResolutionValue::workspace(
                                old.resolution.value.workspace,
                            ),
                        ),
                        lockfile::ResolutionTag::RemoteTarball => {
                            Resolution::init(lockfile::ResolutionValue::remote_tarball(
                                old.resolution.value.remote_tarball,
                            ))
                        }
                        lockfile::ResolutionTag::SingleFileModule => {
                            Resolution::init(lockfile::ResolutionValue::single_file_module(
                                old.resolution.value.single_file_module,
                            ))
                        }
                        _ => Resolution::init(lockfile::ResolutionValue::uninitialized()),
                    },
                };

                // PERF(port): was assume_capacity
                list.push(new);
            }
        } else {
            list.set_len(list_len as usize);
            load_fields::<SemverIntType>(stream, end_at as u64, &mut list, &mut needs_update)?;
        }

        Ok(PackagesLoadResult { list, needs_update })
    }

    fn load_fields<SemverIntType>(
        stream: &mut Stream,
        end_at: u64,
        list: &mut List<SemverIntType>,
        needs_update: &mut bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut sliced = list.slice();

        // PERF(port): was `inline for (FieldsEnum.fields)` — profile in Phase B
        // TODO(port): @field reflection — see save() above.
        for field in List::<SemverIntType>::FIELDS {
            let value = sliced.items_mut(*field);

            assert_no_uninitialized_padding(value.element_type());
            let bytes = value.as_bytes_mut();
            let end_pos = stream.pos + bytes.len();
            if end_pos as u64 <= end_at {
                bytes.copy_from_slice(&stream.buffer[stream.pos..stream.pos + bytes.len()]);
                stream.pos = end_pos;
                if field.name() == b"meta" {
                    // need to check if any values were created from an older version of bun
                    // (currently just `has_install_script`). If any are found, the values need
                    // to be updated before saving the lockfile.
                    for meta in value.cast_mut::<Meta>() {
                        if meta.needs_update() {
                            *needs_update = true;
                            break;
                        }
                    }
                }
            } else if field.name() == b"scripts" {
                bytes.fill(0);
            } else {
                return Err(bun_core::err!(
                    "Lockfile validation failed: invalid package list range"
                ));
            }
        }
        Ok(())
    }
}

pub use serializer as Serializer;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/Package.zig (2300 lines)
//   confidence: low
//   todos:      29
//   notes:      Heavy comptime reflection (@field/@typeInfo) in fromNPM/Serializer/Diff needs trait/proc-macro in Phase B; ResolverContext needs trait; borrowck reshaping needed for overlapping lockfile buffer borrows.
// ──────────────────────────────────────────────────────────────────────────

//! `impl AutoInstaller for PackageManager` — wires the resolver-side
//! [`bun_install_types::AutoInstaller`] capability trait to the concrete
//! `PackageManager` / `Lockfile` implementation. Lives in `bun_install`
//! (the higher tier) so the lower-tier trait crate carries no install
//! dependencies.
//!
//! ### Layout overlays
//!
//! The trait surface speaks the resolver-side projection types
//! (`hooks::Dependency` / `hooks::DependencyVersion` / `hooks::Resolution`)
//! whose `value` fields are opaque `[u64; 5]` buffers. The install-side
//! `dependency::{Dependency, Version, Value}` and
//! `resolution::{Resolution, Value}` are `#[repr(C)]` with identical field
//! order, so the projections are byte-identical overlays. The `const _`
//! asserts below pin that contract; any drift fails to compile.

use core::mem::{align_of, size_of};

use bun_install_types::resolver_hooks as hooks;
use bun_semver::{SlicedString, String as SemverString};

use crate::dependency;
use crate::lockfile::{self, Package};
use crate::package_manager::PackageManagerEnqueue as enqueue;
use crate::package_manager::PackageManagerDirectories as directories;
use crate::package_manager::PackageManagerResolution as pm_resolution;
use crate::resolution;
use crate::{DependencyID, Features, PackageID, PackageManager, PreinstallState};

// ─── Static layout asserts ────────────────────────────────────────────────
// These tie the opaque `[u64; 5]` projection buffers to the real install
// unions. If `Repository`/`NpmInfo` ever grow past 40 B, or the field order
// of `Dependency`/`Version`/`Resolution` diverges, this fails to compile.

const _: () = assert!(size_of::<dependency::Value>() <= size_of::<[u64; 5]>());
const _: () = assert!(align_of::<dependency::Value>() <= align_of::<[u64; 5]>());
const _: () = assert!(size_of::<dependency::Version>() == size_of::<hooks::DependencyVersion>());
const _: () = assert!(align_of::<dependency::Version>() == align_of::<hooks::DependencyVersion>());
const _: () = assert!(size_of::<dependency::Dependency>() == size_of::<hooks::Dependency>());
const _: () = assert!(align_of::<dependency::Dependency>() == align_of::<hooks::Dependency>());

const _: () = assert!(size_of::<resolution::Value<u64>>() <= size_of::<[u64; 5]>());
const _: () = assert!(align_of::<resolution::Value<u64>>() <= align_of::<[u64; 5]>());
const _: () = assert!(size_of::<resolution::Resolution>() == size_of::<hooks::Resolution>());
const _: () = assert!(align_of::<resolution::Resolution>() == align_of::<hooks::Resolution>());

// ─── Overlay helpers ──────────────────────────────────────────────────────

#[inline]
fn version_from_hooks(v: &hooks::DependencyVersion) -> &dependency::Version {
    // SAFETY: layout-identical per `const _` asserts above; both `#[repr(C)]`
    // with field order `(tag: u8, literal: SemverString, value: 40B)`.
    unsafe { &*(v as *const hooks::DependencyVersion as *const dependency::Version) }
}

#[inline]
fn version_to_hooks(v: dependency::Version) -> hooks::DependencyVersion {
    // SAFETY: layout-identical per `const _` asserts above.
    unsafe { core::mem::transmute::<dependency::Version, hooks::DependencyVersion>(v) }
}

#[inline]
fn dep_slice_to_hooks(s: &[dependency::Dependency]) -> &[hooks::Dependency] {
    // SAFETY: layout-identical per `const _` asserts above.
    unsafe {
        core::slice::from_raw_parts(s.as_ptr() as *const hooks::Dependency, s.len())
    }
}

#[inline]
fn dep_from_hooks(d: &hooks::Dependency) -> &dependency::Dependency {
    // SAFETY: layout-identical per `const _` asserts above.
    unsafe { &*(d as *const hooks::Dependency as *const dependency::Dependency) }
}

#[inline]
fn resolution_to_hooks(r: resolution::Resolution) -> hooks::Resolution {
    // SAFETY: layout-identical per `const _` asserts above.
    unsafe { core::mem::transmute::<resolution::Resolution, hooks::Resolution>(r) }
}

#[inline]
fn resolution_from_hooks(r: &hooks::Resolution) -> &resolution::Resolution {
    // SAFETY: layout-identical per `const _` asserts above.
    unsafe { &*(r as *const hooks::Resolution as *const resolution::Resolution) }
}

#[inline]
fn tag_to_hooks(t: dependency::Tag) -> hooks::DependencyVersionTag {
    // SAFETY: both `#[repr(u8)]` with identical discriminants
    // (src/install/dependency.zig `Version.Tag`).
    unsafe { core::mem::transmute::<dependency::Tag, hooks::DependencyVersionTag>(t) }
}

#[inline]
fn tag_from_hooks(t: hooks::DependencyVersionTag) -> dependency::Tag {
    // SAFETY: see `tag_to_hooks`.
    unsafe { core::mem::transmute::<hooks::DependencyVersionTag, dependency::Tag>(t) }
}

// ─── impl AutoInstaller ───────────────────────────────────────────────────

impl hooks::AutoInstaller for PackageManager {
    // ── Lockfile reads ────────────────────────────────────────────────────

    fn lockfile_packages_len(&self) -> usize {
        self.lockfile.packages.len()
    }

    fn lockfile_package_dependencies(&self, id: PackageID) -> hooks::DependencySlice {
        let s = self.lockfile.packages.get(id as usize).dependencies;
        hooks::DependencySlice::new(s.off, s.len)
    }

    fn lockfile_package_resolutions(&self, id: PackageID) -> hooks::ResolutionSlice {
        let s = self.lockfile.packages.get(id as usize).resolutions;
        hooks::ResolutionSlice::new(s.off, s.len)
    }

    fn lockfile_package_resolution(&self, id: PackageID) -> hooks::Resolution {
        resolution_to_hooks(self.lockfile.packages.get(id as usize).resolution)
    }

    fn lockfile_dependencies_buf(&self) -> &[hooks::Dependency] {
        dep_slice_to_hooks(self.lockfile.buffers.dependencies.as_slice())
    }

    fn lockfile_resolutions_buf(&self) -> &[PackageID] {
        self.lockfile.buffers.resolutions.as_slice()
    }

    fn lockfile_string_bytes(&self) -> &[u8] {
        self.lockfile.buffers.string_bytes.as_slice()
    }

    fn lockfile_resolve(
        &self,
        name: &[u8],
        version: &hooks::DependencyVersion,
    ) -> Option<PackageID> {
        // Zig: `lockfile.resolvePackageFromNameAndVersion` (resolver.zig:2028
        // calls `manager.lockfile.resolve(name, version)`).
        let name_hash = bun_semver::String::Builder::string_hash(name);
        let entry = self.lockfile.package_index.get(&name_hash)?;
        let v = version_from_hooks(version);
        let buf = self.lockfile.buffers.string_bytes.as_slice();
        match entry {
            lockfile::PackageIndexEntry::Id(id) => {
                let pkg = self.lockfile.packages.get(*id as usize);
                if pkg.resolution.satisfies(v, buf, buf) { Some(*id) } else { None }
            }
            lockfile::PackageIndexEntry::Ids(ids) => {
                for &id in ids.iter() {
                    let pkg = self.lockfile.packages.get(id as usize);
                    if pkg.resolution.satisfies(v, buf, buf) {
                        return Some(id);
                    }
                }
                None
            }
        }
    }

    fn lockfile_legacy_package_to_dependency_id(
        &self,
        package_id: PackageID,
    ) -> Result<DependencyID, bun_core::Error> {
        self.lockfile
            .buffers
            .legacy_package_to_dependency_id(None, package_id)
            .map_err(Into::into)
    }

    fn lockfile_str(&self, s: &SemverString) -> &[u8] {
        self.lockfile.str(s)
    }

    // ── Lockfile writes ───────────────────────────────────────────────────

    fn lockfile_append_from_package_json(
        &mut self,
        package_json: &dyn hooks::PackageJsonView,
        features: Features,
    ) -> Result<PackageID, bun_core::Error> {
        // Port of `Package.fromPackageJSON` + `lockfile.appendPackage`
        // (resolver.zig:2064-2073), driven entirely off the
        // `PackageJsonView` interface so the install crate does not need to
        // name `bun_resolver::PackageJSON` here.

        // PORT NOTE: reshaped for borrowck — `string_builder!` borrows
        // `self.lockfile` mutably while `dep.clone_in` needs `&mut self`.
        // Use a raw pointer for the disjoint reborrow (same approach as
        // `Package::from_package_json`).
        let pm: *mut PackageManager = self;
        // SAFETY: `pm` derives from `&mut self`; reborrows below are disjoint
        // from `string_builder`'s borrow of `lockfile.{string_bytes,string_pool}`.
        let lockfile: &mut lockfile::Lockfile = unsafe { &mut *(*pm).lockfile };

        let mut package = Package::default();
        let mut string_builder = crate::string_builder!(lockfile);
        let mut total_dependencies_count: u32 = 0;

        // --- Counting
        string_builder.count(package_json.name());
        string_builder.count(package_json.version());
        let source_buf = package_json.dependency_source_buf();
        for (_, dep) in package_json.dependency_iter() {
            if dep.behavior.is_enabled(features) {
                dep_from_hooks(dep).count(source_buf, &mut string_builder);
                total_dependencies_count += 1;
            }
        }

        string_builder.allocate()?;

        let dependencies_list = &mut lockfile.buffers.dependencies;
        let resolutions_list = &mut lockfile.buffers.resolutions;
        dependencies_list.reserve(total_dependencies_count as usize);
        resolutions_list.reserve(total_dependencies_count as usize);

        // --- Cloning
        let package_name: bun_semver::ExternalString =
            string_builder.append::<bun_semver::ExternalString>(package_json.name());
        package.name_hash = package_name.hash;
        package.name = package_name.value;
        package.resolution = resolution::Resolution::init(resolution::TaggedValue::Root);

        let dep_start = dependencies_list.len();
        let total_len = dep_start + total_dependencies_count as usize;
        debug_assert!(dependencies_list.len() == resolutions_list.len());

        // SAFETY: capacity reserved above; slots are filled by the loop below.
        unsafe { dependencies_list.set_len(total_len) };
        let mut dependencies: &mut [dependency::Dependency] =
            &mut dependencies_list[dep_start..total_len];
        for d in dependencies.iter_mut() {
            *d = dependency::Dependency::default();
        }

        for (_, dep) in package_json.dependency_iter() {
            if !dep.behavior.is_enabled(features) {
                continue;
            }
            // SAFETY: `pm` is the unique owner; `string_builder` borrows
            // disjoint lockfile fields.
            let pm_ref: &mut PackageManager = unsafe { &mut *pm };
            dependencies[0] =
                dep_from_hooks(dep).clone_in(pm_ref, source_buf, &mut string_builder)?;
            dependencies = &mut dependencies[1..];
            if dependencies.is_empty() {
                break;
            }
        }

        package.meta.arch = package_json.arch();
        package.meta.os = package_json.os();
        package.meta.set_has_install_script(lockfile::HasInstallScript::Old);

        package.dependencies =
            crate::lockfile::DependencySlice::new(dep_start as u32, total_dependencies_count - dependencies.len() as u32);
        package.resolutions =
            crate::lockfile::PackageIDSlice::new(package.dependencies.off, package.dependencies.len);

        let new_length = package.dependencies.len as usize + dep_start;
        // SAFETY: capacity reserved above; slots filled by `fill()` below.
        unsafe { resolutions_list.set_len(new_length) };
        resolutions_list[dep_start..new_length].fill(crate::INVALID_PACKAGE_ID);
        // SAFETY: shrink dependencies_list to actual filled length.
        unsafe { dependencies_list.set_len(new_length) };

        string_builder.clamp();

        let appended = lockfile.append_package(package)?;
        Ok(appended.meta.id)
    }

    fn lockfile_append_root_stub(&mut self) -> Result<PackageID, bun_core::Error> {
        // Zig: `try manager.lockfile.appendPackage(.{ .name = String.init("", ""),
        //   .resolution = .{ .value = .{ .root = {} }, .tag = .root } })`
        // (resolver.zig:2082).
        let mut pkg = Package::default();
        pkg.resolution = resolution::Resolution::init(resolution::TaggedValue::Root);
        let appended = self.lockfile.append_package(pkg)?;
        Ok(appended.meta.id)
    }

    // ── PackageManager ops ────────────────────────────────────────────────

    fn set_on_wake(&mut self, handler: hooks::WakeHandler) {
        self.on_wake = handler;
    }

    fn path_for_resolution<'b>(
        &self,
        package_id: PackageID,
        resolution: &hooks::Resolution,
        buf: &'b mut [u8],
    ) -> Result<&'b [u8], bun_core::Error> {
        // SAFETY: `path_for_resolution` only mutates `self` to populate the
        // cache directory; the resolver call site holds no other borrow.
        let this: *const Self = self;
        let path_buf = bun_paths::PathBuffer::from_mut_slice(buf);
        let r = *resolution_from_hooks(resolution);
        // SAFETY: see above.
        let out = directories::path_for_resolution(unsafe { &mut *(this as *mut Self) }, package_id, r, path_buf)?;
        Ok(&*out)
    }

    fn get_preinstall_state(&self, package_id: PackageID) -> PreinstallState {
        crate::package_manager::PackageManagerLifecycle::get_preinstall_state(self, package_id)
    }

    fn enqueue_package_for_download(
        &mut self,
        name: &[u8],
        dependency_id: DependencyID,
        package_id: PackageID,
        resolution: &hooks::Resolution,
        ctx: hooks::TaskCallbackContext,
        patch_name_and_version_hash: Option<u64>,
    ) -> Result<(), bun_core::Error> {
        let r = resolution_from_hooks(resolution);
        // Zig: resolver.zig:2123 — only the npm arm reaches this enqueue.
        // SAFETY: caller passes a `Resolution` whose tag was already checked
        // == Npm by the resolver (`resolution.tag == .npm`); the projection
        // overlay preserves the tag/union pairing.
        let npm = unsafe { r.value.npm };
        let url = self.lockfile.str(&npm.url).to_vec();
        enqueue::enqueue_package_for_download(
            self,
            name,
            dependency_id,
            package_id,
            npm.version,
            &url,
            crate::TaskCallbackContext::RootRequestId(ctx.root_request_id),
            patch_name_and_version_hash,
        )
        .map_err(Into::into)
    }

    fn resolve_from_disk_cache(
        &mut self,
        name: &[u8],
        version: &hooks::DependencyVersion,
    ) -> Option<PackageID> {
        pm_resolution::resolve_from_disk_cache(self, name, Clone::clone(version_from_hooks(version)))
    }

    fn enqueue_dependency_to_root(
        &mut self,
        name: &[u8],
        version: &hooks::DependencyVersion,
        version_buf: &[u8],
        behavior: hooks::Behavior,
    ) -> hooks::EnqueueResult {
        match enqueue::enqueue_dependency_to_root(
            self,
            name,
            version_from_hooks(version),
            version_buf,
            behavior,
        ) {
            enqueue::DependencyToEnqueue::Resolution { package_id, resolution } => {
                hooks::EnqueueResult::Resolution {
                    package_id,
                    resolution: resolution_to_hooks(resolution),
                }
            }
            enqueue::DependencyToEnqueue::Pending(id) => hooks::EnqueueResult::Pending(id),
            enqueue::DependencyToEnqueue::NotFound => hooks::EnqueueResult::NotFound,
            enqueue::DependencyToEnqueue::Failure(e) => hooks::EnqueueResult::Failure(e),
        }
    }

    // ── Dependency parsing ────────────────────────────────────────────────

    fn parse_dependency(
        &self,
        name: SemverString,
        name_hash: Option<u64>,
        version: &[u8],
        sliced: &SlicedString,
        log: *mut bun_logger::Log,
    ) -> Option<hooks::DependencyVersion> {
        // SAFETY: resolver passes `self.log()` which is a valid `*mut Log`;
        // null is also accepted (Zig: `?*logger.Log`).
        let log = unsafe { log.as_mut() };
        dependency::parse(name, name_hash, version, sliced, log, None).map(version_to_hooks)
    }

    fn parse_dependency_with_tag(
        &self,
        name: SemverString,
        name_hash: u64,
        version: &[u8],
        tag: hooks::DependencyVersionTag,
        sliced: &SlicedString,
        log: *mut bun_logger::Log,
    ) -> Option<hooks::DependencyVersion> {
        // SAFETY: see `parse_dependency`.
        let log = unsafe { log.as_mut() };
        dependency::parse_with_tag(
            name,
            Some(name_hash),
            version,
            tag_from_hooks(tag),
            sliced,
            log,
            None,
        )
        .map(version_to_hooks)
    }

    fn infer_dependency_tag(&self, dep: &[u8]) -> hooks::DependencyVersionTag {
        tag_to_hooks(dependency::Tag::infer(dep))
    }

    fn dependency_version_is_exact_npm(&self, v: &hooks::DependencyVersion) -> bool {
        version_from_hooks(v)
            .npm()
            .map(|n| n.version.is_exact())
            .unwrap_or(false)
    }
}

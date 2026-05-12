//! `impl AutoInstaller for PackageManager` — wires the resolver-side
//! [`bun_install_types::AutoInstaller`] capability trait to the concrete
//! `PackageManager` / `Lockfile` implementation. Lives in `bun_install`
//! (the higher tier) so the lower-tier trait crate carries no install
//! dependencies.
//!
//! All the value types (`Dependency`, `DependencyVersion`, `Behavior`,
//! `Features`, `ExternalSlice`, `OperatingSystem`, …) are MOVE_DOWN'd into
//! `bun_install_types` and re-exported here, so `dependency::Version` and
//! `hooks::DependencyVersion` name the SAME type — no bridge needed for the
//! dependency-side surface.
//!
//! `resolution::Resolution` is still the install-side `ResolutionType<u64>`
//! (a `#[repr(C)]` struct whose `value` field IS `hooks::ResolutionValue<u64>`
//! — `resolution::Value<I>` is now a type alias). [`resolution_to_hooks`] /
//! [`resolution_from_hooks`] bridge them by explicit field copy — the `tag`
//! fields have different validity domains (open `u8` newtype vs closed
//! `#[repr(u8)] enum`), so a whole-struct transmute would be unsound. Both
//! directions are fully safe: to-hooks copies the active variant via
//! `ResolutionType`'s tag-checked accessors, from-hooks copies the shared
//! `value` union by plain assignment.

use core::mem::{align_of, size_of};

use bun_install_types::resolver_hooks as hooks;
use bun_semver::{SlicedString, String as SemverString};

use crate::dependency::{self, DependencyExt as _, VersionExt as _};
use crate::lockfile::{self, Package};
use crate::package_manager::package_manager_directories as directories;
use crate::package_manager::package_manager_enqueue as enqueue;
use crate::package_manager::package_manager_lifecycle as lifecycle;
use crate::package_manager::package_manager_resolution as pm_resolution;
use crate::resolution;
use crate::{DependencyID, Features, PackageID, PackageManager, PreinstallState};

// ─── Static layout asserts (Resolution overlay) ───────────────────────────
// `resolution::ResolutionType<u64>` and `hooks::Resolution` are distinct
// `#[repr(C)]` structs with identical field order
// (`tag: u8, _padding: [u8;7], value: ResolutionValue<u64>`). Pin that
// contract. The `value` fields are the SAME nominal type (`resolution::Value`
// aliases `hooks::ResolutionValue`), so only the whole-struct layout needs
// pinning.
//
// NB: size/align equality is necessary but NOT sufficient for a whole-struct
// transmute — the two `tag` fields have different validity domains (open `u8`
// newtype vs closed `#[repr(u8)] enum`). The bridge below therefore copies
// fields explicitly.

const _: () = assert!(size_of::<resolution::Resolution>() == size_of::<hooks::Resolution>());
const _: () = assert!(align_of::<resolution::Resolution>() == align_of::<hooks::Resolution>());

// Pin discriminant equality so the two Tag definitions cannot silently diverge.
const _: () = {
    assert!(resolution::Tag::Uninitialized.0 == hooks::ResolutionTag::Uninitialized as u8);
    assert!(resolution::Tag::Root.0 == hooks::ResolutionTag::Root as u8);
    assert!(resolution::Tag::Npm.0 == hooks::ResolutionTag::Npm as u8);
    assert!(resolution::Tag::Folder.0 == hooks::ResolutionTag::Folder as u8);
    assert!(resolution::Tag::LocalTarball.0 == hooks::ResolutionTag::LocalTarball as u8);
    assert!(resolution::Tag::Github.0 == hooks::ResolutionTag::Github as u8);
    assert!(resolution::Tag::Git.0 == hooks::ResolutionTag::Git as u8);
    assert!(resolution::Tag::Symlink.0 == hooks::ResolutionTag::Symlink as u8);
    assert!(resolution::Tag::Workspace.0 == hooks::ResolutionTag::Workspace as u8);
    assert!(resolution::Tag::RemoteTarball.0 == hooks::ResolutionTag::RemoteTarball as u8);
    assert!(resolution::Tag::SingleFileModule.0 == hooks::ResolutionTag::SingleFileModule as u8);
};

#[inline]
fn tag_to_hooks(t: resolution::Tag) -> hooks::ResolutionTag {
    // `resolution::Tag` is a `#[repr(transparent)]` u8 newtype (Zig
    // `enum(u8) { ..., _ }` — non-exhaustive; lockfile bytes may carry any
    // value). `hooks::ResolutionTag` is a closed `#[repr(u8)] enum`. A blind
    // transmute would produce an invalid enum discriminant (UB) for any byte
    // outside the named set, so map explicitly and saturate unknowns to
    // `Uninitialized` (debug-asserted).
    match t {
        resolution::Tag::Uninitialized => hooks::ResolutionTag::Uninitialized,
        resolution::Tag::Root => hooks::ResolutionTag::Root,
        resolution::Tag::Npm => hooks::ResolutionTag::Npm,
        resolution::Tag::Folder => hooks::ResolutionTag::Folder,
        resolution::Tag::LocalTarball => hooks::ResolutionTag::LocalTarball,
        resolution::Tag::Github => hooks::ResolutionTag::Github,
        resolution::Tag::Git => hooks::ResolutionTag::Git,
        resolution::Tag::Symlink => hooks::ResolutionTag::Symlink,
        resolution::Tag::Workspace => hooks::ResolutionTag::Workspace,
        resolution::Tag::RemoteTarball => hooks::ResolutionTag::RemoteTarball,
        resolution::Tag::SingleFileModule => hooks::ResolutionTag::SingleFileModule,
        unknown => {
            debug_assert!(
                false,
                "unknown resolution::Tag({}) crossing hooks boundary",
                unknown.0
            );
            hooks::ResolutionTag::Uninitialized
        }
    }
}

#[inline]
fn resolution_to_hooks(r: resolution::Resolution) -> hooks::Resolution {
    // `resolution::Value<u64>` is a type alias for `hooks::ResolutionValue<u64>`,
    // so `value` copies as the SAME nominal type. `hooks::Resolution` is
    // in-memory only (never byte-serialized), so trailing union bytes carrying
    // over from the install-side zero-init contract is fine.
    hooks::Resolution {
        tag: tag_to_hooks(r.tag),
        _padding: r._padding,
        value: r.value,
    }
}

#[inline]
fn resolution_from_hooks(r: &hooks::Resolution) -> resolution::Resolution {
    resolution::Resolution {
        // Every `hooks::ResolutionTag` discriminant is a valid `Tag(u8)` (the
        // closed enum is a strict subset of the open newtype), so this
        // direction needs no checked match.
        tag: resolution::Tag(r.tag as u8),
        _padding: r._padding,
        // `resolution::Value<u64>` is a type alias for
        // `hooks::ResolutionValue<u64>` — same nominal type, plain `Copy`.
        value: r.value,
    }
}

// `dependency::Tag` is a re-export of `hooks::DependencyVersionTag`
// (src/install/dependency.rs), so no overlay helper is needed — values pass
// through nominally.

// ─── impl AutoInstaller ───────────────────────────────────────────────────

impl hooks::AutoInstaller for PackageManager {
    // ── Lockfile reads ────────────────────────────────────────────────────

    fn lockfile_packages_len(&self) -> usize {
        self.lockfile.packages.len()
    }

    fn lockfile_package_dependencies(&self, id: PackageID) -> hooks::DependencySlice {
        let s = self.lockfile.packages.get(id as usize).dependencies;
        // `lockfile::DependencySlice` and `hooks::DependencySlice` are both
        // `ExternalSlice<Dependency>` (same `Dependency` after MOVE_DOWN), so
        // this is a no-op; spelled via `new` for nominal-type clarity.
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
        // `dependency::Dependency` IS `hooks::Dependency` (re-export).
        self.lockfile.buffers.dependencies.as_slice()
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
        // Zig: `manager.lockfile.resolve(name, dependency_version)`
        // (resolver.zig:2028) → `Lockfile.resolvePackageFromNameAndVersion`.
        self.lockfile
            .resolve_package_from_name_and_version(name, Clone::clone(version))
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

    fn lockfile_str<'a>(&'a self, s: &'a SemverString) -> &'a [u8] {
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
        // `PackageJsonView` interface so this impl does not need to name
        // `bun_resolver::PackageJSON` directly.

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
                dep.count(source_buf, &mut string_builder);
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
        debug_assert!(dependencies_list.len() == resolutions_list.len());

        // Zig writes through `items.ptr[len..total_len]` and only bumps
        // `.items.len` after the last fallible point (Package.zig:265-296).
        // Mirror that by default-filling the tail now and `truncate`-ing back
        // to `dep_start` on the error path so a failed `clone_in` leaves both
        // buffer lengths consistent.
        let mut dependencies: &mut [dependency::Dependency] =
            bun_core::vec::grow_default(dependencies_list, total_dependencies_count as usize);

        for (_, dep) in package_json.dependency_iter() {
            if !dep.behavior.is_enabled(features) {
                continue;
            }
            // SAFETY: `pm` is the unique owner; `string_builder` borrows
            // disjoint lockfile fields.
            let pm_ref: &mut PackageManager = unsafe { &mut *pm };
            match dep.clone_in(pm_ref, source_buf, &mut string_builder) {
                Ok(cloned) => dependencies[0] = cloned,
                Err(e) => {
                    // Zig: `defer string_builder.clamp()` — must run on the
                    // error path too. Restore the buffer length so the
                    // lockfile stays consistent (`Dependency` is no-op Drop).
                    dependencies_list.truncate(dep_start);
                    string_builder.clamp();
                    return Err(e);
                }
            }
            dependencies = &mut dependencies[1..];
            if dependencies.is_empty() {
                break;
            }
        }
        let remaining = dependencies.len() as u32;

        package.meta.arch = package_json.arch();
        package.meta.os = package_json.os();
        // Zig: `package.meta.setHasInstallScript(package.scripts.hasAny())`
        // (resolver.zig:2390). `fromPackageJSON` leaves `scripts` zero-init, so
        // `hasAny()` is always false here.
        package.meta.set_has_install_script(false);

        package.dependencies = crate::lockfile::DependencySlice::new(
            dep_start as u32,
            total_dependencies_count - remaining,
        );
        package.resolutions = crate::lockfile::PackageIDSlice::new(
            package.dependencies.off,
            package.dependencies.len,
        );

        let new_length = package.dependencies.len as usize + dep_start;
        // Length was bumped to `dep_start + total_dependencies_count` by
        // `grow_default` above; trim any unused tail.
        dependencies_list.truncate(new_length);
        resolutions_list.resize(new_length, crate::INVALID_PACKAGE_ID);

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
        &mut self,
        package_id: PackageID,
        resolution: &hooks::Resolution,
        buf: &'b mut [u8],
    ) -> Result<&'b [u8], bun_core::Error> {
        // The resolver passes a `bun_paths::PathBuffer`-sized slice
        // (`bufs!(path_in_global_disk_cache)`); reborrow it as the install
        // signature's `&mut PathBuffer`.
        debug_assert!(buf.len() >= bun_paths::MAX_PATH_BYTES);
        // SAFETY: `PathBuffer` is `#[repr(transparent)]` over
        // `[u8; MAX_PATH_BYTES]`; caller-provided slice is at least that long
        // (asserted above).
        let path_buf: &mut bun_paths::PathBuffer =
            unsafe { &mut *buf.as_mut_ptr().cast::<bun_paths::PathBuffer>() };
        let r = resolution_from_hooks(resolution);
        let out = directories::path_for_resolution(self, package_id, r, path_buf)?;
        Ok(&*out)
    }

    fn get_preinstall_state(&self, package_id: PackageID) -> PreinstallState {
        lifecycle::get_preinstall_state(self, package_id)
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
        // Caller passes a `Resolution` whose tag was already checked == Npm by
        // the resolver (`resolution.tag == .npm`); the field-copy bridge
        // preserves the tag/union pairing.
        let npm = *r.npm();
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
        pm_resolution::resolve_from_disk_cache(self, name, Clone::clone(version))
    }

    fn enqueue_dependency_to_root(
        &mut self,
        name: &[u8],
        version: &hooks::DependencyVersion,
        version_buf: &[u8],
        behavior: hooks::Behavior,
    ) -> hooks::EnqueueResult {
        match enqueue::enqueue_dependency_to_root(self, name, version, version_buf, behavior) {
            enqueue::DependencyToEnqueue::Resolution {
                package_id,
                resolution,
            } => hooks::EnqueueResult::Resolution {
                package_id,
                resolution: resolution_to_hooks(resolution),
            },
            enqueue::DependencyToEnqueue::Pending(id) => hooks::EnqueueResult::Pending(id),
            enqueue::DependencyToEnqueue::NotFound => hooks::EnqueueResult::NotFound,
            enqueue::DependencyToEnqueue::Failure(e) => hooks::EnqueueResult::Failure(e),
        }
    }

    // ── Dependency parsing ────────────────────────────────────────────────

    fn parse_dependency(
        &mut self,
        name: SemverString,
        name_hash: Option<u64>,
        version: &[u8],
        sliced: &SlicedString,
        log: *mut bun_ast::Log,
    ) -> Option<hooks::DependencyVersion> {
        // SAFETY: resolver passes `self.log()` which is a valid `*mut Log`;
        // null is also accepted (Zig: `?*logger.Log`).
        let log = unsafe { log.as_mut() };
        // Zig threads `pm` so `parse_with_tag` can record `npm:` aliases into
        // `pm.known_npm_aliases` (dependency.zig:905).
        dependency::parse(name, name_hash, version, sliced, log, Some(self))
    }

    fn parse_dependency_with_tag(
        &mut self,
        name: SemverString,
        name_hash: u64,
        version: &[u8],
        tag: hooks::DependencyVersionTag,
        sliced: &SlicedString,
        log: *mut bun_ast::Log,
    ) -> Option<hooks::DependencyVersion> {
        // SAFETY: see `parse_dependency`.
        let log = unsafe { log.as_mut() };
        dependency::parse_with_tag(
            name,
            Some(name_hash),
            version,
            tag,
            sliced,
            log,
            Some(self as &mut dyn dependency::NpmAliasRegistry),
        )
    }

    fn infer_dependency_tag(&self, dep: &[u8]) -> hooks::DependencyVersionTag {
        <dependency::Tag as dependency::TagExt>::infer(dep)
    }
}

// ─── Lazy factory (resolver → install link-time hook) ─────────────────────
//
// Port of resolver.zig:538 `getPackageManager`'s `orelse` arm:
//
//     bun.HTTPThread.init(&.{});
//     const pm = PackageManager.initWithRuntime(
//         this.log, this.opts.install, bun.default_allocator, .{}, this.env_loader.?);
//
// `bun_resolver` cannot name `PackageManager` (it would create a dep cycle),
// so it declares this `extern "Rust"` and we provide the body here. The
// returned pointer is the process-static `PackageManager` singleton (`get()`),
// upcast to the `dyn AutoInstaller` trait object the resolver stores.
//
// SAFETY (callee contract):
//   • `log` is the resolver's `*mut bun_ast::Log` (Transpiler-owned,
//     process-lifetime; `init_with_runtime` stores it raw).
//   • `install` is the type-erased `Option<&Api::BunInstall>` projected from
//     `BundleOptions.install` (`*const ()` — null ⇔ None). The pointee is the
//     CLI-owned `Box<BunInstall>` (process-lifetime).
//   • `env` is the type-erased `*mut DotEnv::Loader` (Transpiler-owned,
//     process-lifetime). `init_with_runtime` stores it as
//     `NonNull<Loader<'static>>`; the lifetime erasure matches Zig's raw
//     `*DotEnv.Loader`.
#[unsafe(no_mangle)]
pub unsafe fn __bun_resolver_init_package_manager(
    log: *mut bun_ast::Log,
    install: *const (),
    env: *mut core::ffi::c_void,
) -> core::ptr::NonNull<dyn hooks::AutoInstaller> {
    // Zig: `bun.HTTPThread.init(&.{})` — idempotent.
    bun_http::http_thread::init(&Default::default());

    // SAFETY: `install` is either null or points at a live `Api::BunInstall`
    // (see `run_command::wire_transpiler_from_ctx`); read-only borrow.
    let bun_install: Option<&crate::bun_schema::api::BunInstall> = unsafe {
        install
            .cast::<crate::bun_schema::api::BunInstall>()
            .as_ref()
    };
    // SAFETY: caller guarantees `log` / `env` are non-null process-lifetime
    // pointers (resolver `.expect`s `env_loader` before calling).
    let log_ref: &mut bun_ast::Log = unsafe { &mut *log };
    let env_ref: &mut bun_dotenv::Loader<'static> =
        unsafe { &mut *env.cast::<bun_dotenv::Loader<'static>>() };

    let pm: *mut PackageManager = crate::package_manager::init_with_runtime(
        log_ref,
        bun_install,
        crate::package_manager::CommandLineArguments::default(),
        env_ref,
    );
    // `init_with_runtime` returns the non-null `holder::RAW_PTR` singleton;
    // upcast to the trait object the resolver stores.
    core::ptr::NonNull::new(pm as *mut dyn hooks::AutoInstaller)
        .expect("init_with_runtime returns the holder::RAW_PTR singleton")
}

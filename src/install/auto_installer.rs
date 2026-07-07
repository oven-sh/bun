//! Bodies of the `bun_pm_*` link fns declared in
//! `bun_install_types::resolver_hooks` — the resolver-side auto-install
//! surface, wired to the concrete `PackageManager` / `Lockfile`
//! implementation. Lives in `bun_install` (the higher tier) so the
//! lower-tier carrier crate carries no install dependencies.
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

use bun_install_types::{DependencyID, Features, PackageID, PreinstallState};
use core::mem::{align_of, size_of};
use core::ptr::NonNull;

use bun_install_types::resolver_hooks as hooks;
use bun_semver::{SlicedString, String as SemverString};

use crate::PackageManager;
use crate::lockfile::{self, Package};
use crate::package_manager::package_manager_directories as directories;
use crate::package_manager::package_manager_enqueue as enqueue;
use crate::package_manager::package_manager_resolution as pm_resolution;
use crate::resolution;
use bun_install_types::dependency::{self};

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
    // `resolution::Tag` is a `#[repr(transparent)]` u8 newtype
    // (non-exhaustive; lockfile bytes may carry any
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
fn resolution_to_hooks(r: &resolution::Resolution) -> hooks::Resolution {
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

// ─── Handle → concrete `PackageManager` ───────────────────────────────────

/// Reborrow the opaque link handle as the concrete singleton.
///
/// # Safety
/// `handle` must be the live process-static `PackageManager` singleton
/// (`holder::RAW_PTR`) handed out by [`bun_package_manager_init`], with the
/// caller holding exclusive access for `'a` — the link-fn contract stated on
/// the `unsafe extern "Rust"` block in `bun_install_types::resolver_hooks`.
#[inline]
unsafe fn manager<'a>(handle: NonNull<hooks::PackageManagerHandle>) -> &'a mut PackageManager {
    // SAFETY: caller contract (see above); the handle carries whole-object
    // provenance because `bun_package_manager_init` derived it from the raw
    // singleton pointer.
    unsafe { &mut *handle.cast::<PackageManager>().as_ptr() }
}

/// Shared-borrow counterpart of [`manager`] for the read-only link fns:
/// consecutive reads through the same `&PackageManagerHandle` stay legal
/// shared reborrows, so callers may hold a returned slice across further
/// read calls.
#[inline]
fn manager_ref<'a>(handle: &'a hooks::PackageManagerHandle) -> &'a PackageManager {
    // SAFETY: `handle` is the live singleton (same provenance as `manager`); a
    // shared reborrow for `'a` of a borrow the caller already holds.
    unsafe { &*core::ptr::from_ref(handle).cast::<PackageManager>() }
}

// ─── `bun_pm_*` link-fn bodies ────────────────────────────────────────────
//
// One `#[unsafe(no_mangle)]` definition per declaration in
// `bun_install_types::resolver_hooks`; signatures must match byte-for-byte.
// Every body starts by reborrowing the handle — via [`manager_ref`] for the
// `&PackageManagerHandle` read fns, via [`manager`] for the mutating ones —
// under the shared caller contract documented there.

// ── Lockfile reads ────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_packages_len(pm: &hooks::PackageManagerHandle) -> usize {
    let pm = manager_ref(pm);
    pm.lockfile.packages.len()
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_package_dependencies(
    pm: &hooks::PackageManagerHandle,
    id: PackageID,
) -> hooks::DependencySlice {
    let pm = manager_ref(pm);
    let s = pm.lockfile.packages.get(id as usize).dependencies;
    // `lockfile::DependencySlice` and `hooks::DependencySlice` are both
    // `ExternalSlice<Dependency>` (same `Dependency` after MOVE_DOWN), so
    // this is a no-op; spelled via `new` for nominal-type clarity.
    hooks::DependencySlice::new(s.off, s.len)
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_package_resolutions(
    pm: &hooks::PackageManagerHandle,
    id: PackageID,
) -> hooks::ResolutionSlice {
    let pm = manager_ref(pm);
    let s = pm.lockfile.packages.get(id as usize).resolutions;
    hooks::ResolutionSlice::new(s.off, s.len)
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_package_resolution(
    pm: &hooks::PackageManagerHandle,
    id: PackageID,
) -> hooks::Resolution {
    let pm = manager_ref(pm);
    resolution_to_hooks(&pm.lockfile.packages.get(id as usize).resolution)
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_dependencies_buf<'a>(
    pm: &'a hooks::PackageManagerHandle,
) -> &'a [hooks::Dependency] {
    let pm = manager_ref(pm);
    // `dependency::Dependency` IS `hooks::Dependency` (re-export).
    pm.lockfile.buffers.dependencies.as_slice()
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_resolutions_buf<'a>(
    pm: &'a hooks::PackageManagerHandle,
) -> &'a [PackageID] {
    let pm = manager_ref(pm);
    pm.lockfile.buffers.resolutions.as_slice()
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_string_bytes<'a>(pm: &'a hooks::PackageManagerHandle) -> &'a [u8] {
    let pm = manager_ref(pm);
    pm.lockfile.buffers.string_bytes.as_slice()
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_resolve(
    pm: &hooks::PackageManagerHandle,
    name: &[u8],
    version: &hooks::DependencyVersion,
) -> Option<PackageID> {
    let pm = manager_ref(pm);
    pm.lockfile
        .resolve_package_from_name_and_version(name, version)
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_legacy_package_to_dependency_id(
    pm: &hooks::PackageManagerHandle,
    package_id: PackageID,
) -> Result<DependencyID, bun_core::Error> {
    let pm = manager_ref(pm);
    pm.lockfile
        .buffers
        .legacy_package_to_dependency_id(None, package_id)
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_str<'a>(
    pm: &'a hooks::PackageManagerHandle,
    s: &'a SemverString,
) -> &'a [u8] {
    let pm = manager_ref(pm);
    pm.lockfile.str(s)
}

// ── Lockfile writes ───────────────────────────────────────────────────────

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_append_from_package_json(
    pm: NonNull<hooks::PackageManagerHandle>,
    package_json: hooks::PackageJsonRef<'_>,
    features: Features,
) -> Result<PackageID, bun_core::Error> {
    // SAFETY: link-fn caller contract (see `manager`).
    let this = unsafe { manager(pm) };
    // Builds a `Package` from a package.json and appends it to the
    // lockfile, driven off the borrowed `PackageJsonRef` view so this
    // body does not need to name `bun_resolver::PackageJSON` directly.

    // Reshaped for borrowck — `string_builder!` borrows
    // `this.lockfile` mutably while `dep.clone_in` needs `&mut PackageManager`.
    // Use a raw pointer for the disjoint reborrow.
    let pm: *mut PackageManager = this;
    // SAFETY: `pm` derives from the exclusive `&mut PackageManager`;
    // reborrows below are disjoint
    // from `string_builder`'s borrow of `lockfile.{string_bytes,string_pool}`.
    let lockfile: &mut lockfile::Lockfile = unsafe { &mut *(*pm).lockfile };

    let mut package = Package::default();
    let mut string_builder = crate::string_builder!(lockfile);
    let mut total_dependencies_count: u32 = 0;

    // --- Counting
    string_builder.count(package_json.name);
    string_builder.count(package_json.version);
    let source_buf = package_json.dependency_source_buf;
    for dep in package_json.dependencies.values() {
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
        string_builder.append::<bun_semver::ExternalString>(package_json.name);
    package.name_hash = package_name.hash;
    package.name = package_name.value;
    package.resolution = resolution::Resolution::init(resolution::TaggedValue::Root);

    let dep_start = dependencies_list.len();
    debug_assert!(dependencies_list.len() == resolutions_list.len());

    // Default-fill the tail now and `truncate` back
    // to `dep_start` on the error path so a failed `clone_in` leaves both
    // buffer lengths consistent.
    let mut dependencies: &mut [dependency::Dependency] =
        bun_core::vec::grow_default(dependencies_list, total_dependencies_count as usize);

    for dep in package_json.dependencies.values() {
        if !dep.behavior.is_enabled(features) {
            continue;
        }
        // SAFETY: `pm` is the unique owner; `string_builder` borrows
        // disjoint lockfile fields.
        let pm_ref: &mut PackageManager = unsafe { &mut *pm };
        match dep.clone_in(pm_ref, source_buf, &mut string_builder) {
            Ok(cloned) => dependencies[0] = cloned,
            Err(e) => {
                // `string_builder.clamp()` must run on the
                // error path too. `truncate` drops the default-filled tail
                // (and any already-written deps) before restoring length.
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

    package.meta.arch = package_json.arch;
    package.meta.os = package_json.os;
    // `scripts` is left zero-init by this path, so
    // has-install-script is always false here.
    package.meta.set_has_install_script(false);

    package.dependencies = crate::lockfile::DependencySlice::new(
        dep_start as u32,
        total_dependencies_count - remaining,
    );
    package.resolutions =
        crate::lockfile::PackageIDSlice::new(package.dependencies.off, package.dependencies.len);

    let new_length = package.dependencies.len as usize + dep_start;
    // Length was bumped to `dep_start + total_dependencies_count` by
    // `grow_default` above; trim any unused tail.
    dependencies_list.truncate(new_length);
    resolutions_list.resize(new_length, bun_install_types::INVALID_PACKAGE_ID);

    string_builder.clamp();

    let appended = lockfile.append_package(&package)?;
    Ok(appended.meta.id)
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_lockfile_append_root_stub(
    pm: NonNull<hooks::PackageManagerHandle>,
) -> Result<PackageID, bun_core::Error> {
    // SAFETY: link-fn caller contract (see `manager`).
    let pm = unsafe { manager(pm) };
    let pkg = Package {
        resolution: resolution::Resolution::init(resolution::TaggedValue::Root),
        ..Default::default()
    };
    let appended = pm.lockfile.append_package(&pkg)?;
    Ok(appended.meta.id)
}

// ── PackageManager ops ────────────────────────────────────────────────────

#[unsafe(no_mangle)]
unsafe fn bun_pm_set_on_wake(
    pm: NonNull<hooks::PackageManagerHandle>,
    handler: hooks::WakeHandler,
) {
    // SAFETY: link-fn caller contract (see `manager`).
    let pm = unsafe { manager(pm) };
    pm.on_wake = handler;
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_path_for_resolution<'b>(
    pm: NonNull<hooks::PackageManagerHandle>,
    package_id: PackageID,
    resolution: &hooks::Resolution,
    buf: &'b mut [u8],
) -> Result<&'b [u8], bun_core::Error> {
    // SAFETY: link-fn caller contract (see `manager`).
    let pm = unsafe { manager(pm) };
    // The resolver passes a `bun_core::PathBuffer`-sized slice
    // (`bufs!(path_in_global_disk_cache)`); reborrow it as the install
    // signature's `&mut PathBuffer`.
    debug_assert!(buf.len() >= bun_core::MAX_PATH_BYTES);
    // SAFETY: `PathBuffer` is `#[repr(transparent)]` over
    // `[u8; MAX_PATH_BYTES]`; caller-provided slice is at least that long
    // (asserted above).
    let path_buf: &mut bun_core::PathBuffer =
        unsafe { &mut *buf.as_mut_ptr().cast::<bun_core::PathBuffer>() };
    let r = resolution_from_hooks(resolution);
    let out = directories::path_for_resolution(pm, package_id, &r, path_buf)?;
    Ok(&*out)
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_get_preinstall_state(
    pm: &hooks::PackageManagerHandle,
    package_id: PackageID,
) -> PreinstallState {
    let pm = manager_ref(pm);
    PackageManager::get_preinstall_state(pm, package_id)
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_enqueue_package_for_download(
    pm: NonNull<hooks::PackageManagerHandle>,
    name: &[u8],
    dependency_id: DependencyID,
    package_id: PackageID,
    resolution: &hooks::Resolution,
    ctx: hooks::TaskCallbackContext,
    patch_name_and_version_hash: Option<u64>,
) -> Result<(), bun_core::Error> {
    // SAFETY: link-fn caller contract (see `manager`).
    let pm = unsafe { manager(pm) };
    let r = resolution_from_hooks(resolution);
    // Only the npm arm reaches this enqueue.
    // Caller passes a `Resolution` whose tag was already checked == Npm by
    // the resolver (`resolution.tag == .npm`); the field-copy bridge
    // preserves the tag/union pairing.
    let npm = *r.npm();
    let url = pm.lockfile.str(&npm.url).to_vec();
    enqueue::enqueue_package_for_download(
        pm,
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

#[unsafe(no_mangle)]
unsafe fn bun_pm_resolve_from_disk_cache(
    pm: NonNull<hooks::PackageManagerHandle>,
    name: &[u8],
    version: &hooks::DependencyVersion,
) -> Option<PackageID> {
    // SAFETY: link-fn caller contract (see `manager`).
    let pm = unsafe { manager(pm) };
    pm_resolution::resolve_from_disk_cache(pm, name, version)
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_enqueue_dependency_to_root(
    pm: NonNull<hooks::PackageManagerHandle>,
    name: &[u8],
    version: &hooks::DependencyVersion,
    version_buf: &[u8],
    behavior: hooks::Behavior,
) -> hooks::EnqueueResult {
    // SAFETY: link-fn caller contract (see `manager`).
    let pm = unsafe { manager(pm) };
    match enqueue::enqueue_dependency_to_root(pm, name, version, version_buf, behavior) {
        enqueue::DependencyToEnqueue::Resolution {
            package_id,
            resolution,
        } => hooks::EnqueueResult::Resolution {
            package_id,
            resolution: resolution_to_hooks(&resolution),
        },
        enqueue::DependencyToEnqueue::Pending(id) => hooks::EnqueueResult::Pending(id),
        enqueue::DependencyToEnqueue::NotFound => hooks::EnqueueResult::NotFound,
        enqueue::DependencyToEnqueue::Failure(e) => hooks::EnqueueResult::Failure(e),
    }
}

// ── Dependency parsing ────────────────────────────────────────────────────

#[unsafe(no_mangle)]
unsafe fn bun_pm_parse_dependency(
    pm: NonNull<hooks::PackageManagerHandle>,
    name: SemverString,
    name_hash: Option<u64>,
    version: &[u8],
    sliced: &SlicedString,
    log: Option<&mut bun_ast::Log>,
) -> Option<hooks::DependencyVersion> {
    // SAFETY: link-fn caller contract (see `manager`).
    let pm = unsafe { manager(pm) };
    // `pm` is threaded so `parse_with_tag` can record `npm:` aliases into
    // `pm.known_npm_aliases`.
    dependency::parse(name, name_hash, version, sliced, log, Some(pm))
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_parse_dependency_with_tag(
    pm: NonNull<hooks::PackageManagerHandle>,
    name: SemverString,
    name_hash: u64,
    version: &[u8],
    tag: hooks::DependencyVersionTag,
    sliced: &SlicedString,
    log: Option<&mut bun_ast::Log>,
) -> Option<hooks::DependencyVersion> {
    // SAFETY: link-fn caller contract (see `manager`).
    let pm = unsafe { manager(pm) };
    dependency::parse_with_tag(
        name,
        Some(name_hash),
        version,
        tag,
        sliced,
        log,
        Some(pm as &mut dyn dependency::NpmAliasRegistry),
    )
}

#[unsafe(no_mangle)]
unsafe fn bun_pm_infer_dependency_tag(
    _pm: &hooks::PackageManagerHandle,
    dep: &[u8],
) -> hooks::DependencyVersionTag {
    dependency::Tag::infer(dep)
}

// ─── Lazy init (`bun_package_manager_init`, declared in `bun_resolver`) ───
//
// `bun_resolver` cannot name `PackageManager` (it would create a dep cycle).
// The returned pointer is the process-static `PackageManager` singleton
// (`get()`), cast to the opaque `PackageManagerHandle` the resolver stores.
// Init failure is sticky inside `init_with_runtime`.
//
// SAFETY (callee contract):
//   • `log` is the resolver's `NonNull<bun_ast::Log>` (Transpiler-owned,
//     process-lifetime; `init_with_runtime` stores it raw).
//   • `install` is `BundleOptions.install` (`?*Api.BunInstall`). The pointee is
//     the CLI-owned `Box<BunInstall>` (process-lifetime), read-only.
//   • `env` is the resolver's unwrapped `env_loader` (Transpiler-owned,
//     process-lifetime). `init_with_runtime` stores it as
//     `NonNull<Loader<'static>>`.
#[unsafe(no_mangle)]
unsafe fn bun_package_manager_init(
    mut log: NonNull<bun_ast::Log>,
    install: Option<NonNull<crate::bun_schema::api::BunInstall>>,
    mut env: NonNull<bun_dotenv::Loader<'static>>,
) -> Result<NonNull<hooks::PackageManagerHandle>, bun_core::Error> {
    // Idempotent.
    bun_http::http_thread::init(&Default::default());

    // SAFETY: when `Some`, `install` points at a live `Api::BunInstall`
    // (see `run_command::wire_transpiler_from_ctx`); read-only borrow.
    let bun_install: Option<&crate::bun_schema::api::BunInstall> =
        install.map(|p| unsafe { p.as_ref() });
    // SAFETY: caller guarantees `log` / `env` point at process-lifetime
    // Transpiler-owned storage with no aliasing `&mut` live across this call.
    let (log_ref, env_ref): (&mut bun_ast::Log, &mut bun_dotenv::Loader<'static>) =
        unsafe { (log.as_mut(), env.as_mut()) };

    let pm: *mut PackageManager = crate::package_manager::init_with_runtime(
        log_ref,
        bun_install,
        crate::package_manager::CommandLineArguments::default(),
        env_ref,
    )?;
    // On success `init_with_runtime` returns the non-null `holder::RAW_PTR`
    // singleton; hand it out as the opaque handle the resolver stores.
    Ok(NonNull::new(pm)
        .expect("init_with_runtime returns the holder::RAW_PTR singleton")
        .cast::<hooks::PackageManagerHandle>())
}

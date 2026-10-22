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
use core::sync::atomic::{AtomicU32, Ordering};

use bun_install_types::resolver_hooks as hooks;
use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
use bun_semver::{SlicedString, String as SemverString};
use bun_threading::Futex;

use crate::dependency;
use crate::lockfile;
use crate::package_manager::package_manager_directories as directories;
use crate::package_manager::package_manager_enqueue as enqueue;
use crate::resolution;
use crate::{PackageID, PackageManager, PreinstallState};

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

// ─── The wait of a resolve ────────────────────────────────────────────────

/// Bumped by every `PackageManager::wake_raw` of the auto-install manager.
static WAKES: AtomicU32 = AtomicU32::new(0);
/// Threads blocked on `WAKES` (Workers share the manager). At zero a wake skips the syscall.
static PARKED: AtomicU32 = AtomicU32::new(0);

/// Blocks the thread, because an event loop would run timers inside `require()`. Uses SeqCst
/// because each side writes its own word and then reads the other's.
pub(crate) struct Parked(());

impl Parked {
    pub(crate) fn new() -> Parked {
        PARKED.fetch_add(1, Ordering::SeqCst);
        Parked(())
    }

    /// Read this before draining. A task that finishes after the read then makes [`Parked::wait`]
    /// return immediately.
    pub(crate) fn wakes(&self) -> u32 {
        WAKES.load(Ordering::SeqCst)
    }

    pub(crate) fn wait(&self, wakes: u32) {
        Futex::wait_forever(&WAKES, wakes);
    }

    pub(crate) fn wake_all() {
        WAKES.fetch_add(1, Ordering::SeqCst);
        if PARKED.load(Ordering::SeqCst) > 0 {
            Futex::wake(&WAKES, u32::MAX);
        }
    }
}

impl Drop for Parked {
    fn drop(&mut self) {
        PARKED.fetch_sub(1, Ordering::SeqCst);
    }
}

// ─── impl AutoInstaller ───────────────────────────────────────────────────

impl hooks::AutoInstaller for PackageManager {
    // ── Lockfile reads ────────────────────────────────────────────────────

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
        resolution_to_hooks(&self.lockfile.packages.get(id as usize).resolution)
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
        version_buf: &[u8],
    ) -> Option<PackageID> {
        self.lockfile
            .resolve_package_from_name_and_version(name, version, version_buf)
    }

    // ── PackageManager ops ────────────────────────────────────────────────

    fn set_on_wake(&mut self, handler: hooks::WakeHandler) {
        self.on_wake = handler;
    }

    fn project_folder<'b>(
        &mut self,
        name: &[u8],
        version: &hooks::DependencyVersion,
        version_buf: &[u8],
        package_json_dir: Option<&[u8]>,
        buf: &'b mut [u8],
    ) -> Option<&'b [u8]> {
        let name_hash = bun_semver::string::Builder::string_hash(match version.try_npm() {
            Some(npm) if npm.is_alias => npm.name.slice(version_buf),
            _ => name,
        });
        let links = self.options.link_workspace_packages;
        let member: Option<SemverString> = match version.tag {
            dependency::Tag::Workspace => self.lockfile.workspace_paths.get(&name_hash).copied(),
            // A hoisted install links every workspace into the root's node_modules, whether or not
            // a package.json lists it, so an import without a declared version finds it too.
            dependency::Tag::Uninitialized if links => {
                self.lockfile.workspace_paths.get(&name_hash).copied()
            }
            dependency::Tag::Npm => lockfile::linked_workspace_path_in(
                links,
                &self.lockfile.workspace_paths,
                &self.lockfile.workspace_versions,
                name_hash,
                &version.npm().version,
                version_buf,
                self.lockfile.buffers.string_bytes.as_slice(),
            ),
            _ => None,
        };
        let (base, path): (&[u8], &[u8]) = if let Some(member) = &member {
            (self.root_dir.dir, self.lockfile.str(member))
        } else {
            let package_json_dir = package_json_dir?;
            match version.tag {
                dependency::Tag::Folder => (package_json_dir, version.folder().slice(version_buf)),
                dependency::Tag::Symlink => {
                    let target = version.symlink().slice(version_buf);
                    if dependency::is_link_path(target) {
                        (package_json_dir, target)
                    } else {
                        directories::try_global_link_dir(self).ok()?;
                        (directories::global_link_dir_path(self), target)
                    }
                }
                _ => return None,
            }
        };
        let len = join_abs_string_buf_checked::<platform::Auto>(base, buf, &[path])?.len();
        Some(&buf[..len])
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
        if let Err(why) = directories::try_get_cache_directory(self) {
            self.exit_or_log(&why);
            return Err(bun_core::Error::WriteFailed);
        }
        let r = resolution_from_hooks(resolution);
        let mut len =
            directories::path_for_resolution(self, package_id, &r, path_buf).map(|path| path.len());
        // A package that is `Done` but has no folder was skipped because it is not for this
        // platform, so it is not downloaded here either.
        if len.is_err()
            && r.tag == resolution::Tag::Npm
            && PackageManager::get_preinstall_state(self, package_id) != PreinstallState::Done
        {
            enqueue::download_missing_package(self, package_id).map_err(bun_core::Error::from)?;
            len = directories::path_for_resolution(self, package_id, &r, path_buf)
                .map(|path| path.len());
        } else if len.is_err() && r.tag != resolution::Tag::Npm {
            let buf = self.lockfile.buffers.string_bytes.as_slice();
            self.log_mut().add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "\"{}@{}\" not in cache, run `bun install`",
                    bun_core::fmt::escape_control_chars(
                        self.lockfile
                            .packages
                            .get(package_id as usize)
                            .name
                            .slice(buf)
                    ),
                    bun_core::fmt::for_terminal(r.fmt(buf, bun_core::fmt::PathSep::Posix)),
                ),
            );
        }
        Ok(&path_buf.0[..len.map_err(bun_core::Error::from)?])
    }

    fn get_preinstall_state(&self, package_id: PackageID) -> PreinstallState {
        PackageManager::get_preinstall_state(self, package_id)
    }

    fn enqueue_dependency_to_root(
        &mut self,
        name: &[u8],
        version: &hooks::DependencyVersion,
        version_buf: &[u8],
        package_json_dir: Option<&[u8]>,
        behavior: hooks::Behavior,
    ) -> hooks::EnqueueResult {
        // The package manager resolves a relative tarball path against the working directory,
        // which is the project only for `bun install`. Here the path is made absolute first.
        let mut absolute: Vec<u8> = Vec::new();
        let mut from_package_json_dir = None;
        if let Some(package_json_dir) = package_json_dir
            && version.tag == dependency::Tag::Tarball
            && let hooks::URI::Local(path) = version.tarball().uri
        {
            let mut buf = bun_paths::path_buffer_pool::get();
            let Some(joined) = join_abs_string_buf_checked::<platform::Auto>(
                package_json_dir,
                &mut buf[..],
                &[path.slice(version_buf)],
            ) else {
                return hooks::EnqueueResult::NotFound;
            };
            absolute.extend_from_slice(b"file:");
            absolute.extend_from_slice(joined);
            from_package_json_dir = <Self as hooks::AutoInstaller>::parse_dependency(
                self,
                SemverString::init(name, name),
                None,
                &absolute,
                &SlicedString::init(&absolute, &absolute),
                None,
            );
        }
        let (version, version_buf) = match &from_package_json_dir {
            Some(version) => (version, absolute.as_slice()),
            None => (version, version_buf),
        };
        match enqueue::enqueue_dependency_to_root(self, name, version, version_buf, behavior) {
            enqueue::DependencyToEnqueue::Resolution {
                package_id,
                resolution,
            } => hooks::EnqueueResult::Resolution {
                package_id,
                resolution: resolution_to_hooks(&resolution),
            },
            enqueue::DependencyToEnqueue::NotFound => hooks::EnqueueResult::NotFound,
            enqueue::DependencyToEnqueue::Failure(e) => hooks::EnqueueResult::Failure(e.into()),
        }
    }

    // ── Dependency parsing ────────────────────────────────────────────────

    fn parse_dependency(
        &mut self,
        name: SemverString,
        name_hash: Option<u64>,
        version: &[u8],
        sliced: &SlicedString,
        log: Option<&mut bun_ast::Log>,
    ) -> Option<hooks::DependencyVersion> {
        // `pm` is threaded so `parse_with_tag` can record `npm:` aliases into
        // `pm.known_npm_aliases`.
        dependency::parse(name, name_hash, version, sliced, log, Some(self))
    }

    fn parse_dependency_with_tag(
        &self,
        name: SemverString,
        name_hash: u64,
        version: &[u8],
        tag: hooks::DependencyVersionTag,
        sliced: &SlicedString,
        log: Option<&mut bun_ast::Log>,
    ) -> Option<hooks::DependencyVersion> {
        dependency::parse_with_tag(name, Some(name_hash), version, tag, sliced, log, None)
    }

    fn infer_dependency_tag(&self, dep: &[u8]) -> hooks::DependencyVersionTag {
        <dependency::Tag as dependency::TagExt>::infer(dep)
    }
}

// `PackageJSON::parse` runs before the first bare import creates the manager.
#[unsafe(no_mangle)]
#[inline(never)]
fn __bun_resolver_parse_dependency(
    name: SemverString,
    name_hash: hooks::PackageNameHash,
    version: &[u8],
    sliced: &SlicedString,
    log: Option<&mut bun_ast::Log>,
) -> Option<hooks::DependencyVersion> {
    dependency::parse(
        name,
        name_hash,
        version,
        sliced,
        log,
        None::<&mut PackageManager>,
    )
}

// ─── Lazy factory (resolver → install link-time hook) ─────────────────────
//
// `bun_resolver` cannot name `PackageManager` (it would create a dep cycle),
// so it declares this `extern "Rust"` and we provide the body here. The
// returned pointer is the process-static `PackageManager` singleton (`get()`),
// upcast to the `dyn AutoInstaller` trait object the resolver stores.
//
// SAFETY (callee contract):
//   • `log` is the resolver's `NonNull<bun_ast::Log>` (Transpiler-owned,
//     process-lifetime; `init_with_runtime` stores it raw).
//   • `install` is `BundleOptions.install` (`?*Api.BunInstall`). The pointee is
//     the CLI-owned `Box<BunInstall>` (process-lifetime), read-only.
//   • `env` is the resolver's unwrapped `env_loader` (Transpiler-owned,
//     process-lifetime). `init_with_runtime` stores it as `NonNull<Loader>`.
#[unsafe(no_mangle)]
#[inline(never)]
unsafe fn __bun_resolver_init_package_manager(
    mut log: core::ptr::NonNull<bun_ast::Log>,
    install: Option<core::ptr::NonNull<crate::bun_schema::api::BunInstall>>,
    mut env: core::ptr::NonNull<bun_dotenv::Loader>,
    prefer_offline: bool,
    importer_dir: &[u8],
) -> core::result::Result<core::ptr::NonNull<dyn hooks::AutoInstaller>, bun_resolver::Error> {
    // ABI: the resolver-side `extern "Rust"` declaration names its own
    // `Error`, whose `Sys` variant carries the real errno name, so that an
    // import fails with `EACCES` and not with `Unexpected`. Keep
    // both sides byte-identical or the `Result` layout diverges.
    //
    // Idempotent.
    bun_http::http_thread::init(&Default::default());

    // SAFETY: when `Some`, `install` points at a live `Api::BunInstall`
    // (see `run_command::wire_transpiler_from_ctx`); read-only borrow.
    let bun_install: Option<&crate::bun_schema::api::BunInstall> =
        install.map(|p| unsafe { p.as_ref() });
    // SAFETY: caller guarantees `log` / `env` point at process-lifetime
    // Transpiler-owned storage with no aliasing `&mut` live across this call.
    let (log_ref, env_ref): (&mut bun_ast::Log, &mut bun_dotenv::Loader) =
        unsafe { (log.as_mut(), env.as_mut()) };

    let pm: *mut PackageManager = crate::package_manager::init_with_runtime(
        log_ref,
        bun_install,
        &crate::package_manager::CommandLineArguments {
            prefer_offline,
            ..Default::default()
        },
        env_ref,
        importer_dir,
    )
    .map_err(|e| match e {
        crate::Error::Sys(errno) => bun_resolver::Error::Sys(errno),
        crate::Error::Resolver(
            err @ (bun_resolver::Error::Sys(_)
            | bun_resolver::Error::SecurityScannerConfigured
            | bun_resolver::Error::UnreadableConfig),
        ) => err,
        other => {
            log_ref.add_zig_error_with_note(
                other.name(),
                format_args!("while initializing the auto-install package manager"),
            );
            bun_resolver::Error::Sys(bun_errno::SystemErrno::EIO)
        }
    })?;
    // On success `init_with_runtime` returns the non-null `holder::RAW_PTR`
    // singleton; upcast to the trait object the resolver stores.
    Ok(core::ptr::NonNull::new(pm as *mut dyn hooks::AutoInstaller)
        .expect("init_with_runtime returns the holder::RAW_PTR singleton"))
}

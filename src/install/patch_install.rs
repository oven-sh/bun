use crate::lockfile::package::PackageColumns as _;
use core::ptr;

use bstr::BStr;

use bun_ast::{Loc, Log};
use bun_core::ZBox;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_paths::{self as path, PathBuffer};
use bun_resolver::fs::FileSystem;
use bun_semver::String as SemverString;
use bun_sys::{self as sys, Fd, FdExt};
use bun_threading::IntrusiveWorkTask as _;
use bun_threading::thread_pool::{
    self as thread_pool, Batch, Node as ThreadPoolNode, Task as ThreadPoolTask,
};
use bun_wyhash::Wyhash11;

use crate::package_install::PackageInstall;
use crate::package_manager;
use crate::{
    DependencyID, PackageID, PackageManager, bun_hash_tag, lockfile::Lockfile, lockfile::Package,
    resolution::Resolution,
};

// Thin re-exports (mirroring Zig `pub const X = @import(...)` lines).
pub use crate::lockfile::PatchedDep;
pub use crate::resolution::Resolution as ResolutionExport;
pub use crate::{
    DependencyID as DependencyIDExport, PackageID as PackageIDExport,
    PackageInstall as PackageInstallExport, bun_hash_tag as bun_hash_tag_export,
};
// TODO(port): the Zig file re-exports these under the same names; Rust cannot re-export and `use`
// the same identifier twice in one module without aliasing. Phase B should collapse the duplicate
// `*Export` aliases above once module layout is settled.

bun_output::declare_scope!(InstallPatch, visible);

/// Length of the hex representation of `u64::MAX` (i.e. 16).
pub const MAX_HEX_HASH_LEN: usize = const_format::formatcp!("{:x}", u64::MAX).len();
pub const MAX_BUNTAG_HASH_BUF_LEN: usize = MAX_HEX_HASH_LEN + bun_hash_tag.len() + 1;
pub type BuntagHashBuf = [u8; MAX_BUNTAG_HASH_BUF_LEN];

// `std.fs.Dir` → `bun_sys::Dir` (thin `Fd` wrapper, see sys/lib.rs).
type StdFsDir = sys::Dir;

pub struct PatchTask {
    /// BACKREF (Zig: `*PackageManager`). Stored as `BackRef` because the task
    /// is held via raw pointer through the intrusive thread-pool queue while
    /// the manager is concurrently borrowed `&mut` on the main thread; a `&`
    /// reference here would alias that exclusive borrow under Stacked Borrows.
    /// Constructed via `BackRef::new_mut` so the underlying pointer carries
    /// write provenance for `PackageManager::wake_raw(*mut Self)`, which
    /// writes the event-loop wake flag.
    pub manager: bun_ptr::BackRef<PackageManager>,
    pub tempdir: StdFsDir,
    pub project_dir: &'static [u8],
    pub callback: Callback,
    pub task: ThreadPoolTask,
    pub pre: bool,
    pub next: bun_threading::Link<PatchTask>,
}

bun_threading::intrusive_work_task!(PatchTask, task);

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue(PatchTask, .next)`.
unsafe impl bun_threading::Linked for PatchTask {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

#[derive(strum::IntoStaticStr)]
pub enum Callback {
    #[strum(serialize = "calc_hash")]
    CalcHash(CalcPatchHash),
    #[strum(serialize = "apply")]
    Apply(ApplyPatch),
}

impl Callback {
    /// Zig: `@tagName(self.callback)`.
    #[inline]
    pub fn tag_name(&self) -> &'static str {
        <&'static str>::from(self)
    }
    #[inline]
    pub fn is_calc_hash(&self) -> bool {
        matches!(self, Callback::CalcHash(_))
    }
    #[inline]
    pub fn is_apply(&self) -> bool {
        matches!(self, Callback::Apply(_))
    }
    /// Zig: `&self.callback.apply`. Panics if the active variant is not `Apply`.
    #[inline]
    pub fn apply_mut(&mut self) -> &mut ApplyPatch {
        match self {
            Callback::Apply(a) => a,
            _ => unreachable!("PatchTask.callback is not .apply"),
        }
    }
}

pub struct CalcPatchHash {
    pub patchfile_path: Box<[u8]>,
    pub name_and_version_hash: u64,

    pub state: Option<EnqueueAfterState>,

    pub result: Option<u64>,

    pub logger: Log,
}

pub struct EnqueueAfterState {
    pub pkg_id: PackageID,
    pub dependency_id: DependencyID,
    pub url: Box<[u8]>,
}

pub struct ApplyPatch {
    pub pkg_id: PackageID,
    pub patch_hash: u64,
    pub name_and_version_hash: u64,

    pub patchfilepath: Box<[u8]>,
    pub pkgname: SemverString,

    pub cache_dir: StdFsDir,
    pub cache_dir_subpath: ZBox,
    pub cache_dir_subpath_without_patch_hash: ZBox,

    /// this is non-null if this was called before a Task, for example extracting
    pub task_id: Option<TaskId>,
    pub install_context: Option<InstallContext>,
    // dependency_id: ?struct = null,
    pub logger: Log,
}

pub struct InstallContext {
    pub dependency_id: DependencyID,
    pub tree_id: crate::lockfile::tree::Id,
    pub path: Vec<u8>,
}

impl PatchTask {
    /// Destroy a heap-allocated `PatchTask` previously created by
    /// `new_calc_patch_hash` / `new_apply_patch_hash`.
    ///
    /// PORT NOTE: Zig `deinit` freed each owned field then `bun.destroy(this)`. In Rust the
    /// owned fields (`Box<[u8]>`, `Vec<u8>`, `Log`, `Option<...>`) drop automatically, so no
    /// `impl Drop` body is needed. Per PORTING.md, `deinit` is never exposed as the public API;
    /// because `PatchTask` is held via raw pointer through the intrusive `next`/thread-pool
    /// queue, the named reclaim point is `unsafe fn destroy`. Cross-file callers map
    /// `pt.deinit()` → `unsafe { PatchTask::destroy(pt) }`.
    ///
    /// # Safety
    /// `this` must have been produced by `heap::alloc` in the `new_*` constructors below and
    /// ownership must be returned here exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // TODO: how to deinit `this.callback.calc_hash.network_task` (carried over from Zig)
        drop(unsafe { bun_core::heap::take(this) });
    }

    // Safe-fn: only ever invoked by `ThreadPool` via the `callback` fn-pointer
    // with the `*mut ThreadPoolTask` we registered in `new_calc_patch_hash` /
    // `new_apply_patch_hash`. The thread-pool contract — not the Rust caller —
    // guarantees `task` is live and points at `PatchTask.task`, so the
    // precondition is discharged locally. Safe `fn` coerces to the
    // `unsafe fn(*mut Task)` field type.
    pub fn run_from_thread_pool(task: *mut ThreadPoolTask) {
        // SAFETY: thread-pool callback contract — `task` points to the `task`
        // field of a live `PatchTask` (set at construction); the pool runs
        // each task at most once with exclusive access for the call.
        let patch_task = unsafe { &mut *PatchTask::from_task_ptr(task) };
        patch_task.run_from_thread_pool_impl();
    }

    pub fn run_from_thread_pool_impl(&mut self) {
        bun_output::scoped_log!(
            InstallPatch,
            "runFromThreadPoolImpl {}",
            <&'static str>::from(&self.callback)
        );
        // PORT NOTE: Zig used nested `defer { defer wake(); push(this); }`. There are no early
        // returns in the body, so the equivalent ordering (body → push → wake) is inlined below.
        match &mut self.callback {
            Callback::CalcHash(_) => {
                let result = self.calc_hash();
                if let Callback::CalcHash(ch) = &mut self.callback {
                    ch.result = result;
                }
                // PORT NOTE: reshaped for borrowck — `calc_hash` borrows `&mut self`, so we
                // cannot hold a `&mut ch` across the call.
            }
            Callback::Apply(_) => {
                // bun.handleOom(this.apply()) → panic on OOM.
                self.apply().expect("OOM");
            }
        }
        // SAFETY: `self.manager` is a long-lived BACKREF (Zig `*PackageManager`);
        // the worker thread only touches the lock-free `patch_task_queue` and the
        // event-loop wake atomics, neither of which alias data the main thread
        // holds an exclusive borrow on.
        let mgr = self.manager.as_ptr();
        unsafe {
            (*mgr)
                .patch_task_queue
                .push(std::ptr::from_mut::<Self>(self));
            PackageManager::wake_raw(mgr);
        }
    }

    pub fn run_from_main_thread(
        &mut self,
        manager: &mut PackageManager,
        log_level: LogLevel,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        bun_output::scoped_log!(
            InstallPatch,
            "runFromThreadMainThread {}",
            <&'static str>::from(&self.callback)
        );
        let pre = self.pre;
        match &mut self.callback {
            Callback::CalcHash(_) => {
                let r = self.run_from_main_thread_calc_hash(manager, log_level);
                if pre {
                    let _ = manager
                        .pending_pre_calc_hashes
                        .fetch_sub(1, core::sync::atomic::Ordering::Relaxed);
                }
                r?;
            }
            Callback::Apply(_) => {
                self.run_from_main_thread_apply(manager);
                if pre {
                    let _ = manager
                        .pending_pre_calc_hashes
                        .fetch_sub(1, core::sync::atomic::Ordering::Relaxed);
                }
            }
        }
        Ok(())
    }

    pub fn run_from_main_thread_apply(&mut self, manager: &mut PackageManager) {
        let _ = manager; // autofix
        let Callback::Apply(apply) = &mut self.callback else {
            unreachable!()
        };
        if apply.logger.errors > 0 {
            Output::err_generic(
                "failed to apply patchfile ({})",
                format_args!("{}", BStr::new(&apply.patchfilepath)),
            );
            let _ = apply
                .logger
                .print(std::ptr::from_mut(Output::error_writer()));
            // PORT NOTE: Zig called `apply.logger.deinit()` here under `defer`. The `Log` is a
            // field and will be dropped with the task; explicit early drop is skipped to avoid
            // double-drop. If `Log::deinit` is reset-to-empty (idempotent), Phase B can restore
            // an explicit `apply.logger.clear()` here.
            // TODO(port): confirm Log drop semantics
        }
    }

    fn run_from_main_thread_calc_hash(
        &mut self,
        manager: &mut PackageManager,
        log_level: LogLevel,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // TODO only works for npm package
        // need to switch on version.tag and handle each case appropriately
        let Callback::CalcHash(calc_hash) = &mut self.callback else {
            unreachable!()
        };
        let Some(hash) = calc_hash.result else {
            if log_level != LogLevel::Silent {
                if calc_hash.logger.has_errors() {
                    let _ = calc_hash
                        .logger
                        .print(std::ptr::from_mut(Output::error_writer()));
                } else {
                    Output::err_generic(
                        "Failed to calculate hash for patch <b>{}<r>",
                        format_args!("{}", BStr::new(&calc_hash.patchfile_path)),
                    );
                }
            }
            Global::crash();
        };

        let gop = bun_core::handle_oom(
            manager
                .lockfile
                .patched_dependencies
                .get_or_put(calc_hash.name_and_version_hash),
        );
        if gop.found_existing {
            gop.value_ptr.set_patchfile_hash(Some(hash));
        } else {
            panic!("No entry for patched dependency, this is a bug in Bun.");
        }

        if let Some(state) = &calc_hash.state {
            let url = &state.url;
            let pkg_id = state.pkg_id;
            let dep_id = state.dependency_id;

            let pkg: Package = *manager.lockfile.packages.get(pkg_id as usize);
            // PORT NOTE: `Package` is not `Copy` in the Rust port; capture the
            // scalar fields we need after `determine_preinstall_state` consumes
            // it (Zig's `packages.get()` returns by-value-copy).
            let pkg_meta_id = pkg.meta.id;
            let pkg_name = pkg.name;
            let pkg_resolution_tag = pkg.resolution.tag;
            let name_and_version_hash = calc_hash.name_and_version_hash;

            let mut out_name_and_version_hash: Option<u64> = None;
            let mut out_patchfile_hash: Option<u64> = None;
            manager.set_preinstall_state(pkg_meta_id, PreinstallState::Unknown);
            match manager.determine_preinstall_state(
                &pkg,
                &mut out_name_and_version_hash,
                &mut out_patchfile_hash,
            ) {
                PreinstallState::Done => {
                    // patched pkg in folder path, should now be handled by PackageInstall.install()
                    bun_output::scoped_log!(
                        InstallPatch,
                        "pkg: {} done",
                        BStr::new(pkg_name.slice(&manager.lockfile.buffers.string_bytes))
                    );
                }
                PreinstallState::Extract => {
                    bun_output::scoped_log!(
                        InstallPatch,
                        "pkg: {} extract",
                        BStr::new(pkg_name.slice(&manager.lockfile.buffers.string_bytes))
                    );

                    // SAFETY: this arm is the `.npm` extract path; the
                    // resolution union's active variant is `npm` (see the
                    // `pkg_resolution_tag` switch below — Zig only reads
                    // `pkg.resolution.value.npm.version` here, line 183).
                    let pkg_npm_version = unsafe {
                        manager.lockfile.packages.items_resolution()[pkg_id as usize]
                            .value
                            .npm
                            .version
                    };
                    let task_id =
                        TaskId::for_npm_package(manager.lockfile.str(&pkg_name), pkg_npm_version);
                    debug_assert!(!manager.network_dedupe_map.contains_key(&task_id));

                    let is_required = manager.lockfile.buffers.dependencies[dep_id as usize]
                        .behavior
                        .is_required();
                    let pkg_again: Package = *manager.lockfile.packages.get(pkg_id as usize);
                    let network_task: *mut crate::NetworkTask =
                        package_manager::generate_network_task_for_tarball(
                            manager,
                            // TODO: not just npm package
                            task_id,
                            url,
                            is_required,
                            dep_id,
                            pkg_again,
                            Some(name_and_version_hash),
                            match pkg_resolution_tag {
                                crate::resolution_real::Tag::Npm => {
                                    Authorization::AllowAuthorization
                                }
                                _ => Authorization::NoAuthorization,
                            },
                        )?
                        .unwrap_or_else(|| unreachable!());
                    if manager.get_preinstall_state(pkg_meta_id) == PreinstallState::Extract {
                        manager.set_preinstall_state(pkg_meta_id, PreinstallState::Extracting);
                        package_manager::enqueue_network_task(manager, network_task);
                    }
                }
                PreinstallState::ApplyPatch => {
                    bun_output::scoped_log!(
                        InstallPatch,
                        "pkg: {} apply patch",
                        BStr::new(pkg_name.slice(&manager.lockfile.buffers.string_bytes))
                    );
                    let patch_task = PatchTask::new_apply_patch_hash(
                        manager,
                        pkg_meta_id,
                        hash,
                        name_and_version_hash,
                    );
                    if manager.get_preinstall_state(pkg_meta_id) == PreinstallState::ApplyPatch {
                        manager.set_preinstall_state(pkg_meta_id, PreinstallState::ApplyingPatch);
                        package_manager::enqueue_patch_task(manager, patch_task);
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    // 1. Parse patch file
    // 2. Create temp dir to do all the modifications
    // 3. Copy un-patched pkg into temp dir
    // 4. Apply patches to pkg in temp dir
    // 5. Add bun tag for patch hash
    // 6. rename() newly patched pkg to cache
    pub fn apply(&mut self) -> Result<(), bun_alloc::AllocError> {
        let Callback::Apply(patch) = &mut self.callback else {
            unreachable!()
        };
        let log = &mut patch.logger;
        bun_output::scoped_log!(InstallPatch, "apply patch task");
        // bun.assert(this.callback == .apply) — enforced by the match above.

        let dir = self.project_dir;
        let patchfile_path = &patch.patchfilepath;

        let mut absolute_patchfile_path_buf = PathBuffer::uninit();
        // 1. Parse the patch file
        let absolute_patchfile_path = path::resolve_path::join_z_buf::<path::platform::Auto>(
            &mut absolute_patchfile_path_buf.0,
            &[dir, patchfile_path],
        );
        // TODO: can the patch file be anything other than utf-8?

        let patchfile_txt =
            match sys::File::read_from(Fd::cwd(), absolute_patchfile_path.as_bytes()) {
                sys::Result::Ok(txt) => txt,
                sys::Result::Err(e) => {
                    log.add_sys_error(&e, format_args!("failed to read patchfile"));
                    return Ok(());
                }
            };
        // PORT NOTE: `defer this.manager.allocator.free(patchfile_txt)` — `patchfile_txt` is owned
        // (`Vec<u8>`/`Box<[u8]>`) and drops at end of scope.
        let patchfile = match bun_patch::parse_patch_file(&patchfile_txt) {
            Ok(p) => p,
            Err(e) => {
                log.add_error_fmt_opts(
                    format_args!("failed to parse patchfile: {}", <&'static str>::from(e)),
                    Default::default(),
                );
                return Ok(());
            }
        };
        // PORT NOTE: `defer patchfile.deinit(bun.default_allocator)` — handled by Drop.

        // 2. Create temp dir to do all the modifications
        let mut tmpname_buf = [0u8; 1024];
        let tempdir_name =
            match FileSystem::tmpname(b"tmp", &mut tmpname_buf, bun_core::fast_random()) {
                Ok(name) => name,
                // max len is 1+16+1+8+3, well below 1024
                Err(_no_space_left) => unreachable!(),
            };

        let system_tmpdir = self.tempdir;

        let pkg_name = patch.pkgname;

        let dummy_node_modules = crate::package_installer::NodeModulesFolder {
            path: Vec::<u8>::new(),
            tree_id: 0,
        };

        let (resolution_label, resolution_tag) = {
            // TODO: fix this threadsafety issue.
            // PORT NOTE: not `self.manager()` — `&mut self.callback` is live.
            // BACKREF; the lockfile is read-only while apply tasks run
            // off-thread (same contract as the Zig pointer dereference here).
            let manager = self.manager.get();
            let resolution: &Resolution =
                &manager.lockfile.packages.items_resolution()[patch.pkg_id as usize];
            let mut label = Vec::<u8>::new();
            use std::io::Write as _;
            write!(
                &mut label,
                "{}",
                resolution.fmt(
                    manager.lockfile.buffers.string_bytes.as_slice(),
                    bun_core::fmt::PathSep::Posix,
                )
            )
            .expect("OOM");
            (label, resolution.tag)
        };
        // PORT NOTE: `defer allocator.free(resolution_label)` — Vec drops at scope end.

        // 3. copy the unpatched files into temp dir
        let cache_dir_subpath_z: &ZStr = patch.cache_dir_subpath_without_patch_hash.as_zstr();
        // PORT NOTE: borrowck — `tempdir_name` borrows `tmpname_buf` mutably, but
        // `PackageInstall` also wants `&mut tmpname_buf[..]` for
        // `destination_dir_subpath_buf`. Zig aliased the two; `PackageInstall`
        // assumes `destination_dir_subpath` is a prefix slice *into*
        // `destination_dir_subpath_buf` (see `verifyGitResolution` /
        // `verifyPackageJSONNameAndVersion`). Rust can't express that aliasing
        // with `&ZStr` + `&mut [u8]`, so use a separate buffer but mirror the
        // prefix bytes so the invariant holds for any future call that reaches
        // those paths.
        let mut dest_subpath_buf = [0u8; 1024];
        dest_subpath_buf[..tempdir_name.len() + 1]
            .copy_from_slice(tempdir_name.as_bytes_with_nul());
        // PORT NOTE: not `self.manager()` — `&mut self.callback` is live.
        // BACKREF — read-only lockfile access; same contract as the Zig
        // pointer dereference here.
        let lockfile = &self.manager.get().lockfile;
        let mut pkg_install = PackageInstall {
            cache_dir: patch.cache_dir,
            cache_dir_subpath: cache_dir_subpath_z,
            destination_dir_subpath: tempdir_name,
            destination_dir_subpath_buf: &mut dest_subpath_buf[..],
            patch: None,
            progress: None,
            package_name: pkg_name,
            package_version: &resolution_label,
            file_count: 0,
            // dummy value
            node_modules: &dummy_node_modules,
            lockfile,
        };

        match pkg_install.install(true, system_tmpdir, InstallMethod::Copyfile, resolution_tag) {
            InstallResult::Success => {}
            InstallResult::Failure(reason) => {
                log.add_error_fmt_opts(
                    format_args!(
                        "{} while executing step: {}",
                        reason.err.name(),
                        BStr::new(reason.step.name())
                    ),
                    Default::default(),
                );
                return Ok(());
            }
        }

        {
            let patch_pkg_dir = match sys::openat(
                system_tmpdir.fd,
                tempdir_name,
                sys::O::RDONLY | sys::O::DIRECTORY,
                0,
            ) {
                sys::Result::Ok(fd) => fd,
                sys::Result::Err(e) => {
                    log.add_sys_error(
                        &e,
                        format_args!(
                            "failed trying to open temporary dir to apply patch to package: {}",
                            BStr::new(&resolution_label)
                        ),
                    );
                    return Ok(());
                }
            };
            let _close_guard = scopeguard::guard(patch_pkg_dir, |fd| fd.close());

            // 4. apply patch
            if let Some(e) = patchfile.apply(patch_pkg_dir) {
                log.add_error_fmt_opts(
                    format_args!("failed applying patch file: {}", e),
                    Default::default(),
                );
                return Ok(());
            }

            // 5. Add bun tag
            let bun_tag_prefix = bun_hash_tag;
            let mut buntagbuf: BuntagHashBuf = [0; MAX_BUNTAG_HASH_BUF_LEN];
            buntagbuf[..bun_tag_prefix.len()].copy_from_slice(bun_tag_prefix);
            let hashlen = {
                use std::io::Write as _;
                let mut cursor = &mut buntagbuf[bun_tag_prefix.len()..];
                let before = cursor.len();
                write!(&mut cursor, "{:x}", patch.patch_hash).expect("unreachable");
                before - cursor.len()
            };
            buntagbuf[bun_tag_prefix.len() + hashlen] = 0;
            let buntag_zstr = ZStr::from_buf(&buntagbuf, bun_tag_prefix.len() + hashlen);
            if let Err(e) = sys::File::write_file(patch_pkg_dir, buntag_zstr, b"") {
                log.add_error_fmt_opts(
                    format_args!(
                        "failed adding bun tag: {}",
                        e.with_path(buntag_zstr.as_bytes())
                    ),
                    Default::default(),
                );
                return Ok(());
            }
        }

        // 6. rename to cache dir
        let mut path_in_tmpdir_buf = PathBuffer::uninit();
        let path_in_tmpdir = path::resolve_path::join_z_buf::<path::platform::Auto>(
            &mut path_in_tmpdir_buf.0,
            &[
                tempdir_name.as_bytes(),
                // tempdir_name,
            ],
        );

        let cache_dir_subpath_z: &ZStr = patch.cache_dir_subpath.as_zstr();
        if let Err(e) = sys::renameat_concurrently(
            system_tmpdir.fd,
            path_in_tmpdir,
            patch.cache_dir.fd,
            cache_dir_subpath_z,
            sys::RenameOptions {
                move_fallback: true,
                ..Default::default()
            },
        ) {
            log.add_error_fmt_opts(
                format_args!(
                    "renaming changes to cache dir: {}",
                    e.with_path(cache_dir_subpath_z.as_bytes())
                ),
                Default::default(),
            );
            return Ok(());
        }
        Ok(())
    }

    pub fn calc_hash(&mut self) -> Option<u64> {
        let Callback::CalcHash(calc_hash) = &mut self.callback else {
            unreachable!()
        };
        let log = &mut calc_hash.logger;

        let dir = self.project_dir;
        let patchfile_path = &calc_hash.patchfile_path;

        let mut absolute_patchfile_path_buf = PathBuffer::uninit();
        // parse the patch file
        let absolute_patchfile_path = path::resolve_path::join_z_buf::<path::platform::Auto>(
            &mut absolute_patchfile_path_buf.0,
            &[dir, patchfile_path],
        );

        let stat: sys::Stat = match sys::stat(absolute_patchfile_path) {
            sys::Result::Err(e) => {
                if e.get_errno() == sys::Errno::ENOENT {
                    // PORT NOTE: not `self.manager()` — `&mut self.callback` is live.
                    // BACKREF — read-only lockfile access on the worker thread;
                    // same contract as the Zig pointer dereference here.
                    let manager = self.manager.get();
                    log.add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "Couldn't find patch file: '{}'\n\nTo create a new patch file run:\n\n  <cyan>bun patch {}<r>",
                            BStr::new(&calc_hash.patchfile_path),
                            BStr::new(
                                manager
                                    .lockfile
                                    .patched_dependencies
                                    .get(&calc_hash.name_and_version_hash)
                                    .unwrap()
                                    .path
                                    .slice(&manager.lockfile.buffers.string_bytes)
                            ),
                        ),
                    );
                    return None;
                }
                log.add_warning_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!(
                        "patchfile <b>{}<r> is empty, please restore or delete it.",
                        BStr::new(absolute_patchfile_path.as_bytes())
                    ),
                );
                return None;
            }
            sys::Result::Ok(s) => s,
        };
        let size: u64 = u64::try_from(stat.st_size).expect("int cast");
        if size == 0 {
            log.add_error_fmt(
                None,
                Loc::EMPTY,
                format_args!(
                    "patchfile <b>{}<r> is empty, please restore or delete it.",
                    BStr::new(absolute_patchfile_path.as_bytes())
                ),
            );
            return None;
        }

        let file = match sys::File::open(absolute_patchfile_path, sys::O::RDONLY, 0) {
            sys::Result::Err(e) => {
                log.add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!("failed to open patch file: {}", e),
                );
                return None;
            }
            sys::Result::Ok(f) => f,
        };
        let _close_guard = sys::CloseOnDrop::file(&file);

        let mut hasher = Wyhash11::init(0);

        // what's a good number for this? page size i guess
        const STACK_SIZE: usize = 16384;
        let mut stack = [0u8; STACK_SIZE];
        let mut read: usize = 0;
        while (read as u64) < size {
            let slice: &mut [u8] = match file.read_fill_buf(&mut stack[..]) {
                sys::Result::Ok(slice) => slice,
                sys::Result::Err(e) => {
                    log.add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "failed to read from patch file: {} ({})",
                            e,
                            BStr::new(absolute_patchfile_path.as_bytes())
                        ),
                    );
                    return None;
                }
            };
            if slice.is_empty() {
                break;
            }
            hasher.update(slice);
            read += slice.len();
        }

        Some(hasher.final_())
    }

    pub fn notify(&mut self) {
        // PORT NOTE: Zig `defer this.manager.wake()` then `push`. No early returns; inline order.
        // SAFETY: `self.manager` is a long-lived BACKREF (Zig `*PackageManager`);
        // only touches the lock-free queue and event-loop wake atomics.
        let mgr = self.manager.as_ptr();
        unsafe {
            (*mgr)
                .patch_task_queue
                .push(std::ptr::from_mut::<Self>(self));
            PackageManager::wake_raw(mgr);
        }
    }

    pub fn schedule(&mut self, batch: &mut Batch) {
        batch.push(Batch::from(&raw mut self.task));
    }

    pub fn new_calc_patch_hash(
        manager: &mut PackageManager,
        name_and_version_hash: u64,
        state: Option<EnqueueAfterState>,
    ) -> *mut PatchTask {
        let patchdep = manager
            .lockfile
            .patched_dependencies
            .get(&name_and_version_hash)
            .unwrap_or_else(|| panic!("This is a bug"));
        let patchfile_path: Box<[u8]> =
            Box::from(patchdep.path.slice(&manager.lockfile.buffers.string_bytes));
        // TODO(port): Zig used `dupeZ` (NUL-terminated). The field is typed `[]const u8` and only
        // used as a byte slice, so `Box<[u8]>` without trailing NUL should be equivalent. Verify.

        let tempdir = manager.get_temporary_directory().handle;
        let pt = Box::new(PatchTask {
            tempdir,
            callback: Callback::CalcHash(CalcPatchHash {
                state,
                patchfile_path,
                name_and_version_hash,
                result: None,
                logger: Log::init(),
            }),
            manager: bun_ptr::BackRef::new_mut(manager),
            project_dir: FileSystem::instance().top_level_dir(),
            task: ThreadPoolTask {
                node: ThreadPoolNode::default(),
                callback: Self::run_from_thread_pool,
            },
            pre: false,
            next: bun_threading::Link::new(),
        });

        bun_core::heap::into_raw(pt)
    }

    pub fn new_apply_patch_hash(
        pkg_manager: &mut PackageManager,
        pkg_id: PackageID,
        patch_hash: u64,
        name_and_version_hash: u64,
    ) -> *mut PatchTask {
        let pkg_name = pkg_manager.lockfile.packages.items_name()[pkg_id as usize];

        // PORT NOTE: borrowck — `compute_cache_dir_and_subpath` borrows `&mut PackageManager`
        // while `pkg_name.slice(..)` and `resolution` borrow `pkg_manager.lockfile` immutably.
        // Clone the slice/resolution out first.
        let pkg_name_slice = pkg_name
            .slice(&pkg_manager.lockfile.buffers.string_bytes)
            .to_vec();
        // PORT NOTE: `Resolution` is `Copy`; copy out so the lockfile borrow ends
        // before `compute_cache_dir_and_subpath` reborrows `pkg_manager` mutably.
        let resolution_clone: Resolution =
            pkg_manager.lockfile.packages.items_resolution()[pkg_id as usize];

        let mut folder_path_buf = PathBuffer::uninit();
        let stuff = package_manager::compute_cache_dir_and_subpath(
            pkg_manager,
            &pkg_name_slice,
            &resolution_clone,
            &mut folder_path_buf,
            Some(patch_hash),
        );

        let patchfilepath: Box<[u8]> = Box::from(
            pkg_manager
                .lockfile
                .patched_dependencies
                .get(&name_and_version_hash)
                .unwrap()
                .path
                .slice(&pkg_manager.lockfile.buffers.string_bytes),
        );

        let cache_dir_subpath_bytes = stuff.cache_dir_subpath.as_bytes();
        let patch_hash_idx = strings::index_of(cache_dir_subpath_bytes, b"_patch_hash=")
            .unwrap_or_else(|| panic!("This is a bug in Bun."));

        // need to dupe this as it's calculated using
        // `PackageManager.cached_package_folder_name_buf` which may be modified
        let cache_dir_subpath = ZBox::from_bytes(cache_dir_subpath_bytes);
        let cache_dir_subpath_without_patch_hash =
            ZBox::from_bytes(&cache_dir_subpath_bytes[..patch_hash_idx]);
        let cache_dir = stuff.cache_dir;

        let tempdir = pkg_manager.get_temporary_directory().handle;
        let pt = Box::new(PatchTask {
            tempdir,
            callback: Callback::Apply(ApplyPatch {
                pkg_id,
                patch_hash,
                name_and_version_hash,
                cache_dir,
                patchfilepath,
                pkgname: pkg_name,
                logger: Log::init(),
                cache_dir_subpath,
                cache_dir_subpath_without_patch_hash,
                task_id: None,
                install_context: None,
            }),
            manager: bun_ptr::BackRef::new_mut(pkg_manager),
            project_dir: FileSystem::instance().top_level_dir(),
            task: ThreadPoolTask {
                node: ThreadPoolNode::default(),
                callback: Self::run_from_thread_pool,
            },
            pre: false,
            next: bun_threading::Link::new(),
        });

        bun_core::heap::into_raw(pt)
    }
}

// TODO(port): these enum/type references are placeholders for cross-file types that live in
// `bun_install`. Phase B should replace with the real paths once those modules are ported.
use crate::PreinstallState;
use crate::network_task::Authorization;
use crate::package_install::{InstallResult, Method as InstallMethod};
use crate::package_manager::Options::LogLevel;
use crate::package_manager_task::Id as TaskId;

// ported from: src/install/patch_install.zig

use core::mem::offset_of;
use core::ptr;

use bstr::BStr;

use bun_core::{Global, Output};
use bun_logger::{self as logger, Loc, Log};
use bun_paths::{self as path, PathBuffer};
use bun_resolver::fs::FileSystem;
use bun_semver::String as SemverString;
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Fd};
use bun_threading::thread_pool::{self as thread_pool, Batch, Task as ThreadPoolTask};
use bun_wyhash::Wyhash11;

use bun_install::{
    self, bun_hash_tag, lockfile::Lockfile, resolution::Resolution, DependencyID, PackageID,
    PackageInstall, PackageManager, Task,
};

// Thin re-exports (mirroring Zig `pub const X = @import(...)` lines).
pub use bun_install::lockfile::PatchedDep;
pub use bun_install::resolution::Resolution as ResolutionExport;
pub use bun_install::{
    bun_hash_tag as bun_hash_tag_export, DependencyID as DependencyIDExport,
    PackageID as PackageIDExport, PackageInstall as PackageInstallExport,
};
// TODO(port): the Zig file re-exports these under the same names; Rust cannot re-export and `use`
// the same identifier twice in one module without aliasing. Phase B should collapse the duplicate
// `*Export` aliases above once module layout is settled.

bun_output::declare_scope!(InstallPatch, visible);

/// Length of the hex representation of `u64::MAX` (i.e. 16).
pub const MAX_HEX_HASH_LEN: usize = const_format::formatcp!("{:x}", u64::MAX).len();
pub const MAX_BUNTAG_HASH_BUF_LEN: usize = MAX_HEX_HASH_LEN + bun_hash_tag.len() + 1;
pub type BuntagHashBuf = [u8; MAX_BUNTAG_HASH_BUF_LEN];

// TODO(port): `std.fs.Dir` has no direct mapping in PORTING.md. Using `bun_sys::Fd` as the
// underlying handle; revisit if a dedicated `Dir` wrapper exists.
type StdFsDir = Fd;

pub struct PatchTask<'a> {
    pub manager: &'a PackageManager,
    pub tempdir: StdFsDir,
    pub project_dir: &'static [u8],
    pub callback: Callback,
    pub task: ThreadPoolTask,
    pub pre: bool,
    pub next: *mut PatchTask<'a>,
}

#[derive(strum::IntoStaticStr)]
pub enum Callback {
    #[strum(serialize = "calc_hash")]
    CalcHash(CalcPatchHash),
    #[strum(serialize = "apply")]
    Apply(ApplyPatch),
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
    // TODO(port): owned NUL-terminated slice type. Stored as `Box<[u8]>` whose last byte is NUL;
    // construct `ZStr` views at use sites. Phase B may introduce `bun_str::ZBox`/`CString`-like.
    pub cache_dir_subpath: Box<[u8]>,
    pub cache_dir_subpath_without_patch_hash: Box<[u8]>,

    /// this is non-null if this was called before a Task, for example extracting
    pub task_id: Option<Task::Id>,
    pub install_context: Option<InstallContext>,
    // dependency_id: ?struct = null,
    pub logger: Log,
}

pub struct InstallContext {
    pub dependency_id: DependencyID,
    pub tree_id: Lockfile::Tree::Id,
    pub path: Vec<u8>,
}

impl<'a> PatchTask<'a> {
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
    /// `this` must have been produced by `Box::into_raw` in the `new_*` constructors below and
    /// ownership must be returned here exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // TODO: how to deinit `this.callback.calc_hash.network_task` (carried over from Zig)
        drop(Box::from_raw(this));
    }

    pub extern "C" fn run_from_thread_pool(task: *mut ThreadPoolTask) {
        // SAFETY: `task` points to the `task` field of a live `PatchTask` (set at construction).
        let patch_task: &mut PatchTask<'a> = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(PatchTask, task))
                .cast::<PatchTask>()
        };
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
        self.manager.patch_task_queue.push(self as *mut _);
        self.manager.wake();
    }

    pub fn run_from_main_thread(
        &mut self,
        manager: &PackageManager,
        log_level: PackageManager::Options::LogLevel,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        bun_output::scoped_log!(
            InstallPatch,
            "runFromThreadMainThread {}",
            <&'static str>::from(&self.callback)
        );
        let _guard = scopeguard::guard(self.pre, |pre| {
            if pre {
                let _ = manager
                    .pending_pre_calc_hashes
                    .fetch_sub(1, core::sync::atomic::Ordering::Relaxed);
            }
        });
        match &mut self.callback {
            Callback::CalcHash(_) => self.run_from_main_thread_calc_hash(manager, log_level)?,
            Callback::Apply(_) => self.run_from_main_thread_apply(manager),
        }
        Ok(())
    }

    pub fn run_from_main_thread_apply(&mut self, manager: &PackageManager) {
        let _ = manager; // autofix
        let Callback::Apply(apply) = &mut self.callback else {
            unreachable!()
        };
        if apply.logger.errors > 0 {
            Output::err_generic(format_args!(
                "failed to apply patchfile ({})",
                BStr::new(&apply.patchfilepath)
            ));
            let _ = apply.logger.print(Output::error_writer());
            // PORT NOTE: Zig called `apply.logger.deinit()` here under `defer`. The `Log` is a
            // field and will be dropped with the task; explicit early drop is skipped to avoid
            // double-drop. If `Log::deinit` is reset-to-empty (idempotent), Phase B can restore
            // an explicit `apply.logger.clear()` here.
            // TODO(port): confirm Log drop semantics
        }
    }

    fn run_from_main_thread_calc_hash(
        &mut self,
        manager: &PackageManager,
        log_level: PackageManager::Options::LogLevel,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // TODO only works for npm package
        // need to switch on version.tag and handle each case appropriately
        let Callback::CalcHash(calc_hash) = &mut self.callback else {
            unreachable!()
        };
        let Some(hash) = calc_hash.result else {
            if log_level != PackageManager::Options::LogLevel::Silent {
                if calc_hash.logger.has_errors() {
                    let _ = calc_hash.logger.print(Output::error_writer());
                } else {
                    Output::err_generic(format_args!(
                        "Failed to calculate hash for patch <b>{}<r>",
                        BStr::new(&calc_hash.patchfile_path)
                    ));
                }
            }
            Global::crash();
        };

        let mut gop = manager
            .lockfile
            .patched_dependencies
            .get_or_put(calc_hash.name_and_version_hash);
        if gop.found_existing {
            gop.value_ptr.set_patchfile_hash(hash);
        } else {
            panic!("No entry for patched dependency, this is a bug in Bun.");
        }

        if let Some(state) = &calc_hash.state {
            let url = &state.url;
            let pkg_id = state.pkg_id;
            let dep_id = state.dependency_id;

            let pkg = manager.lockfile.packages.get(pkg_id);

            let mut out_name_and_version_hash: Option<u64> = None;
            let mut out_patchfile_hash: Option<u64> = None;
            manager.set_preinstall_state(pkg.meta.id, manager.lockfile, PreinstallState::Unknown);
            match manager.determine_preinstall_state(
                pkg,
                manager.lockfile,
                &mut out_name_and_version_hash,
                &mut out_patchfile_hash,
            ) {
                PreinstallState::Done => {
                    // patched pkg in folder path, should now be handled by PackageInstall.install()
                    bun_output::scoped_log!(
                        InstallPatch,
                        "pkg: {} done",
                        BStr::new(pkg.name.slice(&manager.lockfile.buffers.string_bytes))
                    );
                }
                PreinstallState::Extract => {
                    bun_output::scoped_log!(
                        InstallPatch,
                        "pkg: {} extract",
                        BStr::new(pkg.name.slice(&manager.lockfile.buffers.string_bytes))
                    );

                    let task_id = Task::Id::for_npm_package(
                        manager.lockfile.str(&pkg.name),
                        pkg.resolution.value.npm.version,
                    );
                    debug_assert!(!manager.network_dedupe_map.contains(task_id));

                    let network_task = manager
                        .generate_network_task_for_tarball(
                            // TODO: not just npm package
                            task_id,
                            url,
                            manager.lockfile.buffers.dependencies[dep_id]
                                .behavior
                                .is_required(),
                            dep_id,
                            pkg,
                            calc_hash.name_and_version_hash,
                            match pkg.resolution.tag {
                                Resolution::Tag::Npm => Authorization::Allow,
                                _ => Authorization::No,
                            },
                        )?
                        .unwrap_or_else(|| unreachable!());
                    if manager.get_preinstall_state(pkg.meta.id) == PreinstallState::Extract {
                        manager.set_preinstall_state(
                            pkg.meta.id,
                            manager.lockfile,
                            PreinstallState::Extracting,
                        );
                        manager.enqueue_network_task(network_task);
                    }
                }
                PreinstallState::ApplyPatch => {
                    bun_output::scoped_log!(
                        InstallPatch,
                        "pkg: {} apply patch",
                        BStr::new(pkg.name.slice(&manager.lockfile.buffers.string_bytes))
                    );
                    let patch_task = PatchTask::new_apply_patch_hash(
                        manager,
                        pkg.meta.id,
                        hash,
                        calc_hash.name_and_version_hash,
                    );
                    if manager.get_preinstall_state(pkg.meta.id) == PreinstallState::ApplyPatch {
                        manager.set_preinstall_state(
                            pkg.meta.id,
                            manager.lockfile,
                            PreinstallState::ApplyingPatch,
                        );
                        manager.enqueue_patch_task(patch_task);
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
        let absolute_patchfile_path = path::join_z_buf(
            &mut absolute_patchfile_path_buf,
            &[dir, patchfile_path],
            path::Style::Auto,
        );
        // TODO: can the patch file be anything other than utf-8?

        let patchfile_txt = match sys::File::read_from(Fd::cwd(), absolute_patchfile_path) {
            sys::Result::Ok(txt) => txt,
            sys::Result::Err(e) => {
                log.add_sys_error(e, format_args!("failed to read patchfile"))?;
                return Ok(());
            }
        };
        // PORT NOTE: `defer this.manager.allocator.free(patchfile_txt)` — `patchfile_txt` is owned
        // (`Vec<u8>`/`Box<[u8]>`) and drops at end of scope.
        let patchfile = match bun_patch::parse_patch_file(&patchfile_txt) {
            Ok(p) => p,
            Err(e) => {
                log.add_error_fmt_opts(
                    format_args!("failed to parse patchfile: {}", e.name()),
                    Default::default(),
                )?;
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

        let dummy_node_modules = PackageManager::PackageInstaller::NodeModulesFolder {
            path: Vec::<u8>::new(),
            tree_id: 0,
        };

        let (resolution_label, resolution_tag) = {
            // TODO: fix this threadsafety issue.
            let resolution =
                &self.manager.lockfile.packages.items_resolution()[patch.pkg_id as usize];
            // TODO(port): `packages.items(.resolution)` MultiArrayList column accessor name.
            let mut label = Vec::<u8>::new();
            use std::io::Write as _;
            write!(
                &mut label,
                "{}",
                resolution.fmt(
                    &self.manager.lockfile.buffers.string_bytes,
                    path::Style::Posix
                )
            )
            .expect("OOM");
            (label, resolution.tag)
        };
        // PORT NOTE: `defer allocator.free(resolution_label)` — Vec drops at scope end.

        // 3. copy the unpatched files into temp dir
        let mut pkg_install = PackageInstall {
            allocator: (), // TODO(port): allocator field dropped (global mimalloc)
            cache_dir: patch.cache_dir,
            cache_dir_subpath: ZStr::from_bytes_with_nul(&patch.cache_dir_subpath_without_patch_hash),
            destination_dir_subpath: tempdir_name,
            destination_dir_subpath_buf: &mut tmpname_buf[..],
            patch: None,
            progress: None,
            package_name: pkg_name,
            package_version: &resolution_label,
            // dummy value
            node_modules: &dummy_node_modules,
            lockfile: self.manager.lockfile,
        };

        match pkg_install.install(true, system_tmpdir, InstallMethod::Copyfile, resolution_tag) {
            InstallResult::Success => {}
            InstallResult::Failure(reason) => {
                return log.add_error_fmt_opts(
                    format_args!(
                        "{} while executing step: {}",
                        reason.err.name(),
                        BStr::new(reason.step.name())
                    ),
                    Default::default(),
                );
            }
        }

        {
            let patch_pkg_dir = match sys::openat(
                Fd::from_std_dir(system_tmpdir),
                tempdir_name,
                sys::O::RDONLY | sys::O::DIRECTORY,
                0,
            ) {
                sys::Result::Ok(fd) => fd,
                sys::Result::Err(e) => {
                    return log.add_sys_error(
                        e,
                        format_args!(
                            "failed trying to open temporary dir to apply patch to package: {}",
                            BStr::new(&resolution_label)
                        ),
                    );
                }
            };
            let _close_guard = scopeguard::guard(patch_pkg_dir, |fd| fd.close());

            // 4. apply patch
            if let Some(e) = patchfile.apply(patch_pkg_dir) {
                return log.add_error_fmt_opts(
                    format_args!("failed applying patch file: {}", e),
                    Default::default(),
                );
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
            // SAFETY: buntagbuf[bun_tag_prefix.len() + hashlen] == 0 written just above.
            let buntag_zstr = unsafe {
                ZStr::from_raw(buntagbuf.as_ptr(), bun_tag_prefix.len() + hashlen)
            };
            let buntagfd = match sys::openat(
                patch_pkg_dir,
                buntag_zstr,
                sys::O::RDWR | sys::O::CREAT,
                0o666,
            ) {
                sys::Result::Ok(fd) => fd,
                sys::Result::Err(e) => {
                    return log.add_error_fmt_opts(
                        format_args!(
                            "failed adding bun tag: {}",
                            e.with_path(buntag_zstr.as_bytes())
                        ),
                        Default::default(),
                    );
                }
            };
            buntagfd.close();
        }

        // 6. rename to cache dir
        let mut path_in_tmpdir_buf = PathBuffer::uninit();
        let path_in_tmpdir = path::join_z_buf(
            &mut path_in_tmpdir_buf,
            &[
                tempdir_name.as_bytes(),
                // tempdir_name,
            ],
            path::Style::Auto,
        );

        if let Some(e) = sys::renameat_concurrently(
            Fd::from_std_dir(system_tmpdir),
            path_in_tmpdir,
            Fd::from_std_dir(patch.cache_dir),
            ZStr::from_bytes_with_nul(&patch.cache_dir_subpath),
            sys::RenameOptions {
                move_fallback: true,
                ..Default::default()
            },
        )
        .as_err()
        {
            return log.add_error_fmt_opts(
                format_args!(
                    "renaming changes to cache dir: {}",
                    e.with_path(&patch.cache_dir_subpath)
                ),
                Default::default(),
            );
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
        let absolute_patchfile_path = path::join_z_buf(
            &mut absolute_patchfile_path_buf,
            &[dir, patchfile_path],
            path::Style::Auto,
        );

        let stat: sys::Stat = match sys::stat(absolute_patchfile_path) {
            sys::Result::Err(e) => {
                if e.get_errno() == sys::Errno::NOENT {
                    log.add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "Couldn't find patch file: '{}'\n\nTo create a new patch file run:\n\n  <cyan>bun patch {}<r>",
                            BStr::new(&calc_hash.patchfile_path),
                            BStr::new(
                                self.manager
                                    .lockfile
                                    .patched_dependencies
                                    .get(calc_hash.name_and_version_hash)
                                    .unwrap()
                                    .path
                                    .slice(&self.manager.lockfile.buffers.string_bytes)
                            ),
                        ),
                    )
                    .expect("OOM");
                    return None;
                }
                log.add_warning_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!(
                        "patchfile <b>{}<r> is empty, please restore or delete it.",
                        BStr::new(absolute_patchfile_path.as_bytes())
                    ),
                )
                .expect("OOM");
                return None;
            }
            sys::Result::Ok(s) => s,
        };
        let size: u64 = u64::try_from(stat.size).unwrap();
        if size == 0 {
            log.add_error_fmt(
                None,
                Loc::EMPTY,
                format_args!(
                    "patchfile <b>{}<r> is empty, please restore or delete it.",
                    BStr::new(absolute_patchfile_path.as_bytes())
                ),
            )
            .expect("OOM");
            return None;
        }

        let fd = match sys::open(absolute_patchfile_path, sys::O::RDONLY, 0) {
            sys::Result::Err(e) => {
                log.add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!("failed to open patch file: {}", e),
                )
                .expect("OOM");
                return None;
            }
            sys::Result::Ok(fd) => fd,
        };
        let _close_guard = scopeguard::guard(fd, |fd| fd.close());

        let mut hasher = Wyhash11::init(0);

        // what's a good number for this? page size i guess
        const STACK_SIZE: usize = 16384;

        let mut file = sys::File { handle: fd };
        let mut stack = [0u8; STACK_SIZE];
        let mut read: usize = 0;
        while (read as u64) < size {
            let slice = match file.read_fill_buf(&mut stack[..]) {
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
                    )
                    .expect("OOM");
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
        self.manager.patch_task_queue.push(self as *mut _);
        self.manager.wake();
    }

    pub fn schedule(&mut self, batch: &mut Batch) {
        batch.push(Batch::from(&mut self.task));
    }

    pub fn new_calc_patch_hash(
        manager: &'a PackageManager,
        name_and_version_hash: u64,
        state: Option<EnqueueAfterState>,
    ) -> *mut PatchTask<'a> {
        let patchdep = manager
            .lockfile
            .patched_dependencies
            .get(name_and_version_hash)
            .unwrap_or_else(|| panic!("This is a bug"));
        let patchfile_path: Box<[u8]> = Box::from(
            patchdep
                .path
                .slice(&manager.lockfile.buffers.string_bytes),
        );
        // TODO(port): Zig used `dupeZ` (NUL-terminated). The field is typed `[]const u8` and only
        // used as a byte slice, so `Box<[u8]>` without trailing NUL should be equivalent. Verify.

        let pt = Box::new(PatchTask {
            tempdir: manager.get_temporary_directory().handle,
            callback: Callback::CalcHash(CalcPatchHash {
                state,
                patchfile_path,
                name_and_version_hash,
                result: None,
                logger: Log::init(),
            }),
            manager,
            project_dir: FileSystem::instance().top_level_dir,
            task: ThreadPoolTask {
                callback: Self::run_from_thread_pool,
            },
            pre: false,
            next: ptr::null_mut(),
        });

        Box::into_raw(pt)
    }

    pub fn new_apply_patch_hash(
        pkg_manager: &'a PackageManager,
        pkg_id: PackageID,
        patch_hash: u64,
        name_and_version_hash: u64,
    ) -> *mut PatchTask<'a> {
        let pkg_name = pkg_manager.lockfile.packages.items_name()[pkg_id as usize];
        // TODO(port): MultiArrayList column accessor naming (`items(.name)` → `items_name()`).

        let resolution = &pkg_manager.lockfile.packages.items_resolution()[pkg_id as usize];

        let mut folder_path_buf = PathBuffer::uninit();
        let stuff = pkg_manager.compute_cache_dir_and_subpath(
            pkg_name.slice(&pkg_manager.lockfile.buffers.string_bytes),
            resolution,
            &mut folder_path_buf,
            patch_hash,
        );

        let patchfilepath: Box<[u8]> = Box::from(
            pkg_manager
                .lockfile
                .patched_dependencies
                .get(name_and_version_hash)
                .unwrap()
                .path
                .slice(&pkg_manager.lockfile.buffers.string_bytes),
        );

        let cache_dir_subpath_bytes = stuff.cache_dir_subpath.as_bytes();
        let patch_hash_idx = strings::index_of(cache_dir_subpath_bytes, b"_patch_hash=")
            .unwrap_or_else(|| panic!("This is a bug in Bun."));

        let pt = Box::new(PatchTask {
            tempdir: pkg_manager.get_temporary_directory().handle,
            callback: Callback::Apply(ApplyPatch {
                pkg_id,
                patch_hash,
                name_and_version_hash,
                cache_dir: stuff.cache_dir,
                patchfilepath,
                pkgname: pkg_name,
                logger: Log::init(),
                // need to dupe this as it's calculated using
                // `PackageManager.cached_package_folder_name_buf` which may be
                // modified
                cache_dir_subpath: dupe_z(cache_dir_subpath_bytes),
                cache_dir_subpath_without_patch_hash: dupe_z(
                    &cache_dir_subpath_bytes[..patch_hash_idx],
                ),
                task_id: None,
                install_context: None,
            }),
            manager: pkg_manager,
            project_dir: FileSystem::instance().top_level_dir,
            task: ThreadPoolTask {
                callback: Self::run_from_thread_pool,
            },
            pre: false,
            next: ptr::null_mut(),
        });

        Box::into_raw(pt)
    }
}

/// Allocate a NUL-terminated copy of `s` as `Box<[u8]>` (length includes the trailing NUL).
/// TODO(port): replace with a proper owned-ZStr type (`bun_str::ZBox`?) in Phase B.
fn dupe_z(s: &[u8]) -> Box<[u8]> {
    let mut v = Vec::with_capacity(s.len() + 1);
    v.extend_from_slice(s);
    v.push(0);
    v.into_boxed_slice()
}

// TODO(port): these enum/type references are placeholders for cross-file types that live in
// `bun_install`. Phase B should replace with the real paths once those modules are ported.
use bun_install::PreinstallState;
use bun_install::package_install::{InstallMethod, InstallResult};
use bun_install::network::Authorization;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/patch_install.zig (593 lines)
//   confidence: medium
//   todos:      12
//   notes:      &'a PackageManager on heap-intrusive struct is awkward; owned-ZStr field type, std.fs.Dir mapping, MultiArrayList column accessors, and Log early-deinit semantics need Phase B attention.
// ──────────────────────────────────────────────────────────────────────────

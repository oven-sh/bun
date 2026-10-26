use crate::lockfile::package::PackageColumns as _;

use bstr::BStr;
use std::io::Write as _;

use bun_ast::{Loc, Log, Range, Source};
use bun_core::ZBox;
use bun_core::{Global, Output};
use bun_core::{ZStr, strings};
use bun_paths as path;
use bun_resolver::fs::FileSystem;
use bun_semver::String as SemverString;
use bun_sys::{self as sys, Fd};
use bun_threading::IntrusiveWorkTask as _;
use bun_threading::thread_pool::{Batch, Node as ThreadPoolNode, Task as ThreadPoolTask};

use crate::cache_publish::StagedEntry;
use crate::package_install::PackageInstall;
use crate::package_manager;
use crate::{DependencyID, PackageID, PackageManager, lockfile::Package, resolution::Resolution};

// The directory handles on `PatchTask`/`ApplyPatch` are *borrowed views* of the
// `PackageManager`-owned cache/temp directory descriptors. Store the raw `Fd`
// so the task's drop never closes a descriptor it doesn't own. Use
// `Dir::borrow(&fd)` where a `&Dir` is needed.

pub struct PatchTask {
    /// BACKREF. Stored as `BackRef` because the task
    /// is held via raw pointer through the intrusive thread-pool queue while
    /// the manager is concurrently borrowed `&mut` on the main thread; a `&`
    /// reference here would alias that exclusive borrow under Stacked Borrows.
    /// Constructed via `BackRef::new_mut` so the underlying pointer carries
    /// write provenance for `PackageManager::wake_raw(*mut Self)`, which
    /// writes the event-loop wake flag.
    pub(crate) manager: bun_ptr::BackRef<PackageManager, bun_ptr::Mut>,
    /// Borrowed view of the manager's temp directory fd (see comment at top of file).
    pub(crate) tempdir: Fd,
    pub(crate) project_dir: &'static [u8],
    pub(crate) callback: Callback,
    pub(crate) task: ThreadPoolTask,
    pub(crate) pre: bool,
    pub(crate) next: bun_threading::Link<PatchTask>,
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

pub enum Callback {
    CalcHash(CalcPatchHash),
    Apply(ApplyPatch),
}

impl Callback {
    /// Panics if the active variant is not `Apply`.
    #[inline]
    pub(crate) fn apply_mut(&mut self) -> &mut ApplyPatch {
        match self {
            Callback::Apply(a) => a,
            _ => unreachable!("PatchTask.callback is not .apply"),
        }
    }
}

pub struct CalcPatchHash {
    pub(crate) patchfile_path: Box<[u8]>,
    pub(crate) name_and_version_hash: u64,

    pub(crate) state: Option<EnqueueAfterState>,

    pub(crate) result: Option<u64>,
    pub(crate) not_found: bool,

    pub(crate) logger: Log,
}

pub struct EnqueueAfterState {
    pub(crate) pkg_id: PackageID,
    pub(crate) dependency_id: DependencyID,
    pub(crate) url: Box<[u8]>,
}

pub struct ApplyPatch {
    pub(crate) pkg_id: PackageID,
    pub(crate) patch_hash: u64,

    pub(crate) patchfilepath: Box<[u8]>,
    pub(crate) pkgname: SemverString,

    /// Borrowed view of the manager's cache directory fd (see comment at top of file).
    pub(crate) cache_dir: Fd,
    pub(crate) cache_dir_subpath: ZBox,
    pub(crate) cache_dir_subpath_without_patch_hash: ZBox,

    /// this is non-null if this was called before a Task, for example extracting
    pub(crate) task_id: Option<TaskId>,
    pub(crate) install_context: Option<InstallContext>,
    // dependency_id: ?struct = null,
    pub(crate) logger: Log,
}

pub struct InstallContext {
    pub(crate) dependency_id: DependencyID,
    pub(crate) tree_id: crate::lockfile::tree::Id,
    pub(crate) path: Vec<u8>,
}

/// A relative path in `patchedDependencies` is resolved against the project directory.
fn resolve_patchfile_path<'a>(
    buf: &'a mut [u8],
    spill: &'a mut Vec<u8>,
    project_dir: &[u8],
    patchfile_path: &[u8],
) -> &'a ZStr {
    let base: &[u8] = if path::is_absolute(patchfile_path) {
        b""
    } else {
        project_dir
    };
    path::resolve_path::join_z_buf_spill::<path::platform::Auto>(
        buf,
        spill,
        &[base, patchfile_path],
    )
}

/// Returns `None` after logging a parse error. `log` copies the lines it quotes from `source`, so
/// `log` may outlive `source`.
pub(crate) fn parse_patch_source<'a>(
    source: &'a Source,
    log: &mut Log,
) -> Option<bun_patch::PatchFile<'a>> {
    let at = |offset: usize| Range {
        loc: Loc {
            start: i32::try_from(offset).unwrap_or(i32::MAX),
        },
        len: 0,
    };
    let patchfile = match bun_patch::parse_patch_file(&source.contents) {
        Ok(patchfile) => patchfile,
        Err(e) => {
            log.add_range_error_fmt(
                Some(source),
                at(e.offset),
                format_args!("failed to parse patchfile: {}", <&'static str>::from(e.err)),
            );
            return None;
        }
    };
    for section in &patchfile.skipped {
        let subject = match section.path.map(bun_core::fmt::escape_control_chars) {
            Some(path) => path.to_string(),
            None => "non-patch text".to_owned(),
        };
        log.add_range_warning_fmt_with_notes(
            Some(source),
            at(section.offset),
            Box::new([bun_ast::range_data(
                None,
                Range::NONE,
                "recreate the patch with bun patch, or delete these lines",
            )]),
            format_args!(
                "skipping {}: {}",
                subject,
                if section.is_binary {
                    "binary file, content not in patch"
                } else {
                    "no applicable changes"
                },
            ),
        );
    }
    Some(patchfile)
}

/// The first 8 bytes of the patch file's SHA-1, used in the patched package's cache folder name.
pub(crate) fn hash_patch(contents: &[u8]) -> u64 {
    let mut hasher = bun_sha_hmac::sha::hashers::SHA1::init();
    hasher.update(contents);
    let mut digest = [0u8; bun_sha_hmac::sha::hashers::SHA1::DIGEST];
    hasher.r#final(&mut digest);
    u64::from_le_bytes(digest[0..8].try_into().unwrap())
}

/// Exits before any linker runs when a patch file is missing, because the patched package in
/// node_modules may hold the only remaining copy of those changes.
#[cold]
fn crash_on_missing_patch(
    manager: &mut PackageManager,
    patch: &CalcPatchHash,
    log_level: LogLevel,
) -> Result<(), crate::Error> {
    // A `bun patch --commit` of another package still writes its patch file before the exit.
    // Otherwise that patch could be lost too.
    let committed = package_manager::patch_package::write_pending_patch(manager)?;
    if committed.is_some() {
        package_manager::package_json_write_back::flush(manager)?;
    }
    if log_level != LogLevel::Silent {
        bun_core::pretty_errorln!(
            "<r><red>error<r>: patch file not found: '{}'",
            bun_core::fmt::escape_control_chars(&patch.patchfile_path),
        );
        let keys = crate::update_transitive::patched_dependency_keys(manager);
        if let Some(key) = keys.iter().find(|key| {
            bun_semver::string::Builder::string_hash(key) == patch.name_and_version_hash
        }) {
            bun_core::pretty_errorln!(
                "\nTo recreate it from the patched package in node_modules, run:\n\n  <cyan>bun patch --commit {}<r>\n\nTo install without the patch, remove \"{}\" from \"patchedDependencies\" in package.json",
                bun_core::fmt::escape_control_chars(key),
                bun_core::fmt::escape_control_chars(key),
            );
        }
        if let Some(committed) = committed {
            bun_core::note!(
                "wrote {}, install did not run",
                bun_core::fmt::escape_control_chars(committed.as_bytes()),
            );
        }
    }
    Global::crash();
}

impl PatchTask {
    /// # Safety
    /// Only invoked by `ThreadPool` via the `callback` fn-pointer registered in
    /// `new_calc_patch_hash` / `new_apply_patch_hash`. `task` must be live and
    /// point at the `task` field of a heap-allocated `PatchTask`, with the pool
    /// granting exclusive access for the duration of the call.
    pub(crate) unsafe fn run_from_thread_pool(task: *mut ThreadPoolTask) {
        // SAFETY: thread-pool callback contract — `task` points to the `task`
        // field of a live `PatchTask` (set at construction); the pool runs
        // each task at most once with exclusive access for the call.
        let patch_task = unsafe { &mut *PatchTask::from_task_ptr(task) };
        patch_task.run_from_thread_pool_impl();
    }

    pub(crate) fn run_from_thread_pool_impl(&mut self) {
        // There are no early returns in the body, so the ordering
        // (body → push → wake) is inlined below.
        match &mut self.callback {
            Callback::CalcHash(_) => {
                let result = self.calc_hash();
                if let Callback::CalcHash(ch) = &mut self.callback {
                    ch.result = result;
                }
                // Reshaped for borrowck — `calc_hash` borrows `&mut self`, so we
                // cannot hold a `&mut ch` across the call.
            }
            Callback::Apply(_) => {
                bun_core::handle_oom(self.apply());
            }
        }
        let mgr = self.manager.as_ptr();
        // SAFETY: `self.manager` is a long-lived BACKREF;
        // the worker thread only touches the lock-free `patch_task_queue` and the
        // event-loop wake atomics, neither of which alias data the main thread
        // holds an exclusive borrow on.
        unsafe {
            (*mgr)
                .patch_task_queue
                .push(core::ptr::NonNull::from(&mut *self));
            PackageManager::wake_raw(mgr);
        }
    }

    pub(crate) fn run_from_main_thread(
        &mut self,
        manager: &mut PackageManager,
        log_level: LogLevel,
    ) -> Result<(), crate::Error> {
        let result = if matches!(self.callback, Callback::CalcHash(_)) {
            self.run_from_main_thread_calc_hash(manager, log_level)
        } else {
            self.run_from_main_thread_apply();
            Ok(())
        };
        if self.pre {
            let _ = manager
                .pending_pre_calc_hashes
                .fetch_sub(1, core::sync::atomic::Ordering::Relaxed);
        }
        result
    }

    fn run_from_main_thread_apply(&mut self) {
        let Callback::Apply(apply) = &mut self.callback else {
            unreachable!()
        };
        if apply.logger.errors > 0 {
            Output::err_generic(
                "failed to apply patchfile ({})",
                format_args!("{}", BStr::new(&apply.patchfilepath)),
            );
        }
        let _ = apply
            .logger
            .print(std::ptr::from_mut(Output::error_writer()));
    }

    fn run_from_main_thread_calc_hash(
        &mut self,
        manager: &mut PackageManager,
        log_level: LogLevel,
    ) -> Result<(), crate::Error> {
        // TODO only works for npm package
        // need to switch on version.tag and handle each case appropriately
        let Callback::CalcHash(calc_hash) = &mut self.callback else {
            unreachable!()
        };
        match calc_hash.result {
            Some(hash) => {
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
            }
            None if calc_hash.not_found => {
                crash_on_missing_patch(manager, calc_hash, log_level)?;
            }
            None => {
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
            }
        }

        if let Some(state) = &calc_hash.state {
            let url = &state.url;
            let pkg_id = state.pkg_id;
            let dep_id = state.dependency_id;

            let pkg: Package = *manager.lockfile.packages.get(pkg_id as usize);
            // `Package` is not `Copy`; capture the scalar fields we need
            // after `determine_preinstall_state` consumes it.
            let pkg_meta_id = pkg.meta.id;
            let pkg_name = pkg.name;
            let pkg_resolution_tag = pkg.resolution.tag;
            let name_and_version_hash = calc_hash.name_and_version_hash;
            let dep_behavior = manager.lockfile.buffers.dependencies[dep_id as usize].behavior;

            let mut out_name_and_version_hash: Option<u64> = None;
            let mut out_patchfile_hash: Option<u64> = None;
            manager.set_preinstall_state(pkg_meta_id, PreinstallState::Unknown);
            match manager.determine_preinstall_state(
                &pkg,
                dep_behavior,
                &mut out_name_and_version_hash,
                &mut out_patchfile_hash,
            ) {
                // `--lockfile-only` downloads no tarball, whether or not the package has a patch.
                PreinstallState::Extract
                    if !(manager.options.do_).contains(
                        crate::package_manager_real::options::Do::PREFETCH_RESOLVED_TARBALLS,
                    ) => {}
                PreinstallState::Extract => {
                    // SAFETY: every `Resolution` `Value` payload is `Copy`
                    // POD and the union is zero-initialized (see the union
                    // accessors in resolution.rs), so reading `.npm.version`
                    // yields initialized bytes even when the active variant
                    // is not `npm` — possibly stale, never uninit. This arm
                    // is reachable for non-npm resolutions too (git/github/
                    // tarball; see the TODO below), which then read garbage
                    // version bytes into the task id, not UB.
                    let pkg_npm_version = unsafe {
                        manager.lockfile.packages.items_resolution()[pkg_id as usize]
                            .value
                            .npm
                            .version
                    };
                    let task_id =
                        TaskId::for_npm_package(manager.lockfile.str(&pkg_name), pkg_npm_version);
                    debug_assert!(!manager.network_dedupe_map.contains_key(&task_id));

                    let is_required = dep_behavior.is_required();
                    let pkg_again: Package = *manager.lockfile.packages.get(pkg_id as usize);
                    let network_task: *mut crate::NetworkTask =
                        match package_manager::generate_network_task_for_tarball(
                            manager,
                            // TODO: not just npm package
                            task_id,
                            url,
                            is_required,
                            dep_id,
                            &pkg_again,
                            match pkg_resolution_tag {
                                crate::resolution_real::Tag::Npm => {
                                    Authorization::AllowAuthorization
                                }
                                _ => Authorization::NoAuthorization,
                            },
                        ) {
                            // --offline and not cached: already reported / skipped; nothing to patch
                            Err(crate::network_task::ForTarballError::Offline) => return Ok(()),
                            other => other?.unwrap_or_else(|| unreachable!()),
                        };
                    if manager.get_preinstall_state(pkg_meta_id) == PreinstallState::Extract {
                        manager.set_preinstall_state(pkg_meta_id, PreinstallState::Extracting);
                        package_manager::enqueue_network_task(manager, network_task);
                    }
                }
                PreinstallState::ApplyPatch => {
                    let patch_task = PatchTask::new_apply_patch_hash(
                        manager,
                        pkg_meta_id,
                        out_patchfile_hash.unwrap(),
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
    pub(crate) fn apply(&mut self) -> Result<(), bun_alloc::AllocError> {
        let Callback::Apply(patch) = &mut self.callback else {
            unreachable!()
        };
        let log = &mut patch.logger;

        let dir = self.project_dir;
        let patchfile_path = &patch.patchfilepath;

        let mut absolute_patchfile_path_buf = bun_paths::path_buffer_pool::get();
        let mut absolute_patchfile_path_spill = Vec::new();
        // 1. Parse the patch file
        let absolute_patchfile_path = resolve_patchfile_path(
            &mut absolute_patchfile_path_buf.0,
            &mut absolute_patchfile_path_spill,
            dir,
            patchfile_path,
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
        let source = Source::init_path_string_owned(&patchfile_path[..], patchfile_txt);
        let Some(patchfile) = parse_patch_source(&source, log) else {
            return Ok(());
        };

        // 2. Create temp dir to do all the modifications
        let mut tmpname_buf = [0u8; 1024];
        let tempdir_name =
            match FileSystem::tmpname(b"tmp", &mut tmpname_buf, bun_core::fast_random()) {
                Ok(name) => name,
                // max len is 1+16+1+8+3, well below 1024
                Err(_no_space_left) => unreachable!(),
            };

        let system_tmpdir = self.tempdir;
        let staging = StagedEntry::new(system_tmpdir, tempdir_name);

        let pkg_name = patch.pkgname;

        let dummy_node_modules = crate::package_installer::NodeModulesFolder {
            path: Vec::<u8>::new(),
            tree_id: 0,
        };

        let (resolution_label, resolution_tag) = {
            // TODO: fix this threadsafety issue.
            // Not `self.manager()` — `&mut self.callback` is live.
            // BACKREF; the lockfile is read-only while apply tasks run
            // off-thread.
            let manager = self.manager.get();
            let resolution: &Resolution =
                &manager.lockfile.packages.items_resolution()[patch.pkg_id as usize];
            let mut label = Vec::<u8>::new();
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

        // 3. copy the unpatched files into temp dir
        let cache_dir_subpath_z: &ZStr = patch.cache_dir_subpath_without_patch_hash.as_zstr();
        // Not `self.manager()` — `&mut self.callback` is live.
        // BACKREF — read-only lockfile access while the task runs off-thread.
        let lockfile = &self.manager.get().lockfile;
        let mut pkg_install = PackageInstall {
            cache_dir: patch.cache_dir,
            cache_dir_subpath: cache_dir_subpath_z,
            destination_dir_subpath: tempdir_name,
            patch: None,
            package_name: pkg_name,
            package_version: &resolution_label,
            // dummy value
            node_modules: &dummy_node_modules,
            lockfile,
        };

        match pkg_install.install(
            crate::package_install::Staging::Off,
            true,
            sys::Dir::borrow(&system_tmpdir),
            InstallMethod::Copyfile,
            resolution_tag,
        ) {
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
                system_tmpdir,
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
                            bun_core::fmt::for_terminal(BStr::new(&resolution_label))
                        ),
                    );
                    return Ok(());
                }
            };
            let _close_guard = sys::CloseOnDrop::new(patch_pkg_dir);

            // 4. apply patch
            if let Err(e) = patchfile.apply(patch_pkg_dir) {
                log.add_error_fmt_opts(
                    format_args!("failed applying patch file: {}", e),
                    Default::default(),
                );
                return Ok(());
            }

            // 5. Add bun tag
            let mut buntagbuf = crate::BuntagHashBuf::default();
            let len = crate::buntaghashbuf_make(&mut buntagbuf, patch.patch_hash).len();
            let buntag_zstr = ZStr::from_buf(&buntagbuf, len);
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

        // 6. Rename it into the cache directory. The name includes the hash of the patch, so a
        //    folder that's already there is a cache hit.
        let cache_dir_subpath_z: &ZStr = patch.cache_dir_subpath.as_zstr();
        if let Err(mut e) = staging.publish(patch.cache_dir, cache_dir_subpath_z, &|_| true) {
            e.err = e.err.with_path(cache_dir_subpath_z.as_bytes());
            log.add_error_fmt_opts(
                format_args!("renaming changes to cache dir: {}", e),
                Default::default(),
            );
        }
        Ok(())
    }

    pub(crate) fn calc_hash(&mut self) -> Option<u64> {
        let Callback::CalcHash(calc_hash) = &mut self.callback else {
            unreachable!()
        };
        if calc_hash.result.is_some() {
            return calc_hash.result;
        }
        let log = &mut calc_hash.logger;

        let dir = self.project_dir;
        let patchfile_path = &calc_hash.patchfile_path;

        let mut absolute_patchfile_path_buf = bun_paths::path_buffer_pool::get();
        let mut absolute_patchfile_path_spill = Vec::new();
        // parse the patch file
        let absolute_patchfile_path = resolve_patchfile_path(
            &mut absolute_patchfile_path_buf.0,
            &mut absolute_patchfile_path_spill,
            dir,
            patchfile_path,
        );

        let stat: sys::Stat = match sys::stat(absolute_patchfile_path) {
            sys::Result::Err(e) => {
                if e.get_errno() == sys::Errno::ENOENT {
                    calc_hash.not_found = true;
                    return None;
                }
                log.add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!("failed to read patch file: {}", e),
                );
                return None;
            }
            sys::Result::Ok(s) => s,
        };
        let size: u64 = u64::try_from(stat.st_size).expect("int cast");
        if size == 0 {
            bun_ast::add_error_pretty!(
                log,
                None,
                Loc::EMPTY,
                "patchfile <b>{}<r> is empty, please restore or delete it.",
                bun_core::fmt::escape_control_chars(absolute_patchfile_path.as_bytes()),
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

        match file.read_to_end() {
            sys::Result::Ok(contents) => Some(hash_patch(&contents)),
            sys::Result::Err(e) => {
                log.add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!(
                        "failed to read from patch file: {} ({})",
                        e,
                        bun_core::fmt::escape_control_chars(absolute_patchfile_path.as_bytes())
                    ),
                );
                None
            }
        }
    }

    pub(crate) fn schedule(&mut self, batch: &mut Batch) {
        batch.push(Batch::from(&raw mut self.task));
    }

    pub(crate) fn new_calc_patch_hash(
        manager: &mut PackageManager,
        name_and_version_hash: u64,
        state: Option<EnqueueAfterState>,
    ) -> Box<PatchTask> {
        let patchdep = manager
            .lockfile
            .patched_dependencies
            .get(&name_and_version_hash)
            .unwrap_or_else(|| panic!("This is a bug"));
        let patchfile_path: Box<[u8]> =
            Box::from(patchdep.path.slice(&manager.lockfile.buffers.string_bytes));
        // The field is only ever consumed as a byte slice (`join_z_buf` input,
        // log formatting), so no trailing NUL is needed.

        let result = (manager.pending_patch_commit).patch_hash(name_and_version_hash);
        let tempdir = manager.get_temporary_directory().handle.fd();
        Box::new(PatchTask {
            tempdir,
            callback: Callback::CalcHash(CalcPatchHash {
                state,
                patchfile_path,
                name_and_version_hash,
                result,
                not_found: false,
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
        })
    }

    pub(crate) fn new_apply_patch_hash(
        pkg_manager: &mut PackageManager,
        pkg_id: PackageID,
        patch_hash: u64,
        name_and_version_hash: u64,
    ) -> Box<PatchTask> {
        let pkg_name = pkg_manager.lockfile.packages.items_name()[pkg_id as usize];

        // Borrowck — `compute_cache_dir_and_subpath` borrows `&mut PackageManager`
        // while `pkg_name.slice(..)` and `resolution` borrow `pkg_manager.lockfile` immutably.
        // Clone the slice/resolution out first.
        let pkg_name_slice = pkg_name
            .slice(&pkg_manager.lockfile.buffers.string_bytes)
            .to_vec();
        // `Resolution` and `Integrity` are `Copy`; copy out so the lockfile borrow ends
        // before `compute_cache_dir_and_subpath` reborrows `pkg_manager` mutably.
        let resolution_clone: Resolution =
            pkg_manager.lockfile.packages.items_resolution()[pkg_id as usize];
        let integrity = pkg_manager.lockfile.packages.items_meta()[pkg_id as usize].integrity;

        let mut folder_path_buf = bun_paths::path_buffer_pool::get();
        let stuff = package_manager::compute_cache_dir_and_subpath(
            pkg_manager,
            &pkg_name_slice,
            &resolution_clone,
            &integrity,
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

        let tempdir = pkg_manager.get_temporary_directory().handle.fd();
        Box::new(PatchTask {
            tempdir,
            callback: Callback::Apply(ApplyPatch {
                pkg_id,
                patch_hash,
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
        })
    }
}

/// How a patched package in a hoisted `node_modules` names its patch: the first key of package.json, or line 2 of `.bun-tag`.
pub(crate) struct PatchStamp;

/// What an installed copy names, see [`PatchStamp::name`]. Empty when it names nothing.
pub(crate) type PatchName = bun_core::BoundedArray<u8, { crate::bun_json::PATCH_HASH_MAX_LEN }>;

impl PatchStamp {
    fn in_bun_tag(tag: ResolutionTag) -> bool {
        tag.is_git() || tag.is_tarball()
    }

    /// The file of a package that `PackageInstall::verify` reads.
    pub(crate) fn file(tag: ResolutionTag) -> &'static ZStr {
        if Self::in_bun_tag(tag) {
            bun_core::zstr!(".bun-tag")
        } else {
            bun_core::zstr!("package.json")
        }
    }

    fn file_path<'a>(
        buf: &'a mut [u8],
        spill: &'a mut Vec<u8>,
        folder: &[u8],
        tag: ResolutionTag,
    ) -> &'a ZStr {
        path::resolve_path::join_z_buf_spill::<path::platform::Auto>(
            buf,
            spill,
            &[folder, Self::file(tag).as_bytes()],
        )
    }

    /// The first 8 bytes of the integrity that bun.lock pins, 0 when it pins none. No tarball holds its own integrity, so a key with these bytes is not one that the package was published with.
    pub(crate) fn pinned(integrity: &Integrity) -> u64 {
        let [b0, b1, b2, b3, b4, b5, b6, b7, ..] = integrity.value;
        if integrity.tag.is_supported() {
            u64::from_be_bytes([b0, b1, b2, b3, b4, b5, b6, b7])
        } else {
            0
        }
    }

    /// What names `patch` in [`Self::file`]: the digits of the patch hash in the `_patch_hash=` cache folder and, in a package.json, `.` and [`Self::pinned`]. `None` for a copy that gets no name: a folder or a link is the user's own, and the key of a registry package without [`Self::pinned`] can be one that it was published with.
    pub(crate) fn name(tag: ResolutionTag, patch: Patch) -> Option<PatchName> {
        let mut hex = [0u8; 16];
        let mut name = PatchName::default();
        name.append_slice_assume_capacity(bun_core::fmt::u64_hex_var_lower(
            &mut hex,
            patch.contents_hash,
        ));
        if Self::in_bun_tag(tag) {
            return Some(name);
        }
        if tag != ResolutionTag::Npm || patch.pinned == 0 {
            return None;
        }
        name.append_assume_capacity(b'.');
        name.append_slice_assume_capacity(bun_core::fmt::u64_hex_var_lower(&mut hex, patch.pinned));
        Some(name)
    }

    /// Whether `bun install` wrote `named` into the copy of the package with `integrity`.
    pub(crate) fn is_written(tag: ResolutionTag, named: &[u8], integrity: &Integrity) -> bool {
        if Self::in_bun_tag(tag) {
            return !named.is_empty();
        }
        let pinned = Self::pinned(integrity);
        let mut hex = [0u8; 16];
        let pinned_hex = bun_core::fmt::u64_hex_var_lower(&mut hex, pinned);
        pinned != 0 && matches!(named.strip_suffix(pinned_hex), Some([_, .., b'.']))
    }

    /// The digits of the patch hash in `named`, as the name of its marker has them.
    fn patch_hash_digits(named: &[u8]) -> Option<&[u8]> {
        let digits = strings::split_once_char(named, b'.').map_or(named, |(digits, _)| digits);
        let is_hash = (1..=16).contains(&digits.len()) && digits.iter().all(u8::is_ascii_hexdigit);
        is_hash.then_some(digits)
    }

    /// Whether `named` holds the hash of `patch`, for any integrity.
    pub(crate) fn names_patch(named: &[u8], patch: Patch) -> bool {
        let mut hex = [0u8; 16];
        let wanted = bun_core::fmt::u64_hex_var_lower(&mut hex, patch.contents_hash);
        Self::patch_hash_digits(named) == Some(wanted)
    }

    /// Removes the marker of the patch that the copy at `package_subpath` of `dir` names, before a package with `patch` is linked into the folder of that copy. Such a link keeps every file that the new package does not have, and the marker of another patch must not pass for the marker of the new copy. The marker of `patch` itself stays: the link puts it there again, and until then another install must find it.
    #[cold]
    pub(crate) fn remove_named_marker(
        dir: &sys::Dir,
        package_subpath: &[u8],
        tag: ResolutionTag,
        patch: Option<Patch>,
    ) {
        use sys::EntryKind;
        // Behind a link there is a folder that is not this copy.
        if crate::prune::entry_kind(dir, package_subpath, EntryKind::Unknown)
            != EntryKind::Directory
        {
            return;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let mut spill = Vec::new();
        let path = Self::file_path(&mut buf.0, &mut spill, package_subpath, tag);
        let Ok(contents) = sys::File::read_from(dir.fd(), path.as_bytes()) else {
            return;
        };
        let named = if Self::in_bun_tag(tag) {
            BunTag::parse(&contents).patch
        } else {
            PackageJSONVersionChecker::leading_patch_hash(&contents).unwrap_or(b"")
        };
        let Some(digits) = Self::patch_hash_digits(named) else {
            return;
        };
        if patch.is_some_and(|patch| Self::names_patch(named, patch)) {
            return;
        }
        let marker = [crate::bun_hash_tag, digits].concat();
        let marker =
            path::resolve_path::join_z::<path::platform::Posix>(&[package_subpath, &marker]);
        let _ = sys::unlinkat(dir.fd(), marker);
    }

    /// Whether the patch file that bun.lock lists under `name_and_version_hash` has a section for the file `added` of the package.
    #[cold]
    pub(crate) fn patch_file_adds(
        lockfile: &crate::lockfile::Lockfile,
        name_and_version_hash: u64,
        added: &[u8],
    ) -> bool {
        let Some(patch) = lockfile.patched_dependencies.get(&name_and_version_hash) else {
            return false;
        };
        let mut buf = bun_paths::path_buffer_pool::get();
        let mut spill = Vec::new();
        let path = resolve_patchfile_path(
            &mut buf.0,
            &mut spill,
            FileSystem::instance().top_level_dir(),
            patch.path.slice(&lockfile.buffers.string_bytes),
        );
        let Ok(contents) = sys::File::read_from(Fd::cwd(), path.as_bytes()) else {
            return false;
        };
        let header_end = [b" b/".as_slice(), added].concat();
        let mut rest = contents.as_slice();
        while let Some(at) = strings::index_of(rest, &header_end) {
            let line = strings::last_index_of_char(&rest[..at], b'\n').map_or(0, |end| end + 1);
            let after = &rest[at + header_end.len()..];
            if rest[line..at].starts_with(b"diff --git ")
                && matches!(after.first(), None | Some(b'\n' | b'\r'))
            {
                return true;
            }
            rest = after;
        }
        false
    }

    /// `contents` of [`Self::file`] with `name` in them. `None` when they hold it already, or are a package.json whose root is no object.
    fn stamped(tag: ResolutionTag, contents: &[u8], name: &[u8]) -> Option<Vec<u8>> {
        if Self::in_bun_tag(tag) {
            let bun_tag = BunTag::parse(contents);
            return (bun_tag.patch != name).then(|| [bun_tag.resolved, b"\n", name].concat());
        }
        if PackageJSONVersionChecker::leading_patch_hash(contents) == Some(name) {
            return None;
        }
        PackageJSONVersionChecker::with_patch_hash(contents, name)
    }

    /// The contents of a file and its permission bits.
    fn read(dir: Fd, path: &ZStr) -> sys::Result<(Vec<u8>, sys::Mode)> {
        let file = sys::File::openat(dir, path.as_bytes(), sys::O::RDONLY, 0)?;
        let mode = (file.stat()?.st_mode as sys::Mode) & 0o777;
        Ok((file.read_to_end()?, mode))
    }

    /// A new file with the permission bits `mode`.
    pub(crate) fn create_file(dir: Fd, path: &[u8], mode: sys::Mode) -> sys::Result<sys::File> {
        let flags = sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL;
        let file = sys::File::openat(dir, path, flags, mode)?;
        // The umask cut the mode. On Windows `openat` took it, and `fchmod` wants a descriptor of libuv.
        #[cfg(not(windows))]
        let _ = sys::fchmod(file.handle(), mode);
        Ok(file)
    }

    /// Puts `bytes` in place of the file at `path` of `dir`: a new file in the same folder, renamed over the old one. The old file can be the file of the cache, through a hard link or a symlink, and it stays whole when a step fails. The new file has the prefix of a marker until it is renamed: if a kill leaves it there, `bun patch --commit` does not take it for a file of the package, and the next install links the package again.
    fn replace_file(dir: Fd, path: &ZStr, bytes: &[u8], mode: sys::Mode) -> sys::Result<()> {
        let mut random = [0u8; 8];
        bun_boringssl_sys::rand_bytes(&mut random);
        let mut hex = [0u8; 16];
        let random = bun_core::fmt::u64_hex_var_lower(&mut hex, u64::from_ne_bytes(random));
        let folder = &path.as_bytes()[..path.len() - path::basename(path.as_bytes()).len()];
        let temp = ZBox::from_vec([folder, crate::bun_hash_tag, random, b".tmp"].concat());
        let file = Self::create_file(dir, temp.as_bytes(), mode)?;
        let written = file.write_all(bytes);
        // Windows renames no open file.
        drop(file);
        let replaced = written.and_then(|()| sys::renameat(dir, &temp, dir, path));
        if replaced.is_err() {
            let _ = sys::unlinkat(dir, &temp);
        }
        replaced
    }

    /// [`Self::file`] of the copy in `folder` without what `bun install` wrote there to name a patch, and the permission bits of that file. `None` when it wrote nothing.
    pub(crate) fn without_name(
        folder: &[u8],
        unpatched_folder: &[u8],
        tag: ResolutionTag,
    ) -> Option<(Vec<u8>, sys::Mode)> {
        let mut buf = bun_paths::path_buffer_pool::get();
        let mut spill = Vec::new();
        let path = Self::file_path(&mut buf.0, &mut spill, folder, tag);
        let (contents, mode) = Self::read(Fd::cwd(), path).ok()?;
        if Self::in_bun_tag(tag) {
            let bun_tag = BunTag::parse(&contents);
            return (!bun_tag.patch.is_empty()).then(|| (bun_tag.resolved.to_vec(), mode));
        }
        let path = Self::file_path(&mut buf.0, &mut spill, unpatched_folder, tag);
        let unpatched = sys::File::read_from(Fd::cwd(), path.as_bytes()).unwrap_or_default();
        // A key that the unpatched package holds too was published with it.
        let without_name = PackageJSONVersionChecker::without_patch_hashes(&contents, &unpatched);
        without_name.map(|without_name| (without_name, mode))
    }

    /// Names `patch` in the installed copy of a package at `package_subpath` of `dir`. Not for a cache folder: `PatchTask::apply` leaves those without a name. A copy that gets no name here stays installed, and the next install names it: `PackageInstall::name_patch`.
    #[cold]
    pub(crate) fn write(dir: Fd, package_subpath: &[u8], tag: ResolutionTag, patch: Patch) {
        let Some(name) = Self::name(tag, patch) else {
            return;
        };
        let mut buf = bun_paths::path_buffer_pool::get();
        let mut spill = Vec::new();
        let path = Self::file_path(&mut buf.0, &mut spill, package_subpath, tag);
        let written = Self::read(dir, path).and_then(|(contents, mode)| {
            match Self::stamped(tag, &contents, name.as_slice()) {
                Some(stamped) => Self::replace_file(dir, path, &stamped, mode),
                None => Ok(()),
            }
        });
        if let Err(err) = written
            && PackageManager::verbose_install()
        {
            bun_core::warn!(
                "failed to write the patch hash into {}: {}",
                BStr::new(path.as_bytes()),
                err
            );
        }
    }
}

use crate::Integrity;
use crate::PreinstallState;
use crate::ResolutionTag;
use crate::bun_json::PackageJSONVersionChecker;
use crate::network_task::Authorization;
use crate::package_install::{BunTag, InstallResult, Method as InstallMethod, Patch};
use crate::package_manager::Options::LogLevel;
use crate::package_manager_task::Id as TaskId;

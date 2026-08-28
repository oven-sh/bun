//! Runs the `git` commands of the install's git tasks as child processes on
//! the install thread's event loop, like `lifecycle_script_runner`. One
//! [`GitSubprocess`] drives one task and pushes it onto `resolve_tasks` when
//! its last command has exited.

use core::ffi::{CStr, c_void};
use core::ptr::NonNull;
use std::ffi::CString;

use bstr::BStr;
use bun_core::{Output, strings};
use bun_io::BufferedReader;
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags};
use bun_paths as Path;
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{Process, ProcessExit, ProcessHandle, Rusage, SpawnEnv, SpawnOptions, Status};
use bun_sys::Fd;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

use crate::install::{ExtractData, ExtractDataJson};
use crate::package_manager_task::{self as Task, Tag};
use crate::repository::{GitEnv, Repository, RepositoryExt as _, is_safe_resolved_tag};
use crate::{Error, PackageManager};

impl PackageManager {
    /// Queues a git task; it counts as pending from now on.
    pub(crate) fn enqueue_git_task(&mut self, task: NonNull<Task::Task<'static>>) {
        self.increment_pending_tasks(1);
        self.git_tasks.push_back(task);
    }

    /// A finished task does not start the next one: `run_tasks` consumes it,
    /// then `schedule_tasks` lands here.
    pub(crate) fn start_git_tasks(&mut self) {
        let max = u32::from(bun_core::get_thread_count());
        while self.running_git_tasks < max {
            let Some(task) = self.git_tasks.pop_front() else {
                break;
            };
            self.running_git_tasks += 1;
            GitSubprocess::start(self, task);
        }
    }
}

/// The command the running child is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Step {
    /// `git fetch` in the cached bare repository (clone task).
    Fetch,
    /// `git clone --bare <url> <tmp>` (clone task).
    Clone,
    /// `git log -1 <committish>` (commit task).
    Log,
    /// `git clone --no-checkout <bare repository> <tmp>` (checkout task).
    CheckoutClone,
    /// `git checkout <resolved>` in `<tmp>` (checkout task).
    Checkout,
}

/// The result a finished task carries in `Task::data`.
enum Done {
    /// The bare repository's directory. Never closed: it lives in `git_repositories`.
    Clone(Fd),
    /// The commit SHA.
    Commit(Vec<u8>),
    Checkout(ExtractData),
}

/// A cache folder, built under a temporary name and renamed once complete.
struct CacheStaging {
    cache_dir: Fd,
    tmp_name: Vec<u8>,
    /// `<cache dir>/<tmp_name>`
    tmp_path: Vec<u8>,
}

impl CacheStaging {
    fn new(manager: &mut PackageManager) -> Result<Self, Error> {
        let cache_dir = manager.get_cache_directory();
        let mut tmp_name_buf = [0u8; 64];
        let tmp_name =
            Path::fs::FileSystem::tmpname(b"tmp", &mut tmp_name_buf, bun_core::fast_random())
                .map_err(|_| Error::Sys(bun_errno::SystemErrno::ENOSPC))?
                .to_vec();
        let tmp_path = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
            &manager.cache_directory_path,
            &[&tmp_name],
        )
        .to_vec();
        Ok(Self {
            cache_dir,
            tmp_name,
            tmp_path,
        })
    }

    fn discard(&self) {
        let _ = bun_sys::Dir::borrow(&self.cache_dir).delete_tree(&self.tmp_name);
    }

    fn publish(
        self,
        log: &mut bun_ast::Log,
        name: &[u8],
        folder_name: &[u8],
    ) -> Result<bun_sys::Dir, Error> {
        let renamed = bun_sys::renameat_concurrently_a(
            self.cache_dir,
            &self.tmp_name,
            self.cache_dir,
            folder_name,
            bun_sys::RenameatConcurrentlyOptions {
                move_fallback: false,
            },
        );
        // After an exchange the temporary name holds the folder that was replaced.
        self.discard();
        if let Err(err) = renamed {
            log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "moving \"{}\" to cache dir failed: {}",
                    BStr::new(name),
                    err
                ),
            );
            return Err(Error::InstallFailed);
        }
        bun_sys::Dir::borrow(&self.cache_dir)
            .open_at(folder_name)
            .map_err(Error::from)
    }
}

/// `<hex(clone task id)>.git`: the cache folder of a bare clone.
fn bare_repo_folder_name(clone_id: Task::Id) -> Vec<u8> {
    format!("{}.git", bun_core::fmt::hex_int_lower::<16>(clone_id.get())).into_bytes()
}

pub(crate) struct GitSubprocess {
    manager: bun_ptr::BackRef<PackageManager, bun_ptr::Mut>,
    /// Owned by `preallocated_resolve_tasks`; handed to `resolve_tasks` in `finish`.
    task: NonNull<Task::Task<'static>>,
    step: Step,
    /// Clone URLs still to try, last first (https before ssh).
    urls: Vec<Vec<u8>>,
    /// The cached bare repository that `Step::Fetch` refreshes.
    repo_dir: Option<bun_sys::Dir>,
    /// Discarded by `Drop` unless published first.
    staging: Option<CacheStaging>,
    read_error: Option<bun_sys::Error>,

    process: Option<ProcessHandle>,
    stdout: BufferedReader,
    stderr: BufferedReader,
    remaining_fds: i8,
    has_called_process_exit: bool,
}

impl GitSubprocess {
    /// The runner frees itself once the task is complete.
    fn start(manager: &mut PackageManager, task: NonNull<Task::Task<'static>>) {
        let this = bun_core::heap::into_raw(Box::new(GitSubprocess {
            manager: bun_ptr::BackRef::new_mut(manager),
            task,
            step: Step::Clone,
            urls: Vec::new(),
            repo_dir: None,
            staging: None,
            read_error: None,
            process: None,
            stdout: BufferedReader::init::<Self>(),
            stderr: BufferedReader::init::<Self>(),
            remaining_fds: 0,
            has_called_process_exit: false,
        }));
        // SAFETY: `this` was just allocated and nothing else refers to it.
        let result = unsafe {
            match (*task.as_ptr()).tag {
                Tag::GitClone => Self::begin_clone(this),
                Tag::GitCommit => Self::begin_commit(this),
                Tag::GitCheckout => Self::begin_checkout(this),
                _ => unreachable!("not a git task"),
            }
        };
        // An `Err` leaves `this` untouched; an `Ok` may already have freed it.
        if let Err(err) = result {
            // SAFETY: see above.
            unsafe { Self::finish(this, Err(err)) };
        }
    }

    // ── clone ───────────────────────────────────────────────────────────────

    /// # Safety
    /// `this` is live and not yet running a child.
    unsafe fn begin_clone(this: *mut Self) -> Result<(), Error> {
        // SAFETY: caller contract.
        unsafe {
            let manager = (*this).manager.as_ptr();
            let task = (*this).task.as_ptr();
            bun_analytics::features::git_dependencies
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed);

            let req = (*task).request_git_clone();
            let url = req.url.slice();
            let name = req.name.slice();
            // Pushed in reverse so `pop` yields the https form first.
            if let Some(ssh) = Repository::try_ssh(url) {
                (*this).urls.push(ssh);
            }
            if let Some(https) = Repository::try_https(url) {
                (*this).urls.push(https);
            }
            if (*this).urls.is_empty() {
                (*this).urls.push(url.to_vec());
            }

            let offline = (*manager).options.offline
                == crate::package_manager_real::options::OfflineMode::Offline;
            let folder_name = bare_repo_folder_name((*task).id);
            let cache_dir = (*manager).get_cache_directory();
            match bun_sys::Dir::borrow(&cache_dir)
                .open_dir_z(&bun_core::ZBox::from_bytes(&folder_name))
            {
                Ok(dir) => {
                    // --prefer-offline still fetches: a stale clone may lack the pinned commit.
                    if offline {
                        Self::finish(this, Ok(Done::Clone(dir.into_raw())));
                        return Ok(());
                    }
                    let path = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
                        &(*manager).cache_directory_path,
                        &[&folder_name],
                    )
                    .to_vec();
                    (*this).repo_dir = Some(dir);
                    (*this).step = Step::Fetch;
                    Self::spawn(this, &[b"-C", &path, b"fetch", b"--quiet"])
                }
                Err(err) if err.get_errno() == bun_sys::E::ENOENT => {
                    if offline {
                        (*task).log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "--offline: git repository for \"{}\" is not in the cache",
                                BStr::new(name)
                            ),
                        );
                        return Err(Error::InstallFailed);
                    }
                    Self::spawn_clone(this)
                }
                Err(err) => Err(err.into()),
            }
        }
    }

    /// # Safety
    /// `this` is live and not running a child; `urls` is not empty.
    unsafe fn spawn_clone(this: *mut Self) -> Result<(), Error> {
        // SAFETY: caller contract.
        unsafe {
            let manager = (*this).manager.as_ptr();
            let url = (*this).urls.pop().expect("a clone URL is left");
            let staging = CacheStaging::new(&mut *manager)?;
            let tmp_path = staging.tmp_path.clone();
            (*this).staging = Some(staging);
            (*this).step = Step::Clone;
            Self::spawn(
                this,
                &[
                    b"clone",
                    b"-c",
                    b"core.longpaths=true",
                    b"--quiet",
                    b"--bare",
                    &url,
                    &tmp_path,
                ],
            )
        }
    }

    // ── find commit ─────────────────────────────────────────────────────────

    /// # Safety
    /// `this` is live and not yet running a child.
    unsafe fn begin_commit(this: *mut Self) -> Result<(), Error> {
        // SAFETY: caller contract.
        unsafe {
            let manager = (*this).manager.as_ptr();
            let task = (*this).task.as_ptr();
            let req = (*task).request_git_commit();
            let committish = req.committish.slice();
            let path = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
                &(*manager).cache_directory_path,
                &[&bare_repo_folder_name(req.clone_id)],
            )
            .to_vec();
            (*this).step = Step::Log;
            if committish.is_empty() {
                Self::spawn(this, &[b"-C", &path, b"log", b"--format=%H", b"-1"])
            } else {
                Self::spawn(
                    this,
                    &[
                        b"-C",
                        &path,
                        b"log",
                        b"--format=%H",
                        b"-1",
                        b"--end-of-options",
                        committish,
                    ],
                )
            }
        }
    }

    // ── checkout ────────────────────────────────────────────────────────────

    /// # Safety
    /// `this` is live and not yet running a child.
    unsafe fn begin_checkout(this: *mut Self) -> Result<(), Error> {
        // SAFETY: caller contract.
        unsafe {
            let manager = (*this).manager.as_ptr();
            let task = (*this).task.as_ptr();
            bun_analytics::features::git_dependencies
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed);

            let req = (*task).request_git_checkout();
            let name = req.name.slice();
            let resolved = req.resolved.slice();
            if !is_safe_resolved_tag(resolved) {
                (*task).log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "invalid git commit \"{}\" for \"{}\"",
                        BStr::new(resolved),
                        BStr::new(name)
                    ),
                );
                return Err(Error::InstallFailed);
            }

            let cache_dir = (*manager).get_cache_directory();
            let folder_name = Self::checkout_folder_name(resolved);
            match bun_sys::Dir::borrow(&cache_dir).open_at(&folder_name) {
                Ok(dir) => {
                    if bun_sys::exists_at(dir.fd(), bun_core::zstr!(".bun-tag")) {
                        let data = Self::read_package_json(this, dir)?;
                        Self::finish(this, Ok(Done::Checkout(data)));
                        return Ok(());
                    }
                    dir.close();
                }
                Err(err) if err.get_errno() == bun_sys::E::ENOENT => {}
                Err(err) => return Err(err.into()),
            }

            let mut repo_path_buf = Path::path_buffer_pool::get();
            let repo_path = bun_sys::get_fd_path(req.repo_dir, &mut repo_path_buf)?.to_vec();
            let staging = CacheStaging::new(&mut *manager)?;
            let tmp_path = staging.tmp_path.clone();
            (*this).staging = Some(staging);
            (*this).step = Step::CheckoutClone;
            Self::spawn(
                this,
                &[
                    b"clone",
                    b"-c",
                    b"core.longpaths=true",
                    b"--quiet",
                    b"--no-checkout",
                    &repo_path,
                    &tmp_path,
                ],
            )
        }
    }

    /// `@G@<resolved>`: the cache folder of a checkout.
    fn checkout_folder_name(resolved: &[u8]) -> Vec<u8> {
        let mut buf = [0u8; 512];
        crate::package_manager_real::cached_git_folder_name_print(&mut buf, resolved, None)
            .as_bytes()
            .to_vec()
    }

    /// # Safety
    /// `this` is live; `staging` is set.
    unsafe fn finish_checkout(this: *mut Self) -> Result<ExtractData, Error> {
        // SAFETY: caller contract.
        unsafe {
            let task = (*this).task.as_ptr();
            let staging = (*this)
                .staging
                .take()
                .expect("checkout has a staging folder");
            let req = (*task).request_git_checkout();
            let name = req.name.slice();
            let resolved = req.resolved.slice();

            let dir = match bun_sys::Dir::borrow(&staging.cache_dir).open_at(&staging.tmp_name) {
                Ok(dir) => dir,
                Err(err) => {
                    staging.discard();
                    return Err(err.into());
                }
            };
            let _ = dir.delete_tree(b".git");
            // Unlinks a `node_modules` link only; directories are kept (bundleDependencies).
            let _ = dir.delete_file_z(bun_core::zstr!("node_modules"));

            // `.bun-tag` is the cache-hit marker; a checked-in one is replaced.
            let _ = dir.delete_tree(b".bun-tag");
            let tagged = bun_sys::File::openat(
                dir.fd(),
                bun_core::zstr!(".bun-tag"),
                bun_sys::O::WRONLY
                    | bun_sys::O::CREAT
                    | bun_sys::O::EXCL
                    | if cfg!(windows) {
                        0
                    } else {
                        bun_sys::O::NOFOLLOW
                    },
                0o664,
            )
            .and_then(|f| f.write_all(resolved));
            // Windows cannot rename a directory with an open handle inside it.
            dir.close();
            if let Err(err) = tagged {
                staging.discard();
                (*task).log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "writing \".bun-tag\" for \"{}\" failed: {}",
                        BStr::new(name),
                        BStr::new(err.name())
                    ),
                );
                return Err(Error::InstallFailed);
            }

            let folder_name = Self::checkout_folder_name(resolved);
            let package_dir = staging.publish(&mut (*task).log, name, &folder_name)?;
            Self::read_package_json(this, package_dir)
        }
    }

    /// Closes `package_dir`.
    ///
    /// # Safety
    /// `this` is live.
    unsafe fn read_package_json(
        this: *mut Self,
        package_dir: bun_sys::Dir,
    ) -> Result<ExtractData, Error> {
        // SAFETY: caller contract.
        unsafe {
            let task = (*this).task.as_ptr();
            let req = (*task).request_git_checkout();
            let name = req.name.slice();
            let url = req.url.slice();
            let resolved = req.resolved.slice();

            let (json_file, json_buf) =
                match bun_sys::File::read_file_from(package_dir.fd(), b"package.json") {
                    Ok(v) => v,
                    Err(err) => {
                        package_dir.close();
                        if err.get_errno() == bun_sys::E::ENOENT {
                            // allow git dependencies without package.json
                            return Ok(ExtractData {
                                url: url.into(),
                                resolved: resolved.into(),
                                ..Default::default()
                            });
                        }
                        (*task).log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "\"package.json\" for \"{}\" failed to open: {}",
                                BStr::new(name),
                                BStr::new(err.name())
                            ),
                        );
                        return Err(Error::InstallFailed);
                    }
                };

            let mut json_path_buf = Path::path_buffer_pool::get();
            let json_path = match json_file.get_path(&mut json_path_buf) {
                Ok(p) => p,
                Err(err) => {
                    (*task).log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "\"package.json\" for \"{}\" failed to resolve: {}",
                            BStr::new(name),
                            BStr::new(err.name())
                        ),
                    );
                    let _ = json_file.close();
                    package_dir.close();
                    return Err(Error::InstallFailed);
                }
            };
            let path = bun_resolver::fs::FileSystem::instance()
                .dirname_store()
                .append(json_path);
            let _ = json_file.close();
            package_dir.close();

            Ok(ExtractData {
                url: url.into(),
                resolved: resolved.into(),
                json: Some(ExtractDataJson {
                    path: path?.into(),
                    buf: json_buf,
                }),
                ..Default::default()
            })
        }
    }

    // ── the child ───────────────────────────────────────────────────────────

    /// Spawns `git <args>` with stdout and stderr captured.
    ///
    /// # Safety
    /// `this` is live, allocation-rooted, and not running a child. On `Ok`
    /// the child may already have exited and freed `this`.
    unsafe fn spawn(this: *mut Self, args: &[&[u8]]) -> Result<(), Error> {
        // SAFETY: caller contract; no whole-struct borrow spans a re-entrant call.
        unsafe {
            let manager = (*this).manager.as_ptr();
            let task = (*this).task.as_ptr();
            let env = GitEnv::get((*manager).env_mut());
            let Some(git) = &env.git else {
                (*task).log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "\"git\" is not installed (needed for \"{}\")",
                        BStr::new(Self::task_name(task))
                    ),
                );
                return Err(Error::Sys(bun_errno::SystemErrno::ENOENT));
            };

            let mut argv: Vec<CString> = Vec::with_capacity(args.len() + 1);
            argv.push(CString::new(git.as_bytes()).map_err(|_| Error::InvalidCharacter)?);
            for arg in args {
                argv.push(CString::new(*arg).map_err(|_| Error::InvalidCharacter)?);
            }
            let argv: Vec<&CStr> = argv.iter().map(CString::as_c_str).collect();
            let envp: Vec<&CStr> = env.envp.iter().collect();

            (*this).read_error = None;
            (*this).remaining_fds = 0;
            (*this).has_called_process_exit = false;
            (*this).stdout.set_parent(this.cast::<c_void>());
            (*this).stderr.set_parent(this.cast::<c_void>());

            // Windows: the `uv::Pipe` allocations are ours until the spawn succeeds.
            let spawn_options = SpawnOptions {
                stdin: bun_spawn::Stdio::Ignore,
                #[cfg(unix)]
                stdout: bun_spawn::Stdio::Buffer,
                #[cfg(unix)]
                stderr: bun_spawn::Stdio::Buffer,
                #[cfg(windows)]
                stdout: bun_spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(
                    bun_core::ffi::zeroed::<uv::Pipe>(),
                ))
                    as bun_spawn::windows::UvPipePtr),
                #[cfg(windows)]
                stderr: bun_spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(
                    bun_core::ffi::zeroed::<uv::Pipe>(),
                ))
                    as bun_spawn::windows::UvPipePtr),
                #[cfg(windows)]
                windows: bun_spawn::WindowsOptions {
                    loop_: bun_event_loop::EventLoopHandle::from_any(&mut (*manager).event_loop),
                    ..Default::default()
                },
                stream: false,
                ..Default::default()
            };

            let spawned = match bun_spawn::spawn_process_cstr(
                &spawn_options,
                &argv,
                SpawnEnv::Strings(&envp),
            ) {
                Ok(Ok(spawned)) => spawned,
                res => {
                    #[cfg(windows)]
                    {
                        let mut spawn_options = spawn_options;
                        spawn_options.stdout.deinit();
                        spawn_options.stderr.deinit();
                    }
                    res??;
                    unreachable!();
                }
            };
            #[cfg(windows)]
            let mut spawned = spawned;

            #[cfg(unix)]
            {
                // Counted before `start`: a failed registration reports synchronously.
                if let Some(stdout) = spawned.stdout {
                    if !spawned.memfds[1] {
                        let _ = bun_sys::set_nonblocking(stdout);
                        (*this).remaining_fds += 1;
                        Self::reset_output_flags(&mut (*this).stdout, stdout);
                        (*this).stdout.start(stdout, true)?;
                        if let Some(poll) = (*this).stdout.handle.get_poll() {
                            poll.set_flag(FilePollFlag::Socket);
                        }
                    } else {
                        (*this).stdout.start_memfd(stdout);
                    }
                }
                if let Some(stderr) = spawned.stderr {
                    if !spawned.memfds[2] {
                        let _ = bun_sys::set_nonblocking(stderr);
                        (*this).remaining_fds += 1;
                        Self::reset_output_flags(&mut (*this).stderr, stderr);
                        (*this).stderr.start(stderr, true)?;
                        if let Some(poll) = (*this).stderr.handle.get_poll() {
                            poll.set_flag(FilePollFlag::Socket);
                        }
                    } else {
                        (*this).stderr.start_memfd(stderr);
                    }
                }
            }
            #[cfg(windows)]
            {
                // Take sole ownership of each pipe before `spawned` drops.
                if let bun_spawn::SpawnedStdio::Buffer(pipe) = spawned.stdout.take() {
                    (*this).stdout.set_source(bun_io::Source::Pipe(pipe));
                    (*this).stdout.set_parent(this.cast::<c_void>());
                    (*this).remaining_fds += 1;
                    (*this).stdout.start_with_current_pipe()?;
                }
                if let bun_spawn::SpawnedStdio::Buffer(pipe) = spawned.stderr.take() {
                    (*this).stderr.set_source(bun_io::Source::Pipe(pipe));
                    (*this).stderr.set_parent(this.cast::<c_void>());
                    (*this).remaining_fds += 1;
                    (*this).stderr.start_with_current_pipe()?;
                }
            }

            let event_loop = bun_event_loop::EventLoopHandle::from_any(&mut (*manager).event_loop);
            debug_assert!((*this).process.is_none());
            let process: *mut Process = (*this)
                .process
                .insert(spawned.to_process_handle(event_loop))
                .as_ptr();
            // SAFETY: `this` is allocation-rooted and outlives `process`.
            (*process).set_exit_handler(ProcessExit::of(this));

            // An already-exited child runs the exit handler here and may free `this`.
            if let Err(err) = (*process).watch_or_reap() {
                if !(*process).has_exited() {
                    (*process).on_exit(Status::Err(err), &bun_core::ffi::zeroed::<Rusage>());
                }
            }
            Ok(())
        }
    }

    /// Re-primes a recycled reader for a fresh socket fd.
    #[cfg(unix)]
    fn reset_output_flags(output: &mut BufferedReader, fd: Fd) {
        output
            .flags
            .insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
        output.flags.remove(
            PosixFlags::MEMFD | PosixFlags::RECEIVED_EOF | PosixFlags::CLOSED_WITHOUT_REPORTING,
        );
        let _ = fd;
    }

    /// # Safety
    /// `this` is live; the child has exited and both readers are done.
    unsafe fn reset_polls(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe {
            debug_assert!((*this).remaining_fds == 0);
            (*this).process = None;
            (*this).stdout.deinit();
            (*this).stderr.deinit();
            (*this).stdout = BufferedReader::init::<Self>();
            (*this).stderr = BufferedReader::init::<Self>();
        }
    }

    /// # Safety
    /// `this` is the live runner the process was registered with. May free `this`.
    unsafe fn on_process_exit(this: *mut Self, process: *mut Process, _: Status, _: &Rusage) {
        // SAFETY: caller contract.
        unsafe {
            if (*this).process.as_ref().map(ProcessHandle::as_ptr) != Some(process) {
                bun_core::debug_warn!("<d>[GitSubprocess]<r> on_process_exit with wrong process");
                return;
            }
            (*this).has_called_process_exit = true;
            Self::maybe_finished(this);
        }
    }

    /// # Safety
    /// `this` is the live runner the reader was registered with. May free `this`.
    unsafe fn on_reader_done(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe {
            debug_assert!((*this).remaining_fds > 0);
            (*this).remaining_fds -= 1;
            Self::maybe_finished(this);
        }
    }

    /// # Safety
    /// `this` is the live runner the reader was registered with. May free `this`.
    unsafe fn on_reader_error(this: *mut Self, err: bun_sys::Error) {
        // SAFETY: caller contract.
        unsafe {
            debug_assert!((*this).remaining_fds > 0);
            (*this).remaining_fds -= 1;
            if (*this).read_error.is_none() {
                (*this).read_error = Some(err);
            }
            Self::maybe_finished(this);
        }
    }

    /// # Safety
    /// `this` is live. May free `this`.
    unsafe fn maybe_finished(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe {
            if !(*this).has_called_process_exit || (*this).remaining_fds != 0 {
                return;
            }
            let Some(process) = &(*this).process else {
                return;
            };
            let status = process.status.clone();
            let stdout = core::mem::take((*this).stdout.final_buffer());
            let stderr = core::mem::take((*this).stderr.final_buffer());
            Self::on_command_exit(this, &status, &stdout, &stderr);
        }
    }

    /// # Safety
    /// `this` is live; the child has exited and its output is collected. May
    /// free `this`.
    unsafe fn on_command_exit(this: *mut Self, status: &Status, stdout: &[u8], stderr: &[u8]) {
        // SAFETY: caller contract.
        unsafe {
            let ok = matches!(status, Status::Exited(exit) if exit.code == 0)
                && (*this).read_error.is_none();
            // remote: The page could not be found <-- for non git
            // remote: Repository not found. <-- for git
            // remote: fatal repository '<url>' does not exist <-- for git
            let not_found = !ok
                && (*this).step == Step::Clone
                && ((strings::contains(stderr, b"remote:")
                    && strings::contains(stderr, b"not")
                    && strings::contains(stderr, b"found"))
                    || strings::contains(stderr, b"does not exist"));
            if !ok && !not_found {
                Self::report_failure(this, status, stderr);
            }
            let task = (*this).task.as_ptr();
            let name = Self::task_name(task);
            let result: Result<(), Error> = match (*this).step {
                Step::Fetch => {
                    if !ok {
                        (*task).log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!("\"git fetch\" for \"{}\" failed", BStr::new(name)),
                        );
                        Err(Error::InstallFailed)
                    } else {
                        let dir = (*this)
                            .repo_dir
                            .take()
                            .expect("fetch refreshed an open repo");
                        Self::finish(this, Ok(Done::Clone(dir.into_raw())));
                        Ok(())
                    }
                }
                Step::Clone => {
                    let staging = (*this).staging.take().expect("clone has a staging folder");
                    if ok {
                        let folder_name = bare_repo_folder_name((*task).id);
                        match staging.publish(&mut (*task).log, name, &folder_name) {
                            Ok(dir) => {
                                Self::finish(this, Ok(Done::Clone(dir.into_raw())));
                                Ok(())
                            }
                            Err(err) => Err(err),
                        }
                    } else {
                        staging.discard();
                        if !not_found && !(*this).urls.is_empty() {
                            // Try the next URL form (ssh after https).
                            Self::reset_polls(this);
                            Self::spawn_clone(this)
                        } else {
                            (*task).log.add_error_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!("\"git clone\" for \"{}\" failed", BStr::new(name)),
                            );
                            Err(if not_found {
                                Error::RepositoryNotFound
                            } else {
                                Error::InstallFailed
                            })
                        }
                    }
                }
                Step::Log => {
                    if ok {
                        let sha = strings::trim(stdout, b" \t\r\n").to_vec();
                        Self::finish(this, Ok(Done::Commit(sha)));
                        Ok(())
                    } else {
                        Err(Error::InstallFailed)
                    }
                }
                Step::CheckoutClone => {
                    if ok {
                        let tmp_path = (*this)
                            .staging
                            .as_ref()
                            .expect("checkout has a staging folder")
                            .tmp_path
                            .clone();
                        let resolved = (*task).request_git_checkout().resolved.slice();
                        (*this).step = Step::Checkout;
                        Self::reset_polls(this);
                        // `is_safe_resolved_tag` rejected a leading `-`: not a git option.
                        Self::spawn(this, &[b"-C", &tmp_path, b"checkout", b"--quiet", resolved])
                    } else {
                        (*task).log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!("\"git clone\" for \"{}\" failed", BStr::new(name)),
                        );
                        Err(Error::InstallFailed)
                    }
                }
                Step::Checkout => {
                    if ok {
                        match Self::finish_checkout(this) {
                            Ok(data) => {
                                Self::finish(this, Ok(Done::Checkout(data)));
                                Ok(())
                            }
                            Err(err) => Err(err),
                        }
                    } else {
                        (*task).log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!("\"git checkout\" for \"{}\" failed", BStr::new(name)),
                        );
                        Err(Error::InstallFailed)
                    }
                }
            };
            if let Err(err) = result {
                Self::finish(this, Err(err));
            }
        }
    }

    /// Mirrors git's stderr and termination kind, which name the cause.
    ///
    /// # Safety
    /// `this` is live.
    unsafe fn report_failure(this: *mut Self, status: &Status, stderr: &[u8]) {
        // SAFETY: caller contract.
        let read_error = unsafe { (*this).read_error.take() };
        match (status, read_error) {
            (_, Some(err)) => {
                Output::err_generic("reading the output of git failed: {}", (err,));
            }
            (Status::Exited(exit), None) => {
                Output::err_generic("git failed with exit code {}", (exit.code,));
            }
            (Status::Signaled(sig), None) => {
                Output::err_generic("git failed with signal {}", (sig,));
            }
            (Status::Err(err), None) => {
                Output::err_generic("spawning git failed: {}", (err,));
            }
            (Status::Running, None) => {
                Output::err_generic("git failed with unknown status", ());
            }
        }
        if !stderr.is_empty() {
            let ew = Output::error_writer();
            let _ = ew.write_all(stderr);
            if stderr.last() != Some(&b'\n') {
                let _ = ew.write_all(b"\n");
            }
        }
        Output::flush();
    }

    /// The package name of a git task.
    ///
    /// # Safety
    /// `task` is live.
    unsafe fn task_name<'a>(task: *mut Task::Task<'static>) -> &'a [u8] {
        // SAFETY: caller contract; the request strings live in the filename store.
        unsafe {
            match (*task).tag {
                Tag::GitClone => (*task).request_git_clone().name.slice(),
                Tag::GitCommit => (*task).request_git_commit().name.slice(),
                Tag::GitCheckout => (*task).request_git_checkout().name.slice(),
                _ => unreachable!("not a git task"),
            }
        }
    }

    /// Hands the finished task to `resolve_tasks` and frees `this`.
    ///
    /// # Safety
    /// `this` is live and allocation-rooted (from `start`). Nothing may touch
    /// `this` afterwards.
    unsafe fn finish(this: *mut Self, result: Result<Done, Error>) {
        // SAFETY: caller contract.
        let this = unsafe { bun_core::heap::take(this) };
        let task = this.task.as_ptr();
        let manager = this.manager.as_ptr();
        // SAFETY: `run_tasks` recycles the task only after the push below.
        unsafe {
            // `deinit_payload` drops the active `data` arm, so every path writes one.
            match result {
                Ok(done) => {
                    (*task).status = Task::Status::Success;
                    (*task).err = None;
                    (*task).data = match done {
                        Done::Clone(fd) => Task::Data {
                            git_clone: core::mem::ManuallyDrop::new(fd),
                        },
                        Done::Commit(sha) => Task::Data {
                            git_commit: core::mem::ManuallyDrop::new(sha),
                        },
                        Done::Checkout(data) => Task::Data {
                            git_checkout: core::mem::ManuallyDrop::new(data),
                        },
                    };
                    if let Some(mut pt) = (*task).apply_patch_task.take() {
                        bun_core::handle_oom(pt.apply());
                        let crate::patch_install::Callback::Apply(apply) = &mut pt.callback else {
                            unreachable!("apply_patch_task holds the Apply variant");
                        };
                        if apply.logger.errors > 0 {
                            let _ = apply
                                .logger
                                .print(std::ptr::from_mut(Output::error_writer()));
                        }
                    }
                }
                Err(err) => {
                    (*task).status = Task::Status::Fail;
                    (*task).err = Some(err);
                    (*task).data = match (*task).tag {
                        Tag::GitClone => Task::Data {
                            git_clone: core::mem::ManuallyDrop::new(Fd::invalid()),
                        },
                        Tag::GitCommit => Task::Data {
                            git_commit: core::mem::ManuallyDrop::new(Vec::new()),
                        },
                        Tag::GitCheckout => Task::Data {
                            git_checkout: core::mem::ManuallyDrop::new(ExtractData::default()),
                        },
                        _ => unreachable!("not a git task"),
                    };
                }
            }
            (*manager).running_git_tasks -= 1;
            (*core::ptr::addr_of!((*manager).resolve_tasks)).push(this.task);
            PackageManager::wake_raw(manager);
        }
        drop(this);
    }
}

impl Drop for GitSubprocess {
    fn drop(&mut self) {
        self.process = None;
        self.stdout.deinit();
        self.stderr.deinit();
        if let Some(staging) = self.staging.take() {
            staging.discard();
        }
    }
}

bun_spawn::link_impl_ProcessExit! {
    InstallGit for GitSubprocess => |this| {
        on_process_exit(process, status, rusage) =>
            GitSubprocess::on_process_exit(this, process, status, rusage),
    }
}

bun_io::impl_buffered_reader_parent! {
    InstallGit for GitSubprocess;
    has_on_read_chunk = false;
    on_reader_done  = |this| GitSubprocess::on_reader_done(this);
    on_reader_error = |this, err| GitSubprocess::on_reader_error(this, err);
    loop_           = |this| (*(*this).manager.as_ptr()).event_loop.native_loop();
    event_loop = |this| bun_event_loop::EventLoopHandle::from_any(
        &mut (*(*this).manager.as_ptr()).event_loop,
    ).as_event_loop_ctx();
}

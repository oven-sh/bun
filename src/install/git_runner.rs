//! Runs the install's `git` commands as child processes on the install thread's event loop.

use core::cell::Cell;
use core::ffi::{CStr, c_void};
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::ffi::CString;

use bstr::BStr;
use bun_core::{Output, strings};
use bun_event_loop::EventLoopHandle;
use bun_io::BufferedReader;
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags};
use bun_paths as Path;
use bun_ptr::{BackRef, JsCell, RefPtr, ThisPtr};
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{Process, ProcessHandle, Rusage, SpawnEnv, SpawnOptions, Status};
use bun_sys::Fd;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_threading::thread_pool as ThreadPool;

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

    /// Called from `schedule_tasks`; a finished task does not start the next one itself.
    pub(crate) fn start_git_tasks(&mut self) {
        let max = u32::from(bun_core::get_thread_count());
        while self.running_git_tasks.load(Ordering::Relaxed) < max {
            let Some(task) = self.git_tasks.pop_front() else {
                break;
            };
            self.running_git_tasks.fetch_add(1, Ordering::Relaxed);
            GitSubprocess::start(self, task);
        }
    }
}

/// The command the running child is.
enum Step {
    /// `git fetch` in this cached bare repository (clone task).
    Fetch(bun_sys::Dir),
    /// `git clone --bare <url> <tmp>` (clone task).
    Clone,
    /// `git log -1 <committish>` (commit task).
    Log,
    /// `git clone --no-checkout <bare repository> <tmp>` (checkout task).
    CheckoutClone,
    /// `git checkout <resolved>` in `<tmp>` (checkout task).
    Checkout,
}

/// The filesystem tail of a clone or checkout task; `Task::callback` runs it on a pool worker.
pub(crate) enum Finalize {
    /// The bare repository exists (a cache hit, or `git fetch` refreshed it).
    Repo(Fd),
    /// A fresh bare clone, to move into the cache.
    PublishRepo(CacheStaging),
    /// A checkout the cache already has.
    CachedCheckout(bun_sys::Dir),
    /// A fresh checkout, to strip and move into the cache.
    PublishCheckout(CacheStaging),
    Failed {
        staging: Option<CacheStaging>,
        err: Error,
    },
}

impl Finalize {
    /// Completes `task` from its `git_finalize`. Thread-pool side.
    pub(crate) fn run(task: &mut Task::Task<'_>) {
        let finalize = task
            .git_finalize
            .take()
            .expect("a clone or checkout task carries its finalize step");
        let result = match finalize {
            Finalize::Repo(fd) => Ok(Task::Data {
                git_clone: ManuallyDrop::new(fd),
            }),
            Finalize::PublishRepo(staging) => {
                let name = task.request_git_clone().name.slice().to_vec();
                staging
                    .publish(&mut task.log, &name, &bare_repo_folder_name(task.id))
                    .map(|dir| Task::Data {
                        git_clone: ManuallyDrop::new(dir.into_raw()),
                    })
            }
            Finalize::CachedCheckout(dir) => read_package_json(task, dir).map(|data| Task::Data {
                git_checkout: ManuallyDrop::new(data),
            }),
            Finalize::PublishCheckout(staging) => {
                finish_checkout(task, staging).map(|data| Task::Data {
                    git_checkout: ManuallyDrop::new(data),
                })
            }
            Finalize::Failed { staging, err } => {
                if let Some(staging) = staging {
                    staging.discard();
                }
                Err(err)
            }
        };
        match result {
            Ok(data) => {
                task.status = Task::Status::Success;
                task.err = None;
                task.data = data;
            }
            Err(err) => {
                task.status = Task::Status::Fail;
                task.err = Some(err);
                // `deinit_payload` drops the active `data` arm, so a failure writes one too.
                task.data = match task.tag {
                    Tag::GitClone => Task::Data {
                        git_clone: ManuallyDrop::new(Fd::invalid()),
                    },
                    _ => Task::Data {
                        git_checkout: ManuallyDrop::new(ExtractData::default()),
                    },
                };
            }
        }
    }
}

/// Strips the fresh checkout in `staging`, moves it into the cache, and reads its `package.json`.
fn finish_checkout(task: &mut Task::Task<'_>, staging: CacheStaging) -> Result<ExtractData, Error> {
    let req = task.request_git_checkout();
    let (name, resolved) = (req.name.slice().to_vec(), req.resolved.slice().to_vec());

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
    .and_then(|f| f.write_all(&resolved));
    // Windows cannot rename a directory with an open handle inside it.
    dir.close();
    if let Err(err) = tagged {
        staging.discard();
        task.log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "writing \".bun-tag\" for \"{}\" failed: {}",
                BStr::new(&name),
                BStr::new(err.name())
            ),
        );
        return Err(Error::InstallFailed);
    }

    let folder_name = checkout_folder_name(&resolved);
    let package_dir = staging.publish(&mut task.log, &name, &folder_name)?;
    read_package_json(task, package_dir)
}

/// Closes `package_dir`.
fn read_package_json(
    task: &mut Task::Task<'_>,
    package_dir: bun_sys::Dir,
) -> Result<ExtractData, Error> {
    let req = task.request_git_checkout();
    let name = req.name.slice().to_vec();
    let (url, resolved): (Box<[u8]>, Box<[u8]>) =
        (req.url.slice().into(), req.resolved.slice().into());

    let (json_file, json_buf) =
        match bun_sys::File::read_file_from(package_dir.fd(), b"package.json") {
            Ok(v) => v,
            Err(err) => {
                package_dir.close();
                if err.get_errno() == bun_sys::E::ENOENT {
                    // allow git dependencies without package.json
                    return Ok(ExtractData {
                        url,
                        resolved,
                        ..Default::default()
                    });
                }
                task.log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "\"package.json\" for \"{}\" failed to open: {}",
                        BStr::new(&name),
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
            task.log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "\"package.json\" for \"{}\" failed to resolve: {}",
                    BStr::new(&name),
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
        url,
        resolved,
        json: Some(ExtractDataJson {
            path: path?.into(),
            buf: json_buf,
        }),
        ..Default::default()
    })
}

/// `@G@<resolved>`: the cache folder of a checkout.
fn checkout_folder_name(resolved: &[u8]) -> Vec<u8> {
    let mut buf = [0u8; 512];
    crate::package_manager_real::cached_git_folder_name_print(&mut buf, resolved, None)
        .as_bytes()
        .to_vec()
}

/// A cache folder, built under a temporary name and renamed once complete.
pub(crate) struct CacheStaging {
    cache_dir: Fd,
    tmp_name: Vec<u8>,
    /// `<cache dir>/<tmp_name>`
    tmp_path: Vec<u8>,
}

impl CacheStaging {
    fn new(cache_dir: Fd, cache_dir_path: &[u8]) -> Result<Self, Error> {
        let mut tmp_name_buf = [0u8; 64];
        let tmp_name =
            Path::fs::FileSystem::tmpname(b"tmp", &mut tmp_name_buf, bun_core::fast_random())
                .map_err(|_| Error::Sys(bun_errno::SystemErrno::ENOSPC))?
                .to_vec();
        let tmp_path = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
            cache_dir_path,
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

// `finish_*` release the owning ref (freeing `this`), so everything on a path to
// them takes `ThisPtr<Self>` rather than `&self` and touches nothing afterwards;
// mutable state sits in cells so every access is a short shared borrow.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct GitSubprocess {
    ref_count: Cell<u32>,
    /// The single owning ref; `release` drops it and frees the runner.
    owner: Cell<Option<RefPtr<GitSubprocess>>>,
    manager: BackRef<PackageManager, bun_ptr::Mut>,
    /// Ours alone until `finish_on_pool` / `finish_commit` hands it on.
    task: NonNull<Task::Task<'static>>,
    tag: Tag,
    name: Box<[u8]>,
    event_loop: EventLoopHandle,
    cache_dir: Fd,

    step: JsCell<Step>,
    /// Clone URLs still to try, last first (https before ssh).
    urls: JsCell<Vec<Vec<u8>>>,
    /// Moves into the task's `Finalize`; `Drop` discards it otherwise.
    staging: JsCell<Option<CacheStaging>>,
    read_error: JsCell<Option<bun_sys::Error>>,

    process: JsCell<Option<ProcessHandle>>,
    exit_status: JsCell<Option<Status>>,
    stdout: JsCell<BufferedReader>,
    stderr: JsCell<BufferedReader>,
    remaining_fds: Cell<i8>,
}

impl GitSubprocess {
    fn start(manager: &mut PackageManager, task: NonNull<Task::Task<'static>>) {
        let cache_dir = manager.get_cache_directory();
        let event_loop = EventLoopHandle::from_any(&mut manager.event_loop);
        // SAFETY: a queued git task is live and idle until its runner hands it on.
        let (tag, name) = unsafe {
            let t = task.as_ref();
            let name: Box<[u8]> = match t.tag {
                Tag::GitClone => t.request_git_clone().name.slice().into(),
                Tag::GitCommit => t.request_git_commit().name.slice().into(),
                Tag::GitCheckout => t.request_git_checkout().name.slice().into(),
                _ => unreachable!("not a git task"),
            };
            (t.tag, name)
        };
        let runner = RefPtr::new(GitSubprocess {
            ref_count: Cell::new(1),
            owner: Cell::new(None),
            manager: BackRef::new_mut(manager),
            task,
            tag,
            name,
            event_loop,
            cache_dir,
            step: JsCell::new(Step::Clone),
            urls: JsCell::new(Vec::new()),
            staging: JsCell::new(None),
            read_error: JsCell::new(None),
            process: JsCell::new(None),
            exit_status: JsCell::new(None),
            stdout: JsCell::new(BufferedReader::init::<Self>()),
            stderr: JsCell::new(BufferedReader::init::<Self>()),
            remaining_fds: Cell::new(0),
        });
        let this = runner.this_ptr();
        this.owner.set(Some(runner));
        let result = match tag {
            Tag::GitClone => Self::begin_clone(this),
            Tag::GitCommit => Self::begin_commit(this),
            _ => Self::begin_checkout(this),
        };
        // An `Err` leaves `this` untouched; an `Ok` may already have freed it.
        if let Err(err) = result {
            Self::fail(this, err);
        }
    }

    fn manager(&self) -> &PackageManager {
        self.manager.get()
    }

    /// Call-scoped access to the task; see the field comment.
    #[allow(clippy::mut_from_ref)]
    fn task(&self) -> &mut Task::Task<'static> {
        // SAFETY: the task is owned by `preallocated_resolve_tasks` and touched by
        // nothing else while this runner holds it; every borrow here is call-scoped.
        unsafe { &mut *self.task.as_ptr() }
    }

    fn log_error(&self, args: core::fmt::Arguments<'_>) {
        self.task()
            .log
            .add_error_fmt(None, bun_ast::Loc::EMPTY, args);
    }

    fn new_staging(&self) -> Result<Vec<u8>, Error> {
        let staging = CacheStaging::new(self.cache_dir, &self.manager().cache_directory_path)?;
        let tmp_path = staging.tmp_path.clone();
        self.staging.set(Some(staging));
        Ok(tmp_path)
    }

    // ── clone ───────────────────────────────────────────────────────────────

    /// May free `this` on `Ok`.
    fn begin_clone(this: ThisPtr<Self>) -> Result<(), Error> {
        bun_analytics::features::git_dependencies.fetch_add(1, Ordering::Relaxed);
        let url = this.task().request_git_clone().url.slice().to_vec();
        // Pushed in reverse so `pop` yields the https form first.
        this.urls.with_mut(|urls| {
            urls.extend(Repository::try_ssh(&url));
            urls.extend(Repository::try_https(&url));
            if urls.is_empty() {
                urls.push(url);
            }
        });

        let offline = this.manager().options.offline
            == crate::package_manager_real::options::OfflineMode::Offline;
        let folder_name = bare_repo_folder_name(this.task().id);
        match bun_sys::Dir::borrow(&this.cache_dir)
            .open_dir_z(&bun_core::ZBox::from_bytes(&folder_name))
        {
            Ok(dir) => {
                // --prefer-offline still fetches: a stale clone may lack the pinned commit.
                if offline {
                    Self::finish_on_pool(this, Finalize::Repo(dir.into_raw()));
                    return Ok(());
                }
                let path = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
                    &this.manager().cache_directory_path,
                    &[&folder_name],
                )
                .to_vec();
                this.step.set(Step::Fetch(dir));
                Self::spawn(this, &[b"-C", &path, b"fetch", b"--quiet"])
            }
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => {
                if offline {
                    this.log_error(format_args!(
                        "--offline: git repository for \"{}\" is not in the cache",
                        BStr::new(&this.name)
                    ));
                    return Err(Error::InstallFailed);
                }
                Self::spawn_clone(this)
            }
            Err(err) => Err(err.into()),
        }
    }

    /// `urls` is not empty. May free `this` on `Ok`.
    fn spawn_clone(this: ThisPtr<Self>) -> Result<(), Error> {
        let url = this
            .urls
            .with_mut(|urls| urls.pop())
            .expect("a clone URL is left");
        let tmp_path = this.new_staging()?;
        this.step.set(Step::Clone);
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

    // ── find commit ─────────────────────────────────────────────────────────

    /// May free `this` on `Ok`.
    fn begin_commit(this: ThisPtr<Self>) -> Result<(), Error> {
        let req = this.task().request_git_commit();
        let committish = req.committish.slice().to_vec();
        let path = Path::resolve_path::join_abs_string::<Path::platform::Auto>(
            &this.manager().cache_directory_path,
            &[&bare_repo_folder_name(req.clone_id)],
        )
        .to_vec();
        this.step.set(Step::Log);
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
                    &committish,
                ],
            )
        }
    }

    // ── checkout ────────────────────────────────────────────────────────────

    /// May free `this` on `Ok`.
    fn begin_checkout(this: ThisPtr<Self>) -> Result<(), Error> {
        bun_analytics::features::git_dependencies.fetch_add(1, Ordering::Relaxed);
        let req = this.task().request_git_checkout();
        let repo_dir = req.repo_dir;
        let resolved = req.resolved.slice().to_vec();
        if !is_safe_resolved_tag(&resolved) {
            this.log_error(format_args!(
                "invalid git commit \"{}\" for \"{}\"",
                BStr::new(&resolved),
                BStr::new(&this.name)
            ));
            return Err(Error::InstallFailed);
        }

        match bun_sys::Dir::borrow(&this.cache_dir).open_at(&checkout_folder_name(&resolved)) {
            Ok(dir) => {
                if bun_sys::exists_at(dir.fd(), bun_core::zstr!(".bun-tag")) {
                    Self::finish_on_pool(this, Finalize::CachedCheckout(dir));
                    return Ok(());
                }
                dir.close();
            }
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => {}
            Err(err) => return Err(err.into()),
        }

        let mut repo_path_buf = Path::path_buffer_pool::get();
        let repo_path = bun_sys::get_fd_path(repo_dir, &mut repo_path_buf)?.to_vec();
        let tmp_path = this.new_staging()?;
        this.step.set(Step::CheckoutClone);
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

    // ── the child ───────────────────────────────────────────────────────────

    /// Spawns `git <args>` with stdout and stderr captured. On `Ok` the child
    /// may already have exited and freed `this`.
    fn spawn(this: ThisPtr<Self>, args: &[&[u8]]) -> Result<(), Error> {
        let env = GitEnv::get(this.manager().env_mut());
        let Some(git) = &env.git else {
            this.log_error(format_args!(
                "\"git\" is not installed (needed for \"{}\")",
                BStr::new(&this.name)
            ));
            return Err(Error::Sys(bun_errno::SystemErrno::ENOENT));
        };
        let mut argv: Vec<CString> = Vec::with_capacity(args.len() + 1);
        argv.push(CString::new(git.as_bytes()).map_err(|_| Error::InvalidCharacter)?);
        for arg in args {
            argv.push(CString::new(*arg).map_err(|_| Error::InvalidCharacter)?);
        }
        let argv: Vec<&CStr> = argv.iter().map(CString::as_c_str).collect();
        let envp: Vec<&CStr> = env.envp.iter().collect();

        let this_ptr: *mut c_void = this.as_ptr().cast();
        this.read_error.set(None);
        this.exit_status.set(None);
        this.remaining_fds.set(0);

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
            )) as bun_spawn::windows::UvPipePtr),
            #[cfg(windows)]
            stderr: bun_spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(
                bun_core::ffi::zeroed::<uv::Pipe>(),
            )) as bun_spawn::windows::UvPipePtr),
            #[cfg(windows)]
            windows: bun_spawn::WindowsOptions {
                loop_: this.event_loop,
                ..Default::default()
            },
            stream: false,
            // The kernel kills the child when bun dies, so no git outlives the install.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            linux_pdeathsig: Some(bun_sys::SignalCode::SIGKILL.0),
            ..Default::default()
        };
        #[cfg(windows)]
        let mut spawn_options = spawn_options;

        let spawned =
            match bun_spawn::spawn_process_cstr(&spawn_options, &argv, SpawnEnv::Strings(&envp)) {
                Ok(Ok(spawned)) => spawned,
                res => {
                    #[cfg(windows)]
                    {
                        spawn_options.stdout.deinit();
                        spawn_options.stderr.deinit();
                    }
                    res??;
                    unreachable!();
                }
            };
        #[cfg(windows)]
        let mut spawned = spawned;

        // A reader that fails to start reports through `on_reader_error`, which only
        // touches `remaining_fds` / `read_error`, never the reader cell being borrowed.
        #[cfg(unix)]
        for (reader, fd, is_memfd) in [
            (&this.stdout, spawned.stdout, spawned.memfds[1]),
            (&this.stderr, spawned.stderr, spawned.memfds[2]),
        ] {
            let Some(fd) = fd else { continue };
            reader.with_mut(|r| r.set_parent(this_ptr));
            if is_memfd {
                reader.with_mut(|r| r.start_memfd(fd));
                continue;
            }
            let _ = bun_sys::set_nonblocking(fd);
            this.remaining_fds.set(this.remaining_fds.get() + 1);
            reader.with_mut(|r| {
                r.flags.insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
                r.start(fd, true)
            })?;
            reader.with_mut(|r| {
                if let Some(poll) = r.handle.get_poll() {
                    poll.set_flag(FilePollFlag::Socket);
                }
            });
        }
        #[cfg(windows)]
        for (reader, pipe) in [
            (&this.stdout, spawned.stdout.take()),
            (&this.stderr, spawned.stderr.take()),
        ] {
            // Take sole ownership of each pipe before `spawned` drops.
            let bun_spawn::SpawnedStdio::Buffer(pipe) = pipe else {
                continue;
            };
            reader.with_mut(|r| {
                r.set_source(bun_io::Source::Pipe(pipe));
                r.set_parent(this_ptr);
            });
            this.remaining_fds.set(this.remaining_fds.get() + 1);
            reader.with_mut(|r| r.start_with_current_pipe())?;
        }

        debug_assert!(this.process.get().is_none());
        let process = spawned.to_process_handle(this.event_loop);
        process.set_exit_handler(this);
        // The exit handler may run inside `watch_or_reap` / `on_exit` and free
        // `this`; after those only the local handle is touched.
        match process.watch_or_reap() {
            Ok(false) => this.process.set(Some(process)),
            Ok(true) => {}
            Err(err) => {
                if !process.has_exited() {
                    process.on_exit(Status::Err(err), &bun_core::ffi::zeroed::<Rusage>());
                }
            }
        }
        Ok(())
    }

    /// The child has exited and both readers are done; ready for the next `spawn`.
    fn reset_polls(&self) {
        debug_assert!(self.remaining_fds.get() == 0);
        self.process.set(None);
        self.stdout.with_mut(|r| r.deinit());
        self.stderr.with_mut(|r| r.deinit());
        self.stdout.set(BufferedReader::init::<Self>());
        self.stderr.set(BufferedReader::init::<Self>());
    }

    /// May free `this`.
    fn on_process_exit(this: ThisPtr<Self>, _: &Process, status: Status, _: &Rusage) {
        this.exit_status.set(Some(status));
        Self::maybe_finished(this);
    }

    /// May free `this`.
    fn on_reader_done(this: ThisPtr<Self>) {
        debug_assert!(this.remaining_fds.get() > 0);
        this.remaining_fds.set(this.remaining_fds.get() - 1);
        Self::maybe_finished(this);
    }

    /// May free `this`.
    fn on_reader_error(this: ThisPtr<Self>, err: bun_sys::Error) {
        debug_assert!(this.remaining_fds.get() > 0);
        this.remaining_fds.set(this.remaining_fds.get() - 1);
        this.read_error.with_mut(|e| {
            e.get_or_insert(err);
        });
        Self::maybe_finished(this);
    }

    /// May free `this`.
    fn maybe_finished(this: ThisPtr<Self>) {
        if this.remaining_fds.get() != 0 {
            return;
        }
        let Some(status) = this.exit_status.take() else {
            return;
        };
        let stdout = this.stdout.with_mut(|r| core::mem::take(r.final_buffer()));
        let stderr = this.stderr.with_mut(|r| core::mem::take(r.final_buffer()));
        Self::on_command_exit(this, &status, &stdout, &stderr);
    }

    /// The child has exited and its output is collected. May free `this`.
    fn on_command_exit(this: ThisPtr<Self>, status: &Status, stdout: &[u8], stderr: &[u8]) {
        let ok = matches!(status, Status::Exited(exit) if exit.code == 0)
            && this.read_error.get().is_none();
        let step = this.step.replace(Step::Clone);
        // "remote: Repository not found." / "fatal: repository '<url>' does not exist"
        let not_found = !ok
            && matches!(step, Step::Clone)
            && ((strings::contains(stderr, b"remote:")
                && strings::contains(stderr, b"not")
                && strings::contains(stderr, b"found"))
                || strings::contains(stderr, b"does not exist"));
        if !ok && !not_found {
            this.report_failure(status, stderr);
        }
        let name = BStr::new(&this.name);
        match step {
            Step::Fetch(dir) => {
                if ok {
                    Self::finish_on_pool(this, Finalize::Repo(dir.into_raw()));
                } else {
                    this.log_error(format_args!("\"git fetch\" for \"{}\" failed", name));
                    Self::fail(this, Error::InstallFailed);
                }
            }
            Step::Clone => {
                if ok {
                    let staging = this.staging.take().expect("clone has a staging folder");
                    Self::finish_on_pool(this, Finalize::PublishRepo(staging));
                } else if !not_found && !this.urls.get().is_empty() {
                    // Try the next URL form (ssh after https).
                    this.staging
                        .take()
                        .expect("clone has a staging folder")
                        .discard();
                    this.reset_polls();
                    if let Err(err) = Self::spawn_clone(this) {
                        Self::fail(this, err);
                    }
                } else {
                    this.log_error(format_args!("\"git clone\" for \"{}\" failed", name));
                    Self::fail(
                        this,
                        if not_found {
                            Error::RepositoryNotFound
                        } else {
                            Error::InstallFailed
                        },
                    );
                }
            }
            Step::Log => {
                let result = if ok {
                    Ok(strings::trim(stdout, b" \t\r\n").to_vec())
                } else {
                    Err(Error::InstallFailed)
                };
                Self::finish_commit(this, result);
            }
            Step::CheckoutClone => {
                if ok {
                    let tmp_path = this
                        .staging
                        .get()
                        .as_ref()
                        .expect("checkout has a staging folder")
                        .tmp_path
                        .clone();
                    let resolved = this.task().request_git_checkout().resolved.slice().to_vec();
                    this.step.set(Step::Checkout);
                    this.reset_polls();
                    // `is_safe_resolved_tag` rejected a leading `-`: not a git option.
                    if let Err(err) = Self::spawn(
                        this,
                        &[b"-C", &tmp_path, b"checkout", b"--quiet", &resolved],
                    ) {
                        Self::fail(this, err);
                    }
                } else {
                    this.log_error(format_args!("\"git clone\" for \"{}\" failed", name));
                    Self::fail(this, Error::InstallFailed);
                }
            }
            Step::Checkout => {
                if ok {
                    let staging = this.staging.take().expect("checkout has a staging folder");
                    Self::finish_on_pool(this, Finalize::PublishCheckout(staging));
                } else {
                    this.log_error(format_args!("\"git checkout\" for \"{}\" failed", name));
                    Self::fail(this, Error::InstallFailed);
                }
            }
        }
    }

    /// Mirrors git's stderr and termination kind, which name the cause.
    fn report_failure(&self, status: &Status, stderr: &[u8]) {
        match (status, self.read_error.take()) {
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

    /// Fails the task with `err`. Frees `this`.
    fn fail(this: ThisPtr<Self>, err: Error) {
        if this.tag == Tag::GitCommit {
            Self::finish_commit(this, Err(err));
        } else {
            let staging = this.staging.take();
            Self::finish_on_pool(this, Finalize::Failed { staging, err });
        }
    }

    /// Drops the owning ref: the process handle and readers are torn down on
    /// this (the event loop's) thread, and the git slot is free again.
    fn release(this: ThisPtr<Self>) {
        let owner = this.owner.take().expect("git runner finished twice");
        this.manager()
            .running_git_tasks
            .fetch_sub(1, Ordering::Relaxed);
        drop(owner);
    }

    /// Hands a clone or checkout task to the thread pool for `finalize`.
    /// `Task::callback` pushes the task onto `resolve_tasks`. Frees `this`.
    fn finish_on_pool(this: ThisPtr<Self>, finalize: Finalize) {
        debug_assert!(this.tag != Tag::GitCommit);
        let manager = this.manager;
        let task = this.task;
        this.task().git_finalize = Some(finalize);
        Self::release(this);
        // SAFETY: the task is idle until the pool runs it.
        let batch = ThreadPool::Batch::from(unsafe { &raw mut (*task.as_ptr()).threadpool_task });
        manager.thread_pool.schedule(batch);
    }

    /// Hands the finished commit lookup to `resolve_tasks`. Frees `this`.
    fn finish_commit(this: ThisPtr<Self>, result: Result<Vec<u8>, Error>) {
        debug_assert!(this.tag == Tag::GitCommit);
        let manager = this.manager;
        let task_ptr = this.task;
        {
            let task = this.task();
            // `deinit_payload` drops the active `data` arm, so every path writes one.
            let (status, err, sha) = match result {
                Ok(sha) => (Task::Status::Success, None, sha),
                Err(err) => (Task::Status::Fail, Some(err), Vec::new()),
            };
            task.status = status;
            task.err = err;
            task.data = Task::Data {
                git_commit: ManuallyDrop::new(sha),
            };
        }
        Self::release(this);
        manager.resolve_tasks.push(task_ptr);
        // SAFETY: the manager outlives every task; see `wake_raw`.
        unsafe { PackageManager::wake_raw(manager.as_ptr()) };
    }
}

impl Drop for GitSubprocess {
    fn drop(&mut self) {
        self.process.set(None);
        self.stdout.with_mut(|r| r.deinit());
        self.stderr.with_mut(|r| r.deinit());
        if let Some(staging) = self.staging.take() {
            staging.discard();
        }
    }
}

bun_spawn::link_impl_ProcessExit! {
    InstallGit for GitSubprocess => |this| {
        // SAFETY: `this` is the live runner installed via `set_exit_handler`.
        on_process_exit(process, status, rusage) =>
            GitSubprocess::on_process_exit(ThisPtr::new(this), &*process, status, rusage),
    }
}

bun_io::impl_buffered_reader_parent! {
    InstallGit for GitSubprocess;
    has_on_read_chunk = false;
    // SAFETY: `this` is the live runner registered via `set_parent`.
    on_reader_done  = |this| GitSubprocess::on_reader_done(ThisPtr::new(this));
    // SAFETY: `this` is the live runner registered via `set_parent`.
    on_reader_error = |this, err| GitSubprocess::on_reader_error(ThisPtr::new(this), err);
    loop_           = |this| (*this).event_loop.native_loop();
    event_loop      = |this| (*this).event_loop.as_event_loop_ctx();
}

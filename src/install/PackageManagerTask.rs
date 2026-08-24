//! Schedule long-running callbacks for a task
//! Slow stuff is broken into tasks, each can run independently without locks

use bun_ast::{Loc, Log};
use bun_core::Output;
use bun_core::StringOrTinyString;
use bun_semver as semver;
use bun_sys::{Fd, File};
use bun_threading::thread_pool;
use bun_wyhash::Wyhash11;

use crate::npm;
use crate::{
    DependencyID, ExtractData, ExtractTarball, NetworkTask, PackageManager, PatchTask, Resolution,
};

/// A resolve/extract job. Built on the main thread, run once on a thread-pool
/// worker ([`bun_threading::work_pool::OwnedTask::run`]), and handed back to
/// the main thread through `Shared::resolve_tasks`.
pub struct Task {
    pub(crate) request: Request,
    pub(crate) data: Data,
    pub(crate) status: Status,
    pub(crate) threadpool_task: thread_pool::Task,
    pub(crate) log: Log,
    pub(crate) id: Id,
    pub(crate) err: Option<crate::Error>,
    /// Read-only on the worker (options, cache/temp dirs, `shared`); the
    /// manager is leaked for the process and outlives every task.
    pub(crate) package_manager: bun_ptr::BackRef<PackageManager>,
    pub(crate) apply_patch_task: Option<Box<PatchTask>>,
    /// The filesystem tail of a clone or checkout task; `run_owned` runs it.
    pub(crate) git_finalize: Option<crate::git_runner::Finalize>,
    /// INTRUSIVE — `OwnedQueue<Task>` link.
    pub(crate) next: bun_threading::Link<Task>,
}

bun_threading::intrusive_linked!(Task, next);
bun_threading::owned_task!(Task, threadpool_task);

impl Task {
    pub(crate) fn new(manager: &PackageManager, id: Id, request: Request) -> Box<Task> {
        Box::new(Task {
            request,
            data: Data::None,
            status: Status::Waiting,
            threadpool_task: thread_pool::Task::default(),
            log: Log::default(),
            id,
            err: None,
            package_manager: bun_ptr::BackRef::new(manager),
            apply_patch_task: None,
            git_finalize: None,
            next: bun_threading::Link::new(),
        })
    }

    #[inline]
    pub(crate) fn tag(&self) -> Tag {
        match self.request {
            Request::PackageManifest { .. } => Tag::PackageManifest,
            Request::Extract { .. } => Tag::Extract,
            Request::GitClone { .. } => Tag::GitClone,
            Request::GitCommit { .. } => Tag::GitCommit,
            Request::GitCheckout { .. } => Tag::GitCheckout,
            Request::LocalTarball { .. } => Tag::LocalTarball,
        }
    }
}

/// An ID that lets us register a callback without keeping the same pointer around
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Id(u64);

impl core::fmt::Display for Id {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Printed as its raw integer in `{}` debug logs.
        self.0.fmt(f)
    }
}

impl Id {
    #[inline]
    pub(crate) fn get(self) -> u64 {
        self.0
    }

    pub(crate) fn for_npm_package(package_name: &[u8], package_version: semver::Version) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"npm-package:");
        hasher.update(package_name);
        hasher.update(b"@");
        hasher.update(bytemuck::bytes_of(&package_version));
        Id(hasher.final_())
    }

    pub(crate) fn for_manifest(name: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"manifest:");
        hasher.update(name);
        Id(hasher.final_())
    }

    pub(crate) fn for_tarball(url: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"tarball:");
        hasher.update(url);
        Id(hasher.final_())
    }

    // These cannot change:
    // We persist them to the filesystem.
    pub(crate) fn for_git_clone(url: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(url);
        // @truncate to u61 then widen to u64 — keep low 61 bits
        Id((4u64 << 61) | (hasher.final_() & ((1u64 << 61) - 1)))
    }

    pub(crate) fn for_git_checkout(url: &[u8], resolved: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(url);
        hasher.update(b"@");
        hasher.update(resolved);
        Id((5u64 << 61) | (hasher.final_() & ((1u64 << 61) - 1)))
    }

    /// Not persisted: only keys the in-memory `git_commits` cache and `task_queue`.
    pub(crate) fn for_git_commit(url: &[u8], committish: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(url);
        hasher.update(b"#");
        hasher.update(committish);
        Id((6u64 << 61) | (hasher.final_() & ((1u64 << 61) - 1)))
    }
}

impl Task {
    #[inline]
    pub(crate) fn request_package_manifest(&self) -> (&StringOrTinyString, &NetworkTask) {
        match &self.request {
            Request::PackageManifest { name, network } => (
                name,
                network
                    .as_deref()
                    .expect("manifest task owns its network task"),
            ),
            _ => unreachable!(),
        }
    }
    #[inline]
    pub(crate) fn request_git_clone(&self) -> &GitCloneRequest {
        match &self.request {
            Request::GitClone(req) => req,
            _ => unreachable!(),
        }
    }
    #[inline]
    pub(crate) fn request_git_commit(&self) -> &GitCommitRequest {
        match &self.request {
            Request::GitCommit(req) => req,
            _ => unreachable!(),
        }
    }
    #[inline]
    pub(crate) fn request_git_checkout(&self) -> &GitCheckoutRequest {
        match &self.request {
            Request::GitCheckout(req) => req,
            _ => unreachable!(),
        }
    }

    /// The tarball an `Extract`/`LocalTarball` task is for.
    #[inline]
    pub(crate) fn request_tarball(&self) -> &ExtractTarball {
        match &self.request {
            Request::Extract { tarball, .. } | Request::LocalTarball { tarball, .. } => tarball,
            _ => unreachable!(),
        }
    }

    #[inline]
    pub(crate) fn data_extract(&self) -> &ExtractData {
        match &self.data {
            Data::Extract(d) => d,
            _ => unreachable!(),
        }
    }
    #[inline]
    pub(crate) fn data_git_clone(&self) -> Fd {
        match self.data {
            Data::GitClone(fd) => fd,
            _ => unreachable!(),
        }
    }
    #[inline]
    pub(crate) fn data_git_commit(&self) -> &[u8] {
        match &self.data {
            Data::GitCommit(sha) => sha,
            _ => unreachable!(),
        }
    }
    #[inline]
    pub(crate) fn data_git_checkout(&self) -> &ExtractData {
        self.data_extract()
    }
}

impl Task {
    /// Thread-pool entry point: run the request, then hand the task back to
    /// the main thread.
    fn run_owned(mut self: Box<Self>) {
        Output::Source::configure_thread();

        // The manager is only read here: options for the manifest scope, and
        // the cache/temp directories, which the main thread opened before
        // scheduling (`PackageManager::schedule_tasks`).
        let manager_ref = self.package_manager;
        let manager: &PackageManager = manager_ref.get();
        let this = &mut *self;

        'body: {
            match &mut this.request {
                Request::PackageManifest { name, network } => {
                    let network = network
                        .as_mut()
                        .expect("manifest task owns its network task");
                    // Take ownership so the
                    // multi-MB manifest buffer drops on every exit of this arm
                    // instead of staying live on the NetworkTask until recycle.
                    let mut body = core::mem::take(&mut network.response_buffer);

                    let Some(metadata) = &network.response.metadata else {
                        // Handle the case when metadata is null (e.g., network failure before receiving headers)
                        let err = network
                            .response
                            .fail
                            .map(crate::Error::from)
                            .unwrap_or(crate::Error::HTTPError);
                        this.log.add_error_fmt(
                            None,
                            Loc::EMPTY,
                            format_args!(
                                "{} downloading package manifest {}",
                                err.name(),
                                bstr::BStr::new(name.slice()),
                            ),
                        );
                        this.err = Some(err);
                        this.status = Status::Fail;
                        this.data = Data::PackageManifest(npm::PackageManifest::default());
                        break 'body;
                    };

                    let crate::network_task::Callback::PackageManifest {
                        loaded_manifest,
                        is_extended_manifest,
                        ..
                    } = &network.callback
                    else {
                        unreachable!("manifest network task built by `NetworkTask::for_manifest`")
                    };
                    let loaded_manifest = loaded_manifest.clone();
                    let is_extended_manifest = *is_extended_manifest;

                    let scope = manager.scope_for_package_name(name.slice());
                    let package_manifest = match npm::Registry::get_package_metadata(
                        scope,
                        metadata.response,
                        body.slice(),
                        &mut this.log,
                        name.slice(),
                        loaded_manifest,
                        manager,
                        is_extended_manifest,
                    ) {
                        Ok(v) => v,
                        Err(err) => {
                            this.err = Some(err);
                            this.status = Status::Fail;
                            this.data = Data::PackageManifest(npm::PackageManifest::default());
                            break 'body;
                        }
                    };

                    match package_manifest {
                        npm::registry::PackageVersionResponse::Fresh(result)
                        | npm::registry::PackageVersionResponse::Cached(result) => {
                            this.status = Status::Success;
                            this.data = Data::PackageManifest(result);
                            break 'body;
                        }
                        npm::registry::PackageVersionResponse::NotFound => {
                            this.log.add_error_fmt(
                                None,
                                Loc::EMPTY,
                                format_args!("404 - GET {}", bstr::BStr::new(name.slice())),
                            );
                            this.status = Status::Fail;
                            this.data = Data::PackageManifest(npm::PackageManifest::default());
                            break 'body;
                        }
                    }
                }
                Request::Extract { network, tarball } => {
                    // Streaming extraction never reaches this callback: the
                    // HTTP thread drives `TarballStream.drain_task`, which
                    // fills in `this.data`/`this.status` and pushes to
                    // `resolve_tasks` directly from `TarballStream.finish()`.
                    // This path is the buffered fallback — feature flag off,
                    // non-2xx status, or the whole body arrived in a single
                    // chunk before streaming could commit.
                    let network = network
                        .as_mut()
                        .expect("extract task owns its network task");
                    // Take ownership so the
                    // tarball body drops on every exit of this arm.
                    let mut buffer = core::mem::take(&mut network.response_buffer);

                    match tarball.run(&mut this.log, buffer.slice()) {
                        Ok(result) => {
                            this.data = Data::Extract(result);
                            this.status = Status::Success;
                        }
                        Err(err) => {
                            this.err = Some(err);
                            this.status = Status::Fail;
                            this.data = Data::Extract(ExtractData::default());
                        }
                    }
                }
                Request::GitClone(_) | Request::GitCheckout(_) => {
                    crate::git_runner::Finalize::run(this);
                }
                Request::GitCommit(_) => {
                    unreachable!("a commit lookup completes on the install thread (git_runner.rs)")
                }
                Request::LocalTarball {
                    tarball,
                    tarball_path,
                    normalize,
                } => {
                    // `tarball_path` and `normalize` are computed on the main thread when the
                    // task is enqueued. This callback runs on a ThreadPool worker and must not
                    // read `manager.lockfile.packages` / `manager.lockfile.buffers.string_bytes`:
                    // the main thread may reallocate those buffers concurrently while processing
                    // other dependencies.
                    match read_and_extract(tarball, tarball_path.slice(), *normalize, &mut this.log)
                    {
                        Ok(result) => {
                            this.data = Data::Extract(result);
                            this.status = Status::Success;
                        }
                        Err(err) => {
                            this.err = Some(err);
                            this.status = Status::Fail;
                            this.data = Data::Extract(ExtractData::default());
                        }
                    }
                }
            }
        }

        // Runs after the switch on all paths.
        if this.status == Status::Success {
            if let Some(mut pt) = this.apply_patch_task.take() {
                bun_core::handle_oom(pt.apply());
                let apply = pt.callback.apply_mut();
                if apply.logger.errors > 0 {
                    let _ = apply
                        .logger
                        .print(std::ptr::from_mut(Output::error_writer()));
                }
            }
        }

        let shared = manager.shared;
        shared.resolve_tasks.push(self);
        shared.wake();

        Output::flush();
    }
}

fn read_and_extract(
    tarball: &ExtractTarball,
    tarball_path: &[u8],
    normalize: bool,
    log: &mut Log,
) -> crate::Result<ExtractData> {
    let bytes = if normalize {
        // Resolves a user-provided relative path against
        // `FileSystem::instance().top_level_dir()` (the absolute project root
        // cached at startup — NOT the live process cwd), which
        // `bun_sys::File::read_from_user_input` takes explicitly.
        File::read_from_user_input(
            Fd::cwd(),
            crate::bun_fs::FileSystem::instance().top_level_dir(),
            tarball_path,
        )?
    } else {
        File::read_from(Fd::cwd(), tarball_path)?
    };
    tarball.run(log, &bytes)
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tag {
    PackageManifest = 0,
    Extract = 1,
    GitClone = 2,
    GitCheckout = 3,
    LocalTarball = 4,
    /// `git log`: resolve a committish of a cloned repository to a commit SHA.
    GitCommit = 5,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Waiting,
    Success,
    Fail,
}

pub enum Data {
    /// Not yet run.
    None,
    PackageManifest(npm::PackageManifest),
    /// `Extract`, `LocalTarball` and `GitCheckout` results.
    Extract(ExtractData),
    GitClone(Fd),
    /// The commit SHA.
    GitCommit(Vec<u8>),
}

pub enum Request {
    /// package name
    // todo: Registry URL
    PackageManifest {
        name: StringOrTinyString,
        /// `None` only once `run_tasks` has taken it back.
        network: Option<Box<NetworkTask>>,
    },
    Extract {
        /// `None` while a streaming download still holds the network task
        /// (`NetworkTask::streaming_extract_task`), and once `run_tasks` has
        /// taken it back.
        network: Option<Box<NetworkTask>>,
        tarball: ExtractTarball,
    },
    GitClone(GitCloneRequest),
    GitCommit(GitCommitRequest),
    GitCheckout(GitCheckoutRequest),
    LocalTarball {
        tarball: ExtractTarball,
        /// Resolved by `enqueue_local_tarball` on the main thread; the worker must not read the lockfile.
        tarball_path: StringOrTinyString,
        /// When true, `tarball_path` is a user-provided path resolved relative to
        /// cwd. When false, it is already an absolute path.
        normalize: bool,
    },
}

pub struct GitCloneRequest {
    pub(crate) name: StringOrTinyString,
    pub(crate) url: StringOrTinyString,
    pub(crate) res: Resolution,
}

pub struct GitCommitRequest {
    /// The clone task whose bare repository is searched.
    pub(crate) clone_id: Id,
    pub(crate) name: StringOrTinyString,
    pub(crate) url: StringOrTinyString,
    pub(crate) committish: StringOrTinyString,
}

pub struct GitCheckoutRequest {
    pub(crate) repo_dir: Fd,
    pub(crate) dependency_id: DependencyID,
    pub(crate) name: StringOrTinyString,
    pub(crate) url: StringOrTinyString,
    pub(crate) resolved: StringOrTinyString,
    pub(crate) resolution: Resolution,
}

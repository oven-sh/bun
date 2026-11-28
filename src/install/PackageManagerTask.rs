//! Schedule long-running callbacks for a task
//! Slow stuff is broken into tasks, each can run independently without locks

use bun_ast::{Loc, Log};
use bun_core::Output;
use bun_core::StringOrTinyString;
use bun_ptr::Unique;
use bun_semver as semver;
use bun_sys::{Fd, File};
use bun_threading::thread_pool;
use bun_wyhash::Wyhash11;

use crate::npm;
use crate::package_manager::INBOX;
use crate::package_manager::directories::TemporaryDirectory;
use crate::{
    DependencyID, ExtractData, ExtractTarball, NetworkTask, PackageManager, PatchTask, Resolution,
};

pub struct Task {
    pub(crate) job: Job,
    /// default: `Status::Waiting`
    pub(crate) status: Status,
    /// default: `thread_pool::Task { callback: Task::callback }`
    threadpool_task: thread_pool::Task,
    pub(crate) log: Log,
    pub(crate) id: Id,
    /// default: `None`
    pub(crate) err: Option<crate::Error>,
    /// The filesystem tail of a clone or checkout task; `callback` runs it. default: `None`
    pub(crate) git_finalize: Option<crate::git_runner::Finalize>,
    /// INTRUSIVE — `bun.UnboundedQueue(Task, .next)`
    /// default: null
    pub(crate) next: bun_threading::Link<Task>,
}

bun_core::intrusive_field!(Task, next: bun_threading::Link<Self>);

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
        hasher.update(bun_core::bytes_of(&package_version));
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
    /// In a slot of `manager.preallocated_resolve_tasks`.
    pub(crate) fn create(manager: &mut PackageManager, id: Id, job: Job) -> Unique<Self> {
        let task = Task {
            job,
            log: Log::init(),
            id,
            status: Status::Waiting,
            threadpool_task: thread_pool::Task {
                node: Default::default(),
                callback: Task::callback,
            },
            err: None,
            git_finalize: None,
            next: bun_threading::Link::new(),
        };
        // SAFETY: a new slot, which stays until `put`. The manager is never freed.
        unsafe { Unique::from_raw(manager.preallocated_resolve_tasks.get_init(task).as_ptr()) }
    }

    pub(crate) fn into_batch(self: Unique<Self>) -> thread_pool::Batch {
        // SAFETY: a field of the task that `callback` takes back.
        unsafe { thread_pool::Batch::from(&raw mut (*self.into_raw()).threadpool_task) }
    }

    pub(crate) fn tarball(&self) -> &ExtractTarball {
        match &self.job {
            Job::Extract { tarball, .. } => tarball,
            _ => unreachable!("not an extract task"),
        }
    }

    pub(crate) fn request_git_clone(&self) -> &GitCloneRequest {
        match &self.job {
            Job::GitClone { request, .. } => request,
            _ => unreachable!("not a clone task"),
        }
    }

    pub(crate) fn request_git_commit(&self) -> &GitCommitRequest {
        match &self.job {
            Job::GitCommit { request, .. } => request,
            _ => unreachable!("not a commit task"),
        }
    }

    pub(crate) fn request_git_checkout(&self) -> &GitCheckoutRequest {
        match &self.job {
            Job::GitCheckout { request, .. } => request,
            _ => unreachable!("not a checkout task"),
        }
    }
}

impl Task {
    unsafe fn callback(task: *mut thread_pool::Task) {
        Output::Source::configure_thread();

        // SAFETY: the field that `into_batch` handed to the pool.
        let mut task =
            unsafe { Unique::from_raw(bun_core::from_field_ptr!(Task, threadpool_task, task)) };
        let this: &mut Task = &mut task;

        // Body of the switch; arms exit via `break 'body;` so the
        // trailing block (patch + push + wake) and `Output::flush()` run
        // unconditionally afterwards.
        'body: {
            match &mut this.job {
                Job::PackageManifest {
                    name,
                    network,
                    temp_dir,
                    manifest,
                } => {
                    let network = &mut **network;
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
                        break 'body;
                    };

                    let crate::network_task::Callback::PackageManifest {
                        loaded_manifest,
                        is_extended_manifest,
                        registry,
                        ..
                    } = &mut network.callback
                    else {
                        unreachable!("`NetworkTask::for_manifest` built it");
                    };

                    let package_manifest = match npm::Registry::get_package_metadata(
                        *registry,
                        metadata,
                        body.slice(),
                        &mut this.log,
                        name.slice(),
                        loaded_manifest.take(),
                        *temp_dir,
                        *is_extended_manifest,
                    ) {
                        Ok(v) => v,
                        Err(err) => {
                            this.err = Some(err);
                            this.status = Status::Fail;
                            break 'body;
                        }
                    };

                    match package_manifest {
                        npm::registry::PackageVersionResponse::Fresh(result)
                        | npm::registry::PackageVersionResponse::Cached(result) => {
                            this.status = Status::Success;
                            *manifest = Some(result);
                            break 'body;
                        }
                        npm::registry::PackageVersionResponse::NotFound => {
                            this.log.add_error_fmt(
                                None,
                                Loc::EMPTY,
                                format_args!("404 - GET {}", bstr::BStr::new(name.slice())),
                            );
                            this.status = Status::Fail;
                            break 'body;
                        }
                    }
                }
                Job::Extract {
                    tarball,
                    source: TarballSource::Network(Some(network)),
                    data,
                } => {
                    // Streaming extraction never reaches this callback: the
                    // HTTP thread drives `TarballStream.drain_task`, which
                    // fills in `data`/`this.status` and pushes to
                    // `resolve_tasks` directly from `TarballStream.finish()`.
                    // This path is the buffered fallback — feature flag off,
                    // non-2xx status, or the whole body arrived in a single
                    // chunk before streaming could commit.

                    // Take ownership so the
                    // tarball body drops on every exit of this arm.
                    let mut buffer = core::mem::take(&mut network.response_buffer);

                    let result = match tarball.run(&mut this.log, buffer.slice()) {
                        Ok(v) => v,
                        Err(err) => {
                            this.err = Some(err);
                            this.status = Status::Fail;
                            break 'body;
                        }
                    };

                    *data = Some(result);
                    this.status = Status::Success;
                }
                Job::GitClone { .. } | Job::GitCheckout { .. } => {
                    crate::git_runner::Finalize::run(this);
                }
                Job::GitCommit { .. } => {
                    unreachable!("a commit lookup completes on the install thread (git_runner.rs)")
                }
                Job::Extract {
                    source: TarballSource::Network(None),
                    ..
                } => unreachable!("`TarballStream::finish` completes it"),
                Job::Extract {
                    tarball,
                    source: TarballSource::Local { path, normalize },
                    data,
                } => {
                    // `path` and `normalize` are computed on the main thread when the
                    // task is enqueued. This callback runs on a ThreadPool worker and must not
                    // read `manager.lockfile.packages` / `manager.lockfile.buffers.string_bytes`:
                    // the main thread may reallocate those buffers concurrently while processing
                    // other dependencies.

                    let result =
                        match read_and_extract(tarball, path.slice(), *normalize, &mut this.log) {
                            Ok(v) => v,
                            Err(err) => {
                                this.err = Some(err);
                                this.status = Status::Fail;
                                break 'body;
                            }
                        };

                    *data = Some(result);
                    this.status = Status::Success;
                }
            }
        }

        // Runs after the switch on all paths.
        if let (Status::Success, Job::GitCheckout { request, .. }) = (this.status, &mut this.job) {
            if let Some(mut pt) = request.apply_patch_task.take() {
                // `defer pt.deinit()` → Box<PatchTask> drops at end of this block
                bun_core::handle_oom(pt.apply());
                // `defer pt.callback.apply.logger.deinit()` → `Log` drops with `pt`.
                let _ = (pt.callback.apply_mut().logger).print(Output::error_writer());
            }
        }
        INBOX.resolve_tasks.push(task);
        INBOX.wake();

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
        // Resolves
        // a user-provided relative path against `bun.fs.FileSystem.instance.top_level_dir`
        // (the absolute project root cached at startup — NOT the live process cwd).
        // `bun_sys::File::read_from_user_input` takes that base
        // explicitly (T1 `bun_sys` cannot depend on T5 `bun_resolver::fs`), so thread it
        // through here from the install crate's `FileSystem` shim.
        File::read_from_user_input(
            Fd::cwd(),
            crate::bun_fs::FileSystem::get().top_level_dir(),
            tarball_path,
        )?
    } else {
        File::read_from(Fd::cwd(), tarball_path)?
    };
    // `defer allocator.free(bytes)` → Vec<u8> drops at scope exit
    tarball.run(log, &bytes)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Waiting,
    Success,
    Fail,
}

/// What to do. The last field of each variant is the result, set if the task succeeds.
pub(crate) enum Job {
    PackageManifest {
        name: StringOrTinyString,
        network: Unique<NetworkTask>,
        /// `None` if the manifest cache is off or cannot be written.
        temp_dir: Option<&'static TemporaryDirectory>,
        manifest: Option<npm::PackageManifest>,
    },
    Extract {
        tarball: ExtractTarball,
        source: TarballSource,
        data: Option<ExtractData>,
    },
    GitClone {
        request: GitCloneRequest,
        repo: Fd,
    },
    /// `git log`: resolve a committish of a cloned repository to a commit SHA.
    GitCommit {
        request: GitCommitRequest,
        sha: Vec<u8>,
    },
    GitCheckout {
        request: GitCheckoutRequest,
        data: Option<ExtractData>,
    },
}

pub(crate) enum TarballSource {
    /// `None` while it is streamed, until `TarballStream::finish`.
    Network(Option<Unique<NetworkTask>>),
    Local {
        /// Resolved by `enqueue_local_tarball` on the main thread; the worker must not read the lockfile.
        path: StringOrTinyString,
        /// `path` is as the user wrote it, relative to the project's root. Otherwise it is absolute.
        normalize: bool,
    },
}

pub(crate) struct GitCloneRequest {
    pub(crate) name: StringOrTinyString,
    pub(crate) url: StringOrTinyString,
}

pub(crate) struct GitCommitRequest {
    /// The clone task whose bare repository is searched.
    pub(crate) clone_id: Id,
    pub(crate) name: StringOrTinyString,
    pub(crate) committish: StringOrTinyString,
}

pub(crate) struct GitCheckoutRequest {
    pub(crate) repo_dir: Fd,
    pub(crate) dependency_id: DependencyID,
    pub(crate) name: StringOrTinyString,
    pub(crate) url: StringOrTinyString,
    pub(crate) resolved: StringOrTinyString,
    pub(crate) resolution: Resolution,
    pub(crate) apply_patch_task: Option<Box<PatchTask>>,
}

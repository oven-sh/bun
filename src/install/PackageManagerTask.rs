//! Schedule long-running callbacks for a task
//! Slow stuff is broken into tasks, each can run independently without locks

use core::ptr::NonNull;

use bun_ast::Log;
use bun_core::Output;
use bun_core::StringOrTinyString;
use bun_semver as semver;
use bun_sys::{Fd, File};
use bun_threading::thread_pool;
use bun_wyhash::Wyhash11;

use crate::network_task::ManifestRequest;
use crate::npm;
use crate::package_manager::INBOX;
use crate::package_manager::directories::TemporaryDirectory;
use crate::{
    DependencyID, ExtractData, ExtractTarball, NetworkTask, PackageManager, PatchTask, Resolution,
};

/// TODO: lifetime — Task lives in an intrusive cross-thread queue
/// (`next`). A `&'static mut NetworkTask` cannot soundly
/// cross that boundary; Phase B should likely demote to `*mut NetworkTask`.
pub struct Task {
    pub(crate) job: Job,
    /// default: `thread_pool::Task { callback: Task::callback }`
    pub(crate) threadpool_task: thread_pool::Task,
    pub(crate) log: Log,
    /// The filesystem tail of a clone or checkout task; `callback` runs it. default: `None`
    pub(crate) git_finalize: Option<crate::git_runner::Finalize>,
    /// INTRUSIVE — `bun.UnboundedQueue(Task, .next)`
    /// default: null
    pub(crate) next: bun_threading::Link<Task>,
}

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue<Task>`;
// `link()` always projects to it.
unsafe impl bun_threading::Linked for Task {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

use crate::package_manager_real::fetch_table::Started;

macro_rules! hash_ids {
    ($($(#[$doc:meta])* $name:ident,)+) => {$(
        $(#[$doc])*
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub(crate) struct $name(u64);

        impl bun_collections::IdentityHash for $name {
            #[inline]
            fn identity_hash(self) -> u64 {
                self.0
            }
        }
    )+};
}

hash_ids! {
    ManifestId,
    TarballId,
    /// Cannot change: it names a folder in the cache.
    CloneId,
    CommitId,
    CheckoutId,
    /// A task that leaves a package in the cache.
    PackageFetchId,
}

fn hash(parts: &[&[u8]]) -> u64 {
    let mut hasher = Wyhash11::init(0);
    parts.iter().for_each(|part| hasher.update(part));
    hasher.final_()
}

fn git_hash(kind: u64, parts: &[&[u8]]) -> u64 {
    (kind << 61) | (hash(parts) & ((1u64 << 61) - 1))
}

impl ManifestId {
    pub(crate) fn new(name: &[u8]) -> Self {
        Self(hash(&[b"manifest:", name]))
    }
}

impl TarballId {
    pub(crate) fn for_npm_package(name: &[u8], version: semver::Version) -> Self {
        let version = bun_core::bytes_of(&version);
        Self(hash(&[b"npm-package:", name, b"@", version]))
    }

    pub(crate) fn for_url(url: &[u8]) -> Self {
        Self(hash(&[b"tarball:", url]))
    }
}

impl CloneId {
    pub(crate) fn new(url: &[u8]) -> Self {
        Self(git_hash(4, &[url]))
    }

    /// The cache folder of the bare clone.
    pub(crate) fn folder_name(self) -> Vec<u8> {
        format!("{}.git", bun_core::fmt::hex_int_lower::<16>(self.0)).into_bytes()
    }
}

impl CheckoutId {
    pub(crate) fn new(url: &[u8], resolved: &[u8]) -> Self {
        Self(git_hash(5, &[url, b"@", resolved]))
    }
}

impl CommitId {
    pub(crate) fn new(url: &[u8], committish: &[u8]) -> Self {
        Self(git_hash(6, &[url, b"#", committish]))
    }
}

impl From<TarballId> for PackageFetchId {
    fn from(id: TarballId) -> Self {
        Self(id.0)
    }
}

impl From<CheckoutId> for PackageFetchId {
    fn from(id: CheckoutId) -> Self {
        Self(id.0)
    }
}

impl Task {
    /// In a slot of `manager.preallocated_resolve_tasks`.
    pub(crate) fn create(manager: &mut PackageManager, job: Job) -> NonNull<Self> {
        let task = Task {
            job,
            log: Log::init(),
            threadpool_task: thread_pool::Task {
                node: Default::default(),
                callback: Task::callback,
            },
            git_finalize: None,
            next: bun_threading::Link::new(),
        };
        manager.preallocated_resolve_tasks.get_init(task)
    }

    pub(crate) fn tarball(&self) -> &ExtractTarball {
        match &self.job {
            Job::Extract { tarball, .. } => tarball,
            _ => unreachable!("not an extract task"),
        }
    }

    /// The slot that goes back to its pool with this task.
    pub(crate) fn network_task(&mut self) -> Option<*mut NetworkTask> {
        match &mut self.job {
            Job::PackageManifest { network, .. }
            | Job::Extract {
                source: TarballSource::Network(network),
                ..
            } => Some(&raw mut **network),
            Job::Extract { .. }
            | Job::GitClone { .. }
            | Job::GitCommit { .. }
            | Job::GitCheckout { .. } => None,
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
    pub(crate) unsafe fn callback(task: *mut thread_pool::Task) {
        Output::Source::configure_thread();

        // SAFETY: `task` points to the `threadpool_task` field of a `Task`
        // (this is the only place this `thread_pool::Task` callback is registered).
        let this_raw: *mut Task = unsafe { bun_core::from_field_ptr!(Task, threadpool_task, task) };
        // The terminal `resolve_tasks.push` hands the task to the main thread
        // (which may recycle it while this fn still runs `Output::flush()`),
        // so the pushed pointer is derived from the raw receiver, not from the
        // `&mut` below, and nothing touches `this` after the push.
        // SAFETY: derived from `task`, which is not null.
        let task = unsafe { NonNull::new_unchecked(this_raw) };
        // SAFETY: exclusive access — task runs on exactly one worker thread
        let this: &mut Task = unsafe { &mut *this_raw };

        match &mut this.job {
            Job::PackageManifest {
                request,
                metadata,
                network,
                temp_dir,
                manifest,
            } => {
                // Taken, so that the multi-MB buffer is freed here and not when the slot is reused.
                let mut body = core::mem::take(&mut network.response_buffer);
                *manifest = npm::Registry::get_package_metadata(
                    request.registry,
                    metadata,
                    body.slice(),
                    &mut this.log,
                    request.name.slice(),
                    *temp_dir,
                    request.is_extended,
                );
            }
            // The buffered path. `TarballStream` completes a streamed download by itself.
            Job::Extract {
                tarball,
                source: TarballSource::Network(network),
                data,
            } => {
                let mut buffer = core::mem::take(&mut network.response_buffer);
                *data = tarball.run(&mut this.log, buffer.slice());
            }
            Job::Extract {
                tarball,
                source: TarballSource::Local { path, normalize },
                data,
            } => *data = read_and_extract(tarball, path.slice(), *normalize, &mut this.log),
            Job::GitClone { .. } | Job::GitCheckout { .. } => {
                crate::git_runner::Finalize::run(this);
            }
            Job::GitCommit { .. } => {
                unreachable!("a commit lookup completes on the install thread (git_runner.rs)")
            }
        }

        if let Job::GitCheckout {
            request,
            data: Ok(_),
        } = &mut this.job
            && let Some(mut pt) = request.apply_patch_task.take()
        {
            bun_core::handle_oom(pt.apply());
            let _ = (pt.callback.apply_mut().logger).print(Output::error_writer());
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

/// What to do. The last field of each variant is the result, a failure until the task has run.
pub(crate) enum Job {
    PackageManifest {
        request: ManifestRequest,
        metadata: bun_http::HTTPResponseMetadata,
        network: &'static mut NetworkTask,
        /// `None` if the manifest cache is off or cannot be written.
        temp_dir: Option<&'static TemporaryDirectory>,
        manifest: crate::Result<npm::PackageManifest>,
    },
    Extract {
        tarball: ExtractTarball,
        source: TarballSource,
        data: crate::Result<ExtractData>,
    },
    GitClone {
        request: GitCloneRequest,
        repo: crate::Result<Fd>,
    },
    /// `git log`: resolve a committish of a cloned repository to a commit SHA.
    GitCommit {
        request: GitCommitRequest,
        sha: Option<Vec<u8>>,
    },
    GitCheckout {
        request: GitCheckoutRequest,
        data: crate::Result<ExtractData>,
    },
}

pub(crate) enum TarballSource {
    Network(&'static mut NetworkTask),
    Local {
        /// Resolved by `enqueue_local_tarball` on the main thread; the worker must not read the lockfile.
        path: StringOrTinyString,
        /// `path` is as the user wrote it, relative to the project's root. Otherwise it is absolute.
        normalize: bool,
    },
}

pub(crate) struct GitCloneRequest {
    pub(crate) started: Started<CloneId>,
    pub(crate) name: StringOrTinyString,
    pub(crate) url: StringOrTinyString,
}

pub(crate) struct GitCommitRequest {
    pub(crate) started: Started<CommitId>,
    /// The clone task whose bare repository is searched.
    pub(crate) clone_id: CloneId,
    pub(crate) name: StringOrTinyString,
    pub(crate) committish: StringOrTinyString,
}

pub(crate) struct GitCheckoutRequest {
    pub(crate) started: Started<CheckoutId>,
    pub(crate) repo_dir: Fd,
    pub(crate) dependency_id: DependencyID,
    pub(crate) name: StringOrTinyString,
    pub(crate) url: StringOrTinyString,
    pub(crate) resolved: StringOrTinyString,
    pub(crate) resolution: Resolution,
    pub(crate) apply_patch_task: Option<Box<PatchTask>>,
}

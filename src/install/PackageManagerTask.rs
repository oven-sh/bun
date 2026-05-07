//! Schedule long-running callbacks for a task
//! Slow stuff is broken into tasks, each can run independently without locks

use core::mem::ManuallyDrop;

use bun_core::Output;
use bun_logger::{self as logger, Loc, Log};
use bun_semver as semver;
use bun_str::strings::StringOrTinyString;
use bun_sys::{Fd, FdDirExt as _, File};
use bun_threading::thread_pool;
use bun_wyhash::Wyhash11;

use crate::npm;
use crate::{
    DependencyID, ExtractData, ExtractTarball, NetworkTask, PackageID, PackageManager, PatchTask,
    Repository, Resolution,
};

// TODO(port): `bun.DotEnv` crate location — guessed `bun_dotenv`
use bun_dotenv as dot_env;

/// File-level struct in Zig (`@This()` == `Task`).
///
/// `'a` is forced by LIFETIMES.tsv (BORROW_PARAM on `Request::*.network`).
/// // TODO(port): lifetime — Task lives in an intrusive cross-thread queue
/// (`next`, `package_manager` BACKREF). A `&'a mut NetworkTask` cannot soundly
/// cross that boundary; Phase B should likely demote to `*mut NetworkTask`.
pub struct Task<'a> {
    pub tag: Tag,
    pub request: Request<'a>,
    pub data: Data,
    /// default: `Status::Waiting`
    pub status: Status,
    /// default: `thread_pool::Task { callback: Task::callback }`
    pub threadpool_task: thread_pool::Task,
    pub log: Log,
    pub id: Id,
    /// default: `None`
    pub err: Option<bun_core::Error>,
    /// BACKREF — owned by `PackageManager.preallocated_resolve_tasks`
    pub package_manager: *const PackageManager,
    /// default: `None`
    pub apply_patch_task: Option<Box<PatchTask<'a>>>,
    /// INTRUSIVE — `bun.UnboundedQueue(Task, .next)`
    /// default: null
    pub next: *mut Task<'a>,
}

/// Zig: struct field defaults (`status = .waiting`, `threadpool_task = .{ .callback = &callback }`,
/// `err = null`, `apply_patch_task = null`, `next = null`) with the remaining fields left
/// `= undefined`. Callers MUST overwrite `tag`, `request`, `id`, `package_manager` before
/// the task is observed. Exposed as a module-level fn so call sites that import this
/// module as `Task` can write `..Task::uninit()` in struct-update position.
#[inline]
pub fn uninit() -> Task<'static> {
    Task {
        // Overwritten by every caller; zero/garbage matches Zig `undefined`.
        // SAFETY: untagged unions of `ManuallyDrop<_>` — any bit pattern is
        // valid storage and is never read before the caller overwrites it.
        tag: Tag::PackageManifest,
        request: unsafe { core::mem::zeroed() },
        data: unsafe { core::mem::zeroed() },
        // Every Zig caller passes `logger.Log.init(allocator)` for this field.
        // `Log` contains `Vec<Msg>` (NonNull invariant) so it cannot be
        // `mem::zeroed()`; and struct-update `..Task::uninit()` *drops* the
        // base value's `log` when the caller supplies their own, so this must
        // be a valid (empty) Log either way.
        log: Log::default(),
        id: Id(0),
        package_manager: core::ptr::null(),
        // Real Zig field defaults:
        status: Status::Waiting,
        threadpool_task: thread_pool::Task {
            node: Default::default(),
            callback: Task::callback,
        },
        err: None,
        apply_patch_task: None,
        next: core::ptr::null_mut(),
    }
}

// SAFETY: `next` is the sole intrusive link and is only ever read/written via
// these accessors by `UnboundedQueue<Task>`. Mirrors Zig's `@field(item, "next")`.
unsafe impl<'a> bun_threading::unbounded_queue::Node for Task<'a> {
    #[inline]
    unsafe fn get_next(item: *mut Self) -> *mut Self {
        unsafe { (*item).next }
    }
    #[inline]
    unsafe fn set_next(item: *mut Self, ptr: *mut Self) {
        unsafe { (*item).next = ptr }
    }
    #[inline]
    unsafe fn atomic_load_next(
        item: *mut Self,
        ordering: core::sync::atomic::Ordering,
    ) -> *mut Self {
        unsafe {
            (*(core::ptr::addr_of!((*item).next) as *const core::sync::atomic::AtomicPtr<Self>))
                .load(ordering)
        }
    }
    #[inline]
    unsafe fn atomic_store_next(
        item: *mut Self,
        ptr: *mut Self,
        ordering: core::sync::atomic::Ordering,
    ) {
        unsafe {
            (*(core::ptr::addr_of!((*item).next) as *const core::sync::atomic::AtomicPtr<Self>))
                .store(ptr, ordering)
        }
    }
}

/// An ID that lets us register a callback without keeping the same pointer around
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Id(u64);

impl core::fmt::Display for Id {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Zig: `enum(u64)` — printed as its raw integer in `{}` debug logs.
        self.0.fmt(f)
    }
}

impl Id {
    #[inline]
    pub fn get(self) -> u64 {
        self.0
    }

    pub fn for_npm_package(package_name: &[u8], package_version: semver::Version) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"npm-package:");
        hasher.update(package_name);
        hasher.update(b"@");
        // SAFETY: reading raw bytes of a POD value for hashing (matches Zig `std.mem.asBytes`)
        hasher.update(unsafe {
            core::slice::from_raw_parts(
                (&package_version as *const semver::Version).cast::<u8>(),
                core::mem::size_of::<semver::Version>(),
            )
        });
        Id(hasher.final_())
    }

    /// PORT NOTE: bridge for `runTasks` callback unification — Zig passes
    /// either a `Task.Id` or a raw `PackageID` to `onPackageDownloadError`
    /// depending on the comptime `Ctx`. Rust models both call sites through
    /// one trait method typed as `Task::Id`, so widen the `PackageID` here.
    #[inline]
    pub fn from_package_id(package_id: PackageID) -> Id {
        Id(package_id as u64)
    }

    pub fn for_bin_link(package_id: PackageID) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"bin-link:");
        // SAFETY: reading raw bytes of a POD value for hashing
        hasher.update(unsafe {
            core::slice::from_raw_parts(
                (&package_id as *const PackageID).cast::<u8>(),
                core::mem::size_of::<PackageID>(),
            )
        });
        Id(hasher.final_())
    }

    pub fn for_manifest(name: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"manifest:");
        hasher.update(name);
        Id(hasher.final_())
    }

    pub fn for_tarball(url: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"tarball:");
        hasher.update(url);
        Id(hasher.final_())
    }

    // These cannot change:
    // We persist them to the filesystem.
    pub fn for_git_clone(url: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(url);
        // @truncate to u61 then widen to u64 — keep low 61 bits
        Id((4u64 << 61) | (hasher.final_() & ((1u64 << 61) - 1)))
    }

    pub fn for_git_checkout(url: &[u8], resolved: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(url);
        hasher.update(b"@");
        hasher.update(resolved);
        Id((5u64 << 61) | (hasher.final_() & ((1u64 << 61) - 1)))
    }
}

impl<'a> Task<'a> {
    pub fn callback(task: *mut thread_pool::Task) {
        Output::Source::configure_thread();

        // SAFETY: `task` points to the `threadpool_task` field of a `Task`
        // (this is the only place this `thread_pool::Task` callback is registered).
        let this: *mut Task<'a> = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(Task, threadpool_task))
                .cast::<Task>()
        };
        // BACKREF (LIFETIMES.tsv:598) — `package_manager` outlives every task it
        // owns. Kept as a raw `*mut` for the whole function: this callback runs
        // on ThreadPool workers concurrently (and concurrently with the main
        // thread), so binding a long-lived `&mut PackageManager` here would be
        // aliased-`&mut` UB. Subfields touched cross-thread (`resolve_tasks`,
        // `wake`) are reached through raw-ptr/shared accessors below; the few
        // callees whose signatures still take `&mut PackageManager`
        // (`get_cache_directory`, `get_package_metadata`) are dereferenced
        // inline at the call boundary only — same race as the Zig spec's
        // freely-aliased `*PackageManager`.
        let manager: *mut PackageManager =
            unsafe { (*this).package_manager as *mut PackageManager };
        // SAFETY: exclusive access — task runs on exactly one worker thread
        let this: &mut Task<'a> = unsafe { &mut *this };

        // Body of the switch; every Zig `return;` becomes `break 'body;` so the
        // trailing `defer` block (patch + push + wake) and `Output.flush()` run
        // unconditionally afterwards.
        'body: {
            match this.tag {
                Tag::PackageManifest => {
                    // SAFETY: tag == PackageManifest discriminates the union
                    let manifest = unsafe { &mut *this.request.package_manifest };

                    // PORT NOTE: split-borrow `manifest.network` so the mutable
                    // `response_buffer` borrow doesn't overlap the immutable
                    // `response`/`callback` reads below.
                    let network = &mut *manifest.network;
                    let body = &mut network.response_buffer;
                    // TODO(port): `defer body.deinit()` — free response_buffer after use

                    let Some(metadata) = &network.response.metadata else {
                        // Handle the case when metadata is null (e.g., network failure before receiving headers)
                        let err = network
                            .response
                            .fail
                            .unwrap_or(bun_core::err!("HTTPError"));
                        this.log
                            .add_error_fmt(
                                None,
                                Loc::EMPTY,
                                format_args!(
                                    "{} downloading package manifest {}",
                                    err.name(),
                                    bstr::BStr::new(manifest.name.slice()),
                                ),
                            )
                            .expect("unreachable");
                        this.err = Some(err);
                        this.status = Status::Fail;
                        this.data = Data {
                            package_manifest: ManuallyDrop::new(npm::PackageManifest::default()),
                        };
                        break 'body;
                    };

                    // PORT NOTE: Zig accessed the bare-union field
                    // `network.callback.package_manifest.*` directly; in Rust
                    // `Callback` is a tagged enum, so destructure the variant.
                    // SAFETY: tag == PackageManifest ⇒ the network task was
                    // built by `NetworkTask::for_manifest` with this variant.
                    let crate::network_task::Callback::PackageManifest {
                        loaded_manifest,
                        is_extended_manifest,
                        ..
                    } = &network.callback
                    else {
                        unsafe { core::hint::unreachable_unchecked() }
                    };
                    let loaded_manifest = loaded_manifest.clone();
                    let is_extended_manifest = *is_extended_manifest;

                    let scope = manager.scope_for_package_name(manifest.name.slice()) as *const _;
                    let package_manifest = match npm::Registry::get_package_metadata(
                        // SAFETY: scope is borrowed from manager.options which is not
                        // touched by get_package_metadata (only the cache-dir fields are).
                        unsafe { &*scope },
                        metadata.response,
                        body.slice(),
                        &mut this.log,
                        manifest.name.slice(),
                        loaded_manifest,
                        manager,
                        is_extended_manifest,
                    ) {
                        Ok(v) => v,
                        Err(err) => {
                            // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent
                            this.err = Some(err);
                            this.status = Status::Fail;
                            this.data = Data {
                                package_manifest: ManuallyDrop::new(
                                    npm::PackageManifest::default(),
                                ),
                            };
                            break 'body;
                        }
                    };

                    // TODO(port): exact enum type for `getPackageMetadata` result
                    match package_manifest {
                        npm::registry::PackageVersionResponse::Fresh(result)
                        | npm::registry::PackageVersionResponse::Cached(result) => {
                            this.status = Status::Success;
                            this.data = Data {
                                package_manifest: ManuallyDrop::new(result),
                            };
                            break 'body;
                        }
                        npm::registry::PackageVersionResponse::NotFound => {
                            this.log
                                .add_error_fmt(
                                    None,
                                    Loc::EMPTY,
                                    format_args!(
                                        "404 - GET {}",
                                        // SAFETY: tag == PackageManifest
                                        bstr::BStr::new(unsafe {
                                            (*this.request.package_manifest).name.slice()
                                        }),
                                    ),
                                )
                                .expect("unreachable");
                            this.status = Status::Fail;
                            this.data = Data {
                                package_manifest: ManuallyDrop::new(
                                    npm::PackageManifest::default(),
                                ),
                            };
                            break 'body;
                        }
                    }
                }
                Tag::Extract => {
                    // Streaming extraction never reaches this callback: the
                    // HTTP thread drives `TarballStream.drain_task`, which
                    // fills in `this.data`/`this.status` and pushes to
                    // `resolve_tasks` directly from `TarballStream.finish()`.
                    // This path is the buffered fallback — feature flag off,
                    // non-2xx status, or the whole body arrived in a single
                    // chunk before streaming could commit.

                    // SAFETY: tag == Extract discriminates the union
                    let extract = unsafe { &mut *this.request.extract };
                    let buffer = &mut extract.network.response_buffer;
                    // TODO(port): `defer buffer.deinit()` — free response_buffer after use

                    let result = match extract.tarball.run(&mut this.log, buffer.slice()) {
                        Ok(v) => v,
                        Err(err) => {
                            // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent
                            this.err = Some(err);
                            this.status = Status::Fail;
                            this.data = Data {
                                extract: ManuallyDrop::new(ExtractData::default()),
                            };
                            break 'body;
                        }
                    };

                    this.data = Data {
                        extract: ManuallyDrop::new(result),
                    };
                    this.status = Status::Success;
                }
                Tag::GitClone => {
                    // SAFETY: tag == GitClone discriminates the union
                    let req = unsafe { &mut *this.request.git_clone };
                    let name = req.name.slice();
                    let url = req.url.slice();
                    let mut attempt: u8 = 1;

                    let dir = 'brk: {
                        if let Some(https) = Repository::try_https(url) {
                            match Repository::download(
                                req.env,
                                &mut this.log,
                                manager.get_cache_directory(),
                                this.id,
                                name,
                                https,
                                attempt,
                            ) {
                                Ok(d) => break 'brk Some(d),
                                Err(err) => {
                                    // Exit early if git checked and could
                                    // not find the repository, skip ssh
                                    if err == bun_core::err!("RepositoryNotFound") {
                                        this.err = Some(err);
                                        this.status = Status::Fail;
                                        this.data = Data {
                                            git_clone: ManuallyDrop::new(Fd::invalid()),
                                        };
                                        break 'body;
                                    }

                                    this.err = Some(err);
                                    this.status = Status::Fail;
                                    this.data = Data {
                                        git_clone: ManuallyDrop::new(Fd::invalid()),
                                    };
                                    attempt += 1;
                                    break 'brk None;
                                }
                            }
                        }
                        None
                    };

                    let dir = match dir {
                        Some(d) => d,
                        None => {
                            if let Some(ssh) = Repository::try_ssh(url) {
                                match Repository::download(
                                    req.env,
                                    &mut this.log,
                                    manager.get_cache_directory(),
                                    this.id,
                                    name,
                                    ssh,
                                    attempt,
                                ) {
                                    Ok(d) => d,
                                    Err(err) => {
                                        this.err = Some(err);
                                        this.status = Status::Fail;
                                        this.data = Data {
                                            git_clone: ManuallyDrop::new(Fd::invalid()),
                                        };
                                        break 'body;
                                    }
                                }
                            } else {
                                break 'body;
                            }
                        }
                    };

                    this.err = None;
                    this.data = Data {
                        git_clone: ManuallyDrop::new(Fd::from_std_dir(&dir)),
                    };
                    this.status = Status::Success;
                }
                Tag::GitCheckout => {
                    // SAFETY: tag == GitCheckout discriminates the union
                    let git_checkout = unsafe { &mut *this.request.git_checkout };
                    let data = match Repository::checkout(
                        git_checkout.env,
                        &mut this.log,
                        manager.get_cache_directory(),
                        bun_sys::Dir::from_fd(git_checkout.repo_dir),
                        git_checkout.name.slice(),
                        git_checkout.url.slice(),
                        git_checkout.resolved.slice(),
                    ) {
                        Ok(v) => v,
                        Err(err) => {
                            this.err = Some(err);
                            this.status = Status::Fail;
                            this.data = Data {
                                git_checkout: ManuallyDrop::new(ExtractData::default()),
                            };
                            break 'body;
                        }
                    };

                    this.data = Data {
                        git_checkout: ManuallyDrop::new(data),
                    };
                    this.status = Status::Success;
                }
                Tag::LocalTarball => {
                    // `tarball_path` and `normalize` are computed on the main thread when the
                    // task is enqueued. This callback runs on a ThreadPool worker and must not
                    // read `manager.lockfile.packages` / `manager.lockfile.buffers.string_bytes`:
                    // the main thread may reallocate those buffers concurrently while processing
                    // other dependencies.

                    // SAFETY: tag == LocalTarball discriminates the union
                    let req = unsafe { &mut *this.request.local_tarball };
                    let tarball_path = req.tarball_path.slice();
                    let normalize = req.normalize;

                    let result = match read_and_extract(
                        &req.tarball,
                        tarball_path,
                        normalize,
                        &mut this.log,
                    ) {
                        Ok(v) => v,
                        Err(err) => {
                            // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent
                            this.err = Some(err);
                            this.status = Status::Fail;
                            this.data = Data {
                                extract: ManuallyDrop::new(ExtractData::default()),
                            };
                            break 'body;
                        }
                    };

                    this.data = Data {
                        extract: ManuallyDrop::new(result),
                    };
                    this.status = Status::Success;
                }
            }
        }

        // Zig `defer` block (lines 77-91) — runs after switch on all paths.
        if this.status == Status::Success {
            if let Some(mut pt) = this.apply_patch_task.take() {
                // `defer pt.deinit()` → Box<PatchTask> drops at end of this block
                pt.apply().expect("OOM"); // bun.handleOom → panic on OOM
                // PORT NOTE: Zig accessed bare-union field `pt.callback.apply`;
                // `apply_patch_task` is only ever populated with the Apply
                // variant (see `new_apply_patch_hash`), so destructure it.
                let crate::patch_install::Callback::Apply(apply) = &mut pt.callback else {
                    unsafe { core::hint::unreachable_unchecked() }
                };
                if apply.logger.errors > 0 {
                    // `defer pt.callback.apply.logger.deinit()` → `Log` drops with `pt`.
                    // this.log.addErrorFmt(null, logger.Loc.Empty, bun.default_allocator, "failed to apply patch: {}", .{e}) catch unreachable;
                    let _ = apply.logger.print(Output::error_writer() as *mut _);
                }
            }
        }
        // SAFETY: `Task<'a>` is layout-identical for all `'a` (the lifetime is
        // a phantom on `&mut NetworkTask` borrows that the queue never reads
        // through); erasing to `'static` matches Zig's lifetime-less queue.
        manager
            .resolve_tasks
            .push(this as *mut Task<'a> as *mut Task<'static>);
        manager.wake();

        // Zig `defer Output.flush()` — outermost defer, runs last.
        Output::flush();
    }
}

fn read_and_extract(
    tarball: &ExtractTarball,
    tarball_path: &[u8],
    normalize: bool,
    log: &mut Log,
) -> Result<ExtractData, bun_core::Error> {
    // TODO(port): narrow error set
    let bytes = if normalize {
        // TODO(port): `std.fs.cwd()` vs `bun.FD.cwd()` — both map to `Fd::cwd()` here;
        // `read_from_user_input` resolves user-provided relative paths against
        // `top_level_dir` (= cwd at this tier).
        // Zig `try X.unwrap()` on Maybe(T) → plain `?` on bun_sys::Result<T>.
        File::read_from_user_input(Fd::cwd(), b".", tarball_path)?
    } else {
        File::read_from(Fd::cwd(), tarball_path)?
    };
    // `defer allocator.free(bytes)` → Vec<u8> drops at scope exit
    tarball.run(log, &bytes)
}

// Zig: `enum(u3)` — Rust has no u3, use u8.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tag {
    PackageManifest = 0,
    Extract = 1,
    GitClone = 2,
    GitCheckout = 3,
    LocalTarball = 4,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Waiting,
    Success,
    Fail,
}

/// Bare Zig `union` (untagged). Discriminated externally by `Task.tag`.
/// // TODO(port): Phase B — consider folding `Tag` + `Request` + `Data` into a
/// single Rust `enum` (one discriminant instead of tag + 2 untagged unions).
pub union Data {
    pub package_manifest: ManuallyDrop<npm::PackageManifest>,
    pub extract: ManuallyDrop<ExtractData>,
    pub git_clone: ManuallyDrop<Fd>,
    pub git_checkout: ManuallyDrop<ExtractData>,
}

/// Bare Zig `union` (untagged). Discriminated externally by `Task.tag`.
pub union Request<'a> {
    /// package name
    // todo: Registry URL
    pub package_manifest: ManuallyDrop<PackageManifestRequest<'a>>,
    pub extract: ManuallyDrop<ExtractRequest<'a>>,
    pub git_clone: ManuallyDrop<GitCloneRequest>,
    pub git_checkout: ManuallyDrop<GitCheckoutRequest>,
    pub local_tarball: ManuallyDrop<LocalTarballRequest>,
}

pub struct PackageManifestRequest<'a> {
    pub name: StringOrTinyString,
    // BORROW_PARAM per LIFETIMES.tsv
    // TODO(port): lifetime — see note on `Task<'a>`; likely `*mut NetworkTask` in Phase B.
    pub network: &'a mut NetworkTask,
}

pub struct ExtractRequest<'a> {
    // BORROW_PARAM per LIFETIMES.tsv
    // TODO(port): lifetime — see note on `Task<'a>`; likely `*mut NetworkTask` in Phase B.
    pub network: &'a mut NetworkTask,
    pub tarball: ExtractTarball,
}

pub struct GitCloneRequest {
    pub name: StringOrTinyString,
    pub url: StringOrTinyString,
    // PORT NOTE: Zig stores `DotEnv.Map` by value (handle copy of the global
    // `Repository.shared_env`). Rust's `Map` owns its storage; store a
    // `&'static` into the global instead — see `SharedEnv::get`.
    pub env: &'static dot_env::Map,
    pub dep_id: DependencyID,
    pub res: Resolution,
}

pub struct GitCheckoutRequest {
    pub repo_dir: Fd,
    pub dependency_id: DependencyID,
    pub name: StringOrTinyString,
    pub url: StringOrTinyString,
    pub resolved: StringOrTinyString,
    pub resolution: Resolution,
    // See PORT NOTE on `GitCloneRequest.env`.
    pub env: &'static dot_env::Map,
}

pub struct LocalTarballRequest {
    pub tarball: ExtractTarball,
    /// Path to read the tarball from. May be the same as `tarball.url` (when
    /// `normalize` is true) or an absolute path joined with a workspace
    /// directory. Computed on the main thread in `enqueueLocalTarball` because
    /// resolving it requires reading `lockfile.packages` / `string_bytes`,
    /// which can be reallocated concurrently by the main thread while this
    /// task runs on a ThreadPool worker.
    pub tarball_path: StringOrTinyString,
    /// When true, `tarball_path` is a user-provided path resolved relative to
    /// cwd. When false, it is already an absolute path.
    pub normalize: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManagerTask.zig (385 lines)
//   confidence: medium
//   todos:      14
//   notes:      bare Zig unions kept as Rust `union` + ManuallyDrop; BORROW_PARAM `&'a mut NetworkTask` per TSV is unsound across intrusive queue — Phase B should use *mut; defer-reshaped via labeled 'body block
// ──────────────────────────────────────────────────────────────────────────

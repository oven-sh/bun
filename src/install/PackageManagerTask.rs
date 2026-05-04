//! Schedule long-running callbacks for a task
//! Slow stuff is broken into tasks, each can run independently without locks

use core::mem::ManuallyDrop;

use bun_core::Output;
use bun_logger::{self as logger, Loc, Log};
use bun_semver as semver;
use bun_str::strings::StringOrTinyString;
use bun_sys::{Fd, File};
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
    pub apply_patch_task: Option<Box<PatchTask>>,
    /// INTRUSIVE — `bun.UnboundedQueue(Task, .next)`
    /// default: null
    pub next: *mut Task<'a>,
}

/// An ID that lets us register a callback without keeping the same pointer around
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Id(u64);

impl Id {
    #[inline]
    pub fn get(self) -> u64 {
        self.0
    }

    pub fn for_npm_package(package_name: &[u8], package_version: &semver::Version) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"npm-package:");
        hasher.update(package_name);
        hasher.update(b"@");
        // SAFETY: reading raw bytes of a POD value for hashing (matches Zig `std.mem.asBytes`)
        hasher.update(unsafe {
            core::slice::from_raw_parts(
                (package_version as *const semver::Version).cast::<u8>(),
                core::mem::size_of::<semver::Version>(),
            )
        });
        Id(hasher.r#final())
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
        Id(hasher.r#final())
    }

    pub fn for_manifest(name: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"manifest:");
        hasher.update(name);
        Id(hasher.r#final())
    }

    pub fn for_tarball(url: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"tarball:");
        hasher.update(url);
        Id(hasher.r#final())
    }

    // These cannot change:
    // We persist them to the filesystem.
    pub fn for_git_clone(url: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(url);
        // @truncate to u61 then widen to u64 — keep low 61 bits
        Id((4u64 << 61) | (hasher.r#final() & ((1u64 << 61) - 1)))
    }

    pub fn for_git_checkout(url: &[u8], resolved: &[u8]) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(url);
        hasher.update(b"@");
        hasher.update(resolved);
        Id((5u64 << 61) | (hasher.r#final() & ((1u64 << 61) - 1)))
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
        // SAFETY: BACKREF — package_manager outlives all tasks it owns
        let manager: &PackageManager = unsafe { &*(*this).package_manager };
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

                    let body = &mut manifest.network.response_buffer;
                    // TODO(port): `defer body.deinit()` — free response_buffer after use

                    let Some(metadata) = &manifest.network.response.metadata else {
                        // Handle the case when metadata is null (e.g., network failure before receiving headers)
                        let err = manifest
                            .network
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

                    let package_manifest = match npm::Registry::get_package_metadata(
                        manager.scope_for_package_name(manifest.name.slice()),
                        &metadata.response,
                        body.slice(),
                        &mut this.log,
                        manifest.name.slice(),
                        &manifest.network.callback.package_manifest.loaded_manifest,
                        manager,
                        manifest.network.callback.package_manifest.is_extended_manifest,
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
                                &req.env,
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
                                    &req.env,
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
                        git_clone: ManuallyDrop::new(Fd::from_std_dir(dir)),
                    };
                    this.status = Status::Success;
                }
                Tag::GitCheckout => {
                    // SAFETY: tag == GitCheckout discriminates the union
                    let git_checkout = unsafe { &mut *this.request.git_checkout };
                    let data = match Repository::checkout(
                        &git_checkout.env,
                        &mut this.log,
                        manager.get_cache_directory(),
                        git_checkout.repo_dir.std_dir(),
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
                pt.apply(); // bun.handleOom dropped — Rust aborts on OOM
                if pt.callback.apply.logger.errors > 0 {
                    // TODO(port): `defer pt.callback.apply.logger.deinit()`
                    // this.log.addErrorFmt(null, logger.Loc.Empty, bun.default_allocator, "failed to apply patch: {}", .{e}) catch unreachable;
                    let _ = pt.callback.apply.logger.print(Output::error_writer());
                }
            }
        }
        manager.resolve_tasks.push(this);
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
        // `read_from_user_input` resolves user-provided relative paths.
        // Zig `try X.unwrap()` on Maybe(T) → plain `?` on bun_sys::Result<T>.
        File::read_from_user_input(Fd::cwd(), tarball_path)?
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
    pub env: dot_env::Map,
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
    pub env: dot_env::Map,
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

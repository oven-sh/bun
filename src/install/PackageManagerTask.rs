//! Schedule long-running callbacks for a task
//! Slow stuff is broken into tasks, each can run independently without locks

use core::mem::ManuallyDrop;

use bun_ast::{Loc, Log};
use bun_core::Output;
use bun_core::StringOrTinyString;
use bun_semver as semver;
use bun_sys::{Fd, File};
use bun_threading::thread_pool;
use bun_wyhash::Wyhash11;

use crate::npm;
use crate::{
    DependencyID, ExtractData, ExtractTarball, NetworkTask, PackageID, PackageManager, PatchTask,
    Repository, RepositoryExt as _, Resolution,
};

use bun_dotenv as dot_env;

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
    /// BACKREF — owned by `PackageManager.preallocated_resolve_tasks`.
    /// `None` only in `uninit()`; every scheduled task overwrites it.
    pub package_manager: Option<bun_ptr::ParentRef<PackageManager>>,
    /// default: `None`
    pub apply_patch_task: Option<Box<PatchTask>>,
    /// INTRUSIVE — `bun.UnboundedQueue(Task, .next)`
    /// default: null
    pub next: bun_threading::Link<Task<'a>>,
}

#[inline]
pub(crate) fn uninit() -> Task<'static> {
    Task {
        // Overwritten by every caller; zero/garbage matches Zig `undefined`.
        tag: Tag::PackageManifest,
        // SAFETY: untagged unions of `ManuallyDrop<_>` — any bit pattern is
        // valid storage and is never read before the caller overwrites it.
        request: unsafe { bun_core::ffi::zeroed_unchecked() },
        // SAFETY: untagged unions of `ManuallyDrop<_>` — any bit pattern is
        // valid storage and is never read before the caller overwrites it.
        data: unsafe { bun_core::ffi::zeroed_unchecked() },
        log: Log::default(),
        id: Id(0),
        package_manager: None,
        // Real Zig field defaults:
        status: Status::Waiting,
        threadpool_task: thread_pool::Task {
            node: Default::default(),
            callback: Task::callback,
        },
        err: None,
        apply_patch_task: None,
        next: bun_threading::Link::new(),
    }
}

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue<Task>`;
// `link()` always projects to it. Mirrors Zig's `@field(item, "next")`.
unsafe impl<'a> bun_threading::Linked for Task<'a> {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
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
            bun_core::ffi::slice(
                (&raw const package_version).cast::<u8>(),
                core::mem::size_of::<semver::Version>(),
            )
        });
        Id(hasher.final_())
    }

    pub fn for_bin_link(package_id: PackageID) -> Id {
        let mut hasher = Wyhash11::init(0);
        hasher.update(b"bin-link:");
        // `PackageID` is `u32`: `bytemuck::bytes_of` gives the same
        // native-endian byte view as Zig `std.mem.asBytes`.
        hasher.update(bytemuck::bytes_of(&package_id));
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
    bun_core::extern_union_accessors! {
        tag: tag as Tag, value: request;
        PackageManifest => request_package_manifest @ package_manifest: PackageManifestRequest<'a>, mut request_package_manifest_mut;
        Extract         => request_extract          @ extract:          ExtractRequest<'a>,         mut request_extract_mut;
        GitClone        => request_git_clone        @ git_clone:        GitCloneRequest,            mut request_git_clone_mut;
        GitCheckout     => request_git_checkout     @ git_checkout:     GitCheckoutRequest,         mut request_git_checkout_mut;
        LocalTarball    => request_local_tarball    @ local_tarball:    LocalTarballRequest,        mut request_local_tarball_mut;
    }

    bun_core::extern_union_accessors! {
        tag: tag as Tag, value: data;
        GitCheckout     => data_git_checkout     @ git_checkout:     ExtractData, mut data_git_checkout_mut;
    }

    // ── Data projectors (multi-tag / by-value — kept hand-written) ─────────
    // `Tag::LocalTarball` writes its result into `data.extract` (same payload
    // type as `Tag::Extract`), so `data_extract*` accepts both tags.
    #[inline]
    pub fn data_extract(&self) -> &ExtractData {
        debug_assert!(self.tag == Tag::Extract || self.tag == Tag::LocalTarball);
        // SAFETY: tag-guarded; `ManuallyDrop` deref.
        unsafe { &*self.data.extract }
    }
    #[inline]
    pub fn data_extract_mut(&mut self) -> &mut ExtractData {
        debug_assert!(self.tag == Tag::Extract || self.tag == Tag::LocalTarball);
        // SAFETY: tag-guarded; `&mut self` exclusive.
        unsafe { &mut *self.data.extract }
    }
    #[inline]
    pub fn data_git_clone(&self) -> Fd {
        debug_assert!(self.tag == Tag::GitClone);
        // SAFETY: tag-guarded; `Fd` is `Copy`.
        unsafe { *self.data.git_clone }
    }

    pub fn deinit_payload(&mut self) {
        // SAFETY: `tag` discriminates both unions, set once at enqueue.
        unsafe {
            match self.tag {
                Tag::PackageManifest => {
                    ManuallyDrop::drop(&mut self.request.package_manifest);
                    ManuallyDrop::drop(&mut self.data.package_manifest);
                }
                Tag::Extract => {
                    ManuallyDrop::drop(&mut self.request.extract);
                    ManuallyDrop::drop(&mut self.data.extract);
                }
                Tag::GitClone => {
                    ManuallyDrop::drop(&mut self.request.git_clone);
                }
                Tag::GitCheckout => {
                    ManuallyDrop::drop(&mut self.request.git_checkout);
                    ManuallyDrop::drop(&mut self.data.git_checkout);
                }
                Tag::LocalTarball => {
                    ManuallyDrop::drop(&mut self.request.local_tarball);
                    ManuallyDrop::drop(&mut self.data.extract);
                }
            }
        }
    }
}

impl<'a> Task<'a> {
    pub unsafe fn callback(task: *mut thread_pool::Task) {
        Output::Source::configure_thread();

        // SAFETY: `task` points to the `threadpool_task` field of a `Task`
        // (this is the only place this `thread_pool::Task` callback is registered).
        let this: *mut Task<'a> = unsafe { bun_core::from_field_ptr!(Task, threadpool_task, task) };
        // SAFETY: exclusive access — task runs on exactly one worker thread
        let this: &mut Task<'a> = unsafe { &mut *this };
        let manager_ref = this.package_manager.expect("Task.package_manager unset");
        let manager: *mut PackageManager = manager_ref.as_mut_ptr();

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
                    // Zig: `defer body.deinit()` — take ownership so the
                    // multi-MB manifest buffer drops on every exit of this arm
                    // instead of staying live on the NetworkTask until recycle.
                    let mut body = core::mem::take(&mut network.response_buffer);

                    let Some(metadata) = &network.response.metadata else {
                        // Handle the case when metadata is null (e.g., network failure before receiving headers)
                        let err = network
                            .response
                            .fail
                            .unwrap_or_else(|| bun_core::err!("HTTPError"));
                        this.log.add_error_fmt(
                            None,
                            Loc::EMPTY,
                            format_args!(
                                "{} downloading package manifest {}",
                                err.name(),
                                bstr::BStr::new(manifest.name.slice()),
                            ),
                        );
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
                        // SAFETY: tag == PackageManifest ⇒ the network task was
                        // built by `NetworkTask::for_manifest` with this variant.
                        unsafe { core::hint::unreachable_unchecked() }
                    };
                    let loaded_manifest = loaded_manifest.clone();
                    let is_extended_manifest = *is_extended_manifest;

                    let scope = bun_ptr::BackRef::new(
                        manager_ref.scope_for_package_name(manifest.name.slice()),
                    );
                    let package_manifest = match npm::Registry::get_package_metadata(
                        // scope is borrowed from manager.options which is not
                        // touched by get_package_metadata (only the cache-dir fields are).
                        scope.get(),
                        metadata.response,
                        body.slice(),
                        &mut this.log,
                        manifest.name.slice(),
                        loaded_manifest,
                        // SAFETY: see `manager` decl — short-lived `&mut` at call
                        // boundary only (callee touches `cache_directory_` /
                        // `temporary_directory` lazily; same race as Zig spec).
                        unsafe { &mut *manager },
                        is_extended_manifest,
                    ) {
                        Ok(v) => v,
                        Err(err) => {
                            // bun.handleErrorReturnTrace — debug-only Zig diagnostics; no-op in Rust.
                            this.err = Some(err);
                            this.status = Status::Fail;
                            this.data = Data {
                                package_manifest: ManuallyDrop::new(npm::PackageManifest::default()),
                            };
                            break 'body;
                        }
                    };

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
                            this.log.add_error_fmt(
                                None,
                                Loc::EMPTY,
                                format_args!(
                                    "404 - GET {}",
                                    // `manifest` (split-borrow of
                                    // `this.request`) is still live; reuse
                                    // it instead of a fresh union deref.
                                    bstr::BStr::new(manifest.name.slice()),
                                ),
                            );
                            this.status = Status::Fail;
                            this.data = Data {
                                package_manifest: ManuallyDrop::new(npm::PackageManifest::default()),
                            };
                            break 'body;
                        }
                    }
                }
                Tag::Extract => {
                    // SAFETY: tag == Extract discriminates the union
                    let extract = unsafe { &mut *this.request.extract };
                    // Zig: `defer buffer.deinit()` — take ownership so the
                    // tarball body drops on every exit of this arm.
                    let mut buffer = core::mem::take(&mut extract.network.response_buffer);

                    let result = match extract.tarball.run(&mut this.log, buffer.slice()) {
                        Ok(v) => v,
                        Err(err) => {
                            // bun.handleErrorReturnTrace — debug-only Zig diagnostics; no-op in Rust.
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
                                // SAFETY: see `manager` decl — short-lived `&mut` at call boundary.
                                unsafe { &mut *manager }.get_cache_directory(),
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
                                    // SAFETY: see `manager` decl — short-lived `&mut` at call boundary.
                                    unsafe { &mut *manager }.get_cache_directory(),
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
                        git_clone: ManuallyDrop::new(dir.into_raw()),
                    };
                    this.status = Status::Success;
                }
                Tag::GitCheckout => {
                    // SAFETY: tag == GitCheckout discriminates the union
                    let git_checkout = unsafe { &mut *this.request.git_checkout };
                    let data = match Repository::checkout(
                        git_checkout.env,
                        &mut this.log,
                        // SAFETY: see `manager` decl — short-lived `&mut` at call boundary.
                        unsafe { &mut *manager }.get_cache_directory(),
                        git_checkout.repo_dir,
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
                            // bun.handleErrorReturnTrace — debug-only Zig diagnostics; no-op in Rust.
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
                    // SAFETY: `apply_patch_task` is only ever populated with the
                    // Apply variant (see `new_apply_patch_hash`).
                    unsafe { core::hint::unreachable_unchecked() }
                };
                if apply.logger.errors > 0 {
                    // `defer pt.callback.apply.logger.deinit()` → `Log` drops with `pt`.
                    // this.log.addErrorFmt(null, logger.Loc.Empty, bun.default_allocator, "failed to apply patch: {}", .{e}) catch unreachable;
                    let _ = apply
                        .logger
                        .print(std::ptr::from_mut(Output::error_writer()));
                }
            }
        }
        let task = core::ptr::NonNull::from(this).cast::<Task<'static>>();
        // SAFETY: `Task<'a>` is layout-identical for all `'a` (the lifetime is
        // a phantom on `&mut NetworkTask` borrows that the queue never reads
        // through); erasing to `'static` matches Zig's lifetime-less queue.
        // `UnboundedQueue::push` takes `&self` (lock-free), so reach it via a
        // shared raw deref — no `&mut PackageManager` is formed.
        unsafe {
            (*core::ptr::addr_of!((*manager).resolve_tasks)).push(task);
            PackageManager::wake_raw(manager);
        }

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
        File::read_from_user_input(
            Fd::cwd(),
            crate::bun_fs::FileSystem::instance().top_level_dir(),
            tarball_path,
        )?
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
    pub tarball_path: StringOrTinyString,
    /// When true, `tarball_path` is a user-provided path resolved relative to
    /// cwd. When false, it is already an absolute path.
    pub normalize: bool,
}

// ported from: src/install/PackageManagerTask.zig

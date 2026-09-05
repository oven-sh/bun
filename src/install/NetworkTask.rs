use core::mem::MaybeUninit;
use core::ptr::{self, NonNull};
use core::sync::atomic::Ordering;

use crate::bun_fs::{FileSystem, FilenameStore};
use bun_collections::HashMap;
use bun_core::{self, fmt::quote};
use bun_core::{MutableString, strings};
use bun_http::{
    self as http, AsyncHTTP, HTTPClientResult, HTTPClientResultCallback, HTTPVerboseLevel,
    HeaderBuilder, async_http::Options as AsyncHTTPOptions,
};
use bun_threading::thread_pool::Batch;
use bun_url::URL;

use crate::extract_tarball;
use crate::npm::{self as npm, PackageManifest};
use crate::{ExtractTarball, PackageManager, PatchTask, TarballStream, Task};

// Adapter so `StringOrTinyString::init_append_if_needed` can intern overflow
// names into the resolver's filename arena. The bun_sys-level `FilenameStore` exposes `append` /
// `append_lower_case` but doesn't itself implement `strings::Appender` (that
// impl lives in `bun_resolver`, which this crate can't reach without a cycle).
pub struct FilenameStoreAppender<'a>(pub(crate) &'a FilenameStore);
impl strings::Appender for FilenameStoreAppender<'_> {
    fn append(&mut self, s: &[u8]) -> Result<&[u8], bun_alloc::AllocError> {
        self.0.append(s)
    }
    fn append_lower_case(&mut self, s: &[u8]) -> Result<&[u8], bun_alloc::AllocError> {
        self.0.append_lower_case(s)
    }
}

/// Convenience: returns an `Appender` over the global filename store.
#[inline]
pub(crate) fn filename_store_appender() -> FilenameStoreAppender<'static> {
    FilenameStoreAppender(FileSystem::instance().filename_store())
}

pub struct NetworkTask {
    // Self-referential: borrows `url_buf` / `header_buf` owned by
    // sibling fields, so the lifetime is erased to `'static`.
    // `MaybeUninit` because the slot comes from `HiveArrayFallback`
    // as *uninitialized* memory (often zero-page on first mmap, but not
    // guaranteed — `claim()`'s heap fallback is `Box::new_uninit()`) and is
    // overwritten by plain `=` in `for_manifest`/`for_tarball`.
    // `MaybeUninit<T>` is the spec-correct mapping for that semantic — unlike
    // `ManuallyDrop<T>`, it suppresses `T`'s validity invariant, so
    // materializing `&mut NetworkTask` after `write_init` (which leaves this
    // field bitwise-untouched) is sound even though `AsyncHTTP` contains
    // niche-bearing fields (`Decompressor` enum, `Option<NonNull>`). The
    // HTTP-thread bitwise copy in `notify`
    // (`ptr::write(real, ptr::read(async_http))`) targets the inner `AsyncHTTP`
    // directly via `*mut AsyncHTTP`, which is sound because `MaybeUninit<T>`
    // is `#[repr(transparent)]`.
    pub(crate) unsafe_http_client: MaybeUninit<AsyncHTTP<'static>>,
    pub(crate) response: HTTPClientResult<'static>,
    pub(crate) task_id: crate::package_manager_task::Id,
    // Owned in both `for_manifest` (toOwnedSlice) and `for_tarball`. Aliasing
    // `tarball.url` in the latter would be a self-reference
    // into `callback`; owning avoids that at the cost of one copy per tarball download.
    pub(crate) url_buf: Box<[u8]>,
    pub(crate) header_buf: Box<[u8]>,
    pub(crate) retried: u16,
    pub(crate) response_buffer: MutableString,
    // BACKREF: PackageManager owns this task via `preallocated_network_tasks`.
    // ParentRef constructed via `from_raw_mut` so `assume_mut` retains write
    // provenance for `for_manifest`/`for_tarball` (which call `pm.log_mut()`).
    pub(crate) package_manager: bun_ptr::ParentRef<PackageManager, bun_ptr::Mut>,
    pub(crate) callback: Callback,
    /// Key in patchedDependencies in package.json
    // `'static` because NetworkTask is stored lifetime-less in
    // `PreallocatedNetworkTasks`; PatchTask's `'a` is a BACKREF on
    pub(crate) apply_patch_task: Option<Box<PatchTask>>,
    pub(crate) next: bun_threading::Link<NetworkTask>,

    /// Producer/consumer buffer that feeds tarball bytes from the HTTP thread
    /// to a worker running libarchive. `None` when streaming extraction is
    /// disabled or this task is not a tarball download.
    pub(crate) tarball_stream: Option<Box<TarballStream>>,
    /// Extract `Task` pre-created on the main thread so the HTTP thread can
    /// schedule it on the worker pool as soon as the first body chunk arrives.
    // `'static` matches `PreallocatedTaskStore =
    // HiveArrayFallback<Task<'static>, 64>` which this slot is borrowed from
    // and returned to (`discard_unused_streaming_state`).
    pub(crate) streaming_extract_task: *mut Task<'static>,
    /// Set by the HTTP thread the first time it commits this request to
    /// the streaming path. Once true, `notify` never pushes this task to
    /// `async_network_task_queue` — the extract Task published by
    /// `TarballStream.finish()` owns the NetworkTask's lifetime instead
    /// (its `resolve_tasks` handler returns it to the pool). Also read by
    /// the main-thread fallback / retry paths in `run_tasks` to assert
    /// the stream was never started.
    pub(crate) streaming_committed: bool,
    /// Backing store for the streaming signal the HTTP client polls.
    pub(crate) signal_store: http::signals::Store,
}

// SAFETY: `next` is the sole intrusive link and is only ever read/written via
// these accessors by `UnboundedQueue<NetworkTask>`.
unsafe impl bun_threading::Linked for NetworkTask {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

/// The network-backed subset of `crate::package_manager_task::Tag` (git
/// clone/checkout run as thread-pool tasks, never as network tasks).
pub enum Callback {
    PackageManifest {
        loaded_manifest: Option<PackageManifest>,
        name: strings::StringOrTinyString,
        is_extended_manifest: bool,
    },
    Extract(ExtractTarball),
    LocalTarball,
}

#[derive(Default, Clone, Copy)]
pub struct DedupeMapEntry {
    pub(crate) is_required: bool,
    /// Set once the download/extract for this task id has terminally failed so a
    /// later `enqueue_*_for_download` can observe the failure instead of
    /// re-scheduling the entire network task (and its retry cycle) a second time.
    pub(crate) failed: bool,
}
/// `Id` is already a wyhash output, so identity hashing
/// (hash = value bits) avoids re-hashing.
impl bun_collections::IdentityHash for crate::package_manager_task::Id {
    #[inline]
    fn identity_hash(self) -> u64 {
        self.get()
    }
}

// `bun_collections::HashMap` uses the same 80% max load factor for all maps.
pub(crate) type DedupeMap = HashMap<
    crate::package_manager_task::Id,
    DedupeMapEntry,
    bun_collections::IdentityContext<crate::package_manager_task::Id>,
>;

impl NetworkTask {
    /// Access the HTTP client after `for_manifest`/`for_tarball` (or `notify`'s
    /// bitwise copy) has initialized it. The field is `MaybeUninit` only to keep
    /// `&mut NetworkTask` sound between `write_init` and the `for_*` overwrite.
    #[inline]
    pub(crate) fn http_mut(&mut self) -> &mut AsyncHTTP<'static> {
        // SAFETY: every caller is reached only after `unsafe_http_client` was
        // populated via `MaybeUninit::new(AsyncHTTP::init(..))` (or the
        // `ptr::write(real, ..)` in `notify`).
        unsafe { self.unsafe_http_client.assume_init_mut() }
    }

    /// BACKREF accessor — single `unsafe` deref for the set-once
    /// `package_manager` `ParentRef` so `for_manifest`/`for_tarball` call
    /// sites are safe. Lifetime is decoupled from `&self` (the manager is the
    /// process singleton that owns this task and outlives it).
    ///
    /// # Safety (encapsulated)
    /// `package_manager` is constructed via `ParentRef::from_raw_mut` (write
    /// provenance) in `write_init`; the `for_*` builders run on the
    /// single-threaded main setup path, so no overlapping `&mut
    /// PackageManager` exists for the returned borrow.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn pm_mut<'a>(&self) -> &'a mut PackageManager {
        // SAFETY: see fn doc — BACKREF, write provenance, single-threaded.
        unsafe { self.package_manager.assume_mut() }
    }

    // Signature matches `HTTPClientResultCallback::new::<NetworkTask>`'s
    // `fn(*mut T, *mut AsyncHTTP, HTTPClientResult<'_>)` shape so it can be
    // installed directly without a separate trampoline.
    fn notify(
        this: *mut NetworkTask,
        async_http: *mut AsyncHTTP<'static>,
        mut result: HTTPClientResult<'_>,
    ) {
        // `this` is the NetworkTask erased into the callback ctx in
        // `get_completion_callback`; the HTTP thread is the sole writer for
        // this call. It stays a raw receiver: both exits below (`on_chunk(..,
        // true, ..)` and the queue push) hand `this` to another thread, so no
        // `&mut NetworkTask` may outlive them and every pointer handed off is
        // derived from the raw `this`.
        //
        // SAFETY: `async_http` is the threadlocal AsyncHTTP the HTTP client
        // passes to every completion callback; live for this call.
        let async_http = unsafe { &mut *async_http };
        // SAFETY: `this` is live (see above). `on_chunk` takes `*mut Self`
        // (freely-aliasing) because a worker may be inside `drain()`
        // concurrently, so `stream` is a raw pointer, never `&mut TarballStream`.
        // SAFETY: `this` is live and non-null (raw receiver from the completion callback).
        let stream =
            unsafe { (*this).tarball_stream.as_deref_mut() }.map(ptr::from_mut::<TarballStream>);
        if let Some(stream) = stream {
            // Runs on the HTTP thread. With response-body streaming enabled,
            // `notify` is called once per body chunk (has_more=true) and once
            // more at the end (has_more=false). `result.body` borrows the
            // HTTP client's scratch buffer and is cleared after this callback
            // returns, so we must consume it before returning.

            // `metadata` is only populated on the first callback that
            // carries response headers. Cache the status code so both the
            // main thread and later chunk callbacks can see it.
            if let Some(m) = result.metadata.take() {
                // SAFETY: `stream` is the live heap-allocated `TarballStream`.
                unsafe {
                    (*stream).status_code = m.response.status_code;
                    if let http::BodySize::ContentLength(len) = result.body_size {
                        (*stream).content_length = Some(len);
                    }
                }
                // New attempt's headers arrived — drop any bytes buffered from
                // a prior failed attempt (pre-refactor `HTTPClient::start()`
                // did this via `body_out_str.reset()`).
                // SAFETY: `this` is live; the HTTP thread is its sole writer here.
                unsafe {
                    (*this).response.metadata = Some(m);
                    (*this).response_buffer.reset();
                }
            }

            let chunk = result.body_bytes();

            // Only commit to streaming extraction once we've seen a 2xx
            // status *and* the tarball is large enough to be worth the
            // overhead. For small bodies, or any 4xx/5xx / transport error,
            // fall back to the buffered path so the existing retry and
            // error-reporting code in `run_tasks` keeps working.
            // SAFETY: raw-ptr field reads on the live `stream`/`this`.
            let status_code = unsafe { (*stream).status_code };
            let ok_status = status_code >= 200 && status_code <= 299;
            let big_enough = match result.body_size {
                http::BodySize::ContentLength(len) => len >= TarballStream::min_size(),
                // No Content-Length (chunked encoding): we can't know up
                // front, so stream — it avoids an unbounded buffer.
                _ => true,
            };
            // SAFETY: `this` is live; the HTTP thread is its sole writer here.
            let committed = unsafe { (*this).streaming_committed };

            if committed || (ok_status && big_enough && result.fail.is_none()) {
                if result.has_more {
                    if !chunk.is_empty() {
                        // The drain task is scheduled by `on_chunk`
                        // (guarded by its own `draining` atomic) so it
                        // runs at most once at a time, releases the
                        // worker on ARCHIVE_RETRY, and is re-enqueued by
                        // the next chunk. Pending-task accounting stays
                        // balanced: `TarballStream.finish()` publishes
                        // exactly one of the extract Task (to
                        // `resolve_tasks`) or, when the connection failed
                        // mid-body, this NetworkTask (to
                        // `async_network_task_queue`).
                        // SAFETY: `this` is live; the HTTP thread is its sole writer here.
                        unsafe { (*this).streaming_committed = true };
                        // SAFETY: `stream` is the live heap-allocated
                        // `TarballStream` owned by this task.
                        unsafe { TarballStream::on_chunk(stream, chunk, false, None) };
                    }
                    return;
                }

                // Final callback. If we've already started streaming, hand
                // over the last bytes and close; the drain task will run
                // once more, finish up and push to `resolve_tasks`. If not
                // (whole body arrived in one go, or too small), fall through
                // so the buffered extractor handles it.
                if committed {
                    // SAFETY: see the `on_chunk` call above — `stream` is
                    // live and `on_chunk` takes `*mut Self` per its
                    // freely-aliasing contract.
                    unsafe {
                        TarballStream::on_chunk(
                            stream,
                            chunk,
                            true,
                            result.fail.map(crate::Error::from),
                        )
                    };
                    // Do NOT touch `this` — or anything it owns — after
                    // this point: `on_chunk(…, true, …)` sets `closed` and
                    // schedules a drain that may reach `finish()` on a
                    // worker thread before we return here. `finish()`
                    // frees `response_buffer`, publishes the extract Task
                    // to `resolve_tasks`, and the main thread's processing
                    // of that Task returns this NetworkTask to
                    // `preallocated_network_tasks` (poisoning it under
                    // ASAN). The NetworkTask is therefore *not* pushed to
                    // `async_network_task_queue` here; the extract Task
                    // owns its lifetime from now on.
                    return;
                }
            } else if result.has_more {
                // Non-2xx response (or too small to stream) still
                // delivering its body: accumulate in `response_buffer` so
                // the main thread can inspect it. Do not enqueue until the
                // stream ends.
                // SAFETY: `this` is live; the HTTP thread is its sole writer here.
                unsafe { (*this).response_buffer.list.extend_from_slice(chunk) };
                return;
            }
            // Fall through to the normal completion path for anything that
            // did not commit: the buffered extractor / retry logic in
            // `run_tasks` handles it exactly as it would without
            // streaming support.
        }

        // Stash this callback's body bytes into our own accumulation buffer
        // before `detach_lifetime` clears `result.body` to `&[]`. Covers the
        // non-streaming manifest path and the tarball fall-through above.
        if result.metadata.is_some() {
            // First callback of a fresh attempt on the non-streaming path —
            // clear stale bytes from a prior retry. The streaming fall-through
            // already `.take()`d metadata and reset above, so this is a no-op
            // there and accumulated chunks are preserved.
            // SAFETY: `this` is live; the HTTP thread is its sole writer here.
            unsafe { (*this).response_buffer.reset() };
        }
        // SAFETY: `this` is live; the HTTP thread is its sole writer here.
        unsafe { result.body_into(&mut (*this).response_buffer.list) };

        // BACKREF — PackageManager owns this task and outlives it. `notify`
        // runs on the HTTP thread, so we never materialize a `&mut
        // PackageManager` here (the main thread may hold one concurrently);
        // field access goes through `addr_of!` and the cross-thread
        // `wake_raw` path, mirroring `TarballStream::finish` /
        // `isolated_install::Installer::Task::callback`.
        //
        // SAFETY: `this` is live and non-null; `package_manager` is the
        // owning-manager BACKREF, valid for the task's lifetime.
        let pm = unsafe { (*this).package_manager.as_mut_ptr() };
        // SAFETY: `this` is non-null (raw receiver from the callback).
        let this_ptr = unsafe { ptr::NonNull::new_unchecked(this) };
        // The wake happens at the end of the fn (no
        // early returns past this point).

        // SAFETY: `real` is set by the HTTP thread before invoking the
        // completion callback.
        unsafe {
            let real = async_http.real.expect("unreachable").as_ptr();
            ptr::write(real, ptr::read(async_http));
        }
        // SAFETY: the HTTP thread is the sole writer for this call; nothing
        // exclusive to `*this` outlives this block, which ends before the
        // cross-thread push below. `detach_lifetime` erases the callback-scoped
        // `'_` to `'static` and clears `body` to `&[]`; the body bytes were
        // stashed into `(*this).response_buffer` above.
        unsafe {
            // Preserve metadata captured on an earlier streaming callback; the
            // final `result` won't have it.
            let saved_metadata = (*this).response.metadata.take();
            (*this).response = result.detach_lifetime();
            if (*this).response.metadata.is_none() {
                (*this).response.metadata = saved_metadata;
            }
        }
        // SAFETY: `pm` is a live BACKREF; `async_network_task_queue` is
        // internally synchronized (`UnboundedQueue::push` takes `&self`).
        unsafe {
            (*ptr::addr_of!((*pm).async_network_task_queue)).push(this_ptr);
            PackageManager::wake_raw(pm);
        }
    }
}

#[derive(Clone, Copy)]
pub enum Authorization {
    NoAuthorization,
    AllowAuthorization,
}

// We must use a less restrictive Accept header value
// https://github.com/oven-sh/bun/issues/341
// https://www.jfrog.com/jira/browse/RTFACT-18398
const ACCEPT_HEADER_VALUE: &str =
    "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";
const ACCEPT_HEADER_VALUE_EXTENDED: &str = "application/json, */*";

const DEFAULT_HEADERS_BUF: &str = concat!(
    "Accept",
    "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
);
const EXTENDED_HEADERS_BUF: &str = concat!("Accept", "application/json, */*");

fn append_auth(header_builder: &mut HeaderBuilder, scope: &npm::registry::Scope) {
    // Routing through `format_args!`/`BStr` Display would be
    // lossy for non-UTF-8 tokens (U+FFFD expands 1→3 bytes) and overrun the
    // exact byte count reserved by `count_auth`. Use raw-byte append.
    let Some((scheme, value)) = scope.authorization_parts() else {
        return;
    };
    header_builder.append_bytes_value("Authorization", scheme, value);
    header_builder.append("npm-auth-type", "legacy");
}

fn count_auth(header_builder: &mut HeaderBuilder, scope: &npm::registry::Scope) {
    let Some((scheme, value)) = scope.authorization_parts() else {
        return;
    };
    header_builder.count("Authorization", "");
    header_builder.content.cap += scheme.len() + value.len();
    header_builder.count("npm-auth-type", "legacy");
}

/// Splits `http://user:pass@host/pkg.tgz` into `user:pass` and `http://host/pkg.tgz`; only an `@` in the authority counts, not `/@scope/`.
fn split_url_userinfo(url: &[u8]) -> Option<(&[u8], Box<[u8]>)> {
    let authority_start = strings::index_of(url, b"://")? + b"://".len();
    let rest = &url[authority_start..];
    let authority = &rest[..strings::index_of_any(rest, b"/?#").unwrap_or(rest.len())];
    let at = strings::last_index_of_char(authority, b'@')?;

    let mut without_userinfo = Vec::with_capacity(url.len() - (at + 1));
    without_userinfo.extend_from_slice(&url[..authority_start]);
    without_userinfo.extend_from_slice(&rest[at + 1..]);
    Some((&rest[..at], without_userinfo.into_boxed_slice()))
}

/// `Basic base64(userinfo)` as written (no percent-decoding, `user` means `user:`), matching what npm sends via node's `auth` option.
fn basic_authorization_from_userinfo(userinfo: &[u8]) -> Vec<u8> {
    const SCHEME: &[u8] = b"Basic ";
    let mut user_pass = Vec::with_capacity(userinfo.len() + 1);
    user_pass.extend_from_slice(userinfo);
    if !strings::contains_char(userinfo, b':') {
        user_pass.push(b':');
    }
    let mut value = vec![0u8; SCHEME.len() + bun_core::base64::encode_len(&user_pass)];
    value[..SCHEME.len()].copy_from_slice(SCHEME);
    let encoded_len = bun_core::base64::encode(&mut value[SCHEME.len()..], &user_pass);
    value.truncate(SCHEME.len() + encoded_len);
    value
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ForManifestError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidURL")]
    InvalidURL,
}
bun_core::oom_from_alloc!(ForManifestError);
impl From<ForManifestError> for crate::Error {
    fn from(e: ForManifestError) -> Self {
        match e {
            ForManifestError::OutOfMemory => crate::Error::Alloc(bun_alloc::AllocError),
            ForManifestError::InvalidURL => crate::Error::InvalidURL,
        }
    }
}
impl bun_core::output::ErrName for ForManifestError {
    fn name(&self) -> &[u8] {
        <&'static str>::from(self).as_bytes()
    }
}

impl NetworkTask {
    pub(crate) fn for_manifest(
        &mut self,
        name: &[u8],
        scope: &npm::registry::Scope,
        loaded_manifest: Option<&PackageManifest>,
        is_optional: bool,
        needs_extended: bool,
    ) -> Result<(), ForManifestError> {
        let pm = self.pm_mut();
        // SAFETY: `pm.log` is the long-lived `*mut Log` the package manager
        // was constructed with.
        let log = pm.log_mut();

        self.url_buf = 'blk: {
            // Not all registries support scoped package names when fetching the manifest.
            // registry.npmjs.org supports both "@storybook%2Faddons" and "@storybook/addons"
            // Other registries like AWS codeartifact only support the former.
            // "npm" CLI requests the manifest with the encoded name.
            let encoded_name_storage;
            let encoded_name: &[u8] = if strings::index_of_char(name, b'/').is_some() {
                encoded_name_storage = strings::replace_owned(name, b"/", b"%2f");
                &encoded_name_storage
            } else {
                name
            };

            let tmp = bun_url::join(
                &bun_core::String::borrow_utf8(scope.url.href()),
                &bun_core::String::borrow_utf8(encoded_name),
            );

            if tmp.tag() == bun_core::Tag::Dead {
                if !is_optional {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Failed to join registry {} and package {} URLs",
                            quote(scope.url.href()),
                            quote(name),
                        ),
                    );
                } else {
                    log.add_warning_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Failed to join registry {} and package {} URLs",
                            quote(scope.url.href()),
                            quote(name),
                        ),
                    );
                }
                return Err(ForManifestError::InvalidURL);
            }

            if !(tmp.starts_with_ascii(b"https://") || tmp.starts_with_ascii(b"http://")) {
                if !is_optional {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Registry URL must be http:// or https://\nReceived: \"{}\"",
                            tmp
                        ),
                    );
                } else {
                    log.add_warning_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Registry URL must be http:// or https://\nReceived: \"{}\"",
                            tmp
                        ),
                    );
                }
                return Err(ForManifestError::InvalidURL);
            }

            // This actually duplicates the string! The WTF managed one above drops at scope exit.
            let url_bytes = tmp.to_owned_slice().into_boxed_slice();

            {
                let joined = URL::parse(&url_bytes);
                let registry = scope.url.url();
                let registry_dir_end =
                    strings::last_index_of_char(registry.pathname, b'/').map_or(0, |i| i + 1);
                let registry_dir = &registry.pathname[..registry_dir_end];
                if !joined.protocol.eq_ignore_ascii_case(registry.protocol)
                    || !joined.hostname.eq_ignore_ascii_case(registry.hostname)
                    || joined.get_port_auto() != registry.get_port_auto()
                    || !joined.pathname.starts_with(registry_dir)
                {
                    if !is_optional {
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "Invalid package name {}: manifest URL {} is not on registry {}",
                                quote(name),
                                quote(&url_bytes),
                                quote(scope.url.href()),
                            ),
                        );
                    } else {
                        log.add_warning_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "Invalid package name {}: manifest URL {} is not on registry {}",
                                quote(name),
                                quote(&url_bytes),
                                quote(scope.url.href()),
                            ),
                        );
                    }
                    return Err(ForManifestError::InvalidURL);
                }
            }

            break 'blk url_bytes;
        };

        let mut last_modified: &[u8] = b"";
        let mut etag: &[u8] = b"";
        if let Some(manifest) = loaded_manifest {
            if (needs_extended && manifest.pkg.has_extended_manifest) || !needs_extended {
                last_modified = manifest.pkg.last_modified.slice(&manifest.string_buf);
                etag = manifest.pkg.etag.slice(&manifest.string_buf);
            }
        }

        let mut header_builder = HeaderBuilder::default();

        count_auth(&mut header_builder, scope);

        if !etag.is_empty() {
            header_builder.count("If-None-Match", etag);
        } else if !last_modified.is_empty() {
            header_builder.count("If-Modified-Since", last_modified);
        }

        let headers_buf: &'static [u8] = if header_builder.header_count > 0 {
            let accept_header = if needs_extended {
                ACCEPT_HEADER_VALUE_EXTENDED
            } else {
                ACCEPT_HEADER_VALUE
            };
            header_builder.count("Accept", accept_header);
            let trailing_last_modified = !last_modified.is_empty() && !etag.is_empty();
            if trailing_last_modified {
                header_builder.content.count(last_modified);
            }
            header_builder.allocate()?;

            append_auth(&mut header_builder, scope);

            if !etag.is_empty() {
                header_builder.append("If-None-Match", etag);
            } else if !last_modified.is_empty() {
                header_builder.append("If-Modified-Since", last_modified);
            }

            header_builder.append("Accept", accept_header);

            let last_modified_start = header_builder.content.len;
            if trailing_last_modified {
                let _ = header_builder.content.append(last_modified);
            }
            debug_assert_eq!(header_builder.content.len, header_builder.content.cap);
            self.header_buf = header_builder.content.move_to_slice();
            if trailing_last_modified {
                // SAFETY: `self.header_buf` outlives the request; it is freed when the slot returns to the pool.
                last_modified =
                    unsafe { bun_ptr::detach_lifetime(&self.header_buf[last_modified_start..]) };
            }
            // SAFETY: same invariant as `last_modified` above.
            unsafe { bun_ptr::detach_lifetime(&*self.header_buf) }
        } else {
            let header_buf: &'static str = if needs_extended {
                EXTENDED_HEADERS_BUF
            } else {
                DEFAULT_HEADERS_BUF
            };
            header_builder.entries.append(http::headers::Entry {
                name: http::headers::api::StringPointer {
                    offset: 0,
                    length: "Accept".len() as u32,
                },
                value: http::headers::api::StringPointer {
                    offset: "Accept".len() as u32,
                    length: (header_buf.len() - "Accept".len()) as u32,
                },
            })?;
            header_builder.header_count = 1;
            self.header_buf = Box::default();
            header_buf.as_bytes()
        };

        self.response_buffer = MutableString::init(0)?;

        // SAFETY: `self.url_buf` outlives the request, same as `header_buf` above (see `s3/simple_request.rs`).
        let url = URL::parse(unsafe { bun_ptr::detach_lifetime(&self.url_buf) });
        let http_proxy = pm.http_proxy(&url);
        let completion_callback = self.get_completion_callback();
        // MaybeUninit overwrite — see field doc; old slot value is
        // either uninitialized (fresh hive slot) or a stale bitwise copy from
        // `notify`, neither of which is safe/meaningful to drop.
        self.unsafe_http_client = MaybeUninit::new(AsyncHTTP::init(
            http::Method::GET,
            url,
            header_builder.entries,
            headers_buf,
            b"",
            completion_callback,
            http::FetchRedirect::Follow,
            AsyncHTTPOptions {
                http_proxy,
                ..Default::default()
            },
        ));
        self.http_mut().client.flags.reject_unauthorized = pm.tls_reject_unauthorized();

        if PackageManager::verbose_install() {
            self.http_mut().client.verbose = HTTPVerboseLevel::Headers;
        }

        self.callback = Callback::PackageManifest {
            name: strings::StringOrTinyString::init_append_if_needed(
                name,
                &mut filename_store_appender(),
            )?,
            loaded_manifest: loaded_manifest.cloned(),
            is_extended_manifest: needs_extended,
        };

        if PackageManager::verbose_install() {
            self.http_mut().client.verbose = HTTPVerboseLevel::Headers;
        }

        // Incase the ETag causes invalidation, we fallback to the last modified date.
        if !last_modified.is_empty()
            && bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304
                .get()
                .unwrap_or(false)
        {
            self.http_mut().client.flags.force_last_modified = true;
            // SAFETY: `last_modified` points into `self.header_buf` or into the manifest `string_buf` cloned into `self.callback`; both outlive the request.
            self.http_mut().client.if_modified_since =
                unsafe { bun_ptr::detach_lifetime(last_modified) };
        }

        Ok(())
    }

    /// Moves the fully written header block into `self.header_buf` and returns a view of it.
    fn store_header_buf<'a>(&'a mut self, header_builder: &mut HeaderBuilder) -> &'a [u8] {
        debug_assert_eq!(header_builder.content.len, header_builder.content.cap);
        self.header_buf = header_builder.content.move_to_slice();
        &self.header_buf
    }

    pub(crate) fn get_completion_callback(&mut self) -> HTTPClientResultCallback {
        // `HTTPClientResultCallback::new`
        // performs type erasure over a `fn(*mut T, *mut AsyncHTTP, _)`.
        HTTPClientResultCallback::new::<NetworkTask>(self, Self::notify)
    }

    pub(crate) fn schedule(&mut self, batch: &mut Batch) {
        self.http_mut().schedule(batch);
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ForTarballError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidURL")]
    InvalidURL,
    /// `--offline` and the tarball is not in the cache. Already reported (once per
    /// package); callers treat it like `AlreadyFailed`.
    #[error("TarballFailedToDownload")]
    Offline,
    /// Returned by `enqueue_*_for_download` when the dedupe map already records
    /// a terminal failure for this task id. Callers handle it silently (the
    /// original failure was already reported) and advance their own bookkeeping.
    #[error("TarballFailedToDownload")]
    AlreadyFailed,
}
bun_core::oom_from_alloc!(ForTarballError);
impl From<ForTarballError> for crate::Error {
    fn from(e: ForTarballError) -> Self {
        match e {
            ForTarballError::OutOfMemory => crate::Error::Alloc(bun_alloc::AllocError),
            ForTarballError::InvalidURL => crate::Error::InvalidURL,
            ForTarballError::AlreadyFailed | ForTarballError::Offline => {
                crate::Error::TarballFailedToDownload
            }
        }
    }
}
impl PartialEq<crate::Error> for ForTarballError {
    fn eq(&self, other: &crate::Error) -> bool {
        <&'static str>::from(self) == other.name()
    }
}
impl bun_core::output::ErrName for ForTarballError {
    fn name(&self) -> &[u8] {
        <&'static str>::from(self).as_bytes()
    }
}

impl NetworkTask {
    pub(crate) fn for_tarball(
        &mut self,
        tarball_: ExtractTarball,
        scope: &npm::registry::Scope,
        authorization: Authorization,
    ) -> Result<(), ForTarballError> {
        let pm = self.pm_mut();

        let tarball_url = tarball_.url.slice();
        self.url_buf = if tarball_url.is_empty() {
            // SAFETY: `value` is the `Npm` variant on this code path —
            // `for_tarball` is only reached for npm tarball downloads
            // (callers gate on `resolution.tag == .npm`).
            let version = tarball_.resolution.npm().version;
            Box::from(extract_tarball::build_url(
                scope.url.href(),
                &tarball_.name,
                version,
                pm.lockfile.buffers.string_bytes.as_slice(),
            )?)
        } else {
            // Owning the copy (rather than aliasing `tarball.url`)
            // avoids a self-reference into `callback` (see `url_buf` field doc).
            Box::<[u8]>::from(tarball_url)
        };
        self.callback = Callback::Extract(tarball_);
        let Callback::Extract(tarball) = &self.callback else {
            unreachable!()
        };

        if !(self.url_buf.starts_with(b"https://") || self.url_buf.starts_with(b"http://")) {
            // SAFETY: `pm.log` is the long-lived `*mut Log` the package
            // manager was constructed with.
            pm.log_mut().add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "Expected tarball URL to start with https:// or http://, got {} while fetching package {}",
                    quote(&self.url_buf),
                    quote(tarball.name.slice()),
                ),
            );
            return Err(ForTarballError::InvalidURL);
        }

        // Userinfo becomes a header and leaves the URL: `bun_url` keeps it in `origin`, which the redirect same-origin check compares.
        let url_authorization: Option<Vec<u8>> = match split_url_userinfo(&self.url_buf) {
            Some((userinfo, url_without_userinfo)) => {
                let value =
                    (!userinfo.is_empty()).then(|| basic_authorization_from_userinfo(userinfo));
                self.url_buf = url_without_userinfo;
                value
            }
            None => None,
        };

        // One parse decides the authority, the wire path and the `.npmrc` key; a URL it cannot settle is requested as written with no line.
        let normalized = match npm::registry::normalize_tarball_url(&self.url_buf) {
            Some(normalized) => {
                self.url_buf = normalized;
                true
            }
            None => false,
        };

        let credentials = match authorization {
            Authorization::NoAuthorization => None,
            Authorization::AllowAuthorization => {
                pm.options
                    .tarball_credentials(scope, &URL::parse(&self.url_buf), normalized)
            }
        };

        self.response_buffer = MutableString::init_empty();

        let mut header_builder = HeaderBuilder::default();

        // Configured credentials win over the URL's userinfo, as in npm.
        let header_buf: &[u8] = match (credentials, url_authorization) {
            (Some(credentials), _) => {
                count_auth(&mut header_builder, credentials);
                header_builder.allocate()?;
                append_auth(&mut header_builder, credentials);
                self.store_header_buf(&mut header_builder)
            }
            (None, Some(value)) => {
                header_builder.count("Authorization", &value);
                header_builder.allocate()?;
                header_builder.append("Authorization", &value);
                self.store_header_buf(&mut header_builder)
            }
            (None, None) => {
                self.header_buf = Box::default();
                b""
            }
        };
        // SAFETY: lifetime extension. `header_buf` is `b""` or a view of the heap
        // allocation `self.header_buf` owns, which is freed only when the slot returns
        // to the pool, after the request completes. `AsyncHTTP::init` demands a
        // `'static` borrow because the HTTP thread reads it concurrently, as for
        // `url_buf` below.
        let header_buf: &'static [u8] = unsafe { bun_ptr::detach_lifetime(header_buf) };

        // SAFETY: lifetime extension — `url_buf` is a heap allocation owned by
        // `*self`, which outlives the HTTP request. `AsyncHTTP::init` demands a
        // `'static` borrow because the HTTP thread reads it concurrently. See
        // the identical pattern in `for_manifest` above.
        let url = URL::parse(unsafe { bun_ptr::detach_lifetime(&self.url_buf) });

        let mut http_options = AsyncHTTPOptions {
            http_proxy: pm.http_proxy(&url),
            ..Default::default()
        };

        if extract_tarball::uses_streaming_extraction() {
            // Tell the HTTP client to invoke `notify` for every body chunk
            // instead of buffering the whole response. `notify` pushes each
            // chunk into `tarball_stream`, which schedules a drain task on
            // `thread_pool`; the drain task calls into libarchive until it
            // reports ARCHIVE_RETRY (out of input), then returns so the
            // worker can be reused for other install work. The next chunk
            // reschedules it and libarchive — whose state lives on the heap
            // — resumes exactly where it stopped.
            //
            // The stream itself is created by the caller (see
            // `generateNetworkTaskForTarball`) because it needs the
            // pre-allocated `Task` that carries the final result.
            //
            // Only wire up the one signal we need; `Signals.Store.to()`
            // would also publish `aborted`/`cert_errors`/etc., which makes
            // the HTTP client allocate an abort-tracker id and changes
            // keep-alive behaviour we don't want here.
            self.signal_store = http::signals::Store::default();
            self.signal_store
                .response_body_streaming
                .store(true, Ordering::Relaxed);
            http_options.signals = Some(http::Signals {
                response_body_streaming: Some(NonNull::from(
                    &self.signal_store.response_body_streaming,
                )),
                ..Default::default()
            });
        }

        let completion_callback = self.get_completion_callback();
        // MaybeUninit overwrite — see field doc; old slot value is
        // either uninitialized (fresh hive slot) or a stale bitwise copy from
        // `notify`, neither of which is safe/meaningful to drop.
        self.unsafe_http_client = MaybeUninit::new(AsyncHTTP::init(
            http::Method::GET,
            url,
            header_builder.entries,
            header_buf,
            b"",
            completion_callback,
            http::FetchRedirect::Follow,
            http_options,
        ));
        self.http_mut().client.flags.reject_unauthorized = pm.tls_reject_unauthorized();
        if PackageManager::verbose_install() {
            self.http_mut().client.verbose = HTTPVerboseLevel::Headers;
        }

        Ok(())
    }

    /// Release any streaming-extraction resources that were never used because
    /// the request errored before a drain was scheduled. Called on the main
    /// thread from `run_tasks` when falling back to the buffered path.
    pub(crate) fn discard_unused_streaming_state(&mut self, manager: &mut PackageManager) {
        debug_assert!(!self.streaming_committed);
        if let Some(stream) = self.tarball_stream.take() {
            drop(stream);
        }
        if !self.streaming_extract_task.is_null() {
            // ARENA: returned to `preallocated_resolve_tasks` pool, not freed.
            // SAFETY: `streaming_extract_task` was obtained from this same
            // `preallocated_resolve_tasks` pool via `get_init()` and is not aliased
            // (cleared immediately below); `put()` runs `Task::drop` on the
            // slot — the Task was fully initialized via
            // `enqueue::create_extract_task_for_streaming` so this is sound.
            unsafe {
                manager
                    .preallocated_resolve_tasks
                    .put(self.streaming_extract_task);
            }
            self.streaming_extract_task = ptr::null_mut();
        }
    }

    /// Prepare this task for another HTTP attempt. A stream that never ran is
    /// reused; one consumed by a download that failed mid-body (released in
    /// `TarballStream::finish`) is replaced, keeping the same extract Task.
    pub(crate) fn reset_streaming_for_retry(&mut self) {
        debug_assert!(!self.streaming_committed);
        if let Some(stream) = self.tarball_stream.as_deref_mut() {
            stream.reset_for_retry();
        } else if !self.streaming_extract_task.is_null() {
            let manager = self.package_manager.as_mut_ptr();
            let this: *mut NetworkTask = self;
            // SAFETY: `init` returns a fresh heap allocation owned here.
            self.tarball_stream = Some(unsafe {
                bun_core::heap::take(TarballStream::init(
                    self.streaming_extract_task,
                    this,
                    manager,
                ))
            });
        }
        self.response = HTTPClientResult::default();
    }

    /// Initialize a freshly-vended pool slot in place — a full struct overwrite
    /// that resets every other field to its struct default. The slot may be
    /// uninitialized heap memory (from `HiveArrayFallback::claim()`'s
    /// `Box::new_uninit()` fallback) or stale (reused hive slot whose prior
    /// contents ARE now dropped on `put` since 1e76047), so each field is
    /// written via `addr_of_mut!().write()` without dropping the previous
    /// value — the slot is freshly poisoned/uninit from `claim()`.
    ///
    /// Caller-initialized fields (`unsafe_http_client`, `callback`,
    /// `response_buffer`) are written here with drop-safe
    /// placeholders so subsequent `=` assignments in `for_manifest`/
    /// `for_tarball` do not drop uninitialized memory. `unsafe_http_client`
    /// stays bitwise-untouched (it is `MaybeUninit`, so leaving it uninit is
    /// sound under the `&mut NetworkTask` the caller forms next; it is
    /// overwritten without drop by `for_manifest`/`for_tarball`).
    ///
    /// # Safety
    /// `slot` must be the unique handle to a `HiveArrayFallback<NetworkTask>`
    /// slot returned by `claim()`; its prior contents are treated as garbage
    /// (no destructors run).
    pub(crate) unsafe fn write_init(
        slot: *mut NetworkTask,
        task_id: crate::package_manager_task::Id,
        package_manager: *mut PackageManager,
        apply_patch_task: Option<Box<PatchTask>>,
    ) {
        use core::ptr::addr_of_mut;
        // SAFETY: caller contract (see fn `# Safety`) — `slot` is the unique
        // handle to a freshly-vended `HiveArrayFallback` slot whose prior
        // contents are garbage; every field is written without dropping.
        unsafe {
            addr_of_mut!((*slot).task_id).write(task_id);
            // SAFETY: `package_manager` is the live owner of this task; write
            // provenance is required for `for_manifest`/`for_tarball`'s
            // `assume_mut`, so callers pass `*mut` (not `*const`).
            addr_of_mut!((*slot).package_manager)
                .write(bun_ptr::ParentRef::from_raw_mut(package_manager));
            addr_of_mut!((*slot).apply_patch_task).write(apply_patch_task);
            // Struct-default fields.
            addr_of_mut!((*slot).response).write(HTTPClientResult::default());
            addr_of_mut!((*slot).url_buf).write(Box::default());
            addr_of_mut!((*slot).header_buf).write(Box::default());
            addr_of_mut!((*slot).retried).write(0);
            addr_of_mut!((*slot).next).write(bun_threading::Link::new());
            addr_of_mut!((*slot).tarball_stream).write(None);
            addr_of_mut!((*slot).streaming_extract_task).write(ptr::null_mut());
            addr_of_mut!((*slot).streaming_committed).write(false);
            addr_of_mut!((*slot).signal_store).write(http::signals::Store::default());
            // Caller-initialized fields: write drop-safe placeholders so the
            // plain `=` in `for_manifest`/`for_tarball` drops a valid value.
            // (`unsafe_http_client` is `MaybeUninit` — left uninitialized.)
            addr_of_mut!((*slot).response_buffer).write(MutableString::init_empty());
            addr_of_mut!((*slot).callback).write(Callback::LocalTarball);
        }
    }
}

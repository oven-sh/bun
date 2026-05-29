use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr::{self, NonNull};
use core::sync::atomic::Ordering;

use bstr::ByteSlice;

use crate::bun_fs::{FileSystem, FilenameStore};
use bun_collections::HashMap;
use bun_core::{self, fmt::quote};
use bun_core::{MutableString, StringBuilder, strings};
use bun_http::{
    self as http, AsyncHTTP, HTTPClientResult, HTTPClientResultCallback, HTTPVerboseLevel,
    HeaderBuilder, async_http::Options as AsyncHTTPOptions,
};
use bun_threading::thread_pool::Batch;
use bun_url::URL;

use crate::extract_tarball;
use crate::npm::{self as npm, PackageManifest};
use crate::{ExtractTarball, PackageManager, PatchTask, TarballStream, Task};

pub struct FilenameStoreAppender<'a>(pub &'a FilenameStore);
impl strings::Appender for FilenameStoreAppender<'_> {
    fn append(&mut self, s: &[u8]) -> Result<&[u8], bun_alloc::AllocError> {
        self.0.append(s)
    }
    fn append_lower_case(&mut self, s: &[u8]) -> Result<&[u8], bun_alloc::AllocError> {
        self.0.append_lower_case(s)
    }
}

/// Convenience: returns an `Appender` over the global filename store, matching
/// Zig `*FileSystem.FilenameStore` callsites in `runTasks.zig` /
/// `PackageManagerEnqueue.zig`.
#[inline]
pub(crate) fn filename_store_appender() -> FilenameStoreAppender<'static> {
    FilenameStoreAppender(FileSystem::instance().filename_store())
}

pub struct NetworkTask {
    pub unsafe_http_client: MaybeUninit<AsyncHTTP<'static>>,
    pub response: HTTPClientResult<'static>,
    pub task_id: crate::package_manager_task::Id,
    // TODO(port): owned in `for_manifest` (toOwnedSlice) but borrowed from
    // `tarball.url` in `for_tarball`; Zig leaks/aliases — verify ownership in Phase B.
    pub url_buf: Box<[u8]>,
    pub retried: u16,
    // Zig: `std.mem.Allocator param` — dropped (global mimalloc); see §Allocators.
    pub request_buffer: MutableString,
    pub response_buffer: MutableString,
    // BACKREF: PackageManager owns this task via `preallocated_network_tasks`.
    // ParentRef constructed via `from_raw_mut` so `assume_mut` retains write
    // provenance for `for_manifest`/`for_tarball` (which call `pm.log_mut()`).
    pub package_manager: bun_ptr::ParentRef<PackageManager>,
    pub callback: Callback,
    /// Key in patchedDependencies in package.json
    // PORT NOTE: `'static` because NetworkTask is stored lifetime-less in
    // `PreallocatedNetworkTasks`; PatchTask's `'a` is a BACKREF on
    pub apply_patch_task: Option<Box<PatchTask>>,
    pub next: bun_threading::Link<NetworkTask>,

    /// Producer/consumer buffer that feeds tarball bytes from the HTTP thread
    /// to a worker running libarchive. `None` when streaming extraction is
    /// disabled or this task is not a tarball download.
    pub tarball_stream: Option<Box<TarballStream>>,
    pub streaming_extract_task: *mut Task<'static>,
    pub streaming_committed: bool,
    /// Backing store for the streaming signal the HTTP client polls.
    pub signal_store: http::signals::Store,
}

// SAFETY: `next` is the sole intrusive link and is only ever read/written via
// these accessors by `UnboundedQueue<NetworkTask>`. Mirrors Zig's
// `@field(item, "next")` over `bun.UnboundedQueue(NetworkTask, .next)`.
unsafe impl bun_threading::Linked for NetworkTask {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

/// Zig: `union(Task.Tag)` — tag type is `Task.Tag`.
// TODO(port): ensure discriminants match `crate::task::Tag` ordering for any
// code that transmutes between them.
pub enum Callback {
    PackageManifest {
        loaded_manifest: Option<PackageManifest>,
        name: strings::StringOrTinyString,
        is_extended_manifest: bool,
    },
    Extract(ExtractTarball),
    GitClone,
    GitCheckout,
    LocalTarball,
}

#[derive(Default, Clone, Copy)]
pub struct DedupeMapEntry {
    pub is_required: bool,
}
pub(crate) type DedupeMap = HashMap<crate::package_manager_task::Id, DedupeMapEntry>;

impl NetworkTask {
    #[inline]
    pub fn http(&self) -> &AsyncHTTP<'static> {
        // SAFETY: every caller is reached only after `unsafe_http_client` was
        // populated via `MaybeUninit::new(AsyncHTTP::init(..))` (or the
        // `ptr::write(real, ..)` in `notify`).
        unsafe { self.unsafe_http_client.assume_init_ref() }
    }

    /// Mutable counterpart of [`http`]; same precondition.
    #[inline]
    pub fn http_mut(&mut self) -> &mut AsyncHTTP<'static> {
        // SAFETY: see `http()`.
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

    // PORT NOTE: signature matches `HTTPClientResultCallback::new::<NetworkTask>`'s
    // `fn(*mut T, *mut AsyncHTTP, HTTPClientResult<'_>)` shape so it can be
    // installed directly without a separate trampoline.
    fn notify(
        this: *mut NetworkTask,
        async_http: *mut AsyncHTTP<'static>,
        mut result: HTTPClientResult<'_>,
    ) {
        // SAFETY: `this` is the `&mut NetworkTask` that was erased into the
        // callback ctx in `get_completion_callback`; the HTTP thread is the
        // sole writer for the duration of this call.
        let this = unsafe { &mut *this };
        // SAFETY: `async_http` is the threadlocal AsyncHTTP the HTTP client
        // passes to every completion callback; live for this call.
        let async_http = unsafe { &mut *async_http };
        if let Some(stream) = this.tarball_stream.as_deref_mut() {
            // `metadata` is only populated on the first callback that
            // carries response headers. Cache the status code so both the
            // main thread and later chunk callbacks can see it.
            if let Some(m) = result.metadata.take() {
                stream.status_code = m.response.status_code;
                this.response.metadata = Some(m);
            }

            let chunk = this.response_buffer.list.as_slice();

            let ok_status = stream.status_code >= 200 && stream.status_code <= 299;
            let big_enough = match result.body_size {
                http::BodySize::ContentLength(len) => len >= TarballStream::min_size(),
                // No Content-Length (chunked encoding): we can't know up
                // front, so stream — it avoids an unbounded buffer.
                _ => true,
            };
            let committed = this.streaming_committed;

            if committed || (ok_status && big_enough && result.fail.is_none()) {
                if result.has_more {
                    if !chunk.is_empty() {
                        this.streaming_committed = true;
                        // SAFETY: `stream` is the live heap-allocated
                        // `TarballStream` owned by this task. `on_chunk`
                        // takes `*mut Self` (Zig: freely-aliasing
                        // `*TarballStream`) because a worker may be inside
                        // `drain()` concurrently; coercing the `&mut` to a
                        // raw pointer here matches that contract.
                        unsafe { TarballStream::on_chunk(stream, chunk, false, None) };
                        // Hand the buffer back to the HTTP client empty so
                        // the next chunk starts at offset 0.
                        this.response_buffer.reset();
                    }
                    return;
                }

                if committed {
                    // SAFETY: see the `on_chunk` call above — `stream` is
                    // live and `on_chunk` takes `*mut Self` to match Zig's
                    // freely-aliasing `*TarballStream` contract.
                    unsafe { TarballStream::on_chunk(stream, chunk, true, result.fail) };
                    return;
                }
            } else if result.has_more {
                return;
            }
        }

        let pm = this.package_manager.as_mut_ptr();
        // Zig: `defer this.package_manager.wake();` — moved to end of fn (no
        // early returns past this point).

        // SAFETY: `real` is set by the HTTP thread before invoking the
        // completion callback; Zig unwraps with `.?`.
        // TODO(port): Zig does a struct-value copy `real.* = async_http.*` —
        // requires `AsyncHTTP: Clone` or a bitwise copy helper.
        unsafe {
            let real = async_http.real.expect("unreachable").as_ptr();
            ptr::write(real, ptr::read(async_http));
            (*real).response_buffer = async_http.response_buffer;
        }
        // Preserve metadata captured on an earlier streaming callback; the
        // final `result` won't have it.
        let saved_metadata = this.response.metadata.take();
        // SAFETY: `result.body` (the only borrowed field) points at
        // `this.response_buffer`, which `this` owns and outlives the stored
        // `HTTPClientResult`; erase the callback-scoped `'_` to `'static` to
        // match the field type (Zig stores it lifetime-less).
        this.response = unsafe { result.detach_lifetime() };
        if this.response.metadata.is_none() {
            this.response.metadata = saved_metadata;
        }
        let this_ptr = ptr::NonNull::from(this);
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
    if !scope.token.is_empty() {
        header_builder.append_bytes_value("Authorization", b"Bearer ", &scope.token);
    } else if !scope.auth.is_empty() {
        header_builder.append_bytes_value("Authorization", b"Basic ", &scope.auth);
    } else {
        return;
    }
    header_builder.append("npm-auth-type", "legacy");
}

fn count_auth(header_builder: &mut HeaderBuilder, scope: &npm::registry::Scope) {
    if !scope.token.is_empty() {
        header_builder.count("Authorization", "");
        header_builder.content.cap += "Bearer ".len() + scope.token.len();
    } else if !scope.auth.is_empty() {
        header_builder.count("Authorization", "");
        header_builder.content.cap += "Basic ".len() + scope.auth.len();
    } else {
        return;
    }
    header_builder.count("npm-auth-type", "legacy");
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ForManifestError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidURL")]
    InvalidURL,
}
bun_core::oom_from_alloc!(ForManifestError);
impl From<ForManifestError> for bun_core::Error {
    fn from(e: ForManifestError) -> Self {
        match e {
            ForManifestError::OutOfMemory => bun_core::err!(OutOfMemory),
            ForManifestError::InvalidURL => bun_core::err!(InvalidURL),
        }
    }
}
impl PartialEq<bun_core::Error> for ForManifestError {
    fn eq(&self, other: &bun_core::Error) -> bool {
        <&'static str>::from(self) == other.name()
    }
}
impl bun_core::output::ErrName for ForManifestError {
    fn name(&self) -> &[u8] {
        <&'static str>::from(self).as_bytes()
    }
}

impl NetworkTask {
    pub fn for_manifest(
        &mut self,
        name: &[u8],
        scope: &npm::registry::Scope,
        loaded_manifest: Option<&PackageManifest>,
        is_optional: bool,
        needs_extended: bool,
    ) -> Result<(), ForManifestError> {
        let pm = self.pm_mut();
        // SAFETY: `pm.log` is the long-lived `*mut Log` the package manager
        // was constructed with; Zig dereferences `this.package_manager.log`.
        let log = pm.log_mut();

        self.url_buf = 'blk: {
            let encoded_name_storage;
            let encoded_name: &[u8] = if strings::index_of_char(name, b'/').is_some() {
                encoded_name_storage = name.replace(b"/", b"%2f");
                &encoded_name_storage
            } else {
                name
            };

            // `OwnedString` derefs the WTF-backed result on scope exit (Zig:
            // `defer tmp.deref()`, NetworkTask.zig:216) — covers both the
            // success path and the InvalidURL early returns below.
            let tmp = bun_core::OwnedString::new(bun_url::join(
                &bun_core::String::borrow_utf8(scope.url.href()),
                &bun_core::String::borrow_utf8(encoded_name),
            ));

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

            if !(tmp.has_prefix_comptime(b"https://") || tmp.has_prefix_comptime(b"http://")) {
                if !is_optional {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Registry URL must be http:// or https://\nReceived: \"{}\"",
                            *tmp
                        ),
                    );
                } else {
                    log.add_warning_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Registry URL must be http:// or https://\nReceived: \"{}\"",
                            *tmp
                        ),
                    );
                }
                return Err(ForManifestError::InvalidURL);
            }

            // This actually duplicates the string! So we defer deref the WTF managed one above.
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
        }

        if !last_modified.is_empty() {
            header_builder.count("If-Modified-Since", last_modified);
        }

        if header_builder.header_count > 0 {
            let accept_header = if needs_extended {
                ACCEPT_HEADER_VALUE_EXTENDED
            } else {
                ACCEPT_HEADER_VALUE
            };
            header_builder.count("Accept", accept_header);
            if !last_modified.is_empty() && !etag.is_empty() {
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

            if !last_modified.is_empty() && !etag.is_empty() {
                let appended = header_builder.content.append(last_modified);
                // SAFETY: lifetime extension — the appended slice points into
                // `header_builder.content`'s heap buffer, which is moved into
                // `self.unsafe_http_client.request_header_buf` below and
                // outlives the request (Zig leaks it). Detach the borrow so
                // `header_builder.content` can be read again for `headers_buf`.
                last_modified = unsafe { bun_ptr::detach_lifetime(appended) };
            }
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
            // SAFETY: header_buf is &'static str; StringBuilder borrows it
            // mutably in type but is never written to on this path.
            header_builder.content = StringBuilder {
                ptr: NonNull::new(header_buf.as_ptr().cast_mut()),
                len: header_buf.len(),
                cap: header_buf.len(),
            };
        }

        self.response_buffer = MutableString::init(0)?;

        // SAFETY: lifetime extension — `url_buf` and the header content buffer
        // are heap allocations owned by / leaked into `*self`, which outlives
        // the HTTP request. `AsyncHTTP::init` demands `'static` borrows
        // because the HTTP thread reads them concurrently; the Zig source
        // passes raw slices under the same ownership contract. See the
        // identical pattern in `s3/simple_request.rs`.
        let url = URL::parse(unsafe { bun_ptr::detach_lifetime(&self.url_buf) });
        let http_proxy = pm.http_proxy(&url);
        // SAFETY: `written_slice()` is the safe (ptr,len) accessor; only the
        // `'static` erasure remains unsafe — the buffer is leaked into the
        // HTTP client below (`ManuallyDrop`), so it genuinely outlives this frame.
        let headers_buf: &'static [u8] =
            unsafe { bun_ptr::detach_lifetime(header_builder.content.written_slice()) };
        let _ = ManuallyDrop::new(core::mem::take(&mut header_builder.content));
        let completion_callback = self.get_completion_callback();
        self.unsafe_http_client = MaybeUninit::new(AsyncHTTP::init(
            http::Method::GET,
            url,
            header_builder.entries,
            headers_buf,
            ptr::addr_of_mut!(self.response_buffer),
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
            self.http_mut().verbose = HTTPVerboseLevel::Headers;
            self.http_mut().client.verbose = HTTPVerboseLevel::Headers;
        }

        // Incase the ETag causes invalidation, we fallback to the last modified date.
        if !last_modified.is_empty()
            && bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304
                .get()
                .unwrap_or(false)
        {
            self.http_mut().client.flags.force_last_modified = true;
            // SAFETY: lifetime extension — `last_modified` either points into
            // the leaked `header_builder.content` buffer (reassigned above) or
            // into the manifest's `string_buf`, which is the same allocation
            // referenced by the `PackageManifest` we just cloned into
            // `self.callback`. Both outlive the HTTP request; Zig stores the
            // raw slice under the same contract.
            self.http_mut().client.if_modified_since =
                unsafe { bun_ptr::detach_lifetime(last_modified) };
        }

        Ok(())
    }

    pub fn get_completion_callback(&mut self) -> HTTPClientResultCallback {
        // PORT NOTE: Zig `Callback.New(*NetworkTask, notify).init(this)` is a
        // comptime type-erased thunk generator. `HTTPClientResultCallback::new`
        // performs the same erasure over a `fn(*mut T, *mut AsyncHTTP, _)`.
        HTTPClientResultCallback::new::<NetworkTask>(self, Self::notify)
    }

    pub fn schedule(&mut self, batch: &mut Batch) {
        self.http_mut().schedule(batch);
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ForTarballError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidURL")]
    InvalidURL,
}
bun_core::oom_from_alloc!(ForTarballError);
impl From<ForTarballError> for bun_core::Error {
    fn from(e: ForTarballError) -> Self {
        match e {
            ForTarballError::OutOfMemory => bun_core::err!(OutOfMemory),
            ForTarballError::InvalidURL => bun_core::err!(InvalidURL),
        }
    }
}
impl PartialEq<bun_core::Error> for ForTarballError {
    fn eq(&self, other: &bun_core::Error) -> bool {
        <&'static str>::from(self) == other.name()
    }
}
impl bun_core::output::ErrName for ForTarballError {
    fn name(&self) -> &[u8] {
        <&'static str>::from(self).as_bytes()
    }
}

impl NetworkTask {
    pub fn for_tarball(
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
            // TODO(port): Zig aliases `tarball.url` here without copying;
            // `url_buf: Box<[u8]>` forces an allocation. Revisit ownership.
            Box::<[u8]>::from(tarball_url)
        };
        self.callback = Callback::Extract(tarball_);
        let Callback::Extract(tarball) = &self.callback else {
            unreachable!()
        };

        if !(self.url_buf.starts_with(b"https://") || self.url_buf.starts_with(b"http://")) {
            // SAFETY: `pm.log` is the long-lived `*mut Log` the package
            // manager was constructed with; Zig dereferences
            // `this.package_manager.log`.
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

        let send_auth = matches!(authorization, Authorization::AllowAuthorization) && {
            let tarball = URL::parse(&self.url_buf);
            let registry = scope.url.url();
            tarball.protocol == registry.protocol
                && tarball.hostname == registry.hostname
                && tarball.get_port_auto() == registry.get_port_auto()
        };

        self.response_buffer = MutableString::init_empty();

        let mut header_builder = HeaderBuilder::default();
        let mut header_buf: &'static [u8] = b"";

        if send_auth {
            count_auth(&mut header_builder, scope);
        }

        if header_builder.header_count > 0 {
            header_builder.allocate()?;

            if send_auth {
                append_auth(&mut header_builder, scope);
            }

            // SAFETY: `written_slice()` is the safe (ptr,len) accessor; only the
            // `'static` erasure remains unsafe — buffer is leaked below.
            header_buf =
                unsafe { bun_ptr::detach_lifetime(header_builder.content.written_slice()) };
        }
        let _ = ManuallyDrop::new(core::mem::take(&mut header_builder.content));

        // SAFETY: lifetime extension — `url_buf` is a heap allocation owned by
        // `*self`, which outlives the HTTP request. `AsyncHTTP::init` demands a
        // `'static` borrow because the HTTP thread reads it concurrently; the
        // Zig source passes a raw slice under the same ownership contract. See
        // the identical pattern in `for_manifest` above.
        let url = URL::parse(unsafe { bun_ptr::detach_lifetime(&self.url_buf) });

        let mut http_options = AsyncHTTPOptions {
            http_proxy: pm.http_proxy(&url),
            ..Default::default()
        };

        if extract_tarball::uses_streaming_extraction() {
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
        // PORT NOTE: MaybeUninit overwrite — see field doc; old slot value is
        // either uninitialized (fresh hive slot) or a stale bitwise copy from
        // `notify`, neither of which is safe/meaningful to drop.
        self.unsafe_http_client = MaybeUninit::new(AsyncHTTP::init(
            http::Method::GET,
            url,
            header_builder.entries,
            header_buf,
            ptr::addr_of_mut!(self.response_buffer),
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
    /// thread from `runTasks` when falling back to the buffered path.
    pub fn discard_unused_streaming_state(&mut self, manager: &mut PackageManager) {
        debug_assert!(!self.streaming_committed);
        if let Some(stream) = self.tarball_stream.take() {
            drop(stream);
        }
        if !self.streaming_extract_task.is_null() {
            // ARENA: returned to `preallocated_resolve_tasks` pool, not freed.
            // SAFETY: `streaming_extract_task` was obtained from this same
            // `preallocated_resolve_tasks` pool via `get()` and is not aliased
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

    /// Prepare this task for another HTTP attempt (used by retry logic when
    /// streaming extraction never started). Keeps the stream allocation so the
    /// retry can still benefit from streaming.
    pub fn reset_streaming_for_retry(&mut self) {
        debug_assert!(!self.streaming_committed);
        if let Some(stream) = self.tarball_stream.as_deref_mut() {
            stream.reset_for_retry();
        }
        self.response = HTTPClientResult::default();
    }

    /// Initialize a freshly-vended pool slot in place, mirroring Zig's
    /// `network_task.* = .{ .task_id = …, .callback = undefined, .allocator = …,
    /// .package_manager = …, .apply_patch_task = … }` — a full struct overwrite
    /// that resets every other field to its struct default. The slot may be
    /// uninitialized heap memory (from `HiveArrayFallback::get()`'s
    /// `Box::new_uninit()` fallback) or stale (reused hive slot whose prior
    /// contents ARE now dropped on `put` since 1e76047), so each field is
    /// written via `addr_of_mut!().write()` without dropping the previous
    /// value — the slot is freshly poisoned/uninit from `get()`.
    ///
    /// Fields that are `= undefined` in Zig (`unsafe_http_client`, `callback`,
    /// `request_buffer`, `response_buffer`) are written here with drop-safe
    /// placeholders so subsequent `=` assignments in `for_manifest`/
    /// `for_tarball` do not drop uninitialized memory. `unsafe_http_client`
    /// stays bitwise-untouched (it is `MaybeUninit`, so leaving it uninit is
    /// sound under the `&mut NetworkTask` the caller forms next; it is
    /// overwritten without drop by `for_manifest`/`for_tarball`).
    ///
    /// # Safety
    /// `slot` must be the unique handle to a `HiveArrayFallback<NetworkTask>`
    /// slot returned by `get()`; its prior contents are treated as garbage
    /// (matches Zig — no destructors run).
    pub unsafe fn write_init(
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
            // Struct-default fields (Zig: `= .{}` / `= 0` / `= null` / `= &[_]u8{}`).
            addr_of_mut!((*slot).response).write(HTTPClientResult::default());
            addr_of_mut!((*slot).url_buf).write(Box::default());
            addr_of_mut!((*slot).retried).write(0);
            addr_of_mut!((*slot).next).write(bun_threading::Link::new());
            addr_of_mut!((*slot).tarball_stream).write(None);
            addr_of_mut!((*slot).streaming_extract_task).write(ptr::null_mut());
            addr_of_mut!((*slot).streaming_committed).write(false);
            addr_of_mut!((*slot).signal_store).write(http::signals::Store::default());
            // Zig-`undefined` fields: write drop-safe placeholders so the
            // plain `=` in `for_manifest`/`for_tarball` drops a valid value.
            // (`unsafe_http_client` is `MaybeUninit` — left uninitialized.)
            addr_of_mut!((*slot).request_buffer).write(MutableString::init_empty());
            addr_of_mut!((*slot).response_buffer).write(MutableString::init_empty());
            addr_of_mut!((*slot).callback).write(Callback::LocalTarball);
        }
    }
}

// ported from: src/install/NetworkTask.zig

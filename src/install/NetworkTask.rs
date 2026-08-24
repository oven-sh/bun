use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::sync::Arc;

use crate::bun_fs::{FileSystem, FilenameStore};
use bun_collections::HashMap;
use bun_core::{self, fmt::quote};
use bun_core::{MutableString, strings};
use bun_http::{
    self as http, HTTPClientResult, HTTPVerboseLevel, HeaderBuilder, OwnedRequestBuffers,
    async_http::Options as AsyncHTTPOptions,
};
use bun_url::URL;

use crate::extract_tarball;
use crate::npm::{self as npm, PackageManifest};
use crate::{ExtractTarball, PackageManager, TarballStream, Task};

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
    /// The request; it owns the URL and header buffers it points into.
    /// `None` until `for_manifest`/`for_tarball` builds it.
    pub(crate) http: Option<http::OwnedRequest>,
    pub(crate) response: HTTPClientResult<'static>,
    pub(crate) task_id: crate::package_manager_task::Id,
    pub(crate) retried: u16,
    pub(crate) response_buffer: MutableString,
    /// Read-only on the HTTP thread (`shared`); the manager is leaked for the
    /// process and outlives every task.
    pub(crate) package_manager: bun_ptr::BackRef<PackageManager>,
    pub(crate) callback: Callback,
    pub(crate) next: bun_threading::Link<NetworkTask>,

    /// Producer/consumer buffer that feeds tarball bytes from the HTTP thread
    /// to a worker running libarchive. `None` when streaming extraction is
    /// disabled or this task is not a tarball download. Shared with the
    /// worker draining it; the stream owns the extract `Task` that carries
    /// the result (and eventually this network task) back to the main thread.
    pub(crate) tarball_stream: Option<Arc<TarballStream>>,
    /// The pre-created extract `Task` between a streamed attempt that failed
    /// mid-body and its retry (`reset_streaming_for_retry` builds a new
    /// stream around it).
    pub(crate) streaming_extract_task: Option<Box<Task>>,
    /// Set by the HTTP thread the first time it commits this request to
    /// the streaming path. Once true, the terminal callback hands this task
    /// to the stream instead of `async_network_task_queue` — the extract Task
    /// published by `TarballStream::finish()` owns it from then on. Also read
    /// by the main-thread fallback / retry paths in `run_tasks` to assert
    /// the stream was never started.
    pub(crate) streaming_committed: bool,
    /// Backing store for the streaming signal the HTTP client polls.
    pub(crate) signal_store: http::signals::Store,
}

bun_threading::intrusive_linked!(NetworkTask, next);

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
    /// The HTTP client, once `for_manifest`/`for_tarball` has built it.
    #[inline]
    pub(crate) fn http_mut(&mut self) -> &mut http::OwnedRequest {
        self.http.as_mut().expect("NetworkTask request built")
    }
    #[inline]
    pub(crate) fn http(&self) -> &http::OwnedRequest {
        self.http.as_ref().expect("NetworkTask request built")
    }
    /// The URL this task was built for.
    #[inline]
    pub(crate) fn url_buf(&self) -> &[u8] {
        self.http().url()
    }

    pub(crate) fn new(
        task_id: crate::package_manager_task::Id,
        package_manager: &PackageManager,
    ) -> Box<NetworkTask> {
        Box::new(NetworkTask {
            http: None,
            response: HTTPClientResult::default(),
            task_id,
            retried: 0,
            response_buffer: MutableString::init_empty(),
            package_manager: bun_ptr::BackRef::new(package_manager),
            callback: Callback::LocalTarball,
            next: bun_threading::Link::new(),
            tarball_stream: None,
            streaming_extract_task: None,
            streaming_committed: false,
            signal_store: http::signals::Store::default(),
        })
    }
}

bun_http::http_thread_context!(NetworkTask);

/// The HTTP thread owns a `NetworkTask` while its request is in flight
/// (`PackageManager::flush_network_queue` → `bun_http::schedule_owned_request`)
/// and hands it back through here.
impl http::OwnedRequestContext for NetworkTask {
    fn request_mut(&mut self) -> &mut http::OwnedRequest {
        self.http_mut()
    }

    /// A body chunk of a streamed tarball download (`has_more`). Only
    /// requests built with the `response_body_streaming` signal get these.
    /// `result.body` borrows the HTTP client's scratch buffer and is cleared
    /// after this returns, so it is consumed here.
    fn on_progress(&mut self, mut result: HTTPClientResult<'_>) {
        let Some(stream) = self.tarball_stream.clone() else {
            self.stash_body(&mut result);
            return;
        };
        self.record_streaming_head(&stream, &mut result);
        let chunk = result.body_bytes();
        if self.streaming_committed || self.can_stream(&stream, &result) {
            if !chunk.is_empty() {
                // The drain task is scheduled by `on_chunk` (guarded by its own
                // `draining` atomic) so it runs at most once at a time, releases
                // the worker on ARCHIVE_RETRY, and is re-enqueued by the next
                // chunk. Pending-task accounting stays balanced:
                // `TarballStream::finish()` publishes exactly one of the extract
                // Task (to `resolve_tasks`) or, when the connection failed
                // mid-body, this NetworkTask (to `async_network_task_queue`).
                self.streaming_committed = true;
                stream.on_chunk(chunk);
            }
            return;
        }
        // Non-2xx response (or too small to stream) still delivering its body:
        // accumulate in `response_buffer` so the main thread can inspect it.
        self.response_buffer.list.extend_from_slice(chunk);
    }

    fn on_done(mut self: Box<Self>, mut result: HTTPClientResult<'_>) {
        if let Some(stream) = self.tarball_stream.clone() {
            self.record_streaming_head(&stream, &mut result);
            if self.streaming_committed {
                // Hand over the last bytes and ourselves; the drain task runs
                // once more, finishes up and publishes the extract Task (which
                // then owns this network task) to `resolve_tasks`.
                let err = result.fail.map(crate::Error::from);
                TarballStream::on_last_chunk(stream, self, result.body_bytes(), err);
                return;
            }
            // Whole body arrived in one go, too small, or an error status:
            // the buffered extractor / retry logic in `run_tasks` handles it
            // exactly as it would without streaming support.
        }

        self.stash_body(&mut result);
        // Metadata captured on an earlier streaming callback; the final
        // `result` won't have it.
        let saved_metadata = self.response.metadata.take();
        self.response = result.without_body();
        if self.response.metadata.is_none() {
            self.response.metadata = saved_metadata;
        }
        let shared = self.package_manager.get().shared;
        shared.async_network_task_queue.push(self);
        shared.wake();
    }
}

impl NetworkTask {
    /// Move this callback's body bytes into `response_buffer`.
    fn stash_body(&mut self, result: &mut HTTPClientResult<'_>) {
        if result.metadata.is_some() {
            // First callback of a fresh attempt — clear stale bytes from a
            // prior retry.
            self.response_buffer.reset();
        }
        result.body_into(&mut self.response_buffer.list);
    }

    /// `metadata` is only populated on the first callback that carries
    /// response headers; keep the status code for later chunk callbacks.
    fn record_streaming_head(&mut self, stream: &TarballStream, result: &mut HTTPClientResult<'_>) {
        if let Some(m) = result.metadata.take() {
            let content_length = match result.body_size {
                http::BodySize::ContentLength(len) => Some(len),
                _ => None,
            };
            stream.set_response_head(m.response.status_code, content_length);
            // New attempt's headers arrived — drop any bytes buffered from a
            // prior failed attempt.
            self.response.metadata = Some(m);
            self.response_buffer.reset();
        }
    }

    /// Only commit to streaming extraction once we've seen a 2xx status *and*
    /// the tarball is large enough to be worth the overhead. For small bodies,
    /// or any 4xx/5xx / transport error, the buffered path keeps the existing
    /// retry and error-reporting code in `run_tasks` working.
    fn can_stream(&self, stream: &TarballStream, result: &HTTPClientResult<'_>) -> bool {
        let status_code = stream.status_code();
        let ok_status = (200..=299).contains(&status_code);
        let big_enough = match result.body_size {
            http::BodySize::ContentLength(len) => len >= TarballStream::min_size(),
            // No Content-Length (chunked encoding): we can't know up front, so
            // stream — it avoids an unbounded buffer.
            _ => true,
        };
        ok_status && big_enough && result.fail.is_none()
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
        log: &mut bun_ast::Log,
        env: &bun_dotenv::Loader,
        name: &[u8],
        scope: &npm::registry::Scope,
        loaded_manifest: Option<&PackageManifest>,
        is_optional: bool,
        needs_extended: bool,
    ) -> Result<(), ForManifestError> {
        let url_buf: Box<[u8]> = 'blk: {
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

        // `client.if_modified_since` must point into memory the request owns,
        // so a copy of `last_modified` rides at the end of the header buffer.
        let mut if_modified_since: Option<core::ops::Range<usize>> = None;
        let mut header_buf: Box<[u8]> = Box::default();
        let static_headers_buf: Option<&'static [u8]> = if header_builder.header_count > 0 {
            let accept_header = if needs_extended {
                ACCEPT_HEADER_VALUE_EXTENDED
            } else {
                ACCEPT_HEADER_VALUE
            };
            header_builder.count("Accept", accept_header);
            let trailing_last_modified = !last_modified.is_empty();
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
                if_modified_since =
                    Some(last_modified_start..last_modified_start + last_modified.len());
            }
            debug_assert_eq!(header_builder.content.len, header_builder.content.cap);
            header_buf = header_builder.content.move_to_slice();
            None
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
            Some(header_buf.as_bytes())
        };

        self.response_buffer = MutableString::init(0)?;

        let proxy_url = env
            .get_http_proxy_for(&URL::parse(&url_buf))
            .map(|proxy| Box::<[u8]>::from(proxy.href));
        let force_last_modified = if_modified_since.is_some()
            && bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304
                .get()
                .unwrap_or(false);
        self.http = Some(http::OwnedRequest::new(
            OwnedRequestBuffers {
                url: url_buf,
                headers: header_buf,
                proxy_url,
            },
            http::Method::GET,
            header_builder.entries,
            static_headers_buf,
            http::FetchRedirect::Follow,
            AsyncHTTPOptions::default(),
            // Incase the ETag causes invalidation, we fallback to the last modified date.
            if force_last_modified {
                if_modified_since
            } else {
                None
            },
        ));
        self.http_mut().client_flags_mut().reject_unauthorized = env.get_tls_reject_unauthorized();
        if force_last_modified {
            self.http_mut().client_flags_mut().force_last_modified = true;
        }

        if PackageManager::verbose_install() {
            self.http_mut().set_verbose(HTTPVerboseLevel::Headers);
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
            self.http_mut().set_verbose(HTTPVerboseLevel::Headers);
        }

        Ok(())
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
        log: &mut bun_ast::Log,
        env: &bun_dotenv::Loader,
        string_bytes: &[u8],
        tarball_: ExtractTarball,
        scope: &npm::registry::Scope,
        authorization: Authorization,
    ) -> Result<(), ForTarballError> {
        let tarball_url = tarball_.url.slice();
        let mut url_buf: Box<[u8]> = if tarball_url.is_empty() {
            let version = tarball_.resolution.npm().version;
            Box::from(extract_tarball::build_url(
                scope.url.href(),
                &tarball_.name,
                version,
                string_bytes,
            )?)
        } else {
            // Owning the copy (rather than aliasing `tarball.url`)
            // avoids a self-reference into `callback`.
            Box::<[u8]>::from(tarball_url)
        };
        self.callback = Callback::Extract(tarball_);
        let Callback::Extract(tarball) = &self.callback else {
            unreachable!()
        };

        if !(url_buf.starts_with(b"https://") || url_buf.starts_with(b"http://")) {
            log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "Expected tarball URL to start with https:// or http://, got {} while fetching package {}",
                    quote(&url_buf),
                    quote(tarball.name.slice()),
                ),
            );
            return Err(ForTarballError::InvalidURL);
        }

        // Userinfo becomes a header and leaves the URL: `bun_url` keeps it in `origin`, which the redirect same-origin check compares.
        let url_authorization: Option<Vec<u8>> = match split_url_userinfo(&url_buf) {
            Some((userinfo, url_without_userinfo)) => {
                let value =
                    (!userinfo.is_empty()).then(|| basic_authorization_from_userinfo(userinfo));
                url_buf = url_without_userinfo;
                value
            }
            None => None,
        };

        // Only attach the registry `Authorization` header when the tarball URL
        // origin matches the configured registry scope origin. The npm manifest
        // is registry-controlled, so a malicious registry could otherwise point
        // the tarball at an attacker-controlled host and receive the scope
        // credentials. The empty-`tarball_url` branch builds the URL from
        // `scope.url.href()`, so its origin matches and authorized downloads
        // keep working.
        // Compare (protocol, hostname, effective port) rather than the raw
        // `URL.origin` slice — `origin` is a borrowed prefix of the input
        // string and is not normalized for default ports, so a tarball URL of
        // `https://host:443/...` would not byte-match a `.npmrc` registry of
        // `https://host/...` even though they are the same origin. Some
        // registries emit `dist.tarball` URLs with the default port spelled
        // out; without normalization those installs lose the `Authorization`
        // header and fail with 401.
        let send_auth = matches!(authorization, Authorization::AllowAuthorization) && {
            let tarball = URL::parse(&url_buf);
            let registry = scope.url.url();
            tarball.protocol == registry.protocol
                && tarball.hostname == registry.hostname
                && tarball.get_port_auto() == registry.get_port_auto()
        };

        self.response_buffer = MutableString::init_empty();

        let mut header_builder = HeaderBuilder::default();

        if send_auth {
            count_auth(&mut header_builder, scope);
        }

        // Registry credentials win over URL userinfo, as in npm.
        let url_authorization = match url_authorization {
            Some(value) if header_builder.header_count == 0 => {
                header_builder.count("Authorization", &value);
                Some(value)
            }
            _ => None,
        };

        let header_buf: Box<[u8]> = if header_builder.header_count > 0 {
            header_builder.allocate()?;
            match &url_authorization {
                Some(value) => header_builder.append("Authorization", value),
                None => append_auth(&mut header_builder, scope),
            }
            debug_assert_eq!(header_builder.content.len, header_builder.content.cap);
            header_builder.content.move_to_slice()
        } else {
            Box::default()
        };

        let proxy_url = env
            .get_http_proxy_for(&URL::parse(&url_buf))
            .map(|proxy| Box::<[u8]>::from(proxy.href));
        let mut http_options = AsyncHTTPOptions::default();

        if extract_tarball::uses_streaming_extraction() {
            // Tell the HTTP client to report every body chunk (`on_progress`,
            // then `on_done`) instead of buffering the whole response. Those
            // push each chunk into `tarball_stream`, which schedules a drain task on
            // `thread_pool`; the drain task calls into libarchive until it
            // reports ARCHIVE_RETRY (out of input), then returns so the
            // worker can be reused for other install work. The next chunk
            // reschedules it and libarchive — whose state lives on the heap
            // — resumes exactly where it stopped.
            //
            // The stream itself is created by the caller (see
            // `generate_network_task_for_tarball`) because it needs the
            // `Task` (`streaming_extract_task`) that carries the final result.
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

        self.http = Some(http::OwnedRequest::new(
            OwnedRequestBuffers {
                url: url_buf,
                headers: header_buf,
                proxy_url,
            },
            http::Method::GET,
            header_builder.entries,
            None,
            http::FetchRedirect::Follow,
            http_options,
            None,
        ));
        self.http_mut().client_flags_mut().reject_unauthorized = env.get_tls_reject_unauthorized();
        if PackageManager::verbose_install() {
            self.http_mut().set_verbose(HTTPVerboseLevel::Headers);
        }

        Ok(())
    }

    /// Release any streaming-extraction resources that were never used because
    /// the request errored before a drain was scheduled. Called on the main
    /// thread from `run_tasks` when falling back to the buffered path.
    pub(crate) fn discard_unused_streaming_state(&mut self) {
        debug_assert!(!self.streaming_committed);
        drop(self.tarball_stream.take());
        drop(self.streaming_extract_task.take());
    }

    /// Prepare this task for another HTTP attempt. A stream that never ran is
    /// reused; one consumed by a download that failed mid-body (released in
    /// `TarballStream::finish`) is replaced, keeping the same extract Task.
    pub(crate) fn reset_streaming_for_retry(&mut self) {
        debug_assert!(!self.streaming_committed);
        if let Some(stream) = self.tarball_stream.as_deref() {
            stream.reset_for_retry();
        } else if let Some(extract_task) = self.streaming_extract_task.take() {
            self.tarball_stream = Some(TarballStream::new(extract_task, self.package_manager));
        }
        self.response = HTTPClientResult::default();
    }
}

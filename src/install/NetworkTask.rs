use std::borrow::Cow;

use crate::bun_fs::{FileSystem, FilenameStore};
use bun_collections::{AtomicHiveArray, HasStaticHive, HashMap, HiveBox};
use bun_core::fmt::{quote, redacted_npm_url};
use bun_core::{self, MutableString, strings};
use bun_http::headers::api::StringPointer;
use bun_http::{
    self as http, HTTPClientResult, HTTPVerboseLevel, HeaderBuilder, OwnedRequest,
    async_http::Options as AsyncHTTPOptions,
};
use bun_url::{PercentEncoding, URL};
use std::io::Write as _;

use crate::extract_tarball;
use crate::npm::{self as npm, PackageManifest};
use crate::package_manager::{INBOX, InstallFields};
use crate::package_manager_task::Id as TaskId;
use crate::{ExtractTarball, PackageManager, TarballStream};

struct FilenameStoreAppender<'a>(&'a FilenameStore);
impl strings::Appender for FilenameStoreAppender<'_> {
    fn append(&mut self, s: &[u8]) -> Result<&'static [u8], bun_alloc::AllocError> {
        self.0.append(s)
    }
}

/// `bytes`, copied into the global filename store unless they fit inline.
pub(crate) fn stored_string(bytes: &[u8]) -> strings::StringOrTinyString {
    strings::StringOrTinyString::init_append_if_needed(
        bytes,
        &mut FilenameStoreAppender(FileSystem::get().filename_store()),
    )
    .expect("unreachable")
}

pub struct NetworkTask {
    /// `None` while the HTTP thread has it.
    request: Option<OwnedRequest>,
    pub(crate) response: HTTPClientResult<'static>,
    pub(crate) task_id: TaskId,
    pub(crate) retried: u16,
    pub(crate) response_buffer: MutableString,
    pub(crate) callback: Callback,
    next: bun_threading::Link<NetworkTask>,
    /// Set once the response is known to be extracted while it downloads.
    tarball_stream: Option<TarballStream>,
}

static HIVE: [AtomicHiveArray<NetworkTask>; 2] = [const { AtomicHiveArray::new() }; 2];

impl HasStaticHive for NetworkTask {
    const HIVE: &'static [AtomicHiveArray<Self>] = &HIVE;
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

/// What the response is for. A git clone or checkout is never a network task.
pub enum Callback {
    PackageManifest {
        loaded_manifest: Option<PackageManifest>,
        name: strings::StringOrTinyString,
        is_extended_manifest: bool,
        registry: npm::registry::ManifestCacheKey,
    },
    Extract(ExtractTarball),
}

#[derive(Default, Clone, Copy)]
pub struct DedupeMapEntry {
    pub(crate) is_required: bool,
    /// Set once the download/extract for this task id has terminally failed so a
    /// later `enqueue_download` can observe the failure instead of
    /// re-scheduling the entire network task (and its retry cycle) a second time.
    pub(crate) failed: bool,
    pub(crate) manifest: ManifestOrigin,
    /// The event loop iteration in which a runtime lookup of this manifest found nothing, or in
    /// which the task failed.
    pub(crate) missed_in: Option<u64>,
    /// `Registry::manifest_expiry` of a 404: a runtime lookup does not ask again before.
    pub(crate) missing_until: u32,
}

/// Where a manifest came from. If a cached copy doesn't have a version, the version may have been
/// published since.
#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub enum ManifestOrigin {
    /// The disk cache, also after a 304.
    #[default]
    Cache,
    /// `refetch_stale_manifest` asked for it again without conditional headers.
    Refetching,
    /// The registry sent the document in this run, so a version that it doesn't have doesn't exist.
    Registry,
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

impl http::HTTPClientResultHandler<HiveBox<Self>> for NetworkTask {
    fn on_progress(&mut self, mut result: HTTPClientResult<'_>) {
        // Metadata only arrives with the first result of an attempt.
        if let Some(metadata) = result.metadata.take() {
            self.response.metadata = Some(metadata);
            self.response_buffer.reset();
        }
        let chunk = result.body_bytes();
        if let Some(stream) = &self.tarball_stream {
            stream.on_chunk(chunk);
        } else if let Callback::Extract(tarball) = &self.callback
            && self.should_stream(&result)
        {
            if !chunk.is_empty() {
                let stream = TarballStream::init(tarball, result.body_size);
                self.tarball_stream.insert(stream).on_chunk(chunk);
            }
        } else {
            self.response_buffer.list.extend_from_slice(chunk);
        }
    }

    fn on_done(mut this: HiveBox<Self>, request: OwnedRequest, mut result: HTTPClientResult<'_>) {
        this.request = Some(request);
        if let Some(stream) = this.tarball_stream.take() {
            this.response.fail = result.fail;
            stream.on_last_chunk(result.body_bytes(), this);
            return;
        }
        if result.metadata.is_some() {
            // Discard the body of an earlier attempt.
            this.response_buffer.reset();
        } else {
            result.metadata = this.response.metadata.take();
        }
        result.body_into(&mut this.response_buffer.list);
        this.response = result.without_borrowed_body();
        INBOX.network_tasks.push(this);
        INBOX.wake();
    }
}

impl NetworkTask {
    fn new(task_id: TaskId, request: OwnedRequest, callback: Callback) -> HiveBox<Self> {
        HiveBox::new(NetworkTask {
            request: Some(request),
            response: HTTPClientResult::default(),
            task_id,
            retried: 0,
            response_buffer: MutableString::init_empty(),
            callback,
            next: bun_threading::Link::new(),
            tarball_stream: None,
        })
    }

    /// A small body, an error status and a transport error are buffered for `run_tasks`.
    fn should_stream(&self, result: &HTTPClientResult<'_>) -> bool {
        (self.response.metadata.as_ref()).is_some_and(|m| matches!(m.status_code(), 200..=299))
            && result.fail.is_none()
            && match result.body_size {
                http::BodySize::ContentLength(len) => len >= TarballStream::min_size(),
                // No Content-Length (chunked encoding): we can't know up
                // front, so stream — it avoids an unbounded buffer.
                _ => true,
            }
    }

    pub(crate) fn request(&self) -> &OwnedRequest {
        self.request.as_ref().expect("not in flight")
    }

    /// The task comes back through `INBOX`.
    pub(crate) fn into_request(mut this: HiveBox<Self>) -> OwnedRequest {
        let mut request = this.request.take().expect("not in flight");
        request.set_result_handler(this);
        request
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

/// The result of `Scope::authorization_parts` for the request's URL.
type AuthorizationParts<'a> = Option<(&'static [u8], &'a [u8])>;

fn append_auth(header_builder: &mut HeaderBuilder, authorization: AuthorizationParts<'_>) {
    // Routing through `format_args!`/`BStr` Display would be
    // lossy for non-UTF-8 tokens (U+FFFD expands 1→3 bytes) and overrun the
    // exact byte count reserved by `count_auth`. Use raw-byte append.
    let Some((scheme, value)) = authorization else {
        return;
    };
    header_builder.append_bytes_value("Authorization", scheme, value);
    header_builder.append("npm-auth-type", "legacy");
}

fn count_auth(header_builder: &mut HeaderBuilder, authorization: AuthorizationParts<'_>) {
    let Some((scheme, value)) = authorization else {
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
    // npm reads a tarball URL with `new URL()`, so the authority ends where that ends.
    let at = URL::parse(url).userinfo_end(rest, bun_url::AuthorityEnd::LikeNewURL)?;

    let mut without_userinfo = Vec::with_capacity(url.len() - (at + 1));
    without_userinfo.extend_from_slice(&url[..authority_start]);
    without_userinfo.extend_from_slice(&rest[at + 1..]);
    Some((&rest[..at], without_userinfo.into_boxed_slice()))
}

/// The userinfo percent-decoded, as curl and node's `http.get` send it. `user` means `user:`.
fn basic_authorization_from_userinfo(userinfo: &[u8]) -> Vec<u8> {
    const SCHEME: &[u8] = b"Basic ";
    let mut user_pass = PercentEncoding::decode_lenient_alloc(userinfo).into_vec();
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

pub(crate) fn add_error_or_warning(
    log: &bun_ast::Log,
    is_error: bool,
    message: core::fmt::Arguments<'_>,
) {
    if is_error {
        log.add_error_fmt(None, bun_ast::Loc::EMPTY, message);
    } else {
        log.add_warning_fmt(None, bun_ast::Loc::EMPTY, message);
    }
}

/// Redact before calling `quote()`, because the password scan only recognizes an unquoted URL.
fn redacted_url(url: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let _ = write!(out, "{}", redacted_npm_url(url));
    out
}

/// The options that manifest and tarball requests share.
fn new_request(
    manager: &InstallFields<'_>,
    url: Box<[u8]>,
    headers: http::headers::EntryList,
    headers_buf: Cow<'static, [u8]>,
    response_body_streaming: bool,
    yields_to_other_requests: bool,
) -> OwnedRequest {
    OwnedRequest::new(
        Cow::Owned(url.into_vec()),
        headers,
        headers_buf,
        response_body_streaming,
        AsyncHTTPOptions {
            proxy_settings: manager.state.proxy_settings(),
            idle_timeout_seconds: manager.idle_timeout_seconds(),
            reject_unauthorized: Some(manager.state.env().get_tls_reject_unauthorized()),
            verbose: PackageManager::verbose_install().then_some(HTTPVerboseLevel::Headers),
            redirect_credentials: Some(http::RedirectCredentialsPolicy::HttpsUpgrade),
            yields_to_other_requests,
            ..Default::default()
        },
    )
}

impl NetworkTask {
    /// `needs_extended` means the caller can't use the abbreviated document.
    pub(crate) fn for_manifest(
        manager: &InstallFields<'_>,
        log: &bun_ast::Log,
        task_id: TaskId,
        name: &[u8],
        loaded_manifest: Option<PackageManifest>,
        is_optional: bool,
        needs_extended: bool,
    ) -> Result<HiveBox<Self>, ForManifestError> {
        let scope = manager.options.scope_for_package_name(name);
        let is_extended_manifest = needs_extended || npm::name_suggests_libc(name);
        let request = Self::manifest_request(
            manager,
            log,
            name,
            scope,
            loaded_manifest.as_ref(),
            is_optional,
            is_extended_manifest,
        )?;
        let callback = Callback::PackageManifest {
            name: stored_string(name),
            loaded_manifest,
            is_extended_manifest,
            registry: scope.manifest_cache_key(),
        };
        Ok(Self::new(task_id, request, callback))
    }

    /// The full document could not be downloaded and only `libc` is lost without it.
    pub(crate) fn retry_with_abbreviated_manifest(
        &mut self,
        manager: &InstallFields<'_>,
        log: &bun_ast::Log,
        is_optional: bool,
    ) -> Result<(), ForManifestError> {
        let Callback::PackageManifest {
            name,
            loaded_manifest,
            is_extended_manifest,
            ..
        } = &mut self.callback
        else {
            unreachable!("not a manifest task")
        };
        *is_extended_manifest = false;
        self.response_buffer = MutableString::init_empty();
        self.request = Some(Self::manifest_request(
            manager,
            log,
            name.slice(),
            manager.options.scope_for_package_name(name.slice()),
            loaded_manifest.as_ref(),
            is_optional,
            false,
        )?);
        Ok(())
    }

    fn manifest_request(
        manager: &InstallFields<'_>,
        log: &bun_ast::Log,
        name: &[u8],
        scope: &npm::registry::Scope,
        loaded_manifest: Option<&PackageManifest>,
        is_optional: bool,
        needs_extended: bool,
    ) -> Result<OwnedRequest, ForManifestError> {
        let url = 'blk: {
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

            // A "/"-terminated base makes the WHATWG join append the name.
            let registry_href = scope.url.href();
            let base_storage;
            let base: &[u8] = if scope.url.url().has_http_like_protocol() {
                let path_end =
                    strings::index_of_any(registry_href, b"?#").unwrap_or(registry_href.len());
                base_storage = [
                    strings::without_trailing_slash(&registry_href[..path_end]),
                    b"/",
                ]
                .concat();
                &base_storage
            } else {
                registry_href
            };

            // The join would read bytes that are not UTF-8 as U+FFFD, which is another name.
            let tmp = if strings::is_valid_utf8(encoded_name) {
                bun_url::join(
                    &bun_core::StringView::borrow_utf8(base),
                    &bun_core::StringView::borrow_utf8(encoded_name),
                )
            } else {
                bun_core::String::DEAD
            };

            if tmp.tag() == bun_core::Tag::Dead {
                add_error_or_warning(
                    log,
                    !is_optional,
                    format_args!(
                        "Failed to join registry {} and package {} URLs",
                        quote(&redacted_url(scope.url.href())),
                        quote(name),
                    ),
                );
                return Err(ForManifestError::InvalidURL);
            }

            // This actually duplicates the string! The WTF managed one above drops at scope exit.
            let url_bytes = tmp.to_owned_slice().into_boxed_slice();

            if !(tmp.starts_with_ascii(b"https://") || tmp.starts_with_ascii(b"http://")) {
                add_error_or_warning(
                    log,
                    !is_optional,
                    format_args!(
                        "Registry URL must be http:// or https://\nReceived: {}",
                        quote(&redacted_url(&url_bytes))
                    ),
                );
                return Err(ForManifestError::InvalidURL);
            }

            {
                let joined = URL::parse(&url_bytes);
                // The base the join used, so that ".." cannot escape a slash-less registry path.
                let registry = URL::parse(base);
                let registry_dir_end =
                    strings::last_index_of_char(registry.pathname, b'/').map_or(0, |i| i + 1);
                let registry_dir = &registry.pathname[..registry_dir_end];
                if !joined.protocol.eq_ignore_ascii_case(registry.protocol)
                    || !joined.hostname.eq_ignore_ascii_case(registry.hostname)
                    || joined.get_port_auto() != registry.get_port_auto()
                    || !joined.pathname.starts_with(registry_dir)
                {
                    add_error_or_warning(
                        log,
                        !is_optional,
                        format_args!(
                            "invalid package name {}: manifest URL {} is not on registry {}",
                            quote(name),
                            quote(&redacted_url(&url_bytes)),
                            quote(&redacted_url(scope.url.href())),
                        ),
                    );
                    return Err(ForManifestError::InvalidURL);
                }
            }

            break 'blk url_bytes;
        };

        let mut last_modified: &[u8] = b"";
        let mut etag: &[u8] = b"";
        if let Some(manifest) = loaded_manifest {
            if (needs_extended && manifest.pkg.has_extended_manifest()) || !needs_extended {
                last_modified = manifest.pkg.last_modified.slice(&manifest.string_buf);
                etag = manifest.pkg.etag.slice(&manifest.string_buf);
            }
        }

        let authorization = scope.authorization_parts(&URL::parse(&url));

        let mut header_builder = HeaderBuilder::default();

        count_auth(&mut header_builder, authorization);

        if !etag.is_empty() {
            header_builder.count("If-None-Match", etag);
        } else if !last_modified.is_empty() {
            header_builder.count("If-Modified-Since", last_modified);
        }

        // Left empty if `If-Modified-Since` is sent: the client then takes it from the headers.
        let mut if_modified_since = StringPointer::default();
        let headers_buf = if header_builder.header_count > 0 {
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

            append_auth(&mut header_builder, authorization);

            if !etag.is_empty() {
                header_builder.append("If-None-Match", etag);
            } else if !last_modified.is_empty() {
                header_builder.append("If-Modified-Since", last_modified);
            }

            header_builder.append("Accept", accept_header);

            if trailing_last_modified {
                if_modified_since = StringPointer {
                    offset: header_builder.content.len as u32,
                    length: last_modified.len() as u32,
                };
                let _ = header_builder.content.append(last_modified);
            }
            debug_assert_eq!(header_builder.content.len, header_builder.content.cap);
            Cow::Owned(header_builder.content.move_to_slice().into_vec())
        } else {
            let header_buf: &'static str = if needs_extended {
                EXTENDED_HEADERS_BUF
            } else {
                DEFAULT_HEADERS_BUF
            };
            header_builder.entries.append(http::headers::Entry {
                name: StringPointer {
                    offset: 0,
                    length: "Accept".len() as u32,
                },
                value: StringPointer {
                    offset: "Accept".len() as u32,
                    length: (header_buf.len() - "Accept".len()) as u32,
                },
            })?;
            Cow::Borrowed(header_buf.as_bytes())
        };

        let mut request = new_request(
            manager,
            url,
            header_builder.entries,
            headers_buf,
            false,
            false,
        );

        // Incase the ETag causes invalidation, we fallback to the last modified date.
        if !last_modified.is_empty()
            && bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304
                .get()
                .unwrap_or(false)
        {
            request.set_if_modified_since(if_modified_since);
        }

        Ok(request)
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
    /// Returned by `enqueue_install_task` when the dedupe map already records
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
    pub(crate) fn tarball(&self) -> &ExtractTarball {
        let Callback::Extract(tarball) = &self.callback else {
            unreachable!("not a tarball task")
        };
        tarball
    }

    pub(crate) fn for_tarball(
        manager: &InstallFields<'_>,
        log: &bun_ast::Log,
        task_id: TaskId,
        tarball: ExtractTarball,
        scope: &npm::registry::Scope,
        authorization: Authorization,
    ) -> Result<HiveBox<Self>, ForTarballError> {
        let tarball_url = tarball.url.slice();
        let built_from_registry_url = tarball_url.is_empty();
        let mut url_buf = if built_from_registry_url {
            // SAFETY: `value` is the `Npm` variant on this code path —
            // `for_tarball` is only reached for npm tarball downloads
            // (callers gate on `resolution.tag == .npm`).
            let version = tarball.resolution.npm().version;
            Box::from(extract_tarball::build_url(
                scope.url.href(),
                tarball.name.slice(),
                version,
                manager.lockfile.buffers.string_bytes.as_slice(),
            )?)
        } else {
            Box::<[u8]>::from(tarball_url)
        };

        if !(url_buf.starts_with(b"https://") || url_buf.starts_with(b"http://")) {
            let redacted_tarball_url = redacted_url(&url_buf);
            log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "Expected tarball URL to start with https:// or http://, got {} while fetching package {}",
                    bun_core::fmt::EscapeControlChars(quote(&redacted_tarball_url)),
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

        // One parse decides the authority, the wire path and the `.npmrc` key.
        let normalized = if built_from_registry_url {
            npm::registry::is_normalized_tarball_url(&url_buf)
        } else if let Some(normalized) = npm::registry::normalize_tarball_url(&url_buf) {
            url_buf = normalized;
            true
        } else {
            false
        };

        let credentials = match authorization {
            Authorization::NoAuthorization => None,
            Authorization::AllowAuthorization => {
                let url = URL::parse(&url_buf);
                manager
                    .options
                    .tarball_credentials(scope, &url, normalized)
                    .and_then(|credentials| credentials.authorization_parts(&url))
            }
        };

        let mut header_builder = HeaderBuilder::default();

        // Configured credentials win over the URL's userinfo, as in npm.
        match (credentials, &url_authorization) {
            (Some(_), _) => {
                count_auth(&mut header_builder, credentials);
                header_builder.allocate()?;
                append_auth(&mut header_builder, credentials);
            }
            (None, Some(value)) => {
                header_builder.count("Authorization", value);
                header_builder.allocate()?;
                header_builder.append("Authorization", value);
            }
            (None, None) => {}
        }
        debug_assert_eq!(header_builder.content.len, header_builder.content.cap);
        let headers_buf = Cow::Owned(header_builder.content.move_to_slice().into_vec());

        // A manifest says what else has to be fetched, so a burst of tarballs must not hold it up.
        let yields_to_other_requests = true;
        let request = new_request(
            manager,
            url_buf,
            header_builder.entries,
            headers_buf,
            extract_tarball::uses_streaming_extraction(),
            yields_to_other_requests,
        );

        Ok(Self::new(task_id, request, Callback::Extract(tarball)))
    }
}

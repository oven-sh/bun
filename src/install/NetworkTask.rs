use core::ptr;
use core::sync::atomic::Ordering;

use bstr::{BStr, ByteSlice};

use bun_collections::HashMap;
use bun_core::{self, fmt::QuotedFormatter, StringBuilder as GlobalStringBuilder};
use bun_http::{self as http, AsyncHTTP, HeaderBuilder, HTTPClientResult};
use bun_logger as logger;
use bun_str::{self, strings, MutableString};
use bun_threading::ThreadPool;
use bun_url::URL;
use bun_fs::FileSystem;

use crate::npm::{self as npm, PackageManifest};
use crate::{ExtractTarball, PackageManager, PatchTask, TarballStream, Task};

pub struct NetworkTask {
    pub unsafe_http_client: AsyncHTTP,
    pub response: HTTPClientResult,
    pub task_id: crate::task::Id,
    // TODO(port): owned in `for_manifest` (toOwnedSlice) but borrowed from
    // `tarball.url` in `for_tarball`; Zig leaks/aliases — verify ownership in Phase B.
    pub url_buf: Box<[u8]>,
    pub retried: u16,
    // Zig: `allocator: std.mem.Allocator` — dropped (global mimalloc); see §Allocators.
    pub request_buffer: MutableString,
    pub response_buffer: MutableString,
    // BACKREF: PackageManager owns this task via `preallocated_network_tasks`.
    // TODO(port): TSV classifies as *const, but Zig mutates through it (wake/log/push) —
    // verify interior mutability on PackageManager or widen to *mut in Phase B.
    pub package_manager: *const PackageManager,
    pub callback: Callback,
    /// Key in patchedDependencies in package.json
    pub apply_patch_task: Option<Box<PatchTask>>,
    pub next: *mut NetworkTask,

    /// Producer/consumer buffer that feeds tarball bytes from the HTTP thread
    /// to a worker running libarchive. `None` when streaming extraction is
    /// disabled or this task is not a tarball download.
    pub tarball_stream: Option<Box<TarballStream>>,
    /// Extract `Task` pre-created on the main thread so the HTTP thread can
    /// schedule it on the worker pool as soon as the first body chunk arrives.
    pub streaming_extract_task: *mut Task,
    /// Set by the HTTP thread the first time it commits this request to
    /// the streaming path. Once true, `notify` never pushes this task to
    /// `async_network_task_queue` — the extract Task published by
    /// `TarballStream.finish()` owns the NetworkTask's lifetime instead
    /// (its `resolve_tasks` handler returns it to the pool). Also read by
    /// the main-thread fallback / retry paths in `runTasks.zig` to assert
    /// the stream was never started.
    pub streaming_committed: bool,
    /// Backing store for the streaming signal the HTTP client polls.
    pub signal_store: http::signals::Store,
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

pub struct DedupeMapEntry {
    pub is_required: bool,
}
// Zig: `std.HashMap(Task.Id, DedupeMapEntry, IdentityContext(Task.Id), 80)`
// TODO(port): IdentityContext (hash = value bits) + 80% load factor — verify
// `bun_collections::HashMap` exposes an identity hasher, or newtype `task::Id`
// with a pass-through `Hash` impl.
pub type DedupeMap = HashMap<crate::task::Id, DedupeMapEntry>;

impl NetworkTask {
    pub fn notify(&mut self, async_http: &mut AsyncHTTP, result: HTTPClientResult) {
        if let Some(stream) = self.tarball_stream.as_deref_mut() {
            // Runs on the HTTP thread. With response-body streaming enabled,
            // `notify` is called once per body chunk (has_more=true) and once
            // more at the end (has_more=false). `result.body` is our own
            // `response_buffer`; the HTTP client reuses it for the next
            // chunk, so we must consume + reset it before returning.

            // `metadata` is only populated on the first callback that
            // carries response headers. Cache the status code so both the
            // main thread and later chunk callbacks can see it.
            if let Some(m) = &result.metadata {
                self.response.metadata = Some(m.clone());
                stream.status_code = m.response.status_code;
            }

            let chunk = self.response_buffer.list.as_slice();

            // Only commit to streaming extraction once we've seen a 2xx
            // status *and* the tarball is large enough to be worth the
            // overhead. For small bodies, or any 4xx/5xx / transport error,
            // fall back to the buffered path so the existing retry and
            // error-reporting code in runTasks.zig keeps working.
            let ok_status = stream.status_code >= 200 && stream.status_code <= 299;
            let big_enough = match result.body_size {
                http::BodySize::ContentLength(len) => len >= TarballStream::min_size(),
                // No Content-Length (chunked encoding): we can't know up
                // front, so stream — it avoids an unbounded buffer.
                _ => true,
            };
            let committed = self.streaming_committed;

            if committed || (ok_status && big_enough && result.fail.is_none()) {
                if result.has_more {
                    if !chunk.is_empty() {
                        // The drain task is scheduled by `onChunk`
                        // (guarded by its own `draining` atomic) so it
                        // runs at most once at a time, releases the
                        // worker on ARCHIVE_RETRY, and is re-enqueued by
                        // the next chunk. Pending-task accounting stays
                        // balanced: this NetworkTask is never pushed to
                        // `async_network_task_queue` once committed, so
                        // its `incrementPendingTasks()` is satisfied by
                        // the extract Task that `TarballStream.finish()`
                        // publishes to `resolve_tasks`.
                        self.streaming_committed = true;
                        stream.on_chunk(chunk, false, None);
                        // Hand the buffer back to the HTTP client empty so
                        // the next chunk starts at offset 0.
                        self.response_buffer.reset();
                    }
                    return;
                }

                // Final callback. If we've already started streaming, hand
                // over the last bytes and close; the drain task will run
                // once more, finish up and push to `resolve_tasks`. If not
                // (whole body arrived in one go, or too small), leave
                // `response_buffer` intact so the buffered extractor
                // handles it.
                if committed {
                    stream.on_chunk(chunk, true, result.fail);
                    // Do NOT touch `self` — or anything it owns — after
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
                // delivering its body: accumulate in `response_buffer`
                // (we did *not* reset above) so the main thread can
                // inspect it. Do not enqueue until the stream ends.
                return;
            }
            // Fall through to the normal completion path for anything that
            // did not commit: the buffered extractor / retry logic in
            // runTasks.zig handles it exactly as it would without
            // streaming support.
        }

        // SAFETY: BACKREF — PackageManager owns this task and outlives it.
        let pm = unsafe { &*(self.package_manager as *mut PackageManager) };
        // Zig: `defer this.package_manager.wake();` — moved to end of fn (no
        // early returns past this point).

        // SAFETY: `real` is set by the HTTP thread before invoking the
        // completion callback; Zig unwraps with `.?`.
        // TODO(port): Zig does a struct-value copy `real.* = async_http.*` —
        // requires `AsyncHTTP: Clone` or a bitwise copy helper.
        unsafe {
            let real = async_http.real.expect("unreachable");
            ptr::write(real, ptr::read(async_http));
            (*real).response_buffer = async_http.response_buffer;
        }
        // Preserve metadata captured on an earlier streaming callback; the
        // final `result` won't have it.
        let saved_metadata = self.response.metadata.take();
        self.response = result;
        if self.response.metadata.is_none() {
            self.response.metadata = saved_metadata;
        }
        pm.async_network_task_queue.push(self);
        pm.wake();
    }
}

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
        header_builder.append_fmt(
            "Authorization",
            format_args!("Bearer {}", BStr::new(&scope.token)),
        );
    } else if !scope.auth.is_empty() {
        header_builder.append_fmt(
            "Authorization",
            format_args!("Basic {}", BStr::new(&scope.auth)),
        );
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
impl From<bun_alloc::AllocError> for ForManifestError {
    fn from(_: bun_alloc::AllocError) -> Self {
        Self::OutOfMemory
    }
}
impl From<ForManifestError> for bun_core::Error {
    fn from(e: ForManifestError) -> Self {
        match e {
            ForManifestError::OutOfMemory => bun_core::err!(OutOfMemory),
            ForManifestError::InvalidURL => bun_core::err!(InvalidURL),
        }
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
        // SAFETY: BACKREF — PackageManager owns this task and outlives it.
        let pm = unsafe { &*(self.package_manager as *mut PackageManager) };

        self.url_buf = 'blk: {
            // Not all registries support scoped package names when fetching the manifest.
            // registry.npmjs.org supports both "@storybook%2Faddons" and "@storybook/addons"
            // Other registries like AWS codeartifact only support the former.
            // "npm" CLI requests the manifest with the encoded name.
            // PERF(port): was ArenaAllocator + stackFallback(512) — profile in Phase B
            let encoded_name_storage;
            let encoded_name: &[u8] = if strings::index_of_char(name, b'/').is_some() {
                encoded_name_storage = name.replace(b"/", b"%2f");
                &encoded_name_storage
            } else {
                name
            };

            // MOVE_DOWN(b0): bun_jsc::url::join → bun_url::join (WHATWG URL FFI moves out of jsc).
            let tmp = bun_url::join(
                bun_str::String::borrow_utf8(&scope.url.href),
                bun_str::String::borrow_utf8(encoded_name),
            );

            if tmp.tag == bun_str::Tag::Dead {
                if !is_optional {
                    pm.log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "Failed to join registry {} and package {} URLs",
                            QuotedFormatter(&scope.url.href),
                            QuotedFormatter(name),
                        ),
                    );
                } else {
                    pm.log.add_warning_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "Failed to join registry {} and package {} URLs",
                            QuotedFormatter(&scope.url.href),
                            QuotedFormatter(name),
                        ),
                    );
                }
                return Err(ForManifestError::InvalidURL);
            }

            if !(tmp.has_prefix(b"https://") || tmp.has_prefix(b"http://")) {
                if !is_optional {
                    pm.log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "Registry URL must be http:// or https://\nReceived: \"{}\"",
                            tmp
                        ),
                    );
                } else {
                    pm.log.add_warning_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "Registry URL must be http:// or https://\nReceived: \"{}\"",
                            tmp
                        ),
                    );
                }
                return Err(ForManifestError::InvalidURL);
            }

            // This actually duplicates the string! So we defer deref the WTF managed one above.
            break 'blk tmp.to_owned_slice()?;
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
                last_modified = header_builder.content.append(last_modified);
            }
        } else {
            let header_buf: &'static str = if needs_extended {
                EXTENDED_HEADERS_BUF
            } else {
                DEFAULT_HEADERS_BUF
            };
            header_builder.entries.push(http::Header {
                name: http::PointerOffset {
                    offset: 0,
                    length: "Accept".len() as u32,
                },
                value: http::PointerOffset {
                    offset: "Accept".len() as u32,
                    length: (header_buf.len() - "Accept".len()) as u32,
                },
            });
            header_builder.header_count = 1;
            // SAFETY: header_buf is &'static str; GlobalStringBuilder borrows
            // it mutably in type but is never written to on this path.
            header_builder.content = GlobalStringBuilder {
                ptr: header_buf.as_ptr() as *mut u8,
                len: header_buf.len(),
                cap: header_buf.len(),
            };
        }

        self.response_buffer = MutableString::init(0);

        let url = URL::parse(&self.url_buf);
        // TODO(port): narrow error set
        self.unsafe_http_client = AsyncHTTP::init(
            http::Method::GET,
            url,
            header_builder.entries,
            // SAFETY: ptr is non-null on both branches above (allocate() or static buf).
            unsafe {
                core::slice::from_raw_parts(header_builder.content.ptr, header_builder.content.len)
            },
            &mut self.response_buffer,
            b"",
            self.get_completion_callback(),
            http::FetchRedirect::Follow,
            AsyncHTTP::Options {
                http_proxy: pm.http_proxy(url),
                ..Default::default()
            },
        );
        self.unsafe_http_client.client.flags.reject_unauthorized = pm.tls_reject_unauthorized();

        if PackageManager::verbose_install() {
            self.unsafe_http_client.client.verbose = http::Verbose::Headers;
        }

        self.callback = Callback::PackageManifest {
            // TODO(port): `initAppendIfNeeded` takes a comptime `*FilenameStore`
            // type + instance pair — model as a generic over a `StringStore`
            // trait in Phase B.
            name: strings::StringOrTinyString::init_append_if_needed(
                name,
                FileSystem::filename_store_instance(),
            )?,
            loaded_manifest: loaded_manifest.cloned(),
            is_extended_manifest: needs_extended,
        };

        if PackageManager::verbose_install() {
            self.unsafe_http_client.verbose = http::Verbose::Headers;
            self.unsafe_http_client.client.verbose = http::Verbose::Headers;
        }

        // Incase the ETag causes invalidation, we fallback to the last modified date.
        if !last_modified.is_empty()
            && bun_core::feature_flag::BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304.get()
        {
            self.unsafe_http_client.client.flags.force_last_modified = true;
            self.unsafe_http_client.client.if_modified_since = last_modified;
        }

        Ok(())
    }

    pub fn get_completion_callback(&mut self) -> http::HTTPClientResult::Callback {
        // TODO(port): `Callback.New(*NetworkTask, notify).init(this)` is a
        // comptime type-erased thunk generator — model as
        // `Callback::new(self as *mut _, notify_trampoline)` in Phase B.
        http::HTTPClientResult::Callback::new::<NetworkTask>(self, Self::notify)
    }

    pub fn schedule(&mut self, batch: &mut ThreadPool::Batch) {
        self.unsafe_http_client.schedule(batch);
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ForTarballError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidURL")]
    InvalidURL,
}
impl From<bun_alloc::AllocError> for ForTarballError {
    fn from(_: bun_alloc::AllocError) -> Self {
        Self::OutOfMemory
    }
}
impl From<ForTarballError> for bun_core::Error {
    fn from(e: ForTarballError) -> Self {
        match e {
            ForTarballError::OutOfMemory => bun_core::err!(OutOfMemory),
            ForTarballError::InvalidURL => bun_core::err!(InvalidURL),
        }
    }
}

impl NetworkTask {
    pub fn for_tarball(
        &mut self,
        tarball_: &ExtractTarball,
        scope: &npm::registry::Scope,
        authorization: Authorization,
    ) -> Result<(), ForTarballError> {
        // SAFETY: BACKREF — PackageManager owns this task and outlives it.
        let pm = unsafe { &*(self.package_manager as *mut PackageManager) };

        self.callback = Callback::Extract(tarball_.clone());
        let Callback::Extract(tarball) = &self.callback else {
            unreachable!()
        };
        let tarball_url = tarball.url.slice();
        if tarball_url.is_empty() {
            self.url_buf = ExtractTarball::build_url(
                &scope.url.href,
                &tarball.name,
                &tarball.resolution.value.npm.version,
                pm.lockfile.buffers.string_bytes.as_slice(),
            )?;
        } else {
            // TODO(port): Zig aliases `tarball.url` here without copying;
            // `url_buf: Box<[u8]>` forces an allocation. Revisit ownership.
            self.url_buf = Box::<[u8]>::from(tarball_url);
        }

        if !(self.url_buf.starts_with(b"https://") || self.url_buf.starts_with(b"http://")) {
            pm.log.add_error_fmt(
                None,
                logger::Loc::EMPTY,
                format_args!(
                    "Expected tarball URL to start with https:// or http://, got {} while fetching package {}",
                    QuotedFormatter(&self.url_buf),
                    QuotedFormatter(tarball.name.slice()),
                ),
            )?;
            return Err(ForTarballError::InvalidURL);
        }

        self.response_buffer = MutableString::init_empty();

        let mut header_builder = HeaderBuilder::default();
        let mut header_buf: &[u8] = b"";

        if matches!(authorization, Authorization::AllowAuthorization) {
            count_auth(&mut header_builder, scope);
        }

        if header_builder.header_count > 0 {
            header_builder.allocate()?;

            if matches!(authorization, Authorization::AllowAuthorization) {
                append_auth(&mut header_builder, scope);
            }

            // SAFETY: `allocate()` set `content.ptr` to a valid allocation of `len` bytes.
            header_buf = unsafe {
                core::slice::from_raw_parts(header_builder.content.ptr, header_builder.content.len)
            };
        }

        let url = URL::parse(&self.url_buf);

        let mut http_options = AsyncHTTP::Options {
            http_proxy: pm.http_proxy(url),
            ..Default::default()
        };

        if ExtractTarball::uses_streaming_extraction() {
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
            http_options.signals = http::Signals {
                response_body_streaming: Some(&self.signal_store.response_body_streaming),
                ..Default::default()
            };
        }

        self.unsafe_http_client = AsyncHTTP::init(
            http::Method::GET,
            url,
            header_builder.entries,
            header_buf,
            &mut self.response_buffer,
            b"",
            self.get_completion_callback(),
            http::FetchRedirect::Follow,
            http_options,
        );
        self.unsafe_http_client.client.flags.reject_unauthorized = pm.tls_reject_unauthorized();
        if PackageManager::verbose_install() {
            self.unsafe_http_client.client.verbose = http::Verbose::Headers;
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
            manager
                .preallocated_resolve_tasks
                .put(self.streaming_extract_task);
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
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/NetworkTask.zig (505 lines)
//   confidence: medium
//   todos:      10
//   notes:      package_manager BACKREF is *const per TSV but mutated through; url_buf ownership is mixed (owned vs aliased); HTTPClientResult::Callback comptime thunk needs Phase-B trampoline design
// ──────────────────────────────────────────────────────────────────────────

//! Resumable, non-blocking tarball extractor for `bun install`.
//!
//! The HTTP thread hands each body chunk to `on_chunk`, which appends to a
//! small pending buffer and (if not already running) schedules the stream's
//! drain task on `PackageManager.thread_pool`. The drain task calls into
//! libarchive to gunzip and untar whatever is available, writing files as
//! their data arrives, until libarchive asks for more compressed bytes
//! than are currently buffered. At that point the read callback returns
//! `ARCHIVE_RETRY`, libarchive propagates it (see the BUN PATCHes in
//! `vendor/libarchive`), and the drain task returns — the worker is
//! released. The next HTTP chunk reschedules the drain task, which calls
//! back into libarchive and resumes exactly where it left off because the
//! `struct archive *`, the gzip inflate state, the partially-read tar
//! header and the open output `bun.FD` all live on the heap in this
//! struct.
//!
//! This lets `bun install` overlap download and extraction on the normal
//! resolve thread pool without ever parking a worker on a condvar, and
//! without holding the full compressed or decompressed tarball in memory.
//!
//! Ownership: the stream is shared (`Arc`) by the `NetworkTask` feeding it
//! and the drain task consuming it. It owns the extract `Task` that carries
//! the result to the main thread; with its final chunk the HTTP thread also
//! hands over the `NetworkTask`, and `finish()` moves that into the extract
//! `Task` before publishing it.

use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bun_collections::VecExt;
#[cfg(windows)]
use bun_core::strings;
use bun_core::{self, Output, ZBox, env_var, fmt as bun_fmt};
use bun_libarchive::lib::{self, Header, StreamRead, StreamingArchive};
use bun_paths::resolve_path::{self, platform};
use bun_paths::{self, OSPathBuffer, OSPathChar, OSPathSliceZ, PathBuffer};
#[cfg(not(windows))]
use bun_sys::FdDirExt;
use bun_sys::{self, Dir, Fd, FdExt, FileKind, Mode, O};
use bun_threading::Guarded;

use crate::NetworkTask;
use crate::bun_fs::FileSystem;
use crate::integrity::{self, Integrity};
use crate::package_manager_real::PackageManager;

type Task = crate::package_manager_task::Task;

type OSPathZ<'a> = &'a OSPathSliceZ;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Call `archive_read_next_header` next.
    WantHeader,
    /// Currently writing the body of `out_fd`; call
    /// `archive_read_data_block` next.
    WantData,
    /// `archive_read_next_header` returned EOF; we are done.
    Done,
}

pub struct TarballStream {
    /// Producer state (HTTP thread → worker); also read by the archive's
    /// [`Source`].
    incoming: Arc<Incoming>,

    /// True while a drain task is either queued on the thread pool or
    /// running. `on_chunk` sets it before scheduling; the drain clears it
    /// when it runs out of input and decides to yield, with `incoming`
    /// locked.
    draining: AtomicBool,

    /// Everything the drain task works on. Only one drain runs at a time
    /// (`draining`), so this lock is never contended; it is a lock so the
    /// shared stream can hand out `&mut`.
    drain: Guarded<Drain>,

    /// Thread-pool task that runs the drain. Re-enqueued whenever new data
    /// arrives and no drain is currently in flight.
    drain_task: bun_threading::SharedTask,

    package_manager: bun_ptr::BackRef<PackageManager>,
}

bun_threading::arc_task!(TarballStream, drain_task);

#[derive(Default)]
struct Incoming {
    state: Guarded<IncomingState>,
}

#[derive(Default)]
struct IncomingState {
    /// Compressed .tgz bytes that have arrived from the HTTP thread but have
    /// not yet been consumed by libarchive.
    pending: Vec<u8>,
    /// True once the HTTP thread has delivered the final chunk (or an error).
    closed: bool,
    /// Set if the HTTP request failed mid-stream. Unless libarchive still
    /// reached end-of-archive and the digest verifies, this — not
    /// libarchive's truncation error — is the failure, and `finish()` hands
    /// the NetworkTask back to be retried as a failed download.
    http_err: Option<crate::Error>,
    /// Cached response status (metadata only arrives on the first callback).
    status_code: u32,
    /// `Content-Length` of the response, when the server sent one.
    content_length: Option<usize>,
    bytes_received: usize,
    /// Arrives with the final chunk: the network task this stream was fed
    /// by, for `finish()` to hand back to the main thread.
    network_task: Option<Box<NetworkTask>>,
}

/// libarchive's input: the compressed bytes taken over from `incoming`.
struct Source {
    incoming: Arc<Incoming>,
    /// Bytes currently being consumed by libarchive. Populated by swapping
    /// with `pending` under the lock so the HTTP thread can keep appending
    /// while libarchive decompresses without the lock held. libarchive's
    /// read callback hands out `reading[read_pos..]` and advances
    /// `read_pos`; the slice must remain valid until the next callback, so
    /// we only recycle this buffer on the *following* swap.
    reading: Vec<u8>,
    read_pos: usize,
    archive_holds_reading: bool,
    /// Compressed bytes handed to libarchive by the read callback so far.
    bytes_consumed: usize,
    /// Incremental SHA over the *compressed* bytes, matching
    /// `Integrity::verify` / `Integrity::for_bytes` in the buffered path.
    hasher: integrity::Streaming,
}

#[allow(clippy::large_enum_variant)] // one per stream, inside the `Arc`
enum ArchiveState {
    Unopened(Source),
    Open(StreamingArchive<Source>),
}

impl ArchiveState {
    fn source_mut(&mut self) -> &mut Source {
        match self {
            ArchiveState::Unopened(source) => source,
            ArchiveState::Open(archive) => archive.source_mut(),
        }
    }
}

struct Drain {
    archive: ArchiveState,
    files: Files,
    /// Completion task that carries the final result back to the main
    /// thread; `finish()` pushes it onto `resolve_tasks`.
    extract_task: Option<Box<Task>>,
}

/// Per-entry output state (touched only by the drain task).
struct Files {
    /// Where we are in the per-entry state machine between drain
    /// invocations. libarchive preserves everything else (filter buffers,
    /// zlib stream, tar header progress) on its own heap.
    phase: Phase,

    /// Output file for the entry currently being written. `None` while
    /// between entries or when the current entry is being skipped.
    out_fd: Option<Fd>,
    #[cfg(unix)]
    use_pwrite: bool,
    use_lseek: bool,
    /// Per-entry write cursors, carried across `write_data_block` calls so
    /// the sparse-file handling in `close_output_file` matches
    /// `Archive::read_data_into_fd` exactly (which tracks these across its own
    /// block loop). Reset in `begin_entry` when a new output file is opened.
    entry_actual_offset: i64,
    entry_final_offset: i64,

    /// Temp directory files are written into before being renamed into the
    /// cache. Lazily opened on the first drain so the HTTP thread never
    /// touches the filesystem.
    dest: Option<Fd>,
    /// Owned copy of the temp-directory name.
    tmpname: ZBox,

    /// Resolved first-directory name for GitHub tarballs (written to
    /// `.bun-tag` and used for the cache folder name).
    resolved_github_dirname: &'static [u8],
    want_first_dirname: bool,
    npm_mode: bool,

    /// Symlink entries accepted so far; written to disk only after every
    /// other entry.
    #[cfg(unix)]
    deferred_symlinks: Vec<bun_libarchive::DeferredSymlink>,

    entry_count: u32,
    fail: Option<crate::Error>,
    /// libarchive's error string for `fail == Some(Fail)`.
    fail_detail: Vec<u8>,
    invalid_name: bool,
}

impl TarballStream {
    /// Minimum Content-Length for which the streaming path is used. Below
    /// this the whole body is buffered as before; the resumable libarchive
    /// state machine is only worth its per-chunk overhead for tarballs that
    /// would otherwise consume a noticeable amount of memory.
    pub(crate) fn min_size() -> usize {
        // env_var.get() returns Option<u64> even when a default
        // is configured; the var has a 2 MiB
        // default so unwrap is infallible here.
        usize::try_from(env_var::BUN_INSTALL_STREAMING_MIN_SIZE.get().unwrap()).expect("int cast")
    }

    /// Compressed bytes to buffer in `pending` before the HTTP thread
    /// schedules a drain; without this each body chunk re-wakes a worker
    /// once the drain has yielded. See `BUN_INSTALL_STREAMING_DRAIN_THRESHOLD`.
    fn drain_threshold() -> usize {
        usize::try_from(
            env_var::BUN_INSTALL_STREAMING_DRAIN_THRESHOLD
                .get()
                .unwrap(),
        )
        .expect("int cast")
    }

    /// A stream for the tarball `extract_task` describes; the task is
    /// published to the main thread once extraction finishes.
    pub(crate) fn new(
        extract_task: Box<Task>,
        manager: bun_ptr::BackRef<PackageManager>,
    ) -> Arc<TarballStream> {
        let tarball = extract_task.request_tarball();

        // For GitHub/URL/local tarballs we need a SHA-512 to record in the
        // lockfile even when there is no expected value to verify against,
        // matching `ExtractTarball.run`.
        let compute_if_missing = matches!(
            tarball.resolution.tag,
            ResolutionTag::Github | ResolutionTag::RemoteTarball | ResolutionTag::LocalTarball
        );

        let npm_mode = tarball.resolution.tag != ResolutionTag::Github;
        // An existing lockfile bun-tag keys the cache lookup; prefer it over the root dir name.
        let lockfile_github_tag = tarball.github_resolved.slice();
        let resolved_github_dirname: &'static [u8] =
            if tarball.resolution.tag == ResolutionTag::Github && !lockfile_github_tag.is_empty() {
                FileSystem::instance()
                    .dirname_store()
                    .append(lockfile_github_tag)
                    .expect("unreachable")
            } else {
                b""
            };
        let want_first_dirname =
            tarball.resolution.tag == ResolutionTag::Github && resolved_github_dirname.is_empty();
        let hasher = integrity::Streaming::init(
            &if tarball.skip_verify {
                Integrity::default()
            } else {
                tarball.integrity
            },
            compute_if_missing,
        );

        // Shared by the HTTP thread and one pool worker at a time; everything
        // mutable is under `Guarded` (see `ArcTask`).
        #[allow(clippy::arc_with_non_send_sync)]
        let incoming = Arc::new(Incoming::default());
        #[allow(clippy::arc_with_non_send_sync)]
        Arc::new(TarballStream {
            incoming: Arc::clone(&incoming),
            draining: AtomicBool::new(false),
            drain: Guarded::new(Drain {
                archive: ArchiveState::Unopened(Source {
                    incoming,
                    reading: Vec::new(),
                    read_pos: 0,
                    archive_holds_reading: false,
                    bytes_consumed: 0,
                    hasher,
                }),
                files: Files {
                    phase: Phase::WantHeader,
                    out_fd: None,
                    #[cfg(unix)]
                    use_pwrite: true,
                    use_lseek: true,
                    entry_actual_offset: 0,
                    entry_final_offset: 0,
                    dest: None,
                    tmpname: ZBox::from_bytes(b""),
                    resolved_github_dirname,
                    want_first_dirname,
                    npm_mode,
                    #[cfg(unix)]
                    deferred_symlinks: Vec::new(),
                    entry_count: 0,
                    fail: None,
                    fail_detail: Vec::new(),
                    invalid_name: false,
                },
                extract_task: Some(extract_task),
            }),
            drain_task: bun_threading::SharedTask::new(
                <Self as bun_threading::ArcTask>::__callback,
            ),
            package_manager: manager,
        })
    }

    /// The response headers arrived (HTTP thread).
    pub(crate) fn set_response_head(&self, status_code: u32, content_length: Option<usize>) {
        let mut incoming = self.incoming.state.lock();
        incoming.status_code = status_code;
        if content_length.is_some() {
            incoming.content_length = content_length;
        }
    }

    pub(crate) fn status_code(&self) -> u32 {
        self.incoming.state.lock().status_code
    }

    /// Called from the HTTP thread for each response-body chunk. Returns
    /// without touching the filesystem or libarchive; actual processing is
    /// deferred to the drain task on a worker so the HTTP event loop stays
    /// responsive.
    pub(crate) fn on_chunk(self: &Arc<Self>, chunk: &[u8]) {
        self.push(chunk, false, None, None);
    }

    /// The final chunk (HTTP thread): the stream takes over `network_task`
    /// and hands it back to the main thread from `finish()`.
    pub(crate) fn on_last_chunk(
        this: Arc<Self>,
        network_task: Box<NetworkTask>,
        chunk: &[u8],
        err: Option<crate::Error>,
    ) {
        this.push(chunk, true, err, Some(network_task));
        drop(this); // the network's ref
    }

    fn push(
        self: &Arc<Self>,
        chunk: &[u8],
        is_last: bool,
        err: Option<crate::Error>,
        network_task: Option<Box<NetworkTask>>,
    ) {
        let drain_threshold = Self::drain_threshold();
        let schedule = {
            let mut incoming = self.incoming.state.lock();
            if !chunk.is_empty() {
                incoming.pending.extend_from_slice(chunk);
                incoming.bytes_received += chunk.len();
            }
            if is_last {
                incoming.closed = true;
            }
            if err.is_some() {
                incoming.http_err = err;
            }
            if let Some(network_task) = network_task {
                incoming.network_task = Some(network_task);
            }
            let pending_len = incoming.pending.len();

            // Batch sub-threshold chunks so each one doesn't re-wake a worker
            // once the drain has yielded; `is_last`/`err` always schedule so
            // `finish()` never waits on the threshold.
            (is_last || err.is_some() || pending_len >= drain_threshold)
                && !self.draining.swap(true, Ordering::AcqRel)
        };

        if schedule {
            self.package_manager
                .thread_pool
                .schedule_arc(Arc::clone(self));
        }
    }

    /// Prepare this stream for another HTTP attempt after a failed request
    /// that never scheduled a drain.
    pub(crate) fn reset_for_retry(&self) {
        let mut incoming = self.incoming.state.lock();
        incoming.pending.clear();
        incoming.closed = false;
        incoming.http_err = None;
        incoming.status_code = 0;
        incoming.bytes_received = 0;
        incoming.content_length = None;
    }

    /// Pull whatever compressed bytes are available into libarchive, writing
    /// entries to disk, until libarchive reports `ARCHIVE_RETRY` (out of
    /// input — yield) or a terminal state (EOF / error — finish).
    fn run_arc(self: Arc<Self>) {
        Output::Source::configure_thread();

        let mut drain = self.drain.lock();
        let drain = &mut *drain;
        loop {
            if drain.files.fail.is_none() && drain.files.phase != Phase::Done {
                // Only pull bytes into `reading` while libarchive is still
                // going to consume them. After EOF/failure `step()` is
                // never called again, so appending here would let
                // `reading` grow by one HTTP chunk per wakeup for the
                // remainder of the download.
                let more = drain.archive.source_mut().take_pending();

                if let Err(err) = drain.step() {
                    // If the body was cut short by a transport error,
                    // that is the failure; libarchive's complaint about
                    // the truncated input is just its symptom.
                    let http_err = self.incoming.state.lock().http_err;
                    drain.files.fail = Some(match (err, http_err) {
                        (crate::Error::Fail, Some(http_err)) => http_err,
                        (err, _) => err,
                    });
                    drain.files.close_output_file();
                }

                if drain.files.fail.is_none() && drain.files.phase != Phase::Done {
                    if more {
                        continue;
                    }
                    // libarchive consumed everything we had. Yield the
                    // worker until the HTTP thread delivers the next
                    // chunk.
                    if self.more_or_stop_draining() {
                        continue;
                    }
                    return;
                }
            }

            // Terminal: archive finished or extraction failed. libarchive
            // will not be called again, so `reading` is dead — drop it
            // now rather than carrying its capacity until `finish()`.
            {
                let source = drain.archive.source_mut();
                source.reading = Vec::new();
                source.read_pos = 0;
            }

            let closed = {
                let mut incoming = self.incoming.state.lock();
                // Hash any bytes that arrived after libarchive hit
                // end-of-archive so the integrity digest covers the full
                // response (tar zero-padding, gzip footer). Skip this once
                // an error is recorded — the digest won't be checked anyway.
                if drain.files.fail.is_none() && !incoming.pending.is_empty() {
                    drain.archive.source_mut().hasher.update(&incoming.pending);
                }
                // After EOF/failure we stop feeding libarchive but must keep
                // consuming (and discarding) chunks until the HTTP thread
                // closes the stream.
                incoming.pending.clear();
                incoming.closed
            };
            if closed {
                self.finish(drain);
                return;
            }

            // Archive is done (or failed) but the HTTP response has not
            // finished yet. Yield; the next `on_chunk` will reschedule us
            // to discard the new bytes and eventually observe `closed`.
            if self.more_or_stop_draining() {
                continue;
            }
            return;
        }
    }

    /// With `incoming` locked: whether there is more to drain right now;
    /// if not, clears `draining` so the next chunk schedules a new drain.
    fn more_or_stop_draining(&self) -> bool {
        let incoming = self.incoming.state.lock();
        let again = !incoming.pending.is_empty() || incoming.closed;
        if !again {
            self.draining.store(false, Ordering::Release);
        }
        again
    }

    /// The stream is closed and drained: report the result through the
    /// extract `Task` (or hand the `NetworkTask` back for a retry).
    fn finish(&self, drain: &mut Drain) {
        let shared = self.package_manager.get().shared;

        drain.files.close_output_file();

        // The HTTP thread delivered its final chunk (that's the only way
        // `closed` gets set) together with the network task, so `http_err`
        // is stable now.
        let (http_err, mut network, content_length, bytes_received) = {
            let mut incoming = self.incoming.state.lock();
            (
                incoming.http_err,
                incoming
                    .network_task
                    .take()
                    .expect("closed stream holds its network task"),
                incoming.content_length,
                incoming.bytes_received,
            )
        };
        // The body has been consumed; release the buffer.
        network.response_buffer = Default::default();

        let mut task = drain.extract_task.take().expect("stream finishes once");
        drain.populate_result(&mut task, http_err, content_length, bytes_received);

        // Temp-dir cleanup must happen before we publish the task:
        // `task.request.extract.tarball.temp_dir` becomes invalid once the
        // main thread recycles the Task.
        if task.status != TaskStatus::Success && !drain.files.tmpname.is_empty() {
            // `populate_result` closes `dest` on the success path before the
            // rename; the early-return failure paths leave it open, so close
            // it here first — Windows can't remove an open directory.
            if let Some(d) = drain.files.dest.take() {
                d.close();
            }
            let _ = Dir::borrow(&task.request_tarball().temp_dir)
                .delete_tree(drain.files.tmpname.as_bytes());
        }

        // This stream is done either way; the network task drops its handle.
        network.tarball_stream = None;

        if let Some(crate::Error::Http(err)) = task.err
            && task.status != TaskStatus::Success
        {
            // The connection died before the body was complete: a failed
            // download, not a failed extraction. Hand the NetworkTask back
            // to `run_tasks` the way `on_done` does for one that failed
            // before the body started, so it is retried/reported there. The
            // extract Task stays with the NetworkTask for the next attempt.
            network.response.fail = Some(err);
            network.streaming_committed = false;
            network.streaming_extract_task = Some(task);
            shared.async_network_task_queue.push(network);
            shared.wake();
            return;
        }

        match &mut task.request {
            crate::package_manager_task::Request::Extract { network: slot, .. } => {
                *slot = Some(network);
            }
            _ => unreachable!(),
        }

        shared.resolve_tasks.push(task);
        shared.wake();
    }
}

impl Source {
    /// Move any bytes still sitting in `pending` into `reading` so the read
    /// callback can hand them to libarchive. Returns true if new bytes were
    /// added or the stream is now closed. Called both from the drain loop
    /// and from inside libarchive's read callback.
    fn take_pending(&mut self) -> bool {
        let mut incoming = self.incoming.state.lock();

        if incoming.pending.is_empty() {
            return incoming.closed;
        }

        // Hash before libarchive sees the bytes so integrity covers exactly
        // what came off the socket.
        self.hasher.update(&incoming.pending);

        if self.reading.len() == self.read_pos {
            // Previous buffer fully consumed — swap so the HTTP thread can
            // reuse its capacity without reallocating.
            self.reading.clear();
            core::mem::swap(&mut self.reading, &mut incoming.pending);
            self.read_pos = 0;
        } else {
            // libarchive still holds a slice into `reading` (the read
            // callback contract keeps the last-returned buffer valid until
            // the next call). Appending would realloc and invalidate that
            // slice, so instead shift the unconsumed tail down and append
            // in place — the callback is not running concurrently with us
            // (single drain at a time) and will be re-primed with the new
            // base on its next invocation.
            let read_pos = self.read_pos;
            self.reading.drain_front(read_pos);
            self.read_pos = 0;
            self.reading.extend_from_slice(&incoming.pending);
            incoming.pending.clear();
        }
        true
    }

    fn unread(&mut self) -> Option<&[u8]> {
        let remaining = &self.reading[self.read_pos..];
        if remaining.is_empty() {
            return None;
        }
        self.read_pos = self.reading.len();
        self.bytes_consumed += remaining.len();
        self.archive_holds_reading = true;
        Some(remaining)
    }
}

bun_libarchive::stream_source!(Source);

impl Source {
    /// libarchive client read callback. Returns whatever compressed bytes are
    /// currently buffered in `reading`; if none, `Retry` (when more data is still
    /// expected) so libarchive unwinds with a resumable status, or `Eof` once the
    /// HTTP response is complete. The bytes handed out live in `reading`, which
    /// is only replaced once they are consumed (`archive_holds_reading`).
    fn read_for_archive(&mut self) -> StreamRead<'_> {
        if self.read_pos < self.reading.len() {
            return StreamRead::Data(self.unread().expect("non-empty"));
        }
        self.archive_holds_reading = false;

        // No data left in `reading`. Check for more under the lock —
        // libarchive may have called us more than once for a single
        // `step()` (e.g. gzip header + first deflate block), and `on_chunk`
        // might have landed a fresh chunk in the meantime.
        let (has_pending, closed) = {
            let incoming = self.incoming.state.lock();
            (!incoming.pending.is_empty(), incoming.closed)
        };

        if has_pending {
            let _ = self.take_pending();
            if self.read_pos < self.reading.len() {
                return StreamRead::Data(self.unread().expect("non-empty"));
            }
        }

        if closed {
            return StreamRead::Eof;
        }

        // Tell libarchive to unwind with a resumable status. The BUN PATCHes
        // in vendor/libarchive make every layer (filter_ahead → gzip → tar)
        // preserve its state and propagate ARCHIVE_RETRY to our `step()`
        // loop, which then returns so this worker can be reused.
        StreamRead::Retry
    }
}

impl Drain {
    /// Run libarchive until it needs more input (`Retry`) or hits a
    /// terminal state. All libarchive state persists on the heap, so
    /// returning from here and re-entering later is safe.
    fn step(&mut self) -> crate::Result<()> {
        if let ArchiveState::Unopened(_) = self.archive {
            let ArchiveState::Unopened(source) = core::mem::replace(
                &mut self.archive,
                ArchiveState::Unopened(Source {
                    incoming: Arc::default(),
                    reading: Vec::new(),
                    read_pos: 0,
                    archive_holds_reading: false,
                    bytes_consumed: 0,
                    hasher: integrity::Streaming::init(&Integrity::default(), false),
                }),
            ) else {
                unreachable!()
            };
            match StreamingArchive::open_gzip_tar(source) {
                Ok(archive) => self.archive = ArchiveState::Open(archive),
                Err((source, detail)) => {
                    self.archive = ArchiveState::Unopened(source);
                    self.files.fail_detail = detail;
                    return Err(crate::Error::Fail);
                }
            }
        }
        if self.files.dest.is_none() {
            let extract_task = self.extract_task.as_deref().expect("live until finish");
            self.files.open_destination(extract_task)?;
        }

        let ArchiveState::Open(archive) = &mut self.archive else {
            unreachable!()
        };
        let files = &mut self.files;

        loop {
            match files.phase {
                Phase::Done => return Ok(()),
                Phase::WantHeader => match archive.next_header() {
                    (_, Header::Retry) => {
                        if archive.source().archive_holds_reading {
                            continue;
                        }
                        return Ok(());
                    }
                    (_, Header::Eof) => {
                        #[cfg(unix)]
                        {
                            let dest = files.dest.unwrap();
                            let symlinks = core::mem::take(&mut files.deferred_symlinks);
                            bun_libarchive::create_deferred_symlinks(dest, &symlinks, false);
                        }
                        files.phase = Phase::Done;
                        return Ok(());
                    }
                    (_, Header::Entry(entry)) => {
                        files.begin_entry(entry)?;
                    }
                    (_, Header::Failed) => {
                        files.fail_detail = archive.error_string().to_vec();
                        return Err(crate::Error::Fail);
                    }
                },
                Phase::WantData => {
                    let mut offset: i64 = 0;
                    let Some(block) = archive.next_block(&mut offset) else {
                        // End of this entry's data.
                        files.close_output_file();
                        files.phase = Phase::WantHeader;
                        continue;
                    };
                    match block.result {
                        lib::Result::Retry => {
                            if !archive.source().archive_holds_reading {
                                return Ok(());
                            }
                        }
                        lib::Result::Ok | lib::Result::Warn => {
                            if let Some(fd) = files.out_fd {
                                files.write_data_block(fd, &block)?;
                            }
                        }
                        _ => {
                            files.fail_detail = archive.error_string().to_vec();
                            return Err(crate::Error::Fail);
                        }
                    }
                }
            }
        }
    }

    fn populate_result(
        &mut self,
        task: &mut Task,
        http_err: Option<crate::Error>,
        content_length: Option<usize>,
        bytes_received: usize,
    ) {
        let files = &mut self.files;
        let source = self.archive.source_mut();
        let Task {
            request,
            log,
            data,
            err: task_err,
            status,
            ..
        } = task;
        let tarball = match request {
            crate::package_manager_task::Request::Extract { tarball, .. } => &*tarball,
            _ => unreachable!(),
        };
        *data = TaskData::Extract(Default::default());
        *task_err = None;

        if let Some(err) = files.fail {
            if matches!(err, crate::Error::Http(_)) {
                // Reported (or retried) by `run_tasks`; see `finish()`.
            } else if files.invalid_name {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Refusing to install package with invalid name \"{}\"",
                        bun_fmt::s(tarball.name_and_basename().0),
                    ),
                );
            } else {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "{} extracting tarball for \"{}\"{}{} (at byte {} of {})",
                        err.name(),
                        bstr::BStr::new(tarball.name.slice()),
                        if files.fail_detail.is_empty() {
                            ""
                        } else {
                            ": "
                        },
                        bstr::BStr::new(&files.fail_detail),
                        source.bytes_consumed,
                        content_length
                            .as_ref()
                            .map_or(&"unknown" as &dyn core::fmt::Display, |n| n),
                    ),
                );
            }
            *task_err = Some(err);
            *status = TaskStatus::Fail;
            return;
        }

        if !tarball.skip_verify && tarball.integrity.tag.is_supported() {
            if !source.hasher.verify() {
                if let Some(http_err) = http_err {
                    // libarchive found the end-of-archive marker but the
                    // body still ended early (gzip trailer, tar padding):
                    // the same failed download as above.
                    *task_err = Some(http_err);
                    *status = TaskStatus::Fail;
                    return;
                }
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Integrity check failed for tarball: {}",
                        bstr::BStr::new(tarball.name.slice()),
                    ),
                );
                *task_err = Some(crate::Error::IntegrityCheckFailed);
                *status = TaskStatus::Fail;
                return;
            }
        }

        if tarball.resolution.tag == ResolutionTag::Github {
            'insert_tag: {
                if files.resolved_github_dirname.is_empty() {
                    break 'insert_tag;
                }
                if bun_sys::File::openat(
                    files.dest.unwrap(),
                    bun_core::zstr!(".bun-tag"),
                    O::WRONLY | O::CREAT | O::TRUNC | if cfg!(windows) { 0 } else { O::NOFOLLOW },
                    0o664,
                )
                .and_then(|f| f.write_all(files.resolved_github_dirname))
                .is_err()
                {
                    let _ = bun_sys::unlinkat(files.dest.unwrap(), bun_core::zstr!(".bun-tag"));
                }
            }
        }

        // Close the temp dir handle before renaming so Windows can move it.
        if let Some(d) = files.dest.take() {
            d.close();
        }

        let (name, basename) = tarball.name_and_basename();

        let mut result = match tarball.move_to_cache_directory(
            log,
            files.tmpname.as_zstr(),
            name,
            basename,
            files.resolved_github_dirname,
        ) {
            Ok(r) => r,
            Err(err) => {
                *task_err = Some(err);
                *status = TaskStatus::Fail;
                return;
            }
        };

        match tarball.resolution.tag {
            ResolutionTag::Github | ResolutionTag::RemoteTarball | ResolutionTag::LocalTarball => {
                if tarball.integrity.tag.is_supported() {
                    result.integrity = tarball.integrity;
                } else {
                    result.integrity = source.hasher.final_();
                }
            }
            _ => {}
        }

        if PackageManager::verbose_install() {
            bun_core::pretty_errorln!(
                "[{}] Streamed {} tarball → {} entries<r>",
                bstr::BStr::new(name),
                bun_fmt::size(bytes_received, Default::default()),
                files.entry_count,
            );
            Output::flush();
        }

        *data = TaskData::Extract(result);
        *status = TaskStatus::Success;
    }
}

impl Files {
    fn open_destination(&mut self, extract_task: &Task) -> crate::Result<()> {
        let tarball = extract_task.request_tarball();
        let (_, basename) = tarball.name_and_basename();
        let truncated_basename = &basename[0..basename.len().min(32)];
        let tmpname_suffix: &[u8] =
            if crate::dependency::is_safe_install_folder_name(truncated_basename) {
                truncated_basename
            } else if tarball.resolution.tag.is_git()
                || tarball.resolution.tag == ResolutionTag::LocalTarball
            {
                b"package"
            } else {
                self.invalid_name = true;
                return Err(crate::Error::InstallFailed);
            };
        let mut buf = PathBuffer::uninit();
        let tmpname = FileSystem::tmpname(tmpname_suffix, &mut buf[..], bun_core::fast_random())?;
        self.tmpname = ZBox::from_bytes(tmpname.as_bytes());

        self.dest = Some(
            bun_sys::make_path::make_open_path(
                Dir::borrow(&tarball.temp_dir),
                self.tmpname.as_bytes(),
                Default::default(),
            )?
            .into_raw(),
        );
        Ok(())
    }

    fn close_output_file(&mut self) {
        if let Some(fd) = self.out_fd {
            // Same trailing-hole handling as `Archive::read_data_into_fd`:
            // extend the file to cover the furthest block we were asked
            // to write even if the pwrite/lseek fallback path left
            // `actual_offset` behind.
            if self.entry_final_offset > self.entry_actual_offset {
                let _ = bun_sys::ftruncate(fd, self.entry_final_offset);
            }
            fd.close();
            self.out_fd = None;
        }
    }

    /// Process one entry header returned by `read_next_header`. Opens the
    /// output file (or creates the directory/symlink) and transitions to
    /// `WantData` so the next `step()` iteration starts pulling its body.
    fn begin_entry(&mut self, entry: &mut lib::Entry) -> crate::Result<()> {
        #[cfg(windows)]
        let pathname: OSPathZ = entry.pathname_w();
        #[cfg(not(windows))]
        let pathname: OSPathZ = entry.pathname();

        if self.want_first_dirname {
            self.want_first_dirname = false;
            // GitHub's archive API always emits an explicit `repo-sha/`
            // directory entry first, which is what the buffered path
            // relies on. Take only the leading component so a tarball
            // whose first member is `repo-sha/file` (no directory entry)
            // still yields the correct cache-folder name.
            let mut root_it = pathname[..]
                .split(|c| *c == ('/' as OSPathChar))
                .filter(|s| !s.is_empty());
            let root: &[OSPathChar] = root_it.next().unwrap_or(&[]);
            #[cfg(windows)]
            {
                let result = strings::to_utf8_list_with_type(Vec::new(), root)?;
                self.resolved_github_dirname = FileSystem::instance()
                    .dirname_store()
                    .append(&result)
                    .expect("unreachable");
            }
            #[cfg(not(windows))]
            {
                self.resolved_github_dirname = FileSystem::instance()
                    .dirname_store()
                    .append(root)
                    .expect("unreachable");
            }
        }

        let kind = bun_sys::kind_from_mode(entry.filetype() as Mode);

        if self.npm_mode && kind != FileKind::File {
            // npm tarballs only contain files; matching the libarchive path
            // in Archiver::extract_to_dir we skip everything else.
            self.phase = Phase::WantData;
            self.out_fd = None;
            return Ok(());
        }

        // Strip the leading `package/` (or `<repo>-<sha>/` for GitHub) and
        // normalise. Same transformation as Archiver::extract_to_dir so both
        // paths produce identical on-disk layouts.
        let mut tokenizer = pathname[..]
            .split(|c| *c == ('/' as OSPathChar))
            .filter(|s| !s.is_empty());
        if tokenizer.next().is_none() {
            self.phase = Phase::WantData;
            self.out_fd = None;
            return Ok(());
        }
        // tokenizeScalar.rest() — need byte offset of remainder, not just
        // iterator. `split().filter()` loses that, so use a manual
        // index-of-first-'/' + skip-leading-'/' instead. The result is fed
        // straight to `normalize_buf_t` (which takes `&[OSPathChar]`, not a
        // NUL-terminated slice) so there is no need to reconstruct an
        // `OSPathSliceZ` suffix view here.
        let rest: &[OSPathChar] = tokenize_rest_after_first(&pathname[..]);

        let mut norm_buf = OSPathBuffer::uninit();
        if rest.len() >= norm_buf.len() {
            bun_core::warn!(
                "Skipping entry with a path longer than the maximum path length: {}\n",
                bun_core::fmt::fmt_os_path(rest, Default::default()),
            );
            self.phase = Phase::WantData;
            self.out_fd = None;
            return Ok(());
        }
        let normalized =
            resolve_path::normalize_buf_t::<OSPathChar, platform::Auto>(rest, &mut norm_buf[..]);
        let norm_len = normalized.len();
        norm_buf[norm_len] = 0;
        {
            let path: &[OSPathChar] = &norm_buf[..norm_len];
            if path.is_empty() || (path.len() == 1 && path[0] == ('.' as OSPathChar)) {
                self.phase = Phase::WantData;
                self.out_fd = None;
                return Ok(());
            }
            // `normalize_buf_t` collapses interior `..` but leaves a leading `..`
            // on a relative input. Reject those so `openat(dest_fd, ...)` can
            // never escape the temp extraction root. `Archiver::extract_to_dir`
            // sees the same normalised path; this check is belt-and-braces on
            // top of the integrity gate.
            if path.len() >= 2
                && path[0] == ('.' as OSPathChar)
                && path[1] == ('.' as OSPathChar)
                && (path.len() == 2 || path[2] == bun_paths::SEP as OSPathChar)
            {
                self.phase = Phase::WantData;
                self.out_fd = None;
                return Ok(());
            }
        }
        #[cfg(windows)]
        {
            if bun_paths::is_absolute_windows_wtf16(&norm_buf[..norm_len]) {
                self.phase = Phase::WantData;
                self.out_fd = None;
                return Ok(());
            }
            if self.npm_mode {
                apply_windows_npm_path_escapes(&mut norm_buf[..norm_len]);
            }
        }

        let path: OSPathZ = OSPathSliceZ::from_buf(&norm_buf[..], norm_len);
        let path_slice: &[OSPathChar] = &path[..];
        let dest = self.dest.unwrap();

        match kind {
            FileKind::Directory => {
                make_directory(entry, dest, path, path_slice);
                self.phase = Phase::WantData;
                self.out_fd = None;
            }
            FileKind::SymLink => {
                #[cfg(unix)]
                if bun_libarchive::is_symlink_target_safe(path_slice, entry.symlink(), &mut None) {
                    self.deferred_symlinks
                        .push(bun_libarchive::DeferredSymlink::new(
                            path_slice,
                            entry.symlink().as_bytes(),
                        ));
                }
                self.phase = Phase::WantData;
                self.out_fd = None;
            }
            FileKind::File => {
                #[cfg(windows)]
                let mode: Mode = 0;
                // Mask to permission bits so setuid/setgid/sticky bits from the
                // archive never reach `openat`'s mode argument.
                #[cfg(not(windows))]
                let mode: Mode = Mode::try_from((entry.perm() & 0o777) | 0o666).expect("int cast");
                let fd = open_output_file(dest, path, path_slice, mode)?;
                self.entry_count += 1;

                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    let size: usize = usize::try_from(entry.size().max(0)).expect("int cast");
                    if size > 1_000_000 {
                        let _ = bun_sys::preallocate_file(
                            fd.native(),
                            0,
                            i64::try_from(size).expect("int cast"),
                        );
                    }
                }

                self.out_fd = Some(fd);
                self.entry_actual_offset = 0;
                self.entry_final_offset = 0;
                self.phase = Phase::WantData;
            }
            _ => {
                self.phase = Phase::WantData;
                self.out_fd = None;
            }
        }
        Ok(())
    }

    /// Write one data block from `archive_read_data_block`. Mirrors the
    /// sparse/pwrite handling in `Archive::read_data_into_fd` but operates on a
    /// single block so it can be interleaved with ARCHIVE_RETRY yields.
    /// `entry_actual_offset` / `entry_final_offset` persist across calls so
    /// `close_output_file` can perform the same trailing `ftruncate` the
    /// buffered path does after its block loop.
    fn write_data_block(&mut self, fd: Fd, block: &lib::Block) -> crate::Result<()> {
        let file = bun_sys::File::borrow(&fd);
        let data = block.bytes;
        if data.is_empty() {
            return Ok(());
        }

        self.entry_final_offset = self
            .entry_final_offset
            .max(block.offset + i64::try_from(data.len()).expect("int cast"));

        #[cfg(unix)]
        {
            if self.use_pwrite {
                match file.pwrite_all(data, block.offset) {
                    Ok(_) => {
                        self.entry_actual_offset = self
                            .entry_actual_offset
                            .max(block.offset + i64::try_from(data.len()).expect("int cast"));
                        return Ok(());
                    }
                    Err(_) => self.use_pwrite = false,
                }
            }
        }

        'seek: {
            if block.offset == self.entry_actual_offset {
                break 'seek;
            }
            if self.use_lseek {
                match file.seek_to(u64::try_from(block.offset).expect("int cast")) {
                    Ok(_) => {
                        self.entry_actual_offset = block.offset;
                        break 'seek;
                    }
                    Err(_) => self.use_lseek = false,
                }
            }
            if block.offset > self.entry_actual_offset {
                let zero_count: usize =
                    usize::try_from(block.offset - self.entry_actual_offset).expect("int cast");
                match lib::Archive::write_zeros_to_file(file, zero_count) {
                    lib::Result::Ok => {
                        self.entry_actual_offset = block.offset;
                    }
                    _ => return Err(crate::Error::Fail),
                }
            } else {
                return Err(crate::Error::Fail);
            }
        }

        match file.write_all(data) {
            Ok(_) => {
                self.entry_actual_offset += i64::try_from(data.len()).expect("int cast");
                Ok(())
            }
            Err(e) => Err(e.to_zig_err().into()),
        }
    }
}

impl Drop for Files {
    fn drop(&mut self) {
        if let Some(fd) = self.out_fd {
            fd.close();
        }
        if let Some(d) = self.dest {
            d.close();
        }
    }
}

fn open_output_file(
    dest_fd: Fd,
    path: OSPathZ,
    path_slice: &[OSPathChar],
    mode: Mode,
) -> crate::Result<Fd> {
    let flags = O::WRONLY | O::CREAT | O::TRUNC;
    #[cfg(windows)]
    {
        let _ = mode;
        return match bun_sys::openat_windows(dest_fd, path, flags, 0) {
            Ok(fd) => Ok(fd),
            Err(e) => match e.get_errno() {
                bun_sys::E::EPERM | bun_sys::E::ENOENT => 'brk: {
                    let Some(dir) = bun_paths::Dirname::dirname::<u16>(path_slice) else {
                        return Err(e.to_zig_err().into());
                    };
                    let _ = bun_sys::make_path::make_path::<u16>(Dir::borrow(&dest_fd), dir);
                    break 'brk bun_sys::openat_windows(dest_fd, path, flags, 0)
                        .map_err(|e| e.to_zig_err().into());
                }
                _ => Err(e.to_zig_err().into()),
            },
        };
    }
    #[cfg(not(windows))]
    {
        match bun_sys::openat(dest_fd, path, flags, mode) {
            Ok(fd) => Ok(fd),
            Err(e) => match e.get_errno() {
                bun_sys::E::EACCES | bun_sys::E::ENOENT => 'brk: {
                    let Some(dir) = bun_paths::dirname(path_slice) else {
                        return Err(e.to_zig_err().into());
                    };
                    let _ = dest_fd.make_path(dir);
                    break 'brk bun_sys::openat(dest_fd, path, flags, mode)
                        .map_err(|e| e.to_zig_err().into());
                }
                _ => Err(e.to_zig_err().into()),
            },
        }
    }
}

fn make_directory(entry: &mut lib::Entry, dest_fd: Fd, path: OSPathZ, path_slice: &[OSPathChar]) {
    let mut mode = i32::try_from(entry.perm()).expect("int cast");
    // if dirs are readable, then they should be listable
    // https://github.com/npm/node-tar/blob/main/lib/mode-fix.js
    if (mode & 0o400) != 0 {
        mode |= 0o100;
    }
    if (mode & 0o40) != 0 {
        mode |= 0o10;
    }
    if (mode & 0o4) != 0 {
        mode |= 0o1;
    }
    #[cfg(windows)]
    {
        let _ = bun_sys::make_path::make_path::<u16>(Dir::borrow(&dest_fd), &path[..]);
        let _ = (path_slice, mode);
    }
    #[cfg(not(windows))]
    {
        match bun_sys::mkdirat_z(dest_fd, path, Mode::try_from(mode).expect("int cast")) {
            Ok(()) => {}
            Err(e) => match e.get_errno() {
                bun_sys::E::EEXIST | bun_sys::E::ENOTDIR => {}
                _ => {
                    let Some(dir) = bun_paths::dirname(path_slice) else {
                        return;
                    };
                    let _ = dest_fd.make_path(dir);
                    let _ = bun_sys::mkdirat_z(dest_fd, path, 0o777);
                }
            },
        }
    }
}

#[cfg(windows)]
fn apply_windows_npm_path_escapes(path: &mut [OSPathChar]) {
    // Same transformation as Archiver::extract_to_dir: encode characters
    // Windows rejects in filenames into the 0xf000 private-use range so
    // the extraction round-trips with node-tar.
    let mut remain: &mut [OSPathChar] = path;
    if strings::starts_with_windows_drive_letter_t(&*remain) {
        remain = &mut remain[2..];
    }
    for ch in remain.iter_mut() {
        match *ch {
            c if c == ('|' as OSPathChar)
                || c == ('<' as OSPathChar)
                || c == ('>' as OSPathChar)
                || c == ('?' as OSPathChar)
                || c == (':' as OSPathChar) =>
            {
                *ch += 0xf000;
            }
            _ => {}
        }
    }
}

// Skips any leading `/` delimiters, then returns everything after the first
// path component, so for `"package/index.js"` the result is `"index.js"`
// (no leading `/`).
fn tokenize_rest_after_first(s: &[OSPathChar]) -> &[OSPathChar] {
    let mut i = 0;
    while i < s.len() && s[i] == ('/' as OSPathChar) {
        i += 1;
    }
    while i < s.len() && s[i] != ('/' as OSPathChar) {
        i += 1;
    }
    while i < s.len() && s[i] == ('/' as OSPathChar) {
        i += 1;
    }
    &s[i..]
}

// Resolved Phase-B paths: Resolution::Tag is the real npm/git/tarball
// discriminant; Data/Status live on PackageManagerTask.
use crate::package_manager_task::{Data as TaskData, Status as TaskStatus};
use crate::resolution::Tag as ResolutionTag;

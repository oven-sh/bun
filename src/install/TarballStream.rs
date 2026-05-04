//! Resumable, non-blocking tarball extractor for `bun install`.
//!
//! The HTTP thread hands each body chunk to `on_chunk`, which appends to a
//! small pending buffer and (if not already running) schedules
//! `drain_task` on `PackageManager.thread_pool`. The drain task calls into
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

use core::ffi::{c_int, c_void};
use core::mem::offset_of;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::{self, Output, env_var, fmt as bun_fmt};
use bun_libarchive::lib;
use bun_logger as logger;
use bun_paths::{self, OSPathBuffer, OSPathChar, OSPathSlice, PathBuffer};
use bun_str::strings;
use bun_sys::{self, Fd, Mode, O};
use bun_threading::{thread_pool, Mutex, ThreadPool};

use bun_fs::FileSystem;
use bun_install::install::{NetworkTask, PackageManager, Task};
use bun_install::integrity::{self, Integrity};

bun_output::declare_scope!(TarballStream, hidden);

// TODO(port): OS-path sentinel-slice types — confirm bun_paths exports these.
// Zig: `[:0]const bun.OSPathChar` / `[:0]bun.OSPathChar` / `bun.OSPathSliceZ`.
type OSPathZ<'a> = &'a bun_paths::OSPathZStr;
type OSPathZMut<'a> = &'a mut bun_paths::OSPathZStr;

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

// TODO(port): lifetime — `extract_task`/`package_manager` are classified
// BORROW_PARAM (`&'a`) per LIFETIMES.tsv, but this struct is heap-allocated
// (Box::into_raw), crosses threads via `drain_task`, and self-destroys in
// `finish()`. Phase B may need to demote these to raw pointers.
pub struct TarballStream<'a> {
    // ---------------------------------------------------------------------
    // Cross-thread producer state (HTTP → worker)
    // ---------------------------------------------------------------------
    mutex: Mutex,

    /// Compressed .tgz bytes that have arrived from the HTTP thread but have
    /// not yet been consumed by libarchive.
    pending: Vec<u8>,

    /// True once the HTTP thread has delivered the final chunk (or an error).
    closed: bool,

    /// Non-null if the HTTP request failed mid-stream; surfaced to the user
    /// instead of whatever libarchive would otherwise report.
    http_err: Option<bun_core::Error>,

    /// Cached response status (metadata only arrives on the first callback).
    pub status_code: u32,

    /// True while a drain task is either queued on the thread pool or
    /// running. `on_chunk` sets it before scheduling; `drain` clears it when
    /// it runs out of input and decides to yield.
    draining: AtomicBool,

    // ---------------------------------------------------------------------
    // Drain-side state (touched only by one drain task at a time)
    // ---------------------------------------------------------------------
    /// Bytes currently being consumed by libarchive. Populated by swapping
    /// with `pending` under the mutex so the HTTP thread can keep appending
    /// while libarchive decompresses without the lock held. libarchive's
    /// read callback hands out `reading[read_pos..]` and advances
    /// `read_pos`; the slice must remain valid until the next callback, so
    /// we only recycle this buffer on the *following* swap.
    reading: Vec<u8>,
    read_pos: usize,

    archive: Option<*mut lib::Archive>,

    /// Where we are in the per-entry state machine between drain
    /// invocations. libarchive preserves everything else (filter buffers,
    /// zlib stream, tar header progress) on its own heap.
    phase: Phase,

    /// Output file for the entry currently being written. `None` while
    /// between entries or when the current entry is being skipped.
    out_fd: Option<Fd>,
    use_pwrite: bool,
    use_lseek: bool,
    /// Per-entry write cursors, carried across `write_data_block` calls so
    /// the sparse-file handling in `close_output_file` matches
    /// `Archive.readDataIntoFd` exactly (which tracks these across its own
    /// block loop). Reset in `begin_entry` when a new output file is opened.
    entry_actual_offset: i64,
    entry_final_offset: i64,

    /// Temp directory files are written into before being renamed into the
    /// cache. Lazily opened on the first drain so the HTTP thread never
    /// touches the filesystem.
    dest: Option<Fd>,
    /// Owned copy of the temp-directory name; freed in `Drop`.
    // TODO(port): owned NUL-terminated string. Zig `[:0]const u8` field freed
    // via `allocator.free`. Using Box<CStr>; default is empty (`c""`).
    tmpname: Box<core::ffi::CStr>,

    /// Incremental SHA over the *compressed* bytes, matching
    /// `Integrity.verify` / `Integrity.forBytes` in the buffered path.
    hasher: integrity::Streaming,

    /// Resolved first-directory name for GitHub tarballs (written to
    /// `.bun-tag` and used for the cache folder name).
    resolved_github_dirname: &'static [u8],
    want_first_dirname: bool,
    npm_mode: bool,

    bytes_received: usize,
    entry_count: u32,
    fail: Option<bun_core::Error>,

    /// Thread-pool task that runs `drain`. Re-enqueued whenever new data
    /// arrives and no drain is currently in flight.
    drain_task: thread_pool::Task,

    /// Completion task that carries the final result back to the main
    /// thread. Populated by `finish()` and pushed onto `resolve_tasks` there.
    extract_task: &'a mut Task,
    network_task: *mut NetworkTask,
    package_manager: &'a PackageManager,
}

/// Minimum Content-Length for which the streaming path is used. Below
/// this the whole body is buffered as before; the resumable libarchive
/// state machine is only worth its per-chunk overhead for tarballs that
/// would otherwise consume a noticeable amount of memory.
pub fn min_size() -> usize {
    usize::try_from(env_var::BUN_INSTALL_STREAMING_MIN_SIZE.get()).unwrap()
}

impl<'a> TarballStream<'a> {
    pub fn init(
        extract_task: &'a mut Task,
        network_task: *mut NetworkTask,
        manager: &'a PackageManager,
    ) -> *mut TarballStream<'a> {
        let tarball = &extract_task.request.extract.tarball;

        // For GitHub/URL/local tarballs we need a SHA-512 to record in the
        // lockfile even when there is no expected value to verify against,
        // matching `ExtractTarball.run`.
        let compute_if_missing = matches!(
            tarball.resolution.tag,
            ResolutionTag::Github | ResolutionTag::RemoteTarball | ResolutionTag::LocalTarball
        );

        let npm_mode = tarball.resolution.tag != ResolutionTag::Github;
        let want_first_dirname = tarball.resolution.tag == ResolutionTag::Github;
        let hasher = integrity::Streaming::init(
            if tarball.skip_verify { Integrity::default() } else { tarball.integrity },
            compute_if_missing,
        );

        // bun.TrivialNew(@This()) → Box::into_raw(Box::new(...)). Pointer is
        // recovered via @fieldParentPtr from the thread-pool callback and
        // freed in `finish()` via Box::from_raw.
        Box::into_raw(Box::new(TarballStream {
            mutex: Mutex::new(),
            pending: Vec::new(),
            closed: false,
            http_err: None,
            status_code: 0,
            draining: AtomicBool::new(false),
            reading: Vec::new(),
            read_pos: 0,
            archive: None,
            phase: Phase::WantHeader,
            out_fd: None,
            use_pwrite: cfg!(unix),
            use_lseek: true,
            entry_actual_offset: 0,
            entry_final_offset: 0,
            dest: None,
            tmpname: c"".into(),
            hasher,
            resolved_github_dirname: b"",
            want_first_dirname,
            npm_mode,
            bytes_received: 0,
            entry_count: 0,
            fail: None,
            drain_task: thread_pool::Task { callback: drain_callback },
            extract_task,
            network_task,
            package_manager: manager,
        }))
    }

    /// Called from the HTTP thread for each response-body chunk. Returns
    /// without touching the filesystem or libarchive; actual processing is
    /// deferred to `drain` on a worker so the HTTP event loop stays
    /// responsive.
    pub fn on_chunk(&mut self, chunk: &[u8], is_last: bool, err: Option<bun_core::Error>) {
        self.mutex.lock();
        if !chunk.is_empty() {
            self.pending.extend_from_slice(chunk);
            self.bytes_received += chunk.len();
        }
        if is_last {
            self.closed = true;
        }
        if let Some(e) = err {
            self.http_err = Some(e);
        }
        self.mutex.unlock();

        self.schedule_drain();
    }

    fn schedule_drain(&mut self) {
        if self.draining.swap(true, Ordering::AcqRel) {
            return;
        }
        self.package_manager
            .thread_pool
            .schedule(thread_pool::Batch::from(&mut self.drain_task));
    }

    /// Pull whatever compressed bytes are available into libarchive, writing
    /// entries to disk, until libarchive reports `ARCHIVE_RETRY` (out of
    /// input — yield) or a terminal state (EOF / error — finish).
    fn drain(&mut self) {
        Output::Source::configure_thread();

        loop {
            if self.fail.is_none() && self.phase != Phase::Done {
                // Only pull bytes into `reading` while libarchive is still
                // going to consume them. After EOF/failure `step()` is
                // never called again, so appending here would let
                // `reading` grow by one HTTP chunk per wakeup for the
                // remainder of the download.
                let more = self.take_pending();

                if let Err(err) = self.step() {
                    self.fail = Some(err);
                    self.close_output_file();
                }

                if self.fail.is_none() && self.phase != Phase::Done {
                    if more {
                        continue;
                    }
                    // libarchive consumed everything we had. Yield the
                    // worker until the HTTP thread delivers the next
                    // chunk.
                    self.draining.store(false, Ordering::Release);
                    // Close the race between clearing `draining` and a
                    // chunk arriving: if `pending` is non-empty now, try
                    // to reclaim the flag ourselves instead of waiting
                    // for the next schedule.
                    self.mutex.lock();
                    let again = !self.pending.is_empty() || self.closed;
                    self.mutex.unlock();
                    if again && !self.draining.swap(true, Ordering::AcqRel) {
                        continue;
                    }
                    return;
                }
            }

            // Terminal: archive finished or extraction failed. libarchive
            // will not be called again, so `reading` is dead — drop it
            // now rather than carrying its capacity until `finish()`.
            // `reading` is drain-local (only the read callback touches
            // it, and that runs inside `step()`), so this needs no lock.
            self.reading = Vec::new();
            self.read_pos = 0;

            self.mutex.lock();
            // Hash any bytes that arrived after libarchive hit
            // end-of-archive so the integrity digest covers the full
            // response (tar zero-padding, gzip footer). Skip this once
            // an error is recorded — the digest won't be checked anyway.
            if self.fail.is_none() && !self.pending.is_empty() {
                self.hasher.update(&self.pending);
            }
            // After EOF/failure we stop feeding libarchive but must keep
            // consuming (and discarding) chunks until the HTTP thread
            // closes the stream; freeing ourselves earlier would let the
            // next `notify` dereference a dead pointer.
            self.pending.clear();
            let closed = self.closed;
            let http_err = self.http_err;
            self.mutex.unlock();
            // A transport error that arrives *after* libarchive reached
            // EOF (e.g. the server RSTs the connection once the last
            // byte is on the wire) must not override a successful
            // extraction; the integrity check in `populate_result()` is
            // the sole arbiter of correctness once `Done` is reached.
            if let Some(e) = http_err {
                if self.fail.is_none() && self.phase != Phase::Done {
                    self.fail = Some(e);
                }
            }
            if closed {
                self.finish();
                return;
            }

            // Archive is done (or failed) but the HTTP response has not
            // finished yet. Yield; the next `on_chunk` will reschedule us
            // to discard the new bytes and eventually observe `closed`.
            self.draining.store(false, Ordering::Release);
            self.mutex.lock();
            let again = !self.pending.is_empty() || self.closed;
            self.mutex.unlock();
            if again && !self.draining.swap(true, Ordering::AcqRel) {
                continue;
            }
            return;
        }
    }

    /// Move any bytes still sitting in `pending` into `reading` so the read
    /// callback can hand them to libarchive. Returns true if new bytes were
    /// added or the stream is now closed.
    fn take_pending(&mut self) -> bool {
        self.mutex.lock();
        let guard = scopeguard::guard(&mut self.mutex, |m| m.unlock());
        // PORT NOTE: `defer this.mutex.unlock()` → scopeguard; the early-return
        // path below must release the lock.

        if self.pending.is_empty() {
            let closed = self.closed;
            drop(guard);
            return closed;
        }

        // Hash before libarchive sees the bytes so integrity covers exactly
        // what came off the socket.
        self.hasher.update(&self.pending);

        if self.reading.len() == self.read_pos {
            // Previous buffer fully consumed — swap so the HTTP thread can
            // reuse its capacity without reallocating.
            self.reading.clear();
            core::mem::swap(&mut self.reading, &mut self.pending);
            self.read_pos = 0;
        } else {
            // libarchive still holds a slice into `reading` (the read
            // callback contract keeps the last-returned buffer valid until
            // the next call). Appending would realloc and invalidate that
            // slice, so instead shift the unconsumed tail down and append
            // in place — the callback is not running concurrently with us
            // (single drain at a time) and will be re-primed with the new
            // base on its next invocation.
            let remaining = self.reading.len() - self.read_pos;
            self.reading.copy_within(self.read_pos.., 0);
            self.reading.truncate(remaining);
            self.read_pos = 0;
            self.reading.extend_from_slice(&self.pending);
            self.pending.clear();
        }
        drop(guard);
        true
        // TODO(port): scopeguard above borrows `&mut self.mutex` while other
        // fields are also borrowed; Phase B may need to split borrows or
        // restructure as explicit unlock calls (the Zig path is linear).
    }

    /// Run libarchive until it needs more input (`Retry`) or hits a
    /// terminal state. All libarchive state persists on the heap, so
    /// returning from here and re-entering later is safe.
    fn step(&mut self) -> Result<(), bun_core::Error> {
        if self.archive.is_none() {
            self.open_archive()?;
        }
        if self.dest.is_none() {
            self.open_destination()?;
        }

        // SAFETY: archive is Some after open_archive() succeeds.
        let archive = unsafe { &mut *self.archive.unwrap() };

        loop {
            match self.phase {
                Phase::Done => return Ok(()),
                Phase::WantHeader => {
                    let mut entry: *mut lib::archive::Entry = core::ptr::null_mut();
                    match archive.read_next_header(&mut entry) {
                        lib::archive::Result::Retry => return Ok(()),
                        lib::archive::Result::Eof => {
                            self.phase = Phase::Done;
                            return Ok(());
                        }
                        lib::archive::Result::Ok | lib::archive::Result::Warn => {
                            // SAFETY: libarchive returned OK/WARN with a valid entry ptr.
                            self.begin_entry(unsafe { &mut *entry })?;
                        }
                        lib::archive::Result::Failed | lib::archive::Result::Fatal => {
                            bun_output::scoped_log!(
                                TarballStream,
                                "readNextHeader: {}",
                                bstr::BStr::new(archive.error_string())
                            );
                            return Err(bun_core::err!("Fail"));
                        }
                    }
                }
                Phase::WantData => {
                    let mut offset: i64 = 0;
                    let Some(block) = archive.next(&mut offset) else {
                        // End of this entry's data.
                        self.close_output_file();
                        self.phase = Phase::WantHeader;
                        continue;
                    };
                    match block.result {
                        lib::archive::Result::Retry => return Ok(()),
                        lib::archive::Result::Ok | lib::archive::Result::Warn => {
                            if let Some(fd) = self.out_fd {
                                self.write_data_block(fd, block)?;
                            }
                        }
                        _ => {
                            bun_output::scoped_log!(
                                TarballStream,
                                "read_data_block: {}",
                                bstr::BStr::new(archive.error_string())
                            );
                            return Err(bun_core::err!("Fail"));
                        }
                    }
                }
            }
        }
    }

    fn open_archive(&mut self) -> Result<(), bun_core::Error> {
        let archive = lib::Archive::read_new();
        let guard = scopeguard::guard(archive, |a| {
            // SAFETY: errdefer cleanup — archive is a valid handle from read_new().
            unsafe {
                let _ = (*a).read_close();
                let _ = (*a).read_free();
            }
        });
        // Bypass bidding entirely: the stream is always gzip → tar, and
        // bidding would try to read-ahead before any bytes have arrived.
        // ARCHIVE_FILTER_GZIP = 1, ARCHIVE_FORMAT_TAR = 0x30000.
        // SAFETY: archive is a valid non-null handle from read_new(); FFI call has no other preconditions.
        if unsafe { lib::archive_read_append_filter(archive.cast(), 1) } != 0 {
            return Err(bun_core::err!("Fail"));
        }
        // SAFETY: archive is a valid non-null handle from read_new(); FFI call has no other preconditions.
        if unsafe { lib::archive_read_set_format(archive.cast(), 0x30000) } != 0 {
            return Err(bun_core::err!("Fail"));
        }
        // SAFETY: archive is a valid handle.
        let _ = unsafe { (*archive).read_set_options(c"read_concatenated_archives") };

        // SAFETY: @enumFromInt on the libarchive return code.
        let rc: lib::archive::Result = unsafe {
            core::mem::transmute::<c_int, lib::archive::Result>(lib::archive_read_open(
                archive.cast(),
                self as *mut Self as *mut c_void,
                None,
                Some(archive_read_callback),
                None,
            ))
        };
        match rc {
            lib::archive::Result::Ok | lib::archive::Result::Warn => {}
            lib::archive::Result::Retry => {
                // open() runs the filter bidder which we bypassed, but the
                // client open path may still probe; treat as transient.
                self.archive = Some(scopeguard::ScopeGuard::into_inner(guard));
                return Ok(());
            }
            _ => {
                bun_output::scoped_log!(
                    TarballStream,
                    "archive_read_open: {}",
                    // SAFETY: archive is a valid handle (guard not yet dropped).
                    bstr::BStr::new(unsafe { (*archive).error_string() })
                );
                return Err(bun_core::err!("Fail"));
            }
        }
        self.archive = Some(scopeguard::ScopeGuard::into_inner(guard));
        Ok(())
    }

    fn open_destination(&mut self) -> Result<(), bun_core::Error> {
        let tarball = &self.extract_task.request.extract.tarball;
        let (_, basename) = tarball.name_and_basename();
        let mut buf = PathBuffer::uninit();
        let tmpname = FileSystem::tmpname(
            &basename[0..basename.len().min(32)],
            buf.as_mut_slice(),
            bun_core::fast_random(),
        )?;
        // TODO(port): allocator.dupeZ → owned NUL-terminated copy.
        self.tmpname = bun_str::ZStr::from_bytes(tmpname).into();

        self.dest = Some(Fd::from_std_dir(
            // TODO(port): bun.MakePath.makeOpenPath — verify crate path.
            bun_sys::make_path::make_open_path(tarball.temp_dir, self.tmpname.to_bytes())?,
        ));
        Ok(())
    }

    fn close_output_file(&mut self) {
        if let Some(fd) = self.out_fd {
            // Same trailing-hole handling as `Archive.readDataIntoFd`:
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
    fn begin_entry(&mut self, entry: &mut lib::archive::Entry) -> Result<(), bun_core::Error> {
        #[cfg(windows)]
        let mut pathname: OSPathZ = entry.pathname_w();
        #[cfg(not(windows))]
        let mut pathname: OSPathZ = entry.pathname();

        if self.want_first_dirname {
            self.want_first_dirname = false;
            // GitHub's archive API always emits an explicit `repo-sha/`
            // directory entry first, which is what the buffered path
            // relies on. Take only the leading component so a tarball
            // whose first member is `repo-sha/file` (no directory entry)
            // still yields the correct cache-folder name.
            let mut root_it = pathname
                .as_slice()
                .split(|c| *c == ('/' as OSPathChar))
                .filter(|s| !s.is_empty());
            let root: &[OSPathChar] = root_it.next().unwrap_or(&[]);
            #[cfg(windows)]
            {
                let result = strings::to_utf8_list_with_type(Vec::new(), root)?;
                self.resolved_github_dirname = FileSystem::DirnameStore::instance()
                    .append(&result)
                    .expect("unreachable");
            }
            #[cfg(not(windows))]
            {
                // TODO(port): bun.asByteSlice(root) — on posix OSPathChar==u8, so this is a no-op cast.
                self.resolved_github_dirname = FileSystem::DirnameStore::instance()
                    .append(root)
                    .expect("unreachable");
            }
        }

        let kind = bun_sys::kind_from_mode(entry.filetype());

        if self.npm_mode && kind != bun_sys::Kind::File {
            // npm tarballs only contain files; matching the libarchive path
            // in Archiver.extractToDir we skip everything else.
            self.phase = Phase::WantData;
            self.out_fd = None;
            return Ok(());
        }

        // Strip the leading `package/` (or `<repo>-<sha>/` for GitHub) and
        // normalise. Same transformation as Archiver.extractToDir so both
        // paths produce identical on-disk layouts.
        let mut tokenizer = pathname
            .as_slice()
            .split(|c| *c == ('/' as OSPathChar))
            .filter(|s| !s.is_empty());
        if tokenizer.next().is_none() {
            self.phase = Phase::WantData;
            self.out_fd = None;
            return Ok(());
        }
        // TODO(port): tokenizeScalar.rest() — need byte offset of remainder, not
        // just iterator. `split().filter()` loses that. Phase B: use a manual
        // index-of-first-'/' + skip-leading-'/' instead.
        let rest: &[OSPathChar] = tokenizer_rest_placeholder(pathname.as_slice());
        // SAFETY: `rest` is a suffix of the original NUL-terminated `pathname`;
        // `rest.ptr[rest.len]` is the same NUL byte.
        pathname = unsafe { bun_paths::OSPathZStr::from_raw(rest.as_ptr(), rest.len()) };

        let mut norm_buf = OSPathBuffer::uninit();
        let normalized =
            bun_paths::normalize_buf_t::<OSPathChar>(pathname.as_slice(), norm_buf.as_mut_slice(), bun_paths::Style::Auto);
        let norm_len = normalized.len();
        norm_buf.as_mut_slice()[norm_len] = 0;
        // SAFETY: norm_buf[norm_len] == 0 written above.
        let path: OSPathZMut =
            unsafe { bun_paths::OSPathZStr::from_raw_mut(norm_buf.as_mut_ptr(), norm_len) };
        if path.is_empty() || (path.len() == 1 && path[0] == ('.' as OSPathChar)) {
            self.phase = Phase::WantData;
            self.out_fd = None;
            return Ok(());
        }
        // `normalize_buf_t` collapses interior `..` but leaves a leading `..`
        // on a relative input. Reject those so `openat(dest_fd, ...)` can
        // never escape the temp extraction root. `Archiver.extractToDir`
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
        #[cfg(windows)]
        {
            if bun_paths::is_absolute_windows_wtf16(path.as_slice()) {
                self.phase = Phase::WantData;
                self.out_fd = None;
                return Ok(());
            }
            if self.npm_mode {
                apply_windows_npm_path_escapes(path);
            }
        }

        let path_slice: &[OSPathChar] = path.as_slice();
        let dest = self.dest.unwrap();

        match kind {
            bun_sys::Kind::Directory => {
                make_directory(entry, dest, path, path_slice);
                self.phase = Phase::WantData;
                self.out_fd = None;
            }
            bun_sys::Kind::SymLink => {
                #[cfg(unix)]
                make_symlink(entry, dest, path, path_slice);
                self.phase = Phase::WantData;
                self.out_fd = None;
            }
            bun_sys::Kind::File => {
                #[cfg(windows)]
                let mode: Mode = 0;
                #[cfg(not(windows))]
                let mode: Mode = Mode::try_from(entry.perm() | 0o666).unwrap();
                let fd = open_output_file(dest, path, path_slice, mode)?;
                self.entry_count += 1;

                #[cfg(target_os = "linux")]
                {
                    let size: usize = usize::try_from(entry.size().max(0)).unwrap();
                    if size > 1_000_000 {
                        let _ = bun_sys::preallocate_file(
                            fd.cast(),
                            0,
                            i64::try_from(size).unwrap(),
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
    /// sparse/pwrite handling in `Archive.readDataIntoFd` but operates on a
    /// single block so it can be interleaved with ARCHIVE_RETRY yields.
    /// `entry_actual_offset` / `entry_final_offset` persist across calls so
    /// `close_output_file` can perform the same trailing `ftruncate` the
    /// buffered path does after its block loop.
    fn write_data_block(&mut self, fd: Fd, block: lib::archive::Block) -> Result<(), bun_core::Error> {
        let file = bun_sys::File { handle: fd };
        let data = block.bytes;
        if data.is_empty() {
            return Ok(());
        }

        self.entry_final_offset = self
            .entry_final_offset
            .max(block.offset + i64::try_from(data.len()).unwrap());

        #[cfg(unix)]
        {
            if self.use_pwrite {
                match file.pwrite_all(data, block.offset) {
                    Ok(_) => {
                        self.entry_actual_offset = self
                            .entry_actual_offset
                            .max(block.offset + i64::try_from(data.len()).unwrap());
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
                match bun_sys::set_file_offset(fd, u64::try_from(block.offset).unwrap()) {
                    Ok(_) => {
                        self.entry_actual_offset = block.offset;
                        break 'seek;
                    }
                    Err(_) => self.use_lseek = false,
                }
            }
            if block.offset > self.entry_actual_offset {
                let zero_count: usize =
                    usize::try_from(block.offset - self.entry_actual_offset).unwrap();
                match lib::Archive::write_zeros_to_file(file, zero_count) {
                    lib::archive::WriteZerosResult::Ok => {
                        self.entry_actual_offset = block.offset;
                    }
                    _ => return Err(bun_core::err!("Fail")),
                }
            } else {
                return Err(bun_core::err!("Fail"));
            }
        }

        match file.write_all(data) {
            Ok(_) => {
                self.entry_actual_offset += i64::try_from(data.len()).unwrap();
                Ok(())
            }
            Err(e) => Err(bun_sys::errno_to_error(e.errno)),
        }
    }

    fn finish(&mut self) {
        // PORT NOTE: reshaped for borrowck — capture raw pointers to
        // `extract_task`/`network_task`/`package_manager` because `self` is
        // dropped (Box::from_raw) mid-function. See TODO at struct decl.
        let task: *mut Task = self.extract_task as *mut Task;
        let network: *mut NetworkTask = self.network_task;
        let manager: *const PackageManager = self.package_manager as *const PackageManager;

        self.close_output_file();

        // The HTTP thread has delivered the final `has_more=false` chunk
        // (that's the only way `closed` gets set) and `notify()` does not
        // touch `response_buffer` again after that hand-off, so we own it
        // now. The main thread reads only `streaming_committed` when it
        // later processes the NetworkTask, so freeing the buffer here is
        // safe and matches the `defer buffer.deinit()` in the buffered
        // `.extract` arm of `Task.callback`.
        // SAFETY: see comment above; network_task is live until published below.
        unsafe { (*network).response_buffer = Default::default() };

        // SAFETY: task is live until pushed onto resolve_tasks below.
        self.populate_result(unsafe { &mut *task });

        // Temp-dir cleanup must happen before we release the stream or
        // publish the task: both `self.tmpname` and
        // `task.request.extract.tarball.temp_dir` become invalid once
        // `Drop` runs / the main thread recycles the Task.
        // SAFETY: task is live (see above).
        if unsafe { (*task).status } != TaskStatus::Success && !self.tmpname.to_bytes().is_empty() {
            // `populate_result` closes `dest` on the success path before the
            // rename; the early-return failure paths leave it open, so close
            // it here first — Windows can't remove an open directory.
            // `Drop` null-checks so this is not a double-close.
            if let Some(d) = self.dest.take() {
                d.close();
            }
            // SAFETY: task is live (see above).
            let _ = unsafe { &(*task).request.extract.tarball }
                .temp_dir
                .delete_tree(self.tmpname.to_bytes());
        }

        // SAFETY: self was allocated via Box::into_raw in `init()`; this is
        // the sole owner and the only place it is reclaimed. After this line
        // `self` is dangling — nothing below may touch it.
        // TODO(port): self-destruction inside `&mut self` method — Phase B
        // should reshape `drain`/`finish` to consume `*mut Self` directly.
        unsafe { drop(Box::from_raw(self as *mut Self)) };

        // `task.apply_patch_task` is intentionally not touched: the
        // buffered `.extract` path (`enqueueExtractNPMPackage` →
        // `Task.callback`) never populates it for npm tarballs either —
        // patching is handled later by the install phase.
        //
        // Publish last: once the task is on `resolve_tasks` the main
        // thread may immediately recycle it *and* the NetworkTask it
        // references, so nothing below this line may touch either.
        // SAFETY: manager/task outlive this stream by construction.
        unsafe {
            (*manager).resolve_tasks.push(&mut *task);
            (*manager).wake();
        }
    }

    fn populate_result(&mut self, task: &mut Task) {
        let tarball = &task.request.extract.tarball;
        task.data = TaskData::Extract(Default::default());

        if let Some(err) = self.fail {
            task.log
                .add_error_fmt(
                    None,
                    logger::Loc::EMPTY,
                    format_args!(
                        "{} extracting tarball for \"{}\"",
                        err.name(),
                        bstr::BStr::new(tarball.name.slice()),
                    ),
                )
                .expect("unreachable");
            task.err = Some(err);
            task.status = TaskStatus::Fail;
            return;
        }

        if !tarball.skip_verify && tarball.integrity.tag.is_supported() {
            if !self.hasher.verify() {
                task.log
                    .add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "Integrity check failed<r> for tarball: {}",
                            bstr::BStr::new(tarball.name.slice()),
                        ),
                    )
                    .expect("unreachable");
                task.err = Some(bun_core::err!("IntegrityCheckFailed"));
                task.status = TaskStatus::Fail;
                return;
            }
        }

        if tarball.resolution.tag == ResolutionTag::Github {
            'insert_tag: {
                if self.resolved_github_dirname.is_empty() {
                    break 'insert_tag;
                }
                let Ok(gh_tag) = bun_sys::openat(
                    self.dest.unwrap(),
                    c".bun-tag",
                    O::WRONLY | O::CREAT | O::TRUNC,
                    0o644,
                ) else {
                    break 'insert_tag;
                };
                let r = (bun_sys::File { handle: gh_tag }).write_all(self.resolved_github_dirname);
                gh_tag.close();
                if r.is_err() {
                    let _ = bun_sys::unlinkat(self.dest.unwrap(), c".bun-tag");
                }
            }
        }

        // Close the temp dir handle before renaming so Windows can move it.
        if let Some(d) = self.dest.take() {
            d.close();
        }

        let (name, basename) = tarball.name_and_basename();

        let mut result = match tarball.move_to_cache_directory(
            &mut task.log,
            self.tmpname.to_bytes(),
            name,
            basename,
            self.resolved_github_dirname,
        ) {
            Ok(r) => r,
            Err(err) => {
                task.err = Some(err);
                task.status = TaskStatus::Fail;
                return;
            }
        };

        match tarball.resolution.tag {
            ResolutionTag::Github | ResolutionTag::RemoteTarball | ResolutionTag::LocalTarball => {
                if tarball.integrity.tag.is_supported() {
                    result.integrity = tarball.integrity;
                } else {
                    result.integrity = self.hasher.final_();
                }
            }
            _ => {}
        }

        if PackageManager::verbose_install() {
            Output::pretty_errorln(format_args!(
                "[{}] Streamed {} tarball → {} entries<r>",
                bstr::BStr::new(name),
                bun_fmt::size(self.bytes_received, Default::default()),
                self.entry_count,
            ));
            Output::flush();
        }

        task.data = TaskData::Extract(result);
        task.status = TaskStatus::Success;
    }

    /// Prepare this stream for another HTTP attempt after a failed request
    /// that never scheduled a drain.
    pub fn reset_for_retry(&mut self) {
        self.mutex.lock();
        self.pending.clear();
        self.closed = false;
        self.http_err = None;
        self.status_code = 0;
        self.bytes_received = 0;
        self.mutex.unlock();
    }
}

impl<'a> Drop for TarballStream<'a> {
    fn drop(&mut self) {
        if let Some(fd) = self.out_fd {
            fd.close();
        }
        if let Some(d) = self.dest {
            d.close();
        }
        if let Some(a) = self.archive {
            // SAFETY: `a` is a live libarchive handle owned by this struct.
            unsafe {
                let _ = (*a).read_close();
                let _ = (*a).read_free();
            }
        }
        // `tmpname`, `pending`, `reading` drop automatically.
    }
}

fn drain_callback(task: *mut thread_pool::Task) {
    // SAFETY: `task` points to `TarballStream.drain_task`; recover the parent
    // via offset_of (Zig: @fieldParentPtr("drain_task", task)).
    let this: *mut TarballStream = unsafe {
        (task as *mut u8)
            .sub(offset_of!(TarballStream, drain_task))
            .cast::<TarballStream>()
    };
    // SAFETY: the thread pool guarantees `task` is live for the duration of
    // the callback, and only one drain runs at a time (see `draining` flag).
    unsafe { (*this).drain() };
}

/// libarchive client read callback. Returns whatever compressed bytes
/// are currently buffered in `reading`; if none, returns `ARCHIVE_RETRY`
/// (when more data is still expected) so libarchive unwinds with a
/// resumable status, or `0` (EOF) once the HTTP response is complete.
extern "C" fn archive_read_callback(
    _a: *mut lib::struct_archive,
    ctx: *mut c_void,
    out_buffer: *mut *const c_void,
) -> lib::la_ssize_t {
    // SAFETY: `ctx` was set to `self` in `open_archive`; libarchive passes it
    // back unchanged. Only one drain runs at a time so `&mut` is exclusive.
    let this: &mut TarballStream = unsafe { &mut *(ctx as *mut TarballStream) };

    let remaining = &this.reading[this.read_pos..];
    if !remaining.is_empty() {
        // SAFETY: out_buffer is a valid out-param per libarchive contract.
        unsafe { *out_buffer = remaining.as_ptr().cast() };
        this.read_pos = this.reading.len();
        return lib::la_ssize_t::try_from(remaining.len()).unwrap();
    }

    // No data left in `reading`. Check for more under the lock —
    // libarchive may have called us more than once for a single
    // `step()` (e.g. gzip header + first deflate block), and `on_chunk`
    // might have landed a fresh chunk in the meantime.
    this.mutex.lock();
    let has_pending = !this.pending.is_empty();
    let closed = this.closed;
    this.mutex.unlock();

    if has_pending {
        // Pull the new bytes into `reading` and retry the read. We are
        // the only consumer of `reading`/`read_pos`, and `take_pending`
        // only touches producer state under the same mutex.
        let _ = this.take_pending();
        let again = &this.reading[this.read_pos..];
        if !again.is_empty() {
            // SAFETY: out_buffer is a valid out-param per libarchive contract.
            unsafe { *out_buffer = again.as_ptr().cast() };
            this.read_pos = this.reading.len();
            return lib::la_ssize_t::try_from(again.len()).unwrap();
        }
    }

    if closed {
        // SAFETY: out_buffer is a valid out-param; ptr is unused when len==0.
        unsafe { *out_buffer = (this as *mut TarballStream).cast() };
        return 0;
    }

    // Tell libarchive to unwind with a resumable status. The BUN PATCHes
    // in vendor/libarchive make every layer (filter_ahead → gzip → tar)
    // preserve its state and propagate ARCHIVE_RETRY to our `step()`
    // loop, which then returns so this worker can be reused.
    lib::archive::Result::Retry as lib::la_ssize_t
}

fn open_output_file(
    dest_fd: Fd,
    path: OSPathZ,
    path_slice: &[OSPathChar],
    mode: Mode,
) -> Result<Fd, bun_core::Error> {
    let flags = O::WRONLY | O::CREAT | O::TRUNC;
    #[cfg(windows)]
    {
        return match bun_sys::openat_windows(dest_fd, path, flags, 0) {
            Ok(fd) => Ok(fd),
            Err(e) => match e.errno {
                x if x == bun_sys::E::PERM as _ || x == bun_sys::E::NOENT as _ => 'brk: {
                    let Some(dir) = bun_paths::Dirname::dirname::<u16>(path_slice) else {
                        return Err(bun_sys::errno_to_error(e.errno));
                    };
                    let _ = dest_fd.make_path::<u16>(dir);
                    break 'brk bun_sys::openat_windows(dest_fd, path, flags, 0)
                        .map_err(|e| bun_sys::errno_to_error(e.errno));
                }
                _ => Err(bun_sys::errno_to_error(e.errno)),
            },
        };
    }
    #[cfg(not(windows))]
    {
        match bun_sys::openat(dest_fd, path, flags, mode) {
            Ok(fd) => Ok(fd),
            Err(e) => match e.errno() {
                bun_sys::E::ACCES | bun_sys::E::NOENT => 'brk: {
                    let Some(dir) = bun_paths::dirname(path_slice) else {
                        return Err(bun_sys::errno_to_error(e.errno));
                    };
                    let _ = dest_fd.make_path::<u8>(dir);
                    break 'brk bun_sys::openat(dest_fd, path, flags, mode)
                        .map_err(|e| bun_sys::errno_to_error(e.errno));
                }
                _ => Err(bun_sys::errno_to_error(e.errno)),
            },
        }
    }
}

fn make_directory(
    entry: &mut lib::archive::Entry,
    dest_fd: Fd,
    path: OSPathZ,
    path_slice: &[OSPathChar],
) {
    let mut mode = i32::try_from(entry.perm()).unwrap();
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
        let _ = dest_fd.make_path::<u16>(path.as_slice());
        let _ = (path_slice, mode);
    }
    #[cfg(not(windows))]
    {
        match bun_sys::mkdirat_z(dest_fd, path, Mode::try_from(mode).unwrap()) {
            Ok(()) => {}
            Err(e) => match e.errno() {
                bun_sys::E::EXIST | bun_sys::E::NOTDIR => {}
                _ => {
                    let Some(dir) = bun_paths::dirname(path_slice) else {
                        return;
                    };
                    let _ = dest_fd.make_path::<u8>(dir);
                    let _ = bun_sys::mkdirat_z(dest_fd, path, 0o777);
                }
            },
        }
    }
}

#[cfg(unix)]
fn make_symlink(
    entry: &mut lib::archive::Entry,
    dest_fd: Fd,
    path: OSPathZ,
    path_slice: &[OSPathChar],
) {
    let target = entry.symlink();
    // Same safety rule as `isSymlinkTargetSafe` in the buffered path:
    // reject absolute targets and anything that escapes via `..`.
    if target.is_empty() || target[0] == b'/' {
        return;
    }
    {
        let symlink_dir = bun_paths::dirname(path_slice).unwrap_or(b"");
        let mut join_buf = PathBuffer::uninit();
        let resolved = bun_paths::join_abs_string_buf(
            b"/packages/",
            join_buf.as_mut_slice(),
            &[symlink_dir, target],
            bun_paths::Style::Posix,
        );
        if !resolved.starts_with(b"/packages/") {
            return;
        }
    }
    match bun_sys::symlinkat(target, dest_fd, path) {
        Ok(()) => {}
        Err(e) if e == bun_core::err!("EPERM") || e == bun_core::err!("ENOENT") => {
            let Some(dir) = bun_paths::dirname(path_slice) else {
                return;
            };
            let _ = dest_fd.make_path::<u8>(dir);
            let _ = bun_sys::symlinkat(target, dest_fd, path);
        }
        Err(_) => {}
    }
}

#[cfg(windows)]
fn apply_windows_npm_path_escapes(path: OSPathZMut) {
    // Same transformation as Archiver.extractToDir: encode characters
    // Windows rejects in filenames into the 0xf000 private-use range so
    // the extraction round-trips with node-tar.
    let mut remain: &mut [OSPathChar] = path.as_mut_slice();
    if strings::starts_with_windows_drive_letter(remain) {
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

// TODO(port): helper for `std.mem.tokenizeScalar(...).rest()` semantics on
// `[OSPathChar]` — after one `next()`, Zig's `TokenIterator.rest()` returns
// `buffer[index..]` where index sits at the delimiter immediately following
// the first token (leading `/` is INCLUDED). Phase B: move into bun_str or
// bun_paths.
fn tokenizer_rest_placeholder(s: &[OSPathChar]) -> &[OSPathChar] {
    let mut i = 0;
    while i < s.len() && s[i] == ('/' as OSPathChar) {
        i += 1;
    }
    while i < s.len() && s[i] != ('/' as OSPathChar) {
        i += 1;
    }
    &s[i..]
}

// TODO(port): these enum/type references are guesses at the Rust-side names in
// bun_install; Phase B will pin them down.
use bun_install::install::{ResolutionTag, TaskData, TaskStatus};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/TarballStream.zig (940 lines)
//   confidence: medium
//   todos:      11
//   notes:      intrusive thread-pool task + self-destroy-in-method (`finish`); &'a borrows from LIFETIMES.tsv likely need raw ptrs; tokenizeScalar.rest() and OS-path Z-slice types are placeholders.
// ──────────────────────────────────────────────────────────────────────────

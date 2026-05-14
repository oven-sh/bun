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
use core::mem::{ManuallyDrop, offset_of};
use core::sync::atomic::{AtomicBool, Ordering};

use bun_collections::VecExt;
use bun_core::strings;
use bun_core::{self, Output, ZBox, env_var, fmt as bun_fmt};
use bun_libarchive::lib;
use bun_paths::resolve_path::{self, platform};
use bun_paths::{self, OSPathBuffer, OSPathChar, OSPathSlice, OSPathSliceZ, PathBuffer};
use bun_sys::{self, Dir, E, Fd, FdDirExt, FdExt, FileKind, Mode, O};
use bun_threading::{Mutex, ThreadPool, thread_pool};

use crate::NetworkTask;
use crate::bun_fs::FileSystem;
use crate::integrity::{self, Integrity};
use crate::package_manager_real::PackageManager;

// `crate::Task` is a `()` stub; the real Task lives in `package_manager_task`.
// `'static` is sound here because we only ever hold raw `*mut Task` and never
// materialise a `&'static` borrow of the inner `Request` lifetime.
type Task = crate::package_manager_task::Task<'static>;

bun_output::declare_scope!(TarballStream, hidden);

// Zig: `[:0]const bun.OSPathChar` / `[:0]bun.OSPathChar` / `bun.OSPathSliceZ`.
type OSPathZ<'a> = &'a OSPathSliceZ;
type OSPathZMut<'a> = &'a mut OSPathSliceZ;

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

// PORT NOTE: `extract_task` / `package_manager` are raw pointers, not
// `&'a mut` / `&'a`. The Zig original stores `*Task` / `*PackageManager`
// (freely-aliasing). This struct is heap-allocated (`heap::alloc`),
// crosses threads via `drain_task`, and self-destroys in `finish()`, so a
// borrowed lifetime cannot be sound. Holding `&'a mut Task` here while
// `populate_result` materialises another `&mut Task` from a raw copy of it
// would be aliased UB; raw pointers match the Zig aliasing contract.
pub struct TarballStream {
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
    // Zig `[:0]const u8` field freed via `allocator.free`. `ZBox` is the
    // owned NUL-terminated counterpart of `&ZStr` (port of `dupeZ`).
    tmpname: ZBox,

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
    /// BACKREF — `*mut Task` constructed via `ParentRef::from_raw_mut` so the
    /// read-only `request_extract()` accessor in `open_destination` goes
    /// through safe `Deref`; `finish()` recovers the raw via `as_mut_ptr()`.
    extract_task: bun_ptr::ParentRef<Task>,
    network_task: *mut NetworkTask,
    package_manager: *mut PackageManager,
}

impl TarballStream {
    /// Minimum Content-Length for which the streaming path is used. Below
    /// this the whole body is buffered as before; the resumable libarchive
    /// state machine is only worth its per-chunk overhead for tarballs that
    /// would otherwise consume a noticeable amount of memory.
    pub fn min_size() -> usize {
        // env_var.get() returns Option<u64> in the Rust port even when a default
        // is configured (Zig collapses it at comptime); the var has a 2 MiB
        // default so unwrap is infallible here.
        usize::try_from(env_var::BUN_INSTALL_STREAMING_MIN_SIZE.get().unwrap()).expect("int cast")
    }

    pub fn init(
        extract_task: *mut Task,
        network_task: *mut NetworkTask,
        manager: *mut PackageManager,
    ) -> *mut TarballStream {
        // Caller guarantees `extract_task` is live for the lifetime of this
        // stream (it is published back to the main thread only in `finish()`);
        // see Zig `init` which takes `*Task`. Wrapped once as `ParentRef` so
        // the union read goes through the centralised tag-checked
        // `request_extract()` accessor; `extract` is the active `Request`
        // variant for streaming tarballs (set by `enqueueExtractNPMPackage`,
        // `tag == Tag::Extract`). Safe `From<NonNull>` construction — caller
        // passes a non-null `*mut Task` (Zig `*Task`).
        let extract_task = bun_ptr::ParentRef::<Task>::from(
            core::ptr::NonNull::new(extract_task).expect("extract_task non-null (Zig *Task)"),
        );
        let tarball = &extract_task.request_extract().tarball;

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
            if tarball.skip_verify {
                Integrity::default()
            } else {
                tarball.integrity
            },
            compute_if_missing,
        );

        // bun.TrivialNew(@This()) → heap::alloc(Box::new(...)). Pointer is
        // recovered via `container_of` from the thread-pool callback and
        // freed in `finish()` via heap::take.
        bun_core::heap::into_raw(Box::new(TarballStream {
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
            tmpname: ZBox::from_bytes(b""),
            hasher,
            resolved_github_dirname: b"",
            want_first_dirname,
            npm_mode,
            bytes_received: 0,
            entry_count: 0,
            fail: None,
            drain_task: thread_pool::Task {
                node: thread_pool::Node::default(),
                callback: drain_callback,
            },
            extract_task,
            network_task,
            package_manager: manager,
        }))
    }

    /// Called from the HTTP thread for each response-body chunk. Returns
    /// without touching the filesystem or libarchive; actual processing is
    /// deferred to `drain` on a worker so the HTTP event loop stays
    /// responsive.
    ///
    /// # Safety
    /// `this` must be the live pointer returned by `init()`. Runs on the
    /// HTTP thread concurrently with `drain()` on a worker, so this never
    /// materialises `&mut TarballStream` — all access is via raw-ptr field
    /// projection (Zig spec: freely-aliasing `*TarballStream`).
    pub unsafe fn on_chunk(
        this: *mut Self,
        chunk: &[u8],
        is_last: bool,
        err: Option<bun_core::Error>,
    ) {
        // SAFETY: see fn-level # Safety — `this` is live, raw-ptr field
        // projection only (no `&mut TarballStream` formed).
        unsafe {
            (*this).mutex.lock();
            if !chunk.is_empty() {
                (*this).pending.extend_from_slice(chunk);
                (*this).bytes_received += chunk.len();
            }
            if is_last {
                (*this).closed = true;
            }
            if let Some(e) = err {
                (*this).http_err = Some(e);
            }
            (*this).mutex.unlock();

            Self::schedule_drain(this);
        }
    }

    /// # Safety
    /// `this` must be live. Runs on the HTTP thread; a worker may be inside
    /// `drain()` concurrently when `draining.swap` returns `true`, so this
    /// never forms `&mut TarballStream`.
    unsafe fn schedule_drain(this: *mut Self) {
        // SAFETY: see fn-level # Safety — `this` is live; `package_manager`
        // outlives this stream (it owns the thread pool that runs us). Field
        // projections via raw ptr — no `&mut TarballStream` is formed.
        unsafe {
            if (*this).draining.swap(true, Ordering::AcqRel) {
                return;
            }
            // `addr_of_mut!` (not `&mut (*this).drain_task`) so the raw
            // pointer inherits `this`'s full-struct provenance: the
            // thread-pool callback recovers the parent `*mut TarballStream`
            // via `offset_of!`, which is OOB for a
            // pointer whose provenance is limited to the `drain_task` field
            // bytes. See ThreadPool.rs:442 for the same pattern.
            (*(*this).package_manager)
                .thread_pool
                .schedule(thread_pool::Batch::from(core::ptr::addr_of_mut!(
                    (*this).drain_task
                )));
        }
    }

    /// Pull whatever compressed bytes are available into libarchive, writing
    /// entries to disk, until libarchive reports `ARCHIVE_RETRY` (out of
    /// input — yield) or a terminal state (EOF / error — finish).
    ///
    /// # Safety
    /// `this` must be the live pointer returned by `init()`. Runs on a
    /// worker thread; the HTTP thread may concurrently call `on_chunk()`
    /// touching the mutex-guarded producer fields, so this never holds a
    /// `&mut TarballStream` across those accesses. May free `*this` (via
    /// `finish`) — caller must not touch `this` after return.
    unsafe fn drain(this: *mut Self) {
        Output::Source::configure_thread();

        // SAFETY: see fn-level # Safety — `this` is live; raw-ptr field
        // projection only. The HTTP thread touches mutex-guarded producer
        // fields concurrently; everything else is drain-local. `finish` may
        // free `*this`; each `return` after it touches nothing.
        unsafe {
            loop {
                if (*this).fail.is_none() && (*this).phase != Phase::Done {
                    // Only pull bytes into `reading` while libarchive is still
                    // going to consume them. After EOF/failure `step()` is
                    // never called again, so appending here would let
                    // `reading` grow by one HTTP chunk per wakeup for the
                    // remainder of the download.
                    let more = Self::take_pending(this);

                    if let Err(err) = Self::step(this) {
                        (*this).fail = Some(err);
                        (*this).close_output_file();
                    }

                    if (*this).fail.is_none() && (*this).phase != Phase::Done {
                        if more {
                            continue;
                        }
                        // libarchive consumed everything we had. Yield the
                        // worker until the HTTP thread delivers the next
                        // chunk.
                        (*this).draining.store(false, Ordering::Release);
                        // Close the race between clearing `draining` and a
                        // chunk arriving: if `pending` is non-empty now, try
                        // to reclaim the flag ourselves instead of waiting
                        // for the next schedule.
                        (*this).mutex.lock();
                        let again = !(*this).pending.is_empty() || (*this).closed;
                        (*this).mutex.unlock();
                        if again && !(*this).draining.swap(true, Ordering::AcqRel) {
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
                (*this).reading = Vec::new();
                (*this).read_pos = 0;

                (*this).mutex.lock();
                // Hash any bytes that arrived after libarchive hit
                // end-of-archive so the integrity digest covers the full
                // response (tar zero-padding, gzip footer). Skip this once
                // an error is recorded — the digest won't be checked anyway.
                if (*this).fail.is_none() && !(*this).pending.is_empty() {
                    (*this).hasher.update(&(*this).pending);
                }
                // After EOF/failure we stop feeding libarchive but must keep
                // consuming (and discarding) chunks until the HTTP thread
                // closes the stream; freeing ourselves earlier would let the
                // next `notify` dereference a dead pointer.
                (*this).pending.clear();
                let closed = (*this).closed;
                let http_err = (*this).http_err;
                (*this).mutex.unlock();
                // A transport error that arrives *after* libarchive reached
                // EOF (e.g. the server RSTs the connection once the last
                // byte is on the wire) must not override a successful
                // extraction; the integrity check in `populate_result()` is
                // the sole arbiter of correctness once `Done` is reached.
                if let Some(e) = http_err {
                    if (*this).fail.is_none() && (*this).phase != Phase::Done {
                        (*this).fail = Some(e);
                    }
                }
                if closed {
                    Self::finish(this);
                    // `this` is freed; nothing below may touch it.
                    return;
                }

                // Archive is done (or failed) but the HTTP response has not
                // finished yet. Yield; the next `on_chunk` will reschedule us
                // to discard the new bytes and eventually observe `closed`.
                (*this).draining.store(false, Ordering::Release);
                (*this).mutex.lock();
                let again = !(*this).pending.is_empty() || (*this).closed;
                (*this).mutex.unlock();
                if again && !(*this).draining.swap(true, Ordering::AcqRel) {
                    continue;
                }
                return;
            }
        } // unsafe
    }

    /// Move any bytes still sitting in `pending` into `reading` so the read
    /// callback can hand them to libarchive. Returns true if new bytes were
    /// added or the stream is now closed.
    ///
    /// # Safety
    /// `this` must be live. Called both from `drain()` and re-entrantly
    /// from inside libarchive's read callback (while `step()` is on the
    /// stack), so this must NOT materialise `&mut TarballStream` — all
    /// access is via raw-ptr field projection (matches Zig's freely-
    /// aliasing `*TarballStream`). Producer fields (`pending`/`closed`)
    /// are synchronised by `mutex`; drain-side fields (`reading`/
    /// `read_pos`/`hasher`) are owned by the single active drain task.
    unsafe fn take_pending(this: *mut Self) -> bool {
        // SAFETY: see fn-level # Safety — raw-ptr field projection only.
        unsafe {
            (*this).mutex.lock();

            if (*this).pending.is_empty() {
                let closed = (*this).closed;
                (*this).mutex.unlock();
                return closed;
            }

            // Hash before libarchive sees the bytes so integrity covers exactly
            // what came off the socket.
            (*this).hasher.update(&(*this).pending);

            if (*this).reading.len() == (*this).read_pos {
                // Previous buffer fully consumed — swap so the HTTP thread can
                // reuse its capacity without reallocating.
                (*this).reading.clear();
                core::mem::swap(&mut (*this).reading, &mut (*this).pending);
                (*this).read_pos = 0;
            } else {
                // libarchive still holds a slice into `reading` (the read
                // callback contract keeps the last-returned buffer valid until
                // the next call). Appending would realloc and invalidate that
                // slice, so instead shift the unconsumed tail down and append
                // in place — the callback is not running concurrently with us
                // (single drain at a time) and will be re-primed with the new
                // base on its next invocation.
                let read_pos = (*this).read_pos;
                (*this).reading.drain_front(read_pos);
                (*this).read_pos = 0;
                (*this).reading.extend_from_slice(&(*this).pending);
                (*this).pending.clear();
            }
            (*this).mutex.unlock();
            true
        } // unsafe
    }

    /// Run libarchive until it needs more input (`Retry`) or hits a
    /// terminal state. All libarchive state persists on the heap, so
    /// returning from here and re-entering later is safe.
    ///
    /// # Safety
    /// `this` must be live. Takes `*mut Self` (not `&mut self`) because
    /// `open_archive()` hands `this` to libarchive as client_data and the
    /// read callback dereferences it across MULTIPLE `step()` invocations.
    /// A `&mut self` receiver would mint a fresh Unique tag on each call,
    /// popping the SharedRW tag the stored client_data pointer carries and
    /// leaving the callback with dead provenance (Stacked Borrows UB).
    /// Threading the Box-rooted `*mut Self` from `drain()` keeps one
    /// provenance alive for the lifetime of the archive.
    unsafe fn step(this: *mut Self) -> Result<(), bun_core::Error> {
        // SAFETY: see fn-level # Safety — raw-ptr field projection only; no
        // `&mut TarballStream` is held across any libarchive call (which may
        // re-enter `archive_read_callback` and access `*this` via the same
        // provenance). Transient `&mut *this` for `open_destination` /
        // `begin_entry` / `write_data_block` / `close_output_file` is sound:
        // those do not call into libarchive.
        unsafe {
            if (*this).archive.is_none() {
                Self::open_archive(this)?;
            }
            if (*this).dest.is_none() {
                (*this).open_destination()?;
            }

            // `archive` points to a libarchive heap allocation disjoint from
            // `*this`; holding `&mut lib::Archive` across the loop does not
            // alias any access to `*this`.
            let archive = &mut *(*this).archive.unwrap();

            loop {
                match (*this).phase {
                    Phase::Done => return Ok(()),
                    Phase::WantHeader => {
                        let mut entry: *mut lib::Entry = core::ptr::null_mut();
                        match archive.read_next_header(&mut entry) {
                            lib::Result::Retry => return Ok(()),
                            lib::Result::Eof => {
                                (*this).phase = Phase::Done;
                                return Ok(());
                            }
                            lib::Result::Ok | lib::Result::Warn => {
                                // libarchive returned OK/WARN with a valid entry
                                // pointer owned by `archive`; it stays valid until
                                // the next `read_next_header`. No other Rust
                                // reference to it exists.
                                (*this).begin_entry(&mut *entry)?;
                            }
                            lib::Result::Failed | lib::Result::Fatal => {
                                bun_output::scoped_log!(
                                    TarballStream,
                                    "readNextHeader: {}",
                                    bstr::BStr::new(lib::Archive::error_string(
                                        (*this).archive.unwrap()
                                    ))
                                );
                                return Err(bun_core::err!("Fail"));
                            }
                        }
                    }
                    Phase::WantData => {
                        let mut offset: i64 = 0;
                        let Some(block) = archive.next(&mut offset) else {
                            // End of this entry's data.
                            (*this).close_output_file();
                            (*this).phase = Phase::WantHeader;
                            continue;
                        };
                        match block.result {
                            lib::Result::Retry => return Ok(()),
                            lib::Result::Ok | lib::Result::Warn => {
                                if let Some(fd) = (*this).out_fd {
                                    (*this).write_data_block(fd, block)?;
                                }
                            }
                            _ => {
                                bun_output::scoped_log!(
                                    TarballStream,
                                    "read_data_block: {}",
                                    bstr::BStr::new(lib::Archive::error_string(
                                        (*this).archive.unwrap()
                                    ))
                                );
                                return Err(bun_core::err!("Fail"));
                            }
                        }
                    }
                }
            }
        } // unsafe
    }

    /// # Safety
    /// `this` must be live and rooted at the Box allocation (i.e. the
    /// pointer threaded from `drain_callback` → `drain` → `step`, NOT a
    /// `&mut self as *mut Self` reborrow). libarchive stores `this` as
    /// client_data and `archive_read_callback` dereferences it across the
    /// lifetime of the archive — see `step()` # Safety for the provenance
    /// requirement.
    unsafe fn open_archive(this: *mut Self) -> Result<(), bun_core::Error> {
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
        if unsafe { lib::archive_read_append_filter(archive, 1) } != 0 {
            return Err(bun_core::err!("Fail"));
        }
        // SAFETY: archive is a valid non-null handle from read_new(); FFI call has no other preconditions.
        if unsafe { lib::archive_read_set_format(archive, 0x30000) } != 0 {
            return Err(bun_core::err!("Fail"));
        }
        // SAFETY: archive is a valid handle.
        let _ = unsafe { (*archive).read_set_options(c"read_concatenated_archives") };

        // SAFETY: archive is a valid handle; `this` outlives the archive
        // (freed only in `Drop` after `read_free`). See fn-level # Safety
        // for why client_data must be the Box-rooted `this` and not a
        // `&mut self`-derived pointer.
        let rc_raw: c_int = unsafe {
            lib::archive_read_open(
                archive,
                this.cast::<c_void>(),
                None,
                Some(archive_read_callback),
                None,
            )
        };
        // PORTING.md §Forbidden: `transmute::<c_int, enum>` is UB for any value not
        // declared as a discriminant. Map known ARCHIVE_* codes explicitly and treat
        // anything else as Fatal.
        let rc: lib::Result = match rc_raw {
            x if x == lib::Result::Ok as c_int => lib::Result::Ok,
            x if x == lib::Result::Eof as c_int => lib::Result::Eof,
            x if x == lib::Result::Retry as c_int => lib::Result::Retry,
            x if x == lib::Result::Warn as c_int => lib::Result::Warn,
            x if x == lib::Result::Failed as c_int => lib::Result::Failed,
            _ => lib::Result::Fatal,
        };
        match rc {
            lib::Result::Ok | lib::Result::Warn => {}
            lib::Result::Retry => {
                // open() runs the filter bidder which we bypassed, but the
                // client open path may still probe; treat as transient.
                // SAFETY: see fn-level # Safety — raw-ptr field write.
                unsafe { (*this).archive = Some(scopeguard::ScopeGuard::into_inner(guard)) };
                return Ok(());
            }
            _ => {
                bun_output::scoped_log!(
                    TarballStream,
                    "archive_read_open: {}",
                    // SAFETY: archive is a valid handle (guard not yet dropped).
                    bstr::BStr::new(lib::Archive::error_string(archive))
                );
                return Err(bun_core::err!("Fail"));
            }
        }
        // SAFETY: see fn-level # Safety — raw-ptr field write.
        unsafe { (*this).archive = Some(scopeguard::ScopeGuard::into_inner(guard)) };
        Ok(())
    }

    fn open_destination(&mut self) -> Result<(), bun_core::Error> {
        // BACKREF: `extract_task` is live until `finish()` publishes it.
        // `request_extract()` is the tag-checked union accessor (`tag ==
        // Tag::Extract` for streaming tarballs).
        let tarball = &self.extract_task.request_extract().tarball;
        let (_, basename) = tarball.name_and_basename();
        let mut buf = PathBuffer::uninit();
        let tmpname = FileSystem::tmpname(
            &basename[0..basename.len().min(32)],
            &mut buf[..],
            bun_core::fast_random(),
        )?;
        // allocator.dupeZ → owned NUL-terminated copy.
        self.tmpname = ZBox::from_bytes(tmpname.as_bytes());

        self.dest = Some(Fd::from_std_dir(&bun_sys::make_path::make_open_path(
            tarball.temp_dir,
            self.tmpname.as_bytes(),
            Default::default(),
        )?));
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
    fn begin_entry(&mut self, entry: &mut lib::Entry) -> Result<(), bun_core::Error> {
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
                // bun.asByteSlice(root) — on posix OSPathChar==u8, so this is a no-op cast.
                self.resolved_github_dirname = FileSystem::instance()
                    .dirname_store()
                    .append(root)
                    .expect("unreachable");
            }
        }

        let kind = bun_sys::kind_from_mode(entry.filetype() as Mode);

        if self.npm_mode && kind != FileKind::File {
            // npm tarballs only contain files; matching the libarchive path
            // in Archiver.extractToDir we skip everything else.
            self.phase = Phase::WantData;
            self.out_fd = None;
            return Ok(());
        }

        // Strip the leading `package/` (or `<repo>-<sha>/` for GitHub) and
        // normalise. Same transformation as Archiver.extractToDir so both
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
        let normalized =
            resolve_path::normalize_buf_t::<OSPathChar, platform::Auto>(rest, &mut norm_buf[..]);
        let norm_len = normalized.len();
        norm_buf[norm_len] = 0;
        // SAFETY: norm_buf[norm_len] == 0 written above.
        let path: OSPathZMut =
            unsafe { OSPathSliceZ::from_raw_mut(norm_buf.as_mut_ptr(), norm_len) };
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
            if bun_paths::is_absolute_windows_wtf16(&path[..]) {
                self.phase = Phase::WantData;
                self.out_fd = None;
                return Ok(());
            }
            if self.npm_mode {
                apply_windows_npm_path_escapes(path);
            }
        }

        // Mutation (Windows escape rewrite) is done; reborrow as shared so
        // `path` and `path_slice` can coexist.
        let path: OSPathZ = &*path;
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
                make_symlink(entry, dest, path, path_slice);
                self.phase = Phase::WantData;
                self.out_fd = None;
            }
            FileKind::File => {
                #[cfg(windows)]
                let mode: Mode = 0;
                #[cfg(not(windows))]
                let mode: Mode = Mode::try_from(entry.perm() | 0o666).expect("int cast");
                let fd = open_output_file(dest, path, path_slice, mode)?;
                self.entry_count += 1;

                #[cfg(target_os = "linux")]
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
    /// sparse/pwrite handling in `Archive.readDataIntoFd` but operates on a
    /// single block so it can be interleaved with ARCHIVE_RETRY yields.
    /// `entry_actual_offset` / `entry_final_offset` persist across calls so
    /// `close_output_file` can perform the same trailing `ftruncate` the
    /// buffered path does after its block loop.
    fn write_data_block(&mut self, fd: Fd, block: lib::Block) -> Result<(), bun_core::Error> {
        let file = bun_sys::File::from_fd(fd);
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
                match lib::Archive::write_zeros_to_file(&file, zero_count) {
                    lib::Result::Ok => {
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
                self.entry_actual_offset += i64::try_from(data.len()).expect("int cast");
                Ok(())
            }
            Err(e) => Err(e.to_zig_err()),
        }
    }

    /// # Safety
    /// `this` must be the live pointer returned by `init()`. Frees `*this`
    /// — caller must not touch it after return. Takes a raw pointer (not
    /// `&mut self`) so no Rust reference dangles across the
    /// `heap::take` self-destruction (Zig spec: `this.deinit()` with a
    /// freely-aliasing `*TarballStream`).
    unsafe fn finish(this: *mut Self) {
        // SAFETY: see fn-level # Safety — `this`/`task`/`network`/`manager`
        // are live raw pointers; this fn is the sole owner. After
        // `heap::take(this)` nothing touches `this`.
        unsafe {
            // Fields are already raw pointers (see struct PORT NOTE), so copying
            // them out before `heap::take(this)` is just a pointer copy — no
            // reborrow of `&mut Task` is ever materialised from a stored `&mut`.
            let task: *mut Task = (*this).extract_task.as_mut_ptr();
            let network: *mut NetworkTask = (*this).network_task;
            let manager: *mut PackageManager = (*this).package_manager;

            (*this).close_output_file();

            // The HTTP thread has delivered the final `has_more=false` chunk
            // (that's the only way `closed` gets set) and `notify()` does not
            // touch `response_buffer` again after that hand-off, so we own it
            // now. The main thread reads only `streaming_committed` when it
            // later processes the NetworkTask, so freeing the buffer here is
            // safe and matches the `defer buffer.deinit()` in the buffered
            // `.extract` arm of `Task.callback`.
            // SAFETY: see comment above; network_task is live until published below.
            (*network).response_buffer = Default::default();

            // SAFETY: `task` is live until pushed onto `resolve_tasks` below.
            // `(*this).extract_task` is a raw `*mut Task` (not `&mut`), so this
            // is the only writer — no aliasing with a stored reference.
            // `populate_result` does not touch `(*this).extract_task`.
            (*this).populate_result(task);

            // Temp-dir cleanup must happen before we release the stream or
            // publish the task: both `(*this).tmpname` and
            // `task.request.extract.tarball.temp_dir` become invalid once
            // `Drop` runs / the main thread recycles the Task.
            // SAFETY: task is live (see above).
            if (*task).status != TaskStatus::Success && !(*this).tmpname.is_empty() {
                // `populate_result` closes `dest` on the success path before the
                // rename; the early-return failure paths leave it open, so close
                // it here first — Windows can't remove an open directory.
                // `Drop` null-checks so this is not a double-close.
                if let Some(d) = (*this).dest.take() {
                    d.close();
                }
                // SAFETY: task is live (see above). `request` is an untagged
                // union; `extract` is the active variant. Explicit `&` (no
                // implicit autoref through the raw-ptr deref) for the
                // `ManuallyDrop` → `ExtractRequest` deref.
                let _ = (&(*task).request.extract)
                    .tarball
                    .temp_dir
                    .delete_tree((*this).tmpname.as_bytes());
            }

            // The `Box<TarballStream>` lives in `(*network).tarball_stream`
            // (runTasks.rs:1863 stores `Some(heap::take(init(..)))` there). Take
            // it out via the Option and drop the Box — this both runs `Drop` and
            // leaves `tarball_stream = None` so `HiveArray::put`'s
            // `drop_in_place<NetworkTask>` (1e76047) does not double-free a
            // dangling Box. Before 1e76047 the dangling `Some` was harmless
            // (overwritten on next `get()`); now it use-after-frees.
            debug_assert!(
                (*network).tarball_stream.as_deref().map(|s| s as *const _)
                    == Some(this as *const _),
                "TarballStream::finish: network.tarball_stream != this",
            );
            drop((*network).tarball_stream.take());

            // `task.apply_patch_task` is intentionally not touched: the
            // buffered `.extract` path (`enqueueExtractNPMPackage` →
            // `Task.callback`) never populates it for npm tarballs either —
            // patching is handled later by the install phase.
            //
            // Publish last: once the task is on `resolve_tasks` the main
            // thread may immediately recycle it *and* the NetworkTask it
            // references, so nothing below this line may touch either.
            // SAFETY: manager/task outlive this stream by construction; manager
            // is `*mut` (Zig spec: mutable `*PackageManager`) and shared across
            // threads, so we mutate via raw-ptr deref without forming a
            // long-lived `&mut PackageManager`.
            (*manager).resolve_tasks.push(task);
            PackageManager::wake_raw(manager);
        } // unsafe
    }

    /// # Safety
    /// `task` must be live and exclusively owned by this drain. Takes a raw
    /// pointer (Zig: freely-aliasing `*Task`) so `tarball` (a borrow into
    /// `task.request`) can coexist with writes to `task.log`/`task.data`.
    unsafe fn populate_result(&mut self, task: *mut Task) {
        // SAFETY: see fn-level # Safety — `task` is live and exclusively
        // owned by this drain; union field `extract` is the active variant
        // for streaming tarballs (set by `enqueueExtractNPMPackage`).
        unsafe {
            // Explicit `&` (no implicit autoref through the raw-ptr deref) for
            // the `ManuallyDrop` → `ExtractRequest` deref.
            let tarball = &(&(*task).request.extract).tarball;
            (*task).data = TaskData {
                extract: ManuallyDrop::new(Default::default()),
            };

            if let Some(err) = self.fail {
                (*task).log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "{} extracting tarball for \"{}\"",
                        err.name(),
                        bstr::BStr::new(tarball.name.slice()),
                    ),
                );
                (*task).err = Some(err);
                (*task).status = TaskStatus::Fail;
                return;
            }

            if !tarball.skip_verify && tarball.integrity.tag.is_supported() {
                if !self.hasher.verify() {
                    (*task).log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Integrity check failed<r> for tarball: {}",
                            bstr::BStr::new(tarball.name.slice()),
                        ),
                    );
                    (*task).err = Some(bun_core::err!("IntegrityCheckFailed"));
                    (*task).status = TaskStatus::Fail;
                    return;
                }
            }

            if tarball.resolution.tag == ResolutionTag::Github {
                'insert_tag: {
                    if self.resolved_github_dirname.is_empty() {
                        break 'insert_tag;
                    }
                    if bun_sys::File::write_file(
                        self.dest.unwrap(),
                        bun_core::zstr!(".bun-tag"),
                        self.resolved_github_dirname,
                    )
                    .is_err()
                    {
                        let _ = bun_sys::unlinkat(self.dest.unwrap(), bun_core::zstr!(".bun-tag"));
                    }
                }
            }

            // Close the temp dir handle before renaming so Windows can move it.
            if let Some(d) = self.dest.take() {
                d.close();
            }

            let (name, basename) = tarball.name_and_basename();

            let mut result = match tarball.move_to_cache_directory(
                &mut (*task).log,
                self.tmpname.as_zstr(),
                name,
                basename,
                self.resolved_github_dirname,
            ) {
                Ok(r) => r,
                Err(err) => {
                    (*task).err = Some(err);
                    (*task).status = TaskStatus::Fail;
                    return;
                }
            };

            match tarball.resolution.tag {
                ResolutionTag::Github
                | ResolutionTag::RemoteTarball
                | ResolutionTag::LocalTarball => {
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

            (*task).data = TaskData {
                extract: ManuallyDrop::new(result),
            };
            (*task).status = TaskStatus::Success;
        } // unsafe
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

impl Drop for TarballStream {
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

// Safe-fn: only ever invoked by `ThreadPool` via the `callback` fn-pointer
// with the `*mut Task` we registered in `init()` (`drain_task.callback =
// drain_callback`). The thread-pool contract — not the Rust caller —
// guarantees `task` is live and points at `TarballStream.drain_task`, so the
// preconditions of both unsafe ops below are discharged locally. Safe `fn`
// coerces to the `unsafe fn(*mut Task)` field type.
fn drain_callback(task: *mut thread_pool::Task) {
    // SAFETY: thread-pool callback contract — `task` points to
    // `TarballStream.drain_task`; recover the parent via offset_of.
    let this: *mut TarballStream =
        unsafe { bun_core::from_field_ptr!(TarballStream, drain_task, task) };
    // SAFETY: the thread pool guarantees `task` is live for the duration of
    // the callback, and only one drain runs at a time (see `draining` flag).
    // `drain` may free `this`; nothing touches it after this call.
    unsafe { TarballStream::drain(this) };
}

/// libarchive client read callback. Returns whatever compressed bytes
/// are currently buffered in `reading`; if none, returns `ARCHIVE_RETRY`
/// (when more data is still expected) so libarchive unwinds with a
/// resumable status, or `0` (EOF) once the HTTP response is complete.
///
/// Safe-fn: only ever invoked by libarchive itself (never from Rust), with
/// `ctx`/`out_buffer` it threaded through from `open_archive()`. Every
/// pointer dereference inside carries its own SAFETY justification grounded
/// in that setup, so there is no caller-side precondition to encode in the
/// signature. The fn-pointer still coerces to the binding's expected type.
extern "C" fn archive_read_callback(
    _a: *mut lib::Archive,
    ctx: *mut c_void,
    out_buffer: *mut *const c_void,
) -> lib::la_ssize_t {
    // SAFETY: `ctx` is the Box-rooted `*mut TarballStream` threaded from
    // `drain()` → `step()` → `open_archive()`; libarchive passes it back
    // unchanged. `step()`/`open_archive()` take `*mut Self` (not
    // `&mut self`) precisely so this pointer's provenance survives every
    // re-entry — see `step()` # Safety. We keep `this` as a raw pointer and
    // access fields through it directly (Zig: freely-aliasing
    // `*TarballStream`); no `&mut TarballStream` is live anywhere on the
    // call stack while libarchive runs. All fields touched here (`reading`,
    // `read_pos`, `mutex`, `pending`, `closed`, `hasher`) are drain-side /
    // mutex-guarded and are not accessed by `step()` across the FFI call
    // boundary.
    let this: *mut TarballStream = ctx.cast::<TarballStream>();

    // SAFETY: `this` is valid (see above); `reading`/`read_pos` are owned by
    // the single active drain task.
    unsafe {
        // Explicit `&` on the `Vec` field (no implicit autoref through the
        // raw-ptr deref) for `Index::index`.
        let remaining = &(&(*this).reading)[(*this).read_pos..];
        if !remaining.is_empty() {
            *out_buffer = remaining.as_ptr().cast();
            (*this).read_pos = (*this).reading.len();
            return lib::la_ssize_t::try_from(remaining.len()).expect("int cast");
        }
    }

    // No data left in `reading`. Check for more under the lock —
    // libarchive may have called us more than once for a single
    // `step()` (e.g. gzip header + first deflate block), and `on_chunk`
    // might have landed a fresh chunk in the meantime.
    // SAFETY: `mutex`/`pending`/`closed` accessed via raw ptr; producer side
    // is synchronised by the mutex itself.
    let (has_pending, closed) = unsafe {
        (*this).mutex.lock();
        let r = (!(*this).pending.is_empty(), (*this).closed);
        (*this).mutex.unlock();
        r
    };

    if has_pending {
        // Pull the new bytes into `reading` and retry the read. We are
        // the only consumer of `reading`/`read_pos`, and `take_pending`
        // only touches producer state under the same mutex.
        // SAFETY: `take_pending` takes `*mut Self` and accesses fields via
        // raw-ptr projection, never forming `&mut TarballStream`; `step()`
        // holds no `&mut TarballStream` across the libarchive call that
        // re-entered us.
        unsafe {
            let _ = TarballStream::take_pending(this);
            // Explicit `&` on the `Vec` field (no implicit autoref through
            // the raw-ptr deref) for `Index::index`.
            let again = &(&(*this).reading)[(*this).read_pos..];
            if !again.is_empty() {
                *out_buffer = again.as_ptr().cast();
                (*this).read_pos = (*this).reading.len();
                return lib::la_ssize_t::try_from(again.len()).expect("int cast");
            }
        }
    }

    if closed {
        // SAFETY: out_buffer is a valid out-param; ptr is unused when len==0.
        unsafe { *out_buffer = this.cast() };
        return 0;
    }

    // Tell libarchive to unwind with a resumable status. The BUN PATCHes
    // in vendor/libarchive make every layer (filter_ahead → gzip → tar)
    // preserve its state and propagate ARCHIVE_RETRY to our `step()`
    // loop, which then returns so this worker can be reused.
    lib::Result::Retry as lib::la_ssize_t
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
            Err(e) => match e.get_errno() {
                bun_sys::E::EPERM | bun_sys::E::ENOENT => 'brk: {
                    let Some(dir) = bun_paths::Dirname::dirname::<u16>(path_slice) else {
                        return Err(e.to_zig_err());
                    };
                    let _ = bun_sys::make_path::make_path::<u16>(Dir::from_fd(dest_fd), dir);
                    break 'brk bun_sys::openat_windows(dest_fd, path, flags, 0)
                        .map_err(|e| e.to_zig_err());
                }
                _ => Err(e.to_zig_err()),
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
                        return Err(e.to_zig_err());
                    };
                    let _ = dest_fd.make_path(dir);
                    break 'brk bun_sys::openat(dest_fd, path, flags, mode)
                        .map_err(|e| e.to_zig_err());
                }
                _ => Err(e.to_zig_err()),
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
        let _ = bun_sys::make_path::make_path::<u16>(Dir::from_fd(dest_fd), &path[..]);
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

#[cfg(unix)]
fn make_symlink(entry: &mut lib::Entry, dest_fd: Fd, path: OSPathZ, path_slice: &[OSPathChar]) {
    let target = entry.symlink();
    // Same safety rule as `isSymlinkTargetSafe` in the buffered path:
    // reject absolute targets and anything that escapes via `..`.
    if target.is_empty() || target[0] == b'/' {
        return;
    }
    {
        let symlink_dir = bun_paths::dirname(path_slice).unwrap_or(b"");
        let mut join_buf = PathBuffer::uninit();
        let resolved = resolve_path::join_abs_string_buf::<platform::Posix>(
            b"/packages/",
            &mut join_buf[..],
            &[symlink_dir, target.as_bytes()],
        );
        if !resolved.starts_with(b"/packages/") {
            return;
        }
    }
    match bun_sys::symlinkat(target, dest_fd, path) {
        Ok(()) => {}
        Err(e) if matches!(e.get_errno(), bun_sys::E::EPERM | bun_sys::E::ENOENT) => {
            let Some(dir) = bun_paths::dirname(path_slice) else {
                return;
            };
            let _ = dest_fd.make_path(dir);
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

// `std.mem.tokenizeScalar(OSPathChar, s, '/')` followed by one `next()` then
// `.rest()`: Zig's `TokenIterator.rest()` first SKIPS any delimiters at the
// current index (vendor/zig/lib/std/mem.zig) before returning
// `buffer[index..]`, so for `"package/index.js"` the result is `"index.js"`
// (no leading `/`).
// TODO(port): Phase B — hoist into bun_str or bun_paths if reused elsewhere.
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

// ported from: src/install/TarballStream.zig

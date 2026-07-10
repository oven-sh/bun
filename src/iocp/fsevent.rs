#![cfg(windows)]

//! ReadDirectoryChangesW fs-event handle class — the `uv_fs_event_t`
//! replacement: directory and single-file watches delivered through the
//! loop's completion dispatch.
//!
//! Design decisions (each is a named project outcome, not an oversight):
//!
//! - **Overflow is SURFACED, never dropped.** A success completion with zero
//!   bytes is the kernel's "too many changes, state lost" signal
//!   (STATUS_NOTIFY_ENUM_DIR is success-class). It is delivered as an
//!   explicit [`FS_EVENT_RESCAN`] callback with an empty filename so the
//!   consumer rescans — the previous libuv-consumer shape dropped the
//!   NULL-filename event on the floor and silently lost changes.
//!   // quirk: SIGEV-42, SIGEV-43
//! - **64 KiB event buffer** — the documented ceiling for network (SMB)
//!   watches, where larger buffers fail; 16x libuv's battle-tested 4 KiB so
//!   the kernel-side queue overflows (forcing a consumer rescan) far less
//!   often, with the rescan signal as the relief valve when even this
//!   fills. Allocated DWORD-aligned (`Box<[u32]>`), lazily at first start,
//!   reused across restarts, and never released before the last completion
//!   drains — the kernel writes into it until then. // quirk: SIGEV-22,
//!   SIGEV-23, LOOP-04
//! - **Errors park the watcher.** An error is delivered exactly once and
//!   the watch stops (restartable via `start`). Deviation: libuv re-arms
//!   after delivering errors, which can loop a dead watch (a delete-pending
//!   directory re-fails ACCESS_DENIED every iteration) forever.
//! - **`stop()` is synchronously effective.** No event callback fires after
//!   stop, including the remainder of a batch when a callback stops the
//!   handle mid-batch (deviation: libuv keeps delivering the rest of the
//!   batch and only gates the re-arm on active). // quirk: SIGEV-46
//! - **Restart while the canceled completion is in flight defers the
//!   re-arm to the drain** — never two operations on one OVERLAPPED
//!   (libuv's unfixed stop-then-restart hazard). // quirk: SIGEV-40
//! - **Watched-directory rename is undetected** (handle follows the object;
//!   records stay relative to the renamed directory) — accepted libuv/Node
//!   behavior, documented rather than probed. // quirk: SIGEV-49

use core::ffi::{c_int, c_void};
use core::mem;
use core::ptr;

use bun_windows_sys::ntdll::NtQueryInformationFile;
use bun_windows_sys::{
    BY_HANDLE_FILE_INFORMATION, CSTR_EQUAL, CloseHandle, CompareStringOrdinal, CreateFileW, DWORD,
    FALSE, FILE_ACTION_ADDED, FILE_ACTION_MODIFIED, FILE_ACTION_REMOVED,
    FILE_ACTION_RENAMED_NEW_NAME, FILE_ACTION_RENAMED_OLD_NAME, FILE_ATTRIBUTE_DIRECTORY,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OVERLAPPED, FILE_INFORMATION_CLASS, FILE_LIST_DIRECTORY,
    FILE_NAME_NORMALIZED, FILE_NOTIFY_CHANGE_ATTRIBUTES, FILE_NOTIFY_CHANGE_CREATION,
    FILE_NOTIFY_CHANGE_DIR_NAME, FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_ACCESS,
    FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SECURITY, FILE_NOTIFY_CHANGE_SIZE,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_STANDARD_INFORMATION,
    GetCurrentDirectoryW, GetFileInformationByHandle, GetFinalPathNameByHandleW, GetLongPathNameW,
    GetShortPathNameW, HANDLE, INVALID_HANDLE_VALUE, IO_STATUS_BLOCK, NTSTATUS, OPEN_EXISTING,
    ReadDirectoryChangesW, SetLastError, TRUE, ULONG, VOLUME_NAME_DOS, VOLUME_NAME_NONE,
    Win32Error,
};

use crate::event_loop::Loop;
use crate::handle::HandleCore;
use crate::req::{Req, ReqKind};

/// Event-buffer size: the documented maximum that still works for network
/// (SMB) watches — RDCW rejects buffers larger than 64 KiB there — and 16x
/// libuv's 4 KiB so kernel-side overflow is rare. // quirk: SIGEV-22
const BUFFER_BYTES: usize = 64 * 1024;

/// Full notify filter — all eight change classes, so no event class is ever
/// missed; one constant feeding the single issue site, so initial arm and
/// re-arm cannot diverge. // quirk: SIGEV-24
const NOTIFY_FILTER: DWORD = FILE_NOTIFY_CHANGE_FILE_NAME
    | FILE_NOTIFY_CHANGE_DIR_NAME
    | FILE_NOTIFY_CHANGE_ATTRIBUTES
    | FILE_NOTIFY_CHANGE_SIZE
    | FILE_NOTIFY_CHANGE_LAST_WRITE
    | FILE_NOTIFY_CHANGE_LAST_ACCESS
    | FILE_NOTIFY_CHANGE_CREATION
    | FILE_NOTIFY_CHANGE_SECURITY;

/// `FILE_NOTIFY_INFORMATION` header bytes: NextEntryOffset, Action,
/// FileNameLength — three DWORDs before the counted UTF-16 name (which is
/// NOT NUL-terminated; its length is in BYTES). // quirk: SIGEV-30
const RECORD_HEADER_BYTES: usize = 12;

/// `\$Extend\$Deleted\` — where POSIX delete retargets still-open handles.
/// // quirk: SIGEV-48
const DELETED_MARKER: [u16; 18] = ascii_to_utf16(br"\$Extend\$Deleted\");

const fn ascii_to_utf16<const N: usize>(ascii: &[u8; N]) -> [u16; N] {
    let mut out = [0u16; N];
    let mut i = 0;
    while i < N {
        out[i] = ascii[i] as u16;
        i += 1;
    }
    out
}

/// Create/delete/rename-half event (Node `'rename'`; uv `UV_RENAME`).
pub const FS_EVENT_RENAME: u32 = 1;
/// Content/metadata modification (Node `'change'`; uv `UV_CHANGE`).
pub const FS_EVENT_CHANGE: u32 = 2;
/// Changes were LOST (buffer overflow): the consumer must rescan. Delivered
/// with an empty filename; maps to Node's `'change'` with `filename ===
/// null`. // quirk: SIGEV-43
pub const FS_EVENT_RESCAN: u32 = 4;

/// Event callback: `(loop re-lent, data, filename, events, err)`.
///
/// `filename` is raw WTF-16, relative to the watch root, with backslash
/// separators for subtree entries; file watches always report the basename
/// the user asked to watch. It is empty exactly when `events` is
/// [`FS_EVENT_RESCAN`] or when `err != SUCCESS`, and is only valid for the
/// duration of the callback. An error delivery (`err != SUCCESS`,
/// `events == 0`) is terminal: the watcher parks until restarted.
/// // quirk: SIGEV-25, SIGEV-50, SIGEV-51
pub type FsEventCb = unsafe fn(&mut Loop, *mut c_void, &[u16], u32, Win32Error);
/// Close callback, run from the endgame once the in-flight request drained;
/// only then may the owner free the handle box.
pub type FsEventCloseCb = unsafe fn(&mut Loop, *mut c_void);

/// A ReadDirectoryChangesW watcher on the IOCP loop. Heap-pinned by its
/// owner while active or with a request in flight; destruction is the
/// deferred endgame protocol — `close()` then free only after the close
/// callback. // quirk: LOOP-04, SIGEV-39
#[repr(C)]
pub struct FsEventHandle {
    core: HandleCore,
    /// The single embedded RDCW request. The kernel owns its OVERLAPPED
    /// (and the buffer) from arm until the completion drains.
    req: Req,
    dir_handle: HANDLE,
    /// DWORD-aligned event buffer; allocated lazily at first start, reused
    /// across restarts, dropped only with the handle (after the endgame).
    /// // quirk: SIGEV-22, SIGEV-23
    buffer: Option<Box<[u32]>>,
    /// Delivering events. Cleared by stop/close/terminal error.
    started: bool,
    /// The in-flight completion belongs to a stopped watch: swallow it on
    /// drain, never deliver. // quirk: SIGEV-40
    stale_completion: bool,
    /// `start()` ran while the stale completion was in flight; the drain
    /// performs the deferred arm. // quirk: SIGEV-40
    rearm_deferred: bool,
    /// Recursion lives in its own field — never overlaid on lifecycle flag
    /// words (libuv's re-arm read UV_HANDLE_ACTIVE as the recursive bit).
    /// // quirk: SIGEV-26
    recursive: bool,
    /// The classic-delete rename was delivered; further ACCESS_DENIED takes
    /// the terminal error path instead of looping. // quirk: SIGEV-47
    dir_delete_reported: bool,
    /// The watch path as given to `start` (no NUL); reported as the
    /// filename when the watched directory itself is deleted.
    user_path: Box<[u16]>,
    /// Long-form watch root for event-name canonicalization, normalized
    /// once at start from the open handle (race-free). Empty for file
    /// watches (they report the user basename instead). // quirk: SIGEV-34
    dir_norm: Box<[u16]>,
    /// File watch: the user-supplied basename (also the reported name).
    /// `None` = directory watch. // quirk: SIGEV-27, SIGEV-51
    file_filter: Option<Box<[u16]>>,
    /// File watch: the 8.3 alias basename, when the volume has one — the
    /// modifying process may have used it. // quirk: SIGEV-28, SIGEV-29
    short_filter: Option<Box<[u16]>>,
    cb: Option<FsEventCb>,
    data: *mut c_void,
    close_cb: Option<FsEventCloseCb>,
    close_data: *mut c_void,
}

impl FsEventHandle {
    /// Create an idle watcher for a later [`start`](Self::start).
    ///
    /// # Safety
    /// `lp` must be a valid pinned loop that outlives the handle; the
    /// caller must keep the returned box alive until the close callback
    /// runs.
    pub unsafe fn new(lp: *mut Loop) -> Box<FsEventHandle> {
        let mut h = Box::new(FsEventHandle {
            // SAFETY: fn contract — the loop outlives the handle; the box
            // is the required heap pinning.
            core: unsafe { HandleCore::new(lp, fs_event_endgame) },
            req: Req::new(ReqKind::FsEvent, ptr::null_mut()),
            dir_handle: INVALID_HANDLE_VALUE,
            buffer: None,
            started: false,
            stale_completion: false,
            rearm_deferred: false,
            recursive: false,
            dir_delete_reported: false,
            user_path: Vec::new().into_boxed_slice(),
            dir_norm: Vec::new().into_boxed_slice(),
            file_filter: None,
            short_filter: None,
            cb: None,
            data: ptr::null_mut(),
            close_cb: None,
            close_data: ptr::null_mut(),
        });
        // The embedded req's owner back-pointer is the heap-pinned address.
        let hp: *mut FsEventHandle = &raw mut *h;
        h.req = Req::new(ReqKind::FsEvent, hp.cast::<c_void>());
        h
    }

    #[inline]
    pub fn is_closing(&self) -> bool {
        self.core.is_closing()
    }
    /// Delivering events (started and not parked by stop/close/error).
    #[inline]
    pub fn is_started(&self) -> bool {
        self.started
    }
    /// Whether the last `start` classified the path as a directory watch
    /// (file watches watch the parent with a name filter), by the race-free
    /// handle probe — meaningful only after a successful start.
    /// // quirk: SIGEV-27, SIGEV-38
    #[inline]
    pub fn is_directory_watch(&self) -> bool {
        self.file_filter.is_none()
    }

    /// Drop the loop keep-alive without stopping the watch (close still
    /// holds the loop until the close callback).
    pub fn unref(&mut self) {
        self.core.unref();
    }
    /// Restore the keep-alive dropped by [`unref`](Self::unref).
    pub fn ref_(&mut self) {
        self.core.ref_();
    }

    /// Start watching `path` (UTF-16, no NULs). A directory is watched
    /// directly (recursively when `recursive`); any other path watches its
    /// parent directory with a name filter. // quirk: SIGEV-25, SIGEV-27
    ///
    /// Errors out synchronously for invalid/missing paths and first-arm
    /// failures; once started, all failures arrive through `cb`.
    ///
    /// # Safety
    /// `data` must be valid whenever `cb` can run (until stop/close).
    pub unsafe fn start(
        &mut self,
        path: &[u16],
        recursive: bool,
        cb: FsEventCb,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if self.started {
            return Err(Win32Error::INVALID_PARAMETER);
        }
        // Embedded NUL is a security boundary (C-string truncation).
        // // quirk: PIPE-26
        if path.is_empty() || path.contains(&0) {
            return Err(Win32Error::INVALID_NAME);
        }
        let mut pathz = path.to_vec();
        pathz.push(0);

        // Open FIRST, classify by handle: metadata-by-path is TOCTOU-racy.
        // // quirk: SIGEV-37, SIGEV-38
        // SAFETY: `pathz` is NUL-terminated and outlives the call.
        let probe = unsafe { open_watchable(&pathz)? };
        // SAFETY: `probe` is a fresh handle owned here.
        let is_dir = match unsafe { handle_is_directory(probe) } {
            Ok(b) => b,
            Err(err) => {
                // SAFETY: created above, not yet shared.
                unsafe { CloseHandle(probe) };
                return Err(err);
            }
        };

        let dir_handle: HANDLE;
        let mut file_filter: Option<Box<[u16]>> = None;
        let mut short_filter: Option<Box<[u16]>> = None;
        if is_dir {
            dir_handle = probe;
        } else {
            // Watching a FILE = watching its parent directory + filtering
            // by name. The 8.3 alias joins the filter when the volume has
            // one; its absence is "no second alias", never an error.
            // // quirk: SIGEV-27, SIGEV-28, SIGEV-29
            let short_base = get_short_path_name(&pathz)
                .and_then(|sp| split_path(&sp).ok().map(|(_, base)| base))
                .filter(|b| !b.is_empty());
            let (mut dirz, base) = match split_path(path) {
                Ok(p) => p,
                Err(err) => {
                    // SAFETY: probe owned here, closed exactly once.
                    unsafe { CloseHandle(probe) };
                    return Err(err);
                }
            };
            // SAFETY: probe owned here; the parent reopen below replaces it.
            unsafe { CloseHandle(probe) };
            dirz.push(0);
            // SAFETY: `dirz` is NUL-terminated and outlives the call.
            let parent = unsafe { open_watchable(&dirz)? };
            // Race: the parent was swapped for a file between the probe and
            // this reopen. Fail with the honest raw shape (ERROR_DIRECTORY
            // — not libuv's ENOENT wart). // quirk: SIGEV-38
            // SAFETY: `parent` is a fresh handle owned here.
            match unsafe { handle_is_directory(parent) } {
                Ok(true) => {}
                Ok(false) => {
                    // SAFETY: created above, not yet shared.
                    unsafe { CloseHandle(parent) };
                    return Err(Win32Error::DIRECTORY);
                }
                Err(err) => {
                    // SAFETY: created above, not yet shared.
                    unsafe { CloseHandle(parent) };
                    return Err(err);
                }
            }
            dir_handle = parent;
            file_filter = Some(base.into_boxed_slice());
            short_filter = short_base.map(Vec::into_boxed_slice);
        }

        // Normalize the watch root once, race-free, from the open handle —
        // an 8.3 user spelling would otherwise break relative-path
        // extraction. Fall back to the path as given (exotic filesystems
        // may not answer). File watches skip this: they never canonicalize.
        // // quirk: SIGEV-34
        let dir_norm: Vec<u16> = if is_dir {
            final_path_by_handle(dir_handle).unwrap_or_else(|| path.to_vec())
        } else {
            Vec::new()
        };

        let lp = self.core.loop_;
        // Associate with the loop's port. Deliberately NO completion-mode
        // shortcuts (unlike pipes): a re-armed RDCW can complete
        // synchronously when the kernel already buffered changes, and
        // skip-on-success would swallow that packet. // quirk: SIGEV-39
        // SAFETY: fresh overlapped handle owned here; loop valid (init
        // contract).
        if let Err(err) = unsafe { (*lp).associate(dir_handle, dir_handle.expose_provenance()) } {
            // SAFETY: created above, not yet armed.
            unsafe { CloseHandle(dir_handle) };
            return Err(err);
        }

        // Lazily allocate the DWORD-aligned buffer; restarts reuse it.
        // // quirk: SIGEV-22, SIGEV-23
        if self.buffer.is_none() {
            self.buffer = Some(vec![0u32; BUFFER_BYTES / 4].into_boxed_slice());
        }
        self.dir_handle = dir_handle;
        self.user_path = path.to_vec().into_boxed_slice();
        self.dir_norm = dir_norm.into_boxed_slice();
        self.file_filter = file_filter;
        self.short_filter = short_filter;
        self.recursive = recursive; // quirk: SIGEV-26
        self.dir_delete_reported = false;
        self.cb = Some(cb);
        self.data = data;

        if self.core.reqs_pending() > 0 {
            // The previous watch's canceled completion has not drained: the
            // embedded OVERLAPPED is still kernel-owned, so arming now
            // would put two operations on one request. Defer to the drain.
            // // quirk: SIGEV-40
            debug_assert!(self.stale_completion);
            self.rearm_deferred = true;
        } else {
            let hp: *mut FsEventHandle = self;
            // SAFETY: handle pinned (boxed), buffer allocated, dir handle
            // open and unarmed.
            if let Err(err) = unsafe { issue_rdcw(hp) } {
                // First-arm failure is synchronous; only RE-arm failures
                // funnel through the loop. // quirk: SIGEV-41
                self.dir_handle = INVALID_HANDLE_VALUE;
                // SAFETY: opened above; the failed arm left no kernel
                // reference.
                unsafe { CloseHandle(dir_handle) };
                return Err(err);
            }
            self.core.req_submitted_uncounted();
        }

        self.started = true;
        self.core.start();
        Ok(())
    }

    /// Stop delivering events, synchronously: no callback fires after this
    /// returns. Closing the directory handle is the only way to cancel the
    /// pending RDCW; its canceled completion still arrives and is swallowed
    /// by the dispatch. // quirk: SIGEV-39, SIGEV-40
    pub fn stop(&mut self) {
        if self.core.is_closing() || !self.started {
            return;
        }
        self.started = false;
        self.rearm_deferred = false;
        if self.dir_handle != INVALID_HANDLE_VALUE {
            // SAFETY: the handle is owned by this watcher and closed
            // exactly once (INVALID below).
            unsafe { CloseHandle(self.dir_handle) };
            self.dir_handle = INVALID_HANDLE_VALUE;
        }
        if self.core.reqs_pending() > 0 {
            self.stale_completion = true;
        }
        self.core.stop();
    }

    /// Begin the asynchronous close. The in-flight RDCW (if any) completes
    /// canceled and drains; `cb` runs from the loop once it has — only then
    /// may the owner free the box. No event callback fires after close.
    /// // quirk: SIGEV-39, LOOP-25
    pub fn close(&mut self, cb: Option<FsEventCloseCb>, data: *mut c_void) {
        self.close_cb = cb;
        self.close_data = data;
        self.started = false;
        self.rearm_deferred = false;
        if self.dir_handle != INVALID_HANDLE_VALUE {
            // SAFETY: owned handle, closed exactly once. The kernel keeps
            // writing request/buffer memory until the canceled completion
            // is dequeued — which is exactly what the endgame gate waits
            // for. // quirk: LOOP-04
            unsafe { CloseHandle(self.dir_handle) };
            self.dir_handle = INVALID_HANDLE_VALUE;
        }
        self.core.close();
    }
}

// ───────────────────────── arm machinery ─────────────────────────

/// The single `ReadDirectoryChangesW` issue site (initial arm and every
/// re-arm), so the recursive flag and filter mask cannot diverge between
/// them. The recursive bit comes from the dedicated field, never a flags
/// word. // quirk: SIGEV-24, SIGEV-25, SIGEV-26
///
/// # Safety
/// `h` valid and pinned; `dir_handle` open; buffer allocated; the embedded
/// request is free (no operation the kernel still owns).
unsafe fn issue_rdcw(h: *mut FsEventHandle) -> Result<(), Win32Error> {
    // SAFETY: fn contract; the buffer and OVERLAPPED live inside the pinned
    // handle until the completion drains (endgame gating).
    unsafe {
        debug_assert!((*h).dir_handle != INVALID_HANDLE_VALUE);
        // The SIGEV-40 invariant: never arm while the kernel still owns the
        // embedded OVERLAPPED (a not-yet-drained canceled completion).
        debug_assert_eq!((*h).core.reqs_pending(), 0);
        let buffer = (*h).buffer.as_mut().expect("buffer allocated at start");
        (*h).req.prime_pending();
        let ok = ReadDirectoryChangesW(
            (*h).dir_handle,
            buffer.as_mut_ptr().cast::<c_void>(),
            BUFFER_BYTES as DWORD,
            if (*h).recursive { TRUE } else { FALSE },
            NOTIFY_FILTER,
            ptr::null_mut(),
            (*h).req.overlapped_ptr(),
            ptr::null_mut(),
        );
        if ok == 0 {
            Err(Win32Error::get())
        } else {
            Ok(())
        }
    }
}

/// Re-arm after a drained completion. A synchronous failure becomes a
/// pending completion — errors always arrive through the loop, never
/// re-entrantly from inside a callback's stack. // quirk: SIGEV-41
///
/// # Safety
/// `lp`/`h` valid and pinned; handle started, not closing, no request in
/// flight.
unsafe fn rearm(lp: *mut Loop, h: *mut FsEventHandle) {
    // SAFETY: fn contract; the req lives inside the pinned handle.
    unsafe {
        debug_assert!((*h).started && !(*h).core.is_closing());
        if let Err(err) = issue_rdcw(h) {
            (*h).req.set_error(err);
            (*lp).insert_pending(&raw mut (*h).req);
        }
        // Counted for success AND the funnel: either way exactly one
        // completion will drain and balance it.
        (*h).core.req_submitted_uncounted();
    }
}

// ───────────────────────── completion processing ─────────────────────────

/// Single delivery path for fs-event completions: kernel packets and
/// funneled synchronous re-arm failures. // quirk: SIGEV-41, SIGEV-42
pub(crate) fn process_fs_event_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<FsEventHandle>();
    // SAFETY: `data` was set at init to the heap-pinned FsEventHandle, kept
    // alive until all reqs drain (endgame protocol); access is raw-pointer
    // only and no borrow is held across user callbacks.
    unsafe {
        (*h).core.req_completed_uncounted();

        if (*h).core.is_closing() {
            // Close contract: no callback after close; this drain only
            // unblocks the endgame. // quirk: SIGEV-39
            return;
        }
        if mem::replace(&mut (*h).stale_completion, false) {
            // Canceled completion of a stopped watch: swallowed. A restart
            // waiting on this drain arms now — on the freshly freed
            // request, never on one the kernel still owns. // quirk: SIGEV-40
            if (*h).rearm_deferred && (*h).started {
                (*h).rearm_deferred = false;
                rearm(lp, h);
            }
            return;
        }
        if !(*h).started {
            // stop() marks in-flight completions stale, so this is
            // unreachable in practice; keep the delivery gate airtight.
            return;
        }

        // Set when this batch indicates the watched directory itself
        // changed/disappeared; gates the zombie probe so it is not a
        // syscall per batch. // quirk: SIGEV-48
        let mut dir_event = false;

        if (*req_ptr).success() {
            let bytes = (*req_ptr).bytes_transferred();
            if bytes == 0 {
                // Success with zero bytes is the kernel's overflow signal
                // (STATUS_NOTIFY_ENUM_DIR is success-class, never a Win32
                // error to pattern-match): changes were LOST. Surface an
                // explicit rescan — dropping it is how shipping fs.watch
                // silently missed events. // quirk: SIGEV-42, SIGEV-43
                dir_event = true; // a POSIX-deleted root can land here too
                if let Some(cb) = (*h).cb {
                    cb(
                        &mut *lp,
                        (*h).data,
                        &[],
                        FS_EVENT_RESCAN,
                        Win32Error::SUCCESS,
                    );
                }
            } else {
                process_batch(lp, h, bytes, &mut dir_event);
            }
        } else {
            let err = (*req_ptr).error();
            if err == Win32Error::ACCESS_DENIED
                && (*h).file_filter.is_none()
                && !(*h).dir_delete_reported
                && dir_delete_pending((*h).dir_handle)
            {
                // Classic-semantics deletion of the watched directory:
                // report a rename of the directory itself, not a
                // permission error. Once only — the follow-up re-arm
                // failure takes the terminal path. // quirk: SIGEV-47
                (*h).dir_delete_reported = true;
                dir_event = true;
                let name: Vec<u16> = (*h).user_path.to_vec();
                if let Some(cb) = (*h).cb {
                    cb(
                        &mut *lp,
                        (*h).data,
                        &name,
                        FS_EVENT_RENAME,
                        Win32Error::SUCCESS,
                    );
                }
            } else {
                park_with_error(lp, h, err);
                return;
            }
        }

        // Re-derive liveness after user callbacks: one may have stopped,
        // closed, or restarted (a fresh RDCW then already owns the
        // request). // quirk: SIGEV-46
        if (*h).core.is_closing() || !(*h).started || (*h).core.reqs_pending() > 0 {
            return;
        }
        if dir_event && handle_is_zombie((*h).dir_handle) {
            // POSIX delete retargeted the handle into \$Extend\$Deleted:
            // RDCW would never fire again. Report the loss and park
            // instead of re-arming a zombie. // quirk: SIGEV-48
            park_with_error(lp, h, Win32Error::FILE_NOT_FOUND);
            return;
        }
        rearm(lp, h);
    }
}

/// Deliver a terminal error exactly once and park the watcher: no further
/// callbacks, no re-arm; `start()` may revive it. (Deviation: libuv re-arms
/// after delivering errors, which can loop a dead watch forever.)
///
/// # Safety
/// `lp`/`h` valid and pinned; no request in flight (callers run inside its
/// drain).
unsafe fn park_with_error(lp: *mut Loop, h: *mut FsEventHandle, err: Win32Error) {
    // SAFETY: fn contract.
    unsafe {
        (*h).started = false;
        (*h).core.stop();
        if (*h).dir_handle != INVALID_HANDLE_VALUE {
            // SAFETY: owned handle, closed exactly once; no RDCW pending.
            CloseHandle((*h).dir_handle);
            (*h).dir_handle = INVALID_HANDLE_VALUE;
        }
        if let Some(cb) = (*h).cb {
            cb(&mut *lp, (*h).data, &[], 0, err);
        }
    }
}

/// Walk one completed batch of FILE_NOTIFY_INFORMATION records. Every field
/// is bounds-checked against the completed byte count before use — the
/// record stream is validated, not trusted. // quirk: SIGEV-44
///
/// # Safety
/// `lp`/`h` valid and pinned; the handle is started; `bytes` is the
/// completion's transferred count.
unsafe fn process_batch(lp: *mut Loop, h: *mut FsEventHandle, bytes: usize, dir_event: &mut bool) {
    // SAFETY: fn contract; the buffer base is re-derived after every user
    // callback (a restart from a callback re-arms RDCW, after which the
    // loop below observes reqs_pending and abandons the batch).
    unsafe {
        let bytes = bytes.min(BUFFER_BYTES);
        let mut pos: usize = 0;
        let mut name_scratch: Vec<u16> = Vec::new();
        loop {
            let Some(rem) = bytes.checked_sub(pos) else {
                return;
            };
            if !pos.is_multiple_of(4) || rem < RECORD_HEADER_BYTES {
                return; // malformed chain: never read past the batch
            }
            let base = buffer_base(h);
            let next = read_record_dword(base, pos) as usize;
            let action = read_record_dword(base, pos + 4);
            let name_len = read_record_dword(base, pos + 8) as usize;

            // The name is FileNameLength BYTES of UTF-16 — not
            // NUL-terminated. Copied out of the shared buffer so a callback
            // that restarts the watcher cannot invalidate it mid-call.
            // // quirk: SIGEV-30
            name_scratch.clear();
            if name_len > 0 {
                if !name_len.is_multiple_of(2) || name_len > rem - RECORD_HEADER_BYTES {
                    return; // malformed record: never read past the batch
                }
                name_scratch.resize(name_len / 2, 0);
                ptr::copy_nonoverlapping(
                    base.add(pos + RECORD_HEADER_BYTES),
                    name_scratch.as_mut_ptr().cast::<u8>(),
                    name_len,
                );
            }

            if name_scratch.is_empty() {
                // Zero-length-name record: the kernel's marker that the
                // watched directory itself changed (POSIX-delete final
                // batch). Not deliverable as a named event; feeds the
                // deletion probes instead. // quirk: SIGEV-48
                *dir_event = true;
            } else {
                deliver_record(lp, h, action, &name_scratch);
                // A callback may have stopped, closed, or restarted the
                // watcher (a fresh RDCW then owns the buffer): abandon the
                // rest of the batch. // quirk: SIGEV-46
                if (*h).core.is_closing() || !(*h).started || (*h).core.reqs_pending() > 0 {
                    return;
                }
            }

            if next == 0 {
                return; // last record
            }
            // NextEntryOffset is RELATIVE to this record, DWORD-aligned,
            // and must advance past the header. // quirk: SIGEV-44
            if next < RECORD_HEADER_BYTES || !next.is_multiple_of(4) {
                return;
            }
            match pos.checked_add(next) {
                Some(p) => pos = p,
                None => return,
            }
        }
    }
}

/// Filter + name-resolve + action-map one record, then fire the callback.
///
/// # Safety
/// `lp`/`h` valid and pinned; handle started.
unsafe fn deliver_record(lp: *mut Loop, h: *mut FsEventHandle, action: u32, raw_name: &[u16]) {
    // SAFETY: fn contract; `delivered` is a per-record local, so the slice
    // handed to the callback survives anything the callback does to the
    // handle.
    unsafe {
        // Creates, deletes and both rename halves are RENAME by
        // cross-platform contract (inotify parity); unknown actions are
        // parsed but produce no callback. // quirk: SIGEV-45
        let event = match action {
            FILE_ACTION_ADDED
            | FILE_ACTION_REMOVED
            | FILE_ACTION_RENAMED_OLD_NAME
            | FILE_ACTION_RENAMED_NEW_NAME => FS_EVENT_RENAME,
            FILE_ACTION_MODIFIED => FS_EVENT_CHANGE,
            _ => return,
        };

        let delivered: Vec<u16>;
        if let Some(filter) = (*h).file_filter.as_deref() {
            // File watch: the record may carry either alias of the watched
            // name — match both, full length, case-insensitively. Sibling
            // events are parsed and discarded. // quirk: SIGEV-27,
            // SIGEV-28, SIGEV-30, SIGEV-31
            let matches = ordinal_eq_ignore_case(filter, raw_name)
                || (*h)
                    .short_filter
                    .as_deref()
                    .is_some_and(|s| ordinal_eq_ignore_case(s, raw_name));
            if !matches {
                return;
            }
            // Report the name the user asked to watch, never the record's
            // alias. // quirk: SIGEV-51
            delivered = filter.to_vec();
        } else if action == FILE_ACTION_REMOVED || action == FILE_ACTION_RENAMED_OLD_NAME {
            // Gone entries cannot be resolved to long form; forward the
            // RDCW-reported name (which may be an 8.3 alias) — NULL here
            // historically forced consumers into full-subtree rescans.
            // // quirk: SIGEV-32
            delivered = raw_name.to_vec();
        } else {
            delivered =
                canonical_relative(&(*h).dir_norm, raw_name).unwrap_or_else(|| raw_name.to_vec());
        }
        if let Some(cb) = (*h).cb {
            // Subtree names keep their backslash separators. // quirk: SIGEV-25
            cb(&mut *lp, (*h).data, &delivered, event, Win32Error::SUCCESS);
        }
    }
}

/// All requests drained: fire the close callback; the owner frees the box
/// (and with it the buffer — only now provably kernel-untouched).
/// // quirk: SIGEV-22, LOOP-25
unsafe fn fs_event_endgame(core: *mut HandleCore) {
    // SAFETY: the endgame drain passes the live, queued handle; `core` is
    // the first field of the #[repr(C)] FsEventHandle.
    unsafe {
        let h = core.cast::<FsEventHandle>();
        debug_assert!((*h).dir_handle == INVALID_HANDLE_VALUE);
        debug_assert_eq!((*h).core.reqs_pending(), 0);
        let lp = (*h).core.loop_;
        let data = (*h).close_data;
        if let Some(cb) = (*h).close_cb.take() {
            cb(&mut *lp, data);
        }
    }
}

// ───────────────────────── probes & path helpers ─────────────────────────

/// The CreateFileW recipe — every flag is load-bearing: BACKUP_SEMANTICS is
/// the only way to open a directory, OVERLAPPED for async RDCW, and the
/// full share mode keeps other processes able to delete/rename the watched
/// directory while it is watched. // quirk: SIGEV-37
///
/// # Safety
/// `pathz` must be NUL-terminated.
unsafe fn open_watchable(pathz: &[u16]) -> Result<HANDLE, Win32Error> {
    debug_assert_eq!(pathz.last(), Some(&0));
    // SAFETY: fn contract — NUL-terminated path outliving the call.
    let h = unsafe {
        CreateFileW(
            pathz.as_ptr(),
            FILE_LIST_DIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED,
            ptr::null_mut(),
        )
    };
    if h == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    Ok(h)
}

/// Classify by HANDLE, never by path. // quirk: SIGEV-38
///
/// # Safety
/// `h` must be a valid kernel handle.
unsafe fn handle_is_directory(h: HANDLE) -> Result<bool, Win32Error> {
    // SAFETY: all-integer POD; a zeroed BY_HANDLE_FILE_INFORMATION is a
    // valid value, fully overwritten on success.
    let mut info =
        unsafe { core::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed().assume_init() };
    // SAFETY: valid out-pointer; handle validated kernel-side.
    if unsafe { GetFileInformationByHandle(h, &raw mut info) } == 0 {
        return Err(Win32Error::get());
    }
    Ok(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0)
}

/// FileStandardInformation probe: ACCESS_DENIED from RDCW on a directory
/// whose deletion is pending is a deletion event, not a permission error.
/// // quirk: SIGEV-47
fn dir_delete_pending(handle: HANDLE) -> bool {
    if handle == INVALID_HANDLE_VALUE {
        return false;
    }
    let mut info = FILE_STANDARD_INFORMATION::default();
    let mut iosb = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    // SAFETY: valid out-pointers sized to the query; the handle is
    // validated kernel-side.
    let status = unsafe {
        NtQueryInformationFile(
            handle,
            &raw mut iosb,
            (&raw mut info).cast::<c_void>(),
            size_of::<FILE_STANDARD_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileStandardInformation,
        )
    };
    status == NTSTATUS::SUCCESS && info.Directory != 0 && info.DeletePending != 0
}

/// Whether the still-open directory handle now points into the hidden
/// `\$Extend\$Deleted` namespace (POSIX delete unlinked the directory).
/// Dynamically sized — no MAX_PATH probe gap. // quirk: SIGEV-48, SIGEV-55
fn handle_is_zombie(handle: HANDLE) -> bool {
    if handle == INVALID_HANDLE_VALUE {
        return false;
    }
    let Some(path) = two_call_wide(|buf, cap|
        // SAFETY: out-buffer valid for `cap` chars; handle validated
        // kernel-side.
        unsafe {
            GetFinalPathNameByHandleW(handle, buf, cap, FILE_NAME_NORMALIZED | VOLUME_NAME_NONE)
        })
    else {
        return false; // probe failed: treat as live (fail open, like libuv)
    };
    path.windows(DELETED_MARKER.len())
        .any(|w| w == DELETED_MARKER)
}

/// Race-free long-form of the watch root from its open handle (the user may
/// have supplied an 8.3 spelling). // quirk: SIGEV-34
fn final_path_by_handle(handle: HANDLE) -> Option<Vec<u16>> {
    two_call_wide(|buf, cap|
        // SAFETY: out-buffer valid for `cap` chars; handle validated
        // kernel-side.
        unsafe {
            GetFinalPathNameByHandleW(handle, buf, cap, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS)
        })
}

/// Two-call `GetLongPathNameW`; a failed fill (the path changed between
/// calls) is a None — fallback, never an error. // quirk: SIGEV-33
fn get_long_path_name(pathz: &[u16]) -> Option<Vec<u16>> {
    debug_assert_eq!(pathz.last(), Some(&0));
    // SAFETY: `pathz` NUL-terminated; out-buffer valid for `cap` chars.
    two_call_wide(|buf, cap| unsafe { GetLongPathNameW(pathz.as_ptr(), buf, cap) })
}

/// Two-call `GetShortPathNameW`; None when the volume has no 8.3 names.
/// // quirk: SIGEV-29
fn get_short_path_name(pathz: &[u16]) -> Option<Vec<u16>> {
    debug_assert_eq!(pathz.last(), Some(&0));
    // SAFETY: `pathz` NUL-terminated; out-buffer valid for `cap` chars.
    two_call_wide(|buf, cap| unsafe { GetShortPathNameW(pathz.as_ptr(), buf, cap) })
}

/// Shared two-call dynamic sizing for the `Get*PathName` family: a
/// too-small buffer returns the required size INCLUDING the NUL, success
/// returns the length EXCLUDING it. No fixed MAX_PATH buffers anywhere.
/// // quirk: SIGEV-33, SIGEV-55
fn two_call_wide(mut call: impl FnMut(*mut u16, DWORD) -> DWORD) -> Option<Vec<u16>> {
    let mut buf: Vec<u16> = vec![0u16; 262];
    loop {
        let n = call(buf.as_mut_ptr(), buf.len() as DWORD) as usize;
        if n == 0 {
            return None;
        }
        if n < buf.len() {
            buf.truncate(n);
            return Some(buf);
        }
        if n == buf.len() {
            // Contract violation; refuse to spin. Report a deterministic error
            // so `.ok_or_else(Win32Error::get)` at callers is not stale.
            SetLastError(DWORD::from(Win32Error::INSUFFICIENT_BUFFER.int()));
            return None;
        }
        buf.resize(n, 0);
    }
}

/// CWD parent for bare-filename watches (same two-call convention).
/// // quirk: SIGEV-36
fn current_directory() -> Result<Vec<u16>, Win32Error> {
    // SAFETY: out-buffer valid for `cap` chars.
    two_call_wide(|buf, cap| unsafe { GetCurrentDirectoryW(cap, buf) }).ok_or_else(Win32Error::get)
}

/// Split a non-directory watch path into (parent, basename). The parent
/// keeps its trailing separator — `\\?\C:` opens the volume device; only
/// `\\?\C:\` names the root directory — and a bare filename resolves to the
/// current directory. // quirk: SIGEV-35, SIGEV-36
fn split_path(path: &[u16]) -> Result<(Vec<u16>, Vec<u16>), Win32Error> {
    const BS: u16 = b'\\' as u16;
    const FS: u16 = b'/' as u16;
    match path.iter().rposition(|&c| c == BS || c == FS) {
        Some(i) => Ok((path[..=i].to_vec(), path[i + 1..].to_vec())),
        None => Ok((current_directory()?, path.to_vec())),
    }
}

/// Strip ONE trailing path separator (so a root like `\\?\C:\` joins as
/// `\\?\C:\name`, not `\\?\C:\\name`).
fn strip_trailing_sep(d: &[u16]) -> &[u16] {
    match d.split_last() {
        Some((&last, rest)) if last == b'\\' as u16 || last == b'/' as u16 => rest,
        _ => d,
    }
}

/// Long-form canonicalization of `dir\name`, reported relative to the watch
/// root. None when the entry vanished or the resolved path is not under the
/// root — the prefix relation is validated at runtime, never assumed (the
/// raw record name is the fallback). // quirk: SIGEV-32, SIGEV-33, SIGEV-34
fn canonical_relative(dir_norm: &[u16], name: &[u16]) -> Option<Vec<u16>> {
    if dir_norm.is_empty() {
        return None;
    }
    let root = strip_trailing_sep(dir_norm);
    let mut full: Vec<u16> = Vec::with_capacity(root.len() + name.len() + 2);
    full.extend_from_slice(root);
    full.push(b'\\' as u16);
    full.extend_from_slice(name);
    full.push(0);
    let long = get_long_path_name(&full)?;
    if long.len() > root.len() + 1
        && ordinal_eq_ignore_case(&long[..root.len()], root)
        && (long[root.len()] == b'\\' as u16 || long[root.len()] == b'/' as u16)
    {
        Some(long[root.len() + 1..].to_vec())
    } else {
        None
    }
}

/// Full-length, case-insensitive ordinal comparison via the OS upcase table
/// (the kernel's own folding — CRT `_wcsnicmp` diverges for non-ASCII).
/// Length inequality short-circuits: equality only, never a prefix match.
/// // quirk: SIGEV-30, SIGEV-31
fn ordinal_eq_ignore_case(a: &[u16], b: &[u16]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    if a.is_empty() {
        return true;
    }
    debug_assert!(a.len() <= c_int::MAX as usize);
    // SAFETY: counted UTF-16 slices; the explicit lengths bound both reads
    // (no NUL termination required).
    unsafe {
        CompareStringOrdinal(
            a.as_ptr(),
            a.len() as c_int,
            b.as_ptr(),
            b.len() as c_int,
            TRUE,
        ) == CSTR_EQUAL
    }
}

/// Buffer base, re-derived per access (a callback may have re-armed RDCW;
/// the caller checks `reqs_pending` before reading further).
///
/// # Safety
/// `h` valid and pinned; the buffer is allocated (handle was started).
#[inline]
unsafe fn buffer_base(h: *mut FsEventHandle) -> *const u8 {
    // SAFETY: fn contract.
    unsafe {
        (*h).buffer
            .as_ref()
            .expect("buffer allocated at start")
            .as_ptr()
            .cast::<u8>()
    }
}

/// Unaligned-safe DWORD read from the raw record stream — no struct casts;
/// the stream is validated, not trusted. // quirk: SIGEV-44
///
/// # Safety
/// `base + off + 4` must be within the completed byte count.
#[inline]
unsafe fn read_record_dword(base: *const u8, off: usize) -> u32 {
    let mut raw = [0u8; 4];
    // SAFETY: fn contract — the four bytes are in bounds.
    unsafe { ptr::copy_nonoverlapping(base.add(off), raw.as_mut_ptr(), 4) };
    u32::from_ne_bytes(raw)
}

#[cfg(test)]
mod tests {
    use bun_windows_sys::kernel32::{RemoveDirectoryW, WriteFile};
    use bun_windows_sys::{
        CREATE_ALWAYS, CreateDirectoryW, DeleteFileW, GENERIC_WRITE, GetCurrentProcessId,
        GetTempPathW, MOVEFILE_REPLACE_EXISTING, MoveFileExW, RtlGenRandom,
    };

    use super::*;
    use crate::test_sync::serial;

    // ── wide-string + filesystem helpers (raw Win32: the test binary is
    //    tier-0 and these double as the event generators) ─────────────────

    fn w(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }
    fn wz(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(core::iter::once(0)).collect()
    }
    fn lossy(units: &[u16]) -> String {
        String::from_utf16_lossy(units)
    }

    /// Unique directory under %TEMP%; returned WITHOUT a trailing slash.
    fn temp_root(tag: &str) -> String {
        let mut tmp = [0u16; 512];
        // SAFETY: valid out-buffer sized to the call (the extern declares
        // the out param as LPCWSTR; pass a mut-derived ptr).
        let n = unsafe { GetTempPathW(512, tmp.as_mut_ptr().cast_const()) } as usize;
        assert!(n > 0 && n < 480);
        let mut rand: u64 = 0;
        // SAFETY: writes 8 bytes into a valid local.
        let _ = unsafe { RtlGenRandom((&raw mut rand).cast::<c_void>(), 8) };
        let base = String::from_utf16(&tmp[..n]).unwrap();
        let base = base.trim_end_matches('\\').to_string();
        let root = format!(
            "{base}\\bun-fsev-{tag}-{:08x}-{rand:016x}",
            GetCurrentProcessId()
        );
        mkdir(&root);
        root
    }

    fn mkdir(path: &str) {
        let p = wz(path);
        // SAFETY: NUL-terminated path; default security.
        let ok = unsafe { CreateDirectoryW(p.as_ptr(), ptr::null_mut()) };
        assert_ne!(ok, 0, "mkdir {path}: {:?}", Win32Error::get());
    }

    fn rmdir(path: &str) {
        let p = wz(path);
        // SAFETY: NUL-terminated path.
        let ok = unsafe { RemoveDirectoryW(p.as_ptr()) };
        assert_ne!(ok, 0, "rmdir {path}: {:?}", Win32Error::get());
    }

    /// Create (or truncate) a file, optionally writing bytes into it.
    fn put_file(path: &str, contents: &[u8]) {
        let p = wz(path);
        // SAFETY: NUL-terminated path; handle closed below.
        let h = unsafe {
            CreateFileW(
                p.as_ptr(),
                GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                ptr::null_mut(),
                CREATE_ALWAYS,
                0,
                ptr::null_mut(),
            )
        };
        assert_ne!(
            h,
            INVALID_HANDLE_VALUE,
            "create {path}: {:?}",
            Win32Error::get()
        );
        if !contents.is_empty() {
            let mut written: DWORD = 0;
            // SAFETY: valid buffer + out-pointer; synchronous handle.
            let ok = unsafe {
                WriteFile(
                    h,
                    contents.as_ptr(),
                    contents.len() as DWORD,
                    &raw mut written,
                    ptr::null_mut(),
                )
            };
            assert_ne!(ok, 0);
        }
        // SAFETY: opened above, closed exactly once.
        unsafe { CloseHandle(h) };
    }

    fn del_file(path: &str) {
        let p = wz(path);
        // SAFETY: NUL-terminated path.
        let ok = unsafe { DeleteFileW(p.as_ptr()) };
        assert_ne!(ok, 0, "delete {path}: {:?}", Win32Error::get());
    }

    fn rename(from: &str, to: &str) {
        let f = wz(from);
        let t = wz(to);
        // SAFETY: NUL-terminated paths.
        let ok = unsafe { MoveFileExW(f.as_ptr(), t.as_ptr(), MOVEFILE_REPLACE_EXISTING) };
        assert_ne!(ok, 0, "rename {from} -> {to}: {:?}", Win32Error::get());
    }

    // ── recording context (callbacks only record + scripted actions; the
    //    behavioral assertions run after teardown) ─────────────────────────

    struct Ctx {
        events: Vec<(Vec<u16>, u32, Win32Error)>,
        closed: u32,
        handle: *mut FsEventHandle,
        /// Call stop() from inside the first event callback.
        stop_on_first: bool,
        /// Call close() from inside the first event callback.
        close_on_first: bool,
    }

    impl Ctx {
        fn new() -> Ctx {
            Ctx {
                events: Vec::new(),
                closed: 0,
                handle: ptr::null_mut(),
                stop_on_first: false,
                close_on_first: false,
            }
        }
        fn count(&self, name: &str, ev: u32) -> usize {
            let needle = w(name);
            self.events
                .iter()
                .filter(|(n, e, _)| *e == ev && *n == needle)
                .count()
        }
        fn rescans(&self) -> usize {
            self.events
                .iter()
                .filter(|(_, e, _)| *e == FS_EVENT_RESCAN)
                .count()
        }
        fn errors(&self) -> Vec<Win32Error> {
            self.events
                .iter()
                .filter(|(_, _, err)| *err != Win32Error::SUCCESS)
                .map(|(_, _, err)| *err)
                .collect()
        }
        fn dump(&self) -> Vec<(String, u32, u16)> {
            self.events
                .iter()
                .map(|(n, e, err)| (lossy(n), *e, err.int()))
                .collect()
        }
    }

    unsafe fn on_event(_l: &mut Loop, d: *mut c_void, name: &[u16], ev: u32, err: Win32Error) {
        // SAFETY: `d` is the test Ctx; `handle` is the live boxed watcher
        // when a scripted action is set.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.events.push((name.to_vec(), ev, err));
            if ctx.stop_on_first && ctx.events.len() == 1 {
                (*ctx.handle).stop();
            }
            if ctx.close_on_first && ctx.events.len() == 1 {
                (*ctx.handle).close(Some(on_close), d);
            }
        }
    }

    unsafe fn on_close(_l: &mut Loop, d: *mut c_void) {
        // SAFETY: `d` is the test Ctx.
        unsafe {
            (*d.cast::<Ctx>()).closed += 1;
        }
    }

    /// Tick until `cond` or the deadline; assertions live at the call site.
    fn tick_until(loop_: &mut Loop, ms: u64, mut cond: impl FnMut() -> bool) {
        let deadline = loop_.now_ms() + ms;
        while !cond() && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
    }

    /// Bounded quiet window: events that SHOULD NOT arrive get this long.
    fn quiet_window(loop_: &mut Loop) {
        for _ in 0..10 {
            loop_.tick(Some(20));
        }
    }

    fn close_and_drain(loop_: &mut Loop, h: &mut FsEventHandle, ctx_ptr: *mut Ctx) {
        h.close(Some(on_close), ctx_ptr.cast());
        // SAFETY: ctx outlives the drain (caller owns it on the stack).
        tick_until(loop_, 5_000, || unsafe { (*ctx_ptr).closed > 0 });
    }

    // ── tests ─────────────────────────────────────────────────────────────

    /// 1. Directory watch end-to-end: create → RENAME, modify → CHANGE,
    /// rename → RENAME for BOTH halves (two records in one batch), delete →
    /// RENAME; canonical relative names; no spurious rescans or errors.
    /// // quirk: SIGEV-25, SIGEV-30, SIGEV-32, SIGEV-44, SIGEV-45
    #[test]
    fn dir_watch_create_modify_rename_delete() {
        let _guard = serial();
        let root = temp_root("crud");
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut wat = unsafe { FsEventHandle::new(lp) };
        let mut ctx = Ctx::new();
        let d: *mut c_void = (&raw mut ctx).cast();
        // SAFETY: ctx outlives the close drain.
        unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };

        let alpha = format!("{root}\\alpha.txt");
        let beta = format!("{root}\\beta.txt");

        put_file(&alpha, b"");
        tick_until(&mut loop_, 5_000, || {
            ctx.count("alpha.txt", FS_EVENT_RENAME) >= 1
        });

        put_file(&alpha, b"contents");
        tick_until(&mut loop_, 5_000, || {
            ctx.count("alpha.txt", FS_EVENT_CHANGE) >= 1
        });

        let renames_before = ctx.count("alpha.txt", FS_EVENT_RENAME);
        rename(&alpha, &beta);
        tick_until(&mut loop_, 5_000, || {
            ctx.count("alpha.txt", FS_EVENT_RENAME) > renames_before
                && ctx.count("beta.txt", FS_EVENT_RENAME) >= 1
        });

        let beta_renames_before = ctx.count("beta.txt", FS_EVENT_RENAME);
        del_file(&beta);
        tick_until(&mut loop_, 5_000, || {
            ctx.count("beta.txt", FS_EVENT_RENAME) > beta_renames_before
        });

        close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
        let alive_after = loop_.alive();
        drop(wat);
        drop(loop_);
        rmdir(&root);

        assert!(
            ctx.count("alpha.txt", FS_EVENT_RENAME) >= 1,
            "create delivered as RENAME: {:?}",
            ctx.dump()
        );
        assert!(
            ctx.count("alpha.txt", FS_EVENT_CHANGE) >= 1,
            "modify delivered as CHANGE: {:?}",
            ctx.dump()
        );
        assert!(
            ctx.count("alpha.txt", FS_EVENT_RENAME) > renames_before,
            "rename OLD half delivered: {:?}",
            ctx.dump()
        );
        assert!(
            ctx.count("beta.txt", FS_EVENT_RENAME) >= 2,
            "rename NEW half + delete both delivered: {:?}",
            ctx.dump()
        );
        assert_eq!(ctx.rescans(), 0, "no spurious rescan: {:?}", ctx.dump());
        assert_eq!(ctx.errors(), vec![], "no errors: {:?}", ctx.dump());
        assert_eq!(ctx.closed, 1);
        assert!(!alive_after);
    }

    /// 2. File watch: sibling events are filtered out; matches are
    /// case-insensitive; the delivered name is the USER's spelling, not the
    /// record's. // quirk: SIGEV-27, SIGEV-28, SIGEV-30, SIGEV-31, SIGEV-51
    #[test]
    fn file_watch_filters_siblings_and_reports_user_spelling() {
        let _guard = serial();
        let root = temp_root("filter");
        let target = format!("{root}\\Target.txt");
        let sibling = format!("{root}\\noise.txt");
        put_file(&target, b"");
        put_file(&sibling, b"");

        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut wat = unsafe { FsEventHandle::new(lp) };
        let mut ctx = Ctx::new();
        let d: *mut c_void = (&raw mut ctx).cast();
        // Watch with a case-variant spelling: events must still match (the
        // file exists as "Target.txt") and report THIS spelling back.
        let user_spelling = format!("{root}\\target.TXT");
        // SAFETY: ctx outlives the close drain.
        unsafe { wat.start(&w(&user_spelling), false, on_event, d).unwrap() };

        put_file(&sibling, b"sibling noise");
        quiet_window(&mut loop_);
        let events_after_sibling = ctx.events.len();

        put_file(&target, b"target change");
        tick_until(&mut loop_, 5_000, || {
            ctx.count("target.TXT", FS_EVENT_CHANGE) >= 1
        });

        close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
        let alive_after = loop_.alive();
        drop(wat);
        drop(loop_);
        del_file(&target);
        del_file(&sibling);
        rmdir(&root);

        assert_eq!(
            events_after_sibling,
            0,
            "sibling events must be filtered out: {:?}",
            ctx.dump()
        );
        assert!(
            ctx.count("target.TXT", FS_EVENT_CHANGE) >= 1,
            "watched-file change delivered with the user's spelling: {:?}",
            ctx.dump()
        );
        assert!(
            ctx.events.iter().all(|(n, _, _)| *n == w("target.TXT")),
            "every delivery names the user's path verbatim: {:?}",
            ctx.dump()
        );
        assert_eq!(ctx.closed, 1);
        assert!(!alive_after);
    }

    /// 3. The recursive flag is a dedicated field and keeps its polarity
    /// across re-arms — both directions (libuv's re-arm read the ACTIVE
    /// lifecycle bit as "recursive"). Recursive subtree names arrive
    /// relative with backslashes. // quirk: SIGEV-25, SIGEV-26
    #[test]
    fn recursive_flag_survives_rearm() {
        let _guard = serial();
        let root = temp_root("rec");
        let sub = format!("{root}\\sub");
        mkdir(&sub);

        // (a) NON-recursive: subtree events must stay invisible even after
        // multiple completions have re-armed the watch.
        {
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives the watcher.
            let mut wat = unsafe { FsEventHandle::new(lp) };
            let mut ctx = Ctx::new();
            let d: *mut c_void = (&raw mut ctx).cast();
            // SAFETY: ctx outlives the close drain.
            unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };

            put_file(&format!("{root}\\top1.txt"), b"");
            tick_until(&mut loop_, 5_000, || {
                ctx.count("top1.txt", FS_EVENT_RENAME) >= 1
            });

            // The watch has re-armed at least once now; subtree activity
            // must still be filtered by the kernel (bWatchSubtree=FALSE).
            put_file(&format!("{sub}\\inner1.txt"), b"inner");
            quiet_window(&mut loop_);

            put_file(&format!("{root}\\top2.txt"), b"");
            tick_until(&mut loop_, 5_000, || {
                ctx.count("top2.txt", FS_EVENT_RENAME) >= 1
            });

            close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
            drop(wat);
            drop(loop_);

            assert!(ctx.count("top1.txt", FS_EVENT_RENAME) >= 1);
            assert!(
                ctx.count("top2.txt", FS_EVENT_RENAME) >= 1,
                "watcher alive after quiet window: {:?}",
                ctx.dump()
            );
            let bs = b'\\' as u16;
            assert!(
                ctx.events.iter().all(|(n, _, _)| !n.contains(&bs)),
                "non-recursive watch must never deliver subtree paths \
                 (re-arm flipped the recursion bit): {:?}",
                ctx.dump()
            );
        }

        // (b) RECURSIVE: subtree events arrive as relative backslash paths,
        // and keep arriving after re-arms.
        {
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives the watcher.
            let mut wat = unsafe { FsEventHandle::new(lp) };
            let mut ctx = Ctx::new();
            let d: *mut c_void = (&raw mut ctx).cast();
            // SAFETY: ctx outlives the close drain.
            unsafe { wat.start(&w(&root), true, on_event, d).unwrap() };

            put_file(&format!("{sub}\\inner2.txt"), b"");
            tick_until(&mut loop_, 5_000, || {
                ctx.count("sub\\inner2.txt", FS_EVENT_RENAME) >= 1
            });
            // Across a re-arm:
            put_file(&format!("{sub}\\inner3.txt"), b"");
            tick_until(&mut loop_, 5_000, || {
                ctx.count("sub\\inner3.txt", FS_EVENT_RENAME) >= 1
            });

            close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
            drop(wat);
            drop(loop_);

            assert!(
                ctx.count("sub\\inner2.txt", FS_EVENT_RENAME) >= 1,
                "recursive subtree create delivered relative-with-backslash: {:?}",
                ctx.dump()
            );
            assert!(
                ctx.count("sub\\inner3.txt", FS_EVENT_RENAME) >= 1,
                "recursion survives the re-arm: {:?}",
                ctx.dump()
            );
        }

        for f in ["top1.txt", "top2.txt"] {
            del_file(&format!("{root}\\{f}"));
        }
        for f in ["inner1.txt", "inner2.txt", "inner3.txt"] {
            del_file(&format!("{sub}\\{f}"));
        }
        rmdir(&sub);
        rmdir(&root);
    }

    /// 4. THE OVERFLOW REGRESSION (tier-1): a burst generated while the
    /// loop is blocked overflows the kernel-side queue; the resulting
    /// zero-byte success completion MUST surface as an explicit rescan
    /// signal — never be dropped. // quirk: SIGEV-42, SIGEV-43
    #[test]
    fn overflow_surfaces_rescan_signal() {
        let _guard = serial();
        let root = temp_root("ovfl");
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut wat = unsafe { FsEventHandle::new(lp) };
        let mut ctx = Ctx::new();
        let d: *mut c_void = (&raw mut ctx).cast();
        // SAFETY: ctx outlives the close drain.
        unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };

        // Without ticking, each create appends a record to the kernel's
        // internal queue (sized to our 64 KiB buffer). 600 files with
        // ~100-char names ≈ 600 * (12 + 208) bytes ≈ 129 KiB of records —
        // guaranteed overflow while the loop is blocked.
        let stem = "x".repeat(96);
        for i in 0..600 {
            put_file(&format!("{root}\\{stem}{i:04}.tmp"), b"");
        }

        tick_until(&mut loop_, 10_000, || ctx.rescans() >= 1);

        close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
        let alive_after = loop_.alive();
        drop(wat);
        drop(loop_);
        for i in 0..600 {
            del_file(&format!("{root}\\{stem}{i:04}.tmp"));
        }
        rmdir(&root);

        let rescan_events: Vec<_> = ctx
            .events
            .iter()
            .filter(|(_, e, _)| *e == FS_EVENT_RESCAN)
            .collect();
        assert!(
            !rescan_events.is_empty(),
            "overflow MUST surface as a rescan signal (got {} events, 0 rescans)",
            ctx.events.len()
        );
        assert!(
            rescan_events
                .iter()
                .all(|(n, _, err)| n.is_empty() && *err == Win32Error::SUCCESS),
            "rescan shape: empty filename + SUCCESS: {:?}",
            ctx.dump()
        );
        assert_eq!(
            ctx.errors(),
            vec![],
            "overflow is a rescan, not an error: {:?}",
            ctx.dump()
        );
        assert_eq!(ctx.closed, 1);
        assert!(!alive_after);
    }

    /// 5. stop() delivers nothing afterwards: not for new filesystem
    /// activity, not for the canceled in-flight completion, and not for the
    /// remainder of a batch when a callback stops mid-batch (the rename OLD
    /// record's callback stops before the NEW record). // quirk: SIGEV-39,
    /// SIGEV-40, SIGEV-46
    #[test]
    fn stop_delivers_nothing_after() {
        let _guard = serial();

        // (a) stop between batches: later activity + the canceled
        // completion deliver nothing.
        {
            let root = temp_root("stopa");
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives the watcher.
            let mut wat = unsafe { FsEventHandle::new(lp) };
            let mut ctx = Ctx::new();
            let d: *mut c_void = (&raw mut ctx).cast();
            // SAFETY: ctx outlives the close drain.
            unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };

            put_file(&format!("{root}\\seen.txt"), b"");
            tick_until(&mut loop_, 5_000, || {
                ctx.count("seen.txt", FS_EVENT_RENAME) >= 1
            });

            let frozen = ctx.events.len();
            wat.stop();
            put_file(&format!("{root}\\unseen1.txt"), b"");
            put_file(&format!("{root}\\unseen2.txt"), b"");
            quiet_window(&mut loop_);
            let after_stop = ctx.events.len();

            close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
            let alive_after = loop_.alive();
            drop(wat);
            drop(loop_);
            for f in ["seen.txt", "unseen1.txt", "unseen2.txt"] {
                del_file(&format!("{root}\\{f}"));
            }
            rmdir(&root);

            assert_eq!(
                after_stop,
                frozen,
                "no delivery after stop (canceled completion swallowed): {:?}",
                ctx.dump()
            );
            assert_eq!(ctx.events.len(), frozen, "close delivered nothing either");
            assert_eq!(ctx.closed, 1);
            assert!(!alive_after);
        }

        // (b) stop from inside a callback abandons the rest of the batch:
        // a rename produces OLD+NEW records together; stopping in the OLD
        // callback must suppress the NEW one.
        {
            let root = temp_root("stopb");
            let from = format!("{root}\\old-name.txt");
            let to = format!("{root}\\new-name.txt");
            put_file(&from, b"");

            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives the watcher.
            let mut wat = unsafe { FsEventHandle::new(lp) };
            let mut ctx = Ctx::new();
            ctx.stop_on_first = true;
            ctx.handle = &raw mut *wat;
            let d: *mut c_void = (&raw mut ctx).cast();
            // SAFETY: ctx outlives the close drain.
            unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };

            rename(&from, &to);
            tick_until(&mut loop_, 5_000, || !ctx.events.is_empty());
            quiet_window(&mut loop_);

            close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
            drop(wat);
            drop(loop_);
            del_file(&to);
            rmdir(&root);

            assert_eq!(
                ctx.events.len(),
                1,
                "stop-from-callback abandons the batch remainder: {:?}",
                ctx.dump()
            );
            assert_eq!(ctx.closed, 1);
        }
    }

    /// 6. Close protocol: asynchronous, endgame-gated on the in-flight
    /// completion (kernel owns buffer+OVERLAPPED until then), no event
    /// callback after close — even for a DATA completion already queued —
    /// and close-from-callback completes cleanly. // quirk: SIGEV-39,
    /// LOOP-25, LOOP-04
    #[test]
    fn close_with_inflight_completion_drains_cleanly() {
        let _guard = serial();

        // (a) close with the armed (idle) RDCW in flight.
        {
            let root = temp_root("closea");
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives the watcher.
            let mut wat = unsafe { FsEventHandle::new(lp) };
            let mut ctx = Ctx::new();
            let d: *mut c_void = (&raw mut ctx).cast();
            // SAFETY: ctx outlives the close drain.
            unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };

            let reqs_at_close = wat.core.reqs_pending();
            wat.close(Some(on_close), d);
            let closed_synchronously = ctx.closed != 0;
            let alive_while_closing = loop_.alive();
            tick_until(&mut loop_, 5_000, || ctx.closed > 0);
            let alive_after = loop_.alive();
            drop(wat);
            drop(loop_);
            rmdir(&root);

            assert_eq!(reqs_at_close, 1, "RDCW in flight at close");
            assert!(!closed_synchronously, "close must be asynchronous");
            assert!(alive_while_closing, "closing handle holds the loop");
            assert_eq!(ctx.closed, 1);
            assert!(ctx.events.is_empty());
            assert!(!alive_after);
        }

        // (b) close with a DATA completion already queued: it drains
        // without delivering.
        {
            let root = temp_root("closeb");
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives the watcher.
            let mut wat = unsafe { FsEventHandle::new(lp) };
            let mut ctx = Ctx::new();
            let d: *mut c_void = (&raw mut ctx).cast();
            // SAFETY: ctx outlives the close drain.
            unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };

            // No tick between the event and close: the completion packet
            // sits in the port when close() runs.
            put_file(&format!("{root}\\data.txt"), b"");
            wat.close(Some(on_close), d);
            tick_until(&mut loop_, 5_000, || ctx.closed > 0);
            let alive_after = loop_.alive();
            drop(wat);
            drop(loop_);
            del_file(&format!("{root}\\data.txt"));
            rmdir(&root);

            assert!(
                ctx.events.is_empty(),
                "no event callback after close: {:?}",
                ctx.dump()
            );
            assert_eq!(ctx.closed, 1);
            assert!(!alive_after);
        }

        // (c) close from inside the event callback.
        {
            let root = temp_root("closec");
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives the watcher.
            let mut wat = unsafe { FsEventHandle::new(lp) };
            let mut ctx = Ctx::new();
            ctx.close_on_first = true;
            ctx.handle = &raw mut *wat;
            let d: *mut c_void = (&raw mut ctx).cast();
            // SAFETY: ctx outlives the close drain.
            unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };

            put_file(&format!("{root}\\trigger.txt"), b"");
            tick_until(&mut loop_, 5_000, || ctx.closed > 0);
            quiet_window(&mut loop_);
            let alive_after = loop_.alive();
            drop(wat);
            drop(loop_);
            del_file(&format!("{root}\\trigger.txt"));
            rmdir(&root);

            assert_eq!(
                ctx.events.len(),
                1,
                "exactly the event that closed: {:?}",
                ctx.dump()
            );
            assert_eq!(ctx.closed, 1, "close-from-callback completes");
            assert!(!alive_after);
        }
    }

    /// 7. Restart while the canceled completion is still in flight: the arm
    /// is deferred to the drain (never two operations on one OVERLAPPED),
    /// the stale completion delivers nothing, and the new watch then works.
    /// // quirk: SIGEV-40
    #[test]
    fn restart_while_cancel_in_flight_defers_arm() {
        let _guard = serial();
        let root = temp_root("restart");
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut wat = unsafe { FsEventHandle::new(lp) };
        let mut ctx = Ctx::new();
        let d: *mut c_void = (&raw mut ctx).cast();
        // SAFETY: ctx outlives the close drain.
        unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };

        put_file(&format!("{root}\\first.txt"), b"");
        tick_until(&mut loop_, 5_000, || {
            ctx.count("first.txt", FS_EVENT_RENAME) >= 1
        });

        wat.stop();
        let cancel_in_flight = wat.core.reqs_pending() > 0;
        // Restart BEFORE the canceled completion drains.
        // SAFETY: ctx outlives the close drain.
        unsafe { wat.start(&w(&root), false, on_event, d).unwrap() };
        let frozen = ctx.events.len();

        // Drain the stale completion (and with it, perform the deferred
        // arm); nothing may be delivered by it.
        quiet_window(&mut loop_);
        let after_drain = ctx.events.len();

        put_file(&format!("{root}\\second.txt"), b"");
        tick_until(&mut loop_, 5_000, || {
            ctx.count("second.txt", FS_EVENT_RENAME) >= 1
        });

        close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
        let alive_after = loop_.alive();
        drop(wat);
        drop(loop_);
        del_file(&format!("{root}\\first.txt"));
        del_file(&format!("{root}\\second.txt"));
        rmdir(&root);

        assert!(
            cancel_in_flight,
            "test precondition: the canceled completion was still in flight at restart"
        );
        assert_eq!(
            after_drain,
            frozen,
            "the stale completion delivered nothing: {:?}",
            ctx.dump()
        );
        assert!(
            ctx.count("second.txt", FS_EVENT_RENAME) >= 1,
            "the deferred arm took over: {:?}",
            ctx.dump()
        );
        assert_eq!(ctx.errors(), vec![], "no spurious error: {:?}", ctx.dump());
        assert_eq!(ctx.closed, 1);
        assert!(!alive_after);
    }

    /// 8. Watched-directory deletion: delivered (as the directory's own
    /// rename and/or a rescan) followed by exactly one terminal error, then
    /// silence — never an infinite error/event loop, never a silent zombie.
    /// Accepts both deletion semantics (classic → ACCESS_DENIED path,
    /// POSIX → $Deleted zombie path). // quirk: SIGEV-47, SIGEV-48
    #[test]
    fn watched_dir_deletion_reports_then_parks() {
        let _guard = serial();
        let parent = temp_root("del");
        let victim = format!("{parent}\\victim");
        mkdir(&victim);

        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut wat = unsafe { FsEventHandle::new(lp) };
        let mut ctx = Ctx::new();
        let d: *mut c_void = (&raw mut ctx).cast();
        // SAFETY: ctx outlives the close drain.
        unsafe { wat.start(&w(&victim), false, on_event, d).unwrap() };

        rmdir(&victim);
        tick_until(&mut loop_, 10_000, || !ctx.errors().is_empty());
        let started_after_error = wat.is_started();
        quiet_window(&mut loop_);

        close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
        let alive_after = loop_.alive();
        drop(wat);
        drop(loop_);
        rmdir(&parent);

        let errors = ctx.errors();
        assert_eq!(
            errors.len(),
            1,
            "exactly one terminal error (no error loop): {:?}",
            ctx.dump()
        );
        assert!(
            errors[0] == Win32Error::ACCESS_DENIED || errors[0] == Win32Error::FILE_NOT_FOUND,
            "deletion classifies as the raw delete shape, got {:?}",
            errors[0]
        );
        let (last_name, last_ev, last_err) = ctx.events.last().unwrap();
        assert!(
            *last_err != Win32Error::SUCCESS && last_name.is_empty() && *last_ev == 0,
            "the error is the LAST delivery (parked after): {:?}",
            ctx.dump()
        );
        for (name, ev, err) in &ctx.events[..ctx.events.len() - 1] {
            assert!(
                *err == Win32Error::SUCCESS
                    && ((*ev == FS_EVENT_RENAME && *name == w(&victim))
                        || (*ev == FS_EVENT_RESCAN && name.is_empty())),
                "pre-error deliveries are the dir's own rename or a rescan: {:?}",
                ctx.dump()
            );
        }
        assert!(!started_after_error, "watcher parked after the error");
        assert_eq!(ctx.closed, 1);
        assert!(!alive_after);
    }

    /// 9. Recursive watch over relative paths LONGER than MAX_PATH: the
    /// full relative name (backslash separated, > 260 chars) is delivered
    /// intact — no fixed-size path buffers anywhere in the event path.
    /// // quirk: SIGEV-54, SIGEV-55
    #[test]
    fn recursive_watch_long_relative_paths() {
        let _guard = serial();
        let root = temp_root("long");
        let l1 = "a".repeat(120);
        let l2 = "b".repeat(120);
        let leaf = format!("{}.txt", "f".repeat(60));
        // Creation needs the \\?\ no-parse prefix; the watcher itself is
        // started on the plain path.
        let p1 = format!("\\\\?\\{root}\\{l1}");
        let p2 = format!("{p1}\\{l2}");
        let pf = format!("{p2}\\{leaf}");

        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut wat = unsafe { FsEventHandle::new(lp) };
        let mut ctx = Ctx::new();
        let d: *mut c_void = (&raw mut ctx).cast();
        // SAFETY: ctx outlives the close drain.
        unsafe { wat.start(&w(&root), true, on_event, d).unwrap() };

        mkdir(&p1);
        mkdir(&p2);
        put_file(&pf, b"deep");
        let rel = format!("{l1}\\{l2}\\{leaf}");
        assert!(
            rel.len() > 260,
            "test precondition: relative path beyond MAX_PATH"
        );
        tick_until(&mut loop_, 10_000, || ctx.count(&rel, FS_EVENT_RENAME) >= 1);

        close_and_drain(&mut loop_, &mut wat, &raw mut ctx);
        drop(wat);
        drop(loop_);
        del_file(&pf);
        rmdir(&p2);
        rmdir(&p1);
        rmdir(&root);

        assert!(
            ctx.count(&rel, FS_EVENT_RENAME) >= 1,
            "deep create delivered with the full >MAX_PATH relative name: {:?}",
            ctx.dump()
        );
        assert_eq!(ctx.errors(), vec![], "no errors: {:?}", ctx.dump());
        assert_eq!(ctx.closed, 1);
    }

    /// Pure-helper semantics: split keeps the root separator and resolves
    /// bare names against the CWD; the ordinal comparison is equality-only
    /// (no prefix matches) and case-folds like the kernel.
    /// // quirk: SIGEV-30, SIGEV-31, SIGEV-35, SIGEV-36
    #[test]
    fn path_helper_semantics() {
        let (dir, file) = split_path(&w(r"C:\file.txt")).unwrap();
        assert_eq!(
            (lossy(&dir), lossy(&file)),
            (r"C:\".into(), "file.txt".into())
        );
        let (dir, file) = split_path(&w(r"C:\nested\dir\x.txt")).unwrap();
        assert_eq!(
            (lossy(&dir), lossy(&file)),
            (r"C:\nested\dir\".into(), "x.txt".into())
        );
        let (dir, file) = split_path(&w("C:/fwd/y.txt")).unwrap();
        assert_eq!(
            (lossy(&dir), lossy(&file)),
            ("C:/fwd/".into(), "y.txt".into())
        );
        let (dir, file) = split_path(&w("bare.txt")).unwrap();
        assert!(!dir.is_empty(), "bare filename parent resolves to the CWD");
        assert_eq!(lossy(&file), "bare.txt");

        assert_eq!(lossy(strip_trailing_sep(&w(r"C:\dir\"))), r"C:\dir");
        assert_eq!(lossy(strip_trailing_sep(&w(r"C:\dir"))), r"C:\dir");

        assert!(ordinal_eq_ignore_case(&w("FiLe.TXT"), &w("file.txt")));
        assert!(ordinal_eq_ignore_case(&w("éFile"), &w("Éfile")));
        assert!(
            !ordinal_eq_ignore_case(&w("file"), &w("file2")),
            "equality only — never a prefix match"
        );
        assert!(!ordinal_eq_ignore_case(&w("file2"), &w("file")));
        assert!(ordinal_eq_ignore_case(&w(""), &w("")));
    }
}

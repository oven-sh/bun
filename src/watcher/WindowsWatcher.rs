//! Bun's filesystem watcher implementation for windows using kernel32
//!
//! Each watch root is a recursive `ReadDirectoryChangesW` on one directory,
//! so files resolved outside the initial root (workspace packages reached
//! through a `node_modules` symlink, `bun link`ed packages, `file:` deps)
//! need an additional root. All `DirWatcher`s share one IOCP; a completion's
//! `lpOverlapped` is the address of the `DirWatcher` that fired (it is the
//! first field), so `next()` identifies the source without touching the
//! `watchers` Vec and therefore without the mutex.

use core::mem::size_of;
use core::ptr;
use std::sync::Arc;

use crate::watcher_impl::{Op, WatchEvent, WatchItemColumns, WatchItemIndex, WatchList, Watcher};
use bun_core::strings;
use bun_paths::resolve_path::{ParentEqual, is_parent_or_equal};
use bun_paths::{PathBuffer, WPathBuffer};
use bun_ptr::{BackRef, RawSlice};
use bun_threading::Mutex;

use bun_collections::index_sort;
use bun_sys::windows as w;
use bun_sys::windows::HANDLE;

bun_core::declare_scope!(watcher, visible);

pub(crate) type Platform = WindowsWatcher;

pub struct WindowsWatcher {
    /// `INVALID_HANDLE_VALUE` once `stop()` has run; `add_root` returns early
    /// then (same shape as the inotify/kqueue `fd = INVALID` convention).
    pub(crate) iocp: HANDLE,
    /// One entry per watch root. `Box` keeps each `DirWatcher` at a stable
    /// address across Vec growth while its async `ReadDirectoryChangesW` is
    /// pending. Grown/reused under `Watcher.mutex`; the watch thread touches
    /// the boxes only through completion pointers, never through this Vec.
    pub(crate) watchers: Vec<Box<DirWatcher>>,
    /// Parallel to `watchers`. `covers()` on transpiler threads reads this
    /// (under `Watcher.mutex`) instead of the `DirWatcher` boxes, which the
    /// watch thread mutates without the lock.
    pub(crate) roots: Vec<Arc<RootState>>,
    /// Scratch for `root + event filename` during `watch_loop_cycle`. Owned
    /// by the watch thread.
    pub(crate) buf: PathBuffer,
    /// The `DirWatcher` whose buffer was just returned by `next()` and must be
    /// re-armed on the next `next()` call. Watch-thread-only. Also seeded by
    /// `new()` so the first root is armed by the watch thread, not before it.
    needs_rearm: Option<ptr::NonNull<DirWatcher>>,
}

/// Root metadata shared between a `DirWatcher` (watch thread) and
/// `WindowsWatcher.roots` (transpiler threads, under `Watcher.mutex`).
pub(crate) struct RootState {
    /// Absolute path of the watched root with a trailing separator.
    pub path: Box<[u8]>,
    /// Set by `mark_dead` once the root is retired and its handle closed.
    /// `add_root` reuses dead slots.
    pub dead: bun_core::AtomicCell<bool>,
}

impl Default for WindowsWatcher {
    fn default() -> Self {
        Self {
            iocp: w::INVALID_HANDLE_VALUE,
            watchers: Vec::new(),
            roots: Vec::new(),
            buf: PathBuffer::uninit(),
            needs_rearm: None,
        }
    }
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Action {
    Added = w::FILE_ACTION_ADDED,
    Removed = w::FILE_ACTION_REMOVED,
    Modified = w::FILE_ACTION_MODIFIED,
    RenamedOld = w::FILE_ACTION_RENAMED_OLD_NAME,
    RenamedNew = w::FILE_ACTION_RENAMED_NEW_NAME,
}

struct FileEvent {
    pub action: Action,
    // [`RawSlice`] (not a lifetime-carrying `&'a [u16]`) so `FileEvent` carries no lifetime param;
    // the buffer is live until the next `prepare()` — encapsulated by the
    // `RawSlice` outlives-holder invariant so callers read via safe `.slice()`.
    pub filename: RawSlice<u16>,
}

#[repr(C)]
pub struct DirWatcher {
    /// must be initialized to zero (even though it's never read or written in our code),
    /// otherwise ReadDirectoryChangesW will fail with INVALID_HANDLE
    pub(crate) overlapped: w::OVERLAPPED,
    /// `FILE_NOTIFY_INFORMATION` is DWORD-aligned (4); the preceding
    /// `OVERLAPPED` (32 bytes, align 8) guarantees `buf` lands at offset 32,
    /// which the `assert_ffi_layout!` below locks in (and `32 % 4 == 0` is the
    /// alignment proof for the `FILE_NOTIFY_INFORMATION` cast in
    /// `EventIterator::next`).
    pub(crate) buf: [u8; 64 * 1024],
    pub(crate) dir_handle: HANDLE,
    /// Shared with `WindowsWatcher.roots`: `state.path` prefixes each event's
    /// relative filename; `state.dead` retires the root.
    pub(crate) state: Arc<RootState>,
}

// `OVERLAPPED` = 32 bytes / align 8 on Win64; `buf` must be ≥ 4-aligned for
// the `*FILE_NOTIFY_INFORMATION` cast. Asserting the offset (not just the
// total size) is what proves that alignment requirement. `overlapped` at
// offset 0 is load-bearing: `next()` recovers `*mut DirWatcher` from the
// `lpOverlapped` out-param.
bun_core::assert_ffi_layout!(
    DirWatcher,
    32 + 64 * 1024 + ::core::mem::size_of::<HANDLE>() + ::core::mem::size_of::<Arc<RootState>>(),
    ::core::mem::align_of::<w::OVERLAPPED>();
    overlapped @ 0, buf @ 32, dir_handle @ 32 + 64 * 1024,
);
const _: () = assert!(
    ::core::mem::offset_of!(DirWatcher, buf)
        % ::core::mem::align_of::<w::FILE_NOTIFY_INFORMATION>()
        == 0,
    "DirWatcher.buf must be FILE_NOTIFY_INFORMATION-aligned",
);

impl DirWatcher {
    /// invalidates any EventIterators
    fn prepare(&mut self) -> bun_sys::Result<()> {
        let filter = w::FileNotifyChangeFilter::FILE_NAME
            | w::FileNotifyChangeFilter::DIR_NAME
            | w::FileNotifyChangeFilter::LAST_WRITE
            | w::FileNotifyChangeFilter::CREATION;
        // SAFETY: dir_handle is a valid directory handle opened with FILE_LIST_DIRECTORY;
        // buf and overlapped are valid for the duration of the async operation (self-owned).
        if unsafe {
            w::kernel32::ReadDirectoryChangesW(
                self.dir_handle,
                self.buf.as_mut_ptr().cast(),
                self.buf.len() as u32,
                1,
                filter,
                ptr::null_mut(),
                &mut self.overlapped,
                None,
            )
        } == 0
        {
            let err = w::Win32Error::get();
            bun_core::scoped_log!(watcher, "failed to start watching directory: {}", err.0);
            return Err(bun_sys::Error::from_win32(err, bun_sys::Tag::watch));
        }
        bun_core::scoped_log!(watcher, "read directory changes!");
        Ok(())
    }

    fn is_dead(&self) -> bool {
        self.state.dead.load()
    }

    /// Close the handle and retire this root; `covers()` skips it afterwards,
    /// `stop()` won't close it again, and `add_root` may reuse the slot.
    /// Watch-thread-only; called only at points where this root has no
    /// pending I/O (its completion was just dequeued, or its re-arm failed).
    fn mark_dead(&self, cause: &bun_sys::Error) {
        if self.is_dead() {
            return;
        }
        // Every field read happens before publishing `dead`: once the store
        // lands, a transpiler thread may reuse this slot and rewrite the box.
        let handle = self.dir_handle;
        bun_core::scoped_log!(
            watcher,
            "stopped watching {} ({})",
            bstr::BStr::new(&self.state.path),
            bstr::BStr::new(cause.name())
        );
        self.state.dead.store(true);
        // SAFETY: `handle` is the handle `add_root` opened; `stop()` skips
        // dead roots, so this is the only close.
        unsafe {
            let _ = w::CloseHandle(handle);
        }
    }
}

/// Iterates `FILE_NOTIFY_INFORMATION` records out of a `DirWatcher`'s buffer.
///
/// holds a [`BackRef<DirWatcher>`] instead of a lifetime-carrying
/// `&'a DirWatcher` so `WindowsWatcher::next` does not keep `&mut Watcher.platform`
/// borrowed across `watch_loop_cycle`'s inner loop (which mutates sibling
/// fields). The `BackRef` invariant — pointee outlives holder — is upheld
/// because the iterator is only advanced while the owning `DirWatcher` is
/// alive and `prepare()` has not been re-called; safe `Deref` replaces the
/// previously open-coded raw `(*self.watcher).buf` projection.
struct EventIterator {
    pub watcher: BackRef<DirWatcher>,
    pub offset: usize,
    pub has_next: bool,
}

impl EventIterator {
    fn next(&mut self) -> Option<FileEvent> {
        if !self.has_next {
            return None;
        }
        // The Rust binding includes `FileName: [WCHAR; 1]`, so `size_of` == 16
        // while the fixed record header is 12 bytes. Use the field offset, not the struct
        // size, to locate the variable-length filename.
        let name_offset = core::mem::offset_of!(w::FILE_NOTIFY_INFORMATION, FileName);
        // `self.watcher` is a `BackRef<DirWatcher>` — pointee live until the
        // next `prepare()` (see the struct-level note) — so reading `buf` is safe.
        let buf_ptr = self.watcher.buf.as_ptr();
        // SAFETY: `buf` was filled by ReadDirectoryChangesW with a sequence of
        // FILE_NOTIFY_INFORMATION records; `offset` is advanced only by
        // NextEntryOffset values returned by the kernel, so each cast targets a
        // properly-aligned record header.
        let info: &w::FILE_NOTIFY_INFORMATION = unsafe {
            &*(buf_ptr
                .add(self.offset)
                .cast::<w::FILE_NOTIFY_INFORMATION>())
        };
        // The variable-length filename begins at the `FileName` field of the
        // record; `FileNameLength` (kernel-set) bounds the trailing UTF-16
        // bytes which lie wholly inside `buf`. Safe bounds-checked sub-slice of
        // the owned `[u8; 64K]` buffer, then a `bytemuck`-checked u8→u16 view
        // (alignment holds: `buf` is DWORD-aligned per the static assert above,
        // `self.offset` advances by kernel `NextEntryOffset` which is DWORD-
        // aligned, and `name_offset` == 12). Wrap in `RawSlice` so callers
        // re-borrow without an open-coded raw deref.
        let name_start = self.offset + name_offset;
        let name_bytes = &self.watcher.buf[name_start..name_start + info.FileNameLength as usize];
        let filename: RawSlice<u16> = RawSlice::new(bun_core::cast_slice::<u8, u16>(name_bytes));

        // `transmute` into an exhaustive #[repr(u32)] enum is immediate UB on an unlisted
        // discriminant. Use a checked match — kernel docs guarantee 1..=5 today.
        let action: Action = match info.Action {
            w::FILE_ACTION_ADDED => Action::Added,
            w::FILE_ACTION_REMOVED => Action::Removed,
            w::FILE_ACTION_MODIFIED => Action::Modified,
            w::FILE_ACTION_RENAMED_OLD_NAME => Action::RenamedOld,
            w::FILE_ACTION_RENAMED_NEW_NAME => Action::RenamedNew,
            other => {
                debug_assert!(false, "unexpected FILE_NOTIFY_INFORMATION.Action = {other}");
                // Skip unknown action and advance to next record.
                if info.NextEntryOffset == 0 {
                    self.has_next = false;
                } else {
                    self.offset += info.NextEntryOffset as usize;
                }
                return self.next();
            }
        };

        if info.NextEntryOffset == 0 {
            self.has_next = false;
        } else {
            self.offset += info.NextEntryOffset as usize;
        }

        Some(FileEvent { action, filename })
    }
}

impl WindowsWatcher {
    pub(crate) fn new(root: &[u8]) -> crate::Result<Self> {
        let mut this = Self::default();
        this.iocp = w::CreateIoCompletionPort(w::INVALID_HANDLE_VALUE, ptr::null_mut(), 0, 1)
            .map_err(crate::Error::from)?;
        if let Err(e) = this.add_root_inner::<false>(root) {
            // SAFETY: iocp was just created above.
            unsafe {
                let _ = w::CloseHandle(this.iocp);
            }
            return Err(e);
        }
        Ok(this)
    }

    /// Open `root` for recursive change notification, associate it with the
    /// shared IOCP, arm it, and append to (or reuse a dead slot of)
    /// `self.watchers`. Caller holds `Watcher.mutex`; the watch thread is
    /// running, so arming here is safe (`shutdown` hands cleanup to it).
    pub(crate) fn add_root(&mut self, root: &[u8]) -> Result<(), crate::Error> {
        self.add_root_inner::<true>(root)
    }

    /// `ARM = false` defers the first `ReadDirectoryChangesW` to the watch
    /// thread (via `needs_rearm`): `new()` runs before `Watcher::start`, and a
    /// shutdown-before-start drops the `DirWatcher` without `stop()`, which
    /// must not leave kernel I/O pending against the freed buffer.
    fn add_root_inner<const ARM: bool>(&mut self, root: &[u8]) -> Result<(), crate::Error> {
        use bun_paths::string_paths as paths;
        if self.iocp == w::INVALID_HANDLE_VALUE {
            // stop() already ran; the watch thread is gone.
            return Err(crate::Error::Sys(bun_sys::SystemErrno::ESHUTDOWN));
        }
        let mut pathbuf = WPathBuffer::uninit();
        let wpath = paths::to_nt_path(&mut pathbuf, root);
        let path_len_bytes: u16 = (wpath.len() * 2) as u16;
        let mut nt_name = w::UNICODE_STRING {
            Length: path_len_bytes,
            MaximumLength: path_len_bytes,
            Buffer: wpath.as_ptr().cast_mut().cast::<u16>(),
        };
        let mut attr = w::OBJECT_ATTRIBUTES {
            Length: size_of::<w::OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: ptr::null_mut(),
            Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            ObjectName: &mut nt_name,
            SecurityDescriptor: ptr::null_mut(),
            SecurityQualityOfService: ptr::null_mut(),
        };
        let mut handle: HANDLE = w::INVALID_HANDLE_VALUE;
        let mut io: w::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
        // SAFETY: all pointer params point to valid stack locals for the duration of the call.
        let rc = unsafe {
            w::ntdll::NtCreateFile(
                &mut handle,
                // SYNCHRONIZE lets stop()'s GetOverlappedResult(bWait) wait on
                // this handle; NtCreateFile grants exactly what is asked.
                w::FILE_LIST_DIRECTORY | w::SYNCHRONIZE,
                &mut attr,
                &mut io,
                ptr::null_mut(),
                0,
                w::FILE_SHARE_READ | w::FILE_SHARE_WRITE | w::FILE_SHARE_DELETE,
                w::FILE_OPEN,
                w::FILE_DIRECTORY_FILE | w::FILE_OPEN_FOR_BACKUP_INTENT,
                ptr::null_mut(),
                0,
            )
        };

        if rc != w::NTSTATUS::SUCCESS {
            let err = w::Win32Error::from_nt_status(rc);
            bun_core::scoped_log!(watcher, "failed to open directory for watching: {}", err.0);
            return Err(crate::Error::Sys(
                bun_sys::SystemErrno::init(err.0 as u32).unwrap_or(bun_sys::SystemErrno::EINVAL),
            ));
        }
        let handle_guard = scopeguard::guard(handle, |h| unsafe {
            // SAFETY: handle was successfully opened by NtCreateFile above.
            let _ = w::CloseHandle(h);
        });

        // Reuse a dead slot if one exists so repeated kill/re-add cycles
        // (package rebuilds deleting their own root) don't grow the Vec.
        let slot = self.roots.iter().position(|r| r.dead.load());
        let key = slot.unwrap_or(self.watchers.len()) as w::ULONG_PTR;
        w::CreateIoCompletionPort(*handle_guard, self.iocp, key, 0).map_err(crate::Error::from)?;

        let needs_slash = root.is_empty() || !paths::char_is_any_slash(root[root.len() - 1]);
        let mut root_buf = Vec::with_capacity(root.len() + usize::from(needs_slash));
        root_buf.extend_from_slice(root);
        if needs_slash {
            root_buf.push(b'\\');
        }
        let state = Arc::new(RootState {
            path: root_buf.into_boxed_slice(),
            dead: bun_core::AtomicCell::new(false),
        });

        let dw_ptr = match slot {
            Some(idx) => {
                // The slot is dead: its handle is closed, it has no pending
                // I/O, and the watch thread holds no pointer to it, so the box
                // can be rewritten in place.
                let dw = &mut self.watchers[idx];
                dw.overlapped = bun_core::ffi::zeroed();
                dw.dir_handle = *handle_guard;
                dw.state = Arc::clone(&state);
                if ARM {
                    // On failure `handle_guard` closes the handle and
                    // `roots[idx]` keeps its dead entry, so the slot stays
                    // reusable.
                    dw.prepare().map_err(crate::Error::from)?;
                }
                let dw_ptr = ptr::NonNull::from(&mut **dw);
                self.roots[idx] = state;
                dw_ptr
            }
            None => {
                // Initialize on the heap: `Box::new(DirWatcher { .. })`
                // materialises the 64KB `buf` on the stack first in debug
                // builds.
                let mut dw = Box::<DirWatcher>::new_zeroed();
                // SAFETY: all-zero bytes are valid for `overlapped` (must be
                // zeroed for ReadDirectoryChangesW) and `buf`; the remaining
                // fields are written below, so `assume_init` sees a
                // fully-initialised value.
                let mut dw = unsafe {
                    let p = dw.as_mut_ptr();
                    (&raw mut (*p).dir_handle).write(*handle_guard);
                    (&raw mut (*p).state).write(Arc::clone(&state));
                    dw.assume_init()
                };
                if ARM {
                    dw.prepare().map_err(crate::Error::from)?;
                }
                let dw_ptr = ptr::NonNull::from(&mut *dw);
                self.watchers.push(dw);
                self.roots.push(state);
                dw_ptr
            }
        };
        if !ARM {
            self.needs_rearm = Some(dw_ptr);
        }

        bun_core::scoped_log!(watcher, "watching root[{}]: {}", key, bstr::BStr::new(root));

        scopeguard::ScopeGuard::into_inner(handle_guard);
        Ok(())
    }

    /// True if `dir` (absolute, with trailing separator) is already inside one
    /// of the live watched roots. Caller holds `Watcher.mutex`.
    pub(crate) fn covers(&self, dir: &[u8]) -> bool {
        self.roots.iter().any(|root| {
            !root.dead.load() && is_parent_or_equal(&root.path, dir) != ParentEqual::Unrelated
        })
    }

    /// wait until new events are available
    fn next(&mut self, timeout: Timeout) -> bun_sys::Result<Option<EventIterator>> {
        if let Some(dw) = self.needs_rearm.take() {
            // SAFETY: `dw` was the `lpOverlapped` of the previous completion
            // (or seeded by `new()`), pointing at offset 0 of a
            // `Box<DirWatcher>` in `self.watchers`. Live roots are never
            // rewritten, so it is valid.
            let dw = unsafe { dw.as_ptr().as_mut().unwrap_unchecked() };
            if !dw.is_dead() {
                if let Err(err) = dw.prepare() {
                    dw.mark_dead(&err);
                }
            }
        }

        let mut nbytes: w::DWORD = 0;
        let mut key: w::ULONG_PTR = 0;
        let mut overlapped: *mut w::OVERLAPPED = ptr::null_mut();
        loop {
            // With every root dead this parks until `add_root` arms a new
            // root on the same IOCP — same idle shape as inotify at
            // watch_count 0.
            // SAFETY: iocp is a valid IOCP handle; out-params are valid stack locals.
            let rc = unsafe {
                w::kernel32::GetQueuedCompletionStatus(
                    self.iocp,
                    &mut nbytes,
                    &mut key,
                    &mut overlapped,
                    timeout as w::DWORD,
                )
            };
            let Some(overlapped) = ptr::NonNull::new(overlapped) else {
                if rc == 0 {
                    let err = w::Win32Error::get();
                    // `WAIT_TIMEOUT` (258) — not yet a named const on `bun_sys::windows::Win32Error`.
                    if err == w::Win32Error::TIMEOUT || err == w::Win32Error(258) {
                        return Ok(None);
                    }
                    bun_core::scoped_log!(watcher, "GetQueuedCompletionStatus failed: {}", err.0);
                    return Err(bun_sys::Error::from_win32(err, bun_sys::Tag::watch));
                }
                bun_core::scoped_log!(
                    watcher,
                    "GetQueuedCompletionStatus returned no overlapped event"
                );
                return Err(bun_sys::Error {
                    errno: bun_sys::SystemErrno::EINVAL as _,
                    syscall: bun_sys::Tag::watch,
                    ..Default::default()
                });
            };
            // `overlapped` is the address we passed to `ReadDirectoryChangesW`:
            // offset 0 of a boxed `DirWatcher` in `self.watchers`.
            let dw: ptr::NonNull<DirWatcher> = overlapped.cast();

            if rc == 0 {
                // A dequeued failed-I/O packet: the root directory is gone
                // (handle closed, or the directory was deleted). Retire this
                // root; other roots keep running.
                let err = bun_sys::Error {
                    errno: bun_sys::SystemErrno::init(w::Win32Error::get().0 as u32)
                        .unwrap_or(bun_sys::SystemErrno::EINVAL) as _,
                    syscall: bun_sys::Tag::watch,
                    ..Default::default()
                };
                // SAFETY: see the cast note above — `dw` is a live boxed DirWatcher.
                unsafe { dw.as_ptr().as_ref().unwrap_unchecked() }.mark_dead(&err);
                continue;
            }

            if nbytes == 0 {
                // ReadDirectoryChangesW's internal buffer overflowed (MSDN:
                // zero bytes on success), not a shutdown — a closed handle
                // surfaces as rc == 0 above. Drop the lost events and re-arm
                // so --hot keeps watching.
                bun_core::scoped_log!(
                    watcher,
                    "ReadDirectoryChangesW buffer overflow (nbytes==0); re-arming"
                );
                // SAFETY: see the cast note above — `dw` is a live boxed DirWatcher.
                let dw = unsafe { dw.as_ptr().as_mut().unwrap_unchecked() };
                if let Err(err) = dw.prepare() {
                    dw.mark_dead(&err);
                }
                continue;
            }
            self.needs_rearm = Some(dw);
            return Ok(Some(EventIterator {
                // SAFETY: `dw` is a live boxed DirWatcher (see above); its
                // buffer stays valid until the matching `prepare()` on the
                // next `next()` call.
                watcher: unsafe { BackRef::from_raw(dw.as_ptr()) },
                offset: 0,
                has_next: true,
            }));
        }
    }

    pub(crate) fn stop(&mut self) {
        // Runs on the watch thread after the loop exits, under `Watcher.mutex`.
        // SAFETY: live handles were opened in add_root(); dead roots already
        // closed theirs in mark_dead() with no I/O pending.
        unsafe {
            for (dw, root) in self.watchers.iter_mut().zip(&self.roots) {
                if !root.dead.load() {
                    root.dead.store(true);
                    // Cancel the pending ReadDirectoryChangesW and wait for
                    // the cancellation to finish writing `overlapped`: the
                    // caller frees this DirWatcher right after stop() returns,
                    // and CloseHandle alone only initiates cancellation.
                    let _ = w::kernel32::CancelIoEx(dw.dir_handle, &mut dw.overlapped);
                    let mut nbytes: w::DWORD = 0;
                    let _ = w::kernel32::GetOverlappedResult(
                        dw.dir_handle,
                        &mut dw.overlapped,
                        &mut nbytes,
                        1,
                    );
                    let _ = w::CloseHandle(dw.dir_handle);
                }
            }
            let _ = w::CloseHandle(self.iocp);
        }
        self.iocp = w::INVALID_HANDLE_VALUE;
    }
}

/// The directory to open a watch root at for a file resolved to `dir`
/// (absolute, trailing separator): the subtree up to the first `node_modules`
/// component, else the nearest enclosing directory with a `package.json`, else
/// `dir` itself. Rooting at the package keeps a `dist/` rebuild from deleting
/// its own root, and keeps `bun build --watch` from opening one root per
/// `node_modules` package.
pub(crate) fn pick_watch_root(dir: &[u8]) -> &[u8] {
    use bun_paths::string_paths::char_is_any_slash;
    const NM: &[u8] = b"node_modules";

    // First `node_modules` component, if any.
    let mut search = 0;
    while let Some(rel) = strings::index_of(&dir[search..], NM) {
        let start = search + rel;
        let end = start + NM.len();
        let bounded = (start == 0 || char_is_any_slash(dir[start - 1]))
            && (end == dir.len() || char_is_any_slash(dir[end]));
        if bounded {
            let root_end = if end < dir.len() { end + 1 } else { end };
            return &dir[..root_end];
        }
        search = end;
    }

    // Nearest enclosing package.json.
    const PKG: &[u8] = b"package.json";
    let mut probe = bun_paths::path_buffer_pool::get();
    let mut end = dir.len(); // index one past a separator
    for _ in 0..64 {
        if end <= 3 || end + PKG.len() + 1 >= probe.len() {
            break;
        }
        probe[..end].copy_from_slice(&dir[..end]);
        probe[end..end + PKG.len()].copy_from_slice(PKG);
        probe[end + PKG.len()] = 0;
        // SAFETY: the NUL at [end + PKG.len()] was written above.
        let candidate = unsafe { bun_core::ZStr::from_raw(probe.as_ptr(), end + PKG.len()) };
        if bun_sys::exists_z(candidate) {
            return &dir[..end];
        }
        // Step to the parent: strip the trailing separator and the last
        // component.
        let mut i = end - 1; // at the separator
        while i > 0 && !char_is_any_slash(dir[i - 1]) {
            i -= 1;
        }
        if i == 0 || i >= end - 1 {
            break;
        }
        end = i;
    }

    dir
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum Timeout {
    Infinite = w::INFINITE,
    None = 0,
}

/// Snapshot the watchlist's path column under `mutex`: `add_file` on other
/// threads may realloc it mid-scan, and a mid-batch dispatch can evict and
/// reorder it (same pattern as `INotifyWatcher`'s `eventlist_index_scratch`).
/// Raw slices, not owned copies: the path bytes are freed only by
/// `flush_evictions` inside a dispatch on this thread, and the snapshot is
/// retaken after every dispatch; a watchlist realloc moves the `Cow` structs,
/// not the bytes they point to. Takes field borrows, not `&mut Watcher`, so
/// the caller's `EventIterator` pointer into `platform` keeps its provenance.
fn snapshot_watchlist_paths(
    mutex: &Mutex,
    scratch: &mut Vec<RawSlice<u8>>,
    watchlist: &WatchList,
) -> usize {
    let _guard = mutex.lock_guard();
    scratch.clear();
    scratch.extend(
        watchlist
            .items_file_path()
            .iter()
            .map(|p| RawSlice::new(p.as_ref())),
    );
    scratch.len()
}

pub(crate) fn watch_loop_cycle(this: &mut Watcher) -> bun_sys::Result<()> {
    let mut event_id: usize = 0;

    // first wait has infinite timeout - we're waiting for the next event and don't want to spin
    let mut timeout = Timeout::Infinite;
    loop {
        let mut iter = match this.platform.next(timeout)? {
            Some(it) => it,
            None => break,
        };
        // after the first wait, we want to coalesce further events but don't want to wait for them
        // NOTE: using a 1ms timeout would be ideal, but that actually makes the thread wait for at least 10ms more than it should
        // Instead we use a 0ms timeout, which may not do as much coalescing but is more responsive.
        timeout = Timeout::None;

        let base_idx = {
            let root = &iter.watcher.state.path;
            this.platform.buf[..root.len()].copy_from_slice(root);
            root.len()
        };

        let mut n_items =
            snapshot_watchlist_paths(&this.mutex, &mut this.platform_scratch, &this.watchlist);

        bun_core::scoped_log!(watcher, "number of watched items: {}", n_items);
        while let Some(event) = iter.next() {
            // `event.filename` is a `RawSlice<u16>` into the firing
            // `DirWatcher`'s buf, live for the duration of this iteration (no
            // `prepare()` until the next `next()` call).
            let filename: &[u16] = event.filename.slice();
            let convert_res =
                strings::copy_utf16_into_utf8(&mut this.platform.buf[base_idx..], filename);
            let eventpath_len = base_idx + convert_res.written as usize;

            bun_core::scoped_log!(
                watcher,
                "watcher update event: (filename: {}, action: {}",
                bstr::BStr::new(&this.platform.buf[..eventpath_len]),
                <&'static str>::from(event.action)
            );

            // TODO this probably needs a more sophisticated search algorithm in the future
            // Possible approaches:
            // - Keep a sorted list of the watched paths and perform a binary search. We could use a bool to keep
            //   track of whether the list is sorted and only sort it when we detect a change.
            // - Use a prefix tree. Potentially more efficient for large numbers of watched paths, but complicated
            //   to implement and maintain.
            // - others that i'm not thinking of

            let mut item_idx = 0;
            while item_idx < n_items {
                // reshaped for borrowck — `rel` is computed in a scoped
                // block so the borrows of `this.platform_scratch` /
                // `this.platform.buf` are released before we touch
                // `this.watch_events` or hand the whole `&mut Watcher` to
                // `process_watch_event_batch`.
                let rel = {
                    let eventpath = &this.platform.buf[..eventpath_len];
                    // `slice()` is valid per the snapshot invariant on
                    // `snapshot_watchlist_paths`.
                    let path: &[u8] = this.platform_scratch[item_idx].slice();
                    let rel = is_parent_or_equal(path, eventpath);
                    bun_core::scoped_log!(
                        watcher,
                        "checking path: {} = .{}",
                        bstr::BStr::new(path),
                        match rel {
                            ParentEqual::Parent => "parent",
                            ParentEqual::Equal => "equal",
                            ParentEqual::Unrelated => "unrelated",
                        }
                    );
                    rel
                };
                // skip unrelated items
                if rel == ParentEqual::Unrelated {
                    item_idx += 1;
                    continue;
                }
                // if the event is for a parent dir of the item, only emit it if it's a delete or rename

                // Check if we're about to exceed the watch_events array capacity
                if event_id >= this.watch_events.len() {
                    // Process current batch of events
                    process_watch_event_batch(this, event_id)?;
                    // passing `this: &mut Watcher` above materialises a fresh Unique
                    // borrow over the whole `Watcher`, which under Stacked Borrows pops the
                    // SharedReadOnly tag that `iter.watcher` (a `*const DirWatcher` derived from
                    // an earlier shared borrow) carries. The next `iter.next()` would
                    // then dereference a pointer with invalidated provenance — UB that MIRI flags.
                    // The callee never touches the `DirWatcher` buffer, so re-deriving the
                    // pointer here from the now-current `&mut Watcher` restores valid provenance.
                    if let Some(dw) = this.platform.needs_rearm {
                        // SAFETY: `dw` is the live boxed DirWatcher that produced `iter`.
                        iter.watcher = unsafe { BackRef::from_raw(dw.as_ptr()) };
                    }
                    // Reset event_id to start a new batch
                    event_id = 0;
                    // The dispatch may have evicted watchlist entries
                    // (`swap_remove` reorders the live list and frees their
                    // path bytes); refresh the snapshot so emitted indices
                    // stay in sync, and re-check this slot against it.
                    n_items = snapshot_watchlist_paths(
                        &this.mutex,
                        &mut this.platform_scratch,
                        &this.watchlist,
                    );
                    continue;
                }

                this.watch_events[event_id] =
                    create_watch_event(&event, item_idx as WatchItemIndex);
                event_id += 1;
                item_idx += 1;
            }
        }
    }

    // Process any remaining events in the final batch
    if event_id > 0 {
        process_watch_event_batch(this, event_id)?;
    }

    Ok(())
}

fn process_watch_event_batch(this: &mut Watcher, event_count: usize) -> bun_sys::Result<()> {
    if event_count == 0 {
        return Ok(());
    }

    // log("event_count: {d}\n", .{event_count});

    let all_events = &mut this.watch_events[0..event_count];
    index_sort::sort_slice_unstable_by(all_events, |a, b| WatchEvent::sort_by_index(*a, *b));

    let mut last_event_index: usize = 0;
    // The sentinel must be wider than
    // WatchItemIndex (u16) so it can never collide with a real index (incl. no_watch_item=65535).
    let mut last_event_id: u32 = u32::MAX;

    for i in 0..all_events.len() {
        if all_events[i].index as u32 == last_event_id {
            // reshaped for borrowck — copy then merge to avoid two &mut into all_events.
            let ev = all_events[i];
            all_events[last_event_index].merge(ev);
            continue;
        }
        last_event_index = i;
        last_event_id = all_events[i].index as u32;
    }
    if all_events.is_empty() {
        return Ok(());
    }

    bun_core::scoped_log!(
        watcher,
        "calling onFileUpdate (all_events.len = {})",
        last_event_index + 1
    );

    this.dispatch_file_updates(last_event_index + 1, last_event_index + 1);
    Ok(())
}

fn create_watch_event(event: &FileEvent, index: WatchItemIndex) -> WatchEvent {
    let mut op = Op::empty();
    if event.action == Action::Removed {
        op |= Op::DELETE;
    }
    if event.action == Action::RenamedOld {
        op |= Op::RENAME;
    }
    if event.action == Action::Modified {
        op |= Op::WRITE;
    }
    WatchEvent {
        op,
        index,
        ..Default::default()
    }
}

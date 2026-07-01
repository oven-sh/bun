#![cfg(windows)]

//! The process-wide fd table: small-integer fds over raw HANDLEs, with POSIX
//! close semantics and POSIX sequential-position semantics.
//!
//! Why a table at all: Windows recycles HANDLE values immediately, so a JS
//! double-close on a raw-HANDLE fd would silently close an unrelated
//! resource. A closed table slot rejects further use with the EBADF shape
//! instead, and the handle leaves the table exactly once. // quirk: FSIO-17
//!
//! Why logical position: positioned engine I/O is
//! a single syscall carrying `OVERLAPPED.Offset`, and on a synchronous
//! handle the kernel then moves the shared file pointer to
//! `offset + transferred` — so the kernel pointer cannot double as the POSIX
//! sequential offset. Table-minted `File` fds therefore carry their own
//! `pos`: sequential I/O takes `pos` under the table lock, issues positioned
//! engine I/O at that offset outside the lock, then re-locks and advances.
//! Positioned ops never touch `pos`. // quirk: FSIO-21
//!
//! Adopted handles (stdio, inherited descriptors) are the exception: their
//! file object — and thus its one file pointer — is shared with whoever
//! created it, so POSIX offset-sharing requires following the kernel
//! pointer. `FdFlags::ADOPTED` fds do sequential I/O as kernel-pointer
//! passthrough, and positioned I/O on them reports
//! `PositionedIo::restore_pointer` so the consumer performs libuv's
//! save/seek/restore dance instead of the single-syscall path.
//! // quirk: FSIO-21
//!
//! Locking: the table `Mutex` guards slot mutation only and is NEVER held
//! across engine I/O or `CloseHandle`. Consequences are documented per
//! method; the headline one is that concurrent sequential ops on one fd have
//! no kernel-style total order (last writer wins on `pos`) — the same caveat
//! Node documents for concurrent `fs` calls on one fd.
//!
//! Error policy: raw `Win32Error` out of every function — EBADF-shaped
//! failures are `ERROR_INVALID_HANDLE`, table-full is
//! `ERROR_TOO_MANY_OPEN_FILES`, illegal seeks are `ERROR_SEEK_ON_DEVICE`.
//! Translation to errno happens exactly once, in `bun_sys`. // quirk: SOCK-58

use core::ffi::c_void;
use core::ptr;
// std Mutex/OnceLock (not bun_threading): bun_threading pulls bun_alloc,
// which would break this crate's natively-linkable test binary (see
// Cargo.toml); fd-table critical sections are a few loads/stores.
#[allow(clippy::disallowed_types)]
use std::sync::{Mutex, MutexGuard, OnceLock};

use bun_windows_sys::kernel32::{GetFileSizeEx, GetFileType, GetStdHandle};
use bun_windows_sys::{
    CloseHandle, DWORD, FILE_BEGIN, FILE_CURRENT, FILE_END, FILE_TYPE_CHAR, FILE_TYPE_DISK,
    FILE_TYPE_PIPE, GetConsoleMode, HANDLE, INVALID_HANDLE_VALUE, LARGE_INTEGER, STD_ERROR_HANDLE,
    STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, SetFilePointerEx, Win32Error,
};

/// Slots 0/1/2 are reserved for stdio at construction and never recycled.
/// // quirk: FSIO-16
const STDIO_SLOTS: u32 = 3;

/// Default soft cap on live fds. The CRT table this replaces holds 2048 fds
/// (8192 after `_setmaxstdio`); the EMFILE contract survives but the ceiling
/// is high enough that only a runaway leak reaches it. Slots are allocated
/// on demand, so the cap costs nothing up front. // quirk: FSIO-15
pub const DEFAULT_CAPACITY: u32 = 1 << 20;

/// What the fd refers to, classified at mint. `File`/`Directory` are
/// seekable (positioned I/O allowed; minted ones carry logical `pos`);
/// `Pipe`/`Char`/`Tty` are sequential-only (positioned I/O is the ESPIPE
/// shape). `Pipe` deliberately covers sockets too — `GetFileType` cannot
/// tell them apart and downstream code distinguishes lazily, exactly as
/// libuv's `uv_guess_handle` does. // quirk: PIPE-57
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FdKind {
    File,
    Pipe,
    Char,
    Tty,
    Directory,
}

/// Per-fd behavior flags, fixed at mint (except `APPEND`, see
/// [`FdTable::set_append`]).
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct FdFlags(pub u8);

impl FdFlags {
    pub const NONE: Self = Self(0);
    /// O_APPEND semantics: sequential writes ignore `pos` for placement (the
    /// engine's APPEND-rights handle appends atomically at EOF) and leave
    /// `pos` at the new EOF, per POSIX. // quirk: FSIO-28
    pub const APPEND: Self = Self(1 << 0);
    /// The handle was adopted from outside (stdio, inheritance): its file
    /// object is shared, so sequential I/O follows the kernel file pointer
    /// instead of a logical `pos`, and positioned I/O must save/restore the
    /// pointer (see [`PositionedIo::restore_pointer`]). // quirk: FSIO-21
    pub const ADOPTED: Self = Self(1 << 1);

    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

impl core::ops::BitOr for FdFlags {
    type Output = Self;
    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

/// Direction of a sequential operation — only writes observe `APPEND`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum IoDir {
    Read,
    Write,
}

/// Ticket for one positioned (pread/pwrite-style) operation.
pub struct PositionedIo {
    /// Valid only while the fd stays open — a concurrent `close` is the same
    /// caller race POSIX has.
    pub handle: HANDLE,
    /// `true` for adopted fds: the kernel file pointer is their live
    /// sequential state, so the consumer must bracket the positioned op with
    /// libuv's SetFilePointerEx save → I/O → restore dance (accepting its
    /// documented concurrency race). Minted fds own sequential state
    /// logically, so the single-syscall positioned path is safe and this is
    /// `false`. // quirk: FSIO-21
    pub restore_pointer: bool,
}

/// `uv_guess_handle`'s classification matrix over a raw handle:
/// `FILE_TYPE_CHAR` is a TTY only if `GetConsoleMode` succeeds (NUL and
/// serial ports land in `Char`); `FILE_TYPE_PIPE` covers both pipes and
/// sockets; `FILE_TYPE_DISK` is `File`. Null/`INVALID_HANDLE_VALUE` is
/// rejected up front (the fd<0 → UNKNOWN crash fix). An unknown type
/// reports the pending OS error if there is one, else
/// `ERROR_NOT_SUPPORTED` — the "unknown stream type" shape. `Directory` is
/// never produced here: `GetFileType` cannot see it; callers that opened a
/// directory say so at mint. // quirk: PIPE-57
///
/// # Safety
/// `handle` must be null, `INVALID_HANDLE_VALUE`, or a live handle owned by
/// the caller for the duration of the call.
pub unsafe fn classify_handle(handle: HANDLE) -> Result<FdKind, Win32Error> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::INVALID_HANDLE); // quirk: PIPE-57
    }
    match GetFileType(handle) {
        FILE_TYPE_CHAR => {
            let mut mode: DWORD = 0;
            // SAFETY: live handle per caller contract; `mode` is an owned
            // out-param.
            let is_console = unsafe { GetConsoleMode(handle, &raw mut mode) } != 0;
            Ok(if is_console {
                FdKind::Tty
            } else {
                FdKind::Char
            })
        }
        FILE_TYPE_PIPE => Ok(FdKind::Pipe),
        FILE_TYPE_DISK => Ok(FdKind::File),
        // FILE_TYPE_UNKNOWN (or the unused REMOTE bit): a failed call leaves
        // the real error pending; a genuinely unknown device type leaves
        // SUCCESS and becomes the NOT_SUPPORTED shape — the same
        // error-else-unknown split libuv applies to CRT-layer failures.
        // // quirk: FSIO-15, PIPE-57
        _ => {
            let err = Win32Error::get();
            Err(if err == Win32Error::SUCCESS {
                Win32Error::NOT_SUPPORTED
            } else {
                err
            })
        }
    }
}

/// One table slot. The handle is stored as an exposed-provenance address
/// (HANDLEs are kernel table indexes, not dereferenceable pointers), which
/// also keeps the table `Send`/`Sync` without unsafe impls; `0` means "no
/// usable handle" (free slot, or a dead stdio slot in a detached process).
struct Slot {
    handle: usize,
    /// Bumped on every close. `sequential_io` snapshots it before releasing
    /// the lock for I/O and re-checks before advancing `pos`, so an fd
    /// closed-and-reminted mid-operation can never have its position
    /// corrupted by the stale operation — the table-internal anti-recycling
    /// tag (fd numbers themselves recycle freely, like POSIX).
    generation: u32,
    kind: FdKind,
    flags: FdFlags,
    pos: u64,
    /// `false` only for slots parked on the free list. Dead stdio slots stay
    /// occupied (never mintable) but hold `handle == 0`.
    occupied: bool,
}

impl Slot {
    /// Reserved-but-unusable stdio slot (detached process, or an
    /// unclassifiable std handle — libuv's UNKNOWN, node's "unknown stream
    /// type"): every use reports the EBADF shape, but the slot exists so fd
    /// numbering and `close(0..2)` behave normally.
    const DEAD_STDIO: Slot = Slot {
        handle: 0,
        generation: 0,
        kind: FdKind::Char, // unobservable: handle == 0 fails every lookup
        flags: FdFlags::NONE,
        pos: 0,
        occupied: true,
    };
}

struct Inner {
    slots: Vec<Slot>,
    /// Freed indices, reused LIFO. POSIX promises lowest-free; node pins
    /// only density (small fds, prompt reuse), which LIFO gives without a
    /// scan — the documented deviation.
    free: Vec<u32>,
}

/// The fd table. One process-wide instance lives behind [`the`]; tests
/// construct private ones.
pub struct FdTable {
    // std Mutex by design — see the use-site comment at the top of the file.
    #[allow(clippy::disallowed_types)]
    inner: Mutex<Inner>,
    capacity: u32,
}

/// The process-wide table, created on first use. Slots 0/1/2 are reserved
/// from `GetStdHandle` at that moment; in detached processes (null/invalid
/// std handles) the slots exist but every use reports the EBADF shape.
/// // quirk: FSIO-16
static TABLE: OnceLock<FdTable> = OnceLock::new();

/// True once the process-global table has been constructed (it snapshots
/// the std handles at that moment — startup asserts the stdio repair ran
/// first).
pub fn is_initialized() -> bool {
    TABLE.get().is_some()
}

pub fn the() -> &'static FdTable {
    TABLE.get_or_init(|| FdTable::with_capacity_limit(DEFAULT_CAPACITY))
}

impl FdTable {
    /// A table capped at `capacity` live fds (clamped up to the 3 reserved
    /// stdio slots), with slots 0/1/2 taken from `GetStdHandle` now.
    pub fn with_capacity_limit(capacity: u32) -> FdTable {
        let std_handles = [
            GetStdHandle(STD_INPUT_HANDLE),
            GetStdHandle(STD_OUTPUT_HANDLE),
            GetStdHandle(STD_ERROR_HANDLE),
        ];
        // SAFETY: GetStdHandle returns the process's live std handle or a
        // null/INVALID sentinel; both are valid classify_handle inputs, and
        // the process std handles outlive the table.
        let table = unsafe { Self::with_capacity_and_std(capacity, std_handles) };
        table.import_startup_blob();
        table
    }

    /// Import fds 3.. from the parent's inherited CRT lpReserved2 blob (the
    /// protocol NODE_CHANNEL_FD and extra stdio slots ride on).
    fn import_startup_blob(&self) {
        // SAFETY: GetStartupInfoW cannot fail; the blob (when present) lives
        // for the process lifetime in the startup-info allocation.
        #[allow(clippy::disallowed_methods)] // tier-0: no bun_core Zeroable here
        // SAFETY: STARTUPINFOW is plain Win32 data; all-zero is valid (cb set below).
        let mut si: bun_windows_sys::STARTUPINFOW = unsafe { core::mem::zeroed() };
        si.cb = core::mem::size_of::<bun_windows_sys::STARTUPINFOW>() as DWORD;
        // SAFETY: out-param is a local sized struct.
        unsafe { bun_windows_sys::GetStartupInfoW(&raw mut si) };
        if si.lpReserved2.is_null() || si.cbReserved2 <= 4 {
            return;
        }
        // SAFETY: pointer/length come from OUR startup info; the parser
        // treats every byte as hostile.
        let blob =
            unsafe { core::slice::from_raw_parts(si.lpReserved2, si.cbReserved2 as usize) };
        self.import_inherited_blob(blob);
    }

    /// Walk the CRT blob (`[u32 count][count flag bytes][count HANDLEs]`)
    /// and mint every valid inherited fd 3.. at its own index. Hostile
    /// input: count clamps to what the byte length actually holds and a
    /// sane ceiling; sentinels are skipped; classification is a live probe,
    /// never the inherited flag byte.
    fn import_inherited_blob(&self, blob: &[u8]) {
        const MAX_INHERITED: usize = 4096;
        const PTR: usize = core::mem::size_of::<usize>();
        let count = u32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
        let fits = (blob.len() - 4) / (1 + PTR);
        let count = count.min(fits).min(MAX_INHERITED);
        let handles_off = 4 + count;
        for idx in STDIO_SLOTS as usize..count {
            const FOPEN: u8 = 0x01;
            if blob[4 + idx] & FOPEN == 0 {
                continue;
            }
            let off = handles_off + idx * PTR;
            let mut raw = [0u8; PTR];
            raw.copy_from_slice(&blob[off..off + PTR]);
            let addr = usize::from_le_bytes(raw);
            let handle: HANDLE = core::ptr::with_exposed_provenance_mut(addr);
            if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                continue;
            }
            // SAFETY: inherited by the parent into this process; if stale or
            // garbage, classify_handle fails and the slot stays empty.
            let Ok(kind) = (unsafe { classify_handle(handle) }) else {
                continue;
            };
            self.mint_at(idx as u32, handle, kind, FdFlags::ADOPTED);
        }
    }

    /// Place an inherited handle at a FIXED index (the CRT fd number the
    /// parent assigned), growing the table with empty slots as needed. Used
    /// only at construction — no concurrent open races the gaps.
    fn mint_at(&self, idx: u32, handle: HANDLE, kind: FdKind, flags: FdFlags) {
        let mut inner = self.lock();
        while inner.slots.len() <= idx as usize {
            let gap = inner.slots.len() as u32;
            inner.slots.push(Slot {
                handle: 0,
                generation: 0,
                kind: FdKind::File,
                flags: FdFlags::NONE,
                pos: 0,
                occupied: false,
            });
            if gap >= STDIO_SLOTS && gap != idx {
                inner.free.push(gap);
            }
        }
        if inner.slots[idx as usize].occupied {
            return; // duplicate index in a hostile blob — first wins
        }
        inner.free.retain(|&f| f != idx);
        let slot = &mut inner.slots[idx as usize];
        slot.handle = handle.expose_provenance();
        slot.kind = kind;
        slot.flags = flags;
        slot.pos = 0;
        slot.occupied = true;
    }

    /// # Safety
    /// Each element of `std_handles` must be null, `INVALID_HANDLE_VALUE`,
    /// or a live handle that stays open for the table's lifetime (the table
    /// adopts but never closes them — `close(0..2)` is a no-op).
    unsafe fn with_capacity_and_std(capacity: u32, std_handles: [HANDLE; 3]) -> FdTable {
        let capacity = capacity.max(STDIO_SLOTS);
        let mut slots = Vec::with_capacity(STDIO_SLOTS as usize);
        for handle in std_handles {
            // SAFETY: forwarded caller contract.
            let slot = match unsafe { classify_handle(handle) } {
                Ok(kind) => Slot {
                    handle: handle.expose_provenance(),
                    generation: 0,
                    kind,
                    // Adopted: the std file object (and its file pointer) is
                    // shared with the parent/CRT side. // quirk: FSIO-21
                    flags: FdFlags::ADOPTED,
                    pos: 0,
                    occupied: true,
                },
                Err(_) => Slot::DEAD_STDIO,
            };
            slots.push(slot);
        }
        // std Mutex: see the use-site note (tier-0 test binary).
        #[allow(clippy::disallowed_types)]
        FdTable {
            inner: Mutex::new(Inner {
                slots,
                free: Vec::new(),
            }),
            capacity,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        // Closures and I/O run outside the lock, so the only way to poison
        // it is an internal invariant panic — propagating that is correct.
        self.inner.lock().unwrap()
    }

    /// Mint a new fd over `handle`, transferring ownership to the table.
    /// On `Ok` the table owns the handle until [`FdTable::close`] hands it
    /// back. On `Err` the handle has already been closed (nothing for the
    /// caller to clean up — fd minting can never leak the handle); the
    /// exception is the null/`INVALID_HANDLE_VALUE` sentinels, which are
    /// rejected without touching the kernel (`CloseHandle` on them aborts
    /// under Wine and handle-checking debug layers). A full table is the raw
    /// EMFILE shape, `ERROR_TOO_MANY_OPEN_FILES` — distinguished from OS
    /// errors exactly as libuv distinguishes CRT-table-full from Win32
    /// failures. // quirk: FSIO-15
    ///
    /// `kind` comes from the caller: open-path callers know what they opened
    /// (`Directory` exists only via this assertion); adoption callers use
    /// [`classify_handle`].
    ///
    /// # Safety
    /// `handle` must be owned by the caller, live, and not used or closed by
    /// the caller after this call (on `Ok` the table owns it; on `Err` it is
    /// already closed). Each handle may be minted at most once.
    pub unsafe fn mint(
        &self,
        handle: HANDLE,
        kind: FdKind,
        flags: FdFlags,
    ) -> Result<u32, Win32Error> {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(Win32Error::INVALID_HANDLE);
        }
        let addr = handle.expose_provenance();
        {
            let mut inner = self.lock();
            if let Some(idx) = inner.free.pop() {
                let slot = &mut inner.slots[idx as usize];
                debug_assert!(!slot.occupied && slot.handle == 0);
                // The bumped generation from the close that freed this slot
                // is kept — any in-flight sequential_io snapshot is stale.
                slot.handle = addr;
                slot.kind = kind;
                slot.flags = flags;
                slot.pos = 0;
                slot.occupied = true;
                return Ok(idx);
            }
            if inner.slots.len() < self.capacity as usize {
                let idx = inner.slots.len() as u32;
                inner.slots.push(Slot {
                    handle: addr,
                    generation: 0,
                    kind,
                    flags,
                    pos: 0,
                    occupied: true,
                });
                return Ok(idx);
            }
        }
        // Table full. Close outside the lock; report the EMFILE shape.
        // // quirk: FSIO-15
        // SAFETY: ownership transferred to mint (caller contract), sentinel
        // values rejected above, closed exactly once on this path.
        unsafe { CloseHandle(handle) };
        Err(Win32Error::TOO_MANY_OPEN_FILES)
    }

    /// The handle behind `fd`, for operations with no position semantics
    /// (fstat, ftruncate, fsync, console queries…). Any invalid fd — out of
    /// range, closed, or a dead stdio slot — is the EBADF shape, before any
    /// syscall; the table never traps on a bad fd. // quirk: FSIO-19,
    /// FSMETA-29
    ///
    /// The handle stays valid only while the fd is open; racing a concurrent
    /// `close` is the same caller bug it is under POSIX.
    pub fn get(&self, fd: u32) -> Result<HANDLE, Win32Error> {
        let inner = self.lock();
        let slot = slot_of(&inner, fd)?;
        Ok(ptr::with_exposed_provenance_mut::<c_void>(slot.handle))
    }

    pub fn kind(&self, fd: u32) -> Result<FdKind, Win32Error> {
        let inner = self.lock();
        Ok(slot_of(&inner, fd)?.kind)
    }

    pub fn flags(&self, fd: u32) -> Result<FdFlags, Win32Error> {
        let inner = self.lock();
        Ok(slot_of(&inner, fd)?.flags)
    }

    /// Toggle `APPEND` on a live fd (POSIX `fcntl(F_SETFL, O_APPEND)`
    /// surface). Placement authority stays with the engine handle's access
    /// rights; this flag only steers the table's position bookkeeping.
    pub fn set_append(&self, fd: u32, append: bool) -> Result<(), Win32Error> {
        let mut inner = self.lock();
        let slot = slot_of_mut(&mut inner, fd)?;
        if append {
            slot.flags.0 |= FdFlags::APPEND.0;
        } else {
            slot.flags.0 &= !FdFlags::APPEND.0;
        }
        Ok(())
    }

    /// `lseek(2)` over the table. Minted `File`/`Directory` fds reposition
    /// the LOGICAL `pos` (their kernel pointer is not the sequential state —
    /// `sequential_io` issues positioned ops at `pos`); `ADOPTED` fds seek
    /// the kernel pointer (it IS their live state, shared with the parent);
    /// `Pipe`/`Char`/`Tty` are the ESPIPE shape. `whence` is `FILE_BEGIN`/
    /// `FILE_CURRENT`/`FILE_END` (== POSIX SEEK_SET/CUR/END). Returns the
    /// new position; a negative result position is `INVALID_PARAMETER`
    /// (POSIX EINVAL).
    pub fn seek(&self, fd: u32, offset: i64, whence: DWORD) -> Result<u64, Win32Error> {
        let (addr, generation, kind, flags, pos) = {
            let inner = self.lock();
            let slot = slot_of(&inner, fd)?;
            (
                slot.handle,
                slot.generation,
                slot.kind,
                slot.flags,
                slot.pos,
            )
        };
        let handle = ptr::with_exposed_provenance_mut::<c_void>(addr);

        if matches!(kind, FdKind::Pipe | FdKind::Char | FdKind::Tty) {
            return Err(Win32Error::SEEK_ON_DEVICE); // quirk: FSIO-21
        }

        if flags.contains(FdFlags::ADOPTED) {
            let mut new: LARGE_INTEGER = 0;
            // SAFETY: handle is passed by value; `new` is an owned out-param.
            let ok = unsafe { SetFilePointerEx(handle, offset, &raw mut new, whence) };
            if ok == 0 {
                return Err(Win32Error::get());
            }
            return u64::try_from(new).map_err(|_| Win32Error::INVALID_PARAMETER);
        }

        let base: i64 = match whence {
            FILE_BEGIN => 0,
            FILE_CURRENT => i64::try_from(pos).map_err(|_| Win32Error::INVALID_PARAMETER)?,
            FILE_END => {
                let mut size: LARGE_INTEGER = 0;
                // SAFETY: handle is passed by value; `size` is an owned out-param.
                if unsafe { GetFileSizeEx(handle, &raw mut size) } == 0 {
                    return Err(Win32Error::get());
                }
                size
            }
            _ => return Err(Win32Error::INVALID_PARAMETER),
        };
        let new = base
            .checked_add(offset)
            .filter(|n| *n >= 0)
            .ok_or(Win32Error::INVALID_PARAMETER)?;
        let new = new as u64;

        let mut inner = self.lock();
        if let Some(slot) = inner.slots.get_mut(fd as usize)
            && slot.occupied
            && slot.generation == generation
        {
            slot.pos = new;
        }
        Ok(new)
    }

    /// Gate for positioned (pread/pwrite-style) I/O. Seekable kinds
    /// (`File`, `Directory`) get a ticket — positioned ops never touch the
    /// fd's logical `pos`. Sequential-only kinds (`Pipe`, `Char`, `Tty`)
    /// are the raw ESPIPE shape, `ERROR_SEEK_ON_DEVICE` ("the file pointer
    /// cannot be set on the specified device or file") — POSIX pread on a
    /// pipe/socket/tty is ESPIPE; the consumer maps the code at its
    /// boundary. // quirk: FSIO-21
    pub fn positioned_io(&self, fd: u32) -> Result<PositionedIo, Win32Error> {
        let inner = self.lock();
        let slot = slot_of(&inner, fd)?;
        match slot.kind {
            FdKind::File | FdKind::Directory => Ok(PositionedIo {
                handle: ptr::with_exposed_provenance_mut::<c_void>(slot.handle),
                restore_pointer: slot.flags.contains(FdFlags::ADOPTED),
            }),
            FdKind::Pipe | FdKind::Char | FdKind::Tty => Err(Win32Error::SEEK_ON_DEVICE),
        }
    }

    /// One sequential (read(2)/write(2)-style) operation, with the
    /// take/advance discipline owned by the table so callers cannot misuse
    /// it. `op` receives the handle and the offset to issue:
    ///
    /// - minted `File`/`Directory` fds: `Some(pos)` — positioned engine I/O
    ///   at the logical position; afterwards `pos = taken + transferred`.
    /// - the same with `APPEND`, writing: `None` — the engine handle's
    ///   APPEND rights own placement (atomic append at EOF); afterwards
    ///   `pos` is the kernel end-of-write position, i.e. the new EOF, per
    ///   POSIX (empirically the file pointer after a sequential append
    ///   write; falls back to `taken + transferred` if the query fails).
    ///   // quirk: FSIO-28
    /// - `Pipe`/`Char`/`Tty` and all `ADOPTED` fds: `None` — pure
    ///   passthrough on the kernel's own sequencing; no `pos` bookkeeping.
    ///
    /// The lock is dropped while `op` runs. `pos` advances only if the fd
    /// was not closed (or closed-and-reminted) meanwhile — the generation
    /// check — and only on `Ok` (a failed op does not move the offset).
    /// Concurrent sequential ops on one fd interleave without a kernel-style
    /// total order (last writer wins on `pos`): the documented Node caveat.
    pub fn sequential_io<F>(&self, fd: u32, dir: IoDir, op: F) -> Result<usize, Win32Error>
    where
        F: FnOnce(HANDLE, Option<u64>) -> Result<usize, Win32Error>,
    {
        let (addr, generation, kind, flags, taken) = {
            let inner = self.lock();
            let slot = slot_of(&inner, fd)?;
            (
                slot.handle,
                slot.generation,
                slot.kind,
                slot.flags,
                slot.pos,
            )
        };
        let handle = ptr::with_exposed_provenance_mut::<c_void>(addr);

        let logical =
            matches!(kind, FdKind::File | FdKind::Directory) && !flags.contains(FdFlags::ADOPTED);
        if !logical {
            return op(handle, None);
        }

        let append_write = dir == IoDir::Write && flags.contains(FdFlags::APPEND);
        let offset = if append_write { None } else { Some(taken) };
        let transferred = op(handle, offset)?;

        let new_pos = if append_write {
            // POSIX: an O_APPEND write leaves the offset at the new EOF.
            // // quirk: FSIO-28
            query_file_pointer(handle).unwrap_or_else(|| taken.wrapping_add(transferred as u64))
        } else {
            taken.wrapping_add(transferred as u64)
        };

        let mut inner = self.lock();
        if let Some(slot) = inner.slots.get_mut(fd as usize)
            && slot.occupied
            && slot.generation == generation
        {
            slot.pos = new_pos;
        }
        Ok(transferred)
    }

    /// Close `fd`. Returns the handle exactly once — the caller performs the
    /// actual `CloseHandle` outside any table lock — except for fds 0–2,
    /// which report success without surrendering anything: closing a stdio
    /// fd's underlying handle would kill console/stdio for the whole
    /// process, and the next open would recycle the handle value, sending
    /// "stdout" writes into a random file. The guard is on the fd NUMBER,
    /// not the handle, and applies even to dead stdio slots — libuv's
    /// `if (fd > 2)` verbatim. // quirk: FSIO-16
    ///
    /// Closing an already-closed (or never-opened) fd is the EBADF shape —
    /// never a trap, and never a second handle. // quirk: FSIO-17
    pub fn close(&self, fd: u32) -> Result<Option<HANDLE>, Win32Error> {
        if fd < STDIO_SLOTS {
            return Ok(None); // quirk: FSIO-16
        }
        let mut inner = self.lock();
        let Some(slot) = inner.slots.get_mut(fd as usize) else {
            return Err(Win32Error::INVALID_HANDLE); // quirk: FSIO-17, FSIO-19
        };
        if !slot.occupied {
            return Err(Win32Error::INVALID_HANDLE); // quirk: FSIO-17
        }
        debug_assert!(slot.handle != 0, "non-stdio slots always hold a handle");
        let addr = core::mem::replace(&mut slot.handle, 0);
        slot.occupied = false;
        slot.generation = slot.generation.wrapping_add(1);
        slot.pos = 0;
        inner.free.push(fd);
        drop(inner);
        Ok(Some(ptr::with_exposed_provenance_mut::<c_void>(addr)))
    }
}

/// EBADF-shaped lookup: out-of-range, freed, and dead-stdio slots all
/// reject before any syscall. // quirk: FSIO-19, FSMETA-29
fn slot_of(inner: &Inner, fd: u32) -> Result<&Slot, Win32Error> {
    match inner.slots.get(fd as usize) {
        Some(slot) if slot.occupied && slot.handle != 0 => Ok(slot),
        _ => Err(Win32Error::INVALID_HANDLE),
    }
}

fn slot_of_mut(inner: &mut Inner, fd: u32) -> Result<&mut Slot, Win32Error> {
    match inner.slots.get_mut(fd as usize) {
        Some(slot) if slot.occupied && slot.handle != 0 => Ok(slot),
        _ => Err(Win32Error::INVALID_HANDLE),
    }
}

/// Current kernel file pointer, or `None` if the query fails (non-seekable
/// or raced-closed handle).
fn query_file_pointer(handle: HANDLE) -> Option<u64> {
    let mut pos: LARGE_INTEGER = 0;
    // SAFETY: `handle` is passed by value to the kernel (validated there);
    // `pos` is an owned out-param.
    let ok = unsafe { SetFilePointerEx(handle, 0, &raw mut pos, FILE_CURRENT) };
    if ok != 0 {
        u64::try_from(pos).ok()
    } else {
        None
    }
}

// ───────────────────────────── tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
    use std::sync::mpsc;

    use bun_windows_sys::kernel32::{ReadFile, WriteFile};
    use bun_windows_sys::{
        CREATE_ALWAYS, CreateFileW, CreatePipe, DeleteFileW, FILE_APPEND_DATA,
        FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TYPE_UNKNOWN, FILE_WRITE_DATA, OPEN_EXISTING,
        OVERLAPPED,
    };

    use super::*;

    const SHARE_ALL: DWORD = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;

    fn wide(p: &Path) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        p.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn temp_path(tag: &str) -> PathBuf {
        static SEQ: AtomicU32 = AtomicU32::new(0);
        std::env::temp_dir().join(format!(
            "bun_fdtable_{tag}_{}_{}.bin",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ))
    }

    /// Deletes the file on drop (share-delete opens make that legal even
    /// while handles remain).
    struct TempFile(PathBuf);
    impl Drop for TempFile {
        fn drop(&mut self) {
            let w = wide(&self.0);
            // SAFETY: NUL-terminated path; best-effort cleanup.
            unsafe { DeleteFileW(w.as_ptr()) };
        }
    }

    fn open_raw(path: &Path, access: DWORD, share: DWORD, disposition: DWORD) -> HANDLE {
        let w = wide(path);
        // SAFETY: NUL-terminated path; null security attributes/template.
        let h = unsafe {
            CreateFileW(
                w.as_ptr(),
                access,
                share,
                ptr::null_mut(),
                disposition,
                FILE_ATTRIBUTE_NORMAL,
                ptr::null_mut(),
            )
        };
        assert!(
            h != INVALID_HANDLE_VALUE,
            "CreateFileW({path:?}): {:?}",
            Win32Error::get()
        );
        h
    }

    fn open_rw(path: &Path) -> HANDLE {
        open_raw(
            path,
            FILE_GENERIC_READ | FILE_GENERIC_WRITE,
            SHARE_ALL,
            OPEN_EXISTING,
        )
    }

    /// Append-only access — FILE_APPEND_DATA without FILE_WRITE_DATA, the
    /// engine's O_APPEND shape. // quirk: FSIO-28
    fn open_append(path: &Path) -> HANDLE {
        open_raw(
            path,
            (FILE_GENERIC_WRITE & !FILE_WRITE_DATA) | FILE_APPEND_DATA,
            SHARE_ALL,
            OPEN_EXISTING,
        )
    }

    /// Creates the file with `contents` through raw syscalls and returns its
    /// delete-on-drop guard.
    fn create_file(tag: &str, contents: &[u8]) -> TempFile {
        let path = temp_path(tag);
        let h = open_raw(
            &path,
            FILE_GENERIC_READ | FILE_GENERIC_WRITE,
            SHARE_ALL,
            CREATE_ALWAYS,
        );
        if !contents.is_empty() {
            assert_eq!(raw_write(h, contents, None), Ok(contents.len()));
        }
        close_raw(h);
        TempFile(path)
    }

    /// Minimal positioned/sequential engine I/O, mirroring the
    /// `bun_winfs::read_at`/`write_at` offset contract the real consumer
    /// composes with `sequential_io`.
    fn overlapped_for(offset: Option<u64>, ov: &mut OVERLAPPED) -> *mut c_void {
        match offset {
            Some(base) => {
                ov.Offset = base as DWORD;
                ov.OffsetHigh = (base >> 32) as DWORD;
                ptr::from_mut(ov).cast()
            }
            None => ptr::null_mut(),
        }
    }

    fn raw_read(h: HANDLE, buf: &mut [u8], offset: Option<u64>) -> Result<usize, Win32Error> {
        let mut ov = OVERLAPPED {
            Internal: 0,
            InternalHigh: 0,
            Offset: 0,
            OffsetHigh: 0,
            hEvent: ptr::null_mut(),
        };
        let ov_ptr = overlapped_for(offset, &mut ov);
        let mut n: DWORD = 0;
        // SAFETY: live test handle; `buf` is a live mutable slice; `n` is an
        // owned out-param; `ov`, when non-null, outlives this synchronous
        // call.
        let ok = unsafe { ReadFile(h, buf.as_mut_ptr(), buf.len() as DWORD, &raw mut n, ov_ptr) };
        if ok == 0 {
            Err(Win32Error::get())
        } else {
            Ok(n as usize)
        }
    }

    fn raw_write(h: HANDLE, data: &[u8], offset: Option<u64>) -> Result<usize, Win32Error> {
        let mut ov = OVERLAPPED {
            Internal: 0,
            InternalHigh: 0,
            Offset: 0,
            OffsetHigh: 0,
            hEvent: ptr::null_mut(),
        };
        let ov_ptr = overlapped_for(offset, &mut ov);
        let mut n: DWORD = 0;
        // SAFETY: live test handle; `data` is a live slice; `n` is an owned
        // out-param; `ov`, when non-null, outlives this synchronous call.
        let ok = unsafe { WriteFile(h, data.as_ptr(), data.len() as DWORD, &raw mut n, ov_ptr) };
        if ok == 0 {
            Err(Win32Error::get())
        } else {
            Ok(n as usize)
        }
    }

    fn close_raw(h: HANDLE) {
        // SAFETY: test-owned live handle, closed exactly once at this site.
        assert!(unsafe { CloseHandle(h) } != 0);
    }

    fn pipe_pair() -> (HANDLE, HANDLE) {
        let mut r: HANDLE = ptr::null_mut();
        let mut w: HANDLE = ptr::null_mut();
        // SAFETY: owned out-params; null security attributes; default size.
        let ok = unsafe { CreatePipe(&raw mut r, &raw mut w, ptr::null_mut(), 0) };
        assert!(ok != 0, "CreatePipe: {:?}", Win32Error::get());
        (r, w)
    }

    /// Hermetic table: stdio slots come from a fresh pipe pair (read end →
    /// fd 0, write end → fds 1/2) so no test ever touches the process's real
    /// std handles. Returns the table plus the pipe ends for teardown and
    /// stdio assertions.
    fn pipe_std_table(capacity: u32) -> (FdTable, HANDLE, HANDLE) {
        let (r, w) = pipe_pair();
        // SAFETY: `r`/`w` are live for the whole test (closed after the
        // table is dropped).
        let table = unsafe { FdTable::with_capacity_and_std(capacity, [r, w, w]) };
        (table, r, w)
    }

    fn mint_file(table: &FdTable, h: HANDLE, flags: FdFlags) -> u32 {
        // SAFETY: `h` is a live test handle whose ownership transfers here.
        unsafe { table.mint(h, FdKind::File, flags) }.expect("mint")
    }

    fn pos_of(table: &FdTable, fd: u32) -> u64 {
        table.lock().slots[fd as usize].pos
    }

    /// Transcription guard for every raw code and selector the table's
    /// contract pins. // quirk: FSIO-15, FSIO-16
    #[test]
    fn raw_constant_kats() {
        assert_eq!(Win32Error::SEEK_ON_DEVICE.0, 132);
        assert_eq!(Win32Error::TOO_MANY_OPEN_FILES.0, 4);
        assert_eq!(Win32Error::INVALID_HANDLE.0, 6);
        assert_eq!(Win32Error::NOT_SUPPORTED.0, 50);
        assert_eq!(STD_INPUT_HANDLE, 0xFFFF_FFF6);
        assert_eq!(STD_OUTPUT_HANDLE, 0xFFFF_FFF5);
        assert_eq!(STD_ERROR_HANDLE, 0xFFFF_FFF4);
        assert_eq!(
            [
                FILE_TYPE_UNKNOWN,
                FILE_TYPE_DISK,
                FILE_TYPE_CHAR,
                FILE_TYPE_PIPE
            ],
            [0, 1, 2, 3]
        );
        // The replacement must never be more limited than the CRT table it
        // deletes (2048 default, 8192 max). // quirk: FSIO-15
        assert!(std::hint::black_box(DEFAULT_CAPACITY) > 8192);
    }

    /// mint/get/close roundtrip; close returns the handle exactly once;
    /// stale fds are the EBADF shape on EVERY entry point; index reuse hands
    /// out the same number fresh (POSIX parity) and LIFO order.
    /// // quirk: FSIO-17, FSIO-19
    #[test]
    fn mint_get_close_roundtrip_and_recycling() {
        let (table, pr, pw) = pipe_std_table(64);
        let file = create_file("roundtrip", b"data");

        // Sentinels are rejected without minting (and without CloseHandle —
        // nothing to leak).
        // SAFETY: sentinel inputs are rejected before any kernel call.
        let null_mint = unsafe { table.mint(ptr::null_mut(), FdKind::File, FdFlags::NONE) };
        assert_eq!(null_mint, Err(Win32Error::INVALID_HANDLE));
        // SAFETY: as above.
        let invalid_mint = unsafe { table.mint(INVALID_HANDLE_VALUE, FdKind::File, FdFlags::NONE) };
        assert_eq!(invalid_mint, Err(Win32Error::INVALID_HANDLE));

        let h_a = open_rw(&file.0);
        let fd = mint_file(&table, h_a, FdFlags::NONE);
        assert_eq!(fd, 3, "first mint lands just past the stdio slots");
        assert_eq!(table.get(fd), Ok(h_a));
        assert_eq!(table.kind(fd), Ok(FdKind::File));
        assert_eq!(table.flags(fd), Ok(FdFlags::NONE));

        // close returns the handle exactly once; the caller closes it.
        let returned = table.close(fd).expect("first close");
        assert_eq!(returned, Some(h_a));
        close_raw(returned.unwrap());

        // Second close and every other entry point: EBADF shape, no trap,
        // no second handle. // quirk: FSIO-17
        assert_eq!(table.close(fd), Err(Win32Error::INVALID_HANDLE));
        assert_eq!(table.get(fd), Err(Win32Error::INVALID_HANDLE));
        assert_eq!(table.kind(fd), Err(Win32Error::INVALID_HANDLE));
        assert_eq!(table.flags(fd), Err(Win32Error::INVALID_HANDLE));
        assert_eq!(table.set_append(fd, true), Err(Win32Error::INVALID_HANDLE));
        assert!(table.positioned_io(fd).is_err());
        assert_eq!(
            table.sequential_io(fd, IoDir::Read, |_, _| unreachable!("op must not run")),
            Err(Win32Error::INVALID_HANDLE)
        );
        // Out-of-range fds too. // quirk: FSIO-19
        assert_eq!(table.get(9999), Err(Win32Error::INVALID_HANDLE));
        assert_eq!(table.close(9999), Err(Win32Error::INVALID_HANDLE));

        // Reuse hands out the SAME number, fresh (pos 0, new flags).
        let h_b = open_rw(&file.0);
        let fd_b = mint_file(&table, h_b, FdFlags::NONE);
        assert_eq!(fd_b, fd, "freed index is reused (POSIX-style recycling)");
        assert_eq!(table.get(fd_b), Ok(h_b));
        assert_eq!(pos_of(&table, fd_b), 0, "reminted slot starts fresh");

        // LIFO reuse: last-closed index comes back first (the documented
        // density-over-lowest-free choice).
        let h_c = open_rw(&file.0);
        let h_d = open_rw(&file.0);
        let fd_c = mint_file(&table, h_c, FdFlags::NONE);
        let fd_d = mint_file(&table, h_d, FdFlags::NONE);
        assert_eq!((fd_c, fd_d), (4, 5));
        close_raw(table.close(fd_c).unwrap().unwrap());
        close_raw(table.close(fd_d).unwrap().unwrap());
        let h_e = open_rw(&file.0);
        let h_f = open_rw(&file.0);
        assert_eq!(mint_file(&table, h_e, FdFlags::NONE), 5, "LIFO reuse");
        assert_eq!(mint_file(&table, h_f, FdFlags::NONE), 4, "LIFO reuse");
        for fd in [3, 4, 5] {
            close_raw(table.close(fd).unwrap().unwrap());
        }
        drop(table);
        close_raw(pr);
        close_raw(pw);
    }

    /// The logical-position discipline at table level (the
    /// regression): sequential ops advance `pos`; positioned ops move the
    /// KERNEL pointer but never `pos`; interleaving behaves like POSIX.
    /// // quirk: FSIO-21
    #[test]
    fn sequential_and_positioned_position_discipline() {
        let (table, pr, pw) = pipe_std_table(64);
        let file = create_file("discipline", b"0123456789ABCDEF");
        let fd = mint_file(&table, open_rw(&file.0), FdFlags::NONE);

        let mut buf = [0u8; 8];

        // Sequential reads take pos under the lock and advance by the
        // transferred count.
        let n = table
            .sequential_io(fd, IoDir::Read, |h, off| {
                assert_eq!(off, Some(0), "first sequential op reads at pos 0");
                raw_read(h, &mut buf[..2], off)
            })
            .unwrap();
        assert_eq!((n, &buf[..2]), (2, &b"01"[..]));
        assert_eq!(pos_of(&table, fd), 2);

        let n = table
            .sequential_io(fd, IoDir::Read, |h, off| {
                assert_eq!(off, Some(2), "sequential offset is the taken pos");
                raw_read(h, &mut buf[..2], off)
            })
            .unwrap();
        assert_eq!((n, &buf[..2]), (2, &b"23"[..]));
        assert_eq!(pos_of(&table, fd), 4);

        // Positioned read: single-syscall ticket, no pointer restore for a
        // minted fd, and pos is NOT touched — even though the kernel pointer
        // moved to offset+transferred. // quirk: FSIO-21
        let ticket = table.positioned_io(fd).unwrap();
        assert!(!ticket.restore_pointer, "minted fds own sequential state");
        assert_eq!(raw_read(ticket.handle, &mut buf[..3], Some(8)), Ok(3));
        assert_eq!(&buf[..3], b"89A");
        assert_eq!(pos_of(&table, fd), 4, "positioned ops never touch pos");

        // The interleaved sequential read continues from logical pos 4 — the
        // exact POSIX behavior the kernel pointer cannot provide.
        let n = table
            .sequential_io(fd, IoDir::Read, |h, off| {
                assert_eq!(off, Some(4), "pos survived the positioned read");
                raw_read(h, &mut buf[..2], off)
            })
            .unwrap();
        assert_eq!((n, &buf[..2]), (2, &b"45"[..]));

        // Sequential write at pos 6, then read back through pos.
        let n = table
            .sequential_io(fd, IoDir::Write, |h, off| {
                assert_eq!(off, Some(6));
                raw_write(h, b"zz", off)
            })
            .unwrap();
        assert_eq!(n, 2);
        assert_eq!(pos_of(&table, fd), 8);
        let ticket = table.positioned_io(fd).unwrap();
        assert_eq!(raw_read(ticket.handle, &mut buf[..8], Some(0)), Ok(8));
        assert_eq!(&buf[..8], b"012345zz");

        // Positioned read at/past EOF keeps the raw EOF error shape and pos.
        let ticket = table.positioned_io(fd).unwrap();
        assert_eq!(
            raw_read(ticket.handle, &mut buf[..2], Some(16)),
            Err(Win32Error::HANDLE_EOF)
        );
        assert_eq!(pos_of(&table, fd), 8);

        // Sequential read drains to EOF; the next sequential read fails with
        // the raw EOF shape and does NOT advance pos.
        let n = table
            .sequential_io(fd, IoDir::Read, |h, off| raw_read(h, &mut buf, off))
            .unwrap();
        assert_eq!(n, 8);
        assert_eq!(pos_of(&table, fd), 16);
        assert_eq!(
            table.sequential_io(fd, IoDir::Read, |h, off| raw_read(h, &mut buf, off)),
            Err(Win32Error::HANDLE_EOF)
        );
        assert_eq!(pos_of(&table, fd), 16, "failed ops do not move pos");

        close_raw(table.close(fd).unwrap().unwrap());
        drop(table);
        close_raw(pr);
        close_raw(pw);
    }

    /// APPEND fds: sequential writes pass `None` (engine APPEND rights own
    /// placement), pos lands at the new EOF per POSIX; positioned writes are
    /// kernel-ignored for placement and never touch pos; sequential reads
    /// still run through pos. // quirk: FSIO-28
    #[test]
    fn append_write_placement_and_pos() {
        let (table, pr, pw) = pipe_std_table(64);
        let file = create_file("append", b"BASE");
        let fd = mint_file(&table, open_append(&file.0), FdFlags::APPEND);

        let n = table
            .sequential_io(fd, IoDir::Write, |h, off| {
                assert_eq!(off, None, "append writes must not pin an offset");
                raw_write(h, b"11", off)
            })
            .unwrap();
        assert_eq!(n, 2);
        assert_eq!(
            pos_of(&table, fd),
            6,
            "POSIX: append write leaves the offset at the new EOF"
        );

        let n = table
            .sequential_io(fd, IoDir::Write, |h, off| {
                assert_eq!(off, None);
                raw_write(h, b"22", off)
            })
            .unwrap();
        assert_eq!(n, 2);
        assert_eq!(pos_of(&table, fd), 8);

        // Positioned write on the append handle: the kernel ignores the
        // offset and appends (Linux pwrite-on-O_APPEND parity); pos is
        // untouched. // quirk: FSIO-28
        let ticket = table.positioned_io(fd).unwrap();
        assert_eq!(raw_write(ticket.handle, b"XX", Some(0)), Ok(2));
        assert_eq!(pos_of(&table, fd), 8, "positioned ops never touch pos");

        // Verify actual placement through a fresh read handle.
        let check = open_rw(&file.0);
        let mut buf = [0u8; 10];
        assert_eq!(raw_read(check, &mut buf, Some(0)), Ok(10));
        assert_eq!(&buf, b"BASE1122XX");
        close_raw(check);

        // APPEND affects writes only: a sequential read on this fd uses pos.
        // (The append fd has no read access; the closure asserts the offset
        // the table handed it without issuing I/O.)
        let n = table
            .sequential_io(fd, IoDir::Read, |_, off| {
                assert_eq!(off, Some(8), "reads on APPEND fds still use pos");
                Ok(0)
            })
            .unwrap();
        assert_eq!(n, 0);

        // set_append(false) reverts writes to the logical-pos discipline
        // (placement authority stays with the handle's APPEND rights).
        table.set_append(fd, false).unwrap();
        assert_eq!(table.flags(fd), Ok(FdFlags::NONE));
        table
            .sequential_io(fd, IoDir::Write, |_, off| {
                assert_eq!(off, Some(8), "non-append writes pin the taken pos");
                Ok(0)
            })
            .unwrap();
        table.set_append(fd, true).unwrap();
        assert_eq!(table.flags(fd), Ok(FdFlags::APPEND));

        close_raw(table.close(fd).unwrap().unwrap());
        drop(table);
        close_raw(pr);
        close_raw(pw);
    }

    /// ADOPTED File fds (a `>>`-redirected stdout shape): the file object —
    /// and its one file pointer — is shared with whoever created the handle,
    /// so sequential I/O must follow the kernel pointer (offset passthrough,
    /// no logical pos), and positioned I/O must demand the save/restore
    /// dance. A logical pos here would clobber the shared file from offset
    /// zero. // quirk: FSIO-21
    #[test]
    fn adopted_file_fd_follows_kernel_pointer() {
        let (table, pr, pw) = pipe_std_table(16);
        let file = create_file("adopted", b"");
        let h = open_rw(&file.0);
        // Simulate the parent having already positioned the shared pointer
        // (cmd.exe `>>` seeks to EOF before spawning).
        assert_eq!(raw_write(h, b"PARENT", None), Ok(6));

        // SAFETY: ownership of `h` transfers to the table.
        let fd = unsafe { table.mint(h, FdKind::File, FdFlags::ADOPTED) }.unwrap();

        let n = table
            .sequential_io(fd, IoDir::Write, |h, off| {
                assert_eq!(off, None, "adopted fds follow the kernel pointer");
                raw_write(h, b"child", off)
            })
            .unwrap();
        assert_eq!(n, 5);
        assert_eq!(pos_of(&table, fd), 0, "adopted fds never track logical pos");

        // The write landed at the shared pointer (6), not at a logical 0.
        let check = open_rw(&file.0);
        let mut buf = [0u8; 11];
        assert_eq!(raw_read(check, &mut buf, Some(0)), Ok(11));
        assert_eq!(&buf, b"PARENTchild");
        close_raw(check);

        // Positioned I/O is allowed but must restore the shared pointer.
        let ticket = table.positioned_io(fd).unwrap();
        assert!(
            ticket.restore_pointer,
            "adopted fds need the FSIO-21 save/seek/restore dance"
        );

        close_raw(table.close(fd).unwrap().unwrap());
        drop(table);
        close_raw(pr);
        close_raw(pw);
    }

    /// The PIPE-57 classification matrix plus kind gating: pipes/char
    /// devices classify correctly, positioned I/O on sequential-only kinds
    /// is the raw ESPIPE shape, and their sequential I/O is pure
    /// passthrough. // quirk: PIPE-57
    #[test]
    fn kind_gating_and_classification_matrix() {
        // Sentinels reject up front (the fd<0 → UNKNOWN crash-fix shape).
        // SAFETY: sentinel inputs are rejected before any kernel call.
        let null_kind = unsafe { classify_handle(ptr::null_mut()) };
        assert_eq!(null_kind, Err(Win32Error::INVALID_HANDLE));
        // SAFETY: as above.
        let invalid_kind = unsafe { classify_handle(INVALID_HANDLE_VALUE) };
        assert_eq!(invalid_kind, Err(Win32Error::INVALID_HANDLE));

        // Disk file → File.
        let file = create_file("classify", b"x");
        let fh = open_rw(&file.0);
        // SAFETY: live test handle.
        let fh_kind = unsafe { classify_handle(fh) };
        assert_eq!(fh_kind, Ok(FdKind::File));
        close_raw(fh);

        // Anonymous pipe: both ends are Pipe; positioned I/O is ESPIPE;
        // sequential I/O passes through with no offset and no pos
        // bookkeeping.
        let (table, pr, pw) = pipe_std_table(64);
        let (r, w) = pipe_pair();
        // SAFETY: live test handles.
        let pipe_kinds = unsafe { (classify_handle(r), classify_handle(w)) };
        assert_eq!(pipe_kinds, (Ok(FdKind::Pipe), Ok(FdKind::Pipe)));

        // SAFETY: ownership of `r` transfers to the table.
        let fd = unsafe { table.mint(r, FdKind::Pipe, FdFlags::NONE) }.unwrap();
        assert_eq!(table.kind(fd), Ok(FdKind::Pipe));
        assert_eq!(
            table.positioned_io(fd).map(|t| t.handle),
            Err(Win32Error::SEEK_ON_DEVICE),
            "positioned I/O on a pipe is the raw ESPIPE shape"
        );
        assert_eq!(raw_write(w, b"hi", None), Ok(2));
        let mut buf = [0u8; 2];
        let n = table
            .sequential_io(fd, IoDir::Read, |h, off| {
                assert_eq!(off, None, "non-File kinds are offset passthrough");
                raw_read(h, &mut buf, off)
            })
            .unwrap();
        assert_eq!((n, &buf), (2, b"hi"));
        assert_eq!(pos_of(&table, fd), 0, "non-File kinds never track pos");
        close_raw(table.close(fd).unwrap().unwrap());
        close_raw(w);

        // NUL: FILE_TYPE_CHAR without a console mode → Char; ESPIPE-gated;
        // sequential writes pass through. // quirk: PIPE-57
        let nul = open_raw(
            Path::new("NUL"),
            FILE_GENERIC_READ | FILE_GENERIC_WRITE,
            SHARE_ALL,
            OPEN_EXISTING,
        );
        // SAFETY: live test handle.
        let nul_kind = unsafe { classify_handle(nul) };
        assert_eq!(nul_kind, Ok(FdKind::Char));
        // SAFETY: ownership of `nul` transfers to the table.
        let nul_fd = unsafe { table.mint(nul, FdKind::Char, FdFlags::NONE) }.unwrap();
        assert_eq!(
            table.positioned_io(nul_fd).map(|t| t.handle),
            Err(Win32Error::SEEK_ON_DEVICE)
        );
        let n = table
            .sequential_io(nul_fd, IoDir::Write, |h, off| {
                assert_eq!(off, None);
                raw_write(h, b"discard", off)
            })
            .unwrap();
        assert_eq!(n, 7);
        close_raw(table.close(nul_fd).unwrap().unwrap());

        // Console handle → Tty, when this test session has a console
        // (CONOUT$ does not exist under detached/redirected CI runners —
        // the Char-vs-Tty split is still covered above via NUL).
        let conout = wide(Path::new("CONOUT$"));
        // SAFETY: NUL-terminated path; null security attributes/template.
        let con = unsafe {
            CreateFileW(
                conout.as_ptr(),
                FILE_GENERIC_READ | FILE_GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        if con != INVALID_HANDLE_VALUE {
            // SAFETY: live console handle.
            let con_kind = unsafe { classify_handle(con) };
            assert_eq!(con_kind, Ok(FdKind::Tty));
            // SAFETY: ownership of `con` transfers to the table.
            let tty_fd = unsafe { table.mint(con, FdKind::Tty, FdFlags::NONE) }.unwrap();
            assert_eq!(
                table.positioned_io(tty_fd).map(|t| t.handle),
                Err(Win32Error::SEEK_ON_DEVICE)
            );
            close_raw(table.close(tty_fd).unwrap().unwrap());
        } else {
            eprintln!("note: no console in this session; Tty probe skipped");
        }

        drop(table);
        close_raw(pr);
        close_raw(pw);
    }

    /// Stdio slots: pre-reserved 0/1/2, close is a silent no-op that leaves
    /// the underlying handle open and the slot usable; dead std handles make
    /// EBADF-shaped slots that still close "successfully". // quirk: FSIO-16
    #[test]
    fn stdio_reserved_close_noop_and_dead_slots() {
        let (table, pr, pw) = pipe_std_table(16);

        // 0/1/2 exist, adopted, classified.
        assert_eq!(table.get(0), Ok(pr));
        assert_eq!(table.get(1), Ok(pw));
        assert_eq!(table.get(2), Ok(pw));
        for fd in 0..3 {
            assert_eq!(table.kind(fd), Ok(FdKind::Pipe));
            assert!(table.flags(fd).unwrap().contains(FdFlags::ADOPTED));
        }

        // close(1) reports success WITHOUT surrendering the handle…
        assert_eq!(table.close(1), Ok(None));
        // …the slot is still live…
        assert_eq!(table.get(1), Ok(pw));
        // …and the underlying handle still works: write through fd 1, read
        // it back from the pipe's other end.
        let n = table
            .sequential_io(1, IoDir::Write, |h, off| {
                assert_eq!(off, None, "adopted fds are kernel-pointer passthrough");
                raw_write(h, b"alive", off)
            })
            .unwrap();
        assert_eq!(n, 5);
        let mut buf = [0u8; 5];
        assert_eq!(raw_read(pr, &mut buf, None), Ok(5));
        assert_eq!(&buf, b"alive");
        // All three stdio fds no-op, repeatedly.
        for fd in [0, 1, 2, 0, 1, 2] {
            assert_eq!(table.close(fd), Ok(None));
        }

        // First mint lands at 3 — stdio is reserved even when dead.
        let file = create_file("stdio", b"x");
        let fd = mint_file(&table, open_rw(&file.0), FdFlags::NONE);
        assert_eq!(fd, 3);
        close_raw(table.close(fd).unwrap().unwrap());
        drop(table);
        close_raw(pr);
        close_raw(pw);

        // Detached-process shape: null std handles → slots exist, every use
        // is the EBADF shape, close still no-ops, numbering unaffected.
        // SAFETY: null sentinels are valid dead-slot inputs.
        let dead = unsafe {
            FdTable::with_capacity_and_std(16, [ptr::null_mut(), ptr::null_mut(), ptr::null_mut()])
        };
        for fd in 0..3 {
            assert_eq!(dead.get(fd), Err(Win32Error::INVALID_HANDLE));
            assert_eq!(dead.kind(fd), Err(Win32Error::INVALID_HANDLE));
            assert_eq!(
                dead.sequential_io(fd, IoDir::Write, |_, _| unreachable!("dead slot")),
                Err(Win32Error::INVALID_HANDLE)
            );
            assert_eq!(dead.close(fd), Ok(None), "close(0..2) no-ops even dead");
        }
        let file2 = create_file("stdio_dead", b"y");
        let fd = mint_file(&dead, open_rw(&file2.0), FdFlags::NONE);
        assert_eq!(fd, 3);
        close_raw(dead.close(fd).unwrap().unwrap());
    }

    /// Capacity: a tiny-cap table exhausts with the raw EMFILE shape, the
    /// rejected handle is closed by mint (never leaked), and close frees
    /// capacity. // quirk: FSIO-15
    #[test]
    fn capacity_emfile_shape_and_reuse() {
        let (table, pr, pw) = pipe_std_table(5); // 3 stdio + 2 mintable
        let file = create_file("cap", b"x");

        let fd_a = mint_file(&table, open_rw(&file.0), FdFlags::NONE);
        let fd_b = mint_file(&table, open_rw(&file.0), FdFlags::NONE);
        assert_eq!((fd_a, fd_b), (3, 4));

        // Third mint: EMFILE shape. The handle is opened WITHOUT share-
        // delete, so the file is deletable iff mint really closed it.
        let probe_path = temp_path("cap_probe");
        let probe = open_raw(
            &probe_path,
            FILE_GENERIC_READ | FILE_GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            CREATE_ALWAYS,
        );
        // SAFETY: ownership of `probe` transfers to mint, which closes it on
        // failure.
        let full = unsafe { table.mint(probe, FdKind::File, FdFlags::NONE) };
        assert_eq!(full, Err(Win32Error::TOO_MANY_OPEN_FILES));
        let probe_w = wide(&probe_path);
        // SAFETY: NUL-terminated path.
        let deleted = unsafe { DeleteFileW(probe_w.as_ptr()) };
        assert!(
            deleted != 0,
            "EMFILE-rejected handle must be closed by mint, not leaked: {:?}",
            Win32Error::get()
        );

        // close frees capacity; the freed index is reused.
        close_raw(table.close(fd_a).unwrap().unwrap());
        let fd_c = mint_file(&table, open_rw(&file.0), FdFlags::NONE);
        assert_eq!(fd_c, fd_a);

        // A capacity request below the stdio floor clamps to stdio-only:
        // zero mintable slots, immediate EMFILE.
        let (floor, fr, fw) = pipe_std_table(0);
        let probe2_path = temp_path("cap_floor");
        let probe2 = open_raw(
            &probe2_path,
            FILE_GENERIC_READ | FILE_GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            CREATE_ALWAYS,
        );
        // SAFETY: ownership of `probe2` transfers to mint.
        let floor_mint = unsafe { floor.mint(probe2, FdKind::File, FdFlags::NONE) };
        assert_eq!(floor_mint, Err(Win32Error::TOO_MANY_OPEN_FILES));
        let probe2_w = wide(&probe2_path);
        // SAFETY: NUL-terminated path.
        assert!(unsafe { DeleteFileW(probe2_w.as_ptr()) } != 0);

        for fd in [fd_b, fd_c] {
            close_raw(table.close(fd).unwrap().unwrap());
        }
        drop(table);
        drop(floor);
        close_raw(pr);
        close_raw(pw);
        close_raw(fr);
        close_raw(fw);
    }

    /// A sequential op whose fd is closed-and-reminted mid-flight must NOT
    /// advance the new occupant's pos — the generation tag is the
    /// anti-recycling mechanism the table exists for.
    #[test]
    fn stale_sequential_io_cannot_corrupt_reminted_slot() {
        let (table, pr, pw) = pipe_std_table(16);
        let file_a = create_file("stale_a", b"AAAA");
        let file_b = create_file("stale_b", b"BBBB");
        let h_a = open_rw(&file_a.0);
        let fd = mint_file(&table, h_a, FdFlags::NONE);

        let (tx_entered, rx_entered) = mpsc::channel::<()>();
        let (tx_resume, rx_resume) = mpsc::channel::<()>();

        std::thread::scope(|s| {
            let table_ref = &table;
            let stale = s.spawn(move || {
                table_ref.sequential_io(fd, IoDir::Read, |h, off| {
                    assert_eq!(off, Some(0));
                    tx_entered.send(()).unwrap();
                    rx_resume.recv().unwrap(); // fd is closed+reminted here
                    let mut buf = [0u8; 2];
                    raw_read(h, &mut buf, off).inspect(|_| assert_eq!(&buf, b"AA"))
                })
            });

            rx_entered.recv().unwrap();
            // Close the fd out from under the in-flight op. The handle comes
            // back to us; defer CloseHandle until the op finishes (the
            // close-vs-IO race on the HANDLE itself is the caller's, exactly
            // as under POSIX — here the test IS that caller).
            let returned = table.close(fd).unwrap().unwrap();
            assert_eq!(returned, h_a);
            // Remint the SAME index over a different file.
            let h_b = open_rw(&file_b.0);
            assert_eq!(mint_file(&table, h_b, FdFlags::NONE), fd);

            tx_resume.send(()).unwrap();
            assert_eq!(
                stale.join().unwrap(),
                Ok(2),
                "the stale op itself completes on the old handle"
            );
            close_raw(returned);
        });

        assert_eq!(
            pos_of(&table, fd),
            0,
            "stale advance must be discarded — generation mismatch"
        );
        // The new occupant reads its own bytes from its own pos 0.
        let mut buf = [0u8; 4];
        let n = table
            .sequential_io(fd, IoDir::Read, |h, off| {
                assert_eq!(off, Some(0));
                raw_read(h, &mut buf, off)
            })
            .unwrap();
        assert_eq!((n, &buf), (4, b"BBBB"));

        close_raw(table.close(fd).unwrap().unwrap());
        drop(table);
        close_raw(pr);
        close_raw(pw);
    }

    /// Thread-safety smoke: concurrent mint/use/close across threads, no
    /// index collisions (every get returns the thread's own handle), every
    /// handle returned by close exactly once.
    #[test]
    fn thread_safety_mint_use_close() {
        const THREADS: usize = 8;
        const ITERS: usize = 24;
        let (table, pr, pw) = pipe_std_table(256);
        let mints = AtomicUsize::new(0);
        let closes = AtomicUsize::new(0);

        std::thread::scope(|s| {
            for t in 0..THREADS {
                let table = &table;
                let mints = &mints;
                let closes = &closes;
                s.spawn(move || {
                    let file = create_file(&format!("threads_{t}"), b"thread-data");
                    for _ in 0..ITERS {
                        let h = open_rw(&file.0);
                        // SAFETY: ownership of `h` transfers to the table.
                        let fd = unsafe { table.mint(h, FdKind::File, FdFlags::NONE) }.unwrap();
                        mints.fetch_add(1, Ordering::Relaxed);
                        assert!(fd >= 3, "stdio slots are never recycled");
                        // A collision with another thread's live slot would
                        // surface as a foreign handle here.
                        assert_eq!(table.get(fd), Ok(h));
                        let mut buf = [0u8; 6];
                        let n = table
                            .sequential_io(fd, IoDir::Read, |h, off| raw_read(h, &mut buf, off))
                            .unwrap();
                        assert_eq!((n, &buf), (6, b"thread"));
                        let returned = table.close(fd).unwrap();
                        assert_eq!(returned, Some(h), "close returns OUR handle");
                        closes.fetch_add(1, Ordering::Relaxed);
                        close_raw(h);
                    }
                });
            }
        });

        assert_eq!(mints.load(Ordering::Relaxed), THREADS * ITERS);
        assert_eq!(
            closes.load(Ordering::Relaxed),
            THREADS * ITERS,
            "every minted handle was returned by close exactly once"
        );
        // The table is fully drained: a fresh mint lands back in the dense
        // low range.
        let file = create_file("threads_post", b"x");
        let fd = mint_file(&table, open_rw(&file.0), FdFlags::NONE);
        assert!((3..3 + THREADS as u32).contains(&fd));
        close_raw(table.close(fd).unwrap().unwrap());
        drop(table);
        close_raw(pr);
        close_raw(pw);
    }

    /// Adversarial interleaving: JS thread + work pool both mint/get/close.
    /// Each thread churns its own pipes; a shared channel crosses fds between
    /// threads so close-from-another-thread and slot-reuse race the readers.
    #[test]
    fn concurrent_mint_get_close_churn() {
        // Capacity sized for the worst case: 8 threads x 2 live fds plus the
        // crossing backlog — a too-small table makes mint fail EMFILE-shaped
        // (verified: capacity 16 trips Win32Error(4) under release timing).
        // SAFETY: null std handles are valid dead-slot sentinels.
        let table = unsafe {
            FdTable::with_capacity_and_std(
                4096,
                [ptr::null_mut(), ptr::null_mut(), ptr::null_mut()],
            )
        };
        let threads = 8usize;
        let iters = 500usize;
        let (tx, rx) = mpsc::channel::<u32>();
        let closed_cross = AtomicUsize::new(0);

        std::thread::scope(|s| {
            for ti in 0..threads {
                let table = &table;
                let tx = tx.clone();
                s.spawn(move || {
                    for i in 0..iters {
                        let mut r: HANDLE = core::ptr::null_mut();
                        let mut w: HANDLE = core::ptr::null_mut();
                        // SAFETY: out-params are locals.
                        assert_ne!(
                            unsafe {
                                bun_windows_sys::CreatePipe(
                                    &raw mut r,
                                    &raw mut w,
                                    core::ptr::null_mut(),
                                    0,
                                )
                            },
                            0
                        );
                        // SAFETY: both handles are live and owned; ownership
                        // transfers to the table.
                        let rfd = unsafe { table.mint(r, FdKind::Pipe, FdFlags::NONE) }.unwrap();
                        let wfd = unsafe { table.mint(w, FdKind::Pipe, FdFlags::NONE) }.unwrap();
                        assert_eq!(table.get(rfd).unwrap().addr(), r.addr());
                        assert_eq!(table.get(wfd).unwrap().addr(), w.addr());
                        // Cross every 8th read end to another thread; close
                        // the write end locally.
                        if i % 8 == ti % 8 {
                            tx.send(rfd).unwrap();
                        } else {
                            // NB: no get-after-close assert here — another
                            // thread can legally recycle this fd number the
                            // instant close() frees the slot.
                            close_raw(table.close(rfd).unwrap().unwrap());
                        }
                        close_raw(table.close(wfd).unwrap().unwrap());
                    }
                });
            }
            drop(tx);
            // Closer thread: fds minted on other threads, closed here while
            // their slots get re-minted concurrently. Generation bumps keep a
            // recycled slot from resolving through a stale fd.
            let table = &table;
            let closed = &closed_cross;
            s.spawn(move || {
                while let Ok(fd) = rx.recv() {
                    if let Ok(Some(h)) = table.close(fd) {
                        close_raw(h);
                        closed.fetch_add(1, Ordering::Relaxed);
                    }
                }
            });
        });

        assert!(
            closed_cross.load(Ordering::Relaxed) > 0,
            "cross-thread closes exercised"
        );
        // Freelist still internally consistent: fresh mints succeed on
        // recycled slots and close cleanly.
        let mut r: HANDLE = core::ptr::null_mut();
        let mut w: HANDLE = core::ptr::null_mut();
        // SAFETY: out-params are locals.
        assert_ne!(
            unsafe { bun_windows_sys::CreatePipe(&raw mut r, &raw mut w, core::ptr::null_mut(), 0) },
            0
        );
        // SAFETY: live owned handles; ownership transfers to the table.
        let fd1 = unsafe { table.mint(r, FdKind::Pipe, FdFlags::NONE) }.unwrap();
        let fd2 = unsafe { table.mint(w, FdKind::Pipe, FdFlags::NONE) }.unwrap();
        close_raw(table.close(fd1).unwrap().unwrap());
        close_raw(table.close(fd2).unwrap().unwrap());
    }

    // ── ucrt-oracle differential battery ──────────────────────────────────
    // Same op script driven through ucrt's lowio table (the implementation
    // libuv rode) and through this table; observable results must match.
    // Error CODES are not compared (different domains) — success values,
    // payload bytes, positions, and ok/err shape are.

    mod ucrt {
        use core::ffi::{c_int, c_uint, c_void};

        /// Bad-fd CRT calls fastfail (STATUS_STACK_BUFFER_OVERRUN) unless an
        /// invalid-parameter handler is installed — the reason both libuv's
        /// `uv__init` and bun's `process_init` install a no-op one. The
        /// oracle replicates that environment.
        pub(super) type InvalidParamHandler = Option<
            unsafe extern "C" fn(*const u16, *const u16, *const u16, u32, usize),
        >;
        pub(super) unsafe extern "C" fn noop_invalid_param(
            _e: *const u16,
            _f: *const u16,
            _file: *const u16,
            _line: u32,
            _r: usize,
        ) {
        }
        unsafe extern "C" {
            pub(super) fn _set_invalid_parameter_handler(
                h: InvalidParamHandler,
            ) -> InvalidParamHandler;
            pub(super) fn _open_osfhandle(osfhandle: isize, flags: c_int) -> c_int;
            pub(super) fn _close(fd: c_int) -> c_int;
            pub(super) fn _lseeki64(fd: c_int, offset: i64, origin: c_int) -> i64;
            pub(super) fn _read(fd: c_int, buffer: *mut c_void, count: c_uint) -> c_int;
            pub(super) fn _write(fd: c_int, buffer: *const c_void, count: c_uint) -> c_int;
        }
    }

    /// One observation per op; the two sides' logs must match element-wise.
    #[derive(Debug, PartialEq, Eq)]
    enum Obs {
        Wrote(usize),
        Pos(u64),
        ReadBytes(Vec<u8>),
        Closed,
        Err,
    }

    trait OracleFd {
        fn write(&mut self, data: &[u8]) -> Obs;
        fn read(&mut self, n: usize) -> Obs;
        fn seek(&mut self, offset: i64, whence: u32) -> Obs;
        fn close(&mut self) -> Obs;
    }

    struct UcrtFd(core::ffi::c_int);
    impl OracleFd for UcrtFd {
        fn write(&mut self, data: &[u8]) -> Obs {
            // SAFETY: live buffer; count = len.
            let n = unsafe { ucrt::_write(self.0, data.as_ptr().cast(), data.len() as u32) };
            if n < 0 { Obs::Err } else { Obs::Wrote(n as usize) }
        }
        fn read(&mut self, n: usize) -> Obs {
            let mut buf = vec![0u8; n];
            // SAFETY: live buffer; count = capacity.
            let r = unsafe { ucrt::_read(self.0, buf.as_mut_ptr().cast(), n as u32) };
            if r < 0 {
                return Obs::Err;
            }
            buf.truncate(r as usize);
            Obs::ReadBytes(buf)
        }
        fn seek(&mut self, offset: i64, whence: u32) -> Obs {
            // SAFETY: by-value args; origin 0/1/2 = SEEK_SET/CUR/END.
            let p = unsafe { ucrt::_lseeki64(self.0, offset, whence as core::ffi::c_int) };
            if p < 0 { Obs::Err } else { Obs::Pos(p as u64) }
        }
        fn close(&mut self) -> Obs {
            // SAFETY: fd is CRT-owned; double-close yields EBADF, no abort
            // (release ucrt _invalid_parameter_noinfo returns).
            if unsafe { ucrt::_close(self.0) } == 0 { Obs::Closed } else { Obs::Err }
        }
    }

    struct TableFd<'a> {
        table: &'a FdTable,
        fd: u32,
    }
    impl OracleFd for TableFd<'_> {
        fn write(&mut self, data: &[u8]) -> Obs {
            match self
                .table
                .sequential_io(self.fd, IoDir::Write, |h, pos| raw_write(h, data, pos))
            {
                Ok(n) => Obs::Wrote(n),
                Err(_) => Obs::Err,
            }
        }
        fn read(&mut self, n: usize) -> Obs {
            let mut buf = vec![0u8; n];
            let r = self.table.sequential_io(self.fd, IoDir::Read, |h, pos| {
                match raw_read(h, &mut buf, pos) {
                    // Explicit-offset reads at EOF report HANDLE_EOF where the
                    // file-pointer path reports 0 bytes — same observable EOF.
                    Err(Win32Error::HANDLE_EOF) => Ok(0),
                    r => r,
                }
            });
            match r {
                Ok(got) => {
                    buf.truncate(got);
                    Obs::ReadBytes(buf)
                }
                Err(_) => Obs::Err,
            }
        }
        fn seek(&mut self, offset: i64, whence: u32) -> Obs {
            match self.table.seek(self.fd, offset, whence) {
                Ok(p) => Obs::Pos(p),
                Err(_) => Obs::Err,
            }
        }
        fn close(&mut self) -> Obs {
            match self.table.close(self.fd) {
                Ok(Some(h)) => {
                    close_raw(h);
                    Obs::Closed
                }
                Ok(None) => Obs::Closed,
                Err(_) => Obs::Err,
            }
        }
    }

    /// The op script; comments give the expected observation.
    fn run_oracle_script(fd: &mut dyn OracleFd) -> Vec<Obs> {
        let mut log = Vec::new();
        log.push(fd.write(b"ABCDEFGHIJ")); //  0: Wrote(10)
        log.push(fd.seek(0, 0)); //            1: Pos(0)
        log.push(fd.read(4)); //               2: "ABCD"
        log.push(fd.seek(2, 1)); //            3: CUR +2 -> Pos(6)
        log.push(fd.read(4)); //               4: "GHIJ"
        log.push(fd.read(4)); //               5: EOF -> 0 bytes
        log.push(fd.seek(-3, 2)); //           6: END -3 -> Pos(7)
        log.push(fd.read(16)); //              7: "HIJ"
        log.push(fd.seek(0, 0)); //            8: Pos(0)
        log.push(fd.write(b"xy")); //          9: overwrite head
        log.push(fd.seek(-1, 0)); //          10: negative absolute -> Err
        log.push(fd.seek(100, 0)); //         11: past EOF (sparse) -> Pos(100)
        log.push(fd.read(4)); //              12: read past EOF -> 0 bytes
        log.push(fd.seek(0, 1)); //           13: CUR 0 position query
        log.push(fd.close()); //              14: Closed
        log.push(fd.read(4)); //              15: read-after-close -> Err
        log.push(fd.seek(0, 0)); //           16: seek-after-close -> Err
        log.push(fd.close()); //              17: double close -> Err
        log
    }

    /// ucrt's lowio table is the reference implementation libuv used; this
    /// table must be observationally equivalent for the shared op set.
    #[test]
    fn ucrt_oracle_parity() {
        // SAFETY: installing a documented-signature no-op handler.
        unsafe { ucrt::_set_invalid_parameter_handler(Some(ucrt::noop_invalid_param)) };
        let crt_path = temp_path("oracle_crt");
        let table_path = temp_path("oracle_table");
        let _crt_cleanup = TempFile(crt_path.clone());
        let _table_cleanup = TempFile(table_path.clone());

        let crt_handle = open_raw(
            &crt_path,
            FILE_GENERIC_READ | FILE_GENERIC_WRITE,
            SHARE_ALL,
            CREATE_ALWAYS,
        );
        let table_handle = open_raw(
            &table_path,
            FILE_GENERIC_READ | FILE_GENERIC_WRITE,
            SHARE_ALL,
            CREATE_ALWAYS,
        );

        // SAFETY: handle ownership transfers to the CRT table.
        let crt_fd =
            unsafe { ucrt::_open_osfhandle(crt_handle.expose_provenance() as isize, 0) };
        assert!(crt_fd >= 0, "_open_osfhandle failed");

        // SAFETY: null std sentinels; ownership of table_handle transfers.
        let table = unsafe {
            FdTable::with_capacity_and_std(16, [ptr::null_mut(), ptr::null_mut(), ptr::null_mut()])
        };
        // SAFETY: live owned handle; the table owns it from here.
        let fd = unsafe { table.mint(table_handle, FdKind::File, FdFlags::NONE) }.unwrap();

        let crt_log = run_oracle_script(&mut UcrtFd(crt_fd));
        let table_log = run_oracle_script(&mut TableFd { table: &table, fd });

        for (i, (c, tt)) in crt_log.iter().zip(table_log.iter()).enumerate() {
            assert_eq!(c, tt, "oracle divergence at step {i}");
        }

        // Both sides must have produced byte-identical files.
        let read_back = |p: &Path| {
            let h = open_raw(p, FILE_GENERIC_READ, SHARE_ALL, OPEN_EXISTING);
            let mut buf = [0u8; 64];
            let got = raw_read(h, &mut buf, None).unwrap();
            close_raw(h);
            buf[..got].to_vec()
        };
        assert_eq!(read_back(&crt_path), read_back(&table_path));
        assert_eq!(read_back(&crt_path), b"xyCDEFGHIJ".to_vec());
    }
}


#[cfg(test)]
mod inherited_blob_tests {
    use super::*;

    fn blob(count_field: u32, entries: &[(u8, usize)]) -> Vec<u8> {
        let mut b = count_field.to_le_bytes().to_vec();
        for (flags, _) in entries {
            b.push(*flags);
        }
        for (_, addr) in entries {
            b.extend_from_slice(&addr.to_le_bytes());
        }
        b
    }

    fn empty_table() -> FdTable {
        // SAFETY: sentinel std handles are valid classify inputs (dead slots).
        unsafe {
            FdTable::with_capacity_and_std(
                64,
                [INVALID_HANDLE_VALUE, INVALID_HANDLE_VALUE, INVALID_HANDLE_VALUE],
            )
        }
    }

    /// Valid live handle at fd 4 imports; sentinels and closed flags skip.
    #[test]
    fn imports_live_handles_at_fixed_indices() {
        let table = empty_table();
        // A real live handle: the process pseudo-handle won't classify as a
        // file — use a fresh anonymous pipe end instead.
        let mut r: HANDLE = core::ptr::null_mut();
        let mut w: HANDLE = core::ptr::null_mut();
        // SAFETY: out-params are locals.
        assert_ne!(
            unsafe { bun_windows_sys::CreatePipe(&raw mut r, &raw mut w, core::ptr::null_mut(), 0) },
            0
        );
        let entries = [
            (0x01u8, 0usize),                      // fd 0 — stdio range, ignored by walk
            (0x01, 0),                             // fd 1
            (0x01, 0),                             // fd 2
            (0x00, w.expose_provenance()),         // fd 3: FOPEN clear → skipped
            (0x01, r.expose_provenance()),         // fd 4: live pipe → imported
            (0x01, usize::MAX),                    // fd 5: INVALID sentinel → skipped
        ];
        let b = blob(entries.len() as u32, &entries);
        table.import_inherited_blob(&b);
        assert!(table.get(3).is_err(), "FOPEN-clear slot must stay empty");
        assert_eq!(
            table.get(4).expect("imported").expose_provenance(),
            r.expose_provenance()
        );
        assert!(table.get(5).is_err(), "sentinel must be skipped");
        // SAFETY: w was never adopted; r belongs to the table now.
        unsafe { CloseHandle(w) };
    }

    /// A count field larger than the byte length clamps instead of OOB.
    #[test]
    fn hostile_count_clamps_to_actual_bytes() {
        let table = empty_table();
        let entries = [(0x01u8, 0usize); 4];
        let mut b = blob(u32::MAX, &entries);
        // Truncate to a 4-entry layout: parser must clamp count to 4.
        b.truncate(4 + 4 + 4 * core::mem::size_of::<usize>());
        table.import_inherited_blob(&b);
        for idx in 3..16 {
            assert!(table.get(idx).is_err());
        }
    }

    /// Zero-count and header-only blobs are no-ops.
    #[test]
    fn degenerate_blobs_are_noops() {
        let table = empty_table();
        table.import_inherited_blob(&blob(0, &[]));
        table.import_inherited_blob(&[0u8, 0, 0, 0, 0xFF]);
        assert!(table.get(3).is_err());
    }

}

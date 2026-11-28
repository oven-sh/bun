//! Per-CRT-descriptor state: cached file type, generation, and the lock under which positional I/O restores the file position.

use core::sync::atomic::{AtomicU32, Ordering};
use std::os::windows::io::IntoRawHandle as _;

use bun_core::{DecodeWindows, FdKind, Mutex, MutexGuard};
use bun_windows_sys::externs::FILE_POSITION_INFORMATION;

use super::{
    FILE_TYPE_DISK, GetFileType, HANDLE, INVALID_HANDLE_VALUE, Win32Error, duplicate_io, nt,
};
use crate::Fd;

/// C code opens and closes descriptors without updating this table, so their kind is never cached.
const KIND_UNREGISTERED: u32 = 0;
const KIND_UNKNOWN: u32 = 1;
const KIND_DISK: u32 = 2;
const KIND_OTHER: u32 = 3;
const KIND_BITS: u32 = 2;
const KIND_MASK: u32 = (1 << KIND_BITS) - 1;

struct Descriptor {
    /// `generation << KIND_BITS | kind`. Open and close increment the generation under `position_lock`.
    state: AtomicU32,
    position_lock: Mutex<()>,
}

const CRT_FD_BITS: u32 = 13;

/// One entry per possible CRT descriptor.
static DESCRIPTORS: [Descriptor; 1 << CRT_FD_BITS] = [const {
    Descriptor {
        state: AtomicU32::new(KIND_UNREGISTERED),
        position_lock: Mutex::new(()),
    }
}; 1 << CRT_FD_BITS];

/// For duplicates that outlive their origin descriptor. The prime length spreads the generations of one descriptor.
static FALLBACK_LOCKS: [Mutex<()>; 61] = [const { Mutex::new(()) }; 61];

fn check_handle(handle: HANDLE) -> Result<HANDLE, Win32Error> {
    match handle {
        INVALID_HANDLE_VALUE => Err(Win32Error::INVALID_HANDLE),
        handle => Ok(handle),
    }
}

fn query_is_disk_file(fd: Fd) -> bool {
    check_handle(fd.native()).is_ok_and(|handle| GetFileType(handle) == FILE_TYPE_DISK)
}

impl Descriptor {
    fn get(crt_fd: i32) -> Option<&'static Self> {
        DESCRIPTORS.get(crt_fd as usize)
    }

    fn generation(&self) -> u16 {
        (self.state.load(Ordering::Acquire) >> KIND_BITS) as u16
    }

    fn bump_generation(&self, _: &MutexGuard<'static, ()>, kind: u32) {
        let next = (self.state.load(Ordering::Acquire) | KIND_MASK).wrapping_add(1);
        self.state.store(next | kind, Ordering::Release);
    }

    /// `None` if `fd` is not a disk file.
    fn disk_file_generation(&self, fd: Fd) -> Option<u16> {
        let state = self.state.load(Ordering::Acquire);
        let mut kind = state & KIND_MASK;
        if kind == KIND_UNREGISTERED || kind == KIND_UNKNOWN {
            let queried_kind = if query_is_disk_file(fd) {
                KIND_DISK
            } else {
                KIND_OTHER
            };
            if kind == KIND_UNKNOWN {
                _ = self.state.compare_exchange(
                    state,
                    state & !KIND_MASK | queried_kind,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                );
            }
            kind = queried_kind;
        }
        (kind == KIND_DISK).then_some((state >> KIND_BITS) as u16)
    }

    /// `None` if `generation` is no longer current.
    fn lock_generation(&'static self, generation: u16) -> Option<MutexGuard<'static, ()>> {
        if self.generation() != generation {
            return None;
        }
        let guard = self.position_lock.lock();
        (self.generation() == generation).then_some(guard)
    }

    /// Only disk files are locked: a request on a pipe can block indefinitely.
    fn lock_disk_file(&'static self, fd: Fd) -> Option<MutexGuard<'static, ()>> {
        loop {
            if let Some(guard) = self.lock_generation(self.disk_file_generation(fd)?) {
                return Some(guard);
            }
        }
    }
}

fn origin_generation(origin: u32) -> u16 {
    (origin >> CRT_FD_BITS) as u16
}

fn lock_position(
    fd: Fd,
    crt_fd: Option<i32>,
) -> Result<Option<MutexGuard<'static, ()>>, Win32Error> {
    let Some(origin) = fd.origin() else {
        return Ok(crt_fd.and_then(|crt_fd| Descriptor::get(crt_fd)?.lock_disk_file(fd)));
    };
    let descriptor = &DESCRIPTORS[origin as usize % DESCRIPTORS.len()];
    if let Some(guard) = descriptor.lock_generation(origin_generation(origin)) {
        return Ok(Some(guard));
    }
    match fd.kind() {
        FdKind::Crt => Err(Win32Error::INVALID_HANDLE),
        FdKind::System => Ok(Some(
            FALLBACK_LOCKS[origin as usize % FALLBACK_LOCKS.len()].lock(),
        )),
    }
}

/// A `HANDLE` only matches the standard descriptors.
fn find_crt_fd(fd: Fd) -> Option<i32> {
    match fd.decode_windows() {
        DecodeWindows::Crt(crt_fd) => Some(crt_fd),
        DecodeWindows::Windows(handle) => {
            (0..=2).find(|&crt_fd| Fd::from_crt(crt_fd).native() == handle)
        }
    }
}

fn disk_file_origin(fd: Fd) -> Option<u32> {
    let crt_fd = find_crt_fd(fd)?;
    let generation = Descriptor::get(crt_fd)?.disk_file_generation(fd)?;
    Some(u32::from(generation) << CRT_FD_BITS | crt_fd as u32)
}

/// Call after the CRT allocates `crt_fd`.
pub(crate) fn register(crt_fd: i32) {
    if let Some(descriptor) = Descriptor::get(crt_fd) {
        descriptor.bump_generation(&descriptor.position_lock.lock(), KIND_UNKNOWN);
    }
}

/// Runs `close` under the lock unless `fd` is out of range or stale. Returns whether it was closed.
pub(crate) fn try_close(fd: Fd, close: impl FnOnce() -> bool) -> bool {
    let Some(descriptor) = Descriptor::get(fd.crt()) else {
        return false;
    };
    let guard = descriptor.position_lock.lock();
    if fd
        .origin()
        .is_some_and(|origin| origin_generation(origin) != descriptor.generation())
    {
        return false;
    }
    let identity = fd_identity(fd);
    let is_closed = close();
    descriptor.bump_generation(&guard, KIND_UNREGISTERED);
    duplicate_io::end_reads(identity);
    is_closed
}

/// Does not block. The result is cached for registered descriptors.
pub fn is_disk_file(fd: Fd) -> bool {
    match find_crt_fd(fd).and_then(Descriptor::get) {
        Some(descriptor) => descriptor.disk_file_generation(fd).is_some(),
        None => fd.origin().is_some() || query_is_disk_file(fd),
    }
}

/// Changes when the descriptor is closed, even if its number is reused.
pub fn fd_identity(fd: Fd) -> u64 {
    let Some(crt_fd) = find_crt_fd(fd) else {
        return fd.0;
    };
    let state =
        Descriptor::get(crt_fd).map_or(0, |descriptor| descriptor.state.load(Ordering::Acquire));
    1 << 63 | u64::from(state >> KIND_BITS) << 32 | u64::from(crt_fd as u32)
}

/// Whether `identity`, from [`fd_identity`], is that of a descriptor that [`try_close`] closes.
pub(super) fn is_closable(identity: u64) -> bool {
    identity >> 63 == 1 && identity as u32 > 2
}

pub(super) fn was_closed(identity: u64) -> bool {
    is_closable(identity) && fd_identity(Fd::from_crt(identity as u32 as i32)) != identity
}

/// Whether JavaScript can observe the file position.
pub(crate) fn is_position_shared(fd: Fd) -> bool {
    fd.origin().is_some() || find_crt_fd(fd).is_some()
}

/// The result fails with `EBADF` once the descriptor is closed. `None` if `fd` is not a disk file.
pub fn pin_fd_generation(fd: Fd) -> Option<Fd> {
    disk_file_origin(fd).map(|origin| fd.with_origin(origin))
}

/// The duplicate shares the file position of `fd`, so it uses the same lock.
pub(crate) fn duplicate(fd: Fd) -> Result<Fd, Win32Error> {
    let origin = fd.origin().or_else(|| disk_file_origin(fd));
    let new_fd = Fd::from_system(super::duplicate_handle(fd.native())?.into_raw_handle());
    Ok(origin.map_or(new_fd, |origin| new_fd.with_origin(origin)))
}

/// For a request at the current position. The owner of a plain `HANDLE` serializes its own requests.
pub(crate) fn with_position_locked<T>(
    fd: Fd,
    request: impl FnOnce(HANDLE) -> Result<T, Win32Error>,
) -> Result<T, Win32Error> {
    let _guard = lock_position(fd, (fd.kind() == FdKind::Crt).then(|| fd.crt()))?;
    request(check_handle(fd.native())?)
}

/// For a request with an explicit offset.
pub(crate) fn with_position_preserved<T>(
    fd: Fd,
    request: impl FnOnce(HANDLE) -> Result<T, Win32Error>,
) -> Result<T, Win32Error> {
    let guard = lock_position(fd, find_crt_fd(fd))?;
    let handle = check_handle(fd.native())?;
    if guard.is_none() && !query_is_disk_file(fd) {
        return request(handle);
    }
    let position = nt::query_file_info::<FILE_POSITION_INFORMATION>(handle);
    let result = request(handle);
    _ = position.and_then(|position| nt::set_file_info(handle, position));
    result
}

/// For a request that does not depend on the file position.
pub(crate) fn with_handle<T>(
    fd: Fd,
    request: impl FnOnce(HANDLE) -> Result<T, Win32Error>,
) -> Result<T, Win32Error> {
    let _guard = lock_position(fd, None)?;
    request(check_handle(fd.native())?)
}

#[cfg(test)]
mod tests {
    use std::os::windows::io::{IntoRawHandle, OwnedHandle};

    use super::super::{PipeDirection, PipeMode, create_pipe_pair, open_osfhandle};
    use super::*;
    use crate::File;

    fn into_crt_file(handle: impl IntoRawHandle) -> File {
        File::from_fd(Fd::from_crt(open_osfhandle(handle.into_raw_handle())))
    }

    fn open_disk_file() -> File {
        let path = bun_core::self_exe_path().unwrap();
        let file = File::open(path, crate::O::RDONLY, 0).unwrap();
        let handle: OwnedHandle = super::super::duplicate_handle(file.fd().native()).unwrap();
        into_crt_file(handle)
    }

    fn lock_address(guard: &MutexGuard<'static, ()>) -> *const () {
        &raw const **guard
    }

    #[test]
    fn duplicate_uses_origin_lock_until_origin_is_closed() {
        let file = open_disk_file();
        let first = File::from_fd(duplicate(file.fd()).unwrap());
        let second = File::from_fd(duplicate(first.fd()).unwrap());
        let descriptor = Descriptor::get(file.fd().crt()).unwrap();
        let duplicate_locks = || {
            [&first, &second]
                .map(|dup| lock_address(&lock_position(dup.fd(), None).unwrap().unwrap()))
        };
        let origin_lock = lock_address(&descriptor.lock_disk_file(file.fd()).unwrap());
        assert_eq!(duplicate_locks(), [origin_lock; 2]);
        drop(file);
        assert!(
            duplicate_locks()[0] == duplicate_locks()[1] && duplicate_locks()[0] != origin_lock
        );
        assert!(is_disk_file(second.fd()) && is_position_shared(second.fd()));
    }

    #[test]
    fn pipe_is_not_locked() {
        let mode = PipeMode::Synchronous;
        let pipe = into_crt_file(
            create_pipe_pair(mode, mode, PipeDirection::Duplex)
                .unwrap()
                .ours,
        );
        let dup = File::from_fd(duplicate(pipe.fd()).unwrap());
        assert!(
            !is_disk_file(pipe.fd()) && !is_disk_file(dup.fd()) && !is_position_shared(dup.fd())
        );
        let descriptor = Descriptor::get(pipe.fd().crt()).unwrap();
        assert!(descriptor.lock_disk_file(pipe.fd()).is_none());
    }

    #[test]
    fn close_changes_identity_and_invalidates_pinned_fd() {
        let file = open_disk_file();
        let fd = file.fd();
        let open_identity = fd_identity(file.fd());
        let pinned = pin_fd_generation(fd).unwrap();
        assert_eq!((fd_identity(fd), pinned.crt()), (open_identity, fd.crt()));
        assert_eq!(with_position_locked(pinned, Ok), Ok(fd.native()));
        drop(file);
        assert_ne!(fd_identity(fd), open_identity);
        assert_eq!(
            with_position_locked(pinned, Ok),
            Err(Win32Error::INVALID_HANDLE)
        );
        assert!(!try_close(pinned, || unreachable!()));
    }

    #[test]
    fn out_of_range_fd_fails_with_invalid_handle() {
        super::super::configure_error_handling();
        for fd in [-1, 8192, i32::MAX].map(Fd::from_crt) {
            assert!(!is_disk_file(fd));
            assert_eq!(
                with_position_locked(fd, |_| Ok(())),
                Err(Win32Error::INVALID_HANDLE)
            );
            assert_eq!(
                with_position_preserved(fd, |_| Ok(())),
                Err(Win32Error::INVALID_HANDLE)
            );
        }
    }
}

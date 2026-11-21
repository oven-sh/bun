//! What a descriptor stands for, and the lock for a request with an offset, which moves the position and has to put it back.

use core::sync::atomic::{AtomicU32, Ordering};
use std::os::windows::io::IntoRawHandle as _;

use bun_core::{DecodeWindows, FdKind, Mutex, MutexGuard};
use bun_windows_sys::externs::FILE_POSITION_INFORMATION;

use super::{FILE_TYPE_DISK, GetFileType, HANDLE, INVALID_HANDLE_VALUE, Win32Error, nt};
use crate::Fd;

type Result<T> = core::result::Result<T, Win32Error>;
type Lock = MutexGuard<'static, ()>;

/// C code opens and closes descriptors without a word, so an answer about one of those is not kept.
const UNANNOUNCED: u32 = 0;
const UNASKED: u32 = 1;
const DISK: u32 = 2;
const OTHER: u32 = 3;
const KIND_BITS: u32 = 2;
const KIND: u32 = (1 << KIND_BITS) - 1;

struct Descriptor {
    /// The kind, below a generation that goes up under `position` when the number is opened or closed.
    state: AtomicU32,
    position: Mutex<()>,
}

const NUMBER_BITS: u32 = 13;

/// One for each descriptor that the C runtime can have.
static DESCRIPTORS: [Descriptor; 1 << NUMBER_BITS] = [const {
    Descriptor {
        state: AtomicU32::new(UNANNOUNCED),
        position: Mutex::new(()),
    }
}; 1 << NUMBER_BITS];

/// For duplicates that outlive their descriptor. A prime number spreads the generations of one number.
static ORPHANS: [Mutex<()>; 61] = [const { Mutex::new(()) }; 61];

fn valid(handle: HANDLE) -> Result<HANDLE> {
    match handle {
        INVALID_HANDLE_VALUE => Err(Win32Error::INVALID_HANDLE),
        handle => Ok(handle),
    }
}

fn ask_is_disk(fd: Fd) -> bool {
    valid(fd.native()).is_ok_and(|handle| GetFileType(handle) == FILE_TYPE_DISK)
}

impl Descriptor {
    fn get(number: i32) -> Option<&'static Self> {
        DESCRIPTORS.get(number as usize)
    }

    fn generation(&self) -> u16 {
        (self.state.load(Ordering::Acquire) >> KIND_BITS) as u16
    }

    fn next_generation(&self, _: &Lock, kind: u32) {
        let next = (self.state.load(Ordering::Acquire) | KIND).wrapping_add(1);
        self.state.store(next | kind, Ordering::Release);
    }

    /// `None` if it is not a file on a disk.
    fn generation_on_disk(&self, fd: Fd) -> Option<u16> {
        let state = self.state.load(Ordering::Acquire);
        let mut kind = state & KIND;
        if kind == UNANNOUNCED || kind == UNASKED {
            let answer = if ask_is_disk(fd) { DISK } else { OTHER };
            if kind == UNASKED {
                let (known, order) = (state & !KIND | answer, Ordering::AcqRel);
                _ = (self.state).compare_exchange(state, known, order, Ordering::Acquire);
            }
            kind = answer;
        }
        (kind == DISK).then_some((state >> KIND_BITS) as u16)
    }

    fn lock_unless_closed(&'static self, generation: u16) -> Option<Lock> {
        let is_open = || self.generation() == generation;
        is_open()
            .then(|| self.position.lock())
            .filter(|_| is_open())
    }

    /// Only a file on a disk is locked: a request on a pipe may never end.
    fn lock(&'static self, fd: Fd) -> Option<Lock> {
        loop {
            if let lock @ Some(_) = self.lock_unless_closed(self.generation_on_disk(fd)?) {
                return lock;
            }
        }
    }
}

fn generation_of(origin: u32) -> u16 {
    (origin >> NUMBER_BITS) as u16
}

fn lock(fd: Fd, number: Option<i32>) -> Result<Option<Lock>> {
    let Some(origin) = fd.origin() else {
        return Ok(number.and_then(|number| Descriptor::get(number)?.lock(fd)));
    };
    let descriptor = &DESCRIPTORS[origin as usize % DESCRIPTORS.len()];
    match (
        descriptor.lock_unless_closed(generation_of(origin)),
        fd.kind(),
    ) {
        (None, FdKind::Crt) => Err(Win32Error::INVALID_HANDLE),
        (None, FdKind::System) => Ok(Some(ORPHANS[origin as usize % ORPHANS.len()].lock())),
        (lock, _) => Ok(lock),
    }
}

/// The descriptor that `fd` is, or is the standard handle of.
fn number_of(fd: Fd) -> Option<i32> {
    match fd.decode_windows() {
        DecodeWindows::Crt(number) => Some(number),
        DecodeWindows::Windows(handle) => (0..=2).find(|&it| Fd::from_crt(it).native() == handle),
    }
}

fn origin_on_disk(fd: Fd) -> Option<u32> {
    let number = number_of(fd)?;
    let generation = Descriptor::get(number)?.generation_on_disk(fd)?;
    Some(u32::from(generation) << NUMBER_BITS | number as u32)
}

/// For a number that the C runtime has just given out.
pub(crate) fn opened(number: i32) {
    if let Some(descriptor) = Descriptor::get(number) {
        descriptor.next_generation(&descriptor.position.lock(), UNASKED);
    }
}

/// Whether `close` has closed it.
pub(crate) fn closing(fd: Fd, close: impl FnOnce() -> bool) -> bool {
    let Some(descriptor) = Descriptor::get(fd.crt()) else {
        return false;
    };
    let lock = descriptor.position.lock();
    if (fd.origin()).is_some_and(|origin| generation_of(origin) != descriptor.generation()) {
        return false;
    }
    descriptor.next_generation(&lock, UNANNOUNCED);
    close()
}

/// Waits for nobody, and asks the system once for each descriptor.
pub fn is_disk(fd: Fd) -> bool {
    match number_of(fd).and_then(Descriptor::get) {
        Some(descriptor) => descriptor.generation_on_disk(fd).is_some(),
        None => fd.origin().is_some() || ask_is_disk(fd),
    }
}

/// Another one once the descriptor was closed, though the number comes again.
pub fn identity(fd: Fd) -> u64 {
    let Some(number) = number_of(fd) else {
        return fd.0;
    };
    let state = Descriptor::get(number).map_or(0, |it| it.state.load(Ordering::Acquire));
    1 << 63 | u64::from(state >> KIND_BITS) << 32 | u64::from(number as u32)
}

/// Whether a script can see the position.
pub(crate) fn is_shared(fd: Fd) -> bool {
    fd.origin().is_some() || number_of(fd).is_some()
}

/// `fd` in a form that is `EBADF` once it was closed. `None` if it is not a file on a disk.
pub fn pinned(fd: Fd) -> Option<Fd> {
    origin_on_disk(fd).map(|origin| fd.with_origin(origin))
}

/// It has the position of `fd`, and so takes the same lock.
pub(crate) fn duplicate(fd: Fd) -> Result<Fd> {
    let origin = fd.origin().or_else(|| origin_on_disk(fd));
    let duplicate = Fd::from_system(super::duplicate_handle(fd.native())?.into_raw_handle());
    Ok(origin.map_or(duplicate, |origin| duplicate.with_origin(origin)))
}

/// For a `request` that starts at the position. The owner of a `HANDLE` makes one at a time.
pub(crate) fn using<T>(fd: Fd, request: impl FnOnce(HANDLE) -> Result<T>) -> Result<T> {
    let _lock = lock(fd, (fd.kind() == FdKind::Crt).then(|| fd.crt()))?;
    request(valid(fd.native())?)
}

/// For a `request` that names an offset.
pub(crate) fn keeping<T>(fd: Fd, request: impl FnOnce(HANDLE) -> Result<T>) -> Result<T> {
    let number = number_of(fd);
    let lock = lock(fd, number)?;
    let handle = valid(fd.native())?;
    if lock.is_none() && (number.is_some() || !ask_is_disk(fd)) {
        return request(handle);
    }
    let position = nt::query::<FILE_POSITION_INFORMATION>(handle);
    let result = request(handle);
    _ = position.and_then(|position| nt::set(handle, position));
    result
}

/// For a `request` that does not care about the position.
pub(crate) fn ignoring<T>(fd: Fd, request: impl FnOnce(HANDLE) -> Result<T>) -> Result<T> {
    let _lock = lock(fd, None)?;
    request(valid(fd.native())?)
}

#[cfg(test)]
mod tests {
    use std::os::windows::io::{IntoRawHandle, OwnedHandle};

    use super::super::{PipeDirection, PipeMode, open_osfhandle, pipe_pair};
    use super::*;
    use crate::File;

    fn descriptor_of(handle: impl IntoRawHandle) -> File {
        File::from_fd(Fd::from_crt(open_osfhandle(handle.into_raw_handle())))
    }

    fn file_on_disk() -> File {
        let path = bun_core::self_exe_path().unwrap();
        let file = File::open(path, crate::O::RDONLY, 0).unwrap();
        let handle: OwnedHandle = super::super::duplicate_handle(file.fd().native()).unwrap();
        descriptor_of(handle)
    }

    fn which(lock: &Lock) -> *const () {
        &raw const **lock
    }

    #[test]
    fn a_duplicate_has_the_lock_of_its_descriptor_until_that_is_closed() {
        let file = file_on_disk();
        let first = File::from_fd(duplicate(file.fd()).unwrap());
        let second = File::from_fd(duplicate(first.fd()).unwrap());
        let descriptor = Descriptor::get(file.fd().crt()).unwrap();
        let locks = || [&first, &second].map(|it| which(&lock(it.fd(), None).unwrap().unwrap()));
        let its_lock = which(&descriptor.lock(file.fd()).unwrap());
        assert_eq!(locks(), [its_lock; 2]);
        drop(file);
        assert!(locks()[0] == locks()[1] && locks()[0] != its_lock);
        assert!(is_disk(second.fd()) && is_shared(second.fd()));
    }

    #[test]
    fn a_pipe_is_not_locked() {
        let mode = PipeMode::Synchronous;
        let pipe = descriptor_of(pipe_pair(mode, mode, PipeDirection::Duplex).unwrap().ours);
        let again = File::from_fd(duplicate(pipe.fd()).unwrap());
        assert!(!is_disk(pipe.fd()) && !is_disk(again.fd()) && !is_shared(again.fd()));
        let descriptor = Descriptor::get(pipe.fd().crt()).unwrap();
        assert!(descriptor.lock(pipe.fd()).is_none());
    }

    #[test]
    fn the_identity_ends_with_the_descriptor() {
        let file = file_on_disk();
        let (fd, before) = (file.fd(), identity(file.fd()));
        let pinned = pinned(fd).unwrap();
        assert_eq!((identity(fd), pinned.crt()), (before, fd.crt()));
        assert_eq!(using(pinned, Ok), Ok(fd.native()));
        drop(file);
        assert_ne!(identity(fd), before);
        assert_eq!(using(pinned, Ok), Err(Win32Error::INVALID_HANDLE));
        assert!(!closing(pinned, || unreachable!()));
    }

    #[test]
    fn numbers_that_cannot_be_open() {
        super::super::report_errors_to_callers();
        for fd in [-1, 8192, i32::MAX].map(Fd::from_crt) {
            assert!(!is_disk(fd));
            assert_eq!(using(fd, |_| Ok(())), Err(Win32Error::INVALID_HANDLE));
            assert_eq!(keeping(fd, |_| Ok(())), Err(Win32Error::INVALID_HANDLE));
        }
    }
}

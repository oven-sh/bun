//! Bytes from one process to another, through memory that both can write to. Nothing in it is trusted.

use std::os::fd::{AsRawFd as _, FromRawFd as _, OwnedFd};
use std::sync::Arc;
use std::sync::atomic::Ordering::SeqCst;
use std::sync::atomic::{AtomicU32, AtomicU64};

#[repr(C, align(128))]
struct Positions {
    written: AtomicU64,
    /// What is before it was skipped.
    start: AtomicU64,
    read: AtomicU64,
    consumer_sleeps: AtomicU32,
    producer_waits: AtomicU32,
}

const CAPACITIES: [usize; 3] = [4 << 20, 1 << 20, 1 << 20];
const HEADER: usize = 1 << 14;
const SIZE: usize = HEADER + CAPACITIES[0] + CAPACITIES[1] + CAPACITIES[2];

pub struct Shared(*mut u8);

// SAFETY: it is only accessed with atomics and copies.
unsafe impl Send for Shared {}
// SAFETY: as above.
unsafe impl Sync for Shared {}

#[cfg(not(target_os = "macos"))]
fn anonymous_file() -> Option<OwnedFd> {
    // SAFETY: a C string. The descriptor is nobody else's.
    unsafe {
        let file = libc::memfd_create(
            c"bun:desktop".as_ptr(),
            libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
        );
        let file = (file >= 0).then(|| OwnedFd::from_raw_fd(file))?;
        let seals = libc::F_SEAL_SHRINK | libc::F_SEAL_GROW | libc::F_SEAL_SEAL;
        (libc::ftruncate(file.as_raw_fd(), SIZE as _) == 0
            && libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, seals) == 0)
            .then_some(file)
    }
}

/// Its size can only be set once.
#[cfg(target_os = "macos")]
fn anonymous_file() -> Option<OwnedFd> {
    let name = std::ffi::CString::new(format!("/bun{:x}.{:x}", std::process::id(), super::clock()))
        .ok()?;
    // SAFETY: as above.
    unsafe {
        let file = libc::shm_open(
            name.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL,
            0o600,
        );
        let file = (file >= 0).then(|| OwnedFd::from_raw_fd(file))?;
        libc::shm_unlink(name.as_ptr());
        (libc::ftruncate(file.as_raw_fd(), SIZE as _) == 0).then_some(file)
    }
}

impl Shared {
    pub fn create() -> Option<(Arc<Shared>, OwnedFd)> {
        let file = anonymous_file()?;
        Some((Shared::map(&file)?, file))
    }

    pub fn map(file: &OwnedFd) -> Option<Arc<Shared>> {
        // SAFETY: a new mapping of a file that has this size for good.
        let start = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                SIZE,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                file.as_raw_fd(),
                0,
            )
        };
        (start != libc::MAP_FAILED).then(|| Arc::new(Shared(start.cast())))
    }
}

impl Shared {
    /// How often what a page remembers has changed.
    pub fn times_outdated(&self) -> &AtomicU32 {
        // SAFETY: it is in the header, behind the positions, and all bytes are a value.
        unsafe { &*self.0.cast::<Positions>().add(CAPACITIES.len()).cast() }
    }
}

impl Drop for Shared {
    fn drop(&mut self) {
        // SAFETY: nothing refers to it any more.
        unsafe { libc::munmap(self.0.cast(), SIZE) };
    }
}

struct Ring {
    shared: Arc<Shared>,
    index: usize,
    offset: usize,
}

impl Ring {
    fn new(shared: &Arc<Shared>, index: usize) -> Ring {
        Ring {
            shared: shared.clone(),
            index,
            offset: HEADER + CAPACITIES[..index].iter().sum::<usize>(),
        }
    }

    fn capacity(&self) -> u64 {
        CAPACITIES[self.index] as u64
    }

    fn positions(&self) -> &Positions {
        // SAFETY: the header has room for them, and all bytes are a value.
        unsafe { &*self.shared.0.cast::<Positions>().add(self.index) }
    }

    /// `copy` gets a place in the ring, an offset and a length, for each of the two parts. `length` is at most the capacity.
    fn parts(&self, position: u64, length: usize, mut copy: impl FnMut(*mut u8, usize, usize)) {
        let (at, start) = (
            (position % self.capacity()) as usize,
            self.shared.0.wrapping_add(self.offset),
        );
        let first = length.min(CAPACITIES[self.index] - at);
        copy(start.wrapping_add(at), 0, first);
        copy(start, first, length - first);
    }
}

pub struct Producer {
    ring: Ring,
    written: u64,
    published: u64,
    start: u64,
}

impl Producer {
    pub fn new(shared: &Arc<Shared>, index: usize) -> Producer {
        Producer {
            ring: Ring::new(shared, index),
            written: 0,
            published: 0,
            start: 0,
        }
    }

    pub fn room(&self) -> usize {
        let used = self
            .written
            .wrapping_sub(self.ring.positions().read.load(SeqCst).max(self.start));
        self.ring.capacity().saturating_sub(used) as usize
    }

    /// Returns how many there was room for.
    ///
    /// # Safety
    /// That many are readable.
    pub unsafe fn push(&mut self, bytes: *const u8, length: usize) -> usize {
        let room = self.room();
        // Only as much memory gets used as is needed at once.
        if room as u64 == self.ring.capacity() && !self.written.is_multiple_of(self.ring.capacity())
        {
            self.written = self.written.next_multiple_of(self.ring.capacity());
            self.start = self.written;
            self.ring.positions().start.store(self.start, SeqCst);
        }
        let length = length.min(room);
        // SAFETY: the caller's contract, and that of `parts`.
        self.ring
            .parts(self.written, length, |to, at, length| unsafe {
                to.copy_from_nonoverlapping(bytes.add(at), length)
            });
        self.written += length as u64;
        length
    }

    /// Returns whether the consumer has to be woken.
    pub fn publish(&mut self) -> bool {
        if std::mem::replace(&mut self.published, self.written) == self.written {
            return false;
        }
        self.ring.positions().written.store(self.written, SeqCst);
        self.ring.positions().consumer_sleeps.swap(0, SeqCst) != 0
    }

    /// Returns whether it still has to. If so, the consumer says when there is room.
    pub fn will_wait(&self) -> bool {
        self.ring.positions().producer_waits.store(1, SeqCst);
        self.room() == 0
    }
}

pub struct Consumer {
    ring: Ring,
    read: u64,
}

impl Consumer {
    pub fn new(shared: &Arc<Shared>, index: usize) -> Consumer {
        Consumer {
            ring: Ring::new(shared, index),
            read: 0,
        }
    }

    /// `None` if that cannot be.
    pub fn available(&mut self) -> Option<usize> {
        let (written, start) = (
            self.ring.positions().written.load(SeqCst),
            self.ring.positions().start.load(SeqCst),
        );
        if (self.read..=written).contains(&start) {
            self.read = start;
        }
        written
            .checked_sub(self.read)
            .filter(|it| *it <= self.ring.capacity())
            .map(|it| it as usize)
    }

    /// Returns how many there were.
    ///
    /// # Safety
    /// That many are writable.
    pub unsafe fn pull(&mut self, to: *mut u8, length: usize) -> Option<usize> {
        let length = length.min(self.available()?);
        // SAFETY: the caller's contract, and that of `parts`.
        self.ring
            .parts(self.read, length, |from, at, length| unsafe {
                to.add(at).copy_from_nonoverlapping(from, length)
            });
        self.read += length as u64;
        Some(length)
    }

    /// Of what was pulled. Returns whether the producer has to be told.
    pub fn release(&self) -> bool {
        let positions = self.ring.positions();
        positions.read.store(self.read, SeqCst);
        positions.producer_waits.load(SeqCst) != 0 && positions.producer_waits.swap(0, SeqCst) != 0
    }

    /// Returns whether it still may.
    pub fn will_sleep(&mut self) -> bool {
        self.ring.positions().consumer_sleeps.store(1, SeqCst);
        self.available() == Some(0)
    }

    pub fn is_awake(&self) {
        self.ring.positions().consumer_sleeps.store(0, SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_arrive_in_order() {
        let (shared, _) = Shared::create().unwrap();
        let (mut producer, mut consumer) = (Producer::new(&shared, 1), Consumer::new(&shared, 1));
        let bytes: Vec<u8> = (0..700_000u32).map(|it| (it % 251) as u8).collect();
        let (mut sent, mut received) = (0, Vec::new());
        for round in 0..40 {
            let from = &bytes[sent % 251..][..600_000];
            // SAFETY: slices.
            sent += unsafe { producer.push(from.as_ptr(), from.len()) };
            producer.publish();
            let mut to = vec![0; [100, 900_000, 2_000_000][round % 3]];
            // SAFETY: as above.
            let length = unsafe { consumer.pull(to.as_mut_ptr(), to.len()) }.unwrap();
            consumer.release();
            received.extend_from_slice(&to[..length]);
        }
        assert!(
            received.len() > 10_000_000
                && (0..)
                    .zip(received)
                    .all(|(at, it): (u32, u8)| it == (at % 251) as u8)
        );
    }

    #[test]
    fn positions_are_checked() {
        let (shared, _) = Shared::create().unwrap();
        let (mut producer, mut consumer) = (Producer::new(&shared, 1), Consumer::new(&shared, 1));
        consumer
            .ring
            .positions()
            .written
            .store((1 << 20) + 1, SeqCst);
        assert_eq!(consumer.available(), None);
        consumer.ring.positions().read.store(u64::MAX, SeqCst);
        let bytes = vec![0; 2 << 20];
        // SAFETY: a slice.
        assert!(unsafe { producer.push(bytes.as_ptr(), bytes.len()) } <= 1 << 20);
    }
}

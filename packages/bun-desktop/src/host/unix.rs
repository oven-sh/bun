use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Duration;

pub struct Pipe([AtomicI32; 2]);

/// Wakes the thread that runs JavaScript.
pub static WAKE: Pipe = Pipe::new();

impl Pipe {
    pub const fn new() -> Pipe {
        Pipe([AtomicI32::new(-1), AtomicI32::new(-1)])
    }

    pub fn open(&self) {
        let mut ends = [-1; 2];
        // SAFETY: room for two descriptors, which are then this function's.
        unsafe {
            assert_eq!(libc::pipe(ends.as_mut_ptr()), 0, "could not create a pipe");
            for end in ends {
                libc::fcntl(end, libc::F_SETFD, libc::FD_CLOEXEC);
                libc::fcntl(end, libc::F_SETFL, libc::O_NONBLOCK);
            }
        }
        self.0
            .iter()
            .zip(ends)
            .for_each(|(stored, end)| stored.store(end, Ordering::Relaxed));
    }

    pub fn write(&self) {
        // SAFETY: one readable byte. A full pipe wakes as well.
        unsafe { libc::write(self.0[1].load(Ordering::Relaxed), [0u8].as_ptr().cast(), 1) };
    }

    pub fn fd(&self) -> i32 {
        self.0[0].load(Ordering::Relaxed)
    }

    pub fn clear(&self) {
        let mut buffer = [0u8; 64];
        // SAFETY: the buffer and its length.
        while unsafe { libc::read(self.fd(), buffer.as_mut_ptr().cast(), buffer.len()) }
            == buffer.len() as isize
        {}
    }
}

pub fn wake() {
    WAKE.write();
}

/// Returns whether `source` is readable.
#[cfg(target_os = "macos")]
pub fn poll(pipe: &Pipe, source: Option<isize>, timeout: Option<Duration>) -> bool {
    let (source, wake) = (source.map(|source| source as i32), pipe.fd());
    let timeout = timeout.map(|it| it + Duration::from_nanos(999));
    let mut timeout = timeout.map(|it| libc::timeval {
        tv_sec: it.as_secs() as _,
        tv_usec: it.subsec_micros() as _,
    });
    let (timeout, none) = (
        timeout
            .as_mut()
            .map_or(std::ptr::null_mut(), std::ptr::from_mut),
        std::ptr::null_mut(),
    );
    unsafe extern "C" {
        /// For any number of descriptors.
        #[link_name = "select$DARWIN_EXTSN"]
        fn select(
            count: i32,
            read: *mut u32,
            write: *mut u32,
            error: *mut u32,
            timeout: *mut libc::timeval,
        ) -> i32;
    }
    let count = source.unwrap_or(0).max(wake) + 1;
    let mut set: crate::small_vec::SmallVec<u32, 8> =
        std::iter::repeat_n(0, count as usize / 32 + 1).collect();
    source
        .into_iter()
        .chain([wake])
        .for_each(|fd| set[fd as usize / 32] |= 1 << (fd % 32));
    // SAFETY: a bit for each.
    let result = unsafe { select(count, set.as_mut_ptr(), none, none, timeout) };
    let is_set = |fd: i32| set[fd as usize / 32] & 1 << (fd % 32) != 0;
    if result > 0 && is_set(wake) {
        pipe.clear();
    }
    // A signal is for the event loop to look at.
    result < 0 || source.is_some_and(is_set)
}

/// Returns whether `source` is readable, and keeps the `others` that are.
#[cfg(not(target_os = "macos"))]
pub fn poll(
    pipe: &Pipe,
    source: Option<isize>,
    others: &mut Vec<i32>,
    timeout: Option<Duration>,
) -> bool {
    let entry = |fd| libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let first = [source.map_or(-1, |source| source as i32), pipe.fd()];
    let mut entries: crate::small_vec::SmallVec<_, 8> =
        first.iter().chain(&*others).copied().map(entry).collect();
    let timeout = timeout.map(|it| libc::timespec {
        tv_sec: it.as_secs() as _,
        tv_nsec: it.subsec_nanos() as _,
    });
    let timeout = timeout
        .as_ref()
        .map_or(std::ptr::null(), std::ptr::from_ref);
    // SAFETY: the array and its length.
    let result = unsafe {
        libc::ppoll(
            entries.as_mut_ptr(),
            entries.len() as _,
            timeout,
            std::ptr::null(),
        )
    };
    if entries[1].revents != 0 {
        pipe.clear();
    }
    others.retain(|fd| {
        entries[2..]
            .iter()
            .any(|it| it.fd == *fd && it.revents != 0)
    });
    // A signal is for the event loop to look at.
    result < 0 || entries[0].revents != 0
}

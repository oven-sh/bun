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

/// Returns whether `source` is readable. The system puts off the end of a `select` or a `poll` by up to 75 ms to save energy.
#[cfg(target_os = "macos")]
pub fn poll(pipe: &Pipe, source: Option<isize>, timeout: Option<Duration>) -> bool {
    use std::cell::Cell;
    let change = |fd: isize, flags| libc::kevent {
        ident: fd as usize,
        filter: libc::EVFILT_READ,
        flags,
        fflags: 0,
        data: 0,
        udata: std::ptr::null_mut(),
    };
    thread_local! {
        /// And what it watches.
        static QUEUE: Cell<(i32, Option<isize>)> = const { Cell::new((-1, None)) };
    }
    let (mut queue, watched) = QUEUE.get();
    let timeout = timeout.map(|it| libc::timespec {
        tv_sec: it.as_secs() as _,
        tv_nsec: it.subsec_nanos() as _,
    });
    let mut ready = [change(-1, 0); 2];
    // SAFETY: arrays with their lengths.
    let count = unsafe {
        let apply = |queue, change| {
            libc::kevent(queue, &change, 1, std::ptr::null_mut(), 0, std::ptr::null())
        };
        if queue < 0 {
            queue = libc::kqueue();
            apply(queue, change(pipe.fd() as isize, libc::EV_ADD));
        }
        if watched != source {
            watched.map(|it| apply(queue, change(it, libc::EV_DELETE)));
            source.map(|it| apply(queue, change(it, libc::EV_ADD)));
        }
        QUEUE.set((queue, source));
        libc::kevent(
            queue,
            std::ptr::null(),
            0,
            ready.as_mut_ptr(),
            2,
            timeout
                .as_ref()
                .map_or(std::ptr::null(), std::ptr::from_ref),
        )
    };
    let is_ready = |fd: isize| ready.iter().any(|it| it.ident == fd as usize);
    if is_ready(pipe.fd() as isize) {
        pipe.clear();
    }
    // A signal is for the event loop to look at.
    count < 0 || source.is_some_and(is_ready)
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

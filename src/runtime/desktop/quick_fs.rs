//! Looking a path up on a local disk takes less time than handing it to the thread pool and being woken up again.

use core::cell::{Cell, RefCell};
use std::time::{Duration, Instant};

use bun_core::strings;

/// The next one goes to the pool, which is what lets the event loop get to the window system.
const PER_TURN: u8 = 48;
const SLOW: Duration = Duration::from_millis(4);
const FIRST_PAUSE: Duration = Duration::from_secs(1);
const LONGEST_PAUSE: Duration = Duration::from_secs(64);
const MOUNTS_LAST: Duration = Duration::from_secs(10);

/// A lookup there can wait for a server or for a file provider.
const REMOTE_PREFIXES: [&[u8]; 8] = [
    b"/Volumes/",
    b"/System/Volumes/Data/home",
    b"/Network/",
    b"/net/",
    b"/mnt/",
    b"/media/",
    b"/run/user/",
    b"/$bunfs/",
];
const REMOTE_FOLDERS: [&[u8]; 2] = [b"/Library/CloudStorage", b"/Library/Mobile Documents"];

struct Mounts {
    read_at: Instant,
    remote: Vec<Box<[u8]>>,
}

thread_local! {
    static LEFT: Cell<u8> = const { Cell::new(0) };
    static LAST_PAUSE: Cell<Option<(Instant, Duration)>> = const { Cell::new(None) };
    static MOUNTS: RefCell<Option<Mounts>> = const { RefCell::new(None) };
}

pub(super) fn begin_turn() {
    LEFT.set(PER_TURN);
}

#[inline]
pub(crate) fn is_on() -> bool {
    LEFT.get() > 0
}

/// `None` if `look_up` is for the pool, or says so.
pub(crate) fn try_now<R>(path: &[u8], look_up: impl FnOnce() -> Option<R>) -> Option<R> {
    let start = begin(path)?;
    let result = look_up();
    pause_if_slow(start);
    result
}

fn begin(path: &[u8]) -> Option<Instant> {
    let start = Instant::now();
    if LAST_PAUSE
        .get()
        .is_some_and(|(at, length)| start - at < length)
        || !is_local(path, start)
    {
        return None;
    }
    LEFT.set(LEFT.get() - 1);
    Some(start)
}

fn pause_if_slow(start: Instant) {
    let end = Instant::now();
    if end - start > SLOW {
        let length = match LAST_PAUSE.get() {
            Some((at, length)) if end - at < length * 4 => LONGEST_PAUSE.min(length * 4),
            _ => FIRST_PAUSE,
        };
        LAST_PAUSE.set(Some((end, length)));
    }
}

fn is_local(path: &[u8], now: Instant) -> bool {
    if !path.starts_with(b"/")
        || REMOTE_PREFIXES.iter().any(|it| path.starts_with(it))
        || REMOTE_FOLDERS.iter().any(|it| strings::contains(path, it))
    {
        return false;
    }
    MOUNTS.with_borrow_mut(|mounts| {
        mounts.take_if(|it| now - it.read_at > MOUNTS_LAST);
        let mounts = mounts.get_or_insert_with(|| Mounts {
            read_at: now,
            remote: remote_mounts(),
        });
        !mounts.remote.iter().any(|it| path.starts_with(it))
    })
}

#[cfg(target_os = "macos")]
fn remote_mounts() -> Vec<Box<[u8]>> {
    const MAX: usize = 64;
    let mut all = Vec::<libc::statfs>::with_capacity(MAX);
    // SAFETY: room for `MAX` entries, of which the call fills as many as it returns.
    unsafe {
        let size = (MAX * size_of::<libc::statfs>()) as i32;
        let count = libc::getfsstat(all.as_mut_ptr(), size, libc::MNT_NOWAIT);
        if count <= 0 || count as usize >= MAX {
            return vec![Box::from(&b"/"[..])];
        }
        all.set_len(count as usize);
    }
    all.iter()
        .filter(|it| it.f_flags & libc::MNT_LOCAL as u32 == 0)
        // SAFETY: a C string, in an entry that the call filled.
        .map(|it| Box::from(unsafe { bun_core::ffi::cstr(it.f_mntonname.as_ptr()) }.to_bytes()))
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn remote_mounts() -> Vec<Box<[u8]>> {
    const LOCAL: [&[u8]; 9] = [
        b"ext4",
        b"ext3",
        b"xfs",
        b"btrfs",
        b"f2fs",
        b"zfs",
        b"tmpfs",
        b"overlay",
        b"bcachefs",
    ];
    let Ok(table) = bun_sys::File::read_from(bun_sys::Fd::cwd(), b"/proc/self/mounts") else {
        return vec![Box::from(&b"/"[..])];
    };
    strings::tokenize(&table, b"\n")
        .filter_map(|line| {
            let mut fields = strings::tokenize(line, b" ").skip(1);
            let (target, kind) = (fields.next()?, fields.next()?);
            // What follows a backslash is escaped.
            let end = strings::index_of_char_usize(target, b'\\').unwrap_or(target.len());
            (!LOCAL.contains(&kind)).then(|| Box::from(&target[..end]))
        })
        .collect()
}

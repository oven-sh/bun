//! `stat` from what the kernel holds in memory: no read from a disk and no request to a server (Linux 5.12).

use core::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};

use bun_core::{ZStr, strings};

use crate::linux_syscall::{self, ResolveFlags};
use crate::{CloseOnDrop, Fd, O, PosixStat};

bun_core::declare_scope!(fs_cached, hidden);

/// Whether the last component of the path is followed if it is a symlink.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Symlink {
    Follow,
    NoFollow,
}

/// Why [`stat`] has no attributes to give.
pub enum NoStat {
    /// The kernel remembers that the path has no entry.
    NotFound,
    /// The kernel was asked and cannot tell without a wait: not cached, a mount point on the way, or a symlink it must read.
    Unknown,
    /// The kernel was not asked: the walk would not start on a mount that answers from memory.
    NotAsked,
}

const UNCHECKED: u8 = 0;
const AVAILABLE: u8 = 1;
const UNAVAILABLE: u8 = 2;
/// Whether the kernel honours `RESOLVE_CACHED`: [`learn_mounts`] finds out.
static AVAILABILITY: AtomicU8 = AtomicU8::new(UNCHECKED);

/// Whether [`stat`] can answer: [`learn_mounts`] found `openat2(RESOLVE_CACHED)` honoured and no flag turns it off.
#[inline]
pub fn is_available() -> bool {
    AVAILABILITY.load(Ordering::Relaxed) == AVAILABLE
}

fn open(path: &ZStr, symlink: Symlink, resolve: ResolveFlags) -> Result<Fd, i32> {
    let nofollow = match symlink {
        Symlink::Follow => 0,
        Symlink::NoFollow => O::NOFOLLOW,
    };
    linux_syscall::openat2(Fd::cwd(), path, O::PATH | O::CLOEXEC | nofollow, 0, resolve)
}

/// In blocks of 512 bytes: what a `close` here may free of a file removed meanwhile (0.1 ms per MiB, more if the journal is busy).
const CLOSED_HERE: u64 = (1 << 20) / 512;

/// `stat` or `lstat` of `path` without a wait. `close_elsewhere` gets a descriptor whose `close` can take long.
pub fn stat(
    path: &ZStr,
    symlink: Symlink,
    mask: u32,
    close_elsewhere: impl FnOnce(Fd),
) -> Result<PosixStat, NoStat> {
    if !is_available() || !crate::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
        return Err(NoStat::NotAsked);
    }
    let (start, generation) = match path.as_bytes().first() {
        Some(b'/') => (&ROOT, 0),
        _ => (&CWD, CWD_GENERATION.load(Ordering::SeqCst)),
    };
    let Mount::InMemory(mount) = start.load(generation) else {
        return Err(NoStat::NotAsked);
    };
    let file = match open(path, symlink, ResolveFlags::CACHED | ResolveFlags::NO_XDEV) {
        Ok(fd) => CloseOnDrop::new(fd),
        Err(libc::ENOENT) => return Err(NoStat::NotFound),
        Err(libc::ENOSYS) => {
            // A seccomp policy that came after `learn_mounts`.
            AVAILABILITY.store(UNAVAILABLE, Ordering::Relaxed);
            return Err(NoStat::Unknown);
        }
        Err(_) => return Err(NoStat::Unknown),
    };
    let Some((stat, on_mount)) = crate::fstatx_in_memory(file.fd(), mask) else {
        close_elsewhere(file.into_raw());
        return Err(NoStat::Unknown);
    };
    if on_mount != u64::from(mount) {
        // The root or the working directory changed behind this module (`chroot`, a native `chdir`).
        start.forget();
        close_elsewhere(file.into_raw());
        return Err(NoStat::Unknown);
    }
    if stat.nlink == 0 {
        close_elsewhere(file.into_raw());
        return Err(NoStat::Unknown);
    }
    if stat.blocks > CLOSED_HERE {
        close_elsewhere(file.into_raw());
    }
    Ok(stat)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mount {
    Unknown,
    /// The mount with this id answers `statx` from memory.
    InMemory(u32),
    Other,
}

/// The mount of a directory that walks start at, in one word: bits 0-1 kind of [`Mount`], 2-33 id, 34-63 generation.
struct Start(AtomicU64, AtomicU8);

const GENERATION_BITS: u32 = 30;

impl Start {
    fn load(&self, generation: u32) -> Mount {
        let word = self.0.load(Ordering::SeqCst);
        if word >> 34 != u64::from(generation & ((1 << GENERATION_BITS) - 1)) {
            return Mount::Unknown;
        }
        match word & 0b11 {
            1 => Mount::InMemory((word >> 2) as u32),
            2 => Mount::Other,
            _ => Mount::Unknown,
        }
    }

    fn store(&self, generation: u32, mount: Mount) {
        let (kind, id) = match mount {
            Mount::Unknown => (0, 0),
            Mount::InMemory(id) => (1, id),
            Mount::Other => (2, 0),
        };
        let generation = u64::from(generation & ((1 << GENERATION_BITS) - 1));
        self.0.store(
            generation << 34 | u64::from(id) << 2 | kind,
            Ordering::SeqCst,
        );
        self.1.store(0, Ordering::Relaxed);
    }

    fn forget(&self) {
        self.0.store(0, Ordering::SeqCst);
    }

    /// Classifies the mount of `directory` if that is still to do. Three calls in a row that cannot tell make it `Other`.
    fn learn(&self, generation: impl Fn() -> u32, directory: &ZStr, root: Option<Mount>) {
        let before = generation();
        if self.load(before) != Mount::Unknown {
            return;
        }
        let classified = classify(directory, root);
        if generation() != before {
            return;
        }
        match classified {
            Ok(mount) => self.store(before, mount),
            Err(Unclassified::Translated) => AVAILABILITY.store(UNAVAILABLE, Ordering::Relaxed),
            Err(Unclassified::ThisTime) if self.1.fetch_add(1, Ordering::Relaxed) < 2 => {}
            Err(Unclassified::ThisTime) => self.store(before, Mount::Other),
        }
    }
}

static ROOT: Start = Start(AtomicU64::new(0), AtomicU8::new(0));
static CWD: Start = Start(AtomicU64::new(0), AtomicU8::new(0));
/// Counts the changes of the working directory: what [`CWD`] learned before one is void.
static CWD_GENERATION: AtomicU32 = AtomicU32::new(0);

/// After `chdir` has succeeded.
pub(crate) fn working_directory_changed() {
    CWD_GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// One thread learns at a time. Until it is done, [`stat`] does not ask.
static LEARNING: AtomicBool = AtomicBool::new(false);

/// Probes `RESOLVE_CACHED` and classifies the mounts of the root and of the working directory. May wait for a server.
#[inline]
pub fn learn_mounts() {
    let learned = match AVAILABILITY.load(Ordering::Relaxed) {
        _ if !crate::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) => true,
        UNAVAILABLE => true,
        AVAILABLE => {
            ROOT.load(0) != Mount::Unknown
                && CWD.load(CWD_GENERATION.load(Ordering::SeqCst)) != Mount::Unknown
        }
        _ => false,
    };
    if !learned && !LEARNING.swap(true, Ordering::Acquire) {
        learn();
        LEARNING.store(false, Ordering::Release);
    }
}

#[cold]
fn learn() {
    if AVAILABILITY.load(Ordering::Relaxed) == UNCHECKED {
        let Some(honoured) = kernel_honours_resolve_cached() else {
            return;
        };
        bun_core::scoped_log!(fs_cached, "RESOLVE_CACHED honoured: {}", honoured);
        if !honoured {
            return AVAILABILITY.store(UNAVAILABLE, Ordering::Relaxed);
        }
        AVAILABILITY.store(AVAILABLE, Ordering::Relaxed);
    }
    ROOT.learn(|| 0, bun_core::zstr!("/"), None);
    let generation = || CWD_GENERATION.load(Ordering::SeqCst);
    CWD.learn(generation, bun_core::zstr!("."), Some(ROOT.load(0)));
}

/// An error that says nothing about the kernel or the directory: the next caller asks again.
fn is_transient(errno: i32) -> bool {
    matches!(
        errno,
        libc::EAGAIN | libc::EINTR | libc::EMFILE | libc::ENFILE | libc::ENOMEM
    )
}

/// `None`: could not tell this time.
fn kernel_honours_resolve_cached() -> Option<bool> {
    use bun_core::env_var::feature_flag::{
        BUN_FEATURE_FLAG_DISABLE_ASYNC_FS_FAST_PATH as DISABLED,
        BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH as EXPERIMENTAL,
    };
    let enabled =
        bun_core::env::IS_CANARY || bun_core::env::IS_DEBUG || EXPERIMENTAL.get().unwrap_or(false);
    if !enabled || DISABLED.get().unwrap_or(false) {
        return Some(false);
    }
    // Fails without `openat2` (before Linux 5.6, Android, seccomp) and without `RESOLVE_CACHED` (before 5.12).
    match open(bun_core::zstr!("/"), Symlink::Follow, ResolveFlags::CACHED) {
        Ok(fd) => drop(CloseOnDrop::new(fd)),
        Err(errno) => return (!is_transient(errno)).then_some(false),
    }
    // The kernel cannot know that a name nothing looked up is missing. gVisor and PRoot ignore the flag and say so.
    let mut name = *b"/.bun-resolve-cached-0000000000000000\0";
    let digits = name.len() - 17..name.len() - 1;
    let random = bun_core::fast_random();
    for (i, digit) in name[digits].iter_mut().enumerate() {
        *digit = b"0123456789abcdef"[(random >> (i * 4) & 0xf) as usize];
    }
    match open(
        ZStr::from_slice_with_nul(&name),
        Symlink::NoFollow,
        ResolveFlags::CACHED,
    ) {
        Ok(fd) => {
            drop(CloseOnDrop::new(fd));
            Some(false)
        }
        Err(libc::EAGAIN) => Some(true),
        Err(errno) => (!is_transient(errno)).then_some(false),
    }
}

enum Unclassified {
    ThisTime,
    /// PRoot rewrites the path for `openat` and not for `openat2`: what the kernel answers is not this process's tree.
    Translated,
}

/// `root`: the mount of the root directory, which stays mounted while it is this process's root.
fn classify(directory: &ZStr, root: Option<Mount>) -> Result<Mount, Unclassified> {
    let this_time = |errno| match is_transient(errno) {
        true => Err(Unclassified::ThisTime),
        false => Ok(Mount::Other),
    };
    let plain = match crate::open(directory, O::PATH | O::DIRECTORY | O::CLOEXEC, 0) {
        Ok(fd) => CloseOnDrop::new(fd),
        Err(err) => return this_time(i32::from(err.errno)),
    };
    let resolve = ResolveFlags::CACHED | ResolveFlags::NO_XDEV;
    let cached = match open(directory, Symlink::Follow, resolve) {
        Ok(fd) => CloseOnDrop::new(fd),
        Err(errno) => return this_time(errno),
    };
    let mask = crate::STATX_MASK_FOR_STATS;
    let (Some(plain), Some(cached)) = (
        crate::fstatx_in_memory(plain.fd(), mask),
        crate::fstatx_in_memory(cached.fd(), mask),
    ) else {
        return Err(Unclassified::ThisTime);
    };
    if (cached.1, cached.0.dev, cached.0.ino) != (plain.1, plain.0.dev, plain.0.ino) {
        return Err(Unclassified::Translated);
    }
    let Ok(mount) = u32::try_from(plain.1) else {
        return Ok(Mount::Other);
    };
    if root != Some(Mount::InMemory(mount)) {
        let Ok(table) = crate::File::read_from(Fd::cwd(), b"/proc/self/mountinfo") else {
            return Ok(Mount::Other);
        };
        let filesystem = filesystem_of(&table, mount).unwrap_or_default();
        bun_core::scoped_log!(
            fs_cached,
            "{} is on mount {} ({})",
            bstr::BStr::new(directory.as_bytes()),
            mount,
            bstr::BStr::new(filesystem)
        );
        if !answers_from_memory(filesystem) {
            return Ok(Mount::Other);
        }
    }
    Ok(Mount::InMemory(mount))
}

/// The lines of a text of procfs, or the fields of one of its lines.
fn split(text: &[u8], separator: u8) -> impl Iterator<Item = &[u8]> {
    let mut rest = Some(text);
    core::iter::from_fn(move || {
        let text = rest?;
        let end = strings::index_of_char_usize(text, separator);
        rest = end.map(|end| &text[end + 1..]);
        Some(&text[..end.unwrap_or(text.len())])
    })
}

fn parse_id(digits: &[u8]) -> Option<u32> {
    if digits.is_empty() {
        return None;
    }
    digits.iter().try_fold(0u32, |id, digit| match digit {
        b'0'..=b'9' => id.checked_mul(10)?.checked_add(u32::from(digit - b'0')),
        _ => None,
    })
}

/// The filesystem type of a mount in `/proc/<pid>/mountinfo`: the id is the first field, the type follows the field `-`.
fn filesystem_of(mountinfo: &[u8], mount: u32) -> Option<&[u8]> {
    split(mountinfo, b'\n').find_map(|line| {
        let mut fields = split(line, b' ');
        if parse_id(fields.next()?) != Some(mount) {
            return None;
        }
        fields.find(|field| *field == b"-")?;
        fields.next()
    })
}

/// Drivers whose `getattr` only reads memory, by mount-table name (the `statfs` magic of a 9p mount is its server's).
fn answers_from_memory(filesystem: &[u8]) -> bool {
    matches!(
        filesystem,
        b"ext4" | b"ext3" | b"ext2" | b"xfs" | b"btrfs" | b"f2fs" | b"tmpfs" | b"overlay"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const TABLE: &[u8] = b"\
21 1 254:0 / / rw,relatime shared:1 - ext4 /dev/root rw\n\
59 21 0:27 / /mnt/with\\040space rw,relatime shared:30 master:2 - nfs4 127.0.0.1:/ rw,vers=4.0\n\
60 21 0:52 / /mnt/share rw,relatime - 9p share rw,trans=virtio,version=9p2000.L\n\
61 21 0:53 / /home/u/mnt rw,nosuid,nodev - fuse.sshfs host:/ rw,user_id=1000\n\
210 21 0:60 / /app rw,relatime - overlay overlay rw,lowerdir=/l,upperdir=/u,workdir=/w\n";

    #[test]
    fn filesystem_of_a_mount() {
        assert_eq!(filesystem_of(TABLE, 21), Some(&b"ext4"[..]));
        assert_eq!(filesystem_of(TABLE, 59), Some(&b"nfs4"[..]));
        assert_eq!(filesystem_of(TABLE, 60), Some(&b"9p"[..]));
        assert_eq!(filesystem_of(TABLE, 61), Some(&b"fuse.sshfs"[..]));
        assert_eq!(filesystem_of(TABLE, 210), Some(&b"overlay"[..]));
        assert_eq!(filesystem_of(TABLE, 2), None);
        assert_eq!(filesystem_of(b"21 1 254:0 / / rw\n", 21), None);
    }

    #[test]
    fn only_the_listed_drivers_answer_from_memory() {
        for (mount, expected) in [
            (21, true),
            (59, false),
            (60, false),
            (61, false),
            (210, true),
        ] {
            let filesystem = filesystem_of(TABLE, mount).unwrap();
            assert_eq!(answers_from_memory(filesystem), expected, "mount {mount}");
        }
        assert!(!answers_from_memory(b""));
    }

    #[test]
    fn mount_ids() {
        assert_eq!(parse_id(b"21"), Some(21));
        assert_eq!(parse_id(b""), None);
        assert_eq!(parse_id(b"2a"), None);
        assert_eq!(parse_id(b"99999999999"), None);
    }
}

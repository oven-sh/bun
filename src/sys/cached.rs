//! `stat` from what the kernel holds in memory: no read from a disk and no request to a server (Linux 5.12).

use core::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};

use bun_core::{ZStr, strings};

use crate::linux_syscall::{self, ResolveFlags};
use crate::{CloseOnDrop, Fd, O, PosixStat};

bun_core::declare_scope!(fs_cached, hidden);

/// Whether the walk follows symlinks, as `stat` does, or must meet none: `lstat` of a symlink is not answered here.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Symlink {
    Follow,
    Refuse,
}

/// Why [`stat`] has no attributes to give.
pub enum NoStat {
    /// The kernel remembers that the path has no entry.
    NotFound,
    /// The kernel was asked and cannot tell without a wait: not cached, a mount point on the way, or a symlink it must read.
    Unknown,
    /// The kernel refuses this path each time it is asked: a symlink where the walk may meet none.
    Refused,
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
    // `statx` of a symlink can read the disk (fscrypt decrypts the link for its size), so no descriptor of one is opened.
    let resolve = match symlink {
        Symlink::Follow => resolve,
        Symlink::Refuse => resolve | ResolveFlags::NO_SYMLINKS,
    };
    linux_syscall::openat2(Fd::cwd(), path, O::PATH | O::CLOEXEC, 0, resolve)
}

/// `stat` or `lstat` of `path` from the kernel's caches. `close_elsewhere` gets the descriptor: its `close` can free a removed file and wait for the disk.
pub fn stat(
    path: &ZStr,
    symlink: Symlink,
    mask: u32,
    close_elsewhere: impl FnOnce(Fd),
) -> Result<PosixStat, NoStat> {
    if !is_available() || !crate::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
        return Err(NoStat::NotAsked);
    }
    let is_relative = path.as_bytes().first() != Some(&b'/');
    let (start, generation) = match is_relative {
        false => (&ROOT, 0),
        true => match working_directory_generation() {
            Some(generation) => (&CWD, generation),
            None => return Err(NoStat::NotAsked),
        },
    };
    let Mount::InMemory(mount) = start.load(generation) else {
        return Err(NoStat::NotAsked);
    };
    let fd = match open(path, symlink, ResolveFlags::CACHED | ResolveFlags::NO_XDEV) {
        Ok(fd) => fd,
        Err(libc::ENOENT) => return Err(NoStat::NotFound),
        Err(libc::ELOOP) if symlink == Symlink::Refuse => return Err(NoStat::Refused),
        Err(libc::ENOSYS) => {
            // A seccomp policy that came after `learn_mounts`.
            AVAILABILITY.store(UNAVAILABLE, Ordering::Relaxed);
            return Err(NoStat::Unknown);
        }
        Err(_) => return Err(NoStat::Unknown),
    };
    // Another thread changes the working directory: the walk may have started in the new one, on a mount nobody classified.
    let raced = is_relative && working_directory_generation() != Some(generation);
    let stat = match raced {
        true => None,
        false => crate::fstatx_in_memory(fd, mask),
    };
    close_elsewhere(fd);
    let (stat, on_mount) = stat.ok_or(NoStat::Unknown)?;
    if on_mount != u64::from(mount) {
        // The root or the working directory changed behind this module (`chroot`, a native `chdir`).
        start.forget();
        return Err(NoStat::Unknown);
    }
    // A file that was removed meanwhile: the pool answers for the path.
    if stat.nlink == 0 {
        return Err(NoStat::Unknown);
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
    fn learn(&self, generation: fn() -> Option<u32>, directory: &ZStr, root: Option<Mount>) {
        let Some(before) = generation() else {
            return;
        };
        if self.load(before) != Mount::Unknown {
            return;
        }
        let classified = classify(directory, root);
        if generation() != Some(before) {
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
/// Counts the `chdir` calls of `bun_sys` that began: what [`CWD`] learned before one is void.
static CWD_CHANGES_BEGUN: AtomicU32 = AtomicU32::new(0);
static CWD_CHANGES_ENDED: AtomicU32 = AtomicU32::new(0);

/// Held across a `chdir`: a walk or a classification that overlaps one counts for no directory.
pub(crate) struct WorkingDirectoryChange(());

impl WorkingDirectoryChange {
    pub(crate) fn begin() -> Self {
        CWD_CHANGES_BEGUN.fetch_add(1, Ordering::SeqCst);
        Self(())
    }
}

impl Drop for WorkingDirectoryChange {
    fn drop(&mut self) {
        CWD_CHANGES_ENDED.fetch_add(1, Ordering::SeqCst);
    }
}

/// How many times the working directory changed, or `None` while a change is under way.
fn working_directory_generation() -> Option<u32> {
    // The ended ones first: a change that begins between the two loads makes them differ.
    let ended = CWD_CHANGES_ENDED.load(Ordering::SeqCst);
    let begun = CWD_CHANGES_BEGUN.load(Ordering::SeqCst);
    (ended == begun).then_some(begun)
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
                && working_directory_generation()
                    .is_some_and(|generation| CWD.load(generation) != Mount::Unknown)
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
    ROOT.learn(|| Some(0), bun_core::zstr!("/"), None);
    CWD.learn(
        working_directory_generation,
        bun_core::zstr!("."),
        Some(ROOT.load(0)),
    );
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
    use bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH as ENABLED;
    if !ENABLED.get().unwrap_or(false) {
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
        Symlink::Follow,
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
    // The driver first: `statx` of a directory on NFS or 9p can wait for its server.
    let mount = match mount_of(plain.fd()) {
        Ok(Some(mount)) => mount,
        Ok(None) => return Ok(Mount::Other),
        Err(errno) => return this_time(errno),
    };
    if root != Some(Mount::InMemory(mount)) {
        let table = match crate::File::read_from(Fd::cwd(), b"/proc/self/mountinfo") {
            Ok(table) => table,
            Err(err) => return this_time(i32::from(err.errno)),
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
    Ok(match plain.1 == u64::from(mount) {
        true => Mount::InMemory(mount),
        false => Mount::Other,
    })
}

/// The mount of a descriptor as procfs tells it: the filesystem of the descriptor is not asked. `Ok(None)`: procfs does not say.
fn mount_of(fd: Fd) -> Result<Option<u32>, i32> {
    use std::io::Write as _;
    let mut path = [0u8; 40];
    let mut rest = &mut path[..39];
    if write!(rest, "/proc/self/fdinfo/{}", fd.native()).is_err() {
        return Ok(None);
    }
    let length = 39 - rest.len();
    let path = ZStr::from_slice_with_nul(&path[..=length]);
    let fdinfo = match crate::open(path, O::RDONLY | O::CLOEXEC, 0) {
        Ok(fd) => CloseOnDrop::new(fd),
        Err(err) => return Err(i32::from(err.errno)),
    };
    let mut text = [0u8; 256];
    let length = crate::read(fdinfo.fd(), &mut text).map_err(|err| i32::from(err.errno))?;
    Ok(split(&text[..length], b'\n')
        .find_map(|line| parse_id(line.strip_prefix(b"mnt_id:")?.trim_ascii())))
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
    fn no_generation_while_the_working_directory_changes() {
        let before = working_directory_generation().unwrap();
        let first = WorkingDirectoryChange::begin();
        let second = WorkingDirectoryChange::begin();
        assert_eq!(working_directory_generation(), None);
        drop(first);
        assert_eq!(working_directory_generation(), None);
        drop(second);
        assert_eq!(working_directory_generation(), Some(before + 2));
    }

    #[test]
    fn a_start_answers_for_its_generation_only() {
        let start = Start(AtomicU64::new(0), AtomicU8::new(0));
        assert!(start.load(0) == Mount::Unknown);
        start.store(7, Mount::InMemory(u32::MAX));
        assert!(start.load(7) == Mount::InMemory(u32::MAX));
        assert!(start.load(8) == Mount::Unknown);
        start.store(8, Mount::Other);
        assert!(start.load(8) == Mount::Other);
        start.forget();
        assert!(start.load(8) == Mount::Unknown);
    }

    #[test]
    fn mount_ids() {
        assert_eq!(parse_id(b"21"), Some(21));
        assert_eq!(parse_id(b""), None);
        assert_eq!(parse_id(b"2a"), None);
        assert_eq!(parse_id(b"99999999999"), None);
    }
}

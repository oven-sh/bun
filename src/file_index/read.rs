//! Guarded by-name reads of worktree paths.
//!
//! A name inside an indexed tree is attacker-shaped: between the moment a
//! path was enumerated (or snapshotted) and the moment it is opened, it can
//! have been replaced by a symlink pointing anywhere or by a writer-less
//! FIFO (which wedges a plain `open(2)` in the kernel forever). Every place
//! that opens an indexed/derived path *by name* must therefore go through
//! [`read_regular_at`]: `open(O_RDONLY|O_NONBLOCK|O_NOFOLLOW|O_CLOEXEC)`,
//! then `fstat(fd)` and refuse anything that is not a regular file (or is
//! over the caller's size cap), then read. A regular file ignores
//! `O_NONBLOCK`, so the read itself is ordinary.

use bun_core::kind_from_mode;
use bun_sys::{E, EntryKind as SysEntryKind, Fd, File, O, PosixStat, fstat};

/// What a guarded by-name open of a worktree path produced.
#[derive(Debug, PartialEq, Eq)]
pub enum FileReadOutcome {
    /// A regular file within the size cap; its full contents.
    Contents(Vec<u8>),
    /// The path no longer exists (or a parent component is gone).
    NotFound,
    /// The path exists but is not a regular file: a symlink (`O_NOFOLLOW`
    /// refuses to traverse it), a FIFO, a socket, a device, or a directory.
    NotRegular,
    /// A regular file larger than the caller's `max_size`.
    TooLarge,
}

/// Open `path` relative to `dir` (use [`Fd::cwd`] for an absolute path) with
/// the TOCTOU-safe flag set, validate the *opened descriptor* with `fstat`,
/// and read it. Only an unexpected I/O failure (not a kind/size rejection)
/// is an `Err`.
pub fn read_regular_at(
    dir: Fd,
    path: &[u8],
    max_size: u64,
) -> Result<FileReadOutcome, bun_sys::Error> {
    let flags = O::RDONLY | O::NONBLOCK | O::NOFOLLOW | O::CLOEXEC;
    let file = match File::openat(dir, path, flags, 0) {
        Ok(file) => file,
        Err(err) => {
            return match err.get_errno() {
                E::ENOENT | E::ENOTDIR => Ok(FileReadOutcome::NotFound),
                // `O_NOFOLLOW` on a symlink. (macOS reports EMLINK from some
                // filesystems; both mean "the final component is a link".)
                E::ELOOP | E::EMLINK => Ok(FileReadOutcome::NotRegular),
                // `O_NONBLOCK | O_RDONLY` never fails on a FIFO, but some
                // device nodes refuse a non-blocking open with ENXIO.
                E::ENXIO => Ok(FileReadOutcome::NotRegular),
                _ => Err(err),
            };
        }
    };
    // The kind/size check is on the *opened fd*: it cannot be raced.
    let stat = PosixStat::init(&fstat(file.fd())?);
    if kind_from_mode(stat.mode as bun_core::Mode) != SysEntryKind::File {
        return Ok(FileReadOutcome::NotRegular);
    }
    if stat.size > max_size {
        return Ok(FileReadOutcome::TooLarge);
    }
    Ok(FileReadOutcome::Contents(file.read_to_end()?))
}

#[cfg(test)]
mod tests {
    use core::sync::atomic::{AtomicUsize, Ordering};

    use bun_sys::Dir;

    use super::*;

    struct TempTree {
        parent: Vec<u8>,
        name: Vec<u8>,
        root: Vec<u8>,
    }

    impl TempTree {
        fn new(tag: &str) -> TempTree {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let parent = std::env::temp_dir().as_os_str().as_encoded_bytes().to_vec();
            let name = format!(
                "bun_file_index_read_{tag}_{}_{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            )
            .into_bytes();
            let mut root = parent.clone();
            root.push(b'/');
            root.extend_from_slice(&name);
            Dir::open(&parent)
                .expect("temp dir must exist")
                .make_path(&name)
                .expect("create test root");
            TempTree { parent, name, root }
        }

        fn write(&self, rel: &[u8], contents: &[u8]) {
            let f = Dir::open(&self.root)
                .unwrap()
                .open_file(rel, O::WRONLY | O::CREAT | O::TRUNC, 0o644)
                .unwrap();
            f.write_all(contents).unwrap();
        }

        fn dir(&self) -> Dir {
            Dir::open(&self.root).unwrap()
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            if let Ok(dir) = Dir::open(&self.parent) {
                let _ = dir.delete_tree(&self.name);
            }
        }
    }

    #[test]
    fn reads_a_regular_file_and_enforces_the_size_cap() {
        let t = TempTree::new("regular");
        t.write(b"a.txt", b"hello");
        let dir = t.dir();
        assert_eq!(
            read_regular_at(dir.fd(), b"a.txt", u64::MAX).unwrap(),
            FileReadOutcome::Contents(b"hello".to_vec())
        );
        // Exactly at the cap is admitted; one byte under it is not.
        assert_eq!(
            read_regular_at(dir.fd(), b"a.txt", 5).unwrap(),
            FileReadOutcome::Contents(b"hello".to_vec())
        );
        assert_eq!(
            read_regular_at(dir.fd(), b"a.txt", 4).unwrap(),
            FileReadOutcome::TooLarge
        );
        assert_eq!(
            read_regular_at(dir.fd(), b"missing.txt", u64::MAX).unwrap(),
            FileReadOutcome::NotFound
        );
        // A directory is not a regular file.
        assert_eq!(
            read_regular_at(dir.fd(), b".", u64::MAX).unwrap(),
            FileReadOutcome::NotRegular
        );
    }

    /// A symlink is refused by `O_NOFOLLOW` even when its target is a
    /// perfectly readable regular file outside the tree: the by-name open
    /// must never read *through* a link that replaced an indexed file.
    #[cfg(unix)]
    #[test]
    fn symlink_is_never_followed() {
        let outside = TempTree::new("symlink_target");
        outside.write(b"secret.txt", b"outside contents");
        let t = TempTree::new("symlink");
        let mut target = outside.root.clone();
        target.extend_from_slice(b"/secret.txt");
        t.dir().sym_link(&target, b"link.txt", false).unwrap();
        assert_eq!(
            read_regular_at(t.dir().fd(), b"link.txt", u64::MAX).unwrap(),
            FileReadOutcome::NotRegular
        );
    }

    /// A writer-less FIFO wedges a blocking `open(2)` in the kernel forever;
    /// the guarded open must classify it and return.
    #[cfg(unix)]
    #[test]
    fn writerless_fifo_does_not_block() {
        let t = TempTree::new("fifo");
        let mut path = t.root.clone();
        path.extend_from_slice(b"/pipe\0");
        // SAFETY: `path` is NUL-terminated and outlives the call.
        let rc = unsafe { libc::mkfifo(path.as_ptr().cast(), 0o644) };
        assert_eq!(rc, 0, "mkfifo");
        assert_eq!(
            read_regular_at(t.dir().fd(), b"pipe", u64::MAX).unwrap(),
            FileReadOutcome::NotRegular
        );
    }
}

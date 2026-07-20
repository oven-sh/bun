//! Thin `bun_sys` wrappers for the handful of filesystem ops the clone path
//! needs. Paths are byte slices throughout (`bun_sys` is fd-relative + bytes;
//! we always pass `Fd::cwd()` and absolute byte paths).

use crate::{Error, Result};
use bun_core::{Fd, ZStr};
use bun_paths::path_buffer_pool;
use bun_sys::{self as sys, File, O};

/// `mkdir -p`. Absolute byte path.
pub(crate) fn mkdirp(path: &[u8]) -> Result<()> {
    sys::mkdir_recursive(path).map_err(Error::from)
}

/// Create/truncate `path` and write `data`. For paths **we** construct
/// (`.git/…`, the `.idx`); never used for tree-derived worktree paths.
pub(crate) fn write_trusted(path: &[u8], data: &[u8]) -> Result<()> {
    let f = File::make_open(path, O::WRONLY | O::CREAT | O::TRUNC, 0o644)?;
    f.write_all(data)?;
    Ok(())
}

/// Create `path` (which must not already exist) and write `data`. Used for
/// worktree files whose path components came from a tree object.
///
/// `O_EXCL | O_NOFOLLOW`: a fresh clone target is empty, so every worktree
/// file is genuinely new — refusing to overwrite means a case-folding
/// collision between a symlink we just wrote and a same-named file fails
/// closed instead of writing through the link (the CVE-2024-32002 vector).
/// Parent components are real directories by construction: every `mkdirp`
/// ran in the serial walk before any symlink job was scheduled.
pub(crate) fn write_worktree_file(path: &[u8], data: &[u8], mode: u32) -> Result<()> {
    let f = File::make_open(path, O::WRONLY | O::CREAT | O::EXCL | O::NOFOLLOW, mode)?;
    f.write_all(data)?;
    #[cfg(unix)]
    {
        let _ = sys::fchmod(f.fd(), mode);
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn symlink(target: &[u8], link: &[u8]) -> Result<()> {
    let mut a = path_buffer_pool::get();
    let mut b = path_buffer_pool::get();
    sys::symlink(zstr_in(&mut a, target), zstr_in(&mut b, link)).map_err(Error::from)
}

/// `lstat(2)` on an absolute byte path. Returns `None` on any error — callers
/// (the index writer) treat a missing stat as "zero the cache fields".
pub(crate) fn lstat(path: &[u8]) -> Option<sys::PosixStat> {
    let mut buf = path_buffer_pool::get();
    sys::lstatat(Fd::cwd(), zstr_in(&mut buf, path))
        .ok()
        .map(|s| sys::PosixStat::init(&s))
}

/// `true` if `path` exists and is a non-empty directory.
pub(crate) fn dir_nonempty(path: &[u8]) -> Result<bool> {
    let dir = match sys::open_dir_at(Fd::cwd(), path) {
        Ok(fd) => fd,
        Err(e) if e.get_errno() == bun_errno::E::ENOENT => return Ok(false),
        Err(e) => return Err(e.into()),
    };
    let mut it = sys::dir_iterator::iterate(dir);
    let nonempty = it.next()?.is_some();
    Ok(nonempty)
}

fn zstr_in<'a>(buf: &'a mut bun_paths::PathBuffer, s: &[u8]) -> &'a ZStr {
    buf[..s.len()].copy_from_slice(s);
    buf[s.len()] = 0;
    ZStr::from_buf(buf, s.len())
}

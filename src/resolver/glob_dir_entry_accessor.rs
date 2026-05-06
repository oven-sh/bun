// ─────────────────────────────────────────────────────────────────────────────
// DirEntryAccessor — `impl bun_glob::Accessor` backed by the resolver's
// in-memory `FileSystem` directory cache.
// ─────────────────────────────────────────────────────────────────────────────
// PORT NOTE (cyclebreak): moved here from `src/glob/GlobWalker.rs`. The full
// DirEntry cache (`DirEntry`, `EntryMap`, `read_directory`, `ReadDirResult`)
// lives in this crate (higher-tier than `bun_glob`); per PORTING.md §Dispatch
// this is the cold-path "low-tier owns the trait, high-tier owns the impl"
// case: `bun_glob` exports the `Accessor` trait, and the cache-backed impl
// lives next to the cache. The original Zig (`src/glob/GlobWalker.zig`)
// co-located it because Zig has no crate-level dep cycles.

use bun_core::Error;
use bun_glob::walk::{Accessor, AccessorDirEntry, AccessorDirIter, AccessorHandle};
use bun_paths::{resolve_path, PathBuffer};
use bun_string::ZStr;
use bun_sys::{self as Syscall, Error as SysError, Result as Maybe, Stat};

use crate::fs_full as fs;
use fs::{DirEntry, EntryKind, FileSystem as FS, ReadDirResult};

pub struct DirEntryAccessor;

#[derive(Clone, Copy)]
pub struct DirEntryHandle {
    pub value: Option<&'static DirEntry>,
}

impl AccessorHandle for DirEntryHandle {
    const EMPTY: Self = DirEntryHandle { value: None };

    fn is_empty(self) -> bool {
        self.value.is_none()
    }

    fn eql(self, other: Self) -> bool {
        // TODO this might not be quite right, we're comparing pointers, not the underlying directory
        // On the other hand, DirEntries are only ever created once (per generation), so this should be fine?
        // Realistically, as closing the handle is a no-op, this should be fine either way.
        match (self.value, other.value) {
            (Some(a), Some(b)) => core::ptr::eq(a, b),
            (None, None) => true,
            _ => false,
        }
    }
}

pub struct DirEntryDirIter {
    // TODO(port): FS.DirEntry.EntryMap.Iterator — concrete type from resolver fs
    value: Option<fs::EntryMapIterator<'static>>,
}

pub struct DirEntryIterResult {
    pub name: DirEntryNameWrapper,
    pub kind: bun_sys::FileKind,
}

pub struct DirEntryNameWrapper {
    pub value: &'static [u8],
}

impl DirEntryNameWrapper {
    pub fn slice(&self) -> &[u8] {
        self.value
    }
}

impl AccessorDirEntry for DirEntryIterResult {
    fn name_slice(&self) -> &[u8] {
        self.name.slice()
    }
    fn kind(&self) -> bun_sys::FileKind {
        self.kind
    }
}

impl AccessorDirIter for DirEntryDirIter {
    type Handle = DirEntryHandle;
    type Entry = DirEntryIterResult;

    #[inline]
    fn next(&mut self) -> Maybe<Option<DirEntryIterResult>> {
        if let Some(value) = &mut self.value {
            let Some(nextval) = value.next() else {
                return Maybe::Ok(None);
            };
            let name = *nextval.key_ptr;
            let kind = nextval.value_ptr.kind(&FS::instance().fs, true);
            let fskind = match kind {
                EntryKind::File => bun_sys::FileKind::File,
                EntryKind::Dir => bun_sys::FileKind::Directory,
            };
            Maybe::Ok(Some(DirEntryIterResult {
                name: DirEntryNameWrapper { value: name },
                kind: fskind,
            }))
        } else {
            Maybe::Ok(None)
        }
    }

    #[inline]
    fn iterate(dir: DirEntryHandle) -> Self {
        let Some(entry) = dir.value else {
            return DirEntryDirIter { value: None };
        };
        DirEntryDirIter {
            value: Some(entry.data.iterator()),
        }
    }
}

impl Accessor for DirEntryAccessor {
    const COUNT_FDS: bool = false;
    type Handle = DirEntryHandle;
    type DirIter = DirEntryDirIter;

    fn statat(handle: DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
        let mut buf = PathBuffer::uninit();
        let path: &ZStr = if !bun_paths::Platform::AUTO.is_absolute(path_.as_bytes()) {
            if let Some(entry) = handle.value {
                let slice = resolve_path::join_string_buf::<bun_paths::platform::Auto>(
                    &mut buf,
                    &[entry.dir.as_ref(), path_.as_bytes()],
                );
                let len = slice.len();
                buf[len] = 0;
                // SAFETY: buf[len] == 0 written above
                unsafe { ZStr::from_raw(buf.as_ptr(), len) }
            } else {
                path_
            }
        } else {
            path_
        };
        Syscall::stat(path)
    }

    /// Like statat but does not follow symlinks.
    fn lstatat(handle: DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
        let mut buf = PathBuffer::uninit();
        if let Some(entry) = handle.value {
            return Syscall::lstatat(entry.fd, path_);
        }

        let path: &ZStr = if !bun_paths::Platform::AUTO.is_absolute(path_.as_bytes()) {
            if let Some(entry) = handle.value {
                let slice = resolve_path::join_string_buf::<bun_paths::platform::Auto>(
                    &mut buf,
                    &[entry.dir.as_ref(), path_.as_bytes()],
                );
                let len = slice.len();
                buf[len] = 0;
                // SAFETY: buf[len] == 0 written above
                unsafe { ZStr::from_raw(buf.as_ptr(), len) }
            } else {
                path_
            }
        } else {
            path_
        };
        Syscall::lstat(path)
    }

    fn open(path: &ZStr) -> Result<Maybe<DirEntryHandle>, Error> {
        Self::openat(DirEntryHandle::EMPTY, path)
    }

    fn openat(handle: DirEntryHandle, path_: &ZStr) -> Result<Maybe<DirEntryHandle>, Error> {
        let mut buf = PathBuffer::uninit();
        let mut path: &[u8] = path_.as_bytes();

        if !bun_paths::Platform::AUTO.is_absolute(path) {
            if let Some(entry) = handle.value {
                path = resolve_path::join_string_buf::<bun_paths::platform::Auto>(
                    &mut buf,
                    &[entry.dir.as_ref(), path],
                );
            }
        }
        // TODO do we want to propagate ENOTDIR through the 'Maybe' to match the SyscallAccessor?
        // The glob implementation specifically checks for this error when dealing with symlinks
        // return Maybe::Err(SysError::from_code(E::NOTDIR, Syscall::Tag::open));
        let res = FS::instance().fs.read_directory(path, None, 0, false)?;
        match &*res {
            ReadDirResult::Entries(entry) => {
                Ok(Maybe::Ok(DirEntryHandle { value: Some(entry) }))
            }
            ReadDirResult::Err(err) => Err(err.original_err),
        }
    }

    #[inline]
    fn close(_handle: DirEntryHandle) -> Option<SysError> {
        // TODO is this a noop?
        None
    }

    fn getcwd(path_buf: &mut PathBuffer) -> Maybe<&[u8]> {
        let cwd = FS::instance().fs.cwd();
        path_buf[..cwd.len()].copy_from_slice(cwd);
        // TODO(port): Zig version has no return; assuming it should return the copied slice
        Maybe::Ok(&path_buf[..cwd.len()])
    }
}

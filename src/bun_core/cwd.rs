//! The process working directory.
//!
//! This is the one path Bun asks the operating system for. It is read once,
//! the first time it is needed, and after that only `bun_sys::chdir` (the
//! single way Bun changes directory) replaces it. Every other location Bun
//! works with — the project root, `node_modules`, cache and temp
//! directories, entry points — is a join against this value, so there is no
//! second copy to drift and nothing needs to ask the kernel for the name of a
//! directory it already opened.

use crate::{PathBuffer, RwLock, ZStr};

#[derive(Clone, Copy)]
struct Cwd {
    path: &'static ZStr,
    /// `false` if `path` is the executable-directory stand-in [`get`] uses
    /// when the working directory cannot be read.
    from_os: bool,
}

static CWD: RwLock<Option<Cwd>> = RwLock::new(None);

/// Reads the working directory from the OS if it has not been read yet.
/// Fails only if the OS cannot report one (e.g. the directory was deleted).
pub fn init() -> crate::CrateResult<&'static ZStr> {
    if let Some(Cwd {
        path,
        from_os: true,
    }) = *CWD.read()
    {
        return Ok(path);
    }
    let mut buf = PathBuffer::uninit();
    let read = crate::getcwd(&mut buf)?;
    Ok(store(read.as_bytes(), true))
}

/// The working directory: absolute, symlink-free (as the OS reports it), no
/// trailing separator except for a filesystem root.
///
/// If it cannot be read, falls back to the executable's directory the way
/// Node does, so the runtime still starts and `process.cwd()` can report the
/// real error; commands that must not guess call [`init`] first.
pub fn get() -> &'static ZStr {
    if let Some(cwd) = *CWD.read() {
        return cwd.path;
    }
    let mut buf = PathBuffer::uninit();
    match crate::getcwd(&mut buf) {
        Ok(read) => store(read.as_bytes(), true),
        Err(_) => store(crate::getcwd_or_exe_dir(&mut buf).as_bytes(), false),
    }
}

/// Records `path` as the working directory. For `bun_sys::chdir`; nothing
/// else should need it.
pub fn set(path: &[u8]) -> &'static ZStr {
    store(path, true)
}

fn store(path: &[u8], from_os: bool) -> &'static ZStr {
    let mut slot = CWD.write();
    if let Some(cwd) = *slot {
        if cwd.path.as_bytes() == path && cwd.from_os == from_os {
            return cwd.path;
        }
    }
    // Each distinct working directory lives for the rest of the process:
    // paths derived from an earlier one may still be in use after a `chdir`.
    let owned: &'static [u8] = Box::leak(crate::ZBox::from_bytes(path).into_boxed_slice_with_nul());
    let path = ZStr::from_slice_with_nul(owned);
    *slot = Some(Cwd { path, from_os });
    path
}

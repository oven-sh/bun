//! Port of `std.fs.path.ComponentIterator(format, T)` + the `std.fs.Dir.makePath`
//! back-then-forward walk. Pure path logic — no I/O; the mkdir walk takes a
//! closure so callers supply `mkdirat` / `NtCreateFile(FILE_OPEN_IF)` /
//! `CreateDirectoryW` themselves.
//!
//! This is the single source of truth for "split a path into prefix slices and
//! never yield the Windows root (`C:`, `C:\`, `\\server\share\`) as a component".
//! Replaces the four hand-rolled copies in `bun_sys` (posix+windows),
//! `bun_libarchive` (u16) and `bun` (`make_path`, which already called the
//! `component_iterator` free fn below before it existed).

use crate::PathChar;

/// Runtime equivalent of Zig's `comptime path_type: PathType`. The hot
/// `is_sep` branch inlines to a single compare on POSIX and two compares on
/// Windows; we keep it a runtime enum (vs. a const-generic) so one
/// monomorphisation per `T` covers both — call sites that hard-code the
/// format still constant-fold via inlining.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PathFormat {
    Posix,
    Windows,
}

impl PathFormat {
    /// `std.fs.path.native_os` → `.windows` / `.posix`.
    #[cfg(windows)]
    pub const NATIVE: Self = Self::Windows;
    #[cfg(not(windows))]
    pub const NATIVE: Self = Self::Posix;

    #[inline(always)]
    pub fn is_sep<T: PathChar>(self, c: T) -> bool {
        match self {
            Self::Posix => c == T::from_u8(b'/'),
            Self::Windows => c == T::from_u8(b'/') || c == T::from_u8(b'\\'),
        }
    }
}

/// One yielded component. `path` is the full prefix slice from index 0 up to
/// and including `name` (no trailing separator); `name` is the bare segment.
/// Both borrow the original input — no allocation, no copying.
#[derive(Clone, Copy, Debug)]
pub struct Component<'a, T> {
    /// The current component's name, e.g. `b`. Never contains separators.
    pub name: &'a [T],
    /// The full path up to and including the current component, e.g. `/a/b`.
    /// Never has a trailing separator.
    pub path: &'a [T],
}

/// Port of `std.fs.path.ComponentIterator(path_type, T)` — bidirectional
/// iterator over `Component`s with a parsed root prefix that is never yielded.
#[derive(Clone, Copy, Debug)]
pub struct ComponentIterator<'a, T> {
    path: &'a [T],
    root_end: usize,
    start: usize,
    end: usize,
    fmt: PathFormat,
}

impl<'a, T: PathChar> ComponentIterator<'a, T> {
    /// After `init`, `next` returns the first component after the root
    /// (no need to call `first`). To iterate backwards, call `last` first.
    ///
    /// For Windows paths, returns `BadPathName` if `path` has an explicit
    /// namespace prefix (`\\.\`, `\\?\`, `\??\`) or is a UNC path with more
    /// than two leading separators. POSIX `init` is infallible.
    pub fn init(path: &'a [T], fmt: PathFormat) -> Result<Self, bun_core::Error> {
        let root_end = match fmt {
            PathFormat::Posix => {
                let mut i = 0;
                while i < path.len() && fmt.is_sep(path[i]) {
                    i += 1;
                }
                i
            }
            PathFormat::Windows => windows_root_end(path)?,
        };
        Ok(Self {
            path,
            root_end,
            start: root_end,
            end: root_end,
            fmt,
        })
    }

    #[inline(always)]
    fn is_sep(&self, c: T) -> bool {
        self.fmt.is_sep(c)
    }

    /// The root prefix (`/`, `C:\`, `\\server\share\`, …) or `None` if relative.
    #[inline]
    pub fn root(&self) -> Option<&'a [T]> {
        if self.root_end == 0 {
            None
        } else {
            Some(&self.path[..self.root_end])
        }
    }

    /// Returns the first component and seeks to it.
    pub fn first(&mut self) -> Option<Component<'a, T>> {
        self.start = self.root_end;
        self.end = self.start;
        while self.end < self.path.len() && !self.is_sep(self.path[self.end]) {
            self.end += 1;
        }
        if self.end == self.start {
            return None;
        }
        Some(Component {
            name: &self.path[self.start..self.end],
            path: &self.path[..self.end],
        })
    }

    /// Returns the last component and seeks to it.
    pub fn last(&mut self) -> Option<Component<'a, T>> {
        self.end = self.path.len();
        loop {
            if self.end == self.root_end {
                self.start = self.end;
                return None;
            }
            if !self.is_sep(self.path[self.end - 1]) {
                break;
            }
            self.end -= 1;
        }
        self.start = self.end;
        while self.start > self.root_end && !self.is_sep(self.path[self.start - 1]) {
            self.start -= 1;
        }
        if self.start == self.end {
            return None;
        }
        Some(Component {
            name: &self.path[self.start..self.end],
            path: &self.path[..self.end],
        })
    }

    /// Advances forward; returns the component to the right of the current one.
    pub fn next(&mut self) -> Option<Component<'a, T>> {
        let p = self.peek_next()?;
        self.start = p.path.len() - p.name.len();
        self.end = p.path.len();
        Some(p)
    }

    /// Like `next` but does not advance.
    pub fn peek_next(&self) -> Option<Component<'a, T>> {
        let mut start = self.end;
        while start < self.path.len() && self.is_sep(self.path[start]) {
            start += 1;
        }
        let mut end = start;
        while end < self.path.len() && !self.is_sep(self.path[end]) {
            end += 1;
        }
        if start == end {
            return None;
        }
        Some(Component {
            name: &self.path[start..end],
            path: &self.path[..end],
        })
    }

    /// Advances backward; returns the component to the left of the current one.
    pub fn previous(&mut self) -> Option<Component<'a, T>> {
        let p = self.peek_previous()?;
        self.start = p.path.len() - p.name.len();
        self.end = p.path.len();
        Some(p)
    }

    /// Like `previous` but does not advance.
    pub fn peek_previous(&self) -> Option<Component<'a, T>> {
        let mut end = self.start;
        loop {
            if end == self.root_end {
                return None;
            }
            if !self.is_sep(self.path[end - 1]) {
                break;
            }
            end -= 1;
        }
        let mut start = end;
        while start > self.root_end && !self.is_sep(self.path[start - 1]) {
            start -= 1;
        }
        if start == end {
            return None;
        }
        Some(Component {
            name: &self.path[start..end],
            path: &self.path[..end],
        })
    }
}

/// `std.fs.path.componentIterator` — native-format convenience wrapper over
/// `ComponentIterator::init` for `u8` paths.
#[inline]
pub fn component_iterator(path: &[u8]) -> Result<ComponentIterator<'_, u8>, bun_core::Error> {
    ComponentIterator::init(path, PathFormat::NATIVE)
}

/// Outcome of one `mkdir`-like step in [`make_path_with`]. The closure maps
/// its I/O result onto these three variants; the walk handles the
/// `previous()` / `next()` bookkeeping.
pub enum MakePathStep<E> {
    /// Directory was created (or `FILE_OPEN_IF` opened-or-created).
    /// Walk advances forward.
    Created,
    /// Directory already exists (`EEXIST`). Walk advances forward.
    Exists,
    /// A parent is missing (`ENOENT`). Walk steps back one component;
    /// if there is no previous component the carried error is returned.
    NotFound(E),
}

/// Port of the `std.fs.Dir.makePath` back-then-forward walk, parameterised
/// over the per-prefix `mkdir` step so callers supply `mkdirat` /
/// `NtCreateFile(FILE_OPEN_IF)` / `CreateDirectoryW` themselves.
///
/// Starts at `it.last()`; on `Created`/`Exists` advances via `next()`
/// (returning `Ok(())` when there is none), on `NotFound(e)` steps back via
/// `previous()` (returning `Err(e)` when there is none — i.e. the very first
/// component's parent does not exist).
///
/// `mkdir` is invoked with `component.path`: a borrowed prefix slice into the
/// original input, never NUL-terminated. Callers that need a sentinel must
/// copy into a scratch buffer.
pub fn make_path_with<'a, T: PathChar, E>(
    mut it: ComponentIterator<'a, T>,
    mut mkdir: impl FnMut(&'a [T]) -> Result<MakePathStep<E>, E>,
) -> Result<(), E> {
    let Some(mut comp) = it.last() else {
        return Ok(());
    };
    loop {
        match mkdir(comp.path)? {
            MakePathStep::Created | MakePathStep::Exists => {
                comp = match it.next() {
                    Some(c) => c,
                    None => return Ok(()),
                };
            }
            MakePathStep::NotFound(e) => {
                comp = match it.previous() {
                    Some(c) => c,
                    None => return Err(e),
                };
            }
        }
    }
}

// ─── Windows root parsing ───────────────────────────────────────────────────
// Direct port of `std.os.windows.{getNamespacePrefix, getUnprefixedPathType}`
// + the `.windows` arm of `ComponentIterator.init`. Kept private — callers
// only see `ComponentIterator::init`; for ad-hoc root-length probing
// `resolve_path::windows_filesystem_root_t` already exists.

fn windows_root_end<T: PathChar>(path: &[T]) -> Result<usize, bun_core::Error> {
    #[inline(always)]
    fn sep<T: PathChar>(c: T) -> bool {
        c == T::from_u8(b'/') || c == T::from_u8(b'\\')
    }

    // getNamespacePrefix != .none → BadPathName (`\\.\`, `\\?\`, `//?/`, `\??\`).
    if path.len() >= 4 {
        let c0 = path[0];
        let c1 = path[1];
        let c2 = path[2];
        let c3 = path[3];
        let s0 = sep(c0);
        let s3 = sep(c3);
        let bs0 = c0 == T::from_u8(b'\\');
        let bs3 = c3 == T::from_u8(b'\\');
        if s0 && s3 {
            if c1 == T::from_u8(b'?') {
                // `\??\` (NT) — only when both outer seps are real backslashes.
                if c2 == T::from_u8(b'?') && bs0 && bs3 {
                    return Err(bun_core::err!("BadPathName"));
                }
            } else if sep(c1) {
                // `\\?\` (verbatim/fake-verbatim) or `\\.\` (local-device).
                if c2 == T::from_u8(b'?') || c2 == T::from_u8(b'.') {
                    return Err(bun_core::err!("BadPathName"));
                }
            }
        }
    }

    // getUnprefixedPathType
    if path.is_empty() {
        return Ok(0);
    }
    if sep(path[0]) {
        if path.len() < 2 || !sep(path[1]) {
            // .rooted
            return Ok(1);
        }
        // exactly `\\.` or `\\?` with nothing trailing → .root_local_device
        if path.len() == 3 && (path[2] == T::from_u8(b'.') || path[2] == T::from_u8(b'?')) {
            return Ok(path.len());
        }
        // .unc_absolute → consume `\\server\share\`; reject `\\\x`.
        let mut i = 2usize;
        if i < path.len() && sep(path[i]) {
            return Err(bun_core::err!("BadPathName"));
        }
        while i < path.len() && !sep(path[i]) {
            i += 1;
        } // server
        while i < path.len() && sep(path[i]) {
            i += 1;
        }
        while i < path.len() && !sep(path[i]) {
            i += 1;
        } // share
        while i < path.len() && sep(path[i]) {
            i += 1;
        }
        return Ok(i);
    }
    if path.len() < 2 || path[1] != T::from_u8(b':') {
        // .relative
        return Ok(0);
    }
    if path.len() > 2 && sep(path[2]) {
        // .drive_absolute → consume `C:\` plus any extra seps.
        let mut i = 3usize;
        while i < path.len() && sep(path[i]) {
            i += 1;
        }
        return Ok(i);
    }
    // .drive_relative
    Ok(2)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(path: &[u8], fmt: PathFormat) -> (Option<&[u8]>, Vec<(&[u8], &[u8])>) {
        let mut it = ComponentIterator::init(path, fmt).unwrap();
        let root = it.root();
        let mut out = vec![];
        while let Some(c) = it.next() {
            out.push((c.name, c.path));
        }
        (root, out)
    }

    #[test]
    fn posix_basic() {
        let (root, parts) = collect(b"/a/b/c", PathFormat::Posix);
        assert_eq!(root, Some(&b"/"[..]));
        assert_eq!(
            parts,
            vec![
                (&b"a"[..], &b"/a"[..]),
                (&b"b"[..], &b"/a/b"[..]),
                (&b"c"[..], &b"/a/b/c"[..])
            ]
        );

        let (root, parts) = collect(b"a//b/", PathFormat::Posix);
        assert_eq!(root, None);
        assert_eq!(
            parts,
            vec![(&b"a"[..], &b"a"[..]), (&b"b"[..], &b"a//b"[..])]
        );

        let mut it = ComponentIterator::init(b"///"[..].into(), PathFormat::Posix).unwrap();
        assert!(it.last().is_none());
    }

    #[test]
    fn windows_roots() {
        let (root, parts) = collect(b"C:\\Users\\foo", PathFormat::Windows);
        assert_eq!(root, Some(&b"C:\\"[..]));
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].1, &b"C:\\Users"[..]);

        let (root, _) = collect(b"C:foo", PathFormat::Windows);
        assert_eq!(root, Some(&b"C:"[..]));

        let (root, parts) = collect(b"\\\\server\\share\\dir", PathFormat::Windows);
        assert_eq!(root, Some(&b"\\\\server\\share\\"[..]));
        assert_eq!(parts, vec![(&b"dir"[..], &b"\\\\server\\share\\dir"[..])]);

        assert!(ComponentIterator::<u8>::init(b"\\\\?\\C:\\", PathFormat::Windows).is_err());
        assert!(ComponentIterator::<u8>::init(b"\\??\\C:\\", PathFormat::Windows).is_err());
        assert!(ComponentIterator::<u8>::init(b"\\\\\\x", PathFormat::Windows).is_err());
    }

    #[test]
    fn back_then_forward() {
        let mut it = ComponentIterator::init(&b"/a/b/c"[..], PathFormat::Posix).unwrap();
        assert_eq!(it.last().unwrap().name, b"c");
        assert_eq!(it.previous().unwrap().name, b"b");
        assert_eq!(it.previous().unwrap().name, b"a");
        assert!(it.previous().is_none());
        assert_eq!(it.next().unwrap().name, b"a");
        assert_eq!(it.next().unwrap().name, b"b");
    }
}

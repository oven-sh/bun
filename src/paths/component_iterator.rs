//! Path component iteration plus the recursive-mkdir back-then-forward
//! walk. Pure path logic — no I/O; the mkdir walk takes a
//! closure so callers supply `mkdirat` / `NtCreateFile(FILE_OPEN_IF)` /
//! `CreateDirectoryW` themselves.
//!
//! This is the single source of truth for "split a path into prefix slices and
//! never yield the Windows root (`C:`, `C:\`, `\\server\share\`) as a component".
//! Replaces the four hand-rolled copies in `bun_sys` (posix+windows),
//! `bun_libarchive` (u16) and `bun` (`make_path`, which already called the
//! `component_iterator` free fn below before it existed).

use crate::PathChar;

/// Path format selector. The hot
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
    #[inline(always)]
    pub(crate) fn is_sep<T: PathChar>(self, c: T) -> bool {
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
    pub(crate) name: &'a [T],
    /// The full path up to and including the current component, e.g. `/a/b`.
    /// Never has a trailing separator.
    pub(crate) path: &'a [T],
}

/// A bidirectional
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
    pub fn init(path: &'a [T], fmt: PathFormat) -> crate::Result<Self> {
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

    /// Returns the last component and seeks to it.
    pub(crate) fn last(&mut self) -> Option<Component<'a, T>> {
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
    pub(crate) fn next(&mut self) -> Option<Component<'a, T>> {
        let p = self.peek_next()?;
        self.start = p.path.len() - p.name.len();
        self.end = p.path.len();
        Some(p)
    }

    /// Like `next` but does not advance.
    pub(crate) fn peek_next(&self) -> Option<Component<'a, T>> {
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
    pub(crate) fn previous(&mut self) -> Option<Component<'a, T>> {
        let p = self.peek_previous()?;
        self.start = p.path.len() - p.name.len();
        self.end = p.path.len();
        Some(p)
    }

    /// Like `previous` but does not advance.
    pub(crate) fn peek_previous(&self) -> Option<Component<'a, T>> {
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

/// Outcome of one `mkdir`-like step in [`make_path_with`]. The closure maps
/// its I/O result onto these three variants; the walk handles the
/// `previous()` / `next()` bookkeeping.
pub enum MakePathStep<E> {
    /// Directory was created (or `FILE_OPEN_IF` opened-or-created).
    /// Walk advances forward.
    Created,
    /// Directory already exists (`EEXIST`). Walk advances forward.
    Exists,
    /// A parent is missing (`ENOENT`). Walk steps back one component; if
    /// there is none, or the walk already advanced forward, the carried error
    /// is returned.
    NotFound(E),
}

/// The recursive-mkdir back-then-forward walk, parameterised
/// over the per-prefix `mkdir` step so callers supply `mkdirat` /
/// `NtCreateFile(FILE_OPEN_IF)` / `CreateDirectoryW` themselves.
///
/// Starts at `it.last()`; on `Created`/`Exists` advances via `next()`
/// (returning `Ok(())` when there is none), on `NotFound(e)` steps back via
/// `previous()` (returning `Err(e)` when there is none — i.e. the very first
/// component's parent does not exist). Once the walk has advanced, a
/// `NotFound(e)` is final and returns that component's `e`: its parent exists
/// but cannot hold children (a dangling symlink, procfs).
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
    let mut advanced = false;
    loop {
        match mkdir(comp.path)? {
            MakePathStep::Created | MakePathStep::Exists => {
                advanced = true;
                comp = match it.next() {
                    Some(c) => c,
                    None => return Ok(()),
                };
            }
            MakePathStep::NotFound(e) if advanced => return Err(e),
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
// Windows namespace-prefix and unprefixed-path-type parsing backing the
// Windows arm of `ComponentIterator::init`. Kept private — callers
// only see `ComponentIterator::init`; for ad-hoc root-length probing
// `resolve_path::windows_filesystem_root_t` already exists.

fn windows_root_end<T: PathChar>(path: &[T]) -> crate::Result<usize> {
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
                    return Err(crate::Error::Sys(bun_errno::SystemErrno::EINVAL));
                }
            } else if sep(c1) {
                // `\\?\` (verbatim/fake-verbatim) or `\\.\` (local-device).
                if c2 == T::from_u8(b'?') || c2 == T::from_u8(b'.') {
                    return Err(crate::Error::Sys(bun_errno::SystemErrno::EINVAL));
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
            return Err(crate::Error::Sys(bun_errno::SystemErrno::EINVAL));
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

    fn collect(path: &[u8], fmt: PathFormat) -> Vec<(&[u8], &[u8])> {
        let mut it = ComponentIterator::init(path, fmt).unwrap();
        let mut out = vec![];
        while let Some(c) = it.next() {
            out.push((c.name, c.path));
        }
        out
    }

    #[test]
    fn posix_basic() {
        let parts = collect(b"/a/b/c", PathFormat::Posix);
        assert_eq!(
            parts,
            vec![
                (&b"a"[..], &b"/a"[..]),
                (&b"b"[..], &b"/a/b"[..]),
                (&b"c"[..], &b"/a/b/c"[..])
            ]
        );

        let parts = collect(b"a//b/", PathFormat::Posix);
        assert_eq!(
            parts,
            vec![(&b"a"[..], &b"a"[..]), (&b"b"[..], &b"a//b"[..])]
        );

        let mut it = ComponentIterator::init(b"///"[..].into(), PathFormat::Posix).unwrap();
        assert!(it.last().is_none());
    }

    #[test]
    fn windows_roots() {
        let parts = collect(b"C:\\Users\\foo", PathFormat::Windows);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].1, &b"C:\\Users"[..]);

        let parts = collect(b"\\\\server\\share\\dir", PathFormat::Windows);
        assert_eq!(parts, vec![(&b"dir"[..], &b"\\\\server\\share\\dir"[..])]);

        // Drive-relative root: the first component's `.path` starts at byte 2,
        // i.e. `windows_root_end` returned 2 for the bare `C:` prefix.
        let parts = collect(b"C:foo", PathFormat::Windows);
        assert_eq!(parts, vec![(&b"foo"[..], &b"C:foo"[..])]);

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
        // `previous()` returning `None` doesn't rewind the cursor — still on `a`.
        assert!(it.previous().is_none());
        assert_eq!(it.next().unwrap().name, b"b");
        assert_eq!(it.next().unwrap().name, b"c");
        assert!(it.next().is_none());
    }

    #[test]
    fn make_path_creates_missing_parents() {
        // Only the cwd exists: the walk backs up to `a`, then creates forward.
        let it = ComponentIterator::init(&b"a/b/c"[..], PathFormat::Posix).unwrap();
        let mut created: Vec<&[u8]> = vec![];
        let mut attempts: Vec<&[u8]> = vec![];
        let r = make_path_with::<u8, ()>(it, |p| {
            attempts.push(p);
            let parent: &[u8] = match p {
                b"a" => b"",
                b"a/b" => b"a",
                b"a/b/c" => b"a/b",
                _ => unreachable!(),
            };
            if parent.is_empty() || created.contains(&parent) {
                created.push(p);
                Ok(MakePathStep::Created)
            } else {
                Ok(MakePathStep::NotFound(()))
            }
        });
        assert_eq!(r, Ok(()));
        assert_eq!(
            attempts,
            vec![
                &b"a/b/c"[..],
                &b"a/b"[..],
                &b"a"[..],
                &b"a/b"[..],
                &b"a/b/c"[..]
            ]
        );
        assert_eq!(created, vec![&b"a"[..], &b"a/b"[..], &b"a/b/c"[..]]);
    }

    #[test]
    fn make_path_stops_when_parent_exists_but_child_is_not_found() {
        // `/a/b` is a dangling symlink: EEXIST for itself, ENOENT below it.
        let it = ComponentIterator::init(&b"/a/b/c"[..], PathFormat::Posix).unwrap();
        let mut attempts: Vec<&[u8]> = vec![];
        let r = make_path_with(it, |p| {
            attempts.push(p);
            assert!(attempts.len() < 100, "runaway loop");
            match p {
                b"/a" | b"/a/b" => Ok(MakePathStep::Exists),
                b"/a/b/c" => Ok(MakePathStep::NotFound(p)),
                _ => unreachable!(),
            }
        });
        assert_eq!(r, Err(&b"/a/b/c"[..]));
        assert_eq!(attempts, vec![&b"/a/b/c"[..], &b"/a/b"[..], &b"/a/b/c"[..]]);
    }

    #[test]
    fn make_path_stops_on_a_middle_component_after_two_steps_back() {
        // `/proc/nonexistent/out`: the target's parent is missing too, so the
        // guard fires on the middle component and returns its error.
        let it = ComponentIterator::init(&b"/a/b/c"[..], PathFormat::Posix).unwrap();
        let mut attempts: Vec<&[u8]> = vec![];
        let r = make_path_with(it, |p| {
            attempts.push(p);
            assert!(attempts.len() < 100, "runaway loop");
            match p {
                b"/a" => Ok(MakePathStep::Exists),
                b"/a/b" | b"/a/b/c" => Ok(MakePathStep::NotFound(p)),
                _ => unreachable!(),
            }
        });
        assert_eq!(r, Err(&b"/a/b"[..]));
        assert_eq!(
            attempts,
            vec![&b"/a/b/c"[..], &b"/a/b"[..], &b"/a"[..], &b"/a/b"[..]]
        );
    }

    #[test]
    fn make_path_stops_when_open_if_parent_succeeds_but_child_is_not_found() {
        // `NtCreateFile(FILE_OPEN_IF)` reports `Created` for an existing
        // directory too, so the guard must not depend on `Exists`.
        let it = ComponentIterator::init(&b"x\\link\\out"[..], PathFormat::Windows).unwrap();
        let mut attempts = 0u32;
        let r = make_path_with(it, |p| {
            attempts += 1;
            assert!(attempts < 100, "runaway loop");
            match p {
                b"x" | b"x\\link" => Ok(MakePathStep::Created),
                b"x\\link\\out" => Ok(MakePathStep::NotFound(())),
                _ => unreachable!(),
            }
        });
        assert_eq!(r, Err(()));
        assert_eq!(attempts, 3);
    }

    #[test]
    fn make_path_reports_missing_root_parent() {
        // Nothing under the cwd exists: the first component's error comes back.
        let it = ComponentIterator::init(&b"a/b"[..], PathFormat::Posix).unwrap();
        let r = make_path_with(it, |p| Ok(MakePathStep::NotFound(p)));
        assert_eq!(r, Err(&b"a"[..]));
    }
}

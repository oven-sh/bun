//! Path component iteration plus the recursive-mkdir back-then-forward
//! walk. Pure path logic — no I/O; the mkdir walk takes a
//! closure so callers supply `mkdirat` / `NtCreateFile(FILE_OPEN_IF)` /
//! `CreateDirectoryW` themselves.
//!
//! This is the single source of truth for "split a path into prefix slices and
//! never yield the Windows root (`C:`, `C:\`, `\\server\share\`) as a component".
//! Replaces the four hand-rolled copies in `bun_sys` (posix+windows),
//! `bun_archive` (u16) and `bun` (`make_path`, which already called the
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
    /// Fails only for a Windows root that [`windows_root_end`] does not parse.
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
        Ok(Self::with_root_end(path, root_end, fmt))
    }

    /// [`init`](Self::init) with a root end that the caller parsed.
    pub fn with_root_end(path: &'a [T], root_end: usize, fmt: PathFormat) -> Self {
        Self {
            path,
            root_end,
            start: root_end,
            end: root_end,
            fmt,
        }
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
    /// A parent is missing (`ENOENT`). Walk steps back one component;
    /// if there is no previous component the carried error is returned.
    NotFound(E),
}

/// The recursive-mkdir back-then-forward walk, parameterised
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
    // `NotFound` again once its parent exists (a dangling symlink) can never succeed.
    let mut last_not_found: Option<usize> = None;
    loop {
        match mkdir(comp.path)? {
            MakePathStep::Created | MakePathStep::Exists => {
                comp = match it.next() {
                    Some(c) => c,
                    None => return Ok(()),
                };
            }
            MakePathStep::NotFound(e) => {
                if last_not_found.replace(comp.path.len()) == Some(comp.path.len()) {
                    return Err(e);
                }
                comp = match it.previous() {
                    Some(c) => c,
                    None => return Err(e),
                };
            }
        }
    }
}

// ─── Windows root parsing ───────────────────────────────────────────────────

/// Length of the root of a Windows path with its trailing separators, or `EINVAL` for a root it does not parse.
pub fn windows_root_end<T: PathChar>(path: &[T]) -> crate::Result<usize> {
    #[inline(always)]
    fn sep<T: PathChar>(c: T) -> bool {
        c == T::from_u8(b'/') || c == T::from_u8(b'\\')
    }

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
                // `\\?\` (verbatim).
                if c2 == T::from_u8(b'?') {
                    return windows_verbatim_root_end(path);
                }
                // `\\.\` (local device).
                if c2 == T::from_u8(b'.') {
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

/// [`windows_root_end`] for a path that starts with `\\?\`.
#[cold]
#[inline(never)]
fn windows_verbatim_root_end<T: PathChar>(path: &[T]) -> crate::Result<usize> {
    const PREFIX: usize = 4;
    let sep = |c: T| PathFormat::Windows.is_sep(c);
    let is = |i: usize, c: u8| path.get(i).is_some_and(|u| u.to_ascii_upper().eq_ascii(c));

    let mut i = PREFIX;
    if path.len() >= PREFIX + 2
        && crate::resolve_path::is_drive_letter_t(path[PREFIX])
        && path[PREFIX + 1].eq_ascii(b':')
    {
        i += 2;
        // `\\?\C:a` has no root.
        if i < path.len() && !sep(path[i]) {
            return Err(crate::Error::Sys(bun_errno::SystemErrno::EINVAL));
        }
    } else if is(i, b'U')
        && is(i + 1, b'N')
        && is(i + 2, b'C')
        && path.get(i + 3).is_some_and(|&c| sep(c))
    {
        i += 4;
        let server = i;
        while i < path.len() && !sep(path[i]) {
            i += 1;
        }
        let server_end = i;
        while i < path.len() && sep(path[i]) {
            i += 1;
        }
        let share = i;
        while i < path.len() && !sep(path[i]) {
            i += 1;
        }
        if server == server_end || share == i {
            return Err(crate::Error::Sys(bun_errno::SystemErrno::EINVAL));
        }
    } else {
        return Err(crate::Error::Sys(bun_errno::SystemErrno::EINVAL));
    }
    while i < path.len() && sep(path[i]) {
        i += 1;
    }
    Ok(i)
}

/// Writes `root` with single `\` separators (two at the start of `\\server`) and returns the length written.
pub fn write_windows_root<T: PathChar>(dst: &mut [T], root: &[T]) -> usize {
    let mut written = 0;
    let mut run = 0;
    for (i, &c) in root.iter().enumerate() {
        let is_sep = PathFormat::Windows.is_sep(c);
        run = if is_sep { run + 1 } else { 0 };
        // Only the leading run keeps a second separator, which is at index 1.
        if run > 1 && i != 1 {
            continue;
        }
        dst[written] = if is_sep { T::from_u8(b'\\') } else { c };
        written += 1;
    }
    written
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

        // A verbatim root is never a component, and the components keep its spelling.
        let parts = collect(b"\\\\?\\C:\\Users\\foo", PathFormat::Windows);
        assert_eq!(
            parts,
            vec![
                (&b"Users"[..], &b"\\\\?\\C:\\Users"[..]),
                (&b"foo"[..], &b"\\\\?\\C:\\Users\\foo"[..])
            ]
        );
        let parts = collect(b"\\\\?\\UNC\\server\\share\\dir", PathFormat::Windows);
        assert_eq!(
            parts,
            vec![(&b"dir"[..], &b"\\\\?\\UNC\\server\\share\\dir"[..])]
        );
        for root_only in [
            &b"\\\\?\\C:"[..],
            b"\\\\?\\C:\\",
            b"\\\\?\\UNC\\server\\share",
            b"\\\\?\\UNC\\server\\share\\",
        ] {
            assert_eq!(collect(root_only, PathFormat::Windows), vec![]);
        }

        assert!(ComponentIterator::<u8>::init(b"\\??\\C:\\", PathFormat::Windows).is_err());
        assert!(ComponentIterator::<u8>::init(b"\\\\\\x", PathFormat::Windows).is_err());

        let mut it = ComponentIterator::with_root_end(&b"C:\\a"[..], 3, PathFormat::Windows);
        assert_eq!(it.last().unwrap().path, b"C:\\a");
        assert!(it.previous().is_none());
    }

    /// The root end of `path` and the root as `write_windows_root` spells it, for u8 and for u16.
    #[track_caller]
    fn root(path: &str) -> Option<(usize, String)> {
        fn of<T: PathChar>(path: &[T]) -> Option<(usize, Vec<T>)> {
            let end = windows_root_end(path).ok()?;
            let mut written = vec![T::from_u8(0); end];
            let len = write_windows_root(&mut written, &path[..end]);
            written.truncate(len);
            Some((end, written))
        }
        let narrow = of(path.as_bytes()).map(|(end, root)| (end, String::from_utf8(root).unwrap()));
        let wide = of(&path.encode_utf16().collect::<Vec<u16>>())
            .map(|(end, root)| (end, String::from_utf16(&root).unwrap()));
        assert_eq!(narrow, wide, "{path:?}");
        narrow
    }

    #[test]
    fn windows_root_table() {
        let rows: &[(&str, Option<(usize, &str)>)] = &[
            ("", Some((0, ""))),
            ("a\\b", Some((0, ""))),
            ("\\a", Some((1, "\\"))),
            ("/a", Some((1, "\\"))),
            ("C:a", Some((2, "C:"))),
            ("C:\\a", Some((3, "C:\\"))),
            ("C:/a", Some((3, "C:\\"))),
            ("C:\\\\a", Some((4, "C:\\"))),
            ("\\\\server\\share", Some((14, "\\\\server\\share"))),
            ("\\\\server\\share\\a", Some((15, "\\\\server\\share\\"))),
            ("//server//share//a", Some((17, "\\\\server\\share\\"))),
            ("\\\\\\a", None),
            ("\\\\.\\C:\\a", None),
            ("\\??\\C:\\a", None),
            // `\\?\C:\`
            ("\\\\?\\C:", Some((6, "\\\\?\\C:"))),
            ("\\\\?\\C:\\a", Some((7, "\\\\?\\C:\\"))),
            ("\\\\?\\c:\\\\a", Some((8, "\\\\?\\c:\\"))),
            ("//?/C:/a", Some((7, "\\\\?\\C:\\"))),
            ("\\\\?\\C:a", None),
            ("\\\\?\\1:\\a", None),
            // `\\?\UNC\server\share\`
            (
                "\\\\?\\UNC\\server\\share",
                Some((20, "\\\\?\\UNC\\server\\share")),
            ),
            (
                "\\\\?\\UNC\\server\\share\\a",
                Some((21, "\\\\?\\UNC\\server\\share\\")),
            ),
            (
                "//?/unc/server//share//a",
                Some((23, "\\\\?\\unc\\server\\share\\")),
            ),
            ("\\\\?\\UNC", None),
            ("\\\\?\\UNC\\", None),
            ("\\\\?\\UNC\\server", None),
            ("\\\\?\\UNC\\server\\", None),
            ("\\\\?\\UNC\\\\server\\share", None),
            ("\\\\?\\UNCX\\server\\share", None),
            // No Win32 spelling.
            ("\\\\?\\", None),
            ("\\\\?\\a\\b", None),
            (
                "\\\\?\\Volume{b75e2c83-0000-0000-0000-602f00000000}\\a",
                None,
            ),
            ("\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\a", None),
        ];
        for &(path, want) in rows {
            let want = want.map(|(end, root)| (end, root.to_owned()));
            assert_eq!(root(path), want, "{path:?}");
        }
    }

    #[test]
    fn make_path_walks_a_verbatim_path() {
        let leaf = &b"\\\\?\\C:\\T\\fresh\\nested"[..];
        let parent = &b"\\\\?\\C:\\T\\fresh"[..];
        let it = ComponentIterator::init(leaf, PathFormat::Windows).unwrap();
        let mut asked = vec![];
        let mut created = std::collections::HashSet::new();
        let result: Result<(), &str> = make_path_with(it, |p| {
            asked.push(p);
            Ok(if p == parent || created.contains(parent) {
                created.insert(p);
                MakePathStep::Created
            } else {
                MakePathStep::NotFound("enoent")
            })
        });
        assert_eq!(result, Ok(()));
        assert_eq!(asked, [leaf, parent, leaf]);
    }

    #[test]
    fn make_path_terminates_on_uncreatable_component() {
        let it = ComponentIterator::init(&b"/t/dangling/x"[..], PathFormat::Posix).unwrap();
        let mut calls = 0usize;
        let result = make_path_with(it, |p| {
            calls += 1;
            assert!(calls < 100, "make_path_with did not terminate");
            match p {
                b"/t" | b"/t/dangling" => Ok(MakePathStep::Exists),
                b"/t/dangling/x" => Ok(MakePathStep::NotFound("enoent")),
                _ => panic!("unexpected prefix"),
            }
        });
        assert_eq!(result, Err("enoent"));

        // A NotFound that resolves after the parent is created still succeeds.
        let it = ComponentIterator::init(&b"/t/a/b"[..], PathFormat::Posix).unwrap();
        let mut created = std::collections::HashSet::new();
        let result: Result<(), &str> = make_path_with(it, |p| {
            Ok(if p == b"/t" || created.contains(p) {
                MakePathStep::Exists
            } else if p == b"/t/a" || created.contains(b"/t/a".as_slice()) {
                created.insert(p);
                MakePathStep::Created
            } else {
                MakePathStep::NotFound("enoent")
            })
        });
        assert_eq!(result, Ok(()));
        assert!(created.contains(b"/t/a/b".as_slice()));
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
}

//! Patch file parser and applier.

#![allow(non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

pub mod error;
pub use error::{ApplyError, Error, Result};

use core::mem;

use bun_core::strings;
use bun_core::{ZBox, ZStr};
use bun_paths as paths;
use bun_sys::{self as sys, Fd, FdExt};

bun_core::declare_scope!(Patch, visible);

const WHITESPACE: &[u8] = b" \t\n\r";

// ──────────────────────────────────────────────────────────────────────────
// PatchFilePart / PatchFile
// ──────────────────────────────────────────────────────────────────────────

/// All strings point to the original patch file text
// lifetime — every `&'a [u8]` in this module borrows from the
// original patch file text. The port generally avoids struct lifetimes, but
// this parser's whole output is borrowed; raw `*const [u8]` everywhere would
// be worse.
enum PatchFilePart<'a> {
    FilePatch(Box<FilePatch<'a>>),
    FileDeletion(Box<FileDeletion<'a>>),
    FileCreation(Box<FileCreation<'a>>),
    FileRename(Box<FileRename<'a>>),
    FileModeChange(Box<FileModeChange<'a>>),
}

#[derive(Default)]
pub struct PatchFile<'a> {
    pub(crate) parts: Vec<PatchFilePart<'a>>,
    pub skipped: Vec<SkippedSection<'a>>,
}

/// A section of the patch file that `apply` ignores. It is not an error, because older versions of
/// Bun wrote such sections and applied the rest of the patch.
pub struct SkippedSection<'a> {
    /// Byte offset of the section's first line in the patch file.
    pub offset: usize,
    pub path: Option<&'a [u8]>,
    /// The section says `Binary files a/x and b/x differ`, so the patch doesn't have the new
    /// content.
    pub is_binary: bool,
}

impl<'a> PatchFile<'a> {
    pub fn apply(&self, patch_dir: Fd) -> Result<(), ApplyError> {
        for part in &self.parts {
            match part {
                PatchFilePart::FileDeletion(d) => {
                    delete_file(patch_dir, d.path).map_err(|e| e.with_path(d.path))?;
                }
                // `rename_file` attributes its own errors, since either side can fail.
                PatchFilePart::FileRename(r) => rename_file(patch_dir, r)?,
                PatchFilePart::FileCreation(c) => {
                    create_file(patch_dir, c).map_err(|e| e.with_path(c.path))?;
                }
                PatchFilePart::FilePatch(f) => patch_file(patch_dir, f).map_err(|e| match e {
                    ApplyError::Sys(e) => ApplyError::Sys(e.with_path(f.path)),
                    e => e,
                })?,
                PatchFilePart::FileModeChange(m) => {
                    change_mode(patch_dir, m).map_err(|e| e.with_path(m.path))?;
                }
            }
        }
        Ok(())
    }
}

fn delete_file(patch_dir: Fd, path: &[u8]) -> sys::Result<()> {
    let (parent, base) = resolve_target(patch_dir, path, None)?;
    sys::unlinkat(parent.fd, &base)
}

fn rename_file(patch_dir: Fd, rename: &FileRename<'_>) -> sys::Result<()> {
    let (from_parent, from_base) = resolve_target(patch_dir, rename.from_path, None)
        .map_err(|e| e.with_path(rename.from_path))?;
    let (to_parent, to_base) = resolve_target(patch_dir, rename.to_path, Some(CREATED_DIR_MODE))
        .map_err(|e| e.with_path(rename.to_path))?;
    sys::renameat(from_parent.fd, &from_base, to_parent.fd, &to_base)
        .map_err(|e| e.with_path_dest(rename.from_path, rename.to_path))
}

fn create_file(patch_dir: Fd, creation: &FileCreation<'_>) -> sys::Result<()> {
    let (parent, base) = resolve_target(patch_dir, creation.path, Some(CREATED_DIR_MODE))?;
    let (fd, _) = open_target_file(
        parent.fd,
        &base,
        sys::O::CREAT | sys::O::RDWR,
        creation.mode.to_bun_mode(),
    )?;
    let _close = sys::CloseOnDrop::new(fd);
    // `O_TRUNC` isn't used, so that a target that gets rejected hasn't already been emptied.
    sys::ftruncate(fd, 0)?;

    // A `@@ -0,0 +0,0 @@` header with no body parses to a hunk with zero parts.
    let Some(first_part) = creation.hunk.as_ref().and_then(|h| h.parts.first()) else {
        return Ok(());
    };
    let mut contents = first_part.lines.join(&b'\n');
    if !first_part.no_newline_at_end_of_file {
        contents.push(b'\n');
    }
    sys::File::borrow(&fd).write_all(&contents)
}

fn patch_file(patch_dir: Fd, patch: &FilePatch<'_>) -> Result<(), ApplyError> {
    let (parent, base) = resolve_target(patch_dir, patch.path, None)?;
    apply_patch(patch, parent.fd, &base)
}

fn change_mode(patch_dir: Fd, change: &FileModeChange<'_>) -> sys::Result<()> {
    let (parent, base) = resolve_target(patch_dir, change.path, None)?;
    let (fd, _) = open_target_file(parent.fd, &base, sys::O::RDONLY, 0)?;
    // On Windows, `fchmod` needs a CRT-backed fd. Closing that fd also closes the HANDLE.
    let fd = fd.make_libuv_owned().map_err(|()| {
        fd.close();
        sys::Error::from_code(sys::E::EMFILE, sys::Tag::chmod)
    })?;
    let _close = sys::CloseOnDrop::new(fd);
    sys::fchmod(fd, change.new_mode.to_bun_mode())
}

/// Hunks are placed by matching their `-` side, like `git apply` does, because the `+` line numbers
/// can be stale.
fn apply_patch(patch: &FilePatch<'_>, parent: Fd, base: &ZStr) -> Result<(), ApplyError> {
    // One fd for the read and the write-back, so nothing can be swapped in between them.
    let (file_fd, stat) = open_target_file(parent, base, sys::O::RDWR, 0)?;
    let _close_file = sys::CloseOnDrop::new(file_fd);

    if stat.st_size as u64 > MAX_PATCH_TARGET_BYTES {
        return Err(sys::Error::from_code(sys::E::EINVAL, sys::Tag::read).into());
    }
    let filebuf: Vec<u8> = sys::File::borrow(&file_fd)
        .read_to_end()
        .map_err(|_| sys::Error::from_code(sys::E::EINVAL, sys::Tag::read))?;

    let mut lines: Vec<&[u8]> = strings::split(&filebuf, b"\n").collect();
    // The empty string after the final `\n` is not a line.
    let mut final_newline = lines.pop_if(|last| last.is_empty()).is_some();

    let does_not_apply = |hunk_index: usize, hunk: &Hunk<'_>| ApplyError::HunkDoesNotApply {
        path: Box::from(patch.path),
        hunk: hunk_index + 1,
        line: hunk.header.original.start,
    };

    // With the hunks sorted by start line, one pass over the old lines is enough. Only a
    // hand-edited patch has them out of order.
    let mut hunks: Vec<(usize, &Hunk<'_>)> = patch.hunks.iter().enumerate().collect();
    hunks.sort_by_key(|(_, hunk)| hunk.header.original.start);
    let mut patched: Vec<&[u8]> = Vec::with_capacity(lines.len());
    // Index of the first old line that has not yet been copied to `patched` or deleted.
    let mut line_cursor: usize = 0;
    for (hunk_index, hunk) in hunks {
        // `\ No newline at end of file` ends that side of the file: only an insertion may follow it.
        // A marker on a context line is exempt: with `git diff --ignore-cr-at-eol` it belongs to
        // the new side only, and deletions can follow it.
        if let Some(i) = hunk
            .parts
            .iter()
            .position(|p| p.no_newline_at_end_of_file && p.ty != PartType::Context)
        {
            if hunk.parts[i + 1..]
                .iter()
                .any(|p| p.ty != PartType::Insertion)
            {
                return Err(does_not_apply(hunk_index, hunk));
            }
        }

        let original_start = hunk.header.original.start as usize;
        let hunk_start = if hunk.header.original.len == 0 {
            // A `-N,0` header has no old lines to match. Insert after line N, where 0 is the top.
            if original_start < line_cursor || original_start > lines.len() {
                return Err(does_not_apply(hunk_index, hunk));
            }
            original_start
        } else {
            let expected = original_start as isize - 1 - line_cursor as isize;
            match find_hunk_position(hunk, &lines[line_cursor..], expected) {
                Some(idx) => line_cursor + idx,
                None => return Err(does_not_apply(hunk_index, hunk)),
            }
        };
        patched.extend_from_slice(&lines[line_cursor..hunk_start]);
        line_cursor = hunk_start;

        for part in &hunk.parts {
            if part.ty == PartType::Insertion {
                patched.extend_from_slice(&part.lines);
                continue;
            }
            // The match above already guarantees that these lines exist. This is only a safeguard.
            let Some(old) = lines.get(line_cursor..line_cursor + part.lines.len()) else {
                return Err(does_not_apply(hunk_index, hunk));
            };
            if part.ty == PartType::Context {
                patched.extend_from_slice(old);
            }
            line_cursor += old.len();
        }

        // A hunk that reaches the end of the file decides whether the file ends in a newline.
        if line_cursor == lines.len() {
            let last_kept = hunk.parts.iter().rfind(|p| p.ty != PartType::Deletion);
            final_newline = !last_kept.is_some_and(|p| p.no_newline_at_end_of_file);
        }
    }
    patched.extend_from_slice(&lines[line_cursor..]);
    if final_newline {
        patched.push(b"");
    }

    sys::ftruncate(file_fd, 0)?;
    // `read_to_end` advanced the cursor on Windows (POSIX reads use `pread`).
    sys::set_file_offset(file_fd, 0)?;
    sys::File::borrow(&file_fd).write_all(&patched.join(&b'\n'))?;
    Ok(())
}

/// The index nearest to `expected` where the hunk's `-` side matches, forward first.
fn find_hunk_position(hunk: &Hunk<'_>, lines: &[&[u8]], expected: isize) -> Option<usize> {
    let last = lines.len() as isize;
    // A header start far outside the file would otherwise spin until `offset` reaches it.
    let expected = expected.clamp(0, last);
    let mut offset: isize = 0;
    loop {
        let forward = expected + offset;
        let backward = expected - offset;
        if forward > last && backward < 0 {
            return None;
        }
        if (0..=last).contains(&forward) && hunk_matches_at(hunk, lines, forward as usize) {
            return Some(forward as usize);
        }
        if offset != 0
            && (0..=last).contains(&backward)
            && hunk_matches_at(hunk, lines, backward as usize)
        {
            return Some(backward as usize);
        }
        offset += 1;
    }
}

/// Trailing whitespace is ignored (patch-package's `linesAreEqual`) so CRLF files match.
fn hunk_matches_at(hunk: &Hunk<'_>, lines: &[&[u8]], start: usize) -> bool {
    let mut cursor = start;
    for part in &hunk.parts {
        match part.ty {
            PartType::Insertion => {}
            PartType::Context | PartType::Deletion => {
                for patch_line in &part.lines {
                    let Some(file_line) = lines.get(cursor) else {
                        return false;
                    };
                    if strings::trim_right(file_line, WHITESPACE)
                        != strings::trim_right(patch_line, WHITESPACE)
                    {
                        return false;
                    }
                    cursor += 1;
                }
            }
        }
    }
    true
}

/// A larger `st_size` is an error rather than an unbounded allocation.
const MAX_PATCH_TARGET_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// A new file's header mode only describes the file. A directory created with 0o644 couldn't be
/// entered.
const CREATED_DIR_MODE: sys::Mode = 0o755;

/// `patch_dir` itself for single-component paths (not closed), an owned fd otherwise.
struct ParentDir {
    fd: Fd,
    owned: bool,
}

impl Drop for ParentDir {
    fn drop(&mut self) {
        if self.owned {
            self.fd.close();
        }
    }
}

/// The separators [`paths::dirname_simple`] splits on, so the walk and the basename agree.
const PATH_SEPS: &[u8] = if cfg!(windows) { b"/\\" } else { b"/" };

/// The verified directory holding `path`'s final component, and that component.
fn resolve_target(
    patch_dir: Fd,
    path: &[u8],
    create_mode: Option<sys::Mode>,
) -> sys::Result<(ParentDir, ZBox)> {
    if !is_safe_patch_path(path) {
        return Err(sys::Error::from_code(sys::E::EINVAL, sys::Tag::open));
    }
    let parent = open_parent_beneath(patch_dir, path, create_mode)?;
    let dir = paths::dirname_simple(path);
    let base = if dir.is_empty() {
        path
    } else {
        &path[dir.len() + 1..]
    };
    Ok((parent, ZBox::from_vec_with_nul(base.to_vec())))
}

/// One component at a time, refusing symlinks. [`is_safe_patch_path`] has ruled out `..`.
fn open_parent_beneath(
    patch_dir: Fd,
    path: &[u8],
    create_mode: Option<sys::Mode>,
) -> sys::Result<ParentDir> {
    let mut cur = ParentDir {
        fd: patch_dir,
        owned: false,
    };
    for component in strings::split_any(paths::dirname_simple(path), PATH_SEPS) {
        if component.is_empty() || component == b"." {
            continue;
        }
        let component_z = ZBox::from_vec_with_nul(component.to_vec());
        cur = ParentDir {
            fd: open_dir_component(cur.fd, &component_z, create_mode)?,
            owned: true,
        };
    }
    Ok(cur)
}

/// `O_NOFOLLOW` here opens the reparse point itself and `fstat` hides it. Not atomic with the open.
#[cfg(windows)]
fn reject_reparse_point(dir: Fd, name: &ZStr) -> sys::Result<()> {
    match sys::get_file_attributes_at(dir, name) {
        Ok(attrs) if attrs.is_reparse_point => {
            Err(sys::Error::from_code(sys::E::ELOOP, sys::Tag::open))
        }
        // It doesn't exist or can't be read. The open that follows reports the real error.
        _ => Ok(()),
    }
}

fn open_dir_component(
    dir: Fd,
    component: &ZStr,
    create_mode: Option<sys::Mode>,
) -> sys::Result<Fd> {
    #[cfg(windows)]
    reject_reparse_point(dir, component)?;
    let flags = sys::O::RDONLY | sys::O::DIRECTORY | sys::O::NOFOLLOW;
    let open_err = match sys::openat(dir, component, flags, 0) {
        Ok(fd) => return Ok(fd),
        Err(e) => e,
    };
    let Some(mode) = create_mode.filter(|_| open_err.get_errno() == sys::E::ENOENT) else {
        return Err(symlink_component_err(dir, component, open_err));
    };
    match sys::mkdirat(dir, component, mode) {
        Ok(()) => {}
        // Another process created it first. The open below verifies whatever is there now.
        Err(e) if e.get_errno() == sys::E::EEXIST => {}
        Err(e) => return Err(e),
    }
    sys::openat(dir, component, flags, 0).map_err(|e| symlink_component_err(dir, component, e))
}

/// `O_NOFOLLOW` on a symlink: ENOTDIR or ELOOP on Linux, EMLINK on FreeBSD. ELOOP everywhere.
fn symlink_component_err(dir: Fd, component: &ZStr, e: sys::Error) -> sys::Error {
    if matches!(
        e.get_errno(),
        sys::E::ENOTDIR | sys::E::ELOOP | sys::E::EMLINK
    ) && let Ok(st) = sys::lstatat(dir, component)
        && sys::S::ISLNK(st.st_mode as u32)
    {
        return sys::Error::from_code(sys::E::ELOOP, sys::Tag::open);
    }
    e
}

/// Only accepts a regular file with one hard link, because a second link could reach the inode from
/// outside the patch directory.
fn open_target_file(
    parent: Fd,
    base: &ZStr,
    flags: i32,
    mode: sys::Mode,
) -> sys::Result<(Fd, sys::Stat)> {
    #[cfg(windows)]
    reject_reparse_point(parent, base)?;
    // Without `O_NONBLOCK`, opening a FIFO blocks before the `!ISREG` rejection below.
    let nonblock = if cfg!(windows) { 0 } else { sys::O::NONBLOCK };
    let fd = sys::openat(parent, base, flags | sys::O::NOFOLLOW | nonblock, mode)
        .map_err(|e| symlink_component_err(parent, base, e))?;
    let stat = match sys::fstat(fd) {
        Ok(st) => st,
        Err(e) => {
            fd.close();
            return Err(e);
        }
    };
    if !sys::S::ISREG(stat.st_mode as u32) {
        fd.close();
        return Err(sys::Error::from_code(sys::E::EINVAL, sys::Tag::open));
    }
    if stat.st_nlink > 1 {
        fd.close();
        return Err(sys::Error::from_code(sys::E::EMLINK, sys::Tag::open));
    }
    Ok((fd, stat))
}

// ──────────────────────────────────────────────────────────────────────────
// FileDeets
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct FileDeets<'a> {
    diff_line_from_path: Option<&'a [u8]>,
    diff_line_to_path: Option<&'a [u8]>,
    old_mode: Option<&'a [u8]>,
    new_mode: Option<&'a [u8]>,
    deleted_file_mode: Option<&'a [u8]>,
    new_file_mode: Option<&'a [u8]>,
    rename_from: Option<&'a [u8]>,
    rename_to: Option<&'a [u8]>,
    before_hash: Option<&'a [u8]>,
    after_hash: Option<&'a [u8]>,
    from_path: Option<&'a [u8]>,
    to_path: Option<&'a [u8]>,
    hunks: Vec<Hunk<'a>>,
    is_binary: bool,
    /// Byte offset of the section's first line in the patch file.
    offset: usize,
}

impl<'a> FileDeets<'a> {
    fn nullify_empty_strings(&mut self) {
        macro_rules! nullify {
            ($($f:ident),*) => {$(
                if matches!(self.$f, Some(v) if v.is_empty()) {
                    self.$f = None;
                }
            )*};
        }
        nullify!(
            diff_line_from_path,
            diff_line_to_path,
            old_mode,
            new_mode,
            deleted_file_mode,
            new_file_mode,
            rename_from,
            rename_to,
            before_hash,
            after_hash,
            from_path,
            to_path
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PatchMutationPart / Hunk
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct PatchMutationPart<'a> {
    pub(crate) ty: PartType,
    pub(crate) lines: Vec<&'a [u8]>,
    /// This technically can only be on the last part of a hunk
    pub(crate) no_newline_at_end_of_file: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum PartType {
    #[default]
    Context,
    Insertion,
    Deletion,
}

#[derive(Default)]
struct Hunk<'a> {
    pub(crate) header: Header,
    pub(crate) parts: Vec<PatchMutationPart<'a>>,
    /// Byte offset of the `@@` line in the patch file.
    offset: usize,
}

#[derive(Copy, Clone)]
struct HeaderRange {
    pub(crate) start: u32,
    pub(crate) len: u32,
}

impl Default for HeaderRange {
    fn default() -> Self {
        Self { start: 1, len: 0 }
    }
}

#[derive(Copy, Clone, Default)]
pub struct Header {
    pub(crate) original: HeaderRange,
    pub(crate) patched: HeaderRange,
}

impl<'a> Hunk<'a> {
    /// `pending` is a part the parser has not pushed onto `parts` yet.
    fn verify_integrity(&self, pending: Option<&PatchMutationPart<'a>>) -> bool {
        let mut original_length: usize = 0;
        let mut patched_length: usize = 0;

        for part in self.parts.iter().chain(pending) {
            match part.ty {
                PartType::Context => {
                    patched_length += part.lines.len();
                    original_length += part.lines.len();
                }
                PartType::Insertion => patched_length += part.lines.len(),
                PartType::Deletion => original_length += part.lines.len(),
            }
        }

        original_length == self.header.original.len as usize
            && patched_length == self.header.patched.len as usize
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FileMode
// ──────────────────────────────────────────────────────────────────────────

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
enum FileMode {
    NonExecutable = 0o644,
    Executable = 0o755,
}

impl FileMode {
    fn to_bun_mode(self) -> sys::Mode {
        sys::Mode::try_from(self as u32).expect("int cast")
    }

    fn from_u32(mode: u32) -> Option<FileMode> {
        match mode {
            0o644 => Some(FileMode::NonExecutable),
            0o755 => Some(FileMode::Executable),
            _ => None,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FileRename / FileModeChange / FilePatch / FileDeletion / FileCreation
// ──────────────────────────────────────────────────────────────────────────

struct FileRename<'a> {
    pub(crate) from_path: &'a [u8],
    pub(crate) to_path: &'a [u8],
}

struct FileModeChange<'a> {
    pub(crate) path: &'a [u8],
    pub(crate) old_mode: FileMode,
    pub(crate) new_mode: FileMode,
}

struct FilePatch<'a> {
    pub(crate) path: &'a [u8],
    pub(crate) hunks: Vec<Hunk<'a>>,
    pub(crate) before_hash: Option<&'a [u8]>,
    pub(crate) after_hash: Option<&'a [u8]>,
}

struct FileDeletion<'a> {
    pub(crate) path: &'a [u8],
    pub(crate) mode: FileMode,
    pub(crate) hunk: Option<Box<Hunk<'a>>>,
    pub(crate) hash: Option<&'a [u8]>,
}

struct FileCreation<'a> {
    pub(crate) path: &'a [u8],
    pub(crate) mode: FileMode,
    pub(crate) hunk: Option<Box<Hunk<'a>>>,
    pub(crate) hash: Option<&'a [u8]>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum PatchFilePartKind {
    FilePatch,
    FileDeletion,
    FileCreation,
    FileRename,
    FileModeChange,
}

// ──────────────────────────────────────────────────────────────────────────
// json_fmt — JSON `Display` adapter for `PatchFile`
//
// Used only by the testing bindings in `bun_patch_jsc`. The output shape must
// match exactly for the snapshot tests in `test/js/bun/patch/patch.test.ts`
// to pass:
//   - struct           → `{"field":...}` in field-declaration order
//   - `Vec<T>`         → `{"items":[...],"capacity":N}`
//   - byte string      → JSON string
//   - enum             → `"tag_name"`
//   - tagged union     → `{"tag_name":payload}`
//   - `Option<T>`      → `null` or value
//   - `Box<T>`         → serialized as the pointee
// ──────────────────────────────────────────────────────────────────────────

/// Returns a `Display` adapter that serializes `patchfile` as JSON.
pub fn json_fmt<'a, 'b>(patchfile: &'b PatchFile<'a>) -> impl core::fmt::Display + 'b {
    PatchFileJsonFmt(patchfile)
}

struct PatchFileJsonFmt<'a, 'b>(&'b PatchFile<'a>);

impl core::fmt::Display for PatchFileJsonFmt<'_, '_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        json::write_patch_file(f, self.0)
    }
}

mod json {
    use super::*;
    use core::fmt::{Result, Write};

    use bun_core::fmt::encode_json_string as write_str;

    fn write_opt_str(w: &mut impl Write, s: Option<&[u8]>) -> Result {
        match s {
            None => w.write_str("null"),
            Some(s) => write_str(w, s),
        }
    }

    /// Serialize a `Vec<T>` as `{"items":[...],"capacity":N}` (the shape the
    /// snapshot tests expect).
    fn write_list<W: Write, T>(
        w: &mut W,
        v: &Vec<T>,
        mut elem: impl FnMut(&mut W, &T) -> Result,
    ) -> Result {
        w.write_str("{\"items\":[")?;
        for (i, e) in v.iter().enumerate() {
            if i != 0 {
                w.write_char(',')?;
            }
            elem(w, e)?;
        }
        write!(w, "],\"capacity\":{}}}", v.capacity())
    }

    fn file_mode_tag(m: FileMode) -> &'static str {
        match m {
            FileMode::NonExecutable => "non_executable",
            FileMode::Executable => "executable",
        }
    }

    fn part_type_tag(t: PartType) -> &'static str {
        match t {
            PartType::Context => "context",
            PartType::Insertion => "insertion",
            PartType::Deletion => "deletion",
        }
    }

    fn write_header(w: &mut impl Write, h: &Header) -> Result {
        write!(
            w,
            "{{\"original\":{{\"start\":{},\"len\":{}}},\"patched\":{{\"start\":{},\"len\":{}}}}}",
            h.original.start, h.original.len, h.patched.start, h.patched.len,
        )
    }

    fn write_mutation_part(w: &mut impl Write, p: &PatchMutationPart<'_>) -> Result {
        // JSON field name is `type`; the Rust field is `ty`.
        write!(w, "{{\"type\":\"{}\",\"lines\":", part_type_tag(p.ty))?;
        write_list(w, &p.lines, |w, line| write_str(w, line))?;
        write!(
            w,
            ",\"no_newline_at_end_of_file\":{}}}",
            p.no_newline_at_end_of_file
        )
    }

    fn write_hunk(w: &mut impl Write, h: &Hunk<'_>) -> Result {
        w.write_str("{\"header\":")?;
        write_header(w, &h.header)?;
        w.write_str(",\"parts\":")?;
        write_list(w, &h.parts, |w, p| write_mutation_part(w, p))?;
        w.write_char('}')
    }

    fn write_opt_hunk(w: &mut impl Write, h: &Option<Box<Hunk<'_>>>) -> Result {
        match h {
            None => w.write_str("null"),
            Some(h) => write_hunk(w, h),
        }
    }

    fn write_file_patch(w: &mut impl Write, fp: &FilePatch<'_>) -> Result {
        w.write_str("{\"path\":")?;
        write_str(w, fp.path)?;
        w.write_str(",\"hunks\":")?;
        write_list(w, &fp.hunks, |w, h| write_hunk(w, h))?;
        w.write_str(",\"before_hash\":")?;
        write_opt_str(w, fp.before_hash)?;
        w.write_str(",\"after_hash\":")?;
        write_opt_str(w, fp.after_hash)?;
        w.write_char('}')
    }

    /// A `FileDeletion` or a `FileCreation`.
    fn write_whole_file(
        w: &mut impl Write,
        path: &[u8],
        mode: FileMode,
        hunk: &Option<Box<Hunk<'_>>>,
        hash: Option<&[u8]>,
    ) -> Result {
        w.write_str("{\"path\":")?;
        write_str(w, path)?;
        write!(w, ",\"mode\":\"{}\",\"hunk\":", file_mode_tag(mode))?;
        write_opt_hunk(w, hunk)?;
        w.write_str(",\"hash\":")?;
        write_opt_str(w, hash)?;
        w.write_char('}')
    }

    fn write_file_rename(w: &mut impl Write, fr: &FileRename<'_>) -> Result {
        w.write_str("{\"from_path\":")?;
        write_str(w, fr.from_path)?;
        w.write_str(",\"to_path\":")?;
        write_str(w, fr.to_path)?;
        w.write_char('}')
    }

    fn write_file_mode_change(w: &mut impl Write, fm: &FileModeChange<'_>) -> Result {
        w.write_str("{\"path\":")?;
        write_str(w, fm.path)?;
        write!(
            w,
            ",\"old_mode\":\"{}\",\"new_mode\":\"{}\"}}",
            file_mode_tag(fm.old_mode),
            file_mode_tag(fm.new_mode),
        )
    }

    fn write_part(w: &mut impl Write, part: &PatchFilePart<'_>) -> Result {
        match part {
            PatchFilePart::FilePatch(p) => {
                w.write_str("{\"file_patch\":")?;
                write_file_patch(w, p)?;
            }
            PatchFilePart::FileDeletion(p) => {
                w.write_str("{\"file_deletion\":")?;
                write_whole_file(w, p.path, p.mode, &p.hunk, p.hash)?;
            }
            PatchFilePart::FileCreation(p) => {
                w.write_str("{\"file_creation\":")?;
                write_whole_file(w, p.path, p.mode, &p.hunk, p.hash)?;
            }
            PatchFilePart::FileRename(p) => {
                w.write_str("{\"file_rename\":")?;
                write_file_rename(w, p)?;
            }
            PatchFilePart::FileModeChange(p) => {
                w.write_str("{\"file_mode_change\":")?;
                write_file_mode_change(w, p)?;
            }
        }
        w.write_char('}')
    }

    pub(super) fn write_patch_file(w: &mut impl Write, pf: &PatchFile<'_>) -> Result {
        w.write_str("{\"parts\":")?;
        write_list(w, &pf.parts, |w, p| write_part(w, p))?;
        w.write_char('}')
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ParseErr
// ──────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Copy, Clone, PartialEq, Eq)]
pub enum ParseErr {
    #[error("unrecognized_pragma")]
    unrecognized_pragma,
    #[error("no_newline_at_eof_pragma_encountered_without_context")]
    no_newline_at_eof_pragma_encountered_without_context,
    #[error("hunk_lines_encountered_before_hunk_header")]
    hunk_lines_encountered_before_hunk_header,
    #[error("hunk_header_integrity_check_failed")]
    hunk_header_integrity_check_failed,
    #[error("bad_diff_line")]
    bad_diff_line,
    #[error("bad_header_line")]
    bad_header_line,
    #[error("rename_from_and_to_not_give")]
    rename_from_and_to_not_give,
    #[error("no_path_given_for_file_deletion")]
    no_path_given_for_file_deletion,
    #[error("no_path_given_for_file_creation")]
    no_path_given_for_file_creation,
    #[error("bad_file_mode")]
    bad_file_mode,
    #[error("git_binary_patch_not_supported")]
    git_binary_patch_not_supported,
    #[error("no_path_given_for_hunk")]
    no_path_given_for_hunk,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct ParseErrAt {
    pub err: ParseErr,
    /// Byte offset in the patch file of the line that caused the error.
    pub offset: usize,
}

// ──────────────────────────────────────────────────────────────────────────
// parsePatchFile / patchFileSecondPass
// ──────────────────────────────────────────────────────────────────────────

/// NOTE: the returned `PatchFile` struct will contain pointers to original file text so make sure to not deallocate `file`
pub fn parse_patch_file(file: &[u8]) -> Result<PatchFile<'_>, ParseErrAt> {
    let mut lines_parser = PatchLinesParser::default();
    let parsed = lines_parser.parse(file).and_then(|()| {
        // reshaped for borrowck — take ownership of result vec instead of slicing.
        let mut files = mem::take(&mut lines_parser.result);
        patch_file_second_pass(&mut files, &mut lines_parser.offset)
    });
    parsed.map_err(|err| ParseErrAt {
        err,
        offset: lines_parser.offset,
    })
}

/// On error, `offset` is the byte offset of the line at fault: either the section's first line or a
/// hunk's `@@` line.
fn patch_file_second_pass<'a>(
    files: &mut [FileDeets<'a>],
    offset: &mut usize,
) -> Result<PatchFile<'a>, ParseErr> {
    let mut result = PatchFile::default();

    for file in files.iter_mut() {
        *offset = file.offset;
        let parts_before = result.parts.len();
        let ty: PatchFilePartKind = if file.rename_from.is_some_and(|s| !s.is_empty()) {
            PatchFilePartKind::FileRename
        } else if file.deleted_file_mode.is_some_and(|s| !s.is_empty()) {
            PatchFilePartKind::FileDeletion
        } else if file.new_file_mode.is_some_and(|s| !s.is_empty()) {
            PatchFilePartKind::FileCreation
        } else if !file.hunks.is_empty() {
            PatchFilePartKind::FilePatch
        } else {
            PatchFilePartKind::FileModeChange
        };

        let mut destination_file_path: Option<&'a [u8]> = None;

        match ty {
            PatchFilePartKind::FileRename => {
                if file.rename_from.is_none() || file.rename_to.is_none() {
                    return Err(ParseErr::rename_from_and_to_not_give);
                }

                result
                    .parts
                    .push(PatchFilePart::FileRename(Box::new(FileRename {
                        from_path: file.rename_from.unwrap(),
                        to_path: file.rename_to.unwrap(),
                    })));

                destination_file_path = file.rename_to;
            }
            PatchFilePartKind::FileDeletion => {
                let path = file
                    .from_path
                    .or(file.diff_line_from_path)
                    .ok_or(ParseErr::no_path_given_for_file_deletion)?;
                result
                    .parts
                    .push(PatchFilePart::FileDeletion(Box::new(FileDeletion {
                        hunk: file.hunks.first_mut().map(mem::take).map(Box::new),
                        path,
                        mode: parse_file_mode(file.deleted_file_mode.unwrap())
                            .ok_or(ParseErr::bad_file_mode)?,
                        hash: file.before_hash,
                    })));
            }
            // The patch doesn't have the content, and creating an empty file isn't what it asks
            // for.
            PatchFilePartKind::FileCreation if file.is_binary => {}
            PatchFilePartKind::FileCreation => {
                let path = file
                    .to_path
                    .or(file.diff_line_to_path)
                    .ok_or(ParseErr::no_path_given_for_file_creation)?;
                result
                    .parts
                    .push(PatchFilePart::FileCreation(Box::new(FileCreation {
                        hunk: file.hunks.first_mut().map(mem::take).map(Box::new),
                        path,
                        mode: parse_file_mode(file.new_file_mode.unwrap())
                            .ok_or(ParseErr::bad_file_mode)?,
                        hash: file.after_hash,
                    })));
            }
            PatchFilePartKind::FilePatch | PatchFilePartKind::FileModeChange => {
                destination_file_path = file.to_path.or(file.diff_line_to_path);
            }
        }

        if let (Some(path), Some(old_mode), Some(new_mode)) =
            (destination_file_path, file.old_mode, file.new_mode)
            && old_mode != new_mode
        {
            result
                .parts
                .push(PatchFilePart::FileModeChange(Box::new(FileModeChange {
                    path,
                    old_mode: parse_file_mode(old_mode).ok_or(ParseErr::bad_file_mode)?,
                    new_mode: parse_file_mode(new_mode).ok_or(ParseErr::bad_file_mode)?,
                })));
        }

        if let Some(path) = destination_file_path
            && !file.hunks.is_empty()
        {
            result
                .parts
                .push(PatchFilePart::FilePatch(Box::new(FilePatch {
                    path,
                    hunks: mem::take(&mut file.hunks),
                    before_hash: file.before_hash,
                    after_hash: file.after_hash,
                })));
        }

        // A section produces no part if it is, for example, a file copy or text that is not a diff.
        let has_no_part = result.parts.len() == parts_before;
        if has_no_part && let Some(hunk) = file.hunks.first() {
            *offset = hunk.offset;
            return Err(ParseErr::no_path_given_for_hunk);
        }
        let is_binary = file.is_binary && ty != PatchFilePartKind::FileDeletion;
        if has_no_part || is_binary {
            result.skipped.push(SkippedSection {
                offset: file.offset,
                path: file.to_path.or(file.diff_line_to_path),
                is_binary,
            });
        }
    }

    Ok(result)
}

fn parse_file_mode(mode: &[u8]) -> Option<FileMode> {
    let parsed_mode = bun_core::parse_int::<u32>(mode, 8).ok()? & 0o777;
    FileMode::from_u32(parsed_mode)
}

/// True for a relative path that cannot leave the folder it starts in, as long as no component of
/// the path is a symlink.
pub fn is_safe_patch_path(path: &[u8]) -> bool {
    !path.is_empty()
        && !strings::contains_char(path, 0)
        && !paths::is_absolute_loose(path)
        // On Windows, openat strips a drive prefix from a component, so `C:..` resolves to a real
        // `..`.
        && !(cfg!(windows) && strings::contains_char(path, b':'))
        && !strings::split_any(path, b"/\\").any(|part| part == b"..")
}

// ──────────────────────────────────────────────────────────────────────────
// ScalarSplitIter / LookbackIterator
// ──────────────────────────────────────────────────────────────────────────

/// Split-on-scalar iterator exposing `.index` so callers
/// can rewind / inspect cursor (Rust's `slice::Split` does not expose this).
struct ScalarSplitIter<'a> {
    buffer: &'a [u8],
    /// `None` once iteration is exhausted.
    index: Option<usize>,
    delimiter: u8,
}

impl<'a> ScalarSplitIter<'a> {
    fn new(buffer: &'a [u8], delimiter: u8) -> Self {
        Self {
            buffer,
            index: Some(0),
            delimiter,
        }
    }

    fn next(&mut self) -> Option<&'a [u8]> {
        let start = self.index?;
        let end = match strings::index_of_char(&self.buffer[start..], self.delimiter) {
            Some(pos) => {
                let pos = pos as usize;
                self.index = Some(start + pos + 1);
                start + pos
            }
            None => {
                self.index = None;
                self.buffer.len()
            }
        };
        Some(&self.buffer[start..end])
    }
}

struct LookbackIterator<'a> {
    inner: ScalarSplitIter<'a>,
    prev_index: usize,
}

impl<'a> LookbackIterator<'a> {
    fn from_inner(inner: ScalarSplitIter<'a>) -> Self {
        Self {
            inner,
            prev_index: 0,
        }
    }

    fn next(&mut self) -> Option<&'a [u8]> {
        self.prev_index = self.inner.index.unwrap_or(self.prev_index);
        self.inner.next()
    }

    fn back(&mut self) {
        self.inner.index = Some(self.prev_index);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PatchLinesParser
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct PatchLinesParser<'a> {
    result: Vec<FileDeets<'a>>,
    current_file_patch: FileDeets<'a>,
    state: ParserState,
    current_hunk: Option<Hunk<'a>>,
    current_hunk_mutation_part: Option<PatchMutationPart<'a>>,
    /// Byte offset of the line being parsed or, after an error, of the line that caused it.
    offset: usize,
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum ParserState {
    #[default]
    ParsingHeader,
    ParsingHunks,
}

impl<'a> PatchLinesParser<'a> {
    fn parse(&mut self, file_: &'a [u8]) -> Result<(), ParseErr> {
        let file = file_.strip_suffix(b"\n").unwrap_or(file_);
        if file.is_empty() {
            return Ok(());
        }
        let mut lines = LookbackIterator::from_inner(ScalarSplitIter::new(file, b'\n'));

        while let Some(line) = lines.next() {
            self.offset = lines.prev_index;
            match self.state {
                ParserState::ParsingHeader => {
                    if line.starts_with(b"@@") {
                        self.state = ParserState::ParsingHunks;
                        self.current_file_patch.hunks = Vec::new();
                        lines.back();
                    } else if line.starts_with(b"diff --git ") {
                        if self.current_file_patch.diff_line_from_path.is_some() {
                            self.commit_file_patch();
                        }
                        // Equivalent to:
                        // const match = line.match(/^diff --git a\/(.*?) b\/(.*?)\s*$/)
                        // currentFilePatch.diffLineFromPath = match[1]
                        // currentFilePatch.diffLineToPath = match[2]
                        let m = parse_diff_line_paths(line).ok_or(
                            // TODO: store line somewhere
                            ParseErr::bad_diff_line,
                        )?;
                        self.current_file_patch.diff_line_from_path = Some(m.0);
                        self.current_file_patch.diff_line_to_path = Some(m.1);
                    } else if line.starts_with(b"old mode ") {
                        self.current_file_patch.old_mode =
                            Some(strings::trim(&line[b"old mode ".len()..], WHITESPACE));
                    } else if line.starts_with(b"new mode ") {
                        self.current_file_patch.new_mode =
                            Some(strings::trim(&line[b"new mode ".len()..], WHITESPACE));
                    } else if line.starts_with(b"deleted file mode ") {
                        self.current_file_patch.deleted_file_mode = Some(strings::trim(
                            &line[b"deleted file mode ".len()..],
                            WHITESPACE,
                        ));
                    } else if line.starts_with(b"new file mode ") {
                        self.current_file_patch.new_file_mode =
                            Some(strings::trim(&line[b"new file mode ".len()..], WHITESPACE));
                    } else if line.starts_with(b"rename from ") {
                        self.current_file_patch.rename_from =
                            Some(strings::trim(&line[b"rename from ".len()..], WHITESPACE));
                    } else if line.starts_with(b"rename to ") {
                        self.current_file_patch.rename_to =
                            Some(strings::trim(&line[b"rename to ".len()..], WHITESPACE));
                    } else if line.starts_with(b"index ") {
                        let Some(hashes) = parse_diff_hashes(&line[b"index ".len()..]) else {
                            continue;
                        };
                        self.current_file_patch.before_hash = Some(hashes.0);
                        self.current_file_patch.after_hash = Some(hashes.1);
                    } else if line.starts_with(b"--- ") {
                        // The line may be shorter than "--- a/" (e.g. a bare "--- ");
                        // treat the missing path as empty like the JS implementation's
                        // `line.slice("--- a/".length)`.
                        self.current_file_patch.from_path = Some(strings::trim(
                            line.get(b"--- a/".len()..).unwrap_or_default(),
                            WHITESPACE,
                        ));
                    } else if line.starts_with(b"+++ ") {
                        self.current_file_patch.to_path = Some(strings::trim(
                            line.get(b"+++ b/".len()..).unwrap_or_default(),
                            WHITESPACE,
                        ));
                    } else if line.starts_with(b"Binary files ") {
                        self.current_file_patch.is_binary = true;
                    } else if line.starts_with(b"GIT binary patch")
                        && self.current_file_patch.deleted_file_mode.is_none()
                    {
                        return Err(ParseErr::git_binary_patch_not_supported);
                    }
                }
                ParserState::ParsingHunks => {
                    // A legacy file header, or a deletion line unless the hunk is already complete.
                    if line.starts_with(b"--- a/")
                        && self.current_hunk.as_ref().is_some_and(|hunk| {
                            hunk.verify_integrity(self.current_hunk_mutation_part.as_ref())
                        })
                    {
                        self.state = ParserState::ParsingHeader;
                        self.commit_file_patch();
                        lines.back();
                        continue;
                    }
                    let ty = match line.first().copied() {
                        // treat blank lines as context
                        None | Some(b' ' | b'\r') => PartType::Context,
                        Some(b'-') => PartType::Deletion,
                        Some(b'+') => PartType::Insertion,
                        // @@ -1,3 +1,3 @@
                        Some(b'@') => {
                            self.commit_hunk();
                            self.current_hunk = Some(Hunk {
                                offset: self.offset,
                                ..parse_hunk_header_line(line)?
                            });
                            continue;
                        }
                        Some(b'\\') => {
                            if !line.starts_with(b"\\ No newline at end of file") {
                                // TODO: store line
                                return Err(ParseErr::unrecognized_pragma);
                            }
                            self.current_hunk_mutation_part
                                .as_mut()
                                .ok_or(
                                    ParseErr::no_newline_at_eof_pragma_encountered_without_context,
                                )?
                                .no_newline_at_end_of_file = true;
                            continue;
                        }
                        Some(_) => {
                            // unrecognized, bail out
                            self.state = ParserState::ParsingHeader;
                            self.commit_file_patch();
                            lines.back();
                            continue;
                        }
                    };
                    let hunk = self
                        .current_hunk
                        .as_mut()
                        .ok_or(ParseErr::hunk_lines_encountered_before_hunk_header)?;
                    hunk.parts.extend(
                        self.current_hunk_mutation_part
                            .take_if(|part| part.ty != ty),
                    );
                    self.current_hunk_mutation_part
                        .get_or_insert_with(|| PatchMutationPart {
                            ty,
                            ..Default::default()
                        })
                        .lines
                        .push(&line[1.min(line.len())..]);
                }
            }
        }

        self.commit_file_patch();

        for file_deet in &self.result {
            for hunk in &file_deet.hunks {
                if !hunk.verify_integrity(None) {
                    self.offset = hunk.offset;
                    return Err(ParseErr::hunk_header_integrity_check_failed);
                }
            }
        }

        Ok(())
    }

    fn commit_hunk(&mut self) {
        if let Some(mut hunk) = self.current_hunk.take() {
            if let Some(mutation_part) = self.current_hunk_mutation_part.take() {
                hunk.parts.push(mutation_part);
            }
            self.current_file_patch.hunks.push(hunk);
        }
    }

    fn commit_file_patch(&mut self) {
        self.commit_hunk();
        self.current_file_patch.nullify_empty_strings();
        let fp = mem::take(&mut self.current_file_patch);
        self.result.push(fp);
        self.current_file_patch.offset = self.offset;
    }
}

fn split_ascii_digits(text: &[u8]) -> (&[u8], &[u8]) {
    text.split_at(text.iter().take_while(|c| c.is_ascii_digit()).count())
}

/// Parses `100,32 ` or `100 `. Returns the range and the rest of the text, starting at the space.
fn parse_header_range(text: &[u8]) -> Result<(HeaderRange, &[u8]), ParseErr> {
    let (start, mut rest) = split_ascii_digits(text);
    let mut len: &[u8] = b"1";
    if rest.len() < 2 {
        return Err(ParseErr::bad_header_line);
    }
    if let Some(after_comma) = rest.strip_prefix(b",") {
        (len, rest) = split_ascii_digits(after_comma);
    }
    if !rest.starts_with(b" ") {
        return Err(ParseErr::bad_header_line);
    }
    let range = HeaderRange {
        start: bun_core::parse_decimal::<u32>(start).ok_or(ParseErr::bad_header_line)?,
        len: bun_core::parse_decimal::<u32>(len).ok_or(ParseErr::bad_header_line)?,
    };
    Ok((range, rest))
}

fn parse_hunk_header_line<'a>(line: &'a [u8]) -> Result<Hunk<'a>, ParseErr> {
    //  const match = headerLine.trim()
    //    .match(/^@@ -(\d+)(,(\d+))? \+(\d+)(,(\d+))? @@.*/)
    let line = strings::trim(line, WHITESPACE)
        .strip_prefix(b"@@ -")
        .ok_or(ParseErr::bad_header_line)?;
    let (original, line) = parse_header_range(line)?;
    let line = line.strip_prefix(b" +").ok_or(ParseErr::bad_header_line)?;
    let (patched, line) = parse_header_range(line)?;
    if !line.starts_with(b" @@") {
        return Err(ParseErr::bad_header_line);
    }
    Ok(Hunk {
        header: Header { original, patched },
        ..Default::default()
    })
}

fn parse_diff_hashes(line: &[u8]) -> Option<(&[u8], &[u8])> {
    // index 2de83dd..842652c 100644
    //       ^
    //       the caller has already stripped the leading "index "

    // From @pnpm/patch-package the regex is this:
    // const match = line.match(/(\w+)\.\.(\w+)/)

    let delimiter_start = strings::index_of(line, b"..")? as usize;

    // \w is [a-zA-Z0-9_]
    let is_word = |part: &[u8]| part.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_');

    let a_part = &line[..delimiter_start];
    if !is_word(a_part) {
        return None;
    }

    let b_part_start = delimiter_start + 2;
    if b_part_start >= line.len() {
        return None;
    }
    let b_part_end = match strings::index_of_any(&line[b_part_start..], b" \n\r\t") {
        Some(pos) => pos + b_part_start,
        None => line.len(),
    };

    let b_part = &line[b_part_start..b_part_end];
    is_word(b_part).then_some((a_part, b_part))
}

fn parse_diff_line_paths(line: &[u8]) -> Option<(&[u8], &[u8])> {
    // From @pnpm/patch-package the regex is this:
    // const match = line.match(/^diff --git a\/(.*?) b\/(.*?)\s*$/)

    const PREFIX: &[u8] = b"diff --git a/";
    if !line.starts_with(PREFIX) {
        return None;
    }
    // diff --git a/banana.ts b/banana.ts
    //              ^
    let rest = strings::trim_right(&line[PREFIX.len()..], WHITESPACE);
    if rest.is_empty() {
        return None;
    }

    // Without a rename both paths are identical, so the ` b/` between them is in the exact middle.
    let (a_path, b_part) = rest.split_at(rest.len().saturating_sub(b" b/".len()) / 2);
    if b_part.strip_prefix(b" b/") == Some(a_path) {
        return Some((a_path, a_path));
    }

    let a_path_start_index: usize = 0;
    let a_path_end_index: usize;
    let b_path_start_index: usize;

    let mut i: usize = 0;
    loop {
        let start_of_b_part = strings::index_of_char(&rest[i..], b'b')? as usize;
        i += start_of_b_part;
        if i > 0 && rest[i - 1] == b' ' && i + 1 < rest.len() && rest[i + 1] == b'/' {
            // diff --git a/banana.ts b/banana.ts
            //                       ^  ^
            //                       |  |
            //    a_path_end_index   +  |
            //    b_path_start_index    +
            a_path_end_index = i - 1;
            b_path_start_index = i + 2;
            break;
        }
        i += 1;
    }

    let a_path = &rest[a_path_start_index..a_path_end_index];
    let b_path = bun_core::strings::trim_right(&rest[b_path_start_index..], b" \n\r\t");
    Some((a_path, b_path))
}

// ──────────────────────────────────────────────────────────────────────────
// spawnOpts / diffPostProcess / gitDiff*
// ──────────────────────────────────────────────────────────────────────────

/// The storage that `Options.envp` points into.
pub struct GitDiffEnv {
    _envp: Vec<*const core::ffi::c_char>,
    _path: Option<Vec<u8>>,
}

// `bun_spawn::sync::Options` owns
// `argv` (`Vec<Box<[u8]>>`) but borrows `envp` (`Option<*const *const c_char>`), so
// its storage is returned alongside as the second tuple element —
// caller must keep it alive while `Options` is in use (no `Box::leak`, §Forbidden).
pub fn spawn_opts(
    old_folder: &[u8],
    new_folder: &[u8],
    cwd: &ZStr,
    git: &ZStr,
    loop_: &mut bun_event_loop::AnyEventLoop,
) -> (bun_spawn::sync::Options, GitDiffEnv) {
    let argv: Vec<Box<[u8]>> = {
        const ARGS: [&[u8]; 11] = [
            b"-c",
            b"core.safecrlf=false",
            // By default git prints non-ASCII paths as "caf\303\251", which the parser cannot read.
            b"-c",
            b"core.quotepath=false",
            b"diff",
            b"--src-prefix=a/",
            b"--dst-prefix=b/",
            b"--ignore-cr-at-eol",
            b"--irreversible-delete",
            b"--full-index",
            b"--no-index",
        ];
        core::iter::once(git.as_bytes())
            .chain(ARGS)
            .chain([old_folder, new_folder])
            .map(Box::from)
            .collect()
    };

    // The machine's and the user's git config must not shape the patch.
    let path_var: Option<Vec<u8>> = bun_core::env_var::PATH
        .get()
        .map(|p| [&b"PATH="[..], p, b"\0"].concat());
    const ENV_STATIC: &[&[u8]] = &[
        b"GIT_CONFIG_NOSYSTEM=1\0",
        b"GIT_ATTR_NOSYSTEM=1\0",
        b"HOME=\0",
        b"XDG_CONFIG_HOME=\0",
        b"USERPROFILE=\0",
        // Without this, git inside a repository would also read that repository's config and every
        // .gitattributes above the two folders.
        concat!("GIT_DIR=", bun_core::null_device!(), "\0").as_bytes(),
    ];
    let mut envp_buf: Vec<*const core::ffi::c_char> =
        Vec::with_capacity(ENV_STATIC.len() + usize::from(path_var.is_some()) + 1);
    if let Some(p) = &path_var {
        envp_buf.push(p.as_ptr().cast::<core::ffi::c_char>());
    }
    for s in ENV_STATIC {
        envp_buf.push(s.as_ptr().cast::<core::ffi::c_char>());
    }
    envp_buf.push(core::ptr::null()); // sentinel

    #[cfg(not(windows))]
    let _ = loop_;

    let opts = bun_spawn::sync::Options {
        stdout: bun_spawn::sync::Stdio::Buffer,
        stderr: bun_spawn::sync::Stdio::Buffer,
        cwd: cwd.as_bytes().into(),
        envp: Some(envp_buf.as_ptr()),
        argv,
        // `spawn` dereferences `windows.loop_` unconditionally, and `WindowsOptions::default()` is
        // zeroed.
        #[cfg(windows)]
        windows: bun_spawn::sync::WindowsOptions {
            // `as_handle` owns the handle conversion so variant internals
            // stay encapsulated.
            loop_: bun_event_loop::AnyEventLoop::as_handle(loop_),
            ..Default::default()
        },
        ..Default::default()
    };

    (
        opts,
        GitDiffEnv {
            _envp: envp_buf,
            _path: path_var,
        },
    )
}

pub fn diff_post_process(
    result: &mut bun_spawn::sync::Result,
    old_folder: &[u8],
    new_folder: &[u8],
) -> crate::Result<core::result::Result<Vec<u8>, Vec<u8>>> {
    let mut stdout = mem::take(&mut result.stdout);
    let mut stderr = mem::take(&mut result.stderr);

    // git exits with 1 if there are differences, and also if it cannot read a folder, but then it
    // prints no patch. stderr is not checked, because git can print a warning with a valid patch.
    let succeeded = match &result.status {
        bun_spawn::Status::Exited(exit) => exit.code == 0 || (exit.code == 1 && !stdout.is_empty()),
        _ => false,
    };
    if !succeeded {
        if stderr.is_empty() {
            stderr = format!("git exited with {}", result.status).into_bytes();
        }
        return Ok(Err(stderr));
    }

    bun_core::scoped_log!(Patch, "Before postprocess: {}\n", bstr::BStr::new(&stdout));
    git_diff_postprocess(&mut stdout, old_folder, new_folder)?;
    Ok(Ok(stdout))
}

pub fn git_diff_preprocess_paths(old_folder: &[u8], new_folder: &[u8]) -> [Vec<u8>; 2] {
    #[allow(unused_mut)]
    let mut folders = [old_folder.to_vec(), new_folder.to_vec()];
    #[cfg(windows)]
    for folder in &mut folders {
        paths::slashes_to_posix_in_place(&mut folder[..]);
    }
    folders
}

pub fn git_diff_internal(
    old_folder_: &[u8],
    new_folder_: &[u8],
    loop_: &mut bun_event_loop::AnyEventLoop,
) -> crate::Result<core::result::Result<Vec<u8>, Vec<u8>>> {
    let paths = git_diff_preprocess_paths(old_folder_, new_folder_);
    let old_folder = &paths[0][..];
    let new_folder = &paths[1][..];

    // `bun_spawn::sync` execs argv[0] verbatim (execve, no PATH search), so
    // resolve `git` here — same as `patchCommit`'s `bun.which` call.
    let mut gitbuf = bun_paths::path_buffer_pool::get();
    let git = bun_which::which(
        &mut gitbuf,
        bun_core::env_var::PATH.get().unwrap_or(b""),
        b"",
        b"git",
    )
    .ok_or(crate::Error::Sys(bun_errno::SystemErrno::ENOENT))?;

    let (opts, _env) = spawn_opts(old_folder, new_folder, ZStr::EMPTY, git, loop_);

    let mut result = bun_spawn::sync::spawn(&opts)??;
    diff_post_process(&mut result, old_folder, new_folder)
}

/// Now we need to do the equivalent of these regex subtitutions.
///
/// Assume that:
///   aFolder = old_folder = "the_old_folder"
///   bFolder = new_folder = "the_new_folder"
///
/// We use the --src-prefix=a/ and --dst-prefix=b/ options with git diff,
/// so the paths end up looking like so:
///
/// - a/the_old_folder/package.json
/// - b/the_old_folder/package.json
/// - a/the_older_folder/src/index.js
/// - b/the_older_folder/src/index.js
///
/// We need to strip out all references to "the_old_folder" and "the_new_folder":
/// - a/package.json
/// - b/package.json
/// - a/src/index.js
/// - b/src/index.js
///
/// The operations look roughy like the following sequence of substitutions and regexes:
///   .replace(new RegExp(`(a|b)(${escapeStringRegexp(`/${removeTrailingAndLeadingSlash(aFolder)}/`)})`, "g"), "$1/")
///   .replace(new RegExp(`(a|b)${escapeStringRegexp(`/${removeTrailingAndLeadingSlash(bFolder)}/`)}`, "g"), "$1/")
///   .replace(new RegExp(escapeStringRegexp(`${aFolder}/`), "g"), "")
///   .replace(new RegExp(escapeStringRegexp(`${bFolder}/`), "g"), "");
fn git_diff_postprocess(
    stdout: &mut Vec<u8>,
    old_folder: &[u8],
    new_folder: &[u8],
) -> crate::Result<()> {
    // An installed package contains no symlinks, so a symlink that exists only in the cache's copy
    // is not something the user deleted. Leave it out of the patch.
    while let Some(mode) = strings::index_of(&stdout[..], b"\ndeleted file mode 120000\n") {
        let start = strings::last_index_of_char(&stdout[..mode], b'\n').map_or(0, |i| i + 1);
        let end = strings::index_of(&stdout[mode + 1..], b"\ndiff --git ")
            .map_or(stdout.len(), |i| mode + i + 2);
        stdout.drain(start..end);
    }

    let old_folder_trimmed = strings::trim(old_folder, b"/");
    let new_folder_trimmed = strings::trim(new_folder, b"/");

    let prefixed = |prefix: &[u8], folder: &[u8]| [prefix, folder, b"/"].concat();
    // An added file has the new folder on both sides of its headers, a deleted one the old folder.
    let prefixed_folders: [(Vec<u8>, bool); 4] = [
        (prefixed(b"a/", old_folder_trimmed), true),
        (prefixed(b"b/", old_folder_trimmed), true),
        (prefixed(b"a/", new_folder_trimmed), false),
        (prefixed(b"b/", new_folder_trimmed), false),
    ];

    // these vars are here to disambguate `a/$OLD_FOLDER` when $OLD_FOLDER itself contains "a/"
    // basically if $OLD_FOLDER contains "a/" then the code will replace it
    // so we need to not run that code path
    let mut saw_a_folder: Option<usize> = None;
    let mut saw_b_folder: Option<usize> = None;
    let mut line_idx: u32 = 0;

    // The cursor is maintained manually (rather than via a split iterator)
    // so we can mutate `stdout` between lines.
    let mut cursor: usize = 0;
    while cursor <= stdout.len() {
        // Compute current line [line_start, line_end) and the index AFTER its delimiter.
        let line_start = cursor;
        let (line_end, next_cursor, exhausted) =
            match strings::index_of_char(&stdout[cursor..], b'\n') {
                Some(pos) => {
                    let pos = pos as usize;
                    (cursor + pos, cursor + pos + 1, false)
                }
                None => (stdout.len(), stdout.len(), true),
            };
        // The cursor after a line points one past its delimiter,
        // so `cursor - 1 - line.len() == line_start`.
        let line_len = line_end - line_start;

        // Borrow line for read-only checks; drop before mutating stdout.
        let skip = {
            let line = &stdout[line_start..line_end];
            should_skip_line(line)
        };

        if !skip {
            // (a|b)/$old_folder/ and (a|b)/$new_folder/
            if let Some((idx, len, is_old)) =
                prefixed_folders.iter().find_map(|(needle, is_old)| {
                    strings::index_of(&stdout[line_start..line_end], needle)
                        .map(|idx| (idx, needle.len(), *is_old))
                })
            {
                stdout.drain(line_start + idx + 2..line_start + idx + len);
                // Re-examine this same line.
                cursor = line_start;
                if is_old {
                    saw_a_folder = Some(line_idx as usize);
                } else {
                    saw_b_folder = Some(line_idx as usize);
                }
                continue;
            }
            if saw_a_folder.is_none() || saw_a_folder.unwrap() != line_idx as usize {
                if let Some(idx) = strings::index_of(&stdout[line_start..line_end], old_folder) {
                    let line = &stdout[line_start..line_end];
                    if idx + old_folder.len() < line_len && line[idx + old_folder.len()] == b'/' {
                        stdout.drain(line_start + idx..line_start + idx + old_folder.len() + 1);
                        cursor = line_start;
                        saw_a_folder = Some(line_idx as usize);
                        continue;
                    }
                }
            }
            if saw_b_folder.is_none() || saw_b_folder.unwrap() != line_idx as usize {
                if let Some(idx) = strings::index_of(&stdout[line_start..line_end], new_folder) {
                    let line = &stdout[line_start..line_end];
                    if idx + new_folder.len() < line_len && line[idx + new_folder.len()] == b'/' {
                        stdout.drain(line_start + idx..line_start + idx + new_folder.len() + 1);
                        cursor = line_start;
                        saw_b_folder = Some(line_idx as usize);
                        continue;
                    }
                }
            }
        }

        line_idx += 1;
        saw_a_folder = None;
        saw_b_folder = None;
        if exhausted {
            break;
        }
        cursor = next_cursor;
    }

    Ok(())
}

/// We need to remove occurrences of "a/" and "b/" and "$old_folder/" and
/// "$new_folder/" but we don't want to remove them from the actual patch
/// content (maybe someone had a/$old_folder/foo.txt in the changed files).
///
/// To do that we have to skip the lines in the patch file that correspond
/// to changes.
///
/// ```patch
///
/// diff --git a/numbers.txt b/banana.txt
/// old mode 100644
/// new mode 100755
/// similarity index 96%
/// rename from numbers.txt
/// rename to banana.txt
/// index fbf1785..92d2c5f
/// --- a/numbers.txt
/// +++ b/banana.txt
/// @@ -1,4 +1,4 @@
/// -one
/// +ne
///
///  two
/// ```
fn should_skip_line(line: &[u8]) -> bool {
    line.is_empty()
        || (matches!(line[0], b' ' | b'-' | b'+')
            // line like: "--- a/numbers.txt" or "+++ b/numbers.txt" we should not skip
            && !(line.len() >= 4 && (&line[0..4] == b"--- " || &line[0..4] == b"+++ ")))
}

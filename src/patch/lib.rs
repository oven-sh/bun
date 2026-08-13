//! Patch file parser and applier.

#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

pub mod error;
pub use error::{Error, Result};

use core::mem;

use bun_collections::bit_set::ArrayBitSet;
use bun_core::strings;
use bun_core::{ZBox, ZStr};
use bun_paths::{self as paths, PathBuffer};
use bun_sys::{self as sys, Fd, FdExt};

bun_core::declare_scope!(Patch, visible);

/// 256-bit set keyed by byte value. `IntegerBitSet<256>` overflows the single-
/// `usize` mask; `ArrayBitSet<256, 4>` is the >64-bit form per bit_set.rs note.
type ByteBitSet = ArrayBitSet<256, 4>;

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
}

impl<'a> PatchFile<'a> {
    pub fn apply(&self, patch_dir: Fd) -> Option<sys::Error> {
        for part in &self.parts {
            let result = match part {
                PatchFilePart::FileDeletion(d) => {
                    delete_file(patch_dir, d.path).map_err(|e| e.with_path(d.path))
                }
                // `rename_file` attributes its own errors, since either side can fail.
                PatchFilePart::FileRename(r) => rename_file(patch_dir, r),
                PatchFilePart::FileCreation(c) => {
                    create_file(patch_dir, c).map_err(|e| e.with_path(c.path))
                }
                PatchFilePart::FilePatch(f) => {
                    patch_file(patch_dir, f).map_err(|e| e.with_path(f.path))
                }
                PatchFilePart::FileModeChange(m) => {
                    change_mode(patch_dir, m).map_err(|e| e.with_path(m.path))
                }
            };
            if let Err(e) = result {
                return Some(e);
            }
        }
        None
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
    let _close = scopeguard::guard(fd, |fd| fd.close());
    // Truncation is deferred until after the target is verified (no
    // `O_TRUNC`), so a rejected target is never destroyed.
    sys::ftruncate(fd, 0)?;

    // A crafted `@@ -0,0 +0,0 @@` header with no body parses to a hunk with
    // zero parts; either way the file is left empty.
    let Some(first_part) = creation.hunk.as_ref().and_then(|h| h.parts.first()) else {
        return Ok(());
    };

    let last_line = first_part.lines.len().saturating_sub(1);
    let no_newline_at_end_of_file = first_part.no_newline_at_end_of_file;

    let count = {
        let mut total: usize = 0;
        for (i, line) in first_part.lines.iter().enumerate() {
            total += line.len();
            total += (i < last_line) as usize;
        }
        total += (!no_newline_at_end_of_file) as usize;
        total
    };

    let file_contents: Vec<u8> = {
        let mut contents = vec![0u8; count];
        let mut i: usize = 0;
        for (idx, line) in first_part.lines.iter().enumerate() {
            contents[i..i + line.len()].copy_from_slice(line);
            i += line.len();
            if idx < last_line || !no_newline_at_end_of_file {
                contents[i] = b'\n';
                i += 1;
            }
        }
        contents
    };

    let mut written: usize = 0;
    while written < file_contents.len() {
        written += sys::write(fd, &file_contents[written..])?;
    }
    Ok(())
}

fn patch_file(patch_dir: Fd, patch: &FilePatch<'_>) -> sys::Result<()> {
    let (parent, base) = resolve_target(patch_dir, patch.path, None)?;
    apply_patch(patch, parent.fd, &base)
}

fn change_mode(patch_dir: Fd, change: &FileModeChange<'_>) -> sys::Result<()> {
    let (parent, base) = resolve_target(patch_dir, change.path, None)?;
    let (fd, _) = open_target_file(parent.fd, &base, sys::O::RDONLY, 0)?;
    // On Windows `fchmod` needs a CRT-backed fd, and closing that one also
    // closes the underlying HANDLE; elsewhere the conversion is the identity.
    let fd = fd.make_libuv_owned().map_err(|()| {
        fd.close();
        sys::Error::from_code(sys::E::EMFILE, sys::Tag::chmod)
    })?;
    let _close = scopeguard::guard(fd, |fd| fd.close());
    sys::fchmod(fd, change.new_mode.to_bun_mode())
}

/// Invariants:
/// - Hunk parts are ordered by first to last in file
/// - The original starting line and the patched starting line are equal in the first hunk part
///
/// TODO: this is a very naive and slow implementation which works by creating a list of lines
/// we can speed it up by:
/// - If file size <= PAGE_SIZE, read the whole file into memory. memcpy/memmove the file contents around will be fast
/// - If file size > PAGE_SIZE, rather than making a list of lines, make a list of chunks
fn apply_patch(patch: &FilePatch<'_>, parent: Fd, base: &ZStr) -> sys::Result<()> {
    let invalid = |tag: sys::Tag| sys::Error::from_code(sys::E::EINVAL, tag);

    // One fd is used for the read and the write-back, so nothing can be
    // swapped in for the target in between them.
    let (file_fd, stat) = open_target_file(parent, base, sys::O::RDWR, 0)?;
    let _close_file = scopeguard::guard(file_fd, |fd| fd.close());

    if stat.st_size as u64 > MAX_PATCH_TARGET_BYTES {
        return Err(invalid(sys::Tag::read));
    }
    let filebuf: Vec<u8> = sys::File::borrow(&file_fd)
        .read_to_end()
        .map_err(|_| invalid(sys::Tag::read))?;

    let file_line_count: usize;
    let lines_count: usize = {
        let mut count: usize = 0;
        for _ in strings::split(&filebuf, b"\n") {
            count += 1;
        }
        file_line_count = count;

        // Adjust to account for the changes. This is only a capacity hint for
        // `lines` below; saturate so a header that claims more deletions than
        // the file has cannot panic (bounds are enforced during the splice).
        for hunk in &patch.hunks {
            count = count
                .saturating_add(hunk.header.patched.len as usize)
                .saturating_sub(hunk.header.original.len as usize);
            for part in &hunk.parts {
                let part: &PatchMutationPart = part;
                match part.ty {
                    PartType::Deletion => {
                        // deleting the no newline pragma so we are actually adding a line
                        count = count.saturating_add(part.no_newline_at_end_of_file as usize);
                    }
                    PartType::Insertion => {
                        count = count.saturating_sub(part.no_newline_at_end_of_file as usize);
                    }
                    PartType::Context => {}
                }
            }
        }

        count
    };

    // TODO: i hate this
    let mut lines: Vec<&[u8]> = Vec::with_capacity(lines_count);
    {
        let mut i: usize = 0;
        for line in strings::split(&filebuf, b"\n") {
            lines.push(line);
            i += 1;
        }
        debug_assert!(i == file_line_count);
    }

    for hunk in &patch.hunks {
        let mut line_cursor = (hunk.header.patched.start - 1) as usize;

        // Validate hunk start position is within bounds
        if line_cursor > lines.len() {
            return Err(invalid(sys::Tag::fstatat));
        }

        for part in &hunk.parts {
            let part: &PatchMutationPart = part;
            match part.ty {
                PartType::Context => {
                    // TODO: check if the lines match in the original file?

                    // Validate context lines exist
                    if line_cursor + part.lines.len() > lines.len() {
                        return Err(invalid(sys::Tag::fstatat));
                    }

                    line_cursor += part.lines.len();
                }
                PartType::Insertion => {
                    // Validate insertion position is within bounds
                    if line_cursor > lines.len() {
                        return Err(invalid(sys::Tag::fstatat));
                    }

                    lines.splice(line_cursor..line_cursor, part.lines.iter().copied());
                    line_cursor += part.lines.len();
                    if part.no_newline_at_end_of_file {
                        let _ = lines.pop();
                    }
                }
                PartType::Deletion => {
                    // TODO: check if the lines match in the original file?

                    // Validate deletion range is within bounds
                    if line_cursor + part.lines.len() > lines.len() {
                        return Err(invalid(sys::Tag::fstatat));
                    }

                    lines.drain(line_cursor..line_cursor + part.lines.len());
                    if part.no_newline_at_end_of_file {
                        lines.push(b"");
                    }
                    // line_cursor -= part.lines.len();
                }
            }
        }
    }

    sys::ftruncate(file_fd, 0)?;
    // `read_to_end` advanced the cursor on Windows (POSIX reads use `pread`);
    // rewind so the write lands at offset 0 instead of leaving a hole.
    sys::set_file_offset(file_fd, 0)?;

    let contents = join_bytes(b"\n", &lines);

    let mut written: usize = 0;
    while written < contents.len() {
        written += sys::write(file_fd, &contents[written..])?;
    }

    Ok(())
}

/// Cap on a patch target read into memory; a larger `st_size` is an error
/// rather than an unbounded allocation.
const MAX_PATCH_TARGET_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Mode for directories a patch has to create. A new file's header mode
/// describes only the file; a directory given 0o644 cannot be entered.
const CREATED_DIR_MODE: sys::Mode = 0o755;

/// Directory handle returned by [`open_parent_beneath`]: `patch_dir` itself
/// for single-component paths (not closed), an owned fd otherwise.
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

/// The separators [`paths::dirname_simple`] splits on, so the walk below and
/// the basename it leaves behind always reassemble the original path.
const PATH_SEPS: &[u8] = if cfg!(windows) { b"/\\" } else { b"/" };

/// Validates a patch path and resolves it to the verified directory holding
/// its final component plus that component as a NUL-terminated name, the
/// pair every `*at` syscall in `apply` operates on.
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

/// Opens the parent directory of `path` one component at a time from
/// `patch_dir`, refusing symlinks, creating missing components when
/// `create_mode` is given. `path` must have passed [`is_safe_patch_path`],
/// which is what rules out `..`.
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

/// On Windows `O_NOFOLLOW` opens a reparse point itself rather than failing,
/// and `fstat` on that handle reports an ordinary file or directory, so the
/// entry's own attributes are checked by name first (hence not atomic against
/// a concurrent swap, unlike the POSIX path).
#[cfg(windows)]
fn reject_reparse_point(dir: Fd, name: &ZStr) -> sys::Result<()> {
    match sys::get_file_attributes_at(dir, name) {
        Ok(attrs) if attrs.is_reparse_point => {
            Err(sys::Error::from_code(sys::E::ELOOP, sys::Tag::open))
        }
        // Nonexistent (about to be created) or unreadable: the open that
        // follows reports the real error.
        _ => Ok(()),
    }
}

/// One step of the walk: opens `component` under `dir` as a directory
/// without following a symlink, creating it first on ENOENT when
/// `create_mode` is given.
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
        // Lost a creation race; the open below verifies whatever is there now.
        Err(e) if e.get_errno() == sys::E::EEXIST => {}
        Err(e) => return Err(e),
    }
    sys::openat(dir, component, flags, 0).map_err(|e| symlink_component_err(dir, component, e))
}

/// `O_NOFOLLOW` on a symlink reports ENOTDIR or ELOOP on Linux, ELOOP on
/// Darwin, and EMLINK on FreeBSD; report the symlink case as ELOOP everywhere.
/// (Only the errno depends on this lstat, never whether the open was refused.)
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

/// Opens `base` under a verified parent without following a symlink and
/// requires a regular file with a single hard link: a second link means the
/// same inode is also reachable from outside the patch dir.
fn open_target_file(
    parent: Fd,
    base: &ZStr,
    flags: i32,
    mode: sys::Mode,
) -> sys::Result<(Fd, sys::Stat)> {
    #[cfg(windows)]
    reject_reparse_point(parent, base)?;
    // Without `O_NONBLOCK`, opening a FIFO blocks until a writer appears and
    // the `!ISREG` rejection below is never reached.
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

/// Joins byte slices with a separator.
fn join_bytes(sep: &[u8], slices: &[&[u8]]) -> Vec<u8> {
    if slices.is_empty() {
        return Vec::new();
    }
    let total: usize =
        slices.iter().map(|s| s.len()).sum::<usize>() + sep.len() * (slices.len() - 1);
    let mut out = Vec::with_capacity(total);
    for (i, s) in slices.iter().enumerate() {
        if i != 0 {
            out.extend_from_slice(sep);
        }
        out.extend_from_slice(s);
    }
    out
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
}

impl<'a> FileDeets<'a> {
    fn take_hunks(&mut self) -> Vec<Hunk<'a>> {
        mem::take(&mut self.hunks)
    }

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

/// Ensure context, insertion, deletion values are in sync with HunkLineType enum
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum PartType {
    #[default]
    Context = 0,
    Insertion,
    Deletion,
}

#[derive(Default)]
struct Hunk<'a> {
    pub(crate) header: Header,
    pub(crate) parts: Vec<PatchMutationPart<'a>>,
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

impl Header {
    pub(crate) const EMPTY: Header = Header {
        original: HeaderRange { start: 1, len: 0 },
        patched: HeaderRange { start: 1, len: 0 },
    };
}

impl<'a> Hunk<'a> {
    fn verify_integrity(&self) -> bool {
        let mut original_length: usize = 0;
        let mut patched_length: usize = 0;

        for part in &self.parts {
            match part.ty {
                PartType::Context => {
                    patched_length += part.lines.len();
                    original_length += part.lines.len();
                }
                PartType::Insertion => patched_length += part.lines.len(),
                PartType::Deletion => original_length += part.lines.len(),
            }
        }

        if original_length != self.header.original.len as usize
            || patched_length != self.header.patched.len as usize
        {
            return false;
        }
        true
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
// Does not allocate — no Drop needed.

struct FileModeChange<'a> {
    pub(crate) path: &'a [u8],
    pub(crate) old_mode: FileMode,
    pub(crate) new_mode: FileMode,
}
// Does not allocate — no Drop needed.

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

    fn write_file_deletion(w: &mut impl Write, fd: &FileDeletion<'_>) -> Result {
        w.write_str("{\"path\":")?;
        write_str(w, fd.path)?;
        write!(w, ",\"mode\":\"{}\",\"hunk\":", file_mode_tag(fd.mode))?;
        write_opt_hunk(w, &fd.hunk)?;
        w.write_str(",\"hash\":")?;
        write_opt_str(w, fd.hash)?;
        w.write_char('}')
    }

    fn write_file_creation(w: &mut impl Write, fc: &FileCreation<'_>) -> Result {
        w.write_str("{\"path\":")?;
        write_str(w, fc.path)?;
        write!(w, ",\"mode\":\"{}\",\"hunk\":", file_mode_tag(fc.mode))?;
        write_opt_hunk(w, &fc.hunk)?;
        w.write_str(",\"hash\":")?;
        write_opt_str(w, fc.hash)?;
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
                write_file_deletion(w, p)?;
            }
            PatchFilePart::FileCreation(p) => {
                w.write_str("{\"file_creation\":")?;
                write_file_creation(w, p)?;
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
}

// ──────────────────────────────────────────────────────────────────────────
// parsePatchFile / patchFileSecondPass
// ──────────────────────────────────────────────────────────────────────────

/// NOTE: the returned `PatchFile` struct will contain pointers to original file text so make sure to not deallocate `file`
pub fn parse_patch_file(file: &[u8]) -> Result<PatchFile<'_>, ParseErr> {
    let mut lines_parser = PatchLinesParser::default();

    'brk: {
        match lines_parser.parse(file, ParseOpts::default()) {
            Ok(()) => break 'brk,
            Err(err) => {
                // TODO: the parser can be refactored to remove this as it is a hacky workaround, like detecting while parsing if legacy diffs are used
                if err == ParseErr::hunk_header_integrity_check_failed {
                    lines_parser.reset();
                    lines_parser.parse(
                        file,
                        ParseOpts {
                            support_legacy_diffs: true,
                        },
                    )?;
                    break 'brk;
                }
                return Err(err);
            }
        }
    }

    // reshaped for borrowck — take ownership of result vec instead of slicing.
    let mut files = mem::take(&mut lines_parser.result);
    patch_file_second_pass(&mut files)
}

fn patch_file_second_pass<'a>(files: &mut [FileDeets<'a>]) -> Result<PatchFile<'a>, ParseErr> {
    let mut result = PatchFile::default();

    for file in files.iter_mut() {
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
                    .diff_line_from_path
                    .or(file.from_path)
                    .ok_or(ParseErr::no_path_given_for_file_deletion)?;
                result
                    .parts
                    .push(PatchFilePart::FileDeletion(Box::new(FileDeletion {
                        hunk: if !file.hunks.is_empty() {
                            let value = mem::replace(
                                &mut file.hunks[0],
                                Hunk {
                                    header: Header::EMPTY,
                                    ..Default::default()
                                },
                            );
                            Some(Box::new(value))
                        } else {
                            None
                        },
                        path,
                        mode: parse_file_mode(file.deleted_file_mode.unwrap())
                            .ok_or(ParseErr::bad_file_mode)?,
                        hash: file.before_hash,
                    })));
            }
            PatchFilePartKind::FileCreation => {
                let path = file
                    .diff_line_to_path
                    .or(file.to_path)
                    .ok_or(ParseErr::no_path_given_for_file_creation)?;
                result
                    .parts
                    .push(PatchFilePart::FileCreation(Box::new(FileCreation {
                        hunk: if !file.hunks.is_empty() {
                            let value = mem::replace(
                                &mut file.hunks[0],
                                Hunk {
                                    header: Header::EMPTY,
                                    ..Default::default()
                                },
                            );
                            Some(Box::new(value))
                        } else {
                            None
                        },
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
                    hunks: file.take_hunks(),
                    before_hash: file.before_hash,
                    after_hash: file.after_hash,
                })));
        }
    }

    Ok(result)
}

fn parse_file_mode(mode: &[u8]) -> Option<FileMode> {
    let parsed_mode = bun_core::parse_int::<u32>(mode, 8).ok()? & 0o777;
    FileMode::from_u32(parsed_mode)
}

fn is_safe_patch_path(path: &[u8]) -> bool {
    !path.is_empty()
        && !strings::contains_char(path, 0)
        && !paths::is_absolute_loose(path)
        // On Windows, openat strips a drive prefix from a relative component,
        // so `"C:.."` (not byte-equal to `..` below) resolves a real `..`.
        // `:` never occurs in a legitimate NTFS file name.
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
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum ParserState {
    #[default]
    ParsingHeader,
    ParsingHunks,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
enum HunkLineType {
    /// Additional context
    Context = 0,
    /// Example:
    /// + sjfskdjfsdf
    Insertion,
    /// Example:
    /// - sjfskdjfsdf
    Deletion,
    /// Example:
    /// @@ -1,3 +1,3 @@
    Header,
    /// Example:
    /// \ No newline at end of file
    Pragma,
}

#[derive(Default, Clone, Copy)]
struct ParseOpts {
    support_legacy_diffs: bool,
}

impl<'a> PatchLinesParser<'a> {
    // Drop handles freeing; `reset()` handles the retain-capacity case.

    fn reset(&mut self) {
        // reshaped for borrowck — take result vec, clear it, reinit self.
        let mut result = mem::take(&mut self.result);
        result.clear();
        *self = Self {
            result,
            ..Default::default()
        };
    }

    fn parse(&mut self, file_: &'a [u8], opts: ParseOpts) -> Result<(), ParseErr> {
        if file_.is_empty() {
            return Ok(());
        }
        let end = 'brk: {
            // Peek at the last segment after the final '\n'.
            let mut prev: usize = file_.len();
            let last_nl = strings::last_index_of_char(file_, b'\n');
            let last_line = match last_nl {
                Some(i) => &file_[i + 1..],
                None => file_,
            };
            if last_line.is_empty() {
                if let Some(i) = last_nl {
                    // index points to the byte BEFORE the delimiter.
                    prev = i;
                }
            }
            break 'brk prev;
        };
        if end == 0 || end > file_.len() {
            return Ok(());
        }
        let file = &file_[..end];
        let mut lines = LookbackIterator::from_inner(ScalarSplitIter::new(file, b'\n'));

        while let Some(line) = lines.next() {
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
                    }
                }
                ParserState::ParsingHunks => {
                    if opts.support_legacy_diffs && line.starts_with(b"--- a/") {
                        self.state = ParserState::ParsingHeader;
                        self.commit_file_patch();
                        lines.back();
                        continue;
                    }
                    // parsing hunks
                    let hunk_line_type: HunkLineType = if line.is_empty() {
                        // treat blank lines as context
                        HunkLineType::Context
                    } else {
                        let maybe = match line[0] {
                            b'@' => Some(HunkLineType::Header),
                            b'-' => Some(HunkLineType::Deletion),
                            b'+' => Some(HunkLineType::Insertion),
                            b' ' => Some(HunkLineType::Context),
                            b'\\' => Some(HunkLineType::Pragma),
                            b'\r' => Some(HunkLineType::Context),
                            _ => None,
                        };
                        match maybe {
                            Some(t) => t,
                            None => {
                                // unrecognized, bail out
                                self.state = ParserState::ParsingHeader;
                                self.commit_file_patch();
                                lines.back();
                                continue;
                            }
                        }
                    };

                    match hunk_line_type {
                        HunkLineType::Header => {
                            self.commit_hunk();
                            self.current_hunk = Some(parse_hunk_header_line(line)?);
                        }
                        HunkLineType::Pragma => {
                            if !line.starts_with(b"\\ No newline at end of file") {
                                // TODO: store line
                                return Err(ParseErr::unrecognized_pragma);
                            }
                            if self.current_hunk_mutation_part.is_none() {
                                return Err(
                                    ParseErr::no_newline_at_eof_pragma_encountered_without_context,
                                );
                            }
                            self.current_hunk_mutation_part
                                .as_mut()
                                .unwrap()
                                .no_newline_at_end_of_file = true;
                        }
                        HunkLineType::Insertion
                        | HunkLineType::Deletion
                        | HunkLineType::Context => {
                            if self.current_hunk.is_none() {
                                return Err(ParseErr::hunk_lines_encountered_before_hunk_header);
                            }
                            if self.current_hunk_mutation_part.is_some()
                                && (self.current_hunk_mutation_part.as_ref().unwrap().ty as u8)
                                    != (hunk_line_type as u8)
                            {
                                let part = self.current_hunk_mutation_part.take().unwrap();
                                self.current_hunk.as_mut().unwrap().parts.push(part);
                            }

                            if self.current_hunk_mutation_part.is_none() {
                                self.current_hunk_mutation_part = Some(PatchMutationPart {
                                    ty: match hunk_line_type {
                                        HunkLineType::Context => PartType::Context,
                                        HunkLineType::Insertion => PartType::Insertion,
                                        HunkLineType::Deletion => PartType::Deletion,
                                        _ => unreachable!(),
                                    },
                                    ..Default::default()
                                });
                            }

                            self.current_hunk_mutation_part
                                .as_mut()
                                .unwrap()
                                .lines
                                .push(&line[1.min(line.len())..]);
                        }
                    }
                }
            }
        }

        self.commit_file_patch();

        for file_deet in &self.result {
            for hunk in &file_deet.hunks {
                if !hunk.verify_integrity() {
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
    }
}

struct HunkHeaderLineImpl<'a> {
    line_nr: u32,
    line_count: u32,
    rest: &'a [u8],
}

fn parse_hunk_header_line_impl(text_: &[u8]) -> Result<HunkHeaderLineImpl<'_>, ParseErr> {
    let mut text = text_;
    let digits: ByteBitSet = {
        let mut set = ByteBitSet::init_empty();
        let mut c = b'0';
        while c <= b'9' {
            set.set(c as usize);
            c += 1;
        }
        set
    };

    // @@ -100,32 +100,32 @@
    //     ^
    let line_nr_start: usize = 0;
    let mut line_nr_end: usize = 0;
    let mut saw_comma = false;
    let mut saw_whitespace = false;
    while line_nr_end < text.len() {
        if text[line_nr_end] == b',' {
            saw_comma = true;
            break;
        } else if text[line_nr_end] == b' ' {
            saw_whitespace = true;
            break;
        }
        if !digits.is_set(text[line_nr_end] as usize) {
            return Err(ParseErr::bad_header_line);
        }
        line_nr_end += 1;
    }
    if !saw_comma && !saw_whitespace {
        return Err(ParseErr::bad_header_line);
    }
    let line_nr = &text[line_nr_start..line_nr_end];
    let mut line_nr_count: &[u8] = b"1";
    if line_nr_end + 1 >= text.len() {
        return Err(ParseErr::bad_header_line);
    }

    text = &text[line_nr_end..];
    if text.is_empty() {
        return Err(ParseErr::bad_header_line);
    }

    // @@ -100,32 +100,32 @@
    //        ^
    //        but the comma can be optional
    if saw_comma {
        text = &text[1..];
        saw_whitespace = false;
        let first_col_start = 0;
        let mut first_col_end: usize = 0;
        while first_col_end < text.len() {
            if text[first_col_end] == b' ' {
                saw_whitespace = true;
                break;
            }
            if !digits.is_set(text[first_col_end] as usize) {
                return Err(ParseErr::bad_header_line);
            }
            first_col_end += 1;
        }
        if !saw_whitespace {
            return Err(ParseErr::bad_header_line);
        }
        line_nr_count = &text[first_col_start..first_col_end];
        text = &text[first_col_end..];
    }

    Ok(HunkHeaderLineImpl {
        line_nr: 1.max(bun_core::parse_decimal::<u32>(line_nr).ok_or(ParseErr::bad_header_line)?),
        line_count: bun_core::parse_decimal::<u32>(line_nr_count)
            .ok_or(ParseErr::bad_header_line)?,
        rest: text,
    })
}

fn parse_hunk_header_line<'a>(line_: &'a [u8]) -> Result<Hunk<'a>, ParseErr> {
    //  const match = headerLine.trim()
    //    .match(/^@@ -(\d+)(,(\d+))? \+(\d+)(,(\d+))? @@.*/)

    let mut line = strings::trim(line_, WHITESPACE);
    // @@ -100,32 +100,32 @@
    // ^^^^
    // this part
    if !(line.len() >= 4
        && line[0] == b'@'
        && line[1] == b'@'
        && line[2] == b' '
        && line[3] == b'-')
    {
        // TODO: store line
        return Err(ParseErr::bad_header_line);
    }

    if line.len() <= 4 {
        return Err(ParseErr::bad_header_line);
    }

    // @@ -100,32 +100,32 @@
    //     ^
    line = &line[4..];

    let first_result = parse_hunk_header_line_impl(line)?;
    // @@ -100,32 +100,32 @@
    //           ^
    line = first_result.rest;
    if line.len() < 2 || line[1] != b'+' {
        return Err(ParseErr::bad_header_line);
    }
    line = &line[2..];

    let second_result = parse_hunk_header_line_impl(line)?;
    // @@ -100,32 +100,32 @@
    //                   ^
    line = second_result.rest;

    if line.len() >= 3 && line[0] == b' ' && line[1] == b'@' && line[2] == b'@' {
        return Ok(Hunk {
            header: Header {
                original: HeaderRange {
                    start: first_result.line_nr,
                    len: first_result.line_count,
                },
                patched: HeaderRange {
                    start: second_result.line_nr,
                    len: second_result.line_count,
                },
            },
            parts: Vec::new(),
        });
    }

    Err(ParseErr::bad_header_line)
}

fn parse_diff_hashes(line: &[u8]) -> Option<(&[u8], &[u8])> {
    // index 2de83dd..842652c 100644
    //       ^
    //       the caller has already stripped the leading "index "

    // From @pnpm/patch-package the regex is this:
    // const match = line.match(/(\w+)\.\.(\w+)/)

    let delimiter_start = strings::index_of(line, b"..")? as usize;

    // ArrayBitSet::set is non-const, so this builds at runtime.
    let valid_chars: ByteBitSet = {
        let mut bitset = ByteBitSet::init_empty();
        // TODO: the regex uses \w which is [a-zA-Z0-9_]
        let mut c = b'0';
        while c <= b'9' {
            bitset.set(c as usize);
            c += 1;
        }
        c = b'a';
        while c <= b'z' {
            bitset.set(c as usize);
            c += 1;
        }
        c = b'A';
        while c <= b'Z' {
            bitset.set(c as usize);
            c += 1;
        }
        bitset.set(b'_' as usize);
        bitset
    };

    let a_part = &line[..delimiter_start];
    for &c in a_part {
        if !valid_chars.is_set(c as usize) {
            return None;
        }
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
    for &c in b_part {
        if !valid_chars.is_set(c as usize) {
            return None;
        }
    }

    Some((a_part, b_part))
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
    let rest = &line[PREFIX.len()..];
    if rest.is_empty() {
        return None;
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

// `bun_spawn::sync::Options` owns
// `argv` (`Vec<Box<[u8]>>`) but borrows `envp` (`Option<*const *const c_char>`), so
// the null-terminated envp array is returned alongside as the second tuple element —
// caller must keep it alive while `Options` is in use (no `Box::leak`, §Forbidden).
pub fn spawn_opts(
    old_folder: &[u8],
    new_folder: &[u8],
    cwd: &ZStr,
    git: &ZStr,
    loop_: &mut bun_event_loop::AnyEventLoop,
) -> (bun_spawn::sync::Options, Vec<*const core::ffi::c_char>) {
    let argv: Vec<Box<[u8]>> = {
        const ARGV: &[&[u8]] = &[
            b"git",
            b"-c",
            b"core.safecrlf=false",
            b"diff",
            b"--src-prefix=a/",
            b"--dst-prefix=b/",
            b"--ignore-cr-at-eol",
            b"--irreversible-delete",
            b"--full-index",
            b"--no-index",
        ];
        // PERF: `Options.argv` is
        // `Vec<Box<[u8]>>`, so we copy. Profile if it shows up on a hot path.
        let mut argv_buf: Vec<Box<[u8]>> = Vec::with_capacity(ARGV.len() + 2);
        argv_buf.push(Box::from(git.as_bytes()));
        for i in 1..ARGV.len() {
            argv_buf.push(Box::from(ARGV[i]));
        }
        argv_buf.push(Box::from(old_folder));
        argv_buf.push(Box::from(new_folder));
        argv_buf
    };

    // envp is `[:null]?[*:0]const u8` — null-terminated array of C strings. All
    // entries point at `'static` storage (string literals / process env block);
    // only the array itself is heap-backed and returned to the caller.
    let envp_buf: Vec<*const core::ffi::c_char> = {
        const ENV_ARR: [&[u8]; 4] = [
            b"GIT_CONFIG_NOSYSTEM\0",
            b"HOME\0",
            b"XDG_CONFIG_HOME\0",
            b"USERPROFILE\0",
        ];
        let path = bun_core::env_var::PATH.get();
        let mut envp_buf: Vec<*const core::ffi::c_char> =
            Vec::with_capacity(ENV_ARR.len() + usize::from(path.is_some()) + 1);
        for s in &ENV_ARR {
            envp_buf.push(s.as_ptr().cast::<core::ffi::c_char>());
        }
        if let Some(p) = path {
            // `env_var::PATH.get()` yields a slice into the C env
            // block (NUL byte immediately follows on POSIX — see
            // `bun_core::getenv_z`).
            envp_buf.push(p.as_ptr().cast::<core::ffi::c_char>());
        }
        envp_buf.push(core::ptr::null()); // sentinel
        envp_buf
    };

    #[cfg(not(windows))]
    let _ = loop_;

    let opts = bun_spawn::sync::Options {
        stdout: bun_spawn::sync::Stdio::Buffer,
        stderr: bun_spawn::sync::Stdio::Buffer,
        cwd: cwd.as_bytes().into(),
        envp: Some(envp_buf.as_ptr()),
        argv,
        #[cfg(windows)]
        windows: bun_spawn::sync::WindowsOptions {
            // `as_handle` owns the handle conversion so variant internals
            // stay encapsulated.
            loop_: bun_event_loop::AnyEventLoop::as_handle(loop_),
            ..Default::default()
        },
        ..Default::default()
    };

    (opts, envp_buf)
}

pub fn diff_post_process(
    result: &mut bun_spawn::sync::Result,
    old_folder: &[u8],
    new_folder: &[u8],
) -> crate::Result<core::result::Result<Vec<u8>, Vec<u8>>> {
    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();

    mem::swap(&mut stdout, &mut result.stdout);
    mem::swap(&mut stderr, &mut result.stderr);

    // errdefer-style flags replaced by Drop semantics; on early return
    // the unreturned vec is dropped automatically.

    if !stderr.is_empty() {
        return Ok(Err(stderr));
    }

    bun_core::scoped_log!(Patch, "Before postprocess: {}\n", bstr::BStr::new(&stdout));
    git_diff_postprocess(&mut stdout, old_folder, new_folder)?;
    Ok(Ok(stdout))
}

pub fn git_diff_preprocess_paths(old_folder_: &[u8], new_folder_: &[u8]) -> [Vec<u8>; 2] {
    #[cfg(windows)]
    let old_folder: Vec<u8> = {
        // Normalize Windows separators before passing paths to `git diff`.
        let mut cpy = old_folder_.to_vec();
        paths::slashes_to_posix_in_place(&mut cpy[..]);
        cpy
    };
    #[cfg(not(windows))]
    let old_folder: Vec<u8> = old_folder_.to_vec();

    #[cfg(windows)]
    let new_folder: Vec<u8> = {
        let mut cpy = new_folder_.to_vec();
        paths::slashes_to_posix_in_place(&mut cpy[..]);
        cpy
    };
    #[cfg(not(windows))]
    let new_folder: Vec<u8> = new_folder_.to_vec();

    [old_folder, new_folder]
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
    let mut gitbuf = PathBuffer::uninit();
    let git = bun_which::which(
        &mut gitbuf,
        bun_core::env_var::PATH.get().unwrap_or(b""),
        b"",
        b"git",
    )
    .ok_or(crate::Error::Sys(bun_errno::SystemErrno::ENOENT))?;

    const ARGV: &[&[u8]] = &[
        b"-c",
        b"core.safecrlf=false",
        b"diff",
        b"--src-prefix=a/",
        b"--dst-prefix=b/",
        b"--ignore-cr-at-eol",
        b"--irreversible-delete",
        b"--full-index",
        b"--no-index",
    ];
    let mut argv: Vec<Box<[u8]>> = Vec::with_capacity(ARGV.len() + 3);
    argv.push(Box::from(git.as_bytes()));
    for s in ARGV {
        argv.push(Box::from(*s));
    }
    argv.push(Box::from(old_folder));
    argv.push(Box::from(new_folder));

    // env: { PATH (inherited if set), GIT_CONFIG_NOSYSTEM=1, HOME=, XDG_CONFIG_HOME=, USERPROFILE= }
    // Static entries point at 'static literals; PATH=<value>\0 needs an owned buffer.
    let path_var: Option<Vec<u8>> = bun_core::env_var::PATH.get().map(|p| {
        let mut s = Vec::with_capacity(b"PATH=".len() + p.len() + 1);
        s.extend_from_slice(b"PATH=");
        s.extend_from_slice(p);
        s.push(0);
        s
    });
    const ENV_STATIC: &[&[u8]] = &[
        b"GIT_CONFIG_NOSYSTEM=1\0",
        b"HOME=\0",
        b"XDG_CONFIG_HOME=\0",
        b"USERPROFILE=\0",
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
        envp: Some(envp_buf.as_ptr()),
        argv,
        // This routes through `bun_spawn::sync::spawn`, whose Windows path
        // unconditionally derefs `windows.loop_` (process.rs spawn_windows_*).
        // `WindowsOptions::default()` is `zeroed_unchecked()`, so leaving this
        // defaulted is a null deref on Windows — supply the caller's loop.
        #[cfg(windows)]
        windows: bun_spawn::sync::WindowsOptions {
            loop_: bun_event_loop::AnyEventLoop::as_handle(loop_),
            ..Default::default()
        },
        ..Default::default()
    };

    // unfortunately, git diff returns non-zero exit codes even when it succeeds.
    // we have to check that stderr was not empty to know if it failed
    let mut result = bun_spawn::sync::spawn(&opts)??;

    // Keep envp storage alive across the spawn call; Options.envp borrows it.
    drop(opts);
    drop(envp_buf);
    drop(path_var);

    let mut stdout = mem::take(&mut result.stdout);
    let stderr = mem::take(&mut result.stderr);

    if !stderr.is_empty() {
        return Ok(Err(stderr));
    }

    bun_core::scoped_log!(Patch, "Before postprocess: {}\n", bstr::BStr::new(&stdout));
    git_diff_postprocess(&mut stdout, old_folder, new_folder)?;
    Ok(Ok(stdout))
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
    let old_folder_trimmed = strings::trim(old_folder, b"/");
    let new_folder_trimmed = strings::trim(new_folder, b"/");

    let mut old_buf: Vec<u8> = Vec::with_capacity(old_folder_trimmed.len() + 3);
    old_buf.extend_from_slice(b"a/");
    old_buf.extend_from_slice(old_folder_trimmed);
    old_buf.push(b'/');

    let mut new_buf: Vec<u8> = Vec::with_capacity(new_folder_trimmed.len() + 3);
    new_buf.extend_from_slice(b"b/");
    new_buf.extend_from_slice(new_folder_trimmed);
    new_buf.push(b'/');

    let (a_old_folder_slash, b_new_folder_slash) = (&old_buf[..], &new_buf[..]);

    // const @"$old_folder/" = @"a/$old_folder/"[2..];
    // const @"$new_folder/" = @"b/$new_folder/"[2..];

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
            // a/$old_folder/
            if let Some(idx) = strings::index_of(&stdout[line_start..line_end], a_old_folder_slash)
            {
                let old_folder_slash_start = idx + 2;
                stdout.drain(
                    line_start + old_folder_slash_start
                        ..line_start + old_folder_slash_start + old_folder_trimmed.len() + 1,
                );
                // Re-examine this same line.
                cursor = line_start;
                saw_a_folder = Some(line_idx as usize);
                continue;
            }
            // b/$new_folder/
            if let Some(idx) = strings::index_of(&stdout[line_start..line_end], b_new_folder_slash)
            {
                let new_folder_slash_start = idx + 2;
                stdout.drain(
                    line_start + new_folder_slash_start
                        ..line_start + new_folder_slash_start + new_folder_trimmed.len() + 1,
                );
                // The next iteration
                // resumes at the (now-shifted) byte after this line's '\n'.
                cursor = next_cursor - (new_folder_trimmed.len() + 1);
                saw_b_folder = Some(line_idx as usize);
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

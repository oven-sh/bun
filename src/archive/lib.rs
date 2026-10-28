//! Extracts tar archives to disk. The format itself is `bun_tar`'s.
#![warn(unused_must_use)]

use bun_alloc::AllocError;
use bun_collections::StringArrayHashMap;
#[cfg(unix)]
use bun_core::ZStr;
use bun_core::{MutableString, strings};
use bun_core::{Output, slice_as_bytes};
#[cfg(unix)]
use bun_paths::PathBuffer;
use bun_paths::{OSPathChar, SEP, SEP_STR};
#[cfg(unix)]
use bun_sys::beneath::{self, Symlinks};
use bun_sys::{self, Fd, FdExt};
use bun_wyhash::hash;

pub mod error;
pub use error::{Error, ReadDataError, Result};

pub use bun_tar as tar;
use bun_tar::{Dialect, Entry, Event, MemoryDecoder, Options};

/// The entry's path the way the file system takes it. `buf` is scratch space for Windows.
#[cfg(not(windows))]
pub fn os_path<'a>(
    entry: &'a Entry,
    _buf: &'a mut Vec<OSPathChar>,
) -> Result<&'a [OSPathChar], AllocError> {
    Ok(entry.path())
}
#[cfg(windows)]
pub fn os_path<'a>(
    entry: &'a Entry,
    buf: &'a mut Vec<OSPathChar>,
) -> Result<&'a [OSPathChar], AllocError> {
    buf.clear();
    bun_tar::compose::to_utf16(entry.path(), entry.path_is_utf8(), buf).map_err(|_| AllocError)?;
    Ok(buf)
}

/// The entry's path as a program sees it: the name [`os_path`] gives the file, in UTF-8 on Windows.
#[cfg(not(windows))]
pub fn display_path(entry: &Entry) -> Result<std::borrow::Cow<'_, [u8]>, AllocError> {
    Ok(entry.path().into())
}
#[cfg(windows)]
pub fn display_path(entry: &Entry) -> Result<std::borrow::Cow<'_, [u8]>, AllocError> {
    let mut wide = Vec::new();
    Ok(strings::to_utf8_list_with_type(Vec::new(), os_path(entry, &mut wide)?)?.into())
}

/// A reader for an archive that is all in memory, gzipped or not. Fails for what is not one.
pub fn open_memory(bytes: &[u8], dialect: Dialect) -> bun_tar::Result<MemoryDecoder<'_>> {
    MemoryDecoder::new(bytes, Options::for_host(dialect))
}

/// Writes the contents of the current entry to `fd`.
pub fn read_data_into_fd(
    reader: &mut MemoryDecoder<'_>,
    fd: Fd,
    strategy: &mut WriteStrategy,
) -> Result<(), ReadDataError> {
    let mut writer = EntryWriter::new(fd);
    loop {
        match reader.next()? {
            Event::Data { offset, bytes } => writer.write(strategy, offset, bytes)?,
            Event::EndOfEntry { size } => return Ok(writer.finish(size)?),
            Event::NeedInput | Event::Entry(_) | Event::EndOfArchive => return Ok(()),
        }
    }
}

fn log_archive_error(path: &[OSPathChar], err: impl core::fmt::Display) {
    Output::err(
        "archive error",
        "extracting {}: {}",
        (bun_core::fmt::fmt_os_path(path, Default::default()), err),
    );
}

/// One per extraction. Once `pwrite` fails, later entries don't try it again.
pub struct WriteStrategy {
    pub pwrite: bool,
}

impl Default for WriteStrategy {
    fn default() -> Self {
        Self { pwrite: cfg!(unix) }
    }
}

/// Never sizes a write or an allocation from the entry header or the sparse map, because
/// nothing verifies them.
pub struct EntryWriter {
    fd: Fd,
    /// One past the last byte written.
    end: i64,
    /// The file position, which only `write` and `lseek` move.
    cursor: i64,
    #[cfg(windows)]
    marked_sparse: bool,
}

impl EntryWriter {
    pub fn new(fd: Fd) -> Self {
        Self {
            fd,
            end: 0,
            cursor: 0,
            #[cfg(windows)]
            marked_sparse: false,
        }
    }

    #[inline]
    pub fn fd(&self) -> Fd {
        self.fd
    }

    /// NTFS gives a range that nothing writes real clusters unless the file is marked sparse.
    #[inline]
    fn before_hole(&mut self) {
        #[cfg(windows)]
        if !self.marked_sparse {
            self.marked_sparse = true;
            // A volume without sparse file support refuses the mark. The hole then takes up
            // disk space.
            let _ = bun_sys::set_sparse(self.fd);
        }
    }

    pub fn write(
        &mut self,
        strategy: &mut WriteStrategy,
        offset: i64,
        data: &[u8],
    ) -> bun_sys::Maybe<()> {
        if data.is_empty() {
            return Ok(());
        }
        let fd = self.fd;
        let file = bun_sys::File::borrow(&fd);

        #[cfg(unix)]
        if strategy.pwrite {
            match file.pwrite_all(data, offset) {
                Ok(()) => {
                    self.end = self.end.max(offset + data.len() as i64);
                    return Ok(());
                }
                Err(_) => {
                    strategy.pwrite = false;
                    bun_core::debug_warn!(
                        "archive: falling back to write() after pwrite() failure",
                    );
                }
            }
        }
        #[cfg(not(unix))]
        let _ = strategy;

        if offset != self.cursor {
            if offset > self.end {
                self.before_hole();
            }
            bun_sys::set_file_offset(self.fd, offset as u64)?;
            self.cursor = offset;
        }

        file.write_all(data)?;
        self.cursor += data.len() as i64;
        self.end = self.end.max(self.cursor);
        Ok(())
    }

    /// `end` is the length of the file, which the last write need not have reached.
    pub fn finish(&mut self, end: i64) -> bun_sys::Maybe<()> {
        if end > self.end {
            self.before_hole();
            bun_sys::ftruncate(self.fd, end)?;
            self.end = end;
        }
        Ok(())
    }
}

/// `mkdirat` mode for a directory entry. `perm` is whatever the header
/// encoded (a GNU base-256 field need not fit in `0o7777`), so mask it, then
/// make readable directories listable like node-tar does:
/// https://github.com/npm/node-tar/blob/main/lib/mode-fix.js
#[cfg(not(windows))]
pub fn directory_mode(perm: bun_sys::Mode) -> bun_sys::Mode {
    let mut mode = perm & 0o7777;
    if (mode & 0o400) != 0 {
        mode |= 0o100;
    }
    if (mode & 0o40) != 0 {
        mode |= 0o10;
    }
    if (mode & 0o4) != 0 {
        mode |= 0o1;
    }
    mode
}

/// Returns the path where node-tar would extract the npm tarball entry `path`, whose leading
/// `package/` is already removed. The result is empty for an entry that node-tar skips.
pub fn normalize_npm_entry_path<'a>(
    path: &[OSPathChar],
    buf: &'a mut [OSPathChar],
) -> &'a mut [OSPathChar] {
    if path
        .split(|c| bun_paths::is_sep_any_t(*c))
        .any(|part| part == [b'.' as OSPathChar; 2])
    {
        return &mut buf[..0];
    }
    #[cfg(windows)]
    return bun_paths::resolve_path::normalize_buf_t::<u16, bun_paths::platform::Auto>(path, buf);
    #[cfg(not(windows))]
    bun_paths::resolve_path::normalize_string_generic_t::<u8, false, false>(path, buf, b'/', |c| {
        c == b'/'
    })
}

/// Returns the first component of an entry's path, which is the archive's root folder.
pub fn first_path_component(path: &[OSPathChar]) -> &[OSPathChar] {
    let sep = b'/' as OSPathChar;
    let start = path.iter().take_while(|c| **c == sep).count();
    let rest = &path[start..];
    &rest[..strings::index_of_scalar(rest, sep).unwrap_or(rest.len())]
}

/// Validates that a symlink target doesn't escape the extraction directory.
/// Returns true if the symlink is safe (target stays within extraction dir),
/// false if it would escape (e.g., via ../ traversal or absolute path).
///
/// The check works by normalizing `symlink_dir/link_target` as a relative
/// path with leading `..` preserved; the target is unsafe if the result
/// climbs above the extraction root.
#[cfg(unix)]
pub fn is_symlink_target_safe(
    symlink_path: &[u8],
    link_target_bytes: &[u8],
    symlink_join_buf: &mut Option<bun_paths::path_buffer_pool::Guard>,
) -> bool {
    // Absolute symlink targets are never safe - they could point anywhere
    if link_target_bytes.is_empty() || link_target_bytes[0] == b'/' {
        return false;
    }

    let mut seen_named_component = false;
    for component in strings::split(link_target_bytes, b"/") {
        match component {
            b"" | b"." => {}
            b".." => {
                if seen_named_component {
                    return false;
                }
            }
            _ => seen_named_component = true,
        }
    }

    // Get the directory containing the symlink
    let symlink_dir = bun_paths::dirname_simple(symlink_path);

    let join_buf: &mut PathBuffer =
        symlink_join_buf.get_or_insert_with(bun_paths::path_buffer_pool::get);

    // Normalize symlink_dir/link_target as a relative path. An absolute fake
    // root cannot be used here: POSIX normalization clamps excess `..` at `/`,
    // so a target like `../../../packages/x` would normalize back under any
    // fake root that happens to match a real ancestor directory name.
    if symlink_dir.len() + 1 + link_target_bytes.len() >= join_buf.len() {
        return false;
    }
    let mut written = 0usize;
    if !symlink_dir.is_empty() {
        join_buf[..symlink_dir.len()].copy_from_slice(symlink_dir);
        written = symlink_dir.len();
        join_buf[written] = b'/';
        written += 1;
    }
    join_buf[written..written + link_target_bytes.len()].copy_from_slice(link_target_bytes);
    written += link_target_bytes.len();

    let mut norm_buf = bun_paths::path_buffer_pool::get();
    let resolved = bun_paths::resolve_path::normalize_string_generic_t::<u8, true, false>(
        &join_buf[..written],
        &mut norm_buf[..],
        b'/',
        |c| c == b'/',
    );

    !(strings::eql(resolved, b"..") || strings::has_prefix_comptime(resolved, b"../"))
}

#[cfg(unix)]
pub struct DeferredSymlink {
    path: bun_core::ZBox,
    target: bun_core::ZBox,
}

#[cfg(unix)]
impl DeferredSymlink {
    pub fn new(path: &[u8], target: &[u8]) -> Self {
        Self {
            path: bun_core::ZBox::from_bytes(path),
            target: bun_core::ZBox::from_bytes(target),
        }
    }
}

/// `is_symlink_target_safe` takes a symlink to be where its path says, so it is asked again about one that symlinks lead to.
#[cfg(unix)]
pub fn create_deferred_symlinks(dir_fd: Fd, symlinks: &[DeferredSymlink], log: bool) -> u32 {
    for symlink in symlinks {
        let dirname = bun_paths::dirname_simple(symlink.path.as_bytes());
        if !dirname.is_empty() {
            let _ = beneath::make_path(dir_fd, dirname, Symlinks::FollowInside);
        }
    }

    let mut created: u32 = 0;
    let mut join_buf = None;
    for symlink in symlinks {
        let (target, path) = (symlink.target.as_zstr(), symlink.path.as_bytes());
        let is_safe = |path: &[u8]| is_symlink_target_safe(path, target.as_bytes(), &mut join_buf);
        match beneath::symlinkat_where_safe(target, dir_fd, path, is_safe) {
            Ok(()) => created += 1,
            Err(_) => {
                if log {
                    bun_core::warn!(
                        "Skipping symlink that could not be created: {} -> {}\n",
                        bun_core::fmt::escape_control_chars(symlink.path.as_bytes()),
                        bun_core::fmt::escape_control_chars(symlink.target.as_bytes()),
                    );
                }
            }
        }
    }
    created
}

/// Recursive mkdir over a WTF-16 path: component-iterates the
/// wide path and `NtCreateFile`s each prefix with `FILE_OPEN_IF`, walking back
/// on `FileNotFound` and forward again on success. This stays in WTF-16
/// throughout (no UTF-8 round-trip — `bun_sys::make_path_w` is the *different*
/// `bun.makePathW` helper which transcodes via `from_w_path` and would lose
/// lone surrogates / skip `\??\` long-path prefixing).
#[cfg(windows)]
fn make_path_u16(dir_fd: Fd, sub_path: &[u16]) -> crate::Result<()> {
    use bun_sys::{E, WindowsOpenDirOp, WindowsOpenDirOptions, open_dir_at_windows};
    // Access mask (`STANDARD_RIGHTS_READ | FILE_READ_ATTRIBUTES |
    // FILE_READ_EA | SYNCHRONIZE | FILE_TRAVERSE`) is selected by setting `read_only`,
    // and `FILE_OPEN_IF` via `OpenOrCreate`.
    let opts = WindowsOpenDirOptions {
        op: WindowsOpenDirOp::OpenOrCreate,
        ..Default::default()
    };
    // tar entry paths are dir-relative (no drive/UNC/`\??\`) so `init` never
    // returns BadPathName here.
    let it = bun_paths::ComponentIterator::init(sub_path, bun_paths::PathFormat::Windows)?;
    bun_paths::make_path_with(it, |prefix| {
        match open_dir_at_windows(dir_fd, prefix, opts) {
            Ok(fd) => {
                fd.close();
                Ok(bun_paths::MakePathStep::Created)
            }
            Err(e) if e.get_errno() == E::ENOENT => Ok(bun_paths::MakePathStep::NotFound(e.into())),
            Err(e) => Err(e.into()),
        }
    })
}

struct OutputFile {
    fd: Fd,
    close: bool,
}

impl Drop for OutputFile {
    fn drop(&mut self) {
        if self.close {
            // Closing is slow under Windows antivirus, but closing asynchronously gains nothing and
            // can make NtSetInformationFile fail.
            self.fd.close();
        }
    }
}

pub struct Archiver;

pub mod archiver {
    use super::*;

    pub struct Context {
        pub pluckers: Vec<Plucker>,
        pub overwrite_list: StringArrayHashMap<()>,
    }

    pub struct Plucker {
        pub contents: MutableString,
        pub(crate) filename_hash: u64,
        pub found: bool,
        pub fd: Fd,
    }

    impl Plucker {
        pub fn init(filepath: &[OSPathChar], estimated_size: usize) -> crate::Result<Plucker> {
            Ok(Plucker {
                contents: MutableString::init(estimated_size)?,
                filename_hash: hash(slice_as_bytes(filepath)),
                fd: Fd::INVALID,
                found: false,
            })
        }
    }

    #[derive(Clone, Copy)]
    pub struct ExtractOptions {
        pub depth_to_skip: usize,
        pub close_handles: bool,
        pub log: bool,
        pub npm: bool,
        pub skip_symlinks: bool,
        /// Only this call writes to the destination, so it holds no symlink until the last entry is out.
        pub new_destination: bool,
    }

    impl Default for ExtractOptions {
        fn default() -> Self {
            Self {
                depth_to_skip: 0,
                close_handles: true,
                log: false,
                npm: false,
                skip_symlinks: false,
                new_destination: false,
            }
        }
    }
}

pub use archiver::{Context, ExtractOptions, Plucker};

pub trait ArchiveAppender {
    /// Mirrors `@hasDecl(Child, "onFirstDirectoryName")`.
    const HAS_ON_FIRST_DIRECTORY_NAME: bool = false;

    fn needs_first_dirname(&self) -> bool {
        false
    }
    fn on_first_directory_name(&mut self, _name: &[u8]) {}

    fn append(&mut self, path: &[u8]) -> crate::Result<&[u8]> {
        let _ = path;
        unreachable!()
    }
}

impl ArchiveAppender for () {}

impl Archiver {
    pub fn get_overwriting_file_list<A: ArchiveAppender, const DEPTH_TO_SKIP: usize>(
        file_buffer: &[u8],
        root: &[u8],
        ctx: &mut Context,
        appender: &mut A,
        // Called with the path of every entry below `root`. If it returns true, the entry is listed
        // whatever its size.
        leaves_root: &mut dyn FnMut(&[u8]) -> bun_sys::Result<bool>,
    ) -> crate::Result<()> {
        // Uses the bun_sys directory-fd helpers (open_dir_absolute / open_dir_at).
        let dir: Fd = 'brk: {
            let cwd = Fd::cwd();

            // if the destination doesn't exist, we skip the whole thing since nothing can overwrite it.
            if bun_paths::is_absolute(root) {
                let Ok(d) = bun_sys::open_dir_absolute(root) else {
                    return Ok(());
                };
                break 'brk d;
            } else {
                let Ok(d) = bun_sys::open_dir_at(cwd, root) else {
                    return Ok(());
                };
                break 'brk d;
            }
        };
        let _close_dir = bun_sys::CloseOnDrop::new(dir);

        let mut reader = open_memory(file_buffer, Dialect::General)?;
        let mut normalized_buf = bun_paths::path_buffer_pool::get();

        'loop_: while let Some(entry) = reader.next_entry()? {
            let pathname = display_path(entry)?;
            let pathname_bytes: &[u8] = &pathname;

            // Tokenizer semantics: `next()` skips leading
            // separators and returns None only when no token remains;
            // the rest-of-input slice also skips leading separators.
            // An entry's name has `/` on every platform, as in `extract_to_dir`.
            let mut remaining = pathname_bytes;
            let mut depth_i = 0usize;
            while depth_i < DEPTH_TO_SKIP {
                // skip leading separators
                while let [first, rest @ ..] = remaining {
                    if *first == b'/' {
                        remaining = rest;
                    } else {
                        break;
                    }
                }
                if remaining.is_empty() {
                    continue 'loop_;
                }
                match strings::index_of_char_usize(remaining, b'/') {
                    Some(i) => remaining = &remaining[i..],
                    None => remaining = &remaining[remaining.len()..],
                }
                depth_i += 1;
            }
            // skip leading separators (tokenizer.rest() does this)
            while let [first, rest @ ..] = remaining {
                if *first == b'/' {
                    remaining = rest;
                } else {
                    break;
                }
            }

            let pathname = remaining;
            if pathname.is_empty() || pathname.len() >= normalized_buf.len() {
                continue 'loop_;
            }
            let normalized = bun_paths::resolve_path::normalize_buf_t::<
                u8,
                bun_paths::platform::Auto,
            >(pathname, &mut normalized_buf[..]);
            let normalized_len = normalized.len();
            let pathname: &[u8] = &normalized_buf[..normalized_len];
            if pathname.is_empty() || pathname == b"." {
                continue 'loop_;
            }
            #[cfg(windows)]
            if bun_paths::is_absolute_windows(pathname) {
                continue 'loop_;
            }
            let dirname = strings::trim(bun_paths::dirname_simple(pathname), SEP_STR.as_bytes());

            let size: usize = usize::try_from(entry.size().max(0)).unwrap();
            let in_the_way = leaves_root(pathname)?
                || (size > 0
                    && match bun_sys::openat_a(dir, pathname, bun_sys::O::WRONLY, 0) {
                        Ok(opened) => {
                            let _close = bun_sys::CloseOnDrop::new(opened);
                            bun_sys::get_file_size(opened)? > 0
                        }
                        Err(_) => false,
                    });

            if in_the_way {
                let is_already_top_level = dirname.is_empty();
                let path_to_use_: &[u8] = 'brk: {
                    let __pathname: &[u8] = pathname;

                    if is_already_top_level {
                        break 'brk __pathname;
                    }

                    let index = strings::index_of_char_usize(__pathname, SEP).unwrap();
                    break 'brk &__pathname[..index];
                };
                let mut temp_buf = [0u8; 1024];
                temp_buf[..path_to_use_.len()].copy_from_slice(path_to_use_);
                let path_to_use: &[u8] = if !is_already_top_level {
                    temp_buf[path_to_use_.len()] = SEP;
                    &temp_buf[..path_to_use_.len() + 1]
                } else {
                    &temp_buf[..path_to_use_.len()]
                };

                let overwrite_entry = ctx.overwrite_list.get_or_put(path_to_use)?;
                if !overwrite_entry.found_existing {
                    *overwrite_entry.key_ptr = Box::from(appender.append(path_to_use)?);
                }
            }
        }

        Ok(())
    }

    pub fn extract_to_dir<A: ArchiveAppender>(
        file_buffer: &[u8],
        dir: Fd,
        ctx: Option<&mut Context>,
        appender: &mut A,
        options: ExtractOptions,
    ) -> crate::Result<u32> {
        let dialect = if options.npm {
            Dialect::Npm
        } else {
            Dialect::General
        };
        let mut reader = open_memory(file_buffer, dialect)?;
        let mut os_path_buf: Vec<OSPathChar> = Vec::new();
        let mut count: u32 = 0;
        let dir_fd = dir;

        // reshaped for borrowck — ctx is Option<&mut>, rebound as needed
        let mut ctx = ctx;

        #[cfg(unix)]
        let mut symlink_join_buf: Option<bun_paths::path_buffer_pool::Guard> = None;

        #[cfg(unix)]
        let mut deferred_symlinks: Vec<DeferredSymlink> = Vec::new();

        #[cfg(unix)]
        let symlinks = if options.new_destination {
            Symlinks::Follow
        } else {
            Symlinks::FollowInside
        };

        let mut normalized_buf = bun_paths::os_path_buffer_pool::get();
        let mut write_strategy = WriteStrategy::default();

        'loop_: while let Some(entry) = reader.next_entry()? {
            let pathname_z = os_path(entry, &mut os_path_buf)?;

            if A::HAS_ON_FIRST_DIRECTORY_NAME {
                if appender.needs_first_dirname() {
                    let root = first_path_component(pathname_z);
                    #[cfg(windows)]
                    {
                        let result = strings::to_utf8_list_with_type(Vec::new(), root)?;
                        // onFirstDirectoryName copies the contents of pathname to another buffer, safe to free
                        appender.on_first_directory_name(&result);
                    }
                    #[cfg(not(windows))]
                    {
                        appender.on_first_directory_name(root);
                    }
                }
            }

            let kind = entry.kind();

            if options.npm {
                // - ignore entries other than files (`true` can only be returned if type is file)
                //   https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L419-L441
                if kind != bun_sys::FileKind::File {
                    continue;
                }

                // TODO: .npmignore, or .gitignore if it doesn't exist
                // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L434
            }

            if options.skip_symlinks && kind == bun_sys::FileKind::SymLink {
                continue;
            }

            // strip and normalize the path
            let pathname_slice: &[OSPathChar] = pathname_z;
            let mut remaining: &[OSPathChar] = pathname_slice;
            {
                let sep: OSPathChar = b'/' as OSPathChar;
                let mut i = 0usize;
                while i < options.depth_to_skip {
                    // npm counts the empty name before a leading `/` as a component.
                    while let [first, rest @ ..] = remaining {
                        if *first == sep && !options.npm {
                            remaining = rest;
                        } else {
                            break;
                        }
                    }
                    if remaining.is_empty() {
                        continue 'loop_;
                    }
                    match strings::index_of_scalar(remaining, sep) {
                        Some(j) => remaining = &remaining[j + 1..],
                        None => remaining = &remaining[remaining.len()..],
                    }
                    i += 1;
                }
                while let [first, rest @ ..] = remaining {
                    if *first == sep {
                        remaining = rest;
                    } else {
                        break;
                    }
                }
            }
            let pathname: &[OSPathChar] = remaining;

            if pathname.len() >= normalized_buf.len() {
                if options.log {
                    bun_core::warn!(
                        "Skipping entry with a path longer than the maximum path length: {}\n",
                        bun_core::fmt::EscapeControlChars(bun_core::fmt::fmt_os_path(
                            pathname,
                            Default::default()
                        )),
                    );
                }
                continue;
            }

            let normalized = if options.npm {
                normalize_npm_entry_path(pathname, &mut normalized_buf[..])
            } else {
                bun_paths::resolve_path::normalize_buf_t::<OSPathChar, bun_paths::platform::Auto>(
                    pathname,
                    &mut normalized_buf[..],
                )
            };
            let normalized_len = normalized.len();
            normalized_buf[normalized_len] = 0;
            // SAFETY: we just wrote a NUL at normalized_buf[normalized_len]
            let path: &mut [OSPathChar] = &mut normalized_buf[..normalized_len];
            if path.is_empty() || (path.len() == 1 && path[0] == b'.' as OSPathChar) {
                continue;
            }

            // Skip entries whose normalized path is absolute on Windows.
            // `openatWindows` ignores `dir_fd` for absolute inputs (drive
            // letter or UNC), so without this guard a tar entry could
            // resolve outside the extraction directory. On POSIX the
            // tokenize-on-'/' step already strips any leading separators,
            // so `normalizeBufT` cannot produce an absolute output.
            #[cfg(windows)]
            {
                if bun_paths::is_absolute_windows_t::<u16>(path) {
                    continue 'loop_;
                }
            }

            #[cfg(windows)]
            if options.npm {
                // When writing files on Windows, translate the characters to their
                // 0xf000 higher-encoded versions.
                // https://github.com/isaacs/node-tar/blob/0510c9ea6d000c40446d56674a7efeec8e72f052/lib/winchars.js
                let mut remain: &mut [OSPathChar] = path;
                if strings::starts_with_windows_drive_letter_t::<OSPathChar>(remain) {
                    // don't encode `:` from the drive letter
                    // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/tar/lib/unpack.js#L327
                    remain = &mut remain[2..];
                }

                for ch in remain.iter_mut() {
                    match *ch {
                        c if c == b'|' as OSPathChar
                            || c == b'<' as OSPathChar
                            || c == b'>' as OSPathChar
                            || c == b'?' as OSPathChar
                            || c == b':' as OSPathChar =>
                        {
                            *ch += 0xf000;
                        }
                        _ => {}
                    }
                }
            }

            let path_slice: &[OSPathChar] = &path[..];

            if options.log {
                bun_core::prettyln!(
                    " {}",
                    bun_core::fmt::EscapeControlChars(bun_core::fmt::fmt_os_path(
                        path_slice,
                        Default::default()
                    ))
                );
            }

            count += 1;

            match kind {
                bun_sys::FileKind::Directory => {
                    #[cfg(windows)]
                    {
                        make_path_u16(dir, path_slice)?;
                    }
                    #[cfg(not(windows))]
                    {
                        let mode = directory_mode(entry.perm());
                        match beneath::mkdirat(dir_fd, path_slice, mode, symlinks) {
                            Ok(()) => {}
                            Err(err) => {
                                // It's possible for some tarballs to return a directory twice, with and
                                // without `./` in the beginning. So if it already exists, continue to the
                                // next entry.
                                match err.get_errno() {
                                    bun_sys::E::EEXIST | bun_sys::E::ENOTDIR => continue,
                                    _ => {}
                                }
                                let dirname = bun_paths::dirname_simple(path_slice);
                                if dirname.is_empty() {
                                    return Err(err.into());
                                }
                                let _ = beneath::make_path(dir, dirname, symlinks);
                                let _ = beneath::mkdirat(dir_fd, path_slice, 0o777, symlinks);
                            }
                        }
                    }
                }
                bun_sys::FileKind::SymLink => {
                    let link_target = entry.symlink().unwrap_or_default();
                    #[cfg(unix)]
                    {
                        // Validate that the symlink target doesn't escape the extraction directory.
                        // This prevents path traversal attacks where a malicious tarball creates a symlink
                        // pointing outside (e.g., to /tmp), then writes files through that symlink.
                        if !is_symlink_target_safe(path_slice, link_target, &mut symlink_join_buf) {
                            // Skip symlinks that would escape the extraction directory
                            if options.log {
                                bun_core::warn!(
                                    "Skipping symlink with unsafe target: {} -> {}\n",
                                    bun_core::fmt::EscapeControlChars(bun_core::fmt::fmt_os_path(
                                        path_slice,
                                        Default::default(),
                                    )),
                                    bun_core::fmt::escape_control_chars(link_target),
                                );
                            }
                            continue;
                        }
                        deferred_symlinks.push(DeferredSymlink::new(path_slice, link_target));
                    }
                    #[cfg(not(unix))]
                    {
                        let _ = link_target;
                    }
                }
                bun_sys::FileKind::File => {
                    // first https://github.com/npm/cli/blob/feb54f7e9a39bd52519221bae4fafc8bc70f235e/node_modules/pacote/lib/fetcher.js#L65-L66
                    // this.fmode = opts.fmode || 0o666
                    //
                    // then https://github.com/npm/cli/blob/feb54f7e9a39bd52519221bae4fafc8bc70f235e/node_modules/pacote/lib/fetcher.js#L402-L411
                    //
                    // we simplify and turn it into `entry.mode || 0o666` because we aren't accepting a umask or fmask option.
                    #[cfg(not(windows))]
                    let mode: bun_sys::Mode = (entry.perm() & 0o777) | 0o666;

                    let flags = bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;

                    #[cfg(windows)]
                    let file_handle_native: Fd =
                        match bun_sys::openat_windows(dir_fd, path_slice, flags, 0) {
                            Ok(fd) => fd,
                            Err(e) => match e.get_errno() {
                                bun_sys::E::EPERM | bun_sys::E::ENOENT => {
                                    // `Dirname::dirname` strips
                                    // trailing separators.
                                    let Some(dirname) = bun_paths::Dirname::dirname(path_slice)
                                    else {
                                        return Err(e.into());
                                    };
                                    let _ = make_path_u16(dir, dirname);
                                    bun_sys::openat_windows(dir_fd, path_slice, flags, 0)?
                                }
                                _ => return Err(e.into()),
                            },
                        };

                    #[cfg(not(windows))]
                    let file_handle_native: Fd = {
                        // dir.createFileZ(.{truncate, mode}) → bun_sys::openat
                        // SAFETY: normalized_buf[path_slice.len()] == 0 (written above).
                        let path_z: &ZStr =
                            unsafe { ZStr::from_raw(path_slice.as_ptr(), path_slice.len()) };
                        match beneath::openat(dir_fd, path_z, flags, mode, symlinks) {
                            Ok(fd) => fd,
                            Err(err) => match err.get_errno() {
                                bun_sys::E::EACCES | bun_sys::E::EPERM | bun_sys::E::ENOENT => {
                                    let dirname = bun_paths::dirname_simple(path_slice);
                                    if dirname.is_empty() {
                                        return Err(err.into());
                                    }
                                    let _ = beneath::make_path(dir, dirname, symlinks);
                                    beneath::openat(dir_fd, path_z, flags, mode, symlinks)?
                                }
                                _ => return Err(err.into()),
                            },
                        }
                    };

                    let mut output = match file_handle_native.make_lib_uv_owned() {
                        Ok(fd) => OutputFile {
                            fd,
                            close: options.close_handles,
                        },
                        Err(err) => {
                            file_handle_native.close();
                            return Err(err.into());
                        }
                    };

                    let size: usize = usize::try_from(entry.size().max(0)).unwrap();

                    if size > 0 {
                        if let Some(ctx_) = ctx.as_deref_mut() {
                            let h: u64 = if !ctx_.pluckers.is_empty() {
                                hash(slice_as_bytes(path_slice))
                            } else {
                                0u64
                            };

                            for plucker_ in ctx_.pluckers.iter_mut() {
                                if plucker_.filename_hash == h {
                                    plucker_.contents.list.clear();
                                    if let Err(err) =
                                        reader.read_data(size, &mut plucker_.contents.list)
                                    {
                                        if options.log {
                                            log_archive_error(path_slice, err);
                                        }
                                        return Err(err.into());
                                    }
                                    plucker_.found = !plucker_.contents.list.is_empty();
                                    plucker_.fd = output.fd;
                                    output.close = false;
                                    continue 'loop_;
                                }
                            }
                        }
                        if let Err(err) =
                            read_data_into_fd(&mut reader, output.fd, &mut write_strategy)
                        {
                            if options.log {
                                log_archive_error(path_slice, err);
                            }
                            return Err(crate::Error::Fail);
                        }
                    }
                }
                _ => {}
            }
        }

        #[cfg(unix)]
        create_deferred_symlinks(dir_fd, &deferred_symlinks, options.log);

        Ok(count)
    }

    pub fn extract_to_disk<A: ArchiveAppender>(
        file_buffer: &[u8],
        root: &[u8],
        ctx: Option<&mut Context>,
        appender: &mut A,
        options: ExtractOptions,
    ) -> crate::Result<u32> {
        let dir: Fd = 'brk: {
            let cwd = Fd::cwd();
            let _ = cwd.make_path_u8(root);

            if bun_paths::is_absolute(root) {
                break 'brk bun_sys::open_dir_absolute(root)?;
            } else {
                break 'brk bun_sys::open_dir_at(cwd, root)?;
            }
        };

        let _close_guard = scopeguard::guard(dir, |d| {
            if options.close_handles {
                d.close();
            }
        });

        Self::extract_to_dir(file_buffer, dir, ctx, appender, options)
    }
}

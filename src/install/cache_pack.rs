//! A pack is untrusted input, so nothing is written to the cache until the whole pack has been
//! verified.

use core::fmt;

use bun_core::{Global, Output, ZBox, ZStr, fmt as bun_fmt, strings};
use bun_sys::{self as sys, Dir, E, Fd, File, O, walker_skippable};
use bun_wyhash::Wyhash;

use crate::PackageManager;
use crate::bun_fs::FileSystem;
use crate::dependency;
use crate::lockfile_real::package::PackageColumns as _;
use crate::lockfile_real::reachable;
use crate::package_manager_real::directories;
use crate::package_manager_real::package_manager_options::LogLevel;
use crate::repository::is_safe_resolved_tag;
use crate::resolution::Tag as ResolutionTag;

/// Followed by records, little endian: u8 kind | u32 path_len | path | u32 mode | u64 size | size
/// bytes.
const MAGIC: &[u8; 16] = b"BUNCACHEPACK\0v1\n";

const KIND_END: u8 = 0;
/// The path is the cache folder's name, in ascending order. The bytes are the package's records:
/// any number of kinds 2, 3 and 4, then one kind 5.
const KIND_PACKAGE: u8 = 1;
const KIND_FILE: u8 = 2;
const KIND_SYMLINK: u8 = 3;
/// Comes before everything inside it.
const KIND_DIRECTORY: u8 = 4;
/// bytes = u64 wyhash of the folder name, then of the package's bytes up to here.
const KIND_CHECKSUM: u8 = 5;

/// The longest allowed record path or symlink target. With its NUL terminator, it fits in a
/// `PathBuffer`.
const MAX_PACK_PATH_LEN: usize = if bun_core::MAX_PATH_BYTES < 4096 {
    bun_core::MAX_PATH_BYTES - 1
} else {
    4095
};
const IO_BUFFER_LEN: usize = 1 << 20;

#[derive(Default)]
pub struct PackSummary {
    pub packages: u32,
    pub files: u64,
    pub bytes: u64,
    /// Expected on this platform, but not (or not completely) in the cache.
    pub missing: u32,
}

#[derive(Default)]
pub struct UnpackSummary {
    pub packages: u32,
    pub created: u32,
    pub already_cached: u32,
    /// Entries where something that the installer wouldn't accept already exists under that name.
    /// They're left alone.
    pub incomplete: u32,
    pub bytes: u64,
}

pub enum Error {
    Sys(sys::Error),
    /// The file isn't something that `pack` wrote: it's damaged, truncated or malicious.
    Pack {
        reason: &'static str,
        record: u64,
        path: Box<[u8]>,
    },
    /// The cache holds something `unpack` would refuse.
    Entry {
        reason: &'static str,
        path: Box<[u8]>,
    },
}

impl From<sys::Error> for Error {
    fn from(err: sys::Error) -> Self {
        Error::Sys(err)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Sys(err) => write!(f, "{}", bun_fmt::EscapeControlChars(err)),
            Error::Pack {
                reason,
                record,
                path,
            } => {
                write!(f, "{reason} (record #{record}")?;
                if !path.is_empty() {
                    write!(f, ": \"{}\"", bun_fmt::escape_control_chars(path))?;
                }
                f.write_str(")")
            }
            Error::Entry { reason, path } => {
                write!(f, "{reason}: \"{}\"", bun_fmt::escape_control_chars(path))
            }
        }
    }
}

// ───────────────────────────────── names ─────────────────────────────────────

/// Win32 drops trailing dots and spaces, and takes `NUL.txt` for a device and `a:b` for a stream.
fn is_safe_windows_component(component: &[u8]) -> bool {
    if strings::contains_any(component, b":<>\"|?*")
        || dependency::contains_control_character(component)
        || matches!(component[component.len() - 1], b'.' | b' ')
    {
        return false;
    }
    let stem_len = strings::index_of_char_usize(component, b'.').unwrap_or(component.len());
    let stem = strings::trim_right(&component[..stem_len], b" ");
    let is = |name: &[u8]| strings::eql_case_insensitive_ascii_check_length(stem, name);
    if is(b"CON") || is(b"PRN") || is(b"AUX") || is(b"NUL") || is(b"CONIN$") || is(b"CONOUT$") {
        return false;
    }
    // COM0-COM9, LPT0-LPT9 and their superscript forms (U+00B9, U+00B2, U+00B3)
    let is_port = strings::has_prefix_case_insensitive(stem, b"COM")
        || strings::has_prefix_case_insensitive(stem, b"LPT");
    !(is_port
        && match &stem[3..] {
            [digit] => digit.is_ascii_digit(),
            [0xC2, superscript] => matches!(superscript, 0xB9 | 0xB2 | 0xB3),
            _ => false,
        })
}

/// The check that every path in a pack goes through: joined to a directory, the path has to stay
/// below that directory.
fn is_safe_relative_path(path: &[u8]) -> bool {
    !path.is_empty()
        && !strings::contains_any(path, b"\\\0")
        && strings::split(path, b"/").all(|component| {
            !component.is_empty()
                && component != b"."
                && component != b".."
                && (!cfg!(windows) || is_safe_windows_component(component))
        })
}

/// `…@@@<n>` without the `@@@<n>`.
fn without_cache_version(name: &[u8]) -> Option<&[u8]> {
    let at = strings::last_index_of(name, b"@@@")?;
    let version = &name[at + 3..];
    (!version.is_empty() && version.iter().all(u8::is_ascii_digit)).then_some(&name[..at])
}

fn without_hex16(s: &[u8], sigil: u8, is_hex: impl Fn(&u8) -> bool) -> Option<&[u8]> {
    if s.first() != Some(&sigil) {
        return Some(s);
    }
    (s.len() > 16 && s[1..17].iter().all(is_hex)).then(|| &s[17..])
}

/// `<major>.<minor>.<patch>[-<16 hex>][+<16 HEX>][@@<host>[__<16 hex>]]@@@<n>`
fn is_npm_entry_version(mut s: &[u8]) -> bool {
    let separators: [&[u8]; 3] = [b".", b".", b""];
    for separator in separators {
        let digits = s.iter().take_while(|b| b.is_ascii_digit()).count();
        if digits == 0 || !s[digits..].starts_with(separator) {
            return false;
        }
        s = &s[digits + separator.len()..];
    }
    let Some(s) = without_hex16(s, b'-', |b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        .and_then(|s| without_hex16(s, b'+', |b| matches!(b, b'0'..=b'9' | b'A'..=b'F')))
        .and_then(without_cache_version)
    else {
        return false;
    };
    match s.strip_prefix(b"@@") {
        Some(host) => !host.is_empty() && !strings::contains_any(host, b"@/"),
        None => s.is_empty(),
    }
}

/// Matches `[@scope/]name`. A second `@` isn't allowed, so that the scope can't be a `@T@…`, `@G@…`
/// or `@GH@…` entry.
fn is_npm_entry_package_name(name: &[u8]) -> bool {
    dependency::is_safe_lockfile_package_name(name)
        && name[0] != b'.'
        && !strings::contains(name, b"/.")
        && dependency::is_scoped_package_name(name)
            .is_ok_and(|scoped| strings::count_char(name, b'/') == usize::from(scoped))
}

/// `Some` for the shapes `cached_*_folder_name_print` give unpatched entries, and nothing else.
fn entry_tag(name: &[u8]) -> Option<ResolutionTag> {
    // Also what every file system can hold, so that no rename into the cache fails on the name.
    if !is_safe_relative_path(name)
        || !name.iter().all(u8::is_ascii_graphic)
        || strings::split(name, b"/").any(|component| component.len() > 255)
    {
        return None;
    }
    let (tag, id) = if let Some(rest) = name.strip_prefix(b"@T@") {
        (ResolutionTag::RemoteTarball, without_cache_version(rest)?)
    } else if let Some(rest) = name.strip_prefix(b"@GH@") {
        (ResolutionTag::Github, without_cache_version(rest)?)
    } else if let Some(rest) = name.strip_prefix(b"@G@") {
        (ResolutionTag::Git, rest)
    } else {
        let at = strings::index_of_char_pos(name, b'@', 1)?;
        return (is_npm_entry_package_name(&name[..at]) && is_npm_entry_version(&name[at + 1..]))
            .then_some(ResolutionTag::Npm);
    };
    is_safe_resolved_tag(id).then_some(tag)
}

// ───────────────────────────────── pack ──────────────────────────────────────

struct LockfileEntry {
    name: ZBox,
    tag: ResolutionTag,
    /// For this os / cpu / libc, so its absence from the cache deserves a warning.
    expected: bool,
}

/// Returns the unpatched names, because both linkers look those up first and create the
/// `_patch_hash=` copy from them.
fn lockfile_entries(pm: &mut PackageManager) -> Vec<LockfileEntry> {
    // A bundled dependency ships inside its parent's entry and doesn't have its own.
    let anywhere = reachable::Options {
        bundled: false,
        ..reachable::Options::all(0)
    };
    let here = reachable::Options {
        platform: Some((pm.options.cpu, pm.options.os, pm.options.libc)),
        ..anywhere
    };
    let resolutions = pm.lockfile.buffers.resolutions.as_slice();
    let wanted = reachable::packages(&pm.lockfile, resolutions, anywhere);
    let expected = reachable::packages(&pm.lockfile, resolutions, here);

    let mut entries: Vec<LockfileEntry> = Vec::new();
    let mut path_buf = bun_paths::path_buffer_pool::get();
    for i in 0..pm.lockfile.packages.len() {
        let resolution = pm.lockfile.packages.items_resolution()[i];
        if !wanted.is_set(i)
            || !matches!(
                resolution.tag,
                ResolutionTag::Npm
                    | ResolutionTag::Git
                    | ResolutionTag::Github
                    | ResolutionTag::LocalTarball
                    | ResolutionTag::RemoteTarball
            )
        {
            continue;
        }
        let integrity = pm.lockfile.packages.items_meta()[i].integrity;
        // It has no entry name until an install records what it extracted.
        if resolution.tag.is_tarball() && !integrity.tag.is_supported() {
            continue;
        }
        let name = pm
            .lockfile
            .str(&pm.lockfile.packages.items_name()[i])
            .to_vec();
        let subpath = directories::compute_cache_dir_and_subpath(
            pm,
            &name,
            &resolution,
            &integrity,
            &mut path_buf,
            None,
        )
        .cache_dir_subpath;
        entries.push(LockfileEntry {
            name: ZBox::from_bytes(subpath.as_bytes()),
            tag: resolution.tag,
            expected: expected.is_set(i),
        });
    }
    bun_collections::index_sort::sort_slice_by(&mut entries, |a, b| {
        a.name
            .as_bytes()
            .cmp(b.name.as_bytes())
            .then(b.expected.cmp(&a.expected))
    });
    entries.dedup_by(|a, b| a.name.as_bytes() == b.name.as_bytes());
    entries
}

fn tmpname(prefix: &[u8]) -> ZBox {
    let mut buf = bun_paths::path_buffer_pool::get();
    let name = FileSystem::tmpname(prefix, &mut buf[..], bun_core::fast_random());
    ZBox::from_bytes(name.expect("unreachable").as_bytes())
}

/// Written next to the destination and then renamed over it. Removed on drop if the rename didn't
/// happen.
struct TempOutput {
    dir: Dir,
    name: ZBox,
    file: Option<File>,
    committed: bool,
}

impl TempOutput {
    fn create(destination: &[u8]) -> sys::Maybe<Self> {
        let dir = Dir::cwd().make_open_path(
            bun_paths::dirname(destination).unwrap_or(b"."),
            Default::default(),
        )?;
        let name = tmpname(b"pack");
        let file = sys::openat(
            dir.fd(),
            &name,
            O::WRONLY | O::CREAT | O::EXCL | O::CLOEXEC,
            0o644,
        )?;
        Ok(Self {
            dir,
            name,
            file: Some(File::from_fd(file)),
            committed: false,
        })
    }

    fn commit(mut self, destination: &[u8]) -> sys::Maybe<()> {
        // Windows requires the file to be closed before it's renamed.
        self.file = None;
        let basename = ZBox::from_bytes(bun_paths::basename(destination));
        sys::renameat(self.dir.fd(), &self.name, self.dir.fd(), &basename)?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for TempOutput {
    fn drop(&mut self) {
        if !self.committed {
            self.file = None;
            let _ = sys::unlinkat(self.dir.fd(), &self.name);
        }
    }
}

struct Writer<'a> {
    /// `None` for `--dry-run`, which still reads and checks every package but writes no pack.
    file: Option<&'a File>,
    buf: Box<[u8]>,
    len: usize,
    /// The number of bytes already written to `file`. Writes pass an explicit offset, so that
    /// `patch_u64` doesn't move the file position.
    flushed: u64,
    hasher: Wyhash,
}

impl<'a> Writer<'a> {
    fn new(file: Option<&'a File>) -> Self {
        Self {
            file,
            buf: vec![0u8; IO_BUFFER_LEN].into_boxed_slice(),
            len: 0,
            flushed: 0,
            hasher: Wyhash::init(0),
        }
    }

    fn pos(&self) -> u64 {
        self.flushed + self.len as u64
    }

    fn flush(&mut self) -> sys::Maybe<()> {
        if let Some(file) = self.file {
            file.pwrite_all(&self.buf[..self.len], self.flushed as i64)?;
        }
        self.flushed += self.len as u64;
        self.len = 0;
        Ok(())
    }

    fn write(&mut self, mut bytes: &[u8]) -> sys::Maybe<()> {
        self.hasher.update(bytes);
        while !bytes.is_empty() {
            if self.len == self.buf.len() {
                self.flush()?;
            }
            let n = bytes.len().min(self.buf.len() - self.len);
            self.buf[self.len..self.len + n].copy_from_slice(&bytes[..n]);
            self.len += n;
            bytes = &bytes[n..];
        }
        Ok(())
    }

    fn header(&mut self, kind: u8, path: &[u8], mode: u32, size: u64) -> sys::Maybe<()> {
        self.write(&[kind])?;
        self.write(&(path.len() as u32).to_le_bytes())?;
        self.write(path)?;
        self.write(&mode.to_le_bytes())?;
        self.write(&size.to_le_bytes())
    }

    /// Returns false if `file` ended before `size` bytes were read.
    fn copy_from(&mut self, file: &File, mut size: u64) -> sys::Maybe<bool> {
        while size > 0 {
            if self.len == self.buf.len() {
                self.flush()?;
            }
            let room = (self.buf.len() - self.len).min(usize::try_from(size).unwrap_or(usize::MAX));
            let n = file.read(&mut self.buf[self.len..self.len + room])?;
            if n == 0 {
                return Ok(false);
            }
            self.hasher.update(&self.buf[self.len..self.len + n]);
            self.len += n;
            size -= n as u64;
        }
        Ok(true)
    }

    fn patch_u64(&mut self, at: u64, value: u64) -> sys::Maybe<()> {
        let bytes = value.to_le_bytes();
        if at >= self.flushed {
            let i = (at - self.flushed) as usize;
            self.buf[i..i + bytes.len()].copy_from_slice(&bytes);
            return Ok(());
        }
        self.flush()?;
        self.file
            .map_or(Ok(()), |file| file.pwrite_all(&bytes, at as i64))
    }
}

fn pack_entry(
    w: &mut Writer<'_>,
    cache_dir: Fd,
    name: &ZStr,
    summary: &mut PackSummary,
) -> Result<(), Error> {
    let refuse = |reason: &'static str, rel: &[u8]| {
        let mut path = name.as_bytes().to_vec();
        path.push(b'/');
        path.extend_from_slice(rel);
        Error::Entry {
            reason,
            path: path.into_boxed_slice(),
        }
    };

    let dir = Dir::borrow(&cache_dir).open_at(name.as_bytes())?;
    w.header(KIND_PACKAGE, name.as_bytes(), 0, 0)?;
    let body = w.pos();
    w.hasher = Wyhash::init(0);
    w.hasher.update(name.as_bytes());

    let mut walker = bun_core::handle_oom(walker_skippable::walk(dir.fd(), &[], &[]));
    walker.resolve_unknown_entry_types = true;
    #[cfg(windows)]
    let mut rel_buf = bun_paths::path_buffer_pool::get();
    #[cfg(unix)]
    let mut target_buf = bun_paths::path_buffer_pool::get();
    #[cfg(unix)]
    let mut join_buf = None;

    while let Some(entry) = walker.next()? {
        #[cfg(not(windows))]
        let rel: &[u8] = entry.path.as_bytes();
        #[cfg(windows)]
        let rel: &[u8] = {
            let len = bun_paths::strings::from_wpath(&mut rel_buf[..], entry.path.as_slice()).len();
            bun_paths::resolve_path::platform_to_posix_in_place::<u8>(&mut rel_buf[..len]);
            &rel_buf[..len]
        };
        if rel.len() > MAX_PACK_PATH_LEN || !is_safe_relative_path(rel) {
            return Err(refuse("cache entry path cannot be packed", rel));
        }
        match entry.kind {
            sys::EntryKind::Directory => w.header(KIND_DIRECTORY, rel, 0o755, 0)?,
            sys::EntryKind::File => {
                let file = File::from_fd(sys::openat_os_path(
                    entry.dir,
                    entry.basename,
                    O::RDONLY | O::CLOEXEC,
                    0,
                )?);
                let stat = file.stat()?;
                let size = u64::try_from(stat.st_size).unwrap_or(0);
                w.header(KIND_FILE, rel, stat.st_mode as u32 & 0o777, size)?;
                if !w.copy_from(&file, size)? {
                    return Err(refuse("file changed while packing", rel));
                }
                summary.files += 1;
                summary.bytes += size;
            }
            sys::EntryKind::SymLink => {
                #[cfg(unix)]
                {
                    let len = sys::readlinkat(entry.dir, entry.basename, &mut target_buf[..])?;
                    let target = ZStr::from_buf(&target_buf[..], len);
                    if len > MAX_PACK_PATH_LEN
                        || !bun_libarchive::is_symlink_target_safe(rel, target, &mut join_buf)
                    {
                        return Err(refuse(
                            "cache entry has symlink that may point outside it",
                            rel,
                        ));
                    }
                    w.header(KIND_SYMLINK, rel, 0o777, len as u64)?;
                    w.write(target.as_bytes())?;
                }
                #[cfg(not(unix))]
                return Err(refuse("cache entry has a symlink", rel));
            }
            // sockets, fifos, devices
            _ => {}
        }
    }

    w.header(KIND_CHECKSUM, b"", 0, 8)?;
    let checksum = w.hasher.final_();
    w.write(&checksum.to_le_bytes())?;
    w.patch_u64(body - 8, w.pos() - body)?;
    summary.packages += 1;
    Ok(())
}

/// Write every cache entry the loaded lockfile needs, and the cache has, to `destination`.
pub fn pack(pm: &mut PackageManager, destination: &[u8]) -> Result<PackSummary, Error> {
    let entries = lockfile_entries(pm);
    let cache_dir = pm.get_cache_directory();
    let output = if pm.options.dry_run {
        None
    } else {
        Some(TempOutput::create(destination)?)
    };
    let mut summary = PackSummary::default();
    {
        let mut w = Writer::new(output.as_ref().and_then(|output| output.file.as_ref()));
        w.write(MAGIC)?;
        for entry in &entries {
            if entry_tag(entry.name.as_bytes()).is_none() {
                return Err(Error::Entry {
                    reason: "cache entry name cannot be packed",
                    path: entry.name.as_bytes().into(),
                });
            }
            if !directories::is_package_in_cache_at(cache_dir, &entry.name, entry.tag) {
                summary.missing += u32::from(entry.expected);
                continue;
            }
            pack_entry(&mut w, cache_dir, &entry.name, &mut summary)?;
        }
        w.header(KIND_END, b"", 0, 0)?;
        w.flush()?;
    }
    if let Some(output) = output {
        output.commit(destination)?;
    }
    Ok(summary)
}

// ──────────────────────────────── unpack ─────────────────────────────────────

struct Header {
    kind: u8,
    mode: u32,
    size: u64,
}

struct Reader {
    file: File,
    /// Size of the pack. No length field is believed beyond it.
    len: u64,
    /// Offset of the next unread byte, which is `buf[start]` if `start < end`.
    pos: u64,
    buf: Box<[u8]>,
    start: usize,
    end: usize,
    hasher: Wyhash,
    record: u64,
}

impl Reader {
    fn open(path: &[u8]) -> Result<Self, Error> {
        let file = File::openat(Fd::cwd(), path, O::RDONLY | O::CLOEXEC, 0)?;
        let len = sys::get_file_size(file.handle())?;
        let mut reader = Self {
            file,
            len,
            pos: 0,
            buf: vec![0u8; IO_BUFFER_LEN].into_boxed_slice(),
            start: 0,
            end: 0,
            hasher: Wyhash::init(0),
            record: 0,
        };
        let mut magic = [0u8; MAGIC.len()];
        if reader.read_exact(&mut magic).is_err() || magic != *MAGIC {
            return Err(reader.refuse("not a bun cache pack", b""));
        }
        Ok(reader)
    }

    fn refuse(&self, reason: &'static str, path: &[u8]) -> Error {
        Error::Pack {
            reason,
            record: self.record,
            path: path.into(),
        }
    }

    /// Returns the next unread bytes, at most `max` of them. They're hashed and consumed.
    fn next_chunk(&mut self, max: u64) -> Result<&[u8], Error> {
        if self.start == self.end {
            let n = sys::pread(self.file.handle(), &mut self.buf, self.pos as i64)?;
            if n == 0 {
                return Err(self.refuse("truncated pack file", b""));
            }
            self.start = 0;
            self.end = n;
        }
        let n = (self.end - self.start).min(usize::try_from(max).unwrap_or(usize::MAX));
        let chunk = &self.buf[self.start..self.start + n];
        self.hasher.update(chunk);
        self.start += n;
        self.pos += n as u64;
        Ok(chunk)
    }

    fn read_exact(&mut self, out: &mut [u8]) -> Result<(), Error> {
        let mut filled = 0;
        while filled < out.len() {
            let chunk = self.next_chunk((out.len() - filled) as u64)?;
            out[filled..filled + chunk.len()].copy_from_slice(chunk);
            filled += chunk.len();
        }
        Ok(())
    }

    fn copy_to(&mut self, file: &File, mut size: u64) -> Result<(), Error> {
        while size > 0 {
            let chunk = self.next_chunk(size)?;
            file.write_all(chunk)?;
            size -= chunk.len() as u64;
        }
        Ok(())
    }

    /// `size <= len - pos`, as `header` has checked. Reads nothing.
    fn skip(&mut self, size: u64) {
        let buffered = (self.end - self.start) as u64;
        if size < buffered {
            self.start += size as usize;
        } else {
            self.start = self.end;
        }
        self.pos += size;
    }

    /// `out` becomes `len` bytes and a NUL.
    fn read_z(&mut self, out: &mut Vec<u8>, len: usize) -> Result<(), Error> {
        out.clear();
        out.resize(len + 1, 0);
        self.read_exact(&mut out[..len])
    }

    /// Leaves the record's path in `path`, NUL-terminated.
    fn header(&mut self, path: &mut Vec<u8>) -> Result<Header, Error> {
        self.record += 1;
        let mut head = [0u8; 5];
        self.read_exact(&mut head)?;
        let [kind, path_len @ ..] = head;
        let path_len = u32::from_le_bytes(path_len) as usize;
        if path_len > MAX_PACK_PATH_LEN {
            return Err(self.refuse("path is too long", b""));
        }
        self.read_z(path, path_len)?;
        let mut mode = [0u8; 4];
        self.read_exact(&mut mode)?;
        let mut size = [0u8; 8];
        self.read_exact(&mut size)?;
        let size = u64::from_le_bytes(size);
        if size > self.len.saturating_sub(self.pos) {
            return Err(self.refuse("truncated pack file", &path[..path_len]));
        }
        Ok(Header {
            kind,
            mode: u32::from_le_bytes(mode),
            size,
        })
    }
}

/// A private directory inside the temporary directory. The `n`th new package is staged as
/// `<name>/<n>`.
struct Staging {
    parent: Fd,
    name: ZBox,
    dir: Option<Dir>,
}

impl Staging {
    fn create(parent: Fd) -> sys::Maybe<Self> {
        let name = tmpname(b"unpack");
        sys::mkdirat(parent, &name, 0o700)?;
        let mut staging = Self {
            parent,
            name,
            dir: None,
        };
        staging.dir = Some(Dir::borrow(&parent).open_at(staging.name.as_bytes())?);
        Ok(staging)
    }

    fn fd(&self) -> Fd {
        self.dir.as_ref().map_or(Fd::INVALID, Dir::fd)
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        // Windows requires the directory to be closed before it's removed.
        self.dir = None;
        let _ = Dir::borrow(&self.parent).delete_tree(self.name.as_bytes());
    }
}

fn staged_name(buf: &mut [u8; 21], n: usize) -> &ZStr {
    ZStr::from_cstr(bun_fmt::itoa_z(buf, n as u64))
}

/// Read the `size` bytes of package `name` into the new directory `staging`/`staged`.
fn unpack_package(
    r: &mut Reader,
    staging: Fd,
    staged: &ZStr,
    name: &ZStr,
    tag: ResolutionTag,
    size: u64,
    summary: &mut UnpackSummary,
) -> Result<(), Error> {
    sys::mkdirat(staging, staged, 0o755)?;
    let dir = Dir::borrow(&staging).open_at(staged.as_bytes())?;
    let end = r.pos + size;
    r.hasher = Wyhash::init(0);
    r.hasher.update(name.as_bytes());

    let mut path: Vec<u8> = Vec::new();
    let mut target: Vec<u8> = Vec::new();
    // Symlinks are created last, so that no path can go through one while files are being written.
    #[cfg(unix)]
    let mut links: Vec<bun_libarchive::DeferredSymlink> = Vec::new();
    #[cfg(unix)]
    let mut join_buf = None;

    loop {
        let header = r.header(&mut path)?;
        let rel = ZStr::from_slice_with_nul(&path);
        if r.pos > end || header.size > end - r.pos {
            return Err(r.refuse("record runs past end of package", rel.as_bytes()));
        }
        if header.kind == KIND_CHECKSUM {
            let computed = r.hasher.final_();
            let mut stored = [0u8; 8];
            if !rel.is_empty() || header.size != 8 || end - r.pos != 8 {
                return Err(r.refuse("malformed checksum record", name.as_bytes()));
            }
            r.read_exact(&mut stored)?;
            if u64::from_le_bytes(stored) != computed {
                return Err(r.refuse("checksum mismatch", name.as_bytes()));
            }
            break;
        }
        if !is_safe_relative_path(rel.as_bytes()) {
            return Err(r.refuse("unsafe path", rel.as_bytes()));
        }
        match header.kind {
            KIND_FILE => {
                let file = File::from_fd(sys::openat(
                    dir.fd(),
                    rel,
                    O::WRONLY
                        | O::CREAT
                        | O::EXCL
                        | O::CLOEXEC
                        | if cfg!(windows) { 0 } else { O::NOFOLLOW },
                    ((header.mode & 0o755) | 0o600) as sys::Mode,
                )?);
                r.copy_to(&file, header.size)?;
                summary.bytes += header.size;
            }
            KIND_DIRECTORY => {
                if header.size != 0 {
                    return Err(r.refuse("directory record with contents", rel.as_bytes()));
                }
                sys::mkdirat(dir.fd(), rel, 0o755)?;
            }
            KIND_SYMLINK => {
                if header.size > MAX_PACK_PATH_LEN as u64 {
                    return Err(r.refuse("symlink target is too long", rel.as_bytes()));
                }
                r.read_z(&mut target, header.size as usize)?;
                #[cfg(unix)]
                {
                    let target = ZStr::from_slice_with_nul(&target);
                    if strings::contains_char(target.as_bytes(), 0)
                        || !bun_libarchive::is_symlink_target_safe(
                            rel.as_bytes(),
                            target,
                            &mut join_buf,
                        )
                    {
                        return Err(r.refuse("unsafe symlink target", rel.as_bytes()));
                    }
                    links.push(bun_libarchive::DeferredSymlink::new(
                        rel.as_bytes(),
                        target.as_bytes(),
                    ));
                }
                // Tarball extraction makes none here either, so no pack made here has one.
                #[cfg(not(unix))]
                return Err(r.refuse(
                    "symlinks cannot be unpacked on this platform",
                    rel.as_bytes(),
                ));
            }
            _ => return Err(r.refuse("unknown kind of record", rel.as_bytes())),
        }
    }

    #[cfg(unix)]
    if bun_libarchive::create_deferred_symlinks(dir.fd(), &links, false) as usize != links.len() {
        return Err(r.refuse("symlink collides with another entry", name.as_bytes()));
    }
    // Windows requires the directory to be closed before it's renamed.
    drop(dir);
    if !directories::is_package_in_cache_at(staging, staged, tag) {
        return Err(r.refuse("package is incomplete", name.as_bytes()));
    }
    Ok(())
}

/// Returns false if something already exists at `to`. It's left alone.
#[cfg(not(windows))]
fn rename_no_replace(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> sys::Maybe<bool> {
    let result = match sys::renameat2(from_dir, from, to_dir, to, sys::RenameMode::NoReplace) {
        // This platform doesn't have the flag, but rename(2) itself never replaces a directory that
        // isn't empty.
        Err(err)
            if err.get_errno() == E::ENOSYS
                || err.get_errno() == E::EINVAL
                || err.get_errno() == E::ENOTSUP
                || err.get_errno() == E::EOPNOTSUPP =>
        {
            sys::renameat(from_dir, from, to_dir, to)
        }
        result => result,
    };
    match result {
        Ok(()) => Ok(true),
        Err(err) if matches!(err.get_errno(), E::EEXIST | E::ENOTEMPTY) => Ok(false),
        Err(err) => Err(err),
    }
}

/// Returns false if something already exists at `to`. It's left alone.
#[cfg(windows)]
fn rename_no_replace(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> sys::Maybe<bool> {
    let mut to_buf = bun_paths::w_path_buffer_pool::get();
    let to_w = bun_paths::strings::to_wpath_normalized(&mut to_buf, to.as_bytes());
    // A virus scanner or indexer may have the new files open. See `cache_publish::RenameRetry`.
    let mut retries: u32 = 0;
    loop {
        let dir = sys::open_dir_at_windows_a(
            from_dir,
            from.as_bytes(),
            sys::WindowsOpenDirOptions {
                can_rename_or_delete: true,
                iterable: false,
                ..Default::default()
            },
        )?;
        let result = sys::windows::move_opened_file_at(dir, to_dir, to_w, false);
        let _ = sys::close(dir);
        let Err(err) = result else {
            return Ok(true);
        };
        if sys::exists_at_type(to_dir, to).is_ok() {
            return Ok(false);
        }
        if retries == 4 || !matches!(err.get_errno(), E::EBUSY | E::EPERM | E::EACCES) {
            return Err(err);
        }
        retries += 1;
        std::thread::sleep(std::time::Duration::from_millis(10u64 << (retries - 1)));
    }
}

fn create_index_link(cache_dir: Fd, cache_dir_path: &[u8], entry: &ZStr) {
    let Some(name_len) = strings::index_of_char_pos(entry.as_bytes(), b'@', 1) else {
        return;
    };
    let mut target_buf = bun_paths::path_buffer_pool::get();
    crate::cache_publish::create_index_link(
        cache_dir,
        cache_dir_path,
        &entry.as_bytes()[..name_len],
        &entry.as_bytes()[name_len + 1..],
        bun_paths::resolve_path::join_abs_string_buf_z::<bun_paths::platform::Auto>(
            cache_dir_path,
            &mut target_buf[..],
            &[entry.as_bytes()],
        ),
    );
}

/// Restore the entries of the pack at `pack_path` that the cache does not have.
pub fn unpack(pm: &mut PackageManager, pack_path: &[u8]) -> Result<UnpackSummary, Error> {
    let mut r = Reader::open(pack_path)?;
    let cache_dir = pm.get_cache_directory();
    let staging = Staging::create(pm.get_temporary_directory().handle.fd())?;
    let mut summary = UnpackSummary::default();
    let mut staged: Vec<(ZBox, ResolutionTag)> = Vec::new();
    let mut staged_buf = [0u8; 21];
    let mut path: Vec<u8> = Vec::new();
    let mut previous: Vec<u8> = Vec::new();

    loop {
        let header = r.header(&mut path)?;
        let name = ZStr::from_slice_with_nul(&path);
        match header.kind {
            _ if header.mode != 0 => return Err(r.refuse("malformed record", name.as_bytes())),
            KIND_PACKAGE => {}
            KIND_END if name.is_empty() && r.pos == r.len => break,
            KIND_END => return Err(r.refuse("trailing bytes after pack", b"")),
            _ => return Err(r.refuse("record outside of a package", name.as_bytes())),
        }
        let Some(tag) = entry_tag(name.as_bytes()) else {
            return Err(r.refuse("invalid cache entry name", name.as_bytes()));
        };
        if name.as_bytes() <= previous.as_slice() {
            return Err(r.refuse("packages out of order", name.as_bytes()));
        }
        previous.clear();
        previous.extend_from_slice(name.as_bytes());
        summary.packages += 1;

        if directories::is_package_in_cache_at(cache_dir, name, tag) {
            summary.already_cached += 1;
            r.skip(header.size);
        } else {
            unpack_package(
                &mut r,
                staging.fd(),
                staged_name(&mut staged_buf, staged.len()),
                name,
                tag,
                header.size,
                &mut summary,
            )?;
            staged.push((ZBox::from_bytes(name.as_bytes()), tag));
        }
    }

    // The whole pack is verified by now and the cache is untouched. Dropping `staging` deletes it.
    if pm.options.dry_run {
        summary.created = staged.len() as u32;
        return Ok(summary);
    }

    let mut cache_dir_path_buf = bun_paths::path_buffer_pool::get();
    let cache_dir_path: &[u8] = sys::get_fd_path(cache_dir, &mut cache_dir_path_buf)?;

    for (n, (name, tag)) in staged.iter().enumerate() {
        let from = staged_name(&mut staged_buf, n);
        let created = match rename_no_replace(staging.fd(), from, cache_dir, name) {
            Err(err) if err.get_errno() == E::ENOENT => {
                let scope_len = strings::index_of_char_usize(name.as_bytes(), b'/').ok_or(err)?;
                Dir::borrow(&cache_dir).make_path(&name.as_bytes()[..scope_len])?;
                rename_no_replace(staging.fd(), from, cache_dir, name)
            }
            result => result,
        }?;
        if !created {
            // Only checked now, so that an entry another process published in the meantime is
            // found, and is complete.
            if directories::is_package_in_cache_at(cache_dir, name, *tag) {
                summary.already_cached += 1;
            } else {
                summary.incomplete += 1;
            }
            continue;
        }
        summary.created += 1;
        if *tag == ResolutionTag::Npm {
            create_index_link(cache_dir, cache_dir_path, name);
        }
    }
    Ok(summary)
}

// ───────────────────────────────── command ───────────────────────────────────

fn plural(n: u64) -> &'static str {
    if n == 1 { "" } else { "s" }
}

/// `positionals` is `["cache", "pack" | "unpack", ...]`. For `pack`, the lockfile is already
/// loaded.
pub fn exec(pm: &mut PackageManager, original_cwd: &[u8]) -> ! {
    let verb = bstr::BStr::new(pm.options.positionals[1]);
    let is_pack = pm.options.positionals[1] == b"pack";
    let file: &[u8] = match pm.options.positionals[2..] {
        [file] if !file.is_empty() => file,
        _ => {
            bun_core::pretty_errorln!(
                "<r><red>error<r><d>:<r> expected exactly one \\<file\\>\n<d>usage:<r> bun pm cache {} \\<file\\>",
                verb,
            );
            Global::exit(1);
        }
    };
    // `PackageManager::init` has changed directory since it was typed.
    let mut abs_buf = bun_paths::path_buffer_pool::get();
    let Some(abs_file) = bun_paths::resolve_path::join_abs_string_buf_checked::<
        bun_paths::platform::Auto,
    >(original_cwd, &mut abs_buf[..], &[file]) else {
        bun_core::pretty_errorln!("<r><red>error<r><d>:<r> \\<file\\> is too long");
        Global::exit(1);
    };

    let quiet = pm.options.log_level == LogLevel::Silent;
    let dry_run = pm.options.dry_run;
    let timer = bun_core::time::Timer::start();
    let result = if is_pack {
        pack(pm, abs_file).map(|summary| {
            if !quiet {
                bun_core::prettyln!(
                    "<green>{}<r> {} package{} ({} file{}, {}) into <b>{}<r> <d>[{}]<r>",
                    if dry_run { "Would pack" } else { "Packed" },
                    summary.packages,
                    plural(summary.packages.into()),
                    summary.files,
                    plural(summary.files),
                    bun_fmt::size(summary.bytes as usize, Default::default()),
                    bun_fmt::escape_control_chars(file),
                    bun_fmt::fmt_duration_one_decimal(timer.read()),
                );
            }
            if summary.missing > 0 {
                bun_core::pretty_errorln!(
                    "<r><yellow>warn<r>: skipping {} package{} not in cache (run <b>bun install<r> first)",
                    summary.missing,
                    plural(summary.missing.into()),
                );
            }
        })
    } else {
        unpack(pm, abs_file).map(|summary| {
            if !quiet {
                bun_core::prettyln!(
                    "<green>{}<r> {} package{} ({} new, {} already cached, {}) <d>[{}]<r>",
                    if dry_run { "Would unpack" } else { "Unpacked" },
                    summary.packages,
                    plural(summary.packages.into()),
                    summary.created,
                    summary.already_cached,
                    bun_fmt::size(summary.bytes as usize, Default::default()),
                    bun_fmt::fmt_duration_one_decimal(timer.read()),
                );
            }
            if summary.incomplete > 0 {
                bun_core::pretty_errorln!(
                    "<r><yellow>warn<r>: ignoring {} incomplete cache entr{}, <b>bun install<r> will re-download {}",
                    summary.incomplete,
                    if summary.incomplete == 1 { "y" } else { "ies" },
                    if summary.incomplete == 1 { "it" } else { "them" },
                );
            }
        })
    };
    if let Err(err) = result {
        bun_core::pretty_errorln!(
            "<r><red>error<r><d>:<r> bun pm cache {} failed: {}",
            verb,
            err,
        );
        Global::exit(1);
    }
    Output::flush();
    Global::exit(0);
}

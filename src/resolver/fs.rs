use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, Ordering};
use std::borrow::Cow;
use std::io::Write as _;
use std::sync::OnceLock;

use bun_alloc::{AllocError, BSSList, BSSStringList};
use bun_core::AtomicFd;
use bun_core::Generation;
use bun_core::MutableString;
use bun_core::Once;
use bun_core::vec::{BorrowedBuf, append_with};
use bun_paths::MAX_PATH_BYTES;
use bun_paths::strings;
use bun_ptr::Interned;
use bun_sys::{self, Fd};
use bun_threading::{Guarded, Mutex};

use crate::fs::RealFS;

// scope tag renamed `fs` → `Fs` so it doesn't collide with `fs:` fn
// params (the `declare_scope!` macro emits a `static` with the tag name, and
// edition-2024 forbids fn params shadowing statics).
bun_core::define_scoped_log!(debug, Fs, hidden);

// `bun.strings.BOM` — BOM detection + UTF-16-LE-to-UTF-8 re-encoding
// (simdutf-backed). The canonical implementation lives in
// `bun_core::strings`; `bun_resolver::fs_full::BOM` re-exports it.
pub use bun_core::strings::BOM;

mod preallocate {
    pub(crate) mod counts {
        pub(crate) const FILES: usize = 4096;
    }
}

const ENTRY_OVERFLOW_COUNT: usize = 256;

static FILENAME_STORE: Once<BSSStringList> = Once::new();
static ENTRY_STORE: Once<Guarded<BSSList<Entry, ENTRY_OVERFLOW_COUNT>>> = Once::new();

#[inline]
pub(crate) fn filename_store() -> &'static BSSStringList {
    FILENAME_STORE.get_or_init(|| BSSStringList::new(preallocate::counts::FILES * 2 * (64 + 1)))
}

fn entry_store() -> &'static Guarded<BSSList<Entry, ENTRY_OVERFLOW_COUNT>> {
    ENTRY_STORE.get_or_init(|| {
        Guarded::new(BSSList::new(
            preallocate::counts::FILES * 2 + ENTRY_OVERFLOW_COUNT,
        ))
    })
}

/// Holds the store, so that its `Once` is read per `readdir` and not per entry.
pub struct FilenameStoreAppender(&'static BSSStringList);
impl FilenameStoreAppender {
    #[inline]
    pub(crate) fn new() -> Self {
        Self(filename_store())
    }
}
impl strings::Appender for FilenameStoreAppender {
    #[inline]
    fn append(&mut self, s: &[u8]) -> core::result::Result<&'static [u8], AllocError> {
        self.0.append(s)
    }
}

// dirname_store/filename_store are &'static singletons —
// nothing owned to free, so no `impl Drop`.

// ══════════════════════════════════════════════════════════════════════════
// CANONICAL Entry / DirEntry family.
//
// This is the SINGLE definition. The inline `pub mod fs { … }` block in
// `lib.rs` re-exports these via `pub use crate::fs_full::{…}` and deletes its
// own copies.
// ══════════════════════════════════════════════════════════════════════════

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::FromRepr)]
pub enum EntryKind {
    Dir,
    File,
    /// A symlink whose target doesn't exist. It's treated like a missing entry, which is how
    /// `stat()` reports it.
    Dangling,
}

/// What a stat found out about an [`Entry`].
pub(crate) struct EntryStat<'a> {
    pub(crate) symlink: &'a [u8],
    pub(crate) fd: Fd,
    pub(crate) kind: EntryKind,
}

/// Null, or the address in a string store of a `u32` length and then the bytes of a path.
#[derive(Default)]
struct AtomicPath(AtomicPtr<u8>);

impl AtomicPath {
    #[inline]
    fn load(&self) -> &'static [u8] {
        let ptr = self.0.load(Ordering::Acquire);
        if ptr.is_null() {
            return b"";
        }
        // SAFETY: `intern` is the only writer. It publishes, with Release, the start of a slice that
        // holds `len` and then `len` bytes, and that is never freed or written again.
        unsafe {
            let len = ptr.cast::<u32>().read_unaligned();
            core::slice::from_raw_parts(ptr.add(size_of::<u32>()), len as usize)
        }
    }

    /// Returns the stored copy of `path`. The current one is kept if it is equal.
    fn intern(&self, store: &BSSStringList, path: &[u8]) -> Result<&'static [u8], AllocError> {
        let current = self.load();
        if path == current {
            return Ok(current);
        }
        if path.is_empty() {
            self.0.store(core::ptr::null_mut(), Ordering::Release);
            return Ok(b"");
        }
        let len = u32::try_from(path.len()).map_err(|_| AllocError)?;
        let stored = store.append_parts(&[&len.to_ne_bytes(), path])?;
        self.0.store(stored.as_ptr().cast_mut(), Ordering::Release);
        Ok(&stored[size_of::<u32>()..])
    }
}

pub struct Entry {
    symlink: AtomicPath,
    // Relaxed: `fd` and `kind` publish no other memory, and `need_stat` orders them after a stat.
    fd: AtomicFd,
    kind: AtomicU8,
    pub dir: &'static [u8],

    pub base_: strings::StringOrTinyString,

    // Necessary because the hash table uses it as a key
    pub(crate) base_lowercase_: strings::StringOrTinyString,

    /// Held by writers, so that a stat in progress cannot overwrite a newer value.
    mutex: Mutex,
    need_stat: AtomicBool,

    abs_path: OnceLock<Interned>,
}

impl Entry {
    #[inline]
    pub fn cached_fd(&self) -> Fd {
        Fd(self.fd.load(Ordering::Relaxed))
    }

    pub(crate) fn set_cached_fd(&self, fd: Fd) {
        let _guard = self.mutex.lock_guard();
        self.fd.store(fd.0, Ordering::Relaxed);
    }

    pub(crate) fn take_cached_fd(&self) -> Fd {
        let _guard = self.mutex.lock_guard();
        Fd(self.fd.swap(Fd::INVALID.0, Ordering::Relaxed))
    }

    #[inline]
    pub(crate) fn cached_symlink(&self) -> &'static [u8] {
        self.symlink.load()
    }

    /// Returns the stored copy of `symlink`.
    pub(crate) fn intern_symlink(
        &self,
        store: &BSSStringList,
        symlink: &[u8],
    ) -> Result<&'static [u8], AllocError> {
        let _guard = self.mutex.lock_guard();
        self.symlink.intern(store, symlink)
    }

    #[inline]
    fn cached_kind(&self) -> EntryKind {
        EntryKind::from_repr(self.kind.load(Ordering::Relaxed)).unwrap_or(EntryKind::Dangling)
    }

    /// Forgets the fd without closing it, and makes the next `kind` or `symlink` stat again.
    pub fn bust_cache(&self) {
        let _guard = self.mutex.lock_guard();
        self.fd.store(Fd::INVALID.0, Ordering::Relaxed);
        self.need_stat.store(true, Ordering::Release);
    }

    #[inline]
    pub fn base(&self) -> &[u8] {
        self.base_.slice()
    }

    #[inline]
    pub fn base_lowercase(&self) -> &[u8] {
        self.base_lowercase_.slice()
    }

    /// Interned in DirnameStore.
    #[inline]
    pub fn dir(&self) -> &'static [u8] {
        self.dir
    }

    /// Returns `Interned::EMPTY` until a fill has been published. Lock-free.
    #[inline]
    pub fn abs_path(&self) -> Interned {
        self.abs_path.get().copied().unwrap_or(Interned::EMPTY)
    }

    /// Returns `abs_path`, calling `fill` under `mutex` to compute it the first time.
    /// Nothing else writes `abs_path`, and a failed `fill` doesn't publish anything.
    pub fn abs_path_or_try_fill<E>(
        &self,
        fill: impl FnOnce() -> Result<Interned, E>,
    ) -> Result<Interned, E> {
        if let Some(p) = self.abs_path.get() {
            return Ok(*p);
        }
        let _guard = self.mutex.lock_guard();
        if let Some(p) = self.abs_path.get() {
            return Ok(*p);
        }
        let p = fill()?;
        Ok(*self.abs_path.get_or_init(|| p))
    }

    pub fn abs_path_or_fill(&self, fill: impl FnOnce() -> Interned) -> Interned {
        let Ok(p) = self.abs_path_or_try_fill(|| Ok::<_, core::convert::Infallible>(fill()));
        p
    }

    /// Stat-on-first-use.
    pub fn kind(&self, fs: &RealFS, store_fd: bool) -> EntryKind {
        if self.need_stat.load(Ordering::Acquire) {
            // This is technically incorrect, but we are choosing not to handle errors here
            let _ = self.stat(fs, store_fd);
        }
        self.cached_kind()
    }

    /// See [`Entry::kind`].
    pub(crate) fn symlink(&self, fs: &RealFS, store_fd: bool) -> &'static [u8] {
        // The file can be deleted between the scan of the directory and the stat.
        if self.need_stat.load(Ordering::Acquire) && self.stat(fs, store_fd).is_err() {
            return b"";
        }
        self.cached_symlink()
    }

    fn stat(&self, fs: &RealFS, store_fd: bool) -> crate::CrateResult<()> {
        let _guard = self.mutex.lock_guard();
        // Relaxed: every write happens under `mutex`, which we hold.
        if !self.need_stat.load(Ordering::Relaxed) {
            return Ok(());
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let result = fs
            .kind(self.dir, self.base(), self.cached_fd(), store_fd, &mut buf)
            .and_then(|stat| {
                self.symlink.intern(filename_store(), stat.symlink)?;
                self.fd.store(stat.fd.0, Ordering::Relaxed);
                self.kind.store(stat.kind as u8, Ordering::Relaxed);
                Ok(())
            });
        self.need_stat.store(false, Ordering::Release);
        result
    }
}

pub(crate) mod dir_entry {
    /// Lowercased-basename → entry map backing `DirEntry::data`.
    pub(crate) type EntryMap = bun_collections::StringHashMap<&'static super::Entry>;
}

/// Per-entry hook invoked by `readdir`, with `RealFS::entries` locked.
pub trait DirEntryIterator {
    fn next(&mut self, entry: &Entry);
}

impl DirEntryIterator for () {
    fn next(&mut self, _entry: &Entry) {}
}

pub struct DirEntry {
    // `dir` is interned in
    // DirnameStore (a process-lifetime BSSList), so `&'static` is correct.
    pub(crate) dir: &'static [u8],
    pub fd: Fd,
    pub(crate) generation: Generation,
    pub data: dir_entry::EntryMap,
}

impl DirEntry {
    pub(crate) fn init(dir: &'static [u8], generation: Generation) -> DirEntry {
        DirEntry {
            dir,
            data: dir_entry::EntryMap::default(),
            generation,
            fd: Fd::INVALID,
        }
    }

    // Compatibility wrapper for callers outside the `readdir` hot loop —
    // resolves the `FilenameStore` singleton on demand. Hot-loop callers
    // should hoist `FilenameStoreAppender::new()` once and call
    // `add_entry_with_store` directly.

    /// Returns the stored entry, or `None` for a kind that is not kept (a device, a socket, ...).
    pub(crate) fn add_entry_with_store(
        &mut self,
        prev_map: Option<&dir_entry::EntryMap>,
        entry: &bun_sys::dir_iterator::IteratorResult<'_>,
        filename_store: &mut FilenameStoreAppender,
    ) -> crate::CrateResult<Option<&Entry>> {
        use bun_sys::FileKind as DK;
        let name_slice = entry.name.slice_u8();
        let found_kind: Option<EntryKind> = match entry.kind {
            DK::Directory => Some(EntryKind::Dir),
            DK::File => Some(EntryKind::File),

            // For a symlink, we will need to stat the target later
            DK::SymLink
            // Some filesystems return `.unknown` from getdents() no matter the actual kind of the file
            // (often because it would be slow to look up the kind). If we get this, then code that
            // needs the kind will have to find it out later by calling stat().
            | DK::Unknown => None,

            DK::BlockDevice
            | DK::CharacterDevice
            | DK::NamedPipe
            | DK::UnixDomainSocket
            | DK::Whiteout
            | DK::Door
            | DK::EventPort => return Ok(None),
        };

        // Lowercase the entry basename once. The same bytes drive the
        // previous-generation case-insensitive probe, the new entry's
        // lowercased key, *and* the insert into `self.data` — and the hash is
        // computed once here (`name_hash`) rather than re-derived by the probe
        // and again by the insert. A stack scratch covers the common short
        // case (matches `DirEntry::get`); only a basename longer than
        // `MAX_PATH_BYTES` — which `getdents`/`FindNextFile` can't produce —
        // would touch the heap.
        let mut name_lc_buf = bun_paths::path_buffer_pool::get();
        let name_lc_heap: Option<bun_collections::StringHashMapContext::PrehashedCaseInsensitive> =
            if name_slice.len() <= MAX_PATH_BYTES {
                None
            } else {
                Some(
                    bun_collections::StringHashMapContext::PrehashedCaseInsensitive::init(
                        name_slice,
                    ),
                )
            };
        let name_lc: &[u8] = match &name_lc_heap {
            Some(p) => &p.input[..],
            None => strings::copy_lowercase_if_needed(name_slice, &mut name_lc_buf[..]),
        };
        let name_hash = self.data.hash_key(name_lc);

        let stored: &'static Entry = 'brk: {
            if let Some(map) = prev_map {
                // `data` keys are the lowercased basenames, so an exact match on
                // `name_lc` is the case-insensitive match — and reuses
                // `name_hash` instead of re-hashing.
                if let Some(&existing) = map.get_hashed(name_hash, name_lc) {
                    let _guard = existing.mutex.lock_guard();
                    // `dir` stays: `self` has the `dir` of the `DirEntry` that owns `map`.

                    // Relaxed load: writes are serialized on the per-entry
                    // mutex held above.
                    existing.need_stat.store(
                        existing.need_stat.load(Ordering::Relaxed)
                            || found_kind.is_none()
                            || Some(existing.cached_kind()) != found_kind,
                        Ordering::Release,
                    );
                    break 'brk existing;
                }
            }

            let base_ =
                strings::StringOrTinyString::init_append_if_needed(name_slice, filename_store)?;
            // `copy_lowercase_if_needed` returns its input when there is nothing to lowercase.
            let base_lowercase_ = if core::ptr::eq(name_lc.as_ptr(), name_slice.as_ptr()) {
                base_
            } else {
                strings::StringOrTinyString::init_append_if_needed(name_lc, filename_store)?
            };
            let slot = entry_store().lock().append_uninit();
            slot.write(Entry {
                symlink: AtomicPath::default(),
                fd: AtomicFd::new(Fd::INVALID.0),
                // Arbitrary while `need_stat` is set.
                kind: AtomicU8::new(found_kind.unwrap_or(EntryKind::File) as u8),
                dir: self.dir,
                base_,
                base_lowercase_,
                mutex: Mutex::new(),
                // Lazy: a `stat` per entry was slow for packages with thousands of files in a folder.
                need_stat: AtomicBool::new(found_kind.is_none()),
                abs_path: OnceLock::new(),
            })
        };

        let key = stored.base_lowercase();
        // `key` equals `name_lc` byte-for-byte (a fresh entry interned `name_lc`; a recycled one
        // matched it exactly above), so `name_hash` is its hash too — insert without re-hashing.
        self.data.put_static_key_hashed(name_hash, key, stored)?;

        Ok(Some(stored))
    }

    // `query_` borrow is detached from the returned `Entry` lifetime so callers
    // can pass a slice into the same buffer they then mutate. The
    // lookup key is the lowercased basename; a case-mismatched query still
    // returns the stored entry.
    pub(crate) fn get(&self, query_: &[u8]) -> Option<&'static Entry> {
        if query_.is_empty() || query_.len() > MAX_PATH_BYTES {
            return None;
        }
        let mut scratch_lookup_buffer = bun_paths::path_buffer_pool::get();

        let query = strings::copy_lowercase_if_needed(query_, &mut scratch_lookup_buffer[..]);
        self.data.get(query).copied()
    }

    /// Looks up a cached entry by name. Takes a `&'static [u8]` that is
    /// already lowercase, so no per-call lowercasing buffer is needed.
    pub(crate) fn get_comptime_query(&self, query_lower: &'static [u8]) -> Option<&'static Entry> {
        self.data.get(query_lower).copied()
    }

    /// True if a cached entry exists for the given already-lowercase name.
    pub fn has_comptime_query(&self, query_lower: &'static [u8]) -> bool {
        self.data.contains_key(query_lower)
    }
}

// `data` drops itself and `dir` is interned in DirnameStore (see the comment
// on `DirEntry::dir`). Body would be empty, so no `impl Drop`.

#[derive(Default, Clone, Copy)]
pub struct ModKey {
    pub(crate) size: u64,
    pub(crate) mtime: i128,
}

impl ModKey {
    /// Writes `basename` + `-` + the hex hash into `out` and returns the
    /// written prefix.
    pub fn hash_name<'out>(
        &self,
        basename: &[u8],
        out: &'out mut [u8],
    ) -> crate::CrateResult<&'out [u8]> {
        let hex_int = self.hash();

        let len = out.len();
        let mut cursor = &mut out[..];
        // `BStr`'s `Display` would
        // lossily emit U+FFFD for non-UTF-8 bytes (and 1→3 expand), so write
        // the basename verbatim via raw `io::Write`.
        cursor
            .write_all(basename)
            .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
        cursor
            .write_all(b"-")
            .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
        write!(&mut cursor, "{:x}", hex_int)
            .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
        let written = len - cursor.len();
        Ok(&out[..written])
    }

    pub(crate) fn hash(&self) -> u64 {
        let mut hash_bytes = [0u8; 32];
        // We shouldn't just read the contents of the ModKey into memory
        // The hash should be deterministic across computers and operating systems.
        // inode is non-deterministic across volumes within the same compuiter
        // so if we're not going to do a full content hash, we should use mtime and size.
        // even mtime is debatable.
        hash_bytes[0..8].copy_from_slice(&self.size.to_le_bytes());
        hash_bytes[8..24].copy_from_slice(&self.mtime.to_le_bytes());
        debug_assert!(hash_bytes[24..].len() == 8);
        hash_bytes[24..32].copy_from_slice(&0u64.to_ne_bytes());
        bun_wyhash::hash(&hash_bytes)
    }
}

// ══════════════════════════════════════════════════════════════════════════
// CANONICAL: read-file-with-handle (stat → grow → read loop → BOM-strip)
//
// One body, two entry points:
//   • `read_file_with_handle_impl`  — free fn, const-generic, returns
//     `PathContentsPair`. No `&mut RealFS` needed: the only
//     `self` uses are `setMaxFd` (a static) and
//     `readFileError` (a no-op in release).
//   • `read_file_contents` — runtime-bool → const-generic dispatcher for the
//     two `cache::Fs` callers (resolver/lib.rs + bundler/cache.rs), which take
//     `use_shared_buffer`/`stream` at runtime and want only the bytes.
// ══════════════════════════════════════════════════════════════════════════

/// Runtime-bool → const-generic dispatcher for `cache::Fs::read_file{,_shared}`.
/// Returns just the contents (`Cow::Borrowed` ⇢ shared-buffer arm,
/// `Cow::Owned` ⇢ heap arm); callers `.map(Contents::from)` to tag provenance.
pub fn read_file_contents<'buf>(
    file: &bun_sys::File,
    use_shared_buffer: bool,
    shared: &'buf mut MutableString,
    stream: bool,
) -> crate::CrateResult<Cow<'buf, [u8]>> {
    match (use_shared_buffer, stream) {
        (true, true) => read_file_with_handle_impl::<true, true>(None, file, shared),
        (true, false) => read_file_with_handle_impl::<true, false>(None, file, shared),
        (false, true) => read_file_with_handle_impl::<false, true>(None, file, shared),
        (false, false) => read_file_with_handle_impl::<false, false>(None, file, shared),
    }
    .map(|p| p.contents)
}

/// Arena-backed twin of the `USE_SHARED_BUFFER = false` arm of
/// [`read_file_with_handle_impl`]: the returned bytes live
/// in `arena` so they are bulk-freed when the per-call `MimallocArena` is
/// `mi_heap_destroy`'d (`TranspilerJob::run` / `ParseTask`), instead of
/// round-tripping through the worker thread's *default* mimalloc heap (which
/// is never destroyed and retains the segment for the process lifetime).
///
/// A sentinel NUL is written after the last byte.
pub fn read_file_contents_in_arena<'a>(
    file: &bun_sys::File,
    arena: &'a bun_alloc::Arena,
    byte_order_mark: ByteOrderMark,
) -> crate::CrateResult<&'a [u8]> {
    crate::fs::FileSystem::set_max_fd(file.handle().native());

    let mut initial_buf = [const { MaybeUninit::uninit() }; 16384];
    let mut initial_buf = BorrowedBuf::from(&mut initial_buf[..]);

    // Optimization: don't call stat() unless the file is big enough that we
    // need to dynamically allocate memory to read it.
    let initial_len = file.read_all_buf(initial_buf.unfilled())?;
    let cap = if initial_len + 1 < initial_buf.capacity() {
        initial_len
    } else {
        let size = file.get_end_pos()?;
        debug!("stat({}) = {}", file.handle(), size);
        if size == 0 {
            return Ok(b"");
        }
        // A hot reload can write the file between `stat` and `read`. What it grew by is cut off.
        size.max(initial_len)
    };

    let slot = (arena.try_alloc_uninit_slice::<u8>(cap + 1)).ok_or_else(bun_sys::Error::oom)?;
    slot[cap].write(0);
    let mut buf = BorrowedBuf::from(&mut slot[..cap]);
    buf.unfilled().append(initial_buf.filled());
    file.read_all_buf(buf.unfilled())?;
    let mut total = buf.len();
    debug!("read({}, {}) = {}", file.handle(), cap, total);
    if total < cap {
        buf.unfilled().append(&[0]);
    }

    let contents = buf.into_filled_mut();
    let is_converted = byte_order_mark == ByteOrderMark::Converted;
    if let Some(bom) = BOM::detect(&contents[..total]).filter(|_| is_converted) {
        debug!("Convert {} BOM", bom.tag_name());
        match bom {
            BOM::Utf8 => {
                let n = BOM::UTF8_BYTES.len();
                contents.copy_within(n..total, 0);
                total -= n;
                contents[total] = 0;
            }
            other => {
                // Rare path (UTF-16 source on the concurrent transpiler) —
                // re-encode via the global-heap helper, then copy into the
                // arena so the *retained* bytes still land there.
                let converted =
                    other.remove_and_convert_to_utf8_and_free(contents[..total].to_vec());
                let dst = arena.alloc_slice_fill_copy::<u8>(converted.len() + 1, 0);
                dst[..converted.len()].copy_from_slice(&converted);
                return Ok(&dst[..converted.len()]);
            }
        }
    }
    Ok(&contents[..total])
}

/// What becomes of a byte order mark at the start of a file that is read.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ByteOrderMark {
    /// The bytes are handed on as they are on disk.
    Kept,
    /// The mark goes, and UTF-16 becomes UTF-8.
    Converted,
}

pub fn read_file_with_handle_impl<'buf, const USE_SHARED_BUFFER: bool, const STREAM: bool>(
    size_hint: Option<usize>,
    file: &bun_sys::File,
    shared_buffer: &'buf mut MutableString,
) -> crate::CrateResult<PathContentsPair<'buf>> {
    // allocator param dropped (global mimalloc)
    crate::fs::FileSystem::set_max_fd(file.handle().native());

    // When we're serving a JavaScript-like file over HTTP, we do not want to cache the contents in memory
    // This imposes a performance hit because not reading from disk is faster than reading from disk
    // Part of that hit is allocating a temporary buffer to store the file contents in
    // As a mitigation, we can just keep one buffer forever and re-use it for the parsed files
    if USE_SHARED_BUFFER {
        shared_buffer.reset();

        // Skip the extra file.stat() call when possible
        let mut size = match size_hint {
            Some(s) => s,
            None => file.get_end_pos()?,
        };
        debug!("stat({}) = {}", file.handle(), size);

        // Skip the read call for empty files
        // Otherwise will get out of bounds errors
        // plus it's an unnecessary syscall
        if size == 0 {
            if USE_SHARED_BUFFER {
                shared_buffer.reset();
                return Ok(PathContentsPair {
                    contents: Cow::Borrowed(b""),
                });
            } else {
                return Ok(PathContentsPair {
                    contents: Cow::Borrowed(b""),
                });
            }
        }

        shared_buffer.grow_by(size + 1)?;

        // if you press save on a large file we might not read all the
        // bytes in the first few read() calls. we only handle this on
        // stream because we assume that this only realistically happens
        // during HMR
        loop {
            let read_count = append_with(&mut shared_buffer.list, usize::MAX, |spare| {
                file.read_all_buf(spare)
            })?;
            debug!("read({}, {}) = {}", file.handle(), size, read_count);

            if STREAM {
                // check again that stat() didn't change the file size
                // another reason to only do this when stream
                let new_size = file.get_end_pos()?;

                // don't infinite loop is we're still not reading more
                if read_count == 0 {
                    break;
                }

                if shared_buffer.list.len() < new_size {
                    shared_buffer.grow_by(new_size.saturating_sub(size))?;
                    size = new_size;
                    continue;
                }
            }
            break;
        }

        if let Some(slot) = shared_buffer.list.spare_capacity_mut().first_mut() {
            slot.write(0);
        }

        let contents = match BOM::detect(&shared_buffer.list) {
            Some(bom) => {
                debug!("Convert {} BOM", bom.tag_name());
                bom.remove_and_convert_to_utf8_without_dealloc(&mut shared_buffer.list)
            }
            None => &shared_buffer.list,
        };
        Ok(PathContentsPair {
            contents: Cow::Borrowed(contents),
        })
    } else {
        let mut initial_buf = [const { MaybeUninit::uninit() }; 16384];
        let mut initial_buf = BorrowedBuf::from(&mut initial_buf[..]);

        // Optimization: don't call stat() unless the file is big enough
        // that we need to dynamically allocate memory to read it.
        if size_hint.is_none() {
            let read_count = file.read_all_buf(initial_buf.unfilled())?;
            if read_count + 1 < initial_buf.capacity() {
                // Own the buffer; the returned `Cow::Owned` frees it on the
                // caller's drop. The trailing
                // NUL sentinel is not part of `contents`.
                // Allocate exact (no zero-fill): `extend_from_slice` + `push`
                // initialize all `read_count + 1` bytes, then `truncate` drops
                // the sentinel from the logical length.
                let mut allocation: Vec<u8> = Vec::with_capacity(read_count + 1);
                allocation.extend_from_slice(initial_buf.filled());
                allocation.push(0);
                allocation.truncate(read_count);

                if let Some(bom) = BOM::detect(&allocation) {
                    debug!("Convert {} BOM", bom.tag_name());
                    allocation = bom.remove_and_convert_to_utf8_and_free(allocation);
                }

                return Ok(PathContentsPair {
                    contents: Cow::Owned(allocation),
                });
            }
        }
        let initial_read = initial_buf.filled();

        // Skip the extra file.stat() call when possible
        let size = match size_hint {
            Some(s) => s,
            None => file.get_end_pos()?,
        };
        debug!("stat({}) = {}", file.handle(), size);

        let cap = size.max(initial_read.len());
        let mut buf: Vec<u8> = Vec::with_capacity(cap + 1);
        buf.extend_from_slice(initial_read);

        if size == 0 {
            return Ok(PathContentsPair {
                contents: Cow::Borrowed(b""),
            });
        }

        let tail_len = cap + 1 - initial_read.len();
        // stick a zero at the end
        buf.spare_capacity_mut()[tail_len - 1].write(0);
        let read_count = append_with(&mut buf, tail_len, |tail| file.read_all_buf(tail))?;
        debug!("read({}, {}) = {}", file.handle(), size, read_count);

        if let Some(bom) = BOM::detect(&buf) {
            debug!("Convert {} BOM", bom.tag_name());
            buf = bom.remove_and_convert_to_utf8_and_free(buf);
        }

        Ok(PathContentsPair {
            contents: Cow::Owned(buf),
        })
    }
}
// ──────────────────────────────────────────────────────────────────────────

pub struct PathContentsPair<'buf> {
    /// `Owned` for the heap-allocated branch (caller frees on drop); `Borrowed`
    /// for the shared-buffer branch (points into the caller's `MutableString`,
    /// tied to `'buf`).
    pub(crate) contents: Cow<'buf, [u8]>,
}

// `Path` / `PathName` — re-exported from the canonical `bun_paths::fs` via
// `crate::fs` (D090). This module (`fs_full`) is private + link-dead until
// re-exported wholesale; the local impl bodies (`dupe_alloc` full
// short-circuiting, `non_unique_name_string`, `json_stringify`, etc.) were
// never reachable and are dropped — `crate::fs::PathResolverExt` carries the
// live resolver-tier methods.

#[path = "fs/stat_hash.rs"]
pub mod stat_hash;

#[cfg(test)]
mod tests {
    use super::*;

    const ROUNDS: usize = if cfg!(miri) { 30 } else { 30_000 };

    fn entry(dir: &'static [u8]) -> Entry {
        let store = &mut FilenameStoreAppender::new();
        let mut base = || strings::StringOrTinyString::init_append_if_needed(b"link", store);
        Entry {
            symlink: AtomicPath::default(),
            fd: AtomicFd::new(Fd::INVALID.0),
            kind: AtomicU8::new(EntryKind::File as u8),
            dir,
            base_: base().unwrap(),
            base_lowercase_: base().unwrap(),
            mutex: Mutex::default(),
            need_stat: AtomicBool::new(false),
            abs_path: OnceLock::new(),
        }
    }

    /// Calls `read` on two other threads until `write` has returned.
    fn read_during(read: impl Fn() + Sync, write: impl FnOnce()) {
        let done = AtomicBool::new(false);
        std::thread::scope(|scope| {
            for _ in 0..2 {
                scope.spawn(|| {
                    while !done.load(Ordering::Relaxed) {
                        read();
                    }
                });
            }
            scopeguard::defer! { done.store(true, Ordering::Relaxed) }
            write();
        });
    }

    #[test]
    fn symlink_is_empty_or_whole_while_it_is_filled() {
        let entries: Vec<Entry> = (0..ROUNDS).map(|_| entry(b"/")).collect();
        std::thread::scope(|scope| {
            scope.spawn(|| {
                for entry in &entries {
                    let path = loop {
                        match entry.cached_symlink() {
                            b"" => core::hint::spin_loop(),
                            path => break path,
                        }
                    };
                    assert_eq!(path, b"/real/link");
                }
            });
            for entry in &entries {
                (entry.intern_symlink(filename_store(), b"/real/link")).unwrap();
            }
        });
    }

    #[test]
    fn symlink_is_whole_while_it_is_replaced() {
        let paths: [&[u8]; 3] = [b"/a", b"", b"/a/longer/path"];
        let entry = entry(b"/");
        read_during(
            || assert!(paths.contains(&entry.cached_symlink())),
            || {
                for path in paths.into_iter().cycle().take(ROUNDS) {
                    assert_eq!(entry.intern_symlink(filename_store(), path), Ok(path));
                }
            },
        );
    }

    #[test]
    fn unchanged_symlink_is_not_interned_again() {
        let entry = entry(b"/");
        let first = entry.intern_symlink(filename_store(), b"/a").unwrap();
        let second = entry.intern_symlink(filename_store(), b"/a").unwrap();
        assert!(core::ptr::eq(first, second));
    }

    #[test]
    #[cfg(all(unix, not(miri)))]
    fn symlink_is_whole_while_a_stat_replaces_it() {
        use std::os::unix::ffi::OsStrExt as _;

        let dir = std::env::temp_dir().join(format!("bun-entry-stat-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        scopeguard::defer! { let _ = std::fs::remove_dir_all(&dir); }
        let real_dir = dir.canonicalize().unwrap();
        let targets = [real_dir.join("a"), real_dir.join("a-longer-name")];
        for target in &targets {
            std::fs::write(target, b"").unwrap();
        }
        let fs = &crate::fs::FileSystem::init(None).unwrap().fs;
        let entry = entry(real_dir.as_os_str().as_bytes().to_vec().leak());
        let paths: [&[u8]; 3] = [
            targets[0].as_os_str().as_bytes(),
            b"",
            targets[1].as_os_str().as_bytes(),
        ];
        read_during(
            || assert!(paths.contains(&entry.symlink(fs, false))),
            || {
                for path in paths.into_iter().cycle().take(600) {
                    match path {
                        b"" => std::fs::write(dir.join("next"), b""),
                        _ => std::os::unix::fs::symlink(
                            std::ffi::OsStr::from_bytes(path),
                            dir.join("next"),
                        ),
                    }
                    .unwrap();
                    std::fs::rename(dir.join("next"), dir.join("link")).unwrap();
                    entry.bust_cache();
                    assert_eq!(entry.symlink(fs, false), path);
                }
            },
        );
    }
}

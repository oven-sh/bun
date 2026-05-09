use core::cell::{Cell, RefCell};
use core::ffi::{c_void, CStr};
use core::sync::atomic::{AtomicU32, Ordering};
use std::borrow::Cow;
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::{allocators, AllocError};
use bun_core::{env_var, fmt as bun_fmt, FeatureFlags, Generation, Output, ZStr};
use bun_paths::{resolve_path as path_handler, PathBuffer, WPathBuffer, MAX_PATH_BYTES, SEP, SEP_STR};
use bun_paths::resolve_path::{is_sep_any, last_index_of_sep, platform};
use bun_string::{strings, MutableString, PathString};
use bun_sys::{self, Fd};
use bun_threading::Mutex;

// PORT NOTE: scope tag renamed `fs` → `Fs` so it doesn't collide with `fs:` fn
// params (the `declare_scope!` macro emits a `static` with the tag name, and
// edition-2024 forbids fn params shadowing statics).
bun_core::declare_scope!(Fs, hidden);

macro_rules! debug {
    ($($arg:tt)*) => { bun_core::scoped_log!(Fs, $($arg)*) };
}

// ── BOM ──────────────────────────────────────────────────────────────────────
// Port of `bun.strings.BOM` from `src/string/immutable.zig`. The Rust port
// lives in `bun_string::immutable::unicode_draft` but that module is private
// (`mod unicode_draft` — no `pub use` of `BOM` yet); the resolver needs it for
// `read_file_with_handle_and_allocator` so the enum is re-ported here. The
// UTF-16→UTF-8 transcode goes through `strings::to_utf8_alloc` (re-exported
// from `bun_core::strings`, simdutf-backed) — no C++ is reimplemented.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BOM {
    Utf8,
    Utf16Le,
    Utf16Be,
    Utf32Le,
    Utf32Be,
}

impl BOM {
    pub const UTF8_BYTES: [u8; 3] = [0xef, 0xbb, 0xbf];
    pub const UTF16_LE_BYTES: [u8; 2] = [0xff, 0xfe];
    pub const UTF16_BE_BYTES: [u8; 2] = [0xfe, 0xff];
    pub const UTF32_LE_BYTES: [u8; 4] = [0xff, 0xfe, 0x00, 0x00];
    pub const UTF32_BE_BYTES: [u8; 4] = [0x00, 0x00, 0xfe, 0xff];

    pub fn detect(bytes: &[u8]) -> Option<BOM> {
        if bytes.len() < 3 {
            return None;
        }
        if bytes.starts_with(&Self::UTF8_BYTES) {
            return Some(BOM::Utf8);
        }
        if bytes.starts_with(&Self::UTF16_LE_BYTES) {
            // if (bytes.len > 4 and eqlComptimeIgnoreLen(bytes[2..], utf32_le_bytes[2..]))
            //   return .utf32_le;
            return Some(BOM::Utf16Le);
        }
        // if (eqlComptimeIgnoreLen(bytes, utf16_be_bytes)) return .utf16_be;
        // if (bytes.len > 4 and eqlComptimeIgnoreLen(bytes, utf32_le_bytes)) return .utf32_le;
        None
    }

    pub fn header(self) -> &'static [u8] {
        match self {
            BOM::Utf8 => &Self::UTF8_BYTES,
            BOM::Utf16Le => &Self::UTF16_LE_BYTES,
            BOM::Utf16Be => &Self::UTF16_BE_BYTES,
            BOM::Utf32Le => &Self::UTF32_LE_BYTES,
            BOM::Utf32Be => &Self::UTF32_BE_BYTES,
        }
    }

    pub fn tag_name(self) -> &'static str {
        match self {
            BOM::Utf8 => "utf8",
            BOM::Utf16Le => "utf16_le",
            BOM::Utf16Be => "utf16_be",
            BOM::Utf32Le => "utf32_le",
            BOM::Utf32Be => "utf32_be",
        }
    }

    /// `removeAndConvertToUTF8AndFree` — if a re-encode is needed, free the input
    /// and the caller replaces it with the new return.
    pub fn remove_and_convert_to_utf8_and_free(self, mut bytes: Vec<u8>) -> Vec<u8> {
        match self {
            BOM::Utf8 => {
                let n = Self::UTF8_BYTES.len();
                bytes.copy_within(n.., 0);
                bytes.truncate(bytes.len() - n);
                bytes
            }
            BOM::Utf16Le => {
                let trimmed = &bytes[Self::UTF16_LE_BYTES.len()..];
                // SAFETY: `trimmed` reinterprets [u8] as [u16] LE; alignment may be 1 — Zig used
                // `@alignCast`. simdutf reads byte-aligned on every supported target.
                let trimmed_u16: &[u16] = unsafe {
                    core::slice::from_raw_parts(trimmed.as_ptr().cast::<u16>(), trimmed.len() / 2)
                };
                let out = strings::to_utf8_alloc(trimmed_u16);
                drop(bytes);
                out
            }
            _ => {
                // TODO: this needs to re-encode, for now we just remove the BOM
                let n = self.header().len();
                bytes.copy_within(n.., 0);
                bytes.truncate(bytes.len() - n);
                bytes
            }
        }
    }

    /// `removeAndConvertToUTF8WithoutDealloc` — required for `use_shared_buffer`.
    /// We cannot free `list`'s pointer; the returned slice always points to
    /// `list.as_ptr()`. `list` may be grown.
    pub fn remove_and_convert_to_utf8_without_dealloc<'a>(self, list: &'a mut Vec<u8>) -> &'a [u8] {
        match self {
            BOM::Utf8 => {
                let n = Self::UTF8_BYTES.len();
                let len = list.len();
                list.copy_within(n.., 0);
                // PORT NOTE: Zig returned a subslice without truncating; mirror by slicing.
                &list[..len - n]
            }
            BOM::Utf16Le => {
                let trimmed = &list[Self::UTF16_LE_BYTES.len()..];
                // SAFETY: see `remove_and_convert_to_utf8_and_free`.
                let trimmed_u16: &[u16] = unsafe {
                    core::slice::from_raw_parts(trimmed.as_ptr().cast::<u16>(), trimmed.len() / 2)
                };
                let out = strings::to_utf8_alloc(trimmed_u16);
                if list.capacity() < out.len() {
                    list.reserve(out.len() - list.len());
                }
                // SAFETY: capacity ensured; bytes overwritten immediately below.
                unsafe { list.set_len(out.len()) };
                list.copy_from_slice(&out);
                &list[..]
            }
            _ => {
                // TODO: this needs to re-encode, for now we just remove the BOM
                let n = self.header().len();
                let len = list.len();
                list.copy_within(n.., 0);
                &list[..len - n]
            }
        }
    }
}

// pub const FilesystemImplementation = @import("./fs_impl.zig");

pub(crate) mod preallocate {
    pub(crate) mod counts {
        pub(crate) const DIR_ENTRY: usize = 2048;
        pub(crate) const FILES: usize = 4096;
    }
}

// PORT NOTE: Zig `BSSStringList(_COUNT, _ITEM_LENGTH)` internally remaps to
// `<_COUNT * 2, _ITEM_LENGTH + 1>`; the Rust port took the post-transform
// const params, so apply the arithmetic at the type-alias / declare site.
pub(crate) type DirnameStoreBacking =
    allocators::BSSStringList<{ preallocate::counts::DIR_ENTRY * 2 }, { 128 + 1 }>;
pub(crate) type FilenameStoreBacking =
    allocators::BSSStringList<{ preallocate::counts::FILES * 2 }, { 64 + 1 }>;
// PORT NOTE: Zig `BSSList(_COUNT)` → Rust `BSSList<{_COUNT * 2}>`.
pub(crate) type EntryStoreBacking =
    allocators::BSSList<Entry, { preallocate::counts::FILES * 2 }>;

// Per-monomorphization singleton storage — Zig kept `var instance` inside the
// generic; Rust emits it at the declare site via `bss_*!` macros (returns `*mut`).
bun_alloc::bss_string_list! { pub dirname_store_backing : preallocate::counts::DIR_ENTRY * 2, 128 + 1 }
bun_alloc::bss_string_list! { pub filename_store_backing : preallocate::counts::FILES * 2, 64 + 1 }
bun_alloc::bss_list! { pub entry_store_backing : Entry, preallocate::counts::FILES * 2 }

/// Port of `FileSystem.DirnameStore` — ZST handle resolving to the
/// `dirname_store_backing()` singleton on every call.
pub struct DirnameStore(());
/// Port of `FileSystem.FilenameStore` — ZST handle.
pub struct FilenameStore(());

static DIRNAME_STORE_ZST: DirnameStore = DirnameStore(());
static FILENAME_STORE_ZST: FilenameStore = FilenameStore(());

// PORT NOTE: external locks serializing formation of `&mut *backing()`. The backing's
// own internal mutex is acquired *inside* `append(&mut self, ...)` — i.e. *after* the
// `&mut self` auto-ref has already been formed, which is too late under Stacked Borrows:
// two threads could each materialize a live `&mut BSSStringList` to the same singleton
// before either takes the inner lock (aliased `&mut`, UB). Zig calls go through a raw
// `*Self` with no noalias guarantee, so its inner mutex suffices; in Rust we must hold
// an outer lock across the auto-ref so only one `&mut` exists at a time.
// TODO(port): `bun_threading::Mutex` has no `const fn new()`; LazyLock until it does.
static DIRNAME_STORE_MUTEX: std::sync::LazyLock<Mutex> = std::sync::LazyLock::new(Mutex::default);
static FILENAME_STORE_MUTEX: std::sync::LazyLock<Mutex> = std::sync::LazyLock::new(Mutex::default);

macro_rules! string_store_impl {
    ($t:ty, $zst:ident, $backing:ident, $bty:ty, $mutex:ident) => {
        impl $t {
            #[inline]
            pub fn instance() -> &'static Self { &$zst }
            #[inline]
            fn backing() -> *mut $bty {
                // PORT NOTE: returns the raw `*mut` singleton (Zig `*Self`). Do NOT
                // materialize a `&'static mut` here — two threads entering `append`
                // would each hold a live `&'static mut` to the same object (UB)
                // regardless of the backing's internal mutex. Form the `&mut` only
                // for the duration of a single locked operation at the call site.
                $backing()
            }
            pub fn append(&self, value: &[u8]) -> core::result::Result<&'static [u8], AllocError> {
                let _guard = $mutex.lock_guard();
                // SAFETY: `$mutex` is held, so this is the only live `&mut` to the
                // process-lifetime singleton; `append` further serializes mutation
                // through its (now-redundant) internal mutex.
                let s = unsafe { (*Self::backing()).append(value)? };
                // SAFETY: `append` returns a slice into the singleton's backing storage
                // (heap-owned by a `'static` `BSSStringList` or a leaked mi_malloc); the
                // borrow tied to `&mut self` is artificially short — re-erase to `'static`.
                Ok(unsafe { core::slice::from_raw_parts(s.as_ptr(), s.len()) })
            }
            #[inline]
            pub fn exists(&self, value: &[u8]) -> bool {
                let _guard = $mutex.lock_guard();
                // SAFETY: `$mutex` held — no concurrent `&mut` to the singleton.
                unsafe { (*Self::backing()).exists(value) }
            }
        }
        impl strings::Appender for &'static $t {
            fn append(&mut self, s: &[u8]) -> core::result::Result<&[u8], AllocError> {
                let _guard = $mutex.lock_guard();
                // SAFETY: `$mutex` held — sole live `&mut` to the singleton.
                let r = unsafe { (*<$t>::backing()).append(s)? };
                // SAFETY: re-erase to `'static`; storage owned by the process-lifetime singleton.
                Ok(unsafe { core::slice::from_raw_parts(r.as_ptr(), r.len()) })
            }
            fn append_lower_case(&mut self, s: &[u8]) -> core::result::Result<&[u8], AllocError> {
                let _guard = $mutex.lock_guard();
                // SAFETY: `$mutex` held — sole live `&mut` to the singleton.
                let r = unsafe { (*<$t>::backing()).append_lower_case(s)? };
                // SAFETY: re-erase to `'static`; storage owned by the process-lifetime singleton.
                Ok(unsafe { core::slice::from_raw_parts(r.as_ptr(), r.len()) })
            }
        }
    };
}
string_store_impl!(DirnameStore, DIRNAME_STORE_ZST, dirname_store_backing, DirnameStoreBacking, DIRNAME_STORE_MUTEX);
string_store_impl!(FilenameStore, FILENAME_STORE_ZST, filename_store_backing, FilenameStoreBacking, FILENAME_STORE_MUTEX);

pub(crate) struct FileSystem {
    pub top_level_dir: &'static [u8],

    // used on subsequent updates
    pub top_level_dir_buf: PathBuffer,

    pub fs: Implementation,

    pub dirname_store: &'static DirnameStore,
    pub filename_store: &'static FilenameStore,
}

thread_local! {
    // TODO(port): std.fs.Dir replacement — using bun_sys::Fd-based dir handle
    static TMPDIR_HANDLE: Cell<Option<bun_sys::Dir>> = const { Cell::new(None) };
}

#[derive(strum::IntoStaticStr, Debug)]
pub enum FileSystemError {
    ENOENT,
    EACCESS,
    INVALID_NAME,
    ENOTDIR,
}
// TODO(port): impl From<FileSystemError> for bun_core::Error

static TMPNAME_ID_NUMBER: AtomicU32 = AtomicU32::new(0);

// PORTING.md §Global mutable state: highest-fd watermark, mutated only on the
// resolver thread. POSIX-only fd ceiling tracking (Windows handles aren't
// ordered ints) — `set_max_fd` early-returns on Windows; the static is still
// declared so the cross-platform `MAX_FD` symbol resolves.
#[cfg(not(windows))]
pub(crate) static MAX_FD: bun_core::RacyCell<bun_sys::RawFd> = bun_core::RacyCell::new(0);
#[cfg(windows)]
pub(crate) static MAX_FD: bun_core::RacyCell<i32> = bun_core::RacyCell::new(0);
pub(crate) static INSTANCE_LOADED: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);
// TODO(port): lifetime — global mutable singleton; Zig used `var instance: FileSystem = undefined`
pub(crate) static INSTANCE: bun_core::RacyCell<core::mem::MaybeUninit<FileSystem>> =
    bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

impl FileSystem {
    pub(crate) fn top_level_dir_without_trailing_slash(&self) -> &[u8] {
        let tld = self.top_level_dir;
        if tld.len() > 1 && tld[tld.len() - 1] == SEP {
            &tld[0..tld.len() - 1]
        } else {
            tld
        }
    }

    pub(crate) fn tmpdir(&mut self) -> Result<bun_sys::Dir, bun_core::Error> {
        TMPDIR_HANDLE.with(|h| {
            if h.get().is_none() {
                h.set(Some(self.fs.open_tmp_dir()?));
            }
            Ok(h.get().unwrap())
        })
    }

    pub(crate) fn get_fd_path(&self, fd: Fd) -> Result<&'static [u8], bun_core::Error> {
        let mut buf = PathBuffer::uninit();
        let dir = bun_sys::get_fd_path(fd, &mut buf)?;
        Ok(self.dirname_store.append(dir)?)
    }

    pub(crate) fn tmpname<'b>(
        extname: &[u8],
        buf: &'b mut [u8],
        hash: u64,
    ) -> Result<&'b mut ZStr, bun_core::Error> {
        // TODO(port): narrow error set (was std.fmt.BufPrintError)
        let hex_value: u64 =
            (u128::from(hash) | (bun_core::time::nano_timestamp() as u128)) as u64;

        // TODO(port): bufPrintZ equivalent — write into buf and NUL-terminate
        let len = buf.len();
        let mut cursor = &mut buf[..];
        write!(
            &mut cursor,
            ".{:x}-{:X}.{}",
            hex_value,
            TMPNAME_ID_NUMBER.fetch_add(1, Ordering::Relaxed),
            BStr::new(extname),
        )
        .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
        let written = len - cursor.len();
        if written >= len {
            return Err(bun_core::err!("NoSpaceLeft"));
        }
        buf[written] = 0;
        // SAFETY: buf[written] == 0 written above
        Ok(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), written) })
    }

    #[inline]
    pub(crate) fn set_max_fd(fd: bun_sys::RawFd) {
        #[cfg(windows)]
        {
            let _ = fd;
            return;
        }
        #[cfg(not(windows))]
        {
            if !FeatureFlags::STORE_FILE_DESCRIPTORS {
                return;
            }

            // SAFETY: single-threaded mutation in resolver context (matches Zig global)
            unsafe {
                *MAX_FD.get() = fd.max(*MAX_FD.get());
            }
        }
    }

    pub(crate) fn init(top_level_dir: Option<&[u8]>) -> Result<*mut FileSystem, bun_core::Error> {
        Self::init_with_force::<false>(top_level_dir)
    }

    pub(crate) fn init_with_force<const FORCE: bool>(
        top_level_dir_: Option<&[u8]>,
    ) -> Result<*mut FileSystem, bun_core::Error> {
        // TODO(port): Environment.isBrowser branch
        let top_level_dir: &'static [u8] = match top_level_dir_ {
            // PORT NOTE: intern into the process-lifetime `DirnameStore` so the
            // stored slice is `'static` without forcing every caller to leak.
            Some(d) => DirnameStore::instance().append(d)?,
            None => {
                #[cfg(target_arch = "wasm32")]
                {
                    b"/project/"
                }
                #[cfg(not(target_arch = "wasm32"))]
                {
                    // PORT NOTE: Zig used `bun.getcwdAlloc(default_allocator)`; intern into
                    // DirnameStore so it lives for `'static` without `Box::leak`.
                    let mut buf = PathBuffer::uninit();
                    let n = bun_sys::getcwd(&mut buf[..])?;
                    DirnameStore::instance().append(&buf[..n])?
                }
            }
        };

        // SAFETY: matches Zig global singleton init pattern
        unsafe {
            if !INSTANCE_LOADED.load(core::sync::atomic::Ordering::Acquire) || FORCE {
                // Publish to T0 storage so `bun_sys` / display paths can read
                // the cwd without an upward dep on the resolver. Kept inside
                // the FORCE/first-init guard so a no-op re-init doesn't
                // desync `bun_core::top_level_dir()` from the singleton.
                bun_core::set_top_level_dir(top_level_dir);
                (*INSTANCE.get()).write(FileSystem {
                    top_level_dir,
                    top_level_dir_buf: PathBuffer::uninit(),
                    fs: Implementation::init(top_level_dir),
                    // must always use default_allocator since the other allocators may not be threadsafe when an element resizes
                    dirname_store: DirnameStore::instance(),
                    filename_store: FilenameStore::instance(),
                });
                INSTANCE_LOADED.store(true, core::sync::atomic::Ordering::Release);

                // Touch the EntryStore singleton so it's initialized.
                let _ = entry_store_backing();
            }

            Ok((*INSTANCE.get()).as_mut_ptr())
        }
    }

    #[inline]
    pub(crate) fn instance() -> *mut FileSystem {
        // PORT NOTE: returns the raw `*mut` singleton (Zig `*FileSystem`). Do NOT
        // materialize a `&'static mut` here — concurrent callers (resolver runs on a
        // thread pool) would each hold a live `&'static mut` to the same object (UB).
        // Form the `&mut` only for the duration of a single operation at the call site.
        // SAFETY: caller guarantees `init()` was called.
        unsafe { (*INSTANCE.get()).as_mut_ptr() }
    }
}

// PORT NOTE: Zig `FileSystem.deinit()` only called .deinit() on dirname_store/filename_store,
// which are &'static singletons here — nothing owned to free, so no `impl Drop`.

pub(crate) mod dir_entry {
    use super::*;

    pub(crate) type EntryMap = bun_collections::StringHashMap<*mut Entry>;
    /// Port of `DirEntry.EntryStore` (`allocators.BSSList<Entry, files>`).
    /// ZST handle resolving to the `entry_store_backing()` singleton.
    pub(crate) struct EntryStore(());

    // PORT NOTE: external lock serializing formation of `&mut *entry_store_backing()`.
    // `BSSList::append(&mut self, ...)` only acquires its internal mutex *after* the
    // `&mut self` auto-ref has been formed; concurrent `EntryStore::append` calls (from
    // `DirEntry::add_entry` across the resolver thread pool) would otherwise each hold a
    // live `&mut BSSList` to the same singleton — aliased `&mut`, UB. Zig's `*Self` raw
    // pointer carries no noalias, so its inner mutex suffices there; Rust needs the
    // outer lock so only one `&mut` exists at a time.
    static ENTRY_STORE_MUTEX: std::sync::LazyLock<Mutex> =
        std::sync::LazyLock::new(Mutex::default);

    impl EntryStore {
        #[inline]
        pub(crate) fn instance() -> *mut EntryStoreBacking {
            // PORT NOTE: returns the raw `*mut` singleton (Zig `*Self`). Do NOT
            // materialize a `&'static mut` here — concurrent callers would alias the
            // same object via `&mut` (UB) regardless of the backing's internal mutex.
            // Form the `&mut` only for the duration of a single locked operation.
            entry_store_backing()
        }
        pub(crate) fn append(value: Entry) -> core::result::Result<*mut Entry, AllocError> {
            let _guard = ENTRY_STORE_MUTEX.lock_guard();
            // SAFETY: `ENTRY_STORE_MUTEX` is held, so this is the only live `&mut` to
            // the process-lifetime singleton; `append` further serializes via its
            // (now-redundant) internal mutex.
            let r = unsafe { (*Self::instance()).append(value)? };
            Ok(std::ptr::from_mut::<Entry>(r))
        }
    }

    #[derive(Clone, Copy)]
    pub struct Err {
        pub original_err: bun_core::Error,
        pub canonical_error: bun_core::Error,
    }
}

pub struct DirEntry {
    // TODO(port): rule deviation — Zig deinit calls allocator.free(d.dir) so guide says Box<[u8]>,
    // but this is interned in DirnameStore (a &'static BSSList). Keeping &'static; Phase B revisit.
    pub dir: &'static [u8],
    pub fd: Fd,
    pub generation: Generation,
    pub data: dir_entry::EntryMap,
}

impl DirEntry {
    // pub fn remove_entry(dir: &mut DirEntry, name: &[u8]) -> Result<(), bun_core::Error> {
    //     // dir.data.remove(name);
    // }

    pub fn add_entry<I: DirEntryIterator>(
        &mut self,
        prev_map: Option<&mut dir_entry::EntryMap>,
        entry: &bun_sys::dir_iterator::IteratorResult,
        iterator: I,
    ) -> Result<(), bun_core::Error> {
        use bun_sys::FileKind as DK;
        // `entry.name.slice()` is OS-native (`&[u16]` on Windows); the
        // entry-store / hashmap key in `data` is UTF-8, so use the eagerly-
        // transcoded `slice_u8()` (mirrors Zig's `.u8` `NewWrappedIterator`).
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
            | DK::EventPort => return Ok(()),
        };

        let stored: *mut Entry = 'brk: {
            if let Some(map) = prev_map {
                // PERF(port): was stack-fallback alloc — profile in Phase B
                let prehashed =
                    bun_collections::StringHashMapContext::PrehashedCaseInsensitive::init(name_slice);
                // PORT NOTE: `StringHashMap::get_adapted` ignores the adapter and looks up by the
                // raw key; pass the already-lowercased `prehashed.input` so the case-insensitive
                // lookup matches the lowercased keys stored in `data` (Zig: `getAdapted` lowercases
                // for both hash and eql).
                if let Some(&existing_ptr) = map.get_adapted(&prehashed.input, &prehashed) {
                    // SAFETY: EntryStore-owned pointer, valid for lifetime of store
                    let existing = unsafe { &mut *existing_ptr };
                    existing.mutex.lock();
                    let _guard = scopeguard::guard(core::ptr::addr_of!(existing.mutex), |m| {
                        // SAFETY: `m` points into `*existing`, which outlives this guard.
                        unsafe { (*m).unlock() }
                    });
                    existing.dir = self.dir;

                    existing.need_stat = existing.need_stat
                        || found_kind.is_none()
                        || Some(existing.cache.kind) != found_kind;
                    // TODO: is this right?
                    if Some(existing.cache.kind) != found_kind {
                        // if found_kind is null, we have set need_stat above, so we
                        // store an arbitrary kind
                        existing.cache.kind = found_kind.unwrap_or(EntryKind::File);

                        existing.cache.symlink = PathString::EMPTY;
                    }
                    break 'brk existing_ptr;
                }
            }

            // name_slice only lives for the duration of the iteration
            let name = strings::StringOrTinyString::init_append_if_needed(
                name_slice,
                &mut FilenameStore::instance(),
            )?;

            let name_lowercased = strings::StringOrTinyString::init_lower_case_append_if_needed(
                name_slice,
                &mut FilenameStore::instance(),
            )?;

            dir_entry::EntryStore::append(Entry {
                base_: name,
                base_lowercase_: name_lowercased,
                dir: self.dir,
                mutex: Mutex::default(),
                // Call "stat" lazily for performance. The "@material-ui/icons" package
                // contains a directory with over 11,000 entries in it and running "stat"
                // for each entry was a big performance issue for that package.
                need_stat: found_kind.is_none(),
                cache: EntryCache {
                    symlink: PathString::EMPTY,
                    // if found_kind is null, we have set need_stat above, so we
                    // store an arbitrary kind
                    kind: found_kind.unwrap_or(EntryKind::File),
                    fd: Fd::INVALID,
                },
                abs_path: PathString::EMPTY,
            })?
        };

        // SAFETY: just produced from EntryStore append or prev_map lookup
        let stored_ref = unsafe { &mut *stored };

        self.data.put(stored_ref.base_lowercase(), stored)?;

        if !I::IS_VOID {
            iterator.next(stored_ref, self.fd);
        }

        if FeatureFlags::VERBOSE_FS {
            // PORT NOTE: re-borrow `base()` after the `iterator.next` mutable borrow ends.
            let stored_name = stored_ref.base();
            if found_kind == Some(EntryKind::Dir) {
                bun_core::prettyln!("   + {}/", BStr::new(stored_name));
            } else {
                bun_core::prettyln!("   + {}", BStr::new(stored_name));
            }
        }

        Ok(())
    }

    pub fn init(dir: &'static [u8], generation: Generation) -> DirEntry {
        if FeatureFlags::VERBOSE_FS {
            bun_core::prettyln!("\n  {}", BStr::new(dir));
        }

        DirEntry {
            dir,
            data: dir_entry::EntryMap::default(),
            generation,
            fd: Fd::INVALID,
        }
    }

    pub fn get<'a>(&'a self, query_: &'a [u8]) -> Option<EntryLookup<'a>> {
        if query_.is_empty() || query_.len() > MAX_PATH_BYTES {
            return None;
        }
        let mut scratch_lookup_buffer = PathBuffer::uninit();

        let query = strings::copy_lowercase_if_needed(query_, &mut scratch_lookup_buffer[..]);
        let &result_ptr = self.data.get(query)?;
        // SAFETY: EntryStore-owned pointer; valid for the lifetime of the store (process-static).
        let result = unsafe { &*result_ptr };
        let basename = result.base();
        if !strings::eql_long(basename, query_, true) {
            return Some(EntryLookup {
                entry: result_ptr,
                diff_case: Some(DifferentCase {
                    dir: self.dir,
                    query: query_,
                    actual: basename,
                }),
            });
        }

        Some(EntryLookup { entry: result_ptr, diff_case: None })
    }

    // TODO(port): getComptimeQuery used comptime string lowering + comptime hash; Rust port
    // takes a &'static [u8] that is already lowercase. Phase B may add a const-eval hash.
    pub fn get_comptime_query<'a>(&'a self, query_lower: &'static [u8]) -> Option<EntryLookup<'a>> {
        // PERF(port): was comptime hash precompute — profile in Phase B
        let &result_ptr = self.data.get(query_lower)?;
        // SAFETY: EntryStore-owned pointer; valid for the lifetime of the store (process-static).
        let result = unsafe { &*result_ptr };
        let basename = result.base();

        if basename != query_lower {
            return Some(EntryLookup {
                entry: result_ptr,
                diff_case: Some(DifferentCase {
                    dir: self.dir,
                    query: query_lower,
                    actual: basename,
                }),
            });
        }

        Some(EntryLookup { entry: result_ptr, diff_case: None })
    }

    pub fn has_comptime_query(&self, query_lower: &'static [u8]) -> bool {
        // PERF(port): was comptime hash precompute — profile in Phase B
        self.data.contains_key(query_lower)
    }
}

// PORT NOTE: Zig `DirEntry.deinit(allocator)` freed `data` (now drops itself) and `dir`
// (interned in DirnameStore — see field TODO). Body would be empty, so no `impl Drop`.

/// Trait abstraction for the `comptime Iterator: type, iterator: Iterator` pattern in addEntry/readdir.
pub trait DirEntryIterator {
    const IS_VOID: bool = false;
    fn next(&self, entry: &mut Entry, fd: Fd);
}

impl DirEntryIterator for () {
    const IS_VOID: bool = true;
    fn next(&self, _entry: &mut Entry, _fd: Fd) {}
}

impl<T: DirEntryIterator + ?Sized> DirEntryIterator for &T {
    const IS_VOID: bool = T::IS_VOID;
    #[inline]
    fn next(&self, entry: &mut Entry, fd: Fd) { (**self).next(entry, fd) }
}

pub struct Entry {
    pub cache: EntryCache,
    // TODO(port): rule deviation — Zig deinit calls allocator.free(e.dir) so guide says Box<[u8]>,
    // but this points into DirnameStore (a &'static BSSList). Keeping &'static; Phase B revisit.
    pub dir: &'static [u8],

    pub base_: strings::StringOrTinyString,

    // Necessary because the hash table uses it as a key
    pub base_lowercase_: strings::StringOrTinyString,

    pub mutex: Mutex,
    pub need_stat: bool,

    pub abs_path: PathString,
}

// PORT NOTE: `BSSList::append` requires `ValueType: Clone` (its overflow path
// retries with a copy). `Mutex`/`StringOrTinyString` aren't `Clone`, but for a
// freshly-constructed `Entry` (the only thing ever appended) a field-wise copy
// with a fresh `Mutex` is semantically equivalent to Zig's by-value move.
impl Clone for Entry {
    fn clone(&self) -> Self {
        Self {
            cache: self.cache,
            dir: self.dir,
            base_: strings::StringOrTinyString::init(self.base_.slice()),
            base_lowercase_: strings::StringOrTinyString::init(self.base_lowercase_.slice()),
            mutex: Mutex::default(),
            need_stat: self.need_stat,
            abs_path: self.abs_path,
        }
    }
}

impl Default for Entry {
    fn default() -> Self {
        Self {
            cache: EntryCache::default(),
            dir: b"",
            base_: strings::StringOrTinyString::init(b""),
            base_lowercase_: strings::StringOrTinyString::init(b""),
            mutex: Mutex::default(),
            need_stat: true,
            abs_path: PathString::EMPTY,
        }
    }
}

#[derive(Clone, Copy)]
pub struct DifferentCase<'a> {
    pub dir: &'a [u8],
    pub query: &'a [u8],
    pub actual: &'a [u8],
}

pub struct EntryLookup<'a> {
    /// Mutable raw pointer matching Zig `*Entry` — the lazy-stat methods
    /// `Entry::kind`/`Entry::symlink` need `&mut Entry` to fill `cache`, and
    /// `Entry` lives in the process-static `EntryStore` (BSSList) so a raw
    /// pointer is the correct ownership shape (BACKREF/ARENA).
    pub entry: *mut Entry,
    pub diff_case: Option<DifferentCase<'a>>,
}

impl<'a> EntryLookup<'a> {
    /// Convenience: dereference `entry` as a shared borrow.
    /// SAFETY: `entry` points into the process-static `EntryStore`; caller must
    /// not hold a concurrent `&mut` to the same `Entry`.
    #[inline]
    pub unsafe fn entry_ref(&self) -> &Entry {
        // SAFETY: see fn doc
        unsafe { &*self.entry }
    }
    /// Convenience: dereference `entry` as a mutable borrow for the lazy-stat
    /// path (`kind`/`symlink`).
    /// SAFETY: `entry` points into the process-static `EntryStore`; caller must
    /// hold no other borrow to the same `Entry`.
    #[inline]
    pub unsafe fn entry_mut(&self) -> &mut Entry {
        // SAFETY: see fn doc
        unsafe { &mut *self.entry }
    }
}

#[derive(Clone, Copy)]
pub struct EntryCache {
    pub symlink: PathString,
    /// Too much code expects this to be 0
    /// don't make it bun.invalid_fd
    pub fd: Fd,
    pub kind: EntryKind,
}

impl Default for EntryCache {
    fn default() -> Self {
        Self {
            symlink: PathString::EMPTY,
            fd: Fd::INVALID,
            kind: EntryKind::File,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    Dir,
    File,
}

impl Entry {
    #[inline]
    pub fn base(&self) -> &[u8] {
        self.base_.slice()
    }

    #[inline]
    pub fn base_lowercase(&self) -> &[u8] {
        self.base_lowercase_.slice()
    }

    pub fn kind(&mut self, fs: &mut Implementation, store_fd: bool) -> EntryKind {
        if self.need_stat {
            self.need_stat = false;
            // This is technically incorrect, but we are choosing not to handle errors here
            match fs.kind(self.dir, self.base(), self.cache.fd, store_fd) {
                Ok(c) => self.cache = c,
                Err(_) => return self.cache.kind,
            }
        }
        self.cache.kind
    }

    pub fn symlink(&mut self, fs: &mut Implementation, store_fd: bool) -> &[u8] {
        if self.need_stat {
            self.need_stat = false;
            // This is technically incorrect, but we are choosing not to handle errors here
            // This error can happen if the file was deleted between the time the directory was scanned and the time it was read
            match fs.kind(self.dir, self.base(), self.cache.fd, store_fd) {
                Ok(c) => self.cache = c,
                Err(_) => return b"",
            }
        }
        self.cache.symlink.slice()
    }
}

// TODO(port): Entry::deinit took allocator and destroyed self; Entry lives in EntryStore (BSSList) so no Drop needed

// pub fn statBatch(fs: *FileSystemEntry, paths: []string) ![]?Stat {
// }
// pub fn stat(fs: *FileSystemEntry, path: string) !Stat {
// }
// pub fn readFile(fs: *FileSystemEntry, path: string) ?string {
// }
// pub fn readDir(fs: *FileSystemEntry, path: string) ?[]string {
// }

impl FileSystem {
    pub(crate) fn normalize<'a>(&self, str: &'a [u8]) -> &'a [u8] {
        // PERF(port): was @call(bun.callmod_inline, ...)
        path_handler::normalize_string::<true, platform::Auto>(str)
    }

    pub(crate) fn normalize_buf<'a>(&self, buf: &'a mut [u8], str: &[u8]) -> &'a [u8] {
        path_handler::normalize_string_buf::<false, platform::Auto, false>(str, buf)
    }

    pub(crate) fn join(&self, parts: &[&[u8]]) -> &'static [u8] {
        // TODO(port): join_buf is threadlocal static; returning &'static matches Zig (caller copies before reuse)
        JOIN_BUF.with_borrow_mut(|buf| {
            let s = path_handler::join_string_buf::<platform::Loose>(&mut buf[..], parts);
            // SAFETY: borrows the threadlocal buffer; matches Zig pattern
            unsafe { core::slice::from_raw_parts(s.as_ptr(), s.len()) }
        })
    }

    pub(crate) fn join_buf<'a>(&self, parts: &[&[u8]], buf: &'a mut [u8]) -> &'a [u8] {
        path_handler::join_string_buf::<platform::Loose>(buf, parts)
    }

    pub(crate) fn relative(&self, from: &[u8], to: &[u8]) -> &'static [u8] {
        path_handler::relative(from, to)
    }

    pub(crate) fn relative_platform<P: path_handler::PlatformT>(
        &self,
        from: &[u8],
        to: &[u8],
    ) -> &'static [u8] {
        path_handler::relative_platform::<P, false>(from, to)
    }

    pub(crate) fn relative_to(&self, to: &[u8]) -> &'static [u8] {
        path_handler::relative(self.top_level_dir, to)
    }

    pub(crate) fn relative_from(&self, from: &[u8]) -> &'static [u8] {
        path_handler::relative(from, self.top_level_dir)
    }

    pub(crate) fn abs_alloc(&self, parts: &[&[u8]]) -> Result<Box<[u8]>, AllocError> {
        let joined = path_handler::join_abs_string::<platform::Loose>(self.top_level_dir, parts);
        Ok(Box::<[u8]>::from(joined))
    }

    pub(crate) fn abs_alloc_z(&self, parts: &[&[u8]]) -> Result<Box<[u8]>, AllocError> {
        let joined = path_handler::join_abs_string::<platform::Loose>(self.top_level_dir, parts);
        // allocator.dupeZ → owned NUL-terminated buffer
        let mut v = Vec::with_capacity(joined.len() + 1);
        v.extend_from_slice(joined);
        v.push(0);
        Ok(v.into_boxed_slice())
    }

    pub(crate) fn abs(&self, parts: &[&[u8]]) -> &[u8] {
        path_handler::join_abs_string::<platform::Loose>(self.top_level_dir, parts)
    }

    pub(crate) fn abs_buf<'a>(&self, parts: &[&[u8]], buf: &'a mut [u8]) -> &'a [u8] {
        path_handler::join_abs_string_buf::<platform::Loose>(self.top_level_dir, buf, parts)
    }

    /// Like `abs_buf`, but returns null when the joined path (after `..`/`.`
    /// normalization) would overflow `buf`. Use when `parts` may contain
    /// user-controlled input of arbitrary length.
    pub(crate) fn abs_buf_checked<'a>(&self, parts: &[&[u8]], buf: &'a mut [u8]) -> Option<&'a [u8]> {
        path_handler::join_abs_string_buf_checked::<platform::Loose>(self.top_level_dir, buf, parts)
    }

    pub(crate) fn abs_buf_z<'a>(&self, parts: &[&[u8]], buf: &'a mut [u8]) -> &'a ZStr {
        path_handler::join_abs_string_buf_z::<platform::Loose>(self.top_level_dir, buf, parts)
    }

    pub(crate) fn join_alloc(&self, parts: &[&[u8]]) -> Result<Box<[u8]>, AllocError> {
        let joined = self.join(parts);
        Ok(Box::<[u8]>::from(joined))
    }

    pub(crate) fn print_limits() {
        // TODO(port): std.posix.rlimit_resource / getrlimit — bun_sys equivalent
        #[cfg(unix)]
        {
            Output::print(format_args!("{{\n"));

            if let Ok(stack) = bun_sys::posix::getrlimit(bun_sys::posix::RlimitResource::STACK) {
                Output::print(format_args!("  \"stack\": [{}, {}],\n", stack.cur, stack.max));
            }
            if let Ok(files) = bun_sys::posix::getrlimit(bun_sys::posix::RlimitResource::NOFILE) {
                Output::print(format_args!("  \"files\": [{}, {}]\n", files.cur, files.max));
            }

            Output::print(format_args!("}}\n"));
            Output::flush();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RealFS
// ──────────────────────────────────────────────────────────────────────────

// Zig: `allocators.BSSMap(EntriesOption, dir_entry, false, 256, true)`.
// `store_keys=false` → Rust `BSSMapInner<V, COUNT, RM_SLASH>` (est_key_len unused on inner shape).
pub(crate) type EntriesOptionMap =
    allocators::BSSMapInner<EntriesOption, { preallocate::counts::DIR_ENTRY }, true>;

// Per-monomorphization singleton storage for `EntriesOption.Map`.
bun_alloc::bss_map_inner! { pub entries_option_map : EntriesOption, preallocate::counts::DIR_ENTRY, true }

/// ZST handle over the `entries_option_map()` singleton; keeps `RealFS.entries`
/// field-shaped without inlining the (large) backing array.
pub struct EntriesMap(());
impl EntriesMap {
    #[inline]
    pub const fn new() -> Self { Self(()) }
    #[inline]
    fn inner(&self) -> *mut EntriesOptionMap {
        // PORT NOTE: returns the raw `*mut` singleton (Zig `*Self`). Do NOT materialize
        // a `&'static mut` here — that asserts noalias for the whole map BEFORE
        // `RealFS.entries_mutex` is taken, which is UB if two threads race. Form the
        // `&mut` only for the duration of a single operation at the call site.
        entries_option_map()
    }
    /// SAFETY: forms a `&mut BSSMapInner` over the process-global singleton for
    /// the duration of the call. Caller must hold `RealFS.entries_mutex` so no
    /// other thread is inside any `EntriesMap` method concurrently. Returns a
    /// raw `*mut EntriesOption` (matching Zig's `*EntriesOption`) — caller
    /// forms a short-lived `&mut` at the use site under the same lock; do NOT
    /// hand out a `&'static mut` (two callers would alias the same slot).
    pub unsafe fn get(&self, key: &[u8]) -> Option<*mut EntriesOption> {
        // SAFETY: caller holds `entries_mutex`; sole `&mut` to the singleton.
        let r = unsafe { (*self.inner()).get(key)? };
        Some(std::ptr::from_mut::<EntriesOption>(r))
    }
    /// SAFETY: see [`get`] — mutates the singleton map.
    pub unsafe fn get_or_put(&self, key: &[u8]) -> core::result::Result<allocators::Result, AllocError> {
        // SAFETY: caller holds `entries_mutex`; sole `&mut` to the singleton.
        unsafe { (*self.inner()).get_or_put(key) }
    }
    /// SAFETY: see [`get`].
    pub unsafe fn at_index(&self, index: allocators::IndexType) -> Option<*mut EntriesOption> {
        // SAFETY: caller holds `entries_mutex`; sole `&mut` to the singleton.
        let r = unsafe { (*self.inner()).at_index(index)? };
        Some(std::ptr::from_mut::<EntriesOption>(r))
    }
    /// SAFETY: see [`get`].
    pub unsafe fn put(
        &self,
        result: &mut allocators::Result,
        value: EntriesOption,
    ) -> core::result::Result<*mut EntriesOption, AllocError> {
        // SAFETY: caller holds `entries_mutex`; sole `&mut` to the singleton.
        let r = unsafe { (*self.inner()).put(result, value)? };
        Ok(std::ptr::from_mut::<EntriesOption>(r))
    }
    /// SAFETY: see [`get`] — mutates the singleton map.
    pub unsafe fn mark_not_found(&self, result: allocators::Result) {
        // SAFETY: caller holds `entries_mutex`; sole `&mut` to the singleton.
        unsafe { (*self.inner()).mark_not_found(result) }
    }
    /// SAFETY: see [`get`] — mutates the singleton map.
    pub unsafe fn remove(&self, key: &[u8]) -> bool {
        // SAFETY: caller holds `entries_mutex`; sole `&mut` to the singleton.
        unsafe { (*self.inner()).remove(key) }
    }
}

/// RAII guard over the `entries_option_map()` singleton: holds
/// `RealFS.entries_mutex` for its lifetime and exposes the map operations as
/// **safe** methods. Obtaining this guard is the proof-of-exclusivity that
/// every `unsafe { self.entries.* }` call site previously had to re-assert in
/// a SAFETY comment — the lock is now structurally tied to the access, so the
/// raw-pointer escape (`unsafe { &mut *entries_option_map() }`) lives in
/// exactly one place per operation instead of at ~dozen call sites.
///
/// `bun_threading::MutexGuard` stores the mutex by raw pointer (no borrow of
/// `RealFS`), so holding an `EntriesGuard` does **not** keep `&self`/`&mut self`
/// borrowed — callers may freely re-borrow `self` for `readdir`/`open_dir`/
/// `read_directory_error` while the guard is live (matching the prior
/// `let _g = self.entries_mutex.lock_guard()` pattern).
pub struct EntriesGuard {
    _lock: bun_threading::MutexGuard,
}
impl EntriesGuard {
    #[inline]
    fn inner(&self) -> *mut EntriesOptionMap { entries_option_map() }

    pub fn get(&self, key: &[u8]) -> Option<*mut EntriesOption> {
        // SAFETY: `self._lock` holds `entries_mutex` — sole `&mut` to the singleton
        // for the duration of this call.
        let r = unsafe { (*self.inner()).get(key)? };
        Some(std::ptr::from_mut::<EntriesOption>(r))
    }
    pub fn get_or_put(&self, key: &[u8]) -> core::result::Result<allocators::Result, AllocError> {
        // SAFETY: `self._lock` holds `entries_mutex` — sole `&mut` to the singleton.
        unsafe { (*self.inner()).get_or_put(key) }
    }
    pub fn at_index(&self, index: allocators::IndexType) -> Option<*mut EntriesOption> {
        // SAFETY: `self._lock` holds `entries_mutex` — sole `&mut` to the singleton.
        let r = unsafe { (*self.inner()).at_index(index)? };
        Some(std::ptr::from_mut::<EntriesOption>(r))
    }
    pub fn put(
        &self,
        result: &mut allocators::Result,
        value: EntriesOption,
    ) -> core::result::Result<*mut EntriesOption, AllocError> {
        // SAFETY: `self._lock` holds `entries_mutex` — sole `&mut` to the singleton.
        let r = unsafe { (*self.inner()).put(result, value)? };
        Ok(std::ptr::from_mut::<EntriesOption>(r))
    }
    pub fn mark_not_found(&self, result: allocators::Result) {
        // SAFETY: `self._lock` holds `entries_mutex` — sole `&mut` to the singleton.
        unsafe { (*self.inner()).mark_not_found(result) }
    }
    pub fn remove(&self, key: &[u8]) -> bool {
        // SAFETY: `self._lock` holds `entries_mutex` — sole `&mut` to the singleton.
        unsafe { (*self.inner()).remove(key) }
    }
}

pub struct RealFS {
    pub entries_mutex: Mutex,
    pub entries: EntriesMap,
    pub cwd: &'static [u8], // TODO(port): lifetime — interned
    pub file_limit: usize,
    pub file_quota: usize,
}

#[cfg(windows)]
pub type Tmpfile = TmpfileWindows;
#[cfg(not(windows))]
pub(crate) type Tmpfile = TmpfilePosix;

pub(crate) mod limit {
    // PORTING.md §Global mutable state: written once at init in
    // `adjust_ulimit`, read elsewhere — Atomic for the scalar, RacyCell for
    // the POD struct (no Atomic<Rlimit>).
    pub(crate) static HANDLES: core::sync::atomic::AtomicUsize =
        core::sync::atomic::AtomicUsize::new(0);
    #[cfg(unix)]
    pub(crate) static HANDLES_BEFORE: bun_core::RacyCell<bun_sys::posix::Rlimit> =
        // SAFETY: all-zero is a valid Rlimit (POD)
        bun_core::RacyCell::new(bun_core::ffi::zeroed());
    #[cfg(not(unix))]
    pub static HANDLES_BEFORE: () = ();
}

thread_local! {
    static TEMP_ENTRIES_OPTION: RefCell<core::mem::MaybeUninit<EntriesOption>> =
        const { RefCell::new(core::mem::MaybeUninit::uninit()) };
}

impl RealFS {
    fn platform_temp_dir_compute() -> &'static [u8] {
        // Try TMPDIR, TMP, and TEMP in that order, matching Node.js.
        // https://github.com/nodejs/node/blob/e172be269890702bf2ad06252f2f152e7604d76c/src/node_credentials.cc#L132
        if let Some(dir) = env_var::TMPDIR::get_not_empty()
            .or_else(env_var::TMP::get_not_empty)
            .or_else(env_var::TEMP::get_not_empty)
        {
            if dir.len() > 1 && dir[dir.len() - 1] == SEP {
                return &dir[0..dir.len() - 1];
            }
            return dir;
        }

        #[cfg(target_os = "windows")]
        {
            // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettemppathw#remarks
            if let Some(windir) = env_var::SYSTEMROOT::get().or_else(env_var::WINDIR::get) {
                let mut v = Vec::new();
                write!(&mut v, "{}\\Temp", BStr::new(strings::without_trailing_slash(windir)))
                    .expect("oom");
                return DirnameStore::instance().append(&v).expect("oom");
            }

            if let Some(profile) = env_var::HOME::get() {
                let mut buf = PathBuffer::uninit();
                let parts: [&[u8]; 1] = [b"AppData\\Local\\Temp"];
                let out = path_handler::join_abs_string_buf::<platform::Loose>(
                    profile,
                    &mut buf[..],
                    &parts,
                );
                return DirnameStore::instance().append(out).expect("oom");
            }

            let mut tmp_buf = PathBuffer::uninit();
            // TODO(port): std.posix.getcwd — bun_sys::getcwd
            let n = bun_sys::getcwd(&mut tmp_buf[..]).expect("Failed to get cwd for platformTempDir");
            let cwd = &tmp_buf[..n];
            let root = path_handler::windows_filesystem_root(cwd);
            let mut v = Vec::new();
            write!(&mut v, "{}\\Windows\\Temp", BStr::new(strings::without_trailing_slash(root)))
                .expect("oom");
            return DirnameStore::instance().append(&v).expect("oom");
        }
        #[cfg(target_os = "macos")]
        {
            return b"/private/tmp";
        }
        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            #[cfg(target_os = "android")]
            {
                return b"/data/local/tmp";
            }
            #[cfg(not(target_os = "android"))]
            {
                return b"/tmp";
            }
        }
    }

    pub fn platform_temp_dir() -> &'static [u8] {
        static ONCE: bun_core::Once<&'static [u8]> = bun_core::Once::new();
        ONCE.call(Self::platform_temp_dir_compute)
    }

    pub fn tmpdir_path() -> &'static [u8] {
        env_var::BUN_TMPDIR::get_not_empty().unwrap_or_else(Self::platform_temp_dir)
    }

    pub fn open_tmp_dir(&self) -> Result<bun_sys::Dir, bun_core::Error> {
        #[cfg(windows)]
        {
            // fs.zig:601-608 — `openDirAtWindowsA(invalid_fd, tmpdirPath(),
            // .{ .iterable = true, .can_rename_or_delete = false, .read_only = true })`.
            // The generic `open_dir_absolute` path goes through `open_a(.., O::DIRECTORY, 0)`
            // and on Windows `O::DIRECTORY == 0`, so the directory dispatch in
            // `openat_windows_impl` is never taken and the handle lacks
            // FILE_DIRECTORY_FILE/FILE_LIST_DIRECTORY — `openat(tmp_dir.fd(), name, ..)`
            // in `TmpfileWindows::create` would then fail.
            return bun_sys::open_dir_at_windows_a(
                Fd::INVALID,
                Self::tmpdir_path(),
                bun_sys::WindowsOpenDirOptions {
                    iterable: true,
                    can_rename_or_delete: false,
                    read_only: true,
                    ..Default::default()
                },
            )
            .map(bun_sys::Dir::from_fd)
            .map_err(Into::into);
        }
        #[cfg(not(windows))]
        {
            bun_sys::open_dir_absolute(Self::tmpdir_path())
                .map(bun_sys::Dir::from_fd)
                .map_err(Into::into)
        }
    }

    /// Lock `entries_mutex` and return an [`EntriesGuard`] exposing safe
    /// accessors to the entries singleton. Replaces the
    /// `let _g = self.entries_mutex.lock_guard(); unsafe { self.entries.* }`
    /// pattern — the guard *is* the proof the SAFETY precondition holds.
    #[inline]
    pub fn entries_locked(&self) -> EntriesGuard {
        EntriesGuard { _lock: self.entries_mutex.lock_guard() }
    }

    pub fn entries_at(
        &mut self,
        index: allocators::IndexType,
        generation: Generation,
    ) -> Option<*mut EntriesOption> {
        // PORT NOTE: Zig fs.zig:613 does not lock here; in Rust we must, because every
        // `EntriesMap` method auto-refs the global `BSSMapInner` to `&mut self`, and a
        // concurrent `read_directory_with_iterator` (which *does* lock) would otherwise
        // alias that `&mut` — UB under Stacked Borrows. `EntriesGuard` holds
        // `entries_mutex` for the whole operation so the `&mut BSSMapInner` is
        // exclusive; it does not borrow `self`, so the `&mut self` calls below
        // (`readdir`, `read_directory_error`) remain unconstrained while held.
        let map = self.entries_locked();

        // PORT NOTE: `at_index` returns a raw `*mut EntriesOption` (matching Zig's
        // `*EntriesOption`). Form short-lived `&mut` only at each use site below;
        // never hand a `&'static mut` back to the caller.
        let existing_ptr = map.at_index(index)?;
        // SAFETY: `entries_mutex` held; no other `&mut` to this slot in scope.
        if let EntriesOption::Entries(entries) = unsafe { &mut *existing_ptr } {
            if entries.generation < generation {
                let dir_path = entries.dir;
                // PORT NOTE: capture raw ptrs to the in-place `DirEntry` fields, then
                // drop the short-lived `&mut` before re-borrowing `self` for
                // `readdir` / `read_directory_error` (Zig used `*DirEntry` directly).
                let entries_ptr: *mut DirEntry = &raw mut **entries;
                // SAFETY: derive `prev_map_ptr` FROM `entries_ptr` so both raw ptrs
                // share one provenance root. Writing `&mut entries.data` here would
                // call `Box::deref_mut` a second time, which under Stacked Borrows
                // retags the whole `DirEntry` and invalidates `entries_ptr` — making
                // the later `*entries_ptr = new_entry` UB. Zig's `existing.entries.*`
                // / `existing.entries.data` go through one `*DirEntry`; mirror that.
                let prev_map_ptr: *mut dir_entry::EntryMap =
                    unsafe { core::ptr::addr_of_mut!((*entries_ptr).data) };
                let handle = match bun_sys::open_dir_for_iteration(Fd::cwd(), dir_path) {
                    Ok(h) => h,
                    Err(err) => {
                        // SAFETY: `entries_mutex` held; sole access to this slot.
                        unsafe { (*prev_map_ptr).clear() };
                        return Some(
                            self.read_directory_error(Some(&map), dir_path, err.into())
                                .expect("unreachable"),
                        );
                    }
                };
                let handle_dir = bun_sys::Dir::from_fd(handle);
                // PORT NOTE: defer handle.close() → explicit close at exit points below.
                let new_entry = match self.readdir(
                    false,
                    // SAFETY: `entries_mutex` held; `readdir` does not touch
                    // `self.entries`, so this `&mut EntryMap` is unaliased.
                    Some(unsafe { &mut *prev_map_ptr }),
                    dir_path,
                    generation,
                    handle_dir,
                    (),
                ) {
                    Ok(e) => e,
                    Err(err) => {
                        // SAFETY: see above.
                        unsafe { (*prev_map_ptr).clear() };
                        handle_dir.close();
                        return Some(
                            self.read_directory_error(Some(&map), dir_path, err).expect("unreachable"),
                        );
                    }
                };
                // SAFETY: `entries_mutex` held; sole access to this slot.
                unsafe {
                    (*prev_map_ptr).clear();
                    *entries_ptr = new_entry;
                }
                handle_dir.close();
            }
        }

        map.at_index(index)
    }

    pub fn get_default_temp_dir() -> &'static [u8] {
        env_var::BUN_TMPDIR::get().unwrap_or_else(Self::platform_temp_dir)
    }

    pub fn need_to_close_files(&self) -> bool {
        if !FeatureFlags::STORE_FILE_DESCRIPTORS {
            return true;
        }

        #[cfg(windows)]
        {
            // 'false' is okay here because windows gives you a seemingly unlimited number of open
            // file handles, while posix has a lower limit.
            //
            // This limit does not extend to the C-Runtime which is only 512 to 8196 or so,
            // but we know that all resolver-related handles are not C-Runtime handles because
            // `setMaxFd` on Windows (besides being a no-op) only takes in `HANDLE`.
            //
            // Handles are automatically closed when the process exits as stated here:
            // https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process
            // But in a crazy experiment to find the upper-bound of the number of open handles,
            // I found that opening upwards of 500k to a million handles in a single process
            // would cause the process to hang while closing. This might just be Windows slowly
            // closing the handles, not sure. This is likely not something to worry about.
            //
            // If it is decided that not closing files ever is a bad idea. This should be
            // replaced with some form of intelligent count of how many files we opened.
            // On POSIX we can get away with measuring how high `fd` gets because it typically
            // assigns these descriptors in ascending order (1 2 3 ...). Windows does not
            // guarantee this.
            return false;
        }

        #[cfg(not(windows))]
        {
            // If we're not near the max amount of open files, don't worry about it.
            // SAFETY: MAX_FD is a global mutated only on the resolver thread
            !(self.file_limit > 254 && self.file_limit > (unsafe { MAX_FD.read() } as usize + 1) * 2)
        }
    }

    /// Returns `true` if an entry was removed
    pub fn bust_entries_cache(&mut self, file_path: &[u8]) -> bool {
        // PORT NOTE: Zig fs.zig:778 does not lock here; in Rust we must, because
        // `EntriesMap::remove` auto-refs the global `BSSMapInner` to `&mut self`, and a
        // concurrent `read_directory_with_iterator` (which *does* lock) would otherwise
        // alias that `&mut` — UB. `&mut self` alone proves nothing cross-thread since
        // `EntriesMap` is a ZST handle over a process-global singleton.
        self.entries_locked().remove(file_path)
    }

    // Always try to max out how many files we can keep open
    pub fn adjust_ulimit() -> Result<usize, bun_core::Error> {
        #[cfg(not(unix))]
        {
            return Ok(usize::MAX);
        }

        #[cfg(unix)]
        {
            let resource = bun_sys::posix::RlimitResource::NOFILE;
            let mut lim = bun_sys::posix::getrlimit(resource)?;
            // SAFETY: single init-time write
            unsafe { limit::HANDLES_BEFORE.write(lim) };

            // Cap at 1<<20 to match Node.js. On macOS the hard limit defaults to
            // RLIM_INFINITY; raising soft anywhere near INT_MAX breaks child processes
            // that read the limit into an int.
            // https://github.com/nodejs/node/blob/v25.9.0/src/node.cc#L621-L627
            // https://github.com/postgres/postgres/blob/fee2b3ea2ecd0da0c88832b37ac0d9f6b3bfb9a9/src/backend/storage/file/fd.c#L1072
            // https://discord.com/channels/876711213126520882/1316342194176790609/1318175562367242271
            let target = {
                // musl has extremely low defaults, so ensure at least 163840 there.
                #[cfg(target_env = "musl")]
                let max = lim.max.max(163840);
                #[cfg(not(target_env = "musl"))]
                let max = lim.max;
                max.min(1 << 20)
            };
            if lim.cur < target {
                let mut raised = lim;
                raised.cur = target;
                // Don't lower the hard limit (Node only touches rlim_cur). The @max
                // is for the musl branch above, which may raise past the current hard.
                raised.max = lim.max.max(target);
                if bun_sys::posix::setrlimit(resource, raised).is_ok() {
                    lim.cur = raised.cur;
                }
            }

            limit::HANDLES.store(
                usize::try_from(lim.cur).expect("int cast"),
                core::sync::atomic::Ordering::Relaxed,
            );
            Ok(usize::try_from(lim.cur).expect("int cast"))
        }
    }

    pub fn init(cwd: &'static [u8]) -> RealFS {
        let file_limit = Self::adjust_ulimit().expect("unreachable");

        // Touch the EntriesOptionMap singleton so it's initialized.
        let _ = entries_option_map();

        RealFS {
            entries_mutex: Mutex::default(),
            entries: EntriesMap::new(),
            cwd,
            file_limit,
            file_quota: file_limit,
        }
    }
}

#[derive(strum::IntoStaticStr, Debug)]
pub enum ModKeyError {
    Unusable,
}

#[derive(Default, Clone, Copy)]
pub struct ModKey {
    pub inode: u64, // TODO(port): std.fs.File.INode equivalent
    pub size: u64,
    pub mtime: i128,
    pub mode: u32, // TODO(port): std.fs.File.Mode equivalent
}

thread_local! {
    static HASH_NAME_BUF: RefCell<[u8; 1024]> = const { RefCell::new([0u8; 1024]) };
}

impl ModKey {
    pub const SAFETY_GAP: i32 = 3;

    pub fn hash_name(&self, basename: &[u8]) -> Result<&'static [u8], bun_core::Error> {
        // TODO(port): returns slice into threadlocal buffer; lifetime is unsound — Phase B should take caller buf
        let hex_int = self.hash();

        HASH_NAME_BUF.with_borrow_mut(|buf| {
            let len = buf.len();
            let mut cursor = &mut buf[..];
            write!(&mut cursor, "{}-{:x}", BStr::new(basename), hex_int)
                .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
            let written = len - cursor.len();
            // SAFETY: threadlocal buffer outlives caller's use (matches Zig pattern)
            Ok(unsafe { core::slice::from_raw_parts(buf.as_ptr(), written) })
        })
    }

    pub fn hash(&self) -> u64 {
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

    pub fn generate(_: &mut RealFS, _: &[u8], file: &bun_sys::File) -> Result<ModKey, bun_core::Error> {
        let stat = file.stat()?;

        const NS_PER_S: i128 = 1_000_000_000;
        // PORT NOTE: `bun_sys::Stat` is `libc::stat`; Zig's `std.fs.File.stat()` returned a
        // normalized struct with `mtime: i128` ns. Reconstruct from `st_mtime` (sec) +
        // `st_mtime_nsec` (ns) where available.
        #[cfg(target_os = "linux")]
        let mtime: i128 = (stat.st_mtime as i128) * NS_PER_S + stat.st_mtime_nsec as i128;
        #[cfg(target_os = "macos")]
        let mtime: i128 =
            (stat.st_mtime as i128) * NS_PER_S + stat.st_mtime_nsec as i128;
        #[cfg(windows)]
        let mtime: i128 = (stat.mtim.sec as i128) * NS_PER_S + stat.mtim.nsec as i128;
        #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
        let mtime: i128 = (stat.st_mtime as i128) * NS_PER_S;
        let seconds = mtime / NS_PER_S;

        // We can't detect changes if the file system zeros out the modification time
        if seconds == 0 && NS_PER_S == 0 {
            return Err(bun_core::err!("Unusable"));
        }

        // Don't generate a modification key if the file is too new
        let now = bun_core::time::nano_timestamp();
        let now_seconds = now / NS_PER_S;
        // PORT NOTE: Zig had `seconds > seconds` (always false) — preserved
        #[allow(clippy::eq_op)]
        if seconds > seconds || (seconds == now_seconds && mtime > now) {
            return Err(bun_core::err!("Unusable"));
        }

        Ok(ModKey {
            inode: stat.st_ino as u64,
            size: stat.st_size as u64,
            mtime,
            mode: stat.st_mode as u32,
            // .uid = stat.
        })
    }
}

impl RealFS {
    pub fn mod_key_with_file(
        &mut self,
        path: &[u8],
        file: &bun_sys::File,
    ) -> Result<ModKey, bun_core::Error> {
        ModKey::generate(self, path, file)
    }

    pub fn mod_key(&mut self, path: &[u8]) -> Result<ModKey, bun_core::Error> {
        // TODO(port): std.fs.cwd().openFile — bun_sys::open_file
        let file = bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)?;
        let need_close = self.need_to_close_files();
        let result = self.mod_key_with_file(path, &file);
        if need_close {
            let _ = bun_sys::close(file.handle());
        }
        result
    }
}

pub enum EntriesOption {
    Entries(Box<DirEntry>),
    Err(dir_entry::Err),
}

// SAFETY: ARENA — `EntriesOption` holds a `Box<DirEntry>` whose `data` map stores
// `*mut Entry` into the BSSList singleton. All access is serialized through
// `RealFS.entries_mutex`; Zig used a `threadlocal var instance`. The raw-pointer
// fields are the only thing blocking auto-Sync (needed for `bss_map_inner!`'s
// `SyncUnsafeCell` static).
unsafe impl Sync for EntriesOption {}
unsafe impl Send for EntriesOption {}

// SAFETY: same ARENA contract as `EntriesOption` — `Entry` lives in the
// `BSSList` singleton; `*mut Entry` raw pointers are the only !Send/!Sync field.
unsafe impl Sync for Entry {}
unsafe impl Send for Entry {}

#[repr(u8)]
pub(crate) enum EntriesOptionTag {
    Entries,
    Err,
}

// EntriesOption::Map — see EntriesOptionMap type alias above
// This custom map implementation:
// - Preallocates a fixed amount of directory name space
// - Doesn't store directory names which don't exist.

pub(crate) struct TmpfilePosix {
    pub fd: Fd,
    pub dir_fd: Fd,
}

impl Default for TmpfilePosix {
    fn default() -> Self {
        Self { fd: Fd::INVALID, dir_fd: Fd::INVALID }
    }
}

impl TmpfilePosix {
    #[inline]
    pub(crate) fn dir(&self) -> bun_sys::Dir {
        bun_sys::Dir::from_fd(self.dir_fd)
    }

    #[inline]
    pub(crate) fn file(&self) -> bun_sys::File {
        bun_sys::File::from_fd(self.fd)
    }

    pub(crate) fn close(&mut self) {
        if self.fd.is_valid() {
            let _ = bun_sys::close(self.fd);
            self.fd = Fd::INVALID;
        }
    }

    pub(crate) fn create(&mut self, _: &mut RealFS, name: &ZStr) -> Result<(), bun_core::Error> {
        // We originally used a temporary directory, but it caused EXDEV.
        let dir_fd = Fd::cwd();
        self.dir_fd = dir_fd;

        let flags = bun_sys::O::CREAT | bun_sys::O::RDWR | bun_sys::O::CLOEXEC;
        self.fd = bun_sys::openat(dir_fd, name, flags, bun_sys::S::IRWXU as bun_sys::Mode)?;
        Ok(())
    }

    pub(crate) fn promote_to_cwd(
        &mut self,
        from_name: &ZStr,
        name: &ZStr,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(self.fd != Fd::INVALID);
        debug_assert!(self.dir_fd != Fd::INVALID);

        bun_sys::move_file_z_with_handle(self.fd, self.dir_fd, from_name, Fd::cwd(), name)?;
        self.close();
        Ok(())
    }

    pub(crate) fn close_and_delete(&mut self, name: &ZStr) {
        self.close();

        #[cfg(not(target_os = "linux"))]
        {
            if self.dir_fd == Fd::INVALID {
                return;
            }
            let _ = bun_sys::unlinkat(self.dir_fd, name);
        }
        #[cfg(target_os = "linux")]
        {
            let _ = name;
        }
    }
}

pub(crate) struct TmpfileWindows {
    pub fd: Fd,
    pub existing_path: Box<[u8]>,
}

impl Default for TmpfileWindows {
    fn default() -> Self {
        Self { fd: Fd::INVALID, existing_path: Box::default() }
    }
}

impl TmpfileWindows {
    #[inline]
    pub(crate) fn dir(&self) -> bun_sys::Dir {
        // TODO(port): Fs.FileSystem.instance.tmpdir() — needs &mut FileSystem
        // SAFETY: `instance()` is the process-lifetime singleton (Zig `*FileSystem`);
        // `&mut` scoped to this call only (no `&'static mut` escapes).
        unsafe { (*FileSystem::instance()).tmpdir().expect("tmpdir") }
    }

    #[inline]
    pub(crate) fn file(&self) -> bun_sys::File {
        bun_sys::File::from_fd(self.fd)
    }

    pub(crate) fn close(&mut self) {
        if self.fd.is_valid() {
            let _ = bun_sys::close(self.fd);
            self.fd = Fd::INVALID;
        }
    }

    pub(crate) fn create(&mut self, rfs: &mut RealFS, name: &ZStr) -> Result<(), bun_core::Error> {
        // `open_tmp_dir()` opens a *fresh* directory handle every call (it is not the
        // cached `FileSystem::tmpdir()`), and `bun_sys::Dir` has no `Drop`, so without an
        // explicit close the kernel HANDLE leaks on both success and the `?` early-returns
        // below. Zig has the same leak (fs.zig:709-717); fixed here.
        let tmp_dir = rfs.open_tmp_dir()?;
        let tmp_dir_fd = tmp_dir.fd();
        scopeguard::defer! {
            let _ = bun_sys::close(tmp_dir_fd);
        }

        let flags = bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::CLOEXEC;

        self.fd = bun_sys::openat(tmp_dir_fd, name, flags, 0)?;
        let mut buf = PathBuffer::uninit();
        let existing_path = bun_sys::get_fd_path(self.fd, &mut buf)?;
        self.existing_path = Box::<[u8]>::from(&*existing_path);
        Ok(())
    }

    #[cfg(windows)]
    pub fn promote_to_cwd(
        &mut self,
        _from_name: &CStr,
        name: &ZStr,
    ) -> Result<(), bun_core::Error> {
        let mut existing_buf = WPathBuffer::uninit();
        let mut new_buf = WPathBuffer::uninit();
        self.close();
        let existing = strings::paths::to_extended_path_normalized(&mut new_buf, &self.existing_path);
        let new = if bun_paths::is_absolute_windows(name.as_bytes()) {
            strings::paths::to_extended_path_normalized(&mut existing_buf, name.as_bytes())
        } else {
            strings::paths::to_w_path_normalized(&mut existing_buf, name.as_bytes())
        };
        if cfg!(debug_assertions) {
            debug!("moveFileExW({}, {})", bun_fmt::utf16(existing), bun_fmt::utf16(new));
        }

        // SAFETY: `existing`/`new` are NUL-terminated WTF-16 paths backed by
        // stack `WPathBuffer`s alive for this frame.
        if unsafe {
            bun_sys::windows::kernel32::MoveFileExW(
                existing.as_ptr(),
                new.as_ptr(),
                bun_sys::windows::MOVEFILE_COPY_ALLOWED
                    | bun_sys::windows::MOVEFILE_REPLACE_EXISTING
                    | bun_sys::windows::MOVEFILE_WRITE_THROUGH,
            )
        } == bun_sys::windows::FALSE
        {
            use bun_sys::windows::Win32ErrorUnwrap as _;
            bun_sys::windows::Win32Error::get().unwrap()?;
        }
        Ok(())
    }

    #[cfg(not(windows))]
    pub(crate) fn promote_to_cwd(&mut self, _: &CStr, _: &ZStr) -> Result<(), bun_core::Error> {
        unreachable!()
    }

    pub(crate) fn close_and_delete(&mut self, _name: &CStr) {
        self.close();
    }
}

impl RealFS {
    pub fn open_dir(&self, unsafe_dir_string: &[u8]) -> Result<bun_sys::Dir, bun_core::Error> {
        // fs.zig:944-955 — on Windows this must go through
        // `openDirAtWindowsA(invalid_fd, path, .{ .iterable = true, .no_follow = false,
        // .read_only = true })` so the resulting handle has FILE_LIST_DIRECTORY +
        // FILE_DIRECTORY_FILE and can be iterated by `readdir`. The generic
        // `open_a(.., O::DIRECTORY, 0)` path doesn't work here because on Windows
        // `O::DIRECTORY == 0` (sys/lib.rs), so the `(flags & O::DIRECTORY) != 0`
        // dispatch in `openat_windows_impl` is never taken and the path is opened
        // via the *file* NtCreateFile branch.
        #[cfg(windows)]
        let dirfd = bun_sys::open_dir_at_windows_a(
            Fd::INVALID,
            unsafe_dir_string,
            bun_sys::WindowsOpenDirOptions {
                iterable: true,
                no_follow: false,
                read_only: true,
                ..Default::default()
            },
        );
        #[cfg(not(windows))]
        let dirfd = bun_sys::open_a(unsafe_dir_string, bun_sys::O::DIRECTORY, 0);

        let fd = dirfd?;
        Ok(bun_sys::Dir::from_fd(fd))
    }

    fn readdir<I: DirEntryIterator>(
        &mut self,
        store_fd: bool,
        prev_map: Option<&mut dir_entry::EntryMap>,
        dir_: &'static [u8],
        generation: Generation,
        handle: bun_sys::Dir,
        iterator: I,
    ) -> Result<DirEntry, bun_core::Error> {
        let handle_fd = handle.fd();
        let mut iter = bun_sys::iterate_dir(handle_fd);
        let mut dir = DirEntry::init(dir_, generation);
        // errdefer dir.deinit() — DirEntry: Drop frees data on `?`
        let mut prev_map = prev_map;

        if store_fd {
            FileSystem::set_max_fd(handle_fd.native());
            dir.fd = handle_fd;
        }

        while let Some(entry_) = iter.next()? {
            debug!("readdir entry {}", BStr::new(entry_.name.slice_u8()));

            dir.add_entry(prev_map.as_deref_mut(), &entry_, &iterator)?;
        }

        debug!(
            "readdir({}, {}) = {}",
            print_handle(handle_fd),
            BStr::new(dir_),
            dir.data.count()
        );

        Ok(dir)
    }

    fn read_directory_error(
        &mut self,
        entries: Option<&EntriesGuard>,
        dir: &[u8],
        err: bun_core::Error,
    ) -> Result<*mut EntriesOption, AllocError> {
        if FeatureFlags::ENABLE_ENTRY_CACHE {
            // Caller holds `entries_mutex` exactly when `ENABLE_ENTRY_CACHE` is true
            // (both call paths gate the lock on the same flag), so the guard is
            // always `Some` here.
            let entries = entries.expect("caller holds entries_mutex when ENABLE_ENTRY_CACHE");
            let mut get_or_put_result = entries.get_or_put(dir)?;
            if err == bun_core::err!("ENOENT") || err == bun_core::err!("FileNotFound") {
                entries.mark_not_found(get_or_put_result);
                return Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
                    slot.write(EntriesOption::Err(dir_entry::Err {
                        original_err: err,
                        canonical_error: err,
                    }));
                    // PORT NOTE: threadlocal storage outlives caller (matches Zig);
                    // return raw `*mut` — caller forms a short-lived `&mut` at use site.
                    slot.as_mut_ptr()
                }));
            } else {
                let opt = entries.put(
                    &mut get_or_put_result,
                    EntriesOption::Err(dir_entry::Err {
                        original_err: err,
                        canonical_error: err,
                    }),
                )?;
                return Ok(opt);
            }
        }

        Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
            slot.write(EntriesOption::Err(dir_entry::Err {
                original_err: err,
                canonical_error: err,
            }));
            // PORT NOTE: threadlocal storage outlives caller (matches Zig);
            // return raw `*mut` — caller forms a short-lived `&mut` at use site.
            slot.as_mut_ptr()
        }))
    }

    pub fn read_directory(
        &mut self,
        dir_: &[u8],
        handle_: Option<bun_sys::Dir>,
        generation: Generation,
        store_fd: bool,
    ) -> Result<*mut EntriesOption, bun_core::Error> {
        self.read_directory_with_iterator(dir_, handle_, generation, store_fd, ())
    }

    // One of the learnings here
    //
    //   Closing file descriptors yields significant performance benefits on Linux
    //
    // It was literally a 300% performance improvement to bundling.
    // https://twitter.com/jarredsumner/status/1655787337027309568
    // https://twitter.com/jarredsumner/status/1655714084569120770
    // https://twitter.com/jarredsumner/status/1655464485245845506
    /// Caller borrows the returned EntriesOption. When `FeatureFlags::ENABLE_ENTRY_CACHE` is `false`,
    /// it is not safe to store this pointer past the current function call.
    ///
    /// PORT NOTE: returns a raw `*mut EntriesOption` (matching Zig's `*EntriesOption`), not
    /// `&'static mut`. Handing out `&'static mut` from a safe `pub fn` would let two callers
    /// (sequential or across the resolver thread pool) each hold a live `&mut` aliasing the
    /// same BSSMap slot — instant UB under Rust's `&mut` noalias model. Callers form a
    /// short-lived `&mut` at the use site under whatever serialization they already perform.
    pub fn read_directory_with_iterator<I: DirEntryIterator>(
        &mut self,
        dir_maybe_trail_slash: &[u8],
        maybe_handle: Option<bun_sys::Dir>,
        generation: Generation,
        store_fd: bool,
        iterator: I,
    ) -> Result<*mut EntriesOption, bun_core::Error> {
        let mut dir = strings::paths::without_trailing_slash_windows_path(dir_maybe_trail_slash);

        crate::Resolver::assert_valid_cache_key(dir);
        let mut cache_result: Option<allocators::Result> = None;
        // PORT NOTE: Zig `defer self.entries_mutex.unlock()`. `EntriesGuard` holds the
        // mutex by raw pointer (no borrow of `self`), so the `&mut self` calls below
        // (`open_dir`, `readdir`, `read_directory_error`) remain unconstrained while
        // the lock is held.
        let entries_guard = if FeatureFlags::ENABLE_ENTRY_CACHE {
            Some(self.entries_locked())
        } else {
            None
        };

        let mut in_place: Option<*mut DirEntry> = None;

        if let Some(entries) = entries_guard.as_ref() {
            cache_result = Some(entries.get_or_put(dir)?);

            let cr = cache_result.as_ref().unwrap();
            if cr.has_checked_if_exists() {
                if let Some(cached_result) = entries.at_index(cr.index) {
                    // SAFETY: `entries_mutex` held; form a short-lived `&mut` for the
                    // match only — the raw `*mut` is what escapes to the caller.
                    match unsafe { &mut *cached_result } {
                        EntriesOption::Err(_) => return Ok(cached_result),
                        EntriesOption::Entries(e) if e.generation >= generation => {
                            return Ok(cached_result);
                        }
                        EntriesOption::Entries(e) => {
                            in_place = Some(&raw mut **e);
                        }
                    }
                } else if cr.status == allocators::ItemStatus::NotFound && generation == 0 {
                    return Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
                        slot.write(EntriesOption::Err(dir_entry::Err {
                            original_err: bun_core::err!("ENOENT"),
                            canonical_error: bun_core::err!("ENOENT"),
                        }));
                        // PORT NOTE: threadlocal storage outlives caller; return raw `*mut`.
                        slot.as_mut_ptr()
                    }));
                }
            }
        }

        let had_handle = maybe_handle.is_some();
        let handle = match maybe_handle {
            Some(h) => h,
            None => match self.open_dir(dir) {
                Ok(h) => h,
                Err(err) => return Ok(self.read_directory_error(entries_guard.as_ref(), dir, err)?),
            },
        };

        let should_close_handle = !had_handle && (!store_fd || self.need_to_close_files());
        // PORT NOTE: Zig `defer { if (maybe_handle == null and (!store_fd or fs.needToCloseFiles())) handle.close(); }`
        // runs on EVERY exit path including the `try`s below — defer the close so we never
        // leak the directory FD when `DirnameStore::append` / `self.entries.put` early-return via `?`.
        // `Dir` is `Copy`, so the `move` closure captures a copy of `handle`; uses below remain valid.
        scopeguard::defer! {
            if should_close_handle {
                handle.close();
            }
        }

        // if we get this far, it's a real directory, so we can just store the dir name.
        let dir: &'static [u8] = if !had_handle {
            if let Some(existing) = in_place {
                // SAFETY: in_place points to BSSMap-owned DirEntry
                unsafe { (*existing).dir }
            } else {
                DirnameStore::instance().append(dir_maybe_trail_slash)?
            }
        } else {
            // PORT NOTE: Zig stored the caller-provided slice directly (no lifetime system).
            // Intern into DirnameStore so the cache entry never dangles — `append` is a
            // bump-pointer copy and dedups against the singleton, so cost is bounded.
            DirnameStore::instance().append(dir)?
        };

        // Cache miss: read the directory entries
        let prev = in_place.map(|p| {
            // SAFETY: BSSMap-owned, no aliasing here
            unsafe { &mut (*p).data }
        });
        let mut entries = match self.readdir(store_fd, prev, dir, generation, handle, iterator) {
            Ok(e) => e,
            Err(err) => {
                if let Some(existing) = in_place {
                    // SAFETY: see above
                    unsafe { (*existing).data.clear() };
                }
                return Ok(self.read_directory_error(entries_guard.as_ref(), dir, err)?);
            }
        };

        if let Some(map) = entries_guard.as_ref() {
            if store_fd && !entries.fd.is_valid() {
                entries.fd = handle.fd();
            }

            // PORT NOTE: Zig stores `EntriesOption{ .entries: *DirEntry }` (raw pointer), so
            // `put` is a plain pointer overwrite with no drop glue. In Rust the slot owns a
            // `Box<DirEntry>`; calling `put` again on an already-populated slot would drop the
            // old Box (use-after-free if `in_place` aliases it) or leak it. Split the two cases:
            //  - in_place Some → write through the existing pointer, return the existing slot.
            //  - in_place None → fresh Box::new, hand it to `put`.
            let out = match in_place {
                Some(p) => {
                    // SAFETY: `p` points at the `DirEntry` inside the `Box<DirEntry>` already
                    // owned by `self.entries` at `cache_result.index`; no other borrow exists
                    // (entries_mutex held). Clearing the stale map then assigning the freshly
                    // built entries struct in place — no drop of the owning Box.
                    unsafe {
                        (*p).data.clear();
                        *p = entries;
                    }
                    let idx = cache_result.as_ref().unwrap().index;
                    map.at_index(idx)
                        .expect("in_place entry must exist in BSSMap")
                }
                None => {
                    // PORT NOTE: Zig used bun.default_allocator.create(DirEntry); EntriesOption owns Box<DirEntry>
                    let mut boxed = Box::new(DirEntry::init(dir, generation));
                    *boxed = entries;
                    let result = EntriesOption::Entries(boxed);
                    map.put(cache_result.as_mut().unwrap(), result)?
                }
            };

            return Ok(out);
        }

        Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
            slot.write(EntriesOption::Entries(Box::new(entries)));
            // PORT NOTE: threadlocal storage outlives caller; return raw `*mut`.
            slot.as_mut_ptr()
        }))
    }

    fn read_file_error(&self, _: &[u8], _: bun_core::Error) {}

    pub fn read_file_with_handle<'p, 'buf, const USE_SHARED_BUFFER: bool, const STREAM: bool>(
        &mut self,
        path: &'p [u8],
        size_: Option<usize>,
        file: bun_sys::File,
        shared_buffer: &'buf mut MutableString,
    ) -> Result<PathContentsPair<'p, 'buf>, bun_core::Error> {
        self.read_file_with_handle_and_allocator::<USE_SHARED_BUFFER, STREAM>(
            path,
            size_,
            file,
            shared_buffer,
        )
    }

    pub fn read_file_with_handle_and_allocator<'p, 'buf, const USE_SHARED_BUFFER: bool, const STREAM: bool>(
        &mut self,
        path: &'p [u8],
        size_hint: Option<usize>,
        std_file: bun_sys::File,
        shared_buffer: &'buf mut MutableString,
    ) -> Result<PathContentsPair<'p, 'buf>, bun_core::Error> {
        // PORT NOTE: allocator param dropped (global mimalloc)
        FileSystem::set_max_fd(std_file.handle().native());
        let file = std_file;

        // PORT NOTE: in the `USE_SHARED_BUFFER` branch, `file_contents` borrows
        // `shared_buffer.list`; tracked as a raw (ptr, len) pair so borrowck doesn't tie the
        // slice to `&mut shared_buffer` across the read/truncate/grow loop. The final slice is
        // reconstituted with `from_raw_parts` (matches Zig's `[]const u8` return). The
        // non-shared-buffer branch owns its allocation and returns early with `Cow::Owned`.
        // Definite-init: the read `loop` below assigns both before any `break`/read; the
        // `else` (non-shared-buffer) arm always early-returns.
        let mut file_contents_ptr: *const u8;
        let mut file_contents_len: usize;
        // When we're serving a JavaScript-like file over HTTP, we do not want to cache the contents in memory
        // This imposes a performance hit because not reading from disk is faster than reading from disk
        // Part of that hit is allocating a temporary buffer to store the file contents in
        // As a mitigation, we can just keep one buffer forever and re-use it for the parsed files
        if USE_SHARED_BUFFER {
            shared_buffer.reset();

            // Skip the extra file.stat() call when possible
            let mut size = match size_hint {
                Some(s) => s,
                None => match file.get_end_pos() {
                    Ok(s) => s,
                    Err(err) => {
                        let err: bun_core::Error = err.into();
                        self.read_file_error(path, err);
                        return Err(err);
                    }
                },
            };
            debug!("stat({}) = {}", file.handle(), size);

            // Skip the pread call for empty files
            // Otherwise will get out of bounds errors
            // plus it's an unnecessary syscall
            if size == 0 {
                if USE_SHARED_BUFFER {
                    shared_buffer.reset();
                    return Ok(PathContentsPair { path: Path::init(path), contents: Cow::Borrowed(b"") });
                } else {
                    return Ok(PathContentsPair { path: Path::init(path), contents: Cow::Borrowed(b"") });
                }
            }

            let mut bytes_read: u64 = 0;
            shared_buffer.grow_by(size + 1)?;
            // PORT NOTE: Zig `ArrayList.expandToCapacity()` — `Vec<u8>` has no equivalent.
            // SAFETY: u8 is always-init; `set_len(capacity)` only exposes uninit-but-valid bytes
            // that `read_all` immediately overwrites before any read.
            unsafe { shared_buffer.list.set_len(shared_buffer.list.capacity()) };

            // if you press save on a large file we might not read all the
            // bytes in the first few pread() calls. we only handle this on
            // stream because we assume that this only realistically happens
            // during HMR
            loop {
                // We use pread to ensure if the file handle was open, it doesn't seek from the last position
                let read_count = match file.read_all(&mut shared_buffer.list[bytes_read as usize..]) {
                    Ok(n) => n,
                    Err(err) => {
                        let err: bun_core::Error = err.into();
                        self.read_file_error(path, err);
                        return Err(err);
                    }
                };
                shared_buffer.list.truncate(read_count + bytes_read as usize);
                file_contents_ptr = shared_buffer.list.as_ptr();
                file_contents_len = shared_buffer.list.len();
                debug!("read({}, {}) = {}", file.handle(), size, read_count);

                if STREAM {
                    // check again that stat() didn't change the file size
                    // another reason to only do this when stream
                    let new_size = match file.get_end_pos() {
                        Ok(s) => s,
                        Err(err) => {
                            let err: bun_core::Error = err.into();
                            self.read_file_error(path, err);
                            return Err(err);
                        }
                    };

                    bytes_read += read_count as u64;

                    // don't infinite loop is we're still not reading more
                    if read_count == 0 {
                        break;
                    }

                    if (bytes_read as usize) < new_size {
                        shared_buffer.grow_by(new_size - size)?;
                        // PORT NOTE: Zig `ArrayList.expandToCapacity()` — `Vec<u8>` has no equivalent.
            // SAFETY: u8 is always-init; `set_len(capacity)` only exposes uninit-but-valid bytes
            // that `read_all` immediately overwrites before any read.
            unsafe { shared_buffer.list.set_len(shared_buffer.list.capacity()) };
                        size = new_size;
                        continue;
                    }
                }
                break;
            }

            if shared_buffer.list.capacity() > file_contents_len {
                // SAFETY: capacity > len, so writing one byte past len is in-bounds
                unsafe {
                    *shared_buffer.list.as_mut_ptr().add(file_contents_len) = 0;
                }
            }

            // SAFETY: see PORT NOTE above — `file_contents_ptr` borrows `shared_buffer.list`.
            let file_contents: &[u8] =
                unsafe { core::slice::from_raw_parts(file_contents_ptr, file_contents_len) };
            if let Some(bom) = BOM::detect(file_contents) {
                debug!("Convert {} BOM", bom.tag_name());
                // PORT NOTE: Zig passed `&shared_buffer.list` and the returned slice aliases it.
                // We pre-set `list.len` to the un-BOM'd payload length so the helper sees the
                // correct logical size (the read loop above truncated to `file_contents_len`).
                shared_buffer.list.truncate(file_contents_len);
                let converted = bom.remove_and_convert_to_utf8_without_dealloc(&mut shared_buffer.list);
                file_contents_ptr = converted.as_ptr();
                file_contents_len = converted.len();
            }
        } else {
            let mut initial_buf = [0u8; 16384];

            // Optimization: don't call stat() unless the file is big enough
            // that we need to dynamically allocate memory to read it.
            let initial_read: &[u8] = if size_hint.is_none() {
                let buf: &mut [u8] = &mut initial_buf;
                let read_count = match file.read_all(buf) {
                    Ok(n) => n,
                    Err(err) => {
                        let err: bun_core::Error = err.into();
                        self.read_file_error(path, err);
                        return Err(err);
                    }
                };
                if read_count + 1 < buf.len() {
                    // allocator.dupeZ — own the buffer; caller frees via PathContentsPair drop.
                    // PORT NOTE: Zig returned an allocator-owned `[:0]u8` and the caller freed it
                    // later; Rust returns `Cow::Owned` so the caller's drop frees it. The trailing
                    // NUL sentinel is not part of `contents` (matches Zig `[:0]`).
                    let mut allocation = vec![0u8; read_count + 1];
                    allocation[..read_count].copy_from_slice(&buf[..read_count]);
                    allocation[read_count] = 0;
                    allocation.truncate(read_count);

                    if let Some(bom) = BOM::detect(&allocation) {
                        debug!("Convert {} BOM", bom.tag_name());
                        allocation = bom.remove_and_convert_to_utf8_and_free(allocation);
                    }

                    return Ok(PathContentsPair {
                        path: Path::init(path),
                        contents: Cow::Owned(allocation),
                    });
                }

                &initial_buf[..read_count]
            } else {
                &initial_buf[..0]
            };

            // Skip the extra file.stat() call when possible
            let size = match size_hint {
                Some(s) => s,
                None => match file.get_end_pos() {
                    Ok(s) => s,
                    Err(err) => {
                        let err: bun_core::Error = err.into();
                        self.read_file_error(path, err);
                        return Err(err);
                    }
                },
            };
            debug!("stat({}) = {}", file.handle(), size);

            let mut buf = vec![0u8; size + 1];
            buf[..initial_read.len()].copy_from_slice(initial_read);

            if size == 0 {
                return Ok(PathContentsPair { path: Path::init(path), contents: Cow::Borrowed(b"") });
            }

            // stick a zero at the end
            buf[size] = 0;

            let read_count = match file.read_all(&mut buf[initial_read.len()..]) {
                Ok(n) => n,
                Err(err) => {
                    let err: bun_core::Error = err.into();
                    self.read_file_error(path, err);
                    return Err(err);
                }
            };
            let total = read_count + initial_read.len();
            debug!("read({}, {}) = {}", file.handle(), size, read_count);
            buf.truncate(total);

            if let Some(bom) = BOM::detect(&buf) {
                debug!("Convert {} BOM", bom.tag_name());
                buf = bom.remove_and_convert_to_utf8_and_free(buf);
            }

            return Ok(PathContentsPair { path: Path::init(path), contents: Cow::Owned(buf) });
        }

        // PORT NOTE: `file_contents_ptr` always equals `shared_buffer.list.as_ptr()` on every
        // shared-buffer path above (read loop and BOM rewrite both anchor at index 0), so we
        // re-derive the final slice safely from `shared_buffer` with the real `'buf` lifetime
        // instead of fabricating `'static` via `from_raw_parts`.
        debug_assert!(core::ptr::eq(file_contents_ptr, shared_buffer.list.as_ptr()));
        let _ = file_contents_ptr;
        let file_contents: &'buf [u8] = &shared_buffer.list[..file_contents_len];
        Ok(PathContentsPair { path: Path::init(path), contents: Cow::Borrowed(file_contents) })
    }

    pub fn kind_from_absolute(
        &mut self,
        absolute_path: &ZStr,
        existing_fd: Fd,
        store_fd: bool,
    ) -> Result<EntryCache, bun_core::Error> {
        let mut outpath = PathBuffer::uninit();

        let stat = bun_sys::lstat(absolute_path)?;
        let mut kind_ = bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode);
        let is_symlink = kind_ == bun_sys::FileKind::SymLink;
        let mut cache = EntryCache {
            kind: EntryKind::File,
            symlink: PathString::EMPTY,
            fd: Fd::INVALID,
        };
        let mut symlink: &[u8] = b"";

        if is_symlink {
            // TODO(port): existing_fd != 0 — Zig compared FD to integer 0; using is_valid()
            let file: Fd = if existing_fd.is_valid() {
                existing_fd
            } else if store_fd {
                bun_sys::open_file_absolute_z(absolute_path, bun_sys::OpenFlags::READ_ONLY)?.handle()
            } else {
                // PORT NOTE: Zig `bun.openFileForPath` (bun.zig:1900-1910) — O_PATH is
                // Linux-only; macOS/BSD use O_RDONLY. Both add O_NOCTTY|O_CLOEXEC.
                #[cfg(target_os = "linux")]
                let flags = bun_sys::O::PATH | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                #[cfg(not(target_os = "linux"))]
                let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                bun_sys::open(absolute_path, flags, 0)?
            };
            FileSystem::set_max_fd(file.native());

            // PORT NOTE: Zig `defer { if (...) file.close() else cache.fd = file }` runs on
            // BOTH success and error paths — use scopeguard so close-or-store happens even if
            // stat()/get_fd_path() return early with `?`.
            let need_to_close_files = self.need_to_close_files();
            let cache_ptr: *mut EntryCache = &raw mut cache;
            let _guard = scopeguard::guard(file, move |file| {
                if (!store_fd || need_to_close_files) && !existing_fd.is_valid() {
                    let _ = bun_sys::close(file);
                } else if FeatureFlags::STORE_FILE_DESCRIPTORS {
                    // SAFETY: `cache_ptr` points into a stack local that outlives this guard.
                    unsafe { (*cache_ptr).fd = file };
                }
            });

            let stat_ = bun_sys::fstat(*_guard)?;

            symlink = bun_sys::get_fd_path(*_guard, &mut outpath)?;

            kind_ = bun_sys::kind_from_mode(stat_.st_mode as bun_sys::Mode);
        }

        debug_assert!(kind_ != bun_sys::FileKind::SymLink);

        if kind_ == bun_sys::FileKind::Directory {
            cache.kind = EntryKind::Dir;
        } else {
            cache.kind = EntryKind::File;
        }
        if !symlink.is_empty() {
            cache.symlink = PathString::init(FilenameStore::instance().append(symlink)?);
        }

        Ok(cache)
    }

    pub fn kind(
        &mut self,
        dir_: &[u8],
        base: &[u8],
        existing_fd: Fd,
        store_fd: bool,
    ) -> Result<EntryCache, bun_core::Error> {
        let mut cache = EntryCache {
            kind: EntryKind::File,
            symlink: PathString::EMPTY,
            fd: Fd::INVALID,
        };

        let dir = dir_;
        let combo: [&[u8]; 2] = [dir, base];
        let mut outpath = PathBuffer::uninit();
        let entry_path = path_handler::join_abs_string_buf::<platform::Auto>(
            self.cwd,
            &mut outpath[..],
            &combo,
        );
        let entry_path_len = entry_path.len();

        outpath[entry_path_len + 1] = 0;
        outpath[entry_path_len] = 0;

        let absolute_path_c = ZStr::from_buf(&outpath[..], entry_path_len);

        #[cfg(windows)]
        {
            let file = bun_sys::get_file_attributes(absolute_path_c)
                .ok_or(bun_core::err!("FileNotFound"))?;
            // A Windows reparse point carries FILE_ATTRIBUTE_DIRECTORY iff
            // the link is a directory link (junctions always do; symlinks
            // do iff created with SYMBOLIC_LINK_FLAG_DIRECTORY; AppExec
            // links and file symlinks don't), so this is already the
            // correct `Entry.Kind` without following the chain.
            cache.kind = if file.is_directory { EntryKind::Dir } else { EntryKind::File };
            if !file.is_reparse_point {
                return Ok(cache);
            }

            // For the realpath, open the path and let the kernel follow
            // every hop, then `GetFinalPathNameByHandle` (same as libuv's
            // `uv_fs_realpath`). The previous manual readlink+join loop
            // resolved relative targets against `dirname(absolute_path_c)`,
            // but that path may itself contain unresolved intermediate
            // symlinks (e.g. with the isolated linker's global virtual
            // store, `node_modules/.bun/<pkg>` is a symlink into
            // `<cache>/links/`, and the dep symlinks inside point at
            // siblings via `..\..\<dep>-<hash>`). Windows resolves
            // relative reparse targets against the *real* parent, so the
            // join landed in the project-side `.bun/` instead of
            // `<cache>/links/`, the re-stat returned FileNotFound, the
            // error was swallowed at `Entry.kind`, and a directory symlink
            // was permanently misclassified as `.file` — surfacing as
            // EISDIR at module load time.
            use bun_sys::windows as w;
            let mut wbuf = bun_paths::w_path_buffer_pool::get();
            let wpath = strings::paths::to_kernel32_path(&mut *wbuf, absolute_path_c.as_bytes());
            // SAFETY: `wpath` is NUL-terminated WTF-16 backed by the pooled
            // `WPathBuffer`; null SECURITY_ATTRIBUTES / template handle are
            // documented-valid for `CreateFileW`.
            let handle = unsafe {
                w::kernel32::CreateFileW(
                    wpath.as_ptr(),
                    0,
                    w::FILE_SHARE_READ | w::FILE_SHARE_WRITE | w::FILE_SHARE_DELETE,
                    core::ptr::null_mut(),
                    w::OPEN_EXISTING,
                    // FILE_FLAG_BACKUP_SEMANTICS lets us open directories;
                    // omitting FILE_FLAG_OPEN_REPARSE_POINT makes Windows
                    // follow the full reparse chain to the final target.
                    w::FILE_FLAG_BACKUP_SEMANTICS,
                    core::ptr::null_mut(),
                )
            };
            // Dangling link / loop / EACCES: `cache.kind` is already set
            // from the link's own directory bit, which is correct for all
            // of those. `Entry.kind`/`Entry.symlink` swallow errors and
            // fall back to the `.file` placeholder anyway, so returning
            // the half-populated cache is strictly better than `try`.
            // Empty `cache.symlink` makes the resolver fall back to
            // `parent.abs_real_path + base`.
            if handle == w::INVALID_HANDLE_VALUE {
                return Ok(cache);
            }
            scopeguard::defer! {
                // SAFETY: `handle` ≠ INVALID_HANDLE_VALUE (checked above).
                let _ = unsafe { w::CloseHandle(handle) };
            }

            let mut info: w::BY_HANDLE_FILE_INFORMATION =
                // SAFETY: all-zero is a valid BY_HANDLE_FILE_INFORMATION (POD)
                unsafe { bun_core::ffi::zeroed_unchecked() };
            // SAFETY: `handle` is a valid file handle for the scope.
            if unsafe { w::GetFileInformationByHandle(handle, &mut info) } != 0 {
                cache.kind = if info.dwFileAttributes & w::FILE_ATTRIBUTE_DIRECTORY != 0 {
                    EntryKind::Dir
                } else {
                    EntryKind::File
                };
            }

            let mut buf2 = bun_paths::path_buffer_pool::get();
            // `Fd` packs the kernel handle into its `u64` backing on Windows;
            // round-trip via `usize` (HANDLE is pointer-sized).
            match bun_sys::get_fd_path(Fd::from_native(handle as usize as u64), &mut *buf2) {
                bun_sys::Result::Ok(real) => {
                    cache.symlink = PathString::init(FilenameStore::instance().append(real)?);
                }
                bun_sys::Result::Err(_) => {}
            }
            return Ok(cache);
        }

        #[cfg(not(windows))]
        {
            let stat = bun_sys::lstat(absolute_path_c)?;
            let mut file_kind = bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode);
            let is_symlink = file_kind == bun_sys::FileKind::SymLink;

            let mut symlink: &[u8] = b"";

            if is_symlink {
                let file: Fd = if let Some(valid) = existing_fd.unwrap_valid() {
                    valid
                } else if store_fd {
                    bun_sys::open_file_absolute_z(absolute_path_c, bun_sys::OpenFlags::READ_ONLY)?
                        .handle()
                } else {
                    // PORT NOTE: Zig `bun.openFileForPath` (bun.zig:1900-1910) — O_PATH is
                    // Linux-only; macOS/BSD use O_RDONLY. Both add O_NOCTTY|O_CLOEXEC.
                    #[cfg(target_os = "linux")]
                    let flags = bun_sys::O::PATH | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                    #[cfg(not(target_os = "linux"))]
                    let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                    bun_sys::open(absolute_path_c, flags, 0)?
                };
                FileSystem::set_max_fd(file.native());

                // PORT NOTE: Zig `defer { if (...) file.close() else cache.fd = file }` runs on
                // BOTH success and error paths — use scopeguard so close-or-store happens even if
                // stat()/get_fd_path() return early with `?`.
                let need_to_close_files = self.need_to_close_files();
                let cache_ptr: *mut EntryCache = &raw mut cache;
                let _guard = scopeguard::guard(file, move |file| {
                    if (!store_fd || need_to_close_files) && !existing_fd.is_valid() {
                        let _ = bun_sys::close(file);
                    } else if FeatureFlags::STORE_FILE_DESCRIPTORS {
                        // SAFETY: `cache_ptr` points into a stack local that outlives this guard.
                        unsafe { (*cache_ptr).fd = file };
                    }
                });

                let file_stat = bun_sys::fstat(*_guard)?;
                symlink = bun_sys::get_fd_path(*_guard, &mut outpath)?;
                file_kind = bun_sys::kind_from_mode(file_stat.st_mode as bun_sys::Mode);
            }

            debug_assert!(file_kind != bun_sys::FileKind::SymLink);

            if file_kind == bun_sys::FileKind::Directory {
                cache.kind = EntryKind::Dir;
            } else {
                cache.kind = EntryKind::File;
            }
            if !symlink.is_empty() {
                cache.symlink = PathString::init(FilenameStore::instance().append(symlink)?);
            }

            Ok(cache)
        }
    }

    //         // Stores the file entries for directories we've listed before
    // entries_mutex: std.Mutex
    // entries      map[string]entriesOrErr

    // // If true, do not use the "entries" cache
    // doNotCacheEntries bool
}

pub(crate) type Implementation = RealFS;
// pub const Implementation = switch (build_target) {
// .wasi, .native => RealFS,
//     .wasm => WasmFS,
// };

// ──────────────────────────────────────────────────────────────────────────

pub struct PathContentsPair<'a, 'buf> {
    pub path: Path<'a>,
    /// `Owned` for the heap-allocated branch (caller frees on drop); `Borrowed`
    /// for the shared-buffer branch (points into the caller's `MutableString`,
    /// tied to `'buf` — see PORT NOTE in `read_file_with_handle_and_allocator`).
    pub contents: Cow<'buf, [u8]>,
}

pub(crate) struct NodeJSPathName<'a> {
    pub base: &'a [u8],
    pub dir: &'a [u8],
    /// includes the leading .
    pub ext: &'a [u8],
    pub filename: &'a [u8],
}

impl<'a> NodeJSPathName<'a> {
    pub(crate) fn init<const IS_WINDOWS: bool>(path_: &'a [u8]) -> NodeJSPathName<'a> {
        let platform: path_handler::Platform =
            if IS_WINDOWS { path_handler::Platform::Windows } else { path_handler::Platform::Posix };
        let get_last_sep = platform.get_last_separator_func();

        let mut path = path_;
        let mut base = path;
        // ext must be empty if not detected
        let mut ext: &[u8] = b"";
        let mut dir = path;
        let mut is_absolute = true;
        let mut i_ = get_last_sep(path);
        let mut first = true;
        while let Some(i) = i_ {
            // Stop if we found a non-trailing slash
            if i + 1 != path.len() && path.len() >= i + 1 {
                base = &path[i + 1..];
                dir = &path[0..i];
                is_absolute = false;
                break;
            }

            // If the path starts with a slash and it's the only slash, it's absolute
            if i == 0 && first {
                base = &path[1..];
                dir = b"";
                break;
            }

            first = false;
            // Ignore trailing slashes

            path = &path[0..i];

            i_ = get_last_sep(path);
        }

        // clean trailing slashs
        if base.len() > 1 && platform.is_separator(base[base.len() - 1]) {
            base = &base[0..base.len() - 1];
        }

        // filename is base without extension
        let mut filename = base;

        // if only one character ext = "" even if filename it's "."
        if filename.len() > 1 {
            // Strip off the extension
            if let Some(dot) = strings::last_index_of_char(filename, b'.') {
                if dot > 0 {
                    filename = &filename[0..dot];
                    ext = &base[dot..];
                }
            }
        }

        if is_absolute {
            dir = b"";
        }

        NodeJSPathName { dir, base, ext, filename }
    }
}

// `Path` / `PathName` — re-exported from the canonical `bun_paths::fs` via
// `crate::fs` (D090). This module (`fs_full`) is private + link-dead until
// re-exported wholesale; the local impl bodies (`dupe_alloc` full
// short-circuiting, `non_unique_name_string`, `json_stringify`, etc.) were
// never reachable and are dropped — `crate::fs::PathResolverExt` carries the
// live resolver-tier methods.
pub use crate::fs::{Path, PathName, PathResolverExt};

thread_local! {
    static NORMALIZE_BUF: RefCell<[u8; 1024]> = const { RefCell::new([0u8; 1024]) };
    static JOIN_BUF: RefCell<[u8; 1024]> = const { RefCell::new([0u8; 1024]) };
}

pub(crate) struct PackageRelative {
    pub path: &'static [u8],
    pub name: &'static [u8],
    pub is_parent_package: bool,
}

// pub fn customRealpath(path: &[u8]) -> Result<Box<[u8]>, bun_core::Error> {
//     var opened = try std.posix.open(path, if (Environment.isLinux) bun.O.PATH else bun.O.RDONLY, 0);
//     defer std.posix.close(opened);
// }

/// Display wrapper for fd-like handles (i32 / *anyopaque / FD).
pub(crate) struct PrintHandle<T>(pub T);

pub(crate) fn print_handle<T>(handle: T) -> PrintHandle<T> {
    PrintHandle(handle)
}

impl core::fmt::Display for PrintHandle<i32> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.0)
    }
}
// PORT NOTE: PrintHandle<c_int> overlaps PrintHandle<i32> on every supported target — dropped.
impl core::fmt::Display for PrintHandle<*mut c_void> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:p}", self.0)
    }
}
impl core::fmt::Display for PrintHandle<Fd> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.0)
    }
}
// TODO(port): FmtHandleFnGenerator used @TypeOf reflection — replaced with per-type Display impls



#[path = "fs/stat_hash.rs"]
pub mod stat_hash;
// TODO(b2-blocked): src/resolver/fs/stat_hash.rs depends on bun_hash::XxHash64 +
// bun_http_types::wtf::write_http_date — gated until those land.

// ported from: src/resolver/fs.zig

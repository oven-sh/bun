use core::cell::{Cell, RefCell};
use core::ffi::{c_int, c_void, CStr};
use core::sync::atomic::{AtomicU32, Ordering};
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::{allocators, AllocError};
use bun_core::{env_var, fmt as bun_fmt, FeatureFlags, Generation, MutableString, Output, PathString};
use bun_paths::{self as path_handler, PathBuffer, WPathBuffer, MAX_PATH_BYTES, SEP, SEP_STR};
use bun_str::{strings, ZStr};
use bun_sys::{self, Fd};
use bun_threading::Mutex;

bun_output::declare_scope!(fs, hidden);

macro_rules! debug {
    ($($arg:tt)*) => { bun_output::scoped_log!(fs, $($arg)*) };
}

// pub const FilesystemImplementation = @import("./fs_impl.zig");

pub mod preallocate {
    pub mod counts {
        pub const DIR_ENTRY: usize = 2048;
        pub const FILES: usize = 4096;
    }
}

pub type DirnameStore = allocators::BSSStringList<{ preallocate::counts::DIR_ENTRY }, 128>;
pub type FilenameStore = allocators::BSSStringList<{ preallocate::counts::FILES }, 64>;

pub struct FileSystem {
    pub top_level_dir: &'static ZStr,

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

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum FileSystemError {
    ENOENT,
    EACCESS,
    INVALID_NAME,
    ENOTDIR,
}
// TODO(port): impl From<FileSystemError> for bun_core::Error

static TMPNAME_ID_NUMBER: AtomicU32 = AtomicU32::new(0);

pub static mut MAX_FD: bun_sys::RawFd = 0;
pub static mut INSTANCE_LOADED: bool = false;
// TODO(port): lifetime — global mutable singleton; Zig used `var instance: FileSystem = undefined`
pub static mut INSTANCE: core::mem::MaybeUninit<FileSystem> = core::mem::MaybeUninit::uninit();

impl FileSystem {
    pub fn top_level_dir_without_trailing_slash(&self) -> &[u8] {
        let tld = self.top_level_dir.as_bytes();
        if tld.len() > 1 && tld[tld.len() - 1] == SEP {
            &tld[0..tld.len() - 1]
        } else {
            tld
        }
    }

    pub fn tmpdir(&mut self) -> Result<bun_sys::Dir, bun_core::Error> {
        TMPDIR_HANDLE.with(|h| {
            if h.get().is_none() {
                h.set(Some(self.fs.open_tmp_dir()?));
            }
            Ok(h.get().unwrap())
        })
    }

    pub fn get_fd_path(&self, fd: Fd) -> Result<&'static [u8], bun_core::Error> {
        let mut buf = PathBuffer::uninit();
        let dir = bun_sys::get_fd_path(fd, &mut buf)?;
        Ok(self.dirname_store.append(dir)?)
    }

    pub fn tmpname(extname: &[u8], buf: &mut [u8], hash: u64) -> Result<&mut ZStr, bun_core::Error> {
        // TODO(port): narrow error set (was std.fmt.BufPrintError)
        let hex_value: u64 =
            (u128::from(hash) | u128::try_from(bun_core::time::nano_timestamp()).unwrap()) as u64;

        // TODO(port): bufPrintZ equivalent — write into buf and NUL-terminate
        let mut cursor = &mut buf[..];
        write!(
            &mut cursor,
            ".{}-{}.{}",
            bun_fmt::hex_int_lower(hex_value),
            bun_fmt::hex_int_upper(TMPNAME_ID_NUMBER.fetch_add(1, Ordering::Relaxed)),
            BStr::new(extname),
        )
        .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
        let written = buf.len() - cursor.len();
        buf[written] = 0;
        // SAFETY: buf[written] == 0 written above
        Ok(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), written) })
    }

    #[inline]
    pub fn set_max_fd(fd: bun_sys::RawFd) {
        #[cfg(windows)]
        {
            return;
        }

        if !FeatureFlags::STORE_FILE_DESCRIPTORS {
            return;
        }

        // SAFETY: single-threaded mutation in resolver context (matches Zig global)
        unsafe {
            MAX_FD = fd.max(MAX_FD);
        }
    }

    pub fn init(top_level_dir: Option<&'static ZStr>) -> Result<&'static mut FileSystem, bun_core::Error> {
        Self::init_with_force::<false>(top_level_dir)
    }

    pub fn init_with_force<const FORCE: bool>(
        top_level_dir_: Option<&'static ZStr>,
    ) -> Result<&'static mut FileSystem, bun_core::Error> {
        // TODO(port): Environment.isBrowser branch
        let top_level_dir = match top_level_dir_ {
            Some(d) => d,
            None => {
                #[cfg(target_arch = "wasm32")]
                {
                    ZStr::from_static(b"/project/\0")
                }
                #[cfg(not(target_arch = "wasm32"))]
                {
                    bun_sys::getcwd_alloc()?
                }
            }
        };

        // SAFETY: matches Zig global singleton init pattern
        unsafe {
            if !INSTANCE_LOADED || FORCE {
                INSTANCE.write(FileSystem {
                    top_level_dir,
                    top_level_dir_buf: PathBuffer::uninit(),
                    fs: Implementation::init(top_level_dir.as_bytes()),
                    // must always use default_allocator since the other allocators may not be threadsafe when an element resizes
                    dirname_store: DirnameStore::init(),
                    filename_store: FilenameStore::init(),
                });
                INSTANCE_LOADED = true;

                let _ = dir_entry::EntryStore::init();
            }

            Ok(INSTANCE.assume_init_mut())
        }
    }

    #[inline]
    pub fn instance() -> &'static mut FileSystem {
        // SAFETY: caller guarantees init() was called
        unsafe { INSTANCE.assume_init_mut() }
    }
}

// PORT NOTE: Zig `FileSystem.deinit()` only called .deinit() on dirname_store/filename_store,
// which are &'static singletons here — nothing owned to free, so no `impl Drop`.

pub mod dir_entry {
    use super::*;

    pub type EntryMap = bun_collections::StringHashMap<*mut Entry>;
    pub type EntryStore = allocators::BSSList<Entry, { preallocate::counts::FILES }>;

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
        entry: &bun_sys::DirIteratorResult,
        iterator: I,
    ) -> Result<(), bun_core::Error> {
        let name_slice = entry.name.slice();
        let found_kind: Option<EntryKind> = match entry.kind {
            bun_sys::DirEntryKind::Directory => Some(EntryKind::Dir),
            bun_sys::DirEntryKind::File => Some(EntryKind::File),

            // For a symlink, we will need to stat the target later
            bun_sys::DirEntryKind::SymLink
            // Some filesystems return `.unknown` from getdents() no matter the actual kind of the file
            // (often because it would be slow to look up the kind). If we get this, then code that
            // needs the kind will have to find it out later by calling stat().
            | bun_sys::DirEntryKind::Unknown => None,

            bun_sys::DirEntryKind::BlockDevice
            | bun_sys::DirEntryKind::CharacterDevice
            | bun_sys::DirEntryKind::NamedPipe
            | bun_sys::DirEntryKind::UnixDomainSocket
            | bun_sys::DirEntryKind::Whiteout
            | bun_sys::DirEntryKind::Door
            | bun_sys::DirEntryKind::EventPort => return Ok(()),
        };

        let stored: *mut Entry = 'brk: {
            if let Some(map) = prev_map {
                // PERF(port): was stack-fallback alloc — profile in Phase B
                let prehashed =
                    bun_collections::StringHashMapContext::PrehashedCaseInsensitive::init(name_slice);
                if let Some(&existing_ptr) = map.get_adapted(name_slice, &prehashed) {
                    // SAFETY: EntryStore-owned pointer, valid for lifetime of store
                    let existing = unsafe { &mut *existing_ptr };
                    let _guard = existing.mutex.lock();
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
                FilenameStore::instance(),
            )?;

            let name_lowercased = strings::StringOrTinyString::init_lower_case_append_if_needed(
                name_slice,
                FilenameStore::instance(),
            )?;

            dir_entry::EntryStore::instance().append(Entry {
                base_: name,
                base_lowercase_: name_lowercased,
                dir: self.dir,
                mutex: Mutex::new(),
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
        let stored_name = stored_ref.base();

        self.data.put(stored_ref.base_lowercase(), stored)?;

        if !I::IS_VOID {
            iterator.next(stored_ref, self.fd);
        }

        if FeatureFlags::VERBOSE_FS {
            if found_kind == Some(EntryKind::Dir) {
                Output::prettyln("   + {}/", (BStr::new(stored_name),));
            } else {
                Output::prettyln("   + {}", (BStr::new(stored_name),));
            }
        }

        Ok(())
    }

    pub fn init(dir: &'static [u8], generation: Generation) -> DirEntry {
        if FeatureFlags::VERBOSE_FS {
            Output::prettyln("\n  {}", (BStr::new(dir),));
        }

        DirEntry {
            dir,
            data: dir_entry::EntryMap::default(),
            generation,
            fd: Fd::INVALID,
        }
    }

    pub fn get<'a>(&'a self, query_: &[u8]) -> Option<EntryLookup<'a>> {
        if query_.is_empty() || query_.len() > MAX_PATH_BYTES {
            return None;
        }
        let mut scratch_lookup_buffer = PathBuffer::uninit();

        let query = strings::copy_lowercase_if_needed(query_, &mut scratch_lookup_buffer);
        let &result_ptr = self.data.get(query)?;
        // SAFETY: EntryStore-owned pointer
        let result = unsafe { &*result_ptr };
        let basename = result.base();
        if !strings::eql_long(basename, query_, true) {
            return Some(EntryLookup {
                entry: result,
                diff_case: Some(DifferentCase {
                    dir: self.dir,
                    query: query_, // TODO(port): lifetime — Zig stored caller's slice
                    actual: basename,
                }),
            });
        }

        Some(EntryLookup { entry: result, diff_case: None })
    }

    // TODO(port): getComptimeQuery used comptime string lowering + comptime hash; Rust port
    // takes a &'static [u8] that is already lowercase. Phase B may add a const-eval hash.
    pub fn get_comptime_query<'a>(&'a self, query_lower: &'static [u8]) -> Option<EntryLookup<'a>> {
        // PERF(port): was comptime hash precompute — profile in Phase B
        let &result_ptr = self.data.get(query_lower)?;
        // SAFETY: EntryStore-owned pointer
        let result = unsafe { &*result_ptr };
        let basename = result.base();

        if basename != query_lower {
            return Some(EntryLookup {
                entry: result,
                diff_case: Some(DifferentCase {
                    dir: self.dir,
                    query: query_lower,
                    actual: basename,
                }),
            });
        }

        Some(EntryLookup { entry: result, diff_case: None })
    }

    pub fn has_comptime_query(&self, query_lower: &'static [u8]) -> bool {
        // PERF(port): was comptime hash precompute — profile in Phase B
        self.data.contains(query_lower)
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

impl Default for Entry {
    fn default() -> Self {
        Self {
            cache: EntryCache::default(),
            dir: b"",
            base_: strings::StringOrTinyString::default(),
            base_lowercase_: strings::StringOrTinyString::default(),
            mutex: Mutex::new(),
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
    pub entry: &'a Entry,
    pub diff_case: Option<DifferentCase<'a>>,
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
    pub fn normalize(&self, str: &[u8]) -> &[u8] {
        // PERF(port): was @call(bun.callmod_inline, ...)
        path_handler::normalize_string(str, true, path_handler::Platform::Auto)
    }

    pub fn normalize_buf<'a>(&self, buf: &'a mut [u8], str: &[u8]) -> &'a [u8] {
        path_handler::normalize_string_buf(str, buf, false, path_handler::Platform::Auto, false)
    }

    pub fn join(&self, parts: &[&[u8]]) -> &'static [u8] {
        // TODO(port): join_buf is threadlocal static; returning &'static is unsound — Phase B should return into caller buf
        JOIN_BUF.with_borrow_mut(|buf| {
            path_handler::join_string_buf(buf, parts, path_handler::Platform::Loose)
        })
    }

    pub fn join_buf<'a>(&self, parts: &[&[u8]], buf: &'a mut [u8]) -> &'a [u8] {
        path_handler::join_string_buf(buf, parts, path_handler::Platform::Loose)
    }

    pub fn relative<'a>(&self, from: &'a [u8], to: &'a [u8]) -> &'a [u8] {
        path_handler::relative(from, to)
    }

    pub fn relative_platform<'a, const PLATFORM: path_handler::Platform>(
        &self,
        from: &'a [u8],
        to: &'a [u8],
    ) -> &'a [u8] {
        path_handler::relative_platform(from, to, PLATFORM, false)
    }

    pub fn relative_to<'a>(&'a self, to: &'a [u8]) -> &'a [u8] {
        path_handler::relative(self.top_level_dir.as_bytes(), to)
    }

    pub fn relative_from<'a>(&'a self, from: &'a [u8]) -> &'a [u8] {
        path_handler::relative(from, self.top_level_dir.as_bytes())
    }

    pub fn abs_alloc(&self, parts: &[&[u8]]) -> Result<Box<[u8]>, AllocError> {
        let joined = path_handler::join_abs_string(
            self.top_level_dir.as_bytes(),
            parts,
            path_handler::Platform::Loose,
        );
        Ok(Box::<[u8]>::from(joined))
    }

    pub fn abs_alloc_z(&self, parts: &[&[u8]]) -> Result<bun_str::ZString, AllocError> {
        let joined = path_handler::join_abs_string(
            self.top_level_dir.as_bytes(),
            parts,
            path_handler::Platform::Loose,
        );
        // allocator.dupeZ → owned NUL-terminated buffer
        Ok(bun_str::ZString::from_bytes(joined))
    }

    pub fn abs(&self, parts: &[&[u8]]) -> &[u8] {
        path_handler::join_abs_string(
            self.top_level_dir.as_bytes(),
            parts,
            path_handler::Platform::Loose,
        )
    }

    pub fn abs_buf<'a>(&self, parts: &[&[u8]], buf: &'a mut [u8]) -> &'a [u8] {
        path_handler::join_abs_string_buf(
            self.top_level_dir.as_bytes(),
            buf,
            parts,
            path_handler::Platform::Loose,
        )
    }

    /// Like `abs_buf`, but returns null when the joined path (after `..`/`.`
    /// normalization) would overflow `buf`. Use when `parts` may contain
    /// user-controlled input of arbitrary length.
    pub fn abs_buf_checked<'a>(&self, parts: &[&[u8]], buf: &'a mut [u8]) -> Option<&'a [u8]> {
        path_handler::join_abs_string_buf_checked(
            self.top_level_dir.as_bytes(),
            buf,
            parts,
            path_handler::Platform::Loose,
        )
    }

    pub fn abs_buf_z<'a>(&self, parts: &[&[u8]], buf: &'a mut [u8]) -> &'a ZStr {
        path_handler::join_abs_string_buf_z(
            self.top_level_dir.as_bytes(),
            buf,
            parts,
            path_handler::Platform::Loose,
        )
    }

    pub fn join_alloc(&self, parts: &[&[u8]]) -> Result<Box<[u8]>, AllocError> {
        let joined = self.join(parts);
        Ok(Box::<[u8]>::from(joined))
    }

    pub fn print_limits() {
        // TODO(port): std.posix.rlimit_resource / getrlimit — bun_sys equivalent
        #[cfg(unix)]
        {
            Output::print("{{\n", ());

            if let Ok(stack) = bun_sys::posix::getrlimit(bun_sys::posix::RlimitResource::STACK) {
                Output::print("  \"stack\": [{}, {}],\n", (stack.cur, stack.max));
            }
            if let Ok(files) = bun_sys::posix::getrlimit(bun_sys::posix::RlimitResource::NOFILE) {
                Output::print("  \"files\": [{}, {}]\n", (files.cur, files.max));
            }

            Output::print("}}\n", ());
            Output::flush();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RealFS
// ──────────────────────────────────────────────────────────────────────────

pub type EntriesOptionMap =
    allocators::BSSMap<EntriesOption, { preallocate::counts::DIR_ENTRY }, false, 256, true>;

pub struct RealFS {
    pub entries_mutex: Mutex,
    pub entries: &'static EntriesOptionMap,
    pub cwd: &'static [u8], // TODO(port): lifetime — interned
    pub file_limit: usize,
    pub file_quota: usize,
}

#[cfg(windows)]
pub type Tmpfile = TmpfileWindows;
#[cfg(not(windows))]
pub type Tmpfile = TmpfilePosix;

pub mod limit {
    pub static mut HANDLES: usize = 0;
    #[cfg(unix)]
    pub static mut HANDLES_BEFORE: bun_sys::posix::Rlimit =
        // SAFETY: all-zero is a valid Rlimit (POD)
        unsafe { core::mem::zeroed() };
    #[cfg(not(unix))]
    pub static mut HANDLES_BEFORE: () = ();
}

static mut ENTRIES_OPTION_MAP: Option<&'static EntriesOptionMap> = None;
static mut ENTRIES_OPTION_MAP_LOADED: bool = false;

thread_local! {
    static TEMP_ENTRIES_OPTION: RefCell<core::mem::MaybeUninit<EntriesOption>> =
        const { RefCell::new(core::mem::MaybeUninit::uninit()) };
}

impl RealFS {
    fn platform_temp_dir_compute() -> &'static [u8] {
        // Try TMPDIR, TMP, and TEMP in that order, matching Node.js.
        // https://github.com/nodejs/node/blob/e172be269890702bf2ad06252f2f152e7604d76c/src/node_credentials.cc#L132
        if let Some(dir) = env_var::TMPDIR
            .get_not_empty()
            .or_else(|| env_var::TMP.get_not_empty())
            .or_else(|| env_var::TEMP.get_not_empty())
        {
            if dir.len() > 1 && dir[dir.len() - 1] == SEP {
                return &dir[0..dir.len() - 1];
            }
            return dir;
        }

        #[cfg(target_os = "windows")]
        {
            // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettemppathw#remarks
            if let Some(windir) = env_var::SYSTEMROOT.get().or_else(|| env_var::WINDIR.get()) {
                let mut v = Vec::new();
                write!(&mut v, "{}\\Temp", BStr::new(strings::without_trailing_slash(windir)))
                    .expect("oom");
                return Box::leak(v.into_boxed_slice());
            }

            if let Some(profile) = env_var::HOME.get() {
                let mut buf = PathBuffer::uninit();
                let parts: [&[u8]; 1] = [b"AppData\\Local\\Temp"];
                let out = path_handler::join_abs_string_buf(
                    profile,
                    &mut buf,
                    &parts,
                    path_handler::Platform::Loose,
                );
                return Box::leak(Box::<[u8]>::from(out));
            }

            let mut tmp_buf = PathBuffer::uninit();
            // TODO(port): std.posix.getcwd — bun_sys::getcwd
            let cwd = bun_sys::getcwd(&mut tmp_buf).expect("Failed to get cwd for platformTempDir");
            let root = bun_paths::windows_filesystem_root(cwd);
            let mut v = Vec::new();
            write!(&mut v, "{}\\Windows\\Temp", BStr::new(strings::without_trailing_slash(root)))
                .expect("oom");
            return Box::leak(v.into_boxed_slice());
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
        env_var::BUN_TMPDIR.get_not_empty().unwrap_or_else(Self::platform_temp_dir)
    }

    pub fn open_tmp_dir(&self) -> Result<bun_sys::Dir, bun_core::Error> {
        #[cfg(windows)]
        {
            return Ok(bun_sys::open_dir_at_windows_a(
                Fd::INVALID,
                Self::tmpdir_path(),
                bun_sys::OpenDirOptions {
                    iterable: true,
                    // we will not delete the temp directory
                    can_rename_or_delete: false,
                    read_only: true,
                    ..Default::default()
                },
            )
            .unwrap()?
            .std_dir());
        }
        #[cfg(not(windows))]
        {
            bun_sys::open_dir_absolute(Self::tmpdir_path())
        }
    }

    pub fn entries_at(
        &mut self,
        index: allocators::IndexType,
        generation: Generation,
    ) -> Option<&mut EntriesOption> {
        let existing = self.entries.at_index(index)?;
        if let EntriesOption::Entries(entries) = existing {
            if entries.generation < generation {
                let handle = match bun_sys::open_dir_for_iteration(Fd::cwd(), entries.dir).unwrap() {
                    Ok(h) => h,
                    Err(err) => {
                        entries.data.clear_and_free();
                        return Some(
                            self.read_directory_error(entries.dir, err.into())
                                .expect("unreachable"),
                        );
                    }
                };
                // PORT NOTE: defer handle.close() → handle dropped at end of scope
                let dir_path = entries.dir;
                let new_entry = match self.readdir(
                    false,
                    Some(&mut entries.data),
                    dir_path,
                    generation,
                    handle.std_dir(),
                    (),
                ) {
                    Ok(e) => e,
                    Err(err) => {
                        entries.data.clear_and_free();
                        drop(handle);
                        return Some(
                            self.read_directory_error(dir_path, err).expect("unreachable"),
                        );
                    }
                };
                entries.data.clear_and_free();
                **entries = new_entry;
                drop(handle);
            }
        }

        Some(existing)
        // PORT NOTE: reshaped for borrowck — re-fetch existing after self borrows above
        // TODO(port): borrowck — may need to restructure to avoid overlapping &mut self
    }

    pub fn get_default_temp_dir() -> &'static [u8] {
        env_var::BUN_TMPDIR.get().unwrap_or_else(Self::platform_temp_dir)
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
            !(self.file_limit > 254 && self.file_limit > (unsafe { MAX_FD } as usize + 1) * 2)
        }
    }

    /// Returns `true` if an entry was removed
    pub fn bust_entries_cache(&mut self, file_path: &[u8]) -> bool {
        self.entries.remove(file_path)
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
            unsafe {
                limit::HANDLES_BEFORE = lim;
            }

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

            // SAFETY: single init-time write
            unsafe {
                limit::HANDLES = usize::try_from(lim.cur).unwrap();
            }
            Ok(usize::try_from(lim.cur).unwrap())
        }
    }

    pub fn init(cwd: &'static [u8]) -> RealFS {
        let file_limit = Self::adjust_ulimit().expect("unreachable");

        // SAFETY: single init-time access
        unsafe {
            if !ENTRIES_OPTION_MAP_LOADED {
                ENTRIES_OPTION_MAP = Some(EntriesOptionMap::init());
                ENTRIES_OPTION_MAP_LOADED = true;
            }

            RealFS {
                entries_mutex: Mutex::new(),
                entries: ENTRIES_OPTION_MAP.unwrap(),
                cwd,
                file_limit,
                file_quota: file_limit,
            }
        }
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
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
            let mut cursor = &mut buf[..];
            write!(&mut cursor, "{}-{}", BStr::new(basename), bun_fmt::hex_int_lower(hex_int))
                .map_err(|_| bun_core::err!("NoSpaceLeft"))?;
            let written = buf.len() - cursor.len();
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

    pub fn generate(_: &mut RealFS, _: &[u8], file: bun_sys::File) -> Result<ModKey, bun_core::Error> {
        let stat = file.stat()?;

        const NS_PER_S: i128 = 1_000_000_000;
        let seconds = stat.mtime / NS_PER_S;

        // We can't detect changes if the file system zeros out the modification time
        if seconds == 0 && NS_PER_S == 0 {
            return Err(bun_core::err!("Unusable"));
        }

        // Don't generate a modification key if the file is too new
        let now = bun_core::time::nano_timestamp();
        let now_seconds = now / NS_PER_S;
        // PORT NOTE: Zig had `seconds > seconds` (always false) — preserved
        #[allow(clippy::eq_op)]
        if seconds > seconds || (seconds == now_seconds && stat.mtime > now) {
            return Err(bun_core::err!("Unusable"));
        }

        Ok(ModKey {
            inode: stat.inode,
            size: stat.size,
            mtime: stat.mtime,
            mode: stat.mode,
            // .uid = stat.
        })
    }
}

impl RealFS {
    pub fn mod_key_with_file(
        &mut self,
        path: &[u8],
        file: bun_sys::File,
    ) -> Result<ModKey, bun_core::Error> {
        ModKey::generate(self, path, file)
    }

    pub fn mod_key(&mut self, path: &[u8]) -> Result<ModKey, bun_core::Error> {
        // TODO(port): std.fs.cwd().openFile — bun_sys::File::open
        let file = bun_sys::File::open_read_only(Fd::cwd(), path)?;
        let need_close = self.need_to_close_files();
        let result = self.mod_key_with_file(path, file);
        if need_close {
            file.close();
        }
        result
    }
}

pub enum EntriesOption {
    Entries(Box<DirEntry>),
    Err(dir_entry::Err),
}

#[repr(u8)]
pub enum EntriesOptionTag {
    Entries,
    Err,
}

// EntriesOption::Map — see EntriesOptionMap type alias above
// This custom map implementation:
// - Preallocates a fixed amount of directory name space
// - Doesn't store directory names which don't exist.

pub struct TmpfilePosix {
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
    pub fn dir(&self) -> bun_sys::Dir {
        self.dir_fd.std_dir()
    }

    #[inline]
    pub fn file(&self) -> bun_sys::File {
        self.fd.std_file()
    }

    pub fn close(&mut self) {
        if self.fd.is_valid() {
            self.fd.close();
        }
    }

    pub fn create(&mut self, _: &mut RealFS, name: &ZStr) -> Result<(), bun_core::Error> {
        // We originally used a temporary directory, but it caused EXDEV.
        let dir_fd = Fd::cwd();
        self.dir_fd = dir_fd;

        let flags = bun_sys::O::CREAT | bun_sys::O::RDWR | bun_sys::O::CLOEXEC;
        self.fd = bun_sys::openat(dir_fd, name, flags, bun_sys::S::IRWXU).unwrap()?;
        Ok(())
    }

    pub fn promote_to_cwd(
        &mut self,
        from_name: &CStr,
        name: &CStr,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(self.fd != Fd::INVALID);
        debug_assert!(self.dir_fd != Fd::INVALID);

        bun_sys::move_file_z_with_handle(
            self.fd,
            self.dir_fd,
            from_name.to_bytes(),
            Fd::cwd(),
            name.to_bytes(),
        )?;
        self.close();
        Ok(())
    }

    pub fn close_and_delete(&mut self, name: &CStr) {
        self.close();

        #[cfg(not(target_os = "linux"))]
        {
            if self.dir_fd == Fd::INVALID {
                return;
            }
            let _ = self.dir().delete_file_z(name);
        }
        #[cfg(target_os = "linux")]
        {
            let _ = name;
        }
    }
}

pub struct TmpfileWindows {
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
    pub fn dir(&self) -> bun_sys::Dir {
        // TODO(port): Fs.FileSystem.instance.tmpdir() — needs &mut FileSystem
        FileSystem::instance().tmpdir().expect("tmpdir")
    }

    #[inline]
    pub fn file(&self) -> bun_sys::File {
        self.fd.std_file()
    }

    pub fn close(&mut self) {
        if self.fd.is_valid() {
            self.fd.close();
        }
    }

    pub fn create(&mut self, rfs: &mut RealFS, name: &ZStr) -> Result<(), bun_core::Error> {
        let tmp_dir = rfs.open_tmp_dir()?;

        let flags = bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::CLOEXEC;

        self.fd = bun_sys::openat(Fd::from_std_dir(tmp_dir), name, flags, 0).unwrap()?;
        let mut buf = PathBuffer::uninit();
        let existing_path = bun_sys::get_fd_path(self.fd, &mut buf)?;
        self.existing_path = Box::<[u8]>::from(existing_path);
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
        let existing = strings::to_extended_path_normalized(&mut new_buf, &self.existing_path);
        let new = if bun_paths::is_absolute_windows(name.as_bytes()) {
            strings::to_extended_path_normalized(&mut existing_buf, name.as_bytes())
        } else {
            strings::to_w_path_normalized(&mut existing_buf, name.as_bytes())
        };
        if cfg!(debug_assertions) {
            debug!("moveFileExW({}, {})", bun_fmt::utf16(existing), bun_fmt::utf16(new));
        }

        if bun_sys::windows::kernel32::MoveFileExW(
            existing.as_ptr(),
            new.as_ptr(),
            bun_sys::windows::MOVEFILE_COPY_ALLOWED
                | bun_sys::windows::MOVEFILE_REPLACE_EXISTING
                | bun_sys::windows::MOVEFILE_WRITE_THROUGH,
        ) == bun_sys::windows::FALSE
        {
            bun_sys::windows::Win32Error::get().unwrap()?;
        }
        Ok(())
    }

    #[cfg(not(windows))]
    pub fn promote_to_cwd(&mut self, _: &CStr, _: &ZStr) -> Result<(), bun_core::Error> {
        unreachable!()
    }

    pub fn close_and_delete(&mut self, _name: &CStr) {
        self.close();
    }
}

impl RealFS {
    pub fn open_dir(&self, unsafe_dir_string: &[u8]) -> Result<bun_sys::Dir, bun_core::Error> {
        #[cfg(windows)]
        let dirfd = bun_sys::open_dir_at_windows_a(
            Fd::INVALID,
            unsafe_dir_string,
            bun_sys::OpenDirOptions {
                iterable: true,
                no_follow: false,
                read_only: true,
                ..Default::default()
            },
        );
        #[cfg(not(windows))]
        let dirfd = bun_sys::open_a(unsafe_dir_string, bun_sys::O::DIRECTORY, 0);

        let fd = dirfd.unwrap()?;
        Ok(fd.std_dir())
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
        let mut iter = bun_sys::iterate_dir(Fd::from_std_dir(handle));
        let mut dir = DirEntry::init(dir_, generation);
        // errdefer dir.deinit() — DirEntry: Drop frees data on `?`
        let mut prev_map = prev_map;

        if store_fd {
            FileSystem::set_max_fd(handle.fd());
            dir.fd = Fd::from_std_dir(handle);
        }

        while let Some(entry_) = iter.next().unwrap()? {
            debug!("readdir entry {}", BStr::new(entry_.name.slice()));

            dir.add_entry(prev_map.as_deref_mut(), &entry_, &iterator)?;
        }

        debug!(
            "readdir({}, {}) = {}",
            print_handle(handle.fd()),
            BStr::new(dir_),
            dir.data.count()
        );

        Ok(dir)
    }

    fn read_directory_error(
        &mut self,
        dir: &[u8],
        err: bun_core::Error,
    ) -> Result<&'static mut EntriesOption, AllocError> {
        if FeatureFlags::ENABLE_ENTRY_CACHE {
            let mut get_or_put_result = self.entries.get_or_put(dir)?;
            if err == bun_core::err!("ENOENT") || err == bun_core::err!("FileNotFound") {
                self.entries.mark_not_found(get_or_put_result);
                return Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
                    slot.write(EntriesOption::Err(dir_entry::Err {
                        original_err: err,
                        canonical_error: err,
                    }));
                    // SAFETY: just wrote; threadlocal storage outlives caller (matches Zig)
                    unsafe { &mut *slot.as_mut_ptr() }
                }));
            } else {
                let opt = self.entries.put(
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
            // SAFETY: just wrote; threadlocal storage outlives caller (matches Zig)
            unsafe { &mut *slot.as_mut_ptr() }
        }))
    }

    pub fn read_directory(
        &mut self,
        dir_: &[u8],
        handle_: Option<bun_sys::Dir>,
        generation: Generation,
        store_fd: bool,
    ) -> Result<&'static mut EntriesOption, bun_core::Error> {
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
    pub fn read_directory_with_iterator<I: DirEntryIterator>(
        &mut self,
        dir_maybe_trail_slash: &[u8],
        maybe_handle: Option<bun_sys::Dir>,
        generation: Generation,
        store_fd: bool,
        iterator: I,
    ) -> Result<&'static mut EntriesOption, bun_core::Error> {
        let mut dir = strings::without_trailing_slash_windows_path(dir_maybe_trail_slash);

        bun_resolver::Resolver::assert_valid_cache_key(dir);
        let mut cache_result: Option<allocators::Result> = None;
        if FeatureFlags::ENABLE_ENTRY_CACHE {
            self.entries_mutex.lock();
        }
        // PORT NOTE: defer entries_mutex.unlock() — using scopeguard
        let _unlock_guard = scopeguard::guard((), |_| {
            if FeatureFlags::ENABLE_ENTRY_CACHE {
                self.entries_mutex.unlock();
            }
        });
        // TODO(port): borrowck — guard captures &self.entries_mutex while we mutate other fields below

        let mut in_place: Option<*mut DirEntry> = None;

        if FeatureFlags::ENABLE_ENTRY_CACHE {
            cache_result = Some(self.entries.get_or_put(dir)?);

            let cr = cache_result.as_ref().unwrap();
            if cr.has_checked_if_exists() {
                if let Some(cached_result) = self.entries.at_index(cr.index) {
                    match cached_result {
                        EntriesOption::Err(_) => return Ok(cached_result),
                        EntriesOption::Entries(e) if e.generation >= generation => {
                            return Ok(cached_result);
                        }
                        EntriesOption::Entries(e) => {
                            in_place = Some(&mut **e as *mut DirEntry);
                        }
                    }
                } else if cr.status == allocators::ResultStatus::NotFound && generation == 0 {
                    return Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
                        slot.write(EntriesOption::Err(dir_entry::Err {
                            original_err: bun_core::err!("ENOENT"),
                            canonical_error: bun_core::err!("ENOENT"),
                        }));
                        // SAFETY: just wrote; threadlocal storage outlives caller
                        unsafe { &mut *slot.as_mut_ptr() }
                    }));
                }
            }
        }

        let handle = match maybe_handle {
            Some(h) => h,
            None => match self.open_dir(dir) {
                Ok(h) => h,
                Err(err) => return Ok(self.read_directory_error(dir, err)?),
            },
        };

        let should_close_handle =
            maybe_handle.is_none() && (!store_fd || self.need_to_close_files());
        // PORT NOTE: defer handle.close() under condition — handled at function exit points below

        // if we get this far, it's a real directory, so we can just store the dir name.
        let dir: &'static [u8] = if maybe_handle.is_none() {
            if let Some(existing) = in_place {
                // SAFETY: in_place points to BSSMap-owned DirEntry
                unsafe { (*existing).dir }
            } else {
                DirnameStore::instance().append(dir_maybe_trail_slash)?
            }
        } else {
            // TODO(port): lifetime — when handle was provided, `dir` retains caller's slice
            // SAFETY: caller guarantees the slice outlives the cache entry (matches Zig)
            unsafe { core::mem::transmute::<&[u8], &'static [u8]>(dir) }
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
                    unsafe { (*existing).data.clear_and_free() };
                }
                if should_close_handle {
                    handle.close();
                }
                return Ok(self.read_directory_error(dir, err)?);
            }
        };

        if FeatureFlags::ENABLE_ENTRY_CACHE {
            let entries_ptr: *mut DirEntry = match in_place {
                Some(p) => {
                    // SAFETY: see above
                    unsafe { (*p).data.clear_and_free() };
                    p
                }
                None => Box::into_raw(Box::new(DirEntry::init(dir, generation))),
                // PORT NOTE: Zig used bun.default_allocator.create(DirEntry); EntriesOption owns Box<DirEntry>
            };
            if store_fd && !entries.fd.is_valid() {
                entries.fd = Fd::from_std_dir(handle);
            }

            // SAFETY: entries_ptr is either in_place (BSSMap-owned) or fresh Box
            unsafe { *entries_ptr = entries };
            // SAFETY: entries_ptr ownership transferred into the BSSMap via EntriesOption
            let result = EntriesOption::Entries(unsafe { Box::from_raw(entries_ptr) });
            // TODO(port): when in_place is Some, this Box::from_raw aliases the BSSMap-owned slot — Phase B must reshape

            let out = self.entries.put(cache_result.as_mut().unwrap(), result)?;

            if should_close_handle {
                handle.close();
            }
            return Ok(out);
        }

        if should_close_handle {
            handle.close();
        }

        Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
            slot.write(EntriesOption::Entries(Box::new(entries)));
            // SAFETY: just wrote; threadlocal storage outlives caller
            unsafe { &mut *slot.as_mut_ptr() }
        }))
    }

    fn read_file_error(&self, _: &[u8], _: bun_core::Error) {}

    pub fn read_file_with_handle<const USE_SHARED_BUFFER: bool, const STREAM: bool>(
        &mut self,
        path: &[u8],
        size_: Option<usize>,
        file: bun_sys::File,
        shared_buffer: &mut MutableString,
    ) -> Result<PathContentsPair, bun_core::Error> {
        self.read_file_with_handle_and_allocator::<USE_SHARED_BUFFER, STREAM>(
            path,
            size_,
            file,
            shared_buffer,
        )
    }

    pub fn read_file_with_handle_and_allocator<const USE_SHARED_BUFFER: bool, const STREAM: bool>(
        &mut self,
        path: &[u8],
        size_hint: Option<usize>,
        std_file: bun_sys::File,
        shared_buffer: &mut MutableString,
    ) -> Result<PathContentsPair, bun_core::Error> {
        // PORT NOTE: allocator param dropped (global mimalloc)
        FileSystem::set_max_fd(std_file.handle());
        let file = bun_sys::File::from(std_file);

        let mut file_contents: &[u8] = b"";
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
                    return Ok(PathContentsPair {
                        path: Path::init(path),
                        contents: shared_buffer.list.as_slice(),
                        // TODO(port): lifetime — contents borrows shared_buffer
                    });
                } else {
                    return Ok(PathContentsPair { path: Path::init(path), contents: b"" });
                }
            }

            let mut bytes_read: u64 = 0;
            shared_buffer.grow_by(size + 1)?;
            shared_buffer.list.expand_to_capacity();

            // if you press save on a large file we might not read all the
            // bytes in the first few pread() calls. we only handle this on
            // stream because we assume that this only realistically happens
            // during HMR
            loop {
                // We use pread to ensure if the file handle was open, it doesn't seek from the last position
                let read_count = match file.read_all(&mut shared_buffer.list[bytes_read as usize..]) {
                    Ok(n) => n,
                    Err(err) => {
                        self.read_file_error(path, err);
                        return Err(err);
                    }
                };
                shared_buffer.list.truncate(read_count + bytes_read as usize);
                file_contents = shared_buffer.list.as_slice();
                debug!("read({}, {}) = {}", file.handle(), size, read_count);

                if STREAM {
                    // check again that stat() didn't change the file size
                    // another reason to only do this when stream
                    let new_size = match file.get_end_pos() {
                        Ok(s) => s,
                        Err(err) => {
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
                        shared_buffer.list.expand_to_capacity();
                        size = new_size;
                        continue;
                    }
                }
                break;
            }

            if shared_buffer.list.capacity() > file_contents.len() {
                // SAFETY: capacity > len, so writing one byte past len is in-bounds
                unsafe {
                    *shared_buffer.list.as_mut_ptr().add(file_contents.len()) = 0;
                }
            }

            if let Some(bom) = strings::Bom::detect(file_contents) {
                debug!("Convert {} BOM", <&'static str>::from(bom));
                file_contents =
                    bom.remove_and_convert_to_utf8_without_dealloc(&mut shared_buffer.list)?;
            }
        } else {
            let mut initial_buf = [0u8; 16384];

            // Optimization: don't call stat() unless the file is big enough
            // that we need to dynamically allocate memory to read it.
            let initial_read: &[u8] = if size_hint.is_none() {
                let buf: &mut [u8] = &mut initial_buf;
                let read_count = match file.read_all(buf).unwrap() {
                    Ok(n) => n,
                    Err(err) => {
                        self.read_file_error(path, err);
                        return Err(err);
                    }
                };
                if read_count + 1 < buf.len() {
                    // allocator.dupeZ
                    let mut allocation = vec![0u8; read_count + 1];
                    allocation[..read_count].copy_from_slice(&buf[..read_count]);
                    allocation[read_count] = 0;
                    let allocation = Box::leak(allocation.into_boxed_slice());
                    // TODO(port): ownership — Zig returned slice into allocator-owned buffer
                    let mut fc: &[u8] = &allocation[..read_count];

                    if let Some(bom) = strings::Bom::detect(fc) {
                        debug!("Convert {} BOM", <&'static str>::from(bom));
                        fc = bom.remove_and_convert_to_utf8_and_free(fc)?;
                    }

                    return Ok(PathContentsPair { path: Path::init(path), contents: fc });
                }

                &initial_buf[..read_count]
            } else {
                &initial_buf[..0]
            };

            // Skip the extra file.stat() call when possible
            let size = match size_hint {
                Some(s) => s,
                None => match file.get_end_pos().unwrap() {
                    Ok(s) => s,
                    Err(err) => {
                        self.read_file_error(path, err);
                        return Err(err);
                    }
                },
            };
            debug!("stat({}) = {}", file.handle(), size);

            let mut buf = vec![0u8; size + 1].into_boxed_slice();
            buf[..initial_read.len()].copy_from_slice(initial_read);

            if size == 0 {
                return Ok(PathContentsPair { path: Path::init(path), contents: b"" });
            }

            // stick a zero at the end
            buf[size] = 0;

            let read_count = match file.read_all(&mut buf[initial_read.len()..]).unwrap() {
                Ok(n) => n,
                Err(err) => {
                    self.read_file_error(path, err);
                    return Err(err);
                }
            };
            // TODO(port): ownership — leaking buf to return &[u8] (matches Zig allocator-owned semantics)
            let buf = Box::leak(buf);
            file_contents = &buf[..read_count + initial_read.len()];
            debug!("read({}, {}) = {}", file.handle(), size, read_count);

            if let Some(bom) = strings::Bom::detect(file_contents) {
                debug!("Convert {} BOM", <&'static str>::from(bom));
                file_contents = bom.remove_and_convert_to_utf8_and_free(file_contents)?;
            }
        }

        Ok(PathContentsPair { path: Path::init(path), contents: file_contents })
    }

    pub fn kind_from_absolute(
        &mut self,
        absolute_path: &ZStr,
        existing_fd: Fd,
        store_fd: bool,
    ) -> Result<EntryCache, bun_core::Error> {
        let mut outpath = PathBuffer::uninit();

        let stat = bun_sys::lstat_absolute(absolute_path)?;
        let is_symlink = stat.kind == bun_sys::FileKind::SymLink;
        let mut kind_ = stat.kind;
        let mut cache = EntryCache {
            kind: EntryKind::File,
            symlink: PathString::EMPTY,
            fd: Fd::INVALID,
        };
        let mut symlink: &[u8] = b"";

        if is_symlink {
            // TODO(port): existing_fd != 0 — Zig compared FD to integer 0; using is_valid()
            let file: bun_sys::File = if existing_fd.is_valid() {
                bun_sys::File::from_handle(existing_fd)
            } else if store_fd {
                bun_sys::open_file_absolute_z(absolute_path, bun_sys::OpenMode::ReadOnly)?
            } else {
                bun_sys::open_file_for_path(absolute_path)?
            };
            FileSystem::set_max_fd(file.handle());

            // PORT NOTE: Zig `defer { if (...) file.close() else cache.fd = file }` runs on
            // BOTH success and error paths — use scopeguard so close-or-store happens even if
            // stat()/get_fd_path() return early with `?`.
            let need_to_close_files = self.need_to_close_files();
            let _guard = scopeguard::guard((file, &mut cache), move |(file, cache)| {
                if (!store_fd || need_to_close_files) && !existing_fd.is_valid() {
                    file.close();
                } else if FeatureFlags::STORE_FILE_DESCRIPTORS {
                    cache.fd = file.handle().into();
                }
            });
            let (file, _) = &*_guard;

            let stat_ = file.stat()?;

            symlink = bun_sys::get_fd_path(file.handle().into(), &mut outpath)?;

            kind_ = stat_.kind;
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
        let entry_path = path_handler::join_abs_string_buf(
            self.cwd,
            &mut outpath,
            &combo,
            path_handler::Platform::Auto,
        );
        let entry_path_len = entry_path.len();

        outpath[entry_path_len + 1] = 0;
        outpath[entry_path_len] = 0;

        // SAFETY: outpath[entry_path_len] == 0 written above
        let absolute_path_c =
            unsafe { ZStr::from_raw(outpath.as_ptr(), entry_path_len) };

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
            let wbuf = bun_paths::w_path_buffer_pool().get();
            let wpath = strings::to_kernel32_path(&mut *wbuf, absolute_path_c.as_bytes());
            let handle = w::kernel32::CreateFileW(
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
            );
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
            let _close_guard = scopeguard::guard((), |_| {
                let _ = w::CloseHandle(handle);
            });

            let mut info: w::BY_HANDLE_FILE_INFORMATION =
                // SAFETY: all-zero is a valid BY_HANDLE_FILE_INFORMATION (POD)
                unsafe { core::mem::zeroed() };
            if w::GetFileInformationByHandle(handle, &mut info) != 0 {
                cache.kind = if info.dwFileAttributes & w::FILE_ATTRIBUTE_DIRECTORY != 0 {
                    EntryKind::Dir
                } else {
                    EntryKind::File
                };
            }

            let buf2 = bun_paths::path_buffer_pool().get();
            match bun_sys::get_fd_path(Fd::from_native(handle), &mut *buf2) {
                bun_sys::Result::Ok(real) => {
                    cache.symlink = PathString::init(FilenameStore::instance().append(real)?);
                }
                bun_sys::Result::Err(_) => {}
            }
            return Ok(cache);
        }

        #[cfg(not(windows))]
        {
            let stat = bun_sys::lstat_absolute(absolute_path_c)?;
            let is_symlink = stat.kind == bun_sys::FileKind::SymLink;
            let mut file_kind = stat.kind;

            let mut symlink: &[u8] = b"";

            if is_symlink {
                let file: Fd = if let Some(valid) = existing_fd.unwrap_valid() {
                    valid
                } else if store_fd {
                    Fd::from_std_file(bun_sys::open_file_absolute_z(
                        absolute_path_c,
                        bun_sys::OpenMode::ReadOnly,
                    )?)
                } else {
                    Fd::from_std_file(bun_sys::open_file_for_path(absolute_path_c)?)
                };
                FileSystem::set_max_fd(file.native());

                // PORT NOTE: Zig `defer { if (...) file.close() else cache.fd = file }` runs on
                // BOTH success and error paths — use scopeguard so close-or-store happens even if
                // stat()/get_fd_path() return early with `?`.
                let need_to_close_files = self.need_to_close_files();
                let _guard = scopeguard::guard((file, &mut cache), move |(file, cache)| {
                    if (!store_fd || need_to_close_files) && !existing_fd.is_valid() {
                        file.close();
                    } else if FeatureFlags::STORE_FILE_DESCRIPTORS {
                        cache.fd = file;
                    }
                });
                let (file, _) = &*_guard;

                let file_stat = file.std_file().stat()?;
                symlink = file.get_fd_path(&mut outpath)?;
                file_kind = file_stat.kind;
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

pub type Implementation = RealFS;
// pub const Implementation = switch (build_target) {
// .wasi, .native => RealFS,
//     .wasm => WasmFS,
// };

// ──────────────────────────────────────────────────────────────────────────

pub struct PathContentsPair {
    pub path: Path,
    pub contents: &'static [u8], // TODO(port): lifetime — borrows shared_buffer or leaked alloc
}

pub struct NodeJSPathName {
    pub base: &'static [u8],
    pub dir: &'static [u8],
    /// includes the leading .
    pub ext: &'static [u8],
    pub filename: &'static [u8],
}
// TODO(port): lifetime — all four fields borrow the input path; struct should be NodeJSPathName<'a>

impl NodeJSPathName {
    pub fn init<const IS_WINDOWS: bool>(path_: &[u8]) -> NodeJSPathName {
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

        // SAFETY: all returned slices borrow `path_`; see TODO(port) on struct lifetime
        unsafe {
            NodeJSPathName {
                dir: core::mem::transmute(dir),
                base: core::mem::transmute(base),
                ext: core::mem::transmute(ext),
                filename: core::mem::transmute(filename),
            }
        }
    }
}

#[derive(Clone, Copy)]
pub struct PathName {
    pub base: &'static [u8],
    pub dir: &'static [u8],
    /// includes the leading .
    /// extensionless files report ""
    pub ext: &'static [u8],
    pub filename: &'static [u8],
}
// TODO(port): lifetime — all four fields borrow the input path; struct should be PathName<'a>

impl PathName {
    pub fn find_extname(path_: &[u8]) -> &[u8] {
        let mut start: usize = 0;
        if let Some(i) = bun_paths::last_index_of_sep(path_) {
            start = i + 1;
        }
        let base = &path_[start..];
        if let Some(dot) = strings::last_index_of_char(base, b'.') {
            if dot > 0 {
                return &base[dot..];
            }
        }
        b""
    }

    pub fn ext_without_leading_dot(&self) -> &[u8] {
        if !self.ext.is_empty() && self.ext[0] == b'.' {
            &self.ext[1..]
        } else {
            self.ext
        }
    }

    pub fn non_unique_name_string_base(&self) -> &[u8] {
        // /bar/foo/index.js -> foo
        if !self.dir.is_empty() && self.base == b"index" {
            // "/index" -> "index"
            return PathName::init(self.dir).base;
        }

        if cfg!(debug_assertions) {
            debug_assert!(!strings::includes(self.base, b"/"));
        }

        // /bar/foo.js -> foo
        self.base
    }

    pub fn dir_or_dot(&self) -> &[u8] {
        if self.dir.is_empty() {
            return b".";
        }
        self.dir
    }

    pub fn fmt_identifier(&self) -> bun_fmt::FormatValidIdentifier<'_> {
        bun_fmt::fmt_identifier(self.non_unique_name_string_base())
    }

    // For readability, the names of certain automatically-generated symbols are
    // derived from the file name. For example, instead of the CommonJS wrapper for
    // a file being called something like "require273" it can be called something
    // like "require_react" instead. This function generates the part of these
    // identifiers that's specific to the file path. It can take both an absolute
    // path (OS-specific) and a path in the source code (OS-independent).
    //
    // Note that these generated names do not at all relate to the correctness of
    // the code as far as avoiding symbol name collisions. These names still go
    // through the renaming logic that all other symbols go through to avoid name
    // collisions.
    pub fn non_unique_name_string(&self) -> Result<Box<[u8]>, AllocError> {
        MutableString::ensure_valid_identifier(self.non_unique_name_string_base())
    }

    #[inline]
    pub fn dir_with_trailing_slash(&self) -> &[u8] {
        // The three strings basically always point to the same underlying ptr
        // so if dir does not have a trailing slash, but is spaced one apart from the basename
        // we can assume there is a trailing slash there
        // so we extend the original slice's length by one
        if self.dir.is_empty() {
            return b"./";
        }
        let extend = (!bun_paths::is_sep_any(self.dir[self.dir.len() - 1])
            && (self.dir.as_ptr() as usize + self.dir.len() + 1) == self.base.as_ptr() as usize)
            as usize;
        // SAFETY: when extend==1, dir.ptr[dir.len] is the separator byte preceding base (same allocation)
        unsafe { core::slice::from_raw_parts(self.dir.as_ptr(), self.dir.len() + extend) }
    }

    pub fn init(path_: &[u8]) -> PathName {
        #[cfg(windows)]
        if cfg!(debug_assertions) {
            // This path is likely incorrect. I think it may be *possible*
            // but it is almost entirely certainly a bug.
            debug_assert!(!path_.starts_with(b"/:/"));
            debug_assert!(!path_.starts_with(b"\\:\\"));
        }

        let mut path = path_;
        let mut base = path;
        let ext: &[u8];
        let mut dir = path;
        let mut is_absolute = true;
        let has_disk_designator = path.len() > 2
            && path[1] == b':'
            && matches!(path[0], b'a'..=b'z' | b'A'..=b'Z')
            && bun_paths::is_sep_any(path[2]);
        if has_disk_designator {
            path = &path[2..];
        }

        while let Some(i) = bun_paths::last_index_of_sep(path) {
            // Stop if we found a non-trailing slash
            if i + 1 != path.len() && path.len() > i + 1 {
                base = &path[i + 1..];
                dir = &path[0..i];
                is_absolute = false;
                break;
            }

            // Ignore trailing slashes
            path = &path[0..i];
        }

        // Strip off the extension
        if let Some(dot) = strings::last_index_of_char(base, b'.') {
            ext = &base[dot..];
            base = &base[0..dot];
        } else {
            ext = b"";
        }

        if is_absolute {
            dir = b"";
        }

        if base.len() > 1 && bun_paths::is_sep_any(base[base.len() - 1]) {
            base = &base[0..base.len() - 1];
        }

        if !is_absolute && has_disk_designator {
            dir = &path_[0..dir.len() + 2];
        }

        let filename = if !dir.is_empty() { &path_[dir.len() + 1..] } else { path_ };

        // SAFETY: all returned slices borrow `path_`; see TODO(port) on struct lifetime
        unsafe {
            PathName {
                dir: core::mem::transmute(dir),
                base: core::mem::transmute(base),
                ext: core::mem::transmute(ext),
                filename: core::mem::transmute(filename),
            }
        }
    }
}

thread_local! {
    static NORMALIZE_BUF: RefCell<[u8; 1024]> = const { RefCell::new([0u8; 1024]) };
    static JOIN_BUF: RefCell<[u8; 1024]> = const { RefCell::new([0u8; 1024]) };
}

#[derive(Clone)]
pub struct Path {
    /// The display path. In the bundler, this is relative to the current
    /// working directory. Since it can be emitted in bundles (and used
    /// for content hashes), this should contain forward slashes on Windows.
    pub pretty: &'static [u8],
    /// The location of this resource. For the `file` namespace, this is
    /// usually an absolute path with native slashes or an empty string.
    pub text: &'static [u8],
    pub namespace: &'static [u8],
    // TODO(@paperclover): investigate removing or simplifying this property (it's 64 bytes)
    pub name: PathName,
    pub is_disabled: bool,
    pub is_symlink: bool,
}
// TODO(port): lifetime — text/pretty/namespace borrow caller storage or interned stores; struct should be Path<'a>

const NS_BLOB: &[u8] = b"blob";
const NS_BUN: &[u8] = b"bun";
const NS_DATAURL: &[u8] = b"dataurl";
const NS_FILE: &[u8] = b"file";
const NS_MACRO: &[u8] = b"macro";

pub struct PackageRelative {
    pub path: &'static [u8],
    pub name: &'static [u8],
    pub is_parent_package: bool,
}

impl Path {
    pub const EMPTY: Path = Path {
        pretty: b"",
        text: b"",
        namespace: b"file",
        // TODO(port): PathName::init("") at comptime — Phase B should make PathName::init const fn
        name: PathName { base: b"", dir: b"", ext: b"", filename: b"" },
        is_disabled: false,
        is_symlink: false,
    };

    pub fn is_file(&self) -> bool {
        self.namespace.is_empty() || self.namespace == b"file"
    }

    pub fn hash_key(&self) -> u64 {
        if self.is_file() {
            return bun_wyhash::hash(self.text);
        }

        let mut hasher = bun_wyhash::Wyhash::init(0);
        hasher.update(self.namespace);
        hasher.update(b"::::::::");
        hasher.update(self.text);
        hasher.final_()
    }

    /// This hash is used by the hot-module-reloading client in order to
    /// identify modules. Since that code is JavaScript, the hash must remain in
    /// range [-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER] or else information is lost
    /// due to floating-point precision.
    pub fn hash_for_kit(&self) -> u64 {
        // u52 — truncate to 52 bits
        self.hash_key() & ((1u64 << 52) - 1)
    }

    pub fn package_name(&self) -> Option<&[u8]> {
        let mut name_to_use = self.pretty;
        // SEP_STR ++ "node_modules" ++ SEP_STR
        let needle = const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();
        if let Some(node_modules) = strings::last_index_of(self.text, needle) {
            name_to_use = &self.text[node_modules + 14..];
        }

        let pkgname = bun_bundler::options::jsx::Pragma::parse_package_name(name_to_use);
        if pkgname.is_empty() || !pkgname[0].is_ascii_alphanumeric() {
            return None;
        }

        Some(pkgname)
    }

    pub fn loader(
        &self,
        loaders: &bun_bundler::options::LoaderHashTable,
    ) -> Option<bun_bundler::options::Loader> {
        if self.is_data_url() {
            return Some(bun_bundler::options::Loader::Dataurl);
        }

        let ext = self.name.ext;

        let result = loaders.get(ext).or_else(|| bun_bundler::options::Loader::from_string(ext));
        if result.is_none() || result == Some(bun_bundler::options::Loader::Json) {
            let str = self.name.filename;
            if str == b"package.json" || str == b"bun.lock" {
                return Some(bun_bundler::options::Loader::Jsonc);
            }

            if str.ends_with(b".jsonc") {
                return Some(bun_bundler::options::Loader::Jsonc);
            }

            if str.starts_with(b"tsconfig.") || str.starts_with(b"jsconfig.") {
                if str.ends_with(b".json") {
                    return Some(bun_bundler::options::Loader::Jsonc);
                }
            }
        }
        result
    }

    pub fn is_data_url(&self) -> bool {
        self.namespace == NS_DATAURL
    }

    pub fn is_bun(&self) -> bool {
        self.namespace == NS_BUN
    }

    pub fn is_macro(&self) -> bool {
        self.namespace == NS_MACRO
    }

    #[inline]
    pub fn source_dir(&self) -> &[u8] {
        self.name.dir_with_trailing_slash()
    }

    #[inline]
    pub fn pretty_dir(&self) -> &[u8] {
        self.name.dir_with_trailing_slash()
    }

    /// The bundler will hash path.pretty, so it needs to be consistent across platforms.
    /// This assertion might be a bit too forceful though.
    pub fn assert_pretty_is_valid(&self) {
        #[cfg(windows)]
        if cfg!(debug_assertions) {
            if strings::index_of_char(self.pretty, b'\\').is_some() {
                panic!(
                    "Expected pretty file path to have only forward slashes, got '{}'",
                    BStr::new(self.pretty)
                );
            }
        }
    }

    #[inline]
    pub fn assert_file_path_is_absolute(&self) {
        if bun_core::Environment::CI_ASSERT {
            if self.is_file() {
                debug_assert!(bun_paths::is_absolute(self.text));
            }
        }
    }

    #[inline]
    pub fn is_pretty_path_posix(&self) -> bool {
        #[cfg(not(windows))]
        {
            return true;
        }
        #[cfg(windows)]
        {
            strings::index_of_char(self.pretty, b'\\').is_none()
        }
    }

    // This duplicates but only when strictly necessary
    // This will skip allocating if it's already in FilenameStore or DirnameStore
    pub fn dupe_alloc(&self) -> Result<Path, bun_core::Error> {
        if core::ptr::eq(self.text.as_ptr(), self.pretty.as_ptr()) && self.text.len() == self.pretty.len() {
            if FilenameStore::instance().exists(self.text) || DirnameStore::instance().exists(self.text) {
                return Ok(self.clone());
            }

            let mut new_path = Path::init(FilenameStore::instance().append(self.text)?);
            new_path.pretty = new_path.text;
            new_path.namespace = self.namespace;
            new_path.is_symlink = self.is_symlink;
            Ok(new_path)
        } else if self.pretty.is_empty() {
            if FilenameStore::instance().exists(self.text) || DirnameStore::instance().exists(self.text) {
                return Ok(self.clone());
            }

            let mut new_path = Path::init(FilenameStore::instance().append(self.text)?);
            new_path.pretty = b"";
            new_path.namespace = self.namespace;
            new_path.is_symlink = self.is_symlink;
            Ok(new_path)
        } else if let Some((start, len)) = allocators::slice_range(self.pretty, self.text) {
            if FilenameStore::instance().exists(self.text) || DirnameStore::instance().exists(self.text) {
                return Ok(self.clone());
            }
            let text = FilenameStore::instance().append(self.text)?;
            let mut new_path = Path::init(text);
            new_path.pretty = &text[start..][..len];
            new_path.namespace = self.namespace;
            new_path.is_symlink = self.is_symlink;
            Ok(new_path)
        } else {
            if (FilenameStore::instance().exists(self.text)
                || DirnameStore::instance().exists(self.text))
                && (FilenameStore::instance().exists(self.pretty)
                    || DirnameStore::instance().exists(self.pretty))
            {
                return Ok(self.clone());
            }

            if let Some(offset) = strings::index_of(self.text, self.pretty) {
                let text = FilenameStore::instance().append(self.text)?;
                let mut new_path = Path::init(text);
                new_path.pretty = &text[offset..][..self.pretty.len()];
                new_path.namespace = self.namespace;
                new_path.is_symlink = self.is_symlink;
                Ok(new_path)
            } else {
                let mut buf = vec![0u8; self.text.len() + self.pretty.len() + 2];
                buf[..self.text.len()].copy_from_slice(self.text);
                buf[self.text.len()] = 0;
                buf[self.text.len() + 1..self.text.len() + 1 + self.pretty.len()]
                    .copy_from_slice(self.pretty);
                let buf_len = buf.len();
                buf[buf_len - 1] = 0;
                // TODO(port): ownership — leaking to return &'static slices (matches Zig allocator-owned)
                let buf = Box::leak(buf.into_boxed_slice());
                let new_pretty = &buf[self.text.len() + 1..][..self.pretty.len()];
                let mut new_path = Path::init(&buf[..self.text.len()]);
                new_path.pretty = new_pretty;
                new_path.namespace = self.namespace;
                new_path.is_symlink = self.is_symlink;
                Ok(new_path)
            }
        }
    }

    pub fn dupe_alloc_fix_pretty(&self) -> Result<Path, bun_core::Error> {
        if self.is_pretty_path_posix() {
            return self.dupe_alloc();
        }
        const _: () = assert!(cfg!(windows));
        let mut new = self.clone();
        new.pretty = b"";
        new = new.dupe_alloc()?;
        let pretty = Box::leak(Box::<[u8]>::from(self.pretty));
        bun_paths::platform_to_posix_in_place(pretty);
        new.pretty = pretty;
        new.assert_pretty_is_valid();
        Ok(new)
    }

    pub fn set_realpath(&mut self, to: &'static [u8]) {
        let old_path = self.text;
        self.text = to;
        self.name = PathName::init(to);
        self.pretty = old_path;
        self.is_symlink = true;
    }

    pub fn json_stringify<W: core::fmt::Write>(&self, writer: &mut W) -> core::fmt::Result {
        // TODO(port): writer.write(self.text) — JSON-encode the bytes
        write!(writer, "{:?}", BStr::new(self.text))
    }

    pub fn generate_key(&self) -> Result<Box<[u8]>, AllocError> {
        let mut v = Vec::new();
        write!(&mut v, "{}://{}", BStr::new(self.namespace), BStr::new(self.text)).expect("oom");
        Ok(v.into_boxed_slice())
    }

    pub fn init(text: &[u8]) -> Path {
        // SAFETY: see TODO(port) on Path struct lifetime
        let text: &'static [u8] = unsafe { core::mem::transmute(text) };
        Path {
            pretty: text,
            text,
            namespace: b"file",
            name: PathName::init(text),
            is_disabled: false,
            is_symlink: false,
        }
    }

    pub fn init_with_pretty(text: &[u8], pretty: &[u8]) -> Path {
        // SAFETY: see TODO(port) on Path struct lifetime
        let text: &'static [u8] = unsafe { core::mem::transmute(text) };
        let pretty: &'static [u8] = unsafe { core::mem::transmute(pretty) };
        Path {
            pretty,
            text,
            namespace: b"file",
            name: PathName::init(text),
            is_disabled: false,
            is_symlink: false,
        }
    }

    pub fn init_with_namespace(text: &[u8], namespace: &[u8]) -> Path {
        // SAFETY: see TODO(port) on Path struct lifetime
        let text: &'static [u8] = unsafe { core::mem::transmute(text) };
        let namespace: &'static [u8] = unsafe { core::mem::transmute(namespace) };
        Path {
            pretty: text,
            text,
            namespace,
            name: PathName::init(text),
            is_disabled: false,
            is_symlink: false,
        }
    }

    #[inline]
    pub const fn init_with_namespace_virtual(
        text: &'static [u8],
        namespace: &'static str,
        package: &'static str,
    ) -> Path {
        // TODO(port): comptime concat — needs const_format::concatcp! at call sites
        Path {
            pretty: const_format::concatcp!(namespace, ":", package).as_bytes(),
            // TODO(port): const_format requires &str literals; callers must pass literals
            is_symlink: true,
            text,
            namespace: namespace.as_bytes(),
            name: PathName { base: text, dir: b"", ext: b"", filename: text },
            // TODO(port): comptime PathName::init(text)
            is_disabled: false,
        }
    }

    #[inline]
    pub const fn init_for_kit_built_in(namespace: &'static str, package: &'static str) -> Path {
        Path {
            pretty: const_format::concatcp!(namespace, ":", package).as_bytes(),
            is_symlink: true,
            text: const_format::concatcp!("_bun/", package).as_bytes(),
            namespace: namespace.as_bytes(),
            name: PathName {
                base: package.as_bytes(),
                dir: b"",
                ext: b"",
                filename: package.as_bytes(),
            },
            // TODO(port): comptime PathName::init(package)
            is_disabled: false,
        }
    }

    pub fn is_node_module(&self) -> bool {
        let needle = const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();
        strings::last_index_of(self.name.dir, needle).is_some()
    }

    pub fn is_jsx_file(&self) -> bool {
        self.name.filename.ends_with(b".jsx") || self.name.filename.ends_with(b".tsx")
    }

    pub fn key_for_incremental_graph(&self) -> &[u8] {
        if self.is_file() {
            self.text
        } else {
            self.pretty
        }
    }
}

// pub fn customRealpath(path: &[u8]) -> Result<Box<[u8]>, bun_core::Error> {
//     var opened = try std.posix.open(path, if (Environment.isLinux) bun.O.PATH else bun.O.RDONLY, 0);
//     defer std.posix.close(opened);
// }

/// Display wrapper for fd-like handles (i32 / *anyopaque / FD).
pub struct PrintHandle<T>(pub T);

pub fn print_handle<T>(handle: T) -> PrintHandle<T> {
    PrintHandle(handle)
}

impl core::fmt::Display for PrintHandle<i32> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl core::fmt::Display for PrintHandle<c_int>
where
    c_int: core::fmt::Display,
{
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.0)
    }
}
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

pub use crate::fs::stat_hash as StatHash;
// TODO(port): module path — src/resolver/fs/stat_hash.zig → bun_resolver::fs::stat_hash

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/fs.zig (2063 lines)
//   confidence: medium
//   todos:      46
//   notes:      heavy global-singleton + threadlocal state; Path/PathName/PathContentsPair need <'a> lifetimes; read_directory_with_iterator borrowck/ownership of in_place Box<DirEntry> needs reshape; std.fs.Dir/File mapped to bun_sys placeholders; DirEntry.dir/Entry.dir kept &'static (interned) despite Zig free — Phase B revisit
// ──────────────────────────────────────────────────────────────────────────

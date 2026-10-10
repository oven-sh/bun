//! What a resolver remembers about directories: their listings, the `DirInfo`
//! it derived from each (package.json, tsconfig.json, the real path), the
//! directories that do not exist, and the paths it interned for all of that.
//!
//! There is one [`DirCache`] for the process. The runtime, `bun build`, the
//! dev server and every other resolver share it, and nothing in it is ever
//! freed. A `Bun.build()` has its own: it starts empty, so the build reads
//! every directory from disk, and it is dropped with the last resolver of the
//! build.

use core::cell::UnsafeCell;
use core::mem::MaybeUninit;
use core::ptr::{NonNull, addr_of, addr_of_mut};
use core::sync::atomic::{AtomicU32, Ordering};

use bun_paths::strings;
use bun_sys::Fd;
use bun_threading::{Guarded, Mutex};

use crate::dir_info;
use crate::fs::{
    DirEntry, DirEntryIterator, DirnameStoreBacking, DirnameStoreRef, EntriesOption,
    EntriesOptionMap, EntryCache, FileSystem, FilenameStoreRef, dir_entry,
    temp_entries_option_write,
};
use crate::fs_full::{
    EntryKindResolver, EntryStoreBacking, FilenameStoreAppender, FilenameStoreBacking,
};
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

/// The heap values that `DirInfo` and the listing map point to.
#[derive(Default)]
struct HeapValues {
    dir_entries: Vec<NonNull<DirEntry>>,
    package_jsons: Vec<NonNull<PackageJSON>>,
    tsconfigs: Vec<NonNull<TSConfigJSON>>,
}

// SAFETY: the pointers are `Box` allocations that the cache owns; `Guarded`
// serializes the lists.
unsafe impl Send for HeapValues {}

pub struct DirCache {
    /// Held for every `DirEntry.data` probe and for every listing that is
    /// added or removed.
    pub entries_mutex: Mutex,
    /// The resolvers that hold this cache. 0 for [`DirCache::process`], which
    /// is not counted.
    refs: AtomicU32,
    heap: Guarded<HeapValues>,
    entries: UnsafeCell<EntriesOptionMap>,
    dir_info: UnsafeCell<dir_info::HashMap>,
    entry_store: UnsafeCell<EntryStoreBacking>,
    dirname_store: UnsafeCell<DirnameStoreBacking>,
    filename_store: UnsafeCell<FilenameStoreBacking>,
}

// SAFETY: each store serializes its writers on its own mutex, the listing map
// is guarded by `entries_mutex`, and the `DirInfo` map by the resolver mutex.
unsafe impl Sync for DirCache {}
// SAFETY: see `Sync`; nothing in it is tied to the thread that created it.
unsafe impl Send for DirCache {}

bun_alloc::bss_singleton!(fn process_storage() -> DirCache);

impl DirCache {
    /// For `bss_singleton!`: the process instance, in zeroed storage that is
    /// never freed.
    ///
    /// SAFETY: `slot` is exclusive, aligned, zeroed and lives for `'static`.
    unsafe fn init_at(slot: *mut Self) {
        // SAFETY: caller contract.
        unsafe {
            Self::init_header_at(slot, 0);
            EntriesOptionMap::init_at(UnsafeCell::raw_get(addr_of!((*slot).entries)));
            dir_info::HashMap::init_at(UnsafeCell::raw_get(addr_of!((*slot).dir_info)));
            EntryStoreBacking::init_at(UnsafeCell::raw_get(addr_of!((*slot).entry_store)));
            DirnameStoreBacking::init_at(UnsafeCell::raw_get(addr_of!((*slot).dirname_store)));
            FilenameStoreBacking::init_at(UnsafeCell::raw_get(addr_of!((*slot).filename_store)));
        }
    }

    /// SAFETY: `slot` is exclusive and aligned.
    unsafe fn init_header_at(slot: *mut Self, refs: u32) {
        // SAFETY: caller contract.
        unsafe {
            addr_of_mut!((*slot).entries_mutex).write(Mutex::new());
            addr_of_mut!((*slot).refs).write(AtomicU32::new(refs));
            addr_of_mut!((*slot).heap).write(Guarded::new(HeapValues::default()));
        }
    }

    /// The cache of the process.
    #[inline]
    pub fn process() -> &'static DirCache {
        // SAFETY: `process_storage` returns the initialized, never-freed
        // singleton.
        unsafe { &*process_storage() }
    }

    /// An empty cache that its last [`DirCacheRef`] drops.
    fn create() -> DirCacheRef {
        let slot: *mut DirCache = Box::into_raw(Box::<DirCache>::new_uninit()).cast();
        // SAFETY: `slot` is a fresh allocation of a `DirCache`. The stores are
        // initialized in place: their buffers are large and mostly unused, and
        // nothing here writes to them.
        unsafe {
            Self::init_header_at(slot, 1);
            EntriesOptionMap::init_at_uninit(UnsafeCell::raw_get(addr_of!((*slot).entries)));
            dir_info::HashMap::init_at_uninit(UnsafeCell::raw_get(addr_of!((*slot).dir_info)));
            EntryStoreBacking::init_at_uninit(UnsafeCell::raw_get(addr_of!((*slot).entry_store)));
            DirnameStoreBacking::init_at_heap(UnsafeCell::raw_get(addr_of!((*slot).dirname_store)));
            FilenameStoreBacking::init_at_heap(UnsafeCell::raw_get(addr_of!(
                (*slot).filename_store
            )));
            DirCacheRef(NonNull::new_unchecked(slot))
        }
    }

    /// SAFETY: `this` came from [`DirCache::create`] and nothing refers to it
    /// or to anything it handed out.
    unsafe fn destroy(this: *mut DirCache) {
        // SAFETY: caller contract. Every field is dropped once, then the
        // allocation is freed without a second drop.
        unsafe {
            let heap = core::mem::take((*this).heap.get_mut());
            for dir_entry in heap.dir_entries {
                drop(bun_core::heap::take(dir_entry.as_ptr()));
            }
            for package_json in heap.package_jsons {
                drop(bun_core::heap::take(package_json.as_ptr()));
            }
            for tsconfig in heap.tsconfigs {
                drop(bun_core::heap::take(tsconfig.as_ptr()));
            }
            core::ptr::drop_in_place(addr_of_mut!((*this).heap));
            core::ptr::drop_in_place((*this).entries.get());
            core::ptr::drop_in_place((*this).dir_info.get());
            core::ptr::drop_in_place((*this).entry_store.get());
            DirnameStoreBacking::deinit_heap((*this).dirname_store.get());
            FilenameStoreBacking::deinit_heap((*this).filename_store.get());
            drop(Box::from_raw(this.cast::<MaybeUninit<DirCache>>()));
        }
    }

    #[inline]
    pub fn is_process(&self) -> bool {
        core::ptr::eq(self, process_storage())
    }

    /// The listing map. The caller holds `entries_mutex`.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn entries(&self) -> &mut EntriesOptionMap {
        // SAFETY: `entries_mutex` serializes every access to the map.
        unsafe { &mut *self.entries.get() }
    }

    /// The `DirInfo` map. Callers hold the resolver mutex.
    #[inline]
    pub(crate) fn dir_info_map(&self) -> *mut dir_info::HashMap {
        self.dir_info.get()
    }

    #[inline]
    pub(crate) fn dirname_store_backing(&self) -> *mut DirnameStoreBacking {
        self.dirname_store.get()
    }

    #[inline]
    pub(crate) fn filename_store_backing(&self) -> *mut FilenameStoreBacking {
        self.filename_store.get()
    }

    /// Where this cache interns directory paths. A slice it returns lives as
    /// long as the cache, which is `'static` only for [`DirCache::process`].
    #[inline]
    pub fn dirname_store(&self) -> DirnameStoreRef {
        DirnameStoreRef(self.dirname_store.get())
    }

    /// Where this cache interns file names and file paths. See
    /// [`dirname_store`](Self::dirname_store) for the lifetime.
    #[inline]
    pub fn filename_store(&self) -> FilenameStoreRef {
        FilenameStoreRef(self.filename_store.get())
    }

    /// For `readdir`: the stores a `DirEntry` of this cache is filled from.
    #[inline]
    pub(crate) fn entry_appender(&self) -> FilenameStoreAppender {
        FilenameStoreAppender::for_stores(self.filename_store.get(), self.entry_store.get())
    }

    /// `value` as this cache stores it, if it already points into the fixed
    /// buffer of one of its two path stores.
    #[inline]
    pub fn as_interned_path(&self, value: &[u8]) -> Option<&'static [u8]> {
        self.dirname_store()
            .as_interned(value)
            .or_else(|| self.filename_store().as_interned(value))
    }

    pub(crate) fn own_dir_entry(&self, dir_entry: DirEntry) -> &'static mut DirEntry {
        let ptr = bun_core::heap::into_raw(Box::new(dir_entry));
        // SAFETY: `into_raw` is never null.
        self.heap
            .lock()
            .dir_entries
            .push(unsafe { NonNull::new_unchecked(ptr) });
        // SAFETY: the cache frees it no earlier than itself; listing slots
        // hold the only reference.
        unsafe { &mut *ptr }
    }

    pub(crate) fn own_package_json(&self, package_json: PackageJSON) -> NonNull<PackageJSON> {
        // SAFETY: `into_raw` is never null.
        let ptr =
            unsafe { NonNull::new_unchecked(bun_core::heap::into_raw(Box::new(package_json))) };
        self.heap.lock().package_jsons.push(ptr);
        ptr
    }

    pub(crate) fn own_tsconfig(&self, tsconfig: Box<TSConfigJSON>) -> NonNull<TSConfigJSON> {
        // SAFETY: `into_raw` is never null.
        let ptr = unsafe { NonNull::new_unchecked(bun_core::heap::into_raw(tsconfig)) };
        self.heap.lock().tsconfigs.push(ptr);
        ptr
    }

    /// Iterate `handle` and fill a `DirEntry` for `dir`.
    fn readdir<I: DirEntryIterator>(
        &self,
        store_fd: bool,
        dir: &'static [u8],
        handle: Fd,
        iterator: I,
    ) -> crate::CrateResult<DirEntry> {
        let mut iter = bun_sys::iterate_dir(handle);
        let mut entries = DirEntry::init(dir, self);

        if store_fd {
            FileSystem::set_max_fd(bun_sys::Fd::native(handle));
            entries.fd = handle;
        }

        let mut stores = self.entry_appender();
        while let Some(entry) = iter.next()? {
            entries.add_entry_with_store(&entry, &mut stores, &iterator)?;
        }

        Ok(entries)
    }

    /// Cache (or threadlocal-stash) an `EntriesOption::Err` for `dir` and
    /// hand back its address. The caller holds `entries_mutex`.
    fn read_directory_error(
        &self,
        dir: &[u8],
        err: crate::Error,
    ) -> crate::CrateResult<&'static mut EntriesOption> {
        let mut get_or_put_result = self.entries().get_or_put(dir)?;
        let entries_err = EntriesOption::Err(dir_entry::Err {
            original_err: err,
            canonical_error: err,
        });
        if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
            self.entries().mark_not_found(get_or_put_result);
            return Ok(temp_entries_option_write(entries_err));
        }
        let opt: *mut EntriesOption = self.entries().put(&mut get_or_put_result, entries_err)?;
        // SAFETY: a slot of the listing map; it lives as long as the cache.
        Ok(unsafe { &mut *opt })
    }

    pub fn read_directory(
        &self,
        dir: &[u8],
        handle: Option<Fd>,
        store_fd: bool,
    ) -> crate::CrateResult<&'static mut EntriesOption> {
        self.read_directory_with_iterator(dir, handle, store_fd, ())
    }

    // One of the learnings here
    //
    //   Closing file descriptors yields significant performance benefits on Linux
    //
    // It was literally a 300% performance improvement to bundling.
    // https://twitter.com/jarredsumner/status/1655787337027309568
    // https://twitter.com/jarredsumner/status/1655714084569120770
    // https://twitter.com/jarredsumner/status/1655464485245845506
    pub fn read_directory_with_iterator<I: DirEntryIterator>(
        &self,
        dir_maybe_trail_slash: &[u8],
        maybe_handle: Option<Fd>,
        store_fd: bool,
        iterator: I,
    ) -> crate::CrateResult<&'static mut EntriesOption> {
        let dir = strings::paths::without_trailing_slash_windows_path(dir_maybe_trail_slash);

        crate::Resolver::assert_valid_cache_key(dir);
        let _unlock_guard = self.entries_mutex.lock_guard();

        let mut cache_result = self.entries().get_or_put(dir)?;
        if cache_result.has_checked_if_exists() {
            if let Some(cached_result) = self.entries().at_index(cache_result.index) {
                // SAFETY: a slot of the listing map; it lives as long as the cache.
                return Ok(unsafe { &mut *core::ptr::from_mut::<EntriesOption>(cached_result) });
            }
            if cache_result.status == bun_alloc::ItemStatus::NotFound {
                return Ok(temp_entries_option_write(EntriesOption::Err(
                    dir_entry::Err {
                        original_err: crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                        canonical_error: crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                    },
                )));
            }
        }

        let rfs = &FileSystem::get().fs;
        let had_handle = maybe_handle.is_some();
        let handle: Fd = match maybe_handle {
            Some(h) => h,
            None => match rfs.open_dir(dir) {
                Ok(h) => h,
                Err(err) => return self.read_directory_error(dir, err),
            },
        };

        // Close the handle on every exit path. Use
        // scopeguard so close happens even if `readdir`/`put` early-return with `?`.
        let should_close_handle = !had_handle && (!store_fd || rfs.need_to_close_files());
        let _close_guard = scopeguard::guard(handle, move |h| {
            if should_close_handle {
                let _ = bun_sys::close(h);
            }
        });

        // if we get this far, it's a real directory, so we can just store the dir name.
        let dir: &'static [u8] = if !had_handle {
            self.dirname_store().append_slice(dir_maybe_trail_slash)?
        } else {
            self.dirname_store().append_slice(dir)?
        };

        // Cache miss: read the directory entries
        let mut entries = match self.readdir(store_fd, dir, handle, iterator) {
            Ok(e) => e,
            Err(err) => return self.read_directory_error(dir, err),
        };
        if store_fd && !entries.fd.is_valid() {
            entries.fd = handle;
        }

        let out: *mut EntriesOption = self.entries().put(
            &mut cache_result,
            EntriesOption::Entries(self.own_dir_entry(entries)),
        )?;
        // SAFETY: a slot of the listing map; it lives as long as the cache.
        Ok(unsafe { &mut *out })
    }

    /// Evicts `file_path` from the listing map; returns whether
    /// an entry was removed. The listing itself stays allocated.
    pub(crate) fn bust_entries_cache(&self, file_path: &[u8]) -> bool {
        let _g = self.entries_mutex.lock_guard();
        self.entries().remove(file_path)
    }
}

impl EntryKindResolver for DirCache {
    #[inline(always)]
    fn resolve_kind(
        &self,
        dir: &[u8],
        base: &[u8],
        existing_fd: Fd,
        store_fd: bool,
    ) -> crate::CrateResult<EntryCache> {
        FileSystem::get()
            .fs
            .kind(self.filename_store(), dir, base, existing_fd, store_fd)
    }
}

/// A counted reference to a [`DirCache`]. The process cache is not counted:
/// a clone or a drop of a reference to it does nothing.
pub struct DirCacheRef(NonNull<DirCache>);

// SAFETY: `DirCache` is `Sync`, and the count is atomic.
unsafe impl Send for DirCacheRef {}
// SAFETY: see `Send`.
unsafe impl Sync for DirCacheRef {}

impl DirCacheRef {
    /// The cache of the process.
    #[inline]
    pub fn process() -> DirCacheRef {
        DirCacheRef(NonNull::from(DirCache::process()))
    }

    /// A new, empty cache. It is dropped with the last reference to it, and
    /// everything it handed out dangles from then on.
    pub fn owned() -> DirCacheRef {
        DirCache::create()
    }

    #[inline]
    pub fn as_ptr(&self) -> *const DirCache {
        self.0.as_ptr()
    }
}

impl core::ops::Deref for DirCacheRef {
    type Target = DirCache;
    #[inline]
    fn deref(&self) -> &DirCache {
        // SAFETY: the process cache is never freed, and a counted cache lives
        // while this reference does.
        unsafe { self.0.as_ref() }
    }
}

impl Clone for DirCacheRef {
    fn clone(&self) -> Self {
        if !self.is_process() {
            self.refs.fetch_add(1, Ordering::Relaxed);
        }
        DirCacheRef(self.0)
    }
}

impl Drop for DirCacheRef {
    fn drop(&mut self) {
        if self.is_process() {
            return;
        }
        if self.refs.fetch_sub(1, Ordering::AcqRel) == 1 {
            // SAFETY: this was the last reference to a cache from `DirCache::create`.
            unsafe { DirCache::destroy(self.0.as_ptr()) };
        }
    }
}

//! A slot pointer of a BSS store stays valid across every later call on the store. Miri is the judge.

use core::cell::Cell;
use core::sync::atomic::AtomicBool;
use std::collections::HashSet;
use std::sync::Barrier;

use super::*;

/// A store under test: in a zeroed `Box`, or a `bss_*!` singleton.
struct Store<T> {
    ptr: NonNull<T>,
    boxed: bool,
}

impl<T> Store<T> {
    /// `init_at` on zeroed heap storage. `Drop` frees the store when the test ends.
    fn boxed(init_at: unsafe fn(*mut T)) -> Self {
        let storage = Box::into_raw(Box::<T>::new_zeroed()).cast::<T>();
        // SAFETY: `storage` is valid for writes, aligned, exclusive and zeroed: the `init_at` contract.
        unsafe { init_at(storage) };
        Store {
            ptr: NonNull::new(storage).unwrap(),
            boxed: true,
        }
    }

    /// A `bss_*!` singleton, in the storage of `bss_heap_init`. Nothing frees it.
    fn singleton(store: *mut T) -> Self {
        Store {
            ptr: NonNull::new(store).unwrap(),
            boxed: false,
        }
    }

    fn raw(&self) -> *mut T {
        self.ptr.as_ptr()
    }

    /// A singleton for as long as the process lives.
    fn as_static(&self) -> &'static T {
        assert!(!self.boxed);
        // SAFETY: nothing frees a singleton.
        unsafe { &*self.ptr.as_ptr() }
    }
}

impl<T> core::ops::Deref for Store<T> {
    type Target = T;
    fn deref(&self) -> &T {
        // SAFETY: the store is initialized, and it lives until `drop`.
        unsafe { self.ptr.as_ref() }
    }
}

impl<T> Drop for Store<T> {
    fn drop(&mut self) {
        if self.boxed {
            // SAFETY: `boxed` took the storage from a `Box` and initialized it.
            drop(unsafe { Box::from_raw(self.ptr.as_ptr()) });
        }
    }
}

// SAFETY: the threads of a test share the pointer of a store, as the threads of bun share the pointer of a singleton.
unsafe impl<T> Sync for Store<T> {}

// The calls that the tests make, on top of the stores as they are. Each call takes `&mut` or `&`
// to the store from its pointer for that one call, which is what the resolver does with a singleton.

impl<T> Store<list::List<T>> {
    fn append_uninit(&self) -> core::result::Result<*mut MaybeUninit<T>, AllocError> {
        // SAFETY: the list is live.
        unsafe { list::List::append_uninit(self.raw()) }
    }
}

impl Store<map::Map> {
    fn get_or_put(&self, key: &[u8]) -> core::result::Result<Result, AllocError> {
        // SAFETY: the map is live, and the `&mut` ends with the call.
        unsafe { &mut *self.raw() }.get_or_put(key)
    }

    fn get(&self, key: &[u8]) -> Option<NonNull<u64>> {
        // SAFETY: as above.
        unsafe { &mut *self.raw() }.get(key).map(NonNull::from)
    }

    fn mark_not_found(&self, result: Result) {
        // SAFETY: as above.
        unsafe { &mut *self.raw() }.mark_not_found(result);
    }

    /// SAFETY: `index` must be a sentinel or an index that `put` on this map assigned.
    unsafe fn at_index(&self, index: IndexType) -> Option<NonNull<u64>> {
        // SAFETY: as above.
        unsafe { &mut *self.raw() }
            .at_index(index)
            .map(NonNull::from)
    }

    fn put(
        &self,
        result: &mut Result,
        value: u64,
    ) -> core::result::Result<NonNull<u64>, AllocError> {
        // SAFETY: as above.
        unsafe { &mut *self.raw() }
            .put(result, value)
            .map(NonNull::from)
    }

    /// `put` with an index that is assigned.
    ///
    /// SAFETY: `put` on this map must have assigned `result.index`, and nothing else may use the slot.
    unsafe fn replace(&self, result: &Result, value: u64) -> NonNull<u64> {
        let mut result = *result;
        // SAFETY: as above.
        NonNull::from(unsafe { &mut *self.raw() }.put(&mut result, value).unwrap())
    }

    fn remove(&self, key: &[u8]) -> bool {
        // SAFETY: as above.
        unsafe { &mut *self.raw() }.remove(key)
    }
}

impl<const COUNT: usize, const ITEM_LENGTH: usize> Store<BSSStringList<COUNT, ITEM_LENGTH>> {
    fn append<A: BSSAppendable>(&self, value: &A) -> core::result::Result<&[u8], AllocError> {
        // SAFETY: the list is live.
        unsafe { BSSStringList::append(self.raw(), value) }
    }

    fn append_lower_case(&self, value: &[u8]) -> core::result::Result<&[u8], AllocError> {
        // SAFETY: the list is live.
        unsafe { BSSStringList::append_lower_case(self.raw(), value) }
    }

    fn print(&self, args: core::fmt::Arguments<'_>) -> core::result::Result<&[u8], AllocError> {
        // SAFETY: the list is live.
        unsafe { BSSStringList::print(self.raw(), args) }
    }

    fn exists(&self, value: &[u8]) -> bool {
        // SAFETY: the list is live, and the `&` ends with the call.
        unsafe { &*self.raw() }.exists(value)
    }
}

/// A slot pointer that a test gives to one thread.
struct Slot<T>(*mut T);
// SAFETY: the tests read or write a slot on one thread at a time.
unsafe impl<T: Send> Send for Slot<T> {}

/// Reads `slot` after `later` ran. A reference argument is protected for the call, so Miri rejects a store call in `later` that invalidates it.
fn read_across<T: Copy>(slot: &T, later: impl FnOnce()) -> T {
    later();
    *slot
}

/// The shape of the resolver's `Entry`: a plain field, and state that is written through `&T`.
struct EntryLike {
    name: [u8; 8],
    cache: Cell<u64>,
    need_stat: AtomicBool,
}

mod list {
    use super::*;

    const INLINE: usize = 4;
    pub(super) type List<T> = BSSList<T, INLINE>;
    /// After this many appends the next slot comes from the first heap block.
    const FIRST_HEAP_SLOT: usize = INLINE + BSS_LIST_CHUNK_SIZE;

    fn new<T>() -> Store<List<T>> {
        Store::boxed(List::init_at)
    }

    pub(super) fn append<T>(list: &Store<List<T>>, value: T) -> *mut T {
        let slot = list.append_uninit().unwrap();
        // SAFETY: the slot is reserved for this call, and it is written before it is read.
        unsafe { (*slot).write(value) };
        slot.cast::<T>()
    }

    /// Appends `before` values, then A, then B. A `&mut` to A is live across the append of B.
    fn write_after_a_later_append(before: usize) {
        let list = new::<u64>();
        for i in 0..before {
            append(&list, i as u64);
        }
        // SAFETY: `a` and `b` are initialized slots of a live list, and nothing else borrows them.
        let (a, b) = unsafe {
            let a = &mut *append(&list, 1);
            *a = 5;
            (a, &mut *append(&list, 2))
        };
        *a = 10;
        assert_eq!((*a, *b), (10, 2));
    }

    #[test]
    fn inline_slot_is_writable_after_a_later_append() {
        write_after_a_later_append(0);
    }

    #[test]
    fn tail_slot_is_writable_after_a_later_append() {
        write_after_a_later_append(INLINE);
    }

    #[test]
    fn heap_slot_is_writable_after_a_later_append() {
        write_after_a_later_append(FIRST_HEAP_SLOT);
    }

    #[test]
    fn inline_slot_is_readable_after_a_later_append() {
        let list = new::<u64>();
        let a = append(&list, 1);
        let b = append(&list, 2);
        // SAFETY: `a` and `b` are initialized slots of a live list.
        unsafe { assert_eq!((*a, *b), (1, 2)) };
    }

    #[test]
    fn slot_is_readable_under_a_protected_borrow_across_later_appends() {
        let list = new::<u64>();
        let a = append(&list, 1);
        // SAFETY: `a` is an initialized slot of a live list.
        let seen = read_across(unsafe { &*a }, || {
            for i in 0..FIRST_HEAP_SLOT as u64 + 1 {
                append(&list, i);
            }
        });
        assert_eq!(seen, 1);
    }

    /// Appends `count` values. A `&mut` to every slot is live across every later append.
    pub(super) fn every_slot_stays_writable(list: &Store<List<u64>>, count: usize) {
        let mut slots: Vec<&mut u64> = Vec::with_capacity(count);
        for i in 0..count {
            // SAFETY: the slot is initialized, the list is live, and nothing else borrows the slot.
            slots.push(unsafe { &mut *append(list, i as u64) });
        }
        let distinct: HashSet<*const u64> = slots.iter().map(|slot| &raw const **slot).collect();
        assert_eq!(distinct.len(), count);
        for (i, slot) in slots.iter_mut().enumerate() {
            assert_eq!(**slot, i as u64);
            **slot += 1;
        }
        for (i, slot) in slots.iter().enumerate() {
            assert_eq!(**slot, i as u64 + 1);
        }
    }

    #[test]
    fn every_slot_is_writable_after_two_new_heap_blocks() {
        every_slot_stays_writable(&new(), FIRST_HEAP_SLOT + BSS_LIST_CHUNK_SIZE + 1);
    }

    #[test]
    fn entry_is_used_through_shared_borrows_across_later_appends() {
        let list = new::<EntryLike>();
        let count = FIRST_HEAP_SLOT + 2;
        // The second field is the `DirEntry::data` key shape: a slice into the slot.
        let mut entries: Vec<(&EntryLike, &[u8])> = Vec::with_capacity(count);
        for i in 0..count {
            let entry = append(
                &list,
                EntryLike {
                    name: [i as u8; 8],
                    cache: Cell::new(i as u64),
                    need_stat: AtomicBool::new(true),
                },
            );
            // SAFETY: `entry` is an initialized slot of a live list, and nothing borrows it `&mut`.
            let entry = unsafe { &*entry };
            entries.push((entry, &entry.name[..]));
        }
        for (i, (entry, name)) in entries.iter().enumerate() {
            assert_eq!(*name, [i as u8; 8]);
            assert_eq!(entry.cache.get(), i as u64);
            entry.cache.set(i as u64 * 2);
            entry.need_stat.store(false, Ordering::Release);
        }
        for (i, (entry, name)) in entries.iter().enumerate() {
            assert_eq!((entry.name, *name), ([i as u8; 8], &[i as u8; 8][..]));
            assert_eq!(entry.cache.get(), i as u64 * 2);
            assert!(!entry.need_stat.load(Ordering::Acquire));
        }
    }

    #[test]
    fn append_does_not_race_with_a_write_to_an_earlier_slot() {
        let list = new::<u64>();
        let first = Slot(append(&list, 0));
        let list = &list;
        std::thread::scope(|scope| {
            scope.spawn(move || {
                let first = first;
                // SAFETY: only this thread has the pointer of the first slot.
                let first = unsafe { &mut *first.0 };
                for i in 1..=8 {
                    *first = i;
                    std::thread::yield_now();
                }
                assert_eq!(*first, 8);
            });
            scope.spawn(move || {
                for i in 1..=INLINE as u64 + 4 {
                    append(list, i);
                    std::thread::yield_now();
                }
            });
        });
    }

    /// Appenders on their own threads cross the inline buffer, the inline tail block and a heap block.
    #[test]
    fn concurrent_appenders_get_distinct_slots() {
        const APPENDERS: usize = 2;
        const PER_APPENDER: usize = (FIRST_HEAP_SLOT + BSS_LIST_CHUNK_SIZE + 8) / APPENDERS;

        let list = new::<u64>();
        let list = &list;
        let start = Barrier::new(APPENDERS);
        let start = &start;
        let slots: Vec<(Slot<u64>, u64)> = std::thread::scope(|scope| {
            let appenders: [_; APPENDERS] = core::array::from_fn(|appender| {
                scope.spawn(move || {
                    start.wait();
                    (0..PER_APPENDER)
                        .map(|i| {
                            let value = ((appender as u64 + 1) << 32) | i as u64;
                            (Slot(append(list, value)), value)
                        })
                        .collect::<Vec<_>>()
                })
            });
            appenders
                .into_iter()
                .flat_map(|appender| appender.join().unwrap())
                .collect()
        });
        let total = APPENDERS * PER_APPENDER;
        let distinct: HashSet<*mut u64> = slots.iter().map(|(slot, _)| slot.0).collect();
        assert_eq!(distinct.len(), total);
        for (slot, value) in &slots {
            // SAFETY: `slot` is an initialized slot of a live list.
            assert_eq!(unsafe { *slot.0 }, *value);
        }
    }

    #[test]
    fn unused_list_drops() {
        drop(new::<u64>());
    }
}

mod map {
    use super::*;

    const INLINE: usize = 4;
    pub(super) type Map = BSSMapInner<u64, INLINE, false>;

    fn new() -> Store<Map> {
        Store::boxed(Map::init_at)
    }

    pub(super) fn put(map: &Store<Map>, key: &[u8], value: u64) -> (IndexType, *mut u64) {
        let mut result = map.get_or_put(key).unwrap();
        let slot = map.put(&mut result, value).unwrap();
        (result.index, slot.as_ptr())
    }

    /// Puts keys until `used` slots of `backing_buf` are taken.
    fn fill_inline(map: &Store<Map>, used: usize) {
        for i in used as u8..INLINE as u8 {
            assert!(!put(map, &[b'#', i], u64::from(i)).0.is_overflow());
        }
    }

    fn at_index(map: &Store<Map>, index: IndexType) -> *mut u64 {
        // SAFETY: every index in these tests comes from `put` on `map`, on this
        // thread or through the lock of the map.
        unsafe { map.at_index(index) }.unwrap().as_ptr()
    }

    fn get(map: &Store<Map>, key: &[u8]) -> Option<*mut u64> {
        map.get(key).map(NonNull::as_ptr)
    }

    /// Puts A, then calls every method of the map. A `&mut` to A is live across all of them.
    pub(super) fn slot_stays_writable_across_every_method(map: &Store<Map>) {
        let (index, a_ptr) = put(map, b"a", 1);
        // SAFETY: `a_ptr` is an initialized slot of a live map, and nothing else borrows it.
        let a = unsafe { &mut *a_ptr };
        *a = 5;
        assert_eq!(at_index(map, index), a_ptr);
        *a = 6;
        assert_eq!(get(map, b"a"), Some(a_ptr));
        *a = 7;
        assert_eq!(get(map, b"missing"), None);
        *a = 8;
        assert!(map.get_or_put(b"a").unwrap().status == ItemStatus::Exists);
        *a = 9;
        let other = map.get_or_put(b"other").unwrap();
        assert!(other.status == ItemStatus::Unknown);
        *a = 10;
        map.mark_not_found(other);
        *a = 11;
        assert!(map.remove(b"other"));
        *a = 12;
        let (_, b) = put(map, b"b", 2);
        *a = 13;
        // SAFETY: `b` is an initialized slot of a live map.
        assert_eq!((*a, unsafe { *b }), (13, 2));
    }

    #[test]
    fn inline_slot_is_writable_across_every_method() {
        slot_stays_writable_across_every_method(&new());
    }

    #[test]
    fn overflow_slot_is_writable_across_every_method() {
        let map = new();
        fill_inline(&map, 0);
        slot_stays_writable_across_every_method(&map);
        assert!(map.get_or_put(b"a").unwrap().index.is_overflow());
    }

    #[test]
    fn inline_slot_is_readable_after_a_later_put() {
        let map = new();
        let (_, a) = put(&map, b"a", 1);
        let (_, b) = put(&map, b"b", 2);
        // SAFETY: `a` and `b` are initialized slots of a live map.
        unsafe { assert_eq!((*a, *b), (1, 2)) };
    }

    #[test]
    fn inline_slot_is_writable_after_the_first_overflow_put() {
        let map = new();
        let (_, a) = put(&map, b"a", 1);
        // SAFETY: `a` is an initialized slot of a live map, and nothing else borrows it.
        let a = unsafe { &mut *a };
        *a = 5;
        fill_inline(&map, 1);
        let (index, o) = put(&map, b"o", 2);
        assert!(index.is_overflow());
        *a = 10;
        // SAFETY: `o` is an initialized slot of a live map.
        assert_eq!((*a, unsafe { *o }), (10, 2));
    }

    #[test]
    fn slot_is_readable_under_a_protected_borrow_across_later_calls() {
        let map = new();
        fill_inline(&map, 1);
        for key in [&b"inline"[..], b"overflow"] {
            let (index, a) = put(&map, key, 1);
            // SAFETY: `a` is an initialized slot of a live map.
            let seen = read_across(unsafe { &*a }, || {
                assert_eq!(at_index(&map, index), a);
                assert_eq!(get(&map, key), Some(a));
                put(&map, &[key, b"+"].concat(), 2);
            });
            assert_eq!(seen, 1);
        }
    }

    #[test]
    fn put_after_mark_not_found_assigns_a_slot() {
        let map = new();
        let result = map.get_or_put(b"a").unwrap();
        map.mark_not_found(result);
        let mut result = map.get_or_put(b"a").unwrap();
        assert!(result.status == ItemStatus::NotFound);
        assert_eq!(get(&map, b"a"), None);

        let slot = map.put(&mut result, 7).unwrap().as_ptr();
        assert_eq!(get(&map, b"a"), Some(slot));
        // SAFETY: `put` initialized the slot.
        unsafe { assert_eq!(*slot, 7) };
    }

    #[test]
    fn put_after_remove_takes_a_new_slot_and_the_old_one_stays_writable() {
        let map = new();
        let (_, old) = put(&map, b"a", 1);
        assert!(map.remove(b"a"));
        assert!(!map.remove(b"a"));
        assert_eq!(get(&map, b"a"), None);

        let (_, new) = put(&map, b"a", 2);
        assert_ne!(old, new);
        // SAFETY: both are initialized slots of a live map.
        unsafe {
            *old = 10;
            assert_eq!((*old, *new), (10, 2));
        }
    }

    #[test]
    fn replace_writes_the_slot_that_put_assigned() {
        let map = new();
        let mut inline = map.get_or_put(b"a").unwrap();
        let a = map.put(&mut inline, 1).unwrap();
        fill_inline(&map, 1);
        // The overflow slot is in the second block.
        for i in 0..BSS_OVERFLOW_BLOCK_SIZE as u8 {
            put(&map, &[b'+', i], u64::from(i));
        }
        let mut overflow = map.get_or_put(b"o").unwrap();
        let o = map.put(&mut overflow, 2).unwrap();
        assert_eq!(
            (
                overflow.index.is_overflow(),
                overflow.index.index() as usize
            ),
            (true, BSS_OVERFLOW_BLOCK_SIZE)
        );

        // SAFETY: `put` assigned both indexes, and nothing else uses the two slots.
        unsafe {
            assert_eq!(map.replace(&inline, 3), a);
            assert_eq!(map.replace(&overflow, 4), o);
            assert_eq!((*a.as_ptr(), *o.as_ptr()), (3, 4));
            *a.as_ptr() = 5;
            *o.as_ptr() = 6;
            assert_eq!(
                (
                    *at_index(&map, inline.index),
                    *at_index(&map, overflow.index)
                ),
                (5, 6)
            );
        }
        assert_eq!(
            (get(&map, b"a"), get(&map, b"o")),
            (Some(a.as_ptr()), Some(o.as_ptr()))
        );
    }

    /// A `&mut` to every slot is live across every later call.
    #[test]
    fn every_slot_stays_writable_across_three_overflow_blocks() {
        let map = new();
        let count = INLINE + 2 * BSS_OVERFLOW_BLOCK_SIZE + 1;
        let key = |i: usize| (i as u32).to_le_bytes();
        let mut slots: Vec<(IndexType, &mut u64)> = Vec::with_capacity(count);
        for i in 0..count {
            let (index, slot) = put(&map, &key(i), i as u64);
            // SAFETY: the slot is initialized, the map is live, and nothing else borrows the slot.
            slots.push((index, unsafe { &mut *slot }));
        }
        assert_eq!(
            slots[count - 1].0.index() as usize,
            2 * BSS_OVERFLOW_BLOCK_SIZE
        );
        for (i, (index, slot)) in slots.iter_mut().enumerate() {
            let address = &raw mut **slot;
            assert_eq!(at_index(&map, *index), address);
            assert_eq!(get(&map, &key(i)), Some(address));
            assert_eq!(**slot, i as u64);
            **slot += 1;
        }
        for (i, (_, slot)) in slots.iter().enumerate() {
            assert_eq!(**slot, i as u64 + 1);
        }
    }

    #[test]
    fn put_does_not_race_with_a_lookup_of_an_earlier_slot() {
        let map = new();
        assert!(!put(&map, b"inline", 1).0.is_overflow());

        let map = &map;
        let start = Barrier::new(2);
        let start = &start;
        std::thread::scope(|scope| {
            scope.spawn(move || {
                start.wait();
                for i in 0..8 {
                    let slot = get(map, b"inline").unwrap();
                    // SAFETY: only this thread reads or writes this slot.
                    unsafe {
                        *slot += 1;
                        assert_eq!(*slot, i + 2);
                    }
                    std::thread::yield_now();
                }
            });
            // The puts fill the inline buffer, and then they make the first overflow block.
            scope.spawn(move || {
                start.wait();
                for i in 0..INLINE as u8 + 4 {
                    put(map, &[b'+', i], u64::from(i));
                    std::thread::yield_now();
                }
            });
        });
        assert!(
            map.get_or_put(&[b'+', INLINE as u8 + 3])
                .unwrap()
                .index
                .is_overflow()
        );
    }

    #[test]
    fn unused_map_drops() {
        drop(new());
    }
}

mod string_list {
    use super::*;

    /// 64 bytes of `backing_buf`.
    pub(super) type List = BSSStringList<4, 16>;

    fn new<const COUNT: usize, const ITEM_LENGTH: usize>()
    -> Store<BSSStringList<COUNT, ITEM_LENGTH>> {
        Store::boxed(BSSStringList::init_at)
    }

    /// The byte `after` bytes behind the end of `string`. `append` sets the first one to NUL. The slice that `append` returns does not cover them, so the pointer of the store reads.
    fn byte_after<const COUNT: usize, const ITEM_LENGTH: usize>(
        list: &Store<BSSStringList<COUNT, ITEM_LENGTH>>,
        string: &[u8],
        after: usize,
    ) -> u8 {
        assert!(list.exists(string));
        let buf = list.backing_buf.cast::<u8>();
        let offset = string.as_ptr().addr() - buf.as_ptr().addr() + string.len() + after;
        // SAFETY: `string` is in `backing_buf`, and the store reserved and wrote the byte.
        unsafe { buf.add(offset).read() }
    }

    pub(super) fn earlier_strings_stay_readable(list: &Store<List>) {
        let a = list.append(&&b"abc"[..]).unwrap();
        assert!(list.exists(a));
        let b = list.append(&&[&b"de"[..], b"", b"f"][..]).unwrap();
        let c = list.append_lower_case(b"GhI.J").unwrap();
        let d = list.print(format_args!("{}-{}", "k", 7)).unwrap();
        assert_eq!(
            (a, b, c, d),
            (&b"abc"[..], &b"def"[..], &b"ghi.j"[..], &b"k-7"[..])
        );
        assert_eq!(
            [a, b, c, d].map(|string| byte_after(list, string, 0)),
            [0; 4]
        );
        assert!(list.exists(a) && list.exists(d) && !list.exists(b"abc"));
        assert_eq!(a.as_ptr().wrapping_add(4), b.as_ptr());
    }

    #[test]
    fn earlier_strings_are_readable_after_later_appends() {
        earlier_strings_stay_readable(&new());
    }

    /// Appends to the list in the middle of its own `Display`, as another thread can in the middle of a `print`.
    struct AppendsWhilePrinted<'a, const COUNT: usize, const ITEM_LENGTH: usize>(
        &'a Store<BSSStringList<COUNT, ITEM_LENGTH>>,
    );

    impl<const COUNT: usize, const ITEM_LENGTH: usize> core::fmt::Display
        for AppendsWhilePrinted<'_, COUNT, ITEM_LENGTH>
    {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            f.write_str("head-")?;
            assert_eq!(self.0.append(&&b"nested"[..]).unwrap(), b"nested");
            f.write_str("-tail")
        }
    }

    /// A `print` that is too long for its stack buffer formats three times: into that buffer, to count, and into the bytes that it reserved.
    #[test]
    fn long_print_writes_only_the_bytes_that_it_reserved() {
        let list = new::<32, 65>();
        let before = list.append(&&b"before"[..]).unwrap();
        let filler = [b'x'; 600];
        let filler = core::str::from_utf8(&filler).unwrap();
        let mut printed: &[u8] = &[];
        let first = read_across(&before[0], || {
            printed = list
                .print(format_args!("{}{filler}", AppendsWhilePrinted(&list)))
                .unwrap();
        });
        let after = list.append(&&b"after"[..]).unwrap();

        assert_eq!(
            (first, before, after),
            (b'b', &b"before"[..], &b"after"[..])
        );
        assert_eq!(printed.len(), 10 + 600);
        assert!(printed.starts_with(b"head--tail") && printed[10..] == filler.as_bytes()[..]);
        assert!(list.exists(before) && list.exists(printed) && list.exists(after));
        assert_eq!(
            [byte_after(&list, printed, 0), byte_after(&list, printed, 1)],
            [0; 2]
        );
        // "before", the "nested" of the first two passes, the print and its two NULs, the "nested" of the last pass.
        assert_eq!(before.as_ptr().wrapping_add(7 + 2 * 7), printed.as_ptr());
        assert_eq!(printed.as_ptr().wrapping_add(610 + 2 + 7), after.as_ptr());
    }

    #[test]
    fn append_does_not_race_with_exists() {
        let list = new::<4, 16>();
        let list = &list;
        let start = Barrier::new(2);
        let start = &start;
        std::thread::scope(|scope| {
            scope.spawn(move || {
                start.wait();
                for _ in 0..4 {
                    let string = list.append(&&b"abc"[..]).unwrap();
                    assert!(list.exists(string));
                    std::thread::yield_now();
                }
            });
            scope.spawn(move || {
                start.wait();
                for _ in 0..4 {
                    assert!(!list.exists(b"zz"));
                    std::thread::yield_now();
                }
            });
        });
    }

    #[test]
    fn concurrent_appenders_get_their_own_bytes() {
        const APPENDERS: usize = 2;
        const PER_APPENDER: u8 = 20;

        let list = new::<16, 64>();
        let list = &list;
        let start = Barrier::new(APPENDERS);
        let start = &start;
        let strings: Vec<(&[u8], [u8; 5])> = std::thread::scope(|scope| {
            let appenders: [_; APPENDERS] = core::array::from_fn(|appender| {
                let appender = appender as u8;
                scope.spawn(move || {
                    start.wait();
                    (0..PER_APPENDER)
                        .map(|i| {
                            let value =
                                [b'a' + appender, b'0' + i, b'-', b'0' + i, b'A' + appender];
                            (list.append(&&value[..]).unwrap(), value)
                        })
                        .collect::<Vec<_>>()
                })
            });
            appenders
                .into_iter()
                .flat_map(|appender| appender.join().unwrap())
                .collect()
        });
        // 6 bytes per string, so the buffer holds all 40.
        let inline = strings
            .iter()
            .filter(|(string, _)| list.exists(string))
            .count();
        assert_eq!((strings.len(), inline), (40, 40));
        for (string, value) in &strings {
            assert_eq!((*string, byte_after(list, string, 0)), (&value[..], 0));
        }
    }
}

/// The stores through the `bss_*!` accessors: the storage of `bss_heap_init`, and `&'static` receivers.
mod singleton {
    use super::*;

    #[test]
    fn list_slots_stay_writable() {
        crate::bss_list! { list_store: u64, 4 }
        let list = Store::singleton(list_store());
        list::every_slot_stays_writable(&list, 4 + BSS_LIST_CHUNK_SIZE + 2);
        assert!(core::ptr::eq(list_store(), list_store()));
    }

    #[test]
    fn list_slot_is_writable_after_the_accessor_is_called_again() {
        crate::bss_list! { recalled_list: u64, 4 }
        // SAFETY: the slot is initialized, and nothing else borrows it.
        let a = unsafe { &mut *list::append(&Store::singleton(recalled_list()), 1) };
        *a = 5;
        list::append(&Store::singleton(recalled_list()), 2);
        *a = 10;
        assert_eq!(*a, 10);
    }

    #[test]
    fn map_slot_stays_writable() {
        crate::bss_map_inner! { map_store: u64, 4, false }
        let map = Store::singleton(map_store());
        map::slot_stays_writable_across_every_method(&map);
        assert!(core::ptr::eq(map_store(), map_store()));
        assert!(Store::singleton(map_store()).get(b"a").is_some());
    }

    #[test]
    fn map_slot_is_writable_after_the_accessor_is_called_again() {
        crate::bss_map_inner! { recalled_map: u64, 4, false }
        let (_, a) = map::put(&Store::singleton(recalled_map()), b"a", 1);
        // SAFETY: the slot is initialized, and nothing else borrows it.
        let a = unsafe { &mut *a };
        *a = 5;
        map::put(&Store::singleton(recalled_map()), b"b", 2);
        *a = 10;
        assert_eq!(*a, 10);
    }

    #[test]
    fn strings_stay_readable() {
        crate::bss_string_list! { string_store: 4, 16 }
        let strings = Store::singleton(string_store());
        string_list::earlier_strings_stay_readable(&strings);
        assert!(core::ptr::eq(string_store(), string_store()));

        let again = Store::singleton(string_store());
        let interned = again.append(&&b"xyz"[..]).unwrap();
        assert!(again.exists(interned));
        assert_eq!(
            again.as_static().as_interned(&interned[1..]),
            Some(&b"yz"[..])
        );
        assert_eq!(again.as_static().as_interned(b"xyz"), None);
        again.append(&&b"w"[..]).unwrap();
        assert_eq!(interned, b"xyz");
    }

    /// One of the threads publishes its store, and the others get that one.
    #[test]
    fn first_calls_of_an_accessor_on_four_threads_get_one_store() {
        crate::bss_string_list! { raced_store: 4, 16 }
        const THREADS: usize = 4;

        let start = Barrier::new(THREADS);
        let start = &start;
        let stores: Vec<usize> = std::thread::scope(|scope| {
            let threads: [_; THREADS] = core::array::from_fn(|thread| {
                scope.spawn(move || {
                    start.wait();
                    let store = Store::singleton(raced_store());
                    let value = [b'a' + thread as u8; 3];
                    let string = store.append(&&value[..]).unwrap();
                    assert!(store.exists(string));
                    assert_eq!(string, value);
                    store.ptr.as_ptr().addr()
                })
            });
            threads
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .collect()
        });
        let published = Store::singleton(raced_store()).ptr.as_ptr().addr();
        assert_eq!(stores, [published; THREADS]);
    }
}

use core::cell::{Cell, UnsafeCell};
use core::marker::PhantomData;
use core::mem::{ManuallyDrop, MaybeUninit, size_of};
use core::ops::Deref;
use core::ptr::NonNull;

use bun_core::asan;

/// Fixed-width occupancy bitset for [`HiveArray`].
///
/// PORT NOTE: Zig's `std.bit_set.IntegerBitSet(N)` is backed by an exact-width
/// `uN` integer (`u128`, `u256`, `u2048`, …). The Rust port's
/// [`IntegerBitSet`](crate::bit_set::IntegerBitSet) is backed by a single
/// `usize`, so for `N > 64` it silently held only 64 usable bits — every
/// `HiveArray<_, 128/256/2048>` pool degraded to 64 effective slots and spilled
/// to the heap fallback on the 65th in-flight item. Under HTTP load (the
/// `Body::Value` 256-slot pool, the `RequestContext` 2048-slot pool) this turned
/// every request into a `Box::new`.
///
/// We can't spell `[usize; (CAPACITY+63)/64]` without `generic_const_exprs`
/// (which would virally add `where` bounds on every `HiveArray` consumer), so
/// this uses a fixed `[Cell<usize>; 32]` backing array — 2048 bits, which is the
/// largest in-tree `HiveArray` capacity. Only the first `ceil(CAPACITY/64)`
/// words are touched, so smaller pools pay 256 B of dead storage (negligible
/// next to `buffer`). The words are `Cell` so the bitset can be mutated through
/// a `&self` pool, matching `HiveArray`'s interior-mutability model.
#[repr(C)]
pub struct HiveBitSet<const CAPACITY: usize> {
    masks: [Cell<usize>; HIVE_BITSET_WORDS],
}

const HIVE_BITSET_WORDS: usize = 32;
const WORD_BITS: usize = usize::BITS as usize;

impl<const CAPACITY: usize> HiveBitSet<CAPACITY> {
    const NUM_WORDS: usize = if CAPACITY == 0 {
        0
    } else {
        CAPACITY.div_ceil(WORD_BITS)
    };
    const _FITS: () = assert!(
        CAPACITY <= HIVE_BITSET_WORDS * WORD_BITS,
        "HiveArray CAPACITY exceeds HiveBitSet backing (raise HIVE_BITSET_WORDS)"
    );
    /// Mask of valid bits in the last live word (all-ones when CAPACITY is a
    /// multiple of 64; otherwise zeros in the high padding bits).
    const LAST_WORD_MASK: usize = {
        let rem = CAPACITY % WORD_BITS;
        if rem == 0 {
            usize::MAX
        } else {
            (1usize << rem) - 1
        }
    };

    pub const fn init_empty() -> Self {
        Self {
            masks: [const { Cell::new(0) }; HIVE_BITSET_WORDS],
        }
    }

    #[inline]
    pub fn is_set(&self, index: usize) -> bool {
        debug_assert!(index < CAPACITY);
        (self.masks[index / WORD_BITS].get() >> (index % WORD_BITS)) & 1 != 0
    }

    /// `pub(crate)` — toggling occupancy from outside `HiveArray` while a
    /// `HiveSlot`/`HiveBox` for the same index is alive would let a
    /// re-`claim()` alias it. Use [`HiveArray::claim`]/[`alloc`](HiveArray::alloc)/
    /// [`put`](HiveArray::put)/[`box_at`](HiveArray::box_at).
    #[inline]
    pub(crate) fn set(&self, index: usize) {
        debug_assert!(index < CAPACITY);
        let w = index / WORD_BITS;
        self.masks[w].set(self.masks[w].get() | (1usize << (index % WORD_BITS)));
    }

    /// `pub(crate)` — see [`set`](Self::set).
    #[inline]
    pub(crate) fn unset(&self, index: usize) {
        debug_assert!(index < CAPACITY);
        let w = index / WORD_BITS;
        self.masks[w].set(self.masks[w].get() & !(1usize << (index % WORD_BITS)));
    }

    #[inline]
    pub fn find_first_set(&self) -> Option<usize> {
        let mut i = 0;
        while i < Self::NUM_WORDS {
            let m = self.masks[i].get();
            if m != 0 {
                return Some(i * WORD_BITS + m.trailing_zeros() as usize);
            }
            i += 1;
        }
        None
    }

    #[inline]
    pub fn find_first_unset(&self) -> Option<usize> {
        let mut i = 0;
        while i < Self::NUM_WORDS {
            let live_mask = if i + 1 == Self::NUM_WORDS {
                Self::LAST_WORD_MASK
            } else {
                usize::MAX
            };
            let inv = !self.masks[i].get() & live_mask;
            if inv != 0 {
                return Some(i * WORD_BITS + inv.trailing_zeros() as usize);
            }
            i += 1;
        }
        None
    }

    /// Forward iterator over set bits. Mirrors `IntegerBitSet::iter_set`.
    #[inline]
    pub fn iter_set(&self) -> HiveBitSetIter<CAPACITY> {
        self.iterator::<true, true>()
    }

    /// Signature mirrors `IntegerBitSet::iterator` so existing
    /// `hive.used.iterator::<true, true>()` callers compile unchanged. Only
    /// the `<KIND_SET=true, DIR_FWD=true>` combination is implemented (the
    /// only one used in-tree); other params assert.
    #[inline]
    pub fn iterator<const KIND_SET: bool, const DIR_FWD: bool>(&self) -> HiveBitSetIter<CAPACITY> {
        const {
            assert!(
                KIND_SET && DIR_FWD,
                "HiveBitSet::iterator only supports <true,true>"
            )
        };
        // Snapshot the live words into a non-`Cell` array so the iterator can
        // outlive transient mutations of the source bitset.
        HiveBitSetIter {
            masks: self.masks.each_ref().map(Cell::get),
            word: 0,
        }
    }
}

pub struct HiveBitSetIter<const CAPACITY: usize> {
    masks: [usize; HIVE_BITSET_WORDS],
    word: usize,
}

impl<const CAPACITY: usize> HiveBitSetIter<CAPACITY> {
    #[inline]
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> Option<usize> {
        while self.word < HiveBitSet::<CAPACITY>::NUM_WORDS {
            let m = self.masks[self.word];
            if m != 0 {
                let bit = m.trailing_zeros() as usize;
                self.masks[self.word] &= m - 1;
                return Some(self.word * WORD_BITS + bit);
            }
            self.word += 1;
        }
        None
    }
}

/// An array that efficiently tracks which elements are in use.
/// The pointers are intended to be stable
/// Sorta related to https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2021/p0447r15.html
///
/// All slot operations take `&self` and the buffer is `UnsafeCell` — slot
/// pointers come from `UnsafeCell::get()` and so survive `&self` reborrows of
/// the pool (the `bumpalo` / `typed-arena` shape). `HiveArray` is `!Sync`.
// PORT NOTE: Zig's `capacity: u16` is widened to `usize` here because Rust array
// lengths require a `usize` const generic on stable.
pub struct HiveArray<T, const CAPACITY: usize> {
    buffer: UnsafeCell<[MaybeUninit<T>; CAPACITY]>,
    pub used: HiveBitSet<CAPACITY>,
}

impl<T, const CAPACITY: usize> HiveArray<T, CAPACITY> {
    pub const SIZE: usize = CAPACITY;

    // PORT NOTE: Zig had `pub var empty: Self` as a mutable static to work around
    // https://github.com/ziglang/zig/issues/22462 and /21988. Rust has no such
    // limitation; callers should use `init()` (which is `const`).

    pub const fn init() -> Self {
        Self {
            buffer: UnsafeCell::new([const { MaybeUninit::uninit() }; CAPACITY]),
            used: HiveBitSet::init_empty(),
        }
    }

    /// Placement-new constructor: write the empty state directly into `*out`
    /// without materializing `Self` on the stack.
    ///
    /// `Self` embeds `[MaybeUninit<T>; CAPACITY]` inline, which for the
    /// install pools (`NetworkTask` × 128, `Task` × 64) is hundreds of KB.
    /// Rust has no result-location semantics, so `out.write(Self::init())`
    /// first builds the value in the caller's frame and `memcpy`s it — LLVM
    /// does **not** elide that temporary. This entry point only writes the
    /// 256 B `used` bitset; `buffer` is `MaybeUninit` and needs no
    /// initialization (uninitialized bytes are a valid bit-pattern for it).
    ///
    /// # Safety
    /// `out` must be non-null, properly aligned, and valid for writes of
    /// `size_of::<Self>()` bytes. The previous contents are not dropped.
    #[inline]
    pub unsafe fn init_in_place(out: *mut Self) {
        // SAFETY: caller contract — `out` is aligned and writable; only the
        // `used` field is projected and written.
        unsafe {
            core::ptr::addr_of_mut!((*out).used).write(HiveBitSet::init_empty());
        }
        // `buffer: UnsafeCell<[MaybeUninit<T>; CAPACITY]>` intentionally untouched.
    }

    /// Raw pointer to slot `index`. Carries the buffer's `UnsafeCell` tag so
    /// it survives later `&self` reborrows. Safe to obtain; deref requires
    /// the slot to be claimed and initialized.
    #[inline]
    pub fn ptr_at(&self, index: usize) -> *mut T {
        // `assert!`, not `debug_assert!` — `ptr.add()` past the end is UB, not
        // a panic, in release builds. Keep this a safe `pub fn`.
        assert!(index < CAPACITY);
        // SAFETY: `index < CAPACITY` (asserted above); in-bounds offset.
        unsafe {
            self.buffer
                .get()
                .cast::<MaybeUninit<T>>()
                .add(index)
                .cast::<T>()
        }
    }

    /// Allocate a slot as a single-owner [`HiveBox`]. `None` if the inline
    /// hive is full.
    #[inline]
    pub fn alloc(&self, value: T) -> Option<HiveBox<'_, T, CAPACITY>> {
        let index = self.used.find_first_unset()?;
        self.used.set(index);
        let p = self.ptr_at(index);
        asan::unpoison(p.cast(), size_of::<T>());
        // SAFETY: `index` was just claimed; the slot is in-bounds and unaliased.
        unsafe { p.write(value) };
        Some(HiveBox {
            // SAFETY: `ptr_at` never returns null (in-bounds offset into `buffer`).
            slot: unsafe { NonNull::new_unchecked(p) },
            owner: self,
        })
    }

    /// Recover a [`HiveBox`] for a slot previously allocated via [`alloc`](Self::alloc)
    /// whose [`index()`](HiveBox::index) was stored across a callback. `None`
    /// if `index` is out of bounds or the slot is free — a stale index is
    /// `None`, not UB.
    ///
    /// # Safety
    /// The slot at `index`, if occupied, must hold a fully-initialized `T`,
    /// and no other live access path ([`HiveSlot`], [`HiveBox`], `*mut T`) to
    /// it may exist. The bitset check cannot prove this: [`claim`](Self::claim)
    /// and the deprecated [`get`](Self::get) family set the `used` bit *before*
    /// the slot is written, so safe code holding a claim token can have an
    /// occupied-but-uninit slot. Pools that only use [`alloc`](Self::alloc)/
    /// [`get_init`](Self::get_init) (which write before returning) trivially
    /// satisfy this.
    #[inline]
    pub unsafe fn box_at(&self, index: usize) -> Option<HiveBox<'_, T, CAPACITY>> {
        if index >= CAPACITY || !self.used.is_set(index) {
            return None;
        }
        Some(HiveBox {
            // SAFETY: `index < CAPACITY` (checked above); `ptr_at` is in-bounds.
            slot: unsafe { NonNull::new_unchecked(self.ptr_at(index)) },
            owner: self,
        })
    }

    /// Claim a slot and return a raw pointer to its **uninitialized** storage.
    ///
    /// Prefer [`get_init`](Self::get_init) / [`emplace`](Self::emplace) /
    /// [`claim`](Self::claim), which encode the "a `used` slot is always
    /// fully initialized" invariant in the type system. This entry point
    /// hands out `*mut T` to garbage; forming `&mut T` over it is instant UB
    /// when `T` has niche-bearing fields, and an early return between `get()`
    /// and the caller's `ptr::write` leaves the slot claimed-but-uninit so a
    /// later [`put`](Self::put) drops garbage.
    #[deprecated = "returns *mut T to uninitialized memory; use get_init / emplace / claim"]
    pub fn get(&self) -> Option<*mut T> {
        let index = self.used.find_first_unset()?;
        self.used.set(index);
        let ret = self.ptr_at(index);
        asan::unpoison(ret.cast(), size_of::<T>());
        Some(ret)
    }

    /// One-shot claim + write. Preferred entry point — no uninit window.
    ///
    /// Returns `None` (and does **not** consume `value`'s slot) if the hive
    /// is full; on `None` the caller still owns `value` and must drop it.
    #[inline]
    pub fn get_init(&self, value: T) -> Option<NonNull<T>> {
        Some(self.claim()?.write(value))
    }

    /// Claim + write where `T` is self-referential on its own slot address
    /// (e.g. a struct that registers itself as a uws/libuv user-data pointer
    /// inside its own constructor). `init` receives the slot's stable address
    /// and must return the value to be stored there.
    #[inline]
    pub fn emplace(&self, init: impl FnOnce(NonNull<T>) -> T) -> Option<NonNull<T>> {
        let slot = self.claim()?;
        let addr = slot.addr();
        Some(slot.write(init(addr)))
    }

    /// Low-level reservation. Only when [`get_init`](Self::get_init) /
    /// [`emplace`](Self::emplace) are insufficient — typically when the caller
    /// must interleave fallible work between claim and commit, or perform
    /// `repr(C)` placement-new via [`HiveSlot::as_uninit`].
    pub fn claim(&self) -> Option<HiveSlot<'_, T, CAPACITY>> {
        let index = self.used.find_first_unset()?;
        self.used.set(index);
        // SAFETY: `index < CAPACITY` ⇒ in-bounds; `UnsafeCell::get` is non-null.
        let slot = unsafe {
            NonNull::new_unchecked(self.buffer.get().cast::<MaybeUninit<T>>().add(index))
        };
        asan::unpoison(slot.as_ptr().cast(), size_of::<T>());
        Some(HiveSlot {
            slot,
            owner: core::ptr::from_ref(self),
            _marker: PhantomData,
        })
    }

    /// Recycle a slot **without** running `T::drop`. If `value` does not point
    /// into this hive, returns `false` and is a no-op. Use when the caller has
    /// already moved the contents out / destructured them, or when `T` is POD
    /// and the slot is being released on an error path before it was fully
    /// initialized (Zig `value.* = undefined`).
    ///
    /// # Safety
    /// No live token ([`HiveSlot`], [`HiveBox`]) may exist for this slot — once
    /// the `used` bit is cleared, [`alloc`](Self::alloc)/[`claim`](Self::claim)
    /// can hand it out again, aliasing the stale token's `DerefMut`/`Drop`.
    pub unsafe fn put_raw(&self, value: *mut T) -> bool {
        let Some(index) = self.index_of(value) else {
            return false;
        };
        debug_assert!(self.used.is_set(index as usize));
        asan::poison(value.cast(), size_of::<T>());
        self.used.unset(index as usize);
        true
    }

    pub fn at(&self, index: u16) -> *mut T {
        debug_assert!((index as usize) < CAPACITY);
        let ret = self.ptr_at(index as usize);
        asan::assert_unpoisoned(ret.cast::<u8>());
        ret
    }

    pub fn index_of(&self, value: *const T) -> Option<u32> {
        asan::assert_unpoisoned(value.cast::<u8>());
        let start = self.buffer.get().cast::<T>();
        // One-past-the-end pointer of `buffer`; `wrapping_add` is sound for
        // the in-allocation offset and matches `add` exactly here.
        let end = start.wrapping_add(CAPACITY);
        if !((value as usize) >= (start as usize) && (value as usize) < (end as usize)) {
            return None;
        }

        // aligned to the size of T
        let index = ((value as usize) - (start as usize)) / size_of::<T>();
        debug_assert!(index < CAPACITY);
        debug_assert!(self.ptr_at(index).cast_const() == value);
        Some(u32::try_from(index).expect("int cast"))
    }

    pub fn r#in(&self, value: *const T) -> bool {
        asan::assert_unpoisoned(value.cast::<u8>());
        let start = self.buffer.get().cast::<T>();
        let end = start.wrapping_add(CAPACITY);
        (value as usize) >= (start as usize) && (value as usize) < (end as usize)
    }

    /// Return a slot to the pool, dropping the contained `T` in place.
    ///
    /// Returns `false` (and drops nothing) if `value` does not point into
    /// this hive's buffer.
    ///
    /// # Safety
    /// If `value` points into this hive, it must point to a fully-initialized
    /// `T` previously obtained via [`get`](Self::get) and written by the
    /// caller. The slot is dropped in place; passing a moved-from or
    /// uninitialized slot is UB for `T` with drop glue.
    pub unsafe fn put(&self, value: *mut T) -> bool {
        let Some(index) = self.index_of(value) else {
            return false;
        };

        debug_assert!(self.used.is_set(index as usize));
        debug_assert!(self.ptr_at(index as usize).cast_const() == value.cast_const());

        // PORT NOTE: Zig wrote `value.* = undefined;` — Zig has no destructors,
        // so the slot was simply marked logically uninitialized. In the Rust
        // port several `T` carry owned heap data (e.g. `NumberScope.name_counts:
        // StringHashMap`, `NetworkTask.url_buf: Box<[u8]>`); drop the slot
        // before recycling so the put/get cycle does not leak it. Callers that
        // pre-clean fields (`PooledSocket::release_parked_refs`) leave only
        // trivially-droppable residuals, so this is idempotent for them.
        // SAFETY: caller contract — `value` is a fully-initialized `T` in `buffer`.
        unsafe { core::ptr::drop_in_place(value) };
        asan::poison(value.cast(), size_of::<T>());

        self.used.unset(index as usize);
        true
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HiveSlot
// ──────────────────────────────────────────────────────────────────────────

/// Linear reservation token for a claimed-but-uninitialized hive slot.
///
/// `HiveArray` slots are `[MaybeUninit<T>; CAP]`. The legacy [`HiveArray::get`]
/// contract was two-phase — claim a `*mut T` to garbage, then `ptr::write` it
/// — which opened three UB hazards in the gap: (H1) early-return / `?` / panic
/// leaves the slot claimed-uninit so a later `put()` drops garbage; (H2)
/// `&mut *p` over uninit `T` is instant validity UB when `T` has niches; (H3)
/// partial field-write then `assume_init_ref` on the whole slot.
///
/// `HiveSlot` encodes the invariant **"a `used` slot is always fully
/// initialized"** in the type system: you cannot obtain the stable
/// initialized `*mut T` without going through [`write`](Self::write) (or the
/// `unsafe` [`assume_init`](Self::assume_init) escape hatch). If the token is
/// dropped (early return, `?`, panic) the slot is released **without** running
/// `T::drop` — it was never written.
///
/// Two-pointer-sized; `owner` discriminates release behavior:
///   - non-null ⇒ `*const HiveArray<T, CAP>` (release = unset `used` bit + poison),
///   - null     ⇒ heap `Box<MaybeUninit<T>>` (release = dealloc, no `T::drop`).
#[must_use = "claimed hive slot is leaked if neither written nor dropped"]
pub struct HiveSlot<'h, T, const CAPACITY: usize> {
    slot: NonNull<MaybeUninit<T>>,
    /// Typed `*const` (not `usize` + low-bit tag) so provenance survives `Drop`.
    /// Null = heap-fallback sentinel (`from_ref(self)` is never null).
    owner: *const HiveArray<T, CAPACITY>,
    _marker: PhantomData<&'h HiveArray<T, CAPACITY>>,
}

impl<'h, T, const CAPACITY: usize> HiveSlot<'h, T, CAPACITY> {
    /// Stable address of the slot. Safe to capture (e.g. register as a
    /// libuv/uws user-data pointer) **before** [`write`](Self::write), as long
    /// as nothing dereferences it until after `write()`.
    #[inline]
    pub fn addr(&self) -> NonNull<T> {
        self.slot.cast::<T>()
    }

    /// `&mut MaybeUninit<T>` for piecewise init via `addr_of_mut!`. Prefer
    /// [`write`](Self::write).
    ///
    /// # Safety
    /// No other live access path to this slot may exist. With `&self` pool
    /// receivers, `HiveSlot` no longer holds an exclusive borrow of the hive,
    /// so the borrowck cannot prove uniqueness — the caller must (e.g. don't
    /// `unset()` the slot's `used` bit and re-`claim()` it while this token is
    /// alive).
    #[inline]
    pub unsafe fn as_uninit(&mut self) -> &mut MaybeUninit<T> {
        // SAFETY: caller contract (above).
        unsafe { self.slot.as_mut() }
    }

    /// Move `value` into the slot and return the stable initialized pointer.
    /// Consumes the token (its `Drop` does not run).
    #[inline]
    pub fn write(self, value: T) -> NonNull<T> {
        let this = ManuallyDrop::new(self);
        let p = this.slot.cast::<T>();
        // SAFETY: `slot` is a unique claimed reservation; nothing reads through
        // it before this write. Writing through the raw ptr (not `&mut`) keeps
        // the `UnsafeCell` tag alive for callers holding sibling slot pointers.
        unsafe { p.as_ptr().write(value) };
        p
    }

    /// Caller has fully initialized the slot via [`as_uninit`](Self::as_uninit)
    /// (or by writing through [`addr`](Self::addr)). Consumes the token.
    ///
    /// # Safety
    /// Every field of `T` must be initialized, including padding-adjacent
    /// niches (enum discriminants, `NonNull`, `Box`, `&`). Calling this on a
    /// partially-written slot is the exact UB this type exists to prevent.
    #[inline]
    pub unsafe fn assume_init(self) -> NonNull<T> {
        let this = ManuallyDrop::new(self);
        this.slot.cast::<T>()
    }
}

impl<T, const CAPACITY: usize> Drop for HiveSlot<'_, T, CAPACITY> {
    fn drop(&mut self) {
        if !self.owner.is_null() {
            // Inline hive slot: unset the `used` bit and re-poison. Do NOT
            // `drop_in_place` — the slot was never `.write()`n.
            let hive = self.owner;
            // SAFETY: `owner` was set from `from_ref(self)` in `HiveArray::claim`
            // and the hive outlives `'h` (PhantomData lifetime).
            unsafe {
                let index = (*hive)
                    .index_of(self.slot.as_ptr().cast::<T>())
                    .expect("HiveSlot points outside its owning hive");
                asan::poison(self.slot.as_ptr().cast(), size_of::<T>());
                (*hive).used.unset(index as usize);
            }
        } else {
            // Heap fallback slot: reclaim the `Box<MaybeUninit<T>>` allocation.
            // `MaybeUninit<T>` has no drop glue, so this deallocates without
            // touching `T`.
            // SAFETY: `slot` was produced by `Box::leak(Box::<MaybeUninit<T>>::new_uninit())`
            // in `Fallback::claim` and has not been freed.
            drop(unsafe { Box::from_raw(self.slot.as_ptr()) });
        }
    }
}

/// Single-owner handle to an initialized [`HiveArray`] slot. `Box<T>`-shaped:
/// `Drop` returns the slot to the pool, [`into_inner`](Self::into_inner)
/// extracts the value. Single-owner (no `Clone`), so [`DerefMut`] is sound.
///
/// For pools whose tokens cross an opaque round-trip as a slot *index* (e.g.
/// the c-ares callback context in `dns_jsc`), store [`index()`](Self::index)
/// and recover via [`HiveArray::box_at`].
pub struct HiveBox<'a, T, const CAPACITY: usize> {
    slot: NonNull<T>,
    owner: &'a HiveArray<T, CAPACITY>,
}

impl<'a, T, const CAPACITY: usize> HiveBox<'a, T, CAPACITY> {
    /// Slot index in the owning pool, for storage in an opaque callback context.
    #[inline]
    pub fn index(&self) -> usize {
        // `slot` always points into `owner.buffer`, so `index_of` never fails.
        self.owner
            .index_of(self.slot.as_ptr())
            .expect("HiveBox slot in owner") as usize
    }

    /// Extract the value, freeing the slot. Inverse of [`HiveArray::alloc`].
    #[inline]
    pub fn into_inner(self) -> T {
        let this = ManuallyDrop::new(self);
        // SAFETY: `slot` is a fully-initialized `T` exclusively owned by this box.
        let value = unsafe { core::ptr::read(this.slot.as_ptr()) };
        // SAFETY: `this` is being consumed — no other token for this slot exists.
        unsafe { this.owner.put_raw(this.slot.as_ptr()) };
        value
    }
}

impl<T, const CAPACITY: usize> Deref for HiveBox<'_, T, CAPACITY> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: `slot` is a fully-initialized, exclusively-owned `T`.
        unsafe { self.slot.as_ref() }
    }
}

impl<T, const CAPACITY: usize> core::ops::DerefMut for HiveBox<'_, T, CAPACITY> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: `slot` is a fully-initialized, exclusively-owned `T`; no
        // `Clone` impl, so this is the only `&mut` access path.
        unsafe { self.slot.as_mut() }
    }
}

impl<T, const CAPACITY: usize> Drop for HiveBox<'_, T, CAPACITY> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `slot` is a fully-initialized `T` owned by this box; `put`
        // drops it in place and frees the slot.
        unsafe { self.owner.put(self.slot.as_ptr()) };
    }
}

// PORT NOTE: In Zig this was the nested type `HiveArray(T, capacity).Fallback`.
// Rust cannot nest a generic struct that captures outer generics, so it lives at
// module scope with the same parameters. The Zig field
// `hive: if (capacity > 0) Self else void` is always materialized here; the
// `CAPACITY > 0` checks below preserve the original gating.
// PERF(port): zero-capacity case carried a zero-size hive in Zig — profile in Phase B.
pub struct Fallback<T, const CAPACITY: usize> {
    pub hive: HiveArray<T, CAPACITY>,
    // PORT NOTE: `std.mem.Allocator param` dropped — global mimalloc.
}

impl<T, const CAPACITY: usize> Fallback<T, CAPACITY> {
    pub const fn init() -> Self {
        Self {
            hive: HiveArray::init(),
        }
    }

    /// Placement-new constructor — see [`HiveArray::init_in_place`]. Only
    /// writes the 256 B occupancy bitset; the `[MaybeUninit<T>; CAPACITY]`
    /// buffer is left untouched.
    ///
    /// # Safety
    /// `out` must be non-null, properly aligned, and valid for writes of
    /// `size_of::<Self>()` bytes. The previous contents are not dropped.
    #[inline]
    pub unsafe fn init_in_place(out: *mut Self) {
        // SAFETY: caller contract.
        unsafe { HiveArray::<T, CAPACITY>::init_in_place(core::ptr::addr_of_mut!((*out).hive)) };
    }

    /// Heap-allocate an empty `Fallback` without materializing it on the
    /// stack first.
    ///
    /// `Box::new(Self::init())` is the obvious spelling, but Rust has no
    /// guaranteed result-location semantics: for the 2048-slot
    /// `RequestContext` pool (`sizeof ≈ 816 KB`) LLVM emits the bitset
    /// zeros into a stack temporary and then `memcpy`s the **full** 816 KB
    /// into the heap allocation, committing both ~812 KB of stack pages and
    /// ~812 KB of heap pages that are never read. This entry point allocates
    /// raw heap storage and writes only the 256-byte `used` bitset via
    /// [`init_in_place`](Self::init_in_place); the `[MaybeUninit<T>; CAPACITY]`
    /// buffer is left untouched (uninitialized bytes are a valid bit-pattern
    /// for `MaybeUninit`).
    ///
    /// The returned allocation is leaked — callers stash it in a per-thread
    /// static for the process lifetime (Zig: `threadlocal var pool`).
    #[inline]
    pub fn new_boxed() -> NonNull<Self> {
        let mut boxed = Box::<Self>::new_uninit();
        // SAFETY: `boxed` is a fresh heap allocation — non-null, aligned for
        // `Self`, and valid for writes of `size_of::<Self>()` bytes.
        unsafe { Self::init_in_place(boxed.as_mut_ptr()) };
        // SAFETY: `init_in_place` fully initialized `hive.used`; `hive.buffer`
        // is `[MaybeUninit<T>; CAPACITY]`, for which uninitialized bytes are a
        // valid representation. Every field of `Self` is therefore valid.
        NonNull::from(Box::leak(unsafe { boxed.assume_init() }))
    }

    /// See [`HiveArray::get`] — same UB hazards, plus the heap path leaks a
    /// `Box<MaybeUninit<T>>` if the caller early-returns before `ptr::write`.
    #[deprecated = "returns *mut T to uninitialized memory; use get_init / emplace / claim"]
    pub fn get(&self) -> *mut T {
        // Forget the token so its `Drop` does not release the slot — legacy
        // callers expect the slot to remain claimed until their later `put()`.
        ManuallyDrop::new(self.claim()).addr().as_ptr()
    }

    #[deprecated = "returns *mut T to uninitialized memory; use get_init / emplace / claim"]
    pub fn get_and_see_if_new(&self, new: &mut bool) -> *mut T {
        if CAPACITY > 0 {
            #[allow(deprecated)]
            if let Some(value) = self.hive.get() {
                *new = false;
                return value;
            }
        }

        bun_core::heap::into_raw(Box::<T>::new_uninit()).cast::<T>()
    }

    #[deprecated = "returns *mut T to uninitialized memory; use get_init / emplace / claim"]
    pub fn try_get(&self) -> *mut T {
        ManuallyDrop::new(self.claim()).addr().as_ptr()
    }

    /// One-shot claim + write. Preferred entry point — no uninit window.
    /// Infallible: spills to a heap `Box<T>` when the inline hive is full.
    #[inline]
    pub fn get_init(&self, value: T) -> NonNull<T> {
        self.claim().write(value)
    }

    /// See [`HiveArray::emplace`]. Infallible (heap fallback).
    #[inline]
    pub fn emplace(&self, init: impl FnOnce(NonNull<T>) -> T) -> NonNull<T> {
        let slot = self.claim();
        let addr = slot.addr();
        slot.write(init(addr))
    }

    /// See [`HiveArray::claim`]. Infallible: when the inline hive is full,
    /// the returned token owns a freshly-allocated heap slot (tagged so its
    /// `Drop` deallocates without running `T::drop`).
    pub fn claim(&self) -> HiveSlot<'_, T, CAPACITY> {
        if CAPACITY > 0 {
            if let Some(slot) = self.hive.claim() {
                return slot;
            }
        }
        let slot = NonNull::from(Box::leak(Box::<T>::new_uninit()));
        HiveSlot {
            slot,
            // Null ⇒ heap slot. The hive pointer is not needed on the release
            // path (dealloc is `Box::from_raw(slot)`).
            owner: core::ptr::null(),
            _marker: PhantomData,
        }
    }

    /// Recycle a slot **without** running `T::drop`. Counterpart to
    /// [`HiveArray::put_raw`] for the heap-fallback path.
    ///
    /// # Safety
    /// `value` must have been obtained from this `Fallback` (via `get_init` /
    /// `emplace` / `claim().write()` / the deprecated `get` family) and not
    /// yet returned. The contained `T` is **not** dropped — caller must have
    /// already moved out / destructured anything with drop glue, or `T` must
    /// be POD.
    pub unsafe fn put_raw(&self, value: *mut T) {
        if CAPACITY > 0 {
            // SAFETY: caller contract (this fn is `unsafe`).
            if unsafe { self.hive.put_raw(value) } {
                return;
            }
        }
        // SAFETY: caller contract — `value` is a heap slot from `claim()` /
        // `get()`; it was allocated as `Box<MaybeUninit<T>>` (same layout as
        // `Box<T>`). Reclaiming as `MaybeUninit<T>` deallocates without
        // running `T::drop`.
        drop(unsafe { Box::from_raw(value.cast::<MaybeUninit<T>>()) });
    }

    pub fn r#in(&self, value: *const T) -> bool {
        if CAPACITY > 0 {
            if self.hive.r#in(value) {
                return true;
            }
        }

        false
    }

    /// Return a slot to the pool, dropping the contained `T`.
    ///
    /// # Safety
    /// `value` must point to a fully-initialized `T` previously obtained from
    /// [`get`](Self::get) / [`get_and_see_if_new`](Self::get_and_see_if_new) /
    /// [`try_get`](Self::try_get) on this `Fallback` and subsequently written
    /// by the caller.
    pub unsafe fn put(&self, value: *mut T) {
        if CAPACITY > 0 {
            // SAFETY: caller contract — `value` is fully initialized.
            if unsafe { self.hive.put(value) } {
                return;
            }
        }

        // SAFETY: `value` was produced by the heap-fallback path of `claim()` /
        // `get()` (it is not in the hive), and the caller has since fully
        // initialized it. `destroy` reconstructs the `Box<T>` and runs `T::drop`.
        unsafe { bun_core::heap::destroy(value) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HiveRef
// ──────────────────────────────────────────────────────────────────────────
//
// PORT NOTE: ground truth is `bun.HiveRef` in src/bun.zig. It lives here (not
// in the `bun` crate) because every consumer names it through
// `bun_collections::HiveRef`, and its only collaborator is `Fallback` above.
//
// Zig defines `const HiveAllocator = HiveArray(@This(), capacity).Fallback`
// inside the returned struct; Rust spells the self-referential pool type out
// as `Fallback<HiveRef<T, CAPACITY>, CAPACITY>`. CAPACITY is `usize` (widened
// from Zig's `u16`) to line up with `HiveArray`/`Fallback`'s const generic.

/// Intrusive ref-counted slot allocated from a `HiveArray::Fallback` pool.
/// `pool` is a BACKREF (LIFETIMES.tsv class) — the pool strictly outlives
/// every `HiveRef` it hands out, so a raw pointer is the honest mapping.
///
/// Prefer [`HiveRefHandle`] in new code; the raw `init`/`ref_`/`unref` family
/// remains for FFI ingress points that hold the slot as a `*mut HiveRef`.
#[repr(C)]
pub struct HiveRef<T, const CAPACITY: usize> {
    pub ref_count: Cell<u32>,
    pub pool: *const Fallback<HiveRef<T, CAPACITY>, CAPACITY>,
    pub value: T,
}

impl<T, const CAPACITY: usize> HiveRef<T, CAPACITY> {
    /// Zig: `pub fn init(value, allocator) !*@This()`.
    ///
    /// # Safety
    /// `pool` must be valid for the entire lifetime of the returned
    /// `HiveRef` (i.e. until its `ref_count` drops to zero and it is `put`
    /// back). Callers hold the pool in a long-lived owner (e.g. `VirtualMachine`).
    pub unsafe fn init(value: T, pool: *const Fallback<Self, CAPACITY>) -> *mut Self {
        // SAFETY: caller contract — `pool` is dereferenceable.
        unsafe {
            (*pool)
                .get_init(HiveRef {
                    ref_count: Cell::new(1),
                    pool,
                    value,
                })
                .as_ptr()
        }
    }

    #[inline]
    pub fn ref_(&self) -> &Self {
        self.ref_count.set(self.ref_count.get() + 1);
        self
    }

    /// Zig: `pub fn unref(this) ?*@This()` — returns `None` when the count hit
    /// zero and the slot was returned to the pool.
    ///
    /// # Safety
    /// `this` must point at a live `HiveRef` produced by [`init`](Self::init).
    /// On `None` the slot has been recycled — do not use `this` afterward.
    pub unsafe fn unref(this: *mut Self) -> Option<*mut Self> {
        // SAFETY: caller contract — `this` is a live `HiveRef` slot, and
        // `(*this).pool` outlives every slot it hands out (`init` contract).
        // Zig's `if @hasDecl(T, "deinit") this.value.deinit()` maps to `T::drop`,
        // which `Fallback::put` runs (drops the whole `HiveRef` in place).
        unsafe {
            let ref_count = (*this).ref_count.get();
            (*this).ref_count.set(ref_count - 1);
            if ref_count == 1 {
                let pool = (*this).pool;
                (*pool).put(this);
                return None;
            }
        }
        Some(this)
    }
}

/// Owning handle to a refcounted [`HiveRef`] pool slot. `Clone` increments,
/// `Drop` decrements and recycles when the count hits zero. Cross FFI with
/// [`into_raw`](Self::into_raw) / [`from_raw`](Self::from_raw), like `Rc`/`Box`.
pub struct HiveRefHandle<T, const CAP: usize> {
    ptr: NonNull<HiveRef<T, CAP>>,
}

impl<T, const CAP: usize> HiveRefHandle<T, CAP> {
    /// The one place the type-level invariant is asserted: a handle exists
    /// ⇒ `ref_count >= 1` ⇒ the slot is live and initialized. `Deref`/`Clone`
    /// route through here so they're plain safe code.
    #[inline]
    fn slot(&self) -> &HiveRef<T, CAP> {
        // SAFETY: type invariant (above).
        unsafe { self.ptr.as_ref() }
    }

    /// Allocate a slot from `pool` with refcount 1.
    ///
    /// # Safety
    /// `pool` must outlive every handle/raw pointer derived from it.
    pub unsafe fn new(value: T, pool: *const Fallback<HiveRef<T, CAP>, CAP>) -> Self {
        // SAFETY: caller contract — `pool` is dereferenceable + outlives the slot.
        let ptr = unsafe { HiveRef::init(value, pool) };
        Self {
            ptr: NonNull::new(ptr).expect("Fallback::get_init returned null"),
        }
    }

    /// Hand the slot to FFI without decrementing. Pair with [`from_raw`].
    #[inline]
    pub fn into_raw(self) -> *mut HiveRef<T, CAP> {
        ManuallyDrop::new(self).ptr.as_ptr()
    }

    /// Reclaim ownership of a `+1` ref returned by [`into_raw`].
    ///
    /// # Safety
    /// `ptr` must be a live slot whose `+1` has not already been released.
    #[inline]
    pub unsafe fn from_raw(ptr: *mut HiveRef<T, CAP>) -> Self {
        Self {
            ptr: NonNull::new(ptr).expect("HiveRefHandle::from_raw(null)"),
        }
    }

    /// Raw pointer for FFI/intrusive use. Does not affect the refcount.
    #[inline]
    pub fn as_ptr(&self) -> *mut HiveRef<T, CAP> {
        self.ptr.as_ptr()
    }

    /// Exclusive access to the payload. `None` if there are other live handles
    /// — same shape as [`Rc::get_mut`](std::rc::Rc::get_mut). A blanket
    /// `DerefMut` would be unsound: `Clone` takes `&self`, so a second handle
    /// could be made while a `&mut T` from `deref_mut()` is outstanding.
    #[inline]
    pub fn get_mut(&mut self) -> Option<&mut T> {
        if self.slot().ref_count.get() != 1 {
            return None;
        }
        // SAFETY: refcount == 1 ⇒ this handle is the only owner; `&mut self`
        // proves no other access path through it.
        Some(unsafe { &mut (*self.ptr.as_ptr()).value })
    }
}

impl<T, const CAP: usize> Deref for HiveRefHandle<T, CAP> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        &self.slot().value
    }
}

impl<T, const CAP: usize> Clone for HiveRefHandle<T, CAP> {
    #[inline]
    fn clone(&self) -> Self {
        self.slot().ref_();
        Self { ptr: self.ptr }
    }
}

impl<T, const CAP: usize> Drop for HiveRefHandle<T, CAP> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: type invariant — `ptr` is live; `unref` recycles on count==0.
        unsafe { HiveRef::unref(self.ptr.as_ptr()) };
    }
}

#[cfg(test)]
#[allow(deprecated)]
mod tests {
    use super::*;

    #[test]
    fn hive_array() {
        const SIZE: usize = 64;

        // Choose an integer with a weird alignment
        // PORT NOTE: Zig used `u127`; Rust has no arbitrary-width ints. `u128` is the closest.
        type Int = u128;

        let a = HiveArray::<Int, SIZE>::init();

        {
            let b = a.get().unwrap();
            // SAFETY: `b` points into `a.buffer` and was just unpoisoned by `get()`.
            unsafe { *b = 0 };
            assert!(a.get().unwrap() != b);
            assert_eq!(a.index_of(b), Some(0));
            // SAFETY: `b` is a fully-initialized hive slot.
            assert!(unsafe { a.put(b) });
            assert!(a.get().unwrap() == b);
            let c = a.get().unwrap();
            // SAFETY: `c` points into `a.buffer` and was just unpoisoned by `get()`.
            unsafe { *c = 123 };
            let mut d: Int = 12345;
            // SAFETY: `&mut d` is foreign — `put` returns `false` and drops nothing.
            assert!(unsafe { a.put(&mut d) } == false);
            assert!(a.r#in(&d) == false);
        }

        let mut a = a;
        a.used = HiveBitSet::init_empty();
        {
            for i in 0..SIZE {
                let b = a.get().unwrap();
                // SAFETY: `b` points into `a.buffer` and was just unpoisoned by `get()`.
                unsafe { *b = 0 };
                assert_eq!(a.index_of(b), Some(u32::try_from(i).expect("int cast")));
                // SAFETY: `b` is a fully-initialized hive slot.
                assert!(unsafe { a.put(b) });
                assert!(a.get().unwrap() == b);
            }
            for _ in 0..SIZE {
                assert!(a.get().is_none());
            }
        }
    }

    /// Drop-counting payload. Each test that needs it owns its own `Cell` so
    /// tests stay independent (`AtomicU32` static would leak counts across
    /// tests run in the same process).
    struct Tracked<'c> {
        v: u64,
        drops: &'c core::cell::Cell<u32>,
    }
    impl Drop for Tracked<'_> {
        fn drop(&mut self) {
            self.drops.set(self.drops.get() + 1);
        }
    }

    #[test]
    fn hive_slot_drop_releases_without_dtor() {
        let drops = core::cell::Cell::new(0u32);
        let mk = |v| Tracked { v, drops: &drops };

        let a = HiveArray::<Tracked, 4>::init();
        // Dropped token releases the slot without running Drop.
        drop(a.claim().unwrap());
        assert!(!a.used.is_set(0));
        assert_eq!(drops.get(), 0);

        // write() commits and put() drops.
        let p = a.get_init(mk(7)).unwrap();
        assert!(a.used.is_set(0));
        assert_eq!(drops.get(), 0);
        // SAFETY: `p` is a fully-initialized hive slot.
        unsafe { a.put(p.as_ptr()) };
        assert_eq!(drops.get(), 1);

        // put_raw() does not drop.
        let p = a.get_init(mk(8)).unwrap();
        // SAFETY: `p` is the only token for its slot.
        assert!(unsafe { a.put_raw(p.as_ptr()) });
        assert_eq!(drops.get(), 1);

        // Fallback heap path: dropped token deallocates without Drop.
        let f = Fallback::<Tracked, 0>::init();
        drop(f.claim());
        assert_eq!(drops.get(), 1);
        let p = f.get_init(mk(9));
        // SAFETY: heap slot from this Fallback.
        unsafe { f.put(p.as_ptr()) };
        assert_eq!(drops.get(), 2);
    }

    #[test]
    fn emplace_sees_own_address() {
        struct SelfAddr {
            me: *const SelfAddr,
            tag: u32,
        }

        let a = HiveArray::<SelfAddr, 4>::init();
        let p = a
            .emplace(|addr| SelfAddr {
                me: addr.as_ptr(),
                tag: 1,
            })
            .unwrap();
        // SAFETY: `p` was just written by emplace.
        unsafe {
            assert_eq!((*p.as_ptr()).me, p.as_ptr().cast_const());
            assert_eq!((*p.as_ptr()).tag, 1);
        }
        // SAFETY: `p` is the only token for its slot.
        assert!(unsafe { a.put_raw(p.as_ptr()) });

        // Same on Fallback's heap path.
        let f = Fallback::<SelfAddr, 0>::init();
        let p = f.emplace(|addr| SelfAddr {
            me: addr.as_ptr(),
            tag: 2,
        });
        // SAFETY: `p` was just written by emplace; this is a heap slot.
        unsafe {
            assert_eq!((*p.as_ptr()).me, p.as_ptr().cast_const());
            assert_eq!((*p.as_ptr()).tag, 2);
            // SAFETY: `p` is the only token for its slot.
            f.put_raw(p.as_ptr());
        }
    }

    #[test]
    fn slot_addr_as_uninit_assume_init() {
        let a = HiveArray::<[u32; 2], 4>::init();

        // addr() is stable and matches the post-write pointer.
        let mut slot = a.claim().unwrap();
        let pre = slot.addr().as_ptr();
        // SAFETY: `slot` is the only token for this slot.
        unsafe { slot.as_uninit() }.write([10, 20]);
        // SAFETY: as_uninit().write() fully initialized the slot.
        let p = unsafe { slot.assume_init() };
        assert_eq!(pre, p.as_ptr());
        // SAFETY: slot is initialized.
        unsafe {
            assert_eq!(*p.as_ptr(), [10, 20]);
        }
        // SAFETY: `p` is the only token for its slot.
        assert!(unsafe { a.put_raw(p.as_ptr()) });

        // write() returns the same address as addr().
        let slot = a.claim().unwrap();
        let pre = slot.addr().as_ptr();
        let p = slot.write([30, 40]);
        assert_eq!(pre, p.as_ptr());
        // SAFETY: `p` is the only token for its slot.
        assert!(unsafe { a.put_raw(p.as_ptr()) });
    }

    #[test]
    fn at_returns_claimed_slot() {
        let a = HiveArray::<u64, 4>::init();
        let p0 = a.get_init(100).unwrap();
        let p1 = a.get_init(200).unwrap();
        assert_eq!(a.at(0), p0.as_ptr());
        assert_eq!(a.at(1), p1.as_ptr());
        assert_eq!(a.ptr_at(0), p0.as_ptr());
        assert_eq!(a.ptr_at(1), p1.as_ptr());
        // SAFETY: both slots are initialized.
        unsafe {
            assert_eq!(*a.at(0), 100);
            assert_eq!(*a.at(1), 200);
        }
        // SAFETY: only token for its slot.
        assert!(unsafe { a.put_raw(p0.as_ptr()) });
        // SAFETY: only token for its slot.
        assert!(unsafe { a.put_raw(p1.as_ptr()) });
    }

    #[test]
    fn fallback_inline_then_heap() {
        const CAP: usize = 2;
        let drops = core::cell::Cell::new(0u32);
        let mk = |v| Tracked { v, drops: &drops };

        let f = Fallback::<Tracked, CAP>::init();

        // Two inline slots, then two heap slots.
        let inline0 = f.get_init(mk(0));
        let inline1 = f.get_init(mk(1));
        let heap0 = f.get_init(mk(2));
        let heap1 = f.get_init(mk(3));

        assert!(f.r#in(inline0.as_ptr()));
        assert!(f.r#in(inline1.as_ptr()));
        assert!(!f.r#in(heap0.as_ptr()));
        assert!(!f.r#in(heap1.as_ptr()));
        // SAFETY: all four are initialized.
        unsafe {
            assert_eq!((*inline0.as_ptr()).v, 0);
            assert_eq!((*inline1.as_ptr()).v, 1);
            assert_eq!((*heap0.as_ptr()).v, 2);
            assert_eq!((*heap1.as_ptr()).v, 3);
        }

        // Return one inline, one heap — interleaved with new claims.
        // SAFETY: `inline0` and `heap0` are initialized slots from `f`.
        unsafe {
            f.put(inline0.as_ptr());
            f.put(heap0.as_ptr());
        }
        assert_eq!(drops.get(), 2);

        // The freed inline slot is reused; the freed heap slot is gone.
        let reuse = f.get_init(mk(4));
        assert_eq!(reuse.as_ptr(), inline0.as_ptr());
        assert!(f.r#in(reuse.as_ptr()));

        // SAFETY: remaining live slots.
        unsafe {
            f.put(inline1.as_ptr());
            f.put(heap1.as_ptr());
            f.put(reuse.as_ptr());
        }
        assert_eq!(drops.get(), 5);
    }

    #[test]
    fn fallback_claim_drop_inline_and_heap() {
        // Inline token: dropping releases the bit.
        let f = Fallback::<u64, 1>::init();
        drop(f.claim());
        assert!(!f.hive.used.is_set(0));

        // Heap token (CAP=0 forces it): dropping deallocates without touching
        // the hive — its `owner` is null. Pin the inline slot first so the
        // bit-stays-set assertion is meaningful for the CAP>0 case too.
        let f = Fallback::<u64, 1>::init();
        let inline = f.get_init(1);
        assert!(f.hive.used.is_set(0));
        drop(f.claim());
        assert!(f.hive.used.is_set(0));
        // SAFETY: `inline` is a live initialized slot from `f`.
        unsafe { f.put(inline.as_ptr()) };
        assert!(!f.hive.used.is_set(0));
    }

    #[test]
    fn fallback_deprecated_get_apis() {
        const CAP: usize = 1;
        let f = Fallback::<u64, CAP>::init();

        // get() / try_get(): inline first, heap after the hive fills.
        let p0 = f.get();
        assert!(f.r#in(p0));
        let p1 = f.try_get();
        assert!(!f.r#in(p1));
        // SAFETY: caller owns the uninitialized slots and writes before reading.
        unsafe {
            p0.write(11);
            p1.write(22);
            assert_eq!(*p0, 11);
            assert_eq!(*p1, 22);
            f.put(p0);
            f.put(p1);
        }

        // get_and_see_if_new(): caller pre-inits to true; flipped false on
        // an inline (recycled) hit, left true when a fresh heap box is made.
        let mut new = true;
        let p0 = f.get_and_see_if_new(&mut new);
        assert!(!new);
        let mut new = true;
        let p1 = f.get_and_see_if_new(&mut new);
        assert!(new);
        // SAFETY: same as above.
        unsafe {
            p0.write(33);
            p1.write(44);
            f.put_raw(p0);
            f.put_raw(p1);
        }
    }

    #[test]
    fn fallback_new_boxed_and_init_in_place() {
        const CAP: usize = 4;

        let boxed = Fallback::<u64, CAP>::new_boxed();
        // SAFETY: `new_boxed` returns a valid heap allocation.
        unsafe {
            let f = &*boxed.as_ptr();
            for i in 0..CAP {
                let p = f.get_init(i as u64 * 10);
                assert!(f.r#in(p.as_ptr()));
                assert_eq!(*p.as_ptr(), i as u64 * 10);
            }
            // 5th claim spills to heap.
            let p = f.get_init(999);
            assert!(!f.r#in(p.as_ptr()));
            f.put(p.as_ptr());
            // `new_boxed` is leaked by design; reclaim for the test.
            drop(Box::from_raw(boxed.as_ptr()));
        }
    }

    #[test]
    fn hive_ref_lifecycle() {
        let drops = core::cell::Cell::new(0u32);

        const CAP: usize = 2;
        type Pool<'c> = Fallback<HiveRef<Tracked<'c>, CAP>, CAP>;
        let pool: Pool = Fallback::init();
        let pool_ptr: *const Pool = &pool;

        // Inline allocation: ref to 2, unref to 1, unref to 0 → returned.
        // SAFETY: `pool` outlives every HiveRef created from `pool_ptr`.
        let r = unsafe {
            HiveRef::init(
                Tracked {
                    v: 1,
                    drops: &drops,
                },
                pool_ptr,
            )
        };
        // SAFETY: `r` is live (ref_count == 1) until the final unref returns None.
        unsafe {
            assert_eq!((*r).ref_count.get(), 1);
            (*r).ref_();
            assert_eq!((*r).ref_count.get(), 2);
            assert!(HiveRef::unref(r).is_some());
            assert_eq!((*r).ref_count.get(), 1);
            assert!(HiveRef::unref(r).is_none());
        }
        assert_eq!(drops.get(), 1);

        // Heap allocation: fill the hive first, then init another.
        // SAFETY: same pool contract.
        let inline0 = unsafe {
            HiveRef::init(
                Tracked {
                    v: 2,
                    drops: &drops,
                },
                pool_ptr,
            )
        };
        let inline1 = unsafe {
            HiveRef::init(
                Tracked {
                    v: 3,
                    drops: &drops,
                },
                pool_ptr,
            )
        };
        let heap = unsafe {
            HiveRef::init(
                Tracked {
                    v: 4,
                    drops: &drops,
                },
                pool_ptr,
            )
        };
        assert!(pool.r#in(inline0));
        assert!(pool.r#in(inline1));
        assert!(!pool.r#in(heap));
        // SAFETY: all three are live.
        unsafe {
            assert!(HiveRef::unref(heap).is_none());
            assert!(HiveRef::unref(inline1).is_none());
            assert!(HiveRef::unref(inline0).is_none());
        }
        assert_eq!(drops.get(), 4);
    }

    #[test]
    fn hive_ref_handle_lifecycle() {
        let drops = core::cell::Cell::new(0u32);

        const CAP: usize = 1;
        type Pool<'c> = Fallback<HiveRef<Tracked<'c>, CAP>, CAP>;
        let pool: Pool = Fallback::init();
        let pool_ptr: *const Pool = &pool;

        // Drop releases the slot when the count hits zero.
        // SAFETY: `pool` outlives every handle.
        let mut h = unsafe {
            HiveRefHandle::new(
                Tracked {
                    v: 1,
                    drops: &drops,
                },
                pool_ptr,
            )
        };
        assert_eq!(h.v, 1);
        // Sole owner: `get_mut` succeeds.
        h.get_mut().unwrap().v = 11;
        assert_eq!(h.v, 11);
        let h2 = h.clone();
        assert_eq!(h2.v, 11);
        // Shared: `get_mut` is `None` while another handle is live.
        assert!(h.get_mut().is_none());
        drop(h);
        assert_eq!(drops.get(), 0);
        drop(h2);
        assert_eq!(drops.get(), 1);

        // into_raw / from_raw round-trip preserves the count.
        // SAFETY: `pool` outlives every handle.
        let h = unsafe {
            HiveRefHandle::new(
                Tracked {
                    v: 2,
                    drops: &drops,
                },
                pool_ptr,
            )
        };
        let raw = h.into_raw();
        assert_eq!(drops.get(), 1);
        // SAFETY: `raw` carries a +1 from `into_raw`.
        let h = unsafe { HiveRefHandle::<Tracked, CAP>::from_raw(raw) };
        drop(h);
        assert_eq!(drops.get(), 2);

        // Heap fallback path (CAP=1, second handle spills).
        // SAFETY: `pool` outlives every handle.
        let inline = unsafe {
            HiveRefHandle::new(
                Tracked {
                    v: 3,
                    drops: &drops,
                },
                pool_ptr,
            )
        };
        let heap = unsafe {
            HiveRefHandle::new(
                Tracked {
                    v: 4,
                    drops: &drops,
                },
                pool_ptr,
            )
        };
        assert!(pool.r#in(inline.as_ptr()));
        assert!(!pool.r#in(heap.as_ptr()));
        drop(heap);
        drop(inline);
        assert_eq!(drops.get(), 4);
    }

    #[test]
    fn hive_bitset_iteration() {
        let a = HiveArray::<u8, 8>::init();
        assert_eq!(a.used.find_first_set(), None);
        assert_eq!(a.used.find_first_unset(), Some(0));

        // Claim slots 0..3, then free 0 and 2 so the set is {1, 3}.
        let s0 = a.get_init(0).unwrap();
        let _s1 = a.get_init(1).unwrap();
        let s2 = a.get_init(2).unwrap();
        let _s3 = a.get_init(3).unwrap();
        // SAFETY: only token for its slot.
        assert!(unsafe { a.put_raw(s0.as_ptr()) });
        // SAFETY: only token for its slot.
        assert!(unsafe { a.put_raw(s2.as_ptr()) });

        assert_eq!(a.used.find_first_set(), Some(1));
        assert_eq!(a.used.find_first_unset(), Some(0));

        let mut it = a.used.iter_set();
        assert_eq!(it.next(), Some(1));
        assert_eq!(it.next(), Some(3));
        assert_eq!(it.next(), None);

        // The explicit-param form is the same as iter_set().
        let mut it = a.used.iterator::<true, true>();
        assert_eq!(it.next(), Some(1));
        assert_eq!(it.next(), Some(3));
        assert_eq!(it.next(), None);
    }

    #[test]
    fn init_in_place_zeroes_only_bitset() {
        let mut a: MaybeUninit<HiveArray<u64, 4>> = MaybeUninit::uninit();
        // SAFETY: stack allocation, properly aligned, valid for writes.
        unsafe {
            HiveArray::init_in_place(a.as_mut_ptr());
            let a = &*a.as_ptr();
            assert_eq!(a.used.find_first_set(), None);
            let p = a.get_init(7).unwrap();
            assert_eq!(*p.as_ptr(), 7);
            // `p` is the only token for its slot; already inside the outer
            // `unsafe` block.
            assert!(a.put_raw(p.as_ptr()));
        }
    }

    #[test]
    fn hive_box_lifecycle() {
        let drops = core::cell::Cell::new(0u32);
        let mk = |v| Tracked { v, drops: &drops };

        let pool = HiveArray::<Tracked, 4>::init();

        // alloc → Deref/DerefMut → Drop returns the slot, drops T.
        {
            let mut b = pool.alloc(mk(1)).unwrap();
            assert_eq!(b.v, 1);
            b.v = 11;
            assert_eq!(b.v, 11);
        }
        assert_eq!(drops.get(), 1);
        assert!(!pool.used.is_set(0));

        // alloc → into_inner extracts T without running its Drop.
        let b = pool.alloc(mk(2)).unwrap();
        let i = b.index();
        let val = b.into_inner();
        assert_eq!(val.v, 2);
        assert_eq!(drops.get(), 1);
        assert!(!pool.used.is_set(i));
        drop(val);
        assert_eq!(drops.get(), 2);

        // alloc → store index → recover via box_at — the dns.rs pattern.
        let b0 = pool.alloc(mk(10)).unwrap();
        let b1 = pool.alloc(mk(20)).unwrap();
        let (i0, i1) = (b0.index(), b1.index());
        // Hand the boxes back without running Drop (the index is the token).
        core::mem::forget(b0);
        core::mem::forget(b1);
        // SAFETY: `i0`/`i1` were alloc'd above; no other access path.
        let v1 = unsafe { pool.box_at(i1) }.unwrap().into_inner();
        let v0 = unsafe { pool.box_at(i0) }.unwrap().into_inner();
        assert_eq!(v0.v, 10);
        assert_eq!(v1.v, 20);
        assert!(!pool.used.is_set(i0));
        assert!(!pool.used.is_set(i1));
        // Stale index: bit was unset by `into_inner()`, second recovery is `None`.
        // SAFETY: stale/OOB indices are caught at runtime — `None`, not UB.
        assert!(unsafe { pool.box_at(i0) }.is_none());
        assert!(unsafe { pool.box_at(999) }.is_none());
    }
}

// ported from: src/collections/hive_array.zig

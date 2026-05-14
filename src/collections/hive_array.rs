#![allow(unsafe_code)]
use core::mem::{MaybeUninit, size_of};
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
/// this uses a fixed `[usize; 32]` backing array — 2048 bits, which is the
/// largest in-tree `HiveArray` capacity. Only the first
/// `ceil(CAPACITY/64)` words are touched, so smaller pools pay 256 B of dead
/// storage (negligible next to `buffer: [MaybeUninit<T>; CAPACITY]`).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct HiveBitSet<const CAPACITY: usize> {
    masks: [usize; HIVE_BITSET_WORDS],
}

const HIVE_BITSET_WORDS: usize = 32;
const WORD_BITS: usize = usize::BITS as usize;

impl<const CAPACITY: usize> HiveBitSet<CAPACITY> {
    const NUM_WORDS: usize = if CAPACITY == 0 {
        0
    } else {
        (CAPACITY + WORD_BITS - 1) / WORD_BITS
    };
    const _FITS: () = assert!(
        CAPACITY <= HIVE_BITSET_WORDS * WORD_BITS,
        "HiveArray CAPACITY exceeds HiveBitSet backing (raise HIVE_BITSET_WORDS)"
    );
    /// Mask of valid bits in the last live word (all-ones when CAPACITY is a
    /// multiple of 64; otherwise zeros in the high padding bits).
    const LAST_WORD_MASK: usize = {
        let rem = CAPACITY % WORD_BITS;
        if rem == 0 { usize::MAX } else { (1usize << rem) - 1 }
    };

    pub const fn init_empty() -> Self {
        Self {
            masks: [0; HIVE_BITSET_WORDS],
        }
    }

    #[inline]
    pub fn is_set(&self, index: usize) -> bool {
        debug_assert!(index < CAPACITY);
        (self.masks[index / WORD_BITS] >> (index % WORD_BITS)) & 1 != 0
    }

    #[inline]
    pub fn set(&mut self, index: usize) {
        debug_assert!(index < CAPACITY);
        self.masks[index / WORD_BITS] |= 1usize << (index % WORD_BITS);
    }

    #[inline]
    pub fn unset(&mut self, index: usize) {
        debug_assert!(index < CAPACITY);
        self.masks[index / WORD_BITS] &= !(1usize << (index % WORD_BITS));
    }

    #[inline]
    pub fn find_first_set(&self) -> Option<usize> {
        let mut i = 0;
        while i < Self::NUM_WORDS {
            let m = self.masks[i];
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
            let inv = !self.masks[i] & live_mask;
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
        HiveBitSetIter {
            masks: self.masks,
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
/// MODULE INVARIANT: `used.is_set(i) ⇔ buffer[i] is a fully-initialized T`.
/// The bit is set only by [`HiveSlot::write`]/[`HiveSlot::assume_init`] (which
/// hold `&mut HiveArray` while writing) and unset only by [`put`](Self::put)/
/// [`put_raw`](Self::put_raw)/[`take`](Self::take)/[`release_at`](Self::release_at)/
/// [`reset`](Self::reset). With `buffer`/`used` private, safe code cannot
/// desync the invariant — `mem::forget(slot)` is harmless because `claim()`
/// does not set the bit.
// PORT NOTE: Zig's `capacity: u16` is widened to `usize` here because Rust array
// lengths require a `usize` const generic on stable.
pub struct HiveArray<T, const CAPACITY: usize> {
    buffer: [MaybeUninit<T>; CAPACITY],
    used: HiveBitSet<CAPACITY>,
}

impl<T, const CAPACITY: usize> HiveArray<T, CAPACITY> {
    pub const SIZE: usize = CAPACITY;

    // PORT NOTE: Zig had `pub var empty: Self` as a mutable static to work around
    // https://github.com/ziglang/zig/issues/22462 and /21988. Rust has no such
    // limitation; callers should use `init()` (which is `const`).

    pub const fn init() -> Self {
        Self {
            buffer: [const { MaybeUninit::uninit() }; CAPACITY],
            used: HiveBitSet::init_empty(),
        }
    }

    /// One-shot claim + write. Preferred entry point — no uninit window.
    ///
    /// Returns `None` (and does **not** consume `value`'s slot) if the hive
    /// is full; on `None` the caller still owns `value` and must drop it.
    #[inline]
    pub fn get_init(&mut self, value: T) -> Option<NonNull<T>> {
        Some(self.claim()?.write(value))
    }

    /// Claim + write where `T` is self-referential on its own slot address
    /// (e.g. a struct that registers itself as a uws/libuv user-data pointer
    /// inside its own constructor). `init` receives the slot's stable address
    /// and must return the value to be stored there.
    #[inline]
    pub fn emplace(&mut self, init: impl FnOnce(NonNull<T>) -> T) -> Option<NonNull<T>> {
        let mut slot = self.claim()?;
        let addr = slot.addr();
        Some(slot.write(init(addr)))
    }

    /// Low-level reservation. Only when [`get_init`](Self::get_init) /
    /// [`emplace`](Self::emplace) are insufficient — typically when the caller
    /// must interleave fallible work between claim and commit, or perform
    /// `repr(C)` placement-new via [`HiveSlot::as_uninit`].
    ///
    /// The returned token borrows `self` for `'_`; precompute any raw
    /// back-pointers to the parent struct *before* calling `claim()` if they
    /// are needed inside the initializer.
    ///
    /// The `used` bit is **not** set until [`HiveSlot::write`]/
    /// [`HiveSlot::assume_init`] commits the slot; dropping or forgetting the
    /// token leaves the slot free.
    pub fn claim(&mut self) -> Option<HiveSlot<'_, T, CAPACITY>> {
        let index = self.used.find_first_unset()?;
        asan::unpoison(self.buffer[index].as_mut_ptr().cast(), size_of::<T>());
        Some(HiveSlot(Some(SlotInner::Inline { hive: self, index })))
    }

    /// Recycle a slot **without** running `T::drop`. Safe: if `value` does not
    /// point into this hive, returns `false` and is a no-op. Use when the
    /// caller has already moved the contents out / destructured them, or when
    /// `T` is POD and the slot is being released on an error path before it
    /// was fully initialized (Zig `value.* = undefined`).
    pub fn put_raw(&mut self, value: *mut T) -> bool {
        let Some(index) = self.index_of(value) else {
            return false;
        };
        debug_assert!(self.used.is_set(index as usize));
        asan::poison(value.cast(), size_of::<T>());
        self.used.unset(index as usize);
        true
    }

    /// Release slot `i` without running `T::drop` (by-index counterpart to
    /// [`put_raw`](Self::put_raw)). For callers that hold an index rather than
    /// the original pointer.
    #[inline]
    pub fn release_at(&mut self, i: usize) {
        debug_assert!(i < CAPACITY);
        debug_assert!(self.used.is_set(i));
        asan::poison(self.buffer[i].as_mut_ptr().cast(), size_of::<T>());
        self.used.unset(i);
    }

    /// Safe `&mut T` access to an occupied slot. `None` if `i` is out of range
    /// or unused.
    #[inline]
    pub fn at_mut(&mut self, i: usize) -> Option<&mut T> {
        if i < CAPACITY && self.used.is_set(i) {
            // SAFETY: module invariant — `used.is_set(i) ⇔ buffer[i] initialized`.
            Some(unsafe { self.buffer[i].assume_init_mut() })
        } else {
            None
        }
    }

    /// Move the value out of slot `i` and release the slot. `None` if `i` is
    /// out of range or unused.
    #[inline]
    pub fn take(&mut self, i: usize) -> Option<T> {
        if i < CAPACITY && self.used.is_set(i) {
            self.used.unset(i);
            // SAFETY: module invariant — bit was set ⇔ slot initialized; we
            // unset the bit so the slot is now logically free and ownership of
            // the `T` transfers to the caller.
            let v = unsafe { self.buffer[i].assume_init_read() };
            asan::poison(self.buffer[i].as_mut_ptr().cast(), size_of::<T>());
            Some(v)
        } else {
            None
        }
    }

    /// Iterator over indices of occupied slots. The iterator copies the bitset
    /// at construction time, so the hive can be borrowed `&mut` (e.g. via
    /// [`at_mut`](Self::at_mut)) inside the loop body.
    #[inline]
    pub fn used_iter(&self) -> HiveBitSetIter<CAPACITY> {
        self.used.iter_set()
    }

    /// `true` if any slot is occupied.
    #[inline]
    pub fn any_used(&self) -> bool {
        self.used.find_first_set().is_some()
    }

    #[inline]
    pub fn is_used(&self, i: usize) -> bool {
        i < CAPACITY && self.used.is_set(i)
    }

    /// Mark every slot free **without** running `T::drop` on any contents.
    /// Only valid when the caller has already torn down / moved out every live
    /// value (or `T` is POD). Bulk equivalent of [`put_raw`](Self::put_raw).
    #[inline]
    pub fn reset(&mut self) {
        self.used = HiveBitSet::init_empty();
    }

    pub fn index_of(&self, value: *const T) -> Option<u32> {
        asan::assert_unpoisoned(value.cast::<u8>());
        let start = self.buffer.as_ptr().cast::<T>();
        // One-past-the-end pointer of `buffer`; `wrapping_add` is sound for
        // the in-allocation offset and matches `add` exactly here.
        let end = start.wrapping_add(CAPACITY);
        if !((value as usize) >= (start as usize) && (value as usize) < (end as usize)) {
            return None;
        }

        // aligned to the size of T
        let index = ((value as usize) - (start as usize)) / size_of::<T>();
        debug_assert!(index < CAPACITY);
        debug_assert!(self.buffer[index].as_ptr().cast::<T>() == value);
        Some(u32::try_from(index).expect("int cast"))
    }

    pub fn r#in(&self, value: *const T) -> bool {
        asan::assert_unpoisoned(value.cast::<u8>());
        let start = self.buffer.as_ptr().cast::<T>();
        let end = start.wrapping_add(CAPACITY);
        (value as usize) >= (start as usize) && (value as usize) < (end as usize)
    }

    /// Return a slot to the pool, dropping the contained `T` in place.
    ///
    /// Returns `false` (and drops nothing) if `value` does not point into this
    /// hive's buffer or the slot's `used` bit is already clear (double-put
    /// guard).
    ///
    /// Safe: with the module invariant maintained internally, any `value` for
    /// which `index_of` succeeds and `used.is_set` holds was written via
    /// [`HiveSlot::write`]/[`HiveSlot::assume_init`] — the latter is `unsafe`
    /// and its caller asserted full initialization.
    pub fn put(&mut self, value: *mut T) -> bool {
        let Some(index) = self.index_of(value) else {
            return false;
        };
        let i = index as usize;
        if !self.used.is_set(i) {
            debug_assert!(false, "HiveArray::put on unclaimed slot (double put?)");
            return false;
        }
        debug_assert!(self.buffer[i].as_ptr().cast::<T>() == value.cast_const());

        // PORT NOTE: Zig wrote `value.* = undefined;` — Zig has no destructors,
        // so the slot was simply marked logically uninitialized. In the Rust
        // port several `T` carry owned heap data (e.g. `NumberScope.name_counts:
        // StringHashMap`, `NetworkTask.url_buf: Box<[u8]>`); drop the slot
        // before recycling so the put/get cycle does not leak it. Callers that
        // pre-clean fields (`PooledSocket::release_parked_refs`) leave only
        // trivially-droppable residuals, so this is idempotent for them.
        // SAFETY: module invariant — `used.is_set(i) ⇔ buffer[i] initialized`.
        unsafe { self.buffer[i].assume_init_drop() };
        asan::poison(value.cast(), size_of::<T>());
        self.used.unset(i);
        true
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HiveSlot
// ──────────────────────────────────────────────────────────────────────────

/// Linear reservation token for a claimed-but-uninitialized hive slot.
///
/// The legacy two-phase contract (claim a `*mut T` to garbage, then
/// `ptr::write` it) opened UB hazards in the gap: early-return / `?` / panic
/// left the slot claimed-uninit, and `&mut *p` over uninit `T` is instant
/// validity UB when `T` has niches.
///
/// `HiveSlot` encodes the invariant **"a `used` slot is always fully
/// initialized"** in the type system: the `used` bit is set only when
/// [`write`](Self::write) (or the `unsafe` [`assume_init`](Self::assume_init))
/// commits the slot. If the token is dropped (early return, `?`, panic) the
/// slot stays free — no bit was set, no `T::drop` runs. `mem::forget(slot)`
/// is likewise harmless (slot stays free; next `claim()` reuses it).
#[must_use = "claimed hive slot is leaked if neither written nor dropped"]
pub struct HiveSlot<'h, T, const CAPACITY: usize>(Option<SlotInner<'h, T, CAPACITY>>);

enum SlotInner<'h, T, const CAPACITY: usize> {
    Inline {
        hive: &'h mut HiveArray<T, CAPACITY>,
        index: usize,
    },
    Heap(Box<MaybeUninit<T>>),
}

impl<'h, T, const CAPACITY: usize> HiveSlot<'h, T, CAPACITY> {
    /// Stable address of the slot. Safe to capture (e.g. register as a
    /// libuv/uws user-data pointer) **before** [`write`](Self::write), as long
    /// as nothing dereferences it until after `write()`.
    #[inline]
    pub fn addr(&mut self) -> NonNull<T> {
        NonNull::from(self.as_uninit()).cast()
    }

    /// `&mut MaybeUninit<T>` for piecewise init via `addr_of_mut!`. Prefer
    /// [`write`](Self::write); this exists for `repr(C)` placement-new
    /// (`create_in`-style constructors that take `&mut MaybeUninit<Self>`).
    #[inline]
    pub fn as_uninit(&mut self) -> &mut MaybeUninit<T> {
        match self.0.as_mut().expect("HiveSlot already consumed") {
            SlotInner::Inline { hive, index } => &mut hive.buffer[*index],
            SlotInner::Heap(b) => b,
        }
    }

    /// Move `value` into the slot, mark it occupied, and return the stable
    /// initialized pointer. Consumes the token.
    #[inline]
    pub fn write(mut self, value: T) -> NonNull<T> {
        match self.0.take().expect("HiveSlot already consumed") {
            SlotInner::Inline { hive, index } => {
                let p = NonNull::from(hive.buffer[index].write(value));
                hive.used.set(index);
                p
            }
            SlotInner::Heap(b) => NonNull::from(Box::leak(b).write(value)),
        }
    }

    /// Caller has fully initialized the slot via [`as_uninit`](Self::as_uninit)
    /// (or by writing through [`addr`](Self::addr)). Marks the slot occupied
    /// and consumes the token.
    ///
    /// # Safety
    /// Every field of `T` must be initialized, including padding-adjacent
    /// niches (enum discriminants, `NonNull`, `Box`, `&`). Calling this on a
    /// partially-written slot is the exact UB this type exists to prevent.
    #[inline]
    pub unsafe fn assume_init(mut self) -> NonNull<T> {
        match self.0.take().expect("HiveSlot already consumed") {
            SlotInner::Inline { hive, index } => {
                hive.used.set(index);
                NonNull::from(&mut hive.buffer[index]).cast()
            }
            SlotInner::Heap(b) => NonNull::from(Box::leak(b)).cast(),
        }
    }
}

impl<T, const CAPACITY: usize> Drop for HiveSlot<'_, T, CAPACITY> {
    fn drop(&mut self) {
        match self.0.take() {
            // Bit was never set; just re-poison so asan still catches a stale
            // `addr()` deref after the token is dropped.
            Some(SlotInner::Inline { hive, index }) => {
                asan::poison(hive.buffer[index].as_mut_ptr().cast(), size_of::<T>());
            }
            // `Box<MaybeUninit<T>>` drop deallocates without running `T::drop`.
            Some(SlotInner::Heap(_)) => {}
            None => {}
        }
    }
}

// PORT NOTE: In Zig this was the nested type `HiveArray(T, capacity).Fallback`.
// Rust cannot nest a generic struct that captures outer generics, so it lives at
// module scope with the same parameters. The Zig field
// `hive: if (capacity > 0) Self else void` is always materialized here; the
// `CAPACITY > 0` checks below preserve the original gating.
// PERF(port): zero-capacity case carried a zero-size hive in Zig — profile in Phase B.
pub struct Fallback<T, const CAPACITY: usize> {
    hive: HiveArray<T, CAPACITY>,
    // PORT NOTE: `std.mem.Allocator param` dropped — global mimalloc.
}

impl<T, const CAPACITY: usize> Fallback<T, CAPACITY> {
    pub const fn init() -> Self {
        Self {
            hive: HiveArray::init(),
        }
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
    /// raw heap storage and writes only the 256-byte `used` bitset; the
    /// `[MaybeUninit<T>; CAPACITY]` buffer is left untouched (uninitialized
    /// bytes are a valid bit-pattern for `MaybeUninit`).
    #[inline]
    pub fn new_boxed() -> Box<Self> {
        let mut boxed = Box::<Self>::new_uninit();
        // SAFETY: `boxed` is a fresh heap allocation — non-null, aligned for
        // `Self`, and valid for writes of `size_of::<Self>()` bytes. We form a
        // place expression on `*out` only to project to `hive.used`; no
        // `&mut Self` is created over the (uninitialized) whole struct. After
        // the write, `hive.used` is fully initialized and `hive.buffer` is
        // `[MaybeUninit<T>; CAPACITY]` for which uninitialized bytes are a
        // valid representation, so `assume_init()` is sound.
        unsafe {
            let out = boxed.as_mut_ptr();
            core::ptr::addr_of_mut!((*out).hive.used).write(HiveBitSet::init_empty());
            boxed.assume_init()
        }
    }

    /// One-shot claim + write. Preferred entry point — no uninit window.
    /// Infallible: spills to a heap `Box<T>` when the inline hive is full.
    #[inline]
    pub fn get_init(&mut self, value: T) -> NonNull<T> {
        self.claim().write(value)
    }

    /// See [`HiveArray::emplace`]. Infallible (heap fallback).
    #[inline]
    pub fn emplace(&mut self, init: impl FnOnce(NonNull<T>) -> T) -> NonNull<T> {
        let mut slot = self.claim();
        let addr = slot.addr();
        slot.write(init(addr))
    }

    /// See [`HiveArray::claim`]. Infallible: when the inline hive is full,
    /// the returned token owns a freshly-allocated heap slot whose `Drop`
    /// deallocates without running `T::drop`.
    pub fn claim(&mut self) -> HiveSlot<'_, T, CAPACITY> {
        if CAPACITY > 0 {
            if let Some(slot) = self.hive.claim() {
                return slot;
            }
        }
        HiveSlot(Some(SlotInner::Heap(Box::new_uninit())))
    }

    /// See [`HiveArray::reset`]. Heap-fallback slots are caller-managed and
    /// not tracked here, so this only clears the inline bitset.
    #[inline]
    pub fn reset(&mut self) {
        self.hive.reset();
    }

    /// Recycle a slot **without** running `T::drop`. Counterpart to
    /// [`HiveArray::put_raw`] for the heap-fallback path.
    ///
    /// # Safety
    /// `value` must have been obtained from this `Fallback` (via `get_init` /
    /// `emplace` / `claim().write()`) and not yet returned. The contained `T`
    /// is **not** dropped — caller must have already moved out / destructured
    /// anything with drop glue, or `T` must be POD.
    pub unsafe fn put_raw(&mut self, value: *mut T) {
        if CAPACITY > 0 {
            if self.hive.put_raw(value) {
                return;
            }
        }
        // SAFETY: caller contract — `value` is a heap slot from `claim()`; it
        // was allocated as `Box<MaybeUninit<T>>` (same layout as `Box<T>`).
        // Reclaiming as `MaybeUninit<T>` deallocates without running `T::drop`.
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
    /// this `Fallback` via `get_init` / `emplace` / `claim().write()` /
    /// `claim().assume_init()` and not yet returned. The heap path has no
    /// membership check, so a foreign pointer is UB.
    pub unsafe fn put(&mut self, value: *mut T) {
        if CAPACITY > 0 {
            if self.hive.put(value) {
                return;
            }
        }

        // SAFETY: caller contract — `value` was produced by the heap path of
        // `claim().write()` (`Box::leak`); `destroy` reconstructs the `Box<T>`
        // and runs `T::drop`.
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
#[repr(C)]
pub struct HiveRef<T, const CAPACITY: usize> {
    pub ref_count: u32,
    pub pool: NonNull<Fallback<HiveRef<T, CAPACITY>, CAPACITY>>,
    pub value: T,
}

/// Convenience alias mirroring Zig's nested `const HiveAllocator`.
pub type HiveAllocator<T, const CAPACITY: usize> = Fallback<HiveRef<T, CAPACITY>, CAPACITY>;

impl<T, const CAPACITY: usize> HiveRef<T, CAPACITY> {
    /// Zig: `pub fn init(value, allocator) !*@This()`.
    ///
    /// # Safety
    /// `pool` must be valid for the entire lifetime of the returned `HiveRef`
    /// (i.e. until its `ref_count` drops to zero and it is `put` back).
    /// Callers hold the pool in a long-lived owner (e.g. `VirtualMachine`).
    pub unsafe fn init(value: T, pool: &mut Fallback<Self, CAPACITY>) -> NonNull<Self> {
        let pool_ptr = NonNull::from(&mut *pool);
        pool.get_init(HiveRef {
            ref_count: 1,
            pool: pool_ptr,
            value,
        })
    }

    pub fn ref_(&mut self) -> &mut Self {
        self.ref_count += 1;
        self
    }

    /// Zig: `pub fn unref(this) ?*@This()` — returns `null` when the count hit
    /// zero and the slot was returned to the pool.
    pub fn unref(&mut self) -> Option<&mut Self> {
        let ref_count = self.ref_count;
        self.ref_count = ref_count - 1;
        if ref_count == 1 {
            let mut pool = self.pool;
            // SAFETY: BACKREF — `init`'s contract is that the pool outlives
            // every `HiveRef` it hands out. Zig's `if @hasDecl(T, "deinit")
            // this.value.deinit()` maps to `T::drop`, which `Fallback::put`
            // runs (it drops the whole `HiveRef` in place before recycling).
            unsafe { pool.as_mut().put(core::ptr::from_mut(self)) };
            return None;
        }
        Some(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hive_array() {
        const SIZE: usize = 64;

        // Choose an integer with a weird alignment
        // PORT NOTE: Zig used `u127`; Rust has no arbitrary-width ints. `u128` is the closest.
        type Int = u128;

        let mut a = HiveArray::<Int, SIZE>::init();

        {
            let b = a.get_init(0).unwrap();
            assert_eq!(a.index_of(b.as_ptr()), Some(0));
            let b2 = a.get_init(0).unwrap();
            assert!(b2 != b);
            assert!(a.put(b.as_ptr()));
            assert!(a.get_init(0).unwrap() == b);
            let c = a.get_init(123).unwrap();
            assert_eq!(*a.at_mut(a.index_of(c.as_ptr()).unwrap() as usize).unwrap(), 123);
            let mut d: Int = 12345;
            assert!(a.put(&mut d) == false);
            assert!(a.r#in(&d) == false);
        }

        a.reset();
        {
            for i in 0..SIZE {
                let b = a.get_init(0).unwrap();
                assert_eq!(a.index_of(b.as_ptr()), Some(u32::try_from(i).expect("int cast")));
                assert!(a.put(b.as_ptr()));
                assert!(a.get_init(0).unwrap() == b);
            }
            for _ in 0..SIZE {
                assert!(a.get_init(0).is_none());
            }
        }
    }

    #[test]
    fn hive_slot_drop_releases_without_dtor() {
        use core::sync::atomic::{AtomicU32, Ordering};
        static DROPS: AtomicU32 = AtomicU32::new(0);
        struct D(#[allow(dead_code)] u64);
        impl Drop for D {
            fn drop(&mut self) {
                DROPS.fetch_add(1, Ordering::Relaxed);
            }
        }

        let mut a = HiveArray::<D, 4>::init();
        // Dropped token leaves the slot free without running D::drop.
        drop(a.claim().unwrap());
        assert!(!a.is_used(0));
        assert_eq!(DROPS.load(Ordering::Relaxed), 0);

        // Forgotten token also leaves the slot free (bit never set).
        core::mem::forget(a.claim().unwrap());
        assert!(!a.is_used(0));
        assert!(a.at_mut(0).is_none());

        // write() commits and put() drops.
        let p = a.get_init(D(7)).unwrap();
        assert!(a.is_used(0));
        assert_eq!(DROPS.load(Ordering::Relaxed), 0);
        a.put(p.as_ptr());
        assert_eq!(DROPS.load(Ordering::Relaxed), 1);

        // take() moves out without dropping; caller drops.
        let p = a.get_init(D(8)).unwrap();
        let i = a.index_of(p.as_ptr()).unwrap() as usize;
        let v = a.take(i).unwrap();
        assert_eq!(DROPS.load(Ordering::Relaxed), 1);
        drop(v);
        assert_eq!(DROPS.load(Ordering::Relaxed), 2);

        // put_raw() does not drop.
        let p = a.get_init(D(9)).unwrap();
        assert!(a.put_raw(p.as_ptr()));
        assert_eq!(DROPS.load(Ordering::Relaxed), 2);

        // Fallback heap path: dropped token deallocates without D::drop.
        let mut f = Fallback::<D, 0>::init();
        drop(f.claim());
        assert_eq!(DROPS.load(Ordering::Relaxed), 2);
        let p = f.get_init(D(10));
        // SAFETY: heap slot from this Fallback.
        unsafe { f.put(p.as_ptr()) };
        assert_eq!(DROPS.load(Ordering::Relaxed), 3);
    }
}

// ported from: src/collections/hive_array.zig

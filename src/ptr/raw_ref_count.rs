use core::marker::ConstParamTy;
use core::sync::atomic::Ordering;

use bun_safety::ThreadLock;

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
pub enum ThreadSafety {
    SingleThreaded,
    ThreadSafe,
}

pub enum DecrementResult {
    KeepAlive,
    ShouldDestroy,
}

// TODO(port): Zig varies field types at comptime based on `thread_safety`
// (`std.atomic.Value(Int)` vs `Int`, and `ThreadLock` vs `void`). Rust const
// generics cannot directly vary a field's type, and std has no generic
// `Atomic<Int>`. This draft uses a `Storage` trait keyed on the const param to
// pick field types; Phase B may instead split into two concrete structs
// (e.g. `RawRefCount<Int>` / `RawAtomicRefCount<Int>`) if the trait dispatch
// proves awkward.

/// A simple wrapper around an integer reference count. This type doesn't do any memory management
/// itself.
///
/// This type may be useful for implementing the interface required by `bun.ptr.ExternalShared`.
pub struct RawRefCount<Int, const THREAD_SAFETY: ThreadSafety>
where
    (): Storage<Int, THREAD_SAFETY>,
{
    raw_value: <() as Storage<Int, THREAD_SAFETY>>::RawValue,
    thread_lock: <() as Storage<Int, THREAD_SAFETY>>::ThreadLock,
}

impl<Int, const THREAD_SAFETY: ThreadSafety> RawRefCount<Int, THREAD_SAFETY>
where
    (): Storage<Int, THREAD_SAFETY>,
    // TODO(port): narrow bounds — Zig `Int` is an unsigned integer type.
    Int: Copy + PartialEq + core::ops::AddAssign + core::ops::SubAssign + num_traits::Bounded,
{
    /// Usually the initial count should be 1.
    pub fn init(initial_count: Int) -> Self {
        Self {
            raw_value: match THREAD_SAFETY {
                ThreadSafety::SingleThreaded => {
                    <() as Storage<Int, THREAD_SAFETY>>::raw_value_init(initial_count)
                }
                ThreadSafety::ThreadSafe => {
                    <() as Storage<Int, THREAD_SAFETY>>::raw_value_init(initial_count)
                }
            },
            thread_lock: match THREAD_SAFETY {
                ThreadSafety::SingleThreaded => {
                    <() as Storage<Int, THREAD_SAFETY>>::thread_lock_init()
                }
                ThreadSafety::ThreadSafe => {
                    <() as Storage<Int, THREAD_SAFETY>>::thread_lock_init()
                }
            },
        }
    }

    pub fn increment(&mut self) {
        match THREAD_SAFETY {
            ThreadSafety::SingleThreaded => {
                <() as Storage<Int, THREAD_SAFETY>>::lock_or_assert(&mut self.thread_lock);
                <() as Storage<Int, THREAD_SAFETY>>::add_assign(&mut self.raw_value, Int::one());
            }
            ThreadSafety::ThreadSafe => {
                let old = <() as Storage<Int, THREAD_SAFETY>>::fetch_add(
                    &self.raw_value,
                    Int::one(),
                    Ordering::Relaxed, // .monotonic
                );
                debug_assert!(
                    old != Int::max_value(),
                    "overflow of thread-safe ref count",
                );
            }
        }
    }

    pub fn decrement(&mut self) -> DecrementResult {
        let new_count: Int = 'blk: {
            match THREAD_SAFETY {
                ThreadSafety::SingleThreaded => {
                    <() as Storage<Int, THREAD_SAFETY>>::lock_or_assert(&mut self.thread_lock);
                    <() as Storage<Int, THREAD_SAFETY>>::sub_assign(&mut self.raw_value, Int::one());
                    break 'blk <() as Storage<Int, THREAD_SAFETY>>::load(&self.raw_value);
                }
                ThreadSafety::ThreadSafe => {
                    let old = <() as Storage<Int, THREAD_SAFETY>>::fetch_sub(
                        &self.raw_value,
                        Int::one(),
                        Ordering::AcqRel,
                    );
                    debug_assert!(old != Int::zero(), "underflow of thread-safe ref count");
                    break 'blk old - Int::one();
                }
            }
        };
        if new_count == Int::zero() {
            DecrementResult::ShouldDestroy
        } else {
            DecrementResult::KeepAlive
        }
    }

    // Zig: `pub const deinit = void;` — marker that this type has no destructor.
    // No `Drop` impl needed.
}

// ───────────────────────────── Storage dispatch ─────────────────────────────
// TODO(port): this trait exists only to let `THREAD_SAFETY` select field types.
// Phase B should evaluate replacing with two concrete types.

pub trait Storage<Int, const THREAD_SAFETY: ThreadSafety> {
    type RawValue;
    type ThreadLock;

    fn raw_value_init(initial: Int) -> Self::RawValue;
    fn thread_lock_init() -> Self::ThreadLock;

    fn lock_or_assert(lock: &mut Self::ThreadLock);
    fn add_assign(v: &mut Self::RawValue, n: Int);
    fn sub_assign(v: &mut Self::RawValue, n: Int);
    fn load(v: &Self::RawValue) -> Int;
    fn fetch_add(v: &Self::RawValue, n: Int, order: Ordering) -> Int;
    fn fetch_sub(v: &Self::RawValue, n: Int, order: Ordering) -> Int;
}

impl<Int> Storage<Int, { ThreadSafety::SingleThreaded }> for ()
where
    Int: Copy + core::ops::AddAssign + core::ops::SubAssign,
{
    type RawValue = Int;
    type ThreadLock = ThreadLock;

    fn raw_value_init(initial: Int) -> Self::RawValue {
        initial
    }
    fn thread_lock_init() -> Self::ThreadLock {
        ThreadLock::init_locked_if_non_comptime()
    }
    fn lock_or_assert(lock: &mut Self::ThreadLock) {
        lock.lock_or_assert();
    }
    fn add_assign(v: &mut Self::RawValue, n: Int) {
        *v += n;
    }
    fn sub_assign(v: &mut Self::RawValue, n: Int) {
        *v -= n;
    }
    fn load(v: &Self::RawValue) -> Int {
        *v
    }
    fn fetch_add(_v: &Self::RawValue, _n: Int, _order: Ordering) -> Int {
        unreachable!()
    }
    fn fetch_sub(_v: &Self::RawValue, _n: Int, _order: Ordering) -> Int {
        unreachable!()
    }
}

// TODO(port): std has no generic `Atomic<Int>`. Phase B must either:
//   (a) bound `Int: atomic::Atom` via the `atomic` crate, or
//   (b) monomorphize for the concrete `Int` types actually used (likely u32/u64).
impl<Int> Storage<Int, { ThreadSafety::ThreadSafe }> for ()
where
    Int: Copy,
{
    // Placeholder: not a real generic atomic.
    type RawValue = core::sync::atomic::AtomicUsize; // TODO(port): generic atomic for Int
    type ThreadLock = ();

    fn raw_value_init(initial: Int) -> Self::RawValue {
        // TODO(port): generic atomic for Int — placeholder casts through usize
        core::sync::atomic::AtomicUsize::new(initial as usize)
    }
    fn thread_lock_init() -> Self::ThreadLock {}
    fn lock_or_assert(_lock: &mut Self::ThreadLock) {}
    fn add_assign(_v: &mut Self::RawValue, _n: Int) {
        unreachable!()
    }
    fn sub_assign(_v: &mut Self::RawValue, _n: Int) {
        unreachable!()
    }
    fn load(_v: &Self::RawValue) -> Int {
        unreachable!()
    }
    fn fetch_add(v: &Self::RawValue, n: Int, order: Ordering) -> Int {
        // TODO(port): generic atomic for Int — placeholder casts through usize
        v.fetch_add(n as usize, order) as Int
    }
    fn fetch_sub(v: &Self::RawValue, n: Int, order: Ordering) -> Int {
        // TODO(port): generic atomic for Int — placeholder casts through usize
        v.fetch_sub(n as usize, order) as Int
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/raw_ref_count.zig (74 lines)
//   confidence: medium
//   todos:      7
//   notes:      comptime-varied field types modeled via Storage trait; no std generic Atomic<Int> — thread-safe path uses AtomicUsize placeholder with `as usize`/`as Int` casts to preserve logic shape; Phase B should split into two concrete structs or pick a generic-atomic crate
// ──────────────────────────────────────────────────────────────────────────

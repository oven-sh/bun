use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

use bun_threading::Guarded;

use crate::mutex::{Condition, Mutex};
use crate::shape::StructShape;

/// A symbol as a slot keeps it. A symbol belongs to the agent that made it, so what crosses is a name for it: a number that
/// every agent holding the symbol agrees on, and its description. An agent that has no symbol for the number makes one.
#[derive(Debug)]
pub struct SymbolRecord {
    /// Names a symbol that is not registered; zero for a registered one, which is named by its description.
    pub id: u64,
    /// Made by `Symbol.for`: the same symbol in every agent that asks for its description.
    pub registered: bool,
    /// The text of `Symbol(description)`, which `Symbol()` has none of. A registered symbol always has one.
    pub description: Option<Arc<[u16]>>,
}

impl SymbolRecord {
    /// Whether both records stand for the same symbol.
    pub fn same_as(&self, other: &SymbolRecord) -> bool {
        if self.registered != other.registered {
            return false;
        }
        if self.registered {
            self.description == other.description
        } else {
            self.id == other.id
        }
    }
}

/// What a slot can hold. These are exactly the values that may cross agents:
/// primitives (symbols included), other blocks (a shared struct or a shared array) and the
/// sync primitives. Objects and functions are not shareable.
#[derive(Clone, Debug)]
pub enum Value {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    /// A string as UTF-16 code units, so lone surrogates survive.
    String(Arc<[u16]>),
    /// A BigInt in its decimal form.
    BigInt(Arc<str>),
    Symbol(Arc<SymbolRecord>),
    Struct(Arc<SharedBlock>),
    Mutex(Arc<Mutex>),
    Condition(Arc<Condition>),
}

// A slot is one u64. Numbers are stored as their f64 bits (NaN canonicalized to QNAN);
// every other kind is a quiet NaN whose payload carries a 3-bit tag and a 48-bit datum.
const QNAN: u64 = 0x7ff8_0000_0000_0000;
const TAG_SHIFT: u32 = 48;
const TAG_MASK: u64 = 0x7;
const DATUM_MASK: u64 = (1 << TAG_SHIFT) - 1;

const TAG_SPECIAL: u64 = 1; // datum: 0 undefined, 1 null, 2 false, 3 true
const TAG_STRING: u64 = 2;
const TAG_BIGINT: u64 = 3;
const TAG_STRUCT: u64 = 4;
const TAG_MUTEX: u64 = 5;
const TAG_CONDITION: u64 = 6;
const TAG_SYMBOL: u64 = 7;

fn boxed(tag: u64, datum: u64) -> u64 {
    debug_assert!(datum <= DATUM_MASK);
    QNAN | (tag << TAG_SHIFT) | datum
}

fn is_boxed(bits: u64) -> bool {
    // Sign bit clear, exponent all ones, quiet bit set, and a non-zero tag. A real NaN is
    // stored as exactly QNAN, which has tag 0, so it is never mistaken for a boxed value.
    bits & 0xfff8_0000_0000_0000 == QNAN && (bits >> TAG_SHIFT) & TAG_MASK != 0
}

/// One strong count that a slot owned, held at its address until it is released on drop. It
/// is only made by [`own`], which pairs the address with the function that frees that kind.
struct Retired {
    addr: usize,
    free: unsafe fn(usize),
    /// The count is one of a [`SharedBlock`], which dropping a chain of blocks releases without recursion.
    is_block: bool,
}

impl Retired {
    /// The block this count belongs to, if it is a block's, without releasing it.
    fn into_block(self) -> Result<Arc<SharedBlock>, Self> {
        if !self.is_block {
            return Err(self);
        }
        let addr = self.addr;
        std::mem::forget(self);
        // SAFETY: `own` made `self` from the `Arc::into_raw` pointer of an `Arc<SharedBlock>` (`is_block`), whose count it now has.
        Ok(unsafe { Arc::from_raw(addr as *const SharedBlock) })
    }
}

impl Drop for Retired {
    fn drop(&mut self) {
        // SAFETY: `own` paired `free` with the allocation at `addr` and handed over its count,
        // and this is the only place the count is released.
        unsafe { (self.free)(self.addr) }
    }
}

/// # Safety
/// `addr` is the `Box::into_raw` pointer of a `Box<T>`.
unsafe fn free_box<T>(addr: usize) {
    // SAFETY: per the contract.
    drop(unsafe { Box::from_raw(addr as *mut T) });
}

/// # Safety
/// `addr` is the `Arc::into_raw` pointer of an `Arc<T>`, and the caller gives up that count.
unsafe fn free_arc<T>(addr: usize) {
    // SAFETY: per the contract.
    drop(unsafe { Arc::from_raw(addr as *const T) });
}

/// The 48-bit datum for a thin pointer.
fn pointer_datum<T>(ptr: *const T) -> u64 {
    let addr = ptr as usize as u64;
    assert!(addr <= DATUM_MASK, "pointer does not fit in 48 bits");
    addr
}

/// Slot bits for `v` that own one strong count of whatever `v` points at. Strings and BigInts
/// are boxed so the datum is a thin pointer. Pass the bits to [`SharedBlock::retire`] or
/// [`release`] exactly once, or store them in a slot.
fn encode_owned(v: &Value) -> u64 {
    match v {
        Value::String(s) => boxed(
            TAG_STRING,
            pointer_datum(Box::into_raw(Box::new(Arc::clone(s)))),
        ),
        Value::BigInt(s) => boxed(
            TAG_BIGINT,
            pointer_datum(Box::into_raw(Box::new(Arc::clone(s)))),
        ),
        Value::Symbol(r) => boxed(
            TAG_SYMBOL,
            pointer_datum(Box::into_raw(Box::new(Arc::clone(r)))),
        ),
        Value::Struct(b) => boxed(TAG_STRUCT, pointer_datum(Arc::into_raw(Arc::clone(b)))),
        Value::Mutex(m) => boxed(TAG_MUTEX, pointer_datum(Arc::into_raw(Arc::clone(m)))),
        Value::Condition(c) => boxed(TAG_CONDITION, pointer_datum(Arc::into_raw(Arc::clone(c)))),
        _ => encode_plain(v),
    }
}

/// Slot bits for a value that owns nothing: a primitive, or the address of an object that the
/// caller keeps alive. Strings, BigInts and symbols have no such form because they are boxed per store.
fn encode_plain(v: &Value) -> u64 {
    match v {
        Value::Undefined => boxed(TAG_SPECIAL, 0),
        Value::Null => boxed(TAG_SPECIAL, 1),
        Value::Bool(false) => boxed(TAG_SPECIAL, 2),
        Value::Bool(true) => boxed(TAG_SPECIAL, 3),
        Value::Number(n) => {
            if n.is_nan() {
                QNAN
            } else {
                n.to_bits()
            }
        }
        Value::Struct(b) => boxed(TAG_STRUCT, pointer_datum(Arc::as_ptr(b))),
        Value::Mutex(m) => boxed(TAG_MUTEX, pointer_datum(Arc::as_ptr(m))),
        Value::Condition(c) => boxed(TAG_CONDITION, pointer_datum(Arc::as_ptr(c))),
        Value::String(_) | Value::BigInt(_) | Value::Symbol(_) => {
            unreachable!("strings, BigInts and symbols are boxed")
        }
    }
}

/// Takes over the count that `bits` owns, if it owns one.
///
/// # Safety
/// `bits` came from [`encode_owned`], and nothing else will release the same count.
unsafe fn own(bits: u64) -> Option<Retired> {
    if !is_boxed(bits) {
        return None;
    }
    let addr = (bits & DATUM_MASK) as usize;
    let tag = (bits >> TAG_SHIFT) & TAG_MASK;
    let free: unsafe fn(usize) = match tag {
        TAG_STRING => free_box::<Arc<[u16]>>,
        TAG_BIGINT => free_box::<Arc<str>>,
        TAG_SYMBOL => free_box::<Arc<SymbolRecord>>,
        TAG_STRUCT => free_arc::<SharedBlock>,
        TAG_MUTEX => free_arc::<Mutex>,
        TAG_CONDITION => free_arc::<Condition>,
        _ => return None,
    };
    Some(Retired {
        addr,
        free,
        is_block: tag == TAG_STRUCT,
    })
}

/// Frees bits that were never stored in a slot, so no reader can have seen them.
fn release(bits: u64) {
    // SAFETY: `bits` is fresh from `encode_owned` and unpublished, so this is the only owner.
    drop(unsafe { own(bits) });
}

/// Reads a boxed string or BigInt datum.
///
/// # Safety
/// `bits` has the tag for `T`, came from a slot, and a [`ReadGuard`] taken before that slot load
/// is still held (or the caller owns the box).
unsafe fn boxed_ref<'a, T>(bits: u64) -> &'a T {
    // SAFETY: per the contract the box has not been freed.
    unsafe { &*((bits & DATUM_MASK) as usize as *const T) }
}

/// The value `bits` holds, with a new strong count of any object.
///
/// # Safety
/// `bits` came from a slot load made while a [`ReadGuard`] taken before the load is still held,
/// or the caller owns the count `bits` carries (it just swapped the bits out of the slot).
unsafe fn decode(bits: u64) -> Value {
    if !is_boxed(bits) {
        return Value::Number(f64::from_bits(bits));
    }
    let datum = bits & DATUM_MASK;
    // SAFETY: for each pointer tag the allocation is live per the contract, so taking a new
    // strong count (or cloning the boxed Arc) is sound.
    unsafe {
        match (bits >> TAG_SHIFT) & TAG_MASK {
            TAG_SPECIAL => match datum {
                0 => Value::Undefined,
                1 => Value::Null,
                2 => Value::Bool(false),
                _ => Value::Bool(true),
            },
            TAG_STRING => Value::String(Arc::clone(boxed_ref::<Arc<[u16]>>(bits))),
            TAG_BIGINT => Value::BigInt(Arc::clone(boxed_ref::<Arc<str>>(bits))),
            TAG_SYMBOL => Value::Symbol(Arc::clone(boxed_ref::<Arc<SymbolRecord>>(bits))),
            TAG_STRUCT => Value::Struct(arc_from_datum(datum)),
            TAG_MUTEX => Value::Mutex(arc_from_datum(datum)),
            TAG_CONDITION => Value::Condition(arc_from_datum(datum)),
            _ => Value::Undefined,
        }
    }
}

/// # Safety
/// `datum` is the address of a live `Arc<T>` allocation.
unsafe fn arc_from_datum<T>(datum: u64) -> Arc<T> {
    let ptr = datum as usize as *const T;
    // SAFETY: the caller guarantees the allocation is live, so taking a new strong count is sound.
    unsafe {
        Arc::increment_strong_count(ptr);
        Arc::from_raw(ptr)
    }
}

/// Whether the slot bits `cur` hold the value `expected`. Numbers compare by bits after NaN
/// canonicalization, strings and BigInts by content, symbols by what they stand for, objects by identity.
///
/// # Safety
/// As [`decode`].
unsafe fn holds(cur: u64, expected: &Value) -> bool {
    let tag = (cur >> TAG_SHIFT) & TAG_MASK;
    // SAFETY: forwarded; the tag is checked before the datum is read.
    unsafe {
        match expected {
            Value::String(e) => {
                is_boxed(cur) && tag == TAG_STRING && **boxed_ref::<Arc<[u16]>>(cur) == **e
            }
            Value::BigInt(e) => {
                is_boxed(cur) && tag == TAG_BIGINT && **boxed_ref::<Arc<str>>(cur) == **e
            }
            Value::Symbol(e) => {
                is_boxed(cur) && tag == TAG_SYMBOL && boxed_ref::<Arc<SymbolRecord>>(cur).same_as(e)
            }
            _ => cur == encode_plain(expected),
        }
    }
}

/// Counts the readers that are between loading a slot and taking their own count.
struct ReadGuard<'a>(&'a AtomicUsize);

impl Drop for ReadGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// A fixed-length block of atomic slots. A slot that holds a string, BigInt, symbol, struct, mutex
/// or condition owns one strong count of it, and overwriting the slot releases that count once no
/// reader can still be using the old pointer.
///
/// Why that is safe: a reader does `readers += 1`, loads the slot, takes its own count, then
/// `readers -= 1`, all sequentially consistent. A writer swaps the slot (so the old pointer is
/// no longer reachable from it), then, holding the `garbage` lock, pushes the old pointer and
/// frees the whole list only if `readers` is zero. A reader that loaded the old pointer loaded it
/// before the swap in the SeqCst order, and incremented `readers` before that load. The writer's
/// zero read comes after the swap (the lock orders it after every earlier push), and a counter
/// that reads zero has seen every earlier increment matched by its decrement, so that reader has
/// already taken its own count and is done with the pointer. Readers that start later load the
/// new bits. If readers are in flight the list waits for the next overwrite or for the block to
/// drop, so a block under constant read pressure defers reclamation.
pub struct SharedBlock {
    slots: Box<[AtomicU64]>,
    /// Present for a shared struct: what its slots are called.
    shape: Option<Arc<StructShape>>,
    readers: AtomicUsize,
    garbage: Guarded<Vec<Retired>>,
}

impl std::fmt::Debug for SharedBlock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SharedBlock(len={})", self.slots.len())
    }
}

impl Drop for SharedBlock {
    /// Releases what the slots hold. A block that held the last count of another block would drop it inside this call, and so on along
    /// a chain of blocks, one stack frame for each link; the blocks are collected and dropped in a loop instead.
    fn drop(&mut self) {
        let mut pending = Vec::new();
        self.take_blocks(&mut pending);
        while let Some(block) = pending.pop() {
            if let Ok(mut last) = Arc::try_unwrap(block) {
                last.take_blocks(&mut pending);
            }
        }
    }
}

impl SharedBlock {
    /// Empties the slots and the garbage list, releasing everything that is not a block and handing the blocks to `out`.
    fn take_blocks(&mut self, out: &mut Vec<Arc<SharedBlock>>) {
        let undefined = boxed(TAG_SPECIAL, 0);
        for slot in &mut self.slots {
            let bits = std::mem::replace(slot.get_mut(), undefined);
            // SAFETY: `&mut self` means no reader exists, and each slot owns its count, which the replacement gave up.
            if let Some(retired) = unsafe { own(bits) } {
                match retired.into_block() {
                    Ok(block) => out.push(block),
                    Err(other) => drop(other),
                }
            }
        }
        let garbage = std::mem::take(&mut *self.garbage.lock());
        for retired in garbage {
            match retired.into_block() {
                Ok(block) => out.push(block),
                Err(other) => drop(other),
            }
        }
    }
}

impl SharedBlock {
    /// Creates a block whose slots all start as `undefined`. `None` if that much memory is not there.
    pub fn try_new(len: usize) -> Option<Arc<Self>> {
        Self::build(len, None)
    }

    /// As [`SharedBlock::try_new`], for a length that is known to be small.
    #[cfg(test)]
    pub fn new(len: usize) -> Arc<Self> {
        Self::build(len, None).expect("a small block")
    }

    /// Creates a block for a shared struct, one slot for each field of `shape`.
    pub fn with_shape(shape: Arc<StructShape>) -> Option<Arc<Self>> {
        Self::build(shape.len(), Some(shape))
    }

    fn build(len: usize, shape: Option<Arc<StructShape>>) -> Option<Arc<Self>> {
        let undefined = boxed(TAG_SPECIAL, 0);
        let mut slots = Vec::new();
        // A length the allocator cannot give is a failure to report, not a crash.
        slots.try_reserve_exact(len).ok()?;
        slots.extend((0..len).map(|_| AtomicU64::new(undefined)));
        Some(Arc::new(Self {
            slots: slots.into_boxed_slice(),
            shape,
            readers: AtomicUsize::new(0),
            garbage: Guarded::new(Vec::new()),
        }))
    }

    /// The field names, if this block is a shared struct and not a shared array.
    pub fn shape(&self) -> Option<&Arc<StructShape>> {
        self.shape.as_ref()
    }

    #[allow(
        clippy::len_without_is_empty,
        reason = "a block is never asked whether it is empty"
    )]
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    fn enter(&self) -> ReadGuard<'_> {
        self.readers.fetch_add(1, Ordering::SeqCst);
        ReadGuard(&self.readers)
    }

    /// Releases the count that `old` owned, which a swap or a compare-exchange just took out of
    /// a slot, as soon as no reader can still be using it. See the type comment.
    fn retire(&self, old: u64) {
        // SAFETY: the slot owned `old` and the caller removed it, so nothing else releases it.
        let Some(retired) = (unsafe { own(old) }) else {
            return;
        };
        let batch = {
            let mut garbage = self.garbage.lock();
            garbage.push(retired);
            if self.readers.load(Ordering::SeqCst) != 0 {
                return;
            }
            std::mem::take(&mut *garbage)
        };
        drop(batch);
    }

    /// Sequentially consistent read of slot `i`.
    pub fn load(&self, i: usize) -> Value {
        let _guard = self.enter();
        // SAFETY: the guard was taken before the load.
        unsafe { decode(self.slots[i].load(Ordering::SeqCst)) }
    }

    /// Sequentially consistent write of slot `i`.
    pub fn store(&self, i: usize, v: &Value) {
        let old = self.slots[i].swap(encode_owned(v), Ordering::SeqCst);
        self.retire(old);
    }

    /// Writes `v` and returns the previous value.
    pub fn exchange(&self, i: usize, v: &Value) -> Value {
        let old = self.slots[i].swap(encode_owned(v), Ordering::SeqCst);
        // SAFETY: the swap handed this thread the slot's count, which `retire` has not released.
        let previous = unsafe { decode(old) };
        self.retire(old);
        previous
    }

    /// Writes `new` if the slot currently holds `expected`. Returns the value that was read.
    pub fn compare_exchange(&self, i: usize, expected: &Value, new: &Value) -> Value {
        let new_bits = encode_owned(new);
        let slot = &self.slots[i];
        let guard = self.enter();
        let (seen, replaced) = loop {
            let cur = slot.load(Ordering::SeqCst);
            // SAFETY: the guard was taken before this load.
            if !unsafe { holds(cur, expected) } {
                // SAFETY: as above.
                break (unsafe { decode(cur) }, None);
            }
            // Equal content can sit behind different bits, so swap on the exact bits observed
            // and look again if the slot changed in between.
            if slot
                .compare_exchange(cur, new_bits, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                // SAFETY: as above; the swap made `cur` ours, and `retire` has not run yet.
                break (unsafe { decode(cur) }, Some(cur));
            }
        };
        drop(guard);
        match replaced {
            Some(old) => self.retire(old),
            None => release(new_bits),
        }
        seen
    }

    /// Plain `obj.field` read. Slots are sequentially consistent whatever the caller asks for,
    /// because reclaiming an overwritten pointer relies on it.
    pub fn load_relaxed(&self, i: usize) -> Value {
        self.load(i)
    }

    /// Plain `obj.field = v` write; sequentially consistent for the reason given on `load_relaxed`.
    pub fn store_relaxed(&self, i: usize, v: &Value) {
        self.store(i, v);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(text: &str) -> Arc<[u16]> {
        text.encode_utf16().collect::<Vec<_>>().into()
    }

    fn is_str(v: &Value, text: &str) -> bool {
        matches!(v, Value::String(s) if **s == *utf16(text))
    }

    #[test]
    fn dropping_a_long_chain_of_blocks_does_not_recurse() {
        let head = SharedBlock::new(1);
        let mut tail = head.clone();
        for _ in 0..30_000 {
            let next = SharedBlock::new(1);
            tail.store(0, &Value::Struct(next.clone()));
            tail = next;
        }
        drop(tail);
        drop(head);
    }

    #[test]
    fn a_block_too_big_to_allocate_is_none() {
        assert!(SharedBlock::try_new(usize::MAX / 16).is_none());
        assert!(SharedBlock::try_new(4).is_some());
    }

    #[test]
    fn symbols_are_the_same_by_what_they_stand_for() {
        let unique = |id| {
            Value::Symbol(Arc::new(SymbolRecord {
                id,
                registered: false,
                description: Some(utf16("d")),
            }))
        };
        let registered = |text| {
            Value::Symbol(Arc::new(SymbolRecord {
                id: 0,
                registered: true,
                description: Some(utf16(text)),
            }))
        };
        let b = SharedBlock::new(2);
        b.store(0, &unique(5));
        // Another id is another symbol, whatever the description says; the same id is the same one.
        assert!(
            matches!(b.compare_exchange(0, &unique(6), &Value::Null), Value::Symbol(r) if r.id == 5)
        );
        assert!(matches!(b.load(0), Value::Symbol(_)));
        assert!(
            matches!(b.compare_exchange(0, &unique(5), &Value::Null), Value::Symbol(r) if r.id == 5)
        );
        assert!(matches!(b.load(0), Value::Null));
        // A registered symbol is the one with that description, and never a unique one.
        b.store(1, &registered("k"));
        assert!(matches!(
            b.compare_exchange(1, &registered("other"), &Value::Null),
            Value::Symbol(_)
        ));
        assert!(matches!(
            b.compare_exchange(1, &unique(0), &Value::Null),
            Value::Symbol(_)
        ));
        assert!(matches!(b.load(1), Value::Symbol(_)));
        assert!(matches!(
            b.compare_exchange(1, &registered("k"), &Value::Null),
            Value::Symbol(_)
        ));
        assert!(matches!(b.load(1), Value::Null));
    }

    #[test]
    fn primitives_round_trip() {
        let b = SharedBlock::new(8);
        assert!(matches!(b.load(0), Value::Undefined));
        b.store(0, &Value::Null);
        b.store(1, &Value::Bool(true));
        b.store(2, &Value::Bool(false));
        b.store(3, &Value::Number(-0.5));
        b.store(4, &Value::Number(f64::NAN));
        b.store(5, &Value::Number(f64::INFINITY));
        assert!(matches!(b.load(0), Value::Null));
        assert!(matches!(b.load(1), Value::Bool(true)));
        assert!(matches!(b.load(2), Value::Bool(false)));
        assert!(matches!(b.load(3), Value::Number(n) if n == -0.5));
        assert!(matches!(b.load(4), Value::Number(n) if n.is_nan()));
        assert!(matches!(b.load(5), Value::Number(n) if n == f64::INFINITY));
    }

    #[test]
    fn strings_keep_lone_surrogates() {
        let b = SharedBlock::new(2);
        let lone: Arc<[u16]> = vec![0xd800u16, 0x61].into();
        b.store(0, &Value::String(lone.clone()));
        match b.load(0) {
            Value::String(got) => assert_eq!(&*got, &*lone),
            other => panic!("{other:?}"),
        }
        b.store(1, &Value::String(utf16("hi")));
        let seen = b.compare_exchange(1, &Value::String(utf16("hi")), &Value::String(utf16("bye")));
        assert!(is_str(&seen, "hi"));
        assert!(is_str(&b.load(1), "bye"));
    }

    #[test]
    fn struct_references_share_memory() {
        let outer = SharedBlock::new(1);
        let inner = SharedBlock::new(1);
        outer.store(0, &Value::Struct(inner.clone()));
        let Value::Struct(via_outer) = outer.load(0) else {
            panic!()
        };
        via_outer.store(0, &Value::Number(7.0));
        assert!(matches!(inner.load(0), Value::Number(n) if n == 7.0));
        assert!(Arc::ptr_eq(&inner, &via_outer));
    }

    #[test]
    fn sync_primitives_can_be_stored() {
        let b = SharedBlock::new(2);
        let (m, c) = (Mutex::new(), Condition::new());
        b.store(0, &Value::Mutex(m.clone()));
        b.store(1, &Value::Condition(c.clone()));
        assert!(matches!(b.load(0), Value::Mutex(got) if Arc::ptr_eq(&got, &m)));
        assert!(matches!(b.load(1), Value::Condition(got) if Arc::ptr_eq(&got, &c)));
        drop((m, c));
        // The block still owns both.
        assert!(matches!(b.load(0), Value::Mutex(got) if got.try_lock()));
    }

    #[test]
    fn shape_marks_a_struct_block() {
        let shape = StructShape::new(vec![vec![u16::from(b'a')]]).unwrap();
        let b = SharedBlock::with_shape(shape).unwrap();
        assert_eq!(b.len(), 1);
        assert!(b.shape().is_some());
        assert!(SharedBlock::new(1).shape().is_none());
    }

    #[test]
    fn exchange_and_compare_exchange() {
        let b = SharedBlock::new(1);
        b.store(0, &Value::Number(1.0));
        assert!(matches!(b.exchange(0, &Value::Number(2.0)), Value::Number(n) if n == 1.0));
        let seen = b.compare_exchange(0, &Value::Number(9.0), &Value::Number(3.0));
        assert!(matches!(seen, Value::Number(n) if n == 2.0));
        assert!(matches!(b.load(0), Value::Number(n) if n == 2.0));
        b.compare_exchange(0, &Value::Number(2.0), &Value::Number(3.0));
        assert!(matches!(b.load(0), Value::Number(n) if n == 3.0));
    }

    #[test]
    fn concurrent_counter_never_loses_updates() {
        let b = SharedBlock::new(1);
        b.store(0, &Value::Number(0.0));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let b = b.clone();
                std::thread::spawn(move || {
                    for _ in 0..2000 {
                        loop {
                            let Value::Number(cur) = b.load(0) else {
                                panic!()
                            };
                            let seen = b.compare_exchange(
                                0,
                                &Value::Number(cur),
                                &Value::Number(cur + 1.0),
                            );
                            if matches!(seen, Value::Number(n) if n == cur) {
                                break;
                            }
                        }
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert!(matches!(b.load(0), Value::Number(n) if n == 16000.0));
    }

    #[test]
    fn overwriting_a_slot_drops_the_old_child() {
        let outer = SharedBlock::new(1);
        let inner = SharedBlock::new(1);
        let weak = Arc::downgrade(&inner);
        outer.store(0, &Value::Struct(inner.clone()));
        assert_eq!(Arc::strong_count(&inner), 2);
        outer.store(0, &Value::Number(1.0));
        assert_eq!(Arc::strong_count(&inner), 1);
        drop(inner);
        assert_eq!(weak.strong_count(), 0);
    }

    #[test]
    fn exchange_and_dropping_the_block_release_children() {
        let outer = SharedBlock::new(1);
        let inner = SharedBlock::new(0);
        outer.store(0, &Value::Struct(inner.clone()));
        let old = outer.exchange(0, &Value::Null);
        assert!(matches!(&old, Value::Struct(got) if Arc::ptr_eq(got, &inner)));
        drop(old);
        assert_eq!(Arc::strong_count(&inner), 1);
        outer.store(0, &Value::Struct(inner.clone()));
        drop(outer);
        assert_eq!(Arc::strong_count(&inner), 1);
    }

    #[test]
    fn overwritten_strings_are_freed_and_nothing_accumulates() {
        let b = SharedBlock::new(1);
        let first = utf16("first");
        let weak = Arc::downgrade(&first);
        b.store(0, &Value::String(first));
        assert_eq!(weak.strong_count(), 1);
        b.store(0, &Value::Number(0.0));
        assert_eq!(weak.strong_count(), 0);
        // The block holds no table of what it once stored.
        for n in 0..1000 {
            b.store(0, &Value::String(utf16(&format!("unique {n}"))));
            b.store(0, &Value::BigInt(format!("{n}").into()));
            assert!(b.garbage.lock().is_empty());
        }
    }

    #[test]
    fn compare_exchange_compares_string_content() {
        let b = SharedBlock::new(2);
        b.store(0, &Value::String(utf16("hi")));
        let seen = b.compare_exchange(0, &Value::String(utf16("hi")), &Value::String(utf16("bye")));
        assert!(is_str(&seen, "hi"));
        assert!(is_str(&b.load(0), "bye"));

        let replacement = utf16("never stored");
        let weak = Arc::downgrade(&replacement);
        let seen = b.compare_exchange(
            0,
            &Value::String(utf16("nope")),
            &Value::String(replacement),
        );
        assert!(is_str(&seen, "bye"));
        assert!(is_str(&b.load(0), "bye"));
        // A failed exchange drops the replacement it had prepared.
        assert_eq!(weak.strong_count(), 0);

        // A number never equals a string, and BigInts compare by content too.
        let seen = b.compare_exchange(0, &Value::Number(1.0), &Value::Null);
        assert!(is_str(&seen, "bye"));
        b.store(1, &Value::BigInt("12345678901234567890".into()));
        let seen = b.compare_exchange(
            1,
            &Value::BigInt(String::from("12345678901234567890").into()),
            &Value::Bool(true),
        );
        assert!(matches!(seen, Value::BigInt(n) if &*n == "12345678901234567890"));
        assert!(matches!(b.load(1), Value::Bool(true)));
    }

    #[test]
    fn compare_exchange_on_objects_compares_identity() {
        let b = SharedBlock::new(1);
        let (one, two) = (SharedBlock::new(0), SharedBlock::new(0));
        b.store(0, &Value::Struct(one.clone()));
        let seen = b.compare_exchange(0, &Value::Struct(two.clone()), &Value::Null);
        assert!(matches!(&seen, Value::Struct(got) if Arc::ptr_eq(got, &one)));
        b.compare_exchange(0, &Value::Struct(one.clone()), &Value::Struct(two.clone()));
        assert!(matches!(b.load(0), Value::Struct(got) if Arc::ptr_eq(&got, &two)));
        assert_eq!(Arc::strong_count(&one), 2);
    }

    #[test]
    fn concurrent_stores_and_loads_of_strings_and_children() {
        let (threads, rounds) = if cfg!(miri) { (3, 12) } else { (6, 1500) };
        let shared = SharedBlock::new(1);
        let child = SharedBlock::new(1);
        child.store(0, &Value::Number(5.0));
        let workers: Vec<_> = (0..threads)
            .map(|t| {
                let (shared, child) = (shared.clone(), child.clone());
                std::thread::spawn(move || {
                    for n in 0..rounds {
                        match (t + n) % 4 {
                            0 => shared.store(0, &Value::String(utf16(&format!("t{t} n{n}")))),
                            1 => shared.store(0, &Value::Struct(child.clone())),
                            2 => {
                                let _ = shared.exchange(0, &Value::Struct(SharedBlock::new(1)));
                            }
                            _ => {
                                let seen = shared.load(0);
                                let again = shared.compare_exchange(0, &seen, &Value::Null);
                                drop((seen, again));
                            }
                        }
                        match shared.load(0) {
                            Value::String(s) => assert!(!s.is_empty()),
                            Value::Struct(b) => {
                                assert!(matches!(b.load(0), Value::Number(_) | Value::Undefined));
                            }
                            Value::Null => {}
                            other => panic!("{other:?}"),
                        }
                    }
                })
            })
            .collect();
        for w in workers {
            w.join().unwrap();
        }
        // With every reader gone, the next overwrite frees whatever was deferred.
        shared.store(0, &Value::Struct(child.clone()));
        shared.store(0, &Value::Null);
        assert!(shared.garbage.lock().is_empty());
        assert_eq!(Arc::strong_count(&child), 1);
    }
}

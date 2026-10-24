use std::any::Any;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock, RwLock};

use crate::mutex::{Condition, Mutex};
use crate::shape::StructShape;

/// What a slot can hold. These are exactly the values that may cross agents:
/// primitives, other blocks (a shared struct or a shared array) and the sync primitives.
/// Objects, functions and symbols are not shareable.
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

fn boxed(tag: u64, datum: u64) -> u64 {
    debug_assert!(datum <= DATUM_MASK);
    QNAN | (tag << TAG_SHIFT) | datum
}

fn is_boxed(bits: u64) -> bool {
    // Sign bit clear, exponent all ones, quiet bit set, and a non-zero tag. A real NaN is
    // stored as exactly QNAN, which has tag 0, so it is never mistaken for a boxed value.
    bits & 0xfff8_0000_0000_0000 == QNAN && (bits >> TAG_SHIFT) & TAG_MASK != 0
}

/// Append-only table of interned values. Handles are never reused, so a slot's handle
/// stays valid for the life of the process and equal values compare equal by handle.
struct Interner<K: std::hash::Hash + Eq, V: ?Sized> {
    index: StdMutex<HashMap<K, u64>>,
    values: RwLock<Vec<Arc<V>>>,
}

impl<K: std::hash::Hash + Eq, V: ?Sized> Interner<K, V> {
    fn new() -> Self {
        Self {
            index: StdMutex::new(HashMap::new()),
            values: RwLock::new(Vec::new()),
        }
    }

    fn intern(&self, key: K, value: Arc<V>) -> u64 {
        let mut index = self.index.lock().unwrap();
        if let Some(&h) = index.get(&key) {
            return h;
        }
        let mut values = self.values.write().unwrap();
        let h = values.len() as u64;
        assert!(h <= DATUM_MASK, "shared string table exhausted");
        values.push(value);
        index.insert(key, h);
        h
    }

    fn get(&self, h: u64) -> Arc<V> {
        self.values.read().unwrap()[h as usize].clone()
    }
}

fn strings() -> &'static Interner<Arc<[u16]>, [u16]> {
    static T: OnceLock<Interner<Arc<[u16]>, [u16]>> = OnceLock::new();
    T.get_or_init(Interner::new)
}

fn bigints() -> &'static Interner<Arc<str>, str> {
    static T: OnceLock<Interner<Arc<str>, str>> = OnceLock::new();
    T.get_or_init(Interner::new)
}

/// The address a slot stores for `a`.
fn pointer_datum<T>(a: &Arc<T>) -> u64 {
    let ptr = Arc::as_ptr(a) as usize as u64;
    assert!(ptr <= DATUM_MASK, "pointer does not fit in 48 bits");
    ptr
}

/// # Safety
/// `datum` came from [`pointer_datum`] of an `Arc<T>` that some block still keeps alive.
unsafe fn arc_from_datum<T>(datum: u64) -> Arc<T> {
    let ptr = datum as usize as *const T;
    // SAFETY: the caller guarantees the allocation is live, so taking a new strong count is sound.
    unsafe {
        Arc::increment_strong_count(ptr);
        Arc::from_raw(ptr)
    }
}

/// A fixed-length block of atomic slots. Whatever it refers to is kept alive for as
/// long as it lives, so a slot may hold a bare pointer without a per-slot refcount.
pub struct SharedBlock {
    slots: Box<[AtomicU64]>,
    /// Present for a shared struct: what its slots are called.
    shape: Option<Arc<StructShape>>,
    /// Address and owner of every object a slot has ever held.
    kept: StdMutex<Vec<(usize, Arc<dyn Any + Send + Sync>)>>,
}

impl std::fmt::Debug for SharedBlock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SharedBlock(len={})", self.slots.len())
    }
}

impl SharedBlock {
    /// Creates a block whose slots all start as `undefined`.
    pub fn new(len: usize) -> Arc<Self> {
        Self::build(len, None)
    }

    /// Creates a block for a shared struct, one slot for each field of `shape`.
    pub fn with_shape(shape: Arc<StructShape>) -> Arc<Self> {
        Self::build(shape.len(), Some(shape))
    }

    fn build(len: usize, shape: Option<Arc<StructShape>>) -> Arc<Self> {
        let undefined = boxed(TAG_SPECIAL, 0);
        Arc::new(Self {
            slots: (0..len).map(|_| AtomicU64::new(undefined)).collect(),
            shape,
            kept: StdMutex::new(Vec::new()),
        })
    }

    /// The field names, if this block is a shared struct and not a shared array.
    pub fn shape(&self) -> Option<&Arc<StructShape>> {
        self.shape.as_ref()
    }

    fn keep<T: Send + Sync + 'static>(&self, a: &Arc<T>) {
        let addr = Arc::as_ptr(a) as usize;
        let mut kept = self.kept.lock().unwrap();
        if !kept.iter().any(|(p, _)| *p == addr) {
            kept.push((addr, a.clone() as Arc<dyn Any + Send + Sync>));
        }
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    fn encode(&self, v: &Value) -> u64 {
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
            Value::String(s) => boxed(TAG_STRING, strings().intern(s.clone(), s.clone())),
            Value::BigInt(s) => boxed(TAG_BIGINT, bigints().intern(s.clone(), s.clone())),
            Value::Struct(b) => {
                self.keep(b);
                boxed(TAG_STRUCT, pointer_datum(b))
            }
            Value::Mutex(m) => {
                self.keep(m);
                boxed(TAG_MUTEX, pointer_datum(m))
            }
            Value::Condition(c) => {
                self.keep(c);
                boxed(TAG_CONDITION, pointer_datum(c))
            }
        }
    }

    fn decode(&self, bits: u64) -> Value {
        if !is_boxed(bits) {
            return Value::Number(f64::from_bits(bits));
        }
        let datum = bits & DATUM_MASK;
        match (bits >> TAG_SHIFT) & TAG_MASK {
            TAG_SPECIAL => match datum {
                0 => Value::Undefined,
                1 => Value::Null,
                2 => Value::Bool(false),
                _ => Value::Bool(true),
            },
            TAG_STRING => Value::String(strings().get(datum)),
            TAG_BIGINT => Value::BigInt(bigints().get(datum)),
            // SAFETY: each datum came from `pointer_datum` of an Arc held in some block's
            // `kept`. That list is only ever appended to, so the Arc outlives every slot that
            // names it, and the block owning this slot outlives `&self`.
            TAG_STRUCT => Value::Struct(unsafe { arc_from_datum(datum) }),
            TAG_MUTEX => Value::Mutex(unsafe { arc_from_datum(datum) }),
            TAG_CONDITION => Value::Condition(unsafe { arc_from_datum(datum) }),
            _ => Value::Undefined,
        }
    }

    /// Sequentially consistent read of slot `i`.
    pub fn load(&self, i: usize) -> Value {
        self.decode(self.slots[i].load(Ordering::SeqCst))
    }

    /// Sequentially consistent write of slot `i`.
    pub fn store(&self, i: usize, v: &Value) {
        let bits = self.encode(v);
        self.slots[i].store(bits, Ordering::SeqCst);
    }

    /// Writes `v` and returns the previous value.
    pub fn exchange(&self, i: usize, v: &Value) -> Value {
        let bits = self.encode(v);
        self.decode(self.slots[i].swap(bits, Ordering::SeqCst))
    }

    /// Writes `new` if the slot currently holds `expected`. Returns the value that was read.
    pub fn compare_exchange(&self, i: usize, expected: &Value, new: &Value) -> Value {
        let expected = self.encode(expected);
        let new = self.encode(new);
        match self.slots[i].compare_exchange(expected, new, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(old) | Err(old) => self.decode(old),
        }
    }

    /// Unordered read, for plain `obj.field` access.
    pub fn load_relaxed(&self, i: usize) -> Value {
        self.decode(self.slots[i].load(Ordering::Relaxed))
    }

    /// Unordered write, for plain `obj.field = v` access.
    pub fn store_relaxed(&self, i: usize, v: &Value) {
        let bits = self.encode(v);
        self.slots[i].store(bits, Ordering::Relaxed);
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
    fn strings_intern_and_keep_lone_surrogates() {
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
        assert!(matches!(b.load(0), Value::Mutex(got) if !got.is_locked()));
    }

    #[test]
    fn shape_marks_a_struct_block() {
        let shape = StructShape::new(vec![vec![u16::from(b'a')]]).unwrap();
        let b = SharedBlock::with_shape(shape);
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
}

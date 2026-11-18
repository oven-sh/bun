use crate::{CellType, Cx, Gc, JsBigInt, JsResult, JsString, Value};

/// A key in the form in which a `Map` or a `Set` holds it, and its hash.
#[derive(Clone, Copy)]
pub struct HashedKey {
    value: Value,
    hash: u32,
}

impl HashedKey {
    /// The golden ratio, with `INT32_SHIFT` bits after the point. Keys that are close hash to buckets that are close
    /// and distinct, and evenly spaced keys spread evenly.
    pub const ORDERED_MULTIPLIER: u64 = 0x19e3_779b;
    pub const INT32_SHIFT: u32 = 28;
    /// Also drops the bits that alignment leaves clear.
    pub const CELL_SHIFT: u32 = 32;
    pub const MIXING_MULTIPLIER: u64 = 0x9e37_79b9_7f4a_7c15;

    #[inline(always)]
    pub fn new(cx: &Cx, key: Value) -> JsResult<HashedKey> {
        if let Some(string) = key.as_string() {
            let hash = string.resolve(cx)?.hash();
            return Ok(HashedKey { value: key, hash });
        }
        Ok(Self::of_non_string(key))
    }

    #[inline(always)]
    fn of_non_string(key: Value) -> HashedKey {
        let value = Self::normalize(key);
        let hash = if let Some(integer) = value.as_int32() {
            Self::hash_int32(integer)
        } else if let Some(cell) = value.as_cell() {
            match cell.downcast::<JsBigInt>() {
                Some(bigint) => bigint.value().hash(),
                None => Self::hash_address(cell.address()),
            }
        } else {
            Self::mix(value.to_bits())
        };
        HashedKey { value, hash }
    }

    /// For a compiler, which folds the hash of a constant. `None` for a string whose hash is not known yet.
    pub fn try_without_computing(key: Value) -> Option<HashedKey> {
        let Some(string) = key.as_string() else {
            return Some(Self::of_non_string(key));
        };
        let hash = string.try_impl()?.existing_hash();
        (hash != 0).then_some(HashedKey { value: key, hash })
    }

    /// The two are what `new` makes of some key, or else lookups go wrong.
    #[inline(always)]
    pub fn from_parts(value: Value, hash: u32) -> HashedKey {
        debug_assert!(
            Self::try_without_computing(value)
                .is_some_and(|it| it.value == value && it.hash == hash)
        );
        HashedKey { value, hash }
    }

    /// CanonicalizeKeyedCollectionKey, and one encoding for each number.
    #[inline(always)]
    pub fn normalize(key: Value) -> Value {
        let Some(number) = key.as_double() else {
            return key;
        };
        let integer = number as i32;
        if f64::from(integer) == number {
            Value::int32(integer)
        } else if number.is_nan() {
            Value::NAN
        } else {
            key
        }
    }

    #[inline(always)]
    pub const fn hash_int32(integer: i32) -> u32 {
        ((integer as i64 * Self::ORDERED_MULTIPLIER as i64) >> Self::INT32_SHIFT) as u32
    }

    #[inline(always)]
    pub const fn hash_address(address: usize) -> u32 {
        ((address as u64).wrapping_mul(Self::ORDERED_MULTIPLIER) >> Self::CELL_SHIFT) as u32
    }

    /// Every bit of the hash depends on the whole word.
    #[inline(always)]
    pub const fn mix(word: u64) -> u32 {
        let product = word as u128 * Self::MIXING_MULTIPLIER as u128;
        (product as u64 ^ (product >> 64) as u64) as u32
    }

    #[inline(always)]
    pub fn value(self) -> Value {
        self.value
    }

    #[inline(always)]
    pub fn hash(self) -> u32 {
        self.hash
    }

    /// SameValueZero
    #[inline(always)]
    pub(super) fn matches(self, stored: Option<Value>, stored_hash: u32) -> bool {
        stored == Some(self.value)
            || (stored_hash == self.hash && Self::have_same_content(self.value, stored))
    }

    /// Neither is a rope.
    #[inline]
    pub fn have_same_content(a: Value, b: Option<Value>) -> bool {
        let (Some(a), Some(b)) = (a.as_cell(), b.and_then(Value::as_cell)) else {
            return false;
        };
        match (a.cell_type(), b.cell_type()) {
            (CellType::String, CellType::String) => {
                let (a, b): (Gc<JsString>, Gc<JsString>) = (a.cast(), b.cast());
                a.try_impl() == b.try_impl()
            }
            (CellType::BigInt, CellType::BigInt) => {
                a.cast::<JsBigInt>().value() == b.cast::<JsBigInt>().value()
            }
            _ => false,
        }
    }
}

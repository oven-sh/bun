//! Comptime string map optimized for small sets of disparate string keys.
//! Works by separating the keys by length up front and only checking strings of
//! equal length at runtime.
//!
//! `kvs` expects a list literal containing list literals or an array/slice of structs
//! where `.0` is the `&[u8]` key and `.1` is the associated value of type `V`.

// A struct holding precomputed tables (kvs sorted by (len, bytes), plus a `len_indexes`
// table), built via the `comptime_string_map!` macro that callers use.
//
// Downstream callers should prefer `phf::phf_map!` directly when they only need
// `.get()`/`.has()`. This struct exists for the call sites that need `get_with_eql` /
// `get_any_case` / `index_of` / `get_key`.

use bun_core::strings;

#[derive(Copy, Clone)]
pub struct KV<K: 'static, V> {
    pub key: &'static [K],
    pub value: V,
}

/// Precomputed lookup table. Construct via `comptime_string_map!`.
///
/// `N` = number of entries, `LEN_TABLE` = `max_len + 1` (size of `len_indexes`).
pub struct ComptimeStringMapWithKeyType<
    K: 'static,
    V: 'static,
    const N: usize,
    const LEN_TABLE: usize,
> {
    // Filled by the constructor macro.
    min_len: usize,
    max_len: usize,
    /// Sorted ascending by (key.len, key bytes).
    pub kvs: [KV<K, V>; N],
    len_indexes: [usize; LEN_TABLE],
    keys_list: [&'static [K]; N],
}

pub type ComptimeStringMap<V, const N: usize, const LEN_TABLE: usize> =
    ComptimeStringMapWithKeyType<u8, V, N, LEN_TABLE>;

/// Trait abstracting "has a length" for `get_with_eql` inputs.
pub trait HasLength {
    fn length(&self) -> usize;
}
impl<T> HasLength for [T] {
    #[inline]
    fn length(&self) -> usize {
        self.len()
    }
}
impl<T> HasLength for &[T] {
    #[inline]
    fn length(&self) -> usize {
        (*self).len()
    }
}
impl HasLength for &bun_alloc::String {
    #[inline]
    fn length(&self) -> usize {
        bun_alloc::String::length(self)
    }
}

impl<K, V, const N: usize, const LEN_TABLE: usize> ComptimeStringMapWithKeyType<K, V, N, LEN_TABLE>
where
    K: Copy + Eq + Ord + 'static,
    V: Copy + 'static,
{
    /// Builds the precomputed tables. Called by the `comptime_string_map!` macro.
    ///
    /// Sorts by (len asc, bytes asc), then fills `len_indexes[len]` = first index whose
    /// key.len >= len.
    pub fn new(mut sorted_kvs: [KV<K, V>; N]) -> Self {
        // lenAsc comparator
        sorted_kvs.sort_by(|a, b| {
            if a.key.len() != b.key.len() {
                return a.key.len().cmp(&b.key.len());
            }
            // https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array
            a.key.cmp(b.key)
        });

        let min_len = sorted_kvs[0].key.len();
        let max_len = sorted_kvs[N - 1].key.len();
        debug_assert_eq!(LEN_TABLE, max_len + 1);

        let mut len_indexes = [0usize; LEN_TABLE];
        let mut len: usize = 0;
        let mut i: usize = 0;
        while len <= max_len {
            // find the first keyword len == len
            while len > sorted_kvs[i].key.len() {
                i += 1;
            }
            len_indexes[len] = i;
            len += 1;
        }

        let mut keys_list: [&'static [K]; N] = [&[]; N];
        for (i, kv) in sorted_kvs.iter().enumerate() {
            keys_list[i] = kv.key;
        }

        Self {
            min_len,
            max_len,
            kvs: sorted_kvs,
            len_indexes,
            keys_list,
        }
    }

    pub fn keys(&self) -> &[&'static [K]] {
        &self.keys_list
    }

    pub fn has(&self, str: &[K]) -> bool {
        self.get(str).is_some()
    }

    /// Contiguous range in `kvs` whose keys have exactly `len`.
    #[inline(always)]
    fn len_bucket(&self, len: usize) -> core::ops::Range<usize> {
        let start = self.len_indexes[len];
        let mut end = start;
        while end < N && self.kvs[end].key.len() == len {
            end += 1;
        }
        start..end
    }

    pub fn get_with_length(&self, str: &[K], len: usize) -> Option<V> {
        let core::ops::Range { start, end } = self.len_bucket(len);

        // This benchmarked faster for both small and large lists of strings than using a big switch statement
        // But only so long as the keys are a sorted list.
        for i in start..end {
            // PERF: plain slice == here; could swap to
            // `bun_core::strings::eql_comptime_check_len_with_type`
            // (length-known SIMD compare) if hot.
            if str == self.kvs[i].key {
                return Some(self.kvs[i].value);
            }
        }

        None
    }

    pub fn get_with_length_and_eql<I>(
        &self,
        str: I,
        len: usize,
        eqls: impl Fn(I, &'static [K]) -> bool,
    ) -> Option<V>
    where
        I: Copy,
    {
        let core::ops::Range { start, end } = self.len_bucket(len);

        // This benchmarked faster for both small and large lists of strings than using a big switch statement
        // But only so long as the keys are a sorted list.
        for i in start..end {
            if eqls(str, self.kvs[i].key) {
                return Some(self.kvs[i].value);
            }
        }

        None
    }

    pub fn get(&self, str: &[K]) -> Option<V> {
        if str.len() < self.min_len || str.len() > self.max_len {
            return None;
        }

        self.get_with_length(str, str.len())
    }

    /// Returns the index of the key in the sorted list of keys.
    pub fn index_of(&self, str: &[K]) -> Option<usize> {
        if str.len() < self.min_len || str.len() > self.max_len {
            return None;
        }

        let len = str.len();
        let core::ops::Range { start, end } = self.len_bucket(len);

        // This benchmarked faster for both small and large lists of strings than using a big switch statement
        // But only so long as the keys are a sorted list.
        (start..end).find(|&i| str == self.kvs[i].key)
    }

    // `fromJS` / `fromJSCaseInsensitive` live in `src/jsc/comptime_string_map_jsc.rs`
    // (the base `bun_collections` crate has no JSC dependency).

    pub fn get_with_eql<I>(&self, input: I, eql: impl Fn(I, &'static [K]) -> bool) -> Option<V>
    where
        I: Copy + HasLength,
    {
        let length = input.length();
        if length < self.min_len || length > self.max_len {
            return None;
        }

        self.get_with_length_and_eql(input, length, eql)
    }

    /// Lookup the first-defined string key for a given value.
    ///
    /// Linear search.
    pub fn get_key(&self, value: V) -> Option<&'static [K]>
    where
        V: PartialEq,
    {
        for kv in &self.kvs {
            if kv.value == value {
                return Some(kv.key);
            }
        }
        None
    }
}

// u8-specific methods (case-insensitive lookups operate on ASCII bytes).
impl<V, const N: usize, const LEN_TABLE: usize> ComptimeStringMapWithKeyType<u8, V, N, LEN_TABLE>
where
    V: Copy + 'static,
{
    // `bun_alloc::String::eql_comptime` compares against `&[u8]` — effectively u8-only,
    // so this lives in the K=u8 impl, not the generic one.
    pub fn from_string(&self, str: &bun_alloc::String) -> Option<V> {
        self.get_with_eql(str, bun_alloc::String::eql_comptime)
    }

    pub fn get_any_case(&self, input: &[u8]) -> Option<V> {
        self.get_case_insensitive_with_eql(input, strings::eql_comptime_ignore_len)
    }

    pub fn get_case_insensitive_with_eql(
        &self,
        input: &[u8],
        eql: impl Fn(&[u8], &'static [u8]) -> bool,
    ) -> Option<V> {
        let length = input.len();
        if length < self.min_len || length > self.max_len {
            return None;
        }

        // Bounded stack buffer for the common case (every in-tree map has small keys);
        // fall back to a heap buffer for maps whose keys exceed it.
        let mut stack_buf = [0u8; 256];
        let mut heap_buf: Vec<u8>;
        let buf: &mut [u8] = if length <= stack_buf.len() {
            &mut stack_buf[..length]
        } else {
            heap_buf = vec![0u8; length];
            &mut heap_buf[..]
        };
        let lowercased = bun_core::strings::copy_lowercase(input, buf);

        self.get_with_length_and_eql(lowercased, length, eql)
    }
}

/// Build a `ComptimeStringMap<V, N, LEN_TABLE>` from `(key, value)` pairs.
///
/// ```ignore
/// static MAP: ComptimeStringMap<TestEnum, 5, 9> = comptime_string_map!(TestEnum, [
///     (b"these", TestEnum::D),
///     (b"have", TestEnum::A),
///     ...
/// ]);
/// ```
// A `macro_rules!` cannot sort, so this lazy-inits via `once_cell::Lazy` +
// `ComptimeStringMapWithKeyType::new` — correct, with a one-time runtime init cost
// instead of true const construction.
#[macro_export]
macro_rules! comptime_string_map {
    ($V:ty, [ $( ($key:expr, $val:expr) ),* $(,)? ]) => {{
        ::once_cell::sync::Lazy::new(|| {
            $crate::comptime_string_map::ComptimeStringMapWithKeyType::<u8, $V, _, _>::new([
                $( $crate::comptime_string_map::KV { key: $key, value: $val } ),*
            ])
        })
    }};
    // void-value form: `.{ "key" }` → set membership
    ($V:ty, [ $( ($key:expr) ),* $(,)? ]) => {{
        ::once_cell::sync::Lazy::new(|| {
            $crate::comptime_string_map::ComptimeStringMapWithKeyType::<u8, (), _, _>::new([
                $( $crate::comptime_string_map::KV { key: $key, value: () } ),*
            ])
        })
    }};
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    enum TestEnum {
        A,
        B,
        C,
        D,
        E,
    }

    fn test_map(map: &ComptimeStringMap<TestEnum, 5, 9>) {
        assert_eq!(TestEnum::A, map.get(b"have").unwrap());
        assert_eq!(TestEnum::B, map.get(b"nothing").unwrap());
        assert!(map.get(b"missing").is_none());
        assert_eq!(TestEnum::D, map.get(b"these").unwrap());
        assert_eq!(TestEnum::E, map.get(b"samelen").unwrap());

        assert!(!map.has(b"missing"));
        assert!(map.has(b"these"));
    }

    #[test]
    fn comptime_string_map_list_literal_of_list_literals() {
        let map = ComptimeStringMapWithKeyType::<u8, TestEnum, 5, 9>::new([
            KV {
                key: b"these",
                value: TestEnum::D,
            },
            KV {
                key: b"have",
                value: TestEnum::A,
            },
            KV {
                key: b"nothing",
                value: TestEnum::B,
            },
            KV {
                key: b"incommon",
                value: TestEnum::C,
            },
            KV {
                key: b"samelen",
                value: TestEnum::E,
            },
        ]);
        test_map(&map);
    }

    #[test]
    fn comptime_string_map_array_of_structs() {
        let map = ComptimeStringMapWithKeyType::<u8, TestEnum, 5, 9>::new([
            KV {
                key: b"these",
                value: TestEnum::D,
            },
            KV {
                key: b"have",
                value: TestEnum::A,
            },
            KV {
                key: b"nothing",
                value: TestEnum::B,
            },
            KV {
                key: b"incommon",
                value: TestEnum::C,
            },
            KV {
                key: b"samelen",
                value: TestEnum::E,
            },
        ]);
        test_map(&map);
    }

    #[test]
    fn comptime_string_map_slice_of_structs() {
        let map = ComptimeStringMapWithKeyType::<u8, TestEnum, 5, 9>::new([
            KV {
                key: b"these",
                value: TestEnum::D,
            },
            KV {
                key: b"have",
                value: TestEnum::A,
            },
            KV {
                key: b"nothing",
                value: TestEnum::B,
            },
            KV {
                key: b"incommon",
                value: TestEnum::C,
            },
            KV {
                key: b"samelen",
                value: TestEnum::E,
            },
        ]);
        test_map(&map);
    }

    fn test_set(map: &ComptimeStringMap<(), 5, 9>) {
        assert_eq!((), map.get(b"have").unwrap());
        assert_eq!((), map.get(b"nothing").unwrap());
        assert!(map.get(b"missing").is_none());
        assert_eq!((), map.get(b"these").unwrap());
        assert_eq!((), map.get(b"samelen").unwrap());

        assert!(!map.has(b"missing"));
        assert!(map.has(b"these"));
    }

    #[test]
    fn comptime_string_map_void_value_type_slice_of_structs() {
        let map = ComptimeStringMapWithKeyType::<u8, (), 5, 9>::new([
            KV {
                key: b"these",
                value: (),
            },
            KV {
                key: b"have",
                value: (),
            },
            KV {
                key: b"nothing",
                value: (),
            },
            KV {
                key: b"incommon",
                value: (),
            },
            KV {
                key: b"samelen",
                value: (),
            },
        ]);
        test_set(&map);
    }

    #[test]
    fn comptime_string_map_void_value_type_list_literal_of_list_literals() {
        let map = ComptimeStringMapWithKeyType::<u8, (), 5, 9>::new([
            KV {
                key: b"these",
                value: (),
            },
            KV {
                key: b"have",
                value: (),
            },
            KV {
                key: b"nothing",
                value: (),
            },
            KV {
                key: b"incommon",
                value: (),
            },
            KV {
                key: b"samelen",
                value: (),
            },
        ]);
        test_set(&map);
    }

    // `TestEnum2` + its 39-entry `map`/`official` table existed only as a
    // benchmark fixture (no `test` block references it).
    // Omitted; can re-add as a criterion bench if needed.
}

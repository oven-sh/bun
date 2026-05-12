//! Comptime string map optimized for small sets of disparate string keys.
//! Works by separating the keys by length at comptime and only checking strings of
//! equal length at runtime.
//!
//! `kvs` expects a list literal containing list literals or an array/slice of structs
//! where `.0` is the `&[u8]` key and `.1` is the associated value of type `V`.
// TODO: https://github.com/ziglang/zig/issues/4335

// PORT NOTE: The Zig original is a `fn(comptime KeyType, comptime V, comptime kvs_list) type`
// that does heavy comptime work: sorts kvs by (len, bytes), builds a `len_indexes` table,
// then every lookup is an `inline while` over lengths × `inline for` over same-length keys
// with `eqlComptime` (length-known SIMD compare). Rust cannot replicate the per-callsite
// monomorphization without a proc-macro. Phase A models this as a const-constructed struct
// holding the precomputed tables plus a `comptime_string_map!` macro that callers use.
// Runtime loops replace `inline for`/`inline while`; each is tagged `PERF(port)`.
//
// Per PORTING.md crate-map, downstream callers of `bun.ComptimeStringMap(V, .{...})` should
// prefer `phf::phf_map!` directly when they only need `.get()`/`.has()`. This struct exists
// for the call sites that need `get_with_eql` / `get_any_case` / `index_of` / `get_key`.

// TODO(b0): `strings` arrives in bun_core via move-in (was bun_core::strings — same-tier cycle).
use bun_core::strings;

#[derive(Copy, Clone)]
pub struct KV<K: 'static, V> {
    pub key: &'static [K],
    pub value: V,
}

/// Precomputed lookup table. Construct via `comptime_string_map!` / `comptime_string_map_16!`.
///
/// `N` = number of entries, `LEN_TABLE` = `max_len + 1` (size of `len_indexes`).
pub struct ComptimeStringMapWithKeyType<
    K: 'static,
    V: 'static,
    const N: usize,
    const LEN_TABLE: usize,
> {
    // PORT NOTE: in Zig these were `precomputed.{min_len,max_len,sorted_kvs,len_indexes}`
    // computed in a `comptime blk:`. Here they are filled by the constructor macro.
    min_len: usize,
    max_len: usize,
    /// Sorted ascending by (key.len, key bytes).
    pub kvs: [KV<K, V>; N],
    len_indexes: [usize; LEN_TABLE],
    keys_list: [&'static [K]; N],
}

pub type ComptimeStringMap<V, const N: usize, const LEN_TABLE: usize> =
    ComptimeStringMapWithKeyType<u8, V, N, LEN_TABLE>;

pub type ComptimeStringMap16<V, const N: usize, const LEN_TABLE: usize> =
    ComptimeStringMapWithKeyType<u16, V, N, LEN_TABLE>;

/// Trait abstracting "has a length" for `get_with_eql` inputs — Zig used
/// `if (@hasField(Input, "len")) input.len else input.length()`.
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
// TODO(b0): `String` arrives in bun_alloc via move-in (was bun_core::String — same-tier cycle).
impl HasLength for &bun_alloc::String {
    #[inline]
    fn length(&self) -> usize {
        bun_alloc::String::length(self)
    }
}

// PORT NOTE: `pub const Value = V;` (inherent assoc type) is nightly-only;
// callers can write `V` directly.

impl<K, V, const N: usize, const LEN_TABLE: usize> ComptimeStringMapWithKeyType<K, V, N, LEN_TABLE>
where
    K: Copy + Eq + Ord + 'static,
    V: Copy + 'static,
{
    /// Builds the precomputed tables. Called by the `comptime_string_map!` macro.
    ///
    /// Mirrors the `comptime blk:` in the Zig: sort by (len asc, bytes asc), then
    /// fill `len_indexes[len]` = first index whose key.len >= len.
    // TODO(port): make this a `const fn` once const-sort is stable, or move to build.rs.
    // PERF(port): Zig did this at comptime (zero runtime cost); this runs once at init.
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
    ///
    /// PORT NOTE: the .zig spec open-coded this at every lookup site because `len` was
    /// `comptime` there and each needed its own `comptime brk:` block. In the Rust port
    /// `len` is runtime, so the duplication is vestigial — extract once and inline.
    #[inline(always)]
    fn len_bucket(&self, len: usize) -> core::ops::Range<usize> {
        let start = self.len_indexes[len];
        let mut end = start;
        while end < N && self.kvs[end].key.len() == len {
            end += 1;
        }
        start..end
    }

    // PORT NOTE: `comptime len: usize` → runtime `len: usize`. The Zig used the comptime
    // value to compute `end` at comptime and `inline for` the range; we loop at runtime.
    // PERF(port): was comptime monomorphization — profile in Phase B.
    pub fn get_with_length(&self, str: &[K], len: usize) -> Option<V> {
        let core::ops::Range { start, end } = self.len_bucket(len);

        // This benchmarked faster for both small and large lists of strings than using a big switch statement
        // But only so long as the keys are a sorted list.
        for i in start..end {
            // PERF(port): Zig used `strings.eqlComptimeCheckLenWithType(K, str, kvs[i].key, false)`
            // (length-known SIMD compare). Plain slice == here; Phase B may swap to
            // `bun_core::strings::eql_comptime_check_len_with_type`.
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
        // PERF(port): was `inline for` — profile in Phase B.
        for i in start..end {
            if eqls(str, self.kvs[i].key) {
                return Some(self.kvs[i].value);
            }
        }

        None
    }

    pub fn get_with_length_and_eql_list<I>(
        &self,
        str: I,
        len: usize,
        eqls: impl Fn(I, &[&'static [K]]) -> Option<usize>,
    ) -> Option<V> {
        let core::ops::Range { start, end } = self.len_bucket(len);

        let range = &self.keys()[start..end];
        if let Some(k) = eqls(str, range) {
            return Some(self.kvs[start + k].value);
        }

        None
    }

    pub fn get(&self, str: &[K]) -> Option<V> {
        if str.len() < self.min_len || str.len() > self.max_len {
            return None;
        }

        // PERF(port): Zig `inline while (i <= max_len)` dispatched to a monomorphized
        // `getWithLength(str, comptime i)`. We call the runtime version directly.
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
        // PERF(port): was `inline for` over comptime range.
        for i in start..end {
            if str == self.kvs[i].key {
                return Some(i);
            }
        }

        None
    }

    // TODO(port): move to *_jsc — `fromJS` / `fromJSCaseInsensitive` were thin shims to
    // `jsc/comptime_string_map_jsc.zig`. In Rust these become extension-trait methods in
    // `bun_jsc` (e.g. `impl<V> ComptimeStringMapJsc for ComptimeStringMap<V, ..>`).
    // The base `bun_collections` crate has no JSC dependency.

    pub fn get_with_eql<I>(&self, input: I, eql: impl Fn(I, &'static [K]) -> bool) -> Option<V>
    where
        I: Copy + HasLength,
    {
        let length = input.length();
        if length < self.min_len || length > self.max_len {
            return None;
        }

        // PERF(port): was `inline while` dispatch to comptime-len variant.
        self.get_with_length_and_eql(input, length, eql)
    }

    pub fn get_with_eql_list<I>(
        &self,
        input: I,
        eql: impl Fn(I, &[&'static [K]]) -> Option<usize>,
    ) -> Option<V>
    where
        I: HasLength,
    {
        let length = input.length();
        if length < self.min_len || length > self.max_len {
            return None;
        }

        // PERF(port): was `inline while` dispatch to comptime-len variant.
        self.get_with_length_and_eql_list(input, length, eql)
    }

    /// Lookup the first-defined string key for a given value.
    ///
    /// Linear search.
    pub fn get_key(&self, value: V) -> Option<&'static [K]>
    where
        V: PartialEq,
    {
        // PERF(port): was `inline for` — profile in Phase B.
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
    // PORT NOTE: Zig `fromString` calls `bun.String.eqlComptime`, which compares against
    // `[]const u8` — effectively u8-only. Lives in the K=u8 impl, not the generic one.
    // TODO(b0): `String` arrives in bun_alloc via move-in (was bun_core::String).
    pub fn from_string(&self, str: &bun_alloc::String) -> Option<V> {
        self.get_with_eql(str, bun_alloc::String::eql_comptime)
    }

    pub fn get_asciii_case_insensitive(&self, input: &[u8]) -> Option<V> {
        // PORT NOTE: Zig name has triple-I (`getASCIIICaseInsensitive`); preserved per
        // "match fn names" rule. Body is identical to `get_any_case` — both lowercase
        // ASCII into a stack buffer then dispatch via eql_comptime_ignore_len. Zig
        // duplicates them too (comptime_string_map.zig:212/256); we dedup here.
        self.get_any_case(input)
    }

    #[inline]
    pub fn get_with_eql_lowercase(
        &self,
        input: &[u8],
        eql: impl Fn(&[u8], &'static [u8]) -> bool,
    ) -> Option<V> {
        // PORT NOTE: identical to `get_case_insensitive_with_eql` — Zig has both
        // (`std.ascii.toLower` vs manual `'A'..'Z' => c+32`, byte-equivalent on u8).
        // Kept as a named forwarder to honor the "match Zig fn names" rule.
        self.get_case_insensitive_with_eql(input, eql)
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

        // PERF(port): Zig built a `[i]u8` stack buffer per comptime length; we use a
        // bounded stack buffer sized to max_len. Profile in Phase B.
        // TODO(port): if max_len can exceed a small bound at any call site, revisit.
        let mut buf = [0u8; 256];
        debug_assert!(length <= buf.len());
        let lowercased = bun_core::strings::copy_lowercase(input, &mut buf[..length]);

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
// TODO(port): proc-macro — Zig sorted + built len_indexes at comptime. A `macro_rules!`
// cannot sort; either (a) require callers pre-sort and compute LEN_TABLE, (b) use a
// proc-macro, or (c) lazy-init via `once_cell::Lazy` + `ComptimeStringMapWithKeyType::new`.
// Phase A picks (c) for correctness; Phase B may upgrade to a proc-macro for true const.
#[macro_export]
macro_rules! comptime_string_map {
    ($V:ty, [ $( ($key:expr, $val:expr) ),* $(,)? ]) => {{
        // PERF(port): was comptime; now lazy runtime init.
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

#[macro_export]
macro_rules! comptime_string_map_16 {
    ($V:ty, [ $( ($key:expr, $val:expr) ),* $(,)? ]) => {{
        // PORT NOTE: Zig had `@compileError("Not implemented for this key type")` for non-u8
        // in the kv-copy loop, but `ComptimeStringMap16` is exported anyway. Keep the
        // export; the compile_error moves to the macro body if ever instantiated.
        compile_error!("ComptimeStringMap16: not implemented for this key type");
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
        // PORT NOTE: Zig tested that anonymous-struct and named-struct kv inputs both work.
        // In Rust there is one input shape (`KV`), so this collapses to the same test.
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

    // PORT NOTE: `TestEnum2` + its 39-entry `map`/`official` table existed only as a
    // benchmark fixture against `std.ComptimeStringMap` (no `test` block references it).
    // Omitted; Phase B can re-add as a criterion bench if needed.
}

// ported from: src/collections/comptime_string_map.zig

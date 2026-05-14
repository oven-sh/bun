//! Deprecated: Use `parse_ex` instead

use core::marker::PhantomData;

use crate::args::ArgIter;
use crate::streaming::{self, StreamingClap};
use crate::{Names, Param, ParseOptions, Values};

// ─────────────────────────────────────────────────────────────────────────────
// Compile-time conversion (Zig parity)
//
// Zig's `ComptimeClap(Id, params)` is a comptime type-generator: it iterates
// `params` *at comptime* to (a) re-index every param's `id` to its slot within
// its category (flag / single / multi) and (b) emit a struct with fixed-size
// array fields. `findParam` is `inline for`, so every `args.flag("--foo")`
// compiles to a constant index — zero runtime cost.
//
// The Phase-A port did all of this at runtime: `convert_params` heap-allocated
// a `Vec<Param<usize>>` on every CLI start, and `find_param` linear-scanned it
// for every `flag()`/`option()` lookup (~190 lookups × ~100 params on the
// `bun run` path). perf put this at ~0.25 % of `bun --version` cycles vs ~0 %
// in Zig.
//
// This module restores the comptime semantics on stable Rust:
//
//   * `count_flags` / `count_single` / `count_multi` / `convert_params_array`
//     / `find_param_index` are all `const fn`, so a param table declared with
//     `concat_params!` can be converted to a `static [Param<usize>; N]` and a
//     name lookup can be folded to a constant via `const { find_param_index(..) }`.
//
//   * `comptime_table!` (in `lib.rs`) packages the const-fn output as a
//     `&'static ConvertedTable` — the Rust analogue of the Zig comptime
//     `converted_params` const baked into the generated type.
//
//   * Every per-subcommand table in `runtime/cli/Arguments.rs` is now a
//     `pub static *_TABLE: &ConvertedTable = comptime_table!(*_PARAMS)`, and
//     `Arguments::parse` enters via `clap::parse_with_table`, so the startup
//     hot path (`bun --version`, `bun run …`) never touches the heap-backed
//     `for_params` / `build` / `Mutex` registry below. That path is retained
//     only for the cold non-startup callers (`bun create`, `bun install`)
//     that still pass a raw `&'static [Param<Id>]`.
// ─────────────────────────────────────────────────────────────────────────────

use bun_core::strings::const_bytes_eq as bytes_eq;

#[inline]
const fn is_named<Id>(p: &Param<Id>) -> bool {
    p.names.long.is_some() || p.names.short.is_some()
}

/// Count flag params (named, `takes_value == None`). Zig: comptime loop arm.
pub const fn count_flags<Id>(params: &[Param<Id>]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < params.len() {
        if is_named(&params[i]) && matches!(params[i].takes_value, Values::None) {
            n += 1;
        }
        i += 1;
    }
    n
}

/// Count single-value params (named, `One` / `OneOptional`).
pub const fn count_single<Id>(params: &[Param<Id>]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < params.len() {
        if is_named(&params[i])
            && matches!(params[i].takes_value, Values::One | Values::OneOptional)
        {
            n += 1;
        }
        i += 1;
    }
    n
}

/// Count multi-value params (named, `Many`).
pub const fn count_multi<Id>(params: &[Param<Id>]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < params.len() {
        if is_named(&params[i]) && matches!(params[i].takes_value, Values::Many) {
            n += 1;
        }
        i += 1;
    }
    n
}

/// Compile-time equivalent of the Zig comptime conversion loop (comptime.zig
/// lines 6–32): re-indexes each param's `id` to its slot within its category.
/// `N` must equal `params.len()` (asserted at const-eval).
pub const fn convert_params_array<Id, const N: usize>(params: &[Param<Id>]) -> [Param<usize>; N] {
    const DUMMY: Param<usize> = Param {
        id: 0,
        names: Names {
            short: None,
            long: None,
            long_aliases: &[],
        },
        takes_value: Values::None,
    };
    let mut out = [DUMMY; N];
    let mut flags = 0usize;
    let mut single = 0usize;
    let mut multi = 0usize;
    let mut i = 0;
    while i < params.len() {
        let p = &params[i];
        let mut index = 0usize;
        if is_named(p) {
            match p.takes_value {
                Values::None => {
                    index = flags;
                    flags += 1;
                }
                Values::One | Values::OneOptional => {
                    index = single;
                    single += 1;
                }
                Values::Many => {
                    index = multi;
                    multi += 1;
                }
            }
        }
        out[i] = Param {
            id: index,
            names: p.names,
            takes_value: p.takes_value,
        };
        i += 1;
    }
    assert!(i == N, "convert_params_array: N != params.len()");
    out
}

/// Compile-time name → converted-param index. This is the Rust analogue of
/// Zig's `inline for` `findParam` and is intended to be called inside a
/// `const { }` block so the loop folds to a literal:
///
/// ```ignore
/// const IDX: usize = find_param_index(TABLE.converted, b"--help");
/// ```
///
/// Panics (at const-eval, i.e. a build error) if `name` is not in `converted`
/// — matching Zig's `@compileError("no param '…'")`.
pub const fn find_param_index(converted: &[Param<usize>], name: &[u8]) -> usize {
    if name.len() > 2 && name[0] == b'-' && name[1] == b'-' {
        let (_, key) = name.split_at(2);
        let mut i = 0;
        while i < converted.len() {
            let n = &converted[i].names;
            if let Some(l) = n.long {
                if bytes_eq(l, key) {
                    return i;
                }
            }
            let mut a = 0;
            while a < n.long_aliases.len() {
                if bytes_eq(n.long_aliases[a], key) {
                    return i;
                }
                a += 1;
            }
            i += 1;
        }
    } else if name.len() == 2 && name[0] == b'-' {
        let s = name[1];
        let mut i = 0;
        while i < converted.len() {
            if let Some(c) = converted[i].names.short {
                if c == s {
                    return i;
                }
            }
            i += 1;
        }
    }
    panic!("clap: no such parameter");
}

/// Count `--long` names + aliases. `const fn` so [`comptime_table!`] can size
/// the rodata long-name index array.
pub const fn count_long_entries<Id>(params: &[Param<Id>]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < params.len() {
        if params[i].names.long.is_some() {
            n += 1;
        }
        n += params[i].names.long_aliases.len();
        i += 1;
    }
    n
}

/// Build the sorted-by-hash long-name → param-index lookup at compile time.
/// `M` must equal [`count_long_entries`]`(params)`. Index `i` corresponds 1:1
/// with `convert_params_array(params)[i]` (both preserve input order). Uses
/// insertion sort — `M` is bounded by the number of CLI flags (~120) and this
/// runs at const-eval, never at runtime.
pub const fn build_long_index<Id, const M: usize>(params: &[Param<Id>]) -> [LongEntry; M] {
    let mut out = [LongEntry { hash: 0, idx: 0 }; M];
    let mut w = 0;
    let mut i = 0;
    while i < params.len() {
        let n = &params[i].names;
        if let Some(l) = n.long {
            out[w] = LongEntry {
                hash: fnv1a64(l),
                idx: i as u16,
            };
            w += 1;
        }
        let mut a = 0;
        while a < n.long_aliases.len() {
            out[w] = LongEntry {
                hash: fnv1a64(n.long_aliases[a]),
                idx: i as u16,
            };
            w += 1;
            a += 1;
        }
        i += 1;
    }
    assert!(w == M, "build_long_index: M != count_long_entries()");
    // `slice::sort_unstable_by_key` is not `const`; insertion sort is.
    let mut j = 1;
    while j < M {
        let key = out[j];
        let mut k = j;
        while k > 0 && out[k - 1].hash > key.hash {
            out[k] = out[k - 1];
            k -= 1;
        }
        out[k] = key;
        j += 1;
    }
    out
}

/// `[i16; 128]` ASCII → index into `converted`. `-1` = no such short.
pub const fn build_short_index(converted: &[Param<usize>]) -> [i16; 128] {
    let mut idx = [-1i16; 128];
    let mut i = 0;
    while i < converted.len() {
        if let Some(s) = converted[i].names.short {
            idx[(s & 0x7f) as usize] = i as i16;
        }
        i += 1;
    }
    idx
}

// ─────────────────────────────────────────────────────────────────────────────
// ConvertedTable — interned, per-static-slice
// ─────────────────────────────────────────────────────────────────────────────

/// FNV-1a 64. `const fn` so `comptime_table!` can pre-hash; also used at
/// runtime for the long-name index.
#[inline]
pub const fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut i = 0;
    while i < bytes.len() {
        h ^= bytes[i] as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
        i += 1;
    }
    h
}

/// One long-name (or alias) lookup entry: hash → index into `converted`.
#[derive(Copy, Clone)]
pub struct LongEntry {
    hash: u64,
    idx: u16,
}

/// Pre-converted param table. Either fully `const`-built via
/// [`comptime_table!`](crate::comptime_table) (rodata, zero runtime cost) or
/// lazily built once per unique input slice via [`ConvertedTable::for_params`]
/// and interned for the process lifetime.
pub struct ConvertedTable {
    pub converted: &'static [Param<usize>],
    pub n_flags: usize,
    pub n_single: usize,
    pub n_multi: usize,
    /// Sorted by `hash`; binary-searched in `find`. Populated by both the
    /// const-eval path ([`build_long_index`] via `comptime_table!`) and the
    /// runtime fallback path (`build`).
    long_index: &'static [LongEntry],
    short_index: [i16; 128],
}

impl ConvertedTable {
    /// Build a table entirely at compile time. All four arguments come from
    /// the `const fn`s above via [`comptime_table!`](crate::comptime_table),
    /// so the converted param array, category counts, sorted long-name hash
    /// index, and short-name direct index all land in rodata — full Zig
    /// `ComptimeClap` parity with zero runtime work.
    pub const fn from_const(
        converted: &'static [Param<usize>],
        n_flags: usize,
        n_single: usize,
        n_multi: usize,
        long_index: &'static [LongEntry],
    ) -> Self {
        Self {
            converted,
            n_flags,
            n_single,
            n_multi,
            long_index,
            short_index: build_short_index(converted),
        }
    }

    /// Look up (or build + intern) the converted table for a `'static` param
    /// slice. **Cold path** — the startup hot set (`Arguments::parse`) goes
    /// through [`comptime_table!`](crate::comptime_table) +
    /// [`ComptimeClap::parse_with_table`] and never reaches this. Kept for the
    /// handful of non-startup callers (`bun create`, `bun install`) that still
    /// hand a raw `&'static [Param<Id>]` to `clap::parse`.
    #[cold]
    pub fn for_params<Id>(params: &'static [Param<Id>]) -> &'static ConvertedTable {
        let key = (params.as_ptr() as usize, params.len());
        {
            let reg = registry().lock();
            let mut i = 0;
            while i < reg.len() {
                if reg[i].0 == key {
                    return reg[i].1;
                }
                i += 1;
            }
        }
        let built = Self::build(params);
        let mut reg = registry().lock();
        // Re-check under lock (startup is single-threaded in practice, but be safe).
        let mut i = 0;
        while i < reg.len() {
            if reg[i].0 == key {
                return reg[i].1;
            }
            i += 1;
        }
        reg.push((key, built));
        built
    }

    #[cold]
    fn build<Id>(params: &'static [Param<Id>]) -> &'static ConvertedTable {
        // Conversion loop — identical to `convert_params_array` but heap-backed
        // because `N` is not a const here.
        let mut flags = 0usize;
        let mut single = 0usize;
        let mut multi = 0usize;
        let mut converted: Vec<Param<usize>> = Vec::with_capacity(params.len());
        for p in params {
            let mut index = 0usize;
            if p.names.long.is_some() || p.names.short.is_some() {
                let ctr = match p.takes_value {
                    Values::None => &mut flags,
                    Values::One | Values::OneOptional => &mut single,
                    Values::Many => &mut multi,
                };
                index = *ctr;
                *ctr += 1;
            }
            converted.push(Param {
                id: index,
                names: p.names,
                takes_value: p.takes_value,
            });
        }
        let converted: &'static [Param<usize>] = Box::leak(converted.into_boxed_slice());

        // Long-name index: one entry per long + alias, sorted by hash.
        let mut long: Vec<LongEntry> = Vec::with_capacity(converted.len());
        let mut short_index = [-1i16; 128];
        for (i, p) in converted.iter().enumerate() {
            if let Some(s) = p.names.short {
                short_index[(s & 0x7f) as usize] = i as i16;
            }
            if let Some(l) = p.names.long {
                long.push(LongEntry {
                    hash: fnv1a64(l),
                    idx: i as u16,
                });
            }
            for alias in p.names.long_aliases {
                long.push(LongEntry {
                    hash: fnv1a64(alias),
                    idx: i as u16,
                });
            }
        }
        // Insertion sort by hash (matches the const-eval `build_long_index`
        // path). `long.len()` is bounded by the per-command flag count (~tens),
        // and this is a one-shot cold operation, so an O(n²) insertion sort is
        // free — and it avoids dragging the generic `slice::sort_unstable`
        // (pdqsort) instantiation onto the `bun install` / `bun create` arg
        // path, which is the only place this `#[cold]` builder runs.
        {
            let mut j = 1;
            while j < long.len() {
                let key = long[j];
                let mut k = j;
                while k > 0 && long[k - 1].hash > key.hash {
                    long[k] = long[k - 1];
                    k -= 1;
                }
                long[k] = key;
                j += 1;
            }
        }
        let long_index: &'static [LongEntry] = Box::leak(long.into_boxed_slice());

        Box::leak(Box::new(ConvertedTable {
            converted,
            n_flags: flags,
            n_single: single,
            n_multi: multi,
            long_index,
            short_index,
        }))
    }

    /// Runtime name resolution. O(1) for shorts, O(log n) for longs (with a
    /// final byte-compare to reject hash collisions). Const-built tables now
    /// carry a rodata `long_index` too, so the linear-scan fallback is only
    /// reachable from a hand-rolled `from_const(.., &[])`.
    #[inline]
    fn find(&self, name: &[u8]) -> &'static Param<usize> {
        if name.len() == 2 && name[0] == b'-' {
            let i = self.short_index[(name[1] & 0x7f) as usize];
            if i >= 0 {
                return &self.converted[i as usize];
            }
        } else if name.len() > 2 && name[0] == b'-' && name[1] == b'-' {
            let key = &name[2..];
            if !self.long_index.is_empty() {
                let h = fnv1a64(key);
                // Binary search to the first entry with this hash, then walk
                // the (tiny) collision run verifying bytes.
                let idx = self.long_index.partition_point(|e| e.hash < h);
                let mut j = idx;
                while j < self.long_index.len() && self.long_index[j].hash == h {
                    let p = &self.converted[self.long_index[j].idx as usize];
                    if p.names.long.map_or(false, |l| l == key)
                        || p.names.long_aliases.iter().any(|a| *a == key)
                    {
                        return p;
                    }
                    j += 1;
                }
            } else {
                // Const-built table: no runtime index. This path is only hit
                // by code that mixes `comptime_table!` with runtime `flag()`;
                // the intended fast path is `const { find_param_index(..) }`.
                return &self.converted[find_param_index(self.converted, name)];
            }
        }
        unreachable!("{} is not a parameter.", bstr::BStr::new(name))
    }
}

type RegKey = (usize, usize);
type Registry = bun_core::Mutex<Vec<(RegKey, &'static ConvertedTable)>>;

fn registry() -> &'static Registry {
    static REG: Registry = bun_core::Mutex::new(Vec::new());
    &REG
}

/// Legacy runtime conversion. Kept for back-compat with out-of-tree callers;
/// in-tree code goes through [`ConvertedTable::for_params`] /
/// [`convert_params_array`].
pub fn convert_params<Id>(params: &[Param<Id>]) -> (Vec<Param<usize>>, usize, usize, usize) {
    let mut flags = 0usize;
    let mut single = 0usize;
    let mut multi = 0usize;
    let mut converted: Vec<Param<usize>> = Vec::with_capacity(params.len());
    for param in params {
        let mut index = 0usize;
        if param.names.long.is_some() || param.names.short.is_some() {
            let ptr = match param.takes_value {
                Values::None => &mut flags,
                Values::OneOptional | Values::One => &mut single,
                Values::Many => &mut multi,
            };
            index = *ptr;
            *ptr += 1;
        }
        converted.push(Param {
            id: index,
            names: param.names,
            takes_value: param.takes_value,
        });
    }
    (converted, flags, single, multi)
}

// ─────────────────────────────────────────────────────────────────────────────
// ComptimeClap
// ─────────────────────────────────────────────────────────────────────────────

/// Deprecated: Use `parse_ex` instead
pub struct ComptimeClap<Id> {
    // Field order matches comptime.zig.
    // Inner `&'static [u8]` slices borrow argv (process-lifetime); never freed in Zig `deinit`.
    pub single_options: Box<[Option<&'static [u8]>]>,
    pub multi_options: Box<[Box<[&'static [u8]]>]>,
    pub flags: Box<[bool]>,
    pub pos: Box<[&'static [u8]]>,
    pub passthrough_positionals: Box<[&'static [u8]]>,
    // `mem.Allocator param` field deleted — global mimalloc (see PORTING.md §Allocators).

    // Zig captures `converted_params` as a comptime const on the returned type. Rust
    // carries it as a `&'static` table — either rodata (`comptime_table!`) or
    // interned-once via the ptr-keyed registry — so `flag`/`option` resolve via
    // hashed lookup instead of an O(n) scan, and no per-parse `Vec` is allocated.
    table: &'static ConvertedTable,
    _id: PhantomData<Id>,
}

impl<Id> ComptimeClap<Id> {
    /// `iter` must yield `&'static [u8]` (process-lifetime args, e.g. `OsIterator`)
    /// because parsed values are stored by reference.
    ///
    /// `params` must be `'static` (every in-tree table is a `static`/`const`
    /// item); the converted form is interned once per unique slice.
    ///
    /// **Cold path** — the startup hot set goes through
    /// [`comptime_table!`](crate::comptime_table) + [`parse_with_table`]
    /// (`bun --version`, `bun run …`). Only non-startup callers that still hand a
    /// raw `&'static [Param<Id>]` (`bun install`, `bun create`) reach this, so
    /// it's marked `#[cold]` to keep the runtime-conversion machinery
    /// (`for_params` registry, `build`) out of the startup hot cluster.
    #[cold]
    pub fn parse<I>(
        params: &'static [Param<Id>],
        iter: &mut I,
        opt: ParseOptions<'_>,
    ) -> Result<Self, bun_core::Error>
    where
        I: ArgIter<'static>,
    {
        Self::parse_with_table(ConvertedTable::for_params(params), iter, opt)
    }

    /// Parse against a pre-converted table (see [`comptime_table!`](crate::comptime_table)).
    /// This is the zero-conversion-cost entry point — `table` is rodata.
    pub fn parse_with_table<I>(
        table: &'static ConvertedTable,
        iter: &mut I,
        opt: ParseOptions<'_>,
    ) -> Result<Self, bun_core::Error>
    where
        I: ArgIter<'static>,
        // TODO(port): narrow error set
    {
        // `opt.allocator` dropped — global mimalloc.
        let mut multis: Vec<Vec<&'static [u8]>> = (0..table.n_multi).map(|_| Vec::new()).collect();

        let mut pos: Vec<&'static [u8]> = Vec::new();
        let mut passthrough_positionals: Vec<&'static [u8]> = Vec::new();

        let mut single_options: Box<[Option<&'static [u8]>]> =
            vec![None; table.n_single].into_boxed_slice();
        let mut flags: Box<[bool]> = vec![false; table.n_flags].into_boxed_slice();

        // Zig: `StreamingClap(usize, @typeInfo(@TypeOf(iter)).pointer.child)` — the second
        // type arg is the pointee of `iter`; in Rust that is just `I`.
        let mut stream = StreamingClap::<usize, I> {
            params: table.converted,
            iter,
            diagnostic: opt.diagnostic,
            state: streaming::State::Normal,
            positional: None,
        };

        while let Some(arg) = stream.next()? {
            let param = arg.param;
            if param.names.long.is_none() && param.names.short.is_none() {
                pos.push(arg.value.unwrap());
                if opt.stop_after_positional_at > 0 && pos.len() >= opt.stop_after_positional_at {
                    let mut remaining_ = stream.iter.remain();
                    // PORT NOTE: Zig called `bun.span` (NUL-scan) on `[:0]const u8` argv
                    // entries. Our `ArgIter` already yields sized `&[u8]`, so `span` is a
                    // no-op and is dropped.
                    let first: &[u8] = if !remaining_.is_empty() {
                        remaining_[0]
                    } else {
                        b""
                    };
                    if !first.is_empty() && first == b"--" {
                        remaining_ = &remaining_[1..];
                    }

                    passthrough_positionals.reserve_exact(remaining_.len());
                    for arg_ in remaining_ {
                        passthrough_positionals.push(*arg_);
                    }
                    break;
                }
            } else if param.takes_value == Values::One || param.takes_value == Values::OneOptional {
                debug_assert!(single_options.len() != 0);
                if single_options.len() != 0 {
                    single_options[param.id] = Some(arg.value.unwrap_or(b""));
                }
            } else if param.takes_value == Values::Many {
                debug_assert!(multis.len() != 0);
                if multis.len() != 0 {
                    multis[param.id].push(arg.value.unwrap());
                }
            } else {
                debug_assert!(flags.len() != 0);
                if flags.len() != 0 {
                    flags[param.id] = true;
                }
            }
        }

        Ok(Self {
            single_options,
            // PORT NOTE: Zig left these `undefined` and filled them post-loop.
            multi_options: multis.into_iter().map(Vec::into_boxed_slice).collect(),
            flags,
            pos: pos.into_boxed_slice(),
            passthrough_positionals: passthrough_positionals.into_boxed_slice(),
            table,
            _id: PhantomData,
        })
    }

    // Zig `deinit` only freed `multi_options[*]` and `pos` (not `passthrough_positionals` —
    // likely a leak in the deprecated Zig). All are owned here, so `Drop` handles it;
    // body deleted per PORTING.md §Idiom map (`pub fn deinit` → `impl Drop`, empty body
    // when it only frees owned fields).

    #[inline]
    pub fn flag(&self, name: &[u8]) -> bool {
        let param = self.table.find(name);
        debug_assert!(
            param.takes_value == Values::None || param.takes_value == Values::OneOptional,
            "{} is an option and not a flag.",
            bstr::BStr::new(name),
        );
        self.flags[param.id]
    }

    #[inline]
    pub fn option(&self, name: &[u8]) -> Option<&'static [u8]> {
        let param = self.table.find(name);
        debug_assert!(
            param.takes_value != Values::None,
            "{} is a flag and not an option.",
            bstr::BStr::new(name),
        );
        debug_assert!(
            param.takes_value != Values::Many,
            "{} takes many options, not one.",
            bstr::BStr::new(name),
        );
        self.single_options[param.id]
    }

    #[inline]
    pub fn options(&self, name: &[u8]) -> &[&'static [u8]] {
        let param = self.table.find(name);
        debug_assert!(
            param.takes_value != Values::None,
            "{} is a flag and not an option.",
            bstr::BStr::new(name),
        );
        debug_assert!(
            !(param.takes_value == Values::One || param.takes_value == Values::OneOptional),
            "{} takes one option, not multiple.",
            bstr::BStr::new(name),
        );
        &self.multi_options[param.id]
    }

    /// Direct slot accessors — pair with [`find_param_index`] inside
    /// `const { }` for true Zig-parity zero-cost lookup at the call site.
    #[inline]
    pub fn flag_at(&self, converted_idx: usize) -> bool {
        self.flags[self.table.converted[converted_idx].id]
    }
    #[inline]
    pub fn option_at(&self, converted_idx: usize) -> Option<&'static [u8]> {
        self.single_options[self.table.converted[converted_idx].id]
    }
    #[inline]
    pub fn options_at(&self, converted_idx: usize) -> &[&'static [u8]] {
        &self.multi_options[self.table.converted[converted_idx].id]
    }

    pub fn positionals(&self) -> &[&'static [u8]] {
        &self.pos
    }

    pub fn remaining(&self) -> &[&'static [u8]] {
        &self.passthrough_positionals
    }

    /// Zig `hasFlag` is a comptime-only predicate over the captured table.
    /// `const fn` here so `const { has_flag(PARAMS, b"--foo") }` folds.
    pub const fn has_flag(params: &[Param<Id>], name: &[u8]) -> bool {
        let mut i = 0;
        while i < params.len() {
            let n = &params[i].names;
            if name.len() == 2 && name[0] == b'-' {
                if let Some(s) = n.short {
                    if s == name[1] {
                        return true;
                    }
                }
            } else if name.len() > 2 && name[0] == b'-' && name[1] == b'-' {
                let (_, key) = name.split_at(2);
                if let Some(l) = n.long {
                    if bytes_eq(l, key) {
                        return true;
                    }
                }
                let mut a = 0;
                while a < n.long_aliases.len() {
                    if bytes_eq(n.long_aliases[a], key) {
                        return true;
                    }
                    a += 1;
                }
            }
            i += 1;
        }
        false
    }

    /// Exposed for `Args::find_param` callers; resolves via the hashed index.
    #[inline]
    pub fn find_param(&self, name: &[u8]) -> &'static Param<usize> {
        self.table.find(name)
    }
}

// ported from: src/clap/comptime.zig

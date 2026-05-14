pub const CHAR_FREQ_COUNT: usize = 64;

#[derive(Copy, Clone, Default)]
pub struct CharAndCount {
    pub char: u8,
    pub count: i32,
    pub index: usize,
}

// PORT NOTE: Zig `CharAndCount.Array` was an associated type alias; inherent
// associated types are unstable in Rust, so it's a free alias here.
pub type CharAndCountArray = [CharAndCount; CHAR_FREQ_COUNT];

impl CharAndCount {
    pub fn less_than(a: &CharAndCount, b: &CharAndCount) -> bool {
        if a.count != b.count {
            return a.count > b.count;
        }

        if a.index != b.index {
            return a.index < b.index;
        }

        a.char < b.char
    }
}

// PERF(port): Zig used `@Vector(CHAR_FREQ_COUNT, i32)` for SIMD adds — profile
type Buffer = [i32; CHAR_FREQ_COUNT];

#[derive(Copy, Clone)]
pub struct CharFreq {
    // PORT NOTE: Zig field was `align(1)` (unaligned i32 array). Rust gives natural
    // alignment; if the packed layout was load-bearing for an FFI/serialized struct,
    // revisit.
    pub freqs: Buffer,
}

impl Default for CharFreq {
    #[inline]
    fn default() -> Self {
        Self {
            freqs: [0i32; CHAR_FREQ_COUNT],
        }
    }
}

const SCAN_BIG_CHUNK_SIZE: usize = 32;

impl CharFreq {
    pub fn scan(&mut self, text: &[u8], delta: i32) {
        if delta == 0 {
            return;
        }

        if text.len() < SCAN_BIG_CHUNK_SIZE {
            scan_small(&mut self.freqs, text, delta);
        } else {
            scan_big(&mut self.freqs, text, delta);
        }
    }

    pub fn include(&mut self, other: &CharFreq) {
        // https://zig.godbolt.org/z/Mq8eK6K9s
        // PERF(port): Zig used @Vector SIMD add — profile
        for (l, r) in self.freqs.iter_mut().zip(other.freqs.iter()) {
            *l += *r;
        }
    }

    pub fn compile(&self) -> crate::NameMinifier {
        use crate::NameMinifier;
        let array: CharAndCountArray = 'brk: {
            let mut arr: [CharAndCount; CHAR_FREQ_COUNT] =
                [CharAndCount::default(); CHAR_FREQ_COUNT];

            debug_assert_eq!(NameMinifier::DEFAULT_TAIL.len(), CHAR_FREQ_COUNT);
            for (i, ((dest, &char), &freq)) in arr
                .iter_mut()
                .zip(NameMinifier::DEFAULT_TAIL.iter())
                .zip(self.freqs.iter())
                .enumerate()
            {
                *dest = CharAndCount {
                    char,
                    index: i,
                    count: freq,
                };
            }

            // std.sort.pdq → Rust's sort_unstable_by (pattern-defeating quicksort).
            // PORT NOTE: do NOT route through `CharAndCount::less_than` and map
            // false→Greater — that comparator never returns `Equal`, which
            // violates `sort_unstable_by`'s total-order contract (Rust 1.81+
            // is permitted to panic on inconsistent comparators). `index` is
            // unique so equality is unreachable in practice, but keep the
            // comparator well-formed regardless.
            arr.sort_unstable_by(|a, b| {
                // descending by count, then ascending by (index, char) —
                // matches CharFreq.zig:12 `CharAndCount.lessThan`.
                b.count
                    .cmp(&a.count)
                    .then_with(|| a.index.cmp(&b.index))
                    .then_with(|| a.char.cmp(&b.char))
            });

            break 'brk arr;
        };

        let mut minifier = NameMinifier::init();
        minifier.head.reserve_exact(
            NameMinifier::DEFAULT_HEAD
                .len()
                .saturating_sub(minifier.head.len()),
        );
        minifier.tail.reserve_exact(
            NameMinifier::DEFAULT_TAIL
                .len()
                .saturating_sub(minifier.tail.len()),
        );
        // TODO: investigate counting number of < 0 and > 0 and pre-allocating
        for item in array {
            if item.char < b'0' || item.char > b'9' {
                minifier.head.push(item.char);
                // PERF(port): was `catch unreachable` (assume_capacity)
            }
            minifier.tail.push(item.char);
            // PERF(port): was `catch unreachable` (assume_capacity)
        }

        minifier
    }
}

fn scan_big(out: &mut Buffer, text: &[u8], delta: i32) {
    // https://zig.godbolt.org/z/P5dPojWGK
    // PORT NOTE: Zig copied `out.*` into a stack local and wrote back via `defer` to
    // avoid unaligned (`align(1)`) loads in the hot loop. We operate on `out` directly;
    // the field is naturally aligned in Rust.
    let mut deltas: [i32; 256] = [0; 256];

    debug_assert!(text.len() >= SCAN_BIG_CHUNK_SIZE);

    let unrolled = text.len() - (text.len() % SCAN_BIG_CHUNK_SIZE);
    let (chunks, remain) = text.split_at(unrolled);

    for chunk in chunks.chunks_exact(SCAN_BIG_CHUNK_SIZE) {
        // PERF(port): Zig used `inline for` to unroll 32 iterations — profile
        for i in 0..SCAN_BIG_CHUNK_SIZE {
            deltas[chunk[i] as usize] += delta;
        }
    }

    for &c in remain {
        deltas[c as usize] += delta;
    }

    // PORT NOTE — INTENTIONAL SPEC DIVERGENCE: CharFreq.zig:64 writes
    // `freqs[0..26].* = deltas[...]`, which *overwrites* the accumulator
    // (`var freqs = out.*` is dead). That is an upstream bug: every ≥32-byte
    // scan discards all prior counts, so the result is last-big-scan-wins
    // rather than the histogram the NameMinifier expects. Zig's output is
    // stable only because its StringHashMap iteration order is deterministic,
    // so the *same* symbol name overwrites last on every run. The Rust
    // `scope.members` map is RandomState-seeded, so a faithful overwrite port
    // is nondeterministic (the observed `OV`/`OU` flap on three.js), and even
    // a deterministic-iteration port wouldn't reproduce Zig's specific hash
    // order. We accumulate (`+=`) instead — the algorithm's intent — which
    // makes the freq table both correct and run-to-run stable. Minified
    // output therefore differs from Zig by design here (three.js: 2 bytes
    // smaller); byte-identical-vs-Zig is not a goal for this function.
    for i in 0..26 {
        out[i] += deltas[b'a' as usize + i];
    }
    for i in 0..26 {
        out[26 + i] += deltas[b'A' as usize + i];
    }
    for i in 0..10 {
        out[52 + i] += deltas[b'0' as usize + i];
    }
    out[62] += deltas[b'_' as usize];
    out[63] += deltas[b'$' as usize];
}

fn scan_small(out: &mut Buffer, text: &[u8], delta: i32) {
    let mut freqs: [i32; CHAR_FREQ_COUNT] = *out;

    for &c in text {
        let i: usize = match c {
            b'a'..=b'z' => c as usize - b'a' as usize,
            b'A'..=b'Z' => c as usize - (b'A' as usize - 26),
            b'0'..=b'9' => c as usize + (53 - b'0' as usize),
            b'_' => 62,
            b'$' => 63,
            _ => continue,
        };
        freqs[i] += delta;
    }

    *out = freqs;
}

// ported from: src/js_parser/ast/CharFreq.zig

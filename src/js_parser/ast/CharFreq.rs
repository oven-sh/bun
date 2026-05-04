use crate::ast::NameMinifier;
use crate::ast::g;

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

// PERF(port): Zig used `@Vector(CHAR_FREQ_COUNT, i32)` for SIMD adds — profile in Phase B
type Buffer = [i32; CHAR_FREQ_COUNT];

#[derive(Copy, Clone)]
pub struct CharFreq {
    // PORT NOTE: Zig field was `align(1)` (unaligned i32 array). Rust gives natural
    // alignment; if the packed layout was load-bearing for an FFI/serialized struct,
    // revisit in Phase B.
    pub freqs: Buffer,
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
        // PERF(port): Zig used @Vector SIMD add — profile in Phase B
        for (l, r) in self.freqs.iter_mut().zip(other.freqs.iter()) {
            *l += *r;
        }
    }

    pub fn compile(&self) -> NameMinifier {
        let array: CharAndCountArray = 'brk: {
            let mut arr: [CharAndCount; CHAR_FREQ_COUNT] = [CharAndCount::default(); CHAR_FREQ_COUNT];

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

            // std.sort.pdq → Rust's sort_unstable_by (pattern-defeating quicksort)
            arr.sort_unstable_by(|a, b| {
                if CharAndCount::less_than(a, b) {
                    core::cmp::Ordering::Less
                } else {
                    core::cmp::Ordering::Greater
                }
            });

            break 'brk arr;
        };

        let mut minifier = NameMinifier::init();
        minifier
            .head
            .reserve_exact(NameMinifier::DEFAULT_HEAD.len().saturating_sub(minifier.head.len()));
        minifier
            .tail
            .reserve_exact(NameMinifier::DEFAULT_TAIL.len().saturating_sub(minifier.tail.len()));
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
        // PERF(port): Zig used `inline for` to unroll 32 iterations — profile in Phase B
        for i in 0..SCAN_BIG_CHUNK_SIZE {
            deltas[chunk[i] as usize] += delta;
        }
    }

    for &c in remain {
        deltas[c as usize] += delta;
    }

    out[0..26].copy_from_slice(&deltas[b'a' as usize..b'a' as usize + 26]);
    out[26..26 * 2].copy_from_slice(&deltas[b'A' as usize..b'A' as usize + 26]);
    out[26 * 2..62].copy_from_slice(&deltas[b'0' as usize..b'0' as usize + 10]);
    out[62] = deltas[b'_' as usize];
    out[63] = deltas[b'$' as usize];
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

pub use g::Class;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/CharFreq.zig (137 lines)
//   confidence: medium
//   todos:      0
//   notes:      dropped allocator param from compile(); NameMinifier field/const names assumed (DEFAULT_HEAD/DEFAULT_TAIL, head/tail as Vec<u8>); align(1) on freqs not preserved
// ──────────────────────────────────────────────────────────────────────────

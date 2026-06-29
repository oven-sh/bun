pub(crate) const CHAR_FREQ_COUNT: usize = 64;

#[derive(Copy, Clone, Default)]
pub(crate) struct CharAndCount {
    pub char: u8,
    pub count: i32,
    pub index: usize,
}

pub(crate) type CharAndCountArray = [CharAndCount; CHAR_FREQ_COUNT];

// PERF: candidate for SIMD adds — profile
type Buffer = [i32; CHAR_FREQ_COUNT];

#[derive(Copy, Clone)]
pub struct CharFreq {
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
        // PERF: candidate for SIMD add — profile
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

            // Do NOT route through `CharAndCount::less_than` and map
            // false→Greater — that comparator never returns `Equal`, which
            // violates `sort_unstable_by`'s total-order contract (Rust 1.81+
            // is permitted to panic on inconsistent comparators). `index` is
            // unique so equality is unreachable in practice, but keep the
            // comparator well-formed regardless.
            arr.sort_unstable_by(|a, b| {
                // descending by count, then ascending by (index, char).
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
            }
            minifier.tail.push(item.char);
        }

        minifier
    }
}

fn scan_big(out: &mut Buffer, text: &[u8], delta: i32) {
    // The field is naturally aligned, so operate on `out` directly.
    let mut deltas: [i32; 256] = [0; 256];

    debug_assert!(text.len() >= SCAN_BIG_CHUNK_SIZE);

    let unrolled = text.len() - (text.len() % SCAN_BIG_CHUNK_SIZE);
    let (chunks, remain) = text.split_at(unrolled);

    for chunk in chunks.chunks_exact(SCAN_BIG_CHUNK_SIZE) {
        // PERF: candidate for unrolling — profile
        for i in 0..SCAN_BIG_CHUNK_SIZE {
            deltas[chunk[i] as usize] += delta;
        }
    }

    for &c in remain {
        deltas[c as usize] += delta;
    }

    // Accumulate (`+=`) — overwriting the accumulator instead would make
    // every ≥32-byte scan discard all prior counts (last-big-scan-wins), and
    // since `scope.members` is a RandomState-seeded map the result would be
    // nondeterministic (an observed `OV`/`OU` flap on three.js). Accumulating
    // keeps the freq table both correct and run-to-run stable.
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
    // The field is naturally aligned, so operate on `out` directly
    // (same treatment as `scan_big`).
    for &c in text {
        // Indices follow `NameMinifier::DEFAULT_TAIL` order
        // (`a-zA-Z0-9_$` → 0..63), matching `scan_big` which writes digits
        // at `out[52 + i]`. Starting digits at 53 instead would shift `'0'`
        // to 53 and make `'9'` collide with `'_'` at 62, leaving slot 52 cold
        // for `<32`-byte inputs and slightly skewing minified-name ranking
        // when digits/underscores appear.
        let i: usize = match c {
            b'a'..=b'z' => c as usize - b'a' as usize,
            b'A'..=b'Z' => c as usize - (b'A' as usize - 26),
            b'0'..=b'9' => c as usize + (52 - b'0' as usize),
            b'_' => 62,
            b'$' => 63,
            _ => continue,
        };
        out[i] += delta;
    }
}

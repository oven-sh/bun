//! The script of [`tokens`](crate::tokens) for sequences that are short, or so far apart that a search is slow.
//!
//! A row of the table of longest common subsequences goes up by 0 or 1 from one token of `b` to the next, so it is one
//! bit per token. A token of `a` that is frequent in `b` makes the next row 64 bits at a time (Hyyrö, "Bit-parallel
//! LCS-length computation revisited", 2004). A rare one only moves a 1 for each match (Hunt and Szymanski, 1977).

use core::ops::Range;

use crate::Hunk;

const NOT_FREQUENT: u16 = u16::MAX;
/// What a match of a rare token costs, in words of a row: it is somewhere else in memory each time.
const MATCH_COST: usize = 4;
const MIN_LOG: usize = 1 << 16;

/// Where each token is in `b`.
pub(crate) struct Matches {
    words: usize,
    /// `places[starts[token]..starts[token + 1]]`, in order.
    starts: Vec<u32>,
    places: Vec<u32>,
    /// By token: which row of `masks` has a 1 where it is. At most 64 × `MATCH_COST` tokens are frequent.
    frequent: Vec<u16>,
    /// Empty until [`Self::mark`].
    masks: Vec<u64>,
}

struct Row {
    bits: Vec<u64>,
    /// Matches in the words before this one are not looked at.
    from: usize,
    /// Each has a 1 for each word of the one before it, or of `bits`, that may not be 0. The last is at most one word.
    summaries: Vec<Vec<u64>>,
}

impl Row {
    fn new(bits: Vec<u64>, from: usize) -> Self {
        let lengths = core::iter::successors(Some(bits.len()), |&words| {
            (words > 1).then(|| words.div_ceil(64))
        });
        let summaries = lengths.skip(1).map(|words| vec![u64::MAX; words]).collect();
        Self {
            bits,
            from,
            summaries,
        }
    }

    fn goes_up(&self, at: usize) -> bool {
        self.bits[at / 64] >> (at % 64) & 1 == 1
    }

    fn flip(&mut self, at: usize) {
        self.bits[at / 64] ^= 1 << (at % 64);
    }

    fn set(&mut self, mut at: usize) {
        for level in core::iter::once(&mut self.bits).chain(&mut self.summaries) {
            let before = level[at / 64];
            level[at / 64] |= 1 << (at % 64);
            // The levels above already say so.
            if before != 0 {
                break;
            }
            at /= 64;
        }
    }

    /// `mask` has a 1 for each match.
    fn advance(&mut self, mask: &[u64]) {
        let mut carry = false;
        let mut next = |bits, mask| next_word(bits, mask, &mut carry);
        // Within a pair, the carry stays in the flag of the processor.
        let (mask_pairs, last_mask) = mask[self.from..self.bits.len()].as_chunks::<2>();
        let (pairs, last) = self.bits[self.from..].as_chunks_mut::<2>();
        for (bits, mask) in pairs.iter_mut().zip(mask_pairs) {
            *bits = [next(bits[0], mask[0]), next(bits[1], mask[1])];
        }
        if let ([bits], [mask]) = (last, last_mask) {
            *bits = next(*bits, *mask);
        }
        self.summaries.iter_mut().for_each(|it| it.fill(u64::MAX));
    }
}

#[inline]
fn next_word(bits: u64, mask: u64, carry: &mut bool) -> u64 {
    let sum;
    (sum, *carry) = (!bits).carrying_add(!bits & mask, *carry);
    !sum & (bits | mask)
}

/// Keeps all rows. `b` has at most 64 × `WORDS` tokens, so `% WORDS` only spares the bounds checks.
pub(crate) fn diff_short<const WORDS: usize>(a: &[u32], b: &[u32], distinct: usize) -> Vec<Hunk> {
    debug_assert!(b.len() <= 64 * WORDS);
    let mut table = vec![[0u64; WORDS]; distinct + 1 + a.len()];
    let (masks, rows) = table.split_at_mut(distinct);
    for (at, &token) in b.iter().enumerate() {
        masks[token as usize][at / 64 % WORDS] |= 1 << (at % 64);
    }
    let mut row = rows[0];
    for (next, &token) in rows[1..].iter_mut().zip(a) {
        let (mask, mut carry) = (masks[token as usize], false);
        row = core::array::from_fn(|word| next_word(row[word], mask[word], &mut carry));
        *next = row;
    }

    let goes_up = |x: usize, at: usize| rows[x][at / 64 % WORDS] >> (at % 64) & 1 == 1;
    let mut hunks = Vec::with_capacity(16);
    let (mut x, mut y) = (a.len(), b.len());
    loop {
        let (a_hi, b_hi) = (x, y);
        while y > 0 && !goes_up(x, y - 1) {
            y -= 1;
        }
        while x > 0 && (y == 0 || goes_up(x - 1, y - 1)) {
            x -= 1;
        }
        if (x, y) != (a_hi, b_hi) {
            let (a_lo, b_lo) = (x, y);
            hunks.push(Hunk {
                a_lo,
                a_hi,
                b_lo,
                b_hi,
            });
        }
        if y == 0 {
            hunks.reverse();
            return hunks;
        }
        (x, y) = (x - 1, y - 1);
    }
}

/// The first 1 of `bits` from `from` on.
fn next_one(bits: &[u64], summaries: &mut [Vec<u64>], from: usize) -> Option<usize> {
    let mut word = from / 64;
    let mut ones = bits.get(word)? & (u64::MAX << (from % 64));
    while ones == 0 {
        let (summary, above) = summaries.split_first_mut()?;
        word = next_one(summary, above, word + 1)?;
        ones = *bits.get(word)?;
        if ones == 0 {
            // After a frequent token the summaries are all 1s, and many consecutive words can be 0.
            let (unknown, shift) = (&mut summary[word / 64], word % 64);
            let run = bits[word..]
                .iter()
                .take((*unknown >> shift).trailing_ones() as usize);
            let zeros = run.take_while(|&&it| it == 0).count();
            *unknown &= !(u64::MAX >> (64 - zeros) << shift);
            word += zeros - 1;
        }
    }
    Some(word * 64 + ones.trailing_zeros() as usize)
}

impl Matches {
    pub(crate) fn new(b: &[u32], distinct: usize) -> Self {
        let words = b.len().div_ceil(64);
        let mut starts = vec![0u32; distinct + 1];
        for &token in b {
            starts[token as usize] += 1;
        }
        let (mut frequent, mut rows, mut end) = (vec![NOT_FREQUENT; distinct], 0, 0);
        for (count, row) in starts.iter_mut().zip(&mut frequent) {
            if *count as usize * MATCH_COST > words {
                *row = rows;
                rows += 1;
            }
            end += *count;
            *count = end;
        }
        starts[distinct] = end;
        let mut places = vec![0u32; b.len()];
        for (at, &token) in b.iter().enumerate().rev() {
            let start = &mut starts[token as usize];
            *start -= 1;
            places[*start as usize] = at as u32;
        }
        Self {
            words,
            starts,
            places,
            frequent,
            masks: Vec::new(),
        }
    }

    fn places(&self, token: u32) -> &[u32] {
        let token = token as usize;
        &self.places[self.starts[token] as usize..self.starts[token + 1] as usize]
    }

    /// At least the words that [`Self::advance`] logs.
    fn row_cost(&self, token: u32) -> usize {
        if self.frequent[token as usize] == NOT_FREQUENT {
            self.places(token).len() * MATCH_COST
        } else {
            self.words
        }
    }

    /// In words of a row.
    pub(crate) fn cost(&self, a: &[u32]) -> usize {
        a.iter().map(|&token| self.row_cost(token)).sum()
    }

    /// The row after `token`. With `LOG`, what [`Self::go_back`] needs is pushed to `log`.
    fn advance<const LOG: bool>(&self, row: &mut Row, token: u32, log: &mut Vec<u64>) {
        let frequent = self.frequent[token as usize];
        if frequent != NOT_FREQUENT {
            if LOG {
                log.extend_from_slice(&row.bits[row.from..]);
            }
            row.advance(&self.masks[usize::from(frequent) * self.words..]);
            return;
        }
        // The first match in a run of 0s takes the 1 that ends the run.
        let mut from = row.from * 64;
        for &at in self.places(token) {
            let at = at as usize;
            if at >= row.bits.len() * 64 {
                break;
            }
            if at < from || row.goes_up(at) {
                continue;
            }
            let one = next_one(&row.bits, &mut row.summaries, at);
            row.set(at);
            if LOG {
                log.push(at as u64);
                log.extend(one.map(|one| one as u64));
            }
            let Some(one) = one else { break };
            row.flip(one);
            from = one + 1;
        }
    }

    fn go_back(&self, row: &mut Row, token: u32, logged: &[u64]) {
        if self.frequent[token as usize] == NOT_FREQUENT {
            logged.iter().for_each(|&at| row.flip(at as usize));
        } else {
            row.bits[row.from..].copy_from_slice(logged);
        }
    }

    /// `cost` is [`Self::cost`].
    pub(crate) fn mark(
        mut self,
        a: &[u32],
        cost: usize,
        changed_a: &mut [bool],
        changed_b: &mut [bool],
    ) {
        let mut masks = Vec::new();
        for (token, &row) in self.frequent.iter().enumerate() {
            if row != NOT_FREQUENT {
                let start = masks.len();
                masks.resize(start + self.words, 0u64);
                for &at in self.places(token as u32) {
                    masks[start + at as usize / 64] |= 1 << (at % 64);
                }
            }
        }
        self.masks = masks;

        // The script is read from the last row to the first. They don't all fit in memory, so one is kept for each
        // part of `a`, and those of a part are made again when it is reached.
        let max_log = cost.saturating_mul(self.words).isqrt().max(MIN_LOG);
        let mut parts: Vec<Range<usize>> = Vec::new();
        let (mut start, mut logged) = (0, 0);
        for (x, &token) in a.iter().enumerate() {
            logged += self.row_cost(token);
            if logged >= max_log || x + 1 == a.len() {
                parts.push(start..x + 1);
                (start, logged) = (x + 1, 0);
            }
        }

        let mut log = Vec::new();
        let mut row = Row::new(vec![0; self.words], 0);
        let mut first_rows = vec![row.bits.clone()];
        for part in parts.iter().take(parts.len().saturating_sub(1)) {
            for &token in &a[part.clone()] {
                self.advance::<false>(&mut row, token, &mut log);
            }
            first_rows.push(row.bits.clone());
        }

        let mut y = changed_b.len();
        let mut log_starts = Vec::new();
        for (part, mut bits) in parts.into_iter().zip(first_rows).rev() {
            // No bit depends on a later one.
            bits.truncate(y.div_ceil(64));
            // A script has at most one match for each token of the part, so a shortest one enters the part at most that
            // many 1s before `y`. Ignoring earlier matches changes no value along the script and raises none.
            let (mut from, mut ones) = (y / 64, 0);
            while from > 0 && ones <= part.len() {
                from -= 1;
                ones += bits[from].count_ones() as usize;
            }
            let mut row = Row::new(bits, from);
            log_starts.clear();
            for &token in &a[part.clone()] {
                log_starts.push(log.len());
                self.advance::<true>(&mut row, token, &mut log);
            }
            for (x, &log_start) in part.zip(&log_starts).rev() {
                while y > 0 && !row.goes_up(y - 1) {
                    y -= 1;
                    changed_b[y] = true;
                }
                if y == 0 {
                    changed_a[..=x].fill(true);
                    return;
                }
                self.go_back(&mut row, a[x], &log[log_start..]);
                log.truncate(log_start);
                if row.goes_up(y - 1) {
                    changed_a[x] = true;
                } else {
                    y -= 1;
                }
            }
        }
        changed_b[..y].fill(true);
    }
}

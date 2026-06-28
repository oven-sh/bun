//! Fixed-capacity top-K selection.
//!
//! A binary min-heap on "goodness" (score descending, then a caller-supplied
//! tiebreak ascending). The root is the *worst* retained item, so selecting
//! the best K of N candidates is O(N log K) with no sort and no allocation
//! beyond the K slots.

/// Number of slots preallocated up front. `k` is caller-controlled, so the
/// heap grows lazily past this instead of allocating a huge buffer for a `k`
/// that will never fill.
const PREALLOC_CAP: usize = 1024;

struct Entry<T> {
    score: i32,
    tiebreak: u32,
    value: T,
}

/// `a` ranks strictly worse than `b`: lower score, or equal score and a
/// larger tiebreak.
#[inline]
fn worse(a_score: i32, a_tiebreak: u32, b_score: i32, b_tiebreak: u32) -> bool {
    a_score < b_score || (a_score == b_score && a_tiebreak > b_tiebreak)
}

/// Fixed-capacity top-K min-heap keyed by (score desc, then tiebreak asc).
pub struct TopK<T> {
    k: usize,
    heap: Vec<Entry<T>>,
}

impl<T> TopK<T> {
    pub fn new(k: usize) -> TopK<T> {
        TopK {
            k,
            heap: Vec::with_capacity(k.min(PREALLOC_CAP)),
        }
    }

    /// Offer one candidate. Once full, a candidate is admitted only if it is
    /// strictly better (score desc, then tiebreak asc) than the current
    /// worst; a candidate equal to the current worst is rejected.
    pub fn push(&mut self, score: i32, tiebreak: u32, value: T) {
        if self.k == 0 {
            return;
        }
        if self.heap.len() < self.k {
            self.heap.push(Entry {
                score,
                tiebreak,
                value,
            });
            self.sift_up(self.heap.len() - 1);
            return;
        }
        let root = &self.heap[0];
        if worse(root.score, root.tiebreak, score, tiebreak) {
            self.heap[0] = Entry {
                score,
                tiebreak,
                value,
            };
            self.sift_down(0);
        }
    }

    /// Drains, best first (score desc, then tiebreak asc).
    pub fn into_sorted_vec(self) -> Vec<(i32, T)> {
        let mut entries = self.heap;
        entries.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.tiebreak.cmp(&b.tiebreak))
        });
        entries.into_iter().map(|e| (e.score, e.value)).collect()
    }

    pub fn len(&self) -> usize {
        self.heap.len()
    }

    /// Worst retained score, for early-exit pruning. `None` until full. A
    /// candidate scoring strictly above the threshold is always admitted.
    pub fn threshold(&self) -> Option<i32> {
        if self.k != 0 && self.heap.len() == self.k {
            Some(self.heap[0].score)
        } else {
            None
        }
    }

    fn sift_up(&mut self, mut idx: usize) {
        while idx > 0 {
            let parent = (idx - 1) / 2;
            let (c, p) = (&self.heap[idx], &self.heap[parent]);
            if worse(c.score, c.tiebreak, p.score, p.tiebreak) {
                self.heap.swap(idx, parent);
                idx = parent;
            } else {
                break;
            }
        }
    }

    fn sift_down(&mut self, mut idx: usize) {
        let len = self.heap.len();
        loop {
            let mut worst = idx;
            for child in [2 * idx + 1, 2 * idx + 2] {
                if child < len {
                    let (c, w) = (&self.heap[child], &self.heap[worst]);
                    if worse(c.score, c.tiebreak, w.score, w.tiebreak) {
                        worst = child;
                    }
                }
            }
            if worst == idx {
                break;
            }
            self.heap.swap(idx, worst);
            idx = worst;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain(topk: TopK<&'static str>) -> Vec<(i32, &'static str)> {
        topk.into_sorted_vec()
    }

    #[test]
    fn keeps_best_k_by_score() {
        let mut t = TopK::new(3);
        for (i, &(s, v)) in [
            (10, "a"),
            (50, "b"),
            (30, "c"),
            (20, "d"),
            (40, "e"),
            (60, "f"),
        ]
        .iter()
        .enumerate()
        {
            t.push(s, i as u32, v);
        }
        assert_eq!(t.len(), 3);
        assert_eq!(drain(t), vec![(60, "f"), (50, "b"), (40, "e")]);
    }

    #[test]
    fn ties_broken_by_tiebreak_ascending() {
        let mut t = TopK::new(2);
        t.push(5, 9, "high_tb");
        t.push(5, 1, "low_tb");
        t.push(5, 4, "mid_tb");
        // All scores equal: the two smallest tiebreaks survive, best first.
        assert_eq!(drain(t), vec![(5, "low_tb"), (5, "mid_tb")]);
    }

    #[test]
    fn equal_key_keeps_first_inserted() {
        let mut t = TopK::new(1);
        t.push(5, 7, "first");
        t.push(5, 7, "second");
        assert_eq!(drain(t), vec![(5, "first")]);
    }

    #[test]
    fn threshold_none_until_full_then_worst_score() {
        let mut t = TopK::new(2);
        assert_eq!(t.threshold(), None);
        t.push(10, 0, "a");
        assert_eq!(t.threshold(), None);
        t.push(3, 1, "b");
        assert_eq!(t.threshold(), Some(3));
        t.push(7, 2, "c");
        assert_eq!(t.threshold(), Some(7));
        // A candidate at the threshold with a worse tiebreak is rejected.
        t.push(7, 3, "d");
        assert_eq!(drain(t), vec![(10, "a"), (7, "c")]);
    }

    #[test]
    fn k_zero_holds_nothing() {
        let mut t = TopK::new(0);
        t.push(100, 0, "a");
        assert_eq!(t.len(), 0);
        assert_eq!(t.threshold(), None);
        assert!(drain(t).is_empty());
    }

    #[test]
    fn k_larger_than_input_returns_everything_sorted() {
        let mut t = TopK::new(100);
        t.push(1, 0, "low");
        t.push(3, 0, "high");
        t.push(2, 0, "mid");
        assert_eq!(t.len(), 3);
        assert_eq!(t.threshold(), None);
        assert_eq!(drain(t), vec![(3, "high"), (2, "mid"), (1, "low")]);
    }

    #[test]
    fn negative_scores() {
        let mut t = TopK::new(2);
        t.push(-5, 0, "a");
        t.push(-1, 1, "b");
        t.push(-3, 2, "c");
        assert_eq!(drain(t), vec![(-1, "b"), (-3, "c")]);
    }

    #[test]
    fn many_random_like_inserts_match_full_sort() {
        // Deterministic pseudo-random scores with a unique tiebreak per item
        // (the candidate index, as a real caller would pass); the heap result
        // must equal the ground truth from a full sort.
        let mut state = 0x1234_5678u64;
        let mut next = move || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            state
        };
        let items: Vec<(i32, u32)> = (0..2000u32)
            .map(|i| (((next() >> 16) % 100) as i32, i))
            .collect();
        for k in [1usize, 7, 100, 2000, 5000] {
            let mut t = TopK::new(k);
            for &(s, tb) in &items {
                t.push(s, tb, tb);
            }
            assert_eq!(t.len(), k.min(items.len()));
            let got = t.into_sorted_vec();
            let mut expected = items.clone();
            expected.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
            expected.truncate(k);
            assert_eq!(got, expected, "k={k}");
        }
    }
}

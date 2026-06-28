//! The fuzzy scorer: a fitting Smith-Waterman alignment with affine gaps and
//! fzf-v2-style position-dependent bonuses.
//!
//! Reference algorithm: junegunn/fzf `src/algo/algo.go` (`FuzzyMatchV2`). This
//! is an original implementation of that published algorithm; the scoring
//! constants (see `score.rs`) and the character-class bonus model (`chars.rs`)
//! are taken from it.
//!
//! # DP formulation
//!
//! For needle length `m` and haystack length `n`, with 1-based `i in 1..=m`
//! (needle) and `j in 1..=n` (haystack):
//!
//! - `D[i][j]`: best score of an alignment of `needle[..i]` whose last needle
//!   byte is matched exactly at `haystack[j-1]`. `INVALID` if impossible.
//! - `E[i][j]`: best score of an alignment of `needle[..i]` that ends with at
//!   least one *skipped* haystack byte at `j-1` (an open gap), affine-penalized.
//! - `H[i][j] = max(D[i][j], E[i][j])`: best score of `needle[..i]` within
//!   `haystack[..j]`.
//!
//! Leading and trailing skipped haystack bytes are free (`H[0][*] = 0`, and the
//! final score is `max_j D[m][j]`), which makes this a "fitting" alignment: the
//! needle must be fully consumed, the haystack is matched as a subsequence.
//!
//! The hot path iterates column-by-column and keeps only two columns of length
//! `m + 1`, so `score()` uses `O(needle)` memory and performs **zero heap
//! allocation after `set_needle()`**. `score_with_positions()` additionally
//! stores the full matrices for an exact backtrack, but only within the
//! documented bounds (`MAX_BACKTRACK_HAYSTACK`, `MAX_BACKTRACK_CELLS`); past
//! them it falls back to greedy leftmost positions.

use core::mem;

use crate::chars::{CharClass, NUM_CLASSES, bonus_table, class_table};
use crate::score::{
    BONUS_BASENAME_START, BONUS_BOUNDARY, BONUS_BOUNDARY_DELIMITER, BONUS_BOUNDARY_WHITE_DEFAULT,
    BONUS_BOUNDARY_WHITE_PATH, BONUS_CONSECUTIVE, BONUS_FIRST_CHAR_MULTIPLIER, INVALID,
    SCORE_GAP_EXTENSION, SCORE_GAP_START, SCORE_MATCH, clamp_score, valid,
};
use crate::subsequence::{greedy_positions, is_subsequence};

/// Haystacks longer than this never get an exact backtrack matrix;
/// `score_with_positions` falls back to greedy leftmost positions. File paths
/// are essentially always far shorter than this.
pub const MAX_BACKTRACK_HAYSTACK: usize = 1024;

/// Upper bound on `(needle_len + 1) * (haystack_len + 1)` for the exact
/// backtrack matrices, so the positions path allocates a bounded amount of
/// scratch (`MAX_BACKTRACK_CELLS * 17` bytes) regardless of input.
pub const MAX_BACKTRACK_CELLS: usize = 64 * 1024;

/// How case is resolved when comparing needle and haystack bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaseMode {
    /// Bytes must match exactly.
    Sensitive,
    /// ASCII letters match either case.
    Insensitive,
    /// Insensitive unless the needle contains an ASCII uppercase letter
    /// (the fzf default).
    Smart,
}

/// Configuration for a [`Scorer`].
#[derive(Clone, Copy, Debug)]
pub struct ScorerOptions {
    pub case: CaseMode,
    /// Use the fzf "path" bonus scheme (boundary after `/` scores highest,
    /// the start of the string counts as a path boundary) and add a flat
    /// bonus to the first byte of the basename so basename hits outrank the
    /// same hit in a parent directory.
    pub path_mode: bool,
}

impl Default for ScorerOptions {
    fn default() -> ScorerOptions {
        ScorerOptions {
            case: CaseMode::Smart,
            path_mode: true,
        }
    }
}

/// Reusable matcher.
///
/// Holds all scratch buffers, so a query over 100k candidates does zero heap
/// allocation after [`Scorer::set_needle`]. Not meant to be shared across
/// threads concurrently: create one per thread.
pub struct Scorer {
    opts: ScorerOptions,
    /// Byte -> character class, resolved for `opts.path_mode`.
    classes: [CharClass; 256],
    /// (prev class, class) -> positional bonus, resolved for `opts.path_mode`.
    bonus: [[i64; NUM_CLASSES]; NUM_CLASSES],
    /// Class assumed before the first haystack byte (fzf `initialCharClass`).
    initial_class: CharClass,
    /// The needle as compared: ASCII-lowercased when case-insensitive.
    needle: Vec<u8>,
    /// Resolved from `opts.case` (+ the raw needle for `Smart`) in `set_needle`.
    case_sensitive: bool,

    // Rolling DP state, all of length `needle.len() + 1` (index 0 unused /
    // permanently INVALID). `prev_*` is column `j - 1`, `cur_*` is column `j`.
    prev_d: Vec<i64>,
    prev_e: Vec<i64>,
    /// Length of the consecutive-match run ending at `D[i][j]`.
    prev_c: Vec<u32>,
    /// Positional bonus of the first byte of that run (fzf carries it forward
    /// so every byte of a run inherits the run-start bonus).
    prev_rb: Vec<i64>,
    cur_d: Vec<i64>,
    cur_e: Vec<i64>,
    cur_c: Vec<u32>,
    cur_rb: Vec<i64>,

    // Full matrices for exact position backtracking, in column-major order
    // with stride `needle.len() + 1`. Only populated by the positions path and
    // only within MAX_BACKTRACK_{HAYSTACK,CELLS}.
    mat_d: Vec<i64>,
    mat_e: Vec<i64>,
    /// 1 if `D[i][j]` was reached from `D[i-1][j-1]` (a consecutive match),
    /// 0 if from `H[i-1][j-1]` (after a gap).
    mat_consec: Vec<u8>,
}

impl Scorer {
    pub fn new(opts: ScorerOptions) -> Scorer {
        let (boundary_white, initial_class) = if opts.path_mode {
            // fzf `Init("path")`.
            (BONUS_BOUNDARY_WHITE_PATH, CharClass::Delimiter)
        } else {
            // fzf `Init("default")`.
            (BONUS_BOUNDARY_WHITE_DEFAULT, CharClass::White)
        };
        Scorer {
            opts,
            classes: class_table(opts.path_mode),
            bonus: bonus_table(boundary_white, BONUS_BOUNDARY_DELIMITER),
            initial_class,
            needle: Vec::new(),
            case_sensitive: false,
            prev_d: Vec::new(),
            prev_e: Vec::new(),
            prev_c: Vec::new(),
            prev_rb: Vec::new(),
            cur_d: Vec::new(),
            cur_e: Vec::new(),
            cur_c: Vec::new(),
            cur_rb: Vec::new(),
            mat_d: Vec::new(),
            mat_e: Vec::new(),
            mat_consec: Vec::new(),
        }
    }

    /// Set the needle once, then call [`Scorer::score`] per candidate.
    /// Resolves the effective case sensitivity and sizes the rolling buffers.
    pub fn set_needle(&mut self, needle: &[u8]) {
        self.case_sensitive = match self.opts.case {
            CaseMode::Sensitive => true,
            CaseMode::Insensitive => false,
            CaseMode::Smart => needle.iter().any(u8::is_ascii_uppercase),
        };
        self.needle.clear();
        self.needle.extend_from_slice(needle);
        if !self.case_sensitive {
            self.needle.make_ascii_lowercase();
        }
        let rows = self.needle.len() + 1;
        for v in [
            &mut self.prev_d,
            &mut self.prev_e,
            &mut self.prev_rb,
            &mut self.cur_d,
            &mut self.cur_e,
            &mut self.cur_rb,
        ] {
            v.clear();
            v.resize(rows, INVALID);
        }
        for v in [&mut self.prev_c, &mut self.cur_c] {
            v.clear();
            v.resize(rows, 0);
        }
    }

    /// `None` => the needle is not a subsequence of `haystack`.
    /// Higher is better. Deterministic. Allocates nothing.
    pub fn score(&mut self, haystack: &[u8]) -> Option<i32> {
        if self.needle.is_empty() {
            return Some(0);
        }
        if !is_subsequence(haystack, &self.needle, self.case_sensitive) {
            return None;
        }
        let (best, _) = self.run_dp(haystack, false)?;
        Some(clamp_score(best))
    }

    /// Like [`Scorer::score`], also writing the matched byte indices
    /// (strictly ascending) into `positions` (cleared first).
    ///
    /// Positions are exact (they belong to an optimal alignment) when
    /// `haystack.len() <= MAX_BACKTRACK_HAYSTACK` and
    /// `(needle+1)*(haystack+1) <= MAX_BACKTRACK_CELLS`; past those bounds the
    /// score is still exact but the positions degrade to the greedy leftmost
    /// subsequence match.
    pub fn score_with_positions(
        &mut self,
        haystack: &[u8],
        positions: &mut Vec<u32>,
    ) -> Option<i32> {
        positions.clear();
        if self.needle.is_empty() {
            return Some(0);
        }
        if !is_subsequence(haystack, &self.needle, self.case_sensitive) {
            return None;
        }
        let stride = self.needle.len() + 1;
        let exact = haystack.len() <= MAX_BACKTRACK_HAYSTACK
            && stride
                .checked_mul(haystack.len() + 1)
                .is_some_and(|cells| cells <= MAX_BACKTRACK_CELLS);
        if exact {
            let (best, best_j) = self.run_dp(haystack, true)?;
            self.backtrack(best_j, positions);
            Some(clamp_score(best))
        } else {
            let (best, _) = self.run_dp(haystack, false)?;
            greedy_positions(haystack, &self.needle, self.case_sensitive, positions);
            Some(clamp_score(best))
        }
    }

    /// Heap bytes currently held by the internal scratch buffers. Bounded:
    /// `O(needle)` for the rolling state plus at most
    /// `MAX_BACKTRACK_CELLS * 17` for the backtrack matrices.
    pub fn scratch_capacity_bytes(&self) -> usize {
        const I64: usize = size_of::<i64>();
        const U32: usize = size_of::<u32>();
        self.needle.capacity()
            + (self.prev_d.capacity()
                + self.prev_e.capacity()
                + self.prev_rb.capacity()
                + self.cur_d.capacity()
                + self.cur_e.capacity()
                + self.cur_rb.capacity()
                + self.mat_d.capacity()
                + self.mat_e.capacity())
                * I64
            + (self.prev_c.capacity() + self.cur_c.capacity()) * U32
            + self.mat_consec.capacity()
    }

    /// Runs the DP. Requires a non-empty needle. Returns the best score and
    /// the (1-based) haystack column where the best alignment ends, or `None`
    /// if the needle is not a subsequence of `haystack`.
    fn run_dp(&mut self, hay: &[u8], store: bool) -> Option<(i64, usize)> {
        let m = self.needle.len();
        let n = hay.len();
        let stride = m + 1;
        if store {
            // Caller bounds-checked `stride * (n + 1) <= MAX_BACKTRACK_CELLS`.
            let cells = stride * (n + 1);
            self.mat_d.clear();
            self.mat_d.resize(cells, INVALID);
            self.mat_e.clear();
            self.mat_e.resize(cells, INVALID);
            self.mat_consec.clear();
            self.mat_consec.resize(cells, 0);
        }
        self.prev_d.fill(INVALID);
        self.prev_e.fill(INVALID);
        self.prev_c.fill(0);
        self.prev_rb.fill(0);

        let case_sensitive = self.case_sensitive;
        // First byte of the final path component; `usize::MAX` disables the
        // basename bonus outside path mode (no haystack index reaches it).
        let basename_start = if self.opts.path_mode {
            memchr::memrchr(b'/', hay).map_or(0, |i| i + 1)
        } else {
            usize::MAX
        };

        let Scorer {
            classes,
            bonus,
            initial_class,
            needle,
            prev_d,
            prev_e,
            prev_c,
            prev_rb,
            cur_d,
            cur_e,
            cur_c,
            cur_rb,
            mat_d,
            mat_e,
            mat_consec,
            ..
        } = self;

        let mut best = INVALID;
        let mut best_j = 0usize;
        let mut prev_class = *initial_class;
        for j in 1..=n {
            let hj = j - 1;
            let hb = hay[hj];
            let class = classes[hb as usize];
            let mut col_bonus = bonus[prev_class as usize][class as usize];
            if hj == basename_start {
                col_bonus += BONUS_BASENAME_START;
            }
            prev_class = class;
            let folded = if case_sensitive {
                hb
            } else {
                hb.to_ascii_lowercase()
            };

            for i in 1..=m {
                let mut d_val = INVALID;
                let mut c_val = 0u32;
                let mut rb_val = 0i64;
                let mut from_consec = false;
                if needle[i - 1] == folded {
                    // Gap branch: extend the best alignment of needle[..i-1]
                    // within hay[..j-1] (H[i-1][j-1]; 0 for i == 1 because the
                    // leading skipped prefix is free).
                    let prev_h = if i == 1 {
                        0
                    } else {
                        prev_d[i - 1].max(prev_e[i - 1])
                    };
                    if valid(prev_h) {
                        let mult = if i == 1 {
                            BONUS_FIRST_CHAR_MULTIPLIER
                        } else {
                            1
                        };
                        d_val = prev_h + SCORE_MATCH + col_bonus * mult;
                        c_val = 1;
                        rb_val = col_bonus;
                    }
                    // Consecutive branch: needle[i-2] matched at hay[j-2].
                    // fzf run bookkeeping: every byte of a run earns at least
                    // max(BONUS_CONSECUTIVE, run-start bonus); a byte that is
                    // itself a stronger boundary restarts the run.
                    if valid(prev_d[i - 1]) {
                        let run_start_bonus = prev_rb[i - 1];
                        let (effective, run, rb) =
                            if col_bonus >= BONUS_BOUNDARY && col_bonus > run_start_bonus {
                                (col_bonus, 1, col_bonus)
                            } else {
                                (
                                    col_bonus.max(BONUS_CONSECUTIVE).max(run_start_bonus),
                                    prev_c[i - 1] + 1,
                                    run_start_bonus,
                                )
                            };
                        let v = prev_d[i - 1] + SCORE_MATCH + effective;
                        if v >= d_val {
                            d_val = v;
                            c_val = run;
                            rb_val = rb;
                            from_consec = true;
                        }
                    }
                }
                cur_d[i] = d_val;
                cur_c[i] = c_val;
                cur_rb[i] = rb_val;

                // Affine gap: open from D[i][j-1] or extend E[i][j-1].
                let open = if valid(prev_d[i]) {
                    prev_d[i] + SCORE_GAP_START
                } else {
                    INVALID
                };
                let extend = if valid(prev_e[i]) {
                    prev_e[i] + SCORE_GAP_EXTENSION
                } else {
                    INVALID
                };
                cur_e[i] = open.max(extend);

                if store {
                    let cell = j * stride + i;
                    mat_d[cell] = d_val;
                    mat_e[cell] = cur_e[i];
                    mat_consec[cell] = u8::from(from_consec);
                }
            }
            if cur_d[m] > best {
                best = cur_d[m];
                best_j = j;
            }
            mem::swap(prev_d, cur_d);
            mem::swap(prev_e, cur_e);
            mem::swap(prev_c, cur_c);
            mem::swap(prev_rb, cur_rb);
        }
        if valid(best) {
            Some((best, best_j))
        } else {
            None
        }
    }

    /// Recovers the matched haystack indices of one optimal alignment ending
    /// at column `best_j`, from the matrices filled by `run_dp(_, true)`.
    ///
    /// Standard DP traceback: at each step any branch whose stored value
    /// reproduces the current cell extends to an optimal path; ties prefer the
    /// match (`D`) branch so runs end as early (leftward) as possible.
    fn backtrack(&self, best_j: usize, out: &mut Vec<u32>) {
        enum State {
            /// needle[..i] matched, last byte exactly at hay[j-1].
            Match,
            /// needle[..i] matched somewhere within hay[..j].
            Within,
            /// needle[..i] matched within hay[..j-1], gap open at hay[j-1].
            Gap,
        }
        let stride = self.needle.len() + 1;
        let mut i = self.needle.len();
        let mut j = best_j;
        let mut state = State::Match;
        out.clear();
        loop {
            match state {
                State::Match => {
                    // `j <= MAX_BACKTRACK_HAYSTACK`, so `j - 1` fits in u32.
                    out.push(u32::try_from(j - 1).unwrap_or(u32::MAX));
                    if i == 1 {
                        break;
                    }
                    let consec = self.mat_consec[j * stride + i] != 0;
                    i -= 1;
                    j -= 1;
                    state = if consec { State::Match } else { State::Within };
                }
                State::Within => {
                    let d = self.mat_d[j * stride + i];
                    let e = self.mat_e[j * stride + i];
                    state = if valid(d) && d >= e {
                        State::Match
                    } else {
                        State::Gap
                    };
                }
                State::Gap => {
                    // Invariant: a valid E[i][j] implies a valid D[i][j'] for
                    // some i <= j' < j, so j >= 2 here and j-1 stays >= 1.
                    let d = self.mat_d[(j - 1) * stride + i];
                    let e = self.mat_e[(j - 1) * stride + i];
                    let open = if valid(d) {
                        d + SCORE_GAP_START
                    } else {
                        INVALID
                    };
                    let extend = if valid(e) {
                        e + SCORE_GAP_EXTENSION
                    } else {
                        INVALID
                    };
                    j -= 1;
                    state = if valid(open) && open >= extend {
                        State::Match
                    } else {
                        State::Gap
                    };
                }
            }
        }
        out.reverse();
    }
}

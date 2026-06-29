//! Scoring constants for the Smith-Waterman-with-affine-gaps matcher.
//!
//! The values are adopted from junegunn/fzf `src/algo/algo.go` (`FuzzyMatchV2`).
//! Each constant names the fzf identifier it mirrors and states its rationale in
//! one line. The DP is computed in `i64` so that gap penalties over arbitrarily
//! long haystacks can never overflow; the public API clamps to `i32`.

/// fzf `scoreMatch`: the base reward for every matched needle byte.
pub(crate) const SCORE_MATCH: i64 = 16;

/// fzf `scoreGapStart`: penalty for the first skipped haystack byte between two
/// matched needle bytes (opening a gap is worse than extending one).
pub(crate) const SCORE_GAP_START: i64 = -3;

/// fzf `scoreGapExtension`: penalty for each further skipped haystack byte
/// inside an already-open gap.
pub(crate) const SCORE_GAP_EXTENSION: i64 = -1;

/// fzf `bonusBoundary` (= `scoreMatch / 2`): a match immediately after a
/// non-word byte (start of a "word") is worth half an extra match.
pub(crate) const BONUS_BOUNDARY: i64 = SCORE_MATCH / 2;

/// fzf `bonusNonWord` (= `scoreMatch / 2`): matching a non-word byte itself
/// (the user typed punctuation on purpose, reward finding it).
pub(crate) const BONUS_NON_WORD: i64 = SCORE_MATCH / 2;

/// fzf `bonusCamel123` (= `bonusBoundary + scoreGapExtension`): a lower->Upper
/// (camelCase) or non-digit->digit transition; deliberately one point below a
/// hard delimiter boundary.
pub(crate) const BONUS_CAMEL123: i64 = BONUS_BOUNDARY + SCORE_GAP_EXTENSION;

/// fzf `bonusConsecutive` (= `-(scoreGapStart + scoreGapExtension)`): the floor
/// bonus inside an unbroken run, so staying in a run is never worse than the
/// one-byte gap it avoided.
pub(crate) const BONUS_CONSECUTIVE: i64 = -(SCORE_GAP_START + SCORE_GAP_EXTENSION);

/// fzf `bonusFirstCharMultiplier`: the positional bonus of the *first* needle
/// byte is doubled because where the match starts dominates perceived quality.
pub(crate) const BONUS_FIRST_CHAR_MULTIPLIER: i64 = 2;

/// fzf `Init("default")` `bonusBoundaryWhite` (= `bonusBoundary + 2`): in the
/// default scheme a match right after whitespace outranks one after punctuation.
pub(crate) const BONUS_BOUNDARY_WHITE_DEFAULT: i64 = BONUS_BOUNDARY + 2;

/// fzf `Init("path")` `bonusBoundaryWhite` (= `bonusBoundary`): whitespace is
/// not a meaningful separator inside a file path.
pub(crate) const BONUS_BOUNDARY_WHITE_PATH: i64 = BONUS_BOUNDARY;

/// fzf `bonusBoundaryDelimiter` (= `bonusBoundary + 1`): a match right after a
/// delimiter (`/` in path mode) outranks every other boundary kind.
pub(crate) const BONUS_BOUNDARY_DELIMITER: i64 = BONUS_BOUNDARY + 1;

/// Not in fzf (design contract, `path_mode`): an extra flat bonus on the first
/// byte of the final path component so that a basename hit strictly outranks
/// the identical hit inside a parent directory name.
pub(crate) const BONUS_BASENAME_START: i64 = BONUS_BOUNDARY;

/// Sentinel for "no alignment reaches this DP cell". It sits far below any
/// reachable real score (a real score is bounded below by `-haystack_len - 3`)
/// and far above `i64::MIN`, so per-byte additions can neither overflow nor be
/// confused with a real value.
pub(crate) const INVALID: i64 = i64::MIN / 4;

/// Threshold separating real scores from `INVALID`. Real scores can never reach
/// it: the most negative reachable score is `-(haystack_len) - 3`.
const VALIDITY_FLOOR: i64 = i64::MIN / 8;

#[inline]
pub(crate) fn valid(score: i64) -> bool {
    score > VALIDITY_FLOOR
}

#[inline]
pub(crate) fn clamp_score(score: i64) -> i32 {
    score.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

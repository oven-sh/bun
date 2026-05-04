// MIT License
//
// Copyright (c) 2023 diffz authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

use core::any::TypeId;
use core::fmt;

use bun_alloc::AllocError;
use bun_collections::StringHashMap;

#[derive(Clone, Copy)]
pub struct Config {
    /// Number of milliseconds to map a diff before giving up (0 for infinity).
    pub diff_timeout: u64,
    /// Cost of an empty edit operation in terms of edit characters.
    pub diff_edit_cost: u16,
    /// Number of bytes in each string needed to trigger a line-based diff
    pub diff_check_lines_over: u64,

    /// At what point is no match declared (0.0 = perfection, 1.0 = very loose).
    pub match_threshold: f32,
    /// How far to search for a match (0 = exact location, 1000+ = broad match).
    /// A match this many characters away from the expected location will add
    /// 1.0 to the score (0.0 is a perfect match).
    pub match_distance: u32,
    /// The number of bits in an int.
    pub match_max_bits: u16,

    /// When deleting a large block of text (over ~64 characters), how close
    /// do the contents have to be to match the expected contents. (0.0 =
    /// perfection, 1.0 = very loose).  Note that Match_Threshold controls
    /// how closely the end points of a delete need to match.
    pub patch_delete_threshold: f32,
    /// Chunk size for context length.
    pub patch_margin: u16,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            diff_timeout: 1000,
            diff_edit_cost: 4,
            diff_check_lines_over: 100,
            match_threshold: 0.5,
            match_distance: 1000,
            match_max_bits: 32,
            patch_delete_threshold: 0.5,
            patch_margin: 4,
        }
    }
}

/// Marker trait for the element type a diff operates over (`u8` or `usize`).
pub trait DiffUnit: Copy + Eq + 'static {}
impl DiffUnit for u8 {}
impl DiffUnit for usize {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Operation {
    Insert,
    Delete,
    Equal,
}

#[derive(Debug, Eq, PartialEq)]
pub struct Diff<Unit: DiffUnit> {
    pub operation: Operation,
    pub text: Box<[Unit]>,
}

impl<Unit: DiffUnit> Diff<Unit> {
    pub fn eql(&self, b: &Diff<Unit>) -> bool {
        self.operation == b.operation && self.text[..] == b.text[..]
    }
}

impl fmt::Display for Diff<u8> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let op = match self.operation {
            Operation::Equal => "=",
            Operation::Insert => "+",
            Operation::Delete => "-",
        };
        // TODO(port): Zig used `{s}` on `[]const Unit`; bytes may not be valid UTF-8.
        write!(f, "({}, \"{}\")", op, bstr::BStr::new(&self.text))
    }
}

/// Zig: `pub fn DMP(comptime Unit: type) type { return struct { ... } }`
#[derive(Clone, Copy)]
pub struct DiffMatchPatch<Unit: DiffUnit> {
    pub config: Config,
    _unit: core::marker::PhantomData<Unit>,
}

pub type DiffList<Unit> = Vec<Diff<Unit>>;

/// Zig: `pub const DiffError = error{OutOfMemory};`
pub type DiffError = AllocError;

/// Zig: `const DMPUsize = DMP(usize);`
pub type DmpUsize = DiffMatchPatch<usize>;

impl<Unit: DiffUnit> Default for DiffMatchPatch<Unit> {
    fn default() -> Self {
        Self { config: Config::default(), _unit: core::marker::PhantomData }
    }
}

impl<Unit: DiffUnit> DiffMatchPatch<Unit> {
    /// DMP with default configuration options
    pub const DEFAULT: Self = Self {
        // TODO(port): `Config::default()` is not const; Phase B may need a `Config::DEFAULT`.
        config: Config {
            diff_timeout: 1000,
            diff_edit_cost: 4,
            diff_check_lines_over: 100,
            match_threshold: 0.5,
            match_distance: 1000,
            match_max_bits: 32,
            patch_delete_threshold: 0.5,
            patch_margin: 4,
        },
        _unit: core::marker::PhantomData,
    };

    pub fn new(config: Config) -> Self {
        Self { config, _unit: core::marker::PhantomData }
    }

    /// Find the differences between two texts.
    /// @param before Old string to be diffed.
    /// @param after New string to be diffed.
    /// @param checklines Speedup flag.  If false, then don't run a
    ///     line-level diff first to identify the changed areas.
    ///     If true, then run a faster slightly less optimal diff.
    /// @return List of Diff objects.
    pub fn diff(
        &self,
        before: &[Unit],
        after: &[Unit],
        /// If false, then don't run a line-level diff first
        /// to identify the changed areas. If true, then run
        /// a faster slightly less optimal diff.
        check_lines: bool,
    ) -> Result<DiffList<Unit>, DiffError> {
        let deadline = if self.config.diff_timeout == 0 {
            u64::MAX
        } else {
            milli_timestamp() + self.config.diff_timeout
        };
        self.diff_internal(before, after, check_lines, deadline)
    }

    // Zig `deinitDiffList` / `freeRangeDiffList` deleted: bodies only freed owned
    // `Box<[Unit]>` fields (now handled by `Drop`); range-free callsites inlined as `drain`.

    fn diff_internal(
        &self,
        before: &[Unit],
        after: &[Unit],
        check_lines: bool,
        deadline: u64,
    ) -> Result<DiffList<Unit>, DiffError> {
        // Trim off common prefix (speedup).
        let common_prefix_length = match index_of_diff(before, after) {
            None => {
                // equality
                let mut diffs: DiffList<Unit> = Vec::new();
                if !before.is_empty() {
                    diffs.reserve(1);
                    // PERF(port): was assume_capacity
                    diffs.push(Diff {
                        operation: Operation::Equal,
                        text: dupe(before),
                    });
                }
                return Ok(diffs);
            }
            Some(n) => n,
        };

        let common_prefix = &before[0..common_prefix_length];
        let mut trimmed_before = &before[common_prefix_length..];
        let mut trimmed_after = &after[common_prefix_length..];

        // Trim off common suffix (speedup).
        let common_suffix_length = diff_common_suffix(trimmed_before, trimmed_after);
        let common_suffix = &trimmed_before[trimmed_before.len() - common_suffix_length..];
        trimmed_before = &trimmed_before[0..trimmed_before.len() - common_suffix_length];
        trimmed_after = &trimmed_after[0..trimmed_after.len() - common_suffix_length];

        // Compute the diff on the middle block.
        let mut diffs = self.diff_compute(trimmed_before, trimmed_after, check_lines, deadline)?;

        // Restore the prefix and suffix.

        if !common_prefix.is_empty() {
            diffs.reserve(1);
            // PERF(port): was insertAssumeCapacity
            diffs.insert(0, Diff {
                operation: Operation::Equal,
                text: dupe(common_prefix),
            });
        }
        if !common_suffix.is_empty() {
            diffs.reserve(1);
            // PERF(port): was assume_capacity
            diffs.push(Diff {
                operation: Operation::Equal,
                text: dupe(common_suffix),
            });
        }

        diff_cleanup_merge(&mut diffs)?;
        Ok(diffs)
    }

    /// Find the differences between two texts.  Assumes that the texts do not
    /// have any common prefix or suffix.
    /// @param before Old string to be diffed.
    /// @param after New string to be diffed.
    /// @param checklines Speedup flag.  If false, then don't run a
    ///     line-level diff first to identify the changed areas.
    ///     If true, then run a faster slightly less optimal diff.
    /// @param deadline Time when the diff should be complete by.
    /// @return List of Diff objects.
    fn diff_compute(
        &self,
        before: &[Unit],
        after: &[Unit],
        check_lines: bool,
        deadline: u64,
    ) -> Result<DiffList<Unit>, DiffError> {
        if before.is_empty() {
            // Just add some text (speedup).
            let mut diffs: DiffList<Unit> = Vec::with_capacity(1);
            // PERF(port): was assume_capacity
            diffs.push(Diff { operation: Operation::Insert, text: dupe(after) });
            return Ok(diffs);
        }

        if after.is_empty() {
            // Just delete some text (speedup).
            let mut diffs: DiffList<Unit> = Vec::with_capacity(1);
            // PERF(port): was assume_capacity
            diffs.push(Diff { operation: Operation::Delete, text: dupe(before) });
            return Ok(diffs);
        }

        let long_text = if before.len() > after.len() { before } else { after };
        let short_text = if before.len() > after.len() { after } else { before };

        if let Some(index) = index_of(long_text, short_text) {
            let mut diffs: DiffList<Unit> = Vec::with_capacity(3);
            // Shorter text is inside the longer text (speedup).
            let op: Operation = if before.len() > after.len() {
                Operation::Delete
            } else {
                Operation::Insert
            };
            // PERF(port): was assume_capacity
            diffs.push(Diff { operation: op, text: dupe(&long_text[0..index]) });
            diffs.push(Diff { operation: Operation::Equal, text: dupe(short_text) });
            diffs.push(Diff { operation: op, text: dupe(&long_text[index + short_text.len()..]) });
            return Ok(diffs);
        }

        if short_text.len() == 1 {
            // Single character string.
            // After the previous speedup, the character can't be an equality.
            let mut diffs: DiffList<Unit> = Vec::with_capacity(2);
            // PERF(port): was assume_capacity
            diffs.push(Diff { operation: Operation::Delete, text: dupe(before) });
            diffs.push(Diff { operation: Operation::Insert, text: dupe(after) });
            return Ok(diffs);
        }

        // Check to see if the problem can be split in two.
        if let Some(half_match) = self.diff_half_match(before, after)? {
            // A half-match was found, sort out the return data.
            // Send both pairs off for separate processing.
            let mut diffs = self.diff_internal(
                &half_match.prefix_before,
                &half_match.prefix_after,
                check_lines,
                deadline,
            )?;
            let diffs_b = self.diff_internal(
                &half_match.suffix_before,
                &half_match.suffix_after,
                check_lines,
                deadline,
            )?;

            // Merge the results.
            diffs.reserve(1);
            // PERF(port): was assume_capacity
            diffs.push(Diff {
                operation: Operation::Equal,
                text: half_match.common_middle,
            });
            diffs.extend(diffs_b);
            return Ok(diffs);
        }
        if check_lines
            && before.len() as u64 > self.config.diff_check_lines_over
            && after.len() as u64 > self.config.diff_check_lines_over
        {
            return self.diff_line_mode(before, after, deadline);
        }

        self.diff_bisect(before, after, deadline)
    }

    /// Do the two texts share a Substring which is at least half the length of
    /// the longer text?
    /// This speedup can produce non-minimal diffs.
    /// @param before First string.
    /// @param after Second string.
    /// @return Five element String array, containing the prefix of text1, the
    ///     suffix of text1, the prefix of text2, the suffix of text2 and the
    ///     common middle.  Or null if there was no match.
    fn diff_half_match(
        &self,
        before: &[Unit],
        after: &[Unit],
    ) -> Result<Option<HalfMatchResult<Unit>>, DiffError> {
        if self.config.diff_timeout == 0 {
            // Don't risk returning a non-optimal diff if we have unlimited time.
            return Ok(None);
        }
        let long_text = if before.len() > after.len() { before } else { after };
        let short_text = if before.len() > after.len() { after } else { before };

        if long_text.len() < 4 || short_text.len() * 2 < long_text.len() {
            return Ok(None); // Pointless.
        }

        // First check if the second quarter is the seed for a half-match.
        let half_match_1 = self.diff_half_match_internal(long_text, short_text, (long_text.len() + 3) / 4)?;
        // Check again based on the third quarter.
        let half_match_2 = self.diff_half_match_internal(long_text, short_text, (long_text.len() + 1) / 2)?;

        let half_match: HalfMatchResult<Unit>;
        if half_match_1.is_none() && half_match_2.is_none() {
            return Ok(None);
        } else if half_match_2.is_none() {
            half_match = half_match_1.unwrap();
        } else if half_match_1.is_none() {
            half_match = half_match_2.unwrap();
        } else {
            // Both matched. Select the longest.
            let hm1 = half_match_1.unwrap();
            let hm2 = half_match_2.unwrap();
            half_match = if hm1.common_middle.len() > hm2.common_middle.len() {
                hm1
            } else {
                hm2
            };
        }

        // A half-match was found, sort out the return data.
        if before.len() > after.len() {
            Ok(Some(half_match))
        } else {
            // Transfers ownership of all memory to new, permuted, half_match.
            Ok(Some(HalfMatchResult {
                prefix_before: half_match.prefix_after,
                suffix_before: half_match.suffix_after,
                prefix_after: half_match.prefix_before,
                suffix_after: half_match.suffix_before,
                common_middle: half_match.common_middle,
            }))
        }
    }

    /// Does a Substring of shorttext exist within longtext such that the
    /// Substring is at least half the length of longtext?
    /// @param longtext Longer string.
    /// @param shorttext Shorter string.
    /// @param i Start index of quarter length Substring within longtext.
    /// @return Five element string array, containing the prefix of longtext, the
    ///     suffix of longtext, the prefix of shorttext, the suffix of shorttext
    ///     and the common middle.  Or null if there was no match.
    fn diff_half_match_internal(
        &self,
        long_text: &[Unit],
        short_text: &[Unit],
        i: usize,
    ) -> Result<Option<HalfMatchResult<Unit>>, DiffError> {
        // Start with a 1/4 length Substring at position i as a seed.
        let seed = &long_text[i..i + long_text.len() / 4];
        let mut j: isize = -1;

        let mut best_common: Vec<Unit> = Vec::new();
        let mut best_long_text_a: &[Unit] = &[];
        let mut best_long_text_b: &[Unit] = &[];
        let mut best_short_text_a: &[Unit] = &[];
        let mut best_short_text_b: &[Unit] = &[];

        while i128::from(j) < i128::try_from(short_text.len()).unwrap() && {
            match index_of(&short_text[usize::try_from(j + 1).unwrap()..], seed) {
                Some(found) => {
                    j = isize::try_from(found).unwrap() + j + 1;
                    true
                }
                None => false,
            }
        } {
            let ju = usize::try_from(j).unwrap();
            let prefix_length = diff_common_prefix(&long_text[i..], &short_text[ju..]);
            let suffix_length = diff_common_suffix(&long_text[0..i], &short_text[0..ju]);
            if best_common.len() < suffix_length + prefix_length {
                best_common.clear();
                let a = &short_text[ju - suffix_length..(ju - suffix_length) + suffix_length];
                best_common.extend_from_slice(a);
                let b = &short_text[ju..ju + prefix_length];
                best_common.extend_from_slice(b);

                best_long_text_a = &long_text[0..i - suffix_length];
                best_long_text_b = &long_text[i + prefix_length..];
                best_short_text_a = &short_text[0..ju - suffix_length];
                best_short_text_b = &short_text[ju + prefix_length..];
            }
        }
        if best_common.len() * 2 >= long_text.len() {
            Ok(Some(HalfMatchResult {
                prefix_before: dupe(best_long_text_a),
                suffix_before: dupe(best_long_text_b),
                prefix_after: dupe(best_short_text_a),
                suffix_after: dupe(best_short_text_b),
                common_middle: best_common.into_boxed_slice(),
            }))
        } else {
            Ok(None)
        }
    }

    /// Find the 'middle snake' of a diff, split the problem in two
    /// and return the recursively constructed diff.
    /// See Myers 1986 paper: An O(ND) Difference Algorithm and Its Variations.
    /// @param before Old string to be diffed.
    /// @param after New string to be diffed.
    /// @param deadline Time at which to bail if not yet complete.
    /// @return List of Diff objects.
    fn diff_bisect(
        &self,
        before: &[Unit],
        after: &[Unit],
        deadline: u64,
    ) -> Result<DiffList<Unit>, DiffError> {
        let before_length: isize = isize::try_from(before.len()).unwrap();
        let after_length: isize = isize::try_from(after.len()).unwrap();
        let max_d: isize = isize::try_from((before.len() + after.len() + 1) / 2).unwrap();
        let v_offset = max_d;
        let v_length = 2 * max_d;

        let mut v1: Vec<isize> = vec![-1; usize::try_from(v_length).unwrap()];
        let mut v2: Vec<isize> = vec![-1; usize::try_from(v_length).unwrap()];

        v1[usize::try_from(v_offset + 1).unwrap()] = 0;
        v2[usize::try_from(v_offset + 1).unwrap()] = 0;
        let delta = before_length - after_length;
        // If the total number of characters is odd, then the front path will
        // collide with the reverse path.
        let front = delta.rem_euclid(2) != 0;
        // Offsets for start and end of k loop.
        // Prevents mapping of space beyond the grid.
        let mut k1start: isize = 0;
        let mut k1end: isize = 0;
        let mut k2start: isize = 0;
        let mut k2end: isize = 0;

        let mut d: isize = 0;
        while d < max_d {
            // Bail out if deadline is reached.
            if milli_timestamp() > deadline {
                break;
            }

            // Walk the front path one step.
            // PERF(port): @intCast — bare `as usize` kept for v1/v2/before/after indexing
            // in this hot Myers inner loop; profile in Phase B.
            let mut k1 = -d + k1start;
            while k1 <= d - k1end {
                let k1_offset = v_offset + k1;
                let mut x1: isize;
                if k1 == -d
                    || (k1 != d && v1[(k1_offset - 1) as usize] < v1[(k1_offset + 1) as usize])
                {
                    x1 = v1[(k1_offset + 1) as usize];
                } else {
                    x1 = v1[(k1_offset - 1) as usize] + 1;
                }
                let mut y1 = x1 - k1;
                while x1 < before_length
                    && y1 < after_length
                    && before[x1 as usize] == after[y1 as usize]
                {
                    x1 += 1;
                    y1 += 1;
                }
                v1[k1_offset as usize] = x1;
                if x1 > before_length {
                    // Ran off the right of the graph.
                    k1end += 2;
                } else if y1 > after_length {
                    // Ran off the bottom of the graph.
                    k1start += 2;
                } else if front {
                    let k2_offset = v_offset + delta - k1;
                    if k2_offset >= 0 && k2_offset < v_length && v2[k2_offset as usize] != -1 {
                        // Mirror x2 onto top-left coordinate system.
                        let x2 = before_length - v2[k2_offset as usize];
                        if x1 >= x2 {
                            // Overlap detected.
                            return self.diff_bisect_split(before, after, x1, y1, deadline);
                        }
                    }
                }
                k1 += 2;
            }

            // Walk the reverse path one step.
            // PERF(port): @intCast — bare `as usize` kept for v1/v2/before/after indexing
            // in this hot Myers inner loop; profile in Phase B.
            let mut k2: isize = -d + k2start;
            while k2 <= d - k2end {
                let k2_offset = v_offset + k2;
                let mut x2: isize;
                if k2 == -d
                    || (k2 != d && v2[(k2_offset - 1) as usize] < v2[(k2_offset + 1) as usize])
                {
                    x2 = v2[(k2_offset + 1) as usize];
                } else {
                    x2 = v2[(k2_offset - 1) as usize] + 1;
                }
                let mut y2: isize = x2 - k2;
                while x2 < before_length
                    && y2 < after_length
                    && before[(before_length - x2 - 1) as usize]
                        == after[(after_length - y2 - 1) as usize]
                {
                    x2 += 1;
                    y2 += 1;
                }
                v2[k2_offset as usize] = x2;
                if x2 > before_length {
                    // Ran off the left of the graph.
                    k2end += 2;
                } else if y2 > after_length {
                    // Ran off the top of the graph.
                    k2start += 2;
                } else if !front {
                    let k1_offset = v_offset + delta - k2;
                    if k1_offset >= 0 && k1_offset < v_length && v1[k1_offset as usize] != -1 {
                        let x1 = v1[k1_offset as usize];
                        let y1 = v_offset + x1 - k1_offset;
                        // Mirror x2 onto top-left coordinate system.
                        x2 = before_length - v2[k2_offset as usize];
                        if x1 >= x2 {
                            // Overlap detected.
                            return self.diff_bisect_split(before, after, x1, y1, deadline);
                        }
                    }
                }
                k2 += 2;
            }
            d += 1;
        }
        // Diff took too long and hit the deadline or
        // number of diffs equals number of characters, no commonality at all.
        let mut diffs: DiffList<Unit> = Vec::with_capacity(2);
        // PERF(port): was assume_capacity
        diffs.push(Diff { operation: Operation::Delete, text: dupe(before) });
        diffs.push(Diff { operation: Operation::Insert, text: dupe(after) });
        Ok(diffs)
    }

    /// Given the location of the 'middle snake', split the diff in two parts
    /// and recurse.
    /// @param text1 Old string to be diffed.
    /// @param text2 New string to be diffed.
    /// @param x Index of split point in text1.
    /// @param y Index of split point in text2.
    /// @param deadline Time at which to bail if not yet complete.
    /// @return LinkedList of Diff objects.
    fn diff_bisect_split(
        &self,
        text1: &[Unit],
        text2: &[Unit],
        x: isize,
        y: isize,
        deadline: u64,
    ) -> Result<DiffList<Unit>, DiffError> {
        let x = usize::try_from(x).unwrap();
        let y = usize::try_from(y).unwrap();
        let text1a = &text1[0..x];
        let text2a = &text2[0..y];
        let text1b = &text1[x..];
        let text2b = &text2[y..];

        // Compute both diffs serially.
        let mut diffs = self.diff_internal(text1a, text2a, false, deadline)?;
        let diffs_b = self.diff_internal(text1b, text2b, false, deadline)?;
        diffs.extend(diffs_b);
        Ok(diffs)
    }

    /// Do a quick line-level diff on both strings, then rediff the parts for
    /// greater accuracy.
    /// This speedup can produce non-minimal diffs.
    /// @param text1 Old string to be diffed.
    /// @param text2 New string to be diffed.
    /// @param deadline Time when the diff should be complete by.
    /// @return List of Diff objects.
    fn diff_line_mode(
        &self,
        text1_in: &[Unit],
        text2_in: &[Unit],
        deadline: u64,
    ) -> Result<DiffList<Unit>, DiffError> {
        // Scan the text on a line-by-line basis first.
        let a = diff_lines_to_chars(text1_in, text2_in)?;
        let text1 = &a.chars_1;
        let text2 = &a.chars_2;
        let line_array = &a.line_array;
        let mut diffs: DiffList<Unit>;
        let dmp_usize = DmpUsize { config: self.config, _unit: core::marker::PhantomData };
        {
            let char_diffs: DiffList<usize> = dmp_usize.diff_internal(text1, text2, false, deadline)?;
            // Convert the diff back to original text.
            diffs = diff_chars_to_lines(&char_diffs, line_array)?;
            // Eliminate freak matches (e.g. blank lines)
        }
        diff_cleanup_semantic(&mut diffs)?;

        // Rediff any replacement blocks, this time character-by-character.
        // Add a dummy entry at the end.
        diffs.push(Diff { operation: Operation::Equal, text: Box::default() });

        let mut pointer: usize = 0;
        let mut count_delete: usize = 0;
        let mut count_insert: usize = 0;
        let mut text_delete: Vec<Unit> = Vec::new();
        let mut text_insert: Vec<Unit> = Vec::new();

        while pointer < diffs.len() {
            match diffs[pointer].operation {
                Operation::Insert => {
                    count_insert += 1;
                    text_insert.extend_from_slice(&diffs[pointer].text);
                }
                Operation::Delete => {
                    count_delete += 1;
                    text_delete.extend_from_slice(&diffs[pointer].text);
                }
                Operation::Equal => {
                    // Upon reaching an equality, check for prior redundancies.
                    if count_delete >= 1 && count_insert >= 1 {
                        // Delete the offending records and add the merged ones.
                        // PORT NOTE: Zig freeRangeDiffList + replaceRangeAssumeCapacity → drain
                        diffs.drain(
                            pointer - count_delete - count_insert
                                ..pointer - count_delete - count_insert + count_delete + count_insert,
                        );
                        pointer = pointer - count_delete - count_insert;
                        let sub_diff =
                            self.diff_internal(&text_delete, &text_insert, false, deadline)?;
                        let sub_len = sub_diff.len();
                        // PERF(port): was ensureUnusedCapacity + addManyAtAssumeCapacity + @memcpy
                        diffs.splice(pointer..pointer, sub_diff);
                        pointer = pointer + sub_len;
                    }
                    count_insert = 0;
                    count_delete = 0;
                    text_delete.clear();
                    text_insert.clear();
                }
            }
            pointer += 1;
        }
        diffs.truncate(diffs.len() - 1); // Remove the dummy entry at the end.

        Ok(diffs)
    }

    /// Reduce the number of edits by eliminating operationally trivial
    /// equalities.
    pub fn diff_cleanup_efficiency(&self, diffs: &mut DiffList<Unit>) -> Result<(), DiffError> {
        let mut changes = false;
        // Stack of indices where equalities are found.
        let mut equalities: Vec<usize> = Vec::new();
        // Always equal to equalities[equalitiesLength-1][1]
        // PORT NOTE: reshaped for borrowck — owned copy of last_equality
        let mut last_equality: Box<[Unit]> = Box::default();
        let mut ipointer: isize = 0; // Index of current position.
        // Is there an insertion operation before the last equality.
        let mut pre_ins = false;
        // Is there a deletion operation before the last equality.
        let mut pre_del = false;
        // Is there an insertion operation after the last equality.
        let mut post_ins = false;
        // Is there a deletion operation after the last equality.
        let mut post_del = false;
        while usize::try_from(ipointer).unwrap() < diffs.len() {
            let pointer: usize = usize::try_from(ipointer).unwrap();
            if diffs[pointer].operation == Operation::Equal {
                // Equality found.
                if diffs[pointer].text.len() < usize::from(self.config.diff_edit_cost)
                    && (post_ins || post_del)
                {
                    // Candidate found.
                    equalities.push(pointer);
                    pre_ins = post_ins;
                    pre_del = post_del;
                    last_equality = dupe(&diffs[pointer].text);
                } else {
                    // Not a candidate, and can never become one.
                    equalities.clear();
                    last_equality = Box::default();
                }
                post_ins = false;
                post_del = false;
            } else {
                // An insertion or deletion.
                if diffs[pointer].operation == Operation::Delete {
                    post_del = true;
                } else {
                    post_ins = true;
                }
                // Five types to be split:
                // <ins>A</ins><del>B</del>XY<ins>C</ins><del>D</del>
                // <ins>A</ins>X<ins>C</ins><del>D</del>
                // <ins>A</ins><del>B</del>X<ins>C</ins>
                // <ins>A</del>X<ins>C</ins><del>D</del>
                // <ins>A</ins><del>B</del>X<del>C</del>
                if !last_equality.is_empty()
                    && ((pre_ins && pre_del && post_ins && post_del)
                        || (last_equality.len() < usize::from(self.config.diff_edit_cost / 2)
                            && (pre_ins as u8
                                + pre_del as u8
                                + post_ins as u8
                                + post_del as u8
                                == 3)))
                {
                    // Duplicate record.
                    let eq_idx = equalities[equalities.len() - 1];
                    // PERF(port): was ensureUnusedCapacity + insertAssumeCapacity
                    diffs.insert(eq_idx, Diff {
                        operation: Operation::Delete,
                        text: dupe(&last_equality),
                    });
                    // Change second copy to insert.
                    diffs[eq_idx + 1].operation = Operation::Insert;
                    equalities.pop(); // Throw away the equality we just deleted.
                    last_equality = Box::default();
                    if pre_ins && pre_del {
                        // No changes made which could affect previous entry, keep going.
                        post_ins = true;
                        post_del = true;
                        equalities.clear();
                    } else {
                        if !equalities.is_empty() {
                            equalities.pop();
                        }
                        ipointer = if !equalities.is_empty() {
                            isize::try_from(equalities[equalities.len() - 1]).unwrap()
                        } else {
                            -1
                        };
                        post_ins = false;
                        post_del = false;
                    }
                    changes = true;
                }
            }
            ipointer += 1;
        }

        if changes {
            diff_cleanup_merge(diffs)?;
        }
        Ok(())
    }
}

pub struct HalfMatchResult<Unit: DiffUnit> {
    pub prefix_before: Box<[Unit]>,
    pub suffix_before: Box<[Unit]>,
    pub prefix_after: Box<[Unit]>,
    pub suffix_after: Box<[Unit]>,
    pub common_middle: Box<[Unit]>,
}
// `deinit` → Drop handles `Box<[Unit]>` fields automatically.

pub struct LinesToCharsResult<Unit: DiffUnit> {
    pub chars_1: Box<[usize]>,
    pub chars_2: Box<[usize]>,
    // TODO(port): lifetime — borrows slices from the input texts; raw ptr in Phase A
    // (no struct lifetime params), Phase B may promote to BORROW_PARAM in LIFETIMES.tsv.
    pub line_array: Vec<*const [Unit]>,
}
// `deinit` → Drop handles all fields automatically.

/// Split two texts into a list of strings.  Reduce the texts to a string of
/// hashes where each Unicode character represents one line.
/// @param text1 First string.
/// @param text2 Second string.
/// @return Three element Object array, containing the encoded text1, the
///     encoded text2 and the List of unique strings.  The zeroth element
///     of the List of unique strings is intentionally blank.
pub fn diff_lines_to_chars<Unit: DiffUnit>(
    text1: &[Unit],
    text2: &[Unit],
) -> Result<LinesToCharsResult<Unit>, DiffError> {
    let mut line_array: Vec<*const [Unit]> = Vec::new();
    // TODO(port): `bun.StringHashMapUnmanaged(usize)` keyed by borrowed `&[u8]` —
    // `bun_collections::StringHashMap` may need a `&[u8]`-borrowing variant.
    let mut line_hash: StringHashMap<usize> = StringHashMap::default();
    // e.g. line_array[4] == "Hello\n"
    // e.g. line_hash.get("Hello\n") == 4

    // "\x00" is a valid character, but various debuggers don't like it.
    // So we'll insert a junk entry to avoid generating a null character.
    line_array.push(&[] as *const [Unit]);

    // Allocate 2/3rds of the space for text1, the rest for text2.
    let chars1 = diff_lines_to_chars_munge(text1, &mut line_array, &mut line_hash)?;
    let chars2 = diff_lines_to_chars_munge(text2, &mut line_array, &mut line_hash)?;
    Ok(LinesToCharsResult { chars_1: chars1, chars_2: chars2, line_array })
}

/// Split a text into a list of strings.  Reduce the texts to a string of
/// hashes where each Unicode character represents one line.
/// @param text String to encode.
/// @param lineArray List of unique strings.
/// @param lineHash Map of strings to indices.
/// @param maxLines Maximum length of lineArray.
/// @return Encoded string.
fn diff_lines_to_chars_munge<Unit: DiffUnit>(
    text: &[Unit],
    line_array: &mut Vec<*const [Unit]>,
    line_hash: &mut StringHashMap<usize>,
) -> Result<Box<[usize]>, DiffError> {
    // TODO(port): comptime `if (Unit != u8) @panic` → runtime TypeId check.
    if TypeId::of::<Unit>() != TypeId::of::<u8>() {
        panic!("Unit must be u8");
    }
    // SAFETY: Unit == u8 verified above; layout-identical reinterpret.
    let text_u8: &[u8] = unsafe { core::slice::from_raw_parts(text.as_ptr() as *const u8, text.len()) };

    let mut line_start: isize = 0;
    let mut line_end: isize = -1;
    let mut chars: Vec<usize> = Vec::new();
    // Walk the text, pulling out a Substring for each line.
    // TODO this can be handled with a Reader, avoiding all the manual splitting
    while line_end < isize::try_from(text.len()).unwrap() - 1 {
        line_end = 'b: {
            match index_of(&text_u8[usize::try_from(line_start).unwrap()..], b"\n") {
                Some(idx) => break 'b isize::try_from(idx).unwrap() + line_start,
                None => break 'b isize::try_from(text.len()).unwrap() - 1,
            }
        };
        let mut line = &text[usize::try_from(line_start).unwrap()
            ..usize::try_from(line_start + (line_end + 1 - line_start)).unwrap()];
        // SAFETY: Unit == u8 verified above.
        let line_u8: &[u8] =
            unsafe { core::slice::from_raw_parts(line.as_ptr() as *const u8, line.len()) };

        if let Some(&value) = line_hash.get(line_u8) {
            chars.push(value);
        } else {
            if line_array.len() == usize::MAX {
                line = &text[usize::try_from(line_start).unwrap()..];
                line_end = isize::try_from(text.len()).unwrap();
            }
            line_array.push(line as *const [Unit]);
            // SAFETY: Unit == u8 verified above.
            let line_u8: &[u8] =
                unsafe { core::slice::from_raw_parts(line.as_ptr() as *const u8, line.len()) };
            // TODO(port): StringHashMap key ownership — Zig stored a borrowed slice.
            line_hash.insert(line_u8, line_array.len() - 1);
            chars.push(line_array.len() - 1);
        }
        line_start = line_end + 1;
    }
    Ok(chars.into_boxed_slice())
}

/// Rehydrate the text in a diff from a string of line hashes to real lines
/// of text.
/// @param diffs List of Diff objects.
/// @param lineArray List of unique strings.
pub fn diff_chars_to_lines<Unit: DiffUnit>(
    char_diffs: &DiffList<usize>,
    line_array: &[*const [Unit]],
) -> Result<DiffList<Unit>, DiffError> {
    let mut diffs: DiffList<Unit> = Vec::with_capacity(char_diffs.len());
    let mut text: Vec<Unit> = Vec::new();

    for d in char_diffs.iter() {
        let mut j: usize = 0;
        while j < d.text.len() {
            // SAFETY: line_array entries borrow from input texts which outlive this call.
            text.extend_from_slice(unsafe { &*line_array[d.text[j]] });
            j += 1;
        }
        // PERF(port): was assume_capacity
        diffs.push(Diff {
            operation: d.operation,
            text: core::mem::take(&mut text).into_boxed_slice(),
        });
    }
    Ok(diffs)
}

/// Reorder and merge like edit sections.  Merge equalities.
/// Any edit section can move as long as it doesn't cross an equality.
/// @param diffs List of Diff objects.
pub fn diff_cleanup_merge<Unit: DiffUnit>(diffs: &mut DiffList<Unit>) -> Result<(), DiffError> {
    // Add a dummy entry at the end.
    diffs.push(Diff { operation: Operation::Equal, text: Box::default() });
    let mut pointer: usize = 0;
    let mut count_delete: usize = 0;
    let mut count_insert: usize = 0;

    let mut text_delete: Vec<Unit> = Vec::new();
    let mut text_insert: Vec<Unit> = Vec::new();

    let mut common_length: usize;
    while pointer < diffs.len() {
        match diffs[pointer].operation {
            Operation::Insert => {
                count_insert += 1;
                text_insert.extend_from_slice(&diffs[pointer].text);
                pointer += 1;
            }
            Operation::Delete => {
                count_delete += 1;
                text_delete.extend_from_slice(&diffs[pointer].text);
                pointer += 1;
            }
            Operation::Equal => {
                // Upon reaching an equality, check for prior redundancies.
                if count_delete + count_insert > 1 {
                    if count_delete != 0 && count_insert != 0 {
                        // Factor out any common prefixies.
                        common_length = diff_common_prefix(&text_insert, &text_delete);
                        if common_length != 0 {
                            if (pointer - count_delete - count_insert) > 0
                                && diffs[pointer - count_delete - count_insert - 1].operation
                                    == Operation::Equal
                            {
                                let ii = pointer - count_delete - count_insert - 1;
                                let mut nt: Vec<Unit> =
                                    Vec::with_capacity(diffs[ii].text.len() + common_length);
                                nt.extend_from_slice(&diffs[ii].text);
                                nt.extend_from_slice(&text_insert[0..common_length]);
                                diffs[ii].text = nt.into_boxed_slice();
                            } else {
                                // PERF(port): was ensureUnusedCapacity + insertAssumeCapacity
                                diffs.insert(0, Diff {
                                    operation: Operation::Equal,
                                    text: dupe(&text_insert[0..common_length]),
                                });
                                pointer += 1;
                            }
                            text_insert.drain(0..common_length);
                            text_delete.drain(0..common_length);
                        }
                        // Factor out any common suffixies.
                        // @ZigPort this seems very wrong
                        common_length = diff_common_suffix(&text_insert, &text_delete);
                        if common_length != 0 {
                            diffs[pointer].text = concat(&[
                                &text_insert[text_insert.len() - common_length..],
                                &diffs[pointer].text,
                            ]);
                            text_insert.truncate(text_insert.len() - common_length);
                            text_delete.truncate(text_delete.len() - common_length);
                        }
                    }
                    // Delete the offending records and add the merged ones.
                    pointer -= count_delete + count_insert;
                    if count_delete + count_insert > 0 {
                        // PORT NOTE: freeRangeDiffList + replaceRangeAssumeCapacity → drain
                        diffs.drain(pointer..pointer + count_delete + count_insert);
                    }

                    if !text_delete.is_empty() {
                        // PERF(port): was ensureUnusedCapacity + insertAssumeCapacity
                        diffs.insert(pointer, Diff {
                            operation: Operation::Delete,
                            text: dupe(&text_delete),
                        });
                        pointer += 1;
                    }
                    if !text_insert.is_empty() {
                        // PERF(port): was ensureUnusedCapacity + insertAssumeCapacity
                        diffs.insert(pointer, Diff {
                            operation: Operation::Insert,
                            text: dupe(&text_insert),
                        });
                        pointer += 1;
                    }
                    pointer += 1;
                } else if pointer != 0 && diffs[pointer - 1].operation == Operation::Equal {
                    // Merge this equality with the previous one.
                    // TODO: Fix using realloc or smth
                    // Note: can't use realloc because the text is const
                    let mut nt: Vec<Unit> =
                        Vec::with_capacity(diffs[pointer - 1].text.len() + diffs[pointer].text.len());
                    nt.extend_from_slice(&diffs[pointer - 1].text);
                    nt.extend_from_slice(&diffs[pointer].text);
                    diffs[pointer - 1].text = nt.into_boxed_slice();
                    let _dead_diff = diffs.remove(pointer);
                } else {
                    pointer += 1;
                }
                count_insert = 0;
                count_delete = 0;
                text_delete.clear();
                text_insert.clear();
            }
        }
    }
    if diffs[diffs.len() - 1].text.is_empty() {
        diffs.truncate(diffs.len() - 1);
    }

    // Second pass: look for single edits surrounded on both sides by
    // equalities which can be shifted sideways to eliminate an equality.
    // e.g: A<ins>BA</ins>C -> <ins>AB</ins>AC
    let mut changes = false;
    pointer = 1;
    // Intentionally ignore the first and last element (don't need checking).
    while pointer + 1 < diffs.len() {
        if diffs[pointer - 1].operation == Operation::Equal
            && diffs[pointer + 1].operation == Operation::Equal
        {
            // This is a single edit surrounded by equalities.
            if ends_with(&diffs[pointer].text, &diffs[pointer - 1].text) {
                let prev_len = diffs[pointer - 1].text.len();
                let pt = concat(&[
                    &diffs[pointer - 1].text,
                    &diffs[pointer].text[0..diffs[pointer].text.len() - prev_len],
                ]);
                diffs[pointer].text = pt;
                let p1t = concat(&[&diffs[pointer - 1].text, &diffs[pointer + 1].text]);
                diffs[pointer + 1].text = p1t;
                // PORT NOTE: freeRangeDiffList + replaceRangeAssumeCapacity → remove
                diffs.remove(pointer - 1);
                changes = true;
            } else if starts_with(&diffs[pointer].text, &diffs[pointer + 1].text) {
                let pm1t = concat(&[&diffs[pointer - 1].text, &diffs[pointer + 1].text]);
                diffs[pointer - 1].text = pm1t;
                let next_len = diffs[pointer + 1].text.len();
                let pt = concat(&[
                    &diffs[pointer].text[next_len..],
                    &diffs[pointer + 1].text,
                ]);
                diffs[pointer].text = pt;
                // PORT NOTE: freeRangeDiffList + replaceRangeAssumeCapacity → remove
                diffs.remove(pointer + 1);
                changes = true;
            }
        }
        pointer += 1;
    }
    // If shifts were made, the diff needs reordering and another shift sweep.
    if changes {
        diff_cleanup_merge(diffs)?;
    }
    Ok(())
}

/// Reduce the number of edits by eliminating semantically trivial
/// equalities.
/// @param diffs List of Diff objects.
pub fn diff_cleanup_semantic<Unit: DiffUnit>(diffs: &mut DiffList<Unit>) -> Result<(), DiffError> {
    let mut changes = false;
    // Stack of indices where equalities are found.
    let mut equalities: Vec<isize> = Vec::new();
    // Always equal to equalities[equalitiesLength-1][1]
    // PORT NOTE: reshaped for borrowck — owned copy of last_equality
    let mut last_equality: Option<Box<[Unit]>> = None;
    let mut pointer: isize = 0; // Index of current position.
    // Number of characters that changed prior to the equality.
    let mut length_insertions1: usize = 0;
    let mut length_deletions1: usize = 0;
    // Number of characters that changed after the equality.
    let mut length_insertions2: usize = 0;
    let mut length_deletions2: usize = 0;
    while usize::try_from(pointer).unwrap() < diffs.len() {
        let p = usize::try_from(pointer).unwrap();
        if diffs[p].operation == Operation::Equal {
            // Equality found.
            equalities.push(pointer);
            length_insertions1 = length_insertions2;
            length_deletions1 = length_deletions2;
            length_insertions2 = 0;
            length_deletions2 = 0;
            last_equality = Some(dupe(&diffs[p].text));
        } else {
            // an insertion or deletion
            if diffs[p].operation == Operation::Insert {
                length_insertions2 += diffs[p].text.len();
            } else {
                length_deletions2 += diffs[p].text.len();
            }
            // Eliminate an equality that is smaller or equal to the edits on both
            // sides of it.
            if let Some(le) = &last_equality {
                if le.len() <= length_insertions1.max(length_deletions1)
                    && le.len() <= length_insertions2.max(length_deletions2)
                {
                    let eq_idx = usize::try_from(equalities[equalities.len() - 1]).unwrap();
                    // Duplicate record.
                    // PERF(port): was ensureUnusedCapacity + insertAssumeCapacity
                    diffs.insert(eq_idx, Diff {
                        operation: Operation::Delete,
                        text: dupe(le),
                    });
                    // Change second copy to insert.
                    diffs[eq_idx + 1].operation = Operation::Insert;
                    // Throw away the equality we just deleted.
                    equalities.pop();
                    if !equalities.is_empty() {
                        equalities.pop();
                    }
                    pointer = if !equalities.is_empty() {
                        equalities[equalities.len() - 1]
                    } else {
                        -1
                    };
                    length_insertions1 = 0; // Reset the counters.
                    length_deletions1 = 0;
                    length_insertions2 = 0;
                    length_deletions2 = 0;
                    last_equality = None;
                    changes = true;
                }
            }
        }
        pointer += 1;
    }

    // Normalize the diff.
    if changes {
        diff_cleanup_merge(diffs)?;
    }
    diff_cleanup_semantic_lossless(diffs)?;

    // Find any overlaps between deletions and insertions.
    // e.g: <del>abcxxx</del><ins>xxxdef</ins>
    //   -> <del>abc</del>xxx<ins>def</ins>
    // e.g: <del>xxxabc</del><ins>defxxx</ins>
    //   -> <ins>def</ins>xxx<del>abc</del>
    // Only extract an overlap if it is as big as the edit ahead or behind it.
    pointer = 1;
    while usize::try_from(pointer).unwrap() < diffs.len() {
        let p = usize::try_from(pointer).unwrap();
        if diffs[p - 1].operation == Operation::Delete && diffs[p].operation == Operation::Insert {
            // PORT NOTE: reshaped for borrowck — take owned copies of deletion/insertion
            let deletion: Box<[Unit]> = core::mem::take(&mut diffs[p - 1].text);
            let insertion: Box<[Unit]> = core::mem::take(&mut diffs[p].text);
            let overlap_length1: usize = diff_common_overlap(&deletion, &insertion);
            let overlap_length2: usize = diff_common_overlap(&insertion, &deletion);
            if overlap_length1 >= overlap_length2 {
                if overlap_length1 as f32 >= deletion.len() as f32 / 2.0
                    || overlap_length1 as f32 >= insertion.len() as f32 / 2.0
                {
                    // Overlap found.
                    // Insert an equality and trim the surrounding edits.
                    // PERF(port): was ensureUnusedCapacity + insertAssumeCapacity
                    diffs.insert(p, Diff {
                        operation: Operation::Equal,
                        text: dupe(&insertion[0..overlap_length1]),
                    });
                    diffs[p - 1].text = dupe(&deletion[0..deletion.len() - overlap_length1]);
                    diffs[p + 1].text = dupe(&insertion[overlap_length1..]);
                    pointer += 1;
                } else {
                    // PORT NOTE: restore taken values (no-op in Zig).
                    diffs[p - 1].text = deletion;
                    diffs[p].text = insertion;
                }
            } else {
                if overlap_length2 as f32 >= deletion.len() as f32 / 2.0
                    || overlap_length2 as f32 >= insertion.len() as f32 / 2.0
                {
                    // Reverse overlap found.
                    // Insert an equality and swap and trim the surrounding edits.
                    // PERF(port): was ensureUnusedCapacity + insertAssumeCapacity
                    diffs.insert(p, Diff {
                        operation: Operation::Equal,
                        text: dupe(&deletion[0..overlap_length2]),
                    });
                    let new_minus = dupe(&insertion[0..insertion.len() - overlap_length2]);
                    let new_plus = dupe(&deletion[overlap_length2..]);
                    diffs[p - 1].operation = Operation::Insert;
                    diffs[p - 1].text = new_minus;
                    diffs[p + 1].operation = Operation::Delete;
                    diffs[p + 1].text = new_plus;
                    pointer += 1;
                } else {
                    // PORT NOTE: restore taken values (no-op in Zig).
                    diffs[p - 1].text = deletion;
                    diffs[p].text = insertion;
                }
            }
            pointer += 1;
        }
        pointer += 1;
    }
    Ok(())
}

/// Look for single edits surrounded on both sides by equalities
/// which can be shifted sideways to align the edit to a word boundary.
/// e.g: The c<ins>at c</ins>ame. -> The <ins>cat </ins>came.
pub fn diff_cleanup_semantic_lossless<Unit: DiffUnit>(
    diffs: &mut DiffList<Unit>,
) -> Result<(), DiffError> {
    let mut pointer: usize = 1;
    // Intentionally ignore the first and last element (don't need checking).
    while isize::try_from(pointer).unwrap() < isize::try_from(diffs.len()).unwrap() - 1 {
        if diffs[pointer - 1].operation == Operation::Equal
            && diffs[pointer + 1].operation == Operation::Equal
        {
            // This is a single edit surrounded by equalities.
            let mut equality_1: Vec<Unit> = Vec::new();
            equality_1.extend_from_slice(&diffs[pointer - 1].text);

            let mut edit: Vec<Unit> = Vec::new();
            edit.extend_from_slice(&diffs[pointer].text);

            let mut equality_2: Vec<Unit> = Vec::new();
            equality_2.extend_from_slice(&diffs[pointer + 1].text);

            // First, shift the edit as far left as possible.
            let common_offset = diff_common_suffix(&equality_1, &edit);
            if common_offset > 0 {
                // TODO: Use buffer
                let common_string: Box<[Unit]> = dupe(&edit[edit.len() - common_offset..]);

                equality_1.truncate(equality_1.len() - common_offset);

                // edit.items.len = edit.items.len - common_offset;
                let not_common: Box<[Unit]> = dupe(&edit[0..edit.len() - common_offset]);

                edit.clear();
                edit.extend_from_slice(&common_string);
                edit.extend_from_slice(&not_common);

                // Zig: equality_2.insertSlice(0, common_string)
                equality_2.splice(0..0, common_string.iter().copied());
            }

            // Second, step character by character right,
            // looking for the best fit.
            let mut best_equality_1: Vec<Unit> = equality_1.clone();
            let mut best_edit: Vec<Unit> = edit.clone();
            let mut best_equality_2: Vec<Unit> = equality_2.clone();

            let mut best_score = diff_cleanup_semantic_score(&equality_1, &edit)
                + diff_cleanup_semantic_score(&edit, &equality_2);

            while !edit.is_empty() && !equality_2.is_empty() && edit[0] == equality_2[0] {
                equality_1.push(edit[0]);

                edit.remove(0);
                edit.push(equality_2[0]);

                equality_2.remove(0);

                let score = diff_cleanup_semantic_score(&equality_1, &edit)
                    + diff_cleanup_semantic_score(&edit, &equality_2);
                // The >= encourages trailing rather than leading whitespace on
                // edits.
                if score >= best_score {
                    best_score = score;

                    best_equality_1.clear();
                    best_equality_1.extend_from_slice(&equality_1);

                    best_edit.clear();
                    best_edit.extend_from_slice(&edit);

                    best_equality_2.clear();
                    best_equality_2.extend_from_slice(&equality_2);
                }
            }

            if diffs[pointer - 1].text[..] != best_equality_1[..] {
                // We have an improvement, save it back to the diff.
                if !best_equality_1.is_empty() {
                    diffs[pointer - 1].text = dupe(&best_equality_1);
                } else {
                    let _old_diff = diffs.remove(pointer - 1);
                    pointer -= 1;
                }
                diffs[pointer].text = dupe(&best_edit);
                if !best_equality_2.is_empty() {
                    diffs[pointer + 1].text = dupe(&best_equality_2);
                } else {
                    let _old_diff = diffs.remove(pointer + 1);
                    pointer -= 1;
                }
            }
        }
        pointer += 1;
    }
    Ok(())
}

/// Given two strings, compute a score representing whether the internal
/// boundary falls on logical boundaries.
/// Scores range from 6 (best) to 0 (worst).
/// @param one First string.
/// @param two Second string.
/// @return The score.
fn diff_cleanup_semantic_score<Unit: DiffUnit>(one: &[Unit], two: &[Unit]) -> usize {
    if one.is_empty() || two.is_empty() {
        // Edges are the best.
        return 6;
    }

    // TODO(port): comptime `if (Unit != u8) return 5;` → runtime TypeId check.
    if TypeId::of::<Unit>() != TypeId::of::<u8>() {
        return 5;
    }
    // SAFETY: Unit == u8 verified above; layout-identical reinterpret.
    let one: &[u8] = unsafe { core::slice::from_raw_parts(one.as_ptr() as *const u8, one.len()) };
    let two: &[u8] = unsafe { core::slice::from_raw_parts(two.as_ptr() as *const u8, two.len()) };

    // Each port of this function behaves slightly differently due to
    // subtle differences in each language's definition of things like
    // 'whitespace'.  Since this function's purpose is largely cosmetic,
    // the choice has been made to use each language's native features
    // rather than force total conformity.
    let char1 = one[one.len() - 1];
    let char2 = two[0];
    let non_alpha_numeric1 = !char1.is_ascii_alphanumeric();
    let non_alpha_numeric2 = !char2.is_ascii_alphanumeric();
    let whitespace1 = non_alpha_numeric1 && char1.is_ascii_whitespace();
    let whitespace2 = non_alpha_numeric2 && char2.is_ascii_whitespace();
    let line_break1 = whitespace1 && char1.is_ascii_control();
    let line_break2 = whitespace2 && char2.is_ascii_control();
    let blank_line1 = line_break1 &&
        // BLANKLINEEND.IsMatch(one);
        (one.ends_with(b"\n\n") || one.ends_with(b"\n\r\n"));
    let blank_line2 = line_break2 &&
        // BLANKLINESTART.IsMatch(two);
        (two.starts_with(b"\n\n")
            || two.starts_with(b"\r\n\n")
            || two.starts_with(b"\n\r\n")
            || two.starts_with(b"\r\n\r\n"));

    if blank_line1 || blank_line2 {
        // Five points for blank lines.
        5
    } else if line_break1 || line_break2 {
        // Four points for line breaks.
        4
    } else if non_alpha_numeric1 && !whitespace1 && whitespace2 {
        // Three points for end of sentences.
        3
    } else if whitespace1 || whitespace2 {
        // Two points for whitespace.
        2
    } else if non_alpha_numeric1 || non_alpha_numeric2 {
        // One point for non-alphanumeric.
        1
    } else {
        0
    }
}

/// Determine if the suffix of one string is the prefix of another.
/// @param text1 First string.
/// @param text2 Second string.
/// @return The number of characters common to the end of the first
///     string and the start of the second string.
fn diff_common_overlap<Unit: DiffUnit>(text1_in: &[Unit], text2_in: &[Unit]) -> usize {
    let mut text1 = text1_in;
    let mut text2 = text2_in;

    // Cache the text lengths to prevent multiple calls.
    let text1_length = text1.len();
    let text2_length = text2.len();
    // Eliminate the null case.
    if text1_length == 0 || text2_length == 0 {
        return 0;
    }
    // Truncate the longer string.
    if text1_length > text2_length {
        text1 = &text1[text1_length - text2_length..];
    } else if text1_length < text2_length {
        text2 = &text2[0..text1_length];
    }
    let text_length = text1_length.min(text2_length);
    // Quick check for the worst case.
    if text1 == text2 {
        return text_length;
    }

    // Start by looking for a single character match
    // and increase length until no match is found.
    // Performance analysis: https://neil.fraser.name/news/2010/11/04/
    let mut best: usize = 0;
    let mut length: usize = 1;
    loop {
        let pattern = &text1[text_length - length..];
        let found = match index_of(text2, pattern) {
            Some(f) => f,
            None => return best,
        };

        length += found;

        if found == 0 || text1[text_length - length..] == text2[0..length] {
            best = length;
            length += 1;
        }
    }
}

// ───────────────────────── helpers ─────────────────────────

#[inline]
fn dupe<T: Copy>(s: &[T]) -> Box<[T]> {
    Box::<[T]>::from(s)
}

fn concat<T: Copy>(parts: &[&[T]]) -> Box<[T]> {
    let len: usize = parts.iter().map(|p| p.len()).sum();
    let mut v: Vec<T> = Vec::with_capacity(len);
    for p in parts {
        v.extend_from_slice(p);
    }
    v.into_boxed_slice()
}

fn index_of_diff<T: Eq>(a: &[T], b: &[T]) -> Option<usize> {
    let shortest = a.len().min(b.len());
    for index in 0..shortest {
        if a[index] != b[index] {
            return Some(index);
        }
    }
    if a.len() == b.len() { None } else { Some(shortest) }
}

fn diff_common_prefix<Unit: DiffUnit>(before: &[Unit], after: &[Unit]) -> usize {
    index_of_diff(before, after).unwrap_or_else(|| before.len().min(after.len()))
}

fn diff_common_suffix<Unit: DiffUnit>(before: &[Unit], after: &[Unit]) -> usize {
    let n = before.len().min(after.len());
    let mut i: usize = 1;

    while i <= n {
        if before[before.len() - i] != after[after.len() - i] {
            return i - 1;
        }
        i += 1;
    }

    n
}

/// Generic substring search (Zig `std.mem.indexOf(Unit, ...)`).
fn index_of<T: Eq>(haystack: &[T], needle: &[T]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    if needle.len() > haystack.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[inline]
fn starts_with<T: Eq>(s: &[T], prefix: &[T]) -> bool {
    s.len() >= prefix.len() && &s[..prefix.len()] == prefix
}

#[inline]
fn ends_with<T: Eq>(s: &[T], suffix: &[T]) -> bool {
    s.len() >= suffix.len() && &s[s.len() - suffix.len()..] == suffix
}

// TODO(port): replace with bun_core time source. `std::time` not on the I/O ban list.
fn milli_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap())
        .unwrap_or(0)
}

// DONE [✅]: Allocate all text in diffs to
// not cause segfault while freeing

// ───────────────────────── tests ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    type Dmp = DiffMatchPatch<u8>;

    fn d(op: Operation, text: &[u8]) -> Diff<u8> {
        Diff { operation: op, text: dupe(text) }
    }

    #[test]
    fn test_diff_eql() {
        let equal_a = d(Operation::Equal, b"a");
        let insert_a = d(Operation::Insert, b"a");
        let equal_b = d(Operation::Equal, b"b");
        let delete_b = d(Operation::Delete, b"b");

        assert!(equal_a.eql(&equal_a));
        assert!(!insert_a.eql(&equal_a));
        assert!(!equal_a.eql(&equal_b));
        assert!(!equal_a.eql(&delete_b));
    }

    #[test]
    fn test_diff_common_prefix() {
        // Detect any common suffix.
        assert_eq!(0usize, diff_common_prefix::<u8>(b"abc", b"xyz")); // Null case
        assert_eq!(4usize, diff_common_prefix::<u8>(b"1234abcdef", b"1234xyz")); // Non-null case
        assert_eq!(4usize, diff_common_prefix::<u8>(b"1234", b"1234xyz")); // Whole case
    }

    #[test]
    fn test_diff_common_suffix() {
        // Detect any common suffix.
        assert_eq!(0usize, diff_common_suffix::<u8>(b"abc", b"xyz")); // Null case
        assert_eq!(4usize, diff_common_suffix::<u8>(b"abcdef1234", b"xyz1234")); // Non-null case
        assert_eq!(4usize, diff_common_suffix::<u8>(b"1234", b"xyz1234")); // Whole case
    }

    #[test]
    fn test_diff_common_overlap() {
        // Detect any suffix/prefix overlap.
        assert_eq!(0usize, diff_common_overlap::<u8>(b"", b"abcd")); // Null case
        assert_eq!(3usize, diff_common_overlap::<u8>(b"abc", b"abcd")); // Whole case
        assert_eq!(0usize, diff_common_overlap::<u8>(b"123456", b"abcd")); // No overlap
        assert_eq!(3usize, diff_common_overlap::<u8>(b"123456xxx", b"xxxabcd")); // Overlap

        // Some overly clever languages (C#) may treat ligatures as equal to their
        // component letters.  E.g. U+FB01 == 'fi'
        assert_eq!(0usize, diff_common_overlap::<u8>(b"fi", "\u{fb01}".as_bytes())); // Unicode
    }

    // TODO(port): the Zig source has ~1400 lines of additional tests for
    // diffHalfMatch, diffLinesToChars, diffCharsToLines, diffCleanupMerge,
    // diffCleanupSemanticLossless, rebuildtexts, diffBisect, diff,
    // diffLineMode, diffCleanupSemantic, diffCleanupEfficiency. They were
    // wrapped in `checkAllAllocationFailures` (Zig OOM-injection harness)
    // which has no Rust equivalent (global allocator aborts on OOM). Port
    // the assertions directly in Phase B; the test data is preserved in the
    // .zig source.

    fn rebuildtexts(diffs: &DiffList<u8>) -> [Box<[u8]>; 2] {
        let mut text: [Vec<u8>; 2] = [Vec::new(), Vec::new()];
        for my_diff in diffs.iter() {
            if my_diff.operation != Operation::Insert {
                text[0].extend_from_slice(&my_diff.text);
            }
            if my_diff.operation != Operation::Delete {
                text[1].extend_from_slice(&my_diff.text);
            }
        }
        [text[0].clone().into_boxed_slice(), text[1].clone().into_boxed_slice()]
    }

    #[test]
    fn test_diff_bisect() {
        let this = Dmp::new(Config { diff_timeout: 0, ..Config::default() });

        let a = b"cat";
        let b = b"map";

        // Normal
        let diffs = this.diff_bisect(a, b, u64::MAX).unwrap();
        let expected = vec![
            d(Operation::Delete, b"c"),
            d(Operation::Insert, b"m"),
            d(Operation::Equal, b"a"),
            d(Operation::Delete, b"t"),
            d(Operation::Insert, b"p"),
        ];
        assert_eq!(expected, diffs);

        // Timeout
        let diffs = this.diff_bisect(a, b, 0).unwrap();
        let expected = vec![
            d(Operation::Delete, b"cat"),
            d(Operation::Insert, b"map"),
        ];
        assert_eq!(expected, diffs);
    }

    #[test]
    fn test_diff_half_match_leak_regression() {
        let dmp = Dmp::DEFAULT;
        let text1 = b"The quick brown fox jumps over the lazy dog.";
        let text2 = b"That quick brown fox jumped over a lazy dog.";
        let _diffs = dmp.diff(text2, text1, true).unwrap();
    }

    #[test]
    fn test_diff_basic() {
        let this = Dmp::new(Config { diff_timeout: 0, ..Config::default() });

        // Null case.
        let diffs = this.diff(b"", b"", false).unwrap();
        assert!(diffs.is_empty());

        // Equality.
        let diffs = this.diff(b"abc", b"abc", false).unwrap();
        assert_eq!(vec![d(Operation::Equal, b"abc")], diffs);

        // Simple insertion.
        let diffs = this.diff(b"abc", b"ab123c", false).unwrap();
        assert_eq!(
            vec![
                d(Operation::Equal, b"ab"),
                d(Operation::Insert, b"123"),
                d(Operation::Equal, b"c"),
            ],
            diffs
        );
    }

    // TODO(port): `checkAllAllocationFailures` / `CheckAllAllocationFailuresTuples`
    // are Zig comptime-reflection helpers wrapping `std.testing.checkAllAllocationFailures`.
    // Rust's global allocator aborts on OOM; there is no analogous fallible-alloc
    // injection harness in this codebase. Dropped.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/diff/diff_match_patch.zig (2994 lines)
//   confidence: medium
//   todos:      10
//   notes:      `Diff.text` retyped to `Box<[Unit]>`; `last_equality`/overlap branches reshaped for borrowck; u8-only paths gated by TypeId; `LinesToCharsResult.line_array` raw-ptr (no struct lifetimes in Phase A); bisect inner loops keep bare `as` (PERF(port): @intCast); ~1400 lines of OOM-injection tests stubbed (no Rust equivalent for `checkAllAllocationFailures`).
// ──────────────────────────────────────────────────────────────────────────

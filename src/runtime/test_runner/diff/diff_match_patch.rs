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

use bun_alloc::AllocError;
use bun_collections::StringHashMap;

#[derive(Clone, Copy)]
pub struct Config {
    /// Number of milliseconds to map a diff before giving up (0 for infinity).
    pub diff_timeout: u64,
    /// Number of bytes in each string needed to trigger a line-based diff
    pub diff_check_lines_over: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            diff_timeout: 1000,
            diff_check_lines_over: 100,
        }
    }
}

/// Marker trait for the element type a diff operates over (`u8` or `usize`).
/// `Pod` lets the `Unit == u8` fast paths reinterpret `&[Unit]` as `&[u8]`
/// via `bytemuck::cast_slice` instead of raw `from_raw_parts`.
pub(crate) trait DiffUnit: Copy + Eq + bytemuck::Pod + 'static {}
impl DiffUnit for u8 {}
impl DiffUnit for usize {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Operation {
    Insert,
    Delete,
    Equal,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct Diff<Unit: DiffUnit> {
    pub operation: Operation,
    pub text: Box<[Unit]>,
}

#[derive(Clone, Copy)]
pub(crate) struct DiffMatchPatch<Unit: DiffUnit> {
    pub config: Config,
    _unit: core::marker::PhantomData<Unit>,
}

pub(crate) type DiffList<Unit> = Vec<Diff<Unit>>;

pub(crate) type DiffError = AllocError;

pub(crate) type DmpUsize = DiffMatchPatch<usize>;

impl<Unit: DiffUnit> Default for DiffMatchPatch<Unit> {
    fn default() -> Self {
        Self {
            config: Config::default(),
            _unit: core::marker::PhantomData,
        }
    }
}

impl<Unit: DiffUnit> DiffMatchPatch<Unit> {
    /// Find the differences between two texts.
    /// @param before Old string to be diffed.
    /// @param after New string to be diffed.
    /// @param checklines Speedup flag.  If false, then don't run a
    ///     line-level diff first to identify the changed areas.
    ///     If true, then run a faster slightly less optimal diff.
    /// @return List of Diff objects.
    pub(crate) fn diff(
        &self,
        before: &[Unit],
        after: &[Unit],
        // If false, then don't run a line-level diff first
        // to identify the changed areas. If true, then run
        // a faster slightly less optimal diff.
        check_lines: bool,
    ) -> Result<DiffList<Unit>, DiffError> {
        let deadline = if self.config.diff_timeout == 0 {
            u64::MAX
        } else {
            milli_timestamp() + self.config.diff_timeout
        };
        self.diff_internal(before, after, check_lines, deadline)
    }

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
            diffs.insert(
                0,
                Diff {
                    operation: Operation::Equal,
                    text: dupe(common_prefix),
                },
            );
        }
        if !common_suffix.is_empty() {
            diffs.reserve(1);
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
            return Ok(vec![Diff {
                operation: Operation::Insert,
                text: dupe(after),
            }]);
        }

        if after.is_empty() {
            // Just delete some text (speedup).
            return Ok(vec![Diff {
                operation: Operation::Delete,
                text: dupe(before),
            }]);
        }

        let long_text = if before.len() > after.len() {
            before
        } else {
            after
        };
        let short_text = if before.len() > after.len() {
            after
        } else {
            before
        };

        if let Some(index) = bun_core::index_of_t(long_text, short_text) {
            let mut diffs: DiffList<Unit> = Vec::with_capacity(3);
            // Shorter text is inside the longer text (speedup).
            let op: Operation = if before.len() > after.len() {
                Operation::Delete
            } else {
                Operation::Insert
            };
            diffs.push(Diff {
                operation: op,
                text: dupe(&long_text[0..index]),
            });
            diffs.push(Diff {
                operation: Operation::Equal,
                text: dupe(short_text),
            });
            diffs.push(Diff {
                operation: op,
                text: dupe(&long_text[index + short_text.len()..]),
            });
            return Ok(diffs);
        }

        if short_text.len() == 1 {
            // Single character string.
            // After the previous speedup, the character can't be an equality.
            return Ok(vec![
                Diff {
                    operation: Operation::Delete,
                    text: dupe(before),
                },
                Diff {
                    operation: Operation::Insert,
                    text: dupe(after),
                },
            ]);
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
        let long_text = if before.len() > after.len() {
            before
        } else {
            after
        };
        let short_text = if before.len() > after.len() {
            after
        } else {
            before
        };

        if long_text.len() < 4 || short_text.len() * 2 < long_text.len() {
            return Ok(None); // Pointless.
        }

        // First check if the second quarter is the seed for a half-match.
        let half_match_1 =
            self.diff_half_match_internal(long_text, short_text, long_text.len().div_ceil(4))?;
        // Check again based on the third quarter.
        let half_match_2 =
            self.diff_half_match_internal(long_text, short_text, long_text.len().div_ceil(2))?;

        let half_match: HalfMatchResult<Unit> = match (half_match_1, half_match_2) {
            (None, None) => return Ok(None),
            (Some(hm1), None) => hm1,
            (None, Some(hm2)) => hm2,
            (Some(hm1), Some(hm2)) => {
                // Both matched. Select the longest.
                if hm1.common_middle.len() > hm2.common_middle.len() {
                    hm1
                } else {
                    hm2
                }
            }
        };

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

        while (j as i128) < i128::try_from(short_text.len()).unwrap() && {
            match bun_core::index_of_t(&short_text[usize::try_from(j + 1).unwrap()..], seed) {
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
        let max_d: isize = isize::try_from((before.len() + after.len()).div_ceil(2)).unwrap();
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
            // Bare `as usize` kept for v1/v2/before/after indexing
            // in this hot Myers inner loop.
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
            // Bare `as usize` kept for v1/v2/before/after indexing
            // in this hot Myers inner loop.
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
        Ok(vec![
            Diff {
                operation: Operation::Delete,
                text: dupe(before),
            },
            Diff {
                operation: Operation::Insert,
                text: dupe(after),
            },
        ])
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
        let dmp_usize = DmpUsize {
            config: self.config,
            _unit: core::marker::PhantomData,
        };
        {
            let char_diffs: DiffList<usize> =
                dmp_usize.diff_internal(text1, text2, false, deadline)?;
            // Convert the diff back to original text.
            diffs = diff_chars_to_lines(&char_diffs, line_array)?;
            // Eliminate freak matches (e.g. blank lines)
        }
        diff_cleanup_semantic(&mut diffs)?;

        // Rediff any replacement blocks, this time character-by-character.
        // Add a dummy entry at the end.
        diffs.push(Diff {
            operation: Operation::Equal,
            text: Box::default(),
        });

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
                        diffs.drain(
                            pointer - count_delete - count_insert
                                ..pointer - count_delete - count_insert
                                    + count_delete
                                    + count_insert,
                        );
                        pointer = pointer - count_delete - count_insert;
                        let sub_diff =
                            self.diff_internal(&text_delete, &text_insert, false, deadline)?;
                        let sub_len = sub_diff.len();
                        diffs.splice(pointer..pointer, sub_diff);
                        pointer += sub_len;
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
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct HalfMatchResult<Unit: DiffUnit> {
    pub prefix_before: Box<[Unit]>,
    pub suffix_before: Box<[Unit]>,
    pub prefix_after: Box<[Unit]>,
    pub suffix_after: Box<[Unit]>,
    pub common_middle: Box<[Unit]>,
}
// `deinit` → Drop handles `Box<[Unit]>` fields automatically.

pub(crate) struct LinesToCharsResult<'a, Unit: DiffUnit> {
    pub chars_1: Box<[usize]>,
    pub chars_2: Box<[usize]>,
    /// Borrows line slices from the input texts.
    pub line_array: Vec<&'a [Unit]>,
}
// `deinit` → Drop handles all fields automatically.

/// Split two texts into a list of strings.  Reduce the texts to a string of
/// hashes where each Unicode character represents one line.
/// @param text1 First string.
/// @param text2 Second string.
/// @return Three element Object array, containing the encoded text1, the
///     encoded text2 and the List of unique strings.  The zeroth element
///     of the List of unique strings is intentionally blank.
pub(crate) fn diff_lines_to_chars<'a, Unit: DiffUnit>(
    text1: &'a [Unit],
    text2: &'a [Unit],
) -> Result<LinesToCharsResult<'a, Unit>, DiffError> {
    let mut line_array: Vec<&'a [Unit]> = Vec::new();
    // `bun_collections::StringHashMap` copies each key into an owned
    // `Box<[u8]>` (one allocation per unique line).
    let mut line_hash: StringHashMap<usize> = StringHashMap::default();
    // e.g. line_array[4] == "Hello\n"
    // e.g. line_hash.get("Hello\n") == 4

    // "\x00" is a valid character, but various debuggers don't like it.
    // So we'll insert a junk entry to avoid generating a null character.
    line_array.push(&[]);

    // Allocate 2/3rds of the space for text1, the rest for text2.
    let chars1 = diff_lines_to_chars_munge(text1, &mut line_array, &mut line_hash)?;
    let chars2 = diff_lines_to_chars_munge(text2, &mut line_array, &mut line_hash)?;
    Ok(LinesToCharsResult {
        chars_1: chars1,
        chars_2: chars2,
        line_array,
    })
}

/// Split a text into a list of strings.  Reduce the texts to a string of
/// hashes where each Unicode character represents one line.
/// @param text String to encode.
/// @param lineArray List of unique strings.
/// @param lineHash Map of strings to indices.
/// @param maxLines Maximum length of lineArray.
/// @return Encoded string.
fn diff_lines_to_chars_munge<'a, Unit: DiffUnit>(
    text: &'a [Unit],
    line_array: &mut Vec<&'a [Unit]>,
    line_hash: &mut StringHashMap<usize>,
) -> Result<Box<[usize]>, DiffError> {
    if TypeId::of::<Unit>() != TypeId::of::<u8>() {
        panic!("Unit must be u8");
    }
    // Unit == u8 verified above; bytemuck statically checks the layout.
    let text_u8: &[u8] = bytemuck::cast_slice::<Unit, u8>(text);

    let mut line_start: isize = 0;
    let mut line_end: isize = -1;
    let mut chars: Vec<usize> = Vec::new();
    // Walk the text, pulling out a Substring for each line.
    // TODO this can be handled with a Reader, avoiding all the manual splitting
    while line_end < isize::try_from(text.len()).unwrap() - 1 {
        line_end = 'b: {
            match bun_core::index_of_t(&text_u8[usize::try_from(line_start).unwrap()..], b"\n") {
                Some(idx) => break 'b isize::try_from(idx).unwrap() + line_start,
                None => break 'b isize::try_from(text.len()).unwrap() - 1,
            }
        };
        let mut line = &text[usize::try_from(line_start).unwrap()
            ..usize::try_from(line_start + (line_end + 1 - line_start)).unwrap()];
        // Unit == u8 verified above; bytemuck statically checks the layout.
        let line_u8: &[u8] = bytemuck::cast_slice::<Unit, u8>(line);

        if let Some(&value) = line_hash.get(line_u8) {
            chars.push(value);
        } else {
            if line_array.len() == usize::MAX {
                line = &text[usize::try_from(line_start).unwrap()..];
                line_end = isize::try_from(text.len()).unwrap();
            }
            line_array.push(line);
            // Unit == u8 verified above; bytemuck statically checks the layout.
            let line_u8: &[u8] = bytemuck::cast_slice::<Unit, u8>(line);
            // `put_assume_capacity` copies the key into an owned `Box<[u8]>`.
            line_hash.put_assume_capacity(line_u8, line_array.len() - 1);
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
pub(crate) fn diff_chars_to_lines<Unit: DiffUnit>(
    char_diffs: &DiffList<usize>,
    line_array: &[&[Unit]],
) -> Result<DiffList<Unit>, DiffError> {
    let mut diffs: DiffList<Unit> = Vec::with_capacity(char_diffs.len());
    let mut text: Vec<Unit> = Vec::new();

    for d in char_diffs.iter() {
        let mut j: usize = 0;
        while j < d.text.len() {
            text.extend_from_slice(line_array[d.text[j]]);
            j += 1;
        }
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
pub(crate) fn diff_cleanup_merge<Unit: DiffUnit>(
    diffs: &mut DiffList<Unit>,
) -> Result<(), DiffError> {
    // Add a dummy entry at the end.
    diffs.push(Diff {
        operation: Operation::Equal,
        text: Box::default(),
    });
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
                                diffs.insert(
                                    0,
                                    Diff {
                                        operation: Operation::Equal,
                                        text: dupe(&text_insert[0..common_length]),
                                    },
                                );
                                pointer += 1;
                            }
                            text_insert.drain(0..common_length);
                            text_delete.drain(0..common_length);
                        }
                        // Factor out any common suffixies.
                        // TODO: this seems very wrong
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
                        diffs.drain(pointer..pointer + count_delete + count_insert);
                    }

                    if !text_delete.is_empty() {
                        diffs.insert(
                            pointer,
                            Diff {
                                operation: Operation::Delete,
                                text: dupe(&text_delete),
                            },
                        );
                        pointer += 1;
                    }
                    if !text_insert.is_empty() {
                        diffs.insert(
                            pointer,
                            Diff {
                                operation: Operation::Insert,
                                text: dupe(&text_insert),
                            },
                        );
                        pointer += 1;
                    }
                    pointer += 1;
                } else if pointer != 0 && diffs[pointer - 1].operation == Operation::Equal {
                    // Merge this equality with the previous one.
                    // TODO: Fix using realloc or smth
                    // Note: can't use realloc because the text is const
                    let mut nt: Vec<Unit> = Vec::with_capacity(
                        diffs[pointer - 1].text.len() + diffs[pointer].text.len(),
                    );
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
            if diffs[pointer].text.ends_with(&diffs[pointer - 1].text) {
                let prev_len = diffs[pointer - 1].text.len();
                let pt = concat(&[
                    &diffs[pointer - 1].text,
                    &diffs[pointer].text[0..diffs[pointer].text.len() - prev_len],
                ]);
                diffs[pointer].text = pt;
                let p1t = concat(&[&diffs[pointer - 1].text, &diffs[pointer + 1].text]);
                diffs[pointer + 1].text = p1t;
                diffs.remove(pointer - 1);
                changes = true;
            } else if diffs[pointer].text.starts_with(&diffs[pointer + 1].text) {
                let pm1t = concat(&[&diffs[pointer - 1].text, &diffs[pointer + 1].text]);
                diffs[pointer - 1].text = pm1t;
                let next_len = diffs[pointer + 1].text.len();
                let pt = concat(&[&diffs[pointer].text[next_len..], &diffs[pointer + 1].text]);
                diffs[pointer].text = pt;
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
pub(crate) fn diff_cleanup_semantic<Unit: DiffUnit>(
    diffs: &mut DiffList<Unit>,
) -> Result<(), DiffError> {
    let mut changes = false;
    // Stack of indices where equalities are found.
    let mut equalities: Vec<isize> = Vec::new();
    // Always equal to equalities[equalitiesLength-1][1]
    // reshaped for borrowck — owned copy of last_equality
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
                    diffs.insert(
                        eq_idx,
                        Diff {
                            operation: Operation::Delete,
                            text: dupe(le),
                        },
                    );
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
            // reshaped for borrowck — take owned copies of deletion/insertion
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
                    diffs.insert(
                        p,
                        Diff {
                            operation: Operation::Equal,
                            text: dupe(&insertion[0..overlap_length1]),
                        },
                    );
                    diffs[p - 1].text = dupe(&deletion[0..deletion.len() - overlap_length1]);
                    diffs[p + 1].text = dupe(&insertion[overlap_length1..]);
                    pointer += 1;
                } else {
                    // restore taken values.
                    diffs[p - 1].text = deletion;
                    diffs[p].text = insertion;
                }
            } else {
                if overlap_length2 as f32 >= deletion.len() as f32 / 2.0
                    || overlap_length2 as f32 >= insertion.len() as f32 / 2.0
                {
                    // Reverse overlap found.
                    // Insert an equality and swap and trim the surrounding edits.
                    diffs.insert(
                        p,
                        Diff {
                            operation: Operation::Equal,
                            text: dupe(&deletion[0..overlap_length2]),
                        },
                    );
                    let new_minus = dupe(&insertion[0..insertion.len() - overlap_length2]);
                    let new_plus = dupe(&deletion[overlap_length2..]);
                    diffs[p - 1].operation = Operation::Insert;
                    diffs[p - 1].text = new_minus;
                    diffs[p + 1].operation = Operation::Delete;
                    diffs[p + 1].text = new_plus;
                    pointer += 1;
                } else {
                    // restore taken values.
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
pub(crate) fn diff_cleanup_semantic_lossless<Unit: DiffUnit>(
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

    if TypeId::of::<Unit>() != TypeId::of::<u8>() {
        return 5;
    }
    // Unit == u8 verified above; bytemuck statically checks the layout.
    let one: &[u8] = bytemuck::cast_slice::<Unit, u8>(one);
    let two: &[u8] = bytemuck::cast_slice::<Unit, u8>(two);

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
        let found = match bun_core::index_of_t(text2, pattern) {
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
fn dupe<T: Clone>(s: &[T]) -> Box<[T]> {
    Box::<[T]>::from(s)
}

use bun_core::concat_boxed as concat;

fn index_of_diff<T: Eq>(a: &[T], b: &[T]) -> Option<usize> {
    let shortest = a.len().min(b.len());
    for index in 0..shortest {
        if a[index] != b[index] {
            return Some(index);
        }
    }
    if a.len() == b.len() {
        None
    } else {
        Some(shortest)
    }
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
        Diff {
            operation: op,
            text: dupe(text),
        }
    }

    fn dmp(config: Config) -> Dmp {
        Dmp {
            config,
            _unit: core::marker::PhantomData,
        }
    }

    /// Builds a `DiffList<u8>` from `(Operation variant, byte string)` pairs.
    macro_rules! diffs {
        ($(($op:ident, $text:expr)),* $(,)?) => {
            vec![$(d(Operation::$op, $text)),*]
        };
    }

    #[test]
    fn test_diff_eq() {
        let equal_a = d(Operation::Equal, b"a");
        let insert_a = d(Operation::Insert, b"a");
        let equal_b = d(Operation::Equal, b"b");
        let delete_b = d(Operation::Delete, b"b");

        assert_eq!(equal_a, d(Operation::Equal, b"a"));
        assert_ne!(insert_a, equal_a);
        assert_ne!(equal_a, equal_b);
        assert_ne!(equal_a, delete_b);
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
        assert_eq!(
            0usize,
            diff_common_overlap::<u8>(b"fi", "\u{fb01}".as_bytes())
        ); // Unicode
    }

    #[test]
    fn test_diff_bisect() {
        let this = dmp(Config {
            diff_timeout: 0,
            ..Config::default()
        });

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
        let expected = vec![d(Operation::Delete, b"cat"), d(Operation::Insert, b"map")];
        assert_eq!(expected, diffs);
    }

    #[test]
    fn test_diff_half_match_leak_regression() {
        let this = Dmp::default();
        let text1 = b"The quick brown fox jumps over the lazy dog.";
        let text2 = b"That quick brown fox jumped over a lazy dog.";
        let _diffs = this.diff(text2, text1, true).unwrap();
    }

    fn hm(
        prefix_before: &[u8],
        suffix_before: &[u8],
        prefix_after: &[u8],
        suffix_after: &[u8],
        common_middle: &[u8],
    ) -> Option<HalfMatchResult<u8>> {
        Some(HalfMatchResult {
            prefix_before: dupe(prefix_before),
            suffix_before: dupe(suffix_before),
            prefix_after: dupe(prefix_after),
            suffix_after: dupe(suffix_after),
            common_middle: dupe(common_middle),
        })
    }

    #[test]
    fn test_diff_half_match() {
        let one_timeout = dmp(Config {
            diff_timeout: 1,
            ..Config::default()
        });

        // No match #1
        assert_eq!(
            None,
            one_timeout
                .diff_half_match(b"1234567890", b"abcdef")
                .unwrap()
        );

        // No match #2
        assert_eq!(None, one_timeout.diff_half_match(b"12345", b"23").unwrap());

        // Single match #1
        assert_eq!(
            hm(b"12", b"90", b"a", b"z", b"345678"),
            one_timeout
                .diff_half_match(b"1234567890", b"a345678z")
                .unwrap()
        );

        // Single match #2
        assert_eq!(
            hm(b"a", b"z", b"12", b"90", b"345678"),
            one_timeout
                .diff_half_match(b"a345678z", b"1234567890")
                .unwrap()
        );

        // Single match #3
        assert_eq!(
            hm(b"abc", b"z", b"1234", b"0", b"56789"),
            one_timeout
                .diff_half_match(b"abc56789z", b"1234567890")
                .unwrap()
        );

        // Single match #4
        assert_eq!(
            hm(b"a", b"xyz", b"1", b"7890", b"23456"),
            one_timeout
                .diff_half_match(b"a23456xyz", b"1234567890")
                .unwrap()
        );

        // Multiple matches #1
        assert_eq!(
            hm(b"12123", b"123121", b"a", b"z", b"1234123451234"),
            one_timeout
                .diff_half_match(b"121231234123451234123121", b"a1234123451234z")
                .unwrap()
        );

        // Multiple matches #2
        assert_eq!(
            hm(b"", b"-=-=-=-=-=", b"x", b"", b"x-=-=-=-=-=-=-="),
            one_timeout
                .diff_half_match(b"x-=-=-=-=-=-=-=-=-=-=-=-=", b"xx-=-=-=-=-=-=-=")
                .unwrap()
        );

        // Multiple matches #3
        assert_eq!(
            hm(b"-=-=-=-=-=", b"", b"", b"y", b"-=-=-=-=-=-=-=y"),
            one_timeout
                .diff_half_match(b"-=-=-=-=-=-=-=-=-=-=-=-=y", b"-=-=-=-=-=-=-=yy")
                .unwrap()
        );

        // Optimal diff would be -q+x=H-i+e=lloHe+Hu=llo-Hew+y not
        // -qHillo+x=HelloHe-w+Hulloy
        // Non-optimal halfmatch
        assert_eq!(
            hm(b"qHillo", b"w", b"x", b"Hulloy", b"HelloHe"),
            one_timeout
                .diff_half_match(b"qHilloHelloHew", b"xHelloHeHulloy")
                .unwrap()
        );

        // Non-optimal halfmatch with unlimited time
        let no_timeout = dmp(Config {
            diff_timeout: 0,
            ..Config::default()
        });
        assert_eq!(
            None,
            no_timeout
                .diff_half_match(b"qHilloHelloHew", b"xHelloHeHulloy")
                .unwrap()
        );
    }

    #[test]
    fn test_diff_lines_to_chars() {
        // Convert lines down to characters.
        let result =
            diff_lines_to_chars::<u8>(b"alpha\nbeta\nalpha\n", b"beta\nalpha\nbeta\n").unwrap();
        assert_eq!(*result.chars_1, [1usize, 2, 1]); // Shared lines #1
        assert_eq!(*result.chars_2, [2usize, 1, 2]); // Shared lines #2
        assert_eq!(result.line_array, [b"" as &[u8], b"alpha\n", b"beta\n"]); // Shared lines #3

        let result = diff_lines_to_chars::<u8>(b"", b"alpha\r\nbeta\r\n\r\n\r\n").unwrap();
        assert!(result.chars_1.is_empty()); // Empty string and blank lines #1
        assert_eq!(*result.chars_2, [1usize, 2, 3, 3]); // Empty string and blank lines #2
        assert_eq!(
            result.line_array,
            [b"" as &[u8], b"alpha\r\n", b"beta\r\n", b"\r\n"]
        ); // Empty string and blank lines #3

        let result = diff_lines_to_chars::<u8>(b"a", b"b").unwrap();
        assert_eq!(*result.chars_1, [1usize]); // No linebreaks #1
        assert_eq!(*result.chars_2, [2usize]); // No linebreaks #2
        assert_eq!(result.line_array, [b"" as &[u8], b"a", b"b"]); // No linebreaks #3
    }

    #[test]
    fn test_diff_lines_to_chars_many_lines() {
        // 254 two-byte "lines"; the i == '\n' entry splits into two "\n" lines
        // sharing one line_array slot, so 255 lines map to 254 unique entries.
        let mut line_list: Vec<u8> = Vec::new();
        for i in 1u8..255 {
            line_list.push(i);
            line_list.push(b'\n');
        }
        let result = diff_lines_to_chars::<u8>(&line_list, b"").unwrap();
        assert_eq!(255, result.chars_1.len());
        assert!(result.chars_2.is_empty());
        assert_eq!(255, result.line_array.len());

        // Round-trip back through diff_chars_to_lines.
        let char_diffs: DiffList<usize> = vec![Diff {
            operation: Operation::Equal,
            text: result.chars_1.clone(),
        }];
        let rebuilt = diff_chars_to_lines::<u8>(&char_diffs, &result.line_array).unwrap();
        assert_eq!(1, rebuilt.len());
        assert_eq!(*rebuilt[0].text, *line_list);
    }

    #[test]
    fn test_diff_chars_to_lines() {
        // Convert chars up to lines.
        let char_diffs: DiffList<usize> = vec![
            Diff {
                operation: Operation::Equal,
                text: dupe(&[1usize, 2, 1]),
            },
            Diff {
                operation: Operation::Insert,
                text: dupe(&[2usize, 1, 2]),
            },
        ];
        let line_array: [&[u8]; 3] = [b"", b"alpha\n", b"beta\n"];
        let diffs = diff_chars_to_lines::<u8>(&char_diffs, &line_array).unwrap();
        assert_eq!(
            diffs![
                (Equal, b"alpha\nbeta\nalpha\n"),
                (Insert, b"beta\nalpha\nbeta\n"),
            ],
            diffs
        );
    }

    fn check_cleanup_merge(mut diffs: DiffList<u8>, expected: DiffList<u8>) {
        diff_cleanup_merge(&mut diffs).unwrap();
        assert_eq!(expected, diffs);
    }

    #[test]
    fn test_diff_cleanup_merge() {
        // Cleanup a messy diff.

        // No change case
        check_cleanup_merge(
            diffs![(Equal, b"a"), (Delete, b"b"), (Insert, b"c")],
            diffs![(Equal, b"a"), (Delete, b"b"), (Insert, b"c")],
        );

        // Merge equalities
        check_cleanup_merge(
            diffs![(Equal, b"a"), (Equal, b"b"), (Equal, b"c")],
            diffs![(Equal, b"abc")],
        );

        // Merge deletions
        check_cleanup_merge(
            diffs![(Delete, b"a"), (Delete, b"b"), (Delete, b"c")],
            diffs![(Delete, b"abc")],
        );

        // Merge insertions
        check_cleanup_merge(
            diffs![(Insert, b"a"), (Insert, b"b"), (Insert, b"c")],
            diffs![(Insert, b"abc")],
        );

        // Merge interweave
        check_cleanup_merge(
            diffs![
                (Delete, b"a"),
                (Insert, b"b"),
                (Delete, b"c"),
                (Insert, b"d"),
                (Equal, b"e"),
                (Equal, b"f"),
            ],
            diffs![(Delete, b"ac"), (Insert, b"bd"), (Equal, b"ef")],
        );

        // Prefix and suffix detection
        check_cleanup_merge(
            diffs![(Delete, b"a"), (Insert, b"abc"), (Delete, b"dc")],
            diffs![(Equal, b"a"), (Delete, b"d"), (Insert, b"b"), (Equal, b"c"),],
        );

        // Prefix and suffix detection with equalities
        check_cleanup_merge(
            diffs![
                (Equal, b"x"),
                (Delete, b"a"),
                (Insert, b"abc"),
                (Delete, b"dc"),
                (Equal, b"y"),
            ],
            diffs![
                (Equal, b"xa"),
                (Delete, b"d"),
                (Insert, b"b"),
                (Equal, b"cy"),
            ],
        );

        // Slide edit left
        check_cleanup_merge(
            diffs![(Equal, b"a"), (Insert, b"ba"), (Equal, b"c")],
            diffs![(Insert, b"ab"), (Equal, b"ac")],
        );

        // Slide edit right
        check_cleanup_merge(
            diffs![(Equal, b"c"), (Insert, b"ab"), (Equal, b"a")],
            diffs![(Equal, b"ca"), (Insert, b"ba")],
        );

        // Slide edit left recursive
        check_cleanup_merge(
            diffs![
                (Equal, b"a"),
                (Delete, b"b"),
                (Equal, b"c"),
                (Delete, b"ac"),
                (Equal, b"x"),
            ],
            diffs![(Delete, b"abc"), (Equal, b"acx")],
        );

        // Slide edit right recursive
        check_cleanup_merge(
            diffs![
                (Equal, b"x"),
                (Delete, b"ca"),
                (Equal, b"c"),
                (Delete, b"b"),
                (Equal, b"a"),
            ],
            diffs![(Equal, b"xca"), (Delete, b"cba")],
        );

        // Empty merge
        check_cleanup_merge(
            diffs![(Delete, b"b"), (Insert, b"ab"), (Equal, b"c")],
            diffs![(Insert, b"a"), (Equal, b"bc")],
        );

        // Empty equality
        check_cleanup_merge(
            diffs![(Equal, b""), (Insert, b"a"), (Equal, b"b")],
            diffs![(Insert, b"a"), (Equal, b"b")],
        );
    }

    fn check_cleanup_semantic_lossless(mut diffs: DiffList<u8>, expected: DiffList<u8>) {
        diff_cleanup_semantic_lossless(&mut diffs).unwrap();
        assert_eq!(expected, diffs);
    }

    #[test]
    fn test_diff_cleanup_semantic_lossless() {
        // Null case
        check_cleanup_semantic_lossless(Vec::new(), Vec::new());

        // Blank lines
        check_cleanup_semantic_lossless(
            diffs![
                (Equal, b"AAA\r\n\r\nBBB"),
                (Insert, b"\r\nDDD\r\n\r\nBBB"),
                (Equal, b"\r\nEEE"),
            ],
            diffs![
                (Equal, b"AAA\r\n\r\n"),
                (Insert, b"BBB\r\nDDD\r\n\r\n"),
                (Equal, b"BBB\r\nEEE"),
            ],
        );

        // Line boundaries
        check_cleanup_semantic_lossless(
            diffs![
                (Equal, b"AAA\r\nBBB"),
                (Insert, b" DDD\r\nBBB"),
                (Equal, b" EEE"),
            ],
            diffs![
                (Equal, b"AAA\r\n"),
                (Insert, b"BBB DDD\r\n"),
                (Equal, b"BBB EEE"),
            ],
        );

        // Word boundaries
        check_cleanup_semantic_lossless(
            diffs![
                (Equal, b"The c"),
                (Insert, b"ow and the c"),
                (Equal, b"at."),
            ],
            diffs![
                (Equal, b"The "),
                (Insert, b"cow and the "),
                (Equal, b"cat."),
            ],
        );

        // Alphanumeric boundaries
        check_cleanup_semantic_lossless(
            diffs![
                (Equal, b"The-c"),
                (Insert, b"ow-and-the-c"),
                (Equal, b"at."),
            ],
            diffs![
                (Equal, b"The-"),
                (Insert, b"cow-and-the-"),
                (Equal, b"cat."),
            ],
        );

        // Hitting the start
        check_cleanup_semantic_lossless(
            diffs![(Equal, b"a"), (Delete, b"a"), (Equal, b"ax")],
            diffs![(Delete, b"a"), (Equal, b"aax")],
        );

        // Hitting the end
        check_cleanup_semantic_lossless(
            diffs![(Equal, b"xa"), (Delete, b"a"), (Equal, b"a")],
            diffs![(Equal, b"xaa"), (Delete, b"a")],
        );

        // Sentence boundaries
        check_cleanup_semantic_lossless(
            diffs![
                (Equal, b"The xxx. The "),
                (Insert, b"zzz. The "),
                (Equal, b"yyy."),
            ],
            diffs![
                (Equal, b"The xxx."),
                (Insert, b" The zzz."),
                (Equal, b" The yyy."),
            ],
        );
    }

    #[test]
    fn test_rebuildtexts() {
        let diffs = diffs![(Insert, b"abcabc"), (Equal, b"defdef"), (Delete, b"ghighi"),];
        let texts = rebuildtexts(&diffs);
        assert_eq!(*texts[0], *b"defdefghighi");
        assert_eq!(*texts[1], *b"abcabcdefdef");

        let diffs = diffs![(Insert, b"xxx"), (Delete, b"yyy")];
        let texts = rebuildtexts(&diffs);
        assert_eq!(*texts[0], *b"yyy");
        assert_eq!(*texts[1], *b"xxx");

        let diffs = diffs![(Equal, b"xyz"), (Equal, b"pdq")];
        let texts = rebuildtexts(&diffs);
        assert_eq!(*texts[0], *b"xyzpdq");
        assert_eq!(*texts[1], *b"xyzpdq");
    }

    #[test]
    fn test_diff_basic() {
        let this = dmp(Config {
            diff_timeout: 0,
            ..Config::default()
        });

        // Null case.
        let diffs = this.diff(b"", b"", false).unwrap();
        assert!(diffs.is_empty());

        // Equality.
        let diffs = this.diff(b"abc", b"abc", false).unwrap();
        assert_eq!(diffs![(Equal, b"abc")], diffs);

        // Simple insertion.
        let diffs = this.diff(b"abc", b"ab123c", false).unwrap();
        assert_eq!(
            diffs![(Equal, b"ab"), (Insert, b"123"), (Equal, b"c")],
            diffs
        );

        // Simple deletion.
        let diffs = this.diff(b"a123bc", b"abc", false).unwrap();
        assert_eq!(
            diffs![(Equal, b"a"), (Delete, b"123"), (Equal, b"bc")],
            diffs
        );

        // Two insertions.
        let diffs = this.diff(b"abc", b"a123b456c", false).unwrap();
        assert_eq!(
            diffs![
                (Equal, b"a"),
                (Insert, b"123"),
                (Equal, b"b"),
                (Insert, b"456"),
                (Equal, b"c"),
            ],
            diffs
        );

        // Two deletions.
        let diffs = this.diff(b"a123b456c", b"abc", false).unwrap();
        assert_eq!(
            diffs![
                (Equal, b"a"),
                (Delete, b"123"),
                (Equal, b"b"),
                (Delete, b"456"),
                (Equal, b"c"),
            ],
            diffs
        );

        // Simple case #1
        let diffs = this.diff(b"a", b"b", false).unwrap();
        assert_eq!(diffs![(Delete, b"a"), (Insert, b"b")], diffs);

        // Simple case #2
        let diffs = this
            .diff(b"Apples are a fruit.", b"Bananas are also fruit.", false)
            .unwrap();
        assert_eq!(
            diffs![
                (Delete, b"Apple"),
                (Insert, b"Banana"),
                (Equal, b"s are a"),
                (Insert, b"lso"),
                (Equal, b" fruit."),
            ],
            diffs
        );

        // Simple case #3
        let diffs = this
            .diff(b"ax\t", "\u{0680}x\u{0000}".as_bytes(), false)
            .unwrap();
        assert_eq!(
            diffs![
                (Delete, b"a"),
                (Insert, "\u{0680}".as_bytes()),
                (Equal, b"x"),
                (Delete, b"\t"),
                (Insert, b"\x00"),
            ],
            diffs
        );

        // Overlap #1
        let diffs = this.diff(b"1ayb2", b"abxab", false).unwrap();
        assert_eq!(
            diffs![
                (Delete, b"1"),
                (Equal, b"a"),
                (Delete, b"y"),
                (Equal, b"b"),
                (Delete, b"2"),
                (Insert, b"xab"),
            ],
            diffs
        );

        // Overlap #2
        let diffs = this.diff(b"abcy", b"xaxcxabc", false).unwrap();
        assert_eq!(
            diffs![(Insert, b"xaxcx"), (Equal, b"abc"), (Delete, b"y")],
            diffs
        );

        // Overlap #3
        let diffs = this
            .diff(
                b"ABCDa=bcd=efghijklmnopqrsEFGHIJKLMNOefg",
                b"a-bcd-efghijklmnopqrs",
                false,
            )
            .unwrap();
        assert_eq!(
            diffs![
                (Delete, b"ABCD"),
                (Equal, b"a"),
                (Delete, b"="),
                (Insert, b"-"),
                (Equal, b"bcd"),
                (Delete, b"="),
                (Insert, b"-"),
                (Equal, b"efghijklmnopqrs"),
                (Delete, b"EFGHIJKLMNOefg"),
            ],
            diffs
        );

        // Large equality
        let diffs = this
            .diff(
                b"a [[Pennsylvania]] and [[New",
                b" and [[Pennsylvania]]",
                false,
            )
            .unwrap();
        assert_eq!(
            diffs![
                (Insert, b" "),
                (Equal, b"a"),
                (Insert, b"nd"),
                (Equal, b" [[Pennsylvania]]"),
                (Delete, b" and [[New"),
            ],
            diffs
        );
    }

    #[test]
    fn test_diff_timeout() {
        let with_timeout = dmp(Config {
            diff_timeout: 100, // 100ms
            ..Config::default()
        });

        // Increase the text lengths by 1024 times to ensure a timeout.
        let a = "`Twas brillig, and the slithy toves\nDid gyre and gimble in the wabe:\nAll mimsy were the borogoves,\nAnd the mome raths outgrabe.\n"
            .repeat(1024);
        let b = "I am the very model of a modern major general,\nI've information vegetable, animal, and mineral,\nI know the kings of England, and I quote the fights historical,\nFrom Marathon to Waterloo, in order categorical.\n"
            .repeat(1024);

        // Use the same clock as the diff deadline so a wall-clock step can't flake the bounds.
        let start = milli_timestamp();
        let _diffs = with_timeout
            .diff(a.as_bytes(), b.as_bytes(), false)
            .unwrap();
        let elapsed = milli_timestamp().saturating_sub(start);

        assert!(with_timeout.config.diff_timeout <= elapsed); // diff: Timeout min.
        // Generous upper bound (200x) for slow ASAN/CI machines.
        assert!(with_timeout.config.diff_timeout * 100 * 2 > elapsed); // diff: Timeout max.
    }

    #[test]
    fn test_diff_line_mode_equivalence() {
        let this = dmp(Config {
            diff_timeout: 0,
            ..Config::default()
        });

        // Test the linemode speedup.
        // Must be long to pass the 100 char cutoff.
        {
            // diff: Simple line-mode.
            let a = "1234567890\n".repeat(13);
            let b = "abcdefghij\n".repeat(13);
            let diff_checked = this.diff(a.as_bytes(), b.as_bytes(), true).unwrap();
            let diff_unchecked = this.diff(a.as_bytes(), b.as_bytes(), false).unwrap();
            assert_eq!(diff_checked, diff_unchecked);
        }

        {
            // diff: Single line-mode.
            let a = "1234567890".repeat(13);
            let b = "abcdefghij".repeat(13);
            let diff_checked = this.diff(a.as_bytes(), b.as_bytes(), true).unwrap();
            let diff_unchecked = this.diff(a.as_bytes(), b.as_bytes(), false).unwrap();
            assert_eq!(diff_checked, diff_unchecked);
        }

        {
            // diff: Overlap line-mode.
            let a = "1234567890\n".repeat(13);
            let b = "abcdefghij\n1234567890\n1234567890\n1234567890\n".repeat(3) + "abcdefghij\n";

            let diffs_linemode = this.diff(a.as_bytes(), b.as_bytes(), true).unwrap();
            let texts_linemode = rebuildtexts(&diffs_linemode);

            let diffs_textmode = this.diff(a.as_bytes(), b.as_bytes(), false).unwrap();
            let texts_textmode = rebuildtexts(&diffs_textmode);

            assert_eq!(texts_textmode, texts_linemode);
        }
    }

    #[test]
    fn test_diff_line_mode() {
        let this = dmp(Config {
            diff_timeout: 0,
            diff_check_lines_over: 20,
            ..Config::default()
        });

        let before = b"1234567890\n1234567890\n1234567890\n";
        let after = b"abcdefghij\nabcdefghij\nabcdefghij\n";

        let diff_checked = this.diff(before, after, true).unwrap();
        let diff_unchecked = this.diff(before, after, false).unwrap();
        assert_eq!(diff_checked, diff_unchecked); // diff: Simple line-mode.
    }

    fn check_cleanup_semantic(mut diffs: DiffList<u8>, expected: DiffList<u8>) {
        diff_cleanup_semantic(&mut diffs).unwrap();
        assert_eq!(expected, diffs);
    }

    #[test]
    fn test_diff_cleanup_semantic() {
        // Null case.
        check_cleanup_semantic(Vec::new(), Vec::new());

        // No elimination #1
        check_cleanup_semantic(
            diffs![
                (Delete, b"ab"),
                (Insert, b"cd"),
                (Equal, b"12"),
                (Delete, b"e"),
            ],
            diffs![
                (Delete, b"ab"),
                (Insert, b"cd"),
                (Equal, b"12"),
                (Delete, b"e"),
            ],
        );

        // No elimination #2
        check_cleanup_semantic(
            diffs![
                (Delete, b"abc"),
                (Insert, b"ABC"),
                (Equal, b"1234"),
                (Delete, b"wxyz"),
            ],
            diffs![
                (Delete, b"abc"),
                (Insert, b"ABC"),
                (Equal, b"1234"),
                (Delete, b"wxyz"),
            ],
        );

        // Simple elimination
        check_cleanup_semantic(
            diffs![(Delete, b"a"), (Equal, b"b"), (Delete, b"c")],
            diffs![(Delete, b"abc"), (Insert, b"b")],
        );

        // Backpass elimination
        check_cleanup_semantic(
            diffs![
                (Delete, b"ab"),
                (Equal, b"cd"),
                (Delete, b"e"),
                (Equal, b"f"),
                (Insert, b"g"),
            ],
            diffs![(Delete, b"abcdef"), (Insert, b"cdfg")],
        );

        // Multiple elimination
        check_cleanup_semantic(
            diffs![
                (Insert, b"1"),
                (Equal, b"A"),
                (Delete, b"B"),
                (Insert, b"2"),
                (Equal, b"_"),
                (Insert, b"1"),
                (Equal, b"A"),
                (Delete, b"B"),
                (Insert, b"2"),
            ],
            diffs![(Delete, b"AB_AB"), (Insert, b"1A2_1A2")],
        );

        // Word boundaries
        check_cleanup_semantic(
            diffs![
                (Equal, b"The c"),
                (Delete, b"ow and the c"),
                (Equal, b"at."),
            ],
            diffs![
                (Equal, b"The "),
                (Delete, b"cow and the "),
                (Equal, b"cat."),
            ],
        );

        // No overlap elimination
        check_cleanup_semantic(
            diffs![(Delete, b"abcxx"), (Insert, b"xxdef")],
            diffs![(Delete, b"abcxx"), (Insert, b"xxdef")],
        );

        // Overlap elimination
        check_cleanup_semantic(
            diffs![(Delete, b"abcxxx"), (Insert, b"xxxdef")],
            diffs![(Delete, b"abc"), (Equal, b"xxx"), (Insert, b"def")],
        );

        // Reverse overlap elimination
        check_cleanup_semantic(
            diffs![(Delete, b"xxxabc"), (Insert, b"defxxx")],
            diffs![(Insert, b"def"), (Equal, b"xxx"), (Delete, b"abc")],
        );

        // Two overlap eliminations
        check_cleanup_semantic(
            diffs![
                (Delete, b"abcd1212"),
                (Insert, b"1212efghi"),
                (Equal, b"----"),
                (Delete, b"A3"),
                (Insert, b"3BC"),
            ],
            diffs![
                (Delete, b"abcd"),
                (Equal, b"1212"),
                (Insert, b"efghi"),
                (Equal, b"----"),
                (Delete, b"A"),
                (Equal, b"3"),
                (Insert, b"BC"),
            ],
        );
    }
}

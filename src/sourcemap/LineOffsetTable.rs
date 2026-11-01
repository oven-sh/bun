use core::alloc::Allocator;
use std::alloc::Global;

use bun_alloc::AllocError;
use bun_ast::Loc;
use bun_collections::MultiArrayList;
use bun_core::strings;
use smallvec::SmallVec;

/// The source map specification is very loose and does not specify what
/// column numbers actually mean. The popular "source-map" library from Mozilla
/// appears to interpret them as counts of UTF-16 code units, so we generate
/// those too for compatibility.
///
/// We keep mapping tables around to accelerate conversion from byte offsets
/// to UTF-16 code unit counts. However, this mapping takes up a lot of memory
/// and takes up a lot of memory. Since most JavaScript is ASCII and the
/// mapping for ASCII is 1:1, we avoid creating a table for ASCII-only lines
/// as an optimization.
///
/// Generic over `A` so the bundler can put both the SoA slab and every
/// `columns_for_non_ascii` payload into the per-worker AST heap (`AstAlloc`)
/// and bulk-free them on `mi_heap_destroy` instead of walking
/// `LinkerGraph.files` in `deinit_without_freeing_arena`. The runtime printer's
/// lazy table keeps the `Global` default and frees normally.
pub struct LineOffsetTable<A: Allocator = Global> {
    pub columns_for_non_ascii: Box<[i32], A>,
    /// Byte offset of the first non-ASCII byte on this line, or `i32::MAX as u32`
    /// when the line is entirely ASCII (so no `columns_for_non_ascii` table exists).
    /// The sentinel can't be `0` because a line can legitimately start with a
    /// non-ASCII byte at offset 0. `i32::MAX` lets `add_source_mapping` skip the
    /// `columns_for_non_ascii` SoA load on the (overwhelmingly common) ASCII path
    /// with a single column comparison.
    pub byte_offset_to_first_non_ascii: u32,
    pub byte_offset_to_start_of_line: u32,
}

pub type List<A = Global> = MultiArrayList<LineOffsetTable<A>, A>;

/// Typed SoA column accessors on [`List`] (= `MultiArrayList<LineOffsetTable>`).
///
/// Can't be an
/// inherent impl (orphan rules — `MultiArrayList` lives in `bun_collections`),
/// so it's an extension trait; same pattern as `mapping::MappingColumns`.
pub trait LineOffsetTableColumns {
    fn items_byte_offset_to_start_of_line(&self) -> &[u32];
    fn items_byte_offset_to_first_non_ascii(&self) -> &[u32];
}

impl<A: Allocator + 'static> LineOffsetTableColumns for List<A> {
    #[inline]
    fn items_byte_offset_to_start_of_line(&self) -> &[u32] {
        self.items::<"byte_offset_to_start_of_line", u32>()
    }

    #[inline]
    fn items_byte_offset_to_first_non_ascii(&self) -> &[u32] {
        self.items::<"byte_offset_to_first_non_ascii", u32>()
    }
}

impl LineOffsetTable {
    #[inline]
    pub(crate) fn find_line(byte_offsets_to_start_of_line: &[u32], loc: Loc) -> i32 {
        debug_assert!(loc.start > -1); // checked by caller
        let mut original_line: usize = 0;
        let loc_start = usize::try_from(loc.start).expect("int cast");

        {
            let mut count = byte_offsets_to_start_of_line.len();
            let mut i: usize = 0;
            while count > 0 {
                let step = count / 2;
                i = original_line + step;
                if (byte_offsets_to_start_of_line[i] as usize) <= loc_start {
                    original_line = i + 1;
                    count = count - step - 1;
                } else {
                    count = step;
                }
            }
            let _ = i;
        }

        i32::try_from(original_line).expect("int cast") - 1
    }

    /// `find_line` with an O(1) fast path for the printer's monotone access
    /// pattern. `add_source_mapping` is called once per printed AST node in
    /// (mostly) source order, so the result is almost always `hint`, `hint+1`,
    /// or `hint+2`. Perf on next-lint showed `find_line` at 0.85% self-time
    /// (≈90-120M cycles) doing a fresh bounds-checked binary search every
    /// call; this short-circuits to a couple of compares for the common case
    /// and falls back to the binary search otherwise.
    #[inline]
    pub(crate) fn find_line_with_hint(offsets: &[u32], loc: Loc, hint: u32) -> i32 {
        debug_assert!(loc.start > -1);
        let loc_start = loc.start as u32;
        let len = offsets.len();
        let h = hint as usize;
        // The answer is `i` iff `offsets[i] <= loc_start && (i+1 == len || loc_start < offsets[i+1])`.
        // Probe `hint` and the next two lines (covers same-line tokens, single
        // newline, and the `stmt;\n\nstmt` blank-line gap). Anything further
        // apart is either a backwards jump (hoisted decl) or a large forward
        // skip — let the binary search handle those.
        if h < len && offsets[h] <= loc_start {
            if h + 1 == len || loc_start < offsets[h + 1] {
                return hint as i32;
            }
            if h + 2 == len || loc_start < offsets[h + 2] {
                return hint as i32 + 1;
            }
            if h + 3 == len || loc_start < offsets[h + 3] {
                return hint as i32 + 2;
            }
        }
        Self::find_line(offsets, loc)
    }

    /// `Global`-allocator convenience wrapper around [`generate_in`].
    pub fn generate(contents: &[u8], approximate_line_count: i32) -> Result<List, AllocError> {
        Self::generate_in::<Global>(contents, approximate_line_count)
    }

    // Callers pass mixed allocators: the bundler routes `A = AstAlloc` so the
    // table bulk-frees with the per-worker AST heap, everyone else uses
    // [`generate`] (`A = Global`).
    pub fn generate_in<A: Allocator + Copy + Default + 'static>(
        contents: &[u8],
        approximate_line_count: i32,
    ) -> Result<List<A>, AllocError> {
        let alloc = A::default();
        let empty_box = || Vec::new_in(alloc).into_boxed_slice();
        let mut list = List::<A>::new_in(alloc);
        // Preallocate the top-level table using the approximate line count from the lexer
        list.ensure_unused_capacity(approximate_line_count.max(1) as usize)?;
        let mut column: i32 = 0;
        let mut byte_offset_to_first_non_ascii: u32 = i32::MAX as u32;
        let mut column_byte_offset: u32 = 0;
        let mut line_byte_offset: u32 = 0;

        // the idea here is:
        // we want to avoid re-allocating this array _most_ of the time
        // when lines _do_ have unicode characters, they probably still won't be longer than 255 much
        // PERF: `SmallVec<[i32; 256]>` is a 256-slot stack buffer with heap spill: inline
        // storage stays on-stack, `into_vec()` at hand-over dupes if stack-owned and
        // moves if spilled, and `mem::take` resets to a fresh inline buffer
        // (zero alloc). Previously this was a heap `Vec::with_capacity(120)` re-primed via
        // `mem::replace` per non-ASCII line, which showed up as one mi_malloc(480) per such
        // line under `generate` (lint/create-vite).
        let mut columns_for_non_ascii: SmallVec<[i32; 256]> = SmallVec::new();

        // Hoist the base pointer so per-iteration offset math is a single sub + truncate.
        let base = contents.as_ptr() as usize;

        let mut remaining = contents;
        while !remaining.is_empty() {
            let b0 = remaining[0];
            let len_ = strings::wtf8_byte_sequence_length_with_invalid(b0);
            // After the SIMD skip below lands, the loop head
            // is overwhelmingly an ASCII '\r'/'\n' or a non-ASCII lead byte, so keep the
            // 1-byte path branch-only and confine the zero+copy pad to the cold
            // multibyte arm.
            // `len_` is the lead byte's *declared* width; a source whose final bytes are
            // a truncated multibyte sequence declares more bytes than remain, so every
            // slice below (decode, SIMD-skip offset, advance) must use the clamped width.
            let cp_len = (len_ as usize).min(remaining.len());
            let c: i32 = if len_ == 1 {
                b0 as i32
            } else {
                let mut cp_bytes = [0u8; 4];
                cp_bytes[..cp_len].copy_from_slice(&remaining[..cp_len]);
                strings::decode_wtf8_rune_t::<i32>(cp_bytes, len_, 0)
            };

            let offset = (remaining.as_ptr() as usize - base) as u32;

            if column == 0 {
                line_byte_offset = offset;
            }

            // `byte_offset_to_first_non_ascii` doubles as the "line has non-ASCII"
            // flag (`i32::MAX as u32` = none so far). The extend below appends this
            // byte's entry; seeding one here too would shift every later column by one.
            if c > 0x7F && byte_offset_to_first_non_ascii == i32::MAX as u32 {
                debug_assert!(remaining.as_ptr() as usize >= base);
                column_byte_offset = offset - line_byte_offset;
                byte_offset_to_first_non_ascii = column_byte_offset;
            }

            // Update the per-byte column offsets
            if byte_offset_to_first_non_ascii != i32::MAX as u32 {
                let line_bytes_so_far = offset - line_byte_offset;
                let need = (line_bytes_so_far - column_byte_offset + 1) as usize;
                columns_for_non_ascii.extend(core::iter::repeat_n(column, need));
                column_byte_offset = line_bytes_so_far + 1;
            } else {
                match c {
                    // (@max('\r', '\n') + 1)...127  ==  14..=127
                    14..=127 => {
                        // skip ahead to the next newline or non-ascii character
                        if let Some(j) = strings::index_of_newline_or_non_ascii_check_start::<false>(
                            remaining,
                            cp_len as u32,
                        ) {
                            column += i32::try_from(j).expect("int cast");
                            remaining = &remaining[j as usize..];
                        } else {
                            // if there are no more lines, we are done!
                            column += i32::try_from(remaining.len()).expect("int cast");
                            remaining = &remaining[remaining.len()..];
                        }

                        continue;
                    }
                    _ => {}
                }
            }

            match c {
                0x0D /* '\r' */ | 0x0A /* '\n' */ | 0x2028 | 0x2029 => {
                    // windows newline
                    if c == (b'\r' as i32) && remaining.len() > 1 && remaining[1] == b'\n' {
                        column += 1;
                        remaining = &remaining[1..];
                        continue;
                    }

                    // The SmallVec scratch reuses its
                    // inline storage across lines; copy out into an `A`-backed box only when a
                    // line had non-ASCII bytes. ASCII-only lines (almost all of them) store an
                    // empty dangling box and leave the scratch untouched.
                    let owned: Box<[i32], A> = if columns_for_non_ascii.is_empty() {
                        empty_box()
                    } else {
                        let mut v = Vec::with_capacity_in(columns_for_non_ascii.len(), alloc);
                        v.extend_from_slice(&columns_for_non_ascii);
                        columns_for_non_ascii.clear();
                        v.into_boxed_slice()
                    };

                    list.append(LineOffsetTable {
                        byte_offset_to_start_of_line: line_byte_offset,
                        byte_offset_to_first_non_ascii,
                        columns_for_non_ascii: owned,
                    })?;

                    column = 0;
                    byte_offset_to_first_non_ascii = i32::MAX as u32;
                    column_byte_offset = 0;
                    line_byte_offset = 0;
                }
                _ => {
                    // Mozilla's "source-map" library counts columns using UTF-16 code units
                    column += ((c > 0xFFFF) as i32) + 1;
                }
            }

            remaining = &remaining[cp_len..];
        }

        // Mark the start of the next line
        if column == 0 {
            line_byte_offset = contents.len() as u32;
        }

        if !columns_for_non_ascii.is_empty() {
            let line_bytes_so_far = contents.len() as u32 - line_byte_offset;
            let need = (line_bytes_so_far - column_byte_offset + 1) as usize;
            columns_for_non_ascii.extend(core::iter::repeat_n(column, need));
        }
        {
            let owned: Box<[i32], A> = if columns_for_non_ascii.is_empty() {
                empty_box()
            } else {
                let mut v = Vec::with_capacity_in(columns_for_non_ascii.len(), alloc);
                v.extend_from_slice(&columns_for_non_ascii);
                v.into_boxed_slice()
            };
            list.append(LineOffsetTable {
                byte_offset_to_start_of_line: line_byte_offset,
                byte_offset_to_first_non_ascii,
                columns_for_non_ascii: owned,
            })?;
        }

        // `shrink_and_free` has no realloc-in-place fast path — it always does a fresh
        // aligned_alloc + full SoA row copy + free. `grow_capacity` overshoots a single
        // bulk reservation by at most ~50%, so when the lexer's line-count hint was
        // roughly right (the common case) the slack isn't worth a multi-MB memcpy.
        // Only trim when capacity exceeds 1.5x length, which catches pathological
        // mismatches (wrong loader, wildly off hint) while skipping the routine ~20%
        // overshoot.
        if list.capacity() > list.len() + (list.len() >> 1) {
            list.shrink_and_free(list.len());
        }
        Ok(list)
    }
}

/// Where a line and a column of a [`List`] are in the text that the list was generated from.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ByteOffset {
    At(u32),
    /// No byte of the text has that line and column.
    PastEnd,
    /// Several bytes that can start a token share it: a lead byte announced bytes that do not continue it.
    Ambiguous,
}

impl LineOffsetTable {
    /// The byte offset that `add_source_mapping` wrote as `line` and `column` (zero-based) from `list`, the table of `contents`.
    pub fn byte_offset_of<A: Allocator + 'static>(
        list: &List<A>,
        contents: &[u8],
        line: u32,
        column: u32,
    ) -> ByteOffset {
        let starts = list.items_byte_offset_to_start_of_line();
        let line = line as usize;
        let Some(&start) = starts.get(line) else {
            return ByteOffset::PastEnd;
        };
        let first_non_ascii = list.items_byte_offset_to_first_non_ascii()[line];
        // Before the first byte that is not ASCII, the column is the offset in the line.
        let counted = u64::from(start) + u64::from(column);
        let is_on_the_line = match starts.get(line + 1) {
            Some(&next) => counted < u64::from(next),
            None => counted <= contents.len() as u64,
        };
        let counted = (column < first_non_ascii && is_on_the_line).then_some(counted as u32);
        // From that byte on, each byte has its column here, and the columns never go down.
        let columns = &list.items::<"columns_for_non_ascii", Box<[i32], A>>()[line];
        let column = i32::try_from(column).unwrap_or(i32::MAX);
        let from = columns.partition_point(|&it| it < column);
        let until = columns.partition_point(|&it| it <= column);
        if from == until {
            return counted.map_or(ByteOffset::PastEnd, ByteOffset::At);
        }
        if counted.is_some() {
            return ByteOffset::Ambiguous;
        }
        // The last byte with the column starts a code point. No token starts at a byte before it that continues a sequence.
        let base = (start + first_non_ascii) as usize;
        let last = base + until - 1;
        let Some(announced) = contents.get(base + from..last) else {
            return ByteOffset::PastEnd;
        };
        match announced.iter().all(|byte| matches!(byte, 0x80..=0xBF)) {
            true => ByteOffset::At(last as u32),
            false => ByteOffset::Ambiguous,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_sema_standalone as _;

    fn offset(contents: &[u8], line: u32, column: u32) -> ByteOffset {
        let mut list = LineOffsetTable::generate(contents, 0).unwrap();
        let found = LineOffsetTable::byte_offset_of(&list, contents, line, column);
        list.drop_elements();
        found
    }

    /// What `add_source_mapping` writes for the byte at `offset`.
    fn line_and_column(list: &List, offset: u32) -> (u32, u32) {
        let starts = list.items_byte_offset_to_start_of_line();
        let loc = Loc {
            start: offset as i32,
        };
        let line = LineOffsetTable::find_line(starts, loc).max(0) as usize;
        let in_line = offset - starts[line];
        let first_non_ascii = list.items_byte_offset_to_first_non_ascii()[line];
        let columns = &list.items::<"columns_for_non_ascii", Box<[i32]>>()[line];
        let column = match in_line >= first_non_ascii && !columns.is_empty() {
            true => columns[(in_line - first_non_ascii) as usize] as u32,
            false => in_line,
        };
        (line as u32, column)
    }

    /// Every byte of `contents` that starts a character, and its end, is found again from its line and column.
    fn assert_every_character_is_found(contents: &str) {
        let bytes = contents.as_bytes();
        let mut list = LineOffsetTable::generate(bytes, 0).unwrap();
        let starts = contents.char_indices().map(|(at, _)| at as u32);
        for at in starts.chain([bytes.len() as u32]) {
            let (line, column) = line_and_column(&list, at);
            assert_eq!(
                LineOffsetTable::byte_offset_of(&list, bytes, line, column),
                ByteOffset::At(at),
                "{contents:?} at {at}, which is {line}:{column}"
            );
        }
        list.drop_elements();
    }

    #[test]
    fn text_that_is_utf8_is_found_at_every_character() {
        for contents in [
            "",
            "ab\ncd",
            "a\r\nb\rc\n",
            "a\u{2028}b\u{2029}c",
            "\u{FEFF}// caf\u{E9} \u{1F600}\nexport const a: \"\u{E9}\u{1F600}\" = 1;",
            "\u{E9}",
            "x\u{1F600}",
            "\u{0}\u{7F}\u{85}\u{FFFD}\t",
        ] {
            assert_every_character_is_found(contents);
        }
    }

    #[test]
    fn a_column_that_no_byte_has_is_past_the_end() {
        assert_eq!(offset(b"ab\ncd", 0, 3), ByteOffset::PastEnd);
        assert_eq!(offset(b"ab\ncd", 1, 3), ByteOffset::PastEnd);
        assert_eq!(offset(b"ab\ncd", 2, 0), ByteOffset::PastEnd);
        // The second half of a surrogate pair.
        assert_eq!(offset("\u{1F600}x".as_bytes(), 0, 1), ByteOffset::PastEnd);
        assert_eq!(offset("\u{1F600}x".as_bytes(), 0, 4), ByteOffset::PastEnd);
    }

    #[test]
    fn a_lead_byte_without_its_sequence_on_a_line_of_ascii_keeps_every_byte_apart() {
        // The line has no column table, so a column is an offset in the line.
        let contents = b"// caf\xE9 au lait\nx";
        for at in 0..=contents.len() as u32 {
            let (line, column) = match at {
                0..=15 => (0, at),
                _ => (1, at - 16),
            };
            assert_eq!(offset(contents, line, column), ByteOffset::At(at));
        }
        // The sequence that the lead byte announces holds the line feed: the line goes on.
        let contents = b"// caf\xE9\nexport";
        assert_eq!(offset(contents, 0, 8), ByteOffset::At(8));
        assert_eq!(offset(contents, 1, 0), ByteOffset::PastEnd);
    }

    #[test]
    fn a_byte_that_starts_no_sequence_is_a_character() {
        let contents = b"// 25\xB0C\nx";
        assert_eq!(offset(contents, 0, 5), ByteOffset::At(5));
        assert_eq!(offset(contents, 0, 6), ByteOffset::At(6));
        assert_eq!(offset(contents, 1, 0), ByteOffset::At(8));
        // It is the only byte with its column, though it could continue a sequence.
        assert_eq!(offset(b"a\xB5 = 1", 0, 1), ByteOffset::At(1));
    }

    #[test]
    fn bytes_that_share_a_column_are_ambiguous() {
        // After `\x92` the line has a column table, and `a`, `b` and the end have the column after `\xE9`.
        let contents = b"\x92 \xE9ab";
        assert_eq!(offset(contents, 0, 2), ByteOffset::At(2));
        assert_eq!(offset(contents, 0, 3), ByteOffset::Ambiguous);
        // Before `\u{E9}` a column is an offset, and `\xE9ab` counted as one column: `b` and `\u{E9}` have column 2.
        let contents = b"\xE9ab \xC3\xA9x";
        assert_eq!(offset(contents, 0, 1), ByteOffset::At(1));
        assert_eq!(offset(contents, 0, 2), ByteOffset::Ambiguous);
        assert_eq!(offset(contents, 0, 4), ByteOffset::At(7));
    }

    #[test]
    fn a_table_that_gives_each_ill_formed_byte_a_column_has_no_ambiguous_column() {
        // `\x92 \xE9ab` as a table that steps one byte over `\xE9`.
        let contents = b"\x92 \xE9ab";
        let mut list = List::default();
        list.append(LineOffsetTable {
            columns_for_non_ascii: Box::from([0, 1, 2, 3, 4, 5]),
            byte_offset_to_first_non_ascii: 0,
            byte_offset_to_start_of_line: 0,
        })
        .unwrap();
        for at in 0..=5 {
            assert_eq!(
                LineOffsetTable::byte_offset_of(&list, contents, 0, at),
                ByteOffset::At(at)
            );
        }
        list.drop_elements();
    }
}

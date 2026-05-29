use core::alloc::Allocator;
use std::alloc::Global;

use bun_alloc::AllocError;
use bun_ast::Loc;
use bun_collections::MultiArrayList;
use bun_core::strings;
use smallvec::SmallVec;

pub struct LineOffsetTable<A: Allocator = Global> {
    pub columns_for_non_ascii: Box<[i32], A>,
    pub byte_offset_to_first_non_ascii: u32,
    pub byte_offset_to_start_of_line: u32,
}

pub type List<A = Global> = MultiArrayList<LineOffsetTable<A>, A>;

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
    pub fn find_line(byte_offsets_to_start_of_line: &[u32], loc: Loc) -> i32 {
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

    #[inline]
    pub fn find_line_with_hint(offsets: &[u32], loc: Loc, hint: u32) -> i32 {
        debug_assert!(loc.start > -1);
        let loc_start = loc.start as u32;
        let len = offsets.len();
        let h = hint as usize;
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

    pub fn find_index(byte_offsets_to_start_of_line: &[u32], loc: Loc) -> Option<usize> {
        debug_assert!(loc.start > -1); // checked by caller
        let mut original_line: usize = 0;
        let loc_start = usize::try_from(loc.start).expect("int cast");

        let mut count = byte_offsets_to_start_of_line.len();
        while count > 0 {
            let step = count / 2;
            let i = original_line + step;
            let byte_offset = byte_offsets_to_start_of_line[i] as usize;
            if byte_offset == loc_start {
                return Some(i);
            }
            if i + 1 < byte_offsets_to_start_of_line.len() {
                let next_byte_offset = byte_offsets_to_start_of_line[i + 1] as usize;
                if byte_offset < loc_start && loc_start < next_byte_offset {
                    return Some(i);
                }
            }

            if byte_offset < loc_start {
                original_line = i + 1;
                count = count - step - 1;
            } else {
                count = step;
            }
        }

        None
    }

    /// `Global`-allocator convenience wrapper around [`generate_in`].
    pub fn generate(contents: &[u8], approximate_line_count: i32) -> Result<List, AllocError> {
        Self::generate_in::<Global>(contents, approximate_line_count)
    }

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

        let mut columns_for_non_ascii: SmallVec<[i32; 256]> = SmallVec::new();

        // Hoist the base pointer so per-iteration offset math is a single sub + truncate,
        // matching Zig's `@truncate(@intFromPtr(remaining.ptr) - @intFromPtr(contents.ptr))`.
        let base = contents.as_ptr() as usize;

        let mut remaining = contents;
        while !remaining.is_empty() {
            let b0 = remaining[0];
            let len_ = strings::wtf8_byte_sequence_length_with_invalid(b0);
            let c: i32 = if len_ == 1 {
                b0 as i32
            } else {
                let mut cp_bytes = [0u8; 4];
                let take = (len_ as usize).min(remaining.len());
                cp_bytes[..take].copy_from_slice(&remaining[..take]);
                strings::decode_wtf8_rune_t::<i32>(cp_bytes, len_, 0)
            };
            let cp_len = len_ as usize;

            let offset = (remaining.as_ptr() as usize - base) as u32;

            if column == 0 {
                line_byte_offset = offset;
            }

            if c > 0x7F && columns_for_non_ascii.is_empty() {
                debug_assert!(remaining.as_ptr() as usize >= base);
                // we have a non-ASCII character, so we need to keep track of the
                // mapping from byte offsets to UTF-16 code unit counts
                // Scratch is empty here with 256 inline slots, so this never reallocs.
                columns_for_non_ascii.push(column);
                column_byte_offset = offset - line_byte_offset;
                byte_offset_to_first_non_ascii = column_byte_offset;
            }

            // Update the per-byte column offsets
            if !columns_for_non_ascii.is_empty() {
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
                            len_ as u32,
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

        if list.capacity() > list.len() + (list.len() >> 1) {
            list.shrink_and_free(list.len());
        }
        Ok(list)
    }
}

// ported from: src/sourcemap/LineOffsetTable.zig

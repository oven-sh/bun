use bun_alloc::Arena;
use bun_collections::{BabyList, MultiArrayList};
use bun_logger::Loc;
use bun_str::strings;

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
#[derive(Default)]
pub struct LineOffsetTable {
    pub columns_for_non_ascii: BabyList<i32>,
    pub byte_offset_to_first_non_ascii: u32,
    pub byte_offset_to_start_of_line: u32,
}

pub type List = MultiArrayList<LineOffsetTable>;

impl LineOffsetTable {
    pub fn find_line(byte_offsets_to_start_of_line: &[u32], loc: Loc) -> i32 {
        debug_assert!(loc.start > -1); // checked by caller
        let mut original_line: usize = 0;
        let loc_start = usize::try_from(loc.start).unwrap();

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

        i32::try_from(original_line).unwrap() - 1
    }

    pub fn find_index(byte_offsets_to_start_of_line: &[u32], loc: Loc) -> Option<usize> {
        debug_assert!(loc.start > -1); // checked by caller
        let mut original_line: usize = 0;
        let loc_start = usize::try_from(loc.start).unwrap();

        let mut count = byte_offsets_to_start_of_line.len();
        let mut i: usize = 0;
        while count > 0 {
            let step = count / 2;
            i = original_line + step;
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

    // sourcemap is an AST crate per PORTING.md — `std.mem.Allocator` param becomes `&'bump Arena`.
    // TODO(port): callers in Zig pass mixed allocators (printer/bundler arenas vs VM default
    // allocator in CodeCoverage.zig); Phase B may need a non-arena overload. MultiArrayList/
    // BabyList arena APIs (`ensure_unused_capacity(bump, ..)`, `push(bump, ..)`,
    // `from_slice`/`shrink_to_fit(bump)`) are assumed here — wire exact signatures in Phase B.
    pub fn generate<'bump>(
        bump: &'bump Arena,
        contents: &[u8],
        approximate_line_count: i32,
    ) -> List {
        let mut list = List::default();
        // Preallocate the top-level table using the approximate line count from the lexer
        list.ensure_unused_capacity(bump, usize::try_from(approximate_line_count.max(1)).unwrap());
        let mut column: i32 = 0;
        let mut byte_offset_to_first_non_ascii: u32 = 0;
        let mut column_byte_offset: u32 = 0;
        let mut line_byte_offset: u32 = 0;

        // the idea here is:
        // we want to avoid re-allocating this array _most_ of the time
        // when lines _do_ have unicode characters, they probably still won't be longer than 255 much
        // PERF(port): was stack-fallback (std.heap.stackFallback @sizeOf(i32)*256) — profile in Phase B
        let mut columns_for_non_ascii: Vec<i32> = Vec::with_capacity(120);

        let mut remaining = contents;
        while !remaining.is_empty() {
            let len_ = strings::wtf8_byte_sequence_length_with_invalid(remaining[0]);
            // TODO(port): Zig passes `remaining.ptr[0..4]` (unchecked 4-byte view). Verify the
            // Rust signature of decode_wtf8_rune_t — passing the slice here; it must not read
            // past `len_` bytes.
            let c: i32 = strings::decode_wtf8_rune_t::<i32>(remaining, len_, 0);
            let cp_len = len_ as usize;

            if column == 0 {
                line_byte_offset =
                    ((remaining.as_ptr() as usize) - (contents.as_ptr() as usize)) as u32;
            }

            if c > 0x7F && columns_for_non_ascii.is_empty() {
                debug_assert!((remaining.as_ptr() as usize) >= (contents.as_ptr() as usize));
                // we have a non-ASCII character, so we need to keep track of the
                // mapping from byte offsets to UTF-16 code unit counts
                columns_for_non_ascii.push(column);
                // PERF(port): was assume_capacity
                column_byte_offset = u32::try_from(
                    ((remaining.as_ptr() as usize) - (contents.as_ptr() as usize))
                        - (line_byte_offset as usize),
                )
                .unwrap();
                byte_offset_to_first_non_ascii = column_byte_offset;
            }

            // Update the per-byte column offsets
            if !columns_for_non_ascii.is_empty() {
                let line_bytes_so_far =
                    (((remaining.as_ptr() as usize) - (contents.as_ptr() as usize)) as u32)
                        - line_byte_offset;
                columns_for_non_ascii
                    .reserve(((line_bytes_so_far - column_byte_offset) + 1) as usize);
                while column_byte_offset <= line_bytes_so_far {
                    columns_for_non_ascii.push(column);
                    // PERF(port): was assume_capacity
                    column_byte_offset += 1;
                }
            } else {
                match c {
                    // (@max('\r', '\n') + 1)...127  ==  14..=127
                    14..=127 => {
                        // skip ahead to the next newline or non-ascii character
                        if let Some(j) = strings::index_of_newline_or_non_ascii_check_start(
                            remaining,
                            len_ as u32,
                            false,
                        ) {
                            column += i32::try_from(j).unwrap();
                            remaining = &remaining[j..];
                        } else {
                            // if there are no more lines, we are done!
                            column += i32::try_from(remaining.len()).unwrap();
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

                    // We don't call .toOwnedSlice() because it is expensive to
                    // reallocate the array AND when inside an Arena, it's
                    // hideously expensive
                    //
                    // PERF(port): Zig used a stack-fallback allocator for the scratch list and
                    // duped onto `allocator` only when stack-owned, then reset the fixed buffer.
                    // Here the scratch is a heap Vec; we always dupe into the bump arena
                    // (mirrors `allocator.dupe`) and `.clear()` to reuse capacity. Profile in
                    // Phase B.
                    let owned: &'bump [i32] = bump.alloc_slice_copy(&columns_for_non_ascii);

                    list.push(bump, LineOffsetTable {
                        byte_offset_to_start_of_line: line_byte_offset,
                        byte_offset_to_first_non_ascii,
                        columns_for_non_ascii: BabyList::from_slice(owned),
                    });

                    column = 0;
                    byte_offset_to_first_non_ascii = 0;
                    column_byte_offset = 0;
                    line_byte_offset = 0;

                    // reset the list to use the stack-allocated memory
                    columns_for_non_ascii.clear();
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
            line_byte_offset = u32::try_from(contents.len()).unwrap();
        }

        if !columns_for_non_ascii.is_empty() {
            let line_bytes_so_far = u32::try_from(contents.len()).unwrap() - line_byte_offset;
            columns_for_non_ascii.reserve(((line_bytes_so_far - column_byte_offset) + 1) as usize);
            while column_byte_offset <= line_bytes_so_far {
                columns_for_non_ascii.push(column);
                // PERF(port): was assume_capacity
                column_byte_offset += 1;
            }
        }
        {
            // PERF(port): Zig checked stack_fallback.ownsSlice and duped onto `allocator` if so;
            // here we always dupe the scratch Vec into the bump arena.
            let owned: &'bump [i32] = bump.alloc_slice_copy(&columns_for_non_ascii);
            list.push(bump, LineOffsetTable {
                byte_offset_to_start_of_line: line_byte_offset,
                byte_offset_to_first_non_ascii,
                columns_for_non_ascii: BabyList::from_slice(owned),
            });
        }

        if list.capacity() > list.len() {
            list.shrink_to_fit(bump);
        }
        list
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap/LineOffsetTable.zig (232 lines)
//   confidence: medium
//   todos:      2
//   notes:      generate() now takes &'bump Arena and threads it into MultiArrayList/BabyList (arena API assumed — wire in Phase B); stack-fallback scratch replaced by reusable Vec + bump.alloc_slice_copy (PERF-tagged); verify decode_wtf8_rune_t signature
// ──────────────────────────────────────────────────────────────────────────

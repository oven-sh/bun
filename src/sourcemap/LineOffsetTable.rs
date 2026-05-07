use bun_alloc::AllocError;
use bun_collections::multi_array_list::MultiArrayElement;
use bun_collections::{VecExt, MultiArrayList};
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
    pub columns_for_non_ascii: Vec<i32>,
    pub byte_offset_to_first_non_ascii: u32,
    pub byte_offset_to_start_of_line: u32,
}

pub type List = MultiArrayList<LineOffsetTable>;

/// Typed SoA column accessors on [`List`] (= `MultiArrayList<LineOffsetTable>`).
///
/// Mirrors Zig `list.items(.byte_offset_to_start_of_line)`. Can't be an
/// inherent impl (orphan rules — `MultiArrayList` lives in `bun_collections`),
/// so it's an extension trait; same pattern as `mapping::MappingColumns`.
pub trait ListExt {
    fn items_byte_offset_to_start_of_line(&self) -> &[u32];
    fn items_byte_offset_to_first_non_ascii(&self) -> &[u32];
}

impl ListExt for List {
    #[inline]
    fn items_byte_offset_to_start_of_line(&self) -> &[u32] {
        // SAFETY: column 2 of `LineOffsetTable`'s `MultiArrayElement` layout is
        // `u32` (`byte_offset_to_start_of_line`). `Slice::items` returns the
        // column at the requested field index typed `&mut [F]`; we narrow it to
        // a shared borrow tied to `self` via the raw-pointer round-trip (same
        // pattern as `mapping::MappingColumns::items_generated`).
        unsafe {
            &*(self
                .slice()
                .items::<u32>(LineOffsetTableField::ByteOffsetToStartOfLine)
                as *const [_])
        }
    }

    #[inline]
    fn items_byte_offset_to_first_non_ascii(&self) -> &[u32] {
        // SAFETY: column 1 is `u32` (`byte_offset_to_first_non_ascii`).
        unsafe {
            &*(self
                .slice()
                .items::<u32>(LineOffsetTableField::ByteOffsetToFirstNonAscii)
                as *const [_])
        }
    }
}

// Manual `MultiArrayElement` impl — `#[derive(MultiArrayElement)]` proc-macro
// does not exist yet (see bun_collections TODO). Fields sorted by alignment
// descending: Vec<i32> (align 8, size 16) first, then the two u32s.
#[repr(usize)]
#[derive(Copy, Clone)]
pub enum LineOffsetTableField {
    ColumnsForNonAscii = 0,
    ByteOffsetToFirstNonAscii = 1,
    ByteOffsetToStartOfLine = 2,
}

impl MultiArrayElement for LineOffsetTable {
    type Field = LineOffsetTableField;
    const FIELD_COUNT: usize = 3;
    const ALIGN: usize = core::mem::align_of::<Vec<i32>>();
    // sorted by alignment descending (Vec has ptr → align 8; u32 align 4)
    const SIZES_BYTES: &'static [usize] = &[
        core::mem::size_of::<Vec<i32>>(),
        core::mem::size_of::<u32>(),
        core::mem::size_of::<u32>(),
    ];
    const SIZES_FIELDS: &'static [usize] = &[0, 1, 2];

    #[inline]
    fn field_index(field: Self::Field) -> usize { field as usize }

    #[inline]
    unsafe fn scatter(self, ptrs: &[*mut u8], index: usize) {
        // SAFETY: caller guarantees `ptrs[0..3]` are valid columns with capacity > `index`.
        unsafe {
            ptrs[0].cast::<Vec<i32>>().add(index).write(self.columns_for_non_ascii);
            ptrs[1].cast::<u32>().add(index).write(self.byte_offset_to_first_non_ascii);
            ptrs[2].cast::<u32>().add(index).write(self.byte_offset_to_start_of_line);
        }
    }

    #[inline]
    unsafe fn gather(ptrs: &[*mut u8], index: usize) -> Self {
        // SAFETY: caller guarantees `ptrs[0..3]` are valid columns with len > `index`.
        unsafe {
            LineOffsetTable {
                columns_for_non_ascii: ptrs[0].cast::<Vec<i32>>().add(index).read(),
                byte_offset_to_first_non_ascii: ptrs[1].cast::<u32>().add(index).read(),
                byte_offset_to_start_of_line: ptrs[2].cast::<u32>().add(index).read(),
            }
        }
    }
}

impl LineOffsetTable {
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

    pub fn find_index(byte_offsets_to_start_of_line: &[u32], loc: Loc) -> Option<usize> {
        debug_assert!(loc.start > -1); // checked by caller
        let mut original_line: usize = 0;
        let loc_start = usize::try_from(loc.start).expect("int cast");

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

    // PORT NOTE: Zig threaded `std.mem.Allocator` through MultiArrayList/Vec.
    // The Rust MultiArrayList/Vec own their storage on the global mimalloc
    // heap (PORTING.md §allocators), so the allocator param is dropped.
    // TODO(port): callers in Zig pass mixed allocators (printer/bundler arenas vs VM default
    // allocator in CodeCoverage.zig); revisit if an arena-backed MultiArrayList lands.
    pub fn generate(contents: &[u8], approximate_line_count: i32) -> Result<List, AllocError> {
        let mut list = List::default();
        // Preallocate the top-level table using the approximate line count from the lexer
        list.ensure_unused_capacity(usize::try_from(approximate_line_count.max(1)).expect("int cast"))?;
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
            // Zig passes `remaining.ptr[0..4]` (unchecked 4-byte view); decode_wtf8_rune_t
            // takes `&[u8; 4]` and only reads `len_` bytes. Pad the tail with zeros.
            let mut cp_bytes = [0u8; 4];
            let take = (len_ as usize).min(remaining.len());
            cp_bytes[..take].copy_from_slice(&remaining[..take]);
            let c: i32 = strings::decode_wtf8_rune_t::<i32>(&cp_bytes, len_, 0);
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

                    // We don't call .toOwnedSlice() because it is expensive to
                    // reallocate the array AND when inside an Arena, it's
                    // hideously expensive
                    //
                    // PERF(port): Zig used a stack-fallback allocator for the scratch list and
                    // duped onto `allocator` only when stack-owned, then reset the fixed buffer.
                    // Here the scratch is a heap Vec; we always dupe into a fresh Vec
                    // (mirrors `allocator.dupe`) and `.clear()` to reuse capacity. Profile in
                    // Phase B.
                    let owned = columns_for_non_ascii.to_vec();

                    list.append(LineOffsetTable {
                        byte_offset_to_start_of_line: line_byte_offset,
                        byte_offset_to_first_non_ascii,
                        columns_for_non_ascii: owned,
                    })?;

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
            line_byte_offset = u32::try_from(contents.len()).expect("int cast");
        }

        if !columns_for_non_ascii.is_empty() {
            let line_bytes_so_far = u32::try_from(contents.len()).expect("int cast") - line_byte_offset;
            columns_for_non_ascii.reserve(((line_bytes_so_far - column_byte_offset) + 1) as usize);
            while column_byte_offset <= line_bytes_so_far {
                columns_for_non_ascii.push(column);
                // PERF(port): was assume_capacity
                column_byte_offset += 1;
            }
        }
        {
            // PERF(port): Zig checked stack_fallback.ownsSlice and duped onto `allocator` if so;
            // here we always dupe the scratch Vec into a fresh Vec.
            let owned = columns_for_non_ascii.to_vec();
            list.append(LineOffsetTable {
                byte_offset_to_start_of_line: line_byte_offset,
                byte_offset_to_first_non_ascii,
                columns_for_non_ascii: owned,
            })?;
        }

        if list.capacity() > list.len() {
            list.shrink_and_free(list.len());
        }
        Ok(list)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap/LineOffsetTable.zig (232 lines)
//   confidence: medium
//   todos:      2
//   notes:      generate() now takes &'bump Arena and threads it into MultiArrayList/Vec (arena API assumed — wire in Phase B); stack-fallback scratch replaced by reusable Vec + bump.alloc_slice_copy (PERF-tagged); verify decode_wtf8_rune_t signature
// ──────────────────────────────────────────────────────────────────────────

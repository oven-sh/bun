use core::mem;

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
pub trait LineOffsetTableColumns {
    fn items_byte_offset_to_start_of_line(&self) -> &[u32];
    fn items_byte_offset_to_first_non_ascii(&self) -> &[u32];
}

impl LineOffsetTableColumns for List {
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

    /// `find_line` with an O(1) fast path for the printer's monotone access
    /// pattern. `add_source_mapping` is called once per printed AST node in
    /// (mostly) source order, so the result is almost always `hint`, `hint+1`,
    /// or `hint+2`. Perf on next-lint showed `find_line` at 0.85% self-time
    /// (≈90-120M cycles) doing a fresh bounds-checked binary search every
    /// call; this short-circuits to a couple of compares for the common case
    /// and falls back to the binary search otherwise.
    ///
    /// Zig spec (`LineOffsetTable.zig:20`) only has the binary search; this is
    /// a deliberate divergence — strictly cheaper, identical result.
    #[inline]
    pub fn find_line_with_hint(offsets: &[u32], loc: Loc, hint: u32) -> i32 {
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
        list.ensure_unused_capacity(approximate_line_count.max(1) as usize)?;
        let mut column: i32 = 0;
        let mut byte_offset_to_first_non_ascii: u32 = 0;
        let mut column_byte_offset: u32 = 0;
        let mut line_byte_offset: u32 = 0;

        // the idea here is:
        // we want to avoid re-allocating this array _most_ of the time
        // when lines _do_ have unicode characters, they probably still won't be longer than 255 much
        // PERF(port): Zig used `std.heap.stackFallback(@sizeOf(i32)*256)` — a 256-slot stack
        // buffer with heap spill. The direct Rust equivalent is `SmallVec<[i32; 256]>`: inline
        // storage stays on-stack, `into_vec()` at hand-over does the same "dupe if stack-owned,
        // move if spilled" branch Zig does, and `mem::take` resets to a fresh inline buffer
        // (zero alloc). Previously this was a heap `Vec::with_capacity(120)` re-primed via
        // `mem::replace` per non-ASCII line, which showed up as one mi_malloc(480) per such
        // line under `generate` (2× self-time vs Zig on lint/create-vite).
        let mut columns_for_non_ascii: SmallVec<[i32; 256]> = SmallVec::new();

        // Hoist the base pointer so per-iteration offset math is a single sub + truncate,
        // matching Zig's `@truncate(@intFromPtr(remaining.ptr) - @intFromPtr(contents.ptr))`.
        let base = contents.as_ptr() as usize;

        let mut remaining = contents;
        while !remaining.is_empty() {
            let b0 = remaining[0];
            let len_ = strings::wtf8_byte_sequence_length_with_invalid(b0);
            // Zig passes `remaining.ptr[0..4]` (unchecked 4-byte view) to decodeWTF8RuneT,
            // which only reads `len_` bytes. After the SIMD skip below lands, the loop head
            // is overwhelmingly an ASCII '\r'/'\n' or a non-ASCII lead byte, so keep the
            // 1-byte path branch-only and confine the zero+min+copy pad to the cold
            // multibyte arm.
            let c: i32 = if len_ == 1 {
                b0 as i32
            } else {
                let mut cp_bytes = [0u8; 4];
                let take = (len_ as usize).min(remaining.len());
                cp_bytes[..take].copy_from_slice(&remaining[..take]);
                strings::decode_wtf8_rune_t::<i32>(&cp_bytes, len_, 0)
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

                    // Zig used a stack-fallback allocator and duped onto `allocator` only when
                    // stack-owned, then reset the fixed buffer. `SmallVec::into_vec()` is the
                    // exact equivalent: inline → one alloc sized to content (Zig's `dupe`),
                    // spilled → moves the heap buffer (no alloc). `mem::take` re-primes a fresh
                    // inline scratch with zero allocation. ASCII-only lines (almost all of them)
                    // store an inline `Vec::new()` and keep the scratch untouched.
                    let owned = if columns_for_non_ascii.is_empty() {
                        Vec::new()
                    } else {
                        mem::take(&mut columns_for_non_ascii).into_vec()
                    };

                    list.append(LineOffsetTable {
                        byte_offset_to_start_of_line: line_byte_offset,
                        byte_offset_to_first_non_ascii,
                        columns_for_non_ascii: owned,
                    })?;

                    column = 0;
                    byte_offset_to_first_non_ascii = 0;
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
            let owned = if columns_for_non_ascii.is_empty() {
                Vec::new()
            } else {
                columns_for_non_ascii.into_vec()
            };
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

// ported from: src/sourcemap/LineOffsetTable.zig

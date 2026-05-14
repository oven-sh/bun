use core::cell::UnsafeCell;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use bun_ast::Loc;
use bun_collections::VecExt;
use bun_collections::bit_set::DynamicBitSet;
use bun_core::{self, ZigStringSlice, strings};
use bun_jsc::{JSGlobalObject, JSValue, VM, bun_string_jsc};
use bun_sourcemap::{
    self as sourcemap, LineOffsetTable, LineOffsetTableColumns as _, Ordinal, ParsedSourceMap,
    internal_source_map, line_offset_table,
};

type LinesHits = Vec<u32>;
type Bitset = DynamicBitSet;

/// Our code coverage currently only deals with lines of code, not statements or branches.
/// JSC doesn't expose function names in their coverage data, so we don't include that either :(.
/// Since we only need to store line numbers, our job gets simpler
///
/// We can use two bitsets to store code coverage data for a given file
/// 1. executable_lines
/// 2. lines_which_have_executed
///
/// Not all lines of code are executable. Comments, whitespace, empty lines, etc. are not executable.
/// It's not a problem for anyone if comments, whitespace, empty lines etc are not executed, so those should always be omitted from coverage reports
///
/// We use two bitsets since the typical size will be decently small,
/// bitsets are simple and bitsets are relatively fast to construct and query
pub struct Report {
    pub source_url: ZigStringSlice,
    pub executable_lines: Bitset,
    pub lines_which_have_executed: Bitset,
    pub line_hits: LinesHits,
    pub functions: Vec<Block>,
    pub functions_which_have_executed: Bitset,
    pub stmts_which_have_executed: Bitset,
    pub stmts: Vec<Block>,
    pub total_lines: u32,
}

impl Report {
    pub fn lines_coverage_fraction(&self) -> f64 {
        let mut intersected = self
            .executable_lines
            .clone()
            .unwrap_or_else(|_| bun_alloc::out_of_memory());
        intersected.set_intersection(&self.lines_which_have_executed);

        let total_count: f64 = self.executable_lines.count() as f64;
        if total_count == 0.0 {
            return 1.0;
        }

        let intersected_count: f64 = intersected.count() as f64;

        intersected_count / total_count
    }

    pub fn stmts_coverage_fraction(&self) -> f64 {
        let total_count: f64 = self.stmts.len() as f64;

        if total_count == 0.0 {
            return 1.0;
        }

        (self.stmts_which_have_executed.count() as f64) / total_count
    }

    pub fn function_coverage_fraction(&self) -> f64 {
        let total_count: f64 = self.functions.len() as f64;
        if total_count == 0.0 {
            return 1.0;
        }
        (self.functions_which_have_executed.count() as f64) / total_count
    }

    pub fn generate(
        global_this: &JSGlobalObject,
        byte_range_mapping: &mut ByteRangeMapping,
        ignore_sourcemap_: bool,
    ) -> Option<Report> {
        bun_jsc::mark_binding();
        // Use the raw `*mut VM` accessor instead of narrowing through `&VM` and
        // casting back to `*mut` — C++ mutates the VM (controlFlowProfiler /
        // functionHasExecutedCache), so we must preserve write provenance.
        let vm = global_this.vm_ptr();

        let mut result: Option<Report> = None;

        let mut generator = Generator {
            result: &mut result,
            byte_range_mapping,
        };

        // SAFETY: `vm` is the live `*mut VM` owning `global_this`; Generator and the
        // callback are kept alive for the duration of the FFI call;
        // CodeCoverage__withBlocksAndFunctions invokes the callback synchronously.
        let ok = unsafe {
            CodeCoverage__withBlocksAndFunctions(
                vm,
                generator.byte_range_mapping.source_id,
                (&raw mut generator).cast::<c_void>(),
                ignore_sourcemap_,
                Generator::do_,
            )
        };
        if !ok {
            return None;
        }

        result
    }
}

// Report::deinit only freed owned containers; Rust drops Bitset/Vec/Vec fields automatically.
// Note: source_url is NOT freed, matching the Zig deinit (caller owns it).

pub mod text {
    use super::*;
    // PORT NOTE: Zig `Output.prettyFmt(fmt, comptime bool)` is a comptime string
    // rewrite. The `pretty_fmt!` macro only accepts literal `true`/`false` today,
    // so call the runtime rewriter for the `ENABLE_COLORS` const-generic sites.
    // PERF(port): runtime `pretty_fmt` allocates a small Vec per call — profile in
    // Phase B; if hot, hoist into `const` once the proc-macro lands.
    use bun_core::output::pretty_fmt;
    use bun_io::Write as _;

    pub fn write_format_with_values<const ENABLE_COLORS: bool>(
        filename: &[u8],
        max_filename_length: usize,
        vals: Fraction,
        failing: Fraction,
        failed: bool,
        writer: &mut impl bun_io::Write,
        indent_name: bool,
    ) -> bun_io::Result<()> {
        if ENABLE_COLORS {
            if failed {
                writer.write_all(&pretty_fmt::<true>("<r><b><red>"))?;
            } else {
                writer.write_all(&pretty_fmt::<true>("<r><b><green>"))?;
            }
        }

        if indent_name {
            writer.write_all(b" ")?;
        }

        writer.write_all(filename)?;
        writer.splat_byte_all(
            b' ',
            max_filename_length - filename.len() + usize::from(!indent_name),
        )?;
        writer.write_all(&pretty_fmt::<ENABLE_COLORS>("<r><d> | <r>"))?;

        if ENABLE_COLORS {
            if vals.functions < failing.functions {
                writer.write_all(&pretty_fmt::<true>("<b><red>"))?;
            } else {
                writer.write_all(&pretty_fmt::<true>("<b><green>"))?;
            }
        }

        write!(writer, "{:>7.2}", vals.functions * 100.0)?;
        // writer.write_all(&pretty_fmt("<r><d> | <r>", ENABLE_COLORS))?;
        // if ENABLE_COLORS {
        //     // if vals.stmts < failing.stmts {
        //     writer.write_all(&pretty_fmt("<d>", true))?;
        //     // } else {
        //     //     writer.write_all(&pretty_fmt("<d>", true))?;
        //     // }
        // }
        // write!(writer, "{:>8.2}", vals.stmts * 100.0)?;
        writer.write_all(&pretty_fmt::<ENABLE_COLORS>("<r><d> | <r>"))?;

        if ENABLE_COLORS {
            if vals.lines < failing.lines {
                writer.write_all(&pretty_fmt::<true>("<b><red>"))?;
            } else {
                writer.write_all(&pretty_fmt::<true>("<b><green>"))?;
            }
        }

        write!(writer, "{:>7.2}", vals.lines * 100.0)?;
        Ok(())
    }

    pub fn write_format<const ENABLE_COLORS: bool>(
        report: &Report,
        max_filename_length: usize,
        fraction: &mut Fraction,
        base_path: &[u8],
        writer: &mut impl bun_io::Write,
    ) -> bun_io::Result<()> {
        let failing = *fraction;
        let fns = report.function_coverage_fraction();
        let lines = report.lines_coverage_fraction();
        let stmts = report.stmts_coverage_fraction();
        fraction.functions = fns;
        fraction.lines = lines;
        fraction.stmts = stmts;

        let failed = fns < failing.functions || lines < failing.lines; // || stmts < failing.stmts;
        fraction.failing = failed;

        let mut filename = report.source_url.slice();
        if !base_path.is_empty() {
            filename = bun_paths::resolve_path::relative(base_path, filename);
        }

        write_format_with_values::<ENABLE_COLORS>(
            filename,
            max_filename_length,
            *fraction,
            failing,
            failed,
            writer,
            true,
        )?;

        writer.write_all(&pretty_fmt::<ENABLE_COLORS>("<r><d> | <r>"))?;

        let mut executable_lines_that_havent_been_executed = report
            .lines_which_have_executed
            .clone()
            .unwrap_or_else(|_| bun_alloc::out_of_memory());
        executable_lines_that_havent_been_executed.toggle_all();

        // This sets statements in executed scopes
        executable_lines_that_havent_been_executed.set_intersection(&report.executable_lines);

        let mut iter = executable_lines_that_havent_been_executed.iterator::<true, true>();
        let mut start_of_line_range: usize = 0;
        let mut prev_line: usize = 0;
        let mut is_first = true;

        // PORT NOTE: `concat!(pretty_fmt!(..), "{}")` requires a literal; split into a
        // prefix `write_all` + plain `write!` so the const-generic `ENABLE_COLORS` can
        // route through the runtime rewriter.
        let red = pretty_fmt::<ENABLE_COLORS>("<red>");
        let comma = pretty_fmt::<ENABLE_COLORS>("<r><d>,<r>");

        while let Some(next_line) = iter.next() {
            if next_line == (prev_line + 1) {
                prev_line = next_line;
                continue;
            } else if is_first && start_of_line_range == 0 && prev_line == 0 {
                start_of_line_range = next_line;
                prev_line = next_line;
                continue;
            }

            if is_first {
                is_first = false;
            } else {
                writer.write_all(&comma)?;
            }

            if start_of_line_range == prev_line {
                writer.write_all(&red)?;
                write!(writer, "{}", start_of_line_range + 1)?;
            } else {
                writer.write_all(&red)?;
                write!(writer, "{}-{}", start_of_line_range + 1, prev_line + 1)?;
            }

            prev_line = next_line;
            start_of_line_range = next_line;
        }

        if prev_line != start_of_line_range {
            if is_first {
                #[allow(unused_assignments)]
                {
                    is_first = false;
                }
            } else {
                writer.write_all(&comma)?;
            }

            if start_of_line_range == prev_line {
                writer.write_all(&red)?;
                write!(writer, "{}", start_of_line_range + 1)?;
            } else {
                writer.write_all(&red)?;
                write!(writer, "{}-{}", start_of_line_range + 1, prev_line + 1)?;
            }
        }
        Ok(())
    }
}

pub mod lcov {
    use super::*;
    use bun_io::Write as _;

    pub fn write_format(
        report: &Report,
        base_path: &[u8],
        writer: &mut impl bun_io::Write,
    ) -> bun_io::Result<()> {
        let mut filename = report.source_url.slice();
        if !base_path.is_empty() {
            filename = bun_paths::resolve_path::relative(base_path, filename);
        }

        // TN: test name
        // Empty value appears fine. For example, `TN:`.
        writer.write_all(b"TN:\n")?;

        // SF: Source File path
        // For example, `SF:path/to/source.ts`
        // Sanitize newlines so a crafted source path cannot inject extra LCOV records.
        writer.write_all(b"SF:")?;
        for &byte in filename {
            match byte {
                b'\n' | b'\r' => writer.write_all(b"?")?,
                byte => writer.write_all(&[byte])?,
            }
        }
        writer.write_all(b"\n")?;

        // ** Per-function coverage not supported yet, since JSC does not support function names yet. **
        // FN: line number,function name

        // FNF: functions found
        write!(writer, "FNF:{}\n", report.functions.len())?;

        // FNH: functions hit
        write!(
            writer,
            "FNH:{}\n",
            report.functions_which_have_executed.count()
        )?;

        // ** Track all executable lines **
        // Executable lines that were not hit should be marked as 0
        // PORT NOTE: Zig cloned the bitset before iterating; `DynamicBitSet::iterator`
        // borrows `&self` so the clone is unnecessary.
        let mut iter = report.executable_lines.iterator::<true, true>();

        // ** Branch coverage not supported yet, since JSC does not support those yet. ** //
        // BRDA: line, block, (expressions,count)+
        // BRF: branches found
        // BRH: branches hit
        let line_hits = report.line_hits.slice();
        while let Some(line) = iter.next() {
            // DA: line number, hit count
            write!(writer, "DA:{},{}\n", line + 1, line_hits[line])?;
        }

        // LF: lines found
        write!(writer, "LF:{}\n", report.executable_lines.count())?;

        // LH: lines hit
        write!(writer, "LH:{}\n", report.lines_which_have_executed.count())?;

        writer.write_all(b"end_of_record\n")?;
        Ok(())
    }
}

// TODO(port): move to sourcemap_jsc_sys
unsafe extern "C" {
    fn CodeCoverage__withBlocksAndFunctions(
        vm: *mut VM,
        source_id: i32,
        ctx: *mut c_void,
        ignore_sourcemap: bool,
        cb: extern "C" fn(*mut Generator, *const BasicBlockRange, usize, usize, bool),
    ) -> bool;
}

struct Generator<'a> {
    byte_range_mapping: &'a mut ByteRangeMapping,
    result: &'a mut Option<Report>,
}

impl<'a> Generator<'a> {
    extern "C" fn do_(
        this: *mut Generator,
        blocks_ptr: *const BasicBlockRange,
        blocks_len: usize,
        function_start_offset: usize,
        ignore_sourcemap: bool,
    ) {
        // SAFETY: `this` was passed as &mut Generator to CodeCoverage__withBlocksAndFunctions
        // and is valid for the duration of this synchronous callback.
        let this = unsafe { &mut *this };
        // The C++ side (CodeCoverage.cpp) invokes this callback with `(nullptr, 0, 0)` when
        // basicBlocks is empty. `core::slice::from_raw_parts` requires a non-null, aligned
        // pointer even for zero-length slices, so we must bail before constructing the slice
        // (matches the Zig spec, which early-returns on `blocks.len == 0`).
        if blocks_len == 0 {
            return;
        }
        // SAFETY: blocks_len != 0, so blocks_ptr[0..blocks_len] is a valid contiguous C array
        // provided by JSC for the duration of this synchronous callback.
        let all = unsafe { core::slice::from_raw_parts(blocks_ptr, blocks_len) };
        let blocks: &[BasicBlockRange] = &all[0..function_start_offset];
        let mut function_blocks: &[BasicBlockRange] = &all[function_start_offset..blocks_len];
        if function_blocks.len() > 1 {
            function_blocks = &function_blocks[1..];
        }

        if blocks.is_empty() {
            return;
        }

        // PORT NOTE: Zig assigns the slice by value with no ownership transfer here.
        // `from_utf8_never_free` already detaches the lifetime by design, and
        // `generate_report_from_blocks` only borrows `&self`, so no &/&mut overlap.
        let source_url =
            ZigStringSlice::from_utf8_never_free(this.byte_range_mapping.source_url.slice());
        *this.result = this
            .byte_range_mapping
            .generate_report_from_blocks(source_url, blocks, function_blocks, ignore_sourcemap)
            .ok();
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct BasicBlockRange {
    start_offset: c_int,
    end_offset: c_int,
    has_executed: bool,
    execution_count: usize,
}

impl Default for BasicBlockRange {
    fn default() -> Self {
        Self {
            start_offset: 0,
            end_offset: 0,
            has_executed: false,
            execution_count: 0,
        }
    }
}

pub struct ByteRangeMapping {
    pub line_offset_table: line_offset_table::List,
    pub source_id: i32,
    pub source_url: ZigStringSlice,
}

// TODO(port): IdentityContext(u64) hasher — key is already a wyhash, hash fn should be identity
pub type ByteRangeMappingHashMap = bun_collections::HashMap<u64, ByteRangeMapping>;

thread_local! {
    // Lazily-initialized per-thread map. Stored behind `Box` so the address of the
    // `HashMap` is stable for the lifetime of the thread (extern "C" fns return
    // `*mut ByteRangeMapping` pointing into it). The Box is **owned** by the
    // thread-local — it is dropped on thread exit, never leaked (PORTING.md
    // §Forbidden: no Box::leak).
    static MAP: UnsafeCell<Option<Box<ByteRangeMappingHashMap>>> =
        const { UnsafeCell::new(None) };
}

/// Returns a raw pointer to this thread's map, lazily creating it.
/// The pointer is valid until thread exit (the Box is pinned in the thread-local
/// slot and never moved or dropped earlier).
fn thread_map() -> *mut ByteRangeMappingHashMap {
    MAP.with(|cell| {
        // SAFETY: thread-local; no other reference to this UnsafeCell can exist
        // concurrently on this thread while we hold this exclusive borrow.
        let slot = unsafe { &mut *cell.get() };
        if slot.is_none() {
            *slot = Some(Box::new(ByteRangeMappingHashMap::default()));
        }
        // SAFETY: just ensured Some above; Box deref gives stable address.
        &raw mut **slot.as_mut().unwrap()
    })
}

/// Returns a raw pointer to this thread's map if it has been created, else null.
fn thread_map_opt() -> Option<NonNull<ByteRangeMappingHashMap>> {
    MAP.with(|cell| {
        // SAFETY: thread-local exclusive access.
        let slot = unsafe { &mut *cell.get() };
        slot.as_mut().map(|b| NonNull::from(&mut **b))
    })
}

impl ByteRangeMapping {
    /// Zig: `pub threadlocal var map: ?*HashMap = null;` — read-only accessor
    /// for the per-thread `ByteRangeMappingHashMap`. Returns `None` if no
    /// coverage data was recorded on this thread.
    ///
    /// The pointer borrows the thread-local `Box`, which is pinned for the
    /// thread's lifetime and never re-entered while the caller holds it
    /// (single-threaded CLI report path). Callers reborrow per-access —
    /// PORTING.md §Global mutable state.
    pub fn map() -> Option<NonNull<ByteRangeMappingHashMap>> {
        thread_map_opt()
    }

    pub fn is_less_than(_: (), a: &ByteRangeMapping, b: &ByteRangeMapping) -> bool {
        strings::order(a.source_url.slice(), b.source_url.slice()) == core::cmp::Ordering::Less
    }

    pub fn generate_report_from_blocks(
        &self,
        source_url: ZigStringSlice,
        blocks: &[BasicBlockRange],
        function_blocks: &[BasicBlockRange],
        ignore_sourcemap: bool,
    ) -> Result<Report, bun_alloc::AllocError> {
        let line_starts = self.line_offset_table.items_byte_offset_to_start_of_line();

        let mut executable_lines: Bitset = Bitset::default();
        let mut lines_which_have_executed: Bitset = Bitset::default();
        // PORT NOTE: Zig's `SavedSourceMap.get` returns a `?*ParsedSourceMap` with a +1
        // intrusive ref (Zig: `defer if (parsed_mappings_) |p| p.deref()`). The Rust port
        // models this as `Option<Arc<ParsedSourceMap>>`, so the +1 is released
        // automatically when `parsed_mappings_` drops at scope exit — no explicit guard
        // is required.
        let parsed_mappings_: Option<std::sync::Arc<ParsedSourceMap>> =
            // SAFETY: `VirtualMachine::get()` returns the live singleton `*mut VirtualMachine`
            // with full write provenance; dereference to call the `&mut self` accessor.
            bun_jsc::VirtualMachine::VirtualMachine::get().as_mut()
                .source_mappings()
                .get(source_url.slice());
        let mut line_hits = LinesHits::default();

        let mut functions: Vec<Block> = Vec::new();
        functions.reserve_exact(function_blocks.len());
        let mut functions_which_have_executed: Bitset = Bitset::init_empty(function_blocks.len())?;
        let mut stmts_which_have_executed: Bitset = Bitset::init_empty(blocks.len())?;

        let mut stmts: Vec<Block> = Vec::new();
        stmts.reserve_exact(function_blocks.len());

        let mut line_count: u32 = 0;

        if ignore_sourcemap || parsed_mappings_.is_none() {
            line_count = line_starts.len() as u32;
            executable_lines = Bitset::init_empty(line_count as usize)?;
            lines_which_have_executed = Bitset::init_empty(line_count as usize)?;
            line_hits = vec![0u32; line_count as usize];
            let line_hits_slice = line_hits.as_mut_slice();

            for (i, block) in blocks.iter().enumerate() {
                if block.end_offset < 0 || block.start_offset < 0 {
                    continue; // does not map to anything
                }

                let min: usize =
                    usize::try_from(block.start_offset.min(block.end_offset)).expect("int cast");
                let max: usize =
                    usize::try_from(block.start_offset.max(block.end_offset)).expect("int cast");
                let mut min_line: u32 = u32::MAX;
                let mut max_line: u32 = 0;

                let has_executed = block.has_executed || block.execution_count > 0;

                for byte_offset in min..max {
                    let Some(new_line_index) = LineOffsetTable::find_index(
                        line_starts,
                        Loc {
                            start: i32::try_from(byte_offset).expect("int cast"),
                        },
                    ) else {
                        continue;
                    };
                    let line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset as usize) >= byte_offset {
                        continue;
                    }

                    let line: u32 = u32::try_from(new_line_index).expect("int cast");
                    min_line = min_line.min(line);
                    max_line = max_line.max(line);

                    executable_lines.set(line as usize);
                    if has_executed {
                        lines_which_have_executed.set(line as usize);
                        line_hits_slice[line as usize] += 1;
                    }
                }

                if min_line != u32::MAX {
                    if has_executed {
                        stmts_which_have_executed.set(i);
                    }

                    stmts.push(Block {
                        start_line: min_line,
                        end_line: max_line,
                    });
                }
            }

            for (i, function) in function_blocks.iter().enumerate() {
                if function.end_offset < 0 || function.start_offset < 0 {
                    continue; // does not map to anything
                }

                let min: usize = usize::try_from(function.start_offset.min(function.end_offset))
                    .expect("int cast");
                let max: usize = usize::try_from(function.start_offset.max(function.end_offset))
                    .expect("int cast");
                let mut min_line: u32 = u32::MAX;
                let mut max_line: u32 = 0;

                for byte_offset in min..max {
                    let Some(new_line_index) = LineOffsetTable::find_index(
                        line_starts,
                        Loc {
                            start: i32::try_from(byte_offset).expect("int cast"),
                        },
                    ) else {
                        continue;
                    };
                    let line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset as usize) >= byte_offset {
                        continue;
                    }

                    let line: u32 = u32::try_from(new_line_index).expect("int cast");
                    min_line = min_line.min(line);
                    max_line = max_line.max(line);
                }

                let did_fn_execute = function.execution_count > 0 || function.has_executed;

                // only mark the lines as executable if the function has not executed
                // functions that have executed have non-executable lines in them and thats fine.
                if !did_fn_execute {
                    let end = max_line.min(line_count);
                    line_hits_slice[min_line as usize..end as usize].fill(0);
                    for line in min_line..end {
                        executable_lines.set(line as usize);
                        lines_which_have_executed.unset(line as usize);
                    }
                }

                functions.push(Block {
                    start_line: min_line,
                    end_line: max_line,
                });

                if did_fn_execute {
                    functions_which_have_executed.set(i);
                }
            }
        } else if let Some(parsed_mapping) = parsed_mappings_.as_deref() {
            line_count = (parsed_mapping.input_line_count as u32) + 1;
            executable_lines = Bitset::init_empty(line_count as usize)?;
            lines_which_have_executed = Bitset::init_empty(line_count as usize)?;
            line_hits = vec![0u32; line_count as usize];
            let line_hits_slice = line_hits.as_mut_slice();

            let mut cur_: Option<internal_source_map::Cursor> = parsed_mapping.internal_cursor();

            for (i, block) in blocks.iter().enumerate() {
                if block.end_offset < 0 || block.start_offset < 0 {
                    continue; // does not map to anything
                }

                let min: usize =
                    usize::try_from(block.start_offset.min(block.end_offset)).expect("int cast");
                let max: usize =
                    usize::try_from(block.start_offset.max(block.end_offset)).expect("int cast");
                let mut min_line: u32 = u32::MAX;
                let mut max_line: u32 = 0;
                let has_executed = block.has_executed || block.execution_count > 0;

                for byte_offset in min..max {
                    let Some(new_line_index) = LineOffsetTable::find_index(
                        line_starts,
                        Loc {
                            start: i32::try_from(byte_offset).expect("int cast"),
                        },
                    ) else {
                        continue;
                    };
                    let line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset as usize) >= byte_offset {
                        continue;
                    }
                    let column_position =
                        byte_offset.saturating_sub(line_start_byte_offset as usize);

                    let found: Option<bun_sourcemap::Mapping> = if let Some(c) = cur_.as_mut() {
                        c.move_to(
                            Ordinal::from_zero_based(
                                i32::try_from(new_line_index).expect("int cast"),
                            ),
                            Ordinal::from_zero_based(
                                i32::try_from(column_position).expect("int cast"),
                            ),
                        )
                    } else {
                        parsed_mapping.find_mapping(
                            Ordinal::from_zero_based(
                                i32::try_from(new_line_index).expect("int cast"),
                            ),
                            Ordinal::from_zero_based(
                                i32::try_from(column_position).expect("int cast"),
                            ),
                        )
                    };
                    if let Some(point) = found.as_ref() {
                        if point.original.lines.zero_based() < 0 {
                            continue;
                        }

                        let line: u32 =
                            u32::try_from(point.original.lines.zero_based()).expect("int cast");
                        if line >= line_count {
                            continue;
                        }

                        executable_lines.set(line as usize);
                        if has_executed {
                            lines_which_have_executed.set(line as usize);
                            line_hits_slice[line as usize] += 1;
                        }

                        min_line = min_line.min(line);
                        max_line = max_line.max(line);
                    }
                }

                if min_line != u32::MAX {
                    stmts.push(Block {
                        start_line: min_line,
                        end_line: max_line,
                    });

                    if has_executed {
                        stmts_which_have_executed.set(i);
                    }
                }
            }

            for (i, function) in function_blocks.iter().enumerate() {
                if function.end_offset < 0 || function.start_offset < 0 {
                    continue; // does not map to anything
                }

                let min: usize = usize::try_from(function.start_offset.min(function.end_offset))
                    .expect("int cast");
                let max: usize = usize::try_from(function.start_offset.max(function.end_offset))
                    .expect("int cast");
                let mut min_line: u32 = u32::MAX;
                let mut max_line: u32 = 0;

                for byte_offset in min..max {
                    let Some(new_line_index) = LineOffsetTable::find_index(
                        line_starts,
                        Loc {
                            start: i32::try_from(byte_offset).expect("int cast"),
                        },
                    ) else {
                        continue;
                    };
                    let line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset as usize) >= byte_offset {
                        continue;
                    }

                    let column_position =
                        byte_offset.saturating_sub(line_start_byte_offset as usize);

                    let found: Option<bun_sourcemap::Mapping> = if let Some(c) = cur_.as_mut() {
                        c.move_to(
                            Ordinal::from_zero_based(
                                i32::try_from(new_line_index).expect("int cast"),
                            ),
                            Ordinal::from_zero_based(
                                i32::try_from(column_position).expect("int cast"),
                            ),
                        )
                    } else {
                        parsed_mapping.find_mapping(
                            Ordinal::from_zero_based(
                                i32::try_from(new_line_index).expect("int cast"),
                            ),
                            Ordinal::from_zero_based(
                                i32::try_from(column_position).expect("int cast"),
                            ),
                        )
                    };
                    if let Some(point) = found {
                        if point.original.lines.zero_based() < 0 {
                            continue;
                        }

                        let line: u32 =
                            u32::try_from(point.original.lines.zero_based()).expect("int cast");
                        if line >= line_count {
                            continue;
                        }
                        min_line = min_line.min(line);
                        max_line = max_line.max(line);
                    }
                }

                // no sourcemaps? ignore it
                if min_line == u32::MAX && max_line == 0 {
                    continue;
                }

                let did_fn_execute = function.execution_count > 0 || function.has_executed;

                // only mark the lines as executable if the function has not executed
                // functions that have executed have non-executable lines in them and thats fine.
                if !did_fn_execute {
                    let end = max_line.min(line_count);
                    for line in min_line..end {
                        executable_lines.set(line as usize);
                        lines_which_have_executed.unset(line as usize);
                        line_hits_slice[line as usize] = 0;
                    }
                }

                functions.push(Block {
                    start_line: min_line,
                    end_line: max_line,
                });
                if did_fn_execute {
                    functions_which_have_executed.set(i);
                }
            }
        } else {
            unreachable!();
        }

        Ok(Report {
            source_url,
            functions,
            executable_lines,
            lines_which_have_executed,
            line_hits,
            total_lines: line_count,
            stmts,
            functions_which_have_executed,
            stmts_which_have_executed,
        })
    }

    pub fn compute(
        source_contents: &[u8],
        source_id: i32,
        source_url: ZigStringSlice,
    ) -> ByteRangeMapping {
        ByteRangeMapping {
            // TODO(port): VirtualMachine::get().allocator dropped — LineOffsetTable::generate uses global mimalloc
            line_offset_table: LineOffsetTable::generate(source_contents, 0)
                .unwrap_or_else(|_| bun_alloc::out_of_memory()),
            source_id,
            source_url,
        }
    }
}

// ByteRangeMapping::deinit only freed line_offset_table; Rust drops it automatically.
// source_url is NOT freed, matching Zig deinit.

#[unsafe(no_mangle)]
pub extern "C" fn ByteRangeMapping__generate(
    str_: bun_core::String,
    source_contents_str: bun_core::String,
    source_id: i32,
) {
    // SAFETY: thread_map() returns a pointer into this thread's owned Box<HashMap>;
    // valid for the lifetime of the thread, and we are the only mutable accessor on
    // this thread for the duration of this call.
    let map = unsafe { &mut *thread_map() };

    let slice = str_.to_utf8();
    let hash = bun_wyhash::hash(slice.slice());
    // TODO(port): getOrPut → entry API; verify ByteRangeMapping is properly dropped on overwrite
    let source_contents = source_contents_str.to_utf8();

    let new_value = ByteRangeMapping::compute(source_contents.slice(), source_id, slice);
    map.insert(hash, new_value);
    // `source_contents` drops here (matches `defer source_contents.deinit()`).
    // Note: `slice` ownership transferred into the new ByteRangeMapping.source_url.
}

#[unsafe(no_mangle)]
pub extern "C" fn ByteRangeMapping__getSourceID(this: *mut ByteRangeMapping) -> i32 {
    // SAFETY: `this` is a valid pointer obtained from ByteRangeMapping__find.
    unsafe { (*this).source_id }
}

#[unsafe(no_mangle)]
pub extern "C" fn ByteRangeMapping__find(
    path: bun_core::String,
) -> Option<NonNull<ByteRangeMapping>> {
    let slice = path.to_utf8();

    let map_ptr = thread_map_opt()?;
    // SAFETY: map_ptr points into this thread's owned Box; valid until thread exit.
    let map = unsafe { &mut *map_ptr.as_ptr() };
    let hash = bun_wyhash::hash(slice.slice());
    let entry = map.get_mut(&hash)?;
    Some(NonNull::from(entry))
}

#[unsafe(no_mangle)]
pub extern "C" fn ByteRangeMapping__findExecutedLines(
    global_this: &JSGlobalObject,
    source_url: bun_core::String,
    blocks_ptr: *const BasicBlockRange,
    blocks_len: usize,
    function_start_offset: usize,
    ignore_sourcemap: bool,
) -> JSValue {
    let Some(this_ptr) = ByteRangeMapping__find(source_url.clone()) else {
        return JSValue::NULL;
    };
    // SAFETY: pointer into the thread-local map, valid for this call.
    let this = unsafe { &*this_ptr.as_ptr() };

    // SAFETY: blocks_ptr[0..blocks_len] is a valid contiguous C array from JSC.
    let all = unsafe { core::slice::from_raw_parts(blocks_ptr, blocks_len) };
    let blocks: &[BasicBlockRange] = &all[0..function_start_offset];
    let mut function_blocks: &[BasicBlockRange] = &all[function_start_offset..blocks_len];
    if function_blocks.len() > 1 {
        function_blocks = &function_blocks[1..];
    }
    let url_slice = source_url.to_utf8();
    let report = match this.generate_report_from_blocks(
        url_slice,
        blocks,
        function_blocks,
        ignore_sourcemap,
    ) {
        Ok(r) => r,
        Err(_) => return global_this.throw_out_of_memory_value(),
    };

    let mut coverage_fraction = Fraction::default();

    // PORT NOTE: std.Io.Writer.Allocating → Vec<u8> byte buffer (bun_io::Write target).
    let mut buf: Vec<u8> = Vec::new();

    if text::write_format::<false>(
        &report,
        source_url.utf8_byte_length(),
        &mut coverage_fraction,
        b"",
        &mut buf,
    )
    .is_err()
    {
        return global_this.throw_out_of_memory_value();
    }

    // flush is a no-op for Vec<u8> writer.

    let Ok(v) = bun_string_jsc::create_utf8_for_js(global_this, &buf) else {
        return JSValue::ZERO;
    };
    v
}

// move-out: TYPE_ONLY → bun_options_types::code_coverage_options::Fraction.
// Lifted into options_types so the CLI tier can hold `CodeCoverageOptions.fractions`
// without depending on tier-6 sourcemap_jsc; re-exported here so coverage report
// writers and the test runner share one definition.
pub use bun_options_types::code_coverage_options::Fraction;

#[derive(Clone, Copy, Default)]
pub struct Block {
    pub start_line: u32,
    pub end_line: u32,
}

// ported from: src/sourcemap_jsc/CodeCoverage.zig

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use bun_io::Write as _;

use bun_collections::{BabyList, DynamicBitSet};
use bun_core::pretty_fmt; // TODO(port): comptime ANSI tag expander macro (Output.prettyFmt)
use bun_jsc::{JSGlobalObject, JSValue, VirtualMachine, VM};
use bun_sourcemap::{self as sourcemap, LineOffsetTable};
use bun_str::{self, strings, ZigString};

type LinesHits = BabyList<u32>;
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
    pub source_url: ZigString::Slice,
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
        let mut intersected = self.executable_lines.clone();
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
        bun_jsc::mark_binding!();
        let vm = global_this.vm();

        let mut result: Option<Report> = None;

        let mut generator = Generator {
            result: &mut result,
            byte_range_mapping,
        };

        // SAFETY: Generator and the callback are kept alive for the duration of the FFI call;
        // CodeCoverage__withBlocksAndFunctions invokes the callback synchronously.
        let ok = unsafe {
            CodeCoverage__withBlocksAndFunctions(
                vm,
                generator.byte_range_mapping.source_id,
                (&mut generator as *mut Generator).cast::<c_void>(),
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

// Report::deinit only freed owned containers; Rust drops Bitset/BabyList/Vec fields automatically.
// Note: source_url is NOT freed, matching the Zig deinit (caller owns it).

pub mod text {
    use super::*;

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
                writer.write_all(pretty_fmt!("<r><b><red>", true).as_bytes())?;
            } else {
                writer.write_all(pretty_fmt!("<r><b><green>", true).as_bytes())?;
            }
        }

        if indent_name {
            writer.write_all(b" ")?;
        }

        writer.write_all(filename)?;
        // TODO(port): splatByteAll — write N spaces without intermediate allocation
        write!(
            writer,
            "{:1$}",
            "",
            max_filename_length - filename.len() + usize::from(!indent_name)
        )?;
        writer.write_all(pretty_fmt!("<r><d> | <r>", ENABLE_COLORS).as_bytes())?;

        if ENABLE_COLORS {
            if vals.functions < failing.functions {
                writer.write_all(pretty_fmt!("<b><red>", true).as_bytes())?;
            } else {
                writer.write_all(pretty_fmt!("<b><green>", true).as_bytes())?;
            }
        }

        write!(writer, "{:>7.2}", vals.functions * 100.0)?;
        // writer.write_all(pretty_fmt!("<r><d> | <r>", ENABLE_COLORS).as_bytes())?;
        // if ENABLE_COLORS {
        //     // if vals.stmts < failing.stmts {
        //     writer.write_all(pretty_fmt!("<d>", true).as_bytes())?;
        //     // } else {
        //     //     writer.write_all(pretty_fmt!("<d>", true).as_bytes())?;
        //     // }
        // }
        // write!(writer, "{:>8.2}", vals.stmts * 100.0)?;
        writer.write_all(pretty_fmt!("<r><d> | <r>", ENABLE_COLORS).as_bytes())?;

        if ENABLE_COLORS {
            if vals.lines < failing.lines {
                writer.write_all(pretty_fmt!("<b><red>", true).as_bytes())?;
            } else {
                writer.write_all(pretty_fmt!("<b><green>", true).as_bytes())?;
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
            filename = bun_paths::relative(base_path, filename);
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

        writer.write_all(pretty_fmt!("<r><d> | <r>", ENABLE_COLORS).as_bytes())?;

        let mut executable_lines_that_havent_been_executed = report.lines_which_have_executed.clone();
        executable_lines_that_havent_been_executed.toggle_all();

        // This sets statements in executed scopes
        executable_lines_that_havent_been_executed.set_intersection(&report.executable_lines);

        let mut iter = executable_lines_that_havent_been_executed.iter_set();
        let mut start_of_line_range: usize = 0;
        let mut prev_line: usize = 0;
        let mut is_first = true;

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
                write!(writer, "{}", pretty_fmt!("<r><d>,<r>", ENABLE_COLORS))?;
            }

            if start_of_line_range == prev_line {
                write!(
                    writer,
                    concat!(pretty_fmt!("<red>", ENABLE_COLORS), "{}"),
                    start_of_line_range + 1
                )?;
            } else {
                write!(
                    writer,
                    concat!(pretty_fmt!("<red>", ENABLE_COLORS), "{}-{}"),
                    start_of_line_range + 1,
                    prev_line + 1
                )?;
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
                write!(writer, "{}", pretty_fmt!("<r><d>,<r>", ENABLE_COLORS))?;
            }

            if start_of_line_range == prev_line {
                write!(
                    writer,
                    concat!(pretty_fmt!("<red>", ENABLE_COLORS), "{}"),
                    start_of_line_range + 1
                )?;
            } else {
                write!(
                    writer,
                    concat!(pretty_fmt!("<red>", ENABLE_COLORS), "{}-{}"),
                    start_of_line_range + 1,
                    prev_line + 1
                )?;
            }
        }
        Ok(())
    }
}

pub mod lcov {
    use super::*;

    pub fn write_format(
        report: &Report,
        base_path: &[u8],
        writer: &mut impl bun_io::Write,
    ) -> bun_io::Result<()> {
        let mut filename = report.source_url.slice();
        if !base_path.is_empty() {
            filename = bun_paths::relative(base_path, filename);
        }

        // TN: test name
        // Empty value appears fine. For example, `TN:`.
        writer.write_all(b"TN:\n")?;

        // SF: Source File path
        // For example, `SF:path/to/source.ts`
        write!(writer, "SF:{}\n", bstr::BStr::new(filename))?;

        // ** Per-function coverage not supported yet, since JSC does not support function names yet. **
        // FN: line number,function name

        // FNF: functions found
        write!(writer, "FNF:{}\n", report.functions.len())?;

        // FNH: functions hit
        write!(writer, "FNH:{}\n", report.functions_which_have_executed.count())?;

        // ** Track all executable lines **
        // Executable lines that were not hit should be marked as 0
        let executable_lines = report.executable_lines.clone();
        let iter = executable_lines.iter_set();

        // ** Branch coverage not supported yet, since JSC does not support those yet. ** //
        // BRDA: line, block, (expressions,count)+
        // BRF: branches found
        // BRH: branches hit
        let line_hits = report.line_hits.slice();
        for line in iter {
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
        // and is valid for the duration of this synchronous callback. blocks_ptr[0..blocks_len]
        // is a valid contiguous C array provided by JSC.
        let this = unsafe { &mut *this };
        let all = unsafe { core::slice::from_raw_parts(blocks_ptr, blocks_len) };
        let blocks: &[BasicBlockRange] = &all[0..function_start_offset];
        let mut function_blocks: &[BasicBlockRange] = &all[function_start_offset..blocks_len];
        if function_blocks.len() > 1 {
            function_blocks = &function_blocks[1..];
        }

        if blocks.is_empty() {
            return;
        }

        // PORT NOTE: reshaped for borrowck — capture source_url before &mut self call
        let source_url = this.byte_range_mapping.source_url.clone();
        *this.result = this
            .byte_range_mapping
            .generate_report_from_blocks(source_url, blocks, function_blocks, ignore_sourcemap)
            .ok();
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct BasicBlockRange {
    start_offset: c_int,
    end_offset: c_int,
    has_executed: bool,
    execution_count: usize,
}

impl Default for BasicBlockRange {
    fn default() -> Self {
        Self { start_offset: 0, end_offset: 0, has_executed: false, execution_count: 0 }
    }
}

pub struct ByteRangeMapping {
    pub line_offset_table: LineOffsetTable::List,
    pub source_id: i32,
    pub source_url: ZigString::Slice,
}

// TODO(port): IdentityContext(u64) hasher — key is already a wyhash, hash fn should be identity
pub type ByteRangeMappingHashMap = bun_collections::HashMap<u64, ByteRangeMapping>;

thread_local! {
    // Stored as a leaked raw pointer to match Zig semantics: extern "C" fns return
    // *ByteRangeMapping pointing into this map, which must remain stable across calls.
    static MAP: Cell<Option<NonNull<ByteRangeMappingHashMap>>> = const { Cell::new(None) };
}

impl ByteRangeMapping {
    pub fn is_less_than(_: (), a: &ByteRangeMapping, b: &ByteRangeMapping) -> bool {
        strings::order(a.source_url.slice(), b.source_url.slice()) == core::cmp::Ordering::Less
    }

    pub fn generate_report_from_blocks(
        &mut self,
        source_url: ZigString::Slice,
        blocks: &[BasicBlockRange],
        function_blocks: &[BasicBlockRange],
        ignore_sourcemap: bool,
    ) -> Result<Report, bun_alloc::AllocError> {
        let line_starts = self.line_offset_table.items_byte_offset_to_start_of_line();

        let mut executable_lines: Bitset = Bitset::default();
        let mut lines_which_have_executed: Bitset = Bitset::default();
        let parsed_mappings_ = VirtualMachine::get().source_mappings.get(source_url.slice());
        // `parsed_mappings_` is refcounted; Drop on the returned guard handles deref().
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
            line_hits = LinesHits::init_capacity(line_count as usize)?;
            line_hits.len = line_count;
            let line_hits_slice = line_hits.slice_mut();
            line_hits_slice.fill(0);

            for (i, block) in blocks.iter().enumerate() {
                if block.end_offset < 0 || block.start_offset < 0 {
                    continue; // does not map to anything
                }

                let min: usize = usize::try_from(block.start_offset.min(block.end_offset)).unwrap();
                let max: usize = usize::try_from(block.start_offset.max(block.end_offset)).unwrap();
                let mut min_line: u32 = u32::MAX;
                let mut max_line: u32 = 0;

                let has_executed = block.has_executed || block.execution_count > 0;

                for byte_offset in min..max {
                    let Some(new_line_index) = LineOffsetTable::find_index(
                        line_starts,
                        sourcemap::Loc { start: i32::try_from(byte_offset).unwrap() },
                    ) else {
                        continue;
                    };
                    let line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset as usize) >= byte_offset {
                        continue;
                    }

                    let line: u32 = u32::try_from(new_line_index).unwrap();
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

                    stmts.push(Block { start_line: min_line, end_line: max_line });
                }
            }

            for (i, function) in function_blocks.iter().enumerate() {
                if function.end_offset < 0 || function.start_offset < 0 {
                    continue; // does not map to anything
                }

                let min: usize = usize::try_from(function.start_offset.min(function.end_offset)).unwrap();
                let max: usize = usize::try_from(function.start_offset.max(function.end_offset)).unwrap();
                let mut min_line: u32 = u32::MAX;
                let mut max_line: u32 = 0;

                for byte_offset in min..max {
                    let Some(new_line_index) = LineOffsetTable::find_index(
                        line_starts,
                        sourcemap::Loc { start: i32::try_from(byte_offset).unwrap() },
                    ) else {
                        continue;
                    };
                    let line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset as usize) >= byte_offset {
                        continue;
                    }

                    let line: u32 = u32::try_from(new_line_index).unwrap();
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

                functions.push(Block { start_line: min_line, end_line: max_line });

                if did_fn_execute {
                    functions_which_have_executed.set(i);
                }
            }
        } else if let Some(parsed_mapping) = parsed_mappings_.as_ref() {
            line_count = (parsed_mapping.input_line_count as u32) + 1;
            executable_lines = Bitset::init_empty(line_count as usize)?;
            lines_which_have_executed = Bitset::init_empty(line_count as usize)?;
            line_hits = LinesHits::init_capacity(line_count as usize)?;
            line_hits.len = line_count;
            let line_hits_slice = line_hits.slice_mut();
            line_hits_slice.fill(0);

            let mut cur_: Option<sourcemap::internal_source_map::Cursor> =
                parsed_mapping.internal_cursor();

            for (i, block) in blocks.iter().enumerate() {
                if block.end_offset < 0 || block.start_offset < 0 {
                    continue; // does not map to anything
                }

                let min: usize = usize::try_from(block.start_offset.min(block.end_offset)).unwrap();
                let max: usize = usize::try_from(block.start_offset.max(block.end_offset)).unwrap();
                let mut min_line: u32 = u32::MAX;
                let mut max_line: u32 = 0;
                let has_executed = block.has_executed || block.execution_count > 0;

                for byte_offset in min..max {
                    let Some(new_line_index) = LineOffsetTable::find_index(
                        line_starts,
                        sourcemap::Loc { start: i32::try_from(byte_offset).unwrap() },
                    ) else {
                        continue;
                    };
                    let line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset as usize) >= byte_offset {
                        continue;
                    }
                    let column_position = byte_offset.saturating_sub(line_start_byte_offset as usize);

                    let found = if let Some(c) = cur_.as_mut() {
                        c.move_to(
                            sourcemap::Line::from_zero_based(i32::try_from(new_line_index).unwrap()),
                            sourcemap::Column::from_zero_based(i32::try_from(column_position).unwrap()),
                        )
                    } else {
                        parsed_mapping.find_mapping(
                            sourcemap::Line::from_zero_based(i32::try_from(new_line_index).unwrap()),
                            sourcemap::Column::from_zero_based(i32::try_from(column_position).unwrap()),
                        )
                    };
                    if let Some(point) = found.as_ref() {
                        if point.original.lines.zero_based() < 0 {
                            continue;
                        }

                        let line: u32 = u32::try_from(point.original.lines.zero_based()).unwrap();

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
                    stmts.push(Block { start_line: min_line, end_line: max_line });

                    if has_executed {
                        stmts_which_have_executed.set(i);
                    }
                }
            }

            for (i, function) in function_blocks.iter().enumerate() {
                if function.end_offset < 0 || function.start_offset < 0 {
                    continue; // does not map to anything
                }

                let min: usize = usize::try_from(function.start_offset.min(function.end_offset)).unwrap();
                let max: usize = usize::try_from(function.start_offset.max(function.end_offset)).unwrap();
                let mut min_line: u32 = u32::MAX;
                let mut max_line: u32 = 0;

                for byte_offset in min..max {
                    let Some(new_line_index) = LineOffsetTable::find_index(
                        line_starts,
                        sourcemap::Loc { start: i32::try_from(byte_offset).unwrap() },
                    ) else {
                        continue;
                    };
                    let line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset as usize) >= byte_offset {
                        continue;
                    }

                    let column_position = byte_offset.saturating_sub(line_start_byte_offset as usize);

                    let found = if let Some(c) = cur_.as_mut() {
                        c.move_to(
                            sourcemap::Line::from_zero_based(i32::try_from(new_line_index).unwrap()),
                            sourcemap::Column::from_zero_based(i32::try_from(column_position).unwrap()),
                        )
                    } else {
                        parsed_mapping.find_mapping(
                            sourcemap::Line::from_zero_based(i32::try_from(new_line_index).unwrap()),
                            sourcemap::Column::from_zero_based(i32::try_from(column_position).unwrap()),
                        )
                    };
                    if let Some(point) = found {
                        if point.original.lines.zero_based() < 0 {
                            continue;
                        }

                        let line: u32 = u32::try_from(point.original.lines.zero_based()).unwrap();
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

                functions.push(Block { start_line: min_line, end_line: max_line });
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

    pub fn compute(source_contents: &[u8], source_id: i32, source_url: ZigString::Slice) -> ByteRangeMapping {
        ByteRangeMapping {
            // TODO(port): VirtualMachine::get().allocator dropped — LineOffsetTable::generate uses global mimalloc
            line_offset_table: LineOffsetTable::generate(source_contents, 0),
            source_id,
            source_url,
        }
    }
}

// ByteRangeMapping::deinit only freed line_offset_table; Rust drops it automatically.
// source_url is NOT freed, matching Zig deinit.

#[unsafe(no_mangle)]
pub extern "C" fn ByteRangeMapping__generate(
    str_: bun_str::String,
    source_contents_str: bun_str::String,
    source_id: i32,
) {
    // SAFETY: MAP is thread-local; the leaked Box lives for the thread's lifetime.
    let map_ptr = MAP.with(|m| match m.get() {
        Some(p) => p,
        None => {
            let p = NonNull::from(Box::leak(Box::new(ByteRangeMappingHashMap::default())));
            m.set(Some(p));
            p
        }
    });
    let map = unsafe { &mut *map_ptr.as_ptr() };

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
pub extern "C" fn ByteRangeMapping__find(path: bun_str::String) -> Option<NonNull<ByteRangeMapping>> {
    let slice = path.to_utf8();

    let map_ptr = MAP.with(|m| m.get())?;
    // SAFETY: map_ptr is a leaked Box valid for the thread's lifetime.
    let map = unsafe { &mut *map_ptr.as_ptr() };
    let hash = bun_wyhash::hash(slice.slice());
    let entry = map.get_mut(&hash)?;
    Some(NonNull::from(entry))
}

#[unsafe(no_mangle)]
pub extern "C" fn ByteRangeMapping__findExecutedLines(
    global_this: *mut JSGlobalObject,
    source_url: bun_str::String,
    blocks_ptr: *const BasicBlockRange,
    blocks_len: usize,
    function_start_offset: usize,
    ignore_sourcemap: bool,
) -> JSValue {
    // SAFETY: global_this is a valid JSGlobalObject* from JSC.
    let global_this = unsafe { &*global_this };

    let Some(this_ptr) = ByteRangeMapping__find(source_url.clone()) else {
        return JSValue::NULL;
    };
    // SAFETY: pointer into the thread-local map, valid for this call.
    let this = unsafe { &mut *this_ptr.as_ptr() };

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

    let Ok(v) = bun_str::String::create_utf8_for_js(global_this, &buf) else {
        return JSValue::ZERO;
    };
    v
}

#[derive(Clone, Copy)]
pub struct Fraction {
    pub functions: f64,
    pub lines: f64,

    /// This metric is less accurate right now
    pub stmts: f64,

    pub failing: bool,
}

impl Default for Fraction {
    fn default() -> Self {
        Self { functions: 0.9, lines: 0.9, stmts: 0.75, failing: false }
    }
}

#[derive(Clone, Copy, Default)]
pub struct Block {
    pub start_line: u32,
    pub end_line: u32,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap_jsc/CodeCoverage.zig (741 lines)
//   confidence: medium
//   todos:      6
//   notes:      pretty_fmt! macro + sourcemap Line/Column/Loc/Cursor types are guessed; threadlocal map uses leaked Box for stable extern "C" pointers; writers use bun_io::Write (byte-safe for non-UTF8 paths)
// ──────────────────────────────────────────────────────────────────────────

use core::cell::UnsafeCell;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;
use std::borrow::Cow;

use bun_collections::VecExt;
use bun_collections::bit_set::DynamicBitSet;
use bun_core::{self, Utf8Bytes};
use bun_jsc::{JSGlobalObject, JSValue, VM, bun_string_jsc};
use bun_sourcemap::{InternalSourceMap, Ordinal, ParsedSourceMap};

type LinesHits = Vec<u32>;
type Bitset = DynamicBitSet;

/// Line and function coverage of one source file.
///
/// A line is executable if the source map has code of it in the text JSC compiled, so comments,
/// blank lines and types are not. What ran does not change which lines are executable.
pub struct Report<'a> {
    pub source_url: Cow<'a, [u8]>,
    pub(crate) executable_lines: Bitset,
    pub(crate) lines_which_have_executed: Bitset,
    pub(crate) line_hits: LinesHits,
    /// Indexed in step with `functions_which_have_executed`.
    pub(crate) functions: Vec<ByteRange>,
    pub(crate) functions_which_have_executed: Bitset,
    /// Indexed in step with `stmts_which_have_executed`.
    pub(crate) stmts: Vec<ByteRange>,
    pub(crate) stmts_which_have_executed: Bitset,
}

impl<'a> Report<'a> {
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

    /// This file's fractions, with `failing` judged against `thresholds`.
    pub fn fraction(&self, thresholds: &Fraction) -> Fraction {
        let functions = self.function_coverage_fraction();
        let lines = self.lines_coverage_fraction();
        Fraction {
            functions,
            lines,
            stmts: self.stmts_coverage_fraction(),
            failing: functions < thresholds.functions || lines < thresholds.lines,
        }
    }

    /// Detach from the `ByteRangeMapping` this was generated from.
    pub fn into_owned(self) -> Report<'static> {
        Report {
            source_url: Cow::Owned(self.source_url.into_owned()),
            ..self
        }
    }

    pub fn generate(
        global_this: &JSGlobalObject,
        byte_range_mapping: &'a ByteRangeMapping,
        ignore_sourcemap_: bool,
    ) -> Option<Report<'a>> {
        bun_jsc::mark_binding();
        // Use the raw `*mut VM` accessor instead of narrowing through `&VM` and
        // casting back to `*mut` — C++ mutates the VM (controlFlowProfiler /
        // functionHasExecutedCache), so we must preserve write provenance.
        let vm = global_this.vm_ptr();

        let mut generator = Generator::default();

        for &source_id in &byte_range_mapping.source_ids {
            // SAFETY: `vm` is the live VM of `global_this`; the callback runs before the call returns.
            let ok = unsafe {
                CodeCoverage__withBlocksAndFunctions(
                    vm,
                    source_id,
                    (&raw mut generator).cast::<c_void>(),
                    Generator::do_,
                )
            };
            if !ok {
                return None;
            }
        }

        if generator.loads == 0 {
            return None;
        }
        if generator.loads > 1 {
            fold(&mut generator.blocks);
            fold(&mut generator.function_blocks);
        }

        Some(bun_core::handle_oom(
            byte_range_mapping.generate_report_from_blocks(
                &generator.blocks,
                &generator.function_blocks,
                ignore_sourcemap_,
            ),
        ))
    }
}

/// Byte encoding of a `Report` for handing one process's coverage of a file to
/// another (`bun test --parallel` workers → coordinator). Both ends are the
/// same executable on the same host, so integers and bitset words are written
/// in native layout.
///
///   str  source_url
///   u32  line_count, then executable_lines words, lines_which_have_executed
///        words, line_count × u32 hits
///   u32  n_functions, then n × {u32 start, u32 end}, executed words
///   u32  n_stmts, same shape
pub mod wire {
    use super::*;

    fn put_u32(out: &mut Vec<u8>, v: u32) {
        out.extend_from_slice(&v.to_ne_bytes());
    }

    fn put_ranges(out: &mut Vec<u8>, ranges: &[ByteRange], executed: &Bitset) {
        debug_assert_eq!(executed.bit_length(), ranges.len());
        put_u32(out, u32::try_from(ranges.len()).expect("int cast"));
        for r in ranges {
            put_u32(out, r.start);
            put_u32(out, r.end);
        }
        out.extend_from_slice(executed.bytes());
    }

    pub fn encode(report: &Report<'_>, out: &mut Vec<u8>) {
        let line_count = report.line_hits.len();
        debug_assert_eq!(report.executable_lines.bit_length(), line_count);
        debug_assert_eq!(report.lines_which_have_executed.bit_length(), line_count);

        put_u32(
            out,
            u32::try_from(report.source_url.len()).expect("int cast"),
        );
        out.extend_from_slice(&report.source_url);
        put_u32(out, u32::try_from(line_count).expect("int cast"));
        out.extend_from_slice(report.executable_lines.bytes());
        out.extend_from_slice(report.lines_which_have_executed.bytes());
        out.extend_from_slice(bun_core::cast_slice::<u32, u8>(&report.line_hits));
        put_ranges(
            out,
            &report.functions,
            &report.functions_which_have_executed,
        );
        put_ranges(out, &report.stmts, &report.stmts_which_have_executed);
    }

    struct Reader<'a>(&'a [u8]);

    impl<'a> Reader<'a> {
        fn bytes(&mut self, n: usize) -> Option<&'a [u8]> {
            let (head, tail) = self.0.split_at_checked(n)?;
            self.0 = tail;
            Some(head)
        }
        fn u32(&mut self) -> Option<u32> {
            Some(u32::from_ne_bytes(self.bytes(4)?.try_into().unwrap()))
        }
        fn len(&mut self) -> Option<usize> {
            self.u32().map(|n| n as usize)
        }
        fn bitset(&mut self, bit_length: usize) -> Option<Bitset> {
            let words = bit_length.div_ceil(usize::BITS as usize) * core::mem::size_of::<usize>();
            Bitset::from_bytes(bit_length, self.bytes(words)?).ok()?
        }
        fn ranges(&mut self) -> Option<(Vec<ByteRange>, Bitset)> {
            let n = self.len()?;
            let mut ranges = Vec::with_capacity(n.min(self.0.len() / 8));
            for _ in 0..n {
                ranges.push(ByteRange {
                    start: self.u32()?,
                    end: self.u32()?,
                });
            }
            Some((ranges, self.bitset(n)?))
        }
    }

    pub fn decode(bytes: &[u8]) -> Option<Report<'static>> {
        let mut r = Reader(bytes);
        let url_len = r.len()?;
        let source_url = Cow::Owned(r.bytes(url_len)?.to_vec());
        let line_count = r.len()?;
        // Bound the allocations below by the input size, not by a length
        // field read from it.
        if line_count.checked_mul(4)? > r.0.len() {
            return None;
        }
        let executable_lines = r.bitset(line_count)?;
        let lines_which_have_executed = r.bitset(line_count)?;
        let mut line_hits = vec![0u32; line_count];
        bun_core::cast_slice_mut::<u32, u8>(&mut line_hits)
            .copy_from_slice(r.bytes(line_count * 4)?);
        let (functions, functions_which_have_executed) = r.ranges()?;
        let (stmts, stmts_which_have_executed) = r.ranges()?;
        if !r.0.is_empty() {
            return None;
        }
        Some(Report {
            source_url,
            executable_lines,
            lines_which_have_executed,
            line_hits,
            functions,
            functions_which_have_executed,
            stmts,
            stmts_which_have_executed,
        })
    }
}

/// Folds several processes' `Report`s for one source file into one, for
/// `bun test --parallel` where each worker that loaded the file reports it.
///
/// Hits add up; everything else is a union.
#[derive(Default)]
pub struct MergedReport {
    source_url: Vec<u8>,
    executable_lines: Bitset,
    lines_which_have_executed: Bitset,
    line_hits: LinesHits,
    /// Every report's ranges with their executed bit; deduplicated in `finish`.
    functions: Vec<(ByteRange, bool)>,
    stmts: Vec<(ByteRange, bool)>,
}

impl MergedReport {
    pub fn add(&mut self, report: &Report<'_>) -> Result<(), bun_alloc::AllocError> {
        if self.source_url.is_empty() {
            self.source_url = report.source_url.to_vec();
        }
        // Workers can see different contents at one path.
        let len = report.line_hits.len().max(self.line_hits.len());
        self.executable_lines.resize(len, false)?;
        self.lines_which_have_executed.resize(len, false)?;
        self.line_hits.resize(len, 0);
        let mut executable = report.executable_lines.clone()?;
        let mut executed = report.lines_which_have_executed.clone()?;
        executable.resize(len, false)?;
        executed.resize(len, false)?;
        self.executable_lines.set_union(&executable);
        self.lines_which_have_executed.set_union(&executed);
        for (sum, &hits) in self.line_hits.iter_mut().zip(&report.line_hits) {
            *sum = sum.saturating_add(hits);
        }
        for (i, &r) in report.functions.iter().enumerate() {
            self.functions
                .push((r, report.functions_which_have_executed.is_set(i)));
        }
        for (i, &r) in report.stmts.iter().enumerate() {
            self.stmts
                .push((r, report.stmts_which_have_executed.is_set(i)));
        }
        Ok(())
    }

    fn dedupe(
        mut all: Vec<(ByteRange, bool)>,
    ) -> Result<(Vec<ByteRange>, Bitset), bun_alloc::AllocError> {
        all.sort_unstable_by_key(|e| e.0);
        all.dedup_by(|next, kept| {
            next.0 == kept.0 && {
                kept.1 |= next.1;
                true
            }
        });
        let mut executed = Bitset::init_empty(all.len())?;
        let mut ranges = Vec::with_capacity(all.len());
        for (i, (r, hit)) in all.into_iter().enumerate() {
            if hit {
                executed.set(i);
            }
            ranges.push(r);
        }
        Ok((ranges, executed))
    }

    pub fn finish(self) -> Result<Report<'static>, bun_alloc::AllocError> {
        let (functions, functions_which_have_executed) = Self::dedupe(self.functions)?;
        let (stmts, stmts_which_have_executed) = Self::dedupe(self.stmts)?;
        Ok(Report {
            source_url: Cow::Owned(self.source_url),
            executable_lines: self.executable_lines,
            lines_which_have_executed: self.lines_which_have_executed,
            line_hits: self.line_hits,
            functions,
            functions_which_have_executed,
            stmts,
            stmts_which_have_executed,
        })
    }
}

pub mod text {
    use super::*;
    // The `pretty_fmt!` macro only accepts literal `true`/`false` today,
    // so call the runtime rewriter for the `ENABLE_COLORS` const-generic sites.
    // PERF: runtime `pretty_fmt` allocates a small Vec per call — if hot,
    // hoist into `const` once the proc-macro lands.
    use bun_core::output::pretty_fmt;

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

    /// One table row: name, the two percentages from `fraction` (coloured
    /// against `thresholds`), and the uncovered line ranges.
    pub fn write_format<const ENABLE_COLORS: bool>(
        report: &Report,
        max_filename_length: usize,
        fraction: &Fraction,
        thresholds: &Fraction,
        base_path: &[u8],
        writer: &mut impl bun_io::Write,
    ) -> bun_io::Result<()> {
        let mut filename: &[u8] = &report.source_url;
        if !base_path.is_empty() {
            filename = bun_paths::resolve_path::relative(base_path, filename);
        }

        write_format_with_values::<ENABLE_COLORS>(
            filename,
            max_filename_length,
            *fraction,
            *thresholds,
            fraction.failing,
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

        // `concat!(pretty_fmt!(..), "{}")` requires a literal; split into a
        // prefix `write_all` + plain `write!` so the const-generic `ENABLE_COLORS` can
        // route through the runtime rewriter.
        let red = pretty_fmt::<ENABLE_COLORS>("<red>");
        let comma = pretty_fmt::<ENABLE_COLORS>("<r><d>,<r>");

        let mut is_first = true;
        let mut emit =
            |writer: &mut dyn bun_io::Write, start: usize, end: usize| -> bun_io::Result<()> {
                if !core::mem::take(&mut is_first) {
                    writer.write_all(&comma)?;
                }
                writer.write_all(&red)?;
                if start == end {
                    write!(writer, "{}", start + 1)
                } else {
                    write!(writer, "{}-{}", start + 1, end + 1)
                }
            };
        let mut range: Option<(usize, usize)> = None;
        while let Some(line) = iter.next() {
            range = match range {
                Some((start, end)) if line == end + 1 => Some((start, line)),
                Some((start, end)) => {
                    emit(writer, start, end)?;
                    Some((line, line))
                }
                None => Some((line, line)),
            };
        }
        if let Some((start, end)) = range {
            emit(writer, start, end)?;
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
        let mut filename: &[u8] = &report.source_url;
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
        writeln!(writer, "FNF:{}", report.functions.len())?;

        // FNH: functions hit
        writeln!(
            writer,
            "FNH:{}",
            report.functions_which_have_executed.count()
        )?;

        // ** Track all executable lines **
        // Executable lines that were not hit should be marked as 0
        // `DynamicBitSet::iterator` borrows `&self`, so no clone is needed.
        let mut iter = report.executable_lines.iterator::<true, true>();

        // ** Branch coverage not supported yet, since JSC does not support those yet. ** //
        // BRDA: line, block, (expressions,count)+
        // BRF: branches found
        // BRH: branches hit
        let line_hits = report.line_hits.slice();
        while let Some(line) = iter.next() {
            // DA: line number, hit count
            writeln!(writer, "DA:{},{}", line + 1, line_hits[line])?;
        }

        // LF: lines found
        writeln!(writer, "LF:{}", report.executable_lines.count())?;

        // LH: lines hit
        writeln!(writer, "LH:{}", report.lines_which_have_executed.count())?;

        writer.write_all(b"end_of_record\n")?;
        Ok(())
    }
}

unsafe extern "C" {
    fn CodeCoverage__withBlocksAndFunctions(
        vm: *mut VM,
        source_id: i32,
        ctx: *mut c_void,
        cb: extern "C" fn(&mut Generator, *const BasicBlockRange, usize, usize),
    ) -> bool;
}

/// What JSC recorded for one file, under each of its SourceIDs.
#[derive(Default)]
struct Generator {
    blocks: Vec<BasicBlockRange>,
    function_blocks: Vec<BasicBlockRange>,
    /// SourceIDs that had anything compiled.
    loads: usize,
}

impl Generator {
    extern "C" fn do_(
        this: &mut Generator,
        blocks_ptr: *const BasicBlockRange,
        blocks_len: usize,
        function_start_offset: usize,
    ) {
        // The C++ side (CodeCoverage.cpp) invokes this callback with `(nullptr, 0, 0)` when
        // basicBlocks is empty. `core::slice::from_raw_parts` requires a non-null, aligned
        // pointer even for zero-length slices, so we must bail before constructing the slice.
        if blocks_len == 0 {
            return;
        }
        // SAFETY: blocks_len != 0, so blocks_ptr[0..blocks_len] is a valid contiguous C array
        // provided by JSC for the duration of this synchronous callback.
        let all = unsafe { core::slice::from_raw_parts(blocks_ptr, blocks_len) };
        let blocks: &[BasicBlockRange] = &all[0..function_start_offset];
        let function_blocks: &[BasicBlockRange] = &all[function_start_offset..blocks_len];

        if blocks.is_empty() {
            return;
        }

        this.blocks.extend_from_slice(blocks);
        this.function_blocks.extend_from_slice(function_blocks);
        this.loads += 1;
    }
}

/// One range per `[start, end)`, executed if it executed under any SourceID.
fn fold(ranges: &mut Vec<BasicBlockRange>) {
    ranges.sort_unstable_by_key(|r| (r.start_offset, r.end_offset));
    ranges.dedup_by(|next, kept| {
        (next.start_offset, next.end_offset) == (kept.start_offset, kept.end_offset) && {
            kept.has_executed |= next.has_executed;
            kept.execution_count = kept.execution_count.saturating_add(next.execution_count);
            true
        }
    });
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct BasicBlockRange {
    start_offset: c_int,
    end_offset: c_int,
    has_executed: bool,
    execution_count: usize,
}

pub struct ByteRangeMapping {
    /// A bit for each code unit of the text JSC compiled, which is what JSC's offsets and the
    /// source map's generated columns count. Set if the unit can make its line executable:
    /// not white space, `{` or `}`, or marked as a brace of an object literal. The text itself is
    /// only borrowed while this is made.
    executable_units: Bitset,
    /// Code unit offset of the first unit of each line of the text.
    line_starts: Vec<u32>,
    /// JSC records coverage per `SourceProvider`, and each load of the file makes one.
    pub(crate) source_ids: Vec<i32>,
    /// Of the text.
    source_hash: u64,
    pub source_url: Utf8Bytes<'static>,
}

// Keys are already wyhashes (`bun_wyhash::hash` of the source URL — see
// `find`), so use the identity context instead of
// re-hashing them.
pub type ByteRangeMappingHashMap =
    bun_collections::HashMap<u64, ByteRangeMapping, bun_collections::IdentityContext<u64>>;

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
    /// Read-only accessor
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

    pub(crate) fn generate_report_from_blocks(
        &self,
        blocks: &[BasicBlockRange],
        function_blocks: &[BasicBlockRange],
        ignore_sourcemap: bool,
    ) -> Result<Report<'_>, bun_alloc::AllocError> {
        let source_url = self.source_url.slice();
        let source_map: Option<std::sync::Arc<ParsedSourceMap>> = if ignore_sourcemap {
            None
        } else {
            bun_jsc::VirtualMachine::VirtualMachine::get()
                .as_mut()
                .source_mappings()
                .get(source_url)
        };

        let mut blocks: Vec<CountedRange> =
            blocks.iter().filter_map(CountedRange::from_jsc).collect();
        blocks.sort_unstable_by_key(|block| block.range);

        let source_len = u32::try_from(self.executable_units.bit_length()).expect("int cast");
        let mut functions: Vec<CountedRange> = Vec::with_capacity(function_blocks.len());
        for function in function_blocks {
            let Some(mut function) = CountedRange::from_jsc(function) else {
                continue;
            };
            // JSC does not count calls. The function's first block runs once per call.
            if function.count > 0 {
                let first = blocks.partition_point(|b| b.range.start < function.range.start);
                if let Some(entry) = blocks.get(first)
                    && entry.range.start < function.range.end
                {
                    function.count = entry.count;
                }
            }
            functions.push(function);
        }
        functions.sort_unstable_by_key(|function| function.range);

        let counts = ExecutionCounts::new(&blocks, &functions);
        let mut lines = LineCounts::default();

        if let Some(source_map) = source_map.as_deref() {
            let mut previous_original = None;
            source_map.for_each_mapping(|mapping| {
                // The printer repeats a mapping at column 0 of a line that starts without one.
                let original = (
                    mapping.original.lines.zero_based(),
                    mapping.original.columns.zero_based(),
                );
                if previous_original.replace(original) == Some(original) {
                    return;
                }
                let (Ok(line), Some(offset)) = (
                    usize::try_from(mapping.original.lines.zero_based()),
                    self.offset_of(mapping.generated),
                ) else {
                    return;
                };
                self.count_line(&counts, offset, line, &mut lines);
            });
        } else {
            for (line, &start) in self.line_starts.iter().enumerate() {
                let end = self
                    .line_starts
                    .get(line + 1)
                    .copied()
                    .unwrap_or(source_len);
                for offset in start..end {
                    self.count_line(&counts, offset, line, &mut lines);
                }
            }
        }

        // A function the source does not have, such as the CommonJS wrapper, is a range of JSC's
        // like any function.
        if let Some(source_map) = source_map.as_deref() {
            functions.retain(|function| {
                let (line, column) = self.line_and_column_of(function.range.start);
                source_map.find_mapping(line, column).is_some()
            });
        }

        let (executable_lines, lines_which_have_executed) = lines.bitsets()?;
        let (functions, functions_which_have_executed) = split_executed(&functions)?;
        let (stmts, stmts_which_have_executed) = split_executed(&blocks)?;

        Ok(Report {
            source_url: Cow::Borrowed(source_url),
            functions,
            executable_lines,
            lines_which_have_executed,
            line_hits: lines.hits(),
            stmts,
            functions_which_have_executed,
            stmts_which_have_executed,
        })
    }

    /// `line` ran as often as the code at `offset`, if it is code. A block's brace is not: the `{`
    /// of a loop body shares a line with a header that runs once, and after a `return` JSC has
    /// the `}` in a block of its own that never runs.
    fn count_line(
        &self,
        counts: &ExecutionCounts,
        offset: u32,
        line: usize,
        lines: &mut LineCounts,
    ) {
        if self.executable_units.is_set(offset as usize)
            && let Some(count) = counts.at(offset)
        {
            lines.add(line, count);
        }
    }

    fn offset_of(&self, position: bun_sourcemap::LineColumnOffset) -> Option<u32> {
        let line = usize::try_from(position.lines.zero_based()).ok()?;
        let column = u32::try_from(position.columns.zero_based()).ok()?;
        let offset = self.line_starts.get(line)?.checked_add(column)?;
        ((offset as usize) < self.executable_units.bit_length()).then_some(offset)
    }

    fn line_and_column_of(&self, offset: u32) -> (Ordinal, Ordinal) {
        let line = self.line_starts.partition_point(|&start| start <= offset) - 1;
        (
            Ordinal::from_zero_based(i32::try_from(line).expect("int cast")),
            Ordinal::from_zero_based(
                i32::try_from(offset - self.line_starts[line]).expect("int cast"),
            ),
        )
    }

    pub(crate) fn compute(
        source: &bun_core::String,
        source_hash: u64,
        source_id: i32,
        source_url: Utf8Bytes<'static>,
    ) -> ByteRangeMapping {
        let (line_starts, executable_units) = if source.is_utf16() {
            scan(source.utf16().iter().copied())
        } else {
            scan(source.latin1().iter().map(|&unit| unit as u16))
        };
        ByteRangeMapping {
            executable_units,
            line_starts,
            source_ids: vec![source_id],
            source_hash,
            source_url,
        }
    }

    /// `scan` sets no brace. Those of an object literal are code, and the printer marks them.
    fn set_object_braces_executable(&mut self, text: &[u8], already_bundled: bool) {
        if already_bundled {
            // JSC compiles a `// @bun` file as written, so the original positions are in `text`.
            if let Some(blob) = print_for_coverage(self.source_url.slice(), text) {
                InternalSourceMap {
                    data: blob.list.as_ptr(),
                }
                .for_each_object_brace(|brace| self.set_executable(brace.original));
            }
        } else if let Some(source_map) = bun_jsc::VirtualMachine::VirtualMachine::get()
            .as_mut()
            .source_mappings()
            .get(self.source_url.slice())
        {
            source_map.for_each_object_brace(|brace| self.set_executable(brace.generated));
        }
    }

    fn set_executable(&mut self, position: bun_sourcemap::LineColumnOffset) {
        if let Some(offset) = self.offset_of(position) {
            self.executable_units.set(offset as usize);
        }
    }
}

/// The `InternalSourceMap` from parsing and printing `text`, if both succeed.
fn print_for_coverage(path: &[u8], text: &[u8]) -> Option<bun_core::MutableString> {
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();

    let source = bun_ast::Source::init_path_string(path, text);
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), bun_ast::Loader::Js);
    options.features.dead_code_elimination = false;
    options.features.no_macros = true;
    options.features.top_level_await = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let parser = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    let bun_js_parser::Result::Ast(mut ast) = parser.parse().ok()? else {
        return None;
    };

    let symbols_arena = *ast.symbols.allocator();
    let symbols = bun_ast::symbol::Map::init_with_one_list(
        core::mem::replace(&mut ast.symbols, bun_alloc::ArenaVec::new_in(symbols_arena))
            .into_iter()
            .collect(),
    );
    let mut chunk = None;
    // ASCII_ONLY = true: the chunk is an `InternalSourceMap`, not VLQ text.
    bun_js_printer::print_ast::<_, true, true>(
        &mut bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init()),
        &arena,
        &ast,
        symbols,
        &source,
        bun_js_printer::Options {
            code_coverage: true,
            source_map_handler: Some(bun_js_printer::SourceMapHandler::for_(&mut chunk)),
            ..Default::default()
        },
    )
    .ok()?;
    Some(chunk?.buffer)
}

/// `ByteRangeMapping::line_starts` and `executable_units`. Lines end where
/// `bun_sourcemap` ends them, in a generated text and in an original.
fn scan(units: impl ExactSizeIterator<Item = u16>) -> (Vec<u32>, Bitset) {
    let mut starts = vec![0u32];
    let mut executable = bun_core::handle_oom(Bitset::init_empty(units.len()));
    let mut units = units.enumerate().peekable();
    while let Some((i, unit)) = units.next() {
        match unit {
            0x0D if units.peek().is_some_and(|&(_, next)| next == 0x0A) => {}
            0x0A | 0x0D | 0x2028 | 0x2029 => starts.push(u32::try_from(i + 1).expect("int cast")),
            _ => {}
        }
        if !matches!(unit, 0x09 | 0x0A | 0x0D | 0x20 | 0x7B | 0x7D) {
            executable.set(i);
        }
    }
    (starts, executable)
}

#[derive(Clone, Copy)]
struct CountedRange {
    range: ByteRange,
    count: u32,
}

impl CountedRange {
    /// JSC's ranges include their end. The program of an empty file ends at -1.
    fn from_jsc(range: &BasicBlockRange) -> Option<CountedRange> {
        let start = u32::try_from(range.start_offset).ok()?;
        let end = u32::try_from(range.end_offset).ok()?.checked_add(1)?;
        Some(CountedRange {
            range: ByteRange { start, end },
            count: u32::try_from(range.execution_count).unwrap_or(u32::MAX),
        })
    }
}

fn split_executed(
    ranges: &[CountedRange],
) -> Result<(Vec<ByteRange>, Bitset), bun_alloc::AllocError> {
    let mut executed = Bitset::init_empty(ranges.len())?;
    for (i, range) in ranges.iter().enumerate() {
        if range.count > 0 {
            executed.set(i);
        }
    }
    Ok((ranges.iter().map(|range| range.range).collect(), executed))
}

/// How often each code unit of a text ran: as often as the smallest of JSC's ranges that holds
/// it, which is how `ControlFlowProfiler::findBasicBlockAtTextOffset` reads them.
struct ExecutionCounts {
    /// `(offset, count)`: the count from `offset` up to the next step's. `None`: in no range.
    steps: Vec<(u32, Option<u32>)>,
}

impl ExecutionCounts {
    /// A block and a function of one extent are the same code, and the block has the count.
    fn new(blocks: &[CountedRange], functions: &[CountedRange]) -> ExecutionCounts {
        let ranges: Vec<CountedRange> = blocks.iter().chain(functions).copied().collect();
        let mut by_start: Vec<usize> = (0..ranges.len()).collect();
        let mut by_end = by_start.clone();
        by_start.sort_unstable_by_key(|&i| ranges[i].range.start);
        by_end.sort_unstable_by_key(|&i| ranges[i].range.end);

        let key = |i: usize| (ranges[i].range.end - ranges[i].range.start, i);
        let mut open = std::collections::BTreeSet::new();
        let mut steps: Vec<(u32, Option<u32>)> = Vec::new();
        let (mut starting, mut ending) = (by_start.iter().peekable(), by_end.iter().peekable());
        while let Some(&&next_end) = ending.peek() {
            let mut offset = ranges[next_end].range.end;
            if let Some(&&next_start) = starting.peek() {
                offset = offset.min(ranges[next_start].range.start);
            }
            while let Some(&i) = ending.next_if(|&&i| ranges[i].range.end == offset) {
                open.remove(&key(i));
            }
            while let Some(&i) = starting.next_if(|&&i| ranges[i].range.start == offset) {
                open.insert(key(i));
            }
            let count = open.first().map(|&(_, i)| ranges[i].count);
            if steps.last().is_none_or(|&(_, last)| last != count) {
                steps.push((offset, count));
            }
        }
        ExecutionCounts { steps }
    }

    fn at(&self, offset: u32) -> Option<u32> {
        let after = self.steps.partition_point(|&(start, _)| start <= offset);
        self.steps.get(after.checked_sub(1)?)?.1
    }
}

/// A line is executable once anything on it is, and ran as often as what ran most on it.
#[derive(Default)]
struct LineCounts(Vec<Option<u32>>);

impl LineCounts {
    fn add(&mut self, line: usize, count: u32) {
        if line >= self.0.len() {
            self.0.resize(line + 1, None);
        }
        self.0[line] = self.0[line].max(Some(count));
    }

    /// Executable lines, and those of them that ran.
    fn bitsets(&self) -> Result<(Bitset, Bitset), bun_alloc::AllocError> {
        let mut executable = Bitset::init_empty(self.0.len())?;
        let mut executed = Bitset::init_empty(self.0.len())?;
        for (line, &hits) in self.0.iter().enumerate() {
            if hits.is_some() {
                executable.set(line);
            }
            if hits > Some(0) {
                executed.set(line);
            }
        }
        Ok((executable, executed))
    }

    fn hits(&self) -> LinesHits {
        self.0.iter().map(|hits| hits.unwrap_or(0)).collect()
    }
}

#[unsafe(no_mangle)]
extern "C" fn ByteRangeMapping__generate(
    str_: &bun_core::String,
    source_contents_str: &bun_core::String,
    source_id: i32,
    already_bundled: bool,
) {
    // SAFETY: thread_map() returns a pointer into this thread's owned Box<HashMap>;
    // valid for the lifetime of the thread, and we are the only mutable accessor on
    // this thread for the duration of this call.
    let map = unsafe { &mut *thread_map() };

    let source_url = str_.clone().into_utf8();
    let hash = bun_wyhash::hash(source_url.slice());
    let source_contents = source_contents_str.to_utf8();
    let source_hash = bun_wyhash::hash(source_contents.slice());

    // Another text replaces the entry: the line table and the saved source map describe one text.
    if let Some(existing) = map.get_mut(&hash)
        && existing.source_hash == source_hash
    {
        existing.source_ids.push(source_id);
        return;
    }

    let mut new_value =
        ByteRangeMapping::compute(source_contents_str, source_hash, source_id, source_url);
    // `node:inspector` turns the profiler on too. Nothing is marked for it.
    if bun_jsc::VirtualMachine::VirtualMachine::get()
        .as_mut()
        .transpiler
        .options
        .code_coverage
    {
        new_value.set_object_braces_executable(source_contents.slice(), already_bundled);
    }
    map.insert(hash, new_value);
}

/// For a provider that wraps another one. `module._compile()` wraps a text of its own.
#[unsafe(no_mangle)]
extern "C" fn ByteRangeMapping__addSourceID(
    source_url: &bun_core::String,
    source_contents: &bun_core::String,
    source_id: i32,
) {
    let Some(mut this) = find(source_url) else {
        return;
    };
    // SAFETY: pointer into the thread-local map, valid for this call.
    let this = unsafe { this.as_mut() };
    if this.source_hash == bun_wyhash::hash(source_contents.to_utf8().slice()) {
        this.source_ids.push(source_id);
    }
}

fn find(path: &bun_core::String) -> Option<NonNull<ByteRangeMapping>> {
    let slice = path.to_utf8();

    let map_ptr = thread_map_opt()?;
    // SAFETY: map_ptr points into this thread's owned Box; valid until thread exit.
    let map = unsafe { &mut *map_ptr.as_ptr() };
    let hash = bun_wyhash::hash(slice.slice());
    let entry = map.get_mut(&hash)?;
    Some(NonNull::from(entry))
}

/// The table row of `source_url`. `undefined`: nothing compiled yet. `null`: not instrumented.
#[unsafe(no_mangle)]
extern "C" fn ByteRangeMapping__findExecutedLines(
    global_this: &JSGlobalObject,
    source_url: &bun_core::String,
    ignore_sourcemap: bool,
) -> JSValue {
    let Some(this_ptr) = find(source_url) else {
        return JSValue::NULL;
    };
    // SAFETY: pointer into the thread-local map, valid for this call.
    let this = unsafe { &*this_ptr.as_ptr() };

    let Some(report) = Report::generate(global_this, this, ignore_sourcemap) else {
        return JSValue::UNDEFINED;
    };

    let thresholds = Fraction::default();

    // std.Io.Writer.Allocating → Vec<u8> byte buffer (bun_io::Write target).
    let mut buf: Vec<u8> = Vec::new();

    if text::write_format::<false>(
        &report,
        source_url.utf8_byte_length(),
        &report.fraction(&thresholds),
        &thresholds,
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

/// A basic block or function as `[start, end)` code unit offsets into the text JSC compiled, so
/// it identifies the same block across processes that loaded the same file.
#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct ByteRange {
    pub start: u32,
    pub end: u32,
}

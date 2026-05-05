//! Per-worker JUnit XML and LCOV coverage fragment merging. Workers write
//! their own fragments to a shared temp dir; the coordinator stitches them
//! into a single document/report after `drive()` completes.

use std::io::Write as _;

use bstr::BStr;

use bun_collections::ArrayHashMap;
use bun_core::{self, err, Output};
use bun_paths::{self, PathBuffer};
use bun_sourcemap::coverage::report::Text as CoverageReportText;
use bun_sourcemap::coverage::Fraction as CoverageFraction;
use bun_str::{strings, ZStr};
use bun_sys::{self, Fd, File, O};

use crate::test::parallel::coordinator::Coordinator;
use crate::test_command::{self, TestCommand};
use bun_jsc::jest::TestRunner;
use bun_jsc::{self as jsc};

fn attr_value(head: &[u8], name: &'static [u8]) -> u32 {
    // PERF(port): was comptime `" " ++ name ++ "=\""` concat — profile in Phase B
    let needle = [b" ", name, b"=\""].concat();
    let Some(idx) = strings::index_of(head, &needle) else { return 0 };
    let start = idx + needle.len();
    let Some(q) = strings::index_of_char(&head[start..], b'"') else { return 0 };
    let end = start + q;
    // TODO(port): narrow error set
    bun_str::parse_int::<u32>(&head[start..end], 10).unwrap_or(0)
}

pub fn merge_junit_fragments(coord: &mut Coordinator, outfile: &[u8], summary: &TestRunner::Summary) {
    let mut body: Vec<u8> = Vec::new();
    // Crashed workers never reach workerFlushAggregates, so any files they ran
    // (including earlier passing ones) have no fragment. Compute the outer
    // <testsuites> totals from what we actually emit so they always equal the
    // sum of inner <testsuite> elements; CI tools schema-validate this.
    #[derive(Default)]
    struct Totals { tests: u32, failures: u32, skipped: u32 }
    let mut totals = Totals::default();

    for path in &coord.junit_fragments {
        let file = match File::read_from(Fd::cwd(), path) {
            bun_sys::Result::Ok(r) => r,
            bun_sys::Result::Err(_) => continue,
        };
        // Each fragment is a full <testsuites> document; extract its header
        // attributes for the merged totals and its body for the inner suites.
        let Some(open_start) = strings::index_of(&file, b"<testsuites") else { continue };
        let Some(gt) = strings::index_of_char(&file[open_start..], b'>') else { continue };
        let head_end = open_start + gt;
        let head = &file[open_start..head_end];
        totals.tests += attr_value(head, b"tests");
        totals.failures += attr_value(head, b"failures");
        totals.skipped += attr_value(head, b"skipped");
        let body_start = head_end + 1;
        let Some(body_end) = strings::last_index_of(&file, b"</testsuites>") else { continue };
        if body_start >= body_end { continue; }
        let inner = strings::trim(&file[body_start..body_end], b"\n");
        if inner.is_empty() { continue; }
        body.extend_from_slice(inner);
        body.push(b'\n');
    }

    for &idx in &coord.crashed_files {
        let rel = coord.rel_path(idx);
        body.extend_from_slice(b"  <testsuite name=\"");
        test_command::escape_xml(rel, &mut body);
        body.extend_from_slice(b"\" tests=\"1\" assertions=\"0\" failures=\"1\" skipped=\"0\" time=\"0\">\n    <testcase name=\"(worker crashed)\" classname=\"");
        test_command::escape_xml(rel, &mut body);
        body.extend_from_slice(
            b"\">\n\
              \x20     <failure message=\"worker process crashed before reporting results\"></failure>\n\
              \x20   </testcase>\n\
              \x20 </testsuite>\n",
        );
        totals.tests += 1;
        totals.failures += 1;
    }

    let mut contents: Vec<u8> = Vec::new();
    // TODO(port): bun_core::nano_timestamp() / bun_core::START_TIME equivalents
    let elapsed_time = (bun_core::nano_timestamp() - bun_core::START_TIME) as f64 / 1_000_000_000.0;
    let _ = write!(
        &mut contents,
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <testsuites name=\"bun test\" tests=\"{}\" assertions=\"{}\" failures=\"{}\" skipped=\"{}\" time=\"{}\">\n",
        totals.tests, summary.expectations, totals.failures, totals.skipped, elapsed_time,
    );
    contents.extend_from_slice(&body);
    contents.extend_from_slice(b"</testsuites>\n");

    let out_z = ZStr::from_bytes(outfile);
    match File::openat(Fd::cwd(), &out_z, O::WRONLY | O::CREAT | O::TRUNC, 0o664) {
        bun_sys::Result::Err(e) => Output::err(
            err!("JUnitReportFailed"),
            format_args!("Failed to write JUnit report to {}\n{}", BStr::new(outfile), e),
        ),
        bun_sys::Result::Ok(fd) => {
            let fd = fd; // moved into scope; closed on drop
            match File::write_all(&fd, &contents) {
                bun_sys::Result::Err(e) => Output::err(
                    err!("JUnitReportFailed"),
                    format_args!("Failed to write JUnit report to {}\n{}", BStr::new(outfile), e),
                ),
                bun_sys::Result::Ok(()) => {}
            }
            let _ = fd.close();
        }
    }
}

#[derive(Default)]
struct FileCoverage {
    path: Box<[u8]>,
    fnf: u32,
    fnh: u32,
    /// 1-based line number → summed hit count.
    da: ArrayHashMap<u32, u32>,
}

impl FileCoverage {
    fn lh(&self) -> u32 {
        let mut n: u32 = 0;
        for &c in self.da.values() {
            n += (c > 0) as u32;
        }
        n
    }
}

/// Merge per-worker LCOV fragments into a single report. Line-level (DA) merge
/// is precise. FNF/FNH take the per-worker max since Bun's LCOV writer doesn't
/// emit per-function FN/FNDA records yet, so disjoint per-worker function hits
/// can't be unioned; this under-reports % Funcs when workers cover different
/// functions of the same file. The non-parallel path has the same FN/FNDA gap.
pub fn merge_coverage_fragments<const ENABLE_COLORS: bool>(
    paths: &[&[u8]],
    opts: &mut TestCommand::CodeCoverageOptions,
) {
    // PERF(port): was arena bulk-free (std.heap.ArenaAllocator) — profile in Phase B

    // TODO(port): StringArrayHashMap key ownership semantics — using Box<[u8]> keys for now
    let mut by_file: ArrayHashMap<Box<[u8]>, FileCoverage> = ArrayHashMap::default();

    for path in paths {
        let data = match File::read_from(Fd::cwd(), path) {
            bun_sys::Result::Ok(r) => r,
            bun_sys::Result::Err(_) => continue,
        };
        let mut cur: Option<usize> = None; // index into by_file; raw &mut would alias across getOrPut
        // PORT NOTE: reshaped for borrowck — store index instead of *mut FileCoverage
        for raw in data.split(|b| *b == b'\n') {
            let line = strings::trim_right(raw, b"\r");
            if line.starts_with(b"SF:") {
                let name = &line[3..];
                let gop = by_file.get_or_put(name);
                if !gop.found_existing {
                    let owned: Box<[u8]> = Box::from(name);
                    *gop.key = owned.clone();
                    *gop.value = FileCoverage { path: owned, ..Default::default() };
                }
                cur = Some(gop.index);
            } else if line == b"end_of_record" {
                cur = None;
            } else if let Some(i) = cur {
                let fc = by_file.value_at_mut(i);
                if line.starts_with(b"DA:") {
                    let mut parts = line[3..].split(|b| *b == b',');
                    let Some(ln_s) = parts.next() else { continue };
                    let Ok(ln) = bun_str::parse_int::<u32>(ln_s, 10) else { continue };
                    let Some(cnt_s) = parts.next() else { continue };
                    let Ok(cnt) = bun_str::parse_int::<u32>(cnt_s, 10) else { continue };
                    let gop = fc.da.get_or_put(ln);
                    *gop.value = if gop.found_existing { gop.value.saturating_add(cnt) } else { cnt };
                } else if line.starts_with(b"FNF:") {
                    fc.fnf = fc.fnf.max(bun_str::parse_int::<u32>(&line[4..], 10).unwrap_or(0));
                } else if line.starts_with(b"FNH:") {
                    fc.fnh = fc.fnh.max(bun_str::parse_int::<u32>(&line[4..], 10).unwrap_or(0));
                }
            }
        }
    }

    if by_file.count() == 0 {
        return;
    }

    // Stable output order.
    // TODO(port): ArrayHashMap::sort_by API — Zig sorts entries by key bytes
    by_file.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));

    if opts.reporters.lcov {
        // TODO(port): bun_jsc::node::fs::NodeFs mkdir_recursive — verify crate path
        let mut fs = jsc::node::fs::NodeFs::default();
        let _ = fs.mkdir_recursive(jsc::node::fs::MkdirArgs {
            path: jsc::node::PathLike::EncodedSlice(bun_str::ZigString::Slice::from_utf8_never_free(&opts.reports_directory)),
            always_return_none: true,
            ..Default::default()
        });
        let mut path_buf = PathBuffer::uninit();
        let out_path = bun_paths::join_abs_string_buf_z(
            bun_fs::FileSystem::instance().top_level_dir(),
            &mut path_buf,
            &[&opts.reports_directory, b"lcov.info"],
            bun_paths::Platform::Auto,
        );
        match File::openat(Fd::cwd(), out_path, O::CREAT | O::WRONLY | O::TRUNC | O::CLOEXEC, 0o644) {
            bun_sys::Result::Err(e) => Output::err(
                err!("lcovCoverageError"),
                format_args!("Failed to write merged lcov.info\n{}", e),
            ),
            bun_sys::Result::Ok(f) => {
                // TODO(port): Zig used a 64KiB-buffered writer adapter; building in Vec then one write_all
                let mut w: Vec<u8> = Vec::with_capacity(64 * 1024);
                for fc in by_file.values() {
                    let mut sorted: Vec<u32> = fc.da.keys().to_vec();
                    sorted.sort_unstable();
                    let _ = write!(&mut w, "TN:\nSF:{}\nFNF:{}\nFNH:{}\n", BStr::new(&fc.path), fc.fnf, fc.fnh);
                    for &ln in &sorted {
                        let _ = write!(&mut w, "DA:{},{}\n", ln, fc.da.get(ln).expect("unreachable"));
                    }
                    let _ = write!(&mut w, "LF:{}\nLH:{}\nend_of_record\n", fc.da.count(), fc.lh());
                }
                let _ = File::write_all(&f, &w);
                f.close();
            }
        }
    }

    let base = opts.fractions;
    let mut failing = false;
    let mut avg = CoverageFraction { functions: 0.0, lines: 0.0, stmts: 0.0, ..Default::default() };
    let mut avg_n: f64 = 0.0;
    let mut fracs: Vec<CoverageFraction> = vec![CoverageFraction::default(); by_file.count()];
    debug_assert_eq!(by_file.values().len(), fracs.len());
    for (fc, frac) in by_file.values().iter().zip(fracs.iter_mut()) {
        let lf: f64 = fc.da.count() as f64;
        let lh_: f64 = fc.lh() as f64;
        *frac = CoverageFraction {
            functions: if fc.fnf > 0 { fc.fnh as f64 / fc.fnf as f64 } else { 1.0 },
            lines: if lf > 0.0 { lh_ / lf } else { 1.0 },
            stmts: if lf > 0.0 { lh_ / lf } else { 1.0 },
            ..Default::default()
        };
        frac.failing = frac.functions < base.functions || frac.lines < base.lines;
        if frac.failing { failing = true; }
        avg.functions += frac.functions;
        avg.lines += frac.lines;
        avg.stmts += frac.stmts;
        avg_n += 1.0;
    }
    opts.fractions.failing = failing;

    if opts.reporters.text {
        let mut max_len: usize = b"All files".len();
        for k in by_file.keys() {
            max_len = max_len.max(k.len());
        }

        let mut console = Output::error_writer();
        fn sep<const COLORS: bool>(c: &mut impl std::io::Write, n: usize) {
            let _ = c.write_all(Output::pretty_fmt::<COLORS>("<r><d>").as_bytes());
            // TODO(port): splatByteAll equivalent on writer
            let _ = c.write_all(&vec![b'-'; n + 2]);
            let _ = c.write_all(Output::pretty_fmt::<COLORS>("|---------|---------|-------------------<r>\n").as_bytes());
        }
        sep::<ENABLE_COLORS>(&mut console, max_len);
        let _ = console.write_all(b"File");
        let _ = console.write_all(&vec![b' '; max_len - b"File".len() + 1]);
        let _ = console.write_all(Output::pretty_fmt::<ENABLE_COLORS>(" <d>|<r> % Funcs <d>|<r> % Lines <d>|<r> Uncovered Line #s\n").as_bytes());
        sep::<ENABLE_COLORS>(&mut console, max_len);

        let mut body: Vec<u8> = Vec::new();
        debug_assert_eq!(by_file.values().len(), fracs.len());
        for (fc, frac) in by_file.values().iter().zip(fracs.iter()) {
            let _ = CoverageReportText::write_format_with_values::<ENABLE_COLORS>(
                &fc.path, max_len, *frac, base, frac.failing, &mut body, true,
            );
            let _ = body.write_all(Output::pretty_fmt::<ENABLE_COLORS>("<r><d> | <r>").as_bytes());

            let mut sorted: Vec<u32> = fc.da.keys().to_vec();
            sorted.sort_unstable();
            let mut first = true;
            let mut range_start: u32 = 0;
            let mut range_end: u32 = 0;
            for &ln in &sorted {
                if *fc.da.get(ln).expect("unreachable") != 0 { continue; }
                if range_start == 0 {
                    range_start = ln;
                    range_end = ln;
                } else if ln == range_end + 1 {
                    range_end = ln;
                } else {
                    write_range::<ENABLE_COLORS>(&mut body, &mut first, range_start, range_end);
                    range_start = ln;
                    range_end = ln;
                }
            }
            if range_start != 0 {
                write_range::<ENABLE_COLORS>(&mut body, &mut first, range_start, range_end);
            }
            let _ = body.write_all(b"\n");
        }

        if avg_n > 0.0 {
            avg.functions /= avg_n;
            avg.lines /= avg_n;
            avg.stmts /= avg_n;
        }
        let _ = console.write_all(&body);
        let _ = CoverageReportText::write_format_with_values::<ENABLE_COLORS>(
            b"All files", max_len, avg, base, failing, &mut console, false,
        );
        let _ = console.write_all(Output::pretty_fmt::<ENABLE_COLORS>("<r><d> |<r>\n").as_bytes());
        sep::<ENABLE_COLORS>(&mut console, max_len);

        Output::flush();
    }
}

fn write_range<const COLORS: bool>(w: &mut impl std::io::Write, first: &mut bool, a: u32, b: u32) {
    if *first {
        *first = false;
    } else {
        let _ = w.write_all(Output::pretty_fmt::<COLORS>("<r><d>,<r>").as_bytes());
    }
    if a == b {
        let _ = write!(w, "{}{}", Output::pretty_fmt::<COLORS>("<red>"), a);
    } else {
        let _ = write!(w, "{}{}-{}", Output::pretty_fmt::<COLORS>("<red>"), a, b);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/test/parallel/aggregate.zig (288 lines)
//   confidence: medium
//   todos:      7
//   notes:      ArrayHashMap get_or_put/sort_by + Output::pretty_fmt<const> + NodeFs mkdir API are speculative; arena dropped per non-AST rule
// ──────────────────────────────────────────────────────────────────────────

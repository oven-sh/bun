//! Builds the single JUnit document and coverage report from the per-file
//! data workers stream over IPC, once `drive()` completes.

use bun_collections::index_sort;
use bun_core::Output;
use bun_options_types::code_coverage_options::CodeCoverageOptions;
use bun_sourcemap_jsc::code_coverage::Report;

use super::coordinator::{Coordinator, FileTestRecords};
use super::frame::Reader;
use super::runner;
use crate::test_command::{
    JunitReporter, TestCaseReport, TestFailure, junit_file_name, print_coverage_reports,
};
use crate::test_runner::execution::Result as TestResult;

/// Feed every worker's per-test records through the coordinator's own
/// reporters in canonical file order, so the JUnit document is the one a
/// serial run would have written.
pub(crate) fn replay_test_records(coord: &mut Coordinator) {
    let files = core::mem::take(&mut coord.test_records);
    (coord.reporter).with_junit(|junit| replay_into(junit, coord, &files));
}

fn replay_into(junit: &mut JunitReporter, coord: &Coordinator, files: &[FileTestRecords]) {
    for (idx, file) in files.iter().enumerate() {
        let rel = junit_file_name(coord.schedule.path(idx));
        junit.file_start_unix_ms = file
            .started_unix_ms
            .unwrap_or_else(bun_core::time::milli_timestamp);
        for payload in &file.tests {
            if let Some(test) = runner::decode_test_case(&mut Reader { p: payload }, rel) {
                junit.record_test_case(&test).expect("oom");
            }
        }
        if let Some((name, message)) = file.unfinished {
            let unfinished = TestCaseReport {
                file: rel,
                scopes: Vec::new(),
                name: name.as_bytes(),
                status: TestResult::Fail,
                assertions: 0,
                elapsed_ns: 0,
                line_number: 0,
                failure: Some(TestFailure {
                    message: message.into(),
                    ..Default::default()
                }),
                earlier_failures: Vec::new(),
            };
            junit.record_test_case(&unfinished).expect("oom");
        }
        junit
            .end_file(Some(rel), Some(file.elapsed_ns))
            .expect("oom");
    }
}

pub(crate) fn write_coverage_report(coord: &mut Coordinator, opts: &mut CodeCoverageOptions) {
    let mut merged = core::mem::take(&mut coord.coverage_files);
    let mut reports: Vec<Report<'static>> = Vec::with_capacity(merged.count());
    for m in merged.values_mut() {
        reports.push(bun_core::handle_oom(core::mem::take(m).finish()));
    }
    if reports.is_empty() {
        return;
    }
    index_sort::sort_slice_unstable_by(&mut reports, |a, b| a.source_url.cmp(&b.source_url));
    if let Err(err) = print_coverage_reports(opts, &reports) {
        Output::err(err, "Failed to write lcov.info", ());
        coord.aborted.get_or_insert(1);
    }
}

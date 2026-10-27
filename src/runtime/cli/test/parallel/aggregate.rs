//! Builds the single JUnit document and coverage report from the per-file
//! data workers stream over IPC, once `drive()` completes.

use bun_core::Output;
use bun_options_types::code_coverage_options::CodeCoverageOptions;
use bun_sourcemap_jsc::code_coverage::Report;

use super::coordinator::Coordinator;
use super::frame::Reader;
use super::runner;
use crate::test_command::{TestCaseReport, TestFailure, junit_file_name, print_coverage_reports};
use crate::test_runner::execution::Result as TestResult;

/// Feed every worker's per-test records through the coordinator's own
/// reporters in canonical file order, so the JUnit document is the one a
/// serial run would have written.
pub(crate) fn replay_test_records(coord: &mut Coordinator) {
    let files = core::mem::take(&mut coord.test_records);
    let Some(junit) = coord.reporter.reporters.junit.as_deref_mut() else {
        return;
    };
    for (idx, file) in files.iter().enumerate() {
        let rel = junit_file_name(coord.files[idx].as_bytes());
        for payload in &file.tests {
            if let Some(test) = runner::decode_test_case(&mut Reader { p: payload }, rel) {
                junit.record_test_case(&test).expect("oom");
            }
        }
        if coord.crashed_files.contains(&(idx as u32)) {
            let crashed = TestCaseReport {
                file: rel,
                scopes: Vec::new(),
                name: b"(worker crashed)",
                status: TestResult::Fail,
                assertions: 0,
                elapsed_ns: 0,
                line_number: 0,
                failure: Some(TestFailure {
                    message: b"worker process crashed before reporting results".to_vec(),
                    ..Default::default()
                }),
            };
            junit.record_test_case(&crashed).expect("oom");
        }
        junit.end_file(Some(file.elapsed_ns)).expect("oom");
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
    reports.sort_unstable_by(|a, b| a.source_url.cmp(&b.source_url));
    if let Err(err) = print_coverage_reports(opts, &reports) {
        Output::err(err, "Failed to write lcov.info", ());
        coord.aborted.get_or_insert(1);
    }
}

use core::fmt;
use core::num::NonZeroU32;
use std::sync::Arc;

use crate::trim::TrimRequest;

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum HeapSize {
    #[default]
    Standard,
    Huge,
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
    pub struct ExplainSet: u16 {
        const TEXT = 1 << 0;
        const JSON = 1 << 1;
        const CHECKS = 1 << 2;
        const CHECKS_JSON = 1 << 3;
        const RUNTIME_USE = 1 << 4;
        const DECLINES = 1 << 5;
        const ALLOCATIONS = 1 << 6;
        const ONLY_UNKNOWN_CODE = 1 << 7;
        const ONLY_UNPROVEN_TYPE = 1 << 8;
        const ONLY_MUTATION = 1 << 9;
        const STATISTICS = 1 << 10;
        const ONLY_LIMIT = 1 << 11;
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub enum ReportDetail {
    #[default]
    Summary,
    Functions,
    Sites,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct BuildReportRequest {
    pub path: Box<[u8]>,
    pub detail: ReportDetail,
}

/// Called with a file's path, in the checker's format, right before the build reads the file, on the thread that reads it.
#[derive(Clone)]
pub struct ReadListener(pub Arc<dyn Fn(&[u8]) + Send + Sync>);

impl fmt::Debug for ReadListener {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ReadListener")
    }
}

#[derive(Clone, Debug)]
pub struct AotOptions {
    pub heap: HeapSize,
    pub embeds_function_source: bool,
    pub explain: ExplainSet,
    pub trim: TrimRequest,
    pub reports_type_mismatches: bool,
    pub erases_types: bool,
    pub emits_symbols: bool,
    pub omits_builtin_modules: bool,
    pub obfuscates: bool,
    pub forbids_text_evaluation: bool,
    pub admits_inspector: bool,
    /// `--aot-allow-code-from-disk`: a path that is known only at run time may name a file with code that the build has not seen. Bun interprets it.
    pub loads_code_from_disk: bool,
    pub ir_output_path: Option<Box<[u8]>>,
    pub build_report: Option<BuildReportRequest>,
    pub runs_in_place: bool,
    pub checks_only: bool,
    /// `bun test --aot`: `@jest/globals` and `vitest` are `bun:test`, as in `bun test`.
    pub runs_tests: bool,
    /// `--watch` starts to watch each file here.
    pub before_read: Option<ReadListener>,
    pub thread_count: Option<NonZeroU32>,
    pub option_words: Vec<Box<[u8]>>,
}

impl Default for AotOptions {
    fn default() -> AotOptions {
        AotOptions {
            heap: HeapSize::Standard,
            embeds_function_source: true,
            explain: ExplainSet::empty(),
            trim: TrimRequest::default(),
            reports_type_mismatches: false,
            erases_types: false,
            emits_symbols: false,
            omits_builtin_modules: false,
            obfuscates: false,
            forbids_text_evaluation: false,
            admits_inspector: false,
            loads_code_from_disk: false,
            ir_output_path: None,
            build_report: None,
            runs_in_place: false,
            checks_only: false,
            runs_tests: false,
            before_read: None,
            thread_count: None,
            option_words: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEMBERS: [(ExplainSet, &str); 12] = [
        (ExplainSet::TEXT, "ExplainSet(TEXT)"),
        (ExplainSet::JSON, "ExplainSet(JSON)"),
        (ExplainSet::CHECKS, "ExplainSet(CHECKS)"),
        (ExplainSet::CHECKS_JSON, "ExplainSet(CHECKS_JSON)"),
        (ExplainSet::RUNTIME_USE, "ExplainSet(RUNTIME_USE)"),
        (ExplainSet::DECLINES, "ExplainSet(DECLINES)"),
        (ExplainSet::ALLOCATIONS, "ExplainSet(ALLOCATIONS)"),
        (
            ExplainSet::ONLY_UNKNOWN_CODE,
            "ExplainSet(ONLY_UNKNOWN_CODE)",
        ),
        (
            ExplainSet::ONLY_UNPROVEN_TYPE,
            "ExplainSet(ONLY_UNPROVEN_TYPE)",
        ),
        (ExplainSet::ONLY_MUTATION, "ExplainSet(ONLY_MUTATION)"),
        (ExplainSet::STATISTICS, "ExplainSet(STATISTICS)"),
        (ExplainSet::ONLY_LIMIT, "ExplainSet(ONLY_LIMIT)"),
    ];

    #[test]
    fn default_is_plain_compile() {
        let AotOptions {
            heap,
            embeds_function_source,
            explain,
            trim,
            reports_type_mismatches,
            erases_types,
            emits_symbols,
            omits_builtin_modules,
            obfuscates,
            forbids_text_evaluation,
            admits_inspector,
            loads_code_from_disk,
            ir_output_path,
            build_report,
            runs_in_place,
            checks_only,
            runs_tests,
            before_read,
            thread_count,
            option_words,
        } = AotOptions::default();
        assert_eq!(heap, HeapSize::Standard);
        assert_eq!(heap, HeapSize::default());
        assert!(embeds_function_source);
        assert!(explain.is_empty());
        assert!(!trim.is_enabled());
        assert!(trim.allow.is_empty());
        assert!(!trim.logs);
        assert!(!reports_type_mismatches);
        assert!(!erases_types);
        assert!(!emits_symbols);
        assert!(!omits_builtin_modules);
        assert!(!obfuscates);
        assert!(!forbids_text_evaluation);
        assert!(!admits_inspector);
        assert!(!loads_code_from_disk);
        assert!(ir_output_path.is_none());
        assert!(build_report.is_none());
        assert!(!runs_in_place);
        assert!(!checks_only);
        assert!(!runs_tests);
        assert!(before_read.is_none());
        assert!(thread_count.is_none());
        assert!(option_words.is_empty());
    }

    #[test]
    fn members_are_single_bits() {
        let mut seen = ExplainSet::empty();
        for (member, _) in MEMBERS {
            assert_eq!(member.bits().count_ones(), 1);
            assert!(!seen.intersects(member));
            seen.insert(member);
        }
        assert_eq!(seen.bits(), 0b1111_1111_1111);
    }

    #[test]
    fn report_details_ascend() {
        assert_eq!(ReportDetail::default(), ReportDetail::Summary);
        assert!(ReportDetail::Summary < ReportDetail::Functions);
        assert!(ReportDetail::Functions < ReportDetail::Sites);
    }
}

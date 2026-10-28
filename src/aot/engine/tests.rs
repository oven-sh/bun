use core::mem::offset_of;
use core::num::NonZeroU32;

use bun_options_types::aot_options::BuildReportRequest;
use bun_removable_features::{Feature, TrimFeature};

use super::ResultSection as Section;
use super::testing::{Sections, bytes_of, with_result};
use super::*;
use crate::ir::generated::{Architecture, CheckSet, StatisticId};
use crate::statistics::can_be_lowered;

const IDENTITY: ExecutableIdentity = ExecutableIdentity(*b"0123456789abcdef");
const THREAD_COUNT: NonZeroUsize = NonZeroUsize::new(7).unwrap();
const TEXT: &[u8] = b"text";
fn with_record(record: CompileOptions) -> EngineOptions {
    EngineOptions {
        record,
        fits_threads_to_program: false,
    }
}

fn fill(record: &mut CompileOptions, options: &AotOptions, thread_count: NonZeroUsize) {
    let request = EngineRequest {
        options,
        identity: IDENTITY,
        image_form: None,
        thread_count,
        reports_functions: false,
    };
    fill_record(record, &request);
}

fn filled_record(change: impl FnOnce(&mut AotOptions)) -> CompileOptions {
    let mut options = AotOptions::default();
    change(&mut options);
    let mut record = zeroed();
    fill(&mut record, &options, THREAD_COUNT);
    record
}

fn expected_record(change: impl FnOnce(&mut CompileOptions)) -> CompileOptions {
    let mut record = CompileOptions {
        executable_identity: IDENTITY.0,
        mismatch_policy: MismatchPolicy::Silent,
        thread_count: 7,
        excluded_code: ExcludedCode::CODE_OUTSIDE_IMAGE,
        ..zeroed()
    };
    record.target.reference_width = ReferenceWidth::Narrow;
    fill_feature_bits(
        &mut record.target.features_kept_only_when_named,
        &bun_trim::features_kept_only_when_named(),
    );
    change(&mut record);
    record
}

fn reports(explain: ExplainSet, detail: Option<ReportDetail>) -> ReportSet {
    let build_report = detail.map(|detail| BuildReportRequest {
        path: Box::from(&b"report.json"[..]),
        detail,
    });
    reports_of(&AotOptions {
        explain,
        build_report,
        ..AotOptions::default()
    })
}

fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..][..4].copy_from_slice(&value.to_ne_bytes());
}

fn patched_record<T: ResultRecord>(patches: &[(usize, u32)]) -> Vec<u8> {
    let mut bytes = vec![0; size_of::<T>()];
    for &(offset, value) in patches {
        write_u32(&mut bytes, offset, value);
    }
    bytes
}

fn range(offset: u32, length: u32) -> TextRange {
    TextRange { offset, length }
}

#[test]
fn options_fill_record() {
    assert_eq!(filled_record(|_| {}), expected_record(|_| {}));
    assert_eq!(
        filled_record(|options| options.heap = HeapSize::Huge),
        expected_record(|record| record.target.reference_width = ReferenceWidth::Wide)
    );
    assert_eq!(
        filled_record(|options| options.reports_type_mismatches = true),
        expected_record(|record| record.mismatch_policy = MismatchPolicy::Report)
    );
    assert_eq!(
        filled_record(|options| options.emits_symbols = true),
        expected_record(|record| record.reports = ReportSet::SYMBOLS)
    );
    assert_eq!(
        filled_record(|options| options.admits_inspector = true),
        expected_record(|record| record.admitted_code = AdmittedCode::INSPECTOR)
    );
    assert_eq!(
        filled_record(|options| options.forbids_text_evaluation = true),
        expected_record(|record| record.excluded_code |= ExcludedCode::EVALUATED_TEXT)
    );
    assert_eq!(
        filled_record(|options| options.loads_code_from_disk = true),
        expected_record(|record| record.excluded_code = ExcludedCode::default())
    );
    assert_eq!(
        filled_record(|options| options.embeds_function_source = false),
        expected_record(|record| record.excluded_code |= ExcludedCode::FUNCTION_SOURCE)
    );
    assert_eq!(
        filled_record(|options| options.obfuscates = true),
        expected_record(|record| record.output = OutputOptions::OBFUSCATE)
    );
}

#[test]
fn features_removed_by_request_fill_bits() {
    let sqlite = TrimFeature::from_name(b"sqlite").unwrap();
    let filled = filled_record(|options| {
        options.trim.remove = vec![sqlite];
        options.trim.remove_internal = vec![Feature::Dns];
    });
    let expected = expected_record(|record| {
        for feature in [Feature::Sqlite, Feature::SqliteExtensions, Feature::Dns] {
            record.removed_features[usize::from(feature.index()) / 64] |=
                1 << (feature.index() % 64);
        }
    });
    assert_eq!(filled, expected);
}

#[test]
fn each_option_fills_one_member() {
    let filled = filled_record(|options| {
        options.heap = HeapSize::Huge;
        options.reports_type_mismatches = true;
        options.emits_symbols = true;
        options.explain = ExplainSet::ALLOCATIONS;
        options.admits_inspector = true;
        options.forbids_text_evaluation = true;
        options.embeds_function_source = false;
        options.obfuscates = true;
    });
    let expected = expected_record(|record| {
        record.target.reference_width = ReferenceWidth::Wide;
        record.mismatch_policy = MismatchPolicy::Report;
        record.reports = ReportSet::SYMBOLS | ReportSet::ALLOCATIONS;
        record.admitted_code = AdmittedCode::INSPECTOR;
        record.excluded_code |= ExcludedCode::EVALUATED_TEXT | ExcludedCode::FUNCTION_SOURCE;
        record.output = OutputOptions::OBFUSCATE;
    });
    assert_eq!(filled, expected);
}

#[test]
fn engine_defaults_are_preserved() {
    let defaults = CompileOptions {
        size: size_of::<CompileOptions>() as u32,
        size_class_progression: 1.5,
        checks: CheckSet::VALIDATE,
        layout_seed: 9,
        ..zeroed()
    };
    let mut record = defaults;
    fill(&mut record, &AotOptions::default(), THREAD_COUNT);
    let expected = expected_record(|record| {
        record.size = defaults.size;
        record.size_class_progression = defaults.size_class_progression;
        record.checks = defaults.checks;
        record.layout_seed = defaults.layout_seed;
    });
    assert_eq!(record, expected);
}

#[test]
fn image_form_of_the_target_replaces_the_default() {
    let options = AotOptions::default();
    let mut request = EngineRequest {
        options: &options,
        identity: IDENTITY,
        image_form: None,
        thread_count: THREAD_COUNT,
        reports_functions: false,
    };
    let mut record: CompileOptions = zeroed();
    record.target.image_form = ImageForm::PositionIndependent;
    fill_record(&mut record, &request);
    assert_eq!(record.target.image_form, ImageForm::PositionIndependent);
    request.image_form = Some(TargetImageForm::Absolute);
    fill_record(&mut record, &request);
    assert_eq!(record.target.image_form, ImageForm::Absolute);
    request.image_form = Some(TargetImageForm::PositionIndependent);
    fill_record(&mut record, &request);
    assert_eq!(record.target.image_form, ImageForm::PositionIndependent);
}

#[test]
fn heap_size_replaces_default_reference_width() {
    let huge_heap = AotOptions {
        heap: HeapSize::Huge,
        ..AotOptions::default()
    };
    let mut record: CompileOptions = zeroed();
    record.target.reference_width = ReferenceWidth::Narrow;
    fill(&mut record, &huge_heap, THREAD_COUNT);
    assert_eq!(record.target.reference_width, ReferenceWidth::Wide);
    fill(&mut record, &AotOptions::default(), THREAD_COUNT);
    assert_eq!(record.target.reference_width, ReferenceWidth::Narrow);
}

#[test]
fn thread_count_saturates() {
    let mut record: CompileOptions = zeroed();
    fill(&mut record, &AotOptions::default(), NonZeroUsize::MIN);
    assert_eq!(record.thread_count, 1);
    fill(&mut record, &AotOptions::default(), NonZeroUsize::MAX);
    assert_eq!(record.thread_count, u32::MAX);
}

#[test]
fn default_options_ask_for_no_report() {
    assert_eq!(reports_of(&AotOptions::default()), ReportSet::default());
}

#[test]
fn reports_follow_explain_and_detail() {
    let no_report = ReportSet::default();
    let cases = [
        (ExplainSet::TEXT, None, ReportSet::FLOW),
        (ExplainSet::JSON, None, ReportSet::FLOW),
        (ExplainSet::CHECKS, None, ReportSet::FLOW),
        (ExplainSet::CHECKS_JSON, None, ReportSet::FLOW),
        (ExplainSet::ONLY_UNKNOWN_CODE, None, ReportSet::FLOW),
        (ExplainSet::ONLY_UNPROVEN_TYPE, None, ReportSet::FLOW),
        (ExplainSet::ONLY_MUTATION, None, ReportSet::FLOW),
        (ExplainSet::ONLY_LIMIT, None, ReportSet::FLOW),
        (ExplainSet::DECLINES, None, ReportSet::DECLINES),
        (ExplainSet::ALLOCATIONS, None, ReportSet::ALLOCATIONS),
        // The places in the lines of --explain=trim.
        (ExplainSet::RUNTIME_USE, None, ReportSet::FLOW),
        (ExplainSet::STATISTICS, None, no_report),
        (
            ExplainSet::empty(),
            Some(ReportDetail::Summary),
            ReportSet::DECLINES,
        ),
        (
            ExplainSet::empty(),
            Some(ReportDetail::Functions),
            ReportSet::DECLINES | ReportSet::FUNCTIONS,
        ),
        (
            ExplainSet::empty(),
            Some(ReportDetail::Sites),
            ReportSet::FLOW | ReportSet::DECLINES | ReportSet::FUNCTIONS,
        ),
        (
            ExplainSet::TEXT | ExplainSet::ALLOCATIONS,
            Some(ReportDetail::Summary),
            ReportSet::FLOW | ReportSet::DECLINES | ReportSet::ALLOCATIONS,
        ),
    ];
    for (explain, detail, expected) in cases {
        assert_eq!(reports(explain, detail), expected, "{explain:?} {detail:?}");
    }
}

#[test]
fn front_end_options_do_not_reach_record() {
    let changed = filled_record(|options| {
        options.explain = ExplainSet::STATISTICS;
        options.trim.removes_unused = true;
        options.erases_types = true;
        options.omits_builtin_modules = true;
        options.ir_output_path = Some(Box::from(&b"program.ir"[..]));
        options.runs_in_place = true;
        options.runs_tests = true;
        options.thread_count = NonZeroU32::new(3);
        options.option_words = vec![Box::from(&b"validate"[..])];
    });
    assert_eq!(changed, filled_record(|_| {}));
}

#[test]
fn default_thread_count_fits_the_program() {
    let mut record: CompileOptions = zeroed();
    record.thread_count = 192;
    let fitted = EngineOptions {
        record,
        fits_threads_to_program: true,
    };
    assert_eq!(fitted.record_for(0).thread_count, 1);
    assert_eq!(
        fitted.record_for(PROGRAM_BYTES_PER_THREAD - 1).thread_count,
        1
    );
    assert_eq!(
        fitted.record_for(7 * PROGRAM_BYTES_PER_THREAD).thread_count,
        8
    );
    assert_eq!(fitted.record_for(1 << 30).thread_count, 192);
}

#[test]
fn chosen_thread_count_is_kept() {
    let mut record: CompileOptions = zeroed();
    record.thread_count = 192;
    assert_eq!(with_record(record).record_for(0).thread_count, 192);
}

#[test]
fn limit_values_apply_lowered_limit() {
    let mut record: CompileOptions = zeroed();
    record.target.architecture = Architecture::X86_64;
    record.lowered_limit = LimitId::MaxTypeNodes;
    record.lowered_limit_value = 3;
    let limits = with_record(record).limit_values();
    for limit in LimitId::ALL {
        let expected = match limit {
            LimitId::MaxTypeNodes => 3,
            _ => limit.value(Architecture::X86_64),
        };
        assert_eq!(limits.get(limit), expected, "{limit:?}");
    }
}

#[test]
fn all_lowers_each_limit_to_no_less_than_its_smallest() {
    let mut record: CompileOptions = zeroed();
    record.target.architecture = Architecture::X86_64;
    record.lowered_limit = LimitId::All;
    record.lowered_limit_value = 2;
    let limits = with_record(record).limit_values();
    for limit in LimitId::ALL {
        let usual = limit.value(Architecture::X86_64);
        let expected = if can_be_lowered(limit) {
            usual.min(limit.smallest().max(2))
        } else {
            usual
        };
        assert_eq!(limits.get(limit), expected, "{limit:?}");
    }
}

#[test]
fn limit_values_follow_target_architecture() {
    for architecture in Architecture::ALL {
        let mut record: CompileOptions = zeroed();
        record.target.architecture = architecture;
        record.lowered_limit_value = 3;
        let limits = with_record(record).limit_values();
        assert_eq!(
            limits,
            LimitValues::for_target(architecture),
            "{architecture:?}"
        );
    }
}

#[test]
fn text_outside_section_is_empty() {
    with_result(&Sections::new().with(Section::Text, TEXT), |result| {
        assert_eq!(result.text(range(0, 4)), b"text");
        assert_eq!(result.text(range(1, 2)), b"ex");
        assert_eq!(result.text(range(4, 0)), b"");
        assert_eq!(result.text(range(0, 5)), b"");
        assert_eq!(result.text(range(5, 0)), b"");
        assert_eq!(result.text(range(u32::MAX, u32::MAX)), b"");
    });
}

#[test]
fn empty_image_is_absent() {
    with_result(&Sections::new(), |result| assert_eq!(result.image(), None));
    with_result(&Sections::new().with(Section::Image, b"image"), |result| {
        assert_eq!(result.image(), Some(&b"image"[..]));
    });
}

#[test]
fn sections_are_read_as_typed_elements() {
    let limit_values = LimitId::ALL.map(|limit| limit as u64 * 5 + 2);
    let statistics = StatisticId::ALL.map(|id| id as u64 * 3 + 1);
    let entry_module_ids = [7u32.to_ne_bytes(), u32::MAX.to_ne_bytes()].concat();
    let module = offset_of!(AccessCountRecord, module);
    let access_counts = [4, 9].map(|word| patched_record::<AccessCountRecord>(&[(module, word)]));
    let sections = Sections::new()
        .with(Section::LimitValues, bytes_of(&limit_values))
        .with(Section::Statistics, bytes_of(&statistics))
        .with(Section::EntryModuleIds, &entry_module_ids)
        .with(Section::AccessCounts, &access_counts.concat());
    with_result(&sections, |result| {
        for limit in LimitId::ALL {
            assert_eq!(result.limit_value(limit), limit as u64 * 5 + 2, "{limit:?}");
        }
        assert_eq!(result.statistics(), statistics);
        assert_eq!(result.entry_module_ids(), [7, u32::MAX].map(EngineModuleId));
        let modules: Vec<u32> = result.access_counts().iter().map(|it| it.module).collect();
        assert_eq!(modules, [4, 9]);
        assert!(result.accesses().is_empty());
    });
}

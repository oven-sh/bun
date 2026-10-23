use core::mem::offset_of;
use core::num::NonZeroU32;

use bun_options_types::aot_options::BuildReportRequest;

use super::ResultSection as Section;
use super::sections::{MalformedReason as Reason, MalformedSection, SectionLengths, check_section};
use super::testing::{Sections, bytes_of, to_words, with_result};
use super::*;
use crate::ir::generated::{
    AccessCost, AccessKind, AllocationEscapeReason, AllocationKind, AllocationOutcome,
    Architecture, ArrivalFieldFlags, ArrivalLayoutFlags, ArrivalStamp, BuiltinUse, CheckCause,
    CheckSet, DeclineKind, IllTypedCause, InternalErrorKind, KnowledgeLevel, LocaleUseKind, PassId,
    Stage, StatisticId, TypeSiteKind, TypeTestFailure, UnprovenCause, UnseenCodeCause,
    UserDiagnosticKind,
};

const IDENTITY: ExecutableIdentity = ExecutableIdentity(*b"0123456789abcdef");
const THREAD_COUNT: NonZeroUsize = NonZeroUsize::new(7).unwrap();
const TEXT: &[u8] = b"text";
const ONLY_TEXT: SectionLengths = SectionLengths {
    text: TEXT.len(),
    operation_counts: 0,
    arrival_site_layouts: 0,
    arrival_layout_fields: 0,
};

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
        mismatch_policy: MismatchPolicy::Throw,
        thread_count: 7,
        ..zeroed()
    };
    record.target.reference_width = ReferenceWidth::Narrow;
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

fn check_shifted(
    section: Section,
    bytes: &[u8],
    shift: usize,
    lengths: &SectionLengths,
) -> Option<Reason> {
    let words = to_words(&[&vec![0; shift][..], bytes].concat());
    check_section(section, &bytes_of(&words)[shift..][..bytes.len()], lengths).err()
}

fn check(section: Section, bytes: &[u8]) -> Option<Reason> {
    check_shifted(section, bytes, 0, &ONLY_TEXT)
}

fn check_zeros(section: Section, length: usize) -> Option<Reason> {
    check(section, &vec![0; length])
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

fn check_patched_record<T: ResultRecord>(patches: &[(usize, u32)]) -> Option<Reason> {
    check(T::SECTION, &patched_record::<T>(patches))
}

fn check_member_of_each_record<T: ResultRecord>(member: usize, values: &[u32]) -> Option<Reason> {
    let records = values
        .iter()
        .flat_map(|&value| patched_record::<T>(&[(member, value)]));
    check(T::SECTION, &records.collect::<Vec<u8>>())
}

fn range(offset: u32, length: u32) -> TextRange {
    TextRange { offset, length }
}

fn malformed(section: Section, reason: Reason) -> Result<(), MalformedSection> {
    Err(MalformedSection { section, reason })
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
        expected_record(|record| record.excluded_code = ExcludedCode::EVALUATED_TEXT)
    );
    assert_eq!(
        filled_record(|options| options.embeds_function_source = false),
        expected_record(|record| record.excluded_code = ExcludedCode::FUNCTION_SOURCE)
    );
    assert_eq!(
        filled_record(|options| options.obfuscates = true),
        expected_record(|record| record.output = OutputOptions::OBFUSCATE)
    );
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
        record.excluded_code = ExcludedCode::EVALUATED_TEXT | ExcludedCode::FUNCTION_SOURCE;
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
    let every_site_report = ReportSet::FLOW
        | ReportSet::DECLINES
        | ReportSet::ALLOCATIONS
        | ReportSet::FUNCTIONS
        | ReportSet::ARRIVALS
        | ReportSet::PASS_CODE_BYTES;
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
            every_site_report,
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
fn lengths_must_fit_elements() {
    let statistics_size = 8 * StatisticId::COUNT;
    let limit_values_size = 8 * LimitId::COUNT;
    for (section, length) in [
        (
            Section::UserDiagnostics,
            size_of::<UserDiagnosticRecord>() - 1,
        ),
        (Section::EntryModuleIds, 7),
        (Section::ArrivalSiteLayouts, 7),
        (Section::Accesses, size_of::<AccessRecord>() + 4),
        (
            Section::RemainingChecks,
            size_of::<RemainingCheckRecord>() - 8,
        ),
        (Section::Statistics, 0),
        (Section::Statistics, statistics_size - 8),
        (Section::Statistics, statistics_size + 8),
        (Section::LimitValues, 0),
        (Section::LimitValues, limit_values_size - 8),
        (Section::LimitValues, limit_values_size + 8),
    ] {
        assert_eq!(
            check_zeros(section, length),
            Some(Reason::Length),
            "{section:?} {length}"
        );
    }
    for (section, length) in [
        (Section::UserDiagnostics, 0),
        (
            Section::UserDiagnostics,
            2 * size_of::<UserDiagnosticRecord>(),
        ),
        (Section::EntryModuleIds, 8),
        (Section::ArrivalSiteLayouts, 8),
        (Section::Statistics, statistics_size),
        (Section::LimitValues, limit_values_size),
        (Section::Image, 7),
    ] {
        assert_eq!(check_zeros(section, length), None, "{section:?} {length}");
    }
}

#[test]
fn sections_must_be_aligned() {
    let check_at =
        |section, length, shift| check_shifted(section, &vec![0; length], shift, &ONLY_TEXT);
    for (section, length, shift) in [
        (
            Section::UserDiagnostics,
            size_of::<UserDiagnosticRecord>(),
            4,
        ),
        (Section::EntryModuleIds, 4, 2),
        (Section::ArrivalSiteLayouts, 4, 2),
        (
            Section::RemainingChecks,
            size_of::<RemainingCheckRecord>(),
            4,
        ),
        (Section::PassTimes, size_of::<PassTimeRecord>(), 4),
        (Section::Statistics, 8 * StatisticId::COUNT, 4),
        (Section::LimitValues, 8 * LimitId::COUNT, 1),
    ] {
        let reason = check_at(section, length, shift);
        assert_eq!(reason, Some(Reason::Alignment), "{section:?}");
    }
    for (section, length, shift) in [
        (
            Section::UserDiagnostics,
            size_of::<UserDiagnosticRecord>(),
            8,
        ),
        (Section::UserDiagnostics, 0, 1),
        (Section::EntryModuleIds, 4, 4),
        (Section::Image, 3, 1),
        (Section::Text, 3, 1),
        (Section::Symbols, 3, 1),
    ] {
        assert_eq!(check_at(section, length, shift), None, "{section:?}");
    }
}

#[test]
fn enumerators_must_be_declared() {
    macro_rules! assert_bounded {
        ($record:ty, $member:ident, $enumeration:ty) => {{
            let offset = offset_of!($record, $member);
            let check_value = |value| check_patched_record::<$record>(&[(offset, value)]);
            let count = <$enumeration>::COUNT as u32;
            assert_eq!(check_value(count - 1), None);
            assert_eq!(check_value(count), Some(Reason::Enumerator));
            assert_eq!(check_value(u32::MAX), Some(Reason::Enumerator));
        }};
    }
    assert_bounded!(UserDiagnosticRecord, kind, UserDiagnosticKind);
    assert_bounded!(UserDiagnosticRecord, limit, LimitId);
    assert_bounded!(InternalErrorRecord, kind, InternalErrorKind);
    assert_bounded!(InternalErrorRecord, limit, LimitId);
    assert_bounded!(InternalErrorRecord, pass, PassId);
    assert_bounded!(UnseenCodeRecord, cause, UnseenCodeCause);
    assert_bounded!(LocaleUseRecord, kind, LocaleUseKind);
    assert_bounded!(AccessRecord, kind, AccessKind);
    assert_bounded!(AccessRecord, level, KnowledgeLevel);
    assert_bounded!(AccessRecord, cause, UnprovenCause);
    assert_bounded!(AccessRecord, limit, LimitId);
    assert_bounded!(AccessRecord, ill_typed_cause, IllTypedCause);
    assert_bounded!(AccessRecord, cost, AccessCost);
    assert_bounded!(TypeTestRecord, failure, TypeTestFailure);
    assert_bounded!(RemainingCheckRecord, cause, CheckCause);
    assert_bounded!(RemainingCheckRecord, site_kind, TypeSiteKind);
    assert_bounded!(DeclineRecord, kind, DeclineKind);
    assert_bounded!(DeclineRecord, limit, LimitId);
    assert_bounded!(AllocationRemarkRecord, outcome, AllocationOutcome);
    assert_bounded!(AllocationRemarkRecord, limit, LimitId);
    assert_bounded!(AllocationRemarkRecord, kind, AllocationKind);
    assert_bounded!(LossRecord, limit, LimitId);
    assert_bounded!(LossRecord, stage, Stage);
    assert_bounded!(PassTimeRecord, pass, PassId);
    assert_bounded!(ArrivalSiteRecord, kind, AccessKind);
    assert_bounded!(ArrivalSiteRecord, level, KnowledgeLevel);
    assert_bounded!(ArrivalSiteRecord, cause, UnprovenCause);
    assert_bounded!(ArrivalSiteRecord, stamp, ArrivalStamp);
}

#[test]
fn every_record_is_checked() {
    for section in Section::ALL {
        let expected = match section {
            Section::Image | Section::Text | Section::Symbols => None,
            _ => Some(Reason::Length),
        };
        assert_eq!(check(section, &[0]), expected, "{section:?}");
    }
}

#[test]
fn later_records_are_checked() {
    let kind = offset_of!(DeclineRecord, kind);
    let undeclared = DeclineKind::COUNT as u32;
    let check_kinds = |kinds: &[u32]| check_member_of_each_record::<DeclineRecord>(kind, kinds);
    assert_eq!(check_kinds(&[0, 1, 0]), None);
    assert_eq!(check_kinds(&[0, 1, undeclared]), Some(Reason::Enumerator));
}

#[test]
fn escape_reasons_must_be_declared() {
    let offset = offset_of!(AllocationRemarkRecord, reasons);
    let check_value = |value| check_patched_record::<AllocationRemarkRecord>(&[(offset, value)]);
    let declared = AllocationEscapeReason::ALL.0;
    assert_eq!(check_value(declared), None);
    assert_eq!(check_value(declared + 1), Some(Reason::Enumerator));
    assert_eq!(check_value(u32::MAX), Some(Reason::Enumerator));
}

#[test]
fn builtin_uses_must_be_declared() {
    let offset = offset_of!(BuiltinUseRecord, uses);
    let check_value = |value| check_patched_record::<BuiltinUseRecord>(&[(offset, value)]);
    let declared = BuiltinUse::ALL.0;
    assert_eq!(check_value(declared), None);
    assert_eq!(check_value(declared + 1), Some(Reason::Enumerator));
    assert_eq!(check_value(u32::MAX), Some(Reason::Enumerator));
}

#[test]
fn arrival_flags_must_be_declared() {
    fn assert_bounded<T: ResultRecord>(member: usize, declared: u32) {
        let check_value = |value| check_patched_record::<T>(&[(member, value)]);
        assert_eq!(check_value(declared), None);
        assert_eq!(check_value(declared + 1), Some(Reason::Enumerator));
        assert_eq!(check_value(u32::MAX), Some(Reason::Enumerator));
    }
    let layout_flags = offset_of!(ArrivalLayoutRecord, flags);
    assert_bounded::<ArrivalLayoutRecord>(layout_flags, ArrivalLayoutFlags::ALL.0);
    let field_flags = offset_of!(ArrivalLayoutFieldRecord, flags);
    assert_bounded::<ArrivalLayoutFieldRecord>(field_flags, ArrivalFieldFlags::ALL.0);
}

#[test]
fn text_ranges_must_lie_inside_text() {
    fn assert_bounded<T: ResultRecord>(members: &[usize]) {
        assert_eq!(T::TEXT_MEMBERS, members);
        for &member in members {
            let check_range = |offset, length| {
                let length_member = member + offset_of!(TextRange, length);
                check_patched_record::<T>(&[(member, offset), (length_member, length)])
            };
            assert_eq!(check_range(0, 4), None);
            assert_eq!(check_range(4, 0), None);
            assert_eq!(check_range(1, 4), Some(Reason::TextRange));
            assert_eq!(check_range(5, 0), Some(Reason::TextRange));
            assert_eq!(check_range(u32::MAX, 2), Some(Reason::TextRange));
        }
    }
    assert_bounded::<UserDiagnosticRecord>(&[offset_of!(UserDiagnosticRecord, message)]);
    assert_bounded::<InternalErrorRecord>(&[offset_of!(InternalErrorRecord, message)]);
    assert_bounded::<LocaleUseRecord>(&[offset_of!(LocaleUseRecord, tag)]);
    let operation = offset_of!(AllocationRemarkRecord, forcing_operation);
    assert_bounded::<AllocationRemarkRecord>(&[operation]);
    assert_bounded::<FunctionReportRecord>(&[offset_of!(FunctionReportRecord, role)]);
    assert_bounded::<OperationCountRecord>(&[offset_of!(OperationCountRecord, name)]);
    assert_bounded::<ObfuscatedSiteRecord>(&[offset_of!(ObfuscatedSiteRecord, name)]);
    assert_bounded::<ArrivalSiteRecord>(&[offset_of!(ArrivalSiteRecord, operation)]);
    assert_bounded::<ArrivalLayoutRecord>(&[
        offset_of!(ArrivalLayoutRecord, kind),
        offset_of!(ArrivalLayoutRecord, name),
    ]);
    assert_bounded::<ArrivalLayoutFieldRecord>(&[offset_of!(ArrivalLayoutFieldRecord, name)]);
}

#[test]
fn access_counts_must_ascend() {
    let module = offset_of!(AccessCountRecord, module);
    let check_modules =
        |modules: &[u32]| check_member_of_each_record::<AccessCountRecord>(module, modules);
    assert_eq!(check_modules(&[]), None);
    assert_eq!(check_modules(&[0, 1, 5]), None);
    assert_eq!(check_modules(&[1, 1]), Some(Reason::Order));
    assert_eq!(check_modules(&[0, 2, 1]), Some(Reason::Order));
}

#[test]
fn features_must_not_descend() {
    let feature = offset_of!(FeatureUseRecord, feature);
    let check_features =
        |features: &[u32]| check_member_of_each_record::<FeatureUseRecord>(feature, features);
    assert_eq!(check_features(&[3, 3, 4]), None);
    assert_eq!(check_features(&[3, 4, 3]), Some(Reason::Order));
}

#[test]
fn check_ids_must_ascend() {
    let check_ids = |ids: &[u64]| {
        let size = size_of::<RemainingCheckRecord>();
        let mut bytes = vec![0; ids.len() * size];
        for (record, id) in bytes.chunks_exact_mut(size).zip(ids) {
            let member = &mut record[offset_of!(RemainingCheckRecord, id)..][..8];
            member.copy_from_slice(&id.to_ne_bytes());
        }
        check(Section::RemainingChecks, &bytes)
    };
    assert_eq!(check_ids(&[0, 1, 1 << 40]), None);
    assert_eq!(check_ids(&[2, 2]), Some(Reason::Order));
    assert_eq!(check_ids(&[3, 2]), Some(Reason::Order));
    assert_eq!(check_ids(&[1 << 32, 1]), Some(Reason::Order));
}

#[test]
fn arrival_site_numbers_must_ascend() {
    let number = offset_of!(ArrivalSiteRecord, number);
    let check_numbers =
        |numbers: &[u32]| check_member_of_each_record::<ArrivalSiteRecord>(number, numbers);
    assert_eq!(check_numbers(&[]), None);
    assert_eq!(check_numbers(&[0, 1, 5]), None);
    assert_eq!(check_numbers(&[1, 1]), Some(Reason::Order));
    assert_eq!(check_numbers(&[0, 2, 1]), Some(Reason::Order));
}

#[test]
fn arrival_layouts_must_ascend() {
    let layout = offset_of!(ArrivalLayoutRecord, layout);
    let check_layouts =
        |layouts: &[u32]| check_member_of_each_record::<ArrivalLayoutRecord>(layout, layouts);
    assert_eq!(check_layouts(&[]), None);
    assert_eq!(check_layouts(&[0, 1, 5]), None);
    assert_eq!(check_layouts(&[1, 1]), Some(Reason::Order));
    assert_eq!(check_layouts(&[0, 2, 1]), Some(Reason::Order));
}

fn assert_range_lies_inside_three_elements<T: ResultRecord>(
    first_member: usize,
    count_member: usize,
    lengths: &SectionLengths,
) {
    let check_range = |first, count| {
        let record = patched_record::<T>(&[(first_member, first), (count_member, count)]);
        check_shifted(T::SECTION, &record, 0, lengths)
    };
    assert_eq!(check_range(0, 3), None);
    assert_eq!(check_range(3, 0), None);
    assert_eq!(check_range(1, 3), Some(Reason::Range));
    assert_eq!(check_range(4, 0), Some(Reason::Range));
    assert_eq!(check_range(u32::MAX, u32::MAX), Some(Reason::Range));
}

#[test]
fn operation_ranges_must_lie_inside_section() {
    assert_range_lies_inside_three_elements::<FunctionReportRecord>(
        offset_of!(FunctionReportRecord, first_operation),
        offset_of!(FunctionReportRecord, operation_count),
        &SectionLengths {
            operation_counts: 3,
            ..ONLY_TEXT
        },
    );
}

#[test]
fn expected_layout_ranges_must_lie_inside_section() {
    assert_range_lies_inside_three_elements::<ArrivalSiteRecord>(
        offset_of!(ArrivalSiteRecord, first_expected_layout),
        offset_of!(ArrivalSiteRecord, expected_layout_count),
        &SectionLengths {
            arrival_site_layouts: 3,
            ..ONLY_TEXT
        },
    );
}

#[test]
fn layout_field_ranges_must_lie_inside_section() {
    assert_range_lies_inside_three_elements::<ArrivalLayoutRecord>(
        offset_of!(ArrivalLayoutRecord, first_field),
        offset_of!(ArrivalLayoutRecord, field_count),
        &SectionLengths {
            arrival_layout_fields: 3,
            ..ONLY_TEXT
        },
    );
}

#[test]
fn first_malformed_section_is_reported() {
    let sections = Sections::new()
        .with(Section::Statistics, &[0; 8])
        .with(Section::EntryModuleIds, &[0; 7]);
    assert_eq!(
        sections.check(),
        malformed(Section::EntryModuleIds, Reason::Length)
    );
}

#[test]
fn result_without_records_is_well_formed() {
    assert_eq!(Sections::new().check(), Ok(()));
}

#[test]
fn text_length_comes_from_text_section() {
    let length = offset_of!(UserDiagnosticRecord, message) + offset_of!(TextRange, length);
    let diagnostic = patched_record::<UserDiagnosticRecord>(&[(length, TEXT.len() as u32)]);
    let sections = Sections::new().with(Section::UserDiagnostics, &diagnostic);
    assert_eq!(
        sections.check(),
        malformed(Section::UserDiagnostics, Reason::TextRange)
    );
    assert_eq!(sections.with(Section::Text, TEXT).check(), Ok(()));
}

#[test]
fn operation_count_comes_from_operation_section() {
    let count = offset_of!(FunctionReportRecord, operation_count);
    let function = patched_record::<FunctionReportRecord>(&[(count, 2)]);
    let operations = vec![0; 2 * size_of::<OperationCountRecord>()];
    let sections = Sections::new().with(Section::Functions, &function);
    assert_eq!(
        sections.check(),
        malformed(Section::Functions, Reason::Range)
    );
    assert_eq!(
        sections.with(Section::OperationCounts, &operations).check(),
        Ok(())
    );
}

#[test]
fn expected_layout_count_comes_from_site_layout_section() {
    let count = offset_of!(ArrivalSiteRecord, expected_layout_count);
    let site = patched_record::<ArrivalSiteRecord>(&[(count, 2)]);
    let sections = Sections::new().with(Section::ArrivalSites, &site);
    assert_eq!(
        sections.check(),
        malformed(Section::ArrivalSites, Reason::Range)
    );
    assert_eq!(
        sections.with(Section::ArrivalSiteLayouts, &[0; 8]).check(),
        Ok(())
    );
}

#[test]
fn layout_field_count_comes_from_field_section() {
    let count = offset_of!(ArrivalLayoutRecord, field_count);
    let layout = patched_record::<ArrivalLayoutRecord>(&[(count, 2)]);
    let fields = vec![0; 2 * size_of::<ArrivalLayoutFieldRecord>()];
    let sections = Sections::new().with(Section::ArrivalLayouts, &layout);
    assert_eq!(
        sections.check(),
        malformed(Section::ArrivalLayouts, Reason::Range)
    );
    assert_eq!(
        sections.with(Section::ArrivalLayoutFields, &fields).check(),
        Ok(())
    );
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

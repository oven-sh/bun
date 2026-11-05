use core::mem::offset_of;
use core::num::NonZeroU32;

use bun_options_types::aot_options::ExplainSet;
use bun_removable_features::{Feature, TrimFeature};

use super::ResultSection as Section;
use super::testing::{Sections, with_result, with_result_to_write};
use super::*;
use crate::ir::generated::{Architecture, CheckSet, StatisticId};

const IDENTITY: ExecutableIdentity = ExecutableIdentity(*b"0123456789abcdef");
const THREAD_COUNT: NonZeroUsize = NonZeroUsize::new(7).unwrap();
const TEXT: &[u8] = b"text";
const REFUSAL: &[u8] = b"the engine knows no such word";

pub(super) fn fake_initialize_options(options: &mut CompileOptions) {
    *options = CompileOptions {
        size: size_of::<CompileOptions>() as u32,
        ..zeroed()
    };
}

/// SAFETY: `options` is valid for reads and writes, `word` for reads, and `message` for writes of `capacity` bytes.
pub(super) unsafe fn fake_apply_option_word(
    options: *mut CompileOptions,
    word: BunAOTBytes,
    message: *mut u8,
    capacity: usize,
) -> usize {
    // SAFETY: the caller's promise.
    let (record, text): (&mut CompileOptions, &[u8]) = unsafe { (&mut *options, word.as_slice()) };
    if text == b"check=Validate" {
        record.checks |= CheckSet::VALIDATE;
        return 0;
    }
    // SAFETY: the caller's promise, and no more than `capacity` bytes are written.
    unsafe { message.copy_from_nonoverlapping(REFUSAL.as_ptr(), REFUSAL.len().min(capacity)) };
    REFUSAL.len()
}

fn with_record(record: CompileOptions) -> EngineOptions {
    EngineOptions { record }
}

fn request_for(options: &AotOptions, thread_count: NonZeroUsize) -> EngineRequest<'_> {
    EngineRequest {
        options,
        identity: IDENTITY,
        image_form: None,
        thread_count,
    }
}

fn fill(record: &mut CompileOptions, options: &AotOptions, thread_count: NonZeroUsize) {
    fill_record(record, &request_for(options, thread_count));
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
        thread_count: 7,
        excluded_code: ExcludedCode::CODE_OUTSIDE_IMAGE | ExcludedCode::LIBRARY_TEXT,
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

fn boxed_words(words: &[&[u8]]) -> Vec<Box<[u8]>> {
    words.iter().map(|&word| Box::from(word)).collect()
}

fn engine_options_with_words(words: &[&[u8]]) -> Result<EngineOptions, RejectedOptionWord> {
    let options = AotOptions {
        option_words: boxed_words(words),
        ..AotOptions::default()
    };
    EngineOptions::new(&request_for(&options, THREAD_COUNT))
}

fn refusal_of(word: &[u8]) -> RejectedOptionWord {
    RejectedOptionWord {
        word: word.to_vec(),
        sentence: REFUSAL.to_vec(),
    }
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
        filled_record(|options| options.emits_symbols = true),
        expected_record(|record| record.reports = ReportSet::SYMBOLS)
    );
    assert_eq!(
        filled_record(|options| options.admits_inspector = true),
        expected_record(|record| record.admitted_code = AdmittedCode::INSPECTOR)
    );
    assert_eq!(
        filled_record(|options| options.runs_tests = true),
        expected_record(|record| record.admitted_code = AdmittedCode::REPLACED_BUILTINS)
    );
    assert_eq!(
        filled_record(|options| options.omits_builtin_modules = true),
        expected_record(|record| record.excluded_code = ExcludedCode::CODE_OUTSIDE_IMAGE)
    );
    assert_eq!(
        filled_record(|options| {
            options.code_generation_from_strings = CodeGenerationFromStrings::DisallowedLikeNode;
        }),
        expected_record(|record| record.excluded_code |= ExcludedCode::EVALUATED_TEXT)
    );
    assert_eq!(
        filled_record(|options| {
            options.code_generation_from_strings = CodeGenerationFromStrings::Strict;
        }),
        expected_record(|record| {
            record.excluded_code |=
                ExcludedCode::EVALUATED_TEXT | ExcludedCode::HOST_EVALUATED_TEXT;
        })
    );
    assert_eq!(
        filled_record(|options| options.omits_foreign_calls = true),
        expected_record(|record| record.excluded_code |= ExcludedCode::FOREIGN_CALLS)
    );
    assert_eq!(
        filled_record(|options| options.loads_code_from_disk = true),
        expected_record(|record| record.excluded_code = ExcludedCode::LIBRARY_TEXT)
    );
    assert_eq!(
        filled_record(|options| {
            options.loads_code_from_disk = true;
            options.isolates_code_from_disk = true;
        }),
        expected_record(|record| {
            record.excluded_code =
                ExcludedCode::LIBRARY_TEXT | ExcludedCode::FILES_OF_IMAGE_FOR_CODE_OUTSIDE;
        })
    );
    assert_eq!(
        filled_record(|options| options.embeds_function_source = false),
        expected_record(|record| record.excluded_code |= ExcludedCode::FUNCTION_SOURCE)
    );
    assert_eq!(
        filled_record(|options| options.obfuscates = true),
        expected_record(|record| record.output = OutputOptions::OBFUSCATE)
    );
    assert_eq!(
        filled_record(|options| options.keeps_names = true),
        expected_record(|record| record.output = OutputOptions::KEEPS_FUNCTION_NAMES)
    );
    assert_eq!(
        filled_record(|options| options.runs_in_several_realms = true),
        expected_record(|record| record.output = OutputOptions::RUNS_IN_SEVERAL_REALMS)
    );
    assert_eq!(
        filled_record(|options| options.runs_in_place = true),
        expected_record(|record| record.output = OutputOptions::RUNS_IN_PLACE_OF_FILES)
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
fn trimming_says_who_can_make_foreign_calls() {
    let excluded = |change: fn(&mut AotOptions)| filled_record(change).excluded_code;
    let without = |flag| expected_record(|_| {}).excluded_code | flag;
    assert_eq!(
        excluded(|options| options.trim.removes_unused = true),
        without(ExcludedCode::FOREIGN_CALLS_OF_UNSEEN_CODE)
    );
    assert_eq!(
        excluded(|options| {
            options.trim.removes_unused = true;
            options.trim.allow = vec![TrimFeature::from_name(b"ffi").unwrap()];
        }),
        without(ExcludedCode::default())
    );
    assert_eq!(
        excluded(|options| {
            options.trim.removes_unused = true;
            options.trim.remove = vec![TrimFeature::from_name(b"native-code").unwrap()];
        }),
        without(ExcludedCode::FOREIGN_CALLS)
    );
    assert_eq!(
        excluded(|options| options.trim.remove_internal = vec![Feature::Ffi]),
        without(ExcludedCode::FOREIGN_CALLS)
    );
}

#[test]
fn each_option_fills_one_member() {
    let filled = filled_record(|options| {
        options.heap = HeapSize::Huge;
        options.emits_symbols = true;
        options.explain = ExplainSet::ALLOCATIONS;
        options.admits_inspector = true;
        options.code_generation_from_strings = CodeGenerationFromStrings::DisallowedLikeNode;
        options.embeds_function_source = false;
        options.obfuscates = true;
    });
    let expected = expected_record(|record| {
        record.target.reference_width = ReferenceWidth::Wide;
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
        ..zeroed()
    };
    let mut record = defaults;
    fill(&mut record, &AotOptions::default(), THREAD_COUNT);
    let expected = expected_record(|record| {
        record.size = defaults.size;
        record.size_class_progression = defaults.size_class_progression;
        record.checks = defaults.checks;
    });
    assert_eq!(record, expected);
}

#[test]
fn image_form_of_the_target_replaces_the_default() {
    let options = AotOptions::default();
    let mut request = request_for(&options, THREAD_COUNT);
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
fn reports_follow_explain() {
    let sites_and_counts = ReportSet::FLOW | ReportSet::ACCESS_COUNTS;
    let cases = [
        (ExplainSet::TEXT, sites_and_counts),
        (ExplainSet::JSON, sites_and_counts),
        (ExplainSet::ONLY_UNKNOWN_CODE, sites_and_counts),
        (ExplainSet::ONLY_UNPROVEN_TYPE, sites_and_counts),
        (ExplainSet::CHECKS, ReportSet::FLOW),
        (ExplainSet::CHECKS_JSON, ReportSet::FLOW),
        (ExplainSet::FORMS, ReportSet::FLOW),
        (ExplainSet::ALLOCATIONS, ReportSet::ALLOCATIONS),
        (ExplainSet::RUNTIME_USE, ReportSet::USES),
        (ExplainSet::STATISTICS, ReportSet::ACCESS_COUNTS),
        (
            ExplainSet::TEXT | ExplainSet::ALLOCATIONS,
            sites_and_counts | ReportSet::ALLOCATIONS,
        ),
    ];
    for (explain, expected) in cases {
        let options = AotOptions {
            explain,
            ..AotOptions::default()
        };
        assert_eq!(reports_of(&options), expected, "{explain:?}");
    }
}

#[test]
fn front_end_options_do_not_reach_record() {
    let changed = filled_record(|options| {
        options.erases_types = true;
        options.ir_output_path = Some(Box::from(&b"program.ir"[..]));
        options.thread_count = NonZeroU32::new(3);
        options.option_words = boxed_words(&[b"check=Validate"]);
    });
    assert_eq!(changed, filled_record(|_| {}));
}

#[test]
fn check_word_sets_the_check() {
    let expected = expected_record(|record| record.size = size_of::<CompileOptions>() as u32);
    assert_eq!(engine_options_with_words(&[]).unwrap().record, expected);
    assert_eq!(
        engine_options_with_words(&[b"check=Validate"])
            .unwrap()
            .record,
        CompileOptions {
            checks: CheckSet::VALIDATE,
            ..expected
        }
    );
}

#[test]
fn rejected_word_is_an_error() {
    let rejected = |words: &[&[u8]]| engine_options_with_words(words).err();
    assert_eq!(rejected(&[b"check=Validate"]), None);
    assert_eq!(
        rejected(&[b"check=Valid"]),
        Some(refusal_of(b"check=Valid"))
    );
    assert_eq!(
        rejected(&[b"check=Validate", b"check=Valid"]),
        Some(refusal_of(b"check=Valid"))
    );
    assert_eq!(
        rejected(&[b"check=Valid", b"check=Validate"]),
        Some(refusal_of(b"check=Valid"))
    );
}

#[test]
fn word_is_checked_after_earlier_words() {
    assert_eq!(check_option_word(&[], b"check=Validate"), Ok(()));
    assert_eq!(
        check_option_word(&boxed_words(&[b"check=Validate"]), b"check=Valid"),
        Err(refusal_of(b"check=Valid"))
    );
    assert_eq!(
        check_option_word(&boxed_words(&[b"check=Valid"]), b"check=Validate"),
        Err(refusal_of(b"check=Valid"))
    );
}

#[test]
fn limit_values_follow_target_architecture() {
    for architecture in Architecture::ALL {
        let mut record: CompileOptions = zeroed();
        record.target.architecture = architecture;
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
fn image_is_written_where_it_lies() {
    with_result_to_write(&mut Sections::new(), |result| {
        assert_eq!(result.image_mut_and_symbols(), (None, &b""[..]));
    });
    let mut sections = Sections::new()
        .with(Section::Image, b"image")
        .with(Section::Symbols, b"symbols");
    with_result_to_write(&mut sections, |result| {
        let (image, symbols) = result.image_mut_and_symbols();
        image.unwrap()[0] = b'I';
        assert_eq!(symbols, b"symbols");
        assert_eq!(result.image(), Some(&b"Image"[..]));
    });
}

#[test]
fn sections_are_read_as_typed_elements() {
    let statistics = StatisticId::ALL.map(|id| id as u64 * 3 + 1);
    let entry_module_ids = [7u32.to_ne_bytes(), u32::MAX.to_ne_bytes()].concat();
    let module = offset_of!(AccessCountRecord, module);
    let access_counts = [4, 9].map(|word| patched_record::<AccessCountRecord>(&[(module, word)]));
    let sections = Sections::new()
        .with(Section::Statistics, bun_core::slice_as_bytes(&statistics))
        .with(Section::EntryModuleIds, &entry_module_ids)
        .with(Section::AccessCounts, &access_counts.concat());
    with_result(&sections, |result| {
        assert_eq!(result.statistics(), statistics);
        assert_eq!(result.entry_module_ids(), [7, u32::MAX].map(EngineModuleId));
        let modules: Vec<u32> = result.access_counts().iter().map(|it| it.module).collect();
        assert_eq!(modules, [4, 9]);
        assert!(result.accesses().is_empty());
    });
}

#[test]
fn engine_is_handed_the_function_text_of_the_module_that_it_names() {
    let types = bun_sema::erasure::PackedTypeRanges::default();
    let texts = SourceTexts::new(vec![
        Some(ModuleSource::new(b"/p/a.js", TEXT).with_function_text(Some(types))),
        None,
        Some(ModuleSource::new(b"/p/b.js", TEXT)),
    ]);
    let mut owner = ProgramOwner {
        program: None,
        frees_on_pool_thread: false,
        texts: &texts,
    };
    let owner = (&raw mut owner).cast::<c_void>();
    // SAFETY: `owner` is a `ProgramOwner` that outlives the calls, and nothing changes its `texts`.
    let sizes = [0, 1, 2, 3].map(|module| unsafe { size_of_function_text(owner, module) });
    assert_eq!(sizes, [TEXT.len(), 0, 0, 0]);
    let mut destination = [0u8; TEXT.len()];
    for module in [1, 2, 3] {
        // SAFETY: as above, and the function text of the module has no byte.
        unsafe { copy_function_text(owner, module, destination.as_mut_ptr()) };
        assert_eq!(destination, [0; TEXT.len()]);
    }
    // SAFETY: as above, and `destination` has room for the size that was answered.
    unsafe { copy_function_text(owner, 0, destination.as_mut_ptr()) };
    assert_eq!(destination, TEXT);
}

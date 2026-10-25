mod records;
mod registry;
#[cfg(test)]
mod shared;
mod used_features;

#[cfg(test)]
pub(crate) mod testing;
#[cfg(test)]
mod tests;
#[cfg(test)]
#[path = "standalone/engine_stubs.rs"]
mod unlinked_engine;

use core::ffi::c_void;
use core::num::NonZeroUsize;
use core::ptr::NonNull;

#[cfg(not(test))]
use bun_aot_interface::engine::shared;
use bun_core::ffi::{Zeroable, zeroed};
use bun_options_types::aot_options::{AotOptions, ExplainSet, HeapSize, ReportDetail};
use bun_removable_features::FeatureSet;

pub use self::records::{Position, Witness, builtin_of, feature_of, position_of, witness_of};
pub use self::registry::{is_optional_pass, operation_names};
pub use self::shared::{
    EngineModuleId, ExecutableIdentity, RejectedOptionWord, TargetImageForm,
    describe_difference_of_runtime, has_compiler, image_alignment, relocate_image,
};
pub use self::used_features::used_features;
use crate::emit::{ExternalBodies, ExternalFunctionBodies, ProgramBytes};
pub use crate::ir::generated::{
    AccessCountRecord, AccessRecord, AllocationRemarkRecord, BuiltinUseRecord, DeclineRecord,
    FeatureUseRecord, FunctionReportRecord, InternalErrorRecord, LocaleUseRecord,
    ObfuscatedSiteRecord, OperationCountRecord, PassTimeRecord, RemainingCheckRecord,
    SourceLocation, TextRange, TypeTestRecord, UnseenCodeRecord, UserDiagnosticRecord,
    WorkerEntryRecord,
};
use crate::ir::generated::{
    AdmittedCode, CompileAction, CompileOptions, ExcludedCode, ImageForm, LimitId, MismatchPolicy,
    OutputOptions, ReferenceWidth, ReportSet, ResultSection,
};
use crate::statistics::LimitValues;

#[derive(Copy, Clone)]
pub struct EngineRequest<'a> {
    pub options: &'a AotOptions,
    pub identity: ExecutableIdentity,
    pub image_form: Option<TargetImageForm>,
    pub thread_count: NonZeroUsize,
    pub reports_functions: bool,
}

pub struct EngineOptions {
    record: CompileOptions,
    /// Nobody chose a thread count, so the engine gets no more threads than the program has work for.
    fits_threads_to_program: bool,
}

/// A thread that joins a build touches megabytes of its own first.
const PROGRAM_BYTES_PER_THREAD: usize = 512 << 10;

// SAFETY: an abi record of integers, a float, byte arrays, flag words, records of integers and `repr(u32)` enums that each have a member 0.
unsafe impl Zeroable for CompileOptions {}

fn default_record() -> CompileOptions {
    let mut record: CompileOptions = zeroed();
    // SAFETY: the engine writes one `CompileOptions` through the pointer before it returns.
    unsafe { Bun__AOT__initializeOptions(&raw mut record) };
    record
}

fn apply_option_word(record: &mut CompileOptions, word: &[u8]) -> Result<(), RejectedOptionWord> {
    let mut sentence = Vec::new();
    // A rejected word leaves the record unchanged, so the call is repeated with room for the sentence.
    loop {
        // SAFETY: the engine reads `word`, reads and writes `record`, and writes at most `sentence.len()` bytes before it returns.
        let length = unsafe {
            Bun__AOT__applyOptionWord(
                &raw mut *record,
                BunAOTBytes::from_slice(word),
                sentence.as_mut_ptr(),
                sentence.len(),
            )
        };
        if length == 0 {
            return Ok(());
        }
        if length == sentence.len() {
            let word = word.to_vec();
            return Err(RejectedOptionWord { word, sentence });
        }
        sentence.resize(length, 0);
    }
}

fn reports_of(options: &AotOptions) -> ReportSet {
    let site_reports = ExplainSet::TEXT
        | ExplainSet::JSON
        | ExplainSet::CHECKS
        | ExplainSet::CHECKS_JSON
        | ExplainSet::RUNTIME_USE
        | ExplainSet::ONLY_UNKNOWN_CODE
        | ExplainSet::ONLY_UNPROVEN_TYPE
        | ExplainSet::ONLY_MUTATION
        | ExplainSet::ONLY_LIMIT;
    let detail = options.build_report.as_ref().map(|report| report.detail);
    let mut reports = ReportSet::default();
    if options.explain.intersects(site_reports) || detail == Some(ReportDetail::Sites) {
        reports |= ReportSet::FLOW;
    }
    if options.explain.contains(ExplainSet::DECLINES) || detail.is_some() {
        reports |= ReportSet::DECLINES;
    }
    if options.explain.contains(ExplainSet::ALLOCATIONS) {
        reports |= ReportSet::ALLOCATIONS;
    }
    if detail >= Some(ReportDetail::Functions) {
        reports |= ReportSet::FUNCTIONS;
    }
    if options.emits_symbols {
        reports |= ReportSet::SYMBOLS;
    }
    reports
}

fn fill_record(record: &mut CompileOptions, request: &EngineRequest<'_>) {
    let options = request.options;
    record.executable_identity = request.identity.0;
    match request.image_form {
        Some(TargetImageForm::Absolute) => record.target.image_form = ImageForm::Absolute,
        Some(TargetImageForm::PositionIndependent) => {
            record.target.image_form = ImageForm::PositionIndependent;
        }
        None => {}
    }
    record.target.reference_width = match options.heap {
        HeapSize::Standard => ReferenceWidth::Narrow,
        HeapSize::Huge => ReferenceWidth::Wide,
    };
    record.mismatch_policy = if options.reports_type_mismatches {
        MismatchPolicy::Report
    } else {
        MismatchPolicy::Silent
    };
    record.reports = reports_of(options);
    if request.reports_functions {
        record.reports |= ReportSet::FUNCTIONS;
    }
    record.thread_count = u32::try_from(request.thread_count.get()).unwrap_or(u32::MAX);
    if options.admits_inspector {
        record.admitted_code |= AdmittedCode::INSPECTOR;
    }
    if options.forbids_text_evaluation {
        record.excluded_code |= ExcludedCode::EVALUATED_TEXT;
    }
    if !options.embeds_function_source {
        record.excluded_code |= ExcludedCode::FUNCTION_SOURCE;
    }
    if !options.loads_code_from_disk {
        record.excluded_code |= ExcludedCode::CODE_OUTSIDE_IMAGE;
    }
    if options.obfuscates {
        record.output |= OutputOptions::OBFUSCATE;
    }
    let mut removed = FeatureSet::from_features(&options.trim.remove_internal);
    for name in &options.trim.remove {
        removed.union_with(&name.features());
    }
    fill_feature_bits(&mut record.removed_features, &removed);
    fill_feature_bits(
        &mut record.target.features_kept_only_when_named,
        &bun_trim::features_kept_only_when_named(),
    );
}

fn fill_feature_bits(bits: &mut [u64; 8], features: &FeatureSet) {
    for feature in features.iter() {
        let index = usize::from(feature.index());
        bits[index / 64] |= 1 << (index % 64);
    }
}

impl EngineOptions {
    pub fn new(request: &EngineRequest<'_>) -> Result<EngineOptions, RejectedOptionWord> {
        let mut record = default_record();
        fill_record(&mut record, request);
        for word in &request.options.option_words {
            apply_option_word(&mut record, word)?;
        }
        Ok(EngineOptions {
            record,
            fits_threads_to_program: request.options.thread_count.is_none(),
        })
    }

    pub fn check_only(&mut self) {
        self.record.action = CompileAction::CheckOnly;
    }

    pub fn makes_image(&self) -> bool {
        self.record.action == CompileAction::Compile
    }

    fn record_for(&self, program_bytes: usize) -> CompileOptions {
        let mut record = self.record;
        if self.fits_threads_to_program {
            let useful = program_bytes / PROGRAM_BYTES_PER_THREAD + 1;
            record.thread_count =
                (record.thread_count).min(u32::try_from(useful).unwrap_or(u32::MAX));
        }
        record
    }

    pub fn limit_values(&self) -> LimitValues {
        let mut limits = LimitValues::for_target(self.record.target.architecture);
        if self.record.lowered_limit != LimitId::None {
            limits.lower(self.record.lowered_limit, self.record.lowered_limit_value);
        }
        limits
    }
}

/// Whether the engine takes `word` after `earlier_words`: a second `limit=` is refused because of the first.
pub fn check_option_word(
    earlier_words: &[Box<[u8]>],
    word: &[u8],
) -> Result<(), RejectedOptionWord> {
    let mut record = default_record();
    for earlier in earlier_words {
        apply_option_word(&mut record, earlier)?;
    }
    apply_option_word(&mut record, word)
}

/// The engine frees the program as soon as it has read it, long before it returns.
pub fn compile(program: ProgramBytes, options: &EngineOptions) -> EngineResult {
    let record = options.record_for(program.size_with_external_bodies());
    let bytes = BunAOTBytes::from_slice(program.as_slice());
    let external_bodies = program
        .external_bodies()
        .map(ExternalBodies::as_engine_argument);
    let mut owner = ProgramOwner {
        program: Some(program),
        frees_on_pool_thread: record.thread_count > 1,
    };
    // SAFETY: the engine reads the program until it calls `release_program` or returns, calls that at most once,
    // reads the record only until it returns, and its result has no other owner.
    unsafe {
        let result = Bun__AOT__compile(
            bytes,
            external_bodies
                .as_ref()
                .map_or(core::ptr::null(), core::ptr::from_ref),
            release_program,
            (&raw mut owner).cast::<c_void>(),
            &raw const record,
            &raw const REGION_THREADS,
        );
        EngineResult::new(NonNull::new(result).expect("Bun__AOT__compile returned null"))
    }
}

struct ProgramOwner {
    program: Option<ProgramBytes>,
    frees_on_pool_thread: bool,
}

/// SAFETY: `owner` is the `ProgramOwner` of a running `compile`, which nothing else touches until the engine returns.
unsafe extern "C" fn release_program(owner: *mut c_void) {
    // SAFETY: the caller's promise.
    let owner = unsafe { &mut *owner.cast::<ProgramOwner>() };
    let Some(program) = owner.program.take() else {
        return;
    };
    if !owner.frees_on_pool_thread {
        return;
    }
    // The engine waits for this call, and a large program is hundreds of thousands of allocations.
    let program = Box::into_raw(Box::new(program)).cast::<c_void>();
    // SAFETY: `free_program` gets the box once.
    unsafe { bun_sema_driver::run_on_region_thread(free_program, program) };
}

/// SAFETY: `program` is a `Box<ProgramBytes>` that has no other owner.
unsafe extern "C" fn free_program(program: *mut c_void) {
    // SAFETY: the caller's promise.
    drop(unsafe { Box::from_raw(program.cast::<ProgramBytes>()) });
}

pub struct EngineResult {
    result: NonNull<BunAOTResult>,
    sections: [BunAOTBytes; ResultSection::COUNT],
}

impl EngineResult {
    /// SAFETY: `result` comes from `Bun__AOT__compile` and has no other owner.
    unsafe fn new(result: NonNull<BunAOTResult>) -> EngineResult {
        let sections = ResultSection::ALL.map(|section| {
            // SAFETY: the result is not freed yet.
            unsafe { Bun__AOT__resultSection(result.as_ptr(), section.to_wire()) }
        });
        EngineResult { result, sections }
    }

    pub fn image(&self) -> Option<&[u8]> {
        let image = self.elements::<u8>(ResultSection::Image);
        (!image.is_empty()).then_some(image)
    }

    pub fn text(&self, range: TextRange) -> &[u8] {
        let start = range.offset as usize;
        self.elements::<u8>(ResultSection::Text)
            .get(start..start + range.length as usize)
            .unwrap_or(&[])
    }

    pub fn entry_module_ids(&self) -> &[EngineModuleId] {
        self.elements(ResultSection::EntryModuleIds)
    }

    pub fn statistics(&self) -> &[u64] {
        self.elements(ResultSection::Statistics)
    }

    pub fn limit_value(&self, limit: LimitId) -> u64 {
        self.elements::<u64>(ResultSection::LimitValues)[limit as usize]
    }

    pub fn symbols(&self) -> &[u8] {
        self.elements(ResultSection::Symbols)
    }

    fn elements<T>(&self, section: ResultSection) -> &[T] {
        // SAFETY: the section is readable until `drop`, and the engine, built from the same schema, wrote the `T` of each caller.
        unsafe { self.sections[section as usize].as_slice() }
    }
}

impl Drop for EngineResult {
    fn drop(&mut self) {
        // SAFETY: `self` is the only owner, and no borrow of a section outlives it.
        unsafe { Bun__AOT__freeResult(self.result.as_ptr()) };
    }
}

// SAFETY: the C++ object is immutable after `Bun__AOT__compile` returns, and `Bun__AOT__freeResult` may run on any thread.
unsafe impl Send for EngineResult {}
// SAFETY: immutable after `Bun__AOT__compile` returns, so every accessor only reads.
unsafe impl Sync for EngineResult {}

#[repr(C)]
#[derive(Copy, Clone)]
struct BunAOTBytes {
    ptr: *const u8,
    len: usize,
}

impl BunAOTBytes {
    fn from_slice(bytes: &[u8]) -> BunAOTBytes {
        BunAOTBytes {
            ptr: bytes.as_ptr(),
            len: bytes.len(),
        }
    }

    /// SAFETY: While `self` is borrowed, `ptr` is readable for `len` bytes, aligned for `T`, and holds valid values of `T`.
    unsafe fn as_slice<T>(&self) -> &[T] {
        if self.len == 0 {
            return &[];
        }
        // SAFETY: the caller's promise.
        unsafe { core::slice::from_raw_parts(self.ptr.cast::<T>(), self.len / size_of::<T>()) }
    }
}

#[repr(C)]
struct BunAOTResult {
    _opaque: [u8; 0],
}

/// `JSC::AOT::HostThreadPool`.
#[repr(C)]
struct HostThreadPool {
    schedule: unsafe extern "C" fn(run: unsafe extern "C" fn(*mut c_void), argument: *mut c_void),
}

/// The engine's loops run on the threads that the front end's did.
static REGION_THREADS: HostThreadPool = HostThreadPool {
    schedule: bun_sema_driver::run_on_region_thread,
};

unsafe extern "C" {
    fn Bun__AOT__initializeOptions(options: *mut CompileOptions);
    fn Bun__AOT__applyOptionWord(
        options: *mut CompileOptions,
        word: BunAOTBytes,
        message: *mut u8,
        capacity: usize,
    ) -> usize;
    fn Bun__AOT__compile(
        program: BunAOTBytes,
        external_bodies: *const ExternalFunctionBodies,
        release_program: unsafe extern "C" fn(owner: *mut c_void),
        program_owner: *mut c_void,
        options: *const CompileOptions,
        thread_pool: *const HostThreadPool,
    ) -> *mut BunAOTResult;
    fn Bun__AOT__resultSection(result: *const BunAOTResult, section: u32) -> BunAOTBytes;
    fn Bun__AOT__freeResult(result: *mut BunAOTResult);
    safe fn Bun__AOT__operationCount() -> usize;
    safe fn Bun__AOT__operationName(index: usize) -> BunAOTBytes;
    safe fn Bun__AOT__isOptionalPass(pass: u32) -> bool;
}

trait ResultRecord: Copy {
    const SECTION: ResultSection;
}

macro_rules! result_records {
    ($($name:ident: $record:ident = $section:ident,)*) => {
        $(impl ResultRecord for $record {
            const SECTION: ResultSection = ResultSection::$section;
        })*

        impl EngineResult {
            $(pub fn $name(&self) -> &[$record] {
                self.elements($record::SECTION)
            })*
        }
    };
}

result_records! {
    user_diagnostics: UserDiagnosticRecord = UserDiagnostics,
    internal_errors: InternalErrorRecord = InternalErrors,
    unseen_code: UnseenCodeRecord = UnseenCode,
    builtins_used: BuiltinUseRecord = BuiltinsUsed,
    features_used: FeatureUseRecord = FeaturesUsed,
    locales_used: LocaleUseRecord = LocalesUsed,
    worker_entries: WorkerEntryRecord = WorkerEntries,
    access_counts: AccessCountRecord = AccessCounts,
    accesses: AccessRecord = Accesses,
    remaining_checks: RemainingCheckRecord = RemainingChecks,
    type_tests: TypeTestRecord = TypeTests,
    declines: DeclineRecord = Declines,
    allocation_remarks: AllocationRemarkRecord = AllocationRemarks,
    functions: FunctionReportRecord = Functions,
    operation_counts: OperationCountRecord = OperationCounts,
    pass_times: PassTimeRecord = PassTimes,
    obfuscated_sites: ObfuscatedSiteRecord = ObfuscatedSites,
}

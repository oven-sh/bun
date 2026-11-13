mod records;
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
use bun_core::CodeGenerationFromStrings;
use bun_core::ffi::zeroed;
use bun_options_types::aot_options::{AotOptions, HeapSize};
use bun_removable_features::{Feature, FeatureSet};

pub use self::records::{Position, builtin_of, feature_of, position_of};
pub use self::shared::{
    EngineModuleId, ExecutableIdentity, RegExpLiteralCreation, RejectedOptionWord, StoredStrings,
    TargetImageForm, classify_regexp_literal, describe_difference_of_runtime,
    describe_regexp_construction_error, describe_regexp_syntax_error, has_compiler,
    image_alignment, read_stored_strings, relocate_image,
};
#[cfg(test)]
use self::tests::{
    fake_apply_option_word as Bun__AOT__applyOptionWord,
    fake_initialize_options as Bun__AOT__initializeOptions,
};
pub use self::used_features::used_features;
use crate::emit::{ExternalBodies, ExternalFunctionBodies, ProgramBytes};
pub use crate::ir::generated::{
    AccessCountRecord, AccessRecord, AllocationRemarkRecord, BuiltinUseRecord, FeatureUseRecord,
    FormBytesRecord, FunctionNameRecord, InternalErrorRecord, LayoutNameRecord, LocaleUseRecord,
    MissingFunctionRecord, MissingModuleRecord, ModuleBytesRecord, ObfuscatedSiteRecord,
    SourceLocation, TextRange, TypeTestRecord, UnseenCodeRecord, UserDiagnosticRecord, Witness,
    WorkerEntryRecord, WorkerStartRecord, WorkerURLStartRecord,
};
use crate::ir::generated::{
    AdmittedCode, CompileAction, CompileOptions, ExcludedCode, ImageForm, OutputOptions,
    ReferenceWidth, ReportSet, ResultSection,
};
use crate::ir::ids::{Id, ModuleId};
use crate::report::{ModuleSource, SourceTexts, engine_reports_for};
use crate::statistics::LimitValues;

#[derive(Copy, Clone)]
pub struct EngineRequest<'a> {
    pub options: &'a AotOptions,
    pub identity: ExecutableIdentity,
    pub image_form: Option<TargetImageForm>,
    pub thread_count: NonZeroUsize,
}

pub struct EngineOptions {
    record: CompileOptions,
}

bun_core::impl_zeroable!(CompileOptions);

fn default_record() -> CompileOptions {
    let mut record: CompileOptions = zeroed();
    Bun__AOT__initializeOptions(&mut record);
    record
}

fn apply_option_word(record: &mut CompileOptions, word: &[u8]) -> Result<(), RejectedOptionWord> {
    let mut sentence = Vec::new();
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
    let mut reports = ReportSet::default();
    if options.emits_symbols {
        reports |= ReportSet::SYMBOLS;
    }
    reports |= engine_reports_for(options.explain);
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
    record.reports = reports_of(options);
    record.thread_count = u32::try_from(request.thread_count.get()).unwrap_or(u32::MAX);
    if options.admits_inspector {
        record.admitted_code |= AdmittedCode::INSPECTOR;
    }
    if options.runs_tests {
        record.admitted_code |= AdmittedCode::REPLACED_BUILTINS;
    }
    if !options.omits_builtin_modules {
        record.excluded_code |= ExcludedCode::LIBRARY_TEXT;
    }
    match options.code_generation_from_strings {
        CodeGenerationFromStrings::Allowed => {}
        CodeGenerationFromStrings::DisallowedLikeNode => {
            record.excluded_code |= ExcludedCode::EVALUATED_TEXT;
        }
        CodeGenerationFromStrings::Strict => {
            record.excluded_code |=
                ExcludedCode::EVALUATED_TEXT | ExcludedCode::HOST_EVALUATED_TEXT;
        }
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
    if options.keeps_names {
        record.output |= OutputOptions::KEEPS_FUNCTION_NAMES;
    }
    if options.runs_in_several_realms {
        record.output |= OutputOptions::RUNS_IN_SEVERAL_REALMS;
    }
    let mut removed = FeatureSet::from_features(&options.trim.remove_internal);
    for name in &options.trim.remove {
        removed.union_with(&name.features());
    }
    let is_allowed =
        |feature| (options.trim.allow.iter()).any(|name| name.features().contains(feature));
    if options.omits_foreign_calls || removed.contains(Feature::Ffi) {
        record.excluded_code |= ExcludedCode::FOREIGN_CALLS;
    } else if options.trim.removes_unused && !is_allowed(Feature::Ffi) {
        record.excluded_code |= ExcludedCode::FOREIGN_CALLS_OF_UNSEEN_CODE;
    }
    if options.trim.removes_unused {
        record.excluded_code |= ExcludedCode::FEATURES_NAMED_AT_RUN_TIME;
    }
    fill_feature_bits(&mut record.removed_features, &removed);
    fill_feature_bits(
        &mut record.target.features_retained_by_name,
        &if options.trim.removes_unused {
            FeatureSet::all()
        } else {
            bun_trim::features_retained_by_name()
        },
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
        Ok(EngineOptions { record })
    }

    pub fn limit_threads(&mut self, count: NonZeroUsize) {
        let count = u32::try_from(count.get()).unwrap_or(u32::MAX);
        self.record.thread_count = self.record.thread_count.min(count);
    }

    pub fn check_only(&mut self) {
        self.record.action = CompileAction::CheckOnly;
    }

    pub fn refuse_code_outside_image(&mut self) {
        self.record.excluded_code |= ExcludedCode::CODE_OUTSIDE_IMAGE;
    }

    pub fn record_bytes(&self) -> Vec<u8> {
        let mut record = self.record;
        record.thread_count = 0;
        let start = (&raw const record).cast::<u8>();
        // SAFETY: the record is `repr(C)`, holds no reference, and was zeroed before it was filled.
        unsafe { core::slice::from_raw_parts(start, size_of::<CompileOptions>()) }.to_vec()
    }

    pub fn makes_image(&self) -> bool {
        self.record.action == CompileAction::Compile
    }

    pub fn limit_values(&self) -> LimitValues {
        LimitValues::for_target(self.record.target.architecture)
    }
}

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

pub fn compile(
    program: ProgramBytes,
    options: &EngineOptions,
    texts: &SourceTexts,
) -> EngineResult {
    let record = options.record;
    let bytes = BunAOTBytes::from_slice(program.as_slice());
    let list_of_bodies = program
        .external_bodies()
        .map(ExternalBodies::as_engine_argument);
    let external_bodies = list_of_bodies
        .as_ref()
        .map_or(core::ptr::null(), core::ptr::from_ref);
    let mut owner = ProgramOwner {
        program: Some(program),
        frees_on_pool_thread: record.thread_count > 1,
        texts,
    };
    // SAFETY: the engine reads the bytes until it calls `release_bytes_of_program`, the program and its bodies until it calls `release_program` or returns, calls each at most once, reads
    // the list of bodies, which may be null, the owner and the record only until it returns, and its result has no other owner.
    // It still calls `schedule` of the pool after it has returned, and what it schedules runs then: `REGION_THREADS` and its pool live
    // as long as the process.
    unsafe {
        let result = Bun__AOT__compile(
            bytes,
            external_bodies,
            release_program,
            release_bytes_of_program,
            (&raw mut owner).cast::<c_void>(),
            &raw const record,
            &raw const REGION_THREADS,
            function_source_size,
            copy_function_source,
        );
        EngineResult::new(NonNull::new(result).expect("Bun__AOT__compile returned null"))
    }
}

struct ProgramOwner<'a> {
    program: Option<ProgramBytes>,
    frees_on_pool_thread: bool,
    texts: &'a SourceTexts,
}

/// SAFETY: `owner` is the `ProgramOwner` of a running `compile`, whose `texts` nothing changes.
unsafe extern "C" fn function_source_size(owner: *mut c_void, module: u32) -> usize {
    // SAFETY: the caller's promise.
    let texts = unsafe { (*owner.cast::<ProgramOwner<'_>>()).texts };
    texts
        .get(ModuleId::new(module as usize))
        .map_or(0, ModuleSource::function_source_len)
}

/// SAFETY: as `function_source_size`, and `destination` has room for the size that it returned.
unsafe extern "C" fn copy_function_source(owner: *mut c_void, module: u32, destination: *mut u8) {
    // SAFETY: the caller's promise.
    let texts = unsafe { (*owner.cast::<ProgramOwner<'_>>()).texts };
    let Some(source) = texts.get(ModuleId::new(module as usize)) else {
        return;
    };
    // SAFETY: the caller's promise.
    let destination =
        unsafe { core::slice::from_raw_parts_mut(destination, source.function_source_len()) };
    source.copy_function_source_to(destination);
}

/// SAFETY: `owner` is the `ProgramOwner` of a running `compile`, which nothing else touches until this returns.
unsafe extern "C" fn release_program(owner: *mut c_void) {
    // SAFETY: the caller's promise.
    let owner = unsafe { &mut *owner.cast::<ProgramOwner<'_>>() };
    let Some(program) = owner.program.take() else {
        return;
    };
    if !owner.frees_on_pool_thread {
        drop(program);
        return;
    }
    let program = Box::into_raw(Box::new(program)).cast::<c_void>();
    // SAFETY: `free_program` gets the box once.
    unsafe { bun_sema_driver::run_on_region_thread(free_program, program) };
}

/// SAFETY: as `release_program`, and the engine reads no byte of the program any more. The code of the functions stays.
unsafe extern "C" fn release_bytes_of_program(owner: *mut c_void) {
    // SAFETY: the caller's promise.
    let owner = unsafe { &mut *owner.cast::<ProgramOwner<'_>>() };
    if let Some(program) = &mut owner.program {
        program.free_bytes();
    }
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

    pub fn image_mut_and_symbols(&mut self) -> (Option<&mut [u8]>, &[u8]) {
        let BunAOTBytes { ptr, len } = self.sections[ResultSection::Image as usize];
        // SAFETY: the bytes are memory of the engine's result that may be written, no other section holds any of them, `self` is the
        // only owner of the result, and its exclusive borrow lasts as long as the slice.
        let image =
            (len > 0).then(|| unsafe { core::slice::from_raw_parts_mut(ptr.cast_mut(), len) });
        (image, self.symbols())
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

// SAFETY: nothing but its owner touches the C++ object after `Bun__AOT__compile` returns, and `Bun__AOT__freeResult` may run on any thread.
unsafe impl Send for EngineResult {}
// SAFETY: every accessor that shares `self` only reads.
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

#[repr(C)]
struct HostThreadPool {
    schedule: unsafe extern "C" fn(run: unsafe extern "C" fn(*mut c_void), argument: *mut c_void),
}

static REGION_THREADS: HostThreadPool = HostThreadPool {
    schedule: bun_sema_driver::run_on_region_thread,
};

unsafe extern "C" {
    #[cfg(not(test))]
    safe fn Bun__AOT__initializeOptions(options: &mut CompileOptions);
    #[cfg(not(test))]
    fn Bun__AOT__applyOptionWord(
        options: *mut CompileOptions,
        word: BunAOTBytes,
        message: *mut u8,
        capacity: usize,
    ) -> usize;
    fn Bun__AOT__compile(
        program: BunAOTBytes,
        external_bodies: *const ExternalFunctionBodies,
        release_program: unsafe extern "C" fn(*mut c_void),
        release_bytes_of_program: unsafe extern "C" fn(*mut c_void),
        program_owner: *mut c_void,
        options: *const CompileOptions,
        thread_pool: *const HostThreadPool,
        function_source_size: unsafe extern "C" fn(*mut c_void, u32) -> usize,
        copy_function_source: unsafe extern "C" fn(*mut c_void, u32, *mut u8),
    ) -> *mut BunAOTResult;
    fn Bun__AOT__resultSection(result: *const BunAOTResult, section: u32) -> BunAOTBytes;
    fn Bun__AOT__freeResult(result: *mut BunAOTResult);
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
    worker_starts_without_name: WorkerStartRecord = WorkerStartsWithoutName,
    worker_starts_from_urls: WorkerURLStartRecord = WorkerStartsFromURLs,
    missing_library_functions: MissingFunctionRecord = MissingLibraryFunctions,
    missing_library_modules: MissingModuleRecord = MissingLibraryModules,
    obfuscated_sites: ObfuscatedSiteRecord = ObfuscatedSites,
    bytes_by_module: ModuleBytesRecord = BytesByModule,
    accesses: AccessRecord = Accesses,
    access_counts: AccessCountRecord = AccessCounts,
    type_tests: TypeTestRecord = TypeTests,
    allocation_remarks: AllocationRemarkRecord = AllocationRemarks,
    bytes_by_form: FormBytesRecord = BytesByForm,
    function_names: FunctionNameRecord = FunctionNames,
    layout_names: LayoutNameRecord = LayoutNames,
}

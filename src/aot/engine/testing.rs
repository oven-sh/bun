use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use super::ResultSection as Section;
use super::{
    AccessCountRecord, AccessRecord, AllocationRemarkRecord, BuiltinUseRecord, BunAOTBytes,
    EngineResult, FeatureUseRecord, FormBytesRecord, FunctionNameRecord, InternalErrorRecord,
    LackedFunctionRecord, LackedModuleRecord, LayoutNameRecord, LocaleUseRecord, ModuleBytesRecord,
    ObfuscatedSiteRecord, OtherOriginsRecord, ResultRecord, TypeTestRecord, UnseenCodeRecord,
    UserDiagnosticRecord, WorkerEntryRecord, WorkerStartRecord, WorkerURLRecord,
};
use crate::ir::generated::StatisticId;

pub(super) fn to_words(bytes: &[u8]) -> Vec<u64> {
    let to_word = |chunk: &[u8]| {
        let mut word = [0; 8];
        word[..chunk.len()].copy_from_slice(chunk);
        u64::from_ne_bytes(word)
    };
    bytes.chunks(8).map(to_word).collect()
}

fn bytes_of_records<T: ResultRecord>(records: &[T]) -> &[u8] {
    // SAFETY: an abi record has no padding (its generated assertions fix its size and every offset), so every byte is initialized, and the slice ends with `records`.
    unsafe { core::slice::from_raw_parts(records.as_ptr().cast::<u8>(), size_of_val(records)) }
}

pub(super) struct Sections {
    words: [Vec<u64>; Section::COUNT],
    lengths: [usize; Section::COUNT],
}

impl Sections {
    /// The engine always writes one word for each statistic, and `Statistics::add_values` asserts that.
    pub(super) fn new() -> Sections {
        let empty = Sections {
            words: Section::ALL.map(|_| Vec::new()),
            lengths: [0; Section::COUNT],
        };
        empty.with(
            Section::Statistics,
            bun_core::slice_as_bytes(&[0u64; StatisticId::COUNT]),
        )
    }

    pub(super) fn with(mut self, section: Section, bytes: &[u8]) -> Sections {
        self.words[section as usize] = to_words(bytes);
        self.lengths[section as usize] = bytes.len();
        self
    }

    fn with_records<T: ResultRecord>(self, records: &[T]) -> Sections {
        self.with(T::SECTION, bytes_of_records(records))
    }

    fn as_bytes(&self) -> [BunAOTBytes; Section::COUNT] {
        Section::ALL.map(|section| {
            let index = section as usize;
            BunAOTBytes::from_slice(
                &bun_core::slice_as_bytes(&self.words[index])[..self.lengths[index]],
            )
        })
    }
}

pub(super) fn with_result<R>(sections: &Sections, then: impl FnOnce(&EngineResult) -> R) -> R {
    // Never dropped: no engine allocated it.
    let result = ManuallyDrop::new(EngineResult {
        result: NonNull::dangling(),
        sections: sections.as_bytes(),
    });
    then(&result)
}

/// The image may be written.
pub(super) fn with_result_to_write<R>(
    sections: &mut Sections,
    then: impl FnOnce(&mut EngineResult) -> R,
) -> R {
    let mut bytes = sections.as_bytes();
    let image = Section::Image as usize;
    bytes[image].ptr = sections.words[image].as_mut_ptr().cast::<u8>();
    // Never dropped: no engine allocated it.
    let mut result = ManuallyDrop::new(EngineResult {
        result: NonNull::dangling(),
        sections: bytes,
    });
    then(&mut result)
}

/// Every `TextRange` of a record leads into `text`.
#[derive(Copy, Clone, Default)]
pub(crate) struct ResultRecords<'a> {
    pub image: &'a [u8],
    pub text: &'a [u8],
    pub user_diagnostics: &'a [UserDiagnosticRecord],
    pub internal_errors: &'a [InternalErrorRecord],
    pub unseen_code: &'a [UnseenCodeRecord],
    pub builtins_used: &'a [BuiltinUseRecord],
    pub features_used: &'a [FeatureUseRecord],
    pub locales_used: &'a [LocaleUseRecord],
    pub worker_entries: &'a [WorkerEntryRecord],
    pub worker_starts_without_name: &'a [WorkerStartRecord],
    pub urls_that_start_workers: &'a [WorkerURLRecord],
    pub library_functions_lacked: &'a [LackedFunctionRecord],
    pub library_modules_lacked: &'a [LackedModuleRecord],
    pub obfuscated_sites: &'a [ObfuscatedSiteRecord],
    pub bytes_by_module: &'a [ModuleBytesRecord],
    pub accesses: &'a [AccessRecord],
    pub other_origins: &'a [OtherOriginsRecord],
    pub access_counts: &'a [AccessCountRecord],
    pub type_tests: &'a [TypeTestRecord],
    pub allocation_remarks: &'a [AllocationRemarkRecord],
    pub bytes_by_form: &'a [FormBytesRecord],
    pub function_names: &'a [FunctionNameRecord],
    pub layout_names: &'a [LayoutNameRecord],
}

impl ResultRecords<'_> {
    pub(crate) fn with_result<R>(&self, then: impl FnOnce(&EngineResult) -> R) -> R {
        let sections = Sections::new()
            .with(Section::Image, self.image)
            .with(Section::Text, self.text)
            .with_records(self.user_diagnostics)
            .with_records(self.internal_errors)
            .with_records(self.unseen_code)
            .with_records(self.builtins_used)
            .with_records(self.features_used)
            .with_records(self.locales_used)
            .with_records(self.worker_entries)
            .with_records(self.worker_starts_without_name)
            .with_records(self.urls_that_start_workers)
            .with_records(self.library_functions_lacked)
            .with_records(self.library_modules_lacked)
            .with_records(self.obfuscated_sites)
            .with_records(self.bytes_by_module)
            .with_records(self.accesses)
            .with_records(self.other_origins)
            .with_records(self.access_counts)
            .with_records(self.type_tests)
            .with_records(self.allocation_remarks)
            .with_records(self.bytes_by_form)
            .with_records(self.function_names)
            .with_records(self.layout_names);
        with_result(&sections, then)
    }
}

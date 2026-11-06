use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use super::ResultSection as Section;
use super::{
    AccessCountRecord, AccessRecord, AllocationRemarkRecord, BuiltinUseRecord, BunAOTBytes,
    DeclineRecord, EngineResult, FeatureUseRecord, LimitId, LocaleUseRecord, ObfuscatedSiteRecord,
    RemainingCheckRecord, ResultRecord, UnseenCodeRecord,
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

pub(super) fn bytes_of(words: &[u64]) -> &[u8] {
    // SAFETY: every byte of an initialized `u64` is initialized, and the slice ends with `words`.
    unsafe { core::slice::from_raw_parts(words.as_ptr().cast::<u8>(), size_of_val(words)) }
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
    pub(super) fn new() -> Sections {
        let empty = Sections {
            words: Section::ALL.map(|_| Vec::new()),
            lengths: [0; Section::COUNT],
        };
        empty
            .with(Section::Statistics, &vec![0; 8 * StatisticId::COUNT])
            .with(Section::LimitValues, &vec![0; 8 * LimitId::COUNT])
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
            BunAOTBytes::from_slice(&bytes_of(&self.words[index])[..self.lengths[index]])
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

#[derive(Copy, Clone, Default)]
pub(crate) struct ResultRecords<'a> {
    pub image: &'a [u8],
    pub text: &'a [u8],
    pub limit_values: &'a [(LimitId, u64)],
    pub unseen_code: &'a [UnseenCodeRecord],
    pub builtins_used: &'a [BuiltinUseRecord],
    pub features_used: &'a [FeatureUseRecord],
    pub locales_used: &'a [LocaleUseRecord],
    pub access_counts: &'a [AccessCountRecord],
    pub accesses: &'a [AccessRecord],
    pub remaining_checks: &'a [RemainingCheckRecord],
    pub declines: &'a [DeclineRecord],
    pub allocation_remarks: &'a [AllocationRemarkRecord],
    pub obfuscated_sites: &'a [ObfuscatedSiteRecord],
}

impl ResultRecords<'_> {
    pub(crate) fn with_result<R>(&self, then: impl FnOnce(&EngineResult) -> R) -> R {
        let mut limit_values = [0; LimitId::COUNT];
        for &(limit, value) in self.limit_values {
            limit_values[limit as usize] = value;
        }
        let sections = Sections::new()
            .with(Section::Image, self.image)
            .with(Section::Text, self.text)
            .with(Section::LimitValues, bytes_of(&limit_values))
            .with_records(self.unseen_code)
            .with_records(self.builtins_used)
            .with_records(self.features_used)
            .with_records(self.locales_used)
            .with_records(self.access_counts)
            .with_records(self.accesses)
            .with_records(self.remaining_checks)
            .with_records(self.declines)
            .with_records(self.allocation_remarks)
            .with_records(self.obfuscated_sites);
        with_result(&sections, then)
    }
}

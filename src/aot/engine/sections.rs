use core::mem::offset_of;

use super::{
    AccessCountRecord, AccessRecord, AllocationRemarkRecord, ArrivalLayoutFieldRecord,
    ArrivalLayoutRecord, ArrivalSiteRecord, BuiltinUseRecord, BunAOTBytes, DeclineRecord, FeatureUseRecord, FunctionReportRecord, InternalErrorRecord, LocaleUseRecord,
    LossRecord, ObfuscatedSiteRecord, OperationCountRecord, PassTimeRecord, RemainingCheckRecord,
    ResultRecord, TextRange, TypeTestRecord, UnseenCodeRecord, UserDiagnosticRecord,
};
use crate::ir::generated::{LimitId, ResultSection, StatisticId};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum MalformedReason {
    Length,
    Alignment,
    Enumerator,
    TextRange,
    Order,
    Range,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct MalformedSection {
    pub section: ResultSection,
    pub reason: MalformedReason,
}

pub(super) struct SectionLengths {
    pub text: usize,
    pub operation_counts: usize,
    pub arrival_site_layouts: usize,
    pub arrival_layout_fields: usize,
}

pub(super) fn check_sections(
    sections: &[BunAOTBytes; ResultSection::COUNT],
) -> Result<(), MalformedSection> {
    let length_of = |section: ResultSection| sections[section as usize].len;
    let operation_bytes = length_of(OperationCountRecord::SECTION);
    let field_bytes = length_of(ArrivalLayoutFieldRecord::SECTION);
    let lengths = SectionLengths {
        text: length_of(ResultSection::Text),
        operation_counts: operation_bytes / size_of::<OperationCountRecord>(),
        arrival_site_layouts: length_of(ResultSection::ArrivalSiteLayouts) / size_of::<u32>(),
        arrival_layout_fields: field_bytes / size_of::<ArrivalLayoutFieldRecord>(),
    };
    for section in ResultSection::ALL {
        // SAFETY: the engine leaves every section readable until `Bun__AOT__freeResult`, and any byte is a `u8`.
        let bytes = unsafe { sections[section as usize].as_slice::<u8>() };
        check_section(section, bytes, &lengths)
            .map_err(|reason| MalformedSection { section, reason })?;
    }
    Ok(())
}

pub(super) fn check_section(
    section: ResultSection,
    bytes: &[u8],
    lengths: &SectionLengths,
) -> Result<(), MalformedReason> {
    match section {
        ResultSection::Image | ResultSection::Text | ResultSection::Symbols => Ok(()),
        ResultSection::EntryModuleIds | ResultSection::ArrivalSiteLayouts => {
            check_layout::<u32>(bytes)
        }
        ResultSection::Statistics => check_number_per_enumerator(bytes, StatisticId::COUNT),
        ResultSection::LimitValues => check_number_per_enumerator(bytes, LimitId::COUNT),
        UserDiagnosticRecord::SECTION => check_records::<UserDiagnosticRecord>(bytes, lengths.text),
        InternalErrorRecord::SECTION => check_records::<InternalErrorRecord>(bytes, lengths.text),
        UnseenCodeRecord::SECTION => check_records::<UnseenCodeRecord>(bytes, lengths.text),
        BuiltinUseRecord::SECTION => check_records::<BuiltinUseRecord>(bytes, lengths.text),
        FeatureUseRecord::SECTION => {
            check_records::<FeatureUseRecord>(bytes, lengths.text)?;
            check_order(bytes, |record: &FeatureUseRecord| record.feature, PartialOrd::le)
        }
        LocaleUseRecord::SECTION => check_records::<LocaleUseRecord>(bytes, lengths.text),
        AccessRecord::SECTION => check_records::<AccessRecord>(bytes, lengths.text),
        AccessCountRecord::SECTION => {
            check_records::<AccessCountRecord>(bytes, lengths.text)?;
            check_order(bytes, |record: &AccessCountRecord| record.module, PartialOrd::lt)
        }
        TypeTestRecord::SECTION => check_records::<TypeTestRecord>(bytes, lengths.text),
        RemainingCheckRecord::SECTION => {
            check_records::<RemainingCheckRecord>(bytes, lengths.text)?;
            check_order(bytes, |record: &RemainingCheckRecord| record.id, PartialOrd::lt)
        }
        DeclineRecord::SECTION => check_records::<DeclineRecord>(bytes, lengths.text),
        AllocationRemarkRecord::SECTION => {
            check_records::<AllocationRemarkRecord>(bytes, lengths.text)
        }
        LossRecord::SECTION => check_records::<LossRecord>(bytes, lengths.text),
        FunctionReportRecord::SECTION => {
            check_records::<FunctionReportRecord>(bytes, lengths.text)?;
            let range_of = |record: &FunctionReportRecord| {
                (record.first_operation, record.operation_count)
            };
            check_ranges(bytes, range_of, lengths.operation_counts)
        }
        OperationCountRecord::SECTION => check_records::<OperationCountRecord>(bytes, lengths.text),
        PassTimeRecord::SECTION => check_records::<PassTimeRecord>(bytes, lengths.text),
        ObfuscatedSiteRecord::SECTION => check_records::<ObfuscatedSiteRecord>(bytes, lengths.text),
        ArrivalSiteRecord::SECTION => {
            check_records::<ArrivalSiteRecord>(bytes, lengths.text)?;
            check_order(bytes, |record: &ArrivalSiteRecord| record.number, PartialOrd::lt)?;
            let range_of = |record: &ArrivalSiteRecord| {
                (record.first_expected_layout, record.expected_layout_count)
            };
            check_ranges(bytes, range_of, lengths.arrival_site_layouts)
        }
        ArrivalLayoutRecord::SECTION => {
            check_records::<ArrivalLayoutRecord>(bytes, lengths.text)?;
            check_order(bytes, |record: &ArrivalLayoutRecord| record.layout, PartialOrd::lt)?;
            let range_of = |record: &ArrivalLayoutRecord| (record.first_field, record.field_count);
            check_ranges(bytes, range_of, lengths.arrival_layout_fields)
        }
        ArrivalLayoutFieldRecord::SECTION => {
            check_records::<ArrivalLayoutFieldRecord>(bytes, lengths.text)
        }
    }
}

fn check_number_per_enumerator(
    bytes: &[u8],
    enumerator_count: usize,
) -> Result<(), MalformedReason> {
    check_layout::<u64>(bytes)?;
    let has_every_number = bytes.len() == size_of::<u64>() * enumerator_count;
    ensure(has_every_number, MalformedReason::Length)
}

fn check_records<T: ResultRecord>(bytes: &[u8], text_length: usize) -> Result<(), MalformedReason> {
    check_layout::<T>(bytes)?;
    read_records::<T>(bytes)?;
    for record in bytes.chunks_exact(size_of::<T>()) {
        for &member in T::TEXT_MEMBERS {
            let offset = read_u32(record, member + offset_of!(TextRange, offset));
            let length = read_u32(record, member + offset_of!(TextRange, length));
            let is_inside_text = u64::from(offset) + u64::from(length) <= text_length as u64;
            ensure(is_inside_text, MalformedReason::TextRange)?;
        }
    }
    Ok(())
}

fn check_order<T: ResultRecord, K>(
    bytes: &[u8],
    key_of: impl Fn(&T) -> K,
    is_in_order: fn(&K, &K) -> bool,
) -> Result<(), MalformedReason> {
    let keys = read_records::<T>(bytes)?.iter().map(key_of);
    ensure(keys.is_sorted_by(is_in_order), MalformedReason::Order)
}

fn check_ranges<T: ResultRecord>(
    bytes: &[u8],
    range_of: impl Fn(&T) -> (u32, u32),
    element_count: usize,
) -> Result<(), MalformedReason> {
    let is_inside_section = |record: &T| {
        let (first, count) = range_of(record);
        u64::from(first) + u64::from(count) <= element_count as u64
    };
    let records = read_records::<T>(bytes)?;
    ensure(records.iter().all(is_inside_section), MalformedReason::Range)
}

fn check_layout<T>(bytes: &[u8]) -> Result<(), MalformedReason> {
    let has_whole_elements = bytes.len().is_multiple_of(size_of::<T>());
    ensure(has_whole_elements, MalformedReason::Length)?;
    let is_aligned = bytes.is_empty() || bytes.as_ptr().cast::<T>().is_aligned();
    ensure(is_aligned, MalformedReason::Alignment)
}

fn ensure(is_well_formed: bool, reason: MalformedReason) -> Result<(), MalformedReason> {
    if is_well_formed { Ok(()) } else { Err(reason) }
}

fn read_records<T: ResultRecord>(bytes: &[u8]) -> Result<&[T], MalformedReason> {
    T::slice_from_bytes(bytes).ok_or(MalformedReason::Enumerator)
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_ne_bytes(*bytes[offset..].first_chunk().expect("offset out of bounds"))
}

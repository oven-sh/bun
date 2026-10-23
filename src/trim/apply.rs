use core::mem::offset_of;
use core::ops::Range;

use bun_exe_format::builtins::{Builtins, HEADER_SIZE as BUILTIN_MODULES_HEADER_SIZE};
use bun_exe_format::cut_model::{Fill, RemovableBytes};
use bun_exe_format::image::{
    AddressRange, Architecture, ImageBytes, ImageEditor, KnownSection, SectionLocation,
};
use bun_removable_features::{Feature, FeatureSet, RemovableFeatureState, RemovedRange};

use crate::error::{TrimError, TrimInternalError, UnsupportedReason};
use crate::icu_data::remove_items;
use crate::model::{PlannedRange, TrimPlan, TrimSummary};
use crate::table::{REMOVED_RANGES_HEADER_BYTES, encode_removed_ranges, read_u32};

const X86_64_TRAP: u8 = 0xcc;
const AARCH64_TRAP: [u8; 4] = 0xd420_0000u32.to_le_bytes();
const STATE_BYTES: u64 = size_of::<RemovableFeatureState>() as u64;

// The index that `bun_exe_format::builtins` reads.
const MODULE_COUNT_OFFSET: usize = 16;
const MODULE_RECORDS_OFFSET: usize = 20;
const MODULE_DATA_OFFSET: usize = 32;
const MODULE_RECORD_BYTES: usize = 24;
const TEXT_OFFSET_IN_RECORD: usize = 16;
const TEXT_LENGTH_IN_RECORD: usize = 20;
const TEXT_FIELDS_OF_RECORD: Range<usize> = TEXT_OFFSET_IN_RECORD..MODULE_RECORD_BYTES;

#[derive(Copy, Clone)]
struct TrimSections {
    state: AddressRange,
    table: AddressRange,
}

pub fn apply(executable: &mut dyn ImageBytes, plan: &TrimPlan) -> Result<TrimSummary, TrimError> {
    if plan.is_empty() {
        return Ok(TrimSummary {
            removed: FeatureSet::EMPTY,
            cut_bytes: 0,
            filled_bytes: 0,
            file_bytes_saved: 0,
            uncut: None,
            format: None,
        });
    }
    let mut editor = ImageEditor::open(executable)?;
    let format = editor.format();
    let sections = find_trim_sections(&editor)?;
    let is_cut_template = check_state_untrimmed(&mut editor, sections.state)?;
    let icu_ranges = remove_icu_items(&mut editor, plan)?;
    let mut removable = merge_removable_bytes(&plan.ranges, icu_ranges);
    if is_cut_template {
        removable = keep_file_backed_parts(&editor, &removable);
    }
    check_removable_bytes(&mut editor, &removable, sections)?;
    clear_removed_module_texts(&mut editor, &removable)?;
    let cut_plan = editor.cut_model().choose(&removable);
    write_fills(&mut editor, &cut_plan.fills)?;
    let removed_ranges: Vec<AddressRange> = removable.iter().map(|item| item.range).collect();
    editor.remove_relocations_in(&removed_ranges)?;
    write_removal_state(&mut editor, sections.state, plan)?;
    if !plan.keeps_table {
        write_removed_ranges(&mut editor, plan, sections)?;
    }
    let file_bytes_saved = editor.remove_ranges(&cut_plan.cuts)?;
    Ok(TrimSummary {
        removed: plan.removed(),
        cut_bytes: cut_plan.cut_bytes(),
        filled_bytes: cut_plan.filled_bytes(),
        file_bytes_saved,
        uncut: cut_plan.uncut,
        format: Some(format),
    })
}

fn section_range(location: SectionLocation, size: u64) -> Result<AddressRange, TrimInternalError> {
    let end = location
        .address
        .checked_add(size)
        .ok_or(TrimInternalError::MalformedTable)?;
    Ok(AddressRange {
        start: location.address,
        end,
    })
}

fn find_trim_sections(editor: &ImageEditor<'_>) -> Result<TrimSections, TrimInternalError> {
    let (Some(state), Some(table)) = (
        editor.find_section(KnownSection::RemovableFeatureState),
        editor.find_section(KnownSection::TrimTable),
    ) else {
        return Err(TrimInternalError::MalformedTable);
    };
    if state.size < STATE_BYTES
        || !state.address.is_multiple_of(8)
        || !table.address.is_multiple_of(8)
    {
        return Err(TrimInternalError::MalformedTable);
    }
    Ok(TrimSections {
        state: section_range(state, state.size)?,
        table: section_range(table, table.size)?,
    })
}

fn state_bytes<'e>(
    editor: &'e mut ImageEditor<'_>,
    state_section: AddressRange,
) -> Result<&'e mut [u8], TrimInternalError> {
    let state = AddressRange {
        start: state_section.start,
        end: state_section.start + STATE_BYTES,
    };
    editor
        .bytes_at_mut(state)
        .ok_or(TrimInternalError::RangeOutsideImage)
}

/// True for a template: a cut that kept the table has taken features out.
fn check_state_untrimmed(
    editor: &mut ImageEditor<'_>,
    state_section: AddressRange,
) -> Result<bool, TrimError> {
    let state = state_bytes(editor, state_section)?;
    if !state.starts_with(&RemovableFeatureState::MAGIC) {
        return Err(TrimInternalError::MalformedTable.into());
    }
    let flags = offset_of!(RemovableFeatureState, is_trimmed)
        ..offset_of!(RemovableFeatureState, removed_ranges_offset);
    if state[flags].iter().any(|byte| *byte != 0) {
        return Err(UnsupportedReason::AlreadyTrimmed.into());
    }
    let removal = &state[offset_of!(RemovableFeatureState, removal)..];
    Ok(removal.iter().any(|byte| *byte != 0))
}

fn keep_file_backed_parts(
    editor: &ImageEditor<'_>,
    removable: &[RemovableBytes],
) -> Vec<RemovableBytes> {
    let parts_of = |item: &RemovableBytes| {
        let parts = editor.file_backed_parts(item.range);
        let item = *item;
        parts
            .into_iter()
            .map(move |range| RemovableBytes { range, ..item })
    };
    removable.iter().flat_map(parts_of).collect()
}

fn remove_icu_items(
    editor: &mut ImageEditor<'_>,
    plan: &TrimPlan,
) -> Result<Vec<RemovableBytes>, TrimInternalError> {
    let mut icu_ranges = Vec::new();
    for package in &plan.icu_packages {
        let bytes = editor
            .bytes_at_mut(package.range)
            .ok_or(TrimInternalError::RangeOutsideImage)?;
        let dead_ranges = remove_items(bytes, &package.removed_items, &package.tombstoned_items)?;
        icu_ranges.extend(dead_ranges.into_iter().map(|dead| RemovableBytes {
            range: AddressRange {
                start: package.range.start + u64::from(dead.start),
                end: package.range.start + u64::from(dead.end),
            },
            is_code: false,
            can_be_cut: true,
            can_be_filled: true,
        }));
    }
    Ok(icu_ranges)
}

fn merge_removable_bytes(
    planned_ranges: &[PlannedRange],
    icu_ranges: Vec<RemovableBytes>,
) -> Vec<RemovableBytes> {
    let mut removable = icu_ranges;
    removable.extend(planned_ranges.iter().map(|planned| RemovableBytes {
        range: planned.range,
        is_code: planned.is_code,
        can_be_cut: planned.can_be_cut,
        can_be_filled: planned.can_be_filled,
    }));
    removable.sort_by_key(|item| item.range.start);
    removable
}

fn find_protected_ranges(
    editor: &ImageEditor<'_>,
    sections: TrimSections,
) -> Result<Vec<AddressRange>, TrimInternalError> {
    let mut protected = vec![sections.state, sections.table];
    if let Some(payload) = editor.find_section(KnownSection::Payload) {
        protected.push(section_range(payload, payload.size)?);
    }
    if let Some(builtins) = editor.find_section(KnownSection::BuiltinModules) {
        let header_bytes = builtins.size.min(BUILTIN_MODULES_HEADER_SIZE as u64);
        protected.push(section_range(builtins, header_bytes)?);
    }
    Ok(protected)
}

fn ranges_intersect(first: AddressRange, second: AddressRange) -> bool {
    first.start < second.end && second.start < first.end
}

fn check_removable_bytes(
    editor: &mut ImageEditor<'_>,
    removable: &[RemovableBytes],
    sections: TrimSections,
) -> Result<(), TrimInternalError> {
    let protected = find_protected_ranges(editor, sections)?;
    let mut previous_end: Option<u64> = None;
    for item in removable {
        let range = item.range;
        if range.start >= range.end || previous_end.is_some_and(|end| range.start < end) {
            return Err(TrimInternalError::MalformedTable);
        }
        previous_end = Some(range.end);
        if editor.bytes_at_mut(range).is_none() {
            return Err(TrimInternalError::RangeOutsideImage);
        }
        if protected
            .iter()
            .any(|section| ranges_intersect(*section, range))
        {
            return Err(TrimInternalError::MalformedTable);
        }
    }
    Ok(())
}

fn find_removed_runs(removable: &[RemovableBytes], section: AddressRange) -> Vec<AddressRange> {
    let mut runs: Vec<AddressRange> = Vec::new();
    for item in removable {
        if !ranges_intersect(item.range, section) {
            continue;
        }
        match runs.last_mut() {
            Some(run) if run.end == item.range.start => run.end = item.range.end,
            Some(_) | None => runs.push(item.range),
        }
    }
    runs
}

// A reader of the index takes a module without text for one whose text was removed.
fn clear_removed_module_texts(
    editor: &mut ImageEditor<'_>,
    removable: &[RemovableBytes],
) -> Result<(), TrimInternalError> {
    let Some(location) = editor.find_section(KnownSection::BuiltinModules) else {
        return Ok(());
    };
    let section = section_range(location, location.size)?;
    let removed = find_removed_runs(removable, section);
    if removed.is_empty() {
        return Ok(());
    }
    // A cut that made a template may have taken texts out of the section. The index in front of them stays.
    let index = match editor.file_backed_parts(section).first() {
        Some(first) if first.start == section.start => *first,
        _ => return Err(TrimInternalError::RangeOutsideImage),
    };
    let bytes = editor
        .bytes_at_mut(index)
        .ok_or(TrimInternalError::RangeOutsideImage)?;
    if index == section && Builtins::parse(bytes).is_err() {
        return Ok(());
    }
    let module_count = read_u32(bytes, MODULE_COUNT_OFFSET) as usize;
    let records_offset = read_u32(bytes, MODULE_RECORDS_OFFSET) as usize;
    let data_address = section.start + u64::from(read_u32(bytes, MODULE_DATA_OFFSET));
    let records = bytes
        .get_mut(records_offset..)
        .and_then(|records| records.get_mut(..module_count * MODULE_RECORD_BYTES))
        .ok_or(TrimInternalError::RangeOutsideImage)?;
    let record_addresses = (section.start + records_offset as u64..).step_by(MODULE_RECORD_BYTES);
    for (record, address) in records
        .as_chunks_mut::<MODULE_RECORD_BYTES>()
        .0
        .iter_mut()
        .zip(record_addresses)
    {
        let text_start = data_address + u64::from(read_u32(record, TEXT_OFFSET_IN_RECORD));
        let text = AddressRange {
            start: text_start,
            end: text_start + u64::from(read_u32(record, TEXT_LENGTH_IN_RECORD)),
        };
        let record_range = AddressRange {
            start: address,
            end: address + MODULE_RECORD_BYTES as u64,
        };
        let is_text_removed = !text.is_empty() && removed.iter().any(|run| run.contains(text));
        let is_record_removed = removed
            .iter()
            .any(|run| ranges_intersect(*run, record_range));
        if is_text_removed && !is_record_removed {
            record[TEXT_FIELDS_OF_RECORD].fill(0);
        }
    }
    Ok(())
}

fn write_fills(editor: &mut ImageEditor<'_>, fills: &[Fill]) -> Result<(), TrimInternalError> {
    let architecture = editor.architecture();
    for fill in fills {
        let bytes = editor
            .bytes_at_mut(fill.range)
            .ok_or(TrimInternalError::RangeOutsideImage)?;
        if fill.is_code {
            write_traps(bytes, fill.range.start, architecture);
        } else {
            bytes.fill(0);
        }
    }
    Ok(())
}

fn write_traps(bytes: &mut [u8], address: u64, architecture: Architecture) {
    match architecture {
        Architecture::X86_64 => bytes.fill(X86_64_TRAP),
        Architecture::Aarch64 => {
            for (byte_address, byte) in (address..).zip(bytes.iter_mut()) {
                *byte = AARCH64_TRAP[(byte_address & 3) as usize];
            }
        }
    }
}

fn write_removal_state(
    editor: &mut ImageEditor<'_>,
    state_section: AddressRange,
    plan: &TrimPlan,
) -> Result<(), TrimInternalError> {
    let state = state_bytes(editor, state_section)?;
    let removal = &mut state[offset_of!(RemovableFeatureState, removal)..];
    for feature in plan.removed().iter() {
        removal[usize::from(feature.index())] = plan.removal_of(feature) as u8;
    }
    // A trimmed process looks up the native code of each built-in in the removed ranges.
    let is_trimmed = u32::from(
        !plan
            .removed()
            .is_subset_of(&Feature::all_outside_compiled_programs()),
    );
    write_state_field(
        state,
        offset_of!(RemovableFeatureState, is_trimmed),
        &is_trimmed.to_le_bytes(),
    );
    Ok(())
}

fn write_state_field(state: &mut [u8], offset: usize, value: &[u8]) {
    state[offset..][..value.len()].copy_from_slice(value);
}

fn push_removed_range(
    records: &mut Vec<RemovedRange>,
    range: AddressRange,
    feature: Feature,
    state_address: u64,
) {
    let feature = feature.index();
    let mut start = range.start;
    while start < range.end {
        let offset = start.wrapping_sub(state_address) as i64;
        let remaining = u32::try_from(range.end - start).unwrap_or(u32::MAX);
        match records.last_mut() {
            Some(last)
                if last.feature == feature
                    && last.size < u32::MAX
                    && last.start.wrapping_add(i64::from(last.size)) == offset =>
            {
                let added = remaining.min(u32::MAX - last.size);
                last.size += added;
                start += u64::from(added);
            }
            _ => {
                records.push(RemovedRange {
                    start: offset,
                    size: remaining,
                    feature,
                    reserved: 0,
                });
                start += u64::from(remaining);
            }
        }
    }
}

fn collect_removed_ranges(
    planned_ranges: &[PlannedRange],
    state_address: u64,
) -> Vec<RemovedRange> {
    let mut ascending: Vec<&PlannedRange> = planned_ranges.iter().collect();
    ascending.sort_by_key(|planned| planned.range.start);
    let mut records = Vec::with_capacity(ascending.len());
    for planned in ascending {
        push_removed_range(
            &mut records,
            planned.range,
            planned.named_feature,
            state_address,
        );
    }
    records
}

fn write_removed_ranges(
    editor: &mut ImageEditor<'_>,
    plan: &TrimPlan,
    sections: TrimSections,
) -> Result<(), TrimInternalError> {
    let records = collect_removed_ranges(&plan.ranges, sections.state.start);
    let table = editor
        .bytes_at_mut(sections.table)
        .ok_or(TrimInternalError::RangeOutsideImage)?;
    let encoded = encode_removed_ranges(&records, table.len());
    if encoded.dropped > 0 {
        return Err(TrimInternalError::MalformedTable);
    }
    table.fill(0);
    table[..encoded.bytes.len()].copy_from_slice(&encoded.bytes);
    let first_record = sections.table.start + REMOVED_RANGES_HEADER_BYTES as u64;
    let records_offset = if encoded.count == 0 {
        0
    } else {
        first_record.wrapping_sub(sections.state.start) as i64
    };
    let state = state_bytes(editor, sections.state)?;
    write_state_field(
        state,
        offset_of!(RemovableFeatureState, removed_range_count),
        &encoded.count.to_le_bytes(),
    );
    write_state_field(
        state,
        offset_of!(RemovableFeatureState, removed_ranges_offset),
        &records_offset.to_le_bytes(),
    );
    Ok(())
}

#[cfg(test)]
#[allow(clippy::single_range_in_vec_init)]
mod tests {
    use bun_exe_format::cut_model::{NoCutReason, Uncut, UncutReason};
    use bun_exe_format::image::ExecutableFormat;
    use bun_removable_features::find_removed_range;

    use super::*;
    use crate::icu_data::tests::package_of;
    use crate::model::{Decision, PlannedIcuPackage};
    use crate::table::TRIMMED_MAGIC;

    const EM_X86_64: u16 = 62;
    const EM_AARCH64: u16 = 183;
    const PT_LOAD: u32 = 1;
    const PT_NOTE: u32 = 4;
    const PF_R: u32 = 4;
    const PF_RX: u32 = 5;
    const SHT_PROGBITS: u32 = 1;
    const SHT_STRTAB: u32 = 3;
    const SHF_ALLOC: u64 = 2;
    const SHF_ALLOC_EXECINSTR: u64 = 6;
    const SEGMENT_ALIGNMENT: u64 = 0x10000;
    const ROOM_NOTE_OFFSET: u64 = 0x100;
    const ROOM_BYTES: u32 = 3584;
    const STATE_ADDRESS: u64 = 0x1000;
    const BUILTINS_ADDRESS: u64 = 0x1800;
    const BUILTINS_BYTES: u64 = 0x400;
    const BUILTINS_DATA_OFFSET: u64 = 128;
    const MODULE_TEXTS: [&[u8]; 3] = [
        b"(function (){first})",
        b"(function (){second})",
        b"(function (){third})",
    ];
    const NO_TEXT: &[u8] = b"";
    const BUILTINS_HEADER_END: u64 = BUILTINS_ADDRESS + BUILTIN_MODULES_HEADER_SIZE as u64;
    const PAYLOAD_ADDRESS: u64 = 0x1c00;
    const PAYLOAD_BYTES: u64 = 8;
    const TABLE_ADDRESS: u64 = 0x2000;
    const TABLE_BYTES: u64 = 4096;
    const RODATA_ADDRESS: u64 = 0x3000;
    const TEXT_ADDRESS: u64 = 0x20000;
    const TEXT_END: u64 = 0x70000;
    const RODATA_BYTES: u64 = TEXT_ADDRESS - RODATA_ADDRESS;
    const TEXT_BYTES: u64 = TEXT_END - TEXT_ADDRESS;
    const NOTE_END: u64 = ROOM_NOTE_OFFSET + 16 + ROOM_BYTES as u64;
    const RODATA_BYTE: u8 = 0x55;
    const TEXT_BYTE: u8 = 0x90;
    const SECTION_NAMES: &[u8] =
        b"\0.bun_features\0.bun_trim\0.rodata\0.text\0.shstrtab\0.bun_builtins\0.bun\0";
    const CUT_START: u64 = 0x2f100;
    const CUT_END: u64 = CUT_START + 40 * 4096;

    #[derive(Copy, Clone)]
    struct ToySection {
        name: u32,
        kind: u32,
        flags: u64,
        start: u64,
        size: u64,
    }

    fn range(start: u64, end: u64) -> AddressRange {
        AddressRange { start, end }
    }

    fn put(bytes: &mut [u8], at: u64, value: &[u8]) {
        bytes[at as usize..][..value.len()].copy_from_slice(value);
    }

    fn put_program_header(
        bytes: &mut [u8],
        index: u64,
        kind: u32,
        flags: u32,
        file: AddressRange,
        align: u64,
    ) {
        let at = 64 + index * 56;
        put(bytes, at, &kind.to_le_bytes());
        put(bytes, at + 4, &flags.to_le_bytes());
        let fields = [
            file.start,
            file.start,
            file.start,
            file.len(),
            file.len(),
            align,
        ];
        for (field, value) in (at + 8..).step_by(8).zip(fields) {
            put(bytes, field, &value.to_le_bytes());
        }
    }

    fn put_section_header(bytes: &mut [u8], at: u64, section: ToySection) {
        put(bytes, at, &section.name.to_le_bytes());
        put(bytes, at + 4, &section.kind.to_le_bytes());
        put(bytes, at + 8, &section.flags.to_le_bytes());
        put(bytes, at + 16, &section.start.to_le_bytes());
        put(bytes, at + 24, &section.start.to_le_bytes());
        put(bytes, at + 32, &section.size.to_le_bytes());
        put(bytes, at + 48, &1u64.to_le_bytes());
    }

    fn put_file_header(bytes: &mut [u8], machine: u16, section_headers: u64, section_count: u16) {
        put(bytes, 0, b"\x7fELF\x02\x01\x01");
        put(bytes, 16, &2u16.to_le_bytes());
        put(bytes, 18, &machine.to_le_bytes());
        put(bytes, 20, &1u32.to_le_bytes());
        put(bytes, 24, &TEXT_ADDRESS.to_le_bytes());
        put(bytes, 32, &64u64.to_le_bytes());
        put(bytes, 40, &section_headers.to_le_bytes());
        put(bytes, 52, &64u16.to_le_bytes());
        put(bytes, 54, &56u16.to_le_bytes());
        put(bytes, 56, &3u16.to_le_bytes());
        put(bytes, 58, &64u16.to_le_bytes());
        put(bytes, 60, &section_count.to_le_bytes());
        put(bytes, 62, &(section_count - 1).to_le_bytes());
    }

    fn put_room_note(bytes: &mut [u8]) {
        put(bytes, ROOM_NOTE_OFFSET, &4u32.to_le_bytes());
        put(bytes, ROOM_NOTE_OFFSET + 4, &ROOM_BYTES.to_le_bytes());
        put(bytes, ROOM_NOTE_OFFSET + 8, &1u32.to_le_bytes());
        put(bytes, ROOM_NOTE_OFFSET + 12, b"Bun\0");
    }

    fn toy_section(name: u32, kind: u32, flags: u64, start: u64, size: u64) -> ToySection {
        ToySection {
            name,
            kind,
            flags,
            start,
            size,
        }
    }

    struct ToyBuiltins {
        bytes: Vec<u8>,
        texts: Vec<AddressRange>,
    }

    fn toy_builtins() -> ToyBuiltins {
        let mut data = b"functions\0".to_vec();
        let mut texts = Vec::new();
        let mut records: Vec<u32> = Vec::new();
        for text in MODULE_TEXTS {
            let start = data.len() as u64;
            data.extend_from_slice(text);
            data.push(0);
            let data_address = BUILTINS_ADDRESS + BUILTINS_DATA_OFFSET;
            texts.push(range(
                data_address + start,
                data_address + data.len() as u64,
            ));
            let name = data.len() as u32;
            data.extend_from_slice(b"name\0builtin://name\0");
            records.extend([name, 4, name + 5, 14, start as u32, text.len() as u32]);
        }
        let records_end = BUILTIN_MODULES_HEADER_SIZE as u32 + 4 * records.len() as u32;
        let dependencies_end = records_end + 2 * (MODULE_TEXTS.len() as u32 + 1);
        let header = [
            2,
            0,
            MODULE_TEXTS.len() as u32,
            BUILTIN_MODULES_HEADER_SIZE as u32,
            records_end,
            dependencies_end,
            BUILTINS_DATA_OFFSET as u32,
            data.len() as u32,
            0,
            0,
        ];
        let mut bytes = b"BUNBLTNS".to_vec();
        bytes.extend(
            header
                .iter()
                .chain(&records)
                .flat_map(|word| word.to_le_bytes()),
        );
        bytes.resize(BUILTINS_DATA_OFFSET as usize, 0);
        bytes.extend_from_slice(&data);
        ToyBuiltins { bytes, texts }
    }

    fn toy_elf(machine: u16, table_bytes: u64) -> Vec<u8> {
        let names_bytes = SECTION_NAMES.len() as u64;
        let section_headers = (TEXT_END + names_bytes).next_multiple_of(8);
        let sections = [
            toy_section(1, SHT_PROGBITS, SHF_ALLOC, STATE_ADDRESS, STATE_BYTES),
            toy_section(
                49,
                SHT_PROGBITS,
                SHF_ALLOC,
                BUILTINS_ADDRESS,
                BUILTINS_BYTES,
            ),
            toy_section(63, SHT_PROGBITS, SHF_ALLOC, PAYLOAD_ADDRESS, PAYLOAD_BYTES),
            toy_section(15, SHT_PROGBITS, SHF_ALLOC, TABLE_ADDRESS, table_bytes),
            toy_section(25, SHT_PROGBITS, SHF_ALLOC, RODATA_ADDRESS, RODATA_BYTES),
            toy_section(
                33,
                SHT_PROGBITS,
                SHF_ALLOC_EXECINSTR,
                TEXT_ADDRESS,
                TEXT_BYTES,
            ),
            toy_section(39, SHT_STRTAB, 0, TEXT_END, names_bytes),
        ];
        let mut bytes = vec![0; (section_headers + 64 * (sections.len() as u64 + 1)) as usize];
        let section_count = sections.len() as u16 + 1;
        put_file_header(&mut bytes, machine, section_headers, section_count);
        let note = range(ROOM_NOTE_OFFSET, NOTE_END);
        let text = range(TEXT_ADDRESS, TEXT_END);
        put_program_header(&mut bytes, 0, PT_NOTE, PF_R, note, 8);
        put_program_header(
            &mut bytes,
            1,
            PT_LOAD,
            PF_R,
            range(0, TEXT_ADDRESS),
            SEGMENT_ALIGNMENT,
        );
        put_program_header(&mut bytes, 2, PT_LOAD, PF_RX, text, SEGMENT_ALIGNMENT);
        put_room_note(&mut bytes);
        put(&mut bytes, STATE_ADDRESS, &RemovableFeatureState::MAGIC);
        bytes[BUILTINS_ADDRESS as usize..][..BUILTINS_BYTES as usize].fill(RODATA_BYTE);
        put(&mut bytes, BUILTINS_ADDRESS, &toy_builtins().bytes);
        bytes[TABLE_ADDRESS as usize..][..table_bytes as usize].fill(0xee);
        bytes[RODATA_ADDRESS as usize..TEXT_ADDRESS as usize].fill(RODATA_BYTE);
        bytes[TEXT_ADDRESS as usize..TEXT_END as usize].fill(TEXT_BYTE);
        put(&mut bytes, TEXT_END, SECTION_NAMES);
        for (index, section) in sections.iter().enumerate() {
            put_section_header(
                &mut bytes,
                section_headers + 64 * (index as u64 + 1),
                *section,
            );
        }
        bytes
    }

    fn unused_feature() -> Feature {
        Feature::ALL[0]
    }

    fn named_feature() -> Feature {
        Feature::ALL[1]
    }

    fn planned(
        start: u64,
        end: u64,
        is_code: bool,
        can_be_cut: bool,
        feature: Feature,
    ) -> PlannedRange {
        PlannedRange {
            range: range(start, end),
            is_code,
            can_be_cut,
            can_be_filled: true,
            named_feature: feature,
        }
    }

    fn unfillable(start: u64, end: u64, feature: Feature) -> PlannedRange {
        PlannedRange {
            can_be_filled: false,
            ..planned(start, end, false, true, feature)
        }
    }

    fn create_plan(ranges: Vec<PlannedRange>) -> TrimPlan {
        TrimPlan {
            decision: Decision {
                unused: FeatureSet::from_features(&[unused_feature(), named_feature()]),
                requested: FeatureSet::EMPTY,
                retained: Vec::new(),
                requirements: Vec::new(),
            },
            ranges,
            icu_packages: Vec::new(),
            keeps_table: false,
        }
    }

    fn cut_and_fill_plan() -> TrimPlan {
        create_plan(vec![
            planned(0x4000, 0x5000, false, false, named_feature()),
            planned(CUT_START, CUT_END, true, true, unused_feature()),
        ])
    }

    fn two_record_plan() -> TrimPlan {
        create_plan(vec![
            planned(0x4000, 0x4100, false, false, named_feature()),
            planned(0x6000, 0x6200, false, false, unused_feature()),
        ])
    }

    fn read_at(executable: &mut Vec<u8>, address: AddressRange) -> Vec<u8> {
        let mut editor = ImageEditor::open(executable).unwrap();
        editor.bytes_at_mut(address).unwrap().to_vec()
    }

    fn read_state(executable: &mut Vec<u8>) -> Vec<u8> {
        read_at(
            executable,
            range(STATE_ADDRESS, STATE_ADDRESS + STATE_BYTES),
        )
    }

    fn state_u32(state: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(state[offset..][..4].try_into().unwrap())
    }

    fn read_records(executable: &mut Vec<u8>, table_bytes: u64) -> Vec<RemovedRange> {
        let state = read_state(executable);
        let count_offset = offset_of!(RemovableFeatureState, removed_range_count);
        let count = state_u32(&state, count_offset) as usize;
        let table = read_at(
            executable,
            range(TABLE_ADDRESS, TABLE_ADDRESS + table_bytes),
        );
        table[REMOVED_RANGES_HEADER_BYTES..]
            .chunks_exact(16)
            .take(count)
            .map(|record| RemovedRange {
                start: i64::from_le_bytes(record[..8].try_into().unwrap()),
                size: u32::from_le_bytes(record[8..12].try_into().unwrap()),
                feature: u16::from_le_bytes(record[12..14].try_into().unwrap()),
                reserved: u16::from_le_bytes(record[14..].try_into().unwrap()),
            })
            .collect()
    }

    fn feature_at(records: &[RemovedRange], address: u64) -> Option<u16> {
        find_removed_range(records, address as i64 - STATE_ADDRESS as i64)
    }

    fn assert_internal(result: Result<TrimSummary, TrimError>, expected: &TrimInternalError) {
        match result {
            Err(TrimError::Internal(error)) => assert_eq!(error.name(), expected.name()),
            other => panic!("expected {expected:?}, got {other:?}"),
        }
    }

    fn assert_words_trap(bytes: &[u8]) {
        assert!(bytes.chunks_exact(4).all(|word| word == AARCH64_TRAP));
    }

    #[test]
    fn cuts_fills_and_records_on_x86_64() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let old_len = executable.len() as u64;
        let plan = cut_and_fill_plan();
        let summary = apply(&mut executable, &plan).unwrap();

        let state = read_state(&mut executable);
        let removal = &state[offset_of!(RemovableFeatureState, removal)..];
        let removed = [unused_feature(), named_feature()].map(|feature| feature.index() as usize);
        for (index, byte) in removal.iter().enumerate() {
            assert_eq!(*byte, u8::from(removed.contains(&index)));
        }
        assert_eq!(
            state_u32(&state, offset_of!(RemovableFeatureState, is_trimmed)),
            1
        );
        assert!(
            !plan
                .removed()
                .is_subset_of(&Feature::all_outside_compiled_programs())
        );

        let cut_bytes = 0x57000 - 0x30000;
        assert_eq!(old_len - executable.len() as u64, summary.file_bytes_saved);
        assert!(summary.file_bytes_saved.abs_diff(cut_bytes) <= 256);
        assert_eq!(summary.cut_bytes, cut_bytes);
        assert_eq!(summary.removed_bytes(), 40 * 4096 + 0x1000);
        assert_eq!(summary.uncut, None);
        assert_eq!(summary.removed, plan.removed());
        assert_eq!(summary.format, Some(ExecutableFormat::Elf));

        let is_trap = |byte: &u8| *byte == X86_64_TRAP;
        assert!(
            read_at(&mut executable, range(CUT_START, 0x30000))
                .iter()
                .all(is_trap)
        );
        assert!(
            read_at(&mut executable, range(0x57000, CUT_END))
                .iter()
                .all(is_trap)
        );
        assert_eq!(
            read_at(&mut executable, range(CUT_START - 1, CUT_START)),
            [TEXT_BYTE]
        );
        assert_eq!(
            read_at(&mut executable, range(CUT_END, CUT_END + 1)),
            [TEXT_BYTE]
        );
        assert_eq!(read_at(&mut executable, range(0x4000, 0x5000)), [0; 0x1000]);
        assert_eq!(
            read_at(&mut executable, range(0x5000, 0x5001)),
            [RODATA_BYTE]
        );

        let table = read_at(
            &mut executable,
            range(TABLE_ADDRESS, TABLE_ADDRESS + TABLE_BYTES),
        );
        assert!(table.starts_with(&TRIMMED_MAGIC));
        assert!(!table.contains(&0xee));
        let records = read_records(&mut executable, TABLE_BYTES);
        assert_eq!(feature_at(&records, 0x4800), Some(named_feature().index()));
        assert_eq!(
            feature_at(&records, CUT_START),
            Some(unused_feature().index())
        );
        assert_eq!(
            feature_at(&records, CUT_END - 1),
            Some(unused_feature().index())
        );
        assert_eq!(
            state_u32(
                &state,
                offset_of!(RemovableFeatureState, removed_range_count)
            ) as usize,
            records.len(),
        );
    }

    #[test]
    fn every_cut_is_listed() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let plan = create_plan(vec![
            planned(TEXT_ADDRESS, 0x48000, true, true, unused_feature()),
            planned(0x49000, TEXT_END, true, true, named_feature()),
        ]);
        apply(&mut executable, &plan).unwrap();
        let records = read_records(&mut executable, TABLE_BYTES);
        assert_eq!(
            feature_at(&records, 0x30000),
            Some(unused_feature().index())
        );
        assert_eq!(feature_at(&records, 0x48800), None);
        assert_eq!(feature_at(&records, 0x60000), Some(named_feature().index()));
    }

    #[test]
    fn one_page_range_is_cut() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let old_len = executable.len() as u64;
        let page = planned(0x30000, 0x31000, true, true, unused_feature());
        let summary = apply(&mut executable, &create_plan(vec![page])).unwrap();
        assert_eq!(summary.cut_bytes, 0x1000);
        assert_eq!(summary.filled_bytes, 0);
        assert_eq!(summary.uncut, None);
        assert_eq!(old_len - executable.len() as u64, summary.file_bytes_saved);
        assert!(summary.file_bytes_saved.abs_diff(0x1000) <= 256);
        assert_eq!(
            read_at(&mut executable, range(0x2ffff, 0x30000)),
            [TEXT_BYTE]
        );
        assert_eq!(
            read_at(&mut executable, range(0x31000, 0x31001)),
            [TEXT_BYTE]
        );
    }

    #[test]
    fn range_without_whole_page_is_filled() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let old_len = executable.len();
        let ragged = planned(0x30100, 0x31f00, true, true, unused_feature());
        let summary = apply(&mut executable, &create_plan(vec![ragged])).unwrap();
        assert_eq!(summary.cut_bytes, 0);
        assert_eq!(summary.filled_bytes, 0x1e00);
        assert_eq!(summary.file_bytes_saved, 0);
        assert_eq!(executable.len(), old_len);
    }

    #[test]
    fn no_header_room_reports_uncut() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        put(&mut executable, ROOM_NOTE_OFFSET + 8, &2u32.to_le_bytes());
        let old_len = executable.len();
        let summary = apply(&mut executable, &cut_and_fill_plan()).unwrap();
        assert_eq!(summary.file_bytes_saved, 0);
        assert_eq!(executable.len(), old_len);
        assert_eq!(summary.cut_bytes, 0);
        assert_eq!(summary.filled_bytes, 40 * 4096 + 0x1000);
        assert_eq!(
            summary.uncut,
            Some(Uncut {
                reason: UncutReason::NoCuts(NoCutReason::HeaderRoomExhausted),
                bytes: 0x57000 - 0x30000,
            }),
        );
        let is_trap = |byte: &u8| *byte == X86_64_TRAP;
        assert!(
            read_at(&mut executable, range(CUT_START, CUT_END))
                .iter()
                .all(is_trap)
        );
    }

    #[test]
    fn aarch64_fills_whole_trap_words() {
        let mut executable = toy_elf(EM_AARCH64, TABLE_BYTES);
        let plan = create_plan(vec![
            planned(0x21002, 0x21010, true, false, named_feature()),
            planned(CUT_START, CUT_END, true, true, unused_feature()),
        ]);
        let summary = apply(&mut executable, &plan).unwrap();
        assert!(summary.file_bytes_saved.abs_diff(0x20000) <= 256);
        assert_words_trap(&read_at(&mut executable, range(CUT_START, 0x30000)));
        assert_words_trap(&read_at(&mut executable, range(0x50000, CUT_END)));
        assert_words_trap(&read_at(&mut executable, range(0x21004, 0x21010)));
        assert_eq!(
            read_at(&mut executable, range(0x21002, 0x21004)),
            AARCH64_TRAP[2..]
        );
        assert_eq!(
            read_at(&mut executable, range(0x21001, 0x21002)),
            [TEXT_BYTE]
        );
    }

    #[test]
    fn unfillable_range_is_cut_but_never_overwritten() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let plan = create_plan(vec![
            unfillable(0x4100, 0x4f00, named_feature()),
            unfillable(CUT_START, CUT_END, unused_feature()),
        ]);
        let summary = apply(&mut executable, &plan).unwrap();
        assert_eq!(summary.removed_bytes(), 0x57000 - 0x30000);
        assert_eq!(summary.filled_bytes, 0);
        assert!(summary.file_bytes_saved.abs_diff(summary.cut_bytes) <= 256);

        let is_text = |byte: &u8| *byte == TEXT_BYTE;
        assert_eq!(
            read_at(&mut executable, range(0x4100, 0x4f00)),
            [RODATA_BYTE; 0xe00]
        );
        assert!(
            read_at(&mut executable, range(CUT_START, 0x30000))
                .iter()
                .all(is_text)
        );
        assert!(
            read_at(&mut executable, range(0x57000, CUT_END))
                .iter()
                .all(is_text)
        );

        let records = read_records(&mut executable, TABLE_BYTES);
        assert_eq!(feature_at(&records, 0x4800), Some(named_feature().index()));
        assert_eq!(
            feature_at(&records, CUT_START),
            Some(unused_feature().index())
        );
    }

    #[test]
    fn second_apply_is_already_trimmed() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let plan = cut_and_fill_plan();
        apply(&mut executable, &plan).unwrap();
        assert!(matches!(
            apply(&mut executable, &plan),
            Err(TrimError::Unsupported(UnsupportedReason::AlreadyTrimmed)),
        ));
    }

    #[test]
    fn template_is_cut_again_to_what_one_cut_gives() {
        let first_range = planned(CUT_START, CUT_END, true, true, unused_feature());
        let second_ranges = [
            planned(0x4000, 0x5000, false, false, named_feature()),
            planned(CUT_END, CUT_END + 0x3080, true, true, named_feature()),
        ];
        let template_plan = TrimPlan {
            decision: Decision {
                unused: FeatureSet::from_features(&[unused_feature()]),
                ..create_plan(Vec::new()).decision
            },
            keeps_table: true,
            ..create_plan(vec![first_range])
        };
        let whole_plan = create_plan(vec![second_ranges[0], first_range, second_ranges[1]]);

        let mut template = toy_elf(EM_X86_64, TABLE_BYTES);
        let old_len = template.len();
        apply(&mut template, &template_plan).unwrap();
        assert!(template.len() < old_len);
        let table = range(TABLE_ADDRESS, TABLE_ADDRESS + TABLE_BYTES);
        assert!(
            read_at(&mut template, table)
                .iter()
                .all(|byte| *byte == 0xee)
        );
        let state = read_state(&mut template);
        let flags = offset_of!(RemovableFeatureState, is_trimmed)
            ..offset_of!(RemovableFeatureState, removal);
        assert!(state[flags].iter().all(|byte| *byte == 0));

        let mut cut_twice = template.clone();
        apply(&mut cut_twice, &whole_plan).unwrap();
        let mut cut_once = toy_elf(EM_X86_64, TABLE_BYTES);
        apply(&mut cut_once, &whole_plan).unwrap();
        assert_eq!(cut_twice.len(), cut_once.len());
        assert_eq!(read_state(&mut cut_twice), read_state(&mut cut_once));
        assert_eq!(
            read_records(&mut cut_twice, TABLE_BYTES),
            read_records(&mut cut_once, TABLE_BYTES)
        );
        assert!(matches!(
            apply(&mut cut_twice, &whole_plan),
            Err(TrimError::Unsupported(UnsupportedReason::AlreadyTrimmed)),
        ));
    }

    #[test]
    fn output_depends_only_on_arguments() {
        let plan = cut_and_fill_plan();
        let mut first = toy_elf(EM_X86_64, TABLE_BYTES);
        let mut second = toy_elf(EM_X86_64, TABLE_BYTES);
        apply(&mut first, &plan).unwrap();
        apply(&mut second, &plan).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn empty_plan_leaves_bytes_unchanged() {
        let mut executable = vec![1, 2, 3];
        let summary = apply(&mut executable, &TrimPlan::empty()).unwrap();
        assert_eq!(executable, [1, 2, 3]);
        assert_eq!(summary.format, None);
        assert_eq!(summary.removed_bytes(), 0);
        assert_eq!(summary.uncut, None);
    }

    #[test]
    fn record_without_room_is_malformed_table() {
        let mut executable = toy_elf(EM_X86_64, 32);
        let result = apply(&mut executable, &two_record_plan());
        assert_internal(result, &TrimInternalError::MalformedTable);
    }

    #[test]
    fn table_with_exact_room_holds_every_record() {
        let mut executable = toy_elf(EM_X86_64, 48);
        apply(&mut executable, &two_record_plan()).unwrap();
        let records = read_records(&mut executable, 48);
        assert_eq!(records.len(), 2);
        assert_eq!(feature_at(&records, 0x4000), Some(named_feature().index()));
        assert_eq!(feature_at(&records, 0x6000), Some(unused_feature().index()));
    }

    #[test]
    fn adjacent_ranges_of_one_feature_merge() {
        let ranges = [
            planned(0x4000, 0x4100, false, false, named_feature()),
            planned(0x4100, 0x4200, false, false, named_feature()),
            planned(0x4200, 0x4300, false, false, unused_feature()),
        ];
        let records = collect_removed_ranges(&ranges, STATE_ADDRESS);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].start, 0x3000);
        assert_eq!(records[0].size, 0x200);
        assert_eq!(records[1].size, 0x100);
    }

    #[test]
    fn separate_ranges_of_one_feature_stay_separate() {
        let ranges = [
            planned(0x4000, 0x4100, false, false, named_feature()),
            planned(0x4101, 0x4200, false, false, named_feature()),
        ];
        let records = collect_removed_ranges(&ranges, STATE_ADDRESS);
        assert_eq!(records.len(), 2);
        assert_eq!(feature_at(&records, 0x4100), None);
    }

    #[test]
    fn record_stops_at_size_limit() {
        let limit = u64::from(u32::MAX);
        let ranges = [planned(
            0x4000,
            0x4000 + limit + 1,
            false,
            false,
            named_feature(),
        )];
        let records = collect_removed_ranges(&ranges, STATE_ADDRESS);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].size, u32::MAX);
        assert_eq!(records[1].size, 1);
    }

    #[test]
    fn range_past_text_is_outside_image() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let past_text = planned(
            TEXT_END - 0x1000,
            TEXT_END + 0x1000,
            true,
            false,
            named_feature(),
        );
        let result = apply(&mut executable, &create_plan(vec![past_text]));
        assert_internal(result, &TrimInternalError::RangeOutsideImage);
    }

    #[test]
    fn icu_package_past_text_is_outside_image() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let mut plan = create_plan(Vec::new());
        plan.icu_packages = vec![PlannedIcuPackage {
            range: range(TEXT_END, TEXT_END + 64),
            removed_items: vec![0..1],
            tombstoned_items: Vec::new(),
        }];
        let result = apply(&mut executable, &plan);
        assert_internal(result, &TrimInternalError::RangeOutsideImage);
    }

    #[test]
    fn malformed_ranges_are_malformed_table() {
        let data = |start, end| planned(start, end, false, false, named_feature());
        let plans = [
            vec![data(0x4000, 0x5000), data(0x4800, 0x6000)],
            vec![data(0x4000, 0x4000)],
            vec![data(0x5000, 0x4000)],
            vec![data(STATE_ADDRESS, STATE_ADDRESS + 16)],
            vec![data(TABLE_ADDRESS, TABLE_ADDRESS + 16)],
            vec![data(PAYLOAD_ADDRESS, PAYLOAD_ADDRESS + PAYLOAD_BYTES)],
            vec![data(BUILTINS_HEADER_END - 8, BUILTINS_HEADER_END)],
        ];
        for ranges in plans {
            let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
            let result = apply(&mut executable, &create_plan(ranges));
            assert_internal(result, &TrimInternalError::MalformedTable);
        }
    }

    #[test]
    fn range_after_builtin_modules_header_is_filled() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let builtins_end = BUILTINS_ADDRESS + BUILTINS_BYTES;
        let body = planned(
            BUILTINS_HEADER_END,
            builtins_end,
            false,
            false,
            named_feature(),
        );
        apply(&mut executable, &create_plan(vec![body])).unwrap();
        let header = read_at(
            &mut executable,
            range(BUILTINS_ADDRESS, BUILTINS_HEADER_END),
        );
        assert_eq!(header, toy_builtins().bytes[..BUILTIN_MODULES_HEADER_SIZE]);
        let body = read_at(&mut executable, range(BUILTINS_HEADER_END, builtins_end));
        assert!(body.iter().all(|byte| *byte == 0));
    }

    fn module_text(text: AddressRange) -> PlannedRange {
        planned(text.start, text.end, false, false, named_feature())
    }

    fn read_module_texts(executable: &mut Vec<u8>) -> Vec<Vec<u8>> {
        let section = range(BUILTINS_ADDRESS, BUILTINS_ADDRESS + BUILTINS_BYTES);
        let bytes = read_at(executable, section);
        let builtins = Builtins::parse(&bytes).unwrap();
        (0..MODULE_TEXTS.len() as u32)
            .map(|id| {
                let module = builtins.module(id).unwrap();
                assert_eq!(
                    (module.name, module.url),
                    (&b"name"[..], &b"builtin://name"[..])
                );
                module.source.to_vec()
            })
            .collect()
    }

    #[test]
    fn untouched_module_texts_are_read() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        apply(&mut executable, &cut_and_fill_plan()).unwrap();
        assert_eq!(read_module_texts(&mut executable), MODULE_TEXTS);
    }

    #[test]
    fn removed_module_text_leaves_record_without_text() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let second = toy_builtins().texts[1];
        let summary = apply(&mut executable, &create_plan(vec![module_text(second)])).unwrap();
        assert_eq!(summary.filled_bytes, second.len());
        assert_eq!(
            read_module_texts(&mut executable),
            [MODULE_TEXTS[0], NO_TEXT, MODULE_TEXTS[2]]
        );
        assert!(
            read_at(&mut executable, second)
                .iter()
                .all(|byte| *byte == 0)
        );
        let records = read_records(&mut executable, TABLE_BYTES);
        assert_eq!(
            feature_at(&records, second.start),
            Some(named_feature().index())
        );
    }

    #[test]
    fn module_text_inside_adjacent_ranges_leaves_record_without_text() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let first = toy_builtins().texts[0];
        let middle = first.start + 8;
        let halves = [range(first.start, middle), range(middle, first.end)].map(module_text);
        apply(&mut executable, &create_plan(halves.to_vec())).unwrap();
        assert_eq!(
            read_module_texts(&mut executable),
            [NO_TEXT, MODULE_TEXTS[1], MODULE_TEXTS[2]]
        );
    }

    #[test]
    fn partly_removed_module_text_keeps_its_record() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let third = toy_builtins().texts[2];
        let tail = module_text(range(third.start + 8, third.end));
        apply(&mut executable, &create_plan(vec![tail])).unwrap();
        let texts = read_module_texts(&mut executable);
        assert_eq!(texts[2].len(), MODULE_TEXTS[2].len());
        assert_eq!(texts[2][..8], MODULE_TEXTS[2][..8]);
        assert!(texts[2][8..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn section_without_module_index_is_only_filled() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        executable[BUILTINS_ADDRESS as usize] = b'X';
        let first = toy_builtins().texts[0];
        let before = read_at(&mut executable, range(BUILTINS_ADDRESS, first.start));
        apply(&mut executable, &create_plan(vec![module_text(first)])).unwrap();
        assert_eq!(
            read_at(&mut executable, range(BUILTINS_ADDRESS, first.start)),
            before
        );
        assert!(
            read_at(&mut executable, first)
                .iter()
                .all(|byte| *byte == 0)
        );
    }

    #[test]
    fn planned_ranges_in_any_order_are_recorded_ascending() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let texts = toy_builtins().texts;
        let plan = create_plan(vec![
            planned(0x6000, 0x6200, false, false, unused_feature()),
            module_text(texts[2]),
            module_text(texts[0]),
        ]);
        apply(&mut executable, &plan).unwrap();
        let records = read_records(&mut executable, TABLE_BYTES);
        assert!(records.is_sorted_by_key(|record| record.start));
        assert_eq!(
            feature_at(&records, texts[0].start),
            Some(named_feature().index())
        );
        assert_eq!(feature_at(&records, texts[1].start), None);
        assert_eq!(
            feature_at(&records, texts[2].start),
            Some(named_feature().index())
        );
        assert_eq!(feature_at(&records, 0x6100), Some(unused_feature().index()));
    }

    #[test]
    fn icu_range_over_planned_range_is_malformed_table() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        let package = package_of(&[("a", 64), ("b", 64)], 32);
        let package_end = 0x8000 + package.len() as u64;
        put(&mut executable, 0x8000, &package);
        let last_bytes = planned(package_end - 16, package_end, false, false, named_feature());
        let mut plan = create_plan(vec![last_bytes]);
        plan.icu_packages = vec![PlannedIcuPackage {
            range: range(0x8000, package_end),
            removed_items: vec![1..2],
            tombstoned_items: Vec::new(),
        }];
        let result = apply(&mut executable, &plan);
        assert_internal(result, &TrimInternalError::MalformedTable);
    }

    #[test]
    fn wrong_state_magic_is_malformed_table() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        executable[STATE_ADDRESS as usize] = 0;
        let result = apply(&mut executable, &cut_and_fill_plan());
        assert_internal(result, &TrimInternalError::MalformedTable);
    }

    #[test]
    fn missing_state_section_is_malformed_table() {
        let mut executable = toy_elf(EM_X86_64, TABLE_BYTES);
        executable[TEXT_END as usize + 2] = b'X';
        let result = apply(&mut executable, &cut_and_fill_plan());
        assert_internal(result, &TrimInternalError::MalformedTable);
    }
}

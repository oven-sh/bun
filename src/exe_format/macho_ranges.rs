use core::mem::size_of;
use core::ops::Range;

use crate::cut_model::{CutCapacity, CutModel, NoCutReason};
use crate::image::{
    AddressRange, Architecture, ExecutableFormat, ImageError, MappedSpan, RemovedFileRanges,
    merge_ranges, subtract_cuts,
};
use crate::macho::{MachoSigner, SEG_LINKEDIT};
use crate::macho_fixups::{SegmentPiece, rebuild_chained_fixups};
use crate::macho_types::{
    CPU_TYPE_ARM64, CPU_TYPE_X86_64, CommandKind, LC, LoadCommandIterator, MH_EXECUTE, MH_MAGIC_64,
    N_SECT, N_STAB, N_TYPE, S_4BYTE_LITERALS, S_8BYTE_LITERALS, S_16BYTE_LITERALS,
    S_CSTRING_LITERALS, S_GB_ZEROFILL, S_REGULAR, S_THREAD_LOCAL_ZEROFILL, S_ZEROFILL,
    SECTION_TYPE, SG_READ_ONLY, command_kind, dysymtab_command, linkedit_data_command,
    load_command, mach_header_64, nlist_64, section_64, segment_command_64, symtab_command,
};
use crate::{align_up, read_struct, write_struct};

pub(crate) const CUT_ALIGNMENT: u64 = 0x4000;
const HEADER_SIZE: usize = size_of::<mach_header_64>();
const SEGMENT_COMMAND_SIZE: usize = size_of::<segment_command_64>();
const SECTION_SIZE: usize = size_of::<section_64>();
const SYMBOL_SIZE: usize = size_of::<nlist_64>();
const BYTES_PER_CUT: usize = SEGMENT_COMMAND_SIZE + SECTION_SIZE;
const MAX_SECTIONS: usize = u8::MAX as usize;
const FIXUPS_GROWTH_ALIGNMENT: u64 = 16;
const SEGMENT_NAME_OFFSET: usize = size_of::<load_command>();
const SEGMENT_NAME_SIZE: usize = 16;

type Result<T, E = ImageError> = core::result::Result<T, E>;

struct Segment {
    command: segment_command_64,
    sections: Vec<section_64>,
    first_ordinal: usize,
}

struct Parsed {
    header: mach_header_64,
    commands: Vec<(CommandKind, Range<usize>)>,
    segments: Vec<Segment>,
    header_room_end: usize,
    image_base: u64,
    linkedit: usize,
}

struct NewSegment {
    command: segment_command_64,
    sections: Vec<(usize, section_64)>,
}

struct FileOffsetMap {
    removed: RemovedFileRanges,
    old_linkedit: Range<u64>,
    old_fixups_end: u64,
    growth: u64,
}

struct Plan {
    map: FileOffsetMap,
    old_symbols: Range<usize>,
    new_ordinals: Vec<Vec<(u64, u8)>>,
    fixups: Vec<u8>,
    signature: Range<usize>,
    headers: Vec<u8>,
}

pub(crate) fn architecture(macho: &[u8]) -> Result<Architecture, ImageError> {
    match read_header(macho)?.cputype {
        CPU_TYPE_X86_64 => Ok(Architecture::X86_64),
        CPU_TYPE_ARM64 => Ok(Architecture::Aarch64),
        _ => Err(ImageError::UnrecognizedExecutable),
    }
}

pub(crate) fn mapped_spans(macho: &[u8]) -> Result<Vec<MappedSpan>, ImageError> {
    let parsed = parse(macho)?;
    Ok(parsed.segments[..parsed.linkedit]
        .iter()
        .map(|segment| MappedSpan {
            addresses: file_backed_addresses(&segment.command),
            file_offset: segment.command.fileoff,
        })
        .filter(|span| !span.addresses.is_empty())
        .collect())
}

pub(crate) fn cut_model(macho: &[u8]) -> CutModel {
    let without_cuts =
        |reason| CutModel::without_cuts(ExecutableFormat::MachO, CUT_ALIGNMENT, reason);
    let Ok(parsed) = parse(macho) else {
        return without_cuts(NoCutReason::HeadersUnreadable);
    };
    match compute_capacity(macho, &parsed) {
        Ok(capacity @ CutCapacity::Cuts(_)) => CutModel {
            format: ExecutableFormat::MachO,
            alignment: CUT_ALIGNMENT,
            capacity,
            cuttable_spans: find_cuttable_spans(&parsed),
            spans_cut_only_at_end: find_read_only_segments(&parsed),
        },
        Ok(CutCapacity::NoCuts(reason)) => without_cuts(reason),
        Err(_) => without_cuts(NoCutReason::HeadersUnreadable),
    }
}

pub(crate) fn remove_ranges(macho: &mut Vec<u8>, cuts: &[AddressRange]) -> Result<(), ImageError> {
    let parsed = parse(macho)?;
    let plan = plan_removal(macho, &parsed, cuts)?;
    apply_plan(macho, parsed.header_room_end, &plan);
    Ok(())
}

fn compute_capacity(macho: &[u8], parsed: &Parsed) -> Result<CutCapacity> {
    plan_removal(macho, parsed, &[])?;
    let header_room = parsed.header_room_end - HEADER_SIZE - parsed.header.sizeofcmds as usize;
    let section_count = parsed.segments[parsed.linkedit].first_ordinal - 1;
    let free_ordinals = MAX_SECTIONS.saturating_sub(section_count);
    let free_slots = free_ordinals.min(header_room / BYTES_PER_CUT);
    Ok(CutCapacity::from_free_slots(free_slots))
}

fn find_cuttable_spans(parsed: &Parsed) -> Vec<AddressRange> {
    let segments = &parsed.segments[..parsed.linkedit];
    let headers = AddressRange {
        start: parsed.image_base,
        end: parsed
            .image_base
            .saturating_add(parsed.header_room_end as u64),
    };
    let mut required = vec![headers];
    let sections = segments.iter().flat_map(|segment| &segment.sections);
    let unsplittable = sections.filter(|section| section.size > 0 && !can_split(section));
    required.extend(unsplittable.map(section_addresses));
    let required = merge_ranges(required);
    segments
        .iter()
        .flat_map(|segment| subtract_cuts(file_backed_addresses(&segment.command), &required))
        .collect()
}

/// The kernel refuses an executable that has two segments with this flag.
fn find_read_only_segments(parsed: &Parsed) -> Vec<AddressRange> {
    parsed.segments[..parsed.linkedit]
        .iter()
        .map(|segment| &segment.command)
        .filter(|command| command.flags & SG_READ_ONLY != 0)
        .map(file_backed_addresses)
        .collect()
}

fn read_header(macho: &[u8]) -> Result<mach_header_64> {
    if macho.len() < HEADER_SIZE || read_struct::<u32>(macho) != MH_MAGIC_64 {
        return Err(ImageError::UnrecognizedExecutable);
    }
    let header: mach_header_64 = read_struct(macho);
    if header.filetype != MH_EXECUTE || header.sizeofcmds as usize > macho.len() - HEADER_SIZE {
        return Err(ImageError::MalformedHeaders);
    }
    Ok(header)
}

fn parse(macho: &[u8]) -> Result<Parsed> {
    let header = read_header(macho)?;
    let commands_end = HEADER_SIZE + header.sizeofcmds as usize;
    let mut iterator = LoadCommandIterator::new(header.ncmds, &macho[HEADER_SIZE..commands_end]);
    let mut commands = Vec::new();
    let mut segments: Vec<Segment> = Vec::new();
    while let Some(entry) = iterator.next() {
        let start = HEADER_SIZE + entry.offset;
        let range = start..start + entry.data.len();
        let kind = command_kind(entry.cmd());
        if let CommandKind::Segment = kind {
            let segment = read_segment(&macho[range.clone()], macho.len() as u64, &segments)?;
            segments.push(segment);
        }
        commands.push((kind, range));
    }
    let header_segment = segments
        .iter()
        .find(|segment| segment.command.fileoff == 0 && segment.command.filesize > 0)
        .ok_or(ImageError::MalformedHeaders)?;
    let image_base = header_segment.command.vmaddr;
    let header_room_end = header_segment
        .sections
        .iter()
        .filter(|section| section.size > 0 && !is_zero_fill(section))
        .map(|section| u64::from(section.offset))
        .fold(header_segment.command.filesize, u64::min) as usize;
    let is_linkedit = |segment: &Segment| segment.command.seg_name() == SEG_LINKEDIT;
    let linkedit = segments.len() - 1;
    if commands.len() != header.ncmds as usize
        || header_room_end < commands_end
        || segments.iter().position(is_linkedit) != Some(linkedit)
        || !segments[linkedit].sections.is_empty()
    {
        return Err(ImageError::MalformedHeaders);
    }
    Ok(Parsed {
        header,
        commands,
        segments,
        header_room_end,
        image_base,
        linkedit,
    })
}

fn read_segment(bytes: &[u8], file_size: u64, previous: &[Segment]) -> Result<Segment> {
    let command: segment_command_64 = read_command(bytes)?;
    let (section_headers, rest) = bytes[SEGMENT_COMMAND_SIZE..].as_chunks::<SECTION_SIZE>();
    let file_end = command.fileoff.checked_add(command.filesize);
    let mut previous_commands = previous.iter().map(|segment| &segment.command);
    let file_backed = previous_commands.rfind(|command| command.filesize > 0);
    let min_fileoff = file_backed.map_or(0, |command| command.fileoff + command.filesize);
    let (min_vmaddr, first_ordinal) = previous.last().map_or((0, 1), |segment| {
        let next_ordinal = segment.first_ordinal + segment.sections.len();
        (vm_addresses(&segment.command).end, next_ordinal)
    });
    if section_headers.len() != command.nsects as usize
        || !rest.is_empty()
        || file_end.is_none_or(|file_end| file_end > file_size)
        || command.vmaddr.checked_add(command.vmsize).is_none()
        || (command.filesize > command.vmsize && command.vmsize != 0)
        || (command.filesize > 0 && command.fileoff < min_fileoff)
        || command.vmaddr < min_vmaddr
    {
        return Err(ImageError::MalformedHeaders);
    }
    let sections: Vec<section_64> = (section_headers.iter())
        .map(|bytes| read_struct(bytes))
        .collect();
    for section in &sections {
        check_section_layout(section, &command)?;
    }
    Ok(Segment {
        command,
        sections,
        first_ordinal,
    })
}

fn check_section_layout(section: &section_64, segment: &segment_command_64) -> Result<()> {
    let addresses = AddressRange::from_size(section.addr, section.size)?;
    if !vm_addresses(segment).contains(addresses) {
        return Err(ImageError::MalformedHeaders);
    }
    if addresses.is_empty() || is_zero_fill(section) {
        return Ok(());
    }
    if !file_backed_addresses(segment).contains(addresses)
        || u64::from(section.offset) != segment.fileoff + (section.addr - segment.vmaddr)
    {
        return Err(ImageError::MalformedHeaders);
    }
    Ok(())
}

fn vm_addresses(command: &segment_command_64) -> AddressRange {
    AddressRange {
        start: command.vmaddr,
        end: command.vmaddr + command.vmsize,
    }
}

fn file_backed_addresses(command: &segment_command_64) -> AddressRange {
    AddressRange {
        start: command.vmaddr,
        end: command.vmaddr + command.filesize.min(command.vmsize),
    }
}

fn section_addresses(section: &section_64) -> AddressRange {
    AddressRange {
        start: section.addr,
        end: section.addr + section.size,
    }
}

fn is_zero_fill(section: &section_64) -> bool {
    matches!(
        section.flags & SECTION_TYPE,
        S_ZEROFILL | S_GB_ZEROFILL | S_THREAD_LOCAL_ZEROFILL
    )
}

fn can_split(section: &section_64) -> bool {
    matches!(
        section.flags & SECTION_TYPE,
        S_REGULAR | S_CSTRING_LITERALS | S_4BYTE_LITERALS | S_8BYTE_LITERALS | S_16BYTE_LITERALS
    )
}

fn to_u32(value: u64) -> Result<u32> {
    u32::try_from(value).map_err(|_| ImageError::MalformedHeaders)
}

fn read_command<T: Copy>(command: &[u8]) -> Result<T> {
    let bytes = command.get(..size_of::<T>());
    bytes.map(read_struct).ok_or(ImageError::MalformedHeaders)
}

fn find_command<T: Copy>(macho: &[u8], parsed: &Parsed, cmd: u32) -> Result<Option<T>> {
    let ranges = parsed.commands.iter().map(|(_, range)| range.clone());
    let mut matching = ranges.filter(|range| read_struct::<u32>(&macho[range.start..]) == cmd);
    match (matching.next(), matching.next()) {
        (range, None) => range.map(|range| read_command(&macho[range])).transpose(),
        _ => Err(ImageError::MalformedHeaders),
    }
}

fn plan_removal(macho: &[u8], parsed: &Parsed, cuts: &[AddressRange]) -> Result<Plan> {
    let linkedit_segment = &parsed.segments[parsed.linkedit];
    let old_linkedit = linkedit_segment.command.fileoff..macho.len() as u64;
    if old_linkedit.start + linkedit_segment.command.filesize != old_linkedit.end {
        return Err(ImageError::MalformedHeaders);
    }
    let removed = find_removed_file_ranges(parsed, cuts)?;
    let mut pieces = Vec::with_capacity(parsed.segments.len());
    for segment in &parsed.segments {
        pieces.push(split_segment(segment, cuts, &removed)?);
    }
    let new_ordinals = number_sections(linkedit_segment.first_ordinal, &pieces)?;
    let find_blob = |cmd: u32| -> Result<Option<Range<usize>>> {
        let Some(command) = find_command::<linkedit_data_command>(macho, parsed, cmd)? else {
            return Ok(None);
        };
        find_linkedit_blob(&old_linkedit, command.dataoff, command.datasize as usize).map(Some)
    };
    let old_fixups = find_blob(LC::DYLD_CHAINED_FIXUPS)?;
    let old_signature = find_blob(LC::CODE_SIGNATURE)?;
    let old_symbols = match find_command::<symtab_command>(macho, parsed, LC::SYMTAB)? {
        Some(table) if table.nsyms > 0 => find_linkedit_blob(
            &old_linkedit,
            table.symoff,
            SYMBOL_SIZE * table.nsyms as usize,
        )?,
        _ => 0..0,
    };
    let fixups = match &old_fixups {
        Some(old_fixups) => rebuild_fixups(&macho[old_fixups.clone()], parsed, &pieces)?,
        None => Vec::new(),
    };
    let old_fixups = old_fixups.unwrap_or(macho.len()..macho.len());
    let map = FileOffsetMap {
        removed,
        old_linkedit,
        old_fixups_end: old_fixups.end as u64,
        growth: (fixups.len() - old_fixups.len()) as u64,
    };
    let signature = plan_signature(&map, old_signature)?;
    let linkedit = &mut pieces[parsed.linkedit][0].command;
    linkedit.filesize = signature.end as u64 - linkedit.fileoff;
    linkedit.vmsize = align_up(linkedit.filesize, CUT_ALIGNMENT);
    let headers = write_headers(macho, parsed, &pieces, &map, signature.len())?;
    Ok(Plan {
        map,
        old_symbols,
        new_ordinals,
        fixups,
        signature,
        headers,
    })
}

fn find_linkedit_blob(linkedit: &Range<u64>, offset: u32, size: usize) -> Result<Range<usize>> {
    let end = u64::from(offset) + size as u64;
    if u64::from(offset) < linkedit.start || end > linkedit.end {
        return Err(ImageError::MalformedHeaders);
    }
    Ok(offset as usize..end as usize)
}

fn plan_signature(
    map: &FileOffsetMap,
    old_signature: Option<Range<usize>>,
) -> Result<Range<usize>> {
    let old_file_size = map.old_linkedit.end;
    let Some(old_signature) = old_signature else {
        let new_file_size = map.move_linkedit_offset(old_file_size)? as usize;
        return Ok(new_file_size..new_file_size);
    };
    if old_signature.end as u64 != old_file_size {
        return Err(ImageError::MalformedHeaders);
    }
    let start = map.move_linkedit_offset(old_signature.start as u64)?;
    let size = MachoSigner::compute_signature_size(start);
    Ok(start as usize..start as usize + size)
}

fn find_removed_file_ranges(parsed: &Parsed, cuts: &[AddressRange]) -> Result<RemovedFileRanges> {
    let mut ranges = Vec::with_capacity(cuts.len());
    for cut in cuts {
        let command = parsed.segments[..parsed.linkedit]
            .iter()
            .map(|segment| &segment.command)
            .find(|command| file_backed_addresses(command).contains(*cut))
            .ok_or(ImageError::CutNotFileBacked)?;
        if cut.start.saturating_sub(parsed.image_base) < parsed.header_room_end as u64 {
            return Err(ImageError::CutHoldsHeaders);
        }
        let start = command.fileoff + (cut.start - command.vmaddr);
        ranges.push((start, start + cut.len()));
    }
    RemovedFileRanges::new(ranges)
}

fn split_segment(
    segment: &Segment,
    cuts: &[AddressRange],
    removed: &RemovedFileRanges,
) -> Result<Vec<NewSegment>> {
    let old = &segment.command;
    let addresses = vm_addresses(old);
    for section in &segment.sections {
        check_section_removal(section, cuts)?;
    }
    let mut pieces = subtract_cuts(addresses, cuts);
    if addresses.is_empty() {
        pieces.push(addresses);
    }
    let mut new_segments = Vec::with_capacity(pieces.len());
    for piece in pieces {
        let sections = split_sections(segment, piece, removed)?;
        let offset_in_segment = piece.start - old.vmaddr;
        let remaining_file_size = old.filesize.saturating_sub(offset_in_segment);
        let mut command = *old;
        command.cmdsize = (SEGMENT_COMMAND_SIZE + SECTION_SIZE * sections.len()) as u32;
        command.nsects = sections.len() as u32;
        command.vmaddr = piece.start;
        command.vmsize = piece.len();
        if !addresses.is_empty() {
            command.filesize = remaining_file_size.min(piece.len());
        }
        command.fileoff = removed.moved_floor(old.fileoff + offset_in_segment.min(old.filesize));
        new_segments.push(NewSegment { command, sections });
    }
    Ok(new_segments)
}

fn check_section_removal(section: &section_64, cuts: &[AddressRange]) -> Result<()> {
    if section.reloff != 0 || section.nreloc != 0 {
        return Err(ImageError::MalformedHeaders);
    }
    let addresses = section_addresses(section);
    let is_whole = addresses.is_empty() || subtract_cuts(addresses, cuts) == [addresses];
    if !is_whole && !can_split(section) {
        return Err(ImageError::SectionCannotBeSplit);
    }
    Ok(())
}

fn split_sections(
    segment: &Segment,
    piece: AddressRange,
    removed: &RemovedFileRanges,
) -> Result<Vec<(usize, section_64)>> {
    let mut sections = Vec::new();
    for (index, old) in segment.sections.iter().enumerate() {
        let start = old.addr.max(piece.start);
        let end = section_addresses(old).end.min(piece.end);
        if start > end || (start == end && old.size > 0) {
            continue;
        }
        let old_offset = u64::from(old.offset).saturating_add(start - old.addr);
        let mut section = *old;
        section.addr = start;
        section.size = end - start;
        section.offset = to_u32(removed.moved_floor(old_offset))?;
        sections.push((segment.first_ordinal + index, section));
    }
    Ok(sections)
}

fn number_sections(ordinal_end: usize, pieces: &[Vec<NewSegment>]) -> Result<Vec<Vec<(u64, u8)>>> {
    let mut new_sections = Vec::new();
    let mut new_ordinals = vec![Vec::new(); ordinal_end];
    for (old_ordinal, section) in pieces.iter().flatten().flat_map(|piece| &piece.sections) {
        if new_sections.len() == MAX_SECTIONS {
            return Err(ImageError::HeaderRoomExhausted);
        }
        let part = (section.addr, (new_sections.len() + 1) as u8);
        new_ordinals[*old_ordinal].push(part);
        new_sections.push(part);
    }
    for parts in new_ordinals.iter_mut().filter(|parts| parts.is_empty()) {
        parts.clone_from(&new_sections);
    }
    Ok(new_ordinals)
}

fn rebuild_fixups(old: &[u8], parsed: &Parsed, pieces: &[Vec<NewSegment>]) -> Result<Vec<u8>> {
    let old_segments: Vec<AddressRange> = parsed
        .segments
        .iter()
        .map(|segment| vm_addresses(&segment.command))
        .collect();
    let mut new_segments = Vec::new();
    for (old_index, pieces) in pieces.iter().enumerate() {
        new_segments.extend(pieces.iter().map(|piece| SegmentPiece {
            old_index,
            addresses: vm_addresses(&piece.command),
        }));
    }
    let mut new = rebuild_chained_fixups(old, parsed.image_base, &old_segments, &new_segments)?;
    let excess = new.len().saturating_sub(old.len()) as u64;
    let growth = align_up(excess, FIXUPS_GROWTH_ALIGNMENT) as usize;
    new.resize(old.len() + growth, 0);
    Ok(new)
}

impl FileOffsetMap {
    fn move_linkedit_offset(&self, offset: u64) -> Result<u64> {
        let moved = self.removed.moved(offset);
        let is_after_fixups = offset >= self.old_fixups_end;
        let growth = if is_after_fixups { self.growth } else { 0 };
        Ok(moved.ok_or(ImageError::MalformedHeaders)? + growth)
    }

    fn remap(&self, offset: u32) -> Result<u32> {
        if offset == 0 {
            return Ok(0);
        }
        find_linkedit_blob(&self.old_linkedit, offset, 0)?;
        to_u32(self.move_linkedit_offset(u64::from(offset))?)
    }
}

fn write_headers(
    macho: &[u8],
    parsed: &Parsed,
    pieces: &[Vec<NewSegment>],
    map: &FileOffsetMap,
    signature_size: usize,
) -> Result<Vec<u8>> {
    let mut header = parsed.header;
    header.ncmds = 0;
    let mut headers = vec![0; HEADER_SIZE];
    let mut remaining_segments = pieces.iter();
    for (kind, range) in &parsed.commands {
        if let CommandKind::Segment = kind {
            let pieces = remaining_segments.next().into_iter().flatten();
            for (piece_number, piece) in pieces.enumerate() {
                append_segment(&mut headers, piece, piece_number);
                header.ncmds += 1;
            }
            continue;
        }
        let start = headers.len();
        headers.extend_from_slice(&macho[range.clone()]);
        remap_command(kind, &mut headers[start..], map, signature_size)?;
        header.ncmds += 1;
    }
    if headers.len() > parsed.header_room_end {
        return Err(ImageError::HeaderRoomExhausted);
    }
    header.sizeofcmds = (headers.len() - HEADER_SIZE) as u32;
    write_struct(&mut headers, &header);
    Ok(headers)
}

fn append_segment(headers: &mut Vec<u8>, segment: &NewSegment, piece_number: usize) {
    let start = headers.len();
    headers.resize(start + segment.command.cmdsize as usize, 0);
    let (command, section_headers) = headers[start..].split_at_mut(SEGMENT_COMMAND_SIZE);
    write_struct(command, &segment.command);
    let name = create_piece_name(segment.command.seg_name(), piece_number);
    command[SEGMENT_NAME_OFFSET..][..SEGMENT_NAME_SIZE].copy_from_slice(&name);
    let section_headers = section_headers.as_chunks_mut::<SECTION_SIZE>().0.iter_mut();
    for (bytes, (_, section)) in section_headers.zip(&segment.sections) {
        write_struct(bytes, section);
    }
}

fn create_piece_name(segment_name: &[u8], piece_number: usize) -> [u8; SEGMENT_NAME_SIZE] {
    let suffix = match piece_number {
        0 => String::new(),
        _ => format!(".{piece_number}"),
    };
    let retained = segment_name.len().min(SEGMENT_NAME_SIZE - suffix.len());
    let mut name = [0; SEGMENT_NAME_SIZE];
    name[..retained].copy_from_slice(&segment_name[..retained]);
    name[retained..retained + suffix.len()].copy_from_slice(suffix.as_bytes());
    name
}

fn remap_command(
    kind: &CommandKind,
    command: &mut [u8],
    map: &FileOffsetMap,
    signature_size: usize,
) -> Result<()> {
    match kind {
        CommandKind::SymbolTable => {
            let mut table: symtab_command = read_command(command)?;
            table.symoff = map.remap(table.symoff)?;
            table.stroff = map.remap(table.stroff)?;
            write_struct(command, &table);
        }
        CommandKind::DynamicSymbolTable => {
            let mut table: dysymtab_command = read_command(command)?;
            table.tocoff = map.remap(table.tocoff)?;
            table.modtaboff = map.remap(table.modtaboff)?;
            table.extrefsymoff = map.remap(table.extrefsymoff)?;
            table.indirectsymoff = map.remap(table.indirectsymoff)?;
            table.extreloff = map.remap(table.extreloff)?;
            table.locreloff = map.remap(table.locreloff)?;
            write_struct(command, &table);
        }
        CommandKind::LinkeditData => {
            let mut data: linkedit_data_command = read_command(command)?;
            data.dataoff = map.remap(data.dataoff)?;
            if data.cmd == LC::DYLD_CHAINED_FIXUPS {
                data.datasize = to_u32(u64::from(data.datasize) + map.growth)?;
            } else if data.cmd == LC::CODE_SIGNATURE {
                data.datasize = to_u32(signature_size as u64)?;
            }
            write_struct(command, &data);
        }
        CommandKind::Segment | CommandKind::NoFileOffsets => {}
        CommandKind::DyldInfo => return Err(ImageError::UnsupportedFixups),
        CommandKind::Unknown => return Err(ImageError::UnknownLoadCommand),
    }
    Ok(())
}

fn apply_plan(macho: &mut Vec<u8>, header_room_end: usize, plan: &Plan) {
    renumber_symbols(&mut macho[plan.old_symbols.clone()], &plan.new_ordinals);
    plan.map.removed.compact(macho);
    let compacted_size = macho.len();
    let growth = plan.map.growth as usize;
    let fixups_end = plan.map.removed.moved_floor(plan.map.old_fixups_end) as usize + growth;
    macho.resize(compacted_size + growth, 0);
    macho.copy_within(fixups_end - growth..compacted_size, fixups_end);
    macho[fixups_end - plan.fixups.len()..fixups_end].copy_from_slice(&plan.fixups);
    macho.truncate(plan.signature.start);
    macho.resize(plan.signature.end, 0);
    let (headers, padding) = macho[..header_room_end].split_at_mut(plan.headers.len());
    headers.copy_from_slice(&plan.headers);
    padding.fill(0);
}

fn renumber_symbols(symbols: &mut [u8], new_ordinals: &[Vec<(u64, u8)>]) {
    for bytes in symbols.as_chunks_mut::<SYMBOL_SIZE>().0 {
        let mut symbol: nlist_64 = read_struct(bytes);
        let is_in_section = symbol.n_type & N_STAB == 0 && symbol.n_type & N_TYPE == N_SECT;
        let parts = new_ordinals.get(usize::from(symbol.n_sect));
        let Some(parts) = parts.filter(|_| is_in_section && symbol.n_sect != 0) else {
            continue;
        };
        let part = parts.iter().rfind(|part| part.0 <= symbol.n_value);
        if let Some((_, new_ordinal)) = part.or_else(|| parts.first()) {
            symbol.n_sect = *new_ordinal;
            write_struct(bytes, &symbol);
        }
    }
}

#[cfg(test)]
pub(crate) mod tests;

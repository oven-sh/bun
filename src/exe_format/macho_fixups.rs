use core::mem::{offset_of, size_of};

use crate::image::{AddressRange, ImageError};
use crate::macho_types::{
    DYLD_CHAINED_PTR_START_MULTI, DYLD_CHAINED_PTR_START_NONE, dyld_chained_fixups_header,
    dyld_chained_starts_in_segment,
};
use crate::{align_up, read_struct, write_struct};

const STARTS_IN_IMAGE_OFFSET: usize = 32;
const SEG_INFO_TABLE_OFFSET: usize = STARTS_IN_IMAGE_OFFSET + size_of::<u32>();
const PAGE_STARTS_OFFSET: usize = offset_of!(dyld_chained_starts_in_segment, first_page_start);
const PAGE_START_SIZE: usize = size_of::<u16>();

#[derive(Copy, Clone, Debug)]
pub(crate) struct SegmentPiece {
    pub(crate) old_index: usize,
    pub(crate) addresses: AddressRange,
}

#[derive(Copy, Clone)]
struct SegmentStarts<'a> {
    record: dyld_chained_starts_in_segment,
    page_starts: &'a [u8],
}

struct OldFixups<'a> {
    header: dyld_chained_fixups_header,
    segments: Vec<Option<SegmentStarts<'a>>>,
    imports: &'a [u8],
    symbols: &'a [u8],
}

pub(crate) fn rebuild_chained_fixups(
    old: &[u8],
    image_base: u64,
    old_segments: &[AddressRange],
    pieces: &[SegmentPiece],
) -> Result<Vec<u8>, ImageError> {
    let fixups = read_fixups(old, image_base, old_segments)?;
    check_pieces(old_segments, pieces)?;

    let records_offset = align_to_8(SEG_INFO_TABLE_OFFSET + size_of::<u32>() * pieces.len());
    let record_overhead = size_of::<dyld_chained_starts_in_segment>() + 8;
    let mut new = Vec::with_capacity(records_offset + record_overhead * pieces.len() + old.len());
    new.resize(records_offset, 0);
    write_struct(&mut new[STARTS_IN_IMAGE_OFFSET..], &to_u32(pieces.len())?);

    for (index, piece) in pieces.iter().enumerate() {
        let Some(starts) = fixups.segments.get(piece.old_index).copied().flatten() else {
            continue;
        };
        let segment = old_segments[piece.old_index];
        let page_starts = find_piece_page_starts(&starts, segment, piece.addresses)?;
        if page_starts.is_empty() {
            continue;
        }
        let seg_info_offset = to_u32(new.len() - STARTS_IN_IMAGE_OFFSET)?;
        let table_entry = SEG_INFO_TABLE_OFFSET + size_of::<u32>() * index;
        write_struct(&mut new[table_entry..], &seg_info_offset);
        let segment_offset = piece.addresses.start - image_base;
        append_record(&mut new, &starts.record, segment_offset, page_starts);
    }

    let imports_offset = align_to_8(new.len());
    new.resize(imports_offset, 0);
    new.extend_from_slice(fixups.imports);
    let symbols_offset = new.len();
    new.extend_from_slice(fixups.symbols);
    new.resize(align_to_8(new.len()), 0);

    let header = dyld_chained_fixups_header {
        starts_offset: to_u32(STARTS_IN_IMAGE_OFFSET)?,
        imports_offset: to_u32(imports_offset)?,
        symbols_offset: to_u32(symbols_offset)?,
        ..fixups.header
    };
    write_struct(&mut new, &header);
    Ok(new)
}

fn read_fixups<'a>(
    old: &'a [u8],
    image_base: u64,
    old_segments: &[AddressRange],
) -> Result<OldFixups<'a>, ImageError> {
    let header_size = size_of::<dyld_chained_fixups_header>();
    if old.len() < header_size {
        return Err(ImageError::UnsupportedFixups);
    }
    let header: dyld_chained_fixups_header = read_struct(old);
    let starts_offset = header.starts_offset as usize;
    let imports_offset = header.imports_offset as usize;
    let symbols_offset = header.symbols_offset as usize;
    if header.fixups_version != 0
        || starts_offset < header_size
        || !starts_offset.is_multiple_of(size_of::<u32>())
        || !fits_within(starts_offset, size_of::<u32>(), imports_offset)
        || imports_offset > symbols_offset
        || symbols_offset > old.len()
    {
        return Err(ImageError::UnsupportedFixups);
    }

    let starts_area = &old[..imports_offset];
    let seg_count = read_struct::<u32>(&starts_area[starts_offset..]) as usize;
    let table_offset = starts_offset + size_of::<u32>();
    let table_size = size_of::<u32>() * seg_count;
    if seg_count > old_segments.len() || !fits_within(table_offset, table_size, imports_offset) {
        return Err(ImageError::UnsupportedFixups);
    }

    let table = &starts_area[table_offset..][..table_size];
    let mut segments = Vec::with_capacity(seg_count);
    for (entry, segment) in table
        .as_chunks::<{ size_of::<u32>() }>()
        .0
        .iter()
        .zip(old_segments)
    {
        let seg_info_offset = read_struct::<u32>(entry) as usize;
        if seg_info_offset == 0 {
            segments.push(None);
            continue;
        }
        let at = starts_offset
            .checked_add(seg_info_offset)
            .ok_or(ImageError::UnsupportedFixups)?;
        segments.push(Some(read_segment_starts(
            starts_area,
            at,
            *segment,
            image_base,
        )?));
    }

    Ok(OldFixups {
        header,
        segments,
        imports: &old[imports_offset..symbols_offset],
        symbols: &old[symbols_offset..],
    })
}

fn read_segment_starts(
    starts_area: &[u8],
    at: usize,
    segment: AddressRange,
    image_base: u64,
) -> Result<SegmentStarts<'_>, ImageError> {
    let record_size = size_of::<dyld_chained_starts_in_segment>();
    if !fits_within(at, record_size, starts_area.len()) {
        return Err(ImageError::UnsupportedFixups);
    }
    let record: dyld_chained_starts_in_segment = read_struct(&starts_area[at..]);
    let page_starts_at = at + PAGE_STARTS_OFFSET;
    let page_starts_size = PAGE_START_SIZE * usize::from(record.page_count);
    if record.page_count == 0
        || !fits_within(page_starts_at, page_starts_size, starts_area.len())
        || !matches!(record.page_size, 0x1000 | 0x4000)
        || !segment.start.is_multiple_of(u64::from(record.page_size))
        || segment.start.checked_sub(image_base) != Some(record.segment_offset)
        || u64::from(record.page_count) > segment.len().div_ceil(u64::from(record.page_size))
    {
        return Err(ImageError::UnsupportedFixups);
    }

    let page_starts = &starts_area[page_starts_at..][..page_starts_size];
    let are_valid = page_starts
        .as_chunks::<PAGE_START_SIZE>()
        .0
        .iter()
        .all(|start| is_valid_page_start(read_struct(start), record.page_size));
    if !are_valid {
        return Err(ImageError::UnsupportedFixups);
    }
    Ok(SegmentStarts {
        record,
        page_starts,
    })
}

fn is_valid_page_start(start: u16, page_size: u16) -> bool {
    start == DYLD_CHAINED_PTR_START_NONE
        || (start & DYLD_CHAINED_PTR_START_MULTI == 0 && start < page_size)
}

fn check_pieces(old_segments: &[AddressRange], pieces: &[SegmentPiece]) -> Result<(), ImageError> {
    let mut next_free: Vec<u64> = old_segments.iter().map(|segment| segment.start).collect();
    for piece in pieces {
        let addresses = piece.addresses;
        let segment = old_segments
            .get(piece.old_index)
            .ok_or(ImageError::MalformedHeaders)?;
        if addresses.start > addresses.end
            || !segment.contains(addresses)
            || addresses.start < next_free[piece.old_index]
        {
            return Err(ImageError::MalformedHeaders);
        }
        next_free[piece.old_index] = addresses.end;
    }
    Ok(())
}

fn find_piece_page_starts<'a>(
    starts: &SegmentStarts<'a>,
    segment: AddressRange,
    piece: AddressRange,
) -> Result<&'a [u8], ImageError> {
    let page_size = u64::from(starts.record.page_size);
    let piece_offset = piece.start - segment.start;
    if !piece_offset.is_multiple_of(page_size) {
        return Err(ImageError::CutNotAligned);
    }
    let first = piece_offset / page_size;
    let end_page = (piece.end - segment.start).div_ceil(page_size);
    let last = end_page.min(u64::from(starts.record.page_count));
    if first >= last {
        return Ok(&[]);
    }

    let covered_start = PAGE_START_SIZE * first as usize;
    let covered_end = PAGE_START_SIZE * last as usize;
    let covered = &starts.page_starts[covered_start..covered_end];
    let used_pages = covered
        .as_chunks::<PAGE_START_SIZE>()
        .0
        .iter()
        .rposition(|start| read_struct::<u16>(start) != DYLD_CHAINED_PTR_START_NONE)
        .map_or(0, |last_used| last_used + 1);
    Ok(&covered[..PAGE_START_SIZE * used_pages])
}

fn append_record(
    new: &mut Vec<u8>,
    old_record: &dyld_chained_starts_in_segment,
    segment_offset: u64,
    page_starts: &[u8],
) {
    let at = new.len();
    let used_size = PAGE_STARTS_OFFSET + page_starts.len();
    let size = align_to_8(used_size);
    new.resize(at + size, 0);
    let record = dyld_chained_starts_in_segment {
        size: size as u32,
        segment_offset,
        page_count: (page_starts.len() / PAGE_START_SIZE) as u16,
        ..*old_record
    };
    write_struct(&mut new[at..], &record);
    new[at + PAGE_STARTS_OFFSET..at + used_size].copy_from_slice(page_starts);
}

fn fits_within(start: usize, size: usize, limit: usize) -> bool {
    start.checked_add(size).is_some_and(|end| end <= limit)
}

fn align_to_8(value: usize) -> usize {
    align_up(value as u64, 8) as usize
}

fn to_u32(value: usize) -> Result<u32, ImageError> {
    u32::try_from(value).map_err(|_| ImageError::UnsupportedFixups)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: u16 = DYLD_CHAINED_PTR_START_NONE;
    const IMAGE_BASE: u64 = 0x1_0000_0000;
    const SEGMENT_SPAN: u64 = 0x4_0000;
    const PAGE: u64 = 0x4000;
    const OLD_STARTS_OFFSET: usize = 28;
    const POINTER_FORMAT: u16 = 6;
    const IMPORTS: &[u8] = &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const SYMBOLS: &[u8] = b"\0_first\0_second\0";

    type Segment<'a> = Option<(u16, &'a [u16])>;

    fn blob(segments: &[Segment<'_>], imports: &[u8], symbols: &[u8]) -> Vec<u8> {
        let table = OLD_STARTS_OFFSET + 4;
        let mut bytes = vec![0; table + 4 * segments.len()];
        write_struct(&mut bytes[OLD_STARTS_OFFSET..], &(segments.len() as u32));
        for (index, segment) in segments.iter().enumerate() {
            let Some((page_size, page_starts)) = *segment else {
                continue;
            };
            bytes.resize(align_to_8(bytes.len()), 0);
            let at = bytes.len();
            let seg_info_offset = (at - OLD_STARTS_OFFSET) as u32;
            write_struct(&mut bytes[table + 4 * index..], &seg_info_offset);
            let size = align_to_8(PAGE_STARTS_OFFSET + 2 * page_starts.len());
            bytes.resize(at + size, 0);
            let record = dyld_chained_starts_in_segment {
                size: size as u32,
                page_size,
                pointer_format: POINTER_FORMAT,
                segment_offset: index as u64 * SEGMENT_SPAN,
                max_valid_pointer: 0,
                page_count: page_starts.len() as u16,
                first_page_start: 0,
            };
            write_struct(&mut bytes[at..], &record);
            for (page, start) in page_starts.iter().enumerate() {
                write_struct(&mut bytes[at + PAGE_STARTS_OFFSET + 2 * page..], start);
            }
        }
        bytes.resize(align_to_8(bytes.len()), 0);
        let imports_offset = bytes.len();
        bytes.extend_from_slice(imports);
        let symbols_offset = bytes.len();
        bytes.extend_from_slice(symbols);
        let header = dyld_chained_fixups_header {
            fixups_version: 0,
            starts_offset: OLD_STARTS_OFFSET as u32,
            imports_offset: imports_offset as u32,
            symbols_offset: symbols_offset as u32,
            imports_count: 3,
            imports_format: 1,
            symbols_format: 0,
        };
        write_struct(&mut bytes, &header);
        bytes
    }

    fn header_of(blob: &[u8]) -> dyld_chained_fixups_header {
        read_struct(blob)
    }

    fn seg_info_offset_of(blob: &[u8], index: usize) -> usize {
        let starts = header_of(blob).starts_offset as usize;
        read_struct::<u32>(&blob[starts + 4 + 4 * index..]) as usize
    }

    fn record_offset(blob: &[u8], index: usize) -> usize {
        header_of(blob).starts_offset as usize + seg_info_offset_of(blob, index)
    }

    fn starts_of(blob: &[u8]) -> Vec<Option<(u64, Vec<u16>)>> {
        let starts = header_of(blob).starts_offset as usize;
        let seg_count = read_struct::<u32>(&blob[starts..]) as usize;
        (0..seg_count)
            .map(|index| {
                if seg_info_offset_of(blob, index) == 0 {
                    return None;
                }
                let at = record_offset(blob, index);
                let record: dyld_chained_starts_in_segment = read_struct(&blob[at..]);
                let page_starts: Vec<u16> = (0..usize::from(record.page_count))
                    .map(|page| read_struct(&blob[at + PAGE_STARTS_OFFSET + 2 * page..]))
                    .collect();
                Some((record.segment_offset, page_starts))
            })
            .collect()
    }

    fn imports_of(blob: &[u8]) -> &[u8] {
        let header = header_of(blob);
        &blob[header.imports_offset as usize..header.symbols_offset as usize]
    }

    fn symbols_of(blob: &[u8]) -> &[u8] {
        &blob[header_of(blob).symbols_offset as usize..][..SYMBOLS.len()]
    }

    fn segments(count: usize) -> Vec<AddressRange> {
        (0..count as u64)
            .map(|index| AddressRange {
                start: IMAGE_BASE + index * SEGMENT_SPAN,
                end: IMAGE_BASE + (index + 1) * SEGMENT_SPAN,
            })
            .collect()
    }

    fn whole_pieces(segments: &[AddressRange]) -> Vec<SegmentPiece> {
        segments
            .iter()
            .enumerate()
            .map(|(old_index, addresses)| SegmentPiece {
                old_index,
                addresses: *addresses,
            })
            .collect()
    }

    fn piece(old_index: usize, start_offset: u64, end_offset: u64) -> SegmentPiece {
        let segment_start = IMAGE_BASE + old_index as u64 * SEGMENT_SPAN;
        SegmentPiece {
            old_index,
            addresses: AddressRange {
                start: segment_start + start_offset,
                end: segment_start + end_offset,
            },
        }
    }

    fn rebuild(old: &[u8], count: usize, pieces: &[SegmentPiece]) -> Result<Vec<u8>, ImageError> {
        rebuild_chained_fixups(old, IMAGE_BASE, &segments(count), pieces)
    }

    fn rebuild_whole(old: &[u8], count: usize) -> Result<Vec<u8>, ImageError> {
        rebuild(old, count, &whole_pieces(&segments(count)))
    }

    fn one_segment_blob(page_size: u16, page_starts: &[u16]) -> Vec<u8> {
        blob(&[Some((page_size, page_starts))], IMPORTS, SYMBOLS)
    }

    fn edit_header(blob: &mut [u8], edit: impl FnOnce(&mut dyld_chained_fixups_header)) {
        let mut header = header_of(blob);
        edit(&mut header);
        write_struct(blob, &header);
    }

    #[test]
    fn identity() {
        let page_starts: &[u16] = &[0, NONE, 8, 16, NONE, 24, 0, 32];
        let old = blob(
            &[None, None, Some((0x4000, page_starts)), None],
            IMPORTS,
            SYMBOLS,
        );
        let new = rebuild_whole(&old, 4).unwrap();

        assert_eq!(starts_of(&new), starts_of(&old));
        assert_eq!(imports_of(&new), IMPORTS);
        assert_eq!(symbols_of(&new), SYMBOLS);
        assert_eq!(new.len() % 8, 0);

        let header = header_of(&new);
        assert_eq!(header.starts_offset, 32);
        assert_eq!(header.fixups_version, 0);
        assert_eq!(header.imports_count, 3);
        assert_eq!(header.imports_format, 1);
        assert_eq!(header.symbols_format, 0);

        let record: dyld_chained_starts_in_segment = read_struct(&new[record_offset(&new, 2)..]);
        assert_eq!(record.size, 40);
        assert_eq!(record.page_size, 0x4000);
        assert_eq!(record.pointer_format, POINTER_FORMAT);
    }

    #[test]
    fn split_takes_page_starts_of_each_piece() {
        let page_starts: &[u16] = &[0, NONE, 8, 16, NONE, 24, NONE, NONE];
        let old = blob(
            &[None, None, Some((0x4000, page_starts)), None],
            IMPORTS,
            SYMBOLS,
        );
        let pieces = [
            piece(0, 0, SEGMENT_SPAN),
            piece(1, 0, SEGMENT_SPAN),
            piece(2, 0, 2 * PAGE),
            piece(2, 4 * PAGE, 8 * PAGE),
            piece(3, 0, SEGMENT_SPAN),
        ];
        let new = rebuild(&old, 4, &pieces).unwrap();

        let segment_offset = 2 * SEGMENT_SPAN;
        assert_eq!(
            starts_of(&new),
            vec![
                None,
                None,
                Some((segment_offset, vec![0])),
                Some((segment_offset + 4 * PAGE, vec![NONE, 24])),
                None,
            ]
        );
        assert_eq!(imports_of(&new), IMPORTS);
        assert_eq!(symbols_of(&new), SYMBOLS);
    }

    #[test]
    fn piece_without_page_starts_has_no_record() {
        let old = one_segment_blob(0x4000, &[8, NONE, NONE, 16]);
        let pieces = [
            piece(0, 0, PAGE),
            piece(0, 2 * PAGE, 3 * PAGE),
            piece(0, 6 * PAGE, 8 * PAGE),
        ];
        let new = rebuild(&old, 1, &pieces).unwrap();
        assert_eq!(starts_of(&new), vec![Some((0, vec![8])), None, None]);
    }

    #[test]
    fn split_without_fixups_lengthens_table() {
        let page_starts: &[u16] = &[0, 8];
        let old = blob(&[None, Some((0x4000, page_starts))], IMPORTS, SYMBOLS);
        let mut pieces: Vec<SegmentPiece> = (0..60)
            .map(|index| piece(0, index * 0x1000, (index + 1) * 0x1000))
            .collect();
        pieces.push(piece(1, 0, SEGMENT_SPAN));
        let new = rebuild(&old, 2, &pieces).unwrap();

        assert!(new.len() > old.len());
        let starts = starts_of(&new);
        assert_eq!(starts.len(), 61);
        assert!(starts[..60].iter().all(Option::is_none));
        assert_eq!(starts[60], Some((SEGMENT_SPAN, vec![0, 8])));

        let imports_offset = header_of(&new).imports_offset as usize;
        let record_at = record_offset(&new, 60);
        let record: dyld_chained_starts_in_segment = read_struct(&new[record_at..]);
        assert_eq!(imports_offset % 8, 0);
        assert!(imports_offset >= record_at + record.size as usize);
        assert_eq!(imports_of(&new), IMPORTS);
        assert_eq!(symbols_of(&new), SYMBOLS);
    }

    #[test]
    fn small_pages_with_large_cuts() {
        let old = one_segment_blob(0x1000, &[0, 8, NONE, NONE, NONE, 16, 24, 32]);
        let pieces = [piece(0, 0, 0x4000), piece(0, 0x4000, 0x8000)];
        let new = rebuild(&old, 1, &pieces).unwrap();
        assert_eq!(
            starts_of(&new),
            vec![
                Some((0, vec![0, 8])),
                Some((0x4000, vec![NONE, 16, 24, 32]))
            ]
        );
    }

    #[test]
    fn segment_past_seg_count_has_no_fixups() {
        let page_starts: &[u16] = &[0];
        let old = blob(&[None, Some((0x4000, page_starts)), None], IMPORTS, SYMBOLS);
        let new = rebuild_whole(&old, 4).unwrap();
        assert_eq!(
            starts_of(&new),
            vec![None, Some((SEGMENT_SPAN, vec![0])), None, None]
        );
    }

    #[test]
    fn rejects_short_blob() {
        let old = one_segment_blob(0x4000, &[0]);
        assert_eq!(
            rebuild_whole(&old[..27], 1),
            Err(ImageError::UnsupportedFixups)
        );
    }

    #[test]
    fn rejects_bad_header() {
        let edits: [fn(&mut dyld_chained_fixups_header, u32); 6] = [
            |header, _| header.fixups_version = 1,
            |header, _| header.starts_offset = 24,
            |header, _| header.imports_offset = header.starts_offset - 4,
            |header, _| header.imports_offset = header.starts_offset + 4,
            |header, _| header.symbols_offset = header.imports_offset - 4,
            |header, len| header.symbols_offset = len + 1,
        ];
        for edit in edits {
            let mut old = one_segment_blob(0x4000, &[0]);
            let len = old.len() as u32;
            edit_header(&mut old, |header| edit(header, len));
            assert_eq!(rebuild_whole(&old, 1), Err(ImageError::UnsupportedFixups));
        }
    }

    #[test]
    fn rejects_unaligned_starts_offset() {
        let mut old = one_segment_blob(0x4000, &[0]);
        old.splice(OLD_STARTS_OFFSET..OLD_STARTS_OFFSET, [0, 0]);
        edit_header(&mut old, |header| {
            header.starts_offset += 2;
            header.imports_offset += 2;
            header.symbols_offset += 2;
        });
        assert_eq!(rebuild_whole(&old, 1), Err(ImageError::UnsupportedFixups));
    }

    #[test]
    fn rejects_seg_count_above_segments() {
        let old = blob(&[None, None], IMPORTS, SYMBOLS);
        assert_eq!(rebuild_whole(&old, 1), Err(ImageError::UnsupportedFixups));
    }

    #[test]
    fn rejects_record_overlapping_imports() {
        for record_bytes_left in [16, 24] {
            let mut old = one_segment_blob(0x4000, &[0, 8, 16, 24]);
            let imports_offset = (record_offset(&old, 0) + record_bytes_left) as u32;
            edit_header(&mut old, |header| header.imports_offset = imports_offset);
            assert_eq!(rebuild_whole(&old, 1), Err(ImageError::UnsupportedFixups));
        }
    }

    #[test]
    fn rejects_bad_page_count() {
        let segment_pages = (SEGMENT_SPAN / PAGE) as usize;
        for page_count in [0, segment_pages + 1] {
            let old = one_segment_blob(0x4000, &vec![0; page_count]);
            assert_eq!(rebuild_whole(&old, 1), Err(ImageError::UnsupportedFixups));
        }
    }

    #[test]
    fn rejects_bad_page_size() {
        let old = one_segment_blob(0x2000, &[0]);
        assert_eq!(rebuild_whole(&old, 1), Err(ImageError::UnsupportedFixups));
    }

    #[test]
    fn rejects_wrong_segment_offset() {
        let mut old = one_segment_blob(0x4000, &[0]);
        let at = record_offset(&old, 0);
        let mut record: dyld_chained_starts_in_segment = read_struct(&old[at..]);
        record.segment_offset += PAGE;
        write_struct(&mut old[at..], &record);
        assert_eq!(rebuild_whole(&old, 1), Err(ImageError::UnsupportedFixups));
    }

    #[test]
    fn rejects_bad_page_starts() {
        for start in [DYLD_CHAINED_PTR_START_MULTI | 8, 0x4000] {
            let old = one_segment_blob(0x4000, &[start]);
            assert_eq!(rebuild_whole(&old, 1), Err(ImageError::UnsupportedFixups));
        }
    }

    #[test]
    fn rejects_unaligned_piece() {
        let old = one_segment_blob(0x4000, &[0, 8]);
        let pieces = [piece(0, 0x800, 2 * PAGE)];
        assert_eq!(rebuild(&old, 1, &pieces), Err(ImageError::CutNotAligned));
    }

    #[test]
    fn rejects_malformed_pieces() {
        let old = one_segment_blob(0x4000, &[0, 8]);
        let outside = [piece(0, 0, SEGMENT_SPAN + PAGE)];
        let overlapping = [piece(0, 0, 2 * PAGE), piece(0, PAGE, 3 * PAGE)];
        let unknown_segment = [piece(1, 0, PAGE)];
        let inverted = [piece(0, PAGE, 0)];
        assert_eq!(
            rebuild(&old, 1, &outside),
            Err(ImageError::MalformedHeaders)
        );
        assert_eq!(
            rebuild(&old, 1, &overlapping),
            Err(ImageError::MalformedHeaders)
        );
        assert_eq!(
            rebuild(&old, 1, &unknown_segment),
            Err(ImageError::MalformedHeaders)
        );
        assert_eq!(
            rebuild(&old, 1, &inverted),
            Err(ImageError::MalformedHeaders)
        );
    }
}

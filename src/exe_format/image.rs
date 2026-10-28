use crate::builtins::Image;
use crate::cut_model::CutModel;
use crate::elf_program_headers::read_header;
use crate::macho_types::MH_MAGIC_64;
use crate::section::find_known_section;
use crate::{Error, elf_ranges, macho_ranges, pe_ranges};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct AddressRange {
    pub start: u64,
    pub end: u64,
}

impl AddressRange {
    pub(crate) fn from_size(start: u64, size: u64) -> Result<AddressRange, ImageError> {
        let end = start
            .checked_add(size)
            .ok_or(ImageError::MalformedHeaders)?;
        Ok(AddressRange { start, end })
    }

    pub fn len(self) -> u64 {
        self.end.saturating_sub(self.start)
    }

    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    pub fn contains(self, other: AddressRange) -> bool {
        self.start <= other.start && other.end <= self.end
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ExecutableFormat {
    Elf,
    MachO,
    Pe,
}

impl ExecutableFormat {
    pub(crate) const MAGIC_SIZE: usize = 4;

    pub(crate) fn from_magic(magic: &[u8]) -> Option<ExecutableFormat> {
        if magic.starts_with(b"\x7fELF") {
            Some(ExecutableFormat::Elf)
        } else if magic.starts_with(&MH_MAGIC_64.to_le_bytes()) {
            Some(ExecutableFormat::MachO)
        } else if magic.starts_with(b"MZ") {
            Some(ExecutableFormat::Pe)
        } else {
            None
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Architecture {
    X86_64,
    Aarch64,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KnownSection {
    Payload,
    BuiltinModules,
    TrimTable,
    RemovableFeatureState,
    BuildId,
    RuntimeDescription,
}

#[derive(Copy, Clone)]
pub(crate) struct SectionNames {
    pub(crate) elf: &'static [u8],
    pub(crate) macho_segment: &'static [u8],
    pub(crate) macho_section: &'static [u8],
    pub(crate) pe: [u8; 8],
}

impl KnownSection {
    pub(crate) const fn names(self) -> SectionNames {
        match self {
            KnownSection::Payload => SectionNames {
                elf: b".bun",
                macho_segment: b"__BUN",
                macho_section: b"__bun",
                pe: *b".bun\0\0\0\0",
            },
            KnownSection::BuiltinModules => SectionNames {
                elf: b".bun_builtins",
                macho_segment: b"__TEXT",
                macho_section: b"__bun_builtins",
                pe: *b".bunblt\0",
            },
            KnownSection::TrimTable => SectionNames {
                elf: b".bun_trim",
                macho_segment: b"__TEXT",
                macho_section: b"__bun_trim",
                pe: *b".buntrim",
            },
            KnownSection::RemovableFeatureState => SectionNames {
                elf: b".bun_features",
                macho_segment: b"__TEXT",
                macho_section: b"__bun_features",
                pe: *b".bunfeat",
            },
            KnownSection::BuildId => SectionNames {
                elf: b".note.bun.build-id",
                macho_segment: b"__TEXT",
                macho_section: b"__bun_build_id",
                pe: *b".bunid\0\0",
            },
            KnownSection::RuntimeDescription => SectionNames {
                elf: b".bun_aot",
                macho_segment: b"__TEXT",
                macho_section: b"__bun_aot",
                pe: *b".bunaot\0",
            },
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SectionLocation {
    pub address: u64,
    pub file_offset: u64,
    pub size: u64,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct MappedSpan {
    pub(crate) addresses: AddressRange,
    pub(crate) file_offset: u64,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum ImageError {
    #[error("UnrecognizedExecutable")]
    UnrecognizedExecutable,
    #[error("MalformedHeaders")]
    MalformedHeaders,
    #[error("CutsNotSorted")]
    CutsNotSorted,
    #[error("CutNotAligned")]
    CutNotAligned,
    #[error("TooManyCuts")]
    TooManyCuts,
    #[error("CutNotFileBacked")]
    CutNotFileBacked,
    #[error("CutInWritableSegment")]
    CutInWritableSegment,
    #[error("CutHoldsHeaders")]
    CutHoldsHeaders,
    #[error("SectionCannotBeSplit")]
    SectionCannotBeSplit,
    #[error("UnknownLoadCommand")]
    UnknownLoadCommand,
    #[error("UnsupportedFixups")]
    UnsupportedFixups,
    #[error("HeaderRoomExhausted")]
    HeaderRoomExhausted,
}

pub(crate) fn merge_ranges(mut ranges: Vec<AddressRange>) -> Vec<AddressRange> {
    ranges.retain(|range| !range.is_empty());
    ranges.sort_unstable_by_key(|range| range.start);
    ranges.dedup_by(|next, previous| {
        let is_joined = next.start <= previous.end;
        if is_joined {
            previous.end = previous.end.max(next.end);
        }
        is_joined
    });
    ranges
}

pub(crate) fn subtract_cuts(range: AddressRange, cuts: &[AddressRange]) -> Vec<AddressRange> {
    let mut parts = Vec::new();
    let mut start = range.start;
    let first_cut = cuts.partition_point(|cut| cut.end <= range.start);
    for cut in &cuts[first_cut..] {
        if cut.start >= range.end {
            break;
        }
        if start < cut.start {
            let end = cut.start;
            parts.push(AddressRange { start, end });
        }
        start = cut.end;
    }
    if start < range.end {
        let end = range.end;
        parts.push(AddressRange { start, end });
    }
    parts
}

pub(crate) struct RemovedFileRanges {
    ranges: Vec<(u64, u64)>,
    removed_before: Vec<u64>,
}

impl RemovedFileRanges {
    pub(crate) fn new(ranges: Vec<(u64, u64)>) -> Result<RemovedFileRanges, ImageError> {
        let mut removed_before = Vec::with_capacity(ranges.len() + 1);
        let mut removed = 0;
        let mut previous_end = 0;
        for &(start, end) in &ranges {
            if start < previous_end || start >= end {
                return Err(ImageError::MalformedHeaders);
            }
            removed_before.push(removed);
            removed += end - start;
            previous_end = end;
        }
        removed_before.push(removed);
        Ok(RemovedFileRanges {
            ranges,
            removed_before,
        })
    }

    pub(crate) fn moved(&self, offset: u64) -> Option<u64> {
        let index = self.first_range_ending_after(offset);
        match self.ranges.get(index) {
            Some(&(start, _)) if start <= offset => None,
            _ => Some(offset - self.removed_before[index]),
        }
    }

    pub(crate) fn moved_floor(&self, offset: u64) -> u64 {
        let index = self.first_range_ending_after(offset);
        let retained_offset = match self.ranges.get(index) {
            Some(&(start, _)) => offset.min(start),
            None => offset,
        };
        retained_offset - self.removed_before[index]
    }

    pub(crate) fn intersects(&self, start: u64, end: u64) -> bool {
        let index = self.first_range_ending_after(start);
        match self.ranges.get(index) {
            Some(&(range_start, _)) => start < end && range_start < end,
            None => false,
        }
    }

    pub(crate) fn compact(&self, bytes: &mut dyn ImageBytes) {
        let Some(&(first_start, _)) = self.ranges.first() else {
            return;
        };
        let len = bytes.len();
        let clamp = |offset: u64| offset.min(len as u64) as usize;
        let retained_ends = self.ranges[1..]
            .iter()
            .map(|&(start, _)| clamp(start))
            .chain([len]);
        let mut write_offset = clamp(first_start);
        for (&(_, end), retained_end) in self.ranges.iter().zip(retained_ends) {
            let retained = clamp(end)..retained_end;
            let retained_len = retained.len();
            bytes.move_down(retained, write_offset);
            write_offset += retained_len;
        }
        bytes.truncate(write_offset);
    }

    fn first_range_ending_after(&self, offset: u64) -> usize {
        self.ranges.partition_point(|&(_, end)| end <= offset)
    }
}

pub fn read_bytes_at(bytes: &[u8], offset: usize, out: &mut [u8]) -> bool {
    let Some(source) = bytes.get(offset..).and_then(|tail| tail.get(..out.len())) else {
        return false;
    };
    out.copy_from_slice(source);
    true
}

fn check_spans(spans: &[MappedSpan], file_size: usize) -> Result<(), ImageError> {
    let mut previous_end = 0;
    for span in spans {
        let AddressRange { start, end } = span.addresses;
        let is_in_file = span
            .file_offset
            .checked_add(span.addresses.len())
            .is_some_and(|file_end| file_end <= file_size as u64);
        if start < previous_end || start > end || !is_in_file {
            return Err(ImageError::MalformedHeaders);
        }
        previous_end = end;
    }
    Ok(())
}

fn read_mapped_spans(format: ExecutableFormat, bytes: &[u8]) -> Result<Vec<MappedSpan>, Error> {
    let spans = match format {
        ExecutableFormat::Elf => elf_ranges::mapped_spans(bytes)?,
        ExecutableFormat::MachO => macho_ranges::mapped_spans(bytes)?,
        ExecutableFormat::Pe => pe_ranges::mapped_spans(bytes)?,
    };
    check_spans(&spans, bytes.len())?;
    Ok(spans)
}

fn find_span(spans: &[MappedSpan], range: AddressRange) -> Option<MappedSpan> {
    if range.start > range.end {
        return None;
    }
    let index = spans.partition_point(|span| span.addresses.end <= range.start);
    let span = *spans.get(index)?;
    span.addresses.contains(range).then_some(span)
}

/// The bytes of an executable while it is edited: a vector, or a private mapping of the file.
pub trait ImageBytes: core::ops::DerefMut<Target = [u8]> {
    /// Moves the bytes at `source` to `target`, which is below `source.start`. Until `truncate`, nothing reads what the move leaves behind.
    fn move_down(&mut self, source: core::ops::Range<usize>, target: usize);
    fn truncate(&mut self, len: usize);
    /// The bytes that are added are zero. `len` is at most the first length.
    fn grow(&mut self, len: usize);
    fn as_vec(&mut self) -> Option<&mut Vec<u8>>;
}

impl ImageBytes for Vec<u8> {
    fn move_down(&mut self, source: core::ops::Range<usize>, target: usize) {
        self.copy_within(source, target);
    }

    fn truncate(&mut self, len: usize) {
        Vec::truncate(self, len);
    }

    fn grow(&mut self, len: usize) {
        self.resize(len, 0);
    }

    fn as_vec(&mut self) -> Option<&mut Vec<u8>> {
        Some(self)
    }
}

pub struct ImageEditor<'a> {
    bytes: &'a mut dyn ImageBytes,
    format: ExecutableFormat,
    architecture: Architecture,
    spans: Vec<MappedSpan>,
}

impl<'a> ImageEditor<'a> {
    pub fn open(bytes: &'a mut dyn ImageBytes) -> Result<ImageEditor<'a>, Error> {
        let format = match ExecutableFormat::from_magic(bytes) {
            Some(format) if bytes.len() >= ExecutableFormat::MAGIC_SIZE => format,
            _ => return Err(ImageError::UnrecognizedExecutable.into()),
        };
        let architecture = match format {
            ExecutableFormat::Elf => elf_ranges::architecture(&read_header(bytes)?)?,
            ExecutableFormat::MachO => macho_ranges::architecture(bytes)?,
            ExecutableFormat::Pe => pe_ranges::architecture(bytes)?,
        };
        let spans = read_mapped_spans(format, bytes)?;
        Ok(ImageEditor {
            bytes,
            format,
            architecture,
            spans,
        })
    }

    pub fn format(&self) -> ExecutableFormat {
        self.format
    }

    pub fn architecture(&self) -> Architecture {
        self.architecture
    }

    pub fn find_section(&self, section: KnownSection) -> Option<SectionLocation> {
        let bytes: &[u8] = &**self.bytes;
        let mut read = |offset: usize, out: &mut [u8]| read_bytes_at(bytes, offset, out);
        let mut file = Image {
            len: bytes.len(),
            read: &mut read,
        };
        find_known_section(&mut file, section).ok()
    }

    pub fn bytes_at_mut(&mut self, range: AddressRange) -> Option<&mut [u8]> {
        let span = find_span(&self.spans, range)?;
        let file_start = span.file_offset + (range.start - span.addresses.start);
        let file_end = file_start + range.len();
        self.bytes.get_mut(file_start as usize..file_end as usize)
    }

    /// What an earlier cut has left of `range`, ascending.
    pub fn file_backed_parts(&self, range: AddressRange) -> Vec<AddressRange> {
        self.spans
            .iter()
            .map(|span| AddressRange {
                start: range.start.max(span.addresses.start),
                end: range.end.min(span.addresses.end),
            })
            .filter(|part| part.start < part.end)
            .collect()
    }

    pub fn cut_model(&self) -> CutModel {
        let bytes: &[u8] = &**self.bytes;
        match self.format {
            ExecutableFormat::Elf => elf_ranges::cut_model(bytes),
            ExecutableFormat::MachO => macho_ranges::cut_model(bytes),
            ExecutableFormat::Pe => pe_ranges::cut_model(bytes),
        }
    }

    /// Drops the load-time relocations whose target is in `ranges`. Returns the number dropped.
    pub fn remove_relocations_in(&mut self, ranges: &[AddressRange]) -> Result<u64, Error> {
        match self.format {
            ExecutableFormat::Elf => Ok(crate::elf_relocations::remove_relative_relocations(
                self.bytes,
                &merge_ranges(ranges.to_vec()),
            )?),
            ExecutableFormat::MachO | ExecutableFormat::Pe => Ok(0),
        }
    }

    pub fn remove_ranges(&mut self, cuts: &[AddressRange]) -> Result<u64, Error> {
        if cuts.is_empty() {
            return Ok(0);
        }
        self.check_cuts(cuts)?;
        let old_len = self.bytes.len();
        match self.format {
            ExecutableFormat::Elf => elf_ranges::remove_ranges(self.bytes, cuts)?,
            ExecutableFormat::MachO => macho_ranges::remove_ranges(self.vector()?, cuts)?,
            ExecutableFormat::Pe => pe_ranges::remove_ranges(self.vector()?, cuts)?,
        }
        self.spans = read_mapped_spans(self.format, self.bytes)?;
        Ok(old_len.saturating_sub(self.bytes.len()) as u64)
    }

    fn vector(&mut self) -> Result<&mut Vec<u8>, ImageError> {
        self.bytes
            .as_vec()
            .ok_or(ImageError::UnrecognizedExecutable)
    }

    fn check_cuts(&self, cuts: &[AddressRange]) -> Result<(), ImageError> {
        let is_sorted = cuts.iter().all(|cut| cut.start < cut.end)
            && cuts.is_sorted_by(|previous, next| previous.end <= next.start);
        if !is_sorted {
            return Err(ImageError::CutsNotSorted);
        }
        let model = self.cut_model();
        let is_aligned = |cut: &AddressRange| {
            cut.start.is_multiple_of(model.alignment) && cut.end.is_multiple_of(model.alignment)
        };
        if !cuts.iter().all(is_aligned) {
            return Err(ImageError::CutNotAligned);
        }
        if cuts.len() > model.max_cuts() {
            return Err(ImageError::TooManyCuts);
        }
        let is_file_backed = |cut: &AddressRange| find_span(&self.spans, *cut).is_some();
        if !cuts.iter().all(is_file_backed) {
            return Err(ImageError::CutNotFileBacked);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use bun_sys::elf::PT_LOAD;

    use super::*;
    use crate::builtins::u32_at;
    use crate::cut_model::RemovableBytes;
    use crate::elf_program_headers::ProgramHeaderTable;
    use crate::elf_ranges::tests::toy_elf;
    use crate::macho_ranges::tests::toy_macho;
    use crate::pe_ranges::tests::toy_pe;

    const ARCHITECTURES: [Architecture; 2] = [Architecture::X86_64, Architecture::Aarch64];
    const KNOWN_SECTIONS: [KnownSection; 4] = [
        KnownSection::Payload,
        KnownSection::BuiltinModules,
        KnownSection::TrimTable,
        KnownSection::RemovableFeatureState,
    ];

    struct ToyFile {
        format: ExecutableFormat,
        architecture: Architecture,
        bytes: Vec<u8>,
    }

    fn toy_files() -> Vec<ToyFile> {
        let mut files = Vec::new();
        for architecture in ARCHITECTURES {
            let formats = [
                (ExecutableFormat::Elf, toy_elf(architecture, true)),
                (ExecutableFormat::MachO, toy_macho(architecture)),
                (ExecutableFormat::Pe, toy_pe(architecture)),
            ];
            for (format, bytes) in formats {
                files.push(ToyFile {
                    format,
                    architecture,
                    bytes,
                });
            }
        }
        files
    }

    fn range(start: u64, end: u64) -> AddressRange {
        AddressRange { start, end }
    }

    fn ranges(pairs: &[(u64, u64)]) -> Vec<AddressRange> {
        pairs
            .iter()
            .map(|&(start, end)| range(start, end))
            .collect()
    }

    fn cut_model_of(toy: &ToyFile) -> CutModel {
        let mut bytes = toy.bytes.clone();
        ImageEditor::open(&mut bytes).unwrap().cut_model()
    }

    fn read(editor: &mut ImageEditor<'_>, addresses: AddressRange) -> Option<Vec<u8>> {
        editor.bytes_at_mut(addresses).map(|bytes| bytes.to_vec())
    }

    fn file_bytes(file: &[u8], span: MappedSpan, addresses: AddressRange) -> Vec<u8> {
        let offset = span.file_offset + (addresses.start - span.addresses.start);
        file[offset as usize..][..addresses.len() as usize].to_vec()
    }

    fn assert_unrecognized(mut bytes: Vec<u8>) {
        let result = ImageEditor::open(&mut bytes);
        let expected = ImageError::UnrecognizedExecutable;
        assert!(matches!(result, Err(Error::Image(error)) if error == expected));
    }

    fn assert_cuts_rejected(toy: &ToyFile, cuts: &[AddressRange], expected: ImageError) {
        let mut bytes = toy.bytes.clone();
        let result = ImageEditor::open(&mut bytes).unwrap().remove_ranges(cuts);
        assert!(
            matches!(result, Err(Error::Image(error)) if error == expected),
            "{:?} {:?}: expected {expected:?}, got {result:?}",
            toy.format,
            toy.architecture,
        );
        assert_eq!(bytes, toy.bytes);
    }

    #[test]
    fn address_range_len_and_contains() {
        assert_eq!(range(8, 24).len(), 16);
        assert_eq!(range(24, 8).len(), 0);
        assert!(range(8, 8).is_empty());
        assert!(range(24, 8).is_empty());
        assert!(!range(8, 9).is_empty());
        assert!(range(8, 24).contains(range(8, 24)));
        assert!(range(8, 24).contains(range(16, 16)));
        assert!(!range(8, 24).contains(range(7, 24)));
        assert!(!range(8, 24).contains(range(8, 25)));
    }

    #[test]
    fn address_range_from_size_rejects_overflow() {
        assert_eq!(AddressRange::from_size(8, 16), Ok(range(8, 24)));
        assert_eq!(
            AddressRange::from_size(u64::MAX, 0),
            Ok(range(u64::MAX, u64::MAX))
        );
        let overflow = AddressRange::from_size(u64::MAX, 1);
        assert_eq!(overflow, Err(ImageError::MalformedHeaders));
    }

    #[test]
    fn merge_ranges_sorts_and_joins() {
        assert!(merge_ranges(Vec::new()).is_empty());
        assert!(merge_ranges(ranges(&[(8, 8), (24, 16)])).is_empty());
        assert_eq!(
            merge_ranges(ranges(&[(40, 48), (0, 8), (16, 24)])),
            ranges(&[(0, 8), (16, 24), (40, 48)])
        );
        assert_eq!(
            merge_ranges(ranges(&[(20, 32), (8, 12), (16, 24), (0, 8)])),
            ranges(&[(0, 12), (16, 32)])
        );
        assert_eq!(
            merge_ranges(ranges(&[(44, 48), (40, 64), (52, 52), (40, 44)])),
            ranges(&[(40, 64)])
        );
    }

    #[test]
    fn subtract_cuts_returns_parts_outside_cuts() {
        let whole = range(100, 200);
        assert_eq!(subtract_cuts(whole, &[]), [whole]);
        assert_eq!(
            subtract_cuts(whole, &ranges(&[(120, 140)])),
            ranges(&[(100, 120), (140, 200)])
        );
        assert_eq!(
            subtract_cuts(whole, &ranges(&[(100, 110), (150, 160), (190, 200)])),
            ranges(&[(110, 150), (160, 190)])
        );
        assert_eq!(
            subtract_cuts(whole, &ranges(&[(110, 120), (120, 130)])),
            ranges(&[(100, 110), (130, 200)])
        );
        assert_eq!(
            subtract_cuts(whole, &ranges(&[(50, 110), (190, 250)])),
            ranges(&[(110, 190)])
        );
    }

    #[test]
    fn subtract_cuts_ignores_cuts_outside_range() {
        let whole = range(100, 200);
        let outside = ranges(&[(0, 50), (50, 100), (200, 300)]);
        assert_eq!(subtract_cuts(whole, &outside), [whole]);
        assert!(subtract_cuts(whole, &[whole]).is_empty());
        assert!(subtract_cuts(whole, &[range(0, 300)]).is_empty());
        assert!(subtract_cuts(range(100, 100), &[]).is_empty());
        assert!(subtract_cuts(range(100, 100), &[range(50, 150)]).is_empty());
    }

    #[test]
    fn removed_file_ranges_rejects_unordered_ranges() {
        for file_ranges in [
            vec![(16, 16)],
            vec![(16, 8)],
            vec![(32, 48), (0, 16)],
            vec![(0, 16), (8, 24)],
        ] {
            let result = RemovedFileRanges::new(file_ranges);
            assert_eq!(result.err(), Some(ImageError::MalformedHeaders));
        }
        assert!(RemovedFileRanges::new(Vec::new()).is_ok());
        assert!(RemovedFileRanges::new(vec![(0, 16), (16, 24)]).is_ok());
    }

    #[test]
    fn removed_file_ranges_moves_retained_offsets() {
        let removed = RemovedFileRanges::new(vec![(16, 32), (64, 72)]).unwrap();
        let moved = [
            (0, Some(0), 0),
            (15, Some(15), 15),
            (16, None, 16),
            (31, None, 16),
            (32, Some(16), 16),
            (63, Some(47), 47),
            (64, None, 48),
            (71, None, 48),
            (72, Some(48), 48),
            (1000, Some(976), 976),
        ];
        for (offset, expected, expected_floor) in moved {
            assert_eq!(removed.moved(offset), expected, "offset {offset}");
            assert_eq!(
                removed.moved_floor(offset),
                expected_floor,
                "offset {offset}"
            );
        }

        let nothing_removed = RemovedFileRanges::new(Vec::new()).unwrap();
        assert_eq!(nothing_removed.moved(40), Some(40));
        assert_eq!(nothing_removed.moved_floor(40), 40);
    }

    #[test]
    fn removed_file_ranges_intersects() {
        let removed = RemovedFileRanges::new(vec![(16, 32), (64, 72)]).unwrap();
        for (start, end) in [(0, 17), (31, 40), (20, 24), (0, 100), (40, 65), (16, 32)] {
            assert!(removed.intersects(start, end), "{start}..{end}");
        }
        for (start, end) in [(0, 16), (32, 64), (72, 100), (20, 20), (24, 20), (64, 64)] {
            assert!(!removed.intersects(start, end), "{start}..{end}");
        }
    }

    #[test]
    fn removed_file_ranges_compacts_bytes() {
        let original: Vec<u8> = (0..100).collect();
        let removed = RemovedFileRanges::new(vec![(16, 32), (64, 72), (90, 100)]).unwrap();
        let mut bytes = original.clone();
        removed.compact(&mut bytes);
        let expected: Vec<u8> = (0..16).chain(32..64).chain(72..90).collect();
        assert_eq!(bytes, expected);
        for offset in 0..100 {
            if let Some(moved) = removed.moved(offset) {
                assert_eq!(bytes[moved as usize], original[offset as usize]);
            }
        }

        let mut unchanged = original.clone();
        let nothing_removed = RemovedFileRanges::new(Vec::new()).unwrap();
        nothing_removed.compact(&mut unchanged);
        assert_eq!(unchanged, original);

        let mut short = original[..20].to_vec();
        removed.compact(&mut short);
        assert_eq!(short, original[..16]);
    }

    #[test]
    fn check_spans_rejects_malformed_spans() {
        let span = |start: u64, end: u64, file_offset: u64| MappedSpan {
            addresses: range(start, end),
            file_offset,
        };
        assert_eq!(check_spans(&[], 0), Ok(()));
        let adjacent = [span(0x1000, 0x2000, 0), span(0x2000, 0x2800, 0x1000)];
        assert_eq!(check_spans(&adjacent, 0x1800), Ok(()));
        for spans in [
            vec![span(0x1000, 0x2000, 0), span(0x1fff, 0x2800, 0x1000)],
            vec![span(0x2000, 0x2800, 0x1000), span(0x1000, 0x2000, 0)],
            vec![span(0x2000, 0x1000, 0)],
            vec![span(0x1000, 0x2000, 0x801)],
            vec![span(0x1000, 0x2000, u64::MAX)],
        ] {
            let result = check_spans(&spans, 0x1800);
            assert_eq!(result, Err(ImageError::MalformedHeaders));
        }
    }

    #[test]
    fn open_reads_format_and_architecture() {
        for mut toy in toy_files() {
            let original = toy.bytes.clone();
            let editor = ImageEditor::open(&mut toy.bytes).unwrap();
            assert_eq!(editor.format(), toy.format);
            assert_eq!(editor.architecture(), toy.architecture);
            assert!(!editor.spans.is_empty());
            assert_eq!(toy.bytes, original);
        }
    }

    #[test]
    fn open_rejects_other_files() {
        assert_unrecognized(Vec::new());
        assert_unrecognized(b"\x7fEL".to_vec());
        assert_unrecognized(b"MZ\0".to_vec());
        assert_unrecognized(b"#!/bin/sh\n".to_vec());

        let mut elf32 = toy_elf(Architecture::X86_64, true);
        elf32[4] = 1;
        assert_unrecognized(elf32);

        let mut big_endian_elf = toy_elf(Architecture::X86_64, true);
        big_endian_elf[5] = 2;
        assert_unrecognized(big_endian_elf);

        let mut fat_macho = toy_macho(Architecture::Aarch64);
        fat_macho[..4].copy_from_slice(&0xcafe_babe_u32.to_be_bytes());
        assert_unrecognized(fat_macho);
    }

    #[test]
    fn open_rejects_other_architectures() {
        let mut riscv_elf = toy_elf(Architecture::X86_64, true);
        riscv_elf[18..20].copy_from_slice(&243_u16.to_le_bytes());
        assert_unrecognized(riscv_elf);

        let mut i386_macho = toy_macho(Architecture::X86_64);
        i386_macho[4..8].copy_from_slice(&7_u32.to_le_bytes());
        assert_unrecognized(i386_macho);

        let mut i386_pe = toy_pe(Architecture::X86_64);
        let pe_header_offset = u32_at(&i386_pe, 0x3c) as usize;
        i386_pe[pe_header_offset + 4..][..2].copy_from_slice(&0x014c_u16.to_le_bytes());
        assert_unrecognized(i386_pe);
    }

    #[test]
    fn bytes_at_mut_finds_first_and_last_byte_of_span() {
        for mut toy in toy_files() {
            let original = toy.bytes.clone();
            let mut editor = ImageEditor::open(&mut toy.bytes).unwrap();
            for span in editor.spans.clone() {
                let AddressRange { start, end } = span.addresses;
                for addresses in [
                    range(start, start + 1),
                    range(end - 1, end),
                    range(start, start),
                    span.addresses,
                ] {
                    let expected = file_bytes(&original, span, addresses);
                    assert_eq!(read(&mut editor, addresses), Some(expected));
                }
            }
        }
    }

    #[test]
    fn bytes_at_mut_writes_to_file() {
        for mut toy in toy_files() {
            let mut expected = toy.bytes.clone();
            let mut editor = ImageEditor::open(&mut toy.bytes).unwrap();
            let span = *editor.spans.last().unwrap();
            let end = span.addresses.end;
            editor.bytes_at_mut(range(end - 1, end)).unwrap()[0] ^= 0xff;
            expected[(span.file_offset + span.addresses.len() - 1) as usize] ^= 0xff;
            assert_eq!(toy.bytes, expected);
        }
    }

    #[test]
    fn bytes_at_mut_rejects_range_outside_one_span() {
        for mut toy in toy_files() {
            let mut editor = ImageEditor::open(&mut toy.bytes).unwrap();
            for span in editor.spans.clone() {
                let AddressRange { start, end } = span.addresses;
                assert_eq!(read(&mut editor, range(start, end + 1)), None);
                assert_eq!(read(&mut editor, range(end - 1, end + 1)), None);
                assert_eq!(read(&mut editor, range(start + 1, start)), None);
            }
            assert_eq!(read(&mut editor, range(u64::MAX, u64::MAX)), None);
        }
    }

    #[test]
    fn bytes_at_mut_rejects_range_over_adjacent_spans() {
        let mut bytes = toy_pe(Architecture::X86_64);
        let mut editor = ImageEditor::open(&mut bytes).unwrap();
        let (text, rdata) = (editor.spans[0].addresses, editor.spans[1].addresses);
        assert_eq!(text.end, rdata.start);
        assert_eq!(
            read(&mut editor, range(text.end - 1, rdata.start + 1)),
            None
        );
        assert_eq!(read(&mut editor, range(text.start, rdata.end)), None);
        assert_eq!(
            read(&mut editor, range(text.end, text.end)),
            Some(Vec::new())
        );
    }

    #[test]
    fn bytes_at_mut_rejects_zero_filled_memory() {
        for architecture in ARCHITECTURES {
            let mut elf = toy_elf(architecture, true);
            let header = read_header(&elf).unwrap();
            let table = ProgramHeaderTable::read(&elf, &header).unwrap();
            let writable = table
                .headers
                .iter()
                .rfind(|header| header.p_type == PT_LOAD)
                .unwrap();
            assert!(writable.p_filesz < writable.p_memsz);
            let bss = range(
                writable.p_vaddr + writable.p_filesz,
                writable.p_vaddr + writable.p_memsz,
            );
            let mut editor = ImageEditor::open(&mut elf).unwrap();
            assert_eq!(read(&mut editor, bss), None);
            assert_eq!(read(&mut editor, range(bss.start, bss.start + 1)), None);
            assert_eq!(read(&mut editor, range(bss.end - 1, bss.end)), None);
            assert_eq!(read(&mut editor, range(bss.start - 1, bss.start + 1)), None);
        }
    }

    #[test]
    fn find_section_agrees_with_spans() {
        for mut toy in toy_files() {
            let original = toy.bytes.clone();
            let mut editor = ImageEditor::open(&mut toy.bytes).unwrap();
            for section in KNOWN_SECTIONS {
                let Some(location) = editor.find_section(section) else {
                    let missing = (toy.format, section);
                    assert_eq!(missing, (ExecutableFormat::Pe, KnownSection::Payload));
                    continue;
                };
                if location.size == 0 {
                    continue;
                }
                let addresses = range(location.address, location.address + location.size);
                let offset = location.file_offset as usize;
                let expected = original[offset..][..location.size as usize].to_vec();
                assert_eq!(read(&mut editor, addresses), Some(expected));
            }
        }
    }

    #[test]
    fn remove_ranges_without_cuts_changes_nothing() {
        for mut toy in toy_files() {
            let original = toy.bytes.clone();
            let mut editor = ImageEditor::open(&mut toy.bytes).unwrap();
            assert!(matches!(editor.remove_ranges(&[]), Ok(0)));
            assert_eq!(toy.bytes, original);
        }
    }

    #[test]
    fn remove_ranges_rejects_unsorted_cuts() {
        for toy in toy_files() {
            let page = cut_model_of(&toy).alignment;
            for cuts in [
                ranges(&[(2 * page, 3 * page), (0, page)]),
                ranges(&[(0, 2 * page), (page, 3 * page)]),
                ranges(&[(page, page)]),
                ranges(&[(2 * page, page)]),
            ] {
                assert_cuts_rejected(&toy, &cuts, ImageError::CutsNotSorted);
            }
        }
    }

    #[test]
    fn remove_ranges_rejects_unaligned_cuts() {
        for toy in toy_files() {
            let page = cut_model_of(&toy).alignment;
            for cut in [range(page + 1, 2 * page), range(page, 2 * page - 1)] {
                assert_cuts_rejected(&toy, &[cut], ImageError::CutNotAligned);
            }
        }
    }

    #[test]
    fn remove_ranges_rejects_too_many_cuts() {
        for toy in toy_files() {
            let model = cut_model_of(&toy);
            let cuts: Vec<AddressRange> = (0..=model.max_cuts() as u64)
                .map(|index| 2 * index * model.alignment)
                .map(|start| range(start, start + model.alignment))
                .collect();
            assert_cuts_rejected(&toy, &cuts, ImageError::TooManyCuts);
        }
    }

    #[test]
    fn remove_ranges_rejects_cuts_without_file_bytes() {
        for toy in toy_files() {
            let mut bytes = toy.bytes.clone();
            let editor = ImageEditor::open(&mut bytes).unwrap();
            let page = editor.cut_model().alignment;
            let last_end = editor.spans.last().unwrap().addresses.end;
            let start = crate::align_up(last_end, page) + page;
            let cut = range(start, start + page);
            assert_cuts_rejected(&toy, &[cut], ImageError::CutNotFileBacked);
        }

        let pe = ToyFile {
            format: ExecutableFormat::Pe,
            architecture: Architecture::X86_64,
            bytes: toy_pe(Architecture::X86_64),
        };
        let mut bytes = pe.bytes.clone();
        let editor = ImageEditor::open(&mut bytes).unwrap();
        let text_end = editor.spans[0].addresses.end;
        let over_two_spans = range(text_end - 0x1000, text_end + 0x1000);
        assert_cuts_rejected(&pe, &[over_two_spans], ImageError::CutNotFileBacked);
    }

    fn middle_page(span: MappedSpan, alignment: u64) -> Option<AddressRange> {
        let middle = span.addresses.start + span.addresses.len() / 2;
        let start = middle - middle % alignment;
        let page = range(start, start + alignment);
        span.addresses.contains(page).then_some(page)
    }

    fn remove_and_verify(toy: &ToyFile, span: MappedSpan, cut: AddressRange) -> bool {
        let mut original = toy.bytes.clone();
        let original_editor = ImageEditor::open(&mut original).unwrap();
        let mut bytes = toy.bytes.clone();
        let mut editor = ImageEditor::open(&mut bytes).unwrap();
        let Ok(saved) = editor.remove_ranges(&[cut]) else {
            return false;
        };

        assert_eq!(read(&mut editor, cut), None);
        assert_eq!(read(&mut editor, range(cut.start, cut.start + 1)), None);
        assert_eq!(read(&mut editor, range(cut.end - 1, cut.end)), None);
        let following = range(cut.end, span.addresses.end);
        if !following.is_empty() {
            let expected = file_bytes(&toy.bytes, span, following);
            assert_eq!(read(&mut editor, following), Some(expected));
        }
        for section in KNOWN_SECTIONS {
            let Some(before) = original_editor.find_section(section) else {
                continue;
            };
            if before.address < cut.end && cut.start < before.address + before.size {
                continue;
            }
            let after = editor.find_section(section).unwrap();
            assert_eq!((after.address, after.size), (before.address, before.size));
        }
        assert_eq!(saved, toy.bytes.len().saturating_sub(bytes.len()) as u64);
        true
    }

    #[test]
    fn remove_ranges_unmaps_cut_and_recomputes_spans() {
        for toy in toy_files() {
            let mut bytes = toy.bytes.clone();
            let editor = ImageEditor::open(&mut bytes).unwrap();
            let alignment = editor.cut_model().alignment;
            let mut removed_count = 0;
            for span in &editor.spans {
                let Some(cut) = middle_page(*span, alignment) else {
                    continue;
                };
                if remove_and_verify(&toy, *span, cut) {
                    removed_count += 1;
                }
            }
            assert!(removed_count > 0, "{:?} {:?}", toy.format, toy.architecture);
        }
    }

    #[test]
    fn chosen_cuts_are_accepted() {
        for mut toy in toy_files() {
            let mut editor = ImageEditor::open(&mut toy.bytes).unwrap();
            let removable: Vec<RemovableBytes> = editor
                .spans
                .iter()
                .map(|span| RemovableBytes {
                    range: span.addresses,
                    is_code: false,
                    can_be_cut: true,
                    can_be_filled: true,
                })
                .collect();
            let plan = editor.cut_model().choose(&removable);
            assert!(
                !plan.cuts.is_empty(),
                "{:?} {:?}",
                toy.format,
                toy.architecture
            );
            let result = editor.remove_ranges(&plan.cuts);
            assert!(
                result.is_ok(),
                "{:?} {:?}: {result:?}",
                toy.format,
                toy.architecture
            );
        }
    }
}

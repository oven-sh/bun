//! Reads and writes an executable file without holding a second copy of it in memory.

use bun_core::ZStr;
use bun_exe_format::builtins::Image;
use bun_exe_format::elf::{self as bun_elf, ElfFile};
use bun_exe_format::elf_payload::Piece;
use bun_exe_format::elf_ranges::reserve_payload_segments;
use bun_exe_format::elf_symbols::symbols_tail;
use bun_exe_format::payload_references::{PayloadReferenceError, check_payload_references};
use bun_sys::Fd;

#[derive(Copy, Clone)]
pub(crate) struct ImageSymbols<'a> {
    pub(crate) table: &'a [u8],
    /// From the start of the payload.
    pub(crate) image_offset: u64,
}

/// Where the image of the compiled program lies in the payload.
#[derive(Copy, Clone)]
pub(crate) struct ImageRange {
    pub(crate) offset: u32,
    pub(crate) length: u32,
}

#[derive(Debug)]
pub(crate) enum ElfWriteError {
    Template(bun_elf::ElfError),
    Elf(bun_elf::ElfError),
    Seek(bun_sys::Error),
    Write(bun_sys::Error),
    Truncate(bun_sys::Error),
}

pub(crate) struct ElfWritten {
    pub(crate) has_symbols: bool,
}

pub(crate) struct MappedFile {
    file: bun_sys::File,
    pointer: *mut u8,
    length: usize,
    mapped_length: usize,
}

impl MappedFile {
    #[cfg(not(windows))]
    pub(crate) fn open(path: &ZStr) -> Option<MappedFile> {
        let file = bun_sys::File::open(path, bun_sys::O::RDONLY | bun_sys::O::CLOEXEC, 0).ok()?;
        let length = file.get_end_pos().ok().filter(|length| *length > 0)?;
        let (access, flags) = (libc::PROT_READ | libc::PROT_WRITE, libc::MAP_PRIVATE);
        let pointer =
            bun_sys::mmap(core::ptr::null_mut(), length, access, flags, file.handle(), 0).ok()?;
        Some(MappedFile { file, pointer, length, mapped_length: length })
    }

    #[cfg(windows)]
    pub(crate) fn open(_path: &ZStr) -> Option<MappedFile> {
        None
    }

    pub(crate) fn addresses(&self) -> core::ops::Range<usize> {
        self.pointer as usize..self.pointer as usize + self.length
    }

    pub(crate) fn bytes_and_file(&mut self) -> (&mut [u8], &bun_sys::File) {
        // SAFETY: the mapping holds `length` writable bytes until `drop`, and nothing else refers to them.
        (unsafe { core::slice::from_raw_parts_mut(self.pointer, self.length) }, &self.file)
    }
}

impl Drop for MappedFile {
    fn drop(&mut self) {
        let _ = bun_sys::munmap(self.pointer, self.mapped_length);
    }
}

impl core::ops::Deref for MappedFile {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        // SAFETY: the mapping holds `length` readable bytes until `drop`.
        unsafe { core::slice::from_raw_parts(self.pointer, self.length) }
    }
}

impl core::ops::DerefMut for MappedFile {
    fn deref_mut(&mut self) -> &mut [u8] {
        self.bytes_and_file().0
    }
}

#[cfg(target_os = "linux")]
impl MappedFile {
    fn page_size() -> usize {
        // SAFETY: sysconf has no precondition.
        unsafe { libc::sysconf(libc::_SC_PAGESIZE) as usize }
    }

    /// Fresh zero pages at `start..end`, which lies in the addresses that `open` reserved.
    fn map_zero_pages(&mut self, start: usize, end: usize) {
        assert!(start < end && end <= self.mapped_length.next_multiple_of(MappedFile::page_size()));
        let (access, flags) = (libc::PROT_READ | libc::PROT_WRITE, libc::MAP_PRIVATE | libc::MAP_ANONYMOUS | libc::MAP_FIXED);
        // SAFETY: the addresses belong to this mapping, and no reference to its bytes is alive.
        let pages = unsafe { libc::mmap(self.pointer.add(start).cast(), end - start, access, flags, -1, 0) };
        assert!(pages != libc::MAP_FAILED, "no memory for the pages of an executable");
    }
}

#[cfg(target_os = "linux")]
impl bun_exe_format::image::ImageBytes for MappedFile {
    // Whole pages change their address and are not read: those that nothing wrote stay pages of the file.
    fn move_down(&mut self, source: core::ops::Range<usize>, target: usize) {
        let page = MappedFile::page_size();
        let distance = source.start - target;
        if distance == 0 || source.is_empty() {
            return;
        }
        if !source.start.is_multiple_of(page) || !target.is_multiple_of(page) {
            // An earlier move of whole pages may have left none between the two.
            let (start, end) = (target.next_multiple_of(page), source.start / page * page);
            if start < end {
                self.map_zero_pages(start, end);
            }
            self.copy_within(source, target);
            return;
        }
        let length = source.len().next_multiple_of(page).min(self.mapped_length - source.start);
        let mut moved = 0;
        // mremap() refuses ranges that overlap.
        while moved < length {
            let size = distance.min(length - moved);
            // SAFETY: both ranges lie in this mapping, and no reference to its bytes is alive.
            let (from, to) = unsafe { (self.pointer.add(source.start + moved), self.pointer.add(target + moved)) };
            let flags = libc::MREMAP_MAYMOVE | libc::MREMAP_FIXED;
            // SAFETY: as above. What was mapped at `to` is dropped, which the caller allows.
            let result = unsafe { libc::mremap(from.cast(), size, size, flags, to.cast::<libc::c_void>()) };
            if result == libc::MAP_FAILED {
                self.map_zero_pages(target + moved, target + moved + size);
                // SAFETY: `size` is at most the distance between the two, so they don't overlap.
                unsafe { core::ptr::copy_nonoverlapping(from, to, size) };
            }
            moved += size;
        }
    }

    fn truncate(&mut self, len: usize) {
        self.length = self.length.min(len);
    }

    fn grow(&mut self, len: usize) {
        let first_new_page = self.length.next_multiple_of(MappedFile::page_size());
        if len > first_new_page {
            self.map_zero_pages(first_new_page, len.next_multiple_of(MappedFile::page_size()));
        }
        let old_length = core::mem::replace(&mut self.length, len);
        self[old_length..first_new_page.min(len)].fill(0);
    }

    fn as_vec(&mut self) -> Option<&mut Vec<u8>> {
        None
    }
}

/// The pages of a private mapping of a whole file that nothing has written to. They hold what the file holds.
struct UntouchedPages {
    addresses: core::ops::Range<usize>,
    page_size: usize,
    is_untouched: Vec<bool>,
}

impl UntouchedPages {
    #[cfg(target_os = "linux")]
    fn of(addresses: core::ops::Range<usize>) -> Option<UntouchedPages> {
        const IS_PRESENT: u64 = 1 << 63;
        const IS_SWAPPED: u64 = 1 << 62;
        const IS_PAGE_OF_FILE: u64 = 1 << 61;
        let page_size = MappedFile::page_size();
        let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC;
        let page_map = bun_sys::File::open(bun_core::zstr!("/proc/self/pagemap"), flags, 0).ok()?;
        let first_page = addresses.start / page_size;
        let mut entries = vec![0u8; (addresses.end.div_ceil(page_size) - first_page) * 8];
        let size = page_map.pread_all(&mut entries, first_page as u64 * 8).ok()?;
        if !addresses.start.is_multiple_of(page_size) || size != entries.len() {
            return None;
        }
        let is_untouched = entries.as_chunks::<8>().0.iter().map(|entry| {
            let entry = u64::from_ne_bytes(*entry);
            match entry & (IS_PRESENT | IS_SWAPPED) {
                0 => true,
                IS_PRESENT => entry & IS_PAGE_OF_FILE != 0,
                _ => false,
            }
        });
        let is_untouched = is_untouched.collect();
        Some(UntouchedPages { addresses, page_size, is_untouched })
    }

    #[cfg(not(target_os = "linux"))]
    fn of(_addresses: core::ops::Range<usize>) -> Option<UntouchedPages> {
        None
    }

    /// Whether `bytes` are the part of the mapping that begins at `position` of the file.
    fn are_mapped_at(&self, bytes: &[u8], position: u64) -> bool {
        let start = bytes.as_ptr() as usize;
        start >= self.addresses.start
            && start + bytes.len() <= self.addresses.end
            && (start - self.addresses.start) as u64 == position
    }

    /// `bytes` are a part of the mapping.
    fn hold(&self, bytes: &[u8]) -> bool {
        let offset = bytes.as_ptr() as usize - self.addresses.start;
        let pages = offset / self.page_size..(offset + bytes.len()).div_ceil(self.page_size);
        self.is_untouched[pages].iter().all(|&is_untouched| is_untouched)
    }
}

fn write_changed_blocks(
    file: &bun_sys::File,
    position: u64,
    bytes: &[u8],
    original: &bun_sys::File,
    untouched: Option<&UntouchedPages>,
    block: &mut [u8],
) -> bun_sys::Maybe<u64> {
    // What has moved, and what the original never held, differs from what stands there.
    if untouched.is_some_and(|pages| !pages.are_mapped_at(bytes, position)) {
        file.pwrite_all(bytes, position as i64)?;
        return Ok(bytes.len() as u64);
    }
    let mut changed_start = 0;
    let mut start = 0;
    let mut bytes_written = 0;
    while start < bytes.len() {
        let end = bytes.len().min(start + block.len());
        let is_held = if untouched.is_some_and(|pages| pages.hold(&bytes[start..end])) {
            true
        } else {
            let held = &mut block[..end - start];
            let held_size = original.pread_all(held, position + start as u64)?;
            if held_size == 0 {
                break;
            }
            held_size == held.len() && *held == bytes[start..end]
        };
        if is_held {
            file.pwrite_all(&bytes[changed_start..start], (position + changed_start as u64) as i64)?;
            bytes_written += (start - changed_start) as u64;
            changed_start = end;
        }
        start = end;
    }
    file.pwrite_all(&bytes[changed_start..], (position + changed_start as u64) as i64)?;
    Ok(bytes_written + (bytes.len() - changed_start) as u64)
}

struct WrittenPieces {
    size: u64,
    #[cfg_attr(not(test), allow(dead_code))]
    bytes_written: u64,
}

/// What `file` holds already.
#[derive(Copy, Clone)]
pub(crate) struct Original<'a> {
    pub(crate) file: &'a bun_sys::File,
    /// The addresses of a private mapping of the whole of it, which pieces may be parts of.
    pub(crate) mapping: Option<(usize, usize)>,
}

/// Makes `pieces` the whole content of `file` and returns its size.
fn write_pieces(
    file: &bun_sys::File,
    pieces: &[Piece<'_>],
    original: Option<Original<'_>>,
) -> Result<WrittenPieces, ElfWriteError> {
    use ElfWriteError::{Seek, Truncate, Write};
    let mapping = original.and_then(|original| original.mapping);
    let untouched = mapping.and_then(|(start, end)| UntouchedPages::of(start..end));
    let zeros = vec![0u8; 64 * 1024];
    let mut block = vec![0u8; 64 * 1024];
    let mut size: u64 = 0;
    let mut bytes_kept: u64 = 0;
    let previous_size = file.get_end_pos().map_err(Seek)? as u64;
    for piece in pieces {
        match (piece, original) {
            (Piece::Bytes(bytes), Some(original)) => {
                let written =
                    write_changed_blocks(file, size, bytes, original.file, untouched.as_ref(), &mut block)
                        .map_err(Write)?;
                bytes_kept += bytes.len() as u64 - written;
            }
            (Piece::Bytes(bytes), None) => file.pwrite_all(bytes, size as i64).map_err(Write)?,
            (Piece::Length(length), _) => file.pwrite_all(length, size as i64).map_err(Write)?,
            (Piece::Zeros(count), _) => {
                let mut written: u64 = 0;
                while written < *count {
                    let block = &zeros[..(*count - written).min(zeros.len() as u64) as usize];
                    file.pwrite_all(block, (size + written) as i64).map_err(Write)?;
                    written += block.len() as u64;
                }
            }
        }
        size += piece.len();
    }
    // A file that was truncated is written to disk when it is closed.
    if previous_size > size {
        bun_sys::ftruncate(file.handle(), size as i64).map_err(Truncate)?;
    }
    Ok(WrittenPieces { size, bytes_written: size - bytes_kept })
}

fn append_elf_symbols(file: &bun_sys::File, size: u64, symbols: ImageSymbols<'_>) -> bool {
    let read_at = |offset: u64, out: &mut [u8]| {
        matches!(file.pread_all(out, offset), Ok(count) if count == out.len())
    };
    let Some(tail) = symbols_tail(size, read_at, symbols.table, symbols.image_offset) else {
        return false;
    };
    tail.write(|offset, bytes| file.pwrite_all(bytes, offset as i64).is_ok())
}

/// Reads `ImageHeader::size` and `ImageHeader::codeOffset`, whose offsets AOTImageFormat.h asserts.
fn find_code_range(payload: &[u8], image: ImageRange) -> Option<core::ops::Range<u64>> {
    let bytes = payload.get(image.offset as usize..)?.get(..image.length as usize)?;
    let word_at = |offset: usize| bytes.get(offset..)?.first_chunk::<8>().map(|word| u64::from_le_bytes(*word));
    let (size, code_offset) = (word_at(32)?, word_at(40)?);
    let start = u64::from(image.offset);
    (code_offset < size && size <= u64::from(image.length)).then(|| start + code_offset..start + size)
}

pub(crate) fn write_elf(
    file: Fd,
    template: &mut [u8],
    original: Option<Original<'_>>,
    payload: &mut [u8],
    image: Option<ImageRange>,
    symbols: Option<ImageSymbols<'_>>,
) -> Result<ElfWritten, ElfWriteError> {
    use ElfWriteError::{Elf, Template};
    let file = bun_sys::File::borrow(&file);
    if image.is_some() {
        let _ = reserve_payload_segments(template);
    }
    let mut elf = ElfFile::over(template).map_err(Template)?;
    elf.normalize_interpreter();
    // An image that is written for its address shares its pages with the file: nothing is written to them at start.
    if let Some(image) = image
        && let Some(address) = elf.payload_address(payload.len() as u64).map_err(Elf)?
    {
        let start = image.offset as usize;
        let bytes = &mut payload[start..start + image.length as usize];
        bun_aot::engine::relocate_image(bytes, address + u64::from(image.offset));
    }
    let code = image.and_then(|image| find_code_range(payload, image));
    let pieces = elf.bun_section_in_pieces(payload, code).map_err(Elf)?;
    let size = write_pieces(file, &pieces, original)?.size;
    let has_symbols = symbols.is_some_and(|symbols| append_elf_symbols(file, size, symbols));
    Ok(ElfWritten { has_symbols })
}

pub fn with_executable_image<R>(
    path: &ZStr,
    use_image: impl FnOnce(&mut Image<'_>) -> R,
) -> bun_sys::Maybe<R> {
    let file = bun_sys::File::open(path, bun_sys::O::RDONLY | bun_sys::O::CLOEXEC, 0)?;
    with_image_of(&file, use_image)
}

fn with_image_of<R>(
    file: &bun_sys::File,
    use_image: impl FnOnce(&mut Image<'_>) -> R,
) -> bun_sys::Maybe<R> {
    let len = file.get_end_pos()?;
    let mut read = |offset: usize, out: &mut [u8]| {
        matches!(file.pread_all(out, offset as u64), Ok(count) if count == out.len())
    };
    let read = &mut read;
    Ok(use_image(&mut Image { len, read }))
}

/// `file` is a finished executable that holds compiled code.
pub(crate) fn check_written_payload(file: Fd) -> Result<(), PayloadReferenceError> {
    with_image_of(bun_sys::File::borrow(&file), check_payload_references)
        .unwrap_or(Err(PayloadReferenceError::MalformedExecutable))
}

#[cfg(test)]
mod tests {
    use bun_core::ZBox;

    use super::*;
    use crate::compiled_program::tests::TemporaryFolder;

    fn read_file(path: &ZStr) -> Vec<u8> {
        bun_sys::File::read_from(Fd::cwd(), path.as_bytes()).unwrap()
    }

    #[test]
    fn pieces_replace_longer_file() {
        let folder = TemporaryFolder::create("pieces");
        let path = folder.write("file", &[0xAA; 300_000]);
        let length = 7u64.to_le_bytes();
        let pieces = [
            Piece::Bytes(b"head"),
            Piece::Zeros(200_000),
            Piece::Length(length),
            Piece::Bytes(b"payload"),
            Piece::Zeros(0),
        ];
        let expected = [&b"head"[..], &[0; 200_000], &length, b"payload"].concat();

        let file = bun_sys::File::open(&path, bun_sys::O::RDWR, 0).unwrap();
        let written = write_pieces(&file, &pieces, None).unwrap();
        assert_eq!(written.size, expected.len() as u64);
        assert_eq!(written.bytes_written, expected.len() as u64);
        assert!(read_file(&path) == expected);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn mapping_is_edited_like_a_vector() {
        use bun_exe_format::image::ImageBytes;

        let page = MappedFile::page_size();
        let folder = TemporaryFolder::create("mapping");
        let original: Vec<u8> = (0..page * 12 + 100).map(|index| (index / 13) as u8).collect();
        let path = folder.write("file", &original);
        let edit = |bytes: &mut dyn ImageBytes| {
            // A page that was written moves with what was written, and a range longer than the distance moves in pieces.
            bytes[page * 5 + 7] = 0xEE;
            bytes.move_down(page * 2..page * 3, page);
            bytes.move_down(page * 5..page * 12 + 100, page * 2);
            bytes.truncate(page * 9 + 100);
            bytes.grow(page * 10 + 50);
            bytes[page * 10 + 1] = 1;
        };
        let edit_parts_of_pages = |bytes: &mut dyn ImageBytes| {
            bytes.move_down(page * 5..page * 7, page * 2);
            bytes.move_down(page * 8 + 16..page * 12 + 100, page * 4);
            bytes.truncate(page * 8 + 84);
            bytes.grow(page * 8 + 90);
        };
        let mut mapped = MappedFile::open(&path).unwrap();
        let mut vector = original.clone();
        edit(&mut mapped);
        edit(&mut vector);
        assert!(*mapped == *vector);
        let mut mapped = MappedFile::open(&path).unwrap();
        let mut vector = original.clone();
        edit_parts_of_pages(&mut mapped);
        edit_parts_of_pages(&mut vector);
        assert!(*mapped == *vector);
        assert!(read_file(&path) == original);
    }

    #[test]
    fn held_blocks_are_kept() {
        let folder = TemporaryFolder::create("held");
        let held: Vec<u8> = (0..300_000u32).map(|index| (index / 7) as u8).collect();
        let path = folder.write("file", &held);
        let original = folder.write("original", &held);
        let mut head = held[..250_000].to_vec();
        for at in [0, 65_535, 65_536, 200_000, 249_999] {
            head[at] ^= 0xFF;
        }
        let pieces = [Piece::Bytes(&head), Piece::Zeros(10), Piece::Bytes(b"payload"), Piece::Bytes(&held[..70_000])];
        let expected = [&head[..], &[0; 10], b"payload", &held[..70_000]].concat();

        let file = bun_sys::File::open(&path, bun_sys::O::RDWR, 0).unwrap();
        let original = bun_sys::File::open(&original, bun_sys::O::RDONLY, 0).unwrap();
        let original = Original { file: &original, mapping: None };
        let written = write_pieces(&file, &pieces, Some(original)).unwrap();
        assert_eq!(written.size, expected.len() as u64);
        assert_eq!(written.bytes_written, expected.len() as u64 - 64 * 1024);
        assert!(read_file(&path) == expected);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn untouched_pages_of_mapping_are_not_compared() {
        const BLOCK: usize = 64 * 1024;
        let folder = TemporaryFolder::create("untouched");
        let held: Vec<u8> = (0..BLOCK * 5 + 100).map(|index| (index / 7) as u8).collect();
        let path = folder.write("file", &held);
        let mapped_path = folder.write("mapped", &held);
        // Whatever is compared with this file differs from it.
        let other = folder.write("other", &vec![0xAA; held.len()]);
        let mut mapped = MappedFile::open(&mapped_path).unwrap();
        mapped[BLOCK * 2 + 5] ^= 0xFF;
        assert_eq!(mapped[BLOCK * 3], held[BLOCK * 3]);
        let addresses = mapped.addresses();
        if UntouchedPages::of(addresses.clone()).is_none() {
            return;
        }
        let expected = [&mapped[..], &mapped[..BLOCK]].concat();
        let pieces = [Piece::Bytes(&mapped), Piece::Bytes(&mapped[..BLOCK])];

        let file = bun_sys::File::open(&path, bun_sys::O::RDWR, 0).unwrap();
        let other = bun_sys::File::open(&other, bun_sys::O::RDONLY, 0).unwrap();
        let original = Original { file: &other, mapping: Some((addresses.start, addresses.end)) };
        let written = write_pieces(&file, &pieces, Some(original)).unwrap();
        assert_eq!(written.size, expected.len() as u64);
        assert_eq!(written.bytes_written, 2 * BLOCK as u64);
        assert!(read_file(&path) == expected);
    }

    #[test]
    fn mapped_file_keeps_writes_in_memory() {
        let folder = TemporaryFolder::create("mapped");
        let path = folder.write("file", b"0123456789");
        let mut mapped = MappedFile::open(&path).unwrap();
        mapped.bytes_and_file().0[3] = b'x';
        assert_eq!(mapped.bytes_and_file().0, b"012x456789");
        assert!(read_file(&path) == b"0123456789");
        assert!(MappedFile::open(&ZBox::from_vec(folder.join("missing"))).is_none());
    }

    #[test]
    fn non_elf_template_is_rejected() {
        let folder = TemporaryFolder::create("non-elf");
        let template = b"#!/bin/sh\n".repeat(16);
        let path = folder.write("file", &template);
        let file = bun_sys::File::open(&path, bun_sys::O::RDWR, 0).unwrap();
        let mut payload = b"payload".to_vec();
        let written =
            write_elf(file.handle(), &mut template.clone(), None, &mut payload, None, None);
        let invalid = bun_elf::ElfError::InvalidElfFile;
        assert!(matches!(written, Err(ElfWriteError::Template(error)) if error == invalid));
        assert!(read_file(&path) == template);
    }

    #[test]
    fn executable_image_bounds() {
        let folder = TemporaryFolder::create("executable-image");
        let path = folder.write("file", b"0123456789");
        let opened = with_executable_image(&path, |image| {
            let mut bytes = [0u8; 4];
            assert_eq!(image.len, 10);
            assert!((image.read)(6, &mut bytes));
            assert_eq!(&bytes, b"6789");
            assert!(!(image.read)(7, &mut bytes));
        });
        assert!(opened.is_ok());

        let missing = ZBox::from_vec(folder.join("missing"));
        assert!(with_executable_image(&missing, |_| ()).is_err());
    }
}

//! Reads and writes an executable file without holding a second copy of it in memory.

use bun_core::ZStr;
use bun_exe_format::builtins::Image;
use bun_exe_format::elf::{self as bun_elf, ElfFile};
use bun_exe_format::elf_payload::Piece;
use bun_exe_format::elf_ranges::reserve_payload_segments;
use bun_exe_format::elf_symbols::symbols_tail;
pub(crate) use bun_exe_format::mapped_file::MappedFile;
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
        let size = page_map
            .pread_all(&mut entries, first_page as u64 * 8)
            .ok()?;
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
        Some(UntouchedPages {
            addresses,
            page_size,
            is_untouched,
        })
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
        self.is_untouched[pages]
            .iter()
            .all(|&is_untouched| is_untouched)
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
            file.pwrite_all(
                &bytes[changed_start..start],
                (position + changed_start as u64) as i64,
            )?;
            bytes_written += (start - changed_start) as u64;
            changed_start = end;
        }
        start = end;
    }
    file.pwrite_all(
        &bytes[changed_start..],
        (position + changed_start as u64) as i64,
    )?;
    Ok(bytes_written + (bytes.len() - changed_start) as u64)
}

/// Fills `bytes` in at the end of `file` through a mapping, whose pages several threads make side by side. False: use `pwrite`.
#[cfg(target_os = "linux")]
fn fill_behind_end(file: &bun_sys::File, bytes: &[u8], position: u64) -> bool {
    const FEWEST_BYTES: usize = 32 << 20;
    const MOST_THREADS: usize = 8;
    if bytes.len() < FEWEST_BYTES {
        return false;
    }
    let first_page = position - position % MappedFile::page_size() as u64;
    let skipped = (position - first_page) as usize;
    // With its blocks reserved, a page that is touched cannot find the disk full.
    // SAFETY: fallocate has no precondition but a valid file descriptor.
    let reserved = unsafe {
        libc::fallocate(
            file.handle().native(),
            0,
            position as i64,
            bytes.len() as i64,
        )
    };
    if reserved != 0 {
        return false;
    }
    let (access, flags) = (libc::PROT_READ | libc::PROT_WRITE, libc::MAP_SHARED);
    let length = skipped + bytes.len();
    let Ok(pointer) = bun_sys::mmap(
        core::ptr::null_mut(),
        length,
        access,
        flags,
        file.handle(),
        first_page as i64,
    ) else {
        return false;
    };
    // SAFETY: the mapping holds `length` writable bytes until `munmap`, and nothing else refers to them.
    let target = unsafe { core::slice::from_raw_parts_mut(pointer.add(skipped), bytes.len()) };
    let threads = usize::from(bun_core::get_thread_count()).clamp(1, MOST_THREADS);
    let share = bytes
        .len()
        .div_ceil(threads)
        .next_multiple_of(MappedFile::page_size());
    std::thread::scope(|scope| {
        for (target, bytes) in target.chunks_mut(share).zip(bytes.chunks(share)) {
            scope.spawn(move || target.copy_from_slice(bytes));
        }
    });
    let _ = bun_sys::munmap(pointer, length);
    true
}

#[cfg(not(target_os = "linux"))]
fn fill_behind_end(_file: &bun_sys::File, _bytes: &[u8], _position: u64) -> bool {
    false
}

fn write_behind_end(file: &bun_sys::File, bytes: &[u8], position: u64) -> bun_sys::Maybe<()> {
    match fill_behind_end(file, bytes, position) {
        true => Ok(()),
        false => file.pwrite_all(bytes, position as i64),
    }
}

/// What `file` holds already.
#[derive(Copy, Clone)]
pub(crate) struct Original<'a> {
    pub(crate) file: &'a bun_sys::File,
    /// The addresses of a private mapping of the whole of it, which pieces may be parts of.
    pub(crate) mapping: Option<(usize, usize)>,
}

/// Makes `pieces` the whole content of `file`. Returns its size and how many bytes were written.
fn write_pieces(
    file: &bun_sys::File,
    pieces: &[Piece<'_>],
    original: Option<Original<'_>>,
) -> Result<(u64, u64), ElfWriteError> {
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
                let inside = bytes.len().min(previous_size.saturating_sub(size) as usize);
                let (inside, behind) = bytes.split_at(inside);
                let written = write_changed_blocks(
                    file,
                    size,
                    inside,
                    original.file,
                    untouched.as_ref(),
                    &mut block,
                )
                .map_err(Write)?;
                bytes_kept += inside.len() as u64 - written;
                write_behind_end(file, behind, size + inside.len() as u64).map_err(Write)?;
            }
            (Piece::Bytes(bytes), None) => {
                let inside = bytes.len().min(previous_size.saturating_sub(size) as usize);
                let (inside, behind) = bytes.split_at(inside);
                file.pwrite_all(inside, size as i64).map_err(Write)?;
                write_behind_end(file, behind, size + inside.len() as u64).map_err(Write)?;
            }
            (Piece::Length(length), _) => file.pwrite_all(length, size as i64).map_err(Write)?,
            (Piece::Zeros(count), _) => {
                let mut written: u64 = 0;
                while written < *count {
                    let block = &zeros[..(*count - written).min(zeros.len() as u64) as usize];
                    file.pwrite_all(block, (size + written) as i64)
                        .map_err(Write)?;
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
    Ok((size, size - bytes_kept))
}

fn append_elf_symbols(file: &bun_sys::File, size: u64, symbols: ImageSymbols<'_>) -> bool {
    let read_at = |offset: u64, out: &mut [u8]| matches!(file.pread_all(out, offset), Ok(count) if count == out.len());
    let Some(tail) = symbols_tail(size, read_at, symbols.table, symbols.image_offset) else {
        return false;
    };
    tail.write(|offset, bytes| file.pwrite_all(bytes, offset as i64).is_ok())
}

/// Reads `ImageHeader::size` and `ImageHeader::codeOffset`, whose offsets AOTImageFormat.h asserts.
fn find_code_range(payload: &[u8], image: ImageRange) -> Option<core::ops::Range<u64>> {
    let bytes = payload
        .get(image.offset as usize..)?
        .get(..image.length as usize)?;
    let word_at = |offset: usize| {
        bytes
            .get(offset..)?
            .first_chunk::<8>()
            .map(|word| u64::from_le_bytes(*word))
    };
    let (size, code_offset) = (word_at(32)?, word_at(40)?);
    let start = u64::from(image.offset);
    (code_offset < size && size <= u64::from(image.length))
        .then(|| start + code_offset..start + size)
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
    let (size, _) = write_pieces(file, &pieces, original)?;
    let has_symbols = symbols.is_some_and(|symbols| append_elf_symbols(file, size, symbols));
    Ok(ElfWritten { has_symbols })
}

pub fn with_executable_image<R>(
    path: &ZStr,
    use_image: impl FnOnce(&mut Image<'_>) -> R,
) -> bun_sys::Maybe<R> {
    let file = bun_sys::File::open(path, bun_sys::O::RDONLY | bun_sys::O::CLOEXEC, 0)?;
    let len = file.get_end_pos()?;
    let mut read = |offset: usize, out: &mut [u8]| matches!(file.pread_all(out, offset as u64), Ok(count) if count == out.len());
    let read = &mut read;
    Ok(use_image(&mut Image { len, read }))
}

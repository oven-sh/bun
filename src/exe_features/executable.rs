//! What the scan needs to know about an executable, whichever format it has.

use crate::bytes::{slice, u8_at, u16_at, u32_at, u64_at, usize_at};
use crate::table::{Arch, Container, Format};
use crate::{Error, Result};

// Where the compressed table is. Nothing that the scan reads may depend on whether it is there.
/// The last section, which is not loaded. It is told by its type, from the range that is the application's to use, and
/// has no name, so that the section names stay as they are.
pub(crate) const SHT_BUN_FEATURE_TABLE: u32 = 0x8062_756e;
/// The last section.
pub(crate) const PE_TABLE_SECTION: &[u8; 8] = b".bunfeat";
/// A Mach-O has no room for another load command once it is linked. The table is the tail of the string table, which ends
/// `__LINKEDIT` but for the signature: the table, padding, its length (8 bytes), this.
pub(crate) const MACHO_TABLE_TRAILER: &[u8; 8] = b"BUNFEAT\0";

/// A stretch of addresses and the bytes of the file that are loaded there.
#[derive(Clone, Copy)]
struct Range {
    addr: u64,
    file_size: u64,
    mem_size: u64,
    offset: u64,
    is_code: bool,
}

pub(crate) struct Executable<'a> {
    pub(crate) bytes: &'a [u8],
    pub(crate) format: Format,
    ranges: Vec<Range>,
    /// What a 64-bit pointer is relative to. In a PE the addresses of the table are relative to the image base.
    pub(crate) pointer_base: u64,
    /// The lowest address of the image, and the one after the highest.
    pub(crate) low: u64,
    pub(crate) high: u64,
    /// Mach-O: the GOT, whose pointers are weak.
    got: (u64, u64),
    /// Mach-O: `LC_DYLD_CHAINED_FIXUPS`. PE: the base relocations. As {offset in the file, size}.
    loader_pointers: (usize, usize),
}

pub(crate) const PT_LOAD: u32 = 1;
pub(crate) const LC_SYMTAB: u32 = 2;
pub(crate) const LC_SEGMENT_64: u32 = 0x19;
pub(crate) const LC_CODE_SIGNATURE: u32 = 0x1d;
pub(crate) const LC_DYLD_CHAINED_FIXUPS: u32 = 0x8000_0034;
pub(crate) const DYLD_CHAINED_PTR_64: u16 = 2;
pub(crate) const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
pub(crate) const IMAGE_REL_BASED_DIR64: u16 = 10;

/// A name in a fixed-size field, padded with NUL.
pub(crate) fn fixed_name(field: &[u8]) -> &[u8] {
    &field[..field.iter().position(|&b| b == 0).unwrap_or(field.len())]
}

impl<'a> Executable<'a> {
    pub(crate) fn open(bytes: &'a [u8]) -> Result<Self> {
        let mut exe = Self {
            bytes,
            format: Format {
                container: Container::Elf,
                arch: Arch::X64,
            },
            ranges: Vec::new(),
            pointer_base: 0,
            low: 0,
            high: 0,
            got: (0, 0),
            loader_pointers: (0, 0),
        };
        let unrecognized = |_| Error::UnrecognizedExecutable;
        if bytes.starts_with(b"\x7fELF") {
            // 64-bit, little-endian
            if (u8_at(bytes, 4), u8_at(bytes, 5)) != (Ok(2), Ok(1)) {
                return Err(Error::UnrecognizedExecutable);
            }
            exe.format.arch = match u16_at(bytes, 18).map_err(unrecognized)? {
                62 => Arch::X64,
                183 => Arch::Arm64,
                _ => return Err(Error::UnrecognizedExecutable),
            };
            exe.open_elf()?;
        } else if u32_at(bytes, 0).map_err(unrecognized)? == 0xfeed_facf {
            exe.format.container = Container::MachO;
            exe.format.arch = match u32_at(bytes, 4).map_err(unrecognized)? {
                0x0100_0007 => Arch::X64,
                0x0100_000c => Arch::Arm64,
                _ => return Err(Error::UnrecognizedExecutable),
            };
            exe.open_macho()?;
        } else if bytes.starts_with(b"MZ") {
            exe.format.container = Container::Pe;
            exe.open_pe()?;
        } else {
            return Err(Error::UnrecognizedExecutable);
        }
        exe.low = exe
            .ranges
            .iter()
            .map(|r| r.addr)
            .min()
            .ok_or(Error::InvalidExecutable)?;
        exe.high = exe
            .ranges
            .iter()
            .map(|r| r.addr.saturating_add(r.mem_size))
            .max()
            .ok_or(Error::InvalidExecutable)?;
        for r in &exe.ranges {
            let end = r
                .offset
                .checked_add(r.file_size)
                .ok_or(Error::InvalidExecutable)?;
            if end > bytes.len() as u64 || r.addr.checked_add(r.file_size).is_none() {
                return Err(Error::InvalidExecutable);
            }
        }
        Ok(exe)
    }

    fn open_elf(&mut self) -> Result<()> {
        let b = self.bytes;
        let phoff = usize_at(b, 0x20)?;
        for i in 0..usize::from(u16_at(b, 0x38)?) {
            let at = phoff + i * 56;
            if u32_at(b, at)? != PT_LOAD {
                continue;
            }
            self.ranges.push(Range {
                addr: u64_at(b, at + 16)?,
                file_size: u64_at(b, at + 32)?,
                mem_size: u64_at(b, at + 40)?,
                offset: u64_at(b, at + 8)?,
                is_code: u32_at(b, at + 4)? & 1 != 0,
            });
        }
        Ok(())
    }

    fn open_macho(&mut self) -> Result<()> {
        let b = self.bytes;
        let mut at = 32;
        for _ in 0..u32_at(b, 16)? {
            let command = u32_at(b, at)?;
            if command == LC_DYLD_CHAINED_FIXUPS {
                self.loader_pointers = (u32_at(b, at + 8)? as usize, u32_at(b, at + 12)? as usize);
            } else if command == LC_SEGMENT_64
                && u64_at(b, at + 48)? != 0
                && fixed_name(slice(b, at + 8, 16)?) != b"__LINKEDIT"
            {
                self.ranges.push(Range {
                    addr: u64_at(b, at + 24)?,
                    file_size: u64_at(b, at + 48)?,
                    mem_size: u64_at(b, at + 32)?,
                    offset: u64_at(b, at + 40)?,
                    is_code: false,
                });
                for s in 0..u32_at(b, at + 64)? as usize {
                    let header = at + 72 + s * 80;
                    if fixed_name(slice(b, header, 16)?) == b"__got" {
                        self.got = (u64_at(b, header + 32)?, u64_at(b, header + 40)?);
                    }
                }
            }
            at += u32_at(b, at + 4)? as usize;
        }
        Ok(())
    }

    fn open_pe(&mut self) -> Result<()> {
        let b = self.bytes;
        let pe = u32_at(b, 0x3c)? as usize;
        let optional = pe + 24;
        // "PE\0\0", PE32+
        if (slice(b, pe, 4), u16_at(b, optional)) != (Ok(&b"PE\0\0"[..]), Ok(0x20b)) {
            return Err(Error::UnrecognizedExecutable);
        }
        self.format.arch = match u16_at(b, pe + 4)? {
            0x8664 => Arch::X64,
            0xaa64 => Arch::Arm64,
            _ => return Err(Error::UnrecognizedExecutable),
        };
        self.pointer_base = u64_at(b, optional + 24)?;
        let headers = u64::from(u32_at(b, optional + 60)?);
        self.ranges.push(Range {
            addr: 0,
            file_size: headers,
            mem_size: headers,
            offset: 0,
            is_code: false,
        });
        let first = optional + usize::from(u16_at(b, pe + 20)?);
        for i in 0..usize::from(u16_at(b, pe + 6)?) {
            let header = first + i * 40;
            if slice(b, header, 8)? == PE_TABLE_SECTION {
                continue;
            }
            self.ranges.push(Range {
                addr: u32_at(b, header + 12)?.into(),
                file_size: u32_at(b, header + 16)?.into(),
                mem_size: u32_at(b, header + 8)?.into(),
                offset: u32_at(b, header + 20)?.into(),
                is_code: false,
            });
        }
        let directory = optional + 112 + IMAGE_DIRECTORY_ENTRY_BASERELOC * 8;
        let table = self
            .file_offset(u32_at(b, directory)?.into())
            .ok_or(Error::InvalidExecutable)?;
        self.loader_pointers = (table, u32_at(b, directory + 4)? as usize);
        Ok(())
    }

    /// Where in the file the byte at `address` is, if the file holds it.
    pub(crate) fn file_offset(&self, address: u64) -> Option<usize> {
        self.ranges
            .iter()
            .find(|r| address >= r.addr && address - r.addr < r.file_size)
            .map(|r| (r.offset + (address - r.addr)) as usize)
    }

    /// The bytes of `[address, address + length)`, which have to lie in one range.
    pub(crate) fn at(&self, address: u64, length: u64) -> Result<&'a [u8]> {
        let r = self
            .ranges
            .iter()
            .find(|r| address >= r.addr && address - r.addr < r.file_size)
            .ok_or(Error::InvalidExecutable)?;
        if length > r.file_size - (address - r.addr) {
            return Err(Error::InvalidExecutable);
        }
        slice(
            self.bytes,
            (r.offset + (address - r.addr)) as usize,
            length as usize,
        )
    }

    pub(crate) fn is_weak_slot(&self, address: u64) -> bool {
        address >= self.got.0 && address - self.got.0 < self.got.1
    }

    /// Calls `each` with every place where a 64-bit pointer may be: the ones the loader is told about, or, in an ELF that
    /// is not position independent, every aligned word of data.
    pub(crate) fn for_each_pointer(&self, mut each: impl FnMut(u64) -> Result<()>) -> Result<()> {
        let b = self.bytes;
        match self.format.container {
            Container::Elf => {
                for r in self.ranges.iter().filter(|r| !r.is_code) {
                    let mut address = r.addr.next_multiple_of(8);
                    while address + 8 <= r.addr + r.file_size {
                        each(address)?;
                        address += 8;
                    }
                }
            }
            Container::MachO => {
                // The fixup chains: a pointer holds the distance to the next one of its page.
                let base = self.ranges.first().ok_or(Error::InvalidExecutable)?.addr;
                let fixups = self.loader_pointers.0;
                let starts = fixups + u32_at(b, fixups + 4)? as usize;
                for i in 0..u32_at(b, starts)? as usize {
                    let offset = u32_at(b, starts + 4 + 4 * i)? as usize;
                    if offset == 0 {
                        continue;
                    }
                    let in_segment = starts + offset;
                    if u16_at(b, in_segment + 6)? != DYLD_CHAINED_PTR_64 {
                        return Err(Error::InvalidExecutable);
                    }
                    let page_size = u64::from(u16_at(b, in_segment + 4)?);
                    let segment = base + u64_at(b, in_segment + 8)?;
                    for page in 0..u16_at(b, in_segment + 20)? {
                        let first = u16_at(b, in_segment + 22 + 2 * usize::from(page))?;
                        if first == 0xffff {
                            continue;
                        }
                        let mut address = segment + u64::from(page) * page_size + u64::from(first);
                        loop {
                            let value = u64_at(self.at(address, 8)?, 0)?;
                            if value >> 63 == 0 {
                                each(address)?; // else it is bound to an import
                            }
                            let next = (value >> 51) & 0xfff;
                            if next == 0 {
                                break;
                            }
                            address += next * 4;
                        }
                    }
                }
            }
            Container::Pe => {
                let (table, size) = self.loader_pointers;
                let mut block = table;
                while block < table + size {
                    let block_size = u32_at(b, block + 4)? as usize;
                    if block_size < 8 {
                        return Err(Error::InvalidExecutable);
                    }
                    let page = u64::from(u32_at(b, block)?);
                    for entry in (block + 8..block + block_size).step_by(2) {
                        let entry = u16_at(b, entry)?;
                        if entry >> 12 == IMAGE_REL_BASED_DIR64 {
                            each(page + u64::from(entry & 0xfff))?;
                        }
                    }
                    block += block_size;
                }
            }
        }
        Ok(())
    }

    /// The compressed table.
    pub(crate) fn table_section(&self) -> Result<&'a [u8]> {
        match self.find_table_section()? {
            [] => Err(Error::MissingTable),
            table => Ok(table),
        }
    }

    fn find_table_section(&self) -> Result<&'a [u8]> {
        let b = self.bytes;
        match self.format.container {
            Container::Elf => {
                let last = usize::from(u16_at(b, 0x3c)?)
                    .checked_sub(1)
                    .ok_or(Error::MissingTable)?;
                let header = usize_at(b, 0x28)? + last * 64;
                if u32_at(b, header + 4)? != SHT_BUN_FEATURE_TABLE {
                    return Err(Error::MissingTable);
                }
                slice(b, usize_at(b, header + 24)?, usize_at(b, header + 32)?)
            }
            Container::MachO => {
                let mut at = 32;
                for _ in 0..u32_at(b, 16)? {
                    if u32_at(b, at)? == LC_SYMTAB {
                        let strings = slice(
                            b,
                            u32_at(b, at + 16)? as usize,
                            u32_at(b, at + 20)? as usize,
                        )?;
                        let (rest, trailer) =
                            strings.split_last_chunk::<8>().ok_or(Error::MissingTable)?;
                        let (rest, length) =
                            rest.split_last_chunk::<8>().ok_or(Error::MissingTable)?;
                        if trailer != MACHO_TABLE_TRAILER {
                            return Err(Error::MissingTable);
                        }
                        let padded = u64::from_le_bytes(*length).next_multiple_of(16);
                        let start = (rest.len() as u64)
                            .checked_sub(padded)
                            .ok_or(Error::InvalidExecutable)?;
                        return slice(rest, start as usize, u64::from_le_bytes(*length) as usize);
                    }
                    at += u32_at(b, at + 4)? as usize;
                }
                Err(Error::MissingTable)
            }
            Container::Pe => {
                let pe = u32_at(b, 0x3c)? as usize;
                let first = pe + 24 + usize::from(u16_at(b, pe + 20)?);
                for i in 0..usize::from(u16_at(b, pe + 6)?) {
                    let header = first + i * 40;
                    if slice(b, header, 8)? == PE_TABLE_SECTION {
                        return slice(
                            b,
                            u32_at(b, header + 20)? as usize,
                            u32_at(b, header + 8)? as usize,
                        );
                    }
                }
                Err(Error::MissingTable)
            }
        }
    }
}

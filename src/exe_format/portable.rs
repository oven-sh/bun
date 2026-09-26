//! The packed portable image of `--target=bun-portable-{arch}`; misctools/portable/launch/tools/format.ts has the layout.

use core::mem::{offset_of, size_of};

use bun_core::strings;

use crate::elf::{ElfError, ElfFile};
use crate::macho::{
    CSMAGIC_CODEDIRECTORY, CSMAGIC_EMBEDDED_SIGNATURE, CSSLOT_CODEDIRECTORY,
    SEC_CODE_SIGNATURE_HASH_SHA256, sha256_hash,
};
use crate::macho_types::{BlobIndex, CodeDirectory, SuperBlob};
use crate::pe::{OPTIONAL_HEADER_MAGIC_64, OptionalHeader64, PE_SIGNATURE, PEHeader};
use crate::{align_up, read_struct, write_struct};

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum PortableError {
    #[error("the file does not end with the table of contents of a packed portable image")]
    NotAPackedImage,
    #[error("the table of contents has version {0}, this bun reads and writes version 1")]
    UnsupportedVersion(u32),
    #[error("the table of contents names parts that are not in the file")]
    InvalidTableOfContents,
    #[error("the image is not an ELF file for the processor that the table of contents names")]
    InvalidImage,
    #[error(
        "the shell script does not name the length of the image that the table of contents has"
    )]
    ScriptWithoutImageLength,
    #[error("the shell script has no room for the length of the image")]
    ScriptFull,
    #[error("there is no PE header where the table of contents says the shell script ends")]
    InvalidPEHeader,
    #[error("the image would exceed 4 GiB, which its code signature cannot cover")]
    TooLargeToSign,
    #[error("{0}")]
    Elf(#[from] ElfError),
}

const TOC_MAGIC: [u8; 8] = *b"BUNPACK1";
const TOC_VERSION: u32 = 1;
const IMAGE_ALIGN: u64 = 0x10000;
/// The signed range is whole pages of macOS on arm64.
const APPLE_PAGE: u64 = 0x4000;
const HASH_PAGE: usize = 0x1000;
/// Behind the quoted string that holds `e_lfanew`.
const SCRIPT_START: usize = 0x42;
const SCRIPT_IMAGE_LEN: &[u8] = b"image_len=";
const SIGNATURE_IDENTIFIER: &[u8] = b"bun.portable.image\0";
const SIGNATURE_HASH_SIZE: usize = 32;
const CS_ADHOC_LINKER_SIGNED: u32 = 0x20002;

/// The last 128 bytes of the file, little endian.
#[repr(C)]
#[derive(Clone, Copy)]
struct TableOfContents {
    magic: [u8; 8],
    version: u32,
    size: u32,
    file_size: u64,
    /// ELF machine number of the image.
    arch: u64,
    /// `e_lfanew`: the shell script ends and the PE header starts here.
    header_size: u64,
    image_off: u64,
    image_len: u64,
    /// The range of the code signature; these four are 0 in a file without one.
    code_off: u64,
    code_len: u64,
    sig_off: u64,
    sig_len: u64,
    stub_linux_off: u64,
    stub_linux_len: u64,
    stub_macos_off: u64,
    stub_macos_len: u64,
    magic_end: [u8; 8],
}

const TOC_SIZE: usize = size_of::<TableOfContents>();
const _: () = assert!(TOC_SIZE == 128);

pub struct PackedImage {
    /// The file in front of the image: the shell script, the Windows host and the loader stubs.
    head: Vec<u8>,
    image: Box<ElfFile>,
    toc: TableOfContents,
}

impl PackedImage {
    /// `data` is the whole file, which `--compile-executable-path` lets be any file.
    pub fn init(mut data: Vec<u8>) -> Result<PackedImage, PortableError> {
        let Some(toc_off) = data.len().checked_sub(TOC_SIZE) else {
            return Err(PortableError::NotAPackedImage);
        };
        let toc: TableOfContents = read_struct(&data[toc_off..]);
        if toc.magic != TOC_MAGIC || toc.magic_end != TOC_MAGIC {
            return Err(PortableError::NotAPackedImage);
        }
        if toc.version != TOC_VERSION || toc.size as usize != TOC_SIZE {
            return Err(PortableError::UnsupportedVersion(toc.version));
        }

        let toc_off = toc_off as u64;
        let image_end = toc.image_off.checked_add(toc.image_len);
        let parts_fit = toc.file_size == toc_off + TOC_SIZE as u64
            && toc.image_off.is_multiple_of(IMAGE_ALIGN)
            && (SCRIPT_START as u64) < toc.header_size
            && toc.header_size < toc.image_off
            && image_end.is_some_and(|end| end <= toc_off);
        let signature_fits = toc.sig_len == 0
            || (toc.code_off == toc.image_off
                && image_end.is_some_and(|end| align_up(end, APPLE_PAGE) == toc.sig_off)
                && toc.code_off.checked_add(toc.code_len) == Some(toc.sig_off)
                && toc
                    .sig_off
                    .checked_add(toc.sig_len)
                    .is_some_and(|end| end <= toc_off));
        if !parts_fit || !signature_fits {
            return Err(PortableError::InvalidTableOfContents);
        }

        let mut image = data.split_off(toc.image_off as usize);
        image.truncate(toc.image_len as usize);
        let image = ElfFile::init(image).map_err(|_| PortableError::InvalidImage)?;
        if u64::from(image.machine()) != toc.arch {
            return Err(PortableError::InvalidImage);
        }

        Ok(PackedImage {
            head: data,
            image,
            toc,
        })
    }

    /// ELF machine number of the image.
    pub fn machine(&self) -> u16 {
        self.image.machine()
    }

    /// `ElfFile::write_bun_section` on the image.
    pub fn write_bun_section(&mut self, payload: &[u8]) -> Result<(), PortableError> {
        self.image.write_bun_section(payload)?;
        let image_len = self.image.data.len() as u64;
        if self.toc.sig_len != 0 && align_up(image_len, APPLE_PAGE) > u64::from(u32::MAX) {
            return Err(PortableError::TooLargeToSign);
        }
        self.write_image_len_in_script(image_len)?;
        self.toc.image_len = image_len;
        Ok(())
    }

    /// The subsystem of the Windows host in the file.
    pub fn set_subsystem(&mut self, subsystem: u16) -> Result<(), PortableError> {
        let pe_header = self.toc.header_size as usize;
        let optional_header = pe_header + size_of::<PEHeader>();
        if optional_header + size_of::<OptionalHeader64>() > self.head.len() {
            return Err(PortableError::InvalidPEHeader);
        }
        let signature = read_struct::<PEHeader>(&self.head[pe_header..]).signature;
        let magic = read_struct::<OptionalHeader64>(&self.head[optional_header..]).magic;
        if signature != PE_SIGNATURE || magic != OPTIONAL_HEADER_MAGIC_64 {
            return Err(PortableError::InvalidPEHeader);
        }
        let field = optional_header + offset_of!(OptionalHeader64, subsystem);
        self.head[field..][..2].copy_from_slice(&subsystem.to_le_bytes());
        Ok(())
    }

    /// The script assigns the length to `image_len`; the comment that fills it up to the PE header gives or takes the room.
    fn write_image_len_in_script(&mut self, image_len: u64) -> Result<(), PortableError> {
        let header_size = self.toc.header_size as usize;
        let script = &self.head[..header_size];

        let number_start = strings::index_of(&script[SCRIPT_START..], SCRIPT_IMAGE_LEN)
            .map(|at| SCRIPT_START + at + SCRIPT_IMAGE_LEN.len())
            .ok_or(PortableError::ScriptWithoutImageLength)?;
        let number_len = script[number_start..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        let number_end = number_start + number_len;
        let mut buffer = [0u8; 20];
        if decimal(self.toc.image_len, &mut buffer) != &script[number_start..number_end] {
            return Err(PortableError::ScriptWithoutImageLength);
        }
        let number = decimal(image_len, &mut buffer);

        let dashes = script
            .get(number_end..header_size - 1)
            .ok_or(PortableError::ScriptWithoutImageLength)?
            .iter()
            .rev()
            .take_while(|byte| **byte == FILLER)
            .count();
        let comment = header_size - 1 - dashes;
        let has_comment = script[header_size - 1] == b'\n'
            && comment >= number_end + 2
            && script[comment - 1] == b'#'
            && script[comment - 2] == b'\n';
        let filler_start = if has_comment {
            comment - 1
        } else {
            header_size
        };

        let text_len = filler_start - number_len + number.len();
        let Some(room) = header_size.checked_sub(text_len) else {
            return Err(PortableError::ScriptFull);
        };
        let mut written: Vec<u8> = Vec::with_capacity(header_size - number_start);
        written.extend_from_slice(number);
        written.extend_from_slice(&script[number_end..filler_start]);
        if room >= 2 {
            written.push(b'#');
            written.resize(written.len() + room - 2, FILLER);
        }
        if room >= 1 {
            written.push(b'\n');
        }
        debug_assert_eq!(written.len(), header_size - number_start);
        self.head[number_start..header_size].copy_from_slice(&written);
        Ok(())
    }

    /// The table of contents of the file that `write` writes.
    fn table_of_contents(&self) -> TableOfContents {
        let mut toc = self.toc;
        toc.image_len = self.image.data.len() as u64;
        let mut end = toc.image_off + toc.image_len;
        if toc.sig_len != 0 {
            toc.code_len = align_up(toc.image_len, APPLE_PAGE);
            toc.sig_off = toc.code_off + toc.code_len;
            toc.sig_len = signature_size(toc.code_len as usize) as u64;
            end = toc.sig_off + toc.sig_len;
        }
        toc.file_size = align_up(end, 8) + TOC_SIZE as u64;
        toc
    }

    /// Writes the file and returns its length; a file that came with a code signature gets one of the image as it is now.
    pub fn write(&self, writer: &mut impl std::io::Write) -> crate::Result<usize> {
        let toc = self.table_of_contents();
        let image: &[u8] = &self.image.data;

        writer.write_all(&self.head)?;
        writer.write_all(image)?;
        let mut end = toc.image_off + toc.image_len;
        if toc.sig_len != 0 {
            write_zeroes(writer, toc.sig_off - end)?;
            writer.write_all(&sign(image, toc.code_len as usize))?;
            end = toc.sig_off + toc.sig_len;
        }
        write_zeroes(writer, toc.file_size - TOC_SIZE as u64 - end)?;
        let mut bytes = [0u8; TOC_SIZE];
        write_struct(&mut bytes, &toc);
        writer.write_all(&bytes)?;
        Ok(toc.file_size as usize)
    }
}

const FILLER: u8 = b'-';

fn write_zeroes(writer: &mut impl std::io::Write, mut count: u64) -> std::io::Result<()> {
    const ZEROES: [u8; HASH_PAGE] = [0; HASH_PAGE];
    while count > 0 {
        let piece = count.min(ZEROES.len() as u64) as usize;
        writer.write_all(&ZEROES[..piece])?;
        count -= piece as u64;
    }
    Ok(())
}

fn decimal(value: u64, buffer: &mut [u8; 20]) -> &[u8] {
    let mut at = buffer.len();
    let mut rest = value;
    loop {
        at -= 1;
        buffer[at] = b'0' + (rest % 10) as u8;
        rest /= 10;
        if rest == 0 {
            return &buffer[at..];
        }
    }
}

fn signature_size(code_len: usize) -> usize {
    size_of::<SuperBlob>()
        + size_of::<BlobIndex>()
        + size_of::<CodeDirectory>()
        + SIGNATURE_IDENTIFIER.len()
        + code_len.div_ceil(HASH_PAGE) * SIGNATURE_HASH_SIZE
}

/// The ad-hoc code signature of `image` and the zeroes that fill it up to `code_len`, as apple_sign.ts of the launch tools writes it.
fn sign(image: &[u8], code_len: usize) -> Vec<u8> {
    let pages = code_len.div_ceil(HASH_PAGE);
    let hash_offset = size_of::<CodeDirectory>() + SIGNATURE_IDENTIFIER.len();
    let code_directory_len = hash_offset + pages * SIGNATURE_HASH_SIZE;
    let code_directory_offset = size_of::<SuperBlob>() + size_of::<BlobIndex>();
    let total = code_directory_offset + code_directory_len;

    let super_blob = SuperBlob {
        magic: CSMAGIC_EMBEDDED_SIGNATURE.to_be(),
        length: (total as u32).to_be(),
        count: 1u32.to_be(),
    };
    let blob_index = BlobIndex {
        type_: CSSLOT_CODEDIRECTORY.to_be(),
        offset: (code_directory_offset as u32).to_be(),
    };
    let code_directory = CodeDirectory {
        magic: CSMAGIC_CODEDIRECTORY.to_be(),
        length: (code_directory_len as u32).to_be(),
        version: 0x20400u32.to_be(),
        flags: CS_ADHOC_LINKER_SIGNED.to_be(),
        hash_offset: (hash_offset as u32).to_be(),
        ident_offset: (size_of::<CodeDirectory>() as u32).to_be(),
        n_special_slots: 0,
        n_code_slots: (pages as u32).to_be(),
        code_limit: (code_len as u32).to_be(),
        hash_size: SIGNATURE_HASH_SIZE as u8,
        hash_type: SEC_CODE_SIGNATURE_HASH_SHA256,
        platform: 0,
        page_size: HASH_PAGE.trailing_zeros() as u8,
        spare2: 0,
        scatter_offset: 0,
        team_offset: 0,
        spare3: 0,
        code_limit_64: 0,
        exec_seg_base: 0,
        exec_seg_limit: (code_len as u64).to_be(),
        exec_seg_flags: 0,
    };

    let mut blob: Vec<u8> = Vec::with_capacity(total);
    blob.extend_from_slice(bun_core::bytes_of(&super_blob));
    blob.extend_from_slice(bun_core::bytes_of(&blob_index));
    blob.extend_from_slice(bun_core::bytes_of(&code_directory));
    blob.extend_from_slice(SIGNATURE_IDENTIFIER);

    let mut digest = [0u8; SIGNATURE_HASH_SIZE];
    let (whole_pages, rest) = image.as_chunks::<HASH_PAGE>();
    for page in whole_pages {
        sha256_hash(page, &mut digest);
        blob.extend_from_slice(&digest);
    }
    let mut page = [0u8; HASH_PAGE];
    if !rest.is_empty() {
        page[..rest.len()].copy_from_slice(rest);
        sha256_hash(&page, &mut digest);
        blob.extend_from_slice(&digest);
        page = [0u8; HASH_PAGE];
    }
    sha256_hash(&page, &mut digest);
    for _ in image.len().div_ceil(HASH_PAGE)..pages {
        blob.extend_from_slice(&digest);
    }
    debug_assert_eq!(blob.len(), total);
    blob
}

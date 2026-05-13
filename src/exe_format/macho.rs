use core::mem::size_of;

// `std.macho` types ported locally (see macho_types.rs).
use crate::align_up as align_size;
use crate::macho_types as macho;
use crate::macho_types::{BlobIndex, CodeDirectory, SuperBlob};
use crate::{read_struct, write_struct};

use bun_core::env_var::feature_flag;

pub const SEGNAME_BUN: [u8; 16] = *b"__BUN\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
pub const SECTNAME: [u8; 16] = *b"__bun\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";

#[derive(Debug, Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum MachoError {
    #[error("InvalidObject")]
    InvalidObject,
    #[error("MissingLinkeditSegment")]
    MissingLinkeditSegment,
    #[error("OffsetOutOfRange")]
    OffsetOutOfRange,
    #[error("OffsetOverflow")]
    OffsetOverflow,
    #[error("InvalidLinkeditOffset")]
    InvalidLinkeditOffset,
    #[error("OverlappingSegments")]
    OverlappingSegments,
    #[error("MissingRequiredSegment")]
    MissingRequiredSegment,
    #[error("OutOfMemory")]
    OutOfMemory,
}
bun_core::named_error_set!(MachoError);
bun_core::oom_from_alloc!(MachoError);

pub struct MachoFile {
    pub header: macho::mach_header_64,
    pub data: Vec<u8>,
    pub segment: macho::segment_command_64,
    pub section: macho::section_64,
}

#[allow(dead_code)]
struct LoadCommand {
    cmd: u32,
    cmdsize: u32,
    offset: usize,
}

/// Port of Zig `Shifter.shift(value, comptime fields)` — `inline for` + `@field` over a
/// comptime field-name list. Expands to one `shift_one` call per named field.
macro_rules! shift_fields {
    ($shifter:expr, $value:expr, $($field:ident),+ $(,)?) => {{
        $( $shifter.shift_one(&mut $value.$field)?; )+
    }};
}

impl MachoFile {
    pub fn init(
        obj_file: &[u8],
        blob_to_embed_length: usize,
    ) -> Result<Box<MachoFile>, MachoError> {
        let mut data: Vec<u8> = Vec::with_capacity(obj_file.len() + blob_to_embed_length);
        data.extend_from_slice(obj_file);

        // data.len() >= sizeof(mach_header_64) is assumed by caller (obj_file is a Mach-O);
        // the slice index panics on a short input rather than reading OOB.
        let header: macho::mach_header_64 =
            read_struct(&data[..size_of::<macho::mach_header_64>()]);

        Ok(Box::new(MachoFile {
            header,
            data,
            // SAFETY: all-zero is a valid segment_command_64 / section_64 (#[repr(C)] POD, no NonZero/NonNull fields)
            segment: unsafe { bun_core::ffi::zeroed_unchecked() },
            section: unsafe { bun_core::ffi::zeroed_unchecked() },
        }))
    }

    // Zig `deinit` only frees `data` and destroys self — both handled by Drop on Vec/Box.

    pub fn write_section(&mut self, data: &[u8]) -> Result<(), MachoError> {
        let blob_alignment: u64 = 16 * 1024;
        const PAGE_SIZE: u64 = 1 << 12;
        const HASH_SIZE: usize = 32; // SHA256 = 32 bytes

        let header_size = size_of::<u64>() as u64;
        let total_size = header_size + data.len() as u64;
        let aligned_size = align_size(total_size, blob_alignment);

        // Look for existing __BUN,__BUN section

        let mut original_fileoff: u64 = 0;
        let mut original_vmaddr: u64 = 0;
        let mut original_data_end: u64 = 0;
        let mut original_segsize: u64 = blob_alignment;

        // Use an index instead of a pointer to avoid issues with resizing the arraylist later.
        let mut code_sign_cmd_idx: Option<usize> = None;
        let mut linkedit_seg_idx: Option<usize> = None;

        let mut found_bun = false;

        // PORT NOTE: reshaped for borrowck — capture base ptr as usize before iterating so we can
        // compute byte offsets without holding a borrow of self.data across the mutable writes below.
        let base_addr = self.data.as_ptr() as usize;
        let mut iter = self.iterator();

        while let Some(entry) = iter.next() {
            let cmd = entry.hdr;
            match cmd.cmd {
                macho::LC::SEGMENT_64 => {
                    let command = entry
                        .cast::<macho::segment_command_64>()
                        .expect("unreachable");
                    if command.seg_name() == b"__BUN" {
                        if command.nsects > 0 {
                            let section_offset = entry.data.as_ptr() as usize - base_addr;
                            // SAFETY: sections array immediately follows segment_command_64 in the load
                            // command buffer; `nsects` entries are guaranteed by the Mach-O format.
                            let sections: &mut [macho::section_64] = unsafe {
                                core::slice::from_raw_parts_mut(
                                    self.data
                                        .as_mut_ptr()
                                        .add(
                                            section_offset + size_of::<macho::segment_command_64>(),
                                        )
                                        .cast::<macho::section_64>(),
                                    command.nsects as usize,
                                )
                            };
                            for sect in sections.iter_mut() {
                                if sect.sect_name() == b"__bun" {
                                    found_bun = true;
                                    original_fileoff = sect.offset as u64;
                                    original_vmaddr = sect.addr;
                                    original_data_end = command.fileoff + command.filesize;
                                    original_segsize = command.filesize;
                                    self.segment = command;
                                    self.section = *sect;

                                    // Update segment with proper sizes and alignment
                                    self.segment.vmsize =
                                        align_vmsize(aligned_size, blob_alignment);
                                    self.segment.filesize = aligned_size;
                                    self.segment.maxprot = macho::PROT::READ | macho::PROT::WRITE;
                                    self.segment.initprot = macho::PROT::READ | macho::PROT::WRITE;

                                    self.section = macho::section_64 {
                                        sectname: SECTNAME,
                                        segname: SEGNAME_BUN,
                                        addr: original_vmaddr,
                                        size: total_size,
                                        offset: u32::try_from(original_fileoff).expect("int cast"),
                                        align: (blob_alignment as f64).log2() as u32,
                                        reloff: 0,
                                        nreloc: 0,
                                        flags: macho::S_REGULAR | macho::S_ATTR_NO_DEAD_STRIP,
                                        reserved1: 0,
                                        reserved2: 0,
                                        reserved3: 0,
                                    };
                                    // SAFETY: entry.data points into self.data's load-command region; we
                                    // overwrite the segment_command_64 in place (unaligned, mirroring Zig *align(1)).
                                    unsafe {
                                        let entry_ptr: *mut u8 = entry.data.as_ptr().cast_mut();
                                        core::ptr::write_unaligned(
                                            entry_ptr.cast::<macho::segment_command_64>(),
                                            self.segment,
                                        );
                                    }
                                    *sect = self.section;
                                }
                            }
                        }
                    } else if command.seg_name() == SEG_LINKEDIT {
                        linkedit_seg_idx = Some(entry.data.as_ptr() as usize - base_addr);
                    }
                }
                macho::LC::CODE_SIGNATURE => {
                    code_sign_cmd_idx = Some(entry.data.as_ptr() as usize - base_addr);
                }
                _ => {}
            }
        }

        if !found_bun {
            return Err(MachoError::InvalidObject);
        }

        // Calculate how much larger/smaller the section will be compared to its current size
        let size_diff: i64 = i64::try_from(aligned_size).expect("int cast")
            - i64::try_from(original_segsize).expect("int cast");

        // We assume that the section is page-aligned, so we can calculate the number of new pages
        debug_assert!(size_diff % PAGE_SIZE as i64 == 0);
        let num_of_new_pages = size_diff / PAGE_SIZE as i64;

        // Pre-grow the backing buffer to fit: the `size_diff` bytes of new section
        // content and one SHA-256 hash per new page. `buildAndSign` may grow further
        // to write the complete signature, but reserving this up front avoids the
        // common reallocation.
        self.data.reserve(
            usize::try_from(size_diff + num_of_new_pages * HASH_SIZE as i64).expect("int cast"),
        );

        let linkedit_seg_idx = match linkedit_seg_idx {
            Some(idx) => idx,
            None => return Err(MachoError::MissingLinkeditSegment),
        };

        let mut sig_size: usize = 0;

        // SAFETY: we just reserved `size_diff` bytes; new_len <= capacity. The newly-exposed bytes
        // are written below before being read (memmove + memset cover the whole range).
        let prev_len = self.data.len();
        unsafe {
            self.data
                .set_len(prev_len + usize::try_from(size_diff).expect("int cast"));
        }

        // Binary is:
        // [header][...data before __BUN][__BUN][...data after __BUN]
        // We need to shift [...data after __BUN] forward by size_diff bytes.
        // SAFETY: source and destination overlap; ptr::copy (memmove) handles this. Ranges are
        // within self.data per the offset arithmetic above.
        unsafe {
            let after_bun_dst = self
                .data
                .as_mut_ptr()
                .add((original_data_end as usize) + usize::try_from(size_diff).expect("int cast"));
            let prev_after_bun_src = self
                .data
                .as_ptr()
                .add(original_fileoff as usize + original_segsize as usize);
            let prev_after_bun_len =
                prev_len - (original_fileoff as usize + original_segsize as usize);
            core::ptr::copy(prev_after_bun_src, after_bun_dst, prev_after_bun_len);
        }

        // Now we copy the u64 size header (8 bytes for alignment)
        self.data[original_fileoff as usize..][..8]
            .copy_from_slice(&(data.len() as u64).to_le_bytes());

        // Now we copy the data itself
        self.data[original_fileoff as usize + 8..][..data.len()].copy_from_slice(data);

        // Lastly, we zero any of the padding that was added
        let padding_bytes =
            &mut self.data[original_fileoff as usize..][data.len() + 8..aligned_size as usize];
        padding_bytes.fill(0);

        if let Some(idx) = code_sign_cmd_idx {
            let cs: macho::linkedit_data_command =
                read_struct(&self.data[idx..][..size_of::<macho::linkedit_data_command>()]);
            sig_size = cs.datasize as usize;
        }

        if size_diff != 0 {
            // We move the offsets of the LINKEDIT segment ahead by `size_diff`
            let seg_sz = size_of::<macho::segment_command_64>();
            let mut v: macho::segment_command_64 =
                read_struct(&self.data[linkedit_seg_idx..][..seg_sz]);
            v.fileoff += usize::try_from(size_diff).expect("int cast") as u64;
            v.vmaddr += usize::try_from(size_diff).expect("int cast") as u64;
            write_struct(&mut self.data[linkedit_seg_idx..][..seg_sz], &v);
        }

        if let Some(idx) = code_sign_cmd_idx {
            if self.header.cputype == macho::CPU_TYPE_ARM64
                && feature_flag::BUN_NO_CODESIGN_MACHO_BINARY.get() != Some(true)
            {
                // `buildAndSign` replaces the template's signature with one built by
                // `MachoSigner`, whose size depends only on the (possibly-shifted)
                // `cs.dataoff` — not on the template signature's shape. Resize
                // __LINKEDIT and `LC_CODE_SIGNATURE.datasize` to that exact size.
                //
                // This must run even when `size_diff == 0` (bundle fits in the
                // template's existing __BUN slot): the template may have been signed
                // with a different page size / identifier / blob set, so its
                // `cs.datasize` can be smaller than what `sign()` will produce, which
                // the trailing truncation in `sign()` then chops (issue #29120).
                let cs_sz = size_of::<macho::linkedit_data_command>();
                let seg_sz = size_of::<macho::segment_command_64>();

                let mut cs: macho::linkedit_data_command = read_struct(&self.data[idx..][..cs_sz]);
                let new_sig_dataoff: u64 =
                    cs.dataoff as u64 + u64::try_from(size_diff).expect("int cast");
                let new_sig_size = MachoSigner::compute_signature_size(new_sig_dataoff);

                let mut seg: macho::segment_command_64 =
                    read_struct(&self.data[linkedit_seg_idx..][..seg_sz]);

                // The template signature is the tail of __LINKEDIT; swap its footprint.
                // vmsize must be page-aligned and >= filesize, so derive it from the
                // freshly-computed filesize rather than the pre-update vmsize (otherwise
                // an old vmsize that was already page-aligned to a wider page can leave
                // the segment one page larger than necessary).
                seg.filesize = seg.filesize - sig_size as u64 + new_sig_size as u64;
                seg.vmsize = align_size(seg.filesize, PAGE_SIZE);
                write_struct(&mut self.data[linkedit_seg_idx..][..seg_sz], &seg);

                // Stamp datasize directly so the `size_diff == 0` path — which skips
                // `updateLoadCommandOffsets` below — still records the new size.
                cs.datasize = u32::try_from(new_sig_size).expect("int cast");
                write_struct(&mut self.data[idx..][..cs_sz], &cs);
                sig_size = new_sig_size;
            }
        }

        if size_diff != 0 {
            let seg: macho::segment_command_64 = read_struct(
                &self.data[linkedit_seg_idx..][..size_of::<macho::segment_command_64>()],
            );
            let (le_fileoff, le_filesize) = (seg.fileoff, seg.filesize);
            self.update_load_command_offsets(
                original_fileoff,
                u64::try_from(size_diff).expect("int cast"),
                le_fileoff,
                le_filesize,
                sig_size,
            )?;
        }

        self.validate_segments()?;
        Ok(())
    }

    // Helper function to update load command offsets when resizing an existing section
    fn update_load_command_offsets(
        &mut self,
        previous_fileoff: u64,
        size_diff: u64,
        new_linkedit_fileoff: u64,
        new_linkedit_filesize: u64,
        sig_size: usize,
    ) -> Result<(), MachoError> {
        // Validate inputs
        if new_linkedit_fileoff < previous_fileoff {
            return Err(MachoError::InvalidLinkeditOffset);
        }

        const PAGE_SIZE: u64 = 1 << 12;

        // Ensure all offsets are page-aligned
        let aligned_previous = align_size(previous_fileoff, PAGE_SIZE);
        let aligned_linkedit = align_size(new_linkedit_fileoff, PAGE_SIZE);

        let mut iter = self.iterator();

        // Create shifter with validated parameters
        let shifter = Shifter {
            start: aligned_previous,
            amount: size_diff,
            linkedit_fileoff: aligned_linkedit,
            linkedit_filesize: new_linkedit_filesize,
        };

        while let Some(entry) = iter.next() {
            let cmd = entry.hdr;
            let cmd_ptr: *mut u8 = entry.data.as_ptr().cast_mut();

            match cmd.cmd {
                macho::LC::SYMTAB => {
                    // SAFETY: cmd_ptr points into self.data's load-command region; symtab_command is POD.
                    let symtab = unsafe { &mut *cmd_ptr.cast::<macho::symtab_command>() };
                    shift_fields!(shifter, symtab, symoff, stroff);
                }
                macho::LC::DYSYMTAB => {
                    // SAFETY: as above.
                    let dysymtab = unsafe { &mut *cmd_ptr.cast::<macho::dysymtab_command>() };
                    shift_fields!(
                        shifter,
                        dysymtab,
                        tocoff,
                        modtaboff,
                        extrefsymoff,
                        indirectsymoff,
                        extreloff,
                        locreloff
                    );
                }
                macho::LC::DYLD_CHAINED_FIXUPS
                | macho::LC::CODE_SIGNATURE
                | macho::LC::FUNCTION_STARTS
                | macho::LC::DATA_IN_CODE
                | macho::LC::DYLIB_CODE_SIGN_DRS
                | macho::LC::LINKER_OPTIMIZATION_HINT
                | macho::LC::DYLD_EXPORTS_TRIE => {
                    // SAFETY: as above.
                    let linkedit_cmd =
                        unsafe { &mut *cmd_ptr.cast::<macho::linkedit_data_command>() };
                    shift_fields!(shifter, linkedit_cmd, dataoff);

                    // Special handling for code signature
                    if cmd.cmd == macho::LC::CODE_SIGNATURE {
                        // Update the size of the code signature to the newer signature size
                        linkedit_cmd.datasize = u32::try_from(sig_size).expect("int cast");
                    }
                }
                macho::LC::DYLD_INFO | macho::LC::DYLD_INFO_ONLY => {
                    // SAFETY: as above.
                    let dyld_info = unsafe { &mut *cmd_ptr.cast::<macho::dyld_info_command>() };
                    shift_fields!(
                        shifter,
                        dyld_info,
                        rebase_off,
                        bind_off,
                        weak_bind_off,
                        lazy_bind_off,
                        export_off
                    );
                }
                _ => {}
            }
        }
        Ok(())
    }

    pub fn iterator(&self) -> macho::LoadCommandIterator {
        macho::LoadCommandIterator::new(
            self.header.ncmds,
            &self.data[size_of::<macho::mach_header_64>()..][..self.header.sizeofcmds as usize],
        )
    }

    pub fn build(&self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        // PORT NOTE: Zig used `writer: anytype`; std::io::Write is the canonical
        // Rust equivalent (bun_io has no Write trait).
        writer.write_all(&self.data)?;
        Ok(())
    }

    fn validate_segments(&self) -> Result<(), MachoError> {
        let mut iter = self.iterator();
        let mut prev_end: u64 = 0;

        while let Some(entry) = iter.next() {
            let cmd = entry.hdr;
            if cmd.cmd == macho::LC::SEGMENT_64 {
                let seg = entry
                    .cast::<macho::segment_command_64>()
                    .expect("unreachable");
                if seg.fileoff < prev_end {
                    return Err(MachoError::OverlappingSegments);
                }
                prev_end = seg.fileoff + seg.filesize;
            }
        }
        Ok(())
    }

    pub fn build_and_sign(&self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if self.header.cputype == macho::CPU_TYPE_ARM64
            && feature_flag::BUN_NO_CODESIGN_MACHO_BINARY.get() != Some(true)
        {
            let mut data: Vec<u8> = Vec::new();
            self.build(&mut data)?;
            let mut signer = MachoSigner::init(&data)?;
            signer.sign(writer)?;
        } else {
            self.build(writer)?;
        }
        Ok(())
    }
}

struct Shifter {
    start: u64,
    amount: u64,
    linkedit_fileoff: u64,
    linkedit_filesize: u64,
}

impl Shifter {
    fn do_(value: u64, amount: u64, range_min: u64, range_max: u64) -> Result<u64, MachoError> {
        if value == 0 {
            return Ok(0);
        }
        if value < range_min {
            return Err(MachoError::OffsetOutOfRange);
        }
        if value > range_max {
            return Err(MachoError::OffsetOutOfRange);
        }

        // Check for overflow
        if value > u64::MAX - amount {
            return Err(MachoError::OffsetOverflow);
        }

        Ok(value + amount)
    }

    #[inline]
    fn shift_one(&self, field: &mut u32) -> Result<(), MachoError> {
        *field = u32::try_from(Self::do_(
            *field as u64,
            self.amount,
            self.start,
            self.linkedit_fileoff + self.linkedit_filesize,
        )?)
        .unwrap();
        Ok(())
    }
}

pub struct MachoSigner {
    data: Vec<u8>,
    sig_off: usize,
    sig_sz: usize,
    cs_cmd_off: usize,
    linkedit_off: usize,
    linkedit_seg: macho::segment_command_64,
    text_seg: macho::segment_command_64,
}

impl MachoSigner {
    pub fn init(obj: &[u8]) -> Result<Box<MachoSigner>, MachoError> {
        let header_size = size_of::<macho::mach_header_64>();
        let header: macho::mach_header_64 = read_struct(&obj[..header_size]);

        let mut sig_off: usize = 0;
        let mut sig_sz: usize = 0;
        let mut cs_cmd_off: usize = 0;
        let mut linkedit_off: usize = 0;

        // SAFETY: all-zero is a valid segment_command_64 (#[repr(C)] POD)
        let mut text_seg: macho::segment_command_64 = unsafe { bun_core::ffi::zeroed_unchecked() };
        let mut linkedit_seg: macho::segment_command_64 =
            unsafe { bun_core::ffi::zeroed_unchecked() };

        let mut it = macho::LoadCommandIterator::new(
            header.ncmds,
            &obj[header_size..][..header.sizeofcmds as usize],
        );

        // First pass: find segments to establish bounds
        while let Some(cmd) = it.next() {
            if cmd.cmd() == macho::LC::SEGMENT_64 {
                let seg = cmd
                    .cast::<macho::segment_command_64>()
                    .expect("unreachable");

                // Store segment info
                if seg.seg_name() == SEG_LINKEDIT {
                    linkedit_seg = seg;
                    linkedit_off = cmd.data.as_ptr() as usize - obj.as_ptr() as usize;

                    // Validate linkedit is after text
                    if linkedit_seg.fileoff < text_seg.fileoff + text_seg.filesize {
                        return Err(MachoError::InvalidLinkeditOffset);
                    }
                } else if seg.seg_name() == b"__TEXT" {
                    text_seg = seg;
                }
            }
        }

        // Reset iterator
        it = macho::LoadCommandIterator::new(
            header.ncmds,
            &obj[header_size..][..header.sizeofcmds as usize],
        );

        // Second pass: find code signature
        while let Some(cmd) = it.next() {
            match cmd.cmd() {
                macho::LC::CODE_SIGNATURE => {
                    let cs = cmd
                        .cast::<macho::linkedit_data_command>()
                        .expect("unreachable");
                    sig_off = cs.dataoff as usize;
                    sig_sz = cs.datasize as usize;
                    cs_cmd_off = cmd.data.as_ptr() as usize - obj.as_ptr() as usize;
                }
                _ => {}
            }
        }

        if linkedit_off == 0 || sig_off == 0 {
            return Err(MachoError::MissingRequiredSegment);
        }

        let mut data: Vec<u8> = Vec::with_capacity(obj.len());
        data.extend_from_slice(obj);

        Ok(Box::new(MachoSigner {
            data,
            sig_off,
            sig_sz,
            cs_cmd_off,
            linkedit_off,
            linkedit_seg,
            text_seg,
        }))
    }

    // Zig `deinit` only frees `data` and destroys self — both handled by Drop on Vec/Box.

    const IDENTIFIER: &'static [u8] = b"a.out\x00";
    const SIGNATURE_PAGE_SIZE: usize = 1 << 12;
    const SIGNATURE_HASH_SIZE: usize = 32; // SHA256 = 32 bytes

    /// Compute the exact number of bytes that `sign()` will write at `sig_off`
    /// (the `SuperBlob` + `BlobIndex` + `CodeDirectory` + identifier + page
    /// hashes). `writeSection` uses this to size `linkedit_seg.filesize` and
    /// the `LC_CODE_SIGNATURE.datasize` so the signer's output fits exactly
    /// inside __LINKEDIT.
    pub fn compute_signature_size(sig_off: u64) -> usize {
        let total_pages: usize = usize::try_from(
            (sig_off + Self::SIGNATURE_PAGE_SIZE as u64 - 1) / Self::SIGNATURE_PAGE_SIZE as u64,
        )
        .unwrap();
        let super_blob_header_size = size_of::<SuperBlob>();
        let blob_index_size = size_of::<BlobIndex>();
        let code_dir_header_size = size_of::<CodeDirectory>();
        let hash_offset = code_dir_header_size + Self::IDENTIFIER.len();
        let hashes_size = total_pages * Self::SIGNATURE_HASH_SIZE;
        let code_dir_length = hash_offset + hashes_size;
        super_blob_header_size + blob_index_size + code_dir_length
    }

    pub fn sign(&mut self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        const PAGE_SIZE: usize = MachoSigner::SIGNATURE_PAGE_SIZE;
        const HASH_SIZE: usize = MachoSigner::SIGNATURE_HASH_SIZE;

        // Calculate total binary pages before signature
        let total_pages = (self.sig_off + PAGE_SIZE - 1) / PAGE_SIZE;
        let aligned_sig_off = total_pages * PAGE_SIZE;

        // Calculate base signature structure sizes
        let id = Self::IDENTIFIER;
        let super_blob_header_size = size_of::<SuperBlob>();
        let blob_index_size = size_of::<BlobIndex>();
        let code_dir_header_size = size_of::<CodeDirectory>();
        let id_offset = code_dir_header_size;
        let hash_offset = id_offset + id.len();

        // Calculate hash sizes
        let hashes_size = total_pages * HASH_SIZE;
        let code_dir_length = hash_offset + hashes_size;

        // Calculate total signature size
        let sig_structure_size = super_blob_header_size + blob_index_size + code_dir_length;
        debug_assert!(sig_structure_size == Self::compute_signature_size(self.sig_off as u64));
        let total_sig_size = align_size(sig_structure_size as u64, PAGE_SIZE as u64) as usize;

        // Setup SuperBlob
        let super_blob = SuperBlob {
            magic: CSMAGIC_EMBEDDED_SIGNATURE.swap_bytes(),
            length: (sig_structure_size as u32).swap_bytes(),
            count: 1u32.swap_bytes(),
        };

        // Setup BlobIndex
        let blob_index = BlobIndex {
            type_: CSSLOT_CODEDIRECTORY.swap_bytes(),
            offset: ((super_blob_header_size + blob_index_size) as u32).swap_bytes(),
        };

        // Setup CodeDirectory
        // SAFETY: all-zero is a valid CodeDirectory (#[repr(C)] POD)
        let mut code_dir: CodeDirectory = unsafe { bun_core::ffi::zeroed_unchecked() };
        code_dir.magic = CSMAGIC_CODEDIRECTORY.swap_bytes();
        code_dir.length = (code_dir_length as u32).swap_bytes();
        code_dir.version = 0x20400u32.swap_bytes();
        code_dir.flags = 0x20002u32.swap_bytes();
        code_dir.hash_offset = (hash_offset as u32).swap_bytes();
        code_dir.ident_offset = (id_offset as u32).swap_bytes();
        code_dir.n_special_slots = 0;
        code_dir.n_code_slots = (total_pages as u32).swap_bytes();
        code_dir.code_limit = (self.sig_off as u32).swap_bytes();
        code_dir.hash_size = HASH_SIZE as u8;
        code_dir.hash_type = SEC_CODE_SIGNATURE_HASH_SHA256;
        code_dir.page_size = 12; // log2(4096)

        // Get text segment info
        let text_base = align_size(self.text_seg.fileoff, PAGE_SIZE as u64);
        let text_limit = align_size(self.text_seg.filesize, PAGE_SIZE as u64);
        code_dir.exec_seg_base = text_base.swap_bytes();
        code_dir.exec_seg_limit = text_limit.swap_bytes();
        code_dir.exec_seg_flags = CS_EXECSEG_MAIN_BINARY.swap_bytes();

        // Ensure space for signature
        self.data.resize(aligned_sig_off + total_sig_size, 0);
        // SAFETY: sig_off <= aligned_sig_off <= current len; spare bytes were just zeroed by resize.
        unsafe {
            self.data.set_len(self.sig_off);
        }
        // Zero spare capacity (mirrors @memset(self.data.unusedCapacitySlice(), 0) — already zeroed
        // by resize(_, 0) above for the newly-grown region; explicitly zero in case resize shrank).
        // SAFETY: spare_capacity_mut() returns the [len..capacity] slice; writing zeros is sound.
        for b in self.data.spare_capacity_mut() {
            b.write(0);
        }

        // Position writer at signature offset
        // (Zig used `self.data.writer()`; here we extend the Vec directly.)

        // Write signature components — SuperBlob / BlobIndex / CodeDirectory are
        // `NoUninit` (#[repr(C)] POD, no padding); byte-serialized verbatim into
        // the Mach-O signature.
        self.data.extend_from_slice(bun_core::bytes_of(&super_blob));
        self.data.extend_from_slice(bun_core::bytes_of(&blob_index));
        self.data.extend_from_slice(bun_core::bytes_of(&code_dir));
        self.data.extend_from_slice(id);

        // Hash and write pages
        // PORT NOTE: reshaped for borrowck — index instead of slicing self.data while pushing.
        let mut off: usize = 0;
        let end = self.sig_off;
        while end - off >= PAGE_SIZE {
            let mut digest = [0u8; HASH_SIZE];
            // SAFETY: range [off..off+PAGE_SIZE] is within the original len (sig_off).
            let page =
                unsafe { core::slice::from_raw_parts(self.data.as_ptr().add(off), PAGE_SIZE) };
            sha256_hash(page, &mut digest);
            self.data.extend_from_slice(&digest);
            off += PAGE_SIZE;
        }

        if end - off > 0 {
            let remaining_len = end - off;
            let mut last_page = [0u8; PAGE_SIZE];
            // SAFETY: range [off..end] is within the original len.
            unsafe {
                core::ptr::copy_nonoverlapping(
                    self.data.as_ptr().add(off),
                    last_page.as_mut_ptr(),
                    remaining_len,
                );
            }
            let mut digest = [0u8; HASH_SIZE];
            sha256_hash(&last_page, &mut digest);
            self.data.extend_from_slice(&digest);
        }

        // Finally, ensure that the length of data we write matches the total data expected
        let final_len = self
            .linkedit_seg
            .fileoff
            .checked_add(self.linkedit_seg.filesize)
            .and_then(|len| usize::try_from(len).ok())
            .ok_or(MachoError::OffsetOverflow)?;
        if final_len > aligned_sig_off + total_sig_size {
            return Err(MachoError::OffsetOutOfRange.into());
        }
        // SAFETY: final_len is bounded by the initialized length from resize above.
        unsafe {
            self.data.set_len(final_len);
        }

        // Write final binary
        writer.write_all(&self.data)?;
        Ok(())
    }
}

fn align_vmsize(size: u64, page_size: u64) -> u64 {
    align_size(if size > 0x4000 { size } else { 0x4000 }, page_size)
}

const SEG_LINKEDIT: &[u8] = b"__LINKEDIT";

pub mod utils {
    use super::macho;

    pub fn is_elf(data: &[u8]) -> bool {
        if data.len() < 4 {
            return false;
        }
        u32::from_be_bytes(data[0..4].try_into().expect("infallible: size matches")) == 0x7f454c46
    }

    pub fn is_macho(data: &[u8]) -> bool {
        if data.len() < 4 {
            return false;
        }
        u32::from_le_bytes(data[0..4].try_into().expect("infallible: size matches"))
            == macho::MH_MAGIC_64
    }
}

const CSMAGIC_CODEDIRECTORY: u32 = 0xfade0c02;
const CSMAGIC_EMBEDDED_SIGNATURE: u32 = 0xfade0cc0;
const CSSLOT_CODEDIRECTORY: u32 = 0;
const SEC_CODE_SIGNATURE_HASH_SHA256: u8 = 2;
const CS_EXECSEG_MAIN_BINARY: u64 = 0x1;

/// `bun.sha.SHA256.hash(bytes, out, null)`.
#[inline]
fn sha256_hash(bytes: &[u8], out: &mut [u8; 32]) {
    bun_sha_hmac::sha::SHA256::hash(bytes, out, core::ptr::null_mut());
}

// ported from: src/exe_format/macho.zig

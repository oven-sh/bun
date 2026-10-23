use core::mem::{offset_of, size_of};

use super::{
    Checked, MALFORMED, POINTER_SIZE, Payload, PayloadReferenceError, struct_in, table_bytes,
};
use crate::builtins::Image;
use crate::image::AddressRange;
use crate::macho_types::{
    DYLD_CHAINED_PTR_START_NONE, LC, N_SECT, N_STAB, N_TYPE, dyld_chained_fixups_header,
    dyld_chained_starts_in_segment, dyld_info_command, dysymtab_command, linkedit_data_command,
    load_command, mach_header_64, nlist_64, segment_command_64, symtab_command,
};
use crate::read_struct;

const UNSUPPORTED: PayloadReferenceError = PayloadReferenceError::UnsupportedRelocations;
const PAGE_STARTS_OFFSET: usize = offset_of!(dyld_chained_starts_in_segment, first_page_start);
const SYMBOL_SIZE: u64 = size_of::<nlist_64>() as u64;
const OPCODE_MASK: u8 = 0xf0;
const IMMEDIATE_MASK: u8 = 0x0f;

pub(super) mod rebase_opcode {
    pub(crate) const DONE: u8 = 0x00;
    pub(crate) const SET_TYPE_IMM: u8 = 0x10;
    pub(crate) const SET_SEGMENT_AND_OFFSET_ULEB: u8 = 0x20;
    pub(crate) const ADD_ADDR_ULEB: u8 = 0x30;
    pub(crate) const ADD_ADDR_IMM_SCALED: u8 = 0x40;
    pub(crate) const DO_REBASE_IMM_TIMES: u8 = 0x50;
    pub(crate) const DO_REBASE_ULEB_TIMES: u8 = 0x60;
    pub(crate) const DO_REBASE_ADD_ADDR_ULEB: u8 = 0x70;
    pub(crate) const DO_REBASE_ULEB_TIMES_SKIPPING_ULEB: u8 = 0x80;
}

pub(super) mod bind_opcode {
    pub(crate) const DONE: u8 = 0x00;
    pub(crate) const SET_DYLIB_ORDINAL_IMM: u8 = 0x10;
    pub(crate) const SET_DYLIB_ORDINAL_ULEB: u8 = 0x20;
    pub(crate) const SET_DYLIB_SPECIAL_IMM: u8 = 0x30;
    pub(crate) const SET_SYMBOL_TRAILING_FLAGS_IMM: u8 = 0x40;
    pub(crate) const SET_TYPE_IMM: u8 = 0x50;
    pub(crate) const SET_ADDEND_SLEB: u8 = 0x60;
    pub(crate) const SET_SEGMENT_AND_OFFSET_ULEB: u8 = 0x70;
    pub(crate) const ADD_ADDR_ULEB: u8 = 0x80;
    pub(crate) const DO_BIND: u8 = 0x90;
    pub(crate) const DO_BIND_ADD_ADDR_ULEB: u8 = 0xa0;
    pub(crate) const DO_BIND_ADD_ADDR_IMM_SCALED: u8 = 0xb0;
    pub(crate) const DO_BIND_ULEB_TIMES_SKIPPING_ULEB: u8 = 0xc0;
}

const EXPORT_KIND_MASK: u64 = 0x03;
pub(super) const EXPORT_KIND_ABSOLUTE: u64 = 0x02;
pub(super) const EXPORT_REEXPORT: u64 = 0x08;
pub(super) const EXPORT_STUB_AND_RESOLVER: u64 = 0x10;

#[derive(Copy, Clone)]
struct FileRange {
    offset: u32,
    size: u32,
}

#[derive(Default)]
struct LoaderCommands {
    segments: Vec<AddressRange>,
    image_base: Option<u64>,
    chained_fixups: Option<FileRange>,
    opcode_streams: Vec<(OpcodeStream, FileRange)>,
    export_tries: Vec<FileRange>,
    symbol_table_offset: Option<u32>,
    dynamic_symbols: Option<dysymtab_command>,
}

#[derive(Copy, Clone)]
enum OpcodeStream {
    Rebase,
    Bind,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn is_at_end(&self) -> bool {
        self.at >= self.bytes.len()
    }

    fn byte(&mut self) -> Result<u8, PayloadReferenceError> {
        let byte = *self.bytes.get(self.at).ok_or(MALFORMED)?;
        self.at += 1;
        Ok(byte)
    }

    /// Bits above the 64th are dropped: an offset that stands for a negative number is encoded with them.
    fn leb128(&mut self) -> Result<u64, PayloadReferenceError> {
        let mut value: u64 = 0;
        let mut shift: u32 = 0;
        loop {
            let byte = self.byte()?;
            if shift < u64::BITS {
                value |= u64::from(byte & 0x7f) << shift;
            }
            if byte & 0x80 == 0 {
                return Ok(value);
            }
            shift += 7;
        }
    }

    fn skip_c_string(&mut self) -> Checked {
        while self.byte()? != 0 {}
        Ok(())
    }
}

pub(super) fn check(file: &mut Image<'_>, payload: Payload) -> Checked {
    let commands = read_loader_commands(file)?;
    let image_base = commands.image_base.ok_or(MALFORMED)?;
    if let Some(range) = commands.chained_fixups {
        check_chained_fixups(&bytes_of(file, range)?, image_base, payload)?;
    }
    for &(stream, range) in &commands.opcode_streams {
        let sites = FixupSites {
            segments: &commands.segments,
            payload,
            address: 0,
        };
        let opcodes = bytes_of(file, range)?;
        match stream {
            OpcodeStream::Rebase => check_rebases(&opcodes, sites)?,
            OpcodeStream::Bind => check_binds(&opcodes, sites)?,
        }
    }
    for &range in &commands.export_tries {
        check_export_trie(&bytes_of(file, range)?, image_base, payload)?;
    }
    check_defined_symbols(file, &commands, payload)
}

fn bytes_of(file: &mut Image<'_>, range: FileRange) -> Result<Vec<u8>, PayloadReferenceError> {
    table_bytes(file, u64::from(range.offset), u64::from(range.size))
}

fn read_loader_commands(file: &mut Image<'_>) -> Result<LoaderCommands, PayloadReferenceError> {
    let header: mach_header_64 = file.struct_at(0)?;
    let bytes = file.bytes(size_of::<mach_header_64>(), header.sizeofcmds as usize)?;
    let mut commands = LoaderCommands::default();
    let mut at: usize = 0;
    for _ in 0..header.ncmds {
        let cmd: u32 = struct_in(&bytes, at)?;
        let cmdsize: u32 = struct_in(&bytes, at + size_of::<u32>())?;
        if (cmdsize as usize) < size_of::<load_command>() {
            return Err(MALFORMED);
        }
        commands.add(cmd, &bytes, at)?;
        at = at.checked_add(cmdsize as usize).ok_or(MALFORMED)?;
    }
    Ok(commands)
}

impl LoaderCommands {
    fn add(&mut self, cmd: u32, bytes: &[u8], at: usize) -> Checked {
        match cmd {
            LC::SEGMENT_64 => {
                let segment: segment_command_64 = struct_in(bytes, at)?;
                let addresses = AddressRange::from_size(segment.vmaddr, segment.vmsize);
                self.segments.push(addresses.map_err(|_| MALFORMED)?);
                if segment.fileoff == 0 && segment.filesize != 0 {
                    self.image_base = Some(segment.vmaddr);
                }
            }
            LC::DYLD_CHAINED_FIXUPS => self.chained_fixups = Some(linkedit_range(bytes, at)?),
            LC::DYLD_EXPORTS_TRIE => self.export_tries.push(linkedit_range(bytes, at)?),
            LC::DYLD_INFO | LC::DYLD_INFO_ONLY => self.add_dyld_info(struct_in(bytes, at)?),
            LC::SYMTAB => {
                let table: symtab_command = struct_in(bytes, at)?;
                self.symbol_table_offset = Some(table.symoff);
            }
            LC::DYSYMTAB => self.dynamic_symbols = Some(struct_in(bytes, at)?),
            _ => {}
        }
        Ok(())
    }

    fn add_dyld_info(&mut self, info: dyld_info_command) {
        let range = |offset: u32, size: u32| FileRange { offset, size };
        self.opcode_streams.extend([
            (
                OpcodeStream::Rebase,
                range(info.rebase_off, info.rebase_size),
            ),
            (OpcodeStream::Bind, range(info.bind_off, info.bind_size)),
            (
                OpcodeStream::Bind,
                range(info.weak_bind_off, info.weak_bind_size),
            ),
            (
                OpcodeStream::Bind,
                range(info.lazy_bind_off, info.lazy_bind_size),
            ),
        ]);
        self.export_tries
            .push(range(info.export_off, info.export_size));
    }
}

fn linkedit_range(bytes: &[u8], at: usize) -> Result<FileRange, PayloadReferenceError> {
    let command: linkedit_data_command = struct_in(bytes, at)?;
    Ok(FileRange {
        offset: command.dataoff,
        size: command.datasize,
    })
}

/// The chains name their pages here and continue in the pages themselves, so the unit is a page: one that has a fixup holds no byte of the payload.
fn check_chained_fixups(fixups: &[u8], image_base: u64, payload: Payload) -> Checked {
    let header: dyld_chained_fixups_header = struct_in(fixups, 0)?;
    if header.fixups_version != 0 {
        return Err(UNSUPPORTED);
    }
    let starts_at = header.starts_offset as usize;
    let segment_count: u32 = struct_in(fixups, starts_at)?;
    for index in 0..segment_count as usize {
        let entry_at = starts_at + size_of::<u32>() * (index + 1);
        let segment_info_offset: u32 = struct_in(fixups, entry_at)?;
        if segment_info_offset == 0 {
            continue;
        }
        let record_at = starts_at + segment_info_offset as usize;
        let record: dyld_chained_starts_in_segment = struct_in(fixups, record_at)?;
        let page_starts = fixups
            .get(record_at + PAGE_STARTS_OFFSET..)
            .and_then(|rest| rest.get(..size_of::<u16>() * usize::from(record.page_count)))
            .ok_or(MALFORMED)?;
        let page_size = u64::from(record.page_size);
        let mut page_address = image_base.wrapping_add(record.segment_offset);
        for page_start in page_starts.as_chunks::<{ size_of::<u16>() }>().0 {
            if read_struct::<u16>(page_start) != DYLD_CHAINED_PTR_START_NONE {
                payload.check_relocation(page_address, page_size)?;
            }
            page_address = page_address.wrapping_add(page_size);
        }
    }
    Ok(())
}

struct FixupSites<'a> {
    segments: &'a [AddressRange],
    payload: Payload,
    address: u64,
}

impl FixupSites<'_> {
    fn set_segment_and_offset(&mut self, segment: u8, offset: u64) -> Checked {
        let segment = self.segments.get(usize::from(segment)).ok_or(MALFORMED)?;
        self.address = segment.start.wrapping_add(offset);
        Ok(())
    }

    fn advance(&mut self, distance: u64) {
        self.address = self.address.wrapping_add(distance);
    }

    /// `count` pointers with `skip` bytes after each. Costs the same for every count.
    fn check_run(&mut self, count: u64, skip: u64) -> Checked {
        let stride = POINTER_SIZE.wrapping_add(skip);
        let is_descending = stride > i64::MAX as u64;
        if count > 1 && (stride == 0 || is_descending) {
            return Err(UNSUPPORTED);
        }
        let bytes_below_payload = self.payload.0.start.saturating_sub(self.address);
        let first_candidate = match bytes_below_payload.saturating_sub(POINTER_SIZE - 1) {
            0 => 0,
            _ if count <= 1 => count,
            distance => distance.div_ceil(stride),
        };
        if first_candidate < count {
            let address = self
                .address
                .wrapping_add(first_candidate.wrapping_mul(stride));
            self.payload.check_relocation(address, POINTER_SIZE)?;
        }
        self.advance(count.wrapping_mul(stride));
        Ok(())
    }
}

fn check_rebases(opcodes: &[u8], mut sites: FixupSites<'_>) -> Checked {
    use rebase_opcode::*;
    let mut reader = Reader {
        bytes: opcodes,
        at: 0,
    };
    while !reader.is_at_end() {
        let byte = reader.byte()?;
        let immediate = byte & IMMEDIATE_MASK;
        match byte & OPCODE_MASK {
            DONE | SET_TYPE_IMM => {}
            SET_SEGMENT_AND_OFFSET_ULEB => {
                sites.set_segment_and_offset(immediate, reader.leb128()?)?;
            }
            ADD_ADDR_ULEB => sites.advance(reader.leb128()?),
            ADD_ADDR_IMM_SCALED => sites.advance(u64::from(immediate) * POINTER_SIZE),
            DO_REBASE_IMM_TIMES => sites.check_run(u64::from(immediate), 0)?,
            DO_REBASE_ULEB_TIMES => sites.check_run(reader.leb128()?, 0)?,
            DO_REBASE_ADD_ADDR_ULEB => sites.check_run(1, reader.leb128()?)?,
            DO_REBASE_ULEB_TIMES_SKIPPING_ULEB => {
                let count = reader.leb128()?;
                sites.check_run(count, reader.leb128()?)?;
            }
            _ => return Err(UNSUPPORTED),
        }
    }
    Ok(())
}

/// `DONE` ends an entry of the lazy stream and pads the end of every stream.
fn check_binds(opcodes: &[u8], mut sites: FixupSites<'_>) -> Checked {
    use bind_opcode::*;
    let mut reader = Reader {
        bytes: opcodes,
        at: 0,
    };
    while !reader.is_at_end() {
        let byte = reader.byte()?;
        let immediate = byte & IMMEDIATE_MASK;
        match byte & OPCODE_MASK {
            DONE | SET_DYLIB_ORDINAL_IMM | SET_DYLIB_SPECIAL_IMM | SET_TYPE_IMM => {}
            SET_DYLIB_ORDINAL_ULEB | SET_ADDEND_SLEB => {
                reader.leb128()?;
            }
            SET_SYMBOL_TRAILING_FLAGS_IMM => reader.skip_c_string()?,
            SET_SEGMENT_AND_OFFSET_ULEB => {
                sites.set_segment_and_offset(immediate, reader.leb128()?)?;
            }
            ADD_ADDR_ULEB => sites.advance(reader.leb128()?),
            DO_BIND => sites.check_run(1, 0)?,
            DO_BIND_ADD_ADDR_ULEB => sites.check_run(1, reader.leb128()?)?,
            DO_BIND_ADD_ADDR_IMM_SCALED => {
                sites.check_run(1, u64::from(immediate) * POINTER_SIZE)?;
            }
            DO_BIND_ULEB_TIMES_SKIPPING_ULEB => {
                let count = reader.leb128()?;
                sites.check_run(count, reader.leb128()?)?;
            }
            _ => return Err(UNSUPPORTED),
        }
    }
    Ok(())
}

fn check_export_trie(trie: &[u8], image_base: u64, payload: Payload) -> Checked {
    if trie.is_empty() {
        return Ok(());
    }
    let mut is_visited = vec![false; trie.len()];
    let mut pending: Vec<usize> = vec![0];
    while let Some(node) = pending.pop() {
        if core::mem::replace(is_visited.get_mut(node).ok_or(MALFORMED)?, true) {
            continue;
        }
        let mut reader = Reader {
            bytes: trie,
            at: node,
        };
        let export_size = usize::try_from(reader.leb128()?).map_err(|_| MALFORMED)?;
        let children_at = reader.at.checked_add(export_size).ok_or(MALFORMED)?;
        if export_size != 0 {
            check_export(&mut reader, image_base, payload)?;
        }
        reader.at = children_at;
        for _ in 0..reader.byte()? {
            reader.skip_c_string()?;
            pending.push(usize::try_from(reader.leb128()?).map_err(|_| MALFORMED)?);
        }
    }
    Ok(())
}

fn check_export(reader: &mut Reader<'_>, image_base: u64, payload: Payload) -> Checked {
    let flags = reader.leb128()?;
    if flags & EXPORT_REEXPORT != 0 || flags & EXPORT_KIND_MASK == EXPORT_KIND_ABSOLUTE {
        return Ok(());
    }
    payload.check_dynamic_symbol(image_base.wrapping_add(reader.leb128()?), 1)?;
    if flags & EXPORT_STUB_AND_RESOLVER != 0 {
        payload.check_dynamic_symbol(image_base.wrapping_add(reader.leb128()?), 1)?;
    }
    Ok(())
}

fn check_defined_symbols(
    file: &mut Image<'_>,
    commands: &LoaderCommands,
    payload: Payload,
) -> Checked {
    let Some(dynamic) = commands.dynamic_symbols else {
        return Ok(());
    };
    if dynamic.nextrel != 0 || dynamic.nlocrel != 0 {
        return Err(UNSUPPORTED);
    }
    if dynamic.nextdefsym == 0 {
        return Ok(());
    }
    let table_offset = u64::from(commands.symbol_table_offset.ok_or(MALFORMED)?);
    let offset = table_offset + u64::from(dynamic.iextdefsym) * SYMBOL_SIZE;
    let symbols = table_bytes(file, offset, u64::from(dynamic.nextdefsym) * SYMBOL_SIZE)?;
    for symbol in symbols.as_chunks::<{ size_of::<nlist_64>() }>().0 {
        let symbol: nlist_64 = read_struct(symbol);
        if symbol.n_type & N_STAB == 0 && symbol.n_type & N_TYPE == N_SECT {
            payload.check_dynamic_symbol(symbol.n_value, 1)?;
        }
    }
    Ok(())
}

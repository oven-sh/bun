//! Mach-O: which bytes are where, the load commands, and `__LINKEDIT`.
//!
//! `__TEXT` holds the header, then code and constants, then literals. The one area ends where the literals start and is
//! packed upwards against them. The header follows: `__TEXT` starts at a higher address, `__PAGEZERO` grows by as much, and
//! the file loses the pages in between. No other address changes, but whatever is relative to the image base does.
//!
//! The signature comes out empty: `LC_CODE_SIGNATURE` says where it goes, and whoever writes the file signs it.

use crate::bytes::{
    minus, offset, put_u16, put_u32, put_u64, slice, u8_at, u16_at, u32_at, u64_at,
};
use crate::executable::{
    Executable, LC_CODE_SIGNATURE, LC_DYLD_CHAINED_FIXUPS, LC_SEGMENT_64, LC_SYMTAB, fixed_name,
};
use crate::patch::{moved, patch};
use crate::plan::{Options, Plan};
use crate::table::{NO_UNIT, Table};
use crate::{Error, Result};

const LC_DYSYMTAB: u32 = 0xb;
const LC_FUNCTION_STARTS: u32 = 0x26;
const LC_DATA_IN_CODE: u32 = 0x29;
const LC_MAIN: u32 = 0x8000_0028;
const LC_DYLD_EXPORTS_TRIE: u32 = 0x8000_0033;
const N_STAB: u8 = 0xe0;
const N_TYPE: u8 = 0x0e;
const N_EXT: u8 = 1;
const INDIRECT_SYMBOL_LOCAL: u32 = 0x8000_0000;
const INDIRECT_SYMBOL_ABS: u32 = 0x4000_0000;

fn uleb(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push(value as u8 | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn read_uleb(b: &[u8], at: &mut usize) -> Result<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = u8_at(b, *at)?;
        *at += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Ok(value);
        }
    }
    Err(Error::InvalidExecutable)
}

struct Export {
    name: Vec<u8>,
    flags: u64,
    /// From the image base.
    offset: u64,
}

fn read_exports(
    trie: &[u8],
    node: usize,
    prefix: &mut Vec<u8>,
    depth: usize,
    out: &mut Vec<Export>,
) -> Result<()> {
    if depth > 1024 {
        return Err(Error::InvalidExecutable);
    }
    let mut at = node;
    let terminal_size = read_uleb(trie, &mut at)? as usize;
    if terminal_size != 0 {
        let mut terminal = at;
        let flags = read_uleb(trie, &mut terminal)?;
        out.push(Export {
            name: prefix.clone(),
            flags,
            offset: read_uleb(trie, &mut terminal)?,
        });
    }
    at += terminal_size;
    let children = u8_at(trie, at)?;
    at += 1;
    for _ in 0..children {
        let label = fixed_name(trie.get(at..).ok_or(Error::InvalidExecutable)?);
        at += label.len() + 1;
        let child = read_uleb(trie, &mut at)? as usize;
        prefix.extend_from_slice(label);
        read_exports(trie, child, prefix, depth + 1, out)?;
        prefix.truncate(prefix.len() - label.len());
    }
    Ok(())
}

#[derive(Default)]
struct TrieNode {
    edges: Vec<(Vec<u8>, usize)>,
    terminal: Option<(u64, u64)>,
    at: u64,
}

fn write_exports(exports: &[Export]) -> Vec<u8> {
    let mut nodes = vec![TrieNode::default()];
    for x in exports {
        let (mut node, mut rest) = (0, &x.name[..]);
        'descend: while !rest.is_empty() {
            for e in 0..nodes[node].edges.len() {
                let label = &nodes[node].edges[e].0;
                let common = label.iter().zip(rest).take_while(|(a, b)| a == b).count();
                if common == 0 {
                    continue;
                }
                if common < label.len() {
                    // split the edge
                    let tail = label[common..].to_vec();
                    let child = nodes[node].edges[e].1;
                    nodes.push(TrieNode {
                        edges: vec![(tail, child)],
                        ..Default::default()
                    });
                    let middle = nodes.len() - 1;
                    nodes[node].edges[e].0.truncate(common);
                    nodes[node].edges[e].1 = middle;
                }
                node = nodes[node].edges[e].1;
                rest = &rest[common..];
                continue 'descend;
            }
            nodes.push(TrieNode::default());
            let leaf = nodes.len() - 1;
            nodes[node].edges.push((rest.to_vec(), leaf));
            node = leaf;
            rest = &[];
        }
        nodes[node].terminal = Some((x.flags, x.offset));
    }

    let mut order = Vec::with_capacity(nodes.len());
    let mut stack = vec![0];
    while let Some(n) = stack.pop() {
        order.push(n);
        stack.extend(nodes[n].edges.iter().rev().map(|e| e.1));
    }
    let encode = |nodes: &[TrieNode], n: usize, out: &mut Vec<u8>| {
        let mut terminal = Vec::new();
        if let Some((flags, offset)) = nodes[n].terminal {
            uleb(&mut terminal, flags);
            uleb(&mut terminal, offset);
        }
        uleb(out, terminal.len() as u64);
        out.extend_from_slice(&terminal);
        out.push(nodes[n].edges.len() as u8);
        for (label, child) in &nodes[n].edges {
            out.extend_from_slice(label);
            out.push(0);
            uleb(out, nodes[*child].at);
        }
    };
    // A node's offset is itself a number of variable length: repeat until the offsets stop changing.
    let mut out = Vec::new();
    loop {
        out.clear();
        let mut has_changed = false;
        for &n in &order {
            has_changed |= nodes[n].at != out.len() as u64;
            nodes[n].at = out.len() as u64;
            encode(&nodes, n, &mut out);
        }
        if !has_changed {
            return out;
        }
    }
}

struct Segment {
    command: usize,
    name: Vec<u8>,
    mem_size: u64,
    offset: u64,
    file_size: u64,
}

struct Section {
    header: usize,
    is_in_text: bool,
    addr: u64,
    size: u64,
    offset: u32,
}

/// The pointers of one page, each of which holds the distance to the next.
struct Chain {
    /// Where in the fixups blob the offset of the first one is.
    page_start: usize,
    page: u64,
    members: Vec<u64>,
}

pub(crate) fn apply(
    exe: &Executable<'_>,
    t: &Table,
    o: &Options<'_>,
    mut p: Plan,
) -> Result<Vec<u8>> {
    let mut bytes = exe.bytes.to_vec();
    let file_offset = |address: u64| exe.file_offset(address).ok_or(Error::InvalidExecutable);

    let header_size = 32 + u32_at(&bytes, 20)? as usize;
    let mut commands: Vec<(u32, usize, usize)> = Vec::new(); // {type, offset, size}
    let mut segments = Vec::new();
    let mut sections = Vec::new();
    let mut base = None;
    let mut at = 32;
    for _ in 0..u32_at(&bytes, 16)? {
        let (kind, size) = (u32_at(&bytes, at)?, u32_at(&bytes, at + 4)? as usize);
        commands.push((kind, at, size));
        if kind == LC_SEGMENT_64 {
            let name = fixed_name(slice(&bytes, at + 8, 16)?).to_vec();
            if name == b"__TEXT" {
                base = Some(u64_at(&bytes, at + 24)?);
            }
            for s in 0..u32_at(&bytes, at + 64)? as usize {
                let header = at + 72 + s * 80;
                sections.push(Section {
                    header,
                    is_in_text: name == b"__TEXT",
                    addr: u64_at(&bytes, header + 32)?,
                    size: u64_at(&bytes, header + 40)?,
                    offset: u32_at(&bytes, header + 48)?,
                });
            }
            segments.push(Segment {
                command: at,
                name,
                mem_size: u64_at(&bytes, at + 32)?,
                offset: u64_at(&bytes, at + 40)?,
                file_size: u64_at(&bytes, at + 48)?,
            });
        }
        at += size;
    }
    let command = |kind: u32| commands.iter().find(|c| c.0 == kind).map(|c| c.1);
    let base = base.ok_or(Error::InvalidExecutable)?;
    let text = segments
        .iter()
        .find(|s| s.name == b"__TEXT")
        .ok_or(Error::InvalidExecutable)?;
    let (text_offset, text_size) = (text.offset as usize, text.file_size as usize);
    let linkedit_offset = segments
        .iter()
        .find(|s| s.name == b"__LINKEDIT")
        .ok_or(Error::InvalidExecutable)?
        .offset;
    let area = t.areas.first().ok_or(Error::InvalidTable)?;

    // ---- how far the header moves
    let page = t.format.arch.macho_page_size();
    let first = p.runs[0].first().ok_or(Error::Inconsistent)?;
    let first_byte = offset(first.start, first.delta);
    let shift = first_byte
        .checked_sub(base + header_size as u64)
        .ok_or(Error::Inconsistent)?
        / page
        * page;
    let new_base = base + shift;
    // The header is a unit too, in no area.
    let header_unit = t.unit_at(base);
    *p.delta
        .get_mut(header_unit as usize)
        .ok_or(Error::InvalidTable)? = shift.cast_signed();
    let p = p;
    let runs = &p.runs[0];
    let delta_at = |address: u64| match t.unit_at(address) {
        NO_UNIT => 0,
        unit => p.delta[unit as usize],
    };
    let is_piece_live_at = |address: u64| match t.unit_at(address) {
        NO_UNIT => None,
        unit => Some(p.is_piece_live[unit as usize]),
    };
    /// For the commands that are {offset, size} of a blob in `__LINKEDIT`.
    fn blob_of(bytes: &[u8], command: usize) -> Result<Vec<u8>> {
        Ok(slice(
            bytes,
            u32_at(bytes, command + 8)? as usize,
            u32_at(bytes, command + 12)? as usize,
        )?
        .to_vec())
    }

    // ---- the fixup chains, before anything is blanked
    let fixups_command = command(LC_DYLD_CHAINED_FIXUPS).ok_or(Error::InvalidExecutable)?;
    let mut fixups = blob_of(&bytes, fixups_command)?;
    let mut chains = Vec::new();
    let starts = u32_at(&fixups, 4)? as usize;
    for i in 0..u32_at(&fixups, starts)? as usize {
        let in_segment = u32_at(&fixups, starts + 4 + 4 * i)? as usize;
        if in_segment == 0 {
            continue;
        }
        let in_segment = starts + in_segment;
        let segment_offset = u64_at(&fixups, in_segment + 8)?;
        let page_size = u64::from(u16_at(&fixups, in_segment + 4)?);
        for n in 0..usize::from(u16_at(&fixups, in_segment + 20)?) {
            let page_start = in_segment + 22 + 2 * n;
            let first = u16_at(&fixups, page_start)?;
            if first == 0xffff {
                continue;
            }
            let page = base + segment_offset + n as u64 * page_size;
            let mut members = Vec::new();
            let mut address = page + u64::from(first);
            loop {
                members.push(address);
                let next = (u64_at(&bytes, file_offset(address)?)? >> 51) & 0xfff;
                if next == 0 {
                    break;
                }
                address += next * 4;
            }
            chains.push(Chain {
                page_start,
                page,
                members,
            });
        }
        put_u64(
            &mut fixups,
            in_segment + 8,
            segment_offset
                .checked_sub(shift)
                .ok_or(Error::Inconsistent)?,
        )?;
    }

    patch(t, o, &p, exe, &mut bytes, shift.cast_signed())?;

    // A pointer in a dead unit is gone: link its neighbours to each other.
    for chain in &chains {
        let is_kept = |&address: &u64| match t.unit_at(address) {
            NO_UNIT => true,
            unit => p.is_unit_live[unit as usize],
        };
        if chain.members.iter().all(is_kept) {
            continue;
        }
        let kept: Vec<u64> = chain.members.iter().copied().filter(is_kept).collect();
        put_u16(
            &mut fixups,
            chain.page_start,
            kept.first()
                .map_or(0xffff, |first| (first - chain.page) as u16),
        )?;
        for (i, &address) in kept.iter().enumerate() {
            let at = file_offset(address)?;
            let next = kept.get(i + 1).map_or(0, |next| (next - address) / 4);
            let value = u64_at(&bytes, at)?;
            put_u64(&mut bytes, at, (value & !(0xfff << 51)) | (next << 51))?;
        }
    }

    // ---- `__LINKEDIT`, rebuilt
    let mut header = slice(&bytes, 0, header_size)?.to_vec();
    let mut linkedit: Vec<u8> = Vec::new();
    let new_linkedit_offset = minus(linkedit_offset, shift)?;
    let mut append = |blob: &[u8]| {
        let at = new_linkedit_offset + linkedit.len() as u64;
        linkedit.extend_from_slice(blob);
        linkedit.resize(linkedit.len().next_multiple_of(16), 0);
        at as u32
    };
    let rebased = |offset_from_base: u64| {
        let address = base
            .checked_add(offset_from_base)
            .ok_or(Error::InvalidExecutable)?;
        minus(offset(address, delta_at(address)), new_base)
    };

    put_u32(&mut header, fixups_command + 8, append(&fixups))?;
    if let Some(c) = command(LC_DYLD_EXPORTS_TRIE) {
        let trie = blob_of(&bytes, c)?;
        let mut exports = Vec::new();
        if !trie.is_empty() {
            read_exports(&trie, 0, &mut Vec::new(), 0, &mut exports)?;
        }
        for x in &mut exports {
            x.offset = rebased(x.offset)?;
        }
        let trie = write_exports(&exports);
        put_u32(&mut header, c + 8, append(&trie))?;
        put_u32(&mut header, c + 12, trie.len() as u32)?;
    }
    if let Some(c) = command(LC_FUNCTION_STARTS) {
        let blob = blob_of(&bytes, c)?;
        let mut kept = Vec::new();
        let (mut at, mut address) = (0, base);
        while blob.get(at).is_some_and(|&b| b != 0) {
            address = address
                .checked_add(read_uleb(&blob, &mut at)?)
                .ok_or(Error::InvalidExecutable)?;
            if is_piece_live_at(address) == Some(true) {
                kept.push(offset(address, delta_at(address)));
            }
        }
        kept.sort_unstable();
        let mut blob = Vec::new();
        let mut previous = new_base;
        for address in kept {
            uleb(&mut blob, minus(address, previous)?);
            previous = address;
        }
        blob.push(0);
        put_u32(&mut header, c + 8, append(&blob))?;
        put_u32(&mut header, c + 12, blob.len() as u32)?;
    }
    if let Some(c) = command(LC_MAIN) {
        let entry = rebased(u64_at(&bytes, c + 8)?)?;
        put_u64(&mut header, c + 8, entry)?;
    }
    if let Some(c) = command(LC_DATA_IN_CODE) {
        // {offset from the base, length and kind}, sorted
        let blob = blob_of(&bytes, c)?;
        let mut kept = Vec::new();
        for at in (0..blob.len()).step_by(8) {
            let from_base = u64::from(u32_at(&blob, at)?);
            if is_piece_live_at(base.wrapping_add(from_base)) == Some(true) {
                kept.push((rebased(from_base)? as u32, u32_at(&blob, at + 4)?));
            }
        }
        kept.sort_unstable();
        let blob: Vec<u8> = kept
            .iter()
            .flat_map(|(from_base, rest)| [from_base.to_le_bytes(), rest.to_le_bytes()])
            .flatten()
            .collect();
        put_u32(&mut header, c + 8, append(&blob))?;
        put_u32(&mut header, c + 12, blob.len() as u32)?;
    }

    // The symbol table keeps what is exported or imported. The indirect symbol table refers to it by index.
    if let (Some(symtab), Some(dysymtab)) = (command(LC_SYMTAB), command(LC_DYSYMTAB)) {
        let symbols = u32_at(&bytes, symtab + 8)? as usize;
        let count = u32_at(&bytes, symtab + 12)? as usize;
        let strings = u32_at(&bytes, symtab + 16)? as usize;
        let mut definitions = Vec::new();
        let mut imports = Vec::new();
        for i in 0..count {
            let kind = u8_at(&bytes, symbols + i * 16 + 4)?;
            if kind & N_STAB != 0 {
                continue; // for debuggers
            }
            if kind & N_TYPE == 0 {
                imports.push(i);
            } else if kind & N_EXT != 0
                && is_piece_live_at(u64_at(&bytes, symbols + i * 16 + 8)?) != Some(false)
            {
                definitions.push(i);
            }
        }
        let mut new_index = vec![INDIRECT_SYMBOL_LOCAL; count];
        let mut entries = Vec::with_capacity((definitions.len() + imports.len()) * 16);
        let mut names = b" \0".to_vec();
        for (j, &i) in definitions.iter().chain(&imports).enumerate() {
            new_index[i] = j as u32;
            let entry = symbols + i * 16;
            let at = entries.len();
            entries.extend_from_slice(slice(&bytes, entry, 16)?);
            put_u32(&mut entries, at, names.len() as u32)?;
            let name = fixed_name(
                bytes
                    .get(strings + u32_at(&bytes, entry)? as usize..)
                    .ok_or(Error::InvalidExecutable)?,
            );
            names.extend_from_slice(name);
            names.push(0);
            if u8_at(&bytes, entry + 4)? & N_TYPE != 0 {
                let address = u64_at(&bytes, entry + 8)?;
                put_u64(&mut entries, at + 8, offset(address, delta_at(address)))?;
            }
        }
        put_u32(&mut header, symtab + 8, append(&entries))?;
        put_u32(&mut header, symtab + 12, (entries.len() / 16) as u32)?;

        let mut indirect = slice(
            &bytes,
            u32_at(&bytes, dysymtab + 56)? as usize,
            4 * u32_at(&bytes, dysymtab + 60)? as usize,
        )?
        .to_vec();
        for at in (0..indirect.len()).step_by(4) {
            let i = u32_at(&indirect, at)?;
            if i & (INDIRECT_SYMBOL_LOCAL | INDIRECT_SYMBOL_ABS) == 0 {
                let new = *new_index.get(i as usize).ok_or(Error::InvalidExecutable)?;
                put_u32(&mut indirect, at, new)?;
            }
        }
        put_u32(&mut header, dysymtab + 56, append(&indirect))?;

        // The signature follows, and signing wants every byte of `__LINKEDIT` accounted for: count the padding.
        names.resize(names.len().next_multiple_of(16), 0);
        put_u32(&mut header, symtab + 16, append(&names))?;
        put_u32(&mut header, symtab + 20, names.len() as u32)?;
        // {first, count} of the local, the defined external and the undefined symbols
        let (defined, undefined) = (definitions.len() as u32, imports.len() as u32);
        for (i, value) in [0, 0, 0, defined, defined, undefined]
            .into_iter()
            .enumerate()
        {
            put_u32(&mut header, dysymtab + 8 + 4 * i, value)?;
        }
    }

    // ---- load commands
    for s in &segments {
        match &s.name[..] {
            b"__PAGEZERO" => put_u64(&mut header, s.command + 32, s.mem_size + shift)?,
            b"__TEXT" => {
                put_u64(&mut header, s.command + 24, new_base)?;
                put_u64(&mut header, s.command + 32, minus(s.mem_size, shift)?)?;
                put_u64(&mut header, s.command + 48, minus(s.file_size, shift)?)?;
            }
            name => {
                put_u64(&mut header, s.command + 40, minus(s.offset, shift)?)?;
                if name == b"__LINKEDIT" {
                    put_u64(&mut header, s.command + 48, linkedit.len() as u64)?;
                    put_u64(
                        &mut header,
                        s.command + 32,
                        (linkedit.len() as u64).next_multiple_of(page),
                    )?;
                }
            }
        }
    }
    for s in &sections {
        if !s.is_in_text {
            if s.offset != 0 {
                put_u32(
                    &mut header,
                    s.header + 48,
                    minus(s.offset.into(), shift)? as u32,
                )?;
            }
            continue;
        }
        let (mut start, mut length) = (s.addr, s.size);
        if s.addr < area.high {
            // A section inside the area now spans what is left of it.
            let mut left = runs.iter().filter_map(|r| {
                let (from, to) = (r.start.max(s.addr), r.end.min(s.addr + s.size));
                (from < to).then(|| (offset(from, r.delta), offset(to, r.delta)))
            });
            match left.next() {
                None => (start, length) = (first_byte, 0),
                Some((first, end)) => {
                    (start, length) = (first, left.next_back().map_or(end, |(_, end)| end) - first)
                }
            }
        }
        put_u64(&mut header, s.header + 32, start)?;
        put_u64(&mut header, s.header + 40, length)?;
        put_u32(&mut header, s.header + 48, minus(start, new_base)? as u32)?;
    }

    if let Some(c) = command(LC_CODE_SIGNATURE) {
        put_u32(
            &mut header,
            c + 8,
            (new_linkedit_offset + linkedit.len() as u64) as u32,
        )?;
        put_u32(&mut header, c + 12, 0)?;
    }

    // ---- the file
    let packed = moved(t, &p, exe, &bytes, 0)?;
    let mut out = slice(&bytes, text_offset, text_size)?.to_vec();
    out.get_mut(minus(area.low, base)? as usize..)
        .and_then(|o| o.get_mut(..packed.len()))
        .ok_or(Error::TableOfAnotherExecutable)?
        .copy_from_slice(&packed);
    out.drain(..shift as usize);
    out.get_mut(..(first_byte - new_base) as usize)
        .ok_or(Error::Inconsistent)?
        .fill(0);
    out[..header.len()].copy_from_slice(&header);
    for s in segments
        .iter()
        .filter(|s| !matches!(&s.name[..], b"__PAGEZERO" | b"__TEXT" | b"__LINKEDIT"))
    {
        out.extend_from_slice(slice(&bytes, s.offset as usize, s.file_size as usize)?);
    }
    out.extend_from_slice(&linkedit);
    Ok(out)
}

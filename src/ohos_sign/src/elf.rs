use std::fmt;

use crate::{descriptor, merkle, sha256};

const PAGE: usize = 4096;
const CODESIGN_NAME: &[u8] = b".codesign\0";

#[derive(Debug)]
pub enum SignError {
    NotElf64,
    NoSectionHeaders,
    ShstrtabOutOfBounds,
    AlreadySigned,
    Io(std::io::Error),
}

impl fmt::Display for SignError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SignError::NotElf64 => write!(f, "not an ELF64 binary"),
            SignError::NoSectionHeaders => write!(f, "ELF has no section header table"),
            SignError::ShstrtabOutOfBounds => write!(f, "shstrtab out of bounds"),
            SignError::AlreadySigned => {
                write!(f, "already has .codesign section; strip first or use --force")
            }
            SignError::Io(e) => write!(f, "I/O error: {e}"),
        }
    }
}

impl std::error::Error for SignError {}

impl From<std::io::Error> for SignError {
    fn from(e: std::io::Error) -> Self {
        SignError::Io(e)
    }
}

// ── ELF64 header field offsets ────────────────────────────────────────────
const E_SHOFF: usize = 0x28;
const E_SHENTSIZE: usize = 0x3a;
const E_SHNUM: usize = 0x3c;
const E_SHSTRNDX: usize = 0x3e;

fn read_u16(buf: &[u8], off: usize) -> u16 {
    u16::from_le_bytes(buf[off..off + 2].try_into().unwrap())
}
fn read_u32(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(buf[off..off + 4].try_into().unwrap())
}
fn read_u64(buf: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(buf[off..off + 8].try_into().unwrap())
}
fn write_u16(buf: &mut [u8], off: usize, v: u16) {
    buf[off..off + 2].copy_from_slice(&v.to_le_bytes());
}
fn write_u64(buf: &mut [u8], off: usize, v: u64) {
    buf[off..off + 8].copy_from_slice(&v.to_le_bytes());
}

fn align_up(v: u64, a: u64) -> u64 {
    (v + a - 1) / a * a
}

/// Validate header and return (e_shoff, e_shnum, e_shstrndx).
fn parse_header(elf: &[u8]) -> Result<(u64, u16, u16), SignError> {
    if elf.len() < 64 || &elf[0..4] != b"\x7fELF" || elf[4] != 2 {
        return Err(SignError::NotElf64);
    }
    let e_shoff = read_u64(elf, E_SHOFF);
    let e_shnum = read_u16(elf, E_SHNUM);
    let e_shstrndx = read_u16(elf, E_SHSTRNDX);
    if e_shoff == 0 || e_shnum == 0 || e_shstrndx as u64 >= e_shnum as u64 {
        return Err(SignError::NoSectionHeaders);
    }
    Ok((e_shoff, e_shnum, e_shstrndx))
}

/// Find the index of a section by name in the shstrtab; returns offset of that section entry.
fn find_section_by_name<'a>(
    elf: &'a [u8],
    e_shoff: u64,
    e_shnum: u16,
    e_shstrndx: u16,
    name: &[u8],
) -> Option<usize> {
    let shstr_e = e_shoff as usize + e_shstrndx as usize * 64;
    let shstr_off = read_u64(elf, shstr_e + 24) as usize;
    let shstr_sz = read_u64(elf, shstr_e + 32) as usize;
    if shstr_off + shstr_sz > elf.len() {
        return None;
    }
    for i in 0..e_shnum as usize {
        let e = e_shoff as usize + i * 64;
        let name_off = read_u32(elf, e) as usize;
        if name_off + name.len() <= shstr_sz {
            if &elf[shstr_off + name_off..shstr_off + name_off + name.len()] == name {
                return Some(e);
            }
        }
    }
    None
}

pub fn has_codesign_section(elf: &[u8]) -> bool {
    let Ok((e_shoff, e_shnum, e_shstrndx)) = parse_header(elf) else {
        return false;
    };
    find_section_by_name(elf, e_shoff, e_shnum, e_shstrndx, CODESIGN_NAME).is_some()
}

/// Strip .codesign section. Returns true if a section was removed.
/// Rebuilds the ELF in-place by rewriting shstrtab and SHT without the removed entry.
pub fn strip(elf: &mut Vec<u8>) -> Result<bool, SignError> {
    let (e_shoff, e_shnum, e_shstrndx) = parse_header(elf)?;
    let Some(cs_entry_off) =
        find_section_by_name(elf, e_shoff, e_shnum, e_shstrndx, CODESIGN_NAME)
    else {
        return Ok(false);
    };
    let cs_idx = (cs_entry_off - e_shoff as usize) / 64;

    // Read shstrtab location
    let shstr_e = e_shoff as usize + e_shstrndx as usize * 64;
    let shstr_off = read_u64(elf, shstr_e + 24) as usize;
    let shstr_sz = read_u64(elf, shstr_e + 32) as usize;
    if shstr_off + shstr_sz > elf.len() {
        return Err(SignError::ShstrtabOutOfBounds);
    }

    // Remove .codesign\0 from shstrtab
    let cs_name_off = read_u32(elf, cs_entry_off) as usize;
    let cs_name_len = CODESIGN_NAME.len();
    let mut new_shstr = elf[shstr_off..shstr_off + shstr_sz].to_vec();
    if cs_name_off + cs_name_len <= new_shstr.len() {
        new_shstr.drain(cs_name_off..cs_name_off + cs_name_len);
    }

    // Build new SHT without the .codesign entry
    let new_shnum = e_shnum - 1;
    let mut new_sht = Vec::with_capacity(new_shnum as usize * 64);
    for i in 0..e_shnum as usize {
        if i == cs_idx {
            continue;
        }
        let e = e_shoff as usize + i * 64;
        let entry = elf[e..e + 64].to_vec();
        new_sht.extend_from_slice(&entry);
    }

    // Place new shstrtab and SHT at end of file (after removing the .codesign section data)
    let cs_sec_off = read_u64(elf, cs_entry_off + 24) as usize;
    let cs_sec_sz = read_u64(elf, cs_entry_off + 32) as usize;

    // Truncate the ELF to remove the .codesign section data.
    // Assumption: .codesign is at end of file (which it always is, since we append it).
    let keep_len = cs_sec_off.min(elf.len());
    elf.truncate(keep_len);

    // Append new shstrtab
    let new_shstr_off = elf.len() as u64;
    elf.extend_from_slice(&new_shstr);

    // Align SHT to 8 bytes
    let new_sht_off = align_up(elf.len() as u64, 8);
    elf.resize(new_sht_off as usize, 0);
    let new_sht_off_usize = elf.len();
    elf.extend_from_slice(&new_sht);

    // Update shstrtab entry (adjust name offsets for removed string)
    let new_shstrndx = e_shstrndx as usize;
    let shstr_entry_off_in_new = new_shstrndx * 64;
    if new_shstrndx < cs_idx {
        // entry index unchanged, update sh_offset and sh_size
        write_u64(elf, new_sht_off_usize + shstr_entry_off_in_new + 24, new_shstr_off);
        write_u64(elf, new_sht_off_usize + shstr_entry_off_in_new + 32, new_shstr.len() as u64);
    } else {
        // index shifted down by 1
        let adj = (new_shstrndx - 1) * 64;
        write_u64(elf, new_sht_off_usize + adj + 24, new_shstr_off);
        write_u64(elf, new_sht_off_usize + adj + 32, new_shstr.len() as u64);
    }

    // Adjust name offsets for all entries that reference names after cs_name_off
    for i in 0..new_shnum as usize {
        let e = new_sht_off_usize + i * 64;
        let noff = read_u32(elf, e) as usize;
        if noff > cs_name_off {
            let new_noff = (noff - cs_name_len) as u32;
            elf[e..e + 4].copy_from_slice(&new_noff.to_le_bytes());
        }
    }

    // Update ELF header: e_shoff, e_shnum; keep e_shstrndx (same index if shstrndx < cs_idx)
    write_u64(elf, E_SHOFF, new_sht_off as u64);
    write_u16(elf, E_SHNUM, new_shnum);
    // If cs_idx < e_shstrndx, shstrndx shifts down
    if cs_idx < e_shstrndx as usize {
        write_u16(elf, E_SHSTRNDX, e_shstrndx - 1);
    }

    let _ = cs_sec_sz; // not needed directly
    Ok(true)
}

/// Inject a 4KB placeholder .codesign section.
/// Returns (new_elf_bytes, cs_section_file_offset).
fn inject_codesign_section(elf: &[u8]) -> Result<(Vec<u8>, u64), SignError> {
    let (e_shoff, e_shnum, e_shstrndx) = parse_header(elf)?;

    let shstr_e = e_shoff as usize + e_shstrndx as usize * 64;
    let shstr_off = read_u64(elf, shstr_e + 24);
    let shstr_sz = read_u64(elf, shstr_e + 32);
    if shstr_off + shstr_sz > elf.len() as u64 {
        return Err(SignError::ShstrtabOutOfBounds);
    }

    // cs section offset: max of all existing section ends, rounded up to PAGE
    let mut cur_end = e_shoff + e_shnum as u64 * 64;
    for i in 0..e_shnum as usize {
        let e = e_shoff as usize + i * 64;
        let sh_type = read_u32(elf, e + 4);
        let off = read_u64(elf, e + 24);
        let sz = if sh_type == 8 { 0 } else { read_u64(elf, e + 32) }; // SHT_NOBITS
        if off + sz > cur_end {
            cur_end = off + sz;
        }
    }
    let cs_off = align_up(cur_end, PAGE as u64);

    // new shstrtab = old shstrtab + ".codesign\0"
    let cs_shname = shstr_sz as u32;
    let mut new_shstr = elf[shstr_off as usize..shstr_off as usize + shstr_sz as usize].to_vec();
    new_shstr.extend_from_slice(CODESIGN_NAME);

    // layout: [original 0..cs_off] [4KB cs section] [new shstrtab] [8B-aligned new SHT]
    let new_shstr_off = cs_off + PAGE as u64;
    let new_sht_off = align_up(new_shstr_off + new_shstr.len() as u64, 8);
    let new_shnum = e_shnum + 1;
    let new_total = new_sht_off as usize + new_shnum as usize * 64;

    let mut buf = vec![0u8; new_total];
    // 1) original content (may be shorter than cs_off)
    let copy_len = elf.len().min(new_total);
    buf[..copy_len.min(cs_off as usize)].copy_from_slice(&elf[..copy_len.min(cs_off as usize)]);
    // 2) .codesign section (4KB zeros, already zero)
    // 3) new shstrtab
    buf[new_shstr_off as usize..new_shstr_off as usize + new_shstr.len()]
        .copy_from_slice(&new_shstr);
    // 4) old SHT at new position
    buf[new_sht_off as usize..new_sht_off as usize + e_shnum as usize * 64]
        .copy_from_slice(&elf[e_shoff as usize..e_shoff as usize + e_shnum as usize * 64]);
    // 5) new .codesign SHT entry
    let cs_e = new_sht_off as usize + e_shnum as usize * 64;
    buf[cs_e..cs_e + 4].copy_from_slice(&cs_shname.to_le_bytes()); // sh_name
    buf[cs_e + 4..cs_e + 8].copy_from_slice(&1u32.to_le_bytes()); // sh_type = SHT_PROGBITS
    // sh_flags, sh_addr = 0
    buf[cs_e + 24..cs_e + 32].copy_from_slice(&cs_off.to_le_bytes()); // sh_offset
    buf[cs_e + 32..cs_e + 40].copy_from_slice(&(PAGE as u64).to_le_bytes()); // sh_size
    buf[cs_e + 48..cs_e + 56].copy_from_slice(&(PAGE as u64).to_le_bytes()); // sh_addralign
    // 6) update shstrtab entry in new SHT
    let shstr_e_new = new_sht_off as usize + e_shstrndx as usize * 64;
    buf[shstr_e_new + 24..shstr_e_new + 32].copy_from_slice(&new_shstr_off.to_le_bytes());
    buf[shstr_e_new + 32..shstr_e_new + 40]
        .copy_from_slice(&(new_shstr.len() as u64).to_le_bytes());
    // 7) update ELF header
    write_u64(&mut buf, E_SHOFF, new_sht_off);
    write_u16(&mut buf, E_SHNUM, new_shnum);
    // e_shstrndx unchanged

    Ok((buf, cs_off))
}

/// Sign an ELF. If `force` is true, strip any existing .codesign first.
pub fn sign(elf: &[u8], force: bool) -> Result<Vec<u8>, SignError> {
    if elf.len() < 64 || &elf[0..4] != b"\x7fELF" || elf[4] != 2 {
        return Err(SignError::NotElf64);
    }
    let mut buf: Vec<u8> = elf.to_vec();
    if has_codesign_section(&buf) {
        if !force {
            return Err(SignError::AlreadySigned);
        }
        strip(&mut buf)?;
    }
    let (mut tmp, cs_off) = inject_codesign_section(&buf)?;

    // Merkle root over tmp, skipping the cs section range
    let root = merkle::root_hash(&tmp, cs_off, PAGE as u64);

    // descriptor with sign_size=0 for digest, then SHA-256 it
    let desc_for_digest = descriptor::build(0, tmp.len() as u64, &root);
    let signature = sha256::hash(&desc_for_digest);

    // descriptor with sign_size=32 for on-disk layout
    let desc_on_disk = descriptor::build(32, tmp.len() as u64, &root);

    // ElfSignInfo header (8B) + descriptor (256B) + signature (32B) = 296B
    let mut payload = [0u8; 8 + descriptor::SIZE + 32];
    payload[0..4].copy_from_slice(&descriptor::ELF_SIGN_INFO_TYPE.to_le_bytes());
    payload[4..8].copy_from_slice(&((descriptor::SIZE + 32) as u32).to_le_bytes());
    payload[8..8 + descriptor::SIZE].copy_from_slice(&desc_on_disk);
    payload[8 + descriptor::SIZE..].copy_from_slice(&signature);

    // Write payload into the cs section
    tmp[cs_off as usize..cs_off as usize + payload.len()].copy_from_slice(&payload);

    Ok(tmp)
}

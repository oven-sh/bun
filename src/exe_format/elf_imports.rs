//! The imports that the dynamic loader has left unbound in an ELF object that it has mapped into this process: which of them nothing defines, and which the host fills.

use core::ffi::CStr;
use core::mem::{align_of, size_of};
use core::slice;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_core::AnyBitPattern;
use bun_sys::elf::PT_LOAD;

const PT_DYNAMIC: u32 = 2;
const PT_GNU_RELRO: u32 = 0x6474_e552;
const PF_W: u32 = 2;
const PF_R: u32 = 4;
const DT_NULL: i64 = 0;
const DT_PLTRELSZ: i64 = 2;
const DT_STRTAB: i64 = 5;
const DT_SYMTAB: i64 = 6;
const DT_RELA: i64 = 7;
const DT_RELASZ: i64 = 8;
const DT_RELAENT: i64 = 9;
const DT_STRSZ: i64 = 10;
const DT_PLTREL: i64 = 20;
const DT_JMPREL: i64 = 23;
const DT_VERSYM: i64 = 0x6fff_fff0;
const DT_VERNEED: i64 = 0x6fff_fffe;
const DT_VERNEEDNUM: i64 = 0x6fff_ffff;
const RELA_SIZE: u64 = size_of::<Elf64_Rela>() as u64;
const SHN_UNDEF: u16 = 0;
const STB_GLOBAL: u8 = 1;
const STB_WEAK: u8 = 2;
/// The low 15 bits of a `DT_VERSYM` element and of `vna_other`: 0 and 1 mean that the symbol has no version.
const VERSION_INDEX: u16 = 0x7fff;
#[cfg(target_arch = "x86_64")]
const R_ABS64: u32 = 1;
#[cfg(target_arch = "x86_64")]
const R_GLOB_DAT: u32 = 6;
#[cfg(target_arch = "x86_64")]
const R_JUMP_SLOT: u32 = 7;
#[cfg(target_arch = "x86_64")]
const R_TLSDESC: u32 = 36;
#[cfg(target_arch = "aarch64")]
const R_ABS64: u32 = 257;
#[cfg(target_arch = "aarch64")]
const R_GLOB_DAT: u32 = 1025;
#[cfg(target_arch = "aarch64")]
const R_JUMP_SLOT: u32 = 1026;
#[cfg(target_arch = "aarch64")]
const R_TLSDESC: u32 = 1031;

#[repr(C)]
#[derive(Clone, Copy)]
struct Elf64_Dyn {
    d_tag: i64,
    d_val: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Elf64_Rela {
    r_offset: u64,
    r_info: u64,
    r_addend: i64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Elf64_Sym {
    st_name: u32,
    st_info: u8,
    _st_other: u8,
    st_shndx: u16,
    _st_value: u64,
    _st_size: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Elf64_Verneed {
    _vn_version: u16,
    vn_cnt: u16,
    _vn_file: u32,
    vn_aux: u32,
    vn_next: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Elf64_Vernaux {
    _vna_hash: u32,
    _vna_flags: u16,
    vna_other: u16,
    vna_name: u32,
    vna_next: u32,
}

bun_core::impl_any_bit_pattern!(
    Elf64_Dyn,
    Elf64_Rela,
    Elf64_Sym,
    Elf64_Verneed,
    Elf64_Vernaux
);

/// Why the imports of an object cannot be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unreadable {
    /// There is no `PT_DYNAMIC` segment, or it has no `DT_NULL` inside its size and inside a `PT_LOAD` range.
    Dynamic,
    /// A relocation table, `DT_SYMTAB` or `DT_STRTAB` points outside the `PT_LOAD` ranges, or the last two are missing.
    Table,
    /// A relocation table is larger than the `PT_LOAD` range around it, or `DT_PLTREL` or `DT_RELAENT` names another format than `Elf64_Rela`.
    Relocations,
    /// A relocation names a symbol outside the `PT_LOAD` range of the symbol table.
    SymbolIndex,
    /// The name of a symbol does not end inside `DT_STRSZ`.
    SymbolName,
    /// The slot of an import is not an aligned pointer inside the readable `PT_LOAD` ranges.
    Slot,
}

/// A table of the object: `room` is the bytes from `address` to the end of the table, or of the `PT_LOAD` range around it.
#[derive(Clone, Copy)]
struct Table {
    address: usize,
    room: usize,
}

impl Table {
    /// The `T` that starts `offset` bytes into the table.
    fn at<T: AnyBitPattern>(self, offset: usize) -> Option<T> {
        if offset.checked_add(size_of::<T>())? > self.room {
            return None;
        }
        // SAFETY: the element is inside a range that the loader mapped readable, and the caller of the walk keeps the object loaded.
        Some(unsafe { (self.address.wrapping_add(offset) as *const T).read_unaligned() })
    }

    fn element<T: AnyBitPattern>(self, index: usize) -> Option<T> {
        self.at(index.checked_mul(size_of::<T>())?)
    }

    fn string<'a>(self, offset: usize) -> Option<&'a CStr> {
        let length = self.room.checked_sub(offset)?;
        // SAFETY: as in `element`, and nothing writes to the string table of a loaded object.
        let bytes = unsafe {
            slice::from_raw_parts(self.address.wrapping_add(offset) as *const u8, length)
        };
        CStr::from_bytes_until_nul(bytes).ok()
    }
}

struct Image<'a> {
    headers: &'a [libc::Elf64_Phdr],
    base: usize,
}

impl Image<'_> {
    /// The bytes from `address` to the end of the range around it, of the `kind` ranges that have `flags`.
    fn room(&self, kind: u32, flags: u32, address: usize) -> usize {
        self.headers
            .iter()
            .filter(|header| header.p_type == kind && header.p_flags & flags == flags)
            .find_map(|header| {
                let start = self.base.wrapping_add(header.p_vaddr as usize);
                (header.p_memsz as usize)
                    .checked_sub(address.wrapping_sub(start))
                    .filter(|&room| room != 0)
            })
            .unwrap_or(0)
    }

    /// The table that a dynamic entry points to. glibc adds the base in place to `DT_SYMTAB`, `DT_STRTAB`, `DT_JMPREL`, `DT_RELA` and `DT_VERSYM`, never to `DT_VERNEED`, and to no entry of an object whose `PT_DYNAMIC` is read-only. musl and FreeBSD add it to none. So each pointer is tried in both forms.
    fn table(&self, pointer: u64) -> Option<Table> {
        [pointer as usize, self.base.wrapping_add(pointer as usize)]
            .into_iter()
            .map(|address| Table {
                address,
                room: self.room(PT_LOAD, PF_R, address),
            })
            .find(|table| table.room != 0)
    }

    /// What the slot of an import holds, if it is an aligned pointer inside a readable `PT_LOAD` range.
    fn slot(&self, address: usize) -> Option<usize> {
        let aligned = address.is_multiple_of(align_of::<AtomicUsize>());
        if !aligned || self.room(PT_LOAD, PF_R, address) < size_of::<usize>() {
            return None;
        }
        // SAFETY: the slot is aligned and inside a range that the loader mapped readable, and the caller of the walk keeps the object loaded.
        let slot = unsafe { AtomicUsize::from_ptr(address as *mut usize) };
        // The loader stores to a slot at the first call through it on any thread. Relaxed is the ordering that may load from a page that is read-only.
        Some(slot.load(Ordering::Relaxed))
    }

    /// Whether a slot that holds `value` has the address of a definition. An unbound slot holds 0 or points into the object, at its stub for the import, and musl (`unrelocated`) leaves there what the file has: the stub's offset from the base.
    fn is_bound(&self, value: usize, unrelocated: bool) -> bool {
        let in_object = |address| self.room(PT_LOAD, 0, address) != 0;
        // With musl a bound slot can look unbound: it holds an address in the host's image, which is not position independent, and `base + value` can lie inside a large object. The question by the name is what accepts such an import.
        value != 0
            && !in_object(value)
            && !(unrelocated && in_object(self.base.wrapping_add(value)))
    }

    /// Whether the host can store to a slot that `slot` has read. The loader makes `PT_GNU_RELRO` read-only once it has relocated the object.
    fn is_writable(&self, address: usize) -> bool {
        self.room(PT_LOAD, PF_R | PF_W, address) >= size_of::<usize>()
            && self.room(PT_GNU_RELRO, 0, address) == 0
    }

    /// The version that the object names for its import `symbol`. A version table that is missing or malformed names none.
    fn version<'a>(&self, versions: Versions, strings: Table, symbol: usize) -> Option<&'a CStr> {
        let index = self.table(versions.symbols?)?.element::<u16>(symbol)? & VERSION_INDEX;
        if index < 2 {
            return None;
        }
        let needed = self.table(versions.needed?)?;
        // A version index has 15 bits, so tables that are well formed have fewer entries than this, and a longer chain ends here.
        let mut budget = 0..1u32 << 16;
        let mut need_offset = 0usize;
        for _ in 0..versions.needed_count {
            budget.next()?;
            let need: Elf64_Verneed = needed.at(need_offset)?;
            let mut aux_offset = need_offset.checked_add(need.vn_aux as usize)?;
            for _ in 0..need.vn_cnt {
                budget.next()?;
                let aux: Elf64_Vernaux = needed.at(aux_offset)?;
                if aux.vna_other & VERSION_INDEX == index {
                    return strings.string(aux.vna_name as usize);
                }
                if aux.vna_next == 0 {
                    break;
                }
                aux_offset = aux_offset.checked_add(aux.vna_next as usize)?;
            }
            if need.vn_next == 0 {
                break;
            }
            need_offset = need_offset.checked_add(need.vn_next as usize)?;
        }
        None
    }
}

/// The values of `DT_VERSYM`, `DT_VERNEED` and `DT_VERNEEDNUM`. The walk reads these tables only for an import that has no definition by its name.
#[derive(Clone, Copy, Default)]
struct Versions {
    symbols: Option<u64>,
    needed: Option<u64>,
    needed_count: u64,
}

/// The tables of the dynamic section that a walk of the relocations reads.
#[derive(Clone, Copy)]
struct Tables {
    /// The table of `DT_JMPREL`, and that of `DT_RELA` if the walk reads it.
    relocations: [Option<Table>; 2],
    symbols: Table,
    strings: Table,
    versions: Versions,
}

impl Tables {
    fn relocations(self) -> impl Iterator<Item = Elf64_Rela> {
        self.relocations
            .into_iter()
            .flatten()
            .flat_map(|table| (0..).map_while(move |index| table.element::<Elf64_Rela>(index)))
    }
}

/// A slot that the host fills, and the function of its library that it stores there.
#[derive(Clone, Copy)]
struct Fill {
    slot: usize,
    function: usize,
}

/// Makes an object call `function` through a slot that `Image::is_writable` accepts.
unsafe fn store(slot: usize, function: usize) {
    // SAFETY: the slot is aligned and inside a range that the loader keeps writable, and the caller keeps the object loaded.
    let slot = unsafe { AtomicUsize::from_ptr(slot as *mut usize) };
    // Loads of one library in several Workers store the same value here at the same time, while other threads call through the slot.
    if slot.load(Ordering::SeqCst) != function {
        slot.store(function, Ordering::SeqCst);
    }
}

/// The tables of an object, or none if it has no relocations that the walk reads. `reads_rela_dyn` says whether the walk reads the table of `DT_RELA` beside that of `DT_JMPREL`.
fn tables(image: &Image, reads_rela_dyn: bool) -> Result<Option<Tables>, Unreadable> {
    let dynamic = image
        .headers
        .iter()
        .find(|header| header.p_type == PT_DYNAMIC)
        .ok_or(Unreadable::Dynamic)?;
    let address = image.base.wrapping_add(dynamic.p_vaddr as usize);
    let entries = Table {
        address,
        room: image
            .room(PT_LOAD, PF_R, address)
            .min(dynamic.p_memsz as usize),
    };

    let (mut rela_plt, mut rela_dyn, mut symbols, mut strings) = (None, None, None, None);
    let (mut rela_plt_size, mut rela_dyn_size, mut strings_size) = (0, 0, 0);
    let mut versions = Versions::default();
    for index in 0.. {
        let entry: Elf64_Dyn = entries.element(index).ok_or(Unreadable::Dynamic)?;
        let table = || image.table(entry.d_val).ok_or(Unreadable::Table);
        match entry.d_tag {
            DT_NULL => break,
            DT_JMPREL => rela_plt = Some(table()?),
            DT_RELA if reads_rela_dyn => rela_dyn = Some(table()?),
            DT_SYMTAB => symbols = Some(table()?),
            DT_STRTAB => strings = Some(table()?),
            DT_PLTRELSZ => rela_plt_size = entry.d_val as usize,
            DT_RELASZ => rela_dyn_size = entry.d_val as usize,
            DT_STRSZ => strings_size = entry.d_val as usize,
            DT_PLTREL if entry.d_val != DT_RELA as u64 => return Err(Unreadable::Relocations),
            DT_RELAENT if reads_rela_dyn && entry.d_val != RELA_SIZE => {
                return Err(Unreadable::Relocations);
            }
            DT_VERSYM => versions.symbols = Some(entry.d_val),
            DT_VERNEED => versions.needed = Some(entry.d_val),
            DT_VERNEEDNUM => versions.needed_count = entry.d_val,
            _ => {}
        }
    }
    let sized = |table: Option<Table>, size| match table {
        Some(table) if size > table.room => Err(Unreadable::Relocations),
        table => Ok(table.map(|table| Table {
            room: size,
            ..table
        })),
    };
    let relocations = [
        sized(rela_plt, rela_plt_size)?,
        sized(rela_dyn, rela_dyn_size)?,
    ];
    if relocations.iter().all(Option::is_none) {
        return Ok(None);
    }
    let (Some(symbols), Some(strings)) = (symbols, strings) else {
        return Err(Unreadable::Table);
    };
    let strings = Table {
        room: strings.room.min(strings_size),
        ..strings
    };
    Ok(Some(Tables {
        relocations,
        symbols,
        strings,
        versions,
    }))
}

/// The slots that the host fills with the functions of `library`: one for each relocation of the object that stores the address of one of these functions, or none at all. A slot that holds its function already is left out. The host fills none if one of these slots is bound to something else, which shows a definition of the library in the scope of the object, if `is_defined` finds one of the names, if one of the slots is not storable or its relocation has an addend, or if the host cannot read one of these relocations.
fn slots_to_fill(
    image: &Image,
    defers_got: bool,
    library: &[(&CStr, usize)],
    mut is_defined: impl FnMut(&CStr, Option<&CStr>) -> bool,
) -> Option<Vec<Fill>> {
    if library.is_empty() {
        return None;
    }
    let tables = tables(image, true).ok()??;
    let mut slots = Vec::new();
    for relocation in tables.relocations() {
        let kind = relocation.r_info as u32;
        if kind != R_JUMP_SLOT && kind != R_GLOB_DAT && kind != R_ABS64 {
            continue;
        }
        let symbol: Elf64_Sym = tables.symbols.element((relocation.r_info >> 32) as usize)?;
        let binding = symbol.st_info >> 4;
        if symbol.st_shndx != SHN_UNDEF || (binding != STB_GLOBAL && binding != STB_WEAK) {
            continue;
        }
        let name = tables.strings.string(symbol.st_name as usize)?;
        let Some(&(_, function)) = library.iter().find(|&&(import, _)| import == name) else {
            continue;
        };
        let slot = image.base.wrapping_add(relocation.r_offset as usize);
        let value = image.slot(slot)?;
        // The host has filled this slot in an earlier load of the object, or a load on another thread is filling the slots now.
        if value == function {
            continue;
        }
        if image.is_bound(value, defers_got) || (kind == R_ABS64 && relocation.r_addend != 0) {
            return None;
        }
        slots.push(Fill { slot, function });
    }
    let fills = !slots.is_empty()
        && !library.iter().any(|&(name, _)| is_defined(name, None))
        && slots.iter().all(|fill| image.is_writable(fill.slot));
    fills.then_some(slots)
}

/// The first import that the loader has left unbound and that `is_defined` rejects by its name and then by the version that the object names for it. An import whose slot is in `filled` counts as bound. `defers_got` is for musl, which leaves a `GLOB_DAT` import unbound too, and an unbound slot as the file has it.
fn unresolved_lazy_import<'a>(
    image: &Image<'a>,
    defers_got: bool,
    filled: &[Fill],
    mut is_defined: impl FnMut(&CStr, Option<&CStr>) -> bool,
) -> Result<Option<&'a CStr>, Unreadable> {
    let Some(tables) = tables(image, defers_got)? else {
        return Ok(None);
    };
    let Tables {
        symbols,
        strings,
        versions,
        ..
    } = tables;
    for relocation in tables.relocations() {
        let kind = relocation.r_info as u32;
        // glibc before 2.27 (aarch64) and before 2.34 (x86-64) binds a thread-local import in `DT_JMPREL` at its first access: until then the first word of its descriptor points at a stub of the object.
        if kind != R_JUMP_SLOT && kind != R_TLSDESC && !(defers_got && kind == R_GLOB_DAT) {
            continue;
        }
        let index = (relocation.r_info >> 32) as usize;
        let symbol: Elf64_Sym = symbols.element(index).ok_or(Unreadable::SymbolIndex)?;
        // A weak import may stay unresolved: the loader binds it to address 0.
        if symbol.st_info >> 4 != STB_GLOBAL || symbol.st_shndx != SHN_UNDEF {
            continue;
        }
        let slot = image.base.wrapping_add(relocation.r_offset as usize);
        // The loader has bound such a slot, so a definition exists and there is nothing to ask. The host binds a slot that it fills.
        let bound = image.is_bound(image.slot(slot).ok_or(Unreadable::Slot)?, defers_got);
        if bound || filled.iter().any(|fill| fill.slot == slot) {
            continue;
        }
        let name = strings
            .string(symbol.st_name as usize)
            .ok_or(Unreadable::SymbolName)?;
        if is_defined(name, None) {
            continue;
        }
        // The loader binds by the version that the object names, and a lookup by the name alone misses a definition that is kept only under an old version.
        let version = image.version(versions, strings, index);
        if !version.is_some_and(|version| is_defined(name, Some(version))) {
            return Ok(Some(name));
        }
    }
    Ok(None)
}

/// Checks the imports of an object whose loader keeps `headers` mapped at `base`: returns the first one that the loader has left unbound and that nothing defines (`unresolved_lazy_import`). `library` names functions that the host has and does not export, with their addresses. The host fills all the imports of these functions in the object or none (`slots_to_fill`): it decides that before the check, in which a slot that it fills counts as bound, and stores the functions after the check, if that has found nothing. With an empty `library` only the check runs.
pub unsafe fn resolve_lazy_imports<'a>(
    headers: &'a [libc::Elf64_Phdr],
    base: usize,
    defers_got: bool,
    library: &[(&CStr, usize)],
    mut is_defined: impl FnMut(&CStr, Option<&CStr>) -> bool,
) -> Result<Option<&'a CStr>, Unreadable> {
    let image = Image { headers, base };
    let fill = slots_to_fill(&image, defers_got, library, &mut is_defined).unwrap_or_default();
    let unresolved = unresolved_lazy_import(&image, defers_got, &fill, &mut is_defined)?;
    if unresolved.is_none() {
        for Fill { slot, function } in fill {
            // SAFETY: the slot is one that `Image::slot` has read and that `Image::is_writable` accepts, in the object that the caller keeps loaded.
            unsafe { store(slot, function) };
        }
    }
    Ok(unresolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PF_X: u32 = 1;
    const DT_REL: u64 = 17;
    const DT_DEBUG: i64 = 21;
    const DT_BIND_NOW: i64 = 24;
    const DT_FLAGS: i64 = 30;
    const DT_FLAGS_1: i64 = 0x6fff_fffb;
    const DF_BIND_NOW: u64 = 8;
    const DF_1_NOW: u64 = 1;
    /// The copy relocation of each processor, which every loader applies in dlopen().
    const R_COPY: u32 = R_GLOB_DAT - 1;
    const DYNAMIC_ENTRY: usize = 16;
    const SYMBOL: usize = 24;
    const RELOCATION: usize = 24;
    const VERSION_ENTRY: usize = 16;
    const SLOT: usize = size_of::<usize>();
    const STUB: usize = 16;
    const GAP: usize = 11 * SYMBOL;
    /// What a slot holds once the loader has bound it: an address in another object. This one is no address of a process, so no `Object` is around it.
    const ELSEWHERE: usize = 0xdef1_0000_0000_0000;
    /// The functions of the host's library, which no `Object` is around either.
    const DEFLATE: usize = 0xdef1_a7e0;
    const INFLATE: usize = 0x1f1a_7e00;
    const INFLATE_END: usize = 0x1f1a_7eed;
    const ZLIB: [(&CStr, usize); 3] = [
        (c"deflate", DEFLATE),
        (c"inflate", INFLATE),
        (c"inflateEnd", INFLATE_END),
    ];
    /// The last but one is a spare entry, which `add_dynamic` replaces.
    const DYNAMIC_TAGS: [i64; 14] = [
        DT_JMPREL,
        DT_PLTRELSZ,
        DT_PLTREL,
        DT_SYMTAB,
        DT_STRTAB,
        DT_STRSZ,
        DT_RELA,
        DT_RELASZ,
        DT_RELAENT,
        DT_VERSYM,
        DT_VERNEED,
        DT_VERNEEDNUM,
        DT_DEBUG,
        DT_NULL,
    ];
    /// The names of the version indexes 2 to 5, which every `Object` has at the start of its string table.
    const VERSIONS: [&str; 4] = ["VERSION_2", "VERSION_3", "VERSION_4", "VERSION_5"];
    /// The offsets of the fields of an `Elf64_Verneed` and of an `Elf64_Vernaux`.
    const VN_CNT: usize = 2;
    const VN_AUX: usize = 8;
    const VN_NEXT: usize = 12;
    const VNA_OTHER: usize = 6;
    const VNA_NAME: usize = 8;
    const VNA_NEXT: usize = 12;

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Section {
        RelaPlt,
        RelaDyn,
    }

    #[derive(Clone, Copy)]
    struct Import {
        name: &'static str,
        binding: u8,
        section: u16,
        relocation_type: u32,
        /// The table that has the relocation: that of `DT_JMPREL`, or that of `DT_RELA`.
        relocated_in: Section,
        /// The element of `DT_VERSYM` for the symbol: 1 is a symbol without a version.
        version: u16,
    }

    const fn import(name: &'static str) -> Import {
        Import {
            name,
            binding: STB_GLOBAL,
            section: SHN_UNDEF,
            relocation_type: R_JUMP_SLOT,
            relocated_in: Section::RelaPlt,
            version: 1,
        }
    }

    /// An import that names the version of index `version`.
    const fn versioned(name: &'static str, version: u16) -> Import {
        Import {
            version,
            ..import(name)
        }
    }

    /// An import through the global offset table, as `-fno-plt` compiles a call.
    const fn got_import(name: &'static str) -> Import {
        Import {
            relocation_type: R_GLOB_DAT,
            relocated_in: Section::RelaDyn,
            ..import(name)
        }
    }

    /// An import of a thread-local variable through a descriptor, which GNU ld relocates in the table of `DT_JMPREL`.
    const fn tls_import(name: &'static str) -> Import {
        Import {
            relocation_type: R_TLSDESC,
            ..import(name)
        }
    }

    /// An import whose address the object keeps in a word of its data.
    const fn absolute_import(name: &'static str) -> Import {
        Import {
            relocation_type: R_ABS64,
            ..got_import(name)
        }
    }

    const fn weak(import: Import) -> Import {
        Import {
            binding: STB_WEAK,
            ..import
        }
    }

    /// The offset of the name of a version index in the string table of an `Object`. The indexes below 2 get the first name.
    fn version_name(index: u16) -> u32 {
        let before = &VERSIONS[..usize::from(index).saturating_sub(2)];
        1 + before.iter().map(|name| name.len() as u32 + 1).sum::<u32>()
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Pointers {
        Addresses,
        Offsets,
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Linked {
        AtZero,
        AboveItsMapping,
    }

    /// An object in this process's memory: the symbols, strings and relocations of `DT_JMPREL` in one segment, and after gaps the dynamic section in another, the version tables and the relocations of `DT_RELA` in a third, the slots of the imports in a fourth, and their stubs in a fifth, which is not readable.
    struct Object {
        memory: Vec<u8>,
        link_address: u64,
        tables_flags: u32,
        tables_size: usize,
        strings_size: usize,
        relocations: usize,
        dynamic: usize,
        dynamic_load_size: usize,
        dynamic_size: Option<usize>,
        /// The third segment, which starts with the `DT_VERSYM` array.
        versions: usize,
        versions_size: usize,
        /// The `DT_VERNEED` table, which is empty until `set_version_needs`.
        version_needs: usize,
        /// The `DT_RELA` table, with an entry for each import as the `DT_JMPREL` table has.
        data_relocations: usize,
        /// Whether the walk is that of musl.
        defers_got: bool,
        /// A slot for each import. That of a jump slot points at its stub, as glibc and FreeBSD leave it, and that of a `GLOB_DAT` or of a word of data holds 0.
        slots: usize,
        slots_flags: u32,
        slots_size: usize,
        stubs: usize,
        stubs_size: usize,
        /// The `PT_GNU_RELRO` range, if the object has one.
        read_only_after_relocation: Option<(usize, usize)>,
    }

    impl Object {
        fn new(linked: Linked, pointers: Pointers, imports: &[Import]) -> Object {
            Object::with_version_needs_room(linked, pointers, imports, 8 * VERSION_ENTRY)
        }

        fn with_version_needs_room(
            linked: Linked,
            pointers: Pointers,
            imports: &[Import],
            version_needs_room: usize,
        ) -> Object {
            let mut names = vec![0u8];
            for version in VERSIONS {
                names.extend_from_slice(version.as_bytes());
                names.push(0);
            }
            let name_offsets: Vec<usize> = imports
                .iter()
                .map(|import| {
                    names.extend_from_slice(import.name.as_bytes());
                    names.push(0);
                    names.len() - import.name.len() - 1
                })
                .collect();
            let strings = (1 + imports.len()) * SYMBOL;
            let relocations = strings + names.len().next_multiple_of(SYMBOL);
            let tables_size = relocations + imports.len() * RELOCATION;
            let dynamic = tables_size + GAP;
            let dynamic_load_size = DYNAMIC_TAGS.len() * DYNAMIC_ENTRY;
            let versions = dynamic + dynamic_load_size + GAP;
            let version_needs = versions + (2 * (1 + imports.len())).next_multiple_of(8);
            let data_relocations = version_needs + version_needs_room;
            let versions_size = data_relocations + imports.len() * RELOCATION - versions;
            let (slots_size, stubs_size) = (imports.len() * SLOT, imports.len() * STUB);
            let slots = versions + versions_size + GAP;
            let memory = vec![0; slots + SLOT + slots_size + GAP + stubs_size + GAP];
            let slots = (memory.as_ptr() as usize + slots).next_multiple_of(SLOT)
                - memory.as_ptr() as usize;
            let stubs = slots + slots_size + GAP;

            let mut object = Object {
                memory,
                link_address: 0,
                tables_flags: PF_R,
                tables_size,
                strings_size: names.len(),
                relocations,
                dynamic,
                dynamic_load_size,
                dynamic_size: Some(dynamic_load_size),
                versions,
                versions_size,
                version_needs,
                data_relocations,
                defers_got: false,
                slots,
                slots_flags: PF_R | PF_W,
                slots_size,
                stubs,
                stubs_size,
                read_only_after_relocation: None,
            };
            if linked == Linked::AboveItsMapping {
                object.link_address = (object.memory.as_ptr() as u64).wrapping_add(0x1000_0000);
            }
            object.memory[strings..][..names.len()].copy_from_slice(&names);
            for (index, import) in imports.iter().enumerate() {
                let symbol = (1 + index) * SYMBOL;
                object.write_u32(symbol, name_offsets[index] as u32);
                object.memory[symbol + 4] = import.binding << 4;
                object.write_u16(symbol + 6, import.section);
                object.write_u16(versions + 2 * (1 + index), import.version);
                match import.relocated_in {
                    Section::RelaPlt => {
                        object.set_relocation(index, 1 + index, import.relocation_type)
                    }
                    Section::RelaDyn => {
                        object.set_data_relocation(index, 1 + index, import.relocation_type)
                    }
                }
                object.set_relocation_offset(index, slots + index * SLOT);
                if import.relocation_type != R_GLOB_DAT && import.relocation_type != R_ABS64 {
                    object.set_slot(index, object.stub(index));
                }
            }
            let values = [
                object.pointer(pointers, relocations),
                (imports.len() * RELOCATION) as u64,
                DT_RELA as u64,
                object.pointer(pointers, 0),
                object.pointer(pointers, strings),
                names.len() as u64,
                object.pointer(pointers, data_relocations),
                (imports.len() * RELOCATION) as u64,
                RELOCATION as u64,
                object.pointer(pointers, versions),
                object.pointer(pointers, version_needs),
                0,
                0,
                0,
            ];
            for (index, (tag, value)) in DYNAMIC_TAGS.into_iter().zip(values).enumerate() {
                object.write_u64(dynamic + index * DYNAMIC_ENTRY, tag as u64);
                object.write_u64(dynamic + index * DYNAMIC_ENTRY + 8, value);
            }
            object
        }

        fn pointer(&self, pointers: Pointers, offset: usize) -> u64 {
            match pointers {
                Pointers::Addresses => self.memory.as_ptr() as u64 + offset as u64,
                Pointers::Offsets => self.link_address.wrapping_add(offset as u64),
            }
        }

        fn base(&self) -> usize {
            (self.memory.as_ptr() as usize).wrapping_sub(self.link_address as usize)
        }

        fn write_u16(&mut self, offset: usize, value: u16) {
            self.memory[offset..][..2].copy_from_slice(&value.to_le_bytes());
        }

        fn write_u32(&mut self, offset: usize, value: u32) {
            self.memory[offset..][..4].copy_from_slice(&value.to_le_bytes());
        }

        fn write_u64(&mut self, offset: usize, value: u64) {
            self.memory[offset..][..8].copy_from_slice(&value.to_le_bytes());
        }

        fn set_relocation(&mut self, index: usize, symbol: usize, relocation_type: u32) {
            let info = (symbol as u64) << 32 | u64::from(relocation_type);
            self.write_u64(self.relocations + index * RELOCATION + 8, info);
        }

        fn set_data_relocation(&mut self, index: usize, symbol: usize, relocation_type: u32) {
            let info = (symbol as u64) << 32 | u64::from(relocation_type);
            self.write_u64(self.data_relocations + index * RELOCATION + 8, info);
        }

        /// Makes the relocation of an import, in either table, name the slot at `offset`.
        fn set_relocation_offset(&mut self, index: usize, offset: usize) {
            let offset = self.link_address.wrapping_add(offset as u64);
            self.write_u64(self.relocations + index * RELOCATION, offset);
            self.write_u64(self.data_relocations + index * RELOCATION, offset);
        }

        /// Gives the relocation of an import, in either table, an addend.
        fn set_relocation_addend(&mut self, index: usize, addend: i64) {
            self.write_u64(self.relocations + index * RELOCATION + 16, addend as u64);
            self.write_u64(
                self.data_relocations + index * RELOCATION + 16,
                addend as u64,
            );
        }

        fn set_slot(&mut self, import: usize, value: usize) {
            self.write_u64(self.slots + import * SLOT, value as u64);
        }

        fn slot_values(&self) -> Vec<usize> {
            let (slots, _) = self.memory[self.slots..].as_chunks::<SLOT>();
            let imports = (self.tables_size - self.relocations) / RELOCATION;
            slots[..imports]
                .iter()
                .map(|slot| usize::from_le_bytes(*slot))
                .collect()
        }

        /// The address of `offset` in the memory of the object.
        fn address(&self, offset: usize) -> usize {
            self.memory.as_ptr() as usize + offset
        }

        /// The address of the stub of an import, where its slot points until the loader binds it.
        fn stub(&self, import: usize) -> usize {
            self.address(self.stubs + import * STUB)
        }

        /// The same as the file has it: the loader has not added the base.
        fn stub_as_linked(&self, import: usize) -> usize {
            (self.link_address as usize).wrapping_add(self.stubs + import * STUB)
        }

        /// Writes the `DT_VERNEED` table: an `Elf64_Verneed` for each of `needs`, each before an `Elf64_Vernaux` for each of its version indexes.
        fn set_version_needs(&mut self, needs: &[&[u16]]) {
            let mut need = self.version_needs;
            for (position, indexes) in needs.iter().enumerate() {
                let size = (1 + indexes.len()) * VERSION_ENTRY;
                let last = position + 1 == needs.len();
                self.write_u16(need + VN_CNT, indexes.len() as u16);
                self.write_u32(need + VN_AUX, VERSION_ENTRY as u32);
                self.write_u32(need + VN_NEXT, if last { 0 } else { size as u32 });
                for (position, &index) in indexes.iter().enumerate() {
                    let aux = need + (1 + position) * VERSION_ENTRY;
                    let last = position + 1 == indexes.len();
                    self.write_u16(aux + VNA_OTHER, index);
                    self.write_u32(aux + VNA_NAME, version_name(index & VERSION_INDEX));
                    self.write_u32(aux + VNA_NEXT, if last { 0 } else { VERSION_ENTRY as u32 });
                }
                need += size;
            }
            self.set_dynamic(DT_VERNEEDNUM, needs.len() as u64);
        }

        /// The offset of a field of the `entry`th `Elf64_Verneed` or `Elf64_Vernaux` of the `DT_VERNEED` table.
        fn version_field(&self, entry: usize, field: usize) -> usize {
            self.version_needs + entry * VERSION_ENTRY + field
        }

        fn set_symbol_name(&mut self, import: usize, offset: usize) {
            self.write_u32((1 + import) * SYMBOL, offset as u32);
        }

        fn dynamic_entry(&self, tag: i64) -> usize {
            self.dynamic + DYNAMIC_TAGS.iter().position(|&t| t == tag).unwrap() * DYNAMIC_ENTRY
        }

        fn set_dynamic(&mut self, tag: i64, value: u64) {
            self.write_u64(self.dynamic_entry(tag) + 8, value);
        }

        fn set_dynamic_tag(&mut self, tag: i64, new_tag: i64) {
            self.write_u64(self.dynamic_entry(tag), new_tag as u64);
        }

        fn add_dynamic(&mut self, tag: i64, value: u64) {
            self.set_dynamic(DT_DEBUG, value);
            self.set_dynamic_tag(DT_DEBUG, tag);
        }

        fn headers(&self) -> Vec<libc::Elf64_Phdr> {
            let header = |p_type, p_flags, offset: usize, size: usize| libc::Elf64_Phdr {
                p_type,
                p_flags,
                p_offset: offset as u64,
                p_vaddr: self.link_address.wrapping_add(offset as u64),
                p_paddr: 0,
                p_filesz: size as u64,
                p_memsz: size as u64,
                p_align: 1,
            };
            let mut headers = vec![
                header(PT_LOAD, self.tables_flags, 0, self.tables_size),
                header(PT_LOAD, PF_R | PF_W, self.dynamic, self.dynamic_load_size),
                header(PT_LOAD, PF_R, self.versions, self.versions_size),
                header(PT_LOAD, self.slots_flags, self.slots, self.slots_size),
                header(PT_LOAD, PF_X, self.stubs, self.stubs_size),
            ];
            if let Some(size) = self.dynamic_size {
                headers.push(header(PT_DYNAMIC, PF_R | PF_W, self.dynamic, size));
            }
            if let Some((offset, size)) = self.read_only_after_relocation {
                headers.push(header(PT_GNU_RELRO, PF_R, offset, size));
            }
            headers
        }

        /// The result for a host with `library` when only `defined` have a definition, and what it asked for: each a name, or a name and a version as `name@version`.
        fn resolve_with(
            &self,
            library: &[(&CStr, usize)],
            defined: &[&str],
        ) -> (Result<Option<String>, Unreadable>, Vec<String>) {
            let mut asked = Vec::new();
            let headers = self.headers();
            let is_defined = |name: &CStr, version: Option<&CStr>| {
                let mut question = name.to_str().unwrap().to_owned();
                if let Some(version) = version {
                    question = format!("{question}@{}", version.to_str().unwrap());
                }
                asked.push(question);
                defined.contains(&asked.last().unwrap().as_str())
            };
            // SAFETY: the headers describe ranges inside `self.memory`, which outlives the call.
            let found = unsafe {
                resolve_lazy_imports(&headers, self.base(), self.defers_got, library, is_defined)
            };
            (
                found.map(|name| name.map(|name| name.to_str().unwrap().to_owned())),
                asked,
            )
        }

        /// The same for a host without a library, as the targets are where the host fills nothing: the check alone.
        fn walk(&self, defined: &[&str]) -> (Result<Option<String>, Unreadable>, Vec<String>) {
            self.resolve_with(&[], defined)
        }

        /// The same for a host that has `ZLIB`.
        fn resolve(&self, defined: &[&str]) -> (Result<Option<String>, Unreadable>, Vec<String>) {
            self.resolve_with(&ZLIB, defined)
        }
    }

    const IMPORTS: [Import; 3] = [import("first"), import("second"), import("third")];

    fn unresolved(name: &str) -> Result<Option<String>, Unreadable> {
        Ok(Some(name.to_owned()))
    }

    #[test]
    fn reads_tables_given_as_addresses() {
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        assert_eq!(
            object.walk(&["first"]),
            (
                unresolved("second"),
                vec!["first".to_owned(), "second".to_owned()]
            )
        );
        assert_eq!(object.walk(&["first", "second", "third"]).0, Ok(None));
    }

    #[test]
    fn reads_tables_given_as_offsets() {
        let object = Object::new(Linked::AtZero, Pointers::Offsets, &IMPORTS);
        assert_eq!(
            object.walk(&["first"]),
            (
                unresolved("second"),
                vec!["first".to_owned(), "second".to_owned()]
            )
        );
        assert_eq!(object.walk(&["first", "second", "third"]).0, Ok(None));
    }

    #[test]
    fn reads_tables_of_an_object_whose_base_is_above_them() {
        for pointers in [Pointers::Addresses, Pointers::Offsets] {
            let object = Object::new(Linked::AboveItsMapping, pointers, &IMPORTS);
            assert!(object.base() > object.memory.as_ptr() as usize + object.memory.len());
            assert_eq!(object.walk(&["first", "second"]).0, unresolved("third"));
        }
    }

    #[test]
    fn refuses_a_symbol_index_outside_the_range_of_the_symbol_table() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        let entries_in_range = object.tables_size / SYMBOL;
        assert_eq!(entries_in_range * SYMBOL, object.tables_size);
        object.set_relocation(1, entries_in_range - 1, R_JUMP_SLOT);
        assert_eq!(
            object.walk(&["first"]),
            (
                unresolved("third"),
                vec!["first".to_owned(), "third".to_owned()]
            )
        );
        object.set_relocation(1, entries_in_range, R_JUMP_SLOT);
        assert_eq!(
            object.walk(&["first"]),
            (Err(Unreadable::SymbolIndex), vec!["first".to_owned()])
        );
    }

    #[test]
    fn refuses_a_symbol_in_another_segment() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        assert_eq!(object.dynamic % SYMBOL, 0);
        object.set_relocation(0, object.dynamic / SYMBOL, R_JUMP_SLOT);
        assert_eq!(object.walk(&[]), (Err(Unreadable::SymbolIndex), vec![]));
    }

    #[test]
    fn refuses_a_symbol_name_that_does_not_end_inside_the_string_table() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.set_symbol_name(0, object.strings_size - 1);
        assert_eq!(object.walk(&[""]).0, unresolved("second"));
        object.set_symbol_name(0, object.strings_size);
        assert_eq!(object.walk(&[""]), (Err(Unreadable::SymbolName), vec![]));

        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.set_dynamic(DT_STRSZ, object.strings_size as u64 - 1);
        assert_eq!(
            object.walk(&["first", "second"]),
            (
                Err(Unreadable::SymbolName),
                vec!["first".to_owned(), "second".to_owned()]
            )
        );
    }

    #[test]
    fn refuses_a_dynamic_section_without_an_end_inside_its_size() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.dynamic_size = Some(object.dynamic_load_size - DYNAMIC_ENTRY / 2);
        assert_eq!(object.walk(&[]), (Err(Unreadable::Dynamic), vec![]));
    }

    #[test]
    fn refuses_a_dynamic_section_without_an_end_inside_its_segment() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.dynamic_load_size -= DYNAMIC_ENTRY / 2;
        assert_eq!(object.walk(&[]), (Err(Unreadable::Dynamic), vec![]));
    }

    #[test]
    fn refuses_an_object_without_a_dynamic_section() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.dynamic_size = None;
        assert_eq!(object.walk(&[]), (Err(Unreadable::Dynamic), vec![]));
    }

    #[test]
    fn refuses_relocations_that_do_not_end_inside_their_segment() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.set_dynamic(DT_PLTRELSZ, (IMPORTS.len() * RELOCATION + 1) as u64);
        assert_eq!(
            object.walk(&["first", "second", "third"]),
            (Err(Unreadable::Relocations), vec![])
        );
    }

    #[test]
    fn refuses_relocations_of_another_format() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.set_dynamic(DT_PLTREL, DT_REL);
        assert_eq!(object.walk(&[]), (Err(Unreadable::Relocations), vec![]));
    }

    #[test]
    fn refuses_a_table_outside_the_segments() {
        for pointers in [Pointers::Addresses, Pointers::Offsets] {
            for tag in [DT_JMPREL, DT_SYMTAB, DT_STRTAB] {
                let mut object = Object::new(Linked::AtZero, pointers, &IMPORTS);
                object.set_dynamic(tag, object.pointer(pointers, object.tables_size));
                assert_eq!(object.walk(&[]), (Err(Unreadable::Table), vec![]));
            }
        }
    }

    #[test]
    fn refuses_a_table_in_a_segment_that_is_not_readable() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.tables_flags = 0;
        assert_eq!(object.walk(&[]), (Err(Unreadable::Table), vec![]));
    }

    #[test]
    fn refuses_relocations_without_a_symbol_table_or_a_string_table() {
        for tag in [DT_SYMTAB, DT_STRTAB] {
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
            object.set_dynamic_tag(tag, DT_DEBUG);
            assert_eq!(object.walk(&[]), (Err(Unreadable::Table), vec![]));
        }
    }

    #[test]
    fn an_object_without_lazy_relocations_has_no_unresolved_import() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.set_dynamic_tag(DT_JMPREL, DT_DEBUG);
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
    }

    #[test]
    fn ignores_a_weak_import() {
        let weak = Import {
            binding: STB_WEAK,
            ..import("weak")
        };
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &[weak]);
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
    }

    #[test]
    fn ignores_a_symbol_that_the_object_defines() {
        let own = Import {
            section: 1,
            ..import("own")
        };
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &[own]);
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
    }

    #[test]
    fn ignores_a_relocation_that_no_loader_binds_late() {
        let data = Import {
            relocation_type: R_COPY,
            ..import("data")
        };
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &[data]);
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
    }

    #[test]
    fn asks_about_a_thread_local_import_whose_descriptor_is_not_resolved() {
        for defers_got in [false, true] {
            let imports = [import("first"), tls_import("variable"), import("third")];
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
            object.defers_got = defers_got;
            // The first word of a descriptor that the loader resolves at the first access points at a stub of the object, as an unbound jump slot does.
            assert_eq!(object.slot_values()[1], object.stub(1));
            assert_eq!(
                object.walk(&["first", "third"]),
                (unresolved("variable"), asked(&["first", "variable"]))
            );
            assert_eq!(
                object.walk(&["first", "variable", "third"]),
                (Ok(None), asked(&["first", "variable", "third"]))
            );
        }
    }

    #[test]
    fn skips_a_thread_local_import_whose_descriptor_is_resolved() {
        for defers_got in [false, true] {
            let imports = [import("first"), tls_import("variable"), import("third")];
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
            object.defers_got = defers_got;
            // A resolved descriptor starts with the address of a function of the loader.
            object.set_slot(1, ELSEWHERE);
            assert_eq!(
                object.walk(&["first", "third"]),
                (Ok(None), asked(&["first", "third"]))
            );
        }
    }

    fn asked(questions: &[&str]) -> Vec<String> {
        questions
            .iter()
            .map(|&question| question.to_owned())
            .collect()
    }

    #[test]
    fn skips_an_import_whose_slot_is_bound() {
        for defers_got in [false, true] {
            for linked in [Linked::AtZero, Linked::AboveItsMapping] {
                let mut object = Object::new(linked, Pointers::Offsets, &IMPORTS);
                object.defers_got = defers_got;
                object.set_slot(0, ELSEWHERE);
                object.set_slot(2, ELSEWHERE);
                // Nothing that the walk can ask defines `first` and `third`: their slots say that the loader found them.
                assert_eq!(object.walk(&[]), (unresolved("second"), asked(&["second"])));
                assert_eq!(object.walk(&["second"]), (Ok(None), asked(&["second"])));
                object.set_slot(1, ELSEWHERE);
                assert_eq!(object.walk(&[]), (Ok(None), vec![]));
            }
        }
    }

    #[test]
    fn skips_a_got_import_whose_slot_is_bound() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &MUSL_IMPORTS);
        object.defers_got = true;
        assert_eq!(
            object.walk(&["first"]),
            (unresolved("second"), asked(&["first", "second"]))
        );
        object.set_slot(1, ELSEWHERE);
        assert_eq!(
            object.walk(&["first"]),
            (unresolved("third"), asked(&["first", "third"]))
        );
        object.set_slot(2, ELSEWHERE);
        assert_eq!(object.walk(&["first"]), (Ok(None), asked(&["first"])));
    }

    #[test]
    fn asks_about_an_import_whose_slot_points_into_the_object() {
        let walk = |value: fn(&Object) -> usize| {
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS[..1]);
            object.set_slot(0, value(&object));
            object.walk(&[])
        };
        // The ends of the first and the last segment, and the start of each of the others, whatever its flags are.
        let inside: [fn(&Object) -> usize; 7] = [
            |object| object.address(0),
            |object| object.address(object.tables_size - 1),
            |object| object.address(object.dynamic),
            |object| object.address(object.versions),
            |object| object.address(object.slots),
            |object| object.address(object.stubs),
            |object| object.address(object.stubs + object.stubs_size - 1),
        ];
        for (case, value) in inside.into_iter().enumerate() {
            assert_eq!(
                walk(value),
                (unresolved("first"), asked(&["first"])),
                "{case}"
            );
        }
        let outside: [fn(&Object) -> usize; 3] = [
            |object| object.address(0) - 1,
            |object| object.address(object.tables_size),
            |object| object.address(object.stubs + object.stubs_size),
        ];
        for (case, value) in outside.into_iter().enumerate() {
            assert_eq!(walk(value), (Ok(None), vec![]), "{case}");
        }
    }

    #[test]
    fn asks_about_an_import_whose_slot_holds_no_address() {
        for defers_got in [false, true] {
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
            object.defers_got = defers_got;
            object.set_slot(0, ELSEWHERE);
            object.set_slot(1, 0);
            object.set_slot(2, ELSEWHERE);
            assert_eq!(object.walk(&[]), (unresolved("second"), asked(&["second"])));
        }
    }

    #[test]
    fn asks_about_a_slot_that_is_as_the_file_has_it_only_for_a_loader_that_leaves_it_so() {
        for linked in [Linked::AtZero, Linked::AboveItsMapping] {
            let mut object = Object::new(linked, Pointers::Offsets, &IMPORTS);
            for import in 0..IMPORTS.len() {
                object.set_slot(import, object.stub_as_linked(import));
            }
            // glibc and FreeBSD add the base to a slot that they do not bind: to them this value is an address outside the object.
            assert_eq!(object.walk(&[]), (Ok(None), vec![]));
            object.defers_got = true;
            assert_eq!(
                object.walk(&["first"]),
                (unresolved("second"), asked(&["first", "second"]))
            );
            object.set_slot(1, ELSEWHERE);
            assert_eq!(
                object.walk(&["first"]),
                (unresolved("third"), asked(&["first", "third"]))
            );
        }
    }

    #[test]
    fn refuses_a_slot_that_is_not_a_readable_pointer() {
        let cases: [(&str, &[&str], fn(&mut Object)); 4] = [
            ("outside the segments", &["first"], |object| {
                object.set_relocation_offset(1, object.slots + object.slots_size)
            }),
            ("in a segment that is not readable", &[], |object| {
                object.slots_flags = PF_W
            }),
            (
                "without room for a pointer",
                &["first", "second"],
                |object| object.slots_size -= SLOT / 2,
            ),
            ("not aligned", &["first"], |object| {
                object.set_relocation_offset(1, object.slots + SLOT + SLOT / 2)
            }),
        ];
        for (case, questions, change) in cases {
            for defers_got in [false, true] {
                let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
                object.defers_got = defers_got;
                change(&mut object);
                assert_eq!(
                    object.walk(&["first", "second", "third"]),
                    (Err(Unreadable::Slot), asked(questions)),
                    "{case}"
                );
            }
        }

        // The walk reads the slot of no other relocation: a weak import, a symbol that the object defines, another type.
        let imports = [
            Import {
                binding: STB_WEAK,
                ..import("weak")
            },
            Import {
                section: 1,
                ..import("own")
            },
            Import {
                relocation_type: R_COPY,
                ..import("data")
            },
        ];
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
        object.slots_flags = PF_W;
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
    }

    #[test]
    fn reads_no_name_of_an_import_whose_slot_is_bound() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        object.set_dynamic(DT_STRSZ, 0);
        assert_eq!(object.walk(&[]), (Err(Unreadable::SymbolName), vec![]));
        for import in 0..IMPORTS.len() {
            object.set_slot(import, ELSEWHERE);
        }
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
    }

    /// The three ways in which a dynamic section asks the loader to bind every import when it loads the object.
    const BOUND_AT_LOAD: [(i64, u64); 4] = [
        (DT_BIND_NOW, 0),
        (DT_FLAGS, DF_BIND_NOW),
        (DT_FLAGS, DF_BIND_NOW | 0x12),
        (DT_FLAGS_1, DF_1_NOW | 0x800_0000),
    ];

    #[test]
    fn asks_about_an_unbound_slot_of_an_object_that_asks_to_be_bound_at_load() {
        for (tag, value) in BOUND_AT_LOAD {
            for defers_got in [false, true] {
                let imports = [import("first"), got_import("second"), import("third")];
                let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
                object.defers_got = defers_got;
                object.set_slot(2, ELSEWHERE);
                let unflagged = [object.walk(&[]), object.walk(&["first"])];
                assert_eq!(unflagged[0], (unresolved("first"), asked(&["first"])));
                // A glibc that profiles or audits calls (LD_PROFILE, LD_AUDIT) binds such an object at the first call all the same.
                object.add_dynamic(tag, value);
                let flagged = [object.walk(&[]), object.walk(&["first"])];
                assert_eq!(flagged, unflagged, "{tag} {value}");
            }
        }
    }

    /// `old` names the version of index 3, between two imports without a version.
    const VERSIONED_IMPORTS: [Import; 3] = [import("first"), versioned("old", 3), import("third")];

    fn versioned_object(pointers: Pointers) -> Object {
        let mut object = Object::new(Linked::AtZero, pointers, &VERSIONED_IMPORTS);
        object.set_version_needs(&[&[2, 3]]);
        object
    }

    #[test]
    fn asks_for_the_version_of_an_import_that_has_no_definition_by_its_name() {
        for pointers in [Pointers::Addresses, Pointers::Offsets] {
            let object = versioned_object(pointers);
            assert_eq!(
                object.walk(&["first", "old@VERSION_3", "third"]),
                (Ok(None), asked(&["first", "old", "old@VERSION_3", "third"]))
            );
            assert_eq!(
                object.walk(&["first", "old@VERSION_2", "third"]),
                (unresolved("old"), asked(&["first", "old", "old@VERSION_3"]))
            );
        }
    }

    #[test]
    fn reads_no_version_of_an_import_that_has_a_definition_by_its_name() {
        let object = versioned_object(Pointers::Addresses);
        assert_eq!(
            object.walk(&["first", "old", "old@VERSION_3", "third"]),
            (Ok(None), asked(&["first", "old", "third"]))
        );
    }

    #[test]
    fn reads_the_version_tables_of_an_object_that_has_one_as_an_address_and_one_as_an_offset() {
        // What glibc leaves: it adds the base to `DT_VERSYM` in place, as to the other tables here, and never to `DT_VERNEED`.
        let mut object = versioned_object(Pointers::Addresses);
        let offset = object.pointer(Pointers::Offsets, object.version_needs);
        assert_ne!(
            offset,
            object.pointer(Pointers::Addresses, object.version_needs)
        );
        object.set_dynamic(DT_VERNEED, offset);
        assert_eq!(
            object.walk(&["first", "old@VERSION_3", "third"]),
            (Ok(None), asked(&["first", "old", "old@VERSION_3", "third"]))
        );
    }

    #[test]
    fn asks_only_by_the_name_for_an_import_without_a_version() {
        // 0 and 1 are the indexes of a symbol without a version, also where an entry of the table claims them.
        for index in [0, 1, 0x8000, 0x8001] {
            let imports = [versioned("plain", index), import("other")];
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
            object.set_version_needs(&[&[0, 1, 2]]);
            assert_eq!(
                object.walk(&["plain@VERSION_2", "other"]),
                (unresolved("plain"), asked(&["plain"])),
                "{index}"
            );
        }
    }

    #[test]
    fn ignores_the_bit_of_a_hidden_version() {
        for (symbol, needed) in [(0x8003, 3), (3, 0x8003), (0x8003, 0x8003)] {
            let mut object = Object::new(
                Linked::AtZero,
                Pointers::Addresses,
                &[versioned("old", symbol)],
            );
            object.set_version_needs(&[&[2, needed]]);
            assert_eq!(
                object.walk(&["old@VERSION_3"]),
                (Ok(None), asked(&["old", "old@VERSION_3"]))
            );
        }
    }

    #[test]
    fn finds_a_version_in_each_entry_of_each_needed_library() {
        for index in 2..=5 {
            let mut object = Object::new(
                Linked::AboveItsMapping,
                Pointers::Offsets,
                &[versioned("old", index)],
            );
            object.set_version_needs(&[&[2, 3], &[4, 5]]);
            let version = format!("old@VERSION_{index}");
            assert_eq!(
                object.walk(&[&version]),
                (Ok(None), asked(&["old", &version]))
            );
        }
        // No entry has the index: the answer by the name stands.
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &[versioned("old", 6)]);
        object.set_version_needs(&[&[2, 3], &[4, 5]]);
        assert_eq!(object.walk(&[]), (unresolved("old"), asked(&["old"])));
    }

    #[test]
    fn version_tables_that_are_missing_or_malformed_name_no_version() {
        // The table is a need, its two entries, a second need and its two entries: 0 to 5. The last has the version of `old`.
        let outside = |object: &Object| object.pointer(Pointers::Addresses, object.tables_size);
        let cases: [(&str, &dyn Fn(&mut Object)); 18] = [
            ("no DT_VERSYM", &|object| {
                object.set_dynamic_tag(DT_VERSYM, DT_DEBUG)
            }),
            ("no DT_VERNEED", &|object| {
                object.set_dynamic_tag(DT_VERNEED, DT_DEBUG)
            }),
            ("no DT_VERNEEDNUM", &|object| {
                object.set_dynamic_tag(DT_VERNEEDNUM, DT_DEBUG)
            }),
            ("DT_VERNEEDNUM ends before the entry", &|object| {
                object.set_dynamic(DT_VERNEEDNUM, 1)
            }),
            ("vn_cnt ends before the entry", &|object| {
                object.write_u16(object.version_field(3, VN_CNT), 1)
            }),
            ("DT_VERSYM is outside the segments", &|object| {
                object.set_dynamic(DT_VERSYM, outside(object))
            }),
            ("DT_VERNEED is outside the segments", &|object| {
                object.set_dynamic(DT_VERNEED, outside(object))
            }),
            (
                "the element of DT_VERSYM is outside its segment",
                &|object| {
                    let end = object.versions + object.versions_size;
                    object.set_dynamic(DT_VERSYM, object.pointer(Pointers::Addresses, end - 2))
                },
            ),
            ("vn_next is its own entry", &|object| {
                object.write_u32(object.version_field(0, VN_NEXT), 0)
            }),
            ("vna_next is its own entry", &|object| {
                object.write_u32(object.version_field(4, VNA_NEXT), 0)
            }),
            (
                "vn_next is the first need again, if the offset wraps",
                &|object| {
                    let back = 0u32.wrapping_sub(3 * VERSION_ENTRY as u32);
                    object.write_u32(object.version_field(3, VN_NEXT), back);
                    object.write_u16(object.version_field(3, VN_CNT), 1);
                    object.set_dynamic(DT_VERNEEDNUM, u64::MAX)
                },
            ),
            (
                "vna_next is the entry before, if the offset wraps",
                &|object| {
                    let back = 0u32.wrapping_sub(VERSION_ENTRY as u32);
                    object.write_u32(object.version_field(5, VNA_NEXT), back);
                    object.write_u16(object.version_field(5, VNA_OTHER), 4);
                    object.write_u16(object.version_field(3, VN_CNT), u16::MAX)
                },
            ),
            ("vn_next is outside the segment", &|object| {
                object.write_u32(object.version_field(0, VN_NEXT), u32::MAX)
            }),
            ("vna_next is outside the segment", &|object| {
                object.write_u32(object.version_field(4, VNA_NEXT), u32::MAX)
            }),
            ("vn_aux is outside the segment", &|object| {
                let size = object.versions_size as u32;
                object.write_u32(object.version_field(3, VN_AUX), size)
            }),
            ("the entry ends outside the segment", &|object| {
                object.versions_size = object.version_field(6, 0) - 1 - object.versions
            }),
            ("the name is outside the string table", &|object| {
                let size = object.strings_size as u32;
                object.write_u32(object.version_field(5, VNA_NAME), size)
            }),
            ("the name does not end inside the string table", &|object| {
                // The string table ends with the name of the last import, which loses its end here.
                let last = object.strings_size - "last\0".len();
                object.write_u32(object.version_field(5, VNA_NAME), last as u32);
                object.set_dynamic(DT_STRSZ, object.strings_size as u64 - 1)
            }),
        ];
        for (case, change) in cases {
            let imports = [versioned("old", 5), import("last")];
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
            object.set_version_needs(&[&[2, 3], &[4, 5]]);
            assert_eq!(
                object.walk(&["old@VERSION_5", "last"]),
                (Ok(None), asked(&["old", "old@VERSION_5", "last"]))
            );
            change(&mut object);
            assert_eq!(
                object.walk(&["old@VERSION_5", "old@last", "last"]),
                (unresolved("old"), asked(&["old"])),
                "{case}"
            );
        }
    }

    #[test]
    fn counts_that_are_larger_than_the_chains_do_not_keep_the_walk_going() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &[versioned("old", 5)]);
        object.set_version_needs(&[&[2, 3], &[4, 5]]);
        object.set_dynamic(DT_VERNEEDNUM, u64::MAX);
        for need in [0, 3 * VERSION_ENTRY] {
            object.write_u16(object.version_needs + need + VN_CNT, u16::MAX);
        }
        assert_eq!(
            object.walk(&["old@VERSION_5"]),
            (Ok(None), asked(&["old", "old@VERSION_5"]))
        );
        // Without the wanted entry the walk reads both chains to their ends and stops there.
        object.write_u16(object.version_needs + 5 * VERSION_ENTRY + VNA_OTHER, 4);
        assert_eq!(object.walk(&[]), (unresolved("old"), asked(&["old"])));
    }

    #[test]
    #[cfg_attr(miri, ignore = "Miri walks these chains for half an hour")]
    fn a_chain_of_more_entries_than_an_object_can_name_versions_ends_the_walk() {
        // `links` entries without the version, and after them the need and the entry that have it. The links are needs without entries, or the entries of one need.
        let object = |links: usize, links_are_needs: bool| {
            let imports = [versioned("old", 2)];
            let room = (links + 3) * VERSION_ENTRY;
            let mut object = Object::with_version_needs_room(
                Linked::AtZero,
                Pointers::Addresses,
                &imports,
                room,
            );
            let chain = usize::from(!links_are_needs);
            if !links_are_needs {
                object.write_u16(object.version_field(0, VN_CNT), links as u16);
                object.write_u32(object.version_field(0, VN_AUX), VERSION_ENTRY as u32);
                let next = ((1 + links) * VERSION_ENTRY) as u32;
                object.write_u32(object.version_field(0, VN_NEXT), next);
            }
            for link in chain..chain + links {
                object.write_u32(object.version_field(link, VNA_NEXT), VERSION_ENTRY as u32);
            }
            if !links_are_needs {
                object.write_u32(object.version_field(links, VNA_NEXT), 0);
            }
            let need = chain + links;
            object.write_u16(object.version_field(need, VN_CNT), 1);
            object.write_u32(object.version_field(need, VN_AUX), VERSION_ENTRY as u32);
            object.write_u16(object.version_field(need + 1, VNA_OTHER), 2);
            object.write_u32(object.version_field(need + 1, VNA_NAME), version_name(2));
            object.set_dynamic(DT_VERNEEDNUM, u64::MAX);
            object
        };
        for links_are_needs in [true, false] {
            assert_eq!(
                object(1000, links_are_needs).walk(&["old@VERSION_2"]),
                (Ok(None), asked(&["old", "old@VERSION_2"]))
            );
            assert_eq!(
                object(usize::from(u16::MAX), links_are_needs).walk(&["old@VERSION_2"]),
                (unresolved("old"), asked(&["old"]))
            );
        }
    }

    /// A jump slot, an import through the global offset table, and a jump slot that the linker put in the table of `DT_RELA`.
    const MUSL_IMPORTS: [Import; 3] = [
        import("first"),
        got_import("second"),
        Import {
            relocation_type: R_JUMP_SLOT,
            ..got_import("third")
        },
    ];

    #[test]
    fn reads_the_table_of_dt_rela_only_for_a_loader_that_defers_its_imports() {
        for pointers in [Pointers::Addresses, Pointers::Offsets] {
            let mut object = Object::new(Linked::AboveItsMapping, pointers, &MUSL_IMPORTS);
            assert_eq!(object.walk(&["first"]), (Ok(None), asked(&["first"])));

            object.defers_got = true;
            assert_eq!(
                object.walk(&["first"]),
                (unresolved("second"), asked(&["first", "second"]))
            );
            assert_eq!(
                object.walk(&["first", "second"]),
                (unresolved("third"), asked(&["first", "second", "third"]))
            );
            assert_eq!(object.walk(&["first", "second", "third"]).0, Ok(None));
        }
    }

    #[test]
    fn reports_a_got_import_in_the_table_of_dt_jmprel_only_for_a_loader_that_defers_it() {
        let data = Import {
            relocation_type: R_GLOB_DAT,
            ..import("data")
        };
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &[data]);
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
        object.defers_got = true;
        assert_eq!(object.walk(&[]), (unresolved("data"), asked(&["data"])));
    }

    #[test]
    fn reads_the_table_of_dt_jmprel_before_that_of_dt_rela() {
        let imports = [got_import("data"), import("function")];
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
        object.defers_got = true;
        assert_eq!(
            object.walk(&[]),
            (unresolved("function"), asked(&["function"]))
        );
        assert_eq!(
            object.walk(&["function"]),
            (unresolved("data"), asked(&["function", "data"]))
        );
    }

    #[test]
    fn reads_the_table_of_dt_rela_of_an_object_without_lazy_relocations() {
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &MUSL_IMPORTS);
        object.defers_got = true;
        object.set_dynamic_tag(DT_JMPREL, DT_DEBUG);
        assert_eq!(object.walk(&[]), (unresolved("second"), asked(&["second"])));
        object.set_dynamic_tag(DT_RELA, DT_DEBUG);
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
    }

    #[test]
    fn skips_other_relocations_for_a_loader_that_defers_got_imports() {
        // Neither a jump slot nor a `GLOB_DAT`: among them the copy and the relative relocation of each processor.
        for relocation_type in [0, 1, R_GLOB_DAT - 1, R_JUMP_SLOT + 1] {
            for relocated_in in [Section::RelaPlt, Section::RelaDyn] {
                let other = Import {
                    relocation_type,
                    relocated_in,
                    ..import("other")
                };
                let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &[other]);
                object.defers_got = true;
                assert_eq!(object.walk(&[]), (Ok(None), vec![]), "{relocation_type}");
            }
        }
    }

    #[test]
    fn ignores_a_got_import_that_is_weak_or_that_the_object_defines() {
        let weak = Import {
            binding: STB_WEAK,
            ..got_import("weak")
        };
        let own = Import {
            section: 1,
            ..got_import("own")
        };
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &[weak, own]);
        object.defers_got = true;
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
    }

    #[test]
    fn asks_for_the_version_of_a_got_import() {
        let imports = [Import {
            version: 4,
            ..got_import("old")
        }];
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
        object.set_version_needs(&[&[4]]);
        object.defers_got = true;
        assert_eq!(
            object.walk(&["old@VERSION_4"]),
            (Ok(None), asked(&["old", "old@VERSION_4"]))
        );
    }

    #[test]
    fn refuses_another_entry_size_only_where_it_reads_the_table_of_dt_rela() {
        for size in [0, 16, 25] {
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &MUSL_IMPORTS);
            object.set_dynamic(DT_RELAENT, size);
            assert_eq!(object.walk(&["first"]), (Ok(None), asked(&["first"])));
            object.defers_got = true;
            assert_eq!(
                object.walk(&["first"]),
                (Err(Unreadable::Relocations), vec![])
            );
        }
        // The loaders do not read the entry, so an object without one is read as well.
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &MUSL_IMPORTS);
        object.defers_got = true;
        object.set_dynamic_tag(DT_RELAENT, DT_DEBUG);
        assert_eq!(object.walk(&["first"]).0, unresolved("second"));
    }

    #[test]
    fn refuses_a_table_of_dt_rela_outside_the_segments_only_where_it_reads_it() {
        let changes: [(Unreadable, fn(&mut Object)); 2] = [
            (Unreadable::Table, |object| {
                object.set_dynamic(
                    DT_RELA,
                    object.pointer(Pointers::Addresses, object.tables_size),
                )
            }),
            (Unreadable::Relocations, |object| {
                object.set_dynamic(DT_RELASZ, (object.versions_size + 1) as u64)
            }),
        ];
        for (error, change) in changes {
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &MUSL_IMPORTS);
            change(&mut object);
            assert_eq!(object.walk(&["first"]), (Ok(None), asked(&["first"])));
            object.defers_got = true;
            assert_eq!(object.walk(&["first"]), (Err(error), vec![]));
        }
    }

    /// An import outside the host's library before two imports of it.
    const ZLIB_IMPORTS: [Import; 3] = [import("other"), import("deflate"), import("inflate")];
    /// What the host asks before it fills: the names of its library.
    const ZLIB_NAMES: [&str; 3] = ["deflate", "inflate", "inflateEnd"];

    #[test]
    fn checks_an_object_without_an_import_of_the_library_as_a_host_without_a_library_does() {
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &IMPORTS);
        for defined in [&[][..], &["first"], &["first", "second", "third"]] {
            assert_eq!(object.resolve(defined), object.walk(defined));
        }
        assert_eq!(
            object.resolve(&["first", "second", "third"]),
            (Ok(None), asked(&["first", "second", "third"]))
        );
    }

    #[test]
    fn a_host_without_a_library_fills_nothing() {
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &ZLIB_IMPORTS);
        let unbound = object.slot_values();
        assert_eq!(
            object.walk(&["other"]),
            (unresolved("deflate"), asked(&["other", "deflate"]))
        );
        assert_eq!(object.slot_values(), unbound);
    }

    #[test]
    fn fills_the_imports_of_the_library_where_nothing_defines_it() {
        for linked in [Linked::AtZero, Linked::AboveItsMapping] {
            let object = Object::new(linked, Pointers::Offsets, &ZLIB_IMPORTS);
            let other = object.stub(0);
            // The host asks about its library before the check, and the check asks nothing about a slot that the host fills.
            assert_eq!(
                object.resolve(&["other"]),
                (
                    Ok(None),
                    asked(&["deflate", "inflate", "inflateEnd", "other"])
                )
            );
            assert_eq!(object.slot_values(), [other, DEFLATE, INFLATE]);

            // A later load of the object finds the functions in the slots: nothing is left to fill, and the host asks nothing about its library.
            assert_eq!(object.resolve(&["other"]), (Ok(None), asked(&["other"])));
            assert_eq!(object.slot_values(), [other, DEFLATE, INFLATE]);
        }
    }

    #[test]
    fn fills_nothing_where_something_defines_a_function_of_the_library() {
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &ZLIB_IMPORTS);
        let unbound = object.slot_values();
        // What defines functions of the library, the questions that find the first of them, and what the check then finds.
        let providers: [(&[&str], &[&str], Result<Option<String>, Unreadable>); 4] = [
            (
                &["deflate", "inflate", "inflateEnd"],
                &["deflate"],
                Ok(None),
            ),
            (&["deflate", "inflate"], &["deflate"], Ok(None)),
            (&["inflate"], &["deflate", "inflate"], unresolved("deflate")),
            // Only a function that the object does not import.
            (&["inflateEnd"], &ZLIB_NAMES, unresolved("deflate")),
        ];
        for (provider, questions, found) in providers {
            let defined = [&["other"], provider].concat();
            let (checked, check_questions) = object.walk(&defined);
            assert_eq!(checked, found, "{provider:?}");
            // The check runs as for a host without a library: it asks about each import of the library too.
            assert_eq!(
                object.resolve(&defined),
                (found, [asked(questions), check_questions].concat()),
                "{provider:?}"
            );
            assert_eq!(object.slot_values(), unbound, "{provider:?}");
        }
    }

    #[test]
    fn fills_nothing_where_a_slot_of_the_library_is_bound_to_something_else() {
        for relocation_type in [R_JUMP_SLOT, R_GLOB_DAT, R_ABS64] {
            for relocated_in in [Section::RelaPlt, Section::RelaDyn] {
                let bound = Import {
                    relocation_type,
                    relocated_in,
                    ..import("inflate")
                };
                let imports = [import("deflate"), bound, import("inflateEnd")];
                let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
                object.set_slot(1, ELSEWHERE);
                let unbound = object.slot_values();
                // The loader found `inflate` in a scope that the host cannot ask. The host asks nothing about its library, and the check runs as for a host without one.
                assert_eq!(
                    object.resolve(&[]),
                    (unresolved("deflate"), asked(&["deflate"])),
                    "{relocation_type} {}",
                    relocated_in == Section::RelaDyn
                );
                assert_eq!(object.resolve(&[]), object.walk(&[]));
                assert_eq!(object.slot_values(), unbound);
            }
        }

        // With every slot bound, nothing is left to fill or to ask.
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &ZLIB_IMPORTS);
        for import in 0..ZLIB_IMPORTS.len() {
            object.set_slot(import, ELSEWHERE);
        }
        assert_eq!(object.resolve(&[]), (Ok(None), vec![]));
        assert_eq!(object.slot_values(), [ELSEWHERE; 3]);
    }

    #[test]
    fn fills_nothing_where_a_word_of_data_holds_the_address_plus_an_addend() {
        let imports = [import("deflate"), weak(absolute_import("inflate"))];
        let object = || Object::new(Linked::AtZero, Pointers::Addresses, &imports);
        let filled = object();
        assert_eq!(filled.resolve(&[]), (Ok(None), asked(&ZLIB_NAMES)));
        assert_eq!(filled.slot_values(), [DEFLATE, INFLATE]);

        // The loader leaves the addend alone in the word of a weak import that nothing defines, and the test of the slot takes that for an address. The second word here holds 0, as no loader leaves it.
        for word in [8, 0] {
            let mut object = object();
            object.set_relocation_addend(1, 8);
            object.set_slot(1, word);
            let unbound = object.slot_values();
            assert_eq!(
                object.resolve(&[]),
                (unresolved("deflate"), asked(&["deflate"])),
                "{word}"
            );
            assert_eq!(object.slot_values(), unbound, "{word}");
        }
    }

    #[test]
    fn fills_nothing_where_it_cannot_read_a_relocation_that_stores_an_address() {
        // `inflate` is a weak import through the global offset table: its relocation is in the table of `DT_RELA`, which the check reads only for a loader that defers such an import.
        let imports = [
            import("other"),
            import("deflate"),
            weak(got_import("inflate")),
        ];
        let object = || Object::new(Linked::AtZero, Pointers::Addresses, &imports);
        let filled = object();
        assert_eq!(filled.resolve(&["other"]).0, Ok(None));
        assert_eq!(filled.slot_values(), [filled.stub(0), DEFLATE, INFLATE]);

        let outside = |object: &Object| object.tables_size / SYMBOL;
        let cases: [(&str, Result<Option<String>, Unreadable>, fn(&mut Object)); 9] = [
            (
                "the table of DT_RELA is outside the segments",
                unresolved("deflate"),
                |object| {
                    let outside = object.pointer(Pointers::Addresses, object.tables_size);
                    object.set_dynamic(DT_RELA, outside)
                },
            ),
            (
                "the table of DT_RELA is larger than its segment",
                unresolved("deflate"),
                |object| object.set_dynamic(DT_RELASZ, (object.versions_size + 1) as u64),
            ),
            (
                "the table of DT_RELA has entries of another size",
                unresolved("deflate"),
                |object| object.set_dynamic(DT_RELAENT, 16),
            ),
            (
                "a symbol of the table of DT_RELA is outside the symbol table",
                unresolved("deflate"),
                |object| object.set_data_relocation(2, object.tables_size / SYMBOL, R_GLOB_DAT),
            ),
            (
                "a name of the table of DT_RELA is outside the string table",
                unresolved("deflate"),
                |object| object.set_symbol_name(2, object.strings_size),
            ),
            (
                "a slot of the table of DT_RELA is outside the segments",
                unresolved("deflate"),
                |object| object.set_relocation_offset(2, object.slots + object.slots_size),
            ),
            (
                "a slot of the table of DT_RELA is not aligned",
                unresolved("deflate"),
                |object| object.set_relocation_offset(2, object.slots + SLOT + SLOT / 2),
            ),
            // The check reads these two as well, and reports them.
            (
                "a symbol of the table of DT_JMPREL is outside the symbol table",
                Err(Unreadable::SymbolIndex),
                |object| object.set_relocation(1, object.tables_size / SYMBOL, R_JUMP_SLOT),
            ),
            (
                "the table of DT_JMPREL is larger than its segment",
                Err(Unreadable::Relocations),
                |object| object.set_dynamic(DT_PLTRELSZ, (object.tables_size + 1) as u64),
            ),
        ];
        assert_eq!(outside(&filled) * SYMBOL, filled.tables_size);
        for (case, found, change) in cases {
            let mut object = object();
            change(&mut object);
            let unbound = object.slot_values();
            // It is no error of its own: the check says what it says for a host without a library.
            assert_eq!(
                object.resolve(&["other"]),
                object.walk(&["other"]),
                "{case}"
            );
            assert_eq!(object.resolve(&["other"]).0, found, "{case}");
            assert_eq!(object.slot_values(), unbound, "{case}");
        }
    }

    #[test]
    fn fills_nothing_where_it_cannot_store_to_a_slot_of_the_library() {
        let object = || Object::new(Linked::AtZero, Pointers::Addresses, &ZLIB_IMPORTS);
        let cases: [(&str, fn(&mut Object)); 3] = [
            ("in a segment that is not writable", |object| {
                object.slots_flags = PF_R
            }),
            ("read-only after relocation", |object| {
                object.read_only_after_relocation = Some((object.slots, 2 * SLOT))
            }),
            // The slot of the first import of the library is writable, and nothing is stored there either.
            ("the last one read-only after relocation", |object| {
                object.read_only_after_relocation = Some((object.slots + 2 * SLOT, SLOT))
            }),
        ];
        for (case, change) in cases {
            let mut object = object();
            change(&mut object);
            let unbound = object.slot_values();
            let (checked, check_questions) = object.walk(&["other"]);
            assert_eq!(checked, unresolved("deflate"), "{case}");
            assert_eq!(
                object.resolve(&["other"]),
                (checked, [asked(&ZLIB_NAMES), check_questions].concat()),
                "{case}"
            );
            assert_eq!(object.slot_values(), unbound, "{case}");
        }

        // Only the slots that the host fills have to be writable.
        let mut object = object();
        object.read_only_after_relocation = Some((object.slots, SLOT));
        assert_eq!(object.resolve(&["other"]).0, Ok(None));
        assert_eq!(object.slot_values(), [object.stub(0), DEFLATE, INFLATE]);
    }

    #[test]
    fn leaves_out_a_slot_that_holds_the_function_already() {
        // A load of the object on another thread has stored the first of the functions, and not yet the others.
        let imports = [
            import("deflate"),
            import("other"),
            import("inflate"),
            weak(got_import("inflateEnd")),
        ];
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
        object.set_slot(0, DEFLATE);
        assert_eq!(
            object.resolve(&["other"]),
            (
                Ok(None),
                asked(&["deflate", "inflate", "inflateEnd", "other"])
            )
        );
        let filled = [DEFLATE, object.stub(1), INFLATE, INFLATE_END];
        assert_eq!(object.slot_values(), filled);
        assert_eq!(object.resolve(&["other"]), (Ok(None), asked(&["other"])));
        assert_eq!(object.slot_values(), filled);
    }

    #[test]
    fn fills_a_weak_import_of_the_library_through_each_kind_of_relocation() {
        for relocated_in in [Section::RelaPlt, Section::RelaDyn] {
            // A jump slot, a slot of the global offset table, and a word of data. The loader has stored 0 in the last two, as nothing defines them.
            let imports = [
                weak(import("deflate")),
                Import {
                    relocated_in,
                    ..weak(got_import("inflate"))
                },
                Import {
                    relocated_in,
                    ..weak(absolute_import("inflateEnd"))
                },
                weak(import("other")),
            ];
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
            // The host reads no slot of an import outside its library, and the check none of a weak import.
            object.set_relocation_offset(3, object.slots + object.slots_size);
            assert_eq!(object.slot_values()[..3], [object.stub(0), 0, 0]);
            assert_eq!(object.resolve(&[]), (Ok(None), asked(&ZLIB_NAMES)));
            assert_eq!(object.slot_values()[..3], [DEFLATE, INFLATE, INFLATE_END]);
        }
    }

    #[test]
    fn reads_no_name_of_a_symbol_that_cannot_be_an_import_of_the_library() {
        // A symbol that the object defines, and one that is neither global nor weak. Neither has a name inside the string table.
        let imports = [
            Import {
                section: 1,
                ..import("own")
            },
            Import {
                binding: 0,
                ..got_import("local")
            },
            import("deflate"),
        ];
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
        object.set_symbol_name(0, object.strings_size);
        object.set_symbol_name(1, object.strings_size);
        assert_eq!(object.resolve(&[]), (Ok(None), asked(&ZLIB_NAMES)));
        assert_eq!(object.slot_values()[2], DEFLATE);
    }

    #[test]
    fn stores_nothing_before_the_check_has_passed() {
        // The slots at each question. The last question is that of the check, about an import after those of the library.
        let imports = [import("deflate"), import("inflate"), import("other")];
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
        let (headers, unbound) = (object.headers(), object.slot_values());
        let mut slots_at_each_question = Vec::new();
        // SAFETY: the headers describe ranges inside the memory of `object`, which outlives the call.
        let found = unsafe {
            resolve_lazy_imports(&headers, object.base(), false, &ZLIB, |name, _| {
                slots_at_each_question.push(object.slot_values());
                name == c"other"
            })
        };
        assert_eq!(found, Ok(None));
        assert_eq!(slots_at_each_question, vec![unbound; 4]);
        assert_eq!(object.slot_values(), [DEFLATE, INFLATE, object.stub(2)]);

        // The check finds an import that nothing defines between the imports of the library.
        let imports = [import("deflate"), import("missing"), import("inflate")];
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
        let unbound = object.slot_values();
        let questions = [&ZLIB_NAMES[..], &["missing"]].concat();
        assert_eq!(
            object.resolve(&[]),
            (unresolved("missing"), asked(&questions))
        );
        assert_eq!(object.slot_values(), unbound);

        // The check cannot read the slot of an import outside the library, which the host did not read before.
        let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &ZLIB_IMPORTS);
        object.set_relocation_offset(0, object.slots + object.slots_size);
        let unbound = object.slot_values();
        assert_eq!(
            object.resolve(&[]),
            (Err(Unreadable::Slot), asked(&ZLIB_NAMES))
        );
        assert_eq!(object.slot_values(), unbound);
    }

    #[test]
    fn asks_about_the_library_once_before_the_check_and_by_the_names_alone() {
        // Each import of the library names a version, and the other import comes after the first of them.
        let imports = [
            versioned("deflate", 3),
            versioned("other", 3),
            versioned("inflate", 2),
        ];
        let object = || {
            let mut object = Object::new(Linked::AtZero, Pointers::Addresses, &imports);
            object.set_version_needs(&[&[2, 3]]);
            object
        };
        let filled = object();
        let questions = [&ZLIB_NAMES[..], &["other", "other@VERSION_3"]].concat();
        assert_eq!(
            filled.resolve(&["other@VERSION_3"]),
            (Ok(None), asked(&questions))
        );
        assert_eq!(filled.slot_values(), [DEFLATE, filled.stub(1), INFLATE]);

        // A definition that only the version finds is none of the library: the host's functions have no version.
        let filled = object();
        let questions = [&ZLIB_NAMES[..], &["other"]].concat();
        assert_eq!(
            filled.resolve(&["other", "deflate@VERSION_3", "inflate@VERSION_2"]),
            (Ok(None), asked(&questions))
        );
        assert_eq!(filled.slot_values(), [DEFLATE, filled.stub(1), INFLATE]);
    }

    #[test]
    fn two_loads_fill_the_same_slots_at_the_same_time() {
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &ZLIB_IMPORTS);
        let gate = std::sync::Barrier::new(2);
        let load = || {
            gate.wait();
            object.resolve(&["other"]).0
        };
        let results = std::thread::scope(|scope| {
            let loads = [scope.spawn(load), scope.spawn(load)];
            loads.map(|load| load.join().unwrap())
        });
        assert_eq!(results, [Ok(None), Ok(None)]);
        assert_eq!(object.slot_values(), [object.stub(0), DEFLATE, INFLATE]);
    }

    #[test]
    #[cfg_attr(miri, ignore = "Miri has neither mprotect() nor fork()")]
    fn does_not_write_to_a_slot_that_holds_the_function() {
        let protection = libc::PROT_READ | libc::PROT_WRITE;
        let flags = libc::MAP_PRIVATE | libc::MAP_ANONYMOUS;
        // SAFETY: maps a new page.
        let page = unsafe { libc::mmap(core::ptr::null_mut(), SLOT, protection, flags, -1, 0) };
        assert_ne!(page, libc::MAP_FAILED);
        // SAFETY: the slot is the start of the page, which is writable.
        unsafe { store(page.expose_provenance(), DEFLATE) };
        // SAFETY: `page` is the mapping above.
        assert_eq!(unsafe { libc::mprotect(page, SLOT, libc::PROT_READ) }, 0);
        // A write to the page ends the process that makes it with SIGSEGV, so a child makes the second store.
        // SAFETY: the child has one thread, which only stores and exits.
        let child = unsafe { libc::fork() };
        assert_ne!(child, -1);
        if child == 0 {
            // SAFETY: the page is readable, and `_exit` ends the child without the test's cleanup.
            unsafe {
                store(page.expose_provenance(), DEFLATE);
                libc::_exit(0);
            }
        }
        let mut status = 0;
        // SAFETY: `child` is the process above, and `status` is writable.
        assert_eq!(unsafe { libc::waitpid(child, &raw mut status, 0) }, child);
        assert!(libc::WIFEXITED(status), "the child wrote to the slot");
        // SAFETY: the page is readable.
        assert_eq!(unsafe { page.cast::<usize>().read() }, DEFLATE);
        // SAFETY: `page` is the mapping above.
        assert_eq!(unsafe { libc::munmap(page, SLOT) }, 0);
    }
}

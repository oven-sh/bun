//! The lazily bound function imports of an ELF object that the dynamic loader has mapped into this process.

use core::ffi::CStr;
use core::mem::size_of;
use core::slice;

use bun_core::AnyBitPattern;
use bun_sys::elf::PT_LOAD;

const PT_DYNAMIC: u32 = 2;
const PF_R: u32 = 4;
const DT_NULL: i64 = 0;
const DT_PLTRELSZ: i64 = 2;
const DT_STRTAB: i64 = 5;
const DT_SYMTAB: i64 = 6;
const DT_RELA: u64 = 7;
const DT_STRSZ: i64 = 10;
const DT_PLTREL: i64 = 20;
const DT_JMPREL: i64 = 23;
const SHN_UNDEF: u16 = 0;
const STB_GLOBAL: u8 = 1;
#[cfg(target_arch = "x86_64")]
const R_JUMP_SLOT: u32 = 7;
#[cfg(target_arch = "aarch64")]
const R_JUMP_SLOT: u32 = 1026;

#[repr(C)]
#[derive(Clone, Copy)]
struct Elf64_Dyn {
    d_tag: i64,
    d_val: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Elf64_Rela {
    _r_offset: u64,
    r_info: u64,
    _r_addend: i64,
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

bun_core::impl_any_bit_pattern!(Elf64_Dyn, Elf64_Rela, Elf64_Sym);

/// Why the imports of an object cannot be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unreadable {
    /// There is no `PT_DYNAMIC` segment, or it has no `DT_NULL` inside its size and inside a `PT_LOAD` range.
    Dynamic,
    /// `DT_JMPREL`, `DT_SYMTAB` or `DT_STRTAB` points outside the `PT_LOAD` ranges, or the last two are missing.
    Table,
    /// `DT_PLTRELSZ` is larger than the `PT_LOAD` range of the table, or `DT_PLTREL` is not `DT_RELA`.
    Relocations,
    /// A relocation names a symbol outside the `PT_LOAD` range of the symbol table.
    SymbolIndex,
    /// The name of a symbol does not end inside `DT_STRSZ`.
    SymbolName,
}

/// A table of the object: `room` is the bytes from `address` to the end of the table, or of the `PT_LOAD` range around it.
#[derive(Clone, Copy)]
struct Table {
    address: usize,
    room: usize,
}

impl Table {
    fn element<T: AnyBitPattern>(self, index: usize) -> Option<T> {
        let offset = index.checked_mul(size_of::<T>())?;
        if offset.checked_add(size_of::<T>())? > self.room {
            return None;
        }
        // SAFETY: the element is inside a range that the loader mapped readable, and the caller of the walk keeps the object loaded.
        Some(unsafe { (self.address.wrapping_add(offset) as *const T).read_unaligned() })
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
    fn room(&self, address: usize) -> usize {
        self.headers
            .iter()
            .filter(|header| header.p_type == PT_LOAD && header.p_flags & PF_R != 0)
            .find_map(|header| {
                let start = self.base.wrapping_add(header.p_vaddr as usize);
                (header.p_memsz as usize)
                    .checked_sub(address.wrapping_sub(start))
                    .filter(|&room| room != 0)
            })
            .unwrap_or(0)
    }

    /// glibc stores the address of a table in the dynamic entry, musl and FreeBSD leave its offset from the base there.
    fn table(&self, pointer: u64) -> Option<Table> {
        [pointer as usize, self.base.wrapping_add(pointer as usize)]
            .into_iter()
            .map(|address| Table {
                address,
                room: self.room(address),
            })
            .find(|table| table.room != 0)
    }
}

/// The first lazily bound function import that `is_defined` rejects, of an object whose loader keeps `headers` mapped at `base`.
pub unsafe fn unresolved_lazy_import<'a>(
    headers: &'a [libc::Elf64_Phdr],
    base: usize,
    mut is_defined: impl FnMut(&CStr) -> bool,
) -> Result<Option<&'a CStr>, Unreadable> {
    let image = Image { headers, base };
    let dynamic = headers
        .iter()
        .find(|header| header.p_type == PT_DYNAMIC)
        .ok_or(Unreadable::Dynamic)?;
    let address = base.wrapping_add(dynamic.p_vaddr as usize);
    let entries = Table {
        address,
        room: image.room(address).min(dynamic.p_memsz as usize),
    };

    let (mut relocations, mut symbols, mut strings) = (None, None, None);
    let (mut relocations_size, mut strings_size) = (0, 0);
    for index in 0.. {
        let entry: Elf64_Dyn = entries.element(index).ok_or(Unreadable::Dynamic)?;
        let table = || image.table(entry.d_val).ok_or(Unreadable::Table);
        match entry.d_tag {
            DT_NULL => break,
            DT_JMPREL => relocations = Some(table()?),
            DT_SYMTAB => symbols = Some(table()?),
            DT_STRTAB => strings = Some(table()?),
            DT_PLTRELSZ => relocations_size = entry.d_val as usize,
            DT_STRSZ => strings_size = entry.d_val as usize,
            DT_PLTREL if entry.d_val != DT_RELA => return Err(Unreadable::Relocations),
            _ => {}
        }
    }
    let Some(relocations) = relocations else {
        return Ok(None);
    };
    let (Some(symbols), Some(strings)) = (symbols, strings) else {
        return Err(Unreadable::Table);
    };
    if relocations_size > relocations.room {
        return Err(Unreadable::Relocations);
    }
    let relocations = Table {
        room: relocations_size,
        ..relocations
    };
    let strings = Table {
        room: strings.room.min(strings_size),
        ..strings
    };

    for relocation in (0..).map_while(|index| relocations.element::<Elf64_Rela>(index)) {
        if relocation.r_info as u32 != R_JUMP_SLOT {
            continue;
        }
        let symbol: Elf64_Sym = symbols
            .element((relocation.r_info >> 32) as usize)
            .ok_or(Unreadable::SymbolIndex)?;
        // A weak import may stay unresolved: the loader binds it to address 0.
        if symbol.st_info >> 4 != STB_GLOBAL || symbol.st_shndx != SHN_UNDEF {
            continue;
        }
        let name = strings
            .string(symbol.st_name as usize)
            .ok_or(Unreadable::SymbolName)?;
        if !is_defined(name) {
            return Ok(Some(name));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PF_W: u32 = 2;
    const DT_REL: u64 = 17;
    const DT_DEBUG: i64 = 21;
    const STB_WEAK: u8 = 2;
    const DYNAMIC_ENTRY: usize = 16;
    const SYMBOL: usize = 24;
    const RELOCATION: usize = 24;
    const GAP: usize = 11 * SYMBOL;
    const DYNAMIC_TAGS: [i64; 7] = [
        DT_JMPREL,
        DT_PLTRELSZ,
        DT_PLTREL,
        DT_SYMTAB,
        DT_STRTAB,
        DT_STRSZ,
        DT_NULL,
    ];

    #[derive(Clone, Copy)]
    struct Import {
        name: &'static str,
        binding: u8,
        section: u16,
        relocation_type: u32,
    }

    const fn import(name: &'static str) -> Import {
        Import {
            name,
            binding: STB_GLOBAL,
            section: SHN_UNDEF,
            relocation_type: R_JUMP_SLOT,
        }
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

    /// An object in this process's memory: the symbols, strings and relocations in one segment, and after a gap the dynamic section in another.
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
    }

    impl Object {
        fn new(linked: Linked, pointers: Pointers, imports: &[Import]) -> Object {
            let mut names = vec![0u8];
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

            let mut object = Object {
                memory: vec![0; dynamic + dynamic_load_size + GAP],
                link_address: 0,
                tables_flags: PF_R,
                tables_size,
                strings_size: names.len(),
                relocations,
                dynamic,
                dynamic_load_size,
                dynamic_size: Some(dynamic_load_size),
            };
            if linked == Linked::AboveItsMapping {
                object.link_address = (object.memory.as_ptr() as u64).wrapping_add(0x1000_0000);
            }
            object.memory[strings..][..names.len()].copy_from_slice(&names);
            for (index, import) in imports.iter().enumerate() {
                let symbol = (1 + index) * SYMBOL;
                object.write_u32(symbol, name_offsets[index] as u32);
                object.memory[symbol + 4] = import.binding << 4;
                object.memory[symbol + 6..][..2].copy_from_slice(&import.section.to_le_bytes());
                object.set_relocation(index, 1 + index, import.relocation_type);
            }
            let values = [
                object.pointer(pointers, relocations),
                (imports.len() * RELOCATION) as u64,
                DT_RELA,
                object.pointer(pointers, 0),
                object.pointer(pointers, strings),
                names.len() as u64,
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
            ];
            if let Some(size) = self.dynamic_size {
                headers.push(header(PT_DYNAMIC, PF_R | PF_W, self.dynamic, size));
            }
            headers
        }

        /// The result of the walk when only `defined` have a definition, and the names that it asked for.
        fn walk(&self, defined: &[&str]) -> (Result<Option<String>, Unreadable>, Vec<String>) {
            let mut asked = Vec::new();
            let headers = self.headers();
            // SAFETY: the headers describe ranges inside `self.memory`, which outlives the call.
            let found = unsafe {
                unresolved_lazy_import(&headers, self.base(), |name| {
                    let name = name.to_str().unwrap();
                    asked.push(name.to_owned());
                    defined.contains(&name)
                })
            };
            (
                found.map(|name| name.map(|name| name.to_str().unwrap().to_owned())),
                asked,
            )
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
    fn ignores_a_relocation_that_is_not_a_jump_slot() {
        let data = Import {
            relocation_type: R_JUMP_SLOT ^ 1,
            ..import("data")
        };
        let object = Object::new(Linked::AtZero, Pointers::Addresses, &[data]);
        assert_eq!(object.walk(&[]), (Ok(None), vec![]));
    }
}

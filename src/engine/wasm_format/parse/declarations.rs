//! Imports, functions, tables, memories, tags, globals, exports and the start function.

use core::hash::BuildHasher;
use std::hash::RandomState;

use bun_engine_asm::Width;
use hashbrown::HashTable;

use super::section::{Parsed, Section};
use crate::decode::types::EMPTY;
use crate::error::Error;
use crate::index::{FuncIndex, GlobalIndex, MemoryIndex, TableIndex, TagIndex, TypeIndex};
use crate::limits::{
    MAX_EXPORTS, MAX_FUNCTIONS, MAX_GLOBALS, MAX_IMPORTS, MAX_MEMORIES, MAX_TABLES, MAX_TAGS,
    max_pages,
};
use crate::module::{
    Export, Extern, Features, Global, Import, ImportCounts, Limits, Memory, ModuleHeader, Span,
    Table,
};
use crate::types::TypeKind;
use crate::types::display::kind_name;

const FUNC: u8 = 0;
const TABLE: u8 = 1;
const MEMORY: u8 = 2;
const GLOBAL: u8 = 3;
const TAG: u8 = 4;

const HAS_MAXIMUM: u8 = 1;
const IS_SHARED: u8 = 2;
const IS_64_BIT: u8 = 4;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Origin {
    Imported,
    Defined,
}

impl Section<'_> {
    pub(super) fn imports(&mut self, header: &mut ModuleHeader) -> Parsed {
        let count = self.count("Import", MAX_IMPORTS)?;
        self.reserve(&mut header.imports, count, 4)?;
        for i in 0..count {
            let import = self.import(header, i)?;
            self.push(&mut header.imports, import)?;
        }
        header.imported = ImportCounts {
            funcs: header.funcs.len() as u32,
            tables: header.tables.len() as u32,
            memories: header.memories.len() as u32,
            globals: header.globals.len() as u32,
            tags: header.tags.len() as u32,
        };
        Ok(())
    }

    fn import(&mut self, header: &mut ModuleHeader, i: u32) -> Result<Import, Error> {
        let len = read!(
            self,
            self.reader.u32(),
            "can't get {i}th Import's module name length"
        );
        let (module, module_name) = read!(
            self,
            self.name(len),
            "can't get {i}th Import's module name of length {len}"
        );
        let field_len = read!(
            self,
            self.reader.u32(),
            "can't get {i}th Import's field name length in module '{module_name}'"
        );
        let (field, field_name) = read!(
            self,
            self.name(field_len),
            "can't get {i}th Import's field name of length {len} in module '{module_name}'"
        );
        let place = format_args!("in module '{module_name}' field '{field_name}'");
        let kind = read!(
            self,
            self.extern_kind(),
            "can't get {i}th Import's kind {place}"
        );

        let types = header.types.len();
        let signature = |section: &mut Self, of: &str| {
            let index = read!(
                section,
                section.reader.u32(),
                "can't get {i}th Import's {of} signature {place}"
            );
            ensure!(
                section,
                index < types,
                "invalid {of} signature for {i}th Import, {index} is out of range of {types} {place}"
            );
            Ok(TypeIndex(index))
        };
        let item = match kind {
            FUNC => {
                let ty = signature(self, "function")?;
                self.add_func(header, i, ty)?;
                Extern::Func(FuncIndex(header.funcs.len() as u32 - 1))
            }
            TABLE => {
                self.table(header, Origin::Imported)?;
                Extern::Table(TableIndex(header.tables.len() as u32 - 1))
            }
            MEMORY => {
                self.memory(header)?;
                Extern::Memory(MemoryIndex(header.memories.len() as u32 - 1))
            }
            GLOBAL => {
                let global = self.global_type(header)?;
                self.push(&mut header.globals, global)?;
                Extern::Global(GlobalIndex(header.globals.len() as u32 - 1))
            }
            _ => {
                self.tag_attribute(i, "Import exception", "'s")?;
                let ty = signature(self, "exception")?;
                self.add_tag(header, i, ty)?;
                Extern::Tag(TagIndex(header.tags.len() as u32 - 1))
            }
        };
        Ok(Import {
            module,
            field,
            item,
        })
    }

    fn extern_kind(&mut self) -> Option<u8> {
        self.reader.u8().filter(|&kind| kind <= TAG)
    }

    pub(super) fn funcs(&mut self, header: &mut ModuleHeader) -> Parsed {
        let count = self.count("Function", MAX_FUNCTIONS)?;
        self.reserve(&mut header.funcs, count, 1)?;
        for i in 0..count {
            let ty = read!(
                self,
                self.reader.u32(),
                "can't get {i}th Function's type number"
            );
            ensure!(
                self,
                ty < header.types.len(),
                "{i}th Function type number is invalid {ty}"
            );
            self.add_func(header, i, TypeIndex(ty))?;
        }
        Ok(())
    }

    fn add_func(&mut self, header: &mut ModuleHeader, i: u32, ty: TypeIndex) -> Parsed {
        ensure!(
            self,
            header.types.kind(ty) == TypeKind::Func,
            "{i}th Function type {ty} doesn't have a function signature"
        );
        self.push(&mut header.funcs, header.types.first_index(ty))
    }

    pub(super) fn tables(&mut self, header: &mut ModuleHeader) -> Parsed {
        let count = read!(self, self.reader.u32(), "can't get Table's count");
        (0..count).try_for_each(|_| self.table(header, Origin::Defined))
    }

    fn table(&mut self, header: &mut ModuleHeader, origin: Origin) -> Parsed {
        let count = header.tables.len();
        ensure!(
            self,
            count < MAX_TABLES as usize,
            "Table count of {count} is too big, maximum {MAX_TABLES}"
        );
        let first = self.reader.peek().filter(|&byte| byte < 0x80);
        let first = read!(self, first, "can't parse Table information");
        let has_init = origin == Origin::Defined && first == EMPTY;
        if has_init {
            self.reader.u8();
            ensure!(
                self,
                self.reader.u8() == Some(0),
                "can't parse explicitly initialized Table's reserved byte"
            );
        }
        let ty = read!(self, self.value_type(header), "can't parse Table type");
        let element = read!(
            self,
            ty.as_ref(),
            "Table type should be a ref type, got {ty}"
        );
        ensure!(
            self,
            has_init || origin == Origin::Imported || element.is_nullable(),
            "Table's type must be defaultable"
        );
        let flags = self.limits_flags()?;
        ensure!(
            self,
            flags & IS_SHARED == 0,
            "can't use shared limits for non memory"
        );
        let (address, limits) = self.limits(header, flags)?;

        let mut init = None;
        if has_init {
            let (expr, actual) = self.const_expr(header, ty)?;
            ensure!(
                self,
                header.types.is_subtype(actual, ty),
                "Table init_expr opcode of type {} doesn't match table's type {}",
                kind_name(actual),
                kind_name(ty)
            );
            self.declare_named_funcs(header);
            init = Some(expr);
        }
        let table = Table {
            element,
            address,
            limits,
            init,
        };
        self.push(&mut header.tables, table)
    }

    fn limits_flags(&mut self) -> Result<u8, Error> {
        let flags = read!(self, self.reader.u8(), "can't parse resizable limits flags");
        ensure!(
            self,
            flags <= HAS_MAXIMUM | IS_SHARED | IS_64_BIT,
            "resizable limits flag are not valid {flags:02x}"
        );
        Ok(flags)
    }

    fn limits(&mut self, header: &ModuleHeader, flags: u8) -> Result<(Width, Limits), Error> {
        let is_64_bit = flags & IS_64_BIT != 0;
        ensure!(
            self,
            !is_64_bit || header.features.contains(Features::MEMORY64),
            "Memory64 is not enabled"
        );
        let limit = |section: &mut Self, which: &str| {
            let mut reader = section.reader;
            let value = reader.u64();
            if let Some(value) = value.filter(|&value| is_64_bit || value <= u32::MAX.into()) {
                section.reader = reader;
                return Ok(value);
            }
            if is_64_bit {
                section.reader = reader;
            } else {
                section.reader.u32();
            }
            fail!(section, "can't parse resizable limits {which} page count");
        };
        let initial = limit(self, "initial")?;
        let mut maximum = None;
        if flags & HAS_MAXIMUM != 0 {
            let value = limit(self, "maximum")?;
            ensure!(
                self,
                initial <= value,
                "resizable limits has an initial page count of {initial} which is greater than its maximum {value}"
            );
            maximum = Some(value);
        }
        let address = if is_64_bit { Width::W64 } else { Width::W32 };
        Ok((address, Limits { initial, maximum }))
    }

    pub(super) fn memories(&mut self, header: &mut ModuleHeader) -> Parsed {
        let count = read!(
            self,
            self.reader.u32(),
            "can't parse Memory section's count"
        );
        (0..count).try_for_each(|_| self.memory(header))
    }

    fn memory(&mut self, header: &mut ModuleHeader) -> Parsed {
        ensure!(
            self,
            header.memories.len() < MAX_MEMORIES as usize,
            "there can be at most {MAX_MEMORIES} memories"
        );
        let flags = self.limits_flags()?;
        let (address, pages) = self.limits(header, flags)?;
        let shared = flags & IS_SHARED != 0;
        ensure!(
            self,
            !shared || pages.maximum.is_some(),
            "shared memory must have a maximum size"
        );
        let most = max_pages(address);
        for (count, which) in [
            (pages.initial, "initial"),
            (pages.maximum.unwrap_or(0), "maximum"),
        ] {
            ensure!(
                self,
                count <= most,
                "Memory's {which} page count of {count} is invalid"
            );
        }
        let memory = Memory {
            address,
            pages,
            shared,
        };
        self.push(&mut header.memories, memory)
    }

    pub(super) fn tags(&mut self, header: &mut ModuleHeader) -> Parsed {
        let count = self.count("Exception", MAX_TAGS)?;
        self.reserve(&mut header.tags, count, 2)?;
        for i in 0..count {
            self.tag_attribute(i, "Exception", "")?;
            let ty = read!(
                self,
                self.reader.u32(),
                "can't get {i}th Exception's type number"
            );
            ensure!(
                self,
                ty < header.types.len(),
                "{i}th Exception type number is invalid {ty}"
            );
            self.add_tag(header, i, TypeIndex(ty))?;
        }
        Ok(())
    }

    fn tag_attribute(&mut self, i: u32, of: &str, possessive: &str) -> Parsed {
        let attribute = read!(
            self,
            self.reader.u8(),
            "can't get {i}th {of}{possessive} tag type"
        );
        ensure!(
            self,
            attribute == 0,
            "{i}th {of} has tag type {attribute} but the only supported tag type is 0"
        );
        Ok(())
    }

    fn add_tag(&mut self, header: &mut ModuleHeader, i: u32, ty: TypeIndex) -> Parsed {
        ensure!(
            self,
            header.types.kind(ty) == TypeKind::Func,
            "{i}th Exception type {ty} doesn't have a function signature"
        );
        ensure!(
            self,
            header.types.func_type(ty).results.is_empty(),
            "{i}th Exception type cannot have a non-void return type {ty}"
        );
        self.push(&mut header.tags, header.types.first_index(ty))
    }

    pub(super) fn globals(&mut self, header: &mut ModuleHeader) -> Parsed {
        let count = self.count("Global", MAX_GLOBALS)?;
        self.reserve(&mut header.globals, count, 5)?;
        for _ in 0..count {
            let mut global = self.global_type(header)?;
            let (init, actual) = self.const_expr(header, global.ty)?;
            ensure!(
                self,
                header.types.is_subtype(actual, global.ty),
                "Global init_expr opcode of type {} doesn't match global's type {}",
                kind_name(actual),
                kind_name(global.ty)
            );
            self.declare_named_funcs(header);
            global.init = Some(init);
            self.push(&mut header.globals, global)?;
        }
        Ok(())
    }

    fn global_type(&mut self, header: &ModuleHeader) -> Result<Global, Error> {
        let ty = read!(
            self,
            self.value_type(header),
            "can't get Global's value type"
        );
        let byte = read!(self, self.reader.u8(), "can't get Global type's mutability");
        Ok(Global {
            ty,
            mutable: self.mutability(byte, "Global's")?,
            exported: false,
            init: None,
        })
    }

    pub(super) fn exports(&mut self, header: &mut ModuleHeader) -> Parsed {
        let count = self.count("Export", MAX_EXPORTS)?;
        self.reserve(&mut header.exports, count, 3)?;
        let hasher = RandomState::new();
        let mut names = HashTable::<Span>::new();
        let reserved = names.try_reserve(header.exports.capacity() + 1, |_| unreachable!());
        reserved.map_err(|_| self.out_of_memory())?;

        for i in 0..count {
            let len = read!(
                self,
                self.reader.u32(),
                "can't get {i}th Export's field name length"
            );
            let (span, name) = read!(
                self,
                self.name(len),
                "can't get {i}th Export's field name of length {len}"
            );
            let bytes = self.bytes(span);
            let hash = hasher.hash_one(bytes);
            let earlier = names.find(hash, |&other| self.bytes(other) == bytes);
            ensure!(self, earlier.is_none(), "duplicate export: '{name}'");
            names.insert_unique(hash, span, |&other| hasher.hash_one(self.bytes(other)));

            let kind = read!(
                self,
                self.extern_kind(),
                "can't get {i}th Export's kind, named '{name}'"
            );
            let index = read!(
                self,
                self.reader.u32(),
                "can't get {i}th Export's kind index, named '{name}'"
            );
            let in_space = |of: &str, space: &str, count: usize| {
                ensure!(
                    self,
                    (index as usize) < count,
                    "{i}th Export has invalid {of} number {index} it exceeds the {space} {count}, named '{name}'"
                );
                Ok(())
            };
            let among = |one: &str, many: &str, count: usize| {
                ensure!(
                    self,
                    (index as usize) < count,
                    "can't export {one} {index} there are {count} {many}"
                );
                Ok(())
            };
            let item = match kind {
                FUNC => {
                    in_space("function", "function index space", header.funcs.len())?;
                    header.declare(FuncIndex(index));
                    Extern::Func(FuncIndex(index))
                }
                TABLE => {
                    among("Table", "Tables", header.tables.len())?;
                    Extern::Table(TableIndex(index))
                }
                MEMORY => {
                    among("Memory", "Memories", header.memories.len())?;
                    Extern::Memory(MemoryIndex(index))
                }
                GLOBAL => {
                    in_space("global", "globals count", header.globals.len())?;
                    header.globals[index as usize].exported = true;
                    Extern::Global(GlobalIndex(index))
                }
                _ => {
                    in_space("exception", "exception index space", header.tags.len())?;
                    Extern::Tag(TagIndex(index))
                }
            };
            self.push(&mut header.exports, Export { name: span, item })?;
        }
        Ok(())
    }

    pub(super) fn start(&mut self, header: &mut ModuleHeader) -> Parsed {
        let index = read!(self, self.reader.u32(), "can't get Start index");
        let count = header.funcs.len();
        ensure!(
            self,
            (index as usize) < count,
            "Start index {index} exceeds function index space {count}"
        );
        let ty = header.func_type(FuncIndex(index));
        ensure!(
            self,
            ty.params.is_empty(),
            "Start function can't have arguments"
        );
        ensure!(
            self,
            ty.results.is_empty(),
            "Start function can't return a value"
        );
        header.start = Some(FuncIndex(index));
        Ok(())
    }
}

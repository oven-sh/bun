//! Element segments, data segments and custom sections.

use super::section::{Parsed, Section};
use crate::error::Error;
use crate::index::{FuncIndex, MemoryIndex, TableIndex};
use crate::limits::{MAX_DATA_SEGMENTS, MAX_MODULE_SIZE, MAX_TABLE_ENTRIES};
use crate::module::{
    ConstExpr, CustomSection, Data, DataMode, Elem, ElemItem, ElemMode, ModuleHeader,
};
use crate::types::display::{Expanded, kind_name};
use crate::types::{HeapType, RefType};

const NOT_ACTIVE: u32 = 1;
/// For a segment that is not active: it is declared.
const HAS_INDEX: u32 = 2;
const HAS_EXPRESSIONS: u32 = 4;

impl Section<'_> {
    pub(super) fn elems(&mut self, header: &mut ModuleHeader) -> Parsed {
        let count = self.count("Element", MAX_TABLE_ENTRIES)?;
        self.reserve(&mut header.elems, count, 3)?;
        (0..count).try_for_each(|i| self.elem(header, i))
    }

    fn elem(&mut self, header: &mut ModuleHeader, i: u32) -> Parsed {
        let flags = read!(
            self,
            self.reader.u32(),
            "can't get {i}th Element reserved byte, which should be element flags"
        );
        ensure!(
            self,
            flags <= NOT_ACTIVE | HAS_INDEX | HAS_EXPRESSIONS,
            "can't get {i}th Element reserved byte"
        );
        let has_expressions = flags & HAS_EXPRESSIONS != 0;
        let states_type = flags & (NOT_ACTIVE | HAS_INDEX) != 0;
        let implied_type = match (has_expressions, states_type) {
            (false, _) => Some(HeapType::FUNC.non_null()),
            (true, false) => Some(RefType::FUNCREF),
            (true, true) => None,
        };

        let mode = if flags & NOT_ACTIVE == 0 {
            self.active_elem_mode(header, i, flags, implied_type)?
        } else if flags & HAS_INDEX == 0 {
            ElemMode::Passive
        } else {
            ElemMode::Declared
        };
        let ty = match implied_type {
            Some(ty) => ty,
            None => {
                let ty = self.ref_type(header)?;
                if let ElemMode::Active { table, .. } = mode {
                    self.ensure_table_takes(header, table, ty)?;
                }
                ty
            }
        };
        if states_type && !has_expressions {
            let kind = read!(self, self.reader.u8(), "can't get element kind");
            ensure!(self, kind == 0, "element kind must be zero");
        }

        let len = read!(
            self,
            self.reader.u32(),
            "can't get {i}th index count for Element section"
        );
        ensure!(
            self,
            len <= MAX_TABLE_ENTRIES,
            "Element section's {i}th index count of {len} is too big, maximum {MAX_TABLE_ENTRIES}"
        );
        let first_item = header.elem_items.len() as u32;
        self.reserve(&mut header.elem_items, len, 1)?;
        for item in 0..len {
            let expr = if has_expressions {
                self.elem_expr(header, i, ty)?
            } else {
                self.elem_func(header, i, item)?
            };
            self.push(&mut header.elem_items, ElemItem::new(expr))?;
        }
        let elem = Elem {
            ty,
            mode,
            len,
            first_item,
        };
        self.push(&mut header.elems, elem)
    }

    fn active_elem_mode(
        &mut self,
        header: &ModuleHeader,
        i: u32,
        flags: u32,
        implied_type: Option<RefType>,
    ) -> Result<ElemMode, Error> {
        let index = if flags & HAS_INDEX != 0 {
            read!(
                self,
                self.reader.u32(),
                "can't get {i}th Element table index"
            )
        } else {
            0
        };
        let count = header.tables.len();
        ensure!(
            self,
            (index as usize) < count,
            "Element section for Table {index} exceeds available Table {count}"
        );
        let table = TableIndex(index);
        if let Some(ty) = implied_type {
            self.ensure_table_takes(header, table, ty)?;
        }
        let offset = self.offset_expr(header, header.table(table).address, "Element")?;
        Ok(ElemMode::Active { table, offset })
    }

    fn ensure_table_takes(&self, header: &ModuleHeader, table: TableIndex, ty: RefType) -> Parsed {
        ensure!(
            self,
            header
                .types
                .is_subtype(ty.into(), header.table(table).element.into()),
            "Table {table} must have type '{}' to have an element section",
            Expanded(&header.types, ty.into())
        );
        Ok(())
    }

    fn elem_expr(
        &mut self,
        header: &mut ModuleHeader,
        i: u32,
        ty: RefType,
    ) -> Result<ConstExpr, Error> {
        let (expr, actual) = self.const_expr(header, ty.into())?;
        ensure!(
            self,
            header.types.is_subtype(actual, ty.into()),
            "Element section's {i}th element's init_expr opcode of type {} doesn't match element's type {}",
            kind_name(actual),
            kind_name(ty.into())
        );
        self.declare_named_funcs(header);
        Ok(expr)
    }

    #[inline]
    fn elem_func(
        &mut self,
        header: &mut ModuleHeader,
        i: u32,
        item: u32,
    ) -> Result<ConstExpr, Error> {
        let index = read!(
            self,
            self.reader.u32(),
            "can't get Element section's {i}th element's {item}th index"
        );
        let count = header.funcs.len();
        ensure!(
            self,
            (index as usize) < count,
            "Element section's {i}th element's {item}th index is {index} which exceeds the function index space \
             size of {count}"
        );
        header.declare(FuncIndex(index));
        Ok(ConstExpr::RefFunc(FuncIndex(index)))
    }

    pub(super) fn data_count(&mut self, header: &mut ModuleHeader) -> Parsed {
        header.data_count = Some(self.count("Data Count", MAX_DATA_SEGMENTS)?);
        Ok(())
    }

    pub(super) fn data(&mut self, header: &ModuleHeader, segments: &mut Vec<Data>) -> Parsed {
        let count = self.count("Data", MAX_DATA_SEGMENTS)?;
        if let Some(declared) = header.data_count {
            ensure!(
                self,
                count == declared,
                "Data section's count {count} is different from Data Count section's count {declared}"
            );
        }
        self.reserve(segments, count, 2)?;
        for i in 0..count {
            let mode = self.data_mode(header, i)?;
            let len = read!(
                self,
                self.reader.u32(),
                "can't get {i}th Data segment's data byte length"
            );
            ensure!(
                self,
                len as usize <= MAX_MODULE_SIZE,
                "{i}th Data segment's data byte length is too big {len} maximum {MAX_MODULE_SIZE}"
            );
            let bytes = read!(
                self,
                self.span(len),
                "can't get data bytes from {i}th Data segment"
            );
            self.push(segments, Data { mode, bytes })?;
        }
        Ok(())
    }

    fn data_mode(&mut self, header: &ModuleHeader, i: u32) -> Result<DataMode, Error> {
        let index = match read!(
            self,
            self.reader.u32(),
            "can't get {i}th Data segment's flag"
        ) {
            0 => 0,
            NOT_ACTIVE => return Ok(DataMode::Passive),
            HAS_INDEX => read!(
                self,
                self.reader.u32(),
                "can't get {i}th Data segment's index"
            ),
            _ => fail!(self, "unknown {i}th Data segment's flag"),
        };
        let count = header.memories.len();
        ensure!(
            self,
            (index as usize) < count,
            "{i}th Data segment has index {index} which exceeds the number of Memories {count}"
        );
        let memory = MemoryIndex(index);
        let offset = self.offset_expr(header, header.memory(memory).address, "Data")?;
        Ok(DataMode::Active { memory, offset })
    }

    pub(super) fn custom(&mut self, sections: &mut Vec<CustomSection>) -> Parsed {
        let number = sections.len() + 1;
        let len = read!(
            self,
            self.reader.u32(),
            "can't get {number}th custom section's name length"
        );
        let (name, _) = read!(
            self,
            self.name(len),
            "nameLen get {number}th custom section's name of length {len}"
        );
        let payload = self
            .span(self.reader.remaining() as u32)
            .expect("the rest of the section");
        self.push(sections, CustomSection { name, payload })
    }
}

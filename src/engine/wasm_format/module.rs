//! A module after it has been parsed and validated.

use std::sync::{Arc, OnceLock};

use bun_engine_asm::Width;

use crate::custom::{BranchHints, Names};
use crate::driver::{Driver, FunctionBody};
use crate::index::{
    CodeIndex, DataIndex, ElemIndex, FuncIndex, GlobalIndex, MemoryIndex, TableIndex, TagIndex,
    TypeIndex,
};
use crate::types::{FuncType, RefType, Types, ValType};

bitflags::bitflags! {
    /// What can be switched off.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
    pub struct Features: u8 {
        /// Relaxed operations included.
        const SIMD = 1 << 0;
        /// Memories and tables with addresses of 64 bits.
        const MEMORY64 = 1 << 1;
    }
}

/// Bytes of the module.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct Span {
    pub start: u32,
    pub len: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConstExpr {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
    RefNull,
    RefFunc(FuncIndex),
    GlobalGet(GlobalIndex),
    /// Any other. See [`Module::const_expr_driver`].
    Code(ConstCode),
}

/// The offset in the module of the first instruction.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ConstCode(pub(crate) u32);

impl ConstCode {
    pub fn offset(self) -> u32 {
        self.0
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Limits {
    pub initial: u64,
    pub maximum: Option<u64>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Table {
    pub element: RefType,
    pub address: Width,
    /// As declared. They may be more than a table can have.
    pub limits: Limits,
    /// Without it the elements of a table that is not imported are null.
    pub init: Option<ConstExpr>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Memory {
    pub address: Width,
    pub pages: Limits,
    pub shared: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Global {
    pub ty: ValType,
    pub mutable: bool,
    pub exported: bool,
    /// `None` for an import.
    pub init: Option<ConstExpr>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Extern {
    Func(FuncIndex),
    Table(TableIndex),
    Memory(MemoryIndex),
    Global(GlobalIndex),
    Tag(TagIndex),
}

/// Names are valid UTF-8.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Import {
    pub module: Span,
    pub field: Span,
    pub item: Extern,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Export {
    pub name: Span,
    pub item: Extern,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ElemMode {
    Active {
        table: TableIndex,
        offset: ConstExpr,
    },
    Passive,
    Declared,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Elem {
    pub ty: RefType,
    pub mode: ElemMode,
    pub len: u32,
    pub(crate) first_item: u32,
}

/// The expression for an element, in 32 bits.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ElemItem(u32);

impl ElemItem {
    const PAYLOAD_BITS: u32 = 30;

    /// `expr` is a reference.
    pub(crate) fn new(expr: ConstExpr) -> Self {
        let (kind, payload) = match expr {
            ConstExpr::RefFunc(func) => (0, func.0),
            ConstExpr::GlobalGet(global) => (1, global.0),
            ConstExpr::Code(code) => (2, code.0),
            _ => (3, 0),
        };
        debug_assert!(payload >> Self::PAYLOAD_BITS == 0);
        Self(kind << Self::PAYLOAD_BITS | payload)
    }

    #[inline]
    pub fn expr(self) -> ConstExpr {
        let payload = self.0 & ((1 << Self::PAYLOAD_BITS) - 1);
        match self.0 >> Self::PAYLOAD_BITS {
            0 => ConstExpr::RefFunc(FuncIndex(payload)),
            1 => ConstExpr::GlobalGet(GlobalIndex(payload)),
            2 => ConstExpr::Code(ConstCode(payload)),
            _ => ConstExpr::RefNull,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DataMode {
    Active {
        memory: MemoryIndex,
        offset: ConstExpr,
    },
    Passive,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Data {
    pub mode: DataMode,
    pub bytes: Span,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CustomSection {
    pub name: Span,
    pub payload: Span,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    pub struct FunctionFlags: u8 {
        /// A `v128` may be in a parameter, a result, a local or an operand.
        const USES_SIMD = 1 << 0;
        /// In code that the driver does not skip.
        const HAS_TRY = 1 << 1;
        /// In code that the driver does not skip.
        const HAS_TRY_TABLE = 1 << 2;
        const HAS_TAIL_CALL = 1 << 3;
    }
}

/// What validation found out about a function.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FunctionFacts {
    /// Of the first instruction, from the start of the body.
    pub code_offset: u32,
    /// Parameters included.
    pub local_count: u32,
    /// In values, unreachable code included.
    pub max_stack_height: u32,
    /// How deep `catch` and `catch_all` blocks nest.
    pub max_catch_depth: u32,
    pub call_count: u32,
    pub loop_count: u32,
    pub flags: FunctionFlags,
}

#[derive(Clone, Copy)]
pub(crate) struct Function {
    pub(crate) body: Span,
    pub(crate) facts: FunctionFacts,
}

/// Consecutive bytes of the module. No section but the code section and no function is in more than one.
#[derive(Clone)]
pub(crate) struct Chunk {
    pub(crate) start: u32,
    pub(crate) bytes: Arc<Vec<u8>>,
}

impl Chunk {
    #[inline]
    pub(crate) fn get(&self, span: Span) -> &[u8] {
        &self.from(span.start)[..span.len as usize]
    }

    #[inline]
    pub(crate) fn from(&self, offset: u32) -> &[u8] {
        &self.bytes[(offset - self.start) as usize..]
    }
}

/// What the sections before the code section say.
pub struct ModuleHeader {
    pub(crate) features: Features,
    pub(crate) types: Types,
    pub(crate) imports: Vec<Import>,
    pub(crate) funcs: Vec<TypeIndex>,
    pub(crate) tables: Vec<Table>,
    pub(crate) memories: Vec<Memory>,
    pub(crate) globals: Vec<Global>,
    pub(crate) tags: Vec<TypeIndex>,
    pub(crate) imported: ImportCounts,
    pub(crate) exports: Vec<Export>,
    pub(crate) start: Option<FuncIndex>,
    pub(crate) elems: Vec<Elem>,
    pub(crate) elem_items: Vec<ElemItem>,
    pub(crate) data_count: Option<u32>,
    /// A bit for each function.
    pub(crate) declared: Vec<u64>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct ImportCounts {
    pub funcs: u32,
    pub tables: u32,
    pub memories: u32,
    pub globals: u32,
    pub tags: u32,
}

impl ModuleHeader {
    pub(crate) fn new(features: Features) -> Self {
        Self {
            features,
            types: Types::default(),
            imports: Vec::new(),
            funcs: Vec::new(),
            tables: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            tags: Vec::new(),
            imported: ImportCounts::default(),
            exports: Vec::new(),
            start: None,
            elems: Vec::new(),
            elem_items: Vec::new(),
            data_count: None,
            declared: Vec::new(),
        }
    }

    #[inline]
    pub(crate) fn declare(&mut self, func: FuncIndex) {
        if self.declared.is_empty() {
            self.declared.resize(self.funcs.len().div_ceil(64), 0);
        }
        self.declared[func.usize() / 64] |= 1 << (func.0 % 64);
    }

    #[inline]
    pub fn features(&self) -> Features {
        self.features
    }

    #[inline]
    pub fn types(&self) -> &Types {
        &self.types
    }

    pub fn imports(&self) -> &[Import] {
        &self.imports
    }

    pub fn exports(&self) -> &[Export] {
        &self.exports
    }

    #[inline]
    pub fn imported(&self) -> ImportCounts {
        self.imported
    }

    /// The type of each function.
    #[inline]
    pub fn funcs(&self) -> &[TypeIndex] {
        &self.funcs
    }

    #[inline]
    pub fn tables(&self) -> &[Table] {
        &self.tables
    }

    #[inline]
    pub fn memories(&self) -> &[Memory] {
        &self.memories
    }

    #[inline]
    pub fn globals(&self) -> &[Global] {
        &self.globals
    }

    /// The type of each tag.
    #[inline]
    pub fn tags(&self) -> &[TypeIndex] {
        &self.tags
    }

    pub fn elems(&self) -> &[Elem] {
        &self.elems
    }

    pub fn start(&self) -> Option<FuncIndex> {
        self.start
    }

    #[inline]
    pub fn func_type_index(&self, func: FuncIndex) -> TypeIndex {
        self.funcs[func.usize()]
    }

    #[inline]
    pub fn func_type(&self, func: FuncIndex) -> FuncType<'_> {
        self.types.func_type(self.func_type_index(func))
    }

    #[inline]
    pub fn table(&self, table: TableIndex) -> &Table {
        &self.tables[table.usize()]
    }

    #[inline]
    pub fn memory(&self, memory: MemoryIndex) -> &Memory {
        &self.memories[memory.usize()]
    }

    #[inline]
    pub fn global(&self, global: GlobalIndex) -> &Global {
        &self.globals[global.usize()]
    }

    #[inline]
    pub fn tag_params(&self, tag: TagIndex) -> &[ValType] {
        self.types.func_type(self.tags[tag.usize()]).params
    }

    #[inline]
    pub fn elem(&self, elem: ElemIndex) -> &Elem {
        &self.elems[elem.usize()]
    }

    pub fn elem_items(&self, elem: &Elem) -> &[ElemItem] {
        &self.elem_items[elem.first_item as usize..][..elem.len as usize]
    }

    /// The number of functions that are not imported.
    #[inline]
    pub fn code_count(&self) -> u32 {
        self.funcs.len() as u32 - self.imported.funcs
    }

    /// `None` for an import.
    #[inline]
    pub fn code_index(&self, func: FuncIndex) -> Option<CodeIndex> {
        func.0.checked_sub(self.imported.funcs).map(CodeIndex)
    }

    #[inline]
    pub fn func_index(&self, code: CodeIndex) -> FuncIndex {
        FuncIndex(code.0 + self.imported.funcs)
    }

    /// Whether a reference to the function can be had: it is exported or named by a constant expression.
    #[inline]
    pub fn is_declared(&self, func: FuncIndex) -> bool {
        let word = self.declared.get(func.usize() / 64).copied();
        word.is_some_and(|word| word >> (func.0 % 64) & 1 != 0)
    }
}

pub struct Module {
    pub(crate) header: Arc<ModuleHeader>,
    /// In order, without gaps.
    pub(crate) chunks: Vec<Chunk>,
    pub(crate) functions: Vec<Function>,
    pub(crate) data: Vec<Data>,
    pub(crate) custom_sections: Vec<CustomSection>,
    pub(crate) names: OnceLock<Option<Names>>,
    pub(crate) branch_hints: OnceLock<BranchHints>,
}

impl core::ops::Deref for Module {
    type Target = ModuleHeader;

    #[inline]
    fn deref(&self) -> &ModuleHeader {
        &self.header
    }
}

impl Module {
    pub fn header(&self) -> &Arc<ModuleHeader> {
        &self.header
    }

    fn chunk_at(&self, offset: u32) -> &Chunk {
        &self.chunks[self.chunks.partition_point(|chunk| chunk.start <= offset) - 1]
    }

    /// `span` is from this module.
    pub fn bytes(&self, span: Span) -> &[u8] {
        if span.len == 0 {
            return &[];
        }
        self.chunk_at(span.start).get(span)
    }

    /// All bytes of the module, in order.
    pub fn source(&self) -> impl Iterator<Item = &[u8]> {
        self.chunks.iter().map(|chunk| chunk.bytes.as_slice())
    }

    /// Of the source.
    pub fn size_in_bytes(&self) -> usize {
        let last = self.chunks.last();
        last.map_or(0, |last| last.start as usize + last.bytes.len())
    }

    #[inline]
    pub fn facts(&self, code: CodeIndex) -> &FunctionFacts {
        &self.functions[code.usize()].facts
    }

    #[inline]
    pub fn body_span(&self, code: CodeIndex) -> Span {
        self.functions[code.usize()].body
    }

    pub fn body(&self, code: CodeIndex) -> FunctionBody<'_> {
        let function = &self.functions[code.usize()];
        FunctionBody::new(
            &self.header,
            code,
            self.bytes(function.body),
            function.facts,
        )
    }

    pub fn data_segments(&self) -> &[Data] {
        &self.data
    }

    pub fn data(&self, data: DataIndex) -> &Data {
        &self.data[data.usize()]
    }

    pub fn custom_sections(&self) -> &[CustomSection] {
        &self.custom_sections
    }

    /// Offsets are from the start of the expression.
    pub fn const_expr_driver(&self, code: ConstCode) -> Driver<'_> {
        Driver::new(&self.header, self.chunk_at(code.0).from(code.0), 0)
    }

    /// From the first well-formed name section. The first call parses it.
    pub fn names(&self) -> Option<&Names> {
        self.names.get_or_init(|| Names::parse(self)).as_ref()
    }

    pub fn source_map_url(&self) -> Option<&str> {
        crate::custom::source_map_url(self)
    }

    /// Where the body of the last function ends, or zero.
    pub fn end_of_code(&self) -> u32 {
        (self.functions.last()).map_or(0, |last| last.body.start + last.body.len)
    }

    /// The first call parses them.
    pub fn branch_hints(&self) -> &BranchHints {
        self.branch_hints.get_or_init(|| BranchHints::parse(self))
    }
}

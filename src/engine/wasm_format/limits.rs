//! What a module may have at most (WebAssembly JavaScript Interface, "Implementation-defined Limits").

use bun_engine_asm::Width;

pub const MAX_MODULE_SIZE: usize = 1 << 30;
pub const MAX_TYPES: u32 = 1_000_000;
pub const MAX_SUBTYPE_DEPTH: u32 = 63;
pub const MAX_FUNCTIONS: u32 = 1_000_000;
pub const MAX_IMPORTS: u32 = 1_000_000;
pub const MAX_EXPORTS: u32 = 1_000_000;
pub const MAX_GLOBALS: u32 = 1_000_000;
pub const MAX_TAGS: u32 = 1_000_000;
pub const MAX_DATA_SEGMENTS: u32 = 100_000;
pub const MAX_TABLES: u32 = 100_000;
pub const MAX_MEMORIES: u32 = 100;
/// Also the number of element segments, and of items in one.
pub const MAX_TABLE_ENTRIES: u32 = 10_000_000;
pub const MAX_FUNCTION_SIZE: u32 = 7_654_321;
/// Parameters included.
pub const MAX_LOCALS: u32 = 50_000;
pub const MAX_PARAMS: u32 = 1_000;
pub const MAX_RESULTS: u32 = 1_000;
pub const MAX_STRUCT_FIELDS: u32 = 10_000;
pub const MAX_ARRAY_NEW_FIXED_OPERANDS: u32 = 10_000;
pub const MAX_MEMORY32_PAGES: u64 = 1 << 16;
pub const MAX_MEMORY64_PAGES: u64 = 1 << 48;
/// Ours. Only instructions with many results reach it.
pub const MAX_OPERAND_STACK_HEIGHT: u32 = MAX_FUNCTION_SIZE;

/// What a memory with such addresses can declare.
pub const fn max_pages(address: Width) -> u64 {
    match address {
        Width::W32 => MAX_MEMORY32_PAGES,
        Width::W64 => MAX_MEMORY64_PAGES,
    }
}

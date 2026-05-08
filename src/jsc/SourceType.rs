// From SourceProvider.h
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SourceType {
    Program = 0,
    Module = 1,
    WebAssembly = 2,
}

// ported from: src/jsc/SourceType.zig

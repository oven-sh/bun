//! Modules written by hand.

#![allow(dead_code, unreachable_pub)]

use std::convert::Infallible;

use bun_engine_wasm_format::*;

pub const TYPE: u8 = 1;
pub const IMPORT: u8 = 2;
pub const FUNCTION: u8 = 3;
pub const TABLE: u8 = 4;
pub const MEMORY: u8 = 5;
pub const GLOBAL: u8 = 6;
pub const EXPORT: u8 = 7;
pub const START: u8 = 8;
pub const ELEMENT: u8 = 9;
pub const CODE: u8 = 10;
pub const DATA: u8 = 11;
pub const DATA_COUNT: u8 = 12;
pub const TAG: u8 = 13;

pub const I32: u8 = 0x7f;
pub const I64: u8 = 0x7e;
pub const F32: u8 = 0x7d;
pub const F64: u8 = 0x7c;
pub const V128: u8 = 0x7b;
pub const I8: u8 = 0x78;
pub const I16: u8 = 0x77;
pub const NONE: u8 = 0x71;
pub const FUNCREF: u8 = 0x70;
pub const EXTERNREF: u8 = 0x6f;
pub const ANYREF: u8 = 0x6e;
pub const EQREF: u8 = 0x6d;
pub const I31REF: u8 = 0x6c;
pub const STRUCTREF: u8 = 0x6b;
pub const EXNREF: u8 = 0x69;
pub const REF: u8 = 0x64;
pub const NULLABLE: u8 = 0x63;
pub const FUNC: u8 = 0x60;
pub const STRUCT: u8 = 0x5f;
pub const ARRAY: u8 = 0x5e;
pub const SUB: u8 = 0x50;
pub const SUB_FINAL: u8 = 0x4f;
pub const REC: u8 = 0x4e;
pub const EMPTY: u8 = 0x40;

fn leb(mut value: usize, last_below: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    while value >= last_below {
        bytes.push(value as u8 | 0x80);
        value >>= 7;
    }
    bytes.push(value as u8);
    bytes
}

pub fn unsigned(value: usize) -> Vec<u8> {
    leb(value, 0x80)
}

/// A signed number that is not negative.
pub fn signed(value: usize) -> Vec<u8> {
    leb(value, 0x40)
}

pub fn sized(bytes: &[u8]) -> Vec<u8> {
    [&unsigned(bytes.len()), bytes].concat()
}

pub fn list(items: &[&[u8]]) -> Vec<u8> {
    [unsigned(items.len()), items.concat()].concat()
}

pub fn list_of(count: usize, item: impl Fn(usize) -> Vec<u8>) -> Vec<u8> {
    let mut bytes = unsigned(count);
    bytes.extend((0..count).flat_map(item));
    bytes
}

pub fn custom(name: &str, payload: &[u8]) -> Vec<u8> {
    [&sized(name.as_bytes()), payload].concat()
}

pub fn module(sections: &[(u8, &[u8])]) -> Vec<u8> {
    let mut bytes = b"\0asm\x01\0\0\0".to_vec();
    for &(id, payload) in sections {
        bytes.push(id);
        bytes.extend(sized(payload));
    }
    bytes
}

pub fn code(bodies: &[&[u8]]) -> Vec<u8> {
    list_of(bodies.len(), |i| sized(bodies[i]))
}

pub fn parse(bytes: &[u8]) -> Result<Module, Error> {
    Module::new(bytes.to_vec(), Features::all())
}

pub fn valid(bytes: &[u8]) -> Module {
    parse(bytes).unwrap_or_else(|error| panic!("{error}"))
}

/// The message without what all begin with.
pub fn message(bytes: &[u8]) -> String {
    let text = parse(bytes).err().expect("an invalid module").to_string();
    let prefix = "WebAssembly.Module doesn't ";
    text.strip_prefix(prefix).unwrap_or(&text).into()
}

/// Something of every kind, and `body` as function 0, of type `ty`.
///
/// ```text
/// type 0 [] -> []            type 4 struct (mut i32) (mut i8) anyref      table 0 funcref, table 1 externref
/// type 1 [i32] -> []         type 5 sub 4, and (ref 4)                    memory 0, memory 1 (64 bits)
/// type 2 [] -> [i32]         type 6 array (mut i16)                       tag 0 type 0, tag 1 type 1
/// type 3 [i32 i64] -> [f32]  type 7 array funcref                         global 0 i32, global 1 (mut i64)
/// type 8 [] -> [i32 i64]     type 9 the same as type 0                    global 2 v128
/// func 1 type 3, declared    func 2 type 8                                elem 0 (ref func), data 0
/// ```
pub fn with_body(ty: u8, body: &[u8]) -> Vec<u8> {
    let types = list(&[
        &[FUNC, 0, 0],
        &[FUNC, 1, I32, 0],
        &[FUNC, 0, 1, I32],
        &[FUNC, 2, I32, I64, 1, F32],
        &[SUB, 0, STRUCT, 3, I32, 1, I8, 1, ANYREF, 0],
        &[SUB, 1, 4, STRUCT, 4, I32, 1, I8, 1, ANYREF, 0, REF, 4, 0],
        &[ARRAY, I16, 1],
        &[ARRAY, FUNCREF, 0],
        &[FUNC, 0, 2, I32, I64],
        &[FUNC, 0, 0],
    ]);
    let vector = [&[V128, 0, 0xfd, 0x0c][..], &[0; 16], &[0x0b]].concat();
    let globals = list(&[&[I32, 0, 0x41, 1, 0x0b], &[I64, 1, 0x42, 2, 0x0b], &vector]);
    module(&[
        (TYPE, &types),
        (FUNCTION, &[3, ty, 3, 8]),
        (TABLE, &list(&[&[FUNCREF, 0, 1], &[EXTERNREF, 0, 1]])),
        (MEMORY, &list(&[&[0, 1], &[4, 1]])),
        (TAG, &list(&[&[0, 0], &[0, 1]])),
        (GLOBAL, &globals),
        (ELEMENT, &list(&[&[1, 0, 1, 1]])),
        (DATA_COUNT, &[1]),
        (CODE, &code(&[body, &[0, 0x00, 0x0b], &[0, 0x00, 0x0b]])),
        (DATA, &list(&[&[1, 1, 7]])),
    ])
}

pub struct Random(pub u64);

impl Random {
    pub fn below(&mut self, limit: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % limit as u64) as usize
    }
}

pub struct Ignore;

impl Visit for Ignore {
    type Error = Infallible;

    fn unhandled(&mut self) -> Result<(), Infallible> {
        Ok(())
    }
}

impl VisitControl for Ignore {}
impl VisitVariable for Ignore {}
impl VisitNumeric for Ignore {}
impl VisitMemory for Ignore {}
impl VisitReference for Ignore {}
impl VisitVector for Ignore {}

mod elf;
mod macho;
mod pe;

use core::mem::size_of;

use super::PayloadReferenceError::{
    self, DynamicSymbolInPayload, MalformedExecutable, NoPayload, RelocationInPayload,
    UnsupportedRelocations,
};
use super::check_payload_references;
use crate::builtins::Image;
use crate::image::read_bytes_at;
use crate::{read_struct, write_struct};

type Checked = Result<(), PayloadReferenceError>;

fn check(bytes: &[u8]) -> Checked {
    let mut read = |offset: usize, out: &mut [u8]| read_bytes_at(bytes, offset, out);
    check_payload_references(&mut Image {
        len: bytes.len(),
        read: &mut read,
    })
}

fn zeroed<T: Copy>() -> T {
    read_struct(&vec![0u8; size_of::<T>()])
}

fn bytes_of<T: Copy>(value: &T) -> Vec<u8> {
    let mut bytes = vec![0u8; size_of::<T>()];
    write_struct(&mut bytes, value);
    bytes
}

fn put(file: &mut Vec<u8>, offset: usize, bytes: &[u8]) {
    if file.len() < offset + bytes.len() {
        file.resize(offset + bytes.len(), 0);
    }
    file[offset..][..bytes.len()].copy_from_slice(bytes);
}

fn put_struct<T: Copy>(file: &mut Vec<u8>, offset: usize, value: &T) {
    put(file, offset, &bytes_of(value));
}

fn relocation_at(address: u64) -> Checked {
    Err(RelocationInPayload { address })
}

fn dynamic_symbol_at(address: u64) -> Checked {
    Err(DynamicSymbolInPayload { address })
}

#[test]
fn file_of_no_known_format_has_no_payload() {
    assert_eq!(check(b"#!/bin/sh\necho\n"), Err(NoPayload));
}

#[test]
fn errors_have_names_and_addresses() {
    let relocation = RelocationInPayload { address: 0x40 };
    assert_eq!(relocation.name(), "RelocationInPayload");
    assert_eq!(relocation.address(), Some(0x40));
    let symbol = DynamicSymbolInPayload { address: 0x48 };
    assert_eq!(symbol.name(), "DynamicSymbolInPayload");
    assert_eq!(symbol.address(), Some(0x48));
    for error in [UnsupportedRelocations, MalformedExecutable, NoPayload] {
        assert_eq!(error.address(), None);
    }
}

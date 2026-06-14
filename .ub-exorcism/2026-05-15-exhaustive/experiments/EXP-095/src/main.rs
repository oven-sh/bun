#![allow(dead_code)]

use core::{mem::size_of, ptr};

#[repr(C)]
#[derive(Clone, Copy)]
struct LoadCommand {
    cmd: u32,
    cmdsize: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SymtabCommand {
    cmd: u32,
    cmdsize: u32,
    symoff: u32,
    nsyms: u32,
    stroff: u32,
    strsize: u32,
}

fn main() {
    // Mirrors the relevant `macho.rs` shape:
    // - load commands live inside a byte buffer (`Vec<u8>` / `&[u8]`)
    // - the iterator reads the header with `read_unaligned`
    // - `update_load_command_offsets` then casts the command bytes to `&mut
    //   symtab_command` and writes fields in place.
    //
    // Use an odd offset to make the alignment bug deterministic under Miri.
    // In production, the offset is format-controlled and the backing storage is
    // still a `Vec<u8>` / `&[u8]`, so typed references need an explicit
    // alignment proof or must be replaced by read/write_unaligned copies.
    let mut bytes = vec![0u8; 1 + size_of::<SymtabCommand>()];
    let cmd_ptr = unsafe { bytes.as_mut_ptr().add(1) };

    let command = SymtabCommand {
        cmd: 0x2,
        cmdsize: size_of::<SymtabCommand>() as u32,
        symoff: 4,
        nsyms: 1,
        stroff: 8,
        strsize: 16,
    };
    unsafe {
        ptr::write_unaligned(cmd_ptr.cast::<SymtabCommand>(), command);
    }

    let hdr: LoadCommand = unsafe { ptr::read_unaligned(cmd_ptr.cast::<LoadCommand>()) };
    assert_eq!(hdr.cmd, 0x2);

    // This is the unsound production operation from `macho.rs:366`, mirrored
    // on an intentionally unaligned command pointer.
    let symtab: &mut SymtabCommand = unsafe { &mut *cmd_ptr.cast::<SymtabCommand>() };
    symtab.symoff += 1;
}

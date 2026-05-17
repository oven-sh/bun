#![allow(dead_code)]

use std::mem::size_of;
use std::slice;

#[repr(C)]
#[derive(Clone, Copy)]
struct SectionHeader {
    name: [u8; 8],
    virtual_size: u32,
    virtual_address: u32,
    size_of_raw_data: u32,
    pointer_to_raw_data: u32,
    pointer_to_relocations: u32,
    pointer_to_linenumbers: u32,
    number_of_relocations: u16,
    number_of_linenumbers: u16,
    characteristics: u32,
}

fn main() {
    let mut data = vec![0u8; size_of::<SectionHeader>() + 4];

    // Mirror src/exe_format/pe.rs:281-290 and :389-396:
    // bytes come from a Vec<u8>, an offset is computed from PE metadata, then
    // the pointer is cast to SectionHeader and converted to &[SectionHeader].
    let section_headers_offset = 1usize;
    let ptr = unsafe {
        data.as_mut_ptr()
            .add(section_headers_offset)
            .cast::<SectionHeader>()
    };
    let sections = unsafe { slice::from_raw_parts(ptr.cast_const(), 1) };

    // Force a real typed read so Miri cannot treat the slice as inert.
    std::hint::black_box(sections[0].virtual_size);
}

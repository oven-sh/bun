use bun_exe_format::pe::{
    DOSHeader, DataDirectory, OptionalHeader64, PEFile, PEHeader, SectionHeader,
};

fn bytes_of<T>(value: &T) -> &[u8] {
    unsafe { std::slice::from_raw_parts((value as *const T).cast::<u8>(), std::mem::size_of::<T>()) }
}

fn write_at<T>(data: &mut [u8], offset: usize, value: &T) {
    data[offset..offset + std::mem::size_of::<T>()].copy_from_slice(bytes_of(value));
}

fn main() {
    let pe_off = std::mem::size_of::<DOSHeader>();
    let optional_header_offset = pe_off + std::mem::size_of::<PEHeader>();
    let optional_header_size = std::mem::size_of::<OptionalHeader64>() + 1;
    let section_headers_offset = optional_header_offset + optional_header_size;
    assert_eq!(pe_off % std::mem::align_of::<PEHeader>(), 0);
    assert_eq!(
        optional_header_offset % std::mem::align_of::<OptionalHeader64>(),
        0
    );
    assert_ne!(
        section_headers_offset % std::mem::align_of::<SectionHeader>(),
        0
    );

    let mut data = vec![0u8; section_headers_offset + std::mem::size_of::<SectionHeader>()];

    let dos = DOSHeader {
        e_magic: 0x5A4D,
        e_cblp: 0,
        e_cp: 0,
        e_crlc: 0,
        e_cparhdr: 0,
        e_minalloc: 0,
        e_maxalloc: 0,
        e_ss: 0,
        e_sp: 0,
        e_csum: 0,
        e_ip: 0,
        e_cs: 0,
        e_lfarlc: 0,
        e_ovno: 0,
        e_res: [0; 4],
        e_oemid: 0,
        e_oeminfo: 0,
        e_res2: [0; 10],
        e_lfanew: pe_off as u32,
    };
    write_at(&mut data, 0, &dos);

    let pe = PEHeader {
        signature: 0x0000_4550,
        machine: 0x8664,
        number_of_sections: 1,
        time_date_stamp: 0,
        pointer_to_symbol_table: 0,
        number_of_symbols: 0,
        size_of_optional_header: optional_header_size as u16,
        characteristics: 0,
    };
    write_at(&mut data, pe_off, &pe);

    let opt = OptionalHeader64 {
        magic: 0x020B,
        major_linker_version: 0,
        minor_linker_version: 0,
        size_of_code: 0,
        size_of_initialized_data: 0,
        size_of_uninitialized_data: 0,
        address_of_entry_point: 0,
        base_of_code: 0,
        image_base: 0,
        section_alignment: 4096,
        file_alignment: 512,
        major_operating_system_version: 0,
        minor_operating_system_version: 0,
        major_image_version: 0,
        minor_image_version: 0,
        major_subsystem_version: 0,
        minor_subsystem_version: 0,
        win32_version_value: 0,
        size_of_image: 0,
        size_of_headers: 0,
        checksum: 0,
        subsystem: 0,
        dll_characteristics: 0,
        size_of_stack_reserve: 0,
        size_of_stack_commit: 0,
        size_of_heap_reserve: 0,
        size_of_heap_commit: 0,
        loader_flags: 0,
        number_of_rva_and_sizes: 16,
        data_directories: [DataDirectory {
            virtual_address: 0,
            size: 0,
        }; 16],
    };
    write_at(&mut data, optional_header_offset, &opt);

    let section = SectionHeader {
        name: *b".text\0\0\0",
        virtual_size: 0,
        virtual_address: 0,
        size_of_raw_data: 0,
        pointer_to_raw_data: 0,
        pointer_to_relocations: 0,
        pointer_to_line_numbers: 0,
        number_of_relocations: 0,
        number_of_line_numbers: 0,
        characteristics: 0,
    };
    write_at(&mut data, section_headers_offset, &section);

    // Calls the real Bun parser. Under Miri symbolic-alignment, PEFile::init
    // fails even earlier than the deliberately odd section_headers_offset:
    // src/exe_format/pe.rs materializes &DOSHeader from Vec<u8> storage at
    // line 317. The original mirror EXP-093 still isolates the later
    // section-header typed-slice path that this public API call cannot reach
    // before the first typed reference is rejected.
    let _ = PEFile::init(&data).unwrap();
}

use bun_exe_format::macho::MachoFile;
use bun_exe_format::macho_types::{
    CPU_TYPE_ARM64, LC, MH_MAGIC_64, PROT, mach_header_64, section_64, segment_command_64,
};

fn bytes_of<T>(value: &T) -> &[u8] {
    unsafe { std::slice::from_raw_parts((value as *const T).cast::<u8>(), std::mem::size_of::<T>()) }
}

fn write_at<T>(data: &mut [u8], offset: usize, value: &T) {
    data[offset..offset + std::mem::size_of::<T>()].copy_from_slice(bytes_of(value));
}

fn fixed16(name: &[u8]) -> [u8; 16] {
    let mut out = [0u8; 16];
    out[..name.len()].copy_from_slice(name);
    out
}

fn main() {
    let header_size = std::mem::size_of::<mach_header_64>();
    let segment_size = std::mem::size_of::<segment_command_64>();
    let section_size = std::mem::size_of::<section_64>();
    let bun_cmd_size = segment_size + section_size;
    let linkedit_cmd_size = segment_size;
    let sizeofcmds = bun_cmd_size + linkedit_cmd_size;
    let object_len = header_size + sizeofcmds + 16 * 1024;

    let mut data = vec![0u8; object_len];

    let header = mach_header_64 {
        magic: MH_MAGIC_64,
        cputype: CPU_TYPE_ARM64,
        cpusubtype: 0,
        filetype: 0,
        ncmds: 2,
        sizeofcmds: sizeofcmds as u32,
        flags: 0,
        reserved: 0,
    };
    write_at(&mut data, 0, &header);

    let bun_segment = segment_command_64 {
        cmd: LC::SEGMENT_64,
        cmdsize: bun_cmd_size as u32,
        segname: fixed16(b"__BUN"),
        vmaddr: 0x1000,
        vmsize: 16 * 1024,
        fileoff: (header_size + sizeofcmds) as u64,
        filesize: 16 * 1024,
        maxprot: PROT::READ | PROT::WRITE,
        initprot: PROT::READ | PROT::WRITE,
        nsects: 1,
        flags: 0,
    };
    let bun_cmd_offset = header_size;
    write_at(&mut data, bun_cmd_offset, &bun_segment);

    let bun_section = section_64 {
        sectname: fixed16(b"__bun"),
        segname: fixed16(b"__BUN"),
        addr: 0x1000,
        size: 8,
        offset: (header_size + sizeofcmds) as u32,
        align: 14,
        reloff: 0,
        nreloc: 0,
        flags: 0,
        reserved1: 0,
        reserved2: 0,
        reserved3: 0,
    };
    write_at(&mut data, bun_cmd_offset + segment_size, &bun_section);

    let linkedit_segment = segment_command_64 {
        cmd: LC::SEGMENT_64,
        cmdsize: linkedit_cmd_size as u32,
        segname: fixed16(b"__LINKEDIT"),
        vmaddr: 0x5000,
        vmsize: 0,
        fileoff: object_len as u64,
        filesize: 0,
        maxprot: PROT::READ,
        initprot: PROT::READ,
        nsects: 0,
        flags: 0,
    };
    write_at(&mut data, bun_cmd_offset + bun_cmd_size, &linkedit_segment);

    let mut macho = MachoFile::init(&data, 0).unwrap();

    // Calls the real Bun Mach-O writer. Under Miri symbolic-alignment, this
    // reaches src/exe_format/macho.rs:121-130 and materializes
    // &mut [section_64] over the byte-backed Vec<u8> load-command region.
    let _ = macho.write_section(b"payload").unwrap();
}

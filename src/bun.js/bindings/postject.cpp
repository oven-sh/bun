// This code is based on https://github.com/nodejs/postject/
// Thank you RaisinTen and the rest of the Node.js team who worked on postject.

#include "root.h"

#include <unistd.h>

#include <algorithm>
#include <codecvt>
#include <locale>
#include <memory>
#include <vector>

#include <LIEF/LIEF.hpp>

#ifdef __APPLE__

#include <mach-o/dyld.h>

#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>

static const char* segment_name = "__BUNBUILD";

extern "C" int inject_into_macho(
    uint8_t* bytes,
    size_t bytes_length,
    const char* section_name)
{

    // Step 1. Copy the executable to a temporary location
    char templocation[PATH_MAX];
    memcpy(templocation, "/tmp/bun.XXXXXX", 15);
    templocation[15] = '\0';

    auto* templocationName = mkdtemp(templocation);
    if (!templocationName) {
        return -1;
    }

    templocationName = strcat(templocationName, "/bun");
    char processLocationBuf[PATH_MAX];
    uint32_t processLocationLen = PATH_MAX;
    {

        if (_NSGetExecutablePath(processLocationBuf, &processLocationLen) != 0) {
            return -1;
        }
    }

    // Step 3. Inject the data into the executable

    auto config = LIEF::MachO::ParserConfig::deep();

    auto fat_binary = LIEF::MachO::Parser::parse(std::string(processLocationBuf, processLocationLen));

    if (!fat_binary) {
        return -1;
    }

    // Inject into all Mach-O binaries if there's more than one in a fat binary
    for (LIEF::MachO::Binary& binary : *fat_binary) {
        LIEF::MachO::Section* existing_section = binary.get_section(segment_name, section_name);

        if (existing_section) {
            binary.remove_section(segment_name, section_name, true);
        }

        LIEF::MachO::SegmentCommand* segment = binary.get_segment(segment_name);
        std::vector<uint8_t> bytesVec(bytes, bytes + bytes_length);
        LIEF::MachO::Section section(std::string(section_name, strlen(section_name)), WTFMove(bytesVec));

        if (!segment) {
            // Create the segment and mark it read-only
            LIEF::MachO::SegmentCommand new_segment(segment_name);
            new_segment.max_protection(
                static_cast<uint32_t>(LIEF::MachO::VM_PROTECTIONS::VM_PROT_READ));
            new_segment.init_protection(
                static_cast<uint32_t>(LIEF::MachO::VM_PROTECTIONS::VM_PROT_READ));
            new_segment.add_section(section);
            binary.add(new_segment);
        } else {
            binary.add_section(*segment, section);
        }

        // It will need to be signed again anyway, so remove the signature
        if (binary.has_code_signature()) {
            binary.remove_signature();
        }
    }

    int fd = open(templocationName, O_RDWR | O_CREAT | O_TRUNC, 0777);

    // Construct a new Uint8Array in JS
    std::vector<uint8_t> output = fat_binary->raw();

    size_t remain = output.size();
    size_t offset = 0;
    while (remain > 0) {
        ssize_t written = write(fd, output.data() + offset, remain);
        if (written == -1) {
            close(fd);
            return -1;
        }

        remain -= written;
        offset += written;
    }
    output.clear();
    fchmod(fd, 0777);

    return fd;
}

#endif

#if defined(__APPLE__) && defined(__MACH__)
#include <mach-o/dyld.h>
#include <mach-o/getsect.h>
#elif defined(__linux__)
#include <elf.h>
#include <link.h>
#include <sys/param.h>
#elif defined(_WIN32)
#include <windows.h>
#endif

#ifndef POSTJECT_SENTINEL_FUSE
#define POSTJECT_SENTINEL_FUSE \
    "POSTJECT_SENTINEL_fce680ab2cc467b6e072b8b5df1996b2"
#endif

struct postject_options {
    const char* elf_section_name;
    const char* macho_framework_name;
    const char* macho_section_name;
    const char* macho_segment_name;
    const char* pe_resource_name;
};

inline void postject_options_init(struct postject_options* options)
{
    options->elf_section_name = NULL;
    options->macho_framework_name = NULL;
    options->macho_section_name = NULL;
    options->macho_segment_name = NULL;
    options->pe_resource_name = NULL;
}

static inline bool postject_has_resource()
{
    static const volatile char* sentinel = POSTJECT_SENTINEL_FUSE ":0";
    return sentinel[sizeof(POSTJECT_SENTINEL_FUSE)] == '1';
}

#if defined(__linux__)
static int postject__dl_iterate_phdr_callback(struct dl_phdr_info* info,
    size_t size,
    void* data)
{
    // Snag the dl_phdr_info struct for the main program, then stop iterating
    *((struct dl_phdr_info*)data) = *info;
    return 1;
}
#endif

extern "C" const void* postject_find_resource(
    const char* name,
    size_t* size)
{
    // Always zero out the size pointer to start
    if (size != NULL) {
        *size = 0;
    }

#if defined(__APPLE__) && defined(__MACH__)

    unsigned long section_size;
    char* ptr = NULL;
    ptr = getsectdata(segment_name, name,
        &section_size);
#ifdef __clang__
#pragma clang diagnostic pop
#endif

    if (ptr != NULL) {
        // Add the "virtual memory address slide" amount to ensure a valid pointer
        // in cases where the virtual memory address have been adjusted by the OS.
        //
        // NOTE - `getsectdataFromFramework` already handles this adjustment for
        //        us, which is why we only do it for `getsectdata`, see:
        //        https://web.archive.org/web/20220613234007/https://opensource.apple.com/source/cctools/cctools-590/libmacho/getsecbyname.c.auto.html
        ptr += _dyld_get_image_vmaddr_slide(0);
    }

    if (size != NULL) {
        *size = (size_t)section_size;
    }

    return ptr;
#elif defined(__linux__)

    if (options != NULL && options->elf_section_name != NULL) {
        name = options->elf_section_name;
    }

    struct dl_phdr_info main_program_info;
    dl_iterate_phdr(postject__dl_iterate_phdr_callback, &main_program_info);

    uintptr_t p = (uintptr_t)main_program_info.dlpi_phdr;
    size_t n = main_program_info.dlpi_phnum;
    uintptr_t base_addr = main_program_info.dlpi_addr;

    // iterate program header
    for (; n > 0; n--, p += sizeof(ElfW(Phdr))) {
        ElfW(Phdr)* phdr = (ElfW(Phdr)*)p;

        // skip everything but notes
        if (phdr->p_type != PT_NOTE) {
            continue;
        }

        // note segment starts at base address + segment virtual address
        uintptr_t pos = (base_addr + phdr->p_vaddr);
        uintptr_t end = (pos + phdr->p_memsz);

        // iterate through segment until we reach the end
        while (pos < end) {
            if (pos + sizeof(ElfW(Nhdr)) > end) {
                break; // invalid
            }

            ElfW(Nhdr)* note = (ElfW(Nhdr)*)(uintptr_t)pos;
            if (note->n_namesz != 0 && note->n_descsz != 0 && strncmp((char*)(pos + sizeof(ElfW(Nhdr))), (char*)name, sizeof(name)) == 0) {
                *size = note->n_descsz;
                // advance past note header and aligned name
                // to get to description data
                return (void*)((uintptr_t)note + sizeof(ElfW(Nhdr)) + roundup(note->n_namesz, 4));
            }

            pos += (sizeof(ElfW(Nhdr)) + roundup(note->n_namesz, 4) + roundup(note->n_descsz, 4));
        }
    }
    return NULL;

#elif defined(_WIN32)
    void* ptr = NULL;
    char* resource_name = NULL;

    if (options != NULL && options->pe_resource_name != NULL) {
        name = options->pe_resource_name;
    } else {
        // Automatically uppercase the resource name or it won't be found
        resource_name = (char*)malloc(strlen(name) + 1);
        if (resource_name == NULL) {
            return NULL;
        }
        strcpy_s(resource_name, strlen(name) + 1, name);
        CharUpperA(resource_name); // Uppercases inplace
    }

    HRSRC resource_handle = FindResourceA(NULL, resource_name != NULL ? resource_name : name,
        MAKEINTRESOURCEA(10) /* RT_RCDATA */);

    if (resource_handle) {
        HGLOBAL global_resource_handle = LoadResource(NULL, resource_handle);

        if (global_resource_handle) {
            if (size != NULL) {
                *size = SizeofResource(NULL, resource_handle);
            }

            ptr = LockResource(global_resource_handle);
        }
    }

    free(resource_name);

    return ptr;
#else
    return NULL;
#endif
}

#include "root.h"

#if (OS(LINUX) && !OS(ANDROID)) || OS(FREEBSD)

#include "NodeAddonImportsPosix.h"
#include <dlfcn.h>
#include <elf.h>
#include <link.h>
#include <zlib.h>

namespace Bun {

namespace {

// uWebSockets.js imports these from Node's executable. Bun's zlib is not exported, so that no other library binds to it.
#define ZLIB_FUNCTION(name) { #name, reinterpret_cast<void*>(name) }
static const struct {
    const char* name;
    void* address;
} zlibFunctions[] = {
    ZLIB_FUNCTION(deflate),
    ZLIB_FUNCTION(deflateBound),
    ZLIB_FUNCTION(deflateEnd),
    ZLIB_FUNCTION(deflateInit2_),
    ZLIB_FUNCTION(deflateInit_),
    ZLIB_FUNCTION(deflateReset),
    ZLIB_FUNCTION(deflateSetDictionary),
    ZLIB_FUNCTION(inflate),
    ZLIB_FUNCTION(inflateEnd),
    ZLIB_FUNCTION(inflateInit2_),
    ZLIB_FUNCTION(inflateInit_),
    ZLIB_FUNCTION(inflateReset),
    ZLIB_FUNCTION(inflateSetDictionary),
};
#undef ZLIB_FUNCTION

static void* zlibFunction(const char* name)
{
    for (auto& function : zlibFunctions) {
        if (!strcmp(function.name, name))
            return function.address;
    }
    return nullptr;
}

#if defined(__GLIBC__) || OS(FREEBSD)
template<typename T, typename From>
static const T* atOffset(const From* from, size_t offset)
{
    return reinterpret_cast<const T*>(reinterpret_cast<const char*>(from) + offset);
}

// dlsym() finds only the default version of a symbol, but the dynamic linker binds an import to the version its library names.
static bool resolvesWithRequiredVersion(void* handle, const char* name, Elf64_Versym versionIndex, const Elf64_Verneed* need, const char* strings)
{
    // Bit 15 of a version index marks a hidden symbol.
    constexpr Elf64_Versym indexBits = 0x7fff;
    for (;; need = atOffset<Elf64_Verneed>(need, need->vn_next)) {
        auto* version = atOffset<Elf64_Vernaux>(need, need->vn_aux);
        for (unsigned i = 0; i < need->vn_cnt; ++i, version = atOffset<Elf64_Vernaux>(version, version->vna_next)) {
            if ((version->vna_other & indexBits) == (versionIndex & indexBits))
                return dlvsym(RTLD_DEFAULT, name, strings + version->vna_name) || dlvsym(handle, name, strings + version->vna_name);
        }
        if (!need->vn_next)
            return false;
    }
}
#endif

} // namespace

WTF::String unresolvedAddonImport(void* handle)
{
    struct link_map* map = nullptr;
    if (dlinfo(handle, RTLD_DI_LINKMAP, &map))
        return {};
    auto base = std::bit_cast<uintptr_t>(map->l_addr);

    const Elf64_Rela* pltRelocations = nullptr;
    size_t pltRelocationsSize = 0;
    const Elf64_Sym* symbols = nullptr;
    const char* strings = nullptr;
    [[maybe_unused]] const Elf64_Versym* versionIndexes = nullptr;
    [[maybe_unused]] const Elf64_Verneed* versionNeeds = nullptr;
    for (auto* entry = static_cast<const Elf64_Dyn*>(map->l_ld); entry->d_tag != DT_NULL; ++entry) {
        // glibc relocates most of these addresses in place. musl and FreeBSD leave them all relative to the load address.
        uintptr_t address = entry->d_un.d_ptr < base ? base + entry->d_un.d_ptr : entry->d_un.d_ptr;
        switch (entry->d_tag) {
        case DT_JMPREL:
            pltRelocations = reinterpret_cast<const Elf64_Rela*>(address);
            break;
        case DT_PLTRELSZ:
            pltRelocationsSize = entry->d_un.d_val;
            break;
        case DT_PLTREL:
            if (entry->d_un.d_val != DT_RELA)
                return {};
            break;
        case DT_SYMTAB:
            symbols = reinterpret_cast<const Elf64_Sym*>(address);
            break;
        case DT_STRTAB:
            strings = reinterpret_cast<const char*>(address);
            break;
        case DT_VERSYM:
            versionIndexes = reinterpret_cast<const Elf64_Versym*>(address);
            break;
        case DT_VERNEED:
            versionNeeds = reinterpret_cast<const Elf64_Verneed*>(address);
            break;
        }
    }

    for (size_t i = 0; i < pltRelocationsSize / sizeof(Elf64_Rela); ++i) {
        auto& relocation = pltRelocations[i];
        size_t symbolIndex = ELF64_R_SYM(relocation.r_info);
        auto& symbol = symbols[symbolIndex];
        if (ELF64_ST_BIND(symbol.st_info) != STB_GLOBAL || symbol.st_shndx != SHN_UNDEF)
            continue;
        const char* name = strings + symbol.st_name;
        if (dlsym(RTLD_DEFAULT, name) || dlsym(handle, name))
            continue;
#if defined(__GLIBC__) || OS(FREEBSD)
        if (versionIndexes && versionNeeds && resolvesWithRequiredVersion(handle, name, versionIndexes[symbolIndex], versionNeeds, strings))
            continue;
#endif
        void* function = zlibFunction(name);
        if (!function)
            return WTF::String::fromUTF8ReplacingInvalidSequences(byteCast<uint8_t>(unsafeSpan(name)));
        // A later load of the library, in a Worker, finds the slot written, while other threads call through it.
        if (auto* slot = reinterpret_cast<void**>(base + relocation.r_offset); *slot != function)
            *slot = function;
    }
    return {};
}

} // namespace Bun

#endif

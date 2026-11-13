// Includes no framework header: they declare the constants defined here as const.

#include <atomic>
#include <cstdint>
#include <cstring>
#include <dlfcn.h>
#include <mach-o/getsect.h>
#include <mach-o/ldsyms.h>

extern "C" {
#define FUNCTION(library, name) void* BunDawn__##name;
#define DATA(library, name, size) alignas(size % 8 ? 4 : 8) char name[size];
#include "MetalSymbols.def"
#undef FUNCTION
#undef DATA

const char* sel_registerName(const char*);
void* objc_autoreleasePoolPush();
void objc_autoreleasePoolPop(void*);

struct BuildVersion {
    uint32_t platform;
    uint32_t version;
};
bool _availability_version_check(uint32_t count, BuildVersion[]);

// What @available calls. It comes from compiler-rt, which a build on another system does not have for macOS.
int32_t __isPlatformVersionAtLeast(uint32_t platform, uint32_t major, uint32_t minor, uint32_t patch)
{
    BuildVersion version { platform, major << 16 | minor << 8 | patch };
    return _availability_version_check(1, &version);
}
}

namespace Bun::Dawn {

static std::atomic<bool> isLoaded;

static bool load()
{
    auto open = [](const char* path) { return dlopen(path, RTLD_LAZY | RTLD_LOCAL); };
    void* ObjC = open("/usr/lib/libobjc.A.dylib");
    void* CoreFoundation = open("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
    void* IOKit = open("/System/Library/Frameworks/IOKit.framework/IOKit");
    void* IOSurface = open("/System/Library/Frameworks/IOSurface.framework/IOSurface");
    void* Metal = open("/System/Library/Frameworks/Metal.framework/Metal");
    void* Foundation = open("/System/Library/Frameworks/Foundation.framework/Foundation");
    if (!ObjC || !CoreFoundation || !IOKit || !IOSurface || !Metal || !Foundation)
        return false;

    const struct {
        void* library;
        const char* name;
        void* storage;
        size_t dataSize;
    } symbols[] = {
#define FUNCTION(library, name) { library, #name, &BunDawn__##name, 0 },
#define DATA(library, name, size) { library, #name, name, size },
#include "MetalSymbols.def"
#undef FUNCTION
#undef DATA
    };
    for (const auto& symbol : symbols) {
        void* address = dlsym(symbol.library, symbol.name);
        if (!address)
            return false;
        if (symbol.dataSize)
            memcpy(symbol.storage, address, symbol.dataSize);
        else
            memcpy(symbol.storage, &address, sizeof(address));
    }

    // __objc_selrefs, renamed in scripts/build/flags.ts. Apple's ld leaves it its name, and the selectors to the runtime.
    unsigned long size = 0;
    auto* selectors = reinterpret_cast<const char**>(getsectiondata(&_mh_execute_header, "__DATA", "__bun_selrefs", &size));
    for (size_t i = 0; i < size / sizeof(*selectors); i++)
        selectors[i] = sel_registerName(selectors[i]);
    isLoaded = true;
    return true;
}

extern "C" bool BunDawn__loadMetal()
{
    static const bool loaded = load();
    return loaded;
}

extern "C" void* BunDawn__pushAutoreleasePool()
{
    return isLoaded ? objc_autoreleasePoolPush() : nullptr;
}

extern "C" void BunDawn__popAutoreleasePool(void* pool)
{
    if (pool)
        objc_autoreleasePoolPop(pool);
}

} // namespace Bun::Dawn

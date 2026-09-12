#include "root.h"

#include <exception>

#if !OS(WINDOWS)
#include <cstring>
#include <cxxabi.h>
#include <new>
#include <stdexcept>
#include <typeinfo>
#endif

extern "C" [[noreturn]] void Zig__GlobalObject__onCrash(const char* exceptionType, const char* what);

#if !OS(WINDOWS)

// Every runtime for the Itanium C++ ABI describes a class with one non-virtual base at offset 0 with a type_info using the first vtable, and a class with any other bases with one using the second.
extern "C" void* _ZTVN10__cxxabiv120__si_class_type_infoE[];
extern "C" void* _ZTVN10__cxxabiv121__vmi_class_type_infoE[];

namespace {

// Itanium C++ ABI 2.9.5, __si_class_type_info.
struct SingleBaseClassTypeInfo {
    const void* vtable;
    const char* name;
    const std::type_info* base;
};

// Itanium C++ ABI 2.9.5, __base_class_type_info: bit 0 marks a virtual base, the bits above the low 8 hold a non-virtual base's byte offset.
struct BaseClassEntry {
    const std::type_info* type;
    long offsetFlags;
};

// Itanium C++ ABI 2.9.5, __vmi_class_type_info.
struct MultipleBaseClassTypeInfo {
    const void* vtable;
    const char* name;
    unsigned flags;
    unsigned baseCount;
    BaseClassEntry bases[1];
};

bool hasVTable(const std::type_info* type, void** vtableSymbol)
{
    // An object's vtable pointer points past the offset-to-top and type_info words at the start of the vtable.
    return *reinterpret_cast<const void* const*>(type) == static_cast<const void*>(vtableSymbol + 2);
}

// Byte offset of the std::exception subobject inside an object of this type, or -1 when the type does not derive from it non-virtually.
ptrdiff_t offsetOfStdException(const std::type_info* type)
{
    if (strcmp(type->name(), "St9exception") == 0)
        return 0;
    if (hasVTable(type, _ZTVN10__cxxabiv120__si_class_type_infoE))
        return offsetOfStdException(reinterpret_cast<const SingleBaseClassTypeInfo*>(type)->base);
    if (!hasVTable(type, _ZTVN10__cxxabiv121__vmi_class_type_infoE))
        return -1;
    const auto* info = reinterpret_cast<const MultipleBaseClassTypeInfo*>(type);
    for (unsigned i = 0; i < info->baseCount; i++) {
        const BaseClassEntry& base = info->bases[i];
        if (base.offsetFlags & 1)
            continue;
        ptrdiff_t offset = offsetOfStdException(base.type);
        if (offset >= 0)
            return (base.offsetFlags >> 8) + offset;
    }
    return -1;
}

// libc++ and libstdc++ both implement exception_ptr as the address of the thrown object and nothing else.
const char* currentExceptionObject()
{
    std::exception_ptr current = std::current_exception();
    static_assert(sizeof(current) == sizeof(void*));
    const char* object;
    memcpy(&object, &current, sizeof(object));
    return object;
}

// Replaces the runtime's default handler, which would have printed the same type name and what() itself before aborting.
void terminateHandler()
{
    const std::type_info* type = abi::__cxa_current_exception_type();
    if (!type)
        Zig__GlobalObject__onCrash(nullptr, nullptr);

    int status = 0;
    const char* demangled = abi::__cxa_demangle(type->name(), nullptr, nullptr, &status);
    const char* what = nullptr;
    ptrdiff_t offset = offsetOfStdException(type);
    if (offset >= 0) {
        if (const char* object = currentExceptionObject())
            what = reinterpret_cast<const std::exception*>(object + offset)->what();
    }
    Zig__GlobalObject__onCrash(demangled ? demangled : type->name(), what);
}

} // namespace

#else

namespace {

// MSVC's runtime has none of the entry points used above, and with _HAS_EXCEPTIONS=0 its std::terminate() aborts without calling this handler at all (bun's own CRT is static, so an addon's terminate never arrives here either).
void terminateHandler()
{
    Zig__GlobalObject__onCrash(nullptr, nullptr);
}

} // namespace

#endif

extern "C" void Bun__installCxxTerminateHandler()
{
    std::set_terminate(terminateHandler);
}

#if OS(DARWIN)

extern "C" std::type_info _ZTISt13runtime_error;
// Declared here rather than taken from <cxxabi.h>, which not every runtime declares it in; C linkage makes this the same function.
extern "C" void __cxa_throw(void* thrownObject, std::type_info* type, void (*destructor)(void*));

namespace {

void destroyRuntimeError(void* object)
{
    static_cast<std::runtime_error*>(object)->~runtime_error();
}

} // namespace

// What `throw std::runtime_error(...)` compiles to. Nothing in bun can catch it, so the unwinder gives up and the handler runs, as when an addon's exception escapes into bun.
extern "C" void Bun__throwUncaughtCxxExceptionForTesting()
{
    void* memory = abi::__cxa_allocate_exception(sizeof(std::runtime_error));
    new (memory) std::runtime_error("thrown by the crash handler test");
    __cxa_throw(memory, &_ZTISt13runtime_error, destroyRuntimeError);
}

#else

// glibc release builds strip the unwind tables, so a throw from inside bun aborts in the unwinder before any handler runs; macOS, where an addon shares bun's libc++abi, is also the one platform where an addon's throw reaches this handler.
extern "C" void Bun__throwUncaughtCxxExceptionForTesting()
{
    std::terminate();
}

#endif

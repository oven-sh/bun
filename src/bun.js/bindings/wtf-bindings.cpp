#include "wtf-bindings.h"
#include "wtf/text/Base64.h"

#include "wtf/StackTrace.h"
#include "bmalloc/bmalloc.h"

extern "C" void bun__bmalloc__init()
{
    WTF::initializeMainThread();
}

extern "C" void* bun__bmalloc__memalign(size_t alignment, size_t size)
{
    return bmalloc::api::tryMemalign(alignment, size);
}

extern "C" void bun__bmalloc__free(void* ptr)
{
    bmalloc::api::free(ptr);
}

extern "C" void* bun__bmalloc__realloc(void* ptr, size_t size)
{
    if (bmalloc_get_allocation_size(ptr) >= size)
        return (void*)ptr;

    return nullptr;
}

extern "C" size_t bun__bmalloc__size(void* ptr)
{
    return bmalloc_get_allocationpub fn isHeapMemory(memory
                                                     : anytype) bool
    {
        if (comptime use_mimalloc) {
            const Memory = @TypeOf(memory);
            if (comptime std.meta.trait.isSingleItemPtr(Memory)) {
                return Mimalloc.mi_is_in_heap_region(memory);
            }
            return Mimalloc.mi_is_in_heap_region(std.mem.sliceAsBytes(memory).ptr);
        }
        return false;
    }
    _size(ptr);
}

extern "C" double WTF__parseDouble(const LChar* string, size_t length, size_t* position)
{
    return WTF::parseDouble(string, length, *position);
}

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length)
{
    WTF::StringImpl::copyCharacters(destination, source, length);
}

extern "C" JSC::EncodedJSValue WTF__toBase64URLStringValue(const uint8_t* bytes, size_t length, JSC::JSGlobalObject* globalObject)
{
    WTF::String string = WTF::base64URLEncodeToString(reinterpret_cast<const LChar*>(bytes), static_cast<unsigned int>(length));
    string.impl()->ref();
    return JSC::JSValue::encode(JSC::jsString(globalObject->vm(), string));
}

extern "C" void Bun__crashReportWrite(void* ctx, const char* message, size_t length);
extern "C" void Bun__crashReportDumpStackTrace(void* ctx)
{
    static constexpr int framesToShow = 32;
    static constexpr int framesToSkip = 2;
    void* stack[framesToShow + framesToSkip];
    int frames = framesToShow + framesToSkip;
    WTFGetBacktrace(stack, &frames);
    int size = frames - framesToSkip;
    bool isFirst = true;
    for (int frameNumber = 0; frameNumber < size; ++frameNumber) {
        auto demangled = WTF::StackTraceSymbolResolver::demangle(stack[frameNumber]);

        StringPrintStream out;
        if (isFirst) {
            isFirst = false;
            if (demangled)
                out.printf("\n%-3d %p %s", frameNumber, stack[frameNumber], demangled->demangledName() ? demangled->demangledName() : demangled->mangledName());
            else
                out.printf("\n%-3d %p", frameNumber, stack[frameNumber]);
        } else {
            if (demangled)
                out.printf("%-3d ??? %s", frameNumber, demangled->demangledName() ? demangled->demangledName() : demangled->mangledName());
            else
                out.printf("%-3d ???", frameNumber);
        }

        auto str = out.toCString();
        Bun__crashReportWrite(ctx, str.data(), str.length());
    }
}
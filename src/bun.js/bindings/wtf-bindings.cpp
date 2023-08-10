#include "wtf-bindings.h"

#include "wtf/StackTrace.h"
#include "wtf/dtoa.h"

extern "C" double WTF__parseDouble(const LChar* string, size_t length, size_t* position)
{
    return WTF::parseDouble(string, length, *position);
}

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length)
{
    WTF::StringImpl::copyCharacters(destination, source, length);
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
#include "engine/Support.h"

#include <cstdio>
#if OS(WINDOWS)
#include <windows.h>
#include <dbghelp.h>
#else
#include <cxxabi.h>
#include <dlfcn.h>
#endif

extern "C" size_t Support__captureStackTrace(void** frames, size_t capacity);

namespace WTF {

using Line = std::array<char, 1024>;

#if OS(WINDOWS)

static void describeFrame(int number, void* address, Line& line)
{
    // The library is not thread safe.
    static Lock lock;
    Locker locker { lock };
    static bool isInitialized = SymInitialize(GetCurrentProcess(), nullptr, TRUE);

    alignas(SYMBOL_INFO) std::byte storage[sizeof(SYMBOL_INFO) + MAX_SYM_NAME] {};
    auto* symbol = reinterpret_cast<SYMBOL_INFO*>(storage);
    symbol->SizeOfStruct = sizeof(SYMBOL_INFO);
    symbol->MaxNameLen = MAX_SYM_NAME;
    bool hasName = isInitialized && SymFromAddr(GetCurrentProcess(), reinterpret_cast<DWORD64>(address), nullptr, symbol);
    snprintf(line.data(), line.size(), "%-3d %p %s\n", number, address, hasName ? symbol->Name : "???");
}

#else

static void describeFrame(int number, void* address, Line& line)
{
    Dl_info info;
    if (!dladdr(address, &info)) {
        snprintf(line.data(), line.size(), "%-3d %p ???\n", number, address);
        return;
    }
    if (!info.dli_sname) {
        snprintf(line.data(), line.size(), "%-3d %p %s(+0x%tx)\n", number, address, info.dli_fname, static_cast<char*>(address) - static_cast<char*>(info.dli_fbase));
        return;
    }
    char* demangled = abi::__cxa_demangle(info.dli_sname, nullptr, nullptr, nullptr);
    snprintf(line.data(), line.size(), "%-3d %p %s\n", number, address, demangled ? demangled : info.dli_sname);
    free(demangled);
}

#endif

static void forEachLine(std::span<void* const> frames, const auto& write)
{
    Line line;
    for (size_t i = 0; i < frames.size(); ++i) {
        describeFrame(i + 1, frames[i], line);
        // A line that was cut still ends.
        line[line.size() - 2] = '\n';
        write(line.data());
    }
}

NEVER_INLINE std::unique_ptr<StackTrace> StackTrace::captureStackTrace(size_t maxFrames)
{
    auto trace = makeUnique<StackTrace>();
    auto& frames = trace->m_frames;
    frames.grow(maxFrames + 1);
    frames.shrink(Support__captureStackTrace(frames.begin(), frames.size()));
    if (!frames.isEmpty())
        frames.removeAt(0);
    return trace;
}

String StackTrace::toString() const
{
    StringBuilder builder;
    forEachLine(m_frames.span(), [&](const char* line) { builder.append(StringView::fromLatin1(line)); });
    return builder.toString();
}

}

void WTFPrintBacktrace(std::span<void* const> frames)
{
    WTF::forEachLine(frames, [](const char* line) { fputs(line, stderr); });
}

NEVER_INLINE void WTFReportBacktrace()
{
    std::array<void*, 32> frames;
    size_t count = Support__captureStackTrace(frames.data(), frames.size());
    if (count > 1)
        WTFPrintBacktrace(std::span { frames }.subspan(1, count - 1));
    else
        fputs("no stacktrace available\n", stderr);
}

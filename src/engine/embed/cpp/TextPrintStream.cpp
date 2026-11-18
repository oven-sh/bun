#include "engine/text/PrintStream.h"

#include <cinttypes>
#include <cstdio>

namespace WTF {

void printInternal(PrintStream& out, StringView string)
{
    if (auto utf8 = string.tryGetUTF8())
        printInternal(out, *utf8);
    else
        printInternal(out, "(Out of memory while converting String to utf8)");
}

void printInternal(PrintStream& out, const StringImpl* string)
{
    if (string)
        printInternal(out, StringView { *string });
    else
        printInternal(out, "(null StringImpl*)");
}

void printInternal(PrintStream& out, double value)
{
    // The sign, 309 digits, the point, six digits and the zero byte.
    char buffer[318];
    out.write({ buffer, static_cast<size_t>(snprintf(buffer, sizeof(buffer), "%f", value)) });
}

void RawPointer::dump(PrintStream& out) const
{
    char buffer[24];
#if OS(WINDOWS)
    out.write({ buffer, static_cast<size_t>(snprintf(buffer, sizeof(buffer), "0x%p", m_value)) });
#else
    out.write({ buffer, static_cast<size_t>(snprintf(buffer, sizeof(buffer), "%p", m_value)) });
#endif
}

PrintStream& dataFile()
{
    static class final : public PrintStream {
        void write(std::span<const char> bytes) final { fwrite(bytes.data(), 1, bytes.size(), stderr); }
    } stream;
    return stream;
}

}

#pragma once

#include "engine/support/Vector.h"
#include "engine/text/MakeString.h"

namespace WTF {

// Takes UTF-8.
class PrintStream {
    WTF_MAKE_NONCOPYABLE(PrintStream);
    WTF_MAKE_TZONE_ALLOCATED(PrintStream);

public:
    PrintStream() = default;
    virtual ~PrintStream() = default;

    virtual void write(std::span<const char>) = 0;

    template<typename... Types> NEVER_INLINE void print(const Types&... values) { (..., printInternal(*this, values)); }
};

class RawPointer {
public:
    explicit RawPointer(const void* value)
        : m_value(value)
    {
    }

    void dump(PrintStream&) const;

private:
    const void* m_value;
};

inline void printInternal(PrintStream& out, const char* string) { out.write(unsafeSpan(string)); }
inline void printInternal(PrintStream& out, ASCIILiteral literal) { out.write(literal.span()); }
inline void printInternal(PrintStream& out, const UTF8CString& string) { out.write(byteCast<char>(string.span())); }
void printInternal(PrintStream&, StringView);
void printInternal(PrintStream&, const StringImpl*);
void printInternal(PrintStream&, double);
inline void printInternal(PrintStream& out, const String& string) { printInternal(out, StringView { string }); }
inline void printInternal(PrintStream& out, const AtomString& string) { printInternal(out, StringView { string }); }
inline void printInternal(PrintStream& out, std::same_as<bool> auto value) { printInternal(out, value ? "true"_s : "false"_s); }

template<std::integral Integer>
    requires(!std::same_as<Integer, bool>)
void printInternal(PrintStream& out, Integer value)
{
    printInternal(out, makeString(value));
}

template<typename T>
    requires requires(const T& value, PrintStream& out) { value.dump(out); }
void printInternal(PrintStream& out, const T& value)
{
    value.dump(out);
}

class StringPrintStream final : public PrintStream {
public:
    void write(std::span<const char> bytes) final { m_bytes.append(bytes); }

    std::span<const char> span() const LIFETIME_BOUND { return m_bytes.span(); }
    String toString() const { return String::fromUTF8(span()); }
    UTF8CString toUTF8CString() const { return UTF8CString { byteCast<char8_t>(span()) }; }

private:
    Vector<char, 128> m_bytes;
};

template<typename... Types> String toString(const Types&... values)
{
    StringPrintStream stream;
    stream.print(values...);
    return stream.toString();
}

template<typename... Types> UTF8CString toUTF8CString(const Types&... values)
{
    StringPrintStream stream;
    stream.print(values...);
    return stream.toUTF8CString();
}

// Standard error.
PrintStream& dataFile();

template<typename... Types> NEVER_INLINE void dataLog(const Types&... values)
{
    StringPrintStream stream;
    stream.print(values...);
    dataFile().write(stream.span());
}

template<typename... Types> void dataLogLn(const Types&... values) { dataLog(values..., "\n"); }

}

#define dataLogLnIf(condition, ...)      \
    do {                                 \
        if (condition) [[unlikely]]      \
            WTF::dataLogLn(__VA_ARGS__); \
    } while (0)

using WTF::dataFile;
using WTF::dataLog;
using WTF::dataLogLn;
using WTF::RawPointer;
using WTF::StringPrintStream;
using WTF::toString;
using WTF::toUTF8CString;

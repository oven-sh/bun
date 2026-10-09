#pragma once

#include "root.h"

#include <array>
#include <expected>
#include <optional>
#include <wtf/text/WTFString.h>
#include <wtf/text/CString.h>

namespace JSC {
class JSGlobalObject;
class ThrowScope;
}

namespace Bun {
// UTF-8 bytes for a consumer that takes a pointer and a length. No NUL terminator: a `const char*` consumer needs `tryGetUTF8()`, which always copies.
class UTF8View {
public:
    // std::nullopt when the string does not convert: 2^30 Latin-1 characters or more, or a UTF-8 form of 2^31 bytes or more.
    static std::optional<UTF8View> tryCreate(WTF::StringView view)
    {
        UTF8View result;
        if (view.is8Bit() && view.containsOnlyASCII()) {
            result.m_borrowed = view;
            return result;
        }
        auto utf8 = view.tryGetUTF8();
        if (!utf8) [[unlikely]]
            return std::nullopt;
        result.m_converted = WTF::move(utf8.value());
        result.m_isConverted = true;
        return result;
    }

    // The same, and throws `RangeError: Out of memory` when the conversion fails.
    static std::optional<UTF8View> tryCreate(JSC::JSGlobalObject*, JSC::ThrowScope&, WTF::StringView);

    enum class Failure : uint8_t {
        OutOfMemory,
        OverLimit,
    };

    // Calls `function` with the UTF-8 bytes, which live until it returns. A lone surrogate becomes U+FFFD. A string that must be converted fails with OverLimit, before any conversion, when its UTF-8 form is longer than `byteLimit()`.
    template<typename Limit, typename Function>
    static std::expected<std::invoke_result_t<Function, std::span<const char>>, Failure> tryWith(WTF::StringView view, NOESCAPE const Limit& byteLimit, NOESCAPE const Function& function)
    {
        if (view.is8Bit() && view.containsOnlyASCII())
            return function(byteCast<char>(view.span8()));
        if (view.length() <= stackCapacity / (view.is8Bit() ? 2 : 3)) {
            std::array<char8_t, stackCapacity> stack;
            return function(byteCast<char>(convertIntoStack(view, stack)));
        }
        const size_t length = utf8Length(view);
        if (length > limitFloor && length > byteLimit()) [[unlikely]]
            return std::unexpected(Failure::OverLimit);
        WTF::Vector<char8_t> heap;
        if (!convertIntoHeap(view, length, heap)) [[unlikely]]
            return std::unexpected(Failure::OutOfMemory);
        return function(byteCast<char>(heap.span()));
    }

    std::span<const uint8_t> bytes() const { return byteCast<uint8_t>(span()); }

    std::span<const char> span() const
    {
        if (m_isConverted)
            return byteCast<char>(m_converted.span());
        return byteCast<char>(m_borrowed.span8());
    }

private:
    UTF8View() = default;

    // A code unit takes at most 2 bytes (Latin-1) or 3 bytes (UTF-16), so 511 or 341 code units always fit.
    static constexpr size_t stackCapacity = 1023;
    // Up to this many UTF-8 bytes tryWith() does not call `byteLimit()`, which can take a lock. The consumer applies its own limit to the bytes.
    static constexpr size_t limitFloor = 1 << 24;
    static std::span<const char8_t> convertIntoStack(WTF::StringView, std::span<char8_t, stackCapacity>);
    static size_t utf8Length(WTF::StringView);
    // False when the allocator refuses the buffer or the bytes do not fit in a Vector.
    static bool convertIntoHeap(WTF::StringView, size_t utf8Length, WTF::Vector<char8_t>&);

    WTF::StringView m_borrowed {};
    WTF::UTF8CString m_converted {};
    bool m_isConverted { false };
};

// Pre-hashed and never atomized in place, so any number of threads may hold
// the result and use it as a property key. `threadShareableCopy` always
// copies; `makeThreadShareable` copies only an atom/symbol/substring;
// `toCrossThreadShareable` also copies short strings so they stay atomizable.
Ref<WTF::StringImpl> threadShareableCopy(const WTF::StringImpl&);
Ref<WTF::StringImpl> makeThreadShareable(WTF::StringImpl&);
WTF::String toCrossThreadShareable(const WTF::String&);

}

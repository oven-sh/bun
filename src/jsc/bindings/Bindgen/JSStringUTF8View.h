#pragma once
#include "root.h"
#include <JavaScriptCore/GCOwnedDataScope.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSStringInlines.h>
#include <wtf/MallocSpan.h>
#include <wtf/text/ASCIIFastPath.h>

namespace Bun::Bindgen {

// Bun::UTF8View for an argument of a host call.
class JSStringUTF8View {
    WTF_FORBID_HEAP_ALLOCATION;
    WTF_MAKE_NONCOPYABLE(JSStringUTF8View);
    WTF_MAKE_NONMOVABLE(JSStringUTF8View);

public:
    // Not `= default`: value-initialization would zero the buffer first.
    JSStringUTF8View() {}

    // It is large, so it is filled in where it lives. False if it threw, which resolving a rope and converting can.
    bool initialize(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        ASSERT(m_isNull);
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        m_view = string->view(&globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        m_isNull = false;
        if (m_view->is8Bit() && WTF::charactersAreAllASCII(m_view->span8())) [[likely]]
            return true;
        if (convert()) [[likely]]
            return true;
        JSC::throwOutOfMemoryError(&globalObject, scope);
        return false;
    }

    void initialize(WTF::ASCIILiteral literal)
    {
        ASSERT(m_isNull);
        m_view = { nullptr, literal };
        m_isNull = false;
    }

    // Null data only for a view that was not initialized.
    std::span<const uint8_t> bytes() const LIFETIME_BOUND
    {
        if (m_isNull)
            return {};
        auto span = byteCast<uint8_t>(m_isConverted ? m_converted : byteCast<char8_t>(m_view->span8()));
        if (!span.data())
            return byteCast<uint8_t>(WTF::nonNullEmptyUTF8Span());
        return span;
    }

private:
    bool convert();
    std::span<char8_t> tryAllocate(size_t);

    // The owner is not always the string: the characters of a substring are its base's.
    JSC::GCOwnedDataScope<WTF::StringView> m_view;
    // Not a Vector with inline capacity, which holds less than the UTF-8 of a string can be.
    std::array<char8_t, 128> m_inlineBuffer;
    // Optional: ~MallocSpan calls free, of null too.
    std::optional<WTF::MallocSpan<char8_t>> m_heapBuffer;
    std::span<const char8_t> m_converted;
    bool m_isConverted { false };
    bool m_isNull { true };
};

}

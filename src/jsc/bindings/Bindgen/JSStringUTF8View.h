#pragma once
#include "root.h"
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSStringInlines.h>
#include <wtf/text/ASCIIFastPath.h>

namespace Bun::Bindgen {

// Bun::UTF8View for an argument of a host call: the JS string's own bytes when it is 8-bit ASCII, a
// converted copy otherwise, which for a short string needs no allocation. Lives in the host
// function's frame. Holding the JSString until destruction is what keeps borrowed bytes valid: if JSC
// swaps the string's impl for an atom, it keeps the old one for as long as the conservative scan
// still finds the JSString.
class JSStringUTF8View {
    WTF_MAKE_NONCOPYABLE(JSStringUTF8View);

public:
    JSStringUTF8View() = default;
    JSStringUTF8View(JSStringUTF8View&&) = default;
    JSStringUTF8View& operator=(JSStringUTF8View&&) = default;
    explicit JSStringUTF8View(WTF::ASCIILiteral literal)
        : m_borrowed(literal.span8())
        , m_isNull(false)
    {
    }
    ~JSStringUTF8View() { JSC::ensureStillAliveHere(m_string); }

    // Resolving a rope can throw.
    static JSStringUTF8View create(JSC::JSGlobalObject& globalObject, JSC::JSString* string)
    {
        auto& vm = JSC::getVM(&globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSStringUTF8View result;
        auto view = string->view(&globalObject);
        RETURN_IF_EXCEPTION(scope, result);
        result.m_string = string;
        result.m_isNull = false;
        if (view->is8Bit() && WTF::charactersAreAllASCII(view->span8())) [[likely]]
            result.m_borrowed = view->span8();
        else
            result.convert(view);
        return result;
    }

    bool isNull() const { return m_isNull; }

    // Null data only when isNull().
    std::span<const uint8_t> bytes() const
    {
        if (m_isNull)
            return {};
        auto span = m_isConverted ? m_converted.span() : byteCast<uint8_t>(m_borrowed);
        if (!span.data())
            return { reinterpret_cast<const uint8_t*>(""), 0 };
        return span;
    }

private:
    void convert(WTF::StringView);

    JSC::JSString* m_string { nullptr };
    std::span<const Latin1Character> m_borrowed;
    WTF::Vector<uint8_t, 128> m_converted;
    bool m_isConverted { false };
    bool m_isNull { true };
};

}

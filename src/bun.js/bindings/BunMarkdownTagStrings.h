#pragma once

#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/LazyProperty.h>

// Markdown HTML tag names cached as JSStrings
// These are commonly reused when rendering markdown to React elements

// clang-format off
#define MARKDOWN_TAG_STRINGS_EACH_NAME(macro) \
    macro(h1, "h1"_s, 0) \
    macro(h2, "h2"_s, 1) \
    macro(h3, "h3"_s, 2) \
    macro(h4, "h4"_s, 3) \
    macro(h5, "h5"_s, 4) \
    macro(h6, "h6"_s, 5) \
    macro(p, "p"_s, 6) \
    macro(blockquote, "blockquote"_s, 7) \
    macro(ul, "ul"_s, 8) \
    macro(ol, "ol"_s, 9) \
    macro(li, "li"_s, 10) \
    macro(pre, "pre"_s, 11) \
    macro(hr, "hr"_s, 12) \
    macro(html, "html"_s, 13) \
    macro(table, "table"_s, 14) \
    macro(thead, "thead"_s, 15) \
    macro(tbody, "tbody"_s, 16) \
    macro(tr, "tr"_s, 17) \
    macro(th, "th"_s, 18) \
    macro(td, "td"_s, 19) \
    macro(div, "div"_s, 20) \
    macro(em, "em"_s, 21) \
    macro(strong, "strong"_s, 22) \
    macro(a, "a"_s, 23) \
    macro(img, "img"_s, 24) \
    macro(code, "code"_s, 25) \
    macro(del, "del"_s, 26) \
    macro(math, "math"_s, 27) \
    macro(u, "u"_s, 28) \
    macro(br, "br"_s, 29)
// clang-format on

#define MARKDOWN_TAG_STRINGS_COUNT 30

namespace Bun {

using namespace JSC;

class MarkdownTagStrings {
public:
#define MARKDOWN_TAG_STRINGS_ACCESSOR_DEFINITION(name, str, idx)        \
    JSC::JSString* name##String(JSC::JSGlobalObject* globalObject)      \
    {                                                                   \
        return m_strings[idx].getInitializedOnMainThread(globalObject); \
    }

    MARKDOWN_TAG_STRINGS_EACH_NAME(MARKDOWN_TAG_STRINGS_ACCESSOR_DEFINITION)

#undef MARKDOWN_TAG_STRINGS_ACCESSOR_DEFINITION

    void initialize();

    template<typename Visitor>
    void visit(Visitor& visitor);

private:
    JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString> m_strings[MARKDOWN_TAG_STRINGS_COUNT];
};

} // namespace Bun

#include "root.h"
#include "BunMarkdownTagStrings.h"
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>

namespace Bun {
using namespace JSC;

#define MARKDOWN_TAG_STRINGS_LITERAL_ENTRY(name, str, idx) str,
#define MARKDOWN_TAG_STRINGS_INDEX_ENTRY(name, str, idx) idx,
static constexpr ASCIILiteral tagLiterals[] = {
    MARKDOWN_TAG_STRINGS_EACH_NAME(MARKDOWN_TAG_STRINGS_LITERAL_ENTRY)
};
static constexpr size_t tagIndexOfEntry[] = {
    MARKDOWN_TAG_STRINGS_EACH_NAME(MARKDOWN_TAG_STRINGS_INDEX_ENTRY)
};
#undef MARKDOWN_TAG_STRINGS_LITERAL_ENTRY
#undef MARKDOWN_TAG_STRINGS_INDEX_ENTRY
static constexpr bool entriesFollowTagIndexOrder()
{
    for (size_t i = 0; i < std::size(tagIndexOfEntry); i++) {
        if (tagIndexOfEntry[i] != i)
            return false;
    }
    return true;
}
static_assert(std::size(tagLiterals) == MARKDOWN_TAG_STRINGS_COUNT);
static_assert(entriesFollowTagIndexOrder(), "MARKDOWN_TAG_STRINGS_EACH_NAME must be listed in idx order");

void MarkdownTagStrings::initialize()
{
    for (auto& string : m_strings) {
        string.initLater([](const JSC::LazyProperty<JSGlobalObject, JSString>::Initializer& init) {
            auto& self = defaultGlobalObject(init.owner)->markdownTagStrings();
            size_t i = &init.property - self.m_strings;
            ASSERT(i < std::size(self.m_strings));
            init.set(jsOwnedString(init.vm, tagLiterals[i]));
        });
    }
}

template<typename Visitor>
void MarkdownTagStrings::visit(Visitor& visitor)
{
    for (auto& string : m_strings)
        string.visit(visitor);
}

template void MarkdownTagStrings::visit(JSC::AbstractSlotVisitor&);
template void MarkdownTagStrings::visit(JSC::SlotVisitor&);

} // namespace Bun

// C API for the Rust bindings
extern "C" JSC::EncodedJSValue BunMarkdownTagStrings__getTagString(Zig::GlobalObject* globalObject, uint8_t tagIndex)
{
    if (tagIndex >= MARKDOWN_TAG_STRINGS_COUNT)
        return JSC::JSValue::encode(JSC::jsUndefined());

    return JSC::JSValue::encode(globalObject->markdownTagStrings().stringAt(globalObject, tagIndex));
}

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
static constexpr ASCIILiteral tagLiterals[] = {
    MARKDOWN_TAG_STRINGS_EACH_NAME(MARKDOWN_TAG_STRINGS_LITERAL_ENTRY)
};
#undef MARKDOWN_TAG_STRINGS_LITERAL_ENTRY
static_assert(std::size(tagLiterals) == MARKDOWN_TAG_STRINGS_COUNT);

void MarkdownTagStrings::initialize()
{
    for (auto& string : m_strings) {
        string.initLater([](const JSC::LazyProperty<JSGlobalObject, JSString>::Initializer& init) {
            auto& self = defaultGlobalObject(init.owner)->markdownTagStrings();
            init.set(jsOwnedString(init.vm, tagLiterals[&init.property - self.m_strings]));
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

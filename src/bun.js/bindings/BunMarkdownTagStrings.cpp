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

#define MARKDOWN_TAG_STRINGS_LAZY_PROPERTY_DEFINITION(name, str, idx)              \
    this->m_strings[idx].initLater(                                                \
        [](const JSC::LazyProperty<JSGlobalObject, JSString>::Initializer& init) { \
            init.set(jsOwnedString(init.vm, str));                                 \
        });

#define MARKDOWN_TAG_STRINGS_LAZY_PROPERTY_VISITOR(name, str, idx) \
    this->m_strings[idx].visit(visitor);

void MarkdownTagStrings::initialize()
{
    MARKDOWN_TAG_STRINGS_EACH_NAME(MARKDOWN_TAG_STRINGS_LAZY_PROPERTY_DEFINITION)
}

template<typename Visitor>
void MarkdownTagStrings::visit(Visitor& visitor)
{
    MARKDOWN_TAG_STRINGS_EACH_NAME(MARKDOWN_TAG_STRINGS_LAZY_PROPERTY_VISITOR)
}

template void MarkdownTagStrings::visit(JSC::AbstractSlotVisitor&);
template void MarkdownTagStrings::visit(JSC::SlotVisitor&);

} // namespace Bun

// C API for Zig bindings
extern "C" JSC::EncodedJSValue BunMarkdownTagStrings__getTagString(Zig::GlobalObject* globalObject, uint8_t tagIndex)
{
    if (tagIndex >= MARKDOWN_TAG_STRINGS_COUNT)
        return JSC::JSValue::encode(JSC::jsUndefined());

    auto& tagStrings = globalObject->markdownTagStrings();

    // Use a switch to call the appropriate accessor
    switch (tagIndex) {
#define MARKDOWN_TAG_STRINGS_CASE(name, str, idx) \
    case idx:                                     \
        return JSC::JSValue::encode(tagStrings.name##String(globalObject));

        MARKDOWN_TAG_STRINGS_EACH_NAME(MARKDOWN_TAG_STRINGS_CASE)

#undef MARKDOWN_TAG_STRINGS_CASE
    default:
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
}

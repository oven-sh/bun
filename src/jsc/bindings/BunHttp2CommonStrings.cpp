#include "root.h"
#include "BunHttp2CommonStrings.h"
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>

namespace Bun {
using namespace JSC;

#define HTTP2_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION(jsName, key, value, idx)     \
    this->m_names[idx].initLater(                                                  \
        [](const JSC::LazyProperty<JSGlobalObject, JSString>::Initializer& init) { \
            init.set(jsOwnedString(init.vm, key));                                 \
        });

#define HTTP2_COMMON_STRINGS_LAZY_PROPERTY_VISITOR(name, key, value, idx) \
    this->m_names[idx].visit(visitor);

void Http2CommonStrings::initialize()
{
    HTTP2_COMMON_STRINGS_EACH_NAME(HTTP2_COMMON_STRINGS_LAZY_PROPERTY_DEFINITION)
}

template<typename Visitor>
void Http2CommonStrings::visit(Visitor& visitor)
{
    HTTP2_COMMON_STRINGS_EACH_NAME(HTTP2_COMMON_STRINGS_LAZY_PROPERTY_VISITOR)
}

template void Http2CommonStrings::visit(JSC::AbstractSlotVisitor&);
template void Http2CommonStrings::visit(JSC::SlotVisitor&);

} // namespace Bun

#include "BunClientData.h"
#include "HTTPHeaderIdentifiers.h"
#include <JavaScriptCore/LazyPropertyInlines.h>

namespace WebCore {

#define HTTP_HEADERS_LAZY_PROPERTY_DEFINITION(literal, name)                                 \
    m_##name##String.initLater(                                                              \
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString>::Initializer& init) { \
            auto& ids = WebCore::clientData(init.vm)->httpHeaderIdentifiers();               \
            auto& id = ids.name##Identifier(init.vm);                                        \
            init.set(jsOwnedString(init.vm, id.string()));                                   \
        });

HTTPHeaderIdentifiers::HTTPHeaderIdentifiers() {
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_LAZY_PROPERTY_DEFINITION)
}

#undef HTTP_HEADERS_LAZY_PROPERTY_DEFINITION

#define HTTP_HEADERS_ACCESSOR_DEFINITIONS(literal, name)                                  \
    JSC::Identifier& HTTPHeaderIdentifiers::name##Identifier(JSC::VM& vm)                 \
    {                                                                                     \
        if (m_##name##Identifier.isEmpty())                                               \
            m_##name##Identifier = JSC::Identifier::fromString(vm, literal);              \
        return m_##name##Identifier;                                                      \
    }                                                                                     \
    JSC::JSString* HTTPHeaderIdentifiers::name##String(JSC::JSGlobalObject* globalObject) \
    {                                                                                     \
        return m_##name##String.getInitializedOnMainThread(globalObject);                 \
    }

HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_ACCESSOR_DEFINITIONS)

#undef HTTP_HEADERS_ACCESSOR_DEFINITIONS

#define HTTP_HEADERS_IDENTIFIER_ARRAY_ENTRIES(literal, name) \
    &HTTPHeaderIdentifiers::name##Identifier,

    using IdentifierGetter
    = JSC::Identifier & (HTTPHeaderIdentifiers::*)(JSC::VM&);

static IdentifierGetter headerIdentifierFields[]
    = {
          HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_IDENTIFIER_ARRAY_ENTRIES)
      };

JSC::Identifier& HTTPHeaderIdentifiers::identifierFor(JSC::VM& vm, HTTPHeaderName name)
{
    return (this->*headerIdentifierFields[static_cast<size_t>(name)])(vm);
}

#undef HTTP_HEADERS_IDENTIFIER_ARRAY_ENTRIES

#define HTTP_HEADERS_STRING_ARRAY_ENTRIES(literal, name) \
    &HTTPHeaderIdentifiers::name##String,

using StringGetter
    = JSC::JSString* (HTTPHeaderIdentifiers::*)(JSC::JSGlobalObject*);

static StringGetter headerStringFields[]
    = {
          HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_STRING_ARRAY_ENTRIES)
      };

JSC::JSString* HTTPHeaderIdentifiers::stringFor(JSC::JSGlobalObject* globalObject, HTTPHeaderName name)
{
    return (this->*headerStringFields[static_cast<size_t>(name)])(globalObject);
}

#undef HTTP_HEADERS_STRING_ARRAY_ENTRIES

#define HTTP_HEADERS_LAZY_PROPERTY_VISITOR(literal, name) m_##name##String.visit(visitor);

template<typename Visitor>
void HTTPHeaderIdentifiers::visit(Visitor& visitor)
{
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_LAZY_PROPERTY_VISITOR)
}

template void HTTPHeaderIdentifiers::visit(JSC::AbstractSlotVisitor&);
template void HTTPHeaderIdentifiers::visit(JSC::SlotVisitor&);

} // namespace WebCore

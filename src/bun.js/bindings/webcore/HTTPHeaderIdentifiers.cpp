#include "BunClientData.h"
#include "HTTPHeaderIdentifiers.h"
#include <JavaScriptCore/LazyPropertyInlines.h>

namespace WebCore {

HTTPHeaderIdentifiers::HTTPHeaderIdentifiers() = default;

#define HTTP_HEADERS_LAZY_PROPERTY_DEFINITION(literal, name)                                 \
    m_##name##String.initLater(                                                              \
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString>::Initializer& init) { \
            auto& ids = WebCore::clientData(init.vm)->httpHeaderIdentifiers();               \
            auto& id = ids.name##Identifier(init.vm);                                        \
            init.set(jsOwnedString(init.vm, id.string()));                                   \
        });

void HTTPHeaderIdentifiers::initialize() {
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_LAZY_PROPERTY_DEFINITION)
}

#undef HTTP_HEADERS_LAZY_PROPERTY_DEFINITION

#define HTTP_HEADER_ACCESSOR_DEFINITIONS(literal, name)                                   \
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

HTTP_HEADERS_EACH_NAME(HTTP_HEADER_ACCESSOR_DEFINITIONS)

#undef HTTP_HEADER_ACCESSOR_DEFINITIONS

} // namespace WebCore

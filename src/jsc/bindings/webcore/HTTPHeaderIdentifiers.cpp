#include "BunClientData.h"
#include "HTTPHeaderIdentifiers.h"
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <wtf/text/StringView.h>
#include <iterator>

namespace WebCore {

#define HTTP_HEADERS_LAZY_PROPERTY_DEFINITION(literal, name)                                 \
    m_##name##String.initLater(                                                              \
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString>::Initializer& init) { \
            auto& ids = WebCore::clientData(init.vm)->httpHeaderIdentifiers();               \
            auto& id = ids.name##Identifier(init.vm);                                        \
            init.set(jsOwnedString(init.vm, id.string()));                                   \
        });

HTTPHeaderIdentifiers::HTTPHeaderIdentifiers()
{
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_LAZY_PROPERTY_DEFINITION);
    HTTP2_PSEUDO_HEADERS_EACH_NAME(HTTP_HEADERS_LAZY_PROPERTY_DEFINITION);
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

HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_ACCESSOR_DEFINITIONS);
HTTP2_PSEUDO_HEADERS_EACH_NAME(HTTP_HEADERS_ACCESSOR_DEFINITIONS);

#undef HTTP_HEADERS_ACCESSOR_DEFINITIONS

using IdentifierGetter = JSC::Identifier& (HTTPHeaderIdentifiers::*)(JSC::VM&);
using StringGetter = JSC::JSString* (HTTPHeaderIdentifiers::*)(JSC::JSGlobalObject*);

#define HTTP_HEADERS_IDENTIFIER_ARRAY_ENTRIES(literal, name) \
    &HTTPHeaderIdentifiers::name##Identifier,
#define HTTP_HEADERS_STRING_ARRAY_ENTRIES(literal, name) \
    &HTTPHeaderIdentifiers::name##String,

// Indexed by HTTPHeaderName; HTTP_HEADERS_EACH_NAME follows HTTPHeaderNames.in's order.
static const IdentifierGetter headerIdentifierFields[] = {
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_IDENTIFIER_ARRAY_ENTRIES)
};
static const StringGetter headerStringFields[] = {
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_STRING_ARRAY_ENTRIES)
};
static_assert(std::size(headerIdentifierFields) == numHTTPHeaderNames);
static_assert(std::size(headerStringFields) == numHTTPHeaderNames);

// Indexed by HTTP2PseudoHeaderName, generated from the same list.
static const IdentifierGetter pseudoHeaderIdentifierFields[] = {
    HTTP2_PSEUDO_HEADERS_EACH_NAME(HTTP_HEADERS_IDENTIFIER_ARRAY_ENTRIES)
};
static const StringGetter pseudoHeaderStringFields[] = {
    HTTP2_PSEUDO_HEADERS_EACH_NAME(HTTP_HEADERS_STRING_ARRAY_ENTRIES)
};

#undef HTTP_HEADERS_IDENTIFIER_ARRAY_ENTRIES
#undef HTTP_HEADERS_STRING_ARRAY_ENTRIES

JSC::Identifier& HTTPHeaderIdentifiers::identifierFor(JSC::VM& vm, HTTPHeaderName name)
{
    return (this->*headerIdentifierFields[static_cast<size_t>(name)])(vm);
}

JSC::JSString* HTTPHeaderIdentifiers::stringFor(JSC::JSGlobalObject* globalObject, HTTPHeaderName name)
{
    return (this->*headerStringFields[static_cast<size_t>(name)])(globalObject);
}

JSC::Identifier& HTTPHeaderIdentifiers::identifierFor(JSC::VM& vm, HTTP2PseudoHeaderName name)
{
    return (this->*pseudoHeaderIdentifierFields[static_cast<size_t>(name)])(vm);
}

JSC::JSString* HTTPHeaderIdentifiers::stringFor(JSC::JSGlobalObject* globalObject, HTTP2PseudoHeaderName name)
{
    return (this->*pseudoHeaderStringFields[static_cast<size_t>(name)])(globalObject);
}

#define HTTP2_PSEUDO_HEADERS_FIND(literal, name) \
    if (view == literal##_s) {                   \
        result = HTTP2PseudoHeaderName::name;    \
        return true;                             \
    }

bool findHTTP2PseudoHeaderName(WTF::StringView view, HTTP2PseudoHeaderName& result)
{
    if (view.isEmpty() || view[0] != ':')
        return false;
    HTTP2_PSEUDO_HEADERS_EACH_NAME(HTTP2_PSEUDO_HEADERS_FIND);
    return false;
}

#undef HTTP2_PSEUDO_HEADERS_FIND

#define HTTP_HEADERS_LAZY_PROPERTY_VISITOR(literal, name) m_##name##String.visit(visitor);

template<typename Visitor>
void HTTPHeaderIdentifiers::visit(Visitor& visitor)
{
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_LAZY_PROPERTY_VISITOR);
    HTTP2_PSEUDO_HEADERS_EACH_NAME(HTTP_HEADERS_LAZY_PROPERTY_VISITOR);
}

#undef HTTP_HEADERS_LAZY_PROPERTY_VISITOR

template void HTTPHeaderIdentifiers::visit(JSC::AbstractSlotVisitor&);
template void HTTPHeaderIdentifiers::visit(JSC::SlotVisitor&);

} // namespace WebCore

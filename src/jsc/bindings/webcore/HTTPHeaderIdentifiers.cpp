#include "BunClientData.h"
#include "HTTPHeaderIdentifiers.h"
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <wtf/text/StringView.h>
#include <iterator>

namespace WebCore {

#define HTTP_HEADERS_LITERAL_ENTRY(literal, name) literal##_s,
#define HTTP_HEADERS_ENUM_ENTRIES(literal, name) HTTPHeaderName::name,

// Indexed by HTTPHeaderIdentifiers::Index: HTTPHeaderName entries first, then pseudo-headers.
// clang-format off
static constexpr ASCIILiteral headerLiterals[] = {
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_LITERAL_ENTRY)
    HTTP2_PSEUDO_HEADERS_EACH_NAME(HTTP_HEADERS_LITERAL_ENTRY)
};
// clang-format on
static_assert(std::size(headerLiterals) == static_cast<size_t>(HTTPHeaderIdentifiers::Index::Count));

static constexpr HTTPHeaderName headerNameOfEntry[] = {
    HTTP_HEADERS_EACH_NAME(HTTP_HEADERS_ENUM_ENTRIES)
};
static constexpr bool entriesFollowHTTPHeaderNameOrder()
{
    for (size_t i = 0; i < std::size(headerNameOfEntry); i++) {
        if (static_cast<size_t>(headerNameOfEntry[i]) != i)
            return false;
    }
    return true;
}
static_assert(std::size(headerNameOfEntry) == numHTTPHeaderNames, "HTTP_HEADERS_EACH_NAME must list every HTTPHeaderName");
static_assert(entriesFollowHTTPHeaderNameOrder(), "HTTP_HEADERS_EACH_NAME must follow the HTTPHeaderName enum order");
static_assert(static_cast<size_t>(HTTPHeaderIdentifiers::Index::Authority) == numHTTPHeaderNames);

#undef HTTP_HEADERS_LITERAL_ENTRY
#undef HTTP_HEADERS_ENUM_ENTRIES

HTTPHeaderIdentifiers::HTTPHeaderIdentifiers()
{
    for (auto& string : m_strings) {
        string.initLater([](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString>::Initializer& init) {
            auto& ids = WebCore::clientData(init.vm)->httpHeaderIdentifiers();
            size_t i = &init.property - ids.m_strings;
            ASSERT(i < std::size(ids.m_strings));
            init.set(jsOwnedString(init.vm, ids.identifierAt(init.vm, i).string()));
        });
    }
}

JSC::Identifier& HTTPHeaderIdentifiers::identifierAt(JSC::VM& vm, size_t i)
{
    if (m_identifiers[i].isEmpty())
        m_identifiers[i] = JSC::Identifier::fromString(vm, headerLiterals[i]);
    return m_identifiers[i];
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

template<typename Visitor>
void HTTPHeaderIdentifiers::visit(Visitor& visitor)
{
    for (auto& string : m_strings)
        string.visit(visitor);
}

template void HTTPHeaderIdentifiers::visit(JSC::AbstractSlotVisitor&);
template void HTTPHeaderIdentifiers::visit(JSC::SlotVisitor&);

} // namespace WebCore

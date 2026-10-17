#include "config.h"
#include "StaticNames.h"

#include "DOMClientData.h"
#include "StaticNameTables.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(StaticNames);

static_assert(std::size(staticNameEntries) == std::to_underlying(lastNodeNameEnumValue) + 1);
static_assert(std::size(staticTagNames) == std::to_underlying(lastTagNameEnumValue) + 1);
static_assert(std::size(staticNamespaceURIs) == std::to_underlying(Namespace::XMLNS) + 1);

#define COMMON_ATOM_LITERAL(atomName, atomValue) atomValue##_s,
static constexpr ASCIILiteral commonAtomLiterals[] = {
    WEBCORE_COMMON_ATOM_STRINGS_FOR_EACH_KEYWORD(COMMON_ATOM_LITERAL)
};
#undef COMMON_ATOM_LITERAL
static_assert(std::size(commonAtomLiterals) == commonAtomStringCount);

StaticNames::StaticNames() = default;
StaticNames::~StaticNames() = default;

static AtomString makeAtomString(const StringImpl::StaticStringImpl& string)
{
#ifndef NDEBUG
    reinterpret_cast<const StringImpl*>(&string)->assertHashIsCorrect();
#endif
    return AtomString { string };
}

const QualifiedName& StaticNames::qualifiedName(NodeName nodeName)
{
    auto& name = m_qualifiedNames[std::to_underlying(nodeName)];
    if (!name.impl()) [[unlikely]] {
        ASSERT(nodeName != NodeName::Unknown);
        auto& entry = staticNameEntries[std::to_underlying(nodeName)];
        name = QualifiedName { nullAtom(), makeAtomString(*entry.localName), namespaceURI(entry.nodeNamespace), entry.nodeNamespace, nodeName };
    }
    return name;
}

const QualifiedName& StaticNames::anyName()
{
    if (!m_anyName.impl()) [[unlikely]] {
        auto& star = commonAtomString(CommonAtomString::starAtom);
        m_anyName = QualifiedName { nullAtom(), star, star, Namespace::Unknown, NodeName::Unknown };
    }
    return m_anyName;
}

const QualifiedName& StaticNames::nullName()
{
    if (!m_nullName.impl()) [[unlikely]]
        m_nullName = QualifiedName { nullAtom(), nullAtom(), nullAtom(), Namespace::None, NodeName::Unknown };
    return m_nullName;
}

const AtomString& StaticNames::namespaceURI(Namespace nodeNamespace)
{
    auto literal = staticNamespaceURIs[std::to_underlying(nodeNamespace)];
    if (literal.isNull())
        return nullAtom();
    auto& uri = m_namespaceURIs[std::to_underlying(nodeNamespace)];
    if (uri.isNull()) [[unlikely]]
        uri = literal;
    return uri;
}

const AtomString& StaticNames::tagName(TagName tagName)
{
    auto& string = m_tagNames[std::to_underlying(tagName)];
    if (string.isNull() && tagName != TagName::Unknown) [[unlikely]]
        string = makeAtomString(*staticTagNames[std::to_underlying(tagName)]);
    return string;
}

const AtomString& StaticNames::commonAtomString(CommonAtomString atom)
{
    auto& string = m_commonAtomStrings[std::to_underlying(atom)];
    if (string.isNull()) [[unlikely]]
        string = commonAtomLiterals[std::to_underlying(atom)];
    return string;
}

const QualifiedName& StaticQualifiedName::get() const
{
    return domClientData().staticNames().qualifiedName(m_nodeName);
}

const AtomString& StaticNamespaceURI::get() const
{
    return domClientData().staticNames().namespaceURI(m_namespace);
}

const QualifiedName& anyQName()
{
    return domClientData().staticNames().anyName();
}

const QualifiedName& nullQName()
{
    return domClientData().staticNames().nullName();
}

const AtomString& tagNameAsString(TagName tagName)
{
    return domClientData().staticNames().tagName(tagName);
}

const AtomString& commonAtomString(CommonAtomString atom)
{
    return domClientData().staticNames().commonAtomString(atom);
}

} // namespace WebCore

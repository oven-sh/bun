#pragma once

#include "CommonAtomStrings.h"
#include "NodeName.h"
#include "QualifiedName.h"
#include <wtf/Noncopyable.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

// One VM's QualifiedNames and AtomStrings for the names that are known at compile time: StaticQualifiedName,
// StaticNamespaceURI, TagName, CommonAtomString. AtomStrings belong to a thread, so this cannot be shared.
// Each entry is made on first use.
class StaticNames {
    WTF_MAKE_TZONE_ALLOCATED(StaticNames);
    WTF_MAKE_NONCOPYABLE(StaticNames);

public:
    StaticNames();
    ~StaticNames();

    const QualifiedName& qualifiedName(NodeName);
    const QualifiedName& anyName();
    const QualifiedName& nullName();
    const AtomString& namespaceURI(Namespace);
    const AtomString& tagName(TagName);
    const AtomString& commonAtomString(CommonAtomString);

private:
    QualifiedName m_qualifiedNames[std::to_underlying(lastNodeNameEnumValue) + 1];
    QualifiedName m_anyName;
    QualifiedName m_nullName;
    AtomString m_namespaceURIs[std::to_underlying(Namespace::XMLNS) + 1];
    AtomString m_tagNames[std::to_underlying(lastTagNameEnumValue) + 1];
    AtomString m_commonAtomStrings[commonAtomStringCount];
};

} // namespace WebCore

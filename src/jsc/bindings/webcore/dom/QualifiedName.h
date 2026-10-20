/*
 * Copyright (C) 2005-2017 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#pragma once

#include <wtf/HashTraits.h>
#include <wtf/Hasher.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/AtomStringHash.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

enum class Namespace : uint8_t;
enum class NodeName : uint16_t;

class QualifiedName;

// A name that is known at compile time, such as HTMLNames::divTag or HTMLNames::classAttr.
// It holds only the enumerator, so it is the same on every thread and needs no initialization.
// Comparisons use the enumerator. The QualifiedName is per VM (StaticNames) and is made on first use.
// None of these names has a prefix.
class StaticQualifiedName {
public:
    explicit constexpr StaticQualifiedName(NodeName nodeName)
        : m_nodeName(nodeName)
    {
        ASSERT_UNDER_CONSTEXPR_CONTEXT(std::to_underlying(nodeName));
    }

    constexpr NodeName nodeName() const { return m_nodeName; }

    WEBCORE_EXPORT const QualifiedName& get() const;
    operator const QualifiedName&() const { return get(); }
    const QualifiedName* operator->() const { return &get(); }

    friend constexpr bool operator==(StaticQualifiedName, StaticQualifiedName) = default;

private:
    NodeName m_nodeName;
};

// A namespace URI that is known at compile time, such as HTMLNames::xhtmlNamespaceURI. The AtomString is per VM.
class StaticNamespaceURI {
public:
    explicit constexpr StaticNamespaceURI(Namespace nodeNamespace)
        : m_namespace(nodeNamespace)
    {
    }

    constexpr Namespace nodeNamespace() const { return m_namespace; }

    WEBCORE_EXPORT const AtomString& get() const;
    operator const AtomString&() const { return get(); }
    const AtomString* operator->() const { return &get(); }

private:
    Namespace m_namespace;
};

struct QualifiedNameComponents {
    RefPtr<AtomStringImpl> m_prefix;
    RefPtr<AtomStringImpl> m_localName;
    RefPtr<AtomStringImpl> m_namespaceURI;
};

inline void add(Hasher& hasher, const QualifiedNameComponents& components)
{
    add(hasher, components.m_prefix.get(), components.m_localName.get(), components.m_namespaceURI.get());
}

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(QualifiedName);
DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(QualifiedNameQualifiedNameImpl);

class QualifiedName {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(QualifiedName, QualifiedName);
public:
    class QualifiedNameImpl : public RefCounted<QualifiedNameImpl> {
        WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(QualifiedNameImpl, QualifiedNameQualifiedNameImpl);
    public:
        static Ref<QualifiedNameImpl> create(const AtomString& prefix, const AtomString& localName, const AtomString& namespaceURI)
        {
            return adoptRef(*new QualifiedNameImpl(prefix, localName, namespaceURI));
        }

        WEBCORE_EXPORT ~QualifiedNameImpl();

        WEBCORE_EXPORT unsigned computeHash() const;

        mutable unsigned m_existingHash { 0 };
        Namespace m_namespace;
        NodeName m_nodeName;
        const AtomString m_prefix;
        const AtomString m_localName;
        const AtomString m_namespaceURI;
        AtomString m_localNameLower;
        mutable AtomString m_localNameUpper;

        static constexpr ptrdiff_t namespaceMemoryOffset() { return OBJECT_OFFSETOF(QualifiedNameImpl, m_namespace); }
        static constexpr ptrdiff_t nodeNameMemoryOffset() { return OBJECT_OFFSETOF(QualifiedNameImpl, m_nodeName); }
        static constexpr ptrdiff_t localNameMemoryOffset() { return OBJECT_OFFSETOF(QualifiedNameImpl, m_localName); }
        static constexpr ptrdiff_t namespaceURIMemoryOffset() { return OBJECT_OFFSETOF(QualifiedNameImpl, m_namespaceURI); }

    private:
        friend class QualifiedName;

        WEBCORE_EXPORT QualifiedNameImpl(const AtomString& prefix, const AtomString& localName, const AtomString& namespaceURI);
    };

    WEBCORE_EXPORT QualifiedName(const AtomString& prefix, const AtomString& localName, const AtomString& namespaceURI);
    WEBCORE_EXPORT QualifiedName(const AtomString& prefix, const AtomString& localName, const AtomString& namespaceURI, Namespace, NodeName);
    QualifiedName(QualifiedNameImpl& impl) : m_impl(&impl) { }
    explicit QualifiedName(WTF::HashTableDeletedValueType) : m_impl(WTF::HashTableDeletedValue) { }
    bool isHashTableDeletedValue() const { return m_impl.isHashTableDeletedValue(); }

    friend bool operator==(const QualifiedName&, const QualifiedName&) = default;
    friend bool operator==(const QualifiedName& a, StaticQualifiedName b) { return a.nodeName() == b.nodeName() && !a.hasPrefix(); }

    bool matches(const QualifiedName& other) const { return m_impl == other.m_impl || (localName() == other.localName() && namespaceURI() == other.namespaceURI()); }
    bool matches(StaticQualifiedName other) const { return nodeName() == other.nodeName(); }
    bool hasLocalName(const AtomString& other) const { return localName() == other; }

    bool hasPrefix() const { return !m_impl->m_prefix.isNull(); }
    void setPrefix(const AtomString& prefix) { *this = QualifiedName(prefix, localName(), namespaceURI()); }

    const AtomString& prefix() const LIFETIME_BOUND { return m_impl->m_prefix; }
    const AtomString& localName() const LIFETIME_BOUND { return m_impl->m_localName; }
    const AtomString& namespaceURI() const LIFETIME_BOUND { return m_impl->m_namespaceURI; }
    const AtomString& localNameLowercase() const LIFETIME_BOUND { return m_impl->m_localNameLower; }
    const AtomString& localNameUppercase() const LIFETIME_BOUND;

    NodeName nodeName() const { return m_impl->m_nodeName; }
    Namespace nodeNamespace() const { return m_impl->m_namespace; }

    String toString() const;
    AtomString toAtomString() const;

    QualifiedNameImpl* impl() const { return m_impl.get(); }
#if ENABLE(JIT)
    static constexpr ptrdiff_t implMemoryOffset() { return OBJECT_OFFSETOF(QualifiedName, m_impl); }
#endif

private:
    friend class StaticNames;
    QualifiedName() = default; // A slot of StaticNames that is not filled yet.

    static QualifiedNameImpl* hashTableDeletedValue() { return RefPtr<QualifiedNameImpl>::PtrTraits::hashTableDeletedValue(); }
    
    RefPtr<QualifiedNameImpl> m_impl;
};

inline void add(Hasher& hasher, const QualifiedName::QualifiedNameImpl& impl)
{
    add(hasher, impl.m_prefix, impl.m_localName, impl.m_namespaceURI);
}

inline void add(Hasher& hasher, const QualifiedName& name)
{
    add(hasher, std::bit_cast<uintptr_t>(name.impl()));
}

WEBCORE_EXPORT const QualifiedName& anyQName();
WEBCORE_EXPORT const QualifiedName& nullQName();

struct QualifiedNameHash {
    static unsigned hash(const QualifiedName& name) { return hash(name.impl()); }

    static unsigned hash(const QualifiedName::QualifiedNameImpl* name) 
    {
        if (!name->m_existingHash)
            name->m_existingHash = name->computeHash();
        return name->m_existingHash;
    }

    static bool equal(const QualifiedName& a, const QualifiedName& b) { return a == b; }
    static bool equal(const QualifiedName::QualifiedNameImpl* a, const QualifiedName::QualifiedNameImpl* b) { return a == b; }

    static constexpr bool safeToCompareToEmptyOrDeleted = false;
    static constexpr bool hasHashInValue = true;
};

inline String QualifiedName::toString() const
{
    if (!hasPrefix())
        return localName();

    return makeString(prefix().string(), ':', localName().string());
}

inline AtomString QualifiedName::toAtomString() const
{
    if (!hasPrefix())
        return localName();

    return makeAtomString(prefix(), ':', localName());
}

} // namespace WebCore

namespace WTF {
    
    template<typename T> struct DefaultHash;

    template<> struct DefaultHash<WebCore::QualifiedName> : WebCore::QualifiedNameHash { };
    
    template<> struct HashTraits<WebCore::QualifiedName> : SimpleClassHashTraits<WebCore::QualifiedName> {
        static const bool emptyValueIsZero = false;
        static WebCore::QualifiedName emptyValue() { return WebCore::nullQName(); }
    };

} // namespace WTF

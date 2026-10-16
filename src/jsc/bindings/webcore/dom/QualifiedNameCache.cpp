/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

#include "config.h"
#include "QualifiedNameCache.h"

#include "Namespace.h"
#include "NodeName.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(QualifiedNameCache);

struct QNameComponentsTranslator {
    static unsigned LEGACY_NODELETE hash(const QualifiedNameComponents& components)
    {
        return computeHash(components);
    }

    static bool LEGACY_NODELETE equal(QualifiedName::QualifiedNameImpl* name, const QualifiedNameComponents& c)
    {
        return c.m_prefix == name->m_prefix.impl() && c.m_localName == name->m_localName.impl() && c.m_namespaceURI == name->m_namespaceURI.impl();
    }

    static void translate(QualifiedName::QualifiedNameImpl*& location, const QualifiedNameComponents& components, unsigned)
    {
        location = &QualifiedName::QualifiedNameImpl::create(components.m_prefix.get(), components.m_localName.get(), components.m_namespaceURI.get()).leakRef();
    }
};

static void updateImplWithNamespaceAndElementName(QualifiedName::QualifiedNameImpl& impl, Namespace nodeNamespace, NodeName nodeName)
{
    impl.m_namespace = nodeNamespace;
    impl.m_nodeName = nodeName;
    bool needsLowercasing = nodeNamespace != Namespace::HTML || nodeName == NodeName::Unknown;
    impl.m_localNameLower = needsLowercasing ? impl.m_localName.convertToASCIILowercase() : impl.m_localName;
}

Ref<QualifiedName::QualifiedNameImpl> QualifiedNameCache::getOrCreate(const QualifiedNameComponents& components)
{
    auto addResult = m_cache.add<QNameComponentsTranslator>(components);
    Ref impl = **addResult.iterator;

    if (addResult.isNewEntry) {
        auto nodeNamespace = findNamespace(components.m_namespaceURI.get());
        auto nodeName = findNodeName(nodeNamespace, components.m_localName.get());
        updateImplWithNamespaceAndElementName(impl.get(), nodeNamespace, nodeName);
        return adoptRef(impl.get());
    }

    return Ref { impl.get() };
}

Ref<QualifiedName::QualifiedNameImpl> QualifiedNameCache::getOrCreate(const QualifiedNameComponents& components, Namespace nodeNamespace, NodeName nodeName)
{
    auto addResult = m_cache.add<QNameComponentsTranslator>(components);
    Ref impl = **addResult.iterator;

    if (addResult.isNewEntry) {
        updateImplWithNamespaceAndElementName(impl.get(), nodeNamespace, nodeName);
        return adoptRef(impl.get());
    }

    return Ref { impl.get() };
}

void QualifiedNameCache::remove(QualifiedName::QualifiedNameImpl& impl)
{
    m_cache.remove(&impl);
}

} // namespace WebCore

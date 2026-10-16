/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"

#include "MutationObserverRegistration.h"

#include "Document.h"
#include "NodeDocument.h"
#include "QualifiedName.h"
#include "WebCoreOpaqueRootInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MutationObserverRegistration);

Ref<MutationObserverRegistration> MutationObserverRegistration::create(MutationObserver& observer, Node& node, MutationObserverOptions options, const MemoryCompactLookupOnlyRobinHoodHashSet<AtomString>& attributeFilter)
{
    return adoptRef(*new MutationObserverRegistration(observer, node, options, attributeFilter));
}

MutationObserverRegistration::MutationObserverRegistration(MutationObserver& observer, Node& node, MutationObserverOptions options, const MemoryCompactLookupOnlyRobinHoodHashSet<AtomString>& attributeFilter)
    : m_observer(observer)
    , m_node(node)
    , m_options(options)
    , m_attributeFilter(attributeFilter)
{
    m_observer->observationStarted(*this);
}

MutationObserverRegistration::~MutationObserverRegistration()
{
    takeTransientRegistrations();
    m_observer->observationEnded(*this);
}

void MutationObserverRegistration::resetObservation(MutationObserverOptions options, const MemoryCompactLookupOnlyRobinHoodHashSet<AtomString>& attributeFilter)
{
    takeTransientRegistrations();
    m_options = options;
    m_attributeFilter = attributeFilter;
}

void MutationObserverRegistration::observedSubtreeNodeWillDetach(Node& node)
{
    if (!isSubtree())
        return;

    node.registerTransientMutationObserver(*this);
    m_observer->setHasTransientRegistration(protect(node.document()));

    if (m_transientRegistrationNodes.isEmpty()) {
        ASSERT(!m_nodeKeptAlive);
        m_nodeKeptAlive = m_node.ptr(); // Balanced in takeTransientRegistrations.
    }
    m_transientRegistrationNodes.add(node);
}

HashSet<GCReachableRef<Node>> MutationObserverRegistration::takeTransientRegistrations()
{
    if (m_transientRegistrationNodes.isEmpty()) {
        ASSERT(!m_nodeKeptAlive);
        return { };
    }

    for (auto& node : m_transientRegistrationNodes)
        protect(node.get())->unregisterTransientMutationObserver(*this);

    auto returnValue = std::exchange(m_transientRegistrationNodes, { });

    ASSERT(m_nodeKeptAlive);
    m_nodeKeptAlive = nullptr; // Balanced in observeSubtreeNodeWillDetach.

    return returnValue;
}

bool MutationObserverRegistration::shouldReceiveMutationFrom(Node& node, MutationObserverOptionType type, const QualifiedName* attributeName) const
{
    ASSERT((type == MutationObserverOptionType::Attributes && attributeName) || !attributeName);
    if (!m_options.contains(type))
        return false;

    if (m_node.ptr() != &node && !isSubtree())
        return false;

    if (type != MutationObserverOptionType::Attributes || !m_options.contains(MutationObserverOptionType::AttributeFilter))
        return true;

    if (!attributeName->namespaceURI().isNull())
        return false;

    return m_attributeFilter.contains(attributeName->localName());
}

bool MutationObserverRegistration::isReachableFromOpaqueRoots(JSC::AbstractSlotVisitor& visitor) const
{
    if (containsWebCoreOpaqueRoot(visitor, m_node->opaqueRoot()))
        return true;

    for (auto& node : m_transientRegistrationNodes) {
        if (containsWebCoreOpaqueRoot(visitor, node->opaqueRoot()))
            return true;
    }

    return false;
}

} // namespace WebCore

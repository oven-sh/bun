/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Peter Kelly (pmk@post.com)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007, 2009, 2010, 2012 Apple Inc. All rights reserved.
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
 */

#include "config.h"
#include "Attr.h"

#include "CommonAtomStrings.h"
#include "Document.h"
#include "ElementInlines.h"
#include "Event.h"
#include "HTMLNames.h"
#include "ScopedEventQueue.h"
#include "TextNodeTraversal.h"
#include "TreeScopeInlines.h"
#include "WebCoreOpaqueRootInlines.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/AtomString.h>

namespace JSC {
class AbstractSlotVisitor;
class SlotVisitor;
}

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Attr);

using namespace HTMLNames;

Attr::Attr(Element& element, const QualifiedName& name)
    : Node(element.document(), NodeType::Attribute, { })
    , m_element(element)
    , m_name(name)
{
}

Attr::Attr(Document& document, const QualifiedName& name, const AtomString& standaloneValue)
    : Node(document, NodeType::Attribute, { })
    , m_name(name)
    , m_standaloneValue(standaloneValue)
{
}

Ref<Attr> Attr::create(Element& element, const QualifiedName& name)
{
    return adoptRef(*new Attr(element, name));
}

Ref<Attr> Attr::create(Document& document, const QualifiedName& name, const AtomString& value)
{
    return adoptRef(*new Attr(document, name, value));
}

Attr::~Attr()
{
    ASSERT_WITH_SECURITY_IMPLICATION(!isInShadowTree());
    ASSERT_WITH_SECURITY_IMPLICATION(treeScope().rootNode().isDocumentNode());
}

ExceptionOr<void> Attr::setValue(const AtomString& value)
{
    assertIsOwnerThread();
    if (RefPtr element = m_element.get())
        element->setAttribute(qualifiedName(), value);
    else
        m_standaloneValue = value;

    return { };
}

ExceptionOr<void> Attr::setNodeValue(const String& value)
{
    return setValue(value.isNull() ? emptyAtom() : AtomString(value));
}

Ref<Node> Attr::cloneNodeInternal(Document& document, CloningOperation, CustomElementRegistry*) const
{
    return adoptRef(*new Attr(document, qualifiedName(), value()));
}

AtomString Attr::value() const
{
    assertIsOwnerThread();
    if (RefPtr element = m_element.get())
        return element->getAttributeForBindings(qualifiedName());
    return m_standaloneValue;
}

void Attr::detachFromElementWithValue(const AtomString& value)
{
    ASSERT(m_standaloneValue.isNull());
    m_standaloneValue = value;
    {
        Locker locker { m_elementLockForGC };
        ASSERT(m_element);
        m_element = nullptr;
    }
    setTreeScopeRecursively(Ref<Document> { document() });
}

void Attr::attachToElement(Element& element)
{
    {
        Locker locker { m_elementLockForGC };
        ASSERT(!m_element);
        m_element = &element;
    }
    m_standaloneValue = nullAtom();
    setTreeScopeRecursively(protect(element.treeScope()));
}

template<typename Visitor>
void Attr::visitOwnerElementInGCThread(Visitor& visitor)
{
    Locker locker { m_elementLockForGC };
    // Cannot ref on the GC thread.
    if (m_element)
        addWebCoreOpaqueRoot(visitor, m_element->opaqueRoot());
}

template void Attr::visitOwnerElementInGCThread(JSC::AbstractSlotVisitor&);
template void Attr::visitOwnerElementInGCThread(JSC::SlotVisitor&);

}

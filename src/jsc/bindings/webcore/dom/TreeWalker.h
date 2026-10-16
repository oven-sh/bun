/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 * Copyright (C) 2000 Frederik Holljen (frederik.holljen@hig.no)
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2004-2019 Apple Inc. All rights reserved.
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

#include "NodeFilter.h"
#include "ScriptWrappable.h"
#include "Traversal.h"
#include <wtf/Lock.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/ThreadAssertions.h>

namespace WebCore {

class WebCoreOpaqueRoot;
template<typename> class ExceptionOr;

class TreeWalker final : public ScriptWrappable, public RefCounted<TreeWalker>, public NodeIteratorBase {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(TreeWalker, WEBCORE_EXPORT);
public:
    static Ref<TreeWalker> create(Node& rootNode, unsigned long whatToShow, RefPtr<NodeFilter>&& filter)
    {
        return adoptRef(*new TreeWalker(rootNode, whatToShow, WTF::move(filter)));
    }                            

    Node& currentNode() { assertIsOwnerThread(); return m_current.get(); }
    const Node& currentNode() const { assertIsOwnerThread(); return m_current.get(); }

    WebCoreOpaqueRoot opaqueRootForCurrentNodeInGCThread() const;

    WEBCORE_EXPORT void setCurrentNode(Node&);

    WEBCORE_EXPORT ExceptionOr<Node*> parentNode();
    WEBCORE_EXPORT ExceptionOr<Node*> firstChild();
    WEBCORE_EXPORT ExceptionOr<Node*> lastChild();
    WEBCORE_EXPORT ExceptionOr<Node*> previousSibling();
    WEBCORE_EXPORT ExceptionOr<Node*> nextSibling();
    WEBCORE_EXPORT ExceptionOr<Node*> previousNode();
    WEBCORE_EXPORT ExceptionOr<Node*> nextNode();

private:
    TreeWalker(Node&, unsigned long whatToShow, RefPtr<NodeFilter>&&);

    enum class SiblingTraversalType { Previous, Next };
    template<SiblingTraversalType> ExceptionOr<Node*> traverseSiblings();

    Node* setCurrent(Ref<Node>&&);

    mutable Lock m_currentLock;
    // Only mutated on the main thread while holding m_currentLock, so main-thread reads use
    // assertIsOwnerThread() instead of locking; the GC thread must lock even to read.
    Ref<Node> m_current WTF_GUARDED_BY_LOCK(m_currentLock);
    WTF_DECLARE_OWNER_THREAD_ASSERTIONS(m_currentLock, anyThreadLike);
};

} // namespace WebCore

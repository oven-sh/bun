/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 * Copyright (C) 2000 Frederik Holljen (frederik.holljen@hig.no)
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2004, 2008 Apple Inc. All rights reserved.
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

#include "config.h"
#include "TreeWalker.h"

#include "ContainerNode.h"
#include "NodeTraversal.h"
#include "ScriptWrappableInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TreeWalker);

TreeWalker::TreeWalker(Node& rootNode, unsigned long whatToShow, RefPtr<NodeFilter>&& filter)
    : NodeIteratorBase(rootNode, whatToShow, WTF::move(filter))
    , m_current(root())
{
}

WebCoreOpaqueRoot TreeWalker::opaqueRootForCurrentNodeInGCThread() const
{
    Locker locker { m_currentLock };
    // Cannot ref in a GC thread.
    SUPPRESS_UNCOUNTED_LOCAL return m_current->opaqueRoot();
}

void TreeWalker::setCurrentNode(Node& node)
{
    Locker locker { m_currentLock };
    m_current = node;
}

inline Node* TreeWalker::setCurrent(Ref<Node>&& node)
{
    Locker locker { m_currentLock };
    m_current = WTF::move(node);
    return m_current.ptr();
}

ExceptionOr<Node*> TreeWalker::parentNode()
{
    assertIsOwnerThread();
    RefPtr node = m_current.ptr();
    while (node != &root()) {
        node = node->parentNode();
        if (!node)
            return nullptr;

        auto filterResult = acceptNode(*node);
        if (filterResult.hasException())
            return filterResult.releaseException();

        if (filterResult.returnValue() == NodeFilter::FILTER_ACCEPT)
            return setCurrent(node.releaseNonNull());
    }
    return nullptr;
}

ExceptionOr<Node*> TreeWalker::firstChild()
{
    assertIsOwnerThread();
    for (RefPtr node = m_current->firstChild(); node; ) {
        auto filterResult = acceptNode(*node);
        if (filterResult.hasException())
            return filterResult.releaseException();

        switch (filterResult.returnValue()) {
            case NodeFilter::FILTER_ACCEPT:
                return setCurrent(node.releaseNonNull());
            case NodeFilter::FILTER_SKIP:
                if (node->firstChild()) {
                    node = node->firstChild();
                    continue;
                }
                break;
            case NodeFilter::FILTER_REJECT:
                break;
        }
        do {
            if (node->nextSibling()) {
                node = node->nextSibling();
                break;
            }
            RefPtr parent = node->parentNode();
            if (!parent || parent == &root() || parent == m_current.ptr())
                return nullptr;
            node = WTF::move(parent);
        } while (node);
    }
    return nullptr;
}

ExceptionOr<Node*> TreeWalker::lastChild()
{
    assertIsOwnerThread();
    for (RefPtr node = m_current->lastChild(); node; ) {
        auto filterResult = acceptNode(*node);
        if (filterResult.hasException())
            return filterResult.releaseException();

        switch (filterResult.returnValue()) {
            case NodeFilter::FILTER_ACCEPT:
                return setCurrent(node.releaseNonNull());
            case NodeFilter::FILTER_SKIP:
                if (node->lastChild()) {
                    node = node->lastChild();
                    continue;
                }
                break;
            case NodeFilter::FILTER_REJECT:
                break;
        }
        do {
            if (node->previousSibling()) {
                node = node->previousSibling();
                break;
            }
            RefPtr parent = node->parentNode();
            if (!parent || parent == &root() || parent == m_current.ptr())
                return nullptr;
            node = WTF::move(parent);
        } while (node);
    }
    return nullptr;
}

template<TreeWalker::SiblingTraversalType type> ExceptionOr<Node*> TreeWalker::traverseSiblings()
{
    assertIsOwnerThread();
    RefPtr node = m_current.ptr();
    if (node == &root())
        return nullptr;

    auto isNext = type == SiblingTraversalType::Next;
    while (true) {
        for (RefPtr sibling = isNext ? node->nextSibling() : node->previousSibling(); sibling; ) {
            auto filterResult = acceptNode(*sibling);
            if (filterResult.hasException())
                return filterResult.releaseException();

            if (filterResult.returnValue() == NodeFilter::FILTER_ACCEPT)
                return setCurrent(sibling.releaseNonNull());
            node = sibling;
            sibling = isNext ? sibling->firstChild() : sibling->lastChild();
            if (filterResult.returnValue() == NodeFilter::FILTER_REJECT || !sibling)
                sibling = isNext ? node->nextSibling() : node->previousSibling();
        }
        node = node->parentNode();
        if (!node || node == &root())
            return nullptr;

        auto filterResult = acceptNode(*node);
        if (filterResult.hasException())
            return filterResult.releaseException();

        if (filterResult.returnValue() == NodeFilter::FILTER_ACCEPT)
            return nullptr;
    }
}

ExceptionOr<Node*> TreeWalker::previousSibling()
{
    return traverseSiblings<SiblingTraversalType::Previous>();
}

ExceptionOr<Node*> TreeWalker::nextSibling()
{
    return traverseSiblings<SiblingTraversalType::Next>();
}

ExceptionOr<Node*> TreeWalker::previousNode()
{
    assertIsOwnerThread();
    if (!filter()) {
        if (m_current.ptr() == &root())
            return nullptr;
        for (RefPtr node = NodeTraversal::previous(m_current); node; node = NodeTraversal::previous(*node)) {
            if (matchesWhatToShow(*node))
                return setCurrent(node.releaseNonNull());
            if (node == &root())
                break;
        }
        return nullptr;
    }
    RefPtr node = m_current.ptr();
    while (node != &root()) {
        while (RefPtr previousSibling = node->previousSibling()) {
            node = WTF::move(previousSibling);

            auto filterResult = acceptNode(*node);
            if (filterResult.hasException())
                return filterResult.releaseException();

            auto acceptNodeResult = filterResult.returnValue();
            if (acceptNodeResult == NodeFilter::FILTER_REJECT)
                continue;
            while (RefPtr lastChild = node->lastChild()) {
                node = WTF::move(lastChild);

                auto filterResult = acceptNode(*node);
                if (filterResult.hasException())
                    return filterResult.releaseException();

                acceptNodeResult = filterResult.returnValue();
                if (acceptNodeResult == NodeFilter::FILTER_REJECT)
                    break;
            }
            if (acceptNodeResult == NodeFilter::FILTER_ACCEPT)
                return setCurrent(node.releaseNonNull());
        }
        if (node == &root())
            return nullptr;
        RefPtr parent = node->parentNode();
        if (!parent)
            return nullptr;
        node = WTF::move(parent);

        auto filterResult = acceptNode(*node);
        if (filterResult.hasException())
            return filterResult.releaseException();

        if (filterResult.returnValue() == NodeFilter::FILTER_ACCEPT)
            return setCurrent(node.releaseNonNull());
    }
    return nullptr;
}

ExceptionOr<Node*> TreeWalker::nextNode()
{
    assertIsOwnerThread();
    if (!filter()) {
        for (RefPtr node = NodeTraversal::next(m_current, &root()); node; node = NodeTraversal::next(*node, &root())) {
            if (matchesWhatToShow(*node))
                return setCurrent(node.releaseNonNull());
        }
        return nullptr;
    }
    RefPtr node = m_current.ptr();
Children:
    while (RefPtr firstChild = node->firstChild()) {
        node = WTF::move(firstChild);

        auto filterResult = acceptNode(*node);
        if (filterResult.hasException())
            return filterResult.releaseException();

        if (filterResult.returnValue() == NodeFilter::FILTER_ACCEPT)
            return setCurrent(node.releaseNonNull());
        if (filterResult.returnValue() == NodeFilter::FILTER_REJECT)
            break;
    }
    while (RefPtr nextSibling = NodeTraversal::nextSkippingChildren(*node, &root())) {
        node = WTF::move(nextSibling);

        auto filterResult = acceptNode(*node);
        if (filterResult.hasException())
            return filterResult.releaseException();

        if (filterResult.returnValue() == NodeFilter::FILTER_ACCEPT)
            return setCurrent(node.releaseNonNull());
        if (filterResult.returnValue() == NodeFilter::FILTER_SKIP)
            goto Children;
    }
    return nullptr;
}

} // namespace WebCore

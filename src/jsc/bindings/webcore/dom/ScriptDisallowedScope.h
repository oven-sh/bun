/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
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

#include "ContainerNode.h"

namespace WebCore {

// The count is per VM and only kept when assertions are enabled: nothing else reads it.
class ScriptDisallowedScope {
public:
    ScriptDisallowedScope()
    {
#if ASSERT_ENABLED
        ++count();
#endif
    }

    ScriptDisallowedScope(const ScriptDisallowedScope&)
        : ScriptDisallowedScope()
    {
    }

    ~ScriptDisallowedScope()
    {
#if ASSERT_ENABLED
        ASSERT(count());
        --count();
#endif
    }

    ScriptDisallowedScope& operator=(const ScriptDisallowedScope&)
    {
        return *this;
    }

    static bool isScriptAllowedInMainThread()
    {
        return InMainThread::isScriptAllowed();
    }

    class InMainThread {
    public:
        InMainThread()
        {
#if ASSERT_ENABLED
            ++count();
#endif
        }

        ~InMainThread()
        {
#if ASSERT_ENABLED
            ASSERT(count());
            --count();
#endif
        }

        // Don't enable this assertion in release since it's O(n).
        static bool isEventDispatchAllowedInSubtree(Node& node)
        {
#if ASSERT_ENABLED
            return isScriptAllowed() || EventAllowedScope::isAllowedNode(node);
#else
            UNUSED_PARAM(node);
            return true;
#endif
        }

#if ASSERT_ENABLED
        static bool hasDisallowedScope()
        {
            return count();
        }
#endif

        static bool isScriptAllowed()
        {
#if ASSERT_ENABLED
            return !count();
#else
            return true;
#endif
        }
    };

#if ASSERT_ENABLED
    class EventAllowedScope {
    public:
        explicit EventAllowedScope(ContainerNode& userAgentContentRoot)
            : m_eventAllowedTreeRoot(userAgentContentRoot)
            , m_previousScope(currentScope())
        {
            setCurrentScope(this);
        }

        ~EventAllowedScope()
        {
            setCurrentScope(m_previousScope);
        }

        static bool isAllowedNode(Node& node)
        {
            return currentScope() && currentScope()->isAllowedNodeInternal(node);
        }

    private:
        bool isAllowedNodeInternal(Node& node)
        {
            return m_eventAllowedTreeRoot->contains(&node) || (m_previousScope && m_previousScope->isAllowedNodeInternal(node));
        }

        const Ref<ContainerNode> m_eventAllowedTreeRoot;

        EventAllowedScope* m_previousScope;
        static EventAllowedScope* currentScope();
        static void setCurrentScope(EventAllowedScope*);
    };
#else // not ASSERT_ENABLED
    class EventAllowedScope {
    public:
        explicit EventAllowedScope(ContainerNode&) { }
        static bool isAllowedNode(Node&) { return true; }
    };
#endif // not ASSERT_ENABLED

#if ASSERT_ENABLED
private:
    static unsigned& count();
#endif
};

} // namespace WebCore

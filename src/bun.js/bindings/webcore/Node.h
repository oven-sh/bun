/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2020 Apple Inc. All rights reserved.
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
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

#include "root.h"

#include "EventTarget.h"
#include "ExceptionOr.h"
#include <wtf/CompactUniquePtrTuple.h>
#include <wtf/FixedVector.h>
#include <wtf/Forward.h>
#include <wtf/ListHashSet.h>
#include <wtf/MainThread.h>
#include <wtf/OptionSet.h>
#include <wtf/URLHash.h>
#include <wtf/WeakPtr.h>
#include "EventTargetConcrete.h"

namespace WebCore {

// The full Node type is way too much stuff
// this ones just a baby
class Node : public RefPtr<Node>, CanMakeWeakPtr<Node>, public EventTarget {
    WTF_MAKE_TZONE_ALLOCATED(Node);

    static constexpr uint32_t s_refCountIncrement = 2;
    static constexpr uint32_t s_refCountMask = ~static_cast<uint32_t>(1);

public:
    void defaultEventHandler(Event&)
    {
        // do nothing
    }

    void handleEvent(ScriptExecutionContext&, Event&)
    {
    }

    bool hasEventTargetData()
    {
        return true;
    }

    void ref() const;
    void deref() const;
    bool hasOneRef() const;
    unsigned refCount() const;

    void removedLastRef() {}

    mutable uint32_t m_refCountAndParentBit { s_refCountIncrement };
    // mutable OptionSet<NodeFlag> m_nodeFlags;
};

ALWAYS_INLINE void Node::ref() const
{

    m_refCountAndParentBit += s_refCountIncrement;
}

ALWAYS_INLINE void Node::deref() const
{

    auto updatedRefCount = m_refCountAndParentBit - s_refCountIncrement;
    if (!updatedRefCount) {
        // Don't update m_refCountAndParentBit to avoid double destruction through use of Ref<T>/RefPtr<T>.
        // (This is a security mitigation in case of programmer error. It will ASSERT in debug builds.)

        const_cast<Node&>(*this).removedLastRef();
        return;
    }
    m_refCountAndParentBit = updatedRefCount;
}

ALWAYS_INLINE bool Node::hasOneRef() const
{

    return refCount() == 1;
}

ALWAYS_INLINE unsigned Node::refCount() const
{
    return m_refCountAndParentBit / s_refCountIncrement;
}

}

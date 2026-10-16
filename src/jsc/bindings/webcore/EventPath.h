/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 * Copyright (C) 2013-2017 Apple Inc. All rights reserved.
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

#pragma once

#include "EventContext.h"
#include <wtf/Forward.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>

namespace WebCore {
class EventPath;
}

namespace WTF {
template<typename T> struct IsDeprecatedWeakRefSmartPointerException;
template<> struct IsDeprecatedWeakRefSmartPointerException<WebCore::EventPath> : std::true_type {};
}

namespace WebCore {

class Touch;

class EventPath : public CanMakeSingleThreadWeakPtr<EventPath> {
public:
    EventPath(Node& origin, Event&);
    explicit EventPath(std::span<EventTarget* const>);
    explicit EventPath(EventTarget&);

    bool isEmpty() const { return m_path.isEmpty(); }
    size_t size() const { return m_path.size(); }
    const EventContext& contextAt(size_t i) const { return m_path[i]; }
    EventContext& contextAt(size_t i) { return m_path[i]; }
    const EventContext& last() const { return m_path.last(); }
    EventContext& last() { return m_path.last(); }

    void adjustForDisabledFormControl();

    Vector<Ref<EventTarget>> computePathUnclosedToTarget(const EventTarget&) const;

    static Node* eventTargetRespectingTargetRules(Node&);

private:
    void buildPath(Node& origin, Event&);
    void setRelatedTarget(Node& origin, Node&);

#if ENABLE(TOUCH_EVENTS)
    void retargetTouch(EventContext::TouchListType, const Touch&);
    void retargetTouchList(EventContext::TouchListType, const TouchList*);
    void retargetTouchLists(const TouchEvent&);
#endif

    Vector<EventContext, 32> m_path;
};

inline Node* EventPath::eventTargetRespectingTargetRules(Node& referenceNode)
{
    return &referenceNode;
}

} // namespace WebCore

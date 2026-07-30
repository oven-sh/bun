/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 * Copyright (C) 2013-2022 Apple Inc. All rights reserved.
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
#include "EventPath.h"

#include "Event.h"
#include "EventContext.h"
#include "EventNames.h"
#include <wtf/Vector.h>

namespace WebCore {

EventPath::EventPath(Node& originalTarget, Event& event)
{
}

// https://dom.spec.whatwg.org/#dom-event-composedpath
// Any node whose depth computed in EventPath::buildPath is greater than the context object is excluded.
// Because we can exit out of a closed shadow tree and re-enter another closed shadow tree via a slot,
// we decrease the *allowed depth* whenever we moved to a "shallower" (closer-to-document) tree.
Vector<Ref<EventTarget>> EventPath::computePathUnclosedToTarget(const EventTarget& target) const
{
    Vector<Ref<EventTarget>> path;
    auto pathSize = m_path.size();
    RELEASE_ASSERT(pathSize);
    path.reserveInitialCapacity(pathSize);

    auto currentTargetIndex = m_path.findIf([&target](auto& context) {
        return context.currentTarget() == &target;
    });
    RELEASE_ASSERT(currentTargetIndex != notFound);
    auto currentTargetDepth = m_path[currentTargetIndex].closedShadowDepth();

    auto appendTargetWithLesserDepth = [&path](const EventContext& currentContext, int& currentDepthAllowed) {
        auto depth = currentContext.closedShadowDepth();
        bool contextIsInsideInnerShadowTree = depth > currentDepthAllowed;
        if (contextIsInsideInnerShadowTree)
            return;
        bool movedOutOfShadowTree = depth < currentDepthAllowed;
        if (movedOutOfShadowTree)
            currentDepthAllowed = depth;
        path.append(*currentContext.currentTarget());
    };

    auto currentDepthAllowed = currentTargetDepth;
    auto i = currentTargetIndex;
    do {
        appendTargetWithLesserDepth(m_path[i], currentDepthAllowed);
    } while (i--);
    path.reverse();

    currentDepthAllowed = currentTargetDepth;
    for (auto i = currentTargetIndex + 1; i < pathSize; ++i)
        appendTargetWithLesserDepth(m_path[i], currentDepthAllowed);

    return path;
}

EventPath::EventPath(const Vector<EventTarget*>& targets)
{
    m_path = targets.map([&](auto* target) {
        ASSERT(target);
        return EventContext { EventContext::Type::Normal, nullptr, target, *targets.begin(), 0 };
    });
}

EventPath::EventPath(EventTarget& target)
{
    m_path = { EventContext { EventContext::Type::Normal, nullptr, &target, &target, 0 } };
}

}

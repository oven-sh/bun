/*
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies)
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Library General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Library General Public License for more details.
 *
 *  You should have received a copy of the GNU Library General Public License
 *  along with this library; see the file COPYING.LIB.  If not, write to
 *  the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 *  Boston, MA 02110-1301, USA.
 */

#pragma once

#include "EventTarget.h"
#include "EventTargetInterfaces.h"
#include "MediaList.h"

namespace WebCore {

// MediaQueryList interface is specified at https://drafts.csswg.org/cssom-view/#the-mediaquerylist-interface
// The objects of this class are returned by window.matchMedia.
// Nothing about the medium ever changes here, so the value is the one from the start and no change event is fired.

class MediaQueryList final : public RefCounted<MediaQueryList>, public EventTarget {
    WTF_MAKE_TZONE_ALLOCATED(MediaQueryList);
public:
    static Ref<MediaQueryList> create(ScriptExecutionContext&, MediaQueries&&);
    ~MediaQueryList();

    using RefCounted::ref;
    using RefCounted::deref;

    String media() const { return m_mediaQueries.text; }
    bool matches() const { return m_mediaQueries.matches; }

    void addListener(RefPtr<EventListener>&&);
    void removeListener(RefPtr<EventListener>&&);

private:
    MediaQueryList(ScriptExecutionContext&, MediaQueries&&);

    enum EventTargetInterfaceType eventTargetInterface() const final { return EventTargetInterfaceType::MediaQueryList; }
    ScriptExecutionContext* scriptExecutionContext() const final;
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    const Ref<ScriptExecutionContext> m_scriptExecutionContext;
    const MediaQueries m_mediaQueries;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::MediaQueryList)
    static bool isType(const WebCore::EventTarget& target) { return target.eventTargetInterface() == WebCore::EventTargetInterfaceType::MediaQueryList; }
SPECIALIZE_TYPE_TRAITS_END()

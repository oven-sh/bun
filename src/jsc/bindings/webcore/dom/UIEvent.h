/*
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2001 Tobias Anton (anton@stud.fbi.fh-darmstadt.de)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2003-2024 Apple Inc. All rights reserved.
 * Copyright (C) 2017 Google Inc. All rights reserved.
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

#include "Event.h"
#include "UIEventInit.h"

namespace WebCore {

class UIEvent : public Event {
    WTF_MAKE_TZONE_ALLOCATED(UIEvent);
public:
    static Ref<UIEvent> create(const AtomString& type, CanBubble canBubble, IsCancelable isCancelable, IsComposed isComposed, RefPtr<Window>&& view, int detail)
    {
        return adoptRef(*new UIEvent(EventInterfaceType::UIEvent, type, canBubble, isCancelable, isComposed, WTF::move(view), detail));
    }
    static Ref<UIEvent> createForBindings()
    {
        return adoptRef(*new UIEvent(EventInterfaceType::UIEvent));
    }
    static Ref<UIEvent> create(const AtomString& type, const UIEventInit& initializer, IsTrusted isTrusted = IsTrusted::No)
    {
        return adoptRef(*new UIEvent(EventInterfaceType::UIEvent, type, initializer, isTrusted));
    }
    virtual ~UIEvent();

    WEBCORE_EXPORT void initUIEvent(const AtomString& type, bool canBubble, bool cancelable, RefPtr<Window>&&, int detail);

    Window* view() const { return m_view.get(); }
    int detail() const { return m_detail; }

    virtual int layerX();
    virtual int layerY();

    virtual double screenX() const;
    virtual double screenY() const;
    virtual double pageX() const;
    virtual double pageY() const;
    virtual double clientX() const;
    virtual double clientY() const;

    virtual unsigned which() const;

protected:
    UIEvent(enum EventInterfaceType);

    UIEvent(enum EventInterfaceType, const AtomString& type, CanBubble, IsCancelable, IsComposed, RefPtr<Window>&&, int detail);
    UIEvent(enum EventInterfaceType, const AtomString& type, CanBubble, IsCancelable, IsComposed, MonotonicTime timestamp, RefPtr<Window>&&, int detail, IsTrusted = IsTrusted::Yes);
    UIEvent(enum EventInterfaceType, const AtomString&, const UIEventInit&, IsTrusted = IsTrusted::No);

private:
    bool isUIEvent() const final { return true; }

    RefPtr<Window> m_view;
    int m_detail;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENT_POLYMORPHIC(UIEvent)

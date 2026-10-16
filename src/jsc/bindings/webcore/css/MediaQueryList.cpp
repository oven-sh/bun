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

#include "config.h"
#include "MediaQueryList.h"

#include "EventNames.h"
#include "ScriptExecutionContext.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MediaQueryList);

MediaQueryList::MediaQueryList(ScriptExecutionContext& context, MediaQueries&& mediaQueries)
    : m_scriptExecutionContext(context)
    , m_mediaQueries(WTF::move(mediaQueries))
{
}

Ref<MediaQueryList> MediaQueryList::create(ScriptExecutionContext& context, MediaQueries&& mediaQueries)
{
    return adoptRef(*new MediaQueryList(context, WTF::move(mediaQueries)));
}

MediaQueryList::~MediaQueryList() = default;

void MediaQueryList::addListener(RefPtr<EventListener>&& listener)
{
    if (!listener)
        return;

    addEventListener(eventNames().changeEvent, listener.releaseNonNull());
}

void MediaQueryList::removeListener(RefPtr<EventListener>&& listener)
{
    if (!listener)
        return;

    removeEventListener(eventNames().changeEvent, *listener, { });
}

ScriptExecutionContext* MediaQueryList::scriptExecutionContext() const
{
    return m_scriptExecutionContext.ptr();
}

}

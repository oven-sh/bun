/*
 * Copyright (C) 2008 Apple Inc. All Rights Reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

#include "config.h"
#include "ActiveDOMObject.h"

#include "Event.h"
#include "EventTarget.h"
#include "ScriptExecutionContext.h"
#include <wtf/MainThread.h>

namespace WebCore {

ActiveDOMObject::ActiveDOMObject(ScriptExecutionContext* context)
    : ContextDestructionObserver(context)
{
    if (!context)
        return;

    ASSERT(context->isContextThread());
    context->didCreateActiveDOMObject(*this);
}

ActiveDOMObject::~ActiveDOMObject()
{
    ASSERT(canCurrentThreadIDAccessThreadLocalData(m_creationThreadID));

    // ActiveDOMObject may be inherited by a sub-class whose life-cycle
    // exceeds that of the associated ScriptExecutionContext. In those cases,
    // m_scriptExecutionContext would/should have been nullified by
    // ContextDestructionObserver::contextDestroyed() (which we implement /
    // inherit). Hence, we should ensure that this is not 0 before use it
    // here.
    RefPtr<ScriptExecutionContext> context = scriptExecutionContext();
    if (!context)
        return;

    ASSERT(m_suspendIfNeededWasCalled);
    ASSERT(context->isContextThread());
    context->willDestroyActiveDOMObject(*this);
}

void ActiveDOMObject::suspendIfNeeded()
{
#if ASSERT_ENABLED
    ASSERT(!m_suspendIfNeededWasCalled);
    m_suspendIfNeededWasCalled = true;
#endif
    if (RefPtr<ScriptExecutionContext> context = scriptExecutionContext())
        context->suspendActiveDOMObjectIfNeeded(*this);
}

#if ASSERT_ENABLED

void ActiveDOMObject::assertSuspendIfNeededWasCalled() const
{
    ASSERT(m_suspendIfNeededWasCalled);
}

#endif // ASSERT_ENABLED

void ActiveDOMObject::stop()
{
}

bool ActiveDOMObject::isContextStopped() const
{
    return !scriptExecutionContext() || scriptExecutionContext()->activeDOMObjectsAreStopped();
}

bool ActiveDOMObject::isAllowedToRunScript() const
{
    return scriptExecutionContext() && !scriptExecutionContext()->activeDOMObjectsAreStopped();
}

void ActiveDOMObject::queueTaskInEventLoop(TaskSource, Function<void()>&& function)
{
    RefPtr context = scriptExecutionContext();
    if (!context)
        return;
    context->postTask([function = WTF::move(function)](ScriptExecutionContext&) mutable {
        function();
    });
}

void ActiveDOMObject::queueTaskToDispatchEventInternal(EventTarget& target, TaskSource, Ref<Event>&& event)
{
    ASSERT(!event->target() || &target == event->target());
    RefPtr context = scriptExecutionContext();
    if (!context)
        return;
    context->postTask([activity = makePendingActivity(*this), target = Ref { target }, event = WTF::move(event)](ScriptExecutionContext&) {
        // If this task executes after the script execution context has been stopped, don't
        // actually dispatch the event.
        if (activity->object().isAllowedToRunScript())
            target->dispatchEvent(event);
    });
}

} // namespace WebCore

/*
 * Copyright (C) 2019 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "WorkerEventLoop.h"

#include "Microtasks.h"
#include "WorkerOrWorkletGlobalScope.h"

namespace WebCore {

Ref<WorkerEventLoop> WorkerEventLoop::create(WorkerOrWorkletGlobalScope& context)
{
    return adoptRef(*new WorkerEventLoop(context));
}

WorkerEventLoop::WorkerEventLoop(WorkerOrWorkletGlobalScope& context)
    : ContextDestructionObserver(&context)
{
}

WorkerEventLoop::~WorkerEventLoop()
{
}

void WorkerEventLoop::scheduleToRun()
{
    ASSERT(scriptExecutionContext());
    scriptExecutionContext()->postTask([eventLoop = Ref { *this }] (ScriptExecutionContext&) {
        eventLoop->run();
    });
}

bool WorkerEventLoop::isContextThread() const
{
    return scriptExecutionContext()->isContextThread();
}

MicrotaskQueue& WorkerEventLoop::microtaskQueue()
{
    ASSERT(scriptExecutionContext());
    if (!m_microtaskQueue)
        m_microtaskQueue = makeUnique<MicrotaskQueue>(scriptExecutionContext()->vm());
    return *m_microtaskQueue;
}

void WorkerEventLoop::clearMicrotaskQueue()
{
    m_microtaskQueue = nullptr;
}

} // namespace WebCore


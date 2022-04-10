/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
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
 */

#include "config.h"
#include "WorkerOrWorkletGlobalScope.h"

// #include "ScriptModuleLoader.h"
// #include "ServiceWorkerGlobalScope.h"
#include "WorkerEventLoop.h"
#include "WorkerInspectorController.h"
#include "WorkerOrWorkletScriptController.h"
#include "WorkerOrWorkletThread.h"
#include "WorkerRunLoop.h"
#include "WorkletGlobalScope.h"
#include <wtf/IsoMallocInlines.h>

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(WorkerOrWorkletGlobalScope);

WorkerOrWorkletGlobalScope::WorkerOrWorkletGlobalScope(WorkerThreadType type, Ref<JSC::VM>&& vm, WorkerOrWorkletThread* thread)
    // : m_script(makeUnique<WorkerOrWorkletScriptController>(type, WTFMove(vm), this))
    // , m_moduleLoader(makeUnique<ScriptModuleLoader>(*this, ScriptModuleLoader::OwnerType::WorkerOrWorklet))
    ,
    m_thread(thread), m_inspectorController(makeUnique<WorkerInspectorController>(*this))
{
}

WorkerOrWorkletGlobalScope::~WorkerOrWorkletGlobalScope() = default;

void WorkerOrWorkletGlobalScope::prepareForDestruction()
{
    if (m_defaultTaskGroup) {
        m_defaultTaskGroup->markAsReadyToStop();
        ASSERT(m_defaultTaskGroup->isStoppedPermanently());
    }

    stopActiveDOMObjects();

    // Event listeners would keep DOMWrapperWorld objects alive for too long. Also, they have references to JS objects,
    // which become dangling once Heap is destroyed.
    removeAllEventListeners();

    // MicrotaskQueue and RejectedPromiseTracker reference Heap.
    if (m_eventLoop)
        m_eventLoop->clearMicrotaskQueue();
    removeRejectedPromiseTracker();

    m_inspectorController->workerTerminating();
}

void WorkerOrWorkletGlobalScope::clearScript()
{
    m_script = nullptr;
}

JSC::VM& WorkerOrWorkletGlobalScope::vm()
{
    return script()->vm();
}

void WorkerOrWorkletGlobalScope::disableEval(const String& errorMessage)
{
    m_script->disableEval(errorMessage);
}

void WorkerOrWorkletGlobalScope::disableWebAssembly(const String& errorMessage)
{
    m_script->disableWebAssembly(errorMessage);
}

bool WorkerOrWorkletGlobalScope::isJSExecutionForbidden() const
{
    return !m_script || m_script->isExecutionForbidden();
}

EventLoopTaskGroup& WorkerOrWorkletGlobalScope::eventLoop()
{
    ASSERT(isContextThread());
    if (UNLIKELY(!m_defaultTaskGroup)) {
        m_eventLoop = WorkerEventLoop::create(*this);
        m_defaultTaskGroup = makeUnique<EventLoopTaskGroup>(*m_eventLoop);
        if (activeDOMObjectsAreStopped())
            m_defaultTaskGroup->stopAndDiscardAllTasks();
    }
    return *m_defaultTaskGroup;
}

bool WorkerOrWorkletGlobalScope::isContextThread() const
{
    auto* thread = workerOrWorkletThread();
    return thread && thread->thread() ? thread->thread() == &Thread::current() : isMainThread();
}

void WorkerOrWorkletGlobalScope::postTask(Task&& task)
{
    ASSERT(workerOrWorkletThread());
    workerOrWorkletThread()->runLoop().postTask(WTFMove(task));
}

} // namespace WebCore

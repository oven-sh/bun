/*
 * Copyright (c) 2011 Google Inc. All rights reserved.
 * Copyright (c) 2013-2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "WorkerDebugger.h"

#include "JSDOMExceptionHandling.h"
#include "Timer.h"
#include "WorkerOrWorkletGlobalScope.h"
#include "WorkerOrWorkletScriptController.h"
#include "WorkerRunLoop.h"
#include "WorkerThread.h"
#include <JavaScriptCore/VM.h>

namespace WebCore {

using namespace Inspector;

WorkerDebugger::WorkerDebugger(WorkerOrWorkletGlobalScope& context)
    : Debugger(context.script()->vm())
    , m_globalScope(context)
{
}

void WorkerDebugger::attachDebugger()
{
    JSC::Debugger::attachDebugger();

    m_globalScope.script()->attachDebugger(this);
}

void WorkerDebugger::detachDebugger(bool isBeingDestroyed)
{
    JSC::Debugger::detachDebugger(isBeingDestroyed);

    if (m_globalScope.script())
        m_globalScope.script()->detachDebugger(this);
    if (!isBeingDestroyed)
        recompileAllJSFunctions();
}

void WorkerDebugger::recompileAllJSFunctions()
{
    JSC::JSLockHolder lock(vm());
    JSC::Debugger::recompileAllJSFunctions();
}

void WorkerDebugger::runEventLoopWhilePaused()
{
    JSC::Debugger::runEventLoopWhilePaused();

    TimerBase::fireTimersInNestedEventLoop();

    // FIXME: Add support for pausing workers running on the main thread.
    if (!is<WorkerDedicatedRunLoop>(m_globalScope.workerOrWorkletThread()->runLoop()))
        return;

    MessageQueueWaitResult result;
    do {
        result = downcast<WorkerDedicatedRunLoop>(m_globalScope.workerOrWorkletThread()->runLoop()).runInDebuggerMode(m_globalScope);
    } while (result != MessageQueueTerminated && !doneProcessingDebuggerEvents());
}

void WorkerDebugger::reportException(JSC::JSGlobalObject* exec, JSC::Exception* exception) const
{
    JSC::Debugger::reportException(exec, exception);

    WebCore::reportException(exec, exception);
}

} // namespace WebCore

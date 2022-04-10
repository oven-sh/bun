/*
 * Copyright (C) 2009 Google Inc. All rights reserved.
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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
#include "DedicatedWorkerThread.h"

#include "DedicatedWorkerGlobalScope.h"
#include "SecurityOrigin.h"
#include "WorkerObjectProxy.h"

namespace WebCore {

DedicatedWorkerThread::DedicatedWorkerThread(const WorkerParameters& params, const ScriptBuffer& sourceCode, WorkerLoaderProxy& workerLoaderProxy, WorkerDebuggerProxy& workerDebuggerProxy, WorkerObjectProxy& workerObjectProxy, WorkerThreadStartMode startMode, const SecurityOrigin& topOrigin, IDBClient::IDBConnectionProxy* connectionProxy, SocketProvider* socketProvider, JSC::RuntimeFlags runtimeFlags)
    : WorkerThread(params, sourceCode, workerLoaderProxy, workerDebuggerProxy, workerObjectProxy, startMode, topOrigin, connectionProxy, socketProvider, runtimeFlags)
    , m_workerObjectProxy(workerObjectProxy)
{
}

DedicatedWorkerThread::~DedicatedWorkerThread() = default;

Ref<WorkerGlobalScope> DedicatedWorkerThread::createWorkerGlobalScope(const WorkerParameters& params, /*Ref<SecurityOrigin>&& origin,*/ Ref<SecurityOrigin>&& topOrigin)
{
    return DedicatedWorkerGlobalScope::create(params, WTFMove(origin), *this, WTFMove(topOrigin), idbConnectionProxy(), socketProvider());
}

void DedicatedWorkerThread::runEventLoop()
{
    // Notify the parent object of our current active state before calling the superclass to run the event loop.
    m_workerObjectProxy.reportPendingActivity(globalScope()->hasPendingActivity());
    WorkerThread::runEventLoop();
}

} // namespace WebCore

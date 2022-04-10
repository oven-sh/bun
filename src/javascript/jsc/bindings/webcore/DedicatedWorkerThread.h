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

#pragma once

#include "WorkerThread.h"

namespace WebCore {

class ContentSecurityPolicyResponseHeaders;
class ScriptBuffer;
class WorkerObjectProxy;

class DedicatedWorkerThread : public WorkerThread {
public:
    template<typename... Args> static Ref<DedicatedWorkerThread> create(Args&&... args)
    {
        return adoptRef(*new DedicatedWorkerThread(std::forward<Args>(args)...));
    }
    virtual ~DedicatedWorkerThread();

    WorkerObjectProxy& workerObjectProxy() const { return m_workerObjectProxy; }
    void start() { WorkerThread::start(nullptr); }

protected:
    Ref<WorkerGlobalScope> createWorkerGlobalScope(const WorkerParameters&, Ref<SecurityOrigin>&&, Ref<SecurityOrigin>&& topOrigin) override;
    void runEventLoop() override;

private:
    DedicatedWorkerThread(const WorkerParameters&, const ScriptBuffer& sourceCode, WorkerLoaderProxy&, WorkerDebuggerProxy&, WorkerObjectProxy&, WorkerThreadStartMode, const SecurityOrigin& topOrigin, IDBClient::IDBConnectionProxy*, SocketProvider*, JSC::RuntimeFlags);

    ASCIILiteral threadName() const final { return "WebCore: Worker"_s; }

    WorkerObjectProxy& m_workerObjectProxy;
};

} // namespace WebCore

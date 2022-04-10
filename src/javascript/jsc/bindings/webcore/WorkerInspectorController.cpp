/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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
#include "WorkerInspectorController.h"

#include "CommandLineAPIHost.h"
#include "InstrumentingAgents.h"
#include "JSExecState.h"
#include "WebHeapAgent.h"
#include "WebInjectedScriptHost.h"
#include "WebInjectedScriptManager.h"
#include "WorkerAuditAgent.h"
#include "WorkerConsoleAgent.h"
#include "WorkerDOMDebuggerAgent.h"
#include "WorkerDebuggerAgent.h"
#include "WorkerNetworkAgent.h"
#include "WorkerOrWorkletGlobalScope.h"
#include "WorkerRuntimeAgent.h"
#include "WorkerThread.h"
#include "WorkerToPageFrontendChannel.h"
#include <JavaScriptCore/InspectorAgentBase.h>
#include <JavaScriptCore/InspectorBackendDispatcher.h>
#include <JavaScriptCore/InspectorFrontendChannel.h>
#include <JavaScriptCore/InspectorFrontendDispatchers.h>
#include <JavaScriptCore/InspectorFrontendRouter.h>

#if ENABLE(SERVICE_WORKER)
#include "InspectorClient.h"
#include "InspectorController.h"
#include "Page.h"
#include "ServiceWorkerAgent.h"
#include "ServiceWorkerGlobalScope.h"
#endif

namespace WebCore {

using namespace JSC;
using namespace Inspector;

WorkerInspectorController::WorkerInspectorController(WorkerOrWorkletGlobalScope& globalScope)
    : m_instrumentingAgents(InstrumentingAgents::create(*this))
    , m_injectedScriptManager(makeUnique<WebInjectedScriptManager>(*this, WebInjectedScriptHost::create()))
    , m_frontendRouter(FrontendRouter::create())
    , m_backendDispatcher(BackendDispatcher::create(m_frontendRouter.copyRef()))
    , m_executionStopwatch(Stopwatch::create())
    , m_debugger(globalScope)
    , m_globalScope(globalScope)
{
    ASSERT(globalScope.isContextThread());

    auto workerContext = workerAgentContext();

    auto consoleAgent = makeUnique<WorkerConsoleAgent>(workerContext);
    m_instrumentingAgents->setWebConsoleAgent(consoleAgent.get());
    m_agents.append(WTFMove(consoleAgent));
}

WorkerInspectorController::~WorkerInspectorController()
{
    ASSERT(!m_frontendRouter->hasFrontends());
    ASSERT(!m_forwardingChannel);

    m_instrumentingAgents->reset();
}

void WorkerInspectorController::workerTerminating()
{
    m_injectedScriptManager->disconnect();

    disconnectFrontend(Inspector::DisconnectReason::InspectedTargetDestroyed);

    m_agents.discardValues();
}

void WorkerInspectorController::connectFrontend()
{
    ASSERT(!m_frontendRouter->hasFrontends());
    ASSERT(!m_forwardingChannel);

    createLazyAgents();

    callOnMainThread([] {
        InspectorInstrumentation::frontendCreated();
    });

    m_executionStopwatch->reset();
    m_executionStopwatch->start();

    m_forwardingChannel = makeUnique<WorkerToPageFrontendChannel>(m_globalScope);
    m_frontendRouter->connectFrontend(*m_forwardingChannel.get());
    m_agents.didCreateFrontendAndBackend(&m_frontendRouter.get(), &m_backendDispatcher.get());

#if ENABLE(SERVICE_WORKER)
    updateServiceWorkerPageFrontendCount();
#endif
}

void WorkerInspectorController::disconnectFrontend(Inspector::DisconnectReason reason)
{
    if (!m_frontendRouter->hasFrontends())
        return;

    ASSERT(m_forwardingChannel);

    callOnMainThread([] {
        InspectorInstrumentation::frontendDeleted();
    });

    m_agents.willDestroyFrontendAndBackend(reason);
    m_frontendRouter->disconnectFrontend(*m_forwardingChannel.get());
    m_forwardingChannel = nullptr;

#if ENABLE(SERVICE_WORKER)
    updateServiceWorkerPageFrontendCount();
#endif
}

#if ENABLE(SERVICE_WORKER)
void WorkerInspectorController::updateServiceWorkerPageFrontendCount()
{
    if (!is<ServiceWorkerGlobalScope>(m_globalScope))
        return;

    auto serviceWorkerPage = downcast<ServiceWorkerGlobalScope>(m_globalScope).serviceWorkerPage();
    if (!serviceWorkerPage)
        return;

    ASSERT(isMainThread());

    // When a service worker is loaded in a Page, we need to report its inspector frontend count
    // up to the page's inspectorController so the client knows about it.
    auto inspectorClient = serviceWorkerPage->inspectorController().inspectorClient();
    if (!inspectorClient)
        return;

    inspectorClient->frontendCountChanged(m_frontendRouter->frontendCount());
}
#endif

void WorkerInspectorController::dispatchMessageFromFrontend(const String& message)
{
    m_backendDispatcher->dispatch(message);
}

WorkerAgentContext WorkerInspectorController::workerAgentContext()
{
    AgentContext baseContext = {
        *this,
        *m_injectedScriptManager,
        m_frontendRouter.get(),
        m_backendDispatcher.get(),
    };

    WebAgentContext webContext = {
        baseContext,
        m_instrumentingAgents.get(),
    };

    WorkerAgentContext workerContext = {
        webContext,
        m_globalScope,
    };

    return workerContext;
}

void WorkerInspectorController::createLazyAgents()
{
    if (m_didCreateLazyAgents)
        return;

    m_didCreateLazyAgents = true;

    m_injectedScriptManager->connect();

    auto workerContext = workerAgentContext();

    m_agents.append(makeUnique<WorkerRuntimeAgent>(workerContext));

#if ENABLE(SERVICE_WORKER)
    if (is<ServiceWorkerGlobalScope>(m_globalScope)) {
        m_agents.append(makeUnique<ServiceWorkerAgent>(workerContext));
        m_agents.append(makeUnique<WorkerNetworkAgent>(workerContext));
    }
#endif

    m_agents.append(makeUnique<WebHeapAgent>(workerContext));

    auto debuggerAgent = makeUnique<WorkerDebuggerAgent>(workerContext);
    auto debuggerAgentPtr = debuggerAgent.get();
    m_agents.append(WTFMove(debuggerAgent));

    m_agents.append(makeUnique<WorkerDOMDebuggerAgent>(workerContext, debuggerAgentPtr));
    m_agents.append(makeUnique<WorkerAuditAgent>(workerContext));

    if (auto& commandLineAPIHost = m_injectedScriptManager->commandLineAPIHost())
        commandLineAPIHost->init(m_instrumentingAgents.copyRef());
}

InspectorFunctionCallHandler WorkerInspectorController::functionCallHandler() const
{
    return WebCore::functionCallHandlerFromAnyThread;
}

InspectorEvaluateHandler WorkerInspectorController::evaluateHandler() const
{
    return WebCore::evaluateHandlerFromAnyThread;
}

VM& WorkerInspectorController::vm()
{
    return m_globalScope.vm();
}

} // namespace WebCore

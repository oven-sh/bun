/*
 * Copyright (C) 2014, 2015 Apple Inc. All rights reserved.
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

#pragma once

#include <JavaScriptCore/InspectorAgentRegistry.h>
#include <JavaScriptCore/InspectorEnvironment.h>
#include <JavaScriptCore/InspectorFrontendRouter.h>
#include <JavaScriptCore/Strong.h>
#include <wtf/Forward.h>
#include <wtf/Noncopyable.h>
#include <wtf/text/WTFString.h>

#if ENABLE(INSPECTOR_ALTERNATE_DISPATCHERS)
#include <AugmentableInspectorController.h>
#endif

namespace JSC {
class CallFrame;
class ConsoleClient;
class Exception;
class JSGlobalObject;
}

namespace Inspector {

class BackendDispatcher;
class FrontendChannel;
class InjectedScriptManager;
class InspectorAgent;
class InspectorConsoleAgent;
class InspectorDebuggerAgent;
class InspectorScriptProfilerAgent;
class JSGlobalObjectConsoleClient;
class JSGlobalObjectDebugger;
class ScriptCallStack;
struct JSAgentContext;

class JSGlobalObjectInspectorController final
    : public InspectorEnvironment
#if ENABLE(INSPECTOR_ALTERNATE_DISPATCHERS)
    ,
      public AugmentableInspectorController
#endif
{
    WTF_MAKE_NONCOPYABLE(JSGlobalObjectInspectorController);
    WTF_MAKE_FAST_ALLOCATED;

public:
    JSGlobalObjectInspectorController(JSC::JSGlobalObject&);
    ~JSGlobalObjectInspectorController() final;

    void connectFrontend(FrontendChannel&, bool isAutomaticInspection, bool immediatelyPause);
    void disconnectFrontend(FrontendChannel&);

    void dispatchMessageFromFrontend(const String&);

    void globalObjectDestroyed();

    bool includesNativeCallStackWhenReportingExceptions() const { return m_includeNativeCallStackWithExceptions; }
    void setIncludesNativeCallStackWhenReportingExceptions(bool includesNativeCallStack) { m_includeNativeCallStackWithExceptions = includesNativeCallStack; }

    void reportAPIException(JSC::JSGlobalObject*, JSC::Exception*);

    WeakPtr<JSC::ConsoleClient> consoleClient() const;

    bool developerExtrasEnabled() const final;
    bool canAccessInspectedScriptState(JSC::JSGlobalObject*) const final { return true; }
    InspectorFunctionCallHandler functionCallHandler() const final;
    InspectorEvaluateHandler evaluateHandler() const final;
    void frontendInitialized() final;
    WTF::Stopwatch& executionStopwatch() const final;
    JSC::Debugger* debugger() final;
    JSC::VM& vm() final;

#if ENABLE(INSPECTOR_ALTERNATE_DISPATCHERS)
    AugmentableInspectorControllerClient* augmentableInspectorControllerClient() const final
    {
        return m_augmentingClient;
    }
    void setAugmentableInspectorControllerClient(AugmentableInspectorControllerClient* client) final { m_augmentingClient = client; }

    const FrontendRouter& frontendRouter() const final { return m_frontendRouter.get(); }
    BackendDispatcher& backendDispatcher() final { return m_backendDispatcher.get(); }
    void registerAlternateAgent(std::unique_ptr<InspectorAgentBase>) final;
#endif

private:
    void appendAPIBacktrace(ScriptCallStack&);

    InspectorAgent& ensureInspectorAgent();
    InspectorDebuggerAgent& ensureDebuggerAgent();

    JSAgentContext jsAgentContext();
    void createLazyAgents();

    JSC::JSGlobalObject& m_globalObject;
    std::unique_ptr<InjectedScriptManager> m_injectedScriptManager;
    std::unique_ptr<JSGlobalObjectConsoleClient> m_consoleClient;
    Ref<WTF::Stopwatch> m_executionStopwatch;
    std::unique_ptr<JSGlobalObjectDebugger> m_debugger;

    AgentRegistry m_agents;
    InspectorConsoleAgent* m_consoleAgent { nullptr };

    // Lazy, but also on-demand agents.
    InspectorAgent* m_inspectorAgent { nullptr };
    InspectorDebuggerAgent* m_debuggerAgent { nullptr };

    Ref<FrontendRouter> m_frontendRouter;
    Ref<BackendDispatcher> m_backendDispatcher;

    // Used to keep the JSGlobalObject and VM alive while we are debugging it.
    JSC::Strong<JSC::JSGlobalObject> m_strongGlobalObject;
    RefPtr<JSC::VM> m_strongVM;

    bool m_includeNativeCallStackWithExceptions { true };
    bool m_isAutomaticInspection { false };
    bool m_pauseAfterInitialization { false };
    bool m_didCreateLazyAgents { false };

#if ENABLE(INSPECTOR_ALTERNATE_DISPATCHERS)
    AugmentableInspectorControllerClient* m_augmentingClient { nullptr };
#endif
};

} // namespace Inspector

#pragma once

#include "root.h"
#include <JavaScriptCore/AlternateDispatchableAgent.h>
#include <JavaScriptCore/InspectorAgentBase.h>
#include <JavaScriptCore/InspectorBackendDispatchers.h>
#include <JavaScriptCore/InspectorFrontendDispatchers.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/Forward.h>
#include <wtf/Noncopyable.h>

namespace Inspector {

class FrontendRouter;
class BackendDispatcher;
class TestReporterFrontendDispatcher;
enum class DisconnectReason;

class InspectorTestReporterAgent final : public InspectorAgentBase, public Inspector::TestReporterBackendDispatcherHandler {
    WTF_MAKE_NONCOPYABLE(InspectorTestReporterAgent);

public:
    InspectorTestReporterAgent(JSC::JSGlobalObject&);
    virtual ~InspectorTestReporterAgent();

    // InspectorAgentBase
    virtual void didCreateFrontendAndBackend(FrontendRouter*, BackendDispatcher*) final;
    virtual void willDestroyFrontendAndBackend(DisconnectReason) final;

    // TestReporterBackendDispatcherHandler
    virtual Protocol::ErrorStringOr<void> enable() final;
    virtual Protocol::ErrorStringOr<void> disable() final;

    // Public API for reporting test events
    void reportTestFound(JSC::CallFrame*, int testId, const String& name);
    void reportTestStart(int testId);
    void reportTestEnd(int testId, Protocol::TestReporter::TestStatus status, double elapsed);

private:
    JSC::JSGlobalObject& m_globalObject;
    std::unique_ptr<TestReporterFrontendDispatcher> m_frontendDispatcher;
    Ref<TestReporterBackendDispatcher> m_backendDispatcher;
    bool m_enabled { false };
};

} // namespace Inspector

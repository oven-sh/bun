#pragma once

#include "root.h"
#include <JavaScriptCore/AlternateDispatchableAgent.h>
#include <JavaScriptCore/InspectorAgentBase.h>
#include <JavaScriptCore/InspectorBackendDispatchers.h>
#include <JavaScriptCore/InspectorFrontendDispatchers.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/Forward.h>
#include <wtf/Noncopyable.h>
#include "headers-handwritten.h"
namespace Inspector {

class FrontendRouter;
class BackendDispatcher;
class LifecycleReporterFrontendDispatcher;
enum class DisconnectReason;

class InspectorLifecycleAgent final : public InspectorAgentBase, public Inspector::LifecycleReporterBackendDispatcherHandler {
    WTF_MAKE_NONCOPYABLE(InspectorLifecycleAgent);

public:
    InspectorLifecycleAgent(JSC::JSGlobalObject&);
    virtual ~InspectorLifecycleAgent();

    // InspectorAgentBase
    virtual void didCreateFrontendAndBackend(FrontendRouter*, BackendDispatcher*) final;
    virtual void willDestroyFrontendAndBackend(DisconnectReason) final;

    // LifecycleReporterBackendDispatcherHandler
    virtual Protocol::ErrorStringOr<void> enable() final;
    virtual Protocol::ErrorStringOr<void> disable() final;

    // Public API
    void reportReload();
    void reportError(ZigException&);
    Protocol::ErrorStringOr<void> preventExit();
    Protocol::ErrorStringOr<void> stopPreventingExit();

private:
    JSC::JSGlobalObject& m_globalObject;
    std::unique_ptr<LifecycleReporterFrontendDispatcher> m_frontendDispatcher;
    Ref<LifecycleReporterBackendDispatcher> m_backendDispatcher;
    bool m_enabled { false };
    bool m_preventingExit { false };
};

} // namespace Inspector

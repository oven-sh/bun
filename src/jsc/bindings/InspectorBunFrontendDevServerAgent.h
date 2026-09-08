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
class BunFrontendDevServerFrontendDispatcher;

class InspectorBunFrontendDevServerAgent final : public InspectorAgentBase, public Inspector::BunFrontendDevServerBackendDispatcherHandler {
    WTF_MAKE_NONCOPYABLE(InspectorBunFrontendDevServerAgent);
    WTF_MAKE_TZONE_ALLOCATED(InspectorBunFrontendDevServerAgent);

public:
    InspectorBunFrontendDevServerAgent(JSC::JSGlobalObject&);
    virtual ~InspectorBunFrontendDevServerAgent() final;

    // InspectorAgentBase
    virtual void didCreateFrontendAndBackend() final;
    virtual void willDestroyFrontendAndBackend(DisconnectReason) final;

    // BunFrontendDevServerBackendDispatcherHandler
    virtual Protocol::ErrorStringOr<void> enable() final;
    virtual Protocol::ErrorStringOr<void> disable() final;

    // Public API for events
    void clientConnected(int devServerId, int connectionId);
    void clientDisconnected(int devServerId, int connectionId);
    void bundleStart(int devServerId, Ref<JSON::ArrayOf<String>>&& triggerFiles);
    void bundleComplete(int devServerId, double durationMs);
    void bundleFailed(int devServerId, const String& buildErrorsPayloadBase64);
    void clientNavigated(int devServerId, int connectionId, const String& url, std::optional<int> routeBundleId);
    void consoleLog(int devServerId, char kind, const String& data);

private:
    std::unique_ptr<BunFrontendDevServerFrontendDispatcher> m_frontendDispatcher;
    Ref<BunFrontendDevServerBackendDispatcher> m_backendDispatcher;
    bool m_enabled { false };
};

} // namespace Inspector

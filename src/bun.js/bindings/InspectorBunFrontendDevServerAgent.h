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
class BunFrontendDevServerFrontendDispatcher;

class InspectorBunFrontendDevServerAgent final : public InspectorAgentBase, public Inspector::BunFrontendDevServerBackendDispatcherHandler {
    WTF_MAKE_NONCOPYABLE(InspectorBunFrontendDevServerAgent);
    WTF_MAKE_TZONE_ALLOCATED(InspectorBunFrontendDevServerAgent);

public:
    InspectorBunFrontendDevServerAgent(JSC::JSGlobalObject&);
    virtual ~InspectorBunFrontendDevServerAgent() final;

    // InspectorAgentBase
    virtual void didCreateFrontendAndBackend(FrontendRouter*, BackendDispatcher*) final;
    virtual void willDestroyFrontendAndBackend(DisconnectReason) final;

    // BunFrontendDevServerBackendDispatcherHandler
    virtual Protocol::ErrorStringOr<void> enable() final;
    virtual Protocol::ErrorStringOr<void> disable() final;

    // Public API for events
    void clientConnected(int connectionId);
    void clientDisconnected(int connectionId);
    void bundleStart(Ref<JSON::ArrayOf<String>>&& triggerFiles, int buildId);
    void bundleComplete(double durationMs, int buildId);
    void bundleFailed(const String& buildErrorsPayloadBase64, int buildId);
    void clientNavigated(int connectionId, const String& url, std::optional<int> routeBundleId);
    void clientErrorReported(const String& clientErrorPayloadBase64);
    void graphUpdate(const String& visualizerPayloadBase64);

private:
    // JSC::JSGlobalObject& m_globalobject;
    std::unique_ptr<BunFrontendDevServerFrontendDispatcher> m_frontendDispatcher;
    Ref<BunFrontendDevServerBackendDispatcher> m_backendDispatcher;
    bool m_enabled { false };
};

// C API for Zig to call
extern "C" {
void BunFrontendDevServerAgent__notifyClientConnected(InspectorBunFrontendDevServerAgent* agent, int connectionId);
void BunFrontendDevServerAgent__notifyClientDisconnected(InspectorBunFrontendDevServerAgent* agent, int connectionId);
void BunFrontendDevServerAgent__notifyBundleStart(InspectorBunFrontendDevServerAgent* agent, const BunString* triggerFiles, size_t triggerFilesLen, int buildId);
void BunFrontendDevServerAgent__notifyBundleComplete(InspectorBunFrontendDevServerAgent* agent, double durationMs, int buildId);
void BunFrontendDevServerAgent__notifyBundleFailed(InspectorBunFrontendDevServerAgent* agent, const BunString* buildErrorsPayloadBase64, int buildId);
void BunFrontendDevServerAgent__notifyClientNavigated(InspectorBunFrontendDevServerAgent* agent, int connectionId, const BunString* url, int routeBundleId);
void BunFrontendDevServerAgent__notifyClientErrorReported(InspectorBunFrontendDevServerAgent* agent, const BunString* clientErrorPayloadBase64);
void BunFrontendDevServerAgent__notifyGraphUpdate(InspectorBunFrontendDevServerAgent* agent, const BunString* visualizerPayloadBase64);
}

} // namespace Inspector

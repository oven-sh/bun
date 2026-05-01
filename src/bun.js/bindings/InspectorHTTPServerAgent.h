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
class HTTPServerFrontendDispatcher;
enum class DisconnectReason;

using AnyServerPtr = void*;

class InspectorHTTPServerAgent final : public InspectorAgentBase, public Inspector::HTTPServerBackendDispatcherHandler {
    WTF_MAKE_NONCOPYABLE(InspectorHTTPServerAgent);
    WTF_MAKE_TZONE_ALLOCATED(InspectorHTTPServerAgent);

public:
    InspectorHTTPServerAgent(JSC::JSGlobalObject&);
    virtual ~InspectorHTTPServerAgent();

    // InspectorAgentBase
    virtual void didCreateFrontendAndBackend() final;
    virtual void willDestroyFrontendAndBackend(DisconnectReason) final;

    // HTTPServerBackendDispatcherHandler
    virtual Inspector::CommandResult<void> enable() final;
    virtual Inspector::CommandResult<void> disable() final;
    virtual Inspector::CommandResult<void> startListening(int serverId) final;
    virtual Inspector::CommandResult<void> stopListening(int serverId) final;
    virtual Inspector::CommandResult<void> getRequestBody(int requestId, int serverId) final;
    virtual Inspector::CommandResult<void> getResponseBody(int requestId, int serverId) final;

    // Events API
    void serverStarted(int serverId, const String& url, double startTime, AnyServerPtr serverInstance);
    void serverStopped(int serverId, double timestamp);
    void serverRoutesUpdated(int serverId, int hotReloadId, Ref<JSON::ArrayOf<Protocol::HTTPServer::Route>>&& routes);
    void requestWillBeSent(Ref<Protocol::HTTPServer::Request>&& request);
    void responseReceived(Ref<Protocol::HTTPServer::Response>&& response);
    void bodyChunkReceived(Ref<Protocol::HTTPServer::BodyChunk>&& chunk);
    void requestFinished(int requestId, int serverId, double timestamp, std::optional<double>&& opt_duration);
    void requestHandlerException(Ref<Protocol::HTTPServer::RequestHandlerError>&& error);

private:
    WTF::HashMap<int, AnyServerPtr> m_serverIdToServerInstance;
    std::unique_ptr<HTTPServerFrontendDispatcher> m_frontendDispatcher;
    Ref<HTTPServerBackendDispatcher> m_backendDispatcher;
    bool m_enabled { false };
};

} // namespace Inspector

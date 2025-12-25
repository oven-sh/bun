#include "InspectorHTTPServerAgent.h"

#include <JavaScriptCore/InspectorFrontendRouter.h>
#include <JavaScriptCore/InspectorBackendDispatcher.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include <wtf/TZoneMallocInlines.h>
#include "ZigGlobalObject.h"

namespace Inspector {

WTF_MAKE_TZONE_ALLOCATED_IMPL(InspectorHTTPServerAgent);

// Zig bindings implementation
extern "C" {
void Bun__HTTPServerAgent__setEnabled(Inspector::InspectorHTTPServerAgent* agent);

// void Bun__HTTPServerAgentStartListening(Inspector::InspectorHTTPServerAgent* agent, int serverId);
// void Bun__HTTPServerAgentStopListening(Inspector::InspectorHTTPServerAgent* agent, int serverId);
// void Bun__HTTPServerAgentGetRequestBody(Inspector::InspectorHTTPServerAgent* agent, int requestId, int serverId);
// void Bun__HTTPServerAgentGetResponseBody(Inspector::InspectorHTTPServerAgent* agent, int requestId, int serverId);
}

InspectorHTTPServerAgent::InspectorHTTPServerAgent(JSC::JSGlobalObject& globalObject)
    : InspectorAgentBase("HTTPServer"_s)
    , m_backendDispatcher(HTTPServerBackendDispatcher::create(globalObject.inspectorController().backendDispatcher(), this))
    , m_frontendDispatcher(makeUnique<HTTPServerFrontendDispatcher>(const_cast<FrontendRouter&>(globalObject.inspectorController().frontendRouter())))
    , m_enabled(false)
{
}

InspectorHTTPServerAgent::~InspectorHTTPServerAgent()
{
    if (m_enabled) {
        Bun__HTTPServerAgent__setEnabled(nullptr);
    }
}

void InspectorHTTPServerAgent::didCreateFrontendAndBackend()
{
}

void InspectorHTTPServerAgent::willDestroyFrontendAndBackend(DisconnectReason)
{
    m_frontendDispatcher = nullptr;
    m_enabled = false;
}

Protocol::ErrorStringOr<void> InspectorHTTPServerAgent::enable()
{
    if (m_enabled)
        return {};

    m_enabled = true;
    Bun__HTTPServerAgent__setEnabled(this);
    return {};
}

Protocol::ErrorStringOr<void> InspectorHTTPServerAgent::disable()
{
    if (!m_enabled)
        return {};

    m_enabled = false;
    Bun__HTTPServerAgent__setEnabled(nullptr);
    return {};
}

Protocol::ErrorStringOr<void> InspectorHTTPServerAgent::startListening(int serverId)
{
    if (!m_enabled)
        return {};

    return {};
}

Protocol::ErrorStringOr<void> InspectorHTTPServerAgent::stopListening(int serverId)
{
    if (!m_enabled)
        return {};

    // TODO:
    // Bun__HTTPServerAgentStopListening(this, serverId);
    return {};
}

Protocol::ErrorStringOr<void> InspectorHTTPServerAgent::getRequestBody(int requestId, int serverId)
{
    if (!m_enabled)
        return {};

    // TODO:
    // Bun__HTTPServerAgentGetRequestBody(this, requestId, serverId);
    return {};
}

Protocol::ErrorStringOr<void> InspectorHTTPServerAgent::getResponseBody(int requestId, int serverId)
{
    if (!m_enabled)
        return {};
    // TODO:
    // Bun__HTTPServerAgentGetResponseBody(this, requestId, serverId);
    return {};
}

// Event dispatchers

void InspectorHTTPServerAgent::serverStarted(int serverId, const String& url, double startTime, AnyServerPtr serverInstance)
{
    this->m_serverIdToServerInstance.set(serverId, serverInstance);
    if (!m_enabled || !m_frontendDispatcher) {
        return;
    }

    this->m_frontendDispatcher->listen(serverId, url, startTime);
}
void InspectorHTTPServerAgent::serverStopped(int serverId, double timestamp)
{
    this->m_serverIdToServerInstance.remove(serverId);

    if (!m_enabled || !m_frontendDispatcher) {
        return;
    }

    this->m_frontendDispatcher->close(serverId, timestamp);
}
void InspectorHTTPServerAgent::serverRoutesUpdated(int serverId, int hotReloadId, Ref<JSON::ArrayOf<Protocol::HTTPServer::Route>>&& routes)
{
    if (!m_enabled || !m_frontendDispatcher) {
        return;
    }

    this->m_frontendDispatcher->serverRoutesUpdated(serverId, hotReloadId, WTF::move(routes));
}
void InspectorHTTPServerAgent::requestWillBeSent(Ref<Protocol::HTTPServer::Request>&& request)
{
    if (!m_enabled || !m_frontendDispatcher) {
        return;
    }

    this->m_frontendDispatcher->requestWillBeSent(WTF::move(request));
}
void InspectorHTTPServerAgent::responseReceived(Ref<Protocol::HTTPServer::Response>&& response)
{
    if (!m_enabled || !m_frontendDispatcher) {
        return;
    }

    this->m_frontendDispatcher->responseReceived(WTF::move(response));
}
void InspectorHTTPServerAgent::bodyChunkReceived(Ref<Protocol::HTTPServer::BodyChunk>&& chunk)
{
    if (!m_enabled || !m_frontendDispatcher) {
        return;
    }

    this->m_frontendDispatcher->bodyChunkReceived(WTF::move(chunk));
}
void InspectorHTTPServerAgent::requestFinished(int requestId, int serverId, double timestamp, std::optional<double>&& opt_duration)
{
    if (!m_enabled || !m_frontendDispatcher) {
        return;
    }

    this->m_frontendDispatcher->requestFinished(requestId, serverId, timestamp, WTF::move(opt_duration));
}
void InspectorHTTPServerAgent::requestHandlerException(Ref<Protocol::HTTPServer::RequestHandlerError>&& error)
{
    if (!m_enabled || !m_frontendDispatcher) {
        return;
    }

    this->m_frontendDispatcher->requestHandlerException(WTF::move(error));
}

}

// Zig API implementation
extern "C" {

// Functions for Zig to call to notify about HTTP server events

typedef int ServerId;
typedef int HotReloadId;
typedef int RouteId;
typedef int RequestId;

[[ZIG_EXPORT(nothrow)]] void Bun__HTTPServerAgent__notifyServerStarted(Inspector::InspectorHTTPServerAgent* agent, ServerId serverId, HotReloadId hotReloadId, const BunString* address, double startTime, void* serverInstance)
{

    agent->serverStarted(serverId, address->toWTFString(), startTime, serverInstance);
}

[[ZIG_EXPORT(nothrow)]] void Bun__HTTPServerAgent__notifyServerStopped(Inspector::InspectorHTTPServerAgent* agent, ServerId serverId, double timestamp)
{

    agent->serverStopped(serverId, timestamp);
}

// This matches the Route extern struct in Zig
struct Route {
    enum class Type : uint8_t {
        Default = 1,
        Api = 2,
        Html = 3,
        Static = 4
    };

    int route_id;
    BunString path;
    Type type;
    int script_line;
    BunString* param_names;
    size_t param_names_len;
    BunString file_path;
    BunString script_id;
    BunString script_url;
};

[[ZIG_EXPORT(nothrow)]] void Bun__HTTPServerAgent__notifyServerRoutesUpdated(Inspector::InspectorHTTPServerAgent* agent, ServerId serverId, HotReloadId hotReloadId,
    Route* routes_ptr, size_t routes_len)
{

    auto routes = JSON::ArrayOf<Inspector::Protocol::HTTPServer::Route>::create();
    for (size_t i = 0; i < routes_len; i++) {
        auto& route = routes_ptr[i];

        auto route_type = Inspector::Protocol::HTTPServer::RouteType::Default;
        switch (route.type) {
        case Route::Type::Api:
            route_type = Inspector::Protocol::HTTPServer::RouteType::API;
            break;
        case Route::Type::Html:
            route_type = Inspector::Protocol::HTTPServer::RouteType::HTML;
            break;
        case Route::Type::Static:
            route_type = Inspector::Protocol::HTTPServer::RouteType::Static;
            break;
        default:
            route_type = Inspector::Protocol::HTTPServer::RouteType::Default;
            break;
        }

        auto object = Inspector::Protocol::HTTPServer::Route::create()
                          .setRouteId(route.route_id)
                          .setPath(route.path.toWTFString())
                          .setType(route_type)
                          .setScriptLine(route.script_line)
                          .release();

        if (!route.file_path.isEmpty()) {
            object->setFilePath(route.file_path.toWTFString());
        }

        if (!route.script_url.isEmpty()) {
            object->setScriptUrl(route.script_url.toWTFString());
        }

        routes->addItem(WTF::move(object));
    }

    agent->serverRoutesUpdated(serverId, hotReloadId, WTF::move(routes));
}
}

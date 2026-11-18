#include "InspectorHTTPServerAgent.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>
#include <wtf/TZoneMallocInlines.h>
#include "ZigGlobalObject.h"

namespace Inspector {

WTF_MAKE_TZONE_ALLOCATED_IMPL(InspectorHTTPServerAgent);

// Rust bindings implementation
extern "C" {
void Bun__HTTPServerAgent__setEnabled(Inspector::InspectorHTTPServerAgent* agent);
}

InspectorHTTPServerAgent::InspectorHTTPServerAgent(JSC::JSGlobalObject& globalObject)
    : InspectorAgentBase(globalObject, "HTTPServer"_s)
{
}

void InspectorHTTPServerAgent::didEnable()
{
    Bun__HTTPServerAgent__setEnabled(this);
}

void InspectorHTTPServerAgent::didDisable()
{
    Bun__HTTPServerAgent__setEnabled(nullptr);
}

void InspectorHTTPServerAgent::serverStarted(int serverId, const String& url, double startTime)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, serverId);
    parameters->setString("url"_s, url);
    parameters->setDouble("startTime"_s, startTime);
    sendEvent("listen"_s, WTF::move(parameters));
}

void InspectorHTTPServerAgent::serverStopped(int serverId, double timestamp)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, serverId);
    parameters->setDouble("timestamp"_s, timestamp);
    sendEvent("close"_s, WTF::move(parameters));
}

void InspectorHTTPServerAgent::serverRoutesUpdated(int serverId, int hotReloadId, Ref<JSON::Array>&& routes)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, serverId);
    parameters->setInteger("hotReloadId"_s, hotReloadId);
    parameters->setArray("routes"_s, WTF::move(routes));
    sendEvent("serverRoutesUpdated"_s, WTF::move(parameters));
}

}

// Rust-facing C API implementation
extern "C" {

// Functions for the Rust side to call to notify about HTTP server events

typedef int ServerId;
typedef int HotReloadId;
typedef int RouteId;
typedef int RequestId;

[[ZIG_EXPORT(nothrow)]] void Bun__HTTPServerAgent__notifyServerStarted(Inspector::InspectorHTTPServerAgent* agent, ServerId serverId, HotReloadId hotReloadId, const BunString* address, double startTime, void* serverInstance)
{

    agent->serverStarted(serverId, address->toWTFString(), startTime);
}

[[ZIG_EXPORT(nothrow)]] void Bun__HTTPServerAgent__notifyServerStopped(Inspector::InspectorHTTPServerAgent* agent, ServerId serverId, double timestamp)
{

    agent->serverStopped(serverId, timestamp);
}

// This matches the Route extern struct on the Rust side
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

    auto routes = JSON::Array::create();
    for (size_t i = 0; i < routes_len; i++) {
        auto& route = routes_ptr[i];

        auto route_type = "default"_s;
        switch (route.type) {
        case Route::Type::Api:
            route_type = "api"_s;
            break;
        case Route::Type::Html:
            route_type = "html"_s;
            break;
        case Route::Type::Static:
            route_type = "static"_s;
            break;
        case Route::Type::Default:
            break;
        }

        auto object = JSON::Object::create();
        object->setInteger("routeId"_s, route.route_id);
        object->setString("path"_s, route.path.toWTFString());
        object->setString("type"_s, route_type);
        object->setInteger("scriptLine"_s, route.script_line);

        if (!route.file_path.isEmpty()) {
            object->setString("filePath"_s, route.file_path.toWTFString());
        }

        if (!route.script_url.isEmpty()) {
            object->setString("scriptUrl"_s, route.script_url.toWTFString());
        }

        routes->pushValue(WTF::move(object));
    }

    agent->serverRoutesUpdated(serverId, hotReloadId, WTF::move(routes));
}
}

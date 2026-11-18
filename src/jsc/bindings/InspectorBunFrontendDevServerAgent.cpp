#include "InspectorBunFrontendDevServerAgent.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>
#include <wtf/TZoneMallocInlines.h>
#include "ZigGlobalObject.h"

namespace Inspector {

extern "C" void Bun__InspectorBunFrontendDevServerAgent__setEnabled(Inspector::InspectorBunFrontendDevServerAgent*);

WTF_MAKE_TZONE_ALLOCATED_IMPL(InspectorBunFrontendDevServerAgent);

InspectorBunFrontendDevServerAgent::InspectorBunFrontendDevServerAgent(JSC::JSGlobalObject& globalObject)
    : InspectorAgentBase(globalObject, "BunFrontendDevServer"_s)
{
}

void InspectorBunFrontendDevServerAgent::didEnable()
{
    Bun__InspectorBunFrontendDevServerAgent__setEnabled(this);
}

void InspectorBunFrontendDevServerAgent::didDisable()
{
    Bun__InspectorBunFrontendDevServerAgent__setEnabled(nullptr);
}

void InspectorBunFrontendDevServerAgent::clientConnected(int devServerId, int connectionId)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, devServerId);
    parameters->setInteger("connectionId"_s, connectionId);
    sendEvent("clientConnected"_s, WTF::move(parameters));
}

void InspectorBunFrontendDevServerAgent::clientDisconnected(int devServerId, int connectionId)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, devServerId);
    parameters->setInteger("connectionId"_s, connectionId);
    sendEvent("clientDisconnected"_s, WTF::move(parameters));
}

void InspectorBunFrontendDevServerAgent::bundleStart(int devServerId, Ref<JSON::ArrayOf<String>>&& triggerFiles)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, devServerId);
    parameters->setArray("triggerFiles"_s, WTF::move(triggerFiles));
    sendEvent("bundleStart"_s, WTF::move(parameters));
}

void InspectorBunFrontendDevServerAgent::bundleComplete(int devServerId, double durationMs)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, devServerId);
    parameters->setDouble("durationMs"_s, durationMs);
    sendEvent("bundleComplete"_s, WTF::move(parameters));
}

void InspectorBunFrontendDevServerAgent::bundleFailed(int devServerId, const String& buildErrorsPayloadBase64)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, devServerId);
    parameters->setString("buildErrorsPayloadBase64"_s, buildErrorsPayloadBase64);
    sendEvent("bundleFailed"_s, WTF::move(parameters));
}

void InspectorBunFrontendDevServerAgent::clientNavigated(int devServerId, int connectionId, const String& url, std::optional<int> routeBundleId)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, devServerId);
    parameters->setInteger("connectionId"_s, connectionId);
    parameters->setString("url"_s, url);
    if (routeBundleId)
        parameters->setInteger("routeBundleId"_s, *routeBundleId);
    sendEvent("clientNavigated"_s, WTF::move(parameters));
}

void InspectorBunFrontendDevServerAgent::consoleLog(int devServerId, char kind, const String& data)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("serverId"_s, devServerId);
    parameters->setDouble("kind"_s, kind);
    parameters->setString("message"_s, data);
    sendEvent("consoleLog"_s, WTF::move(parameters));
}

// C API implementations for the Rust side
extern "C" {

void InspectorBunFrontendDevServerAgent__notifyClientConnected(InspectorBunFrontendDevServerAgent* agent, int devServerId, int connectionId)
{
    agent->clientConnected(devServerId, connectionId);
}

void InspectorBunFrontendDevServerAgent__notifyClientDisconnected(InspectorBunFrontendDevServerAgent* agent, int devServerId, int connectionId)
{
    agent->clientDisconnected(devServerId, connectionId);
}

void InspectorBunFrontendDevServerAgent__notifyBundleStart(InspectorBunFrontendDevServerAgent* agent, int devServerId, Bun::OwnedString* triggerFiles, size_t triggerFilesLen)
{
    // Create a JSON array for the triggerFiles
    Ref<JSON::ArrayOf<String>> files = JSON::ArrayOf<String>::create();
    for (size_t i = 0; i < triggerFilesLen; i++) {
        files->addItem(triggerFiles[i].transferToWTFString());
    }

    agent->bundleStart(devServerId, WTF::move(files));
}

void InspectorBunFrontendDevServerAgent__notifyBundleComplete(InspectorBunFrontendDevServerAgent* agent, int devServerId, double durationMs)
{
    agent->bundleComplete(devServerId, durationMs);
}

void InspectorBunFrontendDevServerAgent__notifyBundleFailed(InspectorBunFrontendDevServerAgent* agent, int devServerId, Bun::OwnedString buildErrorsPayloadBase64)
{
    agent->bundleFailed(devServerId, buildErrorsPayloadBase64.transferToWTFString());
}

void InspectorBunFrontendDevServerAgent__notifyClientNavigated(InspectorBunFrontendDevServerAgent* agent, int devServerId, int connectionId, const BunString* url, int routeBundleId)
{
    std::optional<int> optionalRouteBundleId;
    if (routeBundleId > -1) {
        optionalRouteBundleId = { routeBundleId };
    }

    agent->clientNavigated(devServerId, connectionId, url->toWTFString(), optionalRouteBundleId);
}

void InspectorBunFrontendDevServerAgent__notifyConsoleLog(InspectorBunFrontendDevServerAgent* agent, int devServerId, char kind, const BunString* data)
{
    agent->consoleLog(devServerId, kind, data->toWTFString());
}
}

} // namespace Inspector

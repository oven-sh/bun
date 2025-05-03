#include "InspectorBunFrontendDevServerAgent.h"

#include <JavaScriptCore/InspectorFrontendRouter.h>
#include <JavaScriptCore/InspectorBackendDispatcher.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/ScriptCallStackFactory.h>
#include <JavaScriptCore/ScriptArguments.h>
#include <JavaScriptCore/ConsoleMessage.h>
#include <JavaScriptCore/InspectorConsoleAgent.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include <wtf/TZoneMallocInlines.h>
#include "ZigGlobalObject.h"

namespace Inspector {

extern "C" void Bun__InspectorBunFrontendDevServerAgent__setEnabled(Inspector::InspectorBunFrontendDevServerAgent*);

WTF_MAKE_TZONE_ALLOCATED_IMPL(InspectorBunFrontendDevServerAgent);

InspectorBunFrontendDevServerAgent::InspectorBunFrontendDevServerAgent(JSC::JSGlobalObject& globalObject)
    : InspectorAgentBase("BunFrontendDevServer"_s)
    // , m_globalobject(globalObject)
    , m_backendDispatcher(BunFrontendDevServerBackendDispatcher::create(globalObject.inspectorController().backendDispatcher(), this))
    , m_frontendDispatcher(makeUnique<BunFrontendDevServerFrontendDispatcher>(const_cast<FrontendRouter&>(globalObject.inspectorController().frontendRouter())))
    , m_enabled(false)
{
    UNUSED_PARAM(globalObject);
}

InspectorBunFrontendDevServerAgent::~InspectorBunFrontendDevServerAgent() = default;

void InspectorBunFrontendDevServerAgent::didCreateFrontendAndBackend(FrontendRouter*, BackendDispatcher*)
{
}

void InspectorBunFrontendDevServerAgent::willDestroyFrontendAndBackend(DisconnectReason)
{
    m_frontendDispatcher = nullptr;
    m_enabled = false;
}

Protocol::ErrorStringOr<void> InspectorBunFrontendDevServerAgent::enable()
{
    if (m_enabled)
        return {};

    m_enabled = true;
    Bun__InspectorBunFrontendDevServerAgent__setEnabled(this);
    return {};
}

Protocol::ErrorStringOr<void> InspectorBunFrontendDevServerAgent::disable()
{
    if (!m_enabled)
        return {};

    m_enabled = false;
    Bun__InspectorBunFrontendDevServerAgent__setEnabled(nullptr);
    return {};
}

void InspectorBunFrontendDevServerAgent::clientConnected(int devServerId, int connectionId)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->clientConnected(devServerId, connectionId);
}

void InspectorBunFrontendDevServerAgent::clientDisconnected(int devServerId, int connectionId)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->clientDisconnected(devServerId, connectionId);
}

void InspectorBunFrontendDevServerAgent::bundleStart(int devServerId, Ref<JSON::ArrayOf<String>>&& triggerFiles)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->bundleStart(devServerId, WTFMove(triggerFiles));
}

void InspectorBunFrontendDevServerAgent::bundleComplete(int devServerId, double durationMs)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->bundleComplete(devServerId, durationMs);
}

void InspectorBunFrontendDevServerAgent::bundleFailed(int devServerId, const String& buildErrorsPayloadBase64)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->bundleFailed(devServerId, buildErrorsPayloadBase64);
}

void InspectorBunFrontendDevServerAgent::clientNavigated(int devServerId, int connectionId, const String& url, std::optional<int> routeBundleId)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->clientNavigated(devServerId, connectionId, url, WTFMove(routeBundleId));
}

void InspectorBunFrontendDevServerAgent::clientErrorReported(int devServerId, const String& clientErrorPayloadBase64)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->clientErrorReported(devServerId, clientErrorPayloadBase64);
}

void InspectorBunFrontendDevServerAgent::graphUpdate(int devServerId, const String& visualizerPayloadBase64)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    // m_frontendDispatcher->graphUpdate(devServerId, visualizerPayloadBase64);
}

void InspectorBunFrontendDevServerAgent::consoleLog(int devServerId, char kind, const String& data)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->consoleLog(devServerId, kind, data);
}

// C API implementations for Zig
extern "C" {

void InspectorBunFrontendDevServerAgent__notifyClientConnected(InspectorBunFrontendDevServerAgent* agent, int devServerId, int connectionId)
{
    agent->clientConnected(devServerId, connectionId);
}

void InspectorBunFrontendDevServerAgent__notifyClientDisconnected(InspectorBunFrontendDevServerAgent* agent, int devServerId, int connectionId)
{
    agent->clientDisconnected(devServerId, connectionId);
}

void InspectorBunFrontendDevServerAgent__notifyBundleStart(InspectorBunFrontendDevServerAgent* agent, int devServerId, BunString* triggerFiles, size_t triggerFilesLen)
{
    // Create a JSON array for the triggerFiles
    Ref<JSON::ArrayOf<String>> files = JSON::ArrayOf<String>::create();
    for (size_t i = 0; i < triggerFilesLen; i++) {
        files->addItem(triggerFiles[i].transferToWTFString());
    }

    agent->bundleStart(devServerId, WTFMove(files));
}

void InspectorBunFrontendDevServerAgent__notifyBundleComplete(InspectorBunFrontendDevServerAgent* agent, int devServerId, double durationMs)
{
    agent->bundleComplete(devServerId, durationMs);
}

void InspectorBunFrontendDevServerAgent__notifyBundleFailed(InspectorBunFrontendDevServerAgent* agent, int devServerId, BunString* buildErrorsPayloadBase64)
{
    agent->bundleFailed(devServerId, buildErrorsPayloadBase64->transferToWTFString());
}

void InspectorBunFrontendDevServerAgent__notifyClientNavigated(InspectorBunFrontendDevServerAgent* agent, int devServerId, int connectionId, BunString* url, int routeBundleId)
{
    std::optional<int> optionalRouteBundleId;
    if (routeBundleId > -1) {
        optionalRouteBundleId = { routeBundleId };
    }

    agent->clientNavigated(devServerId, connectionId, url->toWTFString(), optionalRouteBundleId);
}

void InspectorBunFrontendDevServerAgent__notifyClientErrorReported(InspectorBunFrontendDevServerAgent* agent, int devServerId, BunString* clientErrorPayloadBase64)
{
    agent->clientErrorReported(devServerId, clientErrorPayloadBase64->toWTFString());
}

void InspectorBunFrontendDevServerAgent__notifyGraphUpdate(InspectorBunFrontendDevServerAgent* agent, int devServerId, BunString* visualizerPayloadBase64)
{
    agent->graphUpdate(devServerId, visualizerPayloadBase64->toWTFString());
}

void InspectorBunFrontendDevServerAgent__notifyConsoleLog(InspectorBunFrontendDevServerAgent* agent, int devServerId, char kind, BunString* data)
{
    agent->consoleLog(devServerId, kind, data->toWTFString());
}
}

} // namespace Inspector

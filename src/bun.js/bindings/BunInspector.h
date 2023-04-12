#pragma once

#include "root.h"
#include <uws/src/App.h>
#include <JavaScriptCore/InspectorTarget.h>
#include <JavaScriptCore/InspectorFrontendChannel.h>
#include "ContextDestructionObserver.h"
#include <wtf/RefPtr.h>

namespace Zig {

using namespace JSC;

class BunInspector final : public RefCounted<BunInspector>, ::Inspector::InspectorTarget, ::Inspector::FrontendChannel, public WebCore::ContextDestructionObserver {
public:
    WTF_MAKE_ISO_ALLOCATED(BunInspector);
    BunInspector(ScriptExecutionContext* context, uWS::App* server, WTF::String&& identifier)
        : server(server)
        , WebCore::ContextDestructionObserver(context)
        , m_identifier(WTFMove(identifier))

    {
    }

public:
    ~BunInspector()
    {
        server->close();
    }

    using RefCounted::deref;
    using RefCounted::ref;

    bool isProvisional() const override { return false; }
    String identifier() const override { return m_identifier; }
    Inspector::InspectorTargetType type() const override { return Inspector::InspectorTargetType::DedicatedWorker; }

    static RefPtr<BunInspector> startWebSocketServer(
        WebCore::ScriptExecutionContext& ctx,
        WTF::String hostname,
        uint16_t port,
        WTF::Function<void(RefPtr<BunInspector>, bool success)>&& callback);

    // Connection management.
    void connect(Inspector::FrontendChannel::ConnectionType) override;
    void disconnect() override;
    void sendMessageToTargetBackend(const String&) override;
    bool hasConnectedFrontends() { return connectionCounter > 0; }

    void sendMessageToFrontend(const String& message) override;
    Inspector::FrontendChannel::ConnectionType connectionType() const override { return Inspector::FrontendChannel::ConnectionType::Local; }

    int connectionCounter = 0;

private:
    void dispatchToBackend(std::string_view message);

    WTF::String m_identifier;
    uWS::App* server;
    GlobalObject* globalObject() { return static_cast<GlobalObject*>(scriptExecutionContext()->jsGlobalObject()); }
};
}
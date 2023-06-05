#pragma once

#include "root.h"
#include <uws/src/App.h>
#include <JavaScriptCore/InspectorTarget.h>
#include <JavaScriptCore/InspectorFrontendChannel.h>
#include "ContextDestructionObserver.h"
#include <wtf/RefPtr.h>
#include <JavaScriptCore/Debugger.h>
#include <wtf/Deque.h>
#include "JSGlobalObjectInspectorController.h"

namespace Zig {

using namespace JSC;
using namespace WebCore;

class BunInspector final : public RefCounted<BunInspector>, ::Inspector::InspectorTarget, ::Inspector::FrontendChannel, public WebCore::ContextDestructionObserver, JSC::Debugger::Observer {
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

    bool isProvisional() const override { return false; }
    String identifier() const override { return m_identifier; }
    Inspector::InspectorTargetType type() const override { return Inspector::InspectorTargetType::DedicatedWorker; }
    GlobalObject* globalObject() { return static_cast<GlobalObject*>(scriptExecutionContext()->jsGlobalObject()); }

    void startServer(WTF::String hostname, uint16_t port, WTF::URL url, WTF::String title);

    Lock m_mutex;

    void ensureDebugger();
    JSC::Debugger* debugger() { return globalObject()->inspectorController().debugger(); }

    void didPause(JSGlobalObject*, DebuggerCallFrame&, JSValue /* exceptionOrCaughtValue */) override;
    void didContinue() override;
    void didParseSource(SourceID, const Debugger::Script&) override;
    void failedToParseSource(const String& /* url */, const String& /* data */, int /* firstLine */, int /* errorLine */, const String& /* errorMessage */) override {}

    void didCreateNativeExecutable(NativeExecutable&) override {}
    void willCallNativeExecutable(CallFrame*) override {}

    void willEnter(CallFrame*) override {}

    void didQueueMicrotask(JSGlobalObject*, MicrotaskIdentifier) override {}
    void willRunMicrotask(JSGlobalObject*, MicrotaskIdentifier) override {}
    void didRunMicrotask(JSGlobalObject*, MicrotaskIdentifier) override {}

    void applyBreakpoints(CodeBlock*) override {}
    void breakpointActionLog(JSGlobalObject*, const String& /* data */) override {}
    void breakpointActionSound(BreakpointActionID) override {}
    void breakpointActionProbe(JSGlobalObject*, BreakpointActionID, unsigned /* batchId */, unsigned /* sampleId */, JSValue /* result */) override {}
    void didDeferBreakpointPause(BreakpointID) override {}

    static BunInspector* startWebSocketServer(
        Zig::GlobalObject* globalObject,
        WebCore::ScriptExecutionContext& ctx,
        WTF::String hostname,
        uint16_t port,
        WTF::Function<void(BunInspector*, bool success)>&& callback);

    // Connection management.
    void connect(Inspector::FrontendChannel::ConnectionType) override;
    void disconnect() override;
    void sendMessageToTargetBackend(const String&) override;
    bool hasConnectedFrontends() { return connectionCounter > 0; }

    void sendMessageToFrontend(const String& message) override;
    Inspector::FrontendChannel::ConnectionType connectionType() const override { return Inspector::FrontendChannel::ConnectionType::Remote; }

    int connectionCounter = 0;
    bool hasSentWelcomeMessage = false;

    void drainOutgoingMessages();
    void drainIncomingMessages();
    void waitForMessages();

    void readyToStartDebugger();

private:
    void dispatchToBackend(std::string_view message);

    WTF::String m_identifier;
    WTF::Lock m_pendingMessagesLock;
    uWS::App* server;
    uWS::Loop* loop;
    Deque<WTF::String> m_pendingMessages;

    Deque<WTF::String> m_incomingMessages;
    WTF::Lock m_incomingMessagesLock;
};
}
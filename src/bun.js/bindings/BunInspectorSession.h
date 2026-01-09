#pragma once

#include "root.h"

#include <JavaScriptCore/InspectorFrontendChannel.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>

#include "ScriptExecutionContext.h"

#include <wtf/HashSet.h>
#include <wtf/Lock.h>
#include <wtf/Vector.h>

#include <atomic>
#include <cstdint>

namespace Bun {

enum class InProcessSessionStatus : int32_t {
    Pending = 0,
    Connected = 1,
    Disconnecting = 2,
    Disconnected = 3,
};

class BunInProcessInspectorSession final : public Inspector::FrontendChannel {
public:
    BunInProcessInspectorSession(WebCore::ScriptExecutionContext& context, JSC::JSGlobalObject* globalObject, bool shouldRefEventLoop, JSC::JSFunction* onMessageFn);
    ~BunInProcessInspectorSession() final;

    ConnectionType connectionType() const override;

    void connect();
    void disconnect();

    void dispatchMessageFromSession(const WTF::String& message);

    void sendMessageToFrontend(const WTF::String& message) override;

private:
    void doConnect(WebCore::ScriptExecutionContext& context);
    JSC::JSGlobalObjectDebuggable& inspector();
    void flushPendingMessages(WebCore::ScriptExecutionContext& context);

    JSC::JSGlobalObject* globalObject { nullptr };
    WebCore::ScriptExecutionContextIdentifier scriptExecutionContextIdentifier {};

    JSC::Strong<JSC::Unknown> jsOnMessageFunction {};

    WTF::Lock pendingMessagesLock;
    WTF::Vector<WTF::String, 12> pendingMessages;
    std::atomic<uint32_t> pendingMessageScheduledCount { 0 };

    // Native response routing:
    // Track request ids initiated by THIS session, so responses can be routed
    // without waking JS for sessions that don't own the response.
    //
    // Events (no top-level "id") must still be delivered to all sessions.
    WTF::Lock pendingRequestIdsLock;
    WTF::HashSet<int> m_pending_request_ids;

    std::atomic<InProcessSessionStatus> status { InProcessSessionStatus::Pending };
    bool refEventLoopWhileConnected { false };
    bool hasEverConnected { false };
};

} // namespace Bun

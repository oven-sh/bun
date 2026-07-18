#pragma once

#include "root.h"

namespace WebCore {
class WebSocket;
}

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsNotifyUndiciSubscribed);

namespace UndiciDiagnostics {

// Monotonic: set the first time any `undici:*` diagnostics_channel gets a
// subscriber. Lets the native fetch/WebSocket paths skip the JS call entirely
// when no instrumentation is installed.
bool hasSubscriber();

void publishWebSocketOpen(JSC::JSGlobalObject*, WebCore::WebSocket&, const WTF::String& protocol, const WTF::String& extensions);
void publishWebSocketClose(JSC::JSGlobalObject*, WebCore::WebSocket&, unsigned short code, const WTF::String& reason);
void publishWebSocketError(JSC::JSGlobalObject*, const WTF::String& message);
void publishWebSocketPingPong(JSC::JSGlobalObject*, bool isPong, std::span<const uint8_t> payload);

}
}

#pragma once

#include "root.h"

namespace WebCore {
class WebSocket;
}
namespace Zig {
class GlobalObject;
}

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsNotifyUndiciSubscribed);

namespace UndiciDiagnostics {

// Monotonic per-VM: set the first time any `undici:*` diagnostics_channel gets
// a subscriber on this global. Lets the native fetch/WebSocket paths skip the
// JS call entirely when no instrumentation is installed.
bool hasSubscriber(Zig::GlobalObject*);

void publishWebSocketOpen(JSC::JSGlobalObject*, WebCore::WebSocket&, const WTF::String& protocol, const WTF::String& extensions);
void publishWebSocketClose(JSC::JSGlobalObject*, WebCore::WebSocket&, unsigned short code, const WTF::String& reason);
void publishWebSocketError(JSC::JSGlobalObject*, const WTF::String& message);
void publishWebSocketPingPong(JSC::JSGlobalObject*, bool isPong, std::span<const uint8_t> payload);

}
}

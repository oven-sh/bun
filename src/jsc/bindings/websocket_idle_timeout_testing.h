#pragma once

#include "root.h"

namespace Bun {

// Testing-only entry point for uWS's
// WebSocketContextData<SSL, USERDATA>::calculateIdleTimeoutComponents
// (packages/bun-uws/src/WebSocketContextData.h), exposed via
// `bun:internal-for-testing` so a test can assert its output directly
// instead of waiting out the ~252-second real-world symptom of the pre-fix
// unsigned-short underflow (see websocket_idle_timeout_testing.cpp).
// Signature: (idleTimeout: number, sendPingsAutomatically: boolean) ->
// [number, number] (the idle-detection component and the
// ping/end()-grace-period component, in that order).
BUN_DECLARE_HOST_FUNCTION(Bun__websocketIdleTimeoutComponentsForTesting);

} // namespace Bun

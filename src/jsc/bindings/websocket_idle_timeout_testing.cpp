// Testing-only JS binding for uWS's
// WebSocketContextData<SSL, USERDATA>::calculateIdleTimeoutComponents
// (packages/bun-uws/src/WebSocketContextData.h).
//
// idleTimeout: 0's pre-fix regression symptom is a real-world ~252-second
// timeout (65532, the unsigned-short underflow of 0 - 4, tick-wheel-rounded
// -- see the fix commit and the "websocket idleTimeout: 0" describe block in
// test/js/bun/websocket/websocket-server.test.ts) -- far too long for any
// test to wait out. This binding drives the fixed arithmetic directly and
// deterministically instead, so a test can assert idleTimeout: 0 produces
// idle-detection component 0 without any socket, timer, or wall-clock wait.
//
// calculateIdleTimeoutComponents is a non-static member, but it only reads
// sendPingsAutomatically and writes idleTimeoutComponents; the constructor
// stores nothing but the TopicTree* it's given, and that pointer is
// otherwise untouched by either. So a default-constructed instance with a
// nullptr topicTree drives it standalone, with no App/socket/loop
// scaffolding. SSL/USERDATA are picked to match Bun's own concrete
// instantiation of the sibling WebSocketContext template (see
// src/uws_sys/libuwsockets.cpp's `uWS::WebSocketContext<SSL, true, void *>`
// / `uWS::WebSocket<SSL, true, void *>`); neither template parameter is
// referenced by calculateIdleTimeoutComponents itself, so the SSL value
// chosen here (false) is arbitrary.
//
// Kept in its own TU (not folded into an existing bindings.cpp) so this
// testing-only entry point -- and its direct #include of a vendored uWS
// template header -- stays isolated, mirroring xxhash3_testing.cpp's
// separation of its testing entry point from xxhash3.cpp.

#include "root.h"

#include "websocket_idle_timeout_testing.h"

#include <bun-uws/src/WebSocketContextData.h>

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include <JavaScriptCore/JSCJSValue.h>

namespace Bun {

// (idleTimeout: number, sendPingsAutomatically: boolean) -> [number, number]
BUN_DEFINE_HOST_FUNCTION(Bun__websocketIdleTimeoutComponentsForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // toUInt32 is a defined conversion (no float-cast UB for NaN/Inf/negatives,
    // matching xxhash3_testing.cpp's identical reasoning for its seed
    // argument). The truncating cast to unsigned short below is then
    // well-defined (modulo 65536), matching the real field type in
    // WebSocketContextData::idleTimeoutComponents / its calculateIdleTimeoutComponents parameter.
    uint32_t idleTimeout32 = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    unsigned short idleTimeout = static_cast<unsigned short>(idleTimeout32);

    bool sendPingsAutomatically = callFrame->argument(1).toBoolean(globalObject);

    uWS::WebSocketContextData<false, void*> data(nullptr);
    data.sendPingsAutomatically = sendPingsAutomatically;
    data.calculateIdleTimeoutComponents(idleTimeout);

    auto* result = JSC::JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), 2);
    result->putDirectIndex(globalObject, 0, JSC::jsNumber(data.idleTimeoutComponents.first));
    result->putDirectIndex(globalObject, 1, JSC::jsNumber(data.idleTimeoutComponents.second));

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));
}

} // namespace Bun

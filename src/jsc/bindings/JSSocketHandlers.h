#pragma once

#include "root.h"
#include "headers-handwritten.h"

#include "JavaScriptCore/JSCInlines.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

namespace Bun {
using namespace JSC;

// The JS callbacks of a Bun.listen / Bun.connect socket context, plus the
// pending connect promise, stored as GC-visited internal fields. The listener's
// and each socket's JS wrapper hold this cell in a visited slot, so the
// callbacks live exactly as long as something that can still invoke them.
// Replaces manual gcProtect/gcUnprotect of raw JSValues, and lets `reload` swap
// callbacks in place for live sockets.
class JSSocketHandlers final : public JSC::JSInternalFieldObjectImpl<14> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<14>;

    // Field order is ABI shared with src/runtime/socket/Handlers.rs.
    enum class Field : uint32_t {
        Open = 0,
        Close,
        Data,
        Writable,
        Timeout,
        ConnectError,
        End,
        Error,
        Handshake,
        Session,
        Keylog,
        ServerName,
        ALPNCallback,
        // Not a callback: the `Bun.connect` promise, cleared once settled.
        Promise,
    };
    static_assert(static_cast<uint32_t>(Field::Promise) + 1 == numberOfInternalFields);

    static constexpr unsigned numberOfCallbacks = static_cast<unsigned>(Field::Promise);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    static JSSocketHandlers* create(JSC::JSGlobalObject*, const JSC::EncodedJSValue* callbacks);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    JSSocketHandlers(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, const JSC::EncodedJSValue* callbacks);
};

} // namespace Bun

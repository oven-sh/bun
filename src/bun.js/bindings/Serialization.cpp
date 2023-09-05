#include "root.h"
#include "headers-handwritten.h"
#include "ExceptionOr.h"
#include "MessagePort.h"
#include "SerializedScriptValue.h"
#include "JSDOMExceptionHandling.h"

using namespace JSC;
using namespace WebCore;

/// This is used for Bun.spawn() IPC because otherwise we would have to copy the data once to get it to zig, then write it.
/// Returns `true` on success, `false` on failure + throws a JS error.
extern "C" bool Bun__serializeJSValueForSubprocess(JSGlobalObject* globalObject, EncodedJSValue encodedValue, int fd)
{
    JSValue value = JSValue::decode(encodedValue);

    Vector<JSC::Strong<JSC::JSObject>> transferList;
    Vector<RefPtr<MessagePort>> dummyPorts;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTFMove(transferList),
        dummyPorts);

    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, scope,
            serialized.releaseException());
        RELEASE_AND_RETURN(scope, false);
    }

    auto serializedValue = serialized.releaseReturnValue();
    auto bytes = serializedValue.ptr()->wireBytes();

    uint8_t id = 2; // IPCMessageType.SerializedMessage
    write(fd, &id, sizeof(uint8_t));
    uint32_t size = bytes.size();
    write(fd, &size, sizeof(uint32_t));
    write(fd, bytes.data(), size);

    RELEASE_AND_RETURN(scope, true);
}

extern "C" EncodedJSValue Bun__JSValue__deserialize(JSGlobalObject* globalObject, const uint8_t* bytes, size_t size)
{
    Vector<uint8_t> vector(bytes, size);
    /// ?! did i just give ownership of these bytes to JSC?
    auto scriptValue = SerializedScriptValue::createFromWireBytes(WTFMove(vector));
    return JSValue::encode(scriptValue->deserialize(*globalObject, globalObject));
}
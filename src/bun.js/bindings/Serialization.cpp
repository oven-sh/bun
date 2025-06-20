#include "root.h"
#include "headers-handwritten.h"
#include "ExceptionOr.h"
#include "MessagePort.h"
#include "SerializedScriptValue.h"
#include "JSDOMExceptionHandling.h"

using namespace JSC;
using namespace WebCore;

// Must be synced with bindings.zig's JSValue.SerializedScriptValue.External
struct SerializedValueSlice {
    const uint8_t* bytes;
    size_t size;
    WebCore::SerializedScriptValue* value; // NOLINT
};

/// Returns a "slice" that also contains a pointer to the SerializedScriptValue. Must be freed by the caller
extern "C" SerializedValueSlice Bun__serializeJSValue(JSGlobalObject* globalObject, EncodedJSValue encodedValue, bool forTransferBool)
{
    JSValue value = JSValue::decode(encodedValue);

    Vector<JSC::Strong<JSC::JSObject>> transferList;
    Vector<RefPtr<MessagePort>> dummyPorts;
    auto forStorage = SerializationForStorage::No;
    auto context = SerializationContext::Default;
    auto forTransferEnum = forTransferBool ? SerializationForTransfer::Yes : SerializationForTransfer::No;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTFMove(transferList), dummyPorts, forStorage, context, forTransferEnum);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, scope,
            serialized.releaseException());
        RELEASE_AND_RETURN(scope, { 0 });
    }

    auto serializedValue = serialized.releaseReturnValue();

    const Vector<uint8_t>& bytes = serializedValue->wireBytes();

    return {
        bytes.begin(),
        bytes.size(),
        &serializedValue.leakRef(),
    };
}

extern "C" void Bun__SerializedScriptSlice__free(SerializedScriptValue* value)
{
    delete value;
}

extern "C" EncodedJSValue Bun__JSValue__deserialize(JSGlobalObject* globalObject, const uint8_t* bytes, size_t size)
{
    Vector<uint8_t> vector(std::span { bytes, size });
    /// ?! did i just give ownership of these bytes to JSC?
    auto scriptValue = SerializedScriptValue::createFromWireBytes(WTFMove(vector));
    return JSValue::encode(scriptValue->deserialize(*globalObject, globalObject));
}

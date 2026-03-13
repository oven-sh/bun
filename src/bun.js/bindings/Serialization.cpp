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

enum class SerializedFlags : uint8_t {
    None = 0,
    ForCrossProcessTransfer = 1 << 0,
    ForStorage = 1 << 1,
};

/// Returns a "slice" that also contains a pointer to the SerializedScriptValue. Must be freed by the caller
extern "C" SerializedValueSlice Bun__serializeJSValue(JSGlobalObject* globalObject, EncodedJSValue encodedValue, const SerializedFlags flags)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);

    Vector<JSC::Strong<JSC::JSObject>> transferList;
    Vector<RefPtr<MessagePort>> dummyPorts;
    auto forStorage = (static_cast<uint8_t>(flags) & static_cast<uint8_t>(SerializedFlags::ForStorage)) ? SerializationForStorage::Yes : SerializationForStorage::No;
    auto context = SerializationContext::Default;
    auto forTransferEnum = (static_cast<uint8_t>(flags) & static_cast<uint8_t>(SerializedFlags::ForCrossProcessTransfer)) ? SerializationForCrossProcessTransfer::Yes : SerializationForCrossProcessTransfer::No;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(transferList), dummyPorts, forStorage, context, forTransferEnum);

    EXCEPTION_ASSERT(!!scope.exception() == serialized.hasException());
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, scope, serialized.releaseException());
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
    // Use deref() instead of delete to properly handle CHECK_REF_COUNTED_LIFECYCLE.
    // The value was leaked via leakRef() which leaves refcount at 1, so deref() will delete it.
    value->deref();
}

extern "C" EncodedJSValue Bun__JSValue__deserialize(JSGlobalObject* globalObject, const uint8_t* bytes, size_t size)
{
    Vector<uint8_t> vector(std::span { bytes, size });
    /// ?! did i just give ownership of these bytes to JSC?
    auto scriptValue = SerializedScriptValue::createFromWireBytes(WTF::move(vector));
    return JSValue::encode(scriptValue->deserialize(*globalObject, globalObject));
}

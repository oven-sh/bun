#include "root.h"
#include "headers-handwritten.h"
#include "ExceptionOr.h"
#include "MessagePort.h"
#include "SerializedScriptValue.h"
#include "JSDOMExceptionHandling.h"

using namespace JSC;
using namespace WebCore;

// Must be synced with SerializeStatus in src/jsc/JSValue.rs
enum class SerializeStatus : uint8_t {
    Ok,
    // A JS exception is pending.
    Thrown,
    // The value cannot be cloned and nothing is pending: the caller throws the error of its API.
    Uncloneable,
};

// Must be synced with SerializedScriptValueExternal in src/jsc/JSValue.rs
struct SerializedValueSlice {
    const uint8_t* bytes;
    size_t size;
    WebCore::SerializedScriptValue* value; // NOLINT
    SerializeStatus status;
};
static_assert(sizeof(SerializedValueSlice) == 4 * sizeof(void*));

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
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(transferList), dummyPorts, forStorage, SerializationErrorMode::NonThrowing, context, forTransferEnum);

    EXCEPTION_ASSERT(!scope.exception() || serialized.hasException());
    if (serialized.hasException()) {
        auto exception = serialized.releaseException();
        if (!scope.exception() && exception.code() == ExceptionCode::DataCloneError)
            return { nullptr, 0, nullptr, SerializeStatus::Uncloneable };
        WebCore::propagateException(*globalObject, scope, WTF::move(exception));
        RELEASE_AND_RETURN(scope, (SerializedValueSlice { nullptr, 0, nullptr, SerializeStatus::Thrown }));
    }

    auto serializedValue = serialized.releaseReturnValue();

    const Vector<uint8_t>& bytes = serializedValue->wireBytes();

    return {
        bytes.begin(),
        bytes.size(),
        &serializedValue.leakRef(),
        SerializeStatus::Ok,
    };
}

// Must be synced with CloneErrorClass in src/jsc/JSValue.rs
enum class CloneErrorClass : uint8_t {
    DataCloneError,
    NodeError,
};

extern "C" void Bun__throwCloneError(JSGlobalObject* globalObject, CloneErrorClass errorClass)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    switch (errorClass) {
    case CloneErrorClass::DataCloneError:
        throwDataCloneError(*globalObject, scope);
        break;
    case CloneErrorClass::NodeError:
        throwNodeDataCloneError(*globalObject, scope);
        break;
    }
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

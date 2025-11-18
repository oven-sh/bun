#include "root.h"
#include "SnapshotSerializers.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/Exception.h>
#include "ErrorCode.h"

namespace Bun {

using namespace JSC;

const ClassInfo SnapshotSerializers::s_info = { "SnapshotSerializers"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(SnapshotSerializers) };

SnapshotSerializers::SnapshotSerializers(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void SnapshotSerializers::finishCreation(VM& vm)
{
    Base::finishCreation(vm);

    // Initialize empty arrays
    m_testCallbacks.set(vm, this, JSC::constructEmptyArray(this->globalObject(), nullptr, 0));
    m_serializeCallbacks.set(vm, this, JSC::constructEmptyArray(this->globalObject(), nullptr, 0));
}

template<typename Visitor>
void SnapshotSerializers::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    SnapshotSerializers* thisObject = jsCast<SnapshotSerializers*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_testCallbacks);
    visitor.append(thisObject->m_serializeCallbacks);
}

DEFINE_VISIT_CHILDREN(SnapshotSerializers);

SnapshotSerializers* SnapshotSerializers::create(VM& vm, Structure* structure)
{
    SnapshotSerializers* serializers = new (NotNull, allocateCell<SnapshotSerializers>(vm)) SnapshotSerializers(vm, structure);
    serializers->finishCreation(vm);
    return serializers;
}

bool SnapshotSerializers::addSerializer(JSGlobalObject* globalObject, JSValue testCallback, JSValue serializeCallback)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Check for re-entrancy
    if (m_isExecuting) {
        throwTypeError(globalObject, scope, "Cannot add snapshot serializer from within a test or serialize callback"_s);
        return false;
    }

    // Validate that both callbacks are callable
    if (!testCallback.isCallable()) {
        throwTypeError(globalObject, scope, "Snapshot serializer test callback must be a function"_s);
        return false;
    }

    if (!serializeCallback.isCallable()) {
        throwTypeError(globalObject, scope, "Snapshot serializer serialize callback must be a function"_s);
        return false;
    }

    // Get the arrays
    JSArray* testCallbacks = m_testCallbacks.get();
    JSArray* serializeCallbacks = m_serializeCallbacks.get();

    if (!testCallbacks || !serializeCallbacks) {
        throwOutOfMemoryError(globalObject, scope);
        return false;
    }

    // Add to the end of the arrays (most recent last, we'll iterate in reverse)
    testCallbacks->push(globalObject, testCallback);
    RETURN_IF_EXCEPTION(scope, false);

    serializeCallbacks->push(globalObject, serializeCallback);
    RETURN_IF_EXCEPTION(scope, false);

    return true;
}

JSValue SnapshotSerializers::serialize(JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Check for re-entrancy
    if (m_isExecuting) {
        throwTypeError(globalObject, scope, "Cannot serialize from within a test or serialize callback"_s);
        return jsNull();
    }

    // RAII guard to manage m_isExecuting flag
    class ExecutionGuard {
    public:
        ExecutionGuard(bool& flag)
            : m_flag(flag)
        {
            m_flag = true;
        }
        ~ExecutionGuard() { m_flag = false; }

    private:
        bool& m_flag;
    };
    ExecutionGuard guard(m_isExecuting);

    JSArray* testCallbacks = m_testCallbacks.get();
    JSArray* serializeCallbacks = m_serializeCallbacks.get();

    if (!testCallbacks || !serializeCallbacks) {
        return jsNull();
    }

    unsigned length = testCallbacks->length();

    // Iterate through serializers in reverse order (most recent to least recent)
    for (int i = static_cast<int>(length) - 1; i >= 0; i--) {
        JSValue testCallback = testCallbacks->getIndex(globalObject, static_cast<unsigned>(i));
        RETURN_IF_EXCEPTION(scope, {});

        if (!testCallback.isCallable()) {
            continue;
        }

        // Call the test function with the value
        auto callData = JSC::getCallData(testCallback);
        MarkedArgumentBuffer args;
        args.append(value);
        ASSERT(!args.hasOverflowed());

        JSValue testResult = call(globalObject, testCallback, callData, jsUndefined(), args);
        RETURN_IF_EXCEPTION(scope, {});

        // If the test returns truthy, use this serializer
        if (testResult.toBoolean(globalObject)) {
            JSValue serializeCallback = serializeCallbacks->getIndex(globalObject, static_cast<unsigned>(i));
            RETURN_IF_EXCEPTION(scope, {});

            if (!serializeCallback.isCallable()) {
                continue;
            }

            // Call the serialize function with the value
            auto serializeCallData = JSC::getCallData(serializeCallback);
            MarkedArgumentBuffer serializeArgs;
            serializeArgs.append(value);
            ASSERT(!serializeArgs.hasOverflowed());

            JSValue result = call(globalObject, serializeCallback, serializeCallData, jsUndefined(), serializeArgs);
            RETURN_IF_EXCEPTION(scope, {});

            // Return the serialized result (should be a string or null)
            RELEASE_AND_RETURN(scope, result);
        }
    }

    // No matching serializer found
    return jsNull();
}

} // namespace Bun

using namespace Bun;
using namespace JSC;

// Zig-exported functions

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue SnapshotSerializers__create(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* structure = globalObject->SnapshotSerializersStructure();
    auto* serializers = SnapshotSerializers::create(vm, structure);
    return JSValue::encode(serializers);
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue SnapshotSerializers__add(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue encodedSerializers,
    JSC::EncodedJSValue encodedTestCallback,
    JSC::EncodedJSValue encodedSerializeCallback)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue serializersValue = JSValue::decode(encodedSerializers);
    SnapshotSerializers* serializers = jsDynamicCast<SnapshotSerializers*>(serializersValue);

    if (!serializers) {
        throwTypeError(globalObject, scope, "Invalid SnapshotSerializers object"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue testCallback = JSValue::decode(encodedTestCallback);
    JSValue serializeCallback = JSValue::decode(encodedSerializeCallback);

    bool success = serializers->addSerializer(globalObject, testCallback, serializeCallback);
    RETURN_IF_EXCEPTION(scope, {});

    if (success) {
        RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
    }

    return JSValue::encode(jsUndefined());
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue SnapshotSerializers__serialize(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue encodedSerializers,
    JSC::EncodedJSValue encodedValue)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue serializersValue = JSValue::decode(encodedSerializers);
    SnapshotSerializers* serializers = jsDynamicCast<SnapshotSerializers*>(serializersValue);

    if (!serializers) {
        throwTypeError(globalObject, scope, "Invalid SnapshotSerializers object"_s);
        return JSValue::encode(jsNull());
    }

    JSValue value = JSValue::decode(encodedValue);
    JSValue result = serializers->serialize(globalObject, value);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

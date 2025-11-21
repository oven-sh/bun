#include "root.h"
#include "SnapshotSerializers.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSFunction.h>
#include "ErrorCode.h"
#include "WebCoreJSBuiltins.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

const ClassInfo SnapshotSerializers::s_info = { "SnapshotSerializers"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(SnapshotSerializers) };

SnapshotSerializers::SnapshotSerializers(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void SnapshotSerializers::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

JSArray* SnapshotSerializers::getTestCallbacks(JSGlobalObject* globalObject) const
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* val = m_testCallbacks.get();
    if (!val) {
        val = JSC::constructEmptyArray(globalObject, nullptr, 0);
        RETURN_IF_EXCEPTION(scope, {});
        m_testCallbacks.set(vm, this, val);
    }
    return val;
}

JSArray* SnapshotSerializers::getSerializeCallbacks(JSGlobalObject* globalObject) const
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* val = m_serializeCallbacks.get();
    if (!val) {
        val = JSC::constructEmptyArray(globalObject, nullptr, 0);
        RETURN_IF_EXCEPTION(scope, {});
        m_serializeCallbacks.set(vm, this, val);
    }
    return val;
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

void SnapshotSerializers::addSerializer(JSGlobalObject* globalObject, JSValue testCallback, JSValue serializeCallback)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Check for re-entrancy
    if (m_isExecuting) {
        throwTypeError(globalObject, scope, "Cannot add snapshot serializer from within a test or serialize callback"_s);
        RELEASE_AND_RETURN(scope, );
    }

    // Validate that both callbacks are callable
    if (!testCallback.isCallable()) {
        throwTypeError(globalObject, scope, "Snapshot serializer test callback must be a function"_s);
        RELEASE_AND_RETURN(scope, );
    }

    if (!serializeCallback.isCallable()) {
        throwTypeError(globalObject, scope, "Snapshot serializer serialize callback must be a function"_s);
        RELEASE_AND_RETURN(scope, );
    }

    // Get the arrays (lazily initialized)
    JSArray* testCallbacks = getTestCallbacks(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    JSArray* serializeCallbacks = getSerializeCallbacks(globalObject);
    RETURN_IF_EXCEPTION(scope, );

    // Add to the end of the arrays (most recent last, we'll iterate in reverse)
    testCallbacks->push(globalObject, testCallback);
    RETURN_IF_EXCEPTION(scope, );

    serializeCallbacks->push(globalObject, serializeCallback);
    RETURN_IF_EXCEPTION(scope, );
}

JSValue SnapshotSerializers::serialize(JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // If no serializers are registered, return undefined
    if (!m_testCallbacks.get() || m_testCallbacks.get()->length() == 0) {
        return jsUndefined();
    }

    // Check for re-entrancy
    if (m_isExecuting) {
        throwTypeError(globalObject, scope, "Cannot serialize from within a test or serialize callback"_s);
        RELEASE_AND_RETURN(scope, {});
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

    JSArray* testCallbacks = getTestCallbacks(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSArray* serializeCallbacks = getSerializeCallbacks(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Use JavaScript builtin for iteration to avoid deoptimization at boundaries
    JSFunction* serializeBuiltin = JSFunction::create(vm, globalObject, snapshotSerializersSerializeCodeGenerator(vm), globalObject->globalScope());

    MarkedArgumentBuffer args;
    args.append(testCallbacks);
    args.append(serializeCallbacks);
    args.append(value);
    ASSERT(!args.hasOverflowed());

    JSValue result = call(globalObject, serializeBuiltin, args, "snapshotSerializersSerialize"_s);
    RETURN_IF_EXCEPTION(scope, {});

    return result;
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
        RELEASE_AND_RETURN(scope, {});
    }

    JSValue testCallback = JSValue::decode(encodedTestCallback);
    JSValue serializeCallback = JSValue::decode(encodedSerializeCallback);

    serializers->addSerializer(globalObject, testCallback, serializeCallback);
    RETURN_IF_EXCEPTION(scope, {});

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
        RELEASE_AND_RETURN(scope, {});
    }

    JSValue value = JSValue::decode(encodedValue);
    JSValue result = serializers->serialize(globalObject, value);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(result);
}

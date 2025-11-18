#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/WriteBarrier.h>
#include "ZigGlobalObject.h"

namespace Bun {

class SnapshotSerializers final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static SnapshotSerializers* create(JSC::VM& vm, JSC::Structure* structure);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    template<typename MyClassT, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<MyClassT, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForSnapshotSerializers.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForSnapshotSerializers = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForSnapshotSerializers.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForSnapshotSerializers = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    // Add a new snapshot serializer
    // Returns true on success, false if in re-entrant call (and throws)
    bool addSerializer(JSC::JSGlobalObject* globalObject, JSC::JSValue testCallback, JSC::JSValue serializeCallback);

    // Test a value and serialize if a matching serializer is found
    // Returns the serialized string or null
    JSC::JSValue serialize(JSC::JSGlobalObject* globalObject, JSC::JSValue value);

private:
    SnapshotSerializers(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM& vm);

    // Arrays store serializers with most recent last; iterated in reverse order
    JSC::WriteBarrier<JSC::JSArray> m_testCallbacks;
    JSC::WriteBarrier<JSC::JSArray> m_serializeCallbacks;

    // Re-entrancy guard
    bool m_isExecuting { false };
};

} // namespace Bun

// Exposed to Zig
extern "C" {

[[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue SnapshotSerializers__add(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue encodedSerializers,
    JSC::EncodedJSValue encodedTestCallback,
    JSC::EncodedJSValue encodedSerializeCallback);

[[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue SnapshotSerializers__serialize(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue encodedSerializers,
    JSC::EncodedJSValue encodedValue);

} // extern "C"

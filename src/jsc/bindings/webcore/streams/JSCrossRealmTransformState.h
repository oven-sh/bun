// JSCrossRealmTransformState — one cell per cross-realm (transferred) stream endpoint.
// Transferable streams are NOT implemented: CrossRealmTransform.cpp may stub its entry
// points, but this cell and the CrossRealm enum arms stay in the frozen headers so nothing
// has to be re-frozen later.
// The port's message/messageerror handlers MUST be registered through the port's GC-visited
// listener machinery with THIS cell as the context (a raw-pointer native listener is a UAF).
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSReadableStreamDefaultController.h"
#include "JSWritableStreamDefaultController.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSCrossRealmTransformState final : public JSC::JSInternalFieldObjectImpl<4> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<4>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // The JSMessagePort wrapper cell this endpoint sends/receives on.
        Port = 0,
        // MUTABLE — the writable side's message handler reassigns it on every "pull"/"error".
        BackpressurePromise,
        // Back-pointers to the controller in THIS realm — EXACT-TYPED (the subsystem allows
        // exactly ONE erased back-pointer, JSReadableStream::m_controller, so this is not a
        // second one). EXACTLY ONE of the two is non-null: ReadableController on the readable
        // (transfer-receiving) endpoint, WritableController on the writable endpoint. Dispatch
        // on which is non-null; never downcast an erased slot here.
        ReadableController,
        WritableController,
    };

    static JSCrossRealmTransformState* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSCrossRealmTransformState);
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    const JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) const { return Base::internalField(static_cast<uint32_t>(field)); }
    JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) { return Base::internalField(static_cast<uint32_t>(field)); }

    JSC::JSObject* port() const { return uncheckedDowncast<JSC::JSObject>(fieldCell(Field::Port)); }
    JSC::JSPromise* backpressurePromise() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::BackpressurePromise)); }
    JSReadableStreamDefaultController* readableController() const { return uncheckedDowncast<JSReadableStreamDefaultController>(fieldCell(Field::ReadableController)); }
    JSWritableStreamDefaultController* writableController() const { return uncheckedDowncast<JSWritableStreamDefaultController>(fieldCell(Field::WritableController)); }

    void setPort(JSC::VM& vm, JSC::JSObject* port) { internalField(Field::Port).set(vm, this, port); }
    void setBackpressurePromise(JSC::VM& vm, JSC::JSPromise* promise) { internalField(Field::BackpressurePromise).set(vm, this, promise); }
    void setReadableController(JSC::VM& vm, JSReadableStreamDefaultController* controller) { internalField(Field::ReadableController).set(vm, this, controller); }
    void setWritableController(JSC::VM& vm, JSWritableStreamDefaultController* controller) { internalField(Field::WritableController).set(vm, this, controller); }

private:
    JSCrossRealmTransformState(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    JSC::JSCell* fieldCell(Field field) const
    {
        JSC::JSValue value = internalField(field).get();
        return value.isCell() ? value.asCell() : nullptr;
    }
};

} // namespace WebCore

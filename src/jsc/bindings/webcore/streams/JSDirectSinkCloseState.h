// JSDirectSinkCloseState — the context cell of readDirectStream's bound onClose callable:
// the port of the `{underlyingSource, closePromiseCapability}` bound `this`.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDirectStreamSource.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSDirectSinkCloseState final : public JSC::JSInternalFieldObjectImpl<3> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<3>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // the direct stream's JSDirectStreamSource (its `cancel` runs from onClose).
        Source = 0,
        // the JS sink controller driving the source; onClose must end() it so the cell
        // detaches from the native sink before it can be collected.
        SinkController,
        // the close-capability promise returned to the caller when `pull` returned synchronously
        // without closing; initially empty, armed by readDirectStream, resolved by onClose.
        // (An unvisited close promise is a premature collection of the promise handed to Rust.)
        ClosePromise,
    };

    static JSDirectSinkCloseState* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSDirectSinkCloseState);
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

    JSDirectStreamSource* source() const { return uncheckedDowncast<JSDirectStreamSource>(fieldCell(Field::Source)); }
    JSC::JSObject* sinkController() const { return uncheckedDowncast<JSC::JSObject>(fieldCell(Field::SinkController)); }
    JSC::JSPromise* closePromise() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::ClosePromise)); }

    void setSource(JSC::VM& vm, JSDirectStreamSource* source) { internalField(Field::Source).set(vm, this, source); }
    void setSinkController(JSC::VM& vm, JSC::JSObject* sinkController) { internalField(Field::SinkController).set(vm, this, sinkController); }
    void setClosePromise(JSC::VM& vm, JSC::JSPromise* promise) { internalField(Field::ClosePromise).set(vm, this, promise); }

    void clearSource() { internalField(Field::Source).clear(); }
    void clearSinkController() { internalField(Field::SinkController).clear(); }
    void clearClosePromise() { internalField(Field::ClosePromise).clear(); }

private:
    JSDirectSinkCloseState(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    JSC::JSCell* fieldCell(Field field) const
    {
        JSC::JSValue value = internalField(field).get();
        return value.isCell() ? value.asCell() : nullptr;
    }
};

} // namespace WebCore

// JSAsyncIteratorSourceOperation — state cell for Bun's async-iterable → direct-stream body
// extension (BunAsyncIterableSource.cpp): the iterator, the controller handed to pull(), and
// the one promise every pull() returns. Internal cell: no prototype, no constructor.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSAsyncIteratorSourceOperation final : public JSC::JSInternalFieldObjectImpl<3> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<3>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // The async iterator; cleared when cancellation or the error path hands it off.
        Iterator = 0,
        // Whatever object pull() received (the direct controller, or the HTTP sink facade).
        Controller,
        // The single promise returned to every pull() while the iterator runs.
        PullPromise,
    };

    static JSAsyncIteratorSourceOperation* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSAsyncIteratorSourceOperation);
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

    JSC::JSObject* iterator() const { return uncheckedDowncast<JSC::JSObject>(fieldCell(Field::Iterator)); }
    JSC::JSObject* controller() const { return uncheckedDowncast<JSC::JSObject>(fieldCell(Field::Controller)); }
    JSC::JSPromise* pullPromise() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::PullPromise)); }

    void setIterator(JSC::VM& vm, JSC::JSObject* iterator) { internalField(Field::Iterator).set(vm, this, iterator); }
    void setController(JSC::VM& vm, JSC::JSObject* controller) { internalField(Field::Controller).set(vm, this, controller); }
    void setPullPromise(JSC::VM& vm, JSC::JSPromise* promise) { internalField(Field::PullPromise).set(vm, this, promise); }

    void clearIterator() { internalField(Field::Iterator).clear(); }
    void clearPullPromise() { internalField(Field::PullPromise).clear(); }

    bool m_cancelled : 1 { false };
    bool m_done : 1 { false };
    bool m_running : 1 { false };

private:
    JSAsyncIteratorSourceOperation(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    JSC::JSCell* fieldCell(Field field) const
    {
        JSC::JSValue value = internalField(field).get();
        return value.isCell() ? value.asCell() : nullptr;
    }
};

} // namespace WebCore

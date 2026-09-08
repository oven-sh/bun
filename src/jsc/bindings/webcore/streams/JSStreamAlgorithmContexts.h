// JSStreamAlgorithmContexts — the small FromIterable iterator-record context cell and
// NOTHING else. 2-value reaction contexts use JSC's existing InternalFieldTuple
// (globalObject->internalFieldTupleStructure()); NO bespoke pair classes.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

namespace WebCore {

// The context (algorithmContext) of a SourceKind::FromIterable default controller: the
// spec's Iterator Record {[[Iterator]], [[NextMethod]], [[Done]]} from
// GetIterator(asyncIterable, async).
class JSStreamFromIterableContext final : public JSC::JSInternalFieldObjectImpl<2> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<2>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // Iterator Record.[[Iterator]] — the async iterator object.
        Iterator = 0,
        // Iterator Record.[[NextMethod]] — captured ONCE by GetIterator; later mutation of
        // `iterator.next` is never observed.
        NextMethod,
    };

    static JSStreamFromIterableContext* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSStreamFromIterableContext);
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
    JSC::JSValue nextMethod() const { return internalField(Field::NextMethod).get(); }

    void setIterator(JSC::VM& vm, JSC::JSObject* iterator) { internalField(Field::Iterator).set(vm, this, iterator); }
    void setNextMethod(JSC::VM& vm, JSC::JSValue nextMethod) { internalField(Field::NextMethod).set(vm, this, nextMethod); }

    // Iterator Record.[[Done]]
    bool m_done { false };

private:
    JSStreamFromIterableContext(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    JSC::JSCell* fieldCell(Field field) const
    {
        JSC::JSValue value = internalField(field).get();
        return value.isCell() ? value.asCell() : nullptr;
    }
};

} // namespace WebCore

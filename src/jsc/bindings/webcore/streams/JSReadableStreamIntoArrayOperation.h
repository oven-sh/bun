// JSReadableStreamIntoArrayOperation — the queue-backed array pump's persistent state:
// the reader it holds, the chunk array it accumulates into, and the result promise it
// settles. One dedicated cell (not nested InternalFieldTuples) so the three fields are
// named, visited, and read back without double unwrapping.
// Internal cell: no prototype, no constructor, never exposed to JS.
// Non-destructible: internal fields only.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSReadableStreamDefaultReader.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSReadableStreamIntoArrayOperation final : public JSC::JSInternalFieldObjectImpl<3> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<3>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // The default reader the pump acquired; released when the pump settles.
        Reader = 0,
        // Every chunk read so far, in order.
        Chunks,
        // The promise readableStreamIntoArray returned.
        Result,
    };

    static JSReadableStreamIntoArrayOperation* create(JSC::VM&, JSC::Structure*, JSReadableStreamDefaultReader*, JSC::JSArray* chunks, JSC::JSPromise* result);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSReadableStreamIntoArrayOperation);
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

    JSReadableStreamDefaultReader* reader() const { return uncheckedDowncast<JSReadableStreamDefaultReader>(fieldCell(Field::Reader)); }
    JSC::JSArray* chunks() const { return uncheckedDowncast<JSC::JSArray>(fieldCell(Field::Chunks)); }
    JSC::JSPromise* result() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::Result)); }

private:
    JSReadableStreamIntoArrayOperation(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSReadableStreamDefaultReader*, JSC::JSArray*, JSC::JSPromise*);

    JSC::JSCell* fieldCell(Field field) const
    {
        JSC::JSValue value = internalField(field).get();
        return value.isCell() ? value.asCell() : nullptr;
    }
};

} // namespace WebCore

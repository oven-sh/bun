// JSDirectStreamSource — a `type:"direct"` underlying source, converted ONCE at stream
// construction: the user object (the `this` of every call) and its pull / cancel / close
// methods. Held by the stream while DirectPending, then by whichever consumer takes the
// stream (JSDirectStreamController, JSDirectSinkCloseState, JSOneShotDirectSink); nobody
// reads a property of the user object after construction.
// Internal cell: no prototype, no constructor, never exposed to JS.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

namespace WebCore {

class JSDirectStreamSource final : public JSC::JSInternalFieldObjectImpl<4> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<4>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // The user's underlyingSource object; `undefined` for Bun's internal sources.
        UnderlyingSource = 0,
        // Each is a callable or null.
        Pull,
        Cancel,
        // Bun's close(reason) lifecycle hook: the stream ended or errored.
        Close,
    };

    static JSDirectStreamSource* create(JSC::VM&, JSC::Structure*, JSC::JSValue underlyingSource, JSC::JSObject* pull, JSC::JSObject* cancel, JSC::JSObject* close);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSDirectStreamSource);
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

    JSC::JSValue thisValue() const { return internalField(Field::UnderlyingSource).get(); }
    JSC::JSObject* pullFunction() const { return internalField(Field::Pull).get().getObject(); }
    JSC::JSObject* cancelFunction() const { return internalField(Field::Cancel).get().getObject(); }
    JSC::JSObject* closeFunction() const { return internalField(Field::Close).get().getObject(); }

    // cancel(reason) in the stream's async context, as a promise (a throw rejects it).
    JSC::JSPromise* cancel(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue reason);
    // close(reason); a throw propagates.
    void close(JSC::JSGlobalObject*, JSC::JSValue reason);

private:
    JSDirectStreamSource(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSC::JSValue underlyingSource, JSC::JSObject* pull, JSC::JSObject* cancel, JSC::JSObject* close);
};

} // namespace WebCore

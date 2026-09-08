// JSOneShotDirectSink — the one-shot direct consumer's throwaway controller
// (`consumeDirectStreamToArrayBuffer` / readableStreamToArrayBufferDirect).
//
// This path does NOT build a persistent controller or a reader, and shares no state machine
// with JSDirectStreamController — do not force it into one. It hand-rolls a
// `{start, close, end, flush, write}` object over a real `Bun.ArrayBufferSink`, calls the
// user's `pull(controller)` EXACTLY ONCE, and settles the capability promise from the pull's
// outcome. This cell IS that `controller`: it roots the ArrayBufferSink, the capability
// promise, and the source stream across the pull, and carries the `closed` flag.
// Its start/write/end/close/flush are OWN JSBoundFunctions over the shared
// boundOneShotStart / boundOneShotDirect{Write,Close,Flush} [bound-convention] targets
// (JSStreamsRuntime.h), with THIS cell as the bound context at argument(0):
//   - `start` is bound to boundOneShotStart, a no-op target that returns undefined;
//   - `end` and `close` are two bound cells over the ONE boundOneShotDirectClose target.
// Internal cell: no prototype, no constructor, never exposed to JS beyond `pull(controller)`.
// Non-destructible: internal fields + scalar members only.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDirectStreamSource.h"
#include "JSReadableStream.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSOneShotDirectSink final : public JSC::JSInternalFieldObjectImpl<4> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<4>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // The consumed DirectPending stream (already marked locked + disturbed before the pull).
        Stream = 0,
        // The real Bun.ArrayBufferSink cell every write() lands in.
        ArrayBufferSink,
        // The capability promise consumeDirectStreamToArrayBuffer returned; end()/close() settle
        // it (and the onConsumeDirectToArrayBufferPull* reactions settle it on the pull's promise).
        CapabilityPromise,
        // The stream's source; its close() hook runs from end()/close().
        Source,
    };

    static JSOneShotDirectSink* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSOneShotDirectSink);
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

    JSReadableStream* stream() const { return uncheckedDowncast<JSReadableStream>(fieldCell(Field::Stream)); }
    JSC::JSObject* arrayBufferSink() const { return uncheckedDowncast<JSC::JSObject>(fieldCell(Field::ArrayBufferSink)); }
    JSC::JSPromise* capabilityPromise() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::CapabilityPromise)); }
    JSDirectStreamSource* source() const { return uncheckedDowncast<JSDirectStreamSource>(fieldCell(Field::Source)); }

    void setStream(JSC::VM& vm, JSReadableStream* stream) { internalField(Field::Stream).set(vm, this, stream); }
    void setArrayBufferSink(JSC::VM& vm, JSC::JSObject* sink) { internalField(Field::ArrayBufferSink).set(vm, this, sink); }
    void setCapabilityPromise(JSC::VM& vm, JSC::JSPromise* promise) { internalField(Field::CapabilityPromise).set(vm, this, promise); }
    void setSource(JSC::VM& vm, JSDirectStreamSource* source) { internalField(Field::Source).set(vm, this, source); }

    void clearSource() { internalField(Field::Source).clear(); }

    // Set by end()/close(): later write()/end()/close()/flush() calls are no-ops.
    bool m_closed : 1 { false };
    // true ⇒ resolve with a Uint8Array (toBytes); false ⇒ an ArrayBuffer (toArrayBuffer).
    bool m_asUint8Array : 1 { false };

private:
    JSOneShotDirectSink(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    JSC::JSCell* fieldCell(Field field) const
    {
        JSC::JSValue value = internalField(field).get();
        return value.isCell() ? value.asCell() : nullptr;
    }
};

} // namespace WebCore

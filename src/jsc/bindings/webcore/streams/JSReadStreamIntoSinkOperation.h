// JSReadStreamIntoSinkOperation — the readStreamIntoSink async pump's state cell. Driven
// entirely by [reaction-convention] reactions.
// ROOTING: the acquired reader's visited m_pipeOperation back-edge points HERE (set at
// acquire, cleared at teardown), so `Rust Strong → stream → reader → this →
// sink / result` holds across the backpressure await.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSReadableStream.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSTransformStream.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSReadStreamIntoSinkOperation final : public JSC::JSInternalFieldObjectImpl<6> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<6>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        Stream = 0,
        // the acquired default reader. The error path CLEARS this FIRST, so the final
        // releaseLock is deliberately skipped there.
        Reader,
        // ERASED: the native JSSink controller the pump writes into.
        Sink,
        // the JSPromise readStreamIntoSink returned (what Rust's Signal protocol awaits).
        Result,
        // Nullable: the unwritten batch tail stashed on sink backpressure; drained on onReady.
        PendingBatch,
        // Nullable: the byte-producing JSTransformStream subclass whose transform arms
        // write output straight to this sink. Set at attach; onReady flips its
        // m_backpressure back to false, onClose/finally detaches it.
        NativeTransform,
    };

    static JSReadStreamIntoSinkOperation* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSReadStreamIntoSinkOperation);
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
    JSReadableStreamDefaultReader* reader() const { return uncheckedDowncast<JSReadableStreamDefaultReader>(fieldCell(Field::Reader)); }
    JSC::JSObject* sink() const { return uncheckedDowncast<JSC::JSObject>(fieldCell(Field::Sink)); }
    JSC::JSPromise* result() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::Result)); }
    JSC::JSObject* pendingBatch() const { return uncheckedDowncast<JSC::JSObject>(fieldCell(Field::PendingBatch)); }
    JSTransformStream* nativeTransform() const { return uncheckedDowncast<JSTransformStream>(fieldCell(Field::NativeTransform)); }

    void setStream(JSC::VM& vm, JSReadableStream* stream) { internalField(Field::Stream).set(vm, this, stream); }
    void setReader(JSC::VM& vm, JSReadableStreamDefaultReader* reader) { internalField(Field::Reader).set(vm, this, reader); }
    void setSink(JSC::VM& vm, JSC::JSObject* sink) { internalField(Field::Sink).set(vm, this, sink); }
    void setResult(JSC::VM& vm, JSC::JSPromise* result) { internalField(Field::Result).set(vm, this, result); }
    void setPendingBatch(JSC::VM& vm, JSC::JSObject* batch) { internalField(Field::PendingBatch).set(vm, this, batch); }
    void setNativeTransform(JSC::VM& vm, JSTransformStream* transform) { internalField(Field::NativeTransform).set(vm, this, transform); }

    void clearStream() { internalField(Field::Stream).clear(); }
    void clearReader() { internalField(Field::Reader).clear(); }
    void clearSink() { internalField(Field::Sink).clear(); }
    void clearPendingBatch() { internalField(Field::PendingBatch).clear(); }
    void clearNativeTransform() { internalField(Field::NativeTransform).clear(); }

    bool m_didThrow : 1 { false };
    bool m_didClose : 1 { false };
    bool m_started : 1 { false };
    // Set when rsisWriteChunk suspends on sink backpressure; cleared when onReady resumes.
    bool m_waitingOnSink : 1 { false };

private:
    JSReadStreamIntoSinkOperation(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    JSC::JSCell* fieldCell(Field field) const
    {
        JSC::JSValue value = internalField(field).get();
        return value.isCell() ? value.asCell() : nullptr;
    }
};

} // namespace WebCore

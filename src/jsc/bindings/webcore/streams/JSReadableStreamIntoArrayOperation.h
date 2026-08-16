// JSReadableStreamIntoArrayOperation — the queue-backed array pump's persistent state:
// the reader it holds, the chunk array it accumulates into, and the result promise it
// settles. One dedicated cell (not nested InternalFieldTuples) so the three fields are
// named, visited, and read back without double unwrapping.
// Internal cell: no prototype, no constructor, never exposed to JS.
// Non-destructible: WriteBarrier members only.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSReadableStreamIntoArrayOperation final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSReadableStreamIntoArrayOperation* create(JSC::VM&, JSC::Structure*, JSReadableStreamDefaultReader*, JSC::JSArray* chunks, JSC::JSPromise* result);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_reader, m_chunks, m_result.
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

    // The default reader the pump acquired; released when the pump settles.
    JSC::WriteBarrier<JSReadableStreamDefaultReader> m_reader;
    // Every chunk read so far, in order.
    JSC::WriteBarrier<JSC::JSArray> m_chunks;
    // The promise readableStreamIntoArray returned.
    JSC::WriteBarrier<JSC::JSPromise> m_result;

private:
    JSReadableStreamIntoArrayOperation(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSReadableStreamDefaultReader*, JSC::JSArray*, JSC::JSPromise*);
};

} // namespace WebCore

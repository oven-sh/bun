// JSNodeStreamReadOperation — a node:stream adapter's read side (Readable.fromWeb(),
// Duplex.fromWeb()): the reader it reads through, the node stream it feeds, and the adapter's
// three step functions. They are functions of the adapter module, shared by every adapter.
// Its ONE read request (ReadRequestKind::NodeStream) serves every read: a Readable asks for the
// next chunk only after it has the one before, so at most one read is in flight.
// ROOTING: the adapter's node stream holds this cell. A read that waits in the web stream holds
// the node stream through `stream → reader → [[readRequests]] → request → this → node stream`;
// with no read waiting, the web stream holds neither.
// Internal cell: no prototype, no constructor. Non-destructible: internal fields only.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSReadRequest.h"
#include "JSReadableStreamDefaultReader.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

namespace WebCore {

class JSNodeStreamReadOperation final : public JSC::JSInternalFieldObjectImpl<7> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<7>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // The default reader the adapter took from the stream.
        Reader = 0,
        // The node stream. Every step function gets it as its second argument.
        NodeStream,
        // (chunk, nodeStream): runs one microtask after the stream hands the chunk over.
        ChunkStep,
        // (undefined, nodeStream) and (error, nodeStream): run where the stream closes or errors.
        CloseStep,
        ErrorStep,
        // The read request, made once.
        Request,
        // The async context of the read that is in flight: the steps run in it. Empty
        // between reads, so that the operation does not keep a store of a finished read.
        AsyncContext,
    };

    static JSNodeStreamReadOperation* create(JSC::VM&, JSC::Structure*, JSReadableStreamDefaultReader*, JSC::JSObject* nodeStream, JSC::JSValue chunkStep, JSC::JSValue closeStep, JSC::JSValue errorStep);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

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

    JSReadableStreamDefaultReader* reader() const { return uncheckedDowncast<JSReadableStreamDefaultReader>(internalField(Field::Reader).get()); }
    JSC::JSValue nodeStream() const { return internalField(Field::NodeStream).get(); }
    JSC::JSValue chunkStep() const { return internalField(Field::ChunkStep).get(); }
    JSC::JSValue closeStep() const { return internalField(Field::CloseStep).get(); }
    JSC::JSValue errorStep() const { return internalField(Field::ErrorStep).get(); }
    JSReadRequest* request() const { return uncheckedDowncast<JSReadRequest>(internalField(Field::Request).get()); }
    // The context of the read that a step ends, or undefined. The operation lets go of it.
    JSC::JSValue takeAsyncContext()
    {
        JSC::JSValue asyncContext = internalField(Field::AsyncContext).get();
        internalField(Field::AsyncContext).clear();
        return asyncContext ? asyncContext : JSC::jsUndefined();
    }

    void setRequest(JSC::VM& vm, JSReadRequest* request) { internalField(Field::Request).set(vm, this, request); }
    void setAsyncContext(JSC::VM& vm, JSC::JSValue asyncContext) { internalField(Field::AsyncContext).set(vm, this, asyncContext); }

    // Set from the read call until the stream runs a step of the request.
    bool m_readInFlight { false };

private:
    JSNodeStreamReadOperation(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSReadableStreamDefaultReader*, JSC::JSObject* nodeStream, JSC::JSValue chunkStep, JSC::JSValue closeStep, JSC::JSValue errorStep);
};

} // namespace WebCore

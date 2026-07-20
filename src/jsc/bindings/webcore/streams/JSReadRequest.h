// JSReadRequest / JSReadIntoRequest — the spec's read request / read-into request
// "structs with steps", each as ONE concrete, NON-polymorphic GC cell with a kind tag.
// A C++ `virtual` on any JSCell is memory corruption and is BANNED.
// Internal cells: no prototype, no constructor, never exposed to JS.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>

namespace WebCore {

// A read request: chunk steps / close steps / error steps.
class JSReadRequest final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSReadRequest* create(JSC::VM&, JSC::Structure*, Bun::WebStreams::ReadRequestKind, JSC::JSValue context);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_context.
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

    ReadRequestKind kind() const { return m_kind; }

    // Every body is `switch (m_kind)` over ALL arms — no default. Every dispatch through
    // these is userJS: YES (transitive): the Promise kind resolves its promise with a USER
    // chunk; the other kinds re-enter controller ops.
    // "chunk steps, given chunk"
    void chunkSteps(JSC::JSGlobalObject*, JSC::JSValue chunk);
    // "close steps"
    void closeSteps(JSC::JSGlobalObject*);
    // "error steps, given e"
    void errorSteps(JSC::JSGlobalObject*, JSC::JSValue error);

    // Promise kind: the JSPromise reader.read() returned.
    // PipeTo: the JSStreamPipeToOperation. DefaultTee/ByteTee: the JSStreamTeeState.
    // AsyncIterator: the JSReadableStreamAsyncIterator.
    JSC::WriteBarrier<JSC::Unknown> m_context;

private:
    JSReadRequest(JSC::VM&, JSC::Structure*, Bun::WebStreams::ReadRequestKind);
    void finishCreation(JSC::VM&, JSC::JSValue context);

    const ReadRequestKind m_kind;
};

// A read-into request. NOTE: its close steps take a chunk (or undefined).
class JSReadIntoRequest final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSReadIntoRequest* create(JSC::VM&, JSC::Structure*, Bun::WebStreams::ReadIntoRequestKind, JSC::JSValue context);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_context.
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

    ReadIntoRequestKind kind() const { return m_kind; }

    // userJS: YES (transitive) for every dispatch site (see JSReadRequest above).
    // "chunk steps, given chunk"
    void chunkSteps(JSC::JSGlobalObject*, JSC::JSArrayBufferView* chunk);
    // "close steps, given chunk" — chunk may be null (the spec's `undefined`).
    void closeSteps(JSC::JSGlobalObject*, JSC::JSArrayBufferView* chunkOrNull);
    // "error steps, given e"
    void errorSteps(JSC::JSGlobalObject*, JSC::JSValue error);

    // Promise kind: the JSPromise byobReader.read(view) returned.
    // ByteTee: the JSStreamTeeState.
    JSC::WriteBarrier<JSC::Unknown> m_context;

private:
    JSReadIntoRequest(JSC::VM&, JSC::Structure*, Bun::WebStreams::ReadIntoRequestKind);
    void finishCreation(JSC::VM&, JSC::JSValue context);

    const ReadIntoRequestKind m_kind;
};

} // namespace WebCore

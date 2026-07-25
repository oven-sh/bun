// JSStreamAlgorithmContexts — the small FromIterable iterator-record context cell and
// NOTHING else. 2-value reaction contexts use JSC's existing InternalFieldTuple
// (globalObject->internalFieldTupleStructure()); NO bespoke pair classes.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>

namespace WebCore {

// The context (algorithmContext) of a SourceKind::FromIterable default controller: the
// spec's Iterator Record {[[Iterator]], [[NextMethod]], [[Done]]} from
// GetIterator(asyncIterable, async).
class JSStreamFromIterableContext final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSStreamFromIterableContext* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_iterator, m_nextMethod.
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

    // Iterator Record.[[Iterator]] — the async iterator object.
    JSC::WriteBarrier<JSC::JSObject> m_iterator;
    // Iterator Record.[[NextMethod]] — captured ONCE by GetIterator; later mutation of
    // `iterator.next` is never observed.
    JSC::WriteBarrier<JSC::Unknown> m_nextMethod;
    // Iterator Record.[[Done]]
    bool m_done { false };

private:
    JSStreamFromIterableContext(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore

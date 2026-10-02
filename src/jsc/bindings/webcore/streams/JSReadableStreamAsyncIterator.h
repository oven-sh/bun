// JSReadableStreamAsyncIterator — the spec-native ReadableStream async iterator cell
// (readMany() stays public on the reader). NO globalThis constructor exists; its prototype
// is %ReadableStreamAsyncIteratorPrototype% (own `next` / `return`,
// [[Prototype]] = %AsyncIteratorPrototype% so `for await` finds @@asyncIterator) and
// instances are returned only by values() / [Symbol.asyncIterator](). Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSReadableStreamAsyncIterator final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    // Allocated only by ReadableStream.prototype.values(options) / @@asyncIterator.
    static JSReadableStreamAsyncIterator* create(JSC::VM&, JSC::Structure*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_reader, m_ongoingPromise.
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

    // the iterator's exclusive default reader ("iterator's reader").
    JSC::WriteBarrier<JSReadableStreamDefaultReader> m_reader;
    // "ongoing promise" — chains get-the-next-iteration-result / return calls.
    JSC::WriteBarrier<JSC::JSPromise> m_ongoingPromise;
    // "prevent cancel" (values({ preventCancel }))
    bool m_preventCancel : 1 { false };
    // "is finished"
    bool m_isFinished : 1 { false };

private:
    JSReadableStreamAsyncIterator(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore

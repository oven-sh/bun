// JSDirectStreamSource — a `type:"direct"` underlying source, converted ONCE at stream
// construction: the user object (the `this` of every call) and its pull / cancel / close
// methods. Held by the stream while DirectPending, then by whichever consumer takes the
// stream (JSDirectStreamController, the native sink controller, JSOneShotDirectSink); nobody
// reads a property of the user object after construction.
// Internal cell: no prototype, no constructor, never exposed to JS.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "WebStreamsInternals.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ThrowScope.h>

namespace WebCore {

class JSDirectStreamSource final : public JSC::JSInternalFieldObjectImpl<4> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<4>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // The user's underlyingSource object, or an internal source's context cell.
        UnderlyingSource = 0,
        // Each is a callable or null.
        Pull,
        Cancel,
        // Bun's close(reason) lifecycle hook: the stream ended or errored.
        Close,
    };

    static JSDirectStreamSource* create(JSC::VM&, JSC::Structure*, JSC::JSValue underlyingSource, JSC::JSObject* pull, JSC::JSObject* cancel, JSC::JSObject* close);
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

    // Each method calls the source's function in the async context it is given: the stream's, or what the stream held.
    bool hasPull() const { return pullFunction(); }
    // pull(controller). A throw propagates, and a missing pull() throws a TypeError. nullptr: pull() returned no promise.
    JSC::JSPromise* pull(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue controller);
    // The same for a caller that holds the stream's scope open.
    JSC::JSPromise* pull(JSC::JSGlobalObject*, const Bun::WebStreams::StreamAsyncContextScope&, JSC::JSValue controller);
    // cancel(reason), as a promise (a throw rejects it).
    JSC::JSPromise* cancel(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue reason);
    // cancel(reason) for a sink that closed underneath the source, whose stream can be gone. Nothing waits for what it returns, and a throw propagates.
    void cancelFromSink(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue reason);
    // close(reason). The stream released its async context when it closed or errored, so the caller passes what the stream held. A throw propagates.
    void close(JSC::JSGlobalObject*, JSC::JSValue asyncContext, JSC::JSValue reason);

private:
    JSDirectStreamSource(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSC::JSValue underlyingSource, JSC::JSObject* pull, JSC::JSObject* cancel, JSC::JSObject* close);

    const JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) const { return Base::internalField(static_cast<uint32_t>(field)); }
    JSC::JSValue thisValue() const { return internalField(Field::UnderlyingSource).get(); }
    JSC::JSObject* pullFunction() const { return internalField(Field::Pull).get().getObject(); }
    JSC::JSObject* cancelFunction() const { return internalField(Field::Cancel).get().getObject(); }
    JSC::JSObject* closeFunction() const { return internalField(Field::Close).get().getObject(); }
};

ALWAYS_INLINE JSC::JSPromise* JSDirectStreamSource::pull(JSC::JSGlobalObject* globalObject, const Bun::WebStreams::StreamAsyncContextScope&, JSC::JSValue controller)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    JSC::JSObject* pullMethod = pullFunction();
    if (!pullMethod) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "underlyingSource.pull is not a function"_s);
        return nullptr;
    }
    JSC::MarkedArgumentBuffer args;
    args.append(controller);
    JSC::JSValue result = JSC::call(globalObject, pullMethod, JSC::getCallData(pullMethod), thisValue(), args);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return dynamicDowncast<JSC::JSPromise>(result);
}

ALWAYS_INLINE JSC::JSPromise* JSDirectStreamSource::pull(JSC::JSGlobalObject* globalObject, JSReadableStream* stream, JSC::JSValue controller)
{
    Bun::WebStreams::StreamAsyncContextScope asyncContextScope(globalObject, stream);
    return pull(globalObject, asyncContextScope, controller);
}

} // namespace WebCore

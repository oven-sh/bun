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

#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

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

    const JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) const { return Base::internalField(static_cast<uint32_t>(field)); }

    bool hasPull() const { return pullFunction(); }
    // pull(controller) as a promise for internal reactions, or nullptr if it returned none; a throw propagates.
    JSC::JSPromise* pull(JSC::JSGlobalObject*, JSC::JSValue controller);
    // cancel(reason) in the stream's async context, as a promise (a throw rejects it).
    JSC::JSPromise* cancel(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue reason);
    // cancel(reason) for a sink that closed under the source: nothing waits for the result; a throw propagates.
    void cancelFromSink(JSC::JSGlobalObject*, JSC::JSValue reason);
    // close(reason); a throw propagates.
    void close(JSC::JSGlobalObject*, JSC::JSValue reason);

private:
    JSDirectStreamSource(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSC::JSValue underlyingSource, JSC::JSObject* pull, JSC::JSObject* cancel, JSC::JSObject* close);

    // Private: a promise that the source's functions return has to pass through reactionPromise().
    JSC::JSValue thisValue() const { return internalField(Field::UnderlyingSource).get(); }
    JSC::JSObject* pullFunction() const { return internalField(Field::Pull).get().getObject(); }
    JSC::JSObject* cancelFunction() const { return internalField(Field::Cancel).get().getObject(); }
    JSC::JSObject* closeFunction() const { return internalField(Field::Close).get().getObject(); }

    JSC::JSPromise* reactionPromise(JSC::JSGlobalObject* globalObject, JSC::JSPromise* returned) const
    {
        if (!Bun::WebStreams::promiseMayNeedFollower(globalObject, returned)) [[likely]]
            return returned;
        return reactionPromiseSlow(globalObject, returned);
    }
    JSC::JSPromise* reactionPromiseSlow(JSC::JSGlobalObject*, JSC::JSPromise* returned) const;
};

// Inline: a pull() that returns no promise costs what a direct call of the function costs.
ALWAYS_INLINE JSC::JSPromise* JSDirectStreamSource::pull(JSC::JSGlobalObject* globalObject, JSC::JSValue controller)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    JSC::JSObject* pullMethod = pullFunction();
    JSC::MarkedArgumentBuffer args;
    args.append(controller);
    JSC::JSValue result = JSC::call(globalObject, pullMethod ? JSC::JSValue(pullMethod) : JSC::jsUndefined(), thisValue(), args, "underlyingSource.pull is not a function"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* returned = dynamicDowncast<JSC::JSPromise>(result);
    if (!returned)
        return nullptr;
    RELEASE_AND_RETURN(scope, reactionPromise(globalObject, returned));
}

} // namespace WebCore

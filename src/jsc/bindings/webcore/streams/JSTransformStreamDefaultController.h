// JSTransformStreamDefaultController — the TransformStreamDefaultController instance cell.
// Not user-constructible. The algorithm slots are the TransformerKind tag + method/context
// members (no stored closures). Non-destructible (no WTF container).
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMConstructorNotConstructable.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSTransformStreamDefaultController final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    // Internal allocation entry point (setUpTransformStreamDefaultController*).
    static JSTransformStreamDefaultController* create(JSC::VM&, JSC::Structure*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream, m_finishPromise, m_transformer,
    // m_transformMethod, m_flushMethod, m_cancelMethod, m_algorithmContext.
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

    // Spec internal slots

    // [[stream]]
    JSC::WriteBarrier<JSTransformStream> m_stream;
    // [[finishPromise]] — unpopulated (null) ⇔ neither cancel nor flush has been invoked yet.
    JSC::WriteBarrier<JSC::JSPromise> m_finishPromise;

    // The algorithm machinery — replaces [[transformAlgorithm]], [[flushAlgorithm]],
    // [[cancelAlgorithm]].

    // Which arm runs transform/flush/cancel.
    TransformerKind m_transformerKind { TransformerKind::Identity };
    // JavaScript kind only: the user transformer object (the call `this`).
    JSC::WriteBarrier<JSC::Unknown> m_transformer;
    // JavaScript kind only: converted `transform` method; null ⇒ the identity algorithm.
    JSC::WriteBarrier<JSC::JSObject> m_transformMethod;
    // JavaScript kind only: converted `flush` method; null ⇒ the trivial algorithm.
    JSC::WriteBarrier<JSC::JSObject> m_flushMethod;
    // JavaScript kind only: converted `cancel` method; null ⇒ the trivial algorithm.
    JSC::WriteBarrier<JSC::JSObject> m_cancelMethod;
    // NON-JavaScript kinds only: TextEncoder → the JSTextEncoderStream cell;
    // TextDecoder → the JSTextDecoderStream cell.
    JSC::WriteBarrier<JSC::JSCell> m_algorithmContext;

private:
    JSTransformStreamDefaultController(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

// Construct throws `TypeError: Illegal constructor`; the constructor object is still
// installed on globalThis so instanceof / .prototype work.
using JSTransformStreamDefaultControllerConstructor = JSDOMConstructorNotConstructable<JSTransformStreamDefaultController>;

} // namespace WebCore

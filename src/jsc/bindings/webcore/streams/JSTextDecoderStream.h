// JSTextDecoderStream — the TextDecoderStream instance cell: it is
// TransformerKind::TextDecoder's algorithmContext, and the transform/flush algorithms are
// native code over m_decoder ({stream:true} decodes, then a final {stream:false} flush).
// Non-destructible: the decoder state is held as the TextDecoder WRAPPER CELL (a
// WriteBarrier), not a RefPtr.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSObject.h>

namespace WebCore {

class JSTextDecoderStream final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSTextDecoderStream* create(JSC::VM&, JSC::Structure*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_transform, m_decoder.
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

    // the inner TransformStream (created by createTransformStream with
    // TransformerKind::TextDecoder and `this` as the algorithm context).
    JSC::WriteBarrier<JSTransformStream> m_transform;
    // the native TextDecoder wrapper cell, constructed as
    // `new TextDecoder(label, {fatal, ignoreBOM})` at TextDecoderStream construction; the
    // `encoding` / `fatal` / `ignoreBOM` getters delegate to it.
    JSC::WriteBarrier<JSC::JSObject> m_decoder;

private:
    JSTextDecoderStream(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

using JSTextDecoderStreamConstructor = JSStreamConstructor<JSTextDecoderStream>;

} // namespace WebCore

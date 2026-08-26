// JSTextEncoderStream — the TextEncoderStream instance cell. A JSTransformStream
// subclass whose transform/flush arms drive the Rust TextEncoderStreamEncoder
// (m_encoder) directly.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "JSTransformStream.h"
#include "StreamConstructor.h"

namespace WebCore {

class JSTextEncoderStream final : public JSTransformStream {
public:
    using Base = JSTransformStream;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSTextEncoderStream* create(JSC::VM&, JSC::Structure*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // the Rust TextEncoderStreamEncoder (lone-surrogate state + reusable scratch). Freed
    // eagerly at ClearAlgorithms; a vm.heap.addFinalizer registered in the constructor is
    // the idempotent fallback for an abandoned stream.
    void* m_encoder { nullptr };

private:
    JSTextEncoderStream(JSC::VM&, JSC::Structure*);
};

using JSTextEncoderStreamConstructor = JSStreamConstructor<JSTextEncoderStream>;

} // namespace WebCore

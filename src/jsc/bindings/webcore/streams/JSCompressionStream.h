// JSCompressionStream — the CompressionStream instance cell. A JSTransformStream
// subclass whose controller's transformerKind drives the Rust CompressionStreamCoder
// (m_coder) directly.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "JSTransformStream.h"
#include "StreamConstructor.h"

namespace WebCore {

class JSCompressionStream final : public JSTransformStream {
public:
    using Base = JSTransformStream;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSCompressionStream* create(JSC::VM&, JSC::Structure*);

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

    // The Rust CompressionStreamCoder this cell owns outright. Freed eagerly
    // (CompressionStreamCoder__destroy) at ClearAlgorithms (post-flush / error /
    // cancel); a vm.heap.addFinalizer registered in the constructor is the
    // idempotent fallback. An in-flight off-thread step owns the codec state
    // and hands it back through CompressionStreamCoder__restore.
    void* m_coder { nullptr };

private:
    JSCompressionStream(JSC::VM&, JSC::Structure*);
};

using JSCompressionStreamConstructor = JSStreamConstructor<JSCompressionStream>;

} // namespace WebCore

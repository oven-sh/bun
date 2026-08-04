// JSDecompressionStream — the DecompressionStream instance cell. A JSTransformStream
// subclass whose controller's transformerKind drives the Rust CompressionStreamCoder
// (m_coder) directly.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "JSTransformStream.h"
#include "StreamConstructor.h"

namespace WebCore {

class JSDecompressionStream final : public JSTransformStream {
public:
    using Base = JSTransformStream;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSDecompressionStream* create(JSC::VM&, JSC::Structure*);

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

    void* m_coder { nullptr };

private:
    JSDecompressionStream(JSC::VM&, JSC::Structure*);
};

using JSDecompressionStreamConstructor = JSStreamConstructor<JSDecompressionStream>;

} // namespace WebCore

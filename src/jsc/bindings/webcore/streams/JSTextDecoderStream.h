// JSTextDecoderStream — the TextDecoderStream instance cell. A JSTransformStream
// subclass whose transform/flush arms drive the Rust TextDecoder (m_decoder)
// directly.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "JSTransformStream.h"
#include "StreamConstructor.h"

namespace WebCore {

class JSTextDecoderStream final : public JSTransformStream {
public:
    using Base = JSTransformStream;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSTextDecoderStream* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

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

    // the Rust TextDecoder (encoding state, BOM / partial-sequence buffering); freed by destroy().
    void* m_decoder { nullptr };
    bool m_fatal { false };
    bool m_ignoreBOM { false };

private:
    JSTextDecoderStream(JSC::VM&, JSC::Structure*);
    ~JSTextDecoderStream();
};

using JSTextDecoderStreamConstructor = JSStreamConstructor<JSTextDecoderStream>;

} // namespace WebCore

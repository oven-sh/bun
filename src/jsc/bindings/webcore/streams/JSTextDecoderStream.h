// JSTextDecoderStream — the TextDecoderStream instance cell. A JSTransformStream
// subclass whose transform/flush arms drive the Rust TextDecoder (m_decoder)
// directly.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "JSTransformStream.h"
#include "StreamConstructor.h"

// TextDecoder.rs
BUN_DECLARE_FFI_DELETER(TextDecoderForStream, TextDecoder__destroyForStream);

namespace WebCore {

class JSTextDecoderStream final : public JSTransformStream {
public:
    using Base = JSTransformStream;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSTextDecoderStream* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell* cell) { static_cast<JSTextDecoderStream*>(cell)->~JSTextDecoderStream(); }

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

    // Null for the utf-8 non-fatal fast path, which uses m_utf8State instead. Freed eagerly at ClearAlgorithms.
    std::unique_ptr<TextDecoderForStream> m_decoder;
    // The Rust `EncodingLabel`. The .encoding getter reads this, never m_decoder.
    uint8_t m_encoding { 0 };
    // utf-8 non-fatal fast path (shared with Body.textStream()).
    Bun::WebStreams::StreamingUTF8DecodeState m_utf8State;
    bool m_fatal { false };
    bool m_ignoreBOM { false };

private:
    JSTextDecoderStream(JSC::VM&, JSC::Structure*);
};

using JSTextDecoderStreamConstructor = JSStreamConstructor<JSTextDecoderStream>;

} // namespace WebCore

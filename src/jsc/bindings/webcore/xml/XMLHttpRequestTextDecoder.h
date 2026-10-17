#pragma once

#include "StreamsForward.h"
#include <span>
#include <wtf/RefCounted.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class ScriptExecutionContext;

// Stands where upstream has TextResourceDecoder: https://encoding.spec.whatwg.org/#decode for bytes that come in pieces, done by Bun's TextDecoder.
class XMLHttpRequestTextDecoder final : public RefCounted<XMLHttpRequestTextDecoder> {
public:
    // A byte order mark wins over `label`. Without either, or with a label that no encoding has, the text is UTF-8.
    static Ref<XMLHttpRequestTextDecoder> create(ScriptExecutionContext&, const String& label);
    // The same, but before UTF-8 comes the encoding that the XML declaration names.
    static Ref<XMLHttpRequestTextDecoder> createForXML(ScriptExecutionContext&, const String& label);
    // https://encoding.spec.whatwg.org/#utf-8-decode
    static Ref<XMLHttpRequestTextDecoder> createAlwaysUsingUTF8(ScriptExecutionContext&);
    ~XMLHttpRequestTextDecoder();

    String decode(std::span<const uint8_t>);
    String flush();

private:
    XMLHttpRequestTextDecoder(ScriptExecutionContext&, const String& label, bool hasChosenEncoding, bool looksForXMLDeclaration = false);

    String decode(std::span<const uint8_t>, bool isLast);
    bool chooseEncoding(JSC::JSGlobalObject&, const String& label);

    WeakPtr<ScriptExecutionContext> m_context;
    String m_label;
    bool m_hasChosenEncoding;
    bool m_looksForXMLDeclaration;
    Vector<uint8_t, 2> m_heldBackBytes; // The start of what may become a byte order mark or an XML declaration.
    void* m_decoder { nullptr }; // Null for UTF-8.
    Bun::WebStreams::StreamingUTF8DecodeState m_utf8State;
};

} // namespace WebCore

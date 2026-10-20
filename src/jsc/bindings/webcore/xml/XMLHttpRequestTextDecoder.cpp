#include "config.h"
#include "XMLHttpRequestTextDecoder.h"

#include "JSDOMGlobalObject.h"
#include "ScriptExecutionContext.h"
#include "WebStreamsInternals.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>

// Bun's TextDecoder without its wrapper. For UTF-8 that is not fatal there is no decoder: the caller decodes.
extern "C" void* TextDecoder__createForStream(JSC::JSGlobalObject*, JSC::EncodedJSValue label, bool fatal, bool ignoreBOM, bool* isUTF8, uint8_t* encoding);
extern "C" JSC::EncodedJSValue TextDecoder__decodeForStream(void* decoder, JSC::JSGlobalObject*, const uint8_t* input, size_t length, bool stream);
extern "C" void TextDecoder__destroyForStream(void* decoder);

namespace WebCore {

using namespace JSC;

Ref<XMLHttpRequestTextDecoder> XMLHttpRequestTextDecoder::create(ScriptExecutionContext& context, const String& label)
{
    return adoptRef(*new XMLHttpRequestTextDecoder(context, label, false));
}

Ref<XMLHttpRequestTextDecoder> XMLHttpRequestTextDecoder::createForXML(ScriptExecutionContext& context, const String& label)
{
    return adoptRef(*new XMLHttpRequestTextDecoder(context, label, false, true));
}

Ref<XMLHttpRequestTextDecoder> XMLHttpRequestTextDecoder::createAlwaysUsingUTF8(ScriptExecutionContext& context)
{
    return adoptRef(*new XMLHttpRequestTextDecoder(context, { }, true));
}

XMLHttpRequestTextDecoder::XMLHttpRequestTextDecoder(ScriptExecutionContext& context, const String& label, bool hasChosenEncoding, bool looksForXMLDeclaration)
    : m_context(context)
    , m_label(label)
    , m_hasChosenEncoding(hasChosenEncoding)
    , m_looksForXMLDeclaration(looksForXMLDeclaration)
{
}

XMLHttpRequestTextDecoder::~XMLHttpRequestTextDecoder()
{
    TextDecoder__destroyForStream(m_decoder);
}

// https://encoding.spec.whatwg.org/#bom-sniff
static ASCIILiteral encodingOfByteOrderMark(std::span<const uint8_t> bytes)
{
    if (bytes.size() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
        return "utf-8"_s;
    if (bytes.size() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
        return "utf-16be"_s;
    if (bytes.size() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
        return "utf-16le"_s;
    return { };
}

static bool mayBecomeByteOrderMark(std::span<const uint8_t> bytes)
{
    if (bytes.size() == 1)
        return bytes[0] == 0xEF || bytes[0] == 0xFE || bytes[0] == 0xFF;
    return bytes.size() == 2 && bytes[0] == 0xEF && bytes[1] == 0xBB;
}

// Returns the position of the encoding string.
static size_t findXMLEncoding(std::span<const uint8_t> string, size_t& encodingLength)
{
    size_t position = find(string, byteCast<uint8_t>("encoding"_span));
    if (position == notFound)
        return notFound;
    position += 8;

    // Skip spaces and stray control characters.
    while (position < string.size() && string[position] <= ' ')
        ++position;

    // Skip equals sign.
    if (position >= string.size() || string[position] != '=')
        return notFound;
    ++position;

    // Skip spaces and stray control characters.
    while (position < string.size() && string[position] <= ' ')
        ++position;

    // Skip quotation mark.
    if (position >= string.size())
        return notFound;
    char quoteMark = string[position];
    if (quoteMark != '"' && quoteMark != '\'')
        return notFound;
    ++position;

    // Find the trailing quotation mark.
    size_t end = position;
    while (end < string.size() && string[end] != quoteMark)
        ++end;
    if (end >= string.size())
        return notFound;

    encodingLength = end - position;
    return position;
}

// The XML half of TextResourceDecoder::checkForHeadCharset(). Nothing if more bytes are needed to tell, a null string if the bytes do not say.
static std::optional<String> encodingOfXMLDeclaration(std::span<const uint8_t> bytes, bool isLast)
{
    static constexpr size_t longestDeclaration = 1024;

    // Is there enough data available to check for XML declaration?
    if (bytes.size() < 8)
        return isLast ? std::optional { String { } } : std::nullopt;

    static constexpr std::array<uint8_t, 5> xmlPrefix { '<', '?', 'x', 'm', 'l' };
    static constexpr std::array<uint8_t, 6> xmlPrefixLittleEndian { '<', 0, '?', 0, 'x', 0 };
    static constexpr std::array<uint8_t, 6> xmlPrefixBigEndian { 0, '<', 0, '?', 0, 'x' };
    if (spanHasPrefix(bytes, std::span { xmlPrefixLittleEndian }))
        return String { "utf-16le"_s };
    if (spanHasPrefix(bytes, std::span { xmlPrefixBigEndian }))
        return String { "utf-16be"_s };
    if (!spanHasPrefix(bytes, std::span { xmlPrefix }))
        return String { };

    size_t xmlDeclarationEnd = find(bytes, '>');
    if (xmlDeclarationEnd == notFound)
        return isLast || bytes.size() > longestDeclaration ? std::optional { String { } } : std::nullopt;

    size_t length = 0;
    size_t position = findXMLEncoding(bytes.first(xmlDeclarationEnd), length);
    if (position == notFound)
        return String { };

    // A declaration that can be read byte by byte is not in the UTF-16 it names.
    String label { byteCast<Latin1Character>(bytes.subspan(position, length)) };
    return label.startsWithIgnoringASCIICase("utf-16"_s) ? String { } : label;
}

// False if no encoding has the label. The text is UTF-8 then.
bool XMLHttpRequestTextDecoder::chooseEncoding(JSGlobalObject& globalObject, const String& label)
{
    m_hasChosenEncoding = true;
    if (label.isEmpty())
        return false;

    auto& vm = globalObject.vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    bool isUTF8 = false;
    uint8_t encoding = 0;
    m_decoder = TextDecoder__createForStream(&globalObject, JSValue::encode(jsString(vm, label)), false, false, &isUTF8, &encoding);
    (void)scope.tryClearException();
    return m_decoder || isUTF8;
}

String XMLHttpRequestTextDecoder::decode(std::span<const uint8_t> bytes)
{
    return decode(bytes, false);
}

String XMLHttpRequestTextDecoder::flush()
{
    return decode({ }, true);
}

String XMLHttpRequestTextDecoder::decode(std::span<const uint8_t> bytes, bool isLast)
{
    auto* globalObject = m_context ? m_context->globalObject() : nullptr;
    if (!globalObject)
        return emptyString();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());

    Vector<uint8_t> joined;
    if (!m_hasChosenEncoding) {
        if (!m_heldBackBytes.isEmpty()) {
            joined.appendVector(std::exchange(m_heldBackBytes, { }));
            joined.append(bytes);
            bytes = joined.span();
        }
        if (bytes.empty() && !isLast)
            return emptyString();
        if (!isLast && mayBecomeByteOrderMark(bytes)) {
            m_heldBackBytes.append(bytes);
            return emptyString();
        }
        auto byteOrderMarkEncoding = encodingOfByteOrderMark(bytes);
        if (!chooseEncoding(*globalObject, byteOrderMarkEncoding.isNull() ? m_label : String { byteOrderMarkEncoding }) && m_looksForXMLDeclaration) {
            auto declaredEncoding = encodingOfXMLDeclaration(bytes, isLast);
            if (!declaredEncoding) {
                m_hasChosenEncoding = false;
                m_heldBackBytes.append(bytes);
                return emptyString();
            }
            chooseEncoding(*globalObject, *declaredEncoding);
        }
    }

    JSValue decoded;
    if (m_decoder)
        decoded = JSValue::decode(TextDecoder__decodeForStream(m_decoder, globalObject, bytes.data(), bytes.size(), !isLast));
    else
        decoded = Bun::WebStreams::streamingUTF8Decode(globalObject, bytes, m_utf8State, isLast);

    auto text = !scope.exception() && decoded && decoded.isString() ? decoded.getString(globalObject) : emptyString();
    (void)scope.tryClearException();
    return text;
}

} // namespace WebCore

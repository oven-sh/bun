#include "root.h"

/*
 * Wrapper functions for Text Codecs to allow access from Zig
 */

#include "TextCodec.h"
#include "TextCodecSingleByte.h"
#include "TextCodecCJK.h"
// TextCodecICU removed - ICU data not available
#include "TextCodecReplacement.h"
#include "TextCodecUserDefined.h"
#include "TextEncodingRegistry.h"
#include "TextEncoding.h"
#include "headers-handwritten.h"
#include <wtf/text/StringView.h>
#include <wtf/text/WTFString.h>
#include <memory>
#include <span>
#include <cstring>

using namespace PAL;

extern "C" {

// Create codec for a specific encoding
void* Bun__createTextCodec(const char* encodingName, size_t encodingNameLen)
{
    std::span<const char> span(encodingName, encodingNameLen);
    StringView encodingView(span);
    TextEncoding encoding(encodingView);

    if (!encoding.isValid())
        return nullptr;

    auto codec = newTextCodec(encoding);
    if (!codec)
        return nullptr;

    return codec.release();
}

// Decode bytes using a codec and return as BunString
BunString Bun__decodeWithTextCodec(void* codecPtr, const uint8_t* data, size_t length, bool flush, bool stopOnError, bool* outSawError)
{
    if (!codecPtr || !outSawError) {
        if (outSawError) *outSawError = false;
        return { BunStringTag::Empty, {} };
    }

    TextCodec* codec = static_cast<TextCodec*>(codecPtr);
    bool sawError = false;

    std::span<const uint8_t> span(data, length);
    String result = codec->decode(span, flush, stopOnError, sawError);

    *outSawError = sawError;

    // Convert WTF::String to BunString
    // This properly manages the memory using WTF's reference counting
    return Bun::toStringRef(result);
}

// Delete a codec
void Bun__deleteTextCodec(void* codecPtr)
{
    if (codecPtr) {
        TextCodec* codec = static_cast<TextCodec*>(codecPtr);
        delete codec;
    }
}

// Strip BOM from codec
void Bun__stripBOMFromTextCodec(void* codecPtr)
{
    if (codecPtr) {
        TextCodec* codec = static_cast<TextCodec*>(codecPtr);
        codec->stripByteOrderMark();
    }
}

// Check if an encoding is supported
bool Bun__isEncodingSupported(const char* encodingName, size_t encodingNameLen)
{
    std::span<const char> span(encodingName, encodingNameLen);
    StringView encodingView(span);
    TextEncoding encoding(encodingView);
    return encoding.isValid();
}

// Get canonical encoding name
const char* Bun__getCanonicalEncodingName(const char* encodingName, size_t encodingNameLen, size_t* outLen)
{
    std::span<const char> span(encodingName, encodingNameLen);
    StringView encodingView(span);
    TextEncoding encoding(encodingView);

    if (!encoding.isValid()) {
        *outLen = 0;
        return nullptr;
    }

    const char* name = encoding.name();
    *outLen = strlen(name);
    return name;
}

} // extern "C"

#include "root.h"

#include "TextCodec.h"
#include "TextEncodingRegistry.h"
#include "TextEncoding.h"
#include "headers-handwritten.h"
namespace Bun {

using namespace PAL;
using namespace WTF;

class WebKitTextCodec {
    WTF_MAKE_FAST_ALLOCATED;

public:
    std::unique_ptr<TextCodec> codec;

    static WebKitTextCodec* create(std::span<const LChar> encodingLabel)
    {
        return new WebKitTextCodec(newTextCodec(TextEncoding(StringView(encodingLabel))));
    }
};

extern "C" WebKitTextCodec* WebKitTextCodec__create(const LChar* ptr, size_t len)
{

    auto label = std::span<const LChar>(ptr, len);
    return WebKitTextCodec::create(label);
}

extern "C" void WebKitTextCodec__deinit(WebKitTextCodec* codec)
{
    delete codec;
}

extern "C" BunString WebKitTextCodec__decode(WebKitTextCodec* code, const uint8_t* input_ptr, size_t input_len, bool flush, bool* stopOnError)
{
    const std::span<const uint8_t> data = { input_ptr, input_len };
    auto str = code->codec->decode(data, flush, stopOnError, *stopOnError);
    return Bun::toStringRef(str);
}

extern "C" void WebKitTextCodec__stripByteOrderMark(WebKitTextCodec* code)
{
    code->codec->stripByteOrderMark();
}

}

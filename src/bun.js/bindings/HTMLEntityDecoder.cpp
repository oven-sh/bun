#include "root.h"
#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>

extern "C" bool Bun__decodeEntity(const BunString* in, BunString* out);

namespace Bun {
using namespace JSC;
using namespace WTF;

JSC_DEFINE_HOST_FUNCTION(jsFunctionDecodeHTMLEntity, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue arg = callFrame->argument(0);
    String input = arg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    StringBuilder builder;
    builder.reserveCapacity(input.length());
    size_t index = 0;
    while (true) {
        size_t amp = input.find('&', index);
        if (amp == WTF::notFound) {
            builder.append(input.substring(index));
            break;
        }
        builder.append(input.substring(index, amp - index));
        size_t semi = input.find(';', amp + 1);
        if (semi == WTF::notFound) {
            builder.append(input.substring(amp));
            break;
        }
        size_t len = semi - amp - 1;
        if (len == 0) {
            builder.append(input.substring(amp, semi - amp + 1));
            index = semi + 1;
            continue;
        }
        BunString bunIn;
        if (input.is8Bit()) {
            auto span = input.span8().subspan(amp + 1, len);
            bunIn = BunString__fromLatin1(reinterpret_cast<const char*>(span.data()), span.size());
        } else {
            auto span = input.span16().subspan(amp + 1, len);
            bunIn = BunString__fromUTF16(span.data(), span.size());
        }
        BunString bunOut;
        bool ok = Bun__decodeEntity(&bunIn, &bunOut);
        if (ok) {
            builder.append(bunOut.toWTFString(BunString::NonNull));
        } else {
            builder.append(input.substring(amp, semi - amp + 1));
        }
        index = semi + 1;
    }

    return JSValue::encode(jsString(vm, builder.toString()));
}

} // namespace Bun

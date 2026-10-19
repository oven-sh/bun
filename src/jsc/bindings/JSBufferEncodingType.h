#pragma once

#include "root.h"
#include "BufferEncodingType.h"
#include "JSDOMConvertEnumeration.h"

namespace WebCore {

template<> JSC::JSString* convertEnumerationToJS(JSC::JSGlobalObject&, BufferEncodingType);

template<> std::optional<BufferEncodingType> parseEnumeration<BufferEncodingType>(JSC::JSGlobalObject&, JSValue);
std::optional<BufferEncodingType> parseEnumerationAllowBuffer(JSC::JSGlobalObject&, JSValue);
template<> std::optional<BufferEncodingType> parseEnumerationFromString(const WTF::String&);
template<> std::optional<BufferEncodingType> parseEnumerationFromView(const WTF::StringView&);
std::optional<BufferEncodingType> normalizeEncodingOfNonString(JSC::JSGlobalObject&, JSValue);

// Node's normalizeEncoding(): https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util.js#L258-L315
ALWAYS_INLINE std::optional<BufferEncodingType> normalizeEncoding(JSC::JSGlobalObject& lexicalGlobalObject, JSValue value)
{
    if (value.isUndefinedOrNull())
        return BufferEncodingType::utf8;
    if (auto encoding = parseEnumeration<BufferEncodingType>(lexicalGlobalObject, value))
        return encoding;
    if (value.isString())
        return asString(value)->length() ? std::nullopt : std::optional { BufferEncodingType::utf8 };
    return normalizeEncodingOfNonString(lexicalGlobalObject, value);
}

} // namespace WebCore

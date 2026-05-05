#include "root.h"
#include "BufferEncodingType.h"
#include "JSDOMConvertEnumeration.h"

namespace WebCore {

String convertEnumerationToString(BufferEncodingType);
template<> JSC::JSString* convertEnumerationToJS(JSC::JSGlobalObject&, BufferEncodingType);

template<> std::optional<BufferEncodingType> parseEnumeration<BufferEncodingType>(JSC::JSGlobalObject&, JSValue);
std::optional<BufferEncodingType> parseEnumerationAllowBuffer(JSC::JSGlobalObject&, JSValue);
template<> std::optional<BufferEncodingType> parseEnumerationFromString(const WTF::String&);
template<> std::optional<BufferEncodingType> parseEnumerationFromView(const WTF::StringView&);
template<> WTF::ASCIILiteral expectedEnumerationValues<BufferEncodingType>();

template<bool allowBuffer>
std::optional<BufferEncodingType> validateBufferEncoding(JSC::JSGlobalObject&, JSValue);

} // namespace WebCore

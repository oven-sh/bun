#include "root.h"
#include "BufferEncodingType.h"
#include "JSDOMConvertEnumeration.h"

namespace WebCore {

String convertEnumerationToString(BufferEncodingType);
template<> JSC::JSString* convertEnumerationToJS(JSC::JSGlobalObject&, BufferEncodingType);

template<> std::optional<BufferEncodingType> parseEnumeration<BufferEncodingType>(JSC::JSGlobalObject&, JSValue);
template<> std::optional<BufferEncodingType> parseEnumerationFromString(const WTF::String&);
template<> std::optional<BufferEncodingType> parseEnumerationFromView(const WTF::StringView&);
template<> WTF::ASCIILiteral expectedEnumerationValues<BufferEncodingType>();

} // namespace WebCore

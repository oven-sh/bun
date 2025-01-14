#include "root.h"
#include "BufferEncodingType.h"
#include "JSDOMConvertEnumeration.h"

namespace WebCore {

String convertEnumerationToString(BufferEncodingType);
template<> JSC::JSString* convertEnumerationToJS(JSC::JSGlobalObject&, BufferEncodingType);

template<> std::optional<BufferEncodingType> parseEnumeration<BufferEncodingType>(JSC::JSGlobalObject&, JSValue);
std::optional<BufferEncodingType> parseEnumeration2(JSC::JSGlobalObject&, const WTF::StringView);
template<> WTF::ASCIILiteral expectedEnumerationValues<BufferEncodingType>();

} // namespace WebCore

#include "root.h"
#include "BufferEncodingType.h"
#include "JSDOMConvertEnumeration.h"

namespace WebCore {

String convertEnumerationToString(BufferEncodingType);
template<> JSC::JSString* convertEnumerationToJS(JSC::JSGlobalObject&, BufferEncodingType);

template<> std::optional<BufferEncodingType> parseEnumeration<BufferEncodingType>(JSC::JSGlobalObject&, JSC::JSValue);
template<> const char* expectedEnumerationValues<BufferEncodingType>();

} // namespace WebCore
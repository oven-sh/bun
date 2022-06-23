#include "wtf-bindings.h"
#include "wtf/text/Base64.h"

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length)
{
    WTF::copyLCharsFromUCharSource(destination, source, length);
}

extern "C" JSC::EncodedJSValue WTF__toBase64URLStringValue(const uint8_t* bytes, size_t length, JSC::JSGlobalObject* globalObject)
{
    WTF::String string = WTF::base64URLEncodeToString(reinterpret_cast<const LChar*>(bytes), static_cast<unsigned int>(length));
    string.impl()->ref();
    return JSC::JSValue::encode(JSC::jsString(globalObject->vm(), string));
}
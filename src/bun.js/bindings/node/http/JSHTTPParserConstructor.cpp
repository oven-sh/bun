#include "JSHTTPParserConstructor.h"
#include "JSHTTPParser.h"
#include "ZigGlobalObject.h"
#include "ProcessBindingHTTPParser.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSHTTPParserConstructor::s_info = { "HTTPParser"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHTTPParserConstructor) };

JSC_DEFINE_HOST_FUNCTION(callHTTPParser, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(constructHTTPParser, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    Structure* structure = globalObject->m_JSHTTPParserClassStructure.get(globalObject);
    JSHTTPParser* HTTPParser = JSHTTPParser::create(vm, structure, globalObject);

    return JSValue::encode(HTTPParser);
}

void JSHTTPParserConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 0, "HTTPParser"_s);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

    putDirect(vm, Identifier::fromString(vm, "REQUEST"_s), jsNumber(HTTP_REQUEST));
    putDirect(vm, Identifier::fromString(vm, "RESPONSE"_s), jsNumber(HTTP_RESPONSE));

    putDirect(vm, Identifier::fromString(vm, "kOnMessageBegin"_s), jsNumber(kOnMessageBegin));
    putDirect(vm, Identifier::fromString(vm, "kOnHeaders"_s), jsNumber(kOnHeaders));
    putDirect(vm, Identifier::fromString(vm, "kOnHeadersComplete"_s), jsNumber(kOnHeadersComplete));
    putDirect(vm, Identifier::fromString(vm, "kOnBody"_s), jsNumber(kOnBody));
    putDirect(vm, Identifier::fromString(vm, "kOnMessageComplete"_s), jsNumber(kOnMessageComplete));
    putDirect(vm, Identifier::fromString(vm, "kOnExecute"_s), jsNumber(kOnExecute));
    putDirect(vm, Identifier::fromString(vm, "kOnTimeout"_s), jsNumber(kOnTimeout));

    putDirect(vm, Identifier::fromString(vm, "kLenientNone"_s), jsNumber(kLenientNone));
    putDirect(vm, Identifier::fromString(vm, "kLenientHeaders"_s), jsNumber(kLenientHeaders));
    putDirect(vm, Identifier::fromString(vm, "kLenientChunkedLength"_s), jsNumber(kLenientChunkedLength));
    putDirect(vm, Identifier::fromString(vm, "kLenientKeepAlive"_s), jsNumber(kLenientKeepAlive));
    putDirect(vm, Identifier::fromString(vm, "kLenientTransferEncoding"_s), jsNumber(kLenientTransferEncoding));
    putDirect(vm, Identifier::fromString(vm, "kLenientVersion"_s), jsNumber(kLenientVersion));
    putDirect(vm, Identifier::fromString(vm, "kLenientDataAfterClose"_s), jsNumber(kLenientDataAfterClose));
    putDirect(vm, Identifier::fromString(vm, "kLenientOptionalLFAfterCR"_s), jsNumber(kLenientOptionalLFAfterCR));
    putDirect(vm, Identifier::fromString(vm, "kLenientOptionalCRLFAfterChunk"_s), jsNumber(kLenientOptionalCRLFAfterChunk));
    putDirect(vm, Identifier::fromString(vm, "kLenientOptionalCRBeforeLF"_s), jsNumber(kLenientOptionalCRBeforeLF));
    putDirect(vm, Identifier::fromString(vm, "kLenientSpacesAfterChunkSize"_s), jsNumber(kLenientSpacesAfterChunkSize));
    putDirect(vm, Identifier::fromString(vm, "kLenientAll"_s), jsNumber(kLenientAll));
}

} // namespace Bun

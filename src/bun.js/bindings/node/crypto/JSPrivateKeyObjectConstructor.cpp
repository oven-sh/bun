#include "JSPrivateKeyObjectConstructor.h"
#include "JSPrivateKeyObject.h"
#include "ErrorCode.h"
#include "JSBufferEncodingType.h"
#include "NodeValidator.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include "CryptoUtil.h"
#include "openssl/dh.h"
#include "openssl/bn.h"
#include "openssl/err.h"
#include "ncrypto.h"

using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

namespace Bun {

const JSC::ClassInfo JSPrivateKeyObjectConstructor::s_info = { "PrivateKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPrivateKeyObjectConstructor) };

JSC_DEFINE_HOST_FUNCTION(callPrivateKeyObject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(lexicalGlobalObject, scope, "Cannot call PrivateKeyObject class constructor without |new|"_s);
    return JSValue::encode({});
}

JSC_DEFINE_HOST_FUNCTION(constructPrivateKeyObject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    // auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSValue handleValue = callFrame->argument(0);
    // constructing a PrivateKeyObject is impossible
    return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "handle"_s, "object"_s, handleValue);

    // JSKeyObjectHandle* handle = jsDynamicCast<JSKeyObjectHandle*>(handleValue);
    // if (!handle) {
    //     return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "handle"_s, "object"_s, handleValue);
    // }

    // Structure* structure = globalObject->m_JSPrivateKeyObjectClassStructure.get(lexicalGlobalObject);
    // JSPrivateKeyObject* instance = JSPrivateKeyObject::create(vm, structure, lexicalGlobalObject, KeyObject::Type::Private, handle);

    // return JSValue::encode(instance);
}

} // namespace Bun

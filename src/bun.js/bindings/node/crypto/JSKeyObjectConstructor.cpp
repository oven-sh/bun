#include "JSKeyObjectConstructor.h"
#include "JSKeyObject.h"
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
#include "JSKeyObjectHandle.h"

using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

namespace Bun {

const JSC::ClassInfo JSKeyObjectConstructor::s_info = { "KeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSKeyObjectConstructor) };

JSC_DEFINE_HOST_FUNCTION(callKeyObject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(lexicalGlobalObject, scope, "Cannot call KeyObject class constructor without |new|"_s);
    return JSValue::encode({});
}

JSC_DEFINE_HOST_FUNCTION(constructKeyObject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    // auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSValue typeValue = callFrame->argument(0);

    // KeyObject::Type type;
    if (!typeValue.isString()) {
        // always INVALID_ARG_VALUE
        // https://github.com/nodejs/node/blob/e1fabe4f58722af265d11081b91ce287f90738f4/lib/internal/crypto/keys.js#L108
        return ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "type"_s, typeValue);
    }

    JSString* typeString = typeValue.toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));
    GCOwnedDataScope<WTF::StringView> typeView = typeString->view(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    if (typeView == "secret"_s) {
        // type = KeyObject::Type::Secret;
    } else if (typeView == "public"_s) {
        // type = KeyObject::Type::Public;
    } else if (typeView == "private"_s) {
        // type = KeyObject::Type::Private;
    } else {
        return ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "type"_s, typeValue);
    }

    JSValue handleValue = callFrame->argument(1);
    // constructing a KeyObject is impossible
    return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "handle"_s, "object"_s, handleValue);

    // if (JSKeyObjectHandle* handle = jsDynamicCast<JSKeyObjectHandle*>(handleValue)) {
    //     Structure* structure = globalObject->m_JSKeyObjectClassStructure.get(lexicalGlobalObject);
    //     JSKeyObject* instance = JSKeyObject::create(vm, structure, lexicalGlobalObject, type, handle);
    //     return JSValue::encode(instance);
    // }

    // return ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "handle"_s, "object"_s, handleValue);
}

} // namespace Bun

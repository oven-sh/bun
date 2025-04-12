#include "CryptoKeys.h"
#include "NodeValidator.h"
#include "ErrorCode.h"
#include "CryptoUtil.h"
#include "JSSecretKeyObject.h"
#include "JSPublicKeyObject.h"
#include "JSPrivateKeyObject.h"

using namespace JSC;

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsCreateSecretKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    JSValue keyValue = callFrame->argument(0);
    JSValue encodingValue = callFrame->argument(1);

    WTF::Vector<uint8_t> symmetricKey;
    prepareSecretKey(lexicalGlobalObject, scope, symmetricKey, keyValue, encodingValue, true);
    RETURN_IF_EXCEPTION(scope, JSValue::encode({}));

    Structure* structure = globalObject->m_JSSecretKeyObjectClassStructure.get(lexicalGlobalObject);

    KeyObject keyObject = KeyObject::create(WTFMove(symmetricKey));
    JSSecretKeyObject* secretKey = JSSecretKeyObject::create(vm, structure, lexicalGlobalObject, WTFMove(keyObject));

    return JSValue::encode(secretKey);
}

JSC_DEFINE_HOST_FUNCTION(jsCreatePublicKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsCreatePrivateKey, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    return JSValue::encode(jsUndefined());
}

} // namespace Bun

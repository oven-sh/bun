#include "JSPublicKeyObjectPrototype.h"
#include "JSPublicKeyObject.h"
#include "ErrorCode.h"
#include "CryptoUtil.h"
#include "BunProcess.h"
#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>

using namespace Bun;
using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

JSC_DECLARE_HOST_FUNCTION(jsPublicKeyObjectPrototype_export);

const JSC::ClassInfo JSPublicKeyObjectPrototype::s_info = { "PublicKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPublicKeyObjectPrototype) };

// asymmetricKeyType/asymmetricKeyDetails/toCryptoKey live on the shared AsymmetricKeyObject
// prototype (JSAsymmetricKeyObjectPrototype.cpp), matching Node's prototype chain.
static const JSC::HashTableValue JSPublicKeyObjectPrototypeTableValues[] = {
    { "export"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsPublicKeyObjectPrototype_export, 1 } },
};

void JSPublicKeyObjectPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSPublicKeyObjectPrototype::info(), JSPublicKeyObjectPrototypeTableValues, *this);

    // intentionally inherit KeyObject's toStringTag
    // https://github.com/nodejs/node/blob/95b0f9d448832eeb75586c89fab0777a1a4b0610/lib/internal/crypto/keys.js#L146
}

JSC_DEFINE_HOST_FUNCTION(jsPublicKeyObjectPrototype_export, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSPublicKeyObject* publicKeyObject = dynamicDowncast<JSPublicKeyObject>(callFrame->thisValue());
    if (!publicKeyObject) {
        throwThisTypeError(*globalObject, scope, "PublicKeyObject"_s, "export"_s);
        return {};
    }

    KeyObject& handle = publicKeyObject->handle();
    JSValue optionsValue = callFrame->argument(0);
    return JSValue::encode(handle.exportAsymmetric(globalObject, scope, optionsValue, CryptoKeyType::Public));
}



#include "JSAsymmetricKeyObjectPrototype.h"
#include "JSKeyObject.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "CryptoUtil.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/LazyPropertyInlines.h>

using namespace Bun;
using namespace JSC;
using namespace WebCore;
using namespace ncrypto;

JSC_DECLARE_CUSTOM_GETTER(jsAsymmetricKeyObjectPrototype_asymmetricKeyType);
JSC_DECLARE_CUSTOM_GETTER(jsAsymmetricKeyObjectPrototype_asymmetricKeyDetails);

const JSC::ClassInfo JSAsymmetricKeyObjectPrototype::s_info = { "AsymmetricKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSAsymmetricKeyObjectPrototype) };

static const JSC::HashTableValue JSAsymmetricKeyObjectPrototypeTableValues[] = {
    { "asymmetricKeyType"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsAsymmetricKeyObjectPrototype_asymmetricKeyType, 0 } },
    { "asymmetricKeyDetails"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsAsymmetricKeyObjectPrototype_asymmetricKeyDetails, 0 } },
};

void JSAsymmetricKeyObjectPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSAsymmetricKeyObjectPrototype::info(), JSAsymmetricKeyObjectPrototypeTableValues, *this);

    // intentionally inherit KeyObject's toStringTag
    // https://github.com/nodejs/node/blob/95b0f9d448832eeb75586c89fab0777a1a4b0610/lib/internal/crypto/keys.js#L146
}

// Both getters brand-check `this`. Like Node, a non-KeyObject names "KeyObject" while a
// KeyObject holding a secret key names "AsymmetricKeyObject", so the two failures stay
// distinguishable (lib/internal/crypto/keys.js).
static JSKeyObject* asymmetricKeyObjectFromThis(JSGlobalObject* globalObject, ThrowScope& scope, JSValue thisValue)
{
    JSKeyObject* keyObject = dynamicDowncast<JSKeyObject>(thisValue);
    if (!keyObject) {
        ERR::INVALID_THIS(scope, globalObject, "KeyObject"_s);
        return nullptr;
    }
    if (keyObject->handle().type() == CryptoKeyType::Secret) {
        ERR::INVALID_THIS(scope, globalObject, "AsymmetricKeyObject"_s);
        return nullptr;
    }
    return keyObject;
}

JSC_DEFINE_CUSTOM_GETTER(jsAsymmetricKeyObjectPrototype_asymmetricKeyType, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSKeyObject* keyObject = asymmetricKeyObjectFromThis(globalObject, scope, JSValue::decode(thisValue));
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(keyObject);

    RELEASE_AND_RETURN(scope, JSValue::encode(keyObject->handle().asymmetricKeyType(globalObject)));
}

JSC_DEFINE_CUSTOM_GETTER(jsAsymmetricKeyObjectPrototype_asymmetricKeyDetails, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    JSKeyObject* keyObject = asymmetricKeyObjectFromThis(globalObject, scope, JSValue::decode(thisValue));
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(keyObject);

    // Node returns a freshly-built details object on every access.
    JSObject* keyDetails = keyObject->handle().asymmetricKeyDetails(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(keyDetails);
}

namespace Bun {

void setupAsymmetricKeyObjectPrototype(const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init)
{
    auto* globalObject = defaultGlobalObject(init.owner);
    auto* structure = JSAsymmetricKeyObjectPrototype::createStructure(init.vm, globalObject, globalObject->KeyObjectPrototype());
    init.set(JSAsymmetricKeyObjectPrototype::create(init.vm, globalObject, structure));
}

} // namespace Bun

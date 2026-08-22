#include "JSHashConstructor.h"
#include "JSHash.h"
#include "CryptoUtil.h"
#include "NodeValidator.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>

namespace Bun {

const ClassInfo JSHashConstructor::s_info = { "Hash"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHashConstructor) };

// new Hash(algorithm[, options]) / Hash(algorithm[, options])
static EncodedJSValue constructOrCallHash(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSHashClassStructure.get(zigGlobalObject);
    if (newTarget && zigGlobalObject->m_JSHashClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSHashClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue algorithmValue = callFrame->argument(0);
    Bun::V::validateString(scope, globalObject, algorithmValue, "algorithm"_s);
    RETURN_IF_EXCEPTION(scope, {});
    WTF::String algorithm = algorithmValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    const EVP_MD* md = ncrypto::getDigestByName(algorithm);
    std::unique_ptr<ExternZigHash::Hasher, decltype(&ExternZigHash::destroy)> zigHasher(nullptr, ExternZigHash::destroy);
    if (!md) {
        zigHasher.reset(ExternZigHash::getByName(zigGlobalObject, algorithm));
    }

    JSHash* hash = createHash(globalObject, structure, md, WTF::move(zigHasher), nullptr, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(hash);
}

JSC_DEFINE_HOST_FUNCTION(constructHash, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructOrCallHash(globalObject, callFrame, callFrame->newTarget());
}

// Node's Hash is a plain function: calling it without `new` constructs anyway.
JSC_DEFINE_HOST_FUNCTION(callHash, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructOrCallHash(globalObject, callFrame, JSValue());
}

} // namespace Bun

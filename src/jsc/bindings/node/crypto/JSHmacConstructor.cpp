#include "JSHmacConstructor.h"
#include "JSHmac.h"
#include "CryptoUtil.h"
#include "KeyObject.h"
#include "NodeValidator.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>

namespace Bun {

const ClassInfo JSHmacConstructor::s_info = { "Hmac"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHmacConstructor) };

// new Hmac(hmac, key[, options]) / Hmac(hmac, key[, options])
static EncodedJSValue constructOrCallHmac(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSC::Structure* structure = zigGlobalObject->m_JSHmacClassStructure.get(zigGlobalObject);
    if (newTarget && zigGlobalObject->m_JSHmacClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSHmacClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue algorithmValue = callFrame->argument(0);
    V::validateString(scope, globalObject, algorithmValue, "hmac"_s);
    RETURN_IF_EXCEPTION(scope, {});

    // Get encoding next before stringifying algorithm
    JSValue options = callFrame->argument(2);
    JSValue encodingValue = jsUndefined();
    if (options.isObject()) {
        encodingValue = options.get(globalObject, WebCore::builtinNames(vm).encodingPublicName());
        RETURN_IF_EXCEPTION(scope, {});

        if (!encodingValue.isUndefinedOrNull()) {
            V::validateString(scope, globalObject, encodingValue, "options.encoding"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    WTF::String algorithm = algorithmValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue key = callFrame->argument(1);
    KeyObject keyObject = KeyObject::prepareSecretKey(globalObject, scope, key, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    JSHmac* hmac = JSHmac::create(vm, structure);
    hmac->init(globalObject, scope, algorithm, keyObject.symmetricKey().span());
    RETURN_IF_EXCEPTION(scope, {});

    // Transform is constructed lazily (see LazyTransform.h); it reads `this._options` then.
    if (!options.isUndefined())
        hmac->putDirect(vm, Identifier::fromString(vm, "_options"_s), options);

    return JSC::JSValue::encode(hmac);
}

JSC_DEFINE_HOST_FUNCTION(constructHmac, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructOrCallHmac(globalObject, callFrame, callFrame->newTarget());
}

// Node's Hmac is a plain function: calling it without `new` constructs anyway.
JSC_DEFINE_HOST_FUNCTION(callHmac, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return constructOrCallHmac(globalObject, callFrame, JSValue());
}

} // namespace Bun

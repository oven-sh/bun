
#include "root.h"

#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ErrorInstanceInlines.h>
#include "ZigGeneratedClasses.h"
#include "S3Error.h"

namespace Bun {

typedef struct S3Error {
    BunString code;
    BunString message;
    BunString path;
} S3Error;

Structure* createS3ErrorStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSC::ErrorInstance::createStructure(vm, globalObject, JSC::constructEmptyObject(globalObject, globalObject->errorPrototype()));
}

extern "C" {
SYSV_ABI JSC::EncodedJSValue S3Error__toErrorInstance(const S3Error* arg0,
    JSC::JSGlobalObject* globalObject)
{
    S3Error err = *arg0;

    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue message = JSC::jsUndefined();
    if (err.message.tag != BunStringTag::Empty) {
        message = Bun::toJS(globalObject, err.message);
    }

    auto& names = WebCore::builtinNames(vm);

    JSC::JSValue options = JSC::jsUndefined();
    auto prototype = defaultGlobalObject(globalObject)->m_S3ErrorStructure.getInitializedOnMainThread(globalObject);
    JSC::JSObject* result = JSC::ErrorInstance::create(globalObject, prototype, message, options);
    result->putDirect(
        vm, vm.propertyNames->name,
        JSC::JSValue(defaultGlobalObject(globalObject)->commonStrings().s3ErrorString(globalObject)),
        JSC::PropertyAttribute::DontEnum | 0);
    if (err.code.tag != BunStringTag::Empty) {
        JSC::JSValue code = Bun::toJS(globalObject, err.code);
        result->putDirect(vm, names.codePublicName(), code,
            JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum | 0);
    }

    if (err.path.tag != BunStringTag::Empty) {
        JSC::JSValue path = Bun::toJS(globalObject, err.path);
        result->putDirect(vm, names.pathPublicName(), path,
            JSC::PropertyAttribute::DontDelete | 0);
    }

    RETURN_IF_EXCEPTION(scope, {});
    scope.release();

    return JSC::JSValue::encode(JSC::JSValue(result));
}
}
}

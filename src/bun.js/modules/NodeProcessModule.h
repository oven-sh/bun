#include "../bindings/ZigGlobalObject.h"
#include "_NativeModule.h"
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSGlobalObject.h>

namespace Zig {

JSC_DEFINE_HOST_FUNCTION(jsFunctionProcessModuleCommonJS,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{

    return JSValue::encode(
        reinterpret_cast<Zig::GlobalObject*>(globalObject)->processObject());
}

JSC_DEFINE_CUSTOM_GETTER(jsFunctionProcessModuleCommonJSGetter,
    (JSGlobalObject * globalObject,
        JSC::EncodedJSValue thisValue,
        PropertyName propertyName))
{

    return JSValue::encode(reinterpret_cast<Zig::GlobalObject*>(globalObject)
                               ->processObject()
                               ->get(globalObject, propertyName));
}

JSC_DEFINE_CUSTOM_SETTER(jsFunctionProcessModuleCommonJSSetter,
    (JSGlobalObject * globalObject,
        JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue encodedValue,
        PropertyName propertyName))
{
    VM& vm = globalObject->vm();

    return reinterpret_cast<Zig::GlobalObject*>(globalObject)
        ->processObject()
        ->putDirect(vm, propertyName, JSValue::decode(encodedValue), 0);
}

DEFINE_NATIVE_MODULE(NodeProcess)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);

    JSC::JSObject* process = globalObject->processObject();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!process->staticPropertiesReified()) {
        process->reifyAllStaticProperties(globalObject);
        if (scope.exception())
            return;
    }

    PropertyNameArray properties(vm, PropertyNameMode::Strings,
        PrivateSymbolMode::Exclude);
    process->getPropertyNames(globalObject, properties,
        DontEnumPropertiesMode::Exclude);
    if (scope.exception())
        return;

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(process);

    for (auto& entry : properties) {
        exportNames.append(entry);
        auto catchScope = DECLARE_CATCH_SCOPE(vm);
        JSValue result = process->get(globalObject, entry);
        if (catchScope.exception()) {
            result = jsUndefined();
            catchScope.clearException();
        }

        exportValues.append(result);
    }
}

} // namespace Zig

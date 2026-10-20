#include "root.h"

#include "BunDOMModule.h"

#include "DOMBindingsModuleExports.h"
#include "JSAbortController.h"
#include "JSAbortSignal.h"
#include "JSCloseEvent.h"
#include "JSCustomEvent.h"
#include "JSDOMCSSNamespace.h"
#include "JSDOMException.h"
#include "JSDOMFormData.h"
#include "JSErrorEvent.h"
#include "JSEvent.h"
#include "JSEventTarget.h"
#include "JSMessageEvent.h"
#include <JavaScriptCore/CustomGetterSetter.h>

namespace Zig {

using namespace JSC;
using namespace WebCore;

// The classes a DOM needs that Bun already has as globals. The exports are the global object's own constructors.
#define FOR_EACH_RUNTIME_INTERFACE(macro)                              \
    macro(AbortController, JSAbortController)                          \
        macro(AbortSignal, JSAbortSignal)                              \
            macro(CSS, JSDOMCSSNamespace)                              \
                macro(CloseEvent, JSCloseEvent)                        \
                    macro(CustomEvent, JSCustomEvent)                  \
                        macro(DOMException, JSDOMException)            \
                            macro(ErrorEvent, JSErrorEvent)            \
                                macro(Event, JSEvent)                  \
                                    macro(EventTarget, JSEventTarget)  \
                                        macro(FormData, JSDOMFormData) \
                                            macro(MessageEvent, JSMessageEvent)

static Zig::GlobalObject* globalObjectOfModuleObject(EncodedJSValue moduleObject)
{
    return uncheckedDowncast<Zig::GlobalObject>(asObject(JSValue::decode(moduleObject))->globalObject());
}

// A constructor makes its prototype, and a prototype makes a function or an accessor for each of its members.
// So an export is made when something first reads it, not when the module is loaded.
#define DEFINE_CONSTRUCTOR_GETTER(name, wrapperClass)                                                                                \
    static JSC_DECLARE_CUSTOM_GETTER(bunDOMModule_##name);                                                                           \
    JSC_DEFINE_CUSTOM_GETTER(bunDOMModule_##name, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue moduleObject, PropertyName)) \
    {                                                                                                                                \
        return JSValue::encode(wrapperClass::getConstructor(getVM(lexicalGlobalObject), globalObjectOfModuleObject(moduleObject)));  \
    }
FOR_EACH_DOM_BINDINGS_INTERFACE(DEFINE_CONSTRUCTOR_GETTER)
FOR_EACH_RUNTIME_INTERFACE(DEFINE_CONSTRUCTOR_GETTER)
#undef DEFINE_CONSTRUCTOR_GETTER

static JSC_DECLARE_CUSTOM_GETTER(bunDOMModule_Blob);
JSC_DEFINE_CUSTOM_GETTER(bunDOMModule_Blob, (JSGlobalObject*, EncodedJSValue moduleObject, PropertyName))
{
    return JSValue::encode(globalObjectOfModuleObject(moduleObject)->JSBlobConstructor());
}

static JSC_DECLARE_CUSTOM_GETTER(bunDOMModule_File);
JSC_DEFINE_CUSTOM_GETTER(bunDOMModule_File, (JSGlobalObject*, EncodedJSValue moduleObject, PropertyName))
{
    return JSValue::encode(globalObjectOfModuleObject(moduleObject)->JSDOMFileConstructor());
}

static JSObject* createModuleObject(VM& vm, Zig::GlobalObject* globalObject)
{
    auto* moduleObject = constructEmptyObject(globalObject);
    // One Structure for all the properties, not one for each.
    moduleObject->convertToDictionary(vm);

#define PUT_CONSTRUCTOR_GETTER(name, wrapperClass) \
    moduleObject->putDirectCustomAccessor(vm, Identifier::fromString(vm, #name##_s), CustomGetterSetter::create(vm, bunDOMModule_##name, nullptr), static_cast<unsigned>(PropertyAttribute::CustomValue));
    FOR_EACH_DOM_BINDINGS_INTERFACE(PUT_CONSTRUCTOR_GETTER)
    FOR_EACH_RUNTIME_INTERFACE(PUT_CONSTRUCTOR_GETTER)
    PUT_CONSTRUCTOR_GETTER(Blob, )
    PUT_CONSTRUCTOR_GETTER(File, )
#undef PUT_CONSTRUCTOR_GETTER

    return moduleObject;
}

JSObject* generateNativeModule_BunDOM(JSGlobalObject* lexicalGlobalObject, Identifier, Vector<Identifier, 4>& exportNames, MarkedArgumentBuffer& exportValues)
{
    auto& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    // require("bun:dom") and import("bun:dom").default are the same object.
    auto& moduleObjectSlot = globalObject->nativeModuleDefaultObject(NativeModuleDefaultSlot::BunDOM);
    if (!moduleObjectSlot)
        moduleObjectSlot.set(vm, globalObject, createModuleObject(vm, globalObject));
    JSObject* moduleObject = moduleObjectSlot.get();

    PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    JSObject::getOwnPropertyNames(moduleObject, globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);

    RELEASE_AND_RETURN(scope, exportObjectProperties(globalObject, moduleObject, properties, exportNames, exportValues));
}

} // namespace Zig

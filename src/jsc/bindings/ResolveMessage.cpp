// The C++ of `ResolveMessage` in resolve_message.bind.ts: the own properties of one that is thrown.
#include "root.h"

#include "BunClientData.h"
#include "GeneratedResolveMessage.h"
#include <JavaScriptCore/CustomGetterSetter.h>

namespace Bun::Bindgen::Generated {

using namespace JSC;

// To JavaScript the property is a plain data property. Its value is made when it is first read.
static JSC_DECLARE_CUSTOM_GETTER(jsResolveMessageLazyProperty);
JSC_DEFINE_CUSTOM_GETTER(jsResolveMessageLazyProperty, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName name))
{
    // For a CustomValue, `thisValue` is the object that has the property, not the receiver.
    auto* error = dynamicDowncast<JSResolveMessage>(JSValue::decode(thisValue));
    if (!error) [[unlikely]]
        return JSValue::encode(jsUndefined());
    JSGlobalObject* globalObject = error->globalObject();
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value;
    if (name == vm.propertyNames->stack)
        value = error->lazyStack(globalObject);
    else if (name == vm.propertyNames->message)
        value = error->lazyMessage(globalObject);
    else if (name == WebCore::builtinNames(vm).codePublicName())
        value = error->lazyCode(globalObject);
    else
        value = error->lazyRequireStack(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    unsigned attributes;
    if (error->getDirectOffset(vm, name, attributes) != invalidOffset && (attributes & PropertyAttribute::CustomValue))
        error->putDirect(vm, name, value, attributes & ~PropertyAttribute::CustomValue);
    return JSValue::encode(value);
}

void JSResolveMessage::defineNodeErrorProperties(bool hasRequireStack)
{
    VM& vm = this->vm();
    auto& names = WebCore::builtinNames(vm);
    auto* lazyProperty = CustomGetterSetter::create(vm, jsResolveMessageLazyProperty, nullptr);
    // Own keys as Module._resolveFilename leaves them: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/cjs/loader.js#L1519-L1522
    putDirectCustomAccessor(vm, vm.propertyNames->stack, lazyProperty, PropertyAttribute::CustomValue | PropertyAttribute::DontEnum);
    putDirectCustomAccessor(vm, vm.propertyNames->message, lazyProperty, PropertyAttribute::CustomValue | PropertyAttribute::DontEnum);
    putDirectCustomAccessor(vm, names.codePublicName(), lazyProperty, PropertyAttribute::CustomValue | 0);
    if (hasRequireStack)
        putDirectCustomAccessor(vm, names.requireStackPublicName(), lazyProperty, PropertyAttribute::CustomValue | 0);
}

}

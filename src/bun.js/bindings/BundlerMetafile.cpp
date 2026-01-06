/**
 * Lazy getter for BuildOutput.metafile that parses JSON on first access
 * and memoizes the result by replacing the getter with the parsed value.
 */

#include "root.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSONObject.h>

namespace Bun {

using namespace JSC;

// Property name for the raw JSON string stored on the object
static const auto metafileStringPropertyName = "metafileString"_s;
static const auto metafilePropertyName = "metafile"_s;

JSC_DEFINE_CUSTOM_GETTER(bundlerMetafileLazyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (!thisObject) {
        return JSValue::encode(jsUndefined());
    }

    // Get the raw JSON string from metafileString property
    JSValue metafileStringValue = thisObject->get(globalObject, Identifier::fromString(vm, metafileStringPropertyName));
    RETURN_IF_EXCEPTION(scope, {});

    if (metafileStringValue.isUndefinedOrNull()) {
        return JSValue::encode(jsUndefined());
    }

    // Parse the JSON string
    JSValue parsedValue = JSONParse(globalObject, metafileStringValue.toWTFString(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    if (parsedValue.isUndefined()) {
        // JSON parse failed, return undefined
        return JSValue::encode(jsUndefined());
    }

    // Memoize: replace the getter with the parsed value using putDirect
    thisObject->putDirect(vm, Identifier::fromString(vm, metafilePropertyName), parsedValue, 0);

    // Delete the raw string property since we no longer need it
    thisObject->deleteProperty(globalObject, Identifier::fromString(vm, metafileStringPropertyName));

    return JSValue::encode(parsedValue);
}

// Creates a CustomGetterSetter for the lazy metafile property
extern "C" JSC::EncodedJSValue Bun__createMetafileLazyGetterSetter(JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    return JSValue::encode(CustomGetterSetter::create(vm, bundlerMetafileLazyGetter, nullptr));
}

// Helper to set up the lazy metafile on a BuildOutput object
extern "C" void Bun__setupLazyMetafile(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue buildOutputEncoded, JSC::EncodedJSValue metafileStringEncoded)
{
    auto& vm = globalObject->vm();
    JSObject* buildOutput = jsDynamicCast<JSObject*>(JSValue::decode(buildOutputEncoded));
    JSValue metafileString = JSValue::decode(metafileStringEncoded);

    if (!buildOutput) {
        return;
    }

    // Store the raw JSON string (non-enumerable)
    buildOutput->putDirect(vm, Identifier::fromString(vm, metafileStringPropertyName), metafileString, static_cast<unsigned>(PropertyAttribute::DontEnum));

    // Set up the lazy getter for metafile property
    buildOutput->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, metafilePropertyName),
        CustomGetterSetter::create(vm, bundlerMetafileLazyGetter, nullptr),
        PropertyAttribute::CustomAccessor | 0);
}

} // namespace Bun

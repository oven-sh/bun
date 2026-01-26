/**
 * Lazy getter for BuildOutput.metafile that returns { json: <parsed>, markdown?: string }
 * Uses CustomValue so the parsed result replaces the getter.
 */

#include "root.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSONObject.h>

namespace Bun {

using namespace JSC;

// Lazy getter for metafile.json property
JSC_DEFINE_CUSTOM_GETTER(bundlerMetafileJsonLazyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* thisObject = JSValue::decode(thisValue).getObject();
    if (!thisObject) {
        return JSValue::encode(jsUndefined());
    }

    // Get the raw JSON string from private property
    const auto& privateName = WebCore::builtinNames(vm).metafileJsonPrivateName();
    JSValue metafileStringValue = thisObject->getDirect(vm, privateName);
    if (!metafileStringValue || !metafileStringValue.isString()) {
        return JSValue::encode(jsUndefined());
    }

    auto str = metafileStringValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto view = str->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue parsedValue = JSC::JSONParseWithException(globalObject, view);
    RETURN_IF_EXCEPTION(scope, {});

    // Replace the lazy getter with the parsed value (memoize for subsequent accesses)
    thisObject->putDirect(vm, property, parsedValue, 0);

    // Clear the raw JSON string so it can be GC'd
    thisObject->putDirect(vm, privateName, jsUndefined(), 0);

    return JSValue::encode(parsedValue);
}

// Helper to set up the lazy metafile on a BuildOutput object
// metafile: { json: <lazy parsed>, markdown?: string }
extern "C" SYSV_ABI void Bun__setupLazyMetafile(
    JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue buildOutputEncoded,
    JSC::EncodedJSValue metafileJsonStringEncoded,
    JSC::EncodedJSValue metafileMarkdownStringEncoded)
{
    auto& vm = JSC::getVM(globalObject);
    JSObject* buildOutput = JSValue::decode(buildOutputEncoded).getObject();
    ASSERT(buildOutput);

    JSValue metafileJsonString = JSValue::decode(metafileJsonStringEncoded);
    JSValue metafileMarkdownString = JSValue::decode(metafileMarkdownStringEncoded);

    // Create the metafile object with json and optionally markdown properties
    JSObject* metafileObject = constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);

    // Store raw JSON string in private property and set up lazy getter for "json"
    metafileObject->putDirect(vm, WebCore::builtinNames(vm).metafileJsonPrivateName(), metafileJsonString, 0);
    metafileObject->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, "json"_s),
        CustomGetterSetter::create(vm, bundlerMetafileJsonLazyGetter, nullptr),
        PropertyAttribute::CustomValue | 0);

    // Add markdown property directly if provided (not lazy since it's already a string)
    if (metafileMarkdownString && metafileMarkdownString.isString()) {
        metafileObject->putDirect(vm, Identifier::fromString(vm, "markdown"_s), metafileMarkdownString, 0);
    }

    // Set the metafile object on buildOutput
    buildOutput->putDirect(vm, Identifier::fromString(vm, "metafile"_s), metafileObject, 0);
}

} // namespace Bun

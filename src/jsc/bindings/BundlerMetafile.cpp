/**
 * Lazy getter for BuildOutput.metafile that returns the parsed JSON directly.
 * Uses CustomValue so the parsed result replaces the getter.
 *
 * For backward compatibility, result.metafile returns the parsed JSON object directly
 * (with inputs/outputs properties), not wrapped in { json: ... }.
 */

#include "root.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSONObject.h>

namespace Bun {

using namespace JSC;

// Lazy getter for metafile property - returns parsed JSON directly for backward compatibility
JSC_DEFINE_CUSTOM_GETTER(bundlerMetafileLazyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
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
// For backward compatibility, metafile is the parsed JSON directly (not wrapped in { json: ... })
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
    // metafileMarkdownString is currently unused for backward compatibility
    // (we only set the JSON on result.metafile directly)
    (void)metafileMarkdownStringEncoded;

    // Store raw JSON string in private property on buildOutput and set up lazy getter for "metafile"
    // This returns the parsed JSON directly for backward compatibility with esbuild API
    buildOutput->putDirect(vm, WebCore::builtinNames(vm).metafileJsonPrivateName(), metafileJsonString, 0);
    buildOutput->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, "metafile"_s),
        CustomGetterSetter::create(vm, bundlerMetafileLazyGetter, nullptr),
        PropertyAttribute::CustomValue | 0);
}

} // namespace Bun

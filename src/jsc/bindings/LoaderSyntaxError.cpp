#include "root.h"

#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ErrorInstanceInlines.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "helpers.h"

namespace Bun {

using namespace JSC;

// The SyntaxError keeps one BuildMessage, or an InternalFieldTuple of the first error's BuildMessage and an array of all.
static JSValue loadDiagnostics(VM& vm, JSValue value)
{
    auto* error = dynamicDowncast<ErrorInstance>(value);
    if (!error || error->errorType() != ErrorType::SyntaxError)
        return {};
    return error->getDirect(vm, WebCore::builtinNames(vm).loadDiagnosticsPrivateName());
}

// `position`, `notes` and `level` of the SyntaxError are those of the first error's BuildMessage, made when first read.
JSC_DEFINE_CUSTOM_GETTER(loaderSyntaxErrorDiagnosticGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue diagnostics = loadDiagnostics(vm, JSValue::decode(thisValue));
    if (!diagnostics)
        return JSValue::encode(jsUndefined());
    if (auto* tuple = dynamicDowncast<InternalFieldTuple>(diagnostics))
        diagnostics = tuple->getInternalField(0);
    RELEASE_AND_RETURN(scope, JSValue::encode(diagnostics.get(globalObject, propertyName)));
}

// `first` is the BuildMessage that the error reports. `all` is empty, or an array of the wrappers of every diagnostic.
extern "C" EncodedJSValue Bun__createLoaderSyntaxError(JSGlobalObject* globalObject, const unsigned char* messagePtr, size_t messageLength, const unsigned char* sourceURLPtr, size_t sourceURLLength, uint32_t line, uint32_t column, const unsigned char* stackPtr, size_t stackLength, EncodedJSValue encodedFirst, EncodedJSValue encodedAll)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String message = messageLength ? Zig::convertUTF8ToString(std::span { messagePtr, messageLength }) : emptyString();
    String sourceURL = sourceURLLength ? Zig::convertUTF8ToString(std::span { sourceURLPtr, sourceURLLength }) : String();
    String stack = Zig::convertUTF8ToString(std::span { stackPtr, stackLength });
    if (message.isNull() || stack.isNull() || (sourceURLLength && sourceURL.isNull())) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    JSValue first = JSValue::decode(encodedFirst);
    JSValue all = JSValue::decode(encodedAll);
    auto* error = ErrorInstance::create(globalObject, WTF::move(message), ErrorType::SyntaxError, { line, column }, WTF::move(sourceURL), WTF::move(stack));
    JSValue diagnostics = all ? JSValue(InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), first, all)) : first;
    error->putDirect(vm, WebCore::builtinNames(vm).loadDiagnosticsPrivateName(), diagnostics, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    // Not an accessor: each reads as a writable data property, and an assignment replaces it.
    auto* getter = CustomGetterSetter::create(vm, loaderSyntaxErrorDiagnosticGetter, nullptr);
    unsigned attributes = PropertyAttribute::DontEnum | PropertyAttribute::CustomValue;
    error->putDirectCustomAccessor(vm, Identifier::fromString(vm, "position"_s), getter, attributes);
    error->putDirectCustomAccessor(vm, Identifier::fromString(vm, "notes"_s), getter, attributes);
    error->putDirectCustomAccessor(vm, Identifier::fromString(vm, "level"_s), getter, attributes);
    RELEASE_AND_RETURN(scope, JSValue::encode(error));
}

// The wrapper of diagnostic `index` of the module loader's SyntaxError. Empty past the last one and for any other value.
extern "C" EncodedJSValue Bun__loaderSyntaxErrorDiagnostic(JSGlobalObject* globalObject, EncodedJSValue value, uint32_t index)
{
    JSValue diagnostics = loadDiagnostics(getVM(globalObject), JSValue::decode(value));
    if (!diagnostics)
        return {};
    auto* tuple = dynamicDowncast<InternalFieldTuple>(diagnostics);
    if (!tuple)
        return index ? EncodedJSValue {} : JSValue::encode(diagnostics);
    auto* all = uncheckedDowncast<JSArray>(tuple->getInternalField(1));
    return all->canGetIndexQuickly(index) ? JSValue::encode(all->getIndexQuickly(index)) : EncodedJSValue {};
}

}

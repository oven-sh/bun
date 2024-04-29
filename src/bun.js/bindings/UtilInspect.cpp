#include "root.h"
#include "headers.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/ObjectConstructor.h"

namespace Bun {

using namespace JSC;

Structure* createUtilInspectOptionsStructure(VM& vm, JSC::JSGlobalObject* globalObject)
{
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), 3);
    PropertyOffset offset;
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "stylize"_s), 0, offset);
    RELEASE_ASSERT(offset == 0);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "depth"_s), 0, offset);
    RELEASE_ASSERT(offset == 1);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "colors"_s), 0, offset);
    RELEASE_ASSERT(offset == 2);
    return structure;
}

JSObject* createInspectOptionsObject(VM& vm, Zig::GlobalObject* globalObject, unsigned max_depth, bool colors)
{
    JSFunction* stylizeFn = colors ? globalObject->utilInspectStylizeColorFunction() : globalObject->utilInspectStylizeNoColorFunction();
    JSObject* options = JSC::constructEmptyObject(vm, globalObject->utilInspectOptionsStructure());
    options->putDirectOffset(vm, 0, stylizeFn);
    options->putDirectOffset(vm, 1, jsNumber(max_depth));
    options->putDirectOffset(vm, 2, jsBoolean(colors));
    return options;
}

extern "C" JSC::EncodedJSValue JSC__JSValue__callCustomInspectFunction(
    Zig::GlobalObject* globalObject,
    JSC::JSGlobalObject* lexicalGlobalObject,
    JSC__JSValue encodedFunctionValue,
    JSC__JSValue encodedThisValue,
    unsigned depth,
    unsigned max_depth,
    bool colors,
    bool* is_exception)
{
    JSValue functionToCall = JSValue::decode(encodedFunctionValue);
    JSValue thisValue = JSValue::decode(encodedThisValue);
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* options = Bun::createInspectOptionsObject(vm, globalObject, max_depth, colors);

    JSFunction* inspectFn = globalObject->utilInspectFunction();
    auto callData = JSC::getCallData(functionToCall);
    MarkedArgumentBuffer arguments;
    arguments.append(jsNumber(depth));
    arguments.append(options);
    arguments.append(inspectFn);

    auto inspectRet = JSC::call(lexicalGlobalObject, functionToCall, callData, thisValue, arguments);
    if (auto exe = scope.exception()) {
        *is_exception = true;
        scope.clearException();
        return JSValue::encode(exe);
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(inspectRet));
}

}
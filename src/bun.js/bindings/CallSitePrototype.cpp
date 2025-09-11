/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#include "config.h"
#include "CallSitePrototype.h"
#include "CallSite.h"
#include "helpers.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/Operations.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/AsyncFunctionPrototype.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/ParserModes.h>
using namespace JSC;

namespace Zig {

JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetThis);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetTypeName);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetFunction);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetFunctionName);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetMethodName);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetFileName);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetLineNumber);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetColumnNumber);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetEvalOrigin);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetScriptNameOrSourceURL);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsToplevel);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsEval);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsNative);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsConstructor);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsAsync);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsPromiseAll);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetPromiseIndex);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncToString);
JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncToJSON);

ALWAYS_INLINE static CallSite* getCallSite(JSGlobalObject* globalObject, JSC::JSValue thisValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* callSite = JSC::jsDynamicCast<CallSite*>(thisValue)) {
        return callSite;
    }

    throwTypeError(globalObject, scope, "CallSite operation called on non-CallSite object"_s);
    return nullptr;
}

#define ENTER_PROTO_FUNC()                                                  \
    auto& vm = JSC::getVM(globalObject);                                    \
    auto scope = DECLARE_THROW_SCOPE(vm);                                   \
    CallSite* callSite = getCallSite(globalObject, callFrame->thisValue()); \
    RETURN_IF_EXCEPTION(scope, {});                                         \
    (void)callSite;

static const HashTableValue CallSitePrototypeTableValues[]
    = {
          { "getThis"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetThis, 0 } },
          { "getTypeName"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetTypeName, 0 } },
          { "getFunction"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetFunction, 0 } },
          { "getFunctionName"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetFunctionName, 0 } },
          { "getMethodName"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetMethodName, 0 } },
          { "getFileName"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetFileName, 0 } },
          { "getLineNumber"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetLineNumber, 0 } },
          { "getColumnNumber"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetColumnNumber, 0 } },
          { "getEvalOrigin"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetEvalOrigin, 0 } },
          { "getScriptNameOrSourceURL"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetScriptNameOrSourceURL, 0 } },
          { "isToplevel"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncIsToplevel, 0 } },
          { "isEval"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncIsEval, 0 } },
          { "isNative"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncIsNative, 0 } },
          { "isConstructor"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncIsConstructor, 0 } },
          { "isAsync"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncIsAsync, 0 } },
          { "isPromiseAll"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncIsPromiseAll, 0 } },
          { "getPromiseIndex"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncGetPromiseIndex, 0 } },
          { "toString"_s, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Function, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncToString, 0 } },
          { "toJSON"_s, JSC::PropertyAttribute::Function | 0, NoIntrinsic, { HashTableValue::NativeFunctionType, callSiteProtoFuncToJSON, 0 } },
      };

const JSC::ClassInfo CallSitePrototype::s_info = { "CallSite"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(CallSitePrototype) };

void CallSitePrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    reifyStaticProperties(vm, CallSite::info(), CallSitePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// TODO: doesn't recognize thisValue as global object
JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetThis, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    return JSC::JSValue::encode(callSite->thisValue());
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetTypeName, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    JSValue thisValue = callSite->thisValue();

    // Return null for undefined to match V8 behavior
    if (thisValue.isUndefinedOrNull()) {
        return JSC::JSValue::encode(jsNull());
    }

    // For objects, try to get the constructor name or class name
    if (thisValue.isObject()) {
        JSObject* obj = asObject(thisValue);

        // Try to get the class name
        auto catchScope = DECLARE_CATCH_SCOPE(vm);
        String className = obj->calculatedClassName(obj);
        if (catchScope.exception()) {
            catchScope.clearException();
            return JSC::JSValue::encode(jsNull());
        }

        if (!className.isEmpty()) {
            return JSC::JSValue::encode(jsString(vm, className));
        }
    }

    // Fallback to type string
    JSString* typeString = jsTypeStringForValue(globalObject, thisValue);

    // Return null if the type string is "undefined"
    if (typeString) {
        String typeStr = typeString->tryGetValue();
        if (typeStr == "undefined"_s) {
            return JSC::JSValue::encode(jsNull());
        }
    }

    return JSC::JSValue::encode(typeString);
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetFunction, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    return JSC::JSValue::encode(callSite->function());
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetFunctionName, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    JSValue functionName = callSite->functionName();
    // Return null instead of empty string to match V8 behavior
    if (functionName.isString() && asString(functionName)->length() == 0) {
        return JSC::JSValue::encode(jsNull());
    }
    return JSC::JSValue::encode(functionName);
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetMethodName, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();

    // getMethodName() should only return a name if this is actually a method call
    // (i.e., when 'this' is an object and not the global object or undefined)
    JSValue thisValue = callSite->thisValue();
    JSValue functionName = callSite->functionName();

    // If there's no function name, return null
    if (!functionName.isString() || asString(functionName)->length() == 0) {
        return JSC::JSValue::encode(jsNull());
    }

    // If 'this' is undefined or null (strict mode, top-level), it's not a method
    if (thisValue.isUndefinedOrNull()) {
        return JSC::JSValue::encode(jsNull());
    }

    // If 'this' is an object (but not global object), it's likely a method call
    if (thisValue.isObject()) {
        JSObject* obj = asObject(thisValue);
        // Check if it's the global object - if so, it's not a method call
        if (obj->isGlobalObject()) {
            return JSC::JSValue::encode(jsNull());
        }
        // It's a method call on a regular object
        return JSC::JSValue::encode(functionName);
    }

    // For all other cases, return null
    return JSC::JSValue::encode(jsNull());
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetFileName, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    return JSC::JSValue::encode(callSite->sourceURL());
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetLineNumber, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    // https://github.com/mozilla/source-map/blob/60adcb064bf033702d954d6d3f9bc3635dcb744b/lib/source-map-consumer.js#L484-L486
    return JSC::JSValue::encode(jsNumber(std::max(callSite->lineNumber().oneBasedInt(), 1)));
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetColumnNumber, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    // https://github.com/mozilla/source-map/blob/60adcb064bf033702d954d6d3f9bc3635dcb744b/lib/source-map-consumer.js#L488-L489
    return JSC::JSValue::encode(jsNumber(std::max(callSite->columnNumber().zeroBasedInt(), 0)));
}

// TODO:
JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetEvalOrigin, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetScriptNameOrSourceURL, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    return JSC::JSValue::encode(callSite->sourceURL());
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncIsToplevel, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();

    // TODO: Fix Function constructor detection
    // =====================================
    // KNOWN BUG: Code created with `new Function()` is not detected as eval by JSCStackFrame.
    // 
    // In Node.js/V8, Function constructor code is treated as eval code, which means:
    //   - isEval() should return true
    //   - isToplevel() should return false
    //   - getFunctionName() should return "eval" (not the displayName)
    // 
    // Currently in Bun:
    //   - isEval() returns false (WRONG - should be true)
    //   - isToplevel() returns true (WRONG - should be false)  
    //   - getFunctionName() returns the displayName (partially wrong - should be "eval" in some contexts)
    //
    // This is a deeper issue in how JSCStackFrame detects eval contexts. The Function
    // constructor creates code that should be marked as eval, but JSC doesn't provide
    // this information in the same way V8 does.
    //
    // To fix this properly, we need to:
    // 1. Update JSCStackFrame::isEval() in ErrorStackTrace.cpp to detect Function constructor code
    // 2. Check the FunctionExecutable's source provider type for Function constructor origin
    // 3. Or add a special flag when code is created via Function constructor in JSC
    //
    // Failing test: test/js/node/v8/capture-stack-trace.test.js 
    //   "CallFrame isTopLevel returns false for Function constructor"
    //
    // Example code that fails:
    //   const fn = new Function("return new Error().stack");
    //   // In prepareStackTrace callback:
    //   // - stack[0].isEval() returns false (should be true)
    //   // - stack[0].isToplevel() returns true (should be false)
    //
    // Workaround attempts that don't work:
    // - Checking if function name is "eval" (it uses displayName instead)
    // - Checking executable types (Function constructor code looks like regular functions)
    // - Checking parseMode (doesn't distinguish Function constructor from regular functions)
    // =====================================

    // Eval and Function constructor code is never top-level
    if (callSite->isEval()) {
        return JSC::JSValue::encode(JSC::jsBoolean(false));
    }

    // Constructor calls are never top-level
    if (callSite->isConstructor()) {
        return JSC::JSValue::encode(JSC::jsBoolean(false));
    }

    JSC::JSValue thisValue = callSite->thisValue();

    // Method calls (where 'this' is a regular object, not global) are not top-level
    if (thisValue.isObject()) {
        JSC::JSObject* thisObject = asObject(thisValue);
        if (!thisObject->isGlobalObject()) {
            // This is a method call on a regular object
            return JSC::JSValue::encode(JSC::jsBoolean(false));
        }
    }

    // Check the function type
    if (JSValue functionValue = callSite->function()) {
        if (JSObject* fn = functionValue.getObject()) {
            if (JSFunction* function = jsDynamicCast<JSFunction*>(fn)) {
                if (function->inherits<JSC::JSBoundFunction>()) {
                    return JSC::JSValue::encode(JSC::jsBoolean(false));
                }

                if (function->isHostFunction()) {
                    return JSC::JSValue::encode(JSC::jsBoolean(true));
                }

                // Check if it's module-level code
                if (auto* executable = function->jsExecutable()) {
                    // Module and program level code is considered NOT top-level in Node.js
                    // when it's the actual module wrapper function
                    if (executable->isModuleProgramExecutable()) {
                        return JSC::JSValue::encode(JSC::jsBoolean(false));
                    }
                }
            } else if (jsDynamicCast<InternalFunction*>(functionValue)) {
                return JSC::JSValue::encode(JSC::jsBoolean(true));
            }
        }
    }

    // Default: If 'this' is undefined/null or global object, it's top-level
    if (thisValue.isUndefinedOrNull() || (thisValue.isObject() && asObject(thisValue)->isGlobalObject())) {
        return JSC::JSValue::encode(JSC::jsBoolean(true));
    }

    return JSC::JSValue::encode(JSC::jsBoolean(false));
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncIsEval, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();

    bool isEval = callSite->isEval();
    return JSC::JSValue::encode(JSC::jsBoolean(isEval));
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncIsNative, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();

    bool isNative = callSite->isNative();
    return JSC::JSValue::encode(JSC::jsBoolean(isNative));
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncIsConstructor, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();

    bool isConstructor = callSite->isConstructor();
    return JSC::JSValue::encode(JSC::jsBoolean(isConstructor));
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncIsAsync, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();

    JSValue functionValue = callSite->function();
    if (!functionValue.isCell()) {
        return JSC::JSValue::encode(JSC::jsBoolean(false));
    }

    auto* function = jsDynamicCast<JSFunction*>(functionValue);
    if (!function || function->isHostFunction()) {
        return JSC::JSValue::encode(JSC::jsBoolean(false));
    }

    auto* executable = function->jsExecutable();
    if (!executable) {
        return JSC::JSValue::encode(JSC::jsBoolean(false));
    }

    // Cast to FunctionExecutable to access parseMode
    if (auto* funcExecutable = jsDynamicCast<FunctionExecutable*>(executable)) {
        SourceParseMode mode = funcExecutable->parseMode();

        // Check if it's any kind of async function
        bool isAsync = isAsyncFunctionWrapperParseMode(mode) || isAsyncGeneratorWrapperParseMode(mode) || isAsyncFunctionParseMode(mode) || funcExecutable->isAsyncGenerator();

        if (isAsync) {
            return JSC::JSValue::encode(JSC::jsBoolean(true));
        }
    }

    // Fallback: Check if the function's prototype inherits from AsyncFunctionPrototype
    auto proto = function->getPrototype(globalObject);
    if (!proto.isCell()) {
        return JSC::JSValue::encode(JSC::jsBoolean(false));
    }

    auto* protoCell = proto.asCell();
    return JSC::JSValue::encode(jsBoolean(protoCell->inherits<AsyncFunctionPrototype>()));
}

// TODO:
JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncIsPromiseAll, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();

    return JSC::JSValue::encode(JSC::jsBoolean(false));
}

// TODO:
JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetPromiseIndex, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();

    return JSC::JSValue::encode(JSC::jsNull());
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncToString, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    WTF::StringBuilder sb;
    callSite->formatAsString(vm, globalObject, sb);
    return JSC::JSValue::encode(jsString(vm, sb.toString()));
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncToJSON, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    JSObject* obj = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 4);
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "sourceURL"_s), callSite->sourceURL());
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "lineNumber"_s), jsNumber(callSite->lineNumber().oneBasedInt()));
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "columnNumber"_s), jsNumber(callSite->columnNumber().zeroBasedInt()));
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "functionName"_s), callSite->functionName());
    return JSC::JSValue::encode(obj);
}

}

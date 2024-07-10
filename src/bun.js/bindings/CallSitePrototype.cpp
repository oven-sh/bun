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

using namespace JSC;

namespace Zig {

static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetThis);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetTypeName);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetFunction);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetFunctionName);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetMethodName);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetFileName);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetLineNumber);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetColumnNumber);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetEvalOrigin);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetScriptNameOrSourceURL);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsToplevel);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsEval);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsNative);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsConstructor);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsAsync);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncIsPromiseAll);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncGetPromiseIndex);
static JSC_DECLARE_HOST_FUNCTION(callSiteProtoFuncToString);

ALWAYS_INLINE static CallSite* getCallSite(JSGlobalObject* globalObject, JSC::JSValue thisValue)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (UNLIKELY(!thisValue.isCell())) {
        JSC::throwVMError(globalObject, scope, createNotAnObjectError(globalObject, thisValue));
        return nullptr;
    }

    if (LIKELY(thisValue.asCell()->inherits(CallSite::info()))) {
        return JSC::jsCast<CallSite*>(thisValue);
    }

    throwTypeError(globalObject, scope, "CallSite operation called on non-CallSite object"_s);
    return nullptr;
}

#define ENTER_PROTO_FUNC()                                                  \
    JSC::VM& vm = globalObject->vm();                                       \
    auto scope = DECLARE_THROW_SCOPE(vm);                                   \
                                                                            \
    CallSite* callSite = getCallSite(globalObject, callFrame->thisValue()); \
    if (!callSite) {                                                        \
        return JSC::JSValue::encode(JSC::jsUndefined());                    \
    }

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

// TODO: doesn't get class name
JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetTypeName, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    return JSC::JSValue::encode(JSC::jsTypeStringForValue(globalObject, callSite->thisValue()));
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetFunction, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    return JSC::JSValue::encode(callSite->function());
}

JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetFunctionName, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();
    return JSC::JSValue::encode(callSite->functionName());
}

// TODO
JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncGetMethodName, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return callSiteProtoFuncGetFunctionName(globalObject, callFrame);
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

    JSC::JSValue thisValue = callSite->thisValue();

    // This is what v8 does (JSStackFrame::IsToplevel in messages.cc):

    if (thisValue.isUndefinedOrNull()) {
        return JSC::JSValue::encode(JSC::jsBoolean(true));
    }

    JSC::JSObject* thisObject = thisValue.getObject();
    if (thisObject && thisObject->isGlobalObject()) {
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

// TODO:
JSC_DEFINE_HOST_FUNCTION(callSiteProtoFuncIsAsync, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ENTER_PROTO_FUNC();

    return JSC::JSValue::encode(JSC::jsBoolean(false));
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
    return JSC::JSValue::encode(JSC::JSValue(jsString(vm, sb.toString())));
}

}

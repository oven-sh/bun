#include "V8Function.h"
#include "shim/Function.h"
#include "V8Context.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ConstructData.h"
#include "JavaScriptCore/FunctionExecutable.h"
#include "JavaScriptCore/JSFunctionInlines.h"
#include "JavaScriptCore/LineColumn.h"
#include "JavaScriptCore/SourceProvider.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Function)

namespace v8 {

const int Function::kLineOffsetNotFound = -1;

namespace {

// 1-based position of the parameter list, source-map remapped. False without script source.
bool functionSourcePosition(const JSC::JSCell* cell, WTF::String& url, JSC::LineColumn& lineColumn)
{
    auto* function = dynamicDowncast<const JSC::JSFunction>(cell);
    if (!function || function->isHostFunction()) {
        return false;
    }
    JSC::FunctionExecutable* executable = function->jsExecutable();
    if (executable->isBuiltinFunction()) {
        return false;
    }
    // A synthesized default constructor has no source of its own. V8 reports the `class` keyword.
    const JSC::SourceCode source = executable->unlinkedExecutable()->isBuiltinDefaultClassConstructor()
        ? executable->classSource()
        : executable->source();
    JSC::SourceProvider* provider = source.provider();
    if (!provider) {
        return false;
    }

    url = provider->sourceURL();
    lineColumn = JSC::LineColumn {
        static_cast<unsigned>(source.firstLine().oneBasedInt()),
        static_cast<unsigned>(source.startColumn().oneBasedInt()),
    };

#if USE(BUN_JSC_ADDITIONS)
    auto& vm = function->vm();
    auto& remap = vm.computeLineColumnWithSourcemap();
    if (remap) {
        remap(vm, provider, lineColumn, url);
    }
#endif
    return true;
}

} // namespace

MaybeLocal<Value> Function::Call(Local<Context> context, Local<Value> recv, int argc, Local<Value> argv[])
{
    auto* globalObject = context->globalObject();
    auto& vm = context->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::JSValue callee = localToJSValue();
    JSC::JSValue thisValue = recv.IsEmpty() ? JSC::jsUndefined() : recv->localToJSValue();

    JSC::MarkedArgumentBuffer args;
    args.ensureCapacity(argc);
    for (int i = 0; i < argc; i++) {
        args.append(argv[i]->localToJSValue());
    }

    JSC::JSValue result = JSC::call(globalObject, callee, thisValue, args, "v8::Function::Call"_s);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Value>());

    return context->currentHandleScope()->createLocal<Value>(vm, result);
}

MaybeLocal<Object> Function::NewInstance(Local<Context> context, int argc, Local<Value> argv[]) const
{
    auto* globalObject = context->globalObject();
    auto& vm = context->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::MarkedArgumentBuffer argBuffer;
    argBuffer.ensureCapacity(argc);
    for (int i = 0; i < argc; i++) {
        argBuffer.append(argv[i]->localToJSValue());
    }
    JSC::ArgList args(argBuffer);

    // shim::Function's InternalFunction construct callback is
    // FunctionTemplate::functionConstruct, so JSC::construct dispatches there.
    JSC::JSValue callee = localToJSValue();
    JSC::JSObject* result = JSC::construct(globalObject, callee, args, "v8::Function::NewInstance"_s);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Object>());
    return context->currentHandleScope()->createLocal<Object>(vm, result);
}

MaybeLocal<Object> Function::NewInstance(Local<Context> context) const
{
    return NewInstance(context, 0, nullptr);
}

void Function::SetName(Local<String> name)
{
    if (auto* jsFunction = localToObjectPointer<JSC::JSFunction>()) {
        jsFunction->setFunctionName(jsFunction->globalObject(), name->localToJSString());
    } else if (auto* v8Function = localToObjectPointer<shim::Function>()) {
        v8Function->setName(name->localToJSString());
    } else {
        RELEASE_ASSERT_NOT_REACHED("v8::Function::SetName called on invalid type");
    }
}

Local<Value> Function::GetName() const
{
    WTF::String wtfString;
    if (auto* jsFunction = localToObjectPointer<JSC::JSFunction>()) {
        wtfString = const_cast<JSC::JSFunction*>(jsFunction)->name(jsFunction->globalObject()->vm());
    } else if (auto* internalFunction = localToObjectPointer<JSC::InternalFunction>()) {
        wtfString = const_cast<JSC::InternalFunction*>(internalFunction)->name();
    } else {
        RELEASE_ASSERT_NOT_REACHED("v8::Function::GetName called on invalid type");
    }

    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(localToObjectPointer<JSC::JSNonFinalObject>()->globalObject());
    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    auto* jsString = JSC::jsString(globalObject->vm(), wtfString);
    return handleScope->createLocal<Value>(globalObject->vm(), jsString);
}

ScriptOrigin Function::GetScriptOrigin() const
{
    WTF::String url;
    JSC::LineColumn lineColumn;
    if (!functionSourcePosition(localToCell(), url, lineColumn)) {
        return ScriptOrigin(Local<Value>());
    }

    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(localToObjectPointer<JSC::JSNonFinalObject>()->globalObject());
    auto& vm = globalObject->vm();
    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    Local<Value> resourceName = handleScope->createLocal<Value>(vm, JSC::jsString(vm, url));
    Local<Value> sourceMapUrl = handleScope->createLocal<Value>(vm, JSC::jsUndefined());
    return ScriptOrigin(resourceName, 0, 0, false, -1, sourceMapUrl);
}

int Function::GetScriptLineNumber() const
{
    WTF::String url;
    JSC::LineColumn lineColumn;
    if (!functionSourcePosition(localToCell(), url, lineColumn) || lineColumn.line == 0) {
        return kLineOffsetNotFound;
    }
    return static_cast<int>(lineColumn.line) - 1;
}

int Function::GetScriptColumnNumber() const
{
    WTF::String url;
    JSC::LineColumn lineColumn;
    if (!functionSourcePosition(localToCell(), url, lineColumn) || lineColumn.column == 0) {
        return kLineOffsetNotFound;
    }
    return static_cast<int>(lineColumn.column) - 1;
}

} // namespace v8

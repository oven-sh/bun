
#include "root.h"
#include "DefaultGlobal.h"

#include <wtf/text/AtomStringImpl.h>

#include <JavaScriptCore/APICast.h>
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSContextInternal.h>
#include <JavaScriptCore/JSInternalPromise.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSValueInternal.h>
#include <JavaScriptCore/JSVirtualMachineInternal.h>
#include <JavaScriptCore/JavaScriptCore.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <wtf/URL.h>

#include "JSCInlines.h"



class Script;
namespace JSC {
    class Identifier;
    class JSObject;
    class JSString;

}





namespace Wundle {



const ClassInfo DefaultGlobal::s_info = { "GlobalObject", &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(DefaultGlobal) };
const GlobalObjectMethodTable DefaultGlobal::s_globalObjectMethodTable = {
    &supportsRichSourceInfo,
    &shouldInterruptScript,
    &javaScriptRuntimeFlags,
    nullptr, // queueTaskToEventLoop
    &shouldInterruptScriptBeforeTimeout,
    &moduleLoaderImportModule, // moduleLoaderImportModule
    &moduleLoaderResolve, // moduleLoaderResolve
    &moduleLoaderFetch, // moduleLoaderFetch
    &moduleLoaderCreateImportMetaProperties, // moduleLoaderCreateImportMetaProperties
    &moduleLoaderEvaluate, // moduleLoaderEvaluate
    nullptr, // promiseRejectionTracker
    &reportUncaughtExceptionAtEventLoop,
    &currentScriptExecutionOwner,
    &scriptExecutionStatus,
    nullptr, // defaultLanguage
    nullptr, // compileStreaming
    nullptr, // instantiateStreaming
};


void DefaultGlobal::reportUncaughtExceptionAtEventLoop(JSGlobalObject* globalObject, Exception* exception) {}
JSC::Identifier DefaultGlobal::moduleLoaderResolve(JSGlobalObject* globalObject, JSModuleLoader* loader, JSValue key, JSValue referrer, JSValue val) {
    String string = key.toWTFString(globalObject);
    return JSC::Identifier::fromString(globalObject->vm(),  string );
}
JSInternalPromise* DefaultGlobal::moduleLoaderImportModule(JSGlobalObject* globalObject, JSModuleLoader*, JSString* specifierValue, JSValue, const SourceOrigin& sourceOrigin) {
    return nullptr;
}
JSInternalPromise* DefaultGlobal::moduleLoaderFetch(JSGlobalObject* globalObject, JSModuleLoader*, JSValue key, JSValue, JSValue) {
    return nullptr;
}
JSC::JSObject* DefaultGlobal::moduleLoaderCreateImportMetaProperties(JSGlobalObject* globalObject, JSModuleLoader*loader, JSValue key, JSModuleRecord* record, JSValue value) {
    return nullptr;
}
JSValue DefaultGlobal::moduleLoaderEvaluate(JSGlobalObject* globalObject, JSModuleLoader* moduleLoader, JSValue key, JSValue moduleRecordValue, JSValue scriptFetcher, JSValue sentValue, JSValue resumeMode) {
  return jsNull();
}

using namespace JSC;


JSC::ObjectPrototype* JSC__JSGlobalObject__objectPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->objectPrototype();
}
JSC::FunctionPrototype* JSC__JSGlobalObject__functionPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->functionPrototype();
}
JSC::ArrayPrototype* JSC__JSGlobalObject__arrayPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->arrayPrototype();
}
JSC::JSObject* JSC__JSGlobalObject__booleanPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->booleanPrototype();
}
JSC::StringPrototype* JSC__JSGlobalObject__stringPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->stringPrototype();
}
JSC::JSObject* JSC__JSGlobalObject__numberPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->numberPrototype();
}
JSC::BigIntPrototype* JSC__JSGlobalObject__bigIntPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->bigIntPrototype();
}
JSC::JSObject* JSC__JSGlobalObject__datePrototype(JSC::JSGlobalObject* arg0) {
    return arg0->datePrototype();
}
JSC::JSObject* JSC__JSGlobalObject__symbolPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->symbolPrototype();
}
JSC::RegExpPrototype* JSC__JSGlobalObject__regExpPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->regExpPrototype();
}
JSC::JSObject* JSC__JSGlobalObject__errorPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->errorPrototype();
}
JSC::IteratorPrototype* JSC__JSGlobalObject__iteratorPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->iteratorPrototype();
}
JSC::AsyncIteratorPrototype* JSC__JSGlobalObject__asyncIteratorPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->asyncIteratorPrototype();
}
JSC::GeneratorFunctionPrototype* JSC__JSGlobalObject__generatorFunctionPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->generatorFunctionPrototype();
}
JSC::GeneratorPrototype* JSC__JSGlobalObject__generatorPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->generatorPrototype();
}
JSC::AsyncFunctionPrototype* JSC__JSGlobalObject__asyncFunctionPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->asyncFunctionPrototype();
}
JSC::ArrayIteratorPrototype* JSC__JSGlobalObject__arrayIteratorPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->arrayIteratorPrototype();
}
JSC::MapIteratorPrototype* JSC__JSGlobalObject__mapIteratorPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->mapIteratorPrototype();
}
JSC::SetIteratorPrototype* JSC__JSGlobalObject__setIteratorPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->setIteratorPrototype();
}
JSC::JSObject* JSC__JSGlobalObject__mapPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->mapPrototype();
}
JSC::JSObject* JSC__JSGlobalObject__jsSetPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->jsSetPrototype();
}
JSC::JSPromisePrototype* JSC__JSGlobalObject__promisePrototype(JSC::JSGlobalObject* arg0) {
    return arg0->promisePrototype();
}
JSC::AsyncGeneratorPrototype* JSC__JSGlobalObject__asyncGeneratorPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->asyncGeneratorPrototype();
}
JSC::AsyncGeneratorFunctionPrototype* JSC__JSGlobalObject__asyncGeneratorFunctionPrototype(JSC::JSGlobalObject* arg0) {
    return arg0->asyncGeneratorFunctionPrototype();
}


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


JSC::ObjectPrototype* DefaultGlobal__objectPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->objectPrototype();
}
JSC::FunctionPrototype* DefaultGlobal__functionPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->functionPrototype();
}
JSC::ArrayPrototype* DefaultGlobal__arrayPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->arrayPrototype();
}
JSC::JSObject* DefaultGlobal__booleanPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->booleanPrototype();
}
JSC::StringPrototype* DefaultGlobal__stringPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->stringPrototype();
}
JSC::JSObject* DefaultGlobal__numberPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->numberPrototype();
}
JSC::BigIntPrototype* DefaultGlobal__bigIntPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->bigIntPrototype();
}
JSC::JSObject* DefaultGlobal__datePrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->datePrototype();
}
JSC::JSObject* DefaultGlobal__symbolPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->symbolPrototype();
}
JSC::RegExpPrototype* DefaultGlobal__regExpPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->regExpPrototype();
}
JSC::JSObject* DefaultGlobal__errorPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->errorPrototype();
}
JSC::IteratorPrototype* DefaultGlobal__iteratorPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->iteratorPrototype();
}
JSC::AsyncIteratorPrototype* DefaultGlobal__asyncIteratorPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->asyncIteratorPrototype();
}
JSC::GeneratorFunctionPrototype* DefaultGlobal__generatorFunctionPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->generatorFunctionPrototype();
}
JSC::GeneratorPrototype* DefaultGlobal__generatorPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->generatorPrototype();
}
JSC::AsyncFunctionPrototype* DefaultGlobal__asyncFunctionPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->asyncFunctionPrototype();
}
JSC::ArrayIteratorPrototype* DefaultGlobal__arrayIteratorPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->arrayIteratorPrototype();
}
JSC::MapIteratorPrototype* DefaultGlobal__mapIteratorPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->mapIteratorPrototype();
}
JSC::SetIteratorPrototype* DefaultGlobal__setIteratorPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->setIteratorPrototype();
}
JSC::JSObject* DefaultGlobal__mapPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->mapPrototype();
}
JSC::JSObject* DefaultGlobal__jsSetPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->jsSetPrototype();
}
JSC::JSPromisePrototype* DefaultGlobal__promisePrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->promisePrototype();
}
JSC::AsyncGeneratorPrototype* DefaultGlobal__asyncGeneratorPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->asyncGeneratorPrototype();
}
JSC::AsyncGeneratorFunctionPrototype* DefaultGlobal__asyncGeneratorFunctionPrototype(Wundle::DefaultGlobal* arg0) {
    return arg0->asyncGeneratorFunctionPrototype();
}

}

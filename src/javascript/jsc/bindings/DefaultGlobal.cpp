
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



// const ClassInfo DefaultGlobal::s_info = { "GlobalObject", &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(DefaultGlobal) };
// const GlobalObjectMethodTable DefaultGlobal::s_globalObjectMethodTable = {
//     &supportsRichSourceInfo,
//     &shouldInterruptScript,
//     &javaScriptRuntimeFlags,
//     nullptr, // queueTaskToEventLoop
//     &shouldInterruptScriptBeforeTimeout,
//     &moduleLoaderImportModule, // moduleLoaderImportModule
//     &moduleLoaderResolve, // moduleLoaderResolve
//     &moduleLoaderFetch, // moduleLoaderFetch
//     &moduleLoaderCreateImportMetaProperties, // moduleLoaderCreateImportMetaProperties
//     &moduleLoaderEvaluate, // moduleLoaderEvaluate
//     nullptr, // promiseRejectionTracker
//     &reportUncaughtExceptionAtEventLoop,
//     &currentScriptExecutionOwner,
//     &scriptExecutionStatus,
//     nullptr, // defaultLanguage
//     nullptr, // compileStreaming
//     nullptr, // instantiateStreaming
// };


// void DefaultGlobal::reportUncaughtExceptionAtEventLoop(JSGlobalObject* globalObject, Exception* exception) {}
// JSC::Identifier DefaultGlobal::moduleLoaderResolve(JSGlobalObject* globalObject, JSModuleLoader* loader, JSValue key, JSValue referrer, JSValue val) {
// JSInternalPromise* DefaultGlobal::moduleLoaderImportModule(JSGlobalObject* globalObject, JSModuleLoader*, JSString* specifierValue, JSValue, const SourceOrigin& sourceOrigin) {
// JSInternalPromise* DefaultGlobal::moduleLoaderFetch(JSGlobalObject* globalObject, JSModuleLoader*, JSValue key, JSValue, JSValue) {
// JSC::JSObject* DefaultGlobal::moduleLoaderCreateImportMetaProperties(JSGlobalObject* globalObject, JSModuleLoader*loader, JSValue key, JSModuleRecord* record, JSValue value) {
// JSValue DefaultGlobal::moduleLoaderEvaluate(JSGlobalObject* globalObject, JSModuleLoader* moduleLoader, JSValue key, JSValue moduleRecordValue, JSValue scriptFetcher, JSValue sentValue, JSValue resumeMode) {

// using namespace JSC;
};

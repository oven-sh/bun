#include "engine/Engine.h"

namespace JSC {

static const GlobalObjectMethodTable& defaultMethodTable()
{
    static constexpr GlobalObjectMethodTable table {
        .reportUncaughtExceptionAtEventLoop = JSGlobalObject::reportUncaughtExceptionAtEventLoop,
        .currentScriptExecutionOwner = JSGlobalObject::currentScriptExecutionOwner,
        .scriptExecutionStatus = JSGlobalObject::scriptExecutionStatus,
    };
    return table;
}

JSGlobalObject::JSGlobalObject(VM& vm, Structure* structure, const GlobalObjectMethodTable* methodTable)
    : Base(vm, structure)
{
    Engine::global_construct(this, vm, structure, methodTable ? methodTable : &defaultMethodTable(), methodTable && methodTable->compileStreaming);
}

JSGlobalObject::~JSGlobalObject()
{
    Engine::global_destroy(this);
}

void JSGlobalObject::reportUncaughtExceptionAtEventLoop(JSGlobalObject*, Exception*)
{
}

extern "C" void engine_host_track_promise_rejection(JSGlobalObject* globalObject, JSPromise* promise, JSPromiseRejectionOperation operation)
{
    if (auto* track = globalObject->globalObjectMethodTable()->promiseRejectionTracker)
        track(globalObject, promise, operation);
}

extern "C" void engine_host_report_uncaught_exception(JSGlobalObject* globalObject, Exception* exception)
{
    globalObject->globalObjectMethodTable()->reportUncaughtExceptionAtEventLoop(globalObject, exception);
}

extern "C" JSObject* engine_host_current_script_execution_owner(JSGlobalObject* globalObject)
{
    return globalObject->globalObjectMethodTable()->currentScriptExecutionOwner(globalObject);
}

extern "C" ScriptExecutionStatus engine_host_script_execution_status(JSGlobalObject* globalObject, JSObject* owner)
{
    return globalObject->globalObjectMethodTable()->scriptExecutionStatus(globalObject, owner);
}

extern "C" JSGlobalObject* engine_host_derive_shadow_realm(JSGlobalObject* globalObject)
{
    return globalObject->globalObjectMethodTable()->deriveShadowRealmGlobalObject(globalObject);
}

const SourceOrigin& SourceProvider::sourceOrigin() const
{
    static NeverDestroyed<SourceOrigin> none;
    auto* origin = Engine::source_provider_origin(*this);
    return origin->isFromEmbedder() ? origin->m_origin : none.get();
}

SourceOrigin CallFrame::callerSourceOrigin(VM& vm)
{
    auto provider = Engine::source_origin_of_caller(vm);
    return provider ? provider->sourceOrigin() : SourceOrigin();
}

extern "C" void engine_host_delete_source_provider(SourceProvider* provider)
{
    delete provider;
}

} // namespace JSC

#include "NodeVMModule.h"
#include "BunClientData.h"
#include "NodeVMSourceTextModule.h"
#include "NodeVMSyntheticModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "JavaScriptCore/CyclicModuleRecord.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSPromise.h"

#include "../vm/NodeVMRunTermination.h"

#include <wtf/IterationStatus.h>

namespace Bun {

NodeVMModuleRequest::NodeVMModuleRequest(WTF::String specifier, WTF::HashMap<WTF::String, WTF::String> importAttributes)
    : m_specifier(WTF::move(specifier))
    , m_importAttributes(WTF::move(importAttributes))
{
}

JSArray* NodeVMModuleRequest::toJS(JSGlobalObject* globalObject) const
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSArray* array = JSC::constructEmptyArray(globalObject, nullptr, 2);
    RETURN_IF_EXCEPTION(scope, {});

    array->putDirectIndex(globalObject, 0, JSC::jsString(globalObject->vm(), m_specifier));
    RETURN_IF_EXCEPTION(scope, {});

    JSObject* attributes = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    for (const auto& [key, value] : m_importAttributes) {
        attributes->putDirect(globalObject->vm(), JSC::Identifier::fromString(globalObject->vm(), key), JSC::jsString(globalObject->vm(), value),
            PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete);
    }
    array->putDirectIndex(globalObject, 1, attributes);
    RETURN_IF_EXCEPTION(scope, {});

    return array;
}

void NodeVMModule::reconcileEvaluationState(JSC::VM& vm)
{
    // An error is final.
    if (m_status == Status::Errored)
        return;

    auto* sourceTextThis = dynamicDowncast<NodeVMSourceTextModule>(this);
    if (!sourceTextThis)
        return;
    JSC::JSModuleRecord* record = sourceTextThis->moduleRecordIfExists();
    if (!record)
        return;

    using RecordStatus = JSC::CyclicModuleRecord::Status;
    switch (record->status()) {
    case RecordStatus::New:
    case RecordStatus::Unlinked:
    case RecordStatus::Linking:
        return;
    case RecordStatus::Linked:
        status(Status::Linked);
        return;
    case RecordStatus::Evaluating:
        status(Status::Evaluating);
        return;
    case RecordStatus::EvaluatingAsync:
        // As in V8: a module that waits for a top-level await, its own or one of a module it imports, is "evaluated".
        status(Status::Evaluated);
        return;
    case RecordStatus::Evaluated:
        if (JSValue error = record->evaluationError()) {
            status(Status::Errored);
            m_evaluationException.set(vm, this, JSC::Exception::create(vm, error));
            return;
        }
        status(Status::Evaluated);
        return;
    }
}

// Calls `functor` for `root` and for every record that `root` reaches through its import requests, until `functor`
// returns WTF::IterationStatus::Done. The graph of `root` is linked. Iterative: a chain of imports is as deep as it is long.
template<typename Functor>
static void forEachRecordOfGraph(AbstractModuleRecord* root, const Functor& functor)
{
    WTF::HashSet<AbstractModuleRecord*> visited;
    WTF::Vector<AbstractModuleRecord*, 16> worklist;
    worklist.append(root);

    while (!worklist.isEmpty()) {
        AbstractModuleRecord* record = worklist.takeLast();
        if (!visited.add(record).isNewEntry)
            continue;
        if (functor(record) == WTF::IterationStatus::Done)
            return;
        for (const auto& request : record->requestedModules())
            worklist.append(JSC::JSModuleLoader::getImportedModule(record, request));
    }
}

// A termination that unwinds a job stops the module body that the job ran, and JSC drops the jobs that were queued
// after it. Such a record stays EvaluatingAsync, and no job is left to finish it: it has no dependency to wait
// for, and its body does not wait at a top-level await (the body was running, or had ended, or never started).
static bool wasStoppedInJob(JSC::CyclicModuleRecord* record)
{
    if (record->status() != JSC::CyclicModuleRecord::Status::EvaluatingAsync)
        return false;
    if (std::optional<int> pending = record->pendingAsyncDependencies(); !pending || *pending)
        return false;
    if (!record->hasTLA())
        return true;
    auto* jsRecord = dynamicDowncast<JSC::JSModuleRecord>(record);
    return jsRecord && !jsRecord->isSuspendedAtTopLevelAwait();
}

void NodeVMModule::errorModulesCutShort(JSGlobalObject* globalObject, AbstractModuleRecord* root, JSValue error, UnwoundIn unwoundIn)
{
    VM& vm = globalObject->vm();
    JSValue termination = vm.terminationException()->value();

    forEachRecordOfGraph(root, [&](AbstractModuleRecord* record) {
        auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record);
        if (!cyclic)
            return WTF::IterationStatus::Continue;
        if (unwoundIn == UnwoundIn::Walk) {
            // Evaluate() gave the records on its stack what unwound it as their error.
            if (cyclic->evaluationError() == termination)
                cyclic->setEvaluationError(vm, error);
        } else if (wasStoppedInJob(cyclic)) {
            // AsyncModuleExecutionRejected: the modules that wait for this one get the error too.
            cyclic->asyncExecutionRejected(globalObject, error);
        }
        return WTF::IterationStatus::Continue;
    });
}

JSValue NodeVMModule::evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    std::optional<Seconds> timeoutSeconds = timeout ? std::optional { Seconds::fromMilliseconds(timeout) } : std::nullopt;

    reconcileEvaluationState(vm);

    if (m_status != Status::Linked && m_status != Status::Evaluated && m_status != Status::Errored) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module must be linked, evaluated or errored before evaluating"_s);
        return {};
    }

    auto* sourceTextThis = dynamicDowncast<NodeVMSourceTextModule>(this);
    AbstractModuleRecord* record = moduleRecord(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSGlobalObject* callerGlobalObject = globalObject;
    NodeVMGlobalObject* nodeVmGlobalObject = NodeVM::getGlobalObjectFromContext(globalObject, m_context.get(), false);
    RETURN_IF_EXCEPTION(scope, {});
    if (nodeVmGlobalObject)
        globalObject = nodeVmGlobalObject;
    bool hasOwnMicrotaskQueue = nodeVmGlobalObject && nodeVmGlobalObject->hasOwnMicrotaskQueue();

    // Evaluate() runs the graph once: the module bodies and the SyntheticModule steps, each at its place in the
    // depth-first walk. It does not throw what a module throws. It keeps the error in the records and rejects
    // its promise. A later call runs nothing and gets the promise of the module's cycle root.
    bool firstEvaluation = m_status == Status::Linked;
    JSPromise* promise = nullptr;

    if (firstEvaluation || hasOwnMicrotaskQueue) {
        // SIGINT interrupts the realm being evaluated (the context's, else the caller's).
        NodeVMRunTermination termination(globalObject, timeoutSeconds, breakOnSigint);
        auto unwoundIn = UnwoundIn::Job;
        if (firstEvaluation) {
            if (sourceTextThis)
                promise = record->evaluate(globalObject);
            else
                record->evaluate(globalObject, jsUndefined(), jsNumber(static_cast<int32_t>(JSGenerator::ResumeMode::NormalMode)));
            if (scope.exception())
                unwoundIn = UnwoundIn::Walk;
        }
        // A context with microtaskMode "afterEvaluate" gets a checkpoint of its queue in every call, as in Node.
        // `timeout` and `breakOnSigint` bound it too.
        // https://github.com/nodejs/node/blob/v26.3.0/src/module_wrap.cc#L801-L843
        if (hasOwnMicrotaskQueue && !scope.exception() && !vm.hasTerminationRequest())
            nodeVmGlobalObject->drainOwnMicrotasks();

        JSC::Exception* unwoundBy = scope.exception();
        bool wasTerminated = unwoundBy && vm.isTerminationException(unwoundBy);
        // This run's own termination becomes ERR_SCRIPT_EXECUTION_* here.
        termination.finish(scope);

        // A termination stops module bodies where they are. The modules it stopped get the error of the run that
        // the termination belongs to: this run's, which finish() has thrown, or the one of a run this one is
        // nested in, whose termination stays pending. A termination that stops the VM is no run's.
        JSValue cutShortBy;
        if (JSObject* error = termination.errorForEnclosingRunCutShort()) {
            cutShortBy = error;
            NodeVMRunTermination::errorStepsCutShort(vm, error);
        } else if (wasTerminated) {
            JSC::Exception* thrown = scope.exception();
            if (thrown && !vm.isTerminationException(thrown))
                cutShortBy = thrown->value();
        }
        if (cutShortBy)
            errorModulesCutShort(globalObject, record, cutShortBy, unwoundIn);
    }

    if (scope.exception()) [[unlikely]] {
        // The caller gets this exception and not the promise of Evaluate(), so nothing else reports that promise.
        if (promise)
            promise->markAsHandled();
        return {};
    }

    reconcileEvaluationState(vm);

    if (m_status == Status::Errored) {
        // vm.ts makes the rejected promise that the caller gets from this throw.
        if (promise)
            promise->markAsHandled();
        scope.throwException(globalObject, m_evaluationException.get());
        return {};
    }

    if (!sourceTextThis)
        return jsUndefined();

    if (!firstEvaluation) {
        promise = record->evaluate(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (hasOwnMicrotaskQueue) {
        // As in Node, the caller does not get a promise of the context: a reaction to one waits in the context's
        // queue, which only a checkpoint like the one above runs.
        switch (promise->status()) {
        case JSPromise::Status::Fulfilled:
            RELEASE_AND_RETURN(scope, JSPromise::resolvedPromise(callerGlobalObject, promise->result()));
        case JSPromise::Status::Rejected:
            promise->markAsHandled();
            RELEASE_AND_RETURN(scope, JSPromise::rejectedPromise(callerGlobalObject, promise->result()));
        case JSPromise::Status::Pending: {
            JSPromise* callerPromise = JSPromise::create(vm, callerGlobalObject->promiseStructure());
            callerPromise->pipeFrom(vm, promise);
            return callerPromise;
        }
        }
    }

    return promise;
}

NodeVMModule::NodeVMModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier, JSValue context, JSValue moduleWrapper)
    : Base(vm, structure)
    , m_identifier(WTF::move(identifier))
    , m_context(context && context.isObject() ? asObject(context) : nullptr, JSC::WriteBarrierEarlyInit)
    , m_moduleWrapper(moduleWrapper, JSC::WriteBarrierEarlyInit)
{
}

JSValue NodeVMModule::createModuleRecord(JSC::JSGlobalObject* globalObject)
{
    if (auto* thisObject = dynamicDowncast<NodeVMSourceTextModule>(this)) {
        return thisObject->createModuleRecord(globalObject);
    } else if (auto* thisObject = dynamicDowncast<NodeVMSyntheticModule>(this)) {
        thisObject->createModuleRecord(globalObject);
        return jsUndefined();
    }

    RELEASE_ASSERT_NOT_REACHED();
    return jsUndefined();
}

AbstractModuleRecord* NodeVMModule::moduleRecord(JSC::JSGlobalObject* globalObject)
{
    if (auto* thisObject = dynamicDowncast<NodeVMSourceTextModule>(this)) {
        return thisObject->moduleRecord(globalObject);
    } else if (auto* thisObject = dynamicDowncast<NodeVMSyntheticModule>(this)) {
        return thisObject->moduleRecord(globalObject);
    }

    RELEASE_ASSERT_NOT_REACHED();
    return nullptr;
}

NodeVMModule* NodeVMModule::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, ArgList args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue disambiguator = args.at(2);

    if (disambiguator.isString()) {
        RELEASE_AND_RETURN(scope, NodeVMSourceTextModule::create(vm, globalObject, args));
    }

    if (disambiguator.inherits(JSArray::info())) {
        RELEASE_AND_RETURN(scope, NodeVMSyntheticModule::create(vm, globalObject, args));
    }

    throwArgumentTypeError(*globalObject, scope, 2, "sourceText or syntheticExportNames"_s, "Module"_s, "Module"_s, "string or array"_s);
    return nullptr;
}

JSModuleNamespaceObject* NodeVMModule::namespaceObject(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleNamespaceObject* object = m_namespaceObject.get();
    if (object) {
        return object;
    }

    AbstractModuleRecord* amr = this->moduleRecord(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    object = amr->getModuleNamespace(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (object) {
        // The shared module namespace structure carries an __esModule accessor for
        // CJS interop, but a Module Namespace Exotic Object is specified to have a
        // null [[Prototype]], which is what vm modules must expose.
        object->setPrototypeDirect(vm, jsNull());
        namespaceObject(vm, object);
    }
    RETURN_IF_EXCEPTION(scope, {});

    return object;
}

JSC_DECLARE_CUSTOM_GETTER(jsNodeVmModuleGetterIdentifier);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleGetStatusCode);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleGetStatus);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleGetNamespace);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleGetError);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleInstantiate);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleEvaluate);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleGetModuleRequests);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleLink);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleCreateCachedData);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleSetExport);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleCreateModuleRecord);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleHasTopLevelAwait);
JSC_DECLARE_HOST_FUNCTION(jsNodeVmModuleHasAsyncGraph);

static const HashTableValue NodeVMModulePrototypeTableValues[] = {
    { "identifier"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeVmModuleGetterIdentifier, nullptr } },
    { "getStatusCode"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleGetStatusCode, 0 } },
    { "getStatus"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleGetStatus, 0 } },
    { "getNamespace"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleGetNamespace, 0 } },
    { "getError"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleGetError, 0 } },
    { "instantiate"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleInstantiate, 0 } },
    { "evaluate"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleEvaluate, 2 } },
    { "getModuleRequests"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleGetModuleRequests, 0 } },
    { "link"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleLink, 2 } },
    { "createCachedData"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleCreateCachedData, 0 } },
    { "setExport"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleSetExport, 2 } },
    { "createModuleRecord"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleCreateModuleRecord, 0 } },
    { "hasTopLevelAwait"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleHasTopLevelAwait, 0 } },
    { "hasAsyncGraph"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeVmModuleHasAsyncGraph, 0 } },
};

NodeVMModulePrototype* NodeVMModulePrototype::create(VM& vm, Structure* structure)
{
    NodeVMModulePrototype* prototype = new (NotNull, allocateCell<NodeVMModulePrototype>(vm)) NodeVMModulePrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

Structure* NodeVMModulePrototype::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

NodeVMModulePrototype::NodeVMModulePrototype(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void NodeVMModulePrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    Bun::reifyStaticPropertyTable(vm, info(), NodeVMModulePrototypeTableValues, *this);
    this->structure()->setMayBePrototype(true);
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeVmModuleGetterIdentifier, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMModule>(JSC::JSValue::decode(thisValue))) {
        return JSValue::encode(JSC::jsString(vm, thisObject->identifier()));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetStatusCode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMModule>(callFrame->thisValue())) {
        thisObject->reconcileEvaluationState(vm);
        return JSValue::encode(JSC::jsNumber(static_cast<uint32_t>(thisObject->status())));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetStatus, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<NodeVMModule>(callFrame->thisValue());
    if (!thisObject) {
        throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
        return {};
    }

    thisObject->reconcileEvaluationState(vm);

    using enum NodeVMModule::Status;
    switch (thisObject->status()) {
    case Unlinked:
        return JSValue::encode(JSC::jsString(globalObject->vm(), WTF::String("unlinked"_s)));
    case Linking:
        return JSValue::encode(JSC::jsString(globalObject->vm(), WTF::String("linking"_s)));
    case Linked:
        return JSValue::encode(JSC::jsString(globalObject->vm(), WTF::String("linked"_s)));
    case Evaluating:
        return JSValue::encode(JSC::jsString(globalObject->vm(), WTF::String("evaluating"_s)));
    case Evaluated:
        return JSValue::encode(JSC::jsString(globalObject->vm(), WTF::String("evaluated"_s)));
    case Errored:
        return JSValue::encode(JSC::jsString(globalObject->vm(), WTF::String("errored"_s)));
    default:
        return JSC::encodedJSUndefined();
    }
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetNamespace, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMModule>(callFrame->thisValue())) {
        RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->namespaceObject(globalObject)));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetError, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMModule>(callFrame->thisValue())) {
        thisObject->reconcileEvaluationState(vm);
        if (JSC::Exception* exception = thisObject->evaluationException()) {
            return JSValue::encode(exception->value());
        }
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module status must be errored"_s);
        return {};
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetModuleRequests, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<NodeVMModule>(callFrame->thisValue());
    if (!thisObject) {
        throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
        return {};
    }

    if (auto* sourceTextModule = dynamicDowncast<NodeVMSourceTextModule>(callFrame->thisValue())) {
        sourceTextModule->ensureModuleRecord(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    const WTF::Vector<NodeVMModuleRequest>& requests = thisObject->moduleRequests();

    JSArray* array = constructEmptyArray(globalObject, nullptr, requests.size());
    RETURN_IF_EXCEPTION(scope, {});

    for (unsigned i = 0; const NodeVMModuleRequest& request : requests) {
        // toJS's RETURN_IF_EXCEPTION services VM traps, so termination can surface there as a null return.
        auto* requestValue = request.toJS(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        array->putDirectIndex(globalObject, i++, requestValue);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(array);
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleEvaluate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // vm.ts validated the timeout by value (or passes -1 for none); the number may still be boxed
    // as a double, which isUInt32() rejects.
    JSValue timeoutValue = callFrame->argument(0);
    uint32_t timeout = 0;
    if (timeoutValue.isUInt32AsAnyInt()) {
        timeout = timeoutValue.asUInt32AsAnyInt();
    }

    JSValue breakOnSigintValue = callFrame->argument(1);
    bool breakOnSigint = false;
    if (breakOnSigintValue.isBoolean()) {
        breakOnSigint = breakOnSigintValue.asBoolean();
    }

    if (auto* thisObject = dynamicDowncast<NodeVMModule>(callFrame->thisValue())) {
        RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->evaluate(globalObject, timeout, breakOnSigint)));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleLink, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSArray* specifiers = dynamicDowncast<JSArray>(callFrame->argument(0));
    JSArray* moduleNatives = dynamicDowncast<JSArray>(callFrame->argument(1));

    if (!specifiers) {
        return throwArgumentTypeError(*globalObject, scope, 0, "specifiers"_s, "Module"_s, "Module"_s, "Array"_s);
    }

    if (!moduleNatives) {
        return throwArgumentTypeError(*globalObject, scope, 1, "moduleNatives"_s, "Module"_s, "Module"_s, "Array"_s);
    }

    if (auto* thisObject = dynamicDowncast<NodeVMSourceTextModule>(callFrame->thisValue())) {
        RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->link(globalObject, specifiers, moduleNatives, callFrame->argument(2))));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleInstantiate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMSourceTextModule>(callFrame->thisValue())) {
        RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->instantiate(globalObject)));
    }

    if (auto* thisObject = dynamicDowncast<NodeVMSyntheticModule>(callFrame->thisValue())) {
        RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->instantiate(globalObject)));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleSetExport, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMSyntheticModule>(callFrame->thisValue())) {
        JSValue nameValue = callFrame->argument(0);
        if (!nameValue.isString()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "name"_str, "string"_s, nameValue);
            return {};
        }
        JSValue exportValue = callFrame->argument(1);
        WTF::String exportName = nameValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        thisObject->setExport(globalObject, exportName, exportValue);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        throwTypeError(globalObject, scope, "This function must be called on a SyntheticModule"_s);
        return {};
    }

    return JSC::encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleCreateCachedData, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMSourceTextModule>(callFrame->thisValue())) {
        RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->cachedData(globalObject)));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule"_s);
    return {};
}

// Whether a module of the graph has a top-level await. vm.ts calls this for a linked SourceTextModule only.
bool NodeVMModule::hasAsyncGraph()
{
    auto* sourceTextThis = dynamicDowncast<NodeVMSourceTextModule>(this);
    JSC::JSModuleRecord* root = sourceTextThis ? sourceTextThis->moduleRecordIfExists() : nullptr;
    if (!root)
        return false;

    bool hasTopLevelAwait = false;
    forEachRecordOfGraph(root, [&](AbstractModuleRecord* record) {
        if (!record->hasTLA())
            return WTF::IterationStatus::Continue;
        hasTopLevelAwait = true;
        return WTF::IterationStatus::Done;
    });
    return hasTopLevelAwait;
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleHasTopLevelAwait, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMSourceTextModule>(callFrame->thisValue())) {
        return JSValue::encode(JSC::jsBoolean(thisObject->hasTopLevelAwait()));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleHasAsyncGraph, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMModule>(callFrame->thisValue())) {
        return JSValue::encode(JSC::jsBoolean(thisObject->hasAsyncGraph()));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleCreateModuleRecord, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = dynamicDowncast<NodeVMModule>(callFrame->thisValue())) {
        RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->createModuleRecord(globalObject)));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

template<typename Visitor>
void NodeVMModule::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* vmModule = uncheckedDowncast<NodeVMModule>(cell);
    ASSERT_GC_OBJECT_INHERITS(vmModule, info());
    Base::visitChildren(vmModule, visitor);

    visitor.append(vmModule->m_namespaceObject);
    visitor.append(vmModule->m_context);
    visitor.append(vmModule->m_moduleWrapper);
    visitor.append(vmModule->m_evaluationException);

    // m_resolveCache is mutated on the mutator thread by
    // NodeVMSourceTextModule::link() via m_resolveCache.set(), which can
    // rehash and free the old bucket array while a concurrent marker is
    // iterating values() here. Both sides take cellLock() (same pattern as
    // AbstractModuleRecord::visitChildrenImpl / setImportedModule).
    WTF::Locker locker { vmModule->cellLock() };
    auto moduleNatives = vmModule->m_resolveCache.values();
    visitor.append(moduleNatives.begin(), moduleNatives.end());
}

DEFINE_VISIT_CHILDREN(NodeVMModule);

static EncodedJSValue
constructModule(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget = {})
{
    auto& vm = globalObject->vm();
    ArgList args(callFrame);
    return JSValue::encode(NodeVMModule::create(vm, globalObject, args));
}

JSC_DEFINE_HOST_FUNCTION(moduleConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructModule(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(moduleConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructModule(globalObject, callFrame, callFrame->newTarget());
}

NodeVMModuleConstructor* NodeVMModuleConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    NodeVMModuleConstructor* ptr = new (NotNull, allocateCell<NodeVMModuleConstructor>(vm)) NodeVMModuleConstructor(vm, structure);
    ptr->finishCreation(vm, prototype);
    return ptr;
}

NodeVMModuleConstructor::NodeVMModuleConstructor(VM& vm, Structure* structure)
    : NodeVMModuleConstructor::Base(vm, structure, moduleConstructorCall, moduleConstructorConstruct)
{
}

JSC::Structure* NodeVMModuleConstructor::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
}

void NodeVMModuleConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "Module"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

const JSC::ClassInfo NodeVMModule::s_info = { "NodeVMModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMModule) };
const JSC::ClassInfo NodeVMModulePrototype::s_info = { "NodeVMModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMModulePrototype) };
const JSC::ClassInfo NodeVMModuleConstructor::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMModuleConstructor) };

JSC::JSGlobalObject* NodeVMModule::moduleRealm(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    NodeVMGlobalObject* contextGlobalObject = NodeVM::getGlobalObjectFromContext(globalObject, m_context.get(), false);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return contextGlobalObject ? contextGlobalObject : globalObject;
}

} // namespace Bun

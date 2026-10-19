#include "NodeVMModule.h"
#include "BunClientData.h"
#include "NodeVMScriptFetcher.h"
#include "NodeVMSourceTextModule.h"
#include "NodeVMSyntheticModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "JavaScriptCore/CyclicModuleRecord.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/HeapIterationScope.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/MarkedSpaceInlines.h"
#include "JavaScriptCore/SubspaceInlines.h"

#include "../vm/NodeVMRunTermination.h"

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
        constexpr unsigned propertyAttributes = PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete;
        JSC::Identifier identifier = JSC::Identifier::fromString(vm, key);
        JSValue attributeValue = JSC::jsString(vm, value);
        // An attribute key can be any string literal, including an array index.
        if (auto index = parseIndex(identifier)) {
            attributes->putDirectIndex(globalObject, *index, attributeValue, propertyAttributes, PutDirectIndexLikePutDirect);
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            attributes->putDirect(vm, identifier, attributeValue, propertyAttributes);
        }
    }
    array->putDirectIndex(globalObject, 1, attributes);
    RETURN_IF_EXCEPTION(scope, {});

    return array;
}

JSC::JSModuleRecord* NodeVMModule::moduleRecordIfExists() const
{
    if (auto* sourceTextThis = dynamicDowncast<NodeVMSourceTextModule>(this))
        return sourceTextThis->moduleRecordIfExists();
    return uncheckedDowncast<NodeVMSyntheticModule>(this)->moduleRecordIfExists();
}

NodeVMModule::Status NodeVMModule::status() const
{
    JSC::JSModuleRecord* record = moduleRecordIfExists();
    if (auto* syntheticThis = dynamicDowncast<NodeVMSyntheticModule>(this)) {
        if (!syntheticThis->isInstantiated())
            return Status::Unlinked;
        // The record of a SyntheticModule is made when something needs it, and it is linked from the start.
        if (!record)
            return Status::Linked;
    } else if (!record)
        return Status::Unlinked;

    using RecordStatus = JSC::CyclicModuleRecord::Status;
    switch (record->status()) {
    case RecordStatus::New:
    case RecordStatus::Unlinked:
    case RecordStatus::Linking:
        return Status::Unlinked;
    case RecordStatus::Linked:
        return Status::Linked;
    case RecordStatus::Evaluating:
        return Status::Evaluating;
    case RecordStatus::EvaluatingAsync:
        // As in V8: a module that waits for a top-level await, its own or one of a module it imports, is "evaluated".
        return Status::Evaluated;
    case RecordStatus::Evaluated:
        return record->evaluationError() ? Status::Errored : Status::Evaluated;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

JSValue NodeVMModule::evaluationError() const
{
    JSC::JSModuleRecord* record = moduleRecordIfExists();
    if (record && record->status() == JSC::CyclicModuleRecord::Status::Evaluated)
        return record->evaluationError();
    return {};
}

// As for a generator, the state of a module body is the index of its yield point while it waits at one.
static bool isSuspendedAtTopLevelAwait(JSC::JSModuleRecord* record)
{
    JSValue state = record->internalField(JSC::AbstractModuleRecord::Field::State).get();
    return state.isInt32() && state.asInt32() > 0;
}

// JSC drops the jobs behind a job that a termination stops: whether `record` was to run or finish in one of them.
static bool wasStoppedInJob(JSC::JSModuleRecord* record)
{
    if (record->status() != JSC::CyclicModuleRecord::Status::EvaluatingAsync)
        return false;
    if (std::optional<int> pending = record->pendingAsyncDependencies(); !pending || *pending)
        return false;
    return !record->hasTLA() || !isSuspendedAtTopLevelAwait(record);
}

// The run throws its error to its caller, so what AsyncModuleExecutionRejected(record) rejects is not unhandled.
static void markCapabilitiesOfAsyncParentsAsHandled(JSC::CyclicModuleRecord* record)
{
    WTF::HashSet<JSC::AbstractModuleRecord*> visited;
    WTF::Vector<JSC::CyclicModuleRecord*, 8> worklist;
    worklist.append(record);

    while (!worklist.isEmpty()) {
        JSC::CyclicModuleRecord* module = worklist.takeLast();
        if (module->status() != JSC::CyclicModuleRecord::Status::EvaluatingAsync || !visited.add(module).isNewEntry)
            continue;
        if (JSPromise* capability = module->topLevelCapability())
            capability->markAsHandled();
        for (const auto& parent : module->asyncParentModules())
            worklist.append(uncheckedDowncast<JSC::CyclicModuleRecord>(parent.get()));
    }
}

void NodeVMModule::errorModulesCutShort(VM& vm, JSValue error, const ArgList& checkpointsCutShort, JSC::CyclicModuleRecord* moduleOfRun)
{
    // The VM made no node:vm module, so the termination stopped none.
    auto& subspaces = WebCore::clientData(vm)->clientSubspaces();
    if (!subspaces.m_clientSubspaceForNodeVMSourceTextModule && !subspaces.m_clientSubspaceForNodeVMSyntheticModule) [[likely]]
        return;
    auto scope = DECLARE_THROW_SCOPE(vm);

    // JSC keeps no list of the records that a termination stopped, so this looks at every module record in the heap.
    JSC::MarkedArgumentBuffer unwoundInWalk;
    JSC::MarkedArgumentBuffer stoppedInJob;
    JSC::Exception* terminationException = vm.terminationException();
    if (auto* records = vm.heap.jsModuleRecordSpace<JSC::SubspaceAccess::Concurrently>(); records && terminationException) {
        JSValue termination = terminationException->value();
        JSC::HeapIterationScope iterationScope(vm.heap);
        records->forEachLiveCell([&](JSC::HeapCell* cell, JSC::HeapCell::Kind) {
            auto* record = static_cast<JSC::JSModuleRecord*>(cell);
            if (record->evaluationError() == termination) {
                // What Evaluate() leaves on its stack. A module can also throw this value, so the rest is checked too.
                JSPromise* capability = record->topLevelCapability();
                if (record->status() == JSC::CyclicModuleRecord::Status::Evaluated && !record->cycleRoot()
                    && (!capability || capability->status() == JSPromise::Status::Pending)
                    && NodeVMScriptFetcher::of(record->sourceCode()))
                    unwoundInWalk.append(record);
            } else if (!checkpointsCutShort.isEmpty() && wasStoppedInJob(record) && NodeVMScriptFetcher::of(record->sourceCode())) {
                JSGlobalObject* realm = record->realm();
                for (size_t i = 0; i < checkpointsCutShort.size(); ++i) {
                    if (checkpointsCutShort.at(i) == realm) {
                        stoppedInJob.append(record);
                        break;
                    }
                }
            }
        });
    }

    for (size_t i = 0; i < unwoundInWalk.size(); ++i) {
        auto* record = uncheckedDowncast<JSC::JSModuleRecord>(unwoundInWalk.at(i));
        record->setEvaluationError(vm, error);
        // A termination rejects nothing, and the caller of the run gets the error: this rejection is not unhandled.
        if (JSPromise* capability = record->topLevelCapability())
            capability->rejectAsHandled(vm, error);
    }

    // In the order in which the modules were to run, which the heap does not have.
    WTF::Vector<JSC::JSModuleRecord*, 8> inOrder;
    for (size_t i = 0; i < stoppedInJob.size(); ++i)
        inOrder.append(uncheckedDowncast<JSC::JSModuleRecord>(stoppedInJob.at(i)));
    std::ranges::sort(inOrder, [](JSC::JSModuleRecord* left, JSC::JSModuleRecord* right) {
        return left->asyncEvaluationOrder().order() < right->asyncEvaluationOrder().order();
    });
    for (JSC::JSModuleRecord* record : inOrder) {
        // AsyncModuleExecutionRejected of a module that this one imports from has given it the error already.
        if (!wasStoppedInJob(record))
            continue;
        JSGlobalObject* realm = record->realm();
        // The promise of the body of a module with a top-level await. JSC dropped the job that was to act on it.
        JSPromise* body = record->asyncCapability();
        if (body && body->status() == JSPromise::Status::Rejected) {
            // The body threw. The module has that error, not the error of the run.
            markCapabilitiesOfAsyncParentsAsHandled(record);
            record->asyncExecutionRejected(realm, body->result());
            continue;
        }
        if (body && body->status() == JSPromise::Status::Fulfilled) {
            // The body ended. The modules that the dropped job was to run next are stopped, and JSC does the rest.
            for (const auto& parent : record->asyncParentModules()) {
                auto* importer = uncheckedDowncast<JSC::CyclicModuleRecord>(parent.get());
                if (std::optional<int> pending = importer->pendingAsyncDependencies(); !pending || *pending != 1)
                    continue;
                using Status = JSC::CyclicModuleRecord::Status;
                // On the stack of a walk, such a module runs in the job when the walk has read its count already.
                bool wasToRun = importer->status() == Status::EvaluatingAsync || (importer->status() == Status::Evaluating && importer->asyncEvaluationOrder().hasOrder());
                if (!wasToRun)
                    continue;
                markCapabilitiesOfAsyncParentsAsHandled(importer);
                importer->asyncExecutionRejected(realm, error);
            }
            record->asyncExecutionFulfilled(realm);
            // No module code ran. A termination that another run requested meanwhile is seen after the loop.
            RETURN_IF_EXCEPTION_WITH_TRAPS_DEFERRED(scope, );
            continue;
        }
        // The body was running, or was next to run in the job.
        markCapabilitiesOfAsyncParentsAsHandled(record);
        record->asyncExecutionRejected(realm, error);
    }

    // #38660: the module that the run's evaluate() was on has the error of the run when the call did not finish it.
    if (moduleOfRun) {
        using Status = JSC::CyclicModuleRecord::Status;
        JSC::CyclicModuleRecord* root = moduleOfRun;
        if ((root->status() == Status::EvaluatingAsync || root->status() == Status::Evaluated) && root->cycleRoot())
            root = root->cycleRoot();
        if (root->status() == Status::EvaluatingAsync) {
            markCapabilitiesOfAsyncParentsAsHandled(root);
            root->asyncExecutionRejected(root->realm(), error);
        }
    }

    // The settlements above queued jobs in the contexts' queues, which the termination had emptied: run them.
    for (size_t i = 0; i < checkpointsCutShort.size(); ++i) {
        uncheckedDowncast<NodeVMGlobalObject>(checkpointsCutShort.at(i))->drainOwnMicrotasks();
        RETURN_IF_EXCEPTION(scope, );
    }
}

JSValue NodeVMModule::evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    std::optional<Seconds> timeoutSeconds = timeout ? std::optional { Seconds::fromMilliseconds(timeout) } : std::nullopt;

    Status statusBefore = status();
    if (statusBefore != Status::Linked && statusBefore != Status::Evaluated && statusBefore != Status::Errored) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module must be linked, evaluated or errored before evaluating"_s);
        return {};
    }

    AbstractModuleRecord* record = moduleRecord(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSGlobalObject* callerGlobalObject = globalObject;
    NodeVMGlobalObject* nodeVmGlobalObject = NodeVM::getGlobalObjectFromContext(globalObject, m_context.get(), false);
    RETURN_IF_EXCEPTION(scope, {});
    if (nodeVmGlobalObject)
        globalObject = nodeVmGlobalObject;
    bool hasOwnMicrotaskQueue = nodeVmGlobalObject && nodeVmGlobalObject->hasOwnMicrotaskQueue();

    // Evaluate() runs the graph once and rejects its promise with what a module throws. A later call runs nothing.
    bool firstEvaluation = statusBefore == Status::Linked;
    JSPromise* promise = nullptr;

    if (firstEvaluation || hasOwnMicrotaskQueue) {
        // SIGINT interrupts the realm being evaluated (the context's, else the caller's).
        NodeVMRunTermination termination(globalObject, timeoutSeconds, breakOnSigint);
        if (firstEvaluation)
            promise = record->evaluate(globalObject);
        // As in Node (ModuleWrap::Evaluate), an afterEvaluate context gets a checkpoint of its queue in every call.
        if (hasOwnMicrotaskQueue && !scope.exception() && !vm.hasTerminationRequest())
            nodeVmGlobalObject->drainOwnMicrotasks();
        // A run that was cut short throws here, and errorModulesCutShort() gives its error to the modules it stopped.
        termination.finish(scope, uncheckedDowncast<JSC::CyclicModuleRecord>(record));
    }

    RETURN_IF_EXCEPTION(scope, {});

    if (status() == Status::Errored) {
        // As in V8: the failed root of an Evaluate() gives the promise of that call, any other module a new rejection.
        JSPromise* capability = record->topLevelCapability();
        if (dynamicDowncast<NodeVMSyntheticModule>(this)) {
            // V8 makes no promise for a SyntheticModule whose evaluateCallback threw: nothing gives out the record's.
            if (capability)
                capability->markAsHandled();
            capability = nullptr;
            // Node rethrows what the evaluateCallback threw from the call that ran it. vm.ts makes the rejection.
            if (firstEvaluation) {
                throwException(globalObject, scope, evaluationError());
                return {};
            }
        }
        if (capability && capability->status() == JSPromise::Status::Rejected)
            promise = capability;
        else
            promise = JSPromise::rejectedPromise(globalObject, evaluationError());
    } else if (!firstEvaluation) {
        promise = record->evaluate(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (hasOwnMicrotaskQueue) {
        // As in Node, the caller gets a promise of its own realm: a reaction to one of the context waits in its queue.
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
    // link() can still change the modules that the exports of this one come from.
    if (auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(amr); cyclic && cyclic->status() < JSC::CyclicModuleRecord::Status::Linked) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module status must not be unlinked or linking"_s);
        return {};
    }
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

    if (auto* thisObject = dynamicDowncast<NodeVMModule>(callFrame->thisValue()))
        return JSValue::encode(JSC::jsNumber(static_cast<uint32_t>(thisObject->status())));

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
        if (thisObject->status() == NodeVMModule::Status::Errored)
            return JSValue::encode(thisObject->evaluationError());
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

// Whether a module that this one reaches has a top-level await. A request that is not linked yet reaches nothing.
bool NodeVMModule::hasAsyncGraph()
{
    auto* sourceTextThis = dynamicDowncast<NodeVMSourceTextModule>(this);
    JSC::JSModuleRecord* root = sourceTextThis ? sourceTextThis->moduleRecordIfExists() : nullptr;
    if (!root)
        return false;

    bool hasTopLevelAwait = false;
    forEachRecordOfGraph(
        root,
        [&](AbstractModuleRecord* record) {
            if (!record->hasTLA())
                return WTF::IterationStatus::Continue;
            hasTopLevelAwait = true;
            return WTF::IterationStatus::Done;
        },
        [](const AbstractModuleRecord::ModuleRequest&) { return WTF::IterationStatus::Continue; });
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
        if (thisObject->status() < NodeVMModule::Status::Linked) {
            throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module must be linked before its graph is known"_s);
            return {};
        }
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
    visitor.append(vmModule->m_linkedModules);
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

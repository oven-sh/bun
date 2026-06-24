#include "NodeVMModule.h"
#include "NodeVMSourceTextModule.h"
#include "NodeVMSyntheticModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "JavaScriptCore/CyclicModuleRecord.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/Watchdog.h"

#include "../vm/SigintWatcher.h"

namespace Bun {

NodeVMModuleRequest::NodeVMModuleRequest(WTF::String specifier, WTF::HashMap<WTF::String, WTF::String> importAttributes)
    : m_specifier(WTF::move(specifier))
    , m_importAttributes(WTF::move(importAttributes))
{
}

void NodeVMModuleRequest::addImportAttribute(WTF::String key, WTF::String value)
{
    m_importAttributes.set(WTF::move(key), WTF::move(value));
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
        RETURN_IF_EXCEPTION(scope, {});
    }
    array->putDirectIndex(globalObject, 1, attributes);
    RETURN_IF_EXCEPTION(scope, {});

    return array;
}

void setupWatchdog(VM& vm, double timeout, double* oldTimeout, double* newTimeout);

void NodeVMModule::reconcileEvaluationState(JSC::VM& vm)
{
    if (m_status != Status::Evaluating)
        return;

    auto* sourceTextThis = dynamicDowncast<NodeVMSourceTextModule>(this);
    if (!sourceTextThis)
        return;

    // JSModuleRecord is a CyclicModuleRecord; no downcast machinery needed.
    JSC::JSModuleRecord* cyclic = sourceTextThis->moduleRecordIfExists();
    if (!cyclic || cyclic->status() != JSC::CyclicModuleRecord::Status::Evaluated)
        return;

    if (JSValue error = cyclic->evaluationError(); error && !error.isEmpty()) {
        status(Status::Errored);
        m_evaluationException.set(vm, this, JSC::Exception::create(vm, error));
    } else {
        status(Status::Evaluated);
    }
}

JSValue NodeVMModule::evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    reconcileEvaluationState(vm);

    if (m_status != Status::Linked && m_status != Status::Evaluated && m_status != Status::Errored) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module must be linked, evaluated or errored before evaluating"_s);
        return {};
    }

    if (m_status == Status::Evaluated) {
        // Node re-enters ModuleWrap::Evaluate even for already-evaluated
        // modules; for microtaskMode "afterEvaluate" contexts that performs a
        // microtask checkpoint on the context's own queue.
        NodeVMGlobalObject* nodeVmGlobalObject = NodeVM::getGlobalObjectFromContext(globalObject, m_context.get(), false);
        RETURN_IF_EXCEPTION(scope, {});
        if (nodeVmGlobalObject && nodeVmGlobalObject->hasOwnMicrotaskQueue()) {
            std::optional<double> oldLimit;
            if (timeout != 0)
                setupWatchdog(vm, timeout, &oldLimit.emplace(), nullptr);
            nodeVmGlobalObject->drainOwnMicrotasks();
            if (timeout != 0)
                vm.watchdog()->setTimeLimit(WTF::Seconds::fromMilliseconds(*oldLimit));
            // The drain may legitimately leave the termination exception
            // pending (watchdog fired mid-checkpoint); observe it so the
            // exception-check validator is satisfied before the TOP scope
            // below, then convert it to ERR_SCRIPT_EXECUTION_*.
            std::ignore = scope.exception();
            if (vm.hasTerminationRequest() || vm.hasPendingTerminationException()) {
                vm.drainMicrotasksForGlobalObject(nodeVmGlobalObject);
                DECLARE_TOP_EXCEPTION_SCOPE(vm).clearException();
                vm.clearHasTerminationRequest();
                if (getSigintReceived()) {
                    setSigintReceived(false);
                    throwError(globalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);
                } else {
                    throwError(globalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, timeout, "ms"_s));
                }
                return {};
            }
        }
        return m_evaluationResult.get();
    }

    auto* sourceTextThis = dynamicDowncast<NodeVMSourceTextModule>(this);
    auto* syntheticThis = dynamicDowncast<NodeVMSyntheticModule>(this);

    // Evaluating an errored module must reject with the same error instance
    // every time, not re-run the module body.
    if (m_status == Status::Errored) {
        if (JSC::Exception* exception = m_evaluationException.get()) {
            scope.throwException(globalObject, exception);
            return {};
        }
    }

#define VM_RETURN_IF_EXCEPTION(scope__, value__)               \
    do {                                                       \
        if (JSC::Exception* exception = scope__.exception()) { \
            status(Status::Errored);                           \
            m_evaluationException.set(vm, this, exception);    \
            return value__;                                    \
        }                                                      \
    } while (false);

    AbstractModuleRecord* record {};
    if (sourceTextThis) {
        record = sourceTextThis->moduleRecord(globalObject);
        VM_RETURN_IF_EXCEPTION(scope, {});
    } else if (syntheticThis) {
        record = syntheticThis->moduleRecord(globalObject);
        VM_RETURN_IF_EXCEPTION(scope, {});
    } else {
        RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("Invalid module type");
    }

    JSValue result {};

    JSGlobalObject* callerGlobalObject = globalObject;
    NodeVMGlobalObject* nodeVmGlobalObject = NodeVM::getGlobalObjectFromContext(globalObject, m_context.get(), false);
    VM_RETURN_IF_EXCEPTION(scope, {});
    if (nodeVmGlobalObject) globalObject = nodeVmGlobalObject;

    auto run = [&] {
        if (sourceTextThis) {
            status(Status::Evaluating);
            evaluateDependencies(globalObject, record, timeout, breakOnSigint);
            RETURN_IF_EXCEPTION(scope, );
            sourceTextThis->initializeImportMeta(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            // Spec-style Evaluate(): returns the capability promise that
            // settles when (possibly async, for top-level await) evaluation
            // finishes. Errors are stored on the record, not thrown.
            result = record->evaluate(globalObject);
            RETURN_IF_EXCEPTION(scope, );
        } else if (syntheticThis) {
            // Mark Evaluating before running the user's evaluation steps so a
            // re-entrant evaluate() from inside them rejects with
            // ERR_VM_MODULE_STATUS instead of recursing forever.
            status(Status::Evaluating);
            syntheticThis->evaluate(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            result = record->evaluate(globalObject, jsUndefined(), jsNumber(static_cast<int32_t>(JSGenerator::ResumeMode::NormalMode)));
            RETURN_IF_EXCEPTION(scope, );
        }
    };

    // Match Node's ModuleWrap::Evaluate for microtaskMode "afterEvaluate"
    // contexts: never hand the caller a promise created inside the context
    // (awaiting it from the outer context would enqueue the thenable job on
    // the inner queue, which is not drained automatically). Wrap the result
    // in an outer-context promise and checkpoint the inner queue — still
    // inside the watchdog scope so `timeout` bounds the microtask drain too.
    auto drainAfterEvaluate = [&] {
        if (scope.exception() || vm.hasTerminationRequest())
            return;
        if (!nodeVmGlobalObject || !nodeVmGlobalObject->hasOwnMicrotaskQueue())
            return;
        nodeVmGlobalObject->drainOwnMicrotasks();
        if (scope.exception() || vm.hasTerminationRequest())
            return;
        if (JSPromise* innerPromise = dynamicDowncast<JSPromise>(result)) {
            // Chaining on the inner-context promise from the caller's realm
            // would enqueue the hookup on the inner queue (not drained
            // automatically), so copy the settled state into a caller-realm
            // promise instead. For a non-TLA module the capability promise is
            // settled by now; a still-pending one (top-level await) is handed
            // out as-is.
            switch (innerPromise->status()) {
            case JSPromise::Status::Fulfilled:
                result = JSPromise::resolvedPromise(callerGlobalObject, innerPromise->settlementValue());
                break;
            case JSPromise::Status::Rejected:
                innerPromise->markAsHandled();
                result = JSPromise::rejectedPromise(callerGlobalObject, innerPromise->settlementValue());
                break;
            case JSPromise::Status::Pending:
                break;
            }
        }
    };

    setSigintReceived(false);

    std::optional<double> oldLimit, newLimit;

    if (timeout != 0) {
        setupWatchdog(vm, timeout, &oldLimit.emplace(), &newLimit.emplace());
    }

    if (breakOnSigint) {
        auto holder = SigintWatcher::hold(nodeVmGlobalObject, this);
        run();
        drainAfterEvaluate();
    } else {
        run();
        drainAfterEvaluate();
    }

    if (timeout != 0) {
        vm.watchdog()->setTimeLimit(WTF::Seconds::fromMilliseconds(*oldLimit));
    }

    // Evaluation (or the afterEvaluate drain) may leave an exception pending
    // — a regular one is rethrown by VM_RETURN_IF_EXCEPTION below, a
    // termination one is converted to ERR_SCRIPT_EXECUTION_* here. Observe it
    // so the exception-check validator is satisfied before the TOP scope.
    std::ignore = scope.exception();
    if (vm.hasTerminationRequest() || vm.hasPendingTerminationException()) {
        vm.drainMicrotasksForGlobalObject(nodeVmGlobalObject);
        DECLARE_TOP_EXCEPTION_SCOPE(vm).clearException();
        vm.clearHasTerminationRequest();
        if (getSigintReceived()) {
            setSigintReceived(false);
            throwError(globalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_INTERRUPTED, "Script execution was interrupted by `SIGINT`"_s);
        } else if (timeout != 0) {
            throwError(globalObject, scope, ErrorCode::ERR_SCRIPT_EXECUTION_TIMEOUT, makeString("Script execution timed out after "_s, timeout, "ms"_s));
        } else {
            RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("vm.SourceTextModule evaluation terminated due neither to SIGINT nor to timeout");
        }
    } else {
        setSigintReceived(false);
    }

    VM_RETURN_IF_EXCEPTION(scope, {});

    if (sourceTextThis) {
        if (JSC::JSModuleRecord* cyclic = sourceTextThis->moduleRecordIfExists()) {
            if (JSValue error = cyclic->evaluationError(); error && !error.isEmpty()) {
                // The spec-style Evaluate() stores the error on the record
                // and rejects the capability promise instead of throwing.
                // Surface it as a synchronous throw (vm.ts maps that to a
                // rejected promise) like the generator-based evaluation did.
                if (auto* promise = dynamicDowncast<JSPromise>(result))
                    promise->markAsHandled();
                status(Status::Errored);
                auto* exception = JSC::Exception::create(vm, error);
                m_evaluationException.set(vm, this, exception);
                scope.throwException(globalObject, exception);
                return {};
            }
            if (cyclic->status() == JSC::CyclicModuleRecord::Status::EvaluatingAsync) {
                // Top-level await: the capability promise settles when the
                // async machinery finishes; the final status is pulled in
                // lazily via reconcileEvaluationState().
                m_evaluationResult.set(vm, this, result);
                return result;
            }
        }
    }

    status(Status::Evaluated);
    m_evaluationResult.set(vm, this, result);
    return result;
#undef VM_RETURN_IF_EXCEPTION
}

NodeVMModule::NodeVMModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier, JSValue context, JSValue moduleWrapper)
    : Base(vm, structure)
    , m_identifier(WTF::move(identifier))
    , m_context(context && context.isObject() ? asObject(context) : nullptr, JSC::WriteBarrierEarlyInit)
    , m_moduleWrapper(moduleWrapper, JSC::WriteBarrierEarlyInit)
{
}

void NodeVMModule::evaluateDependencies(JSGlobalObject* globalObject, AbstractModuleRecord* record, uint32_t timeout, bool breakOnSigint)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    for (const auto& request : record->requestedModules()) {
        if (auto iter = m_resolveCache.find(request.m_specifier.string()); iter != m_resolveCache.end()) {
            auto* dependency = uncheckedDowncast<NodeVMModule>(iter->value.get());
            RELEASE_ASSERT(dependency != nullptr);

            if (dependency->status() == Status::Unlinked) {
                if (auto* syntheticDependency = dynamicDowncast<NodeVMSyntheticModule>(dependency)) {
                    syntheticDependency->link(globalObject, nullptr, nullptr, jsUndefined());
                    RETURN_IF_EXCEPTION(scope, );
                }
            }

            if (dependency->status() == Status::Linked) {
                JSValue dependencyResult = dependency->evaluate(globalObject, timeout, breakOnSigint);
                RETURN_IF_EXCEPTION(scope, );
                // Source text dependencies evaluate via the spec-style
                // Evaluate() and return a capability promise. A still-pending
                // promise means the dependency uses top-level await; the
                // root record's evaluate() drives the async machinery to
                // completion and the wrapper status reconciles lazily
                // (reconcileEvaluationState), so a pending result is fine
                // here.
                UNUSED_PARAM(dependencyResult);
            }
        }
    }
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
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

NodeVMModulePrototype::NodeVMModulePrototype(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void NodeVMModulePrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    reifyStaticProperties(vm, info(), NodeVMModulePrototypeTableValues, *this);
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
        array->putDirectIndex(globalObject, i++, request.toJS(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(array);
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleEvaluate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue timeoutValue = callFrame->argument(0);
    uint32_t timeout = 0;
    if (timeoutValue.isUInt32()) {
        timeout = timeoutValue.asUInt32();
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
        thisObject->setExport(globalObject, nameValue.toWTFString(globalObject), exportValue);
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

// Walks this module and its linked dependencies (m_resolveCache is populated
// during link) checking whether any reachable SourceTextModule uses top-level
// await. Iterative so a deep linear import chain can't overflow the native
// stack.
bool NodeVMModule::hasAsyncGraph() const
{
    WTF::HashSet<const NodeVMModule*> visited;
    WTF::Vector<const NodeVMModule*, 16> worklist;
    worklist.append(this);

    while (!worklist.isEmpty()) {
        const NodeVMModule* module = worklist.takeLast();
        if (!visited.add(module).isNewEntry)
            continue;

        if (auto* sourceTextModule = dynamicDowncast<NodeVMSourceTextModule>(module)) {
            if (sourceTextModule->hasTopLevelAwait())
                return true;
        }

        for (const auto& dependency : module->m_resolveCache.values()) {
            if (auto* dependencyModule = dynamicDowncast<NodeVMModule>(dependency.get()))
                worklist.append(dependencyModule);
        }
    }

    return false;
}

// After record->link() succeeds, every reachable record in the graph is
// linked, but only the root wrapper's status was updated. Mirror the record
// state onto the dependency wrappers (Node's module status reflects the V8
// record status, so dependencies read "linked" after the root instantiates).
void NodeVMModule::propagateLinked()
{
    WTF::HashSet<NodeVMModule*> visited;
    WTF::Vector<NodeVMModule*, 16> worklist;
    worklist.append(this);

    while (!worklist.isEmpty()) {
        NodeVMModule* module = worklist.takeLast();
        if (!visited.add(module).isNewEntry)
            continue;

        if (module->status() == Status::Unlinked)
            module->status(Status::Linked);

        for (const auto& dependency : module->m_resolveCache.values()) {
            if (auto* dependencyModule = dynamicDowncast<NodeVMModule>(dependency.get()))
                worklist.append(dependencyModule);
        }
    }
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
    visitor.append(vmModule->m_evaluationResult);
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
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
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

} // namespace Bun

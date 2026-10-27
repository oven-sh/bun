#include "NodeVMModule.h"
#include "BunClientData.h"
#include "NodeVMSourceTextModule.h"
#include "NodeVMSyntheticModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "JavaScriptCore/CyclicModuleRecord.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSPromise.h"

#include "../vm/NodeVMRunTermination.h"

#include <wtf/Scope.h>

namespace Bun {

static thread_local NodeVMModule::DependencyWalk* s_innermostDependencyWalkOnThisThread = nullptr;

// One evaluate() call of a program with the evaluate() calls of the dependencies below it. It finds the import cycles (Tarjan).
struct NodeVMModule::DependencyWalk {
    WTF_MAKE_NONCOPYABLE(DependencyWalk);

public:
    DependencyWalk()
        : enclosing(std::exchange(s_innermostDependencyWalkOnThisThread, this))
        , firstIndex(enclosing ? enclosing->nextIndex : 1)
        , nextIndex(firstIndex)
    {
    }
    ~DependencyWalk() { s_innermostDependencyWalkOnThisThread = enclosing; }

    // Modules with their dependencies done and no Evaluate() of their own: the Evaluate() of a module entered before them runs them.
    MarkedArgumentBuffer postponed;
    // The walk whose module code called the evaluate() that started this one. Its numbers are all below firstIndex.
    DependencyWalk* const enclosing;
    const uint32_t firstIndex;
    uint32_t nextIndex;
};

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

void NodeVMModule::reconcileEvaluationState(JSC::VM& vm)
{
    // A walk postponed this module and the Evaluate() that runs it has started: the module is Linked until that Evaluate() reaches it.
    bool postponed = m_status == Status::Linked && m_walkLowest;
    if (m_status != Status::Evaluating && !postponed)
        return;

    auto* sourceTextThis = dynamicDowncast<NodeVMSourceTextModule>(this);
    if (!sourceTextThis)
        return;

    // JSModuleRecord is a CyclicModuleRecord; no downcast machinery needed.
    JSC::JSModuleRecord* cyclic = sourceTextThis->moduleRecordIfExists();
    if (!cyclic)
        return;
    if (postponed && cyclic->status() > JSC::CyclicModuleRecord::Status::Linked) {
        status(Status::Evaluating);
        m_walkLowest = 0;
    }
    if (cyclic->status() != JSC::CyclicModuleRecord::Status::Evaluated)
        return;

    if (JSValue error = cyclic->evaluationError(); error && !error.isEmpty()) {
        status(Status::Errored);
        m_evaluationException.set(vm, this, JSC::Exception::create(vm, error));
    } else {
        status(Status::Evaluated);
    }
}

// What JSC's Evaluate() throws for a module that it does not run again: its error, or the error of the import cycle it ran in.
JSC::Exception* NodeVMModule::evaluationFailure(JSC::VM& vm)
{
    reconcileEvaluationState(vm);
    if (m_status == Status::Errored)
        return m_evaluationException.get();
    auto* sourceTextThis = dynamicDowncast<NodeVMSourceTextModule>(this);
    if (m_status != Status::Evaluated || !sourceTextThis)
        return nullptr;
    JSC::JSModuleRecord* cyclic = sourceTextThis->moduleRecordIfExists();
    JSC::CyclicModuleRecord* cycleRoot = cyclic ? cyclic->cycleRoot() : nullptr;
    JSValue error = cycleRoot ? cycleRoot->evaluationError() : JSValue();
    return error ? JSC::Exception::create(vm, error) : nullptr;
}

JSValue NodeVMModule::evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint, DependencyWalk* walk)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    std::optional<Seconds> timeoutSeconds = timeout ? std::optional { Seconds::fromMilliseconds(timeout) } : std::nullopt;

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
            {
                NodeVMRunTermination termination(nodeVmGlobalObject, timeoutSeconds, breakOnSigint);
                nodeVmGlobalObject->drainOwnMicrotasks();
                termination.finish(scope);
            }
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (JSC::Exception* failure = evaluationFailure(vm)) {
            scope.throwException(globalObject, failure);
            return {};
        }
        // A module that ran in the Evaluate() of another module has no result of its own.
        JSValue evaluationResult = m_evaluationResult.get();
        return evaluationResult ? evaluationResult : jsUndefined();
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

// A termination that unwound the evaluation is not the module's error (an enclosing vm run's timeout, or the
// VM being stopped): leave the status to reconcileEvaluationState() and let it propagate.
#define VM_RETURN_IF_EXCEPTION(scope__, value__)                \
    do {                                                        \
        if (JSC::Exception* exception = scope__.exception()) {  \
            if (!vm.isTerminationException(exception)) {        \
                status(Status::Errored);                        \
                m_evaluationException.set(vm, this, exception); \
            }                                                   \
            return value__;                                     \
        }                                                       \
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

    bool isDependency = walk;
    std::optional<DependencyWalk> ownWalk;
    uint32_t index = 0;
    size_t postponedBefore = 0;
    bool postponed = false;
    if (sourceTextThis) {
        if (!walk)
            walk = &ownWalk.emplace();
        index = walk->nextIndex++;
        postponedBefore = walk->postponed.size();
        m_walkLowest = index;
    } else
        walk = nullptr;
    // The modules postponed during this call waited for the Evaluate() of this module, unless it is postponed too.
    auto leaveWalk = makeScopeExit([&] {
        if (!walk || postponed)
            return;
        m_walkLowest = 0;
        JSC::Exception* runError = scope.exception();
        if (runError && vm.isTerminationException(runError))
            runError = nullptr;
        while (walk->postponed.size() > postponedBefore) {
            auto* module = uncheckedDowncast<NodeVMModule>(walk->postponed.takeLast());
            // The walk ended before that Evaluate() started: nothing ran, and a later evaluate() walks the dependencies again.
            if (module->m_status == Status::Evaluating && module->m_walkLowest) {
                module->m_status = Status::Linked;
                module->m_walkLowest = 0;
                continue;
            }
            module->reconcileEvaluationState(vm);
            // JSC gave its termination value to a module that the timeout or SIGINT of this run stopped: the error of the run replaces it.
            JSC::Exception* moduleError = module->m_evaluationException.get();
            if (runError && moduleError && moduleError->value() == vm.ensureTerminationException()->value())
                module->m_evaluationException.set(vm, module, runError);
            // That Evaluate() did not reach it (it failed first, or the import is an `import defer`): it waits for no cycle now.
            if (module->m_walkLowest)
                module->m_walkLowest = std::numeric_limits<uint32_t>::max();
        }
    });

    auto run = [&] {
        if (sourceTextThis) {
            status(Status::Evaluating);
            uint32_t lowest = index;
            evaluateDependencies(globalObject, record, timeout, breakOnSigint, *walk, lowest);
            RETURN_IF_EXCEPTION(scope, );
            sourceTextThis->initializeImportMeta(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            // In an import cycle with a module that the walk entered before, or entered while such a cycle is open: postponed.
            if (lowest < index || postponedBefore) {
                postponed = true;
                m_walkLowest = lowest < index ? lowest : std::numeric_limits<uint32_t>::max();
                walk->postponed.appendWithCrashOnOverflow(this);
                return;
            }
            // The Evaluate() below runs each module postponed during this call when the walk of JSC reaches it: Linked until then.
            for (size_t i = postponedBefore; i < walk->postponed.size(); ++i)
                uncheckedDowncast<NodeVMModule>(walk->postponed.at(i))->m_status = Status::Linked;
            JSC::JSModuleRecord* ownRecord = sourceTextThis->moduleRecordIfExists();
            bool startsEvaluate = ownRecord && ownRecord->status() == JSC::CyclicModuleRecord::Status::Linked;
            // Spec-style Evaluate(): returns the capability promise that
            // settles when (possibly async, for top-level await) evaluation
            // finishes. Errors are stored on the record, not thrown.
            result = record->evaluate(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            // The promise of an Evaluate() that this call started for an importer needs no handler: the importer's Evaluate() gets its error.
            if (auto* promise = isDependency && startsEvaluate ? dynamicDowncast<JSPromise>(result) : nullptr)
                promise->markAsHandled();
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
    // inside the timeout scope so `timeout` bounds the microtask drain too.
    auto drainAfterEvaluate = [&] {
        if (postponed || scope.exception() || vm.hasTerminationRequest())
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
                RETURN_IF_EXCEPTION(scope, );
                break;
            case JSPromise::Status::Rejected:
                innerPromise->markAsHandled();
                result = JSPromise::rejectedPromise(callerGlobalObject, innerPromise->settlementValue());
                RETURN_IF_EXCEPTION(scope, );
                break;
            case JSPromise::Status::Pending:
                break;
            }
        }
    };

    {
        // SIGINT interrupts the realm being evaluated (the context's, else the caller's).
        NodeVMRunTermination termination(globalObject, timeoutSeconds, breakOnSigint);
        run();
        drainAfterEvaluate();
        // This run's own termination becomes ERR_SCRIPT_EXECUTION_* here; that error, like a regular one,
        // marks the module errored and is rethrown by VM_RETURN_IF_EXCEPTION below.
        termination.finish(scope);
        // Unwound by the timeout / SIGINT of a module this one is a dependency of (evaluateDependencies runs
        // each in its own scope): that termination keeps propagating to it, but this module's evaluation is
        // over too — errored with the same kind of error, rather than left "evaluating" for good.
        if (JSObject* error = termination.errorForEnclosingRunCutShort()) {
            status(Status::Errored);
            m_evaluationException.set(vm, this, JSC::Exception::create(vm, error));
            return {};
        }
    }

    VM_RETURN_IF_EXCEPTION(scope, {});

    if (postponed)
        return jsUndefined();

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

void NodeVMModule::evaluateDependencies(JSGlobalObject* globalObject, AbstractModuleRecord* record, uint32_t timeout, bool breakOnSigint, DependencyWalk& walk, uint32_t& lowest)
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

            // A walk entered it and no Evaluate() has started its body. If this walk did, the two modules are in one import cycle.
            if (uint32_t reached = dependency->m_walkLowest) {
                if (reached >= walk.firstIndex)
                    lowest = std::min(lowest, reached);
                continue;
            }

            if (dependency->status() == Status::Linked) {
                dependency->evaluate(globalObject, timeout, breakOnSigint, &walk);
                RETURN_IF_EXCEPTION(scope, );
                // Source text dependencies evaluate via the spec-style
                // Evaluate() and return a capability promise. A still-pending
                // promise means the dependency uses top-level await; the
                // root record's evaluate() drives the async machinery to
                // completion and the wrapper status reconciles lazily
                // (reconcileEvaluationState), so a pending result is fine
                // here.
                if (uint32_t reached = dependency->m_walkLowest)
                    lowest = std::min(lowest, reached);
            } else if (dynamicDowncast<NodeVMSourceTextModule>(dependency)) {
                // The walk of JSC stops at a dependency that failed. This one stops there too, before it evaluates a later dependency.
                if (JSC::Exception* failure = dependency->evaluationFailure(vm)) {
                    scope.throwException(globalObject, failure);
                    return;
                }
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

        // An importer that got its modules before replaceUnlinkedRecords() links the replaced records, not this one.
        if (auto* sourceTextModule = dynamicDowncast<NodeVMSourceTextModule>(module)) {
            JSC::JSModuleRecord* record = sourceTextModule->moduleRecordIfExists();
            if (!record || record->status() < JSC::CyclicModuleRecord::Status::Linked)
                continue;
        }

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

JSC::JSModuleLoader* NodeVMModule::moduleLoader(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    NodeVMGlobalObject* contextGlobalObject = NodeVM::getGlobalObjectFromContext(globalObject, m_context.get(), false);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return (contextGlobalObject ? contextGlobalObject : globalObject)->moduleLoader();
}

} // namespace Bun

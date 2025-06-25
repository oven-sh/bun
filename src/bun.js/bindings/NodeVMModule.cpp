#include "NodeVMModule.h"
#include "NodeVMSourceTextModule.h"
#include "NodeVMSyntheticModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/Watchdog.h"

#include "../vm/SigintWatcher.h"

namespace Bun {

NodeVMModuleRequest::NodeVMModuleRequest(WTF::String specifier, WTF::HashMap<WTF::String, WTF::String> importAttributes)
    : m_specifier(WTFMove(specifier))
    , m_importAttributes(WTFMove(importAttributes))
{
}

void NodeVMModuleRequest::addImportAttribute(WTF::String key, WTF::String value)
{
    m_importAttributes.set(WTFMove(key), WTFMove(value));
}

JSArray* NodeVMModuleRequest::toJS(JSGlobalObject* globalObject) const
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSArray* array = JSC::constructEmptyArray(globalObject, nullptr, 2);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 0, JSC::jsString(globalObject->vm(), m_specifier));

    JSObject* attributes = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    for (const auto& [key, value] : m_importAttributes) {
        attributes->putDirect(globalObject->vm(), JSC::Identifier::fromString(globalObject->vm(), key), JSC::jsString(globalObject->vm(), value),
            PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete);
    }
    array->putDirectIndex(globalObject, 1, attributes);

    return array;
}

void setupWatchdog(VM& vm, double timeout, double* oldTimeout, double* newTimeout);

JSValue NodeVMModule::evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_status != Status::Linked && m_status != Status::Evaluated && m_status != Status::Errored) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module must be linked, evaluated or errored before evaluating"_s);
        return {};
    }

    if (m_status == Status::Evaluated) {
        return m_evaluationResult.get();
    }

    auto* sourceTextThis = jsDynamicCast<NodeVMSourceTextModule*>(this);
    auto* syntheticThis = jsDynamicCast<NodeVMSyntheticModule*>(this);

    AbstractModuleRecord* record {};
    if (sourceTextThis) {
        record = sourceTextThis->moduleRecord(globalObject);
    } else if (syntheticThis) {
        record = syntheticThis->moduleRecord(globalObject);
    } else {
        RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("Invalid module type");
    }

    JSValue result {};

    NodeVMGlobalObject* nodeVmGlobalObject = NodeVM::getGlobalObjectFromContext(globalObject, m_context.get(), false);

    if (nodeVmGlobalObject) {
        globalObject = nodeVmGlobalObject;
    }

    auto run = [&] {
        if (sourceTextThis) {
            status(Status::Evaluating);
            evaluateDependencies(globalObject, record, timeout, breakOnSigint);
            sourceTextThis->initializeImportMeta(globalObject);
        } else if (syntheticThis) {
            syntheticThis->evaluate(globalObject);
        }
        if (scope.exception()) {
            return;
        }
        result = record->evaluate(globalObject, jsUndefined(), jsNumber(static_cast<int32_t>(JSGenerator::ResumeMode::NormalMode)));
    };

    setSigintReceived(false);

    std::optional<double> oldLimit, newLimit;

    if (timeout != 0) {
        setupWatchdog(vm, timeout, &oldLimit.emplace(), &newLimit.emplace());
    }

    if (breakOnSigint) {
        auto holder = SigintWatcher::hold(nodeVmGlobalObject, this);
        run();
    } else {
        run();
    }

    if (timeout != 0) {
        vm.watchdog()->setTimeLimit(WTF::Seconds::fromMilliseconds(*oldLimit));
    }

    if (vm.hasPendingTerminationException()) {
        scope.clearException();
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

    if (JSC::Exception* exception = scope.exception()) {
        status(Status::Errored);
        if (sourceTextThis) {
            sourceTextThis->m_evaluationException.set(vm, this, exception);
        }
        return {};
    }

    status(Status::Evaluated);
    m_evaluationResult.set(vm, this, result);
    return result;
}

NodeVMModule::NodeVMModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier, JSValue context, JSValue moduleWrapper)
    : Base(vm, structure)
    , m_identifier(WTFMove(identifier))
    , m_moduleWrapper(vm, this, moduleWrapper)
{
    if (context.isObject()) {
        m_context.set(vm, this, asObject(context));
    }
}

void NodeVMModule::evaluateDependencies(JSGlobalObject* globalObject, AbstractModuleRecord* record, uint32_t timeout, bool breakOnSigint)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    for (const auto& request : record->requestedModules()) {
        if (auto iter = m_resolveCache.find(WTF::String(*request.m_specifier)); iter != m_resolveCache.end()) {
            auto* dependency = jsCast<NodeVMModule*>(iter->value.get());
            RELEASE_ASSERT(dependency != nullptr);

            if (dependency->status() == Status::Unlinked) {
                if (auto* syntheticDependency = jsDynamicCast<NodeVMSyntheticModule*>(dependency)) {
                    syntheticDependency->link(globalObject, nullptr, nullptr, jsUndefined());
                    RETURN_IF_EXCEPTION(scope, );
                }
            }

            if (dependency->status() == Status::Linked) {
                JSValue dependencyResult = dependency->evaluate(globalObject, timeout, breakOnSigint);
                RETURN_IF_EXCEPTION(scope, );
                RELEASE_ASSERT_WITH_MESSAGE(jsDynamicCast<JSC::JSPromise*>(dependencyResult) == nullptr, "TODO(@heimskr): implement async support for node:vm module dependencies");
            }
        }
    }
}

JSValue NodeVMModule::createModuleRecord(JSC::JSGlobalObject* globalObject)
{
    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(this)) {
        return thisObject->createModuleRecord(globalObject);
    } else if (auto* thisObject = jsDynamicCast<NodeVMSyntheticModule*>(this)) {
        thisObject->createModuleRecord(globalObject);
        return jsUndefined();
    }

    RELEASE_ASSERT_NOT_REACHED();
    return jsUndefined();
}

AbstractModuleRecord* NodeVMModule::moduleRecord(JSC::JSGlobalObject* globalObject)
{
    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(this)) {
        return thisObject->moduleRecord(globalObject);
    } else if (auto* thisObject = jsDynamicCast<NodeVMSyntheticModule*>(this)) {
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
        return NodeVMSourceTextModule::create(vm, globalObject, args);
    }

    if (disambiguator.inherits(JSArray::info())) {
        return NodeVMSyntheticModule::create(vm, globalObject, args);
    }

    throwArgumentTypeError(*globalObject, scope, 2, "sourceText or syntheticExportNames"_s, "Module"_s, "Module"_s, "string or array"_s);
    return nullptr;
}

JSModuleNamespaceObject* NodeVMModule::namespaceObject(JSC::JSGlobalObject* globalObject)
{
    JSModuleNamespaceObject* object = m_namespaceObject.get();
    if (object) {
        return object;
    }

    if (auto* thisObject = jsDynamicCast<NodeVMModule*>(this)) {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        object = thisObject->moduleRecord(globalObject)->getModuleNamespace(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (object) {
            namespaceObject(vm, object);
        }
    } else {
        RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("NodeVMModule::namespaceObject called on an unsupported module type (%s)", classInfo()->className.characters());
    }

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
    auto* thisObject = jsCast<NodeVMModule*>(JSC::JSValue::decode(thisValue));
    return JSValue::encode(JSC::jsString(globalObject->vm(), thisObject->identifier()));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetStatusCode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = jsCast<NodeVMModule*>(callFrame->thisValue());
    return JSValue::encode(JSC::jsNumber(static_cast<uint32_t>(thisObject->status())));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetStatus, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = jsCast<NodeVMModule*>(callFrame->thisValue());

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

    if (auto* thisObject = jsDynamicCast<NodeVMModule*>(callFrame->thisValue())) {
        return JSValue::encode(thisObject->namespaceObject(globalObject));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetError, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = jsCast<NodeVMSourceTextModule*>(callFrame->thisValue())) {
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

    auto* thisObject = jsCast<NodeVMModule*>(callFrame->thisValue());

    if (auto* sourceTextModule = jsDynamicCast<NodeVMSourceTextModule*>(callFrame->thisValue())) {
        sourceTextModule->ensureModuleRecord(globalObject);
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

    if (auto* thisObject = jsDynamicCast<NodeVMModule*>(callFrame->thisValue())) {
        return JSValue::encode(thisObject->evaluate(globalObject, timeout, breakOnSigint));
    } else {
        throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
        return {};
    }
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleLink, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSArray* specifiers = jsDynamicCast<JSArray*>(callFrame->argument(0));
    JSArray* moduleNatives = jsDynamicCast<JSArray*>(callFrame->argument(1));

    if (!specifiers) {
        return throwArgumentTypeError(*globalObject, scope, 0, "specifiers"_s, "Module"_s, "Module"_s, "Array"_s);
    }

    if (!moduleNatives) {
        return throwArgumentTypeError(*globalObject, scope, 1, "moduleNatives"_s, "Module"_s, "Module"_s, "Array"_s);
    }

    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(callFrame->thisValue())) {
        return JSValue::encode(thisObject->link(globalObject, specifiers, moduleNatives, callFrame->argument(2)));
        // return thisObject->link(globalObject, linker);
        // } else if (auto* thisObject = jsDynamicCast<NodeVMSyntheticModule*>(callFrame->thisValue())) {
        //     return thisObject->link(globalObject, specifiers, moduleNatives);
    } else {
        throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
        return {};
    }
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleInstantiate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(callFrame->thisValue())) {
        return JSValue::encode(thisObject->instantiate(globalObject));
    }

    if (auto* thisObject = jsDynamicCast<NodeVMSyntheticModule*>(callFrame->thisValue())) {
        return JSValue::encode(thisObject->instantiate(globalObject));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule or SyntheticModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleSetExport, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* thisObject = jsCast<NodeVMSyntheticModule*>(callFrame->thisValue())) {
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

    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(callFrame->thisValue())) {
        return JSValue::encode(thisObject->cachedData(globalObject));
    }

    throwTypeError(globalObject, scope, "This function must be called on a SourceTextModule"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleCreateModuleRecord, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = jsCast<NodeVMModule*>(callFrame->thisValue());
    return JSValue::encode(thisObject->createModuleRecord(globalObject));
}

template<typename Visitor>
void NodeVMModule::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* vmModule = jsCast<NodeVMModule*>(cell);
    ASSERT_GC_OBJECT_INHERITS(vmModule, info());
    Base::visitChildren(vmModule, visitor);

    visitor.append(vmModule->m_namespaceObject);
    visitor.append(vmModule->m_context);
    visitor.append(vmModule->m_evaluationResult);
    visitor.append(vmModule->m_moduleWrapper);

    auto moduleNatives = vmModule->m_resolveCache.values();
    visitor.append(moduleNatives.begin(), moduleNatives.end());
}

DEFINE_VISIT_CHILDREN(NodeVMModule);

static EncodedJSValue
constructModule(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget = {})
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ArgList args(callFrame);

    NodeVMModule* module = NodeVMModule::create(vm, globalObject, args);

    return JSValue::encode(module);
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

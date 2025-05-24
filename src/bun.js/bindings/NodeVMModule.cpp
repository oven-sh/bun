#include "NodeVMModule.h"
#include "NodeVMSourceTextModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"

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
    JSArray* array = JSC::constructEmptyArray(globalObject, nullptr, 2);
    array->putDirectIndex(globalObject, 0, JSC::jsString(globalObject->vm(), m_specifier));

    JSObject* attributes = JSC::constructEmptyObject(globalObject);
    for (const auto& [key, value] : m_importAttributes) {
        attributes->putDirect(globalObject->vm(), JSC::Identifier::fromString(globalObject->vm(), key), JSC::jsString(globalObject->vm(), value),
            PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete);
    }
    array->putDirectIndex(globalObject, 1, attributes);

    return array;
}

NodeVMModule::NodeVMModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier, JSValue context)
    : Base(vm, structure)
    , m_identifier(WTFMove(identifier))
{
    if (context.isObject()) {
        m_context.set(vm, this, asObject(context));
    }
}

bool NodeVMModule::finishInstantiate(JSC::JSGlobalObject* globalObject, WTF::Deque<NodeVMSourceTextModule*>& stack, unsigned* dfsIndex)
{
    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(this)) {
        return thisObject->finishInstantiate(globalObject, stack, dfsIndex);
        // } else if (auto* thisObject = jsDynamicCast<NodeVMSyntheticModule*>(this)) {
        // return thisObject->finishInstantiate(globalObject);
    }

    return true;
}

JSValue NodeVMModule::createModuleRecord(JSC::JSGlobalObject* globalObject)
{
    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(this)) {
        return thisObject->createModuleRecord(globalObject);
    }

    ASSERT_NOT_REACHED();
    return JSC::jsUndefined();
}

AbstractModuleRecord* NodeVMModule::moduleRecord(JSC::JSGlobalObject* globalObject)
{
    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(this)) {
        return thisObject->moduleRecord(globalObject);
    }

    ASSERT_NOT_REACHED();
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
        // return NodeVMSyntheticModule::create(vm, globalObject, args);
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

    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(this)) {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        object = thisObject->moduleRecord(globalObject)->getModuleNamespace(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (object) {
            namespaceObject(vm, object);
        }
    } else {
        RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("NodeVMModule::namespaceObject called on an unsupported module type (%s)", info()->className.characters());
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
    auto* thisObject = jsCast<NodeVMSourceTextModule*>(JSC::JSValue::decode(thisValue));
    return JSValue::encode(JSC::jsString(globalObject->vm(), thisObject->identifier()));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetStatusCode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = jsCast<NodeVMSourceTextModule*>(callFrame->thisValue());
    return JSValue::encode(JSC::jsNumber(static_cast<uint32_t>(thisObject->status())));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleGetStatus, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = jsCast<NodeVMSourceTextModule*>(callFrame->thisValue());

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
    auto* thisObject = jsCast<NodeVMSourceTextModule*>(callFrame->thisValue());
    return JSValue::encode(thisObject->namespaceObject(globalObject));
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
    auto* thisObject = jsCast<NodeVMModule*>(callFrame->thisValue());

    if (auto* sourceTextModule = jsDynamicCast<NodeVMSourceTextModule*>(callFrame->thisValue())) {
        sourceTextModule->ensureModuleRecord(globalObject);
    }

    const WTF::Vector<NodeVMModuleRequest>& requests = thisObject->moduleRequests();

    JSArray* array = constructEmptyArray(globalObject, nullptr, requests.size());

    for (unsigned i = 0; const NodeVMModuleRequest& request : requests) {
        array->putDirectIndex(globalObject, i++, request.toJS(globalObject));
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

    if (auto* thisObject = jsDynamicCast<NodeVMSourceTextModule*>(callFrame->thisValue())) {
        return JSValue::encode(thisObject->evaluate(globalObject, timeout, breakOnSigint));
        // } else if (auto* thisObject = jsDynamicCast<NodeVMSyntheticModule*>(callFrame->thisValue())) {
        //     return thisObject->link(globalObject, specifiers, moduleNatives);
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
    // auto* thisObject = jsCast<NodeVMSourceTextModule*>(callFrame->thisValue());
    return JSC::encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVmModuleSetExport, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // auto* thisObject = jsCast<NodeVMSourceTextModule*>(callFrame->thisValue());
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

const JSC::ClassInfo NodeVMModule::s_info = { "NodeVMSourceTextModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMSourceTextModule) };
const JSC::ClassInfo NodeVMModulePrototype::s_info = { "NodeVMSourceTextModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMModulePrototype) };
const JSC::ClassInfo NodeVMModuleConstructor::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMModuleConstructor) };

} // namespace Bun

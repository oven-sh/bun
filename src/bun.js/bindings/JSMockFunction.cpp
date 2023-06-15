#include "root.h"

#include "JSMockFunction.h"
#include <JavaScriptCore/JSPromise.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/InternalFunction.h>
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "BunClientData.h"
#include "JavaScriptCore/LazyProperty.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/LazyPropertyInlines.h"
#include "JavaScriptCore/VMTrapsInlines.h"
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/WeakMapImpl.h>
#include <JavaScriptCore/WeakMapImplInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsMockFunctionCall);
JSC_DECLARE_CUSTOM_GETTER(jsMockFunctionGetter_protoImpl);
JSC_DECLARE_CUSTOM_GETTER(jsMockFunctionGetter_mock);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionGetMockImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionGetMockName);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockClear);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReset);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockRestore);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockImplementationOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockName);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReturnThis);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReturnValue);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReturnValueOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockResolvedValue);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockResolvedValueOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockRejectedValue);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockRejectedValueOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionWithImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockImplementationOnce);

// This is taken from JSWeakSet
// We only want to hold onto the list of active spies which haven't already been collected
// So we use a WeakSet
// Unlike using WeakSet from JS, we are able to iterate through the WeakSet.
class ActiveSpySet final : public WeakMapImpl<WeakMapBucket<WeakMapBucketDataKey>> {
public:
    using Base = WeakMapImpl<WeakMapBucket<WeakMapBucketDataKey>>;

    DECLARE_EXPORT_INFO;

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(JSWeakSetType, StructureFlags), info());
    }

    static ActiveSpySet* create(VM& vm, Structure* structure)
    {
        ActiveSpySet* instance = new (NotNull, allocateCell<ActiveSpySet>(vm)) ActiveSpySet(vm, structure);
        instance->finishCreation(vm);
        return instance;
    }

private:
    ActiveSpySet(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};

static_assert(std::is_final<ActiveSpySet>::value, "Required for JSType based casting");
const ClassInfo ActiveSpySet::s_info = { "ActiveSpySet"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ActiveSpySet) };

class JSMockImplementation final : public JSNonFinalObject {
public:
    enum class Kind : uint8_t {
        Call,
        Promise,
        ReturnValue,
        ThrowValue,
        ReturnThis,
    };

    static JSMockImplementation* create(JSC::JSGlobalObject* globalObject, JSC::Structure* structure, Kind kind, JSC::JSValue heldValue, bool isOnce)
    {
        auto& vm = globalObject->vm();
        JSMockImplementation* impl = new (NotNull, allocateCell<JSMockImplementation>(vm)) JSMockImplementation(vm, structure, kind);
        impl->finishCreation(vm, heldValue, isOnce ? jsNumber(1) : jsUndefined());
        return impl;
    }

    using Base = JSC::JSNonFinalObject;
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(JSC::ObjectType, StructureFlags), info());
    }
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSMockImplementation, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSMockImplementation.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSMockImplementation = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSMockImplementation.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSMockImplementation = std::forward<decltype(space)>(space); });
    }

    static constexpr unsigned numberOfInternalFields = 2;

    mutable JSC::WriteBarrier<Unknown> internalFields[2];

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    Kind kind { Kind::ReturnValue };

    bool isOnce()
    {
        auto secondField = internalFields[1].get();
        if (secondField.isNumber() && secondField.asInt32() == 1) {
            return true;
        }
        return jsDynamicCast<JSMockImplementation*>(secondField.asCell());
    }

    JSMockImplementation(JSC::VM& vm, JSC::Structure* structure, Kind kind)
        : Base(vm, structure)
        , kind(kind)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSValue first, JSC::JSValue second)
    {
        Base::finishCreation(vm);
        this->internalFields[0].set(vm, this, first);
        this->internalFields[1].set(vm, this, second);
    }
};

template<typename Visitor>
void JSMockImplementation::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSMockImplementation* fn = jsCast<JSMockImplementation*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->internalFields[0]);
    visitor.append(fn->internalFields[1]);
}

DEFINE_VISIT_CHILDREN(JSMockImplementation);

enum class CallbackKind : uint8_t {
    Wrapper,
    Call,
    GetterSetter,
};

static NativeFunction jsMockFunctionForCallbackKind(CallbackKind kind)
{
    switch (kind) {
        // return jsMockFunctionGetterSetter;
    case CallbackKind::Wrapper:
        return jsMockFunctionMockImplementation;
    case CallbackKind::GetterSetter:
    case CallbackKind::Call:
        return jsMockFunctionCall;
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

const ClassInfo JSMockImplementation::s_info = { "MockImpl"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMockImplementation) };

class JSMockFunction : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSMockFunction* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, CallbackKind kind = CallbackKind::Call)
    {
        JSMockFunction* function = new (NotNull, JSC::allocateCell<JSMockFunction>(vm)) JSMockFunction(vm, structure, kind);
        function->finishCreation(vm);
        return function;
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::LazyProperty<JSMockFunction, JSObject> mock;
    mutable JSC::WriteBarrier<JSC::Unknown> implementation;
    mutable JSC::WriteBarrier<JSC::JSArray> calls;
    mutable JSC::WriteBarrier<JSC::JSArray> contexts;
    mutable JSC::WriteBarrier<JSC::JSArray> instances;
    mutable JSC::WriteBarrier<JSC::JSArray> returnValues;
    mutable JSC::WriteBarrier<JSC::Unknown> tail;

    JSC::Weak<JSObject> spyTarget;
    JSC::Identifier spyIdentifier;
    unsigned spyAttributes = 0;

    void setName(const WTF::String& name)
    {
        auto& vm = this->vm();
        this->putDirect(vm, vm.propertyNames->name, jsString(vm, name), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
    }

    void initMock()
    {
        mock.initLater(
            [](const JSC::LazyProperty<JSMockFunction, JSObject>::Initializer& init) {
                JSMockFunction* mock = init.owner;
                Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(mock->globalObject());
                JSC::Structure* structure = globalObject->mockModule.mockObjectStructure.getInitializedOnMainThread(globalObject);
                JSObject* object = JSC::constructEmptyObject(init.vm, structure);
                object->putDirectOffset(init.vm, 0, mock->getCalls());
                object->putDirectOffset(init.vm, 1, mock->getContexts());
                object->putDirectOffset(init.vm, 2, mock->getInstances());
                object->putDirectOffset(init.vm, 3, mock->getReturnValues());
                init.set(object);
            });
    }

    void reset()
    {
        this->calls.clear();
        this->instances.clear();
        this->returnValues.clear();
        this->contexts.clear();

        if (this->mock.isInitialized()) {
            this->initMock();
        }
    }

    void clearSpy()
    {
        if (auto* target = this->spyTarget.get()) {
            JSValue implValue = jsUndefined();
            if (auto* impl = jsDynamicCast<JSMockImplementation*>(this->implementation.get())) {
                implValue = impl->internalFields[0].get();
            }

            // Reset the spy back to the original value.
            target->putDirect(this->vm(), this->spyIdentifier, implValue, this->spyAttributes);
        }

        this->spyTarget.clear();
        this->spyIdentifier = JSC::Identifier();
        this->spyAttributes = 0;
    }

    JSArray* getCalls() const
    {
        JSArray* val = calls.get();
        if (!val) {
            val = JSC::constructEmptyArray(globalObject(), nullptr, 0);
            this->calls.set(vm(), this, val);
        }
        return val;
    }
    JSArray* getContexts() const
    {
        JSArray* val = contexts.get();
        if (!val) {
            val = JSC::constructEmptyArray(globalObject(), nullptr, 0);
            this->contexts.set(vm(), this, val);
        }
        return val;
    }
    JSArray* getInstances() const
    {
        JSArray* val = instances.get();
        if (!val) {
            val = JSC::constructEmptyArray(globalObject(), nullptr, 0);
            this->instances.set(vm(), this, val);
        }
        return val;
    }
    JSArray* getReturnValues() const
    {
        JSArray* val = returnValues.get();
        if (!val) {
            val = JSC::constructEmptyArray(globalObject(), nullptr, 0);
            this->returnValues.set(vm(), this, val);
        }
        return val;
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSMockFunction, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSMockFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSMockFunction = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSMockFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSMockFunction = std::forward<decltype(space)>(space); });
    }

    JSMockFunction(JSC::VM& vm, JSC::Structure* structure, CallbackKind wrapKind)
        : Base(vm, structure, jsMockFunctionForCallbackKind(wrapKind), jsMockFunctionForCallbackKind(wrapKind))
    {
        initMock();
    }
};

template<typename Visitor>
void JSMockFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSMockFunction* fn = jsCast<JSMockFunction*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->implementation);
    visitor.append(fn->calls);
    visitor.append(fn->contexts);
    visitor.append(fn->instances);
    visitor.append(fn->returnValues);
    visitor.append(fn->tail);
    fn->mock.visit(visitor);
}
DEFINE_VISIT_CHILDREN(JSMockFunction);

static void pushImplInternal(JSMockFunction* fn, JSGlobalObject* jsGlobalObject, JSMockImplementation::Kind kind, JSValue value, bool isOnce)
{
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(jsGlobalObject);
    auto& vm = globalObject->vm();
    JSMockImplementation* impl = JSMockImplementation::create(globalObject, globalObject->mockModule.mockImplementationStructure.getInitializedOnMainThread(globalObject), kind, value, isOnce);
    JSValue currentTail = fn->tail.get();
    JSValue currentImpl = fn->implementation.get();
    if (currentTail) {
        if (auto* current = jsDynamicCast<JSMockImplementation*>(currentTail)) {
            current->internalFields[1].set(vm, current, impl);
        }
    }
    fn->tail.set(vm, fn, impl);
    if (!currentImpl || !currentImpl.inherits<JSMockImplementation>()) {
        fn->implementation.set(vm, fn, impl);
    }
}

static void pushImpl(JSMockFunction* fn, JSGlobalObject* globalObject, JSMockImplementation::Kind kind, JSValue value)
{
    pushImplInternal(fn, globalObject, kind, value, false);
}

static void pushImplOnce(JSMockFunction* fn, JSGlobalObject* globalObject, JSMockImplementation::Kind kind, JSValue value)
{
    pushImplInternal(fn, globalObject, kind, value, true);
}

class JSMockFunctionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSMockFunctionPrototype* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSMockFunctionPrototype* ptr = new (NotNull, JSC::allocateCell<JSMockFunctionPrototype>(vm)) JSMockFunctionPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSMockFunctionPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

static const HashTableValue JSMockFunctionPrototypeTableValues[] = {
    { "mock"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsMockFunctionGetter_mock, 0 } },
    { "_protoImpl"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsMockFunctionGetter_protoImpl, 0 } },
    { "getMockImplementation"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionGetMockImplementation, 0 } },
    { "getMockName"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionGetMockName, 0 } },
    { "mockClear"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockClear, 0 } },
    { "mockReset"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockReset, 0 } },
    { "mockRestore"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockRestore, 0 } },
    { "mockImplementation"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockImplementation, 1 } },
    { "mockImplementationOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockImplementationOnce, 1 } },
    { "withImplementation"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionWithImplementation, 1 } },
    { "mockName"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockName, 1 } },
    { "mockReturnThis"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockReturnThis, 1 } },
    { "mockReturnValue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockReturnValue, 1 } },
    { "mockReturnValueOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockReturnValueOnce, 1 } },
    { "mockResolvedValue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockResolvedValue, 1 } },
    { "mockResolvedValueOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockResolvedValueOnce, 1 } },
    { "mockRejectedValueOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockRejectedValue, 1 } },
    { "mockRejectedValue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockRejectedValueOnce, 1 } },
};

const ClassInfo JSMockFunction::s_info = { "Mock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMockFunction) };

class SpyWeakHandleOwner final : public JSC::WeakHandleOwner {
public:
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final {}
};

static SpyWeakHandleOwner& weakValueHandleOwner()
{
    static NeverDestroyed<SpyWeakHandleOwner> jscWeakValueHandleOwner;
    return jscWeakValueHandleOwner;
}

const ClassInfo JSMockFunctionPrototype::s_info = { "Mock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMockFunctionPrototype) };

extern "C" void JSMock__resetSpies(Zig::GlobalObject* globalObject)
{
    if (!globalObject->mockModule.activeSpies) {
        return;
    }
    auto spiesValue = globalObject->mockModule.activeSpies.get();

    ActiveSpySet* activeSpies = jsCast<ActiveSpySet*>(spiesValue);
    MarkedArgumentBuffer active;
    activeSpies->takeSnapshot(active);
    size_t size = active.size();

    for (size_t i = 0; i < size; ++i) {
        JSValue spy = active.at(i);
        if (!spy.isObject())
            continue;

        auto* spyObject = jsCast<JSMockFunction*>(spy);
        spyObject->reset();
        spyObject->clearSpy();
    }
    globalObject->mockModule.activeSpies.clear();
}

extern "C" EncodedJSValue jsFunctionResetSpies(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
{
    JSMock__resetSpies(jsCast<Zig::GlobalObject*>(globalObject));
    return JSValue::encode(jsUndefined());
}

extern "C" EncodedJSValue JSMock__spyOn(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);
    if (UNLIKELY(!globalObject)) {
        throwVMError(globalObject, scope, "Cannot run spyOn from a different global context"_s);
        return {};
    }

    JSValue objectValue = callframe->argument(0);
    JSValue propertyKeyValue = callframe->argument(1);

    if (callframe->argumentCount() < 2 || !objectValue.isObject()) {
        throwVMError(globalObject, scope, "spyOn(target, prop) expects a target object and a property key"_s);
        return {};
    }

    PropertyName propertyKey = propertyKeyValue.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (propertyKey.isNull()) {
        throwVMError(globalObject, scope, "spyOn(target, prop) expects a property key"_s);
        return {};
    }

    JSC::JSObject* object = objectValue.getObject();
    if (object->type() == JSC::JSType::GlobalProxyType)
        object = jsCast<JSC::JSGlobalProxy*>(object)->target();

    JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::HasProperty);
    bool hasValue = object->getPropertySlot(globalObject, propertyKey, slot);

    // easymode: regular property or missing property
    if (!hasValue || slot.isValue()) {
        auto* mock = JSMockFunction::create(vm, globalObject, globalObject->mockModule.mockFunctionStructure.getInitializedOnMainThread(globalObject), CallbackKind::GetterSetter);
        mock->spyTarget = JSC::Weak<JSObject>(object, &weakValueHandleOwner(), nullptr);
        mock->spyIdentifier = propertyKey.isSymbol() ? Identifier::fromUid(vm, propertyKey.uid()) : Identifier::fromString(vm, propertyKey.publicName());
        mock->spyAttributes = hasValue ? slot.attributes() : 0;
        unsigned attributes = 0;
        JSValue value = jsUndefined();

        if (hasValue)
            value = slot.getValue(globalObject, propertyKey);

        if (hasValue && ((slot.attributes() & PropertyAttribute::Function) != 0 || (value.isCell() && value.isCallable()))) {
            if (hasValue)
                attributes = slot.attributes();

            {
                auto catcher = DECLARE_CATCH_SCOPE(vm);
                WTF::String nameToUse;
                if (auto* fn = jsDynamicCast<JSFunction*>(value)) {
                    nameToUse = fn->name(vm);
                } else if (auto* fn = jsDynamicCast<InternalFunction*>(value)) {
                    nameToUse = fn->name();
                }
                if (nameToUse.length()) {
                    mock->setName(nameToUse);
                }
                if (catcher.exception())
                    catcher.clearException();
            }

            attributes |= PropertyAttribute::Function;
            object->putDirect(vm, propertyKey, mock, attributes);
            RETURN_IF_EXCEPTION(scope, {});

            pushImpl(mock, globalObject, JSMockImplementation::Kind::Call, value);
        } else {
            if (hasValue)
                attributes = slot.attributes();

            attributes |= PropertyAttribute::Accessor;
            object->putDirect(vm, propertyKey, JSC::GetterSetter::create(vm, globalObject, mock, mock), attributes);
            RETURN_IF_EXCEPTION(scope, {});

            pushImpl(mock, globalObject, JSMockImplementation::Kind::ReturnValue, value);
        }

        if (!globalObject->mockModule.activeSpies) {
            ActiveSpySet* activeSpies = ActiveSpySet::create(vm, globalObject->mockModule.activeSpySetStructure.getInitializedOnMainThread(globalObject));
            globalObject->mockModule.activeSpies.set(vm, activeSpies);
        }

        ActiveSpySet* activeSpies = jsCast<ActiveSpySet*>(globalObject->mockModule.activeSpies.get());
        activeSpies->add(vm, mock, mock);

        return JSValue::encode(mock);
    }

    // hardmode: accessor property
    throwVMError(globalObject, scope, "spyOn(target, prop) does not support accessor properties yet"_s);
    return {};
}

JSMockModule JSMockModule::create(JSC::JSGlobalObject* globalObject)
{
    JSMockModule mock;
    mock.mockFunctionStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto* prototype = JSMockFunctionPrototype::create(init.vm, init.owner, JSMockFunctionPrototype::createStructure(init.vm, init.owner, init.owner->functionPrototype()));

            init.set(JSMockFunction::createStructure(init.vm, init.owner, prototype));
        });
    mock.mockResultStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(init.owner);
            JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
                globalObject,
                globalObject->objectPrototype(),
                2);
            JSC::PropertyOffset offset;

            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "type"_s),
                0,
                offset);

            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "value"_s),

                0,
                offset);

            init.set(structure);
        });
    mock.activeSpySetStructure.initLater([](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
        Structure* implementation = ActiveSpySet::createStructure(init.vm, init.owner, jsNull());
        init.set(implementation);
    });
    mock.mockImplementationStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            Structure* implementation = JSMockImplementation::createStructure(init.vm, init.owner, jsNull());
            init.set(implementation);
        });
    mock.mockObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(init.owner);
            JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
                globalObject,
                globalObject->objectPrototype(),
                4);
            JSC::PropertyOffset offset;
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "calls"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "contexts"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "instances"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "results"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);

            init.set(structure);
        });
    return mock;
}

extern Structure* createMockResultStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        2);
    JSC::PropertyOffset offset;

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "type"_s),
        0,
        offset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "value"_s),
        0, offset);
    return structure;
}

static JSValue createMockResult(JSC::VM& vm, Zig::GlobalObject* globalObject, const WTF::String& type, JSC::JSValue value)
{
    JSC::Structure* structure = globalObject->mockModule.mockResultStructure.getInitializedOnMainThread(globalObject);

    JSC::JSObject* result = JSC::constructEmptyObject(vm, structure);
    result->putDirectOffset(vm, 0, jsString(vm, type));
    result->putDirectOffset(vm, 1, value);
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionCall, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    JSMockFunction* fn = jsDynamicCast<JSMockFunction*>(callframe->jsCallee());
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!fn)) {
        throwTypeError(globalObject, scope, "Expected callee to be mock function"_s);
        return {};
    }

    JSC::ArgList args = JSC::ArgList(callframe);
    JSValue thisValue = callframe->thisValue();
    JSC::JSArray* argumentsArray = nullptr;
    {
        JSC::ObjectInitializationScope object(vm);
        argumentsArray = JSC::JSArray::tryCreateUninitializedRestricted(
            object,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            callframe->argumentCount());
        for (size_t i = 0; i < args.size(); i++) {
            argumentsArray->initializeIndex(object, i, args.at(i));
        }
    }

    JSC::JSArray* calls = fn->calls.get();
    if (calls) {
        calls->push(globalObject, argumentsArray);
    } else {
        JSC::ObjectInitializationScope object(vm);
        calls = JSC::JSArray::tryCreateUninitializedRestricted(
            object,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            1);
        calls->initializeIndex(object, 0, argumentsArray);
    }
    fn->calls.set(vm, fn, calls);

    JSC::JSArray* contexts = fn->contexts.get();
    if (contexts) {
        contexts->push(globalObject, thisValue);
    } else {
        JSC::ObjectInitializationScope object(vm);
        contexts = JSC::JSArray::tryCreateUninitializedRestricted(
            object,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            1);
        contexts->initializeIndex(object, 0, thisValue);
    }
    fn->contexts.set(vm, fn, contexts);

    JSValue implementationValue = fn->implementation.get();
    if (!implementationValue)
        implementationValue = jsUndefined();

    if (auto* impl = jsDynamicCast<JSMockImplementation*>(implementationValue)) {
        if (JSValue nextValue = impl->internalFields[1].get()) {
            if (nextValue.inherits<JSMockImplementation>() || (nextValue.isInt32() && nextValue.asInt32() == 1)) {
                fn->implementation.set(vm, fn, nextValue);
            }
        }

        unsigned int returnValueIndex = 0;
        auto setReturnValue = [&](JSC::JSValue value) -> void {
            if (auto* returnValuesArray = fn->returnValues.get()) {
                returnValuesArray->push(globalObject, value);
                returnValueIndex = returnValuesArray->length() - 1;
            } else {
                JSC::ObjectInitializationScope object(vm);
                returnValuesArray = JSC::JSArray::tryCreateUninitializedRestricted(
                    object,
                    globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                    1);
                returnValuesArray->initializeIndex(object, 0, value);
                fn->returnValues.set(vm, fn, returnValuesArray);
            }
        };

        switch (impl->kind) {
        case JSMockImplementation::Kind::Call: {
            JSValue result = impl->internalFields[0].get();
            JSC::CallData callData = JSC::getCallData(result);
            if (UNLIKELY(callData.type == JSC::CallData::Type::None)) {
                throwTypeError(globalObject, scope, "Expected mock implementation to be callable"_s);
                return {};
            }

            setReturnValue(createMockResult(vm, globalObject, "incomplete"_s, jsUndefined()));

            WTF::NakedPtr<JSC::Exception> exception;

            JSValue returnValue = call(globalObject, result, callData, thisValue, args, exception);

            if (auto* exc = exception.get()) {
                if (auto* returnValuesArray = fn->returnValues.get()) {
                    returnValuesArray->putDirectIndex(globalObject, returnValueIndex, createMockResult(vm, globalObject, "throw"_s, exc->value()));
                    fn->returnValues.set(vm, fn, returnValuesArray);
                    JSC::throwException(globalObject, scope, exc);
                    return {};
                }
            }

            if (UNLIKELY(!returnValue)) {
                returnValue = jsUndefined();
            }

            if (auto* returnValuesArray = fn->returnValues.get()) {
                returnValuesArray->putDirectIndex(globalObject, returnValueIndex, createMockResult(vm, globalObject, "return"_s, returnValue));
                fn->returnValues.set(vm, fn, returnValuesArray);
            }

            return JSValue::encode(returnValue);
        }
        case JSMockImplementation::Kind::ReturnValue:
        case JSMockImplementation::Kind::Promise: {
            JSValue returnValue = impl->internalFields[0].get();
            setReturnValue(createMockResult(vm, globalObject, "return"_s, returnValue));
            return JSValue::encode(returnValue);
        }
        case JSMockImplementation::Kind::ReturnThis: {
            setReturnValue(createMockResult(vm, globalObject, "return"_s, thisValue));
            return JSValue::encode(thisValue);
        }
        default: {
            RELEASE_ASSERT_NOT_REACHED();
        }
        }
    }

    return JSValue::encode(jsUndefined());
}

void JSMockFunctionPrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSMockFunction::info(), JSMockFunctionPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();

    this->putDirect(vm, Identifier::fromString(vm, "_isMockFunction"_s), jsBoolean(true), 0);
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionGetMockImplementation, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    JSValue impl = thisObject->implementation.get();
    if (auto* implementation = jsDynamicCast<JSMockImplementation*>(impl)) {
        if (implementation->kind == JSMockImplementation::Kind::Call) {
            RELEASE_AND_RETURN(scope, JSValue::encode(implementation->internalFields[0].get()));
        }
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_CUSTOM_GETTER(jsMockFunctionGetter_mock, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Bun::JSMockFunction* thisObject = jsDynamicCast<Bun::JSMockFunction*>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
        return {};
    }

    return JSValue::encode(thisObject->mock.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsMockFunctionGetter_protoImpl, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Bun::JSMockFunction* thisObject = jsDynamicCast<Bun::JSMockFunction*>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
        return {};
    }

    if (auto implValue = thisObject->implementation.get()) {
        if (auto* impl = jsDynamicCast<JSMockImplementation*>(implValue)) {
            if (impl->kind == JSMockImplementation::Kind::Call) {
                return JSValue::encode(impl->internalFields[0].get());
            }

            return JSValue::encode(jsUndefined());
        }
    }

    return JSValue::encode(jsUndefined());
}

#define HANDLE_STATIC_CALL                                                                                                                 \
    if (!thisObject->implementation.get()) {                                                                                               \
        thisObject = JSMockFunction::create(                                                                                               \
            vm,                                                                                                                            \
            globalObject,                                                                                                                  \
            reinterpret_cast<Zig::GlobalObject*>(globalObject)->mockModule.mockFunctionStructure.getInitializedOnMainThread(globalObject), \
            CallbackKind::Call);                                                                                                           \
    }

extern "C" EncodedJSValue JSMockFunction__createObject(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(
        JSMockFunction::create(globalObject->vm(), globalObject, globalObject->mockModule.mockFunctionStructure.getInitializedOnMainThread(globalObject), CallbackKind::Wrapper));
}

extern "C" EncodedJSValue JSMockFunction__getCalls(EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);
    if (value) {
        if (auto* mock = jsDynamicCast<JSMockFunction*>(value)) {
            return JSValue::encode(mock->getCalls());
        }
    }

    return JSValue::encode({});
}
extern "C" EncodedJSValue JSMockFunction__getReturns(EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);
    if (value) {
        if (auto* mock = jsDynamicCast<JSMockFunction*>(value)) {
            return JSValue::encode(mock->getReturnValues());
        }
    }

    return JSValue::encode({});
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionGetMockName, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    JSValue implValue = thisObject->implementation.get();
    if (!implValue) {
        implValue = jsUndefined();
    }

    if (auto* impl = jsDynamicCast<JSMockImplementation*>(implValue)) {
        if (impl->kind == JSMockImplementation::Kind::Call) {
            JSObject* object = impl->internalFields[0].get().asCell()->getObject();
            if (auto nameValue = object->getIfPropertyExists(globalObject, PropertyName(vm.propertyNames->name))) {
                RELEASE_AND_RETURN(scope, JSValue::encode(nameValue));
            }

            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsEmptyString(vm)));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockClear, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    thisObject->reset();

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReset, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    thisObject->reset();

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockRestore, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockImplementation, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = lexicalGlobalObject->vm();
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSMockFunction* thisObject = JSMockFunction::create(
        vm,
        globalObject,
        globalObject->mockModule.mockFunctionStructure.getInitializedOnMainThread(globalObject));

    if (UNLIKELY(!thisObject)) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    if (callframe->argumentCount() > 0) {
        JSValue value = callframe->argument(0);
        if (value.isCallable()) {
            {
                auto catcher = DECLARE_CATCH_SCOPE(vm);
                WTF::String nameToUse;
                if (auto* fn = jsDynamicCast<JSFunction*>(value)) {
                    nameToUse = fn->name(vm);
                } else if (auto* fn = jsDynamicCast<InternalFunction*>(value)) {
                    nameToUse = fn->name();
                }
                if (nameToUse.length()) {
                    thisObject->setName(nameToUse);
                }
                if (catcher.exception())
                    catcher.clearException();
            }
            pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Call, value);
        } else {
            pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, value);
        }
    }

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockImplementationOnce, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = lexicalGlobalObject->vm();
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));

    if (UNLIKELY(!thisObject)) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    HANDLE_STATIC_CALL;

    if (callframe->argumentCount() > 0) {
        JSValue value = callframe->argument(0);
        if (value.isCallable()) {
            if (!thisObject->implementation) {
                auto catcher = DECLARE_CATCH_SCOPE(vm);
                WTF::String nameToUse;
                if (auto* fn = jsDynamicCast<JSFunction*>(value)) {
                    nameToUse = fn->name(vm);
                } else if (auto* fn = jsDynamicCast<InternalFunction*>(value)) {
                    nameToUse = fn->name();
                }
                if (nameToUse.length()) {
                    thisObject->setName(nameToUse);
                }
                if (catcher.exception())
                    catcher.clearException();
            }

            pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Call, value);
        } else {
            pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, value);
        }
    }

    return JSValue::encode(thisObject);
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionWithImplementation, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
        RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
    }

    HANDLE_STATIC_CALL;

    JSValue arg = callframe->argument(0);

    if (callframe->argumentCount() < 1 || arg.isEmpty() || arg.isUndefined()) {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, jsUndefined());
    } else if (arg.isCallable()) {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Call, arg);
    } else {
        throwTypeError(globalObject, scope, "Expected a function or undefined"_s);
        RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockName, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
        return {};
    }

    HANDLE_STATIC_CALL;

    if (callframe->argumentCount() > 0) {
        auto* newName = callframe->argument(0).toStringOrNull(globalObject);
        if (UNLIKELY(!newName)) {
            return {};
        }

        thisObject->putDirect(vm, vm.propertyNames->name, newName, 0);
        RELEASE_AND_RETURN(scope, JSValue::encode(newName));
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsString(vm, thisObject->calculatedDisplayName(vm))));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnThis, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    HANDLE_STATIC_CALL;

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnThis, jsUndefined());

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnValueOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    HANDLE_STATIC_CALL;

    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockResolvedValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::resolvedPromise(globalObject, callframe->argument(0)));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockResolvedValueOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::resolvedPromise(globalObject, callframe->argument(0)));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockRejectedValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::rejectedPromise(globalObject, callframe->argument(0)));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockRejectedValueOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::rejectedPromise(globalObject, callframe->argument(0)));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
}

#include "root.h"

#include "ErrorCode+List.h"
#include "JavaScriptCore/Error.h"
#include "JSMockFunction.h"
#include <JavaScriptCore/JSPromise.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "BunClientData.h"
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSInternalPromise.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/WeakMapImpl.h>
#include <JavaScriptCore/WeakMapImplInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include "BunPlugin.h"
#include "AsyncContextFrame.h"
#include "ErrorCode.h"

BUN_DECLARE_HOST_FUNCTION(JSMock__jsUseFakeTimers);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsUseRealTimers);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsNow);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsSetSystemTime);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsRestoreAllMocks);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsClearAllMocks);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsSpyOn);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsMockFn);

#define CHECK_IS_MOCK_FUNCTION(thisValue)                                                              \
    if (UNLIKELY(!thisObject)) {                                                                       \
        scope.throwException(globalObject, createInvalidThisError(globalObject, thisValue, "Mock"_s)); \
        return {};                                                                                     \
    }

namespace Bun {

/**
 * intended to be used in an if statement as an abstraction over this double if statement
 *
 * if(jsValue) {
 *   if(auto value = jsDynamicCast(jsValue)) {
 *     ...
 *   }
 * }
 *
 * the reason this is needed is because jsDynamicCast will segfault if given a zero JSValue
 */
template<typename To>
inline To tryJSDynamicCast(JSValue from)
{
    if (UNLIKELY(!from))
        return nullptr;
    if (UNLIKELY(!from.isCell()))
        return nullptr;
    return jsDynamicCast<To>(from.asCell());
}

/**
 * intended to be used in an if statement as an abstraction over this double if statement
 *
 * if(jsValue) {
 *   if(auto value = jsDynamicCast(jsValue)) {
 *     ...
 *   }
 * }
 *
 * the reason this is needed is because jsDynamicCast will segfault if given a zero JSValue
 */
template<typename To, typename WriteBarrierT>
inline To tryJSDynamicCast(JSC::WriteBarrier<WriteBarrierT>& from)
{
    if (UNLIKELY(!from))
        return nullptr;

    return jsDynamicCast<To>(from.get());
}

JSC_DECLARE_HOST_FUNCTION(jsMockFunctionCall);
JSC_DECLARE_CUSTOM_GETTER(jsMockFunctionGetter_protoImpl);
JSC_DECLARE_CUSTOM_GETTER(jsMockFunctionGetter_mock);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionGetter_mockGetLastCall);
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
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionWithImplementationCleanup);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionWithImplementation);

uint64_t JSMockModule::s_nextInvocationId = 0;

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
        ReturnValue,
        ReturnThis,
    };

    static JSMockImplementation* create(JSC::JSGlobalObject* globalObject, JSC::Structure* structure, Kind kind, JSC::JSValue heldValue, bool isOnce)
    {
        auto& vm = JSC::getVM(globalObject);
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

    // either a function or a return value, depends on kind
    mutable JSC::WriteBarrier<JSC::Unknown> underlyingValue;

    // a combination of a pointer to the next implementation and a flag indicating if this is a once implementation
    // - undefined            - no next value
    // - jsNumber(1)          - no next value + is a once implementation
    // - JSMockImplementation - next value + is a once implementation
    mutable JSC::WriteBarrier<JSC::Unknown> nextValueOrSentinel;

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    Kind kind { Kind::ReturnValue };

    bool isOnce()
    {
        return !nextValueOrSentinel.get().isUndefined();
    }

    JSMockImplementation(JSC::VM& vm, JSC::Structure* structure, Kind kind)
        : Base(vm, structure)
        , kind(kind)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSValue first, JSC::JSValue second)
    {
        Base::finishCreation(vm);
        this->underlyingValue.set(vm, this, first);
        this->nextValueOrSentinel.set(vm, this, second);
    }
};

template<typename Visitor>
void JSMockImplementation::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSMockImplementation* fn = jsCast<JSMockImplementation*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->underlyingValue);
    visitor.append(fn->nextValueOrSentinel);
}

DEFINE_VISIT_CHILDREN(JSMockImplementation);

enum class CallbackKind : uint8_t {
    Call,
    GetterSetter,
};

const ClassInfo JSMockImplementation::s_info = { "MockImpl"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMockImplementation) };

class JSMockFunction : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSMockFunction* create(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::Structure* structure, CallbackKind kind = CallbackKind::Call)
    {
        JSMockFunction* function = new (NotNull, JSC::allocateCell<JSMockFunction>(vm)) JSMockFunction(vm, structure, kind);
        function->finishCreation(vm);

        // Do not forget to set the original name: https://github.com/oven-sh/bun/issues/8794
        function->m_originalName.set(vm, function, globalObject->commonStrings().mockedFunctionString(globalObject));

        return function;
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
    }

    DECLARE_INFO;

    DECLARE_VISIT_CHILDREN;
    template<typename Visitor> void visitAdditionalChildren(Visitor&);
    DECLARE_VISIT_OUTPUT_CONSTRAINTS;

    JSC::LazyProperty<JSMockFunction, JSObject> mock;
    // three pointers to implementation objects
    // head of the list, this one is run next
    mutable JSC::WriteBarrier<JSC::Unknown> implementation;
    // this contains the non-once implementation. there is only ever one of these
    mutable JSC::WriteBarrier<JSC::Unknown> fallbackImplmentation;
    // the last once implementation
    mutable JSC::WriteBarrier<JSC::Unknown> tail;
    // original implementation from spy. separate from `implementation` so restoration always works
    mutable JSC::WriteBarrier<JSC::Unknown> spyOriginal;
    mutable JSC::WriteBarrier<JSC::JSArray> calls;
    mutable JSC::WriteBarrier<JSC::JSArray> contexts;
    mutable JSC::WriteBarrier<JSC::JSArray> invocationCallOrder;
    mutable JSC::WriteBarrier<JSC::JSArray> instances;
    mutable JSC::WriteBarrier<JSC::JSArray> returnValues;

    JSC::Weak<JSObject> spyTarget;
    JSC::Identifier spyIdentifier;
    unsigned spyAttributes = 0;

    static constexpr unsigned SpyAttributeESModuleNamespace = 1 << 30;

    JSString* jsName()
    {
        return m_originalName.get();
    }

    void setName(const WTF::String& name)
    {
        auto& vm = this->vm();
        auto* nameStr = jsString(vm, name);

        // Do not forget to set the original name: https://github.com/oven-sh/bun/issues/8794
        m_originalName.set(vm, this, nameStr);

        this->putDirect(vm, vm.propertyNames->name, nameStr, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
    }

    void copyNameAndLength(JSC::VM& vm, JSGlobalObject* global, JSC::JSValue value)
    {
        auto catcher = DECLARE_CATCH_SCOPE(vm);
        WTF::String nameToUse;
        if (auto* fn = jsDynamicCast<JSFunction*>(value)) {
            nameToUse = fn->name(vm);
            JSValue lengthJSValue = fn->get(global, vm.propertyNames->length);
            if (lengthJSValue.isNumber()) {
                this->putDirect(vm, vm.propertyNames->length, (lengthJSValue), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
            }
        } else if (auto* fn = jsDynamicCast<JSMockFunction*>(value)) {
            JSValue nameValue = fn->get(global, vm.propertyNames->name);
            if (!catcher.exception()) {
                nameToUse = nameValue.toWTFString(global);
            }
        } else if (auto* fn = jsDynamicCast<InternalFunction*>(value)) {
            nameToUse = fn->name();
        } else {
            nameToUse = "mockConstructor"_s;
        }
        this->setName(nameToUse);

        if (catcher.exception()) {
            catcher.clearException();
        }
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
                object->putDirectOffset(init.vm, 4, mock->getInvocationCallOrder());
                init.set(object);
            });
    }

    void clear()
    {
        this->calls.clear();
        this->instances.clear();
        this->returnValues.clear();
        this->contexts.clear();
        this->invocationCallOrder.clear();

        if (this->mock.isInitialized()) {
            this->initMock();
        }
    }

    void reset()
    {
        this->clear();
        this->implementation.clear();
        this->fallbackImplmentation.clear();
        this->tail.clear();
    }

    void clearSpy()
    {
        this->reset();

        if (auto* target = this->spyTarget.get()) {
            JSValue implValue = this->spyOriginal.get();
            if (!implValue) {
                implValue = jsUndefined();
            }

            // Reset the spy back to the original value.
            if (this->spyAttributes & SpyAttributeESModuleNamespace) {
                if (auto* moduleNamespaceObject = tryJSDynamicCast<JSModuleNamespaceObject*>(target)) {
                    moduleNamespaceObject->overrideExportValue(moduleNamespaceObject->globalObject(), this->spyIdentifier, implValue);
                }
            } else {
                target->putDirect(this->vm(), this->spyIdentifier, implValue, this->spyAttributes);
            }
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
    JSArray* getInvocationCallOrder() const
    {
        JSArray* val = invocationCallOrder.get();
        if (!val) {
            val = JSC::constructEmptyArray(globalObject(), nullptr, 0);
            this->invocationCallOrder.set(vm(), this, val);
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
        : Base(vm, structure, jsMockFunctionCall, jsMockFunctionCall)
    {
        initMock();
    }
};

template<typename Visitor>
void JSMockFunction::visitAdditionalChildren(Visitor& visitor)
{
    JSMockFunction* fn = this;
    ASSERT_GC_OBJECT_INHERITS(fn, info());

    visitor.append(fn->implementation);
    visitor.append(fn->tail);
    visitor.append(fn->fallbackImplmentation);
    visitor.append(fn->calls);
    visitor.append(fn->contexts);
    visitor.append(fn->instances);
    visitor.append(fn->returnValues);
    visitor.append(fn->invocationCallOrder);
    visitor.append(fn->spyOriginal);
    fn->mock.visit(visitor);
}

template<typename Visitor>
void JSMockFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSMockFunction* fn = jsCast<JSMockFunction*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);
    fn->visitAdditionalChildren<Visitor>(visitor);
}

template<typename Visitor>
void JSMockFunction::visitOutputConstraintsImpl(JSCell* cell, Visitor& visitor)
{
    JSMockFunction* thisObject = jsCast<JSMockFunction*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    thisObject->visitAdditionalChildren<Visitor>(visitor);
}

DEFINE_VISIT_CHILDREN(JSMockFunction);
DEFINE_VISIT_ADDITIONAL_CHILDREN(JSMockFunction);
DEFINE_VISIT_OUTPUT_CONSTRAINTS(JSMockFunction);

static void pushImpl(JSMockFunction* fn, JSGlobalObject* jsGlobalObject, JSMockImplementation::Kind kind, JSValue value)
{
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(jsGlobalObject);
    auto& vm = JSC::getVM(globalObject);

    if (auto* current = tryJSDynamicCast<JSMockImplementation*, Unknown>(fn->fallbackImplmentation)) {
        current->underlyingValue.set(vm, current, value);
        current->kind = kind;
        return;
    }

    JSMockImplementation* impl = JSMockImplementation::create(globalObject, globalObject->mockModule.mockImplementationStructure.getInitializedOnMainThread(globalObject), kind, value, false);
    fn->fallbackImplmentation.set(vm, fn, impl);
    if (auto* tail = tryJSDynamicCast<JSMockImplementation*, Unknown>(fn->tail)) {
        tail->nextValueOrSentinel.set(vm, tail, impl);
    } else {
        fn->implementation.set(vm, fn, impl);
    }
}

static void pushImplOnce(JSMockFunction* fn, JSGlobalObject* jsGlobalObject, JSMockImplementation::Kind kind, JSValue value)
{
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(jsGlobalObject);
    auto& vm = JSC::getVM(globalObject);

    JSMockImplementation* impl = JSMockImplementation::create(globalObject, globalObject->mockModule.mockImplementationStructure.getInitializedOnMainThread(globalObject), kind, value, true);

    if (!fn->implementation) {
        fn->implementation.set(vm, fn, impl);
    }
    if (auto* tail = tryJSDynamicCast<JSMockImplementation*, Unknown>(fn->tail)) {
        tail->nextValueOrSentinel.set(vm, tail, impl);
    } else {
        fn->implementation.set(vm, fn, impl);
    }
    if (auto fallback = fn->fallbackImplmentation.get()) {
        impl->nextValueOrSentinel.set(vm, impl, fallback);
    }
    fn->tail.set(vm, fn, impl);
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
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSMockFunctionPrototype, Base);
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
    { "mockRejectedValue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockRejectedValue, 1 } },
    { "mockRejectedValueOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockRejectedValueOnce, 1 } },
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
        spyObject->clearSpy();
    }
    globalObject->mockModule.activeSpies.clear();
}

extern "C" void JSMock__clearAllMocks(Zig::GlobalObject* globalObject)
{
    if (!globalObject->mockModule.activeMocks) {
        return;
    }
    auto spiesValue = globalObject->mockModule.activeMocks.get();

    ActiveSpySet* activeSpies = jsCast<ActiveSpySet*>(spiesValue);
    MarkedArgumentBuffer active;
    activeSpies->takeSnapshot(active);
    size_t size = active.size();

    for (size_t i = 0; i < size; ++i) {
        JSValue spy = active.at(i);
        if (!spy.isObject())
            continue;

        auto* spyObject = jsCast<JSMockFunction*>(spy);
        // seems similar to what we do in JSMock__resetSpies,
        // but we actually only clear calls, context, instances and results
        spyObject->clear();
    }
}

JSMockModule JSMockModule::create(JSC::JSGlobalObject* globalObject)
{
    JSMockModule mock;
    mock.mockFunctionStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto& vm = init.vm;
            auto* prototype = JSMockFunctionPrototype::create(vm, init.owner, JSMockFunctionPrototype::createStructure(vm, init.owner, init.owner->functionPrototype()));
            auto* structure = JSMockFunction::createStructure(vm, init.owner, prototype);
            init.set(structure);
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

    mock.mockModuleStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            Structure* implementation = createModuleMockStructure(init.vm, init.owner, jsNull());
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

            auto* prototype = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());
            // `putDirectCustomAccessor` doesn't pass the `this` value as expected. unfortunatly we
            // need to use a JSFunction for the getter and assign it via `putDirectAccessor` instead.
            prototype->putDirectAccessor(
                globalObject,
                JSC::Identifier::fromString(init.vm, "lastCall"_s),
                JSC::GetterSetter::create(
                    init.vm,
                    globalObject,
                    JSC::JSFunction::create(init.vm, init.owner, 0, "lastCall"_s, jsMockFunctionGetter_mockGetLastCall, ImplementationVisibility::Public),
                    jsUndefined()),
                JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

            JSC::Structure* structure
                = globalObject->structureCache().emptyObjectStructureForPrototype(
                    globalObject,
                    prototype,
                    5);
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
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "invocationCallOrder"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);

            init.set(structure);
        });
    mock.withImplementationCleanupFunction.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSFunction>::Initializer& init) {
            init.set(JSC::JSFunction::create(init.vm, init.owner, 2, String(), jsMockFunctionWithImplementationCleanup, ImplementationVisibility::Public));
        });
    mock.mockWithImplementationCleanupDataStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            init.set(Bun::MockWithImplementationCleanupData::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
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
        vm.propertyNames->type,
        0,
        offset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        vm.propertyNames->value,
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
    auto& vm = JSC::getVM(globalObject);
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
        fn->calls.set(vm, fn, calls);
    }

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
        fn->contexts.set(vm, fn, contexts);
    }

    auto invocationId = JSMockModule::nextInvocationId();
    JSC::JSArray* invocationCallOrder = fn->invocationCallOrder.get();
    if (invocationCallOrder) {
        invocationCallOrder->push(globalObject, jsNumber(invocationId));
    } else {
        JSC::ObjectInitializationScope object(vm);
        invocationCallOrder = JSC::JSArray::tryCreateUninitializedRestricted(
            object,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            1);
        invocationCallOrder->initializeIndex(object, 0, jsNumber(invocationId));
        fn->invocationCallOrder.set(vm, fn, invocationCallOrder);
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

    if (auto* impl = tryJSDynamicCast<JSMockImplementation*, Unknown>(fn->implementation)) {
        if (impl->isOnce()) {
            auto next = impl->nextValueOrSentinel.get();
            fn->implementation.set(vm, fn, next);
            if (next.isNumber() || !jsDynamicCast<JSMockImplementation*>(next)->isOnce()) {
                fn->tail.clear();
            }
        }

        switch (impl->kind) {
        case JSMockImplementation::Kind::Call: {
            JSValue result = impl->underlyingValue.get();
            JSC::CallData callData = JSC::getCallData(result);
            if (UNLIKELY(callData.type == JSC::CallData::Type::None)) {
                throwTypeError(globalObject, scope, "Expected mock implementation to be callable"_s);
                return {};
            }

            setReturnValue(createMockResult(vm, globalObject, "incomplete"_s, jsUndefined()));

            auto catchScope = DECLARE_CATCH_SCOPE(vm);

            JSValue returnValue = Bun::call(globalObject, result, callData, thisValue, args);

            if (auto* exc = catchScope.exception()) {
                if (auto* returnValuesArray = fn->returnValues.get()) {
                    returnValuesArray->putDirectIndex(globalObject, returnValueIndex, createMockResult(vm, globalObject, "throw"_s, exc->value()));
                    fn->returnValues.set(vm, fn, returnValuesArray);
                    catchScope.clearException();
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
        case JSMockImplementation::Kind::ReturnValue: {
            JSValue returnValue = impl->underlyingValue.get();
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

    setReturnValue(createMockResult(vm, globalObject, "return"_s, jsUndefined()));
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
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    if (auto* implementation = tryJSDynamicCast<JSMockImplementation*, Unknown>(thisObject->implementation)) {
        if (implementation->kind == JSMockImplementation::Kind::Call) {
            RELEASE_AND_RETURN(scope, JSValue::encode(implementation->underlyingValue.get()));
        }
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_CUSTOM_GETTER(jsMockFunctionGetter_mock, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Bun::JSMockFunction* thisObject = jsDynamicCast<Bun::JSMockFunction*>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    CHECK_IS_MOCK_FUNCTION(JSValue::decode(thisValue))

    return JSValue::encode(thisObject->mock.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsMockFunctionGetter_protoImpl, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Bun::JSMockFunction* thisObject = jsDynamicCast<Bun::JSMockFunction*>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    CHECK_IS_MOCK_FUNCTION(JSValue::decode(thisValue))

    if (auto* impl = tryJSDynamicCast<JSMockImplementation*, Unknown>(thisObject->implementation)) {
        if (impl->kind == JSMockImplementation::Kind::Call) {
            if (impl->underlyingValue) {
                return JSValue::encode(impl->underlyingValue.get());
            }
        }
    }

    return JSValue::encode(jsUndefined());
}

extern "C" JSC::EncodedJSValue JSMockFunction__getCalls(EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);
    if (auto* mock = tryJSDynamicCast<JSMockFunction*>(value)) {
        return JSValue::encode(mock->getCalls());
    }

    return JSValue::encode({});
}
extern "C" JSC::EncodedJSValue JSMockFunction__getReturns(EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);
    if (auto* mock = tryJSDynamicCast<JSMockFunction*>(value)) {
        return JSValue::encode(mock->getReturnValues());
    }

    return JSValue::encode({});
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionGetMockName, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue)

    auto* jsName = thisObject->jsName();
    if (!jsName) {
        return JSValue::encode(jsEmptyString(vm));
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsName));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockClear, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->clear();

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReset, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->reset();

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockRestore, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->clearSpy();

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockImplementation, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    JSValue thisValue = callframe->thisValue();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    CHECK_IS_MOCK_FUNCTION(thisValue);

    JSValue value = callframe->argument(0);

    // This check is for a jest edge case, truthy values will throw but not immediatly, and falsy values return undefined.
    if (value.toBoolean(globalObject)) {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Call, value);
    } else {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, jsUndefined());
    }

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockImplementationOnce, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    JSValue thisValue = callframe->thisValue();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    CHECK_IS_MOCK_FUNCTION(thisValue);

    JSValue value = callframe->argument(0);

    // This check is for a jest edge case, truthy values will throw but not immediatly, and falsy values return undefined.
    if (value.toBoolean(globalObject)) {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::Call, value);
    } else {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, jsUndefined());
    }

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockName, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    // https://github.com/jestjs/jest/blob/bd1c6db7c15c23788ca3e09c919138e48dd3b28a/packages/jest-mock/src/index.ts#L849-L856
    if (callframe->argument(0).toBoolean(globalObject)) {
        WTF::String name = callframe->argument(0).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        thisObject->setName(name);
    } else {
        RETURN_IF_EXCEPTION(scope, {});
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnThis, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnThis, jsUndefined());

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnValueOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockResolvedValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, JSC::JSPromise::resolvedPromise(globalObject, callframe->argument(0)));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockResolvedValueOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, JSC::JSPromise::resolvedPromise(globalObject, callframe->argument(0)));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockRejectedValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, JSC::JSPromise::rejectedPromise(globalObject, callframe->argument(0)));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockRejectedValueOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, JSC::JSPromise::rejectedPromise(globalObject, callframe->argument(0)));

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionGetter_mockGetLastCall, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSValue thisObject = callframe->thisValue();
    if (UNLIKELY(!thisObject.isObject())) {
        return JSValue::encode(jsUndefined());
    }
    JSValue callsValue = thisObject.get(globalObject, Identifier::fromString(vm, "calls"_s));
    RETURN_IF_EXCEPTION(throwScope, {});

    if (auto callsArray = jsDynamicCast<JSC::JSArray*>(callsValue)) {
        auto len = callsArray->length();
        if (len > 0) {
            return JSValue::encode(callsArray->getIndex(globalObject, len - 1));
        }
    }
    return JSValue::encode(jsUndefined());
}

const JSC::ClassInfo MockWithImplementationCleanupData::s_info = { "MockWithImplementationCleanupData"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(MockWithImplementationCleanupData) };

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* MockWithImplementationCleanupData::subspaceFor(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<MockWithImplementationCleanupData, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForMockWithImplementationCleanupData.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForMockWithImplementationCleanupData = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForMockWithImplementationCleanupData.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForMockWithImplementationCleanupData = std::forward<decltype(space)>(space); });
}

MockWithImplementationCleanupData* MockWithImplementationCleanupData::create(VM& vm, Structure* structure)
{
    MockWithImplementationCleanupData* mod = new (NotNull, allocateCell<MockWithImplementationCleanupData>(vm)) MockWithImplementationCleanupData(vm, structure);
    return mod;
}
Structure* MockWithImplementationCleanupData::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

MockWithImplementationCleanupData::MockWithImplementationCleanupData(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void MockWithImplementationCleanupData::finishCreation(VM& vm, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback)
{
    Base::finishCreation(vm);
    this->internalField(0).set(vm, this, fn);
    this->internalField(1).set(vm, this, impl);
    this->internalField(2).set(vm, this, tail);
    this->internalField(3).set(vm, this, fallback);
}

template<typename Visitor>
void MockWithImplementationCleanupData::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<MockWithImplementationCleanupData*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(MockWithImplementationCleanupData);

MockWithImplementationCleanupData* MockWithImplementationCleanupData::create(JSC::JSGlobalObject* globalObject, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback)
{
    auto* obj = create(globalObject->vm(), reinterpret_cast<Zig::GlobalObject*>(globalObject)->mockModule.mockWithImplementationCleanupDataStructure.getInitializedOnMainThread(globalObject));
    obj->finishCreation(globalObject->vm(), fn, impl, tail, fallback);
    return obj;
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionWithImplementationCleanup, (JSC::JSGlobalObject * jsGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = jsGlobalObject->vm();
    auto ctx = jsDynamicCast<MockWithImplementationCleanupData*>(callframe->argument(1));
    if (!ctx) {
        return JSValue::encode(jsUndefined());
    }

    auto fn = jsDynamicCast<JSMockFunction*>(ctx->internalField(0).get());
    fn->implementation.set(vm, fn, ctx->internalField(1).get());
    fn->tail.set(vm, fn, ctx->internalField(2).get());
    fn->fallbackImplmentation.set(vm, fn, ctx->internalField(3).get());

    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionWithImplementation, (JSC::JSGlobalObject * jsGlobalObject, JSC::CallFrame* callframe))
{
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(jsGlobalObject);

    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    JSValue tempImplValue = callframe->argument(0);
    JSValue callback = callframe->argument(1);
    JSC::CallData callData = JSC::getCallData(callback);
    if (UNLIKELY(callData.type == JSC::CallData::Type::None)) {
        throwTypeError(globalObject, scope, "Expected mock implementation to be callable"_s);
        return {};
    }

    auto lastImpl = thisObject->implementation.get();
    auto lastTail = thisObject->tail.get();
    auto lastFallback = thisObject->fallbackImplmentation.get();

    JSMockImplementation* impl = JSMockImplementation::create(
        globalObject,
        globalObject->mockModule.mockImplementationStructure.getInitializedOnMainThread(globalObject),
        JSMockImplementation::Kind::Call,
        tempImplValue,
        false);

    thisObject->implementation.set(vm, thisObject, impl);
    thisObject->fallbackImplmentation.clear();
    thisObject->tail.clear();

    MarkedArgumentBuffer args;
    NakedPtr<Exception> exception;
    JSValue returnValue = call(globalObject, callback, callData, jsUndefined(), args, exception);

    if (auto promise = tryJSDynamicCast<JSC::JSPromise*>(returnValue)) {
        auto capability = JSC::JSPromise::createNewPromiseCapability(globalObject, globalObject->promiseConstructor());
        auto ctx = MockWithImplementationCleanupData::create(globalObject, thisObject, lastImpl, lastTail, lastFallback);

        JSFunction* cleanup = globalObject->mockModule.withImplementationCleanupFunction.getInitializedOnMainThread(globalObject);
        JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
        auto callData = JSC::getCallData(performPromiseThenFunction);
        MarkedArgumentBuffer arguments;
        arguments.append(promise);
        arguments.append(cleanup);
        arguments.append(cleanup);
        arguments.append(capability);
        arguments.append(ctx);
        ASSERT(!arguments.hasOverflowed());
        call(globalObject, performPromiseThenFunction, callData, jsUndefined(), arguments);

        return JSC::JSValue::encode(promise);
    }

    thisObject->implementation.set(vm, thisObject, lastImpl);
    thisObject->tail.set(vm, thisObject, lastImpl);
    thisObject->fallbackImplmentation.set(vm, thisObject, lastFallback);

    return JSC::JSValue::encode(jsUndefined());
}
} // namespace Bun

using namespace Bun;
using namespace JSC;

// This is a stub. Exists so that the same code can be run in Jest
BUN_DEFINE_HOST_FUNCTION(JSMock__jsUseFakeTimers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(callframe->thisValue());
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsUseRealTimers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    globalObject->overridenDateNow = -1;
    return JSValue::encode(callframe->thisValue());
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsNow, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(jsNumber(globalObject->jsDateNow()));
}
BUN_DEFINE_HOST_FUNCTION(JSMock__jsSetSystemTime, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue argument0 = callframe->argument(0);

    if (auto* dateInstance = jsDynamicCast<DateInstance*>(argument0)) {
        if (std::isnormal(dateInstance->internalNumber())) {
            globalObject->overridenDateNow = dateInstance->internalNumber();
        }
        return JSValue::encode(callframe->thisValue());
    }
    // number > 0 is a valid date otherwise it's invalid and we should reset the time (set to -1)
    globalObject->overridenDateNow = (argument0.isNumber() && argument0.asNumber() >= 0) ? argument0.asNumber() : -1;

    return JSValue::encode(callframe->thisValue());
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsRestoreAllMocks, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMock__resetSpies(jsCast<Zig::GlobalObject*>(globalObject));
    return JSValue::encode(jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsClearAllMocks, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMock__clearAllMocks(jsCast<Zig::GlobalObject*>(globalObject));
    return JSValue::encode(jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsSpyOn, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
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
        JSValue value = jsUndefined();
        if (hasValue) {
            if (UNLIKELY(slot.isTaintedByOpaqueObject())) {
                // if it's a Proxy or JSModuleNamespaceObject
                value = object->get(globalObject, propertyKey);
            } else {
                value = slot.getValue(globalObject, propertyKey);
            }

            if (jsDynamicCast<JSMockFunction*>(value)) {
                return JSValue::encode(value);
            }
        }

        auto* mock = JSMockFunction::create(vm, globalObject, globalObject->mockModule.mockFunctionStructure.getInitializedOnMainThread(globalObject), CallbackKind::GetterSetter);
        mock->spyTarget = JSC::Weak<JSObject>(object, &weakValueHandleOwner(), nullptr);
        mock->spyIdentifier = propertyKey.isSymbol() ? Identifier::fromUid(vm, propertyKey.uid()) : Identifier::fromString(vm, propertyKey.publicName());
        mock->spyAttributes = hasValue ? slot.attributes() : 0;
        unsigned attributes = 0;

        if (hasValue && ((slot.attributes() & PropertyAttribute::Function) != 0 || (value.isCell() && value.isCallable()))) {
            if (hasValue)
                attributes = slot.attributes();

            mock->copyNameAndLength(vm, globalObject, value);

            if (JSModuleNamespaceObject* moduleNamespaceObject = tryJSDynamicCast<JSModuleNamespaceObject*>(object)) {
                moduleNamespaceObject->overrideExportValue(globalObject, propertyKey, mock);
                mock->spyAttributes |= JSMockFunction::SpyAttributeESModuleNamespace;
            } else {
                object->putDirect(vm, propertyKey, mock, attributes);
            }

            RETURN_IF_EXCEPTION(scope, {});

            pushImpl(mock, globalObject, JSMockImplementation::Kind::Call, value);
        } else {
            if (hasValue)
                attributes = slot.attributes();

            attributes |= PropertyAttribute::Accessor;

            if (JSModuleNamespaceObject* moduleNamespaceObject = tryJSDynamicCast<JSModuleNamespaceObject*>(object)) {
                moduleNamespaceObject->overrideExportValue(globalObject, propertyKey, mock);
                mock->spyAttributes |= JSMockFunction::SpyAttributeESModuleNamespace;
            } else {
                object->putDirectAccessor(globalObject, propertyKey, JSC::GetterSetter::create(vm, globalObject, mock, mock), attributes);
            }

            // mock->setName(propertyKey.publicName());
            RETURN_IF_EXCEPTION(scope, {});

            pushImpl(mock, globalObject, JSMockImplementation::Kind::ReturnValue, value);
        }

        mock->spyOriginal.set(vm, mock, value);

        {
            if (!globalObject->mockModule.activeSpies) {
                ActiveSpySet* activeSpies = ActiveSpySet::create(vm, globalObject->mockModule.activeSpySetStructure.getInitializedOnMainThread(globalObject));
                globalObject->mockModule.activeSpies.set(vm, activeSpies);
            }
            ActiveSpySet* activeSpies = jsCast<ActiveSpySet*>(globalObject->mockModule.activeSpies.get());
            activeSpies->add(vm, mock, mock);
        }

        {
            if (!globalObject->mockModule.activeMocks) {
                ActiveSpySet* activeMocks = ActiveSpySet::create(vm, globalObject->mockModule.activeSpySetStructure.getInitializedOnMainThread(globalObject));
                globalObject->mockModule.activeMocks.set(vm, activeMocks);
            }
            ActiveSpySet* activeMocks = jsCast<ActiveSpySet*>(globalObject->mockModule.activeMocks.get());
            activeMocks->add(vm, mock, mock);
        }

        return JSValue::encode(mock);
    }

    // hardmode: accessor property
    throwVMError(globalObject, scope, "spyOn(target, prop) does not support accessor properties yet"_s);
    return {};
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsMockFn, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
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
            thisObject->copyNameAndLength(vm, lexicalGlobalObject, value);
            RETURN_IF_EXCEPTION(scope, {});
            pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Call, value);
        } else {
            // jest doesn't support doing `jest.fn(10)`, but we support it.
            pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, value);
            thisObject->setName("mockConstructor"_s);
        }
    } else {
        thisObject->setName("mockConstructor"_s);
    }

    if (!globalObject->mockModule.activeMocks) {
        ActiveSpySet* activeMocks = ActiveSpySet::create(vm, globalObject->mockModule.activeSpySetStructure.getInitializedOnMainThread(globalObject));
        globalObject->mockModule.activeMocks.set(vm, activeMocks);
    }

    ActiveSpySet* activeMocks = jsCast<ActiveSpySet*>(globalObject->mockModule.activeMocks.get());
    activeMocks->add(vm, thisObject, thisObject);

    return JSValue::encode(thisObject);
}

#undef CHECK_IS_MOCK_FUNCTION

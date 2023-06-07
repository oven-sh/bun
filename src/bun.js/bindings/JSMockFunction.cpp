#include "JSMockFunction.h"
#include <JavaScriptCore/JSPromise.h>
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

class JSMockFunction final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSMockFunction* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSMockFunction* function = new (NotNull, JSC::allocateCell<JSMockFunction>(vm.heap)) JSMockFunction(vm, structure);
        function->finishCreation(vm, globalObject);
        return function;
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(JSC::InternalFunction, StructureFlags), info());
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

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
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

    JSMockFunction(JSC::VM& structure, JSC::Structure* structure)
        : Base(vm, structure, jsMockFunctionCall, jsMockFunctionCall)
    {
    }
};

JSMockModule JSMockModule::create(JSC::JSGlobalObject* globalObject)
{
    JSMockModule mock;
    mock.mockFunctionStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            init.set(object);
        });
    mock.mockResultStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            JSPerformanceObject* object = JSPerformanceObject::create(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.owner),
                JSPerformanceObject::createStructure(init.vm, init.owner, init.owner->objectPrototype()));

            init.set(object);
        });
    mock.mockImplementationStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            JSPerformanceObject* object = JSPerformanceObject::create(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.owner),
                JSPerformanceObject::createStructure(init.vm, init.owner, init.owner->objectPrototype()));

            init.set(object);
        });
    mock.mockObject.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            JSPerformanceObject* object = JSPerformanceObject::create(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.owner),
                JSPerformanceObject::createStructure(init.vm, init.owner, init.owner->objectPrototype()));

            init.set(object);
        });
    return mock;
}

class JSMockImplementation final : public JSC::JSInternalFieldObjectImpl<2> {
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

    using Base = JSC::JSInternalFieldObjectImpl<2>;
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

    static std::array<JSValue, numberOfInternalFields> initialValues()
    {
        return { {
            jsUndefined(),
            jsNumber(1),
        } };
    }

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    Kind kind { Kind::ReturnValue };

    bool isOnce()
    {
        auto secondField = internalField(1).get();
        if (secondField.isNumber() && secondField.asInt32() == 1) {
            return true;
        }
        return jsDynamicCast<JSMockImplementation*>(secondField);
    }

    JSMockImplementation(JSC::VM& vm, JSC::Structure* structure, Kind kind)
        : Base(vm, structure)
        , kind(kind)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSValue first, JSC::JSValue second)
    {
        Base::finishCreation(vm);
        this->internalField(0).set(vm, this, first);
        this->internalField(1).set(vm, this, second);
    }
};

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

extern Structure* createMockResultStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        2);
    JSC::PropertyOffset offset;
    auto& vm = globalObject->vm();

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
    JSC::Structure* structure = globalObject->JSMockResultStructure();

    JSC::JSObject* result = JSC::constructEmptyObject(vm, structure, 2);
    result->putDirectOffset(vm, 0, jsString(vm, type));
    result->putDirectOffset(vm, 1, value);
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionCall, (JSGlobalObject * globalObject, CallFrame* callframe))
{
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
        if (JSValue nextValue = impl->internalField(1).get()) {
            if (nextValue.inherits<JSMockImplementation*>() || (nextValue.isInt32() && nextValue.asInt32() == 1)) {
                fn->implementation.set(vm, fn, nextValue);
            }
        }

        unsigned int returnValueIndex = 0;
        auto setReturnValue = [&](JSC::JSValue value) -> {
            if (auto* returnValuesArray = fn->returnValue.get()) {
                returnValuesArray->push(globalObject, value);
                returnValueIndex = returnValuesArray->length() - 1;
            } else {
                JSC::ObjectInitializationScope object(vm);
                returnValuesArray = JSC::JSArray::tryCreateUninitializedRestricted(
                    object,
                    globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                    1);
                returnValuesArray->initializeIndex(object, 0, value);
                fn->returnValue.set(vm, fn, returnValuesArray);
            }
        };

        switch (impl->kind) {
        case JSMockImplementation::Kind::Call: {
            JSValue result = impl->internalField(0).get();
            JSC::CallData callData = JSC::getCallData(result);
            if (UNLIKELY(callData.type == JSC::CallData::Type::None)) {
                throwTypeError(globalObject, scope, "Expected mock implementation to be callable"_s);
                return {};
            }

            setReturnValue(createMockResult(vm, globalObject, "incomplete"_s, jsUndefined()));

            WTF::NakedPtr<JSC::Exception> exception;

            JSValue returnValue = call(globalObject, result, callData, thisValue, args, exception);

            if (auto* exc = exception.get()) {
                if (auto* returnValuesArray = fn->returnValue.get()) {
                    returnValuesArray->putDirectIndex(globalObject, returnValueIndex, createMockResult(vm, globalObject, "throw"_s, exc->value()));
                    fn->returnValue.set(vm, fn, returnValuesArray);
                    JSC::throwException(globalObject, throwScope, exc);
                    return {};
                }
            }

            if (UNLIKELY(!returnValue)) {
                returnValue = jsUndefined();
            }

            if (auto* returnValuesArray = fn->returnValue.get()) {
                returnValuesArray->putDirectIndex(globalObject, returnValueIndex, createMockResult(vm, globalObject, "return"_s, returnValue));
                fn->returnValue.set(vm, fn, returnValuesArray);
            }

            return JSValue::encode(returnValue);
        }
        case JSMockImplementation::Kind::ReturnValue:
        case JSMockImplementation::Kind::Promise: {
            JSValue returnValue = impl->internalField(0).get();
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

static void pushImplInternal(JSMockFunction* fn, JSGlobalObject* jsGlobalObject, JSMockImplementation::Kind kind, JSValue value, bool isOnce)
{
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(jsGlobalObject);
    auto& vm = globalObject->vm();
    JSValue currentTail = fn->tail.get();
    JSMockImplementation* impl = JSMockImplementation::create(globalObject, globalObject->JSMockImplementationStructure(), kind, value, isOnce);
    JSValue currentImpl = fn->implementation.get();
    if (currentTail) {
        if (auto* current = jsDynamicCast<JSMockImplementation*>(currentTail)) {
            current->internalField(1).set(vm, current, impl);
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
            RELEASE_AND_RETURN(scope, JSValue::encode(implementation->internalField(0).get()));
        }
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
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
            JSObject* object = impl->internalField(0).get().asCell()->getObject();
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
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockImplementation, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockImplementationOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    JSValue arg = callframe->argument(0);

    if (callframe->argumentCount() < 1 || arg.isEmpty() || arg.isUndefined()) {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, jsUndefined());
    } else if (arg.isCallable()) {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::Call, arg);
    } else {
        throwTypeError(globalObject, scope, "Expected a function or undefined"_s);
        RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
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

    if (callframe->argumentCount() < 1) {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, jsUndefined());
    } else {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));
    }

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

    if (callframe->argumentCount() < 1) {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, jsUndefined());
    } else {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));
    }

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

    if (callframe->argumentCount() < 1) {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::resolvedPromise(globalObject, jsUndefined()));
    } else {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::resolvedPromise(globalObject, callframe->argument(0)));
    }

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

    if (callframe->argumentCount() < 1) {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::resolvedPromise(globalObject, jsUndefined()));
    } else {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::resolvedPromise(globalObject, callframe->argument(0)));
    }

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

    if (callframe->argumentCount() < 1) {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::rejectedPromise(globalObject, jsUndefined()));
    } else {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::rejectedPromise(globalObject, callframe->argument(0)));
    }

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

    if (callframe->argumentCount() < 1) {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::rejected(globalObject, jsUndefined()));
    } else {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::Promise, JSC::JSPromise::resolvedPromise(globalObject, callframe->argument(0)));
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}

}
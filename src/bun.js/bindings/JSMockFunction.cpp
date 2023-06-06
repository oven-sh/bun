#include "JSMockFunction.h"

namespace Bun {

class JSMockImplementation final : public JSC::JSInternalFieldObjectImpl<2> {
public:
    enum class Kind : uint8_t {
        Call,
        Promise,
        ReturnValue,
        ThrowValue,
        ReturnThis,
    };

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
            jsUndefined(),
        } };
    }

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    Kind kind { Kind::ReturnValue };

    JSMockImplementation(JSC::VM& vm, JSC::Structure* structure, Kind kind)
        : Base(vm, structure)
        , kind(kind)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSValue, JSC::JSValue, JSC::JSValue);
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

JSC_DECLARE_CUSTOM_GETTER(jsMockFunctionGetter_protoImpl);
JSC_DECLARE_CUSTOM_GETTER(jsMockFunctionGetter_mock);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionGetMockImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionGetMockName);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockClear);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReset);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockRestore);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockImplementationOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionWithImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionWithImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockName);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReturnThis);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReturnValue);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReturnValueOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockResolvedValue);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockResolvedValueOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockRejectedValue);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockRejectedValueOnce);

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

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->implementation()));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionGetMockName, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
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

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionWithImplementation, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
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
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnThis, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSMockFunction* thisObject = jsDynamicCast<JSMockFunction*>(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!thisObject)) {
        throwTypeError(globalObject, scope, "Expected Mock"_s);
    }

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

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}

}
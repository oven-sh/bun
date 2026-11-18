#pragma once

// Function objects.

#include "engine/api/Source.h"

namespace JSC {

// Only the global object is an object. The other scopes are cells that C++ passes on.
class JSScope : public JSDestructibleObject {
public:
    using Base = JSDestructibleObject;

    JSScope* next();

protected:
    using Base::Base;
};

class JSCallee : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    JSScope* scope() const { return m_scope; }

protected:
    JSCallee(VM& vm, JSScope* scope, Structure* structure)
        : Base(vm, structure)
        , m_scope(scope)
    {
    }

    JSScope* m_scope;
};

class JSFunction : public JSCallee {
public:
    using Base = JSCallee;

    ENGINE_DECLARE_CLASS(Function)

    static constexpr unsigned StructureFlags = Engine::Layout::functionFlags;

    template<typename CellType, SubspaceAccess> static IsoSubspace* subspaceFor(VM& vm)
    {
        static_assert(CellType::needsDestruction == DoesNotNeedDestruction);
        return &vm.heap.cellSpace().allocatorFor<sizeof(CellType)>();
    }

    static CallData getCallData(JSCell* cell) { return JSC::getCallData(cell); }
    static CallData getConstructData(JSCell* cell) { return JSC::getConstructData(cell); }
    static bool put(JSCell*, JSGlobalObject*, PropertyName, JSValue, PutPropertySlot&) ENGINE_SYMBOL(engine_Function_put);
    static bool deleteProperty(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&) ENGINE_SYMBOL(engine_Function_delete_property);
    using JSObject::deleteProperty;
    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, PropertyName, PropertySlot&) ENGINE_SYMBOL(engine_Function_get_own_property_slot);
    static void getOwnSpecialPropertyNames(JSObject*, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode) ENGINE_SYMBOL(engine_Function_own_special_property_names);
    static bool defineOwnProperty(JSObject*, JSGlobalObject*, PropertyName, const PropertyDescriptor&, bool shouldThrow) ENGINE_SYMBOL(engine_Function_define_own_property);
    static bool preventExtensions(JSObject*, JSGlobalObject*) ENGINE_SYMBOL(engine_Function_prevent_extensions);
    ENGINE_DECLARE_VISIT_CHILDREN(Function);

    static JSFunction* create(VM&, JSGlobalObject* globalObject, unsigned length, const String& name, NativeFunction function, ImplementationVisibility visibility, Intrinsic intrinsic = NoIntrinsic, NativeFunction constructor = callHostFunctionAsConstructor)
    {
        return Engine::function_create_native(globalObject, length, name, function, constructor, intrinsic, visibility);
    }
    static JSFunction* create(VM&, JSGlobalObject* globalObject, FunctionExecutable* executable, JSScope* scope) { return Engine::function_create(globalObject, executable, scope); }
    static JSFunction* create(VM& vm, JSGlobalObject*, FunctionExecutable* executable, JSScope* scope, Structure* structure) { return Engine::function_create_with_shape(vm, executable, scope, structure); }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype) { return Structure::create(vm, globalObject, prototype, TypeInfo(JSFunctionType, StructureFlags), info()); }

    ExecutableBase* executable() const
    {
        if (m_executableOrRareData->type() == FunctionRareDataType)
            return Engine::fieldAt<ExecutableBase*>(m_executableOrRareData, Engine::Layout::FunctionRareData_executable);
        return reinterpret_cast<ExecutableBase*>(m_executableOrRareData);
    }
    FunctionExecutable* jsExecutable() const
    {
        ASSERT(!isHostFunction());
        return reinterpret_cast<FunctionExecutable*>(executable());
    }
    TaggedNativeFunction nativeFunction() const
    {
        ASSERT(isHostFunction());
        return Engine::fieldAt<NativeFunction>(executable(), Engine::Layout::NativeExecutable_function);
    }
    bool isHostFunction() const { return reinterpret_cast<JSCell*>(executable())->type() == NativeExecutableType; }
    bool isNonBoundHostFunction() const;
    bool isHostOrBuiltinFunction() const { return Engine::function_is_native_or_builtin(this); }
    bool isBuiltinFunction() const { return !isHostFunction() && isHostOrBuiltinFunction(); }
    Intrinsic intrinsic() const { return Engine::function_intrinsic(this); }

    String name(VM&) { return Engine::function_name(this); }
    String nameWithoutGC(VM&) { return Engine::function_name(this); }
    void setFunctionName(JSGlobalObject* globalObject, JSValue name) { Engine::function_set_name(this, globalObject, name); }
    std::optional<SourceCode> sourceCode() const;

protected:
    JSFunction(VM& vm, NativeExecutable* executable, JSGlobalObject* globalObject, Structure* structure)
        : Base(vm, reinterpret_cast<JSScope*>(globalObject), structure)
        , m_executableOrRareData(reinterpret_cast<JSCell*>(executable))
    {
    }

private:
    static void checkLayout();

    JSCell* m_executableOrRareData;
};
ENGINE_CLASS_HAS_TYPE(JSFunction, JSFunctionType);

inline void JSFunction::checkLayout()
{
    ENGINE_CHECK_SIZE(JSFunction, sizeOfJsFunction);
    ENGINE_CHECK_OFFSET(JSFunction, m_scope, JsFunction_scope);
    ENGINE_CHECK_OFFSET(JSFunction, m_executableOrRareData, JsFunction_target);
}

inline String getCalculatedDisplayName(VM&, JSObject* object) { return Engine::function_display_name(object); }

inline JSFunction* JSObject::putDirectBuiltinFunction(VM& vm, JSGlobalObject* globalObject, const PropertyName& name, BuiltinCode code, unsigned attributes)
{
    auto* function = JSFunction::create(vm, globalObject, code, reinterpret_cast<JSScope*>(globalObject));
    putDirect(vm, name, function, attributes);
    return function;
}

inline JSFunction* JSObject::putDirectBuiltinFunctionWithoutTransition(VM& vm, JSGlobalObject* globalObject, const PropertyName& name, BuiltinCode code, unsigned attributes)
{
    auto* function = JSFunction::create(vm, globalObject, code, reinterpret_cast<JSScope*>(globalObject));
    putDirectWithoutTransition(vm, name, function, attributes);
    return function;
}

inline void JSObject::putDirectNativeFunctionWithoutTransition(VM& vm, JSGlobalObject* globalObject, const PropertyName& name, unsigned length, NativeFunction function, ImplementationVisibility visibility, Intrinsic intrinsic, unsigned attributes)
{
    putDirectWithoutTransition(vm, name, JSFunction::create(vm, globalObject, length, name.isSymbol() ? "anonymous"_s : String(name.publicName()), function, visibility, intrinsic), attributes);
}

class JSBoundFunction final : public JSFunction {
public:
    ENGINE_DECLARE_CLASS(BoundFunction)

    // `length` may be NaN and `name` null for them to follow from the target.
    static JSBoundFunction* create(VM&, JSGlobalObject* globalObject, JSObject* target, JSValue boundThis, ArgList arguments, double length, JSString* name, SourceTaintedOrigin) { return Engine::bound_function_create(globalObject, target, boundThis, arguments.span(), length, name); }
    static JSBoundFunction* create(VM&, JSGlobalObject* globalObject, JSObject* target, JSValue boundThis, ArgList arguments, double length, JSString* name, const SourceCode&) { return Engine::bound_function_create(globalObject, target, boundThis, arguments.span(), length, name); }

    JSObject* targetFunction() const { return Engine::fieldAt<JSObject*>(this, Engine::Layout::JsBoundFunction_target_function); }
    JSValue boundThis() const { return Engine::fieldAt<JSValue>(this, Engine::Layout::JsBoundFunction_bound_this); }
};

inline bool JSFunction::isNonBoundHostFunction() const { return isHostFunction() && !inherits<JSBoundFunction>(); }

using NativeStdFunction = Function<EncodedJSValue(JSGlobalObject*, CallFrame*)>;

// A function whose code is a closure.
class JSNativeStdFunction final : public JSFunction {
public:
    using Base = JSFunction;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static constexpr DestructionMode needsDestruction = NeedsDestruction;
    static void destroy(JSCell* cell) { static_cast<JSNativeStdFunction*>(cell)->~JSNativeStdFunction(); }
    template<typename, SubspaceAccess> static IsoSubspace* subspaceFor(VM& vm) { return &subspace(vm); }

    static JSNativeStdFunction* create(VM&, JSGlobalObject*, unsigned length, const String& name, NativeStdFunction&&, Intrinsic = NoIntrinsic, NativeFunction constructor = callHostFunctionAsConstructor);
    // Keeps the values that the closure refers to alive.
    template<typename... Values>
        requires(sizeof...(Values) > 0 && ((std::convertible_to<Values, JSCell*> || std::same_as<Values, JSValue>) && ...))
    static JSNativeStdFunction* create(VM& vm, JSGlobalObject* globalObject, unsigned length, const String& name, NativeStdFunction&& function, Values... captured)
    {
        static_assert(sizeof...(Values) <= maxCaptures);
        auto* result = create(vm, globalObject, length, name, WTF::move(function));
        auto* field = result->m_captures;
        ((field++)->set(vm, result, captured), ...);
        return result;
    }

    const NativeStdFunction& function() const { return m_function; }

private:
    static constexpr size_t maxCaptures = 2;

    JSNativeStdFunction(VM& vm, NativeExecutable* executable, JSGlobalObject* globalObject, Structure* structure, NativeStdFunction&& function)
        : Base(vm, executable, globalObject, structure)
        , m_function(WTF::move(function))
    {
    }

    static IsoSubspace& subspace(VM&);

    NativeStdFunction m_function;
    WriteBarrier<Unknown> m_captures[maxCaptures];
};

// A native function that is a class of its own, such as a constructor.
class InternalFunction : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    ENGINE_DECLARE_CLASS(InternalFunction)

    static constexpr unsigned StructureFlags = Engine::Layout::internalFunctionFlags;

    template<typename CellType, SubspaceAccess> static IsoSubspace* subspaceFor(VM& vm)
    {
        static_assert(sizeof(CellType) == sizeof(InternalFunction));
        return &vm.internalFunctionSpace();
    }

    static CallData getCallData(JSCell* cell) { return JSC::getCallData(cell); }
    static CallData getConstructData(JSCell* cell) { return JSC::getConstructData(cell); }
    ENGINE_DECLARE_VISIT_CHILDREN(InternalFunction);

    // Like `base`, but for instances of `newTarget`.
    static Structure* createSubclassStructure(JSGlobalObject* globalObject, JSObject* newTarget, Structure* base) { return Engine::subclass_shape(globalObject, newTarget, base); }

    JSGlobalObject* globalObject() const { return m_globalObject; }
    String name() { return m_originalName ? m_originalName->tryGetValue().data : String(); }

protected:
    enum class PropertyAdditionMode { WithStructureTransition,
        WithoutStructureTransition };

    InternalFunction(VM& vm, Structure* structure, NativeFunction functionForCall, NativeFunction functionForConstruct = nullptr, Butterfly* butterfly = nullptr)
        : Base(vm, structure, butterfly)
        , m_globalObject(structure->realm())
        , m_executable(vm.internalFunctionExecutable())
        , m_functionForCall(functionForCall)
        , m_functionForConstruct(functionForConstruct ? functionForConstruct : NativeFunction(callHostFunctionAsConstructor))
    {
    }

    DECLARE_DEFAULT_FINISH_CREATION;
    void finishCreation(VM& vm, unsigned length, const String& name, PropertyAdditionMode mode = PropertyAdditionMode::WithStructureTransition)
    {
        Base::finishCreation(vm);
        Engine::internal_function_finish_creation(this, vm, length, name, mode == PropertyAdditionMode::WithStructureTransition);
    }

private:
    static void checkLayout();

    JSGlobalObject* m_globalObject;
    ExecutableBase* m_executable;
    NativeFunction m_functionForCall;
    NativeFunction m_functionForConstruct;

protected:
    WriteBarrier<JSString> m_originalName;
};
ENGINE_CLASS_HAS_TYPE(InternalFunction, InternalFunctionType);

inline void InternalFunction::checkLayout()
{
    ENGINE_CHECK_SIZE(InternalFunction, sizeOfInternalFunction);
    ENGINE_CHECK_OFFSET(InternalFunction, m_globalObject, InternalFunction_global);
    ENGINE_CHECK_OFFSET(InternalFunction, m_executable, InternalFunction_executable);
    ENGINE_CHECK_OFFSET(InternalFunction, m_functionForCall, InternalFunction_function);
    ENGINE_CHECK_OFFSET(InternalFunction, m_functionForConstruct, InternalFunction_constructor);
    ENGINE_CHECK_OFFSET(InternalFunction, m_originalName, InternalFunction_original_name);
}

inline JSGlobalObject* getFunctionRealm(JSGlobalObject* globalObject, JSObject* function) { return Engine::function_realm(globalObject, function); }
// Null where getFunctionRealm() throws.
inline JSGlobalObject* tryGetFunctionRealm(JSObject* function) { return Engine::function_realm_if_any(function); }

} // namespace JSC

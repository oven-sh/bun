#include "engine/Engine.h"

namespace JSC {

bool isCanonicalNumericIndexString(UniquedStringImpl* name)
{
    return name && !name->isSymbol() && Engine::is_canonical_numeric_index(*name);
}

#if ASSERT_ENABLED
// The engine goes by the type and the flags, and looks at the class only if they say so.
void Structure::assertThatTypeInfoSuitsClass() const
{
    auto* info = classInfoForCells();
    auto has = [&](unsigned flag) { return !!(typeInfo().flags() & flag); };
    bool hasStaticTable = false;
    for (auto* ancestor = info; ancestor; ancestor = ancestor->parentClass)
        hasStaticTable |= !!ancestor->staticPropHashTable;
    ASSERT(hasStaticTable == has(HasStaticPropertyTable));
    ASSERT(typeInfo().isObject() == info->isSubClassOf(JSObject::info()));
    if (!typeInfo().isObject())
        return;

    for (auto* engineClass : { JSFinalObject::info(), JSFunction::info(), InternalFunction::info(), ErrorInstance::info(), JSGlobalObject::info(), JSArray::info(), JSPromise::info() })
        ASSERT(engineClass->types.contains(typeInfo().type()) == info->isSubClassOf(engineClass));

    // The engine has described its own classes.
    if (info->types.first != StructureType)
        return;
    auto& methods = info->methodTable;
    auto& ordinary = JSObject::info()->methodTable;
    ASSERT(has(OverridesGetCallData) == (methods.fillCallData != &MethodTable::fill<&JSCell::getCallData>));
    ASSERT(has(OverridesGetOwnPropertySlot) || methods.getOwnPropertySlot == ordinary.getOwnPropertySlot);
    ASSERT(has(InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero) || methods.getOwnPropertySlotByIndex == ordinary.getOwnPropertySlotByIndex);
    ASSERT(has(OverridesGetOwnPropertyNames) == (methods.getOwnPropertyNames != ordinary.getOwnPropertyNames));
    ASSERT(has(OverridesGetOwnSpecialPropertyNames) == (methods.getOwnSpecialPropertyNames != &JSCell::getOwnSpecialPropertyNames));
    ASSERT(has(OverridesGetPrototype) == (methods.getEncodedPrototype != &MethodTable::encode<&JSObject::getPrototype>));
    ASSERT(has(OverridesPut) == (methods.put != ordinary.put));
    ASSERT(has(OverridesIsExtensible) == (methods.isExtensible != ordinary.isExtensible));
}
#endif

void LazyClassStructure::Initializer::setPrototype(JSObject* value)
{
    RELEASE_ASSERT(!prototype && !structure && !constructor);
    prototype = value;
}

void LazyClassStructure::Initializer::setStructure(Structure* value)
{
    RELEASE_ASSERT(!structure && !constructor);
    structure = value;
    structureInit.set(structure);
    if (!prototype)
        prototype = structure->storedPrototypeObject();
}

void LazyClassStructure::Initializer::setConstructor(JSObject* value)
{
    RELEASE_ASSERT(structure && prototype && !constructor);
    constructor = value;
    prototype->putDirectWithoutTransition(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));
    classStructure.m_constructor.set(vm, global, constructor);
}

JSValue call(JSGlobalObject* globalObject, JSValue function, const CallData& callData, JSValue thisValue, const ArgList& arguments, NakedPtr<Exception>& returnedException)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    JSValue result = call(globalObject, function, callData, thisValue, arguments);
    if (auto* exception = scope.exception()) [[unlikely]] {
        returnedException = exception;
        scope.clearException();
        return jsUndefined();
    }
    return result;
}

JSValue call(JSGlobalObject* globalObject, JSValue function, JSValue thisValue, const ArgList& arguments, ASCIILiteral errorMessage)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (!function.isCallable()) [[unlikely]]
        return throwTypeError(globalObject, scope, errorMessage);
    RELEASE_AND_RETURN(scope, call(globalObject, function, CallData(), thisValue, arguments));
}

JSObject* construct(JSGlobalObject* globalObject, const JSValue& constructor, const JSValue& newTarget, const ArgList& arguments, ASCIILiteral errorMessage)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (!constructor.isConstructor()) [[unlikely]] {
        throwTypeError(globalObject, scope, errorMessage);
        return nullptr;
    }
    RELEASE_AND_RETURN(scope, construct(globalObject, constructor, CallData(), arguments, newTarget));
}

const ClassInfo JSNativeStdFunction::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNativeStdFunction) };

template<typename Visitor>
void JSNativeStdFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Base::visitChildren(cell, visitor);
    for (auto& captured : static_cast<JSNativeStdFunction*>(cell)->m_captures)
        visitor.append(captured);
}

DEFINE_VISIT_CHILDREN(JSNativeStdFunction);

IsoSubspace& JSNativeStdFunction::subspace(VM& vm)
{
    if (!vm.m_nativeStdFunctionSpace)
        vm.m_nativeStdFunctionSpace = &vm.heap.createIsoSubspace(sizeof(JSNativeStdFunction), destroy, false);
    return *vm.m_nativeStdFunctionSpace;
}

static EncodedJSValue SYSV_ABI callNativeStdFunction(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    return uncheckedDowncast<JSNativeStdFunction>(callFrame->jsCallee())->function()(globalObject, callFrame);
}

JSNativeStdFunction* JSNativeStdFunction::create(VM& vm, JSGlobalObject* globalObject, unsigned length, const String& name, NativeStdFunction&& function, Intrinsic intrinsic, NativeFunction constructor)
{
    auto* executable = vm.getHostFunction(callNativeStdFunction, ImplementationVisibility::Private, intrinsic, constructor, length, name);
    auto* structure = Engine::shape_for_class(globalObject, globalObject->functionPrototype(), JSFunctionType, StructureFlags, info());
    auto* result = new (NotNull, allocateCell<JSNativeStdFunction>(vm)) JSNativeStdFunction(vm, executable, globalObject, structure, WTF::move(function));
    result->finishCreation(vm);
    return result;
}

} // namespace JSC

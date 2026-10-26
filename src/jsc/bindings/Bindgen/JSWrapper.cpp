#include "root.h"
#include "Bindgen/JSWrapper.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSCInlines.h>

namespace Bun::Bindgen {
using namespace JSC;

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClassConstructor, InternalFunction);
STATIC_ASSERT_IS_TRIVIALLY_DESTRUCTIBLE(JSClassConstructor);
static_assert(Counts::maxCellSize <= MarkedSpace::largeCutoff);

NEVER_INLINE GCClient::IsoSubspace* createSubspaceForClass(VM& vm, unsigned classIndex, size_t cellSize)
{
    return WebCore::subspaceForImplSlow(
        vm,
        WebCore::SubspaceForInit { static_cast<unsigned>(cellSize), JSDestructibleObject::numberOfLowerTierPreciseCells, WebCore::SubspaceForInit::CellType::Destructible, false },
        WebCore::SubspaceSlots {
            OBJECT_OFFSETOF(WebCore::ExtendedDOMClientIsoSubspaces, m_clientSubspaceForBindgenClass) + classIndex * sizeof(GCClient::IsoSubspace*),
            OBJECT_OFFSETOF(WebCore::ExtendedDOMIsoSubspaces, m_subspaceForBindgenClass) + classIndex * sizeof(IsoSubspace*),
        },
        nullptr);
}

void analyzeInternalField(JSCell* cell, HeapAnalyzer& analyzer, JSValue field, ASCIILiteral name)
{
    if (field && field.isCell())
        analyzer.analyzePropertyNameEdge(cell, field.asCell(), Identifier::fromString(cell->vm(), name).impl());
}

const ClassInfo JSClassConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClassConstructor) };

JSC_DEFINE_HOST_FUNCTION(callJSClassConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSClassConstructor>(callFrame->jsCallee());
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, makeString(constructor->name(), " constructor cannot be invoked without 'new'"_s));
}

JSC_DEFINE_HOST_FUNCTION(illegalConstructor, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

JSClassConstructor::JSClassConstructor(VM& vm, Structure* structure, NativeFunction call, NativeFunction construct)
    : Base(vm, structure, call, construct)
{
}

JSClassConstructor* JSClassConstructor::create(VM& vm, JSGlobalObject* globalObject, ASCIILiteral name, NativeFunction call, NativeFunction construct, unsigned length, std::span<const HashTableValue> tableValues, JSObject* prototype)
{
    auto* structure = createStructure(vm, globalObject, globalObject->functionPrototype());
    auto* constructor = new (NotNull, allocateCell<JSClassConstructor>(vm)) JSClassConstructor(vm, structure, call, construct);
    constructor->finishCreation(vm, length, name, PropertyAdditionMode::WithoutStructureTransition);
    // Reifying makes the structure a dictionary, even for no properties.
    if (!tableValues.empty())
        Bun::reifyStaticPropertyTable(vm, info(), tableValues, *constructor);
    constructor->putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    return constructor;
}

JSObject* createClassPrototype(VM& vm, JSGlobalObject* globalObject, JSObject* prototypeBase, const ClassInfo* info, std::span<const HashTableValue> tableValues)
{
    auto* structure = JSFinalObject::createStructure(vm, globalObject, prototypeBase, 0);
    structure->setMayBePrototype(true);
    JSObject* prototype = JSFinalObject::create(vm, structure);
    Bun::reifyStaticPropertyTable(vm, info, tableValues, *prototype);
    return prototype;
}

Structure* structureForClass(JSGlobalObject* globalObject, unsigned classIndex)
{
    auto* global = defaultGlobalObject(globalObject);
    return global->m_bindgenAdditions.m_classes[classIndex].get(global);
}

JSObject* prototypeForClass(JSGlobalObject* globalObject, unsigned classIndex)
{
    auto* global = defaultGlobalObject(globalObject);
    return global->m_bindgenAdditions.m_classes[classIndex].prototype(global);
}

JSObject* constructorForClass(JSGlobalObject* globalObject, unsigned classIndex)
{
    auto* global = defaultGlobalObject(globalObject);
    return global->m_bindgenAdditions.m_classes[classIndex].constructor(global);
}

Structure* structureForNewTarget(JSGlobalObject* globalObject, CallFrame* callFrame, unsigned classIndex)
{
    // JSC_GET_DERIVED_STRUCTURE, for a Structure that is not a member of the global object.
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget == callFrame->jsCallee()) [[likely]] {
        // A Zig::GlobalObject created the callee, and holds `m_classes`.
        auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
        return global->m_bindgenAdditions.m_classes[classIndex].get(global);
    }
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* functionGlobalObject = tryGetFunctionRealm(newTarget);
    if (!functionGlobalObject)
        functionGlobalObject = globalObject;
    RELEASE_AND_RETURN(scope, InternalFunction::createSubclassStructure(globalObject, newTarget, structureForClass(functionGlobalObject, classIndex)));
}

}

extern "C" JSC::EncodedJSValue Bun__Bindgen__constructorForClass(JSC::JSGlobalObject* globalObject, uint32_t classIndex)
{
    return JSC::JSValue::encode(Bun::Bindgen::constructorForClass(globalObject, classIndex));
}

// The payload was written after `finishCreation`: the fence of ~ObjectInitializationScope.
extern "C" void Bun__Bindgen__notifyInitialized(JSC::JSGlobalObject* globalObject, JSC::JSCell* cell, size_t extraMemorySize)
{
    auto& vm = JSC::getVM(globalObject);
    vm.mutatorFence();
    vm.heap.reportExtraMemoryAllocated(cell, extraMemorySize);
}

extern "C" void Bun__Bindgen__setInternalField(JSC::JSGlobalObject* globalObject, JSC::JSCell* cell, uint32_t offset, JSC::EncodedJSValue value)
{
    auto* field = reinterpret_cast<JSC::WriteBarrier<JSC::Unknown>*>(reinterpret_cast<uint8_t*>(cell) + offset);
    field->set(JSC::getVM(globalObject), cell, JSC::JSValue::decode(value));
}

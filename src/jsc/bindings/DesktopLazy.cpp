#include "root.h"

#include "DesktopLazy.h"

#include "BunClientData.h"

#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

using namespace JSC;

static constexpr unsigned accessorFamilies = 4;

static const Identifier& loaderName(VM& vm) { return WebCore::builtinNames(vm).attributesPrivateName(); }
static const Identifier& familiesName(VM& vm) { return WebCore::builtinNames(vm).transformPrivateName(); }

bool isUsedByLazyProperties(VM& vm, PropertyName name)
{
    return name == loaderName(vm) || name == familiesName(vm);
}

// Compiled programs remember nothing about a custom value, and have no compiler thread that reads the structure.
void replaceLazyProperty(VM& vm, JSObject* object, PropertyName name, JSValue value, unsigned attributes)
{
    unsigned before = 0;
    PropertyOffset offset = object->getDirectOffset(vm, name, before);
    if (!vm.hasCompiledCode() || !object->isGlobalObject() || !(before & PropertyAttribute::CustomValue)) {
        object->putDirect(vm, name, value, attributes);
        return;
    }
    object->structure()->attributeChangeWithoutTransition(vm, name, attributes, [](const GCSafeConcurrentJSLocker&, PropertyOffset, PropertyOffset) {});
    object->putDirectOffset(vm, offset, value);
    vm.invalidateStructureChainIntegrity(VM::StructureChainIntegrityEvent::Change, object, name.uid());
}

void putOrReplaceCustomAccessor(VM& vm, JSObject* object, PropertyName name, JSValue accessor, unsigned attributes)
{
    Structure* structure = object->structure();
    PropertyOffset offset = structure->isCompiledStructure() || structure->isImmutableProperty(name.uid()) ? invalidOffset : structure->get(vm, name);
    if (!isValidOffset(offset)) {
        object->putDirectCustomAccessor(vm, name, accessor, attributes);
        return;
    }
    object->putDirectOffset(vm, offset, accessor);
    structure->didReplaceProperty(offset);
    {
        DeferredStructureTransitionWatchpointFire deferred(vm, structure);
        object->setStructure(vm, Structure::attributeChangeTransition(vm, structure, name, attributes, &deferred));
        if (object->mayBePrototype())
            vm.invalidateStructureChainIntegrity(VM::StructureChainIntegrityEvent::Change, object, name.uid());
    }
    structure = object->structure();
    if (attributes & PropertyAttribute::ReadOnly)
        structure->setContainsReadOnlyProperties();
    structure->setHasAnyKindOfGetterSetterPropertiesWithProtoCheck(name == vm.propertyNames->underscoreProto);
}

static JSValue callWith(JSGlobalObject* globalObject, JSValue function, std::initializer_list<JSValue> values)
{
    MarkedArgumentBuffer arguments;
    for (JSValue value : values)
        arguments.append(value);
    return call(globalObject, function, getCallData(function), jsUndefined(), arguments);
}

static void defineAll(JSGlobalObject* globalObject, JSObject* object, JSValue names, CustomGetterSetter* accessor, unsigned attributes)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* array = uncheckedDowncast<JSArray>(names);
    std::optional<ChangesInPlace> inPlace;
    if (object->isGlobalObject() || object->type() == FinalObjectType)
        inPlace.emplace(vm, object);
    for (unsigned i = 0; i < array->length(); i++) {
        JSValue name = array->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, );
        Identifier identifier = asString(name)->toIdentifier(globalObject);
        RETURN_IF_EXCEPTION(scope, );
        putOrReplaceCustomAccessor(vm, object, identifier, accessor, attributes);
    }
}

JSC_DEFINE_CUSTOM_GETTER(desktopLazyValue, (JSGlobalObject * globalObject, EncodedJSValue holder, PropertyName name))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = asObject(JSValue::decode(holder));
    JSValue value = callWith(globalObject, object->getDirect(vm, loaderName(vm)), { jsString(vm, String(name.uid())) });
    RETURN_IF_EXCEPTION(scope, {});
    replaceLazyProperty(vm, object, name, value, static_cast<unsigned>(PropertyAttribute::DontEnum));
    return JSValue::encode(value);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopDefineLazyValues, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    JSObject* object = asObject(callFrame->uncheckedArgument(0));
    if (object->type() == GlobalProxyType)
        object = uncheckedDowncast<JSGlobalProxy>(object)->target();
    object->putDirect(vm, loaderName(vm), callFrame->uncheckedArgument(2));
    defineAll(globalObject, object, callFrame->uncheckedArgument(1), CustomGetterSetter::create(vm, desktopLazyValue, nullptr), PropertyAttribute::CustomValue | PropertyAttribute::DontEnum);
    return JSValue::encode(jsUndefined());
}

static JSValue familyMember(JSGlobalObject* globalObject, unsigned index)
{
    VM& vm = globalObject->vm();
    return asObject(globalObject->getDirect(vm, familiesName(vm)))->getIndexQuickly(index);
}

template<unsigned family>
static EncodedJSValue JIT_OPERATION_ATTRIBUTES getInFamily(JSGlobalObject* globalObject, EncodedJSValue receiver, PropertyName name)
{
    return JSValue::encode(callWith(globalObject, familyMember(globalObject, family * 2), { JSValue::decode(receiver), jsString(globalObject->vm(), String(name.uid())) }));
}

template<unsigned family>
static bool JIT_OPERATION_ATTRIBUTES setInFamily(JSGlobalObject* globalObject, EncodedJSValue receiver, EncodedJSValue value, PropertyName name)
{
    callWith(globalObject, familyMember(globalObject, family * 2 + 1), { JSValue::decode(receiver), jsString(globalObject->vm(), String(name.uid())), JSValue::decode(value) });
    return true;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopSetAccessorFamily, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue families = globalObject->getDirect(vm, familiesName(vm));
    if (!families) {
        families = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        for (unsigned i = 0; i < accessorFamilies * 2; i++) {
            asObject(families)->putDirectIndex(globalObject, i, jsNull());
            RETURN_IF_EXCEPTION(scope, {});
        }
        globalObject->putDirect(vm, familiesName(vm), families);
    }
    unsigned family = callFrame->uncheckedArgument(0).asUInt32();
    RELEASE_ASSERT(family < accessorFamilies);
    asObject(families)->setIndexQuickly(vm, family * 2, callFrame->uncheckedArgument(1));
    asObject(families)->setIndexQuickly(vm, family * 2 + 1, callFrame->uncheckedArgument(2));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopDefineAccessors, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    const std::array<CustomGetterSetter::CustomGetter, accessorFamilies> getters { getInFamily<0>, getInFamily<1>, getInFamily<2>, getInFamily<3> };
    const std::array<CustomGetterSetter::CustomSetter, accessorFamilies> setters { setInFamily<0>, setInFamily<1>, setInFamily<2>, setInFamily<3> };
    VM& vm = globalObject->vm();
    JSObject* object = asObject(callFrame->uncheckedArgument(0));
    if (object->type() == GlobalProxyType)
        object = uncheckedDowncast<JSGlobalProxy>(object)->target();
    unsigned family = callFrame->uncheckedArgument(2).asUInt32();
    RELEASE_ASSERT(family < accessorFamilies);
    if (JSGlobalObject* realm = object->structure()->realm(); realm != globalObject)
        realm->putDirect(vm, familiesName(vm), globalObject->getDirect(vm, familiesName(vm)));
    unsigned attributes = PropertyAttribute::CustomAccessor | (callFrame->uncheckedArgument(3).asBoolean() ? PropertyAttribute::None : PropertyAttribute::DontEnum);
    defineAll(globalObject, object, callFrame->uncheckedArgument(1), CustomGetterSetter::create(vm, getters[family], setters[family]), attributes);
    return JSValue::encode(jsUndefined());
}

} // namespace Bun

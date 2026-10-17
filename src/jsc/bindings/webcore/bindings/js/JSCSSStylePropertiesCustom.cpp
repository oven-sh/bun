#include "config.h"
#include "JSCSSStyleProperties.h"

#include "CSSPropertyNames.h"
#include "CustomElementReactionQueue.h"
#include "JSDOMAttribute.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/StructureCreateInlines.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {
using namespace JSC;

const ClassInfo JSCSSStylePropertiesPrototypeBase::s_info = { "CSSStyleProperties"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCSSStylePropertiesPrototypeBase) };

static JSC_DECLARE_CUSTOM_GETTER(jsCSSStyleProperties_property);
static JSC_DECLARE_CUSTOM_SETTER(setJSCSSStyleProperties_property);

static inline JSValue jsCSSStyleProperties_propertyGetter(JSGlobalObject& lexicalGlobalObject, JSCSSStyleProperties& thisObject, PropertyName propertyName)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    SUPPRESS_UNCOUNTED_LOCAL auto& impl = thisObject.wrapped();
    auto propertyID = CSSStyleProperties::getCSSPropertyIDFromJavaScriptPropertyName(propertyNameToAtomString(propertyName));
    RELEASE_AND_RETURN(throwScope, (toJS<IDLUSVString>(lexicalGlobalObject, throwScope, impl.getPropertyValueInternal(propertyID))));
}

JSC_DEFINE_CUSTOM_GETTER(jsCSSStyleProperties_property, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<JSCSSStyleProperties>::getPassingPropertyName<jsCSSStyleProperties_propertyGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline bool setJSCSSStyleProperties_propertySetter(JSGlobalObject& lexicalGlobalObject, JSCSSStyleProperties& thisObject, JSValue value, PropertyName propertyName)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    CustomElementReactionStack customElementReactionStack(lexicalGlobalObject);
    SUPPRESS_UNCOUNTED_LOCAL auto& impl = thisObject.wrapped();
    auto nativeValueConversionResult = convert<IDLLegacyNullToEmptyStringAdaptor<IDLUSVString>>(lexicalGlobalObject, value);
    if (nativeValueConversionResult.hasException(throwScope)) [[unlikely]]
        return false;
    auto propertyID = CSSStyleProperties::getCSSPropertyIDFromJavaScriptPropertyName(propertyNameToAtomString(propertyName));
    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setPropertyInternal(propertyID, nativeValueConversionResult.releaseReturnValue(), IsImportant::No);
    });
    return true;
}

JSC_DEFINE_CUSTOM_SETTER(setJSCSSStyleProperties_property, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName))
{
    return IDLAttribute<JSCSSStyleProperties>::setPassingPropertyName<setJSCSSStyleProperties_propertySetter>(*lexicalGlobalObject, thisValue, encodedValue, attributeName);
}

void JSCSSStylePropertiesPrototypeBase::reifyProperty(VM& vm, PropertyName propertyName)
{
    auto* accessor = CustomGetterSetter::create(vm, jsCSSStyleProperties_property, setJSCSSStyleProperties_property);
    putDirectCustomAccessor(vm, propertyName, accessor, static_cast<unsigned>(PropertyAttribute::CustomAccessor));
}

bool JSCSSStylePropertiesPrototypeBase::reifyPropertyIfNeeded(VM& vm, PropertyName propertyName)
{
    // Once they have all been made, one that is missing was deleted.
    if (staticPropertiesReified())
        return false;
    if (propertyName.isSymbol() || propertyName.isPrivateName())
        return false;
    if (CSSStyleProperties::getCSSPropertyIDFromJavaScriptPropertyName(propertyNameToAtomString(propertyName)) == CSSPropertyID::Invalid)
        return false;
    if (getDirectOffset(vm, propertyName) != invalidOffset)
        return false;
    reifyProperty(vm, propertyName);
    return true;
}

// https://drafts.csswg.org/cssom/#css-property-to-idl-attribute
static String cssPropertyToIDLAttribute(ASCIILiteral property, bool lowercaseFirst)
{
    StringBuilder output;
    bool uppercaseNext = false;
    auto characters = property.span8();
    if (lowercaseFirst)
        characters = characters.subspan(1);
    for (auto character : characters) {
        if (character == '-')
            uppercaseNext = true;
        else if (uppercaseNext) {
            uppercaseNext = false;
            output.append(toASCIIUpper(character));
        } else
            output.append(character);
    }
    return output.toString();
}

void JSCSSStylePropertiesPrototypeBase::reifyAllProperties(VM& vm)
{
    if (staticPropertiesReified())
        return;

    // A dictionary belongs to one object, so the flag set at the end is about this object only.
    if (!structure()->isDictionary())
        setStructure(vm, Structure::toCacheableDictionaryTransition(vm, structure()));

    auto reify = [&](const String& name) {
        auto identifier = Identifier::fromString(vm, name);
        if (getDirectOffset(vm, identifier) == invalidOffset)
            reifyProperty(vm, identifier);
    };

    for (unsigned i = 0; i < numCSSPropertyNames; ++i) {
        CSSPropertyID id;
        auto name = cssPropertyNameAt(i, id);
        reify(cssPropertyToIDLAttribute(name, false));
        if (name.span8().front() == '-')
            reify(cssPropertyToIDLAttribute(name, true));
        if (contains(name.span8(), '-'))
            reify(String { name });
    }

    structure()->setStaticPropertiesReified(true);
}

bool JSCSSStylePropertiesPrototypeBase::getOwnPropertySlot(JSObject* object, JSGlobalObject* lexicalGlobalObject, PropertyName propertyName, PropertySlot& slot)
{
    if (Base::getOwnPropertySlot(object, lexicalGlobalObject, propertyName, slot))
        return true;
    if (!uncheckedDowncast<JSCSSStylePropertiesPrototypeBase>(object)->reifyPropertyIfNeeded(JSC::getVM(lexicalGlobalObject), propertyName))
        return false;
    return Base::getOwnPropertySlot(object, lexicalGlobalObject, propertyName, slot);
}

void JSCSSStylePropertiesPrototypeBase::getOwnPropertyNames(JSObject* object, JSGlobalObject* lexicalGlobalObject, PropertyNameArrayBuilder& propertyNames, DontEnumPropertiesMode mode)
{
    uncheckedDowncast<JSCSSStylePropertiesPrototypeBase>(object)->reifyAllProperties(JSC::getVM(lexicalGlobalObject));
    Base::getOwnPropertyNames(object, lexicalGlobalObject, propertyNames, mode);
}

bool JSCSSStylePropertiesPrototypeBase::deleteProperty(JSCell* cell, JSGlobalObject* lexicalGlobalObject, PropertyName propertyName, DeletePropertySlot& slot)
{
    uncheckedDowncast<JSCSSStylePropertiesPrototypeBase>(cell)->reifyAllProperties(JSC::getVM(lexicalGlobalObject));
    return Base::deleteProperty(cell, lexicalGlobalObject, propertyName, slot);
}

// A store looks for a setter in the structures of the prototype chain, without asking getOwnPropertySlot(). So the accessor has to be there first.
bool JSCSSStyleProperties::put(JSCell* cell, JSGlobalObject* lexicalGlobalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    auto* thisObject = uncheckedDowncast<JSCSSStyleProperties>(cell);
    if (auto* prototype = dynamicDowncast<JSCSSStylePropertiesPrototypeBase>(thisObject->getPrototypeDirect()))
        prototype->reifyPropertyIfNeeded(JSC::getVM(lexicalGlobalObject), propertyName);
    return Base::put(cell, lexicalGlobalObject, propertyName, value, slot);
}

bool JSCSSStyleProperties::putByIndex(JSCell* cell, JSGlobalObject* lexicalGlobalObject, unsigned index, JSValue value, bool shouldThrow)
{
    return Base::putByIndex(cell, lexicalGlobalObject, index, value, shouldThrow);
}

} // namespace WebCore

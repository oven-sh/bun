#pragma once

#include "CustomElementReactionQueue.h"
#include "JSDOMConvertBase.h"
#include "JSDOMExceptionHandling.h"
#include "QualifiedName.h"
#include <JavaScriptCore/JSCJSValueInlines.h>

namespace WebCore {

class JSElement;

// The accessors of the attributes that reflect a content attribute ([Reflect] in the IDL) are alike but for the name of that attribute.
// The generator prints the whole work into each of them, some hundreds of bytes several hundred times. In Bun each one only calls
// the function here that does the work for its kind, with the name as an argument. The work is the generator's, line by line.

// Which member of the implementation an accessor calls. A type and not a pointer to member, so that the overloads for a StaticQualifiedName are found.
namespace ReflectedAttributeMember {
#define WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(name) \
    struct name { \
        template<typename Implementation, typename... Arguments> \
        static ALWAYS_INLINE decltype(auto) call(Implementation& implementation, Arguments&&... arguments) { return implementation.name(std::forward<Arguments>(arguments)...); } \
    };
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(attributeWithoutSynchronization)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(getURLAttributeForBindings)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(hasAttributeWithoutSynchronization)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(integralAttribute)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(numericAttribute)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(unsignedIntegralAttribute)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(setAttributeWithoutSynchronization)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(setBooleanAttribute)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(setElementAttribute)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(setElementsArrayAttribute)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(setIntegralAttribute)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(setNumericAttribute)
WEBCORE_REFLECTED_ATTRIBUTE_MEMBER(setUnsignedIntegralAttribute)
#undef WEBCORE_REFLECTED_ATTRIBUTE_MEMBER
}

// [CEReactions=Needed], [CEReactions=NotNeeded], or no [CEReactions].
enum class ReflectedAttributeReactions : uint8_t { Needed, NotNeeded, None };

namespace Detail {

template<ReflectedAttributeReactions> struct ReflectedAttributeReactionsScope;
template<> struct ReflectedAttributeReactionsScope<ReflectedAttributeReactions::Needed> {
    explicit ReflectedAttributeReactionsScope(JSC::JSGlobalObject& lexicalGlobalObject)
        : customElementReactionStack(lexicalGlobalObject)
    {
    }
    CustomElementReactionStack customElementReactionStack;
};
template<> struct ReflectedAttributeReactionsScope<ReflectedAttributeReactions::NotNeeded> {
    explicit ReflectedAttributeReactionsScope(JSC::JSGlobalObject&) { }
    CustomElementReactionDisallowedScope customElementReactionDisallowedScope;
};
template<> struct ReflectedAttributeReactionsScope<ReflectedAttributeReactions::None> {
    explicit ReflectedAttributeReactionsScope(JSC::JSGlobalObject&) { }
};

// Every wrapper of an element keeps its element where JSElement does, so one function serves all their classes.
template<typename JSClass> using ReflectedAttributeWrapper = std::conditional_t<std::is_base_of_v<JSElement, JSClass>, JSElement, JSClass>;

// JSC has tested the receiver: these are getters of rows with PropertyAttribute::DOMAttribute (CastedThisErrorBehavior::Assert in the generator's text).
template<typename JSWrapper, typename IDL, typename Member>
NEVER_INLINE JSC::EncodedJSValue reflectedAttribute(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue, StaticQualifiedName contentAttribute)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    SUPPRESS_UNCOUNTED_LOCAL auto& impl = uncheckedDowncast<JSWrapper>(JSC::JSValue::decode(thisValue))->wrapped();
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(toJS<IDL>(*lexicalGlobalObject, throwScope, Member::call(impl, contentAttribute))));
}

template<typename JSWrapper, typename IDL, typename Member, ReflectedAttributeReactions reactions>
NEVER_INLINE bool setReflectedAttribute(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName attributeName, const JSC::ClassInfo* classInfo, StaticQualifiedName contentAttribute)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (!JSC::JSValue::decode(thisValue).inherits(classInfo)) [[unlikely]]
        return JSC::throwVMDOMAttributeSetterTypeError(lexicalGlobalObject, throwScope, classInfo, attributeName);

    ReflectedAttributeReactionsScope<reactions> reactionsScope(*lexicalGlobalObject);
    SUPPRESS_UNCOUNTED_LOCAL auto& impl = uncheckedDowncast<JSWrapper>(JSC::JSValue::decode(thisValue))->wrapped();
    auto nativeValueConversionResult = convert<IDL>(*lexicalGlobalObject, JSC::JSValue::decode(encodedValue));
    if (nativeValueConversionResult.hasException(throwScope)) [[unlikely]]
        return false;
    invokeFunctorPropagatingExceptionIfNecessary(*lexicalGlobalObject, throwScope, [&] {
        return Member::call(impl, contentAttribute, nativeValueConversionResult.releaseReturnValue());
    });
    return true;
}

} // namespace Detail

template<typename JSClass, typename IDL, typename Member>
ALWAYS_INLINE JSC::EncodedJSValue reflectedAttribute(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue, StaticQualifiedName contentAttribute)
{
    ASSERT(JSC::JSValue::decode(thisValue).inherits(JSClass::info()));
    return Detail::reflectedAttribute<Detail::ReflectedAttributeWrapper<JSClass>, IDL, Member>(lexicalGlobalObject, thisValue, contentAttribute);
}

template<typename JSClass, typename IDL, typename Member, ReflectedAttributeReactions reactions>
ALWAYS_INLINE bool setReflectedAttribute(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName attributeName, StaticQualifiedName contentAttribute)
{
    return Detail::setReflectedAttribute<Detail::ReflectedAttributeWrapper<JSClass>, IDL, Member, reactions>(lexicalGlobalObject, thisValue, encodedValue, attributeName, JSClass::info(), contentAttribute);
}

} // namespace WebCore

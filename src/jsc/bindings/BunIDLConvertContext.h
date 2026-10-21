#pragma once
#include "BunIDLHumanReadable.h"
#include <JavaScriptCore/Error.h>
#include <wtf/text/MakeString.h>
#include <concepts>

namespace Bun {

namespace Detail {
struct IDLConversionContextMarker {};
}

template<typename T>
concept IDLConversionContext = std::derived_from<T, Detail::IDLConversionContextMarker>;

template<typename Derived>
struct IDLConversionContextBase : Detail::IDLConversionContextMarker {
    void throwRequired(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeErrorWithPredicate(global, scope, "is required"_s);
    }

    void throwNumberNotInteger(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, double value) const
    {
        derived().throwRangeErrorWithPredicate(
            global,
            scope,
            WTF::makeString("must be an integer (received "_s, value, ')'));
    }

    template<std::integral Int, std::integral Limit>
    void throwIntegerOutOfRange(
        JSC::JSGlobalObject& global,
        JSC::ThrowScope& scope,
        Int value,
        Limit min,
        Limit max) const
    {
        derived().throwRangeErrorWithPredicate(
            global,
            scope,
            WTF::makeString(
                "must be in the range ["_s,
                min,
                ", "_s,
                max,
                "] (received "_s,
                value,
                ')'));
    }

    template<std::integral Limit>
    void throwBigIntOutOfRange(
        JSC::JSGlobalObject& global,
        JSC::ThrowScope& scope,
        Limit min,
        Limit max) const
    {
        derived().throwRangeErrorWithPredicate(
            global,
            scope,
            WTF::makeString(
                "must be in the range ["_s,
                min,
                ", "_s,
                max,
                ']'));
    }

    void throwNotNumber(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeMustBe(global, scope, "a number"_s);
    }

    void throwNotString(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeMustBe(global, scope, "a string"_s);
    }

    void throwNotBoolean(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeMustBe(global, scope, "a boolean"_s);
    }

    void throwNotObject(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeMustBe(global, scope, "an object"_s);
    }

    void throwNotBlob(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeMustBe(global, scope, "a Blob"_s);
    }

    template<typename IDLElement = void>
    void throwNotArray(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeMustBe(global, scope, "an array"_s);
    }

    template<HasIDLHumanReadableName IDLElement>
    void throwNotArray(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeMustBe(
            global,
            scope,
            WTF::makeString("an array of "_s, idlHumanReadableName<IDLElement>()));
    }

    template<HasIDLHumanReadableName IDLEnum>
    void throwBadEnumerationValue(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeMustBe(global, scope, idlHumanReadableName<IDLEnum>());
    }

    template<HasIDLHumanReadableName... Alternatives>
        requires(sizeof...(Alternatives) > 0)
    void throwNoMatchInUnion(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeErrorWithPredicate(
            global,
            scope,
            WTF::makeString("must be of type "_s, idlHumanReadableName<IDLAlternatives<Alternatives...>>()));
    }

    template<typename... Alternatives>
    void throwNoMatchInUnion(JSC::JSGlobalObject& global, JSC::ThrowScope& scope) const
    {
        derived().throwTypeErrorWithPredicate(global, scope, "is of an unsupported type"_s);
    }

    template<typename String>
    void throwTypeMustBe(
        JSC::JSGlobalObject& global,
        JSC::ThrowScope& scope,
        String&& expectedNounPhrase) const
    {
        derived().throwTypeErrorWithPredicate(
            global,
            scope,
            WTF::makeString("must be "_s, std::forward<String>(expectedNounPhrase)));
    }

    template<typename String>
    void throwTypeErrorWithPredicate(
        JSC::JSGlobalObject& global,
        JSC::ThrowScope& scope,
        String&& predicate) const
    {
        derived().throwGenericTypeError(
            global,
            scope,
            WTF::makeString(derived().source(), ' ', std::forward<String>(predicate)));
    }

    template<typename String>
    void throwRangeErrorWithPredicate(
        JSC::JSGlobalObject& global,
        JSC::ThrowScope& scope,
        String&& predicate) const
    {
        derived().throwGenericRangeError(
            global,
            scope,
            WTF::makeString(derived().source(), ' ', std::forward<String>(predicate)));
    }

    template<typename String>
    void throwGenericTypeError(
        JSC::JSGlobalObject& global,
        JSC::ThrowScope& scope,
        String&& message) const
    {
        JSC::throwTypeError(&global, scope, std::forward<String>(message));
    }

    template<typename String>
    void throwGenericRangeError(
        JSC::JSGlobalObject& global,
        JSC::ThrowScope& scope,
        String&& message) const
    {
        JSC::throwRangeError(&global, scope, std::forward<String>(message));
    }

    using ElementContext = Derived;

    // When converting a sequence, the result of this function will be used as the context for
    // converting each element of the sequence.
    auto contextForElement() const
    {
        return typename Derived::ElementContext { derived() };
    }

private:
    const Derived& derived() const { return *static_cast<const Derived*>(this); }
};

// Default conversion context: throws a plain TypeError or RangeError with the message
// "value must be ...". See also Bindgen::LiteralConversionContext, which uses Bun::throwError.
struct DefaultConversionContext : IDLConversionContextBase<DefaultConversionContext> {
    WTF::ASCIILiteral source() const { return "value"_s; }
};

}

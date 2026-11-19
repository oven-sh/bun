#pragma once
#include "IDLTypes.h"
#include <array>
#include "ConcatCStrings.h"
#include <wtf/text/ASCIILiteral.h>
#include <concepts>

namespace Bun {

template<typename IDL>
struct IDLHumanReadableName;

// A list of types, named "a, b, or c".
template<typename... IDL>
struct IDLAlternatives {};

template<typename IDL>
concept HasIDLHumanReadableName = requires { IDLHumanReadableName<IDL>::humanReadableName; };

struct BaseIDLHumanReadableName {
    static constexpr bool isDisjunction = false;
    static constexpr bool hasPreposition = false;
};

template<typename IDL>
static constexpr WTF::ASCIILiteral idlHumanReadableName()
{
    static_assert(IDLHumanReadableName<IDL>::humanReadableName.back() == '\0');
    return WTF::ASCIILiteral::fromLiteralUnsafe(
        IDLHumanReadableName<IDL>::humanReadableName.data());
}

namespace Detail {
template<typename IDL>
static constexpr auto nestedHumanReadableName()
{
    static constexpr auto& name = IDLHumanReadableName<IDL>::humanReadableName;
    if constexpr (IDLHumanReadableName<IDL>::isDisjunction) {
        return Bun::concatCStrings("<", name, ">");
    } else {
        return name;
    }
}

template<typename FirstIDL>
static constexpr auto separatorForHumanReadableBinaryDisjunction()
{
    if constexpr (IDLHumanReadableName<FirstIDL>::hasPreposition) {
        return std::to_array(", or ");
    } else {
        return std::to_array(" or ");
    }
}
}

template<typename IDL>
    requires std::derived_from<IDL, WebCore::IDLBoolean>
struct IDLHumanReadableName<IDL> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("boolean");
};

template<typename IDL>
    requires WebCore::IsIDLInteger<IDL>::value
struct IDLHumanReadableName<IDL> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("integer");
};

template<typename IDL>
    requires WebCore::IsIDLFloatingPoint<IDL>::value
struct IDLHumanReadableName<IDL> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("number");
};

template<typename IDL>
    requires WebCore::IsIDLString<IDL>::value
struct IDLHumanReadableName<IDL> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("string");
};

// Will generally be overridden by each specific enumeration type.
template<typename T>
struct IDLHumanReadableName<WebCore::IDLEnumeration<T>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("enumeration (string)");
};

template<typename IDL>
struct IDLHumanReadableName<WebCore::IDLNullable<IDL>> : BaseIDLHumanReadableName {
    static constexpr bool isDisjunction = true;
    static constexpr auto humanReadableName = Bun::concatCStrings(
        Detail::nestedHumanReadableName<IDL>(),
        Detail::separatorForHumanReadableBinaryDisjunction<IDL>(),
        "null");
};

template<typename IDL>
struct IDLHumanReadableName<WebCore::IDLOptional<IDL>> : BaseIDLHumanReadableName {
    static constexpr bool isDisjunction = true;
    static constexpr auto humanReadableName = Bun::concatCStrings(
        Detail::nestedHumanReadableName<IDL>(),
        Detail::separatorForHumanReadableBinaryDisjunction<IDL>(),
        "undefined");
};

// Will generally be overridden by each specific dictionary type.
template<typename T>
struct IDLHumanReadableName<WebCore::IDLDictionary<T>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("dictionary (object)");
};

template<HasIDLHumanReadableName IDL>
struct IDLHumanReadableName<Bun::IDLAlternatives<IDL>> : IDLHumanReadableName<IDL> {};

template<HasIDLHumanReadableName... IDL>
struct IDLHumanReadableName<Bun::IDLAlternatives<IDL...>> : BaseIDLHumanReadableName {
    static constexpr bool isDisjunction = sizeof...(IDL) > 1;
    static constexpr auto humanReadableName
        = Bun::joinCStringsAsList(Detail::nestedHumanReadableName<IDL>()...);
};

}

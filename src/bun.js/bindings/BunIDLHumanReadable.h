#pragma once
#include "BunIDLTypes.h"
#include "ConcatCStrings.h"
#include <wtf/text/ASCIILiteral.h>
#include <concepts>
#include <string_view>

namespace Bun {

template<typename IDL>
struct IDLHumanReadableName;

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

template<> struct IDLHumanReadableName<Bun::IDLStrictNull> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("null");
};

template<> struct IDLHumanReadableName<Bun::IDLStrictUndefined> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("undefined");
};

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

template<typename IDL>
struct IDLHumanReadableName<IDLLooseNullable<IDL>>
    : IDLHumanReadableName<WebCore::IDLNullable<IDL>> {};

template<HasIDLHumanReadableName IDL>
struct IDLHumanReadableName<Bun::IDLArray<IDL>> : BaseIDLHumanReadableName {
    static constexpr bool hasPreposition = true;
    static constexpr auto humanReadableName
        = Bun::concatCStrings("array of ", Detail::nestedHumanReadableName<IDL>());
};

// Will generally be overridden by each specific dictionary type.
template<typename T>
struct IDLHumanReadableName<WebCore::IDLDictionary<T>> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("dictionary (object)");
};

template<HasIDLHumanReadableName IDL>
struct IDLHumanReadableName<Bun::IDLOrderedUnion<IDL>> : IDLHumanReadableName<IDL> {};

template<HasIDLHumanReadableName... IDL>
struct IDLHumanReadableName<Bun::IDLOrderedUnion<IDL...>> : BaseIDLHumanReadableName {
    static constexpr bool isDisjunction = sizeof...(IDL) > 1;
    static constexpr auto humanReadableName
        = Bun::joinCStringsAsList(Detail::nestedHumanReadableName<IDL>()...);
};

template<> struct IDLHumanReadableName<Bun::IDLArrayBufferRef> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("ArrayBuffer");
};

template<> struct IDLHumanReadableName<Bun::IDLBlobRef> : BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("Blob");
};

}

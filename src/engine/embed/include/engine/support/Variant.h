#pragma once

#include "engine/support/StdLibExtras.h"

#include <variant>

namespace WTF {

template<typename... Types> using Variant = std::variant<Types...>;

template<typename... Functors>
struct Visitor : Functors... {
    using Functors::operator()...;
};

template<typename... Functors>
ALWAYS_INLINE Visitor<Functors...> makeVisitor(Functors... functors)
{
    return { WTF::move(functors)... };
}

template<typename VariantType, typename... Functors>
ALWAYS_INLINE decltype(auto) switchOn(VariantType&& variant, Functors&&... functors)
{
    return std::visit(makeVisitor(std::forward<Functors>(functors)...), std::forward<VariantType>(variant));
}

}

using WTF::Variant;

#pragma once

#include <cstddef>
#include <type_traits>
#include <utility>

// Lists of types. A predicate is a template over `_1`, which stands for the element.
namespace brigand {

template<typename... Types> struct list {};

struct _1 {};

template<typename T> struct type_ {
    using type = T;
};

template<std::ptrdiff_t value> using ptrdiff_t = std::integral_constant<std::ptrdiff_t, value>;

namespace detail {

template<typename Predicate, typename Element> struct Apply;
template<template<typename...> class Predicate, typename... Arguments, typename Element>
struct Apply<Predicate<Arguments...>, Element> : Predicate<std::conditional_t<std::is_same_v<Arguments, _1>, Element, Arguments>...> {};

template<typename... A, typename... B> list<A..., B...> operator+(list<A...>, list<B...>);

template<typename List> struct Operations;
template<typename... Types> struct Operations<list<Types...>> {
    using Size = std::integral_constant<std::size_t, sizeof...(Types)>;

    template<typename Predicate> using Any = std::bool_constant<(Apply<Predicate, Types>::value || ...)>;

    template<typename Predicate> struct Filter {
        using Result = decltype((list<>() + ... + std::conditional_t<Apply<Predicate, Types>::value, list<Types>, list<>>()));
    };

    template<std::size_t index> struct At {
        using Result = __type_pack_element<index, Types...>;
    };

    static void forEach(auto& functor) { (functor(type_<Types>()), ...); }
};

template<typename First, std::size_t... offsets>
list<std::integral_constant<typename First::value_type, First::value + offsets>...> countFrom(std::index_sequence<offsets...>);

}

template<typename List> using size = typename detail::Operations<List>::Size;
template<typename List, typename Predicate> using any = typename detail::Operations<List>::template Any<Predicate>;
template<typename List, typename Predicate> using filter = typename detail::Operations<List>::template Filter<Predicate>::Result;
template<typename List, typename Index> using at = typename detail::Operations<List>::template At<Index::value>::Result;
template<typename List> using front = at<List, ptrdiff_t<0>>;
template<typename First, std::size_t count> using make_sequence = decltype(detail::countFrom<First>(std::make_index_sequence<count>()));

template<typename List, typename Functor>
Functor for_each(Functor functor)
{
    detail::Operations<List>::forEach(functor);
    return functor;
}

}

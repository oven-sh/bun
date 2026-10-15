#pragma once
#include <cstddef>
#include <type_traits>

namespace Bun::Bindgen {

// `union { Args... }`, which is how it is passed to Rust.
template<typename... Args>
union ExternUnion;

template<typename First>
union ExternUnion<First> {
    First first;

    template<std::size_t index>
    void set(First value)
    {
        static_assert(!index);
        first = value;
    }
};

template<typename First, typename... Rest>
union ExternUnion<First, Rest...> {
    First first;
    ExternUnion<Rest...> rest;

    template<std::size_t index>
    void set(auto value)
    {
        if constexpr (index)
            rest.template set<index - 1>(value);
        else
            first = value;
    }
};

}

#pragma once
#include <algorithm>
#include <array>
#include <type_traits>
#include <utility>

namespace Bun {

namespace Detail {
template<typename T>
static constexpr bool isCharArray = false;

template<std::size_t n>
static constexpr bool isCharArray<char[n]> = true;

template<std::size_t n>
static constexpr bool isCharArray<std::array<char, n>> = true;

// Intentionally not defined, to force consteval to fail.
void stringIsNotNullTerminated();
}

template<typename... T>
    requires(Detail::isCharArray<std::remove_cvref_t<T>> && ...)
consteval auto concatCStrings(T&&... nullTerminatedCharArrays)
{
    std::array<char, ((sizeof(std::remove_reference_t<T>) - 1) + ...) + 1> result;
    auto it = result.begin();
    auto append = [&it](auto&& arg) {
        if (std::end(arg)[-1] != '\0') {
            // This will cause consteval to fail.
            Detail::stringIsNotNullTerminated();
        }
        it = std::copy(std::begin(arg), std::end(arg) - 1, it);
    };
    (append(nullTerminatedCharArrays), ...);
    result.back() = '\0';
    return result;
}

namespace Detail {
template<std::size_t index, std::size_t length>
consteval auto listSeparatorForIndex()
{
    if constexpr (length == 2) {
        return std::to_array(" or ");
    } else if constexpr (index == length - 1) {
        return std::to_array(", or ");
    } else {
        return std::to_array(", ");
    }
}

template<typename T, typename... Rest, std::size_t i0, std::size_t... indices>
consteval auto joinCStringsAsList(std::index_sequence<i0, indices...>, T&& first, Rest&&... rest)
{
    return concatCStrings(
        first,
        concatCStrings(
            listSeparatorForIndex<indices, sizeof...(Rest) + 1>(),
            std::forward<Rest>(rest))...);
}
}

template<typename... T>
    requires(Detail::isCharArray<std::remove_cvref_t<T>> && ...)
consteval auto joinCStringsAsList(T&&... nullTerminatedCharArrays)
{
    if constexpr (sizeof...(T) == 0) {
        return std::to_array("");
    } else {
        return Detail::joinCStringsAsList(
            std::make_index_sequence<sizeof...(T)> {},
            std::forward<T>(nullTerminatedCharArrays)...);
    }
}

}

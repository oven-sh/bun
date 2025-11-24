#pragma once

#include <type_traits>
#include <utility>

namespace Bun::Algo::Tuple {

namespace detail {

template <typename Tuple, typename Func, std::size_t... Is>
void forEachIndexedImpl(Tuple&& t, Func&& f, std::index_sequence<Is...>) {
    (f(std::integral_constant<std::size_t, Is>{}, std::get<Is>(std::forward<Tuple>(t))), ...);
}

} // namespace detail


/// @brief Iterates over tuple elements, invoking a callback with each element and its index.
/// @tparam Tuple A tuple-like type (std::tuple, std::pair, std::array)
/// @tparam Func Callable with signature void(auto&& element, std::size_t index)
template <typename Tuple, typename Func>
void forEachIndexed(Tuple&& t, Func&& f) {
    detail::forEachIndexedImpl(
        std::forward<Tuple>(t),
        std::forward<Func>(f),
        std::make_index_sequence<std::tuple_size_v<std::decay_t<Tuple>>>{}
    );
}

} // namespace Bun::Algo::Tuple

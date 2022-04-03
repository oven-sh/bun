/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */
#ifndef SkEnumOperators_DEFINED
#define SkEnumOperators_DEFINED

#include <type_traits>

namespace sknonstd {
template <typename T> struct is_bitmask_enum : std::false_type {};

template <typename E>
std::enable_if_t<sknonstd::is_bitmask_enum<E>::value, bool> constexpr Any(E e) {
    return static_cast<std::underlying_type_t<E>>(e) != 0;
}
}  // namespace sknonstd

template <typename E>
std::enable_if_t<sknonstd::is_bitmask_enum<E>::value, E> constexpr operator|(E l, E r) {
    using U = std::underlying_type_t<E>;
    return static_cast<E>(static_cast<U>(l) | static_cast<U>(r));
}

template <typename E>
std::enable_if_t<sknonstd::is_bitmask_enum<E>::value, E&> constexpr operator|=(E& l, E r) {
    return l = l | r;
}

template <typename E>
std::enable_if_t<sknonstd::is_bitmask_enum<E>::value, E> constexpr operator&(E l, E r) {
    using U = std::underlying_type_t<E>;
    return static_cast<E>(static_cast<U>(l) & static_cast<U>(r));
}

template <typename E>
std::enable_if_t<sknonstd::is_bitmask_enum<E>::value, E&> constexpr operator&=(E& l, E r) {
    return l = l & r;
}

template <typename E>
std::enable_if_t<sknonstd::is_bitmask_enum<E>::value, E> constexpr operator^(E l, E r) {
    using U = std::underlying_type_t<E>;
    return static_cast<E>(static_cast<U>(l) ^ static_cast<U>(r));
}

template <typename E>
std::enable_if_t<sknonstd::is_bitmask_enum<E>::value, E&> constexpr operator^=(E& l, E r) {
    return l = l ^ r;
}

template <typename E>
std::enable_if_t<sknonstd::is_bitmask_enum<E>::value, E> constexpr operator~(E e) {
    return static_cast<E>(~static_cast<std::underlying_type_t<E>>(e));
}

#endif  // SkEnumOperators_DEFINED

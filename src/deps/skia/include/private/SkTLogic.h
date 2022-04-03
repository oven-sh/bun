/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 *
 *
 * This header provides some std:: features early in the skstd namespace
 * and several Skia-specific additions in the sknonstd namespace.
 */

#ifndef SkTLogic_DEFINED
#define SkTLogic_DEFINED

#include <cstddef>
#include <type_traits>
#include <utility>
#include "include/private/SkTo.h"

namespace skstd {

// C++17, <variant>
struct monostate {};

// C++17, <type_traits>
template<typename...> struct conjunction : std::true_type { };
template<typename T> struct conjunction<T> : T { };
template<typename T, typename... Ts>
struct conjunction<T, Ts...> : std::conditional<bool(T::value), conjunction<Ts...>, T>::type { };

// C++17, std::data, std::size
template<typename Container>
constexpr auto data(Container& c) -> decltype(c.data()) { return c.data(); }
template<typename Container>
constexpr auto data(const Container& c) -> decltype(c.data()) { return c.data(); }
template<typename Array, size_t N>
constexpr auto data(Array(&a)[N]) -> decltype(a) { return a; }
template<typename T>
constexpr const T* data(std::initializer_list<T> i) { return i.begin(); }

template<typename Container>
constexpr auto size(Container& c) -> decltype(c.size()) { return c.size(); }
template<typename Array, size_t N>
constexpr size_t size(Array(&)[N]) { return N; }
template<typename T>
constexpr const T* size(std::initializer_list<T> i) { return i.end() - i.begin(); }
}  // namespace skstd

// The sknonstd namespace contains things we would like to be proposed and feel std-ish.
namespace sknonstd {

// The name 'copy' here is fraught with peril. In this case it means 'append', not 'overwrite'.
// Alternate proposed names are 'propagate', 'augment', or 'append' (and 'add', but already taken).
// std::experimental::propagate_const already exists for other purposes in TSv2.
// These also follow the <dest, source> pattern used by boost.
template <typename D, typename S> struct copy_const {
    using type = std::conditional_t<std::is_const<S>::value, std::add_const_t<D>, D>;
};
template <typename D, typename S> using copy_const_t = typename copy_const<D, S>::type;

template <typename D, typename S> struct copy_volatile {
    using type = std::conditional_t<std::is_volatile<S>::value, std::add_volatile_t<D>, D>;
};
template <typename D, typename S> using copy_volatile_t = typename copy_volatile<D, S>::type;

template <typename D, typename S> struct copy_cv {
    using type = copy_volatile_t<copy_const_t<D, S>, S>;
};
template <typename D, typename S> using copy_cv_t = typename copy_cv<D, S>::type;

// The name 'same' here means 'overwrite'.
// Alternate proposed names are 'replace', 'transfer', or 'qualify_from'.
// same_xxx<D, S> can be written as copy_xxx<remove_xxx_t<D>, S>
template <typename D, typename S> using same_const = copy_const<std::remove_const_t<D>, S>;
template <typename D, typename S> using same_const_t = typename same_const<D, S>::type;
template <typename D, typename S> using same_volatile =copy_volatile<std::remove_volatile_t<D>,S>;
template <typename D, typename S> using same_volatile_t = typename same_volatile<D, S>::type;
template <typename D, typename S> using same_cv = copy_cv<std::remove_cv_t<D>, S>;
template <typename D, typename S> using same_cv_t = typename same_cv<D, S>::type;

}  // namespace sknonstd

template <typename Container>
constexpr int SkCount(const Container& c) { return SkTo<int>(skstd::size(c)); }

#endif

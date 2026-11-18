#pragma once

#include "engine/support/Assertions.h"

#include <concepts>
#include <cstddef>
#include <cstdint>
#include <expected>
#include <functional>
#include <memory>
#include <mutex>
#include <new>
#include <type_traits>
#include <utility>

#define OBJECT_OFFSETOF(Class, field)         \
    IGNORE_WARNINGS_BEGIN("invalid-offsetof") \
    __builtin_offsetof(Class, field) IGNORE_WARNINGS_END

// Placement new that leaves out the check for null.
enum NotNullTag { NotNull };
inline void* operator new(size_t, NotNullTag, void* location)
{
    ASSERT(location);
    return location;
}

namespace WTF {

inline constexpr size_t KB = 1024;
inline constexpr size_t MB = 1024 * KB;

inline constexpr size_t notFound = static_cast<size_t>(-1);

template<typename T>
[[nodiscard]] ALWAYS_INLINE constexpr std::remove_reference_t<T>&& move(T&& value)
{
    static_assert(std::is_lvalue_reference_v<T>, "A temporary needs no move()");
    static_assert(!std::is_const_v<std::remove_reference_t<T>>, "A constant would be copied");
    return static_cast<std::remove_reference_t<T>&&>(value);
}

template<typename T>
concept IsRefCounted = requires(std::remove_cv_t<T>* object) {
    object->ref();
    object->deref();
};

template<typename T>
concept IsFastAllocated = requires { typename T::WTFIsFastMallocAllocated; };

template<typename T, typename... Arguments>
[[nodiscard]] ALWAYS_INLINE std::unique_ptr<T> makeUnique(Arguments&&... arguments)
{
    static_assert(IsFastAllocated<T>, "T lacks WTF_MAKE_TZONE_ALLOCATED");
    static_assert(!IsRefCounted<T>, "Use adoptRef()");
    return std::make_unique<T>(std::forward<Arguments>(arguments)...);
}

template<typename Error>
constexpr std::unexpected<std::decay_t<Error>> makeUnexpected(Error&& error)
{
    return std::unexpected<std::decay_t<Error>>(std::forward<Error>(error));
}

namespace Detail {

template<typename, typename> inline constexpr bool isInvocable = false;
template<typename Functor, typename Result, typename... Arguments>
inline constexpr bool isInvocable<Functor, Result(Arguments...)> = std::is_invocable_r_v<Result, Functor, Arguments...>;

template<template<typename...> class Base, typename... Arguments> std::true_type derivesFrom(const volatile Base<Arguments...>*);
template<template<typename...> class> std::false_type derivesFrom(const volatile void*);

}

template<typename Functor, typename Signature>
concept Invocable = Detail::isInvocable<std::decay_t<Functor>&, Signature>;

template<typename, template<typename...> class> struct IsTemplate : std::false_type {};
template<typename... Arguments, template<typename...> class Template> struct IsTemplate<Template<Arguments...>, Template> : std::true_type {};

template<template<typename...> class Base, typename Derived>
struct IsBaseOfTemplate : decltype(Detail::derivesFrom<Base>(std::declval<Derived*>())) {};

template<size_t bytes> struct SizedUnsignedTrait;
template<> struct SizedUnsignedTrait<1> {
    using Type = uint8_t;
};
template<> struct SizedUnsignedTrait<2> {
    using Type = uint16_t;
};
template<> struct SizedUnsignedTrait<4> {
    using Type = uint32_t;
};
template<> struct SizedUnsignedTrait<8> {
    using Type = uint64_t;
};

}

using WTF::Invocable;
using WTF::KB;
using WTF::makeUnexpected;
using WTF::makeUnique;
using WTF::MB;
using WTF::notFound;
using WTF::SizedUnsignedTrait;

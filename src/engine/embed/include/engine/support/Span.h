#pragma once

#include "engine/support/StdLibExtras.h"

#include <cstring>
#include <span>

namespace WTF {

struct Latin1Character;

namespace Detail {

template<typename To, typename From>
constexpr size_t convertExtent(size_t extent)
{
    return extent == std::dynamic_extent ? extent : extent * sizeof(From) / sizeof(To);
}

}

template<typename To, typename From, size_t extent>
std::span<To, Detail::convertExtent<To, From>(extent)> spanReinterpretCast(std::span<From, extent> span)
{
    static_assert(std::is_const_v<To> || !std::is_const_v<From>);
    if constexpr (extent != std::dynamic_extent)
        static_assert(!(extent * sizeof(From) % sizeof(To)));
    else if constexpr (sizeof(From) % sizeof(To) != 0)
        RELEASE_ASSERT(!(span.size_bytes() % sizeof(To)));
    return std::span<To, Detail::convertExtent<To, From>(extent)> { reinterpret_cast<To*>(span.data()), span.size_bytes() / sizeof(To) };
}

template<typename To, typename From, size_t extent>
std::span<To, extent> spanConstCast(std::span<From, extent> span)
{
    return std::span<To, extent> { const_cast<To*>(span.data()), span.size() };
}

template<typename T, size_t extent>
std::span<const uint8_t> asByteSpan(std::span<T, extent> span)
{
    return { reinterpret_cast<const uint8_t*>(span.data()), span.size_bytes() };
}

template<typename T>
std::span<const uint8_t> asByteSpan(const T& object)
{
    return { reinterpret_cast<const uint8_t*>(std::addressof(object)), sizeof(T) };
}

template<typename T, size_t extentA, typename U, size_t extentB>
bool equalSpans(std::span<T, extentA> a, std::span<U, extentB> b)
{
    static_assert(sizeof(T) == sizeof(U));
    static_assert(std::has_unique_object_representations_v<T> && std::has_unique_object_representations_v<U>);
    return a.size() == b.size() && (a.empty() || !memcmp(a.data(), b.data(), a.size_bytes()));
}

template<typename T, size_t destinationExtent, typename U, size_t sourceExtent>
void memcpySpan(std::span<T, destinationExtent> destination, std::span<U, sourceExtent> source)
{
    static_assert(sizeof(T) == sizeof(U));
    static_assert(std::is_trivially_copyable_v<T> && std::is_trivially_copyable_v<U>);
    RELEASE_ASSERT(destination.size() >= source.size());
    if (!source.empty())
        memcpy(destination.data(), source.data(), source.size_bytes());
}

template<typename T, size_t extent>
void memsetSpan(std::span<T, extent> destination, uint8_t byte)
{
    static_assert(std::is_trivially_copyable_v<T>);
    if (!destination.empty())
        memset(static_cast<void*>(destination.data()), byte, destination.size_bytes());
}

template<typename T>
concept ByteType = sizeof(T) == 1
    && ((std::integral<T> && !std::same_as<std::remove_const_t<T>, bool>) || std::same_as<std::remove_const_t<T>, std::byte> || std::same_as<std::remove_const_t<T>, Latin1Character>);

// Converts a byte, a pointer to bytes or a span of bytes to another type of byte.
template<ByteType To, ByteType From>
constexpr To byteCast(From byte)
{
    return static_cast<To>(byte);
}

template<ByteType To, ByteType From>
auto byteCast(From* pointer)
{
    return reinterpret_cast<std::conditional_t<std::is_const_v<From>, const To, To>*>(pointer);
}

template<ByteType To, ByteType From, size_t extent>
auto byteCast(std::span<From, extent> span)
{
    return spanReinterpretCast<std::conditional_t<std::is_const_v<From>, const To, To>>(span);
}

}

using WTF::asByteSpan;
using WTF::byteCast;
using WTF::equalSpans;
using WTF::memcpySpan;
using WTF::memsetSpan;
using WTF::spanConstCast;
using WTF::spanReinterpretCast;

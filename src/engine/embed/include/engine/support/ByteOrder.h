#pragma once

#include <bit>
#include <concepts>
#include <cstring>

namespace WTF {

template<std::integral T>
constexpr T flipBytes(T value)
{
    return std::byteswap(value);
}

// Between the order of the processor and the order of the data, which the argument names.
template<std::integral T>
constexpr T flipBytesIfLittleEndian(T value, bool isDataLittleEndian)
{
    return isDataLittleEndian ? value : flipBytes(value);
}

template<typename T>
inline T unalignedLoad(const void* address)
{
    static_assert(std::is_trivially_copyable_v<T>);
    T result;
    memcpy(&result, address, sizeof(T));
    return result;
}

template<typename T>
inline void unalignedStore(void* address, T value)
{
    static_assert(std::is_trivially_copyable_v<T>);
    memcpy(address, &value, sizeof(T));
}

}

using WTF::flipBytes;
using WTF::flipBytesIfLittleEndian;

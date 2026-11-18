#pragma once

#include "engine/support/Forward.h"
#include "engine/support/GetPtr.h"
#include "engine/support/Int128.h"
#include "engine/support/StdLibExtras.h"

#include <bit>

namespace WTF {

// The mixing step of rapidhash.
constexpr unsigned intHash(uint64_t key)
{
    UInt128 product = static_cast<UInt128>(key ^ 0x2d358dccaa6c78a5) * (key ^ 0x8bb84b93962eacc9);
    return static_cast<unsigned>(static_cast<uint64_t>(product) ^ static_cast<uint64_t>(product >> 64));
}

constexpr unsigned pairIntHash(unsigned first, unsigned second)
{
    return intHash(static_cast<uint64_t>(first) << 32 | second);
}

template<typename T> struct IntHash {
    static unsigned hash(T key) { return intHash(static_cast<typename SizedUnsignedTrait<sizeof(T)>::Type>(key)); }
    static bool equal(T a, T b) { return a == b; }
};

template<typename T> struct PtrHash {
    static unsigned hash(T key) { return intHash(reinterpret_cast<uintptr_t>(key)); }
    static bool equal(T a, T b) { return a == b; }
};

// Also takes the raw pointer as the key to look for.
template<SmartPtr T> struct PtrHash<T> {
    using RawPointer = const typename GetPtrHelper<T>::UnderlyingType*;
    static unsigned hash(RawPointer key) { return PtrHash<RawPointer>::hash(key); }
    static unsigned hash(const std::same_as<T> auto& key) { return hash(getPtr(key)); }
    static bool equal(const T& a, RawPointer b) { return getPtr(a) == b; }
    static bool equal(const T& a, const std::same_as<T> auto& b) { return getPtr(a) == getPtr(b); }
};

template<typename T>
    requires std::integral<T> || std::is_enum_v<T>
struct DefaultHash<T> : IntHash<T> {};
template<typename T> struct DefaultHash<T*> : PtrHash<T*> {};
template<typename T> struct DefaultHash<Ref<T>> : PtrHash<Ref<T>> {};
template<typename T> struct DefaultHash<RefPtr<T>> : PtrHash<RefPtr<T>> {};

}

using WTF::DefaultHash;
using WTF::IntHash;
using WTF::intHash;
using WTF::pairIntHash;
using WTF::PtrHash;

// Copyright (c) 2014 Google, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// FarmHash, by Geoff Pike

//
// http://code.google.com/p/farmhash/
//
// This file provides a few functions for hashing strings and other
// data.  All of them are high-quality functions in the sense that
// they do well on standard tests such as Austin Appleby's SMHasher.
// They're also fast.  FarmHash is the successor to CityHash.
//
// Functions in the FarmHash family are not suitable for cryptography.
//
// WARNING: This code has been only lightly tested on big-endian platforms!
// It is known to work well on little-endian platforms that have a small penalty
// for unaligned reads, such as current Intel and AMD moderate-to-high-end CPUs.
// It should work on all 32-bit and 64-bit platforms that allow unaligned reads;
// bug reports are welcome.
//
// By the way, for some hash functions, given strings a and b, the hash
// of a+b is easily derived from the hashes of a and b.  This property
// doesn't hold for any hash functions in this file.

#ifndef FARM_HASH_H_
#define FARM_HASH_H_

#include <assert.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>   // for memcpy and memset
#include <utility>

#ifndef NAMESPACE_FOR_HASH_FUNCTIONS
#define NAMESPACE_FOR_HASH_FUNCTIONS util
#endif

namespace NAMESPACE_FOR_HASH_FUNCTIONS {

#if defined(FARMHASH_UINT128_T_DEFINED)
#if defined(__clang__)
#if !defined(uint128_t)
#define uint128_t __uint128_t
#endif
#endif
inline uint64_t Uint128Low64(const uint128_t x) {
  return static_cast<uint64_t>(x);
}
inline uint64_t Uint128High64(const uint128_t x) {
  return static_cast<uint64_t>(x >> 64);
}
inline uint128_t Uint128(uint64_t lo, uint64_t hi) {
  return lo + (((uint128_t)hi) << 64);
}
#else
typedef std::pair<uint64_t, uint64_t> uint128_t;
inline uint64_t Uint128Low64(const uint128_t x) { return x.first; }
inline uint64_t Uint128High64(const uint128_t x) { return x.second; }
inline uint128_t Uint128(uint64_t lo, uint64_t hi) { return uint128_t(lo, hi); }
#endif


// BASIC STRING HASHING

// Hash function for a byte array.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
size_t Hash(const char* s, size_t len);

// Hash function for a byte array.  Most useful in 32-bit binaries.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint32_t Hash32(const char* s, size_t len);

// Hash function for a byte array.  For convenience, a 32-bit seed is also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint32_t Hash32WithSeed(const char* s, size_t len, uint32_t seed);

// Hash function for a byte array.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint64_t Hash64(const char* s, size_t len);

// Hash function for a byte array.  For convenience, a 64-bit seed is also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint64_t Hash64WithSeed(const char* s, size_t len, uint64_t seed);

// Hash function for a byte array.  For convenience, two seeds are also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint64_t Hash64WithSeeds(const char* s, size_t len,
                       uint64_t seed0, uint64_t seed1);

// Hash function for a byte array.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint128_t Hash128(const char* s, size_t len);

// Hash function for a byte array.  For convenience, a 128-bit seed is also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint128_t Hash128WithSeed(const char* s, size_t len, uint128_t seed);

// BASIC NON-STRING HASHING

// Hash 128 input bits down to 64 bits of output.
// This is intended to be a reasonably good hash function.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
inline uint64_t Hash128to64(uint128_t x) {
  // Murmur-inspired hashing.
  const uint64_t kMul = 0x9ddfea08eb382d69ULL;
  uint64_t a = (Uint128Low64(x) ^ Uint128High64(x)) * kMul;
  a ^= (a >> 47);
  uint64_t b = (Uint128High64(x) ^ a) * kMul;
  b ^= (b >> 47);
  b *= kMul;
  return b;
}

// FINGERPRINTING (i.e., good, portable, forever-fixed hash functions)

// Fingerprint function for a byte array.  Most useful in 32-bit binaries.
uint32_t Fingerprint32(const char* s, size_t len);

// Fingerprint function for a byte array.
uint64_t Fingerprint64(const char* s, size_t len);

// Fingerprint function for a byte array.
uint128_t Fingerprint128(const char* s, size_t len);

// This is intended to be a good fingerprinting primitive.
// See below for more overloads.
inline uint64_t Fingerprint(uint128_t x) {
  // Murmur-inspired hashing.
  const uint64_t kMul = 0x9ddfea08eb382d69ULL;
  uint64_t a = (Uint128Low64(x) ^ Uint128High64(x)) * kMul;
  a ^= (a >> 47);
  uint64_t b = (Uint128High64(x) ^ a) * kMul;
  b ^= (b >> 44);
  b *= kMul;
  b ^= (b >> 41);
  b *= kMul;
  return b;
}

// This is intended to be a good fingerprinting primitive.
inline uint64_t Fingerprint(uint64_t x) {
  // Murmur-inspired hashing.
  const uint64_t kMul = 0x9ddfea08eb382d69ULL;
  uint64_t b = x * kMul;
  b ^= (b >> 44);
  b *= kMul;
  b ^= (b >> 41);
  b *= kMul;
  return b;
}

#ifndef FARMHASH_NO_CXX_STRING

// Convenience functions to hash or fingerprint C++ strings.
// These require that Str::data() return a pointer to the first char
// (as a const char*) and that Str::length() return the string's length;
// they work with std::string, for example.

// Hash function for a byte array.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
template <typename Str>
inline size_t Hash(const Str& s) {
  assert(sizeof(s[0]) == 1);
  return Hash(s.data(), s.length());
}

// Hash function for a byte array.  Most useful in 32-bit binaries.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
template <typename Str>
inline uint32_t Hash32(const Str& s) {
  assert(sizeof(s[0]) == 1);
  return Hash32(s.data(), s.length());
}

// Hash function for a byte array.  For convenience, a 32-bit seed is also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
template <typename Str>
inline uint32_t Hash32WithSeed(const Str& s, uint32_t seed) {
  assert(sizeof(s[0]) == 1);
  return Hash32WithSeed(s.data(), s.length(), seed);
}

// Hash 128 input bits down to 64 bits of output.
// Hash function for a byte array.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
template <typename Str>
inline uint64_t Hash64(const Str& s) {
  assert(sizeof(s[0]) == 1);
  return Hash64(s.data(), s.length());
}

// Hash function for a byte array.  For convenience, a 64-bit seed is also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
template <typename Str>
inline uint64_t Hash64WithSeed(const Str& s, uint64_t seed) {
  assert(sizeof(s[0]) == 1);
  return Hash64WithSeed(s.data(), s.length(), seed);
}

// Hash function for a byte array.  For convenience, two seeds are also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
template <typename Str>
inline uint64_t Hash64WithSeeds(const Str& s, uint64_t seed0, uint64_t seed1) {
  assert(sizeof(s[0]) == 1);
  return Hash64WithSeeds(s.data(), s.length(), seed0, seed1);
}

// Hash function for a byte array.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
template <typename Str>
inline uint128_t Hash128(const Str& s) {
  assert(sizeof(s[0]) == 1);
  return Hash128(s.data(), s.length());
}

// Hash function for a byte array.  For convenience, a 128-bit seed is also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
template <typename Str>
inline uint128_t Hash128WithSeed(const Str& s, uint128_t seed) {
  assert(sizeof(s[0]) == 1);
  return Hash128(s.data(), s.length(), seed);
}

// FINGERPRINTING (i.e., good, portable, forever-fixed hash functions)

// Fingerprint function for a byte array.  Most useful in 32-bit binaries.
template <typename Str>
inline uint32_t Fingerprint32(const Str& s) {
  assert(sizeof(s[0]) == 1);
  return Fingerprint32(s.data(), s.length());
}

// Fingerprint 128 input bits down to 64 bits of output.
// Fingerprint function for a byte array.
template <typename Str>
inline uint64_t Fingerprint64(const Str& s) {
  assert(sizeof(s[0]) == 1);
  return Fingerprint64(s.data(), s.length());
}

// Fingerprint function for a byte array.
template <typename Str>
inline uint128_t Fingerprint128(const Str& s) {
  assert(sizeof(s[0]) == 1);
  return Fingerprint128(s.data(), s.length());
}

#endif

}  // namespace NAMESPACE_FOR_HASH_FUNCTIONS

/* gently define FARMHASH_BIG_ENDIAN when detected big-endian machine */
#if defined(__BIG_ENDIAN__)
  #if !defined(FARMHASH_BIG_ENDIAN)
    #define FARMHASH_BIG_ENDIAN
  #endif
#elif defined(__LITTLE_ENDIAN__)
  // nothing for little-endian
#elif defined(__BYTE_ORDER__) && defined(__ORDER_LITTLE_ENDIAN__) && (__BYTE_ORDER == __ORDER_LITTLE_ENDIAN__)
  // nothing for little-endian
#elif defined(__BYTE_ORDER__) && defined(__ORDER_BIG_ENDIAN__) && (__BYTE_ORDER == __ORDER_BIG_ENDIAN__)
  #if !defined(FARMHASH_BIG_ENDIAN)
    #define FARMHASH_BIG_ENDIAN
  #endif
#elif defined(__linux__) || defined(__CYGWIN__) || defined( __GNUC__ ) && !defined(_WIN32) || defined( __GNU_LIBRARY__ )
  #include <endian.h> // libc6-dev, GLIBC
  #if BYTE_ORDER == BIG_ENDIAN
    #if !defined(FARMHASH_BIG_ENDIAN)
      #define FARMHASH_BIG_ENDIAN
    #endif
  #endif
#elif defined(__OpenBSD__) || defined(__NetBSD__) || defined(__FreeBSD__) || defined(__DragonFly__) || defined(__s390x__)
  #include <sys/endian.h>
  #if BYTE_ORDER == BIG_ENDIAN
    #if !defined(FARMHASH_BIG_ENDIAN)
      #define FARMHASH_BIG_ENDIAN
    #endif
  #endif
#elif defined(_WIN32)
  // Windows is (currently) little-endian
#else
  #error "Unable to determine endianness!"
#endif /* __BIG_ENDIAN__ */

#endif  // FARM_HASH_H_

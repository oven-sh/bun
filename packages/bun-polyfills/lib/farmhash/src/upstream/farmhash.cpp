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

#include "farmhash.h"
// FARMHASH ASSUMPTIONS: Modify as needed, or use -DFARMHASH_ASSUME_SSE42 etc.
// Note that if you use -DFARMHASH_ASSUME_SSE42 you likely need -msse42
// (or its equivalent for your compiler); if you use -DFARMHASH_ASSUME_AESNI
// you likely need -maes (or its equivalent for your compiler).

#ifdef FARMHASH_ASSUME_SSSE3
#undef FARMHASH_ASSUME_SSSE3
#define FARMHASH_ASSUME_SSSE3 1
#endif

#ifdef FARMHASH_ASSUME_SSE41
#undef FARMHASH_ASSUME_SSE41
#define FARMHASH_ASSUME_SSE41 1
#endif

#ifdef FARMHASH_ASSUME_SSE42
#undef FARMHASH_ASSUME_SSE42
#define FARMHASH_ASSUME_SSE42 1
#endif

#ifdef FARMHASH_ASSUME_AESNI
#undef FARMHASH_ASSUME_AESNI
#define FARMHASH_ASSUME_AESNI 1
#endif

#ifdef FARMHASH_ASSUME_AVX
#undef FARMHASH_ASSUME_AVX
#define FARMHASH_ASSUME_AVX 1
#endif

#if !defined(FARMHASH_CAN_USE_CXX11) && defined(LANG_CXX11)
#define FARMHASH_CAN_USE_CXX11 1
#else
#undef FARMHASH_CAN_USE_CXX11
#define FARMHASH_CAN_USE_CXX11 0
#endif

// FARMHASH PORTABILITY LAYER: Runtime error if misconfigured

#ifndef FARMHASH_DIE_IF_MISCONFIGURED
#define FARMHASH_DIE_IF_MISCONFIGURED do { *(char*)(len % 17) = 0; } while (0)
#endif

// FARMHASH PORTABILITY LAYER: "static inline" or similar

#ifndef STATIC_INLINE
#define STATIC_INLINE static inline
#endif

// FARMHASH PORTABILITY LAYER: LIKELY and UNLIKELY

#if !defined(LIKELY)
#if defined(FARMHASH_NO_BUILTIN_EXPECT) || (defined(FARMHASH_OPTIONAL_BUILTIN_EXPECT) && !defined(HAVE_BUILTIN_EXPECT))
#define LIKELY(x) (x)
#else
#define LIKELY(x) (__builtin_expect(!!(x), 1))
#endif
#endif

#undef UNLIKELY
#define UNLIKELY(x) !LIKELY(!(x))

// FARMHASH PORTABILITY LAYER: endianness and byteswapping functions

#ifdef WORDS_BIGENDIAN
#undef FARMHASH_BIG_ENDIAN
#define FARMHASH_BIG_ENDIAN 1
#endif

#if defined(FARMHASH_LITTLE_ENDIAN) && defined(FARMHASH_BIG_ENDIAN)
#error
#endif

#if !defined(FARMHASH_LITTLE_ENDIAN) && !defined(FARMHASH_BIG_ENDIAN)
#define FARMHASH_UNKNOWN_ENDIAN 1
#endif

#if !defined(bswap_32) || !defined(bswap_64)
#undef bswap_32
#undef bswap_64

#if defined(HAVE_BUILTIN_BSWAP) || defined(__clang__) ||                \
  (defined(__GNUC__) && ((__GNUC__ == 4 && __GNUC_MINOR__ >= 8) ||      \
                         __GNUC__ >= 5))
// Easy case for bswap: no header file needed.
#define bswap_32(x) __builtin_bswap32(x)
#define bswap_64(x) __builtin_bswap64(x)
#endif

#endif

#if defined(FARMHASH_UNKNOWN_ENDIAN) || !defined(bswap_64)

#ifdef _WIN32

#undef bswap_32
#undef bswap_64
#define bswap_32(x) _byteswap_ulong(x)
#define bswap_64(x) _byteswap_uint64(x)

#elif defined(__APPLE__)

// Mac OS X / Darwin features
#include <libkern/OSByteOrder.h>
#undef bswap_32
#undef bswap_64
#define bswap_32(x) OSSwapInt32(x)
#define bswap_64(x) OSSwapInt64(x)

#elif defined(__sun) || defined(sun)

#include <sys/byteorder.h>
#undef bswap_32
#undef bswap_64
#define bswap_32(x) BSWAP_32(x)
#define bswap_64(x) BSWAP_64(x)

#elif defined(__FreeBSD__) || defined(__DragonFly__)

#include <sys/endian.h>
#undef bswap_32
#undef bswap_64
#define bswap_32(x) bswap32(x)
#define bswap_64(x) bswap64(x)

#elif defined(__OpenBSD__)

#include <sys/types.h>
#undef bswap_32
#undef bswap_64
#define bswap_32(x) swap32(x)
#define bswap_64(x) swap64(x)

#elif defined(__NetBSD__)

#include <sys/types.h>
#include <machine/bswap.h>
#if defined(__BSWAP_RENAME) && !defined(__bswap_32)
#undef bswap_32
#undef bswap_64
#define bswap_32(x) bswap32(x)
#define bswap_64(x) bswap64(x)
#endif

#elif defined(__HAIKU__)

#define _BSD_SOURCE
#include <bsd/endian.h>
#undef bswap_32
#undef bswap_64
#define bswap_32(x) bswap32(x)
#define bswap_64(x) bswap64(x)

#else

#undef bswap_32
#undef bswap_64
#undef _BYTESWAP_H
#include <byteswap.h>

#endif

#ifdef WORDS_BIGENDIAN
#define FARMHASH_BIG_ENDIAN 1
#endif

#endif

#ifdef FARMHASH_BIG_ENDIAN
#define uint32_in_expected_order(x) (bswap_32(x))
#define uint64_in_expected_order(x) (bswap_64(x))
#else
#define uint32_in_expected_order(x) (x)
#define uint64_in_expected_order(x) (x)
#endif

namespace NAMESPACE_FOR_HASH_FUNCTIONS {

STATIC_INLINE uint64_t Fetch64(const char *p) {
  uint64_t result;
  memcpy(&result, p, sizeof(result));
  return uint64_in_expected_order(result);
}

STATIC_INLINE uint32_t Fetch32(const char *p) {
  uint32_t result;
  memcpy(&result, p, sizeof(result));
  return uint32_in_expected_order(result);
}

STATIC_INLINE uint32_t Bswap32(uint32_t val) { return bswap_32(val); }
STATIC_INLINE uint64_t Bswap64(uint64_t val) { return bswap_64(val); }

// FARMHASH PORTABILITY LAYER: bitwise rot

STATIC_INLINE uint32_t BasicRotate32(uint32_t val, int shift) {
  // Avoid shifting by 32: doing so yields an undefined result.
  return shift == 0 ? val : ((val >> shift) | (val << (32 - shift)));
}

STATIC_INLINE uint64_t BasicRotate64(uint64_t val, int shift) {
  // Avoid shifting by 64: doing so yields an undefined result.
  return shift == 0 ? val : ((val >> shift) | (val << (64 - shift)));
}

#if defined(_WIN32) && defined(FARMHASH_ROTR)

STATIC_INLINE uint32_t Rotate32(uint32_t val, int shift) {
  return sizeof(unsigned long) == sizeof(val) ?
      _lrotr(val, shift) :
      BasicRotate32(val, shift);
}

STATIC_INLINE uint64_t Rotate64(uint64_t val, int shift) {
  return sizeof(unsigned long) == sizeof(val) ?
      _lrotr(val, shift) :
      BasicRotate64(val, shift);
}

#else

STATIC_INLINE uint32_t Rotate32(uint32_t val, int shift) {
  return BasicRotate32(val, shift);
}
STATIC_INLINE uint64_t Rotate64(uint64_t val, int shift) {
  return BasicRotate64(val, shift);
}

#endif

}  // namespace NAMESPACE_FOR_HASH_FUNCTIONS

// FARMHASH PORTABILITY LAYER: debug mode or max speed?
// One may use -DFARMHASH_DEBUG=1 or -DFARMHASH_DEBUG=0 to force the issue.

#if !defined(FARMHASH_DEBUG) && (!defined(NDEBUG) || defined(_DEBUG))
#define FARMHASH_DEBUG 1
#endif

#undef debug_mode
#if FARMHASH_DEBUG
#define debug_mode 1
#else
#define debug_mode 0
#endif

// PLATFORM-SPECIFIC FUNCTIONS AND MACROS

#undef x86_64
#if defined (__x86_64) || defined (__x86_64__)
#define x86_64 1
#else
#define x86_64 0
#endif

#undef x86
#if defined(__i386__) || defined(__i386) || defined(__X86__)
#define x86 1
#else
#define x86 x86_64
#endif

#if !defined(is_64bit)
#define is_64bit (x86_64 || (sizeof(void*) == 8))
#endif

#undef can_use_ssse3
#if defined(__SSSE3__) || defined(FARMHASH_ASSUME_SSSE3)

#include <immintrin.h>
#define can_use_ssse3 1
// Now we can use _mm_hsub_epi16 and so on.

#else
#define can_use_ssse3 0
#endif

#undef can_use_sse41
#if defined(__SSE4_1__) || defined(FARMHASH_ASSUME_SSE41)

#include <immintrin.h>
#define can_use_sse41 1
// Now we can use _mm_insert_epi64 and so on.

#else
#define can_use_sse41 0
#endif

#undef can_use_sse42
#if defined(__SSE4_2__) || defined(FARMHASH_ASSUME_SSE42)

#include <nmmintrin.h>
#define can_use_sse42 1
// Now we can use _mm_crc32_u{32,16,8}.  And on 64-bit platforms, _mm_crc32_u64.

#else
#define can_use_sse42 0
#endif

#undef can_use_aesni
#if defined(__AES__) || defined(FARMHASH_ASSUME_AESNI)

#include <wmmintrin.h>
#define can_use_aesni 1
// Now we can use _mm_aesimc_si128 and so on.

#else
#define can_use_aesni 0
#endif

#undef can_use_avx
#if defined(__AVX__) || defined(FARMHASH_ASSUME_AVX)

#include <immintrin.h>
#define can_use_avx 1

#else
#define can_use_avx 0
#endif

#if can_use_ssse3 || can_use_sse41 || can_use_sse42 || can_use_aesni || can_use_avx
STATIC_INLINE __m128i Fetch128(const char* s) {
  return _mm_loadu_si128(reinterpret_cast<const __m128i*>(s));
}
#endif
// Building blocks for hash functions

// std::swap() was in <algorithm> but is in <utility> from C++11 on.
#if !FARMHASH_CAN_USE_CXX11
#include <algorithm>
#endif

#undef PERMUTE3
#define PERMUTE3(a, b, c) do { std::swap(a, b); std::swap(a, c); } while (0)

namespace NAMESPACE_FOR_HASH_FUNCTIONS {

// Some primes between 2^63 and 2^64 for various uses.
static const uint64_t k0 = 0xc3a5c85c97cb3127ULL;
static const uint64_t k1 = 0xb492b66fbe98f273ULL;
static const uint64_t k2 = 0x9ae16a3b2f90404fULL;

// Magic numbers for 32-bit hashing.  Copied from Murmur3.
static const uint32_t c1 = 0xcc9e2d51;
static const uint32_t c2 = 0x1b873593;

// A 32-bit to 32-bit integer hash copied from Murmur3.
STATIC_INLINE uint32_t fmix(uint32_t h)
{
  h ^= h >> 16;
  h *= 0x85ebca6b;
  h ^= h >> 13;
  h *= 0xc2b2ae35;
  h ^= h >> 16;
  return h;
}

STATIC_INLINE uint32_t Mur(uint32_t a, uint32_t h) {
  // Helper from Murmur3 for combining two 32-bit values.
  a *= c1;
  a = Rotate32(a, 17);
  a *= c2;
  h ^= a;
  h = Rotate32(h, 19);
  return h * 5 + 0xe6546b64;
}

template <typename T> STATIC_INLINE T DebugTweak(T x) {
  if (debug_mode) {
    if (sizeof(x) == 4) {
      x = ~Bswap32(x * c1);
    } else {
      x = ~Bswap64(x * k1);
    }
  }
  return x;
}

template <> uint128_t DebugTweak(uint128_t x) {
  if (debug_mode) {
    uint64_t y = DebugTweak(Uint128Low64(x));
    uint64_t z = DebugTweak(Uint128High64(x));
    y += z;
    z += y;
    x = Uint128(y, z * k1);
  }
  return x;
}

}  // namespace NAMESPACE_FOR_HASH_FUNCTIONS

using namespace std;
using namespace NAMESPACE_FOR_HASH_FUNCTIONS;
namespace farmhashna {
#undef Fetch
#define Fetch Fetch64

#undef Rotate
#define Rotate Rotate64

#undef Bswap
#define Bswap Bswap64

STATIC_INLINE uint64_t ShiftMix(uint64_t val) {
  return val ^ (val >> 47);
}

STATIC_INLINE uint64_t HashLen16(uint64_t u, uint64_t v) {
  return Hash128to64(Uint128(u, v));
}

STATIC_INLINE uint64_t HashLen16(uint64_t u, uint64_t v, uint64_t mul) {
  // Murmur-inspired hashing.
  uint64_t a = (u ^ v) * mul;
  a ^= (a >> 47);
  uint64_t b = (v ^ a) * mul;
  b ^= (b >> 47);
  b *= mul;
  return b;
}

STATIC_INLINE uint64_t HashLen0to16(const char *s, size_t len) {
  if (len >= 8) {
    uint64_t mul = k2 + len * 2;
    uint64_t a = Fetch(s) + k2;
    uint64_t b = Fetch(s + len - 8);
    uint64_t c = Rotate(b, 37) * mul + a;
    uint64_t d = (Rotate(a, 25) + b) * mul;
    return HashLen16(c, d, mul);
  }
  if (len >= 4) {
    uint64_t mul = k2 + len * 2;
    uint64_t a = Fetch32(s);
    return HashLen16(len + (a << 3), Fetch32(s + len - 4), mul);
  }
  if (len > 0) {
    uint8_t a = s[0];
    uint8_t b = s[len >> 1];
    uint8_t c = s[len - 1];
    uint32_t y = static_cast<uint32_t>(a) + (static_cast<uint32_t>(b) << 8);
    uint32_t z = len + (static_cast<uint32_t>(c) << 2);
    return ShiftMix(y * k2 ^ z * k0) * k2;
  }
  return k2;
}

// This probably works well for 16-byte strings as well, but it may be overkill
// in that case.
STATIC_INLINE uint64_t HashLen17to32(const char *s, size_t len) {
  uint64_t mul = k2 + len * 2;
  uint64_t a = Fetch(s) * k1;
  uint64_t b = Fetch(s + 8);
  uint64_t c = Fetch(s + len - 8) * mul;
  uint64_t d = Fetch(s + len - 16) * k2;
  return HashLen16(Rotate(a + b, 43) + Rotate(c, 30) + d,
                   a + Rotate(b + k2, 18) + c, mul);
}

// Return a 16-byte hash for 48 bytes.  Quick and dirty.
// Callers do best to use "random-looking" values for a and b.
STATIC_INLINE pair<uint64_t, uint64_t> WeakHashLen32WithSeeds(
    uint64_t w, uint64_t x, uint64_t y, uint64_t z, uint64_t a, uint64_t b) {
  a += w;
  b = Rotate(b + a + z, 21);
  uint64_t c = a;
  a += x;
  a += y;
  b += Rotate(a, 44);
  return make_pair(a + z, b + c);
}

// Return a 16-byte hash for s[0] ... s[31], a, and b.  Quick and dirty.
STATIC_INLINE pair<uint64_t, uint64_t> WeakHashLen32WithSeeds(
    const char* s, uint64_t a, uint64_t b) {
  return WeakHashLen32WithSeeds(Fetch(s),
                                Fetch(s + 8),
                                Fetch(s + 16),
                                Fetch(s + 24),
                                a,
                                b);
}

// Return an 8-byte hash for 33 to 64 bytes.
STATIC_INLINE uint64_t HashLen33to64(const char *s, size_t len) {
  uint64_t mul = k2 + len * 2;
  uint64_t a = Fetch(s) * k2;
  uint64_t b = Fetch(s + 8);
  uint64_t c = Fetch(s + len - 8) * mul;
  uint64_t d = Fetch(s + len - 16) * k2;
  uint64_t y = Rotate(a + b, 43) + Rotate(c, 30) + d;
  uint64_t z = HashLen16(y, a + Rotate(b + k2, 18) + c, mul);
  uint64_t e = Fetch(s + 16) * mul;
  uint64_t f = Fetch(s + 24);
  uint64_t g = (y + Fetch(s + len - 32)) * mul;
  uint64_t h = (z + Fetch(s + len - 24)) * mul;
  return HashLen16(Rotate(e + f, 43) + Rotate(g, 30) + h,
                   e + Rotate(f + a, 18) + g, mul);
}

uint64_t Hash64(const char *s, size_t len) {
  const uint64_t seed = 81;
  if (len <= 32) {
    if (len <= 16) {
      return HashLen0to16(s, len);
    } else {
      return HashLen17to32(s, len);
    }
  } else if (len <= 64) {
    return HashLen33to64(s, len);
  }

  // For strings over 64 bytes we loop.  Internal state consists of
  // 56 bytes: v, w, x, y, and z.
  uint64_t x = seed;
  uint64_t y = seed * k1 + 113;
  uint64_t z = ShiftMix(y * k2 + 113) * k2;
  pair<uint64_t, uint64_t> v = make_pair(0, 0);
  pair<uint64_t, uint64_t> w = make_pair(0, 0);
  x = x * k2 + Fetch(s);

  // Set end so that after the loop we have 1 to 64 bytes left to process.
  const char* end = s + ((len - 1) / 64) * 64;
  const char* last64 = end + ((len - 1) & 63) - 63;
  assert(s + len - 64 == last64);
  do {
    x = Rotate(x + y + v.first + Fetch(s + 8), 37) * k1;
    y = Rotate(y + v.second + Fetch(s + 48), 42) * k1;
    x ^= w.second;
    y += v.first + Fetch(s + 40);
    z = Rotate(z + w.first, 33) * k1;
    v = WeakHashLen32WithSeeds(s, v.second * k1, x + w.first);
    w = WeakHashLen32WithSeeds(s + 32, z + w.second, y + Fetch(s + 16));
    std::swap(z, x);
    s += 64;
  } while (s != end);
  uint64_t mul = k1 + ((z & 0xff) << 1);
  // Make s point to the last 64 bytes of input.
  s = last64;
  w.first += ((len - 1) & 63);
  v.first += w.first;
  w.first += v.first;
  x = Rotate(x + y + v.first + Fetch(s + 8), 37) * mul;
  y = Rotate(y + v.second + Fetch(s + 48), 42) * mul;
  x ^= w.second * 9;
  y += v.first * 9 + Fetch(s + 40);
  z = Rotate(z + w.first, 33) * mul;
  v = WeakHashLen32WithSeeds(s, v.second * mul, x + w.first);
  w = WeakHashLen32WithSeeds(s + 32, z + w.second, y + Fetch(s + 16));
  std::swap(z, x);
  return HashLen16(HashLen16(v.first, w.first, mul) + ShiftMix(y) * k0 + z,
                   HashLen16(v.second, w.second, mul) + x,
                   mul);
}

uint64_t Hash64WithSeeds(const char *s, size_t len, uint64_t seed0, uint64_t seed1);

uint64_t Hash64WithSeed(const char *s, size_t len, uint64_t seed) {
  return Hash64WithSeeds(s, len, k2, seed);
}

uint64_t Hash64WithSeeds(const char *s, size_t len, uint64_t seed0, uint64_t seed1) {
  return HashLen16(Hash64(s, len) - seed0, seed1);
}
}  // namespace farmhashna
namespace farmhashuo {
#undef Fetch
#define Fetch Fetch64

#undef Rotate
#define Rotate Rotate64

STATIC_INLINE uint64_t H(uint64_t x, uint64_t y, uint64_t mul, int r) {
  uint64_t a = (x ^ y) * mul;
  a ^= (a >> 47);
  uint64_t b = (y ^ a) * mul;
  return Rotate(b, r) * mul;
}

uint64_t Hash64WithSeeds(const char *s, size_t len,
                         uint64_t seed0, uint64_t seed1) {
  if (len <= 64) {
    return farmhashna::Hash64WithSeeds(s, len, seed0, seed1);
  }

  // For strings over 64 bytes we loop.  Internal state consists of
  // 64 bytes: u, v, w, x, y, and z.
  uint64_t x = seed0;
  uint64_t y = seed1 * k2 + 113;
  uint64_t z = farmhashna::ShiftMix(y * k2) * k2;
  pair<uint64_t, uint64_t> v = make_pair(seed0, seed1);
  pair<uint64_t, uint64_t> w = make_pair(0, 0);
  uint64_t u = x - z;
  x *= k2;
  uint64_t mul = k2 + (u & 0x82);

  // Set end so that after the loop we have 1 to 64 bytes left to process.
  const char* end = s + ((len - 1) / 64) * 64;
  const char* last64 = end + ((len - 1) & 63) - 63;
  assert(s + len - 64 == last64);
  do {
    uint64_t a0 = Fetch(s);
    uint64_t a1 = Fetch(s + 8);
    uint64_t a2 = Fetch(s + 16);
    uint64_t a3 = Fetch(s + 24);
    uint64_t a4 = Fetch(s + 32);
    uint64_t a5 = Fetch(s + 40);
    uint64_t a6 = Fetch(s + 48);
    uint64_t a7 = Fetch(s + 56);
    x += a0 + a1;
    y += a2;
    z += a3;
    v.first += a4;
    v.second += a5 + a1;
    w.first += a6;
    w.second += a7;

    x = Rotate(x, 26);
    x *= 9;
    y = Rotate(y, 29);
    z *= mul;
    v.first = Rotate(v.first, 33);
    v.second = Rotate(v.second, 30);
    w.first ^= x;
    w.first *= 9;
    z = Rotate(z, 32);
    z += w.second;
    w.second += z;
    z *= 9;
    std::swap(u, y);

    z += a0 + a6;
    v.first += a2;
    v.second += a3;
    w.first += a4;
    w.second += a5 + a6;
    x += a1;
    y += a7;

    y += v.first;
    v.first += x - y;
    v.second += w.first;
    w.first += v.second;
    w.second += x - y;
    x += w.second;
    w.second = Rotate(w.second, 34);
    std::swap(u, z);
    s += 64;
  } while (s != end);
  // Make s point to the last 64 bytes of input.
  s = last64;
  u *= 9;
  v.second = Rotate(v.second, 28);
  v.first = Rotate(v.first, 20);
  w.first += ((len - 1) & 63);
  u += y;
  y += u;
  x = Rotate(y - x + v.first + Fetch(s + 8), 37) * mul;
  y = Rotate(y ^ v.second ^ Fetch(s + 48), 42) * mul;
  x ^= w.second * 9;
  y += v.first + Fetch(s + 40);
  z = Rotate(z + w.first, 33) * mul;
  v = farmhashna::WeakHashLen32WithSeeds(s, v.second * mul, x + w.first);
  w = farmhashna::WeakHashLen32WithSeeds(s + 32, z + w.second, y + Fetch(s + 16));
  return H(farmhashna::HashLen16(v.first + x, w.first ^ y, mul) + z - u,
           H(v.second + y, w.second + z, k2, 30) ^ x,
           k2,
           31);
}

uint64_t Hash64WithSeed(const char *s, size_t len, uint64_t seed) {
  return len <= 64 ? farmhashna::Hash64WithSeed(s, len, seed) :
      Hash64WithSeeds(s, len, 0, seed);
}

uint64_t Hash64(const char *s, size_t len) {
  return len <= 64 ? farmhashna::Hash64(s, len) :
      Hash64WithSeeds(s, len, 81, 0);
}
}  // namespace farmhashuo
namespace farmhashxo {
#undef Fetch
#define Fetch Fetch64

#undef Rotate
#define Rotate Rotate64

STATIC_INLINE uint64_t H32(const char *s, size_t len, uint64_t mul,
                           uint64_t seed0 = 0, uint64_t seed1 = 0) {
  uint64_t a = Fetch(s) * k1;
  uint64_t b = Fetch(s + 8);
  uint64_t c = Fetch(s + len - 8) * mul;
  uint64_t d = Fetch(s + len - 16) * k2;
  uint64_t u = Rotate(a + b, 43) + Rotate(c, 30) + d + seed0;
  uint64_t v = a + Rotate(b + k2, 18) + c + seed1;
  a = farmhashna::ShiftMix((u ^ v) * mul);
  b = farmhashna::ShiftMix((v ^ a) * mul);
  return b;
}

// Return an 8-byte hash for 33 to 64 bytes.
STATIC_INLINE uint64_t HashLen33to64(const char *s, size_t len) {
  uint64_t mul0 = k2 - 30;
  uint64_t mul1 = k2 - 30 + 2 * len;
  uint64_t h0 = H32(s, 32, mul0);
  uint64_t h1 = H32(s + len - 32, 32, mul1);
  return ((h1 * mul1) + h0) * mul1;
}

// Return an 8-byte hash for 65 to 96 bytes.
STATIC_INLINE uint64_t HashLen65to96(const char *s, size_t len) {
  uint64_t mul0 = k2 - 114;
  uint64_t mul1 = k2 - 114 + 2 * len;
  uint64_t h0 = H32(s, 32, mul0);
  uint64_t h1 = H32(s + 32, 32, mul1);
  uint64_t h2 = H32(s + len - 32, 32, mul1, h0, h1);
  return (h2 * 9 + (h0 >> 17) + (h1 >> 21)) * mul1;
}

uint64_t Hash64(const char *s, size_t len) {
  if (len <= 32) {
    if (len <= 16) {
      return farmhashna::HashLen0to16(s, len);
    } else {
      return farmhashna::HashLen17to32(s, len);
    }
  } else if (len <= 64) {
    return HashLen33to64(s, len);
  } else if (len <= 96) {
    return HashLen65to96(s, len);
  } else if (len <= 256) {
    return farmhashna::Hash64(s, len);
  } else {
    return farmhashuo::Hash64(s, len);
  }
}

uint64_t Hash64WithSeeds(const char *s, size_t len, uint64_t seed0, uint64_t seed1) {
  return farmhashuo::Hash64WithSeeds(s, len, seed0, seed1);
}

uint64_t Hash64WithSeed(const char *s, size_t len, uint64_t seed) {
  return farmhashuo::Hash64WithSeed(s, len, seed);
}
}  // namespace farmhashxo
namespace farmhashte {
#if !can_use_sse41 || !x86_64

uint64_t Hash64(const char *s, size_t len) {
  FARMHASH_DIE_IF_MISCONFIGURED;
  return s == NULL ? 0 : len;
}

uint64_t Hash64WithSeed(const char *s, size_t len, uint64_t seed) {
  FARMHASH_DIE_IF_MISCONFIGURED;
  return seed + Hash64(s, len);
}

uint64_t Hash64WithSeeds(const char *s, size_t len,
                         uint64_t seed0, uint64_t seed1) {
  FARMHASH_DIE_IF_MISCONFIGURED;
  return seed0 + seed1 + Hash64(s, len);
}

#else

#undef Fetch
#define Fetch Fetch64

#undef Rotate
#define Rotate Rotate64

#undef Bswap
#define Bswap Bswap64

// Helpers for data-parallel operations (1x 128 bits or 2x 64 or 4x 32).
STATIC_INLINE __m128i Add(__m128i x, __m128i y) { return _mm_add_epi64(x, y); }
STATIC_INLINE __m128i Xor(__m128i x, __m128i y) { return _mm_xor_si128(x, y); }
STATIC_INLINE __m128i Mul(__m128i x, __m128i y) { return _mm_mullo_epi32(x, y); }
STATIC_INLINE __m128i Shuf(__m128i x, __m128i y) { return _mm_shuffle_epi8(y, x); }

// Requires n >= 256.  Requires SSE4.1. Should be slightly faster if the
// compiler uses AVX instructions (e.g., use the -mavx flag with GCC).
STATIC_INLINE uint64_t Hash64Long(const char* s, size_t n,
                                  uint64_t seed0, uint64_t seed1) {
  const __m128i kShuf =
      _mm_set_epi8(4, 11, 10, 5, 8, 15, 6, 9, 12, 2, 14, 13, 0, 7, 3, 1);
  const __m128i kMult =
      _mm_set_epi8(0xbd, 0xd6, 0x33, 0x39, 0x45, 0x54, 0xfa, 0x03,
                   0x34, 0x3e, 0x33, 0xed, 0xcc, 0x9e, 0x2d, 0x51);
  uint64_t seed2 = (seed0 + 113) * (seed1 + 9);
  uint64_t seed3 = (Rotate(seed0, 23) + 27) * (Rotate(seed1, 30) + 111);
  __m128i d0 = _mm_cvtsi64_si128(seed0);
  __m128i d1 = _mm_cvtsi64_si128(seed1);
  __m128i d2 = Shuf(kShuf, d0);
  __m128i d3 = Shuf(kShuf, d1);
  __m128i d4 = Xor(d0, d1);
  __m128i d5 = Xor(d1, d2);
  __m128i d6 = Xor(d2, d4);
  __m128i d7 = _mm_set1_epi32(seed2 >> 32);
  __m128i d8 = Mul(kMult, d2);
  __m128i d9 = _mm_set1_epi32(seed3 >> 32);
  __m128i d10 = _mm_set1_epi32(seed3);
  __m128i d11 = Add(d2, _mm_set1_epi32(seed2));
  const char* end = s + (n & ~static_cast<size_t>(255));
  do {
    __m128i z;
    z = Fetch128(s);
    d0 = Add(d0, z);
    d1 = Shuf(kShuf, d1);
    d2 = Xor(d2, d0);
    d4 = Xor(d4, z);
    d4 = Xor(d4, d1);
    std::swap(d0, d6);
    z = Fetch128(s + 16);
    d5 = Add(d5, z);
    d6 = Shuf(kShuf, d6);
    d8 = Shuf(kShuf, d8);
    d7 = Xor(d7, d5);
    d0 = Xor(d0, z);
    d0 = Xor(d0, d6);
    std::swap(d5, d11);
    z = Fetch128(s + 32);
    d1 = Add(d1, z);
    d2 = Shuf(kShuf, d2);
    d4 = Shuf(kShuf, d4);
    d5 = Xor(d5, z);
    d5 = Xor(d5, d2);
    std::swap(d10, d4);
    z = Fetch128(s + 48);
    d6 = Add(d6, z);
    d7 = Shuf(kShuf, d7);
    d0 = Shuf(kShuf, d0);
    d8 = Xor(d8, d6);
    d1 = Xor(d1, z);
    d1 = Add(d1, d7);
    z = Fetch128(s + 64);
    d2 = Add(d2, z);
    d5 = Shuf(kShuf, d5);
    d4 = Add(d4, d2);
    d6 = Xor(d6, z);
    d6 = Xor(d6, d11);
    std::swap(d8, d2);
    z = Fetch128(s + 80);
    d7 = Xor(d7, z);
    d8 = Shuf(kShuf, d8);
    d1 = Shuf(kShuf, d1);
    d0 = Add(d0, d7);
    d2 = Add(d2, z);
    d2 = Add(d2, d8);
    std::swap(d1, d7);
    z = Fetch128(s + 96);
    d4 = Shuf(kShuf, d4);
    d6 = Shuf(kShuf, d6);
    d8 = Mul(kMult, d8);
    d5 = Xor(d5, d11);
    d7 = Xor(d7, z);
    d7 = Add(d7, d4);
    std::swap(d6, d0);
    z = Fetch128(s + 112);
    d8 = Add(d8, z);
    d0 = Shuf(kShuf, d0);
    d2 = Shuf(kShuf, d2);
    d1 = Xor(d1, d8);
    d10 = Xor(d10, z);
    d10 = Xor(d10, d0);
    std::swap(d11, d5);
    z = Fetch128(s + 128);
    d4 = Add(d4, z);
    d5 = Shuf(kShuf, d5);
    d7 = Shuf(kShuf, d7);
    d6 = Add(d6, d4);
    d8 = Xor(d8, z);
    d8 = Xor(d8, d5);
    std::swap(d4, d10);
    z = Fetch128(s + 144);
    d0 = Add(d0, z);
    d1 = Shuf(kShuf, d1);
    d2 = Add(d2, d0);
    d4 = Xor(d4, z);
    d4 = Xor(d4, d1);
    z = Fetch128(s + 160);
    d5 = Add(d5, z);
    d6 = Shuf(kShuf, d6);
    d8 = Shuf(kShuf, d8);
    d7 = Xor(d7, d5);
    d0 = Xor(d0, z);
    d0 = Xor(d0, d6);
    std::swap(d2, d8);
    z = Fetch128(s + 176);
    d1 = Add(d1, z);
    d2 = Shuf(kShuf, d2);
    d4 = Shuf(kShuf, d4);
    d5 = Mul(kMult, d5);
    d5 = Xor(d5, z);
    d5 = Xor(d5, d2);
    std::swap(d7, d1);
    z = Fetch128(s + 192);
    d6 = Add(d6, z);
    d7 = Shuf(kShuf, d7);
    d0 = Shuf(kShuf, d0);
    d8 = Add(d8, d6);
    d1 = Xor(d1, z);
    d1 = Xor(d1, d7);
    std::swap(d0, d6);
    z = Fetch128(s + 208);
    d2 = Add(d2, z);
    d5 = Shuf(kShuf, d5);
    d4 = Xor(d4, d2);
    d6 = Xor(d6, z);
    d6 = Xor(d6, d9);
    std::swap(d5, d11);
    z = Fetch128(s + 224);
    d7 = Add(d7, z);
    d8 = Shuf(kShuf, d8);
    d1 = Shuf(kShuf, d1);
    d0 = Xor(d0, d7);
    d2 = Xor(d2, z);
    d2 = Xor(d2, d8);
    std::swap(d10, d4);
    z = Fetch128(s + 240);
    d3 = Add(d3, z);
    d4 = Shuf(kShuf, d4);
    d6 = Shuf(kShuf, d6);
    d7 = Mul(kMult, d7);
    d5 = Add(d5, d3);
    d7 = Xor(d7, z);
    d7 = Xor(d7, d4);
    std::swap(d3, d9);
    s += 256;
  } while (s != end);
  d6 = Add(Mul(kMult, d6), _mm_cvtsi64_si128(n));
  if (n % 256 != 0) {
    d7 = Add(_mm_shuffle_epi32(d8, (0 << 6) + (3 << 4) + (2 << 2) + (1 << 0)), d7);
    d8 = Add(Mul(kMult, d8), _mm_cvtsi64_si128(farmhashxo::Hash64(s, n % 256)));
  }
  __m128i t[8];
  d0 = Mul(kMult, Shuf(kShuf, Mul(kMult, d0)));
  d3 = Mul(kMult, Shuf(kShuf, Mul(kMult, d3)));
  d9 = Mul(kMult, Shuf(kShuf, Mul(kMult, d9)));
  d1 = Mul(kMult, Shuf(kShuf, Mul(kMult, d1)));
  d0 = Add(d11, d0);
  d3 = Xor(d7, d3);
  d9 = Add(d8, d9);
  d1 = Add(d10, d1);
  d4 = Add(d3, d4);
  d5 = Add(d9, d5);
  d6 = Xor(d1, d6);
  d2 = Add(d0, d2);
  t[0] = d0;
  t[1] = d3;
  t[2] = d9;
  t[3] = d1;
  t[4] = d4;
  t[5] = d5;
  t[6] = d6;
  t[7] = d2;
  return farmhashxo::Hash64(reinterpret_cast<const char*>(t), sizeof(t));
}

uint64_t Hash64(const char *s, size_t len) {
  // Empirically, farmhashxo seems faster until length 512.
  return len >= 512 ? Hash64Long(s, len, k2, k1) : farmhashxo::Hash64(s, len);
}

uint64_t Hash64WithSeed(const char *s, size_t len, uint64_t seed) {
  return len >= 512 ? Hash64Long(s, len, k1, seed) :
      farmhashxo::Hash64WithSeed(s, len, seed);
}

uint64_t Hash64WithSeeds(const char *s, size_t len, uint64_t seed0, uint64_t seed1) {
  return len >= 512 ? Hash64Long(s, len, seed0, seed1) :
      farmhashxo::Hash64WithSeeds(s, len, seed0, seed1);
}

#endif
}  // namespace farmhashte
namespace farmhashnt {
#if !can_use_sse41 || !x86_64

uint32_t Hash32(const char *s, size_t len) {
  FARMHASH_DIE_IF_MISCONFIGURED;
  return s == NULL ? 0 : len;
}

uint32_t Hash32WithSeed(const char *s, size_t len, uint32_t seed) {
  FARMHASH_DIE_IF_MISCONFIGURED;
  return seed + Hash32(s, len);
}

#else

uint32_t Hash32(const char *s, size_t len) {
  return static_cast<uint32_t>(farmhashte::Hash64(s, len));
}

uint32_t Hash32WithSeed(const char *s, size_t len, uint32_t seed) {
  return static_cast<uint32_t>(farmhashte::Hash64WithSeed(s, len, seed));
}

#endif
}  // namespace farmhashnt
namespace farmhashmk {
#undef Fetch
#define Fetch Fetch32

#undef Rotate
#define Rotate Rotate32

#undef Bswap
#define Bswap Bswap32

STATIC_INLINE uint32_t Hash32Len13to24(const char *s, size_t len, uint32_t seed = 0) {
  uint32_t a = Fetch(s - 4 + (len >> 1));
  uint32_t b = Fetch(s + 4);
  uint32_t c = Fetch(s + len - 8);
  uint32_t d = Fetch(s + (len >> 1));
  uint32_t e = Fetch(s);
  uint32_t f = Fetch(s + len - 4);
  uint32_t h = d * c1 + len + seed;
  a = Rotate(a, 12) + f;
  h = Mur(c, h) + a;
  a = Rotate(a, 3) + c;
  h = Mur(e, h) + a;
  a = Rotate(a + f, 12) + d;
  h = Mur(b ^ seed, h) + a;
  return fmix(h);
}

STATIC_INLINE uint32_t Hash32Len0to4(const char *s, size_t len, uint32_t seed = 0) {
  uint32_t b = seed;
  uint32_t c = 9;
  for (size_t i = 0; i < len; i++) {
    signed char v = s[i];
    b = b * c1 + v;
    c ^= b;
  }
  return fmix(Mur(b, Mur(len, c)));
}

STATIC_INLINE uint32_t Hash32Len5to12(const char *s, size_t len, uint32_t seed = 0) {
  uint32_t a = len, b = len * 5, c = 9, d = b + seed;
  a += Fetch(s);
  b += Fetch(s + len - 4);
  c += Fetch(s + ((len >> 1) & 4));
  return fmix(seed ^ Mur(c, Mur(b, Mur(a, d))));
}

uint32_t Hash32(const char *s, size_t len) {
  if (len <= 24) {
    return len <= 12 ?
        (len <= 4 ? Hash32Len0to4(s, len) : Hash32Len5to12(s, len)) :
        Hash32Len13to24(s, len);
  }

  // len > 24
  uint32_t h = len, g = c1 * len, f = g;
  uint32_t a0 = Rotate(Fetch(s + len - 4) * c1, 17) * c2;
  uint32_t a1 = Rotate(Fetch(s + len - 8) * c1, 17) * c2;
  uint32_t a2 = Rotate(Fetch(s + len - 16) * c1, 17) * c2;
  uint32_t a3 = Rotate(Fetch(s + len - 12) * c1, 17) * c2;
  uint32_t a4 = Rotate(Fetch(s + len - 20) * c1, 17) * c2;
  h ^= a0;
  h = Rotate(h, 19);
  h = h * 5 + 0xe6546b64;
  h ^= a2;
  h = Rotate(h, 19);
  h = h * 5 + 0xe6546b64;
  g ^= a1;
  g = Rotate(g, 19);
  g = g * 5 + 0xe6546b64;
  g ^= a3;
  g = Rotate(g, 19);
  g = g * 5 + 0xe6546b64;
  f += a4;
  f = Rotate(f, 19) + 113;
  size_t iters = (len - 1) / 20;
  do {
    uint32_t a = Fetch(s);
    uint32_t b = Fetch(s + 4);
    uint32_t c = Fetch(s + 8);
    uint32_t d = Fetch(s + 12);
    uint32_t e = Fetch(s + 16);
    h += a;
    g += b;
    f += c;
    h = Mur(d, h) + e;
    g = Mur(c, g) + a;
    f = Mur(b + e * c1, f) + d;
    f += g;
    g += f;
    s += 20;
  } while (--iters != 0);
  g = Rotate(g, 11) * c1;
  g = Rotate(g, 17) * c1;
  f = Rotate(f, 11) * c1;
  f = Rotate(f, 17) * c1;
  h = Rotate(h + g, 19);
  h = h * 5 + 0xe6546b64;
  h = Rotate(h, 17) * c1;
  h = Rotate(h + f, 19);
  h = h * 5 + 0xe6546b64;
  h = Rotate(h, 17) * c1;
  return h;
}

uint32_t Hash32WithSeed(const char *s, size_t len, uint32_t seed) {
  if (len <= 24) {
    if (len >= 13) return Hash32Len13to24(s, len, seed * c1);
    else if (len >= 5) return Hash32Len5to12(s, len, seed);
    else return Hash32Len0to4(s, len, seed);
  }
  uint32_t h = Hash32Len13to24(s, 24, seed ^ len);
  return Mur(Hash32(s + 24, len - 24) + seed, h);
}
}  // namespace farmhashmk
namespace farmhashsu {
#if !can_use_sse42 || !can_use_aesni

uint32_t Hash32(const char *s, size_t len) {
  FARMHASH_DIE_IF_MISCONFIGURED;
  return s == NULL ? 0 : len;
}

uint32_t Hash32WithSeed(const char *s, size_t len, uint32_t seed) {
  FARMHASH_DIE_IF_MISCONFIGURED;
  return seed + Hash32(s, len);
}

#else

#undef Fetch
#define Fetch Fetch32

#undef Rotate
#define Rotate Rotate32

#undef Bswap
#define Bswap Bswap32

// Helpers for data-parallel operations (4x 32-bits).
STATIC_INLINE __m128i Add(__m128i x, __m128i y) { return _mm_add_epi32(x, y); }
STATIC_INLINE __m128i Xor(__m128i x, __m128i y) { return _mm_xor_si128(x, y); }
STATIC_INLINE __m128i Or(__m128i x, __m128i y) { return _mm_or_si128(x, y); }
STATIC_INLINE __m128i Mul(__m128i x, __m128i y) { return _mm_mullo_epi32(x, y); }
STATIC_INLINE __m128i Mul5(__m128i x) { return Add(x, _mm_slli_epi32(x, 2)); }
STATIC_INLINE __m128i RotateLeft(__m128i x, int c) {
  return Or(_mm_slli_epi32(x, c),
            _mm_srli_epi32(x, 32 - c));
}
STATIC_INLINE __m128i Rol17(__m128i x) { return RotateLeft(x, 17); }
STATIC_INLINE __m128i Rol19(__m128i x) { return RotateLeft(x, 19); }
STATIC_INLINE __m128i Shuffle0321(__m128i x) {
  return _mm_shuffle_epi32(x, (0 << 6) + (3 << 4) + (2 << 2) + (1 << 0));
}

uint32_t Hash32(const char *s, size_t len) {
  const uint32_t seed = 81;
  if (len <= 24) {
    return len <= 12 ?
        (len <= 4 ?
         farmhashmk::Hash32Len0to4(s, len) :
         farmhashmk::Hash32Len5to12(s, len)) :
        farmhashmk::Hash32Len13to24(s, len);
  }

  if (len < 40) {
    uint32_t a = len, b = seed * c2, c = a + b;
    a += Fetch(s + len - 4);
    b += Fetch(s + len - 20);
    c += Fetch(s + len - 16);
    uint32_t d = a;
    a = NAMESPACE_FOR_HASH_FUNCTIONS::Rotate32(a, 21);
    a = Mur(a, Mur(b, _mm_crc32_u32(c, d)));
    a += Fetch(s + len - 12);
    b += Fetch(s + len - 8);
    d += a;
    a += d;
    b = Mur(b, d) * c2;
    a = _mm_crc32_u32(a, b + c);
    return farmhashmk::Hash32Len13to24(s, (len + 1) / 2, a) + b;
  }

#undef Mulc1
#define Mulc1(x) Mul((x), cc1)

#undef Mulc2
#define Mulc2(x) Mul((x), cc2)

#undef Murk
#define Murk(a, h)                              \
  Add(k,                                        \
      Mul5(                                     \
          Rol19(                                \
              Xor(                              \
                  Mulc2(                        \
                      Rol17(                    \
                          Mulc1(a))),           \
                  (h)))))

  const __m128i cc1 = _mm_set1_epi32(c1);
  const __m128i cc2 = _mm_set1_epi32(c2);
  __m128i h = _mm_set1_epi32(seed);
  __m128i g = _mm_set1_epi32(c1 * seed);
  __m128i f = g;
  __m128i k = _mm_set1_epi32(0xe6546b64);
  __m128i q;
  if (len < 80) {
    __m128i a = Fetch128(s);
    __m128i b = Fetch128(s + 16);
    __m128i c = Fetch128(s + (len - 15) / 2);
    __m128i d = Fetch128(s + len - 32);
    __m128i e = Fetch128(s + len - 16);
    h = Add(h, a);
    g = Add(g, b);
    q = g;
    g = Shuffle0321(g);
    f = Add(f, c);
    __m128i be = Add(b, Mulc1(e));
    h = Add(h, f);
    f = Add(f, h);
    h = Add(Murk(d, h), e);
    k = Xor(k, _mm_shuffle_epi8(g, f));
    g = Add(Xor(c, g), a);
    f = Add(Xor(be, f), d);
    k = Add(k, be);
    k = Add(k, _mm_shuffle_epi8(f, h));
    f = Add(f, g);
    g = Add(g, f);
    g = Add(_mm_set1_epi32(len), Mulc1(g));
  } else {
    // len >= 80
    // The following is loosely modelled after farmhashmk::Hash32.
    size_t iters = (len - 1) / 80;
    len -= iters * 80;

#undef Chunk
#define Chunk() do {                            \
  __m128i a = Fetch128(s);                      \
  __m128i b = Fetch128(s + 16);                 \
  __m128i c = Fetch128(s + 32);                 \
  __m128i d = Fetch128(s + 48);                 \
  __m128i e = Fetch128(s + 64);                 \
  h = Add(h, a);                                \
  g = Add(g, b);                                \
  g = Shuffle0321(g);                           \
  f = Add(f, c);                                \
  __m128i be = Add(b, Mulc1(e));                \
  h = Add(h, f);                                \
  f = Add(f, h);                                \
  h = Add(h, d);                                \
  q = Add(q, e);                                \
  h = Rol17(h);                                 \
  h = Mulc1(h);                                 \
  k = Xor(k, _mm_shuffle_epi8(g, f));           \
  g = Add(Xor(c, g), a);                        \
  f = Add(Xor(be, f), d);                       \
  std::swap(f, q);                              \
  q = _mm_aesimc_si128(q);                      \
  k = Add(k, be);                               \
  k = Add(k, _mm_shuffle_epi8(f, h));           \
  f = Add(f, g);                                \
  g = Add(g, f);                                \
  f = Mulc1(f);                                 \
} while (0)

    q = g;
    while (iters-- != 0) {
      Chunk();
      s += 80;
    }

    if (len != 0) {
      h = Add(h, _mm_set1_epi32(len));
      s = s + len - 80;
      Chunk();
    }
  }

  g = Shuffle0321(g);
  k = Xor(k, g);
  k = Xor(k, q);
  h = Xor(h, q);
  f = Mulc1(f);
  k = Mulc2(k);
  g = Mulc1(g);
  h = Mulc2(h);
  k = Add(k, _mm_shuffle_epi8(g, f));
  h = Add(h, f);
  f = Add(f, h);
  g = Add(g, k);
  k = Add(k, g);
  k = Xor(k, _mm_shuffle_epi8(f, h));
  __m128i buf[4];
  buf[0] = f;
  buf[1] = g;
  buf[2] = k;
  buf[3] = h;
  s = reinterpret_cast<char*>(buf);
  uint32_t x = Fetch(s);
  uint32_t y = Fetch(s+4);
  uint32_t z = Fetch(s+8);
  x = _mm_crc32_u32(x, Fetch(s+12));
  y = _mm_crc32_u32(y, Fetch(s+16));
  z = _mm_crc32_u32(z * c1, Fetch(s+20));
  x = _mm_crc32_u32(x, Fetch(s+24));
  y = _mm_crc32_u32(y * c1, Fetch(s+28));
  uint32_t o = y;
  z = _mm_crc32_u32(z, Fetch(s+32));
  x = _mm_crc32_u32(x * c1, Fetch(s+36));
  y = _mm_crc32_u32(y, Fetch(s+40));
  z = _mm_crc32_u32(z * c1, Fetch(s+44));
  x = _mm_crc32_u32(x, Fetch(s+48));
  y = _mm_crc32_u32(y * c1, Fetch(s+52));
  z = _mm_crc32_u32(z, Fetch(s+56));
  x = _mm_crc32_u32(x, Fetch(s+60));
  return (o - x + y - z) * c1;
}

#undef Chunk
#undef Murk
#undef Mulc2
#undef Mulc1

uint32_t Hash32WithSeed(const char *s, size_t len, uint32_t seed) {
  if (len <= 24) {
    if (len >= 13) return farmhashmk::Hash32Len13to24(s, len, seed * c1);
    else if (len >= 5) return farmhashmk::Hash32Len5to12(s, len, seed);
    else return farmhashmk::Hash32Len0to4(s, len, seed);
  }
  uint32_t h = farmhashmk::Hash32Len13to24(s, 24, seed ^ len);
  return _mm_crc32_u32(Hash32(s + 24, len - 24) + seed, h);
}

#endif
}  // namespace farmhashsu
namespace farmhashsa {
#if !can_use_sse42

uint32_t Hash32(const char *s, size_t len) {
  FARMHASH_DIE_IF_MISCONFIGURED;
  return s == NULL ? 0 : len;
}

uint32_t Hash32WithSeed(const char *s, size_t len, uint32_t seed) {
  FARMHASH_DIE_IF_MISCONFIGURED;
  return seed + Hash32(s, len);
}

#else

#undef Fetch
#define Fetch Fetch32

#undef Rotate
#define Rotate Rotate32

#undef Bswap
#define Bswap Bswap32

// Helpers for data-parallel operations (4x 32-bits).
STATIC_INLINE __m128i Add(__m128i x, __m128i y) { return _mm_add_epi32(x, y); }
STATIC_INLINE __m128i Xor(__m128i x, __m128i y) { return _mm_xor_si128(x, y); }
STATIC_INLINE __m128i Or(__m128i x, __m128i y) { return _mm_or_si128(x, y); }
STATIC_INLINE __m128i Mul(__m128i x, __m128i y) { return _mm_mullo_epi32(x, y); }
STATIC_INLINE __m128i Mul5(__m128i x) { return Add(x, _mm_slli_epi32(x, 2)); }
STATIC_INLINE __m128i Rotate(__m128i x, int c) {
  return Or(_mm_slli_epi32(x, c),
            _mm_srli_epi32(x, 32 - c));
}
STATIC_INLINE __m128i Rot17(__m128i x) { return Rotate(x, 17); }
STATIC_INLINE __m128i Rot19(__m128i x) { return Rotate(x, 19); }
STATIC_INLINE __m128i Shuffle0321(__m128i x) {
  return _mm_shuffle_epi32(x, (0 << 6) + (3 << 4) + (2 << 2) + (1 << 0));
}

uint32_t Hash32(const char *s, size_t len) {
  const uint32_t seed = 81;
  if (len <= 24) {
    return len <= 12 ?
        (len <= 4 ?
         farmhashmk::Hash32Len0to4(s, len) :
         farmhashmk::Hash32Len5to12(s, len)) :
        farmhashmk::Hash32Len13to24(s, len);
  }

  if (len < 40) {
    uint32_t a = len, b = seed * c2, c = a + b;
    a += Fetch(s + len - 4);
    b += Fetch(s + len - 20);
    c += Fetch(s + len - 16);
    uint32_t d = a;
    a = NAMESPACE_FOR_HASH_FUNCTIONS::Rotate32(a, 21);
    a = Mur(a, Mur(b, Mur(c, d)));
    a += Fetch(s + len - 12);
    b += Fetch(s + len - 8);
    d += a;
    a += d;
    b = Mur(b, d) * c2;
    a = _mm_crc32_u32(a, b + c);
    return farmhashmk::Hash32Len13to24(s, (len + 1) / 2, a) + b;
  }

#undef Mulc1
#define Mulc1(x) Mul((x), cc1)

#undef Mulc2
#define Mulc2(x) Mul((x), cc2)

#undef Murk
#define Murk(a, h)                              \
  Add(k,                                        \
      Mul5(                                     \
          Rot19(                                \
              Xor(                              \
                  Mulc2(                        \
                      Rot17(                    \
                          Mulc1(a))),           \
                  (h)))))

  const __m128i cc1 = _mm_set1_epi32(c1);
  const __m128i cc2 = _mm_set1_epi32(c2);
  __m128i h = _mm_set1_epi32(seed);
  __m128i g = _mm_set1_epi32(c1 * seed);
  __m128i f = g;
  __m128i k = _mm_set1_epi32(0xe6546b64);
  if (len < 80) {
    __m128i a = Fetch128(s);
    __m128i b = Fetch128(s + 16);
    __m128i c = Fetch128(s + (len - 15) / 2);
    __m128i d = Fetch128(s + len - 32);
    __m128i e = Fetch128(s + len - 16);
    h = Add(h, a);
    g = Add(g, b);
    g = Shuffle0321(g);
    f = Add(f, c);
    __m128i be = Add(b, Mulc1(e));
    h = Add(h, f);
    f = Add(f, h);
    h = Add(Murk(d, h), e);
    k = Xor(k, _mm_shuffle_epi8(g, f));
    g = Add(Xor(c, g), a);
    f = Add(Xor(be, f), d);
    k = Add(k, be);
    k = Add(k, _mm_shuffle_epi8(f, h));
    f = Add(f, g);
    g = Add(g, f);
    g = Add(_mm_set1_epi32(len), Mulc1(g));
  } else {
    // len >= 80
    // The following is loosely modelled after farmhashmk::Hash32.
    size_t iters = (len - 1) / 80;
    len -= iters * 80;

#undef Chunk
#define Chunk() do {                            \
  __m128i a = Fetch128(s);                       \
  __m128i b = Fetch128(s + 16);                  \
  __m128i c = Fetch128(s + 32);                  \
  __m128i d = Fetch128(s + 48);                  \
  __m128i e = Fetch128(s + 64);                  \
  h = Add(h, a);                                \
  g = Add(g, b);                                \
  g = Shuffle0321(g);                           \
  f = Add(f, c);                                \
  __m128i be = Add(b, Mulc1(e));                \
  h = Add(h, f);                                \
  f = Add(f, h);                                \
  h = Add(Murk(d, h), e);                       \
  k = Xor(k, _mm_shuffle_epi8(g, f));           \
  g = Add(Xor(c, g), a);                        \
  f = Add(Xor(be, f), d);                       \
  k = Add(k, be);                               \
  k = Add(k, _mm_shuffle_epi8(f, h));           \
  f = Add(f, g);                                \
  g = Add(g, f);                                \
  f = Mulc1(f);                                 \
} while (0)

    while (iters-- != 0) {
      Chunk();
      s += 80;
    }

    if (len != 0) {
      h = Add(h, _mm_set1_epi32(len));
      s = s + len - 80;
      Chunk();
    }
  }

  g = Shuffle0321(g);
  k = Xor(k, g);
  f = Mulc1(f);
  k = Mulc2(k);
  g = Mulc1(g);
  h = Mulc2(h);
  k = Add(k, _mm_shuffle_epi8(g, f));
  h = Add(h, f);
  f = Add(f, h);
  g = Add(g, k);
  k = Add(k, g);
  k = Xor(k, _mm_shuffle_epi8(f, h));
  __m128i buf[4];
  buf[0] = f;
  buf[1] = g;
  buf[2] = k;
  buf[3] = h;
  s = reinterpret_cast<char*>(buf);
  uint32_t x = Fetch(s);
  uint32_t y = Fetch(s+4);
  uint32_t z = Fetch(s+8);
  x = _mm_crc32_u32(x, Fetch(s+12));
  y = _mm_crc32_u32(y, Fetch(s+16));
  z = _mm_crc32_u32(z * c1, Fetch(s+20));
  x = _mm_crc32_u32(x, Fetch(s+24));
  y = _mm_crc32_u32(y * c1, Fetch(s+28));
  uint32_t o = y;
  z = _mm_crc32_u32(z, Fetch(s+32));
  x = _mm_crc32_u32(x * c1, Fetch(s+36));
  y = _mm_crc32_u32(y, Fetch(s+40));
  z = _mm_crc32_u32(z * c1, Fetch(s+44));
  x = _mm_crc32_u32(x, Fetch(s+48));
  y = _mm_crc32_u32(y * c1, Fetch(s+52));
  z = _mm_crc32_u32(z, Fetch(s+56));
  x = _mm_crc32_u32(x, Fetch(s+60));
  return (o - x + y - z) * c1;
}

#undef Chunk
#undef Murk
#undef Mulc2
#undef Mulc1

uint32_t Hash32WithSeed(const char *s, size_t len, uint32_t seed) {
  if (len <= 24) {
    if (len >= 13) return farmhashmk::Hash32Len13to24(s, len, seed * c1);
    else if (len >= 5) return farmhashmk::Hash32Len5to12(s, len, seed);
    else return farmhashmk::Hash32Len0to4(s, len, seed);
  }
  uint32_t h = farmhashmk::Hash32Len13to24(s, 24, seed ^ len);
  return _mm_crc32_u32(Hash32(s + 24, len - 24) + seed, h);
}

#endif
}  // namespace farmhashsa
namespace farmhashcc {
// This file provides a 32-bit hash equivalent to CityHash32 (v1.1.1)
// and a 128-bit hash equivalent to CityHash128 (v1.1.1).  It also provides
// a seeded 32-bit hash function similar to CityHash32.

#undef Fetch
#define Fetch Fetch32

#undef Rotate
#define Rotate Rotate32

#undef Bswap
#define Bswap Bswap32

STATIC_INLINE uint32_t Hash32Len13to24(const char *s, size_t len) {
  uint32_t a = Fetch(s - 4 + (len >> 1));
  uint32_t b = Fetch(s + 4);
  uint32_t c = Fetch(s + len - 8);
  uint32_t d = Fetch(s + (len >> 1));
  uint32_t e = Fetch(s);
  uint32_t f = Fetch(s + len - 4);
  uint32_t h = len;

  return fmix(Mur(f, Mur(e, Mur(d, Mur(c, Mur(b, Mur(a, h)))))));
}

STATIC_INLINE uint32_t Hash32Len0to4(const char *s, size_t len) {
  uint32_t b = 0;
  uint32_t c = 9;
  for (size_t i = 0; i < len; i++) {
    signed char v = s[i];
    b = b * c1 + v;
    c ^= b;
  }
  return fmix(Mur(b, Mur(len, c)));
}

STATIC_INLINE uint32_t Hash32Len5to12(const char *s, size_t len) {
  uint32_t a = len, b = len * 5, c = 9, d = b;
  a += Fetch(s);
  b += Fetch(s + len - 4);
  c += Fetch(s + ((len >> 1) & 4));
  return fmix(Mur(c, Mur(b, Mur(a, d))));
}

uint32_t Hash32(const char *s, size_t len) {
  if (len <= 24) {
    return len <= 12 ?
        (len <= 4 ? Hash32Len0to4(s, len) : Hash32Len5to12(s, len)) :
        Hash32Len13to24(s, len);
  }

  // len > 24
  uint32_t h = len, g = c1 * len, f = g;
  uint32_t a0 = Rotate(Fetch(s + len - 4) * c1, 17) * c2;
  uint32_t a1 = Rotate(Fetch(s + len - 8) * c1, 17) * c2;
  uint32_t a2 = Rotate(Fetch(s + len - 16) * c1, 17) * c2;
  uint32_t a3 = Rotate(Fetch(s + len - 12) * c1, 17) * c2;
  uint32_t a4 = Rotate(Fetch(s + len - 20) * c1, 17) * c2;
  h ^= a0;
  h = Rotate(h, 19);
  h = h * 5 + 0xe6546b64;
  h ^= a2;
  h = Rotate(h, 19);
  h = h * 5 + 0xe6546b64;
  g ^= a1;
  g = Rotate(g, 19);
  g = g * 5 + 0xe6546b64;
  g ^= a3;
  g = Rotate(g, 19);
  g = g * 5 + 0xe6546b64;
  f += a4;
  f = Rotate(f, 19);
  f = f * 5 + 0xe6546b64;
  size_t iters = (len - 1) / 20;
  do {
    uint32_t a0 = Rotate(Fetch(s) * c1, 17) * c2;
    uint32_t a1 = Fetch(s + 4);
    uint32_t a2 = Rotate(Fetch(s + 8) * c1, 17) * c2;
    uint32_t a3 = Rotate(Fetch(s + 12) * c1, 17) * c2;
    uint32_t a4 = Fetch(s + 16);
    h ^= a0;
    h = Rotate(h, 18);
    h = h * 5 + 0xe6546b64;
    f += a1;
    f = Rotate(f, 19);
    f = f * c1;
    g += a2;
    g = Rotate(g, 18);
    g = g * 5 + 0xe6546b64;
    h ^= a3 + a1;
    h = Rotate(h, 19);
    h = h * 5 + 0xe6546b64;
    g ^= a4;
    g = Bswap(g) * 5;
    h += a4 * 5;
    h = Bswap(h);
    f += a0;
    PERMUTE3(f, h, g);
    s += 20;
  } while (--iters != 0);
  g = Rotate(g, 11) * c1;
  g = Rotate(g, 17) * c1;
  f = Rotate(f, 11) * c1;
  f = Rotate(f, 17) * c1;
  h = Rotate(h + g, 19);
  h = h * 5 + 0xe6546b64;
  h = Rotate(h, 17) * c1;
  h = Rotate(h + f, 19);
  h = h * 5 + 0xe6546b64;
  h = Rotate(h, 17) * c1;
  return h;
}

uint32_t Hash32WithSeed(const char *s, size_t len, uint32_t seed) {
  if (len <= 24) {
    if (len >= 13) return farmhashmk::Hash32Len13to24(s, len, seed * c1);
    else if (len >= 5) return farmhashmk::Hash32Len5to12(s, len, seed);
    else return farmhashmk::Hash32Len0to4(s, len, seed);
  }
  uint32_t h = farmhashmk::Hash32Len13to24(s, 24, seed ^ len);
  return Mur(Hash32(s + 24, len - 24) + seed, h);
}

#undef Fetch
#define Fetch Fetch64

#undef Rotate
#define Rotate Rotate64

#undef Bswap
#define Bswap Bswap64

STATIC_INLINE uint64_t ShiftMix(uint64_t val) {
  return val ^ (val >> 47);
}

STATIC_INLINE uint64_t HashLen16(uint64_t u, uint64_t v) {
  return Hash128to64(Uint128(u, v));
}

STATIC_INLINE uint64_t HashLen16(uint64_t u, uint64_t v, uint64_t mul) {
  // Murmur-inspired hashing.
  uint64_t a = (u ^ v) * mul;
  a ^= (a >> 47);
  uint64_t b = (v ^ a) * mul;
  b ^= (b >> 47);
  b *= mul;
  return b;
}

STATIC_INLINE uint64_t HashLen0to16(const char *s, size_t len) {
  if (len >= 8) {
    uint64_t mul = k2 + len * 2;
    uint64_t a = Fetch(s) + k2;
    uint64_t b = Fetch(s + len - 8);
    uint64_t c = Rotate(b, 37) * mul + a;
    uint64_t d = (Rotate(a, 25) + b) * mul;
    return HashLen16(c, d, mul);
  }
  if (len >= 4) {
    uint64_t mul = k2 + len * 2;
    uint64_t a = Fetch32(s);
    return HashLen16(len + (a << 3), Fetch32(s + len - 4), mul);
  }
  if (len > 0) {
    uint8_t a = s[0];
    uint8_t b = s[len >> 1];
    uint8_t c = s[len - 1];
    uint32_t y = static_cast<uint32_t>(a) + (static_cast<uint32_t>(b) << 8);
    uint32_t z = len + (static_cast<uint32_t>(c) << 2);
    return ShiftMix(y * k2 ^ z * k0) * k2;
  }
  return k2;
}

// Return a 16-byte hash for 48 bytes.  Quick and dirty.
// Callers do best to use "random-looking" values for a and b.
STATIC_INLINE pair<uint64_t, uint64_t> WeakHashLen32WithSeeds(
    uint64_t w, uint64_t x, uint64_t y, uint64_t z, uint64_t a, uint64_t b) {
  a += w;
  b = Rotate(b + a + z, 21);
  uint64_t c = a;
  a += x;
  a += y;
  b += Rotate(a, 44);
  return make_pair(a + z, b + c);
}

// Return a 16-byte hash for s[0] ... s[31], a, and b.  Quick and dirty.
STATIC_INLINE pair<uint64_t, uint64_t> WeakHashLen32WithSeeds(
    const char* s, uint64_t a, uint64_t b) {
  return WeakHashLen32WithSeeds(Fetch(s),
                                Fetch(s + 8),
                                Fetch(s + 16),
                                Fetch(s + 24),
                                a,
                                b);
}



// A subroutine for CityHash128().  Returns a decent 128-bit hash for strings
// of any length representable in signed long.  Based on City and Murmur.
STATIC_INLINE uint128_t CityMurmur(const char *s, size_t len, uint128_t seed) {
  uint64_t a = Uint128Low64(seed);
  uint64_t b = Uint128High64(seed);
  uint64_t c = 0;
  uint64_t d = 0;
  signed long l = len - 16;
  if (l <= 0) {  // len <= 16
    a = ShiftMix(a * k1) * k1;
    c = b * k1 + HashLen0to16(s, len);
    d = ShiftMix(a + (len >= 8 ? Fetch(s) : c));
  } else {  // len > 16
    c = HashLen16(Fetch(s + len - 8) + k1, a);
    d = HashLen16(b + len, c + Fetch(s + len - 16));
    a += d;
    do {
      a ^= ShiftMix(Fetch(s) * k1) * k1;
      a *= k1;
      b ^= a;
      c ^= ShiftMix(Fetch(s + 8) * k1) * k1;
      c *= k1;
      d ^= c;
      s += 16;
      l -= 16;
    } while (l > 0);
  }
  a = HashLen16(a, c);
  b = HashLen16(d, b);
  return Uint128(a ^ b, HashLen16(b, a));
}

uint128_t CityHash128WithSeed(const char *s, size_t len, uint128_t seed) {
  if (len < 128) {
    return CityMurmur(s, len, seed);
  }

  // We expect len >= 128 to be the common case.  Keep 56 bytes of state:
  // v, w, x, y, and z.
  pair<uint64_t, uint64_t> v, w;
  uint64_t x = Uint128Low64(seed);
  uint64_t y = Uint128High64(seed);
  uint64_t z = len * k1;
  v.first = Rotate(y ^ k1, 49) * k1 + Fetch(s);
  v.second = Rotate(v.first, 42) * k1 + Fetch(s + 8);
  w.first = Rotate(y + z, 35) * k1 + x;
  w.second = Rotate(x + Fetch(s + 88), 53) * k1;

  // This is the same inner loop as CityHash64(), manually unrolled.
  do {
    x = Rotate(x + y + v.first + Fetch(s + 8), 37) * k1;
    y = Rotate(y + v.second + Fetch(s + 48), 42) * k1;
    x ^= w.second;
    y += v.first + Fetch(s + 40);
    z = Rotate(z + w.first, 33) * k1;
    v = WeakHashLen32WithSeeds(s, v.second * k1, x + w.first);
    w = WeakHashLen32WithSeeds(s + 32, z + w.second, y + Fetch(s + 16));
    std::swap(z, x);
    s += 64;
    x = Rotate(x + y + v.first + Fetch(s + 8), 37) * k1;
    y = Rotate(y + v.second + Fetch(s + 48), 42) * k1;
    x ^= w.second;
    y += v.first + Fetch(s + 40);
    z = Rotate(z + w.first, 33) * k1;
    v = WeakHashLen32WithSeeds(s, v.second * k1, x + w.first);
    w = WeakHashLen32WithSeeds(s + 32, z + w.second, y + Fetch(s + 16));
    std::swap(z, x);
    s += 64;
    len -= 128;
  } while (LIKELY(len >= 128));
  x += Rotate(v.first + z, 49) * k0;
  y = y * k0 + Rotate(w.second, 37);
  z = z * k0 + Rotate(w.first, 27);
  w.first *= 9;
  v.first *= k0;
  // If 0 < len < 128, hash up to 4 chunks of 32 bytes each from the end of s.
  for (size_t tail_done = 0; tail_done < len; ) {
    tail_done += 32;
    y = Rotate(x + y, 42) * k0 + v.second;
    w.first += Fetch(s + len - tail_done + 16);
    x = x * k0 + w.first;
    z += w.second + Fetch(s + len - tail_done);
    w.second += v.first;
    v = WeakHashLen32WithSeeds(s + len - tail_done, v.first + z, v.second);
    v.first *= k0;
  }
  // At this point our 56 bytes of state should contain more than
  // enough information for a strong 128-bit hash.  We use two
  // different 56-byte-to-8-byte hashes to get a 16-byte final result.
  x = HashLen16(x, v.first);
  y = HashLen16(y + z, w.first);
  return Uint128(HashLen16(x + v.second, w.second) + y,
                 HashLen16(x + w.second, y + v.second));
}

STATIC_INLINE uint128_t CityHash128(const char *s, size_t len) {
  return len >= 16 ?
      CityHash128WithSeed(s + 16, len - 16,
                          Uint128(Fetch(s), Fetch(s + 8) + k0)) :
      CityHash128WithSeed(s, len, Uint128(k0, k1));
}

uint128_t Fingerprint128(const char* s, size_t len) {
  return CityHash128(s, len);
}
}  // namespace farmhashcc
namespace NAMESPACE_FOR_HASH_FUNCTIONS {

// BASIC STRING HASHING

// Hash function for a byte array.  See also Hash(), below.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint32_t Hash32(const char* s, size_t len) {
  return DebugTweak(
      (can_use_sse41 & x86_64) ? farmhashnt::Hash32(s, len) :
      (can_use_sse42 & can_use_aesni) ? farmhashsu::Hash32(s, len) :
      can_use_sse42 ? farmhashsa::Hash32(s, len) :
      farmhashmk::Hash32(s, len));
}

// Hash function for a byte array.  For convenience, a 32-bit seed is also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint32_t Hash32WithSeed(const char* s, size_t len, uint32_t seed) {
  return DebugTweak(
      (can_use_sse41 & x86_64) ? farmhashnt::Hash32WithSeed(s, len, seed) :
      (can_use_sse42 & can_use_aesni) ? farmhashsu::Hash32WithSeed(s, len, seed) :
      can_use_sse42 ? farmhashsa::Hash32WithSeed(s, len, seed) :
      farmhashmk::Hash32WithSeed(s, len, seed));
}

// Hash function for a byte array.  For convenience, a 64-bit seed is also
// hashed into the result.  See also Hash(), below.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint64_t Hash64(const char* s, size_t len) {
  return DebugTweak(
      (can_use_sse42 & x86_64) ?
      farmhashte::Hash64(s, len) :
      farmhashxo::Hash64(s, len));
}

// Hash function for a byte array.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
size_t Hash(const char* s, size_t len) {
  return sizeof(size_t) == 8 ? Hash64(s, len) : Hash32(s, len);
}

// Hash function for a byte array.  For convenience, a 64-bit seed is also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint64_t Hash64WithSeed(const char* s, size_t len, uint64_t seed) {
  return DebugTweak(farmhashna::Hash64WithSeed(s, len, seed));
}

// Hash function for a byte array.  For convenience, two seeds are also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint64_t Hash64WithSeeds(const char* s, size_t len, uint64_t seed0, uint64_t seed1) {
  return DebugTweak(farmhashna::Hash64WithSeeds(s, len, seed0, seed1));
}

// Hash function for a byte array.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint128_t Hash128(const char* s, size_t len) {
  return DebugTweak(farmhashcc::Fingerprint128(s, len));
}

// Hash function for a byte array.  For convenience, a 128-bit seed is also
// hashed into the result.
// May change from time to time, may differ on different platforms, may differ
// depending on NDEBUG.
uint128_t Hash128WithSeed(const char* s, size_t len, uint128_t seed) {
  return DebugTweak(farmhashcc::CityHash128WithSeed(s, len, seed));
}

// BASIC NON-STRING HASHING

// FINGERPRINTING (i.e., good, portable, forever-fixed hash functions)

// Fingerprint function for a byte array.  Most useful in 32-bit binaries.
uint32_t Fingerprint32(const char* s, size_t len) {
  return farmhashmk::Hash32(s, len);
}

// Fingerprint function for a byte array.
uint64_t Fingerprint64(const char* s, size_t len) {
  return farmhashna::Hash64(s, len);
}

// Fingerprint function for a byte array.
uint128_t Fingerprint128(const char* s, size_t len) {
  return farmhashcc::Fingerprint128(s, len);
}

// Older and still available but perhaps not as fast as the above:
//   farmhashns::Hash32{,WithSeed}()

}  // namespace NAMESPACE_FOR_HASH_FUNCTIONS

#if FARMHASHSELFTEST

#ifndef FARMHASH_SELF_TEST_GUARD
#define FARMHASH_SELF_TEST_GUARD
#include <cstdio>
#include <iostream>
#include <string.h>

using std::cout;
using std::cerr;
using std::endl;
using std::hex;

static const uint64_t kSeed0 = 1234567;
static const uint64_t kSeed1 = k0;
static const int kDataSize = 1 << 20;
static const int kTestSize = 300;
#define kSeed128 Uint128(kSeed0, kSeed1)

static char data[kDataSize];

static int completed_self_tests = 0;
static int errors = 0;

// Initialize data to pseudorandom values.
void Setup() {
  if (completed_self_tests == 0) {
    uint64_t a = 9;
    uint64_t b = 777;
    for (int i = 0; i < kDataSize; i++) {
      a += b;
      b += a;
      a = (a ^ (a >> 41)) * k0;
      b = (b ^ (b >> 41)) * k0 + i;
      uint8_t u = b >> 37;
      memcpy(data + i, &u, 1);  // uint8_t -> char
    }
  }
}

int NoteErrors() {
#define NUM_SELF_TESTS 9
  if (++completed_self_tests == NUM_SELF_TESTS)
    std::exit(errors > 0);
  return errors;
}

template <typename T> inline bool IsNonZero(T x) {
  return x != 0;
}

template <> inline bool IsNonZero<uint128_t>(uint128_t x) {
  return x != Uint128(0, 0);
}

#endif  // FARMHASH_SELF_TEST_GUARD

namespace farmhashccTest {

uint32_t CreateSeed(int offset, int salt) {
  uint32_t h = static_cast<uint32_t>(salt & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h += static_cast<uint32_t>(offset & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  return h;
}

#undef SEED
#undef SEED1
#undef SEED0
#define SEED CreateSeed(offset, -1)
#define SEED0 CreateSeed(offset, 0)
#define SEED1 CreateSeed(offset, 1)

#undef TESTING
#define TESTING 1
#if TESTING
uint32_t expected[] = {
4223616069u,
3696677242u,
1039179260u, 1690343979u, 1018511555u, 2464489001u,
20368522u, 2663783964u, 175201532u, 1619210592u,
4081014168u,
2576519988u,
3285042206u, 502478099u, 739479538u, 1500332790u,
13754768u, 3789353455u, 3473868058u, 1909255088u,
2212771159u,
1112731063u,
826915357u, 2893489933u, 118369799u, 1848668220u,
1308219822u, 249416982u, 64306364u, 4221800195u,
1020067935u,
3955445564u,
563346294u, 550236731u, 2339016688u, 1826259714u,
3872358639u, 2295981050u, 1870005390u, 4015628802u,
1451961420u,
653440099u,
1292493871u, 164377749u, 1717712483u, 463414587u,
3924343675u, 1050492084u, 3566618804u, 2046983362u,
31917516u,
2957164615u,
230718965u, 999595115u, 3534822176u, 2175709186u,
965707431u, 441796222u, 2481718051u, 1827777486u,
2590087362u,
3879448744u,
3515079898u, 1601433082u, 982764532u, 254808716u,
1293372530u, 4205605817u, 947001462u, 1138890052u,
176305566u,
2447367541u,
2973802542u, 4123621138u, 3083865840u, 1706367795u,
792114347u, 2880110657u, 440613768u, 195054868u,
1359016305u,
3363804638u,
649488537u, 1624045597u, 1441938215u, 3147758996u,
3199173578u, 2597283203u, 2191333609u, 3763129144u,
1117290165u,
1062549743u,
2565615889u, 1046361554u, 1581968261u, 1058773671u,
1123053168u, 3807622275u, 1486749916u, 3900816089u,
2437877004u,
1894455839u,
1912520953u, 1914997013u, 561048608u, 1643267444u,
3671572006u, 194811086u, 1468911468u, 2179206286u,
673206794u,
3486923651u,
3741426466u, 3292160512u, 697001377u, 1900763774u,
3726097344u, 629282039u, 3578723715u, 2868028489u,
3269862919u,
2303349487u,
3643953525u, 2307255916u, 849996280u, 732080434u,
909961480u, 3542445214u, 2628347095u, 4236856917u,
1380660650u,
2631821908u,
2007289004u, 3509705198u, 3788541675u, 789457322u,
3090670546u, 638977894u, 3503881773u, 947102987u,
1525325287u,
1816697045u,
2706647405u, 288763142u, 3505438495u, 481308609u,
2882636782u, 3745162621u, 3503467033u, 428247823u,
176408838u,
333551502u,
1001068721u, 1681483651u, 75380831u, 4191469679u,
3627361839u, 2736617386u, 3120737438u, 1297502456u,
864896482u,
85674920u,
2886047255u, 4119881331u, 2496990525u, 3442502055u,
1806582817u, 3186345024u, 4099591287u, 2560171465u,
3489229104u,
3065015872u,
2755089808u, 3098442882u, 378524719u, 2664097023u,
1771960725u, 2901182183u, 55258521u, 1266621443u,
581644891u,
37790450u,
1800731704u, 3601350920u, 53428754u, 2759476837u,
3391093099u, 1496510311u, 2511119507u, 2636877410u,
631613207u,
1573846064u,
260484875u, 1088212603u, 2369525206u, 322522428u,
3191396600u, 2076543340u, 1552496658u, 2739811558u,
3867875546u,
2051584261u,
2126250818u, 901517871u, 3651631165u, 1323139145u,
1521111765u, 477802997u, 3508559783u, 383954241u,
3804516756u,
4250206331u,
2655954340u, 2484996477u, 1417544845u, 1520282298u,
2745204366u, 2869345147u, 1872738335u, 2592877343u,
1619744564u,
1804962124u,
3458679890u, 423948620u, 273645618u, 4187865426u,
376057175u, 2943431463u, 3581950599u, 1035398331u,
1088213445u,
861988903u,
1323370244u, 777069428u, 506235917u, 369720851u,
2789995854u, 230915180u, 1505086948u, 940361236u,
3727873235u,
1159167499u,
1860302871u, 3456858862u, 3923555152u, 2131072714u,
2910461068u, 3671950363u, 2010742682u, 4088068851u,
3616470388u,
2087714788u,
221675509u, 1230154072u, 3450704646u, 1463226695u,
1998357699u, 266026801u, 619568740u, 3560427266u,
4148162586u,
3150417316u,
1356375822u, 2056097622u, 627905802u, 3881675638u,
2309738053u, 971916703u, 3447805361u, 1673575328u,
673084328u,
3317849401u,
2836362782u, 2377208890u, 3275350588u, 158350552u,
2553241779u, 2497264995u, 3262882649u, 3897937187u,
1598963653u,
3068514414u,
601541505u, 374517071u, 3380795976u, 235752573u,
284670003u, 2990192160u, 904937105u, 2306579150u,
2117362589u,
1635274830u,
3355572906u, 170799903u, 1226685528u, 664567688u,
413219134u, 878324258u, 4026159448u, 3620649295u,
1823625377u,
3175888439u,
1759344347u, 2640637095u, 3549558u, 2192984935u,
978623493u, 804017880u, 3877562323u, 3843116489u,
1641748342u,
1853539444u,
3001178468u, 3443560727u, 2685426077u, 1653064722u,
349231508u, 2726789654u, 3136215581u, 768402830u,
269384321u,
531936536u,
2592883487u, 1343156334u, 3628619802u, 1477143570u,
4269458419u, 3285611028u, 959104925u, 2712290710u,
3480237248u,
835796333u,
2020636251u, 1191914589u, 126521603u, 4288023938u,
3731699932u, 2136758855u, 985780142u, 193807575u,
1850544433u,
653947619u,
3929316796u, 381871169u, 950486363u, 1787262279u,
360480382u, 1800636585u, 1039258631u, 3682073259u,
1262819303u,
1786000319u,
1570627191u, 893065837u, 301304916u, 1478469809u,
623018819u, 2742232545u, 2058913014u, 1706060059u,
2421125401u,
1315829592u,
3208766775u, 1805586156u, 575853086u, 3085025513u,
4010908260u, 2344058256u, 3814407434u, 1458485673u,
2474514786u,
3581895658u,
2710719679u, 190812706u, 2135454262u, 2620080728u,
3400757986u, 1669914857u, 1559978393u, 1629811331u,
3096616493u,
1391424435u,
4158376003u, 1015657076u, 794783832u, 479952178u,
1150290207u, 2497437906u, 231815090u, 755078067u,
3832053281u,
63649475u,
2415822606u, 4105027719u, 1706992318u, 1106598740u,
3941945667u, 1271300761u, 505882259u, 760186809u,
2657183368u,
1925422058u,
1039773764u, 880219458u, 4275949176u, 1556833823u,
925882132u, 4216310340u, 757497522u, 461833914u,
3884002070u,
2790957660u,
2100050089u, 651959176u, 1380301291u, 1289124125u,
452314403u, 226156280u, 3306924715u, 1750807758u,
2290180542u,
1953760569u,
2253069096u, 3960924806u, 1786291620u, 60736185u,
2569018293u, 3870479674u, 2247005661u, 2239850953u,
4261808536u,
3282975782u,
780945879u, 3349849383u, 1579362556u, 2265045884u,
905088740u, 725212379u, 3156479246u, 2501620391u,
3062836263u,
4070422690u,
996797869u, 4082582315u, 976105756u, 303983602u,
1862104804u, 3864508254u, 3383979677u, 2835500286u,
2798364010u,
519359476u,
3447342725u, 194373889u, 3313466630u, 232399983u,
2841787856u, 1672751454u, 3345183154u, 1805381384u,
2226129336u,
2847829057u,
2350774567u, 2838540121u, 2757948482u, 1017002062u,
2329150951u, 2171488196u, 3668619047u, 3874977844u,
3287966998u,
262346753u,
2493054715u, 2298644430u, 2926101182u, 1528457638u,
598656233u, 2615845874u, 989110727u, 820441411u,
253617372u,
2201077208u,
2047569338u, 3114356329u, 3335563734u, 2967673540u,
768438341u, 1417708203u, 3873718246u, 1538441843u,
1279167650u,
3917966776u,
2218481734u, 1015935150u, 1957845042u, 1318150213u,
3146423971u, 4218994877u, 1162470863u, 1519718292u,
2594658906u,
665870414u,
3430347817u, 3933868731u, 1597041394u, 3138684682u,
3398212027u, 1064647658u, 1576321132u, 14792918u,
224938029u,
3706456050u,
847274786u, 2645698692u, 1743374687u, 2343133224u,
3066596790u, 2857270120u, 200596308u, 452055528u,
2319312082u,
3488655402u,
4146865894u, 608206438u, 2699777051u, 3687240713u,
327957508u, 3664730153u, 568134564u, 2993484554u,
4159860363u,
4274533921u,
1079994063u, 2360220210u, 3609597760u, 3639708902u,
2836180437u, 1069910270u, 1892427666u, 1874729790u,
1267712826u,
121886940u,
3572289214u, 2475945610u, 783779452u, 588827737u,
1531395014u, 2085084212u, 2219189792u, 3981444548u,
2218885336u,
1691622694u,
2053232885u, 1386558530u, 2182946189u, 2365247285u,
1871081313u, 2935751853u, 38413723u, 543465863u,
900691890u,
2899905665u,
575120562u, 93133904u, 457154948u, 2983705792u,
4232229200u, 2038565963u, 614693984u, 3405328302u,
4083090010u,
2088004171u,
244031209u, 1861889294u, 2417109253u, 3299562328u,
4158642443u, 4199064449u, 3161611046u, 885015950u,
3677904099u,
2969861785u,
772348805u, 1712263832u, 3219357614u, 484271305u,
3645706114u, 2059620251u, 409557488u, 2278896731u,
224475749u,
3523022952u,
2057140088u, 449131785u, 1149879244u, 4255363996u,
3602720135u, 1690010854u, 2503998822u, 2750828466u,
3340671802u,
1447583863u,
2649684943u, 2764747249u, 3046070595u, 3441726138u,
3840332559u, 3156747501u, 1288666680u, 1472744459u,
3452391933u,
1617542784u,
217869690u, 3718469527u, 348639731u, 590532355u,
43789787u, 22606314u, 1621559290u, 2231743261u,
2234620879u,
544748955u,
3169387920u, 203343594u, 3272552527u, 1078282365u,
809576321u, 854207584u, 3625491053u, 1193737267u,
1628966807u,
2661421060u,
2433442061u, 3886639039u, 2149304418u, 303000565u,
1432830882u, 137378235u, 1135974068u, 318705754u,
2491227157u,
2627534472u,
3520352233u, 2488397682u, 3969194920u, 3843962181u,
2135981459u, 2611933220u, 799460731u, 2300968851u,
3412851628u,
3070914013u,
3555224260u, 4125937572u, 240359903u, 722496673u,
2061023600u, 3843919221u, 2759960043u, 1191155322u,
1504041490u,
3735253656u,
1773124736u, 101110011u, 1627699578u, 2645634551u,
263603947u, 1388368439u, 677146538u, 1644201982u,
2625699644u,
2403862553u,
2426069017u, 3613511705u, 915141802u, 2981654265u,
3474818167u, 2611101773u, 627891434u, 762754924u,
2143021902u,
51067670u,
4017746573u, 2269879853u, 3037857950u, 2388899692u,
582729171u, 1886116725u, 2281219772u, 264704948u,
3509984037u,
4078683368u,
2172959411u, 1807195632u, 3357092302u, 2253764928u,
2320369390u, 3076335959u, 2623583210u, 168378015u,
1435562650u,
1100977467u,
3160490319u, 2550328495u, 2396855930u, 1347823908u,
1617990918u, 3849653099u, 3224111576u, 1681539821u,
4171542880u,
552200045u,
3562947778u, 1676237880u, 3747732307u, 2453332913u,
865530667u, 3566636849u, 3485502777u, 336779723u,
2535942410u,
1685000184u,
820545711u, 1893670486u, 1273910461u, 1193758569u,
970365241u, 381205962u, 3612810852u, 1160577445u,
541488143u,
4005031080u,
2333965236u, 2419855455u, 3484533538u, 3073937876u,
908466956u, 661391539u, 2342122412u, 1467049112u,
1785800827u,
135343033u,
139643209u, 2438375667u, 974654058u, 3216478230u,
3807620420u, 779043363u, 2812846449u, 333254784u,
1025244024u,
2242303095u,
2476683742u, 350018683u, 174652916u, 933097576u,
826905896u, 559603581u, 2777181260u, 164915169u,
4070353203u,
1459055748u,
297303985u, 3103837241u, 3812514233u, 232265137u,
2032819099u, 1523091376u, 3531238208u, 1403510182u,
2886832080u,
2599705941u,
2789695716u, 68437968u, 3823813791u, 1040994569u,
3024194990u, 2461740520u, 3735391266u, 2042207153u,
2461678616u,
3519231840u,
1344224923u, 411442756u, 1179779351u, 7661528u,
778352196u, 3288808867u, 589356197u, 2627504511u,
3374744599u,
3312172905u,
357423007u, 3539567796u, 4044452215u, 1445118403u,
2937983820u, 184089910u, 346201845u, 2427295202u,
1345448010u,
2884434843u,
3085001879u, 2640105409u, 315310640u, 3530289798u,
3362974764u, 963602652u, 75228477u, 3509381180u,
4012777756u,
2380345941u,
1073137836u, 2083960378u, 1220315185u, 3628720934u,
3508867818u, 67148343u, 3558085158u, 1753943368u,
863309561u,
2844713625u,
441921850u, 854732254u, 816793316u, 2555428747u,
3440623414u, 1707304366u, 3189874375u, 1623229221u,
1220335976u,
806745430u,
3909262947u, 1680369031u, 2926179486u, 3410391660u,
3991630434u, 2876458763u, 1179167079u, 536360759u,
1592117159u,
1514343977u,
1032622306u, 2057494855u, 784938958u, 178402996u,
1152907972u, 2326185495u, 2939973666u, 4181120253u,
552831733u,
664251856u,
1297139539u, 1969357631u, 1474065957u, 3055419017u,
3395829380u, 3316562752u, 2168409017u, 614624786u,
3585854336u,
668291094u,
1162889217u, 3773171307u, 2263271126u, 355089668u,
3195850578u, 3396793277u, 3519870267u, 527857605u,
3972392320u,
2224315010u,
4047225561u, 3271434798u, 3192704713u, 2798505213u,
3932215896u, 3792924012u, 3796843756u, 453872975u,
4050552799u,
1056432676u,
928166947u, 121311642u, 930989547u, 2087070683u,
1288978057u, 1556325239u, 1812435626u, 1682385724u,
1214364933u,
904760776u,
3957045528u, 3949822847u, 2411065880u, 3716420732u,
3424837835u, 3833550693u, 1799375326u, 2012368921u,
2768764136u,
1786111037u,
4055479315u, 3751639533u, 2808224623u, 3492656387u,
1306824780u, 2624000170u, 3134795218u, 1778409297u,
3900821801u,
593336325u,
2772069220u, 2980873673u, 3574497158u, 3994780459u,
4246519854u, 3482758570u, 4228015183u, 33101083u,
1769887734u,
4158035314u,
3690638998u, 1119035482u, 4134969651u, 2483207353u,
3932823321u, 285829887u, 3485140138u, 1304815138u,
995608264u,
3133997465u,
1195477617u, 2147693728u, 3506673112u, 4234467492u,
1183174337u, 1395340482u, 769199343u, 193262308u,
2798920256u,
3827889422u,
3399695609u, 3036045724u, 2999477386u, 3567001759u,
2682864314u, 1414023907u, 3699872975u, 3369870701u,
2662284872u,
2179640019u,
2485080099u, 3234415609u, 3755915606u, 1339453220u,
1567403399u, 2076272391u, 293946298u, 3861962750u,
1291949822u,
2916864995u,
132642326u, 2215117062u, 2205863575u, 2488805750u,
405632860u, 3248129390u, 2952606864u, 896734759u,
2047417173u,
3865951392u,
657296855u, 1328547532u, 3966511825u, 3959682388u,
4171801020u, 2981416957u, 1868896247u, 790081075u,
3143666398u,
2950766549u,
2065854887u, 2737081890u, 995061774u, 1510712611u,
2865954809u, 565044286u, 1565631102u, 1500654931u,
494822108u,
2803515503u,
1058154996u, 3506280187u, 856885925u, 4204610546u,
800905649u, 1130711562u, 558146282u, 2053400666u,
449794061u,
2643520245u,
2101248725u, 3123292429u, 3583524041u, 983372394u,
1587743780u, 672870813u, 444833475u, 100741452u,
366232251u,
1717951248u,
524144122u, 1362432726u, 1304947719u, 674306020u,
405665887u, 4081931036u, 1580408204u, 2343242778u,
3901654006u,
2627173567u,
3015148205u, 814686701u, 1327920712u, 1346494176u,
2468632605u, 2259795544u, 2519278184u, 2129281928u,
2860266380u,
4001619412u,
1154910973u, 2841022216u, 1199925485u, 1372200293u,
2713179055u, 3609776550u, 2896463880u, 1056406892u,
177413841u,
40180172u,
3274788406u, 660921784u, 1686225028u, 4003382965u,
2532691887u, 4256809101u, 1186018983u, 667359096u,
2375266493u,
2760222015u,
745187078u, 312264012u, 396822261u, 2588536966u,
2026998998u, 1766454365u, 3218807676u, 3915487497u,
2630550356u,
4130063378u,
4231937074u, 752212123u, 3085144349u, 3267186363u,
4103872100u, 4193207863u, 1306401710u, 3014853131u,
1067760598u,
2306188342u,
2437881506u, 4258185052u, 2506507580u, 130876929u,
1076894205u, 4106981702u, 2799540844u, 945747327u,
1436722291u,
2499772225u,
2571537041u, 2038830635u, 2066826058u, 2892892912u,
524875858u, 3392572161u, 2869992096u, 1308273341u,
923668994u,
1980407857u,
2275009652u, 240598096u, 2658376530u, 3505603048u,
1022603789u, 582423424u, 846379327u, 4092636095u,
4177298326u,
1004173023u,
2154027018u, 2993634669u, 1098364089u, 3035642175u,
1335688126u, 1376393415u, 1252369770u, 3815033328u,
1999309358u,
1234054757u,
1388595255u, 2859334775u, 366532860u, 3453410395u,
4226967708u, 1321729870u, 2078463405u, 156766592u,
3157683394u,
3549293384u,
3348214547u, 2879648344u, 1144813399u, 2758966254u,
647753581u, 813615926u, 2035441590u, 1961053117u,
600168686u,
2192833387u,
3156481401u, 3627320321u, 383550248u, 81209584u,
2339331745u, 1284116690u, 1980144976u, 2955724163u,
789301728u,
3842040415u,
1115881490u, 965249078u, 4098663322u, 1870257033u,
2923150701u, 4217108433u, 183816559u, 2104089285u,
2640095343u,
3173757052u,
927847464u, 2383114981u, 4287174363u, 1886129652u,
70635161u, 1182924521u, 1121440038u, 4246220730u,
3890583049u,
975913757u,
2436253031u, 1074894869u, 1301280627u, 992471939u,
735658128u, 244441856u, 1541612456u, 3457776165u,
3503534059u,
1931651133u,
349142786u, 3669028584u, 1828812038u, 99128389u,
1364272849u, 1963678455u, 3971963311u, 2316950886u,
1308901796u,
2789591580u,
1460494965u, 2380227479u, 1577190651u, 1755822080u,
2911014607u, 859387544u, 13023113u, 2319243370u,
2522582211u,
2299110490u,
3342378874u, 2589323490u, 1884430765u, 3739058655u,
2419330954u, 355389916u, 273950915u, 3670136553u,
410946824u,
3174041420u,
2609010298u, 3059091350u, 2300275014u, 725729828u,
2548380995u, 1738849964u, 1257081412u, 79430455u,
810321297u,
3246190593u,
1007937684u, 912115394u, 40880059u, 3450073327u,
4289832174u, 2253485111u, 1065639151u, 2953189309u,
124779113u,
654299738u,
115760833u, 1250932069u, 884995826u, 3998908281u,
1382882981u, 1134187162u, 3202324501u, 487502928u,
3032756345u,
4057517628u,
933197381u, 2319223127u, 2044528655u, 2554572663u,
4049450620u, 1620812836u, 2832905391u, 2273005481u,
1913090121u,
1055456023u,
510593296u, 3285343192u, 2912822536u, 1645225063u,
638418430u, 452701300u, 1025483165u, 1639370512u,
167948643u,
2809842730u,
2983135664u, 407521332u, 1543756616u, 3949773145u,
4283462892u, 659962275u, 3878013463u, 1000748756u,
4053212051u,
4099239406u,
3467581965u, 354635541u, 21301844u, 3831212473u,
3189450571u, 2264401966u, 4096484849u, 1736448515u,
3976926096u,
3727194724u,
2243487039u, 585209095u, 3143046007u, 969558123u,
3037113502u, 3594170243u, 2835860223u, 3775493975u,
2787220812u,
2274252217u,
2915380701u, 3077533278u, 1252871826u, 1519790952u,
205297661u, 2950557658u, 3956882191u, 2724439401u,
3694608025u,
124028038u,
216019153u, 1533010676u, 2259986336u, 2014061617u,
2068617849u, 3078123052u, 2692046098u, 1582812948u,
396916232u,
1470894001u,
1694309312u, 300268215u, 1553892743u, 671176040u,
1544988994u, 2793402821u, 4194972569u, 2296476154u,
748354332u,
3491325898u,
4261053291u, 1104998242u, 797816835u, 243564059u,
2197717393u, 299029458u, 1675252188u, 3139770041u,
583018574u,
2532106100u,
2099391658u, 3760526730u, 3422719327u, 3556917689u,
2374009285u, 2130865894u, 3710563151u, 1437538307u,
3938030842u,
2006930694u,
2151243336u, 1939741287u, 1957068175u, 2135147479u,
649553342u, 1713643042u, 4188696599u, 1698739939u,
3549427584u,
1016382174u,
322644378u, 2476164549u, 2037263020u, 88036019u,
2548960923u, 539867919u, 2871157727u, 4031659929u,
754087252u,
972656559u,
4246379429u, 3877308578u, 2059459630u, 3614934323u,
1410565271u, 2102980459u, 215395636u, 1083393481u,
3775523015u,
2062750105u,
2475645882u, 3041186774u, 3534315423u, 758607219u,
1686100614u, 180500983u, 1155581185u, 1476664671u,
2918661695u,
3812731350u,
4003853737u, 4148884881u, 1468469436u, 3278880418u,
1045838071u, 1049161262u, 360450415u, 3158065524u,
814443735u,
3391401707u,
729968410u, 738771593u, 3662738792u, 1672830580u,
4199496163u, 188487238u, 219098233u, 2141731267u,
3890250614u,
2988780375u,
4026279523u, 3489429375u, 2468433807u, 1178270701u,
2685094218u, 2716621497u, 3718335529u, 2273344755u,
701110882u,
1925717409u,
1515176562u, 2325460593u, 3954798930u, 784566105u,
3769422266u, 1641530321u, 2703876862u, 2907480267u,
1828076455u,
1805635221u,
3883381245u, 1476756210u, 2072514392u, 3658557081u,
2003610746u, 2556845550u, 729594004u, 3303898266u,
1968227254u,
423204951u,
231828688u, 4223697811u, 698619045u, 3636824418u,
2738779239u, 2333529003u, 2833158642u, 580285428u,
3038148234u,
1012378004u,
1113647298u, 1424593483u, 4053247723u, 1167152941u,
2677383578u, 3419485379u, 2135673840u, 440478166u,
1682229112u,
3226724137u,
1217439806u, 3828726923u, 3636576271u, 3467643156u,
2005614908u, 2655346461u, 2345488441u, 1027557096u,
3594084220u,
1372306343u,
2342583762u, 4291342905u, 4094931814u, 3254771759u,
821978248u, 2404930117u, 1143937655u, 3156949255u,
3460606610u,
449701786u,
3474906110u, 1932585294u, 2283357584u, 1808481478u,
3522851029u, 3040164731u, 1530172182u, 2950426149u,
1402416557u,
756419859u,
4132576145u, 724994790u, 2852015871u, 2177908339u,
899914731u, 139675671u, 1423281870u, 3198458070u,
807581308u,
2021611521u,
1801452575u, 1425984297u, 2833835949u, 1536827865u,
3902351840u, 164546042u, 1872840974u, 3986194780u,
792156290u,
3378681896u,
941547959u, 3931328334u, 3661060482u, 2386420777u,
3920146272u, 3458621279u, 3348500844u, 2269586542u,
797371473u,
3188953649u,
80514771u, 2913333490u, 1246325623u, 3253846094u,
1723906239u, 1606413555u, 587500718u, 1412413859u,
2310046829u,
2113313263u,
3855635608u, 47271944u, 1112281934u, 3440228404u,
2633519166u, 425094457u, 307659635u, 67338587u,
2412987939u,
2363930989u,
2853008596u, 2844637339u, 922568813u, 130379293u,
2825204405u, 2904442145u, 1176875333u, 1511685505u,
599177514u,
1872681372u,
682394826u, 1888849790u, 3635304282u, 1761257265u,
1571292431u, 355247075u, 1177210823u, 1691529530u,
3629531121u,
3760474006u,
1129340625u, 868116266u, 3908237785u, 1942124366u,
1266630014u, 3214841995u, 334023850u, 1110037019u,
369650727u,
1288666741u,
70535706u, 20230114u, 4284225520u, 727856157u,
293696779u, 1244943770u, 3976592462u, 560421917u,
4171688499u,
2438786950u,
1218144639u, 3809125983u, 1302395746u, 534542359u,
2121993015u, 2899519374u, 3192177626u, 1761707794u,
3101683464u,
1555403906u,
3225675390u, 1875263768u, 4278894569u, 651707603u,
2111591484u, 3802716028u, 2900262228u, 1181469202u,
3254743797u,
1822684466u,
860641829u, 3046128268u, 1284833012u, 1125261608u,
461384524u, 2331344566u, 1274400010u, 990498321u,
3462536298u,
3796842585u,
2346607194u, 279495949u, 3951194590u, 3522664971u,
3169688303u, 726831706u, 1123875117u, 1816166599u,
3759808754u,
2918558151u,
3713203220u, 3369939267u, 466047109u, 384042536u,
587271104u, 2191634696u, 2449929095u, 1157932232u,
2084466674u,
841370485u,
3241372562u, 4277738486u, 2150836793u, 1173569449u,
778768930u, 2594706485u, 3065269405u, 3019263663u,
2660146610u,
2789946230u,
77056913u, 728174395u, 3647185904u, 804562358u,
2697276483u, 881311175u, 1178696435u, 2059173891u,
2308303791u,
221481230u,
50241451u, 3689414100u, 1969074761u, 2732071529u,
1900890356u, 840789500u, 2100609300u, 985565597u,
1220850414u,
2456636259u,
223607678u, 1016310244u, 1937434395u, 85717256u,
275058190u, 3712011133u, 171916016u, 2389569096u,
3679765802u,
3575358777u,
3481108261u, 3178286380u, 2489642395u, 2931039055u,
3086601621u, 3079518902u, 3027718495u, 2506894644u,
2976869602u,
2134336365u,
2420172217u, 918054427u, 661522682u, 1403791357u,
3587174388u, 2623673551u, 1355661457u, 4159477684u,
1109013587u,
3112183488u,
2217849279u, 3500291996u, 2419603731u, 2929886201u,
3854470013u, 1358382103u, 1357666555u, 21053566u,
2716621233u,
3094836862u,
3309729704u, 57086558u, 839187419u, 2757944838u,
3651040558u, 3607536716u, 3691257732u, 2312878285u,
1202511724u,
183479927u,
2509829803u, 109313218u, 478173887u, 2072044014u,
190631406u, 2495604975u, 1010416260u, 3679857586u,
726566957u,
258500881u,
1805873908u, 3081447051u, 2352101327u, 534922207u,
1584552873u, 813470716u, 255914637u, 249169434u,
3193498057u,
1038802706u,
2590158653u, 3147907290u, 663060128u, 1156177857u,
634616100u, 312879189u, 1545020368u, 2054634247u,
3271451914u,
3438291534u,
2181454946u, 3864535432u, 2398586877u, 896491075u,
2810631478u, 2770357487u, 3372930052u, 898070638u,
2051007323u,
392959778u,
36645539u, 3743556044u, 4134529680u, 4124451188u,
566806297u, 2936523982u, 1304761965u, 537399498u,
1940818842u,
40862381u,
36288410u, 3063605629u, 2826611650u, 3961972098u,
1871578006u, 2392095486u, 1136931591u, 513864488u,
173276451u,
3039055682u,
3543322032u, 1943592006u, 657217094u, 1751698246u,
2969618445u, 456616022u, 900309519u, 113892716u,
1126392103u,
1235651045u,
1882073852u, 2136610853u, 2353639710u, 2819956700u,
3980083530u, 828773559u, 224069850u, 902434120u,
2802008036u,
94358995u,
2777723394u, 2812641403u, 2525832595u, 4157388110u,
4235563782u, 937800324u, 141690749u, 568062536u,
550123849u,
1330316521u,
1949488696u, 2296431366u, 1958465262u, 3564751729u,
3748252207u, 120455129u, 1607318832u, 2525729790u,
2640987481u,
2332096657u,
1775969159u, 1555085077u, 2913525137u, 1347085183u,
2376253113u, 3194050574u, 1806090610u, 678641356u,
1499146713u,
383849715u,
3299835823u, 2284860330u, 2614269636u, 3913628844u,
2761334210u, 1959484587u, 529797021u, 239966995u,
3102194829u,
3602307804u,
1122192627u, 3577510006u, 164486066u, 1680137310u,
1473396395u, 1467801424u, 903493660u, 1185943071u,
2798556505u,
2306744492u,
3167201310u, 3577947177u, 3067592134u, 2905506289u,
1210366329u, 204484056u, 2347778932u, 3862374472u,
3277439508u,
4187414621u,
1646699310u, 621385800u, 3934869089u, 3975491588u,
3580085916u, 1925674500u, 2436305348u, 3983301539u,
2739439523u,
3291507446u,
3395637920u, 3753389171u, 2955202032u, 2654255623u,
3771089254u, 2140443405u, 2779834738u, 3261942805u,
3526889244u,
1842009139u,
4048484340u, 2106218403u, 2161244271u, 772152700u,
1158647659u, 3776791619u, 3882186721u, 699525237u,
2954670460u,
1007105869u,
3359152025u, 1146388699u, 1401550303u, 2326582541u,
4181783540u, 1085644043u, 1942143795u, 1038368308u,
1526153809u,
4042547244u,
1891441000u, 2573991874u, 1281441253u, 3635098284u,
1980545715u, 825985487u, 3934748116u, 4228386979u,
1480870944u,
1042194545u,
2397771642u, 2248490001u, 3817869868u, 878654626u,
3785629484u, 1672470870u, 3229367873u, 1894538933u,
1010692731u,
1733824268u,
656620328u, 3048283803u, 3353340056u, 2324965120u,
4192585951u, 2284524675u, 3483884368u, 1510168293u,
1554942691u,
1309709396u,
1241133168u, 3162179280u, 4046378054u, 3171681593u,
1165297136u, 3496703563u, 150437903u, 1948622072u,
1076332463u,
2292479143u,
1464229958u, 3479738093u, 2328067598u, 2334503110u,
833324834u, 3981605747u, 3002629155u, 2854644186u,
2832201336u,
95796957u,
3269249397u, 2358313329u, 3411860910u, 4283292480u,
2802208697u, 1305947955u, 2156803420u, 1991340283u,
189678024u,
447602599u,
1055411517u, 1531748363u, 1555852656u, 412402681u,
3774988152u, 20597551u, 2925024131u, 1423989620u,
3749428061u,
1541439448u,
112270416u, 1936224776u, 132162941u, 3772011507u,
3814102518u, 1908807815u, 444154079u, 823765347u,
3362275567u,
3419047430u,
2108287005u, 2315102125u, 658593738u, 3195094029u,
3721937534u, 3176229204u, 3398835373u, 1271898712u,
1142546577u,
3185986817u,
3562705803u, 2046119567u, 912990621u, 1829977672u,
3459576979u, 1118045834u, 1369529376u, 3320601076u,
3954988953u,
4002467635u,
3359456351u, 1314849568u, 1766750942u, 2998874853u,
1181800239u, 707328036u, 3314954697u, 2066721120u,
598194215u,
1124451278u,
3156679616u, 3742684743u, 2960199690u, 2683497915u,
2566077529u, 937014607u, 102095219u, 4262922475u,
3132264275u,
1262099830u,
862722905u, 2717653494u, 3245583534u, 3427209989u,
3220278124u, 85457091u, 2222333500u, 3513997967u,
3522324951u,
2830855552u,
2215004781u, 3482411840u, 4227160614u, 2030964411u,
1741393851u, 2643723748u, 942813508u, 403442675u,
3112048748u,
530556423u,
3817755244u, 3543286628u, 2247276090u, 1532920842u,
4101962711u, 1446540991u, 3297821473u, 1861255389u,
1984398u,
2366525138u,
377589481u, 3549193828u, 1427765914u, 506831657u,
277278988u, 1447652775u, 3214362239u, 3142198690u,
2843087541u,
468915015u,
807895062u, 2198723907u, 4031145069u, 2417156212u,
4027298697u, 637175947u, 1229254212u, 1773257887u,
1659444818u,
451148891u,
2099741368u, 735351990u, 2534775713u, 3261804619u,
712519954u, 3527962772u, 3758642738u, 4245823575u,
1281314264u,
1167866160u,
1489546151u, 1197354389u, 1043278102u, 2563326586u,
371937794u, 2320164817u, 3189512691u, 573685198u,
4108603513u,
3758899588u,
3507030163u, 2947201212u, 2529492585u, 578234375u,
3362349842u, 3318878925u, 3611203517u, 3059253190u,
4270755916u,
4291274625u,
4237586791u, 4137422245u, 2927218651u, 2444687041u,
797128811u, 2043057612u, 396533859u, 2665256178u,
3346510674u,
1779586176u,
3076562062u, 1882746214u, 921095362u, 2026988397u,
514514911u, 3886379478u, 4218272420u, 1480386793u,
3900160816u,
2292273451u,
1276138356u, 1125461821u, 1912885715u, 3365266013u,
1333211627u, 4085009861u, 1390530102u, 3347984752u,
2721771301u,
1419492325u,
4066766256u, 3250852311u, 820111852u, 1382201318u,
2366036798u, 938032241u, 3100979439u, 487048687u,
2292851045u,
3241399180u,
3912670510u, 2416437067u, 2973194517u, 3507707986u,
1935099406u, 2533441488u, 104616731u, 2892622820u,
3801190339u,
4239188808u,
807238241u, 3300121546u, 2249406147u, 4032114017u,
3713738189u, 3324425575u, 4275607376u, 3663120298u,
4173658372u,
3984289690u,
1827636846u, 3264588778u, 3297165529u, 558623533u,
2728945672u, 1566297318u, 3447249966u, 481719551u,
1596842050u,
1838185946u,
265271620u, 1050246315u, 4046655705u, 1844193138u,
3807563245u, 1075384804u, 1292554949u, 1506525927u,
2921816148u,
2051885269u,
1930534041u, 3872721086u, 1564489377u, 2272482181u,
2849358683u, 589618304u, 2262072443u, 290363051u,
299168363u,
3867603931u,
2868688756u, 2545263115u, 1092098533u, 3885725603u,
2352430409u, 1981595469u, 2047946646u, 1332642839u,
793806516u,
214858837u,
1061484659u, 3192394476u, 1115054785u, 3690637234u,
996792368u, 2023479706u, 3046498231u, 4205835102u,
3870714754u,
257472875u,
3549864599u, 2040276129u, 2414778670u, 812235477u,
2674248196u, 1864096101u, 2257492689u, 1332556794u,
1079540713u,
465530720u,
2304763972u, 830724724u, 3354588920u, 2510713652u,
3103749409u, 468835585u, 1707620787u, 3038024846u,
1000303198u,
3462270146u,
2748698899u, 2100348093u, 511537258u, 1237187486u,
102049383u, 2268226698u, 3162251739u, 4219404629u,
838822407u,
1481440623u,
2989224077u, 2676681975u, 3246551821u, 3812079906u,
370572963u, 2283154352u, 3084789986u, 1961085583u,
1955640586u,
2409348147u,
2284780581u, 1634818716u, 4018221729u, 2320761377u,
3566831899u, 1799560520u, 91431959u, 1754113747u,
1459430477u,
3613658517u,
924489906u, 3406317699u, 866289774u, 3924821603u,
1265394945u, 1870668109u, 151949856u, 2747006534u,
3111906201u,
64039467u,
2314447545u, 2600195638u, 4095795204u, 4162096026u,
1026756826u, 2460047982u, 52686887u, 823198739u,
1518045160u,
2867527376u,
566410761u, 2200433819u, 2114146405u, 2893790965u,
881504901u, 974783212u, 490815659u, 937300283u,
1523735309u,
2511976468u,
2634644947u, 355119367u, 1373773092u, 309232995u,
3088671051u, 787126032u, 3442836843u, 4289194567u,
2177850062u,
1174136430u,
3248982914u, 3129039732u, 1166851580u, 2196451882u,
469595580u, 2130837700u, 3783349021u, 3745262548u,
1236930515u,
3032131496u,
1525591437u, 1823628217u, 1939019255u, 1950270463u,
3659899927u, 3688643445u, 3004399289u, 1155199552u,
357547234u,
2213110526u,
3122658210u, 2667800490u, 2718690333u, 3512372076u,
1098611683u, 2657518392u, 4248458835u, 3109874532u,
1592908438u,
2864927516u,
3635248840u, 1251777186u, 3797340158u, 3508496870u,
303354834u, 1482394062u, 2087100120u, 1595931912u,
608574156u,
723367884u,
907938402u, 3357047807u, 1619629851u, 3092082995u,
89030300u, 916336992u, 1861180168u, 3436334155u,
1375000544u,
3472936241u,
1321217853u, 791356402u, 2872410224u, 2326250297u,
2657644088u, 1748314108u, 4146771421u, 2913114440u,
2924821844u,
2101101496u,
3268017251u, 2109603066u, 690665520u, 1830067573u,
951427661u, 2982533150u, 3884512506u, 2358657479u,
2833210784u,
3419798214u,
3785893994u, 2103940206u, 86759766u, 4031230616u,
3745237192u, 2739453927u, 497038072u, 3303159408u,
1251537249u,
1993408196u,
3185905715u, 2885948408u, 3154277110u, 2444150313u,
2505582079u, 2120610195u, 3266465773u, 1814611964u,
3080050407u,
1079915522u,
1819346505u, 2529946763u, 892097374u, 3740257161u,
3618100441u, 1079900094u, 3607172225u, 737863389u,
360704560u,
3341993089u,
1139047381u, 3132219631u, 1248981859u, 1109338159u,
2004908615u, 4022302594u, 4166640860u, 2959140950u,
3949235962u,
2832278473u,
2200524012u, 2634933043u, 2495844522u, 2613799818u,
4034096813u, 683271795u, 1673546817u, 1363163726u,
1805395136u,
511749501u,
1231032599u, 2305979751u, 345737783u, 3339868854u,
2931857933u, 2323251738u, 1332068477u, 51846558u,
3927238177u,
1387182179u,
1701238601u, 1419275173u, 2580882268u, 3357874599u,
1726558907u, 1292901039u, 1371322339u, 1311713044u,
3526735232u,
4017884184u,
3366093428u, 77140994u, 2128996229u, 1357915765u,
4019691901u, 483989024u, 2390311750u, 2766065288u,
3938587520u,
3064810344u,
1054589198u, 1274997019u, 4040589616u, 1277751144u,
2274907047u, 4170399945u, 2886368209u, 4168922115u,
3901237033u,
3252972311u,
2205185840u, 3403097556u, 3385493699u, 2809751370u,
555319628u, 399539034u, 2998971454u, 1521596214u,
178870216u,
1471733541u,
519629198u, 514159209u, 1500582242u, 1928616587u,
2686427928u, 4133138798u, 1225914083u, 1432713584u,
3559310915u,
3925489366u,
1055613123u, 4126676029u, 2723867653u, 3290604111u,
1377022957u, 2373608155u, 3615237379u, 594338683u,
2645257602u,
2408427260u,
917033274u, 750455097u, 625657657u, 121713200u,
2191273413u, 4043949724u, 3293146785u, 3809297972u,
3947296919u,
115456894u,
1529576616u, 1459278275u, 2157117997u, 1747859293u,
4106665903u, 996939232u, 2007976332u, 4274649009u,
1017725787u,
4244666096u,
1219631331u, 3072426253u, 3547691720u, 1620822012u,
1397717508u, 2031597325u, 3345983430u, 2459068000u,
3645130467u,
2308642742u,
359955852u, 1348467968u, 1133123059u, 2435919062u,
2800365907u, 4213217210u, 4056565603u, 2811666556u,
2318007236u,
3823652401u,
3654086429u, 1273260424u, 1591610446u, 943349350u,
3441227678u, 3779964757u, 233818224u, 3469971032u,
3764095096u,
4009204587u,
678472092u, 1990559652u, 2583121088u, 2978143652u,
2496370864u, 2139539656u, 4287972050u, 295832576u,
3536742861u,
2257466133u,
2738052161u, 1988611898u, 2466189642u, 3294419573u,
2311186273u, 474374532u, 3081964174u, 2515138278u,
835731677u,
1178182694u,
3352119543u, 2884763225u, 3462399574u, 2900817210u,
1993698511u, 2868445043u, 2746444849u, 1205258179u,
2353442946u,
4079040070u,
3624133102u, 2907136076u, 2902521697u, 426813211u,
1418185512u, 3711189488u, 1351506552u, 1934749519u,
46595543u,
401688809u,
3514602124u, 1396852607u, 1951477943u, 2502249173u,
3199695820u, 2890250638u, 4205072507u, 1715623846u,
3266686789u,
3218688128u,
1697759742u, 851227671u, 2358709645u, 4174233268u,
500583683u, 3805940955u, 736234120u, 2710563712u,
1949664540u,
3139414003u,
4293073253u, 1284406972u, 1785182449u, 1051548274u,
2994248357u, 2499882522u, 717208669u, 2039517285u,
518424929u,
143136433u,
2303774671u, 1272930860u, 2286410920u, 788459311u,
273225293u, 2439291703u, 2254505236u, 3446287701u,
3655156558u,
1546628787u,
340081500u, 3285722006u, 1324810435u, 1053980860u,
1779472859u, 2700355724u, 686005017u, 3762376315u,
3963193100u,
1370881135u,
661300087u, 1152753704u, 2349891598u, 3910051187u,
2109444785u, 1311123870u, 2639837565u, 1896770931u,
1081414128u,
869877586u,
4284220400u, 63045374u, 235968615u, 184451062u,
1271099822u, 1319179857u, 3274963209u, 4172272710u,
3388797445u,
2965973320u,
3793110097u, 3327241723u, 2991804005u, 1199544355u,
771553759u, 2031749842u, 2596517372u, 1199888213u,
858347951u,
3340178832u,
2903875412u, 763490382u, 76949161u, 2056544406u,
1145227689u, 998233136u, 2354530024u, 427713587u,
3537837347u,
604661755u,
923986833u, 1023730418u, 798294227u, 432557449u,
801802449u, 1861313429u, 3899128441u, 4068407979u,
2352677083u,
3783539925u,
10731973u, 3390767975u, 3949540249u, 1920121661u,
3248580201u, 641956426u, 2104847395u, 604835744u,
1491663404u,
4255204651u,
1520970746u, 2845653368u, 3247412938u, 3730629005u,
855569514u, 3073294700u, 2429691698u, 3818342476u,
3938869985u,
2731201328u,
2335202643u, 778117742u, 13298408u, 228780590u,
2871715314u, 3253688653u, 4150999702u, 3846220408u,
930808u,
1397128726u,
1964216488u, 2781092828u, 116285375u, 2271239476u,
3724347554u, 2931203895u, 3893169206u, 1883912528u,
2093892660u,
3658787024u,
3095016046u, 1094059199u, 3640239610u, 558564267u,
2102812456u, 464734873u, 925262247u, 1609838036u,
588364741u,
1731409233u,
1576165139u, 3933979268u, 375316394u, 4247099643u,
3670508019u, 4080496835u, 2371248533u, 183762693u,
2078935389u,
2699810414u,
1491815683u, 2999180789u, 1831158425u, 1603373553u,
2006136905u, 3210230591u, 416748595u, 1536971415u,
3271869367u,
1266062739u,
2138414557u, 3337114778u, 1634586826u, 36472629u,
4482244u, 568009609u, 2721216780u, 4037289545u,
2235138807u,
1789351460u,
4067539527u, 1323062829u, 3864620647u, 4192026301u,
4278901241u, 1399025382u, 2826652805u, 1363860382u,
1801770651u,
1613381526u,
1165249276u, 4046576622u, 2535596946u, 3260388176u,
1078898578u, 2259750862u, 643387587u, 237144235u,
4199571427u,
3440917581u,
3067939258u, 2018625455u, 1460528353u, 3138629939u,
1666223528u, 3841139376u, 2528281125u, 885565193u,
2609492686u,
2517257479u,
560864620u, 2261471820u, 3491559165u, 1329620416u,
622383582u, 1759597655u, 2877873893u, 584692817u,
1901728399u,
2599000260u,
3169771644u, 296332336u, 774719455u, 4175920823u,
2287316070u, 4115615023u, 1073335619u, 4240292725u,
1359158837u,
1960974237u,
3173724597u, 1619084286u, 2876340752u, 4065675347u,
480741335u, 1237329941u, 701055566u, 3729009837u,
1314736422u,
4003180069u,
3118519317u, 3035354420u, 3380357671u, 4020909015u,
253958714u, 3545798863u, 3008185002u, 2624719888u,
3219955575u,
3060719376u,
573101682u, 1580316843u, 2610493412u, 3490983536u,
3601975611u, 851470366u, 635384901u, 3427048824u,
1470002757u,
3592460087u,
2265226856u, 4124282457u, 2106385486u, 3334305617u,
4208282753u, 3798749815u, 225396466u, 118791182u,
2523395972u,
194595464u,
2563824631u, 2521301383u, 4224409406u, 468670274u,
1761966400u, 1300908277u, 2570709228u, 1847901526u,
1470099163u,
2690466752u,
1472536718u, 2399279735u, 4150607803u, 1775080054u,
2082537685u, 4080034578u, 1256001880u, 392967725u,
2055838940u,
3349115816u,
1745947263u, 2213925887u, 1836572741u, 2417722792u,
636223705u, 2423329294u, 3960951311u, 1543591052u,
1547914361u,
2760945653u,
3519014111u, 313543871u, 4119598884u, 1071003714u,
2192556597u, 1526995535u, 3929839778u, 536388591u,
3040873792u,
3752682932u,
1640614237u, 2432794021u, 385337403u, 2794410617u,
2386128075u, 1055206708u, 1422747714u, 3759330929u,
2533597496u,
30440955u,
1482899460u, 3350385050u, 616259409u, 3980103795u,
1211364140u, 1040071544u, 594746920u, 1645973936u,
2547331531u,
1097726368u,
700666526u, 2976247482u, 1144906608u, 996506677u,
1997130756u, 800321417u, 1392942823u, 1601662248u,
2079778663u,
529512908u,
2925120134u, 4106433085u, 630221833u, 2423086156u,
1119859778u, 1726827981u, 1870859181u, 2559832707u,
1792284257u,
2059356387u,
3572353364u, 3229407475u, 575621095u, 3221893291u,
2372428048u, 2020123035u, 961449593u, 2243824063u,
3803906611u,
3735348189u,
2981620804u, 4180681078u, 1555330629u, 230736535u,
2075526640u, 749652975u, 713664372u, 2152096659u,
2142067223u,
3322302242u,
1421646830u, 2092832615u, 1213735101u, 3192136753u,
1106723940u, 3455398230u, 2541685524u, 2529956739u,
3789430647u,
1950084508u,
2157395621u, 850457360u, 2758902426u, 2848030169u,
6506379u, 1162213157u, 2981459221u, 272690871u,
3059420255u,
4242691285u,
588065598u, 1206949936u, 3968214184u, 566348532u,
126142880u, 1480567086u, 2959621988u, 2050218418u,
2242731195u,
3833514449u,
1898070331u, 3687399477u, 3891859374u, 868185955u,
2335308774u, 3676335246u, 3871121805u, 2189032743u,
3275728647u,
860492892u,
1590764344u, 4130384758u, 262871548u, 3004764525u,
2685542071u, 991231482u, 435122019u, 3031116998u,
2898921700u,
2917932604u,
4238665148u, 2459072654u, 3444612545u, 4207731740u,
1808564313u, 2798532269u, 3944553556u, 3926395409u,
1633200670u,
4138335224u,
2524878605u, 4184292650u, 3563398268u, 4288943552u,
3802121210u, 957502058u, 2410820887u, 4227117506u,
4018625153u,
4284329158u,
530216712u, 2978986531u, 863452221u, 1910162118u,
4088211378u, 4091971261u, 3150811451u, 4200871487u,
3794038652u,
3041564310u,
2045287082u, 887805614u, 2889167251u, 4120352181u,
1699912580u, 3478922097u, 3211994687u, 3136177842u,
1500806861u,
3211881347u,
2147976385u, 3342722260u, 3359650541u, 4197378460u,
781354073u, 1533623029u, 2204677828u, 3228172832u,
3248592437u,
3355841359u,
560815159u, 1144951236u, 4027015711u, 2882625391u,
339363613u, 2354572719u, 1769831876u, 4238589331u,
1519732871u,
2185834614u,
1601096831u, 129709881u, 39655633u, 367604993u,
1737681770u, 3259114599u, 2767070452u, 872365177u,
1574125529u,
3405020189u,
4181346685u, 1134030380u, 403769171u, 2193351164u,
1426232618u, 2885309450u, 3033612627u, 924948363u,
935514094u,
3202053329u,
912294839u, 1618472324u, 4159158431u, 3744999487u,
777064358u, 3974213124u, 1990246048u, 309725290u,
2449849392u,
1943692420u,
2288635750u, 2433793635u, 2168904061u, 683315308u,
3081493019u, 3477759434u, 3815496269u, 2823504699u,
586945121u,
3088963200u,
3492287335u, 636875049u, 1111206944u, 2037346120u,
1282050044u, 1409681512u, 1786128584u, 755810950u,
2332676758u,
2178142310u,
957827166u, 1014983590u, 1888800725u, 3608595803u,
3200072714u, 2534008478u, 659336139u, 1281728287u,
4060560529u,
2915575125u,
3521503774u, 2926487340u, 1096297674u, 653489861u,
2352326980u, 2561136777u, 1224141198u, 1250479629u,
1297625391u,
2409997371u,
1942483722u, 2481835750u, 1394715707u, 1673070941u,
2456039704u, 3980558014u, 3547934764u, 1882038812u,
1078160498u,
2488279087u,
1848235245u, 1211914722u, 2264928765u, 2807773070u,
270145554u, 583747883u, 3826009010u, 2996618216u,
425727157u,
992726957u,
3384462280u, 726650661u, 1955043265u, 1923879512u,
1854693773u, 2987614542u, 2660044993u, 2457260810u,
426299370u,
2671892900u,
1827308087u, 3083953443u, 1791749638u, 3265087416u,
2119752201u, 2547122538u, 3990783236u, 1912713468u,
3688865211u,
1815780016u,
303699291u, 2416763742u, 2690891610u, 1535193548u,
1107803989u, 1504143133u, 2235270371u, 2545884083u,
2276278682u,
411724404u,
3416925704u, 2565792091u, 3383911757u, 546058824u,
3374654444u, 2364630415u, 2693473470u, 2622125691u,
261864817u,
55682470u,
857617568u, 141304067u, 1885488541u, 155368182u,
1281949051u, 3384522408u, 3254816901u, 1959816782u,
1452224057u,
2830267691u,
3709231247u, 58988202u, 4218130458u, 2984061349u,
1888707848u, 4223605071u, 4241442486u, 375269213u,
3208327038u,
2199916493u,
550337252u, 2855061437u, 276088636u, 114362204u,
2321163647u, 2127813633u, 3289403024u, 2686973202u,
2717376797u,
3593428039u,
3648831666u, 890925902u, 3289404818u, 3289516821u,
4248913260u, 1858916580u, 3303932308u, 1752797086u,
1628149686u,
3245893605u,
1568537311u, 2844194502u, 1593855770u, 2408174109u,
124797514u, 2085649512u, 3188565660u, 2264996276u,
1926696513u,
3053957740u,
2238806881u, 2189050973u, 203685243u, 379855590u,
3920271562u, 1058600179u, 3698061923u, 4255106849u,
608401664u,
1598041932u,
3318266418u, 2535016555u, 852760884u, 1918098822u,
2200437599u, 1532285043u, 3425662132u, 3561293706u,
2231633206u,
4108785088u,
3359152801u, 173534780u, 208383607u, 2862988169u,
2406642243u, 426814583u, 2777335795u, 3322703596u,
954190623u,
615093090u,
4179102978u, 2452847930u, 100239619u, 42471741u,
818352432u, 2190624654u, 504379960u, 3631619975u,
633412456u,
1018421783u,
842645419u, 711808707u, 3424580813u, 2132457941u,
1158335882u, 3567952480u, 2302183699u, 1145788151u,
3474264138u,
3105085243u,
3115506027u, 2783713015u, 3871785309u, 539583269u,
1400252405u, 3857849984u, 4231186588u, 1278653799u,
1760227022u,
761044088u,
3838185417u, 2439542532u, 585283357u, 2055995220u,
937117124u, 3831944855u, 1823586038u, 3287917855u,
485082427u,
3209172809u,
1984570176u, 2818337297u, 2691869057u, 3790476953u,
839035557u, 3203129010u, 669981176u, 4121157385u,
3519870450u,
3792633352u,
3017650322u, 1603459507u, 4225677666u, 376555451u,
473780127u, 2018786277u, 3299822439u, 1010254499u,
2383887565u,
3155009499u,
3108110655u, 2641738274u, 3684908622u, 1606463047u,
3311068174u, 52708046u, 754181455u, 1018079176u,
3915670272u,
3366999425u,
1012880204u, 1339439715u, 466437962u, 1402662350u,
2504046911u, 736323938u, 2037800124u, 1725908589u,
716341840u,
1750123474u,
3366342464u, 1743666195u, 2975303189u, 3821364027u,
3253707772u, 3635548377u, 3840413796u, 1955642085u,
1018315169u,
1258092848u,
2095540656u, 1076256607u, 117289557u, 1311658655u,
2118301000u, 68721550u, 2886814107u, 2712432819u,
4201862886u,
753807148u,
1940229047u, 731347296u, 1068901393u, 3873155894u,
2852787666u, 1973464853u, 79735652u, 3966380587u,
3245740712u,
2525773438u,
734938109u, 3045656416u, 3335746354u, 4099732691u,
1911896517u, 1697006473u, 1145487066u, 1605663299u,
3053606724u,
2386289465u,
3821211369u, 1006215345u, 1256304829u, 1053001668u,
1289194958u, 118761054u, 1853688730u, 2803418011u,
188650809u,
3763686458u,
1006829556u, 2961984133u, 3390525025u, 2061199893u,
141792681u, 2439893463u, 2652982650u, 1804942682u,
1546510005u,
1246961405u,
2407577046u, 565772575u, 3751844810u, 2943166103u,
3750052451u, 3022527280u, 25162928u, 397381043u,
1818337632u,
3447363730u,
3936437150u, 2569420703u, 2215592390u, 2171555672u,
3665571006u, 4021712412u, 2939158353u, 4057813172u,
1823237318u,
103999245u,
3251978010u, 3591914940u, 3582495283u, 2519035265u,
3905726135u, 3180393349u, 2743117123u, 55247368u,
3325286701u,
705195946u,
1857526853u, 1480518550u, 3809990433u, 1398189338u,
3126362926u, 3959531492u, 1503658285u, 1977847740u,
3043964489u,
2613086143u,
1518119282u, 4238434900u, 3905746486u, 3064949667u,
1028122931u, 3309119457u, 4071194920u, 3096098907u,
4137180520u,
494467959u,
1231408687u, 1691606157u, 1793452569u, 2722196118u,
3478603952u, 1059665738u, 2282032278u, 3990268388u,
1719514651u,
4248311578u,
3799146721u, 898026304u, 3367808954u, 4162472815u,
170495870u, 1308116609u, 3428285344u, 1714716475u,
395576794u,
4153638621u,
2999745812u, 3483315953u, 304980828u, 595337120u,
3486516729u, 2331563143u, 2583609459u, 1885928417u,
3834283777u,
979337825u,
932057378u, 3124081189u, 1930356777u, 3865887996u,
4178282217u, 4214219408u, 3669465884u, 1472413856u,
3356866587u,
1012769806u,
3043639963u, 996996396u, 207308216u, 982967331u,
2991319933u, 318066902u, 721489670u, 1249967713u,
749240921u,
591392325u,
2379365192u, 2250868849u, 2163259329u, 143191325u,
3778285606u, 982149096u, 3536906200u, 2244353244u,
1443862317u,
3161549210u,
2183127464u, 2015409516u, 547003700u, 2032484282u,
523677821u, 4275663308u, 3827205526u, 3903778273u,
2444530525u,
2543645801u,
1173958423u, 784740616u, 2878693675u, 3127696736u,
3832037316u, 3161002398u, 4084166400u, 4213346853u,
223390424u,
4273380883u,
2130315482u, 3429606032u, 3367732613u, 1912357694u,
422632590u, 1266957023u, 3437535648u, 736404240u,
2281709372u,
415859912u,
212948797u, 351612650u, 3920561440u, 112963586u,
2230727543u, 2851076612u, 1990662634u, 2264296857u,
3131463650u,
2704034623u,
3541637839u, 2954232792u, 533986918u, 4158757533u,
65174248u, 4232639593u, 865906667u, 1948225652u,
779656112u,
3873989249u,
2372984749u, 2346988193u, 1104345713u, 1165654138u,
4045762610u, 3588205178u, 461363991u, 1111215752u,
1389675192u,
2404325151u,
2152228101u, 3808973622u, 1901235912u, 3458690696u,
314513238u, 2539459143u, 2847998873u, 952026138u,
2325705328u,
407844712u,
3727960715u, 2996448351u, 2374336760u, 3138756390u,
2600015243u, 539980418u, 1876285352u, 1670330799u,
1709360377u,
2868531654u,
494777964u, 2773053597u, 599486162u, 3962209577u,
1871328846u, 2171933018u, 110279472u, 384074780u,
4147021936u,
2333589647u,
4251778066u, 40493468u, 3099342316u, 4108779767u,
2812424588u, 954542332u, 2040682331u, 2251152306u,
45915516u,
259525626u,
1045384743u, 4134656562u, 749389261u, 874399445u,
616549904u, 2200447504u, 436024539u, 78972290u,
3210485762u,
1907985531u,
3013721395u, 4214533685u, 4198804243u, 534879265u,
1517190881u, 3756787754u, 1152563554u, 1718750948u,
777737463u,
1402478860u,
1824562784u, 1879401449u, 3515818786u, 513165201u,
1423491227u, 2103067918u, 2291777410u, 1097943000u,
};

// Return false only if offset is -1 and a spot check of 3 hashes all yield 0.
bool Test(int offset, int len = 0) {
#undef Check
#undef IsAlive

#define Check(x) do {                                                   \
  const uint32_t actual = (x), e = expected[index++];                   \
  bool ok = actual == e;                                                \
  if (!ok) {                                                            \
    cerr << "expected " << hex << e << " but got " << actual << endl;   \
    ++errors;                                                           \
  }                                                                     \
  assert(ok);                                                           \
} while (0)

#define IsAlive(x) do { alive += IsNonZero(x); } while (0)

  // After the following line is where the uses of "Check" and such will go.
  static int index = 0;
if (offset == -1) { int alive = 0; IsAlive(farmhashcc::Hash32WithSeed(data, len++, SEED)); IsAlive(farmhashcc::Hash32(data, len++)); { uint128_t u = farmhashcc::Fingerprint128(data, len++); uint64_t h = Uint128Low64(u); IsAlive(h >> 32); IsAlive((h << 32) >> 32); h = Uint128High64(u); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } len -= 3; return alive > 0; }
Check(farmhashcc::Hash32WithSeed(data + offset, len, SEED));
Check(farmhashcc::Hash32(data + offset, len));
{ uint128_t u = farmhashcc::Fingerprint128(data + offset, len); uint64_t h = Uint128Low64(u); Check(h >> 32); Check((h << 32) >> 32); h = Uint128High64(u); Check(h >> 32); Check((h << 32) >> 32); }
{ uint128_t u = farmhashcc::CityHash128WithSeed(data + offset, len, Uint128(SEED0, SEED1)); uint64_t h = Uint128Low64(u); Check(h >> 32); Check((h << 32) >> 32); h = Uint128High64(u); Check(h >> 32); Check((h << 32) >> 32); }

  return true;
#undef Check
#undef IsAlive
}

int RunTest() {
  Setup();
  int i = 0;
  cout << "Running farmhashccTest";
  if (!Test(-1)) {
    cout << "... Unavailable\n";
    return NoteErrors();
  }
  // Good.  The function is attempting to hash, so run the full test.
  int errors_prior_to_test = errors;
  for ( ; i < kTestSize - 1; i++) {
    Test(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    Test(0, i);
  }
  Test(0, kDataSize);
  cout << (errors == errors_prior_to_test ? "... OK\n" : "... Failed\n");
  return NoteErrors();
}

#else

// After the following line is where the code to print hash codes will go.
void Dump(int offset, int len) {
cout << farmhashcc::Hash32WithSeed(data + offset, len, SEED) << "u," << endl;
cout << farmhashcc::Hash32(data + offset, len) << "u," << endl;
{ uint128_t u = farmhashcc::Fingerprint128(data + offset, len); uint64_t h = Uint128Low64(u); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u, "; h = Uint128High64(u); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
{ uint128_t u = farmhashcc::CityHash128WithSeed(data + offset, len, Uint128(SEED0, SEED1)); uint64_t h = Uint128Low64(u); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u, "; h = Uint128High64(u); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
}

#endif

#undef SEED
#undef SEED1
#undef SEED0

}  // namespace farmhashccTest

#if !TESTING
int main(int argc, char** argv) {
  Setup();
  cout << "uint32_t expected[] = {\n";
  int i = 0;
  for ( ; i < kTestSize - 1; i++) {
    farmhashccTest::Dump(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    farmhashccTest::Dump(0, i);
  }
  farmhashccTest::Dump(0, kDataSize);
  cout << "};\n";
}
#endif
#ifndef FARMHASH_SELF_TEST_GUARD
#define FARMHASH_SELF_TEST_GUARD
#include <cstdio>
#include <iostream>
#include <string.h>

using std::cout;
using std::cerr;
using std::endl;
using std::hex;

static const uint64_t kSeed0 = 1234567;
static const uint64_t kSeed1 = k0;
static const int kDataSize = 1 << 20;
static const int kTestSize = 300;
#define kSeed128 Uint128(kSeed0, kSeed1)

static char data[kDataSize];

static int completed_self_tests = 0;
static int errors = 0;

// Initialize data to pseudorandom values.
void Setup() {
  if (completed_self_tests == 0) {
    uint64_t a = 9;
    uint64_t b = 777;
    for (int i = 0; i < kDataSize; i++) {
      a += b;
      b += a;
      a = (a ^ (a >> 41)) * k0;
      b = (b ^ (b >> 41)) * k0 + i;
      uint8_t u = b >> 37;
      memcpy(data + i, &u, 1);  // uint8_t -> char
    }
  }
}

int NoteErrors() {
#define NUM_SELF_TESTS 9
  if (++completed_self_tests == NUM_SELF_TESTS)
    std::exit(errors > 0);
  return errors;
}

template <typename T> inline bool IsNonZero(T x) {
  return x != 0;
}

template <> inline bool IsNonZero<uint128_t>(uint128_t x) {
  return x != Uint128(0, 0);
}

#endif  // FARMHASH_SELF_TEST_GUARD

namespace farmhashmkTest {

uint32_t CreateSeed(int offset, int salt) {
  uint32_t h = static_cast<uint32_t>(salt & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h += static_cast<uint32_t>(offset & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  return h;
}

#undef SEED
#undef SEED1
#undef SEED0
#define SEED CreateSeed(offset, -1)
#define SEED0 CreateSeed(offset, 0)
#define SEED1 CreateSeed(offset, 1)

#undef TESTING
#define TESTING 1
#if TESTING
uint32_t expected[] = {
4223616069u,
3696677242u,
4081014168u,
2576519988u,
2212771159u,
1112731063u,
1020067935u,
3955445564u,
1451961420u,
653440099u,
31917516u,
2957164615u,
2590087362u,
3879448744u,
176305566u,
2447367541u,
1359016305u,
3363804638u,
1117290165u,
1062549743u,
2437877004u,
1894455839u,
673206794u,
3486923651u,
3269862919u,
2303349487u,
1380660650u,
595525107u,
1525325287u,
2025609358u,
176408838u,
1592885012u,
864896482u,
2101378090u,
3489229104u,
2118965695u,
581644891u,
2718789079u,
631613207u,
4228658372u,
3867875546u,
3531368319u,
3804516756u,
3317755099u,
1619744564u,
2884717286u,
1088213445u,
2667691076u,
3727873235u,
2330406762u,
3616470388u,
967660719u,
4148162586u,
315219121u,
673084328u,
3047602355u,
1598963653u,
1267826661u,
2117362589u,
2861192253u,
1823625377u,
1380350078u,
1641748342u,
1176094482u,
269384321u,
2178982315u,
3480237248u,
2660755208u,
1850544433u,
3429699438u,
1262819303u,
640556464u,
2421125401u,
2188368608u,
2612932825u,
1474432581u,
173790449u,
2124882189u,
831272654u,
622960146u,
4238751051u,
3250317967u,
2120810248u,
1948231495u,
1389029321u,
2200398357u,
2134232963u,
2948072329u,
617717625u,
681164587u,
114859387u,
430545646u,
57239089u,
3163338012u,
3482496399u,
557662576u,
1102441413u,
2670159360u,
991116729u,
846014240u,
4233741566u,
1802317242u,
3129528802u,
1459456375u,
1305643039u,
3258671612u,
1578285833u,
868590079u,
1631034517u,
1695432937u,
561078856u,
1004115553u,
3086090507u,
3818348650u,
731596645u,
780926790u,
2544205955u,
158479164u,
3983514188u,
2004735250u,
3436218400u,
673684751u,
1463431419u,
2880490219u,
3223748024u,
2218318859u,
1474466194u,
2636437533u,
2206794961u,
140995728u,
1186394086u,
1805716888u,
1640037724u,
3942729099u,
1944727013u,
918951560u,
498666871u,
3486974657u,
2967205462u,
1167253804u,
1884281041u,
2866015002u,
4158319270u,
2627220079u,
3733319624u,
3317092271u,
438323662u,
3195868065u,
3426606709u,
360708338u,
1905491012u,
650004803u,
1351266252u,
3133279000u,
3722811115u,
2722412434u,
918432408u,
3678271248u,
269599647u,
621514057u,
3117077855u,
1545425390u,
2597567410u,
1221437820u,
3493254589u,
102787342u,
918861168u,
348795089u,
3439883229u,
2353641807u,
2209585469u,
4035884492u,
2686995435u,
1649888022u,
3852893848u,
3042700028u,
314103172u,
726977769u,
2489830276u,
2872753660u,
1316214989u,
1488801501u,
1811420390u,
639581627u,
2362837215u,
3634581834u,
3648576802u,
1257314182u,
762118371u,
4268447045u,
730167096u,
755561509u,
882614845u,
3696972894u,
228263661u,
1478636142u,
2767751651u,
1532617116u,
3838657661u,
1944359935u,
1401102137u,
3772933173u,
1050098254u,
1658079354u,
1846025728u,
2204244794u,
2017217424u,
1275162853u,
1429816745u,
2175565479u,
1716109139u,
1187506761u,
2434641075u,
2725597783u,
1795687662u,
1393312782u,
3511565397u,
627885430u,
4145733164u,
2519005353u,
231414775u,
1242015635u,
2760723497u,
2185540568u,
727314436u,
2358790354u,
1186393454u,
4234795645u,
350567813u,
866773875u,
3145590392u,
1158374055u,
3903123687u,
1862119793u,
2204587556u,
4266276976u,
4151548555u,
915250402u,
2874695320u,
2360311410u,
1099212769u,
1271542714u,
3473148363u,
1637325418u,
1807795989u,
2493819794u,
3800917924u,
4001205856u,
2582153621u,
3365872040u,
2890146216u,
2626363824u,
3133351295u,
4046827296u,
3053118771u,
4113026751u,
884356716u,
3828347401u,
10608262u,
830987972u,
1841080500u,
3202717763u,
3561778749u,
1906000052u,
3058284660u,
1432904514u,
2567431677u,
2550162530u,
665557986u,
936887821u,
2101205308u,
4253535847u,
1662043545u,
1253611611u,
2091370094u,
2635077370u,
2602176041u,
3624115809u,
748442714u,
2709749154u,
1023493343u,
860291012u,
3924715584u,
1536436740u,
2551145800u,
2391782865u,
1467705048u,
2583909796u,
3616666170u,
1162857372u,
4228631071u,
1510132376u,
2739165009u,
2656606142u,
3454996358u,
3155038853u,
1022087316u,
100044110u,
494208296u,
2746186477u,
4216782431u,
225448834u,
3728320521u,
335282866u,
3148194874u,
953503703u,
1293353960u,
202372387u,
1326119870u,
4045123735u,
3819994846u,
1629004186u,
1081099186u,
3591584153u,
1670825804u,
3404257979u,
3262192301u,
2572846095u,
3714992543u,
4264142572u,
529616678u,
2882154574u,
3006354178u,
3865969421u,
2007174907u,
308283107u,
2629833703u,
3159124075u,
1146492131u,
494104332u,
493149727u,
1342910585u,
521642387u,
2201695937u,
2517980959u,
2426821287u,
777374655u,
2228189792u,
4027055486u,
228976000u,
3842083468u,
1723920223u,
1192126094u,
787744493u,
2740368380u,
2284153001u,
2773829458u,
442000614u,
387830783u,
2169780670u,
2253144627u,
3532502484u,
1969684059u,
1165351416u,
3055056536u,
3582324253u,
231419363u,
770979865u,
3213983597u,
3690452836u,
935794639u,
3230602762u,
2841762457u,
407598927u,
1164479891u,
3721799696u,
354738136u,
1801566618u,
3206038542u,
2621379981u,
1943487262u,
3534745636u,
1074424589u,
1304517521u,
4133400969u,
2339317978u,
2135116860u,
4180643791u,
2415309340u,
1855926417u,
3418648630u,
1968113037u,
597304222u,
3668824865u,
3810008716u,
3014702569u,
3151212026u,
156057449u,
373134533u,
2068234004u,
191580563u,
3832754488u,
2924104199u,
2026044494u,
4065780435u,
122565840u,
4194985167u,
2744823717u,
2494098735u,
3753793370u,
1885739217u,
2488161225u,
3643797615u,
2653367310u,
2494061477u,
189968132u,
899646597u,
392100396u,
4012318310u,
3855777086u,
3566860954u,
2698574996u,
2414249905u,
1330623339u,
1263222732u,
1277741760u,
2194959402u,
1629656136u,
120494320u,
1072368005u,
1084245077u,
4011372748u,
1366613353u,
3108643228u,
3332219532u,
2114746095u,
3964007334u,
371687128u,
1084813876u,
126459896u,
4292782331u,
321283184u,
398168499u,
3604983506u,
560701543u,
2073961354u,
4240841868u,
4151211362u,
1338986875u,
4093476832u,
2269279497u,
3500846299u,
2510225147u,
598000444u,
1330391422u,
1432533385u,
4171226231u,
426821154u,
2932270996u,
3378981077u,
2217871549u,
1619647984u,
4051608043u,
3180237819u,
12919578u,
1375401767u,
371320427u,
2986640571u,
2336669859u,
3796464715u,
1892383284u,
306814912u,
2125823211u,
1863678891u,
3249703818u,
3840225752u,
281579900u,
264680257u,
4266359110u,
4182229890u,
2239659703u,
3627947372u,
2373929191u,
224082765u,
4053639058u,
1862360303u,
3187739624u,
3392706679u,
948039509u,
817505760u,
1215842393u,
3462222651u,
536021853u,
182346832u,
2731944883u,
2346674384u,
2640961678u,
3446695687u,
2271722179u,
1301069656u,
2803881468u,
2832614405u,
1691544398u,
698756814u,
3980620906u,
3565421410u,
754769376u,
4115923404u,
3909962218u,
2747614077u,
2888289845u,
1016920862u,
2790946178u,
3067070960u,
3173251481u,
1572132982u,
255048203u,
2996538818u,
3405398987u,
136106013u,
3581605228u,
4277437977u,
2147300534u,
3728426265u,
3483629996u,
1478452694u,
20756076u,
2774992067u,
432987927u,
1516771026u,
3511588664u,
2130994978u,
509385406u,
873090347u,
2163904107u,
4192239086u,
2532489989u,
1090772651u,
3910797408u,
3710882132u,
155010959u,
1369823531u,
1599664937u,
4035593587u,
1212746925u,
795822552u,
116689518u,
3674240941u,
1135576664u,
756750261u,
1027431362u,
390555140u,
2228460216u,
1506940482u,
3733857700u,
3048762971u,
2511703196u,
548609887u,
1607354252u,
659053982u,
259884450u,
1793130460u,
4083364495u,
3148555881u,
1764350138u,
2436485683u,
4031563025u,
3261860724u,
2475833430u,
2101726086u,
3191176464u,
2646658847u,
2127042126u,
771316100u,
2115922959u,
3208515045u,
2355437783u,
3621147793u,
1580163615u,
3211555675u,
3299188490u,
191613920u,
466733956u,
2939029038u,
1509152039u,
130591314u,
1892874677u,
1646908044u,
3452406523u,
3998376606u,
1199243832u,
2187108812u,
3189230066u,
4161151481u,
3371454980u,
3681788646u,
180842187u,
3685022399u,
3058749895u,
3250165163u,
2895367943u,
2627101723u,
771755098u,
1332921024u,
3638871848u,
514215135u,
3591227378u,
2300310870u,
3689533503u,
851607114u,
114330368u,
2709027386u,
1743034877u,
1013693860u,
288169008u,
3545190686u,
1052165084u,
3995862307u,
96902755u,
1097819851u,
2645431442u,
2184148618u,
2151206566u,
350979797u,
3467920900u,
421116779u,
1246252u,
4057835428u,
329324407u,
4104482417u,
844624570u,
3306265806u,
3787625025u,
4263241191u,
3251413927u,
2921204431u,
2931915325u,
992134330u,
3986338354u,
1327895216u,
1458363596u,
1480608532u,
728594368u,
3804366693u,
794404223u,
1643240863u,
793417255u,
4167916443u,
2683488959u,
3124925324u,
4184843652u,
3750971752u,
308509829u,
1054550805u,
2797511972u,
4043123412u,
1587158240u,
4050518606u,
3030062190u,
2589912753u,
603440067u,
937013191u,
1071662315u,
2100661456u,
2602005741u,
435516078u,
2260470147u,
1256268350u,
3612035u,
3368856141u,
151516099u,
3081868591u,
3363755681u,
2049963149u,
2885320434u,
84682005u,
2411758308u,
2695174275u,
3099904644u,
1787308684u,
1132379308u,
564634346u,
510236510u,
2804443681u,
3931864252u,
2064427949u,
1893979229u,
2916544974u,
1885887717u,
2978018250u,
494192125u,
2642662373u,
901112508u,
636035003u,
1658643797u,
172746975u,
517504890u,
3440019372u,
4144498044u,
1854755456u,
3672653905u,
4176892856u,
382159097u,
282871690u,
3629300472u,
2500754041u,
1677659759u,
1067175061u,
161654075u,
1672575536u,
346120493u,
2730229631u,
203466442u,
1244549529u,
199761971u,
2744895408u,
3195315331u,
2124618519u,
3261045496u,
985339699u,
3385585455u,
1545740710u,
3636652160u,
2167020081u,
1207897204u,
28752417u,
2895834146u,
3640845375u,
3750293073u,
548997850u,
4207814196u,
4183030708u,
2462810989u,
3929965401u,
};

// Return false only if offset is -1 and a spot check of 3 hashes all yield 0.
bool Test(int offset, int len = 0) {
#undef Check
#undef IsAlive

#define Check(x) do {                                                   \
  const uint32_t actual = (x), e = expected[index++];                   \
  bool ok = actual == e;                                                \
  if (!ok) {                                                            \
    cerr << "expected " << hex << e << " but got " << actual << endl;   \
    ++errors;                                                           \
  }                                                                     \
  assert(ok);                                                           \
} while (0)

#define IsAlive(x) do { alive += IsNonZero(x); } while (0)

  // After the following line is where the uses of "Check" and such will go.
  static int index = 0;
if (offset == -1) { int alive = 0; IsAlive(farmhashmk::Hash32WithSeed(data, len++, SEED)); IsAlive(farmhashmk::Hash32(data, len++)); IsAlive(farmhashmk::Hash32(data, len++)); len -= 3; return alive > 0; }
Check(farmhashmk::Hash32WithSeed(data + offset, len, SEED));
Check(farmhashmk::Hash32(data + offset, len));

  return true;
#undef Check
#undef IsAlive
}

int RunTest() {
  Setup();
  int i = 0;
  cout << "Running farmhashmkTest";
  if (!Test(-1)) {
    cout << "... Unavailable\n";
    return NoteErrors();
  }
  // Good.  The function is attempting to hash, so run the full test.
  int errors_prior_to_test = errors;
  for ( ; i < kTestSize - 1; i++) {
    Test(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    Test(0, i);
  }
  Test(0, kDataSize);
  cout << (errors == errors_prior_to_test ? "... OK\n" : "... Failed\n");
  return NoteErrors();
}

#else

// After the following line is where the code to print hash codes will go.
void Dump(int offset, int len) {
cout << farmhashmk::Hash32WithSeed(data + offset, len, SEED) << "u," << endl;
cout << farmhashmk::Hash32(data + offset, len) << "u," << endl;
}

#endif

#undef SEED
#undef SEED1
#undef SEED0

}  // namespace farmhashmkTest

#if !TESTING
int main(int argc, char** argv) {
  Setup();
  cout << "uint32_t expected[] = {\n";
  int i = 0;
  for ( ; i < kTestSize - 1; i++) {
    farmhashmkTest::Dump(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    farmhashmkTest::Dump(0, i);
  }
  farmhashmkTest::Dump(0, kDataSize);
  cout << "};\n";
}
#endif
#ifndef FARMHASH_SELF_TEST_GUARD
#define FARMHASH_SELF_TEST_GUARD
#include <cstdio>
#include <iostream>
#include <string.h>

using std::cout;
using std::cerr;
using std::endl;
using std::hex;

static const uint64_t kSeed0 = 1234567;
static const uint64_t kSeed1 = k0;
static const int kDataSize = 1 << 20;
static const int kTestSize = 300;
#define kSeed128 Uint128(kSeed0, kSeed1)

static char data[kDataSize];

static int completed_self_tests = 0;
static int errors = 0;

// Initialize data to pseudorandom values.
void Setup() {
  if (completed_self_tests == 0) {
    uint64_t a = 9;
    uint64_t b = 777;
    for (int i = 0; i < kDataSize; i++) {
      a += b;
      b += a;
      a = (a ^ (a >> 41)) * k0;
      b = (b ^ (b >> 41)) * k0 + i;
      uint8_t u = b >> 37;
      memcpy(data + i, &u, 1);  // uint8_t -> char
    }
  }
}

int NoteErrors() {
#define NUM_SELF_TESTS 9
  if (++completed_self_tests == NUM_SELF_TESTS)
    std::exit(errors > 0);
  return errors;
}

template <typename T> inline bool IsNonZero(T x) {
  return x != 0;
}

template <> inline bool IsNonZero<uint128_t>(uint128_t x) {
  return x != Uint128(0, 0);
}

#endif  // FARMHASH_SELF_TEST_GUARD

namespace farmhashnaTest {

uint32_t CreateSeed(int offset, int salt) {
  uint32_t h = static_cast<uint32_t>(salt & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h += static_cast<uint32_t>(offset & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  return h;
}

#undef SEED
#undef SEED1
#undef SEED0
#define SEED CreateSeed(offset, -1)
#define SEED0 CreateSeed(offset, 0)
#define SEED1 CreateSeed(offset, 1)

#undef TESTING
#define TESTING 1
#if TESTING
uint32_t expected[] = {
1140953930u, 861465670u,
3277735313u, 2681724312u,
2598464059u, 797982799u,
890626835u, 800175912u,
2603993599u, 921001710u,
1410420968u, 2134990486u,
3283896453u, 1867689945u,
2914424215u, 2244477846u,
255297188u, 2992121793u,
1110588164u, 4186314283u,
161451183u, 3943596029u,
4019337850u, 452431531u,
283198166u, 2741341286u,
3379021470u, 2557197665u,
299850021u, 2532580744u,
452473466u, 1706958772u,
1298374911u, 3099673830u,
2199864459u, 3696623795u,
236935126u, 2976578695u,
4055299123u, 3281581178u,
1053458494u, 1882212500u,
2305012065u, 2169731866u,
3456121707u, 275903667u,
458884671u, 3033004529u,
3058973506u, 2379411653u,
1898235244u, 1402319660u,
2700149065u, 2699376854u,
147814787u, 720739346u,
2433714046u, 4222949502u,
4220361840u, 1712034059u,
3425469811u, 3690733394u,
4148372108u, 1330324210u,
594028478u, 2921867846u,
1635026870u, 192883107u,
780716741u, 1728752234u,
3280331829u, 326029180u,
3969463346u, 1436364519u,
393215742u, 3349570000u,
3824583307u, 1612122221u,
2859809759u, 3808705738u,
1379537552u, 1646032583u,
2233466664u, 1432476832u,
4023053163u, 2650381482u,
2052294713u, 3552092450u,
1628777059u, 1499109081u,
3476440786u, 3829307897u,
2960536756u, 1554038301u,
1145519619u, 3190844552u,
2902102606u, 3600725550u,
237495366u, 540224401u,
65721842u, 489963606u,
1448662590u, 397635823u,
1596489240u, 1562872448u,
1790705123u, 2128624475u,
180854224u, 2604346966u,
1435705557u, 1262831810u,
155445229u, 1672724608u,
1669465176u, 1341975128u,
663607706u, 2077310004u,
3610042449u, 1911523866u,
1043692997u, 1454396064u,
2563776023u, 294527927u,
1099072299u, 1389770549u,
703505868u, 678706990u,
2952353448u, 2026137563u,
3603803785u, 629449419u,
1933894405u, 3043213226u,
226132789u, 2489287368u,
1552847036u, 645684964u,
3828089804u, 3632594520u,
187883449u, 230403464u,
3151491850u, 3272648435u,
3729087873u, 1303930448u,
2002861219u, 165370827u,
916494250u, 1230085527u,
3103338579u, 3064290191u,
3807265751u, 3628174014u,
231181488u, 851743255u,
2295806711u, 1781190011u,
2988893883u, 1554380634u,
1142264800u, 3667013118u,
1968445277u, 315203929u,
2638023604u, 2290487377u,
732137533u, 1909203251u,
440398219u, 1891630171u,
1380301172u, 1498556724u,
4072067757u, 4165088768u,
4204318635u, 441430649u,
3931792696u, 197618179u,
956300927u, 914413116u,
3010839769u, 2837339569u,
2148126371u, 1913303225u,
3074915312u, 3117299654u,
4139181436u, 2993479124u,
3178848746u, 1357272220u,
1438494951u, 507436733u,
667183474u, 2084369203u,
3854939912u, 1413396341u,
126024219u, 146044391u,
1016656857u, 3022024459u,
3254014218u, 429095991u,
165589978u, 1578546616u,
985653208u, 1718653828u,
623071693u, 366414107u,
249776086u, 1207522198u,
3047342438u, 2991127487u,
3120876698u, 1684583131u,
46987739u, 1157614300u,
863214540u, 1087193030u,
199124911u, 520792961u,
3614377032u, 586863115u,
3331828431u, 1013201099u,
1716848157u, 4033596884u,
1164298657u, 4140791139u,
1146169032u, 1434258493u,
3824360466u, 3242407770u,
3725511003u, 232064808u,
872586426u, 762243036u,
2736953692u, 816692935u,
512845449u, 3748861010u,
2266795890u, 3781899767u,
4290630595u, 517646945u,
22638523u, 648000590u,
959214578u, 558910384u,
1283799121u, 3047062993u,
1024246061u, 4027776454u,
3544509313u, 622325861u,
834785312u, 382936554u,
411505255u, 1973395102u,
1825135056u, 2725923798u,
580988377u, 2826990641u,
3474970689u, 1029055034u,
812546227u, 2506885666u,
2584372201u, 1758123094u,
589567754u, 325737734u,
345313518u, 2022370576u,
3886113119u, 3338548567u,
257578986u, 3698087965u,
1776047957u, 1771384107u,
3604937815u, 3198590202u,
2305332220u, 191910725u,
4232136669u, 427759438u,
4244322689u, 542201663u,
3315355162u, 2135941665u,
556609672u, 45845311u,
1175961330u, 3948351189u,
23075771u, 3252374102u,
1634635545u, 4151937410u,
713127376u, 1467786451u,
663013031u, 3444053918u,
2638154051u, 810082938u,
3077742128u, 1062268187u,
2115441882u, 4081398201u,
3735739145u, 2794294783u,
2335576331u, 2560479831u,
1379288194u, 4225182569u,
2442302747u, 3948961926u,
3958366652u, 3067277639u,
3667516477u, 1709989541u,
1516711748u, 2339636583u,
4188504038u, 59581167u,
2725013602u, 3639843023u,
2658147000u, 2643979752u,
3758739543u, 4189944477u,
2470483982u, 877580602u,
2995362413u, 118817200u,
3252925478u, 2062343506u,
3981838403u, 3762572073u,
1231633714u, 4168280671u,
2931588131u, 3284356565u,
1129162571u, 732225574u,
4173605289u, 1407328702u,
1677744031u, 3532596884u,
3232041815u, 1652884780u,
2256541290u, 3459463480u,
3740979556u, 259034107u,
2227121257u, 1426140634u,
3606709555u, 3424793077u,
315836068u, 3200749877u,
1386256573u, 24035717u,
2982018998u, 1811050648u,
234531934u, 1115203611u,
1598686658u, 3146815575u,
1603559457u, 323296368u,
2632963283u, 1778459926u,
739944537u, 579625482u,
3486330348u, 492621815u,
1231665285u, 2457048126u,
3903349120u, 389846205u,
3355404249u, 3275550588u,
1052645068u, 862072556u,
2834153464u, 1481069623u,
2657392572u, 4279236653u,
1688445808u, 701920051u,
3740748788u, 3388062747u,
1873358321u, 2152785640u,
883382081u, 1005815394u,
1020177209u, 734239551u,
2371453141u, 100326520u,
3488500412u, 1279682138u,
2610427744u, 49703572u,
3026361211u, 605900428u,
302392721u, 2509302188u,
1416453607u, 2815915291u,
1862819968u, 519710058u,
2450888314u, 4017598378u,
937074653u, 3035635454u,
1590230729u, 3268013438u,
2710029305u, 12886044u,
3711259084u, 2627383582u,
3895772404u, 648534979u,
260307902u, 855990313u,
3669691805u, 263366740u,
2938543471u, 414331688u,
3080542944u, 3405007814u,
3565059103u, 1190977418u,
390836981u, 1606450012u,
2649808239u, 2514169310u,
2747519432u, 4129538640u,
1721522849u, 492099164u,
792990594u, 3625507637u,
2271095827u, 2993032712u,
2302363854u, 4013112951u,
1111617969u, 2183845740u,
795918276u, 1116991810u,
3110898804u, 3963062126u,
2737064702u, 462795667u,
937372240u, 1343017609u,
1091041189u, 2790555455u,
277024217u, 25485284u,
1166522068u, 1623631848u,
241727183u, 2836158787u,
3112996740u, 573836428u,
2721658101u, 1937681565u,
4175169209u, 3190765433u,
1970000788u, 1668258120u,
114616703u, 954762543u,
199237753u, 4094644498u,
2522281978u, 732086117u,
1756889687u, 2936126607u,
2437031370u, 4103143808u,
3883389541u, 3171090854u,
2483004780u, 1927385370u,
2360538162u, 2740855009u,
4241185118u, 1492209542u,
1672737098u, 2148675559u,
1789864670u, 2434313103u,
2319172611u, 2760941207u,
2636210123u, 1338083267u,
1128080590u, 822806371u,
1199583556u, 314727461u,
1335160250u, 2084630531u,
1156261526u, 316766066u,
112090465u, 3129033323u,
2746885618u, 636616055u,
2582210744u, 1721064910u,
3468394263u, 470463518u,
2076016059u, 408721884u,
2121041886u, 378460278u,
1915948002u, 357324860u,
2301682622u, 2691859523u,
1869756364u, 2429314418u,
2193146527u, 1185564327u,
2614088922u, 1975527044u,
919067651u, 2855948894u,
3662539576u, 1943802836u,
3529473373u, 1490330107u,
366036094u, 3384241033u,
4276268604u, 448403661u,
4271796078u, 1910401882u,
3077107698u, 299427366u,
2035665349u, 3201262636u,
3738454258u, 2554452696u,
3588997135u, 3363895827u,
1267505995u, 1852004679u,
2237827073u, 2803250686u,
3468044908u, 2143572850u,
1728158656u, 1022551180u,
1996680960u, 839529273u,
2400647871u, 2201096054u,
3606433628u, 2597259793u,
3544595875u, 3909443124u,
819278607u, 3447346709u,
806136613u, 2711436388u,
3656063205u, 837475154u,
694525336u, 4070212073u,
4011303412u, 1068395209u,
438095290u, 484603494u,
2673730227u, 737767009u,
642310823u, 3914002299u,
308425103u, 268427550u,
1334387085u, 4069797497u,
4280783219u, 2914011058u,
4243643405u, 2849988118u,
2504230175u, 1817156623u,
2804200483u, 3406991497u,
2948254999u, 2102063419u,
1071272117u, 514889942u,
571972433u, 1246595599u,
1735616066u, 1539151988u,
1230831543u, 277987182u,
4269526481u, 991511607u,
95237878u, 2005032160u,
1291113144u, 626619670u,
3560835907u, 164940926u,
1433635018u, 116647396u,
3039097112u, 2868163232u,
1141645918u, 1764165478u,
881378302u, 2159170082u,
2953647681u, 1011320066u,
184856151u, 1723308975u,
336034862u, 2017579106u,
1476681709u, 147523618u,
3896252223u, 2264728166u,
944743644u, 1694443528u,
2690700128u, 1947321519u,
735478508u, 4058183171u,
260177668u, 505662155u,
2391691262u, 1920739747u,
3216960415u, 1898176786u,
3722741628u, 1511077569u,
449636564u, 983350414u,
2580237367u, 2055059789u,
1103819072u, 2089123665u,
3873755579u, 2718467458u,
3124338704u, 3204250304u,
2475035432u, 1120017626u,
3873758287u, 1982999824u,
2950794582u, 780634378u,
2842141483u, 4029205195u,
1656892865u, 3330993377u,
80890710u, 1953796601u,
3873078673u, 136118734u,
2317676604u, 4199091610u,
1864448181u, 3063437608u,
1699452298u, 1403506686u,
1513069466u, 2348491299u,
4273657745u, 4055855649u,
1805475756u, 2562064338u,
973124563u, 4197091358u,
172861513u, 2858726767u,
4271866024u, 3071338162u,
3590386266u, 2328277259u,
1096050703u, 1189614342u,
459509140u, 771592405u,
817999971u, 3740825152u,
520400189u, 1941874618u,
185232757u, 4032960199u,
3928245258u, 3527721294u,
1301118856u, 752188080u,
3512945009u, 308584855u,
2105373972u, 752872278u,
3823368815u, 3760952096u,
4250142168u, 2565680167u,
3646354146u, 1259957455u,
1085857127u, 3471066607u,
38924274u, 3770488806u,
1083869477u, 3312508103u,
71956383u, 3738784936u,
3099963860u, 1255084262u,
4286969992u, 3621849251u,
1190908967u, 1831557743u,
2363435042u, 54945052u,
4059585566u, 4023974274u,
1788578453u, 3442180039u,
2534883189u, 2432427547u,
3909757989u, 731996369u,
4168347425u, 1356028512u,
2741583197u, 1280920000u,
312887059u, 3259015297u,
3946278527u, 4135481831u,
1281043691u, 1121403845u,
3312292477u, 1819941269u,
1741932545u, 3293015483u,
2127558730u, 713121337u,
2635469238u, 486003418u,
4015067527u, 2976737859u,
2108187161u, 927011680u,
1970188338u, 4177613234u,
1799789551u, 2118505126u,
4134691985u, 1958963937u,
1929210029u, 2555835851u,
2768832862u, 910892050u,
2567532373u, 4075249328u,
86689814u, 3726640307u,
1392137718u, 1240000030u,
4104757832u, 3026358429u,
313797689u, 1435798509u,
3101500919u, 1241665335u,
3573008472u, 3615577014u,
3767659003u, 3134294021u,
4063565523u, 2296824134u,
1541946015u, 3087190425u,
2693152531u, 2199672572u,
2123763822u, 1034244398u,
857839960u, 2515339233u,
2228007483u, 1628096047u,
2116502287u, 2502657424u,
2809830736u, 460237542u,
450205998u, 3646921704u,
3818199357u, 1808504491u,
1950698961u, 2069753399u,
3657033172u, 3734547671u,
4067859590u, 3292597295u,
1106466069u, 356742959u,
2469567432u, 3495418823u,
183440071u, 3248055817u,
3662626864u, 1750561299u,
3926138664u, 4088592524u,
567122118u, 3810297651u,
992181339u, 3384018814u,
3272124369u, 3177596743u,
320086295u, 2316548367u,
100741310u, 451656820u,
4086604273u, 3759628395u,
2553391092u, 1745659881u,
3650357479u, 2390172694u,
330172533u, 767377322u,
526742034u, 4102497288u,
2088767754u, 164402616u,
2482632320u, 2352347393u,
1873658044u, 3861555476u,
2751052984u, 1767810825u,
20037241u, 545143220u,
2594532522u, 472304191u,
3441135892u, 3323383489u,
258785117u, 2977745165u,
2781737565u, 2963590112u,
2756998822u, 207428029u,
2581558559u, 3824717027u,
1258619503u, 3472047571u,
2648427775u, 2360400900u,
2393763818u, 2332399088u,
3932701729u, 884421165u,
1396468647u, 1377764574u,
4061795938u, 1559119087u,
3343596838u, 3604258095u,
1435134775u, 1099809675u,
908163739u, 1418405656u,
368446627u, 3741651161u,
3374512975u, 3542220540u,
3244772570u, 200009340u,
3198975081u, 2521038253u,
4081637863u, 337070226u,
3235259030u, 3897262827u,
736956644u, 641040550u,
644850146u, 1306761320u,
4219448634u, 193750500u,
3293278106u, 1383997679u,
1242645122u, 4109252858u,
450747727u, 3716617561u,
362725793u, 2252520167u,
3377483696u, 1788337208u,
8130777u, 3226734120u,
759239140u, 1012411364u,
1658628529u, 2911512007u,
1002580201u, 1681898320u,
3039016929u, 4294520281u,
367022558u, 3071359622u,
3205848570u, 152989999u,
3839042136u, 2357687350u,
4273132307u, 3898950547u,
1176841812u, 1314157485u,
75443951u, 1027027239u,
1858986613u, 2040551642u,
36574105u, 2603059541u,
3456147251u, 2137668425u,
4077477194u, 3565689036u,
491832241u, 363703593u,
2579177168u, 3589545214u,
265993036u, 1864569342u,
4149035573u, 3189253455u,
1072259310u, 3153745937u,
923017956u, 490608221u,
855846773u, 845706553u,
1018226240u, 1604548872u,
3833372385u, 3287246572u,
2757959551u, 2452872151u,
1553870564u, 1713154780u,
2649450292u, 500120236u,
84251717u, 661869670u,
1444911517u, 2489716881u,
2810524030u, 1561519055u,
3884088359u, 2509890699u,
4247155916u, 1005636939u,
3224066062u, 2774151984u,
2035978240u, 2514910366u,
1478837908u, 3144450144u,
2107011431u, 96459446u,
3587732908u, 2389230590u,
3287635953u, 250533792u,
1235983679u, 4237425634u,
3704645833u, 3882376657u,
2976369049u, 1187061987u,
276949224u, 4100839753u,
1698347543u, 1629662314u,
1556151829u, 3784939568u,
427484362u, 4246879223u,
3155311770u, 4285163791u,
1693376813u, 124492786u,
1858777639u, 3476334357u,
1941442701u, 1121980173u,
3485932087u, 820852908u,
358032121u, 2511026735u,
1873607283u, 2556067450u,
2248275536u, 1528632094u,
1535473864u, 556796152u,
1499201704u, 1472623890u,
1526518503u, 3692729434u,
1476438092u, 2913077464u,
335109599u, 2167614601u,
4121131078u, 3158127917u,
3051522276u, 4046477658u,
2857717851u, 1863977403u,
1341023343u, 692059110u,
1802040304u, 990407433u,
3285847572u, 319814144u,
561105582u, 1540183799u,
4052924496u, 2926590471u,
2244539806u, 439121871u,
3317903224u, 3178387550u,
4265214507u, 82077489u,
1978918971u, 4279668976u,
128732476u, 2853224222u,
464407878u, 4190838199u,
997819001u, 3250520802u,
2330081301u, 4095846095u,
733509243u, 1583801700u,
722314527u, 3552883023u,
1403784280u, 432327540u,
1877837196u, 3912423882u,
505219998u, 696031431u,
908238873u, 4189387259u,
8759461u, 2540185277u,
3385159748u, 381355877u,
2519951681u, 1679786240u,
2019419351u, 4051584612u,
1933923923u, 3768201861u,
1670133081u, 3454981037u,
700836153u, 1675560450u,
371560700u, 338262316u,
847351840u, 2222395828u,
3130433948u, 405251683u,
3037574880u, 184098830u,
453340528u, 1385561439u,
2224044848u, 4071581802u,
1431235296u, 5570097u,
570114376u, 2287305551u,
2272418128u, 803575837u,
3943113491u, 414959787u,
708083137u, 2452657767u,
4019147902u, 3841480082u,
3791794715u, 2965956183u,
2763690963u, 2350937598u,
3424361375u, 779434428u,
1274947212u, 686105485u,
3426668051u, 3692865672u,
3057021940u, 2285701422u,
349809124u, 1379278508u,
3623750518u, 215970497u,
1783152480u, 823305654u,
216118434u, 1787189830u,
3692048450u, 2272612521u,
3032187389u, 4159715581u,
1388133148u, 1611772864u,
2544383526u, 552925303u,
3420960112u, 3198900547u,
3503230228u, 2603352423u,
2318375898u, 4064071435u,
3006227299u, 4194096960u,
1283392422u, 1510460996u,
174272138u, 3671038966u,
1775955687u, 1719108984u,
1763892006u, 1385029063u,
4083790740u, 406757708u,
684087286u, 531310503u,
3329923157u, 3492083607u,
1059031410u, 3037314475u,
3105682208u, 3382290593u,
2292208503u, 426380557u,
97373678u, 3842309471u,
777173623u, 3241407531u,
303065016u, 1477104583u,
4234905200u, 2512514774u,
2649684057u, 1397502982u,
1802596032u, 3973022223u,
2543566442u, 3139578968u,
3193669211u, 811750340u,
4013496209u, 567361887u,
4169410406u, 3622282782u,
3403136990u, 2540585554u,
895210040u, 3862229802u,
1145435213u, 4146963980u,
784952939u, 943914610u,
573034522u, 464420660u,
2356867109u, 3054347639u,
3985088434u, 1911188923u,
583391304u, 176468511u,
2990150068u, 2338031599u,
519948041u, 3181425568u,
496106033u, 4110294665u,
2736756930u, 1196757691u,
1089679033u, 240953857u,
3399092928u, 4040779538u,
2843673626u, 240495962u,
3017658263u, 3828377737u,
4243717901u, 2448373688u,
2759616657u, 2246245780u,
308018483u, 4262383425u,
2731780771u, 328023017u,
2884443148u, 841480070u,
3188015819u, 4051263539u,
2298178908u, 2944209234u,
1372958390u, 4164532914u,
4074952232u, 1683612329u,
2155036654u, 1872815858u,
2041174279u, 2368092311u,
206775997u, 2283918569u,
645945606u, 115406202u,
4206471368u, 3923500892u,
2217060665u, 350160869u,
706531239u, 2824302286u,
509981657u, 1469342315u,
140980u, 1891558063u,
164887091u, 3094962711u,
3437115622u, 13327420u,
422986366u, 330624974u,
3630863408u, 2425505046u,
824008515u, 3543885677u,
918718096u, 376390582u,
3224043675u, 3724791476u,
1837192976u, 2968738516u,
3424344721u, 3187805406u,
1550978788u, 1743089918u,
4251270061u, 645016762u,
3855037968u, 1928519266u,
1373803416u, 2289007286u,
1889218686u, 1610271373u,
3059200728u, 2108753646u,
582042641u, 812347242u,
3188172418u, 191994904u,
1343511943u, 2247006571u,
463291708u, 2697254095u,
1534175504u, 1106275740u,
622521957u, 917121602u,
4095777215u, 3955972648u,
3852234638u, 2845309942u,
3299763344u, 2864033668u,
2554947496u, 799569078u,
2551629074u, 1102873346u,
2661022773u, 2006922227u,
2900438444u, 1448194126u,
1321567432u, 1983773590u,
1237256330u, 3449066284u,
1691553115u, 3274671549u,
4271625619u, 2741371614u,
3285899651u, 786322314u,
1586632825u, 564385522u,
2530557509u, 2974240289u,
1244759631u, 3263135197u,
3592389776u, 3570296884u,
2749873561u, 521432811u,
987586766u, 3206261120u,
1327840078u, 4078716491u,
1753812954u, 976892272u,
1827135136u, 1781944746u,
1328622957u, 1015377974u,
3439601008u, 2209584557u,
2482286699u, 1109175923u,
874877499u, 2036083451u,
483570344u, 1091877599u,
4190721328u, 1129462471u,
640035849u, 1867372700u,
920761165u, 3273688770u,
1623777358u, 3389003793u,
3241132743u, 2734783008u,
696674661u, 2502161880u,
1646071378u, 1164309901u,
350411888u, 1978005963u,
2253937037u, 7371540u,
989577914u, 3626554867u,
3214796883u, 531343826u,
398899695u, 1145247203u,
1516846461u, 3656006011u,
529303412u, 3318455811u,
3062828129u, 1696355359u,
3698796465u, 3155218919u,
1457595996u, 3191404246u,
1395609912u, 2917345728u,
1237411891u, 1854985978u,
1091884675u, 3504488111u,
3109924189u, 1628881950u,
3939149151u, 878608872u,
778235395u, 1052990614u,
903730231u, 2069566979u,
2437686324u, 3163786257u,
2257884264u, 2123173186u,
939764916u, 2933010098u,
1235300371u, 1256485167u,
1950274665u, 2180372319u,
2648400302u, 122035049u,
1883344352u, 2083771672u,
3712110541u, 321199441u,
1896357377u, 508560958u,
3066325351u, 2770847216u,
3177982504u, 296902736u,
1486926688u, 456842861u,
601221482u, 3992583643u,
2794121515u, 1533934172u,
1706465470u, 4281971893u,
2557027816u, 900741486u,
227175484u, 550595824u,
690918144u, 2825943628u,
90375300u, 300318232u,
1985329734u, 1440763373u,
3670603707u, 2533900859u,
3253901179u, 542270815u,
3677388841u, 307706478u,
2570910669u, 3320103693u,
1273768482u, 1216399252u,
1652924805u, 1043647584u,
1120323676u, 639941430u,
325675502u, 3652676161u,
4241680335u, 1545838362u,
1991398008u, 4100211814u,
1097584090u, 3262252593u,
2254324292u, 1765019121u,
4060211241u, 2315856188u,
3704419305u, 411263051u,
238929055u, 3540688404u,
3094544537u, 3250435765u,
3460621305u, 1967599860u,
2016157366u, 847389916u,
1659615591u, 4020453639u,
901109753u, 2682611693u,
1661364280u, 177155177u,
3210561911u, 3802058181u,
797089608u, 3286110054u,
2110358240u, 1353279028u,
2479975820u, 471725410u,
2219863904u, 3623364733u,
3167128228u, 1052188336u,
3656587111u, 721788662u,
3061255808u, 1615375832u,
924941453u, 2547780700u,
3328169224u, 1310964134u,
2701956286u, 4145497671u,
1421461094u, 1221397398u,
1589183618u, 1492533854u,
449740816u, 2686506989u,
3035198924u, 1682886232u,
2529760244u, 3342031659u,
1235084019u, 2151665147u,
2315686577u, 3282027660u,
1140138691u, 2754346599u,
2091754612u, 1178454681u,
4226896579u, 2942520471u,
2122168506u, 3751680858u,
3213794286u, 2601416506u,
4142747914u, 3951404257u,
4243249649u, 748595836u,
4004834921u, 238887261u,
1927321047u, 2217148444u,
205977665u, 1885975275u,
186020771u, 2367569534u,
2941662631u, 2608559272u,
3342096731u, 741809437u,
1962659444u, 3539886328u,
3036596491u, 2282550094u,
2366462727u, 2748286642u,
2144472852u, 1390394371u,
1257385924u, 2205425874u,
2119055686u, 46865323u,
3597555910u, 3188438773u,
2372320753u, 3641116924u,
3116286108u, 2680722658u,
3371014971u, 2058751609u,
2966943726u, 2345078707u,
2330535244u, 4013841927u,
1169588594u, 857915866u,
1875260989u, 3175831309u,
3193475664u, 1955181430u,
923161569u, 4068653043u,
776445899u, 954196929u,
61509556u, 4248237857u,
3808667664u, 581227317u,
2893240187u, 4159497403u,
4212264930u, 3973886195u,
2077539039u, 851579036u,
2957587591u, 772351886u,
1173659554u, 946748363u,
2794103714u, 2094375930u,
4234750213u, 3671645488u,
2614250782u, 2620465358u,
3122317317u, 2365436865u,
3393973390u, 523513960u,
3645735309u, 2766686992u,
2023960931u, 2312244996u,
1875932218u, 3253711056u,
3622416881u, 3274929205u,
612094988u, 1555465129u,
2114270406u, 3553762793u,
1832633644u, 1087551556u,
3306195841u, 1702313921u,
3675066046u, 1735998785u,
1690923980u, 1482649756u,
1171351291u, 2043136409u,
1962596992u, 461214626u,
3278253346u, 1392428048u,
3744621107u, 1028502697u,
3991171462u, 1014064003u,
3642345425u, 3186995039u,
6114625u, 3359104346u,
414856965u, 2814387514u,
3583605071u, 2497896367u,
1024572712u, 1927582962u,
2892797583u, 845302635u,
328548052u, 1523379748u,
3392622118u, 1347167673u,
1012316581u, 37767602u,
2647726017u, 1070326065u,
2075035198u, 4202817168u,
2502924707u, 2612406822u,
2187115553u, 1180137213u,
701024148u, 1481965992u,
3223787553u, 2083541843u,
203230202u, 3876887380u,
1334816273u, 2870251538u,
2186205850u, 3985213979u,
333533378u, 806507642u,
1010064531u, 713520765u,
3084131515u, 2637421459u,
1703168933u, 1517562266u,
4089081247u, 3231042924u,
3079916123u, 3154574447u,
2253948262u, 1725190035u,
2452539325u, 1343734533u,
213706059u, 2519409656u,
108055211u, 2916327746u,
587001593u, 1917607088u,
4202913084u, 926304016u,
469255411u, 4042080256u,
3498936874u, 246692543u,
495780578u, 438717281u,
2259272650u, 4011324645u,
2836854664u, 2317249321u,
946828752u, 1280403658u,
1905648354u, 2034241661u,
774652981u, 1285694082u,
2200307766u, 2158671727u,
1135162148u, 232040752u,
397012087u, 1717527689u,
1720414106u, 918797022u,
2580119304u, 3568069742u,
2904461070u, 3893453420u,
973817938u, 667499332u,
3785870412u, 2088861715u,
1565179401u, 600903026u,
591806775u, 3512242245u,
997964515u, 2339605347u,
1134342772u, 3234226304u,
4084179455u, 302315791u,
2445626811u, 2590372496u,
345572299u, 2274770442u,
3600587867u, 3706939009u,
1430507980u, 2656330434u,
1079209397u, 2122849632u,
1423705223u, 3826321888u,
3683385276u, 1057038163u,
1242840526u, 3987000643u,
2398253089u, 1538190921u,
1295898647u, 3570196893u,
3065138774u, 3111336863u,
2524949549u, 4203895425u,
3025864372u, 968800353u,
1023721001u, 3763083325u,
526350786u, 635552097u,
2308118370u, 2166472723u,
2196937373u, 2643841788u,
3040011470u, 4010301879u,
2782379560u, 3474682856u,
4201389782u, 4223278891u,
1457302296u, 2251842132u,
1090062008u, 3188219189u,
292733931u, 1424229089u,
1590782640u, 1365212370u,
3975957073u, 3982969588u,
2927147928u, 1048291071u,
2766680094u, 884908196u,
35237839u, 2221180633u,
2490333812u, 4098360768u,
4029081103u, 3490831871u,
2392516272u, 3455379186u,
3948800722u, 335456628u,
2105117968u, 4181629008u,
1044201772u, 3335754111u,
540133451u, 3313113759u,
3786107905u, 2627207327u,
3540337875u, 3473113388u,
3430536378u, 2514123129u,
2124531276u, 3872633376u,
3272957388u, 3501994650u,
2418881542u, 487365389u,
3877672368u, 1512866656u,
3486531087u, 2102955203u,
1136054817u, 3004241477u,
1549075351u, 1302002008u,
3936430045u, 2258587644u,
4109233936u, 3679809321u,
3467083076u, 2484463221u,
1594979755u, 529218470u,
3527024461u, 1147434678u,
106799023u, 1823161970u,
1704656738u, 1675883700u,
3308746763u, 1875093248u,
1352868568u, 1898561846u,
2508994984u, 3177750780u,
4217929592u, 400784472u,
80090315u, 3564414786u,
3841585648u, 3379293868u,
160353261u, 2413172925u,
2378499279u, 673436726u,
1505702418u, 1330977363u,
1853298225u, 3201741245u,
2135714208u, 4069554166u,
3715612384u, 3692488887u,
3680311316u, 4274382900u,
914186796u, 2264886523u,
3869634032u, 1254199592u,
1131020455u, 194781179u,
429923922u, 2763792336u,
2052895198u, 3997373194u,
3440090658u, 2165746386u,
1575500242u, 3463310191u,
2064974716u, 3779513671u,
3106421434u, 880320527u,
3281914119u, 286569042u,
3909096631u, 122359727u,
1429837716u, 252230074u,
4111461225u, 762273136u,
93658514u, 2766407143u,
3623657004u, 3869801679u,
3925695921u, 2390397316u,
2499025338u, 2741806539u,
2507199021u, 1659221866u,
361292116u, 4048761557u,
3797133396u, 1517903247u,
3121647246u, 3884308578u,
1697201500u, 1558800262u,
4150812360u, 3161302278u,
2610217849u, 641564641u,
183814518u, 2075245419u,
611996508u, 2223461433u,
329123979u, 121860586u,
860985829u, 1137889144u,
4018949439u, 2904348960u,
947795261u, 1992594155u,
4255427501u, 2281583851u,
2892637604u, 1478186924u,
3050771207u, 2767035539u,
373510582u, 1963520320u,
3763848370u, 3756817798u,
627269409u, 1806905031u,
1814444610u, 3646665053u,
1822693920u, 278515794u,
584050483u, 4142579188u,
2149745808u, 3193071606u,
1179706341u, 2693495182u,
3259749808u, 644172091u,
880509048u, 3340630542u,
3365160815u, 2384445068u,
3053081915u, 2840648309u,
1986990122u, 1084703471u,
2370410550u, 1627743573u,
2244943480u, 4057483496u,
2611595995u, 2470013639u,
4024732359u, 3987190386u,
873421687u, 2447660175u,
3226583022u, 767655877u,
2528024413u, 1962070688u,
1233635843u, 2163464207u,
659054446u, 854207134u,
258410943u, 4197831420u,
2515400215u, 3100476924u,
1961549594u, 2219491151u,
3997658851u, 163850514u,
470325051u, 2598261204u,
3052145580u, 59836528u,
1376188597u, 966733415u,
850667549u, 3622479237u,
1083731990u, 1525777459u,
4005126532u, 1428155540u,
2781907007u, 943739431u,
1493961005u, 2839096988u,
2000057832u, 1941829603u,
1901484772u, 939810041u,
3377407371u, 3090115837u,
3310840540u, 2068409688u,
3261383939u, 2212130277u,
2594774045u, 2912652418u,
4179816101u, 3534504531u,
3349254805u, 2796552902u,
1385421283u, 4259908631u,
3714780837u, 3070073945u,
3372846298u, 3835884044u,
3047965714u, 3009018735u,
744091167u, 1861124263u,
2764936304u, 1338171648u,
4222019554u, 1395200692u,
1371426007u, 3338031581u,
2525665319u, 4196233786u,
2332743921u, 1474702008u,
2274266301u, 4255175517u,
2290169528u, 1793910997u,
2188254024u, 354202001u,
3864458796u, 4280290498u,
1554419340u, 1733094688u,
2010552302u, 1561807039u,
664313606u, 2548990879u,
1084699349u, 3233936866u,
973895284u, 2386881969u,
1831995860u, 2961465052u,
1428704144u, 3269904970u,
231648253u, 2602483763u,
4125013173u, 3319187387u,
3347011944u, 1892898231u,
4019114049u, 868879116u,
4085937045u, 2378411019u,
1072588531u, 3547435717u,
2208070766u, 1069899078u,
3142980597u, 2337088907u,
1593338562u, 919414554u,
688077849u, 3625708135u,
1472447348u, 1947711896u,
3953006207u, 877438080u,
845995820u, 3150361443u,
3053496713u, 2484577841u,
224271045u, 2914958001u,
2682612949u, 806655563u,
2436224507u, 1907729235u,
2920583824u, 1251814062u,
2070814520u, 4034325578u,
497847539u, 2714317144u,
385182008u, 640855184u,
1327075087u, 1062468773u,
1757405994u, 1374270191u,
4263183176u, 3041193150u,
1037871524u, 3633173991u,
4231821821u, 2830131945u,
3505072908u, 2830570613u,
4195208715u, 575398021u,
3992840257u, 3691788221u,
1949847968u, 2999344380u,
3183782163u, 3723754342u,
759716128u, 3284107364u,
1714496583u, 15918244u,
820509475u, 2553936299u,
2201876606u, 4237151697u,
2605688266u, 3253705097u,
1008333207u, 712158730u,
1722280252u, 1933868287u,
4152736859u, 2097020806u,
584426382u, 2836501956u,
2522777566u, 1996172430u,
2122199776u, 1069285218u,
1474209360u, 690831894u,
107482532u, 3695525410u,
670591796u, 768977505u,
2412057331u, 3647886687u,
3110327607u, 1072658422u,
379861934u, 1557579480u,
4124127129u, 2271365865u,
3880613089u, 739218494u,
547346027u, 388559045u,
3147335977u, 176230425u,
3094853730u, 2554321205u,
1495176194u, 4093461535u,
3521297827u, 4108148413u,
1913727929u, 1177947623u,
1911655402u, 1053371241u,
3265708874u, 1266515850u,
1045540427u, 3194420196u,
3717104621u, 1144474110u,
1464392345u, 52070157u,
4144237690u, 3350490823u,
4166253320u, 2747410691u,
};

// Return false only if offset is -1 and a spot check of 3 hashes all yield 0.
bool Test(int offset, int len = 0) {
#undef Check
#undef IsAlive

#define Check(x) do {                                                   \
  const uint32_t actual = (x), e = expected[index++];                   \
  bool ok = actual == e;                                                \
  if (!ok) {                                                            \
    cerr << "expected " << hex << e << " but got " << actual << endl;   \
    ++errors;                                                           \
  }                                                                     \
  assert(ok);                                                           \
} while (0)

#define IsAlive(x) do { alive += IsNonZero(x); } while (0)

  // After the following line is where the uses of "Check" and such will go.
  static int index = 0;
if (offset == -1) { int alive = 0; { uint64_t h = farmhashna::Hash64WithSeeds(data, len++, SEED0, SEED1); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } { uint64_t h = farmhashna::Hash64WithSeed(data, len++, SEED); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } { uint64_t h = farmhashna::Hash64(data, len++); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } len -= 3; return alive > 0; }
{ uint64_t h = farmhashna::Hash64WithSeeds(data + offset, len, SEED0, SEED1); Check(h >> 32); Check((h << 32) >> 32); }
{ uint64_t h = farmhashna::Hash64WithSeed(data + offset, len, SEED); Check(h >> 32); Check((h << 32) >> 32); }
{ uint64_t h = farmhashna::Hash64(data + offset, len); Check(h >> 32); Check((h << 32) >> 32); }

  return true;
#undef Check
#undef IsAlive
}

int RunTest() {
  Setup();
  int i = 0;
  cout << "Running farmhashnaTest";
  if (!Test(-1)) {
    cout << "... Unavailable\n";
    return NoteErrors();
  }
  // Good.  The function is attempting to hash, so run the full test.
  int errors_prior_to_test = errors;
  for ( ; i < kTestSize - 1; i++) {
    Test(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    Test(0, i);
  }
  Test(0, kDataSize);
  cout << (errors == errors_prior_to_test ? "... OK\n" : "... Failed\n");
  return NoteErrors();
}

#else

// After the following line is where the code to print hash codes will go.
void Dump(int offset, int len) {
{ uint64_t h = farmhashna::Hash64WithSeeds(data + offset, len, SEED0, SEED1); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
{ uint64_t h = farmhashna::Hash64WithSeed(data + offset, len, SEED); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
{ uint64_t h = farmhashna::Hash64(data + offset, len); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
}

#endif

#undef SEED
#undef SEED1
#undef SEED0

}  // namespace farmhashnaTest

#if !TESTING
int main(int argc, char** argv) {
  Setup();
  cout << "uint32_t expected[] = {\n";
  int i = 0;
  for ( ; i < kTestSize - 1; i++) {
    farmhashnaTest::Dump(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    farmhashnaTest::Dump(0, i);
  }
  farmhashnaTest::Dump(0, kDataSize);
  cout << "};\n";
}
#endif
#ifndef FARMHASH_SELF_TEST_GUARD
#define FARMHASH_SELF_TEST_GUARD
#include <cstdio>
#include <iostream>
#include <string.h>

using std::cout;
using std::cerr;
using std::endl;
using std::hex;

static const uint64_t kSeed0 = 1234567;
static const uint64_t kSeed1 = k0;
static const int kDataSize = 1 << 20;
static const int kTestSize = 300;
#define kSeed128 Uint128(kSeed0, kSeed1)

static char data[kDataSize];

static int completed_self_tests = 0;
static int errors = 0;

// Initialize data to pseudorandom values.
void Setup() {
  if (completed_self_tests == 0) {
    uint64_t a = 9;
    uint64_t b = 777;
    for (int i = 0; i < kDataSize; i++) {
      a += b;
      b += a;
      a = (a ^ (a >> 41)) * k0;
      b = (b ^ (b >> 41)) * k0 + i;
      uint8_t u = b >> 37;
      memcpy(data + i, &u, 1);  // uint8_t -> char
    }
  }
}

int NoteErrors() {
#define NUM_SELF_TESTS 9
  if (++completed_self_tests == NUM_SELF_TESTS)
    std::exit(errors > 0);
  return errors;
}

template <typename T> inline bool IsNonZero(T x) {
  return x != 0;
}

template <> inline bool IsNonZero<uint128_t>(uint128_t x) {
  return x != Uint128(0, 0);
}

#endif  // FARMHASH_SELF_TEST_GUARD

namespace farmhashntTest {

uint32_t CreateSeed(int offset, int salt) {
  uint32_t h = static_cast<uint32_t>(salt & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h += static_cast<uint32_t>(offset & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  return h;
}

#undef SEED
#undef SEED1
#undef SEED0
#define SEED CreateSeed(offset, -1)
#define SEED0 CreateSeed(offset, 0)
#define SEED1 CreateSeed(offset, 1)

#undef TESTING
#define TESTING 1
#if TESTING
uint32_t expected[] = {
2681724312u,
797982799u,
921001710u,
2134990486u,
2244477846u,
2992121793u,
3943596029u,
452431531u,
2557197665u,
2532580744u,
3099673830u,
3696623795u,
3281581178u,
1882212500u,
275903667u,
3033004529u,
1402319660u,
2699376854u,
4222949502u,
1712034059u,
1330324210u,
2921867846u,
1728752234u,
326029180u,
3349570000u,
1612122221u,
1646032583u,
1432476832u,
3552092450u,
1499109081u,
1554038301u,
3190844552u,
540224401u,
489963606u,
1562872448u,
2128624475u,
1262831810u,
1672724608u,
2077310004u,
1911523866u,
294527927u,
1389770549u,
2026137563u,
629449419u,
2489287368u,
645684964u,
230403464u,
3272648435u,
165370827u,
1230085527u,
3628174014u,
851743255u,
1554380634u,
3667013118u,
2290487377u,
1909203251u,
1498556724u,
4165088768u,
197618179u,
914413116u,
1913303225u,
3117299654u,
1357272220u,
507436733u,
1413396341u,
146044391u,
429095991u,
3056862311u,
366414107u,
2293458109u,
1684583131u,
1170404994u,
520792961u,
1577421232u,
4033596884u,
4229339322u,
3242407770u,
2649785113u,
816692935u,
3555213933u,
517646945u,
2180594090u,
3047062993u,
2391606125u,
382936554u,
788479970u,
2826990641u,
3167748333u,
1758123094u,
389974094u,
3338548567u,
2583576230u,
3198590202u,
4155628142u,
542201663u,
2856634168u,
3948351189u,
4194218315u,
1467786451u,
2743592929u,
1062268187u,
3810665822u,
2560479831u,
997658837u,
3067277639u,
1211737169u,
59581167u,
1389679610u,
4189944477u,
100876854u,
2062343506u,
3088828656u,
3284356565u,
3130054947u,
3532596884u,
3887208531u,
259034107u,
3233195759u,
3200749877u,
760633989u,
1115203611u,
1516407838u,
1778459926u,
2146672889u,
2457048126u,
2217471853u,
862072556u,
3745267835u,
701920051u,
581695350u,
1410111809u,
3326135446u,
2187968410u,
4267859263u,
479241367u,
2868987960u,
704325635u,
1418509533u,
735688735u,
3283299459u,
813690332u,
1439630796u,
3195309868u,
1616408198u,
3254795114u,
2799925823u,
3929484338u,
1798536177u,
4205965408u,
1499475160u,
4247675634u,
3779953975u,
785893184u,
2778575413u,
1160134629u,
823113169u,
4116162021u,
4167766971u,
2487440590u,
4004655503u,
4044418876u,
1462554406u,
2011102035u,
4265993528u,
576405853u,
4038839101u,
2425317635u,
1401013391u,
3062418115u,
3167030094u,
2602636307u,
4264167741u,
4017058800u,
1029665228u,
4036354071u,
2670703363u,
688472265u,
1054670286u,
338058159u,
1539305024u,
146827036u,
4060134777u,
2502815838u,
1603444633u,
2448966429u,
3891353218u,
1082330589u,
201837927u,
2848283092u,
883849006u,
1982110346u,
541496720u,
133643215u,
3847827123u,
4015671361u,
2849988118u,
3452457457u,
2102063419u,
3281002516u,
1539151988u,
1147951686u,
2005032160u,
2415262714u,
116647396u,
1029284767u,
2159170082u,
1919171906u,
2017579106u,
2473524405u,
1694443528u,
3671562289u,
505662155u,
1019936943u,
1511077569u,
773792826u,
2089123665u,
484732447u,
1120017626u,
2809286837u,
4029205195u,
1097806406u,
136118734u,
4017075736u,
1403506686u,
1516736273u,
2562064338u,
2984955003u,
3071338162u,
1923531348u,
771592405u,
2586632018u,
4032960199u,
2687561076u,
308584855u,
1692079268u,
2565680167u,
3674576684u,
3770488806u,
69201295u,
1255084262u,
3593730713u,
54945052u,
1939595371u,
2432427547u,
2295501078u,
1280920000u,
82177963u,
1121403845u,
2889101923u,
713121337u,
1747052377u,
927011680u,
4142246789u,
1958963937u,
1636932722u,
4075249328u,
2025886508u,
3026358429u,
1845587644u,
3615577014u,
1363253259u,
3087190425u,
341851980u,
2515339233u,
1276595523u,
460237542u,
4198897105u,
2069753399u,
4278599955u,
356742959u,
3735275001u,
1750561299u,
668829411u,
3384018814u,
4233785523u,
451656820u,
107312677u,
2390172694u,
1216645846u,
164402616u,
1689811113u,
1767810825u,
1397772514u,
3323383489u,
2986430557u,
207428029u,
2260498180u,
2360400900u,
1263709570u,
1377764574u,
4252610345u,
1099809675u,
2776960536u,
3542220540u,
3752806924u,
337070226u,
3267551635u,
1306761320u,
2220373824u,
4109252858u,
896322512u,
1788337208u,
1336556841u,
2911512007u,
3712582785u,
3071359622u,
2561488770u,
3898950547u,
536047554u,
2040551642u,
3528794619u,
3565689036u,
1197100813u,
1864569342u,
3329594980u,
490608221u,
1174785921u,
3287246572u,
2163330264u,
500120236u,
2520062970u,
1561519055u,
4042710240u,
2774151984u,
3160666939u,
96459446u,
1878067032u,
4237425634u,
2952135524u,
4100839753u,
1265237690u,
4246879223u,
834830418u,
3476334357u,
4277111759u,
2511026735u,
3065234219u,
556796152u,
198182691u,
2913077464u,
1535115487u,
4046477658u,
140762681u,
990407433u,
2198985327u,
2926590471u,
559702706u,
82077489u,
1096697687u,
4190838199u,
3046872820u,
1583801700u,
2185339100u,
3912423882u,
3703603898u,
2540185277u,
1446869792u,
4051584612u,
2719373510u,
1675560450u,
1996164093u,
405251683u,
2864244470u,
4071581802u,
2028708916u,
803575837u,
557660441u,
3841480082u,
255451671u,
779434428u,
3452203069u,
2285701422u,
1568745354u,
823305654u,
3184047862u,
4159715581u,
3160134214u,
3198900547u,
1566527339u,
4194096960u,
1496132623u,
1719108984u,
2584236470u,
531310503u,
3456882941u,
3382290593u,
467441309u,
3241407531u,
2540270567u,
1397502982u,
3348545480u,
811750340u,
1017047954u,
2540585554u,
3531646869u,
943914610u,
1903578924u,
1911188923u,
241574049u,
3181425568u,
3529565564u,
240953857u,
2964595704u,
3828377737u,
4260564140u,
4262383425u,
383233885u,
4051263539u,
919677938u,
1683612329u,
4204155962u,
2283918569u,
4153726847u,
350160869u,
1387233546u,
1891558063u,
740563169u,
330624974u,
2948665536u,
376390582u,
3799363969u,
3187805406u,
2263421398u,
1928519266u,
2746577402u,
2108753646u,
768287270u,
2247006571u,
212490675u,
917121602u,
2549835613u,
2864033668u,
3738062408u,
2006922227u,
2616619070u,
3449066284u,
431292293u,
786322314u,
1415970351u,
3263135197u,
2954777083u,
3206261120u,
2287507921u,
1781944746u,
4081586725u,
1109175923u,
1813855658u,
1129462471u,
1037031473u,
3389003793u,
3122687303u,
1164309901u,
3193251135u,
3626554867u,
3071568023u,
3656006011u,
1167681812u,
3155218919u,
2704165015u,
1854985978u,
1712976649u,
878608872u,
4155949943u,
3163786257u,
1626463554u,
1256485167u,
582664250u,
2083771672u,
804336148u,
2770847216u,
1674051445u,
3992583643u,
2966108111u,
900741486u,
4014551783u,
300318232u,
3517585534u,
542270815u,
760762191u,
1216399252u,
643179562u,
3652676161u,
2990167340u,
3262252593u,
2134299399u,
411263051u,
1342880802u,
1967599860u,
853593042u,
2682611693u,
850464484u,
3286110054u,
3842907484u,
3623364733u,
3693536939u,
1615375832u,
2318423400u,
4145497671u,
1728968857u,
2686506989u,
1502282913u,
2151665147u,
3651607391u,
1178454681u,
4146839064u,
2601416506u,
1448097974u,
238887261u,
4093725287u,
2367569534u,
679517009u,
3539886328u,
3086277222u,
1390394371u,
119173722u,
1766260771u,
751439914u,
215917713u,
2656990891u,
1570750352u,
3533987737u,
3576119563u,
963183826u,
3796810515u,
136547246u,
2592925324u,
427154472u,
1228758574u,
1464255968u,
2984611177u,
2001585786u,
1525438381u,
1348536411u,
2861338018u,
764077711u,
3785343245u,
457568934u,
4104954272u,
2381948487u,
3148473363u,
2180270337u,
1387729170u,
951677556u,
2721005055u,
66786703u,
1149351924u,
1895026827u,
3711056516u,
3638638708u,
2263003308u,
3448840877u,
225333538u,
3797521928u,
3262952567u,
2078619498u,
1178073973u,
3288261538u,
1496966875u,
2481012988u,
114945840u,
1632780103u,
2087949619u,
3787017905u,
2575395164u,
2971726178u,
3642087909u,
3894199764u,
203853421u,
425935223u,
3565833278u,
1748785729u,
580966986u,
2124704694u,
1107045577u,
1067532701u,
1406028344u,
18613994u,
3476683808u,
3762914298u,
1844996900u,
904215228u,
1118521573u,
3657647605u,
3136157065u,
2287683323u,
126005630u,
3555092974u,
49515858u,
1010661841u,
1902040126u,
1400735275u,
2771676666u,
2225229957u,
3454177594u,
2883475137u,
4144472319u,
1051332394u,
542648229u,
1669710469u,
553041029u,
584127807u,
2993670925u,
3587959456u,
1745399498u,
1404723176u,
1334333531u,
3239516985u,
1275954779u,
367320647u,
3684418197u,
4030809053u,
484559105u,
4255931645u,
4271715616u,
3171911678u,
928543347u,
2159512867u,
313902234u,
647086234u,
577214736u,
1130129573u,
995791646u,
1645086060u,
4122335794u,
1064648931u,
2752145076u,
3312498873u,
4238535494u,
1471227427u,
633688562u,
1959779970u,
766642813u,
1380896111u,
3647601207u,
1733961041u,
521947915u,
189164145u,
486382294u,
3770038872u,
3235740744u,
1912506671u,
2276864677u,
1588060152u,
2504457929u,
1471020554u,
3623212998u,
3026631806u,
2342164722u,
1674890530u,
3011542850u,
3549160092u,
4290680005u,
3943068002u,
2273781461u,
2127663659u,
1646681121u,
447810651u,
2366308558u,
970504950u,
2008155560u,
2695940969u,
3444688454u,
1739318893u,
2683090634u,
2774816580u,
437560100u,
512012738u,
3305170944u,
665292744u,
3580039116u,
1579404983u,
3397891494u,
710590371u,
2514565805u,
3624609754u,
3516075816u,
1314000850u,
1935166880u,
3257747610u,
3776931214u,
3183054185u,
675129307u,
3333261712u,
1154611403u,
2759854023u,
1963228038u,
505138315u,
1803966773u,
4032705384u,
798395739u,
3473799845u,
476400898u,
602972493u,
3289878097u,
2520311409u,
3214794876u,
748160407u,
1326769504u,
902775872u,
1372805534u,
1213925114u,
3009384989u,
3781981134u,
2835608783u,
2716786748u,
1669490957u,
1089334066u,
250756920u,
4041016629u,
2495807367u,
2008251381u,
106212622u,
1927268995u,
2251978818u,
3788056262u,
3678660147u,
2656772270u,
1997584981u,
2668998785u,
2954162084u,
845687881u,
776018378u,
2066910012u,
918315064u,
};

// Return false only if offset is -1 and a spot check of 3 hashes all yield 0.
bool Test(int offset, int len = 0) {
#undef Check
#undef IsAlive

#define Check(x) do {                                                   \
  const uint32_t actual = (x), e = expected[index++];                   \
  bool ok = actual == e;                                                \
  if (!ok) {                                                            \
    cerr << "expected " << hex << e << " but got " << actual << endl;   \
    ++errors;                                                           \
  }                                                                     \
  assert(ok);                                                           \
} while (0)

#define IsAlive(x) do { alive += IsNonZero(x); } while (0)

  // After the following line is where the uses of "Check" and such will go.
  static int index = 0;
if (offset == -1) { int alive = 0; IsAlive(farmhashnt::Hash32WithSeed(data, len++, SEED)); IsAlive(farmhashnt::Hash32(data, len++)); IsAlive(farmhashnt::Hash32(data, len++)); len -= 3; return alive > 0; }
Check(farmhashnt::Hash32WithSeed(data + offset, len, SEED));
Check(farmhashnt::Hash32(data + offset, len));

  return true;
#undef Check
#undef IsAlive
}

int RunTest() {
  Setup();
  int i = 0;
  cout << "Running farmhashntTest";
  if (!Test(-1)) {
    cout << "... Unavailable\n";
    return NoteErrors();
  }
  // Good.  The function is attempting to hash, so run the full test.
  int errors_prior_to_test = errors;
  for ( ; i < kTestSize - 1; i++) {
    Test(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    Test(0, i);
  }
  Test(0, kDataSize);
  cout << (errors == errors_prior_to_test ? "... OK\n" : "... Failed\n");
  return NoteErrors();
}

#else

// After the following line is where the code to print hash codes will go.
void Dump(int offset, int len) {
cout << farmhashnt::Hash32WithSeed(data + offset, len, SEED) << "u," << endl;
cout << farmhashnt::Hash32(data + offset, len) << "u," << endl;
}

#endif

#undef SEED
#undef SEED1
#undef SEED0

}  // namespace farmhashntTest

#if !TESTING
int main(int argc, char** argv) {
  Setup();
  cout << "uint32_t expected[] = {\n";
  int i = 0;
  for ( ; i < kTestSize - 1; i++) {
    farmhashntTest::Dump(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    farmhashntTest::Dump(0, i);
  }
  farmhashntTest::Dump(0, kDataSize);
  cout << "};\n";
}
#endif
#ifndef FARMHASH_SELF_TEST_GUARD
#define FARMHASH_SELF_TEST_GUARD
#include <cstdio>
#include <iostream>
#include <string.h>

using std::cout;
using std::cerr;
using std::endl;
using std::hex;

static const uint64_t kSeed0 = 1234567;
static const uint64_t kSeed1 = k0;
static const int kDataSize = 1 << 20;
static const int kTestSize = 300;
#define kSeed128 Uint128(kSeed0, kSeed1)

static char data[kDataSize];

static int completed_self_tests = 0;
static int errors = 0;

// Initialize data to pseudorandom values.
void Setup() {
  if (completed_self_tests == 0) {
    uint64_t a = 9;
    uint64_t b = 777;
    for (int i = 0; i < kDataSize; i++) {
      a += b;
      b += a;
      a = (a ^ (a >> 41)) * k0;
      b = (b ^ (b >> 41)) * k0 + i;
      uint8_t u = b >> 37;
      memcpy(data + i, &u, 1);  // uint8_t -> char
    }
  }
}

int NoteErrors() {
#define NUM_SELF_TESTS 9
  if (++completed_self_tests == NUM_SELF_TESTS)
    std::exit(errors > 0);
  return errors;
}

template <typename T> inline bool IsNonZero(T x) {
  return x != 0;
}

template <> inline bool IsNonZero<uint128_t>(uint128_t x) {
  return x != Uint128(0, 0);
}

#endif  // FARMHASH_SELF_TEST_GUARD

namespace farmhashsaTest {

uint32_t CreateSeed(int offset, int salt) {
  uint32_t h = static_cast<uint32_t>(salt & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h += static_cast<uint32_t>(offset & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  return h;
}

#undef SEED
#undef SEED1
#undef SEED0
#define SEED CreateSeed(offset, -1)
#define SEED0 CreateSeed(offset, 0)
#define SEED1 CreateSeed(offset, 1)

#undef TESTING
#define TESTING 1
#if TESTING
uint32_t expected[] = {
4223616069u,
3696677242u,
4081014168u,
2576519988u,
2212771159u,
1112731063u,
1020067935u,
3955445564u,
1451961420u,
653440099u,
31917516u,
2957164615u,
2590087362u,
3879448744u,
176305566u,
2447367541u,
1359016305u,
3363804638u,
1117290165u,
1062549743u,
2437877004u,
1894455839u,
673206794u,
3486923651u,
3269862919u,
2303349487u,
1380660650u,
595525107u,
1525325287u,
2025609358u,
176408838u,
1592885012u,
864896482u,
2101378090u,
3489229104u,
2118965695u,
581644891u,
2718789079u,
631613207u,
4228658372u,
3867875546u,
3531368319u,
3804516756u,
3317755099u,
1619744564u,
2884717286u,
1088213445u,
2667691076u,
3727873235u,
2330406762u,
858590707u,
123802208u,
4150036245u,
182283099u,
1478882570u,
3282617403u,
819171187u,
1172627392u,
4254302102u,
2957028020u,
437030323u,
2452147680u,
2868246750u,
3530169402u,
3154852132u,
215019192u,
357580983u,
1354454461u,
1108813287u,
2324008118u,
2315997713u,
4181601562u,
1360882441u,
92423273u,
3048866755u,
3369188505u,
3664371439u,
2920710428u,
1027891570u,
2653166430u,
3461888315u,
1475780447u,
292769636u,
1737473313u,
4064110516u,
4170160075u,
762850927u,
3630603695u,
2803307356u,
844987665u,
460980967u,
3005635467u,
2802568977u,
588668033u,
2148940781u,
3239099984u,
1266953698u,
3197808789u,
3519942533u,
2511995334u,
2553810188u,
871667697u,
1358675720u,
1499319171u,
2044931270u,
1210355103u,
807152540u,
3262320756u,
2810214575u,
1813386141u,
4089465863u,
903928165u,
1388899322u,
3209183659u,
834536144u,
2733354550u,
2742289921u,
3689042563u,
2655593281u,
4169686303u,
415985561u,
138892376u,
516115393u,
65683883u,
4162865100u,
889944635u,
313566528u,
3346420907u,
1504303591u,
2256809275u,
742243229u,
779775302u,
3140940172u,
2312556111u,
2304095772u,
1151741606u,
2194712422u,
1714084652u,
3272736835u,
1311540658u,
191179665u,
3996605106u,
1657345233u,
4205442903u,
1553339212u,
2351843044u,
1647502006u,
2525516233u,
292202846u,
1498646290u,
1429323381u,
974274898u,
3759331561u,
2881238887u,
826787221u,
1069622448u,
221991032u,
1462969082u,
2799661508u,
364022781u,
2594244377u,
797773898u,
4097839290u,
1529150125u,
2456805570u,
541503425u,
3936326142u,
3112719954u,
775223581u,
3074018423u,
3198488875u,
1772191849u,
2456535211u,
3154686028u,
1520862019u,
4005829426u,
1306433767u,
1943028506u,
2246000782u,
1057766454u,
3761996982u,
3441075333u,
898641979u,
3450209088u,
3941329307u,
3289922449u,
3085075827u,
1814193220u,
690422997u,
2627846676u,
2653520704u,
3739145533u,
3996776010u,
2287072592u,
1346671698u,
3082629900u,
2298811274u,
3639722036u,
1729419228u,
1836765953u,
3708118742u,
213436u,
950223749u,
3734247682u,
2924575678u,
1382024841u,
2431637732u,
3448846682u,
1341301397u,
4206956590u,
1730650902u,
2581075456u,
1542359141u,
707222542u,
2925350541u,
3846303536u,
3579103295u,
3932175763u,
1339615732u,
848825750u,
1070170828u,
1964973818u,
577060344u,
607721296u,
4031023048u,
406883794u,
3991905552u,
1198544082u,
872468460u,
1044847096u,
3159976313u,
3020028266u,
2108700400u,
3373767922u,
264431841u,
2817097007u,
3700061048u,
1733731531u,
3459415893u,
80378591u,
1479875104u,
19735612u,
1382658977u,
3416562245u,
1959852842u,
2384002344u,
124683828u,
3725782174u,
2300301222u,
393852269u,
1302492002u,
3623776492u,
3787086417u,
1730024749u,
1710531361u,
443700716u,
1461987482u,
671998131u,
3018380746u,
2592292305u,
3390799372u,
3945101155u,
3743494852u,
3716045582u,
996005166u,
320698449u,
3420221765u,
1518157951u,
2555810666u,
3381929684u,
2019638523u,
3088262796u,
2072178906u,
3433649364u,
203906916u,
34663784u,
290301305u,
1188021504u,
3754681145u,
3920313139u,
2840496520u,
1656802962u,
2288475489u,
3399185138u,
1296000826u,
2362384746u,
309633360u,
2719851778u,
776035930u,
3200733043u,
365690832u,
3326378243u,
1500331457u,
1625708592u,
4230903462u,
715344888u,
3363777768u,
2243620288u,
2890765789u,
553154234u,
4044100108u,
4056887320u,
1185656496u,
3671476744u,
1064586897u,
1154949698u,
3493481974u,
1294573722u,
1869224012u,
2530084956u,
995321553u,
833419249u,
563815282u,
250258043u,
2970801822u,
441007535u,
42246961u,
2820426655u,
2878882436u,
2363245780u,
2138489282u,
2972360481u,
2312619393u,
3598664848u,
3071556076u,
776990325u,
3220427357u,
2257939577u,
3817305903u,
1502979698u,
3159755934u,
3955997276u,
2423850008u,
1959927572u,
1219782288u,
4119776679u,
1124253854u,
3678052422u,
2620644947u,
1262408666u,
3480072280u,
2627137665u,
807538749u,
3276646337u,
518510128u,
1137828655u,
1498449110u,
3031692317u,
1125635969u,
1130096111u,
780007336u,
3111856399u,
1014917264u,
780877352u,
2909458336u,
4235949214u,
2423879289u,
275888892u,
3891926795u,
3538163953u,
54815161u,
162228302u,
258154068u,
3554455591u,
1801469029u,
2801563220u,
726560058u,
2450221940u,
3677582978u,
440993800u,
424762443u,
2624525253u,
2587715329u,
2292264424u,
1074856749u,
3294752007u,
3164112672u,
2399146799u,
1920182465u,
3858835361u,
193755240u,
3333610311u,
1757504059u,
2576027039u,
2775253365u,
2939191561u,
1046147275u,
235149906u,
4262218222u,
2900542726u,
2260154702u,
1019551635u,
1194720570u,
3519118691u,
3039483153u,
84918216u,
3053381097u,
2572396843u,
3849763371u,
2782686780u,
3710049554u,
3403430713u,
2346080784u,
2496307442u,
1597281872u,
696018239u,
704625714u,
623026921u,
3182413559u,
3794540330u,
305497722u,
1592680199u,
2377854072u,
3060601746u,
3953057908u,
3941551588u,
1033716182u,
2765716854u,
1309699058u,
3519400181u,
3073370877u,
115583008u,
4032909296u,
2944563574u,
3762753718u,
192842727u,
1711348701u,
3086147235u,
1658229443u,
1479783872u,
3839977157u,
225619117u,
1349684817u,
1964813173u,
565753187u,
2530252046u,
840014353u,
1645183704u,
3668429078u,
3438418557u,
639704059u,
360837811u,
2531807958u,
1572353913u,
2116037299u,
1948437512u,
744553393u,
2380697034u,
3775234105u,
3816065157u,
301868653u,
2960939561u,
3306528247u,
2389296549u,
805918610u,
1759358265u,
1760876328u,
2827601706u,
2944594708u,
3313666458u,
2022601495u,
730938791u,
193539397u,
2026103244u,
802928398u,
2630934308u,
782805818u,
3499326016u,
293509489u,
3646131514u,
3182478647u,
854800333u,
2284531628u,
438528022u,
2339298129u,
1692289216u,
2427728723u,
46501288u,
350652353u,
1355971222u,
889682372u,
944799254u,
2763906061u,
2807550612u,
2683762637u,
100870317u,
2449357318u,
2638348436u,
4206088869u,
1788948473u,
3537588549u,
2782490204u,
134406470u,
2409190528u,
2362439849u,
1861661528u,
2101513194u,
1424834765u,
3581765745u,
3185999525u,
2057487100u,
2303941176u,
3639628788u,
1180265315u,
230437935u,
2108319366u,
1131685143u,
1055685292u,
1509007009u,
1258485140u,
560525005u,
3598799040u,
3835680585u,
1851859628u,
332858996u,
641769248u,
4252450037u,
865386707u,
720719117u,
3133612164u,
3833045874u,
3492515435u,
2465970289u,
4234420011u,
573859916u,
252532886u,
870392318u,
4051320920u,
894929092u,
3748361688u,
699355960u,
1885212350u,
1609756949u,
461896870u,
1337065461u,
1775211059u,
1786193749u,
2815154643u,
2128729882u,
969639529u,
3960427545u,
859416958u,
2739758802u,
2698032197u,
2813292418u,
1985467524u,
396604317u,
4122172759u,
1201259789u,
4282051702u,
3270018895u,
961215209u,
961075860u,
4211926998u,
4088374597u,
577510509u,
3058349487u,
4025377754u,
2815478438u,
471023164u,
3947959608u,
4161486934u,
2299888461u,
1103571511u,
2450153872u,
1839939275u,
108299608u,
858086440u,
1030152945u,
3895328530u,
3009080718u,
3690840454u,
3847025277u,
152331362u,
161365689u,
831319961u,
2166017294u,
3945322722u,
4059970216u,
1420824131u,
2770648308u,
1567250186u,
2181067149u,
1939743488u,
3080158120u,
3435218248u,
2495237495u,
3814085102u,
3180983013u,
3199054292u,
2204745908u,
1140337267u,
2213569784u,
1941879842u,
2105562605u,
3618835614u,
2247103645u,
2492473487u,
856414299u,
166022030u,
4080104712u,
3218935344u,
3284220561u,
4261581452u,
1206944836u,
3496705432u,
2215996876u,
3154627465u,
3384005496u,
742170556u,
1333047620u,
802680366u,
156833431u,
2682100354u,
2493654830u,
584848366u,
1691693131u,
2169934170u,
779968026u,
2099545800u,
1423039695u,
4292110968u,
4266576788u,
149142597u,
748501873u,
3865014822u,
1913588198u,
130285614u,
3500768879u,
915458923u,
3071792750u,
1339986633u,
4143929149u,
4048379479u,
725193827u,
1375113643u,
2425277412u,
4144659274u,
465714768u,
226991589u,
2212127704u,
3936145258u,
2891024846u,
3816000225u,
979331165u,
1749907536u,
53847318u,
1462525833u,
2961425455u,
368859113u,
3572721452u,
453048644u,
1628629918u,
3497673923u,
3619079585u,
139870565u,
1518176798u,
3933074281u,
1878623729u,
2074035641u,
3016759257u,
1313053591u,
2557706970u,
2348296582u,
962370022u,
2337285014u,
1618936717u,
1915877085u,
2743743122u,
3250783882u,
1346652536u,
143311109u,
2443788461u,
1048248964u,
2806619339u,
3263266976u,
1668146349u,
3397428868u,
3276188862u,
1774196343u,
1993847813u,
2771079610u,
476672419u,
2119050359u,
2918326659u,
2245402721u,
2692910474u,
2374383269u,
342400227u,
2961437795u,
3899230368u,
337787132u,
3664444935u,
1269451153u,
2971526729u,
1486511182u,
791070133u,
2570319890u,
3482497490u,
2134230518u,
4273391202u,
1825511330u,
3947753714u,
1389755724u,
3995075516u,
2081052615u,
3626343470u,
4213603435u,
2137917278u,
2898987303u,
3059215715u,
3383237881u,
3003674434u,
409174425u,
1911915604u,
2087728055u,
2942005882u,
3386522440u,
714936074u,
261924004u,
3268784033u,
1141188757u,
2413217552u,
1515163433u,
};

// Return false only if offset is -1 and a spot check of 3 hashes all yield 0.
bool Test(int offset, int len = 0) {
#undef Check
#undef IsAlive

#define Check(x) do {                                                   \
  const uint32_t actual = (x), e = expected[index++];                   \
  bool ok = actual == e;                                                \
  if (!ok) {                                                            \
    cerr << "expected " << hex << e << " but got " << actual << endl;   \
    ++errors;                                                           \
  }                                                                     \
  assert(ok);                                                           \
} while (0)

#define IsAlive(x) do { alive += IsNonZero(x); } while (0)

  // After the following line is where the uses of "Check" and such will go.
  static int index = 0;
if (offset == -1) { int alive = 0; IsAlive(farmhashsa::Hash32WithSeed(data, len++, SEED)); IsAlive(farmhashsa::Hash32(data, len++)); IsAlive(farmhashsa::Hash32(data, len++)); len -= 3; return alive > 0; }
Check(farmhashsa::Hash32WithSeed(data + offset, len, SEED));
Check(farmhashsa::Hash32(data + offset, len));

  return true;
#undef Check
#undef IsAlive
}

int RunTest() {
  Setup();
  int i = 0;
  cout << "Running farmhashsaTest";
  if (!Test(-1)) {
    cout << "... Unavailable\n";
    return NoteErrors();
  }
  // Good.  The function is attempting to hash, so run the full test.
  int errors_prior_to_test = errors;
  for ( ; i < kTestSize - 1; i++) {
    Test(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    Test(0, i);
  }
  Test(0, kDataSize);
  cout << (errors == errors_prior_to_test ? "... OK\n" : "... Failed\n");
  return NoteErrors();
}

#else

// After the following line is where the code to print hash codes will go.
void Dump(int offset, int len) {
cout << farmhashsa::Hash32WithSeed(data + offset, len, SEED) << "u," << endl;
cout << farmhashsa::Hash32(data + offset, len) << "u," << endl;
}

#endif

#undef SEED
#undef SEED1
#undef SEED0

}  // namespace farmhashsaTest

#if !TESTING
int main(int argc, char** argv) {
  Setup();
  cout << "uint32_t expected[] = {\n";
  int i = 0;
  for ( ; i < kTestSize - 1; i++) {
    farmhashsaTest::Dump(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    farmhashsaTest::Dump(0, i);
  }
  farmhashsaTest::Dump(0, kDataSize);
  cout << "};\n";
}
#endif
#ifndef FARMHASH_SELF_TEST_GUARD
#define FARMHASH_SELF_TEST_GUARD
#include <cstdio>
#include <iostream>
#include <string.h>

using std::cout;
using std::cerr;
using std::endl;
using std::hex;

static const uint64_t kSeed0 = 1234567;
static const uint64_t kSeed1 = k0;
static const int kDataSize = 1 << 20;
static const int kTestSize = 300;
#define kSeed128 Uint128(kSeed0, kSeed1)

static char data[kDataSize];

static int completed_self_tests = 0;
static int errors = 0;

// Initialize data to pseudorandom values.
void Setup() {
  if (completed_self_tests == 0) {
    uint64_t a = 9;
    uint64_t b = 777;
    for (int i = 0; i < kDataSize; i++) {
      a += b;
      b += a;
      a = (a ^ (a >> 41)) * k0;
      b = (b ^ (b >> 41)) * k0 + i;
      uint8_t u = b >> 37;
      memcpy(data + i, &u, 1);  // uint8_t -> char
    }
  }
}

int NoteErrors() {
#define NUM_SELF_TESTS 9
  if (++completed_self_tests == NUM_SELF_TESTS)
    std::exit(errors > 0);
  return errors;
}

template <typename T> inline bool IsNonZero(T x) {
  return x != 0;
}

template <> inline bool IsNonZero<uint128_t>(uint128_t x) {
  return x != Uint128(0, 0);
}

#endif  // FARMHASH_SELF_TEST_GUARD

namespace farmhashsuTest {

uint32_t CreateSeed(int offset, int salt) {
  uint32_t h = static_cast<uint32_t>(salt & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h += static_cast<uint32_t>(offset & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  return h;
}

#undef SEED
#undef SEED1
#undef SEED0
#define SEED CreateSeed(offset, -1)
#define SEED0 CreateSeed(offset, 0)
#define SEED1 CreateSeed(offset, 1)

#undef TESTING
#define TESTING 1
#if TESTING
uint32_t expected[] = {
4223616069u,
3696677242u,
4081014168u,
2576519988u,
2212771159u,
1112731063u,
1020067935u,
3955445564u,
1451961420u,
653440099u,
31917516u,
2957164615u,
2590087362u,
3879448744u,
176305566u,
2447367541u,
1359016305u,
3363804638u,
1117290165u,
1062549743u,
2437877004u,
1894455839u,
673206794u,
3486923651u,
3269862919u,
2303349487u,
1380660650u,
595525107u,
1525325287u,
2025609358u,
176408838u,
1592885012u,
864896482u,
2101378090u,
3489229104u,
2118965695u,
581644891u,
2718789079u,
631613207u,
4228658372u,
3867875546u,
3531368319u,
3804516756u,
3317755099u,
1619744564u,
2884717286u,
1088213445u,
2667691076u,
3727873235u,
2330406762u,
858590707u,
457744844u,
4150036245u,
2000404290u,
1478882570u,
901678172u,
819171187u,
195942998u,
4254302102u,
3967266927u,
437030323u,
4018009204u,
2868246750u,
3540087514u,
3154852132u,
3319116625u,
357580983u,
3177665294u,
1108813287u,
1253366798u,
2315997713u,
510718750u,
1360882441u,
2770216279u,
3048866755u,
3406961221u,
3664371439u,
1151145514u,
1027891570u,
2699067992u,
3461888315u,
198061905u,
292769636u,
1106771795u,
4064110516u,
3258279756u,
762850927u,
1818699721u,
2803307356u,
3919169404u,
460980967u,
3125535078u,
2802568977u,
3582546426u,
2148940781u,
3963274378u,
1266953698u,
204185123u,
1100034381u,
3009193601u,
4200651967u,
274889605u,
2700589508u,
952511689u,
3765324859u,
3465498478u,
4014967037u,
2070988082u,
2972423530u,
3068638223u,
4156773651u,
489509804u,
1323863238u,
3731914806u,
2846098469u,
2728930632u,
346814072u,
848146907u,
551160669u,
4165126521u,
2039095001u,
4179859388u,
2434936359u,
2764414551u,
238491210u,
732483969u,
3366512764u,
478307468u,
4124179572u,
4142733597u,
1953448206u,
4199329278u,
865077060u,
2627662116u,
2802499360u,
3141206831u,
1959218197u,
911371451u,
125987200u,
2821366175u,
2530992747u,
2409206225u,
117991880u,
2133402461u,
895510531u,
428719601u,
3036014536u,
1223783733u,
733793540u,
970650405u,
547701766u,
570764615u,
3224485368u,
3192714940u,
319942831u,
3940200341u,
362056204u,
2832368105u,
1853281226u,
3296434636u,
3752508307u,
604292768u,
2231940616u,
1204094681u,
866194005u,
2405201650u,
2466384396u,
380829379u,
230033818u,
2783417588u,
4249886729u,
829569301u,
2988322580u,
2299983554u,
74748560u,
737514425u,
3153050211u,
652642663u,
1270205115u,
227197032u,
2773091790u,
325849216u,
49998791u,
4043203010u,
3662748068u,
1709364383u,
1179105165u,
1478504366u,
2980456610u,
1167476429u,
1590390732u,
1306256496u,
292008135u,
374690995u,
1809200819u,
1680595904u,
646040226u,
1742445560u,
2435776844u,
3703683804u,
478742495u,
814967947u,
2698190177u,
1003617993u,
1436118705u,
217056304u,
1412287094u,
2738417466u,
2933279339u,
3461877733u,
1203141205u,
2119492857u,
1134895723u,
1560001021u,
3786320122u,
3748116258u,
3486219595u,
702138030u,
1062984182u,
232789133u,
1566523968u,
3885443778u,
1820171888u,
3655858585u,
2316903005u,
2678779620u,
395625433u,
1609107564u,
3108726411u,
2937837224u,
3911907151u,
557272509u,
3893435978u,
1542613576u,
1079886893u,
2624566322u,
1413700616u,
2796974006u,
1922556114u,
562820464u,
2845409784u,
54180312u,
1898782464u,
3681814953u,
2417064617u,
1815464483u,
911626132u,
2964575550u,
1852696128u,
2319647785u,
1998904590u,
619992689u,
3073207513u,
1238163512u,
3199435982u,
828667254u,
3561155502u,
3943095163u,
1045711849u,
2238679131u,
2114975398u,
713808403u,
3871787494u,
2572031161u,
2360934075u,
2337781107u,
262596504u,
693836699u,
2129369850u,
3543189427u,
962205222u,
3685581020u,
692974477u,
725182211u,
646123906u,
2368836544u,
2505872733u,
1999977610u,
1639885802u,
1475058032u,
207023609u,
2773581234u,
3524857793u,
3433371102u,
3243027613u,
1787668353u,
985757946u,
3896012929u,
702356957u,
3559331129u,
884084870u,
4009998120u,
648888720u,
1403349048u,
1624342778u,
1766674171u,
2518582204u,
3251243146u,
792751003u,
1377201813u,
3629686054u,
1583734324u,
3647107626u,
4258564381u,
1469878609u,
1940598241u,
2755003690u,
1907120418u,
109916701u,
775347954u,
2090960874u,
611281803u,
3470490146u,
3301663253u,
1835412158u,
1803066146u,
591872433u,
550703713u,
1495089683u,
826492808u,
817200035u,
4177474571u,
688070143u,
971427632u,
1442499481u,
3568640348u,
2789993738u,
85808128u,
2058346726u,
394058570u,
3466511434u,
318905230u,
4149248030u,
415308316u,
165997598u,
1219639412u,
1648022659u,
2857432523u,
1422508004u,
468095522u,
296968649u,
430250611u,
1775562314u,
2976361671u,
1040036362u,
1372510167u,
292746272u,
3408238954u,
626061886u,
1317637569u,
1237775792u,
1218490455u,
2224234499u,
590942419u,
713995643u,
3541889330u,
4140218960u,
3529791107u,
354462673u,
842607274u,
365048533u,
2638303414u,
3560458014u,
31621379u,
4210854794u,
1273118792u,
2572743762u,
3513175801u,
402066986u,
602524471u,
565029192u,
180576438u,
1288605959u,
2896244423u,
1420543484u,
1329862227u,
1791567324u,
4248690247u,
12917038u,
3483481310u,
2082050731u,
1611921143u,
2443766548u,
2216338811u,
2528006095u,
2984009021u,
674210884u,
2857608106u,
2155534809u,
1023105067u,
2968955846u,
3303624302u,
2502112850u,
245749006u,
3175229091u,
3342796184u,
3613785362u,
1614168851u,
2582149283u,
895403488u,
416205023u,
3792242000u,
529397534u,
299415203u,
4284673348u,
2096851282u,
1864524731u,
2012577738u,
3426363316u,
1387308508u,
1143610148u,
2027467219u,
3772856163u,
3453862623u,
2661437174u,
2047145955u,
2533381447u,
2059534115u,
439426587u,
1537543414u,
2384289877u,
3174229055u,
2658017753u,
2293148474u,
2359450158u,
3930242475u,
1510302397u,
3354288821u,
920095603u,
2415746928u,
2729472638u,
2261143371u,
848667611u,
919157153u,
3322393117u,
4103299943u,
413569608u,
68911216u,
3334990170u,
1228068652u,
1570056373u,
1905477543u,
2622302276u,
2935063895u,
3224810004u,
4211768578u,
828688131u,
3556122839u,
1930935348u,
2605825202u,
1540993970u,
3209115883u,
122847500u,
665638794u,
506571051u,
2691795295u,
3996966556u,
714660621u,
3662432239u,
470651837u,
1807432621u,
3755290953u,
359878860u,
2793081615u,
4065031431u,
904653062u,
2317800777u,
568501094u,
3492871707u,
2738806116u,
2883859610u,
3242080257u,
364246691u,
3601786516u,
3159362524u,
1578272201u,
1283574375u,
2912186103u,
2256279032u,
1540671086u,
2356088973u,
2892277779u,
3441449267u,
2225005503u,
3846428419u,
2014549218u,
2290734767u,
2126684614u,
4235463487u,
3811556204u,
174739661u,
767525888u,
47684458u,
4211168099u,
889063422u,
469864411u,
767407110u,
413337343u,
1618456644u,
2814499820u,
2401124192u,
632089437u,
1234980238u,
1288585402u,
3153169944u,
2917822069u,
1843320264u,
3794359132u,
3074573530u,
258629454u,
3813357060u,
3806887248u,
1665524736u,
3324533324u,
3005091922u,
793108368u,
1529669805u,
2332660395u,
2217730223u,
2634687611u,
442806463u,
1968135266u,
454523002u,
3177866230u,
2808960136u,
4259114138u,
4103264843u,
3103714075u,
2462967542u,
1466891491u,
477973764u,
834565647u,
741089037u,
218837573u,
1710536528u,
2469088212u,
1229072375u,
2828341u,
176923431u,
985763350u,
4095477420u,
1984145538u,
1870791084u,
674956677u,
1978138947u,
1296493993u,
1818183554u,
3443333721u,
2124949983u,
2549590262u,
2700850794u,
2662736367u,
739638109u,
4061447096u,
2960078422u,
2453781158u,
929570940u,
3200328383u,
2406328791u,
1419180666u,
2152455739u,
2805741044u,
3305999074u,
3183816361u,
2303165050u,
4922104u,
63096005u,
936656347u,
3104453886u,
1088673880u,
1113407526u,
1457890086u,
453478383u,
1107686695u,
3626027824u,
1159687359u,
2248467888u,
2004578380u,
3274954621u,
1787958646u,
2628726704u,
1138419798u,
3735442315u,
692385301u,
313807213u,
2329068673u,
59375364u,
3261084359u,
2088644507u,
2471153194u,
788336435u,
4024527246u,
141504460u,
2307553888u,
1930559950u,
48975711u,
2745693338u,
230161982u,
3429230862u,
1335968626u,
609591304u,
57435073u,
4279281136u,
3152151665u,
3984484924u,
3459883943u,
397478330u,
1738762229u,
3033590066u,
3611539498u,
1363463523u,
3319364965u,
2671169141u,
3819548561u,
1691193757u,
2423834608u,
2820147055u,
1378120632u,
1240565187u,
3180720050u,
680831086u,
3309658414u,
1986166490u,
762099827u,
510883662u,
2047373648u,
3606742294u,
3894965352u,
2342078853u,
1091255717u,
776594727u,
3217317445u,
1574468485u,
3844504016u,
2819598918u,
1037401010u,
2550943503u,
3867184001u,
1687911772u,
165313836u,
1679575281u,
2418947263u,
2038774952u,
3913543652u,
3209155736u,
149905221u,
3859604717u,
713919631u,
4069810796u,
1882959164u,
1019939034u,
2379867302u,
3666323035u,
1157389013u,
2422300650u,
3366777340u,
2526452062u,
1313747885u,
1039617868u,
1620553692u,
2032976978u,
578789528u,
1592846839u,
2270630604u,
897850577u,
1603294178u,
3105664807u,
1442670138u,
1728019360u,
79313861u,
1683031101u,
1913067024u,
4070719870u,
708986470u,
2586453359u,
3993348863u,
3358251279u,
3003552537u,
750174793u,
836888956u,
4190747426u,
4251291318u,
4145164938u,
1366883260u,
1912910955u,
510192669u,
1851315039u,
3574241274u,
3220062924u,
2821142039u,
1317082195u,
2274293302u,
1839219569u,
126586168u,
3989293643u,
2680178207u,
347056948u,
799681430u,
2864517481u,
3180404853u,
213140045u,
1956305184u,
1474675286u,
3085723423u,
2841859626u,
308421914u,
3670309263u,
1765052231u,
245459238u,
113434331u,
4079521092u,
2115235526u,
2943408816u,
1055476938u,
1506442339u,
2291296392u,
3267864332u,
1282145528u,
3700108015u,
1932843667u,
2677701670u,
6041177u,
3889648557u,
1461025478u,
};

// Return false only if offset is -1 and a spot check of 3 hashes all yield 0.
bool Test(int offset, int len = 0) {
#undef Check
#undef IsAlive

#define Check(x) do {                                                   \
  const uint32_t actual = (x), e = expected[index++];                   \
  bool ok = actual == e;                                                \
  if (!ok) {                                                            \
    cerr << "expected " << hex << e << " but got " << actual << endl;   \
    ++errors;                                                           \
  }                                                                     \
  assert(ok);                                                           \
} while (0)

#define IsAlive(x) do { alive += IsNonZero(x); } while (0)

  // After the following line is where the uses of "Check" and such will go.
  static int index = 0;
if (offset == -1) { int alive = 0; IsAlive(farmhashsu::Hash32WithSeed(data, len++, SEED)); IsAlive(farmhashsu::Hash32(data, len++)); IsAlive(farmhashsu::Hash32(data, len++)); len -= 3; return alive > 0; }
Check(farmhashsu::Hash32WithSeed(data + offset, len, SEED));
Check(farmhashsu::Hash32(data + offset, len));

  return true;
#undef Check
#undef IsAlive
}

int RunTest() {
  Setup();
  int i = 0;
  cout << "Running farmhashsuTest";
  if (!Test(-1)) {
    cout << "... Unavailable\n";
    return NoteErrors();
  }
  // Good.  The function is attempting to hash, so run the full test.
  int errors_prior_to_test = errors;
  for ( ; i < kTestSize - 1; i++) {
    Test(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    Test(0, i);
  }
  Test(0, kDataSize);
  cout << (errors == errors_prior_to_test ? "... OK\n" : "... Failed\n");
  return NoteErrors();
}

#else

// After the following line is where the code to print hash codes will go.
void Dump(int offset, int len) {
cout << farmhashsu::Hash32WithSeed(data + offset, len, SEED) << "u," << endl;
cout << farmhashsu::Hash32(data + offset, len) << "u," << endl;
}

#endif

#undef SEED
#undef SEED1
#undef SEED0

}  // namespace farmhashsuTest

#if !TESTING
int main(int argc, char** argv) {
  Setup();
  cout << "uint32_t expected[] = {\n";
  int i = 0;
  for ( ; i < kTestSize - 1; i++) {
    farmhashsuTest::Dump(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    farmhashsuTest::Dump(0, i);
  }
  farmhashsuTest::Dump(0, kDataSize);
  cout << "};\n";
}
#endif
#ifndef FARMHASH_SELF_TEST_GUARD
#define FARMHASH_SELF_TEST_GUARD
#include <cstdio>
#include <iostream>
#include <string.h>

using std::cout;
using std::cerr;
using std::endl;
using std::hex;

static const uint64_t kSeed0 = 1234567;
static const uint64_t kSeed1 = k0;
static const int kDataSize = 1 << 20;
static const int kTestSize = 300;
#define kSeed128 Uint128(kSeed0, kSeed1)

static char data[kDataSize];

static int completed_self_tests = 0;
static int errors = 0;

// Initialize data to pseudorandom values.
void Setup() {
  if (completed_self_tests == 0) {
    uint64_t a = 9;
    uint64_t b = 777;
    for (int i = 0; i < kDataSize; i++) {
      a += b;
      b += a;
      a = (a ^ (a >> 41)) * k0;
      b = (b ^ (b >> 41)) * k0 + i;
      uint8_t u = b >> 37;
      memcpy(data + i, &u, 1);  // uint8_t -> char
    }
  }
}

int NoteErrors() {
#define NUM_SELF_TESTS 9
  if (++completed_self_tests == NUM_SELF_TESTS)
    std::exit(errors > 0);
  return errors;
}

template <typename T> inline bool IsNonZero(T x) {
  return x != 0;
}

template <> inline bool IsNonZero<uint128_t>(uint128_t x) {
  return x != Uint128(0, 0);
}

#endif  // FARMHASH_SELF_TEST_GUARD

namespace farmhashteTest {

uint32_t CreateSeed(int offset, int salt) {
  uint32_t h = static_cast<uint32_t>(salt & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h += static_cast<uint32_t>(offset & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  return h;
}

#undef SEED
#undef SEED1
#undef SEED0
#define SEED CreateSeed(offset, -1)
#define SEED0 CreateSeed(offset, 0)
#define SEED1 CreateSeed(offset, 1)

#undef TESTING
#define TESTING 1
#if TESTING
uint32_t expected[] = {
1140953930u, 861465670u,
3277735313u, 2681724312u,
2598464059u, 797982799u,
890626835u, 800175912u,
2603993599u, 921001710u,
1410420968u, 2134990486u,
3283896453u, 1867689945u,
2914424215u, 2244477846u,
255297188u, 2992121793u,
1110588164u, 4186314283u,
161451183u, 3943596029u,
4019337850u, 452431531u,
283198166u, 2741341286u,
3379021470u, 2557197665u,
299850021u, 2532580744u,
452473466u, 1706958772u,
1298374911u, 3099673830u,
2199864459u, 3696623795u,
236935126u, 2976578695u,
4055299123u, 3281581178u,
1053458494u, 1882212500u,
2305012065u, 2169731866u,
3456121707u, 275903667u,
458884671u, 3033004529u,
3058973506u, 2379411653u,
1898235244u, 1402319660u,
2700149065u, 2699376854u,
147814787u, 720739346u,
2433714046u, 4222949502u,
4220361840u, 1712034059u,
3425469811u, 3690733394u,
4148372108u, 1330324210u,
594028478u, 2921867846u,
1635026870u, 192883107u,
780716741u, 1728752234u,
3280331829u, 326029180u,
3969463346u, 1436364519u,
393215742u, 3349570000u,
3824583307u, 1612122221u,
2859809759u, 3808705738u,
1379537552u, 1646032583u,
2233466664u, 1432476832u,
4023053163u, 2650381482u,
2052294713u, 3552092450u,
1628777059u, 1499109081u,
3476440786u, 3829307897u,
2960536756u, 1554038301u,
1145519619u, 3190844552u,
2902102606u, 3600725550u,
237495366u, 540224401u,
65721842u, 489963606u,
1448662590u, 397635823u,
1596489240u, 1562872448u,
1790705123u, 2128624475u,
180854224u, 2604346966u,
1435705557u, 1262831810u,
155445229u, 1672724608u,
1669465176u, 1341975128u,
663607706u, 2077310004u,
3610042449u, 1911523866u,
1043692997u, 1454396064u,
2563776023u, 294527927u,
1099072299u, 1389770549u,
703505868u, 678706990u,
2952353448u, 2026137563u,
3603803785u, 629449419u,
1933894405u, 3043213226u,
226132789u, 2489287368u,
1552847036u, 645684964u,
3828089804u, 3632594520u,
187883449u, 230403464u,
3151491850u, 3272648435u,
3729087873u, 1303930448u,
2002861219u, 165370827u,
916494250u, 1230085527u,
3103338579u, 3064290191u,
3807265751u, 3628174014u,
231181488u, 851743255u,
2295806711u, 1781190011u,
2988893883u, 1554380634u,
1142264800u, 3667013118u,
1968445277u, 315203929u,
2638023604u, 2290487377u,
732137533u, 1909203251u,
440398219u, 1891630171u,
1380301172u, 1498556724u,
4072067757u, 4165088768u,
4204318635u, 441430649u,
3931792696u, 197618179u,
956300927u, 914413116u,
3010839769u, 2837339569u,
2148126371u, 1913303225u,
3074915312u, 3117299654u,
4139181436u, 2993479124u,
3178848746u, 1357272220u,
1438494951u, 507436733u,
667183474u, 2084369203u,
3854939912u, 1413396341u,
126024219u, 146044391u,
1016656857u, 3022024459u,
3254014218u, 429095991u,
990500595u, 3056862311u,
985653208u, 1718653828u,
623071693u, 366414107u,
1771289760u, 2293458109u,
3047342438u, 2991127487u,
3120876698u, 1684583131u,
3638043310u, 1170404994u,
863214540u, 1087193030u,
199124911u, 520792961u,
3169775996u, 1577421232u,
3331828431u, 1013201099u,
1716848157u, 4033596884u,
1770708857u, 4229339322u,
1146169032u, 1434258493u,
3824360466u, 3242407770u,
1926419493u, 2649785113u,
872586426u, 762243036u,
2736953692u, 816692935u,
1571283333u, 3555213933u,
2266795890u, 3781899767u,
4290630595u, 517646945u,
3006163611u, 2180594090u,
959214578u, 558910384u,
1283799121u, 3047062993u,
3830962609u, 2391606125u,
3544509313u, 622325861u,
834785312u, 382936554u,
1421463872u, 788479970u,
1825135056u, 2725923798u,
580988377u, 2826990641u,
247825043u, 3167748333u,
812546227u, 2506885666u,
2584372201u, 1758123094u,
1891789696u, 389974094u,
345313518u, 2022370576u,
3886113119u, 3338548567u,
1083486947u, 2583576230u,
1776047957u, 1771384107u,
3604937815u, 3198590202u,
3027522813u, 4155628142u,
4232136669u, 427759438u,
4244322689u, 542201663u,
1549591985u, 2856634168u,
556609672u, 45845311u,
1175961330u, 3948351189u,
4165739882u, 4194218315u,
1634635545u, 4151937410u,
713127376u, 1467786451u,
1327394015u, 2743592929u,
2638154051u, 810082938u,
3077742128u, 1062268187u,
4084325664u, 3810665822u,
3735739145u, 2794294783u,
2335576331u, 2560479831u,
690240711u, 997658837u,
2442302747u, 3948961926u,
3958366652u, 3067277639u,
2059157774u, 1211737169u,
1516711748u, 2339636583u,
4188504038u, 59581167u,
2767897792u, 1389679610u,
2658147000u, 2643979752u,
3758739543u, 4189944477u,
1454470782u, 100876854u,
2995362413u, 118817200u,
3252925478u, 2062343506u,
2804483644u, 3088828656u,
1231633714u, 4168280671u,
2931588131u, 3284356565u,
1255909792u, 3130054947u,
4173605289u, 1407328702u,
1677744031u, 3532596884u,
3162657845u, 3887208531u,
2256541290u, 3459463480u,
3740979556u, 259034107u,
392987633u, 3233195759u,
3606709555u, 3424793077u,
315836068u, 3200749877u,
4065431359u, 760633989u,
2982018998u, 1811050648u,
234531934u, 1115203611u,
3897494162u, 1516407838u,
1603559457u, 323296368u,
2632963283u, 1778459926u,
2879836826u, 2146672889u,
3486330348u, 492621815u,
1231665285u, 2457048126u,
3438440082u, 2217471853u,
3355404249u, 3275550588u,
1052645068u, 862072556u,
4110617119u, 3745267835u,
2657392572u, 4279236653u,
1688445808u, 701920051u,
956734128u, 581695350u,
3157862788u, 2585726058u,
1192588249u, 1410111809u,
1651193125u, 3326135446u,
1073280453u, 97376972u,
2513844237u, 2187968410u,
3976859649u, 4267859263u,
3429034542u, 564493077u,
3000537321u, 479241367u,
3845637831u, 2868987960u,
51544337u, 1029173765u,
393624922u, 704325635u,
2357610553u, 1418509533u,
2007814586u, 3866658271u,
3082385053u, 735688735u,
916110004u, 3283299459u,
1051684175u, 1083796807u,
4074716319u, 813690332u,
144264390u, 1439630796u,
1508556987u, 675582689u,
3748881891u, 3195309868u,
362884708u, 1616408198u,
43233176u, 837301135u,
881504822u, 3254795114u,
1385506591u, 2799925823u,
1469874582u, 3464841997u,
497175391u, 3929484338u,
3975771289u, 1798536177u,
2926265846u, 1374242438u,
3675707838u, 4205965408u,
3153165629u, 1499475160u,
187287713u, 548490821u,
3255259608u, 4247675634u,
1940181471u, 3779953975u,
687167150u, 2319566715u,
1742785722u, 785893184u,
2296977392u, 2778575413u,
1794720651u, 48131484u,
4084891412u, 1160134629u,
3737623280u, 823113169u,
3423207646u, 3803213486u,
710625654u, 4116162021u,
3693420287u, 4167766971u,
1666602807u, 295320990u,
3513255468u, 2487440590u,
234080704u, 4004655503u,
2971762528u, 1479656873u,
4090178629u, 4044418876u,
391947536u, 1462554406u,
3909295855u, 1239580330u,
1515601363u, 2011102035u,
1442068334u, 4265993528u,
1191921695u, 2291355695u,
4257172787u, 576405853u,
314332944u, 4038839101u,
55559918u, 2378985842u,
711098718u, 2425317635u,
1644327317u, 1401013391u,
4193760037u, 2958260436u,
3167371443u, 3062418115u,
3800755475u, 3167030094u,
3489648204u, 1405430357u,
526177822u, 2602636307u,
915406019u, 4264167741u,
1484090483u, 3070944737u,
254529415u, 4017058800u,
1702710265u, 1029665228u,
2000382906u, 3185573940u,
1381258384u, 4036354071u,
2900841028u, 2670703363u,
2921748807u, 2899069938u,
4130543625u, 688472265u,
4186808827u, 1054670286u,
1132985391u, 2840525968u,
4175776103u, 338058159u,
1735964501u, 1539305024u,
3497121710u, 1568260669u,
2227290760u, 146827036u,
3977176001u, 4060134777u,
857488494u, 250055052u,
4284109679u, 2502815838u,
2592281721u, 1603444633u,
1390562014u, 1556658131u,
616327404u, 2448966429u,
3051191726u, 3891353218u,
1213304082u, 762328245u,
2239052397u, 1082330589u,
2455957292u, 201837927u,
405397452u, 3079886794u,
2583939798u, 2848283092u,
3750724631u, 883849006u,
3204198988u, 3341327098u,
1855234968u, 1982110346u,
1485529487u, 541496720u,
4117290321u, 3607433551u,
2168864636u, 133643215u,
1055817409u, 3847827123u,
2960769387u, 4046101649u,
1176127003u, 4015671361u,
4243643405u, 2849988118u,
517111221u, 1796672358u,
2045051700u, 3452457457u,
2948254999u, 2102063419u,
1556410577u, 1536380876u,
3776661467u, 3281002516u,
1735616066u, 1539151988u,
1087795162u, 3332431596u,
685631442u, 1147951686u,
95237878u, 2005032160u,
4012206915u, 4224354805u,
3204999386u, 2415262714u,
1433635018u, 116647396u,
83167836u, 2881562655u,
2729416454u, 1029284767u,
881378302u, 2159170082u,
555057366u, 1169104445u,
3963877000u, 1919171906u,
336034862u, 2017579106u,
4059340529u, 3020819343u,
865146997u, 2473524405u,
944743644u, 1694443528u,
1804513294u, 2904752429u,
617975720u, 3671562289u,
260177668u, 505662155u,
1885941445u, 2504509403u,
2260041112u, 1019936943u,
3722741628u, 1511077569u,
3100701179u, 1379422864u,
1535670711u, 773792826u,
1103819072u, 2089123665u,
1157547425u, 329152940u,
4142587430u, 484732447u,
2475035432u, 1120017626u,
412145504u, 965125959u,
324924679u, 2809286837u,
2842141483u, 4029205195u,
2974306813u, 515627448u,
3791551981u, 1097806406u,
3873078673u, 136118734u,
1872130856u, 3632422367u,
3574135531u, 4017075736u,
1699452298u, 1403506686u,
344414660u, 1189129691u,
3487080616u, 1516736273u,
1805475756u, 2562064338u,
163335594u, 2732147834u,
4077452507u, 2984955003u,
4271866024u, 3071338162u,
2347111903u, 873829983u,
1948409509u, 1923531348u,
459509140u, 771592405u,
1750124750u, 2334938333u,
213811117u, 2586632018u,
185232757u, 4032960199u,
2447383637u, 284777551u,
1654276320u, 2687561076u,
3512945009u, 308584855u,
1861027147u, 4102279334u,
3203802620u, 1692079268u,
4250142168u, 2565680167u,
1507046104u, 841195925u,
520565830u, 3674576684u,
38924274u, 3770488806u,
2414430882u, 3978473838u,
3703994407u, 69201295u,
3099963860u, 1255084262u,
690971838u, 3539996781u,
3696902571u, 3593730713u,
2363435042u, 54945052u,
1785765213u, 184911581u,
1586241476u, 1939595371u,
2534883189u, 2432427547u,
2374171993u, 2039128933u,
2955715987u, 2295501078u,
2741583197u, 1280920000u,
686818699u, 1238742497u,
3843660102u, 82177963u,
1281043691u, 1121403845u,
1697846708u, 284852964u,
278661677u, 2889101923u,
2127558730u, 713121337u,
872502474u, 511142139u,
1261140657u, 1747052377u,
2108187161u, 927011680u,
955328267u, 3821994995u,
2707230761u, 4142246789u,
4134691985u, 1958963937u,
2498463509u, 1977988705u,
1419293714u, 1636932722u,
2567532373u, 4075249328u,
240575705u, 1956681213u,
2598802768u, 2025886508u,
4104757832u, 3026358429u,
3242615202u, 4026813725u,
255108733u, 1845587644u,
3573008472u, 3615577014u,
1222733548u, 1205557630u,
917608574u, 1363253259u,
1541946015u, 3087190425u,
1138008081u, 1444019663u,
109793386u, 341851980u,
857839960u, 2515339233u,
156283211u, 1906768669u,
3886713057u, 1276595523u,
2809830736u, 460237542u,
3420452099u, 142985419u,
205970448u, 4198897105u,
1950698961u, 2069753399u,
1142216925u, 1113051162u,
1033680610u, 4278599955u,
1106466069u, 356742959u,
531521052u, 3494863964u,
225629455u, 3735275001u,
3662626864u, 1750561299u,
1012864651u, 2101846429u,
1074553219u, 668829411u,
992181339u, 3384018814u,
3330664522u, 860966321u,
1885071395u, 4233785523u,
100741310u, 451656820u,
2148187612u, 1063001151u,
360256231u, 107312677u,
3650357479u, 2390172694u,
22452685u, 237319043u,
3600462351u, 1216645846u,
2088767754u, 164402616u,
2418980170u, 926137824u,
94638678u, 1689811113u,
2751052984u, 1767810825u,
271289013u, 3896132233u,
103797041u, 1397772514u,
3441135892u, 3323383489u,
2491268371u, 1662561885u,
1612872497u, 2986430557u,
2756998822u, 207428029u,
937973965u, 2791656726u,
1949717207u, 2260498180u,
2648427775u, 2360400900u,
2080496169u, 486358863u,
1582022990u, 1263709570u,
1396468647u, 1377764574u,
363008508u, 1293502429u,
224580012u, 4252610345u,
1435134775u, 1099809675u,
533671980u, 1533438766u,
1820532305u, 2776960536u,
3374512975u, 3542220540u,
822810075u, 3716663290u,
1157398049u, 3752806924u,
4081637863u, 337070226u,
3866585976u, 359270190u,
2110942730u, 3267551635u,
644850146u, 1306761320u,
746972907u, 934259457u,
2341378668u, 2220373824u,
1242645122u, 4109252858u,
1625266099u, 1173698481u,
383517064u, 896322512u,
3377483696u, 1788337208u,
455496839u, 3194373887u,
1837689083u, 1336556841u,
1658628529u, 2911512007u,
3838343487u, 2757664765u,
1537187340u, 3712582785u,
367022558u, 3071359622u,
3926147070u, 35432879u,
3093195926u, 2561488770u,
4273132307u, 3898950547u,
2838251049u, 2103926083u,
2549435227u, 536047554u,
1858986613u, 2040551642u,
1147412575u, 1972369852u,
4166184983u, 3528794619u,
4077477194u, 3565689036u,
808048238u, 3826350461u,
1359641525u, 1197100813u,
265993036u, 1864569342u,
725164342u, 2264788336u,
1831223342u, 3329594980u,
923017956u, 490608221u,
3818634478u, 258154469u,
1441714797u, 1174785921u,
3833372385u, 3287246572u,
1677395563u, 3569218731u,
868981704u, 2163330264u,
2649450292u, 500120236u,
465161780u, 746438382u,
1145009669u, 2520062970u,
2810524030u, 1561519055u,
1479878006u, 3864969305u,
2686075657u, 4042710240u,
3224066062u, 2774151984u,
2226179547u, 1643626042u,
2328730865u, 3160666939u,
2107011431u, 96459446u,
3920328742u, 3336407558u,
829404209u, 1878067032u,
1235983679u, 4237425634u,
466519055u, 3870676863u,
934312076u, 2952135524u,
276949224u, 4100839753u,
424001484u, 1955120893u,
4015478120u, 1265237690u,
427484362u, 4246879223u,
3452969617u, 1724363362u,
1553513184u, 834830418u,
1858777639u, 3476334357u,
4144030366u, 2450047160u,
2950762705u, 4277111759u,
358032121u, 2511026735u,
167923105u, 2059208280u,
251949572u, 3065234219u,
1535473864u, 556796152u,
1513237478u, 3150857516u,
1103404394u, 198182691u,
1476438092u, 2913077464u,
207119516u, 3963810232u,
2954651680u, 1535115487u,
3051522276u, 4046477658u,
917804636u, 864395565u,
632704095u, 140762681u,
1802040304u, 990407433u,
3771506212u, 4106024923u,
1287729497u, 2198985327u,
4052924496u, 2926590471u,
3084557148u, 1472898694u,
1009870118u, 559702706u,
4265214507u, 82077489u,
3067891003u, 3295678907u,
2402308151u, 1096697687u,
464407878u, 4190838199u,
4269578403u, 3060919438u,
2899950405u, 3046872820u,
733509243u, 1583801700u,
40453902u, 3879773881u,
1993425202u, 2185339100u,
1877837196u, 3912423882u,
3293122640u, 4104318469u,
1679617763u, 3703603898u,
8759461u, 2540185277u,
1152198475u, 2038345882u,
2503579743u, 1446869792u,
2019419351u, 4051584612u,
3178289407u, 3992503830u,
2879018745u, 2719373510u,
700836153u, 1675560450u,
4121245793u, 2064715719u,
343595772u, 1996164093u,
3130433948u, 405251683u,
2804817126u, 1607133689u,
463852893u, 2864244470u,
2224044848u, 4071581802u,
2537107938u, 2246347953u,
3207234525u, 2028708916u,
2272418128u, 803575837u,
38655481u, 2170452091u,
3272166407u, 557660441u,
4019147902u, 3841480082u,
298459606u, 2600943364u,
2440657523u, 255451671u,
3424361375u, 779434428u,
3088526123u, 490671625u,
1322855877u, 3452203069u,
3057021940u, 2285701422u,
2014993457u, 2390431709u,
2002090272u, 1568745354u,
1783152480u, 823305654u,
4053862835u, 2200236540u,
3009412313u, 3184047862u,
3032187389u, 4159715581u,
2966902888u, 252986948u,
1849329144u, 3160134214u,
3420960112u, 3198900547u,
749160960u, 379139040u,
1208883495u, 1566527339u,
3006227299u, 4194096960u,
556075248u, 497404038u,
1717327230u, 1496132623u,
1775955687u, 1719108984u,
1014328900u, 4189966956u,
2108574735u, 2584236470u,
684087286u, 531310503u,
4264509527u, 773405691u,
3088905079u, 3456882941u,
3105682208u, 3382290593u,
2289363624u, 3296306400u,
4168438718u, 467441309u,
777173623u, 3241407531u,
1183994815u, 1132983260u,
1610606159u, 2540270567u,
2649684057u, 1397502982u,
146657385u, 3318434267u,
2109315753u, 3348545480u,
3193669211u, 811750340u,
1073256162u, 3571673088u,
546596661u, 1017047954u,
3403136990u, 2540585554u,
1477047647u, 4145867423u,
2826408201u, 3531646869u,
784952939u, 943914610u,
2717443875u, 3657384638u,
1806867885u, 1903578924u,
3985088434u, 1911188923u,
1764002686u, 3672748083u,
1832925325u, 241574049u,
519948041u, 3181425568u,
2939747257u, 1634174593u,
3429894862u, 3529565564u,
1089679033u, 240953857u,
2025369941u, 2695166650u,
517086873u, 2964595704u,
3017658263u, 3828377737u,
2144895011u, 994799311u,
1184683823u, 4260564140u,
308018483u, 4262383425u,
1374752558u, 3431057723u,
1572637805u, 383233885u,
3188015819u, 4051263539u,
233319221u, 3794788167u,
2017406667u, 919677938u,
4074952232u, 1683612329u,
4213676186u, 327142514u,
3032591014u, 4204155962u,
206775997u, 2283918569u,
2395147154u, 3427505379u,
2211319468u, 4153726847u,
2217060665u, 350160869u,
2493667051u, 1648200185u,
3441709766u, 1387233546u,
140980u, 1891558063u,
760080239u, 2088061981u,
1580964938u, 740563169u,
422986366u, 330624974u,
4264507722u, 150928357u,
2738323042u, 2948665536u,
918718096u, 376390582u,
3966098971u, 717653678u,
3219466255u, 3799363969u,
3424344721u, 3187805406u,
375347278u, 3490350144u,
1992212097u, 2263421398u,
3855037968u, 1928519266u,
3866327955u, 1129127000u,
1782515131u, 2746577402u,
3059200728u, 2108753646u,
2738070963u, 1336849395u,
1705302106u, 768287270u,
1343511943u, 2247006571u,
1956142255u, 1780259453u,
3475618043u, 212490675u,
622521957u, 917121602u,
1852992332u, 1267987847u,
3170016833u, 2549835613u,
3299763344u, 2864033668u,
3378768767u, 1236609378u,
4169365948u, 3738062408u,
2661022773u, 2006922227u,
2760592161u, 3828932355u,
2636387819u, 2616619070u,
1237256330u, 3449066284u,
2871755260u, 3729280948u,
3862686086u, 431292293u,
3285899651u, 786322314u,
2531158535u, 724901242u,
2377363130u, 1415970351u,
1244759631u, 3263135197u,
965248856u, 174024139u,
2297418515u, 2954777083u,
987586766u, 3206261120u,
4059515114u, 3903854066u,
1931934525u, 2287507921u,
1827135136u, 1781944746u,
574617451u, 2299034788u,
2650140034u, 4081586725u,
2482286699u, 1109175923u,
458483596u, 618705848u,
4059852729u, 1813855658u,
4190721328u, 1129462471u,
4089998050u, 3575732749u,
2375584220u, 1037031473u,
1623777358u, 3389003793u,
546597541u, 352770237u,
1383747654u, 3122687303u,
1646071378u, 1164309901u,
290870767u, 830691298u,
929335420u, 3193251135u,
989577914u, 3626554867u,
591974737u, 3996958215u,
3163711272u, 3071568023u,
1516846461u, 3656006011u,
2698625268u, 2510865430u,
340274176u, 1167681812u,
3698796465u, 3155218919u,
4102288238u, 1673474350u,
3069708839u, 2704165015u,
1237411891u, 1854985978u,
3646837503u, 3625406022u,
921552000u, 1712976649u,
3939149151u, 878608872u,
3406359248u, 1068844551u,
1834682077u, 4155949943u,
2437686324u, 3163786257u,
2645117577u, 1988168803u,
747285578u, 1626463554u,
1235300371u, 1256485167u,
1914142538u, 4141546431u,
3838102563u, 582664250u,
1883344352u, 2083771672u,
2611657933u, 2139079047u,
2250573853u, 804336148u,
3066325351u, 2770847216u,
4275641370u, 1455750577u,
3346357270u, 1674051445u,
601221482u, 3992583643u,
1402445097u, 3622527604u,
2509017299u, 2966108111u,
2557027816u, 900741486u,
1790771021u, 2912643797u,
2631381069u, 4014551783u,
90375300u, 300318232u,
3269968032u, 2679371729u,
2664752123u, 3517585534u,
3253901179u, 542270815u,
1188641600u, 365479232u,
2210121140u, 760762191u,
1273768482u, 1216399252u,
3484324231u, 4287337666u,
16322182u, 643179562u,
325675502u, 3652676161u,
3120716054u, 3330259752u,
1011990087u, 2990167340u,
1097584090u, 3262252593u,
1829409951u, 3665087267u,
1214854475u, 2134299399u,
3704419305u, 411263051u,
1625446136u, 549838529u,
4283196353u, 1342880802u,
3460621305u, 1967599860u,
4282843369u, 1275671016u,
2544665755u, 853593042u,
901109753u, 2682611693u,
110631633u, 797487791u,
1472073141u, 850464484u,
797089608u, 3286110054u,
350397471u, 2775631060u,
366448238u, 3842907484u,
2219863904u, 3623364733u,
1850985302u, 4009616991u,
294963924u, 3693536939u,
3061255808u, 1615375832u,
1920066675u, 4113028420u,
4032223840u, 2318423400u,
2701956286u, 4145497671u,
3991532344u, 2536338351u,
1679099863u, 1728968857u,
449740816u, 2686506989u,
685242457u, 97590863u,
3258354115u, 1502282913u,
1235084019u, 2151665147u,
528459289u, 231097464u,
2477280726u, 3651607391u,
2091754612u, 1178454681u,
980597335u, 1604483865u,
1842333726u, 4146839064u,
3213794286u, 2601416506u,
754220096u, 3571436033u,
488595746u, 1448097974u,
4004834921u, 238887261u,
3320337489u, 1416989070u,
2928916831u, 4093725287u,
186020771u, 2367569534u,
3046087671u, 4090084518u,
3548184546u, 679517009u,
1962659444u, 3539886328u,
4192003933u, 1678423485u,
3827951761u, 3086277222u,
2144472852u, 1390394371u,
2976322029u, 1574517163u,
3553313841u, 119173722u,
1702434637u, 1766260771u,
3629581771u, 1407497759u,
895654784u, 751439914u,
4008409498u, 215917713u,
1482103833u, 695551833u,
1288382231u, 2656990891u,
2581779077u, 1570750352u,
3710689053u, 1741390464u,
2666411616u, 3533987737u,
4289478316u, 3576119563u,
4118694920u, 108199666u,
3869794273u, 963183826u,
2081410737u, 3796810515u,
791123882u, 2525792704u,
1036883117u, 136547246u,
875691100u, 2592925324u,
614302599u, 3013176417u,
2689342539u, 427154472u,
532957601u, 1228758574u,
1898117151u, 1181643858u,
1908591042u, 1464255968u,
446980910u, 2984611177u,
58509511u, 1046943619u,
3508927906u, 2001585786u,
2544767379u, 1525438381u,
552181222u, 1959725830u,
879448844u, 1348536411u,
4242243590u, 2861338018u,
1082052441u, 1034351453u,
601175800u, 764077711u,
530635011u, 3785343245u,
2178026726u, 117256687u,
2378297261u, 457568934u,
76438221u, 4104954272u,
956793873u, 3783168634u,
2485968477u, 2381948487u,
4226929450u, 3148473363u,
2518273601u, 3569490233u,
879369091u, 2180270337u,
3674375989u, 1387729170u,
977997984u, 4270646856u,
568650985u, 951677556u,
4213877384u, 2721005055u,
1073364549u, 2563403831u,
1678669911u, 66786703u,
2273631661u, 1149351924u,
3651298990u, 1581883443u,
246723096u, 1895026827u,
3810605772u, 3711056516u,
4058833288u, 2193790614u,
2080120290u, 3638638708u,
2915672708u, 2263003308u,
2361934197u, 4136767460u,
1976115991u, 3448840877u,
2019238520u, 225333538u,
874340815u, 2976159827u,
1555273378u, 3797521928u,
1942347150u, 3262952567u,
435997738u, 340403353u,
2817830907u, 2078619498u,
749534111u, 1178073973u,
894654712u, 3361226032u,
841092198u, 3288261538u,
1696412169u, 1496966875u,
697501571u, 1059158875u,
3739946319u, 2481012988u,
568983526u, 114945840u,
1559249010u, 2218244008u,
2841706923u, 1632780103u,
4020169654u, 2087949619u,
2438736103u, 24032648u,
833416317u, 3787017905u,
2373238993u, 2575395164u,
3434544481u, 3228481067u,
2542976862u, 2971726178u,
2880371864u, 3642087909u,
2407477975u, 2239080836u,
1043714217u, 3894199764u,
2235879182u, 203853421u,
2933669448u, 2504940536u,
834683330u, 425935223u,
3560796393u, 3565833278u,
1668000829u, 3683399154u,
3414330886u, 1748785729u,
1023171602u, 580966986u,
2531038985u, 3227325488u,
2657385925u, 2124704694u,
233442446u, 1107045577u,
3407293834u, 552770757u,
3899097693u, 1067532701u,
115667924u, 1406028344u,
1707768231u, 3724015962u,
2419657149u, 18613994u,
2532882091u, 3476683808u,
1560838678u, 811220224u,
895961699u, 3762914298u,
1328752423u, 1844996900u,
1420427894u, 1848067707u,
1210281744u, 904215228u,
4055325594u, 1118521573u,
2496554183u, 2579259919u,
3996647489u, 3657647605u,
325254059u, 3136157065u,
3951522674u, 4052925250u,
3341068436u, 2287683323u,
1313073005u, 126005630u,
2505120084u, 1194725057u,
853746559u, 3555092974u,
2689238752u, 49515858u,
1244776042u, 1069300695u,
61073168u, 1010661841u,
1269521335u, 1902040126u,
990632502u, 2378708922u,
3858321250u, 1400735275u,
2974699176u, 2771676666u,
170995186u, 2877798589u,
545726212u, 2225229957u,
1086473152u, 3454177594u,
3859483262u, 1499729584u,
2088002891u, 2883475137u,
3222194252u, 4144472319u,
2212229854u, 4146740722u,
567988835u, 1051332394u,
3932046135u, 542648229u,
3017852446u, 1277887997u,
162888005u, 1669710469u,
1492500905u, 553041029u,
1434876932u, 533989516u,
3817492747u, 584127807u,
4147115982u, 2993670925u,
4020312558u, 710021255u,
3509733475u, 3587959456u,
2088550465u, 1745399498u,
2952242967u, 1259815443u,
869648362u, 1404723176u,
3947542735u, 1334333531u,
3873471582u, 229399758u,
59634866u, 3239516985u,
3844250972u, 1275954779u,
492891666u, 1029533080u,
1552951157u, 367320647u,
699480890u, 3684418197u,
3707014310u, 471105777u,
1824587258u, 4030809053u,
3489914436u, 484559105u,
1235750398u, 1428453396u,
4230459084u, 4255931645u,
1848597055u, 4271715616u,
331780381u, 482425775u,
2435323270u, 3171911678u,
3507210587u, 928543347u,
4197807526u, 3680046204u,
2766042024u, 2159512867u,
179373257u, 313902234u,
4024837592u, 294795361u,
1622282562u, 647086234u,
2825039429u, 577214736u,
4043412446u, 2426981244u,
1277736097u, 1130129573u,
2601395338u, 995791646u,
36668922u, 3344746679u,
1521532225u, 1645086060u,
2622763015u, 4122335794u,
2936887705u, 494465807u,
2580840343u, 1064648931u,
1247887787u, 2752145076u,
1277612417u, 1249660507u,
2288678613u, 3312498873u,
2459273912u, 4238535494u,
3117488020u, 2571979978u,
2680188909u, 1471227427u,
1616494033u, 633688562u,
2268653416u, 3268237290u,
3021962815u, 1959779970u,
3321382074u, 766642813u,
204429780u, 1323319858u,
3676032891u, 1380896111u,
4030639049u, 3647601207u,
1830028502u, 2830263774u,
1375962216u, 1733961041u,
939765180u, 521947915u,
3903267364u, 497472767u,
1619700946u, 189164145u,
3115593885u, 486382294u,
1262445920u, 4062496162u,
2464795849u, 3770038872u,
4032121374u, 3235740744u,
3757765258u, 1777199847u,
2167243108u, 1912506671u,
4180515317u, 2276864677u,
536034089u, 2384915026u,
162938278u, 1588060152u,
4018349945u, 2504457929u,
841450426u, 2790120722u,
2719983588u, 1471020554u,
1390856732u, 3623212998u,
2506944218u, 1035080801u,
348812127u, 3026631806u,
746483541u, 2342164722u,
122104390u, 4074122771u,
3986865419u, 1674890530u,
3693306023u, 3011542850u,
1294951725u, 899303190u,
3577146915u, 3549160092u,
1241677652u, 4290680005u,
3193053279u, 2029187390u,
3298063095u, 3943068002u,
3946220635u, 2273781461u,
889053698u, 1376304022u,
1486839612u, 2127663659u,
344127443u, 1646681121u,
2780117810u, 2142045764u,
2694572773u, 447810651u,
2185527146u, 2366308558u,
290335413u, 584901173u,
2012370276u, 970504950u,
3258236042u, 2008155560u,
3945579565u, 614796295u,
24452072u, 2695940969u,
3983727134u, 3444688454u,
1327044473u, 3545633451u,
1875293322u, 1739318893u,
1707527799u, 2683090634u,
2848082386u, 2814622471u,
4111401777u, 2774816580u,
3849839194u, 437560100u,
2238350150u, 2462124836u,
665017710u, 512012738u,
2945294779u, 3305170944u,
819477765u, 59419271u,
155125658u, 665292744u,
444722813u, 3580039116u,
2355675635u, 663735032u,
3247800169u, 1579404983u,
1985115003u, 3397891494u,
358696453u, 1474896279u,
516388613u, 710590371u,
3490497111u, 2514565805u,
2386143445u, 477509654u,
412854590u, 3624609754u,
3214388668u, 3516075816u,
2731288520u, 1369482895u,
4033204378u, 1314000850u,
829769325u, 1935166880u,
1608191643u, 2607067237u,
423820371u, 3257747610u,
1355298041u, 3776931214u,
4105054901u, 2107080812u,
1911521879u, 3183054185u,
3910177801u, 675129307u,
1209358971u, 4205727791u,
1435726287u, 3333261712u,
1400982708u, 1154611403u,
1663501483u, 2837596667u,
3164734053u, 2759854023u,
4012043629u, 1963228038u,
3981675284u, 2677557877u,
520119591u, 505138315u,
897271356u, 1803966773u,
1016663294u, 616691903u,
2254742522u, 4032705384u,
2468470796u, 798395739u,
3025169002u, 3570037122u,
1461093710u, 3473799845u,
3702624858u, 476400898u,
1043039728u, 2304070437u,
181576948u, 602972493u,
3996616030u, 3289878097u,
2068516226u, 3922247304u,
1299968266u, 2520311409u,
1968824721u, 3214794876u,
1581813122u, 2668800905u,
3297613974u, 748160407u,
1145536484u, 1326769504u,
2973323521u, 3775262814u,
3218653169u, 902775872u,
3498603433u, 1372805534u,
704686363u, 3626542352u,
2271580579u, 1213925114u,
46329775u, 3009384989u,
1330254048u, 1194824134u,
514204310u, 3781981134u,
442526164u, 2835608783u,
3460471867u, 510634034u,
546406434u, 2716786748u,
2840500021u, 1669490957u,
2536189149u, 3251421224u,
1358736072u, 1089334066u,
3260749330u, 250756920u,
2974806681u, 1513718866u,
82635635u, 4041016629u,
3391765744u, 2495807367u,
3962674316u, 2822889695u,
753413337u, 2008251381u,
3123390177u, 106212622u,
490570565u, 1684884205u,
793892547u, 1927268995u,
2344148164u, 2251978818u,
437424236u, 2774023200u,
2674940754u, 3788056262u,
2597882666u, 3678660147u,
3797434193u, 3838215866u,
279687080u, 2656772270u,
2190204787u, 1997584981u,
3384401882u, 3160208845u,
3629379425u, 2668998785u,
1050036757u, 2954162084u,
917091826u, 1744374041u,
1454282570u, 845687881u,
2997173625u, 776018378u,
1137560602u, 1938378389u,
1748082354u, 2066910012u,
2677675207u, 918315064u,
};

// Return false only if offset is -1 and a spot check of 3 hashes all yield 0.
bool Test(int offset, int len = 0) {
#undef Check
#undef IsAlive

#define Check(x) do {                                                   \
  const uint32_t actual = (x), e = expected[index++];                   \
  bool ok = actual == e;                                                \
  if (!ok) {                                                            \
    cerr << "expected " << hex << e << " but got " << actual << endl;   \
    ++errors;                                                           \
  }                                                                     \
  assert(ok);                                                           \
} while (0)

#define IsAlive(x) do { alive += IsNonZero(x); } while (0)

  // After the following line is where the uses of "Check" and such will go.
  static int index = 0;
if (offset == -1) { int alive = 0; { uint64_t h = farmhashte::Hash64WithSeeds(data, len++, SEED0, SEED1); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } { uint64_t h = farmhashte::Hash64WithSeed(data, len++, SEED); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } { uint64_t h = farmhashte::Hash64(data, len++); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } len -= 3; return alive > 0; }
{ uint64_t h = farmhashte::Hash64WithSeeds(data + offset, len, SEED0, SEED1); Check(h >> 32); Check((h << 32) >> 32); }
{ uint64_t h = farmhashte::Hash64WithSeed(data + offset, len, SEED); Check(h >> 32); Check((h << 32) >> 32); }
{ uint64_t h = farmhashte::Hash64(data + offset, len); Check(h >> 32); Check((h << 32) >> 32); }

  return true;
#undef Check
#undef IsAlive
}

int RunTest() {
  Setup();
  int i = 0;
  cout << "Running farmhashteTest";
  if (!Test(-1)) {
    cout << "... Unavailable\n";
    return NoteErrors();
  }
  // Good.  The function is attempting to hash, so run the full test.
  int errors_prior_to_test = errors;
  for ( ; i < kTestSize - 1; i++) {
    Test(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    Test(0, i);
  }
  Test(0, kDataSize);
  cout << (errors == errors_prior_to_test ? "... OK\n" : "... Failed\n");
  return NoteErrors();
}

#else

// After the following line is where the code to print hash codes will go.
void Dump(int offset, int len) {
{ uint64_t h = farmhashte::Hash64WithSeeds(data + offset, len, SEED0, SEED1); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
{ uint64_t h = farmhashte::Hash64WithSeed(data + offset, len, SEED); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
{ uint64_t h = farmhashte::Hash64(data + offset, len); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
}

#endif

#undef SEED
#undef SEED1
#undef SEED0

}  // namespace farmhashteTest

#if !TESTING
int main(int argc, char** argv) {
  Setup();
  cout << "uint32_t expected[] = {\n";
  int i = 0;
  for ( ; i < kTestSize - 1; i++) {
    farmhashteTest::Dump(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    farmhashteTest::Dump(0, i);
  }
  farmhashteTest::Dump(0, kDataSize);
  cout << "};\n";
}
#endif
#ifndef FARMHASH_SELF_TEST_GUARD
#define FARMHASH_SELF_TEST_GUARD
#include <cstdio>
#include <iostream>
#include <string.h>

using std::cout;
using std::cerr;
using std::endl;
using std::hex;

static const uint64_t kSeed0 = 1234567;
static const uint64_t kSeed1 = k0;
static const int kDataSize = 1 << 20;
static const int kTestSize = 300;
#define kSeed128 Uint128(kSeed0, kSeed1)

static char data[kDataSize];

static int completed_self_tests = 0;
static int errors = 0;

// Initialize data to pseudorandom values.
void Setup() {
  if (completed_self_tests == 0) {
    uint64_t a = 9;
    uint64_t b = 777;
    for (int i = 0; i < kDataSize; i++) {
      a += b;
      b += a;
      a = (a ^ (a >> 41)) * k0;
      b = (b ^ (b >> 41)) * k0 + i;
      uint8_t u = b >> 37;
      memcpy(data + i, &u, 1);  // uint8_t -> char
    }
  }
}

int NoteErrors() {
#define NUM_SELF_TESTS 9
  if (++completed_self_tests == NUM_SELF_TESTS)
    std::exit(errors > 0);
  return errors;
}

template <typename T> inline bool IsNonZero(T x) {
  return x != 0;
}

template <> inline bool IsNonZero<uint128_t>(uint128_t x) {
  return x != Uint128(0, 0);
}

#endif  // FARMHASH_SELF_TEST_GUARD

namespace farmhashuoTest {

uint32_t CreateSeed(int offset, int salt) {
  uint32_t h = static_cast<uint32_t>(salt & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h += static_cast<uint32_t>(offset & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  return h;
}

#undef SEED
#undef SEED1
#undef SEED0
#define SEED CreateSeed(offset, -1)
#define SEED0 CreateSeed(offset, 0)
#define SEED1 CreateSeed(offset, 1)

#undef TESTING
#define TESTING 1
#if TESTING
uint32_t expected[] = {
3277735313u, 2681724312u,
2598464059u, 797982799u,
2603993599u, 921001710u,
1410420968u, 2134990486u,
2914424215u, 2244477846u,
255297188u, 2992121793u,
161451183u, 3943596029u,
4019337850u, 452431531u,
3379021470u, 2557197665u,
299850021u, 2532580744u,
1298374911u, 3099673830u,
2199864459u, 3696623795u,
4055299123u, 3281581178u,
1053458494u, 1882212500u,
3456121707u, 275903667u,
458884671u, 3033004529u,
1898235244u, 1402319660u,
2700149065u, 2699376854u,
2433714046u, 4222949502u,
4220361840u, 1712034059u,
4148372108u, 1330324210u,
594028478u, 2921867846u,
780716741u, 1728752234u,
3280331829u, 326029180u,
393215742u, 3349570000u,
3824583307u, 1612122221u,
1379537552u, 1646032583u,
2233466664u, 1432476832u,
2052294713u, 3552092450u,
1628777059u, 1499109081u,
2960536756u, 1554038301u,
1145519619u, 3190844552u,
237495366u, 540224401u,
65721842u, 489963606u,
1596489240u, 1562872448u,
1790705123u, 2128624475u,
1435705557u, 1262831810u,
155445229u, 1672724608u,
663607706u, 2077310004u,
3610042449u, 1911523866u,
2563776023u, 294527927u,
1099072299u, 1389770549u,
2952353448u, 2026137563u,
3603803785u, 629449419u,
226132789u, 2489287368u,
1552847036u, 645684964u,
187883449u, 230403464u,
3151491850u, 3272648435u,
2002861219u, 165370827u,
916494250u, 1230085527u,
3807265751u, 3628174014u,
231181488u, 851743255u,
2988893883u, 1554380634u,
1142264800u, 3667013118u,
2638023604u, 2290487377u,
732137533u, 1909203251u,
1380301172u, 1498556724u,
4072067757u, 4165088768u,
3931792696u, 197618179u,
956300927u, 914413116u,
2148126371u, 1913303225u,
3074915312u, 3117299654u,
3178848746u, 1357272220u,
1438494951u, 507436733u,
3854939912u, 1413396341u,
126024219u, 146044391u,
3254014218u, 429095991u,
165589978u, 1578546616u,
623071693u, 366414107u,
249776086u, 1207522198u,
3120876698u, 1684583131u,
46987739u, 1157614300u,
199124911u, 520792961u,
3614377032u, 586863115u,
1716848157u, 4033596884u,
1164298657u, 4140791139u,
3824360466u, 3242407770u,
3725511003u, 232064808u,
2736953692u, 816692935u,
512845449u, 3748861010u,
4290630595u, 517646945u,
22638523u, 648000590u,
1283799121u, 3047062993u,
1024246061u, 4027776454u,
834785312u, 382936554u,
411505255u, 1973395102u,
580988377u, 2826990641u,
3474970689u, 1029055034u,
2584372201u, 1758123094u,
589567754u, 325737734u,
3886113119u, 3338548567u,
257578986u, 3698087965u,
3604937815u, 3198590202u,
2305332220u, 191910725u,
4244322689u, 542201663u,
3315355162u, 2135941665u,
1175961330u, 3948351189u,
23075771u, 3252374102u,
713127376u, 1467786451u,
663013031u, 3444053918u,
3077742128u, 1062268187u,
2115441882u, 4081398201u,
2335576331u, 2560479831u,
1379288194u, 4225182569u,
3958366652u, 3067277639u,
3667516477u, 1709989541u,
4188504038u, 59581167u,
2725013602u, 3639843023u,
3758739543u, 4189944477u,
2470483982u, 877580602u,
3252925478u, 2062343506u,
3981838403u, 3762572073u,
2931588131u, 3284356565u,
1129162571u, 732225574u,
1677744031u, 3532596884u,
3232041815u, 1652884780u,
3740979556u, 259034107u,
2227121257u, 1426140634u,
315836068u, 3200749877u,
1386256573u, 24035717u,
234531934u, 1115203611u,
1598686658u, 3146815575u,
2632963283u, 1778459926u,
739944537u, 579625482u,
1231665285u, 2457048126u,
3903349120u, 389846205u,
1052645068u, 862072556u,
2834153464u, 1481069623u,
1688445808u, 701920051u,
3740748788u, 3388062747u,
1192588249u, 1410111809u,
2633463887u, 4050419847u,
2513844237u, 2187968410u,
2951683019u, 3015806005u,
3000537321u, 479241367u,
252167538u, 1231057113u,
393624922u, 704325635u,
1467197045u, 2066433573u,
3082385053u, 735688735u,
956434529u, 4028590195u,
4074716319u, 813690332u,
2124740535u, 804073145u,
3748881891u, 3195309868u,
841856605u, 2585865274u,
881504822u, 3254795114u,
1241815736u, 970796142u,
497175391u, 3929484338u,
4264993211u, 1835322201u,
3675707838u, 4205965408u,
300298607u, 3858319990u,
3255259608u, 4247675634u,
1095823272u, 1197245408u,
1742785722u, 785893184u,
1702965674u, 850401405u,
4084891412u, 1160134629u,
2555998391u, 1972759056u,
710625654u, 4116162021u,
3352753742u, 85121177u,
3513255468u, 2487440590u,
2480032715u, 2287747045u,
4090178629u, 4044418876u,
1703944517u, 486290428u,
1515601363u, 2011102035u,
573985957u, 3536053779u,
4257172787u, 576405853u,
1523550693u, 1014952061u,
711098718u, 2425317635u,
3460807169u, 3688987163u,
3167371443u, 3062418115u,
3330028292u, 1713171303u,
526177822u, 2602636307u,
1245357025u, 3346699703u,
254529415u, 4017058800u,
1829738451u, 2164236533u,
1381258384u, 4036354071u,
1749181924u, 4118435443u,
4130543625u, 688472265u,
2731071299u, 2547657502u,
4175776103u, 338058159u,
3729582129u, 4181845558u,
2227290760u, 146827036u,
2459178427u, 1025353883u,
4284109679u, 2502815838u,
825124804u, 2533140036u,
616327404u, 2448966429u,
413992636u, 2334782461u,
2239052397u, 1082330589u,
3381164715u, 199381437u,
2583939798u, 2848283092u,
2300168091u, 2156336315u,
1855234968u, 1982110346u,
2482046810u, 3158163887u,
2168864636u, 133643215u,
3904021624u, 3646514568u,
1176127003u, 4015671361u,
100525019u, 3534706803u,
2045051700u, 3452457457u,
1492267772u, 2308393828u,
3776661467u, 3281002516u,
4246334524u, 743955039u,
685631442u, 1147951686u,
2040912376u, 2911148054u,
3204999386u, 2415262714u,
313209105u, 777065474u,
2729416454u, 1029284767u,
1632078298u, 1817552554u,
3963877000u, 1919171906u,
3843219958u, 3073580867u,
865146997u, 2473524405u,
2593817617u, 3643076308u,
617975720u, 3671562289u,
121812599u, 2902367378u,
2260041112u, 1019936943u,
320945955u, 2337845588u,
1535670711u, 773792826u,
3152195900u, 4090794518u,
4142587430u, 484732447u,
419191319u, 3377973345u,
324924679u, 2809286837u,
1562277603u, 1378362199u,
3791551981u, 1097806406u,
1386297408u, 2304900033u,
3574135531u, 4017075736u,
1161238398u, 1358056883u,
3487080616u, 1516736273u,
851615042u, 2927899494u,
4077452507u, 2984955003u,
3907754394u, 3578173844u,
1948409509u, 1923531348u,
3578472493u, 3710074193u,
213811117u, 2586632018u,
1922589216u, 274958014u,
1654276320u, 2687561076u,
2569061755u, 3122046057u,
3203802620u, 1692079268u,
477806878u, 140587742u,
520565830u, 3674576684u,
91246882u, 1010215946u,
3703994407u, 69201295u,
776213083u, 3677771507u,
3696902571u, 3593730713u,
2907901228u, 3239753796u,
1586241476u, 1939595371u,
2268396558u, 3468719670u,
2955715987u, 2295501078u,
2775848696u, 1358532390u,
3843660102u, 82177963u,
4094477877u, 191727221u,
278661677u, 2889101923u,
1352525614u, 2844977667u,
1261140657u, 1747052377u,
2334120653u, 645125282u,
2707230761u, 4142246789u,
1068639717u, 2288162940u,
1419293714u, 1636932722u,
3252686293u, 318543902u,
2598802768u, 2025886508u,
2250788464u, 2711763065u,
255108733u, 1845587644u,
3719270134u, 3940707863u,
917608574u, 1363253259u,
788659330u, 673256220u,
109793386u, 341851980u,
2698465479u, 3011229884u,
3886713057u, 1276595523u,
2439962760u, 2700515456u,
205970448u, 4198897105u,
875511891u, 371715572u,
1033680610u, 4278599955u,
3120038721u, 1256300069u,
225629455u, 3735275001u,
3961944123u, 1769389163u,
1074553219u, 668829411u,
1098679359u, 2573697509u,
1885071395u, 4233785523u,
2513878053u, 2030193788u,
360256231u, 107312677u,
310517502u, 2618936366u,
3600462351u, 1216645846u,
2970730323u, 4278812598u,
94638678u, 1689811113u,
4125738800u, 3103759730u,
103797041u, 1397772514u,
1669653333u, 572567964u,
1612872497u, 2986430557u,
214990655u, 3117607990u,
1949717207u, 2260498180u,
1493936866u, 3554860960u,
1582022990u, 1263709570u,
1244120487u, 3416600761u,
224580012u, 4252610345u,
286306391u, 814956796u,
1820532305u, 2776960536u,
3082703465u, 1659265982u,
1157398049u, 3752806924u,
3508246460u, 2902716664u,
2110942730u, 3267551635u,
902835431u, 405228165u,
2341378668u, 2220373824u,
3303626294u, 1175118221u,
383517064u, 896322512u,
1697257567u, 2202820683u,
1837689083u, 1336556841u,
914535232u, 3634083711u,
1537187340u, 3712582785u,
1088201893u, 3270984620u,
3093195926u, 2561488770u,
1962968100u, 236189500u,
2549435227u, 536047554u,
422609195u, 2958815818u,
4166184983u, 3528794619u,
1042329086u, 3914176886u,
1359641525u, 1197100813u,
1269739674u, 3301844628u,
1831223342u, 3329594980u,
2433669782u, 494908536u,
1441714797u, 1174785921u,
1933050423u, 958901065u,
868981704u, 2163330264u,
3243110680u, 1443133429u,
1145009669u, 2520062970u,
3851564853u, 2664619323u,
2686075657u, 4042710240u,
2125408249u, 4165697916u,
2328730865u, 3160666939u,
588683409u, 2126275847u,
829404209u, 1878067032u,
2567792910u, 897670516u,
934312076u, 2952135524u,
504832490u, 3312698056u,
4015478120u, 1265237690u,
3376133707u, 967674402u,
1553513184u, 834830418u,
2396504772u, 3278582098u,
2950762705u, 4277111759u,
4159211303u, 1290097509u,
251949572u, 3065234219u,
1832020534u, 312136369u,
1103404394u, 198182691u,
1369599600u, 3906710870u,
2954651680u, 1535115487u,
2389327507u, 1813520230u,
632704095u, 140762681u,
3123202913u, 3336005523u,
1287729497u, 2198985327u,
2470730783u, 3821758006u,
1009870118u, 559702706u,
4274686257u, 3187546567u,
2402308151u, 1096697687u,
678932329u, 3716363135u,
2899950405u, 3046872820u,
3754655641u, 2021741414u,
1993425202u, 2185339100u,
2838253700u, 3099212100u,
1679617763u, 3703603898u,
1135665833u, 3559875668u,
2503579743u, 1446869792u,
879818611u, 3788305533u,
2879018745u, 2719373510u,
3606051203u, 2166567748u,
343595772u, 1996164093u,
1577656121u, 475248376u,
463852893u, 2864244470u,
1332049663u, 3326459767u,
3207234525u, 2028708916u,
938916154u, 3115246264u,
3272166407u, 557660441u,
1265684026u, 245033807u,
2440657523u, 255451671u,
3811885130u, 1399880284u,
1322855877u, 3452203069u,
1324994449u, 3796404024u,
2002090272u, 1568745354u,
3700047753u, 31799506u,
3009412313u, 3184047862u,
728680761u, 3848624873u,
1849329144u, 3160134214u,
1272923193u, 1474278816u,
1208883495u, 1566527339u,
4136466541u, 630825649u,
1717327230u, 1496132623u,
2449386742u, 128106940u,
2108574735u, 2584236470u,
2872246579u, 397338552u,
3088905079u, 3456882941u,
1715915153u, 2940716269u,
4168438718u, 467441309u,
872996731u, 3206901319u,
1610606159u, 2540270567u,
1301658081u, 2379410194u,
2109315753u, 3348545480u,
2041927873u, 2644077493u,
546596661u, 1017047954u,
2596792972u, 2783958892u,
2826408201u, 3531646869u,
2219352672u, 4217451852u,
1806867885u, 1903578924u,
2076465705u, 2373061493u,
1832925325u, 241574049u,
1509517110u, 3703614272u,
3429894862u, 3529565564u,
4010000614u, 2256197939u,
517086873u, 2964595704u,
3501035294u, 4079457298u,
1184683823u, 4260564140u,
2339268412u, 3871564102u,
1572637805u, 383233885u,
3351411126u, 3419328182u,
2017406667u, 919677938u,
29804156u, 46276077u,
3032591014u, 4204155962u,
1172319502u, 969309871u,
2211319468u, 4153726847u,
3094193193u, 4240669441u,
3441709766u, 1387233546u,
4048882438u, 1217896566u,
1580964938u, 740563169u,
3691850348u, 3176426539u,
2738323042u, 2948665536u,
1474029445u, 3513354882u,
3219466255u, 3799363969u,
3961796122u, 1055550923u,
1992212097u, 2263421398u,
4289759174u, 2516844140u,
1782515131u, 2746577402u,
721928440u, 3529570984u,
1705302106u, 768287270u,
3474902815u, 4000011125u,
3475618043u, 212490675u,
549130471u, 2970128275u,
3170016833u, 2549835613u,
3691104824u, 2694324482u,
4169365948u, 3738062408u,
602930397u, 2148954730u,
2636387819u, 2616619070u,
301617872u, 374657036u,
3862686086u, 431292293u,
4225245165u, 1358580562u,
2377363130u, 1415970351u,
3885060756u, 1438379807u,
2297418515u, 2954777083u,
3970368221u, 1229801760u,
1931934525u, 2287507921u,
1713471510u, 2145608111u,
2650140034u, 4081586725u,
4196863572u, 1896558394u,
4059852729u, 1813855658u,
2618400836u, 1396056469u,
2375584220u, 1037031473u,
249284003u, 2450077637u,
1383747654u, 3122687303u,
2664431743u, 3855028730u,
929335420u, 3193251135u,
137313762u, 1850894384u,
3163711272u, 3071568023u,
418541677u, 3621223039u,
340274176u, 1167681812u,
4106647531u, 4022465625u,
3069708839u, 2704165015u,
2332023349u, 641449034u,
921552000u, 1712976649u,
1876484273u, 2343049860u,
1834682077u, 4155949943u,
2061821157u, 4240649383u,
747285578u, 1626463554u,
165503115u, 359629739u,
3838102563u, 582664250u,
3878924635u, 4117237498u,
2250573853u, 804336148u,
331393443u, 4242530387u,
3346357270u, 1674051445u,
3348019777u, 1722242971u,
2509017299u, 2966108111u,
4189102509u, 3323592310u,
2631381069u, 4014551783u,
4250787412u, 3448394212u,
2664752123u, 3517585534u,
3605365141u, 1669471183u,
2210121140u, 760762191u,
249697459u, 3416920106u,
16322182u, 643179562u,
1564226597u, 2134630675u,
1011990087u, 2990167340u,
2349550842u, 1642428946u,
1214854475u, 2134299399u,
2704221532u, 2104175211u,
4283196353u, 1342880802u,
198529755u, 2004468390u,
2544665755u, 853593042u,
2090611294u, 2970943872u,
1472073141u, 850464484u,
1407609278u, 3062461105u,
366448238u, 3842907484u,
488797416u, 1432670231u,
294963924u, 3693536939u,
3390549825u, 1583234720u,
4032223840u, 2318423400u,
2965642867u, 930822729u,
1679099863u, 1728968857u,
900822335u, 702309817u,
3258354115u, 1502282913u,
2811888503u, 3924947660u,
2477280726u, 3651607391u,
3788310204u, 1300369123u,
1842333726u, 4146839064u,
2468893861u, 4091095953u,
488595746u, 1448097974u,
1159634090u, 1738834113u,
2928916831u, 4093725287u,
530850094u, 291657799u,
3548184546u, 679517009u,
399175380u, 2658337143u,
3827951761u, 3086277222u,
2067718397u, 3632376023u,
3553313841u, 119173722u,
1702434637u, 1766260771u,
895654784u, 751439914u,
4008409498u, 215917713u,
1288382231u, 2656990891u,
2581779077u, 1570750352u,
2666411616u, 3533987737u,
4289478316u, 3576119563u,
3869794273u, 963183826u,
2081410737u, 3796810515u,
1036883117u, 136547246u,
875691100u, 2592925324u,
2689342539u, 427154472u,
532957601u, 1228758574u,
1908591042u, 1464255968u,
446980910u, 2984611177u,
3508927906u, 2001585786u,
2544767379u, 1525438381u,
879448844u, 1348536411u,
4242243590u, 2861338018u,
601175800u, 764077711u,
530635011u, 3785343245u,
2378297261u, 457568934u,
76438221u, 4104954272u,
2485968477u, 2381948487u,
4226929450u, 3148473363u,
879369091u, 2180270337u,
3674375989u, 1387729170u,
568650985u, 951677556u,
4213877384u, 2721005055u,
1678669911u, 66786703u,
2273631661u, 1149351924u,
246723096u, 1895026827u,
3810605772u, 3711056516u,
2080120290u, 3638638708u,
2915672708u, 2263003308u,
1976115991u, 3448840877u,
2019238520u, 225333538u,
1555273378u, 3797521928u,
1942347150u, 3262952567u,
2817830907u, 2078619498u,
749534111u, 1178073973u,
841092198u, 3288261538u,
1696412169u, 1496966875u,
3739946319u, 2481012988u,
568983526u, 114945840u,
2841706923u, 1632780103u,
4020169654u, 2087949619u,
833416317u, 3787017905u,
2373238993u, 2575395164u,
2542976862u, 2971726178u,
2880371864u, 3642087909u,
1043714217u, 3894199764u,
2235879182u, 203853421u,
834683330u, 425935223u,
3560796393u, 3565833278u,
3414330886u, 1748785729u,
1023171602u, 580966986u,
2657385925u, 2124704694u,
233442446u, 1107045577u,
3899097693u, 1067532701u,
115667924u, 1406028344u,
2419657149u, 18613994u,
2532882091u, 3476683808u,
895961699u, 3762914298u,
1328752423u, 1844996900u,
1210281744u, 904215228u,
4055325594u, 1118521573u,
3996647489u, 3657647605u,
325254059u, 3136157065u,
3341068436u, 2287683323u,
1313073005u, 126005630u,
853746559u, 3555092974u,
2689238752u, 49515858u,
61073168u, 1010661841u,
1269521335u, 1902040126u,
3858321250u, 1400735275u,
2974699176u, 2771676666u,
545726212u, 2225229957u,
1086473152u, 3454177594u,
2088002891u, 2883475137u,
3222194252u, 4144472319u,
567988835u, 1051332394u,
3932046135u, 542648229u,
162888005u, 1669710469u,
1492500905u, 553041029u,
3817492747u, 584127807u,
4147115982u, 2993670925u,
3509733475u, 3587959456u,
2088550465u, 1745399498u,
869648362u, 1404723176u,
3947542735u, 1334333531u,
59634866u, 3239516985u,
3844250972u, 1275954779u,
2512155003u, 1685649437u,
639306006u, 2524620206u,
576786501u, 655707039u,
2864351838u, 3736264674u,
1200907897u, 2384379464u,
15823708u, 206117476u,
1193310960u, 1093099415u,
3696538026u, 4112584792u,
2069527017u, 547588820u,
4178147211u, 2827259351u,
940846775u, 1054995047u,
2976960697u, 1934305529u,
2199137382u, 1005722394u,
1875867180u, 2064356511u,
4019734130u, 3096333006u,
2069509024u, 2906358341u,
2232866485u, 1456016086u,
1422674894u, 867282151u,
1612503136u, 1739843072u,
134947567u, 2978775774u,
1284167756u, 1090844589u,
831688783u, 2079216362u,
1626991196u, 3644714163u,
3678110059u, 898470030u,
3916646913u, 3182422972u,
3630426828u, 969847973u,
3427164640u, 3463937250u,
3044785046u, 897322257u,
3443872170u, 4185408854u,
2557463241u, 4080940424u,
2048168570u, 2429169982u,
3174690447u, 2513494106u,
1213061732u, 3143736628u,
3482268149u, 1250714337u,
31648125u, 3872383625u,
1565760579u, 36665130u,
751041229u, 2257179590u,
2915361862u, 280819225u,
2907818413u, 4254297769u,
3493178615u, 3755944354u,
4043533423u, 1134196225u,
4177134659u, 127246419u,
2442615581u, 923049607u,
1004426206u, 782768297u,
2410586681u, 1430106871u,
4103323427u, 3168399477u,
3716682375u, 3616334719u,
3413209549u, 656672786u,
2876965944u, 182894450u,
456581318u, 2683752067u,
3877875910u, 3190666241u,
3240336907u, 4024807233u,
1681224377u, 1576191191u,
3599250276u, 2381111980u,
3495321877u, 3956024585u,
1611608524u, 3815677453u,
2062334396u, 1656117707u,
5457134u, 3234118251u,
470187419u, 2688566989u,
3259870297u, 660100446u,
442236198u, 2542452448u,
493137955u, 392411099u,
947967568u, 1234595917u,
4230082284u, 2762976773u,
2870085764u, 1455086530u,
2762099647u, 4011882747u,
1215981925u, 3227517889u,
3269061963u, 4037515364u,
3168911474u, 4255057396u,
2026092260u, 1736192508u,
3909727042u, 3114708966u,
1938800693u, 680793595u,
1525265867u, 2808224480u,
2122290603u, 1211197714u,
3520488321u, 3979192396u,
3540779343u, 4192918639u,
2736030448u, 1120335563u,
1698949078u, 3993310631u,
1966048551u, 2228221363u,
597941119u, 3498018399u,
393987327u, 454500547u,
1222959566u, 567151340u,
3774764786u, 1492844524u,
3308300614u, 805568076u,
868414882u, 177406999u,
1608110313u, 642061169u,
1027515771u, 3131251981u,
2851936150u, 4272755262u,
1532845092u, 709643652u,
682573592u, 1244104217u,
796769556u, 2500467040u,
3002618826u, 1112998535u,
1780193104u, 1243644607u,
3691719535u, 2958853053u,
466635014u, 2277292580u,
4082276003u, 1030800045u,
1750863246u, 379050598u,
3576413281u, 731493104u,
132259176u, 4115195437u,
1769890695u, 2715470335u,
1819263183u, 2028531518u,
2154809766u, 3672399742u,
76727603u, 4198182186u,
2304993586u, 1666387627u,
284366017u, 3359785538u,
3469807328u, 2926494787u,
3829072836u, 2493478921u,
3738499303u, 3311304980u,
932916545u, 2235559063u,
2909742396u, 1765719309u,
1456588655u, 508290328u,
1490719640u, 3356513470u,
2908490783u, 251085588u,
830410677u, 3172220325u,
3897208579u, 1940535730u,
151909546u, 2384458112u,
};

// Return false only if offset is -1 and a spot check of 3 hashes all yield 0.
bool Test(int offset, int len = 0) {
#undef Check
#undef IsAlive

#define Check(x) do {                                                   \
  const uint32_t actual = (x), e = expected[index++];                   \
  bool ok = actual == e;                                                \
  if (!ok) {                                                            \
    cerr << "expected " << hex << e << " but got " << actual << endl;   \
    ++errors;                                                           \
  }                                                                     \
  assert(ok);                                                           \
} while (0)

#define IsAlive(x) do { alive += IsNonZero(x); } while (0)

  // After the following line is where the uses of "Check" and such will go.
  static int index = 0;
if (offset == -1) { int alive = 0; { uint64_t h = farmhashuo::Hash64WithSeed(data, len++, SEED); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } { uint64_t h = farmhashuo::Hash64(data, len++); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } { uint64_t h = farmhashuo::Hash64(data, len++); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } len -= 3; return alive > 0; }
{ uint64_t h = farmhashuo::Hash64WithSeed(data + offset, len, SEED); Check(h >> 32); Check((h << 32) >> 32); }
{ uint64_t h = farmhashuo::Hash64(data + offset, len); Check(h >> 32); Check((h << 32) >> 32); }

  return true;
#undef Check
#undef IsAlive
}

int RunTest() {
  Setup();
  int i = 0;
  cout << "Running farmhashuoTest";
  if (!Test(-1)) {
    cout << "... Unavailable\n";
    return NoteErrors();
  }
  // Good.  The function is attempting to hash, so run the full test.
  int errors_prior_to_test = errors;
  for ( ; i < kTestSize - 1; i++) {
    Test(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    Test(0, i);
  }
  Test(0, kDataSize);
  cout << (errors == errors_prior_to_test ? "... OK\n" : "... Failed\n");
  return NoteErrors();
}

#else

// After the following line is where the code to print hash codes will go.
void Dump(int offset, int len) {
{ uint64_t h = farmhashuo::Hash64WithSeed(data + offset, len, SEED); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
{ uint64_t h = farmhashuo::Hash64(data + offset, len); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
}

#endif

#undef SEED
#undef SEED1
#undef SEED0

}  // namespace farmhashuoTest

#if !TESTING
int main(int argc, char** argv) {
  Setup();
  cout << "uint32_t expected[] = {\n";
  int i = 0;
  for ( ; i < kTestSize - 1; i++) {
    farmhashuoTest::Dump(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    farmhashuoTest::Dump(0, i);
  }
  farmhashuoTest::Dump(0, kDataSize);
  cout << "};\n";
}
#endif
#ifndef FARMHASH_SELF_TEST_GUARD
#define FARMHASH_SELF_TEST_GUARD
#include <cstdio>
#include <iostream>
#include <string.h>

using std::cout;
using std::cerr;
using std::endl;
using std::hex;

static const uint64_t kSeed0 = 1234567;
static const uint64_t kSeed1 = k0;
static const int kDataSize = 1 << 20;
static const int kTestSize = 300;
#define kSeed128 Uint128(kSeed0, kSeed1)

static char data[kDataSize];

static int completed_self_tests = 0;
static int errors = 0;

// Initialize data to pseudorandom values.
void Setup() {
  if (completed_self_tests == 0) {
    uint64_t a = 9;
    uint64_t b = 777;
    for (int i = 0; i < kDataSize; i++) {
      a += b;
      b += a;
      a = (a ^ (a >> 41)) * k0;
      b = (b ^ (b >> 41)) * k0 + i;
      uint8_t u = b >> 37;
      memcpy(data + i, &u, 1);  // uint8_t -> char
    }
  }
}

int NoteErrors() {
#define NUM_SELF_TESTS 9
  if (++completed_self_tests == NUM_SELF_TESTS)
    std::exit(errors > 0);
  return errors;
}

template <typename T> inline bool IsNonZero(T x) {
  return x != 0;
}

template <> inline bool IsNonZero<uint128_t>(uint128_t x) {
  return x != Uint128(0, 0);
}

#endif  // FARMHASH_SELF_TEST_GUARD

namespace farmhashxoTest {

uint32_t CreateSeed(int offset, int salt) {
  uint32_t h = static_cast<uint32_t>(salt & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h += static_cast<uint32_t>(offset & 0xffffffff);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  h = h * c1;
  h ^= (h >> 17);
  return h;
}

#undef SEED
#undef SEED1
#undef SEED0
#define SEED CreateSeed(offset, -1)
#define SEED0 CreateSeed(offset, 0)
#define SEED1 CreateSeed(offset, 1)

#undef TESTING
#define TESTING 1
#if TESTING
uint32_t expected[] = {
1140953930u, 861465670u,
3277735313u, 2681724312u,
2598464059u, 797982799u,
890626835u, 800175912u,
2603993599u, 921001710u,
1410420968u, 2134990486u,
3283896453u, 1867689945u,
2914424215u, 2244477846u,
255297188u, 2992121793u,
1110588164u, 4186314283u,
161451183u, 3943596029u,
4019337850u, 452431531u,
283198166u, 2741341286u,
3379021470u, 2557197665u,
299850021u, 2532580744u,
452473466u, 1706958772u,
1298374911u, 3099673830u,
2199864459u, 3696623795u,
236935126u, 2976578695u,
4055299123u, 3281581178u,
1053458494u, 1882212500u,
2305012065u, 2169731866u,
3456121707u, 275903667u,
458884671u, 3033004529u,
3058973506u, 2379411653u,
1898235244u, 1402319660u,
2700149065u, 2699376854u,
147814787u, 720739346u,
2433714046u, 4222949502u,
4220361840u, 1712034059u,
3425469811u, 3690733394u,
4148372108u, 1330324210u,
594028478u, 2921867846u,
1635026870u, 192883107u,
780716741u, 1728752234u,
3280331829u, 326029180u,
3969463346u, 1436364519u,
393215742u, 3349570000u,
3824583307u, 1612122221u,
2859809759u, 3808705738u,
1379537552u, 1646032583u,
2233466664u, 1432476832u,
4023053163u, 2650381482u,
2052294713u, 3552092450u,
1628777059u, 1499109081u,
3476440786u, 3829307897u,
2960536756u, 1554038301u,
1145519619u, 3190844552u,
2902102606u, 3600725550u,
237495366u, 540224401u,
65721842u, 489963606u,
1448662590u, 397635823u,
1596489240u, 1562872448u,
1790705123u, 2128624475u,
180854224u, 2604346966u,
1435705557u, 1262831810u,
155445229u, 1672724608u,
1669465176u, 1341975128u,
663607706u, 2077310004u,
3610042449u, 1911523866u,
1043692997u, 1454396064u,
2563776023u, 294527927u,
1099072299u, 1389770549u,
703505868u, 678706990u,
2952353448u, 2026137563u,
3603803785u, 629449419u,
1933894405u, 3043213226u,
226132789u, 2489287368u,
1552847036u, 645684964u,
3828089804u, 3632594520u,
187883449u, 230403464u,
3151491850u, 3272648435u,
3729087873u, 1303930448u,
2002861219u, 165370827u,
916494250u, 1230085527u,
3103338579u, 3064290191u,
3807265751u, 3628174014u,
231181488u, 851743255u,
2295806711u, 1781190011u,
2988893883u, 1554380634u,
1142264800u, 3667013118u,
1968445277u, 315203929u,
2638023604u, 2290487377u,
732137533u, 1909203251u,
440398219u, 1891630171u,
1380301172u, 1498556724u,
4072067757u, 4165088768u,
4204318635u, 441430649u,
3931792696u, 197618179u,
956300927u, 914413116u,
3010839769u, 2837339569u,
2148126371u, 1913303225u,
3074915312u, 3117299654u,
4139181436u, 2993479124u,
3178848746u, 1357272220u,
1438494951u, 507436733u,
667183474u, 2084369203u,
3854939912u, 1413396341u,
126024219u, 146044391u,
1016656857u, 3022024459u,
3254014218u, 429095991u,
990500595u, 3056862311u,
985653208u, 1718653828u,
623071693u, 366414107u,
1771289760u, 2293458109u,
3047342438u, 2991127487u,
3120876698u, 1684583131u,
3638043310u, 1170404994u,
863214540u, 1087193030u,
199124911u, 520792961u,
3169775996u, 1577421232u,
3331828431u, 1013201099u,
1716848157u, 4033596884u,
1770708857u, 4229339322u,
1146169032u, 1434258493u,
3824360466u, 3242407770u,
1926419493u, 2649785113u,
872586426u, 762243036u,
2736953692u, 816692935u,
1571283333u, 3555213933u,
2266795890u, 3781899767u,
4290630595u, 517646945u,
3006163611u, 2180594090u,
959214578u, 558910384u,
1283799121u, 3047062993u,
3830962609u, 2391606125u,
3544509313u, 622325861u,
834785312u, 382936554u,
1421463872u, 788479970u,
1825135056u, 2725923798u,
580988377u, 2826990641u,
247825043u, 3167748333u,
812546227u, 2506885666u,
2584372201u, 1758123094u,
1891789696u, 389974094u,
345313518u, 2022370576u,
3886113119u, 3338548567u,
1083486947u, 2583576230u,
1776047957u, 1771384107u,
3604937815u, 3198590202u,
3027522813u, 4155628142u,
4232136669u, 427759438u,
4244322689u, 542201663u,
1549591985u, 2856634168u,
556609672u, 45845311u,
1175961330u, 3948351189u,
4165739882u, 4194218315u,
1634635545u, 4151937410u,
713127376u, 1467786451u,
1327394015u, 2743592929u,
2638154051u, 810082938u,
3077742128u, 1062268187u,
4084325664u, 3810665822u,
3735739145u, 2794294783u,
2335576331u, 2560479831u,
690240711u, 997658837u,
2442302747u, 3948961926u,
3958366652u, 3067277639u,
2059157774u, 1211737169u,
1516711748u, 2339636583u,
4188504038u, 59581167u,
2767897792u, 1389679610u,
2658147000u, 2643979752u,
3758739543u, 4189944477u,
1454470782u, 100876854u,
2995362413u, 118817200u,
3252925478u, 2062343506u,
2804483644u, 3088828656u,
1231633714u, 4168280671u,
2931588131u, 3284356565u,
1255909792u, 3130054947u,
4173605289u, 1407328702u,
1677744031u, 3532596884u,
3162657845u, 3887208531u,
2256541290u, 3459463480u,
3740979556u, 259034107u,
392987633u, 3233195759u,
3606709555u, 3424793077u,
315836068u, 3200749877u,
4065431359u, 760633989u,
2982018998u, 1811050648u,
234531934u, 1115203611u,
3897494162u, 1516407838u,
1603559457u, 323296368u,
2632963283u, 1778459926u,
2879836826u, 2146672889u,
3486330348u, 492621815u,
1231665285u, 2457048126u,
3438440082u, 2217471853u,
3355404249u, 3275550588u,
1052645068u, 862072556u,
4110617119u, 3745267835u,
2657392572u, 4279236653u,
1688445808u, 701920051u,
956734128u, 581695350u,
3157862788u, 2585726058u,
1192588249u, 1410111809u,
1651193125u, 3326135446u,
1073280453u, 97376972u,
2513844237u, 2187968410u,
3976859649u, 4267859263u,
3429034542u, 564493077u,
3000537321u, 479241367u,
3845637831u, 2868987960u,
51544337u, 1029173765u,
393624922u, 704325635u,
2357610553u, 1418509533u,
2007814586u, 3866658271u,
3082385053u, 735688735u,
916110004u, 3283299459u,
1051684175u, 1083796807u,
4074716319u, 813690332u,
144264390u, 1439630796u,
1508556987u, 675582689u,
3748881891u, 3195309868u,
362884708u, 1616408198u,
43233176u, 837301135u,
881504822u, 3254795114u,
1385506591u, 2799925823u,
1469874582u, 3464841997u,
497175391u, 3929484338u,
3975771289u, 1798536177u,
2926265846u, 1374242438u,
3675707838u, 4205965408u,
3153165629u, 1499475160u,
187287713u, 548490821u,
3255259608u, 4247675634u,
1940181471u, 3779953975u,
687167150u, 2319566715u,
1742785722u, 785893184u,
2296977392u, 2778575413u,
1794720651u, 48131484u,
4084891412u, 1160134629u,
3737623280u, 823113169u,
3423207646u, 3803213486u,
710625654u, 4116162021u,
3693420287u, 4167766971u,
1666602807u, 295320990u,
3513255468u, 2487440590u,
234080704u, 4004655503u,
2971762528u, 1479656873u,
4090178629u, 4044418876u,
391947536u, 1462554406u,
3909295855u, 1239580330u,
1515601363u, 2011102035u,
1442068334u, 4265993528u,
1191921695u, 2291355695u,
4257172787u, 576405853u,
314332944u, 4038839101u,
55559918u, 2378985842u,
711098718u, 2425317635u,
1644327317u, 1401013391u,
4193760037u, 2958260436u,
3167371443u, 3062418115u,
3800755475u, 3167030094u,
3489648204u, 1405430357u,
526177822u, 2602636307u,
915406019u, 4264167741u,
1484090483u, 3070944737u,
254529415u, 4017058800u,
1702710265u, 1029665228u,
2000382906u, 3185573940u,
1381258384u, 4036354071u,
2900841028u, 2670703363u,
2921748807u, 2899069938u,
4130543625u, 688472265u,
4186808827u, 1054670286u,
1132985391u, 2840525968u,
4175776103u, 338058159u,
1735964501u, 1539305024u,
3497121710u, 1568260669u,
2227290760u, 146827036u,
3977176001u, 4060134777u,
857488494u, 250055052u,
4284109679u, 2502815838u,
2592281721u, 1603444633u,
1390562014u, 1556658131u,
616327404u, 2448966429u,
3051191726u, 3891353218u,
1213304082u, 762328245u,
2239052397u, 1082330589u,
2455957292u, 201837927u,
405397452u, 3079886794u,
2583939798u, 2848283092u,
3750724631u, 883849006u,
3204198988u, 3341327098u,
1855234968u, 1982110346u,
1485529487u, 541496720u,
4117290321u, 3607433551u,
2168864636u, 133643215u,
1055817409u, 3847827123u,
2960769387u, 4046101649u,
1176127003u, 4015671361u,
4243643405u, 2849988118u,
517111221u, 1796672358u,
2045051700u, 3452457457u,
2948254999u, 2102063419u,
1556410577u, 1536380876u,
3776661467u, 3281002516u,
1735616066u, 1539151988u,
1087795162u, 3332431596u,
685631442u, 1147951686u,
95237878u, 2005032160u,
4012206915u, 4224354805u,
3204999386u, 2415262714u,
1433635018u, 116647396u,
83167836u, 2881562655u,
2729416454u, 1029284767u,
881378302u, 2159170082u,
555057366u, 1169104445u,
3963877000u, 1919171906u,
336034862u, 2017579106u,
4059340529u, 3020819343u,
865146997u, 2473524405u,
944743644u, 1694443528u,
1804513294u, 2904752429u,
617975720u, 3671562289u,
260177668u, 505662155u,
1885941445u, 2504509403u,
2260041112u, 1019936943u,
3722741628u, 1511077569u,
3100701179u, 1379422864u,
1535670711u, 773792826u,
1103819072u, 2089123665u,
1157547425u, 329152940u,
4142587430u, 484732447u,
2475035432u, 1120017626u,
412145504u, 965125959u,
324924679u, 2809286837u,
2842141483u, 4029205195u,
2974306813u, 515627448u,
3791551981u, 1097806406u,
3873078673u, 136118734u,
1872130856u, 3632422367u,
3574135531u, 4017075736u,
1699452298u, 1403506686u,
344414660u, 1189129691u,
3487080616u, 1516736273u,
1805475756u, 2562064338u,
163335594u, 2732147834u,
4077452507u, 2984955003u,
4271866024u, 3071338162u,
2347111903u, 873829983u,
1948409509u, 1923531348u,
459509140u, 771592405u,
1750124750u, 2334938333u,
213811117u, 2586632018u,
185232757u, 4032960199u,
2447383637u, 284777551u,
1654276320u, 2687561076u,
3512945009u, 308584855u,
1861027147u, 4102279334u,
3203802620u, 1692079268u,
4250142168u, 2565680167u,
1507046104u, 841195925u,
520565830u, 3674576684u,
38924274u, 3770488806u,
2414430882u, 3978473838u,
3703994407u, 69201295u,
3099963860u, 1255084262u,
690971838u, 3539996781u,
3696902571u, 3593730713u,
2363435042u, 54945052u,
1785765213u, 184911581u,
1586241476u, 1939595371u,
2534883189u, 2432427547u,
2374171993u, 2039128933u,
2955715987u, 2295501078u,
2741583197u, 1280920000u,
686818699u, 1238742497u,
3843660102u, 82177963u,
1281043691u, 1121403845u,
1697846708u, 284852964u,
278661677u, 2889101923u,
2127558730u, 713121337u,
872502474u, 511142139u,
1261140657u, 1747052377u,
2108187161u, 927011680u,
955328267u, 3821994995u,
2707230761u, 4142246789u,
4134691985u, 1958963937u,
2498463509u, 1977988705u,
1419293714u, 1636932722u,
2567532373u, 4075249328u,
240575705u, 1956681213u,
2598802768u, 2025886508u,
4104757832u, 3026358429u,
3242615202u, 4026813725u,
255108733u, 1845587644u,
3573008472u, 3615577014u,
1222733548u, 1205557630u,
917608574u, 1363253259u,
1541946015u, 3087190425u,
1138008081u, 1444019663u,
109793386u, 341851980u,
857839960u, 2515339233u,
156283211u, 1906768669u,
3886713057u, 1276595523u,
2809830736u, 460237542u,
3420452099u, 142985419u,
205970448u, 4198897105u,
1950698961u, 2069753399u,
1142216925u, 1113051162u,
1033680610u, 4278599955u,
1106466069u, 356742959u,
531521052u, 3494863964u,
225629455u, 3735275001u,
3662626864u, 1750561299u,
1012864651u, 2101846429u,
1074553219u, 668829411u,
992181339u, 3384018814u,
3330664522u, 860966321u,
1885071395u, 4233785523u,
100741310u, 451656820u,
2148187612u, 1063001151u,
360256231u, 107312677u,
3650357479u, 2390172694u,
22452685u, 237319043u,
3600462351u, 1216645846u,
2088767754u, 164402616u,
2418980170u, 926137824u,
94638678u, 1689811113u,
2751052984u, 1767810825u,
271289013u, 3896132233u,
103797041u, 1397772514u,
3441135892u, 3323383489u,
2491268371u, 1662561885u,
1612872497u, 2986430557u,
2756998822u, 207428029u,
937973965u, 2791656726u,
1949717207u, 2260498180u,
2648427775u, 2360400900u,
2080496169u, 486358863u,
1582022990u, 1263709570u,
1396468647u, 1377764574u,
363008508u, 1293502429u,
224580012u, 4252610345u,
1435134775u, 1099809675u,
533671980u, 1533438766u,
1820532305u, 2776960536u,
3374512975u, 3542220540u,
822810075u, 3716663290u,
1157398049u, 3752806924u,
4081637863u, 337070226u,
3866585976u, 359270190u,
2110942730u, 3267551635u,
644850146u, 1306761320u,
746972907u, 934259457u,
2341378668u, 2220373824u,
1242645122u, 4109252858u,
1625266099u, 1173698481u,
383517064u, 896322512u,
3377483696u, 1788337208u,
455496839u, 3194373887u,
1837689083u, 1336556841u,
1658628529u, 2911512007u,
3838343487u, 2757664765u,
1537187340u, 3712582785u,
367022558u, 3071359622u,
3926147070u, 35432879u,
3093195926u, 2561488770u,
4273132307u, 3898950547u,
2838251049u, 2103926083u,
2549435227u, 536047554u,
1858986613u, 2040551642u,
1147412575u, 1972369852u,
4166184983u, 3528794619u,
4077477194u, 3565689036u,
808048238u, 3826350461u,
1359641525u, 1197100813u,
265993036u, 1864569342u,
725164342u, 2264788336u,
1831223342u, 3329594980u,
923017956u, 490608221u,
3818634478u, 258154469u,
1441714797u, 1174785921u,
3833372385u, 3287246572u,
1677395563u, 3569218731u,
868981704u, 2163330264u,
2649450292u, 500120236u,
465161780u, 746438382u,
1145009669u, 2520062970u,
2810524030u, 1561519055u,
1479878006u, 3864969305u,
2686075657u, 4042710240u,
3224066062u, 2774151984u,
2226179547u, 1643626042u,
2328730865u, 3160666939u,
2107011431u, 96459446u,
3920328742u, 3336407558u,
829404209u, 1878067032u,
1235983679u, 4237425634u,
466519055u, 3870676863u,
934312076u, 2952135524u,
276949224u, 4100839753u,
424001484u, 1955120893u,
4015478120u, 1265237690u,
427484362u, 4246879223u,
3452969617u, 1724363362u,
1553513184u, 834830418u,
1858777639u, 3476334357u,
4144030366u, 2450047160u,
2950762705u, 4277111759u,
358032121u, 2511026735u,
167923105u, 2059208280u,
251949572u, 3065234219u,
1535473864u, 556796152u,
1513237478u, 3150857516u,
1103404394u, 198182691u,
1476438092u, 2913077464u,
207119516u, 3963810232u,
2954651680u, 1535115487u,
3051522276u, 4046477658u,
917804636u, 864395565u,
632704095u, 140762681u,
1802040304u, 990407433u,
3771506212u, 4106024923u,
1287729497u, 2198985327u,
4052924496u, 2926590471u,
3084557148u, 1472898694u,
1009870118u, 559702706u,
4265214507u, 82077489u,
3067891003u, 3295678907u,
2402308151u, 1096697687u,
464407878u, 4190838199u,
4269578403u, 3060919438u,
2899950405u, 3046872820u,
733509243u, 1583801700u,
40453902u, 3879773881u,
1993425202u, 2185339100u,
1877837196u, 3912423882u,
3293122640u, 4104318469u,
1679617763u, 3703603898u,
8759461u, 2540185277u,
1152198475u, 2038345882u,
2503579743u, 1446869792u,
2019419351u, 4051584612u,
3178289407u, 3992503830u,
2879018745u, 2719373510u,
700836153u, 1675560450u,
4121245793u, 2064715719u,
343595772u, 1996164093u,
3130433948u, 405251683u,
2804817126u, 1607133689u,
463852893u, 2864244470u,
2224044848u, 4071581802u,
2537107938u, 2246347953u,
3207234525u, 2028708916u,
2272418128u, 803575837u,
38655481u, 2170452091u,
3272166407u, 557660441u,
4019147902u, 3841480082u,
298459606u, 2600943364u,
2440657523u, 255451671u,
3424361375u, 779434428u,
3088526123u, 490671625u,
1322855877u, 3452203069u,
3057021940u, 2285701422u,
2014993457u, 2390431709u,
2002090272u, 1568745354u,
1783152480u, 823305654u,
4053862835u, 2200236540u,
3009412313u, 3184047862u,
3032187389u, 4159715581u,
2966902888u, 252986948u,
1849329144u, 3160134214u,
3420960112u, 3198900547u,
749160960u, 379139040u,
1208883495u, 1566527339u,
3006227299u, 4194096960u,
556075248u, 497404038u,
1717327230u, 1496132623u,
1775955687u, 1719108984u,
1014328900u, 4189966956u,
2108574735u, 2584236470u,
684087286u, 531310503u,
4264509527u, 773405691u,
3088905079u, 3456882941u,
3105682208u, 3382290593u,
2289363624u, 3296306400u,
4168438718u, 467441309u,
777173623u, 3241407531u,
1183994815u, 1132983260u,
1610606159u, 2540270567u,
2649684057u, 1397502982u,
146657385u, 3318434267u,
2109315753u, 3348545480u,
3193669211u, 811750340u,
1073256162u, 3571673088u,
546596661u, 1017047954u,
3403136990u, 2540585554u,
1477047647u, 4145867423u,
2826408201u, 3531646869u,
784952939u, 943914610u,
2717443875u, 3657384638u,
1806867885u, 1903578924u,
3985088434u, 1911188923u,
1764002686u, 3672748083u,
1832925325u, 241574049u,
519948041u, 3181425568u,
2939747257u, 1634174593u,
3429894862u, 3529565564u,
1089679033u, 240953857u,
2025369941u, 2695166650u,
517086873u, 2964595704u,
3017658263u, 3828377737u,
2144895011u, 994799311u,
1184683823u, 4260564140u,
308018483u, 4262383425u,
1374752558u, 3431057723u,
1572637805u, 383233885u,
3188015819u, 4051263539u,
233319221u, 3794788167u,
2017406667u, 919677938u,
4074952232u, 1683612329u,
4213676186u, 327142514u,
3032591014u, 4204155962u,
206775997u, 2283918569u,
2395147154u, 3427505379u,
2211319468u, 4153726847u,
2217060665u, 350160869u,
2493667051u, 1648200185u,
3441709766u, 1387233546u,
140980u, 1891558063u,
760080239u, 2088061981u,
1580964938u, 740563169u,
422986366u, 330624974u,
4264507722u, 150928357u,
2738323042u, 2948665536u,
918718096u, 376390582u,
3966098971u, 717653678u,
3219466255u, 3799363969u,
3424344721u, 3187805406u,
375347278u, 3490350144u,
1992212097u, 2263421398u,
3855037968u, 1928519266u,
3866327955u, 1129127000u,
1782515131u, 2746577402u,
3059200728u, 2108753646u,
2738070963u, 1336849395u,
1705302106u, 768287270u,
1343511943u, 2247006571u,
1956142255u, 1780259453u,
3475618043u, 212490675u,
622521957u, 917121602u,
1852992332u, 1267987847u,
3170016833u, 2549835613u,
3299763344u, 2864033668u,
3378768767u, 1236609378u,
4169365948u, 3738062408u,
2661022773u, 2006922227u,
2760592161u, 3828932355u,
2636387819u, 2616619070u,
1237256330u, 3449066284u,
2871755260u, 3729280948u,
3862686086u, 431292293u,
3285899651u, 786322314u,
2531158535u, 724901242u,
2377363130u, 1415970351u,
1244759631u, 3263135197u,
965248856u, 174024139u,
2297418515u, 2954777083u,
987586766u, 3206261120u,
4059515114u, 3903854066u,
1931934525u, 2287507921u,
1827135136u, 1781944746u,
574617451u, 2299034788u,
2650140034u, 4081586725u,
2482286699u, 1109175923u,
458483596u, 618705848u,
4059852729u, 1813855658u,
4190721328u, 1129462471u,
4089998050u, 3575732749u,
2375584220u, 1037031473u,
1623777358u, 3389003793u,
546597541u, 352770237u,
1383747654u, 3122687303u,
1646071378u, 1164309901u,
290870767u, 830691298u,
929335420u, 3193251135u,
989577914u, 3626554867u,
591974737u, 3996958215u,
3163711272u, 3071568023u,
1516846461u, 3656006011u,
2698625268u, 2510865430u,
340274176u, 1167681812u,
3698796465u, 3155218919u,
4102288238u, 1673474350u,
3069708839u, 2704165015u,
1237411891u, 1854985978u,
3646837503u, 3625406022u,
921552000u, 1712976649u,
3939149151u, 878608872u,
3406359248u, 1068844551u,
1834682077u, 4155949943u,
2437686324u, 3163786257u,
2645117577u, 1988168803u,
747285578u, 1626463554u,
1235300371u, 1256485167u,
1914142538u, 4141546431u,
3838102563u, 582664250u,
1883344352u, 2083771672u,
2611657933u, 2139079047u,
2250573853u, 804336148u,
3066325351u, 2770847216u,
4275641370u, 1455750577u,
3346357270u, 1674051445u,
601221482u, 3992583643u,
1402445097u, 3622527604u,
2509017299u, 2966108111u,
2557027816u, 900741486u,
1790771021u, 2912643797u,
2631381069u, 4014551783u,
90375300u, 300318232u,
3269968032u, 2679371729u,
2664752123u, 3517585534u,
3253901179u, 542270815u,
1188641600u, 365479232u,
2210121140u, 760762191u,
1273768482u, 1216399252u,
3484324231u, 4287337666u,
16322182u, 643179562u,
325675502u, 3652676161u,
3120716054u, 3330259752u,
1011990087u, 2990167340u,
1097584090u, 3262252593u,
1829409951u, 3665087267u,
1214854475u, 2134299399u,
3704419305u, 411263051u,
1625446136u, 549838529u,
4283196353u, 1342880802u,
3460621305u, 1967599860u,
4282843369u, 1275671016u,
2544665755u, 853593042u,
901109753u, 2682611693u,
110631633u, 797487791u,
1472073141u, 850464484u,
797089608u, 3286110054u,
350397471u, 2775631060u,
366448238u, 3842907484u,
2219863904u, 3623364733u,
1850985302u, 4009616991u,
294963924u, 3693536939u,
3061255808u, 1615375832u,
1920066675u, 4113028420u,
4032223840u, 2318423400u,
2701956286u, 4145497671u,
3991532344u, 2536338351u,
1679099863u, 1728968857u,
449740816u, 2686506989u,
685242457u, 97590863u,
3258354115u, 1502282913u,
1235084019u, 2151665147u,
528459289u, 231097464u,
2477280726u, 3651607391u,
2091754612u, 1178454681u,
980597335u, 1604483865u,
1842333726u, 4146839064u,
3213794286u, 2601416506u,
754220096u, 3571436033u,
488595746u, 1448097974u,
4004834921u, 238887261u,
3320337489u, 1416989070u,
2928916831u, 4093725287u,
186020771u, 2367569534u,
3046087671u, 4090084518u,
3548184546u, 679517009u,
1962659444u, 3539886328u,
4192003933u, 1678423485u,
3827951761u, 3086277222u,
2144472852u, 1390394371u,
2976322029u, 1574517163u,
3553313841u, 119173722u,
1702434637u, 1766260771u,
3629581771u, 1407497759u,
895654784u, 751439914u,
4008409498u, 215917713u,
1482103833u, 695551833u,
1288382231u, 2656990891u,
2581779077u, 1570750352u,
3710689053u, 1741390464u,
2666411616u, 3533987737u,
4289478316u, 3576119563u,
4118694920u, 108199666u,
3869794273u, 963183826u,
2081410737u, 3796810515u,
791123882u, 2525792704u,
1036883117u, 136547246u,
875691100u, 2592925324u,
614302599u, 3013176417u,
2689342539u, 427154472u,
532957601u, 1228758574u,
1898117151u, 1181643858u,
1908591042u, 1464255968u,
446980910u, 2984611177u,
58509511u, 1046943619u,
3508927906u, 2001585786u,
2544767379u, 1525438381u,
552181222u, 1959725830u,
879448844u, 1348536411u,
4242243590u, 2861338018u,
1082052441u, 1034351453u,
601175800u, 764077711u,
530635011u, 3785343245u,
2178026726u, 117256687u,
2378297261u, 457568934u,
76438221u, 4104954272u,
956793873u, 3783168634u,
2485968477u, 2381948487u,
4226929450u, 3148473363u,
2518273601u, 3569490233u,
879369091u, 2180270337u,
3674375989u, 1387729170u,
977997984u, 4270646856u,
568650985u, 951677556u,
4213877384u, 2721005055u,
1073364549u, 2563403831u,
1678669911u, 66786703u,
2273631661u, 1149351924u,
3651298990u, 1581883443u,
246723096u, 1895026827u,
3810605772u, 3711056516u,
4058833288u, 2193790614u,
2080120290u, 3638638708u,
2915672708u, 2263003308u,
2361934197u, 4136767460u,
1976115991u, 3448840877u,
2019238520u, 225333538u,
874340815u, 2976159827u,
1555273378u, 3797521928u,
1942347150u, 3262952567u,
435997738u, 340403353u,
2817830907u, 2078619498u,
749534111u, 1178073973u,
894654712u, 3361226032u,
841092198u, 3288261538u,
1696412169u, 1496966875u,
697501571u, 1059158875u,
3739946319u, 2481012988u,
568983526u, 114945840u,
1559249010u, 2218244008u,
2841706923u, 1632780103u,
4020169654u, 2087949619u,
2438736103u, 24032648u,
833416317u, 3787017905u,
2373238993u, 2575395164u,
3434544481u, 3228481067u,
2542976862u, 2971726178u,
2880371864u, 3642087909u,
2407477975u, 2239080836u,
1043714217u, 3894199764u,
2235879182u, 203853421u,
2933669448u, 2504940536u,
834683330u, 425935223u,
3560796393u, 3565833278u,
1668000829u, 3683399154u,
3414330886u, 1748785729u,
1023171602u, 580966986u,
2531038985u, 3227325488u,
2657385925u, 2124704694u,
233442446u, 1107045577u,
3407293834u, 552770757u,
3899097693u, 1067532701u,
115667924u, 1406028344u,
1707768231u, 3724015962u,
2419657149u, 18613994u,
2532882091u, 3476683808u,
1560838678u, 811220224u,
895961699u, 3762914298u,
1328752423u, 1844996900u,
1420427894u, 1848067707u,
1210281744u, 904215228u,
4055325594u, 1118521573u,
2496554183u, 2579259919u,
3996647489u, 3657647605u,
325254059u, 3136157065u,
3951522674u, 4052925250u,
3341068436u, 2287683323u,
1313073005u, 126005630u,
2505120084u, 1194725057u,
853746559u, 3555092974u,
2689238752u, 49515858u,
1244776042u, 1069300695u,
61073168u, 1010661841u,
1269521335u, 1902040126u,
990632502u, 2378708922u,
3858321250u, 1400735275u,
2974699176u, 2771676666u,
170995186u, 2877798589u,
545726212u, 2225229957u,
1086473152u, 3454177594u,
3859483262u, 1499729584u,
2088002891u, 2883475137u,
3222194252u, 4144472319u,
2212229854u, 4146740722u,
567988835u, 1051332394u,
3932046135u, 542648229u,
3017852446u, 1277887997u,
162888005u, 1669710469u,
1492500905u, 553041029u,
1434876932u, 533989516u,
3817492747u, 584127807u,
4147115982u, 2993670925u,
4020312558u, 710021255u,
3509733475u, 3587959456u,
2088550465u, 1745399498u,
2952242967u, 1259815443u,
869648362u, 1404723176u,
3947542735u, 1334333531u,
3873471582u, 229399758u,
59634866u, 3239516985u,
3844250972u, 1275954779u,
1385684948u, 2243700741u,
2512155003u, 1685649437u,
639306006u, 2524620206u,
955360345u, 1646776457u,
576786501u, 655707039u,
2864351838u, 3736264674u,
655621239u, 362070173u,
1200907897u, 2384379464u,
15823708u, 206117476u,
3652870937u, 122927134u,
1193310960u, 1093099415u,
3696538026u, 4112584792u,
1834541277u, 845639252u,
2069527017u, 547588820u,
4178147211u, 2827259351u,
1764455305u, 3312003602u,
940846775u, 1054995047u,
2976960697u, 1934305529u,
3095615046u, 3354962706u,
2199137382u, 1005722394u,
1875867180u, 2064356511u,
3363633633u, 2688499147u,
4019734130u, 3096333006u,
2069509024u, 2906358341u,
3247463123u, 4191788132u,
2232866485u, 1456016086u,
1422674894u, 867282151u,
1851386407u, 1268304058u,
1612503136u, 1739843072u,
134947567u, 2978775774u,
2051592101u, 1017127033u,
1284167756u, 1090844589u,
831688783u, 2079216362u,
2079309682u, 1950585801u,
1626991196u, 3644714163u,
3678110059u, 898470030u,
1117570988u, 2517572125u,
3916646913u, 3182422972u,
3630426828u, 969847973u,
2835126238u, 53541366u,
3427164640u, 3463937250u,
3044785046u, 897322257u,
103038235u, 3804506837u,
3443872170u, 4185408854u,
2557463241u, 4080940424u,
3669923099u, 2789619871u,
2048168570u, 2429169982u,
3174690447u, 2513494106u,
3099587829u, 2627855577u,
1213061732u, 3143736628u,
3482268149u, 1250714337u,
3553412672u, 2689632914u,
31648125u, 3872383625u,
1565760579u, 36665130u,
1282106920u, 359361724u,
751041229u, 2257179590u,
2915361862u, 280819225u,
954406473u, 4101682199u,
2907818413u, 4254297769u,
3493178615u, 3755944354u,
3539557658u, 3330196096u,
4043533423u, 1134196225u,
4177134659u, 127246419u,
4213770762u, 1978302978u,
2442615581u, 923049607u,
1004426206u, 782768297u,
2702745496u, 1880389457u,
2410586681u, 1430106871u,
4103323427u, 3168399477u,
201787012u, 3105353527u,
3716682375u, 3616334719u,
3413209549u, 656672786u,
526032790u, 2895072131u,
2876965944u, 182894450u,
456581318u, 2683752067u,
1287916294u, 1270745752u,
3877875910u, 3190666241u,
3240336907u, 4024807233u,
4227999465u, 2389301430u,
1681224377u, 1576191191u,
3599250276u, 2381111980u,
3995044500u, 995595530u,
3495321877u, 3956024585u,
1611608524u, 3815677453u,
1520987487u, 3669102590u,
2062334396u, 1656117707u,
5457134u, 3234118251u,
4242065111u, 596879987u,
470187419u, 2688566989u,
3259870297u, 660100446u,
1042378442u, 2206034096u,
442236198u, 2542452448u,
493137955u, 392411099u,
3111186954u, 438250493u,
947967568u, 1234595917u,
4230082284u, 2762976773u,
421203727u, 3728409592u,
2870085764u, 1455086530u,
2762099647u, 4011882747u,
1785430706u, 3684427488u,
1215981925u, 3227517889u,
3269061963u, 4037515364u,
1749401388u, 2167451566u,
3168911474u, 4255057396u,
2026092260u, 1736192508u,
4123254745u, 2319366806u,
3909727042u, 3114708966u,
1938800693u, 680793595u,
3933041672u, 616863613u,
1525265867u, 2808224480u,
2122290603u, 1211197714u,
1186177814u, 2395325006u,
3520488321u, 3979192396u,
3540779343u, 4192918639u,
1763872074u, 3402419930u,
2736030448u, 1120335563u,
1698949078u, 3993310631u,
2947659998u, 1461045789u,
1966048551u, 2228221363u,
597941119u, 3498018399u,
1441110751u, 2229999711u,
393987327u, 454500547u,
1222959566u, 567151340u,
2496952483u, 1708770195u,
3774764786u, 1492844524u,
3308300614u, 805568076u,
4068812294u, 3404648243u,
868414882u, 177406999u,
1608110313u, 642061169u,
2093999089u, 222470301u,
1027515771u, 3131251981u,
2851936150u, 4272755262u,
2763002551u, 1881527822u,
1532845092u, 709643652u,
682573592u, 1244104217u,
440905170u, 1111321746u,
796769556u, 2500467040u,
3002618826u, 1112998535u,
1188525643u, 4212674512u,
1780193104u, 1243644607u,
3691719535u, 2958853053u,
2813437721u, 4036584207u,
466635014u, 2277292580u,
4082276003u, 1030800045u,
1899531424u, 609466946u,
1750863246u, 379050598u,
3576413281u, 731493104u,
2707384133u, 2289193651u,
132259176u, 4115195437u,
1769890695u, 2715470335u,
3348954692u, 2166575624u,
1819263183u, 2028531518u,
2154809766u, 3672399742u,
1142139448u, 88299682u,
76727603u, 4198182186u,
2304993586u, 1666387627u,
2488475423u, 3832777692u,
284366017u, 3359785538u,
3469807328u, 2926494787u,
1914195188u, 1134129972u,
3829072836u, 2493478921u,
3738499303u, 3311304980u,
726951526u, 911080963u,
932916545u, 2235559063u,
2909742396u, 1765719309u,
465269850u, 3803621553u,
1456588655u, 508290328u,
1490719640u, 3356513470u,
2262196163u, 1451774941u,
2908490783u, 251085588u,
830410677u, 3172220325u,
4039692645u, 1383603170u,
3897208579u, 1940535730u,
151909546u, 2384458112u,
};

// Return false only if offset is -1 and a spot check of 3 hashes all yield 0.
bool Test(int offset, int len = 0) {
#undef Check
#undef IsAlive

#define Check(x) do {                                                   \
  const uint32_t actual = (x), e = expected[index++];                   \
  bool ok = actual == e;                                                \
  if (!ok) {                                                            \
    cerr << "expected " << hex << e << " but got " << actual << endl;   \
    ++errors;                                                           \
  }                                                                     \
  assert(ok);                                                           \
} while (0)

#define IsAlive(x) do { alive += IsNonZero(x); } while (0)

  // After the following line is where the uses of "Check" and such will go.
  static int index = 0;
if (offset == -1) { int alive = 0; { uint64_t h = farmhashxo::Hash64WithSeeds(data, len++, SEED0, SEED1); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } { uint64_t h = farmhashxo::Hash64WithSeed(data, len++, SEED); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } { uint64_t h = farmhashxo::Hash64(data, len++); IsAlive(h >> 32); IsAlive((h << 32) >> 32); } len -= 3; return alive > 0; }
{ uint64_t h = farmhashxo::Hash64WithSeeds(data + offset, len, SEED0, SEED1); Check(h >> 32); Check((h << 32) >> 32); }
{ uint64_t h = farmhashxo::Hash64WithSeed(data + offset, len, SEED); Check(h >> 32); Check((h << 32) >> 32); }
{ uint64_t h = farmhashxo::Hash64(data + offset, len); Check(h >> 32); Check((h << 32) >> 32); }

  return true;
#undef Check
#undef IsAlive
}

int RunTest() {
  Setup();
  int i = 0;
  cout << "Running farmhashxoTest";
  if (!Test(-1)) {
    cout << "... Unavailable\n";
    return NoteErrors();
  }
  // Good.  The function is attempting to hash, so run the full test.
  int errors_prior_to_test = errors;
  for ( ; i < kTestSize - 1; i++) {
    Test(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    Test(0, i);
  }
  Test(0, kDataSize);
  cout << (errors == errors_prior_to_test ? "... OK\n" : "... Failed\n");
  return NoteErrors();
}

#else

// After the following line is where the code to print hash codes will go.
void Dump(int offset, int len) {
{ uint64_t h = farmhashxo::Hash64WithSeeds(data + offset, len, SEED0, SEED1); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
{ uint64_t h = farmhashxo::Hash64WithSeed(data + offset, len, SEED); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
{ uint64_t h = farmhashxo::Hash64(data + offset, len); cout << (h >> 32) << "u, " << ((h << 32) >> 32) << "u," << endl; }
}

#endif

#undef SEED
#undef SEED1
#undef SEED0

}  // namespace farmhashxoTest

#if !TESTING
int main(int argc, char** argv) {
  Setup();
  cout << "uint32_t expected[] = {\n";
  int i = 0;
  for ( ; i < kTestSize - 1; i++) {
    farmhashxoTest::Dump(i * i, i);
  }
  for ( ; i < kDataSize; i += i / 7) {
    farmhashxoTest::Dump(0, i);
  }
  farmhashxoTest::Dump(0, kDataSize);
  cout << "};\n";
}
#endif

int main() {
  farmhashccTest::RunTest();
  farmhashmkTest::RunTest();
  farmhashnaTest::RunTest();
  farmhashntTest::RunTest();
  farmhashsaTest::RunTest();
  farmhashsuTest::RunTest();
  farmhashteTest::RunTest();
  farmhashuoTest::RunTest();
  farmhashxoTest::RunTest();
  __builtin_unreachable();
}

#endif  // FARMHASHSELFTEST

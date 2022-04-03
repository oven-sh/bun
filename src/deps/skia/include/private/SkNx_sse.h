/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkNx_sse_DEFINED
#define SkNx_sse_DEFINED

#include "include/core/SkTypes.h"

#if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
    #include <smmintrin.h>
#elif SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSSE3
    #include <tmmintrin.h>
#else
    #include <emmintrin.h>
#endif

// This file may assume <= SSE2, but must check SK_CPU_SSE_LEVEL for anything more recent.
// If you do, make sure this is in a static inline function... anywhere else risks violating ODR.

namespace {  // NOLINT(google-build-namespaces)

// Emulate _mm_floor_ps() with SSE2:
//   - roundtrip through integers via truncation
//   - subtract 1 if that's too big (possible for negative values).
// This restricts the domain of our inputs to a maximum somehwere around 2^31.
// Seems plenty big.
AI static __m128 emulate_mm_floor_ps(__m128 v) {
    __m128 roundtrip = _mm_cvtepi32_ps(_mm_cvttps_epi32(v));
    __m128 too_big = _mm_cmpgt_ps(roundtrip, v);
    return _mm_sub_ps(roundtrip, _mm_and_ps(too_big, _mm_set1_ps(1.0f)));
}

template <>
class SkNx<2, float> {
public:
    AI SkNx(const __m128& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(float val) : fVec(_mm_set1_ps(val)) {}
    AI static SkNx Load(const void* ptr) {
        return _mm_castsi128_ps(_mm_loadl_epi64((const __m128i*)ptr));
    }
    AI SkNx(float a, float b) : fVec(_mm_setr_ps(a,b,0,0)) {}

    AI void store(void* ptr) const { _mm_storel_pi((__m64*)ptr, fVec); }

    AI static void Load2(const void* ptr, SkNx* x, SkNx* y) {
        const float* m = (const float*)ptr;
        *x = SkNx{m[0], m[2]};
        *y = SkNx{m[1], m[3]};
    }

    AI static void Store2(void* dst, const SkNx& a, const SkNx& b) {
        auto vals = _mm_unpacklo_ps(a.fVec, b.fVec);
        _mm_storeu_ps((float*)dst, vals);
    }

    AI static void Store3(void* dst, const SkNx& a, const SkNx& b, const SkNx& c) {
        auto lo = _mm_setr_ps(a[0], b[0], c[0], a[1]),
             hi = _mm_setr_ps(b[1], c[1],    0,    0);
        _mm_storeu_ps((float*)dst, lo);
        _mm_storel_pi(((__m64*)dst) + 2, hi);
    }

    AI static void Store4(void* dst, const SkNx& a, const SkNx& b, const SkNx& c, const SkNx& d) {
        auto lo = _mm_setr_ps(a[0], b[0], c[0], d[0]),
             hi = _mm_setr_ps(a[1], b[1], c[1], d[1]);
        _mm_storeu_ps((float*)dst, lo);
        _mm_storeu_ps(((float*)dst) + 4, hi);
    }

    AI SkNx operator - () const { return _mm_xor_ps(_mm_set1_ps(-0.0f), fVec); }

    AI SkNx operator + (const SkNx& o) const { return _mm_add_ps(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return _mm_sub_ps(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return _mm_mul_ps(fVec, o.fVec); }
    AI SkNx operator / (const SkNx& o) const { return _mm_div_ps(fVec, o.fVec); }

    AI SkNx operator == (const SkNx& o) const { return _mm_cmpeq_ps (fVec, o.fVec); }
    AI SkNx operator != (const SkNx& o) const { return _mm_cmpneq_ps(fVec, o.fVec); }
    AI SkNx operator  < (const SkNx& o) const { return _mm_cmplt_ps (fVec, o.fVec); }
    AI SkNx operator  > (const SkNx& o) const { return _mm_cmpgt_ps (fVec, o.fVec); }
    AI SkNx operator <= (const SkNx& o) const { return _mm_cmple_ps (fVec, o.fVec); }
    AI SkNx operator >= (const SkNx& o) const { return _mm_cmpge_ps (fVec, o.fVec); }

    AI static SkNx Min(const SkNx& l, const SkNx& r) { return _mm_min_ps(l.fVec, r.fVec); }
    AI static SkNx Max(const SkNx& l, const SkNx& r) { return _mm_max_ps(l.fVec, r.fVec); }

    AI SkNx abs() const { return _mm_andnot_ps(_mm_set1_ps(-0.0f), fVec); }
    AI SkNx floor() const {
    #if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
        return _mm_floor_ps(fVec);
    #else
        return emulate_mm_floor_ps(fVec);
    #endif
    }

    AI SkNx   sqrt() const { return _mm_sqrt_ps (fVec);  }

    AI float operator[](int k) const {
        SkASSERT(0 <= k && k < 2);
        union { __m128 v; float fs[4]; } pun = {fVec};
        return pun.fs[k&1];
    }

    AI bool allTrue() const { return 0b11 == (_mm_movemask_ps(fVec) & 0b11); }
    AI bool anyTrue() const { return 0b00 != (_mm_movemask_ps(fVec) & 0b11); }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
    #if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
        return _mm_blendv_ps(e.fVec, t.fVec, fVec);
    #else
        return _mm_or_ps(_mm_and_ps   (fVec, t.fVec),
                         _mm_andnot_ps(fVec, e.fVec));
    #endif
    }

    __m128 fVec;
};

template <>
class SkNx<4, float> {
public:
    AI SkNx(const __m128& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(float val)           : fVec( _mm_set1_ps(val) ) {}
    AI SkNx(float a, float b, float c, float d) : fVec(_mm_setr_ps(a,b,c,d)) {}

    AI static SkNx Load(const void* ptr) { return _mm_loadu_ps((const float*)ptr); }
    AI void store(void* ptr) const { _mm_storeu_ps((float*)ptr, fVec); }

    AI static void Load2(const void* ptr, SkNx* x, SkNx* y) {
        SkNx lo = SkNx::Load((const float*)ptr+0),
             hi = SkNx::Load((const float*)ptr+4);
        *x = SkNx{lo[0], lo[2], hi[0], hi[2]};
        *y = SkNx{lo[1], lo[3], hi[1], hi[3]};
    }

    AI static void Load4(const void* ptr, SkNx* r, SkNx* g, SkNx* b, SkNx* a) {
        __m128 v0 = _mm_loadu_ps(((float*)ptr) +  0),
               v1 = _mm_loadu_ps(((float*)ptr) +  4),
               v2 = _mm_loadu_ps(((float*)ptr) +  8),
               v3 = _mm_loadu_ps(((float*)ptr) + 12);
        _MM_TRANSPOSE4_PS(v0, v1, v2, v3);
        *r = v0;
        *g = v1;
        *b = v2;
        *a = v3;
    }
    AI static void Store4(void* dst, const SkNx& r, const SkNx& g, const SkNx& b, const SkNx& a) {
        __m128 v0 = r.fVec,
               v1 = g.fVec,
               v2 = b.fVec,
               v3 = a.fVec;
        _MM_TRANSPOSE4_PS(v0, v1, v2, v3);
        _mm_storeu_ps(((float*) dst) +  0, v0);
        _mm_storeu_ps(((float*) dst) +  4, v1);
        _mm_storeu_ps(((float*) dst) +  8, v2);
        _mm_storeu_ps(((float*) dst) + 12, v3);
    }

    AI SkNx operator - () const { return _mm_xor_ps(_mm_set1_ps(-0.0f), fVec); }

    AI SkNx operator + (const SkNx& o) const { return _mm_add_ps(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return _mm_sub_ps(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return _mm_mul_ps(fVec, o.fVec); }
    AI SkNx operator / (const SkNx& o) const { return _mm_div_ps(fVec, o.fVec); }

    AI SkNx operator == (const SkNx& o) const { return _mm_cmpeq_ps (fVec, o.fVec); }
    AI SkNx operator != (const SkNx& o) const { return _mm_cmpneq_ps(fVec, o.fVec); }
    AI SkNx operator  < (const SkNx& o) const { return _mm_cmplt_ps (fVec, o.fVec); }
    AI SkNx operator  > (const SkNx& o) const { return _mm_cmpgt_ps (fVec, o.fVec); }
    AI SkNx operator <= (const SkNx& o) const { return _mm_cmple_ps (fVec, o.fVec); }
    AI SkNx operator >= (const SkNx& o) const { return _mm_cmpge_ps (fVec, o.fVec); }

    AI static SkNx Min(const SkNx& l, const SkNx& r) { return _mm_min_ps(l.fVec, r.fVec); }
    AI static SkNx Max(const SkNx& l, const SkNx& r) { return _mm_max_ps(l.fVec, r.fVec); }

    AI SkNx abs() const { return _mm_andnot_ps(_mm_set1_ps(-0.0f), fVec); }
    AI SkNx floor() const {
    #if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
        return _mm_floor_ps(fVec);
    #else
        return emulate_mm_floor_ps(fVec);
    #endif
    }

    AI SkNx   sqrt() const { return _mm_sqrt_ps (fVec);  }

    AI float operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { __m128 v; float fs[4]; } pun = {fVec};
        return pun.fs[k&3];
    }

    AI float min() const {
        SkNx min = Min(*this, _mm_shuffle_ps(fVec, fVec, _MM_SHUFFLE(2,3,0,1)));
        min = Min(min, _mm_shuffle_ps(min.fVec, min.fVec, _MM_SHUFFLE(0,1,2,3)));
        return min[0];
    }

    AI float max() const {
        SkNx max = Max(*this, _mm_shuffle_ps(fVec, fVec, _MM_SHUFFLE(2,3,0,1)));
        max = Max(max, _mm_shuffle_ps(max.fVec, max.fVec, _MM_SHUFFLE(0,1,2,3)));
        return max[0];
    }

    AI bool allTrue() const { return 0b1111 == _mm_movemask_ps(fVec); }
    AI bool anyTrue() const { return 0b0000 != _mm_movemask_ps(fVec); }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
    #if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
        return _mm_blendv_ps(e.fVec, t.fVec, fVec);
    #else
        return _mm_or_ps(_mm_and_ps   (fVec, t.fVec),
                         _mm_andnot_ps(fVec, e.fVec));
    #endif
    }

    __m128 fVec;
};

AI static __m128i mullo32(__m128i a, __m128i b) {
#if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
    return _mm_mullo_epi32(a, b);
#else
    __m128i mul20 = _mm_mul_epu32(a, b),
            mul31 = _mm_mul_epu32(_mm_srli_si128(a, 4), _mm_srli_si128(b, 4));
    return _mm_unpacklo_epi32(_mm_shuffle_epi32(mul20, _MM_SHUFFLE(0,0,2,0)),
                              _mm_shuffle_epi32(mul31, _MM_SHUFFLE(0,0,2,0)));
#endif
}

template <>
class SkNx<4, int32_t> {
public:
    AI SkNx(const __m128i& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(int32_t val) : fVec(_mm_set1_epi32(val)) {}
    AI static SkNx Load(const void* ptr) { return _mm_loadu_si128((const __m128i*)ptr); }
    AI SkNx(int32_t a, int32_t b, int32_t c, int32_t d) : fVec(_mm_setr_epi32(a,b,c,d)) {}

    AI void store(void* ptr) const { _mm_storeu_si128((__m128i*)ptr, fVec); }

    AI SkNx operator + (const SkNx& o) const { return _mm_add_epi32(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return _mm_sub_epi32(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return mullo32(fVec, o.fVec);       }

    AI SkNx operator & (const SkNx& o) const { return _mm_and_si128(fVec, o.fVec); }
    AI SkNx operator | (const SkNx& o) const { return _mm_or_si128(fVec, o.fVec);  }
    AI SkNx operator ^ (const SkNx& o) const { return _mm_xor_si128(fVec, o.fVec); }

    AI SkNx operator << (int bits) const { return _mm_slli_epi32(fVec, bits); }
    AI SkNx operator >> (int bits) const { return _mm_srai_epi32(fVec, bits); }

    AI SkNx operator == (const SkNx& o) const { return _mm_cmpeq_epi32 (fVec, o.fVec); }
    AI SkNx operator  < (const SkNx& o) const { return _mm_cmplt_epi32 (fVec, o.fVec); }
    AI SkNx operator  > (const SkNx& o) const { return _mm_cmpgt_epi32 (fVec, o.fVec); }

    AI int32_t operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { __m128i v; int32_t is[4]; } pun = {fVec};
        return pun.is[k&3];
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
    #if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
        return _mm_blendv_epi8(e.fVec, t.fVec, fVec);
    #else
        return _mm_or_si128(_mm_and_si128   (fVec, t.fVec),
                            _mm_andnot_si128(fVec, e.fVec));
    #endif
    }

    AI SkNx abs() const {
#if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSSE3
        return _mm_abs_epi32(fVec);
#else
        SkNx mask = (*this) >> 31;
        return (mask ^ (*this)) - mask;
#endif
    }

    AI static SkNx Min(const SkNx& x, const SkNx& y) {
#if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
        return _mm_min_epi32(x.fVec, y.fVec);
#else
        return (x < y).thenElse(x, y);
#endif
    }

    AI static SkNx Max(const SkNx& x, const SkNx& y) {
#if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
        return _mm_max_epi32(x.fVec, y.fVec);
#else
        return (x > y).thenElse(x, y);
#endif
    }

    __m128i fVec;
};

template <>
class SkNx<2, uint32_t> {
public:
    AI SkNx(const __m128i& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint32_t val) : fVec(_mm_set1_epi32((int)val)) {}
    AI static SkNx Load(const void* ptr) { return _mm_loadl_epi64((const __m128i*)ptr); }
    AI SkNx(uint32_t a, uint32_t b) : fVec(_mm_setr_epi32((int)a,(int)b,0,0)) {}

    AI void store(void* ptr) const { _mm_storel_epi64((__m128i*)ptr, fVec); }

    AI SkNx operator + (const SkNx& o) const { return _mm_add_epi32(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return _mm_sub_epi32(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return mullo32(fVec, o.fVec);       }

    AI SkNx operator & (const SkNx& o) const { return _mm_and_si128(fVec, o.fVec); }
    AI SkNx operator | (const SkNx& o) const { return _mm_or_si128(fVec, o.fVec);  }
    AI SkNx operator ^ (const SkNx& o) const { return _mm_xor_si128(fVec, o.fVec); }

    AI SkNx operator << (int bits) const { return _mm_slli_epi32(fVec, bits); }
    AI SkNx operator >> (int bits) const { return _mm_srli_epi32(fVec, bits); }

    AI SkNx operator == (const SkNx& o) const { return _mm_cmpeq_epi32 (fVec, o.fVec); }
    AI SkNx operator != (const SkNx& o) const { return (*this == o) ^ 0xffffffff; }
    // operator < and > take a little extra fiddling to make work for unsigned ints.

    AI uint32_t operator[](int k) const {
        SkASSERT(0 <= k && k < 2);
        union { __m128i v; uint32_t us[4]; } pun = {fVec};
        return pun.us[k&1];
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
#if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
        return _mm_blendv_epi8(e.fVec, t.fVec, fVec);
#else
        return _mm_or_si128(_mm_and_si128   (fVec, t.fVec),
                            _mm_andnot_si128(fVec, e.fVec));
#endif
    }

    AI bool allTrue() const { return 0xff == (_mm_movemask_epi8(fVec) & 0xff); }

    __m128i fVec;
};

template <>
class SkNx<4, uint32_t> {
public:
    AI SkNx(const __m128i& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint32_t val) : fVec(_mm_set1_epi32((int)val)) {}
    AI static SkNx Load(const void* ptr) { return _mm_loadu_si128((const __m128i*)ptr); }
    AI SkNx(uint32_t a, uint32_t b, uint32_t c, uint32_t d)
        : fVec(_mm_setr_epi32((int)a,(int)b,(int)c,(int)d)) {}

    AI void store(void* ptr) const { _mm_storeu_si128((__m128i*)ptr, fVec); }

    AI SkNx operator + (const SkNx& o) const { return _mm_add_epi32(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return _mm_sub_epi32(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return mullo32(fVec, o.fVec);       }

    AI SkNx operator & (const SkNx& o) const { return _mm_and_si128(fVec, o.fVec); }
    AI SkNx operator | (const SkNx& o) const { return _mm_or_si128(fVec, o.fVec);  }
    AI SkNx operator ^ (const SkNx& o) const { return _mm_xor_si128(fVec, o.fVec); }

    AI SkNx operator << (int bits) const { return _mm_slli_epi32(fVec, bits); }
    AI SkNx operator >> (int bits) const { return _mm_srli_epi32(fVec, bits); }

    AI SkNx operator == (const SkNx& o) const { return _mm_cmpeq_epi32 (fVec, o.fVec); }
    AI SkNx operator != (const SkNx& o) const { return (*this == o) ^ 0xffffffff; }

    // operator < and > take a little extra fiddling to make work for unsigned ints.

    AI uint32_t operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { __m128i v; uint32_t us[4]; } pun = {fVec};
        return pun.us[k&3];
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
    #if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
        return _mm_blendv_epi8(e.fVec, t.fVec, fVec);
    #else
        return _mm_or_si128(_mm_and_si128   (fVec, t.fVec),
                            _mm_andnot_si128(fVec, e.fVec));
    #endif
    }

    AI SkNx mulHi(SkNx m) const {
        SkNx v20{_mm_mul_epu32(m.fVec, fVec)};
        SkNx v31{_mm_mul_epu32(_mm_srli_si128(m.fVec, 4), _mm_srli_si128(fVec, 4))};

        return SkNx{v20[1], v31[1], v20[3], v31[3]};
    }

    __m128i fVec;
};

template <>
class SkNx<4, uint16_t> {
public:
    AI SkNx(const __m128i& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint16_t val) : fVec(_mm_set1_epi16((short)val)) {}
    AI SkNx(uint16_t a, uint16_t b, uint16_t c, uint16_t d)
        : fVec(_mm_setr_epi16((short)a,(short)b,(short)c,(short)d,0,0,0,0)) {}

    AI static SkNx Load(const void* ptr) { return _mm_loadl_epi64((const __m128i*)ptr); }
    AI void store(void* ptr) const { _mm_storel_epi64((__m128i*)ptr, fVec); }

    AI static void Load4(const void* ptr, SkNx* r, SkNx* g, SkNx* b, SkNx* a) {
        __m128i lo = _mm_loadu_si128(((__m128i*)ptr) + 0),
                hi = _mm_loadu_si128(((__m128i*)ptr) + 1);
        __m128i even = _mm_unpacklo_epi16(lo, hi),   // r0 r2 g0 g2 b0 b2 a0 a2
                 odd = _mm_unpackhi_epi16(lo, hi);   // r1 r3 ...
        __m128i rg = _mm_unpacklo_epi16(even, odd),  // r0 r1 r2 r3 g0 g1 g2 g3
                ba = _mm_unpackhi_epi16(even, odd);  // b0 b1 ...   a0 a1 ...
        *r = rg;
        *g = _mm_srli_si128(rg, 8);
        *b = ba;
        *a = _mm_srli_si128(ba, 8);
    }
    AI static void Load3(const void* ptr, SkNx* r, SkNx* g, SkNx* b) {
        // The idea here is to get 4 vectors that are R G B _ _ _ _ _.
        // The second load is at a funny location to make sure we don't read past
        // the bounds of memory.  This is fine, we just need to shift it a little bit.
        const uint8_t* ptr8 = (const uint8_t*) ptr;
        __m128i rgb0 = _mm_loadu_si128((const __m128i*) (ptr8 + 0));
        __m128i rgb1 = _mm_srli_si128(rgb0, 3*2);
        __m128i rgb2 = _mm_srli_si128(_mm_loadu_si128((const __m128i*) (ptr8 + 4*2)), 2*2);
        __m128i rgb3 = _mm_srli_si128(rgb2, 3*2);

        __m128i rrggbb01 = _mm_unpacklo_epi16(rgb0, rgb1);
        __m128i rrggbb23 = _mm_unpacklo_epi16(rgb2, rgb3);
        *r = _mm_unpacklo_epi32(rrggbb01, rrggbb23);
        *g = _mm_srli_si128(r->fVec, 4*2);
        *b = _mm_unpackhi_epi32(rrggbb01, rrggbb23);
    }
    AI static void Store4(void* dst, const SkNx& r, const SkNx& g, const SkNx& b, const SkNx& a) {
        __m128i rg = _mm_unpacklo_epi16(r.fVec, g.fVec);
        __m128i ba = _mm_unpacklo_epi16(b.fVec, a.fVec);
        __m128i lo = _mm_unpacklo_epi32(rg, ba);
        __m128i hi = _mm_unpackhi_epi32(rg, ba);
        _mm_storeu_si128(((__m128i*) dst) + 0, lo);
        _mm_storeu_si128(((__m128i*) dst) + 1, hi);
    }

    AI SkNx operator + (const SkNx& o) const { return _mm_add_epi16(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return _mm_sub_epi16(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return _mm_mullo_epi16(fVec, o.fVec); }
    AI SkNx operator & (const SkNx& o) const { return _mm_and_si128(fVec, o.fVec); }
    AI SkNx operator | (const SkNx& o) const { return _mm_or_si128(fVec, o.fVec); }

    AI SkNx operator << (int bits) const { return _mm_slli_epi16(fVec, bits); }
    AI SkNx operator >> (int bits) const { return _mm_srli_epi16(fVec, bits); }

    AI uint16_t operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { __m128i v; uint16_t us[8]; } pun = {fVec};
        return pun.us[k&3];
    }

    __m128i fVec;
};

template <>
class SkNx<8, uint16_t> {
public:
    AI SkNx(const __m128i& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint16_t val) : fVec(_mm_set1_epi16((short)val)) {}
    AI SkNx(uint16_t a, uint16_t b, uint16_t c, uint16_t d,
            uint16_t e, uint16_t f, uint16_t g, uint16_t h)
        : fVec(_mm_setr_epi16((short)a,(short)b,(short)c,(short)d,
                              (short)e,(short)f,(short)g,(short)h)) {}

    AI static SkNx Load(const void* ptr) { return _mm_loadu_si128((const __m128i*)ptr); }
    AI void store(void* ptr) const { _mm_storeu_si128((__m128i*)ptr, fVec); }

    AI static void Load4(const void* ptr, SkNx* r, SkNx* g, SkNx* b, SkNx* a) {
        __m128i _01 = _mm_loadu_si128(((__m128i*)ptr) + 0),
                _23 = _mm_loadu_si128(((__m128i*)ptr) + 1),
                _45 = _mm_loadu_si128(((__m128i*)ptr) + 2),
                _67 = _mm_loadu_si128(((__m128i*)ptr) + 3);

        __m128i _02 = _mm_unpacklo_epi16(_01, _23),  // r0 r2 g0 g2 b0 b2 a0 a2
                _13 = _mm_unpackhi_epi16(_01, _23),  // r1 r3 g1 g3 b1 b3 a1 a3
                _46 = _mm_unpacklo_epi16(_45, _67),
                _57 = _mm_unpackhi_epi16(_45, _67);

        __m128i rg0123 = _mm_unpacklo_epi16(_02, _13),  // r0 r1 r2 r3 g0 g1 g2 g3
                ba0123 = _mm_unpackhi_epi16(_02, _13),  // b0 b1 b2 b3 a0 a1 a2 a3
                rg4567 = _mm_unpacklo_epi16(_46, _57),
                ba4567 = _mm_unpackhi_epi16(_46, _57);

        *r = _mm_unpacklo_epi64(rg0123, rg4567);
        *g = _mm_unpackhi_epi64(rg0123, rg4567);
        *b = _mm_unpacklo_epi64(ba0123, ba4567);
        *a = _mm_unpackhi_epi64(ba0123, ba4567);
    }
    AI static void Load3(const void* ptr, SkNx* r, SkNx* g, SkNx* b) {
        const uint8_t* ptr8 = (const uint8_t*) ptr;
        __m128i rgb0 = _mm_loadu_si128((const __m128i*) (ptr8 +  0*2));
        __m128i rgb1 = _mm_srli_si128(rgb0, 3*2);
        __m128i rgb2 = _mm_loadu_si128((const __m128i*) (ptr8 +  6*2));
        __m128i rgb3 = _mm_srli_si128(rgb2, 3*2);
        __m128i rgb4 = _mm_loadu_si128((const __m128i*) (ptr8 + 12*2));
        __m128i rgb5 = _mm_srli_si128(rgb4, 3*2);
        __m128i rgb6 = _mm_srli_si128(_mm_loadu_si128((const __m128i*) (ptr8 + 16*2)), 2*2);
        __m128i rgb7 = _mm_srli_si128(rgb6, 3*2);

        __m128i rgb01 = _mm_unpacklo_epi16(rgb0, rgb1);
        __m128i rgb23 = _mm_unpacklo_epi16(rgb2, rgb3);
        __m128i rgb45 = _mm_unpacklo_epi16(rgb4, rgb5);
        __m128i rgb67 = _mm_unpacklo_epi16(rgb6, rgb7);

        __m128i rg03 = _mm_unpacklo_epi32(rgb01, rgb23);
        __m128i bx03 = _mm_unpackhi_epi32(rgb01, rgb23);
        __m128i rg47 = _mm_unpacklo_epi32(rgb45, rgb67);
        __m128i bx47 = _mm_unpackhi_epi32(rgb45, rgb67);

        *r = _mm_unpacklo_epi64(rg03, rg47);
        *g = _mm_unpackhi_epi64(rg03, rg47);
        *b = _mm_unpacklo_epi64(bx03, bx47);
    }
    AI static void Store4(void* ptr, const SkNx& r, const SkNx& g, const SkNx& b, const SkNx& a) {
        __m128i rg0123 = _mm_unpacklo_epi16(r.fVec, g.fVec),  // r0 g0 r1 g1 r2 g2 r3 g3
                rg4567 = _mm_unpackhi_epi16(r.fVec, g.fVec),  // r4 g4 r5 g5 r6 g6 r7 g7
                ba0123 = _mm_unpacklo_epi16(b.fVec, a.fVec),
                ba4567 = _mm_unpackhi_epi16(b.fVec, a.fVec);

        _mm_storeu_si128((__m128i*)ptr + 0, _mm_unpacklo_epi32(rg0123, ba0123));
        _mm_storeu_si128((__m128i*)ptr + 1, _mm_unpackhi_epi32(rg0123, ba0123));
        _mm_storeu_si128((__m128i*)ptr + 2, _mm_unpacklo_epi32(rg4567, ba4567));
        _mm_storeu_si128((__m128i*)ptr + 3, _mm_unpackhi_epi32(rg4567, ba4567));
    }

    AI SkNx operator + (const SkNx& o) const { return _mm_add_epi16(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return _mm_sub_epi16(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return _mm_mullo_epi16(fVec, o.fVec); }
    AI SkNx operator & (const SkNx& o) const { return _mm_and_si128(fVec, o.fVec); }
    AI SkNx operator | (const SkNx& o) const { return _mm_or_si128(fVec, o.fVec); }

    AI SkNx operator << (int bits) const { return _mm_slli_epi16(fVec, bits); }
    AI SkNx operator >> (int bits) const { return _mm_srli_epi16(fVec, bits); }

    AI static SkNx Min(const SkNx& a, const SkNx& b) {
        // No unsigned _mm_min_epu16, so we'll shift into a space where we can use the
        // signed version, _mm_min_epi16, then shift back.
        const uint16_t top = 0x8000; // Keep this separate from _mm_set1_epi16 or MSVC will whine.
        const __m128i top_8x = _mm_set1_epi16((short)top);
        return _mm_add_epi8(top_8x, _mm_min_epi16(_mm_sub_epi8(a.fVec, top_8x),
                                                  _mm_sub_epi8(b.fVec, top_8x)));
    }

    AI SkNx mulHi(const SkNx& m) const {
        return _mm_mulhi_epu16(fVec, m.fVec);
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return _mm_or_si128(_mm_and_si128   (fVec, t.fVec),
                            _mm_andnot_si128(fVec, e.fVec));
    }

    AI uint16_t operator[](int k) const {
        SkASSERT(0 <= k && k < 8);
        union { __m128i v; uint16_t us[8]; } pun = {fVec};
        return pun.us[k&7];
    }

    __m128i fVec;
};

template <>
class SkNx<4, uint8_t> {
public:
    AI SkNx() {}
    AI SkNx(const __m128i& vec) : fVec(vec) {}
    AI SkNx(uint8_t a, uint8_t b, uint8_t c, uint8_t d)
        : fVec(_mm_setr_epi8((char)a,(char)b,(char)c,(char)d, 0,0,0,0, 0,0,0,0, 0,0,0,0)) {}

    AI static SkNx Load(const void* ptr) { return _mm_cvtsi32_si128(*(const int*)ptr); }
    AI void store(void* ptr) const { *(int*)ptr = _mm_cvtsi128_si32(fVec); }

    AI uint8_t operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { __m128i v; uint8_t us[16]; } pun = {fVec};
        return pun.us[k&3];
    }

    // TODO as needed

    __m128i fVec;
};

template <>
class SkNx<8, uint8_t> {
public:
    AI SkNx(const __m128i& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint8_t val) : fVec(_mm_set1_epi8((char)val)) {}
    AI static SkNx Load(const void* ptr) { return _mm_loadl_epi64((const __m128i*)ptr); }
    AI SkNx(uint8_t a, uint8_t b, uint8_t c, uint8_t d,
            uint8_t e, uint8_t f, uint8_t g, uint8_t h)
            : fVec(_mm_setr_epi8((char)a,(char)b,(char)c,(char)d,
                                 (char)e,(char)f,(char)g,(char)h,
                                 0,0,0,0, 0,0,0,0)) {}

    AI void store(void* ptr) const {_mm_storel_epi64((__m128i*)ptr, fVec);}

    AI SkNx saturatedAdd(const SkNx& o) const { return _mm_adds_epu8(fVec, o.fVec); }

    AI SkNx operator + (const SkNx& o) const { return _mm_add_epi8(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return _mm_sub_epi8(fVec, o.fVec); }

    AI static SkNx Min(const SkNx& a, const SkNx& b) { return _mm_min_epu8(a.fVec, b.fVec); }
    AI SkNx operator < (const SkNx& o) const {
        // There's no unsigned _mm_cmplt_epu8, so we flip the sign bits then use a signed compare.
        auto flip = _mm_set1_epi8(char(0x80));
        return _mm_cmplt_epi8(_mm_xor_si128(flip, fVec), _mm_xor_si128(flip, o.fVec));
    }

    AI uint8_t operator[](int k) const {
        SkASSERT(0 <= k && k < 16);
        union { __m128i v; uint8_t us[16]; } pun = {fVec};
        return pun.us[k&15];
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return _mm_or_si128(_mm_and_si128   (fVec, t.fVec),
                            _mm_andnot_si128(fVec, e.fVec));
    }

    __m128i fVec;
};

template <>
class SkNx<16, uint8_t> {
public:
    AI SkNx(const __m128i& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint8_t val) : fVec(_mm_set1_epi8((char)val)) {}
    AI static SkNx Load(const void* ptr) { return _mm_loadu_si128((const __m128i*)ptr); }
    AI SkNx(uint8_t a, uint8_t b, uint8_t c, uint8_t d,
            uint8_t e, uint8_t f, uint8_t g, uint8_t h,
            uint8_t i, uint8_t j, uint8_t k, uint8_t l,
            uint8_t m, uint8_t n, uint8_t o, uint8_t p)
        : fVec(_mm_setr_epi8((char)a,(char)b,(char)c,(char)d,
                             (char)e,(char)f,(char)g,(char)h,
                             (char)i,(char)j,(char)k,(char)l,
                             (char)m,(char)n,(char)o,(char)p)) {}

    AI void store(void* ptr) const { _mm_storeu_si128((__m128i*)ptr, fVec); }

    AI SkNx saturatedAdd(const SkNx& o) const { return _mm_adds_epu8(fVec, o.fVec); }

    AI SkNx operator + (const SkNx& o) const { return _mm_add_epi8(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return _mm_sub_epi8(fVec, o.fVec); }
    AI SkNx operator & (const SkNx& o) const { return _mm_and_si128(fVec, o.fVec); }

    AI static SkNx Min(const SkNx& a, const SkNx& b) { return _mm_min_epu8(a.fVec, b.fVec); }
    AI SkNx operator < (const SkNx& o) const {
        // There's no unsigned _mm_cmplt_epu8, so we flip the sign bits then use a signed compare.
        auto flip = _mm_set1_epi8(char(0x80));
        return _mm_cmplt_epi8(_mm_xor_si128(flip, fVec), _mm_xor_si128(flip, o.fVec));
    }

    AI uint8_t operator[](int k) const {
        SkASSERT(0 <= k && k < 16);
        union { __m128i v; uint8_t us[16]; } pun = {fVec};
        return pun.us[k&15];
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return _mm_or_si128(_mm_and_si128   (fVec, t.fVec),
                            _mm_andnot_si128(fVec, e.fVec));
    }

    __m128i fVec;
};

template<> AI /*static*/ Sk4f SkNx_cast<float, int32_t>(const Sk4i& src) {
    return _mm_cvtepi32_ps(src.fVec);
}

template<> AI /*static*/ Sk4f SkNx_cast<float, uint32_t>(const Sk4u& src) {
    return SkNx_cast<float>(Sk4i::Load(&src));
}

template <> AI /*static*/ Sk4i SkNx_cast<int32_t, float>(const Sk4f& src) {
    return _mm_cvttps_epi32(src.fVec);
}

template<> AI /*static*/ Sk4h SkNx_cast<uint16_t, int32_t>(const Sk4i& src) {
#if 0 && SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE41
    // TODO: This seems to be causing code generation problems.   Investigate?
    return _mm_packus_epi32(src.fVec);
#elif SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSSE3
    // With SSSE3, we can just shuffle the low 2 bytes from each lane right into place.
    const int _ = ~0;
    return _mm_shuffle_epi8(src.fVec, _mm_setr_epi8(0,1, 4,5, 8,9, 12,13, _,_,_,_,_,_,_,_));
#else
    // With SSE2, we have to sign extend our input, making _mm_packs_epi32 do the pack we want.
    __m128i x = _mm_srai_epi32(_mm_slli_epi32(src.fVec, 16), 16);
    return _mm_packs_epi32(x,x);
#endif
}

template<> AI /*static*/ Sk4h SkNx_cast<uint16_t, float>(const Sk4f& src) {
    return SkNx_cast<uint16_t>(SkNx_cast<int32_t>(src));
}

template<> AI /*static*/ Sk4b SkNx_cast<uint8_t, float>(const Sk4f& src) {
    auto _32 = _mm_cvttps_epi32(src.fVec);
#if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSSE3
    const int _ = ~0;
    return _mm_shuffle_epi8(_32, _mm_setr_epi8(0,4,8,12, _,_,_,_, _,_,_,_, _,_,_,_));
#else
    auto _16 = _mm_packus_epi16(_32, _32);
    return     _mm_packus_epi16(_16, _16);
#endif
}

template<> AI /*static*/ Sk4u SkNx_cast<uint32_t, uint8_t>(const Sk4b& src) {
#if SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSSE3
    const int _ = ~0;
    return _mm_shuffle_epi8(src.fVec, _mm_setr_epi8(0,_,_,_, 1,_,_,_, 2,_,_,_, 3,_,_,_));
#else
    auto _16 = _mm_unpacklo_epi8(src.fVec, _mm_setzero_si128());
    return _mm_unpacklo_epi16(_16, _mm_setzero_si128());
#endif
}

template<> AI /*static*/ Sk4i SkNx_cast<int32_t, uint8_t>(const Sk4b& src) {
    return SkNx_cast<uint32_t>(src).fVec;
}

template<> AI /*static*/ Sk4f SkNx_cast<float, uint8_t>(const Sk4b& src) {
    return _mm_cvtepi32_ps(SkNx_cast<int32_t>(src).fVec);
}

template<> AI /*static*/ Sk4f SkNx_cast<float, uint16_t>(const Sk4h& src) {
    auto _32 = _mm_unpacklo_epi16(src.fVec, _mm_setzero_si128());
    return _mm_cvtepi32_ps(_32);
}

template<> AI /*static*/ Sk8b SkNx_cast<uint8_t, int32_t>(const Sk8i& src) {
    Sk4i lo, hi;
    SkNx_split(src, &lo, &hi);

    auto t = _mm_packs_epi32(lo.fVec, hi.fVec);
    return _mm_packus_epi16(t, t);
}

template<> AI /*static*/ Sk16b SkNx_cast<uint8_t, float>(const Sk16f& src) {
    Sk8f ab, cd;
    SkNx_split(src, &ab, &cd);

    Sk4f a,b,c,d;
    SkNx_split(ab, &a, &b);
    SkNx_split(cd, &c, &d);

    return _mm_packus_epi16(_mm_packus_epi16(_mm_cvttps_epi32(a.fVec),
                                             _mm_cvttps_epi32(b.fVec)),
                            _mm_packus_epi16(_mm_cvttps_epi32(c.fVec),
                                             _mm_cvttps_epi32(d.fVec)));
}

template<> AI /*static*/ Sk4h SkNx_cast<uint16_t, uint8_t>(const Sk4b& src) {
    return _mm_unpacklo_epi8(src.fVec, _mm_setzero_si128());
}

template<> AI /*static*/ Sk8h SkNx_cast<uint16_t, uint8_t>(const Sk8b& src) {
    return _mm_unpacklo_epi8(src.fVec, _mm_setzero_si128());
}

template<> AI /*static*/ Sk4b SkNx_cast<uint8_t, uint16_t>(const Sk4h& src) {
    return _mm_packus_epi16(src.fVec, src.fVec);
}

template<> AI /*static*/ Sk8b SkNx_cast<uint8_t, uint16_t>(const Sk8h& src) {
    return _mm_packus_epi16(src.fVec, src.fVec);
}

template<> AI /*static*/ Sk4i SkNx_cast<int32_t, uint16_t>(const Sk4h& src) {
    return _mm_unpacklo_epi16(src.fVec, _mm_setzero_si128());
}


template<> AI /*static*/ Sk4b SkNx_cast<uint8_t, int32_t>(const Sk4i& src) {
    return _mm_packus_epi16(_mm_packus_epi16(src.fVec, src.fVec), src.fVec);
}

template<> AI /*static*/ Sk4b SkNx_cast<uint8_t, uint32_t>(const Sk4u& src) {
    return _mm_packus_epi16(_mm_packus_epi16(src.fVec, src.fVec), src.fVec);
}

template<> AI /*static*/ Sk4i SkNx_cast<int32_t, uint32_t>(const Sk4u& src) {
    return src.fVec;
}

AI static Sk4i Sk4f_round(const Sk4f& x) {
    return _mm_cvtps_epi32(x.fVec);
}

}  // namespace

#endif//SkNx_sse_DEFINED

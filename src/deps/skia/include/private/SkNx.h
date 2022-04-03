/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkNx_DEFINED
#define SkNx_DEFINED

#include "include/core/SkScalar.h"
#include "include/core/SkTypes.h"
#include "include/private/SkSafe_math.h"

#include <algorithm>
#include <limits>
#include <type_traits>

// Every single SkNx method wants to be fully inlined.  (We know better than MSVC).
#define AI SK_ALWAYS_INLINE

namespace {  // NOLINT(google-build-namespaces)

// The default SkNx<N,T> just proxies down to a pair of SkNx<N/2, T>.
template <int N, typename T>
struct SkNx {
    typedef SkNx<N/2, T> Half;

    Half fLo, fHi;

    AI SkNx() = default;
    AI SkNx(const Half& lo, const Half& hi) : fLo(lo), fHi(hi) {}

    AI SkNx(T v) : fLo(v), fHi(v) {}

    AI SkNx(T a, T b)           : fLo(a)  , fHi(b)   { static_assert(N==2, ""); }
    AI SkNx(T a, T b, T c, T d) : fLo(a,b), fHi(c,d) { static_assert(N==4, ""); }
    AI SkNx(T a, T b, T c, T d,  T e, T f, T g, T h) : fLo(a,b,c,d), fHi(e,f,g,h) {
        static_assert(N==8, "");
    }
    AI SkNx(T a, T b, T c, T d,  T e, T f, T g, T h,
            T i, T j, T k, T l,  T m, T n, T o, T p)
        : fLo(a,b,c,d, e,f,g,h), fHi(i,j,k,l, m,n,o,p) {
        static_assert(N==16, "");
    }

    AI T operator[](int k) const {
        SkASSERT(0 <= k && k < N);
        return k < N/2 ? fLo[k] : fHi[k-N/2];
    }

    AI static SkNx Load(const void* vptr) {
        auto ptr = (const char*)vptr;
        return { Half::Load(ptr), Half::Load(ptr + N/2*sizeof(T)) };
    }
    AI void store(void* vptr) const {
        auto ptr = (char*)vptr;
        fLo.store(ptr);
        fHi.store(ptr + N/2*sizeof(T));
    }

    AI static void Load4(const void* vptr, SkNx* a, SkNx* b, SkNx* c, SkNx* d) {
        auto ptr = (const char*)vptr;
        Half al, bl, cl, dl,
             ah, bh, ch, dh;
        Half::Load4(ptr                  , &al, &bl, &cl, &dl);
        Half::Load4(ptr + 4*N/2*sizeof(T), &ah, &bh, &ch, &dh);
        *a = SkNx{al, ah};
        *b = SkNx{bl, bh};
        *c = SkNx{cl, ch};
        *d = SkNx{dl, dh};
    }
    AI static void Load3(const void* vptr, SkNx* a, SkNx* b, SkNx* c) {
        auto ptr = (const char*)vptr;
        Half al, bl, cl,
             ah, bh, ch;
        Half::Load3(ptr                  , &al, &bl, &cl);
        Half::Load3(ptr + 3*N/2*sizeof(T), &ah, &bh, &ch);
        *a = SkNx{al, ah};
        *b = SkNx{bl, bh};
        *c = SkNx{cl, ch};
    }
    AI static void Load2(const void* vptr, SkNx* a, SkNx* b) {
        auto ptr = (const char*)vptr;
        Half al, bl,
             ah, bh;
        Half::Load2(ptr                  , &al, &bl);
        Half::Load2(ptr + 2*N/2*sizeof(T), &ah, &bh);
        *a = SkNx{al, ah};
        *b = SkNx{bl, bh};
    }
    AI static void Store4(void* vptr, const SkNx& a, const SkNx& b, const SkNx& c, const SkNx& d) {
        auto ptr = (char*)vptr;
        Half::Store4(ptr,                   a.fLo, b.fLo, c.fLo, d.fLo);
        Half::Store4(ptr + 4*N/2*sizeof(T), a.fHi, b.fHi, c.fHi, d.fHi);
    }
    AI static void Store3(void* vptr, const SkNx& a, const SkNx& b, const SkNx& c) {
        auto ptr = (char*)vptr;
        Half::Store3(ptr,                   a.fLo, b.fLo, c.fLo);
        Half::Store3(ptr + 3*N/2*sizeof(T), a.fHi, b.fHi, c.fHi);
    }
    AI static void Store2(void* vptr, const SkNx& a, const SkNx& b) {
        auto ptr = (char*)vptr;
        Half::Store2(ptr,                   a.fLo, b.fLo);
        Half::Store2(ptr + 2*N/2*sizeof(T), a.fHi, b.fHi);
    }

    AI T min() const { return std::min(fLo.min(), fHi.min()); }
    AI T max() const { return std::max(fLo.max(), fHi.max()); }
    AI bool anyTrue() const { return fLo.anyTrue() || fHi.anyTrue(); }
    AI bool allTrue() const { return fLo.allTrue() && fHi.allTrue(); }

    AI SkNx    abs() const { return { fLo.   abs(), fHi.   abs() }; }
    AI SkNx   sqrt() const { return { fLo.  sqrt(), fHi.  sqrt() }; }
    AI SkNx  floor() const { return { fLo. floor(), fHi. floor() }; }

    AI SkNx operator!() const { return { !fLo, !fHi }; }
    AI SkNx operator-() const { return { -fLo, -fHi }; }
    AI SkNx operator~() const { return { ~fLo, ~fHi }; }

    AI SkNx operator<<(int bits) const { return { fLo << bits, fHi << bits }; }
    AI SkNx operator>>(int bits) const { return { fLo >> bits, fHi >> bits }; }

    AI SkNx operator+(const SkNx& y) const { return { fLo + y.fLo, fHi + y.fHi }; }
    AI SkNx operator-(const SkNx& y) const { return { fLo - y.fLo, fHi - y.fHi }; }
    AI SkNx operator*(const SkNx& y) const { return { fLo * y.fLo, fHi * y.fHi }; }
    AI SkNx operator/(const SkNx& y) const { return { fLo / y.fLo, fHi / y.fHi }; }

    AI SkNx operator&(const SkNx& y) const { return { fLo & y.fLo, fHi & y.fHi }; }
    AI SkNx operator|(const SkNx& y) const { return { fLo | y.fLo, fHi | y.fHi }; }
    AI SkNx operator^(const SkNx& y) const { return { fLo ^ y.fLo, fHi ^ y.fHi }; }

    AI SkNx operator==(const SkNx& y) const { return { fLo == y.fLo, fHi == y.fHi }; }
    AI SkNx operator!=(const SkNx& y) const { return { fLo != y.fLo, fHi != y.fHi }; }
    AI SkNx operator<=(const SkNx& y) const { return { fLo <= y.fLo, fHi <= y.fHi }; }
    AI SkNx operator>=(const SkNx& y) const { return { fLo >= y.fLo, fHi >= y.fHi }; }
    AI SkNx operator< (const SkNx& y) const { return { fLo <  y.fLo, fHi <  y.fHi }; }
    AI SkNx operator> (const SkNx& y) const { return { fLo >  y.fLo, fHi >  y.fHi }; }

    AI SkNx saturatedAdd(const SkNx& y) const {
        return { fLo.saturatedAdd(y.fLo), fHi.saturatedAdd(y.fHi) };
    }

    AI SkNx mulHi(const SkNx& m) const {
        return { fLo.mulHi(m.fLo), fHi.mulHi(m.fHi) };
    }
    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return { fLo.thenElse(t.fLo, e.fLo), fHi.thenElse(t.fHi, e.fHi) };
    }
    AI static SkNx Min(const SkNx& x, const SkNx& y) {
        return { Half::Min(x.fLo, y.fLo), Half::Min(x.fHi, y.fHi) };
    }
    AI static SkNx Max(const SkNx& x, const SkNx& y) {
        return { Half::Max(x.fLo, y.fLo), Half::Max(x.fHi, y.fHi) };
    }
};

// The N -> N/2 recursion bottoms out at N == 1, a scalar value.
template <typename T>
struct SkNx<1,T> {
    T fVal;

    AI SkNx() = default;
    AI SkNx(T v) : fVal(v) {}

    // Android complains against unused parameters, so we guard it
    AI T operator[](int SkDEBUGCODE(k)) const {
        SkASSERT(k == 0);
        return fVal;
    }

    AI static SkNx Load(const void* ptr) {
        SkNx v;
        memcpy(&v, ptr, sizeof(T));
        return v;
    }
    AI void store(void* ptr) const { memcpy(ptr, &fVal, sizeof(T)); }

    AI static void Load4(const void* vptr, SkNx* a, SkNx* b, SkNx* c, SkNx* d) {
        auto ptr = (const char*)vptr;
        *a = Load(ptr + 0*sizeof(T));
        *b = Load(ptr + 1*sizeof(T));
        *c = Load(ptr + 2*sizeof(T));
        *d = Load(ptr + 3*sizeof(T));
    }
    AI static void Load3(const void* vptr, SkNx* a, SkNx* b, SkNx* c) {
        auto ptr = (const char*)vptr;
        *a = Load(ptr + 0*sizeof(T));
        *b = Load(ptr + 1*sizeof(T));
        *c = Load(ptr + 2*sizeof(T));
    }
    AI static void Load2(const void* vptr, SkNx* a, SkNx* b) {
        auto ptr = (const char*)vptr;
        *a = Load(ptr + 0*sizeof(T));
        *b = Load(ptr + 1*sizeof(T));
    }
    AI static void Store4(void* vptr, const SkNx& a, const SkNx& b, const SkNx& c, const SkNx& d) {
        auto ptr = (char*)vptr;
        a.store(ptr + 0*sizeof(T));
        b.store(ptr + 1*sizeof(T));
        c.store(ptr + 2*sizeof(T));
        d.store(ptr + 3*sizeof(T));
    }
    AI static void Store3(void* vptr, const SkNx& a, const SkNx& b, const SkNx& c) {
        auto ptr = (char*)vptr;
        a.store(ptr + 0*sizeof(T));
        b.store(ptr + 1*sizeof(T));
        c.store(ptr + 2*sizeof(T));
    }
    AI static void Store2(void* vptr, const SkNx& a, const SkNx& b) {
        auto ptr = (char*)vptr;
        a.store(ptr + 0*sizeof(T));
        b.store(ptr + 1*sizeof(T));
    }

    AI T min() const { return fVal; }
    AI T max() const { return fVal; }
    AI bool anyTrue() const { return fVal != 0; }
    AI bool allTrue() const { return fVal != 0; }

    AI SkNx    abs() const { return Abs(fVal); }
    AI SkNx   sqrt() const { return Sqrt(fVal); }
    AI SkNx  floor() const { return Floor(fVal); }

    AI SkNx operator!() const { return !fVal; }
    AI SkNx operator-() const { return -fVal; }
    AI SkNx operator~() const { return FromBits(~ToBits(fVal)); }

    AI SkNx operator<<(int bits) const { return fVal << bits; }
    AI SkNx operator>>(int bits) const { return fVal >> bits; }

    AI SkNx operator+(const SkNx& y) const { return fVal + y.fVal; }
    AI SkNx operator-(const SkNx& y) const { return fVal - y.fVal; }
    AI SkNx operator*(const SkNx& y) const { return fVal * y.fVal; }
    AI SkNx operator/(const SkNx& y) const { return fVal / y.fVal; }

    AI SkNx operator&(const SkNx& y) const { return FromBits(ToBits(fVal) & ToBits(y.fVal)); }
    AI SkNx operator|(const SkNx& y) const { return FromBits(ToBits(fVal) | ToBits(y.fVal)); }
    AI SkNx operator^(const SkNx& y) const { return FromBits(ToBits(fVal) ^ ToBits(y.fVal)); }

    AI SkNx operator==(const SkNx& y) const { return FromBits(fVal == y.fVal ? ~0 : 0); }
    AI SkNx operator!=(const SkNx& y) const { return FromBits(fVal != y.fVal ? ~0 : 0); }
    AI SkNx operator<=(const SkNx& y) const { return FromBits(fVal <= y.fVal ? ~0 : 0); }
    AI SkNx operator>=(const SkNx& y) const { return FromBits(fVal >= y.fVal ? ~0 : 0); }
    AI SkNx operator< (const SkNx& y) const { return FromBits(fVal <  y.fVal ? ~0 : 0); }
    AI SkNx operator> (const SkNx& y) const { return FromBits(fVal >  y.fVal ? ~0 : 0); }

    AI static SkNx Min(const SkNx& x, const SkNx& y) { return x.fVal < y.fVal ? x : y; }
    AI static SkNx Max(const SkNx& x, const SkNx& y) { return x.fVal > y.fVal ? x : y; }

    AI SkNx saturatedAdd(const SkNx& y) const {
        static_assert(std::is_unsigned<T>::value, "");
        T sum = fVal + y.fVal;
        return sum < fVal ? std::numeric_limits<T>::max() : sum;
    }

    AI SkNx mulHi(const SkNx& m) const {
        static_assert(std::is_unsigned<T>::value, "");
        static_assert(sizeof(T) <= 4, "");
        return static_cast<T>((static_cast<uint64_t>(fVal) * m.fVal) >> (sizeof(T)*8));
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const { return fVal != 0 ? t : e; }

private:
    // Helper functions to choose the right float/double methods.  (In <cmath> madness lies...)
    AI static int     Abs(int val) { return  val < 0 ? -val : val; }

    AI static float   Abs(float val) { return  ::fabsf(val); }
    AI static float  Sqrt(float val) { return  ::sqrtf(val); }
    AI static float Floor(float val) { return ::floorf(val); }

    AI static double   Abs(double val) { return  ::fabs(val); }
    AI static double  Sqrt(double val) { return  ::sqrt(val); }
    AI static double Floor(double val) { return ::floor(val); }

    // Helper functions for working with floats/doubles as bit patterns.
    template <typename U>
    AI static U ToBits(U v) { return v; }
    AI static int32_t ToBits(float  v) { int32_t bits; memcpy(&bits, &v, sizeof(v)); return bits; }
    AI static int64_t ToBits(double v) { int64_t bits; memcpy(&bits, &v, sizeof(v)); return bits; }

    template <typename Bits>
    AI static T FromBits(Bits bits) {
        static_assert(std::is_pod<T   >::value &&
                      std::is_pod<Bits>::value &&
                      sizeof(T) <= sizeof(Bits), "");
        T val;
        memcpy(&val, &bits, sizeof(T));
        return val;
    }
};

// Allow scalars on the left or right of binary operators, and things like +=, &=, etc.
#define V template <int N, typename T> AI static SkNx<N,T>
    V operator+ (T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) +  y; }
    V operator- (T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) -  y; }
    V operator* (T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) *  y; }
    V operator/ (T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) /  y; }
    V operator& (T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) &  y; }
    V operator| (T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) |  y; }
    V operator^ (T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) ^  y; }
    V operator==(T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) == y; }
    V operator!=(T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) != y; }
    V operator<=(T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) <= y; }
    V operator>=(T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) >= y; }
    V operator< (T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) <  y; }
    V operator> (T x, const SkNx<N,T>& y) { return SkNx<N,T>(x) >  y; }

    V operator+ (const SkNx<N,T>& x, T y) { return x +  SkNx<N,T>(y); }
    V operator- (const SkNx<N,T>& x, T y) { return x -  SkNx<N,T>(y); }
    V operator* (const SkNx<N,T>& x, T y) { return x *  SkNx<N,T>(y); }
    V operator/ (const SkNx<N,T>& x, T y) { return x /  SkNx<N,T>(y); }
    V operator& (const SkNx<N,T>& x, T y) { return x &  SkNx<N,T>(y); }
    V operator| (const SkNx<N,T>& x, T y) { return x |  SkNx<N,T>(y); }
    V operator^ (const SkNx<N,T>& x, T y) { return x ^  SkNx<N,T>(y); }
    V operator==(const SkNx<N,T>& x, T y) { return x == SkNx<N,T>(y); }
    V operator!=(const SkNx<N,T>& x, T y) { return x != SkNx<N,T>(y); }
    V operator<=(const SkNx<N,T>& x, T y) { return x <= SkNx<N,T>(y); }
    V operator>=(const SkNx<N,T>& x, T y) { return x >= SkNx<N,T>(y); }
    V operator< (const SkNx<N,T>& x, T y) { return x <  SkNx<N,T>(y); }
    V operator> (const SkNx<N,T>& x, T y) { return x >  SkNx<N,T>(y); }

    V& operator<<=(SkNx<N,T>& x, int bits) { return (x = x << bits); }
    V& operator>>=(SkNx<N,T>& x, int bits) { return (x = x >> bits); }

    V& operator +=(SkNx<N,T>& x, const SkNx<N,T>& y) { return (x = x + y); }
    V& operator -=(SkNx<N,T>& x, const SkNx<N,T>& y) { return (x = x - y); }
    V& operator *=(SkNx<N,T>& x, const SkNx<N,T>& y) { return (x = x * y); }
    V& operator /=(SkNx<N,T>& x, const SkNx<N,T>& y) { return (x = x / y); }
    V& operator &=(SkNx<N,T>& x, const SkNx<N,T>& y) { return (x = x & y); }
    V& operator |=(SkNx<N,T>& x, const SkNx<N,T>& y) { return (x = x | y); }
    V& operator ^=(SkNx<N,T>& x, const SkNx<N,T>& y) { return (x = x ^ y); }

    V& operator +=(SkNx<N,T>& x, T y) { return (x = x + SkNx<N,T>(y)); }
    V& operator -=(SkNx<N,T>& x, T y) { return (x = x - SkNx<N,T>(y)); }
    V& operator *=(SkNx<N,T>& x, T y) { return (x = x * SkNx<N,T>(y)); }
    V& operator /=(SkNx<N,T>& x, T y) { return (x = x / SkNx<N,T>(y)); }
    V& operator &=(SkNx<N,T>& x, T y) { return (x = x & SkNx<N,T>(y)); }
    V& operator |=(SkNx<N,T>& x, T y) { return (x = x | SkNx<N,T>(y)); }
    V& operator ^=(SkNx<N,T>& x, T y) { return (x = x ^ SkNx<N,T>(y)); }
#undef V

// SkNx<N,T> ~~> SkNx<N/2,T> + SkNx<N/2,T>
template <int N, typename T>
AI static void SkNx_split(const SkNx<N,T>& v, SkNx<N/2,T>* lo, SkNx<N/2,T>* hi) {
    *lo = v.fLo;
    *hi = v.fHi;
}

// SkNx<N/2,T> + SkNx<N/2,T> ~~> SkNx<N,T>
template <int N, typename T>
AI static SkNx<N*2,T> SkNx_join(const SkNx<N,T>& lo, const SkNx<N,T>& hi) {
    return { lo, hi };
}

// A very generic shuffle.  Can reorder, duplicate, contract, expand...
//    Sk4f v = { R,G,B,A };
//    SkNx_shuffle<2,1,0,3>(v)         ~~> {B,G,R,A}
//    SkNx_shuffle<2,1>(v)             ~~> {B,G}
//    SkNx_shuffle<2,1,2,1,2,1,2,1>(v) ~~> {B,G,B,G,B,G,B,G}
//    SkNx_shuffle<3,3,3,3>(v)         ~~> {A,A,A,A}
template <int... Ix, int N, typename T>
AI static SkNx<sizeof...(Ix),T> SkNx_shuffle(const SkNx<N,T>& v) {
    return { v[Ix]... };
}

// Cast from SkNx<N, Src> to SkNx<N, Dst>, as if you called static_cast<Dst>(Src).
template <typename Dst, typename Src, int N>
AI static SkNx<N,Dst> SkNx_cast(const SkNx<N,Src>& v) {
    return { SkNx_cast<Dst>(v.fLo), SkNx_cast<Dst>(v.fHi) };
}
template <typename Dst, typename Src>
AI static SkNx<1,Dst> SkNx_cast(const SkNx<1,Src>& v) {
    return static_cast<Dst>(v.fVal);
}

template <int N, typename T>
AI static SkNx<N,T> SkNx_fma(const SkNx<N,T>& f, const SkNx<N,T>& m, const SkNx<N,T>& a) {
    return f*m+a;
}

}  // namespace

typedef SkNx<2,     float> Sk2f;
typedef SkNx<4,     float> Sk4f;
typedef SkNx<8,     float> Sk8f;
typedef SkNx<16,    float> Sk16f;

typedef SkNx<2,  SkScalar> Sk2s;
typedef SkNx<4,  SkScalar> Sk4s;
typedef SkNx<8,  SkScalar> Sk8s;
typedef SkNx<16, SkScalar> Sk16s;

typedef SkNx<4,   uint8_t> Sk4b;
typedef SkNx<8,   uint8_t> Sk8b;
typedef SkNx<16,  uint8_t> Sk16b;

typedef SkNx<4,  uint16_t> Sk4h;
typedef SkNx<8,  uint16_t> Sk8h;
typedef SkNx<16, uint16_t> Sk16h;

typedef SkNx<4,  int32_t> Sk4i;
typedef SkNx<8,  int32_t> Sk8i;
typedef SkNx<4, uint32_t> Sk4u;

// Include platform specific specializations if available.
#if !defined(SKNX_NO_SIMD) && SK_CPU_SSE_LEVEL >= SK_CPU_SSE_LEVEL_SSE2
    #include "include/private/SkNx_sse.h"
#elif !defined(SKNX_NO_SIMD) && defined(SK_ARM_HAS_NEON)
    #include "include/private/SkNx_neon.h"
#else

AI static Sk4i Sk4f_round(const Sk4f& x) {
    return { (int) lrintf (x[0]),
             (int) lrintf (x[1]),
             (int) lrintf (x[2]),
             (int) lrintf (x[3]), };
}

#endif

AI static void Sk4f_ToBytes(uint8_t p[16],
                            const Sk4f& a, const Sk4f& b, const Sk4f& c, const Sk4f& d) {
    SkNx_cast<uint8_t>(SkNx_join(SkNx_join(a,b), SkNx_join(c,d))).store(p);
}

#undef AI

#endif//SkNx_DEFINED

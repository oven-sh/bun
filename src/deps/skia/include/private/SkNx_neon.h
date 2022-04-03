/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkNx_neon_DEFINED
#define SkNx_neon_DEFINED

#include <arm_neon.h>

namespace {  // NOLINT(google-build-namespaces)

// ARMv8 has vrndm(q)_f32 to floor floats.  Here we emulate it:
//   - roundtrip through integers via truncation
//   - subtract 1 if that's too big (possible for negative values).
// This restricts the domain of our inputs to a maximum somehwere around 2^31.  Seems plenty big.
AI static float32x4_t emulate_vrndmq_f32(float32x4_t v) {
    auto roundtrip = vcvtq_f32_s32(vcvtq_s32_f32(v));
    auto too_big = vcgtq_f32(roundtrip, v);
    return vsubq_f32(roundtrip, (float32x4_t)vandq_u32(too_big, (uint32x4_t)vdupq_n_f32(1)));
}
AI static float32x2_t emulate_vrndm_f32(float32x2_t v) {
    auto roundtrip = vcvt_f32_s32(vcvt_s32_f32(v));
    auto too_big = vcgt_f32(roundtrip, v);
    return vsub_f32(roundtrip, (float32x2_t)vand_u32(too_big, (uint32x2_t)vdup_n_f32(1)));
}

template <>
class SkNx<2, float> {
public:
    AI SkNx(float32x2_t vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(float val) : fVec(vdup_n_f32(val)) {}
    AI SkNx(float a, float b) { fVec = (float32x2_t) { a, b }; }

    AI static SkNx Load(const void* ptr) { return vld1_f32((const float*)ptr); }
    AI void store(void* ptr) const { vst1_f32((float*)ptr, fVec); }

    AI static void Load2(const void* ptr, SkNx* x, SkNx* y) {
        float32x2x2_t xy = vld2_f32((const float*) ptr);
        *x = xy.val[0];
        *y = xy.val[1];
    }

    AI static void Store2(void* dst, const SkNx& a, const SkNx& b) {
        float32x2x2_t ab = {{
            a.fVec,
            b.fVec,
        }};
        vst2_f32((float*) dst, ab);
    }

    AI static void Store3(void* dst, const SkNx& a, const SkNx& b, const SkNx& c) {
        float32x2x3_t abc = {{
            a.fVec,
            b.fVec,
            c.fVec,
        }};
        vst3_f32((float*) dst, abc);
    }

    AI static void Store4(void* dst, const SkNx& a, const SkNx& b, const SkNx& c, const SkNx& d) {
        float32x2x4_t abcd = {{
            a.fVec,
            b.fVec,
            c.fVec,
            d.fVec,
        }};
        vst4_f32((float*) dst, abcd);
    }

    AI SkNx operator - () const { return vneg_f32(fVec); }

    AI SkNx operator + (const SkNx& o) const { return vadd_f32(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return vsub_f32(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return vmul_f32(fVec, o.fVec); }
    AI SkNx operator / (const SkNx& o) const {
    #if defined(SK_CPU_ARM64)
        return vdiv_f32(fVec, o.fVec);
    #else
        float32x2_t est0 = vrecpe_f32(o.fVec),
                    est1 = vmul_f32(vrecps_f32(est0, o.fVec), est0),
                    est2 = vmul_f32(vrecps_f32(est1, o.fVec), est1);
        return vmul_f32(fVec, est2);
    #endif
    }

    AI SkNx operator==(const SkNx& o) const { return vreinterpret_f32_u32(vceq_f32(fVec, o.fVec)); }
    AI SkNx operator <(const SkNx& o) const { return vreinterpret_f32_u32(vclt_f32(fVec, o.fVec)); }
    AI SkNx operator >(const SkNx& o) const { return vreinterpret_f32_u32(vcgt_f32(fVec, o.fVec)); }
    AI SkNx operator<=(const SkNx& o) const { return vreinterpret_f32_u32(vcle_f32(fVec, o.fVec)); }
    AI SkNx operator>=(const SkNx& o) const { return vreinterpret_f32_u32(vcge_f32(fVec, o.fVec)); }
    AI SkNx operator!=(const SkNx& o) const {
        return vreinterpret_f32_u32(vmvn_u32(vceq_f32(fVec, o.fVec)));
    }

    AI static SkNx Min(const SkNx& l, const SkNx& r) { return vmin_f32(l.fVec, r.fVec); }
    AI static SkNx Max(const SkNx& l, const SkNx& r) { return vmax_f32(l.fVec, r.fVec); }

    AI SkNx abs() const { return vabs_f32(fVec); }
    AI SkNx floor() const {
    #if defined(SK_CPU_ARM64)
        return vrndm_f32(fVec);
    #else
        return emulate_vrndm_f32(fVec);
    #endif
    }

    AI SkNx sqrt() const {
    #if defined(SK_CPU_ARM64)
        return vsqrt_f32(fVec);
    #else
        float32x2_t est0 = vrsqrte_f32(fVec),
                    est1 = vmul_f32(vrsqrts_f32(fVec, vmul_f32(est0, est0)), est0),
                    est2 = vmul_f32(vrsqrts_f32(fVec, vmul_f32(est1, est1)), est1);
        return vmul_f32(fVec, est2);
    #endif
    }

    AI float operator[](int k) const {
        SkASSERT(0 <= k && k < 2);
        union { float32x2_t v; float fs[2]; } pun = {fVec};
        return pun.fs[k&1];
    }

    AI bool allTrue() const {
    #if defined(SK_CPU_ARM64)
        return 0 != vminv_u32(vreinterpret_u32_f32(fVec));
    #else
        auto v = vreinterpret_u32_f32(fVec);
        return vget_lane_u32(v,0) && vget_lane_u32(v,1);
    #endif
    }
    AI bool anyTrue() const {
    #if defined(SK_CPU_ARM64)
        return 0 != vmaxv_u32(vreinterpret_u32_f32(fVec));
    #else
        auto v = vreinterpret_u32_f32(fVec);
        return vget_lane_u32(v,0) || vget_lane_u32(v,1);
    #endif
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return vbsl_f32(vreinterpret_u32_f32(fVec), t.fVec, e.fVec);
    }

    float32x2_t fVec;
};

template <>
class SkNx<4, float> {
public:
    AI SkNx(float32x4_t vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(float val) : fVec(vdupq_n_f32(val)) {}
    AI SkNx(float a, float b, float c, float d) { fVec = (float32x4_t) { a, b, c, d }; }

    AI static SkNx Load(const void* ptr) { return vld1q_f32((const float*)ptr); }
    AI void store(void* ptr) const { vst1q_f32((float*)ptr, fVec); }

    AI static void Load2(const void* ptr, SkNx* x, SkNx* y) {
        float32x4x2_t xy = vld2q_f32((const float*) ptr);
        *x = xy.val[0];
        *y = xy.val[1];
    }

    AI static void Load4(const void* ptr, SkNx* r, SkNx* g, SkNx* b, SkNx* a) {
        float32x4x4_t rgba = vld4q_f32((const float*) ptr);
        *r = rgba.val[0];
        *g = rgba.val[1];
        *b = rgba.val[2];
        *a = rgba.val[3];
    }
    AI static void Store4(void* dst, const SkNx& r, const SkNx& g, const SkNx& b, const SkNx& a) {
        float32x4x4_t rgba = {{
            r.fVec,
            g.fVec,
            b.fVec,
            a.fVec,
        }};
        vst4q_f32((float*) dst, rgba);
    }

    AI SkNx operator - () const { return vnegq_f32(fVec); }

    AI SkNx operator + (const SkNx& o) const { return vaddq_f32(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return vsubq_f32(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return vmulq_f32(fVec, o.fVec); }
    AI SkNx operator / (const SkNx& o) const {
    #if defined(SK_CPU_ARM64)
        return vdivq_f32(fVec, o.fVec);
    #else
        float32x4_t est0 = vrecpeq_f32(o.fVec),
                    est1 = vmulq_f32(vrecpsq_f32(est0, o.fVec), est0),
                    est2 = vmulq_f32(vrecpsq_f32(est1, o.fVec), est1);
        return vmulq_f32(fVec, est2);
    #endif
    }

    AI SkNx operator==(const SkNx& o) const {return vreinterpretq_f32_u32(vceqq_f32(fVec, o.fVec));}
    AI SkNx operator <(const SkNx& o) const {return vreinterpretq_f32_u32(vcltq_f32(fVec, o.fVec));}
    AI SkNx operator >(const SkNx& o) const {return vreinterpretq_f32_u32(vcgtq_f32(fVec, o.fVec));}
    AI SkNx operator<=(const SkNx& o) const {return vreinterpretq_f32_u32(vcleq_f32(fVec, o.fVec));}
    AI SkNx operator>=(const SkNx& o) const {return vreinterpretq_f32_u32(vcgeq_f32(fVec, o.fVec));}
    AI SkNx operator!=(const SkNx& o) const {
        return vreinterpretq_f32_u32(vmvnq_u32(vceqq_f32(fVec, o.fVec)));
    }

    AI static SkNx Min(const SkNx& l, const SkNx& r) { return vminq_f32(l.fVec, r.fVec); }
    AI static SkNx Max(const SkNx& l, const SkNx& r) { return vmaxq_f32(l.fVec, r.fVec); }

    AI SkNx abs() const { return vabsq_f32(fVec); }
    AI SkNx floor() const {
    #if defined(SK_CPU_ARM64)
        return vrndmq_f32(fVec);
    #else
        return emulate_vrndmq_f32(fVec);
    #endif
    }


    AI SkNx sqrt() const {
    #if defined(SK_CPU_ARM64)
        return vsqrtq_f32(fVec);
    #else
        float32x4_t est0 = vrsqrteq_f32(fVec),
                    est1 = vmulq_f32(vrsqrtsq_f32(fVec, vmulq_f32(est0, est0)), est0),
                    est2 = vmulq_f32(vrsqrtsq_f32(fVec, vmulq_f32(est1, est1)), est1);
        return vmulq_f32(fVec, est2);
    #endif
    }

    AI float operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { float32x4_t v; float fs[4]; } pun = {fVec};
        return pun.fs[k&3];
    }

    AI float min() const {
    #if defined(SK_CPU_ARM64)
        return vminvq_f32(fVec);
    #else
        SkNx min = Min(*this, vrev64q_f32(fVec));
        return std::min(min[0], min[2]);
    #endif
    }

    AI float max() const {
    #if defined(SK_CPU_ARM64)
        return vmaxvq_f32(fVec);
    #else
        SkNx max = Max(*this, vrev64q_f32(fVec));
        return std::max(max[0], max[2]);
    #endif
    }

    AI bool allTrue() const {
    #if defined(SK_CPU_ARM64)
        return 0 != vminvq_u32(vreinterpretq_u32_f32(fVec));
    #else
        auto v = vreinterpretq_u32_f32(fVec);
        return vgetq_lane_u32(v,0) && vgetq_lane_u32(v,1)
            && vgetq_lane_u32(v,2) && vgetq_lane_u32(v,3);
    #endif
    }
    AI bool anyTrue() const {
    #if defined(SK_CPU_ARM64)
        return 0 != vmaxvq_u32(vreinterpretq_u32_f32(fVec));
    #else
        auto v = vreinterpretq_u32_f32(fVec);
        return vgetq_lane_u32(v,0) || vgetq_lane_u32(v,1)
            || vgetq_lane_u32(v,2) || vgetq_lane_u32(v,3);
    #endif
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return vbslq_f32(vreinterpretq_u32_f32(fVec), t.fVec, e.fVec);
    }

    float32x4_t fVec;
};

#if defined(SK_CPU_ARM64)
    AI static Sk4f SkNx_fma(const Sk4f& f, const Sk4f& m, const Sk4f& a) {
        return vfmaq_f32(a.fVec, f.fVec, m.fVec);
    }
#endif

// It's possible that for our current use cases, representing this as
// half a uint16x8_t might be better than representing it as a uint16x4_t.
// It'd make conversion to Sk4b one step simpler.
template <>
class SkNx<4, uint16_t> {
public:
    AI SkNx(const uint16x4_t& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint16_t val) : fVec(vdup_n_u16(val)) {}
    AI SkNx(uint16_t a, uint16_t b, uint16_t c, uint16_t d) {
        fVec = (uint16x4_t) { a,b,c,d };
    }

    AI static SkNx Load(const void* ptr) { return vld1_u16((const uint16_t*)ptr); }
    AI void store(void* ptr) const { vst1_u16((uint16_t*)ptr, fVec); }

    AI static void Load4(const void* ptr, SkNx* r, SkNx* g, SkNx* b, SkNx* a) {
        uint16x4x4_t rgba = vld4_u16((const uint16_t*)ptr);
        *r = rgba.val[0];
        *g = rgba.val[1];
        *b = rgba.val[2];
        *a = rgba.val[3];
    }
    AI static void Load3(const void* ptr, SkNx* r, SkNx* g, SkNx* b) {
        uint16x4x3_t rgba = vld3_u16((const uint16_t*)ptr);
        *r = rgba.val[0];
        *g = rgba.val[1];
        *b = rgba.val[2];
    }
    AI static void Store4(void* dst, const SkNx& r, const SkNx& g, const SkNx& b, const SkNx& a) {
        uint16x4x4_t rgba = {{
            r.fVec,
            g.fVec,
            b.fVec,
            a.fVec,
        }};
        vst4_u16((uint16_t*) dst, rgba);
    }

    AI SkNx operator + (const SkNx& o) const { return vadd_u16(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return vsub_u16(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return vmul_u16(fVec, o.fVec); }
    AI SkNx operator & (const SkNx& o) const { return vand_u16(fVec, o.fVec); }
    AI SkNx operator | (const SkNx& o) const { return vorr_u16(fVec, o.fVec); }

    AI SkNx operator << (int bits) const { return fVec << SkNx(bits).fVec; }
    AI SkNx operator >> (int bits) const { return fVec >> SkNx(bits).fVec; }

    AI static SkNx Min(const SkNx& a, const SkNx& b) { return vmin_u16(a.fVec, b.fVec); }

    AI uint16_t operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { uint16x4_t v; uint16_t us[4]; } pun = {fVec};
        return pun.us[k&3];
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return vbsl_u16(fVec, t.fVec, e.fVec);
    }

    uint16x4_t fVec;
};

template <>
class SkNx<8, uint16_t> {
public:
    AI SkNx(const uint16x8_t& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint16_t val) : fVec(vdupq_n_u16(val)) {}
    AI static SkNx Load(const void* ptr) { return vld1q_u16((const uint16_t*)ptr); }

    AI SkNx(uint16_t a, uint16_t b, uint16_t c, uint16_t d,
            uint16_t e, uint16_t f, uint16_t g, uint16_t h) {
        fVec = (uint16x8_t) { a,b,c,d, e,f,g,h };
    }

    AI void store(void* ptr) const { vst1q_u16((uint16_t*)ptr, fVec); }

    AI SkNx operator + (const SkNx& o) const { return vaddq_u16(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return vsubq_u16(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return vmulq_u16(fVec, o.fVec); }
    AI SkNx operator & (const SkNx& o) const { return vandq_u16(fVec, o.fVec); }
    AI SkNx operator | (const SkNx& o) const { return vorrq_u16(fVec, o.fVec); }

    AI SkNx operator << (int bits) const { return fVec << SkNx(bits).fVec; }
    AI SkNx operator >> (int bits) const { return fVec >> SkNx(bits).fVec; }

    AI static SkNx Min(const SkNx& a, const SkNx& b) { return vminq_u16(a.fVec, b.fVec); }

    AI uint16_t operator[](int k) const {
        SkASSERT(0 <= k && k < 8);
        union { uint16x8_t v; uint16_t us[8]; } pun = {fVec};
        return pun.us[k&7];
    }

    AI SkNx mulHi(const SkNx& m) const {
        uint32x4_t hi = vmull_u16(vget_high_u16(fVec), vget_high_u16(m.fVec));
        uint32x4_t lo = vmull_u16( vget_low_u16(fVec),  vget_low_u16(m.fVec));

        return { vcombine_u16(vshrn_n_u32(lo,16), vshrn_n_u32(hi,16)) };
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return vbslq_u16(fVec, t.fVec, e.fVec);
    }

    uint16x8_t fVec;
};

template <>
class SkNx<4, uint8_t> {
public:
    typedef uint32_t __attribute__((aligned(1))) unaligned_uint32_t;

    AI SkNx(const uint8x8_t& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint8_t a, uint8_t b, uint8_t c, uint8_t d) {
        fVec = (uint8x8_t){a,b,c,d, 0,0,0,0};
    }
    AI static SkNx Load(const void* ptr) {
        return (uint8x8_t)vld1_dup_u32((const unaligned_uint32_t*)ptr);
    }
    AI void store(void* ptr) const {
        return vst1_lane_u32((unaligned_uint32_t*)ptr, (uint32x2_t)fVec, 0);
    }
    AI uint8_t operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { uint8x8_t v; uint8_t us[8]; } pun = {fVec};
        return pun.us[k&3];
    }

    // TODO as needed

    uint8x8_t fVec;
};

template <>
class SkNx<8, uint8_t> {
public:
    AI SkNx(const uint8x8_t& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint8_t val) : fVec(vdup_n_u8(val)) {}
    AI SkNx(uint8_t a, uint8_t b, uint8_t c, uint8_t d,
            uint8_t e, uint8_t f, uint8_t g, uint8_t h) {
        fVec = (uint8x8_t) { a,b,c,d, e,f,g,h };
    }

    AI static SkNx Load(const void* ptr) { return vld1_u8((const uint8_t*)ptr); }
    AI void store(void* ptr) const { vst1_u8((uint8_t*)ptr, fVec); }

    AI uint8_t operator[](int k) const {
        SkASSERT(0 <= k && k < 8);
        union { uint8x8_t v; uint8_t us[8]; } pun = {fVec};
        return pun.us[k&7];
    }

    uint8x8_t fVec;
};

template <>
class SkNx<16, uint8_t> {
public:
    AI SkNx(const uint8x16_t& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint8_t val) : fVec(vdupq_n_u8(val)) {}
    AI SkNx(uint8_t a, uint8_t b, uint8_t c, uint8_t d,
            uint8_t e, uint8_t f, uint8_t g, uint8_t h,
            uint8_t i, uint8_t j, uint8_t k, uint8_t l,
            uint8_t m, uint8_t n, uint8_t o, uint8_t p) {
        fVec = (uint8x16_t) { a,b,c,d, e,f,g,h, i,j,k,l, m,n,o,p };
    }

    AI static SkNx Load(const void* ptr) { return vld1q_u8((const uint8_t*)ptr); }
    AI void store(void* ptr) const { vst1q_u8((uint8_t*)ptr, fVec); }

    AI SkNx saturatedAdd(const SkNx& o) const { return vqaddq_u8(fVec, o.fVec); }

    AI SkNx operator + (const SkNx& o) const { return vaddq_u8(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return vsubq_u8(fVec, o.fVec); }
    AI SkNx operator & (const SkNx& o) const { return vandq_u8(fVec, o.fVec); }

    AI static SkNx Min(const SkNx& a, const SkNx& b) { return vminq_u8(a.fVec, b.fVec); }
    AI SkNx operator < (const SkNx& o) const { return vcltq_u8(fVec, o.fVec); }

    AI uint8_t operator[](int k) const {
        SkASSERT(0 <= k && k < 16);
        union { uint8x16_t v; uint8_t us[16]; } pun = {fVec};
        return pun.us[k&15];
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return vbslq_u8(fVec, t.fVec, e.fVec);
    }

    uint8x16_t fVec;
};

template <>
class SkNx<4, int32_t> {
public:
    AI SkNx(const int32x4_t& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(int32_t v) {
        fVec = vdupq_n_s32(v);
    }
    AI SkNx(int32_t a, int32_t b, int32_t c, int32_t d) {
        fVec = (int32x4_t){a,b,c,d};
    }
    AI static SkNx Load(const void* ptr) {
        return vld1q_s32((const int32_t*)ptr);
    }
    AI void store(void* ptr) const {
        return vst1q_s32((int32_t*)ptr, fVec);
    }
    AI int32_t operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { int32x4_t v; int32_t is[4]; } pun = {fVec};
        return pun.is[k&3];
    }

    AI SkNx operator + (const SkNx& o) const { return vaddq_s32(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return vsubq_s32(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return vmulq_s32(fVec, o.fVec); }

    AI SkNx operator & (const SkNx& o) const { return vandq_s32(fVec, o.fVec); }
    AI SkNx operator | (const SkNx& o) const { return vorrq_s32(fVec, o.fVec); }
    AI SkNx operator ^ (const SkNx& o) const { return veorq_s32(fVec, o.fVec); }

    AI SkNx operator << (int bits) const { return fVec << SkNx(bits).fVec; }
    AI SkNx operator >> (int bits) const { return fVec >> SkNx(bits).fVec; }

    AI SkNx operator == (const SkNx& o) const {
        return vreinterpretq_s32_u32(vceqq_s32(fVec, o.fVec));
    }
    AI SkNx operator <  (const SkNx& o) const {
        return vreinterpretq_s32_u32(vcltq_s32(fVec, o.fVec));
    }
    AI SkNx operator >  (const SkNx& o) const {
        return vreinterpretq_s32_u32(vcgtq_s32(fVec, o.fVec));
    }

    AI static SkNx Min(const SkNx& a, const SkNx& b) { return vminq_s32(a.fVec, b.fVec); }
    AI static SkNx Max(const SkNx& a, const SkNx& b) { return vmaxq_s32(a.fVec, b.fVec); }
    // TODO as needed

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return vbslq_s32(vreinterpretq_u32_s32(fVec), t.fVec, e.fVec);
    }

    AI SkNx abs() const { return vabsq_s32(fVec); }

    int32x4_t fVec;
};

template <>
class SkNx<4, uint32_t> {
public:
    AI SkNx(const uint32x4_t& vec) : fVec(vec) {}

    AI SkNx() {}
    AI SkNx(uint32_t v) {
        fVec = vdupq_n_u32(v);
    }
    AI SkNx(uint32_t a, uint32_t b, uint32_t c, uint32_t d) {
        fVec = (uint32x4_t){a,b,c,d};
    }
    AI static SkNx Load(const void* ptr) {
        return vld1q_u32((const uint32_t*)ptr);
    }
    AI void store(void* ptr) const {
        return vst1q_u32((uint32_t*)ptr, fVec);
    }
    AI uint32_t operator[](int k) const {
        SkASSERT(0 <= k && k < 4);
        union { uint32x4_t v; uint32_t us[4]; } pun = {fVec};
        return pun.us[k&3];
    }

    AI SkNx operator + (const SkNx& o) const { return vaddq_u32(fVec, o.fVec); }
    AI SkNx operator - (const SkNx& o) const { return vsubq_u32(fVec, o.fVec); }
    AI SkNx operator * (const SkNx& o) const { return vmulq_u32(fVec, o.fVec); }

    AI SkNx operator & (const SkNx& o) const { return vandq_u32(fVec, o.fVec); }
    AI SkNx operator | (const SkNx& o) const { return vorrq_u32(fVec, o.fVec); }
    AI SkNx operator ^ (const SkNx& o) const { return veorq_u32(fVec, o.fVec); }

    AI SkNx operator << (int bits) const { return fVec << SkNx(bits).fVec; }
    AI SkNx operator >> (int bits) const { return fVec >> SkNx(bits).fVec; }

    AI SkNx operator == (const SkNx& o) const { return vceqq_u32(fVec, o.fVec); }
    AI SkNx operator <  (const SkNx& o) const { return vcltq_u32(fVec, o.fVec); }
    AI SkNx operator >  (const SkNx& o) const { return vcgtq_u32(fVec, o.fVec); }

    AI static SkNx Min(const SkNx& a, const SkNx& b) { return vminq_u32(a.fVec, b.fVec); }
    // TODO as needed

    AI SkNx mulHi(const SkNx& m) const {
        uint64x2_t hi = vmull_u32(vget_high_u32(fVec), vget_high_u32(m.fVec));
        uint64x2_t lo = vmull_u32( vget_low_u32(fVec),  vget_low_u32(m.fVec));

        return { vcombine_u32(vshrn_n_u64(lo,32), vshrn_n_u64(hi,32)) };
    }

    AI SkNx thenElse(const SkNx& t, const SkNx& e) const {
        return vbslq_u32(fVec, t.fVec, e.fVec);
    }

    uint32x4_t fVec;
};

template<> AI /*static*/ Sk4i SkNx_cast<int32_t, float>(const Sk4f& src) {
    return vcvtq_s32_f32(src.fVec);

}
template<> AI /*static*/ Sk4f SkNx_cast<float, int32_t>(const Sk4i& src) {
    return vcvtq_f32_s32(src.fVec);
}
template<> AI /*static*/ Sk4f SkNx_cast<float, uint32_t>(const Sk4u& src) {
    return SkNx_cast<float>(Sk4i::Load(&src));
}

template<> AI /*static*/ Sk4h SkNx_cast<uint16_t, float>(const Sk4f& src) {
    return vqmovn_u32(vcvtq_u32_f32(src.fVec));
}

template<> AI /*static*/ Sk4f SkNx_cast<float, uint16_t>(const Sk4h& src) {
    return vcvtq_f32_u32(vmovl_u16(src.fVec));
}

template<> AI /*static*/ Sk4b SkNx_cast<uint8_t, float>(const Sk4f& src) {
    uint32x4_t _32 = vcvtq_u32_f32(src.fVec);
    uint16x4_t _16 = vqmovn_u32(_32);
    return vqmovn_u16(vcombine_u16(_16, _16));
}

template<> AI /*static*/ Sk4u SkNx_cast<uint32_t, uint8_t>(const Sk4b& src) {
    uint16x8_t _16 = vmovl_u8(src.fVec);
    return vmovl_u16(vget_low_u16(_16));
}

template<> AI /*static*/ Sk4i SkNx_cast<int32_t, uint8_t>(const Sk4b& src) {
    return vreinterpretq_s32_u32(SkNx_cast<uint32_t>(src).fVec);
}

template<> AI /*static*/ Sk4f SkNx_cast<float, uint8_t>(const Sk4b& src) {
    return vcvtq_f32_s32(SkNx_cast<int32_t>(src).fVec);
}

template<> AI /*static*/ Sk16b SkNx_cast<uint8_t, float>(const Sk16f& src) {
    Sk8f ab, cd;
    SkNx_split(src, &ab, &cd);

    Sk4f a,b,c,d;
    SkNx_split(ab, &a, &b);
    SkNx_split(cd, &c, &d);
    return vuzpq_u8(vuzpq_u8((uint8x16_t)vcvtq_u32_f32(a.fVec),
                             (uint8x16_t)vcvtq_u32_f32(b.fVec)).val[0],
                    vuzpq_u8((uint8x16_t)vcvtq_u32_f32(c.fVec),
                             (uint8x16_t)vcvtq_u32_f32(d.fVec)).val[0]).val[0];
}

template<> AI /*static*/ Sk8b SkNx_cast<uint8_t, int32_t>(const Sk8i& src) {
    Sk4i a, b;
    SkNx_split(src, &a, &b);
    uint16x4_t a16 = vqmovun_s32(a.fVec);
    uint16x4_t b16 = vqmovun_s32(b.fVec);

    return vqmovn_u16(vcombine_u16(a16, b16));
}

template<> AI /*static*/ Sk4h SkNx_cast<uint16_t, uint8_t>(const Sk4b& src) {
    return vget_low_u16(vmovl_u8(src.fVec));
}

template<> AI /*static*/ Sk8h SkNx_cast<uint16_t, uint8_t>(const Sk8b& src) {
    return vmovl_u8(src.fVec);
}

template<> AI /*static*/ Sk4b SkNx_cast<uint8_t, uint16_t>(const Sk4h& src) {
    return vmovn_u16(vcombine_u16(src.fVec, src.fVec));
}

template<> AI /*static*/ Sk8b SkNx_cast<uint8_t, uint16_t>(const Sk8h& src) {
    return vqmovn_u16(src.fVec);
}

template<> AI /*static*/ Sk4b SkNx_cast<uint8_t, int32_t>(const Sk4i& src) {
    uint16x4_t _16 = vqmovun_s32(src.fVec);
    return vqmovn_u16(vcombine_u16(_16, _16));
}

template<> AI /*static*/ Sk4b SkNx_cast<uint8_t, uint32_t>(const Sk4u& src) {
    uint16x4_t _16 = vqmovn_u32(src.fVec);
    return vqmovn_u16(vcombine_u16(_16, _16));
}

template<> AI /*static*/ Sk4i SkNx_cast<int32_t, uint16_t>(const Sk4h& src) {
    return vreinterpretq_s32_u32(vmovl_u16(src.fVec));
}

template<> AI /*static*/ Sk4h SkNx_cast<uint16_t, int32_t>(const Sk4i& src) {
    return vmovn_u32(vreinterpretq_u32_s32(src.fVec));
}

template<> AI /*static*/ Sk4i SkNx_cast<int32_t, uint32_t>(const Sk4u& src) {
    return vreinterpretq_s32_u32(src.fVec);
}

AI static Sk4i Sk4f_round(const Sk4f& x) {
    return vcvtq_s32_f32((x + 0.5f).fVec);
}

}  // namespace

#endif//SkNx_neon_DEFINED

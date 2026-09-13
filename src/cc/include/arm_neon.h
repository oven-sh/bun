/* NEON intrinsics for AArch64 targets, written over the vector extensions. Only the
   128-bit (q) forms defined here exist. */
#ifndef __BUN_CC_ARM_NEON_H
#define __BUN_CC_ARM_NEON_H

#include <stdint.h>

typedef float float32_t;
typedef double float64_t;

typedef int8_t int8x16_t __attribute__((__vector_size__(16)));
typedef uint8_t uint8x16_t __attribute__((__vector_size__(16)));
typedef int16_t int16x8_t __attribute__((__vector_size__(16)));
typedef uint16_t uint16x8_t __attribute__((__vector_size__(16)));
typedef int32_t int32x4_t __attribute__((__vector_size__(16)));
typedef uint32_t uint32x4_t __attribute__((__vector_size__(16)));
typedef int64_t int64x2_t __attribute__((__vector_size__(16)));
typedef uint64_t uint64x2_t __attribute__((__vector_size__(16)));
typedef float32_t float32x4_t __attribute__((__vector_size__(16)));
typedef float64_t float64x2_t __attribute__((__vector_size__(16)));

#define __BUN_CC_INTRIN static __inline __attribute__((__always_inline__, __unused__))

/* int8x16_t */
__BUN_CC_INTRIN int8x16_t vdupq_n_s8(int8_t __x) { return (int8x16_t){__x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN int8x16_t vmovq_n_s8(int8_t __x) { return (int8x16_t){__x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN int8x16_t vld1q_s8(const int8_t *__p) { return *(const int8x16_t *)__p; }
__BUN_CC_INTRIN int8x16_t vld1q_dup_s8(const int8_t *__p) { return vdupq_n_s8(*__p); }
__BUN_CC_INTRIN void vst1q_s8(int8_t *__p, int8x16_t __v) { *(int8x16_t *)__p = __v; }
#define vgetq_lane_s8(v, lane) ((((int8x16_t)(v)))[lane])
#define vsetq_lane_s8(x, v, lane) __extension__({ int8x16_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN int8x16_t vaddq_s8(int8x16_t __a, int8x16_t __b) { return __a + __b; }
__BUN_CC_INTRIN int8x16_t vsubq_s8(int8x16_t __a, int8x16_t __b) { return __a - __b; }
__BUN_CC_INTRIN int8x16_t vmulq_s8(int8x16_t __a, int8x16_t __b) { return __a * __b; }
__BUN_CC_INTRIN int8x16_t vmlaq_s8(int8x16_t __a, int8x16_t __b, int8x16_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN int8x16_t vmlsq_s8(int8x16_t __a, int8x16_t __b, int8x16_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN int8x16_t vminq_s8(int8x16_t __a, int8x16_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int8x16_t vmaxq_s8(int8x16_t __a, int8x16_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN int8x16_t vnegq_s8(int8x16_t __a) { return -__a; }
__BUN_CC_INTRIN int8x16_t vabsq_s8(int8x16_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN int8x16_t vandq_s8(int8x16_t __a, int8x16_t __b) { return __a & __b; }
__BUN_CC_INTRIN int8x16_t vorrq_s8(int8x16_t __a, int8x16_t __b) { return __a | __b; }
__BUN_CC_INTRIN int8x16_t veorq_s8(int8x16_t __a, int8x16_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN int8x16_t vbicq_s8(int8x16_t __a, int8x16_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN int8x16_t vmvnq_s8(int8x16_t __a) { return ~__a; }
__BUN_CC_INTRIN int8x16_t vshlq_n_s8(int8x16_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN int8x16_t vshrq_n_s8(int8x16_t __a, int __n) { return __a >> (__n >= 8 ? 7 : __n); }
__BUN_CC_INTRIN uint8x16_t vceqq_s8(int8x16_t __a, int8x16_t __b) { return (uint8x16_t)(__a == __b); }
__BUN_CC_INTRIN uint8x16_t vcgtq_s8(int8x16_t __a, int8x16_t __b) { return (uint8x16_t)(__a > __b); }
__BUN_CC_INTRIN uint8x16_t vcltq_s8(int8x16_t __a, int8x16_t __b) { return (uint8x16_t)(__a < __b); }
__BUN_CC_INTRIN uint8x16_t vcgeq_s8(int8x16_t __a, int8x16_t __b) { return (uint8x16_t)(__a >= __b); }
__BUN_CC_INTRIN uint8x16_t vcleq_s8(int8x16_t __a, int8x16_t __b) { return (uint8x16_t)(__a <= __b); }
__BUN_CC_INTRIN int8x16_t vbslq_s8(uint8x16_t __m, int8x16_t __a, int8x16_t __b) { return (int8x16_t)((__m & (uint8x16_t)__a) | (~__m & (uint8x16_t)__b)); }
__BUN_CC_INTRIN int8_t vaddvq_s8(int8x16_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN int8_t vmaxvq_s8(int8x16_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN int8_t vminvq_s8(int8x16_t __a) { return __builtin_reduce_min(__a); }

/* uint8x16_t */
__BUN_CC_INTRIN uint8x16_t vdupq_n_u8(uint8_t __x) { return (uint8x16_t){__x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN uint8x16_t vmovq_n_u8(uint8_t __x) { return (uint8x16_t){__x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN uint8x16_t vld1q_u8(const uint8_t *__p) { return *(const uint8x16_t *)__p; }
__BUN_CC_INTRIN uint8x16_t vld1q_dup_u8(const uint8_t *__p) { return vdupq_n_u8(*__p); }
__BUN_CC_INTRIN void vst1q_u8(uint8_t *__p, uint8x16_t __v) { *(uint8x16_t *)__p = __v; }
#define vgetq_lane_u8(v, lane) ((((uint8x16_t)(v)))[lane])
#define vsetq_lane_u8(x, v, lane) __extension__({ uint8x16_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN uint8x16_t vaddq_u8(uint8x16_t __a, uint8x16_t __b) { return __a + __b; }
__BUN_CC_INTRIN uint8x16_t vsubq_u8(uint8x16_t __a, uint8x16_t __b) { return __a - __b; }
__BUN_CC_INTRIN uint8x16_t vmulq_u8(uint8x16_t __a, uint8x16_t __b) { return __a * __b; }
__BUN_CC_INTRIN uint8x16_t vmlaq_u8(uint8x16_t __a, uint8x16_t __b, uint8x16_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN uint8x16_t vmlsq_u8(uint8x16_t __a, uint8x16_t __b, uint8x16_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN uint8x16_t vminq_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint8x16_t vmaxq_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN uint8x16_t vandq_u8(uint8x16_t __a, uint8x16_t __b) { return __a & __b; }
__BUN_CC_INTRIN uint8x16_t vorrq_u8(uint8x16_t __a, uint8x16_t __b) { return __a | __b; }
__BUN_CC_INTRIN uint8x16_t veorq_u8(uint8x16_t __a, uint8x16_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN uint8x16_t vbicq_u8(uint8x16_t __a, uint8x16_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN uint8x16_t vmvnq_u8(uint8x16_t __a) { return ~__a; }
__BUN_CC_INTRIN uint8x16_t vshlq_n_u8(uint8x16_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN uint8x16_t vshrq_n_u8(uint8x16_t __a, int __n) { return __n >= 8 ? vdupq_n_u8(0) : __a >> __n; }
__BUN_CC_INTRIN uint8x16_t vceqq_u8(uint8x16_t __a, uint8x16_t __b) { return (uint8x16_t)(__a == __b); }
__BUN_CC_INTRIN uint8x16_t vcgtq_u8(uint8x16_t __a, uint8x16_t __b) { return (uint8x16_t)(__a > __b); }
__BUN_CC_INTRIN uint8x16_t vcltq_u8(uint8x16_t __a, uint8x16_t __b) { return (uint8x16_t)(__a < __b); }
__BUN_CC_INTRIN uint8x16_t vcgeq_u8(uint8x16_t __a, uint8x16_t __b) { return (uint8x16_t)(__a >= __b); }
__BUN_CC_INTRIN uint8x16_t vcleq_u8(uint8x16_t __a, uint8x16_t __b) { return (uint8x16_t)(__a <= __b); }
__BUN_CC_INTRIN uint8x16_t vbslq_u8(uint8x16_t __m, uint8x16_t __a, uint8x16_t __b) { return (uint8x16_t)((__m & (uint8x16_t)__a) | (~__m & (uint8x16_t)__b)); }
__BUN_CC_INTRIN uint8_t vaddvq_u8(uint8x16_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN uint8_t vmaxvq_u8(uint8x16_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN uint8_t vminvq_u8(uint8x16_t __a) { return __builtin_reduce_min(__a); }

/* int16x8_t */
__BUN_CC_INTRIN int16x8_t vdupq_n_s16(int16_t __x) { return (int16x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN int16x8_t vmovq_n_s16(int16_t __x) { return (int16x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN int16x8_t vld1q_s16(const int16_t *__p) { return *(const int16x8_t *)__p; }
__BUN_CC_INTRIN int16x8_t vld1q_dup_s16(const int16_t *__p) { return vdupq_n_s16(*__p); }
__BUN_CC_INTRIN void vst1q_s16(int16_t *__p, int16x8_t __v) { *(int16x8_t *)__p = __v; }
#define vgetq_lane_s16(v, lane) ((((int16x8_t)(v)))[lane])
#define vsetq_lane_s16(x, v, lane) __extension__({ int16x8_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN int16x8_t vaddq_s16(int16x8_t __a, int16x8_t __b) { return __a + __b; }
__BUN_CC_INTRIN int16x8_t vsubq_s16(int16x8_t __a, int16x8_t __b) { return __a - __b; }
__BUN_CC_INTRIN int16x8_t vmulq_s16(int16x8_t __a, int16x8_t __b) { return __a * __b; }
__BUN_CC_INTRIN int16x8_t vmlaq_s16(int16x8_t __a, int16x8_t __b, int16x8_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN int16x8_t vmlsq_s16(int16x8_t __a, int16x8_t __b, int16x8_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN int16x8_t vminq_s16(int16x8_t __a, int16x8_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int16x8_t vmaxq_s16(int16x8_t __a, int16x8_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN int16x8_t vnegq_s16(int16x8_t __a) { return -__a; }
__BUN_CC_INTRIN int16x8_t vabsq_s16(int16x8_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN int16x8_t vandq_s16(int16x8_t __a, int16x8_t __b) { return __a & __b; }
__BUN_CC_INTRIN int16x8_t vorrq_s16(int16x8_t __a, int16x8_t __b) { return __a | __b; }
__BUN_CC_INTRIN int16x8_t veorq_s16(int16x8_t __a, int16x8_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN int16x8_t vbicq_s16(int16x8_t __a, int16x8_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN int16x8_t vmvnq_s16(int16x8_t __a) { return ~__a; }
__BUN_CC_INTRIN int16x8_t vshlq_n_s16(int16x8_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN int16x8_t vshrq_n_s16(int16x8_t __a, int __n) { return __a >> (__n >= 16 ? 15 : __n); }
__BUN_CC_INTRIN uint16x8_t vceqq_s16(int16x8_t __a, int16x8_t __b) { return (uint16x8_t)(__a == __b); }
__BUN_CC_INTRIN uint16x8_t vcgtq_s16(int16x8_t __a, int16x8_t __b) { return (uint16x8_t)(__a > __b); }
__BUN_CC_INTRIN uint16x8_t vcltq_s16(int16x8_t __a, int16x8_t __b) { return (uint16x8_t)(__a < __b); }
__BUN_CC_INTRIN uint16x8_t vcgeq_s16(int16x8_t __a, int16x8_t __b) { return (uint16x8_t)(__a >= __b); }
__BUN_CC_INTRIN uint16x8_t vcleq_s16(int16x8_t __a, int16x8_t __b) { return (uint16x8_t)(__a <= __b); }
__BUN_CC_INTRIN int16x8_t vbslq_s16(uint16x8_t __m, int16x8_t __a, int16x8_t __b) { return (int16x8_t)((__m & (uint16x8_t)__a) | (~__m & (uint16x8_t)__b)); }
__BUN_CC_INTRIN int16_t vaddvq_s16(int16x8_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN int16_t vmaxvq_s16(int16x8_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN int16_t vminvq_s16(int16x8_t __a) { return __builtin_reduce_min(__a); }

/* uint16x8_t */
__BUN_CC_INTRIN uint16x8_t vdupq_n_u16(uint16_t __x) { return (uint16x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN uint16x8_t vmovq_n_u16(uint16_t __x) { return (uint16x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN uint16x8_t vld1q_u16(const uint16_t *__p) { return *(const uint16x8_t *)__p; }
__BUN_CC_INTRIN uint16x8_t vld1q_dup_u16(const uint16_t *__p) { return vdupq_n_u16(*__p); }
__BUN_CC_INTRIN void vst1q_u16(uint16_t *__p, uint16x8_t __v) { *(uint16x8_t *)__p = __v; }
#define vgetq_lane_u16(v, lane) ((((uint16x8_t)(v)))[lane])
#define vsetq_lane_u16(x, v, lane) __extension__({ uint16x8_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN uint16x8_t vaddq_u16(uint16x8_t __a, uint16x8_t __b) { return __a + __b; }
__BUN_CC_INTRIN uint16x8_t vsubq_u16(uint16x8_t __a, uint16x8_t __b) { return __a - __b; }
__BUN_CC_INTRIN uint16x8_t vmulq_u16(uint16x8_t __a, uint16x8_t __b) { return __a * __b; }
__BUN_CC_INTRIN uint16x8_t vmlaq_u16(uint16x8_t __a, uint16x8_t __b, uint16x8_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN uint16x8_t vmlsq_u16(uint16x8_t __a, uint16x8_t __b, uint16x8_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN uint16x8_t vminq_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint16x8_t vmaxq_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN uint16x8_t vandq_u16(uint16x8_t __a, uint16x8_t __b) { return __a & __b; }
__BUN_CC_INTRIN uint16x8_t vorrq_u16(uint16x8_t __a, uint16x8_t __b) { return __a | __b; }
__BUN_CC_INTRIN uint16x8_t veorq_u16(uint16x8_t __a, uint16x8_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN uint16x8_t vbicq_u16(uint16x8_t __a, uint16x8_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN uint16x8_t vmvnq_u16(uint16x8_t __a) { return ~__a; }
__BUN_CC_INTRIN uint16x8_t vshlq_n_u16(uint16x8_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN uint16x8_t vshrq_n_u16(uint16x8_t __a, int __n) { return __n >= 16 ? vdupq_n_u16(0) : __a >> __n; }
__BUN_CC_INTRIN uint16x8_t vceqq_u16(uint16x8_t __a, uint16x8_t __b) { return (uint16x8_t)(__a == __b); }
__BUN_CC_INTRIN uint16x8_t vcgtq_u16(uint16x8_t __a, uint16x8_t __b) { return (uint16x8_t)(__a > __b); }
__BUN_CC_INTRIN uint16x8_t vcltq_u16(uint16x8_t __a, uint16x8_t __b) { return (uint16x8_t)(__a < __b); }
__BUN_CC_INTRIN uint16x8_t vcgeq_u16(uint16x8_t __a, uint16x8_t __b) { return (uint16x8_t)(__a >= __b); }
__BUN_CC_INTRIN uint16x8_t vcleq_u16(uint16x8_t __a, uint16x8_t __b) { return (uint16x8_t)(__a <= __b); }
__BUN_CC_INTRIN uint16x8_t vbslq_u16(uint16x8_t __m, uint16x8_t __a, uint16x8_t __b) { return (uint16x8_t)((__m & (uint16x8_t)__a) | (~__m & (uint16x8_t)__b)); }
__BUN_CC_INTRIN uint16_t vaddvq_u16(uint16x8_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN uint16_t vmaxvq_u16(uint16x8_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN uint16_t vminvq_u16(uint16x8_t __a) { return __builtin_reduce_min(__a); }

/* int32x4_t */
__BUN_CC_INTRIN int32x4_t vdupq_n_s32(int32_t __x) { return (int32x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN int32x4_t vmovq_n_s32(int32_t __x) { return (int32x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN int32x4_t vld1q_s32(const int32_t *__p) { return *(const int32x4_t *)__p; }
__BUN_CC_INTRIN int32x4_t vld1q_dup_s32(const int32_t *__p) { return vdupq_n_s32(*__p); }
__BUN_CC_INTRIN void vst1q_s32(int32_t *__p, int32x4_t __v) { *(int32x4_t *)__p = __v; }
#define vgetq_lane_s32(v, lane) ((((int32x4_t)(v)))[lane])
#define vsetq_lane_s32(x, v, lane) __extension__({ int32x4_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN int32x4_t vaddq_s32(int32x4_t __a, int32x4_t __b) { return __a + __b; }
__BUN_CC_INTRIN int32x4_t vsubq_s32(int32x4_t __a, int32x4_t __b) { return __a - __b; }
__BUN_CC_INTRIN int32x4_t vmulq_s32(int32x4_t __a, int32x4_t __b) { return __a * __b; }
__BUN_CC_INTRIN int32x4_t vmlaq_s32(int32x4_t __a, int32x4_t __b, int32x4_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN int32x4_t vmlsq_s32(int32x4_t __a, int32x4_t __b, int32x4_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN int32x4_t vminq_s32(int32x4_t __a, int32x4_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int32x4_t vmaxq_s32(int32x4_t __a, int32x4_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN int32x4_t vnegq_s32(int32x4_t __a) { return -__a; }
__BUN_CC_INTRIN int32x4_t vabsq_s32(int32x4_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN int32x4_t vandq_s32(int32x4_t __a, int32x4_t __b) { return __a & __b; }
__BUN_CC_INTRIN int32x4_t vorrq_s32(int32x4_t __a, int32x4_t __b) { return __a | __b; }
__BUN_CC_INTRIN int32x4_t veorq_s32(int32x4_t __a, int32x4_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN int32x4_t vbicq_s32(int32x4_t __a, int32x4_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN int32x4_t vmvnq_s32(int32x4_t __a) { return ~__a; }
__BUN_CC_INTRIN int32x4_t vshlq_n_s32(int32x4_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN int32x4_t vshrq_n_s32(int32x4_t __a, int __n) { return __a >> (__n >= 32 ? 31 : __n); }
__BUN_CC_INTRIN uint32x4_t vceqq_s32(int32x4_t __a, int32x4_t __b) { return (uint32x4_t)(__a == __b); }
__BUN_CC_INTRIN uint32x4_t vcgtq_s32(int32x4_t __a, int32x4_t __b) { return (uint32x4_t)(__a > __b); }
__BUN_CC_INTRIN uint32x4_t vcltq_s32(int32x4_t __a, int32x4_t __b) { return (uint32x4_t)(__a < __b); }
__BUN_CC_INTRIN uint32x4_t vcgeq_s32(int32x4_t __a, int32x4_t __b) { return (uint32x4_t)(__a >= __b); }
__BUN_CC_INTRIN uint32x4_t vcleq_s32(int32x4_t __a, int32x4_t __b) { return (uint32x4_t)(__a <= __b); }
__BUN_CC_INTRIN int32x4_t vbslq_s32(uint32x4_t __m, int32x4_t __a, int32x4_t __b) { return (int32x4_t)((__m & (uint32x4_t)__a) | (~__m & (uint32x4_t)__b)); }
__BUN_CC_INTRIN int32_t vaddvq_s32(int32x4_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN int32_t vmaxvq_s32(int32x4_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN int32_t vminvq_s32(int32x4_t __a) { return __builtin_reduce_min(__a); }

/* uint32x4_t */
__BUN_CC_INTRIN uint32x4_t vdupq_n_u32(uint32_t __x) { return (uint32x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN uint32x4_t vmovq_n_u32(uint32_t __x) { return (uint32x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN uint32x4_t vld1q_u32(const uint32_t *__p) { return *(const uint32x4_t *)__p; }
__BUN_CC_INTRIN uint32x4_t vld1q_dup_u32(const uint32_t *__p) { return vdupq_n_u32(*__p); }
__BUN_CC_INTRIN void vst1q_u32(uint32_t *__p, uint32x4_t __v) { *(uint32x4_t *)__p = __v; }
#define vgetq_lane_u32(v, lane) ((((uint32x4_t)(v)))[lane])
#define vsetq_lane_u32(x, v, lane) __extension__({ uint32x4_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN uint32x4_t vaddq_u32(uint32x4_t __a, uint32x4_t __b) { return __a + __b; }
__BUN_CC_INTRIN uint32x4_t vsubq_u32(uint32x4_t __a, uint32x4_t __b) { return __a - __b; }
__BUN_CC_INTRIN uint32x4_t vmulq_u32(uint32x4_t __a, uint32x4_t __b) { return __a * __b; }
__BUN_CC_INTRIN uint32x4_t vmlaq_u32(uint32x4_t __a, uint32x4_t __b, uint32x4_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN uint32x4_t vmlsq_u32(uint32x4_t __a, uint32x4_t __b, uint32x4_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN uint32x4_t vminq_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint32x4_t vmaxq_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN uint32x4_t vandq_u32(uint32x4_t __a, uint32x4_t __b) { return __a & __b; }
__BUN_CC_INTRIN uint32x4_t vorrq_u32(uint32x4_t __a, uint32x4_t __b) { return __a | __b; }
__BUN_CC_INTRIN uint32x4_t veorq_u32(uint32x4_t __a, uint32x4_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN uint32x4_t vbicq_u32(uint32x4_t __a, uint32x4_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN uint32x4_t vmvnq_u32(uint32x4_t __a) { return ~__a; }
__BUN_CC_INTRIN uint32x4_t vshlq_n_u32(uint32x4_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN uint32x4_t vshrq_n_u32(uint32x4_t __a, int __n) { return __n >= 32 ? vdupq_n_u32(0) : __a >> __n; }
__BUN_CC_INTRIN uint32x4_t vceqq_u32(uint32x4_t __a, uint32x4_t __b) { return (uint32x4_t)(__a == __b); }
__BUN_CC_INTRIN uint32x4_t vcgtq_u32(uint32x4_t __a, uint32x4_t __b) { return (uint32x4_t)(__a > __b); }
__BUN_CC_INTRIN uint32x4_t vcltq_u32(uint32x4_t __a, uint32x4_t __b) { return (uint32x4_t)(__a < __b); }
__BUN_CC_INTRIN uint32x4_t vcgeq_u32(uint32x4_t __a, uint32x4_t __b) { return (uint32x4_t)(__a >= __b); }
__BUN_CC_INTRIN uint32x4_t vcleq_u32(uint32x4_t __a, uint32x4_t __b) { return (uint32x4_t)(__a <= __b); }
__BUN_CC_INTRIN uint32x4_t vbslq_u32(uint32x4_t __m, uint32x4_t __a, uint32x4_t __b) { return (uint32x4_t)((__m & (uint32x4_t)__a) | (~__m & (uint32x4_t)__b)); }
__BUN_CC_INTRIN uint32_t vaddvq_u32(uint32x4_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN uint32_t vmaxvq_u32(uint32x4_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN uint32_t vminvq_u32(uint32x4_t __a) { return __builtin_reduce_min(__a); }

/* int64x2_t */
__BUN_CC_INTRIN int64x2_t vdupq_n_s64(int64_t __x) { return (int64x2_t){__x, __x}; }
__BUN_CC_INTRIN int64x2_t vmovq_n_s64(int64_t __x) { return (int64x2_t){__x, __x}; }
__BUN_CC_INTRIN int64x2_t vld1q_s64(const int64_t *__p) { return *(const int64x2_t *)__p; }
__BUN_CC_INTRIN int64x2_t vld1q_dup_s64(const int64_t *__p) { return vdupq_n_s64(*__p); }
__BUN_CC_INTRIN void vst1q_s64(int64_t *__p, int64x2_t __v) { *(int64x2_t *)__p = __v; }
#define vgetq_lane_s64(v, lane) ((((int64x2_t)(v)))[lane])
#define vsetq_lane_s64(x, v, lane) __extension__({ int64x2_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN int64x2_t vaddq_s64(int64x2_t __a, int64x2_t __b) { return __a + __b; }
__BUN_CC_INTRIN int64x2_t vsubq_s64(int64x2_t __a, int64x2_t __b) { return __a - __b; }
__BUN_CC_INTRIN int64x2_t vnegq_s64(int64x2_t __a) { return -__a; }
__BUN_CC_INTRIN int64x2_t vabsq_s64(int64x2_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN int64x2_t vandq_s64(int64x2_t __a, int64x2_t __b) { return __a & __b; }
__BUN_CC_INTRIN int64x2_t vorrq_s64(int64x2_t __a, int64x2_t __b) { return __a | __b; }
__BUN_CC_INTRIN int64x2_t veorq_s64(int64x2_t __a, int64x2_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN int64x2_t vbicq_s64(int64x2_t __a, int64x2_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN int64x2_t vmvnq_s64(int64x2_t __a) { return ~__a; }
__BUN_CC_INTRIN int64x2_t vshlq_n_s64(int64x2_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN int64x2_t vshrq_n_s64(int64x2_t __a, int __n) { return __a >> (__n >= 64 ? 63 : __n); }
__BUN_CC_INTRIN uint64x2_t vceqq_s64(int64x2_t __a, int64x2_t __b) { return (uint64x2_t)(__a == __b); }
__BUN_CC_INTRIN uint64x2_t vcgtq_s64(int64x2_t __a, int64x2_t __b) { return (uint64x2_t)(__a > __b); }
__BUN_CC_INTRIN uint64x2_t vcltq_s64(int64x2_t __a, int64x2_t __b) { return (uint64x2_t)(__a < __b); }
__BUN_CC_INTRIN uint64x2_t vcgeq_s64(int64x2_t __a, int64x2_t __b) { return (uint64x2_t)(__a >= __b); }
__BUN_CC_INTRIN uint64x2_t vcleq_s64(int64x2_t __a, int64x2_t __b) { return (uint64x2_t)(__a <= __b); }
__BUN_CC_INTRIN int64x2_t vbslq_s64(uint64x2_t __m, int64x2_t __a, int64x2_t __b) { return (int64x2_t)((__m & (uint64x2_t)__a) | (~__m & (uint64x2_t)__b)); }
__BUN_CC_INTRIN int64_t vaddvq_s64(int64x2_t __a) { return __builtin_reduce_add(__a); }

/* uint64x2_t */
__BUN_CC_INTRIN uint64x2_t vdupq_n_u64(uint64_t __x) { return (uint64x2_t){__x, __x}; }
__BUN_CC_INTRIN uint64x2_t vmovq_n_u64(uint64_t __x) { return (uint64x2_t){__x, __x}; }
__BUN_CC_INTRIN uint64x2_t vld1q_u64(const uint64_t *__p) { return *(const uint64x2_t *)__p; }
__BUN_CC_INTRIN uint64x2_t vld1q_dup_u64(const uint64_t *__p) { return vdupq_n_u64(*__p); }
__BUN_CC_INTRIN void vst1q_u64(uint64_t *__p, uint64x2_t __v) { *(uint64x2_t *)__p = __v; }
#define vgetq_lane_u64(v, lane) ((((uint64x2_t)(v)))[lane])
#define vsetq_lane_u64(x, v, lane) __extension__({ uint64x2_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN uint64x2_t vaddq_u64(uint64x2_t __a, uint64x2_t __b) { return __a + __b; }
__BUN_CC_INTRIN uint64x2_t vsubq_u64(uint64x2_t __a, uint64x2_t __b) { return __a - __b; }
__BUN_CC_INTRIN uint64x2_t vandq_u64(uint64x2_t __a, uint64x2_t __b) { return __a & __b; }
__BUN_CC_INTRIN uint64x2_t vorrq_u64(uint64x2_t __a, uint64x2_t __b) { return __a | __b; }
__BUN_CC_INTRIN uint64x2_t veorq_u64(uint64x2_t __a, uint64x2_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN uint64x2_t vbicq_u64(uint64x2_t __a, uint64x2_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN uint64x2_t vmvnq_u64(uint64x2_t __a) { return ~__a; }
__BUN_CC_INTRIN uint64x2_t vshlq_n_u64(uint64x2_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN uint64x2_t vshrq_n_u64(uint64x2_t __a, int __n) { return __n >= 64 ? vdupq_n_u64(0) : __a >> __n; }
__BUN_CC_INTRIN uint64x2_t vceqq_u64(uint64x2_t __a, uint64x2_t __b) { return (uint64x2_t)(__a == __b); }
__BUN_CC_INTRIN uint64x2_t vcgtq_u64(uint64x2_t __a, uint64x2_t __b) { return (uint64x2_t)(__a > __b); }
__BUN_CC_INTRIN uint64x2_t vcltq_u64(uint64x2_t __a, uint64x2_t __b) { return (uint64x2_t)(__a < __b); }
__BUN_CC_INTRIN uint64x2_t vcgeq_u64(uint64x2_t __a, uint64x2_t __b) { return (uint64x2_t)(__a >= __b); }
__BUN_CC_INTRIN uint64x2_t vcleq_u64(uint64x2_t __a, uint64x2_t __b) { return (uint64x2_t)(__a <= __b); }
__BUN_CC_INTRIN uint64x2_t vbslq_u64(uint64x2_t __m, uint64x2_t __a, uint64x2_t __b) { return (uint64x2_t)((__m & (uint64x2_t)__a) | (~__m & (uint64x2_t)__b)); }
__BUN_CC_INTRIN uint64_t vaddvq_u64(uint64x2_t __a) { return __builtin_reduce_add(__a); }

/* float32x4_t */
__BUN_CC_INTRIN float32x4_t vdupq_n_f32(float32_t __x) { return (float32x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN float32x4_t vmovq_n_f32(float32_t __x) { return (float32x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN float32x4_t vld1q_f32(const float32_t *__p) { return *(const float32x4_t *)__p; }
__BUN_CC_INTRIN float32x4_t vld1q_dup_f32(const float32_t *__p) { return vdupq_n_f32(*__p); }
__BUN_CC_INTRIN void vst1q_f32(float32_t *__p, float32x4_t __v) { *(float32x4_t *)__p = __v; }
#define vgetq_lane_f32(v, lane) ((((float32x4_t)(v)))[lane])
#define vsetq_lane_f32(x, v, lane) __extension__({ float32x4_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN float32x4_t vaddq_f32(float32x4_t __a, float32x4_t __b) { return __a + __b; }
__BUN_CC_INTRIN float32x4_t vsubq_f32(float32x4_t __a, float32x4_t __b) { return __a - __b; }
__BUN_CC_INTRIN float32x4_t vmulq_f32(float32x4_t __a, float32x4_t __b) { return __a * __b; }
__BUN_CC_INTRIN float32x4_t vmlaq_f32(float32x4_t __a, float32x4_t __b, float32x4_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN float32x4_t vmlsq_f32(float32x4_t __a, float32x4_t __b, float32x4_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN float32x4_t vminq_f32(float32x4_t __a, float32x4_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN float32x4_t vmaxq_f32(float32x4_t __a, float32x4_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN float32x4_t vnegq_f32(float32x4_t __a) { return -__a; }
__BUN_CC_INTRIN float32x4_t vabsq_f32(float32x4_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN float32x4_t vdivq_f32(float32x4_t __a, float32x4_t __b) { return __a / __b; }
__BUN_CC_INTRIN float32x4_t vsqrtq_f32(float32x4_t __a) { return __builtin_elementwise_sqrt(__a); }
__BUN_CC_INTRIN uint32x4_t vceqq_f32(float32x4_t __a, float32x4_t __b) { return (uint32x4_t)(__a == __b); }
__BUN_CC_INTRIN uint32x4_t vcgtq_f32(float32x4_t __a, float32x4_t __b) { return (uint32x4_t)(__a > __b); }
__BUN_CC_INTRIN uint32x4_t vcltq_f32(float32x4_t __a, float32x4_t __b) { return (uint32x4_t)(__a < __b); }
__BUN_CC_INTRIN uint32x4_t vcgeq_f32(float32x4_t __a, float32x4_t __b) { return (uint32x4_t)(__a >= __b); }
__BUN_CC_INTRIN uint32x4_t vcleq_f32(float32x4_t __a, float32x4_t __b) { return (uint32x4_t)(__a <= __b); }
__BUN_CC_INTRIN float32x4_t vbslq_f32(uint32x4_t __m, float32x4_t __a, float32x4_t __b) { return (float32x4_t)((__m & (uint32x4_t)__a) | (~__m & (uint32x4_t)__b)); }
__BUN_CC_INTRIN float32_t vaddvq_f32(float32x4_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN float32_t vmaxvq_f32(float32x4_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN float32_t vminvq_f32(float32x4_t __a) { return __builtin_reduce_min(__a); }

/* float64x2_t */
__BUN_CC_INTRIN float64x2_t vdupq_n_f64(float64_t __x) { return (float64x2_t){__x, __x}; }
__BUN_CC_INTRIN float64x2_t vmovq_n_f64(float64_t __x) { return (float64x2_t){__x, __x}; }
__BUN_CC_INTRIN float64x2_t vld1q_f64(const float64_t *__p) { return *(const float64x2_t *)__p; }
__BUN_CC_INTRIN float64x2_t vld1q_dup_f64(const float64_t *__p) { return vdupq_n_f64(*__p); }
__BUN_CC_INTRIN void vst1q_f64(float64_t *__p, float64x2_t __v) { *(float64x2_t *)__p = __v; }
#define vgetq_lane_f64(v, lane) ((((float64x2_t)(v)))[lane])
#define vsetq_lane_f64(x, v, lane) __extension__({ float64x2_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN float64x2_t vaddq_f64(float64x2_t __a, float64x2_t __b) { return __a + __b; }
__BUN_CC_INTRIN float64x2_t vsubq_f64(float64x2_t __a, float64x2_t __b) { return __a - __b; }
__BUN_CC_INTRIN float64x2_t vmulq_f64(float64x2_t __a, float64x2_t __b) { return __a * __b; }
__BUN_CC_INTRIN float64x2_t vmlaq_f64(float64x2_t __a, float64x2_t __b, float64x2_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN float64x2_t vmlsq_f64(float64x2_t __a, float64x2_t __b, float64x2_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN float64x2_t vminq_f64(float64x2_t __a, float64x2_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN float64x2_t vmaxq_f64(float64x2_t __a, float64x2_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN float64x2_t vnegq_f64(float64x2_t __a) { return -__a; }
__BUN_CC_INTRIN float64x2_t vabsq_f64(float64x2_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN float64x2_t vdivq_f64(float64x2_t __a, float64x2_t __b) { return __a / __b; }
__BUN_CC_INTRIN float64x2_t vsqrtq_f64(float64x2_t __a) { return __builtin_elementwise_sqrt(__a); }
__BUN_CC_INTRIN uint64x2_t vceqq_f64(float64x2_t __a, float64x2_t __b) { return (uint64x2_t)(__a == __b); }
__BUN_CC_INTRIN uint64x2_t vcgtq_f64(float64x2_t __a, float64x2_t __b) { return (uint64x2_t)(__a > __b); }
__BUN_CC_INTRIN uint64x2_t vcltq_f64(float64x2_t __a, float64x2_t __b) { return (uint64x2_t)(__a < __b); }
__BUN_CC_INTRIN uint64x2_t vcgeq_f64(float64x2_t __a, float64x2_t __b) { return (uint64x2_t)(__a >= __b); }
__BUN_CC_INTRIN uint64x2_t vcleq_f64(float64x2_t __a, float64x2_t __b) { return (uint64x2_t)(__a <= __b); }
__BUN_CC_INTRIN float64x2_t vbslq_f64(uint64x2_t __m, float64x2_t __a, float64x2_t __b) { return (float64x2_t)((__m & (uint64x2_t)__a) | (~__m & (uint64x2_t)__b)); }
__BUN_CC_INTRIN float64_t vaddvq_f64(float64x2_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN float64_t vmaxvq_f64(float64x2_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN float64_t vminvq_f64(float64x2_t __a) { return __builtin_reduce_min(__a); }

/* Saturating arithmetic, rounding averages, table lookup, widening multiplies, pairwise sums. */
__BUN_CC_INTRIN int8x16_t vqaddq_s8(int8x16_t __a, int8x16_t __b) { return __builtin_elementwise_add_sat(__a, __b); }
__BUN_CC_INTRIN int8x16_t vqsubq_s8(int8x16_t __a, int8x16_t __b) { return __builtin_elementwise_sub_sat(__a, __b); }
__BUN_CC_INTRIN int16x8_t vmull_high_s8(int8x16_t __a, int8x16_t __b) { return __builtin_bir_extmul_high_s8(__a, __b); }
__BUN_CC_INTRIN int8x16_t vpaddq_s8(int8x16_t __a, int8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31); }
__BUN_CC_INTRIN uint8x16_t vqaddq_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_elementwise_add_sat(__a, __b); }
__BUN_CC_INTRIN uint8x16_t vqsubq_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_elementwise_sub_sat(__a, __b); }
__BUN_CC_INTRIN uint8x16_t vrhaddq_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_bir_average_u8(__a, __b); }
__BUN_CC_INTRIN uint16x8_t vmull_high_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_bir_extmul_high_u8(__a, __b); }
__BUN_CC_INTRIN uint8x16_t vpaddq_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31); }
__BUN_CC_INTRIN int16x8_t vqaddq_s16(int16x8_t __a, int16x8_t __b) { return __builtin_elementwise_add_sat(__a, __b); }
__BUN_CC_INTRIN int16x8_t vqsubq_s16(int16x8_t __a, int16x8_t __b) { return __builtin_elementwise_sub_sat(__a, __b); }
__BUN_CC_INTRIN int32x4_t vmull_high_s16(int16x8_t __a, int16x8_t __b) { return __builtin_bir_extmul_high_s16(__a, __b); }
__BUN_CC_INTRIN int16x8_t vpaddq_s16(int16x8_t __a, int16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN uint16x8_t vqaddq_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_elementwise_add_sat(__a, __b); }
__BUN_CC_INTRIN uint16x8_t vqsubq_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_elementwise_sub_sat(__a, __b); }
__BUN_CC_INTRIN uint16x8_t vrhaddq_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_bir_average_u16(__a, __b); }
__BUN_CC_INTRIN uint32x4_t vmull_high_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_bir_extmul_high_u16(__a, __b); }
__BUN_CC_INTRIN uint16x8_t vpaddq_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN int64x2_t vmull_high_s32(int32x4_t __a, int32x4_t __b) { return __builtin_bir_extmul_high_s32(__a, __b); }
__BUN_CC_INTRIN int32x4_t vpaddq_s32(int32x4_t __a, int32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN uint64x2_t vmull_high_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_bir_extmul_high_u32(__a, __b); }
__BUN_CC_INTRIN uint32x4_t vpaddq_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN float32x4_t vpaddq_f32(float32x4_t __a, float32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN uint8x16_t vqtbl1q_u8(uint8x16_t __t, uint8x16_t __idx) { return __builtin_bir_swizzle(__t, __idx); }
__BUN_CC_INTRIN int8x16_t vqtbl1q_s8(int8x16_t __t, uint8x16_t __idx) { return __builtin_bir_swizzle(__t, __idx); }

/* Conversions. */
__BUN_CC_INTRIN float32x4_t vcvtq_f32_s32(int32x4_t __a) { return __builtin_convertvector(__a, float32x4_t); }
__BUN_CC_INTRIN float32x4_t vcvtq_f32_u32(uint32x4_t __a) { return __builtin_convertvector(__a, float32x4_t); }
__BUN_CC_INTRIN int32x4_t vcvtq_s32_f32(float32x4_t __a) { return __builtin_convertvector(__a, int32x4_t); }
__BUN_CC_INTRIN uint32x4_t vcvtq_u32_f32(float32x4_t __a) { return __builtin_convertvector(__a, uint32x4_t); }
__BUN_CC_INTRIN float64x2_t vcvtq_f64_s64(int64x2_t __a) { return __builtin_convertvector(__a, float64x2_t); }
__BUN_CC_INTRIN int64x2_t vcvtq_s64_f64(float64x2_t __a) { return __builtin_convertvector(__a, int64x2_t); }

/* Reinterpretation. */
#define vreinterpretq_s8_u8(v) ((int8x16_t)(uint8x16_t)(v))
#define vreinterpretq_s8_s16(v) ((int8x16_t)(int16x8_t)(v))
#define vreinterpretq_s8_u16(v) ((int8x16_t)(uint16x8_t)(v))
#define vreinterpretq_s8_s32(v) ((int8x16_t)(int32x4_t)(v))
#define vreinterpretq_s8_u32(v) ((int8x16_t)(uint32x4_t)(v))
#define vreinterpretq_s8_s64(v) ((int8x16_t)(int64x2_t)(v))
#define vreinterpretq_s8_u64(v) ((int8x16_t)(uint64x2_t)(v))
#define vreinterpretq_s8_f32(v) ((int8x16_t)(float32x4_t)(v))
#define vreinterpretq_s8_f64(v) ((int8x16_t)(float64x2_t)(v))
#define vreinterpretq_u8_s8(v) ((uint8x16_t)(int8x16_t)(v))
#define vreinterpretq_u8_s16(v) ((uint8x16_t)(int16x8_t)(v))
#define vreinterpretq_u8_u16(v) ((uint8x16_t)(uint16x8_t)(v))
#define vreinterpretq_u8_s32(v) ((uint8x16_t)(int32x4_t)(v))
#define vreinterpretq_u8_u32(v) ((uint8x16_t)(uint32x4_t)(v))
#define vreinterpretq_u8_s64(v) ((uint8x16_t)(int64x2_t)(v))
#define vreinterpretq_u8_u64(v) ((uint8x16_t)(uint64x2_t)(v))
#define vreinterpretq_u8_f32(v) ((uint8x16_t)(float32x4_t)(v))
#define vreinterpretq_u8_f64(v) ((uint8x16_t)(float64x2_t)(v))
#define vreinterpretq_s16_s8(v) ((int16x8_t)(int8x16_t)(v))
#define vreinterpretq_s16_u8(v) ((int16x8_t)(uint8x16_t)(v))
#define vreinterpretq_s16_u16(v) ((int16x8_t)(uint16x8_t)(v))
#define vreinterpretq_s16_s32(v) ((int16x8_t)(int32x4_t)(v))
#define vreinterpretq_s16_u32(v) ((int16x8_t)(uint32x4_t)(v))
#define vreinterpretq_s16_s64(v) ((int16x8_t)(int64x2_t)(v))
#define vreinterpretq_s16_u64(v) ((int16x8_t)(uint64x2_t)(v))
#define vreinterpretq_s16_f32(v) ((int16x8_t)(float32x4_t)(v))
#define vreinterpretq_s16_f64(v) ((int16x8_t)(float64x2_t)(v))
#define vreinterpretq_u16_s8(v) ((uint16x8_t)(int8x16_t)(v))
#define vreinterpretq_u16_u8(v) ((uint16x8_t)(uint8x16_t)(v))
#define vreinterpretq_u16_s16(v) ((uint16x8_t)(int16x8_t)(v))
#define vreinterpretq_u16_s32(v) ((uint16x8_t)(int32x4_t)(v))
#define vreinterpretq_u16_u32(v) ((uint16x8_t)(uint32x4_t)(v))
#define vreinterpretq_u16_s64(v) ((uint16x8_t)(int64x2_t)(v))
#define vreinterpretq_u16_u64(v) ((uint16x8_t)(uint64x2_t)(v))
#define vreinterpretq_u16_f32(v) ((uint16x8_t)(float32x4_t)(v))
#define vreinterpretq_u16_f64(v) ((uint16x8_t)(float64x2_t)(v))
#define vreinterpretq_s32_s8(v) ((int32x4_t)(int8x16_t)(v))
#define vreinterpretq_s32_u8(v) ((int32x4_t)(uint8x16_t)(v))
#define vreinterpretq_s32_s16(v) ((int32x4_t)(int16x8_t)(v))
#define vreinterpretq_s32_u16(v) ((int32x4_t)(uint16x8_t)(v))
#define vreinterpretq_s32_u32(v) ((int32x4_t)(uint32x4_t)(v))
#define vreinterpretq_s32_s64(v) ((int32x4_t)(int64x2_t)(v))
#define vreinterpretq_s32_u64(v) ((int32x4_t)(uint64x2_t)(v))
#define vreinterpretq_s32_f32(v) ((int32x4_t)(float32x4_t)(v))
#define vreinterpretq_s32_f64(v) ((int32x4_t)(float64x2_t)(v))
#define vreinterpretq_u32_s8(v) ((uint32x4_t)(int8x16_t)(v))
#define vreinterpretq_u32_u8(v) ((uint32x4_t)(uint8x16_t)(v))
#define vreinterpretq_u32_s16(v) ((uint32x4_t)(int16x8_t)(v))
#define vreinterpretq_u32_u16(v) ((uint32x4_t)(uint16x8_t)(v))
#define vreinterpretq_u32_s32(v) ((uint32x4_t)(int32x4_t)(v))
#define vreinterpretq_u32_s64(v) ((uint32x4_t)(int64x2_t)(v))
#define vreinterpretq_u32_u64(v) ((uint32x4_t)(uint64x2_t)(v))
#define vreinterpretq_u32_f32(v) ((uint32x4_t)(float32x4_t)(v))
#define vreinterpretq_u32_f64(v) ((uint32x4_t)(float64x2_t)(v))
#define vreinterpretq_s64_s8(v) ((int64x2_t)(int8x16_t)(v))
#define vreinterpretq_s64_u8(v) ((int64x2_t)(uint8x16_t)(v))
#define vreinterpretq_s64_s16(v) ((int64x2_t)(int16x8_t)(v))
#define vreinterpretq_s64_u16(v) ((int64x2_t)(uint16x8_t)(v))
#define vreinterpretq_s64_s32(v) ((int64x2_t)(int32x4_t)(v))
#define vreinterpretq_s64_u32(v) ((int64x2_t)(uint32x4_t)(v))
#define vreinterpretq_s64_u64(v) ((int64x2_t)(uint64x2_t)(v))
#define vreinterpretq_s64_f32(v) ((int64x2_t)(float32x4_t)(v))
#define vreinterpretq_s64_f64(v) ((int64x2_t)(float64x2_t)(v))
#define vreinterpretq_u64_s8(v) ((uint64x2_t)(int8x16_t)(v))
#define vreinterpretq_u64_u8(v) ((uint64x2_t)(uint8x16_t)(v))
#define vreinterpretq_u64_s16(v) ((uint64x2_t)(int16x8_t)(v))
#define vreinterpretq_u64_u16(v) ((uint64x2_t)(uint16x8_t)(v))
#define vreinterpretq_u64_s32(v) ((uint64x2_t)(int32x4_t)(v))
#define vreinterpretq_u64_u32(v) ((uint64x2_t)(uint32x4_t)(v))
#define vreinterpretq_u64_s64(v) ((uint64x2_t)(int64x2_t)(v))
#define vreinterpretq_u64_f32(v) ((uint64x2_t)(float32x4_t)(v))
#define vreinterpretq_u64_f64(v) ((uint64x2_t)(float64x2_t)(v))
#define vreinterpretq_f32_s8(v) ((float32x4_t)(int8x16_t)(v))
#define vreinterpretq_f32_u8(v) ((float32x4_t)(uint8x16_t)(v))
#define vreinterpretq_f32_s16(v) ((float32x4_t)(int16x8_t)(v))
#define vreinterpretq_f32_u16(v) ((float32x4_t)(uint16x8_t)(v))
#define vreinterpretq_f32_s32(v) ((float32x4_t)(int32x4_t)(v))
#define vreinterpretq_f32_u32(v) ((float32x4_t)(uint32x4_t)(v))
#define vreinterpretq_f32_s64(v) ((float32x4_t)(int64x2_t)(v))
#define vreinterpretq_f32_u64(v) ((float32x4_t)(uint64x2_t)(v))
#define vreinterpretq_f32_f64(v) ((float32x4_t)(float64x2_t)(v))
#define vreinterpretq_f64_s8(v) ((float64x2_t)(int8x16_t)(v))
#define vreinterpretq_f64_u8(v) ((float64x2_t)(uint8x16_t)(v))
#define vreinterpretq_f64_s16(v) ((float64x2_t)(int16x8_t)(v))
#define vreinterpretq_f64_u16(v) ((float64x2_t)(uint16x8_t)(v))
#define vreinterpretq_f64_s32(v) ((float64x2_t)(int32x4_t)(v))
#define vreinterpretq_f64_u32(v) ((float64x2_t)(uint32x4_t)(v))
#define vreinterpretq_f64_s64(v) ((float64x2_t)(int64x2_t)(v))
#define vreinterpretq_f64_u64(v) ((float64x2_t)(uint64x2_t)(v))
#define vreinterpretq_f64_f32(v) ((float64x2_t)(float32x4_t)(v))

#endif

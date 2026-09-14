/* NEON intrinsics for AArch64 targets, written over the vector extensions. What is not
   defined here does not exist: the 64-bit and 128-bit forms below, and nothing that needs
   an instruction BIR has no way to say (AES, SHA hashes, polynomial multiplies of bytes). */
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

/* 64-bit vectors, structures of vectors, and what connects the widths. */
typedef uint8_t poly8_t;
typedef uint16_t poly16_t;
typedef uint64_t poly64_t;
typedef unsigned __int128 poly128_t;
typedef int8_t int8x8_t __attribute__((__vector_size__(8)));
typedef uint8_t uint8x8_t __attribute__((__vector_size__(8)));
typedef int16_t int16x4_t __attribute__((__vector_size__(8)));
typedef uint16_t uint16x4_t __attribute__((__vector_size__(8)));
typedef int32_t int32x2_t __attribute__((__vector_size__(8)));
typedef uint32_t uint32x2_t __attribute__((__vector_size__(8)));
typedef int64_t int64x1_t __attribute__((__vector_size__(8)));
typedef uint64_t uint64x1_t __attribute__((__vector_size__(8)));
typedef float32_t float32x2_t __attribute__((__vector_size__(8)));
typedef float64_t float64x1_t __attribute__((__vector_size__(8)));
typedef poly8_t poly8x8_t __attribute__((__vector_size__(8)));
typedef poly16_t poly16x4_t __attribute__((__vector_size__(8)));
typedef poly64_t poly64x1_t __attribute__((__vector_size__(8)));
typedef poly8_t poly8x16_t __attribute__((__vector_size__(16)));
typedef poly16_t poly16x8_t __attribute__((__vector_size__(16)));
typedef poly64_t poly64x2_t __attribute__((__vector_size__(16)));
typedef struct int8x8x2_t { int8x8_t val[2]; } int8x8x2_t;
typedef struct int8x16x2_t { int8x16_t val[2]; } int8x16x2_t;
typedef struct int8x8x3_t { int8x8_t val[3]; } int8x8x3_t;
typedef struct int8x16x3_t { int8x16_t val[3]; } int8x16x3_t;
typedef struct int8x8x4_t { int8x8_t val[4]; } int8x8x4_t;
typedef struct int8x16x4_t { int8x16_t val[4]; } int8x16x4_t;
typedef struct uint8x8x2_t { uint8x8_t val[2]; } uint8x8x2_t;
typedef struct uint8x16x2_t { uint8x16_t val[2]; } uint8x16x2_t;
typedef struct uint8x8x3_t { uint8x8_t val[3]; } uint8x8x3_t;
typedef struct uint8x16x3_t { uint8x16_t val[3]; } uint8x16x3_t;
typedef struct uint8x8x4_t { uint8x8_t val[4]; } uint8x8x4_t;
typedef struct uint8x16x4_t { uint8x16_t val[4]; } uint8x16x4_t;
typedef struct int16x4x2_t { int16x4_t val[2]; } int16x4x2_t;
typedef struct int16x8x2_t { int16x8_t val[2]; } int16x8x2_t;
typedef struct int16x4x3_t { int16x4_t val[3]; } int16x4x3_t;
typedef struct int16x8x3_t { int16x8_t val[3]; } int16x8x3_t;
typedef struct int16x4x4_t { int16x4_t val[4]; } int16x4x4_t;
typedef struct int16x8x4_t { int16x8_t val[4]; } int16x8x4_t;
typedef struct uint16x4x2_t { uint16x4_t val[2]; } uint16x4x2_t;
typedef struct uint16x8x2_t { uint16x8_t val[2]; } uint16x8x2_t;
typedef struct uint16x4x3_t { uint16x4_t val[3]; } uint16x4x3_t;
typedef struct uint16x8x3_t { uint16x8_t val[3]; } uint16x8x3_t;
typedef struct uint16x4x4_t { uint16x4_t val[4]; } uint16x4x4_t;
typedef struct uint16x8x4_t { uint16x8_t val[4]; } uint16x8x4_t;
typedef struct int32x2x2_t { int32x2_t val[2]; } int32x2x2_t;
typedef struct int32x4x2_t { int32x4_t val[2]; } int32x4x2_t;
typedef struct int32x2x3_t { int32x2_t val[3]; } int32x2x3_t;
typedef struct int32x4x3_t { int32x4_t val[3]; } int32x4x3_t;
typedef struct int32x2x4_t { int32x2_t val[4]; } int32x2x4_t;
typedef struct int32x4x4_t { int32x4_t val[4]; } int32x4x4_t;
typedef struct uint32x2x2_t { uint32x2_t val[2]; } uint32x2x2_t;
typedef struct uint32x4x2_t { uint32x4_t val[2]; } uint32x4x2_t;
typedef struct uint32x2x3_t { uint32x2_t val[3]; } uint32x2x3_t;
typedef struct uint32x4x3_t { uint32x4_t val[3]; } uint32x4x3_t;
typedef struct uint32x2x4_t { uint32x2_t val[4]; } uint32x2x4_t;
typedef struct uint32x4x4_t { uint32x4_t val[4]; } uint32x4x4_t;
typedef struct int64x1x2_t { int64x1_t val[2]; } int64x1x2_t;
typedef struct int64x2x2_t { int64x2_t val[2]; } int64x2x2_t;
typedef struct int64x1x3_t { int64x1_t val[3]; } int64x1x3_t;
typedef struct int64x2x3_t { int64x2_t val[3]; } int64x2x3_t;
typedef struct int64x1x4_t { int64x1_t val[4]; } int64x1x4_t;
typedef struct int64x2x4_t { int64x2_t val[4]; } int64x2x4_t;
typedef struct uint64x1x2_t { uint64x1_t val[2]; } uint64x1x2_t;
typedef struct uint64x2x2_t { uint64x2_t val[2]; } uint64x2x2_t;
typedef struct uint64x1x3_t { uint64x1_t val[3]; } uint64x1x3_t;
typedef struct uint64x2x3_t { uint64x2_t val[3]; } uint64x2x3_t;
typedef struct uint64x1x4_t { uint64x1_t val[4]; } uint64x1x4_t;
typedef struct uint64x2x4_t { uint64x2_t val[4]; } uint64x2x4_t;
typedef struct float32x2x2_t { float32x2_t val[2]; } float32x2x2_t;
typedef struct float32x4x2_t { float32x4_t val[2]; } float32x4x2_t;
typedef struct float32x2x3_t { float32x2_t val[3]; } float32x2x3_t;
typedef struct float32x4x3_t { float32x4_t val[3]; } float32x4x3_t;
typedef struct float32x2x4_t { float32x2_t val[4]; } float32x2x4_t;
typedef struct float32x4x4_t { float32x4_t val[4]; } float32x4x4_t;
typedef struct float64x1x2_t { float64x1_t val[2]; } float64x1x2_t;
typedef struct float64x2x2_t { float64x2_t val[2]; } float64x2x2_t;
typedef struct float64x1x3_t { float64x1_t val[3]; } float64x1x3_t;
typedef struct float64x2x3_t { float64x2_t val[3]; } float64x2x3_t;
typedef struct float64x1x4_t { float64x1_t val[4]; } float64x1x4_t;
typedef struct float64x2x4_t { float64x2_t val[4]; } float64x2x4_t;
typedef struct poly8x8x2_t { poly8x8_t val[2]; } poly8x8x2_t;
typedef struct poly8x16x2_t { poly8x16_t val[2]; } poly8x16x2_t;
typedef struct poly8x8x3_t { poly8x8_t val[3]; } poly8x8x3_t;
typedef struct poly8x16x3_t { poly8x16_t val[3]; } poly8x16x3_t;
typedef struct poly8x8x4_t { poly8x8_t val[4]; } poly8x8x4_t;
typedef struct poly8x16x4_t { poly8x16_t val[4]; } poly8x16x4_t;
typedef struct poly16x4x2_t { poly16x4_t val[2]; } poly16x4x2_t;
typedef struct poly16x8x2_t { poly16x8_t val[2]; } poly16x8x2_t;
typedef struct poly16x4x3_t { poly16x4_t val[3]; } poly16x4x3_t;
typedef struct poly16x8x3_t { poly16x8_t val[3]; } poly16x8x3_t;
typedef struct poly16x4x4_t { poly16x4_t val[4]; } poly16x4x4_t;
typedef struct poly16x8x4_t { poly16x8_t val[4]; } poly16x8x4_t;
typedef struct poly64x1x2_t { poly64x1_t val[2]; } poly64x1x2_t;
typedef struct poly64x2x2_t { poly64x2_t val[2]; } poly64x2x2_t;
typedef struct poly64x1x3_t { poly64x1_t val[3]; } poly64x1x3_t;
typedef struct poly64x2x3_t { poly64x2_t val[3]; } poly64x2x3_t;
typedef struct poly64x1x4_t { poly64x1_t val[4]; } poly64x1x4_t;
typedef struct poly64x2x4_t { poly64x2_t val[4]; } poly64x2x4_t;

/* int8x8_t */
__BUN_CC_INTRIN int8x8_t vdup_n_s8(int8_t __x) { return (int8x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN int8x8_t vmov_n_s8(int8_t __x) { return (int8x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN int8x8_t vld1_s8(const int8_t *__p) { return *(const int8x8_t *)__p; }
__BUN_CC_INTRIN int8x8_t vld1_dup_s8(const int8_t *__p) { return vdup_n_s8(*__p); }
__BUN_CC_INTRIN void vst1_s8(int8_t *__p, int8x8_t __v) { *(int8x8_t *)__p = __v; }
#define vget_lane_s8(v, lane) ((((int8x8_t)(v)))[lane])
#define vset_lane_s8(x, v, lane) __extension__({ int8x8_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN int8x8_t vcreate_s8(uint64_t __x) { return (int8x8_t)__x; }
__BUN_CC_INTRIN int8x8_t vget_low_s8(int8x16_t __a) { return __builtin_shufflevector(__a, __a, 0, 1, 2, 3, 4, 5, 6, 7); }
__BUN_CC_INTRIN int8x8_t vget_high_s8(int8x16_t __a) { return __builtin_shufflevector(__a, __a, 8, 9, 10, 11, 12, 13, 14, 15); }
__BUN_CC_INTRIN int8x16_t vcombine_s8(int8x8_t __lo, int8x8_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15); }

/* uint8x8_t */
__BUN_CC_INTRIN uint8x8_t vdup_n_u8(uint8_t __x) { return (uint8x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN uint8x8_t vmov_n_u8(uint8_t __x) { return (uint8x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN uint8x8_t vld1_u8(const uint8_t *__p) { return *(const uint8x8_t *)__p; }
__BUN_CC_INTRIN uint8x8_t vld1_dup_u8(const uint8_t *__p) { return vdup_n_u8(*__p); }
__BUN_CC_INTRIN void vst1_u8(uint8_t *__p, uint8x8_t __v) { *(uint8x8_t *)__p = __v; }
#define vget_lane_u8(v, lane) ((((uint8x8_t)(v)))[lane])
#define vset_lane_u8(x, v, lane) __extension__({ uint8x8_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN uint8x8_t vcreate_u8(uint64_t __x) { return (uint8x8_t)__x; }
__BUN_CC_INTRIN uint8x8_t vget_low_u8(uint8x16_t __a) { return __builtin_shufflevector(__a, __a, 0, 1, 2, 3, 4, 5, 6, 7); }
__BUN_CC_INTRIN uint8x8_t vget_high_u8(uint8x16_t __a) { return __builtin_shufflevector(__a, __a, 8, 9, 10, 11, 12, 13, 14, 15); }
__BUN_CC_INTRIN uint8x16_t vcombine_u8(uint8x8_t __lo, uint8x8_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15); }

/* int16x4_t */
__BUN_CC_INTRIN int16x4_t vdup_n_s16(int16_t __x) { return (int16x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN int16x4_t vmov_n_s16(int16_t __x) { return (int16x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN int16x4_t vld1_s16(const int16_t *__p) { return *(const int16x4_t *)__p; }
__BUN_CC_INTRIN int16x4_t vld1_dup_s16(const int16_t *__p) { return vdup_n_s16(*__p); }
__BUN_CC_INTRIN void vst1_s16(int16_t *__p, int16x4_t __v) { *(int16x4_t *)__p = __v; }
#define vget_lane_s16(v, lane) ((((int16x4_t)(v)))[lane])
#define vset_lane_s16(x, v, lane) __extension__({ int16x4_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN int16x4_t vcreate_s16(uint64_t __x) { return (int16x4_t)__x; }
__BUN_CC_INTRIN int16x4_t vget_low_s16(int16x8_t __a) { return __builtin_shufflevector(__a, __a, 0, 1, 2, 3); }
__BUN_CC_INTRIN int16x4_t vget_high_s16(int16x8_t __a) { return __builtin_shufflevector(__a, __a, 4, 5, 6, 7); }
__BUN_CC_INTRIN int16x8_t vcombine_s16(int16x4_t __lo, int16x4_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1, 2, 3, 4, 5, 6, 7); }

/* uint16x4_t */
__BUN_CC_INTRIN uint16x4_t vdup_n_u16(uint16_t __x) { return (uint16x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN uint16x4_t vmov_n_u16(uint16_t __x) { return (uint16x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN uint16x4_t vld1_u16(const uint16_t *__p) { return *(const uint16x4_t *)__p; }
__BUN_CC_INTRIN uint16x4_t vld1_dup_u16(const uint16_t *__p) { return vdup_n_u16(*__p); }
__BUN_CC_INTRIN void vst1_u16(uint16_t *__p, uint16x4_t __v) { *(uint16x4_t *)__p = __v; }
#define vget_lane_u16(v, lane) ((((uint16x4_t)(v)))[lane])
#define vset_lane_u16(x, v, lane) __extension__({ uint16x4_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN uint16x4_t vcreate_u16(uint64_t __x) { return (uint16x4_t)__x; }
__BUN_CC_INTRIN uint16x4_t vget_low_u16(uint16x8_t __a) { return __builtin_shufflevector(__a, __a, 0, 1, 2, 3); }
__BUN_CC_INTRIN uint16x4_t vget_high_u16(uint16x8_t __a) { return __builtin_shufflevector(__a, __a, 4, 5, 6, 7); }
__BUN_CC_INTRIN uint16x8_t vcombine_u16(uint16x4_t __lo, uint16x4_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1, 2, 3, 4, 5, 6, 7); }

/* int32x2_t */
__BUN_CC_INTRIN int32x2_t vdup_n_s32(int32_t __x) { return (int32x2_t){__x, __x}; }
__BUN_CC_INTRIN int32x2_t vmov_n_s32(int32_t __x) { return (int32x2_t){__x, __x}; }
__BUN_CC_INTRIN int32x2_t vld1_s32(const int32_t *__p) { return *(const int32x2_t *)__p; }
__BUN_CC_INTRIN int32x2_t vld1_dup_s32(const int32_t *__p) { return vdup_n_s32(*__p); }
__BUN_CC_INTRIN void vst1_s32(int32_t *__p, int32x2_t __v) { *(int32x2_t *)__p = __v; }
#define vget_lane_s32(v, lane) ((((int32x2_t)(v)))[lane])
#define vset_lane_s32(x, v, lane) __extension__({ int32x2_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN int32x2_t vcreate_s32(uint64_t __x) { return (int32x2_t)__x; }
__BUN_CC_INTRIN int32x2_t vget_low_s32(int32x4_t __a) { return __builtin_shufflevector(__a, __a, 0, 1); }
__BUN_CC_INTRIN int32x2_t vget_high_s32(int32x4_t __a) { return __builtin_shufflevector(__a, __a, 2, 3); }
__BUN_CC_INTRIN int32x4_t vcombine_s32(int32x2_t __lo, int32x2_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1, 2, 3); }

/* uint32x2_t */
__BUN_CC_INTRIN uint32x2_t vdup_n_u32(uint32_t __x) { return (uint32x2_t){__x, __x}; }
__BUN_CC_INTRIN uint32x2_t vmov_n_u32(uint32_t __x) { return (uint32x2_t){__x, __x}; }
__BUN_CC_INTRIN uint32x2_t vld1_u32(const uint32_t *__p) { return *(const uint32x2_t *)__p; }
__BUN_CC_INTRIN uint32x2_t vld1_dup_u32(const uint32_t *__p) { return vdup_n_u32(*__p); }
__BUN_CC_INTRIN void vst1_u32(uint32_t *__p, uint32x2_t __v) { *(uint32x2_t *)__p = __v; }
#define vget_lane_u32(v, lane) ((((uint32x2_t)(v)))[lane])
#define vset_lane_u32(x, v, lane) __extension__({ uint32x2_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN uint32x2_t vcreate_u32(uint64_t __x) { return (uint32x2_t)__x; }
__BUN_CC_INTRIN uint32x2_t vget_low_u32(uint32x4_t __a) { return __builtin_shufflevector(__a, __a, 0, 1); }
__BUN_CC_INTRIN uint32x2_t vget_high_u32(uint32x4_t __a) { return __builtin_shufflevector(__a, __a, 2, 3); }
__BUN_CC_INTRIN uint32x4_t vcombine_u32(uint32x2_t __lo, uint32x2_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1, 2, 3); }

/* int64x1_t */
__BUN_CC_INTRIN int64x1_t vdup_n_s64(int64_t __x) { return (int64x1_t){__x}; }
__BUN_CC_INTRIN int64x1_t vmov_n_s64(int64_t __x) { return (int64x1_t){__x}; }
__BUN_CC_INTRIN int64x1_t vld1_s64(const int64_t *__p) { return *(const int64x1_t *)__p; }
__BUN_CC_INTRIN int64x1_t vld1_dup_s64(const int64_t *__p) { return vdup_n_s64(*__p); }
__BUN_CC_INTRIN void vst1_s64(int64_t *__p, int64x1_t __v) { *(int64x1_t *)__p = __v; }
#define vget_lane_s64(v, lane) ((((int64x1_t)(v)))[lane])
#define vset_lane_s64(x, v, lane) __extension__({ int64x1_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN int64x1_t vcreate_s64(uint64_t __x) { return (int64x1_t)__x; }
__BUN_CC_INTRIN int64x1_t vget_low_s64(int64x2_t __a) { return __builtin_shufflevector(__a, __a, 0); }
__BUN_CC_INTRIN int64x1_t vget_high_s64(int64x2_t __a) { return __builtin_shufflevector(__a, __a, 1); }
__BUN_CC_INTRIN int64x2_t vcombine_s64(int64x1_t __lo, int64x1_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1); }

/* uint64x1_t */
__BUN_CC_INTRIN uint64x1_t vdup_n_u64(uint64_t __x) { return (uint64x1_t){__x}; }
__BUN_CC_INTRIN uint64x1_t vmov_n_u64(uint64_t __x) { return (uint64x1_t){__x}; }
__BUN_CC_INTRIN uint64x1_t vld1_u64(const uint64_t *__p) { return *(const uint64x1_t *)__p; }
__BUN_CC_INTRIN uint64x1_t vld1_dup_u64(const uint64_t *__p) { return vdup_n_u64(*__p); }
__BUN_CC_INTRIN void vst1_u64(uint64_t *__p, uint64x1_t __v) { *(uint64x1_t *)__p = __v; }
#define vget_lane_u64(v, lane) ((((uint64x1_t)(v)))[lane])
#define vset_lane_u64(x, v, lane) __extension__({ uint64x1_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN uint64x1_t vcreate_u64(uint64_t __x) { return (uint64x1_t)__x; }
__BUN_CC_INTRIN uint64x1_t vget_low_u64(uint64x2_t __a) { return __builtin_shufflevector(__a, __a, 0); }
__BUN_CC_INTRIN uint64x1_t vget_high_u64(uint64x2_t __a) { return __builtin_shufflevector(__a, __a, 1); }
__BUN_CC_INTRIN uint64x2_t vcombine_u64(uint64x1_t __lo, uint64x1_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1); }

/* float32x2_t */
__BUN_CC_INTRIN float32x2_t vdup_n_f32(float32_t __x) { return (float32x2_t){__x, __x}; }
__BUN_CC_INTRIN float32x2_t vmov_n_f32(float32_t __x) { return (float32x2_t){__x, __x}; }
__BUN_CC_INTRIN float32x2_t vld1_f32(const float32_t *__p) { return *(const float32x2_t *)__p; }
__BUN_CC_INTRIN float32x2_t vld1_dup_f32(const float32_t *__p) { return vdup_n_f32(*__p); }
__BUN_CC_INTRIN void vst1_f32(float32_t *__p, float32x2_t __v) { *(float32x2_t *)__p = __v; }
#define vget_lane_f32(v, lane) ((((float32x2_t)(v)))[lane])
#define vset_lane_f32(x, v, lane) __extension__({ float32x2_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN float32x2_t vcreate_f32(uint64_t __x) { return (float32x2_t)__x; }
__BUN_CC_INTRIN float32x2_t vget_low_f32(float32x4_t __a) { return __builtin_shufflevector(__a, __a, 0, 1); }
__BUN_CC_INTRIN float32x2_t vget_high_f32(float32x4_t __a) { return __builtin_shufflevector(__a, __a, 2, 3); }
__BUN_CC_INTRIN float32x4_t vcombine_f32(float32x2_t __lo, float32x2_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1, 2, 3); }

/* float64x1_t */
__BUN_CC_INTRIN float64x1_t vdup_n_f64(float64_t __x) { return (float64x1_t){__x}; }
__BUN_CC_INTRIN float64x1_t vmov_n_f64(float64_t __x) { return (float64x1_t){__x}; }
__BUN_CC_INTRIN float64x1_t vld1_f64(const float64_t *__p) { return *(const float64x1_t *)__p; }
__BUN_CC_INTRIN float64x1_t vld1_dup_f64(const float64_t *__p) { return vdup_n_f64(*__p); }
__BUN_CC_INTRIN void vst1_f64(float64_t *__p, float64x1_t __v) { *(float64x1_t *)__p = __v; }
#define vget_lane_f64(v, lane) ((((float64x1_t)(v)))[lane])
#define vset_lane_f64(x, v, lane) __extension__({ float64x1_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN float64x1_t vcreate_f64(uint64_t __x) { return (float64x1_t)__x; }
__BUN_CC_INTRIN float64x1_t vget_low_f64(float64x2_t __a) { return __builtin_shufflevector(__a, __a, 0); }
__BUN_CC_INTRIN float64x1_t vget_high_f64(float64x2_t __a) { return __builtin_shufflevector(__a, __a, 1); }
__BUN_CC_INTRIN float64x2_t vcombine_f64(float64x1_t __lo, float64x1_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1); }

/* poly8x8_t */
__BUN_CC_INTRIN poly8x8_t vdup_n_p8(poly8_t __x) { return (poly8x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN poly8x8_t vmov_n_p8(poly8_t __x) { return (poly8x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN poly8x8_t vld1_p8(const poly8_t *__p) { return *(const poly8x8_t *)__p; }
__BUN_CC_INTRIN poly8x8_t vld1_dup_p8(const poly8_t *__p) { return vdup_n_p8(*__p); }
__BUN_CC_INTRIN void vst1_p8(poly8_t *__p, poly8x8_t __v) { *(poly8x8_t *)__p = __v; }
#define vget_lane_p8(v, lane) ((((poly8x8_t)(v)))[lane])
#define vset_lane_p8(x, v, lane) __extension__({ poly8x8_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN poly8x8_t vcreate_p8(uint64_t __x) { return (poly8x8_t)__x; }
__BUN_CC_INTRIN poly8x8_t vget_low_p8(poly8x16_t __a) { return __builtin_shufflevector(__a, __a, 0, 1, 2, 3, 4, 5, 6, 7); }
__BUN_CC_INTRIN poly8x8_t vget_high_p8(poly8x16_t __a) { return __builtin_shufflevector(__a, __a, 8, 9, 10, 11, 12, 13, 14, 15); }
__BUN_CC_INTRIN poly8x16_t vcombine_p8(poly8x8_t __lo, poly8x8_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15); }
__BUN_CC_INTRIN poly8x16_t vdupq_n_p8(poly8_t __x) { return (poly8x16_t){__x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN poly8x16_t vld1q_p8(const poly8_t *__p) { return *(const poly8x16_t *)__p; }
__BUN_CC_INTRIN void vst1q_p8(poly8_t *__p, poly8x16_t __v) { *(poly8x16_t *)__p = __v; }
#define vgetq_lane_p8(v, lane) ((((poly8x16_t)(v)))[lane])
#define vsetq_lane_p8(x, v, lane) __extension__({ poly8x16_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN poly8x8_t vbsl_p8(uint8x8_t __m, poly8x8_t __a, poly8x8_t __b) { return (poly8x8_t)((__m & (uint8x8_t)__a) | (~__m & (uint8x8_t)__b)); }
__BUN_CC_INTRIN poly8x16_t vbslq_p8(uint8x16_t __m, poly8x16_t __a, poly8x16_t __b) { return (poly8x16_t)((__m & (uint8x16_t)__a) | (~__m & (uint8x16_t)__b)); }

/* poly16x4_t */
__BUN_CC_INTRIN poly16x4_t vdup_n_p16(poly16_t __x) { return (poly16x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN poly16x4_t vmov_n_p16(poly16_t __x) { return (poly16x4_t){__x, __x, __x, __x}; }
__BUN_CC_INTRIN poly16x4_t vld1_p16(const poly16_t *__p) { return *(const poly16x4_t *)__p; }
__BUN_CC_INTRIN poly16x4_t vld1_dup_p16(const poly16_t *__p) { return vdup_n_p16(*__p); }
__BUN_CC_INTRIN void vst1_p16(poly16_t *__p, poly16x4_t __v) { *(poly16x4_t *)__p = __v; }
#define vget_lane_p16(v, lane) ((((poly16x4_t)(v)))[lane])
#define vset_lane_p16(x, v, lane) __extension__({ poly16x4_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN poly16x4_t vcreate_p16(uint64_t __x) { return (poly16x4_t)__x; }
__BUN_CC_INTRIN poly16x4_t vget_low_p16(poly16x8_t __a) { return __builtin_shufflevector(__a, __a, 0, 1, 2, 3); }
__BUN_CC_INTRIN poly16x4_t vget_high_p16(poly16x8_t __a) { return __builtin_shufflevector(__a, __a, 4, 5, 6, 7); }
__BUN_CC_INTRIN poly16x8_t vcombine_p16(poly16x4_t __lo, poly16x4_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1, 2, 3, 4, 5, 6, 7); }
__BUN_CC_INTRIN poly16x8_t vdupq_n_p16(poly16_t __x) { return (poly16x8_t){__x, __x, __x, __x, __x, __x, __x, __x}; }
__BUN_CC_INTRIN poly16x8_t vld1q_p16(const poly16_t *__p) { return *(const poly16x8_t *)__p; }
__BUN_CC_INTRIN void vst1q_p16(poly16_t *__p, poly16x8_t __v) { *(poly16x8_t *)__p = __v; }
#define vgetq_lane_p16(v, lane) ((((poly16x8_t)(v)))[lane])
#define vsetq_lane_p16(x, v, lane) __extension__({ poly16x8_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN poly16x4_t vbsl_p16(uint16x4_t __m, poly16x4_t __a, poly16x4_t __b) { return (poly16x4_t)((__m & (uint16x4_t)__a) | (~__m & (uint16x4_t)__b)); }
__BUN_CC_INTRIN poly16x8_t vbslq_p16(uint16x8_t __m, poly16x8_t __a, poly16x8_t __b) { return (poly16x8_t)((__m & (uint16x8_t)__a) | (~__m & (uint16x8_t)__b)); }

/* poly64x1_t */
__BUN_CC_INTRIN poly64x1_t vdup_n_p64(poly64_t __x) { return (poly64x1_t){__x}; }
__BUN_CC_INTRIN poly64x1_t vmov_n_p64(poly64_t __x) { return (poly64x1_t){__x}; }
__BUN_CC_INTRIN poly64x1_t vld1_p64(const poly64_t *__p) { return *(const poly64x1_t *)__p; }
__BUN_CC_INTRIN poly64x1_t vld1_dup_p64(const poly64_t *__p) { return vdup_n_p64(*__p); }
__BUN_CC_INTRIN void vst1_p64(poly64_t *__p, poly64x1_t __v) { *(poly64x1_t *)__p = __v; }
#define vget_lane_p64(v, lane) ((((poly64x1_t)(v)))[lane])
#define vset_lane_p64(x, v, lane) __extension__({ poly64x1_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN poly64x1_t vcreate_p64(uint64_t __x) { return (poly64x1_t)__x; }
__BUN_CC_INTRIN poly64x1_t vget_low_p64(poly64x2_t __a) { return __builtin_shufflevector(__a, __a, 0); }
__BUN_CC_INTRIN poly64x1_t vget_high_p64(poly64x2_t __a) { return __builtin_shufflevector(__a, __a, 1); }
__BUN_CC_INTRIN poly64x2_t vcombine_p64(poly64x1_t __lo, poly64x1_t __hi) { return __builtin_shufflevector(__lo, __hi, 0, 1); }
__BUN_CC_INTRIN poly64x2_t vdupq_n_p64(poly64_t __x) { return (poly64x2_t){__x, __x}; }
__BUN_CC_INTRIN poly64x2_t vld1q_p64(const poly64_t *__p) { return *(const poly64x2_t *)__p; }
__BUN_CC_INTRIN void vst1q_p64(poly64_t *__p, poly64x2_t __v) { *(poly64x2_t *)__p = __v; }
#define vgetq_lane_p64(v, lane) ((((poly64x2_t)(v)))[lane])
#define vsetq_lane_p64(x, v, lane) __extension__({ poly64x2_t __bun_v = (v); __bun_v[lane] = (x); __bun_v; })
__BUN_CC_INTRIN poly64x1_t vbsl_p64(uint64x1_t __m, poly64x1_t __a, poly64x1_t __b) { return (poly64x1_t)((__m & (uint64x1_t)__a) | (~__m & (uint64x1_t)__b)); }
__BUN_CC_INTRIN poly64x2_t vbslq_p64(uint64x2_t __m, poly64x2_t __a, poly64x2_t __b) { return (poly64x2_t)((__m & (uint64x2_t)__a) | (~__m & (uint64x2_t)__b)); }

/* int8x8_t: arithmetic */
__BUN_CC_INTRIN int8x8_t vadd_s8(int8x8_t __a, int8x8_t __b) { return __a + __b; }
__BUN_CC_INTRIN int8x8_t vsub_s8(int8x8_t __a, int8x8_t __b) { return __a - __b; }
__BUN_CC_INTRIN int8x8_t vmul_s8(int8x8_t __a, int8x8_t __b) { return __a * __b; }
__BUN_CC_INTRIN int8x8_t vmla_s8(int8x8_t __a, int8x8_t __b, int8x8_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN int8x8_t vmls_s8(int8x8_t __a, int8x8_t __b, int8x8_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN int8x8_t vmin_s8(int8x8_t __a, int8x8_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int8x8_t vmax_s8(int8x8_t __a, int8x8_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN int8x8_t vneg_s8(int8x8_t __a) { return -__a; }
__BUN_CC_INTRIN int8x8_t vabs_s8(int8x8_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN int8x8_t vand_s8(int8x8_t __a, int8x8_t __b) { return __a & __b; }
__BUN_CC_INTRIN int8x8_t vorr_s8(int8x8_t __a, int8x8_t __b) { return __a | __b; }
__BUN_CC_INTRIN int8x8_t veor_s8(int8x8_t __a, int8x8_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN int8x8_t vbic_s8(int8x8_t __a, int8x8_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN int8x8_t vorn_s8(int8x8_t __a, int8x8_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN int8x16_t vornq_s8(int8x16_t __a, int8x16_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN int8x8_t vmvn_s8(int8x8_t __a) { return ~__a; }
__BUN_CC_INTRIN int8x8_t vshl_n_s8(int8x8_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN int8x8_t vshr_n_s8(int8x8_t __a, int __n) { return __a >> (__n >= 8 ? 7 : __n); }
__BUN_CC_INTRIN int8x8_t vsra_n_s8(int8x8_t __a, int8x8_t __b, int __n) { return __a + vshr_n_s8(__b, __n); }
__BUN_CC_INTRIN int8x8_t vrshr_n_s8(int8x8_t __a, int __n) { return vshr_n_s8(__a, __n) + (vshr_n_s8(__a, __n - 1) & vdup_n_s8(1)); }
__BUN_CC_INTRIN uint8x8_t vtst_s8(int8x8_t __a, int8x8_t __b) { return (uint8x8_t)((__a & __b) != 0); }
__BUN_CC_INTRIN int8x8_t vsli_n_s8(int8x8_t __a, int8x8_t __b, int __n) { return (int8x8_t)(((uint8x8_t)__a & ~(~vdup_n_u8(0) << __n)) | ((uint8x8_t)__b << __n)); }
__BUN_CC_INTRIN int8x8_t vsri_n_s8(int8x8_t __a, int8x8_t __b, int __n) { return __n >= 8 ? __a : (int8x8_t)(((uint8x8_t)__a & ~(~vdup_n_u8(0) >> __n)) | ((uint8x8_t)__b >> __n)); }
__BUN_CC_INTRIN int8x8_t vhadd_s8(int8x8_t __a, int8x8_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int8x8_t vrhadd_s8(int8x8_t __a, int8x8_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int8x8_t vhsub_s8(int8x8_t __a, int8x8_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN int8x16_t vsraq_n_s8(int8x16_t __a, int8x16_t __b, int __n) { return __a + vshrq_n_s8(__b, __n); }
__BUN_CC_INTRIN int8x16_t vrshrq_n_s8(int8x16_t __a, int __n) { return vshrq_n_s8(__a, __n) + (vshrq_n_s8(__a, __n - 1) & vdupq_n_s8(1)); }
__BUN_CC_INTRIN uint8x16_t vtstq_s8(int8x16_t __a, int8x16_t __b) { return (uint8x16_t)((__a & __b) != 0); }
__BUN_CC_INTRIN int8x16_t vsliq_n_s8(int8x16_t __a, int8x16_t __b, int __n) { return (int8x16_t)(((uint8x16_t)__a & ~(~vdupq_n_u8(0) << __n)) | ((uint8x16_t)__b << __n)); }
__BUN_CC_INTRIN int8x16_t vsriq_n_s8(int8x16_t __a, int8x16_t __b, int __n) { return __n >= 8 ? __a : (int8x16_t)(((uint8x16_t)__a & ~(~vdupq_n_u8(0) >> __n)) | ((uint8x16_t)__b >> __n)); }
__BUN_CC_INTRIN int8x16_t vhaddq_s8(int8x16_t __a, int8x16_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int8x16_t vrhaddq_s8(int8x16_t __a, int8x16_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int8x16_t vhsubq_s8(int8x16_t __a, int8x16_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN uint8x8_t vceq_s8(int8x8_t __a, int8x8_t __b) { return (uint8x8_t)(__a == __b); }
__BUN_CC_INTRIN uint8x8_t vcgt_s8(int8x8_t __a, int8x8_t __b) { return (uint8x8_t)(__a > __b); }
__BUN_CC_INTRIN uint8x8_t vclt_s8(int8x8_t __a, int8x8_t __b) { return (uint8x8_t)(__a < __b); }
__BUN_CC_INTRIN uint8x8_t vcge_s8(int8x8_t __a, int8x8_t __b) { return (uint8x8_t)(__a >= __b); }
__BUN_CC_INTRIN uint8x8_t vcle_s8(int8x8_t __a, int8x8_t __b) { return (uint8x8_t)(__a <= __b); }
__BUN_CC_INTRIN uint8x8_t vceqz_s8(int8x8_t __a) { return (uint8x8_t)(__a == 0); }
__BUN_CC_INTRIN uint8x16_t vceqzq_s8(int8x16_t __a) { return (uint8x16_t)(__a == 0); }
__BUN_CC_INTRIN int8x8_t vbsl_s8(uint8x8_t __m, int8x8_t __a, int8x8_t __b) { return (int8x8_t)((__m & (uint8x8_t)__a) | (~__m & (uint8x8_t)__b)); }
__BUN_CC_INTRIN int8_t vaddv_s8(int8x8_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN int8_t vmaxv_s8(int8x8_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN int8_t vminv_s8(int8x8_t __a) { return __builtin_reduce_min(__a); }
__BUN_CC_INTRIN int8x8_t vpadd_s8(int8x8_t __a, int8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN int8x8_t vpmax_s8(int8x8_t __a, int8x8_t __b) { return __builtin_elementwise_max(__builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14), __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15)); }
__BUN_CC_INTRIN int8x8_t vpmin_s8(int8x8_t __a, int8x8_t __b) { return __builtin_elementwise_min(__builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14), __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15)); }
__BUN_CC_INTRIN int8x8_t vabd_s8(int8x8_t __a, int8x8_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int8x16_t vabdq_s8(int8x16_t __a, int8x16_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int8x8_t vqadd_s8(int8x8_t __a, int8x8_t __b) { return __builtin_elementwise_add_sat(__a, __b); }
__BUN_CC_INTRIN int8x8_t vqsub_s8(int8x8_t __a, int8x8_t __b) { return __builtin_elementwise_sub_sat(__a, __b); }

/* uint8x8_t: arithmetic */
__BUN_CC_INTRIN uint8x8_t vadd_u8(uint8x8_t __a, uint8x8_t __b) { return __a + __b; }
__BUN_CC_INTRIN uint8x8_t vsub_u8(uint8x8_t __a, uint8x8_t __b) { return __a - __b; }
__BUN_CC_INTRIN uint8x8_t vmul_u8(uint8x8_t __a, uint8x8_t __b) { return __a * __b; }
__BUN_CC_INTRIN uint8x8_t vmla_u8(uint8x8_t __a, uint8x8_t __b, uint8x8_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN uint8x8_t vmls_u8(uint8x8_t __a, uint8x8_t __b, uint8x8_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN uint8x8_t vmin_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint8x8_t vmax_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN uint8x8_t vand_u8(uint8x8_t __a, uint8x8_t __b) { return __a & __b; }
__BUN_CC_INTRIN uint8x8_t vorr_u8(uint8x8_t __a, uint8x8_t __b) { return __a | __b; }
__BUN_CC_INTRIN uint8x8_t veor_u8(uint8x8_t __a, uint8x8_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN uint8x8_t vbic_u8(uint8x8_t __a, uint8x8_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN uint8x8_t vorn_u8(uint8x8_t __a, uint8x8_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN uint8x16_t vornq_u8(uint8x16_t __a, uint8x16_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN uint8x8_t vmvn_u8(uint8x8_t __a) { return ~__a; }
__BUN_CC_INTRIN uint8x8_t vshl_n_u8(uint8x8_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN uint8x8_t vshr_n_u8(uint8x8_t __a, int __n) { return __n >= 8 ? vdup_n_u8(0) : __a >> __n; }
__BUN_CC_INTRIN uint8x8_t vsra_n_u8(uint8x8_t __a, uint8x8_t __b, int __n) { return __a + vshr_n_u8(__b, __n); }
__BUN_CC_INTRIN uint8x8_t vrshr_n_u8(uint8x8_t __a, int __n) { return vshr_n_u8(__a, __n) + (vshr_n_u8(__a, __n - 1) & vdup_n_u8(1)); }
__BUN_CC_INTRIN uint8x8_t vtst_u8(uint8x8_t __a, uint8x8_t __b) { return (uint8x8_t)((__a & __b) != 0); }
__BUN_CC_INTRIN uint8x8_t vsli_n_u8(uint8x8_t __a, uint8x8_t __b, int __n) { return (uint8x8_t)(((uint8x8_t)__a & ~(~vdup_n_u8(0) << __n)) | ((uint8x8_t)__b << __n)); }
__BUN_CC_INTRIN uint8x8_t vsri_n_u8(uint8x8_t __a, uint8x8_t __b, int __n) { return __n >= 8 ? __a : (uint8x8_t)(((uint8x8_t)__a & ~(~vdup_n_u8(0) >> __n)) | ((uint8x8_t)__b >> __n)); }
__BUN_CC_INTRIN uint8x8_t vhadd_u8(uint8x8_t __a, uint8x8_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint8x8_t vrhadd_u8(uint8x8_t __a, uint8x8_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint8x8_t vhsub_u8(uint8x8_t __a, uint8x8_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN uint8x16_t vsraq_n_u8(uint8x16_t __a, uint8x16_t __b, int __n) { return __a + vshrq_n_u8(__b, __n); }
__BUN_CC_INTRIN uint8x16_t vrshrq_n_u8(uint8x16_t __a, int __n) { return vshrq_n_u8(__a, __n) + (vshrq_n_u8(__a, __n - 1) & vdupq_n_u8(1)); }
__BUN_CC_INTRIN uint8x16_t vtstq_u8(uint8x16_t __a, uint8x16_t __b) { return (uint8x16_t)((__a & __b) != 0); }
__BUN_CC_INTRIN uint8x16_t vsliq_n_u8(uint8x16_t __a, uint8x16_t __b, int __n) { return (uint8x16_t)(((uint8x16_t)__a & ~(~vdupq_n_u8(0) << __n)) | ((uint8x16_t)__b << __n)); }
__BUN_CC_INTRIN uint8x16_t vsriq_n_u8(uint8x16_t __a, uint8x16_t __b, int __n) { return __n >= 8 ? __a : (uint8x16_t)(((uint8x16_t)__a & ~(~vdupq_n_u8(0) >> __n)) | ((uint8x16_t)__b >> __n)); }
__BUN_CC_INTRIN uint8x16_t vhaddq_u8(uint8x16_t __a, uint8x16_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint8x16_t vhsubq_u8(uint8x16_t __a, uint8x16_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN uint8x8_t vceq_u8(uint8x8_t __a, uint8x8_t __b) { return (uint8x8_t)(__a == __b); }
__BUN_CC_INTRIN uint8x8_t vcgt_u8(uint8x8_t __a, uint8x8_t __b) { return (uint8x8_t)(__a > __b); }
__BUN_CC_INTRIN uint8x8_t vclt_u8(uint8x8_t __a, uint8x8_t __b) { return (uint8x8_t)(__a < __b); }
__BUN_CC_INTRIN uint8x8_t vcge_u8(uint8x8_t __a, uint8x8_t __b) { return (uint8x8_t)(__a >= __b); }
__BUN_CC_INTRIN uint8x8_t vcle_u8(uint8x8_t __a, uint8x8_t __b) { return (uint8x8_t)(__a <= __b); }
__BUN_CC_INTRIN uint8x8_t vceqz_u8(uint8x8_t __a) { return (uint8x8_t)(__a == 0); }
__BUN_CC_INTRIN uint8x16_t vceqzq_u8(uint8x16_t __a) { return (uint8x16_t)(__a == 0); }
__BUN_CC_INTRIN uint8x8_t vbsl_u8(uint8x8_t __m, uint8x8_t __a, uint8x8_t __b) { return (uint8x8_t)((__m & (uint8x8_t)__a) | (~__m & (uint8x8_t)__b)); }
__BUN_CC_INTRIN uint8_t vaddv_u8(uint8x8_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN uint8_t vmaxv_u8(uint8x8_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN uint8_t vminv_u8(uint8x8_t __a) { return __builtin_reduce_min(__a); }
__BUN_CC_INTRIN uint8x8_t vpadd_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN uint8x8_t vpmax_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_elementwise_max(__builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14), __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15)); }
__BUN_CC_INTRIN uint8x8_t vpmin_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_elementwise_min(__builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14), __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15)); }
__BUN_CC_INTRIN uint8x8_t vabd_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint8x16_t vabdq_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint8x8_t vqadd_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_elementwise_add_sat(__a, __b); }
__BUN_CC_INTRIN uint8x8_t vqsub_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_elementwise_sub_sat(__a, __b); }

/* int16x4_t: arithmetic */
__BUN_CC_INTRIN int16x4_t vadd_s16(int16x4_t __a, int16x4_t __b) { return __a + __b; }
__BUN_CC_INTRIN int16x4_t vsub_s16(int16x4_t __a, int16x4_t __b) { return __a - __b; }
__BUN_CC_INTRIN int16x4_t vmul_s16(int16x4_t __a, int16x4_t __b) { return __a * __b; }
__BUN_CC_INTRIN int16x4_t vmla_s16(int16x4_t __a, int16x4_t __b, int16x4_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN int16x4_t vmls_s16(int16x4_t __a, int16x4_t __b, int16x4_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN int16x4_t vmul_n_s16(int16x4_t __a, int16_t __b) { return __a * vdup_n_s16(__b); }
__BUN_CC_INTRIN int16x8_t vmulq_n_s16(int16x8_t __a, int16_t __b) { return __a * vdupq_n_s16(__b); }
__BUN_CC_INTRIN int16x4_t vmla_n_s16(int16x4_t __a, int16x4_t __b, int16_t __c) { return __a + __b * vdup_n_s16(__c); }
__BUN_CC_INTRIN int16x8_t vmlaq_n_s16(int16x8_t __a, int16x8_t __b, int16_t __c) { return __a + __b * vdupq_n_s16(__c); }
__BUN_CC_INTRIN int16x4_t vmin_s16(int16x4_t __a, int16x4_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int16x4_t vmax_s16(int16x4_t __a, int16x4_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN int16x4_t vneg_s16(int16x4_t __a) { return -__a; }
__BUN_CC_INTRIN int16x4_t vabs_s16(int16x4_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN int16x4_t vand_s16(int16x4_t __a, int16x4_t __b) { return __a & __b; }
__BUN_CC_INTRIN int16x4_t vorr_s16(int16x4_t __a, int16x4_t __b) { return __a | __b; }
__BUN_CC_INTRIN int16x4_t veor_s16(int16x4_t __a, int16x4_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN int16x4_t vbic_s16(int16x4_t __a, int16x4_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN int16x4_t vorn_s16(int16x4_t __a, int16x4_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN int16x8_t vornq_s16(int16x8_t __a, int16x8_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN int16x4_t vmvn_s16(int16x4_t __a) { return ~__a; }
__BUN_CC_INTRIN int16x4_t vshl_n_s16(int16x4_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN int16x4_t vshr_n_s16(int16x4_t __a, int __n) { return __a >> (__n >= 16 ? 15 : __n); }
__BUN_CC_INTRIN int16x4_t vsra_n_s16(int16x4_t __a, int16x4_t __b, int __n) { return __a + vshr_n_s16(__b, __n); }
__BUN_CC_INTRIN int16x4_t vrshr_n_s16(int16x4_t __a, int __n) { return vshr_n_s16(__a, __n) + (vshr_n_s16(__a, __n - 1) & vdup_n_s16(1)); }
__BUN_CC_INTRIN uint16x4_t vtst_s16(int16x4_t __a, int16x4_t __b) { return (uint16x4_t)((__a & __b) != 0); }
__BUN_CC_INTRIN int16x4_t vsli_n_s16(int16x4_t __a, int16x4_t __b, int __n) { return (int16x4_t)(((uint16x4_t)__a & ~(~vdup_n_u16(0) << __n)) | ((uint16x4_t)__b << __n)); }
__BUN_CC_INTRIN int16x4_t vsri_n_s16(int16x4_t __a, int16x4_t __b, int __n) { return __n >= 16 ? __a : (int16x4_t)(((uint16x4_t)__a & ~(~vdup_n_u16(0) >> __n)) | ((uint16x4_t)__b >> __n)); }
__BUN_CC_INTRIN int16x4_t vhadd_s16(int16x4_t __a, int16x4_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int16x4_t vrhadd_s16(int16x4_t __a, int16x4_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int16x4_t vhsub_s16(int16x4_t __a, int16x4_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN int16x8_t vsraq_n_s16(int16x8_t __a, int16x8_t __b, int __n) { return __a + vshrq_n_s16(__b, __n); }
__BUN_CC_INTRIN int16x8_t vrshrq_n_s16(int16x8_t __a, int __n) { return vshrq_n_s16(__a, __n) + (vshrq_n_s16(__a, __n - 1) & vdupq_n_s16(1)); }
__BUN_CC_INTRIN uint16x8_t vtstq_s16(int16x8_t __a, int16x8_t __b) { return (uint16x8_t)((__a & __b) != 0); }
__BUN_CC_INTRIN int16x8_t vsliq_n_s16(int16x8_t __a, int16x8_t __b, int __n) { return (int16x8_t)(((uint16x8_t)__a & ~(~vdupq_n_u16(0) << __n)) | ((uint16x8_t)__b << __n)); }
__BUN_CC_INTRIN int16x8_t vsriq_n_s16(int16x8_t __a, int16x8_t __b, int __n) { return __n >= 16 ? __a : (int16x8_t)(((uint16x8_t)__a & ~(~vdupq_n_u16(0) >> __n)) | ((uint16x8_t)__b >> __n)); }
__BUN_CC_INTRIN int16x8_t vhaddq_s16(int16x8_t __a, int16x8_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int16x8_t vrhaddq_s16(int16x8_t __a, int16x8_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int16x8_t vhsubq_s16(int16x8_t __a, int16x8_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN uint16x4_t vceq_s16(int16x4_t __a, int16x4_t __b) { return (uint16x4_t)(__a == __b); }
__BUN_CC_INTRIN uint16x4_t vcgt_s16(int16x4_t __a, int16x4_t __b) { return (uint16x4_t)(__a > __b); }
__BUN_CC_INTRIN uint16x4_t vclt_s16(int16x4_t __a, int16x4_t __b) { return (uint16x4_t)(__a < __b); }
__BUN_CC_INTRIN uint16x4_t vcge_s16(int16x4_t __a, int16x4_t __b) { return (uint16x4_t)(__a >= __b); }
__BUN_CC_INTRIN uint16x4_t vcle_s16(int16x4_t __a, int16x4_t __b) { return (uint16x4_t)(__a <= __b); }
__BUN_CC_INTRIN uint16x4_t vceqz_s16(int16x4_t __a) { return (uint16x4_t)(__a == 0); }
__BUN_CC_INTRIN uint16x8_t vceqzq_s16(int16x8_t __a) { return (uint16x8_t)(__a == 0); }
__BUN_CC_INTRIN int16x4_t vbsl_s16(uint16x4_t __m, int16x4_t __a, int16x4_t __b) { return (int16x4_t)((__m & (uint16x4_t)__a) | (~__m & (uint16x4_t)__b)); }
__BUN_CC_INTRIN int16_t vaddv_s16(int16x4_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN int16_t vmaxv_s16(int16x4_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN int16_t vminv_s16(int16x4_t __a) { return __builtin_reduce_min(__a); }
__BUN_CC_INTRIN int16x4_t vpadd_s16(int16x4_t __a, int16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN int16x4_t vpmax_s16(int16x4_t __a, int16x4_t __b) { return __builtin_elementwise_max(__builtin_shufflevector(__a, __b, 0, 2, 4, 6), __builtin_shufflevector(__a, __b, 1, 3, 5, 7)); }
__BUN_CC_INTRIN int16x4_t vpmin_s16(int16x4_t __a, int16x4_t __b) { return __builtin_elementwise_min(__builtin_shufflevector(__a, __b, 0, 2, 4, 6), __builtin_shufflevector(__a, __b, 1, 3, 5, 7)); }
__BUN_CC_INTRIN int16x4_t vabd_s16(int16x4_t __a, int16x4_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int16x8_t vabdq_s16(int16x8_t __a, int16x8_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int16x4_t vqadd_s16(int16x4_t __a, int16x4_t __b) { return __builtin_elementwise_add_sat(__a, __b); }
__BUN_CC_INTRIN int16x4_t vqsub_s16(int16x4_t __a, int16x4_t __b) { return __builtin_elementwise_sub_sat(__a, __b); }

/* uint16x4_t: arithmetic */
__BUN_CC_INTRIN uint16x4_t vadd_u16(uint16x4_t __a, uint16x4_t __b) { return __a + __b; }
__BUN_CC_INTRIN uint16x4_t vsub_u16(uint16x4_t __a, uint16x4_t __b) { return __a - __b; }
__BUN_CC_INTRIN uint16x4_t vmul_u16(uint16x4_t __a, uint16x4_t __b) { return __a * __b; }
__BUN_CC_INTRIN uint16x4_t vmla_u16(uint16x4_t __a, uint16x4_t __b, uint16x4_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN uint16x4_t vmls_u16(uint16x4_t __a, uint16x4_t __b, uint16x4_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN uint16x4_t vmul_n_u16(uint16x4_t __a, uint16_t __b) { return __a * vdup_n_u16(__b); }
__BUN_CC_INTRIN uint16x8_t vmulq_n_u16(uint16x8_t __a, uint16_t __b) { return __a * vdupq_n_u16(__b); }
__BUN_CC_INTRIN uint16x4_t vmla_n_u16(uint16x4_t __a, uint16x4_t __b, uint16_t __c) { return __a + __b * vdup_n_u16(__c); }
__BUN_CC_INTRIN uint16x8_t vmlaq_n_u16(uint16x8_t __a, uint16x8_t __b, uint16_t __c) { return __a + __b * vdupq_n_u16(__c); }
__BUN_CC_INTRIN uint16x4_t vmin_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint16x4_t vmax_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN uint16x4_t vand_u16(uint16x4_t __a, uint16x4_t __b) { return __a & __b; }
__BUN_CC_INTRIN uint16x4_t vorr_u16(uint16x4_t __a, uint16x4_t __b) { return __a | __b; }
__BUN_CC_INTRIN uint16x4_t veor_u16(uint16x4_t __a, uint16x4_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN uint16x4_t vbic_u16(uint16x4_t __a, uint16x4_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN uint16x4_t vorn_u16(uint16x4_t __a, uint16x4_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN uint16x8_t vornq_u16(uint16x8_t __a, uint16x8_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN uint16x4_t vmvn_u16(uint16x4_t __a) { return ~__a; }
__BUN_CC_INTRIN uint16x4_t vshl_n_u16(uint16x4_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN uint16x4_t vshr_n_u16(uint16x4_t __a, int __n) { return __n >= 16 ? vdup_n_u16(0) : __a >> __n; }
__BUN_CC_INTRIN uint16x4_t vsra_n_u16(uint16x4_t __a, uint16x4_t __b, int __n) { return __a + vshr_n_u16(__b, __n); }
__BUN_CC_INTRIN uint16x4_t vrshr_n_u16(uint16x4_t __a, int __n) { return vshr_n_u16(__a, __n) + (vshr_n_u16(__a, __n - 1) & vdup_n_u16(1)); }
__BUN_CC_INTRIN uint16x4_t vtst_u16(uint16x4_t __a, uint16x4_t __b) { return (uint16x4_t)((__a & __b) != 0); }
__BUN_CC_INTRIN uint16x4_t vsli_n_u16(uint16x4_t __a, uint16x4_t __b, int __n) { return (uint16x4_t)(((uint16x4_t)__a & ~(~vdup_n_u16(0) << __n)) | ((uint16x4_t)__b << __n)); }
__BUN_CC_INTRIN uint16x4_t vsri_n_u16(uint16x4_t __a, uint16x4_t __b, int __n) { return __n >= 16 ? __a : (uint16x4_t)(((uint16x4_t)__a & ~(~vdup_n_u16(0) >> __n)) | ((uint16x4_t)__b >> __n)); }
__BUN_CC_INTRIN uint16x4_t vhadd_u16(uint16x4_t __a, uint16x4_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint16x4_t vrhadd_u16(uint16x4_t __a, uint16x4_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint16x4_t vhsub_u16(uint16x4_t __a, uint16x4_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN uint16x8_t vsraq_n_u16(uint16x8_t __a, uint16x8_t __b, int __n) { return __a + vshrq_n_u16(__b, __n); }
__BUN_CC_INTRIN uint16x8_t vrshrq_n_u16(uint16x8_t __a, int __n) { return vshrq_n_u16(__a, __n) + (vshrq_n_u16(__a, __n - 1) & vdupq_n_u16(1)); }
__BUN_CC_INTRIN uint16x8_t vtstq_u16(uint16x8_t __a, uint16x8_t __b) { return (uint16x8_t)((__a & __b) != 0); }
__BUN_CC_INTRIN uint16x8_t vsliq_n_u16(uint16x8_t __a, uint16x8_t __b, int __n) { return (uint16x8_t)(((uint16x8_t)__a & ~(~vdupq_n_u16(0) << __n)) | ((uint16x8_t)__b << __n)); }
__BUN_CC_INTRIN uint16x8_t vsriq_n_u16(uint16x8_t __a, uint16x8_t __b, int __n) { return __n >= 16 ? __a : (uint16x8_t)(((uint16x8_t)__a & ~(~vdupq_n_u16(0) >> __n)) | ((uint16x8_t)__b >> __n)); }
__BUN_CC_INTRIN uint16x8_t vhaddq_u16(uint16x8_t __a, uint16x8_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint16x8_t vhsubq_u16(uint16x8_t __a, uint16x8_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN uint16x4_t vceq_u16(uint16x4_t __a, uint16x4_t __b) { return (uint16x4_t)(__a == __b); }
__BUN_CC_INTRIN uint16x4_t vcgt_u16(uint16x4_t __a, uint16x4_t __b) { return (uint16x4_t)(__a > __b); }
__BUN_CC_INTRIN uint16x4_t vclt_u16(uint16x4_t __a, uint16x4_t __b) { return (uint16x4_t)(__a < __b); }
__BUN_CC_INTRIN uint16x4_t vcge_u16(uint16x4_t __a, uint16x4_t __b) { return (uint16x4_t)(__a >= __b); }
__BUN_CC_INTRIN uint16x4_t vcle_u16(uint16x4_t __a, uint16x4_t __b) { return (uint16x4_t)(__a <= __b); }
__BUN_CC_INTRIN uint16x4_t vceqz_u16(uint16x4_t __a) { return (uint16x4_t)(__a == 0); }
__BUN_CC_INTRIN uint16x8_t vceqzq_u16(uint16x8_t __a) { return (uint16x8_t)(__a == 0); }
__BUN_CC_INTRIN uint16x4_t vbsl_u16(uint16x4_t __m, uint16x4_t __a, uint16x4_t __b) { return (uint16x4_t)((__m & (uint16x4_t)__a) | (~__m & (uint16x4_t)__b)); }
__BUN_CC_INTRIN uint16_t vaddv_u16(uint16x4_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN uint16_t vmaxv_u16(uint16x4_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN uint16_t vminv_u16(uint16x4_t __a) { return __builtin_reduce_min(__a); }
__BUN_CC_INTRIN uint16x4_t vpadd_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6) + __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN uint16x4_t vpmax_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_elementwise_max(__builtin_shufflevector(__a, __b, 0, 2, 4, 6), __builtin_shufflevector(__a, __b, 1, 3, 5, 7)); }
__BUN_CC_INTRIN uint16x4_t vpmin_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_elementwise_min(__builtin_shufflevector(__a, __b, 0, 2, 4, 6), __builtin_shufflevector(__a, __b, 1, 3, 5, 7)); }
__BUN_CC_INTRIN uint16x4_t vabd_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint16x8_t vabdq_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint16x4_t vqadd_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_elementwise_add_sat(__a, __b); }
__BUN_CC_INTRIN uint16x4_t vqsub_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_elementwise_sub_sat(__a, __b); }

/* int32x2_t: arithmetic */
__BUN_CC_INTRIN int32x2_t vadd_s32(int32x2_t __a, int32x2_t __b) { return __a + __b; }
__BUN_CC_INTRIN int32x2_t vsub_s32(int32x2_t __a, int32x2_t __b) { return __a - __b; }
__BUN_CC_INTRIN int32x2_t vmul_s32(int32x2_t __a, int32x2_t __b) { return __a * __b; }
__BUN_CC_INTRIN int32x2_t vmla_s32(int32x2_t __a, int32x2_t __b, int32x2_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN int32x2_t vmls_s32(int32x2_t __a, int32x2_t __b, int32x2_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN int32x2_t vmul_n_s32(int32x2_t __a, int32_t __b) { return __a * vdup_n_s32(__b); }
__BUN_CC_INTRIN int32x4_t vmulq_n_s32(int32x4_t __a, int32_t __b) { return __a * vdupq_n_s32(__b); }
__BUN_CC_INTRIN int32x2_t vmla_n_s32(int32x2_t __a, int32x2_t __b, int32_t __c) { return __a + __b * vdup_n_s32(__c); }
__BUN_CC_INTRIN int32x4_t vmlaq_n_s32(int32x4_t __a, int32x4_t __b, int32_t __c) { return __a + __b * vdupq_n_s32(__c); }
__BUN_CC_INTRIN int32x2_t vmin_s32(int32x2_t __a, int32x2_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int32x2_t vmax_s32(int32x2_t __a, int32x2_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN int32x2_t vneg_s32(int32x2_t __a) { return -__a; }
__BUN_CC_INTRIN int32x2_t vabs_s32(int32x2_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN int32x2_t vand_s32(int32x2_t __a, int32x2_t __b) { return __a & __b; }
__BUN_CC_INTRIN int32x2_t vorr_s32(int32x2_t __a, int32x2_t __b) { return __a | __b; }
__BUN_CC_INTRIN int32x2_t veor_s32(int32x2_t __a, int32x2_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN int32x2_t vbic_s32(int32x2_t __a, int32x2_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN int32x2_t vorn_s32(int32x2_t __a, int32x2_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN int32x4_t vornq_s32(int32x4_t __a, int32x4_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN int32x2_t vmvn_s32(int32x2_t __a) { return ~__a; }
__BUN_CC_INTRIN int32x2_t vshl_n_s32(int32x2_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN int32x2_t vshr_n_s32(int32x2_t __a, int __n) { return __a >> (__n >= 32 ? 31 : __n); }
__BUN_CC_INTRIN int32x2_t vsra_n_s32(int32x2_t __a, int32x2_t __b, int __n) { return __a + vshr_n_s32(__b, __n); }
__BUN_CC_INTRIN int32x2_t vrshr_n_s32(int32x2_t __a, int __n) { return vshr_n_s32(__a, __n) + (vshr_n_s32(__a, __n - 1) & vdup_n_s32(1)); }
__BUN_CC_INTRIN uint32x2_t vtst_s32(int32x2_t __a, int32x2_t __b) { return (uint32x2_t)((__a & __b) != 0); }
__BUN_CC_INTRIN int32x2_t vsli_n_s32(int32x2_t __a, int32x2_t __b, int __n) { return (int32x2_t)(((uint32x2_t)__a & ~(~vdup_n_u32(0) << __n)) | ((uint32x2_t)__b << __n)); }
__BUN_CC_INTRIN int32x2_t vsri_n_s32(int32x2_t __a, int32x2_t __b, int __n) { return __n >= 32 ? __a : (int32x2_t)(((uint32x2_t)__a & ~(~vdup_n_u32(0) >> __n)) | ((uint32x2_t)__b >> __n)); }
__BUN_CC_INTRIN int32x2_t vhadd_s32(int32x2_t __a, int32x2_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int32x2_t vrhadd_s32(int32x2_t __a, int32x2_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int32x2_t vhsub_s32(int32x2_t __a, int32x2_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN int32x4_t vsraq_n_s32(int32x4_t __a, int32x4_t __b, int __n) { return __a + vshrq_n_s32(__b, __n); }
__BUN_CC_INTRIN int32x4_t vrshrq_n_s32(int32x4_t __a, int __n) { return vshrq_n_s32(__a, __n) + (vshrq_n_s32(__a, __n - 1) & vdupq_n_s32(1)); }
__BUN_CC_INTRIN uint32x4_t vtstq_s32(int32x4_t __a, int32x4_t __b) { return (uint32x4_t)((__a & __b) != 0); }
__BUN_CC_INTRIN int32x4_t vsliq_n_s32(int32x4_t __a, int32x4_t __b, int __n) { return (int32x4_t)(((uint32x4_t)__a & ~(~vdupq_n_u32(0) << __n)) | ((uint32x4_t)__b << __n)); }
__BUN_CC_INTRIN int32x4_t vsriq_n_s32(int32x4_t __a, int32x4_t __b, int __n) { return __n >= 32 ? __a : (int32x4_t)(((uint32x4_t)__a & ~(~vdupq_n_u32(0) >> __n)) | ((uint32x4_t)__b >> __n)); }
__BUN_CC_INTRIN int32x4_t vhaddq_s32(int32x4_t __a, int32x4_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int32x4_t vrhaddq_s32(int32x4_t __a, int32x4_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN int32x4_t vhsubq_s32(int32x4_t __a, int32x4_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN uint32x2_t vceq_s32(int32x2_t __a, int32x2_t __b) { return (uint32x2_t)(__a == __b); }
__BUN_CC_INTRIN uint32x2_t vcgt_s32(int32x2_t __a, int32x2_t __b) { return (uint32x2_t)(__a > __b); }
__BUN_CC_INTRIN uint32x2_t vclt_s32(int32x2_t __a, int32x2_t __b) { return (uint32x2_t)(__a < __b); }
__BUN_CC_INTRIN uint32x2_t vcge_s32(int32x2_t __a, int32x2_t __b) { return (uint32x2_t)(__a >= __b); }
__BUN_CC_INTRIN uint32x2_t vcle_s32(int32x2_t __a, int32x2_t __b) { return (uint32x2_t)(__a <= __b); }
__BUN_CC_INTRIN uint32x2_t vceqz_s32(int32x2_t __a) { return (uint32x2_t)(__a == 0); }
__BUN_CC_INTRIN uint32x4_t vceqzq_s32(int32x4_t __a) { return (uint32x4_t)(__a == 0); }
__BUN_CC_INTRIN int32x2_t vbsl_s32(uint32x2_t __m, int32x2_t __a, int32x2_t __b) { return (int32x2_t)((__m & (uint32x2_t)__a) | (~__m & (uint32x2_t)__b)); }
__BUN_CC_INTRIN int32_t vaddv_s32(int32x2_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN int32_t vmaxv_s32(int32x2_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN int32_t vminv_s32(int32x2_t __a) { return __builtin_reduce_min(__a); }
__BUN_CC_INTRIN int32x2_t vpadd_s32(int32x2_t __a, int32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2) + __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN int32x2_t vpmax_s32(int32x2_t __a, int32x2_t __b) { return __builtin_elementwise_max(__builtin_shufflevector(__a, __b, 0, 2), __builtin_shufflevector(__a, __b, 1, 3)); }
__BUN_CC_INTRIN int32x2_t vpmin_s32(int32x2_t __a, int32x2_t __b) { return __builtin_elementwise_min(__builtin_shufflevector(__a, __b, 0, 2), __builtin_shufflevector(__a, __b, 1, 3)); }
__BUN_CC_INTRIN int32x2_t vabd_s32(int32x2_t __a, int32x2_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN int32x4_t vabdq_s32(int32x4_t __a, int32x4_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }

/* uint32x2_t: arithmetic */
__BUN_CC_INTRIN uint32x2_t vadd_u32(uint32x2_t __a, uint32x2_t __b) { return __a + __b; }
__BUN_CC_INTRIN uint32x2_t vsub_u32(uint32x2_t __a, uint32x2_t __b) { return __a - __b; }
__BUN_CC_INTRIN uint32x2_t vmul_u32(uint32x2_t __a, uint32x2_t __b) { return __a * __b; }
__BUN_CC_INTRIN uint32x2_t vmla_u32(uint32x2_t __a, uint32x2_t __b, uint32x2_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN uint32x2_t vmls_u32(uint32x2_t __a, uint32x2_t __b, uint32x2_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN uint32x2_t vmul_n_u32(uint32x2_t __a, uint32_t __b) { return __a * vdup_n_u32(__b); }
__BUN_CC_INTRIN uint32x4_t vmulq_n_u32(uint32x4_t __a, uint32_t __b) { return __a * vdupq_n_u32(__b); }
__BUN_CC_INTRIN uint32x2_t vmla_n_u32(uint32x2_t __a, uint32x2_t __b, uint32_t __c) { return __a + __b * vdup_n_u32(__c); }
__BUN_CC_INTRIN uint32x4_t vmlaq_n_u32(uint32x4_t __a, uint32x4_t __b, uint32_t __c) { return __a + __b * vdupq_n_u32(__c); }
__BUN_CC_INTRIN uint32x2_t vmin_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint32x2_t vmax_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN uint32x2_t vand_u32(uint32x2_t __a, uint32x2_t __b) { return __a & __b; }
__BUN_CC_INTRIN uint32x2_t vorr_u32(uint32x2_t __a, uint32x2_t __b) { return __a | __b; }
__BUN_CC_INTRIN uint32x2_t veor_u32(uint32x2_t __a, uint32x2_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN uint32x2_t vbic_u32(uint32x2_t __a, uint32x2_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN uint32x2_t vorn_u32(uint32x2_t __a, uint32x2_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN uint32x4_t vornq_u32(uint32x4_t __a, uint32x4_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN uint32x2_t vmvn_u32(uint32x2_t __a) { return ~__a; }
__BUN_CC_INTRIN uint32x2_t vshl_n_u32(uint32x2_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN uint32x2_t vshr_n_u32(uint32x2_t __a, int __n) { return __n >= 32 ? vdup_n_u32(0) : __a >> __n; }
__BUN_CC_INTRIN uint32x2_t vsra_n_u32(uint32x2_t __a, uint32x2_t __b, int __n) { return __a + vshr_n_u32(__b, __n); }
__BUN_CC_INTRIN uint32x2_t vrshr_n_u32(uint32x2_t __a, int __n) { return vshr_n_u32(__a, __n) + (vshr_n_u32(__a, __n - 1) & vdup_n_u32(1)); }
__BUN_CC_INTRIN uint32x2_t vtst_u32(uint32x2_t __a, uint32x2_t __b) { return (uint32x2_t)((__a & __b) != 0); }
__BUN_CC_INTRIN uint32x2_t vsli_n_u32(uint32x2_t __a, uint32x2_t __b, int __n) { return (uint32x2_t)(((uint32x2_t)__a & ~(~vdup_n_u32(0) << __n)) | ((uint32x2_t)__b << __n)); }
__BUN_CC_INTRIN uint32x2_t vsri_n_u32(uint32x2_t __a, uint32x2_t __b, int __n) { return __n >= 32 ? __a : (uint32x2_t)(((uint32x2_t)__a & ~(~vdup_n_u32(0) >> __n)) | ((uint32x2_t)__b >> __n)); }
__BUN_CC_INTRIN uint32x2_t vhadd_u32(uint32x2_t __a, uint32x2_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint32x2_t vrhadd_u32(uint32x2_t __a, uint32x2_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint32x2_t vhsub_u32(uint32x2_t __a, uint32x2_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN uint32x4_t vsraq_n_u32(uint32x4_t __a, uint32x4_t __b, int __n) { return __a + vshrq_n_u32(__b, __n); }
__BUN_CC_INTRIN uint32x4_t vrshrq_n_u32(uint32x4_t __a, int __n) { return vshrq_n_u32(__a, __n) + (vshrq_n_u32(__a, __n - 1) & vdupq_n_u32(1)); }
__BUN_CC_INTRIN uint32x4_t vtstq_u32(uint32x4_t __a, uint32x4_t __b) { return (uint32x4_t)((__a & __b) != 0); }
__BUN_CC_INTRIN uint32x4_t vsliq_n_u32(uint32x4_t __a, uint32x4_t __b, int __n) { return (uint32x4_t)(((uint32x4_t)__a & ~(~vdupq_n_u32(0) << __n)) | ((uint32x4_t)__b << __n)); }
__BUN_CC_INTRIN uint32x4_t vsriq_n_u32(uint32x4_t __a, uint32x4_t __b, int __n) { return __n >= 32 ? __a : (uint32x4_t)(((uint32x4_t)__a & ~(~vdupq_n_u32(0) >> __n)) | ((uint32x4_t)__b >> __n)); }
__BUN_CC_INTRIN uint32x4_t vhaddq_u32(uint32x4_t __a, uint32x4_t __b) { return (__a & __b) + ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint32x4_t vrhaddq_u32(uint32x4_t __a, uint32x4_t __b) { return (__a | __b) - ((__a ^ __b) >> 1); }
__BUN_CC_INTRIN uint32x4_t vhsubq_u32(uint32x4_t __a, uint32x4_t __b) { return (__a >> 1) - (__b >> 1) - (~__a & __b & 1); }
__BUN_CC_INTRIN uint32x2_t vceq_u32(uint32x2_t __a, uint32x2_t __b) { return (uint32x2_t)(__a == __b); }
__BUN_CC_INTRIN uint32x2_t vcgt_u32(uint32x2_t __a, uint32x2_t __b) { return (uint32x2_t)(__a > __b); }
__BUN_CC_INTRIN uint32x2_t vclt_u32(uint32x2_t __a, uint32x2_t __b) { return (uint32x2_t)(__a < __b); }
__BUN_CC_INTRIN uint32x2_t vcge_u32(uint32x2_t __a, uint32x2_t __b) { return (uint32x2_t)(__a >= __b); }
__BUN_CC_INTRIN uint32x2_t vcle_u32(uint32x2_t __a, uint32x2_t __b) { return (uint32x2_t)(__a <= __b); }
__BUN_CC_INTRIN uint32x2_t vceqz_u32(uint32x2_t __a) { return (uint32x2_t)(__a == 0); }
__BUN_CC_INTRIN uint32x4_t vceqzq_u32(uint32x4_t __a) { return (uint32x4_t)(__a == 0); }
__BUN_CC_INTRIN uint32x2_t vbsl_u32(uint32x2_t __m, uint32x2_t __a, uint32x2_t __b) { return (uint32x2_t)((__m & (uint32x2_t)__a) | (~__m & (uint32x2_t)__b)); }
__BUN_CC_INTRIN uint32_t vaddv_u32(uint32x2_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN uint32_t vmaxv_u32(uint32x2_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN uint32_t vminv_u32(uint32x2_t __a) { return __builtin_reduce_min(__a); }
__BUN_CC_INTRIN uint32x2_t vpadd_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2) + __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN uint32x2_t vpmax_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_elementwise_max(__builtin_shufflevector(__a, __b, 0, 2), __builtin_shufflevector(__a, __b, 1, 3)); }
__BUN_CC_INTRIN uint32x2_t vpmin_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_elementwise_min(__builtin_shufflevector(__a, __b, 0, 2), __builtin_shufflevector(__a, __b, 1, 3)); }
__BUN_CC_INTRIN uint32x2_t vabd_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN uint32x4_t vabdq_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_elementwise_max(__a, __b) - __builtin_elementwise_min(__a, __b); }

/* int64x1_t: arithmetic */
__BUN_CC_INTRIN int64x1_t vadd_s64(int64x1_t __a, int64x1_t __b) { return __a + __b; }
__BUN_CC_INTRIN int64x1_t vsub_s64(int64x1_t __a, int64x1_t __b) { return __a - __b; }
__BUN_CC_INTRIN int64x1_t vneg_s64(int64x1_t __a) { return -__a; }
__BUN_CC_INTRIN int64x1_t vabs_s64(int64x1_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN int64x1_t vand_s64(int64x1_t __a, int64x1_t __b) { return __a & __b; }
__BUN_CC_INTRIN int64x1_t vorr_s64(int64x1_t __a, int64x1_t __b) { return __a | __b; }
__BUN_CC_INTRIN int64x1_t veor_s64(int64x1_t __a, int64x1_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN int64x1_t vbic_s64(int64x1_t __a, int64x1_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN int64x1_t vorn_s64(int64x1_t __a, int64x1_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN int64x2_t vornq_s64(int64x2_t __a, int64x2_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN int64x1_t vshl_n_s64(int64x1_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN int64x1_t vshr_n_s64(int64x1_t __a, int __n) { return __a >> (__n >= 64 ? 63 : __n); }
__BUN_CC_INTRIN int64x1_t vsra_n_s64(int64x1_t __a, int64x1_t __b, int __n) { return __a + vshr_n_s64(__b, __n); }
__BUN_CC_INTRIN int64x1_t vrshr_n_s64(int64x1_t __a, int __n) { return vshr_n_s64(__a, __n) + (vshr_n_s64(__a, __n - 1) & vdup_n_s64(1)); }
__BUN_CC_INTRIN uint64x1_t vtst_s64(int64x1_t __a, int64x1_t __b) { return (uint64x1_t)((__a & __b) != 0); }
__BUN_CC_INTRIN int64x1_t vsli_n_s64(int64x1_t __a, int64x1_t __b, int __n) { return (int64x1_t)(((uint64x1_t)__a & ~(~vdup_n_u64(0) << __n)) | ((uint64x1_t)__b << __n)); }
__BUN_CC_INTRIN int64x1_t vsri_n_s64(int64x1_t __a, int64x1_t __b, int __n) { return __n >= 64 ? __a : (int64x1_t)(((uint64x1_t)__a & ~(~vdup_n_u64(0) >> __n)) | ((uint64x1_t)__b >> __n)); }
__BUN_CC_INTRIN int64x2_t vsraq_n_s64(int64x2_t __a, int64x2_t __b, int __n) { return __a + vshrq_n_s64(__b, __n); }
__BUN_CC_INTRIN int64x2_t vrshrq_n_s64(int64x2_t __a, int __n) { return vshrq_n_s64(__a, __n) + (vshrq_n_s64(__a, __n - 1) & vdupq_n_s64(1)); }
__BUN_CC_INTRIN uint64x2_t vtstq_s64(int64x2_t __a, int64x2_t __b) { return (uint64x2_t)((__a & __b) != 0); }
__BUN_CC_INTRIN int64x2_t vsliq_n_s64(int64x2_t __a, int64x2_t __b, int __n) { return (int64x2_t)(((uint64x2_t)__a & ~(~vdupq_n_u64(0) << __n)) | ((uint64x2_t)__b << __n)); }
__BUN_CC_INTRIN int64x2_t vsriq_n_s64(int64x2_t __a, int64x2_t __b, int __n) { return __n >= 64 ? __a : (int64x2_t)(((uint64x2_t)__a & ~(~vdupq_n_u64(0) >> __n)) | ((uint64x2_t)__b >> __n)); }
__BUN_CC_INTRIN uint64x1_t vceq_s64(int64x1_t __a, int64x1_t __b) { return (uint64x1_t)(__a == __b); }
__BUN_CC_INTRIN uint64x1_t vcgt_s64(int64x1_t __a, int64x1_t __b) { return (uint64x1_t)(__a > __b); }
__BUN_CC_INTRIN uint64x1_t vclt_s64(int64x1_t __a, int64x1_t __b) { return (uint64x1_t)(__a < __b); }
__BUN_CC_INTRIN uint64x1_t vcge_s64(int64x1_t __a, int64x1_t __b) { return (uint64x1_t)(__a >= __b); }
__BUN_CC_INTRIN uint64x1_t vcle_s64(int64x1_t __a, int64x1_t __b) { return (uint64x1_t)(__a <= __b); }
__BUN_CC_INTRIN uint64x1_t vceqz_s64(int64x1_t __a) { return (uint64x1_t)(__a == 0); }
__BUN_CC_INTRIN uint64x2_t vceqzq_s64(int64x2_t __a) { return (uint64x2_t)(__a == 0); }
__BUN_CC_INTRIN int64x1_t vbsl_s64(uint64x1_t __m, int64x1_t __a, int64x1_t __b) { return (int64x1_t)((__m & (uint64x1_t)__a) | (~__m & (uint64x1_t)__b)); }

/* uint64x1_t: arithmetic */
__BUN_CC_INTRIN uint64x1_t vadd_u64(uint64x1_t __a, uint64x1_t __b) { return __a + __b; }
__BUN_CC_INTRIN uint64x1_t vsub_u64(uint64x1_t __a, uint64x1_t __b) { return __a - __b; }
__BUN_CC_INTRIN uint64x1_t vand_u64(uint64x1_t __a, uint64x1_t __b) { return __a & __b; }
__BUN_CC_INTRIN uint64x1_t vorr_u64(uint64x1_t __a, uint64x1_t __b) { return __a | __b; }
__BUN_CC_INTRIN uint64x1_t veor_u64(uint64x1_t __a, uint64x1_t __b) { return __a ^ __b; }
__BUN_CC_INTRIN uint64x1_t vbic_u64(uint64x1_t __a, uint64x1_t __b) { return __a & ~__b; }
__BUN_CC_INTRIN uint64x1_t vorn_u64(uint64x1_t __a, uint64x1_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN uint64x2_t vornq_u64(uint64x2_t __a, uint64x2_t __b) { return __a | ~__b; }
__BUN_CC_INTRIN uint64x1_t vshl_n_u64(uint64x1_t __a, int __n) { return __a << __n; }
__BUN_CC_INTRIN uint64x1_t vshr_n_u64(uint64x1_t __a, int __n) { return __n >= 64 ? vdup_n_u64(0) : __a >> __n; }
__BUN_CC_INTRIN uint64x1_t vsra_n_u64(uint64x1_t __a, uint64x1_t __b, int __n) { return __a + vshr_n_u64(__b, __n); }
__BUN_CC_INTRIN uint64x1_t vrshr_n_u64(uint64x1_t __a, int __n) { return vshr_n_u64(__a, __n) + (vshr_n_u64(__a, __n - 1) & vdup_n_u64(1)); }
__BUN_CC_INTRIN uint64x1_t vtst_u64(uint64x1_t __a, uint64x1_t __b) { return (uint64x1_t)((__a & __b) != 0); }
__BUN_CC_INTRIN uint64x1_t vsli_n_u64(uint64x1_t __a, uint64x1_t __b, int __n) { return (uint64x1_t)(((uint64x1_t)__a & ~(~vdup_n_u64(0) << __n)) | ((uint64x1_t)__b << __n)); }
__BUN_CC_INTRIN uint64x1_t vsri_n_u64(uint64x1_t __a, uint64x1_t __b, int __n) { return __n >= 64 ? __a : (uint64x1_t)(((uint64x1_t)__a & ~(~vdup_n_u64(0) >> __n)) | ((uint64x1_t)__b >> __n)); }
__BUN_CC_INTRIN uint64x2_t vsraq_n_u64(uint64x2_t __a, uint64x2_t __b, int __n) { return __a + vshrq_n_u64(__b, __n); }
__BUN_CC_INTRIN uint64x2_t vrshrq_n_u64(uint64x2_t __a, int __n) { return vshrq_n_u64(__a, __n) + (vshrq_n_u64(__a, __n - 1) & vdupq_n_u64(1)); }
__BUN_CC_INTRIN uint64x2_t vtstq_u64(uint64x2_t __a, uint64x2_t __b) { return (uint64x2_t)((__a & __b) != 0); }
__BUN_CC_INTRIN uint64x2_t vsliq_n_u64(uint64x2_t __a, uint64x2_t __b, int __n) { return (uint64x2_t)(((uint64x2_t)__a & ~(~vdupq_n_u64(0) << __n)) | ((uint64x2_t)__b << __n)); }
__BUN_CC_INTRIN uint64x2_t vsriq_n_u64(uint64x2_t __a, uint64x2_t __b, int __n) { return __n >= 64 ? __a : (uint64x2_t)(((uint64x2_t)__a & ~(~vdupq_n_u64(0) >> __n)) | ((uint64x2_t)__b >> __n)); }
__BUN_CC_INTRIN uint64x1_t vceq_u64(uint64x1_t __a, uint64x1_t __b) { return (uint64x1_t)(__a == __b); }
__BUN_CC_INTRIN uint64x1_t vcgt_u64(uint64x1_t __a, uint64x1_t __b) { return (uint64x1_t)(__a > __b); }
__BUN_CC_INTRIN uint64x1_t vclt_u64(uint64x1_t __a, uint64x1_t __b) { return (uint64x1_t)(__a < __b); }
__BUN_CC_INTRIN uint64x1_t vcge_u64(uint64x1_t __a, uint64x1_t __b) { return (uint64x1_t)(__a >= __b); }
__BUN_CC_INTRIN uint64x1_t vcle_u64(uint64x1_t __a, uint64x1_t __b) { return (uint64x1_t)(__a <= __b); }
__BUN_CC_INTRIN uint64x1_t vceqz_u64(uint64x1_t __a) { return (uint64x1_t)(__a == 0); }
__BUN_CC_INTRIN uint64x2_t vceqzq_u64(uint64x2_t __a) { return (uint64x2_t)(__a == 0); }
__BUN_CC_INTRIN uint64x1_t vbsl_u64(uint64x1_t __m, uint64x1_t __a, uint64x1_t __b) { return (uint64x1_t)((__m & (uint64x1_t)__a) | (~__m & (uint64x1_t)__b)); }

/* float32x2_t: arithmetic */
__BUN_CC_INTRIN float32x2_t vadd_f32(float32x2_t __a, float32x2_t __b) { return __a + __b; }
__BUN_CC_INTRIN float32x2_t vsub_f32(float32x2_t __a, float32x2_t __b) { return __a - __b; }
__BUN_CC_INTRIN float32x2_t vmul_f32(float32x2_t __a, float32x2_t __b) { return __a * __b; }
__BUN_CC_INTRIN float32x2_t vmla_f32(float32x2_t __a, float32x2_t __b, float32x2_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN float32x2_t vmls_f32(float32x2_t __a, float32x2_t __b, float32x2_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN float32x2_t vmul_n_f32(float32x2_t __a, float32_t __b) { return __a * vdup_n_f32(__b); }
__BUN_CC_INTRIN float32x4_t vmulq_n_f32(float32x4_t __a, float32_t __b) { return __a * vdupq_n_f32(__b); }
__BUN_CC_INTRIN float32x2_t vmla_n_f32(float32x2_t __a, float32x2_t __b, float32_t __c) { return __a + __b * vdup_n_f32(__c); }
__BUN_CC_INTRIN float32x4_t vmlaq_n_f32(float32x4_t __a, float32x4_t __b, float32_t __c) { return __a + __b * vdupq_n_f32(__c); }
__BUN_CC_INTRIN float32x2_t vmin_f32(float32x2_t __a, float32x2_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN float32x2_t vmax_f32(float32x2_t __a, float32x2_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN float32x2_t vneg_f32(float32x2_t __a) { return -__a; }
__BUN_CC_INTRIN float32x2_t vabs_f32(float32x2_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN float32x2_t vdiv_f32(float32x2_t __a, float32x2_t __b) { return __a / __b; }
__BUN_CC_INTRIN float32x2_t vsqrt_f32(float32x2_t __a) { return __builtin_elementwise_sqrt(__a); }
__BUN_CC_INTRIN uint32x2_t vceq_f32(float32x2_t __a, float32x2_t __b) { return (uint32x2_t)(__a == __b); }
__BUN_CC_INTRIN uint32x2_t vcgt_f32(float32x2_t __a, float32x2_t __b) { return (uint32x2_t)(__a > __b); }
__BUN_CC_INTRIN uint32x2_t vclt_f32(float32x2_t __a, float32x2_t __b) { return (uint32x2_t)(__a < __b); }
__BUN_CC_INTRIN uint32x2_t vcge_f32(float32x2_t __a, float32x2_t __b) { return (uint32x2_t)(__a >= __b); }
__BUN_CC_INTRIN uint32x2_t vcle_f32(float32x2_t __a, float32x2_t __b) { return (uint32x2_t)(__a <= __b); }
__BUN_CC_INTRIN uint32x2_t vceqz_f32(float32x2_t __a) { return (uint32x2_t)(__a == 0); }
__BUN_CC_INTRIN uint32x4_t vceqzq_f32(float32x4_t __a) { return (uint32x4_t)(__a == 0); }
__BUN_CC_INTRIN float32x2_t vbsl_f32(uint32x2_t __m, float32x2_t __a, float32x2_t __b) { return (float32x2_t)((__m & (uint32x2_t)__a) | (~__m & (uint32x2_t)__b)); }
__BUN_CC_INTRIN float32_t vaddv_f32(float32x2_t __a) { return __builtin_reduce_add(__a); }
__BUN_CC_INTRIN float32_t vmaxv_f32(float32x2_t __a) { return __builtin_reduce_max(__a); }
__BUN_CC_INTRIN float32_t vminv_f32(float32x2_t __a) { return __builtin_reduce_min(__a); }
__BUN_CC_INTRIN float32x2_t vpadd_f32(float32x2_t __a, float32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2) + __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN float32x2_t vpmax_f32(float32x2_t __a, float32x2_t __b) { return __builtin_elementwise_max(__builtin_shufflevector(__a, __b, 0, 2), __builtin_shufflevector(__a, __b, 1, 3)); }
__BUN_CC_INTRIN float32x2_t vpmin_f32(float32x2_t __a, float32x2_t __b) { return __builtin_elementwise_min(__builtin_shufflevector(__a, __b, 0, 2), __builtin_shufflevector(__a, __b, 1, 3)); }
__BUN_CC_INTRIN float32x2_t vabd_f32(float32x2_t __a, float32x2_t __b) { return __builtin_elementwise_abs(__a - __b); }
__BUN_CC_INTRIN float32x4_t vabdq_f32(float32x4_t __a, float32x4_t __b) { return __builtin_elementwise_abs(__a - __b); }

/* float64x1_t: arithmetic */
__BUN_CC_INTRIN float64x1_t vadd_f64(float64x1_t __a, float64x1_t __b) { return __a + __b; }
__BUN_CC_INTRIN float64x1_t vsub_f64(float64x1_t __a, float64x1_t __b) { return __a - __b; }
__BUN_CC_INTRIN float64x1_t vmul_f64(float64x1_t __a, float64x1_t __b) { return __a * __b; }
__BUN_CC_INTRIN float64x1_t vmla_f64(float64x1_t __a, float64x1_t __b, float64x1_t __c) { return __a + __b * __c; }
__BUN_CC_INTRIN float64x1_t vmls_f64(float64x1_t __a, float64x1_t __b, float64x1_t __c) { return __a - __b * __c; }
__BUN_CC_INTRIN float64x1_t vmul_n_f64(float64x1_t __a, float64_t __b) { return __a * vdup_n_f64(__b); }
__BUN_CC_INTRIN float64x2_t vmulq_n_f64(float64x2_t __a, float64_t __b) { return __a * vdupq_n_f64(__b); }
__BUN_CC_INTRIN float64x1_t vmin_f64(float64x1_t __a, float64x1_t __b) { return __builtin_elementwise_min(__a, __b); }
__BUN_CC_INTRIN float64x1_t vmax_f64(float64x1_t __a, float64x1_t __b) { return __builtin_elementwise_max(__a, __b); }
__BUN_CC_INTRIN float64x1_t vneg_f64(float64x1_t __a) { return -__a; }
__BUN_CC_INTRIN float64x1_t vabs_f64(float64x1_t __a) { return __builtin_elementwise_abs(__a); }
__BUN_CC_INTRIN float64x1_t vdiv_f64(float64x1_t __a, float64x1_t __b) { return __a / __b; }
__BUN_CC_INTRIN float64x1_t vsqrt_f64(float64x1_t __a) { return __builtin_elementwise_sqrt(__a); }
__BUN_CC_INTRIN uint64x1_t vceq_f64(float64x1_t __a, float64x1_t __b) { return (uint64x1_t)(__a == __b); }
__BUN_CC_INTRIN uint64x1_t vcgt_f64(float64x1_t __a, float64x1_t __b) { return (uint64x1_t)(__a > __b); }
__BUN_CC_INTRIN uint64x1_t vclt_f64(float64x1_t __a, float64x1_t __b) { return (uint64x1_t)(__a < __b); }
__BUN_CC_INTRIN uint64x1_t vcge_f64(float64x1_t __a, float64x1_t __b) { return (uint64x1_t)(__a >= __b); }
__BUN_CC_INTRIN uint64x1_t vcle_f64(float64x1_t __a, float64x1_t __b) { return (uint64x1_t)(__a <= __b); }
__BUN_CC_INTRIN uint64x1_t vceqz_f64(float64x1_t __a) { return (uint64x1_t)(__a == 0); }
__BUN_CC_INTRIN uint64x2_t vceqzq_f64(float64x2_t __a) { return (uint64x2_t)(__a == 0); }
__BUN_CC_INTRIN float64x1_t vbsl_f64(uint64x1_t __m, float64x1_t __a, float64x1_t __b) { return (float64x1_t)((__m & (uint64x1_t)__a) | (~__m & (uint64x1_t)__b)); }
__BUN_CC_INTRIN float64x1_t vabd_f64(float64x1_t __a, float64x1_t __b) { return __builtin_elementwise_abs(__a - __b); }
__BUN_CC_INTRIN float64x2_t vabdq_f64(float64x2_t __a, float64x2_t __b) { return __builtin_elementwise_abs(__a - __b); }

/* One lane copied to all, and one lane loaded or stored. */
#define vdup_lane_s8(v, lane) vdup_n_s8(vget_lane_s8(v, lane))
#define vdupq_lane_s8(v, lane) vdupq_n_s8(vget_lane_s8(v, lane))
#define vdup_laneq_s8(v, lane) vdup_n_s8(vgetq_lane_s8(v, lane))
#define vdupq_laneq_s8(v, lane) vdupq_n_s8(vgetq_lane_s8(v, lane))
#define vld1_lane_s8(p, v, lane) vset_lane_s8(*(p), v, lane)
#define vld1q_lane_s8(p, v, lane) vsetq_lane_s8(*(p), v, lane)
#define vst1_lane_s8(p, v, lane) ((void)(*(p) = vget_lane_s8(v, lane)))
#define vst1q_lane_s8(p, v, lane) ((void)(*(p) = vgetq_lane_s8(v, lane)))
#define vdup_lane_u8(v, lane) vdup_n_u8(vget_lane_u8(v, lane))
#define vdupq_lane_u8(v, lane) vdupq_n_u8(vget_lane_u8(v, lane))
#define vdup_laneq_u8(v, lane) vdup_n_u8(vgetq_lane_u8(v, lane))
#define vdupq_laneq_u8(v, lane) vdupq_n_u8(vgetq_lane_u8(v, lane))
#define vld1_lane_u8(p, v, lane) vset_lane_u8(*(p), v, lane)
#define vld1q_lane_u8(p, v, lane) vsetq_lane_u8(*(p), v, lane)
#define vst1_lane_u8(p, v, lane) ((void)(*(p) = vget_lane_u8(v, lane)))
#define vst1q_lane_u8(p, v, lane) ((void)(*(p) = vgetq_lane_u8(v, lane)))
#define vdup_lane_s16(v, lane) vdup_n_s16(vget_lane_s16(v, lane))
#define vdupq_lane_s16(v, lane) vdupq_n_s16(vget_lane_s16(v, lane))
#define vdup_laneq_s16(v, lane) vdup_n_s16(vgetq_lane_s16(v, lane))
#define vdupq_laneq_s16(v, lane) vdupq_n_s16(vgetq_lane_s16(v, lane))
#define vld1_lane_s16(p, v, lane) vset_lane_s16(*(p), v, lane)
#define vld1q_lane_s16(p, v, lane) vsetq_lane_s16(*(p), v, lane)
#define vst1_lane_s16(p, v, lane) ((void)(*(p) = vget_lane_s16(v, lane)))
#define vst1q_lane_s16(p, v, lane) ((void)(*(p) = vgetq_lane_s16(v, lane)))
#define vdup_lane_u16(v, lane) vdup_n_u16(vget_lane_u16(v, lane))
#define vdupq_lane_u16(v, lane) vdupq_n_u16(vget_lane_u16(v, lane))
#define vdup_laneq_u16(v, lane) vdup_n_u16(vgetq_lane_u16(v, lane))
#define vdupq_laneq_u16(v, lane) vdupq_n_u16(vgetq_lane_u16(v, lane))
#define vld1_lane_u16(p, v, lane) vset_lane_u16(*(p), v, lane)
#define vld1q_lane_u16(p, v, lane) vsetq_lane_u16(*(p), v, lane)
#define vst1_lane_u16(p, v, lane) ((void)(*(p) = vget_lane_u16(v, lane)))
#define vst1q_lane_u16(p, v, lane) ((void)(*(p) = vgetq_lane_u16(v, lane)))
#define vdup_lane_s32(v, lane) vdup_n_s32(vget_lane_s32(v, lane))
#define vdupq_lane_s32(v, lane) vdupq_n_s32(vget_lane_s32(v, lane))
#define vdup_laneq_s32(v, lane) vdup_n_s32(vgetq_lane_s32(v, lane))
#define vdupq_laneq_s32(v, lane) vdupq_n_s32(vgetq_lane_s32(v, lane))
#define vld1_lane_s32(p, v, lane) vset_lane_s32(*(p), v, lane)
#define vld1q_lane_s32(p, v, lane) vsetq_lane_s32(*(p), v, lane)
#define vst1_lane_s32(p, v, lane) ((void)(*(p) = vget_lane_s32(v, lane)))
#define vst1q_lane_s32(p, v, lane) ((void)(*(p) = vgetq_lane_s32(v, lane)))
#define vdup_lane_u32(v, lane) vdup_n_u32(vget_lane_u32(v, lane))
#define vdupq_lane_u32(v, lane) vdupq_n_u32(vget_lane_u32(v, lane))
#define vdup_laneq_u32(v, lane) vdup_n_u32(vgetq_lane_u32(v, lane))
#define vdupq_laneq_u32(v, lane) vdupq_n_u32(vgetq_lane_u32(v, lane))
#define vld1_lane_u32(p, v, lane) vset_lane_u32(*(p), v, lane)
#define vld1q_lane_u32(p, v, lane) vsetq_lane_u32(*(p), v, lane)
#define vst1_lane_u32(p, v, lane) ((void)(*(p) = vget_lane_u32(v, lane)))
#define vst1q_lane_u32(p, v, lane) ((void)(*(p) = vgetq_lane_u32(v, lane)))
#define vdup_lane_s64(v, lane) vdup_n_s64(vget_lane_s64(v, lane))
#define vdupq_lane_s64(v, lane) vdupq_n_s64(vget_lane_s64(v, lane))
#define vdup_laneq_s64(v, lane) vdup_n_s64(vgetq_lane_s64(v, lane))
#define vdupq_laneq_s64(v, lane) vdupq_n_s64(vgetq_lane_s64(v, lane))
#define vld1_lane_s64(p, v, lane) vset_lane_s64(*(p), v, lane)
#define vld1q_lane_s64(p, v, lane) vsetq_lane_s64(*(p), v, lane)
#define vst1_lane_s64(p, v, lane) ((void)(*(p) = vget_lane_s64(v, lane)))
#define vst1q_lane_s64(p, v, lane) ((void)(*(p) = vgetq_lane_s64(v, lane)))
#define vdup_lane_u64(v, lane) vdup_n_u64(vget_lane_u64(v, lane))
#define vdupq_lane_u64(v, lane) vdupq_n_u64(vget_lane_u64(v, lane))
#define vdup_laneq_u64(v, lane) vdup_n_u64(vgetq_lane_u64(v, lane))
#define vdupq_laneq_u64(v, lane) vdupq_n_u64(vgetq_lane_u64(v, lane))
#define vld1_lane_u64(p, v, lane) vset_lane_u64(*(p), v, lane)
#define vld1q_lane_u64(p, v, lane) vsetq_lane_u64(*(p), v, lane)
#define vst1_lane_u64(p, v, lane) ((void)(*(p) = vget_lane_u64(v, lane)))
#define vst1q_lane_u64(p, v, lane) ((void)(*(p) = vgetq_lane_u64(v, lane)))
#define vdup_lane_f32(v, lane) vdup_n_f32(vget_lane_f32(v, lane))
#define vdupq_lane_f32(v, lane) vdupq_n_f32(vget_lane_f32(v, lane))
#define vdup_laneq_f32(v, lane) vdup_n_f32(vgetq_lane_f32(v, lane))
#define vdupq_laneq_f32(v, lane) vdupq_n_f32(vgetq_lane_f32(v, lane))
#define vld1_lane_f32(p, v, lane) vset_lane_f32(*(p), v, lane)
#define vld1q_lane_f32(p, v, lane) vsetq_lane_f32(*(p), v, lane)
#define vst1_lane_f32(p, v, lane) ((void)(*(p) = vget_lane_f32(v, lane)))
#define vst1q_lane_f32(p, v, lane) ((void)(*(p) = vgetq_lane_f32(v, lane)))
#define vdup_lane_f64(v, lane) vdup_n_f64(vget_lane_f64(v, lane))
#define vdupq_lane_f64(v, lane) vdupq_n_f64(vget_lane_f64(v, lane))
#define vdup_laneq_f64(v, lane) vdup_n_f64(vgetq_lane_f64(v, lane))
#define vdupq_laneq_f64(v, lane) vdupq_n_f64(vgetq_lane_f64(v, lane))
#define vld1_lane_f64(p, v, lane) vset_lane_f64(*(p), v, lane)
#define vld1q_lane_f64(p, v, lane) vsetq_lane_f64(*(p), v, lane)
#define vst1_lane_f64(p, v, lane) ((void)(*(p) = vget_lane_f64(v, lane)))
#define vst1q_lane_f64(p, v, lane) ((void)(*(p) = vgetq_lane_f64(v, lane)))
#define vdup_lane_p8(v, lane) vdup_n_p8(vget_lane_p8(v, lane))
#define vdupq_lane_p8(v, lane) vdupq_n_p8(vget_lane_p8(v, lane))
#define vdup_laneq_p8(v, lane) vdup_n_p8(vgetq_lane_p8(v, lane))
#define vdupq_laneq_p8(v, lane) vdupq_n_p8(vgetq_lane_p8(v, lane))
#define vld1_lane_p8(p, v, lane) vset_lane_p8(*(p), v, lane)
#define vld1q_lane_p8(p, v, lane) vsetq_lane_p8(*(p), v, lane)
#define vst1_lane_p8(p, v, lane) ((void)(*(p) = vget_lane_p8(v, lane)))
#define vst1q_lane_p8(p, v, lane) ((void)(*(p) = vgetq_lane_p8(v, lane)))
#define vdup_lane_p16(v, lane) vdup_n_p16(vget_lane_p16(v, lane))
#define vdupq_lane_p16(v, lane) vdupq_n_p16(vget_lane_p16(v, lane))
#define vdup_laneq_p16(v, lane) vdup_n_p16(vgetq_lane_p16(v, lane))
#define vdupq_laneq_p16(v, lane) vdupq_n_p16(vgetq_lane_p16(v, lane))
#define vld1_lane_p16(p, v, lane) vset_lane_p16(*(p), v, lane)
#define vld1q_lane_p16(p, v, lane) vsetq_lane_p16(*(p), v, lane)
#define vst1_lane_p16(p, v, lane) ((void)(*(p) = vget_lane_p16(v, lane)))
#define vst1q_lane_p16(p, v, lane) ((void)(*(p) = vgetq_lane_p16(v, lane)))
#define vdup_lane_p64(v, lane) vdup_n_p64(vget_lane_p64(v, lane))
#define vdupq_lane_p64(v, lane) vdupq_n_p64(vget_lane_p64(v, lane))
#define vdup_laneq_p64(v, lane) vdup_n_p64(vgetq_lane_p64(v, lane))
#define vdupq_laneq_p64(v, lane) vdupq_n_p64(vgetq_lane_p64(v, lane))
#define vld1_lane_p64(p, v, lane) vset_lane_p64(*(p), v, lane)
#define vld1q_lane_p64(p, v, lane) vsetq_lane_p64(*(p), v, lane)
#define vst1_lane_p64(p, v, lane) ((void)(*(p) = vget_lane_p64(v, lane)))
#define vst1q_lane_p64(p, v, lane) ((void)(*(p) = vgetq_lane_p64(v, lane)))

/* Twice as wide, and half as wide. */
__BUN_CC_INTRIN int16x8_t vmovl_s8(int8x8_t __a) { return __builtin_convertvector(__a, int16x8_t); }
__BUN_CC_INTRIN int16x8_t vmovl_high_s8(int8x16_t __a) { return vmovl_s8(vget_high_s8(__a)); }
__BUN_CC_INTRIN uint16x8_t vmovl_u8(uint8x8_t __a) { return __builtin_convertvector(__a, uint16x8_t); }
__BUN_CC_INTRIN uint16x8_t vmovl_high_u8(uint8x16_t __a) { return vmovl_u8(vget_high_u8(__a)); }
__BUN_CC_INTRIN int32x4_t vmovl_s16(int16x4_t __a) { return __builtin_convertvector(__a, int32x4_t); }
__BUN_CC_INTRIN int32x4_t vmovl_high_s16(int16x8_t __a) { return vmovl_s16(vget_high_s16(__a)); }
__BUN_CC_INTRIN uint32x4_t vmovl_u16(uint16x4_t __a) { return __builtin_convertvector(__a, uint32x4_t); }
__BUN_CC_INTRIN uint32x4_t vmovl_high_u16(uint16x8_t __a) { return vmovl_u16(vget_high_u16(__a)); }
__BUN_CC_INTRIN int64x2_t vmovl_s32(int32x2_t __a) { return __builtin_convertvector(__a, int64x2_t); }
__BUN_CC_INTRIN int64x2_t vmovl_high_s32(int32x4_t __a) { return vmovl_s32(vget_high_s32(__a)); }
__BUN_CC_INTRIN uint64x2_t vmovl_u32(uint32x2_t __a) { return __builtin_convertvector(__a, uint64x2_t); }
__BUN_CC_INTRIN uint64x2_t vmovl_high_u32(uint32x4_t __a) { return vmovl_u32(vget_high_u32(__a)); }
__BUN_CC_INTRIN int16x8_t vshll_n_s8(int8x8_t __a, int __n) { return vmovl_s8(__a) << __n; }
__BUN_CC_INTRIN int16x8_t vaddl_s8(int8x8_t __a, int8x8_t __b) { return vmovl_s8(__a) + vmovl_s8(__b); }
__BUN_CC_INTRIN int16x8_t vaddl_high_s8(int8x16_t __a, int8x16_t __b) { return vmovl_high_s8(__a) + vmovl_high_s8(__b); }
__BUN_CC_INTRIN int16x8_t vaddw_s8(int16x8_t __a, int8x8_t __b) { return __a + vmovl_s8(__b); }
__BUN_CC_INTRIN int16x8_t vaddw_high_s8(int16x8_t __a, int8x16_t __b) { return __a + vmovl_high_s8(__b); }
__BUN_CC_INTRIN int16x8_t vsubl_s8(int8x8_t __a, int8x8_t __b) { return vmovl_s8(__a) - vmovl_s8(__b); }
__BUN_CC_INTRIN int16x8_t vsubl_high_s8(int8x16_t __a, int8x16_t __b) { return vmovl_high_s8(__a) - vmovl_high_s8(__b); }
__BUN_CC_INTRIN int16x8_t vsubw_s8(int16x8_t __a, int8x8_t __b) { return __a - vmovl_s8(__b); }
__BUN_CC_INTRIN int16x8_t vsubw_high_s8(int16x8_t __a, int8x16_t __b) { return __a - vmovl_high_s8(__b); }
__BUN_CC_INTRIN int16x8_t vabdl_s8(int8x8_t __a, int8x8_t __b) { return (int16x8_t)vmovl_u8(vabd_s8(__a, __b)); }
__BUN_CC_INTRIN int16x8_t vmull_s8(int8x8_t __a, int8x8_t __b) { return __builtin_bir_extmul_low_s8(__a, __b); }
__BUN_CC_INTRIN int16x8_t vmlal_s8(int16x8_t __a, int8x8_t __b, int8x8_t __c) { return __a + vmull_s8(__b, __c); }
__BUN_CC_INTRIN int16x8_t vmlal_high_s8(int16x8_t __a, int8x16_t __b, int8x16_t __c) { return __a + vmull_high_s8(__b, __c); }
__BUN_CC_INTRIN int16x8_t vmlsl_s8(int16x8_t __a, int8x8_t __b, int8x8_t __c) { return __a - vmull_s8(__b, __c); }
__BUN_CC_INTRIN int16x8_t vmlsl_high_s8(int16x8_t __a, int8x16_t __b, int8x16_t __c) { return __a - vmull_high_s8(__b, __c); }
__BUN_CC_INTRIN int16x4_t vpaddl_s8(int8x8_t __a) { return (((int16x4_t)__a << 8) >> 8) + ((int16x4_t)__a >> 8); }
__BUN_CC_INTRIN int16x4_t vpadal_s8(int16x4_t __a, int8x8_t __b) { return __a + vpaddl_s8(__b); }
__BUN_CC_INTRIN int16x8_t vpaddlq_s8(int8x16_t __a) { return (((int16x8_t)__a << 8) >> 8) + ((int16x8_t)__a >> 8); }
__BUN_CC_INTRIN int16x8_t vpadalq_s8(int16x8_t __a, int8x16_t __b) { return __a + vpaddlq_s8(__b); }
__BUN_CC_INTRIN int16_t vaddlv_s8(int8x8_t __a) { return __builtin_reduce_add(vmovl_s8(__a)); }
__BUN_CC_INTRIN int16_t vaddlvq_s8(int8x16_t __a) { return __builtin_reduce_add(vpaddlq_s8(__a)); }
__BUN_CC_INTRIN uint16x8_t vshll_n_u8(uint8x8_t __a, int __n) { return vmovl_u8(__a) << __n; }
__BUN_CC_INTRIN uint16x8_t vaddl_u8(uint8x8_t __a, uint8x8_t __b) { return vmovl_u8(__a) + vmovl_u8(__b); }
__BUN_CC_INTRIN uint16x8_t vaddl_high_u8(uint8x16_t __a, uint8x16_t __b) { return vmovl_high_u8(__a) + vmovl_high_u8(__b); }
__BUN_CC_INTRIN uint16x8_t vaddw_u8(uint16x8_t __a, uint8x8_t __b) { return __a + vmovl_u8(__b); }
__BUN_CC_INTRIN uint16x8_t vaddw_high_u8(uint16x8_t __a, uint8x16_t __b) { return __a + vmovl_high_u8(__b); }
__BUN_CC_INTRIN uint16x8_t vsubl_u8(uint8x8_t __a, uint8x8_t __b) { return vmovl_u8(__a) - vmovl_u8(__b); }
__BUN_CC_INTRIN uint16x8_t vsubl_high_u8(uint8x16_t __a, uint8x16_t __b) { return vmovl_high_u8(__a) - vmovl_high_u8(__b); }
__BUN_CC_INTRIN uint16x8_t vsubw_u8(uint16x8_t __a, uint8x8_t __b) { return __a - vmovl_u8(__b); }
__BUN_CC_INTRIN uint16x8_t vsubw_high_u8(uint16x8_t __a, uint8x16_t __b) { return __a - vmovl_high_u8(__b); }
__BUN_CC_INTRIN uint16x8_t vabdl_u8(uint8x8_t __a, uint8x8_t __b) { return (uint16x8_t)vmovl_u8(vabd_u8(__a, __b)); }
__BUN_CC_INTRIN uint16x8_t vmull_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_bir_extmul_low_u8(__a, __b); }
__BUN_CC_INTRIN uint16x8_t vmlal_u8(uint16x8_t __a, uint8x8_t __b, uint8x8_t __c) { return __a + vmull_u8(__b, __c); }
__BUN_CC_INTRIN uint16x8_t vmlal_high_u8(uint16x8_t __a, uint8x16_t __b, uint8x16_t __c) { return __a + vmull_high_u8(__b, __c); }
__BUN_CC_INTRIN uint16x8_t vmlsl_u8(uint16x8_t __a, uint8x8_t __b, uint8x8_t __c) { return __a - vmull_u8(__b, __c); }
__BUN_CC_INTRIN uint16x8_t vmlsl_high_u8(uint16x8_t __a, uint8x16_t __b, uint8x16_t __c) { return __a - vmull_high_u8(__b, __c); }
__BUN_CC_INTRIN uint16x4_t vpaddl_u8(uint8x8_t __a) { return (((uint16x4_t)__a << 8) >> 8) + ((uint16x4_t)__a >> 8); }
__BUN_CC_INTRIN uint16x4_t vpadal_u8(uint16x4_t __a, uint8x8_t __b) { return __a + vpaddl_u8(__b); }
__BUN_CC_INTRIN uint16x8_t vpaddlq_u8(uint8x16_t __a) { return (((uint16x8_t)__a << 8) >> 8) + ((uint16x8_t)__a >> 8); }
__BUN_CC_INTRIN uint16x8_t vpadalq_u8(uint16x8_t __a, uint8x16_t __b) { return __a + vpaddlq_u8(__b); }
__BUN_CC_INTRIN uint16_t vaddlv_u8(uint8x8_t __a) { return __builtin_reduce_add(vmovl_u8(__a)); }
__BUN_CC_INTRIN uint16_t vaddlvq_u8(uint8x16_t __a) { return __builtin_reduce_add(vpaddlq_u8(__a)); }
__BUN_CC_INTRIN int32x4_t vshll_n_s16(int16x4_t __a, int __n) { return vmovl_s16(__a) << __n; }
__BUN_CC_INTRIN int32x4_t vaddl_s16(int16x4_t __a, int16x4_t __b) { return vmovl_s16(__a) + vmovl_s16(__b); }
__BUN_CC_INTRIN int32x4_t vaddl_high_s16(int16x8_t __a, int16x8_t __b) { return vmovl_high_s16(__a) + vmovl_high_s16(__b); }
__BUN_CC_INTRIN int32x4_t vaddw_s16(int32x4_t __a, int16x4_t __b) { return __a + vmovl_s16(__b); }
__BUN_CC_INTRIN int32x4_t vaddw_high_s16(int32x4_t __a, int16x8_t __b) { return __a + vmovl_high_s16(__b); }
__BUN_CC_INTRIN int32x4_t vsubl_s16(int16x4_t __a, int16x4_t __b) { return vmovl_s16(__a) - vmovl_s16(__b); }
__BUN_CC_INTRIN int32x4_t vsubl_high_s16(int16x8_t __a, int16x8_t __b) { return vmovl_high_s16(__a) - vmovl_high_s16(__b); }
__BUN_CC_INTRIN int32x4_t vsubw_s16(int32x4_t __a, int16x4_t __b) { return __a - vmovl_s16(__b); }
__BUN_CC_INTRIN int32x4_t vsubw_high_s16(int32x4_t __a, int16x8_t __b) { return __a - vmovl_high_s16(__b); }
__BUN_CC_INTRIN int32x4_t vabdl_s16(int16x4_t __a, int16x4_t __b) { return (int32x4_t)vmovl_u16(vabd_s16(__a, __b)); }
__BUN_CC_INTRIN int32x4_t vmull_s16(int16x4_t __a, int16x4_t __b) { return __builtin_bir_extmul_low_s16(__a, __b); }
__BUN_CC_INTRIN int32x4_t vmull_n_s16(int16x4_t __a, int16_t __b) { return vmull_s16(__a, vdup_n_s16(__b)); }
__BUN_CC_INTRIN int32x4_t vmlal_s16(int32x4_t __a, int16x4_t __b, int16x4_t __c) { return __a + vmull_s16(__b, __c); }
__BUN_CC_INTRIN int32x4_t vmlal_high_s16(int32x4_t __a, int16x8_t __b, int16x8_t __c) { return __a + vmull_high_s16(__b, __c); }
__BUN_CC_INTRIN int32x4_t vmlsl_s16(int32x4_t __a, int16x4_t __b, int16x4_t __c) { return __a - vmull_s16(__b, __c); }
__BUN_CC_INTRIN int32x4_t vmlsl_high_s16(int32x4_t __a, int16x8_t __b, int16x8_t __c) { return __a - vmull_high_s16(__b, __c); }
__BUN_CC_INTRIN int32x4_t vmlal_n_s16(int32x4_t __a, int16x4_t __b, int16_t __c) { return __a + vmull_n_s16(__b, __c); }
__BUN_CC_INTRIN int32x2_t vpaddl_s16(int16x4_t __a) { return (((int32x2_t)__a << 16) >> 16) + ((int32x2_t)__a >> 16); }
__BUN_CC_INTRIN int32x2_t vpadal_s16(int32x2_t __a, int16x4_t __b) { return __a + vpaddl_s16(__b); }
__BUN_CC_INTRIN int32x4_t vpaddlq_s16(int16x8_t __a) { return (((int32x4_t)__a << 16) >> 16) + ((int32x4_t)__a >> 16); }
__BUN_CC_INTRIN int32x4_t vpadalq_s16(int32x4_t __a, int16x8_t __b) { return __a + vpaddlq_s16(__b); }
__BUN_CC_INTRIN int32_t vaddlv_s16(int16x4_t __a) { return __builtin_reduce_add(vmovl_s16(__a)); }
__BUN_CC_INTRIN int32_t vaddlvq_s16(int16x8_t __a) { return __builtin_reduce_add(vpaddlq_s16(__a)); }
__BUN_CC_INTRIN uint32x4_t vshll_n_u16(uint16x4_t __a, int __n) { return vmovl_u16(__a) << __n; }
__BUN_CC_INTRIN uint32x4_t vaddl_u16(uint16x4_t __a, uint16x4_t __b) { return vmovl_u16(__a) + vmovl_u16(__b); }
__BUN_CC_INTRIN uint32x4_t vaddl_high_u16(uint16x8_t __a, uint16x8_t __b) { return vmovl_high_u16(__a) + vmovl_high_u16(__b); }
__BUN_CC_INTRIN uint32x4_t vaddw_u16(uint32x4_t __a, uint16x4_t __b) { return __a + vmovl_u16(__b); }
__BUN_CC_INTRIN uint32x4_t vaddw_high_u16(uint32x4_t __a, uint16x8_t __b) { return __a + vmovl_high_u16(__b); }
__BUN_CC_INTRIN uint32x4_t vsubl_u16(uint16x4_t __a, uint16x4_t __b) { return vmovl_u16(__a) - vmovl_u16(__b); }
__BUN_CC_INTRIN uint32x4_t vsubl_high_u16(uint16x8_t __a, uint16x8_t __b) { return vmovl_high_u16(__a) - vmovl_high_u16(__b); }
__BUN_CC_INTRIN uint32x4_t vsubw_u16(uint32x4_t __a, uint16x4_t __b) { return __a - vmovl_u16(__b); }
__BUN_CC_INTRIN uint32x4_t vsubw_high_u16(uint32x4_t __a, uint16x8_t __b) { return __a - vmovl_high_u16(__b); }
__BUN_CC_INTRIN uint32x4_t vabdl_u16(uint16x4_t __a, uint16x4_t __b) { return (uint32x4_t)vmovl_u16(vabd_u16(__a, __b)); }
__BUN_CC_INTRIN uint32x4_t vmull_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_bir_extmul_low_u16(__a, __b); }
__BUN_CC_INTRIN uint32x4_t vmull_n_u16(uint16x4_t __a, uint16_t __b) { return vmull_u16(__a, vdup_n_u16(__b)); }
__BUN_CC_INTRIN uint32x4_t vmlal_u16(uint32x4_t __a, uint16x4_t __b, uint16x4_t __c) { return __a + vmull_u16(__b, __c); }
__BUN_CC_INTRIN uint32x4_t vmlal_high_u16(uint32x4_t __a, uint16x8_t __b, uint16x8_t __c) { return __a + vmull_high_u16(__b, __c); }
__BUN_CC_INTRIN uint32x4_t vmlsl_u16(uint32x4_t __a, uint16x4_t __b, uint16x4_t __c) { return __a - vmull_u16(__b, __c); }
__BUN_CC_INTRIN uint32x4_t vmlsl_high_u16(uint32x4_t __a, uint16x8_t __b, uint16x8_t __c) { return __a - vmull_high_u16(__b, __c); }
__BUN_CC_INTRIN uint32x4_t vmlal_n_u16(uint32x4_t __a, uint16x4_t __b, uint16_t __c) { return __a + vmull_n_u16(__b, __c); }
__BUN_CC_INTRIN uint32x2_t vpaddl_u16(uint16x4_t __a) { return (((uint32x2_t)__a << 16) >> 16) + ((uint32x2_t)__a >> 16); }
__BUN_CC_INTRIN uint32x2_t vpadal_u16(uint32x2_t __a, uint16x4_t __b) { return __a + vpaddl_u16(__b); }
__BUN_CC_INTRIN uint32x4_t vpaddlq_u16(uint16x8_t __a) { return (((uint32x4_t)__a << 16) >> 16) + ((uint32x4_t)__a >> 16); }
__BUN_CC_INTRIN uint32x4_t vpadalq_u16(uint32x4_t __a, uint16x8_t __b) { return __a + vpaddlq_u16(__b); }
__BUN_CC_INTRIN uint32_t vaddlv_u16(uint16x4_t __a) { return __builtin_reduce_add(vmovl_u16(__a)); }
__BUN_CC_INTRIN uint32_t vaddlvq_u16(uint16x8_t __a) { return __builtin_reduce_add(vpaddlq_u16(__a)); }
__BUN_CC_INTRIN int64x2_t vshll_n_s32(int32x2_t __a, int __n) { return vmovl_s32(__a) << __n; }
__BUN_CC_INTRIN int64x2_t vaddl_s32(int32x2_t __a, int32x2_t __b) { return vmovl_s32(__a) + vmovl_s32(__b); }
__BUN_CC_INTRIN int64x2_t vaddl_high_s32(int32x4_t __a, int32x4_t __b) { return vmovl_high_s32(__a) + vmovl_high_s32(__b); }
__BUN_CC_INTRIN int64x2_t vaddw_s32(int64x2_t __a, int32x2_t __b) { return __a + vmovl_s32(__b); }
__BUN_CC_INTRIN int64x2_t vaddw_high_s32(int64x2_t __a, int32x4_t __b) { return __a + vmovl_high_s32(__b); }
__BUN_CC_INTRIN int64x2_t vsubl_s32(int32x2_t __a, int32x2_t __b) { return vmovl_s32(__a) - vmovl_s32(__b); }
__BUN_CC_INTRIN int64x2_t vsubl_high_s32(int32x4_t __a, int32x4_t __b) { return vmovl_high_s32(__a) - vmovl_high_s32(__b); }
__BUN_CC_INTRIN int64x2_t vsubw_s32(int64x2_t __a, int32x2_t __b) { return __a - vmovl_s32(__b); }
__BUN_CC_INTRIN int64x2_t vsubw_high_s32(int64x2_t __a, int32x4_t __b) { return __a - vmovl_high_s32(__b); }
__BUN_CC_INTRIN int64x2_t vabdl_s32(int32x2_t __a, int32x2_t __b) { return (int64x2_t)vmovl_u32(vabd_s32(__a, __b)); }
__BUN_CC_INTRIN int64x2_t vmull_s32(int32x2_t __a, int32x2_t __b) { return __builtin_bir_extmul_low_s32(__a, __b); }
__BUN_CC_INTRIN int64x2_t vmull_n_s32(int32x2_t __a, int32_t __b) { return vmull_s32(__a, vdup_n_s32(__b)); }
__BUN_CC_INTRIN int64x2_t vmlal_s32(int64x2_t __a, int32x2_t __b, int32x2_t __c) { return __a + vmull_s32(__b, __c); }
__BUN_CC_INTRIN int64x2_t vmlal_high_s32(int64x2_t __a, int32x4_t __b, int32x4_t __c) { return __a + vmull_high_s32(__b, __c); }
__BUN_CC_INTRIN int64x2_t vmlsl_s32(int64x2_t __a, int32x2_t __b, int32x2_t __c) { return __a - vmull_s32(__b, __c); }
__BUN_CC_INTRIN int64x2_t vmlsl_high_s32(int64x2_t __a, int32x4_t __b, int32x4_t __c) { return __a - vmull_high_s32(__b, __c); }
__BUN_CC_INTRIN int64x2_t vmlal_n_s32(int64x2_t __a, int32x2_t __b, int32_t __c) { return __a + vmull_n_s32(__b, __c); }
__BUN_CC_INTRIN int64x1_t vpaddl_s32(int32x2_t __a) { return (((int64x1_t)__a << 32) >> 32) + ((int64x1_t)__a >> 32); }
__BUN_CC_INTRIN int64x1_t vpadal_s32(int64x1_t __a, int32x2_t __b) { return __a + vpaddl_s32(__b); }
__BUN_CC_INTRIN int64x2_t vpaddlq_s32(int32x4_t __a) { return (((int64x2_t)__a << 32) >> 32) + ((int64x2_t)__a >> 32); }
__BUN_CC_INTRIN int64x2_t vpadalq_s32(int64x2_t __a, int32x4_t __b) { return __a + vpaddlq_s32(__b); }
__BUN_CC_INTRIN int64_t vaddlv_s32(int32x2_t __a) { return __builtin_reduce_add(vmovl_s32(__a)); }
__BUN_CC_INTRIN int64_t vaddlvq_s32(int32x4_t __a) { return __builtin_reduce_add(vpaddlq_s32(__a)); }
__BUN_CC_INTRIN uint64x2_t vshll_n_u32(uint32x2_t __a, int __n) { return vmovl_u32(__a) << __n; }
__BUN_CC_INTRIN uint64x2_t vaddl_u32(uint32x2_t __a, uint32x2_t __b) { return vmovl_u32(__a) + vmovl_u32(__b); }
__BUN_CC_INTRIN uint64x2_t vaddl_high_u32(uint32x4_t __a, uint32x4_t __b) { return vmovl_high_u32(__a) + vmovl_high_u32(__b); }
__BUN_CC_INTRIN uint64x2_t vaddw_u32(uint64x2_t __a, uint32x2_t __b) { return __a + vmovl_u32(__b); }
__BUN_CC_INTRIN uint64x2_t vaddw_high_u32(uint64x2_t __a, uint32x4_t __b) { return __a + vmovl_high_u32(__b); }
__BUN_CC_INTRIN uint64x2_t vsubl_u32(uint32x2_t __a, uint32x2_t __b) { return vmovl_u32(__a) - vmovl_u32(__b); }
__BUN_CC_INTRIN uint64x2_t vsubl_high_u32(uint32x4_t __a, uint32x4_t __b) { return vmovl_high_u32(__a) - vmovl_high_u32(__b); }
__BUN_CC_INTRIN uint64x2_t vsubw_u32(uint64x2_t __a, uint32x2_t __b) { return __a - vmovl_u32(__b); }
__BUN_CC_INTRIN uint64x2_t vsubw_high_u32(uint64x2_t __a, uint32x4_t __b) { return __a - vmovl_high_u32(__b); }
__BUN_CC_INTRIN uint64x2_t vabdl_u32(uint32x2_t __a, uint32x2_t __b) { return (uint64x2_t)vmovl_u32(vabd_u32(__a, __b)); }
__BUN_CC_INTRIN uint64x2_t vmull_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_bir_extmul_low_u32(__a, __b); }
__BUN_CC_INTRIN uint64x2_t vmull_n_u32(uint32x2_t __a, uint32_t __b) { return vmull_u32(__a, vdup_n_u32(__b)); }
__BUN_CC_INTRIN uint64x2_t vmlal_u32(uint64x2_t __a, uint32x2_t __b, uint32x2_t __c) { return __a + vmull_u32(__b, __c); }
__BUN_CC_INTRIN uint64x2_t vmlal_high_u32(uint64x2_t __a, uint32x4_t __b, uint32x4_t __c) { return __a + vmull_high_u32(__b, __c); }
__BUN_CC_INTRIN uint64x2_t vmlsl_u32(uint64x2_t __a, uint32x2_t __b, uint32x2_t __c) { return __a - vmull_u32(__b, __c); }
__BUN_CC_INTRIN uint64x2_t vmlsl_high_u32(uint64x2_t __a, uint32x4_t __b, uint32x4_t __c) { return __a - vmull_high_u32(__b, __c); }
__BUN_CC_INTRIN uint64x2_t vmlal_n_u32(uint64x2_t __a, uint32x2_t __b, uint32_t __c) { return __a + vmull_n_u32(__b, __c); }
__BUN_CC_INTRIN uint64x1_t vpaddl_u32(uint32x2_t __a) { return (((uint64x1_t)__a << 32) >> 32) + ((uint64x1_t)__a >> 32); }
__BUN_CC_INTRIN uint64x1_t vpadal_u32(uint64x1_t __a, uint32x2_t __b) { return __a + vpaddl_u32(__b); }
__BUN_CC_INTRIN uint64x2_t vpaddlq_u32(uint32x4_t __a) { return (((uint64x2_t)__a << 32) >> 32) + ((uint64x2_t)__a >> 32); }
__BUN_CC_INTRIN uint64x2_t vpadalq_u32(uint64x2_t __a, uint32x4_t __b) { return __a + vpaddlq_u32(__b); }
__BUN_CC_INTRIN uint64_t vaddlv_u32(uint32x2_t __a) { return __builtin_reduce_add(vmovl_u32(__a)); }
__BUN_CC_INTRIN uint64_t vaddlvq_u32(uint32x4_t __a) { return __builtin_reduce_add(vpaddlq_u32(__a)); }
__BUN_CC_INTRIN int8x8_t vmovn_s16(int16x8_t __a) { return __builtin_convertvector(__a, int8x8_t); }
__BUN_CC_INTRIN int8x16_t vmovn_high_s16(int8x8_t __r, int16x8_t __a) { return vcombine_s8(__r, vmovn_s16(__a)); }
__BUN_CC_INTRIN int8x8_t vshrn_n_s16(int16x8_t __a, int __n) { return vmovn_s16(__a >> __n); }
__BUN_CC_INTRIN int8x16_t vshrn_high_n_s16(int8x8_t __r, int16x8_t __a, int __n) { return vcombine_s8(__r, vshrn_n_s16(__a, __n)); }
__BUN_CC_INTRIN int8x8_t vrshrn_n_s16(int16x8_t __a, int __n) { return vmovn_s16((__a >> __n) + ((__a >> (__n - 1)) & 1)); }
__BUN_CC_INTRIN int8x8_t vaddhn_s16(int16x8_t __a, int16x8_t __b) { return vmovn_s16((__a + __b) >> 8); }
__BUN_CC_INTRIN int8x8_t vsubhn_s16(int16x8_t __a, int16x8_t __b) { return vmovn_s16((__a - __b) >> 8); }
__BUN_CC_INTRIN int8x8_t vqmovn_s16(int16x8_t __a) { __a = __a > vdupq_n_s16(127) ? vdupq_n_s16(127) : __a; __a = __a < vdupq_n_s16(-127 - 1) ? vdupq_n_s16(-127 - 1) : __a; return __builtin_convertvector(__a, int8x8_t); }
__BUN_CC_INTRIN uint8x8_t vqmovun_s16(int16x8_t __a) { __a = __a > vdupq_n_s16(255) ? vdupq_n_s16(255) : __a; __a = __a < 0 ? vdupq_n_s16(0) : __a; return __builtin_convertvector(__a, uint8x8_t); }
__BUN_CC_INTRIN uint8x16_t vqmovun_high_s16(uint8x8_t __r, int16x8_t __a) { return vcombine_u8(__r, vqmovun_s16(__a)); }
__BUN_CC_INTRIN int8x16_t vqmovn_high_s16(int8x8_t __r, int16x8_t __a) { return vcombine_s8(__r, vqmovn_s16(__a)); }
__BUN_CC_INTRIN uint8x8_t vmovn_u16(uint16x8_t __a) { return __builtin_convertvector(__a, uint8x8_t); }
__BUN_CC_INTRIN uint8x16_t vmovn_high_u16(uint8x8_t __r, uint16x8_t __a) { return vcombine_u8(__r, vmovn_u16(__a)); }
__BUN_CC_INTRIN uint8x8_t vshrn_n_u16(uint16x8_t __a, int __n) { return vmovn_u16(__a >> __n); }
__BUN_CC_INTRIN uint8x16_t vshrn_high_n_u16(uint8x8_t __r, uint16x8_t __a, int __n) { return vcombine_u8(__r, vshrn_n_u16(__a, __n)); }
__BUN_CC_INTRIN uint8x8_t vrshrn_n_u16(uint16x8_t __a, int __n) { return vmovn_u16((__a >> __n) + ((__a >> (__n - 1)) & 1)); }
__BUN_CC_INTRIN uint8x8_t vaddhn_u16(uint16x8_t __a, uint16x8_t __b) { return vmovn_u16((__a + __b) >> 8); }
__BUN_CC_INTRIN uint8x8_t vsubhn_u16(uint16x8_t __a, uint16x8_t __b) { return vmovn_u16((__a - __b) >> 8); }
__BUN_CC_INTRIN uint8x8_t vqmovn_u16(uint16x8_t __a) { __a = __a > vdupq_n_u16(255u) ? vdupq_n_u16(255u) : __a; return __builtin_convertvector(__a, uint8x8_t); }
__BUN_CC_INTRIN uint8x16_t vqmovn_high_u16(uint8x8_t __r, uint16x8_t __a) { return vcombine_u8(__r, vqmovn_u16(__a)); }
__BUN_CC_INTRIN int16x4_t vmovn_s32(int32x4_t __a) { return __builtin_convertvector(__a, int16x4_t); }
__BUN_CC_INTRIN int16x8_t vmovn_high_s32(int16x4_t __r, int32x4_t __a) { return vcombine_s16(__r, vmovn_s32(__a)); }
__BUN_CC_INTRIN int16x4_t vshrn_n_s32(int32x4_t __a, int __n) { return vmovn_s32(__a >> __n); }
__BUN_CC_INTRIN int16x8_t vshrn_high_n_s32(int16x4_t __r, int32x4_t __a, int __n) { return vcombine_s16(__r, vshrn_n_s32(__a, __n)); }
__BUN_CC_INTRIN int16x4_t vrshrn_n_s32(int32x4_t __a, int __n) { return vmovn_s32((__a >> __n) + ((__a >> (__n - 1)) & 1)); }
__BUN_CC_INTRIN int16x4_t vaddhn_s32(int32x4_t __a, int32x4_t __b) { return vmovn_s32((__a + __b) >> 16); }
__BUN_CC_INTRIN int16x4_t vsubhn_s32(int32x4_t __a, int32x4_t __b) { return vmovn_s32((__a - __b) >> 16); }
__BUN_CC_INTRIN int16x4_t vqmovn_s32(int32x4_t __a) { __a = __a > vdupq_n_s32(32767) ? vdupq_n_s32(32767) : __a; __a = __a < vdupq_n_s32(-32767 - 1) ? vdupq_n_s32(-32767 - 1) : __a; return __builtin_convertvector(__a, int16x4_t); }
__BUN_CC_INTRIN uint16x4_t vqmovun_s32(int32x4_t __a) { __a = __a > vdupq_n_s32(65535) ? vdupq_n_s32(65535) : __a; __a = __a < 0 ? vdupq_n_s32(0) : __a; return __builtin_convertvector(__a, uint16x4_t); }
__BUN_CC_INTRIN uint16x8_t vqmovun_high_s32(uint16x4_t __r, int32x4_t __a) { return vcombine_u16(__r, vqmovun_s32(__a)); }
__BUN_CC_INTRIN int16x8_t vqmovn_high_s32(int16x4_t __r, int32x4_t __a) { return vcombine_s16(__r, vqmovn_s32(__a)); }
__BUN_CC_INTRIN uint16x4_t vmovn_u32(uint32x4_t __a) { return __builtin_convertvector(__a, uint16x4_t); }
__BUN_CC_INTRIN uint16x8_t vmovn_high_u32(uint16x4_t __r, uint32x4_t __a) { return vcombine_u16(__r, vmovn_u32(__a)); }
__BUN_CC_INTRIN uint16x4_t vshrn_n_u32(uint32x4_t __a, int __n) { return vmovn_u32(__a >> __n); }
__BUN_CC_INTRIN uint16x8_t vshrn_high_n_u32(uint16x4_t __r, uint32x4_t __a, int __n) { return vcombine_u16(__r, vshrn_n_u32(__a, __n)); }
__BUN_CC_INTRIN uint16x4_t vrshrn_n_u32(uint32x4_t __a, int __n) { return vmovn_u32((__a >> __n) + ((__a >> (__n - 1)) & 1)); }
__BUN_CC_INTRIN uint16x4_t vaddhn_u32(uint32x4_t __a, uint32x4_t __b) { return vmovn_u32((__a + __b) >> 16); }
__BUN_CC_INTRIN uint16x4_t vsubhn_u32(uint32x4_t __a, uint32x4_t __b) { return vmovn_u32((__a - __b) >> 16); }
__BUN_CC_INTRIN uint16x4_t vqmovn_u32(uint32x4_t __a) { __a = __a > vdupq_n_u32(65535u) ? vdupq_n_u32(65535u) : __a; return __builtin_convertvector(__a, uint16x4_t); }
__BUN_CC_INTRIN uint16x8_t vqmovn_high_u32(uint16x4_t __r, uint32x4_t __a) { return vcombine_u16(__r, vqmovn_u32(__a)); }
__BUN_CC_INTRIN int32x2_t vmovn_s64(int64x2_t __a) { return __builtin_convertvector(__a, int32x2_t); }
__BUN_CC_INTRIN int32x4_t vmovn_high_s64(int32x2_t __r, int64x2_t __a) { return vcombine_s32(__r, vmovn_s64(__a)); }
__BUN_CC_INTRIN int32x2_t vshrn_n_s64(int64x2_t __a, int __n) { return vmovn_s64(__a >> __n); }
__BUN_CC_INTRIN int32x4_t vshrn_high_n_s64(int32x2_t __r, int64x2_t __a, int __n) { return vcombine_s32(__r, vshrn_n_s64(__a, __n)); }
__BUN_CC_INTRIN int32x2_t vrshrn_n_s64(int64x2_t __a, int __n) { return vmovn_s64((__a >> __n) + ((__a >> (__n - 1)) & 1)); }
__BUN_CC_INTRIN int32x2_t vaddhn_s64(int64x2_t __a, int64x2_t __b) { return vmovn_s64((__a + __b) >> 32); }
__BUN_CC_INTRIN int32x2_t vsubhn_s64(int64x2_t __a, int64x2_t __b) { return vmovn_s64((__a - __b) >> 32); }
__BUN_CC_INTRIN int32x2_t vqmovn_s64(int64x2_t __a) { __a = __a > vdupq_n_s64(2147483647) ? vdupq_n_s64(2147483647) : __a; __a = __a < vdupq_n_s64(-2147483647 - 1) ? vdupq_n_s64(-2147483647 - 1) : __a; return __builtin_convertvector(__a, int32x2_t); }
__BUN_CC_INTRIN uint32x2_t vqmovun_s64(int64x2_t __a) { __a = __a > vdupq_n_s64(4294967295) ? vdupq_n_s64(4294967295) : __a; __a = __a < 0 ? vdupq_n_s64(0) : __a; return __builtin_convertvector(__a, uint32x2_t); }
__BUN_CC_INTRIN uint32x4_t vqmovun_high_s64(uint32x2_t __r, int64x2_t __a) { return vcombine_u32(__r, vqmovun_s64(__a)); }
__BUN_CC_INTRIN int32x4_t vqmovn_high_s64(int32x2_t __r, int64x2_t __a) { return vcombine_s32(__r, vqmovn_s64(__a)); }
__BUN_CC_INTRIN uint32x2_t vmovn_u64(uint64x2_t __a) { return __builtin_convertvector(__a, uint32x2_t); }
__BUN_CC_INTRIN uint32x4_t vmovn_high_u64(uint32x2_t __r, uint64x2_t __a) { return vcombine_u32(__r, vmovn_u64(__a)); }
__BUN_CC_INTRIN uint32x2_t vshrn_n_u64(uint64x2_t __a, int __n) { return vmovn_u64(__a >> __n); }
__BUN_CC_INTRIN uint32x4_t vshrn_high_n_u64(uint32x2_t __r, uint64x2_t __a, int __n) { return vcombine_u32(__r, vshrn_n_u64(__a, __n)); }
__BUN_CC_INTRIN uint32x2_t vrshrn_n_u64(uint64x2_t __a, int __n) { return vmovn_u64((__a >> __n) + ((__a >> (__n - 1)) & 1)); }
__BUN_CC_INTRIN uint32x2_t vaddhn_u64(uint64x2_t __a, uint64x2_t __b) { return vmovn_u64((__a + __b) >> 32); }
__BUN_CC_INTRIN uint32x2_t vsubhn_u64(uint64x2_t __a, uint64x2_t __b) { return vmovn_u64((__a - __b) >> 32); }
__BUN_CC_INTRIN uint32x2_t vqmovn_u64(uint64x2_t __a) { __a = __a > vdupq_n_u64(4294967295u) ? vdupq_n_u64(4294967295u) : __a; return __builtin_convertvector(__a, uint32x2_t); }
__BUN_CC_INTRIN uint32x4_t vqmovn_high_u64(uint32x2_t __r, uint64x2_t __a) { return vcombine_u32(__r, vqmovn_u64(__a)); }
__BUN_CC_INTRIN uint8x8_t vqshl_n_u8(uint8x8_t __a, int __n) { return __n == 0 ? __a : ((__a >> (8 - __n)) != 0 ? ~vdup_n_u8(0) : __a << __n); }
__BUN_CC_INTRIN uint8x16_t vqshlq_n_u8(uint8x16_t __a, int __n) { return __n == 0 ? __a : ((__a >> (8 - __n)) != 0 ? ~vdupq_n_u8(0) : __a << __n); }
__BUN_CC_INTRIN uint16x4_t vqshl_n_u16(uint16x4_t __a, int __n) { return __n == 0 ? __a : ((__a >> (16 - __n)) != 0 ? ~vdup_n_u16(0) : __a << __n); }
__BUN_CC_INTRIN uint16x8_t vqshlq_n_u16(uint16x8_t __a, int __n) { return __n == 0 ? __a : ((__a >> (16 - __n)) != 0 ? ~vdupq_n_u16(0) : __a << __n); }
__BUN_CC_INTRIN uint32x2_t vqshl_n_u32(uint32x2_t __a, int __n) { return __n == 0 ? __a : ((__a >> (32 - __n)) != 0 ? ~vdup_n_u32(0) : __a << __n); }
__BUN_CC_INTRIN uint32x4_t vqshlq_n_u32(uint32x4_t __a, int __n) { return __n == 0 ? __a : ((__a >> (32 - __n)) != 0 ? ~vdupq_n_u32(0) : __a << __n); }
__BUN_CC_INTRIN uint64x1_t vqshl_n_u64(uint64x1_t __a, int __n) { return __n == 0 ? __a : ((__a >> (64 - __n)) != 0 ? ~vdup_n_u64(0) : __a << __n); }
__BUN_CC_INTRIN uint64x2_t vqshlq_n_u64(uint64x2_t __a, int __n) { return __n == 0 ? __a : ((__a >> (64 - __n)) != 0 ? ~vdupq_n_u64(0) : __a << __n); }

/* Conversions of 64-bit vectors. */
__BUN_CC_INTRIN float32x2_t vcvt_f32_s32(int32x2_t __a) { return __builtin_convertvector(__a, float32x2_t); }
__BUN_CC_INTRIN float32x2_t vcvt_f32_u32(uint32x2_t __a) { return __builtin_convertvector(__a, float32x2_t); }
__BUN_CC_INTRIN int32x2_t vcvt_s32_f32(float32x2_t __a) { return __builtin_convertvector(__a, int32x2_t); }
__BUN_CC_INTRIN uint32x2_t vcvt_u32_f32(float32x2_t __a) { return __builtin_convertvector(__a, uint32x2_t); }
__BUN_CC_INTRIN float64x1_t vcvt_f64_s64(int64x1_t __a) { return __builtin_convertvector(__a, float64x1_t); }
__BUN_CC_INTRIN float64x1_t vcvt_f64_u64(uint64x1_t __a) { return __builtin_convertvector(__a, float64x1_t); }
__BUN_CC_INTRIN int64x1_t vcvt_s64_f64(float64x1_t __a) { return __builtin_convertvector(__a, int64x1_t); }
__BUN_CC_INTRIN uint64x1_t vcvt_u64_f64(float64x1_t __a) { return __builtin_convertvector(__a, uint64x1_t); }
__BUN_CC_INTRIN float64x2_t vcvtq_f64_u64(uint64x2_t __a) { return __builtin_convertvector(__a, float64x2_t); }
__BUN_CC_INTRIN uint64x2_t vcvtq_u64_f64(float64x2_t __a) { return __builtin_convertvector(__a, uint64x2_t); }
__BUN_CC_INTRIN float64x2_t vcvt_f64_f32(float32x2_t __a) { return __builtin_convertvector(__a, float64x2_t); }
__BUN_CC_INTRIN float64x2_t vcvt_high_f64_f32(float32x4_t __a) { return vcvt_f64_f32(vget_high_f32(__a)); }
__BUN_CC_INTRIN float32x2_t vcvt_f32_f64(float64x2_t __a) { return __builtin_convertvector(__a, float32x2_t); }
__BUN_CC_INTRIN float32x4_t vcvt_high_f32_f64(float32x2_t __r, float64x2_t __a) { return vcombine_f32(__r, vcvt_f32_f64(__a)); }

/* Lanes rearranged: extraction, reversal, interleaving, table lookup, bit counts. */
#define vext_s8(a, b, n) __builtin_shufflevector((int8x8_t)(a), (int8x8_t)(b), (n), (n) + 1, (n) + 2, (n) + 3, (n) + 4, (n) + 5, (n) + 6, (n) + 7)
__BUN_CC_INTRIN int8x8_t vrev64_s8(int8x8_t __a) { return __builtin_shufflevector(__a, __a, 7, 6, 5, 4, 3, 2, 1, 0); }
__BUN_CC_INTRIN int8x8_t vrev32_s8(int8x8_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0, 7, 6, 5, 4); }
__BUN_CC_INTRIN int8x8_t vrev16_s8(int8x8_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2, 5, 4, 7, 6); }
__BUN_CC_INTRIN int8x8_t vzip1_s8(int8x8_t __a, int8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 1, 9, 2, 10, 3, 11); }
__BUN_CC_INTRIN int8x8_t vzip2_s8(int8x8_t __a, int8x8_t __b) { return __builtin_shufflevector(__a, __b, 4, 12, 5, 13, 6, 14, 7, 15); }
__BUN_CC_INTRIN int8x8x2_t vzip_s8(int8x8_t __a, int8x8_t __b) { return (int8x8x2_t){{vzip1_s8(__a, __b), vzip2_s8(__a, __b)}}; }
__BUN_CC_INTRIN int8x8_t vuzp1_s8(int8x8_t __a, int8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14); }
__BUN_CC_INTRIN int8x8_t vuzp2_s8(int8x8_t __a, int8x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN int8x8x2_t vuzp_s8(int8x8_t __a, int8x8_t __b) { return (int8x8x2_t){{vuzp1_s8(__a, __b), vuzp2_s8(__a, __b)}}; }
__BUN_CC_INTRIN int8x8_t vtrn1_s8(int8x8_t __a, int8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 2, 10, 4, 12, 6, 14); }
__BUN_CC_INTRIN int8x8_t vtrn2_s8(int8x8_t __a, int8x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 9, 3, 11, 5, 13, 7, 15); }
__BUN_CC_INTRIN int8x8x2_t vtrn_s8(int8x8_t __a, int8x8_t __b) { return (int8x8x2_t){{vtrn1_s8(__a, __b), vtrn2_s8(__a, __b)}}; }
#define vextq_s8(a, b, n) __builtin_shufflevector((int8x16_t)(a), (int8x16_t)(b), (n), (n) + 1, (n) + 2, (n) + 3, (n) + 4, (n) + 5, (n) + 6, (n) + 7, (n) + 8, (n) + 9, (n) + 10, (n) + 11, (n) + 12, (n) + 13, (n) + 14, (n) + 15)
__BUN_CC_INTRIN int8x16_t vrev64q_s8(int8x16_t __a) { return __builtin_shufflevector(__a, __a, 7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11, 10, 9, 8); }
__BUN_CC_INTRIN int8x16_t vrev32q_s8(int8x16_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12); }
__BUN_CC_INTRIN int8x16_t vrev16q_s8(int8x16_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15, 14); }
__BUN_CC_INTRIN int8x16_t vzip1q_s8(int8x16_t __a, int8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 16, 1, 17, 2, 18, 3, 19, 4, 20, 5, 21, 6, 22, 7, 23); }
__BUN_CC_INTRIN int8x16_t vzip2q_s8(int8x16_t __a, int8x16_t __b) { return __builtin_shufflevector(__a, __b, 8, 24, 9, 25, 10, 26, 11, 27, 12, 28, 13, 29, 14, 30, 15, 31); }
__BUN_CC_INTRIN int8x16x2_t vzipq_s8(int8x16_t __a, int8x16_t __b) { return (int8x16x2_t){{vzip1q_s8(__a, __b), vzip2q_s8(__a, __b)}}; }
__BUN_CC_INTRIN int8x16_t vuzp1q_s8(int8x16_t __a, int8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30); }
__BUN_CC_INTRIN int8x16_t vuzp2q_s8(int8x16_t __a, int8x16_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31); }
__BUN_CC_INTRIN int8x16x2_t vuzpq_s8(int8x16_t __a, int8x16_t __b) { return (int8x16x2_t){{vuzp1q_s8(__a, __b), vuzp2q_s8(__a, __b)}}; }
__BUN_CC_INTRIN int8x16_t vtrn1q_s8(int8x16_t __a, int8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 16, 2, 18, 4, 20, 6, 22, 8, 24, 10, 26, 12, 28, 14, 30); }
__BUN_CC_INTRIN int8x16_t vtrn2q_s8(int8x16_t __a, int8x16_t __b) { return __builtin_shufflevector(__a, __b, 1, 17, 3, 19, 5, 21, 7, 23, 9, 25, 11, 27, 13, 29, 15, 31); }
__BUN_CC_INTRIN int8x16x2_t vtrnq_s8(int8x16_t __a, int8x16_t __b) { return (int8x16x2_t){{vtrn1q_s8(__a, __b), vtrn2q_s8(__a, __b)}}; }
#define vext_u8(a, b, n) __builtin_shufflevector((uint8x8_t)(a), (uint8x8_t)(b), (n), (n) + 1, (n) + 2, (n) + 3, (n) + 4, (n) + 5, (n) + 6, (n) + 7)
__BUN_CC_INTRIN uint8x8_t vrev64_u8(uint8x8_t __a) { return __builtin_shufflevector(__a, __a, 7, 6, 5, 4, 3, 2, 1, 0); }
__BUN_CC_INTRIN uint8x8_t vrev32_u8(uint8x8_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0, 7, 6, 5, 4); }
__BUN_CC_INTRIN uint8x8_t vrev16_u8(uint8x8_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2, 5, 4, 7, 6); }
__BUN_CC_INTRIN uint8x8_t vzip1_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 1, 9, 2, 10, 3, 11); }
__BUN_CC_INTRIN uint8x8_t vzip2_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_shufflevector(__a, __b, 4, 12, 5, 13, 6, 14, 7, 15); }
__BUN_CC_INTRIN uint8x8x2_t vzip_u8(uint8x8_t __a, uint8x8_t __b) { return (uint8x8x2_t){{vzip1_u8(__a, __b), vzip2_u8(__a, __b)}}; }
__BUN_CC_INTRIN uint8x8_t vuzp1_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14); }
__BUN_CC_INTRIN uint8x8_t vuzp2_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN uint8x8x2_t vuzp_u8(uint8x8_t __a, uint8x8_t __b) { return (uint8x8x2_t){{vuzp1_u8(__a, __b), vuzp2_u8(__a, __b)}}; }
__BUN_CC_INTRIN uint8x8_t vtrn1_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 2, 10, 4, 12, 6, 14); }
__BUN_CC_INTRIN uint8x8_t vtrn2_u8(uint8x8_t __a, uint8x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 9, 3, 11, 5, 13, 7, 15); }
__BUN_CC_INTRIN uint8x8x2_t vtrn_u8(uint8x8_t __a, uint8x8_t __b) { return (uint8x8x2_t){{vtrn1_u8(__a, __b), vtrn2_u8(__a, __b)}}; }
#define vextq_u8(a, b, n) __builtin_shufflevector((uint8x16_t)(a), (uint8x16_t)(b), (n), (n) + 1, (n) + 2, (n) + 3, (n) + 4, (n) + 5, (n) + 6, (n) + 7, (n) + 8, (n) + 9, (n) + 10, (n) + 11, (n) + 12, (n) + 13, (n) + 14, (n) + 15)
__BUN_CC_INTRIN uint8x16_t vrev64q_u8(uint8x16_t __a) { return __builtin_shufflevector(__a, __a, 7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11, 10, 9, 8); }
__BUN_CC_INTRIN uint8x16_t vrev32q_u8(uint8x16_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12); }
__BUN_CC_INTRIN uint8x16_t vrev16q_u8(uint8x16_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15, 14); }
__BUN_CC_INTRIN uint8x16_t vzip1q_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 16, 1, 17, 2, 18, 3, 19, 4, 20, 5, 21, 6, 22, 7, 23); }
__BUN_CC_INTRIN uint8x16_t vzip2q_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_shufflevector(__a, __b, 8, 24, 9, 25, 10, 26, 11, 27, 12, 28, 13, 29, 14, 30, 15, 31); }
__BUN_CC_INTRIN uint8x16x2_t vzipq_u8(uint8x16_t __a, uint8x16_t __b) { return (uint8x16x2_t){{vzip1q_u8(__a, __b), vzip2q_u8(__a, __b)}}; }
__BUN_CC_INTRIN uint8x16_t vuzp1q_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30); }
__BUN_CC_INTRIN uint8x16_t vuzp2q_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31); }
__BUN_CC_INTRIN uint8x16x2_t vuzpq_u8(uint8x16_t __a, uint8x16_t __b) { return (uint8x16x2_t){{vuzp1q_u8(__a, __b), vuzp2q_u8(__a, __b)}}; }
__BUN_CC_INTRIN uint8x16_t vtrn1q_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 16, 2, 18, 4, 20, 6, 22, 8, 24, 10, 26, 12, 28, 14, 30); }
__BUN_CC_INTRIN uint8x16_t vtrn2q_u8(uint8x16_t __a, uint8x16_t __b) { return __builtin_shufflevector(__a, __b, 1, 17, 3, 19, 5, 21, 7, 23, 9, 25, 11, 27, 13, 29, 15, 31); }
__BUN_CC_INTRIN uint8x16x2_t vtrnq_u8(uint8x16_t __a, uint8x16_t __b) { return (uint8x16x2_t){{vtrn1q_u8(__a, __b), vtrn2q_u8(__a, __b)}}; }
#define vext_s16(a, b, n) __builtin_shufflevector((int16x4_t)(a), (int16x4_t)(b), (n), (n) + 1, (n) + 2, (n) + 3)
__BUN_CC_INTRIN int16x4_t vrev64_s16(int16x4_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0); }
__BUN_CC_INTRIN int16x4_t vrev32_s16(int16x4_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2); }
__BUN_CC_INTRIN int16x4_t vzip1_s16(int16x4_t __a, int16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 1, 5); }
__BUN_CC_INTRIN int16x4_t vzip2_s16(int16x4_t __a, int16x4_t __b) { return __builtin_shufflevector(__a, __b, 2, 6, 3, 7); }
__BUN_CC_INTRIN int16x4x2_t vzip_s16(int16x4_t __a, int16x4_t __b) { return (int16x4x2_t){{vzip1_s16(__a, __b), vzip2_s16(__a, __b)}}; }
__BUN_CC_INTRIN int16x4_t vuzp1_s16(int16x4_t __a, int16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6); }
__BUN_CC_INTRIN int16x4_t vuzp2_s16(int16x4_t __a, int16x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN int16x4x2_t vuzp_s16(int16x4_t __a, int16x4_t __b) { return (int16x4x2_t){{vuzp1_s16(__a, __b), vuzp2_s16(__a, __b)}}; }
__BUN_CC_INTRIN int16x4_t vtrn1_s16(int16x4_t __a, int16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 2, 6); }
__BUN_CC_INTRIN int16x4_t vtrn2_s16(int16x4_t __a, int16x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 5, 3, 7); }
__BUN_CC_INTRIN int16x4x2_t vtrn_s16(int16x4_t __a, int16x4_t __b) { return (int16x4x2_t){{vtrn1_s16(__a, __b), vtrn2_s16(__a, __b)}}; }
#define vextq_s16(a, b, n) __builtin_shufflevector((int16x8_t)(a), (int16x8_t)(b), (n), (n) + 1, (n) + 2, (n) + 3, (n) + 4, (n) + 5, (n) + 6, (n) + 7)
__BUN_CC_INTRIN int16x8_t vrev64q_s16(int16x8_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0, 7, 6, 5, 4); }
__BUN_CC_INTRIN int16x8_t vrev32q_s16(int16x8_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2, 5, 4, 7, 6); }
__BUN_CC_INTRIN int16x8_t vzip1q_s16(int16x8_t __a, int16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 1, 9, 2, 10, 3, 11); }
__BUN_CC_INTRIN int16x8_t vzip2q_s16(int16x8_t __a, int16x8_t __b) { return __builtin_shufflevector(__a, __b, 4, 12, 5, 13, 6, 14, 7, 15); }
__BUN_CC_INTRIN int16x8x2_t vzipq_s16(int16x8_t __a, int16x8_t __b) { return (int16x8x2_t){{vzip1q_s16(__a, __b), vzip2q_s16(__a, __b)}}; }
__BUN_CC_INTRIN int16x8_t vuzp1q_s16(int16x8_t __a, int16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14); }
__BUN_CC_INTRIN int16x8_t vuzp2q_s16(int16x8_t __a, int16x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN int16x8x2_t vuzpq_s16(int16x8_t __a, int16x8_t __b) { return (int16x8x2_t){{vuzp1q_s16(__a, __b), vuzp2q_s16(__a, __b)}}; }
__BUN_CC_INTRIN int16x8_t vtrn1q_s16(int16x8_t __a, int16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 2, 10, 4, 12, 6, 14); }
__BUN_CC_INTRIN int16x8_t vtrn2q_s16(int16x8_t __a, int16x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 9, 3, 11, 5, 13, 7, 15); }
__BUN_CC_INTRIN int16x8x2_t vtrnq_s16(int16x8_t __a, int16x8_t __b) { return (int16x8x2_t){{vtrn1q_s16(__a, __b), vtrn2q_s16(__a, __b)}}; }
#define vext_u16(a, b, n) __builtin_shufflevector((uint16x4_t)(a), (uint16x4_t)(b), (n), (n) + 1, (n) + 2, (n) + 3)
__BUN_CC_INTRIN uint16x4_t vrev64_u16(uint16x4_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0); }
__BUN_CC_INTRIN uint16x4_t vrev32_u16(uint16x4_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2); }
__BUN_CC_INTRIN uint16x4_t vzip1_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 1, 5); }
__BUN_CC_INTRIN uint16x4_t vzip2_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_shufflevector(__a, __b, 2, 6, 3, 7); }
__BUN_CC_INTRIN uint16x4x2_t vzip_u16(uint16x4_t __a, uint16x4_t __b) { return (uint16x4x2_t){{vzip1_u16(__a, __b), vzip2_u16(__a, __b)}}; }
__BUN_CC_INTRIN uint16x4_t vuzp1_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6); }
__BUN_CC_INTRIN uint16x4_t vuzp2_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN uint16x4x2_t vuzp_u16(uint16x4_t __a, uint16x4_t __b) { return (uint16x4x2_t){{vuzp1_u16(__a, __b), vuzp2_u16(__a, __b)}}; }
__BUN_CC_INTRIN uint16x4_t vtrn1_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 2, 6); }
__BUN_CC_INTRIN uint16x4_t vtrn2_u16(uint16x4_t __a, uint16x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 5, 3, 7); }
__BUN_CC_INTRIN uint16x4x2_t vtrn_u16(uint16x4_t __a, uint16x4_t __b) { return (uint16x4x2_t){{vtrn1_u16(__a, __b), vtrn2_u16(__a, __b)}}; }
#define vextq_u16(a, b, n) __builtin_shufflevector((uint16x8_t)(a), (uint16x8_t)(b), (n), (n) + 1, (n) + 2, (n) + 3, (n) + 4, (n) + 5, (n) + 6, (n) + 7)
__BUN_CC_INTRIN uint16x8_t vrev64q_u16(uint16x8_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0, 7, 6, 5, 4); }
__BUN_CC_INTRIN uint16x8_t vrev32q_u16(uint16x8_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2, 5, 4, 7, 6); }
__BUN_CC_INTRIN uint16x8_t vzip1q_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 1, 9, 2, 10, 3, 11); }
__BUN_CC_INTRIN uint16x8_t vzip2q_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_shufflevector(__a, __b, 4, 12, 5, 13, 6, 14, 7, 15); }
__BUN_CC_INTRIN uint16x8x2_t vzipq_u16(uint16x8_t __a, uint16x8_t __b) { return (uint16x8x2_t){{vzip1q_u16(__a, __b), vzip2q_u16(__a, __b)}}; }
__BUN_CC_INTRIN uint16x8_t vuzp1q_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14); }
__BUN_CC_INTRIN uint16x8_t vuzp2q_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN uint16x8x2_t vuzpq_u16(uint16x8_t __a, uint16x8_t __b) { return (uint16x8x2_t){{vuzp1q_u16(__a, __b), vuzp2q_u16(__a, __b)}}; }
__BUN_CC_INTRIN uint16x8_t vtrn1q_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 2, 10, 4, 12, 6, 14); }
__BUN_CC_INTRIN uint16x8_t vtrn2q_u16(uint16x8_t __a, uint16x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 9, 3, 11, 5, 13, 7, 15); }
__BUN_CC_INTRIN uint16x8x2_t vtrnq_u16(uint16x8_t __a, uint16x8_t __b) { return (uint16x8x2_t){{vtrn1q_u16(__a, __b), vtrn2q_u16(__a, __b)}}; }
#define vext_s32(a, b, n) __builtin_shufflevector((int32x2_t)(a), (int32x2_t)(b), (n), (n) + 1)
__BUN_CC_INTRIN int32x2_t vrev64_s32(int32x2_t __a) { return __builtin_shufflevector(__a, __a, 1, 0); }
__BUN_CC_INTRIN int32x2_t vzip1_s32(int32x2_t __a, int32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN int32x2_t vzip2_s32(int32x2_t __a, int32x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN int32x2x2_t vzip_s32(int32x2_t __a, int32x2_t __b) { return (int32x2x2_t){{vzip1_s32(__a, __b), vzip2_s32(__a, __b)}}; }
__BUN_CC_INTRIN int32x2_t vuzp1_s32(int32x2_t __a, int32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN int32x2_t vuzp2_s32(int32x2_t __a, int32x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN int32x2x2_t vuzp_s32(int32x2_t __a, int32x2_t __b) { return (int32x2x2_t){{vuzp1_s32(__a, __b), vuzp2_s32(__a, __b)}}; }
__BUN_CC_INTRIN int32x2_t vtrn1_s32(int32x2_t __a, int32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN int32x2_t vtrn2_s32(int32x2_t __a, int32x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN int32x2x2_t vtrn_s32(int32x2_t __a, int32x2_t __b) { return (int32x2x2_t){{vtrn1_s32(__a, __b), vtrn2_s32(__a, __b)}}; }
#define vextq_s32(a, b, n) __builtin_shufflevector((int32x4_t)(a), (int32x4_t)(b), (n), (n) + 1, (n) + 2, (n) + 3)
__BUN_CC_INTRIN int32x4_t vrev64q_s32(int32x4_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2); }
__BUN_CC_INTRIN int32x4_t vzip1q_s32(int32x4_t __a, int32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 1, 5); }
__BUN_CC_INTRIN int32x4_t vzip2q_s32(int32x4_t __a, int32x4_t __b) { return __builtin_shufflevector(__a, __b, 2, 6, 3, 7); }
__BUN_CC_INTRIN int32x4x2_t vzipq_s32(int32x4_t __a, int32x4_t __b) { return (int32x4x2_t){{vzip1q_s32(__a, __b), vzip2q_s32(__a, __b)}}; }
__BUN_CC_INTRIN int32x4_t vuzp1q_s32(int32x4_t __a, int32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6); }
__BUN_CC_INTRIN int32x4_t vuzp2q_s32(int32x4_t __a, int32x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN int32x4x2_t vuzpq_s32(int32x4_t __a, int32x4_t __b) { return (int32x4x2_t){{vuzp1q_s32(__a, __b), vuzp2q_s32(__a, __b)}}; }
__BUN_CC_INTRIN int32x4_t vtrn1q_s32(int32x4_t __a, int32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 2, 6); }
__BUN_CC_INTRIN int32x4_t vtrn2q_s32(int32x4_t __a, int32x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 5, 3, 7); }
__BUN_CC_INTRIN int32x4x2_t vtrnq_s32(int32x4_t __a, int32x4_t __b) { return (int32x4x2_t){{vtrn1q_s32(__a, __b), vtrn2q_s32(__a, __b)}}; }
#define vext_u32(a, b, n) __builtin_shufflevector((uint32x2_t)(a), (uint32x2_t)(b), (n), (n) + 1)
__BUN_CC_INTRIN uint32x2_t vrev64_u32(uint32x2_t __a) { return __builtin_shufflevector(__a, __a, 1, 0); }
__BUN_CC_INTRIN uint32x2_t vzip1_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN uint32x2_t vzip2_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN uint32x2x2_t vzip_u32(uint32x2_t __a, uint32x2_t __b) { return (uint32x2x2_t){{vzip1_u32(__a, __b), vzip2_u32(__a, __b)}}; }
__BUN_CC_INTRIN uint32x2_t vuzp1_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN uint32x2_t vuzp2_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN uint32x2x2_t vuzp_u32(uint32x2_t __a, uint32x2_t __b) { return (uint32x2x2_t){{vuzp1_u32(__a, __b), vuzp2_u32(__a, __b)}}; }
__BUN_CC_INTRIN uint32x2_t vtrn1_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN uint32x2_t vtrn2_u32(uint32x2_t __a, uint32x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN uint32x2x2_t vtrn_u32(uint32x2_t __a, uint32x2_t __b) { return (uint32x2x2_t){{vtrn1_u32(__a, __b), vtrn2_u32(__a, __b)}}; }
#define vextq_u32(a, b, n) __builtin_shufflevector((uint32x4_t)(a), (uint32x4_t)(b), (n), (n) + 1, (n) + 2, (n) + 3)
__BUN_CC_INTRIN uint32x4_t vrev64q_u32(uint32x4_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2); }
__BUN_CC_INTRIN uint32x4_t vzip1q_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 1, 5); }
__BUN_CC_INTRIN uint32x4_t vzip2q_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_shufflevector(__a, __b, 2, 6, 3, 7); }
__BUN_CC_INTRIN uint32x4x2_t vzipq_u32(uint32x4_t __a, uint32x4_t __b) { return (uint32x4x2_t){{vzip1q_u32(__a, __b), vzip2q_u32(__a, __b)}}; }
__BUN_CC_INTRIN uint32x4_t vuzp1q_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6); }
__BUN_CC_INTRIN uint32x4_t vuzp2q_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN uint32x4x2_t vuzpq_u32(uint32x4_t __a, uint32x4_t __b) { return (uint32x4x2_t){{vuzp1q_u32(__a, __b), vuzp2q_u32(__a, __b)}}; }
__BUN_CC_INTRIN uint32x4_t vtrn1q_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 2, 6); }
__BUN_CC_INTRIN uint32x4_t vtrn2q_u32(uint32x4_t __a, uint32x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 5, 3, 7); }
__BUN_CC_INTRIN uint32x4x2_t vtrnq_u32(uint32x4_t __a, uint32x4_t __b) { return (uint32x4x2_t){{vtrn1q_u32(__a, __b), vtrn2q_u32(__a, __b)}}; }
#define vext_s64(a, b, n) __builtin_shufflevector((int64x1_t)(a), (int64x1_t)(b), (n))
#define vextq_s64(a, b, n) __builtin_shufflevector((int64x2_t)(a), (int64x2_t)(b), (n), (n) + 1)
__BUN_CC_INTRIN int64x2_t vzip1q_s64(int64x2_t __a, int64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN int64x2_t vzip2q_s64(int64x2_t __a, int64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN int64x2_t vuzp1q_s64(int64x2_t __a, int64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN int64x2_t vuzp2q_s64(int64x2_t __a, int64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN int64x2_t vtrn1q_s64(int64x2_t __a, int64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN int64x2_t vtrn2q_s64(int64x2_t __a, int64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
#define vext_u64(a, b, n) __builtin_shufflevector((uint64x1_t)(a), (uint64x1_t)(b), (n))
#define vextq_u64(a, b, n) __builtin_shufflevector((uint64x2_t)(a), (uint64x2_t)(b), (n), (n) + 1)
__BUN_CC_INTRIN uint64x2_t vzip1q_u64(uint64x2_t __a, uint64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN uint64x2_t vzip2q_u64(uint64x2_t __a, uint64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN uint64x2_t vuzp1q_u64(uint64x2_t __a, uint64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN uint64x2_t vuzp2q_u64(uint64x2_t __a, uint64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN uint64x2_t vtrn1q_u64(uint64x2_t __a, uint64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN uint64x2_t vtrn2q_u64(uint64x2_t __a, uint64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
#define vext_f32(a, b, n) __builtin_shufflevector((float32x2_t)(a), (float32x2_t)(b), (n), (n) + 1)
__BUN_CC_INTRIN float32x2_t vrev64_f32(float32x2_t __a) { return __builtin_shufflevector(__a, __a, 1, 0); }
__BUN_CC_INTRIN float32x2_t vzip1_f32(float32x2_t __a, float32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN float32x2_t vzip2_f32(float32x2_t __a, float32x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN float32x2x2_t vzip_f32(float32x2_t __a, float32x2_t __b) { return (float32x2x2_t){{vzip1_f32(__a, __b), vzip2_f32(__a, __b)}}; }
__BUN_CC_INTRIN float32x2_t vuzp1_f32(float32x2_t __a, float32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN float32x2_t vuzp2_f32(float32x2_t __a, float32x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN float32x2x2_t vuzp_f32(float32x2_t __a, float32x2_t __b) { return (float32x2x2_t){{vuzp1_f32(__a, __b), vuzp2_f32(__a, __b)}}; }
__BUN_CC_INTRIN float32x2_t vtrn1_f32(float32x2_t __a, float32x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN float32x2_t vtrn2_f32(float32x2_t __a, float32x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN float32x2x2_t vtrn_f32(float32x2_t __a, float32x2_t __b) { return (float32x2x2_t){{vtrn1_f32(__a, __b), vtrn2_f32(__a, __b)}}; }
#define vextq_f32(a, b, n) __builtin_shufflevector((float32x4_t)(a), (float32x4_t)(b), (n), (n) + 1, (n) + 2, (n) + 3)
__BUN_CC_INTRIN float32x4_t vrev64q_f32(float32x4_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2); }
__BUN_CC_INTRIN float32x4_t vzip1q_f32(float32x4_t __a, float32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 1, 5); }
__BUN_CC_INTRIN float32x4_t vzip2q_f32(float32x4_t __a, float32x4_t __b) { return __builtin_shufflevector(__a, __b, 2, 6, 3, 7); }
__BUN_CC_INTRIN float32x4x2_t vzipq_f32(float32x4_t __a, float32x4_t __b) { return (float32x4x2_t){{vzip1q_f32(__a, __b), vzip2q_f32(__a, __b)}}; }
__BUN_CC_INTRIN float32x4_t vuzp1q_f32(float32x4_t __a, float32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6); }
__BUN_CC_INTRIN float32x4_t vuzp2q_f32(float32x4_t __a, float32x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN float32x4x2_t vuzpq_f32(float32x4_t __a, float32x4_t __b) { return (float32x4x2_t){{vuzp1q_f32(__a, __b), vuzp2q_f32(__a, __b)}}; }
__BUN_CC_INTRIN float32x4_t vtrn1q_f32(float32x4_t __a, float32x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 2, 6); }
__BUN_CC_INTRIN float32x4_t vtrn2q_f32(float32x4_t __a, float32x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 5, 3, 7); }
__BUN_CC_INTRIN float32x4x2_t vtrnq_f32(float32x4_t __a, float32x4_t __b) { return (float32x4x2_t){{vtrn1q_f32(__a, __b), vtrn2q_f32(__a, __b)}}; }
#define vext_f64(a, b, n) __builtin_shufflevector((float64x1_t)(a), (float64x1_t)(b), (n))
#define vextq_f64(a, b, n) __builtin_shufflevector((float64x2_t)(a), (float64x2_t)(b), (n), (n) + 1)
__BUN_CC_INTRIN float64x2_t vzip1q_f64(float64x2_t __a, float64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN float64x2_t vzip2q_f64(float64x2_t __a, float64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN float64x2_t vuzp1q_f64(float64x2_t __a, float64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN float64x2_t vuzp2q_f64(float64x2_t __a, float64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN float64x2_t vtrn1q_f64(float64x2_t __a, float64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN float64x2_t vtrn2q_f64(float64x2_t __a, float64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
#define vext_p8(a, b, n) __builtin_shufflevector((poly8x8_t)(a), (poly8x8_t)(b), (n), (n) + 1, (n) + 2, (n) + 3, (n) + 4, (n) + 5, (n) + 6, (n) + 7)
__BUN_CC_INTRIN poly8x8_t vrev64_p8(poly8x8_t __a) { return __builtin_shufflevector(__a, __a, 7, 6, 5, 4, 3, 2, 1, 0); }
__BUN_CC_INTRIN poly8x8_t vrev32_p8(poly8x8_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0, 7, 6, 5, 4); }
__BUN_CC_INTRIN poly8x8_t vrev16_p8(poly8x8_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2, 5, 4, 7, 6); }
__BUN_CC_INTRIN poly8x8_t vzip1_p8(poly8x8_t __a, poly8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 1, 9, 2, 10, 3, 11); }
__BUN_CC_INTRIN poly8x8_t vzip2_p8(poly8x8_t __a, poly8x8_t __b) { return __builtin_shufflevector(__a, __b, 4, 12, 5, 13, 6, 14, 7, 15); }
__BUN_CC_INTRIN poly8x8x2_t vzip_p8(poly8x8_t __a, poly8x8_t __b) { return (poly8x8x2_t){{vzip1_p8(__a, __b), vzip2_p8(__a, __b)}}; }
__BUN_CC_INTRIN poly8x8_t vuzp1_p8(poly8x8_t __a, poly8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14); }
__BUN_CC_INTRIN poly8x8_t vuzp2_p8(poly8x8_t __a, poly8x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN poly8x8x2_t vuzp_p8(poly8x8_t __a, poly8x8_t __b) { return (poly8x8x2_t){{vuzp1_p8(__a, __b), vuzp2_p8(__a, __b)}}; }
__BUN_CC_INTRIN poly8x8_t vtrn1_p8(poly8x8_t __a, poly8x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 2, 10, 4, 12, 6, 14); }
__BUN_CC_INTRIN poly8x8_t vtrn2_p8(poly8x8_t __a, poly8x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 9, 3, 11, 5, 13, 7, 15); }
__BUN_CC_INTRIN poly8x8x2_t vtrn_p8(poly8x8_t __a, poly8x8_t __b) { return (poly8x8x2_t){{vtrn1_p8(__a, __b), vtrn2_p8(__a, __b)}}; }
#define vextq_p8(a, b, n) __builtin_shufflevector((poly8x16_t)(a), (poly8x16_t)(b), (n), (n) + 1, (n) + 2, (n) + 3, (n) + 4, (n) + 5, (n) + 6, (n) + 7, (n) + 8, (n) + 9, (n) + 10, (n) + 11, (n) + 12, (n) + 13, (n) + 14, (n) + 15)
__BUN_CC_INTRIN poly8x16_t vrev64q_p8(poly8x16_t __a) { return __builtin_shufflevector(__a, __a, 7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11, 10, 9, 8); }
__BUN_CC_INTRIN poly8x16_t vrev32q_p8(poly8x16_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12); }
__BUN_CC_INTRIN poly8x16_t vrev16q_p8(poly8x16_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15, 14); }
__BUN_CC_INTRIN poly8x16_t vzip1q_p8(poly8x16_t __a, poly8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 16, 1, 17, 2, 18, 3, 19, 4, 20, 5, 21, 6, 22, 7, 23); }
__BUN_CC_INTRIN poly8x16_t vzip2q_p8(poly8x16_t __a, poly8x16_t __b) { return __builtin_shufflevector(__a, __b, 8, 24, 9, 25, 10, 26, 11, 27, 12, 28, 13, 29, 14, 30, 15, 31); }
__BUN_CC_INTRIN poly8x16x2_t vzipq_p8(poly8x16_t __a, poly8x16_t __b) { return (poly8x16x2_t){{vzip1q_p8(__a, __b), vzip2q_p8(__a, __b)}}; }
__BUN_CC_INTRIN poly8x16_t vuzp1q_p8(poly8x16_t __a, poly8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30); }
__BUN_CC_INTRIN poly8x16_t vuzp2q_p8(poly8x16_t __a, poly8x16_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31); }
__BUN_CC_INTRIN poly8x16x2_t vuzpq_p8(poly8x16_t __a, poly8x16_t __b) { return (poly8x16x2_t){{vuzp1q_p8(__a, __b), vuzp2q_p8(__a, __b)}}; }
__BUN_CC_INTRIN poly8x16_t vtrn1q_p8(poly8x16_t __a, poly8x16_t __b) { return __builtin_shufflevector(__a, __b, 0, 16, 2, 18, 4, 20, 6, 22, 8, 24, 10, 26, 12, 28, 14, 30); }
__BUN_CC_INTRIN poly8x16_t vtrn2q_p8(poly8x16_t __a, poly8x16_t __b) { return __builtin_shufflevector(__a, __b, 1, 17, 3, 19, 5, 21, 7, 23, 9, 25, 11, 27, 13, 29, 15, 31); }
__BUN_CC_INTRIN poly8x16x2_t vtrnq_p8(poly8x16_t __a, poly8x16_t __b) { return (poly8x16x2_t){{vtrn1q_p8(__a, __b), vtrn2q_p8(__a, __b)}}; }
#define vext_p16(a, b, n) __builtin_shufflevector((poly16x4_t)(a), (poly16x4_t)(b), (n), (n) + 1, (n) + 2, (n) + 3)
__BUN_CC_INTRIN poly16x4_t vrev64_p16(poly16x4_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0); }
__BUN_CC_INTRIN poly16x4_t vrev32_p16(poly16x4_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2); }
__BUN_CC_INTRIN poly16x4_t vzip1_p16(poly16x4_t __a, poly16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 1, 5); }
__BUN_CC_INTRIN poly16x4_t vzip2_p16(poly16x4_t __a, poly16x4_t __b) { return __builtin_shufflevector(__a, __b, 2, 6, 3, 7); }
__BUN_CC_INTRIN poly16x4x2_t vzip_p16(poly16x4_t __a, poly16x4_t __b) { return (poly16x4x2_t){{vzip1_p16(__a, __b), vzip2_p16(__a, __b)}}; }
__BUN_CC_INTRIN poly16x4_t vuzp1_p16(poly16x4_t __a, poly16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6); }
__BUN_CC_INTRIN poly16x4_t vuzp2_p16(poly16x4_t __a, poly16x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7); }
__BUN_CC_INTRIN poly16x4x2_t vuzp_p16(poly16x4_t __a, poly16x4_t __b) { return (poly16x4x2_t){{vuzp1_p16(__a, __b), vuzp2_p16(__a, __b)}}; }
__BUN_CC_INTRIN poly16x4_t vtrn1_p16(poly16x4_t __a, poly16x4_t __b) { return __builtin_shufflevector(__a, __b, 0, 4, 2, 6); }
__BUN_CC_INTRIN poly16x4_t vtrn2_p16(poly16x4_t __a, poly16x4_t __b) { return __builtin_shufflevector(__a, __b, 1, 5, 3, 7); }
__BUN_CC_INTRIN poly16x4x2_t vtrn_p16(poly16x4_t __a, poly16x4_t __b) { return (poly16x4x2_t){{vtrn1_p16(__a, __b), vtrn2_p16(__a, __b)}}; }
#define vextq_p16(a, b, n) __builtin_shufflevector((poly16x8_t)(a), (poly16x8_t)(b), (n), (n) + 1, (n) + 2, (n) + 3, (n) + 4, (n) + 5, (n) + 6, (n) + 7)
__BUN_CC_INTRIN poly16x8_t vrev64q_p16(poly16x8_t __a) { return __builtin_shufflevector(__a, __a, 3, 2, 1, 0, 7, 6, 5, 4); }
__BUN_CC_INTRIN poly16x8_t vrev32q_p16(poly16x8_t __a) { return __builtin_shufflevector(__a, __a, 1, 0, 3, 2, 5, 4, 7, 6); }
__BUN_CC_INTRIN poly16x8_t vzip1q_p16(poly16x8_t __a, poly16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 1, 9, 2, 10, 3, 11); }
__BUN_CC_INTRIN poly16x8_t vzip2q_p16(poly16x8_t __a, poly16x8_t __b) { return __builtin_shufflevector(__a, __b, 4, 12, 5, 13, 6, 14, 7, 15); }
__BUN_CC_INTRIN poly16x8x2_t vzipq_p16(poly16x8_t __a, poly16x8_t __b) { return (poly16x8x2_t){{vzip1q_p16(__a, __b), vzip2q_p16(__a, __b)}}; }
__BUN_CC_INTRIN poly16x8_t vuzp1q_p16(poly16x8_t __a, poly16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 2, 4, 6, 8, 10, 12, 14); }
__BUN_CC_INTRIN poly16x8_t vuzp2q_p16(poly16x8_t __a, poly16x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 3, 5, 7, 9, 11, 13, 15); }
__BUN_CC_INTRIN poly16x8x2_t vuzpq_p16(poly16x8_t __a, poly16x8_t __b) { return (poly16x8x2_t){{vuzp1q_p16(__a, __b), vuzp2q_p16(__a, __b)}}; }
__BUN_CC_INTRIN poly16x8_t vtrn1q_p16(poly16x8_t __a, poly16x8_t __b) { return __builtin_shufflevector(__a, __b, 0, 8, 2, 10, 4, 12, 6, 14); }
__BUN_CC_INTRIN poly16x8_t vtrn2q_p16(poly16x8_t __a, poly16x8_t __b) { return __builtin_shufflevector(__a, __b, 1, 9, 3, 11, 5, 13, 7, 15); }
__BUN_CC_INTRIN poly16x8x2_t vtrnq_p16(poly16x8_t __a, poly16x8_t __b) { return (poly16x8x2_t){{vtrn1q_p16(__a, __b), vtrn2q_p16(__a, __b)}}; }
#define vext_p64(a, b, n) __builtin_shufflevector((poly64x1_t)(a), (poly64x1_t)(b), (n))
#define vextq_p64(a, b, n) __builtin_shufflevector((poly64x2_t)(a), (poly64x2_t)(b), (n), (n) + 1)
__BUN_CC_INTRIN poly64x2_t vzip1q_p64(poly64x2_t __a, poly64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN poly64x2_t vzip2q_p64(poly64x2_t __a, poly64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN poly64x2_t vuzp1q_p64(poly64x2_t __a, poly64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN poly64x2_t vuzp2q_p64(poly64x2_t __a, poly64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN poly64x2_t vtrn1q_p64(poly64x2_t __a, poly64x2_t __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN poly64x2_t vtrn2q_p64(poly64x2_t __a, poly64x2_t __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
__BUN_CC_INTRIN int8x8_t vtbl1_s8(int8x8_t __t, int8x8_t __i) { return (int8x8_t)__builtin_bir_swizzle((uint8x8_t)__t, (uint8x8_t)__i); }
__BUN_CC_INTRIN int8x8_t vtbl2_s8(int8x8x2_t __t, int8x8_t __i) { return (int8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)vcombine_s8(__t.val[0], __t.val[1]), vcombine_u8((uint8x8_t)__i, (uint8x8_t)__i))); }
__BUN_CC_INTRIN int8x8_t vqtbl1_s8(int8x16_t __t, uint8x8_t __i) { return (int8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t, vcombine_u8(__i, __i))); }
__BUN_CC_INTRIN int8x8_t vcnt_s8(int8x8_t __a) { uint8x8_t __v = (uint8x8_t)__a; __v = __v - ((__v >> 1) & 0x55); __v = (__v & 0x33) + ((__v >> 2) & 0x33); return (int8x8_t)((__v + (__v >> 4)) & 0x0f); }
__BUN_CC_INTRIN int8x16_t vcntq_s8(int8x16_t __a) { uint8x16_t __v = (uint8x16_t)__a; __v = __v - ((__v >> 1) & 0x55); __v = (__v & 0x33) + ((__v >> 2) & 0x33); return (int8x16_t)((__v + (__v >> 4)) & 0x0f); }
__BUN_CC_INTRIN uint8x8_t vtbl1_u8(uint8x8_t __t, uint8x8_t __i) { return (uint8x8_t)__builtin_bir_swizzle((uint8x8_t)__t, (uint8x8_t)__i); }
__BUN_CC_INTRIN uint8x8_t vtbl2_u8(uint8x8x2_t __t, uint8x8_t __i) { return (uint8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)vcombine_u8(__t.val[0], __t.val[1]), vcombine_u8((uint8x8_t)__i, (uint8x8_t)__i))); }
__BUN_CC_INTRIN uint8x8_t vqtbl1_u8(uint8x16_t __t, uint8x8_t __i) { return (uint8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t, vcombine_u8(__i, __i))); }
__BUN_CC_INTRIN uint8x8_t vcnt_u8(uint8x8_t __a) { uint8x8_t __v = (uint8x8_t)__a; __v = __v - ((__v >> 1) & 0x55); __v = (__v & 0x33) + ((__v >> 2) & 0x33); return (uint8x8_t)((__v + (__v >> 4)) & 0x0f); }
__BUN_CC_INTRIN uint8x16_t vcntq_u8(uint8x16_t __a) { uint8x16_t __v = (uint8x16_t)__a; __v = __v - ((__v >> 1) & 0x55); __v = (__v & 0x33) + ((__v >> 2) & 0x33); return (uint8x16_t)((__v + (__v >> 4)) & 0x0f); }
__BUN_CC_INTRIN poly8x8_t vtbl1_p8(poly8x8_t __t, uint8x8_t __i) { return (poly8x8_t)__builtin_bir_swizzle((uint8x8_t)__t, (uint8x8_t)__i); }
__BUN_CC_INTRIN poly8x8_t vtbl2_p8(poly8x8x2_t __t, uint8x8_t __i) { return (poly8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)vcombine_p8(__t.val[0], __t.val[1]), vcombine_u8((uint8x8_t)__i, (uint8x8_t)__i))); }
__BUN_CC_INTRIN poly8x8_t vqtbl1_p8(poly8x16_t __t, uint8x8_t __i) { return (poly8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t, vcombine_u8(__i, __i))); }
__BUN_CC_INTRIN poly8x16_t vqtbl1q_p8(poly8x16_t __t, uint8x16_t __i) { return (poly8x16_t)__builtin_bir_swizzle((uint8x16_t)__t, __i); }
__BUN_CC_INTRIN poly8x8_t vcnt_p8(poly8x8_t __a) { uint8x8_t __v = (uint8x8_t)__a; __v = __v - ((__v >> 1) & 0x55); __v = (__v & 0x33) + ((__v >> 2) & 0x33); return (poly8x8_t)((__v + (__v >> 4)) & 0x0f); }
__BUN_CC_INTRIN poly8x16_t vcntq_p8(poly8x16_t __a) { uint8x16_t __v = (uint8x16_t)__a; __v = __v - ((__v >> 1) & 0x55); __v = (__v & 0x33) + ((__v >> 2) & 0x33); return (poly8x16_t)((__v + (__v >> 4)) & 0x0f); }

/* Several vectors loaded and stored together, plainly and interleaved. */
__BUN_CC_INTRIN int8x8x2_t vld1_s8_x2(const int8_t *__p) { return (int8x8x2_t){{vld1_s8(__p + 0), vld1_s8(__p + 8)}}; }
__BUN_CC_INTRIN void vst1_s8_x2(int8_t *__p, int8x8x2_t __v) { vst1_s8(__p + 0, __v.val[0]); vst1_s8(__p + 8, __v.val[1]); }
__BUN_CC_INTRIN int8x8x3_t vld1_s8_x3(const int8_t *__p) { return (int8x8x3_t){{vld1_s8(__p + 0), vld1_s8(__p + 8), vld1_s8(__p + 16)}}; }
__BUN_CC_INTRIN void vst1_s8_x3(int8_t *__p, int8x8x3_t __v) { vst1_s8(__p + 0, __v.val[0]); vst1_s8(__p + 8, __v.val[1]); vst1_s8(__p + 16, __v.val[2]); }
__BUN_CC_INTRIN int8x8x4_t vld1_s8_x4(const int8_t *__p) { return (int8x8x4_t){{vld1_s8(__p + 0), vld1_s8(__p + 8), vld1_s8(__p + 16), vld1_s8(__p + 24)}}; }
__BUN_CC_INTRIN void vst1_s8_x4(int8_t *__p, int8x8x4_t __v) { vst1_s8(__p + 0, __v.val[0]); vst1_s8(__p + 8, __v.val[1]); vst1_s8(__p + 16, __v.val[2]); vst1_s8(__p + 24, __v.val[3]); }
__BUN_CC_INTRIN int8x8x2_t vld2_s8(const int8_t *__p) { int8x8_t __a = vld1_s8(__p), __b = vld1_s8(__p + 8); return (int8x8x2_t){{vuzp1_s8(__a, __b), vuzp2_s8(__a, __b)}}; }
__BUN_CC_INTRIN void vst2_s8(int8_t *__p, int8x8x2_t __v) { vst1_s8(__p, vzip1_s8(__v.val[0], __v.val[1])); vst1_s8(__p + 8, vzip2_s8(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN int8x8x4_t vld4_s8(const int8_t *__p) { int8x8_t __a = vld1_s8(__p), __b = vld1_s8(__p + 8), __c = vld1_s8(__p + 16), __d = vld1_s8(__p + 24); int8x8_t __e0 = vuzp1_s8(__a, __b), __o0 = vuzp2_s8(__a, __b), __e1 = vuzp1_s8(__c, __d), __o1 = vuzp2_s8(__c, __d); return (int8x8x4_t){{vuzp1_s8(__e0, __e1), vuzp1_s8(__o0, __o1), vuzp2_s8(__e0, __e1), vuzp2_s8(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4_s8(int8_t *__p, int8x8x4_t __v) { int8x8_t __l02 = vzip1_s8(__v.val[0], __v.val[2]), __h02 = vzip2_s8(__v.val[0], __v.val[2]), __l13 = vzip1_s8(__v.val[1], __v.val[3]), __h13 = vzip2_s8(__v.val[1], __v.val[3]); vst1_s8(__p, vzip1_s8(__l02, __l13)); vst1_s8(__p + 8, vzip2_s8(__l02, __l13)); vst1_s8(__p + 16, vzip1_s8(__h02, __h13)); vst1_s8(__p + 24, vzip2_s8(__h02, __h13)); }
__BUN_CC_INTRIN int8x16x2_t vld1q_s8_x2(const int8_t *__p) { return (int8x16x2_t){{vld1q_s8(__p + 0), vld1q_s8(__p + 16)}}; }
__BUN_CC_INTRIN void vst1q_s8_x2(int8_t *__p, int8x16x2_t __v) { vst1q_s8(__p + 0, __v.val[0]); vst1q_s8(__p + 16, __v.val[1]); }
__BUN_CC_INTRIN int8x16x3_t vld1q_s8_x3(const int8_t *__p) { return (int8x16x3_t){{vld1q_s8(__p + 0), vld1q_s8(__p + 16), vld1q_s8(__p + 32)}}; }
__BUN_CC_INTRIN void vst1q_s8_x3(int8_t *__p, int8x16x3_t __v) { vst1q_s8(__p + 0, __v.val[0]); vst1q_s8(__p + 16, __v.val[1]); vst1q_s8(__p + 32, __v.val[2]); }
__BUN_CC_INTRIN int8x16x4_t vld1q_s8_x4(const int8_t *__p) { return (int8x16x4_t){{vld1q_s8(__p + 0), vld1q_s8(__p + 16), vld1q_s8(__p + 32), vld1q_s8(__p + 48)}}; }
__BUN_CC_INTRIN void vst1q_s8_x4(int8_t *__p, int8x16x4_t __v) { vst1q_s8(__p + 0, __v.val[0]); vst1q_s8(__p + 16, __v.val[1]); vst1q_s8(__p + 32, __v.val[2]); vst1q_s8(__p + 48, __v.val[3]); }
__BUN_CC_INTRIN int8x16x2_t vld2q_s8(const int8_t *__p) { int8x16_t __a = vld1q_s8(__p), __b = vld1q_s8(__p + 16); return (int8x16x2_t){{vuzp1q_s8(__a, __b), vuzp2q_s8(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_s8(int8_t *__p, int8x16x2_t __v) { vst1q_s8(__p, vzip1q_s8(__v.val[0], __v.val[1])); vst1q_s8(__p + 16, vzip2q_s8(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN int8x16x4_t vld4q_s8(const int8_t *__p) { int8x16_t __a = vld1q_s8(__p), __b = vld1q_s8(__p + 16), __c = vld1q_s8(__p + 32), __d = vld1q_s8(__p + 48); int8x16_t __e0 = vuzp1q_s8(__a, __b), __o0 = vuzp2q_s8(__a, __b), __e1 = vuzp1q_s8(__c, __d), __o1 = vuzp2q_s8(__c, __d); return (int8x16x4_t){{vuzp1q_s8(__e0, __e1), vuzp1q_s8(__o0, __o1), vuzp2q_s8(__e0, __e1), vuzp2q_s8(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_s8(int8_t *__p, int8x16x4_t __v) { int8x16_t __l02 = vzip1q_s8(__v.val[0], __v.val[2]), __h02 = vzip2q_s8(__v.val[0], __v.val[2]), __l13 = vzip1q_s8(__v.val[1], __v.val[3]), __h13 = vzip2q_s8(__v.val[1], __v.val[3]); vst1q_s8(__p, vzip1q_s8(__l02, __l13)); vst1q_s8(__p + 16, vzip2q_s8(__l02, __l13)); vst1q_s8(__p + 32, vzip1q_s8(__h02, __h13)); vst1q_s8(__p + 48, vzip2q_s8(__h02, __h13)); }
__BUN_CC_INTRIN uint8x8x2_t vld1_u8_x2(const uint8_t *__p) { return (uint8x8x2_t){{vld1_u8(__p + 0), vld1_u8(__p + 8)}}; }
__BUN_CC_INTRIN void vst1_u8_x2(uint8_t *__p, uint8x8x2_t __v) { vst1_u8(__p + 0, __v.val[0]); vst1_u8(__p + 8, __v.val[1]); }
__BUN_CC_INTRIN uint8x8x3_t vld1_u8_x3(const uint8_t *__p) { return (uint8x8x3_t){{vld1_u8(__p + 0), vld1_u8(__p + 8), vld1_u8(__p + 16)}}; }
__BUN_CC_INTRIN void vst1_u8_x3(uint8_t *__p, uint8x8x3_t __v) { vst1_u8(__p + 0, __v.val[0]); vst1_u8(__p + 8, __v.val[1]); vst1_u8(__p + 16, __v.val[2]); }
__BUN_CC_INTRIN uint8x8x4_t vld1_u8_x4(const uint8_t *__p) { return (uint8x8x4_t){{vld1_u8(__p + 0), vld1_u8(__p + 8), vld1_u8(__p + 16), vld1_u8(__p + 24)}}; }
__BUN_CC_INTRIN void vst1_u8_x4(uint8_t *__p, uint8x8x4_t __v) { vst1_u8(__p + 0, __v.val[0]); vst1_u8(__p + 8, __v.val[1]); vst1_u8(__p + 16, __v.val[2]); vst1_u8(__p + 24, __v.val[3]); }
__BUN_CC_INTRIN uint8x8x2_t vld2_u8(const uint8_t *__p) { uint8x8_t __a = vld1_u8(__p), __b = vld1_u8(__p + 8); return (uint8x8x2_t){{vuzp1_u8(__a, __b), vuzp2_u8(__a, __b)}}; }
__BUN_CC_INTRIN void vst2_u8(uint8_t *__p, uint8x8x2_t __v) { vst1_u8(__p, vzip1_u8(__v.val[0], __v.val[1])); vst1_u8(__p + 8, vzip2_u8(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN uint8x8x4_t vld4_u8(const uint8_t *__p) { uint8x8_t __a = vld1_u8(__p), __b = vld1_u8(__p + 8), __c = vld1_u8(__p + 16), __d = vld1_u8(__p + 24); uint8x8_t __e0 = vuzp1_u8(__a, __b), __o0 = vuzp2_u8(__a, __b), __e1 = vuzp1_u8(__c, __d), __o1 = vuzp2_u8(__c, __d); return (uint8x8x4_t){{vuzp1_u8(__e0, __e1), vuzp1_u8(__o0, __o1), vuzp2_u8(__e0, __e1), vuzp2_u8(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4_u8(uint8_t *__p, uint8x8x4_t __v) { uint8x8_t __l02 = vzip1_u8(__v.val[0], __v.val[2]), __h02 = vzip2_u8(__v.val[0], __v.val[2]), __l13 = vzip1_u8(__v.val[1], __v.val[3]), __h13 = vzip2_u8(__v.val[1], __v.val[3]); vst1_u8(__p, vzip1_u8(__l02, __l13)); vst1_u8(__p + 8, vzip2_u8(__l02, __l13)); vst1_u8(__p + 16, vzip1_u8(__h02, __h13)); vst1_u8(__p + 24, vzip2_u8(__h02, __h13)); }
__BUN_CC_INTRIN uint8x16x2_t vld1q_u8_x2(const uint8_t *__p) { return (uint8x16x2_t){{vld1q_u8(__p + 0), vld1q_u8(__p + 16)}}; }
__BUN_CC_INTRIN void vst1q_u8_x2(uint8_t *__p, uint8x16x2_t __v) { vst1q_u8(__p + 0, __v.val[0]); vst1q_u8(__p + 16, __v.val[1]); }
__BUN_CC_INTRIN uint8x16x3_t vld1q_u8_x3(const uint8_t *__p) { return (uint8x16x3_t){{vld1q_u8(__p + 0), vld1q_u8(__p + 16), vld1q_u8(__p + 32)}}; }
__BUN_CC_INTRIN void vst1q_u8_x3(uint8_t *__p, uint8x16x3_t __v) { vst1q_u8(__p + 0, __v.val[0]); vst1q_u8(__p + 16, __v.val[1]); vst1q_u8(__p + 32, __v.val[2]); }
__BUN_CC_INTRIN uint8x16x4_t vld1q_u8_x4(const uint8_t *__p) { return (uint8x16x4_t){{vld1q_u8(__p + 0), vld1q_u8(__p + 16), vld1q_u8(__p + 32), vld1q_u8(__p + 48)}}; }
__BUN_CC_INTRIN void vst1q_u8_x4(uint8_t *__p, uint8x16x4_t __v) { vst1q_u8(__p + 0, __v.val[0]); vst1q_u8(__p + 16, __v.val[1]); vst1q_u8(__p + 32, __v.val[2]); vst1q_u8(__p + 48, __v.val[3]); }
__BUN_CC_INTRIN uint8x16x2_t vld2q_u8(const uint8_t *__p) { uint8x16_t __a = vld1q_u8(__p), __b = vld1q_u8(__p + 16); return (uint8x16x2_t){{vuzp1q_u8(__a, __b), vuzp2q_u8(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_u8(uint8_t *__p, uint8x16x2_t __v) { vst1q_u8(__p, vzip1q_u8(__v.val[0], __v.val[1])); vst1q_u8(__p + 16, vzip2q_u8(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN uint8x16x4_t vld4q_u8(const uint8_t *__p) { uint8x16_t __a = vld1q_u8(__p), __b = vld1q_u8(__p + 16), __c = vld1q_u8(__p + 32), __d = vld1q_u8(__p + 48); uint8x16_t __e0 = vuzp1q_u8(__a, __b), __o0 = vuzp2q_u8(__a, __b), __e1 = vuzp1q_u8(__c, __d), __o1 = vuzp2q_u8(__c, __d); return (uint8x16x4_t){{vuzp1q_u8(__e0, __e1), vuzp1q_u8(__o0, __o1), vuzp2q_u8(__e0, __e1), vuzp2q_u8(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_u8(uint8_t *__p, uint8x16x4_t __v) { uint8x16_t __l02 = vzip1q_u8(__v.val[0], __v.val[2]), __h02 = vzip2q_u8(__v.val[0], __v.val[2]), __l13 = vzip1q_u8(__v.val[1], __v.val[3]), __h13 = vzip2q_u8(__v.val[1], __v.val[3]); vst1q_u8(__p, vzip1q_u8(__l02, __l13)); vst1q_u8(__p + 16, vzip2q_u8(__l02, __l13)); vst1q_u8(__p + 32, vzip1q_u8(__h02, __h13)); vst1q_u8(__p + 48, vzip2q_u8(__h02, __h13)); }
__BUN_CC_INTRIN int16x4x2_t vld1_s16_x2(const int16_t *__p) { return (int16x4x2_t){{vld1_s16(__p + 0), vld1_s16(__p + 4)}}; }
__BUN_CC_INTRIN void vst1_s16_x2(int16_t *__p, int16x4x2_t __v) { vst1_s16(__p + 0, __v.val[0]); vst1_s16(__p + 4, __v.val[1]); }
__BUN_CC_INTRIN int16x4x3_t vld1_s16_x3(const int16_t *__p) { return (int16x4x3_t){{vld1_s16(__p + 0), vld1_s16(__p + 4), vld1_s16(__p + 8)}}; }
__BUN_CC_INTRIN void vst1_s16_x3(int16_t *__p, int16x4x3_t __v) { vst1_s16(__p + 0, __v.val[0]); vst1_s16(__p + 4, __v.val[1]); vst1_s16(__p + 8, __v.val[2]); }
__BUN_CC_INTRIN int16x4x4_t vld1_s16_x4(const int16_t *__p) { return (int16x4x4_t){{vld1_s16(__p + 0), vld1_s16(__p + 4), vld1_s16(__p + 8), vld1_s16(__p + 12)}}; }
__BUN_CC_INTRIN void vst1_s16_x4(int16_t *__p, int16x4x4_t __v) { vst1_s16(__p + 0, __v.val[0]); vst1_s16(__p + 4, __v.val[1]); vst1_s16(__p + 8, __v.val[2]); vst1_s16(__p + 12, __v.val[3]); }
__BUN_CC_INTRIN int16x4x2_t vld2_s16(const int16_t *__p) { int16x4_t __a = vld1_s16(__p), __b = vld1_s16(__p + 4); return (int16x4x2_t){{vuzp1_s16(__a, __b), vuzp2_s16(__a, __b)}}; }
__BUN_CC_INTRIN void vst2_s16(int16_t *__p, int16x4x2_t __v) { vst1_s16(__p, vzip1_s16(__v.val[0], __v.val[1])); vst1_s16(__p + 4, vzip2_s16(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN int16x4x4_t vld4_s16(const int16_t *__p) { int16x4_t __a = vld1_s16(__p), __b = vld1_s16(__p + 4), __c = vld1_s16(__p + 8), __d = vld1_s16(__p + 12); int16x4_t __e0 = vuzp1_s16(__a, __b), __o0 = vuzp2_s16(__a, __b), __e1 = vuzp1_s16(__c, __d), __o1 = vuzp2_s16(__c, __d); return (int16x4x4_t){{vuzp1_s16(__e0, __e1), vuzp1_s16(__o0, __o1), vuzp2_s16(__e0, __e1), vuzp2_s16(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4_s16(int16_t *__p, int16x4x4_t __v) { int16x4_t __l02 = vzip1_s16(__v.val[0], __v.val[2]), __h02 = vzip2_s16(__v.val[0], __v.val[2]), __l13 = vzip1_s16(__v.val[1], __v.val[3]), __h13 = vzip2_s16(__v.val[1], __v.val[3]); vst1_s16(__p, vzip1_s16(__l02, __l13)); vst1_s16(__p + 4, vzip2_s16(__l02, __l13)); vst1_s16(__p + 8, vzip1_s16(__h02, __h13)); vst1_s16(__p + 12, vzip2_s16(__h02, __h13)); }
__BUN_CC_INTRIN int16x8x2_t vld1q_s16_x2(const int16_t *__p) { return (int16x8x2_t){{vld1q_s16(__p + 0), vld1q_s16(__p + 8)}}; }
__BUN_CC_INTRIN void vst1q_s16_x2(int16_t *__p, int16x8x2_t __v) { vst1q_s16(__p + 0, __v.val[0]); vst1q_s16(__p + 8, __v.val[1]); }
__BUN_CC_INTRIN int16x8x3_t vld1q_s16_x3(const int16_t *__p) { return (int16x8x3_t){{vld1q_s16(__p + 0), vld1q_s16(__p + 8), vld1q_s16(__p + 16)}}; }
__BUN_CC_INTRIN void vst1q_s16_x3(int16_t *__p, int16x8x3_t __v) { vst1q_s16(__p + 0, __v.val[0]); vst1q_s16(__p + 8, __v.val[1]); vst1q_s16(__p + 16, __v.val[2]); }
__BUN_CC_INTRIN int16x8x4_t vld1q_s16_x4(const int16_t *__p) { return (int16x8x4_t){{vld1q_s16(__p + 0), vld1q_s16(__p + 8), vld1q_s16(__p + 16), vld1q_s16(__p + 24)}}; }
__BUN_CC_INTRIN void vst1q_s16_x4(int16_t *__p, int16x8x4_t __v) { vst1q_s16(__p + 0, __v.val[0]); vst1q_s16(__p + 8, __v.val[1]); vst1q_s16(__p + 16, __v.val[2]); vst1q_s16(__p + 24, __v.val[3]); }
__BUN_CC_INTRIN int16x8x2_t vld2q_s16(const int16_t *__p) { int16x8_t __a = vld1q_s16(__p), __b = vld1q_s16(__p + 8); return (int16x8x2_t){{vuzp1q_s16(__a, __b), vuzp2q_s16(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_s16(int16_t *__p, int16x8x2_t __v) { vst1q_s16(__p, vzip1q_s16(__v.val[0], __v.val[1])); vst1q_s16(__p + 8, vzip2q_s16(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN int16x8x4_t vld4q_s16(const int16_t *__p) { int16x8_t __a = vld1q_s16(__p), __b = vld1q_s16(__p + 8), __c = vld1q_s16(__p + 16), __d = vld1q_s16(__p + 24); int16x8_t __e0 = vuzp1q_s16(__a, __b), __o0 = vuzp2q_s16(__a, __b), __e1 = vuzp1q_s16(__c, __d), __o1 = vuzp2q_s16(__c, __d); return (int16x8x4_t){{vuzp1q_s16(__e0, __e1), vuzp1q_s16(__o0, __o1), vuzp2q_s16(__e0, __e1), vuzp2q_s16(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_s16(int16_t *__p, int16x8x4_t __v) { int16x8_t __l02 = vzip1q_s16(__v.val[0], __v.val[2]), __h02 = vzip2q_s16(__v.val[0], __v.val[2]), __l13 = vzip1q_s16(__v.val[1], __v.val[3]), __h13 = vzip2q_s16(__v.val[1], __v.val[3]); vst1q_s16(__p, vzip1q_s16(__l02, __l13)); vst1q_s16(__p + 8, vzip2q_s16(__l02, __l13)); vst1q_s16(__p + 16, vzip1q_s16(__h02, __h13)); vst1q_s16(__p + 24, vzip2q_s16(__h02, __h13)); }
__BUN_CC_INTRIN uint16x4x2_t vld1_u16_x2(const uint16_t *__p) { return (uint16x4x2_t){{vld1_u16(__p + 0), vld1_u16(__p + 4)}}; }
__BUN_CC_INTRIN void vst1_u16_x2(uint16_t *__p, uint16x4x2_t __v) { vst1_u16(__p + 0, __v.val[0]); vst1_u16(__p + 4, __v.val[1]); }
__BUN_CC_INTRIN uint16x4x3_t vld1_u16_x3(const uint16_t *__p) { return (uint16x4x3_t){{vld1_u16(__p + 0), vld1_u16(__p + 4), vld1_u16(__p + 8)}}; }
__BUN_CC_INTRIN void vst1_u16_x3(uint16_t *__p, uint16x4x3_t __v) { vst1_u16(__p + 0, __v.val[0]); vst1_u16(__p + 4, __v.val[1]); vst1_u16(__p + 8, __v.val[2]); }
__BUN_CC_INTRIN uint16x4x4_t vld1_u16_x4(const uint16_t *__p) { return (uint16x4x4_t){{vld1_u16(__p + 0), vld1_u16(__p + 4), vld1_u16(__p + 8), vld1_u16(__p + 12)}}; }
__BUN_CC_INTRIN void vst1_u16_x4(uint16_t *__p, uint16x4x4_t __v) { vst1_u16(__p + 0, __v.val[0]); vst1_u16(__p + 4, __v.val[1]); vst1_u16(__p + 8, __v.val[2]); vst1_u16(__p + 12, __v.val[3]); }
__BUN_CC_INTRIN uint16x4x2_t vld2_u16(const uint16_t *__p) { uint16x4_t __a = vld1_u16(__p), __b = vld1_u16(__p + 4); return (uint16x4x2_t){{vuzp1_u16(__a, __b), vuzp2_u16(__a, __b)}}; }
__BUN_CC_INTRIN void vst2_u16(uint16_t *__p, uint16x4x2_t __v) { vst1_u16(__p, vzip1_u16(__v.val[0], __v.val[1])); vst1_u16(__p + 4, vzip2_u16(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN uint16x4x4_t vld4_u16(const uint16_t *__p) { uint16x4_t __a = vld1_u16(__p), __b = vld1_u16(__p + 4), __c = vld1_u16(__p + 8), __d = vld1_u16(__p + 12); uint16x4_t __e0 = vuzp1_u16(__a, __b), __o0 = vuzp2_u16(__a, __b), __e1 = vuzp1_u16(__c, __d), __o1 = vuzp2_u16(__c, __d); return (uint16x4x4_t){{vuzp1_u16(__e0, __e1), vuzp1_u16(__o0, __o1), vuzp2_u16(__e0, __e1), vuzp2_u16(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4_u16(uint16_t *__p, uint16x4x4_t __v) { uint16x4_t __l02 = vzip1_u16(__v.val[0], __v.val[2]), __h02 = vzip2_u16(__v.val[0], __v.val[2]), __l13 = vzip1_u16(__v.val[1], __v.val[3]), __h13 = vzip2_u16(__v.val[1], __v.val[3]); vst1_u16(__p, vzip1_u16(__l02, __l13)); vst1_u16(__p + 4, vzip2_u16(__l02, __l13)); vst1_u16(__p + 8, vzip1_u16(__h02, __h13)); vst1_u16(__p + 12, vzip2_u16(__h02, __h13)); }
__BUN_CC_INTRIN uint16x8x2_t vld1q_u16_x2(const uint16_t *__p) { return (uint16x8x2_t){{vld1q_u16(__p + 0), vld1q_u16(__p + 8)}}; }
__BUN_CC_INTRIN void vst1q_u16_x2(uint16_t *__p, uint16x8x2_t __v) { vst1q_u16(__p + 0, __v.val[0]); vst1q_u16(__p + 8, __v.val[1]); }
__BUN_CC_INTRIN uint16x8x3_t vld1q_u16_x3(const uint16_t *__p) { return (uint16x8x3_t){{vld1q_u16(__p + 0), vld1q_u16(__p + 8), vld1q_u16(__p + 16)}}; }
__BUN_CC_INTRIN void vst1q_u16_x3(uint16_t *__p, uint16x8x3_t __v) { vst1q_u16(__p + 0, __v.val[0]); vst1q_u16(__p + 8, __v.val[1]); vst1q_u16(__p + 16, __v.val[2]); }
__BUN_CC_INTRIN uint16x8x4_t vld1q_u16_x4(const uint16_t *__p) { return (uint16x8x4_t){{vld1q_u16(__p + 0), vld1q_u16(__p + 8), vld1q_u16(__p + 16), vld1q_u16(__p + 24)}}; }
__BUN_CC_INTRIN void vst1q_u16_x4(uint16_t *__p, uint16x8x4_t __v) { vst1q_u16(__p + 0, __v.val[0]); vst1q_u16(__p + 8, __v.val[1]); vst1q_u16(__p + 16, __v.val[2]); vst1q_u16(__p + 24, __v.val[3]); }
__BUN_CC_INTRIN uint16x8x2_t vld2q_u16(const uint16_t *__p) { uint16x8_t __a = vld1q_u16(__p), __b = vld1q_u16(__p + 8); return (uint16x8x2_t){{vuzp1q_u16(__a, __b), vuzp2q_u16(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_u16(uint16_t *__p, uint16x8x2_t __v) { vst1q_u16(__p, vzip1q_u16(__v.val[0], __v.val[1])); vst1q_u16(__p + 8, vzip2q_u16(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN uint16x8x4_t vld4q_u16(const uint16_t *__p) { uint16x8_t __a = vld1q_u16(__p), __b = vld1q_u16(__p + 8), __c = vld1q_u16(__p + 16), __d = vld1q_u16(__p + 24); uint16x8_t __e0 = vuzp1q_u16(__a, __b), __o0 = vuzp2q_u16(__a, __b), __e1 = vuzp1q_u16(__c, __d), __o1 = vuzp2q_u16(__c, __d); return (uint16x8x4_t){{vuzp1q_u16(__e0, __e1), vuzp1q_u16(__o0, __o1), vuzp2q_u16(__e0, __e1), vuzp2q_u16(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_u16(uint16_t *__p, uint16x8x4_t __v) { uint16x8_t __l02 = vzip1q_u16(__v.val[0], __v.val[2]), __h02 = vzip2q_u16(__v.val[0], __v.val[2]), __l13 = vzip1q_u16(__v.val[1], __v.val[3]), __h13 = vzip2q_u16(__v.val[1], __v.val[3]); vst1q_u16(__p, vzip1q_u16(__l02, __l13)); vst1q_u16(__p + 8, vzip2q_u16(__l02, __l13)); vst1q_u16(__p + 16, vzip1q_u16(__h02, __h13)); vst1q_u16(__p + 24, vzip2q_u16(__h02, __h13)); }
__BUN_CC_INTRIN int32x2x2_t vld1_s32_x2(const int32_t *__p) { return (int32x2x2_t){{vld1_s32(__p + 0), vld1_s32(__p + 2)}}; }
__BUN_CC_INTRIN void vst1_s32_x2(int32_t *__p, int32x2x2_t __v) { vst1_s32(__p + 0, __v.val[0]); vst1_s32(__p + 2, __v.val[1]); }
__BUN_CC_INTRIN int32x2x3_t vld1_s32_x3(const int32_t *__p) { return (int32x2x3_t){{vld1_s32(__p + 0), vld1_s32(__p + 2), vld1_s32(__p + 4)}}; }
__BUN_CC_INTRIN void vst1_s32_x3(int32_t *__p, int32x2x3_t __v) { vst1_s32(__p + 0, __v.val[0]); vst1_s32(__p + 2, __v.val[1]); vst1_s32(__p + 4, __v.val[2]); }
__BUN_CC_INTRIN int32x2x4_t vld1_s32_x4(const int32_t *__p) { return (int32x2x4_t){{vld1_s32(__p + 0), vld1_s32(__p + 2), vld1_s32(__p + 4), vld1_s32(__p + 6)}}; }
__BUN_CC_INTRIN void vst1_s32_x4(int32_t *__p, int32x2x4_t __v) { vst1_s32(__p + 0, __v.val[0]); vst1_s32(__p + 2, __v.val[1]); vst1_s32(__p + 4, __v.val[2]); vst1_s32(__p + 6, __v.val[3]); }
__BUN_CC_INTRIN int32x2x2_t vld2_s32(const int32_t *__p) { int32x2_t __a = vld1_s32(__p), __b = vld1_s32(__p + 2); return (int32x2x2_t){{vuzp1_s32(__a, __b), vuzp2_s32(__a, __b)}}; }
__BUN_CC_INTRIN void vst2_s32(int32_t *__p, int32x2x2_t __v) { vst1_s32(__p, vzip1_s32(__v.val[0], __v.val[1])); vst1_s32(__p + 2, vzip2_s32(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN int32x2x4_t vld4_s32(const int32_t *__p) { int32x2_t __a = vld1_s32(__p), __b = vld1_s32(__p + 2), __c = vld1_s32(__p + 4), __d = vld1_s32(__p + 6); int32x2_t __e0 = vuzp1_s32(__a, __b), __o0 = vuzp2_s32(__a, __b), __e1 = vuzp1_s32(__c, __d), __o1 = vuzp2_s32(__c, __d); return (int32x2x4_t){{vuzp1_s32(__e0, __e1), vuzp1_s32(__o0, __o1), vuzp2_s32(__e0, __e1), vuzp2_s32(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4_s32(int32_t *__p, int32x2x4_t __v) { int32x2_t __l02 = vzip1_s32(__v.val[0], __v.val[2]), __h02 = vzip2_s32(__v.val[0], __v.val[2]), __l13 = vzip1_s32(__v.val[1], __v.val[3]), __h13 = vzip2_s32(__v.val[1], __v.val[3]); vst1_s32(__p, vzip1_s32(__l02, __l13)); vst1_s32(__p + 2, vzip2_s32(__l02, __l13)); vst1_s32(__p + 4, vzip1_s32(__h02, __h13)); vst1_s32(__p + 6, vzip2_s32(__h02, __h13)); }
__BUN_CC_INTRIN int32x4x2_t vld1q_s32_x2(const int32_t *__p) { return (int32x4x2_t){{vld1q_s32(__p + 0), vld1q_s32(__p + 4)}}; }
__BUN_CC_INTRIN void vst1q_s32_x2(int32_t *__p, int32x4x2_t __v) { vst1q_s32(__p + 0, __v.val[0]); vst1q_s32(__p + 4, __v.val[1]); }
__BUN_CC_INTRIN int32x4x3_t vld1q_s32_x3(const int32_t *__p) { return (int32x4x3_t){{vld1q_s32(__p + 0), vld1q_s32(__p + 4), vld1q_s32(__p + 8)}}; }
__BUN_CC_INTRIN void vst1q_s32_x3(int32_t *__p, int32x4x3_t __v) { vst1q_s32(__p + 0, __v.val[0]); vst1q_s32(__p + 4, __v.val[1]); vst1q_s32(__p + 8, __v.val[2]); }
__BUN_CC_INTRIN int32x4x4_t vld1q_s32_x4(const int32_t *__p) { return (int32x4x4_t){{vld1q_s32(__p + 0), vld1q_s32(__p + 4), vld1q_s32(__p + 8), vld1q_s32(__p + 12)}}; }
__BUN_CC_INTRIN void vst1q_s32_x4(int32_t *__p, int32x4x4_t __v) { vst1q_s32(__p + 0, __v.val[0]); vst1q_s32(__p + 4, __v.val[1]); vst1q_s32(__p + 8, __v.val[2]); vst1q_s32(__p + 12, __v.val[3]); }
__BUN_CC_INTRIN int32x4x2_t vld2q_s32(const int32_t *__p) { int32x4_t __a = vld1q_s32(__p), __b = vld1q_s32(__p + 4); return (int32x4x2_t){{vuzp1q_s32(__a, __b), vuzp2q_s32(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_s32(int32_t *__p, int32x4x2_t __v) { vst1q_s32(__p, vzip1q_s32(__v.val[0], __v.val[1])); vst1q_s32(__p + 4, vzip2q_s32(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN int32x4x4_t vld4q_s32(const int32_t *__p) { int32x4_t __a = vld1q_s32(__p), __b = vld1q_s32(__p + 4), __c = vld1q_s32(__p + 8), __d = vld1q_s32(__p + 12); int32x4_t __e0 = vuzp1q_s32(__a, __b), __o0 = vuzp2q_s32(__a, __b), __e1 = vuzp1q_s32(__c, __d), __o1 = vuzp2q_s32(__c, __d); return (int32x4x4_t){{vuzp1q_s32(__e0, __e1), vuzp1q_s32(__o0, __o1), vuzp2q_s32(__e0, __e1), vuzp2q_s32(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_s32(int32_t *__p, int32x4x4_t __v) { int32x4_t __l02 = vzip1q_s32(__v.val[0], __v.val[2]), __h02 = vzip2q_s32(__v.val[0], __v.val[2]), __l13 = vzip1q_s32(__v.val[1], __v.val[3]), __h13 = vzip2q_s32(__v.val[1], __v.val[3]); vst1q_s32(__p, vzip1q_s32(__l02, __l13)); vst1q_s32(__p + 4, vzip2q_s32(__l02, __l13)); vst1q_s32(__p + 8, vzip1q_s32(__h02, __h13)); vst1q_s32(__p + 12, vzip2q_s32(__h02, __h13)); }
__BUN_CC_INTRIN uint32x2x2_t vld1_u32_x2(const uint32_t *__p) { return (uint32x2x2_t){{vld1_u32(__p + 0), vld1_u32(__p + 2)}}; }
__BUN_CC_INTRIN void vst1_u32_x2(uint32_t *__p, uint32x2x2_t __v) { vst1_u32(__p + 0, __v.val[0]); vst1_u32(__p + 2, __v.val[1]); }
__BUN_CC_INTRIN uint32x2x3_t vld1_u32_x3(const uint32_t *__p) { return (uint32x2x3_t){{vld1_u32(__p + 0), vld1_u32(__p + 2), vld1_u32(__p + 4)}}; }
__BUN_CC_INTRIN void vst1_u32_x3(uint32_t *__p, uint32x2x3_t __v) { vst1_u32(__p + 0, __v.val[0]); vst1_u32(__p + 2, __v.val[1]); vst1_u32(__p + 4, __v.val[2]); }
__BUN_CC_INTRIN uint32x2x4_t vld1_u32_x4(const uint32_t *__p) { return (uint32x2x4_t){{vld1_u32(__p + 0), vld1_u32(__p + 2), vld1_u32(__p + 4), vld1_u32(__p + 6)}}; }
__BUN_CC_INTRIN void vst1_u32_x4(uint32_t *__p, uint32x2x4_t __v) { vst1_u32(__p + 0, __v.val[0]); vst1_u32(__p + 2, __v.val[1]); vst1_u32(__p + 4, __v.val[2]); vst1_u32(__p + 6, __v.val[3]); }
__BUN_CC_INTRIN uint32x2x2_t vld2_u32(const uint32_t *__p) { uint32x2_t __a = vld1_u32(__p), __b = vld1_u32(__p + 2); return (uint32x2x2_t){{vuzp1_u32(__a, __b), vuzp2_u32(__a, __b)}}; }
__BUN_CC_INTRIN void vst2_u32(uint32_t *__p, uint32x2x2_t __v) { vst1_u32(__p, vzip1_u32(__v.val[0], __v.val[1])); vst1_u32(__p + 2, vzip2_u32(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN uint32x2x4_t vld4_u32(const uint32_t *__p) { uint32x2_t __a = vld1_u32(__p), __b = vld1_u32(__p + 2), __c = vld1_u32(__p + 4), __d = vld1_u32(__p + 6); uint32x2_t __e0 = vuzp1_u32(__a, __b), __o0 = vuzp2_u32(__a, __b), __e1 = vuzp1_u32(__c, __d), __o1 = vuzp2_u32(__c, __d); return (uint32x2x4_t){{vuzp1_u32(__e0, __e1), vuzp1_u32(__o0, __o1), vuzp2_u32(__e0, __e1), vuzp2_u32(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4_u32(uint32_t *__p, uint32x2x4_t __v) { uint32x2_t __l02 = vzip1_u32(__v.val[0], __v.val[2]), __h02 = vzip2_u32(__v.val[0], __v.val[2]), __l13 = vzip1_u32(__v.val[1], __v.val[3]), __h13 = vzip2_u32(__v.val[1], __v.val[3]); vst1_u32(__p, vzip1_u32(__l02, __l13)); vst1_u32(__p + 2, vzip2_u32(__l02, __l13)); vst1_u32(__p + 4, vzip1_u32(__h02, __h13)); vst1_u32(__p + 6, vzip2_u32(__h02, __h13)); }
__BUN_CC_INTRIN uint32x4x2_t vld1q_u32_x2(const uint32_t *__p) { return (uint32x4x2_t){{vld1q_u32(__p + 0), vld1q_u32(__p + 4)}}; }
__BUN_CC_INTRIN void vst1q_u32_x2(uint32_t *__p, uint32x4x2_t __v) { vst1q_u32(__p + 0, __v.val[0]); vst1q_u32(__p + 4, __v.val[1]); }
__BUN_CC_INTRIN uint32x4x3_t vld1q_u32_x3(const uint32_t *__p) { return (uint32x4x3_t){{vld1q_u32(__p + 0), vld1q_u32(__p + 4), vld1q_u32(__p + 8)}}; }
__BUN_CC_INTRIN void vst1q_u32_x3(uint32_t *__p, uint32x4x3_t __v) { vst1q_u32(__p + 0, __v.val[0]); vst1q_u32(__p + 4, __v.val[1]); vst1q_u32(__p + 8, __v.val[2]); }
__BUN_CC_INTRIN uint32x4x4_t vld1q_u32_x4(const uint32_t *__p) { return (uint32x4x4_t){{vld1q_u32(__p + 0), vld1q_u32(__p + 4), vld1q_u32(__p + 8), vld1q_u32(__p + 12)}}; }
__BUN_CC_INTRIN void vst1q_u32_x4(uint32_t *__p, uint32x4x4_t __v) { vst1q_u32(__p + 0, __v.val[0]); vst1q_u32(__p + 4, __v.val[1]); vst1q_u32(__p + 8, __v.val[2]); vst1q_u32(__p + 12, __v.val[3]); }
__BUN_CC_INTRIN uint32x4x2_t vld2q_u32(const uint32_t *__p) { uint32x4_t __a = vld1q_u32(__p), __b = vld1q_u32(__p + 4); return (uint32x4x2_t){{vuzp1q_u32(__a, __b), vuzp2q_u32(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_u32(uint32_t *__p, uint32x4x2_t __v) { vst1q_u32(__p, vzip1q_u32(__v.val[0], __v.val[1])); vst1q_u32(__p + 4, vzip2q_u32(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN uint32x4x4_t vld4q_u32(const uint32_t *__p) { uint32x4_t __a = vld1q_u32(__p), __b = vld1q_u32(__p + 4), __c = vld1q_u32(__p + 8), __d = vld1q_u32(__p + 12); uint32x4_t __e0 = vuzp1q_u32(__a, __b), __o0 = vuzp2q_u32(__a, __b), __e1 = vuzp1q_u32(__c, __d), __o1 = vuzp2q_u32(__c, __d); return (uint32x4x4_t){{vuzp1q_u32(__e0, __e1), vuzp1q_u32(__o0, __o1), vuzp2q_u32(__e0, __e1), vuzp2q_u32(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_u32(uint32_t *__p, uint32x4x4_t __v) { uint32x4_t __l02 = vzip1q_u32(__v.val[0], __v.val[2]), __h02 = vzip2q_u32(__v.val[0], __v.val[2]), __l13 = vzip1q_u32(__v.val[1], __v.val[3]), __h13 = vzip2q_u32(__v.val[1], __v.val[3]); vst1q_u32(__p, vzip1q_u32(__l02, __l13)); vst1q_u32(__p + 4, vzip2q_u32(__l02, __l13)); vst1q_u32(__p + 8, vzip1q_u32(__h02, __h13)); vst1q_u32(__p + 12, vzip2q_u32(__h02, __h13)); }
__BUN_CC_INTRIN int64x1x2_t vld1_s64_x2(const int64_t *__p) { return (int64x1x2_t){{vld1_s64(__p + 0), vld1_s64(__p + 1)}}; }
__BUN_CC_INTRIN void vst1_s64_x2(int64_t *__p, int64x1x2_t __v) { vst1_s64(__p + 0, __v.val[0]); vst1_s64(__p + 1, __v.val[1]); }
__BUN_CC_INTRIN int64x1x3_t vld1_s64_x3(const int64_t *__p) { return (int64x1x3_t){{vld1_s64(__p + 0), vld1_s64(__p + 1), vld1_s64(__p + 2)}}; }
__BUN_CC_INTRIN void vst1_s64_x3(int64_t *__p, int64x1x3_t __v) { vst1_s64(__p + 0, __v.val[0]); vst1_s64(__p + 1, __v.val[1]); vst1_s64(__p + 2, __v.val[2]); }
__BUN_CC_INTRIN int64x1x4_t vld1_s64_x4(const int64_t *__p) { return (int64x1x4_t){{vld1_s64(__p + 0), vld1_s64(__p + 1), vld1_s64(__p + 2), vld1_s64(__p + 3)}}; }
__BUN_CC_INTRIN void vst1_s64_x4(int64_t *__p, int64x1x4_t __v) { vst1_s64(__p + 0, __v.val[0]); vst1_s64(__p + 1, __v.val[1]); vst1_s64(__p + 2, __v.val[2]); vst1_s64(__p + 3, __v.val[3]); }
__BUN_CC_INTRIN int64x1x2_t vld2_s64(const int64_t *__p) { return vld1_s64_x2(__p); }
__BUN_CC_INTRIN void vst2_s64(int64_t *__p, int64x1x2_t __v) { vst1_s64_x2(__p, __v); }
__BUN_CC_INTRIN int64x1x3_t vld3_s64(const int64_t *__p) { return vld1_s64_x3(__p); }
__BUN_CC_INTRIN void vst3_s64(int64_t *__p, int64x1x3_t __v) { vst1_s64_x3(__p, __v); }
__BUN_CC_INTRIN int64x1x4_t vld4_s64(const int64_t *__p) { return vld1_s64_x4(__p); }
__BUN_CC_INTRIN void vst4_s64(int64_t *__p, int64x1x4_t __v) { vst1_s64_x4(__p, __v); }
__BUN_CC_INTRIN int64x2x2_t vld1q_s64_x2(const int64_t *__p) { return (int64x2x2_t){{vld1q_s64(__p + 0), vld1q_s64(__p + 2)}}; }
__BUN_CC_INTRIN void vst1q_s64_x2(int64_t *__p, int64x2x2_t __v) { vst1q_s64(__p + 0, __v.val[0]); vst1q_s64(__p + 2, __v.val[1]); }
__BUN_CC_INTRIN int64x2x3_t vld1q_s64_x3(const int64_t *__p) { return (int64x2x3_t){{vld1q_s64(__p + 0), vld1q_s64(__p + 2), vld1q_s64(__p + 4)}}; }
__BUN_CC_INTRIN void vst1q_s64_x3(int64_t *__p, int64x2x3_t __v) { vst1q_s64(__p + 0, __v.val[0]); vst1q_s64(__p + 2, __v.val[1]); vst1q_s64(__p + 4, __v.val[2]); }
__BUN_CC_INTRIN int64x2x4_t vld1q_s64_x4(const int64_t *__p) { return (int64x2x4_t){{vld1q_s64(__p + 0), vld1q_s64(__p + 2), vld1q_s64(__p + 4), vld1q_s64(__p + 6)}}; }
__BUN_CC_INTRIN void vst1q_s64_x4(int64_t *__p, int64x2x4_t __v) { vst1q_s64(__p + 0, __v.val[0]); vst1q_s64(__p + 2, __v.val[1]); vst1q_s64(__p + 4, __v.val[2]); vst1q_s64(__p + 6, __v.val[3]); }
__BUN_CC_INTRIN int64x2x2_t vld2q_s64(const int64_t *__p) { int64x2_t __a = vld1q_s64(__p), __b = vld1q_s64(__p + 2); return (int64x2x2_t){{vuzp1q_s64(__a, __b), vuzp2q_s64(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_s64(int64_t *__p, int64x2x2_t __v) { vst1q_s64(__p, vzip1q_s64(__v.val[0], __v.val[1])); vst1q_s64(__p + 2, vzip2q_s64(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN int64x2x4_t vld4q_s64(const int64_t *__p) { int64x2_t __a = vld1q_s64(__p), __b = vld1q_s64(__p + 2), __c = vld1q_s64(__p + 4), __d = vld1q_s64(__p + 6); int64x2_t __e0 = vuzp1q_s64(__a, __b), __o0 = vuzp2q_s64(__a, __b), __e1 = vuzp1q_s64(__c, __d), __o1 = vuzp2q_s64(__c, __d); return (int64x2x4_t){{vuzp1q_s64(__e0, __e1), vuzp1q_s64(__o0, __o1), vuzp2q_s64(__e0, __e1), vuzp2q_s64(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_s64(int64_t *__p, int64x2x4_t __v) { int64x2_t __l02 = vzip1q_s64(__v.val[0], __v.val[2]), __h02 = vzip2q_s64(__v.val[0], __v.val[2]), __l13 = vzip1q_s64(__v.val[1], __v.val[3]), __h13 = vzip2q_s64(__v.val[1], __v.val[3]); vst1q_s64(__p, vzip1q_s64(__l02, __l13)); vst1q_s64(__p + 2, vzip2q_s64(__l02, __l13)); vst1q_s64(__p + 4, vzip1q_s64(__h02, __h13)); vst1q_s64(__p + 6, vzip2q_s64(__h02, __h13)); }
__BUN_CC_INTRIN uint64x1x2_t vld1_u64_x2(const uint64_t *__p) { return (uint64x1x2_t){{vld1_u64(__p + 0), vld1_u64(__p + 1)}}; }
__BUN_CC_INTRIN void vst1_u64_x2(uint64_t *__p, uint64x1x2_t __v) { vst1_u64(__p + 0, __v.val[0]); vst1_u64(__p + 1, __v.val[1]); }
__BUN_CC_INTRIN uint64x1x3_t vld1_u64_x3(const uint64_t *__p) { return (uint64x1x3_t){{vld1_u64(__p + 0), vld1_u64(__p + 1), vld1_u64(__p + 2)}}; }
__BUN_CC_INTRIN void vst1_u64_x3(uint64_t *__p, uint64x1x3_t __v) { vst1_u64(__p + 0, __v.val[0]); vst1_u64(__p + 1, __v.val[1]); vst1_u64(__p + 2, __v.val[2]); }
__BUN_CC_INTRIN uint64x1x4_t vld1_u64_x4(const uint64_t *__p) { return (uint64x1x4_t){{vld1_u64(__p + 0), vld1_u64(__p + 1), vld1_u64(__p + 2), vld1_u64(__p + 3)}}; }
__BUN_CC_INTRIN void vst1_u64_x4(uint64_t *__p, uint64x1x4_t __v) { vst1_u64(__p + 0, __v.val[0]); vst1_u64(__p + 1, __v.val[1]); vst1_u64(__p + 2, __v.val[2]); vst1_u64(__p + 3, __v.val[3]); }
__BUN_CC_INTRIN uint64x1x2_t vld2_u64(const uint64_t *__p) { return vld1_u64_x2(__p); }
__BUN_CC_INTRIN void vst2_u64(uint64_t *__p, uint64x1x2_t __v) { vst1_u64_x2(__p, __v); }
__BUN_CC_INTRIN uint64x1x3_t vld3_u64(const uint64_t *__p) { return vld1_u64_x3(__p); }
__BUN_CC_INTRIN void vst3_u64(uint64_t *__p, uint64x1x3_t __v) { vst1_u64_x3(__p, __v); }
__BUN_CC_INTRIN uint64x1x4_t vld4_u64(const uint64_t *__p) { return vld1_u64_x4(__p); }
__BUN_CC_INTRIN void vst4_u64(uint64_t *__p, uint64x1x4_t __v) { vst1_u64_x4(__p, __v); }
__BUN_CC_INTRIN uint64x2x2_t vld1q_u64_x2(const uint64_t *__p) { return (uint64x2x2_t){{vld1q_u64(__p + 0), vld1q_u64(__p + 2)}}; }
__BUN_CC_INTRIN void vst1q_u64_x2(uint64_t *__p, uint64x2x2_t __v) { vst1q_u64(__p + 0, __v.val[0]); vst1q_u64(__p + 2, __v.val[1]); }
__BUN_CC_INTRIN uint64x2x3_t vld1q_u64_x3(const uint64_t *__p) { return (uint64x2x3_t){{vld1q_u64(__p + 0), vld1q_u64(__p + 2), vld1q_u64(__p + 4)}}; }
__BUN_CC_INTRIN void vst1q_u64_x3(uint64_t *__p, uint64x2x3_t __v) { vst1q_u64(__p + 0, __v.val[0]); vst1q_u64(__p + 2, __v.val[1]); vst1q_u64(__p + 4, __v.val[2]); }
__BUN_CC_INTRIN uint64x2x4_t vld1q_u64_x4(const uint64_t *__p) { return (uint64x2x4_t){{vld1q_u64(__p + 0), vld1q_u64(__p + 2), vld1q_u64(__p + 4), vld1q_u64(__p + 6)}}; }
__BUN_CC_INTRIN void vst1q_u64_x4(uint64_t *__p, uint64x2x4_t __v) { vst1q_u64(__p + 0, __v.val[0]); vst1q_u64(__p + 2, __v.val[1]); vst1q_u64(__p + 4, __v.val[2]); vst1q_u64(__p + 6, __v.val[3]); }
__BUN_CC_INTRIN uint64x2x2_t vld2q_u64(const uint64_t *__p) { uint64x2_t __a = vld1q_u64(__p), __b = vld1q_u64(__p + 2); return (uint64x2x2_t){{vuzp1q_u64(__a, __b), vuzp2q_u64(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_u64(uint64_t *__p, uint64x2x2_t __v) { vst1q_u64(__p, vzip1q_u64(__v.val[0], __v.val[1])); vst1q_u64(__p + 2, vzip2q_u64(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN uint64x2x4_t vld4q_u64(const uint64_t *__p) { uint64x2_t __a = vld1q_u64(__p), __b = vld1q_u64(__p + 2), __c = vld1q_u64(__p + 4), __d = vld1q_u64(__p + 6); uint64x2_t __e0 = vuzp1q_u64(__a, __b), __o0 = vuzp2q_u64(__a, __b), __e1 = vuzp1q_u64(__c, __d), __o1 = vuzp2q_u64(__c, __d); return (uint64x2x4_t){{vuzp1q_u64(__e0, __e1), vuzp1q_u64(__o0, __o1), vuzp2q_u64(__e0, __e1), vuzp2q_u64(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_u64(uint64_t *__p, uint64x2x4_t __v) { uint64x2_t __l02 = vzip1q_u64(__v.val[0], __v.val[2]), __h02 = vzip2q_u64(__v.val[0], __v.val[2]), __l13 = vzip1q_u64(__v.val[1], __v.val[3]), __h13 = vzip2q_u64(__v.val[1], __v.val[3]); vst1q_u64(__p, vzip1q_u64(__l02, __l13)); vst1q_u64(__p + 2, vzip2q_u64(__l02, __l13)); vst1q_u64(__p + 4, vzip1q_u64(__h02, __h13)); vst1q_u64(__p + 6, vzip2q_u64(__h02, __h13)); }
__BUN_CC_INTRIN float32x2x2_t vld1_f32_x2(const float32_t *__p) { return (float32x2x2_t){{vld1_f32(__p + 0), vld1_f32(__p + 2)}}; }
__BUN_CC_INTRIN void vst1_f32_x2(float32_t *__p, float32x2x2_t __v) { vst1_f32(__p + 0, __v.val[0]); vst1_f32(__p + 2, __v.val[1]); }
__BUN_CC_INTRIN float32x2x3_t vld1_f32_x3(const float32_t *__p) { return (float32x2x3_t){{vld1_f32(__p + 0), vld1_f32(__p + 2), vld1_f32(__p + 4)}}; }
__BUN_CC_INTRIN void vst1_f32_x3(float32_t *__p, float32x2x3_t __v) { vst1_f32(__p + 0, __v.val[0]); vst1_f32(__p + 2, __v.val[1]); vst1_f32(__p + 4, __v.val[2]); }
__BUN_CC_INTRIN float32x2x4_t vld1_f32_x4(const float32_t *__p) { return (float32x2x4_t){{vld1_f32(__p + 0), vld1_f32(__p + 2), vld1_f32(__p + 4), vld1_f32(__p + 6)}}; }
__BUN_CC_INTRIN void vst1_f32_x4(float32_t *__p, float32x2x4_t __v) { vst1_f32(__p + 0, __v.val[0]); vst1_f32(__p + 2, __v.val[1]); vst1_f32(__p + 4, __v.val[2]); vst1_f32(__p + 6, __v.val[3]); }
__BUN_CC_INTRIN float32x2x2_t vld2_f32(const float32_t *__p) { float32x2_t __a = vld1_f32(__p), __b = vld1_f32(__p + 2); return (float32x2x2_t){{vuzp1_f32(__a, __b), vuzp2_f32(__a, __b)}}; }
__BUN_CC_INTRIN void vst2_f32(float32_t *__p, float32x2x2_t __v) { vst1_f32(__p, vzip1_f32(__v.val[0], __v.val[1])); vst1_f32(__p + 2, vzip2_f32(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN float32x2x4_t vld4_f32(const float32_t *__p) { float32x2_t __a = vld1_f32(__p), __b = vld1_f32(__p + 2), __c = vld1_f32(__p + 4), __d = vld1_f32(__p + 6); float32x2_t __e0 = vuzp1_f32(__a, __b), __o0 = vuzp2_f32(__a, __b), __e1 = vuzp1_f32(__c, __d), __o1 = vuzp2_f32(__c, __d); return (float32x2x4_t){{vuzp1_f32(__e0, __e1), vuzp1_f32(__o0, __o1), vuzp2_f32(__e0, __e1), vuzp2_f32(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4_f32(float32_t *__p, float32x2x4_t __v) { float32x2_t __l02 = vzip1_f32(__v.val[0], __v.val[2]), __h02 = vzip2_f32(__v.val[0], __v.val[2]), __l13 = vzip1_f32(__v.val[1], __v.val[3]), __h13 = vzip2_f32(__v.val[1], __v.val[3]); vst1_f32(__p, vzip1_f32(__l02, __l13)); vst1_f32(__p + 2, vzip2_f32(__l02, __l13)); vst1_f32(__p + 4, vzip1_f32(__h02, __h13)); vst1_f32(__p + 6, vzip2_f32(__h02, __h13)); }
__BUN_CC_INTRIN float32x4x2_t vld1q_f32_x2(const float32_t *__p) { return (float32x4x2_t){{vld1q_f32(__p + 0), vld1q_f32(__p + 4)}}; }
__BUN_CC_INTRIN void vst1q_f32_x2(float32_t *__p, float32x4x2_t __v) { vst1q_f32(__p + 0, __v.val[0]); vst1q_f32(__p + 4, __v.val[1]); }
__BUN_CC_INTRIN float32x4x3_t vld1q_f32_x3(const float32_t *__p) { return (float32x4x3_t){{vld1q_f32(__p + 0), vld1q_f32(__p + 4), vld1q_f32(__p + 8)}}; }
__BUN_CC_INTRIN void vst1q_f32_x3(float32_t *__p, float32x4x3_t __v) { vst1q_f32(__p + 0, __v.val[0]); vst1q_f32(__p + 4, __v.val[1]); vst1q_f32(__p + 8, __v.val[2]); }
__BUN_CC_INTRIN float32x4x4_t vld1q_f32_x4(const float32_t *__p) { return (float32x4x4_t){{vld1q_f32(__p + 0), vld1q_f32(__p + 4), vld1q_f32(__p + 8), vld1q_f32(__p + 12)}}; }
__BUN_CC_INTRIN void vst1q_f32_x4(float32_t *__p, float32x4x4_t __v) { vst1q_f32(__p + 0, __v.val[0]); vst1q_f32(__p + 4, __v.val[1]); vst1q_f32(__p + 8, __v.val[2]); vst1q_f32(__p + 12, __v.val[3]); }
__BUN_CC_INTRIN float32x4x2_t vld2q_f32(const float32_t *__p) { float32x4_t __a = vld1q_f32(__p), __b = vld1q_f32(__p + 4); return (float32x4x2_t){{vuzp1q_f32(__a, __b), vuzp2q_f32(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_f32(float32_t *__p, float32x4x2_t __v) { vst1q_f32(__p, vzip1q_f32(__v.val[0], __v.val[1])); vst1q_f32(__p + 4, vzip2q_f32(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN float32x4x4_t vld4q_f32(const float32_t *__p) { float32x4_t __a = vld1q_f32(__p), __b = vld1q_f32(__p + 4), __c = vld1q_f32(__p + 8), __d = vld1q_f32(__p + 12); float32x4_t __e0 = vuzp1q_f32(__a, __b), __o0 = vuzp2q_f32(__a, __b), __e1 = vuzp1q_f32(__c, __d), __o1 = vuzp2q_f32(__c, __d); return (float32x4x4_t){{vuzp1q_f32(__e0, __e1), vuzp1q_f32(__o0, __o1), vuzp2q_f32(__e0, __e1), vuzp2q_f32(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_f32(float32_t *__p, float32x4x4_t __v) { float32x4_t __l02 = vzip1q_f32(__v.val[0], __v.val[2]), __h02 = vzip2q_f32(__v.val[0], __v.val[2]), __l13 = vzip1q_f32(__v.val[1], __v.val[3]), __h13 = vzip2q_f32(__v.val[1], __v.val[3]); vst1q_f32(__p, vzip1q_f32(__l02, __l13)); vst1q_f32(__p + 4, vzip2q_f32(__l02, __l13)); vst1q_f32(__p + 8, vzip1q_f32(__h02, __h13)); vst1q_f32(__p + 12, vzip2q_f32(__h02, __h13)); }
__BUN_CC_INTRIN float64x1x2_t vld1_f64_x2(const float64_t *__p) { return (float64x1x2_t){{vld1_f64(__p + 0), vld1_f64(__p + 1)}}; }
__BUN_CC_INTRIN void vst1_f64_x2(float64_t *__p, float64x1x2_t __v) { vst1_f64(__p + 0, __v.val[0]); vst1_f64(__p + 1, __v.val[1]); }
__BUN_CC_INTRIN float64x1x3_t vld1_f64_x3(const float64_t *__p) { return (float64x1x3_t){{vld1_f64(__p + 0), vld1_f64(__p + 1), vld1_f64(__p + 2)}}; }
__BUN_CC_INTRIN void vst1_f64_x3(float64_t *__p, float64x1x3_t __v) { vst1_f64(__p + 0, __v.val[0]); vst1_f64(__p + 1, __v.val[1]); vst1_f64(__p + 2, __v.val[2]); }
__BUN_CC_INTRIN float64x1x4_t vld1_f64_x4(const float64_t *__p) { return (float64x1x4_t){{vld1_f64(__p + 0), vld1_f64(__p + 1), vld1_f64(__p + 2), vld1_f64(__p + 3)}}; }
__BUN_CC_INTRIN void vst1_f64_x4(float64_t *__p, float64x1x4_t __v) { vst1_f64(__p + 0, __v.val[0]); vst1_f64(__p + 1, __v.val[1]); vst1_f64(__p + 2, __v.val[2]); vst1_f64(__p + 3, __v.val[3]); }
__BUN_CC_INTRIN float64x1x2_t vld2_f64(const float64_t *__p) { return vld1_f64_x2(__p); }
__BUN_CC_INTRIN void vst2_f64(float64_t *__p, float64x1x2_t __v) { vst1_f64_x2(__p, __v); }
__BUN_CC_INTRIN float64x1x3_t vld3_f64(const float64_t *__p) { return vld1_f64_x3(__p); }
__BUN_CC_INTRIN void vst3_f64(float64_t *__p, float64x1x3_t __v) { vst1_f64_x3(__p, __v); }
__BUN_CC_INTRIN float64x1x4_t vld4_f64(const float64_t *__p) { return vld1_f64_x4(__p); }
__BUN_CC_INTRIN void vst4_f64(float64_t *__p, float64x1x4_t __v) { vst1_f64_x4(__p, __v); }
__BUN_CC_INTRIN float64x2x2_t vld1q_f64_x2(const float64_t *__p) { return (float64x2x2_t){{vld1q_f64(__p + 0), vld1q_f64(__p + 2)}}; }
__BUN_CC_INTRIN void vst1q_f64_x2(float64_t *__p, float64x2x2_t __v) { vst1q_f64(__p + 0, __v.val[0]); vst1q_f64(__p + 2, __v.val[1]); }
__BUN_CC_INTRIN float64x2x3_t vld1q_f64_x3(const float64_t *__p) { return (float64x2x3_t){{vld1q_f64(__p + 0), vld1q_f64(__p + 2), vld1q_f64(__p + 4)}}; }
__BUN_CC_INTRIN void vst1q_f64_x3(float64_t *__p, float64x2x3_t __v) { vst1q_f64(__p + 0, __v.val[0]); vst1q_f64(__p + 2, __v.val[1]); vst1q_f64(__p + 4, __v.val[2]); }
__BUN_CC_INTRIN float64x2x4_t vld1q_f64_x4(const float64_t *__p) { return (float64x2x4_t){{vld1q_f64(__p + 0), vld1q_f64(__p + 2), vld1q_f64(__p + 4), vld1q_f64(__p + 6)}}; }
__BUN_CC_INTRIN void vst1q_f64_x4(float64_t *__p, float64x2x4_t __v) { vst1q_f64(__p + 0, __v.val[0]); vst1q_f64(__p + 2, __v.val[1]); vst1q_f64(__p + 4, __v.val[2]); vst1q_f64(__p + 6, __v.val[3]); }
__BUN_CC_INTRIN float64x2x2_t vld2q_f64(const float64_t *__p) { float64x2_t __a = vld1q_f64(__p), __b = vld1q_f64(__p + 2); return (float64x2x2_t){{vuzp1q_f64(__a, __b), vuzp2q_f64(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_f64(float64_t *__p, float64x2x2_t __v) { vst1q_f64(__p, vzip1q_f64(__v.val[0], __v.val[1])); vst1q_f64(__p + 2, vzip2q_f64(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN float64x2x4_t vld4q_f64(const float64_t *__p) { float64x2_t __a = vld1q_f64(__p), __b = vld1q_f64(__p + 2), __c = vld1q_f64(__p + 4), __d = vld1q_f64(__p + 6); float64x2_t __e0 = vuzp1q_f64(__a, __b), __o0 = vuzp2q_f64(__a, __b), __e1 = vuzp1q_f64(__c, __d), __o1 = vuzp2q_f64(__c, __d); return (float64x2x4_t){{vuzp1q_f64(__e0, __e1), vuzp1q_f64(__o0, __o1), vuzp2q_f64(__e0, __e1), vuzp2q_f64(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_f64(float64_t *__p, float64x2x4_t __v) { float64x2_t __l02 = vzip1q_f64(__v.val[0], __v.val[2]), __h02 = vzip2q_f64(__v.val[0], __v.val[2]), __l13 = vzip1q_f64(__v.val[1], __v.val[3]), __h13 = vzip2q_f64(__v.val[1], __v.val[3]); vst1q_f64(__p, vzip1q_f64(__l02, __l13)); vst1q_f64(__p + 2, vzip2q_f64(__l02, __l13)); vst1q_f64(__p + 4, vzip1q_f64(__h02, __h13)); vst1q_f64(__p + 6, vzip2q_f64(__h02, __h13)); }
__BUN_CC_INTRIN poly8x8x2_t vld1_p8_x2(const poly8_t *__p) { return (poly8x8x2_t){{vld1_p8(__p + 0), vld1_p8(__p + 8)}}; }
__BUN_CC_INTRIN void vst1_p8_x2(poly8_t *__p, poly8x8x2_t __v) { vst1_p8(__p + 0, __v.val[0]); vst1_p8(__p + 8, __v.val[1]); }
__BUN_CC_INTRIN poly8x8x3_t vld1_p8_x3(const poly8_t *__p) { return (poly8x8x3_t){{vld1_p8(__p + 0), vld1_p8(__p + 8), vld1_p8(__p + 16)}}; }
__BUN_CC_INTRIN void vst1_p8_x3(poly8_t *__p, poly8x8x3_t __v) { vst1_p8(__p + 0, __v.val[0]); vst1_p8(__p + 8, __v.val[1]); vst1_p8(__p + 16, __v.val[2]); }
__BUN_CC_INTRIN poly8x8x4_t vld1_p8_x4(const poly8_t *__p) { return (poly8x8x4_t){{vld1_p8(__p + 0), vld1_p8(__p + 8), vld1_p8(__p + 16), vld1_p8(__p + 24)}}; }
__BUN_CC_INTRIN void vst1_p8_x4(poly8_t *__p, poly8x8x4_t __v) { vst1_p8(__p + 0, __v.val[0]); vst1_p8(__p + 8, __v.val[1]); vst1_p8(__p + 16, __v.val[2]); vst1_p8(__p + 24, __v.val[3]); }
__BUN_CC_INTRIN poly8x8x2_t vld2_p8(const poly8_t *__p) { poly8x8_t __a = vld1_p8(__p), __b = vld1_p8(__p + 8); return (poly8x8x2_t){{vuzp1_p8(__a, __b), vuzp2_p8(__a, __b)}}; }
__BUN_CC_INTRIN void vst2_p8(poly8_t *__p, poly8x8x2_t __v) { vst1_p8(__p, vzip1_p8(__v.val[0], __v.val[1])); vst1_p8(__p + 8, vzip2_p8(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN poly8x8x4_t vld4_p8(const poly8_t *__p) { poly8x8_t __a = vld1_p8(__p), __b = vld1_p8(__p + 8), __c = vld1_p8(__p + 16), __d = vld1_p8(__p + 24); poly8x8_t __e0 = vuzp1_p8(__a, __b), __o0 = vuzp2_p8(__a, __b), __e1 = vuzp1_p8(__c, __d), __o1 = vuzp2_p8(__c, __d); return (poly8x8x4_t){{vuzp1_p8(__e0, __e1), vuzp1_p8(__o0, __o1), vuzp2_p8(__e0, __e1), vuzp2_p8(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4_p8(poly8_t *__p, poly8x8x4_t __v) { poly8x8_t __l02 = vzip1_p8(__v.val[0], __v.val[2]), __h02 = vzip2_p8(__v.val[0], __v.val[2]), __l13 = vzip1_p8(__v.val[1], __v.val[3]), __h13 = vzip2_p8(__v.val[1], __v.val[3]); vst1_p8(__p, vzip1_p8(__l02, __l13)); vst1_p8(__p + 8, vzip2_p8(__l02, __l13)); vst1_p8(__p + 16, vzip1_p8(__h02, __h13)); vst1_p8(__p + 24, vzip2_p8(__h02, __h13)); }
__BUN_CC_INTRIN poly8x16x2_t vld1q_p8_x2(const poly8_t *__p) { return (poly8x16x2_t){{vld1q_p8(__p + 0), vld1q_p8(__p + 16)}}; }
__BUN_CC_INTRIN void vst1q_p8_x2(poly8_t *__p, poly8x16x2_t __v) { vst1q_p8(__p + 0, __v.val[0]); vst1q_p8(__p + 16, __v.val[1]); }
__BUN_CC_INTRIN poly8x16x3_t vld1q_p8_x3(const poly8_t *__p) { return (poly8x16x3_t){{vld1q_p8(__p + 0), vld1q_p8(__p + 16), vld1q_p8(__p + 32)}}; }
__BUN_CC_INTRIN void vst1q_p8_x3(poly8_t *__p, poly8x16x3_t __v) { vst1q_p8(__p + 0, __v.val[0]); vst1q_p8(__p + 16, __v.val[1]); vst1q_p8(__p + 32, __v.val[2]); }
__BUN_CC_INTRIN poly8x16x4_t vld1q_p8_x4(const poly8_t *__p) { return (poly8x16x4_t){{vld1q_p8(__p + 0), vld1q_p8(__p + 16), vld1q_p8(__p + 32), vld1q_p8(__p + 48)}}; }
__BUN_CC_INTRIN void vst1q_p8_x4(poly8_t *__p, poly8x16x4_t __v) { vst1q_p8(__p + 0, __v.val[0]); vst1q_p8(__p + 16, __v.val[1]); vst1q_p8(__p + 32, __v.val[2]); vst1q_p8(__p + 48, __v.val[3]); }
__BUN_CC_INTRIN poly8x16x2_t vld2q_p8(const poly8_t *__p) { poly8x16_t __a = vld1q_p8(__p), __b = vld1q_p8(__p + 16); return (poly8x16x2_t){{vuzp1q_p8(__a, __b), vuzp2q_p8(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_p8(poly8_t *__p, poly8x16x2_t __v) { vst1q_p8(__p, vzip1q_p8(__v.val[0], __v.val[1])); vst1q_p8(__p + 16, vzip2q_p8(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN poly8x16x4_t vld4q_p8(const poly8_t *__p) { poly8x16_t __a = vld1q_p8(__p), __b = vld1q_p8(__p + 16), __c = vld1q_p8(__p + 32), __d = vld1q_p8(__p + 48); poly8x16_t __e0 = vuzp1q_p8(__a, __b), __o0 = vuzp2q_p8(__a, __b), __e1 = vuzp1q_p8(__c, __d), __o1 = vuzp2q_p8(__c, __d); return (poly8x16x4_t){{vuzp1q_p8(__e0, __e1), vuzp1q_p8(__o0, __o1), vuzp2q_p8(__e0, __e1), vuzp2q_p8(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_p8(poly8_t *__p, poly8x16x4_t __v) { poly8x16_t __l02 = vzip1q_p8(__v.val[0], __v.val[2]), __h02 = vzip2q_p8(__v.val[0], __v.val[2]), __l13 = vzip1q_p8(__v.val[1], __v.val[3]), __h13 = vzip2q_p8(__v.val[1], __v.val[3]); vst1q_p8(__p, vzip1q_p8(__l02, __l13)); vst1q_p8(__p + 16, vzip2q_p8(__l02, __l13)); vst1q_p8(__p + 32, vzip1q_p8(__h02, __h13)); vst1q_p8(__p + 48, vzip2q_p8(__h02, __h13)); }
__BUN_CC_INTRIN poly16x4x2_t vld1_p16_x2(const poly16_t *__p) { return (poly16x4x2_t){{vld1_p16(__p + 0), vld1_p16(__p + 4)}}; }
__BUN_CC_INTRIN void vst1_p16_x2(poly16_t *__p, poly16x4x2_t __v) { vst1_p16(__p + 0, __v.val[0]); vst1_p16(__p + 4, __v.val[1]); }
__BUN_CC_INTRIN poly16x4x3_t vld1_p16_x3(const poly16_t *__p) { return (poly16x4x3_t){{vld1_p16(__p + 0), vld1_p16(__p + 4), vld1_p16(__p + 8)}}; }
__BUN_CC_INTRIN void vst1_p16_x3(poly16_t *__p, poly16x4x3_t __v) { vst1_p16(__p + 0, __v.val[0]); vst1_p16(__p + 4, __v.val[1]); vst1_p16(__p + 8, __v.val[2]); }
__BUN_CC_INTRIN poly16x4x4_t vld1_p16_x4(const poly16_t *__p) { return (poly16x4x4_t){{vld1_p16(__p + 0), vld1_p16(__p + 4), vld1_p16(__p + 8), vld1_p16(__p + 12)}}; }
__BUN_CC_INTRIN void vst1_p16_x4(poly16_t *__p, poly16x4x4_t __v) { vst1_p16(__p + 0, __v.val[0]); vst1_p16(__p + 4, __v.val[1]); vst1_p16(__p + 8, __v.val[2]); vst1_p16(__p + 12, __v.val[3]); }
__BUN_CC_INTRIN poly16x4x2_t vld2_p16(const poly16_t *__p) { poly16x4_t __a = vld1_p16(__p), __b = vld1_p16(__p + 4); return (poly16x4x2_t){{vuzp1_p16(__a, __b), vuzp2_p16(__a, __b)}}; }
__BUN_CC_INTRIN void vst2_p16(poly16_t *__p, poly16x4x2_t __v) { vst1_p16(__p, vzip1_p16(__v.val[0], __v.val[1])); vst1_p16(__p + 4, vzip2_p16(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN poly16x4x4_t vld4_p16(const poly16_t *__p) { poly16x4_t __a = vld1_p16(__p), __b = vld1_p16(__p + 4), __c = vld1_p16(__p + 8), __d = vld1_p16(__p + 12); poly16x4_t __e0 = vuzp1_p16(__a, __b), __o0 = vuzp2_p16(__a, __b), __e1 = vuzp1_p16(__c, __d), __o1 = vuzp2_p16(__c, __d); return (poly16x4x4_t){{vuzp1_p16(__e0, __e1), vuzp1_p16(__o0, __o1), vuzp2_p16(__e0, __e1), vuzp2_p16(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4_p16(poly16_t *__p, poly16x4x4_t __v) { poly16x4_t __l02 = vzip1_p16(__v.val[0], __v.val[2]), __h02 = vzip2_p16(__v.val[0], __v.val[2]), __l13 = vzip1_p16(__v.val[1], __v.val[3]), __h13 = vzip2_p16(__v.val[1], __v.val[3]); vst1_p16(__p, vzip1_p16(__l02, __l13)); vst1_p16(__p + 4, vzip2_p16(__l02, __l13)); vst1_p16(__p + 8, vzip1_p16(__h02, __h13)); vst1_p16(__p + 12, vzip2_p16(__h02, __h13)); }
__BUN_CC_INTRIN poly16x8x2_t vld1q_p16_x2(const poly16_t *__p) { return (poly16x8x2_t){{vld1q_p16(__p + 0), vld1q_p16(__p + 8)}}; }
__BUN_CC_INTRIN void vst1q_p16_x2(poly16_t *__p, poly16x8x2_t __v) { vst1q_p16(__p + 0, __v.val[0]); vst1q_p16(__p + 8, __v.val[1]); }
__BUN_CC_INTRIN poly16x8x3_t vld1q_p16_x3(const poly16_t *__p) { return (poly16x8x3_t){{vld1q_p16(__p + 0), vld1q_p16(__p + 8), vld1q_p16(__p + 16)}}; }
__BUN_CC_INTRIN void vst1q_p16_x3(poly16_t *__p, poly16x8x3_t __v) { vst1q_p16(__p + 0, __v.val[0]); vst1q_p16(__p + 8, __v.val[1]); vst1q_p16(__p + 16, __v.val[2]); }
__BUN_CC_INTRIN poly16x8x4_t vld1q_p16_x4(const poly16_t *__p) { return (poly16x8x4_t){{vld1q_p16(__p + 0), vld1q_p16(__p + 8), vld1q_p16(__p + 16), vld1q_p16(__p + 24)}}; }
__BUN_CC_INTRIN void vst1q_p16_x4(poly16_t *__p, poly16x8x4_t __v) { vst1q_p16(__p + 0, __v.val[0]); vst1q_p16(__p + 8, __v.val[1]); vst1q_p16(__p + 16, __v.val[2]); vst1q_p16(__p + 24, __v.val[3]); }
__BUN_CC_INTRIN poly16x8x2_t vld2q_p16(const poly16_t *__p) { poly16x8_t __a = vld1q_p16(__p), __b = vld1q_p16(__p + 8); return (poly16x8x2_t){{vuzp1q_p16(__a, __b), vuzp2q_p16(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_p16(poly16_t *__p, poly16x8x2_t __v) { vst1q_p16(__p, vzip1q_p16(__v.val[0], __v.val[1])); vst1q_p16(__p + 8, vzip2q_p16(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN poly16x8x4_t vld4q_p16(const poly16_t *__p) { poly16x8_t __a = vld1q_p16(__p), __b = vld1q_p16(__p + 8), __c = vld1q_p16(__p + 16), __d = vld1q_p16(__p + 24); poly16x8_t __e0 = vuzp1q_p16(__a, __b), __o0 = vuzp2q_p16(__a, __b), __e1 = vuzp1q_p16(__c, __d), __o1 = vuzp2q_p16(__c, __d); return (poly16x8x4_t){{vuzp1q_p16(__e0, __e1), vuzp1q_p16(__o0, __o1), vuzp2q_p16(__e0, __e1), vuzp2q_p16(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_p16(poly16_t *__p, poly16x8x4_t __v) { poly16x8_t __l02 = vzip1q_p16(__v.val[0], __v.val[2]), __h02 = vzip2q_p16(__v.val[0], __v.val[2]), __l13 = vzip1q_p16(__v.val[1], __v.val[3]), __h13 = vzip2q_p16(__v.val[1], __v.val[3]); vst1q_p16(__p, vzip1q_p16(__l02, __l13)); vst1q_p16(__p + 8, vzip2q_p16(__l02, __l13)); vst1q_p16(__p + 16, vzip1q_p16(__h02, __h13)); vst1q_p16(__p + 24, vzip2q_p16(__h02, __h13)); }
__BUN_CC_INTRIN poly64x1x2_t vld1_p64_x2(const poly64_t *__p) { return (poly64x1x2_t){{vld1_p64(__p + 0), vld1_p64(__p + 1)}}; }
__BUN_CC_INTRIN void vst1_p64_x2(poly64_t *__p, poly64x1x2_t __v) { vst1_p64(__p + 0, __v.val[0]); vst1_p64(__p + 1, __v.val[1]); }
__BUN_CC_INTRIN poly64x1x3_t vld1_p64_x3(const poly64_t *__p) { return (poly64x1x3_t){{vld1_p64(__p + 0), vld1_p64(__p + 1), vld1_p64(__p + 2)}}; }
__BUN_CC_INTRIN void vst1_p64_x3(poly64_t *__p, poly64x1x3_t __v) { vst1_p64(__p + 0, __v.val[0]); vst1_p64(__p + 1, __v.val[1]); vst1_p64(__p + 2, __v.val[2]); }
__BUN_CC_INTRIN poly64x1x4_t vld1_p64_x4(const poly64_t *__p) { return (poly64x1x4_t){{vld1_p64(__p + 0), vld1_p64(__p + 1), vld1_p64(__p + 2), vld1_p64(__p + 3)}}; }
__BUN_CC_INTRIN void vst1_p64_x4(poly64_t *__p, poly64x1x4_t __v) { vst1_p64(__p + 0, __v.val[0]); vst1_p64(__p + 1, __v.val[1]); vst1_p64(__p + 2, __v.val[2]); vst1_p64(__p + 3, __v.val[3]); }
__BUN_CC_INTRIN poly64x1x2_t vld2_p64(const poly64_t *__p) { return vld1_p64_x2(__p); }
__BUN_CC_INTRIN void vst2_p64(poly64_t *__p, poly64x1x2_t __v) { vst1_p64_x2(__p, __v); }
__BUN_CC_INTRIN poly64x1x3_t vld3_p64(const poly64_t *__p) { return vld1_p64_x3(__p); }
__BUN_CC_INTRIN void vst3_p64(poly64_t *__p, poly64x1x3_t __v) { vst1_p64_x3(__p, __v); }
__BUN_CC_INTRIN poly64x1x4_t vld4_p64(const poly64_t *__p) { return vld1_p64_x4(__p); }
__BUN_CC_INTRIN void vst4_p64(poly64_t *__p, poly64x1x4_t __v) { vst1_p64_x4(__p, __v); }
__BUN_CC_INTRIN poly64x2x2_t vld1q_p64_x2(const poly64_t *__p) { return (poly64x2x2_t){{vld1q_p64(__p + 0), vld1q_p64(__p + 2)}}; }
__BUN_CC_INTRIN void vst1q_p64_x2(poly64_t *__p, poly64x2x2_t __v) { vst1q_p64(__p + 0, __v.val[0]); vst1q_p64(__p + 2, __v.val[1]); }
__BUN_CC_INTRIN poly64x2x3_t vld1q_p64_x3(const poly64_t *__p) { return (poly64x2x3_t){{vld1q_p64(__p + 0), vld1q_p64(__p + 2), vld1q_p64(__p + 4)}}; }
__BUN_CC_INTRIN void vst1q_p64_x3(poly64_t *__p, poly64x2x3_t __v) { vst1q_p64(__p + 0, __v.val[0]); vst1q_p64(__p + 2, __v.val[1]); vst1q_p64(__p + 4, __v.val[2]); }
__BUN_CC_INTRIN poly64x2x4_t vld1q_p64_x4(const poly64_t *__p) { return (poly64x2x4_t){{vld1q_p64(__p + 0), vld1q_p64(__p + 2), vld1q_p64(__p + 4), vld1q_p64(__p + 6)}}; }
__BUN_CC_INTRIN void vst1q_p64_x4(poly64_t *__p, poly64x2x4_t __v) { vst1q_p64(__p + 0, __v.val[0]); vst1q_p64(__p + 2, __v.val[1]); vst1q_p64(__p + 4, __v.val[2]); vst1q_p64(__p + 6, __v.val[3]); }
__BUN_CC_INTRIN poly64x2x2_t vld2q_p64(const poly64_t *__p) { poly64x2_t __a = vld1q_p64(__p), __b = vld1q_p64(__p + 2); return (poly64x2x2_t){{vuzp1q_p64(__a, __b), vuzp2q_p64(__a, __b)}}; }
__BUN_CC_INTRIN void vst2q_p64(poly64_t *__p, poly64x2x2_t __v) { vst1q_p64(__p, vzip1q_p64(__v.val[0], __v.val[1])); vst1q_p64(__p + 2, vzip2q_p64(__v.val[0], __v.val[1])); }
__BUN_CC_INTRIN poly64x2x4_t vld4q_p64(const poly64_t *__p) { poly64x2_t __a = vld1q_p64(__p), __b = vld1q_p64(__p + 2), __c = vld1q_p64(__p + 4), __d = vld1q_p64(__p + 6); poly64x2_t __e0 = vuzp1q_p64(__a, __b), __o0 = vuzp2q_p64(__a, __b), __e1 = vuzp1q_p64(__c, __d), __o1 = vuzp2q_p64(__c, __d); return (poly64x2x4_t){{vuzp1q_p64(__e0, __e1), vuzp1q_p64(__o0, __o1), vuzp2q_p64(__e0, __e1), vuzp2q_p64(__o0, __o1)}}; }
__BUN_CC_INTRIN void vst4q_p64(poly64_t *__p, poly64x2x4_t __v) { poly64x2_t __l02 = vzip1q_p64(__v.val[0], __v.val[2]), __h02 = vzip2q_p64(__v.val[0], __v.val[2]), __l13 = vzip1q_p64(__v.val[1], __v.val[3]), __h13 = vzip2q_p64(__v.val[1], __v.val[3]); vst1q_p64(__p, vzip1q_p64(__l02, __l13)); vst1q_p64(__p + 2, vzip2q_p64(__l02, __l13)); vst1q_p64(__p + 4, vzip1q_p64(__h02, __h13)); vst1q_p64(__p + 6, vzip2q_p64(__h02, __h13)); }

/* Reinterpretation of 64-bit vectors, and of the polynomial types. */
#define vreinterpret_s8_u8(v) ((int8x8_t)(uint8x8_t)(v))
#define vreinterpret_s8_s16(v) ((int8x8_t)(int16x4_t)(v))
#define vreinterpret_s8_u16(v) ((int8x8_t)(uint16x4_t)(v))
#define vreinterpret_s8_s32(v) ((int8x8_t)(int32x2_t)(v))
#define vreinterpret_s8_u32(v) ((int8x8_t)(uint32x2_t)(v))
#define vreinterpret_s8_s64(v) ((int8x8_t)(int64x1_t)(v))
#define vreinterpret_s8_u64(v) ((int8x8_t)(uint64x1_t)(v))
#define vreinterpret_s8_f32(v) ((int8x8_t)(float32x2_t)(v))
#define vreinterpret_s8_f64(v) ((int8x8_t)(float64x1_t)(v))
#define vreinterpret_s8_p8(v) ((int8x8_t)(poly8x8_t)(v))
#define vreinterpret_s8_p16(v) ((int8x8_t)(poly16x4_t)(v))
#define vreinterpret_s8_p64(v) ((int8x8_t)(poly64x1_t)(v))
#define vreinterpret_u8_s8(v) ((uint8x8_t)(int8x8_t)(v))
#define vreinterpret_u8_s16(v) ((uint8x8_t)(int16x4_t)(v))
#define vreinterpret_u8_u16(v) ((uint8x8_t)(uint16x4_t)(v))
#define vreinterpret_u8_s32(v) ((uint8x8_t)(int32x2_t)(v))
#define vreinterpret_u8_u32(v) ((uint8x8_t)(uint32x2_t)(v))
#define vreinterpret_u8_s64(v) ((uint8x8_t)(int64x1_t)(v))
#define vreinterpret_u8_u64(v) ((uint8x8_t)(uint64x1_t)(v))
#define vreinterpret_u8_f32(v) ((uint8x8_t)(float32x2_t)(v))
#define vreinterpret_u8_f64(v) ((uint8x8_t)(float64x1_t)(v))
#define vreinterpret_u8_p8(v) ((uint8x8_t)(poly8x8_t)(v))
#define vreinterpret_u8_p16(v) ((uint8x8_t)(poly16x4_t)(v))
#define vreinterpret_u8_p64(v) ((uint8x8_t)(poly64x1_t)(v))
#define vreinterpret_s16_s8(v) ((int16x4_t)(int8x8_t)(v))
#define vreinterpret_s16_u8(v) ((int16x4_t)(uint8x8_t)(v))
#define vreinterpret_s16_u16(v) ((int16x4_t)(uint16x4_t)(v))
#define vreinterpret_s16_s32(v) ((int16x4_t)(int32x2_t)(v))
#define vreinterpret_s16_u32(v) ((int16x4_t)(uint32x2_t)(v))
#define vreinterpret_s16_s64(v) ((int16x4_t)(int64x1_t)(v))
#define vreinterpret_s16_u64(v) ((int16x4_t)(uint64x1_t)(v))
#define vreinterpret_s16_f32(v) ((int16x4_t)(float32x2_t)(v))
#define vreinterpret_s16_f64(v) ((int16x4_t)(float64x1_t)(v))
#define vreinterpret_s16_p8(v) ((int16x4_t)(poly8x8_t)(v))
#define vreinterpret_s16_p16(v) ((int16x4_t)(poly16x4_t)(v))
#define vreinterpret_s16_p64(v) ((int16x4_t)(poly64x1_t)(v))
#define vreinterpret_u16_s8(v) ((uint16x4_t)(int8x8_t)(v))
#define vreinterpret_u16_u8(v) ((uint16x4_t)(uint8x8_t)(v))
#define vreinterpret_u16_s16(v) ((uint16x4_t)(int16x4_t)(v))
#define vreinterpret_u16_s32(v) ((uint16x4_t)(int32x2_t)(v))
#define vreinterpret_u16_u32(v) ((uint16x4_t)(uint32x2_t)(v))
#define vreinterpret_u16_s64(v) ((uint16x4_t)(int64x1_t)(v))
#define vreinterpret_u16_u64(v) ((uint16x4_t)(uint64x1_t)(v))
#define vreinterpret_u16_f32(v) ((uint16x4_t)(float32x2_t)(v))
#define vreinterpret_u16_f64(v) ((uint16x4_t)(float64x1_t)(v))
#define vreinterpret_u16_p8(v) ((uint16x4_t)(poly8x8_t)(v))
#define vreinterpret_u16_p16(v) ((uint16x4_t)(poly16x4_t)(v))
#define vreinterpret_u16_p64(v) ((uint16x4_t)(poly64x1_t)(v))
#define vreinterpret_s32_s8(v) ((int32x2_t)(int8x8_t)(v))
#define vreinterpret_s32_u8(v) ((int32x2_t)(uint8x8_t)(v))
#define vreinterpret_s32_s16(v) ((int32x2_t)(int16x4_t)(v))
#define vreinterpret_s32_u16(v) ((int32x2_t)(uint16x4_t)(v))
#define vreinterpret_s32_u32(v) ((int32x2_t)(uint32x2_t)(v))
#define vreinterpret_s32_s64(v) ((int32x2_t)(int64x1_t)(v))
#define vreinterpret_s32_u64(v) ((int32x2_t)(uint64x1_t)(v))
#define vreinterpret_s32_f32(v) ((int32x2_t)(float32x2_t)(v))
#define vreinterpret_s32_f64(v) ((int32x2_t)(float64x1_t)(v))
#define vreinterpret_s32_p8(v) ((int32x2_t)(poly8x8_t)(v))
#define vreinterpret_s32_p16(v) ((int32x2_t)(poly16x4_t)(v))
#define vreinterpret_s32_p64(v) ((int32x2_t)(poly64x1_t)(v))
#define vreinterpret_u32_s8(v) ((uint32x2_t)(int8x8_t)(v))
#define vreinterpret_u32_u8(v) ((uint32x2_t)(uint8x8_t)(v))
#define vreinterpret_u32_s16(v) ((uint32x2_t)(int16x4_t)(v))
#define vreinterpret_u32_u16(v) ((uint32x2_t)(uint16x4_t)(v))
#define vreinterpret_u32_s32(v) ((uint32x2_t)(int32x2_t)(v))
#define vreinterpret_u32_s64(v) ((uint32x2_t)(int64x1_t)(v))
#define vreinterpret_u32_u64(v) ((uint32x2_t)(uint64x1_t)(v))
#define vreinterpret_u32_f32(v) ((uint32x2_t)(float32x2_t)(v))
#define vreinterpret_u32_f64(v) ((uint32x2_t)(float64x1_t)(v))
#define vreinterpret_u32_p8(v) ((uint32x2_t)(poly8x8_t)(v))
#define vreinterpret_u32_p16(v) ((uint32x2_t)(poly16x4_t)(v))
#define vreinterpret_u32_p64(v) ((uint32x2_t)(poly64x1_t)(v))
#define vreinterpret_s64_s8(v) ((int64x1_t)(int8x8_t)(v))
#define vreinterpret_s64_u8(v) ((int64x1_t)(uint8x8_t)(v))
#define vreinterpret_s64_s16(v) ((int64x1_t)(int16x4_t)(v))
#define vreinterpret_s64_u16(v) ((int64x1_t)(uint16x4_t)(v))
#define vreinterpret_s64_s32(v) ((int64x1_t)(int32x2_t)(v))
#define vreinterpret_s64_u32(v) ((int64x1_t)(uint32x2_t)(v))
#define vreinterpret_s64_u64(v) ((int64x1_t)(uint64x1_t)(v))
#define vreinterpret_s64_f32(v) ((int64x1_t)(float32x2_t)(v))
#define vreinterpret_s64_f64(v) ((int64x1_t)(float64x1_t)(v))
#define vreinterpret_s64_p8(v) ((int64x1_t)(poly8x8_t)(v))
#define vreinterpret_s64_p16(v) ((int64x1_t)(poly16x4_t)(v))
#define vreinterpret_s64_p64(v) ((int64x1_t)(poly64x1_t)(v))
#define vreinterpret_u64_s8(v) ((uint64x1_t)(int8x8_t)(v))
#define vreinterpret_u64_u8(v) ((uint64x1_t)(uint8x8_t)(v))
#define vreinterpret_u64_s16(v) ((uint64x1_t)(int16x4_t)(v))
#define vreinterpret_u64_u16(v) ((uint64x1_t)(uint16x4_t)(v))
#define vreinterpret_u64_s32(v) ((uint64x1_t)(int32x2_t)(v))
#define vreinterpret_u64_u32(v) ((uint64x1_t)(uint32x2_t)(v))
#define vreinterpret_u64_s64(v) ((uint64x1_t)(int64x1_t)(v))
#define vreinterpret_u64_f32(v) ((uint64x1_t)(float32x2_t)(v))
#define vreinterpret_u64_f64(v) ((uint64x1_t)(float64x1_t)(v))
#define vreinterpret_u64_p8(v) ((uint64x1_t)(poly8x8_t)(v))
#define vreinterpret_u64_p16(v) ((uint64x1_t)(poly16x4_t)(v))
#define vreinterpret_u64_p64(v) ((uint64x1_t)(poly64x1_t)(v))
#define vreinterpret_f32_s8(v) ((float32x2_t)(int8x8_t)(v))
#define vreinterpret_f32_u8(v) ((float32x2_t)(uint8x8_t)(v))
#define vreinterpret_f32_s16(v) ((float32x2_t)(int16x4_t)(v))
#define vreinterpret_f32_u16(v) ((float32x2_t)(uint16x4_t)(v))
#define vreinterpret_f32_s32(v) ((float32x2_t)(int32x2_t)(v))
#define vreinterpret_f32_u32(v) ((float32x2_t)(uint32x2_t)(v))
#define vreinterpret_f32_s64(v) ((float32x2_t)(int64x1_t)(v))
#define vreinterpret_f32_u64(v) ((float32x2_t)(uint64x1_t)(v))
#define vreinterpret_f32_f64(v) ((float32x2_t)(float64x1_t)(v))
#define vreinterpret_f32_p8(v) ((float32x2_t)(poly8x8_t)(v))
#define vreinterpret_f32_p16(v) ((float32x2_t)(poly16x4_t)(v))
#define vreinterpret_f32_p64(v) ((float32x2_t)(poly64x1_t)(v))
#define vreinterpret_f64_s8(v) ((float64x1_t)(int8x8_t)(v))
#define vreinterpret_f64_u8(v) ((float64x1_t)(uint8x8_t)(v))
#define vreinterpret_f64_s16(v) ((float64x1_t)(int16x4_t)(v))
#define vreinterpret_f64_u16(v) ((float64x1_t)(uint16x4_t)(v))
#define vreinterpret_f64_s32(v) ((float64x1_t)(int32x2_t)(v))
#define vreinterpret_f64_u32(v) ((float64x1_t)(uint32x2_t)(v))
#define vreinterpret_f64_s64(v) ((float64x1_t)(int64x1_t)(v))
#define vreinterpret_f64_u64(v) ((float64x1_t)(uint64x1_t)(v))
#define vreinterpret_f64_f32(v) ((float64x1_t)(float32x2_t)(v))
#define vreinterpret_f64_p8(v) ((float64x1_t)(poly8x8_t)(v))
#define vreinterpret_f64_p16(v) ((float64x1_t)(poly16x4_t)(v))
#define vreinterpret_f64_p64(v) ((float64x1_t)(poly64x1_t)(v))
#define vreinterpret_p8_s8(v) ((poly8x8_t)(int8x8_t)(v))
#define vreinterpret_p8_u8(v) ((poly8x8_t)(uint8x8_t)(v))
#define vreinterpret_p8_s16(v) ((poly8x8_t)(int16x4_t)(v))
#define vreinterpret_p8_u16(v) ((poly8x8_t)(uint16x4_t)(v))
#define vreinterpret_p8_s32(v) ((poly8x8_t)(int32x2_t)(v))
#define vreinterpret_p8_u32(v) ((poly8x8_t)(uint32x2_t)(v))
#define vreinterpret_p8_s64(v) ((poly8x8_t)(int64x1_t)(v))
#define vreinterpret_p8_u64(v) ((poly8x8_t)(uint64x1_t)(v))
#define vreinterpret_p8_f32(v) ((poly8x8_t)(float32x2_t)(v))
#define vreinterpret_p8_f64(v) ((poly8x8_t)(float64x1_t)(v))
#define vreinterpret_p8_p16(v) ((poly8x8_t)(poly16x4_t)(v))
#define vreinterpret_p8_p64(v) ((poly8x8_t)(poly64x1_t)(v))
#define vreinterpret_p16_s8(v) ((poly16x4_t)(int8x8_t)(v))
#define vreinterpret_p16_u8(v) ((poly16x4_t)(uint8x8_t)(v))
#define vreinterpret_p16_s16(v) ((poly16x4_t)(int16x4_t)(v))
#define vreinterpret_p16_u16(v) ((poly16x4_t)(uint16x4_t)(v))
#define vreinterpret_p16_s32(v) ((poly16x4_t)(int32x2_t)(v))
#define vreinterpret_p16_u32(v) ((poly16x4_t)(uint32x2_t)(v))
#define vreinterpret_p16_s64(v) ((poly16x4_t)(int64x1_t)(v))
#define vreinterpret_p16_u64(v) ((poly16x4_t)(uint64x1_t)(v))
#define vreinterpret_p16_f32(v) ((poly16x4_t)(float32x2_t)(v))
#define vreinterpret_p16_f64(v) ((poly16x4_t)(float64x1_t)(v))
#define vreinterpret_p16_p8(v) ((poly16x4_t)(poly8x8_t)(v))
#define vreinterpret_p16_p64(v) ((poly16x4_t)(poly64x1_t)(v))
#define vreinterpret_p64_s8(v) ((poly64x1_t)(int8x8_t)(v))
#define vreinterpret_p64_u8(v) ((poly64x1_t)(uint8x8_t)(v))
#define vreinterpret_p64_s16(v) ((poly64x1_t)(int16x4_t)(v))
#define vreinterpret_p64_u16(v) ((poly64x1_t)(uint16x4_t)(v))
#define vreinterpret_p64_s32(v) ((poly64x1_t)(int32x2_t)(v))
#define vreinterpret_p64_u32(v) ((poly64x1_t)(uint32x2_t)(v))
#define vreinterpret_p64_s64(v) ((poly64x1_t)(int64x1_t)(v))
#define vreinterpret_p64_u64(v) ((poly64x1_t)(uint64x1_t)(v))
#define vreinterpret_p64_f32(v) ((poly64x1_t)(float32x2_t)(v))
#define vreinterpret_p64_f64(v) ((poly64x1_t)(float64x1_t)(v))
#define vreinterpret_p64_p8(v) ((poly64x1_t)(poly8x8_t)(v))
#define vreinterpret_p64_p16(v) ((poly64x1_t)(poly16x4_t)(v))
#define vreinterpretq_s8_p8(v) ((int8x16_t)(poly8x16_t)(v))
#define vreinterpretq_s8_p16(v) ((int8x16_t)(poly16x8_t)(v))
#define vreinterpretq_s8_p64(v) ((int8x16_t)(poly64x2_t)(v))
#define vreinterpretq_u8_p8(v) ((uint8x16_t)(poly8x16_t)(v))
#define vreinterpretq_u8_p16(v) ((uint8x16_t)(poly16x8_t)(v))
#define vreinterpretq_u8_p64(v) ((uint8x16_t)(poly64x2_t)(v))
#define vreinterpretq_s16_p8(v) ((int16x8_t)(poly8x16_t)(v))
#define vreinterpretq_s16_p16(v) ((int16x8_t)(poly16x8_t)(v))
#define vreinterpretq_s16_p64(v) ((int16x8_t)(poly64x2_t)(v))
#define vreinterpretq_u16_p8(v) ((uint16x8_t)(poly8x16_t)(v))
#define vreinterpretq_u16_p16(v) ((uint16x8_t)(poly16x8_t)(v))
#define vreinterpretq_u16_p64(v) ((uint16x8_t)(poly64x2_t)(v))
#define vreinterpretq_s32_p8(v) ((int32x4_t)(poly8x16_t)(v))
#define vreinterpretq_s32_p16(v) ((int32x4_t)(poly16x8_t)(v))
#define vreinterpretq_s32_p64(v) ((int32x4_t)(poly64x2_t)(v))
#define vreinterpretq_u32_p8(v) ((uint32x4_t)(poly8x16_t)(v))
#define vreinterpretq_u32_p16(v) ((uint32x4_t)(poly16x8_t)(v))
#define vreinterpretq_u32_p64(v) ((uint32x4_t)(poly64x2_t)(v))
#define vreinterpretq_s64_p8(v) ((int64x2_t)(poly8x16_t)(v))
#define vreinterpretq_s64_p16(v) ((int64x2_t)(poly16x8_t)(v))
#define vreinterpretq_s64_p64(v) ((int64x2_t)(poly64x2_t)(v))
#define vreinterpretq_u64_p8(v) ((uint64x2_t)(poly8x16_t)(v))
#define vreinterpretq_u64_p16(v) ((uint64x2_t)(poly16x8_t)(v))
#define vreinterpretq_u64_p64(v) ((uint64x2_t)(poly64x2_t)(v))
#define vreinterpretq_f32_p8(v) ((float32x4_t)(poly8x16_t)(v))
#define vreinterpretq_f32_p16(v) ((float32x4_t)(poly16x8_t)(v))
#define vreinterpretq_f32_p64(v) ((float32x4_t)(poly64x2_t)(v))
#define vreinterpretq_f64_p8(v) ((float64x2_t)(poly8x16_t)(v))
#define vreinterpretq_f64_p16(v) ((float64x2_t)(poly16x8_t)(v))
#define vreinterpretq_f64_p64(v) ((float64x2_t)(poly64x2_t)(v))
#define vreinterpretq_p8_s8(v) ((poly8x16_t)(int8x16_t)(v))
#define vreinterpretq_p8_u8(v) ((poly8x16_t)(uint8x16_t)(v))
#define vreinterpretq_p8_s16(v) ((poly8x16_t)(int16x8_t)(v))
#define vreinterpretq_p8_u16(v) ((poly8x16_t)(uint16x8_t)(v))
#define vreinterpretq_p8_s32(v) ((poly8x16_t)(int32x4_t)(v))
#define vreinterpretq_p8_u32(v) ((poly8x16_t)(uint32x4_t)(v))
#define vreinterpretq_p8_s64(v) ((poly8x16_t)(int64x2_t)(v))
#define vreinterpretq_p8_u64(v) ((poly8x16_t)(uint64x2_t)(v))
#define vreinterpretq_p8_f32(v) ((poly8x16_t)(float32x4_t)(v))
#define vreinterpretq_p8_f64(v) ((poly8x16_t)(float64x2_t)(v))
#define vreinterpretq_p8_p16(v) ((poly8x16_t)(poly16x8_t)(v))
#define vreinterpretq_p8_p64(v) ((poly8x16_t)(poly64x2_t)(v))
#define vreinterpretq_p16_s8(v) ((poly16x8_t)(int8x16_t)(v))
#define vreinterpretq_p16_u8(v) ((poly16x8_t)(uint8x16_t)(v))
#define vreinterpretq_p16_s16(v) ((poly16x8_t)(int16x8_t)(v))
#define vreinterpretq_p16_u16(v) ((poly16x8_t)(uint16x8_t)(v))
#define vreinterpretq_p16_s32(v) ((poly16x8_t)(int32x4_t)(v))
#define vreinterpretq_p16_u32(v) ((poly16x8_t)(uint32x4_t)(v))
#define vreinterpretq_p16_s64(v) ((poly16x8_t)(int64x2_t)(v))
#define vreinterpretq_p16_u64(v) ((poly16x8_t)(uint64x2_t)(v))
#define vreinterpretq_p16_f32(v) ((poly16x8_t)(float32x4_t)(v))
#define vreinterpretq_p16_f64(v) ((poly16x8_t)(float64x2_t)(v))
#define vreinterpretq_p16_p8(v) ((poly16x8_t)(poly8x16_t)(v))
#define vreinterpretq_p16_p64(v) ((poly16x8_t)(poly64x2_t)(v))
#define vreinterpretq_p64_s8(v) ((poly64x2_t)(int8x16_t)(v))
#define vreinterpretq_p64_u8(v) ((poly64x2_t)(uint8x16_t)(v))
#define vreinterpretq_p64_s16(v) ((poly64x2_t)(int16x8_t)(v))
#define vreinterpretq_p64_u16(v) ((poly64x2_t)(uint16x8_t)(v))
#define vreinterpretq_p64_s32(v) ((poly64x2_t)(int32x4_t)(v))
#define vreinterpretq_p64_u32(v) ((poly64x2_t)(uint32x4_t)(v))
#define vreinterpretq_p64_s64(v) ((poly64x2_t)(int64x2_t)(v))
#define vreinterpretq_p64_u64(v) ((poly64x2_t)(uint64x2_t)(v))
#define vreinterpretq_p64_f32(v) ((poly64x2_t)(float32x4_t)(v))
#define vreinterpretq_p64_f64(v) ((poly64x2_t)(float64x2_t)(v))
#define vreinterpretq_p64_p8(v) ((poly64x2_t)(poly8x16_t)(v))
#define vreinterpretq_p64_p16(v) ((poly64x2_t)(poly16x8_t)(v))

/* Shifts by a vector of counts, leading zeros, comparisons with zero, saturating arithmetic on wide lanes. */
__BUN_CC_INTRIN int8x8_t vshl_s8(int8x8_t __a, int8x8_t __b) { int8x8_t __s = __b, __n = -__s; int8x8_t __l = __s >= 8 ? vdup_n_s8(0) : __a << (__s & 7); int8x8_t __r = __s <= -8 ? (__a >> 7) : __a >> (__n & 7); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN int8x8_t vclz_s8(int8x8_t __a) { uint8x8_t __v = (uint8x8_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; return (int8x8_t)(8 - vcnt_u8((uint8x8_t)__v)); }
__BUN_CC_INTRIN uint8x8_t vcltz_s8(int8x8_t __a) { return (uint8x8_t)(__a < 0); }
__BUN_CC_INTRIN uint8x8_t vcgtz_s8(int8x8_t __a) { return (uint8x8_t)(__a > 0); }
__BUN_CC_INTRIN uint8x8_t vclez_s8(int8x8_t __a) { return (uint8x8_t)(__a <= 0); }
__BUN_CC_INTRIN uint8x8_t vcgez_s8(int8x8_t __a) { return (uint8x8_t)(__a >= 0); }
__BUN_CC_INTRIN int8x8_t vrsra_n_s8(int8x8_t __a, int8x8_t __b, int __n) { return __a + vrshr_n_s8(__b, __n); }
__BUN_CC_INTRIN uint8x8_t vqshlu_n_s8(int8x8_t __a, int __n) { uint8x8_t __u = (uint8x8_t)__a; uint8x8_t __r = __n == 0 ? __u : ((__u >> (8 - __n)) != 0 ? ~vdup_n_u8(0) : __u << __n); return __a < 0 ? vdup_n_u8(0) : __r; }
__BUN_CC_INTRIN int8x16_t vshlq_s8(int8x16_t __a, int8x16_t __b) { int8x16_t __s = __b, __n = -__s; int8x16_t __l = __s >= 8 ? vdupq_n_s8(0) : __a << (__s & 7); int8x16_t __r = __s <= -8 ? (__a >> 7) : __a >> (__n & 7); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN int8x16_t vclzq_s8(int8x16_t __a) { uint8x16_t __v = (uint8x16_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; return (int8x16_t)(8 - vcntq_u8((uint8x16_t)__v)); }
__BUN_CC_INTRIN uint8x16_t vcltzq_s8(int8x16_t __a) { return (uint8x16_t)(__a < 0); }
__BUN_CC_INTRIN uint8x16_t vcgtzq_s8(int8x16_t __a) { return (uint8x16_t)(__a > 0); }
__BUN_CC_INTRIN uint8x16_t vclezq_s8(int8x16_t __a) { return (uint8x16_t)(__a <= 0); }
__BUN_CC_INTRIN uint8x16_t vcgezq_s8(int8x16_t __a) { return (uint8x16_t)(__a >= 0); }
__BUN_CC_INTRIN int8x16_t vrsraq_n_s8(int8x16_t __a, int8x16_t __b, int __n) { return __a + vrshrq_n_s8(__b, __n); }
__BUN_CC_INTRIN uint8x16_t vqshluq_n_s8(int8x16_t __a, int __n) { uint8x16_t __u = (uint8x16_t)__a; uint8x16_t __r = __n == 0 ? __u : ((__u >> (8 - __n)) != 0 ? ~vdupq_n_u8(0) : __u << __n); return __a < 0 ? vdupq_n_u8(0) : __r; }
__BUN_CC_INTRIN uint8x8_t vshl_u8(uint8x8_t __a, int8x8_t __b) { int8x8_t __s = __b, __n = -__s; uint8x8_t __l = __s >= 8 ? vdup_n_u8(0) : __a << (__s & 7); uint8x8_t __r = __s <= -8 ? vdup_n_u8(0) : __a >> (__n & 7); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint8x8_t vclz_u8(uint8x8_t __a) { uint8x8_t __v = (uint8x8_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; return (uint8x8_t)(8 - vcnt_u8((uint8x8_t)__v)); }
__BUN_CC_INTRIN uint8x8_t vrsra_n_u8(uint8x8_t __a, uint8x8_t __b, int __n) { return __a + vrshr_n_u8(__b, __n); }
__BUN_CC_INTRIN uint8x16_t vshlq_u8(uint8x16_t __a, int8x16_t __b) { int8x16_t __s = __b, __n = -__s; uint8x16_t __l = __s >= 8 ? vdupq_n_u8(0) : __a << (__s & 7); uint8x16_t __r = __s <= -8 ? vdupq_n_u8(0) : __a >> (__n & 7); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint8x16_t vclzq_u8(uint8x16_t __a) { uint8x16_t __v = (uint8x16_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; return (uint8x16_t)(8 - vcntq_u8((uint8x16_t)__v)); }
__BUN_CC_INTRIN uint8x16_t vrsraq_n_u8(uint8x16_t __a, uint8x16_t __b, int __n) { return __a + vrshrq_n_u8(__b, __n); }
__BUN_CC_INTRIN int16x4_t vshl_s16(int16x4_t __a, int16x4_t __b) { int16x4_t __s = (__b << 8) >> 8, __n = -__s; int16x4_t __l = __s >= 16 ? vdup_n_s16(0) : __a << (__s & 15); int16x4_t __r = __s <= -16 ? (__a >> 15) : __a >> (__n & 15); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN int16x4_t vclz_s16(int16x4_t __a) { uint16x4_t __v = (uint16x4_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; __v |= __v >> 8; return (int16x4_t)(16 - vpaddl_u8(vcnt_u8((uint8x8_t)__v))); }
__BUN_CC_INTRIN uint16x4_t vcltz_s16(int16x4_t __a) { return (uint16x4_t)(__a < 0); }
__BUN_CC_INTRIN uint16x4_t vcgtz_s16(int16x4_t __a) { return (uint16x4_t)(__a > 0); }
__BUN_CC_INTRIN uint16x4_t vclez_s16(int16x4_t __a) { return (uint16x4_t)(__a <= 0); }
__BUN_CC_INTRIN uint16x4_t vcgez_s16(int16x4_t __a) { return (uint16x4_t)(__a >= 0); }
__BUN_CC_INTRIN int16x4_t vrsra_n_s16(int16x4_t __a, int16x4_t __b, int __n) { return __a + vrshr_n_s16(__b, __n); }
__BUN_CC_INTRIN uint16x4_t vqshlu_n_s16(int16x4_t __a, int __n) { uint16x4_t __u = (uint16x4_t)__a; uint16x4_t __r = __n == 0 ? __u : ((__u >> (16 - __n)) != 0 ? ~vdup_n_u16(0) : __u << __n); return __a < 0 ? vdup_n_u16(0) : __r; }
__BUN_CC_INTRIN int16x8_t vshlq_s16(int16x8_t __a, int16x8_t __b) { int16x8_t __s = (__b << 8) >> 8, __n = -__s; int16x8_t __l = __s >= 16 ? vdupq_n_s16(0) : __a << (__s & 15); int16x8_t __r = __s <= -16 ? (__a >> 15) : __a >> (__n & 15); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN int16x8_t vclzq_s16(int16x8_t __a) { uint16x8_t __v = (uint16x8_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; __v |= __v >> 8; return (int16x8_t)(16 - vpaddlq_u8(vcntq_u8((uint8x16_t)__v))); }
__BUN_CC_INTRIN uint16x8_t vcltzq_s16(int16x8_t __a) { return (uint16x8_t)(__a < 0); }
__BUN_CC_INTRIN uint16x8_t vcgtzq_s16(int16x8_t __a) { return (uint16x8_t)(__a > 0); }
__BUN_CC_INTRIN uint16x8_t vclezq_s16(int16x8_t __a) { return (uint16x8_t)(__a <= 0); }
__BUN_CC_INTRIN uint16x8_t vcgezq_s16(int16x8_t __a) { return (uint16x8_t)(__a >= 0); }
__BUN_CC_INTRIN int16x8_t vrsraq_n_s16(int16x8_t __a, int16x8_t __b, int __n) { return __a + vrshrq_n_s16(__b, __n); }
__BUN_CC_INTRIN uint16x8_t vqshluq_n_s16(int16x8_t __a, int __n) { uint16x8_t __u = (uint16x8_t)__a; uint16x8_t __r = __n == 0 ? __u : ((__u >> (16 - __n)) != 0 ? ~vdupq_n_u16(0) : __u << __n); return __a < 0 ? vdupq_n_u16(0) : __r; }
__BUN_CC_INTRIN uint16x4_t vshl_u16(uint16x4_t __a, int16x4_t __b) { int16x4_t __s = (__b << 8) >> 8, __n = -__s; uint16x4_t __l = __s >= 16 ? vdup_n_u16(0) : __a << (__s & 15); uint16x4_t __r = __s <= -16 ? vdup_n_u16(0) : __a >> (__n & 15); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint16x4_t vclz_u16(uint16x4_t __a) { uint16x4_t __v = (uint16x4_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; __v |= __v >> 8; return (uint16x4_t)(16 - vpaddl_u8(vcnt_u8((uint8x8_t)__v))); }
__BUN_CC_INTRIN uint16x4_t vrsra_n_u16(uint16x4_t __a, uint16x4_t __b, int __n) { return __a + vrshr_n_u16(__b, __n); }
__BUN_CC_INTRIN uint16x8_t vshlq_u16(uint16x8_t __a, int16x8_t __b) { int16x8_t __s = (__b << 8) >> 8, __n = -__s; uint16x8_t __l = __s >= 16 ? vdupq_n_u16(0) : __a << (__s & 15); uint16x8_t __r = __s <= -16 ? vdupq_n_u16(0) : __a >> (__n & 15); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint16x8_t vclzq_u16(uint16x8_t __a) { uint16x8_t __v = (uint16x8_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; __v |= __v >> 8; return (uint16x8_t)(16 - vpaddlq_u8(vcntq_u8((uint8x16_t)__v))); }
__BUN_CC_INTRIN uint16x8_t vrsraq_n_u16(uint16x8_t __a, uint16x8_t __b, int __n) { return __a + vrshrq_n_u16(__b, __n); }
__BUN_CC_INTRIN int32x2_t vshl_s32(int32x2_t __a, int32x2_t __b) { int32x2_t __s = (__b << 24) >> 24, __n = -__s; int32x2_t __l = __s >= 32 ? vdup_n_s32(0) : __a << (__s & 31); int32x2_t __r = __s <= -32 ? (__a >> 31) : __a >> (__n & 31); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN int32x2_t vclz_s32(int32x2_t __a) { uint32x2_t __v = (uint32x2_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; __v |= __v >> 8; __v |= __v >> 16; return (int32x2_t)(32 - vpaddl_u16(vpaddl_u8(vcnt_u8((uint8x8_t)__v)))); }
__BUN_CC_INTRIN uint32x2_t vcltz_s32(int32x2_t __a) { return (uint32x2_t)(__a < 0); }
__BUN_CC_INTRIN uint32x2_t vcgtz_s32(int32x2_t __a) { return (uint32x2_t)(__a > 0); }
__BUN_CC_INTRIN uint32x2_t vclez_s32(int32x2_t __a) { return (uint32x2_t)(__a <= 0); }
__BUN_CC_INTRIN uint32x2_t vcgez_s32(int32x2_t __a) { return (uint32x2_t)(__a >= 0); }
__BUN_CC_INTRIN int32x2_t vqadd_s32(int32x2_t __a, int32x2_t __b) { int32x2_t __r = __a + __b; int32x2_t __o = (~(__a ^ __b) & (__a ^ __r)) < 0; return __o ? (__a < 0 ? vdup_n_s32((-2147483647 - 1)) : vdup_n_s32(2147483647)) : __r; }
__BUN_CC_INTRIN int32x2_t vqsub_s32(int32x2_t __a, int32x2_t __b) { int32x2_t __r = __a - __b; int32x2_t __o = ((__a ^ __b) & (__a ^ __r)) < 0; return __o ? (__a < 0 ? vdup_n_s32((-2147483647 - 1)) : vdup_n_s32(2147483647)) : __r; }
__BUN_CC_INTRIN int32x2_t vrsra_n_s32(int32x2_t __a, int32x2_t __b, int __n) { return __a + vrshr_n_s32(__b, __n); }
__BUN_CC_INTRIN uint32x2_t vqshlu_n_s32(int32x2_t __a, int __n) { uint32x2_t __u = (uint32x2_t)__a; uint32x2_t __r = __n == 0 ? __u : ((__u >> (32 - __n)) != 0 ? ~vdup_n_u32(0) : __u << __n); return __a < 0 ? vdup_n_u32(0) : __r; }
__BUN_CC_INTRIN int32x4_t vshlq_s32(int32x4_t __a, int32x4_t __b) { int32x4_t __s = (__b << 24) >> 24, __n = -__s; int32x4_t __l = __s >= 32 ? vdupq_n_s32(0) : __a << (__s & 31); int32x4_t __r = __s <= -32 ? (__a >> 31) : __a >> (__n & 31); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN int32x4_t vclzq_s32(int32x4_t __a) { uint32x4_t __v = (uint32x4_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; __v |= __v >> 8; __v |= __v >> 16; return (int32x4_t)(32 - vpaddlq_u16(vpaddlq_u8(vcntq_u8((uint8x16_t)__v)))); }
__BUN_CC_INTRIN uint32x4_t vcltzq_s32(int32x4_t __a) { return (uint32x4_t)(__a < 0); }
__BUN_CC_INTRIN uint32x4_t vcgtzq_s32(int32x4_t __a) { return (uint32x4_t)(__a > 0); }
__BUN_CC_INTRIN uint32x4_t vclezq_s32(int32x4_t __a) { return (uint32x4_t)(__a <= 0); }
__BUN_CC_INTRIN uint32x4_t vcgezq_s32(int32x4_t __a) { return (uint32x4_t)(__a >= 0); }
__BUN_CC_INTRIN int32x4_t vqaddq_s32(int32x4_t __a, int32x4_t __b) { int32x4_t __r = __a + __b; int32x4_t __o = (~(__a ^ __b) & (__a ^ __r)) < 0; return __o ? (__a < 0 ? vdupq_n_s32((-2147483647 - 1)) : vdupq_n_s32(2147483647)) : __r; }
__BUN_CC_INTRIN int32x4_t vqsubq_s32(int32x4_t __a, int32x4_t __b) { int32x4_t __r = __a - __b; int32x4_t __o = ((__a ^ __b) & (__a ^ __r)) < 0; return __o ? (__a < 0 ? vdupq_n_s32((-2147483647 - 1)) : vdupq_n_s32(2147483647)) : __r; }
__BUN_CC_INTRIN int32x4_t vrsraq_n_s32(int32x4_t __a, int32x4_t __b, int __n) { return __a + vrshrq_n_s32(__b, __n); }
__BUN_CC_INTRIN uint32x4_t vqshluq_n_s32(int32x4_t __a, int __n) { uint32x4_t __u = (uint32x4_t)__a; uint32x4_t __r = __n == 0 ? __u : ((__u >> (32 - __n)) != 0 ? ~vdupq_n_u32(0) : __u << __n); return __a < 0 ? vdupq_n_u32(0) : __r; }
__BUN_CC_INTRIN uint32x2_t vshl_u32(uint32x2_t __a, int32x2_t __b) { int32x2_t __s = (__b << 24) >> 24, __n = -__s; uint32x2_t __l = __s >= 32 ? vdup_n_u32(0) : __a << (__s & 31); uint32x2_t __r = __s <= -32 ? vdup_n_u32(0) : __a >> (__n & 31); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint32x2_t vclz_u32(uint32x2_t __a) { uint32x2_t __v = (uint32x2_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; __v |= __v >> 8; __v |= __v >> 16; return (uint32x2_t)(32 - vpaddl_u16(vpaddl_u8(vcnt_u8((uint8x8_t)__v)))); }
__BUN_CC_INTRIN uint32x2_t vqadd_u32(uint32x2_t __a, uint32x2_t __b) { uint32x2_t __r = __a + __b; return __r < __a ? ~vdup_n_u32(0) : __r; }
__BUN_CC_INTRIN uint32x2_t vqsub_u32(uint32x2_t __a, uint32x2_t __b) { return __a > __b ? __a - __b : vdup_n_u32(0); }
__BUN_CC_INTRIN uint32x2_t vrsra_n_u32(uint32x2_t __a, uint32x2_t __b, int __n) { return __a + vrshr_n_u32(__b, __n); }
__BUN_CC_INTRIN uint32x4_t vshlq_u32(uint32x4_t __a, int32x4_t __b) { int32x4_t __s = (__b << 24) >> 24, __n = -__s; uint32x4_t __l = __s >= 32 ? vdupq_n_u32(0) : __a << (__s & 31); uint32x4_t __r = __s <= -32 ? vdupq_n_u32(0) : __a >> (__n & 31); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint32x4_t vclzq_u32(uint32x4_t __a) { uint32x4_t __v = (uint32x4_t)__a; __v |= __v >> 1; __v |= __v >> 2; __v |= __v >> 4; __v |= __v >> 8; __v |= __v >> 16; return (uint32x4_t)(32 - vpaddlq_u16(vpaddlq_u8(vcntq_u8((uint8x16_t)__v)))); }
__BUN_CC_INTRIN uint32x4_t vqaddq_u32(uint32x4_t __a, uint32x4_t __b) { uint32x4_t __r = __a + __b; return __r < __a ? ~vdupq_n_u32(0) : __r; }
__BUN_CC_INTRIN uint32x4_t vqsubq_u32(uint32x4_t __a, uint32x4_t __b) { return __a > __b ? __a - __b : vdupq_n_u32(0); }
__BUN_CC_INTRIN uint32x4_t vrsraq_n_u32(uint32x4_t __a, uint32x4_t __b, int __n) { return __a + vrshrq_n_u32(__b, __n); }
__BUN_CC_INTRIN int64x1_t vshl_s64(int64x1_t __a, int64x1_t __b) { int64x1_t __s = (__b << 56) >> 56, __n = -__s; int64x1_t __l = __s >= 64 ? vdup_n_s64(0) : __a << (__s & 63); int64x1_t __r = __s <= -64 ? (__a >> 63) : __a >> (__n & 63); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint64x1_t vcltz_s64(int64x1_t __a) { return (uint64x1_t)(__a < 0); }
__BUN_CC_INTRIN uint64x1_t vcgtz_s64(int64x1_t __a) { return (uint64x1_t)(__a > 0); }
__BUN_CC_INTRIN uint64x1_t vclez_s64(int64x1_t __a) { return (uint64x1_t)(__a <= 0); }
__BUN_CC_INTRIN uint64x1_t vcgez_s64(int64x1_t __a) { return (uint64x1_t)(__a >= 0); }
__BUN_CC_INTRIN int64x1_t vqadd_s64(int64x1_t __a, int64x1_t __b) { int64x1_t __r = __a + __b; int64x1_t __o = (~(__a ^ __b) & (__a ^ __r)) < 0; return __o ? (__a < 0 ? vdup_n_s64((-9223372036854775807ll - 1)) : vdup_n_s64(9223372036854775807ll)) : __r; }
__BUN_CC_INTRIN int64x1_t vqsub_s64(int64x1_t __a, int64x1_t __b) { int64x1_t __r = __a - __b; int64x1_t __o = ((__a ^ __b) & (__a ^ __r)) < 0; return __o ? (__a < 0 ? vdup_n_s64((-9223372036854775807ll - 1)) : vdup_n_s64(9223372036854775807ll)) : __r; }
__BUN_CC_INTRIN int64x1_t vrsra_n_s64(int64x1_t __a, int64x1_t __b, int __n) { return __a + vrshr_n_s64(__b, __n); }
__BUN_CC_INTRIN uint64x1_t vqshlu_n_s64(int64x1_t __a, int __n) { uint64x1_t __u = (uint64x1_t)__a; uint64x1_t __r = __n == 0 ? __u : ((__u >> (64 - __n)) != 0 ? ~vdup_n_u64(0) : __u << __n); return __a < 0 ? vdup_n_u64(0) : __r; }
__BUN_CC_INTRIN int64x2_t vshlq_s64(int64x2_t __a, int64x2_t __b) { int64x2_t __s = (__b << 56) >> 56, __n = -__s; int64x2_t __l = __s >= 64 ? vdupq_n_s64(0) : __a << (__s & 63); int64x2_t __r = __s <= -64 ? (__a >> 63) : __a >> (__n & 63); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint64x2_t vcltzq_s64(int64x2_t __a) { return (uint64x2_t)(__a < 0); }
__BUN_CC_INTRIN uint64x2_t vcgtzq_s64(int64x2_t __a) { return (uint64x2_t)(__a > 0); }
__BUN_CC_INTRIN uint64x2_t vclezq_s64(int64x2_t __a) { return (uint64x2_t)(__a <= 0); }
__BUN_CC_INTRIN uint64x2_t vcgezq_s64(int64x2_t __a) { return (uint64x2_t)(__a >= 0); }
__BUN_CC_INTRIN int64x2_t vqaddq_s64(int64x2_t __a, int64x2_t __b) { int64x2_t __r = __a + __b; int64x2_t __o = (~(__a ^ __b) & (__a ^ __r)) < 0; return __o ? (__a < 0 ? vdupq_n_s64((-9223372036854775807ll - 1)) : vdupq_n_s64(9223372036854775807ll)) : __r; }
__BUN_CC_INTRIN int64x2_t vqsubq_s64(int64x2_t __a, int64x2_t __b) { int64x2_t __r = __a - __b; int64x2_t __o = ((__a ^ __b) & (__a ^ __r)) < 0; return __o ? (__a < 0 ? vdupq_n_s64((-9223372036854775807ll - 1)) : vdupq_n_s64(9223372036854775807ll)) : __r; }
__BUN_CC_INTRIN int64x2_t vrsraq_n_s64(int64x2_t __a, int64x2_t __b, int __n) { return __a + vrshrq_n_s64(__b, __n); }
__BUN_CC_INTRIN uint64x2_t vqshluq_n_s64(int64x2_t __a, int __n) { uint64x2_t __u = (uint64x2_t)__a; uint64x2_t __r = __n == 0 ? __u : ((__u >> (64 - __n)) != 0 ? ~vdupq_n_u64(0) : __u << __n); return __a < 0 ? vdupq_n_u64(0) : __r; }
__BUN_CC_INTRIN uint64x1_t vshl_u64(uint64x1_t __a, int64x1_t __b) { int64x1_t __s = (__b << 56) >> 56, __n = -__s; uint64x1_t __l = __s >= 64 ? vdup_n_u64(0) : __a << (__s & 63); uint64x1_t __r = __s <= -64 ? vdup_n_u64(0) : __a >> (__n & 63); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint64x1_t vqadd_u64(uint64x1_t __a, uint64x1_t __b) { uint64x1_t __r = __a + __b; return __r < __a ? ~vdup_n_u64(0) : __r; }
__BUN_CC_INTRIN uint64x1_t vqsub_u64(uint64x1_t __a, uint64x1_t __b) { return __a > __b ? __a - __b : vdup_n_u64(0); }
__BUN_CC_INTRIN uint64x1_t vrsra_n_u64(uint64x1_t __a, uint64x1_t __b, int __n) { return __a + vrshr_n_u64(__b, __n); }
__BUN_CC_INTRIN uint64x2_t vshlq_u64(uint64x2_t __a, int64x2_t __b) { int64x2_t __s = (__b << 56) >> 56, __n = -__s; uint64x2_t __l = __s >= 64 ? vdupq_n_u64(0) : __a << (__s & 63); uint64x2_t __r = __s <= -64 ? vdupq_n_u64(0) : __a >> (__n & 63); return __s >= 0 ? __l : __r; }
__BUN_CC_INTRIN uint64x2_t vqaddq_u64(uint64x2_t __a, uint64x2_t __b) { uint64x2_t __r = __a + __b; return __r < __a ? ~vdupq_n_u64(0) : __r; }
__BUN_CC_INTRIN uint64x2_t vqsubq_u64(uint64x2_t __a, uint64x2_t __b) { return __a > __b ? __a - __b : vdupq_n_u64(0); }
__BUN_CC_INTRIN uint64x2_t vrsraq_n_u64(uint64x2_t __a, uint64x2_t __b, int __n) { return __a + vrshrq_n_u64(__b, __n); }
__BUN_CC_INTRIN uint32x2_t vcltz_f32(float32x2_t __a) { return (uint32x2_t)(__a < 0); }
__BUN_CC_INTRIN uint32x2_t vcgtz_f32(float32x2_t __a) { return (uint32x2_t)(__a > 0); }
__BUN_CC_INTRIN uint32x2_t vclez_f32(float32x2_t __a) { return (uint32x2_t)(__a <= 0); }
__BUN_CC_INTRIN uint32x2_t vcgez_f32(float32x2_t __a) { return (uint32x2_t)(__a >= 0); }
__BUN_CC_INTRIN uint32x4_t vcltzq_f32(float32x4_t __a) { return (uint32x4_t)(__a < 0); }
__BUN_CC_INTRIN uint32x4_t vcgtzq_f32(float32x4_t __a) { return (uint32x4_t)(__a > 0); }
__BUN_CC_INTRIN uint32x4_t vclezq_f32(float32x4_t __a) { return (uint32x4_t)(__a <= 0); }
__BUN_CC_INTRIN uint32x4_t vcgezq_f32(float32x4_t __a) { return (uint32x4_t)(__a >= 0); }
__BUN_CC_INTRIN uint64x1_t vcltz_f64(float64x1_t __a) { return (uint64x1_t)(__a < 0); }
__BUN_CC_INTRIN uint64x1_t vcgtz_f64(float64x1_t __a) { return (uint64x1_t)(__a > 0); }
__BUN_CC_INTRIN uint64x1_t vclez_f64(float64x1_t __a) { return (uint64x1_t)(__a <= 0); }
__BUN_CC_INTRIN uint64x1_t vcgez_f64(float64x1_t __a) { return (uint64x1_t)(__a >= 0); }
__BUN_CC_INTRIN uint64x2_t vcltzq_f64(float64x2_t __a) { return (uint64x2_t)(__a < 0); }
__BUN_CC_INTRIN uint64x2_t vcgtzq_f64(float64x2_t __a) { return (uint64x2_t)(__a > 0); }
__BUN_CC_INTRIN uint64x2_t vclezq_f64(float64x2_t __a) { return (uint64x2_t)(__a <= 0); }
__BUN_CC_INTRIN uint64x2_t vcgezq_f64(float64x2_t __a) { return (uint64x2_t)(__a >= 0); }
__BUN_CC_INTRIN int8x8_t vqshrn_n_s16(int16x8_t __a, int __n) { return vqmovn_s16(vshrq_n_s16(__a, __n)); }
__BUN_CC_INTRIN int8x8_t vqrshrn_n_s16(int16x8_t __a, int __n) { return vqmovn_s16(vrshrq_n_s16(__a, __n)); }
__BUN_CC_INTRIN uint8x8_t vqshrun_n_s16(int16x8_t __a, int __n) { return vqmovun_s16(vshrq_n_s16(__a, __n)); }
__BUN_CC_INTRIN uint8x8_t vqrshrun_n_s16(int16x8_t __a, int __n) { return vqmovun_s16(vrshrq_n_s16(__a, __n)); }
__BUN_CC_INTRIN uint8x8_t vqshrn_n_u16(uint16x8_t __a, int __n) { return vqmovn_u16(vshrq_n_u16(__a, __n)); }
__BUN_CC_INTRIN uint8x8_t vqrshrn_n_u16(uint16x8_t __a, int __n) { return vqmovn_u16(vrshrq_n_u16(__a, __n)); }
__BUN_CC_INTRIN int16x4_t vqshrn_n_s32(int32x4_t __a, int __n) { return vqmovn_s32(vshrq_n_s32(__a, __n)); }
__BUN_CC_INTRIN int16x4_t vqrshrn_n_s32(int32x4_t __a, int __n) { return vqmovn_s32(vrshrq_n_s32(__a, __n)); }
__BUN_CC_INTRIN uint16x4_t vqshrun_n_s32(int32x4_t __a, int __n) { return vqmovun_s32(vshrq_n_s32(__a, __n)); }
__BUN_CC_INTRIN uint16x4_t vqrshrun_n_s32(int32x4_t __a, int __n) { return vqmovun_s32(vrshrq_n_s32(__a, __n)); }
__BUN_CC_INTRIN uint16x4_t vqshrn_n_u32(uint32x4_t __a, int __n) { return vqmovn_u32(vshrq_n_u32(__a, __n)); }
__BUN_CC_INTRIN uint16x4_t vqrshrn_n_u32(uint32x4_t __a, int __n) { return vqmovn_u32(vrshrq_n_u32(__a, __n)); }
__BUN_CC_INTRIN int32x2_t vqshrn_n_s64(int64x2_t __a, int __n) { return vqmovn_s64(vshrq_n_s64(__a, __n)); }
__BUN_CC_INTRIN int32x2_t vqrshrn_n_s64(int64x2_t __a, int __n) { return vqmovn_s64(vrshrq_n_s64(__a, __n)); }
__BUN_CC_INTRIN uint32x2_t vqshrun_n_s64(int64x2_t __a, int __n) { return vqmovun_s64(vshrq_n_s64(__a, __n)); }
__BUN_CC_INTRIN uint32x2_t vqrshrun_n_s64(int64x2_t __a, int __n) { return vqmovun_s64(vrshrq_n_s64(__a, __n)); }
__BUN_CC_INTRIN uint32x2_t vqshrn_n_u64(uint64x2_t __a, int __n) { return vqmovn_u64(vshrq_n_u64(__a, __n)); }
__BUN_CC_INTRIN uint32x2_t vqrshrn_n_u64(uint64x2_t __a, int __n) { return vqmovn_u64(vrshrq_n_u64(__a, __n)); }
__BUN_CC_INTRIN int16x4_t vqdmulh_s16(int16x4_t __a, int16x4_t __b) { return vqmovn_s32(vmull_s16(__a, __b) >> 15); }
__BUN_CC_INTRIN int16x4_t vqrdmulh_s16(int16x4_t __a, int16x4_t __b) { return vqmovn_s32((vmull_s16(__a, __b) + 16384) >> 15); }
__BUN_CC_INTRIN int16x8_t vqdmulhq_s16(int16x8_t __a, int16x8_t __b) { return vcombine_s16(vqdmulh_s16(vget_low_s16(__a), vget_low_s16(__b)), vqdmulh_s16(vget_high_s16(__a), vget_high_s16(__b))); }
__BUN_CC_INTRIN int16x8_t vqrdmulhq_s16(int16x8_t __a, int16x8_t __b) { return vcombine_s16(vqrdmulh_s16(vget_low_s16(__a), vget_low_s16(__b)), vqrdmulh_s16(vget_high_s16(__a), vget_high_s16(__b))); }
__BUN_CC_INTRIN int16x4_t vqdmulh_n_s16(int16x4_t __a, int16_t __b) { return vqdmulh_s16(__a, vdup_n_s16(__b)); }
__BUN_CC_INTRIN int16x8_t vqdmulhq_n_s16(int16x8_t __a, int16_t __b) { return vqdmulhq_s16(__a, vdupq_n_s16(__b)); }
#define vqdmulh_lane_s16(a, v, lane) vqdmulh_s16(a, vdup_lane_s16(v, lane))
#define vqdmulhq_lane_s16(a, v, lane) vqdmulhq_s16(a, vdupq_lane_s16(v, lane))
#define vqdmulh_laneq_s16(a, v, lane) vqdmulh_s16(a, vdup_laneq_s16(v, lane))
#define vqdmulhq_laneq_s16(a, v, lane) vqdmulhq_s16(a, vdupq_laneq_s16(v, lane))
__BUN_CC_INTRIN int16x4_t vqrdmulh_n_s16(int16x4_t __a, int16_t __b) { return vqrdmulh_s16(__a, vdup_n_s16(__b)); }
__BUN_CC_INTRIN int16x8_t vqrdmulhq_n_s16(int16x8_t __a, int16_t __b) { return vqrdmulhq_s16(__a, vdupq_n_s16(__b)); }
#define vqrdmulh_lane_s16(a, v, lane) vqrdmulh_s16(a, vdup_lane_s16(v, lane))
#define vqrdmulhq_lane_s16(a, v, lane) vqrdmulhq_s16(a, vdupq_lane_s16(v, lane))
#define vqrdmulh_laneq_s16(a, v, lane) vqrdmulh_s16(a, vdup_laneq_s16(v, lane))
#define vqrdmulhq_laneq_s16(a, v, lane) vqrdmulhq_s16(a, vdupq_laneq_s16(v, lane))
__BUN_CC_INTRIN int32x2_t vqdmulh_s32(int32x2_t __a, int32x2_t __b) { return vqmovn_s64(vmull_s32(__a, __b) >> 31); }
__BUN_CC_INTRIN int32x2_t vqrdmulh_s32(int32x2_t __a, int32x2_t __b) { return vqmovn_s64((vmull_s32(__a, __b) + 1073741824) >> 31); }
__BUN_CC_INTRIN int32x4_t vqdmulhq_s32(int32x4_t __a, int32x4_t __b) { return vcombine_s32(vqdmulh_s32(vget_low_s32(__a), vget_low_s32(__b)), vqdmulh_s32(vget_high_s32(__a), vget_high_s32(__b))); }
__BUN_CC_INTRIN int32x4_t vqrdmulhq_s32(int32x4_t __a, int32x4_t __b) { return vcombine_s32(vqrdmulh_s32(vget_low_s32(__a), vget_low_s32(__b)), vqrdmulh_s32(vget_high_s32(__a), vget_high_s32(__b))); }
__BUN_CC_INTRIN int32x2_t vqdmulh_n_s32(int32x2_t __a, int32_t __b) { return vqdmulh_s32(__a, vdup_n_s32(__b)); }
__BUN_CC_INTRIN int32x4_t vqdmulhq_n_s32(int32x4_t __a, int32_t __b) { return vqdmulhq_s32(__a, vdupq_n_s32(__b)); }
#define vqdmulh_lane_s32(a, v, lane) vqdmulh_s32(a, vdup_lane_s32(v, lane))
#define vqdmulhq_lane_s32(a, v, lane) vqdmulhq_s32(a, vdupq_lane_s32(v, lane))
#define vqdmulh_laneq_s32(a, v, lane) vqdmulh_s32(a, vdup_laneq_s32(v, lane))
#define vqdmulhq_laneq_s32(a, v, lane) vqdmulhq_s32(a, vdupq_laneq_s32(v, lane))
__BUN_CC_INTRIN int32x2_t vqrdmulh_n_s32(int32x2_t __a, int32_t __b) { return vqrdmulh_s32(__a, vdup_n_s32(__b)); }
__BUN_CC_INTRIN int32x4_t vqrdmulhq_n_s32(int32x4_t __a, int32_t __b) { return vqrdmulhq_s32(__a, vdupq_n_s32(__b)); }
#define vqrdmulh_lane_s32(a, v, lane) vqrdmulh_s32(a, vdup_lane_s32(v, lane))
#define vqrdmulhq_lane_s32(a, v, lane) vqrdmulhq_s32(a, vdupq_lane_s32(v, lane))
#define vqrdmulh_laneq_s32(a, v, lane) vqrdmulh_s32(a, vdup_laneq_s32(v, lane))
#define vqrdmulhq_laneq_s32(a, v, lane) vqrdmulhq_s32(a, vdupq_laneq_s32(v, lane))

/* One operand taken from a lane of a vector. */
#define vmul_lane_s16(a, v, lane) vmul_s16(a, vdup_lane_s16(v, lane))
#define vmulq_lane_s16(a, v, lane) vmulq_s16(a, vdupq_lane_s16(v, lane))
#define vmla_lane_s16(a, b, v, lane) vmla_s16(a, b, vdup_lane_s16(v, lane))
#define vmlaq_lane_s16(a, b, v, lane) vmlaq_s16(a, b, vdupq_lane_s16(v, lane))
#define vmls_lane_s16(a, b, v, lane) vmls_s16(a, b, vdup_lane_s16(v, lane))
#define vmlsq_lane_s16(a, b, v, lane) vmlsq_s16(a, b, vdupq_lane_s16(v, lane))
#define vmull_lane_s16(a, v, lane) vmull_s16(a, vdup_lane_s16(v, lane))
#define vmull_high_lane_s16(a, v, lane) vmull_high_s16(a, vdupq_lane_s16(v, lane))
#define vmlal_lane_s16(a, b, v, lane) vmlal_s16(a, b, vdup_lane_s16(v, lane))
#define vmlal_high_lane_s16(a, b, v, lane) vmlal_high_s16(a, b, vdupq_lane_s16(v, lane))
#define vmlsl_lane_s16(a, b, v, lane) vmlsl_s16(a, b, vdup_lane_s16(v, lane))
#define vmlsl_high_lane_s16(a, b, v, lane) vmlsl_high_s16(a, b, vdupq_lane_s16(v, lane))
#define vmul_laneq_s16(a, v, lane) vmul_s16(a, vdup_laneq_s16(v, lane))
#define vmulq_laneq_s16(a, v, lane) vmulq_s16(a, vdupq_laneq_s16(v, lane))
#define vmla_laneq_s16(a, b, v, lane) vmla_s16(a, b, vdup_laneq_s16(v, lane))
#define vmlaq_laneq_s16(a, b, v, lane) vmlaq_s16(a, b, vdupq_laneq_s16(v, lane))
#define vmls_laneq_s16(a, b, v, lane) vmls_s16(a, b, vdup_laneq_s16(v, lane))
#define vmlsq_laneq_s16(a, b, v, lane) vmlsq_s16(a, b, vdupq_laneq_s16(v, lane))
#define vmull_laneq_s16(a, v, lane) vmull_s16(a, vdup_laneq_s16(v, lane))
#define vmull_high_laneq_s16(a, v, lane) vmull_high_s16(a, vdupq_laneq_s16(v, lane))
#define vmlal_laneq_s16(a, b, v, lane) vmlal_s16(a, b, vdup_laneq_s16(v, lane))
#define vmlal_high_laneq_s16(a, b, v, lane) vmlal_high_s16(a, b, vdupq_laneq_s16(v, lane))
#define vmlsl_laneq_s16(a, b, v, lane) vmlsl_s16(a, b, vdup_laneq_s16(v, lane))
#define vmlsl_high_laneq_s16(a, b, v, lane) vmlsl_high_s16(a, b, vdupq_laneq_s16(v, lane))
__BUN_CC_INTRIN int32x4_t vmlsl_n_s16(int32x4_t __a, int16x4_t __b, int16_t __c) { return __a - vmull_n_s16(__b, __c); }
#define vmul_lane_u16(a, v, lane) vmul_u16(a, vdup_lane_u16(v, lane))
#define vmulq_lane_u16(a, v, lane) vmulq_u16(a, vdupq_lane_u16(v, lane))
#define vmla_lane_u16(a, b, v, lane) vmla_u16(a, b, vdup_lane_u16(v, lane))
#define vmlaq_lane_u16(a, b, v, lane) vmlaq_u16(a, b, vdupq_lane_u16(v, lane))
#define vmls_lane_u16(a, b, v, lane) vmls_u16(a, b, vdup_lane_u16(v, lane))
#define vmlsq_lane_u16(a, b, v, lane) vmlsq_u16(a, b, vdupq_lane_u16(v, lane))
#define vmull_lane_u16(a, v, lane) vmull_u16(a, vdup_lane_u16(v, lane))
#define vmull_high_lane_u16(a, v, lane) vmull_high_u16(a, vdupq_lane_u16(v, lane))
#define vmlal_lane_u16(a, b, v, lane) vmlal_u16(a, b, vdup_lane_u16(v, lane))
#define vmlal_high_lane_u16(a, b, v, lane) vmlal_high_u16(a, b, vdupq_lane_u16(v, lane))
#define vmlsl_lane_u16(a, b, v, lane) vmlsl_u16(a, b, vdup_lane_u16(v, lane))
#define vmlsl_high_lane_u16(a, b, v, lane) vmlsl_high_u16(a, b, vdupq_lane_u16(v, lane))
#define vmul_laneq_u16(a, v, lane) vmul_u16(a, vdup_laneq_u16(v, lane))
#define vmulq_laneq_u16(a, v, lane) vmulq_u16(a, vdupq_laneq_u16(v, lane))
#define vmla_laneq_u16(a, b, v, lane) vmla_u16(a, b, vdup_laneq_u16(v, lane))
#define vmlaq_laneq_u16(a, b, v, lane) vmlaq_u16(a, b, vdupq_laneq_u16(v, lane))
#define vmls_laneq_u16(a, b, v, lane) vmls_u16(a, b, vdup_laneq_u16(v, lane))
#define vmlsq_laneq_u16(a, b, v, lane) vmlsq_u16(a, b, vdupq_laneq_u16(v, lane))
#define vmull_laneq_u16(a, v, lane) vmull_u16(a, vdup_laneq_u16(v, lane))
#define vmull_high_laneq_u16(a, v, lane) vmull_high_u16(a, vdupq_laneq_u16(v, lane))
#define vmlal_laneq_u16(a, b, v, lane) vmlal_u16(a, b, vdup_laneq_u16(v, lane))
#define vmlal_high_laneq_u16(a, b, v, lane) vmlal_high_u16(a, b, vdupq_laneq_u16(v, lane))
#define vmlsl_laneq_u16(a, b, v, lane) vmlsl_u16(a, b, vdup_laneq_u16(v, lane))
#define vmlsl_high_laneq_u16(a, b, v, lane) vmlsl_high_u16(a, b, vdupq_laneq_u16(v, lane))
__BUN_CC_INTRIN uint32x4_t vmlsl_n_u16(uint32x4_t __a, uint16x4_t __b, uint16_t __c) { return __a - vmull_n_u16(__b, __c); }
#define vmul_lane_s32(a, v, lane) vmul_s32(a, vdup_lane_s32(v, lane))
#define vmulq_lane_s32(a, v, lane) vmulq_s32(a, vdupq_lane_s32(v, lane))
#define vmla_lane_s32(a, b, v, lane) vmla_s32(a, b, vdup_lane_s32(v, lane))
#define vmlaq_lane_s32(a, b, v, lane) vmlaq_s32(a, b, vdupq_lane_s32(v, lane))
#define vmls_lane_s32(a, b, v, lane) vmls_s32(a, b, vdup_lane_s32(v, lane))
#define vmlsq_lane_s32(a, b, v, lane) vmlsq_s32(a, b, vdupq_lane_s32(v, lane))
#define vmull_lane_s32(a, v, lane) vmull_s32(a, vdup_lane_s32(v, lane))
#define vmull_high_lane_s32(a, v, lane) vmull_high_s32(a, vdupq_lane_s32(v, lane))
#define vmlal_lane_s32(a, b, v, lane) vmlal_s32(a, b, vdup_lane_s32(v, lane))
#define vmlal_high_lane_s32(a, b, v, lane) vmlal_high_s32(a, b, vdupq_lane_s32(v, lane))
#define vmlsl_lane_s32(a, b, v, lane) vmlsl_s32(a, b, vdup_lane_s32(v, lane))
#define vmlsl_high_lane_s32(a, b, v, lane) vmlsl_high_s32(a, b, vdupq_lane_s32(v, lane))
#define vmul_laneq_s32(a, v, lane) vmul_s32(a, vdup_laneq_s32(v, lane))
#define vmulq_laneq_s32(a, v, lane) vmulq_s32(a, vdupq_laneq_s32(v, lane))
#define vmla_laneq_s32(a, b, v, lane) vmla_s32(a, b, vdup_laneq_s32(v, lane))
#define vmlaq_laneq_s32(a, b, v, lane) vmlaq_s32(a, b, vdupq_laneq_s32(v, lane))
#define vmls_laneq_s32(a, b, v, lane) vmls_s32(a, b, vdup_laneq_s32(v, lane))
#define vmlsq_laneq_s32(a, b, v, lane) vmlsq_s32(a, b, vdupq_laneq_s32(v, lane))
#define vmull_laneq_s32(a, v, lane) vmull_s32(a, vdup_laneq_s32(v, lane))
#define vmull_high_laneq_s32(a, v, lane) vmull_high_s32(a, vdupq_laneq_s32(v, lane))
#define vmlal_laneq_s32(a, b, v, lane) vmlal_s32(a, b, vdup_laneq_s32(v, lane))
#define vmlal_high_laneq_s32(a, b, v, lane) vmlal_high_s32(a, b, vdupq_laneq_s32(v, lane))
#define vmlsl_laneq_s32(a, b, v, lane) vmlsl_s32(a, b, vdup_laneq_s32(v, lane))
#define vmlsl_high_laneq_s32(a, b, v, lane) vmlsl_high_s32(a, b, vdupq_laneq_s32(v, lane))
__BUN_CC_INTRIN int64x2_t vmlsl_n_s32(int64x2_t __a, int32x2_t __b, int32_t __c) { return __a - vmull_n_s32(__b, __c); }
#define vmul_lane_u32(a, v, lane) vmul_u32(a, vdup_lane_u32(v, lane))
#define vmulq_lane_u32(a, v, lane) vmulq_u32(a, vdupq_lane_u32(v, lane))
#define vmla_lane_u32(a, b, v, lane) vmla_u32(a, b, vdup_lane_u32(v, lane))
#define vmlaq_lane_u32(a, b, v, lane) vmlaq_u32(a, b, vdupq_lane_u32(v, lane))
#define vmls_lane_u32(a, b, v, lane) vmls_u32(a, b, vdup_lane_u32(v, lane))
#define vmlsq_lane_u32(a, b, v, lane) vmlsq_u32(a, b, vdupq_lane_u32(v, lane))
#define vmull_lane_u32(a, v, lane) vmull_u32(a, vdup_lane_u32(v, lane))
#define vmull_high_lane_u32(a, v, lane) vmull_high_u32(a, vdupq_lane_u32(v, lane))
#define vmlal_lane_u32(a, b, v, lane) vmlal_u32(a, b, vdup_lane_u32(v, lane))
#define vmlal_high_lane_u32(a, b, v, lane) vmlal_high_u32(a, b, vdupq_lane_u32(v, lane))
#define vmlsl_lane_u32(a, b, v, lane) vmlsl_u32(a, b, vdup_lane_u32(v, lane))
#define vmlsl_high_lane_u32(a, b, v, lane) vmlsl_high_u32(a, b, vdupq_lane_u32(v, lane))
#define vmul_laneq_u32(a, v, lane) vmul_u32(a, vdup_laneq_u32(v, lane))
#define vmulq_laneq_u32(a, v, lane) vmulq_u32(a, vdupq_laneq_u32(v, lane))
#define vmla_laneq_u32(a, b, v, lane) vmla_u32(a, b, vdup_laneq_u32(v, lane))
#define vmlaq_laneq_u32(a, b, v, lane) vmlaq_u32(a, b, vdupq_laneq_u32(v, lane))
#define vmls_laneq_u32(a, b, v, lane) vmls_u32(a, b, vdup_laneq_u32(v, lane))
#define vmlsq_laneq_u32(a, b, v, lane) vmlsq_u32(a, b, vdupq_laneq_u32(v, lane))
#define vmull_laneq_u32(a, v, lane) vmull_u32(a, vdup_laneq_u32(v, lane))
#define vmull_high_laneq_u32(a, v, lane) vmull_high_u32(a, vdupq_laneq_u32(v, lane))
#define vmlal_laneq_u32(a, b, v, lane) vmlal_u32(a, b, vdup_laneq_u32(v, lane))
#define vmlal_high_laneq_u32(a, b, v, lane) vmlal_high_u32(a, b, vdupq_laneq_u32(v, lane))
#define vmlsl_laneq_u32(a, b, v, lane) vmlsl_u32(a, b, vdup_laneq_u32(v, lane))
#define vmlsl_high_laneq_u32(a, b, v, lane) vmlsl_high_u32(a, b, vdupq_laneq_u32(v, lane))
__BUN_CC_INTRIN uint64x2_t vmlsl_n_u32(uint64x2_t __a, uint32x2_t __b, uint32_t __c) { return __a - vmull_n_u32(__b, __c); }
#define vmul_lane_f32(a, v, lane) vmul_f32(a, vdup_lane_f32(v, lane))
#define vmulq_lane_f32(a, v, lane) vmulq_f32(a, vdupq_lane_f32(v, lane))
#define vmla_lane_f32(a, b, v, lane) vmla_f32(a, b, vdup_lane_f32(v, lane))
#define vmlaq_lane_f32(a, b, v, lane) vmlaq_f32(a, b, vdupq_lane_f32(v, lane))
#define vmls_lane_f32(a, b, v, lane) vmls_f32(a, b, vdup_lane_f32(v, lane))
#define vmlsq_lane_f32(a, b, v, lane) vmlsq_f32(a, b, vdupq_lane_f32(v, lane))
#define vmul_laneq_f32(a, v, lane) vmul_f32(a, vdup_laneq_f32(v, lane))
#define vmulq_laneq_f32(a, v, lane) vmulq_f32(a, vdupq_laneq_f32(v, lane))
#define vmla_laneq_f32(a, b, v, lane) vmla_f32(a, b, vdup_laneq_f32(v, lane))
#define vmlaq_laneq_f32(a, b, v, lane) vmlaq_f32(a, b, vdupq_laneq_f32(v, lane))
#define vmls_laneq_f32(a, b, v, lane) vmls_f32(a, b, vdup_laneq_f32(v, lane))
#define vmlsq_laneq_f32(a, b, v, lane) vmlsq_f32(a, b, vdupq_laneq_f32(v, lane))
#define vmul_lane_f64(a, v, lane) vmul_f64(a, vdup_lane_f64(v, lane))
#define vmulq_lane_f64(a, v, lane) vmulq_f64(a, vdupq_lane_f64(v, lane))
#define vmla_lane_f64(a, b, v, lane) vmla_f64(a, b, vdup_lane_f64(v, lane))
#define vmlaq_lane_f64(a, b, v, lane) vmlaq_f64(a, b, vdupq_lane_f64(v, lane))
#define vmls_lane_f64(a, b, v, lane) vmls_f64(a, b, vdup_lane_f64(v, lane))
#define vmlsq_lane_f64(a, b, v, lane) vmlsq_f64(a, b, vdupq_lane_f64(v, lane))
#define vmul_laneq_f64(a, v, lane) vmul_f64(a, vdup_laneq_f64(v, lane))
#define vmulq_laneq_f64(a, v, lane) vmulq_f64(a, vdupq_laneq_f64(v, lane))
#define vmla_laneq_f64(a, b, v, lane) vmla_f64(a, b, vdup_laneq_f64(v, lane))
#define vmlaq_laneq_f64(a, b, v, lane) vmlaq_f64(a, b, vdupq_laneq_f64(v, lane))
#define vmls_laneq_f64(a, b, v, lane) vmls_f64(a, b, vdup_laneq_f64(v, lane))
#define vmlsq_laneq_f64(a, b, v, lane) vmlsq_f64(a, b, vdupq_laneq_f64(v, lane))

/* Interleaved structures of three, of one lane, and of one element copied to every lane; wider tables. */
__BUN_CC_INTRIN int8x8x3_t vld3_s8(const int8_t *__p) { int8x8x3_t __v; for (int __i = 0; __i < 8; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3_s8(int8_t *__p, int8x8x3_t __v) { for (int __i = 0; __i < 8; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN int8x8x2_t vld2_dup_s8(const int8_t *__p) { return (int8x8x2_t){{vdup_n_s8(__p[0]), vdup_n_s8(__p[1])}}; }
#define vld2_lane_s8(p, v, lane) __extension__({ int8x8x2_t __bun_v = (v); const int8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_s8(p, v, lane) __extension__({ int8x8x2_t __bun_v = (v); int8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN int8x8x3_t vld3_dup_s8(const int8_t *__p) { return (int8x8x3_t){{vdup_n_s8(__p[0]), vdup_n_s8(__p[1]), vdup_n_s8(__p[2])}}; }
#define vld3_lane_s8(p, v, lane) __extension__({ int8x8x3_t __bun_v = (v); const int8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_s8(p, v, lane) __extension__({ int8x8x3_t __bun_v = (v); int8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN int8x8x4_t vld4_dup_s8(const int8_t *__p) { return (int8x8x4_t){{vdup_n_s8(__p[0]), vdup_n_s8(__p[1]), vdup_n_s8(__p[2]), vdup_n_s8(__p[3])}}; }
#define vld4_lane_s8(p, v, lane) __extension__({ int8x8x4_t __bun_v = (v); const int8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_s8(p, v, lane) __extension__({ int8x8x4_t __bun_v = (v); int8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN int8x16x3_t vld3q_s8(const int8_t *__p) { int8x16x3_t __v; for (int __i = 0; __i < 16; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_s8(int8_t *__p, int8x16x3_t __v) { for (int __i = 0; __i < 16; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN int8x16x2_t vld2q_dup_s8(const int8_t *__p) { return (int8x16x2_t){{vdupq_n_s8(__p[0]), vdupq_n_s8(__p[1])}}; }
#define vld2q_lane_s8(p, v, lane) __extension__({ int8x16x2_t __bun_v = (v); const int8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_s8(p, v, lane) __extension__({ int8x16x2_t __bun_v = (v); int8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN int8x16x3_t vld3q_dup_s8(const int8_t *__p) { return (int8x16x3_t){{vdupq_n_s8(__p[0]), vdupq_n_s8(__p[1]), vdupq_n_s8(__p[2])}}; }
#define vld3q_lane_s8(p, v, lane) __extension__({ int8x16x3_t __bun_v = (v); const int8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_s8(p, v, lane) __extension__({ int8x16x3_t __bun_v = (v); int8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN int8x16x4_t vld4q_dup_s8(const int8_t *__p) { return (int8x16x4_t){{vdupq_n_s8(__p[0]), vdupq_n_s8(__p[1]), vdupq_n_s8(__p[2]), vdupq_n_s8(__p[3])}}; }
#define vld4q_lane_s8(p, v, lane) __extension__({ int8x16x4_t __bun_v = (v); const int8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_s8(p, v, lane) __extension__({ int8x16x4_t __bun_v = (v); int8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN uint8x8x3_t vld3_u8(const uint8_t *__p) { uint8x8x3_t __v; for (int __i = 0; __i < 8; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3_u8(uint8_t *__p, uint8x8x3_t __v) { for (int __i = 0; __i < 8; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN uint8x8x2_t vld2_dup_u8(const uint8_t *__p) { return (uint8x8x2_t){{vdup_n_u8(__p[0]), vdup_n_u8(__p[1])}}; }
#define vld2_lane_u8(p, v, lane) __extension__({ uint8x8x2_t __bun_v = (v); const uint8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_u8(p, v, lane) __extension__({ uint8x8x2_t __bun_v = (v); uint8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN uint8x8x3_t vld3_dup_u8(const uint8_t *__p) { return (uint8x8x3_t){{vdup_n_u8(__p[0]), vdup_n_u8(__p[1]), vdup_n_u8(__p[2])}}; }
#define vld3_lane_u8(p, v, lane) __extension__({ uint8x8x3_t __bun_v = (v); const uint8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_u8(p, v, lane) __extension__({ uint8x8x3_t __bun_v = (v); uint8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN uint8x8x4_t vld4_dup_u8(const uint8_t *__p) { return (uint8x8x4_t){{vdup_n_u8(__p[0]), vdup_n_u8(__p[1]), vdup_n_u8(__p[2]), vdup_n_u8(__p[3])}}; }
#define vld4_lane_u8(p, v, lane) __extension__({ uint8x8x4_t __bun_v = (v); const uint8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_u8(p, v, lane) __extension__({ uint8x8x4_t __bun_v = (v); uint8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN uint8x16x3_t vld3q_u8(const uint8_t *__p) { uint8x16x3_t __v; for (int __i = 0; __i < 16; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_u8(uint8_t *__p, uint8x16x3_t __v) { for (int __i = 0; __i < 16; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN uint8x16x2_t vld2q_dup_u8(const uint8_t *__p) { return (uint8x16x2_t){{vdupq_n_u8(__p[0]), vdupq_n_u8(__p[1])}}; }
#define vld2q_lane_u8(p, v, lane) __extension__({ uint8x16x2_t __bun_v = (v); const uint8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_u8(p, v, lane) __extension__({ uint8x16x2_t __bun_v = (v); uint8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN uint8x16x3_t vld3q_dup_u8(const uint8_t *__p) { return (uint8x16x3_t){{vdupq_n_u8(__p[0]), vdupq_n_u8(__p[1]), vdupq_n_u8(__p[2])}}; }
#define vld3q_lane_u8(p, v, lane) __extension__({ uint8x16x3_t __bun_v = (v); const uint8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_u8(p, v, lane) __extension__({ uint8x16x3_t __bun_v = (v); uint8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN uint8x16x4_t vld4q_dup_u8(const uint8_t *__p) { return (uint8x16x4_t){{vdupq_n_u8(__p[0]), vdupq_n_u8(__p[1]), vdupq_n_u8(__p[2]), vdupq_n_u8(__p[3])}}; }
#define vld4q_lane_u8(p, v, lane) __extension__({ uint8x16x4_t __bun_v = (v); const uint8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_u8(p, v, lane) __extension__({ uint8x16x4_t __bun_v = (v); uint8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN int16x4x3_t vld3_s16(const int16_t *__p) { int16x4x3_t __v; for (int __i = 0; __i < 4; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3_s16(int16_t *__p, int16x4x3_t __v) { for (int __i = 0; __i < 4; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN int16x4x2_t vld2_dup_s16(const int16_t *__p) { return (int16x4x2_t){{vdup_n_s16(__p[0]), vdup_n_s16(__p[1])}}; }
#define vld2_lane_s16(p, v, lane) __extension__({ int16x4x2_t __bun_v = (v); const int16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_s16(p, v, lane) __extension__({ int16x4x2_t __bun_v = (v); int16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN int16x4x3_t vld3_dup_s16(const int16_t *__p) { return (int16x4x3_t){{vdup_n_s16(__p[0]), vdup_n_s16(__p[1]), vdup_n_s16(__p[2])}}; }
#define vld3_lane_s16(p, v, lane) __extension__({ int16x4x3_t __bun_v = (v); const int16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_s16(p, v, lane) __extension__({ int16x4x3_t __bun_v = (v); int16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN int16x4x4_t vld4_dup_s16(const int16_t *__p) { return (int16x4x4_t){{vdup_n_s16(__p[0]), vdup_n_s16(__p[1]), vdup_n_s16(__p[2]), vdup_n_s16(__p[3])}}; }
#define vld4_lane_s16(p, v, lane) __extension__({ int16x4x4_t __bun_v = (v); const int16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_s16(p, v, lane) __extension__({ int16x4x4_t __bun_v = (v); int16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN int16x8x3_t vld3q_s16(const int16_t *__p) { int16x8x3_t __v; for (int __i = 0; __i < 8; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_s16(int16_t *__p, int16x8x3_t __v) { for (int __i = 0; __i < 8; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN int16x8x2_t vld2q_dup_s16(const int16_t *__p) { return (int16x8x2_t){{vdupq_n_s16(__p[0]), vdupq_n_s16(__p[1])}}; }
#define vld2q_lane_s16(p, v, lane) __extension__({ int16x8x2_t __bun_v = (v); const int16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_s16(p, v, lane) __extension__({ int16x8x2_t __bun_v = (v); int16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN int16x8x3_t vld3q_dup_s16(const int16_t *__p) { return (int16x8x3_t){{vdupq_n_s16(__p[0]), vdupq_n_s16(__p[1]), vdupq_n_s16(__p[2])}}; }
#define vld3q_lane_s16(p, v, lane) __extension__({ int16x8x3_t __bun_v = (v); const int16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_s16(p, v, lane) __extension__({ int16x8x3_t __bun_v = (v); int16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN int16x8x4_t vld4q_dup_s16(const int16_t *__p) { return (int16x8x4_t){{vdupq_n_s16(__p[0]), vdupq_n_s16(__p[1]), vdupq_n_s16(__p[2]), vdupq_n_s16(__p[3])}}; }
#define vld4q_lane_s16(p, v, lane) __extension__({ int16x8x4_t __bun_v = (v); const int16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_s16(p, v, lane) __extension__({ int16x8x4_t __bun_v = (v); int16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN uint16x4x3_t vld3_u16(const uint16_t *__p) { uint16x4x3_t __v; for (int __i = 0; __i < 4; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3_u16(uint16_t *__p, uint16x4x3_t __v) { for (int __i = 0; __i < 4; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN uint16x4x2_t vld2_dup_u16(const uint16_t *__p) { return (uint16x4x2_t){{vdup_n_u16(__p[0]), vdup_n_u16(__p[1])}}; }
#define vld2_lane_u16(p, v, lane) __extension__({ uint16x4x2_t __bun_v = (v); const uint16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_u16(p, v, lane) __extension__({ uint16x4x2_t __bun_v = (v); uint16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN uint16x4x3_t vld3_dup_u16(const uint16_t *__p) { return (uint16x4x3_t){{vdup_n_u16(__p[0]), vdup_n_u16(__p[1]), vdup_n_u16(__p[2])}}; }
#define vld3_lane_u16(p, v, lane) __extension__({ uint16x4x3_t __bun_v = (v); const uint16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_u16(p, v, lane) __extension__({ uint16x4x3_t __bun_v = (v); uint16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN uint16x4x4_t vld4_dup_u16(const uint16_t *__p) { return (uint16x4x4_t){{vdup_n_u16(__p[0]), vdup_n_u16(__p[1]), vdup_n_u16(__p[2]), vdup_n_u16(__p[3])}}; }
#define vld4_lane_u16(p, v, lane) __extension__({ uint16x4x4_t __bun_v = (v); const uint16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_u16(p, v, lane) __extension__({ uint16x4x4_t __bun_v = (v); uint16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN uint16x8x3_t vld3q_u16(const uint16_t *__p) { uint16x8x3_t __v; for (int __i = 0; __i < 8; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_u16(uint16_t *__p, uint16x8x3_t __v) { for (int __i = 0; __i < 8; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN uint16x8x2_t vld2q_dup_u16(const uint16_t *__p) { return (uint16x8x2_t){{vdupq_n_u16(__p[0]), vdupq_n_u16(__p[1])}}; }
#define vld2q_lane_u16(p, v, lane) __extension__({ uint16x8x2_t __bun_v = (v); const uint16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_u16(p, v, lane) __extension__({ uint16x8x2_t __bun_v = (v); uint16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN uint16x8x3_t vld3q_dup_u16(const uint16_t *__p) { return (uint16x8x3_t){{vdupq_n_u16(__p[0]), vdupq_n_u16(__p[1]), vdupq_n_u16(__p[2])}}; }
#define vld3q_lane_u16(p, v, lane) __extension__({ uint16x8x3_t __bun_v = (v); const uint16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_u16(p, v, lane) __extension__({ uint16x8x3_t __bun_v = (v); uint16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN uint16x8x4_t vld4q_dup_u16(const uint16_t *__p) { return (uint16x8x4_t){{vdupq_n_u16(__p[0]), vdupq_n_u16(__p[1]), vdupq_n_u16(__p[2]), vdupq_n_u16(__p[3])}}; }
#define vld4q_lane_u16(p, v, lane) __extension__({ uint16x8x4_t __bun_v = (v); const uint16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_u16(p, v, lane) __extension__({ uint16x8x4_t __bun_v = (v); uint16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN int32x2x3_t vld3_s32(const int32_t *__p) { int32x2x3_t __v; for (int __i = 0; __i < 2; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3_s32(int32_t *__p, int32x2x3_t __v) { for (int __i = 0; __i < 2; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN int32x2x2_t vld2_dup_s32(const int32_t *__p) { return (int32x2x2_t){{vdup_n_s32(__p[0]), vdup_n_s32(__p[1])}}; }
#define vld2_lane_s32(p, v, lane) __extension__({ int32x2x2_t __bun_v = (v); const int32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_s32(p, v, lane) __extension__({ int32x2x2_t __bun_v = (v); int32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN int32x2x3_t vld3_dup_s32(const int32_t *__p) { return (int32x2x3_t){{vdup_n_s32(__p[0]), vdup_n_s32(__p[1]), vdup_n_s32(__p[2])}}; }
#define vld3_lane_s32(p, v, lane) __extension__({ int32x2x3_t __bun_v = (v); const int32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_s32(p, v, lane) __extension__({ int32x2x3_t __bun_v = (v); int32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN int32x2x4_t vld4_dup_s32(const int32_t *__p) { return (int32x2x4_t){{vdup_n_s32(__p[0]), vdup_n_s32(__p[1]), vdup_n_s32(__p[2]), vdup_n_s32(__p[3])}}; }
#define vld4_lane_s32(p, v, lane) __extension__({ int32x2x4_t __bun_v = (v); const int32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_s32(p, v, lane) __extension__({ int32x2x4_t __bun_v = (v); int32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN int32x4x3_t vld3q_s32(const int32_t *__p) { int32x4x3_t __v; for (int __i = 0; __i < 4; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_s32(int32_t *__p, int32x4x3_t __v) { for (int __i = 0; __i < 4; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN int32x4x2_t vld2q_dup_s32(const int32_t *__p) { return (int32x4x2_t){{vdupq_n_s32(__p[0]), vdupq_n_s32(__p[1])}}; }
#define vld2q_lane_s32(p, v, lane) __extension__({ int32x4x2_t __bun_v = (v); const int32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_s32(p, v, lane) __extension__({ int32x4x2_t __bun_v = (v); int32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN int32x4x3_t vld3q_dup_s32(const int32_t *__p) { return (int32x4x3_t){{vdupq_n_s32(__p[0]), vdupq_n_s32(__p[1]), vdupq_n_s32(__p[2])}}; }
#define vld3q_lane_s32(p, v, lane) __extension__({ int32x4x3_t __bun_v = (v); const int32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_s32(p, v, lane) __extension__({ int32x4x3_t __bun_v = (v); int32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN int32x4x4_t vld4q_dup_s32(const int32_t *__p) { return (int32x4x4_t){{vdupq_n_s32(__p[0]), vdupq_n_s32(__p[1]), vdupq_n_s32(__p[2]), vdupq_n_s32(__p[3])}}; }
#define vld4q_lane_s32(p, v, lane) __extension__({ int32x4x4_t __bun_v = (v); const int32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_s32(p, v, lane) __extension__({ int32x4x4_t __bun_v = (v); int32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN uint32x2x3_t vld3_u32(const uint32_t *__p) { uint32x2x3_t __v; for (int __i = 0; __i < 2; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3_u32(uint32_t *__p, uint32x2x3_t __v) { for (int __i = 0; __i < 2; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN uint32x2x2_t vld2_dup_u32(const uint32_t *__p) { return (uint32x2x2_t){{vdup_n_u32(__p[0]), vdup_n_u32(__p[1])}}; }
#define vld2_lane_u32(p, v, lane) __extension__({ uint32x2x2_t __bun_v = (v); const uint32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_u32(p, v, lane) __extension__({ uint32x2x2_t __bun_v = (v); uint32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN uint32x2x3_t vld3_dup_u32(const uint32_t *__p) { return (uint32x2x3_t){{vdup_n_u32(__p[0]), vdup_n_u32(__p[1]), vdup_n_u32(__p[2])}}; }
#define vld3_lane_u32(p, v, lane) __extension__({ uint32x2x3_t __bun_v = (v); const uint32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_u32(p, v, lane) __extension__({ uint32x2x3_t __bun_v = (v); uint32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN uint32x2x4_t vld4_dup_u32(const uint32_t *__p) { return (uint32x2x4_t){{vdup_n_u32(__p[0]), vdup_n_u32(__p[1]), vdup_n_u32(__p[2]), vdup_n_u32(__p[3])}}; }
#define vld4_lane_u32(p, v, lane) __extension__({ uint32x2x4_t __bun_v = (v); const uint32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_u32(p, v, lane) __extension__({ uint32x2x4_t __bun_v = (v); uint32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN uint32x4x3_t vld3q_u32(const uint32_t *__p) { uint32x4x3_t __v; for (int __i = 0; __i < 4; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_u32(uint32_t *__p, uint32x4x3_t __v) { for (int __i = 0; __i < 4; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN uint32x4x2_t vld2q_dup_u32(const uint32_t *__p) { return (uint32x4x2_t){{vdupq_n_u32(__p[0]), vdupq_n_u32(__p[1])}}; }
#define vld2q_lane_u32(p, v, lane) __extension__({ uint32x4x2_t __bun_v = (v); const uint32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_u32(p, v, lane) __extension__({ uint32x4x2_t __bun_v = (v); uint32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN uint32x4x3_t vld3q_dup_u32(const uint32_t *__p) { return (uint32x4x3_t){{vdupq_n_u32(__p[0]), vdupq_n_u32(__p[1]), vdupq_n_u32(__p[2])}}; }
#define vld3q_lane_u32(p, v, lane) __extension__({ uint32x4x3_t __bun_v = (v); const uint32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_u32(p, v, lane) __extension__({ uint32x4x3_t __bun_v = (v); uint32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN uint32x4x4_t vld4q_dup_u32(const uint32_t *__p) { return (uint32x4x4_t){{vdupq_n_u32(__p[0]), vdupq_n_u32(__p[1]), vdupq_n_u32(__p[2]), vdupq_n_u32(__p[3])}}; }
#define vld4q_lane_u32(p, v, lane) __extension__({ uint32x4x4_t __bun_v = (v); const uint32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_u32(p, v, lane) __extension__({ uint32x4x4_t __bun_v = (v); uint32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN int64x1x2_t vld2_dup_s64(const int64_t *__p) { return (int64x1x2_t){{vdup_n_s64(__p[0]), vdup_n_s64(__p[1])}}; }
#define vld2_lane_s64(p, v, lane) __extension__({ int64x1x2_t __bun_v = (v); const int64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_s64(p, v, lane) __extension__({ int64x1x2_t __bun_v = (v); int64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN int64x1x3_t vld3_dup_s64(const int64_t *__p) { return (int64x1x3_t){{vdup_n_s64(__p[0]), vdup_n_s64(__p[1]), vdup_n_s64(__p[2])}}; }
#define vld3_lane_s64(p, v, lane) __extension__({ int64x1x3_t __bun_v = (v); const int64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_s64(p, v, lane) __extension__({ int64x1x3_t __bun_v = (v); int64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN int64x1x4_t vld4_dup_s64(const int64_t *__p) { return (int64x1x4_t){{vdup_n_s64(__p[0]), vdup_n_s64(__p[1]), vdup_n_s64(__p[2]), vdup_n_s64(__p[3])}}; }
#define vld4_lane_s64(p, v, lane) __extension__({ int64x1x4_t __bun_v = (v); const int64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_s64(p, v, lane) __extension__({ int64x1x4_t __bun_v = (v); int64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN int64x2x3_t vld3q_s64(const int64_t *__p) { int64x2x3_t __v; for (int __i = 0; __i < 2; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_s64(int64_t *__p, int64x2x3_t __v) { for (int __i = 0; __i < 2; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN int64x2x2_t vld2q_dup_s64(const int64_t *__p) { return (int64x2x2_t){{vdupq_n_s64(__p[0]), vdupq_n_s64(__p[1])}}; }
#define vld2q_lane_s64(p, v, lane) __extension__({ int64x2x2_t __bun_v = (v); const int64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_s64(p, v, lane) __extension__({ int64x2x2_t __bun_v = (v); int64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN int64x2x3_t vld3q_dup_s64(const int64_t *__p) { return (int64x2x3_t){{vdupq_n_s64(__p[0]), vdupq_n_s64(__p[1]), vdupq_n_s64(__p[2])}}; }
#define vld3q_lane_s64(p, v, lane) __extension__({ int64x2x3_t __bun_v = (v); const int64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_s64(p, v, lane) __extension__({ int64x2x3_t __bun_v = (v); int64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN int64x2x4_t vld4q_dup_s64(const int64_t *__p) { return (int64x2x4_t){{vdupq_n_s64(__p[0]), vdupq_n_s64(__p[1]), vdupq_n_s64(__p[2]), vdupq_n_s64(__p[3])}}; }
#define vld4q_lane_s64(p, v, lane) __extension__({ int64x2x4_t __bun_v = (v); const int64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_s64(p, v, lane) __extension__({ int64x2x4_t __bun_v = (v); int64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN uint64x1x2_t vld2_dup_u64(const uint64_t *__p) { return (uint64x1x2_t){{vdup_n_u64(__p[0]), vdup_n_u64(__p[1])}}; }
#define vld2_lane_u64(p, v, lane) __extension__({ uint64x1x2_t __bun_v = (v); const uint64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_u64(p, v, lane) __extension__({ uint64x1x2_t __bun_v = (v); uint64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN uint64x1x3_t vld3_dup_u64(const uint64_t *__p) { return (uint64x1x3_t){{vdup_n_u64(__p[0]), vdup_n_u64(__p[1]), vdup_n_u64(__p[2])}}; }
#define vld3_lane_u64(p, v, lane) __extension__({ uint64x1x3_t __bun_v = (v); const uint64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_u64(p, v, lane) __extension__({ uint64x1x3_t __bun_v = (v); uint64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN uint64x1x4_t vld4_dup_u64(const uint64_t *__p) { return (uint64x1x4_t){{vdup_n_u64(__p[0]), vdup_n_u64(__p[1]), vdup_n_u64(__p[2]), vdup_n_u64(__p[3])}}; }
#define vld4_lane_u64(p, v, lane) __extension__({ uint64x1x4_t __bun_v = (v); const uint64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_u64(p, v, lane) __extension__({ uint64x1x4_t __bun_v = (v); uint64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN uint64x2x3_t vld3q_u64(const uint64_t *__p) { uint64x2x3_t __v; for (int __i = 0; __i < 2; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_u64(uint64_t *__p, uint64x2x3_t __v) { for (int __i = 0; __i < 2; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN uint64x2x2_t vld2q_dup_u64(const uint64_t *__p) { return (uint64x2x2_t){{vdupq_n_u64(__p[0]), vdupq_n_u64(__p[1])}}; }
#define vld2q_lane_u64(p, v, lane) __extension__({ uint64x2x2_t __bun_v = (v); const uint64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_u64(p, v, lane) __extension__({ uint64x2x2_t __bun_v = (v); uint64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN uint64x2x3_t vld3q_dup_u64(const uint64_t *__p) { return (uint64x2x3_t){{vdupq_n_u64(__p[0]), vdupq_n_u64(__p[1]), vdupq_n_u64(__p[2])}}; }
#define vld3q_lane_u64(p, v, lane) __extension__({ uint64x2x3_t __bun_v = (v); const uint64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_u64(p, v, lane) __extension__({ uint64x2x3_t __bun_v = (v); uint64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN uint64x2x4_t vld4q_dup_u64(const uint64_t *__p) { return (uint64x2x4_t){{vdupq_n_u64(__p[0]), vdupq_n_u64(__p[1]), vdupq_n_u64(__p[2]), vdupq_n_u64(__p[3])}}; }
#define vld4q_lane_u64(p, v, lane) __extension__({ uint64x2x4_t __bun_v = (v); const uint64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_u64(p, v, lane) __extension__({ uint64x2x4_t __bun_v = (v); uint64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN float32x2x3_t vld3_f32(const float32_t *__p) { float32x2x3_t __v; for (int __i = 0; __i < 2; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3_f32(float32_t *__p, float32x2x3_t __v) { for (int __i = 0; __i < 2; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN float32x2x2_t vld2_dup_f32(const float32_t *__p) { return (float32x2x2_t){{vdup_n_f32(__p[0]), vdup_n_f32(__p[1])}}; }
#define vld2_lane_f32(p, v, lane) __extension__({ float32x2x2_t __bun_v = (v); const float32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_f32(p, v, lane) __extension__({ float32x2x2_t __bun_v = (v); float32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN float32x2x3_t vld3_dup_f32(const float32_t *__p) { return (float32x2x3_t){{vdup_n_f32(__p[0]), vdup_n_f32(__p[1]), vdup_n_f32(__p[2])}}; }
#define vld3_lane_f32(p, v, lane) __extension__({ float32x2x3_t __bun_v = (v); const float32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_f32(p, v, lane) __extension__({ float32x2x3_t __bun_v = (v); float32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN float32x2x4_t vld4_dup_f32(const float32_t *__p) { return (float32x2x4_t){{vdup_n_f32(__p[0]), vdup_n_f32(__p[1]), vdup_n_f32(__p[2]), vdup_n_f32(__p[3])}}; }
#define vld4_lane_f32(p, v, lane) __extension__({ float32x2x4_t __bun_v = (v); const float32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_f32(p, v, lane) __extension__({ float32x2x4_t __bun_v = (v); float32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN float32x4x3_t vld3q_f32(const float32_t *__p) { float32x4x3_t __v; for (int __i = 0; __i < 4; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_f32(float32_t *__p, float32x4x3_t __v) { for (int __i = 0; __i < 4; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN float32x4x2_t vld2q_dup_f32(const float32_t *__p) { return (float32x4x2_t){{vdupq_n_f32(__p[0]), vdupq_n_f32(__p[1])}}; }
#define vld2q_lane_f32(p, v, lane) __extension__({ float32x4x2_t __bun_v = (v); const float32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_f32(p, v, lane) __extension__({ float32x4x2_t __bun_v = (v); float32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN float32x4x3_t vld3q_dup_f32(const float32_t *__p) { return (float32x4x3_t){{vdupq_n_f32(__p[0]), vdupq_n_f32(__p[1]), vdupq_n_f32(__p[2])}}; }
#define vld3q_lane_f32(p, v, lane) __extension__({ float32x4x3_t __bun_v = (v); const float32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_f32(p, v, lane) __extension__({ float32x4x3_t __bun_v = (v); float32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN float32x4x4_t vld4q_dup_f32(const float32_t *__p) { return (float32x4x4_t){{vdupq_n_f32(__p[0]), vdupq_n_f32(__p[1]), vdupq_n_f32(__p[2]), vdupq_n_f32(__p[3])}}; }
#define vld4q_lane_f32(p, v, lane) __extension__({ float32x4x4_t __bun_v = (v); const float32_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_f32(p, v, lane) __extension__({ float32x4x4_t __bun_v = (v); float32_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN float64x1x2_t vld2_dup_f64(const float64_t *__p) { return (float64x1x2_t){{vdup_n_f64(__p[0]), vdup_n_f64(__p[1])}}; }
#define vld2_lane_f64(p, v, lane) __extension__({ float64x1x2_t __bun_v = (v); const float64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_f64(p, v, lane) __extension__({ float64x1x2_t __bun_v = (v); float64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN float64x1x3_t vld3_dup_f64(const float64_t *__p) { return (float64x1x3_t){{vdup_n_f64(__p[0]), vdup_n_f64(__p[1]), vdup_n_f64(__p[2])}}; }
#define vld3_lane_f64(p, v, lane) __extension__({ float64x1x3_t __bun_v = (v); const float64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_f64(p, v, lane) __extension__({ float64x1x3_t __bun_v = (v); float64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN float64x1x4_t vld4_dup_f64(const float64_t *__p) { return (float64x1x4_t){{vdup_n_f64(__p[0]), vdup_n_f64(__p[1]), vdup_n_f64(__p[2]), vdup_n_f64(__p[3])}}; }
#define vld4_lane_f64(p, v, lane) __extension__({ float64x1x4_t __bun_v = (v); const float64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_f64(p, v, lane) __extension__({ float64x1x4_t __bun_v = (v); float64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN float64x2x3_t vld3q_f64(const float64_t *__p) { float64x2x3_t __v; for (int __i = 0; __i < 2; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_f64(float64_t *__p, float64x2x3_t __v) { for (int __i = 0; __i < 2; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN float64x2x2_t vld2q_dup_f64(const float64_t *__p) { return (float64x2x2_t){{vdupq_n_f64(__p[0]), vdupq_n_f64(__p[1])}}; }
#define vld2q_lane_f64(p, v, lane) __extension__({ float64x2x2_t __bun_v = (v); const float64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_f64(p, v, lane) __extension__({ float64x2x2_t __bun_v = (v); float64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN float64x2x3_t vld3q_dup_f64(const float64_t *__p) { return (float64x2x3_t){{vdupq_n_f64(__p[0]), vdupq_n_f64(__p[1]), vdupq_n_f64(__p[2])}}; }
#define vld3q_lane_f64(p, v, lane) __extension__({ float64x2x3_t __bun_v = (v); const float64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_f64(p, v, lane) __extension__({ float64x2x3_t __bun_v = (v); float64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN float64x2x4_t vld4q_dup_f64(const float64_t *__p) { return (float64x2x4_t){{vdupq_n_f64(__p[0]), vdupq_n_f64(__p[1]), vdupq_n_f64(__p[2]), vdupq_n_f64(__p[3])}}; }
#define vld4q_lane_f64(p, v, lane) __extension__({ float64x2x4_t __bun_v = (v); const float64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_f64(p, v, lane) __extension__({ float64x2x4_t __bun_v = (v); float64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN poly8x8x3_t vld3_p8(const poly8_t *__p) { poly8x8x3_t __v; for (int __i = 0; __i < 8; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3_p8(poly8_t *__p, poly8x8x3_t __v) { for (int __i = 0; __i < 8; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN poly8x8x2_t vld2_dup_p8(const poly8_t *__p) { return (poly8x8x2_t){{vdup_n_p8(__p[0]), vdup_n_p8(__p[1])}}; }
#define vld2_lane_p8(p, v, lane) __extension__({ poly8x8x2_t __bun_v = (v); const poly8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_p8(p, v, lane) __extension__({ poly8x8x2_t __bun_v = (v); poly8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN poly8x8x3_t vld3_dup_p8(const poly8_t *__p) { return (poly8x8x3_t){{vdup_n_p8(__p[0]), vdup_n_p8(__p[1]), vdup_n_p8(__p[2])}}; }
#define vld3_lane_p8(p, v, lane) __extension__({ poly8x8x3_t __bun_v = (v); const poly8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_p8(p, v, lane) __extension__({ poly8x8x3_t __bun_v = (v); poly8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN poly8x8x4_t vld4_dup_p8(const poly8_t *__p) { return (poly8x8x4_t){{vdup_n_p8(__p[0]), vdup_n_p8(__p[1]), vdup_n_p8(__p[2]), vdup_n_p8(__p[3])}}; }
#define vld4_lane_p8(p, v, lane) __extension__({ poly8x8x4_t __bun_v = (v); const poly8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_p8(p, v, lane) __extension__({ poly8x8x4_t __bun_v = (v); poly8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN poly8x16x3_t vld3q_p8(const poly8_t *__p) { poly8x16x3_t __v; for (int __i = 0; __i < 16; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_p8(poly8_t *__p, poly8x16x3_t __v) { for (int __i = 0; __i < 16; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN poly8x16x2_t vld2q_dup_p8(const poly8_t *__p) { return (poly8x16x2_t){{vdupq_n_p8(__p[0]), vdupq_n_p8(__p[1])}}; }
#define vld2q_lane_p8(p, v, lane) __extension__({ poly8x16x2_t __bun_v = (v); const poly8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_p8(p, v, lane) __extension__({ poly8x16x2_t __bun_v = (v); poly8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN poly8x16x3_t vld3q_dup_p8(const poly8_t *__p) { return (poly8x16x3_t){{vdupq_n_p8(__p[0]), vdupq_n_p8(__p[1]), vdupq_n_p8(__p[2])}}; }
#define vld3q_lane_p8(p, v, lane) __extension__({ poly8x16x3_t __bun_v = (v); const poly8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_p8(p, v, lane) __extension__({ poly8x16x3_t __bun_v = (v); poly8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN poly8x16x4_t vld4q_dup_p8(const poly8_t *__p) { return (poly8x16x4_t){{vdupq_n_p8(__p[0]), vdupq_n_p8(__p[1]), vdupq_n_p8(__p[2]), vdupq_n_p8(__p[3])}}; }
#define vld4q_lane_p8(p, v, lane) __extension__({ poly8x16x4_t __bun_v = (v); const poly8_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_p8(p, v, lane) __extension__({ poly8x16x4_t __bun_v = (v); poly8_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN poly16x4x3_t vld3_p16(const poly16_t *__p) { poly16x4x3_t __v; for (int __i = 0; __i < 4; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3_p16(poly16_t *__p, poly16x4x3_t __v) { for (int __i = 0; __i < 4; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN poly16x4x2_t vld2_dup_p16(const poly16_t *__p) { return (poly16x4x2_t){{vdup_n_p16(__p[0]), vdup_n_p16(__p[1])}}; }
#define vld2_lane_p16(p, v, lane) __extension__({ poly16x4x2_t __bun_v = (v); const poly16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_p16(p, v, lane) __extension__({ poly16x4x2_t __bun_v = (v); poly16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN poly16x4x3_t vld3_dup_p16(const poly16_t *__p) { return (poly16x4x3_t){{vdup_n_p16(__p[0]), vdup_n_p16(__p[1]), vdup_n_p16(__p[2])}}; }
#define vld3_lane_p16(p, v, lane) __extension__({ poly16x4x3_t __bun_v = (v); const poly16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_p16(p, v, lane) __extension__({ poly16x4x3_t __bun_v = (v); poly16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN poly16x4x4_t vld4_dup_p16(const poly16_t *__p) { return (poly16x4x4_t){{vdup_n_p16(__p[0]), vdup_n_p16(__p[1]), vdup_n_p16(__p[2]), vdup_n_p16(__p[3])}}; }
#define vld4_lane_p16(p, v, lane) __extension__({ poly16x4x4_t __bun_v = (v); const poly16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_p16(p, v, lane) __extension__({ poly16x4x4_t __bun_v = (v); poly16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN poly16x8x3_t vld3q_p16(const poly16_t *__p) { poly16x8x3_t __v; for (int __i = 0; __i < 8; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_p16(poly16_t *__p, poly16x8x3_t __v) { for (int __i = 0; __i < 8; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN poly16x8x2_t vld2q_dup_p16(const poly16_t *__p) { return (poly16x8x2_t){{vdupq_n_p16(__p[0]), vdupq_n_p16(__p[1])}}; }
#define vld2q_lane_p16(p, v, lane) __extension__({ poly16x8x2_t __bun_v = (v); const poly16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_p16(p, v, lane) __extension__({ poly16x8x2_t __bun_v = (v); poly16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN poly16x8x3_t vld3q_dup_p16(const poly16_t *__p) { return (poly16x8x3_t){{vdupq_n_p16(__p[0]), vdupq_n_p16(__p[1]), vdupq_n_p16(__p[2])}}; }
#define vld3q_lane_p16(p, v, lane) __extension__({ poly16x8x3_t __bun_v = (v); const poly16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_p16(p, v, lane) __extension__({ poly16x8x3_t __bun_v = (v); poly16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN poly16x8x4_t vld4q_dup_p16(const poly16_t *__p) { return (poly16x8x4_t){{vdupq_n_p16(__p[0]), vdupq_n_p16(__p[1]), vdupq_n_p16(__p[2]), vdupq_n_p16(__p[3])}}; }
#define vld4q_lane_p16(p, v, lane) __extension__({ poly16x8x4_t __bun_v = (v); const poly16_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_p16(p, v, lane) __extension__({ poly16x8x4_t __bun_v = (v); poly16_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN poly64x1x2_t vld2_dup_p64(const poly64_t *__p) { return (poly64x1x2_t){{vdup_n_p64(__p[0]), vdup_n_p64(__p[1])}}; }
#define vld2_lane_p64(p, v, lane) __extension__({ poly64x1x2_t __bun_v = (v); const poly64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2_lane_p64(p, v, lane) __extension__({ poly64x1x2_t __bun_v = (v); poly64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN poly64x1x3_t vld3_dup_p64(const poly64_t *__p) { return (poly64x1x3_t){{vdup_n_p64(__p[0]), vdup_n_p64(__p[1]), vdup_n_p64(__p[2])}}; }
#define vld3_lane_p64(p, v, lane) __extension__({ poly64x1x3_t __bun_v = (v); const poly64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3_lane_p64(p, v, lane) __extension__({ poly64x1x3_t __bun_v = (v); poly64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN poly64x1x4_t vld4_dup_p64(const poly64_t *__p) { return (poly64x1x4_t){{vdup_n_p64(__p[0]), vdup_n_p64(__p[1]), vdup_n_p64(__p[2]), vdup_n_p64(__p[3])}}; }
#define vld4_lane_p64(p, v, lane) __extension__({ poly64x1x4_t __bun_v = (v); const poly64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4_lane_p64(p, v, lane) __extension__({ poly64x1x4_t __bun_v = (v); poly64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN poly64x2x3_t vld3q_p64(const poly64_t *__p) { poly64x2x3_t __v; for (int __i = 0; __i < 2; __i++) { __v.val[0][__i] = __p[3 * __i]; __v.val[1][__i] = __p[3 * __i + 1]; __v.val[2][__i] = __p[3 * __i + 2]; } return __v; }
__BUN_CC_INTRIN void vst3q_p64(poly64_t *__p, poly64x2x3_t __v) { for (int __i = 0; __i < 2; __i++) { __p[3 * __i] = __v.val[0][__i]; __p[3 * __i + 1] = __v.val[1][__i]; __p[3 * __i + 2] = __v.val[2][__i]; } }
__BUN_CC_INTRIN poly64x2x2_t vld2q_dup_p64(const poly64_t *__p) { return (poly64x2x2_t){{vdupq_n_p64(__p[0]), vdupq_n_p64(__p[1])}}; }
#define vld2q_lane_p64(p, v, lane) __extension__({ poly64x2x2_t __bun_v = (v); const poly64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v; })
#define vst2q_lane_p64(p, v, lane) __extension__({ poly64x2x2_t __bun_v = (v); poly64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; (void)0; })
__BUN_CC_INTRIN poly64x2x3_t vld3q_dup_p64(const poly64_t *__p) { return (poly64x2x3_t){{vdupq_n_p64(__p[0]), vdupq_n_p64(__p[1]), vdupq_n_p64(__p[2])}}; }
#define vld3q_lane_p64(p, v, lane) __extension__({ poly64x2x3_t __bun_v = (v); const poly64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v; })
#define vst3q_lane_p64(p, v, lane) __extension__({ poly64x2x3_t __bun_v = (v); poly64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; (void)0; })
__BUN_CC_INTRIN poly64x2x4_t vld4q_dup_p64(const poly64_t *__p) { return (poly64x2x4_t){{vdupq_n_p64(__p[0]), vdupq_n_p64(__p[1]), vdupq_n_p64(__p[2]), vdupq_n_p64(__p[3])}}; }
#define vld4q_lane_p64(p, v, lane) __extension__({ poly64x2x4_t __bun_v = (v); const poly64_t *__bun_p = (p); __bun_v.val[0][lane] = __bun_p[0]; __bun_v.val[1][lane] = __bun_p[1]; __bun_v.val[2][lane] = __bun_p[2]; __bun_v.val[3][lane] = __bun_p[3]; __bun_v; })
#define vst4q_lane_p64(p, v, lane) __extension__({ poly64x2x4_t __bun_v = (v); poly64_t *__bun_p = (p); __bun_p[0] = __bun_v.val[0][lane]; __bun_p[1] = __bun_v.val[1][lane]; __bun_p[2] = __bun_v.val[2][lane]; __bun_p[3] = __bun_v.val[3][lane]; (void)0; })
__BUN_CC_INTRIN int8x16_t vqtbl2q_s8(int8x16x2_t __t, uint8x16_t __i) { return (int8x16_t)(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __i) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __i - 16)); }
__BUN_CC_INTRIN int8x8_t vqtbl2_s8(int8x16x2_t __t, uint8x8_t __i) { uint8x16_t __w = vcombine_u8(__i, __i); return (int8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __w) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __w - 16)); }
__BUN_CC_INTRIN int8x16_t vqtbl3q_s8(int8x16x3_t __t, uint8x16_t __i) { return (int8x16_t)(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __i) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __i - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __i - 32)); }
__BUN_CC_INTRIN int8x8_t vqtbl3_s8(int8x16x3_t __t, uint8x8_t __i) { uint8x16_t __w = vcombine_u8(__i, __i); return (int8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __w) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __w - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __w - 32)); }
__BUN_CC_INTRIN int8x16_t vqtbl4q_s8(int8x16x4_t __t, uint8x16_t __i) { return (int8x16_t)(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __i) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __i - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __i - 32) | __builtin_bir_swizzle((uint8x16_t)__t.val[3], __i - 48)); }
__BUN_CC_INTRIN int8x8_t vqtbl4_s8(int8x16x4_t __t, uint8x8_t __i) { uint8x16_t __w = vcombine_u8(__i, __i); return (int8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __w) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __w - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __w - 32) | __builtin_bir_swizzle((uint8x16_t)__t.val[3], __w - 48)); }
__BUN_CC_INTRIN int8x8_t vtbl3_s8(int8x8x3_t __t, int8x8_t __i) { int8x16x2_t __q = {{vcombine_s8(__t.val[0], __t.val[1]), vcombine_s8(__t.val[2], vdup_n_s8(0))}}; return vqtbl2_s8(__q, vmin_u8((uint8x8_t)__i, vdup_n_u8(24))); }
__BUN_CC_INTRIN int8x8_t vtbl4_s8(int8x8x4_t __t, int8x8_t __i) { int8x16x2_t __q = {{vcombine_s8(__t.val[0], __t.val[1]), vcombine_s8(__t.val[2], __t.val[3])}}; return vqtbl2_s8(__q, (uint8x8_t)__i); }
__BUN_CC_INTRIN int8x8_t vtbx1_s8(int8x8_t __a, int8x8_t __t, int8x8_t __i) { return vbsl_s8(vclt_u8((uint8x8_t)__i, vdup_n_u8(8)), vtbl1_s8(__t, __i), __a); }
__BUN_CC_INTRIN int8x8_t vtbx2_s8(int8x8_t __a, int8x8x2_t __t, int8x8_t __i) { return vbsl_s8(vclt_u8((uint8x8_t)__i, vdup_n_u8(16)), vtbl2_s8(__t, __i), __a); }
__BUN_CC_INTRIN int8x8_t vtbx3_s8(int8x8_t __a, int8x8x3_t __t, int8x8_t __i) { return vbsl_s8(vclt_u8((uint8x8_t)__i, vdup_n_u8(24)), vtbl3_s8(__t, __i), __a); }
__BUN_CC_INTRIN int8x8_t vtbx4_s8(int8x8_t __a, int8x8x4_t __t, int8x8_t __i) { return vbsl_s8(vclt_u8((uint8x8_t)__i, vdup_n_u8(32)), vtbl4_s8(__t, __i), __a); }
__BUN_CC_INTRIN int8x8_t vqtbx1_s8(int8x8_t __a, int8x16_t __t, uint8x8_t __i) { return vbsl_s8(vclt_u8(__i, vdup_n_u8(16)), vqtbl1_s8(__t, __i), __a); }
__BUN_CC_INTRIN int8x16_t vqtbx1q_s8(int8x16_t __a, int8x16_t __t, uint8x16_t __i) { return vbslq_s8(vcltq_u8(__i, vdupq_n_u8(16)), vqtbl1q_s8(__t, __i), __a); }
__BUN_CC_INTRIN uint8x16_t vqtbl2q_u8(uint8x16x2_t __t, uint8x16_t __i) { return (uint8x16_t)(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __i) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __i - 16)); }
__BUN_CC_INTRIN uint8x8_t vqtbl2_u8(uint8x16x2_t __t, uint8x8_t __i) { uint8x16_t __w = vcombine_u8(__i, __i); return (uint8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __w) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __w - 16)); }
__BUN_CC_INTRIN uint8x16_t vqtbl3q_u8(uint8x16x3_t __t, uint8x16_t __i) { return (uint8x16_t)(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __i) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __i - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __i - 32)); }
__BUN_CC_INTRIN uint8x8_t vqtbl3_u8(uint8x16x3_t __t, uint8x8_t __i) { uint8x16_t __w = vcombine_u8(__i, __i); return (uint8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __w) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __w - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __w - 32)); }
__BUN_CC_INTRIN uint8x16_t vqtbl4q_u8(uint8x16x4_t __t, uint8x16_t __i) { return (uint8x16_t)(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __i) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __i - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __i - 32) | __builtin_bir_swizzle((uint8x16_t)__t.val[3], __i - 48)); }
__BUN_CC_INTRIN uint8x8_t vqtbl4_u8(uint8x16x4_t __t, uint8x8_t __i) { uint8x16_t __w = vcombine_u8(__i, __i); return (uint8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __w) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __w - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __w - 32) | __builtin_bir_swizzle((uint8x16_t)__t.val[3], __w - 48)); }
__BUN_CC_INTRIN uint8x8_t vtbl3_u8(uint8x8x3_t __t, uint8x8_t __i) { uint8x16x2_t __q = {{vcombine_u8(__t.val[0], __t.val[1]), vcombine_u8(__t.val[2], vdup_n_u8(0))}}; return vqtbl2_u8(__q, vmin_u8((uint8x8_t)__i, vdup_n_u8(24))); }
__BUN_CC_INTRIN uint8x8_t vtbl4_u8(uint8x8x4_t __t, uint8x8_t __i) { uint8x16x2_t __q = {{vcombine_u8(__t.val[0], __t.val[1]), vcombine_u8(__t.val[2], __t.val[3])}}; return vqtbl2_u8(__q, (uint8x8_t)__i); }
__BUN_CC_INTRIN uint8x8_t vtbx1_u8(uint8x8_t __a, uint8x8_t __t, uint8x8_t __i) { return vbsl_u8(vclt_u8((uint8x8_t)__i, vdup_n_u8(8)), vtbl1_u8(__t, __i), __a); }
__BUN_CC_INTRIN uint8x8_t vtbx2_u8(uint8x8_t __a, uint8x8x2_t __t, uint8x8_t __i) { return vbsl_u8(vclt_u8((uint8x8_t)__i, vdup_n_u8(16)), vtbl2_u8(__t, __i), __a); }
__BUN_CC_INTRIN uint8x8_t vtbx3_u8(uint8x8_t __a, uint8x8x3_t __t, uint8x8_t __i) { return vbsl_u8(vclt_u8((uint8x8_t)__i, vdup_n_u8(24)), vtbl3_u8(__t, __i), __a); }
__BUN_CC_INTRIN uint8x8_t vtbx4_u8(uint8x8_t __a, uint8x8x4_t __t, uint8x8_t __i) { return vbsl_u8(vclt_u8((uint8x8_t)__i, vdup_n_u8(32)), vtbl4_u8(__t, __i), __a); }
__BUN_CC_INTRIN uint8x8_t vqtbx1_u8(uint8x8_t __a, uint8x16_t __t, uint8x8_t __i) { return vbsl_u8(vclt_u8(__i, vdup_n_u8(16)), vqtbl1_u8(__t, __i), __a); }
__BUN_CC_INTRIN uint8x16_t vqtbx1q_u8(uint8x16_t __a, uint8x16_t __t, uint8x16_t __i) { return vbslq_u8(vcltq_u8(__i, vdupq_n_u8(16)), vqtbl1q_u8(__t, __i), __a); }
__BUN_CC_INTRIN poly8x16_t vqtbl2q_p8(poly8x16x2_t __t, uint8x16_t __i) { return (poly8x16_t)(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __i) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __i - 16)); }
__BUN_CC_INTRIN poly8x8_t vqtbl2_p8(poly8x16x2_t __t, uint8x8_t __i) { uint8x16_t __w = vcombine_u8(__i, __i); return (poly8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __w) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __w - 16)); }
__BUN_CC_INTRIN poly8x16_t vqtbl3q_p8(poly8x16x3_t __t, uint8x16_t __i) { return (poly8x16_t)(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __i) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __i - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __i - 32)); }
__BUN_CC_INTRIN poly8x8_t vqtbl3_p8(poly8x16x3_t __t, uint8x8_t __i) { uint8x16_t __w = vcombine_u8(__i, __i); return (poly8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __w) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __w - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __w - 32)); }
__BUN_CC_INTRIN poly8x16_t vqtbl4q_p8(poly8x16x4_t __t, uint8x16_t __i) { return (poly8x16_t)(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __i) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __i - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __i - 32) | __builtin_bir_swizzle((uint8x16_t)__t.val[3], __i - 48)); }
__BUN_CC_INTRIN poly8x8_t vqtbl4_p8(poly8x16x4_t __t, uint8x8_t __i) { uint8x16_t __w = vcombine_u8(__i, __i); return (poly8x8_t)vget_low_u8(__builtin_bir_swizzle((uint8x16_t)__t.val[0], __w) | __builtin_bir_swizzle((uint8x16_t)__t.val[1], __w - 16) | __builtin_bir_swizzle((uint8x16_t)__t.val[2], __w - 32) | __builtin_bir_swizzle((uint8x16_t)__t.val[3], __w - 48)); }
__BUN_CC_INTRIN poly8x8_t vtbl3_p8(poly8x8x3_t __t, uint8x8_t __i) { poly8x16x2_t __q = {{vcombine_p8(__t.val[0], __t.val[1]), vcombine_p8(__t.val[2], vdup_n_p8(0))}}; return vqtbl2_p8(__q, vmin_u8((uint8x8_t)__i, vdup_n_u8(24))); }
__BUN_CC_INTRIN poly8x8_t vtbl4_p8(poly8x8x4_t __t, uint8x8_t __i) { poly8x16x2_t __q = {{vcombine_p8(__t.val[0], __t.val[1]), vcombine_p8(__t.val[2], __t.val[3])}}; return vqtbl2_p8(__q, (uint8x8_t)__i); }
__BUN_CC_INTRIN poly8x8_t vtbx1_p8(poly8x8_t __a, poly8x8_t __t, uint8x8_t __i) { return vbsl_p8(vclt_u8((uint8x8_t)__i, vdup_n_u8(8)), vtbl1_p8(__t, __i), __a); }
__BUN_CC_INTRIN poly8x8_t vtbx2_p8(poly8x8_t __a, poly8x8x2_t __t, uint8x8_t __i) { return vbsl_p8(vclt_u8((uint8x8_t)__i, vdup_n_u8(16)), vtbl2_p8(__t, __i), __a); }
__BUN_CC_INTRIN poly8x8_t vtbx3_p8(poly8x8_t __a, poly8x8x3_t __t, uint8x8_t __i) { return vbsl_p8(vclt_u8((uint8x8_t)__i, vdup_n_u8(24)), vtbl3_p8(__t, __i), __a); }
__BUN_CC_INTRIN poly8x8_t vtbx4_p8(poly8x8_t __a, poly8x8x4_t __t, uint8x8_t __i) { return vbsl_p8(vclt_u8((uint8x8_t)__i, vdup_n_u8(32)), vtbl4_p8(__t, __i), __a); }
__BUN_CC_INTRIN poly8x8_t vqtbx1_p8(poly8x8_t __a, poly8x16_t __t, uint8x8_t __i) { return vbsl_p8(vclt_u8(__i, vdup_n_u8(16)), vqtbl1_p8(__t, __i), __a); }
__BUN_CC_INTRIN poly8x16_t vqtbx1q_p8(poly8x16_t __a, poly8x16_t __t, uint8x16_t __i) { return vbslq_p8(vcltq_u8(__i, vdupq_n_u8(16)), vqtbl1q_p8(__t, __i), __a); }

/* What the optional architecture features add, worked out with the instructions above: right, not fast. */
__BUN_CC_INTRIN int8x16_t vreinterpretq_s8_p128(poly128_t __a) { union { poly128_t __p; int8x16_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_s8(int8x16_t __a) { union { int8x16_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN uint8x16_t vreinterpretq_u8_p128(poly128_t __a) { union { poly128_t __p; uint8x16_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_u8(uint8x16_t __a) { union { uint8x16_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN int16x8_t vreinterpretq_s16_p128(poly128_t __a) { union { poly128_t __p; int16x8_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_s16(int16x8_t __a) { union { int16x8_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN uint16x8_t vreinterpretq_u16_p128(poly128_t __a) { union { poly128_t __p; uint16x8_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_u16(uint16x8_t __a) { union { uint16x8_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN int32x4_t vreinterpretq_s32_p128(poly128_t __a) { union { poly128_t __p; int32x4_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_s32(int32x4_t __a) { union { int32x4_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN uint32x4_t vreinterpretq_u32_p128(poly128_t __a) { union { poly128_t __p; uint32x4_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_u32(uint32x4_t __a) { union { uint32x4_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN int64x2_t vreinterpretq_s64_p128(poly128_t __a) { union { poly128_t __p; int64x2_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_s64(int64x2_t __a) { union { int64x2_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN uint64x2_t vreinterpretq_u64_p128(poly128_t __a) { union { poly128_t __p; uint64x2_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_u64(uint64x2_t __a) { union { uint64x2_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN float32x4_t vreinterpretq_f32_p128(poly128_t __a) { union { poly128_t __p; float32x4_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_f32(float32x4_t __a) { union { float32x4_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN float64x2_t vreinterpretq_f64_p128(poly128_t __a) { union { poly128_t __p; float64x2_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_f64(float64x2_t __a) { union { float64x2_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN poly64x2_t vreinterpretq_p64_p128(poly128_t __a) { union { poly128_t __p; poly64x2_t __v; } __u = {__a}; return __u.__v; }
__BUN_CC_INTRIN poly128_t vreinterpretq_p128_p64(poly64x2_t __a) { union { poly64x2_t __v; poly128_t __p; } __u = {__a}; return __u.__p; }
__BUN_CC_INTRIN poly128_t vmull_p64(poly64_t __a, poly64_t __b) { poly128_t __r = 0; for (int __i = 0; __i < 64; __i++) if ((__b >> __i) & 1) __r ^= (poly128_t)__a << __i; return __r; }
__BUN_CC_INTRIN poly128_t vmull_high_p64(poly64x2_t __a, poly64x2_t __b) { return vmull_p64(__a[1], __b[1]); }
__BUN_CC_INTRIN int8x16_t veor3q_s8(int8x16_t __a, int8x16_t __b, int8x16_t __c) { return __a ^ __b ^ __c; }
__BUN_CC_INTRIN int8x16_t vbcaxq_s8(int8x16_t __a, int8x16_t __b, int8x16_t __c) { return __a ^ (__b & ~__c); }
__BUN_CC_INTRIN uint8x16_t veor3q_u8(uint8x16_t __a, uint8x16_t __b, uint8x16_t __c) { return __a ^ __b ^ __c; }
__BUN_CC_INTRIN uint8x16_t vbcaxq_u8(uint8x16_t __a, uint8x16_t __b, uint8x16_t __c) { return __a ^ (__b & ~__c); }
__BUN_CC_INTRIN int16x8_t veor3q_s16(int16x8_t __a, int16x8_t __b, int16x8_t __c) { return __a ^ __b ^ __c; }
__BUN_CC_INTRIN int16x8_t vbcaxq_s16(int16x8_t __a, int16x8_t __b, int16x8_t __c) { return __a ^ (__b & ~__c); }
__BUN_CC_INTRIN uint16x8_t veor3q_u16(uint16x8_t __a, uint16x8_t __b, uint16x8_t __c) { return __a ^ __b ^ __c; }
__BUN_CC_INTRIN uint16x8_t vbcaxq_u16(uint16x8_t __a, uint16x8_t __b, uint16x8_t __c) { return __a ^ (__b & ~__c); }
__BUN_CC_INTRIN int32x4_t veor3q_s32(int32x4_t __a, int32x4_t __b, int32x4_t __c) { return __a ^ __b ^ __c; }
__BUN_CC_INTRIN int32x4_t vbcaxq_s32(int32x4_t __a, int32x4_t __b, int32x4_t __c) { return __a ^ (__b & ~__c); }
__BUN_CC_INTRIN uint32x4_t veor3q_u32(uint32x4_t __a, uint32x4_t __b, uint32x4_t __c) { return __a ^ __b ^ __c; }
__BUN_CC_INTRIN uint32x4_t vbcaxq_u32(uint32x4_t __a, uint32x4_t __b, uint32x4_t __c) { return __a ^ (__b & ~__c); }
__BUN_CC_INTRIN int64x2_t veor3q_s64(int64x2_t __a, int64x2_t __b, int64x2_t __c) { return __a ^ __b ^ __c; }
__BUN_CC_INTRIN int64x2_t vbcaxq_s64(int64x2_t __a, int64x2_t __b, int64x2_t __c) { return __a ^ (__b & ~__c); }
__BUN_CC_INTRIN uint64x2_t veor3q_u64(uint64x2_t __a, uint64x2_t __b, uint64x2_t __c) { return __a ^ __b ^ __c; }
__BUN_CC_INTRIN uint64x2_t vbcaxq_u64(uint64x2_t __a, uint64x2_t __b, uint64x2_t __c) { return __a ^ (__b & ~__c); }
__BUN_CC_INTRIN uint32x4_t vdotq_u32(uint32x4_t __r, uint8x16_t __a, uint8x16_t __b) { return __r + vpaddq_u32(vpaddlq_u16(vmull_u8(vget_low_u8(__a), vget_low_u8(__b))), vpaddlq_u16(vmull_high_u8(__a, __b))); }
__BUN_CC_INTRIN uint32x2_t vdot_u32(uint32x2_t __r, uint8x8_t __a, uint8x8_t __b) { return __r + vget_low_u32(vpaddq_u32(vpaddlq_u16(vmull_u8(__a, __b)), vpaddlq_u16(vmull_u8(__a, __b)))); }
__BUN_CC_INTRIN int32x4_t vdotq_s32(int32x4_t __r, int8x16_t __a, int8x16_t __b) { return __r + vpaddq_s32(vpaddlq_s16(vmull_s8(vget_low_s8(__a), vget_low_s8(__b))), vpaddlq_s16(vmull_high_s8(__a, __b))); }
__BUN_CC_INTRIN int32x2_t vdot_s32(int32x2_t __r, int8x8_t __a, int8x8_t __b) { return __r + vget_low_s32(vpaddq_s32(vpaddlq_s16(vmull_s8(__a, __b)), vpaddlq_s16(vmull_s8(__a, __b)))); }

#endif

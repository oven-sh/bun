/* SSE2 intrinsics for x86-64 targets, written over the vector extensions. Only what is
   defined here exists. */
#ifndef __BUN_CC_EMMINTRIN_H
#define __BUN_CC_EMMINTRIN_H

#include <xmmintrin.h>

typedef double __m128d __attribute__((__vector_size__(16)));
typedef long long __m128i __attribute__((__vector_size__(16)));
typedef double __m128d_u __attribute__((__vector_size__(16)));
typedef long long __m128i_u __attribute__((__vector_size__(16)));

typedef double __v2df __attribute__((__vector_size__(16)));
typedef long long __v2di __attribute__((__vector_size__(16)));
typedef unsigned long long __v2du __attribute__((__vector_size__(16)));
typedef short __v8hi __attribute__((__vector_size__(16)));
typedef unsigned short __v8hu __attribute__((__vector_size__(16)));
typedef char __v16qi __attribute__((__vector_size__(16)));
typedef signed char __v16qs __attribute__((__vector_size__(16)));
typedef unsigned char __v16qu __attribute__((__vector_size__(16)));

/* Double-precision. */

__BUN_CC_INTRIN __m128d _mm_setzero_pd(void) { return (__m128d){0.0, 0.0}; }
__BUN_CC_INTRIN __m128d _mm_set1_pd(double __w) { return (__m128d){__w, __w}; }
__BUN_CC_INTRIN __m128d _mm_set_pd1(double __w) { return (__m128d){__w, __w}; }
__BUN_CC_INTRIN __m128d _mm_set_pd(double __x, double __w) { return (__m128d){__w, __x}; }
__BUN_CC_INTRIN __m128d _mm_setr_pd(double __w, double __x) { return (__m128d){__w, __x}; }
__BUN_CC_INTRIN __m128d _mm_set_sd(double __w) { return (__m128d){__w, 0.0}; }

__BUN_CC_INTRIN __m128d _mm_load_pd(const double *__p) { return *(const __m128d *)__p; }
__BUN_CC_INTRIN __m128d _mm_loadu_pd(const double *__p) { return *(const __m128d_u *)__p; }
__BUN_CC_INTRIN __m128d _mm_load1_pd(const double *__p) { return _mm_set1_pd(*__p); }
__BUN_CC_INTRIN __m128d _mm_load_sd(const double *__p) { return _mm_set_sd(*__p); }
__BUN_CC_INTRIN void _mm_store_pd(double *__p, __m128d __a) { *(__m128d *)__p = __a; }
__BUN_CC_INTRIN void _mm_storeu_pd(double *__p, __m128d __a) { *(__m128d_u *)__p = __a; }
__BUN_CC_INTRIN void _mm_store_sd(double *__p, __m128d __a) { *__p = __a[0]; }
__BUN_CC_INTRIN double _mm_cvtsd_f64(__m128d __a) { return __a[0]; }

__BUN_CC_INTRIN __m128d _mm_add_pd(__m128d __a, __m128d __b) { return __a + __b; }
__BUN_CC_INTRIN __m128d _mm_sub_pd(__m128d __a, __m128d __b) { return __a - __b; }
__BUN_CC_INTRIN __m128d _mm_mul_pd(__m128d __a, __m128d __b) { return __a * __b; }
__BUN_CC_INTRIN __m128d _mm_div_pd(__m128d __a, __m128d __b) { return __a / __b; }
__BUN_CC_INTRIN __m128d _mm_sqrt_pd(__m128d __a) { return __builtin_elementwise_sqrt(__a); }
/* As for MINPS: the second operand when the two are unordered or equal. */
__BUN_CC_INTRIN __m128d _mm_min_pd(__m128d __a, __m128d __b) { return __builtin_elementwise_min(__b, __a); }
__BUN_CC_INTRIN __m128d _mm_max_pd(__m128d __a, __m128d __b) { return __builtin_elementwise_max(__b, __a); }

__BUN_CC_INTRIN __m128d _mm_and_pd(__m128d __a, __m128d __b) { return (__m128d)((__v2du)__a & (__v2du)__b); }
__BUN_CC_INTRIN __m128d _mm_andnot_pd(__m128d __a, __m128d __b) { return (__m128d)(~(__v2du)__a & (__v2du)__b); }
__BUN_CC_INTRIN __m128d _mm_or_pd(__m128d __a, __m128d __b) { return (__m128d)((__v2du)__a | (__v2du)__b); }
__BUN_CC_INTRIN __m128d _mm_xor_pd(__m128d __a, __m128d __b) { return (__m128d)((__v2du)__a ^ (__v2du)__b); }

__BUN_CC_INTRIN __m128d _mm_cmpeq_pd(__m128d __a, __m128d __b) { return (__m128d)(__a == __b); }
__BUN_CC_INTRIN __m128d _mm_cmplt_pd(__m128d __a, __m128d __b) { return (__m128d)(__a < __b); }
__BUN_CC_INTRIN __m128d _mm_cmple_pd(__m128d __a, __m128d __b) { return (__m128d)(__a <= __b); }
__BUN_CC_INTRIN __m128d _mm_cmpgt_pd(__m128d __a, __m128d __b) { return (__m128d)(__a > __b); }
__BUN_CC_INTRIN __m128d _mm_cmpge_pd(__m128d __a, __m128d __b) { return (__m128d)(__a >= __b); }
__BUN_CC_INTRIN __m128d _mm_cmpneq_pd(__m128d __a, __m128d __b) { return (__m128d)(__a != __b); }

__BUN_CC_INTRIN int _mm_movemask_pd(__m128d __a) { return __builtin_ia32_movmskpd(__a); }

__BUN_CC_INTRIN __m128d _mm_unpacklo_pd(__m128d __a, __m128d __b) { return __builtin_shufflevector(__a, __b, 0, 2); }
__BUN_CC_INTRIN __m128d _mm_unpackhi_pd(__m128d __a, __m128d __b) { return __builtin_shufflevector(__a, __b, 1, 3); }
#define _mm_shuffle_pd(a, b, mask) \
  ((__m128d)__builtin_shufflevector((__v2df)(__m128d)(a), (__v2df)(__m128d)(b), (mask) & 1, 2 + (((mask) >> 1) & 1)))

/* Integer: construction, loads and stores. */

__BUN_CC_INTRIN __m128i _mm_setzero_si128(void) { return (__m128i){0LL, 0LL}; }
__BUN_CC_INTRIN __m128i _mm_set1_epi64x(long long __q) { return (__m128i){__q, __q}; }
__BUN_CC_INTRIN __m128i _mm_set_epi64x(long long __q1, long long __q0) { return (__m128i){__q0, __q1}; }
__BUN_CC_INTRIN __m128i _mm_set1_epi32(int __i) { return (__m128i)(__v4si){__i, __i, __i, __i}; }
__BUN_CC_INTRIN __m128i _mm_set_epi32(int __i3, int __i2, int __i1, int __i0) {
  return (__m128i)(__v4si){__i0, __i1, __i2, __i3};
}
__BUN_CC_INTRIN __m128i _mm_setr_epi32(int __i0, int __i1, int __i2, int __i3) {
  return (__m128i)(__v4si){__i0, __i1, __i2, __i3};
}
__BUN_CC_INTRIN __m128i _mm_set1_epi16(short __w) {
  return (__m128i)(__v8hi){__w, __w, __w, __w, __w, __w, __w, __w};
}
__BUN_CC_INTRIN __m128i _mm_set_epi16(short __w7, short __w6, short __w5, short __w4, short __w3, short __w2,
                                      short __w1, short __w0) {
  return (__m128i)(__v8hi){__w0, __w1, __w2, __w3, __w4, __w5, __w6, __w7};
}
__BUN_CC_INTRIN __m128i _mm_setr_epi16(short __w0, short __w1, short __w2, short __w3, short __w4, short __w5,
                                       short __w6, short __w7) {
  return (__m128i)(__v8hi){__w0, __w1, __w2, __w3, __w4, __w5, __w6, __w7};
}
__BUN_CC_INTRIN __m128i _mm_set1_epi8(char __b) {
  return (__m128i)(__v16qi){__b, __b, __b, __b, __b, __b, __b, __b, __b, __b, __b, __b, __b, __b, __b, __b};
}
__BUN_CC_INTRIN __m128i _mm_set_epi8(char __b15, char __b14, char __b13, char __b12, char __b11, char __b10,
                                     char __b9, char __b8, char __b7, char __b6, char __b5, char __b4, char __b3,
                                     char __b2, char __b1, char __b0) {
  return (__m128i)(__v16qi){__b0, __b1, __b2,  __b3,  __b4,  __b5,  __b6,  __b7,
                            __b8, __b9, __b10, __b11, __b12, __b13, __b14, __b15};
}
__BUN_CC_INTRIN __m128i _mm_setr_epi8(char __b0, char __b1, char __b2, char __b3, char __b4, char __b5, char __b6,
                                      char __b7, char __b8, char __b9, char __b10, char __b11, char __b12,
                                      char __b13, char __b14, char __b15) {
  return (__m128i)(__v16qi){__b0, __b1, __b2,  __b3,  __b4,  __b5,  __b6,  __b7,
                            __b8, __b9, __b10, __b11, __b12, __b13, __b14, __b15};
}

__BUN_CC_INTRIN __m128i _mm_load_si128(const __m128i *__p) { return *__p; }
__BUN_CC_INTRIN __m128i _mm_loadu_si128(const __m128i_u *__p) { return *__p; }
__BUN_CC_INTRIN __m128i _mm_loadl_epi64(const __m128i_u *__p) {
  return (__m128i){*(const long long *)__p, 0LL};
}
__BUN_CC_INTRIN void _mm_store_si128(__m128i *__p, __m128i __a) { *__p = __a; }
__BUN_CC_INTRIN void _mm_storeu_si128(__m128i_u *__p, __m128i __a) { *__p = __a; }
__BUN_CC_INTRIN void _mm_storel_epi64(__m128i_u *__p, __m128i __a) { *(long long *)__p = __a[0]; }

__BUN_CC_INTRIN int _mm_cvtsi128_si32(__m128i __a) { return ((__v4si)__a)[0]; }
__BUN_CC_INTRIN long long _mm_cvtsi128_si64(__m128i __a) { return __a[0]; }
__BUN_CC_INTRIN __m128i _mm_cvtsi32_si128(int __a) { return (__m128i)(__v4si){__a, 0, 0, 0}; }
__BUN_CC_INTRIN __m128i _mm_cvtsi64_si128(long long __a) { return (__m128i){__a, 0LL}; }

/* Integer arithmetic. */

__BUN_CC_INTRIN __m128i _mm_add_epi8(__m128i __a, __m128i __b) { return (__m128i)((__v16qu)__a + (__v16qu)__b); }
__BUN_CC_INTRIN __m128i _mm_add_epi16(__m128i __a, __m128i __b) { return (__m128i)((__v8hu)__a + (__v8hu)__b); }
__BUN_CC_INTRIN __m128i _mm_add_epi32(__m128i __a, __m128i __b) { return (__m128i)((__v4su)__a + (__v4su)__b); }
__BUN_CC_INTRIN __m128i _mm_add_epi64(__m128i __a, __m128i __b) { return (__m128i)((__v2du)__a + (__v2du)__b); }
__BUN_CC_INTRIN __m128i _mm_sub_epi8(__m128i __a, __m128i __b) { return (__m128i)((__v16qu)__a - (__v16qu)__b); }
__BUN_CC_INTRIN __m128i _mm_sub_epi16(__m128i __a, __m128i __b) { return (__m128i)((__v8hu)__a - (__v8hu)__b); }
__BUN_CC_INTRIN __m128i _mm_sub_epi32(__m128i __a, __m128i __b) { return (__m128i)((__v4su)__a - (__v4su)__b); }
__BUN_CC_INTRIN __m128i _mm_sub_epi64(__m128i __a, __m128i __b) { return (__m128i)((__v2du)__a - (__v2du)__b); }
__BUN_CC_INTRIN __m128i _mm_mullo_epi16(__m128i __a, __m128i __b) { return (__m128i)((__v8hu)__a * (__v8hu)__b); }

/* Saturating arithmetic. */
__BUN_CC_INTRIN __m128i _mm_adds_epu8(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_paddusb128((__v16qi)__a, (__v16qi)__b); }
__BUN_CC_INTRIN __m128i _mm_adds_epu16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_paddusw128((__v8hi)__a, (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_subs_epu8(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_psubusb128((__v16qi)__a, (__v16qi)__b); }
__BUN_CC_INTRIN __m128i _mm_subs_epu16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_psubusw128((__v8hi)__a, (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_adds_epi8(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_paddsb128((__v16qi)__a, (__v16qi)__b); }
__BUN_CC_INTRIN __m128i _mm_adds_epi16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_paddsw128((__v8hi)__a, (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_subs_epi8(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_psubsb128((__v16qi)__a, (__v16qi)__b); }
__BUN_CC_INTRIN __m128i _mm_subs_epi16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_psubsw128((__v8hi)__a, (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_avg_epu8(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_pavgb128((__v16qi)__a, (__v16qi)__b); }
__BUN_CC_INTRIN __m128i _mm_avg_epu16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_pavgw128((__v8hi)__a, (__v8hi)__b); }

/* Widening multiplies and sums. */
__BUN_CC_INTRIN __m128i _mm_mul_epu32(__m128i __a, __m128i __b) {
  return (__m128i)(((__v2du)__a & 0xffffffffULL) * ((__v2du)__b & 0xffffffffULL));
}
__BUN_CC_INTRIN __m128i _mm_madd_epi16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_pmaddwd128((__v8hi)__a, (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_mulhi_epi16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_pmulhw128((__v8hi)__a, (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_mulhi_epu16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_pmulhuw128((__v8hi)__a, (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_sad_epu8(__m128i __a, __m128i __b) {
  __v16qu __x = (__v16qu)__a, __y = (__v16qu)__b;
  __v8hu __d = (__v8hu)(__builtin_elementwise_max(__x, __y) - __builtin_elementwise_min(__x, __y));
  __v4su __pairs = (__v4su)((__d & 0xff) + (__d >> 8));
  __v2du __quads = (__v2du)((__pairs & 0xffffU) + (__pairs >> 16));
  return (__m128i)((__quads & 0xffffffffULL) + (__quads >> 32));
}

/* Narrowing with saturation. */
__BUN_CC_INTRIN __m128i _mm_packs_epi16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_packsswb128((__v8hi)__a, (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_packus_epi16(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_packuswb128((__v8hi)__a, (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_packs_epi32(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_packssdw128((__v4si)__a, (__v4si)__b); }

__BUN_CC_INTRIN __m128i _mm_and_si128(__m128i __a, __m128i __b) { return (__m128i)((__v2du)__a & (__v2du)__b); }
__BUN_CC_INTRIN __m128i _mm_andnot_si128(__m128i __a, __m128i __b) { return (__m128i)(~(__v2du)__a & (__v2du)__b); }
__BUN_CC_INTRIN __m128i _mm_or_si128(__m128i __a, __m128i __b) { return (__m128i)((__v2du)__a | (__v2du)__b); }
__BUN_CC_INTRIN __m128i _mm_xor_si128(__m128i __a, __m128i __b) { return (__m128i)((__v2du)__a ^ (__v2du)__b); }

__BUN_CC_INTRIN __m128i _mm_min_epu8(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_min((__v16qu)__a, (__v16qu)__b);
}
__BUN_CC_INTRIN __m128i _mm_max_epu8(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_max((__v16qu)__a, (__v16qu)__b);
}
__BUN_CC_INTRIN __m128i _mm_min_epi16(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_min((__v8hi)__a, (__v8hi)__b);
}
__BUN_CC_INTRIN __m128i _mm_max_epi16(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_max((__v8hi)__a, (__v8hi)__b);
}

__BUN_CC_INTRIN __m128i _mm_cmpeq_epi8(__m128i __a, __m128i __b) { return (__m128i)((__v16qs)__a == (__v16qs)__b); }
__BUN_CC_INTRIN __m128i _mm_cmpeq_epi16(__m128i __a, __m128i __b) { return (__m128i)((__v8hi)__a == (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_cmpeq_epi32(__m128i __a, __m128i __b) { return (__m128i)((__v4si)__a == (__v4si)__b); }
__BUN_CC_INTRIN __m128i _mm_cmpgt_epi8(__m128i __a, __m128i __b) { return (__m128i)((__v16qs)__a > (__v16qs)__b); }
__BUN_CC_INTRIN __m128i _mm_cmpgt_epi16(__m128i __a, __m128i __b) { return (__m128i)((__v8hi)__a > (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_cmpgt_epi32(__m128i __a, __m128i __b) { return (__m128i)((__v4si)__a > (__v4si)__b); }
__BUN_CC_INTRIN __m128i _mm_cmplt_epi8(__m128i __a, __m128i __b) { return (__m128i)((__v16qs)__a < (__v16qs)__b); }
__BUN_CC_INTRIN __m128i _mm_cmplt_epi16(__m128i __a, __m128i __b) { return (__m128i)((__v8hi)__a < (__v8hi)__b); }
__BUN_CC_INTRIN __m128i _mm_cmplt_epi32(__m128i __a, __m128i __b) { return (__m128i)((__v4si)__a < (__v4si)__b); }

__BUN_CC_INTRIN int _mm_movemask_epi8(__m128i __a) { return __builtin_ia32_pmovmskb128((__v16qi)__a); }

/* Shifts by an immediate: a count of the lane width or more clears the lanes (or, for
   the arithmetic shift, fills them with the sign). */

__BUN_CC_INTRIN __m128i _mm_slli_epi16(__m128i __a, int __n) {
  return (unsigned)__n > 15 ? _mm_setzero_si128() : (__m128i)((__v8hu)__a << __n);
}
__BUN_CC_INTRIN __m128i _mm_slli_epi32(__m128i __a, int __n) {
  return (unsigned)__n > 31 ? _mm_setzero_si128() : (__m128i)((__v4su)__a << __n);
}
__BUN_CC_INTRIN __m128i _mm_slli_epi64(__m128i __a, int __n) {
  return (unsigned)__n > 63 ? _mm_setzero_si128() : (__m128i)((__v2du)__a << __n);
}
__BUN_CC_INTRIN __m128i _mm_srli_epi16(__m128i __a, int __n) {
  return (unsigned)__n > 15 ? _mm_setzero_si128() : (__m128i)((__v8hu)__a >> __n);
}
__BUN_CC_INTRIN __m128i _mm_srli_epi32(__m128i __a, int __n) {
  return (unsigned)__n > 31 ? _mm_setzero_si128() : (__m128i)((__v4su)__a >> __n);
}
__BUN_CC_INTRIN __m128i _mm_srli_epi64(__m128i __a, int __n) {
  return (unsigned)__n > 63 ? _mm_setzero_si128() : (__m128i)((__v2du)__a >> __n);
}
__BUN_CC_INTRIN __m128i _mm_srai_epi16(__m128i __a, int __n) {
  return (__m128i)((__v8hi)__a >> ((unsigned)__n > 15 ? 15 : __n));
}
__BUN_CC_INTRIN __m128i _mm_srai_epi32(__m128i __a, int __n) {
  return (__m128i)((__v4si)__a >> ((unsigned)__n > 31 ? 31 : __n));
}

/* Whole-register byte shifts. */
#define _mm_srli_si128(a, imm) \
  ((__m128i)__builtin_shufflevector((__v16qi)(__m128i)(a), (__v16qi)_mm_setzero_si128(), \
      ((imm) & 0xf0) ? 16 : (imm) + 0, ((imm) & 0xf0) ? 16 : (imm) + 1, ((imm) & 0xf0) ? 16 : (imm) + 2, \
      ((imm) & 0xf0) ? 16 : (imm) + 3, ((imm) & 0xf0) ? 16 : (imm) + 4, ((imm) & 0xf0) ? 16 : (imm) + 5, \
      ((imm) & 0xf0) ? 16 : (imm) + 6, ((imm) & 0xf0) ? 16 : (imm) + 7, ((imm) & 0xf0) ? 16 : (imm) + 8, \
      ((imm) & 0xf0) ? 16 : (imm) + 9, ((imm) & 0xf0) ? 16 : (imm) + 10, ((imm) & 0xf0) ? 16 : (imm) + 11, \
      ((imm) & 0xf0) ? 16 : (imm) + 12, ((imm) & 0xf0) ? 16 : (imm) + 13, ((imm) & 0xf0) ? 16 : (imm) + 14, \
      ((imm) & 0xf0) ? 16 : (imm) + 15))
#define _mm_slli_si128(a, imm) \
  ((__m128i)__builtin_shufflevector((__v16qi)_mm_setzero_si128(), (__v16qi)(__m128i)(a), \
      ((imm) & 0xf0) ? 0 : 16 - (imm), ((imm) & 0xf0) ? 0 : 17 - (imm), ((imm) & 0xf0) ? 0 : 18 - (imm), \
      ((imm) & 0xf0) ? 0 : 19 - (imm), ((imm) & 0xf0) ? 0 : 20 - (imm), ((imm) & 0xf0) ? 0 : 21 - (imm), \
      ((imm) & 0xf0) ? 0 : 22 - (imm), ((imm) & 0xf0) ? 0 : 23 - (imm), ((imm) & 0xf0) ? 0 : 24 - (imm), \
      ((imm) & 0xf0) ? 0 : 25 - (imm), ((imm) & 0xf0) ? 0 : 26 - (imm), ((imm) & 0xf0) ? 0 : 27 - (imm), \
      ((imm) & 0xf0) ? 0 : 28 - (imm), ((imm) & 0xf0) ? 0 : 29 - (imm), ((imm) & 0xf0) ? 0 : 30 - (imm), \
      ((imm) & 0xf0) ? 0 : 31 - (imm)))
#define _mm_bsrli_si128(a, imm) _mm_srli_si128((a), (imm))
#define _mm_bslli_si128(a, imm) _mm_slli_si128((a), (imm))

/* Shuffles. */

#define _mm_shuffle_epi32(a, imm) \
  ((__m128i)__builtin_shufflevector((__v4si)(__m128i)(a), (__v4si)(__m128i)(a), (imm) & 3, ((imm) >> 2) & 3, \
                                    ((imm) >> 4) & 3, ((imm) >> 6) & 3))

__BUN_CC_INTRIN __m128i _mm_unpacklo_epi8(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_shufflevector((__v16qi)__a, (__v16qi)__b, 0, 16, 1, 17, 2, 18, 3, 19, 4, 20, 5, 21, 6,
                                          22, 7, 23);
}
__BUN_CC_INTRIN __m128i _mm_unpackhi_epi8(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_shufflevector((__v16qi)__a, (__v16qi)__b, 8, 24, 9, 25, 10, 26, 11, 27, 12, 28, 13, 29,
                                          14, 30, 15, 31);
}
__BUN_CC_INTRIN __m128i _mm_unpacklo_epi16(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 0, 8, 1, 9, 2, 10, 3, 11);
}
__BUN_CC_INTRIN __m128i _mm_unpackhi_epi16(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 4, 12, 5, 13, 6, 14, 7, 15);
}
__BUN_CC_INTRIN __m128i _mm_unpacklo_epi32(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_shufflevector((__v4si)__a, (__v4si)__b, 0, 4, 1, 5);
}
__BUN_CC_INTRIN __m128i _mm_unpackhi_epi32(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_shufflevector((__v4si)__a, (__v4si)__b, 2, 6, 3, 7);
}
__BUN_CC_INTRIN __m128i _mm_unpacklo_epi64(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_shufflevector((__v2di)__a, (__v2di)__b, 0, 2);
}
__BUN_CC_INTRIN __m128i _mm_unpackhi_epi64(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_shufflevector((__v2di)__a, (__v2di)__b, 1, 3);
}

#define _mm_extract_epi16(a, imm) ((int)(unsigned short)((__v8hi)(__m128i)(a))[(imm) & 7])
#define _mm_insert_epi16(a, w, imm) \
  __extension__({ __v8hi __bun_v = (__v8hi)(__m128i)(a); __bun_v[(imm) & 7] = (short)(w); (__m128i)__bun_v; })

/* Conversions and casts. */

__BUN_CC_INTRIN __m128 _mm_cvtepi32_ps(__m128i __a) { return __builtin_convertvector((__v4si)__a, __v4sf); }
/* CVTTPS2DQ and CVTTPD2DQ give the "integer indefinite" 0x80000000 for a NaN and for what does not fit; the vector
   conversion saturates, so those lanes are put right afterwards. */
__BUN_CC_INTRIN __m128i _mm_cvttps_epi32(__m128 __a) {
  __v4si __fits = (__v4si)(__a >= -2147483648.0f) & (__v4si)(__a < 2147483648.0f);
  return (__m128i)((__builtin_convertvector(__a, __v4si) & __fits) | (~__fits & (__v4si){-2147483647 - 1, -2147483647 - 1, -2147483647 - 1, -2147483647 - 1}));
}
__BUN_CC_INTRIN __m128d _mm_cvtepi32_pd(__m128i __a) { return __builtin_ia32_cvtdq2pd((__v4si)__a); }
__BUN_CC_INTRIN __m128i _mm_cvttpd_epi32(__m128d __a) {
  __v2di __fits64 = (__v2di)(__a >= -2147483648.0) & (__v2di)(__a < 2147483648.0);
  __v4si __fits = __builtin_shufflevector((__v4si)__fits64, (__v4si){-1, -1, -1, -1}, 0, 2, 4, 5);
  return (__m128i)(((__v4si)__builtin_ia32_cvttpd2dq(__a) & __fits) | (~__fits & (__v4si){-2147483647 - 1, -2147483647 - 1, 0, 0}));
}
/* The scalar forms (CVTTSD2SI) likewise: the indefinite value for a NaN and for what does not fit. */
__BUN_CC_INTRIN int _mm_cvttsd_si32(__m128d __a) { return __a[0] >= -2147483648.0 && __a[0] < 2147483648.0 ? (int)__a[0] : -2147483647 - 1; }
__BUN_CC_INTRIN long long _mm_cvttsd_si64(__m128d __a) { return __a[0] >= -9223372036854775808.0 && __a[0] < 9223372036854775808.0 ? (long long)__a[0] : -9223372036854775807LL - 1; }
#define _mm_cvttsd_si64x _mm_cvttsd_si64
__BUN_CC_INTRIN __m128d _mm_cvtps_pd(__m128 __a) { return __builtin_ia32_cvtps2pd(__a); }
__BUN_CC_INTRIN __m128 _mm_cvtpd_ps(__m128d __a) { return __builtin_ia32_cvtpd2ps(__a); }

__BUN_CC_INTRIN __m128 _mm_castpd_ps(__m128d __a) { return (__m128)__a; }
__BUN_CC_INTRIN __m128i _mm_castpd_si128(__m128d __a) { return (__m128i)__a; }
__BUN_CC_INTRIN __m128d _mm_castps_pd(__m128 __a) { return (__m128d)__a; }
__BUN_CC_INTRIN __m128i _mm_castps_si128(__m128 __a) { return (__m128i)__a; }
__BUN_CC_INTRIN __m128 _mm_castsi128_ps(__m128i __a) { return (__m128)__a; }
__BUN_CC_INTRIN __m128d _mm_castsi128_pd(__m128i __a) { return (__m128d)__a; }


/* Scalar double-precision: lane 0 is computed, lane 1 comes from the first operand. */

__BUN_CC_INTRIN __m128d _mm_add_sd(__m128d __a, __m128d __b) { __a[0] = __a[0] + __b[0]; return __a; }
__BUN_CC_INTRIN __m128d _mm_sub_sd(__m128d __a, __m128d __b) { __a[0] = __a[0] - __b[0]; return __a; }
__BUN_CC_INTRIN __m128d _mm_mul_sd(__m128d __a, __m128d __b) { __a[0] = __a[0] * __b[0]; return __a; }
__BUN_CC_INTRIN __m128d _mm_div_sd(__m128d __a, __m128d __b) { __a[0] = __a[0] / __b[0]; return __a; }
__BUN_CC_INTRIN __m128d _mm_sqrt_sd(__m128d __a, __m128d __b) { __a[0] = __builtin_elementwise_sqrt(__b)[0]; return __a; }
__BUN_CC_INTRIN __m128d _mm_min_sd(__m128d __a, __m128d __b) { __a[0] = __builtin_elementwise_min(__b, __a)[0]; return __a; }
__BUN_CC_INTRIN __m128d _mm_max_sd(__m128d __a, __m128d __b) { __a[0] = __builtin_elementwise_max(__b, __a)[0]; return __a; }
__BUN_CC_INTRIN __m128d _mm_move_sd(__m128d __a, __m128d __b) { __a[0] = __b[0]; return __a; }

__BUN_CC_INTRIN __m128d _mm_cmpnlt_pd(__m128d __a, __m128d __b) { return (__m128d)~(__v2di)(__a < __b); }
__BUN_CC_INTRIN __m128d _mm_cmpnle_pd(__m128d __a, __m128d __b) { return (__m128d)~(__v2di)(__a <= __b); }
__BUN_CC_INTRIN __m128d _mm_cmpngt_pd(__m128d __a, __m128d __b) { return (__m128d)~(__v2di)(__a > __b); }
__BUN_CC_INTRIN __m128d _mm_cmpnge_pd(__m128d __a, __m128d __b) { return (__m128d)~(__v2di)(__a >= __b); }
__BUN_CC_INTRIN __m128d _mm_cmpord_pd(__m128d __a, __m128d __b) { return (__m128d)((__v2di)(__a == __a) & (__v2di)(__b == __b)); }
__BUN_CC_INTRIN __m128d _mm_cmpunord_pd(__m128d __a, __m128d __b) { return (__m128d)~((__v2di)(__a == __a) & (__v2di)(__b == __b)); }
#define __BUN_CC_CMP_SD(name) \
  __BUN_CC_INTRIN __m128d _mm_cmp##name##_sd(__m128d __a, __m128d __b) { \
    __m128d __c = _mm_cmp##name##_pd(__a, __b); \
    __a[0] = __c[0]; \
    return __a; \
  }
__BUN_CC_CMP_SD(eq) __BUN_CC_CMP_SD(lt) __BUN_CC_CMP_SD(le) __BUN_CC_CMP_SD(gt) __BUN_CC_CMP_SD(ge) __BUN_CC_CMP_SD(neq)
__BUN_CC_CMP_SD(nlt) __BUN_CC_CMP_SD(nle) __BUN_CC_CMP_SD(ngt) __BUN_CC_CMP_SD(nge) __BUN_CC_CMP_SD(ord) __BUN_CC_CMP_SD(unord)
#undef __BUN_CC_CMP_SD

__BUN_CC_INTRIN int _mm_comieq_sd(__m128d __a, __m128d __b) { return __a[0] == __b[0]; }
__BUN_CC_INTRIN int _mm_comilt_sd(__m128d __a, __m128d __b) { return __a[0] < __b[0]; }
__BUN_CC_INTRIN int _mm_comile_sd(__m128d __a, __m128d __b) { return __a[0] <= __b[0]; }
__BUN_CC_INTRIN int _mm_comigt_sd(__m128d __a, __m128d __b) { return __a[0] > __b[0]; }
__BUN_CC_INTRIN int _mm_comige_sd(__m128d __a, __m128d __b) { return __a[0] >= __b[0]; }
__BUN_CC_INTRIN int _mm_comineq_sd(__m128d __a, __m128d __b) { return __a[0] != __b[0]; }
__BUN_CC_INTRIN int _mm_ucomieq_sd(__m128d __a, __m128d __b) { return __a[0] == __b[0]; }
__BUN_CC_INTRIN int _mm_ucomilt_sd(__m128d __a, __m128d __b) { return __a[0] < __b[0]; }
__BUN_CC_INTRIN int _mm_ucomile_sd(__m128d __a, __m128d __b) { return __a[0] <= __b[0]; }
__BUN_CC_INTRIN int _mm_ucomigt_sd(__m128d __a, __m128d __b) { return __a[0] > __b[0]; }
__BUN_CC_INTRIN int _mm_ucomige_sd(__m128d __a, __m128d __b) { return __a[0] >= __b[0]; }
__BUN_CC_INTRIN int _mm_ucomineq_sd(__m128d __a, __m128d __b) { return __a[0] != __b[0]; }

__BUN_CC_INTRIN __m128 _mm_cvtsd_ss(__m128 __a, __m128d __b) { __a[0] = (float)__b[0]; return __a; }
__BUN_CC_INTRIN __m128d _mm_cvtss_sd(__m128d __a, __m128 __b) { __a[0] = (double)__b[0]; return __a; }
__BUN_CC_INTRIN __m128d _mm_cvtsi32_sd(__m128d __a, int __b) { __a[0] = (double)__b; return __a; }
__BUN_CC_INTRIN __m128d _mm_cvtsi64_sd(__m128d __a, long long __b) { __a[0] = (double)__b; return __a; }

__BUN_CC_INTRIN __m128d _mm_load_pd1(const double *__p) { return _mm_set1_pd(*__p); }
__BUN_CC_INTRIN __m128d _mm_loadr_pd(const double *__p) {
  __m128d __a = *(const __m128d *)__p;
  return __builtin_shufflevector(__a, __a, 1, 0);
}
__BUN_CC_INTRIN __m128d _mm_loadh_pd(__m128d __a, const double *__p) { __a[1] = *__p; return __a; }
__BUN_CC_INTRIN __m128d _mm_loadl_pd(__m128d __a, const double *__p) { __a[0] = *__p; return __a; }
__BUN_CC_INTRIN void _mm_store1_pd(double *__p, __m128d __a) { *(__m128d *)__p = __builtin_shufflevector(__a, __a, 0, 0); }
__BUN_CC_INTRIN void _mm_store_pd1(double *__p, __m128d __a) { *(__m128d *)__p = __builtin_shufflevector(__a, __a, 0, 0); }
__BUN_CC_INTRIN void _mm_storer_pd(double *__p, __m128d __a) { *(__m128d *)__p = __builtin_shufflevector(__a, __a, 1, 0); }
__BUN_CC_INTRIN void _mm_storeh_pd(double *__p, __m128d __a) { *__p = __a[1]; }
__BUN_CC_INTRIN void _mm_storel_pd(double *__p, __m128d __a) { *__p = __a[0]; }
__BUN_CC_INTRIN __m128d _mm_undefined_pd(void) { return (__m128d){0.0, 0.0}; }
__BUN_CC_INTRIN __m128i _mm_undefined_si128(void) { return (__m128i){0LL, 0LL}; }

/* Unaligned partial loads and stores; they go through a packed struct so that no alignment
   is assumed. */
struct __bun_cc_loadu_si16 { short __v; } __attribute__((__packed__));
struct __bun_cc_loadu_si32 { int __v; } __attribute__((__packed__));
struct __bun_cc_loadu_si64 { long long __v; } __attribute__((__packed__));
__BUN_CC_INTRIN __m128i _mm_loadu_si16(const void *__p) {
  return (__m128i)(__v8hi){((const struct __bun_cc_loadu_si16 *)__p)->__v, 0, 0, 0, 0, 0, 0, 0};
}
__BUN_CC_INTRIN __m128i _mm_loadu_si32(const void *__p) {
  return (__m128i)(__v4si){((const struct __bun_cc_loadu_si32 *)__p)->__v, 0, 0, 0};
}
__BUN_CC_INTRIN __m128i _mm_loadu_si64(const void *__p) {
  return (__m128i){((const struct __bun_cc_loadu_si64 *)__p)->__v, 0LL};
}
__BUN_CC_INTRIN void _mm_storeu_si16(void *__p, __m128i __a) { ((struct __bun_cc_loadu_si16 *)__p)->__v = ((__v8hi)__a)[0]; }
__BUN_CC_INTRIN void _mm_storeu_si32(void *__p, __m128i __a) { ((struct __bun_cc_loadu_si32 *)__p)->__v = ((__v4si)__a)[0]; }
__BUN_CC_INTRIN void _mm_storeu_si64(void *__p, __m128i __a) { ((struct __bun_cc_loadu_si64 *)__p)->__v = __a[0]; }

/* Non-temporal stores are ordinary stores here. */
__BUN_CC_INTRIN void _mm_stream_pd(double *__p, __m128d __a) { *(__m128d *)__p = __a; }
__BUN_CC_INTRIN void _mm_stream_si128(__m128i *__p, __m128i __a) { *__p = __a; }
__BUN_CC_INTRIN void _mm_stream_si32(int *__p, int __a) { *__p = __a; }
__BUN_CC_INTRIN void _mm_stream_si64(long long *__p, long long __a) { *__p = __a; }
__BUN_CC_INTRIN void _mm_lfence(void) { __atomic_thread_fence(__ATOMIC_SEQ_CST); }
__BUN_CC_INTRIN void _mm_mfence(void) { __atomic_thread_fence(__ATOMIC_SEQ_CST); }
__BUN_CC_INTRIN void _mm_pause(void) { __asm__ volatile("pause"); }

__BUN_CC_INTRIN __m128i _mm_move_epi64(__m128i __a) { return (__m128i){__a[0], 0LL}; }

/* Stores the bytes of __d whose mask byte has its top bit set. */
__BUN_CC_INTRIN void _mm_maskmoveu_si128(__m128i __d, __m128i __n, char *__p) {
  char __bytes[16], __mask[16];
  *(__m128i_u *)__bytes = __d;
  *(__m128i_u *)__mask = __n;
  for (int __i = 0; __i < 16; __i++)
    if (__mask[__i] < 0) __p[__i] = __bytes[__i];
}

/* Shifts by the low 64 bits of a vector. */
__BUN_CC_INTRIN __m128i _mm_sll_epi16(__m128i __a, __m128i __count) {
  return (unsigned long long)__count[0] > 15 ? _mm_setzero_si128() : (__m128i)((__v8hu)__a << (int)__count[0]);
}
__BUN_CC_INTRIN __m128i _mm_sll_epi32(__m128i __a, __m128i __count) {
  return (unsigned long long)__count[0] > 31 ? _mm_setzero_si128() : (__m128i)((__v4su)__a << (int)__count[0]);
}
__BUN_CC_INTRIN __m128i _mm_sll_epi64(__m128i __a, __m128i __count) {
  return (unsigned long long)__count[0] > 63 ? _mm_setzero_si128() : (__m128i)((__v2du)__a << (int)__count[0]);
}
__BUN_CC_INTRIN __m128i _mm_srl_epi16(__m128i __a, __m128i __count) {
  return (unsigned long long)__count[0] > 15 ? _mm_setzero_si128() : (__m128i)((__v8hu)__a >> (int)__count[0]);
}
__BUN_CC_INTRIN __m128i _mm_srl_epi32(__m128i __a, __m128i __count) {
  return (unsigned long long)__count[0] > 31 ? _mm_setzero_si128() : (__m128i)((__v4su)__a >> (int)__count[0]);
}
__BUN_CC_INTRIN __m128i _mm_srl_epi64(__m128i __a, __m128i __count) {
  return (unsigned long long)__count[0] > 63 ? _mm_setzero_si128() : (__m128i)((__v2du)__a >> (int)__count[0]);
}
__BUN_CC_INTRIN __m128i _mm_sra_epi16(__m128i __a, __m128i __count) {
  return (__m128i)((__v8hi)__a >> ((unsigned long long)__count[0] > 15 ? 15 : (int)__count[0]));
}
__BUN_CC_INTRIN __m128i _mm_sra_epi32(__m128i __a, __m128i __count) {
  return (__m128i)((__v4si)__a >> ((unsigned long long)__count[0] > 31 ? 31 : (int)__count[0]));
}

#define _mm_shufflelo_epi16(a, imm) \
  ((__m128i)__builtin_shufflevector((__v8hi)(__m128i)(a), (__v8hi)(__m128i)(a), (imm) & 3, ((imm) >> 2) & 3, \
      ((imm) >> 4) & 3, ((imm) >> 6) & 3, 4, 5, 6, 7))
#define _mm_shufflehi_epi16(a, imm) \
  ((__m128i)__builtin_shufflevector((__v8hi)(__m128i)(a), (__v8hi)(__m128i)(a), 0, 1, 2, 3, 4 + ((imm) & 3), \
      4 + (((imm) >> 2) & 3), 4 + (((imm) >> 4) & 3), 4 + (((imm) >> 6) & 3)))

#endif

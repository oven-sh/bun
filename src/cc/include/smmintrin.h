/* SSE4.1 intrinsics for x86-64 targets, written over the vector extensions. Only what is
   defined here exists. */
#ifndef __BUN_CC_SMMINTRIN_H
#define __BUN_CC_SMMINTRIN_H

#include <tmmintrin.h>

__BUN_CC_INTRIN __m128i _mm_mullo_epi32(__m128i __a, __m128i __b) { return (__m128i)((__v4su)__a * (__v4su)__b); }

__BUN_CC_INTRIN __m128i _mm_min_epi8(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_min((__v16qs)__a, (__v16qs)__b);
}
__BUN_CC_INTRIN __m128i _mm_max_epi8(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_max((__v16qs)__a, (__v16qs)__b);
}
__BUN_CC_INTRIN __m128i _mm_min_epu16(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_min((__v8hu)__a, (__v8hu)__b);
}
__BUN_CC_INTRIN __m128i _mm_max_epu16(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_max((__v8hu)__a, (__v8hu)__b);
}
__BUN_CC_INTRIN __m128i _mm_min_epi32(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_min((__v4si)__a, (__v4si)__b);
}
__BUN_CC_INTRIN __m128i _mm_max_epi32(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_max((__v4si)__a, (__v4si)__b);
}
__BUN_CC_INTRIN __m128i _mm_min_epu32(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_min((__v4su)__a, (__v4su)__b);
}
__BUN_CC_INTRIN __m128i _mm_max_epu32(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_elementwise_max((__v4su)__a, (__v4su)__b);
}

__BUN_CC_INTRIN __m128i _mm_packus_epi32(__m128i __a, __m128i __b) { return (__m128i)__builtin_ia32_packusdw128((__v4si)__a, (__v4si)__b); }

__BUN_CC_INTRIN __m128i _mm_cmpeq_epi64(__m128i __a, __m128i __b) { return (__m128i)((__v2di)__a == (__v2di)__b); }

/* The most significant bit of each mask lane selects from __b. */
__BUN_CC_INTRIN __m128i _mm_blendv_epi8(__m128i __a, __m128i __b, __m128i __mask) {
  return (__m128i)(((__v16qs)__mask < 0) ? (__v16qs)__b : (__v16qs)__a);
}
__BUN_CC_INTRIN __m128 _mm_blendv_ps(__m128 __a, __m128 __b, __m128 __mask) {
  return (__m128)(((__v4si)__mask < 0) ? (__v4si)__b : (__v4si)__a);
}
__BUN_CC_INTRIN __m128d _mm_blendv_pd(__m128d __a, __m128d __b, __m128d __mask) {
  return (__m128d)(((__v2di)__mask < 0) ? (__v2di)__b : (__v2di)__a);
}

__BUN_CC_INTRIN int _mm_testz_si128(__m128i __a, __m128i __b) {
  return __builtin_ia32_ptestz128((__v2di)__a, (__v2di)__b);
}

#define _mm_extract_epi8(a, imm) ((int)(unsigned char)((__v16qi)(__m128i)(a))[(imm) & 15])
#define _mm_extract_epi32(a, imm) ((int)((__v4si)(__m128i)(a))[(imm) & 3])
#define _mm_extract_epi64(a, imm) ((long long)((__v2di)(__m128i)(a))[(imm) & 1])
#define _mm_insert_epi8(a, b, imm) \
  __extension__({ __v16qi __bun_v = (__v16qi)(__m128i)(a); __bun_v[(imm) & 15] = (char)(b); (__m128i)__bun_v; })
#define _mm_insert_epi32(a, i, imm) \
  __extension__({ __v4si __bun_v = (__v4si)(__m128i)(a); __bun_v[(imm) & 3] = (int)(i); (__m128i)__bun_v; })
#define _mm_insert_epi64(a, q, imm) \
  __extension__({ __v2di __bun_v = (__v2di)(__m128i)(a); __bun_v[(imm) & 1] = (long long)(q); (__m128i)__bun_v; })

/* Widening conversions of the low lanes. */
__BUN_CC_INTRIN __m128i _mm_cvtepi8_epi16(__m128i __a) { return (__m128i)__builtin_ia32_pmovsxbw128((__v16qi)__a); }
__BUN_CC_INTRIN __m128i _mm_cvtepu8_epi16(__m128i __a) { return (__m128i)__builtin_ia32_pmovzxbw128((__v16qi)__a); }
__BUN_CC_INTRIN __m128i _mm_cvtepi16_epi32(__m128i __a) { return (__m128i)__builtin_ia32_pmovsxwd128((__v8hi)__a); }
__BUN_CC_INTRIN __m128i _mm_cvtepu16_epi32(__m128i __a) { return (__m128i)__builtin_ia32_pmovzxwd128((__v8hi)__a); }
__BUN_CC_INTRIN __m128i _mm_cvtepi32_epi64(__m128i __a) { return (__m128i)__builtin_ia32_pmovsxdq128((__v4si)__a); }
__BUN_CC_INTRIN __m128i _mm_cvtepu32_epi64(__m128i __a) { return (__m128i)__builtin_ia32_pmovzxdq128((__v4si)__a); }


#define _mm_blend_epi16(a, b, imm) \
  ((__m128i)__builtin_shufflevector((__v8hi)(__m128i)(a), (__v8hi)(__m128i)(b), ((imm) & 1) ? 8 : 0, \
      ((imm) & 2) ? 9 : 1, ((imm) & 4) ? 10 : 2, ((imm) & 8) ? 11 : 3, ((imm) & 16) ? 12 : 4, \
      ((imm) & 32) ? 13 : 5, ((imm) & 64) ? 14 : 6, ((imm) & 128) ? 15 : 7))
#define _mm_blend_ps(a, b, imm) \
  ((__m128)__builtin_shufflevector((__v4sf)(__m128)(a), (__v4sf)(__m128)(b), ((imm) & 1) ? 4 : 0, \
      ((imm) & 2) ? 5 : 1, ((imm) & 4) ? 6 : 2, ((imm) & 8) ? 7 : 3))
#define _mm_blend_pd(a, b, imm) \
  ((__m128d)__builtin_shufflevector((__v2df)(__m128d)(a), (__v2df)(__m128d)(b), ((imm) & 1) ? 2 : 0, \
      ((imm) & 2) ? 3 : 1))

__BUN_CC_INTRIN __m128i _mm_cvtepi8_epi32(__m128i __a) { return _mm_cvtepi16_epi32(_mm_cvtepi8_epi16(__a)); }
__BUN_CC_INTRIN __m128i _mm_cvtepu8_epi32(__m128i __a) { return _mm_cvtepu16_epi32(_mm_cvtepu8_epi16(__a)); }
__BUN_CC_INTRIN __m128i _mm_cvtepi16_epi64(__m128i __a) { return _mm_cvtepi32_epi64(_mm_cvtepi16_epi32(__a)); }
__BUN_CC_INTRIN __m128i _mm_cvtepu16_epi64(__m128i __a) { return _mm_cvtepu32_epi64(_mm_cvtepu16_epi32(__a)); }
__BUN_CC_INTRIN __m128i _mm_cvtepi8_epi64(__m128i __a) { return _mm_cvtepi32_epi64(_mm_cvtepi8_epi32(__a)); }
__BUN_CC_INTRIN __m128i _mm_cvtepu8_epi64(__m128i __a) { return _mm_cvtepu32_epi64(_mm_cvtepu8_epi32(__a)); }

__BUN_CC_INTRIN __m128i _mm_cmpgt_epi64(__m128i __a, __m128i __b) { return (__m128i)((__v2di)__a > (__v2di)__b); }
__BUN_CC_INTRIN __m128i _mm_mul_epi32(__m128i __a, __m128i __b) {
  return (__m128i)((((__v2di)__a << 32) >> 32) * (((__v2di)__b << 32) >> 32));
}
#define _mm_extract_ps(a, imm) (((__v4si)(__m128)(a))[(imm) & 3])
__BUN_CC_INTRIN __m128i _mm_stream_load_si128(const void *__p) { return *(const __m128i *)__p; }

__BUN_CC_INTRIN int _mm_testc_si128(__m128i __a, __m128i __b) { return _mm_testz_si128(~__a, __b); }
__BUN_CC_INTRIN int _mm_testnzc_si128(__m128i __a, __m128i __b) {
  return !_mm_testz_si128(__a, __b) && !_mm_testz_si128(~__a, __b);
}
#define _mm_test_all_zeros(a, mask) _mm_testz_si128((a), (mask))
#define _mm_test_mix_ones_zeros(a, mask) _mm_testnzc_si128((a), (mask))
#define _mm_test_all_ones(a) _mm_testc_si128((a), (__m128i){-1LL, -1LL})

#endif

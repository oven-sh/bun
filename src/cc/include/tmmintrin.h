/* SSSE3 intrinsics for x86-64 targets, written over the vector extensions. Only what is
   defined here exists. */
#ifndef __BUN_CC_TMMINTRIN_H
#define __BUN_CC_TMMINTRIN_H

#include <emmintrin.h>

/* A byte with its top bit set in the index gives 0; otherwise the low four bits pick. */
__BUN_CC_INTRIN __m128i _mm_shuffle_epi8(__m128i __a, __m128i __b) {
  return (__m128i)__builtin_bir_swizzle((__v16qi)__a, (__v16qi)__b & (char)0x8f);
}

/* Bytes (imm) .. (imm)+15 of the 32 bytes a:b (b is the low half). */
#define _mm_alignr_epi8(a, b, imm) \
  ((__m128i)((unsigned)(imm) <= 16 \
      ? __builtin_shufflevector((__v16qi)(__m128i)(b), (__v16qi)(__m128i)(a), ((imm) + 0) & 31, ((imm) + 1) & 31, ((imm) + 2) & 31, ((imm) + 3) & 31, ((imm) + 4) & 31, ((imm) + 5) & 31, ((imm) + 6) & 31, ((imm) + 7) & 31, ((imm) + 8) & 31, ((imm) + 9) & 31, ((imm) + 10) & 31, ((imm) + 11) & 31, ((imm) + 12) & 31, ((imm) + 13) & 31, ((imm) + 14) & 31, ((imm) + 15) & 31) \
      : (unsigned)(imm) < 32 \
      ? __builtin_shufflevector((__v16qi)(__m128i)(a), (__v16qi)_mm_setzero_si128(), ((imm) - 16 + 0) & 31, ((imm) - 16 + 1) & 31, ((imm) - 16 + 2) & 31, ((imm) - 16 + 3) & 31, ((imm) - 16 + 4) & 31, ((imm) - 16 + 5) & 31, ((imm) - 16 + 6) & 31, ((imm) - 16 + 7) & 31, ((imm) - 16 + 8) & 31, ((imm) - 16 + 9) & 31, ((imm) - 16 + 10) & 31, ((imm) - 16 + 11) & 31, ((imm) - 16 + 12) & 31, ((imm) - 16 + 13) & 31, ((imm) - 16 + 14) & 31, ((imm) - 16 + 15) & 31) \
      : (__v16qi)_mm_setzero_si128()))

__BUN_CC_INTRIN __m128i _mm_abs_epi8(__m128i __a) { return (__m128i)__builtin_elementwise_abs((__v16qs)__a); }
__BUN_CC_INTRIN __m128i _mm_abs_epi16(__m128i __a) { return (__m128i)__builtin_elementwise_abs((__v8hi)__a); }
__BUN_CC_INTRIN __m128i _mm_abs_epi32(__m128i __a) { return (__m128i)__builtin_elementwise_abs((__v4si)__a); }

__BUN_CC_INTRIN __m128i _mm_hadd_epi16(__m128i __a, __m128i __b) {
  return (__m128i)((__v8hu)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 0, 2, 4, 6, 8, 10, 12, 14) +
                   (__v8hu)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 1, 3, 5, 7, 9, 11, 13, 15));
}
__BUN_CC_INTRIN __m128i _mm_hadd_epi32(__m128i __a, __m128i __b) {
  return (__m128i)((__v4su)__builtin_shufflevector((__v4si)__a, (__v4si)__b, 0, 2, 4, 6) +
                   (__v4su)__builtin_shufflevector((__v4si)__a, (__v4si)__b, 1, 3, 5, 7));
}
__BUN_CC_INTRIN __m128i _mm_hsub_epi16(__m128i __a, __m128i __b) {
  return (__m128i)((__v8hu)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 0, 2, 4, 6, 8, 10, 12, 14) -
                   (__v8hu)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 1, 3, 5, 7, 9, 11, 13, 15));
}
__BUN_CC_INTRIN __m128i _mm_hsub_epi32(__m128i __a, __m128i __b) {
  return (__m128i)((__v4su)__builtin_shufflevector((__v4si)__a, (__v4si)__b, 0, 2, 4, 6) -
                   (__v4su)__builtin_shufflevector((__v4si)__a, (__v4si)__b, 1, 3, 5, 7));
}
__BUN_CC_INTRIN __m128i _mm_hadds_epi16(__m128i __a, __m128i __b) {
  return _mm_adds_epi16((__m128i)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 0, 2, 4, 6, 8, 10, 12, 14),
                        (__m128i)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 1, 3, 5, 7, 9, 11, 13, 15));
}

/* a negated where b is negative, zeroed where b is zero. */
__BUN_CC_INTRIN __m128i _mm_sign_epi8(__m128i __a, __m128i __b) {
  __v16qs __x = (__v16qs)__a, __y = (__v16qs)__b;
  return (__m128i)(((__y < 0) ? -__x : __x) & (__y != 0));
}
__BUN_CC_INTRIN __m128i _mm_sign_epi16(__m128i __a, __m128i __b) {
  __v8hi __x = (__v8hi)__a, __y = (__v8hi)__b;
  return (__m128i)(((__y < 0) ? -__x : __x) & (__y != 0));
}
__BUN_CC_INTRIN __m128i _mm_sign_epi32(__m128i __a, __m128i __b) {
  __v4si __x = (__v4si)__a, __y = (__v4si)__b;
  return (__m128i)(((__y < 0) ? -__x : __x) & (__y != 0));
}

/* Unsigned bytes of a times signed bytes of b, adjacent products added with saturation. */
__BUN_CC_INTRIN __m128i _mm_maddubs_epi16(__m128i __a, __m128i __b) {
  __v8hi __a_even = (__v8hi)((__v8hu)__a & 0xff), __a_odd = (__v8hi)((__v8hu)__a >> 8);
  __v8hi __b_even = ((__v8hi)__b << 8) >> 8, __b_odd = (__v8hi)__b >> 8;
  return _mm_adds_epi16((__m128i)(__a_even * __b_even), (__m128i)(__a_odd * __b_odd));
}


__BUN_CC_INTRIN __m128i _mm_hsubs_epi16(__m128i __a, __m128i __b) {
  return _mm_subs_epi16((__m128i)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 0, 2, 4, 6, 8, 10, 12, 14),
                        (__m128i)__builtin_shufflevector((__v8hi)__a, (__v8hi)__b, 1, 3, 5, 7, 9, 11, 13, 15));
}
/* ((a * b >> 14) + 1) >> 1 on each signed 16-bit lane, computed in 32 bits. */
__BUN_CC_INTRIN __m128i _mm_mulhrs_epi16(__m128i __a, __m128i __b) {
  __m128i __low = _mm_mullo_epi16(__a, __b), __high = _mm_mulhi_epi16(__a, __b);
  __v4si __p0 = (__v4si)_mm_unpacklo_epi16(__low, __high), __p1 = (__v4si)_mm_unpackhi_epi16(__low, __high);
  __p0 = ((__p0 >> 14) + 1) >> 1;
  __p1 = ((__p1 >> 14) + 1) >> 1;
  return (__m128i)__builtin_shufflevector((__v8hi)__p0, (__v8hi)__p1, 0, 2, 4, 6, 8, 10, 12, 14);
}

#endif

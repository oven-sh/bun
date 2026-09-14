/* The umbrella header for the x86-64 intrinsics this compiler provides: SSE, SSE2, SSSE3 and SSE4.1. */
#ifndef __BUN_CC_IMMINTRIN_H
#define __BUN_CC_IMMINTRIN_H

#include <xmmintrin.h>
#include <emmintrin.h>
#include <tmmintrin.h>
#include <smmintrin.h>

/* 256 bits as two halves. There are no 32-byte registers here (__AVX2__ is not defined), but
   Microsoft's <wchar.h> compiles its AVX2 paths in whatever the compiler says and chooses them
   when the processor has them: what it uses, and the plain operations around it, work. */
typedef struct __attribute__((__aligned__(32))) __m256i { __m128i __lo, __hi; } __m256i;
__BUN_CC_INTRIN __m256i _mm256_setzero_si256(void) { return (__m256i){_mm_setzero_si128(), _mm_setzero_si128()}; }
__BUN_CC_INTRIN __m256i _mm256_set1_epi8(char __b) { return (__m256i){_mm_set1_epi8(__b), _mm_set1_epi8(__b)}; }
__BUN_CC_INTRIN __m256i _mm256_set1_epi16(short __w) { return (__m256i){_mm_set1_epi16(__w), _mm_set1_epi16(__w)}; }
__BUN_CC_INTRIN __m256i _mm256_set1_epi32(int __i) { return (__m256i){_mm_set1_epi32(__i), _mm_set1_epi32(__i)}; }
__BUN_CC_INTRIN __m256i _mm256_broadcastb_epi8(__m128i __a) { return _mm256_set1_epi8((char)_mm_cvtsi128_si32(__a)); }
__BUN_CC_INTRIN __m256i _mm256_broadcastw_epi16(__m128i __a) { return _mm256_set1_epi16((short)_mm_cvtsi128_si32(__a)); }
__BUN_CC_INTRIN __m256i _mm256_broadcastd_epi32(__m128i __a) { return _mm256_set1_epi32(_mm_cvtsi128_si32(__a)); }
__BUN_CC_INTRIN __m256i _mm256_loadu_si256(const __m256i *__p) { return (__m256i){_mm_loadu_si128((const __m128i *)__p), _mm_loadu_si128((const __m128i *)__p + 1)}; }
__BUN_CC_INTRIN __m256i _mm256_load_si256(const __m256i *__p) { return _mm256_loadu_si256(__p); }
__BUN_CC_INTRIN void _mm256_storeu_si256(__m256i *__p, __m256i __a) { _mm_storeu_si128((__m128i *)__p, __a.__lo); _mm_storeu_si128((__m128i *)__p + 1, __a.__hi); }
__BUN_CC_INTRIN void _mm256_store_si256(__m256i *__p, __m256i __a) { _mm256_storeu_si256(__p, __a); }
__BUN_CC_INTRIN __m128i _mm256_castsi256_si128(__m256i __a) { return __a.__lo; }
__BUN_CC_INTRIN __m256i _mm256_and_si256(__m256i __a, __m256i __b) { return (__m256i){_mm_and_si128(__a.__lo, __b.__lo), _mm_and_si128(__a.__hi, __b.__hi)}; }
__BUN_CC_INTRIN __m256i _mm256_or_si256(__m256i __a, __m256i __b) { return (__m256i){_mm_or_si128(__a.__lo, __b.__lo), _mm_or_si128(__a.__hi, __b.__hi)}; }
__BUN_CC_INTRIN __m256i _mm256_xor_si256(__m256i __a, __m256i __b) { return (__m256i){_mm_xor_si128(__a.__lo, __b.__lo), _mm_xor_si128(__a.__hi, __b.__hi)}; }
__BUN_CC_INTRIN __m256i _mm256_cmpeq_epi8(__m256i __a, __m256i __b) { return (__m256i){_mm_cmpeq_epi8(__a.__lo, __b.__lo), _mm_cmpeq_epi8(__a.__hi, __b.__hi)}; }
__BUN_CC_INTRIN __m256i _mm256_cmpeq_epi16(__m256i __a, __m256i __b) { return (__m256i){_mm_cmpeq_epi16(__a.__lo, __b.__lo), _mm_cmpeq_epi16(__a.__hi, __b.__hi)}; }
__BUN_CC_INTRIN __m256i _mm256_cmpeq_epi32(__m256i __a, __m256i __b) { return (__m256i){_mm_cmpeq_epi32(__a.__lo, __b.__lo), _mm_cmpeq_epi32(__a.__hi, __b.__hi)}; }
__BUN_CC_INTRIN int _mm256_movemask_epi8(__m256i __a) { return (int)((unsigned)_mm_movemask_epi8(__a.__lo) | ((unsigned)_mm_movemask_epi8(__a.__hi) << 16)); }

#endif

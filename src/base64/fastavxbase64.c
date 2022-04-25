#if defined(__GNUC__) && (defined(__x86_64__) || defined(__i386__))
#include "fastavxbase64.h"

#include <stdbool.h>
#include <x86intrin.h>

/**
 * This code borrows from Wojciech Mula's library at
 * https://github.com/WojciechMula/base64simd (published under BSD)
 * as well as code from Alfred Klomp's library https://github.com/aklomp/base64
 * (published under BSD)
 *
 */

/**
 * Note : Hardware such as Knights Landing might do poorly with this AVX2 code
 * since it relies on shuffles. Alternatives might be faster.
 */

static inline __m256i enc_reshuffle(const __m256i input) {

  // translation from SSE into AVX2 of procedure
  // https://github.com/WojciechMula/base64simd/blob/master/encode/unpack_bigendian.cpp
  const __m256i in = _mm256_shuffle_epi8(
      input,
      _mm256_set_epi8(10, 11, 9, 10, 7, 8, 6, 7, 4, 5, 3, 4, 1, 2, 0, 1,

                      14, 15, 13, 14, 11, 12, 10, 11, 8, 9, 7, 8, 5, 6, 4, 5));

  const __m256i t0 = _mm256_and_si256(in, _mm256_set1_epi32(0x0fc0fc00));
  const __m256i t1 = _mm256_mulhi_epu16(t0, _mm256_set1_epi32(0x04000040));

  const __m256i t2 = _mm256_and_si256(in, _mm256_set1_epi32(0x003f03f0));
  const __m256i t3 = _mm256_mullo_epi16(t2, _mm256_set1_epi32(0x01000010));

  return _mm256_or_si256(t1, t3);
}

static inline __m256i enc_translate(const __m256i in) {
  const __m256i lut = _mm256_setr_epi8(
      65, 71, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -19, -16, 0, 0, 65, 71,
      -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -19, -16, 0, 0);
  __m256i indices = _mm256_subs_epu8(in, _mm256_set1_epi8(51));
  __m256i mask = _mm256_cmpgt_epi8((in), _mm256_set1_epi8(25));
  indices = _mm256_sub_epi8(indices, mask);
  __m256i out = _mm256_add_epi8(in, _mm256_shuffle_epi8(lut, indices));
  return out;
}

static inline __m256i dec_reshuffle(__m256i in) {

  // inlined procedure pack_madd from
  // https://github.com/WojciechMula/base64simd/blob/master/decode/pack.avx2.cpp
  // The only difference is that elements are reversed,
  // only the multiplication constants were changed.

  const __m256i merge_ab_and_bc = _mm256_maddubs_epi16(
      in,
      _mm256_set1_epi32(0x01400140)); //_mm256_maddubs_epi16 is likely expensive
  __m256i out =
      _mm256_madd_epi16(merge_ab_and_bc, _mm256_set1_epi32(0x00011000));
  // end of inlined

  // Pack bytes together within 32-bit words, discarding words 3 and 7:
  out = _mm256_shuffle_epi8(out, _mm256_setr_epi8(2, 1, 0, 6, 5, 4, 10, 9, 8,
                                                  14, 13, 12, -1, -1, -1, -1, 2,
                                                  1, 0, 6, 5, 4, 10, 9, 8, 14,
                                                  13, 12, -1, -1, -1, -1));
  // the call to _mm256_permutevar8x32_epi32 could be replaced by a call to
  // _mm256_storeu2_m128i but it is doubtful that it would help
  return _mm256_permutevar8x32_epi32(
      out, _mm256_setr_epi32(0, 1, 2, 4, 5, 6, -1, -1));
}

size_t fast_avx2_base64_encode(char *dest, const char *str, size_t len) {
  const char *const dest_orig = dest;
  if (len >= 32 - 4) {
    // first load is masked
    __m256i inputvector = _mm256_maskload_epi32(
        (int const *)(str - 4),
        _mm256_set_epi32(0x80000000, 0x80000000, 0x80000000, 0x80000000,

                         0x80000000, 0x80000000, 0x80000000,
                         0x00000000 // we do not load the first 4 bytes
                         ));
    //////////
    // Intel docs: Faults occur only due to mask-bit required memory accesses
    // that caused the faults. Faults will not occur due to referencing any
    // memory location if the corresponding mask bit for
    // that memory location is 0. For example, no faults will be detected if the
    // mask bits are all zero.
    ////////////
    while (true) {
      inputvector = enc_reshuffle(inputvector);
      inputvector = enc_translate(inputvector);
      _mm256_storeu_si256((__m256i *)dest, inputvector);
      str += 24;
      dest += 32;
      len -= 24;
      if (len >= 32) {
        inputvector =
            _mm256_loadu_si256((__m256i *)(str - 4)); // no need for a mask here
        // we could do a mask load as long as len >= 24
      } else {
        break;
      }
    }
  }
  size_t scalarret = chromium_base64_encode(dest, str, len);
  if (scalarret == MODP_B64_ERROR)
    return MODP_B64_ERROR;
  return (dest - dest_orig) + scalarret;
}

size_t fast_avx2_base64_decode(char *out, const char *src, size_t srclen,
                               size_t *outlen) {
  char *out_orig = out;
  while (srclen >= 45) {

    // The input consists of six character sets in the Base64 alphabet,
    // which we need to map back to the 6-bit values they represent.
    // There are three ranges, two singles, and then there's the rest.
    //
    //  #  From       To        Add  Characters
    //  1  [43]       [62]      +19  +
    //  2  [47]       [63]      +16  /
    //  3  [48..57]   [52..61]   +4  0..9
    //  4  [65..90]   [0..25]   -65  A..Z
    //  5  [97..122]  [26..51]  -71  a..z
    // (6) Everything else => invalid input

    __m256i str = _mm256_loadu_si256((__m256i *)src);

    // code by @aqrit from
    // https://github.com/WojciechMula/base64simd/issues/3#issuecomment-271137490
    // transated into AVX2
    const __m256i lut_lo = _mm256_setr_epi8(
        0x15, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x13, 0x1A,
        0x1B, 0x1B, 0x1B, 0x1A, 0x15, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
        0x11, 0x11, 0x13, 0x1A, 0x1B, 0x1B, 0x1B, 0x1A);
    const __m256i lut_hi = _mm256_setr_epi8(
        0x10, 0x10, 0x01, 0x02, 0x04, 0x08, 0x04, 0x08, 0x10, 0x10, 0x10, 0x10,
        0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x01, 0x02, 0x04, 0x08, 0x04, 0x08,
        0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10);
    const __m256i lut_roll = _mm256_setr_epi8(
        0, 16, 19, 4, -65, -65, -71, -71, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 19, 4,
        -65, -65, -71, -71, 0, 0, 0, 0, 0, 0, 0, 0);

    const __m256i mask_2F = _mm256_set1_epi8(0x2f);

    // lookup
    __m256i hi_nibbles = _mm256_srli_epi32(str, 4);
    __m256i lo_nibbles = _mm256_and_si256(str, mask_2F);

    const __m256i lo = _mm256_shuffle_epi8(lut_lo, lo_nibbles);
    const __m256i eq_2F = _mm256_cmpeq_epi8(str, mask_2F);

    hi_nibbles = _mm256_and_si256(hi_nibbles, mask_2F);
    const __m256i hi = _mm256_shuffle_epi8(lut_hi, hi_nibbles);
    const __m256i roll =
        _mm256_shuffle_epi8(lut_roll, _mm256_add_epi8(eq_2F, hi_nibbles));

    if (!_mm256_testz_si256(lo, hi)) {
      break;
    }

    str = _mm256_add_epi8(str, roll);
    // end of copied function

    srclen -= 32;
    src += 32;

    // end of inlined function

    // Reshuffle the input to packed 12-byte output format:
    str = dec_reshuffle(str);
    _mm256_storeu_si256((__m256i *)out, str);
    out += 24;
  }
  size_t scalarret = chromium_base64_decode(out, src, srclen, outlen);
  *outlen += (out - out_orig);
  if (scalarret == MODP_B64_ERROR)
    return MODP_B64_ERROR;
  return (out - out_orig) + scalarret;
}
#endif
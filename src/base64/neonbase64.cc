// clang-format off
#if defined (__GNUC__) && defined(__ARM_NEON__)

#include <arm_neon.h>
#include <cstddef>
#include "chromiumbase64.h"
#define MODP_B64_ERROR ((size_t)-1)

// #include <iostream>


extern "C" int neon_base64_decode(char *out, const char *src, size_t srclen, size_t *outlen);


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

int neon_base64_decode(char *out, const char *src, size_t srclen, size_t *outlen) {
  char *out_orig = out;
  const uint8x16_t lut_lo = {0x15, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
                             0x11, 0x11, 0x13, 0x1A, 0x1B, 0x1B, 0x1B, 0x1A};
  const uint8x16_t lut_hi = {0x10, 0x10, 0x01, 0x02, 0x04, 0x08, 0x04, 0x08,
                             0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10};
  const uint8x16_t lut_roll = {0, 16, 19, 4, 191, 191, 185, 185,
                               0, 0,  0,  0, 0,   0,   0,   0};
  const uint8x16_t zero8 = vdupq_n_u8(0);
  const uint16x8_t zero16 = vdupq_n_u16(0);
  const uint8x16_t k2f = vdupq_n_u8(0x2f);
  const uint8x16_t kf = vdupq_n_u8(0xf);
  const uint8x8_t cst = {0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40};
  const uint16x4_t cst1 = {0x1000, 0x1000, 0x1000, 0x1000};

  const uint8x8_t shuf0 = {2, 1, 0, 6, 5, 4, 2 + 8, 1 + 8};
  const uint8x8_t shuf1 = {0 + 8,  6 + 8,  5 + 8,  4 + 8,
                           2 + 16, 1 + 16, 0 + 16, 6 + 16};
  const uint8x8_t shuf2 = {5 + 16, 4 + 16, 2 + 24, 1 + 24,
                           0 + 24, 6 + 24, 5 + 24, 4 + 24};

  uint8x8x4_t pack;
  uint8x8_t res[3];
  uint8x16_t str[2];

  while (srclen >= 8 * 4) {
    __builtin_memcpy(str, src, 8 * 4);

    uint8x16_t in0 = str[0];
    uint8x16_t in1 = str[1];
    uint8x16_t lo_nibbles0 = vandq_u8(in0, kf);
    uint8x16_t lo_nibbles1 = vandq_u8(in1, kf);
    uint8x16_t hi_nibbles0 = vshrq_n_u8(in0, 4);
    uint8x16_t hi_nibbles1 = vshrq_n_u8(in1, 4);

    uint8x16_t lo0 = vqtbl1q_u8(lut_lo, lo_nibbles0);
    uint8x16_t lo1 = vqtbl1q_u8(lut_lo, lo_nibbles1);
    uint8x16_t hi0 = vqtbl1q_u8(lut_hi, hi_nibbles0);
    uint8x16_t hi1 = vqtbl1q_u8(lut_hi, hi_nibbles1);
    uint8x16_t test0 = vtstq_u8(lo0, hi0);
    uint8x16_t test1 = vtstq_u8(lo1, hi1);
    uint8x16_t orr0 = vorrq_u8(test0, test1);
    uint8x8_t orr1 = vorr_u8(vget_low_u8(orr0), vget_high_u8(orr0));
    if ((uint64_t)orr1)
      break;

    uint8x16_t eq_2F0 = vceqq_u8(in0, k2f);
    uint8x16_t eq_2F1 = vceqq_u8(in1, k2f);
    uint8x16_t add0 = vaddq_u8(eq_2F0, hi_nibbles0);
    uint8x16_t add1 = vaddq_u8(eq_2F1, hi_nibbles1);
    uint8x16_t roll0 = vqtbl1q_u8(lut_roll, add0);
    uint8x16_t roll1 = vqtbl1q_u8(lut_roll, add1);
    uint8x16_t rolled0 = vaddq_u8(in0, roll0);
    uint8x16_t rolled1 = vaddq_u8(in1, roll1);

    // Step 1: swap and merge adjacent 6-bit fields.
    uint8x16x2_t unzip8 = vuzpq_u8(rolled0, rolled1);
    uint8x16x2_t zip8 = vzipq_u8(unzip8.val[1], zero8);
    uint16x8_t mul0 = vmlal_u8(vreinterpretq_u16_u8(zip8.val[0]),
                               vget_low_u8(unzip8.val[0]), cst);
    uint16x8_t mul1 = vmlal_u8(vreinterpretq_u16_u8(zip8.val[1]),
                               vget_high_u8(unzip8.val[0]), cst);

    // Step 2: swap and merge 12-bit words into a 24-bit word.
    uint16x8x2_t unzip16 = vuzpq_u16(mul0, mul1);
    uint16x8x2_t zip16 = vzipq_u16(unzip16.val[1], zero16);
    uint32x4_t merge0 = vmlal_u16(vreinterpretq_u32_u16(zip16.val[0]),
                                  vget_low_u16(unzip16.val[0]), cst1);
    uint32x4_t merge1 = vmlal_u16(vreinterpretq_u32_u16(zip16.val[1]),
                                  vget_high_u16(unzip16.val[0]), cst1);
    pack.val[0] = vget_low_u8(vreinterpretq_u8_u32(merge0));
    pack.val[1] = vget_high_u8(vreinterpretq_u8_u32(merge0));
    pack.val[2] = vget_low_u8(vreinterpretq_u8_u32(merge1));
    pack.val[3] = vget_high_u8(vreinterpretq_u8_u32(merge1));

    res[0] = vtbl4_u8(pack, shuf0);
    res[1] = vtbl4_u8(pack, shuf1);
    res[2] = vtbl4_u8(pack, shuf2);
    __builtin_memcpy(out, res, 6 * 4);

    out += 6 * 4;
    srclen -= 8 * 4;
    src += 8 * 4;
  }

//   std::cout << "Chromium? " << (out - out_orig) << std::endl;
  size_t scalarret = chromium_base64_decode(out, src, srclen, outlen);
  *outlen += (out - out_orig);
  if (scalarret == MODP_B64_ERROR)
    return (int)MODP_B64_ERROR;
  return (out - out_orig) + scalarret;
}

#endif
/* The Arm C Language Extensions this compiler has, for AArch64 targets. BIR has no CRC
   instructions, so the CRC32 intrinsics are computed four bits at a time: they give the
   right answers, slowly. */
#ifndef __BUN_CC_ARM_ACLE_H
#define __BUN_CC_ARM_ACLE_H

#include <stdint.h>

#define __BUN_CC_ACLE static __inline __attribute__((__always_inline__, __unused__))

/* Bit manipulation. */
__BUN_CC_ACLE uint32_t __ror(uint32_t __x, uint32_t __n) { return __builtin_rotateright32(__x, __n); }
__BUN_CC_ACLE unsigned long __rorl(unsigned long __x, uint32_t __n) { return __builtin_rotateright64(__x, __n); }
__BUN_CC_ACLE uint64_t __rorll(uint64_t __x, uint32_t __n) { return __builtin_rotateright64(__x, __n); }
__BUN_CC_ACLE unsigned int __clz(uint32_t __x) { return __x ? (unsigned int)__builtin_clz(__x) : 32; }
__BUN_CC_ACLE unsigned int __clzl(unsigned long __x) { return __x ? (unsigned int)__builtin_clzl(__x) : 64; }
__BUN_CC_ACLE unsigned int __clzll(uint64_t __x) { return __x ? (unsigned int)__builtin_clzll(__x) : 64; }
__BUN_CC_ACLE unsigned int __cls(uint32_t __x) { return __clz(((__x ^ (uint32_t)((int32_t)__x >> 31)) << 1) | 1); }
__BUN_CC_ACLE unsigned int __clsll(uint64_t __x) { return __clzll(((__x ^ (uint64_t)((int64_t)__x >> 63)) << 1) | 1); }
__BUN_CC_ACLE unsigned int __clsl(unsigned long __x) { return __clsll(__x); }
__BUN_CC_ACLE uint32_t __rev(uint32_t __x) { return __builtin_bswap32(__x); }
__BUN_CC_ACLE unsigned long __revl(unsigned long __x) { return __builtin_bswap64(__x); }
__BUN_CC_ACLE uint64_t __revll(uint64_t __x) { return __builtin_bswap64(__x); }
__BUN_CC_ACLE uint32_t __rev16(uint32_t __x) { return ((__x & 0x00ff00ffu) << 8) | ((__x >> 8) & 0x00ff00ffu); }
__BUN_CC_ACLE uint64_t __rev16ll(uint64_t __x) { return ((__x & 0x00ff00ff00ff00ffull) << 8) | ((__x >> 8) & 0x00ff00ff00ff00ffull); }
__BUN_CC_ACLE unsigned long __rev16l(unsigned long __x) { return __rev16ll(__x); }
__BUN_CC_ACLE int16_t __revsh(int16_t __x) { return (int16_t)__builtin_bswap16((uint16_t)__x); }
__BUN_CC_ACLE uint32_t __rbit(uint32_t __x) { return __builtin_bitreverse32(__x); }
__BUN_CC_ACLE uint64_t __rbitll(uint64_t __x) { return __builtin_bitreverse64(__x); }
__BUN_CC_ACLE unsigned long __rbitl(unsigned long __x) { return __builtin_bitreverse64(__x); }

/* CRC32: the reflected polynomials 0xedb88320 (CRC-32) and 0x82f63b78 (CRC-32C), a nibble at a time. */
static const uint32_t __bun_cc_crc32_table[16] = {0x00000000u, 0x1db71064u, 0x3b6e20c8u, 0x26d930acu, 0x76dc4190u, 0x6b6b51f4u, 0x4db26158u, 0x5005713cu, 0xedb88320u, 0xf00f9344u, 0xd6d6a3e8u, 0xcb61b38cu, 0x9b64c2b0u, 0x86d3d2d4u, 0xa00ae278u, 0xbdbdf21cu};
static const uint32_t __bun_cc_crc32c_table[16] = {0x00000000u, 0x105ec76fu, 0x20bd8edeu, 0x30e349b1u, 0x417b1dbcu, 0x5125dad3u, 0x61c69362u, 0x7198540du, 0x82f63b78u, 0x92a8fc17u, 0xa24bb5a6u, 0xb21572c9u, 0xc38d26c4u, 0xd3d3e1abu, 0xe330a81au, 0xf36e6f75u};
__BUN_CC_ACLE uint32_t __bun_cc_crc32_bits(uint32_t __crc, uint64_t __data, int __bits, const uint32_t *__table) {
  for (int __i = 0; __i < __bits; __i += 4) __crc = (__crc >> 4) ^ __table[(__crc ^ (uint32_t)(__data >> __i)) & 15];
  return __crc;
}
__BUN_CC_ACLE uint32_t __crc32b(uint32_t __a, uint8_t __b) { return __bun_cc_crc32_bits(__a, __b, 8, __bun_cc_crc32_table); }
__BUN_CC_ACLE uint32_t __crc32h(uint32_t __a, uint16_t __b) { return __bun_cc_crc32_bits(__a, __b, 16, __bun_cc_crc32_table); }
__BUN_CC_ACLE uint32_t __crc32w(uint32_t __a, uint32_t __b) { return __bun_cc_crc32_bits(__a, __b, 32, __bun_cc_crc32_table); }
__BUN_CC_ACLE uint32_t __crc32d(uint32_t __a, uint64_t __b) { return __bun_cc_crc32_bits(__a, __b, 64, __bun_cc_crc32_table); }
__BUN_CC_ACLE uint32_t __crc32cb(uint32_t __a, uint8_t __b) { return __bun_cc_crc32_bits(__a, __b, 8, __bun_cc_crc32c_table); }
__BUN_CC_ACLE uint32_t __crc32ch(uint32_t __a, uint16_t __b) { return __bun_cc_crc32_bits(__a, __b, 16, __bun_cc_crc32c_table); }
__BUN_CC_ACLE uint32_t __crc32cw(uint32_t __a, uint32_t __b) { return __bun_cc_crc32_bits(__a, __b, 32, __bun_cc_crc32c_table); }
__BUN_CC_ACLE uint32_t __crc32cd(uint32_t __a, uint64_t __b) { return __bun_cc_crc32_bits(__a, __b, 64, __bun_cc_crc32c_table); }

#endif

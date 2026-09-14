/* <intrin.h> for Windows targets: the declarations of Microsoft's compiler intrinsics (what
   each one does is in the compiler: see ms_intrinsics.h), and the vector intrinsics of the
   target's architecture. */
#ifndef __BUN_CC_INTRIN_H
#define __BUN_CC_INTRIN_H

#if defined(_M_X64) || defined(__x86_64__)
#include <immintrin.h>
#elif defined(_M_ARM64) || defined(__aarch64__)
#include <arm_neon.h>
/* The operand of __dmb, __dsb and __isb. */
typedef enum _tag_ARM64INTR_BARRIER_TYPE {
    _ARM64_BARRIER_SY = 0xF,
    _ARM64_BARRIER_ST = 0xE,
    _ARM64_BARRIER_LD = 0xD,
    _ARM64_BARRIER_ISH = 0xB,
    _ARM64_BARRIER_ISHST = 0xA,
    _ARM64_BARRIER_ISHLD = 0x9,
    _ARM64_BARRIER_NSH = 0x7,
    _ARM64_BARRIER_NSHST = 0x6,
    _ARM64_BARRIER_NSHLD = 0x5,
    _ARM64_BARRIER_OSH = 0x3,
    _ARM64_BARRIER_OSHST = 0x2,
    _ARM64_BARRIER_OSHLD = 0x1
} _ARM64INTR_BARRIER_TYPE;
#endif
#if __has_include(<setjmp.h>)
#include <setjmp.h>
#endif

#define __BUN_MS(ret, name, params, ...) ret name params;
#include <ms_intrinsics.h>
#undef __BUN_MS

#endif

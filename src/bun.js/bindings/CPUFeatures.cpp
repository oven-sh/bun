#include "root.h"

enum class X86CPUFeature : uint8_t {
    sse42 = 1,
    popcnt = 2,
    avx = 3,
    avx2 = 4,
    avx512 = 5,
};

enum class AArch64CPUFeature : uint8_t {
    neon = 1,
    fp = 2,
    aes = 3,
    crc32 = 4,
    atomics = 5,
    sve = 6,
};

#if CPU(X86_64)
#include <stdint.h>

uint8_t features = 0;
// Use CPUID for robust CPU feature detection
uint32_t eax, ebx, ecx, edx;

namespace cpuid_bit {
// Can be found on Intel ISA Reference for CPUID
// Thisis copypasta from SIMDUTF, mostly.
// EAX = 0x01
constexpr uint32_t pclmulqdq = uint32_t(1)
    << 1; ///< @private bit  1 of ECX for EAX=0x1
constexpr uint32_t sse42 = uint32_t(1)
    << 20; ///< @private bit 20 of ECX for EAX=0x1
constexpr uint32_t popcnt = uint32_t(1) << 23; // POPCNT is bit 23 in ECX
constexpr uint32_t avx = uint32_t(1) << 28; // AVX is bit 28 in ECX
constexpr uint32_t osxsave = (uint32_t(1) << 26) | (uint32_t(1) << 27); ///< @private bits 26+27 of ECX for EAX=0x1

// EAX = 0x7f (Structured Extended Feature Flags), ECX = 0x00 (Sub-leaf)
// See: "Table 3-8. Information Returned by CPUID Instruction"
namespace ebx {
constexpr uint32_t bmi1 = uint32_t(1) << 3;
constexpr uint32_t avx2 = uint32_t(1) << 5;
constexpr uint32_t bmi2 = uint32_t(1) << 8;
constexpr uint32_t avx512f = uint32_t(1) << 16;
constexpr uint32_t avx512dq = uint32_t(1) << 17;
constexpr uint32_t avx512ifma = uint32_t(1) << 21;
constexpr uint32_t avx512cd = uint32_t(1) << 28;
constexpr uint32_t avx512bw = uint32_t(1) << 30;
constexpr uint32_t avx512vl = uint32_t(1) << 31;
} // namespace ebx

namespace ecx {
constexpr uint32_t avx512vbmi = uint32_t(1) << 1;
constexpr uint32_t avx512vbmi2 = uint32_t(1) << 6;
constexpr uint32_t avx512vnni = uint32_t(1) << 11;
constexpr uint32_t avx512bitalg = uint32_t(1) << 12;
constexpr uint32_t avx512vpopcnt = uint32_t(1) << 14;
} // namespace ecx
namespace edx {
constexpr uint32_t avx512vp2intersect = uint32_t(1) << 8;
}
namespace xcr0_bit {
constexpr uint64_t avx256_saved = uint64_t(1) << 2; ///< @private bit 2 = AVX
constexpr uint64_t avx512_saved = uint64_t(7) << 5; ///< @private bits 5,6,7 = opmask, ZMM_hi256, hi16_ZMM
} // namespace xcr0_bit
} // namespace cpuid_bit

static inline void cpuid(uint32_t* eax, uint32_t* ebx, uint32_t* ecx,
    uint32_t* edx)
{
#if defined(_MSC_VER)
    int cpu_info[4];
    __cpuidex(cpu_info, *eax, *ecx);
    *eax = cpu_info[0];
    *ebx = cpu_info[1];
    *ecx = cpu_info[2];
    *edx = cpu_info[3];
#elif defined(HAVE_GCC_GET_CPUID) && defined(USE_GCC_GET_CPUID)
    uint32_t level = *eax;
    __get_cpuid(level, eax, ebx, ecx, edx);
#else
    uint32_t a = *eax, b, c = *ecx, d;
    asm volatile("cpuid\n\t" : "+a"(a), "=b"(b), "+c"(c), "=d"(d));
    *eax = a;
    *ebx = b;
    *ecx = c;
    *edx = d;
#endif
}

static uint8_t x86_cpu_features()
{

    // Check for SSE4.2 and POPCNT (CPUID leaf 1)
    eax = 1;
    ecx = 0;
    /**
     * Use cpuid because the Windows API for this is a big liar. Our CI machines on
     * AWS report no AVX2 when they absolutely do support it.
     */
    cpuid(&eax, &ebx, &ecx, &edx);

    if (ecx & cpuid_bit::sse42)
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::sse42);

    if (ecx & cpuid_bit::popcnt)
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::popcnt);

    if (ecx & cpuid_bit::avx)
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx);

    // Check for AVX2 and AVX512 (CPUID leaf 7)
    eax = 7;
    ecx = 0;
    cpuid(&eax, &ebx, &ecx, &edx);

    if (ebx & cpuid_bit::ebx::avx2)
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx2);

    if (ebx & cpuid_bit::ebx::avx512f)
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx512);

    return features;
}

#endif

#if CPU(ARM64)

static uint8_t aarch64_cpu_features()
{
    uint8_t features = 0;

    // Use inline assembly to detect CPU features directly
    uint64_t id_aa64pfr0_el1;
    uint64_t id_aa64isar0_el1;
    uint64_t id_aa64isar1_el1;

    __asm__ __volatile__("mrs %0, id_aa64pfr0_el1" : "=r"(id_aa64pfr0_el1));
    __asm__ __volatile__("mrs %0, id_aa64isar0_el1" : "=r"(id_aa64isar0_el1));
    __asm__ __volatile__("mrs %0, id_aa64isar1_el1" : "=r"(id_aa64isar1_el1));

    // Check for NEON and FP (always present in ARMv8-A)
    features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::neon);
    features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::fp);

    // Check for AES (bits 7:4 of ID_AA64ISAR0_EL1)
    if (((id_aa64isar0_el1 >> 4) & 0xf) > 0)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::aes);

    // Check for CRC32 (bits 19:16 of ID_AA64ISAR0_EL1)
    if (((id_aa64isar0_el1 >> 16) & 0xf) > 0)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::crc32);

    // Check for LSE/Atomics (bits 23:20 of ID_AA64ISAR0_EL1)
    if (((id_aa64isar0_el1 >> 20) & 0xf) > 0)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::atomics);

    // Check for SVE (bits 3:0 of ID_AA64PFR0_EL1)
    if (((id_aa64pfr0_el1 >> 0) & 0xf) > 0)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::sve);

    return features;
}

#endif

extern "C" uint8_t bun_cpu_features()
{
#if CPU(X86_64)
    return x86_cpu_features();
#elif CPU(ARM64)
    return aarch64_cpu_features();
#else
    return 0;
#endif
}

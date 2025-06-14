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

// Read the extended control register XCR0
static inline uint64_t xgetbv(uint32_t xcr)
{
#if defined(_MSC_VER)
    return _xgetbv(xcr);
#else
    uint32_t eax, edx;
    asm volatile("xgetbv" : "=a"(eax), "=d"(edx) : "c"(xcr));
    return ((uint64_t)edx << 32) | eax;
#endif
}

static uint8_t x86_cpu_features()
{
    uint8_t features = 0;
    // Use CPUID for robust CPU feature detection
    uint32_t eax, ebx, ecx, edx;

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

    // Check for AVX following Intel's recommended detection steps:
    // 1. Check if OSXSAVE is supported (CPUID.1:ECX.OSXSAVE[bit 27] = 1)
    // 2. Check if OS has enabled XMM and YMM state support (XCR0[2:1] = '11b')
    // 3. Check if CPU supports AVX instructions (CPUID.1:ECX.AVX[bit 28] = 1)
    bool osxsave_supported = (ecx & cpuid_bit::osxsave) == cpuid_bit::osxsave;
    bool avx_supported = (ecx & cpuid_bit::avx) == cpuid_bit::avx;

    if (osxsave_supported && avx_supported) {
        // Check if OS has enabled XMM and YMM state support
        uint64_t xcr0 = xgetbv(0);
        bool avx_enabled_by_os = (xcr0 & cpuid_bit::xcr0_bit::avx256_saved) == cpuid_bit::xcr0_bit::avx256_saved;

        if (avx_enabled_by_os) {
            features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx);

            // Check for AVX2 and AVX512 (CPUID leaf 7)
            eax = 7;
            ecx = 0;
            cpuid(&eax, &ebx, &ecx, &edx);

            if (ebx & cpuid_bit::ebx::avx2)
                features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx2);

            // For AVX-512, we need to check both CPU support and OS support for the state
            bool avx512f_supported = (ebx & cpuid_bit::ebx::avx512f) == cpuid_bit::ebx::avx512f;
            bool avx512_enabled_by_os = (xcr0 & cpuid_bit::xcr0_bit::avx512_saved) == cpuid_bit::xcr0_bit::avx512_saved;

            if (avx512f_supported && avx512_enabled_by_os)
                features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx512);
        }
    } else {
        // If AVX is not supported or enabled, don't even check for AVX2 or AVX512
        // as they depend on AVX support
    }

    return features;
}

#endif

#if CPU(ARM64)

#if OS(DARWIN)
#include <sys/sysctl.h>
#endif

static uint8_t aarch64_cpu_features()
{
    uint8_t features = 0;

    // On ARM64, we'll use a safer approach to avoid illegal instructions
    // NEON and FP are always present in ARMv8-A
    features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::neon);
    features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::fp);

#if OS(DARWIN)
    // On macOS/iOS, use sysctlbyname to detect CPU features
    int value = 0;
    size_t size = sizeof(value);

    // Check for AES
    if (sysctlbyname("hw.optional.arm.FEAT_AES", &value, &size, nullptr, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::aes);

    // Check for CRC32
    if (sysctlbyname("hw.optional.arm.FEAT_CRC32", &value, &size, nullptr, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::crc32);

    // Check for LSE/Atomics
    if (sysctlbyname("hw.optional.arm.FEAT_LSE", &value, &size, nullptr, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::atomics);

    // Check for SVE
    if (sysctlbyname("hw.optional.arm.FEAT_SVE", &value, &size, nullptr, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::sve);
#else
    // For non-Apple ARM64 platforms, we can use the system register approach
    // but we need to be careful about illegal instructions

    uint64_t id_aa64isar0_el1 = 0;
    uint64_t id_aa64isar1_el1 = 0;
    uint64_t id_aa64pfr0_el1 = 0;

    // Use inline assembly with constraints to safely read system registers
    asm volatile("mrs %0, id_aa64isar0_el1" : "=r"(id_aa64isar0_el1));
    asm volatile("mrs %0, id_aa64isar1_el1" : "=r"(id_aa64isar1_el1));
    asm volatile("mrs %0, id_aa64pfr0_el1" : "=r"(id_aa64pfr0_el1));

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
#endif

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

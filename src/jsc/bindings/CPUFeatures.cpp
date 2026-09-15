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

#include <cpuid.h>

static uint8_t x86_cpu_features()
{
    uint8_t features = 0;

    // Not __builtin_cpu_supports (a constructor before main), not IsProcessorFeaturePresent (false on Windows Server 2019).
    unsigned eax = 0, ebx = 0, ecx = 0, edx = 0;
    if (!__get_cpuid(1, &eax, &ebx, &ecx, &edx))
        return features;

    if (ecx & bit_SSE4_2)
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::sse42);
    if (ecx & bit_POPCNT)
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::popcnt);

    // AVX needs the OS to save the YMM state (XCR0 bits 1 and 2), AVX-512 the ZMM state too (bits 5 to 7).
    uint64_t xcr0 = 0;
    if ((ecx & bit_OSXSAVE) && (ecx & bit_AVX)) {
        unsigned lo = 0, hi = 0;
        __asm__ volatile("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0));
        xcr0 = (static_cast<uint64_t>(hi) << 32) | lo;
    }
    const bool avxState = (xcr0 & 0x6) == 0x6;
#if OS(DARWIN)
    // Darwin turns on the ZMM state at a process's first AVX-512 instruction, so XCR0 does not show it yet.
    const bool avx512State = avxState;
#else
    const bool avx512State = avxState && (xcr0 & 0xe0) == 0xe0;
#endif
    if (avxState) {
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx);
        unsigned eax7 = 0, ebx7 = 0, ecx7 = 0, edx7 = 0;
        if (__get_cpuid_count(7, 0, &eax7, &ebx7, &ecx7, &edx7)) {
            if (ebx7 & bit_AVX2)
                features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx2);
            if ((ebx7 & bit_AVX512F) && avx512State)
                features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx512);
        }
    }

    return features;
}

#endif

#if CPU(ARM64)

#if OS(WINDOWS)
#include <windows.h>
#elif OS(MACOS)
#include <sys/sysctl.h>
#elif OS(LINUX)
#include <sys/auxv.h>
#include <asm/hwcap.h>
#endif

static uint8_t aarch64_cpu_features()
{
    uint8_t features = 0;

#if OS(WINDOWS)
    // FP is mandatory on AArch64 — no separate PF_ constant exists for it
    features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::fp);
    if (IsProcessorFeaturePresent(PF_ARM_NEON_INSTRUCTIONS_AVAILABLE))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::neon);
    if (IsProcessorFeaturePresent(PF_ARM_V8_CRYPTO_INSTRUCTIONS_AVAILABLE))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::aes);
    if (IsProcessorFeaturePresent(PF_ARM_V8_CRC32_INSTRUCTIONS_AVAILABLE))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::crc32);
    if (IsProcessorFeaturePresent(PF_ARM_V81_ATOMIC_INSTRUCTIONS_AVAILABLE))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::atomics);
    if (IsProcessorFeaturePresent(PF_ARM_SVE_INSTRUCTIONS_AVAILABLE))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::sve);
#elif OS(MACOS)
    int value = 0;
    size_t size = sizeof(value);
    if (sysctlbyname("hw.optional.arm.AdvSIMD", &value, &size, NULL, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::neon);
    if (sysctlbyname("hw.optional.floatingpoint", &value, &size, NULL, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::fp);
    if (sysctlbyname("hw.optional.arm.FEAT_AES", &value, &size, NULL, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::aes);
    if (sysctlbyname("hw.optional.armv8_crc32", &value, &size, NULL, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::crc32);
    if (sysctlbyname("hw.optional.arm.FEAT_LSE", &value, &size, NULL, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::atomics);
    if (sysctlbyname("hw.optional.arm.FEAT_SVE", &value, &size, NULL, 0) == 0 && value == 1)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::sve);
#elif OS(LINUX)
    unsigned long hwcaps = getauxval(AT_HWCAP);
    if (hwcaps & HWCAP_ASIMD)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::neon);
    if (hwcaps & HWCAP_FP)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::fp);
    if (hwcaps & HWCAP_AES)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::aes);
    if (hwcaps & HWCAP_CRC32)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::crc32);
    if (hwcaps & HWCAP_ATOMICS)
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::atomics);
    if (hwcaps & HWCAP_SVE)
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
#error "Unknown architecture"
#endif
}

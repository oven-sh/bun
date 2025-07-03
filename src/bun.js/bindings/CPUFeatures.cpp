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

#if OS(WINDOWS)

#include <windows.h>

#endif

static uint8_t x86_cpu_features()
{
    uint8_t features = 0;

#if OS(WINDOWS)
    if (IsProcessorFeaturePresent(PF_SSE4_2_INSTRUCTIONS_AVAILABLE))
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::sse42);

    if (IsProcessorFeaturePresent(PF_AVX_INSTRUCTIONS_AVAILABLE))
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx);

    if (IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE))
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx2);

    if (IsProcessorFeaturePresent(PF_AVX512F_INSTRUCTIONS_AVAILABLE))
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx512);

#else

#if __has_builtin(__builtin_cpu_supports)
    __builtin_cpu_init();

    if (__builtin_cpu_supports("sse4.2"))
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::sse42);
    if (__builtin_cpu_supports("popcnt"))
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::popcnt);
    if (__builtin_cpu_supports("avx"))
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx);
    if (__builtin_cpu_supports("avx2"))
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx2);
    if (__builtin_cpu_supports("avx512f"))
        features |= 1 << static_cast<uint8_t>(X86CPUFeature::avx512);
#endif

#endif

    return features;
}

#endif

#if CPU(ARM64)

#if OS(WINDOWS)
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
#pragma error "TODO: Implement AArch64 CPU features for Windows"
#elif OS(MACOS)
    int value = 0;
    size_t size = sizeof(value);
    if (sysctlbyname("hw.optional.AdvSIMD", &value, &size, NULL, 0) == 0 && value == 1)
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

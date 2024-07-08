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

static uint8_t aarch64_cpu_features()
{
    uint8_t features = 0;

#if OS(WINDOWS)
#pragma error "TODO: Implement AArch64 CPU features for Windows"
#endif

#if __has_builtin(__builtin_cpu_supports)
    __builtin_cpu_init();

    if (__builtin_cpu_supports("neon"))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::neon);
    if (__builtin_cpu_supports("crypto"))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::fp);
    if (__builtin_cpu_supports("aes"))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::aes);
    if (__builtin_cpu_supports("crc32"))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::crc32);
    if (__builtin_cpu_supports("atomics"))
        features |= 1 << static_cast<uint8_t>(AArch64CPUFeature::atomics);
    if (__builtin_cpu_supports("sve"))
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
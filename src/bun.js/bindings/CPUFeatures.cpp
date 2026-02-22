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

// RISC-V ISA extension bits from the hwcap
#if CPU(RISCV64)

#include <sys/auxv.h>

enum class RiscVCPUFeature : uint8_t {
    m = 1,       // Integer multiply/divide
    a = 2,       // Atomics
    f = 3,       // Single-precision float
    d = 4,       // Double-precision float
    c = 5,       // Compressed instructions
    v = 6,       // Vector extension
};

// RISC-V hwcap bits (from arch/riscv/include/uapi/asm/hwcap.h)
#ifndef COMPAT_HWCAP_ISA_I
#define COMPAT_HWCAP_ISA_I  (1 << ('I' - 'A'))
#define COMPAT_HWCAP_ISA_M  (1 << ('M' - 'A'))
#define COMPAT_HWCAP_ISA_A  (1 << ('A' - 'A'))
#define COMPAT_HWCAP_ISA_F  (1 << ('F' - 'A'))
#define COMPAT_HWCAP_ISA_D  (1 << ('D' - 'A'))
#define COMPAT_HWCAP_ISA_C  (1 << ('C' - 'A'))
#define COMPAT_HWCAP_ISA_V  (1 << ('V' - 'A'))
#endif

static uint8_t riscv64_cpu_features()
{
    uint8_t features = 0;
    unsigned long hwcaps = getauxval(AT_HWCAP);

    if (hwcaps & COMPAT_HWCAP_ISA_M)
        features |= 1 << static_cast<uint8_t>(RiscVCPUFeature::m);
    if (hwcaps & COMPAT_HWCAP_ISA_A)
        features |= 1 << static_cast<uint8_t>(RiscVCPUFeature::a);
    if (hwcaps & COMPAT_HWCAP_ISA_F)
        features |= 1 << static_cast<uint8_t>(RiscVCPUFeature::f);
    if (hwcaps & COMPAT_HWCAP_ISA_D)
        features |= 1 << static_cast<uint8_t>(RiscVCPUFeature::d);
    if (hwcaps & COMPAT_HWCAP_ISA_C)
        features |= 1 << static_cast<uint8_t>(RiscVCPUFeature::c);
    if (hwcaps & COMPAT_HWCAP_ISA_V)
        features |= 1 << static_cast<uint8_t>(RiscVCPUFeature::v);

    return features;
}

#endif

extern "C" uint8_t bun_cpu_features()
{
#if CPU(X86_64)
    return x86_cpu_features();
#elif CPU(ARM64)
    return aarch64_cpu_features();
#elif CPU(RISCV64)
    return riscv64_cpu_features();
#else
#error "Unknown architecture"
#endif
}

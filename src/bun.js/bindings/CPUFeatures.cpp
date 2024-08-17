/* Avoid using the IsProcessorFeaturePresent API on Windows */
/* It seems to return false on AWS. */

/* From
https://github.com/endorno/pytorch/blob/master/torch/lib/TH/generic/simd/simd.h
Highly modified.

Copyright (c) 2016-     Facebook, Inc            (Adam Paszke)
Copyright (c) 2014-     Facebook, Inc            (Soumith Chintala)
Copyright (c) 2011-2014 Idiap Research Institute (Ronan Collobert)
Copyright (c) 2012-2014 Deepmind Technologies    (Koray Kavukcuoglu)
Copyright (c) 2011-2012 NEC Laboratories America (Koray Kavukcuoglu)
Copyright (c) 2011-2013 NYU                      (Clement Farabet)
Copyright (c) 2006-2010 NEC Laboratories America (Ronan Collobert, Leon Bottou,
Iain Melvin, Jason Weston) Copyright (c) 2006      Idiap Research Institute
(Samy Bengio) Copyright (c) 2001-2004 Idiap Research Institute (Ronan Collobert,
Samy Bengio, Johnny Mariethoz)

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

3. Neither the names of Facebook, Deepmind Technologies, NYU, NEC Laboratories
America and IDIAP Research Institute nor the names of its contributors may be
   used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
*/

#include "root.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "wtf/Platform.h"
#include "wtf/StdLibExtras.h"

#if CPU(X86_64)
#include <cstdint>
#include <cstdlib>
#if OS(WINDOWS)
#include <intrin.h>
#else
#include <cpuid.h>
#endif

enum instruction_set : uint32_t {
    DEFAULT = 0x0,
    NEON = 0x1,
    AVX2 = 0x4,
    SSE42 = 0x8,
    PCLMULQDQ = 0x10,
    BMI1 = 0x20,
    BMI2 = 0x40,
    ALTIVEC = 0x80,
    AVX512F = 0x100,
    AVX512DQ = 0x200,
    AVX512IFMA = 0x400,
    AVX512PF = 0x800,
    AVX512ER = 0x1000,
    AVX512CD = 0x2000,
    AVX512BW = 0x4000,
    AVX512VL = 0x8000,
    AVX512VBMI2 = 0x10000,
    AVX512VPOPCNTDQ = 0x2000,
    RVV = 0x4000,
    ZVBB = 0x8000,

    AVX = 0x8000,
};

namespace cpuid_bit {
// Can be found on Intel ISA Reference for CPUID

// EAX = 0x01
constexpr uint32_t pclmulqdq = uint32_t(1) << 1; ///< @private bit  1 of ECX for EAX=0x1
constexpr uint32_t sse42 = uint32_t(1) << 20; ///< @private bit 20 of ECX for EAX=0x1
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
}

namespace ecx {
constexpr uint32_t avx512vbmi = uint32_t(1) << 1;
constexpr uint32_t avx512vbmi2 = uint32_t(1) << 6;
constexpr uint32_t avx512vnni = uint32_t(1) << 11;
constexpr uint32_t avx512bitalg = uint32_t(1) << 12;
constexpr uint32_t avx512vpopcnt = uint32_t(1) << 14;
}
namespace edx {
constexpr uint32_t avx512vp2intersect = uint32_t(1) << 8;
}
namespace xcr0_bit {
constexpr uint64_t avx256_saved = uint64_t(1) << 2; ///< @private bit 2 = AVX
constexpr uint64_t avx512_saved = uint64_t(7) << 5; ///< @private bits 5,6,7 = opmask, ZMM_hi256, hi16_ZMM
}
}

static inline void cpuid(uint32_t* eax, uint32_t* ebx, uint32_t* ecx,
    uint32_t* edx)
{
#if OS(WINDOWS)
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

static inline uint64_t xgetbv()
{
#if OS(WINDOWS)
    return _xgetbv(0);
#else
    uint32_t xcr0_lo, xcr0_hi;
    asm volatile("xgetbv\n\t" : "=a"(xcr0_lo), "=d"(xcr0_hi) : "c"(0));
    return xcr0_lo | ((uint64_t)xcr0_hi << 32);
#endif
}

static inline uint32_t detect_supported_architectures()
{
    uint32_t eax;
    uint32_t ebx = 0;
    uint32_t ecx = 0;
    uint32_t edx = 0;
    uint32_t host_isa = 0x0;

    // EBX for EAX=0x1
    eax = 0x1;
    cpuid(&eax, &ebx, &ecx, &edx);

    if (ecx & cpuid_bit::sse42) {
        host_isa |= instruction_set::SSE42;
    }

    if (ecx & cpuid_bit::pclmulqdq) {
        host_isa |= instruction_set::PCLMULQDQ;
    }

    if ((ecx & cpuid_bit::osxsave) != cpuid_bit::osxsave) {
        return host_isa;
    }

    // xgetbv for checking if the OS saves registers
    uint64_t xcr0 = xgetbv();

    if ((xcr0 & 0x6) != 0) {
        host_isa |= instruction_set::AVX;
    }

    if ((xcr0 & cpuid_bit::xcr0_bit::avx256_saved) == 0) {
        return host_isa;
    }

    // ECX for EAX=0x7
    eax = 0x7;
    ecx = 0x0; // Sub-leaf = 0
    cpuid(&eax, &ebx, &ecx, &edx);

    if (ebx & cpuid_bit::ebx::avx2) {
        host_isa |= instruction_set::AVX2;
    }
    if (ebx & cpuid_bit::ebx::bmi1) {
        host_isa |= instruction_set::BMI1;
    }
    if (ebx & cpuid_bit::ebx::bmi2) {
        host_isa |= instruction_set::BMI2;
    }
    if (!((xcr0 & cpuid_bit::xcr0_bit::avx512_saved) == cpuid_bit::xcr0_bit::avx512_saved)) {
        return host_isa;
    }
    if (ebx & cpuid_bit::ebx::avx512f) {
        host_isa |= instruction_set::AVX512F;
    }
    if (ebx & cpuid_bit::ebx::avx512bw) {
        host_isa |= instruction_set::AVX512BW;
    }
    if (ebx & cpuid_bit::ebx::avx512cd) {
        host_isa |= instruction_set::AVX512CD;
    }
    if (ebx & cpuid_bit::ebx::avx512dq) {
        host_isa |= instruction_set::AVX512DQ;
    }
    if (ebx & cpuid_bit::ebx::avx512vl) {
        host_isa |= instruction_set::AVX512VL;
    }
    if (ecx & cpuid_bit::ecx::avx512vbmi2) {
        host_isa |= instruction_set::AVX512VBMI2;
    }
    if (ecx & cpuid_bit::ecx::avx512vpopcnt) {
        host_isa |= instruction_set::AVX512VPOPCNTDQ;
    }
    return host_isa;
}

#endif // CPU(X86_X64)

#pragma pack(push, 1)
struct X86CPUFeatures {
    bool none : 1 = false;
    bool sse42 : 1 = false;
    bool popcnt : 1 = false;
    bool avx : 1 = false;
    bool avx2 : 1 = false;
    bool avx512 : 1 = false;
    uint8_t padding : 2 = 0;
};
#pragma pack(pop)
static_assert(sizeof(X86CPUFeatures) == sizeof(uint8_t), "X86CPUFeatures size mismatch");

#pragma pack(push, 1)
struct AArch64CPUFeatures {
    bool none : 1 = false;
    bool neon : 1 = false;
    bool fp : 1 = false;
    bool aes : 1 = false;
    bool crc32 : 1 = false;
    bool atomics : 1 = false;
    bool sve : 1 = false;
    uint8_t padding : 1 = 0;
};
#pragma pack(pop)
static_assert(sizeof(AArch64CPUFeatures) == sizeof(uint8_t), "AArch64CPUFeatures size mismatch");

#if CPU(X86_64)

static uint8_t x86_cpu_features()
{
    X86CPUFeatures features = {};

    uint32_t host_isa = detect_supported_architectures();

    if ((host_isa & instruction_set::SSE42) != 0) {
        features.sse42 = true;
    }

    if ((host_isa & instruction_set::AVX) != 0) {
        features.avx = true;
    }

    if ((host_isa & instruction_set::AVX2) != 0) {
        features.avx2 = true;
    }

    if ((host_isa & instruction_set::AVX512F) != 0) {
        features.avx512 = true;
    }

    uint8_t features_bits = 0;
    memcpy(&features_bits, &features, sizeof(features));
    return features_bits;
}

#endif

#if CPU(ARM64)

static uint8_t aarch64_cpu_features()
{
#if OS(WINDOWS)
#pragma error "TODO: Implement AArch64 CPU features for Windows"
#endif

#if __has_builtin(__builtin_cpu_supports)
    __builtin_cpu_init();
    AArch64CPUFeatures features = {
        .padding = 0,
    };
    features.neon = __builtin_cpu_supports("neon");
    features.fp = __builtin_cpu_supports("crypto");
    features.aes = __builtin_cpu_supports("aes");
    features.crc32 = __builtin_cpu_supports("crc32");
    features.atomics = __builtin_cpu_supports("atomics");
    features.sve = __builtin_cpu_supports("sve");
#endif

    uint8_t features_bits = 0;
    memcpy(&features_bits, &features, sizeof(features));
    return features_bits;
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionGetCPUFeatures, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto features = bun_cpu_features();
    auto* object = JSC::constructEmptyObject(globalObject);
    auto& vm = globalObject->vm();

#if CPU(X86_64)
    X86CPUFeatures cpu;
    memcpy(&cpu, &features, sizeof(cpu));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "sse42"_s), JSC::jsBoolean(cpu.sse42));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "avx2"_s), JSC::jsBoolean(cpu.avx2));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "avx"_s), JSC::jsBoolean(cpu.avx));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "avx512"_s), JSC::jsBoolean(cpu.avx512));
#elif CPU(ARM64)
    Aarch64CPUFeatures cpu;
    memcpy(&cpu, &features, sizeof(cpu));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "neon"_s), JSC::jsBoolean(cpu.neon));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "sve"_s), JSC::jsBoolean(cpu.sve));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "fp"_s), JSC::jsBoolean(cpu.fp));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "aes"_s), JSC::jsBoolean(cpu.aes));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "crc32"_s), JSC::jsBoolean(cpu.crc32));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "atomics"_s), JSC::jsBoolean(cpu.atomics));
#endif

    return JSC::JSValue::encode(object);
}

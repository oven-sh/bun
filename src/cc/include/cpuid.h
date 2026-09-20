/* <cpuid.h> for x86-64 targets. The `cpuid` instruction is written as inline assembly, which
   the compiler turns into its own instruction for it. */
#ifndef __BUN_CC_CPUID_H
#define __BUN_CC_CPUID_H

#define __cpuid(level, a, b, c, d) \
  __asm__("cpuid" : "=a"(a), "=b"(b), "=c"(c), "=d"(d) : "0"(level))
#define __cpuid_count(level, count, a, b, c, d) \
  __asm__("cpuid" : "=a"(a), "=b"(b), "=c"(c), "=d"(d) : "0"(level), "2"(count))

static __inline unsigned int __get_cpuid_max(unsigned int __ext, unsigned int *__sig) {
  unsigned int __eax, __ebx, __ecx, __edx;
  __cpuid(__ext, __eax, __ebx, __ecx, __edx);
  if (__sig) *__sig = __ebx;
  return __eax;
}

static __inline int __get_cpuid(unsigned int __leaf, unsigned int *__eax, unsigned int *__ebx,
                                unsigned int *__ecx, unsigned int *__edx) {
  unsigned int __max = __get_cpuid_max(__leaf & 0x80000000u, 0);
  if (__max == 0 || __max < __leaf) return 0;
  __cpuid(__leaf, *__eax, *__ebx, *__ecx, *__edx);
  return 1;
}

static __inline int __get_cpuid_count(unsigned int __leaf, unsigned int __subleaf, unsigned int *__eax,
                                      unsigned int *__ebx, unsigned int *__ecx, unsigned int *__edx) {
  unsigned int __max = __get_cpuid_max(__leaf & 0x80000000u, 0);
  if (__max == 0 || __max < __leaf) return 0;
  __cpuid_count(__leaf, __subleaf, *__eax, *__ebx, *__ecx, *__edx);
  return 1;
}

#endif

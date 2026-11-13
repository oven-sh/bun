// Each function jumps through the pointer that BunDawn__loadMetal() fills in, with the registers as the caller left them.

.macro trampoline name
    .p2align 2
    .globl _\name
    .private_extern _\name
_\name:
#if defined(__aarch64__)
    adrp x16, _BunDawn__\name\()@PAGE
    ldr x16, [x16, _BunDawn__\name\()@PAGEOFF]
    br x16
#else
    jmpq *_BunDawn__\name\()(%rip)
#endif
.endm

.text
#define FUNCTION(library, name) trampoline name
#define DATA(library, name, size)
#include "MetalSymbols.def"

.subsections_via_symbols

#if defined(_WIN32)
.section .rdata,"dr"
#else
.pushsection .note.GNU-stack, "", %progbits
.popsection
.section .rodata,"a",%progbits
#endif

.globl bun_icu_package
.p2align 4
bun_icu_package:
.incbin "package.bin"

#if defined(__APPLE__)
.section __TEXT,__const
#define BUN_SYM(x) _##x
#elif defined(_WIN32)
.section .rdata,"dr"
#define BUN_SYM(x) x
#else
.pushsection .note.GNU-stack, "", %progbits
.popsection
.section .rodata,"a",%progbits
#define BUN_SYM(x) x
#endif

.globl BUN_SYM(bun_builtin_sources_start)
.globl BUN_SYM(bun_builtin_sources_end)
.p2align 4
BUN_SYM(bun_builtin_sources_start):
.incbin "builtin_sources.bin"
BUN_SYM(bun_builtin_sources_end):

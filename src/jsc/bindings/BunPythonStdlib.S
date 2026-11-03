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

.globl BUN_SYM(bun_python_stdlib_start)
.globl BUN_SYM(bun_python_stdlib_end)
.p2align 4
BUN_SYM(bun_python_stdlib_start):
.incbin "python-stdlib.bin"
BUN_SYM(bun_python_stdlib_end):

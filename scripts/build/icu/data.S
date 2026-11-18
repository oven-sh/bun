// The output of data.ts. `--trim` takes the package to end at the symbol that follows it.

#if defined(_WIN32)
.section .rdata,"dr"
#define OBJECT(name) .globl name; name:
#else
.pushsection .note.GNU-stack, "", %progbits
.popsection
.section .rodata,"a",%progbits
#define OBJECT(name) .globl name; .type name, %object; name:
#endif

.p2align 4
OBJECT(ICU_DATA_ENTRY_POINT)
.incbin "icudt.dat"

.p2align 4
OBJECT(bun_icu_zstd_dict)
.incbin "icudt.dict"
1:

.p2align 2
OBJECT(bun_icu_zstd_dict_size)
.long 1b - bun_icu_zstd_dict

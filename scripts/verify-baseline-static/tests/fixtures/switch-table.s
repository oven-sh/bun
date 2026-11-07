# Fixture of tests/pdb_marks.rs: the PDB records cl writes for a switch table
# that it stores in .text, written by hand. switch-table.dll and
# switch-table.pdb are this file's output (LLVM 23):
#
#   llvm-mc -triple x86_64-pc-windows-msvc -filetype=obj switch-table.s -o switch-table.obj
#   lld-link /nologo /Brepro /dll /noentry /nodefaultlib /base:0x140000000 /debug \
#     /pdb:switch-table.pdb /pdbaltpath:switch-table.pdb /pdbsourcepath:c:\fixture \
#     /out:switch-table.dll switch-table.obj

        .macro  cv_proc kind, sym
        .short  1f - 0f
0:      .short  \kind                   # S_GPROC32 0x1110, S_LPROC32 0x110f
        .long   0, 0, 0                 # parent, end, next: the linker fills them in
        .long   \sym\()_end - \sym      # code size
        .long   0, 0                    # debug start, debug end
        .long   0                       # type
        .secrel32 \sym
        .secidx \sym
        .byte   0                       # flags
        .asciz  "\sym"
1:
        .endm

        .macro  cv_data type, sym, name
        .short  1f - 0f
0:      .short  0x110c                  # S_LDATA32
        .long   \type
        .secrel32 \sym
        .secidx \sym
        .asciz  "\name"
1:
        .endm

        .macro  cv_end
        .short  2
        .short  6                       # S_END
        .endm

# A procedure that is one AVX instruction. The instruction's disp32 is the RVA
# of the procedure itself, so the disp32 alone passes for a one-entry jump
# table. If the scanner takes a record that names it for a table mark, it cuts
# the instruction in two and no longer reports it.
        .macro  control name
        .globl  \name
        .p2align 4, 0xcc
\name:
        .byte   0xc5, 0xfc, 0x58, 0x80  # vaddps disp32(%rax), %ymm0, %ymm0
\name\()_word:
        .long   \name@IMGREL
\name\()_end:
        .endm

# Puts .code at RVA 0x0519c000 and adds no bytes to the file.
        .section .bss,"bw"
        .skip   0x0519a000

        .section .code,"xr"
        control no_record
        control typed_record
        control named_record
        control record_after_the_scope
        control unplaced_record

# The layout of the UCRT's `_powf_special` where CI build 126987 linked it:
# RVA 0x0519c200, `ret; nop` at +0x149, nine case-label RVAs at +0x14c. Entry 6
# is `c4 c2 19 05`, which a linear sweep decodes as VPHSUBW.
        .org    0x200, 0xcc
        .globl  switch_table
switch_table:
        leaq    __ImageBase(%rip), %rdx
        movl    switch_table_cases@IMGREL(%rdx,%rax,4), %ecx
        addq    %rdx, %rcx
        jmpq    *%rcx
        vzeroupper                      # AVX in the procedure's own code: reported
        .org    switch_table + 0x2d, 0x90
case_2d:
        .org    switch_table + 0x57, 0x90
case_57:
        .org    switch_table + 0x86, 0x90
case_86:
        .org    switch_table + 0x98, 0x90
case_98:
        .org    switch_table + 0xc4, 0x90
case_c4:
        .org    switch_table + 0xf0, 0x90
case_f0:
        .org    switch_table + 0x13d, 0x90
case_13d:
        .org    switch_table + 0x149, 0x90
        ret
        .byte   0x66, 0x90              # nop
switch_table_cases:
        .long   case_2d@IMGREL, case_57@IMGREL, case_86@IMGREL
        .long   case_86@IMGREL, case_86@IMGREL, case_98@IMGREL
        .long   case_c4@IMGREL, case_13d@IMGREL, case_f0@IMGREL
switch_table_end:

# A two-level switch: a jump table, the byte table that indexes it, a second
# jump table. The half instruction in front of each jump table reads the
# table's first word as its disp32 when the sweep reaches it.
        .globl  two_level
two_level:
case_a:
        nop
case_b:
        ret
        .byte   0xc5, 0xfc, 0x58, 0x80  # vaddps disp32(%rax), %ymm0, %ymm0
two_level_cases:
        .long   case_a@IMGREL, case_b@IMGREL, case_b@IMGREL, case_a@IMGREL
two_level_bytes:
        vzeroupper                      # stands for index bytes: not RVAs, so decoded and reported
        nop
        .byte   0xc5, 0xfc, 0x58, 0x80
two_level_more_cases:
        .long   case_b@IMGREL, case_a@IMGREL
two_level_end:

# A procedure with a jump table, and its own VZEROUPPER to report.
        .macro  with_table name
        .p2align 4, 0xcc
\name:
        vzeroupper
        ret
        .byte   0xc5, 0xfc, 0x58, 0x80  # vaddps disp32(%rax), %ymm0, %ymm0
\name\()_cases:
        .long   \name@IMGREL, \name@IMGREL
\name\()_end:
        .endm

        with_table static_procedure
        .globl  inlined_call
        with_table inlined_call

        .section .debug$S,"dr"
        .p2align 2
        .long   4                       # CV_SIGNATURE_C13
        .long   0xf1                    # DEBUG_S_SYMBOLS
        .long   symbols_end - symbols
symbols:
        cv_proc 0x1110, no_record
        cv_end

        cv_proc 0x1110, typed_record
        cv_data 0x74, typed_record_word, ""
        cv_end

        cv_proc 0x1110, named_record
        cv_data 0, named_record_word, "named"
        cv_end

        cv_proc 0x1110, record_after_the_scope
        cv_end
        cv_data 0, record_after_the_scope_word, ""

        cv_proc 0x1110, unplaced_record
        # Section 0: the linker placed nothing there, as for a discarded COMDAT.
        .short  1f - 0f
0:      .short  0x110c
        .long   0, 0
        .short  0
        .asciz  ""
1:
        cv_end

        cv_proc 0x1110, switch_table
        # S_FRAMEPROC, which cl writes first in a scope and pdb 0.8 cannot parse.
        .short  28
        .short  0x1012
        .long   0, 0, 0, 0, 0
        .short  0
        .long   0
        cv_data 0, switch_table_cases, ""
        cv_end

        # cl lists a procedure's tables from the last to the first.
        cv_proc 0x1110, two_level
        cv_data 0, two_level_more_cases, ""
        cv_data 0, two_level_bytes, ""
        cv_data 0, two_level_cases, ""
        cv_end

        cv_proc 0x110f, static_procedure
        cv_data 0, static_procedure_cases, ""
        cv_end

        # An inlined call is a scope of its own, and it ends before the table
        # record of the procedure.
        cv_proc 0x1110, inlined_call
        .short  14
        .short  0x114d                  # S_INLINESITE
        .long   0, 0                    # parent, end: the linker fills them in
        .long   0                       # inlinee
        .short  2
        .short  0x114e                  # S_INLINESITE_END
        cv_data 0, inlined_call_cases, ""
        cv_end
symbols_end:
        .p2align 2

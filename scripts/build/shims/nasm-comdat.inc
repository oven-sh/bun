; Pre-included (nasm -P) into every .asm assembled for a COFF target
; (compile.ts nasm()).
;
; COFF linkers discard unreferenced code only at COMDAT granularity
; (/OPT:REF): the compiler puts each function in its own COMDAT (/Gy,
; -ffunction-sections), but a plain section from a hand-written .asm is not
; one and is always kept, so an object nothing calls — BoringSSL's
; AES-GCM-SIV, say — would ship as dead code the moment it is linked as an
; object rather than left behind in a static library.
;
; This redefines NASM's `section` directive so the object's sections come
; out as COMDATs keyed on one per-object symbol (NASM_COMDAT_ID, passed with
; -D by the build): .text is the primary — kept iff any symbol defined in it
; is referenced — and the data and unwind sections (.rdata .data .bss .pdata
; .xdata) are associative to it. The object therefore links all-or-nothing,
; exactly as an archive member would, and the linker drops it when nothing
; references it. Sections by any other name pass through unchanged.
%ifndef NASM_COMDAT_ID
  %fatal NASM_COMDAT_ID must be defined (-DNASM_COMDAT_ID=<identifier unique to this object>)
%endif
%unimacro section 1+.nolist
%imacro section 1+.nolist
  %defstr __nasm_comdat_sect %1
  %substr __nasm_comdat_kind __nasm_comdat_sect 2,5
  %ifidni __nasm_comdat_kind, 'text '
    %define __?SECT?__ [section .text$nc code align=64 comdat=1:NASM_COMDAT_ID]
  %elifidni __nasm_comdat_kind, 'text'
    %define __?SECT?__ [section .text$nc code align=64 comdat=1:NASM_COMDAT_ID]
  %elifidni __nasm_comdat_kind, 'rdata'
    %define __?SECT?__ [section .rdata$nc rdata align=64 comdat=5:NASM_COMDAT_ID]
  %elifidni __nasm_comdat_kind, 'data '
    %define __?SECT?__ [section .data$nc data align=64 comdat=5:NASM_COMDAT_ID]
  %elifidni __nasm_comdat_kind, 'data'
    %define __?SECT?__ [section .data$nc data align=64 comdat=5:NASM_COMDAT_ID]
  %elifidni __nasm_comdat_kind, 'bss '
    %define __?SECT?__ [section .bss$nc bss align=64 comdat=5:NASM_COMDAT_ID]
  %elifidni __nasm_comdat_kind, 'bss'
    %define __?SECT?__ [section .bss$nc bss align=64 comdat=5:NASM_COMDAT_ID]
  %elifidni __nasm_comdat_kind, 'pdata'
    %define __?SECT?__ [section .pdata$nc rdata align=4 comdat=5:NASM_COMDAT_ID]
  %elifidni __nasm_comdat_kind, 'xdata'
    %define __?SECT?__ [section .xdata$nc rdata align=8 comdat=5:NASM_COMDAT_ID]
  %else
    %define __?SECT?__ [section %1]
  %endif
  __?SECT?__
%endmacro

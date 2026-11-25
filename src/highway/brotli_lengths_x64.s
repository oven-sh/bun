// `SymbolLists::read_short_runs`. Leaves a long run of the length in eax in edx, or else zero.
    push rbx
    push rax
    .p2align 4
2:
    cmp r10, [rsp]
    ja 4f
    shlx rcx, [r10], r9
    or r8, rcx
    andn ecx, r9d, [rsi+{low_six_bits}]
    shr ecx, 3
    add r10, rcx
    or r9d, 56
.rept 7
    mov eax, r8d
    and eax, 31
    movzx ecx, byte ptr [rdi+rax*8]
    movzx edx, word ptr [rdi+rax*8+4]
    bextr edx, r8d, edx
    inc edx
    shrx r8, r8, rcx
    sub r9d, ecx
    movzx ecx, byte ptr [rdi+rax*8+1]
    mov ebx, r14d
    imul ebx, r15d
    cmp ecx, r14d
    mov r14d, ecx
    movzx ecx, byte ptr [rdi+rax*8+3]
    movzx eax, byte ptr [rdi+rax*8+2]
    cmove ecx, ebx
    cmovne r15d, [rsi+{no_run}]
    add edx, ecx
    add r15d, edx
    cmp r14d, 3
    cmove eax, r13d
    test eax, eax
    cmovne r13d, eax
    mov rbx, [rsi+rax*8]
    imul rbx, rdx
    .p2align 5,,12
    test rbx, [rsi+{long_run}]
    jnz 5f
    movzx ecx, word ptr [rdi+rax*2+{ends}]
    vmovdqu ymm0, [rsi+r11*2+{numbers}]
    vmovdqu [rdi+rcx*2+{symbols}], ymm0
    add ecx, edx
    mov [rdi+rax*2+{ends}], cx
    add r11, rdx
    add r12, rbx
    .p2align 5,,12
    test r12, [rsi+{full}]
    jnz 4f
.endr
    jmp 2b
4:
    xor edx, edx
5:
    vzeroupper
    pop rbx
    pop rbx

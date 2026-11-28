// rbp  Machine::frame       r8, r9  bits and their count (the low six bits)   r10  input
// rdi  output               r11     command tree      r12  distance tree      r13  last distance
// rdx  literal tree         r14     copy length       r15  distance, then what the last byte adds to a context

// Skylake does not cache a jump that touches the end of 32 bytes.
.macro J
    .p2align 5,,10
.endm

// Leaves 56 bits or more, and all 64 are from the input.
.macro refill t=c
    shlx r\t\()x, [r10], r9
    or r8, r\t\()x
    andn e\t\()x, r9d, [rbp+{low_six_bits}]
    shr e\t\()x, 3
    add r10, r\t\()x
    or r9d, 56
.endm

.macro peek_command
    mov eax, [rbp+{command_mask}]
    and eax, r8d
.endm

.macro peek_distance
    movzx ebx, r8b
    mov rbx, [r12+rbx*8]
.endm

// For a literal after the bytes that end at `end`.
.macro select_tree contexts, end
.if \contexts
    movzx r15d, byte ptr [\end-1]
    movzx edx, byte ptr [\end-2]
    movzx esi, byte ptr [rbp+r15+{context_parts}]
    add sil, [rbp+rdx+{context_parts}+256]
    mov rdx, [rbp+rsi*8+{literal_trees}]
.endif
.endm

.macro begin_literals contexts
.if \contexts
    movzx r15d, byte ptr [rbp+r15+{context_parts}+256]
    lea r15, [rbp+r15*8]
.endif
.endm

// `selects` the tree for the next one.
.macro literal label, at, selects, peeked, refills, special=0x10
.if !\peeked
    mov eax, [rbp+{literal_mask}]
    and eax, r8d
    mov esi, [rdx+rax*4]
.if \selects
    movzx eax, byte ptr [rdx+rax*4+3]
.endif
.elseif \selects
    rorx eax, esi, 24
    movzx eax, al
.endif
.if \refills
    refill
.endif
    J
    test sil, \special
    jnz \label\()_link
\label:
.if \selects
    mov rdx, [r15+rax*8+{literal_trees}]
.endif
    shrx r8, r8, rsi
    sub r9d, esi
    shr esi, 8
    mov [rdi+\at], sil
.if \selects
    shr esi, 8
    movzx r15d, sil
    lea r15, [rbp+r15*8]
.endif
.endm

.macro literal_link L, label
\label\()_link:
    call \L\()follow_literal_link
    jmp \label
.endm

.macro few_literals L, V, contexts, start, count, repeats
    .org \V\()handlers+\start, 0xCC
    sub dword ptr [rbp+{literals_left}], \count
    jb \L\()block_ends
.if \count > 1
    begin_literals \contexts
.endif
.irp at, 0, 1, 2, 3, 4
.if \at < \count
    literal \V\()h\start\()_\at, \at, (\contexts&&\at+1<\count), (\at==0), (\at==2)
.endif
.endr
    add rdi, \count
.if \repeats
    J
    jmp \V\()implicit
.else
    peek_distance
.if \count != 3
    refill
.endif
    J
    jmp \V\()distance
.endif
.endm

.macro few_literal_links L, V, start, count
.irp at, 0, 1, 2, 3, 4
.if \at < \count
    literal_link \L, \V\()h\start\()_\at
.endif
.endr
.endm

.macro variant L, V, contexts, distance_contexts
    .p2align 6
\V\()enter:
    lea rcx, [rip+\V\()handlers]
    mov [rbp+{handlers}], rcx
    select_tree \contexts, rbp+{last_bytes}+2
    cmp dword ptr [rbp+{value}], 0
    jne \V\()only_literals
    .p2align 5
\V\()top:
    cmp r10, [rbp+{last_input}]
    ja \L\()stop
    refill
\V\()command:
    movzx ecx, byte ptr [r11+rax*8]
.if \distance_contexts
    movzx r12d, byte ptr [r11+rax*8+3]
.endif
    movzx ebx, byte ptr [r11+rax*8+1]
    movzx r14d, word ptr [r11+rax*8+4]
    bzhi rsi, r8, rcx
    shrx r8, r8, rcx
    sub r9d, ecx
    movzx ecx, word ptr [r11+rax*8+6]
    add rcx, [rbp+{handlers}]
.if \distance_contexts
    mov r12, [rbp+r12+{distance_trees}]
.endif
    mov [rbp+{extra_bits}], rsi
    shrx rsi, rsi, rbx
    lea r14d, [r14+rsi+2]
    // What comes next is there sooner if the jump is mispredicted.
    peek_distance
    mov esi, [rbp+{literal_mask}]
    and esi, r8d
    mov esi, [rdx+rsi*4]
    J
    jmp rcx

    .p2align 5
\V\()handlers:
\V\()distance:
    cmp bl, 29
    ja \V\()special_distance
\V\()refilled_distance:
    movzx esi, bh
    bzhi r15, r8, rbx
    shrx r8, r8, rbx
    peek_command
    sub r9d, ebx
    rorx rcx, rbx, 16
    shrx r15, r15, rcx
    shr rbx, 32
    imul r15d, [rbp+{distance_step}]
    add r15d, ebx
    add r15d, [r13+rsi*4-12]
\V\()reference:
    mov rcx, rdi
    sub rcx, r15
    J
    cmp rcx, [rbp+{near}]
    jl \V\()far
\V\()copy:
    J
    cmp r14, r15
    ja \V\()overlap
    mov [r13+4], r15
    add r13, 4
    select_tree \contexts, rcx+r14
    mov rbx, [rbp+{to_destination}]
    prefetchw [rdi+384]
    prefetchw [rdi+rbx]
    vmovdqu ymm0, [rcx]
    vmovdqu ymm1, [rcx+32]
    vmovdqu [rdi], ymm0
    vmovdqu [rdi+32], ymm1
    J
    cmp r14, 64
    ja \V\()long_copy
    add rdi, r14
    J
    cmp rdi, [rbp+{limit}]
    jae \L\()past_limit
\V\()next:
    J
    cmp r13, [rbp+{history_end}]
    jb \V\()top
    xor eax, eax
    jmp \L\()exit

    few_literals \L, \V, \contexts, {h1}, 1, 0
    few_literals \L, \V, \contexts, {h2}, 2, 0
    few_literals \L, \V, \contexts, {h3}, 3, 0
    few_literals \L, \V, \contexts, {h4}, 4, 0
    few_literals \L, \V, \contexts, {h5}, 5, 0

    .org \V\()handlers+{h6}, 0xCC
\V\()implicit:
    inc dword ptr [rbp+{without_distance}]
// Takes the last distance back, to append it again.
\V\()repeat:
    peek_command
    mov r15d, [r13]
    sub r13, 4
    sub qword ptr [rbp+{history_end}], 4
    J
    jmp \V\()reference

    few_literals \L, \V, \contexts, {h7}, 1, 1
    few_literals \L, \V, \contexts, {h8}, 2, 1
    few_literals \L, \V, \contexts, {h9}, 3, 1
    few_literals \L, \V, \contexts, {h10}, 4, 1
    few_literals \L, \V, \contexts, {h11}, 5, 1

    .org \V\()handlers+{h12}, 0xCC
    mov rsi, [r11+rax*8]
    mov [rbp+{command}], rsi
    cmp sil, 45
    jbe \V\()any_lengths
    jmp \L\()too_many_bits

    .org \V\()handlers+{h13}, 0xCC
    movzx esi, byte ptr [r11+rax*8+1]
    movzx ebx, byte ptr [r11+rax*8+2]
    movzx eax, word ptr [r11+rax*8+4]
    shl eax, 8
    add eax, ebx
    mov ecx, [rbp+{command_bits}]
    shrx ecx, r8d, ecx
    add eax, [rbp+{command_mask}]
    bzhi ecx, ecx, esi
    lea eax, [rax+rcx+1]
    lea rcx, [r11+rax*8]
    J
    cmp rcx, [rbp+{commands_end}]
    jae \L\()broken
    J
    cmp byte ptr [rcx], 0
    jns \V\()command
    jmp \L\()broken

\V\()only_literals:
    mov eax, [rbp+{value}]
    mov byte ptr [rbp+{command}+3], 0x40
    jmp \V\()many_literals

    .p2align 4
\V\()any_lengths:
    movzx ecx, byte ptr [r11+rax*8+2]
    mov rax, [rbp+{format}]
    shr esi, 8
    bzhi rbx, [rbp+{extra_bits}], rsi
    sub sil, [rax+rcx*4+2]
    movzx eax, word ptr [rax+rcx*4]
    shrx rsi, rbx, rsi
    J
    add eax, esi
    jz \V\()after_literals
    J
    cmp eax, [rbp+{max_insert}]
    ja \L\()leave_literals
\V\()many_literals:
    lea rbx, [rdi+rax]
    J
    cmp rbx, [rbp+{limit}]
    jae \L\()leave_literals
    J
    sub [rbp+{literals_left}], eax
    jb \L\()return_literals
    begin_literals \contexts
\V\()more_literals:
    J
    cmp r10, [rbp+{last_input}]
    ja \L\()input_ends
.irp at, 0, 1, 2
.if \at == 0
    literal \V\()many0, 0, \contexts, 0, 1, [rbp+{special}]
.else
    literal \V\()many\at, 0, \contexts, 0, 0
.endif
    inc rdi
    J
    cmp rdi, rbx
.if \at < 2
    je \V\()after_literals
.else
    jne \V\()more_literals
.endif
.endr
\V\()after_literals:
    peek_distance
    refill
    J
    cmp byte ptr [rbp+{command}+3], 0x20
    jb \V\()distance
    je \V\()implicit
    jmp \L\()stop

    .p2align 4
\V\()long_copy:
    lea rbx, [rdi+r14]
    J
    cmp rbx, [rbp+{limit}]
    jae \L\()leave_appended_copy
    sub rcx, rdi
    add rdi, 64
2:
    vmovdqu ymm0, [rcx+rdi]
    vmovdqu ymm1, [rcx+rdi+32]
    vmovdqu [rdi], ymm0
    vmovdqu [rdi+32], ymm1
    add rdi, 64
    J
    cmp rdi, rbx
    jb 2b
    mov rdi, rbx
    jmp \V\()next

    .p2align 4
\V\()far:
    mov rsi, rdi
    sub rsi, [rbp+{origin}]
    mov rdx, [rbp+{max_backward_distance}]
    cmp rsi, rdx
    cmova rsi, rdx
.if \contexts
    J
    cmp rsi, 2
    jb \L\()leave_copy
.endif
    J
    sub rsi, r15
    jae \V\()in_window
    not rsi
    J
    sub rsi, [rbp+{dictionary_len}]
    jb \V\()in_dictionary
    lea edx, [r14-4]
    J
    cmp edx, 20
    ja \L\()leave_copy
    mov rcx, [rbp+{format}]
    mov edx, [rcx+r14*4+{word_lengths}]
    shrx rbx, rsi, rdx
    J
    cmp rbx, [rbp+{transform_count}]
    jae \L\()leave_copy
    cmp dword ptr [r13+4], 0
    J
    jne \L\()leave_copy
    bzhi esi, esi, edx
    shl ebx, 5
    lea rbx, [rcx+rbx+{transforms}]
    imul esi, r14d
    shr edx, 8
    add rdx, [rbp+{words}]
    lea rcx, [rdx+rsi]
    movzx esi, byte ptr [rbx+20]
    movzx edx, byte ptr [rcx]
    cmp edx, 0xC0
    sbb esi, 0
    J
    jg \V\()uppercase
    movzx esi, byte ptr [rbx+20]
    shl esi, 5
    sub edx, 97
    cmp edx, 26
    sbb edx, edx
    and edx, esi
    vmovd xmm1, edx
\V\()word:
    movzx edx, byte ptr [rbx+18]
    vpxor ymm0, ymm1, [rcx+rdx]
    mov rcx, [rbx]
    mov [rdi], rcx
    movzx edx, byte ptr [rbx+16]
    add rdi, rdx
    vmovdqu [rdi], ymm0
    movzx edx, byte ptr [rbx+19]
    xor ecx, ecx
    sub r14d, edx
    cmovb r14d, ecx
    add rdi, r14
    mov rcx, [rbx+8]
    mov [rdi], rcx
    movzx ebx, byte ptr [rbx+17]
    add rdi, rbx
    sub qword ptr [rbp+{history_end}], 4
\V\()written:
    mov rdx, [rbp+{literal_trees}]
    select_tree \contexts, rdi
    J
    cmp rdi, [rbp+{limit}]
    jb \V\()next
    jmp \L\()stop

// All of the word, or else a character that is not ASCII.
\V\()uppercase:
    vmovdqu ymm0, [rcx]
    vpmovmskb edx, ymm0
    bzhi edx, edx, r14d
    jnz \L\()leave_copy
    // All ones from 'a' to 'z', which become the lowest of the signed bytes.
    mov edx, 128-97
    vmovd xmm1, edx
    vpbroadcastb ymm1, xmm1
    vpaddb ymm0, ymm0, ymm1
    mov edx, 128+26
    vmovd xmm1, edx
    vpbroadcastb ymm1, xmm1
    vpcmpgtb ymm1, ymm1, ymm0
    vpabsb ymm1, ymm1
    vpsllw ymm1, ymm1, 5
    jmp \V\()word

\V\()in_window:
    mov rdx, [rbp+{literal_trees}]
    mov rsi, [rbp+{start}]
    J
    cmp rcx, rsi
    jge \V\()copy
    lea rbx, [rcx+r14]
    add rcx, [rbp+{lap}]
    J
    cmp rbx, rsi
    jle \V\()copy
    jmp \L\()leave_copy

\V\()in_dictionary:
    mov rdx, [rbp+{literal_trees}]
    add rsi, [rbp+{dictionary_len}]
    inc rsi
    mov rcx, [rbp+{dictionary_end}]
    sub rcx, rsi
    J
    cmp r14, rsi
    jbe \V\()copy
    jmp \L\()leave_copy

\V\()overlap:
    lea rbx, [rdi+r14]
    cmp rbx, [rbp+{limit}]
    jae \L\()leave_copy
    test r15, r15
    jz \L\()leave_copy
    mov [r13+4], r15
    add r13, 4
    call \L\()copy_overlapping
    jmp \V\()written

\V\()special_distance:
    refill
    J
    cmp bl, 0x80
    jne 2f
    rorx rcx, rbx, 16
    shr rbx, 32
    rorx eax, r8d, 8
    bzhi eax, eax, ecx
    add ebx, eax
    lea rbx, [r12+rbx*8+2048]
    cmp rbx, [rbp+{distances_end}]
    jae \L\()broken
    mov rbx, [rbx]
2:
    J
    cmp bl, 0x40
    jb \V\()refilled_distance
    shrx r8, r8, rbx
    sub r9d, ebx
    jmp \V\()repeat

    few_literal_links \L, \V, {h1}, 1
    few_literal_links \L, \V, {h2}, 2
    few_literal_links \L, \V, {h3}, 3
    few_literal_links \L, \V, {h4}, 4
    few_literal_links \L, \V, {h5}, 5
    few_literal_links \L, \V, {h7}, 1
    few_literal_links \L, \V, {h8}, 2
    few_literal_links \L, \V, {h9}, 3
    few_literal_links \L, \V, {h10}, 4
    few_literal_links \L, \V, {h11}, 5
    literal_link \L, \V\()many1
    literal_link \L, \V\()many2

\V\()many0_link:
    test sil, 0x10
    jz 2f
    call \L\()follow_literal_link
    jmp \V\()many0
2:
    lea rcx, [rdi+7]
    J
    cmp rcx, rbx
    ja \V\()many0
    // Nothing waits for an entry as long as it has the length in r14, and is the same in the right tree, rcx.
    mov [rbp+{copy_length}], r14d
    movzx r14d, sil
    mov rcx, rdx
    .p2align 4
3:
.irp at, 0, 1, 2, 3, 4, 5
.if \contexts
    mov eax, [rbp+{literal_mask}]
    and eax, r8d
    mov esi, [rdx+rax*4]
    J
    cmp esi, [rcx+rax*4]
    jne \V\()wrong\at
    J
    cmp sil, r14b
    jne \V\()wrong\at
    movzx eax, byte ptr [rdx+rax*4+3]
    mov rcx, [r15+rax*8+{literal_trees}]
    shr esi, 8
    mov [rdi+\at], sil
    shr esi, 8
    movzx r15d, sil
    lea r15, [rbp+r15*8]
.else
    mov esi, [rbp+{literal_mask}]
    and esi, r8d
    mov eax, [rdx+rsi*4]
    J
    cmp al, r14b
    jne \V\()wrong\at
    mov [rdi+\at], ah
.endif
    shrx r8, r8, r14
.endr
    imul eax, r14d, 6
    sub r9d, eax
    add rdi, 6
    inc dword ptr [rbp+{credit}]
    lea rax, [rdi+7]
    J
    cmp rax, rbx
    ja 4f
    J
    cmp r10, [rbp+{last_input}]
    ja 4f
    refill a
    jmp 3b
.irp at, 5, 4, 3, 2, 1
\V\()wrong\at:
    sub r9d, r14d
    inc rdi
.endr
\V\()wrong0:
    dec dword ptr [rbp+{credit}]
    jns 4f
    mov dword ptr [rbp+{special}], 0x10
4:
    mov rdx, rcx
    mov r14d, [rbp+{copy_length}]
    jmp \V\()more_literals
.endm

.macro brotli_machine L
.if {windows}
    .seh_proc {enter}
.endif
.irp kept, rbp, rbx, r12, r13, r14, r15
    push \kept
.if {windows}
    .seh_pushreg \kept
.endif
.endr
.if {windows}
    .seh_endprologue
.endif
    lea rbp, [rdi+{frame}]
    mov r8, [rbp+{bits}]
    mov r9, [rbp+{bit_count}]
    mov r10, [rbp+{input}]
    mov rdi, [rbp+{output}]
    mov r11, [rbp+{command_tree}]
    mov r12, [rbp+{distance_trees}]
    mov r13, [rbp+{last_distance}]
    mov rdx, [rbp+{literal_trees}]
    refill
    peek_command
    cmp dword ptr [rbp+{variant}], 1
    jb \L\()a_enter
    je \L\()b_enter
    cmp dword ptr [rbp+{variant}], 3
    jb \L\()c_enter
    jmp \L\()d_enter

    variant \L, \L\()a_, 0, 0
    variant \L, \L\()b_, 1, 0
    variant \L, \L\()c_, 0, 1
    variant \L, \L\()d_, 1, 1

\L\()too_many_bits:
    shlx r8, r8, rsi
    or r8, [rbp+{extra_bits}]
    add r9d, esi
\L\()stop:
    mov eax, 1
    jmp \L\()exit
\L\()broken:
    mov eax, 5
    jmp \L\()exit
\L\()block_ends:
    mov rcx, [r11+rax*8]
    mov [rbp+{command}], rcx
    movzx eax, byte ptr [r11+rax*8+2]
    jmp \L\()return_literals
\L\()input_ends:
    mov rax, rbx
    sub rax, rdi
\L\()return_literals:
    add [rbp+{literals_left}], eax
\L\()leave_literals:
    mov r15d, eax
    inc dword ptr [rbp+{without_distance}]
    mov eax, 2
    jmp 2f
\L\()past_limit:
    sub rdi, r14
\L\()leave_appended_copy:
    mov r15d, [r13]
    mov eax, 4
    jmp 3f
\L\()leave_copy:
    mov eax, 3
    cmp dword ptr [r13+4], 0
    je 2f
    add r13, 4
    jmp \L\()leave_appended_copy
2:
    sub qword ptr [rbp+{history_end}], 4
3:
    mov [rbp+{copy_length}], r14d
    mov [rbp+{value}], r15d
\L\()exit:
    mov [rbp+{bits}], r8
    mov [rbp+{bit_count}], r9
    mov [rbp+{input}], r10
    mov [rbp+{output}], rdi
    mov [rbp+{last_distance}], r13
    vzeroupper
.irp kept, r15, r14, r13, r12, rbx, rbp
    pop \kept
.endr
    ret
// What is called comes after this, where unwinding expects the return address on top of the stack.
.if {windows}
    .seh_endproc
.endif

\L\()follow_literal_link:
    mov eax, [rbp+{literal_bits}]
    shrx eax, r8d, eax
    mov ecx, esi
    and ecx, 15
    bzhi eax, eax, ecx
    shr esi, 6
    add eax, esi
    and eax, 511
    add eax, [rbp+{literal_mask}]
    mov esi, [rdx+rax*4+4]
    movzx eax, byte ptr [rdx+rax*4+7]
    ret

// Up to rbx.
\L\()copy_overlapping:
    cmp r15, 16
    jae 3f
    mov rdx, [rbp+{format}]
    movzx esi, byte ptr [rdx+r15+{pattern_steps}]
    shl r15d, 5
    vbroadcasti128 ymm0, [rcx]
    vpshufb ymm0, ymm0, [rdx+r15+{patterns}]
    .p2align 5
2:
    vmovdqu [rdi], ymm0
    vmovdqu [rdi+rsi], ymm0
    lea rdi, [rdi+rsi*2]
    J
    cmp rdi, rbx
    jb 2b
    mov rdi, rbx
    ret
3:
    cmp r15, 32
    jae 4f
    // After one period, twice the distance will do.
    vmovdqu ymm0, [rcx]
    vmovdqu [rdi], ymm0
    add rdi, r15
4:
    sub rcx, rdi
    .p2align 5
5:
    vmovdqu ymm0, [rcx+rdi]
    vmovdqu [rdi], ymm0
    add rdi, 32
    J
    cmp rdi, rbx
    jb 5b
    mov rdi, rbx
    ret
.endm

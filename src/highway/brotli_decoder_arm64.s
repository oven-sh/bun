// x0  Machine          x1, w2  bits and their count (the low six bits)   x3   input           x4   output
// x5  command tree     x6      distance tree    x7   last distance       x8   literal tree    x9   copy length
// x10 distance, then the trees that the last byte leaves to choose from  x11  command         x12  entry for a distance
// x14 entry for a literal      x17  handlers    x20  last_input          x21  limit           x22  near
// x23 history_end      w24     command_mask     w25  literal_mask        w26  literals_left   x27  context_parts
// x28 all ones         w30     distance_step

// The unwind info of Windows needs the length of the function before `.p2align` and `.org` have one.
.macro align bits
.if {aligns}
    .p2align \bits
.endif
.endm

.macro handler V, start
.rept (\start-(.-\V\()handlers))/4
    brk #0
.endr
.endm

// Leaves 56 bits or more, and all 64 are from the input.
.macro refill
    ldr x15, [x3]
    mvn w16, w2
    lsl x15, x15, x2
    ubfx w16, w16, #3, #3
    orr x1, x1, x15
    add x3, x3, x16
    orr w2, w2, #56
.endm

.macro peek_command
    and w11, w1, w24
    ldr x11, [x5, x11, lsl #3]
.endm

.macro peek_distance
    and x12, x1, #0xFF
    ldr x12, [x6, x12, lsl #3]
.endm

.macro peek_literal
    and w14, w1, w25
    ldr w14, [x8, x14, lsl #2]
.endm

// For a literal after the bytes that end at `end`. The trees come after the parts.
.macro select_tree contexts, end
.if \contexts
    ldurb w10, [\end, #-1]
    ldurb w8, [\end, #-2]
    add x16, x27, #256
    ldrb w8, [x16, x8]
    ldrb w15, [x27, x10]
    ldrb w10, [x16, x10]
    add x16, x27, #512
    add x8, x16, x8, lsl #3
    ldr x8, [x8, x15, lsl #3]
    add x10, x16, x10, lsl #3
.endif
.endm

// `selects` the tree for the next one.
.macro literal label, selects, peeked, refills, may_guess=0
.if \peeked == 0
    peek_literal
.endif
.if \refills
    refill
.endif
.if \may_guess
    ldr w15, [x0, #{special}]
    tst w14, w15
    b.ne \label\()_special
.else
    tbnz w14, #4, \label\()_link
.endif
\label:
.if \selects
    lsr w15, w14, #24
    ldr x8, [x10, x15, lsl #3]
    ubfx w15, w14, #16, #8
    add x10, x27, x15, lsl #3
    add x10, x10, #512
.endif
    lsr x1, x1, x14
    sub w2, w2, w14
    lsr w14, w14, #8
    strb w14, [x4], #1
.endm

.macro literal_link label
\label\()_link:
    ldr w15, [x0, #{literal_bits}]
    and w16, w14, #15
    lsr w15, w1, w15
    lsl w16, w28, w16
    bic w15, w15, w16
    add w15, w15, w14, lsr #6
    and w15, w15, #511
    add w15, w15, w25
    add w15, w15, #1
    ldr w14, [x8, x15, lsl #2]
    b \label
.endm

.macro few_literals L, V, contexts, start, count, repeats
    handler \V, \start
    subs w26, w26, #\count
    b.lo \L\()block_ends
.irp at, 0, 1, 2, 3, 4
.if \at < \count
    literal \V\()h\start\()_\at, (\contexts&&\at+1<\count), (\at==0), (\at==2)
.endif
.endr
.if \repeats
    b \V\()implicit
.else
    peek_distance
.if \count != 3
    refill
.endif
    b \V\()distance
.endif
.endm

.macro few_literal_links V, start, count
.irp at, 0, 1, 2, 3, 4
.if \at < \count
    literal_link \V\()h\start\()_\at
.endif
.endr
.endm

.macro variant L, V, contexts, distance_contexts
    align 6
\V\()enter:
    adr x17, \V\()handlers
    add x12, x0, #{last_bytes}+2
    select_tree \contexts, x12
    ldr w13, [x0, #{value}]
    cbnz w13, \V\()only_literals
    align 4
\V\()top:
    cmp x3, x20
    b.hi \L\()stop
    refill
\V\()command:
.if \distance_contexts
    ubfx x6, x11, #24, #8
    add x6, x0, x6
    ldr x6, [x6, #{distance_trees}]
.endif
    lsl x13, x28, x11
    bic x13, x1, x13
    lsr x1, x1, x11
    add x16, x17, x11, lsr #48
    // What comes next is there sooner if the jump is mispredicted.
    peek_distance
    peek_literal
    sub w2, w2, w11
    lsr x15, x11, #8
    ubfx x9, x11, #32, #16
    lsr x15, x13, x15
    add w9, w9, #2
    add w9, w9, w15
    br x16

    align 5
\V\()handlers:
\V\()distance:
    and w15, w12, #0xFF
    cmp w15, #29
    b.hi \V\()special_distance
\V\()refilled_distance:
    lsl x10, x28, x12
    bic x10, x1, x10
    lsr x1, x1, x12
    peek_command
    sub w2, w2, w12
    lsr x15, x12, #16
    ubfx x16, x12, #8, #8
    sub x13, x7, #12
    lsr x10, x10, x15
    ldr w16, [x13, x16, lsl #2]
    lsr x12, x12, #32
    add w12, w12, w16
    madd w10, w10, w30, w12
\V\()reference:
    sub x13, x4, x10
    cmp x13, x22
    b.lt \V\()far
\V\()copy:
    cmp x9, x10
    b.hi \V\()overlap
    str x10, [x7, #4]!
    ldp q0, q1, [x13]
    ldp q2, q3, [x13, #32]
.if \contexts
    add x12, x13, x9
    select_tree 1, x12
.endif
    ldr x15, [x0, #{to_destination}]
    prfm pstl1keep, [x4, #384]
    prfm pstl2keep, [x4, x15]
    stp q0, q1, [x4]
    stp q2, q3, [x4, #32]
    cmp x9, #64
    b.hi \V\()long_copy
    add x4, x4, x9
    cmp x4, x21
    ccmp x7, x23, #2, lo
    b.lo \V\()top
    b \L\()after_copy

    few_literals \L, \V, \contexts, {h1}, 1, 0
    few_literals \L, \V, \contexts, {h2}, 2, 0
    few_literals \L, \V, \contexts, {h3}, 3, 0
    few_literals \L, \V, \contexts, {h4}, 4, 0
    few_literals \L, \V, \contexts, {h5}, 5, 0

    handler \V, {h6}
\V\()implicit:
    ldr w15, [x0, #{without_distance}]
    add w15, w15, #1
    str w15, [x0, #{without_distance}]
// Takes the last distance back, to append it again.
\V\()repeat:
    peek_command
    ldr w10, [x7], #-4
    sub x23, x23, #4
    b \V\()reference

    few_literals \L, \V, \contexts, {h7}, 1, 1
    few_literals \L, \V, \contexts, {h8}, 2, 1
    few_literals \L, \V, \contexts, {h9}, 3, 1
    few_literals \L, \V, \contexts, {h10}, 4, 1
    few_literals \L, \V, \contexts, {h11}, 5, 1

    handler \V, {h12}
    and w15, w11, #0xFF
    cmp w15, #45
    b.ls \V\()any_lengths
    b \L\()too_many_bits

    handler \V, {h13}
    ldr w15, [x0, #{command_bits}]
    lsr w16, w11, #8
    lsr w15, w1, w15
    lsl w16, w28, w16
    bic w15, w15, w16
    ubfx x16, x11, #24, #24
    bfxil x16, x11, #16, #8
    add w16, w16, w24
    add w16, w16, #1
    add w15, w15, w16
    ldr x16, [x0, #{commands_end}]
    add x15, x5, x15, lsl #3
    cmp x15, x16
    b.hs \L\()broken
    ldr x11, [x15]
    tbz w11, #7, \V\()command
    b \L\()broken

\V\()only_literals:
    mov w11, #0x40000000
    b \V\()many_literals

    align 4
\V\()any_lengths:
    ldr x15, [x0, #{format}]
    ubfx w16, w11, #16, #8
    ldr w15, [x15, x16, lsl #2]
    lsr w16, w11, #8
    lsl x12, x28, x16
    bic x13, x13, x12
    sub w16, w16, w15, lsr #16
    lsr x13, x13, x16
    add w13, w13, w15, uxth
    ldr w15, [x0, #{max_insert}]
    cbz w13, \V\()after_literals
    cmp w13, w15
    b.hi \L\()leave_literals
\V\()many_literals:
    add x12, x4, x13
    cmp x12, x21
    b.hs \L\()leave_literals
    subs w26, w26, w13
    b.lo \L\()return_literals
\V\()more_literals:
    cmp x3, x20
    b.hi \L\()input_ends
.irp at, 0, 1, 2
    literal \V\()many\at, \contexts, 0, (\at==0), (\at==0)
    cmp x4, x12
.if \at < 2
    b.eq \V\()after_literals
.else
    b.ne \V\()more_literals
.endif
.endr
\V\()after_literals:
    peek_distance
    refill
    tbnz w11, #29, \V\()implicit
    tbz w11, #30, \V\()distance
    b \L\()stop

    align 4
\V\()long_copy:
    add x12, x4, x9
    cmp x12, x21
    b.hs \L\()leave_appended_copy
    sub x15, x12, #64
2:
    ldp q0, q1, [x13, #64]!
    ldp q2, q3, [x13, #32]
    stp q0, q1, [x4, #64]!
    stp q2, q3, [x4, #32]
    cmp x4, x15
    b.lo 2b
    mov x4, x12
    cmp x7, x23
    b.lo \V\()top
    b \L\()after_copy

    align 4
\V\()far:
    ldp x12, x14, [x0, #{origin}]
    ldp x15, x16, [x0, #{format}]
    sub x12, x4, x12
    cmp x12, x16
    csel x12, x12, x16, lo
.if \contexts
    cmp x12, #2
    b.lo \L\()leave_copy
.endif
    subs x12, x12, x10
    b.hs \V\()in_window
    mvn x12, x12
    cmp x12, x14
    b.lo \V\()in_dictionary
    sub x12, x12, x14
    sub w16, w9, #4
    cmp w16, #20
    b.hi \L\()leave_copy
    add x16, x15, x9, lsl #2
    ldr w16, [x16, #{word_lengths}]
    ldr x13, [x0, #{transform_count}]
    lsr x14, x12, x16
    cmp x14, x13
    b.hs \L\()leave_copy
    ldr w13, [x7, #4]
    cbnz w13, \L\()leave_copy
    add x14, x15, x14, lsl #5
    lsl x15, x28, x16
    bic x12, x12, x15
    ldr x13, [x0, #{words}]
    add x13, x13, x16, lsr #8
    madd x13, x12, x9, x13
    ldr x12, [x14, #{transforms}+16]
    ldrb w15, [x13]
    ubfx x16, x12, #32, #8
    cmp w15, #0xC0
    sbc w8, w16, wzr
    cmp w8, #0
.if \contexts == 0
    ldr x8, [x0, #{literal_trees}]
.endif
    b.gt \V\()uppercase
    sub w15, w15, #97
    cmp w15, #26
    csel w16, w16, wzr, lo
    lsl w16, w16, #5
    fmov s2, w16
    ubfx w15, w12, #16, #8
    add x13, x13, x15
    ldp q0, q1, [x13]
    eor v0.16b, v0.16b, v2.16b
\V\()word:
    ldp x15, x16, [x14, #{transforms}]
    str x15, [x4]
    add x4, x4, w12, uxtb
    stp q0, q1, [x4]
    subs w9, w9, w12, lsr #24
    csel w9, w9, wzr, hs
    str x16, [x4, x9]
    ubfx w15, w12, #8, #8
    add x9, x9, x15
    add x4, x4, x9
    sub x23, x23, #4
\V\()written:
    select_tree \contexts, x4
    cmp x4, x21
    ccmp x7, x23, #2, lo
    b.lo \V\()top
    b \L\()batch_ends

// All of the word, or else a character that is not ASCII.
\V\()uppercase:
    ldp q0, q1, [x13]
    umax v2.16b, v0.16b, v1.16b
    umaxv b2, v2.16b
    fmov w15, s2
    tbnz w15, #7, \L\()leave_copy
.irp half, v0.16b, v1.16b
    movi v2.16b, #97
    movi v3.16b, #26
    sub v2.16b, \half, v2.16b
    cmhi v2.16b, v3.16b, v2.16b
    movi v3.16b, #32
    and v2.16b, v2.16b, v3.16b
    eor \half, \half, v2.16b
.endr
    b \V\()word

\V\()in_window:
    ldp x15, x16, [x0, #{start}]
    cmp x13, x15
    b.ge \V\()copy
    add x12, x13, x9
    add x13, x13, x16
    cmp x12, x15
    b.le \V\()copy
    b \L\()leave_copy

\V\()in_dictionary:
    ldr x13, [x0, #{dictionary_end}]
    add x12, x12, #1
    sub x13, x13, x12
    cmp x9, x12
    b.ls \V\()copy
    b \L\()leave_copy

\V\()overlap:
    add x12, x4, x9
    cmp x12, x21
    b.hs \L\()leave_copy
    cbz x10, \L\()leave_copy
    str x10, [x7, #4]!
    cmp x10, #16
    b.hs 3f
    ldr x15, [x0, #{format}]
    add x15, x15, #{patterns}/64*64
    add x16, x15, x10, lsl #5
    add x15, x15, x10
    ldp q1, q2, [x16, #{patterns}%64]
    ldrb w15, [x15, #{pattern_steps}-{patterns}/64*64]
    ldr q0, [x13]
    tbl v1.16b, {{v0.16b}}, v1.16b
    tbl v2.16b, {{v0.16b}}, v2.16b
2:
    stp q1, q2, [x4]
    add x4, x4, x15
    cmp x4, x12
    b.lo 2b
    mov x4, x12
    b \V\()written
3:
    cmp x10, #32
    b.hs 4f
    // After one period, twice the distance will do.
    ldp q0, q1, [x13]
    stp q0, q1, [x4]
    add x4, x4, x10
4:
    ldp q0, q1, [x13], #32
    stp q0, q1, [x4], #32
    cmp x4, x12
    b.lo 4b
    mov x4, x12
    b \V\()written

\V\()special_distance:
    refill
    tbz w12, #7, 2f
    lsr w16, w12, #16
    lsr w15, w1, #8
    lsl w16, w28, w16
    bic w15, w15, w16
    add x15, x15, x12, lsr #32
    add x15, x15, #256
    ldr x16, [x0, #{distances_end}]
    add x15, x6, x15, lsl #3
    cmp x15, x16
    b.hs \L\()broken
    ldr x12, [x15]
2:
    tbz w12, #6, \V\()refilled_distance
    lsr x1, x1, x12
    sub w2, w2, w12
    b \V\()repeat

    few_literal_links \V, {h1}, 1
    few_literal_links \V, {h2}, 2
    few_literal_links \V, {h3}, 3
    few_literal_links \V, {h4}, 4
    few_literal_links \V, {h5}, 5
    few_literal_links \V, {h7}, 1
    few_literal_links \V, {h8}, 2
    few_literal_links \V, {h9}, 3
    few_literal_links \V, {h10}, 4
    few_literal_links \V, {h11}, 5
.irp at, 0, 1, 2
    literal_link \V\()many\at
.endr

\V\()many0_special:
    tbnz w14, #4, \V\()many0_link
    add x15, x4, #7
    cmp x15, x12
    b.hi \V\()many0
    // Nothing waits for an entry as long as it has the length in w9, and is the same in the right tree, x13.
    str w9, [x0, #{copy_length}]
    and w9, w14, #0xFF
    mov x13, x8
    align 4
3:
.rept 6
    and w15, w1, w25
    ldr w14, [x8, x15, lsl #2]
    cmp w9, w14, uxtb
.if \contexts
    ldr w15, [x13, x15, lsl #2]
    ccmp w14, w15, #0, eq
.endif
    b.ne 4f
.if \contexts
    lsr w15, w14, #24
    ldr x13, [x10, x15, lsl #3]
    ubfx w15, w14, #16, #8
    add x10, x27, x15, lsl #3
    add x10, x10, #512
.endif
    lsr x1, x1, x9
    sub w2, w2, w9
    lsr w14, w14, #8
    strb w14, [x4], #1
.endr
    ldr w15, [x0, #{credit}]
    add w15, w15, #1
    str w15, [x0, #{credit}]
    add x15, x4, #7
    cmp x15, x12
    ccmp x3, x20, #2, ls
    b.hi 5f
    refill
    b 3b
4:
    ldr w15, [x0, #{credit}]
    subs w15, w15, #1
    str w15, [x0, #{credit}]
    b.pl 5f
    mov w15, #0x10
    str w15, [x0, #{special}]
5:
    mov x8, x13
    ldr w9, [x0, #{copy_length}]
    b \V\()more_literals
.endm

.macro brotli_machine L
    ldp x1, x2, [x0, #{bits}]
    ldp x3, x4, [x0, #{input}]
    ldr x5, [x0, #{command_tree}]
    ldr x6, [x0, #{distance_trees}]
    ldr x7, [x0, #{last_distance}]
    ldr x8, [x0, #{literal_trees}]
    ldp x20, x21, [x0, #{last_input}]
    ldp x22, x23, [x0, #{near}]
    ldp w24, w25, [x0, #{command_mask}]
    ldr w26, [x0, #{literals_left}]
    add x27, x0, #{context_parts}
    mov x28, #-1
    ldr w30, [x0, #{distance_step}]
    refill
    peek_command
    ldr w15, [x0, #{variant}]
    cmp w15, #1
    b.lo \L\()a_enter
    b.eq \L\()b_enter
    cmp w15, #3
    b.lo \L\()c_enter
    b \L\()d_enter

    variant \L, \L\()a_, 0, 0
    variant \L, \L\()b_, 1, 0
    variant \L, \L\()c_, 0, 1
    variant \L, \L\()d_, 1, 1

\L\()too_many_bits:
    lsl x1, x1, x11
    orr x1, x1, x13
    add w2, w2, w11
\L\()stop:
    mov w15, #1
    b \L\()exit
\L\()broken:
    mov w15, #5
    b \L\()exit
\L\()block_ends:
    ubfx w13, w11, #16, #8
    b \L\()return_literals
\L\()input_ends:
    sub x13, x12, x4
\L\()return_literals:
    add w26, w26, w13
\L\()leave_literals:
    str x11, [x0, #{command}]
    mov w10, w13
    ldr w15, [x0, #{without_distance}]
    add w15, w15, #1
    str w15, [x0, #{without_distance}]
    mov w15, #2
    b 2f
\L\()after_copy:
    cmp x4, x21
    b.hs 4f
\L\()batch_ends:
    mov w15, #0
    b \L\()exit
4:
    sub x4, x4, x9
\L\()leave_appended_copy:
    ldr w10, [x7]
    mov w15, #4
    b 3f
\L\()leave_copy:
    mov w15, #3
    ldr w16, [x7, #4]
    cbz w16, 2f
    add x7, x7, #4
    b \L\()leave_appended_copy
2:
    sub x23, x23, #4
3:
    str w9, [x0, #{copy_length}]
    str w10, [x0, #{value}]
\L\()exit:
    stp x1, x2, [x0, #{bits}]
    stp x3, x4, [x0, #{input}]
    str x7, [x0, #{last_distance}]
    str x23, [x0, #{history_end}]
    str w26, [x0, #{literals_left}]
.endm

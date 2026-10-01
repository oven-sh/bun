# <bun_js_parser::p::P<true, false>>::try_skip_type_script_constraint_of_infer_type_with_backtracking
# = <bun_js_parser::p::P<true, true>>::try_skip_type_script_constraint_of_infer_type_with_backtracking
# size 1052 instructions 216
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%r13
pushq	%r12
pushq	%rbx
subq	$0x108, %rsp            # imm = 0x108
movq	%rdi, %rbx
movq	0x2f0(%rdi), %r13
movl	%esi, %eax
shrb	$0x3, %al
movzbl	%al, %eax
leal	(%rax,%r13,2), %r12d
movq	0x610(%rdi), %rcx
testq	%rcx, %rcx
je	<addr> <L+0x77>
movq	0x608(%rbx), %rax
xorl	%edx, %edx
cmpq	$0x1, %rcx
je	<addr> <L+0x6d>
nopw	%cs:(%rax,%rax)
nop
movq	%rdx, %r8
movq	%rcx, %rdi
shrq	%rdi
addq	%rdi, %rdx
cmpl	%r12d, (%rax,%rdx,4)
cmovaq	%r8, %rdx
subq	%rdi, %rcx
cmpq	$0x1, %rcx
ja	<addr> <L+0x50>
cmpl	%r12d, (%rax,%rdx,4)
je	<addr> <L+0x3d9>
movl	%esi, -0x34(%rbp)
leaq	0x208(%rbx), %rdi
movups	0x2f8(%rbx), %xmm0
movaps	%xmm0, -0xd0(%rbp)
movsd	0x308(%rbx), %xmm0
movaps	%xmm0, -0xc0(%rbp)
movzbl	0x351(%rbx), %r14d
movl	0x324(%rbx), %eax
movl	%eax, -0x38(%rbp)
movq	0x270(%rbx), %rax
movq	%rax, -0x60(%rbp)
movq	0x278(%rbx), %rax
movq	%rax, -0x58(%rbp)
movups	0x2c0(%rbx), %xmm0
movaps	%xmm0, -0xf0(%rbp)
movups	0x2b0(%rbx), %xmm0
movaps	%xmm0, -0x100(%rbp)
movups	0x2a0(%rbx), %xmm0
movaps	%xmm0, -0x110(%rbp)
movups	0x290(%rbx), %xmm0
movaps	%xmm0, -0x120(%rbp)
movups	0x280(%rbx), %xmm0
movaps	%xmm0, -0x130(%rbp)
movl	0x338(%rbx), %eax
movl	%eax, -0x70(%rbp)
movups	0x328(%rbx), %xmm0
movaps	%xmm0, -0x80(%rbp)
movsd	0x310(%rbx), %xmm0
movsd	%xmm0, -0x50(%rbp)
movsd	0x344(%rbx), %xmm0
movaps	%xmm0, -0xe0(%rbp)
movzbl	0x34a(%rbx), %eax
movb	%al, -0x29(%rbp)
movzbl	0x34c(%rbx), %eax
movb	%al, -0x2a(%rbp)
movsd	0x33c(%rbx), %xmm0
movaps	%xmm0, -0x90(%rbp)
movsd	0x320(%rbx), %xmm0
movaps	%xmm0, -0xb0(%rbp)
movq	0x2d8(%rbx), %rax
movq	%rax, -0x48(%rbp)
movups	0x2e0(%rbx), %xmm0
movaps	%xmm0, -0xa0(%rbp)
movq	0x318(%rbx), %rax
movq	%rax, -0x40(%rbp)
movzbl	0x350(%rbx), %eax
movb	%al, -0x2d(%rbp)
movzbl	0x34d(%rbx), %eax
movb	%al, -0x2c(%rbp)
movzbl	0x34e(%rbx), %eax
movb	%al, -0x2b(%rbp)
movq	0x218(%rbx), %rax
movq	%rax, -0x68(%rbp)
movq	0x248(%rbx), %r15
movb	$0x1, 0x34a(%rbx)
cmpb	$0x54, %r14b
jne	<addr> <L+0x3f7>
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x208>
movq	%rbx, %rdi
movl	$0x12, %esi
movl	$0x8, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0x208>
cmpb	$0x7, -0x34(%rbp)
ja	<addr> <L+0x3eb>
cmpb	$0x2e, 0x351(%rbx)
jne	<addr> <L+0x3eb>
leaq	0x280(%rbx), %rax
leaq	0x328(%rbx), %rcx
movq	%r13, 0x2f0(%rbx)
movaps	-0xd0(%rbp), %xmm0
movups	%xmm0, 0x2f8(%rbx)
movaps	-0xc0(%rbp), %xmm0
movlps	%xmm0, 0x308(%rbx)
movb	%r14b, 0x351(%rbx)
movl	-0x38(%rbp), %edx
movl	%edx, 0x324(%rbx)
movq	-0x60(%rbp), %rdx
movq	%rdx, 0x270(%rbx)
movq	-0x58(%rbp), %rdx
movq	%rdx, 0x278(%rbx)
movaps	-0xf0(%rbp), %xmm0
movups	%xmm0, 0x40(%rax)
movaps	-0x130(%rbp), %xmm0
movaps	-0x120(%rbp), %xmm1
movaps	-0x110(%rbp), %xmm2
movaps	-0x100(%rbp), %xmm3
movups	%xmm3, 0x30(%rax)
movups	%xmm2, 0x20(%rax)
movups	%xmm1, 0x10(%rax)
movups	%xmm0, (%rax)
movl	-0x70(%rbp), %eax
movl	%eax, 0x10(%rcx)
movaps	-0x80(%rbp), %xmm0
movups	%xmm0, (%rcx)
movsd	-0x50(%rbp), %xmm0
movsd	%xmm0, 0x310(%rbx)
movzbl	-0x2a(%rbp), %eax
movb	%al, 0x34c(%rbx)
movaps	-0x90(%rbp), %xmm0
unpcklpd	-0xe0(%rbp), %xmm0      # xmm0 = xmm0[0],mem[0]
movups	%xmm0, 0x33c(%rbx)
movaps	-0xb0(%rbp), %xmm0
movss	%xmm0, 0x320(%rbx)
movq	-0x48(%rbp), %rax
movq	%rax, 0x2d8(%rbx)
movaps	-0xa0(%rbp), %xmm0
movups	%xmm0, 0x2e0(%rbx)
movq	-0x40(%rbp), %rax
movq	%rax, 0x318(%rbx)
movzbl	-0x2d(%rbp), %eax
movb	%al, 0x350(%rbx)
movzbl	-0x2c(%rbp), %eax
movb	%al, 0x34d(%rbx)
movzbl	-0x2b(%rbp), %eax
movb	%al, 0x34e(%rbx)
cmpq	0x248(%rbx), %r15
ja	<addr> <L+0x330>
movq	%r15, 0x248(%rbx)
movq	-0x68(%rbp), %rax
cmpq	0x218(%rbx), %rax
ja	<addr> <L+0x344>
movq	%rax, 0x218(%rbx)
movq	0x608(%rbx), %rax
movq	0x610(%rbx), %r15
movq	%r15, %r13
testq	%r15, %r15
je	<addr> <L+0x397>
xorl	%r13d, %r13d
cmpq	$0x1, %r15
je	<addr> <L+0x38d>
movq	%r15, %rcx
nopw	%cs:(%rax,%rax)
movq	%r13, %rdx
movq	%rcx, %rsi
shrq	%rsi
addq	%rsi, %r13
cmpl	%r12d, (%rax,%r13,4)
cmovaq	%rdx, %r13
subq	%rsi, %rcx
cmpq	$0x1, %rcx
ja	<addr> <L+0x370>
cmpl	%r12d, (%rax,%r13,4)
je	<addr> <L+0x3d9>
adcq	$0x0, %r13
leaq	0x600(%rbx), %rdi
cmpq	(%rdi), %r15
jne	<addr> <L+0x3af>
callq	<addr> <<alloc::raw_vec::RawVec<u32>>::grow_one>
movq	0x608(%rbx), %rax
leaq	(%rax,%r13,4), %r14
movq	%r15, %rdx
subq	%r13, %rdx
jbe	<addr> <L+0x3cc>
leaq	0x4(%r14), %rdi
shlq	$0x2, %rdx
movq	%r14, %rsi
callq	*<addr>(%rip)        # <data>
movl	%r12d, (%r14)
incq	%r15
movq	%r15, 0x610(%rbx)
addq	$0x108, %rsp            # imm = 0x108
popq	%rbx
popq	%r12
popq	%r13
popq	%r14
popq	%r15
popq	%rbp
retq
movzbl	-0x29(%rbp), %eax
movb	%al, 0x34a(%rbx)
jmp	<addr> <L+0x3d9>
leaq	0x208(%rbx), %rdi
movl	$0x54, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
leaq	0x208(%rbx), %rdi
cmpb	$-0x1, %al
jne	<addr> <L+0x208>
jmp	<addr> <L+0x1d2>

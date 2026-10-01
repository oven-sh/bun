# <bun_js_parser::p::P<true, false>>::try_skip_type_script_type_arguments_with_backtracking
# = <bun_js_parser::p::P<true, true>>::try_skip_type_script_type_arguments_with_backtracking
# size 958 instructions 190
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%r13
pushq	%r12
pushq	%rbx
subq	$0x118, %rsp            # imm = 0x118
movq	%rdi, %rbx
movups	0x2f0(%rdi), %xmm1
movq	0x300(%rdi), %r12
movsd	0x308(%rdi), %xmm2
movzbl	0x351(%rdi), %r13d
movl	0x324(%rdi), %esi
movq	0x270(%rdi), %rdi
movq	0x278(%rbx), %r8
movups	0x2c0(%rbx), %xmm0
movaps	%xmm0, -0x100(%rbp)
movups	0x2b0(%rbx), %xmm0
movaps	%xmm0, -0x110(%rbp)
movups	0x2a0(%rbx), %xmm0
movaps	%xmm0, -0x120(%rbp)
movups	0x290(%rbx), %xmm0
movaps	%xmm0, -0x130(%rbp)
movups	0x280(%rbx), %xmm0
movaps	%xmm0, -0x140(%rbp)
movl	0x338(%rbx), %eax
movl	%eax, -0x80(%rbp)
movups	0x328(%rbx), %xmm0
movaps	%xmm0, -0x90(%rbp)
movsd	0x310(%rbx), %xmm3
movsd	0x344(%rbx), %xmm0
movzbl	0x34a(%rbx), %eax
movb	%al, -0x2d(%rbp)
movzbl	0x34c(%rbx), %eax
movb	%al, -0x2c(%rbp)
movsd	0x33c(%rbx), %xmm4
movsd	0x320(%rbx), %xmm5
movq	0x2d8(%rbx), %r9
movups	0x2e0(%rbx), %xmm6
movq	0x318(%rbx), %r10
movzbl	0x350(%rbx), %r11d
movzbl	0x34d(%rbx), %r15d
movzbl	0x34e(%rbx), %eax
movq	0x218(%rbx), %rcx
movq	0x248(%rbx), %rdx
movb	$0x1, 0x34a(%rbx)
movb	$0x1, %r14b
cmpq	$0x3e, %r13
ja	<addr> <L+0x34e>
movb	%al, -0x2b(%rbp)
movabsq	$<addr>, %rax # imm = <addr>
btq	%r13, %rax
jae	<addr> <L+0x34e>
movb	%r15b, -0x29(%rbp)
movb	%r11b, -0x2a(%rbp)
movq	%r10, -0x40(%rbp)
movaps	%xmm6, -0xa0(%rbp)
movq	%r9, -0x48(%rbp)
movaps	%xmm5, -0xb0(%rbp)
movaps	%xmm4, -0xc0(%rbp)
movsd	%xmm3, -0x50(%rbp)
movq	%r8, -0x58(%rbp)
movq	%rdi, -0x60(%rbp)
movl	%esi, -0x34(%rbp)
movaps	%xmm0, -0xd0(%rbp)
movaps	%xmm2, -0xe0(%rbp)
movq	%rdx, -0x68(%rbp)
movaps	%xmm1, -0xf0(%rbp)
movq	%rcx, -0x70(%rbp)
leaq	0x208(%rbx), %r15
movq	%r15, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expect_less_than::<false>>
cmpb	$-0x1, %al
jne	<addr> <L+0x208>
movq	%rbx, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0x208>
movzbl	0x351(%rbx), %eax
cmpl	$0x16, %eax
jne	<addr> <L+0x1ce>
movq	%r15, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x1a4>
jmp	<addr> <L+0x208>
cmpl	$0x1f, %eax
jne	<addr> <L+0x3a4>
movq	%r15, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x208>
movzbl	0x351(%rbx), %eax
cmpq	$0x3d, %rax
ja	<addr> <L+0x37d>
movabsq	$<addr>, %rcx # imm = 0x3000104F80000000
btq	%rax, %rcx
jae	<addr> <L+0x36d>
leaq	0x280(%rbx), %rax
leaq	0x328(%rbx), %rcx
movaps	-0xf0(%rbp), %xmm0
movups	%xmm0, 0x2f0(%rbx)
movq	%r12, 0x300(%rbx)
movaps	-0xe0(%rbp), %xmm0
movlps	%xmm0, 0x308(%rbx)
movb	%r13b, 0x351(%rbx)
movl	-0x34(%rbp), %edx
movl	%edx, 0x324(%rbx)
movq	-0x60(%rbp), %rdx
movq	%rdx, 0x270(%rbx)
movq	-0x58(%rbp), %rdx
movq	%rdx, 0x278(%rbx)
movaps	-0x100(%rbp), %xmm0
movups	%xmm0, 0x40(%rax)
movaps	-0x140(%rbp), %xmm0
movaps	-0x130(%rbp), %xmm1
movaps	-0x120(%rbp), %xmm2
movaps	-0x110(%rbp), %xmm3
movups	%xmm3, 0x30(%rax)
movups	%xmm2, 0x20(%rax)
movups	%xmm1, 0x10(%rax)
movups	%xmm0, (%rax)
movl	-0x80(%rbp), %eax
movl	%eax, 0x10(%rcx)
movaps	-0x90(%rbp), %xmm0
movups	%xmm0, (%rcx)
movsd	-0x50(%rbp), %xmm0
movsd	%xmm0, 0x310(%rbx)
movzbl	-0x2c(%rbp), %eax
movb	%al, 0x34c(%rbx)
movaps	-0xc0(%rbp), %xmm0
unpcklpd	-0xd0(%rbp), %xmm0      # xmm0 = xmm0[0],mem[0]
movups	%xmm0, 0x33c(%rbx)
movaps	-0xb0(%rbp), %xmm0
movss	%xmm0, 0x320(%rbx)
movq	-0x48(%rbp), %rax
movq	%rax, 0x2d8(%rbx)
movaps	-0xa0(%rbp), %xmm0
movups	%xmm0, 0x2e0(%rbx)
movq	-0x40(%rbp), %rax
movq	%rax, 0x318(%rbx)
movzbl	-0x2a(%rbp), %eax
movb	%al, 0x350(%rbx)
movzbl	-0x29(%rbp), %eax
movb	%al, 0x34d(%rbx)
movzbl	-0x2b(%rbp), %eax
movb	%al, 0x34e(%rbx)
movq	-0x68(%rbp), %rax
cmpq	0x248(%rbx), %rax
ja	<addr> <L+0x337>
movq	%rax, 0x248(%rbx)
movq	-0x70(%rbp), %rax
cmpq	0x218(%rbx), %rax
ja	<addr> <L+0x34b>
movq	%rax, 0x218(%rbx)
xorl	%r14d, %r14d
movzbl	-0x2d(%rbp), %eax
movb	%al, 0x34a(%rbx)
movl	%r14d, %eax
addq	$0x118, %rsp            # imm = 0x118
popq	%rbx
popq	%r12
popq	%r13
popq	%r14
popq	%r15
popq	%rbp
retq
movabsq	$<addr>, %rcx    # imm = <addr>
btq	%rax, %rcx
jb	<addr> <L+0x34e>
cmpb	$0x0, 0x344(%rbx)
jne	<addr> <L+0x34e>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::p::P<true, false>>::is_binary_operator>
testb	%al, %al
jne	<addr> <L+0x34e>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::p::P<true, false>>::is_start_of_expression>
testb	%al, %al
jne	<addr> <L+0x208>
jmp	<addr> <L+0x34e>
movq	%r15, %rdi
movl	$0x1f, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
jne	<addr> <L+0x208>
jmp	<addr> <L+0x1d7>

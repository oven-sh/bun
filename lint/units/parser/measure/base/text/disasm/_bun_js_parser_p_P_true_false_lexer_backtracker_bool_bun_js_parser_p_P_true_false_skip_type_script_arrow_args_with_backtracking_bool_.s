# <bun_js_parser::p::P<true, false>>::lexer_backtracker_bool::<<bun_js_parser::p::P<true, false>>::skip_type_script_arrow_args_with_backtracking, bool>
# = <bun_js_parser::p::P<true, true>>::lexer_backtracker_bool::<<bun_js_parser::p::P<true, true>>::skip_type_script_arrow_args_with_backtracking, bool>
# size 781 instructions 146
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%r13
pushq	%r12
pushq	%rbx
subq	$0x108, %rsp            # imm = 0x108
movq	%rdi, %rbx
movups	0x2f0(%rdi), %xmm0
movaps	%xmm0, -0xd0(%rbp)
movq	0x300(%rdi), %rax
movq	%rax, -0x60(%rbp)
movsd	0x308(%rdi), %xmm0
movaps	%xmm0, -0xc0(%rbp)
movzbl	0x351(%rdi), %r15d
movl	0x324(%rdi), %eax
movl	%eax, -0x30(%rbp)
movq	0x270(%rdi), %rax
movq	%rax, -0x58(%rbp)
movq	0x278(%rdi), %rax
movq	%rax, -0x50(%rbp)
movups	0x2c0(%rdi), %xmm0
movaps	%xmm0, -0xf0(%rbp)
movups	0x2b0(%rdi), %xmm0
movaps	%xmm0, -0x100(%rbp)
movups	0x2a0(%rdi), %xmm0
movaps	%xmm0, -0x110(%rbp)
movups	0x290(%rdi), %xmm0
movaps	%xmm0, -0x120(%rbp)
movups	0x280(%rdi), %xmm0
movaps	%xmm0, -0x130(%rbp)
movl	0x338(%rdi), %eax
movl	%eax, -0x70(%rbp)
movups	0x328(%rdi), %xmm0
movaps	%xmm0, -0x80(%rbp)
movsd	0x310(%rdi), %xmm0
movsd	%xmm0, -0x48(%rbp)
movsd	0x344(%rdi), %xmm0
movaps	%xmm0, -0xe0(%rbp)
movzbl	0x34a(%rdi), %eax
movb	%al, -0x2c(%rbp)
movzbl	0x34c(%rdi), %r14d
movsd	0x33c(%rdi), %xmm0
movaps	%xmm0, -0x90(%rbp)
movsd	0x320(%rdi), %xmm0
movaps	%xmm0, -0xb0(%rbp)
movq	0x2d8(%rdi), %rax
movq	%rax, -0x40(%rbp)
movups	0x2e0(%rdi), %xmm0
movaps	%xmm0, -0xa0(%rbp)
movq	0x318(%rdi), %rax
movq	%rax, -0x38(%rbp)
movzbl	0x350(%rdi), %eax
movb	%al, -0x2b(%rbp)
movzbl	0x34d(%rdi), %eax
movb	%al, -0x2a(%rbp)
movzbl	0x34e(%rdi), %eax
movb	%al, -0x29(%rbp)
movq	0x218(%rdi), %r12
movq	0x248(%rdi), %r13
movb	$0x1, 0x34a(%rdi)
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_typescript_fn_args>
cmpb	$-0x1, %al
jne	<addr> <L+0x18d>
leaq	0x208(%rbx), %rdi
cmpb	$0x1b, 0x351(%rbx)
jne	<addr> <L+0x2e8>
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x2e4>
leaq	0x280(%rbx), %rax
leaq	0x328(%rbx), %rcx
movaps	-0xd0(%rbp), %xmm0
movups	%xmm0, 0x2f0(%rbx)
movq	-0x60(%rbp), %rdx
movq	%rdx, 0x300(%rbx)
movaps	-0xc0(%rbp), %xmm0
movlps	%xmm0, 0x308(%rbx)
movb	%r15b, 0x351(%rbx)
movl	-0x30(%rbp), %edx
movl	%edx, 0x324(%rbx)
movq	-0x58(%rbp), %rdx
movq	%rdx, 0x270(%rbx)
movq	-0x50(%rbp), %rdx
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
movsd	-0x48(%rbp), %xmm0
movsd	%xmm0, 0x310(%rbx)
movb	%r14b, 0x34c(%rbx)
movaps	-0x90(%rbp), %xmm0
unpcklpd	-0xe0(%rbp), %xmm0      # xmm0 = xmm0[0],mem[0]
movups	%xmm0, 0x33c(%rbx)
movaps	-0xb0(%rbp), %xmm0
movss	%xmm0, 0x320(%rbx)
movq	-0x40(%rbp), %rax
movq	%rax, 0x2d8(%rbx)
movaps	-0xa0(%rbp), %xmm0
movups	%xmm0, 0x2e0(%rbx)
movq	-0x38(%rbp), %rax
movq	%rax, 0x318(%rbx)
movzbl	-0x2b(%rbp), %eax
movb	%al, 0x350(%rbx)
movzbl	-0x2a(%rbp), %eax
movb	%al, 0x34d(%rbx)
movzbl	-0x29(%rbp), %eax
movb	%al, 0x34e(%rbx)
cmpq	0x248(%rbx), %r13
ja	<addr> <L+0x2b6>
movq	%r13, 0x248(%rbx)
cmpq	0x218(%rbx), %r12
ja	<addr> <L+0x2c6>
movq	%r12, 0x218(%rbx)
xorl	%eax, %eax
movzbl	-0x2c(%rbp), %ecx
movb	%cl, 0x34a(%rbx)
addq	$0x108, %rsp            # imm = 0x108
popq	%rbx
popq	%r12
popq	%r13
popq	%r14
popq	%r15
popq	%rbp
retq
movb	$0x1, %al
jmp	<addr> <L+0x2c8>
leaq	0x208(%rbx), %rdi
movl	$0x1b, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
leaq	0x208(%rbx), %rdi
cmpb	$-0x1, %al
jne	<addr> <L+0x18d>
jmp	<addr> <L+0x180>

# <bun_js_parser::p::P<true, false>>::skip_type_script_type_parameters
# = <bun_js_parser::p::P<true, true>>::skip_type_script_type_parameters
# size 1674 instructions 415
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%r13
pushq	%r12
pushq	%rbx
subq	$0x58, %rsp
cmpb	$0x23, 0x351(%rdi)
jne	<addr> <L+0x64>
movl	%esi, %r13d
movq	%rdi, %r15
leaq	0x208(%rdi), %r14
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movb	$0x4, %bl
cmpb	$-0x1, %al
jne	<addr> <L+0x68>
cmpb	$0x4, %r13b
jb	<addr> <L+0x82>
cmpb	$0x1f, 0x351(%r15)
jne	<addr> <L+0x82>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
sete	%bl
movzbl	%al, %ecx
movl	$0x2, %eax
cmovnel	%ecx, %eax
negb	%bl
orb	$0x4, %bl
jmp	<addr> <L+0x68>
movb	$-0x1, %bl
xorl	%eax, %eax
movzbl	%al, %ecx
shll	$0x8, %ecx
movzbl	%bl, %eax
orl	%ecx, %eax
addq	$0x58, %rsp
popq	%rbx
popq	%r12
popq	%r13
popq	%r14
popq	%r15
popq	%rbp
retq
movb	$0x1, -0x29(%rbp)
movq	%r15, -0x48(%rbp)
movl	%r13d, -0x30(%rbp)
xorl	%ebx, %ebx
movl	$<addr>, %r14d      # imm = 0xFFFFFFFF
xorl	%ecx, %ecx
testb	$0x2, %r13b
jne	<addr> <L+0x2e8>
xorl	%r13d, %r13d
movl	%ecx, -0x38(%rbp)
movb	$0x1, %r8b
movzbl	0x351(%r15), %eax
cmpl	$0x4b, %eax
je	<addr> <L+0x1c6>
cmpl	$0x5b, %eax
leaq	0x208(%r15), %r12
je	<addr> <L+0x28e>
cmpb	$0x45, %al
jne	<addr> <L+0x4c9>
movq	0x268(%r15), %rdx
movq	0x2f0(%r15), %rdi
movq	0x2f8(%r15), %rsi
movq	%rsi, %rcx
subq	%rdi, %rcx
jb	<addr> <L+0x680>
cmpq	%rdx, %rsi
ja	<addr> <L+0x680>
movb	$0x45, %al
cmpq	$0x3, %rcx
jne	<addr> <L+0x4c2>
movq	0x260(%r15), %rcx
movzwl	(%rcx,%rdi), %edx
xorl	$0x756f, %edx           # imm = 0x756F
movzbl	0x2(%rcx,%rdi), %ecx
xorl	$0x74, %ecx
orw	%dx, %cx
jne	<addr> <L+0x4c2>
movq	%rdi, %rax
shrq	$0x1f, %rax
jne	<addr> <L+0x65e>
movq	%r14, %r15
movl	%ebx, %r14d
testl	%r13d, %r13d
setne	%bl
orb	-0x30(%rbp), %bl
testb	$0x1, %bl
movq	%rdi, %r12
cmovel	%edi, %r15d
movq	-0x48(%rbp), %rax
leaq	0x208(%rax), %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x628>
testb	$0x1, %bl
movl	$0x3, %eax
cmovel	%eax, %r13d
testl	%r13d, %r13d
setne	%al
notb	%r14b
movl	%r14d, %ecx
orb	%al, %cl
xorl	%r8d, %r8d
testb	$0x1, %cl
movb	$0x1, %bl
movq	%r15, %r14
movq	-0x48(%rbp), %r15
jne	<addr> <L+0xab>
movzbl	0x351(%r15), %eax
cmpl	$0x5b, %eax
je	<addr> <L+0x1b5>
movl	$0x0, %r13d
cmpl	$0x45, %eax
jne	<addr> <L+0xab>
movl	$0x3, %r13d
xorl	%r8d, %r8d
movl	%r12d, %r14d
jmp	<addr> <L+0xab>
testl	%r13d, %r13d
leaq	0x208(%r15), %r12
jne	<addr> <L+0x200>
movq	0x2f0(%r15), %r14
cmpq	$<addr>, %r14       # imm = 0x7FFFFFFF
ja	<addr> <L+0x65e>
movq	0x2f8(%r15), %r13
subq	%r14, %r13
cmpq	$<addr>, %r13       # imm = 0x7FFFFFFF
movl	$<addr>, %eax       # imm = 0x7FFFFFFF
cmovaeq	%rax, %r13
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x24a>
jmp	<addr> <L+0x628>
nopw	%cs:(%rax,%rax)
nopl	(%rax,%rax)
movq	0x2f8(%r15), %r13
subq	%r14, %r13
cmpq	$<addr>, %r13       # imm = 0x7FFFFFFF
movl	$<addr>, %eax       # imm = 0x7FFFFFFF
cmovaeq	%rax, %r13
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x628>
movzbl	0x351(%r15), %eax
cmpl	$0x4b, %eax
jne	<addr> <L+0x271>
testl	%r13d, %r13d
jne	<addr> <L+0x23a>
movq	0x2f0(%r15), %r14
testq	$-<addr>, %r14      # imm = <addr>
je	<addr> <L+0x220>
jmp	<addr> <L+0x65e>
cmpl	$0x5b, %eax
je	<addr> <L+0x28a>
movb	$0x2, -0x29(%rbp)
movb	$0x1, %r8b
cmpb	$0x45, %al
je	<addr> <L+0xd4>
jmp	<addr> <L+0x4c9>
movb	$0x2, -0x29(%rbp)
testl	%r13d, %r13d
jne	<addr> <L+0x2d1>
movl	-0x38(%rbp), %eax
orb	%bl, %al
sete	%al
xorl	%r13d, %r13d
testb	%al, -0x30(%rbp)
jne	<addr> <L+0x2d1>
movq	0x2f0(%r15), %r14
testq	$-<addr>, %r14      # imm = <addr>
jne	<addr> <L+0x65e>
movq	0x2f8(%r15), %r13
subq	%r14, %r13
cmpq	$<addr>, %r13       # imm = 0x7FFFFFFF
movl	$<addr>, %eax       # imm = 0x7FFFFFFF
cmovaeq	%rax, %r13
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movb	$0x1, %cl
cmpb	$-0x1, %al
je	<addr> <L+0xa5>
jmp	<addr> <L+0x628>
xorl	%r13d, %r13d
movl	%ecx, -0x40(%rbp)
movb	$0x1, %r8b
movzbl	0x351(%r15), %eax
cmpl	$0x4b, %eax
je	<addr> <L+0x40a>
cmpl	$0x5b, %eax
leaq	0x208(%r15), %r12
je	<addr> <L+0x468>
cmpb	$0x45, %al
jne	<addr> <L+0x4c9>
movq	0x268(%r15), %rdx
movq	0x2f0(%r15), %rdi
movq	0x2f8(%r15), %rsi
movq	%rsi, %rcx
subq	%rdi, %rcx
jb	<addr> <L+0x680>
cmpq	%rdx, %rsi
ja	<addr> <L+0x680>
movb	$0x45, %al
cmpq	$0x3, %rcx
jne	<addr> <L+0x4c2>
movq	0x260(%r15), %rcx
movzwl	(%rcx,%rdi), %edx
xorl	$0x756f, %edx           # imm = 0x756F
movzbl	0x2(%rcx,%rdi), %ecx
xorl	$0x74, %ecx
orw	%dx, %cx
jne	<addr> <L+0x4c2>
cmpq	$<addr>, %rdi       # imm = 0x7FFFFFFF
ja	<addr> <L+0x65e>
movq	%r13, %r12
movl	%ebx, %r13d
testl	%r12d, %r12d
setne	%bl
orb	-0x30(%rbp), %bl
testb	$0x1, %bl
movq	%rdi, -0x38(%rbp)
cmovel	%edi, %r14d
movq	-0x48(%rbp), %r15
leaq	0x208(%r15), %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x628>
testb	$0x1, %bl
movl	$0x3, %eax
cmovel	%eax, %r12d
testl	%r12d, %r12d
setne	%al
notb	%r13b
movl	%r13d, %ecx
orb	%al, %cl
xorl	%r8d, %r8d
testb	$0x1, %cl
movb	$0x1, %bl
movq	%r12, %r13
jne	<addr> <L+0x2f1>
movzbl	0x351(%r15), %eax
cmpl	$0x5b, %eax
je	<addr> <L+0x3f8>
movl	$0x0, %r13d
cmpl	$0x45, %eax
jne	<addr> <L+0x2f1>
movl	$0x3, %r13d
xorl	%r8d, %r8d
movq	-0x38(%rbp), %r14
jmp	<addr> <L+0x2f1>
leaq	0x208(%r15), %r12
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x628>
nopw	%cs:(%rax,%rax)
nopl	(%rax,%rax)
movzbl	0x351(%r15), %eax
cmpl	$0x4b, %eax
jne	<addr> <L+0x44e>
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x430>
jmp	<addr> <L+0x628>
cmpl	$0x5b, %eax
je	<addr> <L+0x464>
movb	$0x2, -0x29(%rbp)
movb	$0x1, %r8b
cmpb	$0x45, %al
je	<addr> <L+0x31a>
jmp	<addr> <L+0x4c9>
movb	$0x2, -0x29(%rbp)
testl	%r13d, %r13d
jne	<addr> <L+0x4ab>
movl	-0x40(%rbp), %eax
orb	%bl, %al
sete	%al
xorl	%r13d, %r13d
testb	%al, -0x30(%rbp)
jne	<addr> <L+0x4ab>
movq	0x2f0(%r15), %r14
cmpq	$<addr>, %r14       # imm = 0x7FFFFFFF
ja	<addr> <L+0x65e>
movq	0x2f8(%r15), %r13
subq	%r14, %r13
cmpq	$<addr>, %r13       # imm = 0x7FFFFFFF
movl	$<addr>, %eax       # imm = 0x7FFFFFFF
cmovaeq	%rax, %r13
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movb	$0x1, %cl
cmpb	$-0x1, %al
je	<addr> <L+0x2eb>
jmp	<addr> <L+0x628>
leaq	0x208(%r15), %r12
testl	%r13d, %r13d
jg	<addr> <L+0x59a>
cmpb	$0x45, %al
sete	%cl
orb	%cl, %r8b
testb	$0x1, %r8b
movb	$0x4, %bl
movl	-0x30(%rbp), %r13d
je	<addr> <L+0x503>
movq	%r12, %rdi
movl	$0x45, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expect>
cmpb	$-0x1, %al
jne	<addr> <L+0x68>
movzbl	0x351(%r15), %eax
cmpb	$0x54, %al
jne	<addr> <L+0x539>
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x68>
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
movl	%eax, %ecx
cmpb	$-0x1, %al
jne	<addr> <L+0x62f>
movzbl	0x351(%r15), %eax
movb	$0x2, -0x29(%rbp)
cmpb	$0x3b, %al
jne	<addr> <L+0x56f>
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x68>
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
movl	%eax, %ecx
cmpb	$-0x1, %al
jne	<addr> <L+0x62f>
movzbl	0x351(%r15), %eax
movb	$0x2, -0x29(%rbp)
cmpb	$0x16, %al
jne	<addr> <L+0x638>
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x68>
cmpb	$0x1f, 0x351(%r15)
jne	<addr> <L+0x8e>
jmp	<addr> <L+0x63f>
movq	0x9c0(%r15), %rax
movq	%rax, -0x40(%rbp)
movq	0x9d0(%r15), %r12
movl	%r8d, -0x38(%rbp)
movq	%r12, %rdi
movl	%r14d, %esi
movl	%r13d, %edx
callq	<addr> <<bun_ast::Source>::text_for_range>
movq	%rax, -0x70(%rbp)
movq	%rdx, -0x68(%rbp)
leaq	-0x70(%rbp), %rax
movq	%rax, -0x80(%rbp)
movq	$<addr>, -0x78(%rbp) # imm = 0x251EA40
movl	$<addr>, %esi         # imm = 0x27787B
leaq	-0x60(%rbp), %rbx
movq	%rbx, %rdi
leaq	-0x80(%rbp), %rdx
callq	<addr> <bun_ast::alloc_print>
subq	$0x8, %rsp
movq	-0x40(%rbp), %rdi
xorl	%esi, %esi
movq	%r12, %rdx
leaq	0x208(%r15), %r12
movl	%r14d, %ecx
movl	%r13d, %r8d
movq	%rbx, %r9
pushq	$0x0
pushq	$0x0
pushq	$0x8
callq	<addr> <<bun_ast::Log>::add_formatted_msg>
movl	-0x38(%rbp), %r8d
addq	$0x20, %rsp
movzbl	0x351(%r15), %eax
jmp	<addr> <L+0x4d2>
movb	$0x4, %bl
jmp	<addr> <L+0x68>
movl	%edx, %eax
movl	%ecx, %ebx
jmp	<addr> <L+0x68>
movzbl	-0x29(%rbp), %r14d
jmp	<addr> <L+0x642>
movb	$0x2, %r14b
movq	%r12, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expect_greater_than::<false>>
cmpb	$-0x1, %al
sete	%bl
movzbl	%r14b, %ecx
movzbl	%al, %eax
cmovel	%ecx, %eax
jmp	<addr> <L+0x5d>
movb	$0x2, -0x60(%rbp)
leaq	-0x60(%rbp), %rdx
movl	$<addr>, %edi         # imm = 0x319F90
movl	$0x8, %esi
movl	$<addr>, %ecx         # imm = 0xF9C968
movl	$<addr>, %r8d         # imm = 0xF9C428
callq	<addr> <core::result::unwrap_failed>
movl	$<addr>, %ecx         # imm = 0xF9C428
callq	<addr> <core::slice::index::slice_index_fail>

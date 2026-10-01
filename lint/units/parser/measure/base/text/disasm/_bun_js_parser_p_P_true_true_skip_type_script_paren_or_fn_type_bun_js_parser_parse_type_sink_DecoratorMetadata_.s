# <bun_js_parser::p::P<true, true>>::skip_type_script_paren_or_fn_type::<bun_js_parser::parse::type_sink::DecoratorMetadata>
# size 349 instructions 102
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%r12
pushq	%rbx
subq	$0x30, %rsp
movq	%rsi, %rbx
movq	%rdi, %r15
callq	<addr> <<bun_js_parser::p::P<true, false>>::lexer_backtracker_bool::<<bun_js_parser::p::P<true, false>>::skip_type_script_arrow_args_with_backtracking, bool>>
testb	%al, %al
je	<addr> <L+0x5c>
movq	%r15, %rdi
xorl	%esi, %esi
movl	$0x1, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0x81>
movabsq	$-<addr>, %r14 # imm = <addr>
movq	(%rbx), %rax
cmpq	%r14, %rax
jl	<addr> <L+0x51>
testq	%rax, %rax
je	<addr> <L+0x51>
movq	0x8(%rbx), %rdi
callq	<addr> <mi_free>
addq	$-0xa, %r14
movq	%r14, (%rbx)
movb	$-0x1, %al
jmp	<addr> <L+0x81>
leaq	0x208(%r15), %r14
cmpb	$0x2a, 0x351(%r15)
jne	<addr> <L+0x12c>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x8e>
movl	%eax, %edx
movb	$0x4, %al
addq	$0x30, %rsp
popq	%rbx
popq	%r12
popq	%r14
popq	%r15
popq	%rbp
retq
movabsq	$-<addr>, %r12 # imm = <addr>
leaq	-0x11(%r12), %rax
movq	%rax, -0x38(%rbp)
leaq	-0x38(%rbp), %rcx
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, true>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::DecoratorMetadata>>
cmpb	$-0x1, %al
je	<addr> <L+0xd8>
movq	-0x38(%rbp), %rcx
cmpq	%r12, %rcx
jl	<addr> <L+0x81>
testq	%rcx, %rcx
je	<addr> <L+0x81>
movq	-0x30(%rbp), %rdi
movl	%edx, %ebx
movl	%eax, %r14d
callq	<addr> <mi_free>
movl	%r14d, %eax
movl	%ebx, %edx
jmp	<addr> <L+0x81>
movq	-0x28(%rbp), %rax
movq	%rax, -0x40(%rbp)
movups	-0x38(%rbp), %xmm0
movaps	%xmm0, -0x50(%rbp)
movq	(%rbx), %rax
cmpq	%r12, %rax
jl	<addr> <L+0xfe>
testq	%rax, %rax
je	<addr> <L+0xfe>
movq	0x8(%rbx), %rdi
callq	<addr> <mi_free>
movq	-0x40(%rbp), %rax
movq	%rax, 0x10(%rbx)
movaps	-0x50(%rbp), %xmm0
movups	%xmm0, (%rbx)
cmpb	$0x14, 0x351(%r15)
jne	<addr> <L+0x146>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x7d>
jmp	<addr> <L+0x58>
movq	%r14, %rdi
movl	$0x2a, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
jne	<addr> <L+0x7d>
jmp	<addr> <L+0x71>
movq	%r14, %rdi
movl	$0x14, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
jne	<addr> <L+0x7d>
jmp	<addr> <L+0x117>

# <bun_js_parser::p::P<true, false>>::skip_typescript_fn_args
# = <bun_js_parser::p::P<true, true>>::skip_typescript_fn_args
# size 273 instructions 80
pushq	%rbp
movq	%rsp, %rbp
pushq	%r14
pushq	%rbx
movq	%rdi, %r14
leaq	0x208(%rdi), %rbx
cmpb	$0x2a, 0x351(%rdi)
jne	<addr> <L+0xde>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0xf3>
movzbl	0x351(%r14), %eax
cmpl	$0x18, %eax
je	<addr> <L+0x50>
cmpl	$0x14, %eax
jne	<addr> <L+0x60>
jmp	<addr> <L+0xc8>
nopw	%cs:(%rax,%rax)
nop
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0xf3>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_binding>
cmpb	$-0x1, %al
jne	<addr> <L+0xf7>
movzbl	0x351(%r14), %eax
cmpb	$0x2e, %al
jne	<addr> <L+0x90>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0xf3>
movzbl	0x351(%r14), %eax
cmpb	$0x15, %al
jne	<addr> <L+0xb8>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0xf3>
movq	%r14, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0xf7>
movzbl	0x351(%r14), %eax
cmpb	$0x16, %al
je	<addr> <L+0x1e>
movzbl	%al, %eax
cmpl	$0x14, %eax
jne	<addr> <L+0xfc>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movl	%eax, %edx
cmpb	$-0x1, %dl
sete	%al
negb	%al
orb	$0x4, %al
jmp	<addr> <L+0xf7>
movq	%rbx, %rdi
movl	$0x2a, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
je	<addr> <L+0x1e>
movl	%eax, %edx
movb	$0x4, %al
popq	%rbx
popq	%r14
popq	%rbp
retq
movq	%rbx, %rdi
movl	$0x14, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
movl	%eax, %edx
cmpb	$-0x1, %al
jne	<addr> <L+0xd2>
jmp	<addr> <L+0xc8>

# <bun_js_parser::p::P<true, false>>::skip_type_script_type_arguments::<false, false>
# = <bun_js_parser::p::P<true, true>>::skip_type_script_type_arguments::<false, false>
# size 181 instructions 57
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%rbx
pushq	%rax
movzbl	0x351(%rdi), %ecx
xorl	%eax, %eax
movw	$0xff, %r15w
cmpq	$0x3e, %rcx
ja	<addr> <L+0x70>
movabsq	$<addr>, %rdx # imm = <addr>
btq	%rcx, %rdx
jae	<addr> <L+0x70>
movq	%rdi, %rbx
leaq	0x208(%rdi), %r14
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expect_less_than::<false>>
movw	$0x4, %r15w
cmpb	$-0x1, %al
jne	<addr> <L+0x70>
movq	%rbx, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
movl	%eax, %ecx
cmpb	$-0x1, %al
jne	<addr> <L+0x87>
cmpb	$0x16, 0x351(%rbx)
jne	<addr> <L+0x8f>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x49>
movzbl	%al, %ecx
shll	$0x8, %ecx
movzwl	%r15w, %eax
orl	%ecx, %eax
addq	$0x8, %rsp
popq	%rbx
popq	%r14
popq	%r15
popq	%rbp
retq
movl	%edx, %eax
movzbl	%cl, %r15d
jmp	<addr> <L+0x70>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expect_greater_than::<false>>
cmpb	$-0x1, %al
movzbl	%al, %ecx
movl	$0x1, %eax
cmovnel	%ecx, %eax
movl	$0xff, %ecx
movl	$0x4, %r15d
cmovel	%ecx, %r15d
jmp	<addr> <L+0x70>

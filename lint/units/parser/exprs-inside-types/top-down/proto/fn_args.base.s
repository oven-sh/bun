### <bun_js_parser::p::P<true, false>>::skip_typescript_fn_args
<bun_js_parser::p::P<true, false>>::skip_typescript_fn_args:
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%rbx
pushq	%rax
movq	%rdi, %r14
leaq	520(%rdi), %rbx
cmpb	$42, 849(%rdi)
jne	.LBB1110_1
.LBB1110_2:
movq	%rbx, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
cmpb	$-1, %al
je	.LBB1110_3
.LBB1110_19:
movl	%eax, %edx
movb	$4, %al
.LBB1110_16:
addq	$8, %rsp
popq	%rbx
popq	%r14
popq	%r15
popq	%rbp
retq
.LBB1110_3:
leaq	-25(%rbp), %r15
.LBB1110_4:
movzbl	849(%r14), %eax
cmpl	$24, %eax
je	.LBB1110_17
cmpl	$20, %eax
jne	.LBB1110_6
jmp	.LBB1110_13
.LBB1110_17:
movq	%rbx, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1110_19
.LBB1110_6:
movq	%r14, %rdi
callq	<bun_js_parser::p::P<true, false>>::skip_type_script_binding
cmpb	$-1, %al
jne	.LBB1110_16
movzbl	849(%r14), %eax
cmpb	$46, %al
jne	.LBB1110_10
movq	%rbx, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1110_19
movzbl	849(%r14), %eax
.LBB1110_10:
cmpb	$21, %al
jne	.LBB1110_11
movq	%rbx, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1110_19
movq	%r14, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
movq	%r15, %rcx
callq	<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>
cmpb	$-1, %al
jne	.LBB1110_16
movzbl	849(%r14), %eax
.LBB1110_11:
cmpb	$22, %al
jne	.LBB1110_12
movq	%rbx, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
cmpb	$-1, %al
je	.LBB1110_4
jmp	.LBB1110_19
.LBB1110_12:
cmpb	$20, %al
jne	.LBB1110_14
.LBB1110_13:
movq	%rbx, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
movl	%eax, %edx
.LBB1110_15:
cmpb	$-1, %dl
sete	%al
negb	%al
orb	$4, %al
jmp	.LBB1110_16
.LBB1110_1:
movq	%rbx, %rdi
movl	$42, %esi
callq	<bun_js_parser::lexer::Lexer>::expected
cmpb	$-1, %al
jne	.LBB1110_19
jmp	.LBB1110_2
.LBB1110_14:
movq	%rbx, %rdi
movl	$20, %esi
callq	<bun_js_parser::lexer::Lexer>::expected
movl	%eax, %edx
cmpb	$-1, %al
jne	.LBB1110_15
jmp	.LBB1110_13
.Lfunc_end1110:

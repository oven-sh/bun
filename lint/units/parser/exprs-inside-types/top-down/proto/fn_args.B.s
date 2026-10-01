### <bun_js_parser::p::P<true, false>>::skip_typescript_fn_args
<bun_js_parser::p::P<true, false>>::skip_typescript_fn_args:
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%r12
pushq	%rbx
subq	$16, %rsp
movq	%rdi, %r15
leaq	520(%rdi), %r14
cmpb	$42, 849(%rdi)
jne	.LBB1119_31
.LBB1119_1:
movq	%r14, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
movb	$4, %bl
cmpb	$-1, %al
je	.LBB1119_3
.LBB1119_2:
movl	%eax, %edx
jmp	.LBB1119_25
.LBB1119_3:
leaq	-33(%rbp), %r12
.LBB1119_4:
movzbl	849(%r15), %eax
cmpl	$24, %eax
je	.LBB1119_6
cmpl	$20, %eax
jne	.LBB1119_7
jmp	.LBB1119_24
.LBB1119_6:
movq	%r14, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1119_2
.LBB1119_7:
movq	%r15, %rdi
callq	<bun_js_parser::p::P<true, false>>::skip_type_script_binding
cmpb	$-1, %al
jne	.LBB1119_26
movzbl	849(%r15), %eax
cmpb	$46, %al
jne	.LBB1119_11
movq	%r14, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1119_2
movzbl	849(%r15), %eax
.LBB1119_11:
cmpb	$21, %al
jne	.LBB1119_15
movq	%r14, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1119_2
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
movq	%r12, %rcx
callq	<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>
cmpb	$-1, %al
jne	.LBB1119_26
movzbl	849(%r15), %eax
.LBB1119_15:
cmpb	$22, %al
jne	.LBB1119_17
.LBB1119_16:
movq	%r14, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
cmpb	$-1, %al
je	.LBB1119_4
jmp	.LBB1119_2
.LBB1119_17:
movzbl	%al, %eax
cmpl	$20, %eax
je	.LBB1119_24
movq	%r15, %rdi
movl	$1, %esi
callq	<bun_js_parser::p::P<true, false>>::skip_initializer_in_type
movzwl	%ax, %eax
movl	%eax, %edx
shrl	$8, %edx
cmpb	$-1, %al
jne	.LBB1119_33
movzbl	849(%r15), %eax
testb	$1, %dl
je	.LBB1119_21
cmpb	$22, %al
je	.LBB1119_16
.LBB1119_21:
cmpb	$20, %al
je	.LBB1119_24
movq	%r14, %rdi
movl	$20, %esi
callq	<bun_js_parser::lexer::Lexer>::expected
cmpb	$-1, %al
jne	.LBB1119_2
.LBB1119_24:
movq	%r14, %rdi
callq	<bun_js_parser::lexer::Lexer>::next
movl	%eax, %edx
cmpb	$-1, %al
sete	%bl
negb	%bl
orb	$4, %bl
.LBB1119_25:
movl	%ebx, %eax
addq	$16, %rsp
popq	%rbx
popq	%r12
popq	%r14
popq	%r15
popq	%rbp
retq
.LBB1119_26:
movl	%eax, %ebx
jmp	.LBB1119_25
.LBB1119_31:
movq	%r14, %rdi
movl	$42, %esi
callq	<bun_js_parser::lexer::Lexer>::expected
cmpb	$-1, %al
je	.LBB1119_1
movl	%eax, %edx
movb	$4, %bl
jmp	.LBB1119_25
.LBB1119_33:
movl	%eax, %ebx
jmp	.LBB1119_25
.Lfunc_end1119:

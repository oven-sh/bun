### <p::P<true, false>>::skip_type_script_object_type
<p::P<true, false>>::skip_type_script_object_type:
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%r13
pushq	%r12
pushq	%rbx
pushq	%rax
movq	%rdi, %r15
leaq	520(%rdi), %r14
cmpb	$40, 849(%rdi)
jne	.LBB1123_66
.LBB1123_1:
movq	%r14, %rdi
callq	<lexer::Lexer>::next
movb	$4, %bl
cmpb	$-1, %al
je	.LBB1123_2
.LBB1123_13:
movl	%eax, %edx
.LBB1123_65:
movl	%ebx, %eax
addq	$8, %rsp
popq	%rbx
popq	%r12
popq	%r13
popq	%r14
popq	%r15
popq	%rbp
retq
.LBB1123_2:
leaq	-41(%rbp), %r12
.LBB1123_3:
movzbl	849(%r15), %eax
cmpl	$38, %eax
je	.LBB1123_7
cmpl	$44, %eax
je	.LBB1123_7
cmpl	$1, %eax
jne	.LBB1123_9
jmp	.LBB1123_6
.LBB1123_7:
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
movzbl	849(%r15), %eax
.LBB1123_9:
cmpb	$69, %al
setae	%cl
leal	-5(%rax), %edx
cmpb	$2, %dl
setb	%dl
orb	%cl, %dl
cmpb	$1, %dl
jne	.LBB1123_14
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
.LBB1123_11:
movzbl	849(%r15), %eax
cmpb	$69, %al
setae	%cl
leal	-5(%rax), %edx
cmpb	$2, %dl
setb	%dl
orb	%cl, %dl
cmpb	$1, %dl
jne	.LBB1123_16
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
je	.LBB1123_11
jmp	.LBB1123_13
.LBB1123_14:
cmpb	$41, %al
je	.LBB1123_17
xorl	%r13d, %r13d
jmp	.LBB1123_43
.LBB1123_16:
cmpb	$41, %al
jne	.LBB1123_40
.LBB1123_17:
movq	752(%r15), %r13
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
movq	%r15, %rdi
xorl	%esi, %esi
movl	$2, %edx
movq	%r12, %rcx
callq	<p::P<true, false>>::skip_type_script_type_with_opts::<parse::type_sink::Discard>
cmpb	$-1, %al
jne	.LBB1123_71
.LBB1123_19:
movzbl	849(%r15), %eax
cmpl	$21, %eax
je	.LBB1123_28
cmpl	$91, %eax
jne	.LBB1123_31
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
movq	%r12, %rcx
callq	<p::P<true, false>>::skip_type_script_type_with_opts::<parse::type_sink::Discard>
cmpb	$-1, %al
jne	.LBB1123_72
movzbl	849(%r15), %eax
cmpb	$69, %al
jne	.LBB1123_34
movq	616(%r15), %rdx
movq	752(%r15), %rdi
movq	760(%r15), %rsi
movq	%rsi, %rax
subq	%rdi, %rax
jb	.LBB1123_70
cmpq	%rdx, %rsi
ja	.LBB1123_70
cmpq	$2, %rax
jne	.LBB1123_33
movq	608(%r15), %rax
cmpw	$29537, (%rax,%rdi)
jne	.LBB1123_33
.LBB1123_28:
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
movq	%r12, %rcx
callq	<p::P<true, false>>::skip_type_script_type_with_opts::<parse::type_sink::Discard>
cmpb	$-1, %al
je	.LBB1123_33
jmp	.LBB1123_72
.LBB1123_31:
cmpl	%r13d, 828(%r15)
setg	%cl
cmpb	$19, %al
jne	.LBB1123_62
testb	%cl, %cl
jne	.LBB1123_63
.LBB1123_33:
movzbl	849(%r15), %eax
.LBB1123_34:
cmpb	$19, %al
jne	.LBB1123_73
.LBB1123_35:
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
movzbl	849(%r15), %eax
cmpl	$44, %eax
je	.LBB1123_38
cmpl	$38, %eax
jne	.LBB1123_40
.LBB1123_38:
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
movzbl	849(%r15), %eax
.LBB1123_40:
movb	$1, %r13b
cmpb	$46, %al
je	.LBB1123_42
movzbl	%al, %eax
cmpl	$28, %eax
jne	.LBB1123_43
.LBB1123_42:
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
.LBB1123_43:
movq	%r15, %rdi
movl	$2, %esi
callq	<p::P<true, false>>::skip_type_script_type_parameters
cmpb	$-1, %al
jne	.LBB1123_64
movzbl	849(%r15), %eax
cmpl	$21, %eax
je	.LBB1123_50
cmpl	$42, %eax
jne	.LBB1123_55
movq	%r15, %rdi
callq	<p::P<true, false>>::skip_typescript_fn_args
cmpb	$-1, %al
jne	.LBB1123_72
movzbl	849(%r15), %eax
cmpb	$21, %al
jne	.LBB1123_56
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
movq	%r15, %rdi
xorl	%esi, %esi
movl	$1, %edx
jmp	.LBB1123_53
.LBB1123_50:
testb	%r13b, %r13b
je	.LBB1123_60
.LBB1123_51:
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
jne	.LBB1123_13
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
.LBB1123_53:
movq	%r12, %rcx
callq	<p::P<true, false>>::skip_type_script_type_with_opts::<parse::type_sink::Discard>
cmpb	$-1, %al
jne	.LBB1123_72
movzbl	849(%r15), %eax
jmp	.LBB1123_56
.LBB1123_55:
testb	%r13b, %r13b
je	.LBB1123_69
.LBB1123_56:
cmpb	$1, %al
je	.LBB1123_3
movzbl	%al, %eax
cmpl	$22, %eax
je	.LBB1123_59
cmpl	$49, %eax
jne	.LBB1123_68
.LBB1123_59:
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
je	.LBB1123_3
jmp	.LBB1123_13
.LBB1123_68:
cmpb	$0, 836(%r15)
jne	.LBB1123_3
jmp	.LBB1123_69
.LBB1123_60:
movq	%r14, %rdi
movl	$69, %esi
callq	<lexer::Lexer>::expected
cmpb	$-1, %al
jne	.LBB1123_13
movq	%r14, %rdi
callq	<lexer::Lexer>::next
cmpb	$-1, %al
je	.LBB1123_51
jmp	.LBB1123_13
.LBB1123_71:
movzbl	%al, %eax
movzbl	%dl, %ecx
movq	%r15, %rdi
movq	%r13, %rsi
movl	%eax, %edx
callq	<p::P<true, false>>::retry_computed_name_as_expr
cmpb	$-1, %al
je	.LBB1123_19
jmp	.LBB1123_72
.LBB1123_73:
movq	%r14, %rdi
movl	$19, %esi
callq	<lexer::Lexer>::expected
cmpb	$-1, %al
je	.LBB1123_35
jmp	.LBB1123_13
.LBB1123_62:
movb	$1, %cl
testb	%cl, %cl
je	.LBB1123_33
.LBB1123_63:
movq	%r15, %rdi
movq	%r13, %rsi
movl	$255, %edx
callq	<p::P<true, false>>::retry_computed_name_as_expr
cmpb	$-1, %al
je	.LBB1123_33
.LBB1123_72:
movl	%eax, %ebx
jmp	.LBB1123_65
.LBB1123_64:
movl	%eax, %edx
shrl	$8, %edx
movl	%eax, %ebx
jmp	.LBB1123_65
.LBB1123_6:
movq	%r14, %rdi
movl	$1, %esi
callq	<lexer::Lexer>::expect
movl	%eax, %edx
cmpb	$-1, %al
sete	%bl
negb	%bl
orb	$4, %bl
jmp	.LBB1123_65
.LBB1123_66:
movq	%r14, %rdi
movl	$40, %esi
callq	<lexer::Lexer>::expected
cmpb	$-1, %al
je	.LBB1123_1
movl	%eax, %edx
movb	$4, %bl
jmp	.LBB1123_65
.LBB1123_69:
movq	%r14, %rdi
callq	<lexer::Lexer>::unexpected
xorl	%ebx, %ebx
jmp	.LBB1123_65
.LBB1123_70:
movl	$.Lalloc_11e2992a5b9c8f277d4a00890b54e14e, %ecx
callq	core::slice::index::slice_index_fail
.Lfunc_end1123:

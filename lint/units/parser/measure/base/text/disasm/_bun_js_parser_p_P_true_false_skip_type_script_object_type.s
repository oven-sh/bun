# <bun_js_parser::p::P<true, false>>::skip_type_script_object_type
# = <bun_js_parser::p::P<true, true>>::skip_type_script_object_type
# size 949 instructions 249
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%r12
pushq	%rbx
movq	%rdi, %r15
leaq	0x208(%rdi), %r14
cmpb	$0x28, 0x351(%rdi)
jne	<addr> <L+0x37e>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movb	$0x4, %bl
cmpb	$-0x1, %al
je	<addr> <L+0x4c>
movl	%eax, %edx
movl	%ebx, %eax
popq	%rbx
popq	%r12
popq	%r14
popq	%r15
popq	%rbp
retq
nopl	(%rax)
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movzbl	0x351(%r15), %eax
cmpl	$0x26, %eax
je	<addr> <L+0x70>
cmpl	$0x2c, %eax
je	<addr> <L+0x70>
cmpl	$0x1, %eax
jne	<addr> <L+0x84>
jmp	<addr> <L+0x360>
nopl	(%rax,%rax)
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movzbl	0x351(%r15), %eax
cmpb	$0x45, %al
setb	%cl
leal	-0x5(%rax), %edx
cmpb	$0x2, %dl
setae	%dl
testb	%dl, %cl
jne	<addr> <L+0xd0>
nopw	%cs:(%rax,%rax)
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movzbl	0x351(%r15), %eax
cmpb	$0x45, %al
setb	%cl
leal	-0x5(%rax), %edx
cmpb	$0x2, %dl
setae	%dl
testb	%dl, %cl
je	<addr> <L+0xa0>
cmpb	$0x29, %al
je	<addr> <L+0xd8>
jmp	<addr> <L+0x1f2>
nop
cmpb	$0x29, %al
jne	<addr> <L+0x220>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movq	%r15, %rdi
xorl	%esi, %esi
movl	$0x2, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0x34d>
movzbl	0x351(%r15), %eax
cmpl	$0x15, %eax
je	<addr> <L+0x184>
cmpl	$0x5b, %eax
jne	<addr> <L+0x1a8>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0x34d>
movzbl	0x351(%r15), %eax
cmpb	$0x45, %al
jne	<addr> <L+0x1b0>
movq	0x268(%r15), %rdx
movq	0x2f0(%r15), %rdi
movq	0x2f8(%r15), %rsi
movq	%rsi, %rax
subq	%rdi, %rax
jb	<addr> <L+0x3ab>
cmpq	%rdx, %rsi
ja	<addr> <L+0x3ab>
cmpq	$0x2, %rax
jne	<addr> <L+0x1a8>
movq	0x260(%r15), %rax
cmpw	$0x7361, (%rax,%rdi)    # imm = 0x7361
jne	<addr> <L+0x1a8>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0x34d>
movzbl	0x351(%r15), %eax
cmpb	$0x13, %al
jne	<addr> <L+0x333>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movzbl	0x351(%r15), %eax
cmpl	$0x2c, %eax
je	<addr> <L+0x1da>
cmpl	$0x26, %eax
jne	<addr> <L+0x1f2>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movzbl	0x351(%r15), %eax
movb	$0x1, %r12b
cmpb	$0x2e, %al
je	<addr> <L+0x201>
movzbl	%al, %eax
cmpl	$0x1c, %eax
jne	<addr> <L+0x223>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x223>
jmp	<addr> <L+0x30>
nopw	%cs:(%rax,%rax)
nopl	(%rax)
xorl	%r12d, %r12d
movq	%r15, %rdi
movl	$0x2, %esi
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_parameters>
cmpb	$-0x1, %al
jne	<addr> <L+0x354>
movzbl	0x351(%r15), %eax
cmpl	$0x15, %eax
je	<addr> <L+0x290>
cmpl	$0x2a, %eax
jne	<addr> <L+0x2d0>
movq	%r15, %rdi
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_typescript_fn_args>
cmpb	$-0x1, %al
jne	<addr> <L+0x34d>
movzbl	0x351(%r15), %eax
cmpb	$0x15, %al
jne	<addr> <L+0x2d9>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movq	%r15, %rdi
xorl	%esi, %esi
movl	$0x1, %edx
jmp	<addr> <L+0x2ac>
nopw	%cs:(%rax,%rax)
testb	%r12b, %r12b
je	<addr> <L+0x309>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movq	%r15, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0x34d>
movzbl	0x351(%r15), %eax
jmp	<addr> <L+0x2d9>
nopw	%cs:(%rax,%rax)
nopl	(%rax)
testb	%r12b, %r12b
je	<addr> <L+0x39c>
cmpb	$0x1, %al
je	<addr> <L+0x4c>
movzbl	%al, %eax
cmpl	$0x16, %eax
je	<addr> <L+0x40>
cmpl	$0x31, %eax
je	<addr> <L+0x40>
cmpb	$0x0, 0x344(%r15)
jne	<addr> <L+0x4c>
jmp	<addr> <L+0x39c>
movq	%r14, %rdi
movl	$0x45, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
jne	<addr> <L+0x30>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x295>
jmp	<addr> <L+0x30>
movq	%r14, %rdi
movl	$0x13, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
je	<addr> <L+0x1b8>
jmp	<addr> <L+0x30>
movl	%eax, %ebx
jmp	<addr> <L+0x32>
movl	%eax, %edx
shrl	$0x8, %edx
movl	%eax, %ebx
jmp	<addr> <L+0x32>
movq	%r14, %rdi
movl	$0x1, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expect>
movl	%eax, %edx
cmpb	$-0x1, %al
sete	%bl
negb	%bl
orb	$0x4, %bl
jmp	<addr> <L+0x32>
movq	%r14, %rdi
movl	$0x28, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
je	<addr> <L+0x22>
movl	%eax, %edx
movb	$0x4, %bl
jmp	<addr> <L+0x32>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::unexpected>
xorl	%ebx, %ebx
jmp	<addr> <L+0x32>
movl	$<addr>, %ecx         # imm = 0xF9C428
callq	<addr> <core::slice::index::slice_index_fail>

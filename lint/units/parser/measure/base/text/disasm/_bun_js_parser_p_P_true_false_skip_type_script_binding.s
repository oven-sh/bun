# <bun_js_parser::p::P<true, false>>::skip_type_script_binding
# = <bun_js_parser::p::P<true, true>>::skip_type_script_binding
# size 609 instructions 167
movq	0xcd8(%rdi), %rax
movq	%rsp, %rcx
xorl	%edx, %edx
subq	%rax, %rcx
cmovaeq	%rcx, %rdx
cmpq	$<addr>, %rdx          # imm = <addr>
jb	<addr> <L+0x8e>
pushq	%rbp
movq	%rsp, %rbp
pushq	%r14
pushq	%rbx
movq	%rdi, %r14
leaq	0x208(%rdi), %rbx
movzbl	0x351(%rdi), %eax
cmpl	$0x44, %eax
jg	<addr> <L+0x91>
cmpl	$0x28, %eax
je	<addr> <L+0x10f>
cmpl	$0x29, %eax
jne	<addr> <L+0x255>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movl	%eax, %edx
movb	$0x4, %al
cmpb	$-0x1, %dl
jne	<addr> <L+0x23e>
jmp	<addr> <L+0x80>
nopw	%cs:(%rax,%rax)
nopl	(%rax)
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x23a>
movzbl	0x351(%r14), %eax
cmpb	$0x16, %al
je	<addr> <L+0x70>
jmp	<addr> <L+0xdd>
movb	$0x1, %al
retq
cmpl	$0x45, %eax
je	<addr> <L+0x9f>
cmpl	$0x62, %eax
jne	<addr> <L+0x255>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movl	%eax, %edx
cmpb	$-0x1, %al
sete	%al
negb	%al
orb	$0x4, %al
jmp	<addr> <L+0x23e>
cmpb	$0x16, 0x351(%r14)
jne	<addr> <L+0x243>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x23a>
movzbl	0x351(%r14), %eax
cmpb	$0x18, %al
je	<addr> <L+0xee>
movzbl	%al, %eax
cmpl	$0x13, %eax
jne	<addr> <L+0xfe>
jmp	<addr> <L+0x243>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x23a>
movq	%r14, %rdi
callq	<addr> <L+0x0>
cmpb	$-0x1, %al
je	<addr> <L+0xb7>
jmp	<addr> <L+0x23e>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movl	%eax, %edx
movb	$0x4, %al
cmpb	$-0x1, %dl
jne	<addr> <L+0x23e>
jmp	<addr> <L+0x180>
nopw	%cs:(%rax,%rax)
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movl	%eax, %edx
cmpb	$-0x1, %al
movb	$0x4, %al
je	<addr> <L+0x180>
jmp	<addr> <L+0x23e>
callq	<addr> <<bun_js_parser::lexer::Lexer>::unexpected>
cmpb	$0x15, 0x351(%r14)
je	<addr> <L+0x204>
movq	%rbx, %rdi
movl	$0x15, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
je	<addr> <L+0x204>
jmp	<addr> <L+0x23a>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::unexpected>
jmp	<addr> <L+0x1c3>
nopl	(%rax)
movzbl	0x351(%r14), %eax
movzbl	%al, %ecx
cmpl	$0x17, %ecx
jg	<addr> <L+0x19d>
leal	-0x5(%rcx), %edx
cmpl	$0x2, %edx
jae	<addr> <L+0x1dd>
movq	%rbx, %rdi
jmp	<addr> <L+0x1ed>
cmpl	$0x18, %ecx
je	<addr> <L+0x1a9>
cmpl	$0x45, %ecx
je	<addr> <L+0x1c3>
jmp	<addr> <L+0x1e2>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x23a>
cmpb	$0x45, 0x351(%r14)
jne	<addr> <L+0x172>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x23a>
movzbl	0x351(%r14), %eax
cmpb	$0x15, %al
je	<addr> <L+0x204>
jmp	<addr> <L+0x228>
cmpl	$0x1, %ecx
je	<addr> <L+0x230>
movq	%rbx, %rdi
cmpb	$0x44, %al
jbe	<addr> <L+0x145>
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x23a>
cmpb	$0x15, 0x351(%r14)
jne	<addr> <L+0x158>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x23a>
movq	%r14, %rdi
callq	<addr> <L+0x0>
cmpb	$-0x1, %al
jne	<addr> <L+0x10a>
movzbl	0x351(%r14), %eax
cmpb	$0x16, %al
je	<addr> <L+0x130>
movq	%rbx, %rdi
movl	$0x1, %esi
jmp	<addr> <L+0x24b>
movl	%eax, %edx
movb	$0x4, %al
popq	%rbx
popq	%r14
popq	%rbp
retq
movq	%rbx, %rdi
movl	$0x13, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expect>
jmp	<addr> <L+0xa7>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::unexpected>
xorl	%eax, %eax
jmp	<addr> <L+0x23e>

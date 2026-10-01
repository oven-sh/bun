# <bun_js_parser::p::P<true, true>>::skip_type_script_type_stmt
# size 569 instructions 150
pushq	%rbp
movq	%rsp, %rbp
pushq	%r15
pushq	%r14
pushq	%r13
pushq	%r12
pushq	%rbx
subq	$0x18, %rsp
movq	%rsi, %r15
movq	%rdi, %rbx
cmpb	$0x0, 0x1a(%rsi)
je	<addr> <L+0x76>
leaq	0x208(%rbx), %r14
movzbl	0x351(%rbx), %eax
cmpl	$0xd, %eax
je	<addr> <L+0xe2>
cmpl	$0x28, %eax
jne	<addr> <L+0x7d>
leaq	-0x40(%rbp), %rdi
movq	%rbx, %rsi
callq	<addr> <<bun_js_parser::p::P<true, true>>::parse_export_clause>
cmpb	$0x2, -0x2f(%rbp)
je	<addr> <L+0x166>
movl	$<addr>, %esi         # imm = 0x317BB0
movl	$0x4, %edx
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::is_contextual_keyword>
testb	%al, %al
je	<addr> <L+0x1ac>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
jmp	<addr> <L+0x150>
movzbl	0x351(%rbx), %eax
leaq	0x208(%rbx), %r14
movq	0x270(%rbx), %r12
movq	0x278(%rbx), %r13
cmpb	$0x45, %al
jne	<addr> <L+0x1fb>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x189>
cmpb	$0x1, 0x19(%r15)
jne	<addr> <L+0xc3>
leaq	0xa88(%rbx), %rdi
movq	%r12, %rsi
movq	%r13, %rdx
callq	<addr> <<bun_collections::array_hash_map::StringHashMap<bool>>::put>
movq	%rbx, %rdi
movl	$0x5, %esi
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_parameters>
cmpb	$-0x1, %al
je	<addr> <L+0x170>
movl	%eax, %edx
shrl	$0x8, %edx
jmp	<addr> <L+0x18d>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x189>
cmpb	$0x45, 0x351(%rbx)
jne	<addr> <L+0x13e>
movq	0x268(%rbx), %rdx
movq	0x2f0(%rbx), %rdi
movq	0x2f8(%rbx), %rsi
movq	%rsi, %rax
subq	%rdi, %rax
jb	<addr> <L+0x22f>
cmpq	%rdx, %rsi
ja	<addr> <L+0x22f>
cmpq	$0x2, %rax
jne	<addr> <L+0x13e>
movq	0x260(%rbx), %rax
cmpw	$0x7361, (%rax,%rdi)    # imm = 0x7361
je	<addr> <L+0x1c1>
movl	$<addr>, %esi         # imm = 0x317BB0
movl	$0x4, %edx
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expect_contextual_keyword>
cmpb	$-0x1, %al
jne	<addr> <L+0x189>
leaq	-0x40(%rbp), %rdi
movq	%rbx, %rsi
callq	<addr> <<bun_js_parser::p::P<true, false>>::parse_path>
cmpb	$0x2, -0x2a(%rbp)
jne	<addr> <L+0x1ac>
movzbl	-0x40(%rbp), %eax
movzbl	-0x3f(%rbp), %edx
jmp	<addr> <L+0x18d>
cmpb	$0x3b, 0x351(%rbx)
jne	<addr> <L+0x215>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x19c>
movl	%eax, %edx
movb	$0x4, %al
addq	$0x18, %rsp
popq	%rbx
popq	%r12
popq	%r13
popq	%r14
popq	%r15
popq	%rbp
retq
movq	%rbx, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0x18d>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expect_or_insert_semicolon>
movl	%eax, %edx
cmpb	$-0x1, %al
sete	%al
negb	%al
orb	$0x4, %al
jmp	<addr> <L+0x18d>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x189>
leaq	-0x40(%rbp), %rdi
movq	%rbx, %rsi
callq	<addr> <<bun_js_parser::p::P<true, false>>::parse_clause_alias>
cmpq	$0x0, -0x40(%rbp)
je	<addr> <L+0x1f1>
movq	%r14, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
jne	<addr> <L+0x189>
jmp	<addr> <L+0x13e>
movzbl	-0x38(%rbp), %eax
movzbl	-0x37(%rbp), %edx
jmp	<addr> <L+0x18d>
movq	%r14, %rdi
movl	$0x45, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
jne	<addr> <L+0x189>
jmp	<addr> <L+0x9a>
movq	%r14, %rdi
movl	$0x3b, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
jne	<addr> <L+0x189>
jmp	<addr> <L+0x17d>
movl	$<addr>, %ecx         # imm = 0xF9C428
callq	<addr> <core::slice::index::slice_index_fail>

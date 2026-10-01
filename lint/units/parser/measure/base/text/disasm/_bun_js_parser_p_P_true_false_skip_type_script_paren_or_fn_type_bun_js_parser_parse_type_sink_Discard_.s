# <bun_js_parser::p::P<true, false>>::skip_type_script_paren_or_fn_type::<bun_js_parser::parse::type_sink::Discard>
# = <bun_js_parser::p::P<true, true>>::skip_type_script_paren_or_fn_type::<bun_js_parser::parse::type_sink::Discard>
# size 162 instructions 55
pushq	%rbp
movq	%rsp, %rbp
pushq	%r14
pushq	%rbx
movq	%rdi, %r14
callq	<addr> <<bun_js_parser::p::P<true, false>>::lexer_backtracker_bool::<<bun_js_parser::p::P<true, false>>::skip_type_script_arrow_args_with_backtracking, bool>>
testb	%al, %al
je	<addr> <L+0x24>
movq	%r14, %rdi
xorl	%esi, %esi
movl	$0x1, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
jmp	<addr> <L+0x75>
leaq	0x208(%r14), %rbx
cmpb	$0x2a, 0x351(%r14)
jne	<addr> <L+0x7a>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
cmpb	$-0x1, %al
je	<addr> <L+0x47>
movl	%eax, %edx
movb	$0x4, %al
jmp	<addr> <L+0x75>
movq	%r14, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, false>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::Discard>>
cmpb	$-0x1, %al
jne	<addr> <L+0x75>
cmpb	$0x14, 0x351(%r14)
jne	<addr> <L+0x8d>
movq	%rbx, %rdi
callq	<addr> <<bun_js_parser::lexer::Lexer>::next>
movl	%eax, %edx
cmpb	$-0x1, %dl
sete	%al
negb	%al
orb	$0x4, %al
popq	%rbx
popq	%r14
popq	%rbp
retq
movq	%rbx, %rdi
movl	$0x2a, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
cmpb	$-0x1, %al
jne	<addr> <L+0x41>
jmp	<addr> <L+0x35>
movq	%rbx, %rdi
movl	$0x14, %esi
callq	<addr> <<bun_js_parser::lexer::Lexer>::expected>
movl	%eax, %edx
cmpb	$-0x1, %al
jne	<addr> <L+0x6b>
jmp	<addr> <L+0x61>

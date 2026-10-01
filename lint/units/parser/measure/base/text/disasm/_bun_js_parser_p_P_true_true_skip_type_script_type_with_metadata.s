# <bun_js_parser::p::P<true, true>>::skip_type_script_type_with_metadata
# size 121 instructions 35
pushq	%rbp
movq	%rsp, %rbp
pushq	%rbx
subq	$0x18, %rsp
movq	%rdi, %rbx
movups	-<addr>(%rip), %xmm0 # <data>
movaps	%xmm0, -0x20(%rbp)
movq	$0x0, -0x10(%rbp)
leaq	-0x20(%rbp), %rcx
movq	%rsi, %rdi
xorl	%esi, %esi
xorl	%edx, %edx
callq	<addr> <<bun_js_parser::p::P<true, true>>::skip_type_script_type_with_opts::<bun_js_parser::parse::type_sink::DecoratorMetadata>>
cmpb	$-0x1, %al
je	<addr> <L+0x63>
movb	%al, 0x8(%rbx)
movb	%dl, 0x9(%rbx)
movq	$-0x1, (%rbx)
movq	-0x20(%rbp), %rax
movabsq	$-<addr>, %rcx # imm = <addr>
cmpq	%rcx, %rax
jl	<addr> <L+0x72>
testq	%rax, %rax
je	<addr> <L+0x72>
movq	-0x18(%rbp), %rdi
callq	<addr> <mi_free>
jmp	<addr> <L+0x72>
movq	-0x10(%rbp), %rax
movq	%rax, 0x10(%rbx)
movaps	-0x20(%rbp), %xmm0
movups	%xmm0, (%rbx)
addq	$0x18, %rsp
popq	%rbx
popq	%rbp
retq

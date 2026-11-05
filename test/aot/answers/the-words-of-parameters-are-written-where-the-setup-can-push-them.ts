// answers: without-library
// # A parameter that is kept in a word of the frame is stored behind its ArgumentReg, in the block of the entry: that is the form whose stores the setup of the frame turns into pushes
// # (machine/frame-forms/arguments-stored-behind-the-setup-are-pushed builds it by hand). As phis of a block behind the entry, parameters never had it.
// # f1 = tellAll
// # RUN(WORDS): allocate f1 mechanisms=all
// # REQUIRES(WORDS): x86_64
// # WORDS-LABEL: unit f1:Body
// # WORDS: rdi = ArgumentReg rdi
// # WORDS-NEXT: save rdi -> s0
// # WORDS-NEXT: rsi = ArgumentReg rsi
// # WORDS-NEXT: save rsi -> s1
// # WORDS-NEXT: rdx = ArgumentReg rdx
// # WORDS-NEXT: save rdx -> s2
// # WORDS-NEXT: rcx = ArgumentReg rcx
// # WORDS-NEXT: save rcx -> s3
// # WORDS-NEXT: Patch
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
function tellAll(first: string, second: string, third: string, fourth: string): void { report("begin"); report(first); report(second); report(third); report(fourth); }
tellAll("a", "b", "c", "d");
report("end");

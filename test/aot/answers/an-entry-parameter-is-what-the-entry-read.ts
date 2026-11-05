// answers: without-library
// # Where nothing else enters the first block of a function, the entry goes on in it: a parameter is the argument register, or the word of the caller's frame, that the entry read.
// # There is no block that only jumps, no phi and no upsilon for a parameter.
// # Parameters that live across calls are told again behind them: texts, numbers, more than the registers hold, one that a loop changes, and a first block that its own loop enters again.
// # f1 = tellAll, f2 = tellNumbers
// # RUN(TEXTS): emit f1 mechanisms=all
// # TEXTS-LABEL: unit f1:Body
// # TEXTS-NOT: Phi
// # TEXTS-NOT: Upsilon
// # TEXTS-NOT: Jump
// # TEXTS: Return
// # RUN(NUMBERS): allocate f2 mechanisms=all
// # NUMBERS-LABEL: unit f2:Body
// # NUMBERS: = ArgumentReg
// # NUMBERS-NOT: Jump
// # NUMBERS: Patch
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 28 of 28 of 28
// # CHECK-NEXT: exited with 0
function tellAll(first: string, second: string, third: string, fourth: string): void { report("begin"); report(first); report(second); report(third); report(fourth); }
function tellNumbers(first: number, second: number): number { report(first); report(second); return first * 2 + second; }
function tellWhileItLasts(text: string, left: number): string { while (left > 0) { report(text); text = text + "!"; left = left - 1; } return text; }
function countDown(left: number): number { let turns = 0; do { turns = turns + 1; left = left - 1; } while (left > 0); return turns; }
function tellNine(a: string, b: string, c: string, d: string, e: string, f: string, g: string, h: string, i: string): string { report(i); report(a); report(h); report(b); return c + d + e + f + g; }
tellAll("a", "b", "c", "d");
tellAll("e", "f", "g", "h");
report(tellNumbers(1.5, 2.25));
report(tellNumbers(-0.5, 1e300));
report(tellWhileItLasts("x", 2));
report(tellWhileItLasts("y", 0));
report(countDown(3));
report(countDown(0));
report(tellNine("1", "2", "3", "4", "5", "6", "7", "8", "9"));
report("end");

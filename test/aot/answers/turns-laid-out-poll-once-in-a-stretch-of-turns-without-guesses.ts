// answers: without-library
// # the program of turns-laid-out-poll-once-in-a-stretch-of-turns.ts, built without the guesses. It has a file of its own because the shell's own run of the text, a hundred million turns in the interpreter, takes longer than the rest of the files of its part together.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell mechanisms=-Guesses $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sumBytes(view: Uint8Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; return t; }
function countSpaces(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) n++; } return n; }
function hashBetween(from: number, n: number): number { let h = 7; for (let i = from | 0; i < (n | 0); i++) h = (h * 31 + i) | 0; return h; }
function sumSixteen(x: number, y: number): number { let sum = x & 7; for (let i = 0; i < 16; i++) sum += x * y + i; return sum; }
function bytesOf(length: number): Uint8Array { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i * 37 + (i >> 9); return view; }
function textOf(length: number): string { return "ab cde f".repeat((length >> 3) + 1).slice(0, length); }
function all(length: number): void { report([length, sumBytes(bytesOf(length)), countSpaces(textOf(length)), hashBetween(0, length), hashBetween(-length, 5), hashBetween(-length, length), hashBetween(2147483647 - length, 2147483647), hashBetween(-2147483648, length - 2147483648), sumSixteen(length, 3), sumSixteen(length + 0.5, 3)].join(" ")); }
all(0);
all(7);
all(8);
all(9);
all(1048575);
all(1048576);
all(1048577);
all(1048583);
all(1048584);
all(1048585);
all(2097152);
all(2097161);
report("end");

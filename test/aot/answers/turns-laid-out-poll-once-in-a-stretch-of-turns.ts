// answers: without-library
// # the turns of a counted loop that are laid out run in stretches of 2^20 turns and poll between two stretches: no poll stands in the loop that goes round once in eight turns.
// # lengths on both sides of one and of two stretches are run, and counters from the least int32 and up to the largest, where 2^20 turns on is more than an int32 holds.
// # f1 = sumBytes, f2 = countSpaces, f3 = hashBetween, f4 = sumSixteen
// # behind the last of the eight reads comes the branch that goes round, and no poll in front of it
// # RUN(ROUND): emit f1 mechanisms=all
// # ROUND-LABEL: unit f1:Body
// # ROUND: = Load8Z({{*}}offset = 7, TypedArrayProperties
// # ROUND-NOT: effects = ExitsSideways|ControlDependent|MayCollect
// # ROUND: = Branch(
// # the end of a stretch: 2^20 turns on, or the bound of the turns laid out where that is nearer: chosen at the entry, and again behind the poll
// # RUN(STRETCH): emit f1 mechanisms=all
// # STRETCH-COUNT-2: = Select(
// # STRETCH-NOT: = Select(
// # sixteen turns by the types: no stretch, and one poll in all, that of the written loop, which the turns laid out come to
// # RUN(FEW): emit f4 mechanisms=all
// # FEW-COUNT-1: effects = ExitsSideways|ControlDependent|MayCollect
// # FEW-NOT: effects = ExitsSideways|ControlDependent|MayCollect
// # a counter of 32 bits: the constant still goes into the address
// # RUN(TEXT): emit f2 mechanisms=all
// # TEXT: = Load8Z({{*}}offset = 7, characters8
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sumBytes(view: Uint8Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; return t; }
function countSpaces(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) n++; } return n; }
function hashBetween(from: number, n: number): number { let h = 7; for (let i = from | 0; i < (n | 0); i++) h = ((h & 0xffffff) * 31 + i) | 0; return h; }
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

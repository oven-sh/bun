// answers: without-library
// # a loop that counts up by one to a bound from in front of it takes eight turns at a time as long as eight are left: one test, one poll and one jump for the eight.
// # the loop as it is written stands behind and takes what is left over. Every length from 0 past three times eight is run, of bytes, of texts of both widths, of lists of both kinds of numbers, and of a bare counter.
// # f1 = sumBytes, f6 = countSpaces, f7 = sumList, f8 = hashUpTo, f9 = findSpace, f10 = countEverySecondSpace
// # eight reads laid out and the one of the written loop
// # RUN(BYTES): emit f1 mechanisms=all
// # BYTES-LABEL: unit f1:Body
// # BYTES-COUNT-9: = Load8Z({{*}}TypedArrayProperties
// # BYTES-NOT: = Load8Z({{*}}TypedArrayProperties
// # the counter of a later turn is that of the first and a constant, which the address takes in: no turn but the last steps it
// # RUN(DISTANCE): emit f1 mechanisms=all
// # DISTANCE: = Load8Z({{*}}offset = 1, TypedArrayProperties
// # DISTANCE: = Load8Z({{*}}offset = 4, TypedArrayProperties
// # DISTANCE: = Load8Z({{*}}offset = 7, TypedArrayProperties
// # a counter of 32 bits too, which is extended for the address
// # RUN(TEXT): emit f6 mechanisms=all
// # TEXT: = Load8Z({{*}}offset = 1, characters8
// # TEXT: = Load8Z({{*}}offset = 7, characters8
// # whether the text is of bytes is asked once, in front: the first eight turns laid out read bytes; a wide text has eight turns of its own, which read words
// # RUN(WIDE): emit f6 mechanisms=all
// # WIDE: = Load16Z({{*}}offset = 2, characters16
// # WIDE: = Load16Z({{*}}offset = 14, characters16
// # (A turn that may leave the loop by itself, a counter that steps by two, and a bound so near the end of int32 that the bound less seven wraps: turn-laid-out-that-leaves-the-loop-hands-itself-to-the-written-loop.ir and counter-of-turns-laid-out-steps-up-or-down-by-a-constant.ir hold what is done with them now.)
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 32 of 32 of 32
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 32 of 32 of 32
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO2: 32 of 32 of 32
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO3: 32 of 32 of 32
// # ALSO3-NEXT: exited with 0
// # RUN(ALSO4): run-in-shell mechanisms=-ParameterGuards-LoopInvariants $SHELL
// # ALSO4: 32 of 32 of 32
// # ALSO4-NEXT: exited with 0
declare function report(value: unknown): void;
function countSpaces(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) n++; } return n; }
function sumBytes(view: Uint8Array): number { let t = 0; for (let i = 0; i < view.length; i++) t += view[i]; return t; }
function sumList(list: number[]): number { let t = 0; for (let i = 0; i < list.length; i++) t += list[i]; return t; }
function hashUpTo(n: number): number { let h = 7; for (let i = 0; i < (n | 0); i++) h = (h * 31 + i) | 0; return h; }
function findSpace(s: string): number { for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) return i; } return -1; }
function countEverySecondSpace(s: string): number { let n = 0; for (let i = 0; i < s.length; i += 2) { if (s.charCodeAt(i) === 32) n++; } return n; }
(globalThis as any).kept = [countSpaces, sumList, hashUpTo, findSpace, countEverySecondSpace];
const kept = (globalThis as any).kept;
function textOf(length: number, filler: string): string { let text = ""; for (let i = 0; i < length; i++) text += i % 3 === 2 ? " " : filler; return text; }
function bytesOf(length: number): Uint8Array { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i * 7 + 1; return view; }
function listOf(length: number, step: number): number[] { const list: number[] = []; for (let i = 0; i < length; i++) list.push(i * step); return list; }
function texts(length: number, filler: string): string { const text = textOf(length, filler); return [kept[0](text), kept[3](text), kept[4](text)].join(); }
function all(length: number): void { report([length, texts(length, "a"), texts(length, "Ω"), sumBytes(bytesOf(length)), kept[1](listOf(length, 3)), kept[1](listOf(length, 0.5)), kept[2](length)].join(" ")); }
for (let length = 0; length < 27; length++) all(length);
all(64);
all(1000);
report(kept[2](-5));
report(kept[2](-2147483648));
report("end");

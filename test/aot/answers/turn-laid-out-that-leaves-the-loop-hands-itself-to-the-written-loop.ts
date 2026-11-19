// answers: without-library
// # a counted loop that a turn may leave by itself (`return i`, `break`) has its turns laid out too. What stands behind the loop reads what the written loop has made, so no turn laid out goes there:
// # its edge out leads to the head of the written loop, with what that turn began with; the written loop takes the turn again, which writes nothing, and leaves by the edge as it is written.
// # the way out is taken at every index from 0 past three times eight, and never: each of the eight turns is the one that leaves. Validated: what is handed over feeds every Phi of the written head.
// # OPTIONS: check=Validate
// # f1 = findSpace, f2 = sumUpTo, f3 = hashUpTo, f4 = skipsAndStops
// # RUN(FIND): emit f1 mechanisms=all
// # FIND-LABEL: unit f1:Body
// # FIND: = Load8Z({{*}}offset = 1, characters8
// # FIND: = Load8Z({{*}}offset = 7, characters8
// # a sum kept as an integer is made a number wherever a turn leaves
// # RUN(SUM): emit f2 mechanisms=all
// # SUM: = Load8Z({{*}}offset = 7, TypedArrayProperties
// # RUN(HASH): emit f3 mechanisms=all
// # HASH: = Load8Z({{*}}offset = 7, TypedArrayProperties
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 74 of 74 of 74
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 74 of 74 of 74
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO2: 74 of 74 of 74
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
function findSpace(s: string): number { for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) return i; } return -1; }
function sumUpTo(view: Uint8Array, stop: number): string { let t = 0; let i = 0; for (; i < view.length; i++) { if (view[i] === stop) break; t += view[i]; } return t + ":" + i; }
function hashUpTo(view: Uint8Array, stop: number): number { let h = 7; for (let i = 0; i < view.length; i++) { if (view[i] === stop) return h; h = (h * 31 + view[i]) | 0; } return ~h; }
function skipsAndStops(view: Uint8Array, stop: number): number { let t = 0; for (let i = 0; i < view.length; i++) { if (view[i] === 7) continue; if (view[i] === stop) break; t += view[i]; } return t; }
function textOf(length: number, at: number, filler: string): string { let text = ""; for (let i = 0; i < length; i++) text += i === at ? " " : filler; return text; }
function bytesOf(length: number, at: number): Uint8Array { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i === at ? 200 : i % 100; return view; }
function once(length: number, at: number): void { report([length, at, findSpace(textOf(length, at, "a")), findSpace(textOf(length, at, "Ω")), sumUpTo(bytesOf(length, at), 200), hashUpTo(bytesOf(length, at), 200), skipsAndStops(bytesOf(length, at), 200)].join(" ")); }
function all(length: number): void { for (let at = -1; at <= length; at++) once(length, at); }
all(0);
all(1);
all(8);
all(9);
all(17);
all(26);
report("end");

// answers: with-library
// # `Object.entries(p)` in a loop, behind the tests that Object.values asks (the shape, its order of keys, no other property): a list of pairs is written out: for each field a fresh list of its name and what the field holds. No native code is called in the turn.
// # Also where a for-of takes the pairs apart at once. Outside of loops the call stays.
// # f1 = byIndex, f2 = byPattern, f3 = kept, f4 = once
// # RUN(INDEX): walk f1:Body mechanisms=all
// # INDEX: isInLoop=true isLoopHead=true
// # INDEX: = GetSlot {{*}}key="y"
// # RUN(PATTERN): walk f2:Body mechanisms=all
// # PATTERN: = GetSlot {{*}}key="x"
// # PATTERN: = GetSlot {{*}}key="y"
// # RUN(KEPT): walk f3:Body mechanisms=all
// # KEPT: = NewArray
// # KEPT: = NewArray
// # KEPT: = NewArray
// # RUN(ONCE): walk f4:Body mechanisms=all
// # ONCE: = CallInline {{*}}overload=ObjectEntries
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class P { x = 1; y = 2; }
function byIndex(p: P, n: number) { let s = 0; for (let i = 0; i < n; i++) { const e = Object.entries(p); s += e.length + (e[1]![1] as number) + e[0]![0].length; } return [s]; }
function byPattern(p: P, n: number) { let s = 0; for (let i = 0; i < n; i++) for (const [name, value] of Object.entries(p)) s += name.length + (value as number); return [s]; }
function kept(p: P, n: number) { const all: unknown[] = []; for (let i = 0; i < n; i++) { p.x = i; all[i] = Object.entries(p); } return [JSON.stringify(all)]; }
function once(p: P) { const e = Object.entries(p); return [e.length + e[0]![0].length]; }
function tell(f: () => unknown[]) { try { report(f()[0]); } catch (e) { report((e as Error).name); } }
tell(() => byIndex(new P(), 5)); tell(() => byPattern(new P(), 5)); tell(() => kept(new P(), 3)); tell(() => once(new P()));
const grown = new P(); (grown as any).z = 30; tell(() => byIndex(grown, 3)); tell(() => byPattern(grown, 3)); tell(() => kept(grown, 2));
const shrunk = new P(); delete (shrunk as any).x; tell(() => byPattern(shrunk, 3)); tell(() => kept(shrunk, 2));
const odd: any = { y: 5, get x() { return 7; } }; tell(() => byIndex(odd, 3)); tell(() => byPattern(odd, 3));
tell(() => byIndex(null as any, 2)); tell(() => byPattern(undefined as any, 2)); tell(() => byIndex(null as any, 0));
report("end");

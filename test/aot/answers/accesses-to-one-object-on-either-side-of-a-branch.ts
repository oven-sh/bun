// answers: without-library
// # accesses to one object in a condition and in the blocks behind it, in a returned comparison and in the turns of a loop: whatever the object is, a getter among them, the answers are those of the text, and each getter, setter and call runs as often
// # f3 = reduced, f4 = same, f5 = bumped, f6 = chain, f7 = total, f8 = fill
// # RUN(FORM): walk f3 mechanisms=all-ParameterGuards
// # FORM-LABEL: code f3:Body
// # FORM-COUNT-1: = ShapeTest
// # FORM-NOT: = ShapeTest
// # RUN(CHAIN): walk f6 mechanisms=all-ParameterGuards
// # CHAIN-LABEL: code f6:Body
// # CHAIN-COUNT-2: = ShapeTest
// # CHAIN-NOT: = ShapeTest
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 379 of 379 of 379
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 379 of 379 of 379
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
class Kind { flags: number; more: number; constructor(flags: number, more: number) { this.flags = flags; this.more = more; } }
let notes = 0;
let gets = 0;
function note() { notes++; }
function bump(type: Kind) { type.flags = 2; return false; }
function reduced(type: Kind) { if (type.flags & 1) return 1; else if (type.flags & 2) return 2; else if (type.more & 4) return 3; return 4; }
function same(holder: { kind: Kind }) { const k = holder.kind; return k.flags === k.more; }
function bumped(type: Kind) { if (type.flags & 1 && bump(type)) return 1; else if (type.flags & 2) return 2; return 3; }
function chain(a: Kind | null) { const t = a && a.flags & 8 ? new Kind(a.more, 0) : a; return t === null ? -1 : t.flags & 1 ? 1 : t.flags & 2 ? 2 : t.more & 1 ? 3 : 4; }
function total(items: Kind[]) { let odd = 0; let even = 0; for (let i = 0; i < items.length; i++) { const n = items[i]; n.more = i; note(); if (n.flags & 1) odd += n.flags; else even += n.flags; } return odd + ":" + even; }
function fill(items: Kind[]) { let k = 0; let last = 0; while (true) { const n = items[k]; n.more = k; note(); if (n.flags & 1) { if (k < 3) { k++; last = n.flags; continue; } } break; } return k + ":" + last; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function withGetter(flags: number): any { const made: any = { more: flags >> 1 }; Object.defineProperty(made, "flags", { get() { gets++; return flags + (gets & 1); }, set(value) { gets += 10; } }); return made; }
function made(which: number, flags: number): any { return which === 0 ? new Kind(flags, flags >> 1) : which === 1 ? { more: flags >> 1, flags } : which === 2 ? null : which === 3 ? undefined : which === 4 ? flags : which === 5 ? "text" : withGetter(flags); }
for (let w = 0; w < 7; w++) for (let f = 0; f < 10; f++) { tell(() => reduced(made(w, f))); tell(() => same({ kind: made(w, f) })); tell(() => bumped(made(w, f))); tell(() => chain(made(w, f))); report(gets); }
for (let w = 0; w < 7; w++) { tell(() => total([made(0, 1), made(0, 2), made(w, 3), made(0, 4)])); tell(() => fill([made(0, 1), made(w, 3), made(0, 5), made(0, 7), made(0, 9)])); report(notes); report(gets); }
report("end");

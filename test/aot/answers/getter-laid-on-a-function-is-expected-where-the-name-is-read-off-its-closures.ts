// answers: without-library
// # A descriptor lays a getter on a function object, under a name that is written, and the function asks itself under that name at every call. Where closures of that one function are all that arrives at the read, it expects the getter.
// # Each closure has a getter with captures of its own: the code calls what the lookup has found.
// # makeBell is written once for each of its two calls (f2, f3): f7 = the ring of the first, f8 = its getter enabled; f10 = the ring of the second, f11 = its getter.
// # RUN(HELD): link accesses held mechanisms=all
// # HELD: read f7 {{*}} expects getter f8
// # HELD: read f10 {{*}} expects getter f11
// # HELD-NOT: expects getter
// # RUN(PROVEN): link accesses mechanisms=all
// # PROVEN-NOT: expects getter
// # RUN(WALK): walk f7 mechanisms=all
// # WALK: = GetCachedGetter {{*}}key="enabled"
// # WALK: = TypeTest {{*}}testedType=f8
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
function makeBell(town: string): any { let strokes = 0; const loud = town.length > 3; let told: boolean | null = null; function ring(text: string) { if ((ring as any).enabled) { strokes++; return strokes + text.length; } return 0; } Object.defineProperty(ring, "enabled", { configurable: false, enumerable: true, get: function enabled() { return told === null ? loud : told; }, set: function enable(value: boolean) { told = value; } }); (ring as any).town = town; return ring; }
const first = makeBell("Delft");
const off = makeBell("Ems");
let sum = 0;
for (let i = 0; i < 300; i++) sum += first("abc") + off("abc");
report(sum);
off.enabled = true;
for (let i = 0; i < 300; i++) sum += first("abc") + off("abc");
report(sum);
report("end");

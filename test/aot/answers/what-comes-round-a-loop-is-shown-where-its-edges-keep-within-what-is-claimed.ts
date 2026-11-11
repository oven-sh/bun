// answers: without-library
// # What comes round a loop is shown by induction: the parameter of the head is taken as what it is claimed to be, and where what its edges are then shown to hand over keeps within the claim, nobody is asked. `swaps`: two
// # parameters that change places, each a number or a text: its result is asked nothing. Where the claim rests on a belief that no edge shows (`at = at.inner`, `s = at.tag`: what Link says of a field), the claim is NOT taken:
// # the check behind the loop still asks in full: it takes nothing for known but that the word may be absent.
// # f4 = deepest, f5 = tags, f6 = swaps
// # RUN(FORM): walk f4 f5 f6 mechanisms=all
// # FORM-LABEL: code f4:Body
// # FORM: CheckProof {{*}}checkedType=null|L0 typeWithoutProof=absent|anything source=ResultOfCall
// # FORM-LABEL: code f5:Body
// # FORM: CheckProof {{*}}checkedType=number|string typeWithoutProof=absent|anything source=ResultOfCall
// # FORM-LABEL: code f6:Body
// # FORM-NOT: CheckProof
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sum(list: any, n: number): unknown { let s: any = 0; for (let i = 0; i < n; i++) s += list[i]; return s; }
function twice(list: any, n: number): unknown { const first: any = sum(list, n); return first + first; }
report(String(twice([1, 2, 4], 3)) + ":" + String(twice(["x", 2, 4], 3)) + ":" + String(twice([], 0)));

function Box(this: any, tag: unknown, inner: unknown): void { this.tag = tag; this.inner = inner; }
function deepest(box: any, steps: number): any { let at = box; for (let i = 0; i < steps; i++) at = at.inner; return at; }
function tags(box: any, steps: number): unknown { let at = box, s: unknown = 0; for (let i = 0; i < steps; i++) { s = at.tag; at = at.inner; } return s; }
const a = new (Box as any)(1, null);
a.inner = a;
const b = new (Box as any)("two", a), c = new (Box as any)(3.5, b);
report(deepest(c, 2).tag + ":" + tags(c, 2) + ":" + tags(c, 3) + ":" + deepest(c, 5).tag);

function swaps(n: number, x: any): string { let p: any = 0, q: any = "q"; for (let i = 0; i < n; i++) { const kept = p; p = q; q = kept + x; } return typeof p + typeof q; }
report(swaps(0, 1) + swaps(1, 1) + swaps(2, 1) + swaps(3, "u") + swaps(2, "t"));

function big(n: number, x: any): unknown { let s: any = 0n; for (let i = 0; i < n; i++) s = s + x; return s; }
report(String(big(2, 3n)) + ":" + String(big(0, 1)) + ":" + String(big(1, "t")));
try { big(1, 1); report("no error"); } catch (error) { report((error as Error).constructor.name); }
report("end");

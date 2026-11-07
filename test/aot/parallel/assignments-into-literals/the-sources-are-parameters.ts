// No guess stands around the call: the literal is made once and its name is bound anew.
// STATISTIC: AssignmentsWrittenOutFieldByField >= 1
type Part = { p: number };
type Rest = { q: number };
type Sum = { c: number; p?: number; q?: number };
class Pair { a: Part; b: Rest; c: number; constructor(p: number) { this.a = { p }; this.b = { q: p + 1 }; this.c = p + 2; } }
class Other { extra = 1; a = { p: 70 }; b = { q: 80 }; c = 9; }
class Holder { kept: Pair; constructor(kept: Pair) { this.kept = kept; } get(): Pair { return this.kept; } }
const given: Pair[] = [new Pair(1), new Other() as any, new Pair(5)];
function merged(a: Part, b: Rest, i: number) { const t: Sum = { c: i }; Object.assign(t, a, b); return t; }
for (const x of given) console.log(JSON.stringify(merged(x.a, x.b, 1)));

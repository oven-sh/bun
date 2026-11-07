// The call stands in the arms of the guess at the holder and nobody names the literal behind it: it is still written out field by field.
// STATISTIC: AssignmentsWrittenOutFieldByField >= 1
type Part = { p: number };
type Rest = { q: number };
type Sum = { c: number; p?: number; q?: number };
class Pair { a: Part; b: Rest; c: number; constructor(p: number) { this.a = { p }; this.b = { q: p + 1 }; this.c = p + 2; } }
class Other { extra = 1; a = { p: 70 }; b = { q: 80 }; c = 9; }
class Holder { kept: Pair; constructor(kept: Pair) { this.kept = kept; } get(): Pair { return this.kept; } }
const given: Pair[] = [new Pair(1), new Other() as any, new Pair(5)];
function merged(x: Pair, i: number) { const sum: Sum = Object.assign({ c: i } as Sum, x.a); return [sum, x.c]; }
for (const x of given) console.log(JSON.stringify(merged(x, 1)));

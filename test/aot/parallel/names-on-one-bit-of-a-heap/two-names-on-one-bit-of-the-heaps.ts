// `value` and `last` fall on one of the 64 bits of the heap of object fields. A store under one of them says nothing of the other.
class Pair { value = 1; last = 2; }
class Reading { value = 1; weight = 2; }
class Keeper { last: Reading | null = null; }
function beside(a: Pair, b: Pair): number { const before = a.value; b.last = 7; return before + a.value; }
function same(a: Pair, b: Pair): number { const before = a.value; b.value = 7; return before + a.value; }
function leaves(keeper: Keeper, n: number): number { const reading = new Reading(); reading.value = n; keeper.last = reading; return reading.value + reading.weight; }
function through(keeper: Keeper, n: number): number { const reading = new Reading(); reading.value = n; keeper.last = reading; keeper.last.value = n + 1; return reading.value; }
const one = new Pair(), two = new Pair(), keeper = new Keeper();
console.log(beside(one, two), beside(one, one), same(one, two), same(one, one), one.last, two.last, two.value);
console.log(leaves(keeper, 5), keeper.last!.value, through(keeper, 8), keeper.last!.value);
let first = 1, second = 2;
function variables(n: number): number { const before = first; second = n; const between = first; first = n + 1; return before + between + first + second; }
console.log(variables(10), first, second);
function scopes(n: number): () => number { let low = n, high = n + 1; const bump = () => { const before = low; high = high + 1; const between = low; low = low + 2; return before + between + low + high; }; return bump; }
const bump = scopes(3); console.log(bump(), bump());
(globalThis as any).keep = [beside, same, leaves, through, variables, scopes];

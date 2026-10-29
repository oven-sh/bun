// The closure for a hoisted function declaration is created where its name is first used as a value.
function each<T>(list: T[], f: (x: T) => void) { for (const x of list) f(x); }
function keep<T>(x: T): T { kept.push(x); return x; }
const kept: unknown[] = [];
function neverUsed(n: number) { return helper() + n; function helper() { return n * 2; } }
function usedOnRarePath(n: number, rare: boolean) { let total = 0; if (rare) each([1, 2], add); return total + n; function add(x: number) { total += x; } }
function usedByInner(n: number) { let total = 0; const run = () => each([1, 2, 3], add); run(); run(); return total + n; function add(x: number) { total += x; } }
function observedByInner(n: number) { const a = () => keep(f); return a() === a() && a()() === n; function f() { return n; } }
function recursiveVisitor(depth: number) { let count = 0; visit(depth); return count; function visit(d: number) { count++; if (d > 0) each([d - 1, d - 1], visit); } }
function spreadCall(n: number) { const list: [number, number] = [1, 2]; return add(...list); function add(a: number, b: number) { return a + b + n; } }
function assigned(n: number) { const before = f(); (f as any) = () => n + 100; return before + f(); function f() { return n; } }
function typeOnly(n: number) { const r: ReturnType<typeof helper> = helper(); return r; function helper() { return n + 1; } }
function byTable(list: number[], a: (x: number) => void, b: (x: number) => void) { const table = [a, b]; for (const x of list) table[x & 1](x); }
function twoUsesReadConst(list: number[]) { const seen: number[] = []; byTable(list, add, add); return seen.join(); function add(x: number) { seen.unshift(x); } }
function twoUsesThroughAnother(list: number[]) { const seen: number[] = []; byTable(list, outer, outer); return seen.join(); function outer(x: number) { inner(x); } function inner(x: number) { seen.push(x); } }
function throughConstArrow(list: number[]) { const seen: number[] = []; const add = (x: number) => { seen.push(x); }; byTable(list, g, g); return seen.join(); function g(x: number) { add(x); } }
function throughTwoArrows(list: number[]) { const seen: number[] = []; const add = (x: number) => { seen.push(x); }; const twice = (x: number) => { add(x); add(x); }; byTable(list, g, g); return seen.join(); function g(x: number) { twice(x); } }
function assignedReadsConst() { const base = Number("5"); const before = f(); (f as any) = () => base + 1; return before + f(); function f() { return base; } }
console.log(neverUsed(1), usedOnRarePath(1, false), usedOnRarePath(1, true), usedByInner(1), observedByInner(2), recursiveVisitor(3), spreadCall(1), typeOnly(1));
try { console.log(assigned(1)); } catch (e) { console.log((e as Error).name); }
console.log(twoUsesReadConst([1, 2, 3]), twoUsesThroughAnother([1, 2]), assignedReadsConst(), throughConstArrow([1, 2]), throughTwoArrows([3]));

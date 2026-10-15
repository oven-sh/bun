// Two evaluations of a function expression give two distinct objects, whether or not the function captures anything.
function make() { return () => 1; }
function makeCapturing(x: number) { return () => x; }
function declared() { function inner() { return 1; } return inner; }
console.log(make() === make(), makeCapturing(1) === makeCapturing(1), declared() === declared());
const tagged = make() as any; tagged.tag = 1;
console.log((make() as any).tag, tagged.tag);
const seen = new Set<unknown>(); for (let i = 0; i < 3; i++) seen.add(make());
console.log(seen.size);
// The closure of a declaration stays the same object until its scope is entered again.
function same(n: number) { const a = hoisted; const viaInner = (() => hoisted)(); return [a === hoisted, a === viaInner, a() === n].join(); function hoisted() { return n; } }
function sameWithoutCaptures() { const a = hoisted; const viaInner = (() => hoisted)(); return a === viaInner; function hoisted() { return 1; } }
function selfReference(n: number) { return visit(n); function visit(k: number): boolean { return k === 0 ? pick(visit) === visit : visit(k - 1); } }
function pick<T>(x: T): T { return x; }
function inLoop() { const all: unknown[] = []; for (let i = 0; i < 2; i++) { all.push(f, f); function f() { return i; } } return [all[0] === all[1], all[1] === all[2], all[2] === all[3]].join(); }
console.log(same(3), sameWithoutCaptures(), selfReference(2), inLoop());
// Only called: the difference is not observable.
function some<T>(list: T[], test: (x: T) => boolean) { for (const x of list) if (test(x)) return true; return false; }
function passedOn<T>(list: T[], test: (x: T) => boolean) { return some(list, test); }
console.log(some([1, 2], x => x > 1), passedOn([1, 2], x => x > 2), [1, 2].some(x => x > 1));
// Where a function expression is passed, when the callee is not a plain name.
const held: unknown[] = [];
function holds(f: () => number) { held.push(f); return f(); }
function onlyCalls(f: () => number) { return f(); }
function lastTwoAreOne() { return held[held.length - 1] === held[held.length - 2]; }
let assignedTo: ((f: () => number) => number) | undefined;
function throughAssignment() { for (let i = 0; i < 2; i++) { (assignedTo = holds)(() => 1); } return lastTwoAreOne(); }
function throughOrAssignment(first: boolean) { let h: ((f: () => number) => number) | undefined = first ? holds : undefined; let sum = 0; for (let i = 0; i < 2; i++) { sum += (h ||= onlyCalls)(() => 2); } return sum + ":" + held.length + ":" + lastTwoAreOne(); }
function throughNullishAssignment(first: boolean) { let h: ((f: () => number) => number) | undefined = first ? holds : undefined; let sum = 0; for (let i = 0; i < 2; i++) { sum += (h ??= onlyCalls)(() => 3); } return sum + ":" + held.length + ":" + lastTwoAreOne(); }
namespace Local { function holdsToo(f: () => number) { held.push(f); return f(); } export function run() { for (let i = 0; i < 2; i++) { holdsToo(() => 4); } return lastTwoAreOne(); } }
namespace Stored { let h = onlyCalls; export function set() { h = holds; } export function run() { let sum = 0; for (let i = 0; i < 2; i++) { sum += h(() => 5); } return sum + ":" + held.length + ":" + lastTwoAreOne(); } }
console.log(throughAssignment(), throughOrAssignment(true), throughOrAssignment(false), throughNullishAssignment(true), throughNullishAssignment(false));
console.log(Local.run(), Stored.run(), (Stored.set(), Stored.run()));

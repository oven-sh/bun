// A closure made anew in the callback of map binds what that turn handed it.
type Bound = () => (less: number) => number;
type Made = () => () => number;
function list(n: number): number[] { const all: number[] = []; for (let at = 0; at < n; at++) all.push(at + 4); return all; }
function makesBound(n: number): Bound[] { const made: Bound[] = []; made.push(...list(n).map(each => (() => ((more: number, less: number) => more * 10 + less).bind(null, each)))); return made; }
function readsBound(made: Bound[]): string { const seen: unknown[] = []; for (const thing of made) for (let again = 0; again < 2; again++) seen.push(({ held: thing() }).held(1)); return seen.join(); }
function sumsBound(made: Bound[]): number { let sum = 0; for (const thing of made) sum += ({ held: thing() }).held(1); return sum; }
function makes(n: number): Made[] { const made: Made[] = []; for (const each of list(n)) made.push(function () { return function () { return each; }; }); return made; }
function reads(made: Made[]): string { const seen: unknown[] = []; for (let round = 0; round < 2; round++) for (const thing of made) seen.push(({ held: thing() }).held()); return seen.join(); }
function once(n: number) { return [readsBound(makesBound(n)), sumsBound(makesBound(n)), reads(makes(n))].join(" | "); }
console.log(once(3));
const said = new Set<string>();
for (let turn = 0; turn < 200; turn++) said.add(once(3 + (turn % 2)));
console.log([...said].join(" ; "));

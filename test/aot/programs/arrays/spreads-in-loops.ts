// Spreads into array literals and argument lists inside loops: records, numbers, strings; sources with holes, frozen, of a subclass, with an iterator of their own, sparse, empty, and iterables that are no arrays.
declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public n: number) {} }
function joinRecs(a: Rec[], b: Rec[], extra: Rec): Rec[] { let out: Rec[] = []; for (let i = 0; i < 3; i++) out = [extra, ...a, ...b, extra, ...out.slice(0, 2)]; return out; }
function joinNumbers(a: number[], b: number[]): number[] { let out: number[] = []; for (let i = 0; i < 3; i++) out = [...a, i, ...b, 0.5, ...out.slice(0, 1)]; return out; }
function joinTexts(a: string[], b: Iterable<string>): string[] { let out: string[] = []; for (let i = 0; i < 2; i++) out = ["<", ...a, ...b, ">"]; return out; }
function total(...values: number[]): number { let t = 0; for (const v of values) t += v; return t; }
function callWith(a: number[], b: number[]): number { let t = 0; for (let i = 0; i < 3; i++) t += total(...a, i, ...b); return t; }
function show(a: readonly unknown[]): string { return a.length + ":" + a.map(v => v instanceof Rec ? "R" + v.n : v === undefined ? "undefined" : String(v)).join(","); }
const recs = [new Rec(1), new Rec(2)]; const holes = [new Rec(1), , new Rec(3)] as Rec[]; const frozen = Object.freeze([new Rec(7)]) as Rec[];
class Recs extends Array<Rec> {} const derived = new Recs(); derived.push(new Rec(21));
class Odd extends Array<Rec> { *[Symbol.iterator](): ArrayIterator<Rec> { yield new Rec(99); } } const odd = new Odd(); odd.push(new Rec(1), new Rec(2));
const sparse: Rec[] = []; sparse[12] = new Rec(12);
for (let round = 0; round < 2; round++) {
    for (const a of [recs, holes, frozen, derived, odd, sparse, []]) console.log(show(joinRecs(a, recs, new Rec(0))), show(joinRecs(recs, a, new Rec(0))));
    for (const a of [[1, 2, 3], [0.5, 1.5], [1, , 3] as number[], [0.5, , 2.5] as number[], [NaN, -0], JSON.parse("[4,5,6.5]") as number[], []]) console.log(show(joinNumbers(a, [7, 8])), show(joinNumbers([0.25], a)), callWith(a, [1]), callWith([2.5], a));
    console.log(show(joinTexts(["a", "b"], new Set(["x", "y"]))), show(joinTexts([], "héllo")), show(joinTexts(["q"], ["r", "s"].values())), show(joinTexts(["q"], new Map([["k", 1]]).keys())));
}

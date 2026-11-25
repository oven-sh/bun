// A list gets the room that a loop will fill in front of the loop. Nothing of that may be seen: not by the length, not by the keys, not by a list that refuses what is stored, not by a bound that is no whole number.
declare const console: { log(...values: unknown[]): void };
function fill(list: unknown[], n: number): unknown[] { for (let i = 0; i < n; i++) list[i] = i; return list; }
function fillWithHalves(list: number[], n: number): number[] { for (let i = 0; i < n; i++) list[i] = i + 0.5; return list; }
function fillWithWords(list: string[], n: number): string[] { for (let i = 0; i < n; i++) list[i] = "w" + i; return list; }
function fillTwo(first: number[], second: number[], n: number): number { for (let i = 0; i < n; i++) { first[i] = i; second[i] = -i; } return first.length + second.length; }
function fillAndThrow(list: number[], n: number, at: number): string { try { for (let i = 0; i < n; i++) { if (i === at) throw new RangeError("at " + i); list[i] = i; } } catch (error) { return (error as Error).message + " " + list.length; } return "filled " + list.length; }
function tell(name: string, list: unknown): void {
    const made = list as unknown[];
    console.log(name + ": " + JSON.stringify(made.length > 12 ? [made.length, made[0], made[made.length - 1]] : made) + " " + made.length + " " + Object.keys(made).length);
}
class Shelf extends Array<unknown> { label = "shelf"; }
function attempt(name: string, make: () => unknown): void {
    try { tell(name, make()); } catch (error) { console.log(name + ": " + (error as Error).name); }
}
for (const n of [0, 1, 2, 5, 6, 16, 60, 1000, 1001, 70000, -1, -0, 2.5, 0.1, NaN, -Infinity]) {
    attempt("new " + n, () => fill([], n));
    attempt("halves " + n, () => fillWithHalves([], n));
    attempt("words " + n, () => fillWithWords([], n));
}
attempt("a literal with elements", () => fill([7, 8, 9], 8));
attempt("a longer list", () => fill([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4));
attempt("a list with holes", () => fill([, , 3, , 5], 9));
attempt("a list with a length", () => fill(new Array(40), 9));
attempt("a list with a great length", () => { const list: unknown[] = []; list.length = 4000000000; return fill(list, 9).slice(0, 10); });
attempt("a list with a far element", () => { const list: unknown[] = []; list[100000] = 1; return fill(list, 9).slice(0, 10); });
attempt("halves into whole numbers", () => fillWithHalves([1, 2, 3], 20));
attempt("whole numbers into halves", () => fill([0.5, 1.5], 20));
attempt("numbers into words", () => fill(["a", "b"], 20));
attempt("a frozen list", () => fill(Object.freeze([1, 2]) as unknown[], 9));
attempt("a sealed list", () => fill(Object.seal([1, 2]), 9));
attempt("a list that takes no more", () => fill(Object.preventExtensions([1, 2]), 9));
attempt("a list whose length is fixed", () => fill(Object.defineProperty([1, 2], "length", { writable: false }), 9));
attempt("a list with a setter", () => { let seen = 0; const list: unknown[] = []; Object.defineProperty(list, 3, { set(value) { seen += value as number; }, get() { return seen; }, enumerable: true, configurable: true }); return fill(list, 9); });
attempt("a list of a class", () => { const shelf = fill(new Shelf(), 20) as Shelf; return [shelf.label, shelf.length, shelf instanceof Shelf, shelf[19]]; });
attempt("a list with names", () => { const list: unknown[] & { note?: string } = []; list.note = "kept"; fill(list, 30); return [list.note, list.length]; });
attempt("the same list twice", () => { const list: number[] = []; return [fillTwo(list, list, 12), list[11]]; });
attempt("two lists", () => { const first: number[] = [], second: number[] = []; return [fillTwo(first, second, 33), first[32], second[32]]; });
console.log(fillAndThrow([], 50, 3), fillAndThrow([], 50, 0), fillAndThrow([], 3, 50), fillAndThrow([1, 2, 3, 4, 5, 6], 5000, 2));
let kept: unknown[] = [];
for (let round = 0; round < 2000; round++) { const list = fill([], round % 70); if (round % 67 === 0) kept.push(list.length, list[list.length - 1]); }
console.log(JSON.stringify(kept));

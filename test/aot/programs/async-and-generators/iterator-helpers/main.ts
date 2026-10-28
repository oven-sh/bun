// The helpers of iterators share three names with the methods of arrays: map, filter, flatMap. What they yield is an iterator, whatever a method of that name yields on an array. Every helper on every kind of iterator, in functions, arrows and methods, through types and through `any`, and in a file without types.
import { untyped } from "./untyped.js";
function* counting(upTo: number): Generator<number, void, unknown> { for (let i = 1; i <= upTo; i++) yield i; }
class Countdown extends Iterator<number> {
  constructor(private left: number) { super(); }
  next(): IteratorResult<number, undefined> { return this.left > 0 ? { done: false, value: this.left-- } : { done: true, value: undefined }; }
}
const sources: [string, () => IteratorObject<number, unknown, unknown>][] = [
  ["of an array", () => [1, 2, 3].values()],
  ["keys of an array", () => [7, 8, 9].keys()],
  ["keys of a map", () => new Map([[1, "a"], [2, "b"], [3, "c"]]).keys()],
  ["values of a set", () => new Set([1, 2, 3]).values()],
  ["a generator", () => counting(3)],
  ["an heir of Iterator", () => new Countdown(3)],
  ["Iterator.from", () => Iterator.from({ next() { return { done: true, value: undefined }; } } as Iterator<number>)],
  ["a helper", () => [1, 2, 3].values().take(3)],
];
function mapped(it: IteratorObject<number, unknown, unknown>): number[] { return it.map(x => x + 1).toArray(); }
function filtered(it: IteratorObject<number, unknown, unknown>): number[] { return it.filter(x => x > 1).toArray(); }
function flattened(it: IteratorObject<number, unknown, unknown>): number[] { return it.flatMap(x => [x, x]).toArray(); }
function taken(it: IteratorObject<number, unknown, unknown>): number[] { return it.take(2).toArray(); }
function dropped(it: IteratorObject<number, unknown, unknown>): number[] { return it.drop(1).toArray(); }
function asked(it: () => IteratorObject<number, unknown, unknown>): unknown[] { return [it().reduce((sum, x) => sum + x, 0), it().some(x => x > 1), it().every(x => x > 1), it().find(x => x > 1)]; }
function visited(it: IteratorObject<number, unknown, unknown>): number { let total = 0; it.forEach(x => { total += x; }); return total; }
function chained(it: IteratorObject<number, unknown, unknown>): string[] { return it.map(x => x * 2).filter(x => x > 2).flatMap(x => [x]).map(x => "n" + x).toArray(); }
function stepped(it: IteratorObject<number, unknown, unknown>): unknown { const next = it.map(x => x + 1); return next.next().value; }
function looped(it: IteratorObject<number, unknown, unknown>): number { let total = 0; for (const x of it.filter(x => x !== 2)) total += x; return total; }
function spread(it: IteratorObject<number, unknown, unknown>): number[] { return [...it.flatMap(x => [x + 0.5])]; }
function copied(it: IteratorObject<number, unknown, unknown>): number[] { return Array.from(it.map(x => -x)); }
function described(it: IteratorObject<number, unknown, unknown>): string { const made = it.map(x => x); return typeof made + " " + Array.isArray(made) + " " + Object.prototype.toString.call(made); }
const byArrow = (it: IteratorObject<number, unknown, unknown>): number[] => it.map(x => x + 10).toArray();
class Holder { constructor(private make: () => IteratorObject<number, unknown, unknown>) {} all(): number[] { return this.make().filter(() => true).toArray(); } }
function throughAny(it: any): unknown { return it.map((x: number) => x + 1).toArray(); }
function names(m: Map<string, number>): string[] { return m.keys().map(k => k + "!").toArray(); }
function ofGenerator(g: Generator<number, void, unknown>): number[] { return g.map(x => x * x).toArray(); }
function ofArrayIterator(a: ArrayIterator<number>): number[] { return a.flatMap(x => [x, -x]).toArray(); }
function ofArray(a: number[]): number[] { return a.map(x => x + 1).filter(x => x > 2).flatMap(x => [x, x]); }
function show(name: string, make: () => IteratorObject<number, unknown, unknown>): void {
  console.log(name, JSON.stringify([mapped(make()), filtered(make()), flattened(make()), taken(make()), dropped(make()), asked(make), visited(make()), chained(make())]));
  console.log(name, JSON.stringify([stepped(make()), looped(make()), spread(make()), copied(make()), described(make()), byArrow(make()), new Holder(make).all(), throughAny(make())]));
  console.log(name, JSON.stringify(untyped(make)));
}
show(...sources[0]); show(...sources[1]); show(...sources[2]); show(...sources[3]); show(...sources[4]); show(...sources[5]); show(...sources[6]); show(...sources[7]);
console.log(JSON.stringify([names(new Map([["a", 1]])), ofGenerator(counting(3)), ofArrayIterator([1, 2].values()), ofArray([1, 2, 3])]));

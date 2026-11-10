// `constructor` laid on a plain list names a species: what map, filter, slice, concat, splice, flat and flatMap make of that list is of a class below Array, whose getter `undefined` gets it as `this` and writes a text into a field of numbers.
// The records are made by the callback, so they are in no list that went out of sight before.
class Arc { cap: number; constructor(cap: number) { this.cap = cap; } }
class Below<T> extends Array<T> { get undefined(): number { const first: unknown = this[0]; if (first instanceof Arc) (first as unknown as { cap: unknown }).cap = "text"; return this.length; } }
const none: number[] = [];
function withSpecies<T>(list: T[]): T[] { (list as unknown as { constructor: unknown }).constructor = { [Symbol.species]: Below }; return list; }
function look(arcs: Arc[]): string { const found: unknown = arcs[none.pop()!]; let s = 0; for (let i = 0; i < arcs.length; i++) s += arcs[i]!.cap; return String(found) + " " + String(s); }
console.log(look(withSpecies([1, 2]).map(n => new Arc(n))));
console.log(look(withSpecies([3, 4]).flatMap(n => [new Arc(n)])));
console.log(look([5, 6].map(n => new Arc(n))));

// Holes, stored lengths, distant indexes, properties, parsed data and changes during iteration are as in plain Bun. A string stored through `any` into a `number[]` throws a TypeError where typed code reads that element.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { n: number };
row("holes", () => { const a: (number | undefined)[] = [1, , 3]; return a.length + " " + (1 in a) + " " + a[1] + " " + JSON.stringify(a) + " " + Object.keys(a).join() + " " + a.map(x => 1).length });
row("length stored", () => { const a = [1, 2, 3]; a.length = 1; a.length = 3; return JSON.stringify(a) + " " + (2 in a) });
row("a store far beyond the end", () => { const a: number[] = [1]; a[100000] = 2; return a.length + " " + Object.keys(a).length + " " + a[50000] });
row("a negative and a fractional index through any", () => { const a: number[] = [1]; hide(a)[-1] = 5; hide(a)[1.5] = 6; return a.length + " " + Object.keys(a).join() + " " + hide(a)[-1] });
row("a property on an array", () => { const a: number[] = [1]; hide(a).note = "n"; return Object.keys(a).join() + " " + JSON.stringify(a) + " " + hide(a).note });
row("another kind stored through any", () => { const a: number[] = [1, 2]; hide(a)[0] = "s"; return typeof a[0] + " " + a.join() });
row("plain data in an array of records: by index", () => { const r = parse('[{"n":1},{"n":2}]'); const a: Item[] = r; a[0].n = 9; return r[0].n + " " + ((a[0] as unknown) === r[0]) });
row("the same by for..of, forEach, map, find, destructuring", () => { const r = parse('[{"n":1},{"n":2}]'); const a: Item[] = r; let s = 0; for (const x of a) s += x.n; a.forEach(x => { s += x.n }); s += a.map(x => x.n).length; s += a.find(x => x.n === 2)!.n; const [first] = a; return s + first.n });
row("sort, reverse, splice, copyWithin, fill, flat", () => { const a = [3, 1, 2]; a.sort(); a.reverse(); a.splice(1, 1, 7, 8); return a.join() + " " + [1, 2, 3, 4].copyWithin(0, 2).join() + " " + new Array<number>(3).fill(1).join() + " " + [[1], [2, [3]]].flat(2).join() });
row("sort without a comparator sorts by text", () => [10, 9, 1].sort().join() + " " + [undefined, 3, , 1].sort().length);
row("Array.from, of, isArray, concat with a spreadable", () => { const s: any = { length: 1, 0: "x", [Symbol.isConcatSpreadable]: true }; return Array.from({ length: 2 }, (_, k) => k).join() + " " + Array.of(7).join() + " " + hide([1]).concat(s).join() });
row("changed while it is iterated", () => { const a = [1, 2, 3]; const out: number[] = []; for (const x of a) { out.push(x); if (x === 1) a.push(4); if (x === 2) a.shift() } return out.join() });
row("array-likes handed to array methods", () => Array.prototype.map.call(hide({ length: 2, 0: 1, 1: 2 }), (x: number) => x * 2).join() + " " + Array.prototype.join.call(hide("abc"), "-"));

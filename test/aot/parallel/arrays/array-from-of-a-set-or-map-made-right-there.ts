// Array.from of a Set or a Map made right there: the order, duplicates, what the constructor throws, subclasses and shadowed names.
const out: string[] = [];
const show = (label: string, make: () => unknown) => { try { out.push(`${label}: ${JSON.stringify(make())}`); } catch (e) { out.push(`${label}: ${(e as Error).constructor.name} ${(e as Error).message}`); } };
function unique(list: number[]): number[] { return Array.from(new Set(list)); }
function pairs(list: [string, number][]): [string, number][] { return Array.from(new Map(list)); }
show("numbers", () => unique([3, 1, 3, 2, 1])); show("none", () => unique([]));
show("objects", () => Array.from(new Set([{ a: 1 }, "b", null, undefined, NaN, NaN, -0, 0])));
show("no argument", () => Array.from(new Set())); show("text", () => Array.from(new Set("hello")));
show("pairs", () => pairs([["a", 1], ["b", 2], ["a", 3]]));
show("refused", () => Array.from(new Set(5 as any))); show("refused map", () => Array.from(new Map([1] as any)));
class MySet extends Set<number> { [Symbol.iterator](): any { return [42][Symbol.iterator](); } }
show("below", () => Array.from(new MySet([1, 2])));
{ const Set = class { [Symbol.iterator]() { return [7][Symbol.iterator](); } }; show("shadowed", () => Array.from(new (Set as any)([1]))); }
{ const Set = function () { return { length: 2, 0: "x", 1: "y" }; }; show("shadowed array-like", () => Array.from(new (Set as any)())); }
const copy = unique([1, 2]); copy.push(3); show("written", () => copy); show("is a list", () => [Array.isArray(copy), Object.getPrototypeOf(copy) === Array.prototype]);
let sum = 0; for (let i = 0; i < 50000; i++) sum += unique([i & 3, 1, 1]).length; show("sum", () => sum);
console.log(out.join("\n"));

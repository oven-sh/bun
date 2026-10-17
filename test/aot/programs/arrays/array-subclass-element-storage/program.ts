// An instance of a class that extends Array keeps its elements the way an array does: by what it is given.
declare const console: { log(...values: unknown[]): void };
declare function describe(value: unknown): string;
class Heir<T> extends Array<T> {}
class HeirOfHeir<T> extends Heir<T> {}
class WithField<T> extends Array<T> { label = "rows"; count = 0; }
class YieldsArrays<T> extends Array<T> { static get [Symbol.species]() { return Array; } }
function kind(list: unknown): string { return /(CopyOnWrite)?ArrayWith\w+/.exec(describe(list))?.[0] ?? "no array"; }
function tell(name: string, list: unknown[]): void { console.log(name + ": " + kind(list) + ", " + list.constructor.name + ", " + list.length + ": " + JSON.stringify(Array.from(list))); }
function filled<L extends unknown[]>(list: L, ...values: unknown[]): L { for (const value of values) list.push(value); return list; }
tell("empty", new Heir<number>());
tell("integers", filled(new Heir<number>(), 1, 2, 3));
tell("numbers", filled(new Heir<number>(), 1.5, 2.5));
tell("integers, then a number", filled(new Heir<number>(), 1, 2.5));
tell("strings", filled(new Heir<string>(), "a", "b"));
tell("integers, then a string", filled(new Heir<unknown>(), 1, "b"));
tell("objects", filled(new Heir<object>(), { a: 1 }, { a: 2 }));
tell("an heir of an heir", filled(new HeirOfHeir<string>(), "a", "b"));
tell("with fields", filled(new WithField<string>(), "a", "b"));
tell("many", filled(new Heir<number>(), ...Array.from({ length: 300 }, (_, i) => i)).slice(298));
tell("a length", new Heir<string>(3));
tell("a length, then stored to", (() => { const list = new Heir<string>(3); list[0] = "a"; list[1] = "b"; list[2] = "c"; return list; })());
tell("values", new Heir<string>("a", "b", "c"));
tell("stored at the length", (() => { const list = new Heir<string>(); for (let i = 0; i < 5; i++) list[i] = "s" + i; return list; })());
tell("of", Heir.of("a", "b", "c"));
tell("of integers", Heir.of(1, 2, 3));
tell("from an array", Heir.from(["a", "b", "c"]));
tell("from a set", Heir.from(new Set([1, 2, 3])));
tell("from what is like an array", Heir.from({ length: 2, 0: "a", 1: "b" }));
tell("Reflect.construct", Reflect.construct(Array, ["a", "b"], Heir));
const strings = filled(new Heir<string>(), "a", "b", "c", "d");
tell("map", strings.map(x => x + "!"));
tell("map to integers", strings.map(x => x.length));
tell("filter", strings.filter(x => x !== "b"));
tell("slice", strings.slice(1));
tell("concat", strings.concat(["e"], strings));
tell("splice", filled(new Heir<string>(), "a", "b", "c", "d").splice(1, 2));
tell("flat", filled(new Heir<unknown>(), ["a"], ["b", "c"]).flat());
tell("flatMap", strings.flatMap(x => [x, x]));
const plainly = filled(new YieldsArrays<string>(), "a", "b", "c", "d");
tell("the species is Array: itself", plainly);
tell("the species is Array: map", plainly.map(x => x + "!"));
tell("the species is Array: filter", plainly.filter(x => x !== "b"));
tell("the species is Array: slice", plainly.slice(1));
tell("popped", (() => { const list = filled(new Heir<string>(), "a", "b", "c"); list.pop(); list.shift(); return list; })());
tell("sorted", filled(new Heir<number>(), 3, 1, 2).sort());
tell("reversed", filled(new Heir<string>(), "a", "b", "c").reverse());
tell("filled", new Heir<number>(4).fill(7));
tell("unshifted", (() => { const list = filled(new Heir<string>(), "b"); list.unshift("a"); return list; })());
tell("shortened", (() => { const list = filled(new Heir<string>(), "a", "b", "c"); list.length = 1; return list; })());

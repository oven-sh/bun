// Stack traces taken inside callbacks that built-in functions call.
declare const console: any;
const names = (e: Error): string => String(e.stack).split("\n").map(l => l.replace(/^\s*at /, "").replace(/[@ (].*$/, "")).filter(n => n !== "" && n !== "Error").join(" < ");
let seen: string[] = [];
function note(): number { if (seen.length < 1) seen.push(names(new Error("here"))); return 0; }
function show(label: string, f: () => unknown): void { seen = []; try { f(); } catch (e: any) { seen.push("thrown: " + names(e)); } console.log(label + ": " + seen.join(" | ")); }
function comparator(a: number, b: number): number { note(); return a - b; }
function visitor(v: number): void { note(); }
function replacer(s: string): string { note(); return s; }
function thrower(a: number, b: number): number { throw new RangeError("from the callback"); }
class Box { get value(): number { return note(); } toString(): string { note(); return "box"; } toJSON(): number { return note(); } }
function outer(f: () => unknown): unknown { return f(); }
show("sort", () => outer(() => [3, 1, 2].sort(comparator)));
show("toSorted", () => outer(() => [3, 1, 2].toSorted(comparator)));
show("typed array sort", () => outer(() => new Int32Array([3, 1, 2]).sort(comparator)));
show("typed array forEach", () => outer(() => new Float64Array([3, 1, 2]).forEach(visitor)));
show("typed array map", () => outer(() => new Float64Array([3, 1, 2]).map(v => note())));
show("replace", () => outer(() => "abc".replace(/b/g, replacer)));
show("replace string", () => outer(() => "abc".replace("b", replacer)));
show("getter", () => outer(() => Reflect.get(new Box(), "value")));
show("toString", () => outer(() => [new Box()].join()));
show("toJSON", () => outer(() => JSON.stringify([new Box()])));
show("reviver", () => outer(() => JSON.parse("[1]", (k: string, v: unknown): unknown => { note(); return v; })));
show("proxy", () => outer(() => new Proxy(comparator, {})(1, 2)));
show("bound", () => outer(() => [2, 1].sort(comparator.bind(null))));
show("set-like", () => outer(() => (new Set([1]) as any).isSubsetOf({ size: 1, has(v: number): boolean { note(); return true; }, keys() { return [1][Symbol.iterator](); } })));
show("iterator", () => outer(() => new Set({ [Symbol.iterator]() { return { next(): { done: boolean; value: number } { note(); return { done: true, value: 0 }; } }; } })));
show("thrown from sort", () => outer(() => [3, 1, 2].sort(thrower)));
show("thrown from a typed array", () => outer(() => new Int32Array([3, 1, 2]).sort(thrower)));
show("nested", () => outer(() => [2, 1].sort((a, b) => { [4, 3].sort(comparator); return a - b; })));
Promise.resolve(1).then(function reaction(v: number): void { seen = []; note(); console.log("reaction: " + seen.join()); });
export {};

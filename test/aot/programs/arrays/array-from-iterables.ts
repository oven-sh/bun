const lines: string[] = [];
function show(value: unknown): string {
    return JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : v instanceof Map ? ["Map", ...v] : v instanceof Set ? ["Set", ...v] : v));
}
function attempt(name: string, run: () => unknown): void {
    let said: string;
    try { const made: any = run(); said = show(made) + (Array.isArray(made) ? " | " + made.length + " " + (Object.getPrototypeOf(made) === Array.prototype) + " " + Object.isExtensible(made) : ""); } catch (e) { said = "THROWS " + (e as Error).constructor.name + ": " + (e as Error).message; }
    lines.push(name + " | " + said);
}
class Heir extends Array<unknown> { }
class MapHeir<K, V> extends Map<K, V> { }
class LoudMap<K, V> extends Map<K, V> { *[Symbol.iterator](): MapIterator<[K, V]> { yield ["loud", "loud"] as any; } }
class SetHeir<T> extends Set<T> { }
const pairs: [unknown, unknown][] = [[1, "x"], ["k", { o: 1 }], [null, undefined], [NaN, -0]];
const makers: [string, () => any][] = [
    ["map", () => new Map(pairs)], ["empty map", () => new Map()], ["large map", () => new Map(Array.from({ length: 40 }, (_, i) => [i, i * 2]))], ["map with deletions", () => { const m = new Map(pairs); m.delete("k"); m.set("z", 1); m.delete(1); return m; }],
    ["heir of Map", () => new MapHeir(pairs)], ["loud map", () => new LoudMap(pairs)], ["map with its own iterator", () => Object.assign(new Map(pairs), { [Symbol.iterator]: function* () { yield "own"; } })], ["map with a property", () => Object.assign(new Map(pairs), { extra: 1 })],
    ["map of another prototype", () => Object.setPrototypeOf(new Map(pairs), { [Symbol.iterator]: function* () { yield "other"; } })], ["map with no iterator", () => Object.setPrototypeOf(new Map(pairs), { length: 1, 0: "like" })],
    ["map entries", () => new Map(pairs).entries()], ["map keys", () => new Map(pairs).keys()], ["map values", () => new Map(pairs).values()], ["map entries, begun", () => { const it = new Map(pairs).entries(); it.next(); return it; }], ["map entries, over", () => { const it = new Map([[1, 2]]).entries(); it.next(); it.next(); return it; }],
    ["map entries with a next of its own", () => Object.assign(new Map(pairs).entries(), { next() { return { done: true, value: 0 }; } })], ["map entries of another prototype", () => Object.setPrototypeOf(new Map(pairs).entries(), { [Symbol.iterator]() { return [7][Symbol.iterator](); } })],
    ["set", () => new Set([1, "a", null])], ["heir of Set", () => new SetHeir([1, 2])], ["set entries", () => new Set([1, "a"]).entries()], ["set values", () => new Set([1, "a"]).values()], ["set entries, begun", () => { const it = new Set([1, 2, 3]).entries(); it.next(); return it; }],
    ["set entries with a return of its own", () => Object.assign(new Set([1]).entries(), { return() { return { }; } })],
    ["text", () => "abc"], ["empty text", () => ""], ["text beyond Latin-1", () => "hé𝒳z\ud800"], ["long text", () => "0123456789".repeat(30)], ["rope", () => "ab".repeat(3) + String(12) + "é"], ["wrapped text", () => new String("abc")], ["wrapped text with a property", () => Object.assign(new String("ab"), { extra: 1 })],
    ["wrapped text with its own iterator", () => Object.assign(new String("ab"), { [Symbol.iterator]: function* () { yield "own"; } })], ["wrapped text of another prototype", () => Object.setPrototypeOf(new String("ab"), { })], ["heir of String", () => new (class extends String { })("ab")],
    ["array", () => [1, , 3]], ["array iterator", () => [1, 2].entries()], ["typed array", () => new Uint8Array([1, 2])], ["generator", () => (function* () { yield 1; yield 2; })()], ["matches", () => "a1b2".matchAll(/\d/g)], ["like", () => ({ length: 2, 0: "x" })], ["number", () => 5], ["symbol", () => Symbol.iterator], ["nothing", () => undefined], ["nil", () => null],
];
const uses: [string, (x: any) => unknown][] = [
    ["from", x => Array.from(x)], ["from, mapped", x => Array.from(x, (v: unknown, i: number) => [i, v])], ["from, undefined for the function", x => (Array.from as any)(x, undefined)], ["from, twice", x => [Array.from(x), Array.from(x)]],
    ["from by call on an heir", x => { const made = (Array.from as any).call(Heir, x); return [made instanceof Heir, [...(made as unknown[])]]; }], ["from by call on nothing", x => (Array.from as any).call(undefined, x)], ["from by call on a plain function", x => { const made: any = (Array.from as any).call(function (this: any) { this.made = true; }, x); return [made.made, made.length, made[0]]; }],
    ["from by call on an arrow", x => (Array.from as any).call(() => 0, x)], ["from, then written", x => { const made = Array.from(x); made.push("more"); made[0] = "first"; return made; }],
];
for (const [kind, make] of makers)
    for (const [use, run] of uses)
        attempt(kind + " | " + use, () => run(make()));
attempt("the pairs are new each time", () => { const m = new Map([[1, 2]]); const a = Array.from(m), b = Array.from(m); return [a[0] === b[0], a[0]]; });
attempt("the pairs may be written", () => { const m = new Map([[1, 2]]); const a = Array.from(m); a[0][1] = 9; a[0].push(3 as any); return [a, m]; });
attempt("the iterator is used up", () => { const it = new Map(pairs).entries(); const a = Array.from(it); return [a.length, it.next(), Array.from(it)]; });
attempt("a map that was gone through meanwhile", () => { const m = new Map(pairs); const out: unknown[] = []; for (const [k] of m) out.push(k, Array.from(m).length); return out; });
console.log(lines.join("\n"));

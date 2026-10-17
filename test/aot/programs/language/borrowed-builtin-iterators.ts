const lines: string[] = [];
function show(value: unknown): string {
    return JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "bigint" ? String(v) : v instanceof Map ? ["Map", ...v] : v instanceof Set ? ["Set", ...v] : v));
}
function attempt(name: string, run: () => unknown): void {
    let said: string;
    try { said = show(run()); } catch (e) { said = "THROWS " + (e as Error).constructor.name + (name.startsWith("what is yielded is no") ? "" : ": " + (e as Error).message); }
    lines.push(name + " | " + said);
}

class Heir extends Array<number> { total(): number { let sum = 0; for (const v of this) sum += v; return sum; } }
class HeirOfHeir extends Heir { }
class Reversed extends Array<number> { *[Symbol.iterator](): ArrayIterator<number> { for (let i = this.length - 1; i >= 0; i--) yield this[i]; } }
class Bag<T> {
    items: T[];
    constructor(items: T[]) { this.items = items; }
    [Symbol.iterator](): Iterator<T> { return this.items[Symbol.iterator](); }
}
class Keys { items = [7, 8, 9]; [Symbol.iterator]() { return this.items.keys(); } }
class Entries { items = ["a", "b"]; [Symbol.iterator]() { return this.items.entries(); } }
class OfMap { map = new Map([[1, "x"], [2, "y"]]); [Symbol.iterator]() { return this.map[Symbol.iterator](); } }
class OfMapKeys { map = new Map([[1, "x"], [2, "y"]]); [Symbol.iterator]() { return this.map.keys(); } }
class OfMapValues { map = new Map([[1, "x"], [2, "y"]]); [Symbol.iterator]() { return this.map.values(); } }
class OfSet { set = new Set(["p", "q"]); [Symbol.iterator]() { return this.set.values(); } }
class OfSetEntries { set = new Set(["p", "q"]); [Symbol.iterator]() { return this.set.entries(); } }
class OfMatches { [Symbol.iterator]() { return "a1b22c333".matchAll(/\d+/g); } }
class OfGenerator { *[Symbol.iterator]() { yield 1; yield 2; yield 3; } }
class OfText { [Symbol.iterator]() { return "hé𝒳"[Symbol.iterator](); } }
class OfTypedArray { [Symbol.iterator]() { return new Uint8Array([4, 5, 6])[Symbol.iterator](); } }
class OfArguments { [Symbol.iterator]() { return (function (..._: number[]) { return arguments; })(1, 2, 3)[Symbol.iterator](); } }

const makers: [string, () => any][] = [
    ["heir", () => Heir.from([1, 2, 3])], ["heir of heir", () => HeirOfHeir.from([4, 5])], ["empty heir", () => new Heir()], ["heir with a hole", () => { const h = Heir.from([1, 2, 3]); delete h[1]; return h; }],
    ["reversed", () => Reversed.from([1, 2, 3])], ["bag", () => new Bag([1, 2, 3])], ["bag of texts", () => new Bag(["a", "b"])], ["bag of a heir", () => new Bag(Heir.from([6, 7]))], ["keys", () => new Keys()], ["entries", () => new Entries()],
    ["map", () => new OfMap()], ["map keys", () => new OfMapKeys()], ["map values", () => new OfMapValues()], ["set", () => new OfSet()], ["set entries", () => new OfSetEntries()],
    ["matches", () => new OfMatches()], ["generator", () => new OfGenerator()], ["text", () => new OfText()], ["typed array", () => new OfTypedArray()], ["arguments", () => new OfArguments()],
    ["another prototype", () => Object.setPrototypeOf([1, 2, 3], Object.create(Array.prototype))], ["array-like with values", () => ({ length: 2, 0: "x", 1: "y", [Symbol.iterator]: Array.prototype.values })],
    ["array-like with a getter for length", () => { const seen: string[] = []; return { seen, get length() { seen.push("length"); return 2; }, 0: "x", 1: "y", [Symbol.iterator]: Array.prototype.values }; }],
    ["own values on an array", () => Object.assign([1, 2], { [Symbol.iterator]: Array.prototype.values })], ["own keys on an array", () => Object.assign([1, 2], { [Symbol.iterator]: Array.prototype.keys })],
    ["heir with an accessor", () => { const h = Heir.from([1, 2, 3]); Object.defineProperty(h, 1, { get() { return 20; } }); return h; }],
];
const uses: [string, (x: any) => unknown][] = [
    ["for of", x => { const out: unknown[] = []; for (const v of x) out.push(v); return out; }],
    ["for of, left early", x => { const out: unknown[] = []; for (const v of x) { out.push(v); if (out.length === 2) break; } return out; }],
    ["for of, thrown out of", x => { const out: unknown[] = []; try { for (const v of x) { out.push(v); throw new RangeError("stop"); } } catch (e) { out.push((e as Error).message); } return out; }],
    ["spread", x => [...x]], ["spread into a call", x => Math.max(0, ...[...x].map((v: any) => (typeof v === "number" ? v : 0)))], ["spread twice", x => [...x, ...x]],
    ["take two", x => { const [a, b] = x; return [a, b]; }], ["take five", x => { const [a, b, c, d, e] = x; return [a, b, c, d, e]; }], ["take one and the rest", x => { const [a, ...rest] = x; return [a, rest]; }], ["take none", x => { const [] = x; return "taken"; }],
    ["Array.from", x => Array.from(x)], ["new Set", x => [...new Set(x)]], ["yield*", x => [...(function* () { yield* x; })()]], ["Promise.all shape", x => Array.from(x, (v: unknown) => [v])],
    ["nested", x => { const out: unknown[] = []; for (const a of x) for (const b of x) out.push([a, b]); return out.length; }],
];
for (const [kind, make] of makers)
    for (const [use, run] of uses)
        attempt(kind + " | " + use, () => { const x = make(); const result = run(x); return x.seen ? [result, x.seen] : result; });

attempt("the method of a heir", () => (Heir.from([1, 2, 3]) as Heir).total());
attempt("what is yielded is no iterator: a Map", () => { const out: unknown[] = []; for (const v of { [Symbol.iterator]() { return new Map([[1, 2]]); } } as any) out.push(v); return out; });
attempt("what is yielded is no iterator: a Set", () => [...({ [Symbol.iterator]() { return new Set([1]); } } as any)]);
attempt("what is yielded is no iterator: an array", () => [...({ [Symbol.iterator]() { return [1, 2]; } } as any)]);
attempt("what is yielded is no iterator: a typed array", () => { const [a] = { [Symbol.iterator]() { return new Uint8Array(2); } } as any; return a; });
attempt("what is yielded is no iterator: a text", () => [...({ [Symbol.iterator]() { return "ab"; } } as any)]);
attempt("what is yielded is no object", () => [...({ [Symbol.iterator]() { return 5; } } as any)]);
attempt("an iterator with a next of its own", () => { const it: any = [1, 2, 3].values(); let n = 0; it.next = () => ({ done: n++ > 1, value: "mine" }); return [...({ [Symbol.iterator]() { return it; } } as any)]; });
attempt("an iterator with a return of its own", () => { const said: string[] = []; const it: any = [1, 2, 3].values(); it.return = () => { said.push("returned"); return { }; }; for (const v of { [Symbol.iterator]() { return it; } } as any) { said.push(String(v)); break; } return said; });
attempt("an iterator given a next while it is gone through", () => { const it: any = [1, 2, 3].values(); const out: unknown[] = []; for (const v of { [Symbol.iterator]() { return it; } } as any) { out.push(v); it.next = () => ({ done: true, value: undefined }); } return out; });
attempt("an iterator stepped by hand as well", () => { const it = [1, 2, 3, 4, 5].values(); const out: unknown[] = []; for (const v of { [Symbol.iterator]() { return it; } } as any) { out.push(v); out.push(it.next().value); } return [out, it.next()]; });
attempt("an iterator begun beforehand", () => { const it = [1, 2, 3].values(); it.next(); return [...({ [Symbol.iterator]() { return it; } } as any)]; });
attempt("an iterator that is over", () => { const it = [1].values(); it.next(); it.next(); return [...({ [Symbol.iterator]() { return it; } } as any)]; });
attempt("one iterator, gone through twice", () => { const it = [1, 2, 3].values(); const x: any = { [Symbol.iterator]() { return it; } }; const [a] = x; return [a, [...x], [...x]]; });
attempt("an iterator of another prototype", () => { const it = [1, 2].values(); Object.setPrototypeOf(it, { next() { return { done: true, value: 0 }; } }); return [...({ [Symbol.iterator]() { return it; } } as any)]; });
attempt("an iterator with no prototype", () => { const it = [1, 2].values(); Object.setPrototypeOf(it, null); return [...({ [Symbol.iterator]() { return it; } } as any)]; });
attempt("a heir that grows while it is gone through", () => { const h = Heir.from([1, 2]); const out: number[] = []; for (const v of h) { out.push(v); if (h.length < 5) h.push(v * 10); } return out; });
attempt("a heir that shrinks while it is gone through", () => { const h = Heir.from([1, 2, 3, 4]); const out: number[] = []; for (const v of h) { out.push(v); h.pop(); } return out; });
attempt("a heir that is over and grows", () => { const h = Heir.from([1]); const it = h[Symbol.iterator](); const out = [it.next(), it.next()]; h.push(2); out.push(it.next()); return out; });
attempt("a map that grows while it is gone through", () => { const o = new OfMap(); const out: unknown[] = []; for (const [k] of o as any) { out.push(k); if (k < 4) o.map.set(k + 2, "z"); } return out; });
attempt("a generator left early runs its finally", () => { const said: string[] = []; const x = { *[Symbol.iterator]() { try { yield 1; yield 2; } finally { said.push("finally"); } } }; for (const v of x) { said.push(String(v)); break; } return said; });
attempt("a generator that throws", () => { const x = { *[Symbol.iterator]() { yield 1; throw new RangeError("inside"); } }; return [...x]; });
attempt("the method is read once and called once", () => { const said: string[] = []; const x = { get [Symbol.iterator]() { said.push("read"); return function (this: unknown) { said.push("called"); return [1, 2].values(); }; } }; return [[...x], said]; });
attempt("the method is Array.prototype.values on a number's wrapper", () => [...(Object.assign(Object(5), { length: 1, 0: "n", [Symbol.iterator]: Array.prototype.values }) as any)]);
attempt("a proxy of an array", () => { const said: string[] = []; const p = new Proxy([1, 2], { get(t, k, r) { said.push(String(k)); return Reflect.get(t, k, r); } }); return [[...p], said]; });
attempt("a proxy of a heir", () => { const said: string[] = []; const p = new Proxy(Heir.from([1]), { get(t, k, r) { said.push(String(k)); return Reflect.get(t, k, r); } }); const out: number[] = []; for (const v of p) out.push(v); return [out, said]; });
console.log(lines.join("\n"));

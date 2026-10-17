const lines: string[] = [];
function show(value: unknown): string { return JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : v)); }
function attempt(name: string, run: () => unknown): void {
    let said: string;
    try { said = show(run()); } catch (e) { said = "THROWS " + (e as Error).constructor.name + ": " + (e as Error).message; }
    lines.push(name + " | " + said);
}
function hide(value: unknown): any { return value; }
class WithLength { length = 2; }
class WithGetter { get length() { return 2; } }
interface Like { length: number; extra?: string }
const said: string[] = [];
const makers: [string, () => any][] = [
    ["a record", () => ({ length: 3 })], ["a typed record", (): Like => ({ length: 2 })], ["a record with more fields", () => ({ length: 2, extra: "e", other: 1 })], ["no length", () => ({ size: 2 })], ["length zero", () => ({ length: 0 })],
    ["length a fraction", () => ({ length: 2.7 })], ["length negative", () => ({ length: -1 })], ["length a text", () => ({ length: "2" })], ["length NaN", () => ({ length: NaN })], ["length an object", () => ({ length: { valueOf() { said.push("valueOf"); return 2; } } })],
    ["length undefined", () => ({ length: undefined })], ["length too large", () => ({ length: 2 ** 32 })], ["a getter for length", () => ({ get length() { said.push("length"); return 2; } })],
    ["elements in the literal", () => ({ length: 2, 0: "x", 1: "y" })], ["an element given later", () => { const o = hide({ length: 2 }); o[1] = "later"; return o; }], ["a named property given later", () => { const o = hide({ length: 2 }); o.more = 1; return o; }],
    ["an iterator given later", () => { const o = hide({ length: 2 }); o[Symbol.iterator] = function* () { yield "iterated"; }; return o; }], ["an iterator in the literal", () => ({ length: 2, *[Symbol.iterator]() { yield "iterated"; } })],
    ["an iterator that is undefined", () => ({ length: 2, [Symbol.iterator]: undefined })], ["an iterator that is null, given later", () => { const o = hide({ length: 2 }); o[Symbol.iterator] = null; return o; }], ["an iterator that is no function", () => { const o = hide({ length: 2 }); o[Symbol.iterator] = 5; return o; }],
    ["another prototype with elements", () => Object.setPrototypeOf({ length: 2 }, { 0: "inherited" })], ["another prototype with an iterator", () => Object.setPrototypeOf({ length: 2 }, { *[Symbol.iterator]() { yield "inherited"; } })], ["no prototype", () => Object.setPrototypeOf({ length: 2 }, null)],
    ["made with a prototype", () => Object.assign(Object.create({ 1: "inherited" }), { length: 2 })], ["frozen", () => Object.freeze({ length: 2 })], ["sealed", () => Object.seal({ length: 2 })], ["an instance", () => new WithLength()], ["an instance with a getter", () => new WithGetter()],
    ["parsed", () => JSON.parse('{"length":2}')], ["parsed with elements", () => JSON.parse('{"length":2,"0":"p"}')], ["a function", () => function (a: unknown, b: unknown) { return [a, b]; }], ["a proxy of a record", () => new Proxy({ length: 2 }, { get(t, k, r) { said.push(String(k)); return Reflect.get(t, k, r); } })],
    ["length deleted", () => { const o = hide({ length: 2 }); delete o.length; return o; }], ["length redefined as a getter", () => Object.defineProperty({ length: 2 }, "length", { get() { said.push("redefined"); return 1; } })],
];
function plainly(x: any): unknown { return Array.from(x); }
function mapped(x: any): unknown { return Array.from(x, (v: unknown, i: number) => [i, v]); }
function mappedWithThis(x: any): unknown { return Array.from(x, function (this: { k: number }, v: unknown, i: number) { return [this.k, i, v]; }, { k: 7 }); }
function typedMapped(x: ArrayLike<unknown>): unknown { return Array.from(x, (v, i) => [i, v]); }
function inLoop(x: any): unknown { let last: unknown; for (let r = 0; r < 3; r++) last = Array.from(x, (v: unknown, i: number) => i + r); return last; }
const uses: [string, (x: any) => unknown][] = [["plainly", plainly], ["mapped", mapped], ["mapped with this", mappedWithThis], ["typed, mapped", typedMapped], ["in a loop", inLoop]];
for (const [kind, make] of makers)
    for (const [use, run] of uses)
        attempt(kind + " | " + use, () => { said.length = 0; const result = run(make()); return said.length ? [result, said.slice()] : result; });
const changes: [string, (o: any, i: number) => void][] = [
    ["gives an element", (o, i) => { o[i + 1] = "given " + i; }], ["gives an iterator", o => { o[Symbol.iterator] = function* () { yield "late"; }; }], ["changes the length", o => { o.length = 1; }], ["grows the length", o => { o.length = 9; }],
    ["changes the prototype", o => { Object.setPrototypeOf(o, { 2: "from the prototype" }); }], ["gives a named property", o => { o.named = 1; }], ["freezes", o => { Object.freeze(o); }], ["deletes the length", o => { delete o.length; }], ["throws", () => { throw new RangeError("from the function"); }],
];
for (const [what, change] of changes) {
    attempt("the function " + what, () => { const o = hide({ length: 4 }); return [Array.from(o, (v: unknown, i: number) => { if (i === 1) change(o, i); return [i, v]; }), Object.keys(o)]; });
    attempt("the function " + what + ", at the site", () => { let o: any; return Array.from(o = hide({ length: 4 }), (v: unknown, i: number) => { if (i === 1) change(o, i); return [i, v]; }); });
}
attempt("the literal at the site", () => Array.from({ length: 3 }, (_, i) => i * 2));
attempt("the literal at the site, no function", () => Array.from({ length: 3 }));
attempt("the function is no function", () => (Array.from as any)({ length: 2 }, 5));
attempt("the function is null", () => (Array.from as any)({ length: 2 }, null));
attempt("results of several kinds", () => Array.from({ length: 5 }, (_, i) => [1, 1.5, "s", null, undefined][i]));
attempt("many", () => { const made = Array.from({ length: 5000 }, (_, i) => i); return [made.length, made[4999]]; });
attempt("by call on an heir", () => { class Heir extends Array<unknown> { } const made = (Array.from as any).call(Heir, hide({ length: 2 }), (_: unknown, i: number) => i); return [made instanceof Heir, made.length, made[1]]; });
console.log(lines.join("\n"));

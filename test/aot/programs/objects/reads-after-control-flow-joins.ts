// A field, a variable of a closure or of the module that is read, stored to on one way only, and read again behind the join: lazy getters of every kind, with aliases, loops, exceptions and getters in between.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value); }
class Sym { id!: number; a!: number; b!: number; c!: number; d!: number; e!: number; f!: number; g!: number; }
class Links { type: string | undefined = undefined; count = 0.5; other: Links | undefined = undefined; list: number[] | undefined = undefined; }
let nextId = 1;
function makeSym(): Sym { const s = new Sym(); s.id = 0; s.a = 1; s.b = 2; s.c = 3; s.d = 4; s.e = 5; s.f = 6; s.g = 7; return s; }
function idOf(s: Sym): number { if (!s.id) { s.id = nextId; nextId++; } return s.id; }
function idOfOdd(s: Sym, odd: number): number { if (!s.id) s.id = odd; return s.id; }
function typeOf(l: Links, make: () => string): string { if (!l.type) l.type = make(); return l.type; }
function typeOrNothing(l: Links, really: boolean): string | undefined { if (l.type === undefined && really) l.type = "made"; return l.type; }
function listOf(l: Links): number[] { if (l.list === undefined) l.list = []; l.list.push(l.list.length); return l.list; }
function throughAlias(a: Links, b: Links, store: boolean): string { const before = a.count; if (store) b.count = 7.25; return before + "/" + a.count + "/" + b.count; }
function bothWaysStore(l: Links, which: boolean): number { if (which) l.count = 1.5; else l.count = 2.5; return l.count; }
function threeWays(l: Links, which: number): number { const before = l.count; if (which === 1) l.count = 10; else if (which === 2) l.count = before + 0.25; return l.count + before; }
function callOnOneWay(l: Links, touch: ((l: Links) => void) | undefined): number { const before = l.count; if (touch) touch(l); return l.count - before; }
function storeThenCall(l: Links, touch: (l: Links) => void, store: boolean): number { const before = l.count; if (store) { l.count = 3; touch(l); } return l.count + before; }
function inLoop(l: Links, n: number): number { let total = 0; for (let i = 0; i < n; i++) { if (l.count > 3) l.count = 0.5; total += l.count; l.count += 1; } return total; }
function withThrow(l: Links, fail: boolean): string { const before = l.count; try { if (fail) { l.count = 9; throw new Error("stop"); } } catch { l.count += 1; } return before + ":" + l.count; }
function chain(l: Links): number { if (!l.other) l.other = new Links(); if (!l.other.other) l.other.other = l; return l.other.other.count + l.other.count; }
let cached: string | undefined; let hits = 0;
function moduleLazy(): string { if (cached === undefined) { cached = "c" + hits; hits++; } return cached; }
function makeCounter() { let value: number | undefined; let made = 0; return { get(): number { if (value === undefined) { value = 40 + made; made++; } return value; }, drop(): void { value = undefined; } }; }
const withGetter = { n: 0, get lazy(): number { return ++this.n; } };
function getterTwice(o: { lazy: number; n: number }, store: boolean): string { const before = o.lazy; if (store) o.n = 10; return before + "," + o.lazy; }
const table: [string, () => unknown][] = [
    ["idOf", () => { const s = makeSym(), t = makeSym(); return [idOf(s), idOf(s), idOf(t), idOf(s), idOf(t), s.id, t.id]; }],
    ["idOfOdd", () => (JSON.parse("[0, 5, -1, 0.5, -0, 1073741824, -1073741825, 4294967296, 1e21]") as number[]).concat(NaN, Infinity).map(odd => { const s = makeSym(); return show(idOfOdd(s, odd)) + ":" + show(idOfOdd(s, 3)) + ":" + show(s.id); })],
    ["typeOf", () => { const l = new Links(); let made = 0; const make = () => "t" + made++; return [typeOf(l, make), typeOf(l, make), made, typeOf(new Links(), () => ""), typeOf(new Links(), make)]; }],
    ["typeOrNothing", () => { const l = new Links(); return [typeOrNothing(l, false), typeOrNothing(l, true), typeOrNothing(l, false)]; }],
    ["listOf", () => { const l = new Links(); listOf(l); listOf(l); return listOf(l); }],
    ["throughAlias", () => { const a = new Links(), b = new Links(); return [throughAlias(a, b, false), throughAlias(a, b, true), throughAlias(a, a, true), throughAlias(b, b, false)]; }],
    ["bothWaysStore", () => { const l = new Links(); return [bothWaysStore(l, true), bothWaysStore(l, false), l.count]; }],
    ["threeWays", () => [0, 1, 2, 2, 0].map(which => threeWays(shared, which))],
    ["callOnOneWay", () => { const l = new Links(); return [callOnOneWay(l, undefined), callOnOneWay(l, x => { x.count += 2; }), callOnOneWay(l, () => {}), l.count]; }],
    ["storeThenCall", () => { const l = new Links(); return [storeThenCall(l, x => { x.count *= 2; }, true), storeThenCall(l, () => {}, false), storeThenCall(l, () => {}, true)]; }],
    ["inLoop", () => [inLoop(new Links(), 0), inLoop(new Links(), 1), inLoop(new Links(), 9)]],
    ["withThrow", () => { const l = new Links(); return [withThrow(l, false), withThrow(l, true), withThrow(l, false)]; }],
    ["chain", () => { const l = new Links(); l.count = 4.5; return [chain(l), chain(l), l.other!.other === l]; }],
    ["moduleLazy", () => { const first = moduleLazy(); const second = moduleLazy(); cached = undefined; return [first, second, moduleLazy(), hits]; }],
    ["closureLazy", () => { const c = makeCounter(); const out = [c.get(), c.get()]; c.drop(); out.push(c.get()); return out; }],
    ["getterTwice", () => [getterTwice(withGetter, false), getterTwice(withGetter, true), withGetter.n]],
];
const shared = new Links();
for (const [name, run] of table) console.log(name, show(run()));

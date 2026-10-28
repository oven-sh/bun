declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public name: string, public n: number) {} say(more: unknown): string { return this.name + this.n + ":" + String(more); } }
let made = 0;
function obj(name: string): Rec { return new Rec(name + "#", ++made); }
function fresh(): Rec[] { return [obj("x"), obj("y"), obj("z")]; }
let sink: unknown[] = [];
function churn(): void { sink = []; for (let i = 0; i < 400; i++) sink.push({ i, s: "g" + i, a: [i, i + 0.5] }); sink = []; }
async function tick(): Promise<void> { churn(); await null; churn(); }
async function later<T>(v: T): Promise<T> { await tick(); return v; }
async function fails(v: unknown): Promise<never> { await tick(); throw v; }
const show = (r: Rec | undefined): string => (r ? r.name + r.n : "-");

async function builder(): Promise<string> { let s = ""; for (let i = 0; i < 40; i++) { s += i; s += ","; if (i % 7 === 0) await tick(); } return s; }
async function builderInside(): Promise<string> { let s = ""; for (let k = 0; k < 4; k++) { await tick(); for (let i = 0; i < 30; i++) s += i * k; s += "|"; } return s; }
async function rope(a: string, b: string): Promise<string> { const r = a + b + a; await tick(); const q = r + b; await tick(); return q.charAt(5) + q.length + r.slice(2, 9); }
async function pattern(): Promise<string> { const [a, b = await later(obj("b")), c] = [obj("a"), undefined, obj("c")]; return show(a) + show(b) + show(c); }
async function patternOfFresh(): Promise<string> { const [a, , c = await later(obj("c")), d = await later(obj("d"))] = fresh(); return show(a) + show(c) + show(d); }
async function members(): Promise<string> { const { p, q = await later(obj("q")), r } = { p: obj("p"), q: undefined as Rec | undefined, r: obj("r") }; return show(p) + show(q) + show(r); }
async function overMap(): Promise<string> { const m = new Map<string, Rec>([["a", obj("ma")], ["b", obj("mb")], ["c", obj("mc")]]); let s = ""; for (const [k, v] of m) { m.delete(k); await tick(); s += k + show(v); } return s + m.size; }
async function overSet(): Promise<string> { const set = new Set<Rec>(fresh()); let s = ""; for (const v of set) { set.delete(v); await tick(); s += show(v); } return s + set.size; }
async function overArray(): Promise<string> { const a = fresh(); let s = ""; for (const v of a) { a[a.indexOf(v)] = obj("gone"); await tick(); s += show(v); } return s; }
function* gen(): Generator<Rec> { yield obj("g1"); yield obj("g2"); yield obj("g3"); }
async function overGenerator(): Promise<string> { let s = ""; for (const v of gen()) { await tick(); s += show(v); } return s; }
async function overEntries(): Promise<string> { let s = ""; for (const [k, v] of Object.entries({ a: obj("ea"), b: obj("eb") })) { await tick(); s += k + show(v); } for (const v of Object.values({ a: obj("va"), b: obj("vb") })) { await tick(); s += show(v); } return s; }
async function overKeys(): Promise<string> { const o: Record<string, Rec> = { a: obj("ka"), b: obj("kb"), c: obj("kc") }; let s = ""; for (const k in o) { const v = o[k]; delete o[k]; await tick(); s += k + show(v); } return s; }
async function literals(): Promise<string> {
  const o = { a: obj("la"), b: await later(obj("lb")), c: obj("lc"), d: await later(obj("ld")) };
  const a = [obj("aa"), await later(obj("ab")), obj("ac"), ...fresh(), await later(obj("ad")), ...fresh()];
  const t = `${show(obj("ta"))} ${show(await later(obj("tb")))} ${show(obj("tc"))}`;
  return show(o.a) + show(o.b) + show(o.c) + show(o.d) + a.map(show).join("") + t;
}
function three(a: Rec, b: Rec, c: Rec): string { return show(a) + show(b) + show(c); }
class Trio { s: string; constructor(a: Rec, b: Rec, c: Rec) { this.s = three(a, b, c); } }
async function argumentsOfCalls(): Promise<string> { return three(obj("c1"), await later(obj("c2")), obj("c3")) + new Trio(obj("n1"), await later(obj("n2")), obj("n3")).s + obj("recv").say(await later(7)) + fresh()[1].say(show(await later(obj("in")))); }
async function closures(): Promise<string> { let o = obj("cl"); const read = () => o; const write = (v: Rec) => { o = v; }; await tick(); const first = show(read()); write(obj("cl2")); await tick(); return first + show(read()) + [1, 2].map(k => show(o) + k).join(); }
async function numbers(x: number, y: number): Promise<string> { let i = 3, d = x / y, big = 12345678901234567890n, sym = Symbol("s"), str = "k" + x; for (let k = 0; k < 3; k++) { await tick(); i += k; d *= 1.5; big += 1n; str += k; } return [i, d, big, sym.description, str].join(); }
async function manyLive(): Promise<string> { const a = obj("1"), b = obj("2"), c = obj("3"), d = obj("4"), e = obj("5"), f = obj("6"), g = obj("7"), h = obj("8"), i = obj("9"), j = obj("10"), k = obj("11"), l = obj("12"), m = obj("13"), n = obj("14"), o = obj("15"), p = obj("16"); await tick(); const q = obj("17"), r = obj("18"); await tick(); return [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r].map(show).join(""); }
async function rethrown(): Promise<string> { const thrown = obj("thrown"); try { try { throw thrown; } finally { await tick(); } } catch (e) { await tick(); return String(e === thrown) + show(e as Rec); } }
async function rejectedInto(): Promise<string> { let s = ""; for (let i = 0; i < 3; i++) { const kept = obj("kept"); try { await fails(obj("why")); } catch (e) { s += show(e as Rec) + show(kept); } finally { await tick(); s += show(kept); } } return s; }
async function finallyReturns(): Promise<string> { const kept = obj("fr"); try { await fails(obj("lost")); return "no"; } catch { return show(kept) + show(await later(obj("fr2"))); } finally { await tick(); } }
async function throwsAtOnce(): Promise<string> {
  const kept = obj("once"); let s = "";
  for (let i = 0; i < 3; i++) { const p = Promise.resolve(i); Object.defineProperty(p, "constructor", { get(): never { throw obj("ctor"); } }); try { s += await p; } catch (e) { s += show(e as Rec); } await tick(); s += show(kept); }
  const thenable = { get then(): never { throw obj("then"); } }; try { await thenable; } catch (e) { s += show(e as Rec); } await tick();
  return s + show(kept);
}
async function thenables(): Promise<string> { const kept = obj("th"); const v = await { then(ok: (v: Rec) => void) { churn(); ok(obj("thv")); ok(obj("twice")); } }; await tick(); return show(kept) + show(v as unknown as Rec); }
async function deep(n: number, carried: Rec): Promise<string> { const own = obj("d" + n); if (n === 0) { await tick(); return show(carried); } const below = await deep(n - 1, own); await tick(); return (n % 40 === 0 ? show(own) + show(carried) : "") + below; }
async function six(a: Rec, b: Rec, c: Rec, d: Rec, e: Rec, f: Rec): Promise<string> { await tick(); return [a, b, c, d, e, f].map(show).join(""); }
async function seven(a: Rec, b: Rec, c: Rec, d: Rec, e: Rec, f: Rec, g: Rec): Promise<string> { await tick(); return [a, b, c, d, e, f, g].map(show).join(""); }
async function nine(a: Rec, b: Rec, c: Rec, d: Rec, e: Rec, f: Rec, g: Rec, h: Rec, i: Rec): Promise<string> { await tick(); return [a, b, c, d, e, f, g, h, i].map(show).join(""); }
async function restAndDefault(a: Rec, b: Rec = obj("def"), ...more: Rec[]): Promise<string> { await tick(); return show(a) + show(b) + more.map(show).join(""); }
class Base { constructor(public held: Rec) {} async read(extra: Rec): Promise<string> { await tick(); return show(this.held) + show(extra); } }
class Heir extends Base { async read(extra: Rec): Promise<string> { const mine = obj("heir"); const up = await super.read(extra); await tick(); const inner = async () => { await tick(); return show(this.held) + show(mine); }; return up + (await inner()); } static async make(): Promise<Heir> { await tick(); return new Heir(obj("made")); } }
async function methods(): Promise<string> { return (await Heir.make()).read(obj("extra")); }
async function forAwait(): Promise<string> { let s = ""; for await (const v of [later(obj("fa1")), obj("fa2"), later(obj("fa3"))]) { await tick(); s += show(v); } return s; }
async function together(): Promise<string> { const kept = obj("all"); const all = await Promise.all([later(obj("p1")), later(obj("p2")), six(obj("a"), obj("b"), obj("c"), obj("d"), obj("e"), obj("f"))]); const raced = await Promise.race([later(obj("r1")), new Promise<Rec>(() => {})]); return show(kept) + show(all[0]) + show(all[1]) + all[2] + show(raced); }
async function parked(): Promise<string> {
  const opens: ((v: Rec) => void)[] = []; const results: Promise<string>[] = [];
  const waits = async (i: number): Promise<string> => { const own = obj("w" + i); const got = await new Promise<Rec>(ok => { if (i % 3 === 0) opens.push(ok); }); await tick(); return show(own) + show(got); };
  for (let i = 0; i < 600; i++) { const p = waits(i); if (i % 3 === 0) results.push(p); }
  for (let k = 0; k < 5; k++) await tick();
  opens.forEach((ok, i) => ok(obj("o" + i)));
  const all = await Promise.all(results); return all.length + all[0] + all[all.length - 1];
}
async function switches(k: number): Promise<string> { const kept = obj("sw"); outer: for (let i = 0; i < 4; i++) { switch ((i + k) % 3) { case 0: await tick(); continue outer; case 1: { const inner = obj("sw1"); await tick(); if (i > 2) return show(inner) + show(kept); break; } default: await tick(); } } return show(kept); }

const rows: [string, () => Promise<string>][] = [
  ["builder", builder], ["builderInside", builderInside], ["rope", () => rope("abcdefgh", "12345")], ["pattern", pattern], ["patternOfFresh", patternOfFresh], ["members", members], ["overMap", overMap], ["overSet", overSet], ["overArray", overArray],
  ["overGenerator", overGenerator], ["overEntries", overEntries], ["overKeys", overKeys], ["literals", literals], ["argumentsOfCalls", argumentsOfCalls], ["closures", closures], ["numbers", () => numbers(7, 3)], ["manyLive", manyLive], ["rethrown", rethrown],
  ["rejectedInto", rejectedInto], ["finallyReturns", finallyReturns], ["throwsAtOnce", throwsAtOnce], ["thenables", thenables], ["deep", () => deep(200, obj("top"))], ["six", () => six(obj("a"), obj("b"), obj("c"), obj("d"), obj("e"), obj("f"))],
  ["seven", () => seven(obj("a"), obj("b"), obj("c"), obj("d"), obj("e"), obj("f"), obj("g"))], ["nine", () => nine(obj("a"), obj("b"), obj("c"), obj("d"), obj("e"), obj("f"), obj("g"), obj("h"), obj("i"))],
  ["restAndDefault", async () => (await restAndDefault(obj("a"))) + (await restAndDefault(obj("a"), undefined, obj("m1"), obj("m2")))], ["methods", methods], ["forAwait", forAwait], ["together", together], ["parked", parked], ["switches", async () => (await switches(0)) + (await switches(1)) + (await switches(2))],
];
async function main(): Promise<void> {
  for (let round = 0; round < 3; round++) for (const [name, f] of rows) { made = 0; try { console.log(round, name, await f()); } catch (e) { console.log(round, name, "THREW", String(e)); } }
  made = 0; const all = await Promise.all(rows.map(([, f]) => f().then(s => s.length, () => -1))); console.log("at once", all.join());
}
main();

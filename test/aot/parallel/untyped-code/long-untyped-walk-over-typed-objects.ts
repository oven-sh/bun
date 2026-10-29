// Typed objects in code that knows nothing of them: a long pseudo-random walk over everything untyped code does to an object. Every step's answer goes into the digest; the walk is the same in plain Bun.
interface A { id: number; name: string; flag: boolean; opt?: number; note?: string; next: A | null; any: unknown; score: number }
interface B { length: number; name?: string; prototype?: number; k0: string; k1?: boolean }
class C { x = 1; y = "y"; z?: number; constructor(public w: number) {} get twice() { return this.w * 2; } }
let seed = 77;
function next() { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed >>> 8; }
const pool: any[] = [];
const makeA = (r: number): A => r & 1 ? { id: r, name: "n" + r, flag: true, next: null, any: r, score: r / 4 } : { score: 0.5, any: null, next: null, flag: false, name: "", id: -r, opt: r };
const makeB = (r: number): B => r & 1 ? { length: r, k0: "k" } : { k0: "", length: 0, name: "b", k1: true };
const fits: Record<string, Record<string, (r: number) => unknown>> = {
  A: { id: r => (r & 3) === 0 ? r * 1000003 : r | 0, name: r => "n" + (r % 7), flag: r => (r & 1) === 0, opt: r => r % 5 ? r : undefined, note: r => r % 3 ? "t" + r : undefined, next: r => r & 1 ? null : pool.find(o => kindOf(o) === "A") ?? null, any: r => [r, "s" + r, null, undefined, [r], 1.5, true][r % 7], score: r => r % 4 ? r / 4 : r },
  B: { length: r => r, name: r => r & 1 ? "x" + r : undefined, prototype: r => r & 1 ? r : undefined, k0: r => "k" + r, k1: r => r % 3 ? (r & 1) === 0 : undefined },
  C: { x: r => r, y: r => "y" + r, z: r => r & 1 ? r : undefined, w: r => r + 0.5 },
  P: { id: r => r, name: r => "p" + r, zz: r => [r] },
};
const optional: Record<string, string[]> = { A: ["opt", "note"], B: ["name", "prototype", "k1"], C: ["z"], P: ["id", "name", "zz"] };
const kinds = new WeakMap<object, string>();
function kindOf(o: any) { return kinds.get(o)!; }
function add(o: object, kind: string) { kinds.set(o, kind); pool.push(o); }
const symbols = [Symbol("s0"), Symbol("s1")];
const show = (v: unknown): string => v === null ? "null" : typeof v === "object" ? (Array.isArray(v) ? "[" + v.map(show).join() + "]" : "{" + kindOf(v as object) + "}") : typeof v === "symbol" ? v.toString() : typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v);
const dump = (o: any) => Reflect.ownKeys(o).map(k => String(k) + ":" + show(o[k])).join();
function put(o: any, k: any, v: any) { o[k] = v; }
function get(o: any, k: any) { return o[k]; }
function putNumberLike(o: any, k: any, v: any) { for (let i = 0; i < 1; i++) o[k] = v; }
function getNumberLike(list: any, o: any, k: any) { return [list[0], o[k]]; }
function forIn(o: any) { let s = ""; for (const k in o) s += k + "=" + show(o[k]) + ";"; return s; }
function copyLoop(o: any) { const r: any = {}; for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
let digest = 0, steps = 0;
function note(text: string) { for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0; steps++; }
function attempt(make: () => unknown) { try { const v = make(); return typeof v === "string" ? v : show(v); } catch (e) { return "!" + (e as Error).name; } }
for (let i = 0; i < 6; i++) { add(makeA(i), "A"); add(makeB(i), "B"); add(new C(i), "C"); add(JSON.parse('{"id":1,"name":"p"}'), "P"); }
for (let step = 0; step < 30000; step++) {
  const o = pool[next() % pool.length], kind = kindOf(o), names = Object.keys(fits[kind]), r = next() % 1000, name = names[next() % names.length];
  const made = name.slice(0, 1) + name.slice(1);
  let said: string;
  switch (next() % 30) {
    case 0: case 1: case 2: said = attempt(() => { put(o, name, fits[kind][name](r)); return get(o, name); }); break;
    case 3: said = attempt(() => get(o, made)); break;
    case 4: said = attempt(() => { put(o, made, fits[kind][name](r)); return dump(o); }); break;
    case 5: said = attempt(() => { const k = optional[kind][r % optional[kind].length]; return delete o[k]; }); break;
    case 6: said = attempt(() => forIn(o)); break;
    case 7: said = attempt(() => Object.keys(o).join()); break;
    case 8: said = attempt(() => [Object.hasOwn(o, name), Object.prototype.hasOwnProperty.call(o, made), o.hasOwnProperty("x" + (r % 3)), name in o, made in o, "x" + (r % 3) in o, "toString" in o].join()); break;
    case 9: said = attempt(() => Object.entries(o).map(([k, v]) => k + show(v)).join()); break;
    case 10: said = attempt(() => Object.values(o).map(show).join()); break;
    case 11: said = attempt(() => dump({ ...o })); break;
    case 12: said = attempt(() => dump(Object.assign({}, o))); break;
    case 13: said = attempt(() => dump({ ...o, more: r, [name]: "over" })); break;
    case 14: said = attempt(() => dump({ ...o, more: r })); break;
    case 15: said = attempt(() => { put(o, "x" + (r % 3), r); return dump(o); }); break;
    case 16: said = attempt(() => delete o["x" + (r % 3)]); break;
    case 17: said = attempt(() => { put(o, symbols[r & 1], r); return Object.getOwnPropertySymbols(o).length; }); break;
    case 18: said = attempt(() => { const had = delete o[symbols[r & 1]]; return had + "," + Object.getOwnPropertySymbols(o).map(String).join(); }); break;
    case 19: said = attempt(() => { const { [name]: taken, ...others } = o; return show(taken) + "|" + dump(others); }); break;
    case 20: said = attempt(() => dump(copyLoop(o))); break;
    case 21: said = attempt(() => { putNumberLike(o, name, fits[kind][name](r)); return show(getNumberLike([r], o, name)); }); break;
    case 22: said = attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(o, name), (_k, v) => typeof v === "object" && v !== null && kinds.has(v) ? kindOf(v) : v)); break;
    case 23: said = attempt(() => r % 40 === 0 ? (Object.freeze(o), "frozen") : r % 40 === 1 ? (Object.seal(o), "sealed") : r % 40 === 2 ? (Object.preventExtensions(o), "closed") : [Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)].join()); break;
    case 24: said = attempt(() => { const fresh = kind === "A" ? makeA(r) : kind === "B" ? makeB(r) : kind === "C" ? new C(r) : JSON.parse('{"id":2,"zz":[1]}'); add(fresh, kind); if (pool.length > 40) pool.splice(r % 20, 1); return dump(fresh); }); break;
    case 25: said = attempt(() => { const patch: any = {}; patch[name] = fits[kind][name](r); Object.assign(o, patch); return get(o, name); }); break;
    case 26: said = attempt(() => Reflect.ownKeys(o).map(String).join() + "|" + Object.getOwnPropertyNames(o).join()); break;
    case 27: said = attempt(() => [get(o, "nothing" + (r % 2)), get(o, r % 3), get(o, symbols[r & 1]), get(o, "constructor") === Object, get(o, "twice")].map(show).join()); break;
    case 28: said = attempt(() => r % 25 === 0 ? (Object.defineProperty(o, "x" + (r % 3), { get() { return "got"; }, enumerable: (r & 1) === 0, configurable: true }), dump(o)) : forIn(o)); break;
    default: said = attempt(() => dump(o));
  }
  note(said);
  if (step % 1500 === 0) console.log(step, digest, said.slice(0, 100));
}
console.log(steps, digest, pool.map(dump).join(" / ").length);

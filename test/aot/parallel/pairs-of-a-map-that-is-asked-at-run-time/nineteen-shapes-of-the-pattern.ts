export {};
type M = Map<string, number>;
function base(map: M): string { let out = ""; for (const [k, v] of map) out += k + v + ";"; return out; }
function fallback(map: Map<string, number | undefined>): string { let out = ""; for (const [k, v = 7] of map) out += k + v + ";"; return out; }
function called(map: Map<string, number | undefined>, log: string[]): string { let out = ""; for (const [k, v = log.push("d")] of map) out += k + v + ";"; return out + log.length; }
function nested(map: Map<string, [number, number]>): string { let out = ""; for (const [k, [a, b]] of map) out += k + a + b + ";"; return out; }
function rest(map: M): string { let out = ""; for (const [k, ...r] of map) out += k + r.length + ";"; return out; }
function one(map: M): string { let out = ""; for (const [k] of map) out += k + ";"; return out; }
function three(map: M): string { let out = ""; for (const [k, v, x] of map as unknown as Iterable<[string, number, unknown?]>) out += k + v + String(x) + ";"; return out; }
function named(map: M, n: number): string { let out = ""; for (const pair of map) { for (let i = 0; i < n; i++) { const [k, v] = pair; out += k + v; } out += ";"; } return out; }
function both(map: M): string { let out = ""; for (const pair of map) { const [k, v] = pair; out += k + v + pair.length + ";"; } return out; }
function setters(map: M, log: string[]): string { const o = { set k(x: string) { log.push("k" + x); }, set v(x: number) { log.push("v" + x); } }; for ([o.k, o.v] of map) log.push("|"); return log.join(""); }
function assigned(map: M): string { let k = "", v = 0; for ([k, v] of map) {} return k + v; }
function caught(map: M): string { const fns: (() => string)[] = []; for (const [k, v] of map) fns.push(() => k + v); return fns.map(f => f()).join(";"); }
function* gen(map: M): Generator<string> { for (const [k, v] of map) yield k + v; }
async function slow(map: M): Promise<string> { let out = ""; for (const [k, v] of map) { await null; out += k + v + ";"; } return out; }
function churn(map: M): string { let out = ""; for (const [k, v] of map) { map.delete(k); if (v < 3) map.set(k + k, v + 2); out += k + v + ";"; } return out; }
function zeros(map: Map<number, number>): string { let out = ""; for (const [k, v] of map) out += (Object.is(k, -0) ? "-0" : String(k)) + ":" + (Object.is(v, -0) ? "-0" : String(v)) + ";"; return out; }
function kept(map: Map<{ n: string }, { n: string }>): string { let out = ""; for (const [k, v] of map) { map.delete(k); (globalThis as any).Bun.gc(true); out += k.n + v.n + ";"; } return out; }
(globalThis as any).handedOut = { base, fallback, called, nested, rest, one, three, named, both, setters, assigned, caught, gen, slow, churn, zeros, kept };
const rows = JSON.parse('[["a",1],["b",2],["c",3]]') as [string, number][]; const n = JSON.parse("[2,-0]") as number[]; const nan = Number(JSON.parse('"x"'));
const make = () => new Map(rows); const holed = () => new Map<string, number | undefined>([[rows[0]![0], undefined], rows[1]!]);
const own = make(); (own as any)[Symbol.iterator] = function* () { yield ["p", 8]; yield "xy"; };
console.log("SAID " + [base(make()), base(own), fallback(holed()), called(holed(), []), nested(new Map([[rows[0]![0], [rows[0]![1], rows[1]![1]]]])), rest(make()), one(make()), three(make()), named(make(), n[0]!), named(own, n[0]!), both(make()), setters(make(), []), assigned(make()), caught(make()), [...gen(make())].join(";"), await slow(make()), churn(make()), zeros(new Map([[n[1]!, n[1]!], [nan, nan]])), kept(new Map([[{ n: rows[0]![0] }, { n: rows[1]![0] }]]))].join(" "));

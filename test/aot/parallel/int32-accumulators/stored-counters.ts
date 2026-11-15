// Counters that loops store as they are, under bounds that are whole, fractional, beyond int32, infinite and no numbers.
const parse = (text: string): any => JSON.parse(text);
class P { x: number; y: any = 0; #h = 0; constructor(x: number) { this.x = x; } hide(v: number) { this.#h = v; } get hidden() { return this.#h; } }
const p = new P(3), o: any = { x: 0 }, list: number[] = [0, 0, 0, 0]; let held: any = 0, count = 0;
const end = parse("2147483655"), start = 2147483640;
function field(K: number) { let n = 0; for (let i = 0; i < K; i++) { p.x = i; n = (n + p.x) | 0; } return n + "," + p.x; }
function any(K: any) { let n = 0; for (let i = 0; i < K; i++) { p.y = i; n += p.y; } return n + "," + p.y; }
function secret(K: number) { let n = 0; for (let i = 0; i <= K; i++) { p.hide(i); n = (n + p.hidden) | 0; } return n + "," + p.hidden; }
function module(K: number) { let n = 0; for (let i = 0; i < K; i++) { held = i; n = (n + held) | 0; } return n + "," + held; }
function element(K: number) { for (let i = 0; i < K; i++) list[i & 3] = i; return list.join(); }
function literal(K: number) { for (let i = 0; i < K; i += 2) o.x = i; return String(o.x); }
function high(K: number) { let n = 0; for (let i = start; i < K; i++) { p.x = i; n = (n + p.x) | 0; } return n + "," + p.x; }
function highest(K: number) { let n = 0; for (let i = start; i <= K; i++) { p.y = i; n += p.y; } return n + "," + p.y; }
function ended(K: number) { let n = 0; for (let i = 0; i < K; i++) { p.x = i; if (i === 20) break; n = (n + p.x) | 0; } return n + "," + p.x; }
function below(K: number) { let n = 0; for (let i = -5; i < K; i++) { p.x = i; n = (n + p.x) | 0; } return n + "," + Object.is(p.x, -0) + p.x; }
function changed(K: number) { let n = 0; for (let i = 0; i < K; i++) { p.x = i; if (i === 3) p.x = 0.5; n = (n + p.x * 2) | 0; } return n + "," + p.x; }
for (const K of [0, 1, 10, 10.5, -1, -0, NaN, parse("7"), "8", null, true, 2.999999]) for (const f of [field, any, secret, module, element, literal, below, changed]) console.log(String(K), f.name, f(K as any));
for (const K of [Infinity, 1e300, 4294967296, 25]) console.log(String(K), ended(K));
for (const K of [end, 2147483647, 2147483648.5, start - 1]) console.log(String(K), high(K), highest(K));
for (const bad of [{ valueOf() { count++; return 5; } }, 12n, Symbol.iterator, undefined]) for (const f of [field, any, module]) { let r: string; try { r = f(bad as any); } catch (e: any) { r = e.name; } console.log(f.name, r, count); }

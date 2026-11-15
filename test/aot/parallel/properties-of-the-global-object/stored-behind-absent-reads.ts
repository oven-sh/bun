// Properties of globalThis are stored into after a global that does not exist was read: the global object may be on a prototype chain from then on.
declare var freeCount: any, freeGone: any;
const g: any = globalThis;
const xs: number[] = JSON.parse("[" + Array.from({ length: 20 }, (_, k) => (k * 37) % 11).join() + "]");
const isBrowser = typeof (globalThis as any).window !== "undefined";
if (g.TRACE_OF_NOTHING) console.log("trace");
const child: any = Object.create(globalThis), below: any = Object.create(child);
function counts() { let s = 0; for (let i = 0; i < xs.length; i++) { g.hits = (g.hits ?? 0) + 1; s = (s + xs[i]!) | 0; } return s + "," + g.hits; }
function increments() { g.uid ??= 0; for (let i = 0; i < xs.length; i++) g.uid++; return g.uid; }
function free() { for (let i = 0; i < xs.length; i++) freeCount = (freeCount ?? 0) + xs[i]!; return freeCount; }
function seenBelow() { let s = ""; for (let i = 0; i < 6; i++) { g.hits = i; s += child.hits + "." + below.hits + " "; } return s; }
function constant() { return g.limit; }
g.limit = 5; g.freeCount = 0;
console.log(isBrowser, counts(), counts(), increments(), increments(), free(), free(), seenBelow());
for (let i = 0; i < 4; i++) { const before = constant(); g.limit = i * 2; console.log(before, constant(), child.limit); }
let calls = 0;
Object.defineProperty(g, "hits", { configurable: true, enumerable: true, get: () => 40, set: () => { calls++; } });
console.log(counts(), calls, child.hits);
Object.defineProperty(g, "hits", { value: 3, writable: false, configurable: true });
for (let i = 0; i < 2; i++) { try { console.log(counts()); } catch (error) { console.log((error as Error).name, g.hits); } }
delete g.hits;
console.log("hits" in g, child.hits, counts(), counts(), child.hits);
child.hits = 1; g.hits = 2; console.log(child.hits, below.hits, g.hits);
for (let i = 0; i < 3; i++) { delete g.freeGone; let s = "absent"; try { s = typeof freeGone; freeGone = 1; s += freeGone; } catch (error) { s += (error as Error).name; } g.freeGone = i; for (let k = 0; k < 5; k++) freeGone++; console.log(s, freeGone, child.freeGone); }
const held = { valueOf: () => 7 };
for (const value of [1, 2.5, "t", held, null, undefined, [1]]) { g.kind = value; let s = ""; for (let i = 0; i < 3; i++) { g.kind = value; s += String(child.kind) + (g.kind === value); } console.log(s); }
console.log(Object.keys(g).filter(key => ["hits", "uid", "freeCount", "freeGone", "kind", "limit"].includes(key)).sort().join());

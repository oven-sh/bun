// The arms of an if store into different fields and meet again. A later read of the same iteration may find anything but a number: what the iteration has stored is then undone, whichever arm it took, and it runs again in the generic version.
// STATISTIC: UndoableStoresMergedAtJoins >= 9
interface P { x: number; y: number; dx: number; dy: number; hits: number; name: string; on: boolean; link: P | null; q: number | null }
interface T { a: number; b: number; c: number }
let count = 0, last = 0, n = 0;
let errors: string[] = [];
let kept: P | null = null;
const doubles: number[] = [0.5, 1.5, 2.5, 3.5, 4.5];
let calls: string[] = [];
function make(i: number): P { return { x: i % 10 - 3, y: i % 7 - 3, dx: i % 5 - 2, dy: i % 3 - 1, hits: 0, name: "n", on: false, link: null, q: null }; }
function bump(p: P): void { if (p.x < 2) { p.hits++; } }
function turn(p: P): void { if (p.hits > 3) { p.dx = -p.dx; p.hits = 0; } }
function twoIfs(ps: P[], t: T): void { for (const p of ps) { p.x += p.dx; if (p.x < 0) { p.dx = -p.dx; p.hits++; } if (p.y < 0) { p.dy = -p.dy; p.hits++; } p.y += p.dy; } }
function ifElse(ps: P[], t: T): void { for (const p of ps) { if (p.x < 0) { p.dx = p.x; } else { p.dy = p.y; } p.hits += p.dx; p.x -= p.dy; } }
function bothArmsOneField(ps: P[], t: T): void { for (const p of ps) { if (p.x < 0) { p.hits++; } else { p.hits--; } p.y += p.hits; p.x += p.dx; } }
function nested(ps: P[], t: T): void { for (const p of ps) { if (p.x < 2) { p.hits++; if (p.y < 1) { p.dx++; if (p.dy < 0) { p.dy++; p.x += p.dy; } else { p.y--; } } } p.x -= p.dx; if (p.hits > 2) { p.hits = 0; } p.y += p.dy; } }
function switches(ps: P[], t: T): void { for (const p of ps) { switch (p.hits & 3) { case 0: p.x++; break; case 1: p.y++; p.dx = 2; break; case 2: p.dx--; break; default: p.dy++; } p.hits++; p.dy += p.x; p.y -= p.dx; } }
function twiceInArm(ps: P[], t: T): void { for (const p of ps) { if (p.x < 1) { p.hits++; p.y += 2; p.hits++; } p.x += p.dx; p.dy -= p.hits; } }
function neighborSameKey(ps: P[], t: T): void { for (const p of ps) { const q = ps[(n++ * 5) % ps.length]!; if (p.x < 1) { q.hits += 3; } else { p.hits += 2; } p.x += p.dx; q.y -= p.hits; p.dy++; } }
function outerObject(ps: P[], t: T): void { for (const p of ps) { if (p.x < 1) { t.a += p.x; } else { t.b += p.y; } t.c += p.dx; if (p.y < 1) t.a -= p.dy; t.b += p.hits; } }
function continues(ps: P[], t: T): void { for (const p of ps) { p.x += p.dx; if (p.x < 0) { p.hits++; if (p.y < 0) continue; p.dx = 1; } p.y += p.dy; if (p.y > 6) { p.y = 0; p.hits--; continue; } p.dy += p.hits; } }

const bads: [string, (ps: any[], k: number) => void][] = [
  ["none", () => {}],
  ["string", (ps, k) => { ps[k].hits = "s"; }],
  ["numeric string", (ps, k) => { ps[k].hits = "4"; }],
  ["string dy", (ps, k) => { ps[k].dy = "7"; }],
  ["undefined", (ps, k) => { ps[k].hits = undefined; }],
  ["undefined y", (ps, k) => { ps[k].y = undefined; }],
  ["null", (ps, k) => { ps[k].dy = null; }],
  ["fraction", (ps, k) => { ps[k].hits = 1.5; ps[k].y = -0.25; }],
  ["minus zero", (ps, k) => { ps[k].hits = -0; ps[k].dx = -0; }],
  ["nan", (ps, k) => { ps[k].dy = NaN; }],
  ["infinity", (ps, k) => { ps[k].hits = -Infinity; }],
  ["large", (ps, k) => { ps[k].hits = 2147483647; ps[k].y = -2147483648; ps[k].dy = -1; }],
  ["very large", (ps, k) => { ps[k].hits = 9007199254740993; }],
  ["bigint", (ps, k) => { ps[k].hits = 5n; }],
  ["bigint dy", (ps, k) => { ps[k].dy = 2n; }],
  ["boolean", (ps, k) => { ps[k].hits = true; ps[k].x = false; }],
  ["valueOf", (ps, k) => { ps[k].hits = { valueOf() { calls.push("hits"); return 2; } }; }],
  ["valueOf dy", (ps, k) => { ps[k].dy = { valueOf() { calls.push("dy"); ps[(k + 1) % ps.length].hits += 10; return 1; } }; }],
  ["valueOf that throws", (ps, k) => { ps[k].dx = { valueOf() { throw new Error("no dx"); } }; }],
  ["frozen", (ps, k) => { Object.freeze(ps[k]); }],
  ["sealed", (ps, k) => { Object.seal(ps[k]); }],
  ["read only", (ps, k) => { Object.defineProperty(ps[k], "hits", { value: 1, writable: false }); }],
  ["accessor", (ps, k) => { let held = 2; Object.defineProperty(ps[k], "hits", { get() { calls.push("get"); return held; }, set(v) { calls.push("set " + String(v)); held = v; } }); }],
  ["accessor dx", (ps, k) => { let held = 1; Object.defineProperty(ps[k], "dx", { get() { calls.push("get dx"); return held; }, set(v) { calls.push("set dx " + String(v)); held = v; }, enumerable: true }); }],
  ["deleted", (ps, k) => { delete ps[k].hits; }],
  ["deleted dy", (ps, k) => { delete ps[k].dy; }],
  ["added", (ps, k) => { ps[k].more = 1; }],
  ["prototype", (ps, k) => { Object.setPrototypeOf(ps[k], { hits: 9 }); delete ps[k].hits; }],
  ["prototype setter", (ps, k) => { Object.setPrototypeOf(ps[k], { set hits(v: any) { calls.push("set on prototype " + String(v)); }, get hits() { return 1; } }); delete ps[k].hits; }],
  ["alias", (ps, k) => { ps[k] = ps[(k + 1) % ps.length]; }],
  ["other order", (ps, k) => { ps[k] = { hits: 1, dy: 1, dx: 1, y: 1, x: 1, name: "o", on: true, link: null, q: 1 }; }],
  ["class", (ps, k) => { class C { x = 1; y = -1; dx = 2; dy = 1; hits = 0; name = "c"; on = true; link = null; q = null; } ps[k] = new C(); }],
  ["proxy", (ps, k) => { ps[k] = new Proxy(ps[k], { set(o: any, key, v) { calls.push("trap " + String(key)); o[key] = v; return true; } }); }],
  ["null object", (ps, k) => { ps[k] = null; }],
  ["number object", (ps, k) => { ps[k] = 5; }],
  ["hole", (ps, k) => { delete ps[k]; }],
  ["string object", (ps, k) => { ps[k] = "text"; }],
  ["link", (ps, k) => { ps[k].link = ps[(k + 2) % ps.length]; }],
  ["link to other", (ps, k) => { ps[k].link = { dy: "t" }; ps[k].on = 1; ps[k].name = 7; ps[k].q = "q"; }],
];
function show(v: any): string { return typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "o" : String(v); }
function row(p: any): string { return p === null || typeof p !== "object" ? String(p) : [p.x, p.y, p.dx, p.dy, p.hits, p.name, p.on, p.link === null ? "-" : typeof p.link, p.q, p.more].map(show).join(","); }
for (const step of [twoIfs, ifElse, bothArmsOneField, nested, switches, twiceInArm, neighborSameKey, outerObject, continues]) for (const [name, spoil] of bads) {
  for (const k of [3]) {
    const ps: P[] = []; for (let i = 0; i < 9; i++) ps.push(make(i * 3 + 1));
    const t: T = { a: 0, b: 0, c: 0 };
    count = 0; last = 0; n = 0; calls = []; errors = []; kept = null; for (let i = 0; i < doubles.length; i++) doubles[i] = i + 0.5;
    for (let round = 0; round < 6; round++) {
      if (round === 2) spoil(ps, k);
      if (round === 4 && k === 3) { (t as any).b = "t"; (doubles as any)[1] = "d"; }
      try { step(ps, t); } catch (e: any) { errors.push(String(e && e.name)); }
    }
    console.log(step.name, name, ps.map(row).join(" | "), show(t.a), show(t.b), show(t.c), count, show(last), kept === null ? "" : row(kept), doubles.map(show).join(), errors.join(), calls.join());
  }
}

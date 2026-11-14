declare const process: any;
const log: string[] = [];
function show(v: any): string {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) { let s = "["; for (let i = 0; i < v.length; i++) s += (i in v ? show(v[i]) : "hole") + ","; return s + "]"; }
  if (typeof v === "object" && v !== null) return "object";
  return String(v);
}
function attempt(name: string, f: () => any) { try { log.push(name + " " + show(f())); } catch (e: any) { log.push(name + " threw " + (e && e.constructor && e.constructor.name) + " " + String(e && e.message).slice(0, 50)); } }
class Node { constructor(readonly id: number) {} }
class Sub extends Array<number> {}
const sparse: number[] = []; sparse[5000] = 1; sparse[1] = 2.5;
const deleted = [1.5, 2.5, 3.5]; delete (deleted as any)[1];
const grown: number[] = []; for (let i = 0; i < 40; i++) grown.push(i % 3 ? i : i / 2);
const mixed: any[] = [1, "x", 2.5, null, undefined, true, 5n, { valueOf() { return 7; } }, [8], Symbol.iterator];
const getter = Object.defineProperty([1, 2, 3], 1, { get() { return 9.5; } });
const lists: any[] = [[1, 2, 3], [1.5, -0, NaN], [0, -0, Infinity], [], [1], [1, , 3], [, 1.5], [NaN, NaN], [2147483647, 2147483648, -2147483648], [9007199254740992, 1e300, 5e-324], sparse, deleted, grown, mixed, getter, Object.freeze([1, 2, 3]), Sub.from([1, 2.5]), new Array(3), [undefined, 1], [null, 2], ["a", "b"], [new Node(1), 2], [1, new Node(2)], new Float64Array([1.5, 2.5]), new Uint8Array([7, 8]), "text", { 0: 1, 1: 2, length: 2 }, new Proxy([1, 2], {}), [[1], [2]], [true, false]];
const pairs: [Node, number][] = []; for (let i = 0; i < 12; i++) pairs.push([new Node(i), i % 4 === 0 ? i : i % 4 === 1 ? i / 3 : i % 4 === 2 ? -0 : NaN]);
const entries: [string, number][] = Object.entries({ a: 1, b: 2.5, c: -3, d: 1e21, e: 0 });
class Heap<T> {
  readonly items: T[] = [];
  constructor(private readonly score: (e: T) => number) {}
  push(e: T) { this.items.push(e); let n = this.items.length - 1; while (n > 0) { const p = (n - 1) >> 1; if (this.score(this.items[n]!) >= this.score(this.items[p]!)) break; const t = this.items[p]!; this.items[p] = this.items[n]!; this.items[n] = t; n = p; } }
  pop(): T | undefined { const top = this.items[0], end = this.items.pop(); if (this.items.length > 0 && end !== undefined) { this.items[0] = end; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.score(this.items[c + 1]!) < this.score(this.items[c]!)) c++; if (this.score(this.items[c]!) >= this.score(end)) break; this.items[n] = this.items[c]!; this.items[c] = end; n = c; } } return top; }
}

function r0(a: number[]): number { return (a[2]! | 0) + (a[2]! | 0); }
function s0(a: number[], k: number): number { const x = a[k]!; return x + a[k + 1]!; }
function t0(a: [Node, number]): number { return a[1] - a[0].id; }
function l0(a: number[]): number { let s = 0; for (let k = 0; k < a.length; k++) s += a[k]! * a[0]!; return s; }
for (const a of lists) { attempt("r0", () => r0(a)); attempt("s0", () => [0, 1, 2, 3, -1, 0.5].map(k => s0(a, k))); attempt("l0", () => l0(a)); attempt("t0", () => t0(a)); }
attempt("p0", () => pairs.map(p => t0(p)));
attempt("h0", () => { const h = new Heap<[Node, number]>(e => e[1]); for (const p of pairs) if (p[1] === p[1]) h.push(p); const out: number[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
attempt("q0", () => { const h = new Heap<any>(e => e[1]); for (const p of [[1, 2], [2, 1.5], ["a", 7], [new Node(1), "3"], [null, null], [1]]) h.push(p); const out: any[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
class Queue0 {
  private readonly items: [Node, number][] = [];
  constructor(private readonly score: (e: [Node, number]) => number) {}
  get size(): number { return this.items.length; }
  first(): [Node, number] { return this.items[0]!; }
  push(e: [Node, number]): void { this.items.push(e); let n = this.items.length - 1; const element = this.items[n]!; while (n > 0) { const p = Math.floor((n + 1) / 2) - 1, parent = this.items[p]!; if (this.score(element) >= this.score(parent)) break; this.items[p] = element; this.items[n] = parent; n = p; } }
  pop(): [Node, number] | undefined { const top = this.items[0], end = this.items.pop(); if (this.items.length > 0 && end !== undefined) { this.items[0] = end; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.score(this.items[c + 1]!) < this.score(this.items[c]!)) c++; if (this.score(this.items[c]!) >= this.score(end)) break; this.items[n] = this.items[c]!; this.items[c] = end; n = c; } } return top; }
}
class Track0 { private readonly xs: number[] = []; private readonly rows: number[][] = []; add(v: number): void { this.xs.push(v); this.rows.push([v, v * 2, 1]); } at(i: number): number { return this.xs[i]! * 2; } ends(): number { return this.xs[0]! - this.xs[1]! + this.xs[this.xs.length - 1]!; } row(i: number): number { const r = this.rows[i]!; return r[0]! * r[1]! + r[2]!; } past(i: number): number { return this.rows[0]![i]! + 1; } }
attempt("Q0", () => { const q = new Queue0(e => e[1]); const out: number[] = []; for (const p of pairs) { if (q.size > 3 && q.first()[1] > p[1]) q.pop(); q.push([p[0], p[1] * 1]); out.push(q.first()[1]); } for (;;) { const x = q.pop(); if (!x) break; out.push(x[1], x[0].id); } return out; });
for (const row of [[1, 2, 3], [1.5, 2, -0], [0.25, NaN, 7], [2147483647, 2147483648], [5], [], [NaN, NaN, NaN, NaN]]) attempt("T0", () => { const t = new Track0(); for (const v of row) t.add(v); return [t.at(0), t.at(1), t.at(9), t.ends(), t.past(0), t.past(2), t.past(3), t.row(0), t.row(1)]; });
attempt("e0", () => entries.slice().sort((x, y) => y[1] - x[1]).map(x => x[0] + x[1]));
function r1(a: number[]): number { return a[0]! + a[1]!; }
function s1(a: number[], k: number): number { const x = a[k]!; return x + a[0]!; }
function t1(a: [Node, number]): number { return a[1] - 1.5; }
function l1(a: number[]): number { let s = 0; for (let k = 0; k < a.length; k++) s += a[k]! * 2; return s; }
for (const a of lists) { attempt("r1", () => r1(a)); attempt("s1", () => [0, 1, 2, 3, -1, 0.5].map(k => s1(a, k))); attempt("l1", () => l1(a)); attempt("t1", () => t1(a)); }
attempt("p1", () => pairs.map(p => t1(p)));
attempt("h1", () => { const h = new Heap<[Node, number]>(e => -e[1]); for (const p of pairs) if (p[1] === p[1]) h.push(p); const out: number[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
attempt("q1", () => { const h = new Heap<any>(e => -e[1]); for (const p of [[1, 2], [2, 1.5], ["a", 7], [new Node(1), "3"], [null, null], [1]]) h.push(p); const out: any[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
class Queue1 {
  private readonly items: [Node, number][] = [];
  constructor(private readonly score: (e: [Node, number]) => number) {}
  get size(): number { return this.items.length; }
  first(): [Node, number] { return this.items[0]!; }
  push(e: [Node, number]): void { this.items.push(e); let n = this.items.length - 1; const element = this.items[n]!; while (n > 0) { const p = Math.floor((n + 1) / 2) - 1, parent = this.items[p]!; if (this.score(element) >= this.score(parent)) break; this.items[p] = element; this.items[n] = parent; n = p; } }
  pop(): [Node, number] | undefined { const top = this.items[0], end = this.items.pop(); if (this.items.length > 0 && end !== undefined) { this.items[0] = end; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.score(this.items[c + 1]!) < this.score(this.items[c]!)) c++; if (this.score(this.items[c]!) >= this.score(end)) break; this.items[n] = this.items[c]!; this.items[c] = end; n = c; } } return top; }
}
class Track1 { private readonly xs: number[] = []; private readonly rows: number[][] = []; add(v: number): void { this.xs.push(v); this.rows.push([v, v * 2, 1]); } at(i: number): number { return this.xs[i]! + 1; } ends(): number { return this.xs[0]! - this.xs[1]! + this.xs[this.xs.length - 1]!; } row(i: number): number { const r = this.rows[i]!; return r[0]! * r[1]! + r[2]!; } past(i: number): number { return this.rows[0]![i]! + 1; } }
attempt("Q1", () => { const q = new Queue1(e => -e[1]); const out: number[] = []; for (const p of pairs) { if (q.size > 3 && q.first()[1] >= p[1]) q.pop(); q.push([p[0], p[1] * 3]); out.push(q.first()[1]); } for (;;) { const x = q.pop(); if (!x) break; out.push(x[1], x[0].id); } return out; });
for (const row of [[1, 2, 3], [1.5, 2, -0], [0.25, NaN, 7], [2147483647, 2147483648], [5], [], [NaN, NaN, NaN, NaN]]) attempt("T1", () => { const t = new Track1(); for (const v of row) t.add(v); return [t.at(0), t.at(1), t.at(9), t.ends(), t.past(0), t.past(2), t.past(3), t.row(0), t.row(1)]; });
attempt("e1", () => entries.slice().sort((x, y) => y[1] - x[1]).map(x => x[0] + x[1]));
function r2(a: number[]): number { return a[1]! + a[1]!; }
function s2(a: number[], k: number): number { const x = a[k]!; return x + a[k + 1]!; }
function t2(a: [Node, number]): number { return a[1] + a[0].id; }
function l2(a: number[]): number { let s = 0; for (let k = 0; k < a.length; k++) s += a[k]! * 2; return s; }
for (const a of lists) { attempt("r2", () => r2(a)); attempt("s2", () => [0, 1, 2, 3, -1, 0.5].map(k => s2(a, k))); attempt("l2", () => l2(a)); attempt("t2", () => t2(a)); }
attempt("p2", () => pairs.map(p => t2(p)));
attempt("h2", () => { const h = new Heap<[Node, number]>(e => e[1]); for (const p of pairs) if (p[1] === p[1]) h.push(p); const out: number[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
attempt("q2", () => { const h = new Heap<any>(e => e[1]); for (const p of [[1, 2], [2, 1.5], ["a", 7], [new Node(1), "3"], [null, null], [1, undefined]]) h.push(p); const out: any[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
class Queue2 {
  private readonly items: [Node, number][] = [];
  constructor(private readonly score: (e: [Node, number]) => number) {}
  get size(): number { return this.items.length; }
  first(): [Node, number] { return this.items[0]!; }
  push(e: [Node, number]): void { this.items.push(e); let n = this.items.length - 1; const element = this.items[n]!; while (n > 0) { const p = Math.floor((n + 1) / 2) - 1, parent = this.items[p]!; if (this.score(element) >= this.score(parent)) break; this.items[p] = element; this.items[n] = parent; n = p; } }
  pop(): [Node, number] | undefined { const top = this.items[0], end = this.items.pop(); if (this.items.length > 0 && end !== undefined) { this.items[0] = end; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.score(this.items[c + 1]!) < this.score(this.items[c]!)) c++; if (this.score(this.items[c]!) >= this.score(end)) break; this.items[n] = this.items[c]!; this.items[c] = end; n = c; } } return top; }
}
class Track2 { private readonly xs: number[] = []; private readonly rows: number[][] = []; add(v: number): void { this.xs.push(v); this.rows.push([v, v / 3, 1]); } at(i: number): number { return this.xs[i]! + 1; } ends(): number { return this.xs[0]! - this.xs[1]! + this.xs[this.xs.length - 1]!; } row(i: number): number { const r = this.rows[i]!; return r[0]! * r[1]! + r[2]!; } past(i: number): number { return this.rows[0]![i]! + 1; } }
attempt("Q2", () => { const q = new Queue2(e => e[1]); const out: number[] = []; for (const p of pairs) { if (q.size > 3 && q.first()[1] >= p[1]) q.pop(); q.push([p[0], p[1] * 3]); out.push(q.first()[1]); } for (;;) { const x = q.pop(); if (!x) break; out.push(x[1], x[0].id); } return out; });
for (const row of [[1, 2, 3], [1.5, 2, -0], [0.25, NaN, 7], [2147483647, 2147483648], [5], [], [NaN, NaN, NaN, NaN]]) attempt("T2", () => { const t = new Track2(); for (const v of row) t.add(v); return [t.at(0), t.at(1), t.at(9), t.ends(), t.past(0), t.past(2), t.past(3), t.row(0), t.row(1)]; });
attempt("e2", () => entries.slice().sort((x, y) => x[1] - y[1] || 1).map(x => x[0] + x[1]));
function r3(a: number[]): number { return Math.max(a[1]!, a[1]!); }
function s3(a: number[], k: number): number { const x = a[k]!; return x + x * 0.5; }
function t3(a: [Node, number]): number { return a[1] - a[0].id; }
function l3(a: number[]): number { let s = 0; for (let k = 0; k < a.length; k++) s += a[k]! * 0.5; return s; }
for (const a of lists) { attempt("r3", () => r3(a)); attempt("s3", () => [0, 1, 2, 3, -1, 0.5].map(k => s3(a, k))); attempt("l3", () => l3(a)); attempt("t3", () => t3(a)); }
attempt("p3", () => pairs.map(p => t3(p)));
attempt("h3", () => { const h = new Heap<[Node, number]>(e => -e[1]); for (const p of pairs) if (p[1] === p[1]) h.push(p); const out: number[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
attempt("q3", () => { const h = new Heap<any>(e => -e[1]); for (const p of [[1, 2], [2, 1.5], ["a", 7], [new Node(1), "3"], [null, null], [1]]) h.push(p); const out: any[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
class Queue3 {
  private readonly items: [Node, number][] = [];
  constructor(private readonly score: (e: [Node, number]) => number) {}
  get size(): number { return this.items.length; }
  first(): [Node, number] { return this.items[0]!; }
  push(e: [Node, number]): void { this.items.push(e); let n = this.items.length - 1; const element = this.items[n]!; while (n > 0) { const p = Math.floor((n + 1) / 2) - 1, parent = this.items[p]!; if (this.score(element) >= this.score(parent)) break; this.items[p] = element; this.items[n] = parent; n = p; } }
  pop(): [Node, number] | undefined { const top = this.items[0], end = this.items.pop(); if (this.items.length > 0 && end !== undefined) { this.items[0] = end; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.score(this.items[c + 1]!) < this.score(this.items[c]!)) c++; if (this.score(this.items[c]!) >= this.score(end)) break; this.items[n] = this.items[c]!; this.items[c] = end; n = c; } } return top; }
}
class Track3 { private readonly xs: number[] = []; private readonly rows: number[][] = []; add(v: number): void { this.xs.push(v); this.rows.push([v, v + 1, 1]); } at(i: number): number { return this.xs[i]! * 2; } ends(): number { return this.xs[0]! - this.xs[1]! + this.xs[this.xs.length - 1]!; } row(i: number): number { const r = this.rows[i]!; return r[0]! * r[1]! + r[2]!; } past(i: number): number { return this.rows[0]![i]! + 1; } }
attempt("Q3", () => { const q = new Queue3(e => -e[1]); const out: number[] = []; for (const p of pairs) { if (q.size > 3 && q.first()[1] < p[1]) q.pop(); q.push([p[0], p[1] + 0.25]); out.push(q.first()[1]); } for (;;) { const x = q.pop(); if (!x) break; out.push(x[1], x[0].id); } return out; });
for (const row of [[1, 2, 3], [1.5, 2, -0], [0.25, NaN, 7], [2147483647, 2147483648], [5], [], [NaN, NaN, NaN, NaN]]) attempt("T3", () => { const t = new Track3(); for (const v of row) t.add(v); return [t.at(0), t.at(1), t.at(9), t.ends(), t.past(0), t.past(2), t.past(3), t.row(0), t.row(1)]; });
attempt("e3", () => entries.slice().sort((x, y) => y[1] - x[1]).map(x => x[0] + x[1]));
function r4(a: number[]): number { return a[0]! - a[2]!; }
function s4(a: number[], k: number): number { const x = a[k]!; return x + 1; }
function t4(a: [Node, number]): number { return a[1] - 1.5; }
function l4(a: number[]): number { let s = 0; for (let k = 0; k < a.length; k++) s += a[k]! * 0.5; return s; }
for (const a of lists) { attempt("r4", () => r4(a)); attempt("s4", () => [0, 1, 2, 3, -1, 0.5].map(k => s4(a, k))); attempt("l4", () => l4(a)); attempt("t4", () => t4(a)); }
attempt("p4", () => pairs.map(p => t4(p)));
attempt("h4", () => { const h = new Heap<[Node, number]>(e => -e[1]); for (const p of pairs) if (p[1] === p[1]) h.push(p); const out: number[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
attempt("q4", () => { const h = new Heap<any>(e => -e[1]); for (const p of [[1, 2], [2, 1.5], ["a", 7], [new Node(1), "3"], [null, null], [1]]) h.push(p); const out: any[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
class Queue4 {
  private readonly items: [Node, number][] = [];
  constructor(private readonly score: (e: [Node, number]) => number) {}
  get size(): number { return this.items.length; }
  first(): [Node, number] { return this.items[0]!; }
  push(e: [Node, number]): void { this.items.push(e); let n = this.items.length - 1; const element = this.items[n]!; while (n > 0) { const p = Math.floor((n + 1) / 2) - 1, parent = this.items[p]!; if (this.score(element) >= this.score(parent)) break; this.items[p] = element; this.items[n] = parent; n = p; } }
  pop(): [Node, number] | undefined { const top = this.items[0], end = this.items.pop(); if (this.items.length > 0 && end !== undefined) { this.items[0] = end; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.score(this.items[c + 1]!) < this.score(this.items[c]!)) c++; if (this.score(this.items[c]!) >= this.score(end)) break; this.items[n] = this.items[c]!; this.items[c] = end; n = c; } } return top; }
}
class Track4 { private readonly xs: number[] = []; private readonly rows: number[][] = []; add(v: number): void { this.xs.push(v); this.rows.push([v, v - 0.5, 1]); } at(i: number): number { return this.xs[i]! * 2; } ends(): number { return this.xs[0]! - this.xs[1]! + this.xs[this.xs.length - 1]!; } row(i: number): number { const r = this.rows[i]!; return r[0]! * r[1]! + r[2]!; } past(i: number): number { return this.rows[0]![i]! + 1; } }
attempt("Q4", () => { const q = new Queue4(e => -e[1]); const out: number[] = []; for (const p of pairs) { if (q.size > 3 && q.first()[1] >= p[1]) q.pop(); q.push([p[0], p[1] * 1]); out.push(q.first()[1]); } for (;;) { const x = q.pop(); if (!x) break; out.push(x[1], x[0].id); } return out; });
for (const row of [[1, 2, 3], [1.5, 2, -0], [0.25, NaN, 7], [2147483647, 2147483648], [5], [], [NaN, NaN, NaN, NaN]]) attempt("T4", () => { const t = new Track4(); for (const v of row) t.add(v); return [t.at(0), t.at(1), t.at(9), t.ends(), t.past(0), t.past(2), t.past(3), t.row(0), t.row(1)]; });
attempt("e4", () => entries.slice().sort((x, y) => x[1] - y[1]).map(x => x[0] + x[1]));
function r5(a: number[]): number { return a[2]! === a[0]! ? 3 : 4; }
function s5(a: number[], k: number): number { const x = a[k]!; return x + x * 0.5; }
function t5(a: [Node, number]): number { return a[1] + a[1]; }
function l5(a: number[]): number { let s = 0; for (let k = 0; k < a.length; k++) s += a[k]! * 0.5; return s; }
for (const a of lists) { attempt("r5", () => r5(a)); attempt("s5", () => [0, 1, 2, 3, -1, 0.5].map(k => s5(a, k))); attempt("l5", () => l5(a)); attempt("t5", () => t5(a)); }
attempt("p5", () => pairs.map(p => t5(p)));
attempt("h5", () => { const h = new Heap<[Node, number]>(e => -e[1]); for (const p of pairs) if (p[1] === p[1]) h.push(p); const out: number[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
attempt("q5", () => { const h = new Heap<any>(e => -e[1]); for (const p of [[1, 2], [2, 1.5], ["a", 7], [new Node(1), "3"], [null, null], []]) h.push(p); const out: any[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
class Queue5 {
  private readonly items: [Node, number][] = [];
  constructor(private readonly score: (e: [Node, number]) => number) {}
  get size(): number { return this.items.length; }
  first(): [Node, number] { return this.items[0]!; }
  push(e: [Node, number]): void { this.items.push(e); let n = this.items.length - 1; const element = this.items[n]!; while (n > 0) { const p = Math.floor((n + 1) / 2) - 1, parent = this.items[p]!; if (this.score(element) >= this.score(parent)) break; this.items[p] = element; this.items[n] = parent; n = p; } }
  pop(): [Node, number] | undefined { const top = this.items[0], end = this.items.pop(); if (this.items.length > 0 && end !== undefined) { this.items[0] = end; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.score(this.items[c + 1]!) < this.score(this.items[c]!)) c++; if (this.score(this.items[c]!) >= this.score(end)) break; this.items[n] = this.items[c]!; this.items[c] = end; n = c; } } return top; }
}
class Track5 { private readonly xs: number[] = []; private readonly rows: number[][] = []; add(v: number): void { this.xs.push(v); this.rows.push([v, v * 2, 1]); } at(i: number): number { return this.xs[i]! * 2; } ends(): number { return this.xs[0]! - this.xs[1]! + this.xs[this.xs.length - 1]!; } row(i: number): number { const r = this.rows[i]!; return r[0]! * r[1]! + r[2]!; } past(i: number): number { return this.rows[0]![i]! + 1; } }
attempt("Q5", () => { const q = new Queue5(e => -e[1]); const out: number[] = []; for (const p of pairs) { if (q.size > 3 && q.first()[1] < p[1]) q.pop(); q.push([p[0], p[1] * 3]); out.push(q.first()[1]); } for (;;) { const x = q.pop(); if (!x) break; out.push(x[1], x[0].id); } return out; });
for (const row of [[1, 2, 3], [1.5, 2, -0], [0.25, NaN, 7], [2147483647, 2147483648], [5], [], [NaN, NaN, NaN, NaN]]) attempt("T5", () => { const t = new Track5(); for (const v of row) t.add(v); return [t.at(0), t.at(1), t.at(9), t.ends(), t.past(0), t.past(2), t.past(3), t.row(0), t.row(1)]; });
attempt("e5", () => entries.slice().sort((x, y) => x[1] - y[1]).map(x => x[0] + x[1]));
function r6(a: number[]): number { return Math.max(a[1]!, a[0]!); }
function s6(a: number[], k: number): number { const x = a[k]!; return x + x * 0.5; }
function t6(a: [Node, number]): number { return a[1] - a[1]; }
function l6(a: number[]): number { let s = 0; for (let k = 0; k < a.length; k++) s += a[k]! * 0.5; return s; }
for (const a of lists) { attempt("r6", () => r6(a)); attempt("s6", () => [0, 1, 2, 3, -1, 0.5].map(k => s6(a, k))); attempt("l6", () => l6(a)); attempt("t6", () => t6(a)); }
attempt("p6", () => pairs.map(p => t6(p)));
attempt("h6", () => { const h = new Heap<[Node, number]>(e => -e[1]); for (const p of pairs) if (p[1] === p[1]) h.push(p); const out: number[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
attempt("q6", () => { const h = new Heap<any>(e => -e[1]); for (const p of [[1, 2], [2, 1.5], ["a", 7], [new Node(1), "3"], [null, null], []]) h.push(p); const out: any[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
class Queue6 {
  private readonly items: [Node, number][] = [];
  constructor(private readonly score: (e: [Node, number]) => number) {}
  get size(): number { return this.items.length; }
  first(): [Node, number] { return this.items[0]!; }
  push(e: [Node, number]): void { this.items.push(e); let n = this.items.length - 1; const element = this.items[n]!; while (n > 0) { const p = Math.floor((n + 1) / 2) - 1, parent = this.items[p]!; if (this.score(element) >= this.score(parent)) break; this.items[p] = element; this.items[n] = parent; n = p; } }
  pop(): [Node, number] | undefined { const top = this.items[0], end = this.items.pop(); if (this.items.length > 0 && end !== undefined) { this.items[0] = end; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.score(this.items[c + 1]!) < this.score(this.items[c]!)) c++; if (this.score(this.items[c]!) >= this.score(end)) break; this.items[n] = this.items[c]!; this.items[c] = end; n = c; } } return top; }
}
class Track6 { private readonly xs: number[] = []; private readonly rows: number[][] = []; add(v: number): void { this.xs.push(v); this.rows.push([v, v * 2, 1]); } at(i: number): number { return this.xs[i]! - this.xs[0]!; } ends(): number { return this.xs[0]! - this.xs[1]! + this.xs[this.xs.length - 1]!; } row(i: number): number { const r = this.rows[i]!; return r[0]! * r[1]! + r[2]!; } past(i: number): number { return this.rows[0]![i]! + 1; } }
attempt("Q6", () => { const q = new Queue6(e => -e[1]); const out: number[] = []; for (const p of pairs) { if (q.size > 3 && q.first()[1] >= p[1]) q.pop(); q.push([p[0], p[1] + 0.25]); out.push(q.first()[1]); } for (;;) { const x = q.pop(); if (!x) break; out.push(x[1], x[0].id); } return out; });
for (const row of [[1, 2, 3], [1.5, 2, -0], [0.25, NaN, 7], [2147483647, 2147483648], [5], [], [NaN, NaN, NaN, NaN]]) attempt("T6", () => { const t = new Track6(); for (const v of row) t.add(v); return [t.at(0), t.at(1), t.at(9), t.ends(), t.past(0), t.past(2), t.past(3), t.row(0), t.row(1)]; });
attempt("e6", () => entries.slice().sort((x, y) => y[1] - x[1]).map(x => x[0] + x[1]));
function r7(a: number[]): number { return a[0]! - a[3]!; }
function s7(a: number[], k: number): number { const x = a[k]!; return x + a[0]!; }
function t7(a: [Node, number]): number { return a[1] - a[1]; }
function l7(a: number[]): number { let s = 0; for (let k = 0; k < a.length; k++) s += a[k]! * a[0]!; return s; }
for (const a of lists) { attempt("r7", () => r7(a)); attempt("s7", () => [0, 1, 2, 3, -1, 0.5].map(k => s7(a, k))); attempt("l7", () => l7(a)); attempt("t7", () => t7(a)); }
attempt("p7", () => pairs.map(p => t7(p)));
attempt("h7", () => { const h = new Heap<[Node, number]>(e => -e[1]); for (const p of pairs) if (p[1] === p[1]) h.push(p); const out: number[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
attempt("q7", () => { const h = new Heap<any>(e => -e[1]); for (const p of [[1, 2], [2, 1.5], ["a", 7], [new Node(1), "3"], [null, null], [1]]) h.push(p); const out: any[] = []; for (;;) { const x = h.pop(); if (!x) break; out.push(x[1]); } return out; });
class Queue7 {
  private readonly items: [Node, number][] = [];
  constructor(private readonly score: (e: [Node, number]) => number) {}
  get size(): number { return this.items.length; }
  first(): [Node, number] { return this.items[0]!; }
  push(e: [Node, number]): void { this.items.push(e); let n = this.items.length - 1; const element = this.items[n]!; while (n > 0) { const p = Math.floor((n + 1) / 2) - 1, parent = this.items[p]!; if (this.score(element) >= this.score(parent)) break; this.items[p] = element; this.items[n] = parent; n = p; } }
  pop(): [Node, number] | undefined { const top = this.items[0], end = this.items.pop(); if (this.items.length > 0 && end !== undefined) { this.items[0] = end; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.score(this.items[c + 1]!) < this.score(this.items[c]!)) c++; if (this.score(this.items[c]!) >= this.score(end)) break; this.items[n] = this.items[c]!; this.items[c] = end; n = c; } } return top; }
}
class Track7 { private readonly xs: number[] = []; private readonly rows: number[][] = []; add(v: number): void { this.xs.push(v); this.rows.push([v, v / 3, 1]); } at(i: number): number { return this.xs[i]! * 2; } ends(): number { return this.xs[0]! - this.xs[1]! + this.xs[this.xs.length - 1]!; } row(i: number): number { const r = this.rows[i]!; return r[0]! * r[1]! + r[2]!; } past(i: number): number { return this.rows[0]![i]! + 1; } }
attempt("Q7", () => { const q = new Queue7(e => -e[1]); const out: number[] = []; for (const p of pairs) { if (q.size > 3 && q.first()[1] >= p[1]) q.pop(); q.push([p[0], p[1] * 3]); out.push(q.first()[1]); } for (;;) { const x = q.pop(); if (!x) break; out.push(x[1], x[0].id); } return out; });
for (const row of [[1, 2, 3], [1.5, 2, -0], [0.25, NaN, 7], [2147483647, 2147483648], [5], [], [NaN, NaN, NaN, NaN]]) attempt("T7", () => { const t = new Track7(); for (const v of row) t.add(v); return [t.at(0), t.at(1), t.at(9), t.ends(), t.past(0), t.past(2), t.past(3), t.row(0), t.row(1)]; });
attempt("e7", () => entries.slice().sort((x, y) => x[1] - y[1]).map(x => x[0] + x[1]));
console.log(log.length);
let digest = 0; for (const line of log) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(digest);
console.log(process.argv[2] === "all" ? log.join("\n") : log.filter((_, i) => i % 61 === 0).join("\n"));

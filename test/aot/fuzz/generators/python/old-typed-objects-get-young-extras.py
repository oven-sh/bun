#!/usr/bin/env python3
"""old-typed-objects-get-young-extras.py <seed>: an object of a compiled layout that is given properties beyond its layout finds them by a word in its own cell (before: a locked weak hash map); heap/SlotVisitor.cpp visits it.
THE ATTACK: OLD TYPED OBJECTS GET YOUNG EXTRAS. Typed records and class instances of several sizes (with and without optional members, with 32-bit references, numbers, booleans) outlive full collections; untyped code then gives them extra properties that hold young objects, replaces them, deletes them, gives them hundreds (a dictionary), symbols, keys like indices, accessors; the typed fields are stored to between; holders die and come back at the same addresses; copies (spread, assign), lists of keys, JSON, freeze. Collections of the young and full ones between the steps.
A model of plain numbers beside every holder. Prints WRONG lines (at most eight), then sums."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed)
steps = R.choice([15000, 30000, 60000]); H = R.choice([40, 120, 300]); names = R.choice([3, 8, 20]); churn = R.choice([400, 2000, 9000])
w = dict(add=R.choice([20, 40]), replace=R.choice([10, 25]), remove=R.choice([5, 15]), read=30, typed=R.choice([5, 15]), keys=R.choice([3, 8]), copy=R.choice([1, 4]), renew=R.choice([2, 6]), young=R.choice([3, 10, 20]), full=R.choice([0, 1, 2]), many=R.choice([0, 1]), odd=R.choice([1, 3]))
print('''declare const console: any; declare const Bun: any;
const shell: any = globalThis;
const young: () => void = typeof shell.edenGC === "function" ? shell.edenGC : () => Bun.gc(false);
const full: () => void = typeof shell.fullGC === "function" ? shell.fullGC : () => Bun.gc(true);
let state = %(seed)d;
function next(n: number): number { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return (state >>> 8) %% n; }
let wrong = 0, checks = 0, sum = 0, made = 0;
function bad(what: string, got: unknown, want: unknown) { wrong++; if (wrong < 9) console.log("WRONG", what, String(got), String(want)); }
type Small = { id: number };
type Pair = { id: number; other: Small | null };
type Wide = { id: number; a: number; b: boolean; c: string; d: Small | null; e?: number; f?: Small; g?: string };
class Plain { id: number; constructor(id: number) { this.id = id; } }
class Rich { id: number; ratio = 0.5; on = false; link: Small | null = null; label = "r"; opt?: number; constructor(id: number) { this.id = id; } twice(): number { return this.id * 2; } }
class Heir extends Rich { more = 1; }
type Holder = Small | Pair | Wide | Plain | Rich | Heir;
function holder(id: number): Holder { switch (next(6)) { case 0: return { id }; case 1: return { id, other: next(2) ? { id: id + 1 } : null }; case 2: { const o: Wide = { id, a: 1.5, b: true, c: "c", d: { id: id + 2 } }; if (next(2)) o.e = id; if (next(2)) o.f = { id: id + 3 }; return o; } case 3: return new Plain(id); case 4: return new Rich(id); default: return new Heir(id); } }
const N = %(names)d, NAMES: string[] = []; for (let i = 0; i < N; i++) NAMES.push("x" + i);
const SYM = Symbol("extra");
type Model = { id: number; keys: string[]; values: number[]; sym: number; frozen: boolean };
const holders: Holder[] = [], models: Model[] = [];
function renew(i: number) { const id = ++made * 10; holders[i] = holder(id); models[i] = { id, keys: [], values: [], sym: -1, frozen: false }; }
for (let i = 0; i < %(H)d; i++) { holders.push({ id: 0 }); models.push({ id: 0, keys: [], values: [], sym: -1, frozen: false }); renew(i); }
full(); young(); full();
function fresh(v: number): unknown { switch (next(5)) { case 0: return { v }; case 1: return [v]; case 2: return { v, deep: { v } }; case 3: { const s: Small = { id: v }; return { v, s }; } default: return { v, text: "t" + (v & 7) }; } }
function readNamed(o: any, k: string): any { switch (k) { case "x0": return o.x0; case "x1": return o.x1; case "x2": return o.x2; case "y0": return o.y0; case "y89": return o.y89; default: return o[k]; } }
function writeNamed(o: any, k: string, v: unknown): void { switch (k) { case "x0": o.x0 = v; break; case "x1": o.x1 = v; break; case "x2": o.x2 = v; break; case "y0": o.y0 = v; break; case "y89": o.y89 = v; break; default: o[k] = v; } }
function hasNamed(o: any, k: string): boolean { switch (k) { case "x0": return "x0" in o && Object.hasOwn(o, "x0"); case "x1": return "x1" in o && o.hasOwnProperty("x1"); case "x2": return "x2" in o; default: return k in o; } }
function deleteNamed(o: any, k: string): boolean { switch (k) { case "x0": return delete o.x0; case "x1": return delete o.x1; case "x2": return delete o.x2; default: return delete o[k]; } }
function valueOf(x: any): number { return x === undefined ? -1 : Array.isArray(x) ? x[0] : x.v; }
function check(i: number) { const o: any = holders[i], m = models[i]; checks++;
  if (o.id !== m.id) bad("id", o.id, m.id);
  for (let k = 0; k < m.keys.length; k++) { const got = valueOf(readNamed(o, m.keys[k])); if (got !== m.values[k]) bad("extra " + m.keys[k], got, m.values[k]); if (!hasNamed(o, m.keys[k])) bad("has " + m.keys[k], false, true); }
  const miss = NAMES[next(N)]; if (m.keys.indexOf(miss) < 0 && (readNamed(o, miss) !== undefined || hasNamed(o, miss) || Object.hasOwn(o, miss))) bad("an extra nobody gave", o[miss], undefined);
  if (valueOf(o[SYM]) !== m.sym) bad("symbol", valueOf(o[SYM]), m.sym);
  sum = (sum + m.keys.length) | 0; }
function extrasOf(o: any, m: Model): string { return Object.keys(o).filter(k => k[0] === "x" || k[0] === "y").join(); }
const W: Record<string, number> = %(w)s; const kinds = Object.keys(W); let total = 0; for (const k of kinds) total += W[k];
function pick(): string { let r = next(total); for (const k of kinds) { if (r < W[k]) return k; r -= W[k]; } return kinds[0]; }
for (let step = 0; step < %(steps)d; step++) { const i = next(holders.length), o: any = holders[i], m = models[i];
  switch (pick()) {
    case "add": { if (m.frozen) break; const k = NAMES[next(N)], v = ++made; const at = m.keys.indexOf(k); if (at >= 0 && m.values[at] === -5) break; writeNamed(o, k, fresh(v)); if (at < 0) { m.keys.push(k); m.values.push(v); } else m.values[at] = v; break; }
    case "replace": { if (m.frozen || !m.keys.length) break; const at = next(m.keys.length), v = ++made; if (m.values[at] === -5) break; writeNamed(o, m.keys[at], fresh(v)); m.values[at] = v; break; }
    case "remove": { if (m.frozen || !m.keys.length) break; const at = next(m.keys.length); if (!deleteNamed(o, m.keys[at])) bad("delete", false, true); m.keys.splice(at, 1); m.values.splice(at, 1); break; }
    case "read": check(i); break;
    case "typed": { if (m.frozen) break; const h = holders[i]; if (h instanceof Rich) { h.link = { id: m.id + 5 }; h.ratio = step + 0.25; h.on = !h.on; if (h.twice() !== m.id * 2) bad("method", h.twice(), m.id * 2); if (h.link.id !== m.id + 5) bad("link", h.link.id, m.id + 5); } else if ("other" in h) { h.other = { id: m.id + 1 }; } else if ("a" in h) { h.d = { id: m.id + 2 }; h.f = { id: m.id + 3 }; h.e = step; if (h.d.id !== m.id + 2 || h.f.id !== m.id + 3) bad("wide", h.d.id, m.id + 2); } break; }
    case "keys": { const got = extrasOf(o, m), want = m.keys.join(); if (got !== want) bad("keys", got, want); const seen: string[] = []; for (const k in o) if (k[0] === "x" || k[0] === "y") seen.push(k); if (seen.join() !== want) bad("for in", seen.join(), want); break; }
    case "copy": { const c: any = next(2) ? { ...o } : Object.assign({}, o); for (let k = 0; k < m.keys.length; k++) if (valueOf(c[m.keys[k]]) !== m.values[k]) bad("copy", valueOf(c[m.keys[k]]), m.values[k]); if (c.id !== m.id) bad("copy id", c.id, m.id); const j = JSON.parse(JSON.stringify(o)); if (j.id !== m.id) bad("json id", j.id, m.id); for (let k = 0; k < m.keys.length; k++) if (valueOf(j[m.keys[k]]) !== m.values[k]) bad("json", valueOf(j[m.keys[k]]), m.values[k]); break; }
    case "renew": renew(i); break;
    case "young": young(); break;
    case "full": full(); break;
    case "many": { if (m.frozen) break; for (let k = 0; k < 90; k++) { const key = "y" + k, v = ++made, at = m.keys.indexOf(key); o[key] = fresh(v); if (at < 0) { m.keys.push(key); m.values.push(v); } else m.values[at] = v; } break; }
    case "odd": { if (m.frozen) break; const r = next(4); if (r === 0) { const v = ++made; o[SYM] = fresh(v); m.sym = v; } else if (r === 1 && m.sym >= 0) { delete o[SYM]; m.sym = -1; } else if (r === 2) { Object.freeze(o); m.frozen = true; if (!Object.isFrozen(o)) bad("frozen", false, true); } else { const k = NAMES[next(N)]; if (m.keys.indexOf(k) < 0) { Object.defineProperty(o, k, { get() { return { v: -5 }; }, enumerable: true, configurable: true }); m.keys.push(k); m.values.push(-5); } } break; }
  }
  if (step %% %(churn)d === %(churn)d - 1) { for (let j = 0; j < holders.length; j++) { check(j); if (next(3) === 0) renew(j); } full(); } }
for (let j = 0; j < holders.length; j++) check(j);
console.log("wrong", wrong, "checks", checks, "sum", sum, "made", made);''' % dict(seed=seed * 15485863 + 11, names=names, H=H, steps=steps, churn=churn, w=repr(w).replace("'", '"')))

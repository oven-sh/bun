#!/usr/bin/env python3
"""stores-from-runtime-code.py <seed>: EVERY ALLOCATION AND EVERY STORE OF THE STEPS IS DONE BY TEXT MADE AT RUN TIME (new Function): under --aot that text stays in the interpreter.
Old holders (they have outlived full collections) get YOUNG values: object literals of many sizes, ropes, arrays, closures: by put_by_id (replace | add), put_by_val, put_to_scope. A model of plain numbers and of strings built another way stands beside. Random steps: store, move, clear, join, add a property, collect the young (once | in a row), collect fully, make garbage that takes the room of whatever was freed too early, check. It prints only sums: as plain Bun, and `wrong 0`."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed)
steps = R.choice([15000, 30000, 50000])
w = dict(lit=R.choice([10, 30, 50]), rope=R.choice([10, 25, 40]), move=R.choice([10, 30]), add=R.choice([5, 15, 30]), clear=R.choice([2, 6]), young=R.choice([4, 12, 25]), run=R.choice([1, 4, 10]), full=R.choice([1, 2]), garbage=R.choice([3, 8, 15]), check=R.choice([10, 25]), scope=R.choice([5, 15]), val=R.choice([5, 15]), miss=R.choice([3, 10]))
sizes = sorted(R.sample(range(0, 14), R.choice([3, 5, 8])))
lits = []
for n in sizes:
    fields = ", ".join(["id: id"] + ["p%d: %s" % (i, R.choice(["0", "id", "null", "text", "inner", "1.5", "undefined", "true"])) for i in range(n)])
    lits.append("function (id, text, inner) { return { %s }; }" % fields)
print('''const shell = globalThis;
const young = typeof shell.edenGC === "function" ? shell.edenGC : () => shell.Bun.gc(false);
const full = typeof shell.fullGC === "function" ? shell.fullGC : () => shell.Bun.gc(true);
let state = %d;
function next(n) { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return (state >>> 8) %% n; }
// the text: one new Function a tool, so that each has its own bytecode and its own caches
const text = (...a) => new Function(...a);
const makers = %s.map(src => text("return " + src)());
const setV = text("o", "v", "o.v = v;"), setW = text("o", "v", "o.w = v;"), getV = text("o", "return o.v;"), getW = text("o", "return o.w;");
const setAt = text("a", "i", "v", "a[i] = v;"), getAt = text("a", "i", "return a[i];"), setKey = text("o", "k", "v", "o[k] = v;");
const adders = []; for (let i = 0; i < 12; i++) adders.push(text("o", "v", "o.added" + i + " = v; return o;"));
const join = text("a", "b", "return a + b;"), join3 = text("a", "b", "c", "return a + b + c;"), grow = text("s", "n", "for (let i = 0; i < n; i++) s += '<' + i + '>'; return s;");
const cell = text("let held = null; return { get: function () { return held; }, set: function (v) { held = v; } };");
const arrayOf = text("a", "b", "return [a, b];"), closureOf = text("v", "return function () { return v; };"), nest = text("id", "v", "return { id: id, in: { id: id + 1, in: { id: id + 2, v: v } } };");
const idOf = text("o", "if (o === null) return 0; if (o === undefined) return -1; if (typeof o == 'object') return o.id; if (typeof o === 'function') return o().id; return -2;");
const missing = text("o", "return o.nothingOfThisName === undefined ? 1 : 0;"), lengthOf = text("s", "return s.length;"), sizeOf = text("m", "return m.size;");
const truthy = text("v", "if (v) return 1; return 0;"), same = text("a", "b", "return a === b ? 1 : 0;"), isObject = text("v", "return typeof v == 'object' ? 1 : 0;"), isFunction = text("v", "return typeof v === 'function' ? 1 : 0;");
// the holders: made ahead and aged
const H = 160; const holders = [], arrays = [], cells = [], bags = [];
for (let i = 0; i < H; i++) holders.push({ id: -1, v: null, w: null, pad: i });
for (let i = 0; i < 24; i++) arrays.push(new Array(16).fill(null));
for (let i = 0; i < 40; i++) cells.push(cell());
for (let i = 0; i < 24; i++) bags.push({ id: -1 });
const ropes = new Array(64).fill(""), ropeModel = new Array(64).fill(null).map(() => []);
const modelV = new Array(H).fill(0), modelW = new Array(H).fill(0), modelA = arrays.map(() => new Array(16).fill(0)), modelC = new Array(40).fill(0), modelB = bags.map(() => new Array(12).fill(-1));
full(); young(); full();
let made = 0, wrong = 0, checks = 0, sum = 0; const junk = [];
function fresh() { const id = ++made; const k = next(makers.length + 4); const t = "t" + (id & 31);
  if (k < makers.length) return makers[k](id, t, next(2) ? null : makers[next(makers.length)](id, t, null));
  if (k === makers.length) { const a = arrayOf(id, t); a.id = id; return a; }
  if (k === makers.length + 1) return closureOf(makers[0](id, t, null));
  if (k === makers.length + 2) return nest(id, t);
  return makers[next(makers.length)](id, join(t, "!"), null); }
function bad(what, got, want) { wrong++; if (wrong < 6) console.log("WRONG", what, got, want); }
function check() { checks++;
  for (let i = 0; i < H; i++) { const a = idOf(getV(holders[i])), b = idOf(getW(holders[i])); if (a !== modelV[i]) bad("v", a, modelV[i]); if (b !== modelW[i]) bad("w", b, modelW[i]); sum = (sum + a + b) | 0; }
  for (let i = 0; i < arrays.length; i++) for (let j = 0; j < 16; j++) { const a = idOf(getAt(arrays[i], j)); if (a !== modelA[i][j]) bad("at", a, modelA[i][j]); }
  for (let i = 0; i < cells.length; i++) { const a = idOf(cells[i].get()); if (a !== modelC[i]) bad("scope", a, modelC[i]); }
  for (let i = 0; i < bags.length; i++) for (let j = 0; j < 12; j++) { const v = bags[i]["added" + j]; const a = v === undefined ? -1 : idOf(v); if (a !== modelB[i][j]) bad("added", a, modelB[i][j]); }
  for (let i = 0; i < 64; i++) { const want = ropeModel[i].join(""); if (lengthOf(ropes[i]) !== want.length) bad("length", ropes[i].length, want.length); else if (next(4) === 0 && ropes[i] !== want) bad("rope", i, want.length); } }
const W = %s; const kinds = Object.keys(W); let total = 0; for (const k of kinds) total += W[k];
function pick() { let r = next(total); for (const k of kinds) { if (r < W[k]) return k; r -= W[k]; } return kinds[0]; }
for (let step = 0; step < %d; step++) {
  switch (pick()) {
    case "lit": { const i = next(H), o = fresh(); if (next(2)) { setV(holders[i], o); modelV[i] = idOf(o); } else { setW(holders[i], o); modelW[i] = idOf(o); } break; }
    case "val": { const i = next(arrays.length), j = next(16), o = fresh(); setAt(arrays[i], j, o); modelA[i][j] = idOf(o); break; }
    case "scope": { const i = next(cells.length), o = fresh(); cells[i].set(o); modelC[i] = idOf(o); break; }
    case "add": { const i = next(bags.length), j = next(12), o = fresh(); adders[j](bags[i], o); modelB[i][j] = idOf(o); if (next(30) === 0) { bags[i] = { id: -1 }; modelB[i].fill(-1); } break; }
    case "move": { const i = next(H), j = next(H); setV(holders[i], getW(holders[j])); modelV[i] = modelW[j]; break; }
    case "clear": { const i = next(H); setV(holders[i], null); modelV[i] = 0; break; }
    case "rope": { const i = next(64), part = next(3) === 0 ? "\\u0416" + next(100) : "p" + next(1000); if (ropeModel[i].length > 60 || next(40) === 0) { ropes[i] = ""; ropeModel[i].length = 0; }
      switch (next(4)) { case 0: ropes[i] = join(ropes[i], part); ropeModel[i].push(part); break; case 1: ropes[i] = join(part, ropes[i]); ropeModel[i].unshift(part); break; case 2: ropes[i] = join3(ropes[i], part, "."); ropeModel[i].push(part, "."); break; default: { const j = next(64); if (ropeModel[i].length + ropeModel[j].length < 80) { ropes[i] = join(ropes[i], ropes[j]); ropeModel[i].push(...ropeModel[j]); } } } break; }
    case "miss": { const o = getV(holders[next(H)]); if (o !== null && typeof o === "object" && missing(o) !== 1) bad("missing", 0, 1); sum = (sum + truthy(o) + isObject(o) * 2 + isFunction(o) * 4 + same(o, getV(holders[next(H)])) * 8 + truthy(ropes[next(64)]) * 16 + same(ropes[next(64)], ropes[next(64)]) * 32) | 0; break; }
    case "young": young(); break;
    case "run": { const n = 2 + next(4); for (let k = 0; k < n; k++) { young(); if (next(2)) { const i = next(H), o = fresh(); setW(holders[i], o); modelW[i] = idOf(o); } } break; }
    case "full": full(); break;
    case "garbage": { junk.length = 0; const n = 200 + next(2000); for (let k = 0; k < n; k++) junk.push(next(3) ? makers[next(makers.length)](-7, "junk", null) : join("junk" + k, "!")); junk.length = 0; break; }
    case "check": check(); break;
  }
}
full(); check(); young(); check();
console.log("steps", %d, "made", made, "checks", checks, "wrong", wrong, "sum", sum, "grown", grow("", 50).length);''' % (seed, "[" + ", ".join('"' + l.replace('"', '\\"') + '"' for l in lits) + "]", str(w).replace("'", '"'), steps, steps))

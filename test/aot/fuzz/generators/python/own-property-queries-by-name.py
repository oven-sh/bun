#!/usr/bin/env python3
"""own-property-queries-by-name.py <seed>: what is asked about own properties is remembered by shape and name in tables of a fixed size.
THE ATTACK: FAR MORE PAIRS OF SHAPE AND NAME THAN THE TABLES HOLD, SHAPES AND NAMES THAT DIE AND COME BACK AT THE SAME ADDRESSES, AND OBJECTS WHOSE ANSWER CHANGES: properties added, deleted, hidden, made accessors; elements; dictionaries; frozen; prototypes that get and lose names; names that nothing has and that something then gets; keys written out, keys from a pool, keys made at run time, keys like indices, symbols.
A model of plain arrays of names beside every object. Prints WRONG lines (at most eight), then sums. Untyped JavaScript: all of it is compiled under --aot. BUN_JSC_validateAOTRuntime=1 makes the engine hold its tables against the Structures at every ask."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed)
steps = R.choice([20000, 40000, 80000]); live = R.choice([24, 60, 150, 400]); pool = R.choice([6, 14, 30]); made = R.choice([8, 40, 200])
churn = R.choice([300, 1500, 6000]); W = ["a", "b", "c", "name", "id", "value", "x", "y"]
written = lambda form: "function (o, k) { switch (k) { " + " ".join('case "%s": return %s;' % (n, form % n) for n in W) + " } return undefined; }"
print('''const shell = globalThis;
const young = typeof shell.edenGC === "function" ? shell.edenGC : () => shell.Bun.gc(false);
const full = typeof shell.fullGC === "function" ? shell.fullGC : () => shell.Bun.gc(true);
const say = typeof console === "object" ? console.log : print;
let state = %(seed)d;
function next(n) { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return (state >>> 8) %% n; }
let wrong = 0, asked = 0, sum = 0;
function bad(what, kind, key, got, want) { wrong++; if (wrong < 9) say("WRONG", what, "kind", kind, "key", String(key), "got", String(got), "want", String(want)); }
const W = %(W)s, POOL = []; for (let i = 0; i < %(pool)d; i++) POOL.push("p" + i + "_" + "qrstuv"[i %% 6]);
const SYMBOLS = [Symbol("s0"), Symbol("s1"), Symbol.iterator];
let never = 0;
function key() { const r = next(20);
  if (r < 6) return W[next(W.length)];
  if (r < 11) return POOL[next(POOL.length)];
  if (r < 15) return "m" + next(%(made)d);                 // made at run time: no atom until it is asked with
  if (r < 16) return String(next(12));                     // like an index
  if (r < 17) return SYMBOLS[next(3)];
  if (r < 18) return "never" + (never++);                  // nothing has it
  if (r < 19) return "never" + next(never + 1);            // asked before, perhaps
  return ["length", "constructor", "__proto__", "toString", "prototype", "name"][next(6)]; }
const hasOwnWritten = %(f1)s, methodWritten = %(f2)s, inWritten = %(f3)s, callWritten = %(f4)s;
const has = Object.prototype.hasOwnProperty;
class Point { constructor(g) { this.x = g; this.y = g + 1; } get sum() { return this.x + this.y; } }
const protos = []; for (let i = 0; i < 5; i++) protos.push({ o: {}, own: [], hidden: [] });
// an entry: the object; own: its string and symbol names in the order they came; hidden: those that are not enumerable; special: names the engine gives it
function fresh() { const kind = next(12); let o, own = [], hidden = [], proto = null, special = [], base = true;
  switch (kind) {
    case 0: o = {}; break;
    case 1: o = Object.create(null); base = false; break;
    case 2: proto = protos[next(protos.length)]; o = Object.create(proto.o); break;
    case 3: o = new Point(next(9)); own = ["x", "y"]; break;
    case 4: o = [1, 2, 3]; own = ["0", "1", "2"]; special = ["length"]; break;
    case 5: o = function named() {}; special = ["length", "name", "prototype"]; break;
    case 6: o = {}; o[1] = 1; o[7] = 7; own = ["1", "7"]; break;
    case 7: o = {}; for (let i = 0; i < 70; i++) { o["big" + i] = i; own.push("big" + i); } break;
    case 8: o = { a: 1, b: 2, name: "n" }; own = ["a", "b", "name"]; break;
    case 9: { const k = key(); if (k === "__proto__") { o = {}; break; } o = { id: 1, [k]: 2 }; own = k === "id" ? ["id"] : ["id", k]; break; }
    case 10: { const k1 = "m" + next(%(made)d), k2 = POOL[next(POOL.length)], k3 = W[next(W.length)]; o = Object.fromEntries([[k1, 1], [k2, 2], [k3, 3]]); own = [k1, k2, k3]; break; }
    default: o = { x: 0, y: 0, value: 0, c: 0 }; delete o.y; own = ["x", "value", "c"]; break; }
  return { o, own, hidden, proto, special, base, kind, locked: 0 }; }
function isIndex(k) { return typeof k === "string" && /^(0|[1-9][0-9]*)$/.test(k); }
function ownHas(e, k) { return e.own.indexOf(k) >= 0 || e.special.indexOf(k) >= 0; }
const OBJECT = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];
function inHas(e, k) { if (ownHas(e, k)) return true; if (e.proto && e.proto.own.indexOf(k) >= 0) return true; if (!e.base) return false;
  if (OBJECT.indexOf(k) >= 0) return true; if (e.kind === 3 && k === "sum") return true;
  if (e.kind === 4) return k === Symbol.iterator || k in Array.prototype; if (e.kind === 5) return k in Function.prototype; return false; }
function listed(e) { const ints = [], rest = []; for (const k of e.own) { if (typeof k === "symbol" || e.hidden.indexOf(k) >= 0) continue; if (isIndex(k)) ints.push(k); else rest.push(k); } ints.sort((a, b) => a - b); return ints.concat(rest); }
function ask(e) { const o = e.o, k = key(), own = ownHas(e, k), within = inHas(e, k); asked++;
  if (Object.hasOwn(o, k) !== own) bad("Object.hasOwn", e.kind, k, !own, own);
  if (has.call(o, k) !== own) bad("hasOwnProperty.call", e.kind, k, !own, own);
  if (e.base && e.own.indexOf("hasOwnProperty") < 0 && o.hasOwnProperty(k) !== own) bad("o.hasOwnProperty", e.kind, k, !own, own);
  if ((k in o) !== within) bad("in", e.kind, k, !within, within);
  if (Reflect.has(o, k) !== within) bad("Reflect.has", e.kind, k, !within, within);
  if (typeof k === "string" && W.indexOf(k) >= 0) {
    if (hasOwnWritten(o, k) !== own) bad("Object.hasOwn, written", e.kind, k, !own, own);
    if (callWritten(o, k) !== own) bad("call, written", e.kind, k, !own, own);
    if (e.base && methodWritten(o, k) !== own) bad("method, written", e.kind, k, !own, own);
    if (inWritten(o, k) !== within) bad("in, written", e.kind, k, !within, within); }
  const d = Object.getOwnPropertyDescriptor(o, k); if ((d !== undefined) !== own) bad("descriptor", e.kind, k, d !== undefined, own);
  if (own && e.special.indexOf(k) < 0 && d.enumerable !== (e.hidden.indexOf(k) < 0)) bad("enumerable", e.kind, k, d.enumerable, !d.enumerable);
  sum = (sum + (own ? 1 : 0) + (within ? 2 : 0)) | 0; }
function list(e) { const want = listed(e).join(); const got = Object.keys(e.o).join(); if (got !== want) bad("Object.keys", e.kind, "", got, want);
  const seen = []; for (const k in e.o) seen.push(k);
  let all = listed(e); if (e.proto) for (const k of listed(e.proto)) if (e.own.indexOf(k) < 0) all = all.concat([k]);
  if (seen.join() !== all.join()) bad("for in", e.kind, "", seen.join(), all.join());
  sum = (sum + got.length) | 0; }
function add(e) { if (e.locked) return; const k = key(); if (k === "__proto__" || e.special.indexOf(k) >= 0) return; if (e.kind === 4 && isIndex(k)) return; if (e.kind === 3 && k === "sum") return;
  const had = e.own.indexOf(k) >= 0, how = next(6);
  if (how < 3) { if (!had && e.proto && e.proto.accessors && e.proto.accessors.indexOf(k) >= 0) return; e.o[k] = asked; if (!had) e.own.push(k); }
  else if (how === 3) { const hide = next(2) === 0; Object.defineProperty(e.o, k, { value: 1, enumerable: !hide, writable: true, configurable: true }); if (!had) e.own.push(k); const h = e.hidden.indexOf(k); if (hide && h < 0) e.hidden.push(k); if (!hide && h >= 0) e.hidden.splice(h, 1); }
  else if (how === 4) { Object.defineProperty(e.o, k, { get() { return 5; }, set(v) {}, enumerable: true, configurable: true }); if (!had) e.own.push(k); const h = e.hidden.indexOf(k); if (h >= 0) e.hidden.splice(h, 1); }
  else { Object.assign(e.o, { [k]: 3 }); if (!had) e.own.push(k); } }
function remove(e) { if (e.locked || e.own.length === 0) return; const k = next(3) ? e.own[next(e.own.length)] : key(); if (e.special.indexOf(k) >= 0 || k === "__proto__") return; if (e.kind === 4 && isIndex(k)) return;
  const i = e.own.indexOf(k); const done = next(2) ? delete e.o[k] : Reflect.deleteProperty(e.o, k); if (!done) bad("delete", e.kind, k, done, true); if (i >= 0) e.own.splice(i, 1); const h = e.hidden.indexOf(k); if (h >= 0) e.hidden.splice(h, 1); }
function lock(e) { if (e.kind === 4 || e.kind === 5) return; e.locked = 1; if (next(2)) Object.freeze(e.o); else Object.preventExtensions(e.o), Object.seal(e.o); }
let objects = []; for (let i = 0; i < %(live)d; i++) objects.push(fresh());
for (let step = 0; step < %(steps)d; step++) { const e = objects[next(objects.length)], r = next(100);
  if (r < 55) ask(e); else if (r < 70) add(e); else if (r < 78) remove(e); else if (r < 88) list(e); else if (r < 89) lock(e);
  else if (r < 93) objects[next(objects.length)] = fresh();
  else if (r < 96) { const p = protos[next(protos.length)]; const pe = { o: p.o, own: p.own, hidden: p.hidden, proto: null, special: [], base: true, kind: 0, locked: 0 }; if (next(2)) { const k = key(); if (typeof k === "string" && k !== "__proto__" && OBJECT.indexOf(k) < 0 && !isIndex(k)) { p.o[k] = 1; if (p.own.indexOf(k) < 0) p.own.push(k); } } else remove(pe); }
  else if (r < 98) young();
  if (step %% %(churn)d === %(churn)d - 1) { const keep = next(3); for (let i = 0; i < objects.length; i++) if (keep === 0 || next(3)) objects[i] = fresh(); full(); } }
say("wrong", wrong, "asked", asked, "sum", sum, "never", never);''' % dict(seed=seed * 104729 + 7, W=repr(W).replace("'", '"'), pool=pool, made=made, live=live, steps=steps, churn=churn,
  f1=written('Object.hasOwn(o, "%s")'), f2=written('o.hasOwnProperty("%s")'), f3=written('"%s" in o'), f4=written('has.call(o, "%s")')))

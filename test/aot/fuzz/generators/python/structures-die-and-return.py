#!/usr/bin/env python3
"""structures-die-and-return.py <seed>: a warm function made at run time is decoded once, and get_by_id | put_by_id carry A COPY OF THE INLINE CACHE IN THE RECORD (a Structure's id and a byte offset).
THE ATTACK: SHAPES THAT DIE AND WHOSE IDS COME BACK. A generation makes shapes nobody else has (names of its own), warms readers and writers made at run time on them (each tool is called far over a hundred times, so it is decoded and its record holds the shape), drops every object and every maker, collects; the next generation's shapes take the freed Structures' places (the same ids) WITH THE WANTED NAME AT ANOTHER OFFSET, out of line, missing, or an accessor. A copy that outlives its Structure reads or writes the wrong slot.
Beside it: misses remembered and then the prototype gets the name; transitions by literals; replaces in line and out of line with young values into old holders; lengths of arrays; closures' variables (dead zones too); strict equality with constants.
A model of plain numbers beside everything. Prints WRONG lines (at most six), then one line of sums. Runs as it is in the jsc shell (--useJIT=false: everything is interpreted) and in Bun (plain | --aot: the tools are text made at run time)."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed)
gens = R.choice([40, 80, 140]); shapes = R.choice([3, 6, 12]); warm = R.choice([130, 260, 600]); tools = R.choice([4, 8, 14])
collect = R.choice(["full", "full", "both", "young"]); keep = R.choice([0, 0, 1, 3])
print('''const shell = globalThis;
const young = typeof shell.edenGC === "function" ? shell.edenGC : () => shell.Bun.gc(false);
const full = typeof shell.fullGC === "function" ? shell.fullGC : () => shell.Bun.gc(true);
const say = typeof console === "object" ? console.log : print;
let state = %(seed)d;
function next(n) { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return (state >>> 8) %% n; }
const text = (...a) => new Function(...a);
let wrong = 0, checks = 0, sum = 0;
function bad(what, got, want) { wrong++; if (wrong < 7) say("WRONG", what, String(got), String(want)); }
// the tools live for the whole run: their records are what is attacked
const T = %(tools)d, readers = [], writers = [], missers = [], lengths = [], adders = [];
for (let t = 0; t < T; t++) {
  readers.push(text("o", "return o.w" + t + ";"));
  writers.push(text("o", "v", "o.w" + t + " = v; return o;"));
  missers.push(text("o", "return o.m" + t + " === undefined ? -7 : o.m" + t + ";"));
  lengths.push(text("a", "return a.length;"));
  adders.push(text("v", "var o = { w" + t + ": v }; return o;"));
}
const closures = text("let a = 1, b = 2; return { get: function () { return a + b; }, set: function (x, y) { a = x; b = y; }, early: function () { return function () { return late; }; let late = 5; } };")();
const compare = text("v", "var n = 0; if (v === undefined) n += 1; if (v === null) n += 2; if (v === true) n += 4; if (v === false) n += 8; if (v === 7) n += 16; if (v !== 7) n += 32; if (7 === v) n += 64; var e = v === 0; if (e) n += 128; return n;");
function compareModel(v) { let n = 0; if (v === undefined) n += 1; if (v === null) n += 2; if (v === true) n += 4; if (v === false) n += 8; if (v === 7) n += 16; if (v !== 7) n += 32; if (7 === v) n += 64; if (v === 0) n += 128; return n; }
const odd = [undefined, null, true, false, 7, 7.0, 7.5, 0, -0, NaN, "7", {}, [], 7n, Symbol.iterator, 2147483647, -2147483648, 1e300, ""];
const kept = [];
for (let g = 0; g < %(gens)d; g++) {
  // the shapes of this generation: names of their own ahead of, behind, or in the place of the wanted names
  const made = [];
  for (let s = 0; s < %(shapes)d; s++) {
    const before = next(9), after = next(4), form = next(10), parts = [], has = [];
    for (let i = 0; i < before; i++) parts.push("g" + g + "s" + s + "b" + i + ": " + (1000 + i));
    for (let t = 0; t < T; t++) { const h = next(4) !== 0; has.push(h); if (h) parts.push("w" + t + ": base + " + t); if (next(3) === 0) parts.push("g" + g + "s" + s + "x" + t + ": " + (2000 + t)); }
    for (let i = 0; i < after; i++) parts.push("g" + g + "s" + s + "a" + i + ": " + (3000 + i));
    let body = "var o = { " + parts.join(", ") + " };";
    const late = [];   // names added by stores: out of line when there are many
    if (form < 4) for (let i = 0; i < 2 + next(12); i++) body += " o.g" + g + "s" + s + "l" + i + " = " + (4000 + i) + ";";
    if (form === 4) body += " delete o.g" + g + "s" + s + "b0;";
    if (form === 5) body = "var p = { m0: base + 500, w0: base + 600 }; " + body + " Object.setPrototypeOf(o, p);";
    if (form === 6) body += " Object.defineProperty(o, 'w1', { get: function () { return base + 700; }, set: function (v) { this.hidden = v; }, configurable: true });";
    if (form === 7) body += " Object.freeze(o);";
    if (form === 8) body = "var o = Object.create(null); " + parts.map(p => "o." + p.replace(": ", " = ")).join("; ") + ";";
    made.push({ make: text("base", body + " return o;"), has, form });
  }
  for (const shape of made) {
    const base = next(100000) * 10, o = shape.make(base), twin = shape.make(base + 5);
    for (let t = 0; t < T; t++) {
      let want = shape.has[t] ? base + t : undefined;
      if (shape.form === 5 && t === 0 && !shape.has[0]) want = base + 600;
      if (shape.form === 6 && t === 1) want = base + 700;
      const read = readers[t];
      for (let k = 0; k < %(warm)d; k++) { const got = read(o); if (got !== want) { bad("read g" + g + " t" + t + " form " + shape.form, got, want); break; } }
      checks++;
      const miss = missers[t](o), missWant = shape.form === 5 && t === 0 ? base + 500 : -7; if (miss !== missWant) bad("miss " + shape.form, miss, missWant);
      // stores: a replace where the name is there, an addition where it is not; a young value into what may be old
      if (shape.form !== 7 && !(shape.form === 6 && t === 1)) {
        const write = writers[t]; const fresh = { id: base + t + 1 };
        for (let k = 0; k < 3 + next(%(warm)d); k++) write(twin, fresh);
        if (next(3) === 0) young();
        const back = readers[t](twin); if (back !== fresh || back.id !== base + t + 1) bad("stored " + shape.form, back, "fresh");
        // nothing beside it was hit
        for (let u = 0; u < T; u++) if (u > t) { let w = shape.has[u] ? base + 5 + u : undefined; if (shape.form === 5 && u === 0 && !shape.has[0]) w = base + 605; if (shape.form === 6 && u === 1) w = base + 705; const r = readers[u](twin); if (r !== w) bad("beside " + shape.form + " " + t + " " + u, r, w); }
      }
      const lit = adders[t](base); if (lit["w" + t] !== base) bad("literal", lit["w" + t], base);
    }
    const n = next(40), a = new Array(n).fill(g); if (next(2)) a.push(1.5); if (next(3) === 0) a["g" + g] = 1;
    for (let k = 0; k < 8; k++) if (lengths[next(T)](a) !== a.length) bad("length", -1, a.length);
    if (lengths[0]("abc" + g) !== ("abc" + g).length) bad("length of a string", 0, 0);
    if (lengths[1]({ length: base }) !== base) bad("length of an object", 0, base);
    closures.set(base, g); if (closures.get() !== base + g) bad("closure", closures.get(), base + g);
    try { closures.early()(); bad("dead zone", "no throw", "ReferenceError"); } catch (e) { if (!(e instanceof ReferenceError)) bad("dead zone", e, "ReferenceError"); }
    for (const v of odd) if (compare(v) !== compareModel(v)) bad("compare " + String(typeof v), compare(v), compareModel(v));
    sum = (sum + base) | 0;
    if (kept.length < %(keep)d * 8 && next(5) === 0) kept.push(o);
  }
  // a miss that was remembered, and then the prototype gets the name
  if (g %% 7 === 3) { const p = {}, o = Object.create(p); o["g" + g] = 1; for (let k = 0; k < %(warm)d; k++) if (missers[2 %% T](o) !== -7) { bad("missed", 0, -7); break; } p["m" + (2 %% T)] = g; if (missers[2 %% T](o) !== g) bad("the prototype got it", missers[2 %% T](o), g); delete p["m" + (2 %% T)]; if (missers[2 %% T](o) !== -7) bad("the prototype lost it", 0, -7); }
  // a reader of its own each time (the interpreter tries the chain of prototypes once a site): a miss, then somebody up the chain gets the name; a load from a prototype, then it moves, goes, is shadowed
  { const grand = {}; grand["v" + g] = 1; const p = Object.create(grand); p["u" + g] = 1; const o = Object.create(p); o["g" + g] = 1; const name = "n" + (g %% 5);
    const miss = text("o", "return o." + name + ";");
    for (let k = 0; k < %(warm)d; k++) if (miss(o) !== undefined) { bad("own reader missed", miss(o), undefined); break; }
    const where = next(2) ? p : grand; where[name] = g; if (miss(o) !== g) bad("somebody up the chain got it", miss(o), g);
    for (let k = 0; k < %(warm)d; k++) if (miss(o) !== g) { bad("read up the chain", miss(o), g); break; }
    where[name] = g + 1; if (miss(o) !== g + 1) bad("replaced up the chain", miss(o), g + 1);
    if (next(2)) { delete where["u" + g]; delete where["v" + g]; where["z" + g] = 0; if (miss(o) !== g + 1) bad("moved up the chain", miss(o), g + 1); }
    const how = next(4);
    if (how === 0) { delete where[name]; if (miss(o) !== undefined) bad("lost up the chain", miss(o), undefined); }
    else if (how === 1) { o[name] = -g; if (miss(o) !== -g) bad("shadowed", miss(o), -g); delete o[name]; if (miss(o) !== g + 1) bad("no longer shadowed", miss(o), g + 1); }
    else if (how === 2) { Object.defineProperty(where, name, { get() { return "got"; }, configurable: true }); if (miss(o) !== "got") bad("an accessor up the chain", miss(o), "got"); }
    else { if (where === grand) { p[name] = "nearer"; if (miss(o) !== "nearer") bad("nearer", miss(o), "nearer"); } else { Object.setPrototypeOf(o, grand); if (miss(o) !== undefined) bad("another prototype", miss(o), undefined); } } }
  // a writer of its own each time: a store that ADDS a property, warm; then somebody up the chain gets a setter, a read-only property, another prototype, loses them again
  { const grand = {}; grand["gv" + g] = 1; const p = Object.create(grand); p["pu" + g] = 1; const name = "a" + (g %% 4); let hits = 0;
    const add = text("o", "v", "o." + name + " = v; return o;"), strict = text("o", "v", "'use strict'; o." + name + " = v; return o;");
    const born = () => { const o = Object.create(p); o["g" + g] = 1; return o; };
    for (let k = 0; k < %(warm)d; k++) { const o = add(born(), k), q = strict(born(), k); if (o[name] !== k || !Object.hasOwn(o, name) || q[name] !== k) { bad("added", o[name], k); break; } }
    const where = next(2) ? p : grand, how = next(5);
    if (how === 0) { Object.defineProperty(where, name, { set(v) { hits += v; }, get() { return "up"; }, configurable: true });
      const o = add(born(), 5), q = strict(born(), 7); if (hits !== 12 || Object.hasOwn(o, name) || Object.hasOwn(q, name) || o[name] !== "up") bad("a setter up the chain", hits + " " + Object.hasOwn(o, name), "12 false");
      delete where[name]; const r = add(born(), 9); if (r[name] !== 9 || !Object.hasOwn(r, name) || hits !== 12) bad("the setter is gone", r[name], 9); }
    else if (how === 1) { Object.defineProperty(where, name, { value: "fixed", writable: false, configurable: true });
      const o = add(born(), 5); if (Object.hasOwn(o, name) || o[name] !== "fixed") bad("read-only up the chain", o[name], "fixed");
      let threw = false; try { strict(born(), 5); } catch (e) { threw = e instanceof TypeError; } if (!threw) bad("read-only up the chain, strict", "no throw", "TypeError"); }
    else if (how === 2) { const other = { set [name](v) { hits += v; } }; Object.setPrototypeOf(where === p ? p : grand, other);
      const o = add(born(), 3); if (hits !== 3 || Object.hasOwn(o, name)) bad("another prototype with a setter", hits, 3); }
    else if (how === 3) { where[name] = "plain above"; const o = add(born(), 4); if (o[name] !== 4 || !Object.hasOwn(o, name) || where[name] !== "plain above") bad("a plain value up the chain", o[name], 4); }
    else { const o = born(); Object.preventExtensions(o); add(o, 1); if (Object.hasOwn(o, name)) bad("not extensible", true, false); let threw = false; try { strict(Object.preventExtensions(born()), 1); } catch (e) { threw = e instanceof TypeError; } if (!threw) bad("not extensible, strict", "no throw", "TypeError");
      const f = Object.freeze(born()); add(f, 2); if (Object.hasOwn(f, name)) bad("frozen", true, false); }
    for (let k = 0; k < 20; k++) { const fresh = Object.create({}); add(fresh, k); if (fresh[name] !== k) { bad("another chain", fresh[name], k); break; } } }
  made.length = 0;
  %(collect)s
}
say("wrong", wrong, "checks", checks, "sum", sum, "kept", kept.length);''' % dict(seed=seed * 7919 + 13, tools=tools, gens=gens, shapes=shapes, warm=warm, keep=keep,
  collect={"full": "full();", "both": "young(); full();", "young": "young(); if (g % 5 === 4) full();"}[collect]))

// Fields that a constructor and an initializer fill with instances of classes; other code stores other values.
"use strict"; const out = []; let i = 0, calls = 0; const show = (v) => { try { return v && typeof v === "object" ? v.constructor && v.constructor.name + "{" + Object.keys(v).join() + "}" : typeof v === "function" ? "fn" : String(v); } catch (e) { return "E" + e.constructor.name; } };
class Moor { constructor(row, width) { this.width = width; this.row = row; } at() { return this.row; } }
class Timber { constructor(grain, hewn) { this.split = null; this.green = hewn !== undefined && hewn.green === true; this.grain = grain; } }
class Oak extends Timber { constructor(grain) { super(grain + "", { green: true }); this.felled = grain; } }
const timbers = { a: new Timber("a"), b: new Oak("b"), c: new Timber("c") };
["x", "y"].forEach((n) => { timbers["_" + n] = new Oak(n); });
class Plank { constructor(butt) { this.moor = new Moor(butt, 1); this.timber = timbers.a; this.tip = 0; this.butt = butt; } at() { return this.tip; } }
class Raft { constructor() { this.deep = 0; } launch(n) { this.load = n; this.ropes = [new Moor(1, 2)]; this.plank = null; this.moor = new Moor(n, 0); this.last = this.moor; this.timber = timbers.a; return this; } twin() { const made = new Raft(); for (const name of Object.keys(this)) made[name] = Array.isArray(this[name]) ? this[name].concat() : this[name]; return made; } }
function plain(plank, depth) { let t = ""; plank.late = plank.deck; return t + this.m0(plank, depth + 1); }
let held = {}; { class Yard { constructor() { this.raft = new Raft(); this.raft.launch(1); } } held = Yard; }
const Yard = held;
{ const laid = Yard.prototype; laid.m0 = function (plank, depth) { let s = ""; calls++; s += plank.at ? plank.at() : 0; if (plank.wet) s += "y"; plank.tip = null;  return s; }; laid.m1 = function (plank, depth) { let s = ""; calls++; for (let t = 0; t < 3; t++) s += plank.deck ? t : "o"; plank.owner = null; plank.late = plank.deck; plank.late = plank.owner; s += this.pick(depth) && this.pick(depth).butt; return s; }; laid.m2 = function (plank, depth) { let s = ""; calls++; { const q2 = plank; s += q2.timber > 1; } plank.late = timbers.b; s += plank.moor ? plank.moor.row + 1 : "n"; if (depth < 2) s += this.m0(this.make(depth), depth + 1); return s; }; laid.m3 = function (plank, depth) { let s = ""; calls++; if (plank.tip) s += "y"; for (let t = 0; t < 3; t++) s += plank.timber ? t : "o"; this.raft.timber = plank.timber; return s; }; laid.m4 = function (plank, depth) { let s = ""; calls++; plank.late = plank; s += plank.at ? plank.at() : 0; plank.late = plank.deck; this.raft.timber = timbers._x; return s; }; laid.m5 = function (plank, depth) { let s = ""; calls++; delete plank.butt; s += plank.timber && plank.timber.grain ? plank.timber.grain : "-"; plank.late = plank.wet; if (depth < 3) s += this.m4(plank, depth + 1); return s; }; laid.make = function (d) { const n = new Plank(d); n.owner = "n"; return n; }; laid.take = function (plank) { const t = plank; t.deck = [t.butt]; return t; }; laid.pick = function (d) { return d & 1 ? this.make(d) : null; }; }
const lists = { take: [1, 2], pick: new Map([[1, 2]]) };
globalThis.kept = [Yard, Plank, Raft, Moor, Timber, Oak]; if (process.argv[9]) { new Plank(1)[process.argv[9]] = 2; new Raft()[process.argv[9]] = 3; timbers[process.argv[9]] = 4; new Moor(1, 2)[process.argv[9]] = 5; }
const planks = [(y) => null, (y) => undefined, (y) => 7, (y) => "text", (y) => [1], (y) => y.make(1), (y) => new Plank(2), (y) => ({ butt: 1, tip: 2, timber: timbers.b }), (y) => new Moor(1, 2), (y) => Object.freeze(new Plank(3)), (y) => y.take(new Plank(4)), (y) => Object.create(new Plank(5)), (y) => new Proxy(new Plank(6), {}), (y) => Object.defineProperty(new Plank(8), "butt", { get() { return "acc"; }, configurable: true }), (y) => new (class Heir extends Plank { })(9), (y) => timbers.b, (y) => y.raft];
for (let turn = 0; turn < 3; turn++) {
  if (turn === 2) { Plank.prototype.late = "above"; }
  for (let k = 0; k < planks.length; k++) { const y = new Yard(); i = k;
    for (const m of ["m0", "m1", "m2", "m3", "m4", "m5"]) {
      try { out.push(m + " " + turn + " " + k + " " + y[m](planks[k](y), turn)); } catch (e) { out.push(m + " " + turn + " " + k + " T" + e.constructor.name); }
    }
    try { out.push(y.m0(planks[k](y), turn) + y.m1(planks[k](y), turn) + y.m2(planks[k](y), turn)); } catch (e) { out.push("T" + e.constructor.name); }
    try { out.push(y.m3(planks[k](y), turn) + y.m4(planks[k](y), turn) + y.m5(planks[k](y), turn)); } catch (e) { out.push("T" + e.constructor.name); }
    try { out.push([y.raft, y.raft.timber, y.raft.moor, y.raft.last, y.take(planks[k](y)), y.pick(k)].map(show).join("")); } catch (e) { out.push("T" + e.constructor.name); }
    if (k === 5) { const other = y.raft.twin(); out.push(show(other) + show(other.ropes[0]) + (other.ropes === y.raft.ropes)); }
  }
}
out.push(calls);
for (const line of out) console.log(String(line).slice(0, 260));

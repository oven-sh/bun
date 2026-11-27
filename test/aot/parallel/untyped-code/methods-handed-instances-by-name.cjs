// Methods whose name one function bears are handed instances of a class by name, and other values too.
"use strict"; const out = []; let i = 0, calls = 0; const show = (v) => { try { return v && typeof v === "object" ? v.constructor && v.constructor.name + "{" + Object.keys(v).join() + "}" : typeof v === "function" ? "fn" : String(v); } catch (e) { return "E" + e.constructor.name; } };
class Spot { constructor(row, place) { this.place = place; this.row = row; } at() { return this.row; } }
class Cloth { constructor(weave, made) { this.fold = null; this.dyed = made === undefined ? false : made.dyed === true; this.weave = weave; } }
class Silk extends Cloth { constructor(weave) { super(weave + "", { dyed: true }); this.called = weave; } }
const cloths = { a: new Cloth("a"), b: new Silk("b"), c: new Cloth("c") };
for (const n of ["x", "y"]) cloths["_" + n] = new Silk(n);
class Coat { constructor(hem) { this.spot = new Spot(hem, 1); this.cloth = cloths.a; this.cuff = 0; this.hem = hem; }  }
class Rail {  hang(n) { this.cloth = cloths.a; this.spot = new Spot(n, 0); this.coat = null; this.list = [new Spot(1, 2)]; this.count = n; this.last = this.spot; return this; } twin() { return Object.assign(new Rail(), this); } }
function plain(coat, depth) { let t = ""; if (coat.cloth) t += "y"; return t + this.m0(coat, depth + 1); }
class Shop { constructor() { this.rail = new Rail(); this.rail.hang(1); } }
{ const shop = Shop.prototype; shop.m0 = function (coat, depth) { let s = ""; calls++; delete coat.hem; s += Object.keys(coat).length; s += Object.keys(coat).length; const k = this.rail.twin(); s += k.cloth === this.rail.cloth; return s; }; shop.m1 = function (coat, depth) { let s = ""; calls++; coat.extra += 1; s += String(coat.cuff); { const q1 = coat; s += q1.name > 1; } { const q1 = coat; s += q1.late > 1; } s += this.rail.cloth.weave; return s; }; shop.m2 = function (coat, depth) { let s = ""; calls++; s += Object.keys(coat).length; s += String(coat.hem); if (depth < 2) s += plain.call(this, coat, depth + 1); return s; }; shop.m3 = function (coat, depth) { let s = ""; calls++; delete coat.cloth; if (coat.hem) s += "y"; s += String(coat.extra); if (depth < 2) s += this.m3(this.make(depth), depth + 1); return s; }; shop.make = function (d) { const n = new Coat(d);  return n; }; shop.take = function (coat) { coat.taken = 1; return coat; }; shop.pick = function (d) { return new Coat(d); }; }
class Other { m0(coat) { return "other"; } make() { return 5; } take(n) { return n; } }
globalThis.kept = [Shop, Coat, Rail, Spot, Cloth, Silk]; if (process.argv[9]) { new Coat(1)[process.argv[9]] = 2; new Rail()[process.argv[9]] = 3; cloths[process.argv[9]] = 4; new Spot(1, 2)[process.argv[9]] = 5; }
const coats = [(p) => p.make(1), (p) => new Coat(2), (p) => ({ hem: 1, cuff: 2, cloth: cloths.b }), (p) => new Spot(1, 2), (p) => Object.freeze(new Coat(3)), (p) => p.take(new Coat(4)), (p) => null, (p) => undefined, (p) => 7, (p) => "text", (p) => Object.create(new Coat(5)), (p) => new Proxy(new Coat(6), {}), (p) => { const n = new Coat(8); Object.defineProperty(n, "hem", { get() { return "acc"; }, configurable: true }); return n; }, (p) => new (class Heir extends Coat { })(9), (p) => [1], (p) => cloths.b, (p) => p.rail];
for (let turn = 0; turn < 3; turn++) {
  if (turn === 2) { Spot.prototype.at = function () { return "other"; }; }
  for (let k = 0; k < coats.length; k++) { const p = new Shop(); i = k;
    try { out.push("m0 " + turn + " " + k + " " + p.m0(coats[k](p), turn)); } catch (e) { out.push("m0 " + turn + " " + k + " T" + e.constructor.name); }
    try { out.push("m1 " + turn + " " + k + " " + p.m1(coats[k](p), turn)); } catch (e) { out.push("m1 " + turn + " " + k + " T" + e.constructor.name); }
    try { out.push("m2 " + turn + " " + k + " " + p.m2(coats[k](p), turn)); } catch (e) { out.push("m2 " + turn + " " + k + " T" + e.constructor.name); }
    try { out.push("m3 " + turn + " " + k + " " + p.m3(coats[k](p), turn)); } catch (e) { out.push("m3 " + turn + " " + k + " T" + e.constructor.name); }
    try { out.push(show(p.rail) + show(p.rail.cloth) + show(p.rail.spot) + show(p.rail.last) + show(p.take(coats[k](p))) + show(p.pick(k))); } catch (e) { out.push("T" + e.constructor.name); }
  }
}
out.push(calls);
for (const line of out) console.log(String(line).slice(0, 260));

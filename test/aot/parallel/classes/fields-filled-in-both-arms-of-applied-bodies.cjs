// A body that the constructor applies stores a field in both arms of an if, so that it is filled behind them. One arm alone, a loop, a switch without a default and an early end leave it empty.
const said = [];
const turns = JSON.parse("30");
function Body() { Body.Body.apply(this, arguments); if (this.constructor === Body) this.Body.apply(this, arguments); }
Body.Body = function () { this.p = new Vec(); };
Body.prototype.Body = function (k, early) {
  this.flags = 0; if (k & 1) this.flags |= 4; this.type = k;
  if (this.type === 2) this.inv = this.mass = 1.5; else this.inv = this.mass = 0;
  if (k & 2) { this.one = 1; }
  switch (k & 3) { case 0: this.sw = 0.5; break; case 1: this.sw = 1.5; break; default: this.sw = 2; }
  switch (k & 3) { case 0: this.part = 0.5; break; case 1: this.part = 1.5; }
  for (let i = 0; i < (k & 1); i++) this.loop = i;
  if (k & 1) { this.nest = 1; if (k & 4) this.deep = 1; else this.deep = 2; } else { this.nest = 2; this.deep = 3; }
  if (early) return;
  if (k & 1) this.late = 1; else this.late = 2;
  this.end = 1;
};
Body.prototype.Set = function () { this.p.x = this.inv; this.p.y = this.mass; };
Body.prototype.show = function () { return [this.inv, this.mass, this.one, this.sw, this.part, this.loop, this.nest, this.deep, this.late, this.end].map(String).join(); };
function Vec() { if (this.constructor === Vec) this.Vec.apply(this, arguments); }
Vec.prototype.Vec = function (x, y) { if (x === undefined) x = 0; if (y === undefined) y = 0; this.x = x; this.y = y; };
Vec.prototype.SetV = function (v) { this.x = v.x; this.y = v.y; };
function Seen(k) { Seen.setup.call(this, k); }
Seen.setup = function (k) { if (k & 1) { this.a = 1; said.push("a" + this.b); } else { said.push("b" + this.a); this.a = 2; } this.b = k; };
function Throws(k) { this.init(k); }
Throws.prototype.init = function (k) { if (k & 1) this.v = 1; else { if (k === 4) throw new RangeError("four"); this.v = 2; } this.w = this.v + 1; };
let total = 0; const acc = new Vec();
for (let i = 0; i < turns; i++) {
  const b = new Body(i, i % 5 === 0); b.Set(); acc.SetV(b.p); total += acc.x + acc.y + b.sw + b.nest + b.deep;
  said.push(b.show(), Object.keys(b).join());
  const s = new Seen(i); total += s.a;
  try { const t = new Throws(i); total += t.v + t.w; } catch (e) { said.push(e.message); }
}
let hash = 0; for (const s of said) for (const c of s) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(total, hash, said.length); console.log(said.slice(0, 24).join("\n"));

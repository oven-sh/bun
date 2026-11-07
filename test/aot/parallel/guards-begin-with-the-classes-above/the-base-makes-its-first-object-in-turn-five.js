// Base is only called by Heir until turn five, where it makes its first object. In turn seven unseen text lays a `call` of its own on Base.
function Base(a) { this.a = a; }
Base.prototype.first = function () { return this.a; };
function Heir(a, b) { Base.call(this, a); this.b = b; }
Object.setPrototypeOf(Heir.prototype, Base.prototype);
Heir.prototype.second = function () { return this.b + this.first(); };
globalThis.classes = { Base, Heir };
globalThis.arrived = "";
const change = (text) => (0, eval)(text);
function run(count) {
  let total = 0;
  let kept = null;
  for (let i = 0; i < count; i++) {
    if (i === 7) change("classes.Base.call = function (self, a) { arrived += Object.keys(self).length; self.a = a * 100; };");
    const item = new Heir(i, 2);
    if (i >= 5) kept = new Base(i * 10);
    total += item.second() + (kept ? kept.first() : 0);
  }
  return total;
}
console.log(run(10), globalThis.arrived);

// The first Heir is made before `late` is laid on the prototype of Base, so the record of Base is held against a prototype that lacks it. In turn five unseen text replaces `early` there and lays a name that no record has.
function Base(a) { this.a = a; }
function Heir(a) { Base.call(this, a); this.b = 1; }
Object.setPrototypeOf(Heir.prototype, Base.prototype);
Base.prototype.early = function () { return this.a; };
const first = new Heir(1);
Base.prototype.late = function () { return this.a * 2; };
globalThis.classes = { Base, Heir };
const change = (text) => (0, eval)(text);
function run(count) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (i === 5) change("classes.Base.prototype.early = function () { return 1000; }; classes.Base.prototype.other = 1;");
    const heir = new Heir(i);
    const base = new Base(i);
    total += heir.early() + heir.late() + base.early() + base.late() + heir.b + (heir.other ?? 0);
  }
  return total;
}
console.log(run(10), first.late(), first.early());

// `Object.defineProperty(F, "prototype", { writable: false })`, as Babel 7.18 and after ends every class. The descriptor names no value, so F.prototype holds what it held: what `new F()` makes is known to stand below it, `this instanceof F` is decided and the object is never made.
// COUNT: branches <= 6100
// COUNT: arrivals <= 20
function Locked(a) {
  if (!(this instanceof Locked)) throw new TypeError("called without new");
  this.a = a;
  this.b = 2;
}
Object.defineProperty(Locked.prototype, "sum", { value: function sum() { return this.a + this.b; }, configurable: true, writable: true });
Object.defineProperty(Locked, "prototype", { writable: false });
function turn(i) {
  return new Locked(i & 7).sum();
}
var sum = 0;
for (var i = 0; i < 3000; i++) sum += turn(i);
console.log(sum, JSON.stringify(Object.getOwnPropertyDescriptor(Locked, "prototype")), Object.keys(Locked).join());

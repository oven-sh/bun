// Base.call(this) finds Function.prototype.call while Base has only its `prototype` property. Then Base gets a `call` of its own, loses it, gets another parent, and is frozen.
const log = [];
function Base(tag) {
  this.tag = tag;
}
Base.prototype.describe = function () { return "tag " + this.tag; };
function Derived(tag, x) {
  Base.call(this, tag);
  this.x = x;
}
Object.setPrototypeOf(Derived.prototype, Base.prototype);
function make(n, tag) {
  let last;
  for (let i = 0; i < n; i++) last = new Derived(tag, i);
  return last;
}
log.push(make(40, "a").describe());
Base.call = function (self, tag) { log.push("own call " + tag); self.tag = "from own call"; };
log.push(make(2, "b").describe());
delete Base.call;
log.push(make(3, "c").describe());
const parent = Object.create(Function.prototype, { call: { value(self, tag) { log.push("parent call " + tag); self.tag = "from parent"; }, configurable: true, writable: true } });
Object.setPrototypeOf(Base, parent);
log.push(make(2, "d").describe());
Object.setPrototypeOf(Base, Function.prototype);
log.push(make(3, "e").describe());
Object.freeze(Base);
log.push(make(3, "f").describe(), Object.keys(make(1, "g")).join());
console.log(log.join(" | "));

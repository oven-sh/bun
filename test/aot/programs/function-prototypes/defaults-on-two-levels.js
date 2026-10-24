// The name has a default on the base's prototype and on the derived one; each is taken away or redefined in turn. Stores come from the base's constructor and from a method too.
const log = [];
function Base(count) {
  this.count = count;
}
Base.prototype.count = 0;
Base.prototype.reset = function () { this.count = -1; this.flag = true; return this; };
Base.prototype.flag = false;
function Derived(count) {
  Base.call(this, count);
  this.flag = count > 1;
}
Object.setPrototypeOf(Derived.prototype, Base.prototype);
Derived.prototype.count = 10;
let d;
for (let i = 0; i < 40; i++) d = new Derived(i);
log.push(Object.keys(d).join(), d.count, d.flag, Object.keys(Object.create(Derived.prototype).reset()).join());
Object.defineProperty(Base.prototype, "count", { set(v) { log.push("base set count " + v); }, get() { return "base count"; }, configurable: true });
d = new Derived(5);
log.push(Object.keys(d).join(), d.count);
let b = new Base(6);
log.push(Object.keys(b).join(), b.count);
delete Derived.prototype.count;
d = new Derived(7);
log.push(Object.keys(d).join(), d.count, Object.keys(Object.create(Derived.prototype).reset()).join());
Object.defineProperty(Base.prototype, "flag", { value: "fixed", writable: false });
try {
  d = new Derived(8);
  log.push(Object.keys(d).join(), d.flag);
} catch (e) {
  log.push(e.constructor.name);
}
console.log(log.join(" | "));

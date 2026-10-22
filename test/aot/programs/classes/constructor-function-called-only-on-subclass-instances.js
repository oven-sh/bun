function Base() { this.x = 1; this.y = 2; }
function Derived() { Base.call(this); this.z = 3; }
Derived.prototype = Object.create(Base.prototype);
Object.defineProperty(Base.prototype, "y", { set(v) { this.q = v; }, get() { return 20; }, configurable: true });
const d = new Derived();
console.log(d.x, d.y, d.z);

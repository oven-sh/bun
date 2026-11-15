function Base(name) { this.name = name; }
function Sub(name) { Base.call(this, name); }
Sub.prototype = Object.create(Base.prototype); Object.defineProperty(Sub.prototype, "name", { get() { return this._name; }, set(v) { this._name = v.trim(); }, configurable: true });
const x = new Sub(" a "), y = new Base(" b "); console.log([x.name, Object.keys(x), y.name, Object.keys(y)].join("|"));

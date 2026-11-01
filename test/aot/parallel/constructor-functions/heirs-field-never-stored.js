function Meter(size) { this.size = size; this.n = 0; }
function Sub(size) { Meter.call(this, size); this.extra = "x"; }
Sub.prototype = Object.create(Meter.prototype);
const s = new Sub(2);
const o = Reflect.construct(Meter, [9], Sub);
console.log(String(o.size), String(o instanceof Sub), String(o.extra), "extra" in o, Object.keys(o).join());

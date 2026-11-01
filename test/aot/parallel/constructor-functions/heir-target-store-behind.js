// Alone: what is claimed of the heir's fields is a fact about the whole program: another maker of its objects takes the claim away.
// Reflect.construct(above, list, heir) runs the function above alone: the heir's own fields were never stored.
const see = o => [String(o.size), String(o.extra), "extra" in o, Object.keys(o).join(), typeof o.extra].join(" ");
function Meter(size) { this.size = size; this.n = 0; }
function Sub(size) { Meter.call(this, size); this.extra = "x"; }
Sub.prototype = Object.create(Meter.prototype);
const s = new Sub(2); const o = Reflect.construct(Meter, [9], Sub); const before = see(o); o.extra = "later"; delete s.extra; console.log(before, "|", see(o), "|", see(s), JSON.stringify(o), JSON.stringify(s));

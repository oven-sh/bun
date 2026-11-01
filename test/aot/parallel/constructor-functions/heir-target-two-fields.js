// Alone: what is claimed of the heir's fields is a fact about the whole program: another maker of its objects takes the claim away.
// Reflect.construct(above, list, heir) runs the function above alone: the heir's own fields were never stored.
function Meter(size) { this.size = size; }
function Sub(size) { Meter.call(this, size); this.count = 1; this.list = [1]; }
Sub.prototype = Object.create(Meter.prototype);
const s = new Sub(2); const o = Reflect.construct(Meter, [9], Sub); console.log(String(o.count), String(o.list), "count" in o, "list" in o, Object.keys(o).join(), String(s.count + s.list.length), (() => { try { return o.list.length; } catch (e) { return e.constructor.name; } })());
